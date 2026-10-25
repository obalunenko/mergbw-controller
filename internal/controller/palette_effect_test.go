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

func TestPaletteThreeColorOrderAndSmoothClosingSegment(t *testing.T) {
	for _, loop := range []bool{false, true} {
		t.Run(map[bool]string{false: "once", true: "loop"}[loop], func(t *testing.T) {
			link := NewMockLink(gomock.NewController(t))
			link.EXPECT().Connect(gomock.Any()).Return(nil)
			c := fastTransitionController(t, link)
			action := testEffectAction("palette", loop)
			action.Preset.RGB = []int{255, 0, 0}
			action.Preset.Effect.Colors = [][]int{{0, 255, 0}, {0, 0, 255}}
			var colors [][]byte
			var closed atomic.Bool
			paused := make(chan struct{})
			originalPause := c.pause
			c.pause = func(ctx context.Context, delay time.Duration) error {
				if delay > 0 && closed.Load() {
					close(paused)
					<-ctx.Done()
					return ctx.Err()
				}
				return originalPause(ctx, delay)
			}
			link.EXPECT().Write(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, frame []byte) error {
				if frame[1] == 3 {
					colors = append(colors, append([]byte(nil), frame[4:7]...))
					if len(colors) == 7 {
						closed.Store(true)
					}
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
			expected := [][]byte{{255, 0, 0}, {128, 128, 0}, {0, 255, 0}, {0, 128, 128}, {0, 0, 255}}
			if loop {
				expected = append(expected, []byte{128, 0, 128}, []byte{255, 0, 0})
				assert.Equal(t, "cancelled", outcome.State)
			} else {
				assert.Equal(t, "completed", outcome.State)
			}
			assert.Equal(t, expected, colors)
		})
	}
}
