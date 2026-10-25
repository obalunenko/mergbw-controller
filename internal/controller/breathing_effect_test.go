package controller

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

func TestBreathingReachesBothBoundsWithoutChangingColor(t *testing.T) {
	for _, loop := range []bool{false, true} {
		t.Run(map[bool]string{false: "once", true: "loop"}[loop], func(t *testing.T) {
			link := NewMockLink(gomock.NewController(t))
			link.EXPECT().Connect(gomock.Any()).Return(nil)
			c := fastTransitionController(t, link)
			action := testEffectAction("breathing", loop)
			action.Preset.Brightness = 100
			action.Preset.Effect.MinBrightness = 0
			var brightness []byte
			var colors [][]byte
			var cyclesDone atomic.Bool
			paused := make(chan struct{})
			originalPause := c.pause
			c.pause = func(ctx context.Context, delay time.Duration) error {
				if delay > 0 && cyclesDone.Load() {
					close(paused)
					<-ctx.Done()
					return ctx.Err()
				}
				return originalPause(ctx, delay)
			}
			link.EXPECT().Write(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, frame []byte) error {
				if frame[1] == 5 {
					brightness = append(brightness, frame[4])
					if len(brightness) == 9 {
						cyclesDone.Store(true)
					}
				}
				if frame[1] == 3 {
					colors = append(colors, append([]byte(nil), frame[4:7]...))
				}
				return nil
			}).AnyTimes()
			accepted, err := c.StartEffect(t.Context(), action)
			require.NoError(t, err)
			if loop {
				awaitSignal(t, paused)
				_, err = c.CancelEffect(t.Context(), accepted.ID)
				require.NoError(t, err)
			}
			outcome := waitEffect(t, c, accepted.ID)
			expected := []byte{0, 50, 100, 50, 0}
			if loop {
				expected = append(expected, 50, 100, 50, 0)
				assert.Equal(t, "cancelled", outcome.State)
			} else {
				assert.Equal(t, "completed", outcome.State)
			}
			assert.Equal(t, expected, brightness)
			assert.Equal(t, [][]byte{{255, 80, 0}}, colors)
		})
	}
}
