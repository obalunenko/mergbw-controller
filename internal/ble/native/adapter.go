//go:build darwin || linux

// Package native adapts TinyGo Bluetooth to the synchronous ble interfaces.
// Importing this package can initialize CoreBluetooth on macOS. Unit tests
// depend on ble and generated mocks instead.
package native

import (
	"fmt"
	"slices"
	"time"

	"github.com/obalunenko/mergbw-controller/internal/ble"
	"tinygo.org/x/bluetooth"
)

type adapter struct{ native *bluetooth.Adapter }
type device struct{ native bluetooth.Device }
type service struct{ native bluetooth.DeviceService }
type characteristic struct {
	native bluetooth.DeviceCharacteristic
}

// DefaultAdapter shares the process-global adapter and callback registration.
func DefaultAdapter() ble.Adapter { return &adapter{native: bluetooth.DefaultAdapter} }

func (a *adapter) Enable() error   { return a.native.Enable() }
func (a *adapter) StopScan() error { return a.native.StopScan() }

func (a *adapter) SetConnectHandler(callback func(ble.Device, bool)) {
	a.native.SetConnectHandler(func(d bluetooth.Device, connected bool) {
		callback(device{native: d}, connected)
	})
}

func (a *adapter) Scan(callback func(ble.Advertisement)) error {
	return a.native.Scan(func(_ *bluetooth.Adapter, result bluetooth.ScanResult) {
		if result.AdvertisementPayload == nil {
			return
		}
		ad := ble.Advertisement{
			Address: result.Address, Name: result.LocalName(), RSSI: result.RSSI,
			HasAdvertisingService: result.HasServiceUUID(bluetooth.New16BitUUID(0x3519)),
		}
		for _, uuid := range result.ServiceUUIDs() {
			ad.Services = append(ad.Services, uuid.String())
		}
		for _, data := range result.ManufacturerData() {
			ad.ManufacturerData = append(ad.ManufacturerData, ble.ManufacturerData{CompanyID: data.CompanyID, Data: slices.Clone(data.Data)})
		}
		callback(ad)
	})
}

func (a *adapter) Connect(address ble.Address, timeout time.Duration) (ble.Device, error) {
	nativeAddress, ok := address.(bluetooth.Address)
	if !ok {
		return nil, fmt.Errorf("native Bluetooth: unexpected address type %T", address)
	}
	d, err := a.native.Connect(nativeAddress, bluetooth.ConnectionParams{ConnectionTimeout: bluetooth.NewDuration(timeout)})
	if err != nil {
		return nil, err
	}
	return device{native: d}, nil
}

func (d device) Address() string          { return d.native.Address.String() }
func (d device) Connected() (bool, error) { return d.native.Connected() }
func (d device) Disconnect() error        { return d.native.Disconnect() }

func parseUUIDs(values []string) ([]bluetooth.UUID, error) {
	var uuids []bluetooth.UUID
	for _, value := range values {
		uuid, err := bluetooth.ParseUUID(value)
		if err != nil {
			return nil, err
		}
		uuids = append(uuids, uuid)
	}
	return uuids, nil
}

func (d device) DiscoverServices(values []string) ([]ble.Service, error) {
	uuids, err := parseUUIDs(values)
	if err != nil {
		return nil, err
	}
	services, err := d.native.DiscoverServices(uuids)
	if err != nil {
		return nil, err
	}
	result := make([]ble.Service, len(services))
	for i, s := range services {
		result[i] = service{native: s}
	}
	return result, nil
}

func (s service) UUID() string { return s.native.UUID().String() }
func (s service) DiscoverCharacteristics(values []string) ([]ble.Characteristic, error) {
	uuids, err := parseUUIDs(values)
	if err != nil {
		return nil, err
	}
	characteristics, err := s.native.DiscoverCharacteristics(uuids)
	if err != nil {
		return nil, err
	}
	result := make([]ble.Characteristic, len(characteristics))
	for i, c := range characteristics {
		result[i] = characteristic{native: c}
	}
	return result, nil
}

func (c characteristic) UUID() string { return c.native.UUID().String() }
func (c characteristic) WriteWithoutResponse(packet []byte) (int, error) {
	return c.native.WriteWithoutResponse(packet)
}
