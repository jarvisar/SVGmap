import type { ReactNode } from 'react';
import { LABEL_PRESETS, type LabelPreset } from '../../engine/presets.ts';
import type { LabelStyle } from '../../engine/text/label.ts';

const FRAME = <rect x="1.5" y="1.5" width="29" height="19" rx="1" opacity="0.45" />;

const ICONS: Record<LabelStyle, ReactNode> = {
  box: (
    <>
      {FRAME}
      <rect x="16.5" y="12.5" width="11" height="5.5" />
      <path d="M18.5 15.25h7" strokeWidth="1.6" />
    </>
  ),
  band: (
    <>
      {FRAME}
      <path d="M1.5 14.5h29" />
      <path d="M11 17.5h10" strokeWidth="1.6" />
    </>
  ),
  ribbon: (
    <>
      {FRAME}
      <rect x="10" y="8" width="12" height="4.5" />
      <path d="M10 10H5.5L7 12l-1.5 2H11.5L10 12.5M22 10h4.5L25 12l1.5 2H20.5l1.5-1.5" />
    </>
  ),
  badge: (
    <>
      {FRAME}
      <circle cx="16" cy="11" r="6.5" />
      <circle cx="16" cy="11" r="3.8" opacity="0.6" />
      <path d="M16 8.5v5M13.5 11h5" />
    </>
  ),
  letters: (
    <>
      {FRAME}
      <text x="16" y="15.5" textAnchor="middle" fontSize="11" fontWeight="800" fill="currentColor" stroke="none">
        ABC
      </text>
    </>
  ),
  inset: (
    <>
      <path d="M12 20.5H1.5v-19h29v19H20" opacity="0.45" />
      <path d="M13.5 20.5h5" strokeWidth="1.6" />
    </>
  ),
  legend: (
    <>
      {FRAME}
      <rect x="3.5" y="10" width="13" height="8.5" />
      <path d="M5.5 13h7" strokeWidth="1.6" />
      <path d="M5.5 16.25h6M14.5 15v2" />
    </>
  ),
};

export const STYLE_NAMES: Record<LabelStyle, string> = {
  box: 'Box',
  band: 'Band',
  ribbon: 'Ribbon',
  badge: 'Badge',
  letters: 'Big letters',
  inset: 'In border',
  legend: 'Legend',
};

const STYLE_HINTS: Record<LabelStyle, string> = {
  box: 'One line in a box, like the original plaque',
  band: 'A strip across the top or bottom, like a poster',
  ribbon: 'A banner with folded tails',
  badge: 'A round seal with a compass rose',
  letters: 'Huge letters across the map',
  inset: 'Set into a gap in the border',
  legend: 'Title, scale bar and north arrow',
};

function Icon(props: { style: LabelStyle }) {
  return (
    <svg viewBox="0 0 32 22" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" aria-hidden="true">
      {ICONS[props.style]}
    </svg>
  );
}

export function StylePicker(props: { value: LabelStyle; onChange: (style: LabelStyle) => void }) {
  return (
    <div className="style-grid" role="radiogroup" aria-label="Style">
      {(Object.keys(STYLE_NAMES) as LabelStyle[]).map((style) => (
        <button
          key={style}
          type="button"
          role="radio"
          aria-checked={style === props.value}
          className={style === props.value ? 'style-option active' : 'style-option'}
          title={STYLE_HINTS[style]}
          onClick={() => props.onChange(style)}
        >
          <Icon style={style} />
          {STYLE_NAMES[style]}
        </button>
      ))}
    </div>
  );
}

export function PresetPicker(props: { onPick: (preset: LabelPreset) => void }) {
  return (
    <div className="preset-grid">
      {LABEL_PRESETS.map((preset) => (
        <button key={preset.id} type="button" className="btn btn-small preset-option" onClick={() => props.onPick(preset)}>
          <Icon style={preset.label.style ?? 'box'} />
          {preset.name}
        </button>
      ))}
    </div>
  );
}
