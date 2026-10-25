package ble

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCanRetryPermanentErrors(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
	}{
		{"canceled", context.Canceled},
		{"deadline", context.DeadlineExceeded},
		{"incompatible", ErrIncompatible},
		{"permission", ErrPermission},
		{"needs_restart", ErrNeedsRestart},
		{"write_uncertain", ErrWriteUncertain},
		{"invalid_packet", ErrInvalidPacket},
	} {
		t.Run(test.name, func(t *testing.T) {
			ordinary := errors.New("transient transport failure")
			for _, shape := range []struct {
				name string
				err  error
			}{
				{"direct", test.err},
				{"wrapped", fmt.Errorf("operation: %w", test.err)},
				{"joined_first", errors.Join(test.err, ordinary)},
				{"joined_last", errors.Join(ordinary, test.err)},
				{"wrapped_join", fmt.Errorf("operation: %w", errors.Join(ordinary, test.err))},
			} {
				t.Run(shape.name, func(t *testing.T) {
					assert.False(t, CanRetry(shape.err))
				})
			}
		})
	}
}

func TestCanRetryOrdinaryErrors(t *testing.T) {
	fault := errors.New("temporary transport failure")
	for _, err := range []error{
		nil, fault, fmt.Errorf("operation: %w", fault),
		errors.Join(fault, errors.New("another temporary failure")), ErrNotConnected, ErrNotFound,
	} {
		assert.True(t, CanRetry(err), "existing eligible error: %v", err)
	}
}
