import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { loadSchedule } from '../loader';
import { renderGantt } from '../renderer';

// Import napi bindings - use require to handle native .node module
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bindings = require('../../index') as typeof import('../../index');

export const makeCommand = new Command('make')
  .description('Solve a schedule file and display the timed plan')
  .argument('<file>', 'Path to schedule JSON file')
  .option('-o, --output <file>', 'Write output to file instead of stdout')
  .option('-q, --quiet', 'Suppress summary stats, show only the schedule')
  .action((file: string, options: { output?: string; quiet?: boolean }) => {
    const loaded = loadSchedule(file);
    if (!loaded.success) {
      console.error('Validation errors:');
      loaded.errors.forEach((e: string) => console.error(`  ${e}`));
      process.exit(1);
    }

    try {
      // The Zod-inferred type and napi type are structurally identical
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = bindings.solve(loaded.data as any);

      const output = renderGantt(result, loaded.data, {
        quiet: options.quiet ?? false,
        termWidth: process.stdout.columns ?? 80,
      });

      if (options.output) {
        const outPath = path.resolve(options.output);
        fs.writeFileSync(outPath, output + '\n');
        console.log(`Schedule written to ${outPath}`);
      } else {
        console.log(output);
      }
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });
