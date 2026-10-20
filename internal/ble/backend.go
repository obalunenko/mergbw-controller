//go:build darwin || linux

package ble

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"tinygo.org/x/bluetooth"
)

const (
	AdvertisingUUID = "00003519-0000-1000-8000-00805f9b34fb"
	ServiceUUID     = "0000fff0-0000-1000-8000-00805f9b34fb"
	WriteUUID       = "0000fff3-0000-1000-8000-00805f9b34fb"
	NotifyUUID      = "0000fff4-0000-1000-8000-00805f9b34fb"
	writeDrainTime  = 80 * time.Millisecond
)

var (
	ErrIncompatible   = errors.New("лампа не предоставляет ожидаемый интерфейс FFF0/FFF3")
	ErrNotConnected   = errors.New("Bluetooth-соединение с лампой не установлено")
	ErrNotFound       = errors.New("лампа с указанной identity не найдена")
	ErrPermission     = errors.New("нет разрешения на доступ к Bluetooth")
	ErrNeedsRestart   = errors.New("Bluetooth-библиотеке требуется перезапуск процесса")
	ErrWriteUncertain = errors.New("запись могла быть передана лампе; подтверждения состояния нет")
	ErrInvalidPacket  = errors.New("BLE-пакет должен содержать от 1 до 20 байт")
)

var (
	advertisingService = bluetooth.New16BitUUID(0x3519)
	lampService        = bluetooth.New16BitUUID(0xfff0)
	lampWrite          = bluetooth.New16BitUUID(0xfff3)
)

type Config struct {
	// Identity is required and identifies the six manufacturer-data bytes.
	Identity       string
	ScanTimeout    time.Duration
	ConnectTimeout time.Duration
}

// Info describes the identified device and link, never the lamp's power/color.
type Info struct {
	Identity                string   `json:"identity"`
	Name                    string   `json:"name"`
	Address                 string   `json:"address"`
	Model                   string   `json:"model,omitempty"`
	DeviceType              int      `json:"device_type,omitempty"`
	ManufacturerID          uint16   `json:"manufacturer_id"`
	RSSI                    int16    `json:"rssi"`
	AdvertisedServices      []string `json:"advertised_services"`
	Connected               bool     `json:"connected"`
	ServiceUUID             string   `json:"service_uuid"`
	WriteUUID               string   `json:"write_uuid"`
	CharacteristicUUIDs     []string `json:"characteristic_uuids"`
	WriteMode               string   `json:"write_mode"`
	WritePropertiesVerified bool     `json:"write_properties_verified"`
	StateReadback           bool     `json:"state_readback"`
}

// Backend owns one persistent connection. Operations must run through the
// caller's command queue. The mutex also prevents accidental concurrent use.
type Backend struct {
	mu        sync.Mutex
	config    Config
	identity  [6]byte
	adapter   *bluetooth.Adapter
	enabled   bool
	device    bluetooth.Device
	hasDevice bool
	write     bluetooth.DeviceCharacteristic
	hasWrite  bool
	info      Info
	lastWrite time.Time
	fatal     error
	connected atomic.Bool
	target    atomic.Value // string; read by the CoreBluetooth callback
}

func New(config Config) (*Backend, error) {
	if config.Identity == "" {
		return nil, errors.New("identity обязательна: укажите идентификатор своей лампы в формате AA:BB:CC:DD:EE:FF")
	}
	identity, normalized, err := parseIdentity(config.Identity)
	if err != nil {
		return nil, err
	}
	config.Identity = normalized
	if config.ScanTimeout == 0 {
		config.ScanTimeout = 12 * time.Second
	}
	if config.ConnectTimeout == 0 {
		config.ConnectTimeout = 12 * time.Second
	}
	if config.ScanTimeout < time.Millisecond {
		return nil, errors.New("ScanTimeout должен быть не меньше 1 ms")
	}
	// bluetooth.Duration is uint16 in 625-microsecond units. Do not silently
	// overflow it or round a short positive timeout down to the default zero.
	if config.ConnectTimeout < time.Millisecond || config.ConnectTimeout > 40*time.Second {
		return nil, errors.New("ConnectTimeout должен быть от 1 ms до 40 s")
	}
	b := &Backend{config: config, identity: identity, adapter: bluetooth.DefaultAdapter}
	b.target.Store("")
	return b, nil
}

func parseIdentity(value string) ([6]byte, string, error) {
	var identity [6]byte
	parts := strings.Split(value, ":")
	if len(parts) != len(identity) {
		return identity, "", errors.New("identity должна иметь вид AA:BB:CC:DD:EE:FF")
	}
	for _, part := range parts {
		if len(part) != 2 {
			return identity, "", errors.New("identity должна содержать шесть HEX-байтов через двоеточие")
		}
	}
	decoded, err := hex.DecodeString(strings.Join(parts, ""))
	if err != nil {
		return identity, "", fmt.Errorf("некорректная identity: %w", err)
	}
	copy(identity[:], decoded)
	return identity, strings.ToUpper(value), nil
}

// Connected is the last observed link status. The native link is checked again
// before every write. It is not an indication that the lamp is illuminated.
func (b *Backend) Connected() bool { return b.connected.Load() }

func (b *Backend) Connect(ctx context.Context) (Info, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if err := b.connectLocked(ctx); err != nil {
		return Info{}, err
	}
	return b.infoLocked(), nil
}

// Inspect establishes the link and discovers FFF0/FFF3, without issuing a
// characteristic write, read or subscription.
func (b *Backend) Inspect(ctx context.Context) (Info, error) { return b.Connect(ctx) }

func (b *Backend) infoLocked() Info {
	info := b.info
	info.Connected = b.connected.Load()
	info.AdvertisedServices = append([]string(nil), info.AdvertisedServices...)
	info.CharacteristicUUIDs = append([]string(nil), info.CharacteristicUUIDs...)
	return info
}

func (b *Backend) connectLocked(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if b.fatal != nil {
		return b.fatal
	}
	if b.hasDevice && b.hasWrite {
		connected, err := b.device.Connected()
		if err == nil && connected {
			b.connected.Store(true)
			return ctx.Err()
		}
	}
	if err := b.closeLocked(); err != nil {
		return fmt.Errorf("освобождение прежнего соединения: %w", err)
	}
	if !b.enabled {
		if err := b.adapter.Enable(); err != nil {
			return friendlyError("включение Bluetooth-адаптера", err)
		}
		b.enabled = true
		// Never take b.mu in a native callback: Connect and discovery may be
		// waiting for that same serial callback queue while holding the mutex.
		b.adapter.SetConnectHandler(func(device bluetooth.Device, connected bool) {
			if !connected && device.Address.String() == b.target.Load().(string) {
				b.connected.Store(false)
			}
		})
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	match, err := b.scanLocked(ctx)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	b.info = match.info
	b.target.Store(match.address.String())
	timeout := b.config.ConnectTimeout
	if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) < timeout {
		timeout = time.Until(deadline)
	}
	if timeout < 625*time.Microsecond {
		if err := ctx.Err(); err != nil {
			return err
		}
		return context.DeadlineExceeded
	}
	// Deliberately synchronous. A goroutine + select(ctx.Done()) would leave
	// a native connection operation alive after its caller had returned.
	device, err := b.adapter.Connect(match.address, bluetooth.ConnectionParams{
		ConnectionTimeout: bluetooth.NewDuration(timeout),
	})
	if err != nil {
		return friendlyError("подключение к лампе", err)
	}
	// v0.16.0 Darwin can return Device{}, nil on an early connection failure.
	// Calling Connected on that zero Device would dereference a nil internal.
	if device.Address.String() != match.address.String() {
		return fmt.Errorf("%w: библиотека вернула пустое или другое устройство", ErrNotConnected)
	}
	b.device, b.hasDevice = device, true
	if err := ctx.Err(); err != nil {
		_ = b.closeLocked()
		return err
	}
	connected, err := device.Connected()
	if err != nil || !connected {
		_ = b.closeLocked()
		if err != nil {
			return friendlyError("проверка соединения", err)
		}
		return ErrNotConnected
	}
	services, err := device.DiscoverServices([]bluetooth.UUID{lampService})
	if err != nil {
		return b.discoveryErrorLocked("поиск сервиса FFF0", err)
	}
	if err := ctx.Err(); err != nil {
		_ = b.closeLocked()
		return err
	}
	if len(services) != 1 || services[0].UUID() != lampService {
		_ = b.closeLocked()
		return fmt.Errorf("%w: сервис FFF0 не найден", ErrIncompatible)
	}
	// Discover all characteristics in this service so a duplicate FFF3 is
	// rejected rather than silently selecting the first one.
	characteristics, err := services[0].DiscoverCharacteristics(nil)
	if err != nil {
		return b.discoveryErrorLocked("поиск характеристики FFF3", err)
	}
	if err := ctx.Err(); err != nil {
		_ = b.closeLocked()
		return err
	}
	found := 0
	b.info.CharacteristicUUIDs = nil
	for _, characteristic := range characteristics {
		b.info.CharacteristicUUIDs = append(b.info.CharacteristicUUIDs, characteristic.UUID().String())
		if characteristic.UUID() == lampWrite {
			b.write = characteristic
			found++
		}
	}
	if found != 1 {
		_ = b.closeLocked()
		return fmt.Errorf("%w: найдено характеристик FFF3: %d", ErrIncompatible, found)
	}
	connected, err = device.Connected()
	if err != nil || !connected {
		_ = b.closeLocked()
		if err != nil {
			return friendlyError("проверка соединения после GATT discovery", err)
		}
		return ErrNotConnected
	}
	sort.Strings(b.info.CharacteristicUUIDs)
	b.hasWrite = true
	b.connected.Store(true)
	b.info.ServiceUUID = ServiceUUID
	b.info.WriteUUID = WriteUUID
	b.info.WriteMode = "without_response"
	return ctx.Err()
}

type scanMatch struct {
	address bluetooth.Address
	info    Info
}

func matchAdvertisement(result bluetooth.ScanResult, identity [6]byte, normalized string) (scanMatch, bool) {
	if result.AdvertisementPayload == nil || !result.HasServiceUUID(advertisingService) {
		return scanMatch{}, false
	}
	for _, manufacturer := range result.ManufacturerData() {
		// Data excludes CompanyID on both macOS (cbgo strips its two bytes)
		// and Linux (BlueZ supplies it separately). CompanyID is not identity.
		data := manufacturer.Data
		if len(data) < len(identity) || !bytes.Equal(data[:6], identity[:]) {
			continue
		}
		deviceType := 0
		if len(data) > 8 {
			deviceType = int(data[8])
			if deviceType != 5 {
				continue
			}
		}
		model := ""
		if len(data) > 9 {
			modelData := data[9:min(len(data), 19)]
			if end := bytes.IndexByte(modelData, 0); end >= 0 {
				modelData = modelData[:end]
			}
			model = string(modelData)
			if model != "" && model != "LT-06" {
				continue
			}
		}
		var services []string
		for _, uuid := range result.ServiceUUIDs() {
			services = append(services, uuid.String())
		}
		sort.Strings(services)
		return scanMatch{address: result.Address, info: Info{
			Identity: normalized, Name: result.LocalName(), Address: result.Address.String(),
			Model: model, DeviceType: deviceType, ManufacturerID: manufacturer.CompanyID,
			RSSI: result.RSSI, AdvertisedServices: services,
		}}, true
	}
	return scanMatch{}, false
}

func (b *Backend) scanLocked(parent context.Context) (scanMatch, error) {
	ctx, cancel := context.WithTimeout(parent, b.config.ScanTimeout)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return scanMatch{}, err
	}
	matches := make(chan scanMatch, 1)
	stopRequest := make(chan struct{}, 1)
	scanFinished := make(chan struct{})
	stopperFinished := make(chan struct{})
	var first sync.Once
	// Only this goroutine calls StopScan. It is always joined. A callback
	// merely requests a stop, avoiding two StopScan calls racing each other
	// and avoiding a blocked CoreBluetooth callback queue.
	go func() {
		defer close(stopperFinished)
		select {
		case <-stopRequest:
		case <-ctx.Done():
		case <-scanFinished:
			return
		}
		for {
			select {
			case <-scanFinished:
				return
			default:
			}
			if err := b.adapter.StopScan(); err == nil {
				return
			}
			// The public API has no scan-start event. If cancellation raced
			// the initial Scan call, StopScan reports "not scanning"; wait
			// until Scan has either started or returned. Never detach here.
			timer := time.NewTimer(5 * time.Millisecond)
			select {
			case <-scanFinished:
				timer.Stop()
				return
			case <-timer.C:
			}
		}
	}()
	err := b.adapter.Scan(func(_ *bluetooth.Adapter, result bluetooth.ScanResult) {
		if ctx.Err() != nil {
			return
		}
		if match, ok := matchAdvertisement(result, b.identity, b.config.Identity); ok {
			first.Do(func() {
				matches <- match
				stopRequest <- struct{}{}
			})
		}
	})
	close(scanFinished)
	<-stopperFinished
	if parent.Err() != nil {
		return scanMatch{}, parent.Err()
	}
	if err != nil {
		return scanMatch{}, friendlyError("сканирование Bluetooth", err)
	}
	if ctx.Err() != nil {
		return scanMatch{}, fmt.Errorf("%w за %s; проверь питание и отключись в nRF Connect/MeRGBW", ErrNotFound, b.config.ScanTimeout)
	}
	select {
	case match := <-matches:
		return match, nil
	default:
		return scanMatch{}, ErrNotFound
	}
}

func (b *Backend) discoveryErrorLocked(stage string, cause error) error {
	_ = b.closeLocked()
	if runtime.GOOS == "darwin" && strings.Contains(strings.ToLower(cause.Error()), "timeout") {
		b.fatal = fmt.Errorf("%w: %s: %v; перезапусти сервер перед следующей попыткой", ErrNeedsRestart, stage, cause)
		return b.fatal
	}
	if strings.Contains(strings.ToLower(cause.Error()), "not find") || strings.Contains(strings.ToLower(cause.Error()), "could not find") {
		return fmt.Errorf("%w: %s: %v", ErrIncompatible, stage, cause)
	}
	return friendlyError(stage, cause)
}

// Write sends one already-validated protocol packet using WriteWithoutResponse.
// It does not implicitly connect or retry, and does not acknowledge lamp state.
func (b *Backend) Write(ctx context.Context, packet []byte) error {
	if len(packet) < 1 || len(packet) > 20 {
		return ErrInvalidPacket
	}
	packet = append([]byte(nil), packet...)
	b.mu.Lock()
	defer b.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if b.fatal != nil {
		return b.fatal
	}
	if !b.hasDevice || !b.hasWrite {
		return ErrNotConnected
	}
	connected, err := b.device.Connected()
	if err != nil || !connected {
		b.connected.Store(false)
		if err != nil {
			return friendlyError("проверка соединения перед записью", err)
		}
		return ErrNotConnected
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	// This native call may wait for buffer space and cannot be interrupted by
	// ctx. We wait for its return; no background writer outlives this method.
	n, err := b.write.WriteWithoutResponse(packet)
	b.lastWrite = time.Now()
	if contextErr := ctx.Err(); contextErr != nil {
		return errors.Join(contextErr, ErrWriteUncertain, err)
	}
	if err != nil {
		return friendlyError("запись FFF3 без ответа", err)
	}
	if n != len(packet) {
		return errors.Join(io.ErrShortWrite, ErrWriteUncertain)
	}
	return nil
}

// Close releases the link and is reusable: a later Connect may scan again.
// It does not Reset the global adapter or clear a sticky ErrNeedsRestart.
func (b *Backend) Close() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.closeLocked()
}

func (b *Backend) closeLocked() error {
	b.connected.Store(false)
	b.hasWrite = false
	b.write = bluetooth.DeviceCharacteristic{}
	if !b.hasDevice {
		return nil
	}
	// Queued writes need time to leave the host before requesting disconnect.
	// This delay does not turn the transport into a state acknowledgement.
	if remaining := writeDrainTime - time.Since(b.lastWrite); remaining > 0 {
		time.Sleep(remaining)
	}
	device := b.device
	b.hasDevice = false
	b.device = bluetooth.Device{}
	err := device.Disconnect()
	if err == nil {
		return nil
	}
	// BlueZ may report NotConnected after the link disappeared on its own.
	// That already satisfies Close; do not spend the caller's one retry on it.
	if strings.Contains(strings.ToLower(err.Error()), "not connected") ||
		strings.Contains(strings.ToLower(err.Error()), "notconnected") {
		return nil
	}
	// Retain the handle if cancellation itself failed, so a subsequent Close
	// can still release it. No write characteristic remains usable.
	b.device, b.hasDevice = device, true
	return err
}

func friendlyError(stage string, cause error) error {
	message := strings.ToLower(cause.Error())
	if strings.Contains(message, "not authorized") || strings.Contains(message, "unauthorized") ||
		strings.Contains(message, "permission") || strings.Contains(message, "denied") {
		return fmt.Errorf("%w: %s; разреши приложению Bluetooth в «Системные настройки → Конфиденциальность и безопасность → Bluetooth»: %w", ErrPermission, stage, cause)
	}
	return fmt.Errorf("%s: %w", stage, cause)
}
