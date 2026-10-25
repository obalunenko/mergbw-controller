package managed

import (
	"debug/elf"
	"debug/macho"
	"errors"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

type NativeLauncher struct{}

func (NativeLauncher) Start(spec ProcessSpec) (*Process, error) {
	if err := ValidateExecutable(spec.Executable); err != nil {
		return nil, err
	}
	command := exec.Command(spec.Executable, spec.Arguments...)
	command.ExtraFiles = spec.Files
	input, err := command.StdinPipe()
	if err != nil {
		return nil, SpawnFailed
	}
	output, err := command.StdoutPipe()
	if err != nil {
		_ = input.Close()
		return nil, SpawnFailed
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		_ = input.Close()
		_ = output.Close()
		return nil, SpawnFailed
	}
	if err := command.Start(); err != nil {
		_ = input.Close()
		_ = output.Close()
		_ = stderr.Close()
		return nil, SpawnFailed
	}
	return &Process{Handle: &commandHandle{command}, Input: input, Output: output, Errors: stderr}, nil
}

type commandHandle struct{ command *exec.Cmd }

func (p *commandHandle) Wait() error                   { return p.command.Wait() }
func (p *commandHandle) Signal(signal os.Signal) error { return p.command.Process.Signal(signal) }
func (p *commandHandle) Kill() error                   { return p.command.Process.Kill() }

type LoopbackListeners struct{}

func (LoopbackListeners) Listen(port int) (*Reservation, error) {
	if port < 1024 || port > 65535 {
		return nil, Code("invalid_port")
	}
	listener, err := net.ListenTCP("tcp4", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: port})
	if err != nil {
		return nil, PortConflict
	}
	return &Reservation{listener: listener}, nil
}

func (r *Reservation) Duplicate() (*os.File, error) {
	file, err := r.listener.File()
	if err != nil {
		return nil, Code("listener_failed")
	}
	return file, nil
}

func (r *Reservation) Address() string { return r.listener.Addr().String() }

func (r *Reservation) Close() error {
	err := r.listener.Close()
	if errors.Is(err, net.ErrClosed) {
		return nil
	}
	return err
}

type WallClock struct{}

func (WallClock) Now() time.Time                 { return time.Now() }
func (WallClock) NewTimer(d time.Duration) Timer { return &wallTimer{time.NewTimer(d)} }

type wallTimer struct{ timer *time.Timer }

func (t *wallTimer) C() <-chan time.Time        { return t.timer.C }
func (t *wallTimer) Stop() bool                 { return t.timer.Stop() }
func (t *wallTimer) Reset(d time.Duration) bool { return t.timer.Reset(d) }

// ValidateExecutable inspects bytes and mode without invoking worker flags. The
// production composition root derives the exact Helpers/sunset path from its
// own bundled supervisor; Node verifies the complete payload before spawning it.
func ValidateExecutable(path string) error {
	if !filepath.IsAbs(path) {
		return Code("binary_incompatible")
	}
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return Code("binary_missing")
	}
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0o111 == 0 || info.Mode()&os.ModeSymlink != 0 {
		return Code("binary_incompatible")
	}
	if runtime.GOOS == "darwin" {
		expected := macho.CpuArm64
		if runtime.GOARCH == "amd64" {
			expected = macho.CpuAmd64
		}
		if fat, err := macho.OpenFat(path); err == nil {
			defer fat.Close()
			for _, arch := range fat.Arches {
				if arch.Cpu == expected && arch.Type == macho.TypeExec {
					return nil
				}
			}
		} else if file, err := macho.Open(path); err == nil {
			defer file.Close()
			if file.Cpu == expected && file.Type == macho.TypeExec {
				return nil
			}
		}
	} else if runtime.GOOS == "linux" {
		if file, err := elf.Open(path); err == nil {
			defer file.Close()
			expected := elf.EM_AARCH64
			if runtime.GOARCH == "amd64" {
				expected = elf.EM_X86_64
			}
			if file.Machine == expected && (file.Type == elf.ET_EXEC || file.Type == elf.ET_DYN) {
				return nil
			}
		}
	}
	return Code("binary_incompatible")
}
