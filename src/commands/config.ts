/**
 * skejj config - Manage LLM provider configuration
 *
 * Subcommands:
 *   config set <key> <value>  - Persist a config value
 *   config show               - Display all stored config (masked apiKey)
 */

import { Command } from 'commander';
import { setAiConfig, showAiConfig } from '../ai/config';

export const configCommand = new Command('config')
  .description('Manage LLM provider configuration');

configCommand
  .command('set <key> <value>')
  .description('Set a configuration value (keys: provider, model, apiKey)')
  .action(async (key: string, value: string) => {
    try {
      await setAiConfig(key, value);
      // Mask apiKey in confirmation output
      const display =
        key === 'apiKey' && value.length > 4
          ? '****' + value.slice(-4)
          : value;
      console.log(`Set ${key} = ${display}`);
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });

configCommand
  .command('show')
  .description('Show current configuration')
  .action(async () => {
    try {
      const cfg = await showAiConfig();
      const keys = Object.keys(cfg);
      if (keys.length === 0) {
        console.log('No configuration stored. Run: skejj config set provider openai');
        return;
      }
      for (const [k, v] of Object.entries(cfg)) {
        console.log(`${k}: ${v}`);
      }
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });
