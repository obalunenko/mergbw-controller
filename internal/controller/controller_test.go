package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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
