//go:build darwin || linux

package ble

import (
	"context"
	"encoding/hex"
	"errors"
	"testing"

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

func TestCancelledOperationsDoNotStartBLE(t *testing.T) {
	b, err := New(Config{Identity: testIdentity})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
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
}
