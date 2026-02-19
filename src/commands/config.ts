/**
 * skejj config - Manage LLM provider configuration
 *
 * Subcommands:
 *   config set <key> <value>  - Persist a config value
 *   config show               - Display all stored config (masked apiKey)
 */

import { Command } from 'commander';
import { setAiConfig, showAiConfig } from '../ai/config.js';

export const configCommand = new Command('config')
  .description('Manage LLM provider configuration');

configCommand.addHelpText('after', `
Examples:
  $ skejj config show
  $ skejj config set provider openai
  $ skejj config set apiKey sk-...`);

configCommand
  .command('set <key> <value>')
  .description(
    'Set a configuration value\n' +
    '  Keys:\n' +
    '    provider   LLM provider (openai, anthropic)\n' +
    '    model      Model name (optional; defaults: gpt-4o, claude-sonnet-4-20250514)\n' +
    '    apiKey     API key for the provider'
  )
  .addHelpText('after', `
Examples:
  $ skejj config set provider openai
  $ skejj config set provider anthropic
  $ skejj config set apiKey sk-your-key-here
  $ skejj config set model gpt-4o`)
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
      const { values, missing } = await showAiConfig();
      const keys = Object.keys(values);
      if (keys.length === 0) {
        // Full empty state: show complete setup guide
        console.log('No configuration stored. To use AI features, run:\n');
        console.log('  skejj config set provider openai    (or: anthropic)');
        console.log('  skejj config set apiKey <your-key>');
        console.log('  skejj config set model <model>      (optional, defaults: gpt-4o / claude-sonnet-4-20250514)\n');
        console.log('Then: skejj generate "plan a birthday party"');
        return;
      }
      // Show current values
      for (const [k, v] of Object.entries(values)) {
        console.log(`${k}: ${v}`);
      }
      // Show missing required keys if partially configured
      if (missing.length > 0) {
        console.log(`\nMissing required: ${missing.join(', ')}`);
        for (const m of missing) {
          if (m === 'provider') console.log('  Run: skejj config set provider openai  (or: anthropic)');
          if (m === 'apiKey') console.log('  Run: skejj config set apiKey <your-key>');
        }
      }
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });
