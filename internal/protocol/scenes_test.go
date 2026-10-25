package protocol

import (
	"regexp"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestScenesMatchContract(t *testing.T) {
	expected := []Scene{
		{"red", "Red", 0x80},
		{"green", "Green", 0x81},
		{"night", "Night", 0x82},
		{"sunrise", "Sunrise", 0x83},
		{"ghost", "Ghost", 0x84},
		{"pink", "Pink", 0x85},
		{"warmwhite", "Warm White", 0x86},
		{"disco", "Disco", 0x87},
		{"party", "Party", 0x88},
		{"rgbfade", "RGB Fade", 0x89},
		{"rainbowfade", "Rainbow Fade", 0x8a},
		{"redpulse", "Red Pulse", 0x8b},
		{"greenpulse", "Green Pulse", 0x8c},
		{"bluepulse", "Blue Pulse", 0x8d},
		{"amberpulse", "Amber Pulse", 0x8e},
		{"icepulse", "Ice Pulse", 0x8f},
		{"pinkpulse", "Pink Pulse", 0x90},
		{"whitepulse", "White Pulse", 0x91},
		{"greenredpulse", "Green Red Pulse", 0x92},
		{"blueredpulse", "Blue Red Pulse", 0x93},
	}
	got := Scenes()
	require.Equal(t, expected, got)

	slug := regexp.MustCompile(`^[a-z]+$`)
	nonHex := regexp.MustCompile(`[g-z]`)
	seen := map[string]bool{}
	for _, scene := range got {
		assert.False(t, seen[scene.Slug], "duplicate slug %s", scene.Slug)
		seen[scene.Slug] = true
		assert.Regexp(t, slug, scene.Slug)
		assert.Regexp(t, nonHex, scene.Slug, "slug must not look like a hex ID")
	}

	got[0].Slug = "changed"
	assert.Equal(t, "red", Scenes()[0].Slug)
}

func TestParseScene(t *testing.T) {
	for _, scene := range Scenes() {
		route, id, err := parseScene(scene.Slug)
		require.NoError(t, err)
		assert.Equal(t, "scene/"+scene.Slug, route)
		assert.Equal(t, scene.ID, id)
	}
	for selector, want := range map[string]struct {
		route string
		id    byte
	}{
		"80":   {"scene/80", 0x80},
		"8a":   {"scene/8A", 0x8a},
		"8A":   {"scene/8A", 0x8a},
		"0x8A": {"scene/8A", 0x8a},
		"0X92": {"scene/92", 0x92},
		"93":   {"scene/93", 0x93},
	} {
		route, id, err := parseScene(selector)
		require.NoError(t, err, selector)
		assert.Equal(t, want.route, route, selector)
		assert.Equal(t, want.id, id, selector)
	}
	for _, selector := range []string{
		"", "Disco", "green prairie", "green-prairie", "7F", "94", "FF",
		"8", "8G", "0x", "0x080", " disco", "0x0x8A", "+8",
	} {
		_, _, err := parseScene(selector)
		require.Error(t, err, "%q", selector)
		assert.Contains(t, err.Error(), "или ID 80–93")
	}
}
