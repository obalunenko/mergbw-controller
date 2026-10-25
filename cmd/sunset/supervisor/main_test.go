package main

import (
	"encoding/json/v2"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/obalunenko/mergbw-controller/internal/config"
	"github.com/obalunenko/mergbw-controller/internal/managed"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSupervisorIndependentProcessFixture(t *testing.T) {
	if os.Getenv("MERGBW_SUPERVISOR_FIXTURE") != "1" {
		return
	}
	var err error
	if endpoint := os.Getenv("MERGBW_SUPERVISOR_CONTROL"); endpoint != "" {
		connection, dialErr := managed.DialAppControl(endpoint)
		if dialErr != nil {
			os.Exit(1)
		}
		err = runAppSupervisor(os.Getenv("MERGBW_SUPERVISOR_ROOT"), os.Getenv("MERGBW_SUPERVISOR_WORKER"), connection)
	} else {
		err = runSupervisor(os.Getenv("MERGBW_SUPERVISOR_ROOT"), os.Getenv("MERGBW_SUPERVISOR_WORKER"), os.Stdin, os.Stdout)
	}
	if err != nil {
		os.Exit(1)
	}
	os.Exit(0)
}

func TestIndependentSupervisorParentEOFReapsPreMainWorker(t *testing.T) {
	testParentEOFReapsPreMainWorker(t, false)
}

func TestAppSupervisorSocketEOFClosesAfterWorkerCleanup(t *testing.T) {
	testParentEOFReapsPreMainWorker(t, true)
}

func testParentEOFReapsPreMainWorker(t *testing.T, appControl bool) {
	t.Helper()
	root := t.TempDir()
	worker := filepath.Join(t.TempDir(), "worker")
	build := exec.Command("go", "build", "-o", worker, "../../../internal/managed/testdata/worker")
	build.Env = append(os.Environ(), "CGO_ENABLED=0")
	output, err := build.CombinedOutput()
	require.NoError(t, err, "%s", output)
	listener, err := net.ListenTCP("tcp4", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)})
	require.NoError(t, err)
	port := listener.Addr().(*net.TCPAddr).Port
	require.NoError(t, listener.Close())
	store, err := config.OpenManagedStore(root)
	require.NoError(t, err)
	settings, err := config.PrepareManualSettings("AA:BB:CC:DD:EE:FF", nil)
	require.NoError(t, err)
	settings.Port = port
	generation := strings.Repeat("b", 32)
	staged, err := store.Stage(generation, strings.Repeat("c", 32), settings, config.DefaultPresets())
	require.NoError(t, err)
	_, err = store.Commit(*staged, "")
	require.NoError(t, err)
	require.NoError(t, store.Close())
	executable, err := os.Executable()
	require.NoError(t, err)
	marker := filepath.Join(root, "fixture-init")
	child := exec.Command(executable, "-test.run=^TestSupervisorIndependentProcessFixture$")
	child.Env = append(os.Environ(), "MERGBW_SUPERVISOR_FIXTURE=1", "MERGBW_SUPERVISOR_ROOT="+root, "MERGBW_SUPERVISOR_WORKER="+worker, "MERGBW_TEST_WORKER_MODE=pre-main", "MERGBW_TEST_INIT_MARKER="+marker)
	var input io.WriteCloser
	input, err = child.StdinPipe()
	require.NoError(t, err)
	outputPipe, err := child.StdoutPipe()
	require.NoError(t, err)
	errorsPipe, err := child.StderrPipe()
	require.NoError(t, err)
	var controlListener *net.UnixListener
	if appControl {
		base := "/tmp"
		if runtime.GOOS == "darwin" {
			base = "/private/tmp"
		}
		directory, err := os.MkdirTemp(base, "mergbw-test-")
		require.NoError(t, err)
		t.Cleanup(func() { _ = os.RemoveAll(directory) })
		require.NoError(t, os.Chmod(directory, 0700))
		endpoint := filepath.Join(directory, "control.sock")
		controlListener, err = net.ListenUnix("unix", &net.UnixAddr{Name: endpoint, Net: "unix"})
		require.NoError(t, err)
		defer controlListener.Close()
		require.NoError(t, os.Chmod(endpoint, 0600))
		child.Env = append(child.Env, "MERGBW_SUPERVISOR_CONTROL="+endpoint)
	}
	require.NoError(t, child.Start())
	var control *net.UnixConn
	if appControl {
		require.NoError(t, controlListener.SetDeadline(time.Now().Add(5*time.Second)))
		control, err = controlListener.AcceptUnix()
		require.NoError(t, err)
		defer control.Close()
		_ = input.Close()
		input = control
	}
	reaped := false
	exited := make(chan error, 1)
	go func() { exited <- child.Wait() }()
	t.Cleanup(func() {
		if reaped {
			return
		}
		_ = input.Close()
		select {
		case <-exited:
		case <-time.After(12 * time.Second):
			_ = child.Process.Kill()
			<-exited
			t.Error("fixture helper did not finish cleanup")
		}
	})
	go func() { _, _ = io.Copy(io.Discard, outputPipe) }()
	go managed.DrainDiagnostics(errorsPipe)
	encoder := managed.NewEncoder(input)
	send := func(kind string, payload any) string {
		data, err := json.Marshal(payload)
		require.NoError(t, err)
		id, err := managed.NewID()
		require.NoError(t, err)
		require.NoError(t, encoder.Write(managed.Frame{Version: 1, Session: strings.Repeat("a", 32), RequestID: id, Type: kind, Payload: data}))
		return id
	}
	send("session.open", map[string]any{"protocolVersion": 1})
	send("host.alive", struct{}{})
	send("controller.start", map[string]any{"expectedGeneration": generation})
	require.Eventually(t, func() bool { _, err := os.Stat(marker); return err == nil }, 3*time.Second, time.Millisecond)
	_, err = (managed.FileLocker{}).Acquire(root)
	assert.ErrorIs(t, err, managed.InstanceBusy)
	if appControl {
		require.NoError(t, control.SetReadDeadline(time.Now().Add(3*time.Second)))
		decoder := managed.NewDecoder(control, strings.Repeat("a", 32))
		var binding managed.Binding
		for binding.LaunchID == "" {
			frame, err := decoder.Read()
			require.NoError(t, err)
			if frame.Type == "controller.state" {
				var status managed.RuntimeStatus
				require.NoError(t, managed.DecodePayload(frame, &status))
				binding = status.Binding
			}
		}
		// Even with Start blocked before fake worker main and Stop queued,
		// watch traffic must bypass the operation queue on the app socket.
		send("controller.stop", map[string]any{"reason": "fixture"})
		revoked := send("runtime.revoked", binding)
		for {
			frame, err := decoder.Read()
			require.NoError(t, err)
			if frame.RequestID == revoked {
				assert.JSONEq(t, `{"status":"ok"}`, string(frame.Payload))
				break
			}
		}
		require.NoError(t, control.CloseWrite())
		// Receiving EOF, rather than helper process exit, must itself prove
		// cleanup: ControlServer may return before runtime.Close finishes.
		require.NoError(t, control.SetReadDeadline(time.Now().Add(13*time.Second)))
		_, err := io.Copy(io.Discard, control)
		require.NoError(t, err)
		lock, err := (managed.FileLocker{}).Acquire(root)
		require.NoError(t, err)
		require.NoError(t, lock.Close())
		reserved, err := (managed.LoopbackListeners{}).Listen(port)
		require.NoError(t, err)
		require.NoError(t, reserved.Close())
	} else {
		require.NoError(t, input.Close()) // Real parent lifetime EOF, independent of queued Start.
	}
	select {
	case <-exited:
		reaped = true
	case <-time.After(13 * time.Second):
		t.Fatal("independent helper did not reap pre-main child after EOF")
	}
	// Exit confirms helper Wait; free inherited FDs additionally prove the child
	// cannot remain alive after the independent supervisor was reaped.
	lock, err := (managed.FileLocker{}).Acquire(root)
	require.NoError(t, err)
	require.NoError(t, lock.Close())
	reserved, err := (managed.LoopbackListeners{}).Listen(port)
	require.NoError(t, err)
	require.NoError(t, reserved.Close())
}

func TestIndependentSupervisorInheritedOrphanLockRejectsNewHelper(t *testing.T) {
	root := t.TempDir()
	worker := filepath.Join(t.TempDir(), "worker")
	build := exec.Command("go", "build", "-o", worker, "../../../internal/managed/testdata/worker")
	build.Env = append(os.Environ(), "CGO_ENABLED=0")
	output, err := build.CombinedOutput()
	require.NoError(t, err, "%s", output)
	lock, err := (managed.FileLocker{}).Acquire(root)
	require.NoError(t, err)
	listener, err := net.ListenTCP("tcp4", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)})
	require.NoError(t, err)
	file, err := listener.File()
	require.NoError(t, err)
	orphan := exec.Command(worker)
	orphan.Env = append(os.Environ(), "MERGBW_TEST_WORKER_MODE=descriptors")
	orphan.ExtraFiles = []*os.File{file, lock}
	input, err := orphan.StdinPipe()
	require.NoError(t, err)
	require.NoError(t, orphan.Start())
	t.Cleanup(func() { _ = input.Close(); _ = orphan.Process.Kill(); _ = orphan.Wait() })
	require.NoError(t, file.Close())
	require.NoError(t, listener.Close())
	require.NoError(t, lock.Close())
	executable, err := os.Executable()
	require.NoError(t, err)
	helper := exec.Command(executable, "-test.run=^TestSupervisorIndependentProcessFixture$")
	helper.Env = append(os.Environ(), "MERGBW_SUPERVISOR_FIXTURE=1", "MERGBW_SUPERVISOR_ROOT="+root, "MERGBW_SUPERVISOR_WORKER="+worker)
	var request strings.Builder
	payload := []byte(`{"protocolVersion":1}`)
	require.NoError(t, managed.NewEncoder(&request).Write(managed.Frame{Version: 1, Session: strings.Repeat("a", 32), RequestID: strings.Repeat("b", 32), Type: "session.open", Payload: payload}))
	helper.Stdin = strings.NewReader(request.String())
	output, err = helper.Output()
	require.Error(t, err)
	reply, decodeErr := managed.NewDecoder(strings.NewReader(string(output)), strings.Repeat("a", 32)).Read()
	require.NoError(t, decodeErr)
	assert.Equal(t, "result", reply.Type)
	assert.JSONEq(t, `{"status":"error","code":"instance_busy"}`, string(reply.Payload))
	_, err = (managed.FileLocker{}).Acquire(root)
	assert.ErrorIs(t, err, managed.InstanceBusy)
	require.NoError(t, input.Close())
	require.NoError(t, orphan.Wait())
	fresh, err := (managed.FileLocker{}).Acquire(root)
	require.NoError(t, err)
	require.NoError(t, fresh.Close())
}
