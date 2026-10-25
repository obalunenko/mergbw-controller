package controller

import (
	"bytes"
	"context"
	"math"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

type timedFrame struct {
	at    time.Time
	frame []byte
}

// recordLightning records every write with the fake clock and feeds c.random
// from script, cycling. After cancelAt draws it cancels the job from inside
// the run, so the test can check that nothing is written afterwards.
func recordLightning(t *testing.T, link *MockLink, c *Controller, script []float64, cancelAt int) (*[]timedFrame, *[]float64, *int) {
	t.Helper()
	var frames []timedFrame
	var draws []float64
	sentAtCancel := -1
	link.EXPECT().Write(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, frame []byte) error {
		frames = append(frames, timedFrame{c.now(), bytes.Clone(frame)})
		return nil
	}).AnyTimes()
	c.random = func() float64 {
		r := script[len(draws)%len(script)]
		draws = append(draws, r)
		if len(draws) == cancelAt {
			sentAtCancel = len(frames)
			c.transitionMu.Lock()
			c.effect.cancel()
			c.transitionMu.Unlock()
		}
		return r
	}
	return &frames, &draws, &sentAtCancel
}

func between(low, high time.Duration, r float64) time.Duration {
	return low + time.Duration(r*float64(high-low))
}

func scaled(rgb []int, factor float64) []byte {
	out := make([]byte, 3)
	for i, value := range rgb {
		out[i] = byte(math.Round(float64(value) * factor))
	}
	return out
}

func TestLightningStartsOnScaledBackgroundAndEndsBeforeFirstStrike(t *testing.T) {
	link := NewMockLink(gomock.NewController(t))
	link.EXPECT().Connect(gomock.Any()).Return(nil)
	c := fastTransitionController(t, link)
	action := testEffectAction("lightning", false)
	action.Preset.Effect.MinPauseMS, action.Preset.Effect.MaxPauseMS, action.Preset.Effect.DurationMS = 2000, 3000, 1000
	frames, draws, _ := recordLightning(t, link, c, []float64{0.5}, 0)
	accepted, err := c.StartEffect(t.Context(), action)
	require.NoError(t, err)
	outcome := waitEffect(t, c, accepted.ID)
	assert.Equal(t, "completed", outcome.State)
	assert.Equal(t, int64(1000), outcome.ElapsedMS)
	require.Len(t, *frames, 3)
	assert.Equal(t, []byte{0x01, 1}, []byte{(*frames)[0].frame[1], (*frames)[0].frame[4]})
	assert.Equal(t, byte(0x03), (*frames)[1].frame[1])
	assert.Equal(t, []byte{5, 8, 22}, (*frames)[1].frame[4:7])
	assert.Equal(t, []byte{0x05, 75}, []byte{(*frames)[2].frame[1], (*frames)[2].frame[4]})
	assert.Len(t, *draws, 1, "only the first pause is drawn")
}

func TestLightningHundredStrikesFollowScriptedRandomness(t *testing.T) {
	link := NewMockLink(gomock.NewController(t))
	link.EXPECT().Connect(gomock.Any()).Return(nil)
	c := fastTransitionController(t, link)
	action := testEffectAction("lightning", true)
	effect := action.Preset.Effect
	script := []float64{0, 1, 0.5, 0.25, 0.75, 0.125, 0.875, 0.375}
	frames, draws, _ := recordLightning(t, link, c, script, 2000)
	accepted, err := c.StartEffect(t.Context(), action)
	require.NoError(t, err)
	assert.Equal(t, "cancelled", waitEffect(t, c, accepted.ID).State)

	background := scaled(effect.BackgroundRGB, 0.2)
	sent, drawn := (*frames)[3:], *draws
	next := func() float64 { r := drawn[0]; drawn = drawn[1:]; return r }
	previous := (*frames)[2].at
	pauses := map[time.Duration]bool{}
	strikes := 0
	// Walk complete strikes in draw order: pause, count, then per flash the
	// gap (from the second flash), intensity and hold.
	for ; len(drawn) > 10 && len(sent) >= 6; strikes++ {
		r := next()
		pause := time.Duration((float64(effect.MinPauseMS) + r*float64(effect.MaxPauseMS-effect.MinPauseMS)) * float64(time.Millisecond))
		pauses[pause] = true
		require.Equal(t, pause, sent[0].at.Sub(previous), "strike %d pause", strikes)
		flashes := min(effect.MaxFlashes, 1+int(next()*float64(effect.MaxFlashes)))
		require.GreaterOrEqual(t, flashes, 1)
		require.LessOrEqual(t, flashes, effect.MaxFlashes)
		for i := range flashes {
			if i > 0 {
				gap := between(lightningMinGap, lightningMaxGap, next())
				require.Equal(t, gap, sent[0].at.Sub(previous), "strike %d gap %d", strikes, i)
			}
			intensity := lightningMinIntensity + (1-lightningMinIntensity)*next()
			hold := between(lightningMinHold, lightningMaxHold, next())
			flash, back := sent[0], sent[1]
			sent = sent[2:]
			require.Equal(t, byte(0x03), flash.frame[1])
			require.Equal(t, scaled(action.Preset.RGB, intensity), flash.frame[4:7])
			require.Equal(t, byte(0x03), back.frame[1])
			require.Equal(t, background, back.frame[4:7])
			require.Equal(t, hold, back.at.Sub(flash.at))
			previous = back.at
		}
	}
	assert.GreaterOrEqual(t, strikes, 100)
	assert.GreaterOrEqual(t, len(pauses), 2)
	assert.GreaterOrEqual(t, lightningMinHold, 100*time.Millisecond)
	assert.LessOrEqual(t, lightningMaxHold, 180*time.Millisecond)
	assert.GreaterOrEqual(t, lightningMinGap, 60*time.Millisecond)
	assert.LessOrEqual(t, lightningMaxGap, 250*time.Millisecond)
}

func TestLightningCancelSendsNothingFurther(t *testing.T) {
	// Draw 1 is the first pause; draws 3 and 4 are the first flash's
	// intensity (before its write) and hold (after it).
	for name, cancelAt := range map[string]int{"during pause": 1, "before flash": 3, "during hold": 4} {
		t.Run(name, func(t *testing.T) {
			link := NewMockLink(gomock.NewController(t))
			link.EXPECT().Connect(gomock.Any()).Return(nil)
			c := fastTransitionController(t, link)
			frames, _, sentAtCancel := recordLightning(t, link, c, []float64{1}, cancelAt)
			accepted, err := c.StartEffect(t.Context(), testEffectAction("lightning", true))
			require.NoError(t, err)
			assert.Equal(t, "cancelled", waitEffect(t, c, accepted.ID).State)
			assert.Len(t, *frames, *sentAtCancel)
		})
	}
	t.Run("shutdown", func(t *testing.T) {
		link := NewMockLink(gomock.NewController(t))
		link.EXPECT().Connect(gomock.Any()).Return(nil)
		link.EXPECT().Write(gomock.Any(), gomock.Any()).Return(nil).Times(3)
		link.EXPECT().Close().Return(nil)
		c := fastTransitionController(t, link)
		c.random = func() float64 { return 0 }
		paused := pauseJobUntilCancelled(c)
		accepted, err := c.StartEffect(t.Context(), testEffectAction("lightning", true))
		require.NoError(t, err)
		awaitSignal(t, paused)
		require.NoError(t, c.Close(t.Context()))
		assert.Equal(t, "cancelled", waitEffect(t, c, accepted.ID).State)
	})
}

func TestLightningDeadlineInsideStrikeFinishesFlashOnBackground(t *testing.T) {
	link := NewMockLink(gomock.NewController(t))
	link.EXPECT().Connect(gomock.Any()).Return(nil)
	c := fastTransitionController(t, link)
	action := testEffectAction("lightning", false)
	action.Preset.Effect.MinPauseMS, action.Preset.Effect.MaxPauseMS, action.Preset.Effect.DurationMS = 500, 500, 1000
	// Pause 500 ms, three flashes; holds of 180 ms and a 250 ms gap put the
	// second flash across the 1000 ms deadline.
	frames, _, _ := recordLightning(t, link, c, []float64{1}, 0)
	accepted, err := c.StartEffect(t.Context(), action)
	require.NoError(t, err)
	outcome := waitEffect(t, c, accepted.ID)
	assert.Equal(t, "completed", outcome.State)
	assert.Equal(t, int64(1110), outcome.ElapsedMS)
	require.Len(t, *frames, 7)
	last := (*frames)[6].frame
	assert.Equal(t, byte(0x03), last[1])
	assert.Equal(t, []byte{5, 8, 22}, last[4:7])
	assert.Equal(t, []byte{255, 80, 0}, (*frames)[5].frame[4:7])
}
