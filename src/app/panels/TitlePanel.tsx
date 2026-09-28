import { useRef } from 'react';
import type { FillMode } from '../../engine/settings.ts';
import { CUSTOM_FONT_ID, FONTS } from '../../engine/text/fonts.ts';
import type { LabelPosition, LabelSettings } from '../../engine/text/label.ts';
import { Check, Disclosure, Field, NumberField, Section, Segmented, SelectField, Slider, TextField } from '../components/controls.tsx';
import { storeFont } from '../customFont.ts';
import { useApp } from '../store.ts';

const POSITIONS: { value: LabelPosition; label: string }[] = [
  { value: 'lower_right', label: 'Bottom right' },
  { value: 'lower_left', label: 'Bottom left' },
  { value: 'lower_center', label: 'Bottom centre' },
  { value: 'upper_right', label: 'Top right' },
  { value: 'upper_left', label: 'Top left' },
  { value: 'upper_center', label: 'Top centre' },
];

const LOAD_FONT = '__load';

function fontOptions(customName: string | null) {
  const options = FONTS.map((f) => ({
    value: f.id,
    label: `${f.name} (${f.note.toLowerCase()})`,
    group: f.kind === 'outline' ? 'Outline fonts' : 'Single-line fonts',
  }));
  if (customName) options.push({ value: CUSTOM_FONT_ID, label: customName, group: 'Your font' });
  options.push({ value: LOAD_FONT, label: 'Load a font file…', group: 'Your font' });
  return options;
}

function coordinates(lat: number, lon: number) {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
}

export function TitlePanel() {
  const label = useApp((s) => s.label);
  const area = useApp((s) => s.area);
  const style = useApp((s) => s.styles[s.mode]);
  const mode = useApp((s) => s.mode);
  const customFontName = useApp((s) => s.customFontName);
  const setLabel = useApp((s) => s.setLabel);
  const setStyle = useApp((s) => s.setStyle);
  const setCustomFontName = useApp((s) => s.setCustomFontName);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingField = useRef<'font' | 'subtitleFont'>('font');

  const set = (patch: Partial<LabelSettings>) => setLabel(patch);
  const chooseFont = (field: 'font' | 'subtitleFont', id: string) => {
    if (id === LOAD_FONT) {
      pendingField.current = field;
      fileInput.current?.click();
      return;
    }
    set({ [field]: id });
  };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const data = await file.arrayBuffer();
    await storeFont({ name: file.name.replace(/\.(ttf|otf|woff)$/i, ''), data });
    setCustomFontName(file.name.replace(/\.(ttf|otf|woff)$/i, ''));
    set({ [pendingField.current]: CUSTOM_FONT_ID });
  };

  const band = label.style === 'band';
  const fillModes: FillMode[] = mode === 'plotter' ? ['outline', 'hatch', 'hatch-outline'] : ['fill', 'outline', 'hatch', 'hatch-outline'];
  const letteringMode = mode === 'plotter' && style.fillModes.text === 'fill' ? 'hatch-outline' : style.fillModes.text;

  return (
    <Section title="Title" summary={label.enabled ? label.text : 'Off'}>
      <Check label="Show a title" checked={label.enabled} onChange={(enabled) => set({ enabled })} />
      {label.enabled ? (
        <>
          <TextField label="Text" value={label.text} onChange={(text) => set({ text })} />
          <Field label="Style">
            <Segmented<'box' | 'band'>
              label="Style"
              value={label.style}
              options={[
                { value: 'box', label: 'Box' },
                { value: 'band', label: 'Band' },
              ]}
              onChange={(value) => set({ style: value })}
            />
          </Field>
          {band ? (
            <>
              <TextField label="Subtitle" value={label.subtitle} placeholder="Optional" onChange={(subtitle) => set({ subtitle })} />
              <button type="button" className="btn btn-small" style={{ marginTop: 6 }} onClick={() => set({ subtitle: coordinates(area.lat, area.lon) })}>
                Use the coordinates
              </button>
              <Field label="Position">
                <Segmented<'top' | 'bottom'>
                  label="Band position"
                  value={label.bandPosition}
                  options={[
                    { value: 'top', label: 'Top' },
                    { value: 'bottom', label: 'Bottom' },
                  ]}
                  onChange={(bandPosition) => set({ bandPosition })}
                />
              </Field>
            </>
          ) : (
            <SelectField<LabelPosition> label="Position" value={label.position} options={POSITIONS} onChange={(position) => set({ position })} />
          )}
          <SelectField label="Font" value={label.font} options={fontOptions(customFontName)} onChange={(id) => chooseFont('font', id)} />
          <input
            ref={fileInput}
            type="file"
            accept=".ttf,.otf,.woff"
            hidden
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Slider label="Size" value={label.size} min={40} max={250} step={5} unit="%" onChange={(size) => set({ size })} />
          <SelectField<FillMode>
            label="Lettering"
            value={letteringMode}
            options={fillModes.map((m) => ({ value: m, label: { fill: 'Filled', outline: 'Outline', hatch: 'Hatched', 'hatch-outline': 'Hatched with outline' }[m] }))}
            onChange={(m) => setStyle({ fillModes: { ...style.fillModes, text: m } })}
            hint="Single-line fonts are always drawn as strokes."
          />

          {band ? (
            <>
              <Slider label="Band height" value={label.bandHeight} min={5} max={50} step={1} unit="%" onChange={(bandHeight) => set({ bandHeight })} />
              <Field label="Alignment">
                <Segmented<'left' | 'center' | 'right'>
                  label="Alignment"
                  value={label.bandAlign}
                  options={[
                    { value: 'left', label: 'Left' },
                    { value: 'center', label: 'Centre' },
                    { value: 'right', label: 'Right' },
                  ]}
                  onChange={(bandAlign) => set({ bandAlign })}
                />
              </Field>
              <Slider label="Letter spacing" value={label.titleSpacing} min={0.8} max={2} step={0.05} unit="×" onChange={(titleSpacing) => set({ titleSpacing })} />
              <Check label="Divider line" checked={label.divider} onChange={(divider) => set({ divider })} />
            </>
          ) : (
            <>
              <Field label="Rotation">
                <Segmented<'0' | '90' | '180' | '270'>
                  label="Rotation"
                  value={String(label.rotation) as '0' | '90' | '180' | '270'}
                  options={[
                    { value: '0', label: '0°' },
                    { value: '90', label: '90°' },
                    { value: '180', label: '180°' },
                    { value: '270', label: '270°' },
                  ]}
                  onChange={(r) => set({ rotation: Number(r) as LabelSettings['rotation'] })}
                />
              </Field>
              <Check label="Box outline" checked={label.boxBorder} onChange={(boxBorder) => set({ boxBorder })} />
            </>
          )}

          <Disclosure label="Measurements">
            {band ? (
              <>
                <div className="row">
                  <NumberField label="Title height" value={label.titleHeight} min={0.5} max={100} step={0.1} unit="mm" onChange={(titleHeight) => set({ titleHeight })} />
                  <NumberField label="Max width" value={label.bandMaxWidth} min={1} max={100} step={1} unit="%" onChange={(bandMaxWidth) => set({ bandMaxWidth })} />
                </div>
                <div className="row">
                  <NumberField label="Subtitle height" value={label.subtitleHeight} min={0.5} max={50} step={0.1} unit="mm" onChange={(subtitleHeight) => set({ subtitleHeight })} />
                  <NumberField label="Subtitle gap" value={label.subtitleGap} min={0} max={50} step={0.1} unit="mm" onChange={(subtitleGap) => set({ subtitleGap })} />
                </div>
                <div className="row">
                  <NumberField label="Padding (sides)" value={label.bandPaddingX} min={0} max={50} step={0.1} unit="mm" onChange={(bandPaddingX) => set({ bandPaddingX })} />
                  <NumberField label="Padding (top, bottom)" value={label.bandPaddingY} min={0} max={50} step={0.1} unit="mm" onChange={(bandPaddingY) => set({ bandPaddingY })} />
                </div>
                <div className="row">
                  <NumberField label="Subtitle spacing" value={label.subtitleSpacing} min={0.8} max={3} step={0.05} unit="×" onChange={(subtitleSpacing) => set({ subtitleSpacing })} />
                  <NumberField label="Divider width" value={label.dividerWidth} min={0.01} max={3} step={0.05} unit="mm" onChange={(dividerWidth) => set({ dividerWidth })} />
                </div>
                <SelectField
                  label="Subtitle font"
                  value={label.subtitleFont || ''}
                  options={[{ value: '', label: 'Same as the title', group: '' }, ...fontOptions(customFontName)]}
                  onChange={(id) => chooseFont('subtitleFont', id)}
                />
              </>
            ) : (
              <>
                <div className="row">
                  <NumberField label="Text height" value={label.textHeight} min={0.5} max={100} step={0.1} unit="mm" onChange={(textHeight) => set({ textHeight })} />
                  <NumberField label="Max width" value={label.maxWidth} min={1} max={500} step={1} unit="mm" onChange={(maxWidth) => set({ maxWidth })} />
                </div>
                <div className="row">
                  <NumberField label="Padding (sides)" value={label.paddingX} min={0} max={30} step={0.1} unit="mm" onChange={(paddingX) => set({ paddingX })} />
                  <NumberField label="Padding (top, bottom)" value={label.paddingY} min={0} max={30} step={0.1} unit="mm" onChange={(paddingY) => set({ paddingY })} />
                </div>
                <div className="row">
                  <NumberField label="Outline width" value={label.borderWidth} min={0.01} max={5} step={0.05} unit="mm" onChange={(borderWidth) => set({ borderWidth })} />
                  <NumberField label="Gap from border" value={label.gap} min={0} max={50} step={0.1} unit="mm" onChange={(gap) => set({ gap })} />
                </div>
                <NumberField label="Text scale in box" value={label.textScale} min={0.1} max={1} step={0.01} onChange={(textScale) => set({ textScale })} />
              </>
            )}
          </Disclosure>
        </>
      ) : null}
    </Section>
  );
}
