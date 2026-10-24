package controller

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/obalunenko/mergbw-controller/internal/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

func transitionSpec() protocol.Transition {
	return protocol.Transition{FromRGB: [3]int{255, 80, 0}, FromBrightness: 100, ToRGB: [3]int{0, 0, 255}, ToBrightness: 0, DurationSeconds: 1}
}

func fastTransitionController(t *testing.T, link Link) *Controller {
	t.Helper()
	c := NewWithContext(t.Context(), link)
	c.gap = 0
	var mu sync.Mutex
	now := time.Unix(1, 0)
	c.now = func() time.Time { mu.Lock(); defer mu.Unlock(); return now }
	c.pause = func(ctx context.Context, delay time.Duration) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if delay > 0 {
			mu.Lock()
			now = now.Add(delay)
			mu.Unlock()
		}
		return ctx.Err()
	}
	return c
}

func waitTransition(t *testing.T, c *Controller, id string) protocol.TransitionSnapshot {
	t.Helper()
	c.transitionMu.Lock()
	job := c.transition
	actualID := job.snapshot.ID
	c.transitionMu.Unlock()
	require.Equal(t, id, actualID)
	select {
	case <-job.done:
	case <-time.After(2 * time.Second):
		require.FailNow(t, "transition did not finish")
	}
	c.transitionMu.Lock()
	snapshot := c.snapshotLocked(job)
	c.transitionMu.Unlock()
	return snapshot
}

func TestTransitionCompletesEndpointsWithoutRetryOrOff(t *testing.T) {
	for _, duration := range []int{1, 60} {
		link := NewMockLink(gomock.NewController(t))
		link.EXPECT().Connect(gomock.Any()).Return(nil)
		var writes [][]byte
		link.EXPECT().Write(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, frame []byte) error {
			writes = append(writes, append([]byte(nil), frame...))
			return nil
		}).AnyTimes()
		c := fastTransitionController(t, link)
		spec := transitionSpec()
		spec.DurationSeconds = duration
		accepted, err := c.StartTransition(t.Context(), spec)
		require.NoError(t, err)
		assert.Equal(t, "running", accepted.State)
		status := waitTransition(t, c, accepted.ID)
		assert.Equal(t, "completed", status.State)
		assert.Equal(t, int64(duration*1000), status.ElapsedMS)
		assert.False(t, status.PhysicalStateVerified)
		require.GreaterOrEqual(t, len(writes), 3)
		assert.Equal(t, spec.InitialPackets(), writes[:3])
		assert.LessOrEqual(t, len(writes), 3+duration*8)
		var finalRGB, finalBrightness []byte
		for _, frame := range writes {
			if frame[1] == 3 {
				finalRGB = frame
			}
			if frame[1] == 5 {
				finalBrightness = frame
			}
		}
		assert.Equal(t, protocol.TransitionPackets(spec.ToRGB, spec.ToBrightness), [][]byte{finalRGB, finalBrightness})
		for _, frame := range writes[1:] {
			assert.NotEqual(t, byte(1), frame[1], "no extra On or Off")
		}
	}
}

func TestTransitionInvalidInputDoesNotCancelOrWrite(t *testing.T) {
	link := NewMockLink(gomock.NewController(t))
	c := fastTransitionController(t, link)
	spec := transitionSpec()
	spec.DurationSeconds = 61
	_, err := c.StartTransition(t.Context(), spec)
	require.Error(t, err)
	assert.Nil(t, c.TransitionStatus())
}

func TestTransitionWriteFailureIsUnknownAndNeverRetried(t *testing.T) {
	link := NewMockLink(gomock.NewController(t))
	link.EXPECT().Connect(gomock.Any()).Return(nil)
	link.EXPECT().Write(gomock.Any(), gomock.Any()).Return(errors.New("write failed"))
	c := fastTransitionController(t, link)
	accepted, err := c.StartTransition(t.Context(), transitionSpec())
	require.NoError(t, err)
	assert.Equal(t, "unknown", waitTransition(t, c, accepted.ID).State)
}

func TestTransitionConnectionFailureAndReadOnlyStatus(t *testing.T) {
	link := NewMockLink(gomock.NewController(t))
	link.EXPECT().Connect(gomock.Any()).Return(errors.New("connect failed"))
	c := fastTransitionController(t, link)
	assert.Nil(t, c.TransitionStatus())
	accepted, err := c.StartTransition(t.Context(), transitionSpec())
	require.NoError(t, err)
	assert.Equal(t, "failed", waitTransition(t, c, accepted.ID).State)
	_, err = c.CancelTransition(t.Context(), accepted.ID)
	require.NoError(t, err)
	_, err = c.CancelTransition(t.Context(), "missing")
	require.ErrorIs(t, err, protocol.ErrTransitionNotFound)
}

func TestNewCommandWaitsForCancelledNativeTransitionWrite(t *testing.T) {
	link := NewMockLink(gomock.NewController(t))
	entered, release := make(chan struct{}), make(chan struct{})
	link.EXPECT().Connect(gomock.Any()).Return(nil).Times(2)
	first := link.EXPECT().Write(gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, []byte) error { close(entered); <-release; return nil })
	link.EXPECT().Write(gomock.Any(), []byte{42}).After(first).Return(nil)
	c := fastTransitionController(t, link)
	accepted, err := c.StartTransition(t.Context(), transitionSpec())
	require.NoError(t, err)
	awaitSignal(t, entered)
	done := make(chan error, 1)
	go func() { done <- c.Execute(t.Context(), protocol.Action{Route: "ordinary", Packets: [][]byte{{42}}}) }()
	require.Eventually(t, func() bool { return c.TransitionStatus().State == "cancelling" }, time.Second, time.Millisecond)
	select {
	case <-done:
		require.FailNow(t, "ordinary command abandoned an active write")
	default:
	}
	close(release)
	require.NoError(t, awaitResult(t, done))
	assert.Equal(t, "unknown", waitTransition(t, c, accepted.ID).State)
}

func TestRootStopCancelsBetweenWritesWithoutOffOrReplay(t *testing.T) {
	link := NewMockLink(gomock.NewController(t))
	root, cancel := context.WithCancel(t.Context())
	link.EXPECT().Connect(gomock.Any()).Return(nil)
	writes := 0
	link.EXPECT().Write(gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, []byte) error { writes++; return nil }).Times(3)
	link.EXPECT().Close().Return(nil)
	c := NewWithContext(root, link)
	c.gap = 0
	paused := make(chan struct{})
	c.pause = func(ctx context.Context, delay time.Duration) error {
		if delay <= 0 {
			return ctx.Err()
		}
		close(paused)
		<-ctx.Done()
		return ctx.Err()
	}
	accepted, err := c.StartTransition(t.Context(), transitionSpec())
	require.NoError(t, err)
	awaitSignal(t, paused)
	cancel()
	assert.Equal(t, "cancelled", waitTransition(t, c, accepted.ID).State)
	require.NoError(t, c.Close(t.Context()))
	assert.Equal(t, 3, writes)
	_, err = c.StartTransition(t.Context(), transitionSpec())
	require.Error(t, err)
}

func TestActiveTransitionRejectsInvalidReplacementAndCancellationTimeoutRetainsGate(t *testing.T) {
	link := NewMockLink(gomock.NewController(t))
	entered, release := make(chan struct{}), make(chan struct{})
	unblock := sync.OnceFunc(func() { close(release) })
	defer unblock()
	var nativeContext context.Context
	link.EXPECT().Connect(gomock.Any()).Return(nil)
	link.EXPECT().Write(gomock.Any(), gomock.Any()).DoAndReturn(func(ctx context.Context, _ []byte) error { nativeContext = ctx; close(entered); <-release; return nil })
	c := fastTransitionController(t, link)
	accepted, err := c.StartTransition(t.Context(), transitionSpec())
	require.NoError(t, err)
	awaitSignal(t, entered)
	invalid := transitionSpec()
	invalid.DurationSeconds = 61
	_, err = c.StartTransition(t.Context(), invalid)
	require.Error(t, err)
	assert.Equal(t, "running", c.TransitionStatus().State)
	assert.NoError(t, nativeContext.Err(), "invalid replacement must not cancel old job")
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Millisecond)
	defer cancel()
	_, err = c.CancelTransition(ctx, accepted.ID)
	require.ErrorIs(t, err, context.DeadlineExceeded)
	assert.Equal(t, "cancelling", c.TransitionStatus().State)
	c.transitionMu.Lock()
	job := c.transition
	c.transitionMu.Unlock()
	select {
	case <-job.done:
		t.Fatal("timeout abandoned native write")
	default:
	}
	unblock()
	assert.Equal(t, "unknown", waitTransition(t, c, accepted.ID).State)
	status, err := c.CancelTransition(t.Context(), accepted.ID)
	require.NoError(t, err)
	assert.Equal(t, "unknown", status.State)
}

func TestRootAndCloseDuringNativeWriteCancelQueueAndWaitForReturn(t *testing.T) {
	for _, closeController := range []bool{false, true} {
		t.Run(fmt.Sprintf("close_%t", closeController), func(t *testing.T) {
			link := NewMockLink(gomock.NewController(t))
			root, stop := context.WithCancel(t.Context())
			defer stop()
			entered, release := make(chan struct{}), make(chan struct{})
			unblock := sync.OnceFunc(func() { close(release) })
			defer unblock()
			var nativeContext context.Context
			link.EXPECT().Connect(gomock.Any()).Return(nil)
			link.EXPECT().Write(gomock.Any(), gomock.Any()).DoAndReturn(func(ctx context.Context, _ []byte) error { nativeContext = ctx; close(entered); <-release; return nil })
			link.EXPECT().Close().Return(nil)
			c := NewWithContext(root, link)
			c.gap = 0
			accepted, err := c.StartTransition(t.Context(), transitionSpec())
			require.NoError(t, err)
			awaitSignal(t, entered)
			if closeController {
				ctx, cancel := context.WithTimeout(t.Context(), 5*time.Millisecond)
				err = c.Close(ctx)
				cancel()
				require.ErrorIs(t, err, context.DeadlineExceeded)
			} else {
				stop()
			}
			require.ErrorIs(t, nativeContext.Err(), context.Canceled)
			queued := make(chan error, 1)
			go func() { queued <- c.Execute(t.Context(), testAction(42)) }()
			require.Error(t, awaitResult(t, queued), "root stop must reject queued command before native returns")
			c.transitionMu.Lock()
			job := c.transition
			c.transitionMu.Unlock()
			select {
			case <-job.done:
				t.Fatal("native write abandoned")
			default:
			}
			unblock()
			assert.Equal(t, "unknown", waitTransition(t, c, accepted.ID).State)
			require.NoError(t, c.Close(t.Context()))
			assert.Nil(t, New(NewMockLink(gomock.NewController(t))).TransitionStatus(), "fresh process has no replay")
		})
	}
}

func TestConcurrentTransitionReplacementStatusAndCancelKeepWholeBLEGate(t *testing.T) {
	link := NewMockLink(gomock.NewController(t))
	link.EXPECT().Connect(gomock.Any()).Return(nil).AnyTimes()
	var active atomic.Int32
	link.EXPECT().Write(gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, []byte) error {
		assert.Equal(t, int32(1), active.Add(1), "parallel native calls")
		runtime.Gosched()
		active.Add(-1)
		return nil
	}).AnyTimes()
	link.EXPECT().Close().Return(nil)
	c := fastTransitionController(t, link)
	var workers sync.WaitGroup
	for range 40 {
		workers.Go(func() {
			accepted, err := c.StartTransition(t.Context(), transitionSpec())
			if !assert.NoError(t, err) {
				return
			}
			for range 3 {
				assert.NotNil(t, c.TransitionStatus())
				runtime.Gosched()
			}
			_, err = c.CancelTransition(t.Context(), accepted.ID)
			assert.True(t, err == nil || errors.Is(err, protocol.ErrTransitionNotFound))
		})
	}
	workers.Wait()
	require.NoError(t, c.Close(t.Context()))
}

func TestTransitionSlowWritesSkipSamplesKeepGapAndReachEndpoint(t *testing.T) {
	link := NewMockLink(gomock.NewController(t))
	c := fastTransitionController(t, link)
	c.gap = 80 * time.Millisecond
	baseNow := c.now
	var mu sync.Mutex
	extra := time.Duration(0)
	c.now = func() time.Time { mu.Lock(); defer mu.Unlock(); return baseNow().Add(extra) }
	basePause := c.pause
	var packetPauses []time.Duration
	c.pause = func(ctx context.Context, delay time.Duration) error {
		if delay > 0 && delay < 100*time.Millisecond {
			packetPauses = append(packetPauses, delay)
		}
		return basePause(ctx, delay)
	}
	link.EXPECT().Connect(gomock.Any()).Return(nil)
	var writes [][]byte
	link.EXPECT().Write(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, frame []byte) error {
		writes = append(writes, append([]byte(nil), frame...))
		mu.Lock()
		extra += 750 * time.Millisecond
		mu.Unlock()
		return nil
	}).AnyTimes()
	spec := transitionSpec()
	accepted, err := c.StartTransition(t.Context(), spec)
	require.NoError(t, err)
	assert.Equal(t, "completed", waitTransition(t, c, accepted.ID).State)
	assert.LessOrEqual(t, len(writes), 7, "slow writes skip obsolete intermediate samples")
	require.NotEmpty(t, packetPauses)
	for _, pause := range packetPauses {
		assert.Greater(t, pause, 70*time.Millisecond)
	}
	assert.Equal(t, protocol.TransitionPackets(spec.ToRGB, spec.ToBrightness), writes[len(writes)-2:])
}

func TestTransitionEqualEndpointsDoNotRepeatPackets(t *testing.T) {
	link := NewMockLink(gomock.NewController(t))
	link.EXPECT().Connect(gomock.Any()).Return(nil)
	link.EXPECT().Write(gomock.Any(), gomock.Any()).Return(nil).Times(3)
	c := fastTransitionController(t, link)
	spec := transitionSpec()
	spec.ToRGB = spec.FromRGB
	spec.ToBrightness = spec.FromBrightness
	accepted, err := c.StartTransition(t.Context(), spec)
	require.NoError(t, err)
	assert.Equal(t, "completed", waitTransition(t, c, accepted.ID).State)
}

func TestOrdinaryCommandRootCancellationStopsRemainingPacketsWithoutRetry(t *testing.T) {
	for _, duringGap := range []bool{true, false} {
		t.Run(fmt.Sprintf("during_gap_%t", duringGap), func(t *testing.T) {
			link := NewMockLink(gomock.NewController(t))
			c := NewWithContext(t.Context(), link)
			c.gap = 0
			link.EXPECT().Connect(gomock.Any()).Return(nil)
			link.EXPECT().Close().Return(nil)
			if duringGap {
				c.pause = func(context.Context, time.Duration) error {
					c.cancelRoot()
					return nil
				}
			} else {
				link.EXPECT().Write(gomock.Any(), []byte{1}).DoAndReturn(func(context.Context, []byte) error {
					c.cancelRoot()
					return nil
				})
			}
			// No retry or second Write expectation: root cancellation must stop both.
			err := c.Execute(t.Context(), protocol.Action{Route: "ordinary", Packets: [][]byte{{1}, {2}}})
			require.ErrorIs(t, err, context.Canceled)
			require.NoError(t, c.Close(t.Context()))
		})
	}
}
