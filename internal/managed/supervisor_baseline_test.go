package managed

import (
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

func baselineSupervisor(t *testing.T) (*Supervisor, *MockLauncher, *MockListenerFactory, *gomock.Controller) {
	t.Helper()
	mocks := gomock.NewController(t)
	directory := t.TempDir()
	locker := NewMockLocker(mocks)
	launcher := NewMockLauncher(mocks)
	listeners := NewMockListenerFactory(mocks)
	file, err := os.CreateTemp(directory, "lock")
	require.NoError(t, err)
	locker.EXPECT().Acquire(directory).Return(file, nil)
	supervisor, err := NewSupervisor(SupervisorOptions{Directory: directory, Worker: filepath.Join(directory, "must-not-run"), Session: strings.Repeat("a", 32), BridgeVersion: "test", Locker: locker, Launcher: launcher, Listeners: listeners})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, supervisor.Close()) })
	return supervisor, launcher, listeners, mocks
}

func TestSupervisorRequiresHostProofBeforeReservationOrWorker(t *testing.T) {
	supervisor, _, _, _ := baselineSupervisor(t)
	_, err := supervisor.Start(t.Context(), LaunchConfiguration{Generation: strings.Repeat("b", 32), Directory: t.TempDir(), Port: 18765})
	assert.ErrorIs(t, err, HostUnavailable)
}

func TestSupervisorForeignPortStartsNoWorker(t *testing.T) {
	supervisor, _, listeners, _ := baselineSupervisor(t)
	frame := testFrame()
	frame.Payload = jsontext.Value(`{}`)
	require.NoError(t, supervisor.Watch(frame))
	listeners.EXPECT().Listen(18765).Return(nil, PortConflict)
	_, err := supervisor.Start(context.Background(), LaunchConfiguration{Generation: strings.Repeat("b", 32), Directory: t.TempDir(), Port: 18765})
	assert.ErrorIs(t, err, PortConflict)
	assert.NotEqual(t, Ready, supervisor.Status().State)
}

func fixtureProcess(t *testing.T, mocks *gomock.Controller) (*Process, *os.File, *os.File, chan struct{}) {
	t.Helper()
	workerInput, parentInput, err := os.Pipe()
	require.NoError(t, err)
	parentOutput, workerOutput, err := os.Pipe()
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = workerInput.Close()
		_ = workerOutput.Close()
		_ = parentInput.Close()
		_ = parentOutput.Close()
	})
	handle := NewMockProcessHandle(mocks)
	exited := make(chan struct{})
	handle.EXPECT().Wait().DoAndReturn(func() error { <-exited; return nil })
	handle.EXPECT().Signal(syscall.SIGTERM).DoAndReturn(func(os.Signal) error { close(exited); return nil })
	return &Process{Handle: handle, Input: parentInput, Output: parentOutput, Errors: io.NopCloser(strings.NewReader(""))}, workerInput, workerOutput, exited
}

func fixtureReservation(t *testing.T, listeners *MockListenerFactory) int {
	t.Helper()
	listener, err := net.ListenTCP("tcp4", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)})
	require.NoError(t, err)
	port := listener.Addr().(*net.TCPAddr).Port
	listeners.EXPECT().Listen(port).Return(&Reservation{listener: listener}, nil)
	return port
}

func TestParentLossDuringSpawnReapsWorkerBeforeAnyReplacement(t *testing.T) {
	supervisor, launcher, listeners, mocks := baselineSupervisor(t)
	port := fixtureReservation(t, listeners)
	process, _, _, _ := fixtureProcess(t, mocks)
	entered, release := make(chan struct{}), make(chan struct{})
	launcher.EXPECT().Start(gomock.Any()).DoAndReturn(func(spec ProcessSpec) (*Process, error) {
		assert.Len(t, spec.Files, 2)
		close(entered)
		<-release
		return process, nil
	})
	require.NoError(t, supervisor.Watch(testFrame()))
	configuration := LaunchConfiguration{Generation: strings.Repeat("b", 32), Directory: t.TempDir(), Port: port}
	started := make(chan error, 1)
	go func() { _, err := supervisor.Start(t.Context(), configuration); started <- err }()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("spawn did not enter")
	}
	stopped := make(chan error, 1)
	go func() { stopped <- supervisor.Stop(t.Context(), true) }()
	select {
	case <-supervisor.parentGone:
	case <-time.After(2 * time.Second):
		t.Fatal("parent loss not observed during spawn")
	}
	close(release)
	select {
	case err := <-stopped:
		require.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("owned child not reaped")
	}
	select {
	case err := <-started:
		require.Error(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("startup still waits after process exit")
	}
	_, err := supervisor.Start(t.Context(), configuration)
	assert.ErrorIs(t, err, HostUnavailable)
}

func TestLiveParentStopRetainsReservationUntilRevocation(t *testing.T) {
	supervisor, launcher, listeners, mocks := baselineSupervisor(t)
	port := fixtureReservation(t, listeners)
	process, workerInput, workerOutput, signalled := fixtureProcess(t, mocks)
	launcher.EXPECT().Start(gomock.Any()).Return(process, nil)
	workerResult := make(chan error, 1)
	go func() {
		frame, err := NewDecoder(workerInput, supervisor.options.Session).Read()
		if err != nil {
			workerResult <- err
			return
		}
		var binding Binding
		if err := DecodePayload(frame, &binding); err != nil {
			workerResult <- err
			return
		}
		payload, err := json.Marshal(Bootstrap{Binding: binding, Port: port, ProtocolVersion: ProtocolVersion, BridgeVersion: "test"})
		if err != nil {
			workerResult <- err
			return
		}
		frame.Type = "worker.ready"
		frame.Payload = payload
		workerResult <- NewEncoder(workerOutput).Write(frame)
	}()
	require.NoError(t, supervisor.Watch(testFrame()))
	configuration := LaunchConfiguration{Generation: strings.Repeat("b", 32), Directory: t.TempDir(), Port: port}
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancel()
	bootstrap, err := supervisor.Start(ctx, configuration)
	require.NoError(t, err)
	require.NoError(t, <-workerResult)
	frame := testFrame()
	frame.Type = "runtime.authorized"
	frame.Payload, err = json.Marshal(bootstrap.Binding)
	require.NoError(t, err)
	require.NoError(t, supervisor.Watch(frame))
	assert.Equal(t, Ready, supervisor.Status().State)
	stopped := make(chan error, 1)
	go func() { stopped <- supervisor.Stop(t.Context(), false) }()
	select {
	case <-signalled:
	case <-time.After(2 * time.Second):
		t.Fatal("stop did not signal owned worker")
	}
	select {
	case <-stopped:
		t.Fatal("stop completed without transport revocation")
	default:
	}
	_, err = (LoopbackListeners{}).Listen(port)
	assert.ErrorIs(t, err, PortConflict)
	_, err = supervisor.Start(t.Context(), configuration)
	assert.ErrorIs(t, err, CleanupFailed)
	frame.Type = "runtime.revoked"
	require.NoError(t, supervisor.Watch(frame))
	select {
	case err := <-stopped:
		require.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("revocation did not unblock cleanup")
	}
	assert.Equal(t, Stopped, supervisor.Status().State)
}
