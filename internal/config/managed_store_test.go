package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestManagedCommitUsesOnePointerAndRetainsPreviousPair(t *testing.T) {
	directory := t.TempDir()
	store, err := OpenManagedStore(directory)
	require.NoError(t, err)
	defer store.Close()
	settings, err := PrepareManualSettings("AA:BB:CC:DD:EE:FF", nil)
	require.NoError(t, err)
	a, b, tx1, tx2 := strings.Repeat("a", 32), strings.Repeat("b", 32), strings.Repeat("c", 32), strings.Repeat("d", 32)
	staged, err := store.Stage(a, tx1, settings, DefaultPresets())
	require.NoError(t, err)
	active, err := store.Read()
	require.NoError(t, err)
	assert.Nil(t, active)
	result, err := store.Commit(*staged, "")
	require.NoError(t, err)
	assert.Equal(t, Applied, result.Outcome)
	assert.True(t, result.ActiveStateKnown)
	first, err := store.Read()
	require.NoError(t, err)
	require.NotNil(t, first)
	assert.Equal(t, settings, first.Settings)
	settings.Port = 23456
	staged, err = store.Stage(b, tx2, settings, DefaultPresets())
	require.NoError(t, err)
	result, err = store.Commit(*staged, a)
	require.NoError(t, err)
	assert.Equal(t, Applied, result.Outcome)
	second, err := store.Read()
	require.NoError(t, err)
	assert.Equal(t, b, second.Generation)
	assert.Equal(t, 23456, second.Settings.Port)
	assert.Equal(t, first.Settings.AccessToken, second.Settings.AccessToken)
	assert.FileExists(t, filepath.Join(directory, "generations", a, "settings.json"))
	for _, name := range []string{"CURRENT.json", filepath.Join("generations", b, "settings.json"), filepath.Join("generations", b, "presets.json")} {
		info, err := os.Stat(filepath.Join(directory, name))
		require.NoError(t, err)
		assert.Equal(t, os.FileMode(0600), info.Mode().Perm())
	}
	assert.Equal(t, Applied, store.CheckOutcome(b, a).Outcome)
	assert.Equal(t, NotApplied, store.CheckOutcome(strings.Repeat("e", 32), b).Outcome)
	unknown := store.CheckOutcome(strings.Repeat("e", 32), a)
	assert.Equal(t, CommitUnknown, unknown.Outcome)
	assert.True(t, unknown.ActiveStateKnown)
	result, err = store.Commit(*staged, a)
	require.NoError(t, err)
	assert.Equal(t, Applied, result.Outcome)
}

func TestManagedStoreRejectsInvalidIDsAndStaleCommit(t *testing.T) {
	store, err := OpenManagedStore(t.TempDir())
	require.NoError(t, err)
	defer store.Close()
	settings, err := PrepareManualSettings("AA:BB:CC:DD:EE:FF", nil)
	require.NoError(t, err)
	_, err = store.Stage("../escape", strings.Repeat("b", 32), settings, DefaultPresets())
	assert.ErrorIs(t, err, ErrInvalidConfiguration)
	staged, err := store.Stage(strings.Repeat("a", 32), strings.Repeat("b", 32), settings, DefaultPresets())
	require.NoError(t, err)
	_, err = store.Commit(*staged, strings.Repeat("c", 32))
	assert.ErrorIs(t, err, ErrStaleConfiguration)
	active, err := store.Read()
	require.NoError(t, err)
	assert.Nil(t, active)
}
