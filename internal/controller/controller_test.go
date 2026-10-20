package controller

import (
	"context"
	"errors"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/obalunenko/mergbw-controller/internal/protocol"
)

type fakeLink struct {
	mu        sync.Mutex
	connected bool
	connects  int
	closes    int
	writes    []byte
	active    int
	maxActive int
	write     func(context.Context, []byte) error
	retry     bool
}

func (l *fakeLink) Connect(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.connects++
	l.connected = true
	return nil
}

func (l *fakeLink) Connected() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.connected
}

func (l *fakeLink) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.closes++
	l.connected = false
	return nil
}

func (l *fakeLink) CanRetry(error) bool { return l.retry }

func (l *fakeLink) Write(ctx context.Context, packet []byte) error {
	l.mu.Lock()
	l.writes = append(l.writes, packet[0])
	l.active++
	if l.active > l.maxActive {
		l.maxActive = l.active
	}
	l.mu.Unlock()
	defer func() {
		l.mu.Lock()
		l.active--
		l.mu.Unlock()
	}()
	if l.write != nil {
		return l.write(ctx, packet)
	}
	return nil
}

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
		t.Fatal("operation failed to complete")
		return nil
	}
}

func TestConcurrentCommandsKeepWholeSequencesTogether(t *testing.T) {
	link := &fakeLink{write: func(context.Context, []byte) error {
		time.Sleep(time.Millisecond)
		return nil
	}}
	c := New(link)
	c.gap = 0
	start := make(chan struct{})
	done := make(chan error, 2)
	for _, action := range []protocol.Action{testAction(1, 2), testAction(3, 4, 5)} {
		go func() {
			<-start
			done <- c.Execute(context.Background(), action)
		}()
	}
	close(start)
	for i := 0; i < 2; i++ {
		if err := awaitResult(t, done); err != nil {
			t.Fatal(err)
		}
	}
	if !reflect.DeepEqual(link.writes, []byte{1, 2, 3, 4, 5}) && !reflect.DeepEqual(link.writes, []byte{3, 4, 5, 1, 2}) {
		t.Fatalf("sequences interleaved: %v", link.writes)
	}
	if link.maxActive != 1 {
		t.Fatalf("concurrent writes: %d", link.maxActive)
	}
	if err := c.Close(context.Background()); err != nil || link.Connected() {
		t.Fatalf("close did not release connection: %v", err)
	}
}

func TestCanceledQueuedCommandNeverTouchesLink(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	defer unblock()
	link := &fakeLink{write: func(context.Context, []byte) error {
		close(entered)
		<-release // An already started native write cannot be canceled.
		return nil
	}}
	c := New(link)
	c.gap = 0
	active := make(chan error, 1)
	go func() { active <- c.Execute(context.Background(), testAction(1)) }()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("first write never started")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	queued := make(chan error, 1)
	go func() { queued <- c.Execute(ctx, testAction(2)) }()
	cancel()
	if err := awaitResult(t, queued); !errors.Is(err, context.Canceled) {
		t.Fatalf("queued result = %v", err)
	}
	link.mu.Lock()
	connects := link.connects
	writes := append([]byte(nil), link.writes...)
	link.mu.Unlock()
	if connects != 1 || !reflect.DeepEqual(writes, []byte{1}) {
		t.Fatalf("canceled command touched link: connects=%d, writes=%v", connects, writes)
	}
	unblock()
	if err := awaitResult(t, active); err != nil {
		t.Fatal(err)
	}
}

func TestCancellationWaitsForStartedWriteAndStopsRemainingPackets(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	entered := make(chan struct{})
	release := make(chan struct{})
	link := &fakeLink{retry: true, write: func(context.Context, []byte) error {
		close(entered)
		<-release
		return nil
	}}
	c := New(link)
	c.gap = 0
	done := make(chan error, 1)
	go func() { done <- c.Execute(ctx, testAction(1, 2)) }()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		close(release)
		t.Fatal("write never started")
	}
	cancel()
	select {
	case err := <-done:
		close(release)
		t.Fatalf("returned before native write completed: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	if err := awaitResult(t, done); !errors.Is(err, context.Canceled) {
		t.Fatalf("result = %v, want cancellation", err)
	}
	if !reflect.DeepEqual(link.writes, []byte{1}) || link.connects != 1 || link.closes != 0 {
		t.Fatalf("canceled sequence continued or retried: %+v", link)
	}
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
	}{
		{"transient", true, 1, []byte{1, 1, 2}, 2, false},
		{"persistent", true, 2, []byte{1, 1}, 2, true},
		{"incompatible_or_uncertain", false, 1, []byte{1}, 1, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			failures := test.failures
			link := &fakeLink{retry: test.retry, write: func(context.Context, []byte) error {
				if failures > 0 {
					failures--
					return fault
				}
				return nil
			}}
			c := New(link)
			c.gap = 0
			err := c.Execute(context.Background(), testAction(1, 2))
			if (err != nil) != test.wantError {
				t.Fatalf("unexpected error: %v", err)
			}
			if !reflect.DeepEqual(link.writes, test.wantWrites) || link.connects != test.wantConnect || link.closes != test.wantConnect-1 {
				t.Fatalf("writes=%v connects=%d closes=%d", link.writes, link.connects, link.closes)
			}
		})
	}
}
