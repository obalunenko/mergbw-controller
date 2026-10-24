package bridge

import (
	"context"
	"errors"
	"net/http"
	"regexp"

	"github.com/obalunenko/mergbw-controller/internal/protocol"
)

// EffectController adds dynamic presets without changing ordinary Controller clients.
type EffectController interface {
	Controller
	StartEffect(context.Context, protocol.EffectAction) (protocol.EffectSnapshot, error)
	EffectStatus() *protocol.EffectSnapshot
	CancelEffect(context.Context, string) (protocol.EffectSnapshot, error)
}

var effectIDPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

func effectFailure(w http.ResponseWriter, r *http.Request, err error) {
	status, message := http.StatusServiceUnavailable, "эффект недоступен; исход операции неизвестен"
	switch {
	case errors.Is(err, protocol.ErrEffectNotFound):
		status, message = http.StatusNotFound, "эффект не найден"
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		status, message = http.StatusGatewayTimeout, "ожидание завершено; нативная операция может ещё выполняться"
	}
	respond(w, r, status, map[string]any{"error": message, "physical_state_verified": false})
}

func (h *Handler) startEffect(w http.ResponseWriter, r *http.Request, action protocol.Action) {
	control, ok := h.controller.(EffectController)
	if !ok {
		effectFailure(w, r, errors.New("effects unsupported"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), RequestTimeout)
	defer cancel()
	snapshot, err := control.StartEffect(ctx, *action.Effect)
	if err != nil {
		effectFailure(w, r, err)
		return
	}
	respond(w, r, http.StatusAccepted, map[string]any{
		"accepted": true, "action": action.Route, "effect": snapshot, "physical_state_verified": false,
	})
}

func (h *Handler) serveEffect(w http.ResponseWriter, r *http.Request, args []string) bool {
	if len(args) == 0 || args[0] != "effect" {
		return false
	}
	fail := func(status int, message string) {
		respond(w, r, status, map[string]any{"error": message, "physical_state_verified": false})
	}
	statusRequest := len(args) == 1
	cancelRequest := len(args) == 3 && args[1] == "cancel"
	switch {
	case statusRequest:
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			fail(http.StatusMethodNotAllowed, "статус принимает только GET")
			return true
		}
	case cancelRequest:
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			fail(http.StatusMethodNotAllowed, "отмена принимает только POST")
			return true
		}
		if !effectIDPattern.MatchString(args[2]) {
			fail(http.StatusBadRequest, "некорректный идентификатор эффекта")
			return true
		}
	default:
		fail(http.StatusBadRequest, "некорректный адрес эффекта")
		return true
	}
	control, ok := h.controller.(EffectController)
	if !ok {
		effectFailure(w, r, errors.New("effects unsupported"))
		return true
	}
	if statusRequest {
		respond(w, r, http.StatusOK, map[string]any{"effect": control.EffectStatus(), "physical_state_verified": false})
		return true
	}
	ctx, cancel := context.WithTimeout(r.Context(), RequestTimeout)
	defer cancel()
	snapshot, err := control.CancelEffect(ctx, args[2])
	if err != nil {
		effectFailure(w, r, err)
		return true
	}
	respond(w, r, http.StatusOK, map[string]any{"effect": snapshot, "physical_state_verified": false})
	return true
}
