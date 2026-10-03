import { type PointerEvent, type Ref, type WheelEvent as ReactWheelEvent, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import type { AreaSpec } from '../../engine/geo/transform.ts';
import type { BorderSettings, Layout, ProductSettings } from '../../engine/layout/layout.ts';
import { bandPathD, shapeCentre, shapePathD } from '../../engine/layout/shapes.ts';
import type { Point } from '../../engine/lines/geometry.ts';
import { resizeCursor, spacedHandles } from '../labelDrag.ts';
import {
  type CaptureChange,
  type CaptureFrame,
  type CaptureGrip,
  type FrameView,
  type ResizeGrip,
  captureHandles,
  dragCapture,
  frameTransform,
  resizePiece,
  toPiece,
  toScreen,
  turnCapture,
} from './captureFrame.ts';

const COARSE = matchMedia('(pointer: coarse)').matches;
const HANDLE_TARGET = COARSE ? 32 : 18;
// How far above the top edge the turning handle sits, in screen pixels.
const ROTATE_OFFSET = COARSE ? 34 : 26;

const rotateTransform = (frame: CaptureFrame, layout: Layout) => {
  const [x, y] = toScreen(frame, [layout.canvas.x + layout.canvas.w / 2, layout.canvas.y]);
  return `translate(${x} ${y}) rotate(${frame.angle})`;
};

// The capture area's own controls on the map: the white margin around the
// map window moves it, the handles resize it and the one above turns it.
// Everything else on the map is left to MapLibre, the title and the marks.
export function CaptureControls(props: {
  ref: Ref<FrameView>;
  layout: Layout;
  area: AreaSpec;
  product: ProductSettings;
  border: BorderSettings;
  frame: CaptureFrame;
  width: number;
  height: number;
  locked: boolean;
  onStart: () => void;
  onHover: (grip: CaptureGrip | null) => void;
  onPreview: (change: CaptureChange | null) => void;
  onCommit: (change: CaptureChange, grip: CaptureGrip) => void;
  onWheel: (e: WheelEvent) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const bandRef = useRef<SVGPathElement>(null);
  const edgeRef = useRef<SVGPathElement>(null);
  const rotateRef = useRef<SVGGElement>(null);
  const handleRefs = useRef(new Map<ResizeGrip, SVGGElement>());
  const currentFrame = useRef(props.frame);
  const handles = useMemo(() => captureHandles(props.layout).map((spot) => ({
    id: spot.id, x: spot.point[0], y: spot.point[1], dx: spot.direction[0], dy: spot.direction[1], label: spot.name,
  })), [props.layout]);
  useImperativeHandle(props.ref, () => ({
    updateFrame(frame) {
      currentFrame.current = frame;
      const transform = frameTransform(frame);
      bandRef.current?.setAttribute('transform', transform);
      edgeRef.current?.setAttribute('transform', transform);
      rotateRef.current?.setAttribute('transform', rotateTransform(frame, props.layout));
      const visible = new Set(spacedHandles(handles, (x, y) => toScreen(frame, [x, y]), HANDLE_TARGET + 4).map((spot) => spot.id));
      for (const spot of handles) {
        const element = handleRefs.current.get(spot.id);
        if (!element) continue;
        const [x, y] = toScreen(frame, [spot.x, spot.y]);
        const [dx, dy] = toScreen({ ...frame, scale: 1, ox: 0, oy: 0 }, [spot.dx, spot.dy]);
        element.setAttribute('transform', `translate(${x} ${y})`);
        element.style.cursor = resizeCursor(dx, dy);
        element.style.display = visible.has(spot.id) ? '' : 'none';
      }
    },
  }), [handles, props.layout]);
  const grab = useRef<{
    pointerId: number;
    grip: CaptureGrip;
    start: Point;
    screen: Point;
    // The pointer's direction from the middle of the map, for turning.
    pivot: Point;
    frame: CaptureFrame;
    area: AreaSpec;
    product: ProductSettings;
    border: BorderSettings;
    layout: Layout;
    locked: boolean;
    to: CaptureChange | null;
  } | null>(null);
  const { onPreview, onHover } = props;
  const release = (pointerId: number) => {
    if (svgRef.current?.hasPointerCapture(pointerId)) svgRef.current.releasePointerCapture(pointerId);
  };
  const cancel = () => {
    const held = grab.current;
    if (!held) return;
    grab.current = null;
    onPreview(null);
    onHover(null);
    release(held.pointerId);
  };
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const point = (e: PointerEvent): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };
  const down = (e: PointerEvent, grip: CaptureGrip) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // A second finger puts the capture back.
    if (grab.current) return cancel();
    props.onStart();
    const screen = point(e);
    const frame = currentFrame.current;
    const pivot = toScreen(frame, shapeCentre(props.layout.window));
    grab.current = {
      pointerId: e.pointerId,
      grip,
      start: toPiece(frame, screen),
      screen,
      pivot,
      frame,
      area: props.area,
      product: props.product,
      border: props.border,
      layout: props.layout,
      locked: props.locked,
      to: null,
    };
    onHover(grip);
    svgRef.current!.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    const held = grab.current;
    if (!held || e.pointerId !== held.pointerId) return;
    const screen = point(e);
    if (!held.to && Math.hypot(screen[0] - held.screen[0], screen[1] - held.screen[1]) < 4) return;
    const p = toPiece(held.frame, screen);
    const [dx, dy] = [p[0] - held.start[0], p[1] - held.start[1]];
    if (held.grip === 'rotate') {
      const angle = (q: Point) => Math.atan2(q[1] - held.pivot[1], q[0] - held.pivot[0]);
      held.to = { area: turnCapture(held.area, angle(held.screen), angle(screen), e.shiftKey ? 15 : 1) };
    } else if (held.grip === 'move' || !held.locked) {
      held.to = { area: dragCapture(held.layout, held.area, held.grip, dx, dy) };
    } else {
      // Past the smallest piece the margins allow, it stays at the last size that fit.
      held.to = resizePiece(held.layout, held.product, held.border, held.area, held.grip, dx, dy) ?? held.to;
    }
    if (held.to) onPreview(held.to);
  };
  const finish = (e: PointerEvent) => {
    const held = grab.current;
    if (!held || e.pointerId !== held.pointerId) return;
    grab.current = null;
    if (e.type === 'pointerup' && held.to) props.onCommit(held.to, held.grip);
    onPreview(null);
    onHover(null);
    release(e.pointerId);
  };
  const hover = (grip: CaptureGrip | null) => () => {
    if (!grab.current) onHover(grip);
  };
  // MapLibre only hears the wheel on its own canvas.
  const wheel = (e: ReactWheelEvent) => props.onWheel(e.nativeEvent);
  const { frame, layout } = props;
  return (
    <svg
      ref={svgRef}
      className="map-capture"
      width={props.width}
      height={props.height}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onWheel={wheel}
    >
      <path
        ref={bandRef}
        className="capture-band"
        d={bandPathD(layout.canvas, layout.window)}
        transform={frameTransform(frame)}
        onPointerDown={(e) => down(e, 'move')}
        onPointerEnter={hover('move')}
        onPointerLeave={hover(null)}
      >
        <title>Drag to move the capture area</title>
      </path>
      <path
        ref={edgeRef}
        className="capture-edge"
        d={shapePathD(layout.canvas)}
        transform={frameTransform(frame)}
        vectorEffect="non-scaling-stroke"
        onPointerDown={(e) => down(e, 'move')}
        onPointerEnter={hover('move')}
        onPointerLeave={hover(null)}
      />
      <g
        ref={rotateRef}
        className="capture-grip capture-rotate"
        transform={rotateTransform(frame, layout)}
        onPointerDown={(e) => down(e, 'rotate')}
        onPointerEnter={hover('rotate')}
        onPointerLeave={hover(null)}
      >
        <title>Drag to turn the capture area</title>
        <line className="capture-rotate-stem" x1={0} y1={0} x2={0} y2={-ROTATE_OFFSET + 5} />
        <circle className="capture-handle-target" cx={0} cy={-ROTATE_OFFSET} r={HANDLE_TARGET / 2} />
        <circle className="capture-handle" cx={0} cy={-ROTATE_OFFSET} r={5} />
      </g>
      {handles.map((spot) => {
        const [x, y] = toScreen(frame, [spot.x, spot.y]);
        const [dx, dy] = toScreen({ ...frame, scale: 1, ox: 0, oy: 0 }, [spot.dx, spot.dy]);
        return (
          <g
            key={spot.id}
            ref={(element) => {
              if (element) handleRefs.current.set(spot.id, element);
              else handleRefs.current.delete(spot.id);
            }}
            className="capture-grip"
            transform={`translate(${x} ${y})`}
            style={{ cursor: resizeCursor(dx, dy) }}
            onPointerDown={(e) => down(e, spot.id)}
            onPointerEnter={hover(spot.id)}
            onPointerLeave={hover(null)}
          >
            <title>{props.locked ? `Resize the piece from its ${spot.label}` : `Resize the capture from its ${spot.label}`}</title>
            <rect className="capture-handle-target" x={-HANDLE_TARGET / 2} y={-HANDLE_TARGET / 2} width={HANDLE_TARGET} height={HANDLE_TARGET} />
            <rect className="capture-handle" data-grip={spot.id} x={-5} y={-5} width={10} height={10} />
          </g>
        );
      })}
    </svg>
  );
}
