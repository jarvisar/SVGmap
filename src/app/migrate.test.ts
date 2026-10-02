import { describe, expect, it } from 'vitest';
import { LABEL_PRESETS, applyLabelPreset, subtitleForPlace } from '../engine/presets.ts';
import { LASER_PALETTES, PRINT_THEMES } from '../engine/settings.ts';
import { DEFAULT_LABEL } from '../engine/text/label.ts';
import { defaultSettings, mergeSettings, migrateSettings } from './settings.ts';
import { decodeSettings } from './share.ts';
import { useApp } from './store.ts';

describe('settings from before the title styles', () => {
  const old = { label: { ...DEFAULT_LABEL, textHeight: 7.776, maxWidth: 77.76, paddingX: 1.98, paddingY: 1.548, borderWidth: 0.25, subtitleSpacing: 1.2, dividerWidth: 0.1 } };

  it('moves the old box size to the new default', () => {
    const label = (migrateSettings(old, 1) as typeof old).label;
    expect(label.textHeight).toBe(DEFAULT_LABEL.textHeight);
    expect(label.maxWidth).toBe(DEFAULT_LABEL.maxWidth);
    expect(label.subtitleSpacing).toBe(1);
  });

  it('keeps sizes the user picked', () => {
    const label = (migrateSettings({ label: { ...old.label, textHeight: 9 } }, 1) as typeof old).label;
    expect(label.textHeight).toBe(9);
  });

  it('leaves newer settings alone', () => {
    expect(migrateSettings(old, 3)).toBe(old);
  });

  it('drops a style it does not know', () => {
    const merged = mergeSettings(defaultSettings(), { label: { style: 'scroll', position: 'middle', lettersMode: 'window' } });
    expect(merged.label.style).toBe(DEFAULT_LABEL.style);
    expect(merged.label.position).toBe(DEFAULT_LABEL.position);
    expect(merged.label.lettersMode).toBe('window');
  });
});

describe('title presets', () => {
  it('keep the title and a typed subtitle', () => {
    const label = { ...DEFAULT_LABEL, text: 'ROME', subtitle: 'ITALIA', size: 140 };
    for (const preset of LABEL_PRESETS) {
      const applied = applyLabelPreset(preset, label, 41.9, 12.48);
      expect(applied.text).toBe('ROME');
      expect(applied.subtitle).toBe('ITALIA');
      expect(applied.size).toBe(100);
    }
  });

  it('fill in the coordinates, short around a badge', () => {
    const seal = LABEL_PRESETS.find((p) => p.label.style === 'badge')!;
    const poster = LABEL_PRESETS.find((p) => p.label.style === 'band')!;
    const fromPoster = applyLabelPreset(poster, DEFAULT_LABEL, 41.882245, -87.62601);
    expect(fromPoster.subtitle).toBe('41.8822° N, 87.6260° W');
    // Coordinates from another preset are rewritten, not kept as typed.
    expect(applyLabelPreset(seal, fromPoster, 41.882245, -87.62601).subtitle).toBe('41.88° N 87.63° W');
  });

  it('leave nothing behind from the last preset', () => {
    const byName = (name: string) => LABEL_PRESETS.find((p) => p.name === name)!;
    const gallery = applyLabelPreset(byName('Gallery'), { ...DEFAULT_LABEL, rotation: 90, legendUnits: 'imperial' }, 41.9, 12.48);
    expect(gallery.bandHeight).toBe(15);
    const poster = applyLabelPreset(byName('Poster'), gallery, 41.9, 12.48);
    expect(poster.bandHeight).toBe(DEFAULT_LABEL.bandHeight);
    expect(poster.rotation).toBe(0);
    expect(poster.legendUnits).toBe('imperial');
  });

  it('move the coordinates in the subtitle to a new place', () => {
    const app = useApp.getState();
    app.setLabel({ subtitle: '41.8822° N, 87.6260° W' });
    app.applyPlace('rome');
    expect(useApp.getState().label.subtitle).toBe('41.8973° N, 12.4768° E');
    app.setLabel({ subtitle: '41.90° N 12.48° E' });
    app.applyPlace('sydney');
    expect(useApp.getState().label.subtitle).toBe('33.86° S 151.21° E');
    // Anything else is the user's own.
    app.setLabel({ subtitle: 'ITALIA' });
    app.applyPlace('rome');
    expect(useApp.getState().label.subtitle).toBe('ITALIA');
    expect(subtitleForPlace('ITALIA', 0, 0)).toBe('ITALIA');
  });
});

describe('settings from before routes', () => {
  // Saved by a build with routes but before this was fixed, so the route
  // colour was filled in from the default palette.
  const saved = (laserPalette: string, printTheme: string, laserRoute?: string) => {
    const s = defaultSettings();
    const laser = { ...s.styles.laser, colors: { ...LASER_PALETTES[laserPalette as 'minimal'].colors, route: laserRoute } };
    const print = { ...s.styles.print, colors: { ...PRINT_THEMES[printTheme].colors, route: PRINT_THEMES.classic.colors.route } };
    return { ...s, laserPalette, printTheme, styles: { ...s.styles, laser, print } };
  };
  const routeColours = (settings: unknown) => {
    const s = mergeSettings(defaultSettings(), migrateSettings(settings, 2));
    return [s.styles.laser.colors.route, s.styles.print.colors.route];
  };

  it("take the route colour from the user's palette and theme", () => {
    expect(routeColours(saved('minimal', 'blueprint', LASER_PALETTES.distinct.colors.route))).toEqual(['#000000', PRINT_THEMES.blueprint.colors.route]);
    expect(routeColours(saved('lightburn', 'classic'))).toEqual([LASER_PALETTES.lightburn.colors.route, PRINT_THEMES.classic.colors.route]);
  });

  it('keep a route colour the user picked', () => {
    expect(routeColours(saved('minimal', 'classic', '#123456'))[0]).toBe('#123456');
  });

  it('get it from a share link made before routes too', () => {
    const link = { laserPalette: 'minimal', styles: { laser: { colors: { water: '#000000' } } } };
    const decoded = decodeSettings(btoa(JSON.stringify(link)).replace(/=+$/, ''))!;
    expect(decoded.styles.laser.colors.route).toBe('#000000');
  });
});
