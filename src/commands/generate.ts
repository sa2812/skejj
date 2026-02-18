/**
 * skejj generate - AI-powered schedule generation from natural language
 *
 * Usage: skejj generate "plan a birthday party for 10 kids"
 * Options:
 *   -o, --output <file>    Override output filename
 *   -f, --format <type>    Export format: gantt, csv, json (same as skejj make)
 */

import { createRequire } from 'node:module';
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { loadAiConfig } from '../ai/config.js';
import { buildModel } from '../ai/provider.js';
import { generateScheduleFromText } from '../ai/generate.js';
import { renderGantt } from '../renderer.js';
import { exportSchedule, FormatName, FORMAT_EXTENSIONS } from '../exporters/index.js';

// Import napi bindings via createRequire to load CJS .node module from ESM context
const require = createRequire(import.meta.url);
const bindings = require('../../index') as typeof import('../../index');

const VALID_FORMATS: FormatName[] = ['gantt', 'csv', 'json'];

/**
 * Convert a display name to a kebab-case filename.
 * e.g. "Birthday Party Plan" -> "birthday-party-plan"
 */
function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Simple stderr spinner using setInterval.
 * Returns a stop function that clears the spinner line.
 */
function startSpinner(label: string): () => void {
  const frames = ['|', '/', '-', '\\'];
  let i = 0;
  process.stderr.write('\n');
  const interval = setInterval(() => {
    process.stderr.write(`\r${frames[i % frames.length]} ${label}`);
    i++;
  }, 100);

  return () => {
    clearInterval(interval);
    // Clear the spinner line
    process.stderr.write('\r' + ' '.repeat(label.length + 4) + '\r');
  };
}

export const generateCommand = new Command('generate')
  .description('Generate a schedule from a natural language description using an LLM')
  .argument('<description>', 'Natural language description of the schedule to create')
  .option('-o, --output <file>', 'Override output filename (default: derived from schedule name)')
  .option(
    '-f, --format <type>',
    'Export format in addition to ASCII Gantt: gantt (Mermaid), csv, json',
  )
  .action(
    async (
      description: string,
      options: { output?: string; format?: string },
    ) => {
      // 1. Load AI config and run preflight check (env vars take priority — 12-factor)
      const config = await loadAiConfig();
      const effectiveProvider = process.env.SKEJJ_PROVIDER ?? config?.provider;
      const effectiveApiKey = process.env.SKEJJ_API_KEY ?? config?.apiKey;

      const configErrors: string[] = [];
      if (!effectiveProvider) {
        configErrors.push('No LLM provider configured. Run: skejj config set provider openai');
      }
      if (!effectiveApiKey) {
        configErrors.push('No API key configured. Run: skejj config set apiKey <your-key>');
      }
      if (configErrors.length > 0) {
        console.error('Missing AI configuration:\n');
        configErrors.forEach((e) => console.error(`  ${e}`));
        console.error('\nOr set environment variables: SKEJJ_PROVIDER, SKEJJ_API_KEY');
        process.exit(1);
      }

      // 2. Validate --format if provided
      if (options.format) {
        const fmt = options.format;
        if (!VALID_FORMATS.includes(fmt as FormatName)) {
          console.error(
            `Error: Unknown format "${fmt}". Valid formats: ${VALID_FORMATS.join(', ')}`,
          );
          process.exit(1);
        }
      }

      // 3. Build the LLM model instance
      let model;
      try {
        model = await buildModel(config);
      } catch (e) {
        console.error(`Error: ${(e as Error).message}`);
        process.exit(1);
      }

      // 4. Show spinner during LLM call
      const stopSpinner = startSpinner('Generating schedule...');

      let scheduleInput;
      try {
        scheduleInput = await generateScheduleFromText(description, model);
      } catch (e) {
        stopSpinner();
        console.error(`Error: ${(e as Error).message}`);
        process.exit(1);
      }
      stopSpinner();

      // 5. Derive output filename
      const kebab = toKebabCase(scheduleInput.name);
      const jsonFilename = options.output ?? `${kebab}.json`;
      const jsonPath = path.resolve(process.cwd(), jsonFilename);

      // 6. Warn if file already exists (non-interactive — don't prompt)
      if (fs.existsSync(jsonPath)) {
        console.error(`Warning: ${jsonFilename} already exists, overwriting.`);
      }

      // 7. Write JSON to CWD
      fs.writeFileSync(jsonPath, JSON.stringify(scheduleInput, null, 2));

      // 8. Auto-solve using napi bindings
      let solvedResult;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        solvedResult = bindings.solve(scheduleInput as any);
      } catch (e) {
        console.error(`Error solving schedule: ${(e as Error).message}`);
        process.exit(1);
      }

      // 9. Display ASCII Gantt (always to stdout)
      const gantt = renderGantt(solvedResult, scheduleInput, {
        quiet: false,
        termWidth: process.stdout.columns ?? 80,
      });
      console.log(gantt);

      // 10. If --format specified, export additional format
      if (options.format) {
        const format = options.format as FormatName;
        const formatted = exportSchedule(format, solvedResult, scheduleInput);

        const base = kebab;
        const exportPath = path.resolve(
          process.cwd(),
          `${base}${FORMAT_EXTENSIONS[format]}`,
        );

        fs.writeFileSync(exportPath, formatted);
        console.error(`Exported ${format} to ${exportPath}`);
      }

      // 11. Confirm JSON was written
      console.error(`Written: ./${jsonFilename}`);
    },
  );
