# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-21)

**Core value:** Take a schedule template and real-world constraints, produce the best possible timed plan
**Current focus:** v0.0.6 Output & Overrides milestone

## Current Position

Phase: 12 of 13 (Dependency Arrows) — COMPLETE
Plan: 1 of 1 in current phase
Status: All v0.0.6 phases complete — Phase 12 (Dependency Arrows) is the final phase
Last activity: 2026-02-21 — Completed 12-01-PLAN.md (--arrows connector rendering)

Progress: [██████████] 4/4 phases complete (v0.0.6 milestone — all phases done)

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Full v1.0 history archived in milestones/v1.0-ROADMAP.md.
Full v0.1.1 history archived in milestones/v0.1.1-ROADMAP.md.

**Phase 11 decisions:**
- `-r/--resource` uses Commander collect() for repeatable flags (not comma-separated)
- Decimal override values Math.round()ed to integer for Rust engine (u32)
- Duplicate flag warns stderr, uses last value (not error)
- Resource table uses ASCII ` -> ` arrow notation, not Unicode
- Resource table position: after warnings section
- Consumable fixture uses FinishToStart sequential steps so remaining is predictable (200-120=80)
- `consumable_remaining` reads from `resource_capacity` (post-override) not `r.capacity` (raw template value)

**Phase 13 decisions:**
- Bottleneck resource = non-consumable with highest sum(stepDurationMins * quantityUsed) across critical-path steps. Consumables excluded.
- Time savings heuristic: longest critical-path step using bottleneck resource if >= 5 min.
- `--output` flag omitted from reconstructed commands (file-output suppresses suggestions).
- `resolvedResourceOverrides` Map takes priority over parsing `options.resource` strings (defensive compatibility).
- Tip selection: top 2 by relevance score, third by `totalDurationMins % remainingTips.length` for deterministic rotation.

**Phase 12 decisions:**
- Horizontal arms extend rightward through empty space (not leftward through bar content)
- Connector turns appear only on bar rows (second line of each step pair), not header rows
- Track separator rows get GUTTER_WIDTH space prefix + reduced fill length (total = termWidth)
- No density cap: render all edges; cross chars handle overflow when > 2 lanes needed
- chunkRow tracking: 3 rows per step (header+bar+blank) + 1 per non-empty track separator

### Pending Todos

None.

### Blockers/Concerns

- npm platform package binary (`@skejj/engine-darwin-arm64`) needs to be updated when publishing new releases — it cached the pre-RES-04 binary in node_modules.
- v0.0.6 milestone is complete — all 4 phases (10, 11, 12, 13) done. Ready to bump version and release.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 001 | Live-update Gantt chart in AdjustApp and increase visible Select options | 2026-02-19 | c384279 | [001-live-gantt-and-visible-select-options](./quick/001-live-gantt-and-visible-select-options/) |
| 002 | Add npm metadata (license, author, repository, keywords) and MIT LICENSE file | 2026-02-21 | 78b0ab1 | [002-publish-to-npm](./quick/002-publish-to-npm/) |
| 003 | Review build changes, fix linux-arm64 platform map, deploy v0.1.0 | 2026-02-21 | 834e49d | [003-review-build-deploy-v010](./quick/003-review-build-deploy-v010/) |
| 004 | Reset all versions to 0.0.1, delete v0.1.0 tag, push v0.0.1 to trigger release | 2026-02-21 | 1b11b56 | [004-fix-npm-publish-reset-to-v0-0-1](./quick/004-fix-npm-publish-reset-to-v0-0-1/) |

## Session Continuity

Last session: 2026-02-21
Stopped at: Phase 12 complete — all v0.0.6 phases done, 40 tests passing
Resume file: None
Next action: `/gsd:new-milestone` to plan v0.0.6 release or next milestone
