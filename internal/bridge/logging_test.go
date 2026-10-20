package bridge_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/obalunenko/mergbw-controller/internal/bridge"
	"github.com/obalunenko/mergbw-controller/internal/controller"
	"github.com/obalunenko/mergbw-controller/internal/logging"
	"github.com/obalunenko/mergbw-controller/internal/protocol"
)

type loggingLink struct{}

func (*loggingLink) Connect(context.Context) error       { return nil }
func (*loggingLink) Write(context.Context, []byte) error { return nil }
func (*loggingLink) Connected() bool                     { return true }
func (*loggingLink) Close() error                        { return nil }
func (*loggingLink) CanRetry(error) bool                 { return false }

func captureRequest(request *http.Request, output *bytes.Buffer, secret string) *http.Request {
	logger := slog.New(slog.NewJSONHandler(output, &slog.HandlerOptions{ReplaceAttr: logging.RedactSecrets(secret)}))
	return request.WithContext(logging.WithLogger(request.Context(), logger))
}

func readLogRecords(t *testing.T, output *bytes.Buffer) []map[string]any {
	t.Helper()
	var records []map[string]any
	decoder := json.NewDecoder(bytes.NewReader(output.Bytes()))
	for {
		var record map[string]any
		if err := decoder.Decode(&record); errors.Is(err, io.EOF) {
			return records
		} else if err != nil {
			t.Fatal(err)
		}
		records = append(records, record)
	}
}

func TestRequestIDConnectsReceivedCommandPacketsAndResult(t *testing.T) {
	_, _, settings := testHandler()
	lamp := controller.New(&loggingLink{})
	handler := bridge.New(settings, map[string]protocol.Preset{
		"sunset": {RGB: []int{255, 80, 0}, Brightness: 60},
	}, lamp)
	var output bytes.Buffer
	request := captureRequest(httptest.NewRequest("GET", settings.BaseURL()+"/preset/sunset", nil), &output, settings.AccessToken)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("HTTP %d: %s", recorder.Code, recorder.Body.String())
	}
	requestID, err := strconv.ParseUint(recorder.Header().Get("X-Request-ID"), 10, 64)
	if err != nil || requestID == 0 {
		t.Fatalf("missing request ID: %v", recorder.Header())
	}
	records := readLogRecords(t, &output)
	var events, packets []string
	for _, record := range records {
		events = append(events, record["msg"].(string))
		if record["request_id"] != float64(requestID) || record["command"] != "preset/sunset" {
			t.Fatalf("request correlation/command lost: %v", record)
		}
		if record["msg"] == "packet.sent" {
			packets = append(packets, record["packet_hex"].(string))
		}
	}
	if want := []string{"command.received", "packet.sent", "packet.sent", "packet.sent", "command.sent", "http.request.completed"}; !reflect.DeepEqual(events, want) {
		t.Fatalf("event order = %v, want %v", events, want)
	}
	if want := []string{"5501FF0601A2", "5503FF08FF50004F", "5505FF063C63"}; !reflect.DeepEqual(packets, want) {
		t.Fatalf("logged packets = %v, want %v", packets, want)
	}
	if records[0]["identity"] != settings.DeviceIdentity || records[0]["packet_count"] != float64(3) {
		t.Fatalf("received command lacks target or packet count: %v", records[0])
	}
	last := records[len(records)-1]
	if last["http_status"] != float64(200) || last["duration_ms"] == nil {
		t.Fatalf("completion lacks status/duration: %v", last)
	}
	if strings.Contains(output.String(), settings.AccessToken) || strings.Contains(output.String(), settings.BaseURL()) {
		t.Fatal("command logs contain the secret URL")
	}
	// A later command must be distinguishable even when it uses the same route.
	output.Reset()
	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, captureRequest(httptest.NewRequest("GET", settings.BaseURL()+"/off", nil), &output, settings.AccessToken))
	if recorder.Header().Get("X-Request-ID") == strconv.FormatUint(requestID, 10) {
		t.Fatal("two requests reused the same ID")
	}
}

func TestRequestFailureLogsStatusErrorAndDuration(t *testing.T) {
	for _, status := range []int{http.StatusServiceUnavailable, http.StatusGatewayTimeout} {
		t.Run(strconv.Itoa(status), func(t *testing.T) {
			handler, lamp, settings := testHandler()
			lamp.err = errors.New("BLE unavailable: " + settings.AccessToken)
			if status == http.StatusGatewayTimeout {
				lamp.err = context.DeadlineExceeded
			}
			var output bytes.Buffer
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, captureRequest(httptest.NewRequest("GET", settings.BaseURL()+"/off", nil), &output, settings.AccessToken))
			records := readLogRecords(t, &output)
			if recorder.Code != status || len(records) != 2 || records[0]["msg"] != "command.received" {
				t.Fatalf("unexpected response/logs: HTTP %d, %v", recorder.Code, records)
			}
			failure := records[1]
			if failure["msg"] != "http.request.failed" || failure["level"] != "ERROR" || failure["http_status"] != float64(status) || failure["error"] == nil || failure["duration_ms"] == nil || failure["command"] != "off" {
				t.Fatalf("incomplete failure log: %v", failure)
			}
			if strings.Contains(output.String(), settings.AccessToken) {
				t.Fatal("error text exposed access token")
			}
		})
	}
}

func TestRejectedRequestsDoNotLogSecretURLOrRawParameters(t *testing.T) {
	for _, route := range []string{"/TOKEN/color/PRIVATE_VALUE", "/TOKEN/off?secret=PRIVATE_VALUE", "/PRIVATE_VALUE/off", "/TOKEN/off/extra/path"} {
		t.Run(route, func(t *testing.T) {
			handler, lamp, settings := testHandler()
			path := strings.ReplaceAll(route, "TOKEN", settings.AccessToken)
			var output bytes.Buffer
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, captureRequest(httptest.NewRequest("GET", "http://"+settings.Address()+path, nil), &output, settings.AccessToken))
			records := readLogRecords(t, &output)
			if len(lamp.actions) != 0 || len(records) != 1 || records[0]["msg"] != "http.request.rejected" || records[0]["level"] != "WARN" || records[0]["http_status"] != float64(recorder.Code) {
				t.Fatalf("rejected request logs = %v; calls = %d", records, len(lamp.actions))
			}
			for _, sensitive := range []string{settings.AccessToken, "PRIVATE_VALUE", "http://"} {
				if strings.Contains(output.String(), sensitive) {
					t.Fatalf("rejected request exposed %q", sensitive)
				}
			}
		})
	}
}

type failedResponseWriter struct{ *httptest.ResponseRecorder }

func (failedResponseWriter) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }

func TestHealthIsQuietButResponseWriteFailuresAreLogged(t *testing.T) {
	handler, _, settings := testHandler()
	var output bytes.Buffer
	request := captureRequest(httptest.NewRequest("GET", "http://"+settings.Address()+"/health", nil), &output, settings.AccessToken)
	handler.ServeHTTP(httptest.NewRecorder(), request)
	if output.Len() != 0 {
		t.Fatalf("successful health check produced noise: %s", output.String())
	}
	handler.ServeHTTP(failedResponseWriter{httptest.NewRecorder()}, request)
	records := readLogRecords(t, &output)
	if len(records) != 1 || records[0]["msg"] != "http.response.failed" || records[0]["level"] != "ERROR" || records[0]["error"] != io.ErrClosedPipe.Error() {
		t.Fatalf("response write error was not logged: %v", records)
	}
}
