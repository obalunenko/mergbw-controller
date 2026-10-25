package managed

import (
	"errors"
	"go.uber.org/mock/gomock"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWorkerBluetoothStatusKeepsUnknownReasonsUnknown(t *testing.T) {
	for _, category := range []Code{"", "permission_denied", "bluetooth_unavailable", "backend_restart_required", "disconnected", Code("native secret /private/settings.json")} {
		for _, state := range []string{"unknown", "connected", "disconnected"} {
			status := NewBluetoothStatus(Binding{}, state, category)
			assert.Equal(t, state, status.Bluetooth)
			if category == "permission_denied" || category == "bluetooth_unavailable" || category == "backend_restart_required" {
				assert.Equal(t, category, status.ErrorCategory)
			} else {
				assert.Empty(t, status.ErrorCategory)
			}
		}
	}
	assert.Equal(t, "unknown", NewBluetoothStatus(Binding{}, "native error", "").Bluetooth)
}

func TestWorkerExecutableChecksNeverExecuteCandidate(t *testing.T) {
	directory := t.TempDir()
	missing := filepath.Join(directory, "missing")
	assert.Equal(t, Code("binary_missing"), ValidateExecutable(missing))
	path := filepath.Join(directory, "worker")
	require.NoError(t, os.WriteFile(path, []byte("#!/bin/sh\ntouch should-never-exist\n"), 0o644))
	assert.Equal(t, Code("binary_incompatible"), ValidateExecutable(path))
	require.NoError(t, os.Chmod(path, 0o755))
	assert.Equal(t, Code("binary_incompatible"), ValidateExecutable(path))
	link := filepath.Join(directory, "link")
	require.NoError(t, os.Symlink(path, link))
	assert.Equal(t, Code("binary_incompatible"), ValidateExecutable(link))
	assert.Equal(t, Code("internal_error"), SafeCode(errors.New("token=super-secret")))
	assert.Equal(t, PortConflict, SafeCode(PortConflict))
}

func TestSupervisorPreservesPrelaunchReasonAndSanitizesUnknownLauncherError(t *testing.T) {
	for _, cause := range []error{Code("binary_missing"), Code("binary_incompatible"), errors.New("native secret /private/source/settings.json")} {
		t.Run(SafeCode(cause).Error(), func(t *testing.T) {
			supervisor, launcher, listeners, _ := baselineSupervisor(t)
			port := fixtureReservation(t, listeners)
			require.NoError(t, supervisor.Watch(testFrame()))
			launcher.EXPECT().Start(gomock.Any()).Return(nil, cause)
			_, err := supervisor.Start(t.Context(), LaunchConfiguration{Generation: strings.Repeat("b", 32), Directory: t.TempDir(), Port: port})
			expected := SafeCode(cause)
			if expected == "internal_error" {
				expected = SpawnFailed
			}
			assert.ErrorIs(t, err, expected)
			assert.Equal(t, expected, supervisor.Status().ErrorCategory)
		})
	}
}
