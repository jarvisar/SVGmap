// Moving and resizing the title in the preview: the title drawn over the
// result while it's dragged, its outline and handles, and the card beside it.
import type { Layout } from '../../engine/layout/layout.ts';
import { shapePathD } from '../../engine/layout/shapes.ts';
import type { RenderResult } from '../../engine/result.ts';
import { fmt, polylineD } from '../../engine/svg/format.ts';
import type { LabelArtwork, LabelSettings } from '../../engine/text/label.ts';
import { geometryBounds } from '../../engine/text/outline.ts';
import { Check } from '../components/controls.tsx';
import { AUTOFIT_HELP, type HandleSpot, RESET_OFFSET, boxResized, labelMoved } from '../labelDrag.ts';
import type { PreviewLook } from '../store.ts';
import { previewBackground, previewInk } from './paint.ts';

const rings = (paths: readonly (readonly [number, number])[][]) => paths.map((r) => polylineD(r, true)).join('');
const lines = (paths: readonly (readonly [number, number])[][]) => paths.map((p) => polylineD(p)).join('');

// The title laid out on the main thread, drawn while it's dragged and until
// the render with it in its new place comes back. Fills are drawn solid even
// when the file hatches them. What the title clears of the map is painted
// over only inside the window, or a band painted over the border at its ends.
export function TitleGhost(props: { artwork: LabelArtwork; result: RenderResult; look: PreviewLook; layout: Layout }) {
  const { artwork, result, look, layout } = props;
  const background = previewBackground(result, look);
  const text = previewInk(result, look, 'text');
  const letters = rings(artwork.text.rings);
  const strokes = lines(artwork.text.strokes);
  const solid = rings(artwork.solid);
  const bare = artwork.reversed && solid ? background : text;
  return (
    <g pointerEvents="none">
      <clipPath id="preview-title-window">
        <path d={shapePathD(layout.window)} />
      </clipPath>
      {artwork.clear.length ? <path d={rings(artwork.clear)} fill={background} clipPath="url(#preview-title-window)" /> : null}
      {solid ? <path d={solid} fill={text} /> : null}
      {artwork.frame.length ? (
        <path d={lines(artwork.frame)} fill="none" stroke={previewInk(result, look, 'frame')} strokeWidth={Math.max(artwork.frameWidth, 0.1)} />
      ) : null}
      {letters ? <path d={letters} fill={bare} /> : null}
      {strokes ? <path d={strokes} fill="none" stroke={bare} strokeWidth={0.3} strokeLinecap="round" strokeLinejoin="round" /> : null}
    </g>
  );
}

// Handles in screen pixels.
export const HANDLE_SIZE = 9;

// The outline of the title under the pointer or selected, with its handles
// when selected. unit is millimetres per screen pixel.
export function TitleFrame(props: { artwork: LabelArtwork; label: LabelSettings; handles: HandleSpot[]; selected: boolean; unit: number }) {
  const { artwork, label, handles, selected, unit } = props;
  const [x, y, w, h] = artwork.knockout;
  const text = label.style === 'band' && handles.length > 1 ? geometryBounds(artwork.text) : null;
  const s = HANDLE_SIZE * unit;
  return (
    <g pointerEvents="none">
      <rect className={selected ? 'title-frame' : 'title-grab'} x={fmt(x)} y={fmt(y)} width={fmt(w)} height={fmt(h)} />
      {text ? <rect className="title-grab" x={fmt(text[0])} y={fmt(text[1])} width={fmt(text[2] - text[0])} height={fmt(text[3] - text[1])} /> : null}
      {handles.map((handle) => (
        <rect key={handle.id} className="title-handle" x={fmt(handle.x - s / 2)} y={fmt(handle.y - s / 2)} width={fmt(s)} height={fmt(s)} />
      ))}
    </g>
  );
}

export function TitleCard({ label, onChange, onClose }: { label: LabelSettings; onChange: (patch: Partial<LabelSettings>) => void; onClose: () => void }) {
  const resized = boxResized(label);
  const moved = labelMoved(label);
  const intro =
    label.style === 'box'
      ? 'Drag the title to move it, a corner to resize it, or a side to resize the box.'
      : label.style === 'band'
        ? label.autofit
          ? 'Drag the text to move it, or the edge to resize the band.'
          : 'Drag the text to move it, its corners to resize it, or the edge to resize the band.'
        : 'Drag the title to move it, or a corner to resize it.';
  const autofit = AUTOFIT_HELP[label.style];
  return (
    <section className="preview-card" aria-label="Title">
      <header className="preview-card-header">
        <h2>Title</h2>
        <button type="button" className="icon-button" aria-label="Let go of the title" title="Let go of the title" onClick={onClose}>
          ×
        </button>
      </header>
      <p className="preview-card-text">{intro}</p>
      {autofit ? <Check label="Autofit text" title={autofit} checked={label.autofit} onChange={(value) => onChange({ autofit: value })} /> : null}
      {resized || moved ? (
        <div className="preview-card-actions">
          {resized ? (
            <button type="button" className="btn btn-small" onClick={() => onChange({ boxWidth: 0, boxHeight: 0 })}>
              Fit the box to the text
            </button>
          ) : null}
          {moved ? (
            <button type="button" className="btn btn-small" onClick={() => onChange(RESET_OFFSET)}>
              Reset the position
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
