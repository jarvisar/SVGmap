import { describe, expect, it } from 'vitest';
import { LABEL_PRESETS, applyLabelPreset } from '../engine/presets.ts';
import { DEFAULT_LABEL } from '../engine/text/label.ts';
import { defaultSettings, mergeSettings, migrateSettings } from './settings.ts';

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
    expect(migrateSettings(old, 2)).toBe(old);
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
});
