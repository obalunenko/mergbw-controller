// Package bridge exposes the same local URLs as the previous Python controller.
package bridge

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/obalunenko/mergbw-controller/internal/config"
	"github.com/obalunenko/mergbw-controller/internal/logging"
	"github.com/obalunenko/mergbw-controller/internal/protocol"
)

const Version = "2.0.0-go"
const RequestTimeout = 35 * time.Second

type Controller interface {
	Execute(context.Context, protocol.Action) error
	Connected() bool
}

type Handler struct {
	settings   config.Settings
	presets    map[string]protocol.Preset
	controller Controller
	requestID  atomic.Uint64
}

func New(settings config.Settings, presets map[string]protocol.Preset, controller Controller) *Handler {
	return &Handler{settings: settings, presets: presets, controller: controller}
}

func respond(w http.ResponseWriter, r *http.Request, status int, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		logging.FromContext(r.Context()).ErrorContext(r.Context(), "http.response.failed", "component", "http", "error", err)
		status = http.StatusInternalServerError
		data = []byte(`{"error":"JSON encoding failed"}`)
	}
	data = append(data, '\n')
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		if _, writeErr := w.Write(data); writeErr != nil {
			logging.FromContext(r.Context()).ErrorContext(r.Context(), "http.response.failed", "component", "http", "http_status", status, "error", writeErr)
			return errors.Join(err, writeErr)
		}
	}
	return err
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	requestID := h.requestID.Add(1)
	requestLogger := logging.FromContext(r.Context()).With("request_id", requestID)
	r = r.WithContext(logging.WithLogger(r.Context(), requestLogger))
	w.Header().Set("X-Request-ID", strconv.FormatUint(requestID, 10))
	logger := requestLogger.With("component", "http")
	var command string
	fail := func(status int, message string) {
		level, event := slog.LevelWarn, "http.request.rejected"
		if status >= 500 {
			level, event = slog.LevelError, "http.request.failed"
		}
		fields := []any{"http_status", status, "error", message, "duration_ms", time.Since(started).Milliseconds()}
		if command != "" {
			fields = append(fields, "command", command)
		}
		// Never log the raw path, query, Host or rejected parameters: the URL
		// contains the access token and untrusted values can repeat it elsewhere.
		logger.Log(r.Context(), level, event, fields...)
		respond(w, r, status, map[string]any{"error": message, "physical_state_verified": false})
	}
	host := strings.ToLower(r.Host)
	if host != h.settings.Address() && host != fmt.Sprintf("localhost:%d", h.settings.Port) {
		fail(http.StatusForbidden, "допускается только локальный адрес контроллера")
		return
	}
	if r.URL.RawQuery != "" || r.URL.ForceQuery || r.URL.RawPath != "" || r.URL.Fragment != "" {
		fail(http.StatusBadRequest, "используйте ссылку из streamdeck-buttons.txt без дополнительных параметров")
		return
	}
	// Catalog dispatch precedes legacy command method handling. It never calls
	// the controller, including its connection-status accessor.
	catalogPath := strings.Split(r.URL.Path, "/")
	if len(catalogPath) == 3 && catalogPath[0] == "" && catalogPath[2] == "presets" {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			fail(http.StatusMethodNotAllowed, "каталог принимает только GET")
			return
		}
		if r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
			fail(http.StatusBadRequest, "каталог не принимает тело запроса")
			return
		}
		if subtle.ConstantTimeCompare([]byte(catalogPath[1]), []byte(h.settings.AccessToken)) != 1 {
			fail(http.StatusForbidden, "неверная ссылка; используйте streamdeck-buttons.txt")
			return
		}
		if err := respond(w, r, http.StatusOK, presetCatalog(h.presets)); err == nil {
			logger.InfoContext(r.Context(), "http.presets.completed", "http_status", http.StatusOK, "duration_ms", time.Since(started).Milliseconds())
		}
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodPost && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, POST")
		fail(http.StatusMethodNotAllowed, "команды принимают GET или POST")
		return
	}
	if r.URL.Path == "/health" {
		respond(w, r, http.StatusOK, map[string]any{
			"ok": true, "version": Version, "bluetooth_connected": h.controller.Connected(),
			"physical_state_verified": false,
		})
		return
	}
	if r.Method == http.MethodHead {
		w.Header().Set("Allow", "GET, POST")
		fail(http.StatusMethodNotAllowed, "HEAD не выполняет команды; используйте GET или POST")
		return
	}
	if r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
		fail(http.StatusBadRequest, "команда задаётся в URL; тело запроса не используется")
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/"), "/")
	if len(parts) != 2 && len(parts) != 3 && !(len(parts) > 1 && parts[1] == "transition" && (len(parts) == 4 || len(parts) == 7)) && !(len(parts) == 4 && parts[1] == "effect") {
		fail(http.StatusNotFound, "неизвестный адрес команды")
		return
	}
	if subtle.ConstantTimeCompare([]byte(parts[0]), []byte(h.settings.AccessToken)) != 1 {
		fail(http.StatusForbidden, "неверная ссылка; используйте streamdeck-buttons.txt")
		return
	}
	if h.serveTransition(w, r, parts[1:]) {
		return
	}
	if h.serveEffect(w, r, parts[1:]) {
		return
	}
	action, err := protocol.Resolve(parts[1:], h.presets)
	if err != nil {
		fail(http.StatusBadRequest, "некорректная команда или параметр")
		return
	}
	if action.Effect != nil {
		h.startEffect(w, r, action)
		return
	}
	command = action.Route
	logger.InfoContext(r.Context(), "command.received", "command", command, "method", r.Method, "packet_count", len(action.Packets), "identity", h.settings.DeviceIdentity)
	ctx, cancel := context.WithTimeout(r.Context(), RequestTimeout)
	defer cancel()
	// Do not detach the native BLE write on timeout: it may still be in progress.
	if err := h.controller.Execute(ctx, action); err != nil {
		status := http.StatusServiceUnavailable
		message := "ошибка контроллера или Bluetooth; исход команды неизвестен"
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			status = http.StatusGatewayTimeout
			message = "ожидание операции завершено; возможен поздний эффект"
		}
		fail(status, message)
		return
	}
	if err := respond(w, r, http.StatusOK, map[string]any{
		"sent": true, "action": action.Route, "physical_state_verified": false,
	}); err != nil {
		return
	}
	logger.InfoContext(r.Context(), "http.request.completed", "command", command, "http_status", http.StatusOK, "duration_ms", time.Since(started).Milliseconds())
}
