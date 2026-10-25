//go:build darwin || linux

package managed

import (
	"os"
	"syscall"
)

type FileLocker struct{}

func (FileLocker) Acquire(directory string) (*os.File, error) {
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, Code("storage_unavailable")
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, Code("storage_unavailable")
	}
	if err := os.Chmod(directory, 0700); err != nil {
		return nil, Code("storage_unavailable")
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, Code("storage_unavailable")
	}
	defer root.Close()
	file, err := root.OpenFile("runtime.lock", os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0600)
	if err != nil {
		return nil, Code("storage_unavailable")
	}
	info, err = file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		_ = file.Close()
		return nil, Code("storage_unavailable")
	}
	if err := file.Chmod(0600); err != nil {
		_ = file.Close()
		return nil, Code("storage_unavailable")
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = file.Close()
		return nil, InstanceBusy
	}
	// Closing every inherited copy releases ownership. Never explicitly unlock or
	// unlink: an inherited worker copy must continue to exclude a replacement.
	return file, nil
}

func DuplicateFile(file *os.File) (*os.File, error) {
	fd, err := syscall.Dup(int(file.Fd()))
	if err != nil {
		return nil, Code("descriptor_failed")
	}
	syscall.CloseOnExec(fd)
	return os.NewFile(uintptr(fd), file.Name()), nil
}
