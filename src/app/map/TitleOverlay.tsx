// The title on the map frame. A rough version of what compose does: the gap
// around big letters is drawn as a wide stroke and reversed letters are
// painted over their plate, instead of being worked out with Clipper.
import type { Shape } from '../../engine/layout/shapes.ts';
import { polylineD } from '../../engine/svg/format.ts';
import type { LabelArtwork } from '../../engine/text/label.ts';

const PAPER = 'rgba(255,255,255,0.88)';
const INK = 'rgba(0,0,0,0.75)';

export const BREAK_MASK = 'title-border-breaks';

// Hides the border where the in-border title breaks it.
export function BorderBreakMask(props: { artwork: LabelArtwork | null; canvas: Shape }) {
  const breaks = props.artwork?.borderBreaks ?? [];
  if (breaks.length === 0) return null;
  const { x, y, w, h } = props.canvas;
  return (
    <defs>
      <mask id={BREAK_MASK} maskUnits="userSpaceOnUse" x={x - 10} y={y - 10} width={w + 20} height={h + 20}>
        <rect x={x - 10} y={y - 10} width={w + 20} height={h + 20} fill="#fff" />
        <path d={breaks.map((b) => polylineD(b, true)).join('')} fill="#000" />
      </mask>
    </defs>
  );
}

export function TitleOverlay(props: { artwork: LabelArtwork; windowD: string }) {
  const { artwork, windowD } = props;
  const rings = (paths: readonly (readonly [number, number])[][]) => paths.map((r) => polylineD(r, true)).join('');
  const lines = (paths: readonly (readonly [number, number])[][]) => paths.map((p) => polylineD(p)).join('');
  const letters = rings(artwork.text.rings);
  const strokes = lines(artwork.text.strokes);
  const solid = rings(artwork.solid);
  const gap = artwork.clearGap;
  return (
    <g>
      {artwork.keep ? (
        <path d={windowD + rings(artwork.keep)} fill={PAPER} fillRule="evenodd" />
      ) : (
        <>
          {artwork.clear.length ? (
            <path d={rings(artwork.clear)} fill={PAPER} stroke={gap > 0 ? PAPER : 'none'} strokeWidth={gap * 2} strokeLinejoin="round" />
          ) : null}
          {artwork.clearLines.length ? (
            <path d={lines(artwork.clearLines)} fill="none" stroke={PAPER} strokeWidth={gap * 2 + 0.3} strokeLinecap="round" strokeLinejoin="round" />
          ) : null}
        </>
      )}
      {solid ? <path d={solid} fill={INK} /> : null}
      {artwork.frame.length ? (
        <path d={lines(artwork.frame)} fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ) : null}
      {letters ? <path d={letters} fill={artwork.reversed && solid ? '#fff' : INK} fillRule="nonzero" /> : null}
      {strokes ? (
        <path
          d={strokes}
          fill="none"
          stroke={artwork.reversed && solid ? '#fff' : INK}
          strokeWidth={artwork.reversed ? 0.4 : 1.2}
          vectorEffect={artwork.reversed ? undefined : 'non-scaling-stroke'}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </g>
  );
}
