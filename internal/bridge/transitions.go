package bridge

import (
	"context"
	"errors"
	"net/http"
	"regexp"

	"github.com/obalunenko/mergbw-controller/internal/protocol"
)

// TransitionController is optional; existing ordinary Controller contracts stay intact.
type TransitionController interface {
	Controller
	StartTransition(context.Context, protocol.Transition) (protocol.TransitionSnapshot, error)
	TransitionStatus() *protocol.TransitionSnapshot
	CancelTransition(context.Context, string) (protocol.TransitionSnapshot, error)
}

var transitionIDPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

func (h *Handler) serveTransition(w http.ResponseWriter, r *http.Request, args []string) bool {
	if len(args) == 0 || args[0] != "transition" {
		return false
	}
	fail := func(status int, message string) {
		respond(w, r, status, map[string]any{"error": message, "physical_state_verified": false})
	}
	// Validate grammar and methods before any controller call, even cancellation.
	statusRequest := len(args) == 1
	cancelRequest := len(args) == 3 && args[1] == "cancel"
	var action protocol.Action
	if statusRequest {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			fail(http.StatusMethodNotAllowed, "статус принимает только GET")
			return true
		}
	} else if cancelRequest {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			fail(http.StatusMethodNotAllowed, "отмена принимает только POST")
			return true
		}
		if !transitionIDPattern.MatchString(args[2]) {
			fail(http.StatusBadRequest, "некорректный идентификатор перехода")
			return true
		}
	} else {
		var err error
		action, err = protocol.Resolve(args, h.presets)
		if err != nil {
			fail(http.StatusBadRequest, "некорректные параметры перехода")
			return true
		}
	}
	controller, ok := h.controller.(TransitionController)
	if !ok {
		fail(http.StatusServiceUnavailable, "контроллер не поддерживает переходы")
		return true
	}
	if statusRequest {
		respond(w, r, http.StatusOK, map[string]any{"transition": controller.TransitionStatus(), "physical_state_verified": false})
		return true
	}
	ctx, cancel := context.WithTimeout(r.Context(), RequestTimeout)
	defer cancel()
	var snapshot protocol.TransitionSnapshot
	var err error
	if cancelRequest {
		snapshot, err = controller.CancelTransition(ctx, args[2])
	} else {
		snapshot, err = controller.StartTransition(ctx, *action.Transition)
	}
	if err != nil {
		switch {
		case errors.Is(err, protocol.ErrTransitionNotFound):
			fail(http.StatusNotFound, "переход не найден")
		case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
			fail(http.StatusGatewayTimeout, "ожидание завершено; нативная операция может ещё выполняться")
		default:
			fail(http.StatusServiceUnavailable, "переход недоступен; исход операции неизвестен")
		}
		return true
	}
	if cancelRequest {
		respond(w, r, http.StatusOK, map[string]any{"transition": snapshot, "physical_state_verified": false})
	} else {
		respond(w, r, http.StatusAccepted, map[string]any{"accepted": true, "action": action.Route, "transition": snapshot, "physical_state_verified": false})
	}
	return true
}
