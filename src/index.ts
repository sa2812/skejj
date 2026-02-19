import { Command } from 'commander';
import { makeCommand } from './commands/make.js';
import { checkCommand } from './commands/check.js';
import { newCommand } from './commands/new.js';
import { generateCommand } from './commands/generate.js';
import { configCommand } from './commands/config.js';
import { adjustCommand } from './commands/adjust.js';

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
program.addCommand(adjustCommand);

program.parse();
