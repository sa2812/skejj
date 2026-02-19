/**
 * Golden fixture tests for the renderer output.
 *
 * These tests capture the new visual design: Unicode block bars, chalk coloring,
 * gridlines, track separators, header, and width control. All tests use colorLevel: 0
 * for deterministic plain-text snapshots.
 *
 * Run with: npx vitest run tests/renderer.test.ts
 */

import { describe, it, expect } from 'vitest';
import { renderGantt } from '../src/renderer.js';
import { solve } from '../src/engine.js';
import { loadSchedule } from '../src/loader.js';
import { resolve } from 'node:path';

const EXAMPLES = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '../examples');

function renderExample(filename: string, opts?: { width?: number; quiet?: boolean }) {
  const loaded = loadSchedule(resolve(EXAMPLES, filename));
  if (!loaded.success) throw new Error(`Failed to load ${filename}: ${loaded.errors.join(', ')}`);
  const result = solve(loaded.data);
  return renderGantt(result, loaded.data, {
    quiet: opts?.quiet ?? true,
    termWidth: opts?.width ?? 80,
    colorLevel: 0, // always plain text in tests
  });
}

describe('renderer golden fixtures', () => {
  it('roast-chicken.json at 80 cols', () => {
    const output = renderExample('roast-chicken.json');
    expect(output).toMatchSnapshot();
  });

  it('london-sightseeing.json at 80 cols', () => {
    const output = renderExample('london-sightseeing.json');
    expect(output).toMatchSnapshot();
  });

  it('birthday-party.json at 80 cols', () => {
    const output = renderExample('birthday-party.json');
    expect(output).toMatchSnapshot();
  });

  it('simple.json at 80 cols', () => {
    const output = renderExample('simple.json');
    expect(output).toMatchSnapshot();
  });

  it('roast-chicken.json at 120 cols', () => {
    const output = renderExample('roast-chicken.json', { width: 120 });
    expect(output).toMatchSnapshot();
  });

  it('roast-chicken.json with quiet: false', () => {
    const output = renderExample('roast-chicken.json', { quiet: false });
    expect(output).toMatchSnapshot();
  });

  it('colorLevel 0 produces no ANSI codes', () => {
    const output = renderExample('roast-chicken.json');
    // eslint-disable-next-line no-control-regex
    expect(output).not.toMatch(/\x1b\[/);
  });

  it('multi-track schedule shows track separators', () => {
    const output = renderExample('london-sightseeing.json');
    expect(output).toContain('Day 1');
    expect(output).toContain('Day 2');
    // Track separators use horizontal rule characters
    expect(output).toMatch(/[─-]+ Day [12] [─-]+/);
  });

  it('shows schedule name as header', () => {
    const output = renderExample('roast-chicken.json');
    expect(output).toContain('Roast Chicken Dinner');
  });

  it('120-col bars are wider than 80-col bars', () => {
    const output80 = renderExample('roast-chicken.json', { width: 80 });
    const output120 = renderExample('roast-chicken.json', { width: 120 });
    // The roast chicken bar at 120 cols should be longer than at 80 cols
    // Count the full-block chars on the roast chicken line
    const roastLine80 = output80.split('\n').find((l) => l.startsWith('Roast chicken')) ?? '';
    const roastLine120 = output120.split('\n').find((l) => l.startsWith('Roast chicken')) ?? '';
    const blocks80 = (roastLine80.match(/█/g) ?? []).length;
    const blocks120 = (roastLine120.match(/█/g) ?? []).length;
    expect(blocks120).toBeGreaterThan(blocks80);
  });
});
