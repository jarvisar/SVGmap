// The Export button in the top bar and the panel it opens: the file format,
// its options and the file name. Download SVG next to it stays one click.
import { useEffect, useId, useRef, useState } from 'react';
import { hpglPens } from '../../engine/export/hpgl.ts';
import type { RenderResult } from '../../engine/result.ts';
import { cleanFileName, defaultFileName, download, exportFile } from '../files.ts';
import { flash } from '../flash.ts';
import { MATERIALS } from '../preview/paint.ts';
import { EXPORT_FORMATS, type ExportFormat, PNG_DPIS, useApp } from '../store.ts';
import { Check, Segmented } from './controls.tsx';

const FORMATS: Record<ExportFormat, { name: string; extension: string; hint: string }> = {
  svg: { name: 'SVG', extension: 'svg', hint: 'For laser software, Inkscape and plotters. Each layer keeps its colour.' },
  dxf: {
    name: 'DXF',
    extension: 'dxf',
    hint: 'For CAD and laser software that likes DXF. Filled areas come out as outlines for the software to fill.',
  },
  hpgl: { name: 'HPGL', extension: 'plt', hint: 'For vinyl cutters and older pen plotters. Outlines only, one pen for each colour.' },
  png: { name: 'PNG', extension: 'png', hint: 'A picture of the preview, for a listing or a mockup.' },
};

function PenList(props: { result: RenderResult }) {
  const pens = hpglPens(props.result);
  return (
    <ul className="export-pens">
      {pens.map((color, i) => (
        <li key={color}>
          <span className="export-pen-swatch" style={{ background: color }} />
          Pen {i + 1}:{' '}
          {props.result.groups
            .filter((g) => g.color === color)
            .map((g) => g.label)
            .join(', ')}
        </li>
      ))}
    </ul>
  );
}

export function ExportMenu(props: { result: RenderResult | null; ready: boolean }) {
  const { result, ready } = props;
  const options = useApp((s) => s.exportOptions);
  const setOptions = useApp((s) => s.setExportOptions);
  const look = useApp((s) => s.previewLook);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  // Closes on Escape and on a click anywhere else, and gives the focus back.
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('input:checked, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const format = FORMATS[options.format];
  const fallback = result ? defaultFileName(result) : 'map';
  const save = async () => {
    // Enter in the name field gets here too, past the disabled button.
    if (!result || !ready || busy) return;
    setBusy(true);
    try {
      const file = await exportFile(result, options, look, cleanFileName(name, fallback));
      download(file.name, file.blob);
      setOpen(false);
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Could not save the file');
    } finally {
      setBusy(false);
    }
  };
  const vector = options.format !== 'png';

  return (
    <div className="export">
      <button
        ref={button}
        type="button"
        className={open ? 'btn active' : 'btn'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title="DXF, HPGL, PNG, one file per layer, mirrored"
        onClick={() => setOpen(!open)}
      >
        Export
      </button>
      {open ? (
        <div className="export-menu" id={id} role="dialog" aria-label="Export" ref={panel}>
          <fieldset className="export-formats">
            <legend>Format</legend>
            {EXPORT_FORMATS.map((f) => (
              <label key={f} className={f === options.format ? 'export-format active' : 'export-format'}>
                <input type="radio" name={`${id}-format`} value={f} checked={f === options.format} onChange={() => setOptions({ format: f })} />
                <span>
                  <strong>{FORMATS[f].name}</strong>
                  <span className="export-format-hint">{FORMATS[f].hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {vector ? (
            <Check
              label="Mirror it"
              title="Flips it left to right, for engraving the back of clear acrylic or glass"
              checked={options.mirror}
              onChange={(mirror) => setOptions({ mirror })}
            />
          ) : null}
          {options.mirror && vector ? <div className="hint">Flipped left to right, for engraving the back of clear acrylic or glass. The preview isn't.</div> : null}
          {options.format === 'svg' ? (
            <Check
              label={result?.mode === 'plotter' ? 'One file per pen, in a zip' : 'One file per layer, in a zip'}
              title="Each the size of the whole piece, so they line up"
              checked={options.split}
              onChange={(split) => setOptions({ split })}
            />
          ) : null}
          {options.format === 'hpgl' && result ? <PenList result={result} /> : null}
          {options.format === 'png' ? (
            <div className="field">
              <span className="field-label">Resolution</span>
              <Segmented<string>
                label="Resolution"
                value={String(options.pngDpi)}
                options={PNG_DPIS.map((dpi) => ({ value: String(dpi), label: `${dpi} DPI` }))}
                onChange={(dpi) => setOptions({ pngDpi: Number(dpi) })}
              />
              <div className="hint">
                {result?.mode === 'laser'
                  ? `As the preview shows it, on ${look === 'colors' ? 'its file colours' : MATERIALS[look].name.toLowerCase()}. Change that above the preview.`
                  : 'As the preview shows it.'}
              </div>
            </div>
          ) : null}

          <div className="field">
            <label htmlFor={`${id}-name`}>File name</label>
            <div className="input-unit">
              <input id={`${id}-name`} className="input" value={name} placeholder={fallback} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void save()} />
              <span className="unit">.{options.format === 'svg' && options.split ? 'zip' : format.extension}</span>
            </div>
          </div>
          <button type="button" className="btn btn-primary export-save" disabled={!ready || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : `Download ${format.name}`}
          </button>
          {!ready ? <div className="hint">Wait for the preview to catch up first.</div> : null}
        </div>
      ) : null}
    </div>
  );
}
