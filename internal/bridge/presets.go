package bridge

import (
	"maps"
	"slices"

	"github.com/obalunenko/mergbw-controller/internal/config"
	"github.com/obalunenko/mergbw-controller/internal/protocol"
)

type presetEntry struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	BuiltIn bool   `json:"builtIn"`
}

type catalogResponse struct {
	Presets               []presetEntry `json:"presets"`
	PhysicalStateVerified bool          `json:"physical_state_verified"`
}

func presetCatalog(presets map[string]protocol.Preset) catalogResponse {
	entries := make([]presetEntry, 0, len(presets))
	preloaded := config.PreloadedPresetIDs(presets)
	for _, id := range slices.Sorted(maps.Keys(presets)) {
		entries = append(entries, presetEntry{ID: id, Label: presets[id].Label, BuiltIn: preloaded[id]})
	}
	return catalogResponse{Presets: entries}
}
