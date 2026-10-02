import { describe, expect, it } from 'vitest';
import { clampRenderSettings, limitFor } from '../engine/limits.ts';
import { PRODUCT_PRESETS } from '../engine/presets.ts';
import type { ShapeKind } from '../engine/layout/shapes.ts';
import { defaultSettings, mergeSettings, toRenderSettings } from './settings.ts';
import { selectSettings, useApp } from './store.ts';

// Every number outside its range, skipping the area, which isn't in the limits.
function outOfRange(value: unknown, path: string[] = []): string[] {
  if (path.length === 1 && path[0] === 'area') return [];
  if (typeof value === 'number') {
    const limit = limitFor(path);
    const fits = limit && ('choices' in limit ? limit.choices.includes(value) : value >= limit.min && value <= limit.max);
    return fits ? [] : [`${path.join('.')} = ${value}`];
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => outOfRange(child, [...path, key]));
}

describe('setting limits in the app', () => {
  it('has a range for every number, holding its default', () => {
    expect(outOfRange(defaultSettings())).toEqual([]);
  });

  it('has room in every range for what the app works out itself', () => {
    const outside: string[] = [];
    const app = useApp.getState();
    for (const preset of PRODUCT_PRESETS) {
      app.applyProductPreset(preset.id);
      for (const shape of ['rect', 'rounded', 'circle', 'hexagon'] as ShapeKind[]) {
        app.setProduct({ shape });
        for (const mode of ['laser', 'plotter', 'print'] as const) {
          app.setMode(mode);
          for (const penWidth of [0.05, 1, 3]) {
            app.setPlotter({ penWidth });
            for (const cleanup of ['off', 'light', 'standard', 'strong'] as const) {
              app.setCleanupPreset(cleanup);
              const settings = selectSettings(useApp.getState());
              const label = `${preset.id} ${shape} ${mode} ${penWidth} mm pen ${cleanup}`;
              outside.push(...outOfRange(settings).map((s) => `${s} (${label})`));
              const render = toRenderSettings(settings);
              // The engine clamps again, and must find nothing to change.
              if (JSON.stringify(clampRenderSettings(render)) !== JSON.stringify(render)) outside.push(`render clamped (${label})`);
            }
          }
        }
      }
    }
    for (const width of [20, 2000]) {
      app.setProduct({ shape: 'hexagon', width });
      outside.push(...outOfRange(selectSettings(useApp.getState())));
    }
    expect(outside.slice(0, 5)).toEqual([]);
  });

  it('brings numbers from saved settings and links into the range the panels allow', () => {
    // A dense window this small made the line cleanup sample forever.
    const defaults = defaultSettings();
    const merged = mergeSettings(defaults, { cleanup: { denseWindow: 1e-320, snapGap: 0.4 }, label: { rotation: 90, size: 1e6 } });
    expect(merged.cleanup.denseWindow).toBe(0.1);
    expect(merged.cleanup.snapGap).toBe(0.4);
    expect(merged.label.size).toBe(250);
    expect(merged.label.rotation).toBe(90);
    expect(mergeSettings(defaults, { label: { rotation: 45 } }).label.rotation).toBe(defaults.label.rotation);
    // The area has its own checks.
    expect(mergeSettings(defaults, { area: { widthM: 250_000 } }).area.widthM).toBe(250_000);
  });
});
