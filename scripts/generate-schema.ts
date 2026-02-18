import * as fs from 'fs';
import * as path from 'path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { scheduleSchema } from '../src/schema';

const schema = zodToJsonSchema(scheduleSchema, {
  name: 'ScheduleTemplate',
  target: 'jsonSchema7',
});

// Ensure $schema uses the canonical https URI (zod-to-json-schema emits http://)
const output = {
  ...schema,
  $schema: 'https://json-schema.org/draft-07/schema#',
};

const outPath = path.resolve(__dirname, '../docs/schema.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
console.log(`Schema written to ${outPath}`);
