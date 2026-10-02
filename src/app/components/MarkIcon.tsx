import { useId } from 'react';
import { MARK_SHAPES, type MarkShape } from '../../engine/marks/shapes.ts';
import { polylineD } from '../../engine/svg/format.ts';

const rings = (paths: readonly (readonly [number, number])[][]) => paths.map((r) => polylineD(r, true)).join('');

// A shape drawn from the same outline the SVG gets, holes and all.
export function MarkIcon(props: { shape: MarkShape; size?: number }) {
  // React's ids have characters url(#…) doesn't like.
  const mask = `mark-icon${useId().replace(/[^\w-]/g, '')}`;
  const size = props.size ?? 18;
  if (props.shape === 'none') {
    return (
      <svg width={size} height={size} viewBox="-0.6 -0.6 1.2 1.2" aria-hidden="true">
        <path d="M-0.36,-0.4H0.36V-0.22M-0.36,-0.4V-0.22M0,-0.4V0.42M-0.14,0.42H0.14" fill="none" stroke="currentColor" strokeWidth={0.11} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  const def = MARK_SHAPES[props.shape];
  return (
    <svg width={size} height={size} viewBox="-0.6 -0.6 1.2 1.2" aria-hidden="true">
      <mask id={mask}>
        <path d={rings(def.fill)} fill="#fff" />
        {def.holes.length ? <path d={rings(def.holes)} fill="#000" /> : null}
        {def.extra.length ? <path d={rings(def.extra)} fill="#fff" /> : null}
      </mask>
      <rect x={-0.6} y={-0.6} width={1.2} height={1.2} fill="currentColor" mask={`url(#${mask})`} />
    </svg>
  );
}
