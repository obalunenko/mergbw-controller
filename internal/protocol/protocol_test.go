package protocol_test

import (
	"encoding/hex"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/obalunenko/mergbw-controller/internal/protocol"
)

func TestResolveKnownPackets(t *testing.T) {
	presets := map[string]protocol.Preset{
		"sunset": {Label: "Закат", RGB: []int{255, 80, 0}, Brightness: 50},
	}
	// Power vectors were confirmed on the lamp. RGB/brightness vectors check
	// compatibility with the source protocol; they are not hardware results.
	tests := []struct {
		args    []string
		route   string
		packets []string
	}{
		{[]string{"off"}, "off", []string{"5501ff0600a3"}},
		{[]string{"on"}, "on", []string{"5501ff0601a2"}},
		{[]string{"color", "#ff5000"}, "color/FF5000", []string{"5501ff0601a2", "5503ff08ff50004f"}},
		{[]string{"brightness", "50"}, "brightness/50", []string{"5501ff0601a2", "5505ff06326d"}},
		{[]string{"brightness", "0"}, "brightness/0", []string{"5501ff0601a2", "5505ff06009f"}},
		{[]string{"brightness", "100"}, "brightness/100", []string{"5501ff0601a2", "5505ff06643b"}},
		{[]string{"preset", "sunset"}, "preset/sunset", []string{"5501ff0601a2", "5503ff08ff50004f", "5505ff06326d"}},
	}
	for _, test := range tests {
		t.Run(test.route, func(t *testing.T) {
			action, err := protocol.Resolve(test.args, presets)
			require.NoError(t, err)
			assert.Equal(t, test.route, action.Route)
			got := make([]string, len(action.Packets))
			for i, packet := range action.Packets {
				got[i] = hex.EncodeToString(packet)
			}
			assert.Equal(t, test.packets, got)
		})
	}
}

func TestInvalidCommandProducesNoPackets(t *testing.T) {
	for _, args := range [][]string{
		nil, {"on", "1"}, {"off", "extra"}, {"toggle"}, {"unknown", "1"},
		{"color"}, {"color", "FFF"}, {"color", "GG0000"}, {"color", "##FF5000"},
		{"color", "FF5000", "extra"}, {"color", " FF5000"},
		{"brightness", "-1"}, {"brightness", "101"}, {"brightness", "256"},
		{"brightness", "+1"}, {"brightness", "1.5"}, {"brightness", "1e2"},
		{"brightness", ""}, {"brightness", " 50"}, {"brightness", "１００"},
		{"preset", "missing"},
	} {
		action, err := protocol.Resolve(args, nil)
		assert.Error(t, err, "Resolve(%q)", args)
		assert.Empty(t, action.Packets, "invalid input must produce no packets: %q", args)
	}
}

func TestInvalidPresetProducesNoPackets(t *testing.T) {
	for _, preset := range []protocol.Preset{
		{RGB: nil, Brightness: 50},
		{RGB: []int{0, 0}, Brightness: 50},
		{RGB: []int{0, 0, 0, 0}, Brightness: 50},
		{RGB: []int{-1, 0, 0}, Brightness: 50},
		{RGB: []int{0, 256, 0}, Brightness: 50},
		{RGB: []int{0, 0, 0}, Brightness: -1},
		{RGB: []int{255, 255, 255}, Brightness: 101},
	} {
		preset.Label = "Test"
		presets := map[string]protocol.Preset{"bad": preset}
		assert.Error(t, protocol.ValidatePresets(presets), "preset: %+v", preset)
		action, err := protocol.Resolve([]string{"preset", "bad"}, presets)
		assert.Error(t, err, "preset: %+v", preset)
		assert.Empty(t, action.Packets)
	}
}
