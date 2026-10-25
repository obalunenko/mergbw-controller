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

func TestStrobeSeparateIntervalsAndFiniteOffEndpoint(t *testing.T) {
	for _, loop := range []bool{false, true} {
		t.Run(map[bool]string{false: "once", true: "loop"}[loop], func(t *testing.T) {
			link := NewMockLink(gomock.NewController(t))
			link.EXPECT().Connect(gomock.Any()).Return(nil)
			c := fastTransitionController(t, link)
			var powers []byte
			var times []time.Time
			var secondOff atomic.Bool
			paused := make(chan struct{})
			originalPause := c.pause
			c.pause = func(ctx context.Context, delay time.Duration) error {
				if delay > 0 && secondOff.Load() {
					close(paused)
					<-ctx.Done()
					return ctx.Err()
				}
				return originalPause(ctx, delay)
			}
			link.EXPECT().Write(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, frame []byte) error {
				if frame[1] == 1 {
					powers = append(powers, frame[4])
					times = append(times, c.now())
					if len(powers) == 4 {
						secondOff.Store(true)
					}
				}
				return nil
			}).AnyTimes()
			accepted, err := c.StartEffect(t.Context(), testEffectAction("strobe", loop))
			require.NoError(t, err)
			if loop {
				awaitSignal(t, paused)
				stopped, err := c.CancelEffect(t.Context(), accepted.ID)
				require.NoError(t, err)
				assert.Equal(t, "cancelled", stopped.State)
			}
			outcome := waitEffect(t, c, accepted.ID)
			if loop {
				assert.Equal(t, []byte{1, 0, 1, 0}, powers)
				require.Len(t, times, 4)
				assert.Equal(t, 250*time.Millisecond, times[1].Sub(times[0]))
				assert.Equal(t, 500*time.Millisecond, times[2].Sub(times[1]))
				assert.Equal(t, 250*time.Millisecond, times[3].Sub(times[2]))
			} else {
				assert.Equal(t, []byte{1, 0}, powers)
				assert.Equal(t, "completed", outcome.State)
				assert.Equal(t, int64(750), outcome.ElapsedMS)
			}
		})
	}
}
