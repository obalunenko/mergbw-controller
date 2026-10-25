package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFirstInitRequiresExplicitIdentity(t *testing.T) {
	dir := t.TempDir()
	for _, identity := range []string{"", "not-a-device"} {
		_, _, err := Init(dir, identity)
		assert.Error(t, err, "identity: %q", identity)
		assert.NoFileExists(t, filepath.Join(dir, "settings.json"))
	}
	settings, _, err := Init(dir, "aa:bb:cc:dd:ee:ff")
	require.NoError(t, err)
	assert.Equal(t, "AA:BB:CC:DD:EE:FF", settings.DeviceIdentity)
	before, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	require.NoError(t, err)
	_, _, err = Init(dir, "AA:BB:CC:DD:EE:01")
	assert.Error(t, err)
	after, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	require.NoError(t, err)
	assert.Equal(t, before, after, "init replaced existing settings/token")
}

func TestInitPreservesPythonSettingsAndURLs(t *testing.T) {
	dir := t.TempDir()
	settingsJSON := "{\"device_identity\":\"AA:BB:CC:DD:EE:FF\",\"port\":18765,\"access_token\":\"existing_local_token_1234567890\"}\n"
	presetsJSON := "{\"sunset\":{\"label\":\"Мой закат\",\"rgb\":[255,80,0],\"brightness\":42}}\n"
	for name, data := range map[string]string{"settings.json": settingsJSON, "presets.json": presetsJSON} {
		require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte(data), 0600))
	}
	settings, presets, err := Init(dir, "")
	require.NoError(t, err)
	for name, expected := range map[string]string{"settings.json": settingsJSON, "presets.json": presetsJSON} {
		got, err := os.ReadFile(filepath.Join(dir, name))
		require.NoError(t, err)
		assert.Equal(t, expected, string(got), "Init changed existing %s", name)
	}
	urls := URLs(settings, presets)
	for _, route := range []string{"on", "off", "preset/sunset", "brightness/25", "brightness/50", "brightness/100"} {
		assert.Contains(t, urls, "http://127.0.0.1:18765/existing_local_token_1234567890/"+route+"\n")
	}
	assert.Contains(t, urls, "Мой закат")
	assert.Equal(t, 42, presets["sunset"].Brightness)
}

func TestInitAndMissingBrightness(t *testing.T) {
	dir := t.TempDir()
	first, presets, err := Init(dir, "AA:BB:CC:DD:EE:FF")
	require.NoError(t, err)
	second, _, err := Init(dir, "")
	require.NoError(t, err)
	assert.Equal(t, first, second)
	assert.Len(t, first.AccessToken, 32)
	assert.Len(t, presets, 6)
	path, err := WriteURLs(dir, first, presets)
	require.NoError(t, err)
	contents, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, 11, strings.Count(string(contents), "http://127.0.0.1:"))
	for _, data := range []string{
		`{"bad":{"label":"Bad","rgb":[0,0,0]}}`,
		`{"bad":{"label":"Bad","rgb":[0,0,0],"brightness":null}}`,
		`{"bad":{"label":"Bad","rgb":[0,0,256],"brightness":40}}`,
	} {
		require.NoError(t, os.WriteFile(filepath.Join(dir, "presets.json"), []byte(data), 0600))
		_, _, err := Init(dir, "")
		assert.Error(t, err, "preset: %s", data)
	}
}
