package config

import (
	"encoding/json/v2"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"github.com/obalunenko/mergbw-controller/internal/protocol"
)

var (
	ErrInvalidConfiguration = errors.New("invalid_configuration")
	ErrStorageUnavailable   = errors.New("storage_unavailable")
	ErrStaleConfiguration   = errors.New("stale_configuration")
	managedIDPattern        = regexp.MustCompile(`^[0-9a-f]{32}$`)
)

type ActivePointer struct {
	SchemaVersion int    `json:"schemaVersion"`
	Generation    string `json:"generation"`
}

type Snapshot struct {
	Generation string
	Settings   Settings
	Presets    map[string]protocol.Preset
}

type ManagedStore struct {
	files    ManagedFiles
	close    func() error
	attempts map[string]commitAttempt
	mutation sync.Mutex
}

type commitAttempt struct {
	candidate string
	expected  string
	expires   time.Time
	result    CommitResult
	err       error
}

type SaveOutcome string

const (
	Applied       SaveOutcome = "applied"
	NotApplied    SaveOutcome = "not_applied"
	CommitUnknown SaveOutcome = "commit_unknown"
	Unchanged     SaveOutcome = "unchanged"
)

type CommitResult struct {
	Outcome           SaveOutcome
	Generation        string
	ActiveStateKnown  bool
	DurabilityUnknown bool
}

type StagedGeneration struct {
	Generation  string
	Transaction string
}

func (s *ManagedStore) ensureDirectory(name string) error {
	if err := s.files.MkdirAll(name, 0700); err != nil {
		return ErrStorageUnavailable
	}
	info, err := s.files.Lstat(name)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		return ErrStorageUnavailable
	}
	return nil
}

func (s *ManagedStore) syncDirectory(name string) error {
	file, err := s.files.OpenFile(name, os.O_RDONLY, 0)
	if err != nil {
		return ErrStorageUnavailable
	}
	syncErr := file.Sync()
	closeErr := file.Close()
	if syncErr != nil || closeErr != nil {
		return ErrStorageUnavailable
	}
	return nil
}

func (s *ManagedStore) writeNew(name string, data []byte) error {
	if len(data) > MaxManagedFileBytes {
		return ErrInvalidConfiguration
	}
	file, err := s.files.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return ErrStorageUnavailable
	}
	n, writeErr := file.Write(data)
	if writeErr != nil || n != len(data) {
		_ = file.Close()
		return ErrStorageUnavailable
	}
	syncErr := file.Sync()
	closeErr := file.Close()
	if syncErr != nil || closeErr != nil {
		return ErrStorageUnavailable
	}
	return nil
}

// Stage writes a complete pair but does not change the active pointer. Callers
// must quiesce the old runtime before Commit.
func (s *ManagedStore) Stage(generation, transaction string, settings Settings, presets map[string]protocol.Preset) (*StagedGeneration, error) {
	s.mutation.Lock()
	defer s.mutation.Unlock()
	if !managedIDPattern.MatchString(generation) || !managedIDPattern.MatchString(transaction) || settings.Validate() != nil || protocol.ValidatePresets(presets) != nil {
		return nil, ErrInvalidConfiguration
	}
	if _, err := s.Read(); err != nil {
		return nil, ErrStorageUnavailable
	}
	settingsData, err := json.Marshal(settings)
	if err != nil {
		return nil, ErrInvalidConfiguration
	}
	presetsData, err := json.Marshal(presets)
	if err != nil {
		return nil, ErrInvalidConfiguration
	}
	for _, name := range []string{"staging", "generations"} {
		if err := s.ensureDirectory(name); err != nil {
			return nil, err
		}
	}
	directory := filepath.Join("staging", transaction)
	if _, err := s.files.Lstat(directory); !errors.Is(err, fs.ErrNotExist) {
		return nil, ErrStaleConfiguration
	}
	if _, err := s.files.Lstat(filepath.Join("generations", generation)); !errors.Is(err, fs.ErrNotExist) {
		return nil, ErrStaleConfiguration
	}
	if err := s.ensureDirectory(directory); err != nil {
		return nil, err
	}
	for _, item := range []struct {
		name string
		data []byte
	}{{"settings.json", settingsData}, {"presets.json", presetsData}} {
		if err := s.writeNew(filepath.Join(directory, item.name), append(item.data, '\n')); err != nil {
			return nil, err
		}
	}
	if err := s.syncDirectory(directory); err != nil {
		return nil, err
	}
	return &StagedGeneration{Generation: generation, Transaction: transaction}, nil
}

// CheckOutcome is a read-only reconciliation. An unrelated readable generation
// restores active-state knowledge without inventing the historical save result.
func (s *ManagedStore) CheckOutcome(candidate, expected string) CommitResult {
	active, err := s.Read()
	if err != nil {
		return CommitResult{Outcome: CommitUnknown}
	}
	generation := ""
	if active != nil {
		generation = active.Generation
	}
	outcome := CommitUnknown
	if generation == candidate && candidate != "" {
		outcome = Applied
	} else if generation == expected {
		outcome = NotApplied
	}
	return CommitResult{Outcome: outcome, Generation: generation, ActiveStateKnown: true}
}

func (s *ManagedStore) Commit(staged StagedGeneration, expected string) (result CommitResult, err error) {
	s.mutation.Lock()
	defer s.mutation.Unlock()
	if !managedIDPattern.MatchString(staged.Generation) || !managedIDPattern.MatchString(staged.Transaction) || (expected != "" && !managedIDPattern.MatchString(expected)) {
		return CommitResult{}, ErrInvalidConfiguration
	}
	for id, attempt := range s.attempts {
		if !time.Now().Before(attempt.expires) {
			delete(s.attempts, id)
		}
	}
	if attempt, ok := s.attempts[staged.Transaction]; ok {
		if attempt.candidate != staged.Generation || attempt.expected != expected {
			return CommitResult{}, ErrInvalidConfiguration
		}
		if _, err := s.Read(); err != nil {
			return CommitResult{Outcome: CommitUnknown}, ErrStorageUnavailable
		}
		return attempt.result, attempt.err
	}
	// Once attempted, a transaction is reconciliation-only, including precommit failure.
	if s.attempts == nil {
		s.attempts = make(map[string]commitAttempt)
	}
	if len(s.attempts) >= 64 {
		return CommitResult{}, ErrStaleConfiguration
	}
	defer func() {
		s.attempts[staged.Transaction] = commitAttempt{candidate: staged.Generation, expected: expected, expires: time.Now().Add(5 * time.Minute), result: result, err: err}
	}()
	before := s.CheckOutcome(staged.Generation, expected)
	if !before.ActiveStateKnown {
		return before, ErrStorageUnavailable
	}
	if before.Outcome == Applied {
		return before, nil
	}
	if before.Generation != expected {
		return before, ErrStaleConfiguration
	}
	rejected := CommitResult{Outcome: NotApplied, Generation: expected, ActiveStateKnown: true}
	if err := s.files.Rename(filepath.Join("staging", staged.Transaction), filepath.Join("generations", staged.Generation)); err != nil {
		return rejected, ErrStorageUnavailable
	}
	if err := s.syncDirectory("generations"); err != nil {
		return rejected, err
	}
	pointer, err := json.Marshal(ActivePointer{SchemaVersion: 1, Generation: staged.Generation})
	if err != nil {
		return rejected, ErrInvalidConfiguration
	}
	temporary := filepath.Join("staging", staged.Transaction+".CURRENT.json")
	if err := s.writeNew(temporary, append(pointer, '\n')); err != nil {
		return rejected, err
	}
	if err := s.files.Rename(temporary, "CURRENT.json"); err != nil {
		result := s.CheckOutcome(staged.Generation, expected)
		if result.Outcome == Applied {
			result.DurabilityUnknown = true
			return result, nil
		}
		return result, ErrStorageUnavailable
	}
	syncErr := s.syncDirectory(".")
	result = s.CheckOutcome(staged.Generation, expected)
	result.DurabilityUnknown = syncErr != nil
	if !result.ActiveStateKnown {
		return result, ErrStorageUnavailable
	}
	return result, nil
}

func ManagedRoot() (string, error) {
	directory, err := os.UserConfigDir()
	if err != nil {
		return "", ErrStorageUnavailable
	}
	return filepath.Join(directory, "com.obalunenko.mergbw"), nil
}

func OpenManagedStore(directory string) (*ManagedStore, error) {
	if !filepath.IsAbs(directory) {
		return nil, ErrStorageUnavailable
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, ErrStorageUnavailable
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode()&fs.ModeSymlink != 0 {
		return nil, ErrStorageUnavailable
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, ErrStorageUnavailable
	}
	if err := root.Chmod(".", 0700); err != nil {
		_ = root.Close()
		return nil, ErrStorageUnavailable
	}
	return &ManagedStore{files: &rootedFiles{root}, close: root.Close}, nil
}

func NewManagedStore(files ManagedFiles) *ManagedStore { return &ManagedStore{files: files} }
func (s *ManagedStore) Close() error {
	if s.close != nil {
		return s.close()
	}
	return nil
}

// Read returns nil only for an absent pointer. A damaged pointer or generation
// must never be interpreted as an empty installation.
func (s *ManagedStore) Read() (*Snapshot, error) {
	data, err := s.files.ReadFile("CURRENT.json")
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, ErrStorageUnavailable
	}
	var pointer ActivePointer
	if json.Unmarshal(data, &pointer, json.RejectUnknownMembers(true)) != nil || pointer.SchemaVersion != 1 || !managedIDPattern.MatchString(pointer.Generation) {
		return nil, ErrInvalidConfiguration
	}
	return s.ReadGeneration(pointer.Generation)
}

func (s *ManagedStore) ReadGeneration(generation string) (*Snapshot, error) {
	if !managedIDPattern.MatchString(generation) {
		return nil, ErrInvalidConfiguration
	}
	directory := filepath.Join("generations", generation)
	info, err := s.files.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		return nil, ErrInvalidConfiguration
	}
	settingsData, err := s.files.ReadFile(filepath.Join(directory, "settings.json"))
	if err != nil {
		return nil, ErrInvalidConfiguration
	}
	presetsData, err := s.files.ReadFile(filepath.Join(directory, "presets.json"))
	if err != nil {
		return nil, ErrInvalidConfiguration
	}
	settings, err := DecodeSettings(settingsData)
	if err != nil {
		return nil, ErrInvalidConfiguration
	}
	presets, err := DecodePresets(presetsData)
	if err != nil {
		return nil, ErrInvalidConfiguration
	}
	return &Snapshot{Generation: generation, Settings: settings, Presets: presets}, nil
}
