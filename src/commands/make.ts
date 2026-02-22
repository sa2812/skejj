import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { loadSchedule } from '../loader.js';
import { renderGantt, detectColorLevel } from '../renderer.js';
import { exportSchedule, FormatName, FORMAT_EXTENSIONS } from '../exporters/index.js';
import { solve } from '../engine.js';
import { shouldShowSuggestions, generateSuggestions } from '../suggestions.js';

const VALID_FORMATS: FormatName[] = ['gantt', 'csv', 'json'];

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

export const makeCommand = new Command('make')
  .description('Solve a schedule file and display the timed plan')
  .argument('<file>', 'Path to schedule JSON file')
  .option('-o, --output <file>', 'Write output to file instead of stdout (or override export destination when --format is used)')
  .option('-q, --quiet', 'Suppress summary stats, show only the schedule')
  .option('-f, --format <type>', 'Export format: gantt, csv, json (writes a file in addition to ASCII terminal output)')
  .option('--width <cols>', 'Chart width in columns (default: terminal width or 80)', parseInt)
  .option('-r, --resource <name=value>', 'Override resource availability (repeatable)', collect, [])
  .addHelpText('after', `
Examples:
  $ skejj make examples/roast-chicken.yaml
  $ skejj make schedule.yaml --width 120
  $ skejj make myplan.yaml --format csv
  $ skejj make myplan.yaml -q -o schedule.txt
  $ skejj make schedule.yaml -r Oven=2
  $ skejj make schedule.yaml -r Oven=2 -r Chef=3`)
  .action(async (file: string, options: { output?: string; quiet?: boolean; format?: string; width?: number; resource?: string[] }) => {
    const loaded = loadSchedule(file);
    if (!loaded.success) {
      console.error('Validation errors:');
      loaded.errors.forEach((e: string) => console.error(`  ${e}`));
      process.exit(1);
    }

    // Parse resource overrides
    const overrides: Record<string, number> = {};
    if (options.resource && options.resource.length > 0) {
      const templateResources = loaded.data.resources ?? [];
      const resourceNameSet = new Map(
        templateResources.map(r => [r.name.toLowerCase(), r])
      );

      const seen = new Map<string, number>();

      for (const raw of options.resource) {
        const eqIdx = raw.indexOf('=');
        if (eqIdx === -1) {
          console.error(`Error: Invalid resource override "${raw}". Expected format: name=value`);
          process.exit(1);
        }
        const name = raw.slice(0, eqIdx).trim();
        const valueStr = raw.slice(eqIdx + 1).trim();

        const value = Number(valueStr);
        if (isNaN(value)) {
          console.error(`Error: Invalid value "${valueStr}" for resource "${name}". Must be a number.`);
          process.exit(1);
        }

        if (value < 0) {
          console.error(`Error: Invalid value "${value}" for resource "${name}". Must be non-negative.`);
          process.exit(1);
        }

        if (value === 0) {
          console.error(`Error: Resource "${name}" cannot be set to 0 (minimum available resources is 1).`);
          process.exit(1);
        }

        const matched = resourceNameSet.get(name.toLowerCase());
        if (!matched) {
          const validNames = templateResources.map(r => r.name);
          let suggestion = '';
          if (validNames.length > 0) {
            let bestDist = Infinity;
            let bestName = '';
            for (const vn of validNames) {
              const d = levenshtein(name.toLowerCase(), vn.toLowerCase());
              if (d < bestDist) { bestDist = d; bestName = vn; }
            }
            if (bestDist <= 3) {
              suggestion = ` Did you mean "${bestName}"?`;
            }
          }
          console.error(`Error: Unknown resource "${name}".${suggestion}\nValid resources: ${validNames.join(', ')}`);
          process.exit(1);
        }

        if (seen.has(name.toLowerCase())) {
          console.error(`Warning: Resource "${name}" overridden multiple times. Using last value: ${value}`);
        }
        seen.set(name.toLowerCase(), value);

        overrides[matched.name] = Math.round(value);
      }
    }

    try {
      const inventory = Object.keys(overrides).length > 0 ? overrides : undefined;
      const result = solve(loaded.data, inventory);

      // Build resolvedResourceOverrides Map for suggestion module
      const resolvedResourceOverrides = new Map<string, number>();
      for (const [name, value] of Object.entries(overrides)) {
        const res = loaded.data.resources.find(r => r.name === name);
        if (res) resolvedResourceOverrides.set(res.id, value);
      }

      // Generate suggestions if appropriate (TTY, not quiet, not machine format)
      let suggestions = null;
      if (shouldShowSuggestions(options)) {
        try {
          suggestions = await generateSuggestions(result, loaded.data, file, options, resolvedResourceOverrides);
        } catch {
          // Suggestions are non-critical — silently skip on any error
          suggestions = null;
        }
      }

      const termWidth = options.width !== undefined
        ? options.width
        : Math.min(process.stdout.columns ?? 80, 80);
      const colorLevel = detectColorLevel();
      const asciiOutput = renderGantt(result, loaded.data, {
        quiet: options.quiet ?? false,
        termWidth,
        colorLevel,
        overrides,
        suggestions,
      });

      if (options.format) {
        const fmt = options.format as string;
        if (!VALID_FORMATS.includes(fmt as FormatName)) {
          console.error(`Error: Unknown format "${fmt}". Valid formats: ${VALID_FORMATS.join(', ')}`);
          process.exit(1);
        }

        const format = fmt as FormatName;
        const formatted = exportSchedule(format, result, loaded.data);

        let outPath: string;
        if (options.output) {
          outPath = path.resolve(options.output);
        } else {
          const base = path.basename(file, path.extname(file));
          outPath = path.resolve(`${base}${FORMAT_EXTENSIONS[format]}`);
        }

        fs.writeFileSync(outPath, formatted);
        console.log(asciiOutput);
        console.error(`Exported ${format} to ${outPath}`);
      } else {
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
