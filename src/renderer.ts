import { Chalk } from 'chalk';
import stringWidth from 'string-width';
import isUnicodeSupported from 'is-unicode-supported';
import type { SolvedScheduleResult, SolvedStepResult } from './engine.js';
import type { ScheduleInput } from './schema.js';
import type { SuggestionsBlock } from './suggestions.js';

// ---------------------------------------------------------------------------
// Character constants — Unicode or ASCII fallback
// ---------------------------------------------------------------------------

const _unicode = isUnicodeSupported();
const FULL_BLOCK  = _unicode ? '\u2588' : '#';   // █
const GRID_CHAR   = _unicode ? '\u2502' : '|';   // │
const H_RULE      = _unicode ? '\u2500' : '-';   // ─

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RenderOptions {
  quiet: boolean;
  termWidth: number;
  colorLevel: 0 | 1 | 2 | 3;
  overrides?: Record<string, number>;
  suggestions?: SuggestionsBlock | null;  // null or undefined = suppressed
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
// Peak resource usage helper
// ---------------------------------------------------------------------------

function computePeakUsage(solvedSteps: SolvedStepResult[], resourceId: string): number {
  const events: Array<[number, number]> = [];
  for (const step of solvedSteps) {
    for (const ar of step.assignedResources) {
      if (ar.resourceId === resourceId) {
        events.push([step.startOffsetMins, ar.quantityUsed]);
        events.push([step.endOffsetMins, -ar.quantityUsed]);
      }
    }
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0, peak = 0;
  for (const [, delta] of events) {
    current += delta;
    if (current > peak) peak = current;
  }
  return peak;
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
 * labelColWidth: prefix width (label column + separator). Pass 0 for full-width bars.
 * maxWidth: skip labels that would extend past this column.
 */
function buildTimeAxis(
  labelColWidth: number,
  tickPositions: number[],
  tickLabels: string[],
  maxWidth?: number,
): string {
  const baseOffset = labelColWidth + (labelColWidth > 0 ? 1 : 0);
  const prefix = ' '.repeat(baseOffset);
  let line = prefix;
  for (let i = 0; i < tickPositions.length; i++) {
    const insertAt = baseOffset + tickPositions[i];
    const label = tickLabels[i];
    // Skip labels that would extend past the max width
    if (maxWidth != null && insertAt + stringWidth(label) > maxWidth) continue;
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
  const { solvedSteps, summary } = schedule;
  const hasOverrides = options.overrides != null && Object.keys(options.overrides).length > 0;
  // Filter out "Inventory override:" warnings from Rust when the resource table is shown
  const warnings = hasOverrides
    ? schedule.warnings.filter(w => !w.startsWith('Inventory override:'))
    : schedule.warnings;
  const totalMins = summary.totalDurationMins;

  // Chalk instance — level 0 = plain text (no ANSI)
  const c = new Chalk({ level: options.colorLevel });

  // Color helpers (all measure-then-color: never color before padding)
  const dimBlock    = (s: string) => c.dim.yellow(s);
  const descColor   = (s: string) => c.gray(s);
  const sepColor    = (s: string) => c.dim(s);
  const gridColor   = (s: string) => c.dim(s);
  const headerColor = (s: string) => c.bold(s);
  const labelColor  = (s: string) => c.cyan(s);
  const warnColor   = (s: string) => c.yellow(s);

  // Track color palette — color by track index, not criticality
  const TRACK_PALETTE: Array<(s: string) => string> = [
    (s: string) => c.yellow(s),
    (s: string) => c.cyan(s),
    (s: string) => c.green(s),
    (s: string) => c.magenta(s),
    (s: string) => c.blue(s),
  ];

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

  // Build track color map: trackId -> color function
  const trackColorMap = new Map<string, (s: string) => string>();
  if (template.tracks) {
    template.tracks.forEach((track, idx) => {
      trackColorMap.set(track.id, TRACK_PALETTE[idx % TRACK_PALETTE.length]);
    });
  }
  // Default color for steps with no track assignment
  const noTrackColor = TRACK_PALETTE[(template.tracks?.length ?? 0) % TRACK_PALETTE.length];

  // Wall-clock base time (from first solved step's startTime if available)
  const hasWallClock = sorted.length > 0 && sorted[0].startTime != null;
  const baseStartTime = hasWallClock ? sorted[0].startTime! : null;

  // Tick interval (minutes between gridlines)
  const tickInterval = totalMins <= 60 ? 15 : totalMins <= 240 ? 30 : totalMins <= 720 ? 60 : 120;

  // Compute ticks for the full range
  const ticks: number[] = [];
  for (let t = 0; t <= totalMins; t += tickInterval) ticks.push(t);
  if (totalMins > 0 && ticks[ticks.length - 1] !== totalMins) ticks.push(totalMins);

  // For full-width bars: barWidth equals termWidth (no label column)
  // We keep a small labelColWidth for time axis only, but bars are full-width
  // Check if split is needed (more than 30 mins per bar column when bars are termWidth wide)
  const minsPerChar = totalMins > 0 ? totalMins / termWidth : 1;
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
    // Each chunk covers termWidth * 30 minutes (bars are now full-width)
    const chunkMins = termWidth * 30;
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
    const desc = template.description;
    if (stringWidth(desc) > termWidth) {
      lines.push(descColor(desc.slice(0, termWidth - 1) + '\u2026'));
    } else {
      lines.push(descColor(desc));
    }
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
    // Tick positions are now relative to termWidth (full-width bars)
    const chunkTicks: number[] = [];
    for (let t = 0; t <= totalMins; t += tickInterval) {
      if (t >= chunk.start && t <= chunk.end) chunkTicks.push(t);
    }
    // Always include chunk boundaries as ticks if they aren't already
    if (chunkTicks.length === 0 || chunkTicks[0] !== chunk.start) chunkTicks.unshift(chunk.start);
    if (chunkTicks[chunkTicks.length - 1] !== chunk.end) chunkTicks.push(chunk.end);

    const tickPositions = chunkTicks.map((t) =>
      chunkMins > 0 ? Math.round(((t - chunk.start) / chunkMins) * termWidth) : 0,
    );
    const tickLabels = chunkTicks.map((t) =>
      baseStartTime ? tickToWallClock(baseStartTime, t) : formatOffset(t),
    );

    // Time axis — full-width (labelColWidth = 0, bars span full termWidth)
    if (totalMins > 0) {
      lines.push(buildTimeAxis(0, tickPositions, tickLabels, termWidth));
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

        // Track separator line — use stringWidth for correct fill length
        const sepLabel = ` ${track.name} `;
        const fillLen = Math.max(0, termWidth - stringWidth(sepLabel) - 1);
        const sepLine = H_RULE.repeat(1) + sepLabel + H_RULE.repeat(fillLen);
        lines.push(sepColor(sepLine));

        const trackColorFn = trackColorMap.get(track.id) ?? noTrackColor;
        for (const step of trackSteps) {
          const stepLines = renderStepLines(step, chunk, chunkMins, termWidth, tickPositions, trackColorFn);
          lines.push(...stepLines);
          lines.push('');
        }
      }

      // Untracked steps at the end
      for (const step of noTrack) {
        const stepLines = renderStepLines(step, chunk, chunkMins, termWidth, tickPositions, noTrackColor);
        lines.push(...stepLines);
        lines.push('');
      }
    } else {
      // Single track or no tracks — render all steps directly
      for (const step of chunkSteps) {
        const stepLines = renderStepLines(step, chunk, chunkMins, termWidth, tickPositions, noTrackColor);
        lines.push(...stepLines);
        lines.push('');
      }
    }

    if (chunkIdx < chunks.length - 1) lines.push('');
  }

  // ---------------------------------------------------------------------------
  // Step lines rendering helper (inner function to close over color helpers etc.)
  // Returns two lines: [headerLine, barLine]
  // ---------------------------------------------------------------------------

  function renderStepLines(
    step: SolvedStepResult,
    chunk: TimeChunk,
    chunkMins: number,
    termWidth: number,
    tickPositions: number[],
    trackColorFn: (s: string) => string,
  ): string[] {
    const title = titleOf(step);
    const startLabel = baseStartTime
      ? tickToWallClock(baseStartTime, step.startOffsetMins)
      : formatOffset(step.startOffsetMins);
    const durationMins = step.endOffsetMins - step.startOffsetMins;
    const flexMins = step.totalFloatMins;

    // Line 1 (header): "HH:MM - Step Name" left, "duration (flex flex)" right
    const left = `${startLabel} - ${title}`;
    const right = flexMins > 0
      ? `${formatDuration(durationMins)} (${formatDuration(flexMins)} flex)`
      : formatDuration(durationMins);
    // Measure plain text for padding (never color before measuring)
    const gap = Math.max(1, termWidth - stringWidth(left) - stringWidth(right));
    const headerLine = left + ' '.repeat(gap) + right;

    // Line 2 (bar): full-width bar spanning termWidth columns
    const clippedStart = Math.max(step.startOffsetMins, chunk.start);
    const clippedEnd = Math.min(step.endOffsetMins, chunk.end);

    let barStr: string;
    if (chunkMins === 0 || clippedEnd <= clippedStart) {
      // Step not visible in this chunk — show empty bar with gridlines only
      const emptyChars = buildBarChars(termWidth, 0, 0, ' ', tickPositions);
      barStr = emptyChars.map((ch) => ch === GRID_CHAR ? gridColor(ch) : ch).join('');
    } else {
      const startPos = Math.round(((clippedStart - chunk.start) / chunkMins) * termWidth);
      const endPos = Math.max(
        Math.round(((clippedEnd - chunk.start) / chunkMins) * termWidth),
        startPos + 1,
      );

      // Warned steps use dim coloring; others use track color
      const isWarned = warnedStepIds.has(step.stepId);
      const blockColorFn = isWarned ? dimBlock : trackColorFn;

      const chars = buildBarChars(termWidth, startPos, endPos, FULL_BLOCK, tickPositions);
      barStr = colorBarChars(chars, blockColorFn, gridColor);
    }

    return [headerLine, barStr];
  }

  // ---------------------------------------------------------------------------
  // Summary section — one-line summary with peak resource usage
  // ---------------------------------------------------------------------------

  if (!options.quiet) {
    lines.push('');
    const totalStr = `Total: ${formatDuration(summary.totalDurationMins)}`;
    const resourceParts = (template.resources ?? [])
      .map(res => {
        const effectiveCap = options.overrides?.[res.name] ?? res.capacity;
        if (res.kind === 'Consumable') {
          let totalConsumed = 0;
          for (const step of solvedSteps) {
            for (const ar of step.assignedResources) {
              if (ar.resourceId === res.id) totalConsumed += ar.quantityUsed;
            }
          }
          return totalConsumed > 0 ? `${res.name}: ${totalConsumed}/${effectiveCap}` : null;
        }
        const peak = computePeakUsage(solvedSteps, res.id);
        return peak > 0 ? `${res.name}: ${peak}/${effectiveCap}` : null;
      })
      .filter((part): part is string => part !== null);
    lines.push(
      resourceParts.length > 0
        ? `${totalStr} | ${resourceParts.join(', ')}`
        : totalStr
    );
  }

  // ---------------------------------------------------------------------------
  // Warnings section
  // ---------------------------------------------------------------------------

  if (warnings.length > 0) {
    lines.push('');
    lines.push(warnColor('--- Warnings ---'));
    for (const w of warnings) lines.push(`  - ${warnColor(w)}`);
  }

  // ---------------------------------------------------------------------------
  // Resource table — only rendered when overrides are active
  // ---------------------------------------------------------------------------

  if (hasOverrides && options.overrides) {
    const overrides = options.overrides;
    const templateResources = template.resources ?? [];

    if (templateResources.length > 0) {
      lines.push('');
      lines.push(headerColor('--- Resources ---'));

      for (const res of templateResources) {
        const overriddenCapacity = overrides[res.name];
        const hasOverride = overriddenCapacity !== undefined;

        if (hasOverride) {
          // Overridden resource: show "name: original -> new"
          const baseLabel = `  ${res.name}:`;
          const arrowPart = `${res.capacity} -> ${overriddenCapacity}`;

          if (res.kind === 'Consumable') {
            // Calculate total consumed from solved steps
            let totalConsumed = 0;
            for (const step of solvedSteps) {
              for (const ar of step.assignedResources) {
                if (ar.resourceId === res.id) {
                  totalConsumed += ar.quantityUsed;
                }
              }
            }
            const remaining = overriddenCapacity - totalConsumed;

            if (remaining >= 0) {
              lines.push(`${labelColor(baseLabel)} ${arrowPart} (${remaining} remaining)`);
            } else {
              lines.push(`${labelColor(baseLabel)} ${arrowPart}`);
              lines.push('');
              lines.push(warnColor(`  Warning: ${res.name}: ${totalConsumed} needed but only ${overriddenCapacity} available (shortfall: ${Math.abs(remaining)})`));
            }
          } else {
            lines.push(`${labelColor(baseLabel)} ${arrowPart}`);
          }
        } else {
          // Non-overridden resource: show "name: capacity"
          lines.push(`${labelColor(`  ${res.name}:`)} ${res.capacity}`);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Suggestions section — "Try next" and "Did you know?" (optional)
  // ---------------------------------------------------------------------------

  if (options.suggestions) {
    const { tryNext, didYouKnow } = options.suggestions;

    if (tryNext.length > 0) {
      lines.push('');
      lines.push(sepColor(H_RULE.repeat(termWidth)));
      lines.push(labelColor('Try next:'));
      for (const item of tryNext) {
        // Pad label to 20 chars for alignment, dim styling
        const labelPart = c.dim(item.label.padEnd(20));
        const commandPart = item.command;
        lines.push(`  ${labelPart} ${commandPart}`);
      }
    }

    if (didYouKnow.length > 0) {
      lines.push('');
      lines.push(labelColor('Did you know?'));
      for (const tip of didYouKnow) {
        lines.push(`  ${c.dim('\u2022')} ${tip}`);  // bullet point
      }
    }
  }

  return lines.join('\n');
}
