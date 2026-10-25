package protocol

import (
	"fmt"
	"strconv"
	"strings"
)

type Scene struct {
	Slug  string
	Label string
	ID    byte
}

const (
	sceneCommand = 0x06
	minSceneID   = 0x80
	maxSceneID   = 0x93
)

// Scene IDs come from the King1704G reference control.py. Names describe the
// effect observed on the LT-06, since most reference names did not match it.
var scenes = []Scene{
	{Slug: "red", Label: "Red", ID: 0x80},
	{Slug: "green", Label: "Green", ID: 0x81},
	{Slug: "night", Label: "Night", ID: 0x82},
	{Slug: "sunrise", Label: "Sunrise", ID: 0x83},
	{Slug: "ghost", Label: "Ghost", ID: 0x84},
	{Slug: "pink", Label: "Pink", ID: 0x85},
	{Slug: "warmwhite", Label: "Warm White", ID: 0x86},
	{Slug: "disco", Label: "Disco", ID: 0x87},
	{Slug: "party", Label: "Party", ID: 0x88},
	{Slug: "rgbfade", Label: "RGB Fade", ID: 0x89},
	{Slug: "rainbowfade", Label: "Rainbow Fade", ID: 0x8a},
	{Slug: "redpulse", Label: "Red Pulse", ID: 0x8b},
	{Slug: "greenpulse", Label: "Green Pulse", ID: 0x8c},
	{Slug: "bluepulse", Label: "Blue Pulse", ID: 0x8d},
	{Slug: "amberpulse", Label: "Amber Pulse", ID: 0x8e},
	{Slug: "icepulse", Label: "Ice Pulse", ID: 0x8f},
	{Slug: "pinkpulse", Label: "Pink Pulse", ID: 0x90},
	{Slug: "whitepulse", Label: "White Pulse", ID: 0x91},
	{Slug: "greenredpulse", Label: "Green Red Pulse", ID: 0x92},
	{Slug: "blueredpulse", Label: "Blue Red Pulse", ID: 0x93},
}

// Scenes returns the built-in scene catalog in reference order.
func Scenes() []Scene {
	return append([]Scene(nil), scenes...)
}

// parseScene accepts an exact catalog slug or a raw ID 80–93 with an optional 0x prefix.
func parseScene(selector string) (string, byte, error) {
	for _, scene := range scenes {
		if scene.Slug == selector {
			return "scene/" + scene.Slug, scene.ID, nil
		}
	}
	digits := selector
	if strings.HasPrefix(digits, "0x") || strings.HasPrefix(digits, "0X") {
		digits = digits[2:]
	}
	if len(digits) == 2 {
		if value, err := strconv.ParseUint(digits, 16, 8); err == nil && value >= minSceneID && value <= maxSceneID {
			return fmt.Sprintf("scene/%02X", value), byte(value), nil
		}
	}
	slugs := make([]string, len(scenes))
	for i, scene := range scenes {
		slugs[i] = scene.Slug
	}
	return "", 0, fmt.Errorf("неизвестная сцена; доступны: %s или ID 80–93", strings.Join(slugs, ", "))
}
