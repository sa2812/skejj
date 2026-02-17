# skejj

## What This Is

A CLI tool for constraint-based scheduling. Users define schedule templates with steps, dependencies, and resource requirements, then feed in their actual constraints (equipment capacity, available people, consumables) to produce an optimized, timed plan. Think "recipe that adapts to your kitchen" — but for any task-based workflow.

## Core Value

Take a schedule template and a set of real-world constraints, and produce the best possible timed plan — telling you when to start each step, what's on the critical path, and what resources are needed when.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Define schedules as steps with durations, dependencies, and resource requirements organized into tracks
- [ ] Constraint-based scheduling engine that respects resource limits (e.g. oven with 3 spaces, 2 people available)
- [ ] Critical path analysis — identify longest dependency chain, calculate slack per step
- [ ] Forward scheduling — given a start time, calculate when everything finishes
- [ ] Backward scheduling — given a deadline, calculate when each step must start
- [ ] ASAP/ALAP timing policies per step
- [ ] Partial information support — minimum input is steps + durations, everything else has sensible defaults
- [ ] Schedule validation — warn on missing info, error on resource conflicts or impossible constraints
- [ ] JSON file input for schedule definitions
- [ ] Interactive CLI mode for building schedules through guided prompts
- [ ] AI-powered schedule generation from natural language descriptions (configurable LLM provider)
- [ ] Interactive schedule adjustment mode for tweaking timings and seeing results
- [ ] Export: JSON, Mermaid Gantt, ASCII table, JPG, PDF, CSV/Excel
- [ ] Resource types: equipment (with capacity), consumables (with quantities), people (with availability)
- [ ] Example schedules: roast chicken dinner, 10-year-old's football-themed birthday party, 2-day London sightseeing tour

### Out of Scope

- GUI / web interface — CLI-first, no UI
- Real-time collaboration — personal tool first, sharing later
- Calendar integrations — no syncing with Google Calendar, Outlook, etc.
- Cloud storage — schedules are local files
- Mobile app — desktop CLI only

## Context

- Three example domains prove generality: cooking (time-critical, resource-constrained), event planning (people + logistics), travel (location-based, time windows)
- Schedules should be portable/shareable eventually — define once, solve for different constraints — but personal use is the priority for v1
- Existing `scheduleSchema.ts` in repo defines initial type thinking (Step, Track, Schedule) but tech stack is not predetermined
- The tool name is "skejj"

## Constraints

- **Tech stack**: Research-driven — no predetermined language or runtime. Pick whatever is best for a CLI scheduling tool. Schema should be well-documented regardless.
- **Distribution**: Decide later — focus on functionality first, packaging second.
- **Project structure**: `.claude/` directory for project-specific Claude Code skills. `.planning/` and GSD paths gitignored.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Constraint-based engine (not just dependency resolution) | Resources like ovens with limited capacity fundamentally affect scheduling — can't ignore them | — Pending |
| AI schedule generation with configurable LLM | Users shouldn't be locked to one provider; flexibility matters | — Pending |
| Research-driven tech stack | No premature commitment to TypeScript/Node — let the problem drive the tool choice | — Pending |
| CLI API design via research | Interactive adjustment mode and command structure should follow CLI best practices | — Pending |

---
*Last updated: 2026-02-17 after initialization*
