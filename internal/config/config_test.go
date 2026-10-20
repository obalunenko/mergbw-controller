package config

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFirstInitRequiresExplicitIdentity(t *testing.T) {
	dir := t.TempDir()
	for _, identity := range []string{"", "not-a-device"} {
		if _, _, err := Init(dir, identity); err == nil {
			t.Fatalf("accepted missing or invalid identity %q", identity)
		}
		if _, err := os.Stat(filepath.Join(dir, "settings.json")); !os.IsNotExist(err) {
			t.Fatal("failed initialization wrote settings.json")
		}
	}
	settings, _, err := Init(dir, "aa:bb:cc:dd:ee:ff")
	if err != nil || settings.DeviceIdentity != "AA:BB:CC:DD:EE:FF" {
		t.Fatalf("explicit identity not normalized: %v, %v", settings.DeviceIdentity, err)
	}
	before, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := Init(dir, "AA:BB:CC:DD:EE:01"); err == nil {
		t.Fatal("init silently accepted a different identity")
	}
	after, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("init replaced existing settings/token")
	}
}

func TestInitPreservesPythonSettingsAndURLs(t *testing.T) {
	dir := t.TempDir()
	settingsJSON := "{\"device_identity\":\"AA:BB:CC:DD:EE:FF\",\"port\":18765,\"access_token\":\"existing_local_token_1234567890\"}\n"
	presetsJSON := "{\"sunset\":{\"label\":\"Мой закат\",\"rgb\":[255,80,0],\"brightness\":42}}\n"
	for name, data := range map[string]string{"settings.json": settingsJSON, "presets.json": presetsJSON} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	settings, presets, err := Init(dir, "")
	if err != nil {
		t.Fatal(err)
	}
	for name, expected := range map[string]string{"settings.json": settingsJSON, "presets.json": presetsJSON} {
		got, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil || string(got) != expected {
			t.Fatalf("Init changed existing %s: %q, %v", name, got, err)
		}
	}
	urls := URLs(settings, presets)
	for _, route := range []string{"on", "off", "preset/sunset", "brightness/25", "brightness/50", "brightness/100"} {
		if !strings.Contains(urls, "http://127.0.0.1:18765/existing_local_token_1234567890/"+route+"\n") {
			t.Errorf("missing compatible route %s", route)
		}
	}
	if !strings.Contains(urls, "Мой закат") || presets["sunset"].Brightness != 42 {
		t.Fatal("custom preset was not retained")
	}
}

func TestInitAndMissingBrightness(t *testing.T) {
	dir := t.TempDir()
	first, presets, err := Init(dir, "AA:BB:CC:DD:EE:FF")
	if err != nil {
		t.Fatal(err)
	}
	second, _, err := Init(dir, "")
	if err != nil {
		t.Fatal(err)
	}
	if first != second || len(first.AccessToken) != 32 || len(presets) != 6 {
		t.Fatal("initialization must create six presets and retain a stable random token")
	}
	path, err := WriteURLs(dir, first, presets)
	if err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(path)
	if err != nil || strings.Count(string(contents), "http://127.0.0.1:") != 11 {
		t.Fatalf("expected 11 button URLs: %v", err)
	}
	for _, data := range []string{
		`{"bad":{"label":"Bad","rgb":[0,0,0]}}`,
		`{"bad":{"label":"Bad","rgb":[0,0,0],"brightness":null}}`,
		`{"bad":{"label":"Bad","rgb":[0,0,256],"brightness":40}}`,
	} {
		if err := os.WriteFile(filepath.Join(dir, "presets.json"), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
		if _, _, err := Init(dir, ""); err == nil {
			t.Fatalf("invalid preset accepted: %s", data)
		}
	}
}
