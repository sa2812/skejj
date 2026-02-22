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

// Connector box-drawing characters (used for --arrows gutter)
const CONN_TL    = _unicode ? '\u250C' : '+';   // ┌ top-left corner
const CONN_TR    = _unicode ? '\u2510' : '+';   // ┐ top-right corner
const CONN_BL    = _unicode ? '\u2514' : '+';   // └ bottom-left corner
const CONN_BR    = _unicode ? '\u2518' : '+';   // ┘ bottom-right corner
const CONN_LT    = _unicode ? '\u251C' : '|';   // ├ left T-junction
const CONN_RT    = _unicode ? '\u2524' : '|';   // ┤ right T-junction
const CONN_CROSS = _unicode ? '\u253C' : '+';   // ┼ cross
const GUTTER_WIDTH = 3;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RenderOptions {
  quiet: boolean;
  termWidth: number;
  colorLevel: 0 | 1 | 2 | 3;
  overrides?: Record<string, number>;
  suggestions?: SuggestionsBlock | null;  // null or undefined = suppressed
  showArrows?: boolean;  // show dependency connector lines in gutter column
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
// Connector algorithm helpers (used when showArrows is true)
// ---------------------------------------------------------------------------

interface GutterCell {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

type GutterGrid = GutterCell[][];

/**
 * Map direction bitmask to a box-drawing character.
 * Bitmask: bit3=up, bit2=down, bit1=left, bit0=right
 */
function gutterCharForDirections(up: boolean, down: boolean, left: boolean, right: boolean): string {
  const key = (up ? 8 : 0) | (down ? 4 : 0) | (left ? 2 : 0) | (right ? 1 : 0);
  const charMap: Record<number, string> = {
    0b0100: GRID_CHAR,   // down only:       |
    0b1000: GRID_CHAR,   // up only:         |
    0b1100: GRID_CHAR,   // up+down:         |
    0b0110: CONN_TR,     // down+left:       top-right corner
    0b1010: CONN_BR,     // up+left:         bottom-right corner
    0b1110: CONN_RT,     // up+down+left:    right T-junction
    0b0101: CONN_TL,     // down+right:      top-left corner
    0b1001: CONN_BL,     // up+right:        bottom-left corner
    0b1101: CONN_LT,     // up+down+right:   left T-junction
    0b0011: H_RULE,      // left+right:      horizontal
    0b1111: CONN_CROSS,  // all four:        cross
  };
  return charMap[key] ?? ' ';
}

/**
 * Build a row-index map for steps in the rendered output.
 * Returns Map<stepId, barRowIndex> where barRowIndex is the 0-based row
 * index of that step's BAR line (not header line).
 * Must mirror the exact iteration order of the renderGantt loop.
 * Layout per step: header row (+0), bar row (+1), blank line (+2) = 3 rows per step.
 * Separator rows add 1 row per non-empty track group.
 */
function buildRowMap(
  chunkSteps: SolvedStepResult[],
  template: ScheduleInput,
): { rowOf: Map<string, number>; totalRows: number } {
  const rowOf = new Map<string, number>();
  let row = 0;
  const hasTracks = template.tracks && template.tracks.length > 1;

  if (hasTracks) {
    const trackOrder = template.tracks.map((t) => t.id);
    const byTrack = new Map<string, SolvedStepResult[]>();
    for (const trackId of trackOrder) byTrack.set(trackId, []);
    const noTrack: SolvedStepResult[] = [];

    for (const ss of chunkSteps) {
      const tmpl = template.steps.find((s) => s.id === ss.stepId);
      const trackId = (tmpl as { trackId?: string })?.trackId;
      if (trackId && byTrack.has(trackId)) {
        byTrack.get(trackId)!.push(ss);
      } else {
        noTrack.push(ss);
      }
    }

    for (const track of template.tracks) {
      const trackSteps = byTrack.get(track.id) ?? [];
      if (trackSteps.length === 0) continue;
      row++;  // separator row
      for (const ss of trackSteps) {
        row++;  // header row
        rowOf.set(ss.stepId, row);  // bar row index
        row++;  // bar row counted
        row++;  // blank line
      }
    }
    for (const ss of noTrack) {
      row++;  // header row
      rowOf.set(ss.stepId, row);
      row++;
      row++;  // blank line
    }
  } else {
    for (const ss of chunkSteps) {
      row++;  // header row
      rowOf.set(ss.stepId, row);  // bar row index
      row++;
      row++;  // blank line
    }
  }

  return { rowOf, totalRows: row };
}

/**
 * Build the gutter grid for a set of edges and row positions.
 * Only edges where BOTH pred and succ appear in rowOf are drawn.
 */
function buildGutterGrid(
  edges: Array<{ predId: string; succId: string }>,
  rowOf: Map<string, number>,
  totalRows: number,
): GutterGrid {
  const grid: GutterGrid = Array.from({ length: totalRows }, () =>
    Array.from({ length: GUTTER_WIDTH }, () => ({ up: false, down: false, left: false, right: false }))
  );

  // Lane occupancy: laneOccupancy[lane][row] = true if a connector uses this lane at this row
  const numLanes = GUTTER_WIDTH - 1;  // lanes 0 and 1; col 2 is turn/exit column
  const laneOccupancy: boolean[][] = Array.from({ length: numLanes }, () =>
    new Array(totalRows).fill(false)
  );

  for (const { predId, succId } of edges) {
    const predRow = rowOf.get(predId);
    const succRow = rowOf.get(succId);
    if (predRow == null || succRow == null) continue;
    if (predRow === succRow) continue;

    const topRow = Math.min(predRow, succRow);
    const bottomRow = Math.max(predRow, succRow);

    // Assign lane: find first lane with no conflict in [topRow, bottomRow]
    let lane = 0;
    let assigned = false;
    for (let l = 0; l < numLanes; l++) {
      const hasConflict = laneOccupancy[l].slice(topRow, bottomRow + 1).some((v) => v);
      if (!hasConflict) {
        lane = l;
        assigned = true;
        break;
      }
    }
    if (!assigned) lane = 0;  // overflow: share lane 0, cross chars at intersections

    // Mark lane occupancy for this vertical span
    for (let r = topRow; r <= bottomRow; r++) {
      laneOccupancy[lane][r] = true;
    }

    // Fill vertical segment in lane column
    for (let r = topRow; r <= bottomRow; r++) {
      if (r > topRow) grid[r][lane].up = true;
      if (r < bottomRow) grid[r][lane].down = true;
    }

    // Horizontal connection: lane col -> turn col (col GUTTER_WIDTH-1 = col 2) -> exit right
    grid[predRow][lane].right = true;
    for (let c = lane + 1; c < GUTTER_WIDTH - 1; c++) {
      grid[predRow][c].left = true;
      grid[predRow][c].right = true;
    }
    grid[predRow][GUTTER_WIDTH - 1].right = true;

    grid[succRow][lane].right = true;
    for (let c = lane + 1; c < GUTTER_WIDTH - 1; c++) {
      grid[succRow][c].left = true;
      grid[succRow][c].right = true;
    }
    grid[succRow][GUTTER_WIDTH - 1].right = true;
  }

  return grid;
}

/**
 * Render one row of the gutter grid as a dim-colored string (GUTTER_WIDTH chars wide).
 */
function renderGutterString(
  gridRow: GutterCell[],
  connColor: (s: string) => string,
): string {
  return gridRow
    .map((cell) => {
      const ch = gutterCharForDirections(cell.up, cell.down, cell.left, cell.right);
      return ch === ' ' ? ' ' : connColor(ch);
    })
    .join('');
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
  const showArrows = options.showArrows ?? false;

  // When arrows active, subtract gutter from bar area width
  const barWidth = showArrows ? Math.max(termWidth - GUTTER_WIDTH, 10) : termWidth;

  // Connector color (dim gray for all connector chars)
  const connColor   = (s: string) => c.dim(s);

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

  // Check if split is needed (more than 30 mins per bar column)
  // When arrows active, barWidth < termWidth — use barWidth for split decision
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
    const desc = template.description;
    if (stringWidth(desc) > termWidth) {
      lines.push(descColor(desc.slice(0, termWidth - 1) + '\u2026'));
    } else {
      lines.push(descColor(desc));
    }
  }
  lines.push('');

  // Collect all explicit dependency edges (for --arrows mode)
  const allEdges: Array<{ predId: string; succId: string }> = [];
  if (showArrows) {
    for (const step of template.steps) {
      for (const dep of step.dependencies ?? []) {
        allEdges.push({ predId: dep.stepId, succId: step.id });
      }
    }
  }

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
      chunkMins > 0 ? Math.round(((t - chunk.start) / chunkMins) * barWidth) : 0,
    );
    const tickLabels = chunkTicks.map((t) =>
      baseStartTime ? tickToWallClock(baseStartTime, t) : formatOffset(t),
    );

    // Time axis — when arrows active, prepend GUTTER_WIDTH spaces to keep bar columns aligned
    if (totalMins > 0) {
      const timeAxisLine = buildTimeAxis(0, tickPositions, tickLabels, barWidth);
      if (showArrows) {
        lines.push(' '.repeat(GUTTER_WIDTH) + timeAxisLine);
      } else {
        lines.push(timeAxisLine);
      }
    }

    // Steps visible in this chunk (overlap with [chunk.start, chunk.end])
    const chunkSteps = sorted.filter(
      (s) => s.startOffsetMins < chunk.end && s.endOffsetMins > chunk.start,
    );

    // Per-chunk gutter grid (only edges where both endpoints in same chunk)
    let chunkRowOf = new Map<string, number>();
    let chunkTotalRows = 0;
    let gutterGrid: GutterGrid = [];
    let chunkRow = 0;  // tracks current row within chunk for gutter indexing
    let predEdgesForStep = new Map<string, Set<string>>();  // stepId -> set of succIds this step is pred of
    let succEdgesForStep = new Map<string, Set<string>>();  // stepId -> set of predIds this step is succ of

    if (showArrows && chunkSteps.length > 0) {
      const chunkResult = buildRowMap(chunkSteps, template);
      chunkRowOf = chunkResult.rowOf;
      chunkTotalRows = chunkResult.totalRows;
      const chunkEdges = allEdges.filter(
        (e) => chunkRowOf.has(e.predId) && chunkRowOf.has(e.succId)
      );
      gutterGrid = buildGutterGrid(chunkEdges, chunkRowOf, chunkTotalRows);

      // Build edge role maps: for each step, track whether it is a predecessor or successor
      predEdgesForStep = new Map<string, Set<string>>();
      succEdgesForStep = new Map<string, Set<string>>();
      for (const { predId, succId } of chunkEdges) {
        if (!chunkRowOf.has(predId) || !chunkRowOf.has(succId)) continue;
        if (!predEdgesForStep.has(predId)) predEdgesForStep.set(predId, new Set());
        predEdgesForStep.get(predId)!.add(succId);
        if (!succEdgesForStep.has(succId)) succEdgesForStep.set(succId, new Set());
        succEdgesForStep.get(succId)!.add(predId);
      }
    }

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
        if (showArrows) {
          // Prepend GUTTER_WIDTH spaces; separator spans bar area only
          const sepLabel = ` ${track.name} `;
          const fillLen = Math.max(0, barWidth - stringWidth(sepLabel) - 1);
          const sepContent = H_RULE.repeat(1) + sepLabel + H_RULE.repeat(fillLen);
          lines.push(' '.repeat(GUTTER_WIDTH) + sepColor(sepContent));
        } else {
          const sepLabel = ` ${track.name} `;
          const fillLen = Math.max(0, termWidth - stringWidth(sepLabel) - 1);
          const sepLine = H_RULE.repeat(1) + sepLabel + H_RULE.repeat(fillLen);
          lines.push(sepColor(sepLine));
        }
        if (showArrows) chunkRow++;  // separator counts as one row in gutter grid

        const trackColorFn = trackColorMap.get(track.id) ?? noTrackColor;
        for (const step of trackSteps) {
          const stepLines = renderStepLines(
            step, chunk, chunkMins, barWidth, tickPositions, trackColorFn,
            showArrows ? {
              gutterGrid,
              chunkRow,
              isPred: predEdgesForStep.has(step.stepId),
              isSucc: succEdgesForStep.has(step.stepId),
            } : undefined,
          );
          lines.push(...stepLines);
          lines.push('');
          if (showArrows) chunkRow += 3;  // header + bar + blank line
        }
      }

      // Untracked steps at the end
      for (const step of noTrack) {
        const stepLines = renderStepLines(
          step, chunk, chunkMins, barWidth, tickPositions, noTrackColor,
          showArrows ? {
            gutterGrid,
            chunkRow,
            isPred: predEdgesForStep.has(step.stepId),
            isSucc: succEdgesForStep.has(step.stepId),
          } : undefined,
        );
        lines.push(...stepLines);
        lines.push('');
        if (showArrows) chunkRow += 3;
      }
    } else {
      // Single track or no tracks — render all steps directly
      for (const step of chunkSteps) {
        const stepLines = renderStepLines(
          step, chunk, chunkMins, barWidth, tickPositions, noTrackColor,
          showArrows ? {
            gutterGrid,
            chunkRow,
            isPred: predEdgesForStep.has(step.stepId),
            isSucc: succEdgesForStep.has(step.stepId),
          } : undefined,
        );
        lines.push(...stepLines);
        lines.push('');
        if (showArrows) chunkRow += 3;
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
    effectiveBarWidth: number,
    tickPositions: number[],
    trackColorFn: (s: string) => string,
    arrowCtx?: { gutterGrid: GutterGrid; chunkRow: number; isPred: boolean; isSucc: boolean },
  ): string[] {
    const title = titleOf(step);
    const startLabel = baseStartTime
      ? tickToWallClock(baseStartTime, step.startOffsetMins)
      : formatOffset(step.startOffsetMins);
    const durationMins = step.endOffsetMins - step.startOffsetMins;
    const flexMins = step.totalFloatMins;

    // Header spans effectiveBarWidth (bar area only when arrows on)
    const headerLineWidth = arrowCtx ? effectiveBarWidth : termWidth;

    // Line 1 (header): "HH:MM - Step Name" left, "duration (flex flex)" right
    const left = `${startLabel} - ${title}`;
    const right = flexMins > 0
      ? `${formatDuration(durationMins)} (${formatDuration(flexMins)} flex)`
      : formatDuration(durationMins);
    // Measure plain text for padding (never color before measuring)
    const gap = Math.max(1, headerLineWidth - stringWidth(left) - stringWidth(right));
    const headerContent = left + ' '.repeat(gap) + right;

    // Line 2 (bar): bar spanning effectiveBarWidth columns
    const clippedStart = Math.max(step.startOffsetMins, chunk.start);
    const clippedEnd = Math.min(step.endOffsetMins, chunk.end);

    let barContent: string;
    let startPos = 0;
    let endPos = 0;

    if (chunkMins === 0 || clippedEnd <= clippedStart) {
      // Step not visible in this chunk — show empty bar with gridlines only
      const emptyChars = buildBarChars(effectiveBarWidth, 0, 0, ' ', tickPositions);
      barContent = emptyChars.map((ch) => ch === GRID_CHAR ? gridColor(ch) : ch).join('');
    } else {
      startPos = Math.round(((clippedStart - chunk.start) / chunkMins) * effectiveBarWidth);
      endPos = Math.max(
        Math.round(((clippedEnd - chunk.start) / chunkMins) * effectiveBarWidth),
        startPos + 1,
      );

      // Warned steps use dim coloring; others use track color
      const isWarned = warnedStepIds.has(step.stepId);
      const blockColorFn = isWarned ? dimBlock : trackColorFn;

      const chars = buildBarChars(effectiveBarWidth, startPos, endPos, FULL_BLOCK, tickPositions);

      // When arrows active, draw directional horizontal arms in bar area.
      // The turn column (col 2 in gutter) exits right — arm continues into bar area.
      // Successor arm: from col 0 to startPos (left side, empty space before bar start)
      // Predecessor arm: from endPos to end of bar area (right side, empty space after bar end)
      // Role-aware: only draw the arm relevant to this step's role in each edge.
      if (arrowCtx && arrowCtx.gutterGrid.length > 0) {
        const barRow = arrowCtx.chunkRow + 1;  // bar line = header row + 1
        if (barRow < arrowCtx.gutterGrid.length) {
          const turnCell = arrowCtx.gutterGrid[barRow]?.[GUTTER_WIDTH - 1];
          if (turnCell?.right) {
            // Successor arm: arm comes FROM the left TO bar start
            // Only draw if this step IS a successor in at least one edge
            if (arrowCtx.isSucc && startPos > 0) {
              for (let col = 0; col < startPos && col < effectiveBarWidth; col++) {
                if (chars[col] === ' ' || chars[col] === GRID_CHAR) {
                  chars[col] = H_RULE;
                }
              }
            }
            // Predecessor arm: arm goes FROM bar end TO the right
            // Only draw if this step IS a predecessor in at least one edge
            if (arrowCtx.isPred && endPos < effectiveBarWidth) {
              for (let col = endPos; col < effectiveBarWidth; col++) {
                if (chars[col] === ' ' || chars[col] === GRID_CHAR) {
                  chars[col] = H_RULE;
                }
              }
            }
          }
        }
      }

      barContent = colorBarChars(chars, blockColorFn, gridColor);
    }

    // Assemble lines with optional gutter prefix
    if (arrowCtx && arrowCtx.gutterGrid.length > 0) {
      const barRow = arrowCtx.chunkRow + 1;

      // Header line: gutter is spaces (connector chars only on bar rows)
      const headerLine = ' '.repeat(GUTTER_WIDTH) + headerContent;

      // Bar line: gutter connector chars + bar content
      let barGutter: string;
      if (barRow < arrowCtx.gutterGrid.length) {
        barGutter = renderGutterString(arrowCtx.gutterGrid[barRow], connColor);
      } else {
        barGutter = ' '.repeat(GUTTER_WIDTH);
      }
      const barLine = barGutter + barContent;

      return [headerLine, barLine];
    } else {
      return [headerContent, barContent];
    }
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
    for (const w of warnings) {
      const prefix = '  - ';
      const maxWarnLen = termWidth - prefix.length;
      const truncW = w.length > maxWarnLen ? w.slice(0, maxWarnLen - 1) + '\u2026' : w;
      lines.push(`${prefix}${warnColor(truncW)}`);
    }
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
