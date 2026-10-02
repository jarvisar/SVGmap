import { useMemo, useRef, useState } from 'react';
import { fieldRange } from '../../engine/limits.ts';
import { computeLayout } from '../../engine/layout/layout.ts';
import { decodeRoute, routeLengthM } from '../../engine/routes/route.ts';
import type { OutputMode, RouteData, RouteDraw } from '../../engine/settings.ts';
import { Check, ColorInput, Field, NumberField, Section, Select } from '../components/controls.tsx';
import { ROUTE_ACCEPT, fitMapToRoutes, importRouteFiles, shareOutside, visibleRouteLines } from '../routes.ts';
import { useApp } from '../store.ts';
import { HatchOptions, hatchOptionsFor } from './LayersPanel.tsx';

const DRAW_LABELS: Record<OutputMode, Record<RouteDraw, string>> = {
  laser: { fill: 'Engraved band', outline: 'Outlined band', hatch: 'Hatched band', 'hatch-outline': 'Hatched band + outline', contour: 'Contoured band', line: 'Scored line' },
  plotter: { fill: 'Solid band', outline: 'Outlined band', hatch: 'Hatched band', 'hatch-outline': 'Hatched band + outline', contour: 'Contoured band', line: 'Single line' },
  print: { line: 'Line', fill: 'Filled band', outline: 'Outlined band', hatch: 'Hatched band', 'hatch-outline': 'Hatched band + outline', contour: 'Contoured band' },
};

const DRAW_ORDER: Record<OutputMode, RouteDraw[]> = {
  laser: ['fill', 'outline', 'hatch', 'hatch-outline', 'contour', 'line'],
  plotter: ['fill', 'outline', 'hatch', 'hatch-outline', 'contour', 'line'],
  print: ['line', 'fill', 'outline', 'hatch', 'hatch-outline', 'contour'],
};

const DRAW_HINTS: Partial<Record<OutputMode, Partial<Record<RouteDraw, string>>>> = {
  laser: { line: 'A hairline in its own colour, so it can be scored deeper than the streets.' },
  plotter: { fill: 'Pen passes along the route, one pen width apart.', line: 'One pass in its own pen.' },
};

function formatKm(metres: number) {
  return `${(metres / 1000).toFixed(metres < 10_000 ? 2 : 1)} km`;
}

function RouteRow(props: { route: RouteData }) {
  const { route } = props;
  const updateRoute = useApp((s) => s.updateRoute);
  const removeRoute = useApp((s) => s.removeRoute);
  const length = useMemo(() => routeLengthM(decodeRoute(route)), [route]);
  return (
    <div className="layer route-row">
      <Check
        label={
          <>
            <span className="route-name">{route.name}</span>
            <span className="route-length">{formatKm(length)}</span>
          </>
        }
        title={route.name}
        checked={route.visible}
        onChange={(visible) => updateRoute(route.id, { visible })}
      />
      <button type="button" className="icon-button" aria-label={`Remove ${route.name}`} title="Remove" onClick={() => removeRoute(route.id)}>
        <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
        </svg>
      </button>
    </div>
  );
}

export function RoutesPanel() {
  const routes = useApp((s) => s.routes);
  const mode = useApp((s) => s.mode);
  const style = useApp((s) => s.styles[s.mode]);
  const area = useApp((s) => s.area);
  const product = useApp((s) => s.product);
  const border = useApp((s) => s.border);
  const setRoutes = useApp((s) => s.setRoutes);
  const setStyle = useApp((s) => s.setStyle);
  const fileInput = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const lines = useMemo(() => visibleRouteLines(routes.items), [routes.items]);
  const layout = useMemo(() => {
    try {
      return computeLayout(product, border);
    } catch {
      return null;
    }
  }, [product, border]);
  const outside = lines.length && layout ? shareOutside(lines, area, layout) : 0;

  const onFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      setErrors((await importRouteFiles(files)).errors);
    } finally {
      setBusy(false);
    }
  };
  const fit = (rotate: boolean) => void fitMapToRoutes(rotate);

  const count = routes.items.length;
  const draw = style.routeDraw;
  const band = draw !== 'line';
  const hatched = draw === 'line' ? null : hatchOptionsFor(draw);
  const summary = count === 0 ? 'None' : count === 1 ? routes.items[0].name : `${count} routes`;

  return (
    <Section title="Routes" summary={summary}>
      <button type="button" className="btn btn-small" disabled={busy} onClick={() => fileInput.current?.click()}>
        {busy ? 'Reading…' : 'Import route'}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept={ROUTE_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          // Copied first, since clearing the input can empty the list.
          void onFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <div className="hint">
        GPX, KML, KMZ, TCX or GeoJSON, like an activity or route exported from Strava, Garmin, Komoot or Google My Maps. You can
        also drop files onto the page.
      </div>
      {errors.map((error) => (
        <div key={error} className="notice error">
          {error}
        </div>
      ))}

      {count > 0 ? (
        <>
          <div className="route-list">
            {routes.items.map((route) => (
              <RouteRow key={route.id} route={route} />
            ))}
          </div>
          <div className="button-group route-fit">
            <button type="button" className="btn btn-small" disabled={lines.length === 0} onClick={() => fit(false)}>
              Fit map
            </button>
            <button type="button" className="btn btn-small" disabled={lines.length === 0} onClick={() => fit(true)}>
              Fit and rotate
            </button>
          </div>
          {outside > 0.005 ? (
            <div className="hint">
              {outside > 0.995 ? 'The route is outside the frame.' : `About ${Math.max(1, Math.round(outside * 100))}% of the route is outside the frame.`}
            </div>
          ) : null}

          <Field label="Drawn as" hint={DRAW_HINTS[mode]?.[draw]}>
            <div className="route-style">
              <ColorInput label="Route colour" value={style.colors.route} onChange={(color) => setStyle({ colors: { ...style.colors, route: color } })} />
              <Select<RouteDraw>
                label="Drawn as"
                value={draw}
                options={DRAW_ORDER[mode].map((value) => ({ value, label: DRAW_LABELS[mode][value] }))}
                onChange={(routeDraw) => setStyle({ routeDraw })}
              />
            </div>
          </Field>
          <div className="row">
            {band || mode === 'print' ? (
              <NumberField label="Width" value={routes.width} {...fieldRange('routes.width')} step={0.1} unit="mm" onChange={(width) => setRoutes({ width })} />
            ) : null}
            <NumberField label="Gap around it" value={routes.gap} {...fieldRange('routes.gap')} step={0.05} unit="mm" onChange={(gap) => setRoutes({ gap })} />
          </div>
          {hatched ? <HatchOptions layer="route" spacingOnly={hatched === 'spacing'} /> : null}
          <Check label="Start and finish markers" checked={routes.markers} onChange={(markers) => setRoutes({ markers })} />
          {routes.markers ? (
            <NumberField label="Marker size" value={routes.markerSize} {...fieldRange('routes.markerSize')} step={0.1} unit="mm" onChange={(markerSize) => setRoutes({ markerSize })} />
          ) : null}
          <div className="hint">
            Line cleanup never changes the route. Streets, paths and areas closer to it than the gap are left out so it stays
            clear.
          </div>
        </>
      ) : null}
    </Section>
  );
}
