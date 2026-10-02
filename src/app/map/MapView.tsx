import { type GeoJSONSource, Map as MapLibre, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useMemo, useRef, useState } from 'react';
import { metresPerPixel, zoomForMetres } from '../../engine/geo/mercator.ts';
import type { AreaSpec } from '../../engine/geo/transform.ts';
import { type Layout, computeLayout } from '../../engine/layout/layout.ts';
import { bandPathD, shapePathD } from '../../engine/layout/shapes.ts';
import { polylineD } from '../../engine/svg/format.ts';
import type { LabelArtwork } from '../../engine/text/label.ts';
import { LockIcon } from '../components/controls.tsx';
import { routesGeoJson } from '../routes.ts';
import { scaleOf, useApp } from '../store.ts';
import { useLabelArtwork } from './useLabelArtwork.ts';

const BASEMAP = 'https://tiles.openfreemap.org/styles/positron';

// MapLibre cannot find its own worker inside a bundle.
setWorkerUrl(maplibreWorker);

const COARSE = matchMedia('(pointer: coarse)').matches;
const HINT = COARSE ? 'Drag to move, pinch to zoom, twist to rotate' : 'Drag to move, scroll to zoom, right-drag to rotate';
const LOCKED_HINT = COARSE ? 'Drag to move, twist to rotate' : 'Drag to move, right-drag to rotate';

const MIN_ZOOM = 0;
const MAX_ZOOM = 24;

// Locking sets both zoom limits to the zoom for the locked scale, which stops
// every way of zooming and greys out the zoom buttons. null opens them again.
function pinZoom(map: MapLibre, zoom: number | null) {
  const min = zoom === null ? MIN_ZOOM : Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  const max = zoom === null ? MAX_ZOOM : min;
  if (map.getMinZoom() === min && map.getMaxZoom() === max) return;
  // MapLibre throws if min would end up above max, so widen the range first.
  map.setMinZoom(MIN_ZOOM);
  map.setMaxZoom(max);
  map.setMinZoom(min);
}

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
  // Sources can only be added once the style has loaded.
  const styleLoaded = useRef(false);
  const showRoutes = useRef(() => {});
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [nudged, setNudged] = useState(false);

  const area = useApp((s) => s.area);
  const product = useApp((s) => s.product);
  const border = useApp((s) => s.border);
  const label = useApp((s) => s.label);
  const customFontId = useApp((s) => s.customFontId);
  const setArea = useApp((s) => s.setArea);
  const scaleLocked = useApp((s) => s.scaleLocked);
  const setScaleLocked = useApp((s) => s.setScaleLocked);
  const scale = Math.round(useApp(scaleOf));
  const routeItems = useApp((s) => s.routes.items);
  const routeColor = useApp((s) => s.styles[s.mode].colors.route);
  const routeData = useMemo(() => routesGeoJson(routeItems), [routeItems]);

  const layout = useMemo(() => {
    try {
      return computeLayout(product, border);
    } catch {
      return null;
    }
  }, [product, border]);
  const frame = useMemo(() => (layout && size.w > 0 ? fitFrame(layout, size.w, size.h) : null), [layout, size]);
  frameRef.current = frame;
  const { artwork, error: labelError } = useLabelArtwork(layout, label, customFontId);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const initial = useApp.getState().area;
    const map = new MapLibre({
      container,
      style: BASEMAP,
      center: [initial.lon, initial.lat],
      zoom: 13,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      bearing: initial.bearing,
      maxPitch: 0,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ visualizePitch: false }), 'top-right');
    map.on('load', () => {
      styleLoaded.current = true;
      showRoutes.current();
    });
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
        // While locked the stored width is exact. Metres per pixel drift a little
        // as the map pans north or south, until the zoom is pinned again.
        widthM: scaleLocked ? area.widthM : f.window.w * metresPerPixel(c.lat, map.getZoom()),
      };
      fromMap.current = next;
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => setArea(next));
    });
    // Zooming does nothing while locked, so point at the lock instead.
    let nudgeTimer = 0;
    const nudge = () => {
      if (!useApp.getState().scaleLocked) return;
      setNudged(true);
      clearTimeout(nudgeTimer);
      nudgeTimer = window.setTimeout(() => setNudged(false), 2500);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '-' || e.key === '=') nudge();
    };
    container.addEventListener('wheel', nudge, { passive: true });
    container.addEventListener('keydown', onKey);
    map.on('dblclick', nudge);
    mapRef.current = map;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(pending);
      clearTimeout(nudgeTimer);
      container.removeEventListener('wheel', nudge);
      container.removeEventListener('keydown', onKey);
      map.remove();
      mapRef.current = null;
      styleLoaded.current = false;
    };
  }, [setArea]);

  // Imported routes on the map, in the route colour on a white casing.
  useEffect(() => {
    const show = () => {
      const map = mapRef.current;
      if (!map || !styleLoaded.current) return;
      const source = map.getSource<GeoJSONSource>('routes');
      if (source) {
        void source.setData(routeData);
      } else {
        map.addSource('routes', { type: 'geojson', data: routeData });
        const layout = { 'line-join': 'round', 'line-cap': 'round' } as const;
        map.addLayer({ id: 'route-casing', type: 'line', source: 'routes', layout, paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.85 } });
        map.addLayer({ id: 'route-line', type: 'line', source: 'routes', layout, paint: { 'line-width': 3 } });
        map.addLayer({
          id: 'route-ends',
          type: 'circle',
          source: 'routes',
          filter: ['==', '$type', 'Point'],
          paint: { 'circle-radius': 4.5, 'circle-stroke-width': 2 },
        });
      }
      map.setPaintProperty('route-line', 'line-color', routeColor);
      // Filled at the start, open at the finish.
      map.setPaintProperty('route-ends', 'circle-color', ['match', ['get', 'end'], 'start', routeColor, '#ffffff']);
      map.setPaintProperty('route-ends', 'circle-stroke-color', routeColor);
    };
    showRoutes.current = show;
    show();
  }, [routeData, routeColor]);

  // Move the map when the frame changes or the area was set somewhere else
  // (search, presets, typed values). Areas the map reported itself are on screen.
  const lastFrame = useRef<Frame | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !frame) return;
    const frameChanged = frame !== lastFrame.current;
    const moved = frameChanged || !sameArea(fromMap.current, area);
    lastFrame.current = frame;
    const zoom = zoomForMetres(area.lat, area.widthM, frame.window.w);
    programmatic.current = true;
    try {
      if (frameChanged) map.resize();
      pinZoom(map, scaleLocked && Number.isFinite(zoom) ? zoom : null);
      if (moved) {
        map.jumpTo({
          center: [area.lon, area.lat],
          zoom: Number.isFinite(zoom) ? zoom : map.getZoom(),
          bearing: area.bearing,
          padding: frame.padding,
        });
      }
    } finally {
      programmatic.current = false;
    }
    fromMap.current = area;
  }, [frame, area, scaleLocked]);

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" />
      {layout && frame ? <Overlay layout={layout} frame={frame} width={size.w} height={size.h} artwork={artwork} /> : null}
      <div className="map-footer">
        <button
          type="button"
          className={scaleLocked ? 'map-scale locked' : 'map-scale'}
          aria-pressed={scaleLocked}
          title={scaleLocked ? 'Unlock the scale to zoom again' : 'Lock the scale'}
          onClick={() => setScaleLocked(!scaleLocked)}
        >
          <LockIcon locked={scaleLocked} />
          1:{scale.toLocaleString()}
          {scaleLocked && nudged ? <span className="map-scale-note">Scale is locked. Click to unlock</span> : null}
        </button>
        <div className="map-hint">{scaleLocked ? LOCKED_HINT : HINT}</div>
      </div>
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
