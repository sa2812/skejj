import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import React from 'react';
import { renderGantt, detectColorLevel } from '../renderer.js';
import type { ScheduleInput } from '../schema.js';
import type { WizardAppProps } from '../ui/WizardApp.js';
import { solve } from '../engine.js';

export const newCommand = new Command('new')
  .description('Guided wizard to create a new schedule')
  .action(async () => {
    // TTY guard: wizard requires an interactive terminal
    if (!process.stdin.isTTY) {
      console.error('Error: skejj new requires an interactive terminal. Cannot run in a pipe.');
      process.exit(1);
    }

    let completedSchedule: ScheduleInput | null = null;
    let completedFilename: string | null = null;

    const onComplete: WizardAppProps['onComplete'] = (schedule, filename) => {
      completedSchedule = schedule;
      completedFilename = filename;
    };

    // Dynamic imports required: Ink and WizardApp are ESM-only
    // tsx handles CJS-to-ESM interop transparently at runtime
    const { render } = await import('ink');
    const { default: WizardApp } = await import('../ui/WizardApp.js');

    const { waitUntilExit } = render(
      React.createElement(WizardApp as React.ComponentType<WizardAppProps>, { onComplete })
    );

    await waitUntilExit();

    // After the wizard exits, write the file and display the Gantt
    if (completedSchedule && completedFilename) {
      const schedule = completedSchedule;
      const filename = completedFilename;
      const fullPath = path.resolve(process.cwd(), filename);

      // 1. Write JSON to CWD
      fs.writeFileSync(fullPath, JSON.stringify(schedule, null, 2));

      // 2. Auto-solve using engine
      const solvedResult = solve(schedule);

      // 3. Display the Gantt chart inline
      const colorLevel = detectColorLevel();
      const gantt = renderGantt(solvedResult, schedule, {
        quiet: false,
        termWidth: process.stdout.columns ?? 80,
        colorLevel,
      });
      console.log(gantt);

      // 4. Print confirmation
      console.error(`Written: ./${filename}`);
    }
  });
