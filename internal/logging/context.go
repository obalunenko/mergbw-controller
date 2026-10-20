// Package logging carries a request logger across the HTTP, controller and BLE
// layers without introducing dependencies between them.
package logging

import (
	"context"
	"log/slog"
)

type contextKey struct{}

// WithLogger associates a logger (including its request fields) with ctx.
func WithLogger(ctx context.Context, logger *slog.Logger) context.Context {
	return context.WithValue(ctx, contextKey{}, logger)
}

// FromContext returns the request logger, or the process logger for CLI and
// startup operations that are not associated with an HTTP request.
func FromContext(ctx context.Context) *slog.Logger {
	if logger, ok := ctx.Value(contextKey{}).(*slog.Logger); ok && logger != nil {
		return logger
	}
	return slog.Default()
}
