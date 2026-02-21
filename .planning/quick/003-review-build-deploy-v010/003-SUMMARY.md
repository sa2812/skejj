# Quick Task 003: Review Build Changes & Deploy v0.1.0

## What was done

1. **Reviewed build changes** in commits `5a020f2` and `4924359`:
   - Dropped `darwin-x64` (Intel Mac) from CI matrix, optional deps, and engine.ts
   - Enabled package-lock.json
   - Updated LICENSE copyright, README formatting, package description

2. **Fixed linux-arm64 platform resolution** (`834e49d`):
   - `@skejj/engine-linux-arm64` was in `package.json` optionalDependencies but missing from `src/engine.ts` platformPackageMap
   - Added `'linux-arm64': '@skejj/engine-linux-arm64'` to the map

3. **Deployed v0.1.0**:
   - Deleted stale local tags (v0.1.0, v0.1.1, v1.0)
   - Created fresh `v0.1.0` tag at HEAD (`834e49d`)
   - Pushed commits and tag to origin

## Commits

| Hash | Description |
|------|-------------|
| 834e49d | fix(build): add linux-arm64 to engine platform map |
