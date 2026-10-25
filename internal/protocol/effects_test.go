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
	} {
		t.Run(encoded, func(t *testing.T) { var effect Effect; assert.Error(t, json.Unmarshal([]byte(encoded), &effect)) })
	}
	for _, effect := range []Effect{
		{Kind: "palette", Colors: [][]int{{256, 0, 0}}, TransitionMS: 500},
		{Kind: "palette", Colors: [][]int{{0, 0, 0}}, TransitionMS: 499},
		{Kind: "strobe", OnMS: 249, OffMS: 500},
		{Kind: "breathing", MinBrightness: 75, CycleMS: 1000},
		{Kind: "candle", Depth: 101, FlickerMS: 500, Loop: true},
	} {
		assert.Error(t, effect.Validate(75))
	}
}
