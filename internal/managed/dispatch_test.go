package managed

import (
	"context"
	"encoding/json/jsontext"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLifetimeWatchBypassesBlockedMutationAndOutput(t *testing.T) {
	input, send := io.Pipe()
	receive, output := io.Pipe()
	defer receive.Close()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	entered := make(chan struct{})
	watched := make(chan struct{})
	finished := make(chan error, 1)
	server := ControlServer{Input: input, Output: output, Session: strings.Repeat("a", 32), Handlers: map[string]ControlHandler{
		"configuration.apply": func(ctx context.Context, _ Frame) (any, error) { close(entered); <-ctx.Done(); return nil, ctx.Err() },
	}, Watch: func(frame Frame) error { assert.Equal(t, "runtime.revoked", frame.Type); close(watched); return nil }}
	go func() { finished <- server.Run(ctx) }()
	frame := testFrame()
	frame.Type = "configuration.apply"
	require.NoError(t, NewEncoder(send).Write(frame))
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("mutation not entered")
	}
	frame.Type = "runtime.revoked"
	frame.RequestID = strings.Repeat("c", 32)
	require.NoError(t, NewEncoder(send).Write(frame))
	select {
	case <-watched:
	case <-time.After(time.Second):
		t.Fatal("revocation blocked behind mutation")
	}
	cancel()
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("shutdown blocked behind output")
	}
	_ = send.Close()
}

func TestControlResponseSanitizesErrorsAndReusesRequestResult(t *testing.T) {
	input, send := io.Pipe()
	receive, output := io.Pipe()
	defer receive.Close()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	calls := 0
	server := ControlServer{Input: input, Output: output, Session: strings.Repeat("a", 32), Handlers: map[string]ControlHandler{
		"configuration.read": func(context.Context, Frame) (any, error) { calls++; return nil, Code("private_token_and_path") },
	}}
	finished := make(chan error, 1)
	go func() { finished <- server.Run(ctx) }()
	decoder := NewDecoder(receive, server.Session)
	frame := testFrame()
	frame.Type = "configuration.read"
	for range 2 {
		require.NoError(t, NewEncoder(send).Write(frame))
		reply, err := decoder.Read()
		require.NoError(t, err)
		assert.Contains(t, string(reply.Payload), "internal_error")
		assert.NotContains(t, string(reply.Payload), "private_token")
	}
	cancel()
	<-finished
	assert.Equal(t, 1, calls)
	var payload struct {
		LaunchID string `json:"launchId"`
	}
	frame.Payload = jsontext.Value(`{"launchId":"ok","unexpected":"secret"}`)
	assert.ErrorIs(t, DecodePayload(frame, &payload), ProtocolIncompatible)
	_ = send.Close()
}
