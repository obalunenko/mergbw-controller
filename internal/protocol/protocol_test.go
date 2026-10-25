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
		{"scene"}, {"scene", "disco", "extra"}, {"scene", "94"}, {"scene", "Disco"},
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

func TestResolveScenePackets(t *testing.T) {
	// Scene frames are pinned from contracts/scenes.md; their LT-06 effects are in hardware-verification.md.
	frames := map[string]string{
		"80": "5506ff06801e", "81": "5506ff06811d", "82": "5506ff06821c", "83": "5506ff06831b",
		"84": "5506ff06841a", "85": "5506ff068519", "86": "5506ff068618", "87": "5506ff068717",
		"88": "5506ff068816", "89": "5506ff068915", "8A": "5506ff068a14", "8B": "5506ff068b13",
		"8C": "5506ff068c12", "8D": "5506ff068d11", "8E": "5506ff068e10", "8F": "5506ff068f0f",
		"90": "5506ff06900e", "91": "5506ff06910d", "92": "5506ff06920c", "93": "5506ff06930b",
	}
	tests := []struct {
		selector string
		route    string
		id       string
	}{
		{"red", "scene/red", "80"},
		{"green", "scene/green", "81"},
		{"night", "scene/night", "82"},
		{"sunrise", "scene/sunrise", "83"},
		{"ghost", "scene/ghost", "84"},
		{"pink", "scene/pink", "85"},
		{"warmwhite", "scene/warmwhite", "86"},
		{"disco", "scene/disco", "87"},
		{"party", "scene/party", "88"},
		{"rgbfade", "scene/rgbfade", "89"},
		{"rainbowfade", "scene/rainbowfade", "8A"},
		{"redpulse", "scene/redpulse", "8B"},
		{"greenpulse", "scene/greenpulse", "8C"},
		{"bluepulse", "scene/bluepulse", "8D"},
		{"amberpulse", "scene/amberpulse", "8E"},
		{"icepulse", "scene/icepulse", "8F"},
		{"pinkpulse", "scene/pinkpulse", "90"},
		{"whitepulse", "scene/whitepulse", "91"},
		{"greenredpulse", "scene/greenredpulse", "92"},
		{"blueredpulse", "scene/blueredpulse", "93"},
		{"0x8a", "scene/8A", "8A"},
	}
	for id := range frames {
		tests = append(tests, struct {
			selector string
			route    string
			id       string
		}{id, "scene/" + id, id})
	}
	got := map[string][]string{}
	for _, test := range tests {
		t.Run(test.selector, func(t *testing.T) {
			action, err := protocol.Resolve([]string{"scene", test.selector}, nil)
			require.NoError(t, err)
			assert.Equal(t, test.route, action.Route)
			packets := make([]string, len(action.Packets))
			for i, packet := range action.Packets {
				packets[i] = hex.EncodeToString(packet)
			}
			assert.Equal(t, []string{"5501ff0601a2", frames[test.id]}, packets)
			got[test.selector] = packets
		})
	}
}
