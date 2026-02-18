import { createRequire } from 'node:module';
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { loadSchedule } from '../loader.js';
import { renderGantt } from '../renderer.js';
import { exportSchedule, FormatName, FORMAT_EXTENSIONS } from '../exporters/index.js';

// Import napi bindings via createRequire to load CJS .node module from ESM context
const require = createRequire(import.meta.url);
const bindings = require('../../index') as typeof import('../../index.js');

const VALID_FORMATS: FormatName[] = ['gantt', 'csv', 'json'];

export const makeCommand = new Command('make')
  .description('Solve a schedule file and display the timed plan')
  .argument('<file>', 'Path to schedule JSON file')
  .option('-o, --output <file>', 'Write output to file instead of stdout (or override export destination when --format is used)')
  .option('-q, --quiet', 'Suppress summary stats, show only the schedule')
  .option('-f, --format <type>', 'Export format: gantt, csv, json (writes a file in addition to ASCII terminal output)')
  .action((file: string, options: { output?: string; quiet?: boolean; format?: string }) => {
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

      // ASCII Gantt always prints to terminal (stdout), regardless of --format
      const asciiOutput = renderGantt(result, loaded.data, {
        quiet: options.quiet ?? false,
        termWidth: process.stdout.columns ?? 80,
      });

      if (options.format) {
        // --format present: validate format, write export file, and always print ASCII to stdout
        const fmt = options.format as string;
        if (!VALID_FORMATS.includes(fmt as FormatName)) {
          console.error(`Error: Unknown format "${fmt}". Valid formats: ${VALID_FORMATS.join(', ')}`);
          process.exit(1);
        }

        const format = fmt as FormatName;
        const formatted = exportSchedule(format, result, loaded.data);

        // Derive output file path: --output override, or auto-name from input filename
        let outPath: string;
        if (options.output) {
          outPath = path.resolve(options.output);
        } else {
          const base = path.basename(file, path.extname(file));
          outPath = path.resolve(`${base}${FORMAT_EXTENSIONS[format]}`);
        }

        // Write export file
        fs.writeFileSync(outPath, formatted);

        // Always print ASCII to stdout
        console.log(asciiOutput);

        // Confirmation to stderr so it doesn't mix with stdout ASCII output
        console.error(`Exported ${format} to ${outPath}`);
      } else {
        // --format absent: existing behavior
        // --output writes ASCII to file; otherwise print to stdout
        if (options.output) {
          const outPath = path.resolve(options.output);
          fs.writeFileSync(outPath, asciiOutput + '\n');
          console.log(`Schedule written to ${outPath}`);
        } else {
          console.log(asciiOutput);
        }
      }
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });
