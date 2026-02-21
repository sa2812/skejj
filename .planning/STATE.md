# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-21)

**Core value:** Take a schedule template and real-world constraints, produce the best possible timed plan
**Current focus:** v0.0.6 Output & Overrides milestone

## Current Position

Phase: 11-resource-overrides (Plan 02 of 2 complete)
Plan: 11-02 complete
Status: Phase 11 fully complete — all plans executed and verified
Last activity: 2026-02-21 — Completed 11-02-PLAN.md (resource CLI flag, table rendering, E2E tests)

Progress: [██████░░░░] 3/4 phases (v0.0.6 milestone)

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Full v1.0 history archived in milestones/v1.0-ROADMAP.md.
Full v0.1.1 history archived in milestones/v0.1.1-ROADMAP.md.

**Phase 11-02 key decisions:**
- `-r/--resource` uses Commander collect() for repeatable flags (not comma-separated)
- Decimal override values Math.round()ed to integer for Rust engine (u32)
- Duplicate flag warns stderr, uses last value (not error)
- Resource table uses ASCII ` -> ` arrow notation, not Unicode
- Resource table position: after warnings section
- Consumable fixture uses FinishToStart sequential steps so remaining is predictable (200-120=80)

### Pending Todos

None.

### Blockers/Concerns

- npm platform package binary (`@skejj/engine-darwin-arm64`) needs to be updated when publishing new releases — it cached the pre-RES-04 binary in node_modules. Current development works because the local file was updated. But running `npm install` fresh would pull the old binary again until a new release is published.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 001 | Live-update Gantt chart in AdjustApp and increase visible Select options | 2026-02-19 | c384279 | [001-live-gantt-and-visible-select-options](./quick/001-live-gantt-and-visible-select-options/) |
| 002 | Add npm metadata (license, author, repository, keywords) and MIT LICENSE file | 2026-02-21 | 78b0ab1 | [002-publish-to-npm](./quick/002-publish-to-npm/) |
| 003 | Review build changes, fix linux-arm64 platform map, deploy v0.1.0 | 2026-02-21 | 834e49d | [003-review-build-deploy-v010](./quick/003-review-build-deploy-v010/) |
| 004 | Reset all versions to 0.0.1, delete v0.1.0 tag, push v0.0.1 to trigger release | 2026-02-21 | 1b11b56 | [004-fix-npm-publish-reset-to-v0-0-1](./quick/004-fix-npm-publish-reset-to-v0-0-1/) |

## Session Continuity

Last session: 2026-02-21T22:30:00Z
Stopped at: Completed 11-02-PLAN.md (all 3 tasks done, 40/40 tests passing)
Resume file: None
Next action: Phase 12 (multi-day scheduling) or Phase 13 (suggestions) — check ROADMAP.md for v0.0.6 remaining phases
