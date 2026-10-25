package main

import (
	"context"
	"encoding/json/v2"
	"errors"
	"os"
	"path/filepath"

	"github.com/obalunenko/mergbw-controller/internal/ble"
	"github.com/obalunenko/mergbw-controller/internal/bridge"
	"github.com/obalunenko/mergbw-controller/internal/config"
	"github.com/obalunenko/mergbw-controller/internal/managed"
)

func runManaged(directory string, listenerFD, lockFD int) error {
	bootstrap, err := managed.ReadWorkerBootstrap(os.Stdin, directory, listenerFD, lockFD)
	if err != nil {
		return err
	}
	root := filepath.Dir(filepath.Dir(directory))
	store, err := config.OpenManagedStore(root)
	if err != nil {
		return managed.Code("invalid_configuration")
	}
	defer store.Close()
	snapshot, err := store.ReadGeneration(bootstrap.ConfigurationGeneration)
	if err != nil {
		return managed.Code("invalid_configuration")
	}
	configureLogging(snapshot.Settings.AccessToken)
	listenerFile := os.NewFile(uintptr(listenerFD), "managed-listener")
	if listenerFile == nil {
		return managed.ProtocolIncompatible
	}
	defer listenerFile.Close()
	lockFile := os.NewFile(uintptr(lockFD), "managed-lock")
	if lockFile == nil {
		return managed.ProtocolIncompatible
	}
	defer lockFile.Close()
	listener, err := managed.AdoptWorkerDescriptors(listenerFile, lockFile, root, snapshot.Settings.Port)
	if err != nil {
		return err
	}
	defer listener.Close()
	ctx, stopLifetime := managed.WorkerLifetime(context.Background(), os.Stdin, bootstrap.Decoder)
	defer stopLifetime()
	encoder := managed.NewEncoder(os.Stdout)
	emit := func(kind string, value any) error {
		payload, err := json.Marshal(value)
		if err != nil {
			return managed.ProtocolIncompatible
		}
		id, err := managed.NewID()
		if err != nil {
			return err
		}
		return encoder.Write(managed.Frame{Version: managed.ProtocolVersion, Session: bootstrap.Session, RequestID: id, Type: kind, Payload: payload})
	}
	ready := func() error {
		return emit("worker.ready", managed.Bootstrap{Binding: bootstrap.Binding, Port: snapshot.Settings.Port, ProtocolVersion: managed.ProtocolVersion, BridgeVersion: bridge.Version})
	}
	bluetooth := func(connected bool, err error) {
		state := "disconnected"
		if connected {
			state = "connected"
		}
		category := managed.Code("")
		if errors.Is(err, ble.ErrPermission) {
			category = "permission_denied"
		}
		if errors.Is(err, ble.ErrNeedsRestart) {
			category = "backend_restart_required"
		}
		_ = emit("worker.bluetooth", managed.NewBluetoothStatus(bootstrap.Binding, state, category))
	}
	if err := serveOnListener(ctx, snapshot.Settings, snapshot.Presets, listener, ready, bluetooth); err != nil {
		return managed.WorkerExited
	}
	return nil
}
