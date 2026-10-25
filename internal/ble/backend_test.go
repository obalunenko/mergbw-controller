//go:build darwin || linux

package ble

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"runtime"
	"sync"
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

type connectionMocks struct {
	backend       *Backend
	adapter       *MockAdapter
	device        *MockDevice
	service       *MockService
	write         *MockCharacteristic
	advertisement Advertisement
}

func newConnectionMocks(t *testing.T) connectionMocks {
	t.Helper()
	ctrl := gomock.NewController(t)
	f := connectionMocks{adapter: NewMockAdapter(ctrl), device: NewMockDevice(ctrl),
		service: NewMockService(ctrl), write: NewMockCharacteristic(ctrl), advertisement: testAdvertisement(t)}
	var err error
	f.backend, err = New(Config{Identity: testIdentity}, f.adapter)
	require.NoError(t, err)
	return f
}

func (f connectionMocks) expectScan(t *testing.T) {
	t.Helper()
	stopped := make(chan struct{})
	f.adapter.EXPECT().Enable().Return(nil)
	f.adapter.EXPECT().SetConnectHandler(gomock.Any())
	f.adapter.EXPECT().Scan(gomock.Any()).DoAndReturn(func(callback func(Advertisement)) error {
		callback(f.advertisement)
		select {
		case <-stopped:
			return nil
		case <-time.After(2 * time.Second):
			return errors.New("mock scan was not stopped")
		}
	})
	f.adapter.EXPECT().StopScan().DoAndReturn(func() error { close(stopped); return nil })
}

func TestConnectRejectsFailedStages(t *testing.T) {
	fault := errors.New("native failure")
	for _, test := range []struct {
		name, stage, kind string
		want              error
	}{
		{"enable_error", "enable", "error", fault},
		{"enable_canceled", "enable", "cancel", context.Canceled},
		{"connect_error", "connect", "error", fault},
		{"connect_nil_device", "connect", "nil", ErrNotConnected},
		{"connect_wrong_device", "connect", "wrong", ErrNotConnected},
		{"connect_canceled", "connect", "cancel", context.Canceled},
		{"initial_readiness_error", "ready", "error", fault},
		{"initial_readiness_lost", "ready", "lost", ErrNotConnected},
		{"services_error", "services", "error", fault},
		{"services_canceled", "services", "cancel", context.Canceled},
		{"service_missing", "services", "missing", ErrIncompatible},
		{"service_duplicate", "services", "duplicate", ErrIncompatible},
		{"service_wrong_uuid", "services", "wrong", ErrIncompatible},
		{"characteristics_error", "characteristics", "error", fault},
		{"characteristics_canceled", "characteristics", "cancel", context.Canceled},
		{"characteristic_missing", "characteristics", "missing", ErrIncompatible},
		{"characteristic_duplicate", "characteristics", "duplicate", ErrIncompatible},
		{"characteristic_wrong_uuid", "characteristics", "wrong", ErrIncompatible},
		{"final_readiness_error", "final_ready", "error", fault},
		{"final_readiness_lost", "final_ready", "lost", ErrNotConnected},
	} {
		t.Run(test.name, func(t *testing.T) {
			f := newConnectionMocks(t)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			configure := func() {
				if test.stage == "enable" {
					if test.kind == "error" {
						f.adapter.EXPECT().Enable().Return(fault)
					} else {
						f.adapter.EXPECT().Enable().DoAndReturn(func() error { cancel(); return nil })
						f.adapter.EXPECT().SetConnectHandler(gomock.Any())
					}
					return
				}
				f.expectScan(t)
				if test.stage == "connect" {
					switch test.kind {
					case "error":
						f.adapter.EXPECT().Connect(gomock.Any(), gomock.Any()).Return(nil, fault)
					case "nil":
						f.adapter.EXPECT().Connect(gomock.Any(), gomock.Any()).Return(nil, nil)
					case "wrong":
						f.adapter.EXPECT().Connect(gomock.Any(), gomock.Any()).Return(f.device, nil)
						f.device.EXPECT().Address().Return("another-device")
					case "cancel":
						f.adapter.EXPECT().Connect(gomock.Any(), gomock.Any()).DoAndReturn(func(Address, time.Duration) (Device, error) { cancel(); return f.device, nil })
						f.device.EXPECT().Address().Return("test-address")
						f.device.EXPECT().Disconnect().Return(nil)
					}
					return
				}
				f.adapter.EXPECT().Connect(f.advertisement.Address, gomock.Any()).Return(f.device, nil)
				f.device.EXPECT().Address().Return("test-address")
				f.device.EXPECT().Disconnect().Return(nil)
				if test.stage == "ready" {
					if test.kind == "error" {
						f.device.EXPECT().Connected().Return(false, fault)
					} else {
						f.device.EXPECT().Connected().Return(false, nil)
					}
					return
				}
				initial := f.device.EXPECT().Connected().Return(true, nil)
				if test.stage == "services" {
					switch test.kind {
					case "error":
						f.device.EXPECT().DiscoverServices([]string{ServiceUUID}).Return(nil, fault)
					case "cancel":
						f.device.EXPECT().DiscoverServices([]string{ServiceUUID}).DoAndReturn(func([]string) ([]Service, error) { cancel(); return []Service{f.service}, nil })
					case "missing":
						f.device.EXPECT().DiscoverServices([]string{ServiceUUID}).Return(nil, nil)
					case "duplicate":
						f.device.EXPECT().DiscoverServices([]string{ServiceUUID}).Return([]Service{f.service, f.service}, nil)
					case "wrong":
						f.device.EXPECT().DiscoverServices([]string{ServiceUUID}).Return([]Service{f.service}, nil)
						f.service.EXPECT().UUID().Return(NotifyUUID)
					}
					return
				}
				f.device.EXPECT().DiscoverServices([]string{ServiceUUID}).Return([]Service{f.service}, nil)
				f.service.EXPECT().UUID().Return(ServiceUUID)
				if test.stage == "characteristics" {
					switch test.kind {
					case "error":
						f.service.EXPECT().DiscoverCharacteristics(nil).Return(nil, fault)
					case "cancel":
						f.service.EXPECT().DiscoverCharacteristics(nil).DoAndReturn(func([]string) ([]Characteristic, error) { cancel(); return []Characteristic{f.write}, nil })
					case "missing":
						f.service.EXPECT().DiscoverCharacteristics(nil).Return(nil, nil)
					case "duplicate":
						f.service.EXPECT().DiscoverCharacteristics(nil).Return([]Characteristic{f.write, f.write}, nil)
						f.write.EXPECT().UUID().Return(WriteUUID).Times(4)
					case "wrong":
						f.service.EXPECT().DiscoverCharacteristics(nil).Return([]Characteristic{f.write}, nil)
						f.write.EXPECT().UUID().Return(NotifyUUID).Times(2)
					}
					return
				}
				f.service.EXPECT().DiscoverCharacteristics(nil).Return([]Characteristic{f.write}, nil)
				f.write.EXPECT().UUID().Return(WriteUUID).Times(2)
				if test.kind == "error" {
					f.device.EXPECT().Connected().After(initial).Return(false, fault)
				} else {
					f.device.EXPECT().Connected().After(initial).Return(false, nil)
				}
			}
			configure()
			info, err := f.backend.Connect(ctx)
			require.ErrorIs(t, err, test.want)
			assert.Equal(t, Info{}, info)
			assert.False(t, f.backend.Connected())
			assert.False(t, f.backend.hasWrite)
			assert.Nil(t, f.backend.write)
			require.NoError(t, f.backend.Close())
		})
	}
}

func TestConnectBoundsNativeTimeoutByContext(t *testing.T) {
	f := newConnectionMocks(t)
	f.expectScan(t)
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	fault := errors.New("stop before discovery")
	f.adapter.EXPECT().Connect(f.advertisement.Address, gomock.Any()).DoAndReturn(func(_ Address, timeout time.Duration) (Device, error) {
		assert.Positive(t, timeout)
		assert.LessOrEqual(t, timeout, time.Second)
		return nil, fault
	})
	_, err := f.backend.Connect(ctx)
	assert.ErrorIs(t, err, fault)
}

func awaitBLESignal(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(2 * time.Second):
		require.FailNow(t, "mock native operation did not reach its barrier")
	}
}

func TestScanKeepsFirstMatchAndJoinsStopper(t *testing.T) {
	f := newConnectionMocks(t)
	stopEntered, scanReturned, releaseStop := make(chan struct{}), make(chan struct{}), make(chan struct{})
	unblock := sync.OnceFunc(func() { close(releaseStop) })
	defer unblock()
	f.adapter.EXPECT().StopScan().DoAndReturn(func() error { close(stopEntered); <-releaseStop; return nil })
	f.adapter.EXPECT().Scan(gomock.Any()).DoAndReturn(func(callback func(Advertisement)) error {
		first, second := f.advertisement, f.advertisement
		first.Name, second.Name = "first match", "later match"
		callback(first)
		callback(second)
		<-stopEntered
		close(scanReturned)
		return nil
	})
	type result struct {
		match scanMatch
		err   error
	}
	done := make(chan result, 1)
	ctx := t.Context()
	go func() { match, err := f.backend.scanLocked(ctx); done <- result{match, err} }()
	awaitBLESignal(t, scanReturned)
	select {
	case <-done:
		require.FailNow(t, "scan returned before its stopper")
	case <-time.After(20 * time.Millisecond):
	}
	unblock()
	select {
	case got := <-done:
		require.NoError(t, got.err)
		assert.Equal(t, "first match", got.match.info.Name)
	case <-time.After(2 * time.Second):
		require.FailNow(t, "scan did not join stopper")
	}
}

func TestScanRetriesStopWhenCancellationRacesStartup(t *testing.T) {
	f := newConnectionMocks(t)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	firstStop, started, stopped := make(chan struct{}), make(chan struct{}), make(chan struct{})
	failed := f.adapter.EXPECT().StopScan().DoAndReturn(func() error { close(firstStop); return errors.New("not scanning") })
	f.adapter.EXPECT().StopScan().After(failed).DoAndReturn(func() error { <-started; close(stopped); return nil })
	f.adapter.EXPECT().Scan(gomock.Any()).DoAndReturn(func(func(Advertisement)) error {
		cancel()
		<-firstStop
		close(started)
		<-stopped
		return nil
	})
	_, err := f.backend.scanLocked(ctx)
	assert.ErrorIs(t, err, context.Canceled)
}

func TestScanCancellationBeforeOrAfterMatch(t *testing.T) {
	for _, matchFirst := range []bool{false, true} {
		t.Run(fmt.Sprintf("match_first_%t", matchFirst), func(t *testing.T) {
			f := newConnectionMocks(t)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			stopped := make(chan struct{})
			f.adapter.EXPECT().StopScan().DoAndReturn(func() error { close(stopped); return nil })
			f.adapter.EXPECT().Scan(gomock.Any()).DoAndReturn(func(callback func(Advertisement)) error {
				if matchFirst {
					callback(f.advertisement)
				}
				cancel()
				if !matchFirst {
					callback(f.advertisement)
				}
				<-stopped
				return nil
			})
			match, err := f.backend.scanLocked(ctx)
			assert.ErrorIs(t, err, context.Canceled)
			assert.Equal(t, scanMatch{}, match)
		})
	}
}

func TestScanTimeoutAndErrorPrecedence(t *testing.T) {
	nativeErr := errors.New("permission denied by adapter")
	for _, test := range []struct {
		name                   string
		parentCancel, waitStop bool
		nativeErr, want        error
	}{
		{"no_match", false, false, nil, ErrNotFound},
		{"native_error", false, false, nativeErr, ErrPermission},
		{"scan_expired", false, true, nil, ErrNotFound},
		{"scan_expired_native_error", false, true, nativeErr, ErrPermission},
		{"parent_canceled_native_error", true, true, nativeErr, context.Canceled},
	} {
		t.Run(test.name, func(t *testing.T) {
			f := newConnectionMocks(t)
			f.backend.config.ScanTimeout = 5 * time.Millisecond
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			stopped := make(chan struct{})
			if test.waitStop {
				f.adapter.EXPECT().StopScan().DoAndReturn(func() error { close(stopped); return nil })
			}
			f.adapter.EXPECT().Scan(gomock.Any()).DoAndReturn(func(func(Advertisement)) error {
				if test.parentCancel {
					cancel()
				}
				if test.waitStop {
					<-stopped
				}
				return test.nativeErr
			})
			_, err := f.backend.scanLocked(ctx)
			require.ErrorIs(t, err, test.want)
			if test.parentCancel {
				assert.NotErrorIs(t, err, nativeErr)
			} else if test.nativeErr != nil {
				assert.ErrorIs(t, err, nativeErr)
			}
			if test.want == ErrNotFound {
				assert.NotErrorIs(t, err, context.DeadlineExceeded)
			}
		})
	}
}

func (f connectionMocks) makeReady() {
	f.backend.device, f.backend.hasDevice = f.device, true
	f.backend.write, f.backend.hasWrite = f.write, true
	f.backend.connected.Store(true)
	f.backend.info = Info{Identity: testIdentity, Address: "test-address"}
}

func TestWriteReadinessAndPreWriteCancellation(t *testing.T) {
	fault := errors.New("native status failure")
	for _, test := range []struct {
		name      string
		connected bool
		nativeErr error
		cancel    bool
		want      error
	}{
		{"status_error", false, fault, false, fault},
		{"link_lost", false, nil, false, ErrNotConnected},
		{"canceled_after_readiness", true, nil, true, context.Canceled},
	} {
		t.Run(test.name, func(t *testing.T) {
			f := newConnectionMocks(t)
			f.makeReady()
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			f.device.EXPECT().Connected().DoAndReturn(func() (bool, error) {
				if test.cancel {
					cancel()
				}
				return test.connected, test.nativeErr
			})
			err := f.backend.Write(ctx, []byte{0x55})
			assert.ErrorIs(t, err, test.want)
			assert.NotErrorIs(t, err, ErrWriteUncertain)
			assert.True(t, f.backend.lastWrite.IsZero())
			assert.Equal(t, test.connected, f.backend.Connected())
			// No characteristic Write expectation: readiness/cancellation must stop it.
		})
	}
}

func TestWriteCopiesPacketAndClassifiesResults(t *testing.T) {
	fault := errors.New("native write failure")
	for _, test := range []struct {
		name                     string
		n                        int
		nativeErr                error
		cancel, uncertain, short bool
	}{
		{"success", 2, nil, false, false, false},
		{"short_write", 1, nil, false, true, true},
		{"zero_write", 0, nil, false, true, true},
		{"native_error_before_short_check", 1, fault, false, false, false},
		{"canceled_success", 2, nil, true, true, false},
		{"canceled_native_error", 1, fault, true, true, false},
		{"canceled_short_result", 1, nil, true, true, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			f := newConnectionMocks(t)
			f.makeReady()
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			frame := []byte{0x55, 0x01}
			f.device.EXPECT().Connected().Return(true, nil)
			f.write.EXPECT().WriteWithoutResponse(frame).DoAndReturn(func(got []byte) (int, error) {
				assert.NotSame(t, &frame[0], &got[0])
				got[0] = 0 // Changing the owned native input must not change the caller's slice.
				if test.cancel {
					cancel()
				}
				return test.n, test.nativeErr
			})
			err := f.backend.Write(ctx, frame)
			assert.Equal(t, []byte{0x55, 0x01}, frame)
			assert.False(t, f.backend.lastWrite.IsZero())
			if test.nativeErr != nil {
				assert.ErrorIs(t, err, test.nativeErr)
			}
			if test.cancel {
				assert.ErrorIs(t, err, context.Canceled)
			} else {
				assert.NotErrorIs(t, err, context.Canceled)
			}
			if test.uncertain {
				assert.ErrorIs(t, err, ErrWriteUncertain)
			} else {
				assert.NotErrorIs(t, err, ErrWriteUncertain)
			}
			if test.short {
				assert.ErrorIs(t, err, io.ErrShortWrite)
			} else {
				assert.NotErrorIs(t, err, io.ErrShortWrite)
			}
			if !test.uncertain && test.nativeErr == nil {
				require.NoError(t, err)
			}
		})
	}
}

func TestWriteWaitsForStartedNativeOperation(t *testing.T) {
	f := newConnectionMocks(t)
	f.makeReady()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	entered, release := make(chan struct{}), make(chan struct{})
	unblock := sync.OnceFunc(func() { close(release) })
	defer unblock()
	f.device.EXPECT().Connected().Return(true, nil)
	f.write.EXPECT().WriteWithoutResponse([]byte{0x55}).DoAndReturn(func([]byte) (int, error) {
		close(entered)
		<-release
		return 1, nil
	})
	done := make(chan error, 1)
	go func() { done <- f.backend.Write(ctx, []byte{0x55}) }()
	awaitBLESignal(t, entered)
	cancel()
	select {
	case <-done:
		require.FailNow(t, "Write abandoned a started native operation")
	case <-time.After(20 * time.Millisecond):
	}
	unblock()
	select {
	case err := <-done:
		assert.ErrorIs(t, err, context.Canceled)
		assert.ErrorIs(t, err, ErrWriteUncertain)
	case <-time.After(2 * time.Second):
		require.FailNow(t, "Write did not join native completion")
	}
}

func TestBackendCloseClearsHandlesAndRetainsFailedCleanup(t *testing.T) {
	fault := errors.New("disconnect request failed")
	for _, test := range []struct {
		name          string
		disconnectErr error
		noDevice      bool
	}{
		{"requested", nil, false},
		{"already_disconnected", errors.New("not connected"), false},
		{"bluez_already_disconnected", errors.New("org.bluez.Error.NotConnected"), false},
		{"failed_disconnect", fault, false},
		{"no_device", nil, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			f := newConnectionMocks(t)
			f.makeReady()
			f.backend.enabled = true
			f.backend.fatal = ErrNeedsRestart
			if test.noDevice {
				f.backend.hasDevice = false
				f.backend.device = nil
			} else {
				f.device.EXPECT().Disconnect().DoAndReturn(func() error {
					assert.False(t, f.backend.Connected())
					assert.False(t, f.backend.hasWrite)
					assert.Nil(t, f.backend.write)
					return test.disconnectErr
				})
			}
			err := f.backend.Close()
			assert.False(t, f.backend.Connected())
			assert.False(t, f.backend.hasWrite)
			assert.Nil(t, f.backend.write)
			assert.True(t, f.backend.enabled, "Close must not reset the adapter")
			assert.ErrorIs(t, f.backend.fatal, ErrNeedsRestart)
			if errors.Is(test.disconnectErr, fault) {
				require.ErrorIs(t, err, fault)
				assert.True(t, f.backend.hasDevice)
				assert.Same(t, f.device, f.backend.device)
				f.device.EXPECT().Disconnect().Return(nil)
				require.NoError(t, f.backend.Close())
			} else {
				require.NoError(t, err)
			}
			assert.False(t, f.backend.hasDevice)
			assert.Nil(t, f.backend.device)
			require.NoError(t, f.backend.Close()) // Repeated cleanup needs no native call.
		})
	}
}

func TestBackendCloseDrainsSinceLastWrite(t *testing.T) {
	for _, age := range []time.Duration{0, 40 * time.Millisecond, 160 * time.Millisecond} {
		t.Run(age.String(), func(t *testing.T) {
			f := newConnectionMocks(t)
			f.makeReady()
			lastWrite := time.Now().Add(-age)
			f.backend.lastWrite = lastWrite
			f.device.EXPECT().Disconnect().DoAndReturn(func() error {
				assert.False(t, time.Now().Before(lastWrite.Add(80*time.Millisecond)), "disconnect preceded the drain interval")
				return nil
			})
			require.NoError(t, f.backend.Close())
		})
	}
}

func TestDiscoveryErrorClassificationAndStickyTimeout(t *testing.T) {
	for _, stage := range []string{"services", "characteristics"} {
		for _, test := range []struct {
			name, message string
			want          error
		}{
			{"permission_denied", "permission denied", ErrPermission},
			{"not_authorized", "not authorized", ErrPermission},
			{"unauthorized", "unauthorized adapter", ErrPermission},
			{"missing_result", "could not find requested UUID", ErrIncompatible},
			{"timeout", "Discovery TIMEOUT", ErrNeedsRestart},
			{"other_error", "radio busy", nil},
		} {
			t.Run(stage+"/"+test.name, func(t *testing.T) {
				f := newConnectionMocks(t)
				f.expectScan(t)
				cause := errors.New(test.message)
				f.adapter.EXPECT().Connect(f.advertisement.Address, gomock.Any()).Return(f.device, nil)
				f.device.EXPECT().Address().Return("test-address")
				f.device.EXPECT().Connected().Return(true, nil)
				f.device.EXPECT().Disconnect().Return(nil)
				if stage == "services" {
					f.device.EXPECT().DiscoverServices([]string{ServiceUUID}).Return(nil, cause)
				} else {
					f.device.EXPECT().DiscoverServices([]string{ServiceUUID}).Return([]Service{f.service}, nil)
					f.service.EXPECT().UUID().Return(ServiceUUID)
					f.service.EXPECT().DiscoverCharacteristics(nil).Return(nil, cause)
				}
				_, err := f.backend.Connect(t.Context())
				require.Error(t, err)
				assert.False(t, f.backend.Connected())
				assert.False(t, f.backend.hasWrite)
				assert.False(t, f.backend.hasDevice)
				if test.name == "timeout" && runtime.GOOS == "darwin" {
					require.ErrorIs(t, err, ErrNeedsRestart)
					require.NoError(t, f.backend.Close())
					assert.ErrorIs(t, f.backend.fatal, ErrNeedsRestart)
					_, err = f.backend.Connect(t.Context())
					assert.ErrorIs(t, err, ErrNeedsRestart)
					_, err = f.backend.Inspect(t.Context())
					assert.ErrorIs(t, err, ErrNeedsRestart)
					assert.ErrorIs(t, f.backend.Write(t.Context(), []byte{0x55}), ErrNeedsRestart)
				} else {
					assert.Nil(t, f.backend.fatal)
					if test.want != nil && test.name != "timeout" {
						assert.ErrorIs(t, err, test.want)
					}
					if !errors.Is(test.want, ErrIncompatible) {
						assert.ErrorIs(t, err, cause)
					}
					if errors.Is(test.want, ErrPermission) {
						assert.Contains(t, err.Error(), "Системные настройки")
					}
					assert.NotErrorIs(t, err, ErrNeedsRestart)
					require.NoError(t, f.backend.Close())
				}
			})
		}
	}
}

func TestBackendConstructorIdentityBoundaries(t *testing.T) {
	for _, identity := range []string{"", "AA:BB:CC:DD:EE", "AA:BB:CC:DD:EE:FF:00", "A:BB:CC:DD:EE:FF", "AA:BB:CC:DD:EE:FFF", "GG:BB:CC:DD:EE:FF", "AABBCCDDEEFF", " AA:BB:CC:DD:EE:FF"} {
		t.Run(identity, func(t *testing.T) {
			adapter := NewMockAdapter(gomock.NewController(t))
			b, err := New(Config{Identity: identity}, adapter)
			assert.Error(t, err)
			assert.Nil(t, b)
		})
	}
	t.Run("normalized_identity_and_defaults", func(t *testing.T) {
		adapter := NewMockAdapter(gomock.NewController(t))
		b, err := New(Config{Identity: "aa:Bb:cc:Dd:ee:Ff"}, adapter)
		require.NoError(t, err)
		assert.Equal(t, testIdentity, b.config.Identity)
		assert.Equal(t, [6]byte{0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff}, b.identity)
		assert.Equal(t, 12*time.Second, b.config.ScanTimeout)
		assert.Equal(t, 12*time.Second, b.config.ConnectTimeout)
	})
	t.Run("adapter_required", func(t *testing.T) {
		b, err := New(Config{Identity: testIdentity}, nil)
		assert.Error(t, err)
		assert.Nil(t, b)
	})
}

func TestBackendConstructorTimeoutBoundaries(t *testing.T) {
	for _, test := range []struct {
		name          string
		scan, connect time.Duration
		valid         bool
	}{
		{"both_default", 0, 0, true},
		{"scan_negative", -time.Millisecond, 0, false},
		{"scan_below_minimum", time.Millisecond - time.Nanosecond, 0, false},
		{"scan_minimum", time.Millisecond, 0, true},
		{"scan_no_connect_upper_bound", time.Hour, 0, true},
		{"connect_negative", 0, -time.Millisecond, false},
		{"connect_below_minimum", 0, time.Millisecond - time.Nanosecond, false},
		{"connect_minimum", 0, time.Millisecond, true},
		{"connect_maximum", 0, 40 * time.Second, true},
		{"connect_above_maximum", 0, 40*time.Second + time.Nanosecond, false},
		{"explicit_both", 3 * time.Second, 4 * time.Second, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			adapter := NewMockAdapter(gomock.NewController(t))
			b, err := New(Config{Identity: testIdentity, ScanTimeout: test.scan, ConnectTimeout: test.connect}, adapter)
			if !test.valid {
				assert.Error(t, err)
				assert.Nil(t, b)
				return
			}
			require.NoError(t, err)
			wantScan, wantConnect := test.scan, test.connect
			if wantScan == 0 {
				wantScan = 12 * time.Second
			}
			if wantConnect == 0 {
				wantConnect = 12 * time.Second
			}
			assert.Equal(t, wantScan, b.config.ScanTimeout)
			assert.Equal(t, wantConnect, b.config.ConnectTimeout)
			assert.False(t, b.enabled)
			assert.False(t, b.Connected())
		})
	}
}

func TestWriteLengthAndEarlyErrorPrecedence(t *testing.T) {
	for _, length := range []int{0, 1, 20, 21} {
		for _, canceled := range []bool{false, true} {
			for _, fatal := range []bool{false, true} {
				for handles := range 4 {
					// Healthy complete handles belong to native-write tests, not early gates.
					if handles == 3 && !canceled && !fatal && (length == 1 || length == 20) {
						continue
					}
					name := fmt.Sprintf("len_%d/canceled_%t/fatal_%t/handles_%d", length, canceled, fatal, handles)
					t.Run(name, func(t *testing.T) {
						f := newConnectionMocks(t)
						f.makeReady()
						f.backend.hasDevice = handles&1 != 0
						f.backend.hasWrite = handles&2 != 0
						if fatal {
							f.backend.fatal = fmt.Errorf("sticky: %w", ErrNeedsRestart)
						}
						ctx, cancel := context.WithCancel(t.Context())
						defer cancel()
						if canceled {
							cancel()
						}
						want := ErrNotConnected
						switch {
						case length == 0 || length == 21:
							want = ErrInvalidPacket
						case canceled:
							want = context.Canceled
						case fatal:
							want = ErrNeedsRestart
						}
						err := f.backend.Write(ctx, make([]byte, length))
						require.ErrorIs(t, err, want)
						for _, other := range []error{ErrInvalidPacket, context.Canceled, ErrNeedsRestart, ErrNotConnected} {
							if !errors.Is(want, other) {
								assert.NotErrorIs(t, err, other)
							}
						}
						assert.True(t, f.backend.Connected(), "early errors must preserve observed readiness")
						assert.Equal(t, handles&1 != 0, f.backend.hasDevice)
						assert.Equal(t, handles&2 != 0, f.backend.hasWrite)
						assert.Same(t, f.device, f.backend.device)
						assert.Same(t, f.write, f.backend.write)
						assert.True(t, f.backend.lastWrite.IsZero())
						// No Adapter/Device/Characteristic expectations allow native work.
					})
				}
			}
		}
	}
}
