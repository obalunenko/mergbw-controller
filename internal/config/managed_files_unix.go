//go:build darwin || linux

package config

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

const MaxManagedFileBytes = 1024 * 1024

type rootedFiles struct{ root *os.Root }

func (r *rootedFiles) check(name string) error {
	if !filepath.IsLocal(name) || filepath.Clean(name) != name {
		return ErrInvalidConfiguration
	}
	current := ""
	for part := range strings.SplitSeq(name, string(filepath.Separator)) {
		current = filepath.Join(current, part)
		info, err := r.root.Lstat(current)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if info.Mode()&fs.ModeSymlink != 0 {
			return ErrInvalidConfiguration
		}
	}
	return nil
}

func (r *rootedFiles) ReadFile(name string) ([]byte, error) {
	if err := r.check(name); err != nil {
		return nil, err
	}
	file, err := r.root.OpenFile(name, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > MaxManagedFileBytes || info.Mode().Perm() != 0600 {
		return nil, ErrInvalidConfiguration
	}
	data, err := io.ReadAll(io.LimitReader(file, MaxManagedFileBytes+1))
	if len(data) > MaxManagedFileBytes {
		return nil, ErrInvalidConfiguration
	}
	return data, err
}

func (r *rootedFiles) OpenFile(name string, flag int, mode fs.FileMode) (ManagedFile, error) {
	if err := r.check(name); err != nil {
		return nil, err
	}
	return r.root.OpenFile(name, flag|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, mode)
}
func (r *rootedFiles) MkdirAll(name string, mode fs.FileMode) error {
	if err := r.check(name); err != nil {
		return err
	}
	return r.root.MkdirAll(name, mode)
}
func (r *rootedFiles) Rename(oldName, newName string) error {
	if err := r.check(oldName); err != nil {
		return err
	}
	if err := r.check(newName); err != nil {
		return err
	}
	return r.root.Rename(oldName, newName)
}
func (r *rootedFiles) Lstat(name string) (fs.FileInfo, error) {
	if err := r.check(name); err != nil {
		return nil, err
	}
	return r.root.Lstat(name)
}
