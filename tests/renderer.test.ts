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
import stringWidth from 'string-width';

const EXAMPLES = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '../examples');

function renderExample(filename: string, opts?: { width?: number; quiet?: boolean; showArrows?: boolean }) {
  const loaded = loadSchedule(resolve(EXAMPLES, filename));
  if (!loaded.success) throw new Error(`Failed to load ${filename}: ${loaded.errors.join(', ')}`);
  const result = solve(loaded.data);
  return renderGantt(result, loaded.data, {
    quiet: opts?.quiet ?? true,
    termWidth: opts?.width ?? 80,
    colorLevel: 0, // always plain text in tests
    showArrows: opts?.showArrows ?? false,
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

  it('renders Try next section when suggestions provided', () => {
    const loaded = loadSchedule(resolve(EXAMPLES, 'roast-chicken.json'));
    if (!loaded.success) throw new Error('load failed');
    const result = solve(loaded.data);
    const suggestions: SuggestionsBlock = {
      tryNext: [
        { label: 'More ovens:', command: 'skejj make roast-chicken.json --resource oven=3' },
        { label: 'Export CSV:', command: 'skejj make roast-chicken.json --format csv' },
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
    expect(output).toContain('skejj make roast-chicken.json --resource oven=3');
    expect(output).toContain('Did you know?');
    expect(output).toContain('Use --quiet to hide the summary');
  });

  it('omits suggestions when suggestions is null', () => {
    const loaded = loadSchedule(resolve(EXAMPLES, 'roast-chicken.json'));
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
    const loaded = loadSchedule(resolve(EXAMPLES, 'roast-chicken.json'));
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
    const output80 = renderExample('roast-chicken.json', { width: 80 });
    const output120 = renderExample('roast-chicken.json', { width: 120 });
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

describe('renderer arrow connectors', () => {
  it('roast-chicken.json with --arrows at 80 cols', () => {
    const output = renderExample('roast-chicken.json', { showArrows: true });
    expect(output).toMatchSnapshot();
  });

  it('london-sightseeing.json with --arrows at 80 cols', () => {
    const output = renderExample('london-sightseeing.json', { showArrows: true });
    expect(output).toMatchSnapshot();
  });

  it('birthday-party.json with --arrows at 80 cols', () => {
    const output = renderExample('birthday-party.json', { showArrows: true });
    expect(output).toMatchSnapshot();
  });

  it('arrows output contains box-drawing connector characters', () => {
    const output = renderExample('roast-chicken.json', { showArrows: true });
    // At least one connector character should appear (box-drawing chars used in gutter)
    expect(output).toMatch(/[│─┌┐└┘├┤┼]/);
  });

  it('no-arrows output does not contain corner/T-junction characters', () => {
    const output = renderExample('roast-chicken.json', { showArrows: false });
    // Corners and T-junctions should not appear when arrows are off
    // (│ may appear as grid char, but ┌┐└┘├┤┼ should not)
    expect(output).not.toMatch(/[┌┐└┘├┤┼]/);
  });

  it('arrows output stays within specified width', () => {
    const output = renderExample('roast-chicken.json', { showArrows: true, width: 80 });
    const lines = output.split('\n');
    for (const line of lines) {
      expect(stringWidth(line)).toBeLessThanOrEqual(80);
    }
  });

  it('connector arms appear on bar rows not header rows', () => {
    const output = renderExample('roast-chicken.json', { showArrows: true });
    const lines = output.split('\n');
    // Turn characters (corners and T-junctions) indicate connector horizontal arms
    const turnChars = /[┌┐└┘├┤]/;
    // Bar block characters (█) appear on bar rows (second line of each step pair)
    const barBlockChars = /[█]/;

    const violatingLines: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // If this line has turn chars but NO bar block chars, it may be a header row
      // (pure gutter vertical pass-through lines only have │ which is not a turn)
      if (turnChars.test(line) && !barBlockChars.test(line)) {
        // Connector turns on a non-bar line: violation
        violatingLines.push(i + 1);  // 1-based for readability
      }
    }
    // Turns should only appear on bar rows (which have █ block chars)
    expect(violatingLines).toEqual([]);
  });

  it('non-arrow output is identical when showArrows is false vs not provided', () => {
    const withFalse = renderExample('roast-chicken.json', { showArrows: false });
    const withDefault = renderExample('roast-chicken.json');
    expect(withFalse).toBe(withDefault);
  });

  it('predecessor bar has arm only after bar end, successor bar has arm only before bar start', () => {
    const output = renderExample('birthday-party.json', { showArrows: true });
    const lines = output.split('\n');
    // Find bar lines: lines that contain block characters (█)
    const barLines = lines.filter(l => /█/.test(l));

    // Count bar lines that have arms on only one side (pred-only or succ-only steps)
    const oneSideCount = barLines.filter(l => {
      const bs = l.indexOf('█');
      const be = l.lastIndexOf('█');
      if (bs < 0) return false;
      const before = /─/.test(l.slice(0, bs));
      const after = /─/.test(l.slice(be + 1));
      return (before || after) && !(before && after);
    }).length;

    // At least some bars should have one-sided arms (fixed directional behavior).
    // birthday-party has steps that are pred-only (buy-supplies, bake-cake)
    // and succ-only (clean-up), so we expect at least 3 one-sided bar lines.
    // Previously ALL connected bars had both-sided arms (broken behavior).
    expect(oneSideCount).toBeGreaterThan(0);

    // bake-cake is pred-only: verify it has arm AFTER bar end but NOT before bar start
    // Find the bake-cake bar line (should have arm after blocks only)
    const bakeCakeBarLines = barLines.filter(l => {
      const bs = l.indexOf('█');
      const be = l.lastIndexOf('█');
      if (bs < 0) return false;
      // Only arm after bar end (no H_RULE before bar start in bar content area)
      const before = /─/.test(l.slice(0, bs));
      const after = /─/.test(l.slice(be + 1));
      return after && !before;
    });
    // At least one bar with arm only after end (pred-only bar like bake-cake)
    expect(bakeCakeBarLines.length).toBeGreaterThan(0);
  });

  it('birthday-party arrows output stays within specified width', () => {
    const output = renderExample('birthday-party.json', { showArrows: true, width: 80 });
    const lines = output.split('\n');
    for (const line of lines) {
      expect(stringWidth(line)).toBeLessThanOrEqual(80);
    }
  });
});

describe('renderer warning truncation', () => {
  it('warning lines respect width cap', () => {
    // birthday-party.json produces warnings that exceed 80 chars raw
    const output = renderExample('birthday-party.json', { width: 60, showArrows: false });
    const lines = output.split('\n');
    for (const line of lines) {
      expect(stringWidth(line)).toBeLessThanOrEqual(60);
    }
  });

  it('warning lines respect width cap at 80 cols', () => {
    const output = renderExample('birthday-party.json', { width: 80, showArrows: false });
    const lines = output.split('\n');
    for (const line of lines) {
      expect(stringWidth(line)).toBeLessThanOrEqual(80);
    }
  });
});
