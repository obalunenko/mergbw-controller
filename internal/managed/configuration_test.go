package managed

import (
	"context"
	"encoding/json/v2"
	"go.uber.org/mock/gomock"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/obalunenko/mergbw-controller/internal/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func configurationFrame(t *testing.T, payload any) Frame {
	t.Helper()
	if value, ok := payload.(map[string]any); ok {
		if value["identity"] != nil || value["transactionId"] != nil {
			if _, exists := value["ownerSession"]; !exists {
				value["ownerSession"] = "test-panel"
			}
		}
	}
	data, err := json.Marshal(payload)
	require.NoError(t, err)
	return Frame{Payload: data}
}
func proposalFor(t *testing.T, c *Configuration, identity string, expected any) map[string]any {
	t.Helper()
	value, err := c.PrepareManual(t.Context(), configurationFrame(t, map[string]any{"identity": identity, "expectedGeneration": expected}))
	require.NoError(t, err)
	return value.(map[string]any)
}
func applyFor(t *testing.T, c *Configuration, p map[string]any, confirmed bool) configurationResult {
	t.Helper()
	value, err := c.Apply(t.Context(), configurationFrame(t, map[string]any{"transactionId": p["transactionId"], "expectedGeneration": p["expectedGeneration"], "confirmed": confirmed}))
	require.NoError(t, err)
	return value.(configurationResult)
}
func configurationFixture(t *testing.T) (*Configuration, *config.ManagedStore, string) {
	t.Helper()
	directory := t.TempDir()
	store, err := config.OpenManagedStore(directory)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, store.Close()) })
	return NewConfiguration(store, nil, directory), store, directory
}
func TestManualConfigurationTransactions(t *testing.T) {
	c, store, _ := configurationFixture(t)
	_, err := c.PrepareManual(t.Context(), configurationFrame(t, map[string]any{"identity": "bad", "expectedGeneration": nil}))
	require.ErrorIs(t, err, Code("invalid_identity"))
	active, err := store.Read()
	require.NoError(t, err)
	assert.Nil(t, active)
	p := proposalFor(t, c, "aa:bb:cc:dd:ee:ff", nil)
	assert.Equal(t, "AA:BB:CC:DD:EE:FF", p["identity"])
	assert.True(t, p["hasToken"].(bool))
	assert.False(t, p["requiresConfirmation"].(bool))
	assert.NotEqual(t, p["transactionId"], p["candidateGeneration"])
	result := applyFor(t, c, p, false)
	assert.Equal(t, config.Applied, result.SaveOutcome)
	active, err = store.Read()
	require.NoError(t, err)
	require.NotNil(t, active)
	assert.Equal(t, p["candidateGeneration"], active.Generation)
	before := *active
	assert.Equal(t, result, applyFor(t, c, p, false))
	same := proposalFor(t, c, "AA:BB:CC:DD:EE:FF", active.Generation)
	assert.False(t, same["changed"].(bool))
	assert.Equal(t, config.Unchanged, applyFor(t, c, same, false).SaveOutcome)
	active, err = store.Read()
	require.NoError(t, err)
	assert.Equal(t, &before, active)
	changed := proposalFor(t, c, "11:22:33:44:55:66", active.Generation)
	_, err = c.Apply(t.Context(), configurationFrame(t, map[string]any{"transactionId": changed["transactionId"], "expectedGeneration": active.Generation, "confirmed": false}))
	assert.ErrorIs(t, err, Code("confirmation_required"))
	assert.Equal(t, config.Applied, applyFor(t, c, changed, true).SaveOutcome)
	after, err := store.Read()
	require.NoError(t, err)
	assert.Equal(t, before.Settings.AccessToken, after.Settings.AccessToken)
	assert.Equal(t, before.Presets, after.Presets)
}
func TestManualConfigurationCancelExpiryAndStale(t *testing.T) {
	c, _, _ := configurationFixture(t)
	p := proposalFor(t, c, "AA:BB:CC:DD:EE:FF", nil)
	_, err := c.Cancel(t.Context(), configurationFrame(t, map[string]any{"transactionId": p["transactionId"]}))
	require.NoError(t, err)
	_, err = c.Apply(t.Context(), configurationFrame(t, map[string]any{"transactionId": p["transactionId"], "expectedGeneration": nil, "confirmed": false}))
	assert.ErrorIs(t, err, Code("proposal_expired"))
	p = proposalFor(t, c, "AA:BB:CC:DD:EE:FF", nil)
	c.proposals[p["transactionId"].(string)].Expires = time.Now().Add(-time.Second)
	_, err = c.Apply(t.Context(), configurationFrame(t, map[string]any{"transactionId": p["transactionId"], "expectedGeneration": nil, "confirmed": false}))
	assert.ErrorIs(t, err, Code("proposal_expired"))
	old := proposalFor(t, c, "AA:BB:CC:DD:EE:FF", nil)
	c.proposals[old["transactionId"].(string)].Owner = "other-panel"
	applyFor(t, c, proposalFor(t, c, "AA:BB:CC:DD:EE:FF", nil), false)
	_, err = c.Apply(t.Context(), configurationFrame(t, map[string]any{"transactionId": old["transactionId"], "ownerSession": "other-panel", "expectedGeneration": nil, "confirmed": false}))
	assert.ErrorIs(t, err, Code("stale_configuration"))
}
func TestManualConfigurationStorageFaultAndReadOnlyRecovery(t *testing.T) {
	c, store, directory := configurationFixture(t)
	p := proposalFor(t, c, "AA:BB:CC:DD:EE:FF", nil)
	require.NoError(t, os.WriteFile(filepath.Join(directory, "staging"), []byte("fixture"), 0600))
	result := applyFor(t, c, p, false)
	assert.Equal(t, config.NotApplied, result.SaveOutcome)
	active, err := store.Read()
	require.NoError(t, err)
	assert.Nil(t, active)
	// Damage only this fixture's authoritative pointer; never reinterpret it as
	// an empty installation or permit a mutation before read-only recovery.
	require.NoError(t, os.WriteFile(filepath.Join(directory, "CURRENT.json"), []byte("broken"), 0600))
	_, err = c.Read(t.Context(), configurationFrame(t, map[string]any{}))
	assert.ErrorIs(t, err, Code("invalid_configuration"))
	_, err = c.PrepareManual(t.Context(), configurationFrame(t, map[string]any{"identity": "AA:BB:CC:DD:EE:FF", "expectedGeneration": nil}))
	assert.ErrorIs(t, err, Code("storage_unavailable"))
	require.NoError(t, os.Remove(filepath.Join(directory, "CURRENT.json")))
	value, err := c.Read(t.Context(), configurationFrame(t, map[string]any{}))
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"configured": false, "generation": nil}, value)
}
func TestManualConfigurationLegacyIsPrivateAndValidated(t *testing.T) {
	c, store, _ := configurationFixture(t)
	value, err := c.PrepareManual(t.Context(), configurationFrame(t, map[string]any{"identity": "AA:BB:CC:DD:EE:FF", "expectedGeneration": nil, "legacyConnection": map[string]any{"port": 23456, "accessToken": "synthetic_access_token_123456789"}}))
	require.NoError(t, err)
	p := value.(map[string]any)
	encoded, err := json.Marshal(p)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "synthetic_access_token")
	assert.Equal(t, 23456, p["port"])
	applyFor(t, c, p, false)
	active, err := store.Read()
	require.NoError(t, err)
	assert.Equal(t, "synthetic_access_token_123456789", active.Settings.AccessToken)
}

func TestManualConfigurationCommitWaitsForWorkerExitAndRevocation(t *testing.T) {
	supervisor, launcher, listeners, mocks := baselineSupervisor(t)
	port := fixtureReservation(t, listeners)
	c, store, _ := configurationFixture(t)
	c.runtime = supervisor
	first := proposalFor(t, c, "AA:BB:CC:DD:EE:FF", nil)
	c.proposals[first["transactionId"].(string)].Settings.Port = port
	initial := applyFor(t, c, first, false)
	process, workerInput, workerOutput, signalled := fixtureProcess(t, mocks)
	launcher.EXPECT().Start(gomock.Any()).Return(process, nil)
	ready := make(chan error, 1)
	go func() {
		frame, err := NewDecoder(workerInput, supervisor.options.Session).Read()
		if err != nil {
			ready <- err
			return
		}
		var binding Binding
		if err := DecodePayload(frame, &binding); err != nil {
			ready <- err
			return
		}
		frame.Payload, err = json.Marshal(Bootstrap{Binding: binding, Port: port, ProtocolVersion: ProtocolVersion, BridgeVersion: "test"})
		if err != nil {
			ready <- err
			return
		}
		frame.Type = "worker.ready"
		ready <- NewEncoder(workerOutput).Write(frame)
	}()
	require.NoError(t, supervisor.Watch(testFrame()))
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	value, err := c.Launch(ctx, initial.Generation, false)
	require.NoError(t, err)
	require.NoError(t, <-ready)
	bootstrap := value.(Bootstrap)
	authorize := testFrame()
	authorize.Type = "runtime.authorized"
	authorize.Payload, err = json.Marshal(bootstrap.Binding)
	require.NoError(t, err)
	require.NoError(t, supervisor.Watch(authorize))
	changed := proposalFor(t, c, "11:22:33:44:55:66", initial.Generation)
	result := make(chan any, 1)
	failure := make(chan error, 1)
	frame := configurationFrame(t, map[string]any{"transactionId": changed["transactionId"], "expectedGeneration": initial.Generation, "confirmed": true})
	go func() { value, err := c.Apply(ctx, frame); result <- value; failure <- err }()
	select {
	case <-signalled:
	case <-ctx.Done():
		t.Fatal("old worker was not stopped")
	}
	active, err := store.Read()
	require.NoError(t, err)
	assert.Equal(t, initial.Generation, active.Generation)
	select {
	case <-result:
		t.Fatal("commit crossed the revocation barrier")
	default:
	}
	// This control watch does not take Configuration's mutation lock. It remains
	// dispatchable while Apply waits for confirmed process and transport cleanup.
	revoke := authorize
	revoke.Type = "runtime.revoked"
	require.NoError(t, supervisor.Watch(revoke))
	select {
	case committed := <-result:
		assert.Equal(t, config.Applied, committed.(configurationResult).SaveOutcome)
		require.NoError(t, <-failure)
	case <-ctx.Done():
		t.Fatal("revocation failed to unblock commit")
	}
	active, err = store.Read()
	require.NoError(t, err)
	assert.Equal(t, changed["candidateGeneration"], active.Generation)
}

func TestImportConfigurationCaptureOwnerReplacementAndConcurrentPanels(t *testing.T) {
	c, store, _ := configurationFixture(t)
	source := t.TempDir()
	settingsPath := filepath.Join(source, "settings.json")
	presetsPath := filepath.Join(source, "presets.json")
	require.NoError(t, os.WriteFile(settingsPath, []byte(`{"device_identity":"AA:BB:CC:DD:EE:FF","port":23456,"access_token":"synthetic_access_token_123456789"}`), 0600))
	require.NoError(t, os.WriteFile(presetsPath, []byte(`{"custom":{"label":"Custom","rgb":[1,2,3],"brightness":0}}`), 0600))
	prepare := func(owner string) map[string]any {
		value, err := c.PrepareImport(t.Context(), configurationFrame(t, map[string]any{"ownerSession": owner, "settingsPath": settingsPath, "presetsPath": presetsPath, "expectedGeneration": nil}))
		require.NoError(t, err)
		return value.(map[string]any)
	}
	p := prepare("test-panel")
	other := prepare("other-panel")
	replacement := prepare("test-panel")
	_, err := c.Apply(t.Context(), configurationFrame(t, map[string]any{"transactionId": p["transactionId"], "expectedGeneration": nil, "confirmed": false}))
	assert.ErrorIs(t, err, Code("proposal_expired"))
	_, err = c.Apply(t.Context(), configurationFrame(t, map[string]any{"ownerSession": "other-panel", "transactionId": replacement["transactionId"], "expectedGeneration": nil, "confirmed": false}))
	assert.ErrorIs(t, err, Code("proposal_expired"))
	require.NoError(t, os.WriteFile(settingsPath, []byte("mutated after review"), 0600))
	require.NoError(t, os.Remove(presetsPath))
	result := applyFor(t, c, replacement, false)
	assert.Equal(t, config.Applied, result.SaveOutcome)
	active, err := store.Read()
	require.NoError(t, err)
	assert.Equal(t, "synthetic_access_token_123456789", active.Settings.AccessToken)
	assert.Len(t, active.Presets, 1)
	assert.Equal(t, 23456, active.Settings.Port)
	_, err = c.Apply(t.Context(), configurationFrame(t, map[string]any{"ownerSession": "other-panel", "transactionId": other["transactionId"], "expectedGeneration": nil, "confirmed": false}))
	assert.ErrorIs(t, err, Code("stale_configuration"))
	assert.Equal(t, result, applyFor(t, c, replacement, false))
}
func TestConfigurationRejectsMissingExpectedGenerationAndOwner(t *testing.T) {
	c, _, _ := configurationFixture(t)
	for _, raw := range []string{`{"identity":"AA:BB:CC:DD:EE:FF","ownerSession":"panel"}`, `{"identity":"AA:BB:CC:DD:EE:FF","expectedGeneration":null}`, `{"identity":"AA:BB:CC:DD:EE:FF","ownerSession":"panel","expectedGeneration":""}`} {
		_, err := c.PrepareManual(t.Context(), Frame{Payload: []byte(raw)})
		assert.ErrorIs(t, err, ProtocolIncompatible)
	}
}
func TestConfigurationNewPortConflictLeavesOldWorkerAndDataUntouched(t *testing.T) {
	supervisor, _, listeners, _ := baselineSupervisor(t)
	c, store, _ := configurationFixture(t)
	initial := applyFor(t, c, proposalFor(t, c, "AA:BB:CC:DD:EE:FF", nil), false)
	c.runtime = supervisor
	// A sentinel active run proves no Stop/Signal/revocation happens on conflict.
	run := &workerRun{binding: Binding{LaunchID: "old", ConfigurationGeneration: initial.Generation}}
	supervisor.active = run
	supervisor.status = RuntimeStatus{Binding: run.binding, State: Ready}
	t.Cleanup(func() { supervisor.mutex.Lock(); supervisor.active = nil; supervisor.mutex.Unlock() })
	p := proposalFor(t, c, "11:22:33:44:55:66", initial.Generation)
	c.proposals[p["transactionId"].(string)].Settings.Port = 23456
	listeners.EXPECT().Listen(23456).Return(nil, PortConflict)
	result := applyFor(t, c, p, true)
	assert.Equal(t, config.NotApplied, result.SaveOutcome)
	assert.Equal(t, PortConflict, result.RuntimeError)
	assert.Same(t, run, supervisor.active)
	assert.Equal(t, Ready, supervisor.Status().State)
	active, err := store.Read()
	require.NoError(t, err)
	assert.Equal(t, initial.Generation, active.Generation)
	assert.Equal(t, result, applyFor(t, c, p, true))
}
