package managed

import (
	"context"
	"encoding/json/v2"
	"io"
	"os"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

func lifecycleTimer(t *testing.T, mocks *gomock.Controller) (*MockTimer, chan time.Time) {
	t.Helper()
	timer := NewMockTimer(mocks)
	fired := make(chan time.Time, 1)
	timer.EXPECT().C().Return(fired).AnyTimes()
	timer.EXPECT().Stop().Return(true).AnyTimes()
	timer.EXPECT().Reset(gomock.Any()).Return(true).AnyTimes()
	return timer, fired
}

func TestLifecyclePreMainDeadlineEscalationRequiresReapingAndRevocation(t *testing.T) {
	supervisor, launcher, listeners, mocks := baselineSupervisor(t)
	clock := NewMockClock(mocks)
	now := time.Now()
	clock.EXPECT().Now().Return(now).AnyTimes()
	startup, deadline := lifecycleTimer(t, mocks)
	grace, escalate := lifecycleTimer(t, mocks)
	clock.EXPECT().NewTimer(StartupDeadline).Return(startup)
	clock.EXPECT().NewTimer(StopGrace).Return(grace)
	supervisor.options.Clock = clock
	port := fixtureReservation(t, listeners)
	handle := NewMockProcessHandle(mocks)
	reaped := make(chan struct{})
	term, killed := make(chan struct{}), make(chan struct{})
	handle.EXPECT().Wait().DoAndReturn(func() error { <-reaped; return nil })
	handle.EXPECT().Signal(syscall.SIGTERM).DoAndReturn(func(os.Signal) error { close(term); return nil })
	handle.EXPECT().Kill().DoAndReturn(func() error { close(killed); return nil })
	input, writer, err := os.Pipe()
	require.NoError(t, err)
	defer input.Close()
	output, worker, err := os.Pipe()
	require.NoError(t, err)
	defer worker.Close()
	process := &Process{Handle: handle, Input: writer, Output: output, Errors: io.NopCloser(strings.NewReader(""))}
	launcher.EXPECT().Start(gomock.Any()).Return(process, nil)
	require.NoError(t, supervisor.Watch(testFrame()))
	configuration := LaunchConfiguration{Generation: strings.Repeat("b", 32), Directory: t.TempDir(), Port: port}
	result := make(chan error, 1)
	go func() { _, err := supervisor.Start(t.Context(), configuration); result <- err }()
	require.Eventually(t, func() bool { return supervisor.Status().State == Starting }, time.Second, time.Millisecond)
	deadline <- now.Add(StartupDeadline)
	select {
	case <-term:
	case <-time.After(time.Second):
		t.Fatal("deadline did not TERM pre-main child")
	}
	assert.Equal(t, Stopping, supervisor.Status().State)
	escalate <- now.Add(StartupDeadline + StopGrace)
	select {
	case <-killed:
	case <-time.After(time.Second):
		t.Fatal("grace did not escalate")
	}
	assert.Equal(t, CleanupBlocked, supervisor.Status().State)
	close(reaped)
	require.Error(t, <-result)
	_, err = supervisor.Start(t.Context(), configuration)
	assert.ErrorIs(t, err, CleanupFailed)
	assert.Equal(t, CleanupBlocked, supervisor.Status().State)
	joined := make(chan error, 1)
	go func() { joined <- supervisor.AwaitCleanup(t.Context()) }()
	select {
	case <-joined:
		t.Fatal("cleanup join bypassed live-parent revocation after reaping")
	default:
	}
	frame := testFrame()
	frame.Type = "runtime.revoked"
	frame.Payload, err = json.Marshal(supervisor.Status().Binding)
	require.NoError(t, err)
	require.NoError(t, supervisor.Watch(frame))
	require.NoError(t, <-joined)
	require.Eventually(t, func() bool { supervisor.mutex.Lock(); defer supervisor.mutex.Unlock(); return supervisor.active == nil }, time.Second, time.Millisecond)
}

func TestLifecycleFailureCannotBeOverwrittenByStartingOrTelemetry(t *testing.T) {
	supervisor, _, _, _ := baselineSupervisor(t)
	run := &workerRun{binding: Binding{LaunchID: strings.Repeat("b", 32), ConfigurationGeneration: strings.Repeat("c", 32)}, failure: HostUnavailable, intentional: true}
	supervisor.mutex.Lock()
	supervisor.active = run
	supervisor.status = RuntimeStatus{Binding: run.binding, State: Stopping, ErrorCategory: HostUnavailable}
	supervisor.mutex.Unlock()
	supervisor.setStatus(run, Starting, "")
	assert.Equal(t, Stopping, supervisor.Status().State)
	// No synthetic process to stop; restore the idle fixture before cleanup.
	supervisor.mutex.Lock()
	supervisor.active = nil
	supervisor.mutex.Unlock()
}

func TestLifecycleRevocationWatchRejectsOldBinding(t *testing.T) {
	supervisor, _, _, _ := baselineSupervisor(t)
	frame := testFrame()
	frame.Type = "runtime.revoked"
	frame.Payload = []byte(`{"launchId":"` + strings.Repeat("b", 32) + `","configurationGeneration":"` + strings.Repeat("c", 32) + `"}`)
	assert.ErrorIs(t, supervisor.Watch(frame), Code("stale_configuration"))
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	assert.NoError(t, supervisor.Stop(ctx, false))
}

func TestLifecycleLeaseLossBeforeSpawnReturnCannotCreateFreshAdmissions(t *testing.T) {
	supervisor, launcher, listeners, mocks := baselineSupervisor(t)
	port := fixtureReservation(t, listeners)
	process, _, _, _ := fixtureProcess(t, mocks)
	entered, release := make(chan struct{}), make(chan struct{})
	launcher.EXPECT().Start(gomock.Any()).DoAndReturn(func(ProcessSpec) (*Process, error) { close(entered); <-release; return process, nil })
	require.NoError(t, supervisor.Watch(testFrame()))
	started := make(chan error, 1)
	go func() {
		_, err := supervisor.Start(t.Context(), LaunchConfiguration{Generation: strings.Repeat("b", 32), Directory: t.TempDir(), Port: port})
		started <- err
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("spawn did not enter")
	}
	supervisor.Fail(HostUnavailable)
	assert.Equal(t, Stopping, supervisor.Status().State)
	close(release)
	require.Error(t, <-started)
	frame := testFrame()
	frame.Type = "runtime.authorized"
	var err error
	frame.Payload, err = json.Marshal(supervisor.Status().Binding)
	require.NoError(t, err)
	assert.Error(t, supervisor.Watch(frame))
	assert.NotEqual(t, Ready, supervisor.Status().State)
	_, err = (LoopbackListeners{}).Listen(port)
	assert.ErrorIs(t, err, PortConflict)
	frame.Type = "runtime.revoked"
	require.NoError(t, supervisor.Watch(frame))
	require.NoError(t, supervisor.AwaitCleanup(t.Context()))
}
