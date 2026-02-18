#!/usr/bin/env node
import { Command } from 'commander';
import { makeCommand } from './commands/make';
import { checkCommand } from './commands/check';
import { newCommand } from './commands/new';
import { generateCommand } from './commands/generate';
import { configCommand } from './commands/config';

const program = new Command();

program
  .name('skejj')
  .description('Constraint-based schedule solver')
  .version('0.1.0');

program.addCommand(makeCommand);
program.addCommand(checkCommand);
program.addCommand(newCommand);
program.addCommand(generateCommand);
program.addCommand(configCommand);

program.parse();
