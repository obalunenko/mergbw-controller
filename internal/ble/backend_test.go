//go:build darwin || linux

package ble

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/obalunenko/mergbw-controller/internal/logging"
	"tinygo.org/x/bluetooth"
)

const testIdentity = "AA:BB:CC:DD:EE:FF"

type testAdvertisement struct {
	name     string
	services []bluetooth.UUID
	data     []bluetooth.ManufacturerDataElement
}

func (p testAdvertisement) LocalName() string { return p.name }
func (p testAdvertisement) HasServiceUUID(uuid bluetooth.UUID) bool {
	for _, candidate := range p.services {
		if candidate == uuid {
			return true
		}
	}
	return false
}
func (p testAdvertisement) ServiceUUIDs() []bluetooth.UUID                        { return p.services }
func (p testAdvertisement) Bytes() []byte                                         { return nil }
func (p testAdvertisement) ManufacturerData() []bluetooth.ManufacturerDataElement { return p.data }
func (p testAdvertisement) ServiceData() []bluetooth.ServiceDataElement           { return nil }

func TestMatchUsesManufacturerIdentityNotNameOrCompanyID(t *testing.T) {
	identity, normalized, err := parseIdentity(testIdentity)
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name   string
		change func(*testAdvertisement)
		match  bool
	}{
		{"matching advertisement", func(*testAdvertisement) {}, true},
		{"company ID is separate", func(p *testAdvertisement) { p.data[0].CompanyID = 0x1234 }, true},
		{"name is not identity", func(p *testAdvertisement) { p.name = "different local name" }, true},
		{"same name different identity", func(p *testAdvertisement) { p.data[0].Data[5] ^= 1 }, false},
		{"reversed MAC is wrong", func(p *testAdvertisement) {
			copy(p.data[0].Data[:6], []byte{0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa})
		}, false},
		{"advertised service required", func(p *testAdvertisement) { p.services = nil }, false},
		{"manufacturer data required", func(p *testAdvertisement) { p.data = nil }, false},
		{"another device type", func(p *testAdvertisement) { p.data[0].Data[8] = 4 }, false},
		{"another model", func(p *testAdvertisement) { p.data[0].Data[13] = '7' }, false},
		{"only identity advertised", func(p *testAdvertisement) { p.data[0].Data = p.data[0].Data[:6] }, true},
		{"short identity", func(p *testAdvertisement) { p.data[0].Data = p.data[0].Data[:5] }, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			data, err := hex.DecodeString("aabbccddeeff0000054c542d3036000000000000")
			if err != nil {
				t.Fatal(err)
			}
			payload := testAdvertisement{
				name: "Sunset lights", services: []bluetooth.UUID{advertisingService},
				data: []bluetooth.ManufacturerDataElement{{CompanyID: 0, Data: data}},
			}
			tc.change(&payload)
			match, ok := matchAdvertisement(bluetooth.ScanResult{AdvertisementPayload: payload}, identity, normalized)
			if ok != tc.match {
				t.Fatalf("matched=%v, want %v", ok, tc.match)
			}
			if ok && match.info.Identity != testIdentity {
				t.Fatalf("identity=%q", match.info.Identity)
			}
		})
	}
}

func TestNewRequiresExplicitIdentity(t *testing.T) {
	b, err := New(Config{})
	if err == nil || b != nil {
		t.Fatalf("New without identity: backend=%v, error=%v; want nil backend and an error", b, err)
	}
}

func TestCancelledOperationsLogWithoutStartingBLE(t *testing.T) {
	b, err := New(Config{Identity: testIdentity})
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, nil)).With("request_id", "cancelled-ble-test")
	ctx, cancel := context.WithCancel(logging.WithLogger(context.Background(), logger))
	cancel()
	if _, err := b.Connect(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("Connect: %v", err)
	}
	if _, err := b.Inspect(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("Inspect: %v", err)
	}
	if err := b.Write(ctx, []byte{0x55}); !errors.Is(err, context.Canceled) {
		t.Fatalf("Write: %v", err)
	}
	if b.enabled || b.hasDevice || b.Connected() {
		t.Fatal("cancelled operation changed connection state")
	}
	if err := b.Close(); err != nil {
		t.Fatal(err)
	}
	entries := decodeBLELogs(t, &output)
	if len(entries) != 2 {
		t.Fatalf("expected only two failed connection events, got %v", entries)
	}
	for _, entry := range entries {
		if entry["msg"] != "bluetooth.connect_failed" || entry["level"] != "WARN" ||
			entry["identity"] != testIdentity || entry["request_id"] != "cancelled-ble-test" ||
			entry["error"] != context.Canceled.Error() {
			t.Fatalf("unexpected cancellation event: %v", entry)
		}
	}
}

func TestStickyConnectionFailureLogsErrorWithRequestContext(t *testing.T) {
	b, err := New(Config{Identity: testIdentity})
	if err != nil {
		t.Fatal(err)
	}
	b.fatal = ErrNeedsRestart
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, nil)).With("request_id", "failed-ble-test")
	_, err = b.Connect(logging.WithLogger(context.Background(), logger))
	if !errors.Is(err, ErrNeedsRestart) {
		t.Fatalf("Connect error = %v, want ErrNeedsRestart", err)
	}
	if b.enabled || b.hasDevice || b.Connected() {
		t.Fatal("sticky failure started a connection")
	}
	entries := decodeBLELogs(t, &output)
	if len(entries) != 1 {
		t.Fatalf("expected one connection failure event, got %v", entries)
	}
	entry := entries[0]
	if entry["msg"] != "bluetooth.connect_failed" || entry["level"] != "ERROR" ||
		entry["identity"] != testIdentity || entry["request_id"] != "failed-ble-test" ||
		entry["error"] != ErrNeedsRestart.Error() {
		t.Fatalf("unexpected connection failure event: %v", entry)
	}
}

func TestDisconnectCallbackLogsOnceWithoutCommandMutex(t *testing.T) {
	b, err := New(Config{Identity: testIdentity})
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	// Only Address.String is used by the callback; no native device is needed.
	device := bluetooth.Device{}
	address := device.Address.String()
	b.target.Store("unrelated-device")
	b.connected.Store(true)
	b.handleConnect(device, false)
	if !b.Connected() {
		t.Fatal("an unrelated device changed the target's connection state")
	}
	b.target.Store(address)
	b.handleConnect(device, true)
	if output.Len() != 0 {
		t.Fatalf("callback logged before a ready connection was lost: %s", output.Bytes())
	}

	b.mu.Lock()
	done := make(chan struct{})
	go func() {
		b.handleConnect(device, false)
		b.handleConnect(device, false)
		close(done)
	}()
	select {
	case <-done:
		b.mu.Unlock()
	case <-time.After(time.Second):
		b.mu.Unlock()
		<-done
		t.Fatal("native callback waited for the command mutex")
	}
	if b.Connected() {
		t.Fatal("disconnect callback left the connection marked ready")
	}
	if err := b.Close(); err != nil {
		t.Fatal(err)
	}
	entries := decodeBLELogs(t, &output)
	if len(entries) != 1 {
		t.Fatalf("expected one link-loss event, got %v", entries)
	}
	entry := entries[0]
	if entry["msg"] != "bluetooth.disconnected" || entry["level"] != "WARN" ||
		entry["identity"] != testIdentity || entry["device_address"] != address ||
		entry["reason"] != "link_lost" {
		t.Fatalf("unexpected link-loss event: %v", entry)
	}
	if _, ok := entry["request_id"]; ok {
		t.Fatal("callback retained a request ID")
	}
}

func decodeBLELogs(t *testing.T, output *bytes.Buffer) []map[string]any {
	t.Helper()
	decoder := json.NewDecoder(output)
	var entries []map[string]any
	for {
		var entry map[string]any
		err := decoder.Decode(&entry)
		if errors.Is(err, io.EOF) {
			return entries
		}
		if err != nil {
			t.Fatalf("decode log event: %v", err)
		}
		entries = append(entries, entry)
	}
}
