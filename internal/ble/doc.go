// Package ble implements the local MeRGBW LT-06 transport with
// tinygo.org/x/bluetooth v0.16.0 through an injected synchronous Adapter.
// The native subpackage owns the TinyGo import; this package and its generated
// mocks can be tested without native initialization. cmd/sunset injects
// native.DefaultAdapter. Use one Backend per process: the upstream adapter and
// its callback registration are process-global.
//
// Cancellation is cooperative, not a hard native-operation deadline. Enable,
// Connect, GATT discovery and WriteWithoutResponse do not accept context.Context.
// This package calls them synchronously and checks the context between stages;
// it never abandons a goroutine that could subsequently write to the lamp.
// A write already inside the native library can still complete after context
// cancellation, before Write returns. Such a result includes ErrWriteUncertain.
//
// Managed shutdown cancels the worker root, stopping queued actions and the
// remaining packets of an action without sending Off. An in-progress native
// write still runs synchronously. The independent supervisor may terminate the
// entire worker after its grace period; only confirmed process exit releases
// its inherited runtime lock and listener. Process termination cannot establish
// whether the final packet physically reached the lamp. A fresh worker never
// resumes a previous queue or packet sequence.
// Smooth transitions share the same whole-action gate. A new valid command
// requests cancellation, waits for the synchronous native write to return,
// then starts its own packets. A transition write is never retried; cancellation
// inside a write has an unknown outcome. Status reads do not send packets.
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
// if the application has not yet called Connect. Only importing ble/native
// brings in that dependency; importing ble alone does not initialize it.
// Real-equipment tests live in ble/native behind the hardware build tag and
// are run only by an explicit local task test:hardware invocation, never CI.
//
// Source audit:
// https://github.com/tinygo-org/bluetooth/tree/v0.16.0
// https://github.com/tinygo-org/cbgo/tree/v0.0.4
package ble
