package protocol

import (
	"encoding/json/v2"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEffectVariantsRoundTripAndResolve(t *testing.T) {
	for _, encoded := range []string{
		`{"kind":"palette","loop":true,"colors":[[0,0,255]],"transitionMs":500}`,
		`{"kind":"strobe","loop":false,"onMs":250,"offMs":500}`,
		`{"kind":"breathing","loop":false,"minBrightness":0,"cycleMs":1000}`,
		`{"kind":"candle","loop":false,"depth":0,"flickerMs":250,"durationMs":1000}`,
		`{"kind":"lightning","loop":true,"backgroundRgb":[26,42,108],"backgroundBrightness":15,"minPauseMs":2000,"maxPauseMs":15000,"maxFlashes":3}`,
		`{"kind":"lightning","loop":false,"backgroundRgb":[0,0,0],"backgroundBrightness":0,"minPauseMs":500,"maxPauseMs":500,"maxFlashes":1,"durationMs":1000}`,
	} {
		t.Run(encoded, func(t *testing.T) {
			var effect Effect
			require.NoError(t, json.Unmarshal([]byte(encoded), &effect))
			preset := Preset{Label: "Effect", RGB: []int{255, 80, 0}, Brightness: 75, Effect: &effect}
			require.NoError(t, ValidatePresets(map[string]Preset{"test": preset}))
			data, err := json.Marshal(effect)
			require.NoError(t, err)
			var decoded Effect
			require.NoError(t, json.Unmarshal(data, &decoded))
			assert.Equal(t, effect, decoded)
			action, err := Resolve([]string{"preset", "test"}, map[string]Preset{"test": preset})
			require.NoError(t, err)
			require.NotNil(t, action.Effect)
			assert.Empty(t, action.Packets)
			assert.Equal(t, "test", action.Effect.PresetID)
			if effect.Loop {
				assert.Nil(t, action.Effect.DurationMS())
			} else {
				require.NotNil(t, action.Effect.DurationMS())
				assert.Positive(t, *action.Effect.DurationMS())
			}
			if len(effect.Colors) > 0 {
				effect.Colors[0][0] = 99
				assert.Equal(t, 0, action.Effect.Preset.Effect.Colors[0][0])
			}
			if len(effect.BackgroundRGB) > 0 {
				effect.BackgroundRGB[0] = 99
				assert.NotEqual(t, 99, action.Effect.Preset.Effect.BackgroundRGB[0])
			}
		})
	}
}

func TestEffectRejectsMissingNullForeignAndInvalidParameters(t *testing.T) {
	for _, encoded := range []string{
		`null`,
		`{"kind":"strobe","onMs":500,"offMs":500}`,
		`{"kind":"strobe","loop":null,"onMs":500,"offMs":500}`,
		`{"kind":"strobe","loop":true,"onMs":null,"offMs":500}`,
		`{"kind":"strobe","loop":true,"onMs":500,"offMs":500,"depth":0}`,
		`{"kind":"breathing","loop":true,"cycleMs":1000}`,
		`{"kind":"candle","loop":true,"depth":5,"flickerMs":500,"durationMs":1000}`,
		`{"kind":"rainbow","loop":true}`,
		`{"kind":"lightning","loop":true,"backgroundBrightness":15,"minPauseMs":2000,"maxPauseMs":15000,"maxFlashes":3}`,
		`{"kind":"lightning","loop":true,"backgroundRgb":null,"backgroundBrightness":15,"minPauseMs":2000,"maxPauseMs":15000,"maxFlashes":3}`,
		`{"kind":"lightning","loop":true,"backgroundRgb":[0,0,0],"backgroundBrightness":15,"minPauseMs":2000,"maxPauseMs":15000,"maxFlashes":3,"depth":0}`,
		`{"kind":"lightning","loop":true,"backgroundRgb":[0,0,0],"backgroundBrightness":15,"minPauseMs":2000,"maxPauseMs":15000,"maxFlashes":3,"durationMs":1000}`,
		`{"kind":"lightning","loop":false,"backgroundRgb":[0,0,0],"backgroundBrightness":15,"minPauseMs":2000,"maxPauseMs":15000,"maxFlashes":3}`,
	} {
		t.Run(encoded, func(t *testing.T) { var effect Effect; assert.Error(t, json.Unmarshal([]byte(encoded), &effect)) })
	}
	for _, effect := range []Effect{
		{Kind: "palette", Colors: [][]int{{256, 0, 0}}, TransitionMS: 500},
		{Kind: "palette", Colors: [][]int{{0, 0, 0}}, TransitionMS: 499},
		{Kind: "strobe", OnMS: 249, OffMS: 500},
		{Kind: "breathing", MinBrightness: 75, CycleMS: 1000},
		{Kind: "candle", Depth: 101, FlickerMS: 500, Loop: true},
		{Kind: "strobe", OnMS: 500, OffMS: 500, MaxFlashes: 1},
	} {
		assert.Error(t, effect.Validate(75))
	}
	lightning := func(edit func(*Effect)) Effect {
		effect := Effect{Kind: "lightning", Loop: true, BackgroundRGB: []int{26, 42, 108}, BackgroundBrightness: 15, MinPauseMS: 2000, MaxPauseMS: 15000, MaxFlashes: 3}
		edit(&effect)
		return effect
	}
	require.NoError(t, lightning(func(*Effect) {}).Validate(75))
	for name, edit := range map[string]func(*Effect){
		"min pause above max":           func(e *Effect) { e.MinPauseMS = 15001 },
		"pause 499":                     func(e *Effect) { e.MinPauseMS = 499 },
		"pause 120001":                  func(e *Effect) { e.MaxPauseMS = 120001 },
		"zero flashes":                  func(e *Effect) { e.MaxFlashes = 0 },
		"six flashes":                   func(e *Effect) { e.MaxFlashes = 6 },
		"background equals flash":       func(e *Effect) { e.BackgroundBrightness = 75 },
		"background channel 256":        func(e *Effect) { e.BackgroundRGB = []int{256, 0, 0} },
		"two background channels":       func(e *Effect) { e.BackgroundRGB = []int{0, 0} },
		"duration while looping":        func(e *Effect) { e.DurationMS = 1000 },
		"finite without duration":       func(e *Effect) { e.Loop = false },
		"finite duration above an hour": func(e *Effect) { e.Loop, e.DurationMS = false, 3600001 },
		"foreign candle field":          func(e *Effect) { e.FlickerMS = 250 },
	} {
		t.Run(name, func(t *testing.T) { assert.Error(t, lightning(edit).Validate(75)) })
	}
	t.Run("flash brightness 0", func(t *testing.T) {
		assert.Error(t, lightning(func(e *Effect) { e.BackgroundBrightness = 0 }).Validate(0))
	})
}
