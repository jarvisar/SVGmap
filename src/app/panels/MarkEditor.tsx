// Everything about one pin or bit of text. The same form is in the preview's
// card and in the sidebar, so a mark can be set up without a mouse too.
import { useEffect, useId, useRef, useState } from 'react';
import {
  type MapMark,
  MARK_RANGES,
  type MarkAlign,
  type MarkFill,
  type MarkSide,
  hasText,
  markFont,
  markName,
  markText,
  markTextFill,
  textBeside,
} from '../../engine/marks/marks.ts';
import { MARK_SHAPES, SHAPE_ORDER } from '../../engine/marks/shapes.ts';
import { shapeContains } from '../../engine/layout/shapes.ts';
import { fontInfo } from '../../engine/text/fonts.ts';
import { ColorInput, Check, Disclosure, Field, NumberField, Segmented, Select, SelectField, Slider } from '../components/controls.tsx';
import { MarkIcon } from '../components/MarkIcon.tsx';
import { PlaceholderMenu, PlaceholderPreview, withToken } from '../components/Placeholders.tsx';
import { type Place, searchPlaces } from '../geocode.ts';
import { duplicateMark, markSpot, pieceLayout, removeMark, setMarkAnchor, updateMark, useMarkUi } from '../marks.ts';
import { useApp } from '../store.ts';
import { asChange } from '../undo.ts';
import { HatchFields, fillModesFor, hatchOptionsFor } from './LayersPanel.tsx';
import { fontOptions } from './TitlePanel.tsx';

const FILL_LABELS: Record<MarkFill, string> = { fill: 'Filled', outline: 'Outline', hatch: 'Hatched', 'hatch-outline': 'Hatched with outline', contour: 'Contours' };

const ALIGNS: { value: MarkAlign; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centre' },
  { value: 'right', label: 'Right' },
];

const SIDES: { value: MarkSide; label: string }[] = [
  { value: 'right', label: 'Right' },
  { value: 'left', label: 'Left' },
  { value: 'above', label: 'Above' },
  { value: 'below', label: 'Below' },
  { value: 'inside', label: 'Inside' },
];

// Arrow keys pick the next or previous shape, as in any group of radio buttons.
export function ShapePicker(props: { value: MapMark['shape']; onChange: (shape: MapMark['shape']) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = SHAPE_ORDER.indexOf(props.value);
    const next = SHAPE_ORDER[(i + step + SHAPE_ORDER.length) % SHAPE_ORDER.length];
    props.onChange(next);
    ref.current?.querySelector<HTMLButtonElement>(`[data-shape="${next}"]`)?.focus();
  };
  return (
    <div className="mark-shapes" role="radiogroup" aria-label="Shape" ref={ref} onKeyDown={onKeyDown}>
      {SHAPE_ORDER.map((shape) => (
        <button
          key={shape}
          type="button"
          role="radio"
          data-shape={shape}
          tabIndex={shape === props.value ? 0 : -1}
          aria-checked={shape === props.value}
          aria-label={MARK_SHAPES[shape].name}
          title={MARK_SHAPES[shape].name}
          className={shape === props.value ? 'mark-shape active' : 'mark-shape'}
          onClick={() => props.onChange(shape)}
        >
          <MarkIcon shape={shape} />
        </button>
      ))}
    </div>
  );
}

// Looks up a place and puts the mark there.
function PlaceSearch(props: { mark: MapMark }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [active, setActive] = useState(0);
  const [message, setMessage] = useState('');
  const listId = useId();
  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      // Emptied after a pick, which leaves its message up.
      if (query) setMessage('');
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchPlaces(query, controller.signal)
        .then((places) => {
          setResults(places);
          setActive(0);
          setMessage(places.length ? '' : 'No places found.');
        })
        .catch((error: unknown) => {
          if ((error as Error).name !== 'AbortError') setMessage('Search is unavailable right now.');
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  const choose = (place: Place) => {
    asChange(`Move ${markName(props.mark)}`, () => updateMark(props.mark.id, { lon: place.lon, lat: place.lat }));
    setQuery('');
    setResults([]);
    setMessage(`Moved to ${place.name}.`);
  };
  return (
    <div className="search">
      <input
        className="input"
        type="search"
        placeholder="Search for an address or place"
        aria-label="Put it at an address or place"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-activedescendant={results.length ? `${listId}-${active}` : undefined}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, Math.min(results.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))));
          }
          if (e.key === 'Enter' && results.length) choose(results[Math.min(active, results.length - 1)]);
          if (e.key === 'Escape') setResults([]);
        }}
      />
      {results.length ? (
        <ul className="search-results" id={listId} role="listbox">
          {results.map((place, i) => (
            <li
              key={place.id + i}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(place)}
            >
              {place.name}
              {place.detail ? <span className="detail">{place.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {message ? (
        <div className="hint" role="status">
          {message}
        </div>
      ) : null}
    </div>
  );
}

// Whether the mark's spot is outside the map window.
function useOffMap(mark: MapMark): boolean {
  const area = useApp((s) => s.area);
  const product = useApp((s) => s.product);
  const border = useApp((s) => s.border);
  const layout = pieceLayout({ product, border });
  const at = markSpot(mark, { area, product, border });
  if (!layout || !at) return false;
  return !shapeContains(layout.window, at);
}

export function MarkEditor(props: { mark: MapMark }) {
  const { mark } = props;
  const mode = useApp((s) => s.mode);
  const titleColor = useApp((s) => s.styles[s.mode].colors.text);
  const titleFont = useApp((s) => s.label.font);
  const customFontName = useApp((s) => s.customFontName);
  const focusText = useMarkUi((s) => s.focusText);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const textId = useId();
  const offMap = useOffMap(mark);
  const set = (patch: Partial<Omit<MapMark, 'id'>>) => updateMark(mark.id, patch);

  // Text just placed with the text tool is ready to type over.
  useEffect(() => {
    if (focusText !== mark.id || !textRef.current) return;
    textRef.current.focus();
    textRef.current.select();
    useMarkUi.setState({ focusText: null });
  }, [focusText, mark.id]);

  const typed = hasText(mark);
  const fills: MarkFill[] = fillModesFor(mode);
  // A plotter draws "fill" as hatching with an outline.
  const shown = (f: MarkFill): MarkFill => (mode === 'plotter' && f === 'fill' ? 'hatch-outline' : f);
  const fill = shown(mark.fill);
  const fonts = [{ value: '', label: 'Same as the title', group: '' }, ...fontOptions(customFontName, false)];
  const singleLine = typed && fontInfo(markFont(mark, titleFont))?.kind === 'stroke';
  const textFillShown = textBeside(mark) && !singleLine;
  // Single-line letters are strokes and aren't hatched. Letters inside the shape are cut out of it.
  const hatching = [
    mark.shape !== 'none' ? hatchOptionsFor(fill) : null,
    typed && !singleLine && mark.side !== 'inside' ? hatchOptionsFor(shown(markTextFill(mark))) : null,
  ];
  const hatchShown = hatching.includes('all') ? 'all' : hatching.includes('spacing') ? 'spacing' : null;
  const lines = mark.text.split('\n').filter((l) => l.trim()).length;

  return (
    <div className="mark-editor">
      <Field label="Shape">
        <ShapePicker value={mark.shape} onChange={(shape) => set({ shape })} />
      </Field>
      <div className="field">
        <label htmlFor={textId}>Text</label>
        <textarea
          id={textId}
          ref={textRef}
          className="input mark-text"
          rows={2}
          value={mark.text}
          placeholder={mark.shape === 'none' ? 'Type something' : 'Optional, like Home'}
          onChange={(e) => set({ text: markText(e.target.value) })}
        />
        {mark.shape === 'none' && !typed ? <div className="hint">Text with nothing typed isn't drawn.</div> : null}
        <PlaceholderPreview text={mark.text} />
        <div className="button-row placeholder-row">
          <PlaceholderMenu onInsert={(token) => set({ text: markText(withToken(mark.text, token)) })} />
        </div>
      </div>
      {typed && mark.shape !== 'none' ? (
        <Field label="Text goes">
          <Segmented<MarkSide> label="Text goes" value={mark.side} options={SIDES} onChange={(side) => set({ side })} />
        </Field>
      ) : null}
      {textBeside(mark) ? (
        <NumberField
          label="Gap to the text"
          value={mark.textGap}
          scale={mark.textSize}
          min={MARK_RANGES.textGap.min * mark.textSize}
          max={MARK_RANGES.textGap.max * mark.textSize}
          step={0.1}
          unit="mm"
          onChange={(textGap) => set({ textGap })}
        />
      ) : null}
      <Field
        label="Look"
        hint={mark.shape === 'none' && singleLine ? 'Single-line fonts are always drawn as strokes.' : mark.color ? undefined : 'In the title colour.'}
      >
        <div className="route-style">
          <ColorInput label="Colour" value={mark.color || titleColor} onChange={(color) => set({ color })} />
          <Select<MarkFill> label="Drawn as" value={fill} options={fills.map((value) => ({ value, label: FILL_LABELS[value] }))} onChange={(f) => set({ fill: f })} />
        </div>
        {mark.color ? (
          <button type="button" className="link-button mark-reset" onClick={() => set({ color: '' })}>
            Use the title colour
          </button>
        ) : null}
      </Field>
      {textFillShown ? (
        <SelectField<MarkFill | ''>
          label="Text drawn as"
          value={mark.textFill && shown(mark.textFill)}
          options={[{ value: '', label: 'Same as the shape' }, ...fills.map((value) => ({ value, label: FILL_LABELS[value] }))]}
          onChange={(textFill) => set({ textFill })}
        />
      ) : null}
      {hatchShown ? <HatchFields value={mark.hatch} spacingOnly={hatchShown === 'spacing'} onChange={(patch) => set({ hatch: { ...mark.hatch, ...patch } })} /> : null}
      {mark.shape !== 'none' ? (
        <Slider label="Size" value={mark.size} min={2} max={40} step={0.5} limits={MARK_RANGES.size} unit="mm" onChange={(size) => set({ size })} />
      ) : null}
      {typed ? (
        <>
          <Slider label="Text size" value={mark.textSize} min={1} max={15} step={0.25} limits={MARK_RANGES.textSize} unit="mm" onChange={(textSize) => set({ textSize })} />
          <SelectField label="Font" value={mark.font} options={fonts} onChange={(font) => set({ font })} />
          <Slider
            label="Letter spacing"
            value={mark.letterSpacing}
            min={80}
            max={200}
            step={5}
            limits={{ min: MARK_RANGES.letterSpacing.min * 100, max: MARK_RANGES.letterSpacing.max * 100 }}
            scale={100}
            unit="%"
            onChange={(letterSpacing) => set({ letterSpacing })}
          />
          {lines > 1 ? (
            <>
              <Slider
                label="Line spacing"
                value={mark.lineSpacing}
                min={70}
                max={250}
                step={5}
                limits={{ min: MARK_RANGES.lineSpacing.min * 100, max: MARK_RANGES.lineSpacing.max * 100 }}
                scale={100}
                unit="%"
                onChange={(lineSpacing) => set({ lineSpacing })}
              />
              <Field label="Lines line up" hint={mark.align === 'auto' ? 'On the side next to the shape, or centred.' : undefined}>
                <Segmented<MarkAlign> label="Lines line up" value={mark.align} options={ALIGNS} onChange={(align) => set({ align })} />
              </Field>
            </>
          ) : null}
        </>
      ) : null}
      <Slider label="Turn" value={mark.rotation} min={-180} max={180} step={1} limits={MARK_RANGES.rotation} unit="°" onChange={(rotation) => set({ rotation })} />

      <Disclosure label="Where it stays and the map around it">
        <Field
          label="Stays with"
          hint={mark.anchor === 'map' ? 'It keeps to its spot when the map moves or zooms.' : 'It keeps its place on the piece when the map moves.'}
        >
          <Segmented<MapMark['anchor']>
            label="Stays with"
            value={mark.anchor}
            options={[
              { value: 'map', label: 'The map' },
              { value: 'page', label: 'The page' },
            ]}
            onChange={(anchor) => setMarkAnchor(mark.id, anchor)}
          />
        </Field>
        {mark.anchor === 'map' ? <PlaceSearch mark={mark} /> : null}
        <Check label="Leave the map out under it" checked={mark.clear} onChange={(clear) => set({ clear })} />
        {mark.clear ? <NumberField label="Gap around it" value={mark.gap} {...MARK_RANGES.gap} step={0.1} unit="mm" onChange={(gap) => set({ gap })} /> : null}
      </Disclosure>

      {offMap ? (
        <div className="notice">
          It's outside the map.{' '}
          {mark.anchor === 'map' ? (
            <button type="button" className="link-button" onClick={() => asChange('Move map', () => useApp.getState().setArea({ lon: mark.lon, lat: mark.lat }))}>
              Move the map to it
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="button-row">
        <button type="button" className="btn btn-small" onClick={() => duplicateMark(mark.id)}>
          Duplicate
        </button>
        <button type="button" className="btn btn-small" onClick={() => removeMark(mark.id)}>
          Delete
        </button>
      </div>
    </div>
  );
}
