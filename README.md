# skejj

Constraint-based schedule solver -- define tasks, dependencies, and resources; get a timed plan.

```
$ npx skejj make examples/roast-chicken.json

Roast Chicken Dinner
A classic Sunday roast with oven-constrained cooking steps. The oven (capacity 1) forces chicken and potatoes to roast sequentially.

                   17:00          17:30           18:00          18:30          19:00
─ Mains ───────────────────────────────────────────────────────────────────────
Prep chicken       ████████       │               │              │
Roast chicken      │       █████████████████████████████████████████████
Make gravy         │              │               │              │      █████
Plate up           │              │               │              │           ███
─ Sides ───────────────────────────────────────────────────────────────────────
Prep potatoes      ░░░░░░░░░░     │               │              │
Steam vegetables   ░░░░░░░░       │               │              │
Roast potatoes     │              │               │      ░░░░░░░░░░░░░░░░░░░░
─ Setup ───────────────────────────────────────────────────────────────────────
Set table          ░░░░░          │               │              │
Preheat Oven       │    ░░░       │               │              │

--- Summary ---
Total time: 2h
Steps: 9
Critical path: 2h (4 steps)
Resources used: Oven

--- Critical Path ---
Prep chicken -> Roast chicken -> Make gravy -> Plate up

Float per step:
  Prep chicken: 17:00 -> 17:15  [0m (critical)]
  Prep potatoes: 17:00 -> 17:20  [55m slack]
  Steam vegetables: 17:00 -> 17:15  [100m slack]
  Set table: 17:00 -> 17:10  [105m slack]
  Preheat Oven: 17:10 -> 17:15  [10m slack]
  Roast chicken: 17:15 -> 18:45  [0m (critical)]
  Roast potatoes: 18:15 -> 18:55  [55m slack]
  Make gravy: 18:45 -> 18:55  [0m (critical)]
  Plate up: 18:55 -> 19:00  [0m (critical)]
```

## Quick Start

```bash
npx skejj make examples/roast-chicken.json
```

No install needed -- `npx` downloads and runs skejj directly.

To install globally:

```bash
npm install -g skejj
```

Then use `skejj` instead of `npx skejj` everywhere.

**Start from scratch with the interactive wizard:**

```bash
skejj new
```

**Generate a schedule from a description using AI:**

```bash
skejj generate "plan a birthday party for 20 kids"
```

## Commands

### `skejj make <file>`

Solve a schedule file and display the timed plan as an ASCII Gantt chart.

Critical-path steps are shown with solid blocks (█). Non-critical steps with lighter blocks (░). The summary includes total time, step count, critical path length, and float per step.

| Flag | Default | Description |
|------|---------|-------------|
| `-o, --output <file>` | stdout | Write output to file instead of stdout |
| `-q, --quiet` | false | Suppress summary stats, show only the schedule |
| `-f, --format <type>` | -- | Export format: `gantt`, `csv`, `json` (writes a file in addition to ASCII output) |
| `--width <cols>` | terminal width | Chart width in columns (default: terminal width or 80) |

```bash
# Solve and display in the terminal
skejj make examples/roast-chicken.json

# Export to CSV alongside ASCII output
skejj make myplan.json --format csv

# Write ASCII output to a file, suppress summary
skejj make myplan.json --quiet --output schedule.txt

# Export JSON data with a fixed chart width
skejj make myplan.json --format json --width 120
```

---

### `skejj check <file>`

Validate a schedule file without solving it. Reports schema errors and constraint warnings.

| Flag | Default | Description |
|------|---------|-------------|
| `-q, --quiet` | false | Show only errors, suppress warnings |

```bash
# Validate and show all errors and warnings
skejj check myplan.json

# Show errors only (useful in CI)
skejj check myplan.json --quiet
```

---

### `skejj new`

Guided interactive wizard to create a new schedule from scratch. Prompts for schedule name, steps, durations, dependencies, and resources. Requires an interactive terminal (TTY).

```bash
skejj new
```

---

### `skejj generate <description>`

Generate a schedule JSON file from a natural language description using an LLM. Requires an API key configured via `skejj config set`.

| Flag | Default | Description |
|------|---------|-------------|
| `-o, --output <file>` | derived from schedule name | Override output filename |
| `-f, --format <type>` | -- | Export format in addition to ASCII Gantt: `gantt` (Mermaid), `csv`, `json` |

```bash
# Generate and display a birthday party schedule
skejj generate "plan a kids birthday party for 20 children"

# Generate and save to a specific file
skejj generate "weekend trip to Paris" --output paris-trip.json

# Generate and export a CSV
skejj generate "home renovation project" --format csv
```

---

### `skejj config`

Manage LLM provider configuration for the `generate` command.

**Subcommands:**

#### `skejj config set <key> <value>`

Set a configuration value. Supported keys: `provider` (e.g. `openai`, `anthropic`), `apiKey`, `model`.

#### `skejj config show`

Display current configuration.

```bash
# Set your LLM provider and API key
skejj config set provider openai
skejj config set apiKey sk-...

# Use Anthropic instead
skejj config set provider anthropic
skejj config set apiKey sk-ant-...

# Show current config
skejj config show
```

---

### `skejj adjust <file>`

Interactively adjust a solved schedule in a re-solve loop. Opens an interactive editor (requires TTY) where you can modify step durations, dependencies, and resources, and see the Gantt chart update live.

```bash
skejj adjust examples/roast-chicken.json

# Or adjust a schedule you created
skejj adjust myplan.json
```

---

## Examples

### Roast Chicken Dinner

Demonstrates: equipment resource constraint (Oven, capacity 1 -- chicken and potatoes cannot roast simultaneously), backward scheduling from a target dinner time, and a linear dependency chain (prep -> roast -> gravy -> plate).

```
$ npx skejj make examples/roast-chicken.json

Roast Chicken Dinner
A classic Sunday roast with oven-constrained cooking steps. The oven (capacity 1) forces chicken and potatoes to roast sequentially.

                   17:00          17:30           18:00          18:30          19:00
─ Mains ───────────────────────────────────────────────────────────────────────
Prep chicken       ████████       │               │              │
Roast chicken      │       █████████████████████████████████████████████
Make gravy         │              │               │              │      █████
Plate up           │              │               │              │           ███
─ Sides ───────────────────────────────────────────────────────────────────────
Prep potatoes      ░░░░░░░░░░     │               │              │
Steam vegetables   ░░░░░░░░       │               │              │
Roast potatoes     │              │               │      ░░░░░░░░░░░░░░░░░░░░
─ Setup ───────────────────────────────────────────────────────────────────────
Set table          ░░░░░          │               │              │
Preheat Oven       │    ░░░       │               │              │

--- Summary ---
Total time: 2h
Steps: 9
Critical path: 2h (4 steps)
Resources used: Oven

--- Critical Path ---
Prep chicken -> Roast chicken -> Make gravy -> Plate up

Float per step:
  Prep chicken: 17:00 -> 17:15  [0m (critical)]
  Prep potatoes: 17:00 -> 17:20  [55m slack]
  Steam vegetables: 17:00 -> 17:15  [100m slack]
  Set table: 17:00 -> 17:10  [105m slack]
  Preheat Oven: 17:10 -> 17:15  [10m slack]
  Roast chicken: 17:15 -> 18:45  [0m (critical)]
  Roast potatoes: 18:15 -> 18:55  [55m slack]
  Make gravy: 18:45 -> 18:55  [0m (critical)]
  Plate up: 18:55 -> 19:00  [0m (critical)]
```

---

### Kids Birthday Party

Demonstrates: people resource constraint (4 helpers shared across parallel tasks), forward scheduling from a party start time, and parallel tracks running simultaneously (food, venue setup, activities).

```
$ npx skejj make examples/birthday-party.json

Kids Birthday Party
Planning a kids birthday party with a team of helpers. People resource allocation ensures we never exceed 4 helpers simultaneously.

                   10:00   10:30    11:00   11:30   12:00    12:30   13:00   13:3013:40
─ Food ────────────────────────────────────────────────────────────────────────
Bake cake          ░░░░░░░░░░░░░░░░░│       │       │        │       │       │
Ice cake           │       │        ░░░░░   │       │        │       │       │
Serve cake         │       │        │       │       │        │      ████     │
─ Venue ───────────────────────────────────────────────────────────────────────
Buy supplies       █████████████████│       │       │        │       │       │
Decorate venue     │       │        ████████████    │        │       │       │
Blow up balloons   │       │        │       │      ░░░░░░░░  │       │       │
Clean up           │       │        │       │       │        │       │  ████████
─ Activities ──────────────────────────────────────────────────────────────────
Welcome guests     │       │        │       │   ███ │        │       │       │
Party games        │       │        │       │      █████████████████ │       │
Set up games       │       │        │       │       │      ░░░░░░    │       │

--- Summary ---
Total time: 3h 40m
Steps: 10
Critical path: 3h 40m (6 steps)
Resources used: Helpers
```

---

### London Weekend Sightseeing

Demonstrates: ALAP (As Late As Possible) timing for dinner steps, multi-day multi-track scheduling, and a long planning horizon across two days with no resource constraints.

```
$ npx skejj make examples/london-sightseeing.json

London Weekend Sightseeing
A two-day London itinerary covering major landmarks and cultural highlights. Dinner steps use ALAP timing to push them as late in the day as possible.

                        09:0010:0011:0012:0013:0014:0015:0016:0017:0018:0019:0020:0021:00
─ Day 1 ───────────────────────────────────────────────────────────────────────
Tower of London         █████████│    │    │   │    │    │   │    │    │   │
Borough Market lunch    │    │   █████│    │   │    │    │   │    │    │   │
Thames Southbank walk   │    │   │    ████ │   │    │    │   │    │    │   │
Tate Modern             │    │   │    │   ███████   │    │   │    │    │   │
Day 1 dinner            │    │   │    │    │   │ ████    │   │    │    │   │
─ Day 2 ───────────────────────────────────────────────────────────────────────
British Museum          │    │   │    │    │   │    │████████████ │    │   │
Covent Garden lunch     │    │   │    │    │   │    │    │   │   ███   │   │
Westminster walk        │    │   │    │    │   │    │    │   │    │ █████  │
London Eye              │    │   │    │    │   │    │    │   │    │    │ ██│
Day 2 dinner            │    │   │    │    │   │    │    │   │    │    │   █████

--- Summary ---
Total time: 12h
Steps: 10
Critical path: 12h (10 steps)
```

---

See [Schedule Template Schema Reference](docs/SCHEMA.md) for the full field reference, or add a `$schema` key to your JSON file for editor autocomplete.

## Writing Your Own Schedule

Schedules are JSON (or YAML) files. The fastest way to start:

```bash
# Interactive wizard -- no schema knowledge required
skejj new

# Or write JSON directly and validate as you go
skejj check myplan.json
```

**Editor autocomplete:** Add a `$schema` field to your JSON file to get inline validation and autocomplete in VS Code and other editors:

```json
{
  "$schema": "./docs/schema.json",
  "id": "my-schedule",
  "name": "My Schedule",
  "steps": [
    {
      "id": "step-1",
      "title": "First step",
      "durationMins": 30
    }
  ]
}
```

Full field reference: [docs/SCHEMA.md](docs/SCHEMA.md)

The schema covers: steps, tracks, resources (Equipment, People, Consumable), dependency types (FinishToStart, StartToStart, FinishToFinish, StartToFinish), timing policies (Asap, Alap), and time constraints (forward from `startTime`, backward from `endTime`).
