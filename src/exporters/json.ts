import type { SolvedSchedule } from '../../index.js';
import type { ScheduleInput } from '../schema.js';

/**
 * Render a solved schedule as pretty-printed JSON.
 *
 * Returns the full SolvedSchedule object serialized with 2-space indentation.
 */
export function renderJson(schedule: SolvedSchedule, _template: ScheduleInput): string {
  return JSON.stringify(schedule, null, 2);
}
