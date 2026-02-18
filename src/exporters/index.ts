import type { SolvedSchedule } from '../../index';
import type { ScheduleInput } from '../schema';
import { renderMermaidGantt } from './mermaid';
import { renderCsv } from './csv';
import { renderJson } from './json';

export { renderMermaidGantt } from './mermaid';
export { renderCsv } from './csv';
export { renderJson } from './json';

/** Supported export format names. */
export type FormatName = 'gantt' | 'csv' | 'json';

/** File extension for each export format (includes the leading dot). */
export const FORMAT_EXTENSIONS: Record<FormatName, string> = {
  gantt: '.md',
  csv: '.csv',
  json: '.json',
};

/**
 * Dispatch to the correct renderer based on the requested format.
 *
 * @param format - One of 'gantt', 'csv', 'json'
 * @param schedule - The solved schedule from the engine
 * @param template - The original schedule input (for names, tracks, resources)
 * @returns The formatted string ready to write to a file
 */
export function exportSchedule(
  format: FormatName,
  schedule: SolvedSchedule,
  template: ScheduleInput,
): string {
  switch (format) {
    case 'gantt':
      return renderMermaidGantt(schedule, template);
    case 'csv':
      return renderCsv(schedule, template);
    case 'json':
      return renderJson(schedule, template);
  }
}
