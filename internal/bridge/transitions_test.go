package bridge_test

import (
	"context"
	"encoding/json/v2"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/obalunenko/mergbw-controller/internal/bridge"
	"github.com/obalunenko/mergbw-controller/internal/config"
	"github.com/obalunenko/mergbw-controller/internal/controller"
	"github.com/obalunenko/mergbw-controller/internal/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

func transitionHandler(t *testing.T) (*bridge.Handler, *MockTransitionController, config.Settings) {
	t.Helper()
	settings := config.Settings{DeviceIdentity: "AA:BB:CC:DD:EE:FF", Port: 18765, AccessToken: "transition_test_token_1234567890"}
	control := NewMockTransitionController(gomock.NewController(t))
	return bridge.New(settings, nil, control), control, settings
}

func transitionRequest(h *bridge.Handler, settings config.Settings, method, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(method, "http://"+settings.Address()+"/"+settings.AccessToken+"/"+path, nil)
	h.ServeHTTP(w, r)
	return w
}

func transitionResponse(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var value map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &value))
	return value
}

func TestTransitionHTTPStartAcceptedAndCanonical(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		h, control, settings := transitionHandler(t)
		snapshot := protocol.TransitionSnapshot{ID: strings.Repeat("a", 32), State: "running", DurationMS: 60000}
		var requestContext context.Context
		control.EXPECT().StartTransition(gomock.Any(), protocol.Transition{FromRGB: [3]int{255, 80, 0}, FromBrightness: 100, ToRGB: [3]int{0, 0, 255}, ToBrightness: 0, DurationSeconds: 60}).DoAndReturn(func(ctx context.Context, _ protocol.Transition) (protocol.TransitionSnapshot, error) {
			requestContext = ctx
			return snapshot, nil
		})
		w := transitionRequest(h, settings, method, "transition/ff5000/100/0000ff/0/60")
		require.Equal(t, http.StatusAccepted, w.Code)
		value := transitionResponse(t, w)
		assert.Equal(t, true, value["accepted"])
		assert.NotContains(t, value, "sent")
		assert.Equal(t, "transition/FF5000/100/0000FF/0/60", value["action"])
		assert.Equal(t, false, value["physical_state_verified"])
		assert.ErrorIs(t, requestContext.Err(), context.Canceled, "HTTP request context closes after acceptance; job must use controller root")
	}
}

func TestTransitionHTTPInvalidRequestsNeverCallController(t *testing.T) {
	for _, test := range []struct {
		method, path string
		status       int
	}{
		{"POST", "transition/FF5000/100/000000/0/0", 400},
		{"POST", "transition/FF5000/100/000000/0/61", 400},
		{"POST", "transition/FFXX00/100/000000/0/30", 400},
		{"POST", "transition/FF5000/101/000000/0/30", 400},
		{"HEAD", "transition/FF5000/100/000000/0/30", 405},
		{"POST", "transition", 405},
		{"GET", "transition/cancel/" + strings.Repeat("a", 32), 405},
		{"POST", "transition/cancel/invalid", 400},
		{"POST", "transition/FF5000/100/000000/0/30?extra=1", 400},
	} {
		h, _, settings := transitionHandler(t)
		w := transitionRequest(h, settings, test.method, test.path)
		assert.Equal(t, test.status, w.Code, test.path)
	}
	h, _, settings := transitionHandler(t)
	r := httptest.NewRequest("POST", "http://"+settings.Address()+"/"+settings.AccessToken+"/transition/FF5000/100/000000/0/30", strings.NewReader("body"))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	assert.Equal(t, 400, w.Code)
	r = httptest.NewRequest("POST", "http://"+settings.Address()+"/wrong/transition/FF5000/100/000000/0/30", nil)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	assert.Equal(t, 403, w.Code)
}

func TestTransitionHTTPReadOnlyAndCancellation(t *testing.T) {
	h, control, settings := transitionHandler(t)
	control.EXPECT().TransitionStatus().Return(nil)
	w := transitionRequest(h, settings, "GET", "transition")
	require.Equal(t, 200, w.Code)
	assert.Nil(t, transitionResponse(t, w)["transition"])
	id := strings.Repeat("a", 32)
	snapshot := protocol.TransitionSnapshot{ID: id, State: "cancelled", ElapsedMS: 250, DurationMS: 1000}
	control.EXPECT().CancelTransition(gomock.Any(), id).Return(snapshot, nil)
	w = transitionRequest(h, settings, "POST", "transition/cancel/"+id)
	require.Equal(t, 200, w.Code)
	assert.Equal(t, "cancelled", transitionResponse(t, w)["transition"].(map[string]any)["state"])
}

func TestTransitionHTTPFailuresAreSafe(t *testing.T) {
	for _, test := range []struct {
		err    error
		status int
	}{
		{protocol.ErrTransitionNotFound, 404},
		{context.DeadlineExceeded, 504},
		{errors.New("unsafe token and native path"), 503},
	} {
		h, control, settings := transitionHandler(t)
		id := strings.Repeat("a", 32)
		control.EXPECT().CancelTransition(gomock.Any(), id).Return(protocol.TransitionSnapshot{}, test.err)
		w := transitionRequest(h, settings, "POST", "transition/cancel/"+id)
		assert.Equal(t, test.status, w.Code)
		assert.NotContains(t, w.Body.String(), "unsafe token")
		assert.NotContains(t, w.Body.String(), settings.AccessToken)
	}
}

func TestAcceptedTransitionOutlivesHTTPRequestAndCancelsOnNewCommand(t *testing.T) {
	link := NewMockLink(gomock.NewController(t))
	root, stop := context.WithCancel(t.Context())
	defer stop()
	lamp := controller.NewWithContext(root, link)
	settings := config.Settings{DeviceIdentity: "AA:BB:CC:DD:EE:FF", Port: 18765, AccessToken: "transition_test_token_1234567890"}
	h := bridge.New(settings, nil, lamp)
	entered, release := make(chan struct{}), make(chan struct{})
	link.EXPECT().Connect(gomock.Any()).Return(nil).Times(2)
	first := link.EXPECT().Write(gomock.Any(), gomock.Any()).DoAndReturn(func(ctx context.Context, _ []byte) error {
		assert.NoError(t, ctx.Err(), "accepted job survives handler context cancellation")
		close(entered)
		<-release
		return nil
	})
	brightness, _ := protocol.Resolve([]string{"brightness", "25"}, nil)
	second := link.EXPECT().Write(gomock.Any(), brightness.Packets[0]).After(first).Return(nil)
	link.EXPECT().Write(gomock.Any(), brightness.Packets[1]).After(second).Return(nil)
	w := transitionRequest(h, settings, "POST", "transition/FF5000/100/000000/0/60")
	require.Equal(t, 202, w.Code)
	select {
	case <-entered:
	case <-t.Context().Done():
		t.Fatal("native write did not begin")
	}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- transitionRequest(h, settings, "POST", "brightness/25") }()
	require.Eventually(t, func() bool { return lamp.TransitionStatus().State == "cancelling" }, time.Second, time.Millisecond)
	select {
	case <-done:
		t.Fatal("new command did not wait for native write")
	default:
	}
	close(release)
	select {
	case result := <-done:
		assert.Equal(t, 200, result.Code)
	case <-time.After(2 * time.Second):
		t.Fatal("replacement never completed")
	}
	assert.Equal(t, "unknown", lamp.TransitionStatus().State)
}
