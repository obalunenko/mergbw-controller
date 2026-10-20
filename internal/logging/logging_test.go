package logging_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"testing"

	"github.com/obalunenko/mergbw-controller/internal/logging"
)

func TestContextLoggerPreservesRequestFields(t *testing.T) {
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, nil)).With("request_id", 42)
	ctx := logging.WithLogger(context.Background(), logger)
	logging.FromContext(ctx).InfoContext(ctx, "packet.sent", "packet_hex", "5501FF0601A2")
	var record map[string]any
	if err := json.Unmarshal(output.Bytes(), &record); err != nil {
		t.Fatal(err)
	}
	if record["request_id"] != float64(42) || record["msg"] != "packet.sent" {
		t.Fatalf("request logger fields missing: %v", record)
	}
	if logging.FromContext(context.Background()) != slog.Default() {
		t.Fatal("context without a request must use the process logger")
	}
}

func TestRedactionCoversMessagesBoundFieldsErrorsAndGroups(t *testing.T) {
	const secret = "private_access_token_1234567890"
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{
		ReplaceAttr: logging.RedactSecrets("", secret),
	})).With("bound", secret)
	logger.Error("failed "+secret,
		"error", errors.New("request "+secret+" failed"),
		"command", "preset/sunset",
		"packet_count", 3,
		slog.Group("details", "value", secret, "other", "kept"),
	)
	if strings.Contains(output.String(), secret) {
		t.Fatal("secret leaked into logs")
	}
	var record map[string]any
	if err := json.Unmarshal(output.Bytes(), &record); err != nil {
		t.Fatal(err)
	}
	if record["msg"] != "failed [REDACTED]" || record["bound"] != "[REDACTED]" || record["error"] != "request [REDACTED] failed" {
		t.Fatalf("redaction missed a message, bound field or error: %v", record)
	}
	details, ok := record["details"].(map[string]any)
	if !ok || details["value"] != "[REDACTED]" || details["other"] != "kept" || record["command"] != "preset/sunset" || record["packet_count"] != float64(3) {
		t.Fatalf("redaction changed useful data or missed a nested field: %v", record)
	}
}
