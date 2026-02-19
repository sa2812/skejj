import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml, YAMLParseError } from 'yaml';
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

  const ext = path.extname(resolved).toLowerCase();
  let parsed: unknown;

  if (ext === '.yaml' || ext === '.yml') {
    try {
      // prettyErrors: true is default — YAMLParseError will have linePos
      parsed = parseYaml(raw);
    } catch (e) {
      if (e instanceof YAMLParseError) {
        const loc = e.linePos?.[0];
        const where = loc ? ` (line ${loc.line}, col ${loc.col})` : '';
        return { success: false, errors: [`Invalid YAML${where}: ${e.message}`] };
      }
      return { success: false, errors: [`Cannot parse YAML: ${(e as Error).message}`] };
    }
  } else {
    // Default: treat as JSON (existing behavior)
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return { success: false, errors: [`Invalid JSON: ${(e as Error).message}`] };
    }
  }

  const result = scheduleSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map((issue: { path: (string | number)[]; message: string }) => {
      const p = issue.path.join('.');
      return p ? `${p}: ${issue.message}` : issue.message;
    });
    return { success: false, errors };
  }

  return { success: true, data: result.data };
}
