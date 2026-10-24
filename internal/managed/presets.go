package managed

import (
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"maps"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/obalunenko/mergbw-controller/internal/config"
	"github.com/obalunenko/mergbw-controller/internal/protocol"
)

const presetEditorBytes = 32 * 1024

var presetIDPattern = regexp.MustCompile(`^[a-z0-9_-]{1,40}$`)

type presetListEntry struct {
	ID             string `json:"id"`
	Label          string `json:"label"`
	LabelTruncated bool   `json:"labelTruncated"`
	BuiltIn        bool   `json:"builtIn"`
}

type presetPage struct {
	Generation string            `json:"generation"`
	Entries    []presetListEntry `json:"entries"`
	NextCursor *string           `json:"nextCursor"`
}

type presetDefinition struct {
	Generation string          `json:"generation"`
	ID         string          `json:"id"`
	Preset     protocol.Preset `json:"preset"`
}

func presetLabelPreview(label string) (string, bool) {
	runes := []rune(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == '\u2028' || r == '\u2029' {
			return -1
		}
		return r
	}, label))
	preview := string(runes[:min(len(runes), 128)])
	return preview, preview != label
}

// PresetList returns a bounded, generation-consistent label page, never settings.
func (c *Configuration) PresetList(_ context.Context, frame Frame) (any, error) {
	var request struct {
		Owner    string         `json:"ownerSession"`
		Expected jsontext.Value `json:"expectedGeneration"`
		Cursor   jsontext.Value `json:"cursor"`
	}
	if err := DecodePayload(frame, &request); err != nil {
		return nil, err
	}
	var cursor *string
	if len(request.Cursor) != 0 {
		var id string
		if string(request.Cursor) == "null" || json.Unmarshal(request.Cursor, &id) != nil || !presetIDPattern.MatchString(id) {
			return nil, ProtocolIncompatible
		}
		cursor = new(id)
	}
	c.mutex.Lock()
	defer c.mutex.Unlock()
	active, _, err := c.prepare(request.Owner, request.Expected)
	if err != nil {
		return nil, err
	}
	if active == nil {
		return nil, Code("unconfigured")
	}
	if cursor != nil {
		if _, exists := active.Presets[*cursor]; !exists {
			return nil, Code("preset_not_found")
		}
	}
	page := presetPage{Generation: active.Generation, Entries: []presetListEntry{}}
	preloaded := config.PreloadedPresetIDs(active.Presets)
	for _, id := range slices.Sorted(maps.Keys(active.Presets)) {
		if cursor != nil && id <= *cursor {
			continue
		}
		label, truncated := presetLabelPreview(active.Presets[id].Label)
		entry := presetListEntry{ID: id, Label: label, LabelTruncated: truncated, BuiltIn: preloaded[id]}
		page.Entries = append(page.Entries, entry)
		encoded, err := json.Marshal(page)
		if err != nil {
			return nil, Code("invalid_configuration")
		}
		// Reserve space for the final cursor, which is at most a 40-byte ID.
		if len(page.Entries) > 50 || len(encoded)+42 > presetEditorBytes {
			page.Entries = page.Entries[:len(page.Entries)-1]
			page.NextCursor = new(page.Entries[len(page.Entries)-1].ID)
			break
		}
	}
	return page, nil
}

func (c *Configuration) PresetRead(_ context.Context, frame Frame) (any, error) {
	var request struct {
		Owner    string         `json:"ownerSession"`
		Expected jsontext.Value `json:"expectedGeneration"`
		ID       string         `json:"id"`
	}
	if err := DecodePayload(frame, &request); err != nil {
		return nil, err
	}
	if !presetIDPattern.MatchString(request.ID) {
		return nil, ProtocolIncompatible
	}
	c.mutex.Lock()
	defer c.mutex.Unlock()
	active, _, err := c.prepare(request.Owner, request.Expected)
	if err != nil {
		return nil, err
	}
	if active == nil {
		return nil, Code("unconfigured")
	}
	preset, exists := active.Presets[request.ID]
	if !exists {
		return nil, Code("preset_not_found")
	}
	definition := presetDefinition{Generation: active.Generation, ID: request.ID, Preset: protocol.ClonePreset(preset)}
	encoded, err := json.Marshal(definition)
	if err != nil || len(encoded) > presetEditorBytes {
		return nil, Code("preset_too_large")
	}
	return definition, nil
}

func decodeEditedPreset(id string, raw jsontext.Value) (protocol.Preset, error) {
	if len(raw) > presetEditorBytes {
		return protocol.Preset{}, Code("preset_too_large")
	}
	// DecodePresets retains missing/null brightness checks and variant validation;
	// this boundary additionally rejects unknown root fields for edited entries.
	var allowed struct {
		Label      jsontext.Value `json:"label"`
		RGB        jsontext.Value `json:"rgb"`
		Brightness jsontext.Value `json:"brightness"`
		Effect     jsontext.Value `json:"effect"`
	}
	if len(raw) == 0 || string(raw) == "null" || json.Unmarshal(raw, &allowed, json.RejectUnknownMembers(true)) != nil {
		return protocol.Preset{}, Code("invalid_configuration")
	}
	data, err := json.Marshal(map[string]jsontext.Value{id: raw})
	if err != nil {
		return protocol.Preset{}, Code("invalid_configuration")
	}
	presets, err := config.DecodePresets(data)
	if err != nil {
		return protocol.Preset{}, Code("invalid_configuration")
	}
	preset := presets[id]
	if utf8.RuneCountInString(preset.Label) > 128 || strings.IndexFunc(preset.Label, func(r rune) bool {
		return unicode.IsControl(r) || r == '\u2028' || r == '\u2029'
	}) >= 0 {
		return protocol.Preset{}, Code("invalid_configuration")
	}
	return preset, nil
}

// PreparePreset changes one entry in a captured full-pair proposal. Apply keeps
// its existing stop/reap/commit barrier and is the only operation that writes.
func (c *Configuration) PreparePreset(_ context.Context, frame Frame) (any, error) {
	var request struct {
		Owner     string         `json:"ownerSession"`
		Expected  jsontext.Value `json:"expectedGeneration"`
		Operation string         `json:"operation"`
		ID        string         `json:"id"`
		Preset    jsontext.Value `json:"preset"`
	}
	if err := DecodePayload(frame, &request); err != nil {
		return nil, err
	}
	if !presetIDPattern.MatchString(request.ID) || !slices.Contains([]string{"create", "update", "delete"}, request.Operation) || (request.Operation == "delete" && len(request.Preset) != 0) {
		return nil, ProtocolIncompatible
	}
	c.mutex.Lock()
	defer c.mutex.Unlock()
	active, expected, err := c.prepare(request.Owner, request.Expected)
	if err != nil {
		return nil, err
	}
	if active == nil {
		return nil, Code("unconfigured")
	}
	_, exists := active.Presets[request.ID]
	if request.Operation == "create" && exists {
		return nil, Code("preset_exists")
	}
	if request.Operation != "create" && !exists {
		return nil, Code("preset_not_found")
	}
	presets := maps.Clone(active.Presets)
	for id, preset := range presets {
		presets[id] = protocol.ClonePreset(preset)
	}
	if request.Operation == "delete" {
		delete(presets, request.ID)
	} else {
		preset, err := decodeEditedPreset(request.ID, request.Preset)
		if err != nil {
			return nil, err
		}
		presets[request.ID] = preset
	}
	encoded, err := json.Marshal(presets)
	if err != nil || len(encoded)+1 > config.MaxManagedFileBytes {
		return nil, Code("invalid_configuration")
	}
	proposal, err := config.PrepareProposal(request.Owner, expected, active, active.Settings, presets, time.Now())
	if err != nil {
		return nil, configurationError(err)
	}
	return c.remember(proposal)
}
