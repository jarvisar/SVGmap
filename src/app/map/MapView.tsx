import { Map as MapLibre, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useMemo, useRef, useState } from 'react';
import { metresPerPixel, zoomForMetres } from '../../engine/geo/mercator.ts';
import type { AreaSpec } from '../../engine/geo/transform.ts';
import { type Layout, computeLayout } from '../../engine/layout/layout.ts';
import { bandPathD, shapePathD } from '../../engine/layout/shapes.ts';
import { polylineD } from '../../engine/svg/format.ts';
import type { LabelArtwork } from '../../engine/text/label.ts';
import { useApp } from '../store.ts';
import { useLabelArtwork } from './useLabelArtwork.ts';

const BASEMAP = 'https://tiles.openfreemap.org/styles/positron';

// MapLibre cannot find its own worker inside a bundle.
setWorkerUrl(maplibreWorker);

const COARSE = matchMedia('(pointer: coarse)').matches;
const HINT = COARSE ? 'Drag to move, pinch to zoom, twist to rotate' : 'Drag to move, scroll to zoom, right-drag to rotate';
const LOCKED_HINT = COARSE ? 'Drag to move, twist to rotate. Scale is locked' : 'Drag to move, right-drag to rotate. Scale is locked';

interface Frame {
  // px per mm
  scale: number;
  ox: number;
  oy: number;
  window: { x: number; y: number; w: number; h: number };
  padding: { top: number; right: number; bottom: number; left: number };
}

function fitFrame(layout: Layout, width: number, height: number): Frame {
  const hint = 36;
  const pad = Math.max(20, Math.min(width, height) * 0.06);
  const { canvas, window } = layout;
  const scale = Math.max(0.01, Math.min((width - 2 * pad) / canvas.w, (height - 2 * pad - hint) / canvas.h));
  const ox = (width - canvas.w * scale) / 2;
  const oy = (height - hint - canvas.h * scale) / 2;
  const x = ox + window.x * scale;
  const y = oy + window.y * scale;
  const w = window.w * scale;
  const h = window.h * scale;
  return {
    scale,
    ox,
    oy,
    window: { x, y, w, h },
    // MapLibre throws on negative padding.
    padding: { left: Math.max(0, x), top: Math.max(0, y), right: Math.max(0, width - x - w), bottom: Math.max(0, height - y - h) },
  };
}

const sameArea = (a: AreaSpec | null, b: AreaSpec) =>
  a !== null &&
  Math.abs(a.lon - b.lon) < 1e-9 &&
  Math.abs(a.lat - b.lat) < 1e-9 &&
  Math.abs(a.bearing - b.bearing) < 1e-6 &&
  Math.abs(a.widthM / b.widthM - 1) < 1e-6;

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const frameRef = useRef<Frame | null>(null);
  const fromMap = useRef<AreaSpec | null>(null);
  const programmatic = useRef(false);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const area = useApp((s) => s.area);
  const product = useApp((s) => s.product);
  const border = useApp((s) => s.border);
  const label = useApp((s) => s.label);
  const customFontName = useApp((s) => s.customFontName);
  const setArea = useApp((s) => s.setArea);
  const scaleLocked = useApp((s) => s.scaleLocked);

  const layout = useMemo(() => {
    try {
      return computeLayout(product, border);
    } catch {
      return null;
    }
  }, [product, border]);
  const frame = useMemo(() => (layout && size.w > 0 ? fitFrame(layout, size.w, size.h) : null), [layout, size]);
  frameRef.current = frame;
  const { artwork, error: labelError } = useLabelArtwork(layout, label, customFontName);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const initial = useApp.getState().area;
    const map = new MapLibre({
      container,
      style: BASEMAP,
      center: [initial.lon, initial.lat],
      zoom: 13,
      bearing: initial.bearing,
      maxPitch: 0,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ visualizePitch: false }), 'top-right');
    let pending = 0;
    map.on('move', () => {
      const f = frameRef.current;
      if (programmatic.current || !f) return;
      const c = map.getCenter().wrap();
      const { area, scaleLocked } = useApp.getState();
      const next: AreaSpec = {
        lon: c.lng,
        lat: c.lat,
        bearing: map.getBearing(),
        // Keeps the stored width while locked, or the drift in metres per pixel
        // while panning north or south would jump the map mid drag.
        widthM: scaleLocked ? area.widthM : f.window.w * metresPerPixel(c.lat, map.getZoom()),
      };
      fromMap.current = next;
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => setArea(next));
    });
    // Pinching still zooms while locked, so put the zoom back once it stops.
    map.on('moveend', () => {
      const f = frameRef.current;
      const { area, scaleLocked } = useApp.getState();
      if (programmatic.current || !f || !scaleLocked) return;
      const zoom = zoomForMetres(area.lat, area.widthM, f.window.w);
      if (!Number.isFinite(zoom) || Math.abs(zoom - map.getZoom()) < 1e-3) return;
      programmatic.current = true;
      try {
        map.jumpTo({ zoom });
      } finally {
        programmatic.current = false;
      }
    });
    mapRef.current = map;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(pending);
      map.remove();
      mapRef.current = null;
    };
  }, [setArea]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const handler of [map.scrollZoom, map.doubleClickZoom, map.boxZoom]) {
      if (scaleLocked) handler.disable();
      else handler.enable();
    }
  }, [scaleLocked]);

  // Move the map when the frame changes or the area was set somewhere else
  // (search, presets, typed values). Areas the map reported itself are on screen.
  const lastFrame = useRef<Frame | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !frame) return;
    const frameChanged = frame !== lastFrame.current;
    if (!frameChanged && sameArea(fromMap.current, area)) return;
    lastFrame.current = frame;
    programmatic.current = true;
    try {
      if (frameChanged) map.resize();
      const zoom = zoomForMetres(area.lat, area.widthM, frame.window.w);
      map.jumpTo({
        center: [area.lon, area.lat],
        zoom: Number.isFinite(zoom) ? zoom : map.getZoom(),
        bearing: area.bearing,
        padding: frame.padding,
      });
    } finally {
      programmatic.current = false;
    }
    fromMap.current = area;
  }, [frame, area]);

  return (
    <div className={scaleLocked ? 'map-wrap scale-locked' : 'map-wrap'}>
      <div ref={containerRef} className="map" />
      {layout && frame ? <Overlay layout={layout} frame={frame} width={size.w} height={size.h} artwork={artwork} /> : null}
      <div className="map-hint">{scaleLocked ? LOCKED_HINT : HINT}</div>
      {labelError ? <div className="map-notice notice">{labelError}</div> : null}
    </div>
  );
}

function Overlay(props: { layout: Layout; frame: Frame; width: number; height: number; artwork: LabelArtwork | null }) {
  const { layout, frame, width, height, artwork } = props;
  const s = frame.scale;
  const outside = `M${-frame.ox / s},${-frame.oy / s}h${width / s}v${height / s}h${-width / s}Z`;
  const rings = artwork ? artwork.text.rings.map((r) => polylineD(r, true)).join('') : '';
  const strokes = artwork ? artwork.text.strokes.map((p) => polylineD(p)).join('') : '';
  return (
    <svg className="map-overlay" width={width} height={height}>
      <g transform={`translate(${frame.ox} ${frame.oy}) scale(${s})`}>
        <path d={outside + shapePathD(layout.canvas, true)} fill="rgba(40,40,40,0.35)" />
        <path d={bandPathD(layout.canvas, layout.window)} fill="rgba(255,255,255,0.82)" />
        {layout.thickBand ? (
          <path d={bandPathD(layout.thickBand.outer, layout.thickBand.inner)} fill="rgba(0,0,0,0.45)" />
        ) : null}
        {layout.thinLine ? (
          <path d={shapePathD(layout.thinLine)} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ) : null}
        <path d={shapePathD(layout.canvas)} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {artwork ? (
          <g>
            <rect
              x={artwork.knockout[0]}
              y={artwork.knockout[1]}
              width={artwork.knockout[2]}
              height={artwork.knockout[3]}
              fill="rgba(255,255,255,0.88)"
            />
            {artwork.frame.map((seg, i) => (
              <path key={i} d={polylineD(seg)} stroke="rgba(0,0,0,0.6)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {rings ? <path d={rings} fill="rgba(0,0,0,0.75)" fillRule="nonzero" /> : null}
            {strokes ? (
              <path d={strokes} fill="none" stroke="rgba(0,0,0,0.75)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
            ) : null}
          </g>
        ) : null}
      </g>
    </svg>
  );
}
