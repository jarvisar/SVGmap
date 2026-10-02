import { fieldRange } from '../../engine/limits.ts';
import { LASER_PALETTES, type OutputMode, PRINT_THEMES } from '../../engine/settings.ts';
import { Check, ColorInput, Field, NumberField, Section, Segmented, SelectField } from '../components/controls.tsx';
import type { LaserPalette } from '../settings.ts';
import { useApp } from '../store.ts';

const MODE_NAMES: Record<OutputMode, string> = { laser: 'Laser', plotter: 'Plotter', print: 'Print' };

const MODE_HINTS: Record<OutputMode, string> = {
  laser: 'Filled areas engrave, lines score and the outline cuts. Each layer gets its own colour so it can have its own process.',
  plotter: 'Everything is a stroke. Filled areas are hatched and each pen colour is a numbered layer.',
  print: 'Filled areas and road widths styled for printing or the screen.',
};

export function OutputPanel() {
  const mode = useApp((s) => s.mode);
  const style = useApp((s) => s.styles[s.mode]);
  const palette = useApp((s) => s.laserPalette);
  const theme = useApp((s) => s.printTheme);
  const plotter = useApp((s) => s.plotter);
  const laser = useApp((s) => s.laser);
  const set = useApp((s) => s.set);
  const setMode = useApp((s) => s.setMode);
  const setStyle = useApp((s) => s.setStyle);
  const setPalette = useApp((s) => s.setLaserPalette);
  const setTheme = useApp((s) => s.setPrintTheme);
  const setPlotter = useApp((s) => s.setPlotter);

  return (
    <Section title="Output" summary={MODE_NAMES[mode]} defaultOpen>
      <Segmented<OutputMode>
        label="Output"
        value={mode}
        options={[
          { value: 'laser', label: 'Laser' },
          { value: 'plotter', label: 'Plotter' },
          { value: 'print', label: 'Print' },
        ]}
        onChange={setMode}
      />
      <div className="hint">{MODE_HINTS[mode]}</div>

      {mode === 'laser' ? (
        <>
          <SelectField<LaserPalette>
            label="Colours"
            value={palette}
            options={Object.entries(LASER_PALETTES).map(([value, p]) => ({ value: value as LaserPalette, label: p.name }))}
            onChange={setPalette}
          />
          <NumberField
            label="Line width"
            value={laser.lineWidth}
            {...fieldRange('laser.lineWidth')}
            step={0.005}
            unit="mm"
            hint="Every scored line and the cut. Some drivers engrave any line wider than a hairline instead of cutting it. Epilog's needs 0.025 mm (0.001 in) or less."
            onChange={(lineWidth) => set({ laser: { ...laser, lineWidth } })}
          />
        </>
      ) : null}

      {mode === 'plotter' ? (
        <>
          <NumberField
            label="Pen width"
            value={plotter.penWidth}
            min={0.05}
            max={3}
            step={0.05}
            unit="mm"
            onChange={(penWidth) => setPlotter({ penWidth })}
          />
          <Check label="Order strokes to cut pen travel" checked={plotter.optimize} onChange={(optimize) => setPlotter({ optimize })} />
        </>
      ) : null}

      {mode === 'print' ? (
        <>
          <SelectField
            label="Theme"
            value={theme}
            options={Object.entries(PRINT_THEMES).map(([value, t]) => ({ value, label: t.name }))}
            onChange={setTheme}
          />
          <Field label="Background">
            <div className="row" style={{ alignItems: 'center' }}>
              <ColorInput label="Background" value={style.background ?? '#FFFFFF'} onChange={(background) => setStyle({ background })} />
              <Check label="Transparent" checked={style.background === null} onChange={(t) => setStyle({ background: t ? null : '#FFFFFF' })} />
            </div>
          </Field>
          <Check label="Wider lines for bigger roads" checked={style.classWidths} onChange={(classWidths) => setStyle({ classWidths })} />
        </>
      ) : null}

      <div className="row" style={{ alignItems: 'center' }}>
        <Check label="Cut line around the edge" checked={style.cut} onChange={(cut) => setStyle({ cut })} />
        {style.cut ? <ColorInput label="Cut line colour" value={style.colors.cut} onChange={(cut) => setStyle({ colors: { ...style.colors, cut } })} /> : null}
      </div>
    </Section>
  );
}
