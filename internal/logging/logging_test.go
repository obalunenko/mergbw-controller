package logging_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"testing"

	"github.com/obalunenko/mergbw-controller/internal/logging"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestContextLoggerPreservesRequestFields(t *testing.T) {
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, nil)).With("request_id", 42)
	ctx := logging.WithLogger(t.Context(), logger)
	logging.FromContext(ctx).InfoContext(ctx, "packet.sent", "packet_hex", "5501FF0601A2")
	var record map[string]any
	require.NoError(t, json.Unmarshal(output.Bytes(), &record))
	assert.Equal(t, float64(42), record["request_id"])
	assert.Equal(t, "packet.sent", record["msg"])
	assert.Same(t, slog.Default(), logging.FromContext(t.Context()))
}

func TestRedactionCoversMessagesBoundFieldsErrorsAndGroups(t *testing.T) {
	const secret = "private_access_token_1234567890"
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{
		ReplaceAttr: logging.RedactSecrets("", secret),
	})).With("bound", secret)
	logger.Error("failed "+secret,
		"error", errors.New("request "+secret+" failed"),
		"command", "preset/sunset", "packet_count", 3,
		slog.Group("details", "value", secret, "other", "kept"),
	)
	assert.NotContains(t, output.String(), secret)
	var record map[string]any
	require.NoError(t, json.Unmarshal(output.Bytes(), &record))
	assert.Equal(t, "failed [REDACTED]", record["msg"])
	assert.Equal(t, "[REDACTED]", record["bound"])
	assert.Equal(t, "request [REDACTED] failed", record["error"])
	details, ok := record["details"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "[REDACTED]", details["value"])
	assert.Equal(t, "kept", details["other"])
	assert.Equal(t, "preset/sunset", record["command"])
	assert.Equal(t, float64(3), record["packet_count"])
}
