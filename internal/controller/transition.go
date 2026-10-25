package controller

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/obalunenko/mergbw-controller/internal/logging"
	"github.com/obalunenko/mergbw-controller/internal/protocol"
)

type transitionJob struct {
	snapshot protocol.TransitionSnapshot
	cancel   context.CancelFunc
	done     chan struct{}
	started  time.Time
	effect   *protocol.EffectAction
}

// admit atomically cancels the active job and claims its execution gate.
func (c *Controller) admit(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-c.admission:
	}
	defer func() { c.admission <- struct{}{} }()
	if err := ctx.Err(); err != nil {
		return err
	}
	if c.closed.Load() || c.root.Err() != nil {
		return fmt.Errorf("контроллер остановлен")
	}
	c.cancelActive()
	return c.acquireForCommand(ctx)
}

func (c *Controller) acquireForCommand(ctx context.Context) error {
	waitCtx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(c.root, cancel)
	defer stop()
	defer cancel()
	err := c.acquire(waitCtx)
	if err != nil {
		if c.closed.Load() {
			return fmt.Errorf("контроллер остановлен")
		}
		if c.root.Err() != nil {
			return c.root.Err()
		}
		return err
	}
	if c.closed.Load() || c.root.Err() != nil {
		c.release()
		return fmt.Errorf("контроллер остановлен")
	}
	return nil
}

func (c *Controller) cancelActive() {
	c.transitionMu.Lock()
	defer c.transitionMu.Unlock()
	if job := c.active; job != nil && (job.snapshot.State == "running" || job.snapshot.State == "cancelling") {
		job.snapshot.State = "cancelling"
		job.cancel()
	}
}

func (c *Controller) StartTransition(ctx context.Context, spec protocol.Transition) (protocol.TransitionSnapshot, error) {
	if err := spec.Validate(); err != nil {
		return protocol.TransitionSnapshot{}, err
	}
	return c.startJob(ctx, spec.Duration().Milliseconds(), nil, func(jobCtx context.Context, job *transitionJob) {
		c.runTransition(jobCtx, job, spec)
	})
}

func (c *Controller) startJob(ctx context.Context, durationMS int64, effect *protocol.EffectAction, run func(context.Context, *transitionJob)) (protocol.TransitionSnapshot, error) {
	// Retain admission until publication so another command cannot miss this job.
	select {
	case <-ctx.Done():
		return protocol.TransitionSnapshot{}, ctx.Err()
	case <-c.admission:
	}
	defer func() { c.admission <- struct{}{} }()
	if err := ctx.Err(); err != nil {
		return protocol.TransitionSnapshot{}, err
	}
	if c.closed.Load() || c.root.Err() != nil {
		return protocol.TransitionSnapshot{}, fmt.Errorf("контроллер остановлен")
	}
	c.cancelActive()
	if err := c.acquireForCommand(ctx); err != nil {
		return protocol.TransitionSnapshot{}, err
	}
	if c.closed.Load() || c.root.Err() != nil {
		c.release()
		return protocol.TransitionSnapshot{}, fmt.Errorf("контроллер остановлен")
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		c.release()
		return protocol.TransitionSnapshot{}, err
	}
	jobCtx, cancel := context.WithCancel(c.root)
	job := &transitionJob{snapshot: protocol.TransitionSnapshot{ID: hex.EncodeToString(id[:]), State: "running", DurationMS: durationMS}, cancel: cancel, done: make(chan struct{}), effect: effect}
	snapshot := job.snapshot
	c.transitionMu.Lock()
	c.active = job
	if effect == nil {
		c.transition = job
	} else {
		c.effect = job
	}
	c.transitionMu.Unlock()
	if effect == nil {
		logging.FromContext(c.root).Info("transition.accepted", "component", "controller", "transition_id", snapshot.ID, "duration_ms", snapshot.DurationMS, "physical_state_verified", false)
	} else {
		logging.FromContext(c.root).Info("effect.accepted", "component", "controller", "effect_id", snapshot.ID, "kind", effect.Preset.Effect.Kind, "duration_ms", effect.DurationMS(), "physical_state_verified", false)
	}
	go run(jobCtx, job)
	return snapshot, nil
}

func (c *Controller) snapshotLocked(job *transitionJob) protocol.TransitionSnapshot {
	snapshot := job.snapshot
	if !job.started.IsZero() && (snapshot.State == "running" || snapshot.State == "cancelling") {
		snapshot.ElapsedMS = max(int64(0), c.now().Sub(job.started).Milliseconds())
		if job.effect == nil {
			snapshot.ElapsedMS = min(snapshot.DurationMS, snapshot.ElapsedMS)
		}
	}
	return snapshot
}

func (c *Controller) TransitionStatus() *protocol.TransitionSnapshot {
	c.transitionMu.Lock()
	defer c.transitionMu.Unlock()
	if c.transition == nil {
		return nil
	}
	snapshot := c.snapshotLocked(c.transition)
	return &snapshot
}

func (c *Controller) CancelTransition(ctx context.Context, id string) (protocol.TransitionSnapshot, error) {
	if err := ctx.Err(); err != nil {
		return protocol.TransitionSnapshot{}, err
	}
	c.transitionMu.Lock()
	job := c.transition
	if job == nil || job.snapshot.ID != id {
		c.transitionMu.Unlock()
		return protocol.TransitionSnapshot{}, protocol.ErrTransitionNotFound
	}
	if job.snapshot.State == "running" || job.snapshot.State == "cancelling" {
		job.snapshot.State = "cancelling"
		job.cancel()
	}
	c.transitionMu.Unlock()
	select {
	case <-ctx.Done():
		return protocol.TransitionSnapshot{}, ctx.Err()
	case <-job.done:
		c.transitionMu.Lock()
		snapshot := c.snapshotLocked(job)
		c.transitionMu.Unlock()
		return snapshot, nil
	}
}

func (c *Controller) runTransition(ctx context.Context, job *transitionJob, spec protocol.Transition) {
	defer close(job.done)
	defer c.release()
	defer job.cancel()
	state := "cancelled"
	defer func() { c.finishJob(job, state) }()
	if err := ctx.Err(); err != nil {
		return
	}
	if err := c.link.Connect(ctx); err != nil {
		if ctx.Err() == nil {
			state = "failed"
		}
		return
	}
	write := func(frame []byte) bool { return c.writeJobFrame(ctx, frame, &state) }
	for _, frame := range spec.InitialPackets() {
		if !write(frame) {
			return
		}
	}
	started := c.now()
	c.transitionMu.Lock()
	job.started = started
	c.transitionMu.Unlock()
	previousRGB, previousBrightness := spec.FromRGB, spec.FromBrightness
	next := 250 * time.Millisecond
	for {
		if err := c.pause(ctx, max(time.Duration(0), next-c.now().Sub(started))); err != nil {
			return
		}
		elapsed := c.now().Sub(started)
		rgb, brightness := spec.Sample(elapsed)
		frames := protocol.TransitionPackets(rgb, brightness)
		if rgb != previousRGB {
			if !write(frames[0]) {
				return
			}
			previousRGB = rgb
		}
		if brightness != previousBrightness {
			if !write(frames[1]) {
				return
			}
			previousBrightness = brightness
		}
		if elapsed >= spec.Duration() {
			state = "completed"
			return
		}
		// Schedule from now after slow writes, not a burst of overdue samples.
		next = max(next+250*time.Millisecond, c.now().Sub(started)+250*time.Millisecond)
	}
}

func (c *Controller) writeJobFrame(ctx context.Context, frame []byte, state *string) bool {
	if err := c.pause(ctx, time.Until(c.lastWrite.Add(c.gap))); err != nil {
		return false
	}
	if err := ctx.Err(); err != nil {
		return false
	}
	err := c.link.Write(ctx, frame)
	c.lastWrite = time.Now()
	if err != nil || ctx.Err() != nil {
		*state = "unknown"
		return false
	}
	return true
}

func (c *Controller) finishJob(job *transitionJob, state string) {
	c.transitionMu.Lock()
	job.snapshot = c.snapshotLocked(job)
	job.snapshot.State = state
	if state == "completed" && job.effect == nil {
		job.snapshot.ElapsedMS = job.snapshot.DurationMS
	}
	snapshot := job.snapshot
	c.transitionMu.Unlock()
	if job.effect == nil {
		logging.FromContext(c.root).Info("transition.finished", "component", "controller", "transition_id", snapshot.ID, "state", state, "duration_ms", snapshot.DurationMS, "elapsed_ms", snapshot.ElapsedMS, "physical_state_verified", false)
	} else {
		logging.FromContext(c.root).Info("effect.finished", "component", "controller", "effect_id", snapshot.ID, "state", state, "elapsed_ms", snapshot.ElapsedMS, "physical_state_verified", false)
	}
}
