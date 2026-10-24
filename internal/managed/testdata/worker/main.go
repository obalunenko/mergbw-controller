// This fixture never imports Bluetooth or cmd/sunset. init can stand in for a
// native library that blocks before worker main is reached.
package main

import (
	"encoding/json/v2"
	"io"
	"net"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/obalunenko/mergbw-controller/internal/managed"
)

func init() {
	// Fixture-only failsafe: a failing process test must not leave an immortal
	// synthetic orphan. Production workers have no such timer.
	time.AfterFunc(60*time.Second, func() { os.Exit(99) })
	switch os.Getenv("MERGBW_TEST_WORKER_MODE") {
	case "pre-main", "ignore-term", "delayed-exit":
		signal.Ignore(syscall.SIGTERM)
		if os.Getenv("MERGBW_TEST_WORKER_MODE") == "pre-main" {
			_ = os.WriteFile(os.Getenv("MERGBW_TEST_INIT_MARKER"), []byte("ready"), 0600)
			for {
				time.Sleep(time.Hour)
			}
		}
	}
}
func main() {
	mode := os.Getenv("MERGBW_TEST_WORKER_MODE")
	if mode == "descriptors" {
		_, _ = io.Copy(io.Discard, os.Stdin)
		return
	}
	decoder := managed.NewDecoder(os.Stdin, "")
	frame, err := decoder.Read()
	if err != nil {
		os.Exit(2)
	}
	var binding managed.Binding
	if managed.DecodePayload(frame, &binding) != nil {
		os.Exit(2)
	}
	listener := os.NewFile(3, "listener")
	address, err := listener.Stat()
	if err != nil || address.Mode()&os.ModeSocket == 0 {
		os.Exit(3)
	}
	if mode == "stdout-loss" {
		_ = os.Stdout.Close()
		_, _ = io.Copy(io.Discard, os.Stdin)
		return
	}
	if mode == "stderr-flood" {
		for range 256 {
			_, _ = io.WriteString(os.Stderr, strings.Repeat("synthetic diagnostic ", 4096))
		}
	}
	// Port is supplied by the test through the inherited listener, never rebound.
	network, err := fixturePort(listener)
	if err != nil {
		os.Exit(3)
	}
	payload, err := json.Marshal(managed.Bootstrap{Binding: binding, Port: network, ProtocolVersion: 1, BridgeVersion: "test"})
	if err != nil {
		os.Exit(2)
	}
	frame.Type = "worker.ready"
	frame.Payload = payload
	if managed.NewEncoder(os.Stdout).Write(frame) != nil {
		os.Exit(2)
	}
	if mode == "ignore-term" {
		for {
			time.Sleep(time.Hour)
		}
	}
	_, _ = io.Copy(io.Discard, os.Stdin)
	if mode == "delayed-exit" {
		time.Sleep(100 * time.Millisecond)
	}
}

func fixturePort(file *os.File) (int, error) {
	listener, err := net.FileListener(file)
	if err != nil {
		return 0, err
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port, nil
}
