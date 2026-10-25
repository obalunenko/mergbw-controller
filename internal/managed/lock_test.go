//go:build darwin || linux

package managed

import (
	"net"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInheritedLockRetainsStableInodeUntilEveryCopyCloses(t *testing.T) {
	directory := t.TempDir()
	locker := FileLocker{}
	first, err := locker.Acquire(directory)
	require.NoError(t, err)
	before, err := first.Stat()
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0600), before.Mode().Perm())
	copy, err := DuplicateFile(first)
	require.NoError(t, err)
	defer copy.Close()
	require.NoError(t, first.Close())
	_, err = locker.Acquire(directory)
	assert.ErrorIs(t, err, InstanceBusy)
	require.NoError(t, copy.Close())
	second, err := locker.Acquire(directory)
	require.NoError(t, err)
	defer second.Close()
	after, err := second.Stat()
	require.NoError(t, err)
	assert.True(t, os.SameFile(before, after))
}

func TestLockRejectsSymlink(t *testing.T) {
	directory := t.TempDir()
	target := filepath.Join(t.TempDir(), "foreign")
	require.NoError(t, os.WriteFile(target, []byte("foreign"), 0600))
	require.NoError(t, os.Symlink(target, filepath.Join(directory, "runtime.lock")))
	_, err := (FileLocker{}).Acquire(directory)
	assert.Error(t, err)
	data, err := os.ReadFile(target)
	require.NoError(t, err)
	assert.Equal(t, "foreign", string(data))
}

func TestForeignPortAndDuplicatedReservation(t *testing.T) {
	foreign, err := net.ListenTCP("tcp4", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)})
	require.NoError(t, err)
	defer foreign.Close()
	port := foreign.Addr().(*net.TCPAddr).Port
	_, err = (LoopbackListeners{}).Listen(port)
	assert.ErrorIs(t, err, PortConflict)
	require.NoError(t, foreign.Close())
	reservation, err := (LoopbackListeners{}).Listen(port)
	require.NoError(t, err)
	copy, err := reservation.Duplicate()
	require.NoError(t, err)
	defer copy.Close()
	require.NoError(t, reservation.Close())
	_, err = (LoopbackListeners{}).Listen(port)
	assert.ErrorIs(t, err, PortConflict)
	require.NoError(t, copy.Close())
	replacement, err := (LoopbackListeners{}).Listen(port)
	require.NoError(t, err)
	require.NoError(t, replacement.Close())
}
