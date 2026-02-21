/**
 * End-to-end tests for the compiled skejj CLI.
 *
 * Prerequisites: run `npm run build:all` (builds Rust binary + JS bundle)
 * before running these tests. The tests spawn `node dist/index.js` and
 * verify stdout, stderr and exit codes.
 *
 * Run with: npx vitest run
 */

import { describe, it, expect } from 'vitest';
import { execaNode } from 'execa';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Absolute path to the compiled CLI entry point
const CLI = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '../dist/index.js');
// Absolute path to the examples directory
const EXAMPLES = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '../examples');
// Absolute path to the test fixtures directory
const FIXTURES = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '../tests/fixtures');

// ---------------------------------------------------------------------------
// Helper: run the CLI with given args; captures stdout + stderr.
// Never throws — returns the result with exitCode so we can assert on it.
// ---------------------------------------------------------------------------
async function run(args: string[], opts: { cwd?: string } = {}) {
  try {
    const result = await execaNode(CLI, args, {
      cwd: opts.cwd ?? process.cwd(),
      reject: false,
    });
    return result;
  } catch (err: unknown) {
    // execaNode can still throw on spawn errors (file not found etc.)
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('skejj CLI', () => {

  // -------------------------------------------------------------------------
  // Test 1: make produces Gantt chart
  // -------------------------------------------------------------------------
  it('make produces ASCII Gantt for roast-chicken.json', async () => {
    const result = await run(['make', join(EXAMPLES, 'roast-chicken.json')]);

    expect(result.exitCode).toBe(0);
    // Gantt uses Unicode block characters for bars
    expect(result.stdout).toMatch(/[█░]/);
    // Step titles should appear
    expect(result.stdout).toContain('Roast chicken');
    expect(result.stdout).toContain('Prep chicken');
    // Summary line
    expect(result.stdout).toMatch(/Total:.*\d+[hm]/);
  });

  // -------------------------------------------------------------------------
  // Test 2: check validates successfully
  // -------------------------------------------------------------------------
  it('check reports valid for roast-chicken.json', async () => {
    const result = await run(['check', join(EXAMPLES, 'roast-chicken.json')]);

    expect(result.exitCode).toBe(0);
    // Should contain "valid" text (case-insensitive match)
    expect(result.stdout.toLowerCase()).toContain('valid');
  });

  // -------------------------------------------------------------------------
  // Test 3: check reports errors for bad input
  // -------------------------------------------------------------------------
  it('check reports errors for invalid schedule JSON', async () => {
    // Write a temp file with invalid schedule content (missing required fields)
    const tmpDir = await mkdtemp(join(tmpdir(), 'skejj-test-'));
    const badFile = join(tmpDir, 'bad.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(badFile, JSON.stringify({ invalid: 'content' }));

    try {
      const result = await run(['check', badFile]);

      expect(result.exitCode).not.toBe(0);
      // Error output should mention missing fields or validation errors
      const combinedOutput = result.stdout + result.stderr;
      expect(combinedOutput.toLowerCase()).toMatch(/error|required|invalid/);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // Test 4: make with --format json exports a .json file
  // -------------------------------------------------------------------------
  it('make with --format json creates a JSON export file', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'skejj-test-'));

    try {
      const result = await run(
        ['make', join(EXAMPLES, 'roast-chicken.json'), '--format', 'json'],
        { cwd: tmpDir }
      );

      expect(result.exitCode).toBe(0);
      // Should mention exported file in stdout or stderr
      const combinedOutput = result.stdout + result.stderr;
      expect(combinedOutput.toLowerCase()).toContain('export');

      // A .json file should exist in the temp dir
      const { readdir } = await import('node:fs/promises');
      const files = await readdir(tmpDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      expect(jsonFiles.length).toBeGreaterThan(0);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // Test 5: version flag
  // -------------------------------------------------------------------------
  it('--version flag prints version number', async () => {
    const result = await run(['--version']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('0.1.0');
  });

  // -------------------------------------------------------------------------
  // Test 6: help flag
  // -------------------------------------------------------------------------
  it('--help flag lists commands', async () => {
    const result = await run(['--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toLowerCase()).toContain('skejj');
    // Should list known command names
    expect(result.stdout).toContain('make');
    expect(result.stdout).toContain('check');
    expect(result.stdout).toContain('generate');
  });

  // -------------------------------------------------------------------------
  // Test 7: YAML make produces ASCII Gantt
  // -------------------------------------------------------------------------
  it('make produces ASCII Gantt for simple.yaml', async () => {
    const result = await run(['make', join(EXAMPLES, 'simple.yaml')]);

    expect(result.exitCode).toBe(0);
    // Step titles should appear
    expect(result.stdout).toContain('Step A');
    expect(result.stdout).toContain('Step B');
    // Summary line
    expect(result.stdout).toMatch(/Total:/);
  });

  // -------------------------------------------------------------------------
  // Test 8: YAML check reports valid
  // -------------------------------------------------------------------------
  it('check reports valid for simple.yaml', async () => {
    const result = await run(['check', join(EXAMPLES, 'simple.yaml')]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toLowerCase()).toContain('valid');
  });

  // -------------------------------------------------------------------------
  // Test 9: YAML parse error shows line info
  // -------------------------------------------------------------------------
  it('check reports YAML parse error with line info', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'skejj-test-'));
    const badYamlFile = join(tmpDir, 'bad.yaml');
    const { writeFile } = await import('node:fs/promises');
    // Unclosed bracket — triggers a YAMLParseError with linePos
    await writeFile(badYamlFile, 'id: test\nsteps:\n  - bad yaml: [\n');

    try {
      const result = await run(['check', badYamlFile]);

      expect(result.exitCode).not.toBe(0);
      const combinedOutput = result.stdout + result.stderr;
      // Error message should mention YAML
      expect(combinedOutput.toLowerCase()).toContain('yaml');
      // Error message should mention line location
      expect(combinedOutput.toLowerCase()).toContain('line');
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // Test 10: --quiet suppresses suggestions
  // -------------------------------------------------------------------------
  it('make --quiet suppresses suggestions', async () => {
    const result = await run(['make', join(EXAMPLES, 'roast-chicken.json'), '--quiet']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('Try next');
    expect(result.stdout).not.toContain('Did you know');
  });

  // -------------------------------------------------------------------------
  // Test 11: piped (non-TTY) output suppresses suggestions
  // -------------------------------------------------------------------------
  it('piped output suppresses suggestions (non-TTY)', async () => {
    // execa captures stdout via pipe, which means isTTY is false — suggestions suppressed
    const result = await run(['make', join(EXAMPLES, 'roast-chicken.json')]);
    expect(result.exitCode).toBe(0);
    // In non-TTY mode, suggestions should be suppressed
    expect(result.stdout).not.toContain('Try next');
  });

  // -------------------------------------------------------------------------
  // Resource override tests (RES-01, RES-02, RES-03, RES-04)
  // -------------------------------------------------------------------------

  // Test 12: --resource flag applies override and shows resource table
  it('make with --resource applies override and shows resource table', async () => {
    const result = await run(['make', join(EXAMPLES, 'roast-chicken.json'), '--resource', 'Oven=1']);
    expect(result.exitCode).toBe(0);
    // Resource table should appear with arrow notation
    expect(result.stdout).toContain('Resources ---');
    expect(result.stdout).toMatch(/Oven.*2 -> 1/);
  });

  // Test 13: -r short flag works
  it('make with -r short flag works', async () => {
    const result = await run(['make', join(EXAMPLES, 'roast-chicken.json'), '-r', 'Oven=3']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Resources ---');
    expect(result.stdout).toMatch(/Oven.*2 -> 3/);
  });

  // Test 14: unknown resource name errors with suggestion
  it('unknown resource name produces error with suggestion', async () => {
    const result = await run(['make', join(EXAMPLES, 'roast-chicken.json'), '--resource', 'Ovn=2']);
    expect(result.exitCode).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain('Unknown resource');
    expect(output).toContain('Did you mean');
    expect(output).toContain('Oven');
  });

  // Test 15: unknown resource with no close match lists valid names
  it('unknown resource lists valid resource names', async () => {
    const result = await run(['make', join(EXAMPLES, 'roast-chicken.json'), '--resource', 'xyz=2']);
    expect(result.exitCode).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain('Unknown resource');
    expect(output).toContain('Valid resources');
  });

  // Test 16: non-numeric value errors
  it('non-numeric resource value produces error', async () => {
    const result = await run(['make', join(EXAMPLES, 'roast-chicken.json'), '--resource', 'Oven=abc']);
    expect(result.exitCode).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain('Must be a number');
  });

  // Test 17: zero value errors
  it('zero resource value produces error', async () => {
    const result = await run(['make', join(EXAMPLES, 'roast-chicken.json'), '--resource', 'Oven=0']);
    expect(result.exitCode).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain('cannot be set to 0');
  });

  // Test 18: no resource table without overrides
  it('no resource table when no overrides passed', async () => {
    const result = await run(['make', join(EXAMPLES, 'roast-chicken.json')]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('Resources ---');
  });

  // Test 19: consumable override via CLI shows remaining capacity (RES-04 E2E)
  it('consumable override via CLI increases capacity and shows remaining', async () => {
    // Without override: 60+60=120 > 100 capacity, expect shortage warning
    const noOverride = await run(['make', join(FIXTURES, 'consumable-override.json')]);
    expect(noOverride.exitCode).toBe(0);
    expect(noOverride.stdout).toMatch(/run out|shortfall|shortage/i);

    // With override to 200: 60+60=120 <= 200, no shortage
    const withOverride = await run(['make', join(FIXTURES, 'consumable-override.json'), '--resource', 'Dough=200']);
    expect(withOverride.exitCode).toBe(0);
    // Should show resource table with arrow notation for Dough
    expect(withOverride.stdout).toContain('Resources ---');
    expect(withOverride.stdout).toMatch(/Dough.*100 -> 200/);
    // Should show remaining capacity (200 - 120 = 80 remaining)
    expect(withOverride.stdout).toMatch(/80 remaining/);
    // Should NOT have shortage warning
    expect(withOverride.stdout).not.toMatch(/run out|shortfall|shortage/i);
  });

});
