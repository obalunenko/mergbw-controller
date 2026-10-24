package bridge_test

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/obalunenko/mergbw-controller/internal/bridge"
	"github.com/obalunenko/mergbw-controller/internal/config"
	"github.com/obalunenko/mergbw-controller/internal/protocol"
)

func testHandler(t *testing.T) (*bridge.Handler, *MockController, config.Settings) {
	t.Helper()
	settings := config.Settings{DeviceIdentity: "AA:BB:CC:DD:EE:FF", Port: config.DefaultPort, AccessToken: "correct_access_token_1234567890123456"}
	controller := NewMockController(gomock.NewController(t))
	presets := map[string]protocol.Preset{"sunset": {Label: "Закат", RGB: []int{255, 80, 0}, Brightness: 50}}
	return bridge.New(settings, presets, controller), controller, settings
}

func TestRoutesPassExpectedPackets(t *testing.T) {
	for _, test := range []struct {
		method  string
		route   string
		packets []string
	}{
		{http.MethodGet, "off", []string{"5501ff0600a3"}},
		{http.MethodPost, "on", []string{"5501ff0601a2"}},
		{http.MethodGet, "preset/sunset", []string{"5501ff0601a2", "5503ff08ff50004f", "5505ff06326d"}},
	} {
		t.Run(test.route, func(t *testing.T) {
			handler, controller, settings := testHandler(t)
			var action protocol.Action
			controller.EXPECT().Execute(gomock.Any(), gomock.Any()).DoAndReturn(func(ctx context.Context, got protocol.Action) error {
				action = got
				return ctx.Err()
			})
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, httptest.NewRequest(test.method, settings.BaseURL()+"/"+test.route, nil))
			require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
			got := make([]string, len(action.Packets))
			for i, packet := range action.Packets {
				got[i] = hex.EncodeToString(packet)
			}
			assert.Equal(t, test.packets, got)
			var result map[string]any
			require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &result))
			assert.Equal(t, false, result["physical_state_verified"])
			assert.Equal(t, true, result["sent"])
			assert.Equal(t, "no-store", recorder.Header().Get("Cache-Control"))
		})
	}
}

func TestRejectedRequestsNeverExecute(t *testing.T) {
	for _, test := range []struct {
		name   string
		method string
		path   string // TOKEN is substituted only in the URL path.
		host   string
		body   string
		status int
	}{
		{"wrong_token", "GET", "/wrong-token/off", "", "", 403},
		{"unicode_token", "GET", "/неверный/off", "", "", 400},
		{"foreign_host", "GET", "/TOKEN/off", "example.com", "", 403},
		{"head", "HEAD", "/TOKEN/off", "", "", 405},
		{"put", "PUT", "/TOKEN/off", "", "", 405},
		{"missing_value", "GET", "/TOKEN/color", "", "", 400},
		{"invalid_color", "GET", "/TOKEN/color/GG0000", "", "", 400},
		{"invalid_brightness", "GET", "/TOKEN/brightness/101", "", "", 400},
		{"unknown_preset", "GET", "/TOKEN/preset/missing", "", "", 400},
		{"encoded_path", "GET", "/TOKEN/%6fff", "", "", 400},
		{"query", "GET", "/TOKEN/off?x=1", "", "", 400},
		{"empty_query", "GET", "/TOKEN/off?", "", "", 400},
		{"trailing_slash", "GET", "/TOKEN/off/", "", "", 400},
		{"body", "POST", "/TOKEN/off", "", "ignored", 400},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler, _, settings := testHandler(t)
			path := strings.ReplaceAll(test.path, "TOKEN", settings.AccessToken)
			request := httptest.NewRequest(test.method, "http://"+settings.Address()+path, strings.NewReader(test.body))
			if test.host != "" {
				request.Host = test.host
			}
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			assert.Equal(t, test.status, recorder.Code, recorder.Body.String())
			// An unexpected Execute fails the generated mock's strict expectations.
			if test.method == "HEAD" {
				assert.Empty(t, recorder.Body.String())
			}
		})
	}
}

func TestHealthAndErrorsDoNotClaimPhysicalState(t *testing.T) {
	handler, controller, settings := testHandler(t)
	controller.EXPECT().Connected().Return(true)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest("GET", "http://"+settings.Address()+"/health", nil))
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"physical_state_verified":false`)
	for _, test := range []struct {
		err    error
		status int
	}{{errors.New("BLE unavailable"), 503}, {context.DeadlineExceeded, 504}} {
		controller.EXPECT().Execute(gomock.Any(), gomock.Any()).Return(test.err)
		recorder = httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest("GET", settings.BaseURL()+"/off", nil))
		assert.Equal(t, test.status, recorder.Code)
		assert.NotContains(t, recorder.Body.String(), `"sent":true`)
		assert.Contains(t, recorder.Body.String(), `"physical_state_verified":false`)
	}
}

func TestManagedRecoveryKeepsLoopbackMethodsRequestIDsAndSafeFailures(t *testing.T) {
	handler, controller, settings := testHandler(t)
	hostile := errors.New("native /private/source/settings.json https://127.0.0.1/" + settings.AccessToken + "/on")
	for index, method := range []string{http.MethodGet, http.MethodPost, http.MethodHead} {
		request := httptest.NewRequest(method, settings.BaseURL()+"/on", nil)
		request.Header.Set("X-Request-ID", settings.AccessToken)
		if method != http.MethodHead {
			controller.EXPECT().Execute(gomock.Any(), gomock.Any()).Return(hostile)
		}
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		assert.Equal(t, []string{"1", "2", "3"}[index], recorder.Header().Get("X-Request-ID"))
		assert.NotContains(t, recorder.Body.String(), settings.AccessToken)
		assert.NotContains(t, recorder.Body.String(), "settings.json")
		if method == http.MethodHead {
			assert.Equal(t, 405, recorder.Code)
			assert.Empty(t, recorder.Body.String())
		} else {
			assert.Equal(t, 503, recorder.Code)
			assert.Contains(t, recorder.Body.String(), `"physical_state_verified":false`)
		}
	}
	foreign := httptest.NewRequest(http.MethodPost, settings.BaseURL()+"/on", nil)
	foreign.Host = "foreign.invalid"
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, foreign)
	assert.Equal(t, http.StatusForbidden, recorder.Code)
}

func TestUnknownPresetDoesNotExposeTokenLookingCatalogIDs(t *testing.T) {
	_, controller, settings := testHandler(t)
	handler := bridge.New(settings, map[string]protocol.Preset{settings.AccessToken: {Label: "Fixture", RGB: []int{1, 2, 3}, Brightness: 20}}, controller)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, settings.BaseURL()+"/preset/missing", nil))
	assert.Equal(t, http.StatusBadRequest, recorder.Code)
	assert.NotContains(t, recorder.Body.String(), settings.AccessToken)
	assert.Contains(t, recorder.Body.String(), `"physical_state_verified":false`)
}
