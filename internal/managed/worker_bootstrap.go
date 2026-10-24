//go:build darwin || linux

package managed

import (
	"context"
	"io"
	"net"
	"os"
	"path/filepath"
	"syscall"
)

type WorkerBootstrap struct {
	Binding
	Session string
	Decoder *Decoder
}

// ReadWorkerBootstrap validates private startup without importing Bluetooth.
func ReadWorkerBootstrap(input io.Reader, directory string, listenerFD, lockFD int) (WorkerBootstrap, error) {
	if listenerFD < 3 || lockFD < 3 || listenerFD == lockFD || !filepath.IsAbs(directory) || filepath.Clean(directory) != directory {
		return WorkerBootstrap{}, ProtocolIncompatible
	}
	decoder := NewDecoder(input, "")
	frame, err := decoder.Read()
	if err != nil || frame.Type != "worker.bootstrap" {
		return WorkerBootstrap{}, ProtocolIncompatible
	}
	var binding Binding
	if DecodePayload(frame, &binding) != nil || !ValidID(binding.LaunchID) || !ValidID(binding.ConfigurationGeneration) || filepath.Base(directory) != binding.ConfigurationGeneration || filepath.Base(filepath.Dir(directory)) != "generations" {
		return WorkerBootstrap{}, ProtocolIncompatible
	}
	return WorkerBootstrap{Binding: binding, Session: frame.Session, Decoder: decoder}, nil
}

// AdoptWorkerDescriptors verifies the exact inherited listener and fixed lock.
// The returned listener owns a duplicate; the caller retains the lock file.
func AdoptWorkerDescriptors(listenerFile, lockFile *os.File, root string, port int) (net.Listener, error) {
	if listenerFile == nil || lockFile == nil {
		return nil, ProtocolIncompatible
	}
	lockInfo, err := lockFile.Stat()
	if err != nil || !lockInfo.Mode().IsRegular() || lockInfo.Mode().Perm() != 0600 {
		return nil, ProtocolIncompatible
	}
	directory, err := os.OpenRoot(root)
	if err != nil {
		return nil, ProtocolIncompatible
	}
	defer directory.Close()
	expected, err := directory.Lstat("runtime.lock")
	if err != nil || !expected.Mode().IsRegular() || !os.SameFile(expected, lockInfo) {
		return nil, ProtocolIncompatible
	}
	if syscall.Flock(int(lockFile.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		return nil, InstanceBusy
	}
	listener, err := net.FileListener(listenerFile)
	if err != nil {
		return nil, ProtocolIncompatible
	}
	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok || !address.IP.Equal(net.IPv4(127, 0, 0, 1)) || address.Port != port {
		_ = listener.Close()
		return nil, ProtocolIncompatible
	}
	return listener, nil
}

// WorkerLifetime cancels the root on private pipe loss or an unexpected frame.
// Closing joins the pipe reader; it never starts or abandons a native operation.
func WorkerLifetime(parent context.Context, input io.ReadCloser, decoder *Decoder) (context.Context, func()) {
	ctx, cancel := context.WithCancel(parent)
	done := make(chan struct{})
	stopRead := context.AfterFunc(ctx, func() { _ = input.Close() })
	go func() { defer close(done); _, _ = decoder.Read(); cancel() }()
	return ctx, func() { cancel(); _ = input.Close(); <-done; stopRead() }
}
