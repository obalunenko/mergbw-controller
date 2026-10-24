package config

import (
	"encoding/json/v2"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

func TestManualCandidatePreservesPortSecretAndValidatesIdentity(t *testing.T) {
	first, err := PrepareManualSettings(" aa:bb:cc:dd:ee:ff ", nil)
	require.NoError(t, err)
	assert.Equal(t, "AA:BB:CC:DD:EE:FF", first.DeviceIdentity)
	assert.Equal(t, 18765, first.Port)
	assert.Len(t, first.AccessToken, 32)
	first.Port = 23456
	second, err := PrepareManualSettings(first.DeviceIdentity, &first)
	require.NoError(t, err)
	assert.Equal(t, first, second)
	for _, identity := range []string{"", "AA:BB:CC:DD:EE", "00-11-22-33-44-55", "invalid"} {
		_, err := PrepareManualSettings(identity, &first)
		assert.Error(t, err)
	}
	candidate, err := PrepareManualSettings("AA:BB:CC:DD:EE:01", &first)
	require.NoError(t, err)
	assert.Equal(t, first.AccessToken, candidate.AccessToken)
	assert.Equal(t, first.Port, candidate.Port)
	assert.NotEqual(t, first.DeviceIdentity, candidate.DeviceIdentity)
	assert.Equal(t, "AA:BB:CC:DD:EE:FF", first.DeviceIdentity)
}

func TestCanonicalSettingsBoundaries(t *testing.T) {
	for _, tc := range []struct {
		port  int
		token string
		valid bool
	}{
		{1024, strings.Repeat("a", 24), true}, {65535, strings.Repeat("_", 128), true},
		{1023, strings.Repeat("a", 24), false}, {65536, strings.Repeat("a", 24), false},
		{18765, strings.Repeat("a", 23), false}, {18765, strings.Repeat("a", 129), false},
		{18765, strings.Repeat("+", 24), false},
	} {
		data, err := json.Marshal(Settings{DeviceIdentity: "aa:bb:cc:dd:ee:ff", Port: tc.port, AccessToken: tc.token})
		require.NoError(t, err)
		settings, err := DecodeSettings(data)
		if tc.valid {
			require.NoError(t, err)
			assert.Equal(t, "AA:BB:CC:DD:EE:FF", settings.DeviceIdentity)
		} else {
			assert.Error(t, err)
		}
	}
	_, err := DecodeSettings([]byte(`{"device_identity":"AA:BB:CC:DD:EE:FF","port":1.5}`))
	assert.Error(t, err)
}

func TestManagedRootMissingPointerAndInvalidPointerAreDistinct(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "managed")
	store, err := OpenManagedStore(directory)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, store.Close()) })
	info, err := os.Stat(directory)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0700), info.Mode().Perm())
	value, err := store.Read()
	require.NoError(t, err)
	assert.Nil(t, value)
	for _, data := range []string{`{`, `{"schemaVersion":2,"generation":"` + strings.Repeat("a", 32) + `"}`, `{"schemaVersion":1,"generation":"../outside"}`, `{"schemaVersion":1,"generation":"` + strings.Repeat("a", 32) + `","unknown":true}`, `{"schemaVersion":1,"generation":"` + strings.Repeat("a", 32) + `"}`} {
		require.NoError(t, os.WriteFile(filepath.Join(directory, "CURRENT.json"), []byte(data), 0600))
		value, err := store.Read()
		assert.Error(t, err)
		assert.Nil(t, value)
	}
}

func TestManagedStoreRejectsSymlinkRootsAndPointers(t *testing.T) {
	outside := t.TempDir()
	parent := t.TempDir()
	link := filepath.Join(parent, "link")
	require.NoError(t, os.Symlink(outside, link))
	_, err := OpenManagedStore(link)
	assert.Error(t, err)
	store, err := OpenManagedStore(parent)
	require.NoError(t, err)
	defer store.Close()
	require.NoError(t, os.WriteFile(filepath.Join(outside, "secret"), []byte("not_configuration"), 0600))
	require.NoError(t, os.Symlink(filepath.Join(outside, "secret"), filepath.Join(parent, "CURRENT.json")))
	value, err := store.Read()
	assert.Error(t, err)
	assert.Nil(t, value)
	_, err = store.files.ReadFile("../outside")
	assert.Error(t, err)
}

func TestManagedStoreStorageErrorIsSanitized(t *testing.T) {
	files := NewMockManagedFiles(gomock.NewController(t))
	files.EXPECT().ReadFile("CURRENT.json").Return(nil, errors.New("private_token_and_source_path"))
	_, err := NewManagedStore(files).Read()
	assert.ErrorIs(t, err, ErrStorageUnavailable)
	assert.NotContains(t, err.Error(), "private_token")
}

func TestPresetDecodeDoesNotMergeMissingKeys(t *testing.T) {
	presets, err := DecodePresets([]byte(`{"custom":{"label":"Custom","rgb":[0,1,2],"brightness":0}}`))
	require.NoError(t, err)
	assert.Len(t, presets, 1)
	assert.Contains(t, presets, "custom")
	for _, data := range []string{`{}`, `{"custom":{"label":"Custom","rgb":[0,1,2]}}`, `{"custom":{"label":"Custom","rgb":[0,1,2],"brightness":null}}`, `{"custom":{"label":"\n","rgb":[0,1,2],"brightness":0}}`} {
		_, err := DecodePresets([]byte(data))
		assert.Error(t, err)
	}
}

func TestManagedProposalExpectedOwnerExpiryAndImmutableCandidate(t *testing.T) {
	settings, err := PrepareManualSettings("AA:BB:CC:DD:EE:FF", nil)
	require.NoError(t, err)
	for _, raw := range [][]byte{nil, []byte(`""`), []byte(`1`), []byte(`false`), []byte(`{}`)} {
		_, err := ExpectedGeneration(raw)
		assert.Error(t, err)
	}
	expected, err := ExpectedGeneration([]byte(`null`))
	require.NoError(t, err)
	assert.Empty(t, expected)
	now := time.Now()
	presets := DefaultPresets()
	p, err := PrepareProposal("panel", "", nil, settings, presets, now)
	require.NoError(t, err)
	assert.Equal(t, now.Add(5*time.Minute), p.Expires)
	assert.NotEqual(t, p.ID, p.Candidate)
	assert.True(t, managedIDPattern.MatchString(p.Candidate))
	assert.True(t, p.Changed)
	for key, value := range presets {
		value.RGB[0] = (value.RGB[0] + 1) % 256
		presets[key] = value
	}
	assert.NotEqual(t, presets, p.Presets)
	active := &Snapshot{Generation: p.Candidate, Settings: settings, Presets: p.Presets}
	same, err := PrepareProposal("panel", p.Candidate, active, settings, p.Presets, now)
	require.NoError(t, err)
	assert.False(t, same.Changed)
	_, err = PrepareProposal("", p.Candidate, active, settings, p.Presets, now)
	assert.Error(t, err)
	_, err = PrepareProposal("panel", strings.Repeat("e", 32), active, settings, p.Presets, now)
	assert.ErrorIs(t, err, ErrStaleConfiguration)
}
