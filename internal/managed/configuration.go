package managed

import (
	"context"
	"encoding/json/jsontext"
	"errors"
	"path/filepath"
	"sync"
	"time"

	"github.com/obalunenko/mergbw-controller/internal/config"
)

type manualProposal struct {
	*config.Proposal
	Result *configurationResult
}
type configurationResult struct {
	SaveOutcome       config.SaveOutcome `json:"saveOutcome"`
	Generation        string             `json:"generation"`
	ActiveStateKnown  bool               `json:"activeStateKnown"`
	DurabilityUnknown bool               `json:"durabilityUnknown"`
	RuntimeError      Code               `json:"runtimeError,omitempty"`
}

// Configuration composes canonical transactions with the process stop barrier.
// ControlServer serializes mutations; Watch and lifetime handling bypass it.
type Configuration struct {
	store     *config.ManagedStore
	runtime   *Supervisor
	directory string
	mutex     sync.Mutex
	proposals map[string]*manualProposal
	unknown   bool
}

func NewConfiguration(store *config.ManagedStore, runtime *Supervisor, directory string) *Configuration {
	return &Configuration{store: store, runtime: runtime, directory: directory, proposals: make(map[string]*manualProposal)}
}
func configurationError(err error) error {
	switch {
	case errors.Is(err, config.ErrStaleConfiguration):
		return Code("stale_configuration")
	case errors.Is(err, config.ErrInvalidConfiguration):
		return Code("invalid_configuration")
	case errors.Is(err, config.ErrImportMissing):
		return Code("import_missing")
	case errors.Is(err, config.ErrImportUnreadable):
		return Code("import_unreadable")
	case errors.Is(err, config.ErrImportSize):
		return Code("import_size")
	case errors.Is(err, config.ErrImportFile):
		return Code("import_file")
	default:
		return Code("storage_unavailable")
	}
}
func generation(active *config.Snapshot) string {
	if active == nil {
		return ""
	}
	return active.Generation
}
func (c *Configuration) Read(_ context.Context, frame Frame) (any, error) {
	var empty struct{}
	if err := DecodePayload(frame, &empty); err != nil {
		return nil, err
	}
	c.mutex.Lock()
	defer c.mutex.Unlock()
	active, err := c.store.Read()
	if err != nil {
		c.unknown = true
		return nil, configurationError(err)
	}
	c.unknown = false
	if active == nil {
		return map[string]any{"configured": false, "generation": nil}, nil
	}
	return map[string]any{"configured": true, "generation": active.Generation, "identity": active.Settings.DeviceIdentity, "port": active.Settings.Port, "hasToken": true, "presetCount": len(active.Presets), "connection": map[string]any{"port": active.Settings.Port, "accessToken": active.Settings.AccessToken}}, nil
}
func (c *Configuration) prepare(owner string, rawExpected jsontext.Value) (*config.Snapshot, string, error) {
	if !config.ValidOwner(owner) {
		return nil, "", ProtocolIncompatible
	}
	expected, err := config.ExpectedGeneration(rawExpected)
	if err != nil {
		return nil, "", ProtocolIncompatible
	}
	if c.unknown {
		return nil, "", Code("storage_unavailable")
	}
	active, err := c.store.Read()
	if err != nil {
		c.unknown = true
		return nil, "", configurationError(err)
	}
	if generation(active) != expected {
		return nil, "", Code("stale_configuration")
	}
	return active, expected, nil
}
func (c *Configuration) remember(proposal *config.Proposal) (any, error) {
	// Only one pending review per PI owner. Finished attempts remain bounded for
	// private read-back and idempotence, separate from the management session.
	now := time.Now()
	for id, p := range c.proposals {
		if !now.Before(p.Expires) || (p.Result == nil && p.Owner == proposal.Owner) {
			delete(c.proposals, id)
		}
	}
	if len(c.proposals) >= 64 {
		return nil, Code("control_busy")
	}
	c.proposals[proposal.ID] = &manualProposal{Proposal: proposal}
	var expected any
	if proposal.Expected != "" {
		expected = proposal.Expected
	}
	return map[string]any{"transactionId": proposal.ID, "candidateGeneration": proposal.Candidate, "expectedGeneration": expected, "identity": proposal.Settings.DeviceIdentity, "port": proposal.Settings.Port, "hasToken": true, "presetCount": len(proposal.Presets), "changed": proposal.Changed, "requiresConfirmation": proposal.Expected != "" && proposal.Changed, "diff": proposal.Diff, "changedFields": proposal.Diff, "expiresAt": proposal.Expires.UnixMilli()}, nil
}
func (c *Configuration) PrepareManual(_ context.Context, frame Frame) (any, error) {
	var request struct {
		Owner    string         `json:"ownerSession"`
		Identity string         `json:"identity"`
		Expected jsontext.Value `json:"expectedGeneration"`
		Legacy   *struct {
			Port  int    `json:"port"`
			Token string `json:"accessToken"`
		} `json:"legacyConnection"`
	}
	if err := DecodePayload(frame, &request); err != nil {
		return nil, err
	}
	c.mutex.Lock()
	defer c.mutex.Unlock()
	active, expected, err := c.prepare(request.Owner, request.Expected)
	if err != nil {
		return nil, err
	}
	var previous *config.Settings
	presets := config.DefaultPresets()
	if active != nil {
		previous = &active.Settings
		presets = active.Presets
	}
	candidate, err := config.PrepareManualSettings(request.Identity, previous)
	if err != nil {
		return nil, Code("invalid_identity")
	}
	if active == nil && request.Legacy != nil {
		candidate.Port = request.Legacy.Port
		candidate.AccessToken = request.Legacy.Token
		if candidate.Validate() != nil {
			return nil, Code("invalid_settings")
		}
	}
	proposal, err := config.PrepareProposal(request.Owner, expected, active, candidate, presets, time.Now())
	if err != nil {
		return nil, configurationError(err)
	}
	return c.remember(proposal)
}
func (c *Configuration) PrepareImport(_ context.Context, frame Frame) (any, error) {
	var request struct {
		Owner        string         `json:"ownerSession"`
		SettingsPath string         `json:"settingsPath"`
		PresetsPath  string         `json:"presetsPath"`
		Expected     jsontext.Value `json:"expectedGeneration"`
	}
	if err := DecodePayload(frame, &request); err != nil {
		return nil, err
	}
	c.mutex.Lock()
	defer c.mutex.Unlock()
	active, expected, err := c.prepare(request.Owner, request.Expected)
	if err != nil {
		return nil, err
	}
	candidate, err := config.CaptureImport(request.SettingsPath, request.PresetsPath, active)
	if err != nil {
		return nil, configurationError(err)
	}
	proposal, err := config.PrepareProposal(request.Owner, expected, active, candidate.Settings, candidate.Presets, time.Now())
	if err != nil {
		return nil, configurationError(err)
	}
	return c.remember(proposal)
}
func (c *Configuration) Apply(ctx context.Context, frame Frame) (any, error) {
	var request struct {
		Owner       string         `json:"ownerSession"`
		Transaction string         `json:"transactionId"`
		Expected    jsontext.Value `json:"expectedGeneration"`
		Confirmed   bool           `json:"confirmed"`
	}
	if err := DecodePayload(frame, &request); err != nil {
		return nil, err
	}
	expected, err := config.ExpectedGeneration(request.Expected)
	if err != nil || !config.ValidOwner(request.Owner) || !ValidID(request.Transaction) {
		return nil, ProtocolIncompatible
	}
	c.mutex.Lock()
	defer c.mutex.Unlock()
	p := c.proposals[request.Transaction]
	if p == nil || p.Owner != request.Owner {
		return nil, Code("proposal_expired")
	}
	if expected != p.Expected {
		return nil, Code("stale_configuration")
	}
	if p.Result != nil {
		return *p.Result, nil
	}
	if !time.Now().Before(p.Expires) {
		return nil, Code("proposal_expired")
	}
	if c.unknown {
		return nil, Code("storage_unavailable")
	}
	active, err := c.store.Read()
	if err != nil {
		c.unknown = true
		return nil, configurationError(err)
	}
	if generation(active) != expected {
		return nil, Code("stale_configuration")
	}
	result := configurationResult{SaveOutcome: config.NotApplied, Generation: expected, ActiveStateKnown: true}
	if !p.Changed {
		result.SaveOutcome = config.Unchanged
		p.Result = &result
		return result, nil
	}
	if active != nil && !request.Confirmed {
		return nil, Code("confirmation_required")
	}
	// Past this point an attempted transaction is never automatically reapplied.
	defer func() { p.Result = &result }()
	var reservation *Reservation
	if c.runtime != nil {
		reservation, err = c.runtime.reserveReplacement(p.Settings.Port)
		if err != nil {
			result.RuntimeError = safeCode(err)
			return result, nil
		}
		defer func() {
			if reservation != nil {
				_ = reservation.Close()
			}
		}()
	}
	staged, err := c.store.Stage(p.Candidate, p.ID, p.Settings, p.Presets)
	if err != nil {
		return result, nil
	}
	if c.runtime != nil {
		if err = c.runtime.Stop(ctx, false); err != nil {
			result.RuntimeError = CleanupFailed
			return result, nil
		}
	}
	if ctx.Err() != nil {
		return result, nil
	}
	committed, commitErr := c.store.Commit(*staged, expected)
	if committed.Outcome == "" {
		if commitErr != nil {
			return result, nil
		}
		return result, nil
	}
	result = configurationResult{SaveOutcome: committed.Outcome, Generation: committed.Generation, ActiveStateKnown: committed.ActiveStateKnown, DurabilityUnknown: committed.DurabilityUnknown}
	c.unknown = !result.ActiveStateKnown
	if result.SaveOutcome == config.Applied && c.runtime != nil {
		if err = c.runtime.adoptReservation(reservation, p.Settings.Port); err != nil {
			result.RuntimeError = safeCode(err)
		} else {
			reservation = nil
		}
	}
	return result, nil
}
func (c *Configuration) Cancel(_ context.Context, frame Frame) (any, error) {
	var request struct {
		Owner       string `json:"ownerSession"`
		Transaction string `json:"transactionId"`
	}
	if err := DecodePayload(frame, &request); err != nil {
		return nil, err
	}
	if !config.ValidOwner(request.Owner) || !ValidID(request.Transaction) {
		return nil, ProtocolIncompatible
	}
	c.mutex.Lock()
	defer c.mutex.Unlock()
	if p := c.proposals[request.Transaction]; p != nil && p.Owner == request.Owner && p.Result == nil {
		delete(c.proposals, request.Transaction)
	}
	return struct{}{}, nil
}
func (c *Configuration) Check(_ context.Context, frame Frame) (any, error) {
	var request struct {
		Owner       string `json:"ownerSession"`
		Transaction string `json:"transactionId"`
	}
	if err := DecodePayload(frame, &request); err != nil {
		return nil, err
	}
	if !config.ValidOwner(request.Owner) || !ValidID(request.Transaction) {
		return nil, ProtocolIncompatible
	}
	c.mutex.Lock()
	defer c.mutex.Unlock()
	p := c.proposals[request.Transaction]
	if p == nil || p.Owner != request.Owner {
		return nil, Code("proposal_expired")
	}
	checked := c.store.CheckOutcome(p.Candidate, p.Expected)
	result := configurationResult{SaveOutcome: checked.Outcome, Generation: checked.Generation, ActiveStateKnown: checked.ActiveStateKnown}
	if p.Result != nil && p.Result.SaveOutcome == config.Unchanged && checked.ActiveStateKnown {
		result.SaveOutcome = config.Unchanged
	}
	c.unknown = !result.ActiveStateKnown
	return result, nil
}
func (c *Configuration) Launch(ctx context.Context, expected string, restart bool) (any, error) {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	if c.unknown {
		return nil, Code("storage_unavailable")
	}
	active, err := c.store.Read()
	if err != nil {
		c.unknown = true
		return nil, configurationError(err)
	}
	if active == nil {
		return nil, Code("unconfigured")
	}
	if expected != active.Generation {
		return nil, Code("stale_configuration")
	}
	if restart {
		if err := c.runtime.Stop(ctx, false); err != nil {
			return nil, err
		}
	}
	return c.runtime.Start(ctx, LaunchConfiguration{Generation: active.Generation, Directory: filepath.Join(c.directory, "generations", active.Generation), Port: active.Settings.Port})
}
