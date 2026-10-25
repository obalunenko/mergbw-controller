package config

import (
	"errors"
	"io"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"syscall"
	"unicode/utf8"

	"github.com/obalunenko/mergbw-controller/internal/protocol"
)

var (
	ErrImportMissing    = errors.New("import_missing")
	ErrImportUnreadable = errors.New("import_unreadable")
	ErrImportSize       = errors.New("import_size")
	ErrImportFile       = errors.New("import_file")
)

// ImportCandidate contains captured canonical values only, never source paths.
// Apply uses this snapshot and cannot reread a changed source after review.
type ImportCandidate struct {
	Settings Settings
	Presets  map[string]protocol.Preset
}

func captureFile(path string) ([]byte, error) {
	if !utf8.ValidString(path) || len(path) > 4096 || !filepath.IsAbs(path) {
		return nil, ErrImportFile
	}
	info, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, ErrImportMissing
	}
	if err != nil {
		return nil, ErrImportUnreadable
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0111 != 0 {
		return nil, ErrImportFile
	}
	if info.Mode().Perm()&0444 == 0 {
		return nil, ErrImportUnreadable
	}
	if info.Size() > MaxManagedFileBytes {
		return nil, ErrImportSize
	}
	file, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, ErrImportUnreadable
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) || !opened.Mode().IsRegular() || opened.Mode().Perm()&0111 != 0 {
		return nil, ErrImportFile
	}
	data, err := io.ReadAll(io.LimitReader(file, MaxManagedFileBytes+1))
	if err != nil {
		return nil, ErrImportUnreadable
	}
	if len(data) > MaxManagedFileBytes {
		return nil, ErrImportSize
	}
	return data, nil
}

// CaptureImport reads selected settings and optional presets strictly read-only.
// An omitted catalog preserves the whole active file or initializes defaults;
// an explicitly selected missing/empty catalog is rejected, never defaulted.
func CaptureImport(settingsPath, presetsPath string, active *Snapshot) (*ImportCandidate, error) {
	data, err := captureFile(settingsPath)
	if err != nil {
		return nil, err
	}
	settings, err := DecodeSettings(data)
	if err != nil {
		return nil, ErrInvalidConfiguration
	}
	presets := DefaultPresets()
	if active != nil {
		presets = maps.Clone(active.Presets)
	}
	if presetsPath != "" {
		data, err = captureFile(presetsPath)
		if err != nil {
			return nil, err
		}
		presets, err = DecodePresets(data)
		if err != nil {
			return nil, ErrInvalidConfiguration
		}
	}
	// Clone all nested values: source and caller mutation cannot alter review.
	for key, preset := range presets {
		presets[key] = protocol.ClonePreset(preset)
	}
	return &ImportCandidate{Settings: settings, Presets: presets}, nil
}
