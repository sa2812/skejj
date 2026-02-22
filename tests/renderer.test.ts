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
import type { SuggestionsBlock } from '../src/suggestions.js';

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
  it('roast-chicken.yaml at 80 cols', () => {
    const output = renderExample('roast-chicken.yaml');
    expect(output).toMatchSnapshot();
  });

  it('london-sightseeing.yaml at 80 cols', () => {
    const output = renderExample('london-sightseeing.yaml');
    expect(output).toMatchSnapshot();
  });

  it('birthday-party.yaml at 80 cols', () => {
    const output = renderExample('birthday-party.yaml');
    expect(output).toMatchSnapshot();
  });

  it('simple.yaml at 80 cols', () => {
    const output = renderExample('simple.yaml');
    expect(output).toMatchSnapshot();
  });

  it('roast-chicken.yaml at 120 cols', () => {
    const output = renderExample('roast-chicken.yaml', { width: 120 });
    expect(output).toMatchSnapshot();
  });

  it('roast-chicken.yaml with quiet: false', () => {
    const output = renderExample('roast-chicken.yaml', { quiet: false });
    expect(output).toMatchSnapshot();
  });

  it('colorLevel 0 produces no ANSI codes', () => {
    const output = renderExample('roast-chicken.yaml');
    // eslint-disable-next-line no-control-regex
    expect(output).not.toMatch(/\x1b\[/);
  });

  it('multi-track schedule shows track separators', () => {
    const output = renderExample('london-sightseeing.yaml');
    expect(output).toContain('Day 1');
    expect(output).toContain('Day 2');
    // Track separators use horizontal rule characters
    expect(output).toMatch(/[─-]+ Day [12] [─-]+/);
  });

  it('shows schedule name as header', () => {
    const output = renderExample('roast-chicken.yaml');
    expect(output).toContain('Roast Chicken Dinner');
  });

  it('renders Try next section when suggestions provided', () => {
    const loaded = loadSchedule(resolve(EXAMPLES, 'roast-chicken.yaml'));
    if (!loaded.success) throw new Error('load failed');
    const result = solve(loaded.data);
    const suggestions: SuggestionsBlock = {
      tryNext: [
        { label: 'More ovens:', command: 'skejj make roast-chicken.yaml --resource oven=3' },
        { label: 'Export CSV:', command: 'skejj make roast-chicken.yaml --format csv' },
      ],
      didYouKnow: [
        'Use --quiet to hide the summary',
        'YAML files are also supported',
        'Steps on the critical path have 0 slack',
      ],
    };
    const output = renderGantt(result, loaded.data, {
      quiet: true,
      termWidth: 80,
      colorLevel: 0,
      suggestions,
    });
    expect(output).toContain('Try next:');
    expect(output).toContain('More ovens:');
    expect(output).toContain('skejj make roast-chicken.yaml --resource oven=3');
    expect(output).toContain('Did you know?');
    expect(output).toContain('Use --quiet to hide the summary');
  });

  it('omits suggestions when suggestions is null', () => {
    const loaded = loadSchedule(resolve(EXAMPLES, 'roast-chicken.yaml'));
    if (!loaded.success) throw new Error('load failed');
    const result = solve(loaded.data);
    const output = renderGantt(result, loaded.data, {
      quiet: true,
      termWidth: 80,
      colorLevel: 0,
      suggestions: null,
    });
    expect(output).not.toContain('Try next');
    expect(output).not.toContain('Did you know');
  });

  it('omits suggestions when not provided (backward compatible)', () => {
    const loaded = loadSchedule(resolve(EXAMPLES, 'roast-chicken.yaml'));
    if (!loaded.success) throw new Error('load failed');
    const result = solve(loaded.data);
    const output = renderGantt(result, loaded.data, {
      quiet: true,
      termWidth: 80,
      colorLevel: 0,
    });
    expect(output).not.toContain('Try next');
    expect(output).not.toContain('Did you know');
  });

  it('120-col bars are wider than 80-col bars', () => {
    const output80 = renderExample('roast-chicken.yaml', { width: 80 });
    const output120 = renderExample('roast-chicken.yaml', { width: 120 });
    // In two-line layout, header line contains step name, bar is the next line
    const lines80 = output80.split('\n');
    const headerIdx80 = lines80.findIndex((l) => l.includes('Roast chicken'));
    const barLine80 = headerIdx80 >= 0 ? lines80[headerIdx80 + 1] : '';
    const lines120 = output120.split('\n');
    const headerIdx120 = lines120.findIndex((l) => l.includes('Roast chicken'));
    const barLine120 = headerIdx120 >= 0 ? lines120[headerIdx120 + 1] : '';
    const blocks80 = (barLine80.match(/█/g) ?? []).length;
    const blocks120 = (barLine120.match(/█/g) ?? []).length;
    expect(blocks120).toBeGreaterThan(blocks80);
  });
});
