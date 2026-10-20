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
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

const testIdentity = "AA:BB:CC:DD:EE:FF"

func newTestBackend(t *testing.T) *Backend {
	t.Helper()
	adapter := NewMockAdapter(gomock.NewController(t))
	b, err := New(Config{Identity: testIdentity}, adapter)
	require.NoError(t, err)
	return b
}

func testAdvertisement(t *testing.T) Advertisement {
	t.Helper()
	data, err := hex.DecodeString("aabbccddeeff0000054c542d3036000000000000")
	require.NoError(t, err)
	address := NewMockAddress(gomock.NewController(t))
	address.EXPECT().String().Return("test-address").AnyTimes()
	return Advertisement{Address: address, Name: "Sunset lights", HasAdvertisingService: true, Services: []string{AdvertisingUUID},
		ManufacturerData: []ManufacturerData{{CompanyID: 0, Data: data}}}
}

func TestMatchUsesManufacturerIdentityNotNameOrCompanyID(t *testing.T) {
	identity, normalized, err := parseIdentity(testIdentity)
	require.NoError(t, err)
	for _, tc := range []struct {
		name   string
		change func(*Advertisement)
		match  bool
	}{
		{"matching advertisement", func(*Advertisement) {}, true},
		{"company ID is separate", func(p *Advertisement) { p.ManufacturerData[0].CompanyID = 0x1234 }, true},
		{"name is not identity", func(p *Advertisement) { p.Name = "different local name" }, true},
		{"same name different identity", func(p *Advertisement) { p.ManufacturerData[0].Data[5] ^= 1 }, false},
		{"reversed MAC is wrong", func(p *Advertisement) {
			copy(p.ManufacturerData[0].Data[:6], []byte{0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa})
		}, false},
		{"advertised service required", func(p *Advertisement) { p.Services = nil; p.HasAdvertisingService = false }, false},
		{"manufacturer data required", func(p *Advertisement) { p.ManufacturerData = nil }, false},
		{"another device type", func(p *Advertisement) { p.ManufacturerData[0].Data[8] = 4 }, false},
		{"another model", func(p *Advertisement) { p.ManufacturerData[0].Data[13] = '7' }, false},
		{"only identity advertised", func(p *Advertisement) { p.ManufacturerData[0].Data = p.ManufacturerData[0].Data[:6] }, true},
		{"short identity", func(p *Advertisement) { p.ManufacturerData[0].Data = p.ManufacturerData[0].Data[:5] }, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ad := testAdvertisement(t)
			tc.change(&ad)
			match, ok := matchAdvertisement(ad, identity, normalized)
			require.Equal(t, tc.match, ok)
			if ok {
				assert.Equal(t, testIdentity, match.info.Identity)
			}
		})
	}
}

func TestNewRequiresExplicitIdentity(t *testing.T) {
	b, err := New(Config{}, NewMockAdapter(gomock.NewController(t)))
	assert.Error(t, err)
	assert.Nil(t, b)
}

func TestCancelledOperationsLogWithoutStartingBLE(t *testing.T) {
	b := newTestBackend(t)
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, nil)).With("request_id", "cancelled-ble-test")
	ctx, cancel := context.WithCancel(logging.WithLogger(t.Context(), logger))
	cancel()
	_, err := b.Connect(ctx)
	assert.ErrorIs(t, err, context.Canceled)
	_, err = b.Inspect(ctx)
	assert.ErrorIs(t, err, context.Canceled)
	assert.ErrorIs(t, b.Write(ctx, []byte{0x55}), context.Canceled)
	assert.False(t, b.enabled)
	assert.False(t, b.hasDevice)
	assert.False(t, b.Connected())
	require.NoError(t, b.Close())
	entries := decodeBLELogs(t, &output)
	require.Len(t, entries, 2)
	for _, entry := range entries {
		assert.Equal(t, "bluetooth.connect_failed", entry["msg"])
		assert.Equal(t, "WARN", entry["level"])
		assert.Equal(t, testIdentity, entry["identity"])
		assert.Equal(t, "cancelled-ble-test", entry["request_id"])
		assert.Equal(t, context.Canceled.Error(), entry["error"])
	}
}

func TestStickyConnectionFailureLogsErrorWithRequestContext(t *testing.T) {
	b := newTestBackend(t)
	b.fatal = ErrNeedsRestart
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, nil)).With("request_id", "failed-ble-test")
	_, err := b.Connect(logging.WithLogger(t.Context(), logger))
	assert.ErrorIs(t, err, ErrNeedsRestart)
	assert.False(t, b.enabled)
	assert.False(t, b.hasDevice)
	assert.False(t, b.Connected())
	entries := decodeBLELogs(t, &output)
	require.Len(t, entries, 1)
	assert.Equal(t, "bluetooth.connect_failed", entries[0]["msg"])
	assert.Equal(t, "ERROR", entries[0]["level"])
	assert.Equal(t, testIdentity, entries[0]["identity"])
	assert.Equal(t, "failed-ble-test", entries[0]["request_id"])
	assert.Equal(t, ErrNeedsRestart.Error(), entries[0]["error"])
}

func TestDisconnectCallbackLogsOnceWithoutCommandMutex(t *testing.T) {
	b := newTestBackend(t)
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	device := NewMockDevice(gomock.NewController(t))
	address := "test-address"
	device.EXPECT().Address().Return(address).Times(4)
	b.target.Store("unrelated-device")
	b.connected.Store(true)
	b.handleConnect(device, false)
	assert.True(t, b.Connected())
	b.target.Store(address)
	b.handleConnect(device, true)
	assert.Empty(t, output.String())

	b.mu.Lock()
	done := make(chan struct{})
	go func() { b.handleConnect(device, false); b.handleConnect(device, false); close(done) }()
	select {
	case <-done:
		b.mu.Unlock()
	case <-time.After(time.Second):
		b.mu.Unlock()
		<-done
		require.FailNow(t, "native callback waited for the command mutex")
	}
	assert.False(t, b.Connected())
	require.NoError(t, b.Close())
	entries := decodeBLELogs(t, &output)
	require.Len(t, entries, 1)
	assert.Equal(t, "bluetooth.disconnected", entries[0]["msg"])
	assert.Equal(t, "WARN", entries[0]["level"])
	assert.Equal(t, testIdentity, entries[0]["identity"])
	assert.Equal(t, address, entries[0]["device_address"])
	assert.Equal(t, "link_lost", entries[0]["reason"])
	assert.NotContains(t, entries[0], "request_id")
}

// Exercise the new adapter boundary end to end without native initialization.
func TestConnectInspectAndWriteThroughAdapter(t *testing.T) {
	ctrl := gomock.NewController(t)
	adapter := NewMockAdapter(ctrl)
	device, service, write := NewMockDevice(ctrl), NewMockService(ctrl), NewMockCharacteristic(ctrl)
	ad := testAdvertisement(t)
	stopped := make(chan struct{})
	adapter.EXPECT().Enable().Return(nil)
	adapter.EXPECT().SetConnectHandler(gomock.Any())
	adapter.EXPECT().Scan(gomock.Any()).DoAndReturn(func(callback func(Advertisement)) error {
		callback(ad)
		select {
		case <-stopped:
			return nil
		case <-t.Context().Done():
			return t.Context().Err()
		}
	})
	adapter.EXPECT().StopScan().DoAndReturn(func() error { close(stopped); return nil })
	adapter.EXPECT().Connect(ad.Address, 12*time.Second).Return(device, nil)
	device.EXPECT().Address().Return("test-address")
	device.EXPECT().Connected().Return(true, nil).Times(4)
	device.EXPECT().DiscoverServices([]string{ServiceUUID}).Return([]Service{service}, nil)
	service.EXPECT().UUID().Return(ServiceUUID)
	service.EXPECT().DiscoverCharacteristics(nil).Return([]Characteristic{write}, nil)
	write.EXPECT().UUID().Return(WriteUUID).Times(2)
	frame := []byte{0x55, 0x01, 0xff, 0x06, 0x00, 0xa3}
	write.EXPECT().WriteWithoutResponse(frame).Return(len(frame), nil)
	device.EXPECT().Disconnect().Return(nil)
	b, err := New(Config{Identity: testIdentity}, adapter)
	require.NoError(t, err)
	t.Cleanup(func() { assert.NoError(t, b.Close()) })
	info, err := b.Connect(t.Context())
	require.NoError(t, err)
	assert.True(t, info.Connected)
	assert.Equal(t, ServiceUUID, info.ServiceUUID)
	assert.Equal(t, WriteUUID, info.WriteUUID)
	assert.Equal(t, "without_response", info.WriteMode)
	assert.False(t, info.StateReadback)
	assert.False(t, info.WritePropertiesVerified)
	info.AdvertisedServices[0] = "changed"
	info.CharacteristicUUIDs[0] = "changed"
	inspected, err := b.Inspect(t.Context())
	require.NoError(t, err)
	assert.Equal(t, []string{AdvertisingUUID}, inspected.AdvertisedServices)
	assert.Equal(t, []string{WriteUUID}, inspected.CharacteristicUUIDs)
	require.NoError(t, b.Write(t.Context(), frame))
	require.NoError(t, b.Close())
	assert.False(t, b.Connected())
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
		require.NoError(t, err)
		entries = append(entries, entry)
	}
}
