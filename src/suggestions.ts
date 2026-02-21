/**
 * suggestions.ts — Smart suggestion generation for skejj make output.
 *
 * Isolates all suggestion intelligence in a single testable module.
 * Decides WHAT to suggest (bottleneck analysis, tips, command reconstruction).
 * make.ts decides WHEN to call it; renderer.ts decides HOW to display it.
 */

import type { SolvedScheduleResult, SolvedStepResult } from './engine.js';
import type { ScheduleInput } from './schema.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TryNextItem {
  label: string;    // e.g. "More ovens:"
  command: string;  // e.g. "skejj make schedule.yaml --resource oven=2"
}

export interface SuggestionsBlock {
  tryNext: TryNextItem[];    // 2-3 labeled copy-pasteable commands
  didYouKnow: string[];     // 3 tip strings (already formatted text)
}

// Options that make.ts will pass — represents the user's current CLI invocation
export interface MakeOptions {
  quiet?: boolean;
  format?: string;
  width?: number;
  output?: string;
  resource?: string[];  // raw --resource flag values like ["oven=2"]
}

// ---------------------------------------------------------------------------
// Suppression logic
// ---------------------------------------------------------------------------

/**
 * Returns false when suggestions should be suppressed.
 * Suppresses for: quiet mode, non-TTY, machine formats, file output.
 */
export function shouldShowSuggestions(options: MakeOptions): boolean {
  if (options.quiet === true) return false;
  if (!process.stdout.isTTY) return false;
  if (options.format === 'json' || options.format === 'csv') return false;
  if (options.output !== undefined) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Command reconstruction (internal)
// ---------------------------------------------------------------------------

/**
 * Reconstructs `skejj make <file> [flags]` carrying forward ALL flags the
 * user already passed. Does NOT include --output (file output suppresses
 * suggestions, so we'd never reach this code path with --output set).
 */
function buildBaseCommand(filePath: string, options: MakeOptions): string {
  const parts: string[] = ['skejj make', filePath];

  if (options.quiet) parts.push('--quiet');
  if (options.format) parts.push(`--format ${options.format}`);
  if (options.width !== undefined) parts.push(`--width ${options.width}`);
  // Note: --output is intentionally omitted (file output suppresses suggestions)
  if (options.resource && options.resource.length > 0) {
    for (const r of options.resource) {
      parts.push(`--resource ${r}`);
    }
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Bottleneck analysis (internal)
// ---------------------------------------------------------------------------

/**
 * Parses already-overridden resource IDs from options.resource or the
 * resolvedResourceOverrides map.
 */
function getOverriddenResourceIds(
  options: MakeOptions,
  resolvedResourceOverrides?: Map<string, number>,
): Set<string> {
  const overridden = new Set<string>();

  if (resolvedResourceOverrides && resolvedResourceOverrides.size > 0) {
    for (const id of resolvedResourceOverrides.keys()) {
      overridden.add(id);
    }
  } else if (options.resource && options.resource.length > 0) {
    for (const r of options.resource) {
      const eqIdx = r.indexOf('=');
      if (eqIdx > 0) {
        overridden.add(r.slice(0, eqIdx));
      }
    }
  }

  return overridden;
}

interface BottleneckResult {
  resourceId: string;
  resourceName: string;
  currentCapacity: number;
  criticalExposure: number;  // sum of (stepDurationMins * quantityUsed) for critical steps
  longestCriticalStepDuration: number;
}

/**
 * Finds the non-consumable resource with the highest critical-path exposure.
 * Returns null if no resource has critical path exposure > 0.
 */
function findBottleneckResource(
  result: SolvedScheduleResult,
  template: ScheduleInput,
  overriddenIds: Set<string>,
): BottleneckResult | null {
  const criticalStepIds = new Set(result.summary.criticalPathStepIds);

  // Build a map of stepId -> SolvedStepResult for quick lookup
  const stepMap = new Map<string, SolvedStepResult>();
  for (const step of result.solvedSteps) {
    stepMap.set(step.stepId, step);
  }

  // Build a map of resourceId -> resource definition
  const resourceMap = new Map<string, typeof template.resources[number]>();
  for (const res of template.resources) {
    resourceMap.set(res.id, res);
  }

  // For each non-consumable resource not already overridden, sum critical exposure
  const exposureByResource = new Map<string, { exposure: number; longestDuration: number }>();

  for (const templateStep of template.steps) {
    const solvedStep = stepMap.get(String(templateStep.id));
    if (!solvedStep || !criticalStepIds.has(String(templateStep.id))) continue;

    const stepDuration = templateStep.durationMins;

    for (const need of templateStep.resourceNeeds) {
      const resourceId = String(need.resourceId);
      const resource = resourceMap.get(resourceId);
      if (!resource) continue;

      // Skip consumables — they're not capacity-constrained in the same way
      if (resource.kind === 'Consumable') continue;

      // Skip already-overridden resources
      if (overriddenIds.has(resourceId)) continue;

      const exposure = stepDuration * need.quantity;
      const current = exposureByResource.get(resourceId) ?? { exposure: 0, longestDuration: 0 };
      exposureByResource.set(resourceId, {
        exposure: current.exposure + exposure,
        longestDuration: Math.max(current.longestDuration, stepDuration),
      });
    }
  }

  if (exposureByResource.size === 0) return null;

  // Find resource with highest exposure
  let bestResourceId: string | null = null;
  let bestExposure = 0;
  let bestLongestDuration = 0;

  for (const [id, { exposure, longestDuration }] of exposureByResource) {
    if (exposure > bestExposure) {
      bestExposure = exposure;
      bestLongestDuration = longestDuration;
      bestResourceId = id;
    }
  }

  if (!bestResourceId || bestExposure === 0) return null;

  const resource = resourceMap.get(bestResourceId)!;
  return {
    resourceId: bestResourceId,
    resourceName: resource.name,
    currentCapacity: resource.capacity,
    criticalExposure: bestExposure,
    longestCriticalStepDuration: bestLongestDuration,
  };
}

// ---------------------------------------------------------------------------
// Time savings estimation (internal)
// ---------------------------------------------------------------------------

/**
 * For the bottleneck resource, estimate potential time savings.
 * Returns the duration of the longest critical-path step (in minutes) if >= 5 min.
 */
function estimateTimeSavings(bottleneck: BottleneckResult): number | null {
  if (bottleneck.longestCriticalStepDuration >= 5) {
    return bottleneck.longestCriticalStepDuration;
  }
  return null;
}

// ---------------------------------------------------------------------------
// "Try next" generation (internal)
// ---------------------------------------------------------------------------

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

function buildTryNextItems(
  result: SolvedScheduleResult,
  template: ScheduleInput,
  filePath: string,
  options: MakeOptions,
  resolvedResourceOverrides?: Map<string, number>,
): TryNextItem[] {
  const overriddenIds = getOverriddenResourceIds(options, resolvedResourceOverrides);
  const baseCommand = buildBaseCommand(filePath, options);
  const items: TryNextItem[] = [];

  // 1. Resource suggestion (most actionable — goes first)
  const bottleneck = findBottleneckResource(result, template, overriddenIds);
  if (bottleneck) {
    const savings = estimateTimeSavings(bottleneck);
    const resourceNameLower = bottleneck.resourceName.toLowerCase();
    const newCapacity = bottleneck.currentCapacity + 1;
    const savingsStr = savings !== null ? ` (~${formatDuration(savings)} faster)` : '';
    items.push({
      label: `More ${resourceNameLower}s${savingsStr}:`,
      command: `${baseCommand} --resource ${bottleneck.resourceId}=${newCapacity}`,
    });
  }

  // 2. Format suggestion (if user didn't pass --format)
  if (!options.format && items.length < 3) {
    items.push({
      label: 'Export CSV:',
      command: `${baseCommand} --format csv`,
    });
  }

  // 3. Width suggestion (if user didn't pass --width)
  if (options.width === undefined && items.length < 3) {
    items.push({
      label: 'Wider chart:',
      command: `${baseCommand} --width 120`,
    });
  }

  return items.slice(0, 3);
}

// ---------------------------------------------------------------------------
// "Did you know?" tip pool and selection (internal)
// ---------------------------------------------------------------------------

interface TipContext {
  hasResources: boolean;
  hasParallelSteps: boolean;
  hasTimeConstraint: boolean;
  totalDurationMins: number;
  stepCount: number;
}

interface Tip {
  id: string;
  text: string;
  relevance(ctx: TipContext): number;
}

const TIP_POOL: Tip[] = [
  {
    id: 'quiet-flag',
    text: 'Use `--quiet` to hide the summary and show just the Gantt chart',
    relevance: () => 5,
  },
  {
    id: 'csv-export',
    text: 'Add `--format csv` to export a spreadsheet-ready file alongside the chart',
    relevance: () => 6,
  },
  {
    id: 'resource-capacity',
    text: 'Resources with capacity > 1 let multiple steps run in parallel',
    relevance: (ctx) => ctx.hasResources ? 9 : 3,
  },
  {
    id: 'critical-path',
    text: 'Steps on the critical path have 0 slack — any delay extends the whole schedule',
    relevance: () => 7,
  },
  {
    id: 'alap-policy',
    text: 'ALAP timing policy delays non-critical steps to start as late as possible',
    relevance: () => 5,
  },
  {
    id: 'backward-scheduling',
    text: 'Backward scheduling: set an `endTime` in timeConstraint to plan from a deadline',
    relevance: (ctx) => !ctx.hasTimeConstraint ? 8 : 2,
  },
  {
    id: 'yaml-support',
    text: 'YAML files are supported — use `.yaml` extension and skejj auto-detects the format',
    relevance: () => 4,
  },
  {
    id: 'track-groups',
    text: 'Track groups visually separate related steps in the Gantt chart',
    relevance: () => 4,
  },
];

function buildTipContext(result: SolvedScheduleResult, template: ScheduleInput): TipContext {
  // Determine if any steps run in parallel (share overlapping time windows)
  const startOffsets = result.solvedSteps.map((s) => s.startOffsetMins);
  const uniqueStarts = new Set(startOffsets);
  const hasParallelSteps = uniqueStarts.size < result.solvedSteps.length;

  return {
    hasResources: template.resources.length > 0,
    hasParallelSteps,
    hasTimeConstraint: template.timeConstraint !== undefined,
    totalDurationMins: result.summary.totalDurationMins,
    stepCount: result.solvedSteps.length,
  };
}

function selectTips(result: SolvedScheduleResult, template: ScheduleInput): string[] {
  const ctx = buildTipContext(result, template);

  // Score all tips
  const scored = TIP_POOL.map((tip) => ({
    tip,
    score: tip.relevance(ctx),
  })).sort((a, b) => b.score - a.score);

  const selected: Tip[] = [];
  const remaining: Tip[] = [];

  // Pick top 2 by score
  for (const { tip } of scored) {
    if (selected.length < 2) {
      selected.push(tip);
    } else {
      remaining.push(tip);
    }
  }

  // For the third tip, use deterministic rotation based on total duration
  if (remaining.length > 0) {
    const idx = result.summary.totalDurationMins % remaining.length;
    selected.push(remaining[idx]);
  }

  return selected.map((tip) => tip.text);
}

// ---------------------------------------------------------------------------
// Config helpers (internal)
// ---------------------------------------------------------------------------

type ConfStore = {
  get<T>(key: string): T | undefined;
};

async function getConf(): Promise<ConfStore> {
  const { default: Conf } = await import('conf') as { default: new (opts: { projectName: string }) => ConfStore };
  return new Conf({ projectName: 'skejj' });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Generate a SuggestionsBlock for display after `skejj make` output.
 *
 * @param result - The solved schedule result from the engine
 * @param template - The original schedule input (for resource definitions)
 * @param filePath - Path to the schedule file (used in reconstructed commands)
 * @param options - The CLI options the user passed to `skejj make`
 * @param resolvedResourceOverrides - Optional map of resourceId -> overridden capacity
 * @returns A SuggestionsBlock with tryNext commands and didYouKnow tips
 */
export async function generateSuggestions(
  result: SolvedScheduleResult,
  template: ScheduleInput,
  filePath: string,
  options: MakeOptions,
  resolvedResourceOverrides?: Map<string, number>,
): Promise<SuggestionsBlock> {
  // Check config-based suppression
  let suggestionsEnabled = true;
  let tipsEnabled = true;

  try {
    const conf = await getConf();
    const suggestionsConfig = conf.get<boolean>('suggestions');
    const tipsConfig = conf.get<boolean>('tips');
    if (suggestionsConfig === false) suggestionsEnabled = false;
    if (tipsConfig === false) tipsEnabled = false;
  } catch {
    // Config unavailable — proceed with defaults (both enabled)
  }

  const tryNext = suggestionsEnabled
    ? buildTryNextItems(result, template, filePath, options, resolvedResourceOverrides)
    : [];

  const didYouKnow = tipsEnabled
    ? selectTips(result, template)
    : [];

  return { tryNext, didYouKnow };
}
