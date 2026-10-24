// The supervisor must never import a package that initializes native Bluetooth.
package main

import (
	"context"
	"encoding/json/v2"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/obalunenko/mergbw-controller/internal/bridge"
	"github.com/obalunenko/mergbw-controller/internal/config"
	"github.com/obalunenko/mergbw-controller/internal/logging"
	"github.com/obalunenko/mergbw-controller/internal/managed"
)

func main() {
	if run() != nil {
		fmt.Fprintln(os.Stderr, "supervisor_failed")
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) != 3 || os.Args[1] != "--control-socket" {
		return managed.HostUnavailable
	}
	connection, err := managed.DialAppControl(os.Args[2])
	if err != nil {
		return err
	}
	// The peer's EOF is cleanup proof only after runSupervisor's worker reap,
	// reservation release and runtime.Close have all completed.
	defer connection.Close()
	directory, err := config.ManagedRoot()
	if err != nil {
		return err
	}
	executable, err := os.Executable()
	if err != nil {
		return managed.SpawnFailed
	}
	return runAppSupervisor(directory, filepath.Join(filepath.Dir(executable), "..", "Helpers", "sunset"), connection)
}

// ControlServer owns its stream adapters; the app composition owns the actual
// connection so an early stream Close cannot advertise completed worker cleanup.
type appControlOutput struct{ io.Writer }

func (appControlOutput) Close() error { return nil }

func runAppSupervisor(directory, worker string, connection io.ReadWriteCloser) error {
	defer connection.Close()
	return runSupervisor(directory, worker, io.NopCloser(connection), appControlOutput{connection})
}

// runSupervisor keeps paths and private pipes injectable without consulting a
// test user's production configuration or importing the native worker.
func runSupervisor(directory, worker string, input io.ReadCloser, output io.WriteCloser) error {
	decoder := managed.NewDecoder(input, "")
	first, err := decoder.Read()
	if err != nil || first.Type != "session.open" {
		return managed.ProtocolIncompatible
	}
	var open struct {
		ProtocolVersion int `json:"protocolVersion"`
	}
	if managed.DecodePayload(first, &open) != nil || open.ProtocolVersion != managed.ProtocolVersion {
		return managed.ProtocolIncompatible
	}
	startupFailure := func(err error) error {
		category := managed.SafeCode(err)
		logging.Managed(context.Background(), "startup", string(category), first.RequestID, 0)
		payload, _ := json.Marshal(map[string]any{"status": "error", "code": category})
		_ = managed.NewEncoder(output).Write(managed.Frame{Version: managed.ProtocolVersion, Session: first.Session, RequestID: first.RequestID, Type: "result", Payload: payload})
		return category
	}
	store, err := config.OpenManagedStore(directory)
	if err != nil {
		return startupFailure(managed.Code("storage_unavailable"))
	}
	defer store.Close()
	runtime, err := managed.NewSupervisor(managed.SupervisorOptions{Directory: directory, Worker: worker, Session: first.Session, BridgeVersion: bridge.Version})
	if err != nil {
		return startupFailure(err)
	}
	defer runtime.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server := managed.ControlServer{Input: input, Output: output, Session: first.Session, Watch: runtime.Watch, Events: runtime.Events, Decoder: decoder}
	configuration := managed.NewConfiguration(store, runtime, directory)
	start := func(ctx context.Context, frame managed.Frame, restart bool) (any, error) {
		var request struct {
			ExpectedGeneration *string `json:"expectedGeneration"`
		}
		if err := managed.DecodePayload(frame, &request); err != nil {
			return nil, err
		}
		expected := ""
		if request.ExpectedGeneration != nil {
			expected = *request.ExpectedGeneration
		}
		return configuration.Launch(ctx, expected, restart)
	}
	server.Handlers = map[string]managed.ControlHandler{
		"configuration.read":          configuration.Read,
		"configuration.prepareManual": configuration.PrepareManual,
		"configuration.prepareImport": configuration.PrepareImport,
		"configuration.check":         configuration.Check,
		"configuration.apply":         configuration.Apply,
		"configuration.cancel":        configuration.Cancel,
		"controller.start":            func(ctx context.Context, frame managed.Frame) (any, error) { return start(ctx, frame, false) },
		"controller.restart":          func(ctx context.Context, frame managed.Frame) (any, error) { return start(ctx, frame, true) },
		"controller.stop": func(ctx context.Context, frame managed.Frame) (any, error) {
			var request struct {
				Reason string `json:"reason"`
			}
			if err := managed.DecodePayload(frame, &request); err != nil {
				return nil, err
			}
			err := runtime.Stop(ctx, false)
			return runtime.Status(), err
		},
	}
	server.Fault = func(_ error) {
		runtime.Fail(managed.ProtocolIncompatible)
		go func() {
			_ = runtime.Stop(ctx, false)
			if runtime.AwaitCleanup(ctx) == nil {
				cancel()
			}
		}()
	}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	go func() {
		select {
		case <-ctx.Done():
		case <-signals:
			runtime.Fail(managed.WorkerExited)
			_ = runtime.Stop(ctx, false)
			if runtime.AwaitCleanup(ctx) == nil {
				cancel()
			}
		}
	}()
	payload, err := json.Marshal(map[string]any{"status": "ok", "data": map[string]any{"protocolVersion": managed.ProtocolVersion, "bridgeVersion": bridge.Version}})
	if err != nil {
		return managed.ProtocolIncompatible
	}
	if err := managed.NewEncoder(output).Write(managed.Frame{Version: managed.ProtocolVersion, Session: first.Session, RequestID: first.RequestID, Type: "result", Payload: payload}); err != nil {
		return err
	}
	return server.Run(ctx)
}
