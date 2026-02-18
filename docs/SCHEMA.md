# Schedule Template Schema Reference

A **schedule template** is a JSON file that describes a set of tasks, their durations, dependencies, and optional constraints. skejj reads the template, applies CPM scheduling and resource allocation, and produces a timed plan.

The schema is defined in `src/schema.ts` (Zod) and exported to `docs/schema.json` (JSON Schema draft-07). To regenerate: `npm run schema:gen`.

## Editor autocomplete

Add a `$schema` field to your JSON file to get autocomplete and inline validation in VS Code and other editors:

```json
{
  "$schema": "./docs/schema.json",
  "id": "my-schedule",
  "name": "My Schedule",
  ...
}
```

---

## Top-level fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Unique identifier for this schedule template |
| `name` | `string` | Yes | Human-readable display name |
| `description` | `string` | No | Optional longer description |
| `steps` | `Step[]` | Yes | Ordered list of tasks (at least one required) |
| `tracks` | `Track[]` | No | Logical groupings for steps (default: `[]`) |
| `resources` | `Resource[]` | No | Constrained resources (default: `[]`) |
| `timeConstraint` | `TimeConstraint` | No | Anchor the schedule to a wall-clock time |
| `defaultNumPeople` | `integer` | No | Default team size when no resource is specified |

---

## Step fields

Each entry in `steps` represents one task.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Unique step identifier (referenced by dependencies and resourceNeeds) |
| `title` | `string` | Yes | Short display name shown in Gantt output |
| `description` | `string` | No | Optional longer description of the task |
| `durationMins` | `integer` | Yes | Duration in minutes (must be >= 1) |
| `dependencies` | `Dependency[]` | No | Steps that must precede this one (default: `[]`) |
| `trackId` | `string` | No | ID of the track this step belongs to |
| `timingPolicy` | `"Asap" \| "Alap"` | No | When to schedule within available slack (default: `Asap`) |
| `resourceNeeds` | `ResourceNeed[]` | No | Resources required during this step (default: `[]`) |

### timingPolicy

| Value | Behaviour |
|---|---|
| `Asap` | Schedule as early as dependencies allow (default) |
| `Alap` | Schedule as late as possible without delaying successors |

ALAP is useful for steps that should happen just before they're needed -- for example, a dinner reservation at the end of the day.

---

## Dependency fields

Each entry in `dependencies` links this step to a predecessor.

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `stepId` | `string` | Yes | -- | ID of the predecessor step |
| `dependencyType` | `DependencyType` | No | `FinishToStart` | Relationship type between the two steps |

### DependencyType values

| Value | Meaning |
|---|---|
| `FinishToStart` | This step starts after the predecessor finishes (most common) |
| `StartToStart` | This step starts no earlier than the predecessor starts |
| `FinishToFinish` | This step finishes no earlier than the predecessor finishes |
| `StartToFinish` | This step finishes no earlier than the predecessor starts |

---

## ResourceNeed fields

Each entry in `resourceNeeds` declares a resource requirement for the step's duration.

| Field | Type | Required | Description |
|---|---|---|---|
| `resourceId` | `string` | Yes | ID of the resource (must match a `Resource.id`) |
| `quantity` | `integer` | Yes | Number of units needed (must be >= 1) |
| `minPeople` | `integer` | No | Minimum acceptable team size (People resources only) |
| `maxPeople` | `integer` | No | Maximum acceptable team size (People resources only) |

---

## Track fields

Tracks group related steps for display and organisation. They do not affect scheduling order.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Unique track identifier |
| `name` | `string` | Yes | Display name shown in output |

---

## Resource fields

Resources are constrained assets that can only be used by one (or a limited number of) steps at a time.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Unique resource identifier |
| `name` | `string` | Yes | Display name |
| `kind` | `ResourceKind` | Yes | Type of resource -- affects allocation behaviour |
| `capacity` | `integer` | Yes | Maximum concurrent usage units |
| `roles` | `string[]` | No | Optional role tags (reserved for future use) |

### ResourceKind values

| Value | Capacity meaning | Example |
|---|---|---|
| `Equipment` | Maximum simultaneous users | Oven with capacity 1 = only one dish at a time |
| `People` | Maximum concurrent people allocated | Team of 4 helpers shared across parallel steps |
| `Consumable` | Total quantity available (not time-windowed) | 100 litres of paint, decremented as used |

---

## TimeConstraint fields

A time constraint anchors the schedule to wall-clock time. Without one, the Gantt shows relative offsets from T+0.

| Field | Type | Description |
|---|---|---|
| `startTime` | `string` (ISO 8601) | Forward scheduling: the first steps begin at this time |
| `endTime` | `string` (ISO 8601) | Backward scheduling: the final step ends at this time |

Provide `startTime` or `endTime`, not both.

**Format:** ISO 8601 local datetime without timezone, e.g. `"2026-07-04T09:00:00"`.

---

## Minimal example

A two-step schedule with a start constraint:

```json
{
  "$schema": "./docs/schema.json",
  "id": "pancakes",
  "name": "Pancake Breakfast",
  "timeConstraint": {
    "startTime": "2026-03-01T08:00:00"
  },
  "steps": [
    {
      "id": "mix-batter",
      "title": "Mix batter",
      "durationMins": 5,
      "dependencies": [],
      "resourceNeeds": []
    },
    {
      "id": "cook-pancakes",
      "title": "Cook pancakes",
      "durationMins": 15,
      "dependencies": [
        { "stepId": "mix-batter", "dependencyType": "FinishToStart" }
      ],
      "resourceNeeds": []
    }
  ]
}
```

Run it: `npx tsx src/index.ts make pancakes.json`

---

## See also

- [`docs/schema.json`](schema.json) -- Machine-readable JSON Schema (draft-07) for editor validation
- [`examples/`](../examples/README.md) -- Real-world example schedules
- `src/schema.ts` -- Zod source of truth; regenerate schema.json with `npm run schema:gen`
