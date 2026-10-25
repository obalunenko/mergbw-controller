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
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/obalunenko/mergbw-controller/internal/bridge"
	"github.com/obalunenko/mergbw-controller/internal/controller"
	"github.com/obalunenko/mergbw-controller/internal/logging"
	"github.com/obalunenko/mergbw-controller/internal/protocol"
)

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
		} else {
			require.NoError(t, err)
		}
		records = append(records, record)
	}
}

func TestRequestIDConnectsReceivedCommandPacketsAndResult(t *testing.T) {
	_, _, settings := testHandler(t)
	link := NewMockLink(gomock.NewController(t))
	link.EXPECT().Connect(gomock.Any()).Return(nil).Times(2)
	link.EXPECT().Write(gomock.Any(), gomock.Any()).Return(nil).Times(4)
	lamp := controller.New(link)
	handler := bridge.New(settings, map[string]protocol.Preset{
		"sunset": {RGB: []int{255, 80, 0}, Brightness: 60},
	}, lamp)
	var output bytes.Buffer
	request := captureRequest(httptest.NewRequest("GET", settings.BaseURL()+"/preset/sunset", nil), &output, settings.AccessToken)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	requestID, err := strconv.ParseUint(recorder.Header().Get("X-Request-ID"), 10, 64)
	require.NoError(t, err)
	require.NotZero(t, requestID)
	records := readLogRecords(t, &output)
	var events, packets []string
	for _, record := range records {
		events = append(events, record["msg"].(string))
		assert.Equal(t, float64(requestID), record["request_id"])
		assert.Equal(t, "preset/sunset", record["command"])
		if record["msg"] == "packet.sent" {
			packets = append(packets, record["packet_hex"].(string))
		}
	}
	require.Equal(t, []string{"command.received", "packet.sent", "packet.sent", "packet.sent", "command.sent", "http.request.completed"}, events)
	assert.Equal(t, []string{"5501FF0601A2", "5503FF08FF50004F", "5505FF063C63"}, packets)
	assert.Equal(t, settings.DeviceIdentity, records[0]["identity"])
	assert.Equal(t, float64(3), records[0]["packet_count"])
	last := records[len(records)-1]
	assert.Equal(t, float64(200), last["http_status"])
	assert.NotNil(t, last["duration_ms"])
	assert.NotContains(t, output.String(), settings.AccessToken)
	assert.NotContains(t, output.String(), settings.BaseURL())
	// A later command must be distinguishable even when it uses the same route.
	output.Reset()
	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, captureRequest(httptest.NewRequest("GET", settings.BaseURL()+"/off", nil), &output, settings.AccessToken))
	assert.NotEqual(t, strconv.FormatUint(requestID, 10), recorder.Header().Get("X-Request-ID"))
}

func TestSceneRequestLogsCommandAndPacketCountWithoutSecrets(t *testing.T) {
	handler, lamp, settings := testHandler(t)
	lamp.EXPECT().Execute(gomock.Any(), gomock.Any()).Return(nil)
	var output bytes.Buffer
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, captureRequest(httptest.NewRequest(http.MethodGet, settings.BaseURL()+"/scene/disco", nil), &output, settings.AccessToken))
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	records := readLogRecords(t, &output)
	require.NotEmpty(t, records)
	assert.Equal(t, "command.received", records[0]["msg"])
	assert.Equal(t, "scene/disco", records[0]["command"])
	assert.Equal(t, float64(2), records[0]["packet_count"])
	assert.NotContains(t, output.String(), settings.AccessToken)
	assert.NotContains(t, output.String(), settings.BaseURL())
}

func TestRequestFailureLogsStatusErrorAndDuration(t *testing.T) {
	for _, status := range []int{http.StatusServiceUnavailable, http.StatusGatewayTimeout} {
		t.Run(strconv.Itoa(status), func(t *testing.T) {
			handler, lamp, settings := testHandler(t)
			fault := errors.New("BLE unavailable: " + settings.AccessToken)
			if status == http.StatusGatewayTimeout {
				fault = context.DeadlineExceeded
			}
			lamp.EXPECT().Execute(gomock.Any(), gomock.Any()).Return(fault)
			var output bytes.Buffer
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, captureRequest(httptest.NewRequest("GET", settings.BaseURL()+"/off", nil), &output, settings.AccessToken))
			records := readLogRecords(t, &output)
			assert.Equal(t, status, recorder.Code)
			require.Len(t, records, 2)
			assert.Equal(t, "command.received", records[0]["msg"])
			failure := records[1]
			assert.Equal(t, "http.request.failed", failure["msg"])
			assert.Equal(t, "ERROR", failure["level"])
			assert.Equal(t, float64(status), failure["http_status"])
			assert.NotNil(t, failure["error"])
			assert.NotNil(t, failure["duration_ms"])
			assert.Equal(t, "off", failure["command"])
			assert.NotContains(t, output.String(), settings.AccessToken)
		})
	}
}

func TestRejectedRequestsDoNotLogSecretURLOrRawParameters(t *testing.T) {
	for _, route := range []string{"/TOKEN/color/PRIVATE_VALUE", "/TOKEN/off?secret=PRIVATE_VALUE", "/PRIVATE_VALUE/off", "/TOKEN/off/extra/path"} {
		t.Run(route, func(t *testing.T) {
			handler, _, settings := testHandler(t)
			path := strings.ReplaceAll(route, "TOKEN", settings.AccessToken)
			var output bytes.Buffer
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, captureRequest(httptest.NewRequest("GET", "http://"+settings.Address()+path, nil), &output, settings.AccessToken))
			records := readLogRecords(t, &output)
			require.Len(t, records, 1)
			assert.Equal(t, "http.request.rejected", records[0]["msg"])
			assert.Equal(t, "WARN", records[0]["level"])
			assert.Equal(t, float64(recorder.Code), records[0]["http_status"])
			for _, sensitive := range []string{settings.AccessToken, "PRIVATE_VALUE", "http://"} {
				assert.NotContains(t, output.String(), sensitive)
			}
		})
	}
}

func TestHealthIsQuietButResponseWriteFailuresAreLogged(t *testing.T) {
	handler, lamp, settings := testHandler(t)
	lamp.EXPECT().Connected().Return(true).Times(2)
	var output bytes.Buffer
	request := captureRequest(httptest.NewRequest("GET", "http://"+settings.Address()+"/health", nil), &output, settings.AccessToken)
	handler.ServeHTTP(httptest.NewRecorder(), request)
	assert.Empty(t, output.String())

	writer := NewMockResponseWriter(gomock.NewController(t))
	writer.EXPECT().Header().Return(make(http.Header)).AnyTimes()
	writer.EXPECT().WriteHeader(http.StatusOK)
	writer.EXPECT().Write(gomock.Any()).Return(0, io.ErrClosedPipe)
	handler.ServeHTTP(writer, request)
	records := readLogRecords(t, &output)
	require.Len(t, records, 1)
	assert.Equal(t, "http.response.failed", records[0]["msg"])
	assert.Equal(t, "ERROR", records[0]["level"])
	assert.Equal(t, io.ErrClosedPipe.Error(), records[0]["error"])
}

func TestPresetCatalogLogsNoCommandOrPrivateInputs(t *testing.T) {
	handler, _, settings := testHandler(t)
	var output bytes.Buffer
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, captureRequest(httptest.NewRequest(http.MethodGet, settings.BaseURL()+"/presets", nil), &output, settings.AccessToken))
	require.Equal(t, http.StatusOK, recorder.Code)
	records := readLogRecords(t, &output)
	require.Len(t, records, 1)
	assert.Equal(t, "http.presets.completed", records[0]["msg"])
	assert.NotNil(t, records[0]["duration_ms"])
	for _, sensitive := range []string{settings.AccessToken, settings.BaseURL(), settings.DeviceIdentity, "command.sent", "command.received", "rgb", "brightness", "label"} {
		assert.NotContains(t, output.String(), sensitive)
	}
}
