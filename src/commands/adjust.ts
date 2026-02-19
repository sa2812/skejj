import { Command } from 'commander';
import React from 'react';
import { loadSchedule } from '../loader.js';
import type { AdjustAppProps } from '../ui/AdjustApp.js';
import { solve } from '../engine.js';

export const adjustCommand = new Command('adjust')
  .description('Interactively adjust a solved schedule in a re-solve loop')
  .argument('<file>', 'Path to schedule JSON file')
  .addHelpText('after', `
Examples:
  $ skejj adjust examples/roast-chicken.json
  $ skejj adjust myplan.json`)
  .action(async (file: string) => {
    // TTY guard: interactive terminal required
    if (!process.stdin.isTTY) {
      console.error('Error: skejj adjust requires an interactive terminal. Cannot run in a pipe.');
      process.exit(1);
    }

    const loaded = loadSchedule(file);
    if (!loaded.success) {
      console.error('Validation errors:');
      loaded.errors.forEach((e: string) => console.error(`  ${e}`));
      process.exit(1);
    }

    // Initial solve
    const solvedResult = solve(loaded.data);

    // Dynamic imports: Ink and AdjustApp are ESM-only
    const { render } = await import('ink');
    const { default: AdjustApp } = await import('../ui/AdjustApp.js');

    const { waitUntilExit } = render(
      React.createElement(AdjustApp as React.ComponentType<AdjustAppProps>, {
        initialSchedule: loaded.data,
        initialSolved: solvedResult,
        originalFile: file,
      })
    );

    await waitUntilExit();
  });
