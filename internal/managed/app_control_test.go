//go:build darwin || linux

package managed

import (
	"net"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func appEndpoint(t *testing.T) (string, *net.UnixListener) {
	t.Helper()
	base := "/tmp"
	if runtime.GOOS == "darwin" {
		base = "/private/tmp"
	}
	directory, err := os.MkdirTemp(base, "mergbw-control-test-")
	require.NoError(t, err)
	t.Cleanup(func() { _ = os.RemoveAll(directory) })
	require.NoError(t, os.Chmod(directory, 0700))
	path := filepath.Join(directory, "control.sock")
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	require.NoError(t, err)
	t.Cleanup(func() { _ = listener.Close() })
	require.NoError(t, os.Chmod(path, 0600))
	return path, listener
}

func TestDialAppControlPrivateEndpoint(t *testing.T) {
	path, listener := appEndpoint(t)
	connection, err := DialAppControl(path)
	require.NoError(t, err)
	defer connection.Close()
	require.NoError(t, listener.SetDeadline(time.Now().Add(time.Second)))
	peer, err := listener.AcceptUnix()
	require.NoError(t, err)
	defer peer.Close()
	_, err = connection.Write([]byte("private\n"))
	require.NoError(t, err)
	bytes := make([]byte, 8)
	require.NoError(t, peer.SetReadDeadline(time.Now().Add(time.Second)))
	n, err := peer.Read(bytes)
	require.NoError(t, err)
	assert.Equal(t, "private\n", string(bytes[:n]))
}

func TestDialAppControlRejectsUnsafeEndpoint(t *testing.T) {
	for _, name := range []string{"relative", "unclean", "basename", "directory-mode", "socket-mode", "directory-symlink", "socket-symlink", "regular-file", "missing", "parent-lost"} {
		t.Run(name, func(t *testing.T) {
			path, listener := appEndpoint(t)
			switch name {
			case "relative":
				path = "control.sock"
			case "unclean":
				path = filepath.Dir(path) + "/./control.sock"
			case "basename":
				path = filepath.Join(filepath.Dir(path), "other.sock")
			case "directory-mode":
				require.NoError(t, os.Chmod(filepath.Dir(path), 0750))
			case "socket-mode":
				require.NoError(t, os.Chmod(path, 0660))
			case "directory-symlink":
				alias := filepath.Dir(path) + "-alias"
				require.NoError(t, os.Symlink(filepath.Dir(path), alias))
				t.Cleanup(func() { _ = os.Remove(alias) })
				path = filepath.Join(alias, "control.sock")
			case "socket-symlink":
				original := path + ".original"
				require.NoError(t, os.Rename(path, original))
				require.NoError(t, os.Symlink(original, path))
			case "regular-file":
				require.NoError(t, listener.Close())
				require.NoError(t, os.WriteFile(path, nil, 0600))
			case "missing":
				require.NoError(t, listener.Close())
			case "parent-lost":
				listener.SetUnlinkOnClose(false)
				require.NoError(t, listener.Close())
			}
			started := time.Now()
			connection, err := DialAppControl(path)
			require.ErrorIs(t, err, HostUnavailable)
			assert.Nil(t, connection)
			assert.Less(t, time.Since(started), 4*time.Second)
			assert.NotContains(t, err.Error(), path)
		})
	}
}
