package bridge_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/obalunenko/mergbw-controller/internal/bridge"
	"github.com/obalunenko/mergbw-controller/internal/config"
	"github.com/obalunenko/mergbw-controller/internal/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

func effectPreset() protocol.Preset {
	return protocol.Preset{
		Label: "Evening colors", RGB: []int{255, 80, 0}, Brightness: 75,
		Effect: &protocol.Effect{Kind: "palette", Colors: [][]int{{0, 80, 255}}, TransitionMS: 2000, Loop: true},
	}
}

func effectHandler(t *testing.T, preset protocol.Preset) (*bridge.Handler, *MockEffectController, config.Settings) {
	t.Helper()
	settings := config.Settings{DeviceIdentity: "AA:BB:CC:DD:EE:FF", Port: 18765, AccessToken: "effect_test_token_1234567890"}
	control := NewMockEffectController(gomock.NewController(t))
	return bridge.New(settings, map[string]protocol.Preset{"evening": preset}, control), control, settings
}

func TestEffectHTTPDynamicPresetsAccepted(t *testing.T) {
	for _, definition := range []protocol.Effect{
		{Kind: "palette", Colors: [][]int{{0, 80, 255}}, TransitionMS: 2000, Loop: true},
		{Kind: "strobe", OnMS: 500, OffMS: 750, Loop: true},
		{Kind: "breathing", MinBrightness: 5, CycleMS: 4000},
		{Kind: "candle", Depth: 35, FlickerMS: 500, DurationMS: 30000},
		{Kind: "lightning", BackgroundRGB: []int{26, 42, 108}, BackgroundBrightness: 15, MinPauseMS: 2000, MaxPauseMS: 15000, MaxFlashes: 3, Loop: true},
	} {
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			t.Run(definition.Kind+"/"+method, func(t *testing.T) {
				preset := effectPreset()
				preset.Effect = new(definition)
				h, control, settings := effectHandler(t, preset)
				action := protocol.EffectAction{PresetID: "evening", Preset: preset}
				snapshot := protocol.EffectSnapshot{
					ID: strings.Repeat("a", 32), PresetID: "evening", Kind: definition.Kind,
					State: "running", DurationMS: action.DurationMS(),
				}
				var requestContext context.Context
				control.EXPECT().StartEffect(gomock.Any(), action).DoAndReturn(func(ctx context.Context, _ protocol.EffectAction) (protocol.EffectSnapshot, error) {
					requestContext = ctx
					return snapshot, nil
				})
				w := transitionRequest(h, settings, method, "preset/evening")
				require.Equal(t, http.StatusAccepted, w.Code)
				value := transitionResponse(t, w)
				assert.Len(t, value, 4)
				assert.Equal(t, true, value["accepted"])
				assert.Equal(t, "preset/evening", value["action"])
				assert.Equal(t, false, value["physical_state_verified"])
				assert.NotContains(t, value, "sent")
				job := value["effect"].(map[string]any)
				assert.Equal(t, snapshot.ID, job["id"])
				assert.Equal(t, "evening", job["presetId"])
				assert.Equal(t, definition.Kind, job["kind"])
				assert.Equal(t, false, job["physical_state_verified"])
				if definition.Loop {
					assert.Nil(t, job["durationMs"])
				} else {
					assert.EqualValues(t, *snapshot.DurationMS, job["durationMs"])
				}
				assert.ErrorIs(t, requestContext.Err(), context.Canceled, "accepted execution must belong to the controller root")
			})
		}
	}
}

func TestEffectHTTPStaticReceiptAndCatalogRemainCompatible(t *testing.T) {
	preset := effectPreset()
	preset.Effect = nil
	h, control, settings := effectHandler(t, preset)
	action, err := protocol.Resolve([]string{"preset", "evening"}, map[string]protocol.Preset{"evening": preset})
	require.NoError(t, err)
	control.EXPECT().Execute(gomock.Any(), action).Return(nil)
	w := transitionRequest(h, settings, http.MethodPost, "preset/evening")
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, map[string]any{"sent": true, "action": "preset/evening", "physical_state_verified": false}, transitionResponse(t, w))

	// Definitions stay private; catalog metadata only identifies the preset group.
	h, _, settings = effectHandler(t, effectPreset())
	w = transitionRequest(h, settings, http.MethodGet, "presets")
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, map[string]any{
		"presets":                 []any{map[string]any{"id": "evening", "label": "Evening colors", "builtIn": false}},
		"physical_state_verified": false,
	}, transitionResponse(t, w))
}

func TestEffectHTTPReadOnlyStatusAndExactCancellation(t *testing.T) {
	h, control, settings := effectHandler(t, effectPreset())
	control.EXPECT().EffectStatus().Return(nil)
	w := transitionRequest(h, settings, http.MethodGet, "effect")
	require.Equal(t, http.StatusOK, w.Code)
	assert.Nil(t, transitionResponse(t, w)["effect"])

	id := strings.Repeat("a", 32)
	snapshot := protocol.EffectSnapshot{
		ID: id, PresetID: "evening", Kind: "candle", State: "completed", ElapsedMS: 1500, DurationMS: new(int64(1000)),
	}
	control.EXPECT().EffectStatus().Return(&snapshot)
	w = transitionRequest(h, settings, http.MethodGet, "effect")
	require.Equal(t, http.StatusOK, w.Code)
	job := transitionResponse(t, w)["effect"].(map[string]any)
	assert.EqualValues(t, 1500, job["elapsedMs"], "slow writes can exceed nominal duration")
	assert.EqualValues(t, 1000, job["durationMs"])
	control.EXPECT().CancelEffect(gomock.Any(), id).Return(snapshot, nil)
	w = transitionRequest(h, settings, http.MethodPost, "effect/cancel/"+id)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "completed", transitionResponse(t, w)["effect"].(map[string]any)["state"], "terminal receipt does not imply a new cancellation")
}

func TestEffectHTTPInvalidRequestsNeverReachController(t *testing.T) {
	for _, test := range []struct {
		method, path string
		status       int
	}{
		{http.MethodHead, "preset/evening", 405},
		{http.MethodHead, "effect", 405},
		{http.MethodPost, "effect", 405},
		{http.MethodGet, "effect/cancel/" + strings.Repeat("a", 32), 405},
		{http.MethodPut, "effect/cancel/" + strings.Repeat("a", 32), 405},
		{http.MethodPost, "effect/cancel/invalid", 400},
		{http.MethodPost, "effect/cancel/" + strings.Repeat("A", 32), 400},
		{http.MethodPost, "effect/other/" + strings.Repeat("a", 32), 400},
		{http.MethodPost, "effect/cancel/" + strings.Repeat("a", 32) + "/extra", 404},
		{http.MethodGet, "effect?extra=1", 400},
		{http.MethodPost, "preset/missing", 400},
	} {
		t.Run(test.method+"/"+test.path, func(t *testing.T) {
			h, _, settings := effectHandler(t, effectPreset())
			w := transitionRequest(h, settings, test.method, test.path)
			assert.Equal(t, test.status, w.Code)
		})
	}
	h, _, settings := effectHandler(t, effectPreset())
	for _, route := range []string{"effect", "effect/cancel/" + strings.Repeat("a", 32), "preset/evening"} {
		for _, modification := range []string{"body", "host", "token"} {
			t.Run(route+"/"+modification, func(t *testing.T) {
				r := httptest.NewRequest(http.MethodPost, "http://"+settings.Address()+"/"+settings.AccessToken+"/"+route, nil)
				expected := http.StatusBadRequest
				switch modification {
				case "body":
					r = httptest.NewRequest(http.MethodPost, "http://"+settings.Address()+"/"+settings.AccessToken+"/"+route, strings.NewReader("body"))
				case "host":
					r.Host = "remote.invalid:18765"
					expected = http.StatusForbidden
				case "token":
					r.URL.Path = "/wrong/" + route
					expected = http.StatusForbidden
				}
				w := httptest.NewRecorder()
				h.ServeHTTP(w, r)
				assert.Equal(t, expected, w.Code)
			})
		}
	}
	preset := effectPreset()
	preset.Effect.TransitionMS = 0
	h, _, settings = effectHandler(t, preset)
	assert.Equal(t, http.StatusBadRequest, transitionRequest(h, settings, http.MethodPost, "preset/evening").Code)
}

func TestEffectHTTPUnavailableAndUnknownFailuresAreSafe(t *testing.T) {
	for _, test := range []struct {
		err    error
		status int
	}{
		{fmt.Errorf("wrapped: %w", protocol.ErrEffectNotFound), http.StatusNotFound},
		{context.Canceled, http.StatusGatewayTimeout},
		{context.DeadlineExceeded, http.StatusGatewayTimeout},
		{errors.New("unsafe secret and native path"), http.StatusServiceUnavailable},
	} {
		for _, start := range []bool{false, true} {
			t.Run(fmt.Sprintf("%d/start=%t", test.status, start), func(t *testing.T) {
				h, control, settings := effectHandler(t, effectPreset())
				path := "effect/cancel/" + strings.Repeat("a", 32)
				if start {
					control.EXPECT().StartEffect(gomock.Any(), gomock.Any()).Return(protocol.EffectSnapshot{}, test.err)
					path = "preset/evening"
				} else {
					control.EXPECT().CancelEffect(gomock.Any(), strings.Repeat("a", 32)).Return(protocol.EffectSnapshot{}, test.err)
				}
				w := transitionRequest(h, settings, http.MethodPost, path)
				assert.Equal(t, test.status, w.Code)
				assert.NotContains(t, w.Body.String(), "unsafe secret")
				assert.NotContains(t, w.Body.String(), settings.AccessToken)
				assert.Equal(t, false, transitionResponse(t, w)["physical_state_verified"])
			})
		}
	}
	for _, route := range []string{"preset/evening", "effect", "effect/cancel/" + strings.Repeat("a", 32)} {
		_, _, settings := effectHandler(t, effectPreset())
		ordinary := NewMockController(gomock.NewController(t))
		h := bridge.New(settings, map[string]protocol.Preset{"evening": effectPreset()}, ordinary)
		method := http.MethodPost
		if route == "effect" {
			method = http.MethodGet
		}
		assert.Equal(t, http.StatusServiceUnavailable, transitionRequest(h, settings, method, route).Code)
	}
}
