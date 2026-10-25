package controller

import (
	"context"
	"math"
	"time"

	"github.com/obalunenko/mergbw-controller/internal/protocol"
)

// Lightning flash timing, confirmed on the LT-06 in
// specs/010-lightning-effect/hardware-verification.md. Every write still waits
// for the shared packet gap, so real edges are longer.
const (
	lightningMinHold, lightningMaxHold = 100 * time.Millisecond, 180 * time.Millisecond
	lightningMinGap, lightningMaxGap   = 60 * time.Millisecond, 250 * time.Millisecond
	lightningMinIntensity              = 0.7
)

func (c *Controller) StartEffect(ctx context.Context, action protocol.EffectAction) (protocol.EffectSnapshot, error) {
	if err := action.Validate(); err != nil {
		return protocol.EffectSnapshot{}, err
	}
	action.Preset = protocol.ClonePreset(action.Preset)
	var durationMS int64
	if duration := action.DurationMS(); duration != nil {
		durationMS = *duration
	}
	accepted, err := c.startJob(ctx, durationMS, &action, func(jobCtx context.Context, job *transitionJob) {
		c.runEffect(jobCtx, job, action)
	})
	if err != nil {
		return protocol.EffectSnapshot{}, err
	}
	return effectSnapshot(accepted, action), nil
}

func effectSnapshot(snapshot protocol.TransitionSnapshot, action protocol.EffectAction) protocol.EffectSnapshot {
	return protocol.EffectSnapshot{ID: snapshot.ID, PresetID: action.PresetID, Kind: action.Preset.Effect.Kind,
		State: snapshot.State, ElapsedMS: snapshot.ElapsedMS, DurationMS: action.DurationMS()}
}

func (c *Controller) EffectStatus() *protocol.EffectSnapshot {
	c.transitionMu.Lock()
	defer c.transitionMu.Unlock()
	if c.effect == nil {
		return nil
	}
	snapshot := effectSnapshot(c.snapshotLocked(c.effect), *c.effect.effect)
	return &snapshot
}

func (c *Controller) CancelEffect(ctx context.Context, id string) (protocol.EffectSnapshot, error) {
	if err := ctx.Err(); err != nil {
		return protocol.EffectSnapshot{}, err
	}
	c.transitionMu.Lock()
	job := c.effect
	if job == nil || job.snapshot.ID != id {
		c.transitionMu.Unlock()
		return protocol.EffectSnapshot{}, protocol.ErrEffectNotFound
	}
	if job.snapshot.State == "running" || job.snapshot.State == "cancelling" {
		job.snapshot.State = "cancelling"
		job.cancel()
	}
	c.transitionMu.Unlock()
	select {
	case <-ctx.Done():
		return protocol.EffectSnapshot{}, ctx.Err()
	case <-job.done:
		c.transitionMu.Lock()
		snapshot := effectSnapshot(c.snapshotLocked(job), *job.effect)
		c.transitionMu.Unlock()
		return snapshot, nil
	}
}

func (c *Controller) runEffect(ctx context.Context, job *transitionJob, action protocol.EffectAction) {
	defer close(job.done)
	defer c.release()
	defer job.cancel()
	state := "cancelled"
	defer func() { c.finishJob(job, state) }()
	if ctx.Err() != nil {
		return
	}
	if err := c.link.Connect(ctx); err != nil {
		if ctx.Err() == nil {
			state = "failed"
		}
		return
	}
	preset, effect := action.Preset, action.Preset.Effect
	rgb, brightness := [3]int(preset.RGB), preset.Brightness
	random := func() float64 { return min(1.0, max(0.0, c.random())) }
	scale := func(color []int, factor float64) [3]int {
		var out [3]int
		for i := range out {
			out[i] = int(math.Round(float64(color[i]) * factor))
		}
		return out
	}
	switch effect.Kind {
	case "breathing":
		brightness = effect.MinBrightness
	case "lightning":
		// The brightness register stays at the flash level, so each edge is
		// one color packet and the background is a dimmed color.
		rgb = scale(effect.BackgroundRGB, float64(effect.BackgroundBrightness)/float64(preset.Brightness))
	}
	write := func(frame []byte) bool { return c.writeJobFrame(ctx, frame, &state) }
	initial := protocol.Transition{FromRGB: rgb, FromBrightness: brightness}
	for _, frame := range initial.InitialPackets() {
		if !write(frame) {
			return
		}
	}
	c.transitionMu.Lock()
	job.started = c.now()
	started := job.started
	c.transitionMu.Unlock()
	// Each segment starts after the previous endpoint write has drained. Slow
	// writes stretch playback rather than skipping endpoints or causing bursts.
	segment := func(toRGB [3]int, toBrightness int, duration time.Duration, deadline *time.Time) bool {
		fromRGB, fromBrightness := rgb, brightness
		segmentStart := c.now()
		next := min(250*time.Millisecond, duration)
		for {
			if err := c.pause(ctx, max(time.Duration(0), next-c.now().Sub(segmentStart))); err != nil {
				return false
			}
			if deadline != nil && c.now().After(*deadline) {
				return ctx.Err() == nil
			}
			elapsed := c.now().Sub(segmentStart)
			fraction := min(1.0, max(0.0, float64(elapsed)/float64(duration)))
			interpolate := func(from, to int) int {
				return int(math.Round(float64(from) + float64(to-from)*fraction))
			}
			var sampledRGB [3]int
			for i := range sampledRGB {
				sampledRGB[i] = interpolate(fromRGB[i], toRGB[i])
			}
			sampledBrightness := interpolate(fromBrightness, toBrightness)
			frames := protocol.TransitionPackets(sampledRGB, sampledBrightness)
			if sampledRGB != rgb {
				if !write(frames[0]) {
					return false
				}
				rgb = sampledRGB
			}
			if sampledBrightness != brightness {
				if !write(frames[1]) {
					return false
				}
				brightness = sampledBrightness
			}
			if elapsed >= duration {
				return true
			}
			next = min(duration, max(next+250*time.Millisecond, c.now().Sub(segmentStart)+250*time.Millisecond))
		}
	}
	milliseconds := func(value int) time.Duration { return time.Duration(value) * time.Millisecond }
	switch effect.Kind {
	case "palette":
		for {
			for _, color := range effect.Colors {
				if !segment([3]int(color), preset.Brightness, milliseconds(effect.TransitionMS), nil) {
					return
				}
			}
			if !effect.Loop {
				break
			}
			if !segment([3]int(preset.RGB), preset.Brightness, milliseconds(effect.TransitionMS), nil) {
				return
			}
		}
	case "strobe":
		off, _ := protocol.Resolve([]string{"off"}, nil)
		on := initial.InitialPackets()[0]
		for {
			if c.pause(ctx, milliseconds(effect.OnMS)) != nil || !write(off.Packets[0]) || c.pause(ctx, milliseconds(effect.OffMS)) != nil {
				return
			}
			if !effect.Loop {
				break
			}
			if !write(on) {
				return
			}
		}
	case "breathing":
		cycle := milliseconds(effect.CycleMS)
		for {
			if !segment(rgb, preset.Brightness, cycle/2, nil) || !segment(rgb, effect.MinBrightness, cycle-cycle/2, nil) {
				return
			}
			if !effect.Loop {
				break
			}
		}
	case "candle":
		var deadline *time.Time
		if !effect.Loop {
			deadline = new(started.Add(milliseconds(effect.DurationMS)))
		}
		for deadline == nil || c.now().Before(*deadline) {
			duration := milliseconds(effect.FlickerMS)
			if deadline != nil {
				duration = min(duration, deadline.Sub(c.now()))
			}
			target := preset.Brightness
			if preset.Brightness > 0 && effect.Depth > 0 {
				fraction := random()
				target = int(math.Round(float64(preset.Brightness) * (1 - float64(effect.Depth)/100*fraction*fraction)))
			}
			if !segment(rgb, min(100, max(0, target)), duration, deadline) {
				return
			}
		}
	case "lightning":
		var deadline *time.Time
		if !effect.Loop {
			deadline = new(started.Add(milliseconds(effect.DurationMS)))
		}
		background := protocol.TransitionPackets(rgb, brightness)[0]
		draw := func(low, high time.Duration) time.Duration { return low + time.Duration(random()*float64(high-low)) }
		// wait sits on the background for a random delay clipped to the
		// deadline, and reports whether another strike or flash may follow.
		wait := func(low, high time.Duration) bool {
			if deadline != nil && !c.now().Before(*deadline) {
				return false
			}
			delay := draw(low, high)
			if deadline != nil {
				delay = min(delay, deadline.Sub(c.now()))
			}
			return c.pause(ctx, delay) == nil && (deadline == nil || c.now().Before(*deadline))
		}
		// Draw order: pause and flash count per strike; then gap (from the
		// second flash), intensity and hold per flash.
	storm:
		for wait(milliseconds(effect.MinPauseMS), milliseconds(effect.MaxPauseMS)) {
			flashes := min(effect.MaxFlashes, 1+int(random()*float64(effect.MaxFlashes)))
			for i := range flashes {
				if i > 0 && !wait(lightningMinGap, lightningMaxGap) {
					break storm
				}
				flash := scale(preset.RGB, lightningMinIntensity+(1-lightningMinIntensity)*random())
				// A started flash always returns to the background, even past the deadline.
				if !write(protocol.TransitionPackets(flash, brightness)[0]) || c.pause(ctx, draw(lightningMinHold, lightningMaxHold)) != nil || !write(background) {
					return
				}
			}
		}
	}
	if ctx.Err() == nil {
		state = "completed"
	}
}
