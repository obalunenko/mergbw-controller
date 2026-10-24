package controller

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

func TestCandleIrregularTargetsRespectDepthSpeedAndDeadline(t *testing.T) {
	link := NewMockLink(gomock.NewController(t))
	link.EXPECT().Connect(gomock.Any()).Return(nil)
	c := fastTransitionController(t, link)
	action := testEffectAction("candle", false)
	action.Preset.Effect.DurationMS = 2000
	random := []float64{0, 1, 0.5, 0.75}
	var times []time.Time
	c.random = func() float64 {
		i := len(times)
		times = append(times, c.now())
		if i >= len(random) {
			t.Error("candle requested a target beyond its finite deadline")
			return 0
		}
		return random[i]
	}
	var brightness []byte
	var colors int
	link.EXPECT().Write(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, frame []byte) error {
		if frame[1] == 5 {
			brightness = append(brightness, frame[4])
		}
		if frame[1] == 3 {
			colors++
		}
		return nil
	}).AnyTimes()
	accepted, err := c.StartEffect(t.Context(), action)
	require.NoError(t, err)
	outcome := waitEffect(t, c, accepted.ID)
	assert.Equal(t, "completed", outcome.State)
	assert.Equal(t, int64(2000), outcome.ElapsedMS)
	assert.Equal(t, []byte{75, 60, 45, 57, 68, 63, 58}, brightness)
	assert.Equal(t, 1, colors)
	require.Len(t, times, 4)
	for i := 1; i < len(times); i++ {
		assert.Equal(t, 500*time.Millisecond, times[i].Sub(times[i-1]))
	}
	for _, level := range brightness {
		assert.GreaterOrEqual(t, int(level), 45)
		assert.LessOrEqual(t, int(level), 75)
	}
}

func TestCandleZeroDepthAvoidsRedundantWritesAndRandomness(t *testing.T) {
	link := NewMockLink(gomock.NewController(t))
	link.EXPECT().Connect(gomock.Any()).Return(nil)
	link.EXPECT().Write(gomock.Any(), gomock.Any()).Return(nil).Times(3)
	c := fastTransitionController(t, link)
	c.random = func() float64 { t.Error("zero depth must not request randomness"); return 0 }
	action := testEffectAction("candle", false)
	action.Preset.Effect.Depth = 0
	accepted, err := c.StartEffect(t.Context(), action)
	require.NoError(t, err)
	assert.Equal(t, "completed", waitEffect(t, c, accepted.ID).State)
}
