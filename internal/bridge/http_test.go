package bridge_test

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/obalunenko/mergbw-controller/internal/bridge"
	"github.com/obalunenko/mergbw-controller/internal/config"
	"github.com/obalunenko/mergbw-controller/internal/protocol"
)

type fakeController struct {
	actions []protocol.Action
	err     error
}

func (c *fakeController) Connected() bool { return true }
func (c *fakeController) Execute(ctx context.Context, action protocol.Action) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	c.actions = append(c.actions, action)
	return c.err
}

func testHandler() (*bridge.Handler, *fakeController, config.Settings) {
	settings := config.Settings{DeviceIdentity: "AA:BB:CC:DD:EE:FF", Port: config.DefaultPort, AccessToken: "correct_access_token_1234567890123456"}
	controller := &fakeController{}
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
			handler, controller, settings := testHandler()
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, httptest.NewRequest(test.method, settings.BaseURL()+"/"+test.route, nil))
			if recorder.Code != http.StatusOK || len(controller.actions) != 1 {
				t.Fatalf("HTTP %d, calls=%d: %s", recorder.Code, len(controller.actions), recorder.Body.String())
			}
			got := make([]string, len(controller.actions[0].Packets))
			for i, packet := range controller.actions[0].Packets {
				got[i] = hex.EncodeToString(packet)
			}
			if !reflect.DeepEqual(got, test.packets) {
				t.Fatalf("packets=%v, want %v", got, test.packets)
			}
			var result map[string]any
			if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result["physical_state_verified"] != false || result["sent"] != true || recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("incorrect status/cache metadata: %v", result)
			}
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
			handler, controller, settings := testHandler()
			path := strings.ReplaceAll(test.path, "TOKEN", settings.AccessToken)
			request := httptest.NewRequest(test.method, "http://"+settings.Address()+path, strings.NewReader(test.body))
			if test.host != "" {
				request.Host = test.host
			}
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			if recorder.Code != test.status || len(controller.actions) != 0 {
				t.Fatalf("HTTP %d (want %d), calls=%d: %s", recorder.Code, test.status, len(controller.actions), recorder.Body.String())
			}
			if test.method == "HEAD" && recorder.Body.Len() != 0 {
				t.Fatal("HEAD returned a body")
			}
		})
	}
}

func TestHealthAndErrorsDoNotClaimPhysicalState(t *testing.T) {
	handler, controller, settings := testHandler()
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest("GET", "http://"+settings.Address()+"/health", nil))
	if recorder.Code != 200 || len(controller.actions) != 0 || !strings.Contains(recorder.Body.String(), `"physical_state_verified":false`) {
		t.Fatalf("unexpected health response: %s", recorder.Body.String())
	}
	for _, test := range []struct {
		err    error
		status int
	}{{errors.New("BLE unavailable"), 503}, {context.DeadlineExceeded, 504}} {
		controller.err = test.err
		recorder = httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest("GET", settings.BaseURL()+"/off", nil))
		if recorder.Code != test.status || strings.Contains(recorder.Body.String(), `"sent":true`) || !strings.Contains(recorder.Body.String(), `"physical_state_verified":false`) {
			t.Fatalf("incorrect failure response HTTP %d: %s", recorder.Code, recorder.Body.String())
		}
	}
}
