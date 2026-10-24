// Package config preserves the Python controller's settings and button URLs.
package config

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/obalunenko/mergbw-controller/internal/protocol"
)

const DefaultPort = 18765

type Settings struct {
	DeviceIdentity string `json:"device_identity"`
	Port           int    `json:"port"`
	AccessToken    string `json:"access_token"`
}

var identityPattern = regexp.MustCompile(`^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$`)
var tokenPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{24,128}$`)

func (s Settings) Validate() error {
	if !identityPattern.MatchString(s.DeviceIdentity) {
		return fmt.Errorf("settings.json: device_identity должен иметь вид AA:BB:CC:DD:EE:FF")
	}
	if s.Port < 1024 || s.Port > 65535 {
		return fmt.Errorf("settings.json: port должен быть целым числом от 1024 до 65535")
	}
	if !tokenPattern.MatchString(s.AccessToken) {
		return fmt.Errorf("settings.json: некорректный access_token (24–128 символов A-Z, a-z, 0-9, _, -)")
	}
	return nil
}

func (s Settings) Address() string { return fmt.Sprintf("127.0.0.1:%d", s.Port) }
func (s Settings) BaseURL() string { return "http://" + s.Address() + "/" + s.AccessToken }

func defaults() map[string]protocol.Preset {
	return map[string]protocol.Preset{
		"sunset": {Label: "Закат", RGB: []int{255, 80, 0}, Brightness: 60},
		"night":  {Label: "Ночь", RGB: []int{40, 60, 255}, Brightness: 25},
		"alarm":  {Label: "Тревога", RGB: []int{255, 0, 0}, Brightness: 70},
		"magic":  {Label: "Магия", RGB: []int{160, 0, 255}, Brightness: 45},
		"forest": {Label: "Лес", RGB: []int{20, 180, 60}, Brightness: 40},
		"white":  {Label: "Белый RGB", RGB: []int{255, 255, 255}, Brightness: 50},
	}
}

func createJSON(path string, value any, mode os.FileMode) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if os.IsExist(err) {
		return nil // Never replace the token or presets on repeated init.
	}
	if err != nil {
		return err
	}
	_, writeErr := file.Write(append(data, '\n'))
	closeErr := file.Close()
	if writeErr != nil {
		return writeErr
	}
	return closeErr
}

// Init creates only missing files. The first initialization requires an explicit
// manufacturer identity. Existing settings, tokens and presets are retained.
func Init(directory, identity string) (Settings, map[string]protocol.Preset, error) {
	identity, err := NormalizeIdentity(identity)
	if err != nil {
		return Settings{}, nil, err
	}
	settingsPath := filepath.Join(directory, "settings.json")
	_, statErr := os.Stat(settingsPath)
	if statErr != nil && !os.IsNotExist(statErr) {
		return Settings{}, nil, statErr
	}
	if os.IsNotExist(statErr) && identity == "" {
		return Settings{}, nil, fmt.Errorf("для первой настройки укажите identity своей лампы: ./sunset --identity AA:BB:CC:DD:EE:FF init; пример замените своим идентификатором")
	}
	if err := os.MkdirAll(directory, 0755); err != nil {
		return Settings{}, nil, err
	}
	if os.IsNotExist(statErr) {
		settings, err := PrepareManualSettings(identity, nil)
		if err != nil {
			return Settings{}, nil, err
		}
		if err := createJSON(settingsPath, settings, 0600); err != nil {
			return Settings{}, nil, err
		}
	}
	if err := createJSON(filepath.Join(directory, "presets.json"), defaults(), 0644); err != nil {
		return Settings{}, nil, err
	}
	settings, presets, err := Load(directory)
	if err == nil && identity != "" && identity != settings.DeviceIdentity {
		return Settings{}, nil, fmt.Errorf("settings.json уже настроен на другую identity; для её изменения отредактируйте device_identity в этом файле")
	}
	return settings, presets, err
}

func Load(directory string) (Settings, map[string]protocol.Preset, error) {
	data, err := os.ReadFile(filepath.Join(directory, "settings.json"))
	if err != nil {
		return Settings{}, nil, fmt.Errorf("прочитать settings.json: %w; сначала выполните ./sunset init", err)
	}
	settings, err := DecodeSettings(data)
	if err != nil {
		return settings, nil, err
	}
	presets, err := LoadPresets(directory)
	return settings, presets, err
}

func LoadPresets(directory string) (map[string]protocol.Preset, error) {
	data, err := os.ReadFile(filepath.Join(directory, "presets.json"))
	if err != nil {
		return nil, fmt.Errorf("прочитать presets.json: %w", err)
	}
	return DecodePresets(data)
}

// DecodeSettings applies the existing standalone settings format and rules.
func DecodeSettings(data []byte) (Settings, error) {
	var settings Settings
	if err := json.Unmarshal(data, &settings); err != nil {
		return settings, fmt.Errorf("settings.json: %w", err)
	}
	if err := settings.Validate(); err != nil {
		return settings, err
	}
	settings.DeviceIdentity = strings.ToUpper(settings.DeviceIdentity)
	return settings, nil
}

// NormalizeIdentity accepts the CLI's optional identity; callers creating new
// settings must additionally reject an empty value.
func NormalizeIdentity(identity string) (string, error) {
	identity = strings.ToUpper(strings.TrimSpace(identity))
	if identity != "" && !identityPattern.MatchString(identity) {
		return "", fmt.Errorf("--identity: нужны шесть HEX-байтов через двоеточие, например AA:BB:CC:DD:EE:FF")
	}
	return identity, nil
}

// PrepareManualSettings prepares a candidate, without saving or changing a lamp.
// Existing port and secret are retained, including for an explicitly reviewed
// identity replacement. The caller owns confirmation and commit.
func PrepareManualSettings(identity string, previous *Settings) (Settings, error) {
	identity, err := NormalizeIdentity(identity)
	if err != nil || identity == "" {
		return Settings{}, fmt.Errorf("invalid_identity")
	}
	if previous != nil {
		if err := previous.Validate(); err != nil {
			return Settings{}, fmt.Errorf("invalid_settings")
		}
		candidate := *previous
		candidate.DeviceIdentity = identity
		return candidate, nil
	}
	secret := make([]byte, 24)
	if _, err := rand.Read(secret); err != nil {
		return Settings{}, fmt.Errorf("secret_generation_failed")
	}
	return Settings{DeviceIdentity: identity, Port: DefaultPort, AccessToken: base64.RawURLEncoding.EncodeToString(secret)}, nil
}

// DefaultPresets returns a fresh catalog, never a merge into an existing one.
func DefaultPresets() map[string]protocol.Preset { return defaults() }

// DecodePresets preserves the standalone catalog's missing-field validation.
func DecodePresets(data []byte) (map[string]protocol.Preset, error) {
	// Pointers distinguish missing/null brightness from the valid value zero.
	var raw map[string]struct {
		Label      string `json:"label"`
		RGB        []int  `json:"rgb"`
		Brightness *int   `json:"brightness"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("presets.json: %w", err)
	}
	presets := make(map[string]protocol.Preset, len(raw))
	for slug, value := range raw {
		if value.Brightness == nil {
			return nil, fmt.Errorf("пресет %s: поле brightness обязательно", slug)
		}
		presets[slug] = protocol.Preset{Label: value.Label, RGB: value.RGB, Brightness: *value.Brightness}
	}
	if err := protocol.ValidatePresets(presets); err != nil {
		return nil, err
	}
	return presets, nil
}

func URLs(settings Settings, presets map[string]protocol.Preset) string {
	var out strings.Builder
	out.WriteString("MeRGBW LT-06 — кнопки Stream Deck\n\nSystem → Website → URL: скопируйте ссылку целиком.\nВключите GET request in background.\nПеред использованием запустите task run из папки проекта.\n\n")
	add := func(label, route string) { fmt.Fprintf(&out, "%s\n%s/%s\n\n", label, settings.BaseURL(), route) }
	add("Включить", "on")
	add("Выключить", "off")
	keys := make([]string, 0, len(presets))
	for key := range presets {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		add(presets[key].Label, "preset/"+key)
	}
	for _, level := range []int{25, 50, 100} {
		add(fmt.Sprintf("Яркость %d%%", level), fmt.Sprintf("brightness/%d", level))
	}
	return out.String()
}

func WriteURLs(directory string, settings Settings, presets map[string]protocol.Preset) (string, error) {
	path := filepath.Join(directory, "streamdeck-buttons.txt")
	file, err := os.CreateTemp(directory, ".sunset-urls-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(file.Name())
	_, writeErr := file.WriteString(URLs(settings, presets))
	closeErr := file.Close()
	if writeErr != nil {
		return "", writeErr
	}
	if closeErr != nil {
		return "", closeErr
	}
	if err := os.Rename(file.Name(), path); err != nil {
		return "", err
	}
	return path, nil
}
