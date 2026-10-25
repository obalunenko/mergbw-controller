//go:build darwin || linux

package managed

import (
	"context"
	"encoding/json/v2"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

var fixtureBinary = sync.OnceValues(func() (string, error) {
	directory, err := os.MkdirTemp("", "mergbw-nonble-worker-")
	if err != nil {
		return "", err
	}
	executable := filepath.Join(directory, "worker")
	command := exec.Command("go", "build", "-o", executable, "./testdata/worker")
	command.Env = append(os.Environ(), "CGO_ENABLED=0")
	if output, err := command.CombinedOutput(); err != nil {
		return "", &fixtureBuildError{output: string(output), err: err}
	}
	return executable, nil
})

type fixtureBuildError struct {
	output string
	err    error
}

func (e *fixtureBuildError) Error() string { return e.err.Error() + ": " + e.output }

func TestProcessInheritedDescriptorsSurviveParentCopiesUntilActualReaping(t *testing.T) {
	executable, err := fixtureBinary()
	require.NoError(t, err)
	t.Setenv("MERGBW_TEST_WORKER_MODE", "descriptors")
	root := t.TempDir()
	lock, err := (FileLocker{}).Acquire(root)
	require.NoError(t, err)
	listener, err := net.ListenTCP("tcp4", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)})
	require.NoError(t, err)
	port := listener.Addr().(*net.TCPAddr).Port
	file, err := listener.File()
	require.NoError(t, err)
	process, err := (NativeLauncher{}).Start(ProcessSpec{Executable: executable, Files: []*os.File{file, lock}})
	require.NoError(t, err)
	t.Cleanup(func() { _ = process.Input.Close(); _ = process.Handle.Kill(); _ = process.Handle.Wait() })
	defer process.Output.Close()
	defer process.Errors.Close()
	require.NoError(t, file.Close())
	require.NoError(t, listener.Close())
	require.NoError(t, lock.Close())
	_, err = (FileLocker{}).Acquire(root)
	assert.ErrorIs(t, err, InstanceBusy)
	_, err = (LoopbackListeners{}).Listen(port)
	assert.ErrorIs(t, err, PortConflict)
	require.NoError(t, process.Input.Close())
	require.NoError(t, process.Handle.Wait())
	assert.Error(t, process.Handle.Wait(), "the actual owned child has already been reaped")
	replacement, err := (FileLocker{}).Acquire(root)
	require.NoError(t, err)
	defer replacement.Close()
	reserved, err := (LoopbackListeners{}).Listen(port)
	require.NoError(t, err)
	require.NoError(t, reserved.Close())
}

func TestProcessLifecycleRealPreMainTERMGraceKILLAndWait(t *testing.T) {
	for _, mode := range []string{"pre-main", "ignore-term", "delayed-exit", "stdout-loss", "stderr-flood"} {
		t.Run(mode, func(t *testing.T) {
			executable, err := fixtureBinary()
			require.NoError(t, err)
			t.Setenv("MERGBW_TEST_WORKER_MODE", mode)
			mocks := gomock.NewController(t)
			clock := NewMockClock(mocks)
			now := time.Now()
			clock.EXPECT().Now().Return(now).AnyTimes()
			lease, _ := lifecycleTimer(t, mocks)
			startup, deadline := lifecycleTimer(t, mocks)
			grace, escalate := lifecycleTimer(t, mocks)
			clock.EXPECT().NewTimer(HostLease).Return(lease)
			clock.EXPECT().NewTimer(StartupDeadline).Return(startup)
			clock.EXPECT().NewTimer(StopGrace).Return(grace)
			root := t.TempDir()
			marker := filepath.Join(root, "init-ready")
			t.Setenv("MERGBW_TEST_INIT_MARKER", marker)
			supervisor, err := NewSupervisor(SupervisorOptions{Directory: root, Worker: executable, Session: strings.Repeat("a", 32), BridgeVersion: "test", Clock: clock})
			require.NoError(t, err)
			t.Cleanup(func() {
				// A failed assertion must not strand a real TERM-ignoring fixture behind
				// a fake clock whose grace channel will never advance.
				supervisor.mutex.Lock()
				run := supervisor.active
				supervisor.mutex.Unlock()
				if run != nil {
					<-run.spawned
					if run.process != nil {
						_ = run.process.Handle.Kill()
					}
				}
				require.NoError(t, supervisor.Close())
			})
			listener, err := net.ListenTCP("tcp4", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)})
			require.NoError(t, err)
			port := listener.Addr().(*net.TCPAddr).Port
			require.NoError(t, listener.Close())
			require.NoError(t, supervisor.Watch(testFrame()))
			result := make(chan error, 1)
			go func() {
				_, err := supervisor.Start(t.Context(), LaunchConfiguration{Generation: strings.Repeat("b", 32), Directory: root, Port: port})
				result <- err
			}()
			require.Eventually(t, func() bool {
				supervisor.mutex.Lock()
				defer supervisor.mutex.Unlock()
				if supervisor.active == nil {
					return false
				}
				select {
				case <-supervisor.active.spawned:
					return true
				default:
					return false
				}
			}, 3*time.Second, time.Millisecond)
			if mode == "pre-main" {
				require.Eventually(t, func() bool { _, err := os.Stat(marker); return err == nil }, 3*time.Second, time.Millisecond)
				deadline <- now.Add(StartupDeadline)
			} else if mode != "stdout-loss" {
				require.NoError(t, <-result)
			}
			if mode == "stdout-loss" {
				require.Error(t, <-result)
			}
			stoppingAt := time.Now()
			stopping := make(chan error, 1)
			go func() { stopping <- supervisor.Stop(t.Context(), false) }()
			if mode == "pre-main" || mode == "ignore-term" {
				require.Eventually(t, func() bool { return supervisor.Status().State == Stopping }, time.Second, time.Millisecond)
				escalate <- now.Add(StopGrace)
				require.Eventually(t, func() bool { return supervisor.Status().State == CleanupBlocked }, time.Second, time.Millisecond)
			}
			if mode == "pre-main" {
				require.Error(t, <-result)
			}
			if mode == "delayed-exit" {
				select {
				case <-time.After(50 * time.Millisecond):
				case <-stopping:
					t.Fatal("delayed child stopped before EOF delay")
				}
			}
			// Wait alone never releases the live parent's reserved endpoint.
			require.Eventually(t, func() bool {
				supervisor.mutex.Lock()
				defer supervisor.mutex.Unlock()
				select {
				case <-supervisor.active.done:
					return true
				default:
					return false
				}
			}, 3*time.Second, time.Millisecond)
			if mode == "delayed-exit" {
				assert.GreaterOrEqual(t, time.Since(stoppingAt), 100*time.Millisecond)
			}
			_, err = (LoopbackListeners{}).Listen(port)
			assert.ErrorIs(t, err, PortConflict)
			_, err = (FileLocker{}).Acquire(root)
			assert.ErrorIs(t, err, InstanceBusy)
			frame := testFrame()
			frame.Type = "runtime.revoked"
			frame.Payload, err = json.Marshal(supervisor.Status().Binding)
			require.NoError(t, err)
			require.NoError(t, supervisor.Watch(frame))
			if mode == "pre-main" || mode == "ignore-term" {
				assert.ErrorIs(t, <-stopping, CleanupFailed)
			} else {
				require.NoError(t, <-stopping)
			}
			require.Eventually(t, func() bool { supervisor.mutex.Lock(); defer supervisor.mutex.Unlock(); return supervisor.active == nil }, time.Second, time.Millisecond)
			// A fresh request after the confirmed barrier is allowed; no auto restart.
			ctx, cancel := context.WithCancel(t.Context())
			cancel()
			_, err = supervisor.Start(ctx, LaunchConfiguration{Generation: strings.Repeat("b", 32), Directory: root, Port: port})
			assert.ErrorIs(t, err, StartupTimeout)
		})
	}
}
