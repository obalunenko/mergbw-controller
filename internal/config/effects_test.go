package config

import (
	"encoding/json/v2"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEffectCatalogCompatibilityAndCapturedDeepCopy(t *testing.T) {
	encoded := []byte(`{"static":{"label":"Old","rgb":[255,80,0],"brightness":0},"dynamic":{"label":"New","rgb":[255,80,0],"brightness":75,"effect":{"kind":"palette","loop":true,"colors":[[0,0,255]],"transitionMs":500}}}`)
	presets, err := DecodePresets(encoded)
	require.NoError(t, err)
	assert.Nil(t, presets["static"].Effect)
	assert.Zero(t, presets["static"].Brightness)
	require.NotNil(t, presets["dynamic"].Effect)
	settings := Settings{DeviceIdentity: "AA:BB:CC:DD:EE:FF", Port: DefaultPort, AccessToken: strings.Repeat("a", 32)}
	proposal, err := PrepareProposal("editor", "", nil, settings, presets, time.Now())
	require.NoError(t, err)
	presets["dynamic"].Effect.Colors[0][0] = 99
	assert.Zero(t, proposal.Presets["dynamic"].Effect.Colors[0][0])
	data, err := json.Marshal(proposal.Presets)
	require.NoError(t, err)
	decoded, err := DecodePresets(data)
	require.NoError(t, err)
	assert.Equal(t, proposal.Presets, decoded)
}

func TestEffectCatalogRejectsNullAndMissingRequiredParameters(t *testing.T) {
	for _, encoded := range []string{
		`{"p":{"label":"x","rgb":[1,2,3],"brightness":0,"effect":null}}`,
		`{"p":{"label":"x","rgb":[1,2,3],"effect":{"kind":"strobe","loop":true,"onMs":500,"offMs":500}}}`,
		`{"p":{"label":"x","rgb":[1,2,3],"brightness":50,"effect":{"kind":"breathing","loop":true,"cycleMs":1000}}}`,
	} {
		_, err := DecodePresets([]byte(encoded))
		assert.Error(t, err)
	}
}
