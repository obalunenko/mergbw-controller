package managed

import (
	"context"
	"encoding/json/v2"
	"errors"
	"io"
	"sync"
	"sync/atomic"
)

type ControlHandler func(context.Context, Frame) (any, error)

// ControlServer keeps lifetime/revocation dispatch independent of mutating
// operations and a blocked stdout. Exhausted bounds fail closed.
type ControlServer struct {
	Input    io.ReadCloser
	Output   io.WriteCloser
	Session  string
	Handlers map[string]ControlHandler
	Watch    func(Frame) error
	Events   <-chan Frame
	Fault    func(error)
	Decoder  *Decoder
}

type controlResult struct {
	Status string `json:"status"`
	Code   Code   `json:"code,omitempty"`
	Data   any    `json:"data,omitempty"`
}

func DecodePayload(frame Frame, value any) error {
	if json.Unmarshal(frame.Payload, value, json.RejectUnknownMembers(true)) != nil {
		return ProtocolIncompatible
	}
	return nil
}

var safeCodes = map[Code]bool{
	InstanceBusy: true, PortConflict: true, ProtocolIncompatible: true, SpawnFailed: true,
	HostUnavailable: true, StartupTimeout: true, WorkerExited: true, CleanupFailed: true,
	"invalid_configuration": true, "storage_unavailable": true, "stale_configuration": true,
	"invalid_identity": true, "invalid_settings": true, "proposal_expired": true,
	"confirmation_required": true, "unconfigured": true, "control_busy": true,
	"import_missing": true, "import_unreadable": true, "import_size": true, "import_file": true,
	"preset_exists": true, "preset_not_found": true, "preset_too_large": true,
	"binary_missing": true, "binary_incompatible": true, "permission_denied": true,
	"bluetooth_unavailable": true, "backend_restart_required": true,
}

func safeCode(err error) Code {
	code, ok := errors.AsType[Code](err)
	if ok && safeCodes[code] {
		return code
	}
	return Code("internal_error")
}

func (s *ControlServer) Run(parent context.Context) error {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	operations, stopOperations := context.WithCancel(ctx)
	defer stopOperations()
	var faulted atomic.Bool
	defer s.Input.Close()
	defer s.Output.Close()
	queue := make(chan Frame, MaxRequests)
	output := make(chan Frame, MaxRequests)
	failure := make(chan error, 1)
	disconnected := make(chan error, 1)
	fail := func(err error) {
		select {
		case failure <- err:
		default:
		}
	}
	emit := func(frame Frame) {
		select {
		case output <- frame:
		case <-ctx.Done():
		default:
			fail(Code("control_busy"))
		}
	}
	var requests Requests
	var cacheMutex sync.Mutex
	cache := make(map[string]Frame)
	var order []string
	reply := func(frame Frame, data any, err error) {
		result := controlResult{Status: "ok", Data: data}
		if err != nil {
			result = controlResult{Status: "error", Code: safeCode(err)}
		}
		payload, marshalErr := json.Marshal(result)
		if marshalErr != nil {
			fail(ProtocolIncompatible)
			return
		}
		response := Frame{Version: ProtocolVersion, Session: s.Session, RequestID: frame.RequestID, Type: "result", Payload: payload}
		cacheMutex.Lock()
		if len(order) == MaxRequests {
			delete(cache, order[0])
			order = order[1:]
		}
		cache[frame.RequestID] = response
		order = append(order, frame.RequestID)
		cacheMutex.Unlock()
		requests.Done(frame.RequestID)
		emit(response)
	}
	go func() {
		encoder := NewEncoder(s.Output)
		for {
			select {
			case <-ctx.Done():
				return
			case frame := <-output:
				if err := encoder.Write(frame); err != nil {
					fail(err)
					return
				}
			case frame := <-s.Events:
				if err := encoder.Write(frame); err != nil {
					fail(err)
					return
				}
			}
		}
	}()
	go func() {
		for {
			select {
			case <-operations.Done():
				return
			case frame := <-queue:
				if operations.Err() != nil {
					return
				}
				handler := s.Handlers[frame.Type]
				if handler == nil {
					reply(frame, nil, ProtocolIncompatible)
					fail(ProtocolIncompatible)
					continue
				}
				data, err := handler(operations, frame)
				reply(frame, data, err)
				if errors.Is(err, ProtocolIncompatible) {
					fail(err)
				}
			}
		}
	}()
	go func() {
		defer func() {
			_, _ = io.Copy(io.Discard, s.Input)
			select {
			case disconnected <- io.EOF:
			case <-ctx.Done():
			}
		}()
		decoder := s.Decoder
		if decoder == nil {
			decoder = NewDecoder(s.Input, s.Session)
		}
		for {
			frame, err := decoder.Read()
			if err != nil {
				if !errors.Is(err, io.EOF) {
					fail(err)
					// A malformed peer still owns live HTTP transports until it
					// closes its lifetime pipe. Retain the listener during drain.
				}
				return
			}
			cacheMutex.Lock()
			cached, found := cache[frame.RequestID]
			cacheMutex.Unlock()
			if found {
				emit(cached)
				continue
			}
			if err := requests.Add(frame.RequestID); err != nil {
				fail(err)
				return
			}
			switch frame.Type {
			case "host.alive", "runtime.revoked", "runtime.authorized":
				if s.Watch == nil {
					fail(ProtocolIncompatible)
					return
				}
				err := s.Watch(frame)
				reply(frame, struct{}{}, err)
				if errors.Is(err, ProtocolIncompatible) {
					fail(err)
				}
			default:
				if faulted.Load() {
					reply(frame, nil, ProtocolIncompatible)
					continue
				}
				select {
				case queue <- frame:
				case <-ctx.Done():
					return
				default:
					fail(Code("control_busy"))
					return
				}
			}
		}
	}()
	for {
		select {
		case <-parent.Done():
			return parent.Err()
		case err := <-disconnected:
			return err
		case err := <-failure:
			if s.Fault == nil {
				return err
			}
			if faulted.CompareAndSwap(false, true) {
				stopOperations()
				s.Fault(err)
			}
		}
	}
}
