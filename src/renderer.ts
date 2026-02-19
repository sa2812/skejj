import { Chalk } from 'chalk';
import stringWidth from 'string-width';
import isUnicodeSupported from 'is-unicode-supported';
import type { SolvedScheduleResult, SolvedStepResult } from './engine.js';
import type { ScheduleInput } from './schema.js';

// ---------------------------------------------------------------------------
// Character constants — Unicode or ASCII fallback
// ---------------------------------------------------------------------------

const _unicode = isUnicodeSupported();
const FULL_BLOCK  = _unicode ? '\u2588' : '#';   // █
const LIGHT_BLOCK = _unicode ? '\u2591' : '-';   // ░
const GRID_CHAR   = _unicode ? '\u2502' : '|';   // │
const H_RULE      = _unicode ? '\u2500' : '-';   // ─

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RenderOptions {
  quiet: boolean;
  termWidth: number;
  colorLevel: 0 | 1 | 2 | 3;
}

export function detectColorLevel(): 0 | 1 | 2 | 3 {
  if (process.env.NO_COLOR) return 0;
  if (!process.stdout.isTTY) return 0;
  return 3;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatOffset(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `+${h}:${m.toString().padStart(2, '0')}`;
}

function formatWallClock(isoStr: string): string {
  const match = isoStr.match(/T(\d{2}:\d{2})/);
  if (match) return match[1];
  return isoStr;
}

/**
 * Compute wall-clock HH:MM for a given offset (minutes from schedule start).
 */
function tickToWallClock(baseIso: string, tickMins: number): string {
  const match = baseIso.match(/^(\d{4}-\d{2}-\d{2}T)(\d{2}):(\d{2})/);
  if (match) {
    const baseH = parseInt(match[2], 10);
    const baseM = parseInt(match[3], 10);
    const totalMins = baseH * 60 + baseM + tickMins;
    const th = Math.floor(totalMins / 60) % 24;
    const tm = totalMins % 60;
    return `${th.toString().padStart(2, '0')}:${tm.toString().padStart(2, '0')}`;
  }
  return formatOffset(tickMins);
}

// ---------------------------------------------------------------------------
// Bar building helpers
// ---------------------------------------------------------------------------

/**
 * Build a bar character array of length barWidth.
 * Fill the [startPos, endPos) range with blockChar.
 * Substitute gridline chars at tick positions where no block exists.
 */
function buildBarChars(
  barWidth: number,
  startPos: number,
  endPos: number,
  blockChar: string,
  tickPositions: number[],
): string[] {
  const chars = Array<string>(barWidth).fill(' ');
  const safeStart = Math.max(0, startPos);
  const safeEnd = Math.min(barWidth, endPos);
  for (let i = safeStart; i < safeEnd; i++) chars[i] = blockChar;
  for (const tick of tickPositions) {
    if (tick >= 0 && tick < barWidth && chars[tick] === ' ') {
      chars[tick] = GRID_CHAR;
    }
  }
  return chars;
}

/**
 * Color a bar character array segment-by-segment and join into a string.
 * Segments: gridlines (dim), blocks (blockColor), spaces (plain).
 */
function colorBarChars(
  chars: string[],
  blockColor: (s: string) => string,
  gridColor: (s: string) => string,
): string {
  const parts: string[] = [];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (ch === GRID_CHAR) {
      parts.push(gridColor(ch));
      i++;
    } else if (ch === ' ') {
      // Collect run of spaces
      let j = i;
      while (j < chars.length && chars[j] === ' ') j++;
      parts.push(chars.slice(i, j).join(''));
      i = j;
    } else {
      // Block character — collect run of same block char
      let j = i;
      while (j < chars.length && chars[j] !== ' ' && chars[j] !== GRID_CHAR) j++;
      parts.push(blockColor(chars.slice(i, j).join('')));
      i = j;
    }
  }
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Time axis helper
// ---------------------------------------------------------------------------

/**
 * Build the time axis line for a given time range.
 * tickPositions: column offsets within the bar area.
 * tickLabels: label for each tick.
 * labelColWidth: prefix width (label column + separator).
 */
function buildTimeAxis(
  labelColWidth: number,
  tickPositions: number[],
  tickLabels: string[],
): string {
  const prefix = ' '.repeat(labelColWidth + 1);
  let line = prefix;
  for (let i = 0; i < tickPositions.length; i++) {
    const insertAt = labelColWidth + 1 + tickPositions[i];
    const label = tickLabels[i];
    if (insertAt > stringWidth(line)) {
      line = line + ' '.repeat(insertAt - stringWidth(line));
    }
    line = line + label;
  }
  return line;
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

export function renderGantt(
  schedule: SolvedScheduleResult,
  template: ScheduleInput,
  options: RenderOptions,
): string {
  const lines: string[] = [];
  const { solvedSteps, summary, warnings } = schedule;
  const totalMins = summary.totalDurationMins;

  // Chalk instance — level 0 = plain text (no ANSI)
  const c = new Chalk({ level: options.colorLevel });

  // Color helpers (all measure-then-color: never color before padding)
  const critical    = (s: string) => c.bold.red(s);
  const nonCritical = (s: string) => c.cyan(s);
  const dimBlock    = (s: string) => c.dim.yellow(s);
  const labelColor  = (s: string) => c.gray(s);
  const sepColor    = (s: string) => c.dim(s);
  const gridColor   = (s: string) => c.dim(s);
  const headerColor = (s: string) => c.bold(s);
  const warnColor   = (s: string) => c.yellow(s);

  // Clamp terminal width to a reasonable minimum
  const termWidth = Math.max(options.termWidth, 40);

  // Sort steps by start offset
  const sorted = [...solvedSteps].sort((a, b) => a.startOffsetMins - b.startOffsetMins);

  // Title helper — find step title from template
  const titleOf = (step: SolvedStepResult): string => {
    const t = template.steps.find((s) => s.id === step.stepId);
    return t?.title ?? step.stepId;
  };

  // Build set of step IDs that appear in warnings (for dimmed bar rendering)
  const warnedStepIds = new Set<string>();
  for (const step of template.steps) {
    if (schedule.warnings.some((w) => w.includes(`'${step.title}'`))) {
      warnedStepIds.add(step.id);
    }
  }

  // Label column: cap at 40% of termWidth to keep bar area reasonable
  const maxNameLen = sorted.length > 0
    ? Math.max(...sorted.map((s) => titleOf(s).length), 4)
    : 4;
  const labelColWidth = Math.min(maxNameLen + 2, Math.floor(termWidth * 0.4));
  const barWidth = Math.max(termWidth - labelColWidth - 1, 10);

  // Wall-clock base time (from first solved step's startTime if available)
  const hasWallClock = sorted.length > 0 && sorted[0].startTime != null;
  const baseStartTime = hasWallClock ? sorted[0].startTime! : null;

  // Tick interval (minutes between gridlines)
  const tickInterval = totalMins <= 60 ? 15 : totalMins <= 240 ? 30 : totalMins <= 720 ? 60 : 120;

  // Compute ticks for the full range
  const ticks: number[] = [];
  for (let t = 0; t <= totalMins; t += tickInterval) ticks.push(t);
  if (totalMins > 0 && ticks[ticks.length - 1] !== totalMins) ticks.push(totalMins);

  // Check if split is needed (more than 30 mins per bar column)
  const minsPerChar = totalMins > 0 ? totalMins / barWidth : 1;
  const needsSplit = minsPerChar > 30;

  // Compute chunks for split rendering
  interface TimeChunk {
    start: number;
    end: number;
  }

  let chunks: TimeChunk[];
  if (!needsSplit || totalMins === 0) {
    chunks = [{ start: 0, end: totalMins }];
  } else {
    // Each chunk covers barWidth * 30 minutes
    const chunkMins = barWidth * 30;
    const numChunks = Math.ceil(totalMins / chunkMins);
    chunks = [];
    for (let i = 0; i < numChunks; i++) {
      chunks.push({
        start: i * chunkMins,
        end: Math.min((i + 1) * chunkMins, totalMins),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Header section
  // ---------------------------------------------------------------------------

  lines.push(headerColor(template.name));
  if (template.description) {
    lines.push(labelColor(template.description));
  }
  lines.push('');

  // ---------------------------------------------------------------------------
  // Render each chunk
  // ---------------------------------------------------------------------------

  const multiChunk = chunks.length > 1;

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx];
    const chunkMins = chunk.end - chunk.start;

    // Chunk label (only for split schedules)
    if (multiChunk) {
      const startLabel = baseStartTime
        ? tickToWallClock(baseStartTime, chunk.start)
        : formatOffset(chunk.start);
      const endLabel = baseStartTime
        ? tickToWallClock(baseStartTime, chunk.end)
        : formatOffset(chunk.end);
      lines.push(headerColor(`Part ${chunkIdx + 1} of ${chunks.length} (${startLabel} \u2013 ${endLabel})`));
    }

    // Compute tick positions and labels for this chunk
    const chunkTicks: number[] = [];
    for (let t = 0; t <= totalMins; t += tickInterval) {
      if (t >= chunk.start && t <= chunk.end) chunkTicks.push(t);
    }
    // Always include chunk boundaries as ticks if they aren't already
    if (chunkTicks.length === 0 || chunkTicks[0] !== chunk.start) chunkTicks.unshift(chunk.start);
    if (chunkTicks[chunkTicks.length - 1] !== chunk.end) chunkTicks.push(chunk.end);

    const tickPositions = chunkTicks.map((t) =>
      chunkMins > 0 ? Math.round(((t - chunk.start) / chunkMins) * barWidth) : 0,
    );
    const tickLabels = chunkTicks.map((t) =>
      baseStartTime ? tickToWallClock(baseStartTime, t) : formatOffset(t),
    );

    // Time axis
    if (totalMins > 0) {
      lines.push(buildTimeAxis(labelColWidth, tickPositions, tickLabels));
    }

    // Steps visible in this chunk (overlap with [chunk.start, chunk.end])
    const chunkSteps = sorted.filter(
      (s) => s.startOffsetMins < chunk.end && s.endOffsetMins > chunk.start,
    );

    // Track grouping
    const hasTracks = template.tracks && template.tracks.length > 1;

    if (hasTracks) {
      // Group steps by track, preserving track order
      const trackOrder = template.tracks.map((t) => t.id);
      const byTrack = new Map<string, SolvedStepResult[]>();
      for (const trackId of trackOrder) byTrack.set(trackId, []);

      // Steps without a trackId go into a default group
      const noTrack: SolvedStepResult[] = [];
      for (const step of chunkSteps) {
        const tmplStep = template.steps.find((s) => s.id === step.stepId);
        const trackId = (tmplStep as { trackId?: string })?.trackId;
        if (trackId && byTrack.has(trackId)) {
          byTrack.get(trackId)!.push(step);
        } else {
          noTrack.push(step);
        }
      }

      // Render each track group
      for (const track of template.tracks) {
        const trackSteps = byTrack.get(track.id) ?? [];
        if (trackSteps.length === 0) continue;

        // Track separator line
        const sepLabel = ` ${track.name} `;
        const fillLen = Math.max(0, termWidth - sepLabel.length - 2);
        const sepLine = H_RULE.repeat(1) + sepLabel + H_RULE.repeat(fillLen);
        lines.push(sepColor(sepLine));

        for (const step of trackSteps) {
          lines.push(renderStepRow(step, chunk, chunkMins, barWidth, labelColWidth, tickPositions));
        }
      }

      // Untracked steps at the end
      for (const step of noTrack) {
        lines.push(renderStepRow(step, chunk, chunkMins, barWidth, labelColWidth, tickPositions));
      }
    } else {
      // Single track or no tracks — render all steps directly
      for (const step of chunkSteps) {
        lines.push(renderStepRow(step, chunk, chunkMins, barWidth, labelColWidth, tickPositions));
      }
    }

    if (chunkIdx < chunks.length - 1) lines.push('');
  }

  // ---------------------------------------------------------------------------
  // Step row rendering helper (inner function to close over color helpers etc.)
  // ---------------------------------------------------------------------------

  function renderStepRow(
    step: SolvedStepResult,
    chunk: TimeChunk,
    chunkMins: number,
    barWidth: number,
    labelColWidth: number,
    tickPositions: number[],
  ): string {
    const title = titleOf(step);
    // Truncate label if it exceeds labelColWidth
    const plainLabel = title.length > labelColWidth
      ? title.slice(0, labelColWidth - 3) + '...'
      : title.padEnd(labelColWidth);

    // Compute bar position clipped to chunk
    const clippedStart = Math.max(step.startOffsetMins, chunk.start);
    const clippedEnd = Math.min(step.endOffsetMins, chunk.end);

    let barStr: string;
    if (chunkMins === 0 || clippedEnd <= clippedStart) {
      // Step not visible in this chunk — show empty bar with gridlines
      const emptyChars = buildBarChars(barWidth, 0, 0, ' ', tickPositions);
      barStr = emptyChars.map((ch) => ch === GRID_CHAR ? gridColor(ch) : ch).join('');
    } else {
      const startPos = Math.round(((clippedStart - chunk.start) / chunkMins) * barWidth);
      const endPos = Math.max(
        Math.round(((clippedEnd - chunk.start) / chunkMins) * barWidth),
        startPos + 1,
      );

      // Choose block character and color based on critical path and warning status
      const isWarned = warnedStepIds.has(step.stepId);
      const blockChar = step.isCritical ? FULL_BLOCK : LIGHT_BLOCK;
      const blockColorFn = isWarned ? dimBlock : step.isCritical ? critical : nonCritical;

      const chars = buildBarChars(barWidth, startPos, endPos, blockChar, tickPositions);
      barStr = colorBarChars(chars, blockColorFn, gridColor);
    }

    const coloredLabel = labelColor(plainLabel);
    return `${coloredLabel} ${barStr}`;
  }

  // ---------------------------------------------------------------------------
  // Summary section
  // ---------------------------------------------------------------------------

  if (!options.quiet) {
    lines.push('');
    lines.push(headerColor('--- Summary ---'));
    lines.push(`Total time: ${formatDuration(summary.totalDurationMins)}`);
    lines.push(`Steps: ${solvedSteps.length}`);

    const criticalSteps = solvedSteps.filter((s) => s.isCritical);
    const criticalDuration = criticalSteps.reduce(
      (sum, s) => sum + (s.endOffsetMins - s.startOffsetMins),
      0,
    );
    lines.push(`Critical path: ${formatDuration(criticalDuration)} (${criticalSteps.length} step${criticalSteps.length === 1 ? '' : 's'})`);

    const usedResources = new Set<string>();
    for (const step of solvedSteps) {
      for (const ar of step.assignedResources) usedResources.add(ar.resourceId);
    }
    if (usedResources.size > 0) {
      const resourceNames = [...usedResources].map((id) => {
        const r = template.resources.find((res) => res.id === id);
        return r?.name ?? id;
      });
      lines.push(`Resources used: ${resourceNames.join(', ')}`);
    }

    lines.push('');
    lines.push(headerColor('--- Critical Path ---'));
    const criticalSorted = sorted.filter((s) => s.isCritical);
    if (criticalSorted.length > 0) {
      const cpChain = criticalSorted
        .map((s) => titleOf(s))
        .join(' -> ');
      lines.push(critical(cpChain));
      lines.push('');
      lines.push('Float per step:');

      for (const step of sorted) {
        const name = titleOf(step);
        const timeStr =
          hasWallClock && step.startTime && step.endTime
            ? `${formatWallClock(step.startTime)} -> ${formatWallClock(step.endTime)}`
            : `${formatOffset(step.startOffsetMins)} -> ${formatOffset(step.endOffsetMins)}`;
        const floatStr = step.isCritical
          ? '0m (critical)'
          : `${step.totalFloatMins}m slack`;
        lines.push(`  ${name}: ${timeStr}  [${floatStr}]`);
      }
    } else {
      lines.push('No critical path identified.');
    }
  }

  // ---------------------------------------------------------------------------
  // Warnings section
  // ---------------------------------------------------------------------------

  if (warnings.length > 0) {
    lines.push('');
    lines.push(warnColor('--- Warnings ---'));
    for (const w of warnings) lines.push(`  - ${warnColor(w)}`);
  }

  return lines.join('\n');
}
