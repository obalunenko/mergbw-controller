// Package managed supervises the plugin-owned worker without importing native
// Bluetooth. Configuration formats remain owned by internal/config.
package managed

import (
	"io"
	"net"
	"os"
	"time"
)

type ProcessHandle interface {
	Wait() error
	Signal(os.Signal) error
	Kill() error
}

type Process struct {
	Handle ProcessHandle
	Input  io.WriteCloser
	Output io.ReadCloser
	Errors io.ReadCloser
}

type ProcessSpec struct {
	Executable string
	Arguments  []string
	Files      []*os.File
}

type Launcher interface {
	Start(ProcessSpec) (*Process, error)
}

type Timer interface {
	C() <-chan time.Time
	Stop() bool
	Reset(time.Duration) bool
}

type Clock interface {
	Now() time.Time
	NewTimer(time.Duration) Timer
}

type Locker interface {
	Acquire(string) (*os.File, error)
}

type ListenerFactory interface {
	Listen(int) (*Reservation, error)
}

type Reservation struct{ listener *net.TCPListener }
