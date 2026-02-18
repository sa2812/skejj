import type { SolvedSchedule, SolvedStep } from '../index';
import type { ScheduleInput } from './schema';

export interface RenderOptions {
  quiet: boolean;
  termWidth: number;
}

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
  // Parse ISO string and return HH:MM
  const match = isoStr.match(/T(\d{2}:\d{2})/);
  if (match) return match[1];
  return isoStr;
}

export function renderGantt(
  schedule: SolvedSchedule,
  template: ScheduleInput,
  options: RenderOptions,
): string {
  const lines: string[] = [];
  const { solvedSteps, summary, warnings } = schedule;
  const totalMins = summary.totalDurationMins;

  // Sort steps by start offset
  const sorted = [...solvedSteps].sort((a, b) => a.startOffsetMins - b.startOffsetMins);

  // Determine name column width
  const maxNameLen = Math.max(...sorted.map((s) => {
    const step = template.steps.find((t) => t.id === s.stepId);
    return (step?.title ?? s.stepId).length;
  }), 10);
  const nameCol = maxNameLen + 2;

  // Bar area width
  const barWidth = Math.max(options.termWidth - nameCol - 3, 20);

  // Use wall-clock times if available
  const hasWallClock = sorted.length > 0 && sorted[0].startTime != null;

  // Time axis
  const tickInterval = totalMins <= 60 ? 15 : totalMins <= 240 ? 30 : totalMins <= 720 ? 60 : 120;
  const ticks: number[] = [];
  for (let t = 0; t <= totalMins; t += tickInterval) ticks.push(t);
  if (ticks[ticks.length - 1] !== totalMins) ticks.push(totalMins);

  // Build time axis line
  let axisLine = ' '.repeat(nameCol + 1);
  for (const tick of ticks) {
    const pos = Math.round((tick / totalMins) * barWidth);
    const label = hasWallClock && sorted[0].startTime
      ? (() => {
          // Compute wall-clock for this tick by finding step at this time
          const baseTime = sorted[0].startTime!;
          const match = baseTime.match(/^(\d{4}-\d{2}-\d{2}T)(\d{2}):(\d{2})/);
          if (match) {
            const baseH = parseInt(match[2]);
            const baseM = parseInt(match[3]);
            const totalTickMins = baseH * 60 + baseM + tick;
            const th = Math.floor(totalTickMins / 60) % 24;
            const tm = totalTickMins % 60;
            return `${th.toString().padStart(2, '0')}:${tm.toString().padStart(2, '0')}`;
          }
          return formatOffset(tick);
        })()
      : formatOffset(tick);
    // Place label at position
    const insertAt = nameCol + 1 + pos;
    const padded = axisLine.padEnd(insertAt, ' ');
    axisLine = padded + label;
  }
  lines.push(summary.totalDurationMins > 0 ? axisLine : '');

  // Step bars
  for (const step of sorted) {
    const tmplStep = template.steps.find((t) => t.id === step.stepId);
    const name = tmplStep?.title ?? step.stepId;
    const namePad = name.padEnd(nameCol);

    const barStart = Math.round((step.startOffsetMins / totalMins) * barWidth);
    const barEnd = Math.round((step.endOffsetMins / totalMins) * barWidth);
    const barLen = Math.max(barEnd - barStart, 1);

    const bar = ' '.repeat(barStart) + '[' + '#'.repeat(Math.max(barLen - 2, 1)) + ']';
    lines.push(`${namePad} ${bar}`);
  }

  // Summary section
  if (!options.quiet) {
    lines.push('');
    lines.push('--- Summary ---');
    lines.push(`Total time: ${formatDuration(summary.totalDurationMins)}`);
    lines.push(`Steps: ${solvedSteps.length}`);

    const criticalSteps = solvedSteps.filter((s) => s.isCritical);
    const criticalDuration = criticalSteps.reduce((sum, s) => sum + (s.endOffsetMins - s.startOffsetMins), 0);
    lines.push(`Critical path: ${formatDuration(criticalDuration)} (${criticalSteps.length} step${criticalSteps.length === 1 ? '' : 's'})`);

    // Resources used
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

    // Critical path detail
    lines.push('');
    lines.push('--- Critical Path ---');
    const criticalSorted = sorted.filter((s) => s.isCritical);
    if (criticalSorted.length > 0) {
      const cpChain = criticalSorted.map((s) => {
        const tmplStep = template.steps.find((t) => t.id === s.stepId);
        return tmplStep?.title ?? s.stepId;
      }).join(' -> ');
      lines.push(cpChain);
      lines.push('');
      lines.push('Float per step:');

      for (const step of sorted) {
        const tmplStep = template.steps.find((t) => t.id === step.stepId);
        const name = tmplStep?.title ?? step.stepId;
        const timeStr = hasWallClock && step.startTime && step.endTime
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

  // Warnings
  if (warnings.length > 0) {
    lines.push('');
    lines.push('--- Warnings ---');
    for (const w of warnings) lines.push(`  - ${w}`);
  }

  return lines.join('\n');
}
