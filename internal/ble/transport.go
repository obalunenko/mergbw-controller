package ble

import "time"

// Adapter is the synchronous native boundary. Implementations must not detach
// operations: Backend owns cancellation checks and the scan stopper lifetime.
type Adapter interface {
	Enable() error
	SetConnectHandler(func(Device, bool))
	Scan(func(Advertisement)) error
	StopScan() error
	Connect(Address, time.Duration) (Device, error)
}

// Address preserves the platform's native address, including Linux address type.
type Address interface {
	String() string
}

type Device interface {
	Address() string
	Connected() (bool, error)
	DiscoverServices([]string) ([]Service, error)
	Disconnect() error
}

type Service interface {
	UUID() string
	DiscoverCharacteristics([]string) ([]Characteristic, error)
}

type Characteristic interface {
	UUID() string
	WriteWithoutResponse([]byte) (int, error)
}

// Advertisement is a snapshot of a scan callback. Manufacturer payloads exclude
// the CompanyID bytes, matching the upstream Darwin and Linux APIs.
type Advertisement struct {
	Address Address
	Name    string
	RSSI    int16
	// Preserve the native HasServiceUUID result, including platform-specific
	// treatment of 16-bit versus 128-bit advertisement fields.
	HasAdvertisingService bool
	Services              []string
	ManufacturerData      []ManufacturerData
}

type ManufacturerData struct {
	CompanyID uint16
	Data      []byte
}
