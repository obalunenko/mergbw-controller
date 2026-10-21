package ble

import (
	"context"
	"errors"
)

// CanRetry is the production retry policy shared by the CLI Link and unit tests.
// Uncertain writes and permanent failures must not replay an absolute action.
func CanRetry(err error) bool {
	for _, permanent := range []error{
		context.Canceled, context.DeadlineExceeded, ErrIncompatible,
		ErrPermission, ErrNeedsRestart, ErrWriteUncertain, ErrInvalidPacket,
	} {
		if errors.Is(err, permanent) {
			return false
		}
	}
	return true
}
