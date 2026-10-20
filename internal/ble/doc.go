// Package ble implements the local MeRGBW LT-06 transport with
// tinygo.org/x/bluetooth v0.16.0. Use one Backend per process: the upstream
// DefaultAdapter and its callback registration are process-global.
//
// Cancellation is cooperative, not a hard native-operation deadline. Enable,
// Connect, GATT discovery and WriteWithoutResponse do not accept context.Context.
// This package calls them synchronously and checks the context between stages;
// it never abandons a goroutine that could subsequently write to the lamp.
// A write already inside the native library can still complete after context
// cancellation, before Write returns. Such a result includes ErrWriteUncertain.
//
// On Darwin, Connect's timeout requests cancellation but then waits for a
// CoreBluetooth disconnect callback. The call can therefore exceed its timeout.
// GATT discovery and the write-buffer wait have upstream ten-second timeouts.
// A late GATT-discovery callback can block the upstream serial callback queue;
// a discovery timeout makes the Backend unusable with ErrNeedsRestart.
// Scan cancellation requests StopScan and joins the stopper before returning.
// ScanTimeout is consequently not a guaranteed upper bound on elapsed time.
// On Linux, upstream Connect ignores ConnectionTimeout and D-Bus operations do
// not use our context. The Linux backend is a secondary build target.
//
// Inspect performs discovery and establishes a connection, but does not write
// a characteristic or enable notifications. No lamp state is read back.
// The public upstream API does not expose characteristic properties; this
// package checks the FFF0/FFF3 UUIDs and uses the write mode verified on the lamp,
// without claiming to have verified the write property at runtime.
//
// cbgo uses a separate serial GCD callback queue; callers do not need to run a
// main-thread event loop. macOS builds need cgo, Apple's SDK and Bluetooth
// permission. Upstream creates CoreBluetooth managers during package init, even
// if the application has not yet called Connect.
//
// Source audit:
// https://github.com/tinygo-org/bluetooth/tree/v0.16.0
// https://github.com/tinygo-org/cbgo/tree/v0.0.4
package ble
