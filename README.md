# skejj

Constraint-based schedule solver -- define tasks, dependencies, and resources; get a timed plan.

```
$ npx skejj make examples/roast-chicken.json

Roast Chicken Dinner
A classic Sunday roast with oven-constrained cooking steps. The oven (capacity …

17:00               17:30               18:00               18:30
─ Mains ────────────────────────────────────────────────────────────────────────
17:00 - Prep chicken                                                         15m
██████████          │                   │                   │

17:15 - Roast chicken                                                     1h 30m
│         ████████████████████████████████████████████████████████████████

18:45 - Make gravy                                                           10m
│                   │                   │                   │         ███████

18:55 - Plate up                                                              5m
│                   │                   │                   │                ███

─ Sides ────────────────────────────────────────────────────────────────────────
17:00 - Prep potatoes                                             20m (55m flex)
█████████████       │                   │                   │

17:00 - Steam vegetables                                       15m (1h 40m flex)
██████████          │                   │                   │

18:15 - Roast potatoes                                            40m (55m flex)
│                   │                   │         ███████████████████████████

─ Setup ────────────────────────────────────────────────────────────────────────
17:00 - Set table                                              10m (1h 45m flex)
███████             │                   │                   │

17:10 - Preheat Oven                                               5m (10m flex)
│      ███          │                   │                   │


Total: 2h | Oven: 2/2
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

Each step is rendered on two lines: a header line (start time, name, duration or flex annotation) and a bar line below. Non-critical steps show flex time in parentheses (e.g. `20m (55m flex)`). The summary line shows total time and resource utilization.

| Flag                          | Default        | Description                                                                       |
| ----------------------------- | -------------- | --------------------------------------------------------------------------------- |
| `-o, --output <file>`         | stdout         | Write output to file instead of stdout                                            |
| `-q, --quiet`                 | false          | Suppress summary stats, show only the schedule                                    |
| `-f, --format <type>`         | --             | Export format: `gantt`, `csv`, `json` (writes a file in addition to ASCII output) |
| `--width <cols>`              | terminal width | Chart width in columns (default: terminal width or 80)                            |
| `-r, --resource <name=value>` | --             | Override resource availability (repeatable)                                       |

```bash
# Solve and display in the terminal
skejj make examples/roast-chicken.json

# Export to CSV alongside ASCII output
skejj make myplan.json --format csv

# Write ASCII output to a file, suppress summary
skejj make myplan.json --quiet --output schedule.txt

# Export JSON data with a fixed chart width
skejj make myplan.json --format json --width 120

# Override a resource capacity
skejj make myplan.json --resource oven=2
```

---

### `skejj check <file>`

Validate a schedule file without solving it. Reports schema errors and constraint warnings.

| Flag          | Default | Description                         |
| ------------- | ------- | ----------------------------------- |
| `-q, --quiet` | false   | Show only errors, suppress warnings |

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

| Flag                  | Default                    | Description                                                                |
| --------------------- | -------------------------- | -------------------------------------------------------------------------- |
| `-o, --output <file>` | derived from schedule name | Override output filename                                                   |
| `-f, --format <type>` | --                         | Export format in addition to ASCII Gantt: `gantt` (Mermaid), `csv`, `json` |

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
A classic Sunday roast with oven-constrained cooking steps. The oven (capacity …

17:00               17:30               18:00               18:30
─ Mains ────────────────────────────────────────────────────────────────────────
17:00 - Prep chicken                                                         15m
██████████          │                   │                   │

17:15 - Roast chicken                                                     1h 30m
│         ████████████████████████████████████████████████████████████████

18:45 - Make gravy                                                           10m
│                   │                   │                   │         ███████

18:55 - Plate up                                                              5m
│                   │                   │                   │                ███

─ Sides ────────────────────────────────────────────────────────────────────────
17:00 - Prep potatoes                                             20m (55m flex)
█████████████       │                   │                   │

17:00 - Steam vegetables                                       15m (1h 40m flex)
██████████          │                   │                   │

18:15 - Roast potatoes                                            40m (55m flex)
│                   │                   │         ███████████████████████████

─ Setup ────────────────────────────────────────────────────────────────────────
17:00 - Set table                                              10m (1h 45m flex)
███████             │                   │                   │

17:10 - Preheat Oven                                               5m (10m flex)
│      ███          │                   │                   │


Total: 2h | Oven: 2/2
```

---

### Kids Birthday Party

Demonstrates: people resource constraint (4 helpers shared across parallel tasks), forward scheduling from a party start time, parallel tracks (food, venue setup, activities), and resource conflict warnings when steps are delayed.

```
$ npx skejj make examples/birthday-party.json

Kids Birthday Party
Planning a kids birthday party with a team of helpers. People resource allocati…

10:00      10:30      11:00      11:30      12:00      12:30     13:00
─ Food ─────────────────────────────────────────────────────────────────────────
10:00 - Bake cake                                               1h (1h 35m flex)
██████████████████████│          │          │          │         │          │

11:00 - Ice cake                                               20m (1h 35m flex)
│          │          ███████    │          │          │         │          │

12:55 - Serve cake                                                           15m
│          │          │          │          │          │        █████       │

─ Venue ────────────────────────────────────────────────────────────────────────
10:00 - Buy supplies                                                          1h
██████████████████████│          │          │          │         │          │

11:00 - Decorate venue                                                       45m
│          │          ████████████████      │          │         │          │

11:55 - Blow up balloons                                          30m (15m flex)
│          │          │          │        ███████████  │         │          │

13:10 - Clean up                                                             30m
│          │          │          │          │          │         │   ███████████

─ Activities ───────────────────────────────────────────────────────────────────
11:45 - Welcome guests                                                       10m
│          │          │          │    ████  │          │         │          │

11:55 - Party games                                                           1h
│          │          │          │        ██████████████████████ │          │

12:25 - Set up games                                              20m (25m flex)
│          │          │          │          │        ███████     │          │


Total: 3h 40m | Helpers: 4/4

--- Warnings ---
  - Step 'Blow up balloons' was delayed beyond its available slack due to resource conflict with 'Helpers'
  - Step 'Set up games' was delayed beyond its available slack due to resource conflict with 'Helpers'
```

---

### London Weekend Sightseeing

Demonstrates: ALAP (As Late As Possible) timing for dinner steps, multi-day multi-track scheduling, and a long planning horizon across two days with no resource constraints.

```
$ npx skejj make examples/london-sightseeing.json

London Weekend Sightseeing
A two-day London itinerary covering major landmarks and cultural highlights. Di…

09:00  10:00 11:00  12:00  13:00 14:00  15:00  16:00 17:00  18:00  19:00 20:00
─ Day 1 ────────────────────────────────────────────────────────────────────────
09:00 - Tower of London                                                       2h
█████████████│      │      │     │      │      │     │      │      │     │

11:00 - Borough Market lunch                                                  1h
│      │     ███████│      │     │      │      │     │      │      │     │

12:00 - Thames Southbank walk                                                45m
│      │     │      █████  │     │      │      │     │      │      │     │

12:45 - Tate Modern                                                       1h 30m
│      │     │      │    ██████████     │      │     │      │      │     │

14:15 - Day 1 dinner                                                          1h
│      │     │      │      │     │ ███████     │     │      │      │     │

─ Day 2 ────────────────────────────────────────────────────────────────────────
15:15 - British Museum                                                    2h 30m
│      │     │      │      │     │      │ ████████████████  │      │     │

17:45 - Covent Garden lunch                                                  45m
│      │     │      │      │     │      │      │     │    █████    │     │

18:30 - Westminster walk                                                      1h
│      │     │      │      │     │      │      │     │      │  ███████   │

19:30 - London Eye                                                           30m
│      │     │      │      │     │      │      │     │      │      │  ███│

20:00 - Day 2 dinner                                                          1h
│      │     │      │      │     │      │      │     │      │      │     ███████


Total: 12h
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
