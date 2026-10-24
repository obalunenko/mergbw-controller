package managed

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"strings"
	"testing"

	"github.com/obalunenko/mergbw-controller/internal/config"
	"github.com/obalunenko/mergbw-controller/internal/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func presetFixture(t *testing.T, presets map[string]protocol.Preset) (*Configuration, *config.ManagedStore, *config.Snapshot) {
	t.Helper()
	c, store, _ := configurationFixture(t)
	settings := config.Settings{DeviceIdentity: "AA:BB:CC:DD:EE:FF", Port: 23456, AccessToken: "synthetic_preset_editor_token"}
	staged, err := store.Stage(strings.Repeat("1", 32), strings.Repeat("2", 32), settings, presets)
	require.NoError(t, err)
	result, err := store.Commit(*staged, "")
	require.NoError(t, err)
	require.Equal(t, config.Applied, result.Outcome)
	active, err := store.Read()
	require.NoError(t, err)
	return c, store, active
}

func editorFrame(t *testing.T, generation string, values map[string]any) Frame {
	t.Helper()
	values["ownerSession"], values["expectedGeneration"] = "test-panel", generation
	return configurationFrame(t, values)
}

func editorProposal(t *testing.T, c *Configuration, generation, operation, id string, preset any) map[string]any {
	t.Helper()
	payload := map[string]any{"operation": operation, "id": id}
	if preset != nil {
		payload["preset"] = preset
	}
	value, err := c.PreparePreset(t.Context(), editorFrame(t, generation, payload))
	require.NoError(t, err)
	return value.(map[string]any)
}

func TestPresetEditorCreateUpdateDeletePreserveSettingsAndAssignments(t *testing.T) {
	c, store, before := presetFixture(t, config.DefaultPresets())
	preset := protocol.Preset{Label: "Colors", RGB: []int{255, 80, 0}, Brightness: 75, Effect: &protocol.Effect{Kind: "palette", Loop: true, Colors: [][]int{{0, 0, 255}}, TransitionMS: 2000}}
	proposal := editorProposal(t, c, before.Generation, "create", "colors", preset)
	assert.Equal(t, map[string]bool{"identity": false, "port": false, "secret": false, "presets": true}, proposal["diff"])
	assert.True(t, proposal["requiresConfirmation"].(bool))
	encoded, err := json.Marshal(proposal)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), before.Settings.AccessToken)
	active, err := store.Read()
	require.NoError(t, err)
	assert.Equal(t, before, active, "review does not write configuration")
	_, err = c.Apply(t.Context(), configurationFrame(t, map[string]any{"transactionId": proposal["transactionId"], "expectedGeneration": before.Generation, "confirmed": false}))
	assert.ErrorIs(t, err, Code("confirmation_required"))
	result := applyFor(t, c, proposal, true)
	assert.Equal(t, config.Applied, result.SaveOutcome)
	active, err = store.Read()
	require.NoError(t, err)
	assert.Equal(t, before.Settings, active.Settings)
	for id, retained := range before.Presets {
		assert.Equal(t, retained, active.Presets[id])
	}
	preset.Label = "Renamed colors"
	update := editorProposal(t, c, active.Generation, "update", "colors", preset)
	applyFor(t, c, update, true)
	active, err = store.Read()
	require.NoError(t, err)
	assert.Equal(t, preset, active.Presets["colors"])
	same := editorProposal(t, c, active.Generation, "update", "colors", preset)
	assert.False(t, same["changed"].(bool))
	assert.Equal(t, config.Unchanged, applyFor(t, c, same, false).SaveOutcome)
	deleted := editorProposal(t, c, active.Generation, "delete", "colors", nil)
	applyFor(t, c, deleted, true)
	active, err = store.Read()
	require.NoError(t, err)
	assert.Equal(t, before.Settings, active.Settings)
	assert.Equal(t, before.Presets, active.Presets)
}

func TestPresetEditorReadAndListAreBoundedAndGenerationConsistent(t *testing.T) {
	presets := make(map[string]protocol.Preset)
	for i := range 122 {
		presets[fmt.Sprintf("p%03d", i)] = protocol.Preset{Label: strings.Repeat("я", 200) + "\x01", RGB: []int{1, 2, 3}, Brightness: 0}
	}
	c, store, initial := presetFixture(t, presets)
	var cursor *string
	var ids []string
	pages := 0
	for {
		payload := map[string]any{}
		if cursor != nil {
			payload["cursor"] = *cursor
		}
		value, err := c.PresetList(t.Context(), editorFrame(t, initial.Generation, payload))
		require.NoError(t, err)
		page := value.(presetPage)
		assert.LessOrEqual(t, len(page.Entries), 50)
		encoded, err := json.Marshal(page)
		require.NoError(t, err)
		assert.LessOrEqual(t, len(encoded), presetEditorBytes)
		assert.Equal(t, initial.Generation, page.Generation)
		for _, entry := range page.Entries {
			assert.Len(t, []rune(entry.Label), 128)
			assert.True(t, entry.LabelTruncated)
			assert.NotContains(t, entry.Label, "\x01")
			ids = append(ids, entry.ID)
		}
		pages++
		cursor = page.NextCursor
		if cursor == nil {
			break
		}
	}
	assert.Equal(t, 3, pages)
	assert.Len(t, ids, 122)
	assert.IsIncreasing(t, ids)
	value, err := c.PresetRead(t.Context(), editorFrame(t, initial.Generation, map[string]any{"id": "p000"}))
	require.NoError(t, err)
	definition := value.(presetDefinition)
	assert.Equal(t, presets["p000"], definition.Preset, "read preserves the complete legacy label")
	definition.Preset.RGB[0] = 250
	active, err := store.Read()
	require.NoError(t, err)
	assert.Equal(t, initial, active, "read/list never save or alter active definitions")
	changed := editorProposal(t, c, initial.Generation, "create", "extra", protocol.Preset{Label: "Extra", RGB: []int{1, 2, 3}, Brightness: 0})
	applyFor(t, c, changed, true)
	_, err = c.PresetList(t.Context(), editorFrame(t, initial.Generation, map[string]any{"cursor": "p049"}))
	assert.ErrorIs(t, err, Code("stale_configuration"))
	_, err = c.PresetRead(t.Context(), editorFrame(t, initial.Generation, map[string]any{"id": "p000"}))
	assert.ErrorIs(t, err, Code("stale_configuration"))
}

func TestPresetEditorOversizedLegacyEntryIsPreserved(t *testing.T) {
	legacy := protocol.Preset{Label: strings.Repeat("L", presetEditorBytes), RGB: []int{1, 2, 3}, Brightness: 50}
	c, store, initial := presetFixture(t, map[string]protocol.Preset{"legacy": legacy})
	_, err := c.PresetRead(t.Context(), editorFrame(t, initial.Generation, map[string]any{"id": "legacy"}))
	assert.ErrorIs(t, err, Code("preset_too_large"))
	value, err := c.PresetList(t.Context(), editorFrame(t, initial.Generation, map[string]any{}))
	require.NoError(t, err)
	assert.True(t, value.(presetPage).Entries[0].LabelTruncated)
	proposal := editorProposal(t, c, initial.Generation, "create", "new", protocol.Preset{Label: "New", RGB: []int{1, 2, 3}, Brightness: 0})
	applyFor(t, c, proposal, true)
	active, err := store.Read()
	require.NoError(t, err)
	assert.Equal(t, legacy, active.Presets["legacy"])
	assert.Equal(t, initial.Settings, active.Settings)
	_, err = c.PreparePreset(t.Context(), editorFrame(t, active.Generation, map[string]any{"operation": "update", "id": "new", "preset": legacy}))
	assert.ErrorIs(t, err, Code("preset_too_large"))
}

func TestPresetEditorRejectsCatalogGrowthBeforeApply(t *testing.T) {
	legacy := protocol.Preset{Label: strings.Repeat("L", config.MaxManagedFileBytes-200), RGB: []int{1, 2, 3}, Brightness: 50}
	c, store, initial := presetFixture(t, map[string]protocol.Preset{"legacy": legacy})
	_, err := c.PreparePreset(t.Context(), editorFrame(t, initial.Generation, map[string]any{"operation": "create", "id": "new", "preset": protocol.Preset{Label: strings.Repeat("N", 128), RGB: []int{1, 2, 3}, Brightness: 0}}))
	assert.ErrorIs(t, err, Code("invalid_configuration"))
	active, err := store.Read()
	require.NoError(t, err)
	assert.Equal(t, initial, active)
	assert.Empty(t, c.proposals)
}

func TestPresetEditorRequiresExistingConfiguration(t *testing.T) {
	c, _, _ := configurationFixture(t)
	payload := map[string]any{"ownerSession": "test-panel", "expectedGeneration": nil}
	_, err := c.PresetList(t.Context(), configurationFrame(t, payload))
	assert.ErrorIs(t, err, Code("unconfigured"))
	payload["id"] = "new"
	_, err = c.PresetRead(t.Context(), configurationFrame(t, payload))
	assert.ErrorIs(t, err, Code("unconfigured"))
	payload["operation"] = "create"
	payload["preset"] = protocol.Preset{Label: "New", RGB: []int{1, 2, 3}, Brightness: 0}
	_, err = c.PreparePreset(t.Context(), configurationFrame(t, payload))
	assert.ErrorIs(t, err, Code("unconfigured"))
}

func TestPresetEditorRejectsInvalidDraftsAndKeepsCatalog(t *testing.T) {
	c, store, initial := presetFixture(t, map[string]protocol.Preset{"only": {Label: "Only", RGB: []int{0, 0, 0}, Brightness: 0}})
	for name, raw := range map[string]string{
		"missing brightness": `{"label":"Name","rgb":[1,2,3]}`,
		"null brightness":    `{"label":"Name","rgb":[1,2,3],"brightness":null}`,
		"unknown field":      `{"label":"Name","rgb":[1,2,3],"brightness":0,"extra":true}`,
		"null effect":        `{"label":"Name","rgb":[1,2,3],"brightness":0,"effect":null}`,
		"unknown effect":     `{"label":"Name","rgb":[1,2,3],"brightness":0,"effect":{"kind":"other","loop":true}}`,
		"empty label":        `{"label":"  ","rgb":[1,2,3],"brightness":0}`,
		"control label":      `{"label":"Name\u0001","rgb":[1,2,3],"brightness":0}`,
		"separator label":    `{"label":"Name\u2028","rgb":[1,2,3],"brightness":0}`,
		"long label":         fmt.Sprintf(`{"label":%q,"rgb":[1,2,3],"brightness":0}`, strings.Repeat("я", 129)),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := c.PreparePreset(t.Context(), editorFrame(t, initial.Generation, map[string]any{"operation": "create", "id": "new", "preset": jsontext.Value(raw)}))
			assert.ErrorIs(t, err, Code("invalid_configuration"))
		})
	}
	for _, tc := range []struct {
		operation, id string
		preset        any
		want          error
	}{
		{"create", "only", protocol.Preset{Label: "Duplicate", RGB: []int{1, 2, 3}}, Code("preset_exists")},
		{"update", "absent", protocol.Preset{Label: "Missing", RGB: []int{1, 2, 3}}, Code("preset_not_found")},
		{"delete", "absent", nil, Code("preset_not_found")},
		{"delete", "only", nil, Code("invalid_configuration")},
		{"update", "only", nil, Code("invalid_configuration")},
	} {
		payload := map[string]any{"operation": tc.operation, "id": tc.id}
		if tc.preset != nil {
			payload["preset"] = tc.preset
		}
		_, err := c.PreparePreset(t.Context(), editorFrame(t, initial.Generation, payload))
		assert.ErrorIs(t, err, tc.want)
	}
	active, err := store.Read()
	require.NoError(t, err)
	assert.Equal(t, initial, active)
	valid := editorProposal(t, c, initial.Generation, "create", "zero", protocol.Preset{Label: strings.Repeat("я", 128), RGB: []int{1, 2, 3}, Brightness: 0})
	assert.Equal(t, 0, c.proposals[valid["transactionId"].(string)].Presets["zero"].Brightness)
}

func TestPresetEditorRejectsWireFieldsAndStaleOwners(t *testing.T) {
	c, _, initial := presetFixture(t, config.DefaultPresets())
	for _, raw := range []string{
		`{"expectedGeneration":"` + initial.Generation + `"}`,
		`{"ownerSession":"panel"}`,
		`{"ownerSession":"panel","expectedGeneration":"` + initial.Generation + `","cursor":null}`,
		`{"ownerSession":"panel","expectedGeneration":"` + initial.Generation + `","cursor":"../bad"}`,
		`{"ownerSession":"panel","expectedGeneration":"` + initial.Generation + `","extra":true}`,
	} {
		_, err := c.PresetList(t.Context(), Frame{Payload: []byte(raw)})
		assert.ErrorIs(t, err, ProtocolIncompatible)
	}
	_, err := c.PresetRead(t.Context(), editorFrame(t, initial.Generation, map[string]any{"id": "absent"}))
	assert.ErrorIs(t, err, Code("preset_not_found"))
	_, err = c.PreparePreset(t.Context(), editorFrame(t, initial.Generation, map[string]any{"operation": "delete", "id": "sunset", "preset": nil}))
	assert.ErrorIs(t, err, ProtocolIncompatible)
	one := editorProposal(t, c, initial.Generation, "create", "one", protocol.Preset{Label: "One", RGB: []int{1, 2, 3}})
	otherFrame := editorFrame(t, initial.Generation, map[string]any{"operation": "create", "id": "two", "preset": protocol.Preset{Label: "Two", RGB: []int{1, 2, 3}}})
	var raw map[string]any
	require.NoError(t, json.Unmarshal(otherFrame.Payload, &raw))
	raw["ownerSession"] = "other-panel"
	value, err := c.PreparePreset(t.Context(), configurationFrame(t, raw))
	require.NoError(t, err)
	other := value.(map[string]any)
	_, err = c.Apply(t.Context(), configurationFrame(t, map[string]any{"ownerSession": "test-panel", "transactionId": other["transactionId"], "expectedGeneration": initial.Generation, "confirmed": true}))
	assert.ErrorIs(t, err, Code("proposal_expired"))
	applyFor(t, c, one, true)
	_, err = c.Apply(t.Context(), configurationFrame(t, map[string]any{"ownerSession": "other-panel", "transactionId": other["transactionId"], "expectedGeneration": initial.Generation, "confirmed": true}))
	assert.ErrorIs(t, err, Code("stale_configuration"))
	for _, code := range []Code{"preset_exists", "preset_not_found", "preset_too_large"} {
		assert.Equal(t, code, SafeCode(code))
	}
}
