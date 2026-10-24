package controller

import (
	"bytes"
	"context"
	"errors"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/obalunenko/mergbw-controller/internal/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

func testEffectAction(kind string, loop bool) protocol.EffectAction {
	effect := &protocol.Effect{Kind: kind, Loop: loop}
	switch kind {
	case "palette":
		effect.Colors, effect.TransitionMS = [][]int{{0, 0, 255}}, 500
	case "strobe":
		effect.OnMS, effect.OffMS = 250, 500
	case "breathing":
		effect.MinBrightness, effect.CycleMS = 5, 1000
	case "candle":
		effect.Depth, effect.FlickerMS = 40, 500
		if !loop {
			effect.DurationMS = 1000
		}
	}
	return protocol.EffectAction{PresetID: "test-effect", Preset: protocol.Preset{Label: "Test effect", RGB: []int{255, 80, 0}, Brightness: 75, Effect: effect}}
}

func waitEffect(t *testing.T, c *Controller, id string) protocol.EffectSnapshot {
	t.Helper()
	c.transitionMu.Lock()
	job := c.effect
	require.NotNil(t, job)
	actualID := job.snapshot.ID
	c.transitionMu.Unlock()
	require.Equal(t, id, actualID)
	select {
	case <-job.done:
	case <-time.After(2 * time.Second):
		require.FailNow(t, "effect did not finish")
	}
	c.transitionMu.Lock()
	snapshot := effectSnapshot(c.snapshotLocked(job), *job.effect)
	c.transitionMu.Unlock()
	return snapshot
}

func TestFiniteEffectsCompleteWithHonestSnapshotsAndEndpoints(t *testing.T) {
	for _, kind := range []string{"palette", "strobe", "breathing", "candle"} {
		t.Run(kind, func(t *testing.T) {
			link := NewMockLink(gomock.NewController(t))
			link.EXPECT().Connect(gomock.Any()).Return(nil)
			var frames [][]byte
			link.EXPECT().Write(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, frame []byte) error {
				frames = append(frames, bytes.Clone(frame))
				return nil
			}).AnyTimes()
			c := fastTransitionController(t, link)
			c.random = func() float64 { return 1 }
			accepted, err := c.StartEffect(t.Context(), testEffectAction(kind, false))
			require.NoError(t, err)
			assert.Equal(t, "running", accepted.State)
			assert.Equal(t, kind, accepted.Kind)
			assert.Equal(t, "test-effect", accepted.PresetID)
			assert.False(t, accepted.PhysicalStateVerified)
			require.NotNil(t, accepted.DurationMS)
			completed := waitEffect(t, c, accepted.ID)
			assert.Equal(t, "completed", completed.State)
			assert.GreaterOrEqual(t, completed.ElapsedMS, *completed.DurationMS)
			assert.False(t, completed.PhysicalStateVerified)
			assert.Nil(t, c.TransitionStatus())
			require.GreaterOrEqual(t, len(frames), 4)
			switch kind {
			case "palette":
				assert.Equal(t, byte(0x03), frames[len(frames)-1][1])
				assert.Equal(t, []byte{0, 0, 255}, frames[len(frames)-1][4:7])
			case "strobe":
				assert.Equal(t, byte(0x01), frames[len(frames)-1][1])
				assert.Equal(t, byte(0), frames[len(frames)-1][4])
			case "breathing":
				assert.Equal(t, byte(0x05), frames[len(frames)-1][1])
				assert.Equal(t, byte(5), frames[len(frames)-1][4])
			case "candle":
				assert.Equal(t, byte(0x05), frames[len(frames)-1][1])
				assert.Equal(t, byte(45), frames[len(frames)-1][4])
			}
		})
	}
}

func pauseJobUntilCancelled(c *Controller) <-chan struct{} {
	paused := make(chan struct{}, 1)
	c.pause = func(ctx context.Context, delay time.Duration) error {
		if delay <= 0 {
			return ctx.Err()
		}
		select {
		case paused <- struct{}{}:
		default:
		}
		<-ctx.Done()
		return ctx.Err()
	}
	return paused
}

func TestEffectRequestContextValidationAndExactCancellation(t *testing.T) {
	link := NewMockLink(gomock.NewController(t))
	link.EXPECT().Connect(gomock.Any()).Return(nil)
	link.EXPECT().Write(gomock.Any(), gomock.Any()).Return(nil).Times(3)
	c := fastTransitionController(t, link)
	paused := pauseJobUntilCancelled(c)
	requestCtx, cancelRequest := context.WithCancel(t.Context())
	accepted, err := c.StartEffect(requestCtx, testEffectAction("palette", true))
	require.NoError(t, err)
	awaitSignal(t, paused)
	assert.Nil(t, accepted.DurationMS)
	cancelRequest()
	assert.Equal(t, "running", c.EffectStatus().State)
	invalid := testEffectAction("palette", true)
	invalid.Preset.Effect.Colors = nil
	_, err = c.StartEffect(t.Context(), invalid)
	require.Error(t, err)
	assert.Equal(t, accepted.ID, c.EffectStatus().ID)
	assert.Equal(t, "running", c.EffectStatus().State)
	_, err = c.CancelEffect(t.Context(), "stale")
	assert.ErrorIs(t, err, protocol.ErrEffectNotFound)
	assert.Equal(t, "running", c.EffectStatus().State)
	stopped, err := c.CancelEffect(t.Context(), accepted.ID)
	require.NoError(t, err)
	assert.Equal(t, "cancelled", stopped.State)
	assert.False(t, stopped.PhysicalStateVerified)
}

func TestEffectAndTransitionKeepSeparateLatestSnapshots(t *testing.T) {
	link := NewMockLink(gomock.NewController(t))
	link.EXPECT().Connect(gomock.Any()).Return(nil).Times(2)
	link.EXPECT().Write(gomock.Any(), gomock.Any()).Return(nil).Times(6)
	c := fastTransitionController(t, link)
	paused := pauseJobUntilCancelled(c)
	effect, err := c.StartEffect(t.Context(), testEffectAction("breathing", true))
	require.NoError(t, err)
	awaitSignal(t, paused)
	transition, err := c.StartTransition(t.Context(), transitionSpec())
	require.NoError(t, err)
	awaitSignal(t, paused)
	assert.Equal(t, "cancelled", c.EffectStatus().State)
	assert.Equal(t, transition.ID, c.TransitionStatus().ID)
	assert.Equal(t, "running", c.TransitionStatus().State)
	old, err := c.CancelEffect(t.Context(), effect.ID)
	require.NoError(t, err)
	assert.Equal(t, "cancelled", old.State)
	assert.Equal(t, "running", c.TransitionStatus().State)
	_, err = c.CancelTransition(t.Context(), transition.ID)
	require.NoError(t, err)
	assert.Equal(t, "cancelled", c.TransitionStatus().State)
	assert.Equal(t, effect.ID, c.EffectStatus().ID)
}

func TestOrdinaryCommandDrainsStartedEffectWriteBeforeExecuting(t *testing.T) {
	link := NewMockLink(gomock.NewController(t))
	link.EXPECT().Connect(gomock.Any()).Return(nil).Times(2)
	entered, release := make(chan struct{}), make(chan struct{})
	var writes atomic.Int32
	link.EXPECT().Write(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, _ []byte) error {
		if writes.Add(1) == 1 {
			close(entered)
			<-release
		}
		return nil
	}).Times(2)
	c := fastTransitionController(t, link)
	accepted, err := c.StartEffect(t.Context(), testEffectAction("strobe", true))
	require.NoError(t, err)
	awaitSignal(t, entered)
	off, err := protocol.Resolve([]string{"off"}, nil)
	require.NoError(t, err)
	done := make(chan error, 1)
	go func() { done <- c.Execute(t.Context(), off) }()
	require.Eventually(t, func() bool { return c.EffectStatus().State == "cancelling" }, time.Second, time.Millisecond)
	assert.Equal(t, int32(1), writes.Load())
	close(release)
	require.NoError(t, <-done)
	assert.Equal(t, "unknown", waitEffect(t, c, accepted.ID).State)
	assert.Equal(t, int32(2), writes.Load())
}

func TestEffectWriteFailureIsUnknownAndNeverRetried(t *testing.T) {
	for _, failAt := range []int{1, 2, 3, 4} {
		t.Run(strconv.Itoa(failAt), func(t *testing.T) {
			link := NewMockLink(gomock.NewController(t))
			link.EXPECT().Connect(gomock.Any()).Return(nil)
			writes := 0
			link.EXPECT().Write(gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, []byte) error {
				writes++
				if writes == failAt {
					return errors.New("uncertain")
				}
				return nil
			}).Times(failAt)
			c := fastTransitionController(t, link)
			accepted, err := c.StartEffect(t.Context(), testEffectAction("strobe", false))
			require.NoError(t, err)
			assert.Equal(t, "unknown", waitEffect(t, c, accepted.ID).State)
		})
	}
}

func TestEffectConnectFailureAndRootStopDoNotReplayOrSendOff(t *testing.T) {
	t.Run("connect failure", func(t *testing.T) {
		link := NewMockLink(gomock.NewController(t))
		link.EXPECT().Connect(gomock.Any()).Return(errors.New("unavailable"))
		c := fastTransitionController(t, link)
		accepted, err := c.StartEffect(t.Context(), testEffectAction("candle", true))
		require.NoError(t, err)
		assert.Equal(t, "failed", waitEffect(t, c, accepted.ID).State)
	})
	t.Run("root stop", func(t *testing.T) {
		link := NewMockLink(gomock.NewController(t))
		link.EXPECT().Connect(gomock.Any()).Return(nil)
		link.EXPECT().Write(gomock.Any(), gomock.Any()).Return(nil).Times(3)
		link.EXPECT().Close().Return(nil)
		c := fastTransitionController(t, link)
		paused := pauseJobUntilCancelled(c)
		accepted, err := c.StartEffect(t.Context(), testEffectAction("candle", true))
		require.NoError(t, err)
		awaitSignal(t, paused)
		require.NoError(t, c.Close(t.Context()))
		assert.Equal(t, "cancelled", waitEffect(t, c, accepted.ID).State)
		_, err = c.StartEffect(t.Context(), testEffectAction("candle", true))
		require.Error(t, err)
	})
}

func TestEffectCapturesDefinitionAndReturnsIndependentDuration(t *testing.T) {
	link := NewMockLink(gomock.NewController(t))
	link.EXPECT().Connect(gomock.Any()).Return(nil)
	entered, release := make(chan struct{}), make(chan struct{})
	var frames [][]byte
	link.EXPECT().Write(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, frame []byte) error {
		frames = append(frames, bytes.Clone(frame))
		if len(frames) == 1 {
			close(entered)
			<-release
		}
		return nil
	}).AnyTimes()
	c := fastTransitionController(t, link)
	action := testEffectAction("palette", false)
	accepted, err := c.StartEffect(t.Context(), action)
	require.NoError(t, err)
	awaitSignal(t, entered)
	action.Preset.RGB[0] = 1
	action.Preset.Effect.Colors[0][2] = 1
	*accepted.DurationMS = 9999
	assert.Equal(t, int64(500), *c.EffectStatus().DurationMS)
	close(release)
	completed := waitEffect(t, c, accepted.ID)
	assert.Equal(t, "completed", completed.State)
	assert.Equal(t, []byte{255, 80, 0}, frames[1][4:7])
	assert.Equal(t, []byte{0, 0, 255}, frames[len(frames)-1][4:7])
}

func TestEffectCancelTimeoutKeepsStartedNativeWriteOwned(t *testing.T) {
	link := NewMockLink(gomock.NewController(t))
	link.EXPECT().Connect(gomock.Any()).Return(nil)
	entered, release := make(chan struct{}), make(chan struct{})
	link.EXPECT().Write(gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, []byte) error {
		close(entered)
		<-release
		return nil
	})
	c := fastTransitionController(t, link)
	accepted, err := c.StartEffect(t.Context(), testEffectAction("palette", true))
	require.NoError(t, err)
	awaitSignal(t, entered)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Millisecond)
	defer cancel()
	_, err = c.CancelEffect(ctx, accepted.ID)
	require.ErrorIs(t, err, context.DeadlineExceeded)
	assert.Equal(t, "cancelling", c.EffectStatus().State)
	select {
	case <-c.gate:
		t.Fatal("cancellation timeout released the native execution gate")
	default:
	}
	close(release)
	assert.Equal(t, "unknown", waitEffect(t, c, accepted.ID).State)
}
