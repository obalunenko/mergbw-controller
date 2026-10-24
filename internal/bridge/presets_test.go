package bridge_test

import (
	"encoding/json"
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

func TestPresetCatalogProjection(t *testing.T) {
	for _, labels := range [][]string{{"Custom", "Custom"}, {"Renamed", "Ночь"}, nil} {
		t.Run(strings.Join(labels, "/"), func(t *testing.T) {
			_, _, settings := testHandler(t)
			lamp := NewMockController(gomock.NewController(t)) // No Execute or Connected calls are permitted.
			presets := map[string]protocol.Preset{}
			if labels != nil {
				presets["sunset"] = protocol.Preset{Label: labels[0], RGB: []int{255, 80, 0}, Brightness: 50}
				presets["night"] = protocol.Preset{Label: labels[1]}
			}
			h := bridge.New(settings, presets, lamp)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, settings.BaseURL()+"/presets", nil))
			require.Equal(t, http.StatusOK, w.Code)
			var got map[string]json.RawMessage
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
			require.Len(t, got, 2)
			assert.JSONEq(t, `false`, string(got["physical_state_verified"]))
			if labels == nil {
				assert.JSONEq(t, `[]`, string(got["presets"]))
			} else {
				expected, err := json.Marshal([]map[string]any{{"id": "night", "label": labels[1], "builtIn": false}, {"id": "sunset", "label": labels[0], "builtIn": false}})
				require.NoError(t, err)
				assert.JSONEq(t, string(expected), string(got["presets"]))
			}
			assert.Equal(t, "no-store", w.Header().Get("Cache-Control"))
			assert.Equal(t, "nosniff", w.Header().Get("X-Content-Type-Options"))
			assert.Contains(t, w.Header().Get("Content-Type"), "application/json")
			assert.NotEmpty(t, w.Header().Get("X-Request-ID"))
			assert.NotEmpty(t, w.Header().Get("Content-Length"))
			assert.NotContains(t, w.Body.String(), settings.AccessToken)
			assert.NotContains(t, w.Body.String(), settings.DeviceIdentity)
		})
	}
}

func TestPresetCatalogSeparatesStockCopiesAndOverrides(t *testing.T) {
	_, _, settings := testHandler(t)
	stock := config.DefaultPresets()
	changed := protocol.ClonePreset(stock["night"])
	changed.Brightness++
	presets := map[string]protocol.Preset{"sunset": stock["sunset"], "night": changed, "my_sunset": stock["sunset"]}
	lamp := NewMockController(gomock.NewController(t))
	h := bridge.New(settings, presets, lamp)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, settings.BaseURL()+"/presets", nil))
	require.Equal(t, http.StatusOK, w.Code)
	assert.JSONEq(t, `{"presets":[{"id":"my_sunset","label":"Закат","builtIn":false},{"id":"night","label":"Ночь","builtIn":false},{"id":"sunset","label":"Закат","builtIn":true}],"physical_state_verified":false}`, w.Body.String())
}

func TestPresetCatalogGuards(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		change func(*http.Request)
	}{
		{"host", 403, func(r *http.Request) { r.Host = "foreign.example" }},
		{"token", 403, func(r *http.Request) { r.URL.Path = "/incorrect/presets" }},
		{"query", 400, func(r *http.Request) { r.URL.RawQuery = "x=1" }},
		{"force query", 400, func(r *http.Request) { r.URL.ForceQuery = true }},
		{"raw path", 400, func(r *http.Request) { r.URL.RawPath = "/escaped/presets" }},
		{"fragment", 400, func(r *http.Request) { r.URL.Fragment = "x" }},
		{"body", 400, func(r *http.Request) { r.ContentLength = 1 }},
		{"chunked", 400, func(r *http.Request) { r.TransferEncoding = []string{"chunked"}; r.ContentLength = -1 }},
		{"head", 405, func(r *http.Request) { r.Method = "HEAD" }},
		{"post", 405, func(r *http.Request) { r.Method = "POST" }},
		{"put", 405, func(r *http.Request) { r.Method = "PUT" }},
		{"delete", 405, func(r *http.Request) { r.Method = "DELETE" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h, _, s := testHandler(t)
			r := httptest.NewRequest("GET", s.BaseURL()+"/presets", nil)
			tc.change(r)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			assert.Equal(t, tc.status, w.Code)
			assert.NotContains(t, w.Body.String(), "Закат")
			assert.Equal(t, "no-store", w.Header().Get("Cache-Control"))
			assert.Equal(t, "nosniff", w.Header().Get("X-Content-Type-Options"))
			assert.NotEmpty(t, w.Header().Get("X-Request-ID"))
			if tc.status == 405 {
				assert.Equal(t, "GET", w.Header().Get("Allow"))
			}
			if r.Method == "HEAD" {
				assert.Empty(t, w.Body.String())
				assert.NotEmpty(t, w.Header().Get("Content-Length"))
			}
		})
	}
}
