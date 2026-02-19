import { Command } from 'commander';
import { loadSchedule } from '../loader.js';
import { validate } from '../engine.js';

export const checkCommand = new Command('check')
  .description('Validate a schedule file without solving')
  .argument('<file>', 'Path to schedule JSON file')
  .option('-q, --quiet', 'Show only errors, suppress warnings')
  .action((file: string, options: { quiet?: boolean }) => {
    const loaded = loadSchedule(file);
    if (!loaded.success) {
      console.error('JSON validation errors:');
      loaded.errors.forEach((e: string) => console.error(`  ${e}`));
      process.exit(1);
    }

    const result = validate(loaded.data);

    if (result.errors.length > 0) {
      console.error('Errors:');
      result.errors.forEach((e: string) => console.error(`  ${e}`));
    }

    if (!options.quiet && result.warnings.length > 0) {
      console.log('Warnings:');
      result.warnings.forEach((w: string) => console.log(`  ${w}`));
    }

    if (result.errors.length === 0 && result.warnings.length === 0) {
      console.log('Schedule is valid.');
    } else if (result.errors.length === 0) {
      console.log('Schedule is valid (with warnings).');
    }

    process.exit(result.errors.length > 0 ? 1 : 0);
  });
