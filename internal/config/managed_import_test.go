package config

import (
	"encoding/json/v2"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func importFixture(t *testing.T) (string, string, Settings) {
	t.Helper()
	directory := t.TempDir()
	settings := Settings{DeviceIdentity: "AA:BB:CC:DD:EE:FF", Port: 23456, AccessToken: strings.Repeat("s", 32)}
	data, err := json.Marshal(settings)
	require.NoError(t, err)
	settingsPath := filepath.Join(directory, "settings.json")
	presetsPath := filepath.Join(directory, "presets.json")
	require.NoError(t, os.WriteFile(settingsPath, data, 0600))
	require.NoError(t, os.WriteFile(presetsPath, []byte(`{"custom":{"label":"Custom","rgb":[0,1,255],"brightness":0}}`), 0600))
	return settingsPath, presetsPath, settings
}
func TestCaptureImportPreservesSourcesAndWholeCatalog(t *testing.T) {
	settingsPath, presetsPath, want := importFixture(t)
	settingsBytes, err := os.ReadFile(settingsPath)
	require.NoError(t, err)
	presetBytes, err := os.ReadFile(presetsPath)
	require.NoError(t, err)
	candidate, err := CaptureImport(settingsPath, presetsPath, nil)
	require.NoError(t, err)
	assert.Equal(t, want, candidate.Settings)
	assert.Len(t, candidate.Presets, 1)
	assert.Contains(t, candidate.Presets, "custom")
	// Review captures values once; changing or deleting a source cannot change apply.
	require.NoError(t, os.WriteFile(settingsPath, []byte("changed after prepare"), 0600))
	require.NoError(t, os.Remove(presetsPath))
	assert.Equal(t, want, candidate.Settings)
	assert.Equal(t, 255, candidate.Presets["custom"].RGB[2])
	require.NoError(t, os.WriteFile(settingsPath, settingsBytes, 0600))
	require.NoError(t, os.WriteFile(presetsPath, presetBytes, 0600))
	_, err = CaptureImport(settingsPath, presetsPath, nil)
	require.NoError(t, err)
	after, err := os.ReadFile(settingsPath)
	require.NoError(t, err)
	assert.Equal(t, settingsBytes, after)
	after, err = os.ReadFile(presetsPath)
	require.NoError(t, err)
	assert.Equal(t, presetBytes, after)
}
func TestCaptureImportSettingsOnlyUsesWholeFileRules(t *testing.T) {
	settingsPath, _, _ := importFixture(t)
	first, err := CaptureImport(settingsPath, "", nil)
	require.NoError(t, err)
	assert.Equal(t, DefaultPresets(), first.Presets)
	existing := &Snapshot{Presets: first.Presets}
	delete(existing.Presets, "sunset")
	next, err := CaptureImport(settingsPath, "", existing)
	require.NoError(t, err)
	assert.Equal(t, existing.Presets, next.Presets)
	assert.NotContains(t, next.Presets, "sunset")
}
func TestCaptureImportRejectsUnsafeAndInvalidSources(t *testing.T) {
	for _, kind := range []string{"missing", "empty", "malformed", "oversized", "directory", "executable", "symlink", "relative", "path_limit", "utf8", "permission"} {
		t.Run(kind, func(t *testing.T) {
			settingsPath, presetsPath, _ := importFixture(t)
			switch kind {
			case "missing":
				settingsPath += ".missing"
			case "empty":
				require.NoError(t, os.WriteFile(settingsPath, nil, 0600))
			case "malformed":
				require.NoError(t, os.WriteFile(presetsPath, []byte("{"), 0600))
			case "oversized":
				require.NoError(t, os.WriteFile(settingsPath, []byte(strings.Repeat(" ", MaxManagedFileBytes+1)), 0600))
			case "directory":
				settingsPath = filepath.Dir(settingsPath)
			case "executable":
				require.NoError(t, os.Chmod(settingsPath, 0700))
			case "symlink":
				link := settingsPath + ".link"
				require.NoError(t, os.Symlink(settingsPath, link))
				settingsPath = link
			case "relative":
				settingsPath = "settings.json"
			case "path_limit":
				settingsPath = "/" + strings.Repeat("a", 4096)
			case "utf8":
				settingsPath = "/bad\xff"
			case "permission":
				require.NoError(t, os.Chmod(settingsPath, 0000))
			}
			candidate, err := CaptureImport(settingsPath, presetsPath, nil)
			require.Error(t, err)
			assert.Nil(t, candidate)
			assert.NotContains(t, err.Error(), settingsPath)
			assert.NotContains(t, err.Error(), strings.Repeat("s", 32))
		})
	}
	for _, data := range []string{`{}`, `{"bad key":{"label":"x","rgb":[1,2,3],"brightness":0}}`, `{"custom":{"label":"  ","rgb":[1,2,3],"brightness":0}}`, `{"custom":{"label":"x\ny","rgb":[1,2,3],"brightness":0}}`, `{"custom":{"label":"x","rgb":[1,2],"brightness":0}}`, `{"custom":{"label":"x","rgb":[1,2,256],"brightness":0}}`, `{"custom":{"label":"x","rgb":[1.5,2,3],"brightness":0}}`, `{"custom":{"label":"x","rgb":[1,2,3]}}`, `{"custom":{"label":"x","rgb":[1,2,3],"brightness":101}}`} {
		settingsPath, presetsPath, _ := importFixture(t)
		require.NoError(t, os.WriteFile(presetsPath, []byte(data), 0600))
		_, err := CaptureImport(settingsPath, presetsPath, nil)
		assert.Error(t, err, data)
	}
}
