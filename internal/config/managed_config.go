package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json/v2"
	"io"
	"io/fs"
	"maps"
	"reflect"
	"regexp"
	"slices"
	"time"

	"github.com/obalunenko/mergbw-controller/internal/protocol"
)

// ManagedFile includes durability operations so transaction failures can be
// exercised without a real filesystem fault or native Bluetooth.
type ManagedFile interface {
	io.Writer
	io.Closer
	Sync() error
}

// ManagedFiles is rooted at the private configuration directory. Implementations
// must reject symlink traversal and paths outside that root.
type ManagedFiles interface {
	ReadFile(name string) ([]byte, error)
	OpenFile(name string, flag int, mode fs.FileMode) (ManagedFile, error)
	MkdirAll(name string, mode fs.FileMode) error
	Rename(oldName, newName string) error
	Lstat(name string) (fs.FileInfo, error)
}

// Proposal is a private, immutable candidate captured for one PI session.
// Credentials and candidate generation must never be forwarded to the PI.
type Proposal struct {
	ID        string
	Candidate string
	Owner     string
	Expected  string
	Settings  Settings
	Presets   map[string]protocol.Preset
	Expires   time.Time
	Changed   bool
	Diff      map[string]bool
}

var ownerPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`)

func ValidOwner(owner string) bool { return ownerPattern.MatchString(owner) }

// ExpectedGeneration distinguishes missing from explicit null at the wire boundary.
func ExpectedGeneration(raw []byte) (string, error) {
	if string(raw) == "null" {
		return "", nil
	}
	var id string
	if len(raw) == 0 || json.Unmarshal(raw, &id) != nil || !managedIDPattern.MatchString(id) {
		return "", ErrInvalidConfiguration
	}
	return id, nil
}
func PrepareProposal(owner, expected string, active *Snapshot, settings Settings, presets map[string]protocol.Preset, now time.Time) (*Proposal, error) {
	if !ValidOwner(owner) || (expected != "" && !managedIDPattern.MatchString(expected)) || settings.Validate() != nil || protocol.ValidatePresets(presets) != nil {
		return nil, ErrInvalidConfiguration
	}
	actual := ""
	if active != nil {
		actual = active.Generation
	}
	if actual != expected {
		return nil, ErrStaleConfiguration
	}
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return nil, ErrStorageUnavailable
	}
	copied := maps.Clone(presets)
	for key, value := range copied {
		value.RGB = slices.Clone(value.RGB)
		copied[key] = value
	}
	diff := map[string]bool{"identity": active == nil, "port": active == nil, "secret": active == nil, "presets": active == nil}
	if active != nil {
		diff["identity"] = active.Settings.DeviceIdentity != settings.DeviceIdentity
		diff["port"] = active.Settings.Port != settings.Port
		diff["secret"] = active.Settings.AccessToken != settings.AccessToken
		diff["presets"] = !reflect.DeepEqual(active.Presets, copied)
	}
	changed := false
	for _, value := range diff {
		changed = changed || value
	}
	return &Proposal{ID: hex.EncodeToString(random[:16]), Candidate: hex.EncodeToString(random[16:]), Owner: owner, Expected: expected, Settings: settings, Presets: copied, Expires: now.Add(5 * time.Minute), Changed: changed, Diff: diff}, nil
}
