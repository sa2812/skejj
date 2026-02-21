/**
 * engine.ts — Single JS-to-Rust boundary for skejj.
 *
 * All commands import solve() and validate() from here. This module spawns
 * the skejj-engine Rust binary as a subprocess, communicating via JSON on
 * stdin/stdout.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { ScheduleInput } from './schema.js';

// ---------------------------------------------------------------------------
// Output types (camelCase — Rust model has #[serde(rename_all = "camelCase")])
// ---------------------------------------------------------------------------

export interface AssignedResourceResult {
  resourceId: string;
  quantityUsed: number;
}

export interface SolvedStepResult {
  stepId: string;
  startOffsetMins: number;
  endOffsetMins: number;
  startTime: string | null;
  endTime: string | null;
  assignedResources: AssignedResourceResult[];
  totalFloatMins: number;
  isCritical: boolean;
}

export interface ScheduleSummaryResult {
  totalDurationMins: number;
  criticalPathStepIds: string[];
}

export interface SolvedScheduleResult {
  templateId: string;
  solvedSteps: SolvedStepResult[];
  summary: ScheduleSummaryResult;
  warnings: string[];
}

export interface ValidationResultData {
  errors: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

/**
 * Find the skejj-engine binary.
 *
 * Resolution order:
 * 1. Production: resolve via @skejj/engine-{platform} npm package (post-install).
 * 2. Development: look for target/release/skejj-engine or target/debug/skejj-engine
 *    relative to the project root (located via import.meta.url).
 */
function findBinary(): string {
  // 1. Try production resolution via optional platform package
  const platform = `${process.platform}-${process.arch}`;
  const platformPackageMap: Record<string, string> = {
    'darwin-arm64': '@skejj/engine-darwin-arm64',
    'linux-x64': '@skejj/engine-linux-x64',
    'win32-x64': '@skejj/engine-win32-x64',
  };

  const pkgName = platformPackageMap[platform];
  if (pkgName) {
    try {
      const req = createRequire(import.meta.url);
      const pkgJson = req(`${pkgName}/package.json`) as { bin?: Record<string, string> };
      if (pkgJson.bin) {
        const binRelPath = Object.values(pkgJson.bin)[0];
        const pkgDir = path.dirname(req.resolve(`${pkgName}/package.json`));
        const binPath = path.resolve(pkgDir, binRelPath);
        if (fs.existsSync(binPath)) {
          return binPath;
        }
      }
    } catch {
      // Platform package not installed — fall through to dev binary
    }
  }

  // 2. Development: find project root via import.meta.url, then look for built binary
  const thisFile = fileURLToPath(import.meta.url);
  // src/engine.ts -> project root is two levels up (src/ -> project root)
  // dist/engine.js -> project root is two levels up (dist/ -> project root)
  const projectRoot = path.resolve(path.dirname(thisFile), '..');

  const releaseBin = path.join(projectRoot, 'target', 'release', 'skejj-engine');
  if (fs.existsSync(releaseBin)) {
    return releaseBin;
  }

  const debugBin = path.join(projectRoot, 'target', 'debug', 'skejj-engine');
  if (fs.existsSync(debugBin)) {
    return debugBin;
  }

  throw new Error(
    `skejj-engine binary not found. Build it with: cargo build --release --manifest-path crates/engine/Cargo.toml`
  );
}

// ---------------------------------------------------------------------------
// Internal engine call helper
// ---------------------------------------------------------------------------

type EngineRequest =
  | { command: 'solve'; template: ScheduleInput; inventory: Record<string, number> | null }
  | { command: 'validate'; template: ScheduleInput };

type EngineResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function callEngine<T>(request: EngineRequest): T {
  const binary = findBinary();
  const stdin = JSON.stringify(request);

  const result = spawnSync(binary, [], {
    input: stdin,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024, // 50 MB
  });

  if (result.error) {
    throw new Error(`Failed to spawn skejj-engine: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const errText = result.stderr?.trim() || result.stdout?.trim() || 'unknown error';
    throw new Error(`skejj-engine exited with code ${result.status}: ${errText}`);
  }

  let parsed: EngineResponse<T>;
  try {
    parsed = JSON.parse(result.stdout) as EngineResponse<T>;
  } catch {
    throw new Error(`skejj-engine returned invalid JSON: ${result.stdout?.slice(0, 200)}`);
  }

  if (!parsed.ok) {
    throw new Error(`skejj-engine error: ${(parsed as { ok: false; error: string }).error}`);
  }

  return (parsed as { ok: true; data: T }).data;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Solve a schedule template, optionally with a real-world resource inventory.
 *
 * @param template - The validated schedule input
 * @param inventory - Optional map of resource name -> available quantity
 * @returns The solved schedule with concrete timing for every step
 */
export function solve(
  template: ScheduleInput,
  inventory?: Record<string, number>,
): SolvedScheduleResult {
  return callEngine<SolvedScheduleResult>({
    command: 'solve',
    template,
    inventory: inventory ?? null,
  });
}

/**
 * Validate a schedule template without solving.
 *
 * @param template - The validated schedule input
 * @returns Errors (blocking) and warnings (advisory)
 */
export function validate(template: ScheduleInput): ValidationResultData {
  return callEngine<ValidationResultData>({
    command: 'validate',
    template,
  });
}
