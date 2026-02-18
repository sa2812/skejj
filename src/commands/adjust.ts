import { Command } from 'commander';
import React from 'react';
import { loadSchedule } from '../loader.js';
import type { AdjustAppProps } from '../ui/AdjustApp.js';

// Import napi bindings - use require to handle native .node module
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bindings = require('../../index') as typeof import('../../index');

export const adjustCommand = new Command('adjust')
  .description('Interactively adjust a solved schedule in a re-solve loop')
  .argument('<file>', 'Path to schedule JSON file')
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const solvedResult = bindings.solve(loaded.data as any);

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
