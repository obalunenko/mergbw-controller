package protocol

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"slices"
)

var ErrEffectNotFound = errors.New("effect not found")

// Effect is a bounded tagged definition. RGB and brightness live on its preset.
type Effect struct {
	Kind          string
	Loop          bool
	Colors        [][]int
	TransitionMS  int
	OnMS          int
	OffMS         int
	MinBrightness int
	CycleMS       int
	Depth         int
	FlickerMS     int
	DurationMS    int
}

func (e Effect) fields() map[string]any {
	fields := map[string]any{"kind": e.Kind, "loop": e.Loop}
	switch e.Kind {
	case "palette":
		fields["colors"], fields["transitionMs"] = e.Colors, e.TransitionMS
	case "strobe":
		fields["onMs"], fields["offMs"] = e.OnMS, e.OffMS
	case "breathing":
		fields["minBrightness"], fields["cycleMs"] = e.MinBrightness, e.CycleMS
	case "candle":
		fields["depth"], fields["flickerMs"] = e.Depth, e.FlickerMS
		if !e.Loop {
			fields["durationMs"] = e.DurationMS
		}
	}
	return fields
}

func (e Effect) MarshalJSON() ([]byte, error) { return json.Marshal(e.fields()) }

func (e *Effect) UnmarshalJSON(data []byte) error {
	var raw map[string]jsontext.Value
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	var decoded Effect
	if json.Unmarshal(raw["kind"], &decoded.Kind) != nil || json.Unmarshal(raw["loop"], &decoded.Loop) != nil || string(raw["loop"]) == "null" {
		return fmt.Errorf("effect requires kind and loop")
	}
	if !slices.Contains([]string{"palette", "strobe", "breathing", "candle"}, decoded.Kind) {
		return fmt.Errorf("unknown effect kind")
	}
	allowed := decoded.fields()
	if len(raw) != len(allowed) {
		return fmt.Errorf("incorrect effect fields")
	}
	for key, value := range raw {
		if _, ok := allowed[key]; !ok || string(value) == "null" {
			return fmt.Errorf("incorrect effect field")
		}
	}
	// Decode only this variant, including explicit zero-valued parameters.
	var values struct {
		Colors        [][]int `json:"colors"`
		TransitionMS  int     `json:"transitionMs"`
		OnMS          int     `json:"onMs"`
		OffMS         int     `json:"offMs"`
		MinBrightness int     `json:"minBrightness"`
		CycleMS       int     `json:"cycleMs"`
		Depth         int     `json:"depth"`
		FlickerMS     int     `json:"flickerMs"`
		DurationMS    int     `json:"durationMs"`
	}
	if err := json.Unmarshal(data, &values); err != nil {
		return err
	}
	decoded.Colors, decoded.TransitionMS = values.Colors, values.TransitionMS
	decoded.OnMS, decoded.OffMS = values.OnMS, values.OffMS
	decoded.MinBrightness, decoded.CycleMS = values.MinBrightness, values.CycleMS
	decoded.Depth, decoded.FlickerMS, decoded.DurationMS = values.Depth, values.FlickerMS, values.DurationMS
	*e = decoded
	return nil
}

func (e Effect) Validate(brightness int) error {
	between := func(value, low, high int) bool { return value >= low && value <= high }
	valid := false
	switch e.Kind {
	case "palette":
		valid = between(len(e.Colors), 1, 15) && between(e.TransitionMS, 500, 60000) && e.OnMS == 0 && e.OffMS == 0 && e.MinBrightness == 0 && e.CycleMS == 0 && e.Depth == 0 && e.FlickerMS == 0 && e.DurationMS == 0
		for _, color := range e.Colors {
			if _, err := rgbBytes(color); err != nil {
				return err
			}
		}
	case "strobe":
		valid = between(e.OnMS, 250, 60000) && between(e.OffMS, 250, 60000) && len(e.Colors) == 0 && e.TransitionMS == 0 && e.MinBrightness == 0 && e.CycleMS == 0 && e.Depth == 0 && e.FlickerMS == 0 && e.DurationMS == 0
	case "breathing":
		valid = between(e.MinBrightness, 0, 99) && e.MinBrightness < brightness && between(e.CycleMS, 1000, 120000) && len(e.Colors) == 0 && e.TransitionMS == 0 && e.OnMS == 0 && e.OffMS == 0 && e.Depth == 0 && e.FlickerMS == 0 && e.DurationMS == 0
	case "candle":
		valid = between(e.Depth, 0, 100) && between(e.FlickerMS, 250, 5000) && len(e.Colors) == 0 && e.TransitionMS == 0 && e.OnMS == 0 && e.OffMS == 0 && e.MinBrightness == 0 && e.CycleMS == 0 && ((e.Loop && e.DurationMS == 0) || (!e.Loop && between(e.DurationMS, 1000, 3600000)))
	}
	if !valid {
		return fmt.Errorf("invalid effect parameters")
	}
	return nil
}

func ClonePreset(p Preset) Preset {
	p.RGB = slices.Clone(p.RGB)
	if p.Effect != nil {
		e := *p.Effect
		e.Colors = slices.Clone(e.Colors)
		for i := range e.Colors {
			e.Colors[i] = slices.Clone(e.Colors[i])
		}
		p.Effect = &e
	}
	return p
}

type EffectAction struct {
	PresetID string
	Preset   Preset
}

func (a EffectAction) Validate() error {
	if a.Preset.Effect == nil {
		return fmt.Errorf("missing effect")
	}
	return ValidatePresets(map[string]Preset{a.PresetID: a.Preset})
}

func (a EffectAction) DurationMS() *int64 {
	e := a.Preset.Effect
	if e.Loop {
		return nil
	}
	var duration int
	switch e.Kind {
	case "palette":
		duration = len(e.Colors) * e.TransitionMS
	case "strobe":
		duration = e.OnMS + e.OffMS
	case "breathing":
		duration = e.CycleMS
	case "candle":
		duration = e.DurationMS
	}
	return new(int64(duration))
}

type EffectSnapshot struct {
	ID                    string `json:"id"`
	PresetID              string `json:"presetId"`
	Kind                  string `json:"kind"`
	State                 string `json:"state"`
	ElapsedMS             int64  `json:"elapsedMs"`
	DurationMS            *int64 `json:"durationMs"`
	PhysicalStateVerified bool   `json:"physical_state_verified"`
}
