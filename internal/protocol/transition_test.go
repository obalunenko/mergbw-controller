package protocol

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTransitionResolveBoundaries(t *testing.T) {
	for _, duration := range []string{"1", "60"} {
		action, err := Resolve([]string{"transition", "ff5000", "100", "000000", "0", duration}, nil)
		require.NoError(t, err)
		require.NotNil(t, action.Transition)
		assert.Equal(t, [3]int{255, 80, 0}, action.Transition.FromRGB)
		assert.Contains(t, action.Route, "transition/FF5000/100/000000/0/")
		assert.Empty(t, action.Packets)
	}
	for _, args := range [][]string{
		{"FF5000", "100", "000000", "0", "0"},
		{"FF5000", "100", "000000", "0", "61"},
		{"FF5000", "100", "000000", "0", "1.5"},
		{"FF5000", "100", "000000", "0", "-1"},
		{"FF5000", "101", "000000", "0", "30"},
		{"#FF5000", "100", "000000", "0", "30"},
		{"FFXX00", "100", "000000", "0", "30"},
		{"FF5000", "100", "000000", "0"},
	} {
		_, err := Resolve(append([]string{"transition"}, args...), nil)
		require.Error(t, err, args)
	}
}

func TestTransitionLinearSamplesAndExactEndpoints(t *testing.T) {
	spec := Transition{FromRGB: [3]int{255, 1, 0}, FromBrightness: 100, ToRGB: [3]int{0, 2, 255}, ToBrightness: 0, DurationSeconds: 60}
	require.NoError(t, spec.Validate())
	rgb, brightness := spec.Sample(-time.Second)
	assert.Equal(t, spec.FromRGB, rgb)
	assert.Equal(t, 100, brightness)
	rgb, brightness = spec.Sample(30 * time.Second)
	assert.Equal(t, [3]int{128, 2, 128}, rgb)
	assert.Equal(t, 50, brightness)
	rgb, brightness = spec.Sample(61 * time.Second)
	assert.Equal(t, spec.ToRGB, rgb)
	assert.Zero(t, brightness)
	assert.Len(t, spec.InitialPackets(), 3)
	assert.Equal(t, packet(0x01, 1), spec.InitialPackets()[0])
}
