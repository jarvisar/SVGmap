import { useRef, useState } from 'react';
import { fieldRange } from '../../engine/limits.ts';
import { type LabelPreset, applyLabelPreset, formatCoordinates } from '../../engine/presets.ts';
import type { FillMode } from '../../engine/settings.ts';
import { CUSTOM_FONT_ID, FONTS, fontInfo } from '../../engine/text/fonts.ts';
import { type LabelPosition, type LabelSettings, type LabelStyle, SUBTITLED } from '../../engine/text/label.ts';
import { Check, ColorInput, Disclosure, Field, NumberField, Section, Segmented, Select, SelectField, Slider, TextField } from '../components/controls.tsx';
import { checkFont, storeFont } from '../customFont.ts';
import { AUTOFIT_HELP, RESET_OFFSET, boxResized, labelMoved } from '../labelDrag.ts';
import { useApp } from '../store.ts';
import { HatchOptions } from './LayersPanel.tsx';
import { PresetPicker, STYLE_NAMES, StylePicker } from './TitleLooks.tsx';

const POSITIONS: { value: LabelPosition; label: string }[] = [
  { value: 'lower_right', label: 'Bottom right' },
  { value: 'lower_left', label: 'Bottom left' },
  { value: 'lower_center', label: 'Bottom centre' },
  { value: 'upper_right', label: 'Top right' },
  { value: 'upper_left', label: 'Top left' },
  { value: 'upper_center', label: 'Top centre' },
  { value: 'center', label: 'Centre' },
];

const LETTERING: Record<FillMode, string> = {
  fill: 'Filled',
  outline: 'Outline',
  hatch: 'Hatched',
  'hatch-outline': 'Hatched with outline',
};

// What the line colour applies to. Solid shapes and ornaments go with the lettering.
const LINES_HINT: Partial<Record<LabelStyle, string>> = {
  box: 'The box outline.',
  band: 'The divider and the rule under the title.',
  ribbon: 'The ribbon outline and folds.',
  badge: 'The rings.',
  letters: 'The letter outlines.',
  legend: 'The box, scale bar and north arrow outlines.',
};

// Styles placed in a corner.
const CORNERED: LabelStyle[] = ['box', 'ribbon', 'badge', 'legend'];

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

export function TitlePanel() {
  const label = useApp((s) => s.label);
  const style = useApp((s) => s.styles[s.mode]);
  const mode = useApp((s) => s.mode);
  const customFontName = useApp((s) => s.customFontName);
  const setLabel = useApp((s) => s.setLabel);
  const setStyle = useApp((s) => s.setStyle);
  const setCustomFont = useApp((s) => s.setCustomFont);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingField = useRef<'font' | 'subtitleFont'>('font');
  const [fontError, setFontError] = useState('');

  const set = (patch: Partial<LabelSettings>) => setLabel(patch);
  const chooseFont = (field: 'font' | 'subtitleFont', id: string) => {
    if (id === LOAD_FONT) {
      pendingField.current = field;
      fileInput.current?.click();
      return;
    }
    setFontError('');
    set({ [field]: id });
  };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const data = await file.arrayBuffer();
    const problem = await checkFont(data);
    setFontError(problem ?? '');
    if (problem) return;
    const name = file.name.replace(/\.(ttf|otf|woff)$/i, '');
    const font = { name, data };
    await storeFont(font);
    setCustomFont(font);
    set({ [pendingField.current]: CUSTOM_FONT_ID });
  };
  const subtitleFromCoordinates = () => {
    const { lat, lon } = useApp.getState().area;
    set({ subtitle: formatCoordinates(lat, lon, label.style === 'badge') });
  };
  const applyPreset = (preset: LabelPreset) => {
    const { area } = useApp.getState();
    setFontError('');
    set(applyLabelPreset(preset, label, area.lat, area.lon));
  };

  const kind = label.style;
  const mapInLetters = kind === 'letters' && label.lettersMode === 'window';
  const fillModes: FillMode[] = mode === 'plotter' ? ['outline', 'hatch', 'hatch-outline'] : ['fill', 'outline', 'hatch', 'hatch-outline'];
  const letteringMode = mode === 'plotter' && style.fillModes.text === 'fill' ? 'hatch-outline' : style.fillModes.text;
  const singleLine = fontInfo(label.font)?.kind === 'stroke';
  const solidHint = 'Engraves the shape and leaves the letters bare.';
  const hasLines =
    kind === 'box' ? label.boxBorder && !label.solid : kind === 'band' ? label.divider || label.ornament : kind === 'letters' ? mapInLetters : kind !== 'inset';
  const setColor = (element: 'text' | 'frame', color: string) => setStyle({ colors: { ...style.colors, [element]: color } });

  return (
    <Section title="Title" summary={label.enabled && label.text.trim() ? `${label.text} (${STYLE_NAMES[kind].toLowerCase()})` : 'Off'}>
      <Check label="Show a title" checked={label.enabled} onChange={(enabled) => set({ enabled })} />
      {label.enabled ? (
        <>
          <TextField label="Text" value={label.text} onChange={(text) => set({ text })} />
          <Field label="Style">
            <StylePicker value={kind} onChange={(value) => set({ style: value })} />
          </Field>
          <Field label="Presets" hint="Sets the style, fonts and options. The title stays as it is.">
            <PresetPicker onPick={applyPreset} />
          </Field>
          {SUBTITLED.includes(kind) ? (
            <>
              <TextField
                label="Subtitle"
                value={label.subtitle}
                placeholder="Optional"
                onChange={(subtitle) => set({ subtitle })}
              />
              <button type="button" className="btn btn-small" style={{ marginTop: 6 }} onClick={subtitleFromCoordinates}>
                Use the coordinates
              </button>
            </>
          ) : null}

          {CORNERED.includes(kind) ? (
            <SelectField<LabelPosition>
              label="Position"
              value={label.position}
              options={POSITIONS}
              onChange={(position) => set({ position, offsetX: 0, offsetY: 0 })}
              hint="Where it starts. You can also click the title on the map or in the preview to drag it somewhere else or resize it."
            />
          ) : null}
          {kind === 'band' || kind === 'inset' ? (
            <Field label="Position" hint={kind === 'inset' ? 'The subtitle goes in the border on the other side.' : undefined}>
              <Segmented<'top' | 'bottom'>
                label="Position"
                value={label.bandPosition}
                options={[
                  { value: 'top', label: 'Top' },
                  { value: 'bottom', label: 'Bottom' },
                ]}
                onChange={(bandPosition) => set({ bandPosition, bandOffsetX: 0, bandOffsetY: 0 })}
              />
            </Field>
          ) : null}
          {labelMoved(label) || boxResized(label) ? (
            <div className="button-row">
              {labelMoved(label) ? (
                <button type="button" className="btn btn-small" onClick={() => set(RESET_OFFSET)}>
                  Reset the position
                </button>
              ) : null}
              {boxResized(label) ? (
                <button type="button" className="btn btn-small" onClick={() => set({ boxWidth: 0, boxHeight: 0 })}>
                  Fit the box to the text
                </button>
              ) : null}
            </div>
          ) : null}
          {kind === 'letters' ? (
            <>
              <Field label="Map">
                <Segmented<LabelSettings['lettersMode']>
                  label="Map"
                  value={label.lettersMode}
                  options={[
                    { value: 'cutout', label: 'Around the letters' },
                    { value: 'window', label: 'Inside the letters' },
                  ]}
                  onChange={(lettersMode) => set({ lettersMode })}
                />
              </Field>
              <Field label="Position">
                <Segmented<LabelSettings['lettersAlign']>
                  label="Position"
                  value={label.lettersAlign}
                  options={[
                    { value: 'top', label: 'Top' },
                    { value: 'center', label: 'Middle' },
                    { value: 'bottom', label: 'Bottom' },
                  ]}
                  onChange={(lettersAlign) => set({ lettersAlign })}
                />
              </Field>
            </>
          ) : null}

          <SelectField label="Font" value={label.font} options={fontOptions(customFontName)} onChange={(id) => chooseFont('font', id)} />
          {fontError ? <div className="notice error">{fontError}</div> : null}
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
          <Slider label="Size" value={label.size} min={40} max={250} step={5} limits={fieldRange('label.size')} unit="%" onChange={(size) => set({ size })} />
          {AUTOFIT_HELP[kind] ? <Check label="Autofit text" title={AUTOFIT_HELP[kind]} checked={label.autofit} onChange={(autofit) => set({ autofit })} /> : null}
          <Slider label="Letter spacing" value={label.titleSpacing} min={80} max={200} step={5} limits={fieldRange('label.titleSpacing', 100)} scale={100} unit="%" onChange={(titleSpacing) => set({ titleSpacing })} />
          {mapInLetters ? null : (
            <Field label="Lettering" hint={singleLine ? 'Single-line fonts are always drawn as strokes.' : undefined}>
              <div className="route-style">
                <ColorInput label="Lettering colour" value={style.colors.text} onChange={(color) => setColor('text', color)} />
                <Select<FillMode>
                  label="Lettering"
                  value={letteringMode}
                  options={fillModes.map((m) => ({ value: m, label: LETTERING[m] }))}
                  onChange={(m) => setStyle({ fillModes: { ...style.fillModes, text: m } })}
                />
              </div>
            </Field>
          )}
          {!mapInLetters && !singleLine && (letteringMode === 'hatch' || letteringMode === 'hatch-outline') ? <HatchOptions layer="text" /> : null}
          {hasLines ? (
            <Field label="Lines" hint={LINES_HINT[kind]}>
              <ColorInput label="Line colour" value={style.colors.frame} onChange={(color) => setColor('frame', color)} />
            </Field>
          ) : null}

          {kind === 'box' ? (
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
              <Check label="Box outline" checked={label.boxBorder} disabled={label.solid} onChange={(boxBorder) => set({ boxBorder })} />
              <Check label="Solid box" title={solidHint} checked={label.solid} onChange={(solid) => set({ solid })} />
            </>
          ) : null}
          {kind === 'band' ? (
            <>
              <Slider label="Band height" value={label.bandHeight} min={5} max={50} step={1} limits={fieldRange('label.bandHeight')} unit="%" onChange={(bandHeight) => set({ bandHeight })} />
              <Field label="Alignment">
                <Segmented<'left' | 'center' | 'right'>
                  label="Alignment"
                  value={label.bandAlign}
                  options={[
                    { value: 'left', label: 'Left' },
                    { value: 'center', label: 'Centre' },
                    { value: 'right', label: 'Right' },
                  ]}
                  onChange={(bandAlign) => set({ bandAlign, bandOffsetX: 0 })}
                />
              </Field>
              <Check label="Divider line" checked={label.divider} onChange={(divider) => set({ divider })} />
              <Check label="Rule under the title" checked={label.ornament} onChange={(ornament) => set({ ornament })} />
            </>
          ) : null}
          {kind === 'ribbon' ? (
            <>
              <Slider label="Arch" value={label.ribbonArch} min={0} max={100} step={5} limits={fieldRange('label.ribbonArch')} unit="%" onChange={(ribbonArch) => set({ ribbonArch })} />
              <Check label="Solid ribbon" title={solidHint} checked={label.solid} onChange={(solid) => set({ solid })} />
            </>
          ) : null}
          {kind === 'badge' ? (
            <>
              <Field label="Middle" hint={label.badgeCentre === 'compass' ? 'The compass points to true north as the map turns.' : undefined}>
                <Segmented<LabelSettings['badgeCentre']>
                  label="Middle"
                  value={label.badgeCentre}
                  options={[
                    { value: 'compass', label: 'Compass' },
                    { value: 'map', label: 'Map' },
                  ]}
                  onChange={(badgeCentre) => set({ badgeCentre })}
                />
              </Field>
              <Check label="Solid ring" title={solidHint} checked={label.solid} onChange={(solid) => set({ solid })} />
            </>
          ) : null}
          {kind === 'letters' && !mapInLetters ? (
            <NumberField label="Gap around the letters" value={label.lettersGap} min={0} max={10} step={0.1} unit="mm" onChange={(lettersGap) => set({ lettersGap })} />
          ) : null}
          {kind === 'letters' && mapInLetters && singleLine ? <div className="notice">Pick an outline font to show the map inside the letters.</div> : null}
          {kind === 'legend' ? (
            <>
              <Field label="Units">
                <Segmented<LabelSettings['legendUnits']>
                  label="Units"
                  value={label.legendUnits}
                  options={[
                    { value: 'metric', label: 'Metric' },
                    { value: 'imperial', label: 'Imperial' },
                  ]}
                  onChange={(legendUnits) => set({ legendUnits })}
                />
              </Field>
              <Check label="Scale bar" checked={label.legendScale} onChange={(legendScale) => set({ legendScale })} />
              <Check label="North arrow" checked={label.legendNorth} onChange={(legendNorth) => set({ legendNorth })} />
              <Check label="Box outline" checked={label.boxBorder} onChange={(boxBorder) => set({ boxBorder })} />
            </>
          ) : null}

          <Disclosure label="Measurements">
            {kind === 'band' ? (
              <>
                <div className="row">
                  <NumberField label="Title height" value={label.titleHeight} min={0.5} max={100} step={0.1} unit="mm" onChange={(titleHeight) => set({ titleHeight })} />
                  <NumberField label="Max width" value={label.bandMaxWidth} min={1} max={100} step={1} unit="%" onChange={(bandMaxWidth) => set({ bandMaxWidth })} />
                </div>
                <div className="row">
                  <NumberField label="Subtitle height" value={label.subtitleHeight} min={0.5} max={50} step={0.1} unit="mm" onChange={(subtitleHeight) => set({ subtitleHeight })} />
                  <NumberField label="Line gap" value={label.subtitleGap} min={0} max={50} step={0.1} unit="mm" onChange={(subtitleGap) => set({ subtitleGap })} />
                </div>
                <div className="row">
                  <NumberField label="Padding (sides)" value={label.bandPaddingX} min={0} max={50} step={0.1} unit="mm" onChange={(bandPaddingX) => set({ bandPaddingX })} />
                  <NumberField label="Padding (top, bottom)" value={label.bandPaddingY} min={0} max={50} step={0.1} unit="mm" onChange={(bandPaddingY) => set({ bandPaddingY })} />
                </div>
                <div className="row">
                  <NumberField label="Divider width" value={label.dividerWidth} min={0.01} max={3} step={0.05} unit="mm" onChange={(dividerWidth) => set({ dividerWidth })} />
                  <NumberField label="Divider inset" value={label.dividerInset} {...fieldRange('label.dividerInset')} step={0.5} unit="mm" onChange={(dividerInset) => set({ dividerInset })} />
                </div>
              </>
            ) : kind === 'box' ? (
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
                <NumberField label="Text size in box" value={label.textScale} min={10} max={100} step={1} scale={100} unit="%" onChange={(textScale) => set({ textScale })} />
              </>
            ) : (
              <>
                <div className="row">
                  {kind === 'badge' ? (
                    <NumberField label="Diameter" value={label.badgeDiameter} min={10} max={300} step={1} unit="mm" onChange={(badgeDiameter) => set({ badgeDiameter })} />
                  ) : kind === 'letters' ? null : (
                    <NumberField label="Text height" value={label.textHeight} min={0.5} max={100} step={0.1} unit="mm" onChange={(textHeight) => set({ textHeight })} />
                  )}
                  <NumberField label="Line width" value={label.borderWidth} min={0.01} max={5} step={0.05} unit="mm" onChange={(borderWidth) => set({ borderWidth })} />
                </div>
                {CORNERED.includes(kind) ? (
                  <NumberField label="Gap from border" value={label.gap} min={0} max={50} step={0.1} unit="mm" onChange={(gap) => set({ gap })} />
                ) : null}
              </>
            )}
            {SUBTITLED.includes(kind) ? (
              <>
                <NumberField label="Subtitle spacing" value={label.subtitleSpacing} min={80} max={300} step={5} scale={100} unit="%" onChange={(subtitleSpacing) => set({ subtitleSpacing })} />
                <SelectField
                  label="Subtitle font"
                  value={label.subtitleFont || ''}
                  options={[{ value: '', label: 'Same as the title', group: '' }, ...fontOptions(customFontName)]}
                  onChange={(id) => chooseFont('subtitleFont', id)}
                />
              </>
            ) : null}
          </Disclosure>
        </>
      ) : null}
    </Section>
  );
}
