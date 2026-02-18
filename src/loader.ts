import * as fs from 'fs';
import * as path from 'path';
import { scheduleSchema, type ScheduleInput } from './schema.js';

export type LoadResult =
  | { success: true; data: ScheduleInput }
  | { success: false; errors: string[] };

export function loadSchedule(filePath: string): LoadResult {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    return { success: false, errors: [`File not found: ${resolved}`] };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(resolved, 'utf-8');
  } catch (e) {
    return { success: false, errors: [`Cannot read file: ${(e as Error).message}`] };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { success: false, errors: [`Invalid JSON: ${(e as Error).message}`] };
  }

  const result = scheduleSchema.safeParse(json);
  if (!result.success) {
    const errors = result.error.issues.map((issue: { path: (string | number)[]; message: string }) => {
      const p = issue.path.join('.');
      return p ? `${p}: ${issue.message}` : issue.message;
    });
    return { success: false, errors };
  }

  return { success: true, data: result.data };
}
