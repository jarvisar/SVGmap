import { describe, expect, it } from 'vitest';
import { encodeRoute } from '../routes/route.ts';
import { DEFAULT_LABEL } from './label.ts';
import { fillLabel, fillPlaceholders, missingWarnings, placeholderValues } from './placeholders.ts';

// About 1.1 km due north.
const run = { id: 'r1', name: 'Morning Run', visible: true, lines: encodeRoute([[[-87.63, 41.88], [-87.63, 41.89]]]) };
const source = { lat: 41.88224, lon: -87.62601, scale: 20000, routes: [], title: 'CHICAGO', now: new Date(2026, 9, 2) };

describe('placeholders', () => {
  it('fill in the coordinates, scale, title and date', () => {
    const values = placeholderValues(source);
    expect(values.coords).toBe('41.8822° N, 87.6260° W');
    expect(values.dms).toBe(`41°52'56" N 87°37'34" W`);
    expect(values.scale).toBe(`1:${(20000).toLocaleString()}`);
    expect(values.title).toBe('CHICAGO');
    expect(values.year).toBe('2026');
    expect(values.date).toContain('2026');
  });

  it('measure the visible routes, and have nothing without one', () => {
    const values = placeholderValues({ ...source, routes: [run, { ...run, id: 'r2', name: 'Hidden', visible: false }] });
    expect(values.route).toBe('Morning Run');
    expect(values.km).toBe('1.11 km');
    expect(values.mi).toBe('0.69 mi');
    expect(placeholderValues(source).km).toBeNull();
  });

  it('keep tokens they do not know, and fill capitals in capitals', () => {
    const values = placeholderValues({ ...source, routes: [run] });
    expect(fillPlaceholders('{ROUTE} · {km} · {nope}', values)).toBe('MORNING RUN · 1.11 km · {nope}');
    expect(fillPlaceholders('{Route}', values)).toBe('Morning Run');
  });

  it('leave out what has no value and say why', () => {
    const missing = new Set<string>();
    expect(fillPlaceholders('Marathon {km}', placeholderValues(source), missing)).toBe('Marathon ');
    expect(missingWarnings(missing)).toEqual(['{km} needs a route to measure. Import one under Routes, or take it out.']);
  });

  it("don't fill a subtitle the style doesn't show, or a title that's off", () => {
    const values = placeholderValues(source);
    const label = { ...DEFAULT_LABEL, text: '{title}', subtitle: '{coords}' };
    expect(fillLabel(label, values).subtitle).toBe('{coords}');
    expect(fillLabel({ ...label, style: 'band' }, values).subtitle).toBe(values.coords);
    const missing = new Set<string>();
    fillLabel({ ...label, text: '{km}', enabled: false }, values, missing);
    expect(missing.size).toBe(0);
    const plain = { ...DEFAULT_LABEL };
    expect(fillLabel(plain, values)).toBe(plain);
  });

  it("don't put the title in itself", () => {
    expect(placeholderValues({ ...source, title: '{title} {year}' }).title).toBeNull();
  });
});
