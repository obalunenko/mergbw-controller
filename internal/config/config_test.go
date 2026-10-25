package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/obalunenko/mergbw-controller/internal/protocol"
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
	assert.Equal(t, 11+len(protocol.Scenes()), strings.Count(string(contents), "http://127.0.0.1:"))
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

func TestURLsListScenesAfterExistingLines(t *testing.T) {
	settings := Settings{DeviceIdentity: "AA:BB:CC:DD:EE:FF", Port: 18765, AccessToken: "existing_local_token_1234567890"}
	presets := map[string]protocol.Preset{
		"sunset": {Label: "Закат", RGB: []int{255, 80, 0}, Brightness: 60},
		"night":  {Label: "Ночь", RGB: []int{40, 60, 255}, Brightness: 25},
	}
	base := settings.BaseURL()
	previous := "MeRGBW LT-06 — кнопки Stream Deck\n\nSystem → Website → URL: скопируйте ссылку целиком.\nВключите GET request in background.\nПеред использованием запустите task run из папки проекта.\n\n" +
		"Включить\n" + base + "/on\n\n" +
		"Выключить\n" + base + "/off\n\n" +
		"Ночь\n" + base + "/preset/night\n\n" +
		"Закат\n" + base + "/preset/sunset\n\n" +
		"Яркость 25%\n" + base + "/brightness/25\n\n" +
		"Яркость 50%\n" + base + "/brightness/50\n\n" +
		"Яркость 100%\n" + base + "/brightness/100\n\n"
	var scenes strings.Builder
	catalog := protocol.Scenes()
	require.Len(t, catalog, 20)
	for _, s := range catalog {
		scenes.WriteString("Сцена " + s.Label + "\n" + base + "/scene/" + s.Slug + "\n\n")
	}
	urls := URLs(settings, presets)
	assert.Equal(t, previous+scenes.String(), urls)
	assert.True(t, strings.HasPrefix(urls, previous))
	for id := 0x80; id <= 0x93; id++ {
		for _, raw := range []string{fmt.Sprintf("%02X", id), fmt.Sprintf("%02x", id)} {
			assert.NotContains(t, urls, "/scene/"+raw+"\n")
		}
	}
}
