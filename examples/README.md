# Example Schedules

Three real-world examples demonstrating different skejj scheduling features.

## Running an example

```bash
# Validate a schedule (no solving)
npx tsx src/index.ts check examples/roast-chicken.yaml

# Solve and display the timed plan
npx tsx src/index.ts make examples/roast-chicken.yaml
```

---

## roast-chicken.yaml -- Roast Chicken Dinner

A Sunday roast planned to finish at 7pm. Uses a single **oven (Equipment, capacity 1)** to demonstrate resource contention: the chicken and potatoes must roast sequentially because only one dish fits in the oven at a time.

Constraint types exercised:
- **Equipment resource** (oven, capacity 1) -- forces sequential oven usage
- **endTime constraint** -- backward scheduling from a target dinner time
- **Dependency chain** -- gravy depends on chicken drippings; plating waits for all food + table

```bash
npx tsx src/index.ts make examples/roast-chicken.yaml
```

---

## birthday-party.yaml -- Kids Birthday Party

A party prepared by a team of four helpers. Uses a **People resource (capacity 4)** where each step requires a different number of helpers. The solver allocates helpers so the total never exceeds four at any point.

Constraint types exercised:
- **People resource** (4 helpers) -- allocates varying team sizes per step
- **startTime constraint** -- forward scheduling from a fixed start
- **Multiple tracks** -- Food, Venue, Activities run in parallel

```bash
npx tsx src/index.ts make examples/birthday-party.yaml
```

---

## london-sightseeing.yaml -- London Weekend Sightseeing

A two-day London itinerary with no resource constraints -- pure dependency-based sequencing with multi-track organisation. Dinner steps use **ALAP (As Late As Possible) timing** to push them toward the end of each day.

Constraint types exercised:
- **ALAP timing policy** -- dinner steps scheduled as late as dependencies allow
- **Multi-track planning** -- Day 1 and Day 2 tracks organise the itinerary
- **Long horizon** -- 12-hour schedule spanning two days of sightseeing

```bash
npx tsx src/index.ts make examples/london-sightseeing.yaml
```

---

## Writing your own schedule

YAML is the recommended format for readability. See [`docs/SCHEMA.md`](../docs/SCHEMA.md) for a full field reference.

For editor autocomplete and inline validation, use a JSON file with a `$schema` key -- `$schema` validation is a JSON-only feature:

```json
{
  "$schema": "../docs/schema.json",
  "id": "my-schedule",
  "name": "My Schedule",
  ...
}
```
