# Implementation Plan: [FEATURE]

**Feature Directory**: `specs/[NNN-feature-name]` | **Branch**: [Current branch, if applicable]

**Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[NNN-feature-name]/spec.md`

**Note**: This template is filled in by the `$speckit-plan` command; its definition describes the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

**Language/Version**: Go 1.27.0+ for the controller and the separate
`tools/task/` and `tools/mockgen/` modules. Python 3.11+ and Bash support local
Spec Kit tooling.

**Primary Dependencies**: Standard library plus `tinygo.org/x/bluetooth v0.16.0`;
Task 3.54.0 in the separate tools module. [List feature-specific changes.]

**Storage**: JSON settings/presets and generated Stream Deck URLs. [Affected
fields, compatibility, or N/A; no database is currently present.]

**Testing**: Go `testing`, `httptest`, table-driven tests, and fake `Link` /
`Controller` implementations. [Relevant colocated test files.]

**Target Platform**: macOS/CoreBluetooth with CGO and Xcode tools; Linux is the
secondary build and automated-test target. [Feature-specific platform scope.]

**Project Type**: Single-process CLI and loopback HTTP-to-BLE service, with a
separate development-tools module.

**Performance Goals**: [Feature-specific measurable goals or N/A; no general
throughput or latency SLO is established.]

**Constraints**: One BLE connection, serialized whole actions, cooperative
native-operation cancellation, preserved settings/tokens, and no unsupported
physical-state claims. [Explain applicable constraints.]

**Scale/Scope**: One local controller and configured lamp. [Feature scope.]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [ ] Changes stay within the documented package/module responsibilities;
      interface or dependency changes are explained.
- [ ] CLI/HTTP, configuration, token, and URL compatibility are addressed.
- [ ] BLE ordering, retry, cancellation, and device-verification effects are
      addressed where relevant; otherwise mark N/A with a reason.
- [ ] Diagnostic changes preserve request context and secret redaction.
- [ ] Validation matches the affected code and platform; Spec Kit checks remain
      local and are not added to CI.

## Project Structure

### Documentation (this feature)

```text
specs/[NNN-feature-name]/
├── plan.md              # This file ($speckit-plan command output)
├── research.md          # Phase 0 output ($speckit-plan command)
├── data-model.md        # Phase 1 output ($speckit-plan command)
├── quickstart.md        # Phase 1 output ($speckit-plan command)
├── contracts/           # Phase 1 output ($speckit-plan command)
└── tasks.md             # Phase 2 output ($speckit-tasks command - NOT created by $speckit-plan)
```

### Source Code (repository root)
```text
cmd/sunset/main.go         # CLI and composition root
internal/
├── bridge/                # HTTP handler and Controller interface
├── controller/            # Serialized actions and Link interface
├── protocol/              # Packet encoding and action validation
├── ble/                   # Native transport and connection lifecycle
├── config/                # Settings, presets, and URLs
└── logging/               # Context logger and secret redaction
tools/task/go.mod          # Pinned development tool module
scripts/                   # Local workflow and Spec Kit checks
.speckit/feature-numbering/ # Local feature-directory hook source
Taskfile.yml               # Setup, launch, and development workflows
Makefile                   # Tool installation only
```

**Structure Decision**: [List the exact files affected. Use existing packages;
explain new packages, dependencies, or cross-boundary changes.]

## Implementation by Affected Boundary

1. **Protocol and configuration**: [Validation, packet/data changes, compatibility,
   and relevant colocated tests; omit if unaffected.]
2. **Controller and BLE**: [Interface, sequencing, retry, cancellation, connection
   lifetime, and hardware checks; omit if unaffected.]
3. **HTTP, CLI, and logging**: [Contracts, lifecycle, context, and redaction;
   omit if unaffected.]
4. **Tooling and documentation**: [Separate module/pin changes, Taskfile,
   scripts, and both READMEs; omit if unaffected.]

Order only the boundaries required by this feature. Do not create phases for
unrelated packages or reinitialize infrastructure that already exists.

## Validation Plan

- Core checks on macOS: `task test:core` and relevant `task test:race` coverage.
- Static/build checks as applicable: `task vet` and `task build`.
- Linux full validation: `task check` (test, race, vet, build).
- Go formatting: [Exact changed Go paths to format with gofmt.]
- Local Spec Kit changes only: `task speckit:update:test` and installer syntax
  checks when affected. Do not add these tasks to CI or `task check`.
- Device checks: [Exact LT-06 steps, expected visible effect, platform,
  observed result, and pending verification; N/A if no hardware effect.]

Full tests and CLI execution can initialize CoreBluetooth on macOS. A build
or fake-backed test does not verify physical lamp behavior.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [Specific departure from a project rule, if any] | [Feature need] | [Reason] |
