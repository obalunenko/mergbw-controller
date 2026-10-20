//go:build hardware && (darwin || linux)

package native_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/obalunenko/mergbw-controller/internal/ble"
	"github.com/obalunenko/mergbw-controller/internal/ble/native"
	"github.com/obalunenko/mergbw-controller/internal/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestHardwareInspect establishes a real connection and discovers FFF0/FFF3.
// It sends no lighting packets and does not verify physical power/color state.
func TestHardwareInspect(t *testing.T) {
	require.Empty(t, os.Getenv("CI"), "hardware tests must run only locally")
	directory := os.Getenv("MERGBW_DATA_DIR")
	if directory == "" {
		t.Skip("set MERGBW_DATA_DIR to an existing lamp configuration directory")
	}
	settings, _, err := config.Load(directory)
	require.NoError(t, err)
	backend, err := ble.New(ble.Config{Identity: settings.DeviceIdentity}, native.DefaultAdapter())
	require.NoError(t, err)
	t.Cleanup(func() { assert.NoError(t, backend.Close()) })
	ctx, cancel := context.WithTimeout(t.Context(), 35*time.Second)
	defer cancel()
	info, err := backend.Inspect(ctx)
	require.NoError(t, err)
	assert.True(t, info.Connected)
	assert.Equal(t, ble.ServiceUUID, info.ServiceUUID)
	assert.Equal(t, ble.WriteUUID, info.WriteUUID)
	assert.Contains(t, info.CharacteristicUUIDs, ble.WriteUUID)
	assert.Equal(t, "without_response", info.WriteMode)
	assert.False(t, info.WritePropertiesVerified)
	assert.False(t, info.StateReadback)
	t.Log("Real lamp connection/GATT checked; physical power, RGB and brightness were not checked.")
}
