GO ?= go
CORE_PACKAGES := ./internal/protocol ./internal/config ./internal/logging ./internal/controller ./internal/bridge

.DEFAULT_GOAL := build
.PHONY: build test test-core test-race vet check

build:
	$(GO) build -trimpath -buildvcs=false -o sunset ./cmd/sunset

# The full suite imports the native BLE package. On macOS, use test-core or
# test-race to test without initializing CoreBluetooth or requesting permission.
test:
	$(GO) test ./...

test-core:
	$(GO) test $(CORE_PACKAGES)

test-race:
	$(GO) test -race $(CORE_PACKAGES)

vet:
	$(GO) vet ./...

# Intended for Linux CI; the macOS job only builds the executable.
check: test test-race vet build
