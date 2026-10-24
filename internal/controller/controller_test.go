package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/obalunenko/mergbw-controller/internal/logging"
	"github.com/obalunenko/mergbw-controller/internal/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

func testAction(values ...byte) protocol.Action {
	packets := make([][]byte, len(values))
	for i, value := range values {
		packets[i] = []byte{value}
	}
	return protocol.Action{Route: "test", Packets: packets}
}

func awaitResult(t *testing.T, ch <-chan error) error {
	t.Helper()
	select {
	case err := <-ch:
		return err
	case <-time.After(2 * time.Second):
		require.FailNow(t, "operation failed to complete")
		return nil
	}
}

func awaitSignal(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(2 * time.Second):
		require.FailNow(t, "write never started")
	}
}

func captureLogs(parent context.Context) (context.Context, *bytes.Buffer) {
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, nil)).With("request_id", "controller-test")
	return logging.WithLogger(parent, logger), &output
}

func readRecords(t *testing.T, output *bytes.Buffer) []map[string]any {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(output.Bytes()))
	var records []map[string]any
	for {
		var record map[string]any
		err := decoder.Decode(&record)
		if errors.Is(err, io.EOF) {
			return records
		}
		require.NoError(t, err)
		records = append(records, record)
	}
}

func assertEvents(t *testing.T, output *bytes.Buffer, command string, events ...string) []map[string]any {
	t.Helper()
	records := readRecords(t, output)
	var got []string
	for _, record := range records {
		event, ok := record["msg"].(string)
		require.True(t, ok, "missing event name: %v", record)
		got = append(got, event)
		assert.Equal(t, "controller", record["component"])
		assert.Equal(t, command, record["command"])
		assert.Equal(t, "controller-test", record["request_id"])
		if event == "command.sent" || event == "command.failed" {
			duration, ok := record["duration_ms"].(float64)
			require.True(t, ok)
			assert.GreaterOrEqual(t, duration, float64(0))
		}
		if strings.HasSuffix(event, ".failed") {
			assert.Equal(t, "ERROR", record["level"])
			assert.NotNil(t, record["error"])
		}
	}
	require.Equal(t, events, got)
	return records
}

func TestLogsPacketsOnlyAfterSuccessfulWrites(t *testing.T) {
	ctx, output := captureLogs(t.Context())
	action, err := protocol.Resolve([]string{"preset", "sunset"}, map[string]protocol.Preset{
		"sunset": {Label: "Закат", RGB: []int{255, 80, 0}, Brightness: 50},
	})
	require.NoError(t, err)
	link := NewMockLink(gomock.NewController(t))
	link.EXPECT().Connect(ctx).Return(nil)
	writes := 0
	link.EXPECT().Write(ctx, gomock.Any()).DoAndReturn(func(context.Context, []byte) error {
		// Check synchronously before Write returns: no premature packet event.
		require.Len(t, readRecords(t, output), writes)
		writes++
		return nil
	}).Times(3)
	c := New(link)
	c.gap = 0
	require.NoError(t, c.Execute(ctx, action))
	records := assertEvents(t, output, "preset/sunset", "packet.sent", "packet.sent", "packet.sent", "command.sent")
	for i, wantHex := range []string{"5501FF0601A2", "5503FF08FF50004F", "5505FF06326D"} {
		assert.Equal(t, wantHex, records[i]["packet_hex"])
		assert.Equal(t, float64(i+1), records[i]["packet_index"])
		assert.Equal(t, float64(3), records[i]["packet_count"])
		assert.Equal(t, float64(1), records[i]["attempt"])
		assert.Equal(t, "INFO", records[i]["level"])
	}
}

func TestLogsFailuresBeforeAnyPacket(t *testing.T) {
	for _, name := range []string{"empty", "canceled", "closed", "connect"} {
		t.Run(name, func(t *testing.T) {
			ctx, output := captureLogs(t.Context())
			link := NewMockLink(gomock.NewController(t))
			c := New(link)
			action := testAction(1)
			switch name {
			case "empty":
				action.Packets = nil
			case "canceled":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			case "closed":
				link.EXPECT().Close().Return(nil)
				require.NoError(t, c.Close(ctx))
			case "connect":
				fault := errors.New("connection failed")
				link.EXPECT().Connect(ctx).Return(fault)
				link.EXPECT().CanRetry(fault).Return(false)
			}
			// No Write expectation: any write fails this test.
			require.Error(t, c.Execute(ctx, action))
			assertEvents(t, output, "test", "command.failed")
		})
	}
}

func TestConcurrentCommandsKeepWholeSequencesTogether(t *testing.T) {
	link := NewMockLink(gomock.NewController(t))
	link.EXPECT().Connect(gomock.Any()).Return(nil).Times(2)
	var active atomic.Int32
	var mu sync.Mutex
	var writes []byte
	link.EXPECT().Write(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, packet []byte) error {
		count := active.Add(1)
		defer active.Add(-1)
		assert.Equal(t, int32(1), count, "concurrent writes")
		mu.Lock()
		writes = append(writes, packet[0])
		mu.Unlock()
		time.Sleep(time.Millisecond)
		return nil
	}).Times(5)
	c := New(link)
	c.gap = 0
	start := make(chan struct{})
	done := make(chan error, 2)
	ctx := t.Context()
	for _, action := range []protocol.Action{testAction(1, 2), testAction(3, 4, 5)} {
		go func() { <-start; done <- c.Execute(ctx, action) }()
	}
	close(start)
	for range 2 {
		require.NoError(t, awaitResult(t, done))
	}
	mu.Lock()
	got := slices.Clone(writes)
	mu.Unlock()
	assert.Contains(t, [][]byte{{1, 2, 3, 4, 5}, {3, 4, 5, 1, 2}}, got, "sequences interleaved")
	link.EXPECT().Close().Return(nil)
	require.NoError(t, c.Close(ctx))
	link.EXPECT().Connected().Return(false)
	assert.False(t, c.Connected())
}

func TestCanceledQueuedCommandNeverTouchesLink(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	unblock := sync.OnceFunc(func() { close(release) })
	defer unblock()
	link := NewMockLink(gomock.NewController(t))
	link.EXPECT().Connect(gomock.Any()).Return(nil)
	link.EXPECT().Write(gomock.Any(), []byte{1}).DoAndReturn(func(context.Context, []byte) error {
		close(entered)
		<-release
		return nil
	})
	c := New(link)
	c.gap = 0
	active := make(chan error, 1)
	parent := t.Context()
	go func() { active <- c.Execute(parent, testAction(1)) }()
	awaitSignal(t, entered)
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	ctx, output := captureLogs(ctx)
	queued := make(chan error, 1)
	go func() { queued <- c.Execute(ctx, testAction(2)) }()
	cancel()
	require.ErrorIs(t, awaitResult(t, queued), context.Canceled)
	assertEvents(t, output, "test", "command.failed")
	// Exactly one Connect/Write expectation proves canceled work touches no Link.
	unblock()
	require.NoError(t, awaitResult(t, active))
}

func TestCancellationWaitsForStartedWriteAndStopsRemainingPackets(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	ctx, output := captureLogs(ctx)
	entered, release := make(chan struct{}), make(chan struct{})
	unblock := sync.OnceFunc(func() { close(release) })
	defer unblock()
	link := NewMockLink(gomock.NewController(t))
	link.EXPECT().Connect(ctx).Return(nil)
	link.EXPECT().Write(ctx, []byte{1}).DoAndReturn(func(context.Context, []byte) error {
		close(entered)
		<-release
		return nil
	})
	c := New(link)
	c.gap = 0
	done := make(chan error, 1)
	go func() { done <- c.Execute(ctx, testAction(1, 2)) }()
	awaitSignal(t, entered)
	cancel()
	select {
	case err := <-done:
		require.FailNow(t, "returned before native write completed", "%v", err)
	case <-time.After(20 * time.Millisecond):
	}
	unblock()
	require.ErrorIs(t, awaitResult(t, done), context.Canceled)
	// No later Write, retry, or Close expectation is installed.
	assertEvents(t, output, "test", "packet.sent", "command.failed")
}

func TestRetryOnceAndRespectNonRetryableErrors(t *testing.T) {
	fault := errors.New("transport failure")
	for _, test := range []struct {
		name        string
		retry       bool
		failures    int
		wantWrites  []byte
		wantConnect int
		wantError   bool
		wantEvents  []string
	}{
		{"transient", true, 1, []byte{1, 1, 2}, 2, false, []string{"packet.failed", "command.retry", "packet.sent", "packet.sent", "command.sent"}},
		{"persistent", true, 2, []byte{1, 1}, 2, true, []string{"packet.failed", "command.retry", "packet.failed", "command.failed"}},
		{"incompatible_or_uncertain", false, 1, []byte{1}, 1, true, []string{"packet.failed", "command.failed"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, output := captureLogs(t.Context())
			link := NewMockLink(gomock.NewController(t))
			// InOrder checks the complete replay and cleanup/reconnect boundaries.
			var calls []*gomock.Call
			calls = append(calls, link.EXPECT().Connect(ctx).Return(nil))
			failures := test.failures
			for i, value := range test.wantWrites {
				if failures > 0 {
					failures--
					calls = append(calls, link.EXPECT().Write(ctx, []byte{value}).Return(fault))
					if i == 0 {
						calls = append(calls, link.EXPECT().CanRetry(fault).Return(test.retry))
						if test.retry {
							calls = append(calls, link.EXPECT().Close().Return(nil), link.EXPECT().Connect(ctx).Return(nil))
						}
					}
				} else {
					calls = append(calls, link.EXPECT().Write(ctx, []byte{value}).Return(nil))
				}
			}
			ordered := make([]any, len(calls))
			for i, call := range calls {
				ordered[i] = call
			}
			gomock.InOrder(ordered...)
			c := New(link)
			c.gap = 0
			err := c.Execute(ctx, testAction(1, 2))
			if test.wantError {
				assert.ErrorIs(t, err, fault)
			} else {
				require.NoError(t, err)
			}
			records := assertEvents(t, output, "test", test.wantEvents...)
			assert.Equal(t, "01", records[0]["packet_hex"])
			assert.Equal(t, float64(1), records[0]["attempt"])
			assert.Equal(t, float64(1), records[0]["packet_index"])
			assert.Equal(t, float64(2), records[0]["packet_count"])
			assert.Equal(t, fault.Error(), records[0]["error"])
			if test.retry {
				assert.Equal(t, float64(2), records[1]["attempt"])
				assert.Equal(t, fault.Error(), records[1]["reason"])
				assert.Equal(t, "WARN", records[1]["level"])
				assert.Equal(t, float64(2), records[2]["attempt"])
			}
		})
	}
}

func TestRetryConnectFailuresAndPause(t *testing.T) {
	fault := errors.New("temporary connect failure")
	for _, persistent := range []bool{false, true} {
		t.Run(fmt.Sprintf("persistent_%t", persistent), func(t *testing.T) {
			ctx := t.Context()
			link := NewMockLink(gomock.NewController(t))
			var closedAt time.Time
			var calls []any
			calls = append(calls,
				link.EXPECT().Connect(ctx).Return(fault),
				link.EXPECT().CanRetry(fault).Return(true),
				link.EXPECT().Close().DoAndReturn(func() error { closedAt = time.Now(); return nil }),
				link.EXPECT().Connect(ctx).DoAndReturn(func(context.Context) error {
					assert.GreaterOrEqual(t, time.Since(closedAt), 200*time.Millisecond)
					if persistent {
						return fault
					}
					return nil
				}),
			)
			if !persistent {
				calls = append(calls, link.EXPECT().Write(ctx, []byte{1}).Return(nil), link.EXPECT().Write(ctx, []byte{2}).Return(nil))
			}
			gomock.InOrder(calls...)
			c := New(link)
			c.gap = 0
			err := c.Execute(ctx, testAction(1, 2))
			if persistent {
				assert.ErrorIs(t, err, fault)
			} else {
				require.NoError(t, err)
			}
			// Exact expectations reject a third Connect or an extra policy query.
		})
	}
}

func TestRetryCleanupFailurePreservesBothCauses(t *testing.T) {
	fault, closeFault := errors.New("transport failure"), errors.New("disconnect failure")
	for _, stage := range []string{"connect", "write"} {
		t.Run(stage, func(t *testing.T) {
			ctx := t.Context()
			link := NewMockLink(gomock.NewController(t))
			var calls []any
			if stage == "connect" {
				calls = append(calls, link.EXPECT().Connect(ctx).Return(fault))
			} else {
				calls = append(calls, link.EXPECT().Connect(ctx).Return(nil), link.EXPECT().Write(ctx, []byte{1}).Return(fault))
			}
			calls = append(calls, link.EXPECT().CanRetry(fault).Return(true), link.EXPECT().Close().Return(closeFault))
			gomock.InOrder(calls...)
			c := New(link)
			c.gap = 0
			err := c.Execute(ctx, testAction(1, 2))
			assert.ErrorIs(t, err, fault)
			assert.ErrorIs(t, err, closeFault)
			// No reconnect or replay is permitted after cleanup failed.
		})
	}
}

func TestRetryReplaysFromFirstPacketAfterLaterFailure(t *testing.T) {
	ctx := t.Context()
	fault := errors.New("second packet failed")
	link := NewMockLink(gomock.NewController(t))
	gomock.InOrder(
		link.EXPECT().Connect(ctx).Return(nil),
		link.EXPECT().Write(ctx, []byte{1}).Return(nil),
		link.EXPECT().Write(ctx, []byte{2}).Return(fault),
		link.EXPECT().CanRetry(fault).Return(true),
		link.EXPECT().Close().Return(nil),
		link.EXPECT().Connect(ctx).Return(nil),
		link.EXPECT().Write(ctx, []byte{1}).Return(nil),
		link.EXPECT().Write(ctx, []byte{2}).Return(nil),
		link.EXPECT().Write(ctx, []byte{3}).Return(nil),
	)
	c := New(link)
	c.gap = 0
	require.NoError(t, c.Execute(ctx, testAction(1, 2, 3)))
}

func TestRetryWaitCancellationStopsReconnect(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	fault := errors.New("temporary connect failure")
	closed := make(chan struct{})
	link := NewMockLink(gomock.NewController(t))
	gomock.InOrder(
		link.EXPECT().Connect(ctx).Return(fault),
		link.EXPECT().CanRetry(fault).Return(true),
		link.EXPECT().Close().DoAndReturn(func() error { close(closed); return nil }),
	)
	c := New(link)
	done := make(chan error, 1)
	go func() { done <- c.Execute(ctx, testAction(1)) }()
	awaitSignal(t, closed)
	select {
	case err := <-done:
		require.FailNow(t, "retry did not wait", "%v", err)
	case <-time.After(20 * time.Millisecond):
	}
	cancel()
	assert.ErrorIs(t, awaitResult(t, done), context.Canceled)
}

func TestDefaultPacketGapFollowsWriteCompletion(t *testing.T) {
	for _, test := range []struct {
		name                     string
		acrossActions, failFirst bool
	}{
		{"within_action", false, false},
		{"across_successful_actions", true, false},
		{"after_failed_write", true, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx := t.Context()
			fault := errors.New("first write failed")
			link := NewMockLink(gomock.NewController(t))
			var completedAt time.Time
			var calls []any
			calls = append(calls, link.EXPECT().Connect(ctx).Return(nil),
				link.EXPECT().Write(ctx, []byte{1}).DoAndReturn(func(context.Context, []byte) error {
					time.Sleep(25 * time.Millisecond)
					completedAt = time.Now()
					if test.failFirst {
						return fault
					}
					return nil
				}))
			if test.failFirst {
				calls = append(calls, link.EXPECT().CanRetry(fault).Return(false))
			}
			if test.acrossActions {
				calls = append(calls, link.EXPECT().Connect(ctx).Return(nil))
			}
			calls = append(calls, link.EXPECT().Write(ctx, []byte{2}).DoAndReturn(func(context.Context, []byte) error {
				assert.GreaterOrEqual(t, time.Since(completedAt), 80*time.Millisecond, "gap is measured from Write completion")
				return nil
			}))
			gomock.InOrder(calls...)
			c := New(link) // Keep the default gap in this test.
			assert.Equal(t, 80*time.Millisecond, c.gap)
			if test.acrossActions {
				err := c.Execute(ctx, testAction(1))
				if test.failFirst {
					require.ErrorIs(t, err, fault)
				} else {
					require.NoError(t, err)
				}
				require.NoError(t, c.Execute(ctx, testAction(2)))
			} else {
				require.NoError(t, c.Execute(ctx, testAction(1, 2)))
			}
		})
	}
}

func TestCloseDuringStartedWriteIsTerminalAndExclusive(t *testing.T) {
	for _, expires := range []bool{false, true} {
		t.Run(fmt.Sprintf("close_wait_expires_%t", expires), func(t *testing.T) {
			ctx := t.Context()
			entered, release := make(chan struct{}), make(chan struct{})
			unblock := sync.OnceFunc(func() { close(release) })
			defer unblock()
			var nativeReturned atomic.Bool
			link := NewMockLink(gomock.NewController(t))
			link.EXPECT().Connect(ctx).Return(nil)
			link.EXPECT().Write(ctx, []byte{1}).DoAndReturn(func(context.Context, []byte) error {
				close(entered)
				<-release
				nativeReturned.Store(true)
				return nil
			})
			c := New(link)
			active := make(chan error, 1)
			go func() { active <- c.Execute(ctx, testAction(1)) }()
			awaitSignal(t, entered)
			closeCtx := ctx
			if expires {
				var cancel context.CancelFunc
				closeCtx, cancel = context.WithTimeout(ctx, 30*time.Millisecond)
				defer cancel()
			} else {
				link.EXPECT().Close().DoAndReturn(func() error { assert.True(t, nativeReturned.Load()); return nil })
			}
			closing := make(chan error, 1)
			go func() { closing <- c.Close(closeCtx) }()
			require.Eventually(t, c.closed.Load, time.Second, time.Millisecond, "Close must mark terminal state before acquiring the busy gate")
			connecting, executing := make(chan error, 1), make(chan error, 1)
			go func() { connecting <- c.Connect(ctx) }()
			go func() { executing <- c.Execute(ctx, testAction(2)) }()
			if expires {
				require.ErrorIs(t, awaitResult(t, closing), context.DeadlineExceeded)
				assert.True(t, c.closed.Load())
			} else {
				select {
				case err := <-closing:
					require.FailNow(t, "Close ran before the write returned", "%v", err)
				case <-time.After(20 * time.Millisecond):
				}
			}
			select {
			case err := <-active:
				require.FailNow(t, "started writer was abandoned", "%v", err)
			default:
			}
			unblock()
			require.NoError(t, awaitResult(t, active))
			require.ErrorContains(t, awaitResult(t, connecting), "контроллер остановлен")
			require.ErrorContains(t, awaitResult(t, executing), "контроллер остановлен")
			if expires {
				link.EXPECT().Close().DoAndReturn(func() error { assert.True(t, nativeReturned.Load()); return nil })
				require.NoError(t, c.Close(ctx))
			} else {
				require.NoError(t, awaitResult(t, closing))
			}
			// Terminal state survives cleanup, and neither method may call Link.
			require.ErrorContains(t, c.Connect(ctx), "контроллер остановлен")
			require.ErrorContains(t, c.Execute(ctx, testAction(3)), "контроллер остановлен")
		})
	}
}

func TestRootCancellationJoinsCurrentWriteCancelsQueueAndNeverSendsOffOrReplays(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	entered, release := make(chan struct{}), make(chan struct{})
	link := NewMockLink(gomock.NewController(t))
	gomock.InOrder(
		link.EXPECT().Connect(ctx).Return(nil),
		link.EXPECT().Write(ctx, []byte{1}).DoAndReturn(func(context.Context, []byte) error { close(entered); <-release; return nil }),
		link.EXPECT().Close().Return(nil),
	)
	lamp := New(link)
	lamp.gap = 0
	active, queued := make(chan error, 1), make(chan error, 1)
	go func() { active <- lamp.Execute(ctx, testAction(1, 2, 3)) }()
	awaitSignal(t, entered)
	go func() { queued <- lamp.Execute(ctx, testAction(4, 5)) }()
	cancel()
	assert.ErrorIs(t, awaitResult(t, queued), context.Canceled)
	select {
	case <-active:
		t.Fatal("native write was abandoned before return")
	default:
	}
	close(release)
	assert.ErrorIs(t, awaitResult(t, active), context.Canceled)
	require.NoError(t, lamp.Close(t.Context()))
	// Expectations permit exactly the in-progress packet, no remaining/queued
	// packet and no synthetic Off. A new controller has no persisted queue.
	replacement := New(NewMockLink(gomock.NewController(t)))
	assert.NotNil(t, replacement)
}

func TestUncertainWriteNeverRepeatsOrEmitsRemainingSequence(t *testing.T) {
	ctx := t.Context()
	uncertainty := errors.New("uncertain native write")
	link := NewMockLink(gomock.NewController(t))
	gomock.InOrder(
		link.EXPECT().Connect(ctx).Return(nil),
		link.EXPECT().Write(ctx, []byte{1}).Return(uncertainty),
		link.EXPECT().CanRetry(uncertainty).Return(false),
	)
	lamp := New(link)
	lamp.gap = 0
	require.ErrorIs(t, lamp.Execute(ctx, testAction(1, 2, 3)), uncertainty)
	// No additional Write, reconnect or synthetic Off is admitted by the mock.
}
