//go:build darwin || linux

package managed

import (
	"bytes"
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWorkerBootstrapRequiresExactPrivateGenerationAndDescriptors(t *testing.T) {
	binding := Binding{LaunchID: strings.Repeat("b", 32), ConfigurationGeneration: strings.Repeat("c", 32)}
	payload, err := json.Marshal(binding)
	require.NoError(t, err)
	frame := testFrame()
	frame.Type = "worker.bootstrap"
	frame.Payload = payload
	var encoded bytes.Buffer
	require.NoError(t, NewEncoder(&encoded).Write(frame))
	directory := filepath.Join(t.TempDir(), "generations", binding.ConfigurationGeneration)
	bootstrap, err := ReadWorkerBootstrap(bytes.NewReader(encoded.Bytes()), directory, 3, 4)
	require.NoError(t, err)
	assert.Equal(t, binding, bootstrap.Binding)
	assert.Equal(t, frame.Session, bootstrap.Session)
	for _, tc := range []struct {
		directory      string
		listener, lock int
	}{
		{directory, 0, 4}, {directory, 3, 3}, {directory, 3, -1}, {"relative", 3, 4},
		{filepath.Join(t.TempDir(), "wrong", binding.ConfigurationGeneration), 3, 4},
		{filepath.Join(t.TempDir(), "generations", strings.Repeat("d", 32)), 3, 4},
	} {
		_, err := ReadWorkerBootstrap(bytes.NewReader(encoded.Bytes()), tc.directory, tc.listener, tc.lock)
		assert.ErrorIs(t, err, ProtocolIncompatible)
	}
	frame.Payload = jsontext.Value(`{"launchId":"invalid","configurationGeneration":"` + binding.ConfigurationGeneration + `"}`)
	encoded.Reset()
	require.NoError(t, NewEncoder(&encoded).Write(frame))
	_, err = ReadWorkerBootstrap(&encoded, directory, 3, 4)
	assert.ErrorIs(t, err, ProtocolIncompatible)
}

func TestInheritedWorkerDescriptorsCannotRebindOrSubstituteLock(t *testing.T) {
	root := t.TempDir()
	lock, err := (FileLocker{}).Acquire(root)
	require.NoError(t, err)
	defer lock.Close()
	listener, err := net.ListenTCP("tcp4", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)})
	require.NoError(t, err)
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	file, err := listener.File()
	require.NoError(t, err)
	defer file.Close()
	adopted, err := AdoptWorkerDescriptors(file, lock, root, port)
	require.NoError(t, err)
	assert.Equal(t, listener.Addr().String(), adopted.Addr().String())
	require.NoError(t, adopted.Close())
	_, err = AdoptWorkerDescriptors(file, lock, root, port+1)
	assert.ErrorIs(t, err, ProtocolIncompatible)
	foreign, err := os.CreateTemp(t.TempDir(), "foreign-lock")
	require.NoError(t, err)
	defer foreign.Close()
	_, err = AdoptWorkerDescriptors(file, foreign, root, port)
	assert.ErrorIs(t, err, ProtocolIncompatible)
	_, err = (FileLocker{}).Acquire(root)
	assert.ErrorIs(t, err, InstanceBusy)
}

func TestWorkerLifetimeCancelsAndJoinsPrivateReader(t *testing.T) {
	for _, cause := range []string{"eof", "unexpected_frame", "root_cancel"} {
		t.Run(cause, func(t *testing.T) {
			input, output, err := os.Pipe()
			require.NoError(t, err)
			defer output.Close()
			parent, cancel := context.WithCancel(t.Context())
			defer cancel()
			ctx, closeLifetime := WorkerLifetime(parent, input, NewDecoder(input, strings.Repeat("a", 32)))
			switch cause {
			case "eof":
				require.NoError(t, output.Close())
			case "unexpected_frame":
				_, err = io.WriteString(output, "invalid private frame\n")
				require.NoError(t, err)
			case "root_cancel":
				cancel()
			}
			select {
			case <-ctx.Done():
			case <-time.After(time.Second):
				t.Fatal("private lifetime did not cancel root")
			}
			closeLifetime()
			assert.ErrorIs(t, ctx.Err(), context.Canceled)
		})
	}
}
