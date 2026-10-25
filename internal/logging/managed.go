package logging

import (
	"context"
	"log/slog"
	"regexp"
	"time"
)

var managedID = regexp.MustCompile(`^[0-9a-f]{32}$`)

// Managed emits only an allowlisted lifecycle vocabulary. It is safe before
// configuration/redaction loads: no error object, source path, URL or payload
// is accepted. Request IDs are generated locally, never imported settings.
func Managed(ctx context.Context, phase, category, requestID string, duration time.Duration) {
	switch phase {
	case "startup", "readiness", "recovery", "cleanup", "configuration":
	default:
		return
	}
	switch category {
	case "instance_busy", "port_conflict", "binary_missing", "binary_incompatible", "spawn_failed", "protocol_incompatible", "startup_timeout", "host_unavailable", "permission_denied", "bluetooth_unavailable", "backend_restart_required", "worker_exited", "cleanup_blocked", "storage_unavailable", "invalid_configuration":
	default:
		category = "internal_error"
	}
	attrs := []slog.Attr{slog.String("phase", phase), slog.String("error_category", category)}
	if managedID.MatchString(requestID) {
		attrs = append(attrs, slog.String("request_id", requestID))
	}
	if duration >= 0 && duration <= 24*time.Hour {
		attrs = append(attrs, slog.Int64("duration_ms", duration.Milliseconds()))
	}
	FromContext(ctx).LogAttrs(ctx, slog.LevelWarn, "managed.failed", attrs...)
}
