import type { SolvedSchedule } from '../../index.js';
import type { ScheduleInput } from '../schema.js';

/**
 * Render a solved schedule as a CSV string.
 *
 * Headers:
 *   stepId,title,trackId,startOffsetMins,endOffsetMins,durationMins,
 *   startTime,endTime,isCritical,totalFloatMins,resources
 *
 * - Title fields are wrapped in double quotes; internal double quotes are doubled.
 * - Resources column: semicolon-separated `resourceId:quantity` pairs.
 * - Missing optional fields (startTime, endTime, trackId) are empty strings.
 * - Rows sorted by startOffsetMins ascending.
 * - Lines terminated with \n (Unix line endings).
 */
export function renderCsv(schedule: SolvedSchedule, template: ScheduleInput): string {
  const headers = [
    'stepId',
    'title',
    'trackId',
    'startOffsetMins',
    'endOffsetMins',
    'durationMins',
    'startTime',
    'endTime',
    'isCritical',
    'totalFloatMins',
    'resources',
  ];

  const sorted = [...schedule.solvedSteps].sort(
    (a, b) => a.startOffsetMins - b.startOffsetMins,
  );

  const rows = sorted.map((step) => {
    const tmplStep = template.steps.find((s) => s.id === step.stepId);

    // Quote the title, escaping internal double quotes by doubling them
    const rawTitle = tmplStep?.title ?? step.stepId;
    const quotedTitle = `"${rawTitle.replace(/"/g, '""')}"`;

    const trackId = tmplStep?.trackId ?? '';
    const durationMins = step.endOffsetMins - step.startOffsetMins;
    const startTime = step.startTime ?? '';
    const endTime = step.endTime ?? '';

    // Resources: semicolon-separated resourceId:quantity pairs
    const resources = step.assignedResources
      .map((r) => `${r.resourceId}:${r.quantityUsed}`)
      .join(';');

    return [
      step.stepId,
      quotedTitle,
      trackId,
      step.startOffsetMins,
      step.endOffsetMins,
      durationMins,
      startTime,
      endTime,
      step.isCritical,
      step.totalFloatMins,
      resources,
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n') + '\n';
}
