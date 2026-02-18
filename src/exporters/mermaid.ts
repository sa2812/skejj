import type { SolvedSchedule } from '../../index';
import type { ScheduleInput } from '../schema';

/**
 * Render a solved schedule as a Mermaid Gantt chart in a markdown fenced code block.
 *
 * Uses dateFormat HH:mm and axisFormat %H:%M for intraday schedules.
 * When startTime is present on solved steps, wall-clock times are derived.
 * When not, offset-based times starting from 00:00 are used.
 *
 * Critical path steps are tagged with `crit`.
 * Steps are grouped by track (section TrackName); steps without a track go in a default section.
 * Task IDs are sanitized: non-alphanumeric characters replaced with `_`.
 * Duration format: `Xm` (e.g., `30m`) -- Mermaid only recognizes `Xm` for minutes.
 */
export function renderMermaidGantt(schedule: SolvedSchedule, template: ScheduleInput): string {
  const sorted = [...schedule.solvedSteps].sort(
    (a, b) => a.startOffsetMins - b.startOffsetMins,
  );

  // Derive base clock minutes offset (midnight = 0) so we can produce HH:mm timestamps.
  // If the first step has a startTime ISO string, use that to anchor the clock.
  // Otherwise, treat offset 0 as 00:00.
  const baseMinutes = (() => {
    if (sorted.length > 0 && sorted[0].startTime) {
      const m = sorted[0].startTime.match(/T(\d{2}):(\d{2})/);
      if (m) {
        const wallMins = parseInt(m[1]) * 60 + parseInt(m[2]);
        return wallMins - sorted[0].startOffsetMins;
      }
    }
    return 0;
  })();

  function toHHMM(offsetMins: number): string {
    const total = baseMinutes + offsetMins;
    const h = Math.floor(total / 60) % 24;
    const mm = total % 60;
    return `${h.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
  }

  function sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9]/g, '_');
  }

  // Build sections: map from trackId (or '__default__') to list of steps
  const sections = new Map<string, typeof sorted>();
  const trackOrder: string[] = [];

  // Collect track order from template (preserves user-defined order)
  for (const track of template.tracks) {
    trackOrder.push(track.id);
    sections.set(track.id, []);
  }
  // Add default section for untracked steps
  sections.set('__default__', []);

  for (const step of sorted) {
    const tmplStep = template.steps.find((s) => s.id === step.stepId);
    const trackId = tmplStep?.trackId;
    if (trackId && sections.has(trackId)) {
      sections.get(trackId)!.push(step);
    } else {
      sections.get('__default__')!.push(step);
    }
  }

  const lines: string[] = [];
  lines.push('```mermaid');
  lines.push('gantt');
  lines.push(`  title ${template.name}`);
  lines.push('  dateFormat HH:mm');
  lines.push('  axisFormat %H:%M');

  // Determine whether to use sections
  const hasTracks = template.tracks.length > 0;

  if (hasTracks) {
    // Emit sections in track order, then default section
    for (const trackId of trackOrder) {
      const steps = sections.get(trackId) ?? [];
      if (steps.length === 0) continue;
      const track = template.tracks.find((t) => t.id === trackId);
      lines.push('');
      lines.push(`  section ${track?.name ?? trackId}`);
      for (const step of steps) {
        lines.push(buildTaskLine(step, toHHMM, sanitizeId, template));
      }
    }

    const defaultSteps = sections.get('__default__') ?? [];
    if (defaultSteps.length > 0) {
      lines.push('');
      lines.push('  section Other');
      for (const step of defaultSteps) {
        lines.push(buildTaskLine(step, toHHMM, sanitizeId, template));
      }
    }
  } else {
    // No tracks: flat list
    lines.push('');
    for (const step of sorted) {
      lines.push(buildTaskLine(step, toHHMM, sanitizeId, template));
    }
  }

  lines.push('```');

  return lines.join('\n');
}

function buildTaskLine(
  step: { stepId: string; startOffsetMins: number; endOffsetMins: number; isCritical: boolean },
  toHHMM: (offset: number) => string,
  sanitizeId: (id: string) => string,
  template: ScheduleInput,
): string {
  const tmplStep = template.steps.find((s) => s.id === step.stepId);
  // Sanitize title: remove colons and semicolons which confuse Mermaid's parser
  const rawTitle = (tmplStep?.title ?? step.stepId).replace(/[:;]/g, ' ').trim();
  const safeId = sanitizeId(step.stepId);
  const tag = step.isCritical ? 'crit, ' : '';
  const startStr = toHHMM(step.startOffsetMins);
  const dur = step.endOffsetMins - step.startOffsetMins;
  return `  ${rawTitle}   :${tag}${safeId}, ${startStr}, ${dur}m`;
}
