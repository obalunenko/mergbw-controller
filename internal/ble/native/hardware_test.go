//go:build hardware && (darwin || linux)

package native_test

import (
	"context"
	"fmt"
	"maps"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/obalunenko/mergbw-controller/internal/ble"
	"github.com/obalunenko/mergbw-controller/internal/ble/native"
	"github.com/obalunenko/mergbw-controller/internal/config"
	"github.com/obalunenko/mergbw-controller/internal/controller"
	"github.com/obalunenko/mergbw-controller/internal/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// hardwareLink uses the same controller boundary and retry policy as cmd/sunset.
// It wraps the real backend, rather than a unit-test transport double.
type hardwareLink struct{ *ble.Backend }

func (l hardwareLink) Connect(ctx context.Context) error {
	_, err := l.Backend.Connect(ctx)
	return err
}

func (l hardwareLink) CanRetry(err error) bool { return ble.CanRetry(err) }

// TestHardwareLamp inspects and sends real commands on one persistent link.
// Pauses allow visual observation; PASS alone does not verify physical effects.
func TestHardwareLamp(t *testing.T) {
	require.Empty(t, os.Getenv("CI"), "hardware tests must run only locally")
	directory := os.Getenv("MERGBW_DATA_DIR")
	if directory == "" {
		t.Skip("set MERGBW_DATA_DIR to an existing lamp configuration directory")
	}
	settings, presets, err := config.Load(directory)
	require.NoError(t, err)
	backend, err := ble.New(ble.Config{Identity: settings.DeviceIdentity}, native.DefaultAdapter())
	require.NoError(t, err)
	lamp := controller.New(hardwareLink{backend})
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
		defer cancel()
		assert.NoError(t, lamp.Close(ctx))
	})
	require.True(t, t.Run("inspect", func(t *testing.T) {
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
	}), "inspection failed; skipping lighting commands")

	type commandCase struct {
		name   string
		args   []string
		effect string
	}
	cases := []commandCase{
		{"brightness_baseline", []string{"brightness", "100"}, "brightness set to 100%; previous color retained"},
		{"color_baseline", []string{"color", "FFFFFF"}, "white at full brightness"},
		{"off", []string{"off"}, "lamp off"},
		{"on", []string{"on"}, "lamp on with the white/full-brightness baseline"},
		{"color_red", []string{"color", "FF0000"}, "red"},
		{"color_green", []string{"color", "00FF00"}, "green"},
		{"color_blue", []string{"color", "0000FF"}, "blue"},
		{"brightness_zero", []string{"brightness", "0"}, "blue at 0% brightness"},
		{"brightness_half", []string{"brightness", "50"}, "blue at 50% brightness"},
		{"brightness_full", []string{"brightness", "100"}, "blue at 100% brightness"},
	}
	for _, slug := range slices.Sorted(maps.Keys(presets)) {
		preset := presets[slug]
		cases = append(cases, commandCase{"preset_" + slug, []string{"preset", slug}, fmt.Sprintf("RGB %v at %d%% brightness", preset.RGB, preset.Brightness)})
	}
	cases = append(cases, commandCase{"off_final", []string{"off"}, "lamp off at the end of the sequence"})

	for _, test := range cases {
		require.True(t, t.Run(test.name, func(t *testing.T) {
			action, err := protocol.Resolve(test.args, presets)
			require.NoError(t, err)
			t.Logf("Sending %s; expected visual effect: %s", action.Route, test.effect)
			ctx, cancel := context.WithTimeout(t.Context(), 35*time.Second)
			defer cancel()
			require.NoError(t, lamp.Execute(ctx, action))
			t.Logf("Sent %d packet(s); physical effect is unverified. Observe the lamp for 2 seconds.", len(action.Packets))
			timer := time.NewTimer(2 * time.Second)
			defer timer.Stop()
			select {
			case <-timer.C:
			case <-ctx.Done():
				require.NoError(t, ctx.Err())
			}
		}), "command failed; stopping the hardware sequence")
	}
	t.Log("Real Go command transmission checked; record observed effects separately to verify physical power, RGB and brightness.")
}
