import { type ReactNode, useState } from 'react';
import {
  type FillLayerId,
  type FillMode,
  LAYER_NAMES,
  type LayerId,
  type LineLayerId,
  type OutputMode,
} from '../../engine/settings.ts';
import type { FeatureFilters } from '../../engine/tiles/schema.ts';
import { Check, ColorInput, NumberField, Section, Select } from '../components/controls.tsx';
import { useApp } from '../store.ts';

const FILL_ORDER: FillLayerId[] = ['buildings', 'water', 'greens', 'sand', 'rocks', 'aeroways', 'decks'];
const LINE_ORDER: LineLayerId[] = ['roads', 'paths', 'railways', 'waterways', 'raceways'];

type FilterToggle = { label: string; get: (f: FeatureFilters) => boolean; set: (f: FeatureFilters, v: boolean) => FeatureFilters };

const toggle = <G extends keyof FeatureFilters>(group: G, key: string, label: string): FilterToggle => ({
  label,
  get: (f) => (f[group] as Record<string, boolean>)[key],
  set: (f, v) => ({ ...f, [group]: { ...(f[group] as object), [key]: v } }),
});

const FILTERS: Partial<Record<LayerId, FilterToggle[]>> = {
  roads: [
    toggle('roads', 'service', 'Service roads'),
    toggle('roads', 'parkingAisles', 'Parking aisles'),
    toggle('roads', 'driveways', 'Driveways'),
    toggle('roads', 'tracks', 'Tracks'),
    toggle('roads', 'pedestrian', 'Pedestrian streets'),
    toggle('roads', 'busways', 'Busways'),
  ],
  paths: [
    toggle('paths', 'footways', 'Footways and paths'),
    toggle('paths', 'cycleways', 'Cycleways'),
    toggle('paths', 'steps', 'Steps'),
    toggle('paths', 'bridleways', 'Bridleways'),
  ],
  railways: [toggle('railways', 'minor', 'Trams, light rail and metro'), toggle('railways', 'yards', 'Yards and sidings')],
  waterways: [toggle('waterways', 'streams', 'Streams and ditches'), toggle('waterways', 'rivers', 'Rivers and canals')],
  water: [toggle('water', 'pools', 'Swimming pools'), toggle('water', 'intermittent', 'Seasonal water')],
  greens: [
    toggle('greens', 'wetlands', 'Wetlands'),
    toggle('greens', 'pitches', 'Sports pitches'),
    toggle('greens', 'cemeteries', 'Cemeteries'),
  ],
  decks: [toggle('decks', 'bridges', 'Bridge decks')],
};

const FILL_MODE_LABELS: Record<FillMode, string> = {
  fill: 'Fill',
  outline: 'Outline',
  hatch: 'Hatch',
  'hatch-outline': 'Hatch + outline',
};

// A plotter draws "fill" as hatching with an outline.
const effectiveFillMode = (mode: FillMode, output: OutputMode): FillMode =>
  output === 'plotter' && mode === 'fill' ? 'hatch-outline' : mode;

const isHatched = (mode: FillMode) => mode === 'hatch' || mode === 'hatch-outline';

function LayerRow(props: { layer: LayerId; fill: boolean; hasOptions: boolean; children?: ReactNode }) {
  const { layer, fill } = props;
  const [open, setOpen] = useState(false);
  const mode = useApp((s) => s.mode);
  const enabled = useApp((s) => s.layers[layer]);
  const style = useApp((s) => s.styles[s.mode]);
  const decks = useApp((s) => s.decks);
  const set = useApp((s) => s.set);
  const setStyle = useApp((s) => s.setStyle);
  const layers = useApp((s) => s.layers);

  // Piers and plazas only cut the water unless they are engraved too.
  const drawn = layer !== 'decks' || decks.engrave;
  const fillModes: FillMode[] = mode === 'plotter' ? ['outline', 'hatch', 'hatch-outline'] : ['fill', 'outline', 'hatch', 'hatch-outline'];
  const name = LAYER_NAMES[layer];
  const expandable = enabled && props.hasOptions;

  return (
    <>
      <div className="layer">
        <Check label={name} checked={enabled} onChange={(on) => set({ layers: { ...layers, [layer]: on } })} />
        {enabled && drawn ? (
          <ColorInput label={`${name} colour`} value={style.colors[layer]} onChange={(color) => setStyle({ colors: { ...style.colors, [layer]: color } })} />
        ) : null}
        {enabled && drawn && fill ? (
          <Select<FillMode>
            label={`${name} style`}
            value={effectiveFillMode(style.fillModes[layer as FillLayerId], mode)}
            options={fillModes.map((m) => ({ value: m, label: FILL_MODE_LABELS[m] }))}
            onChange={(m) => setStyle({ fillModes: { ...style.fillModes, [layer]: m } })}
          />
        ) : null}
        {expandable ? (
          <button
            type="button"
            className={open ? 'layer-toggle open' : 'layer-toggle'}
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={`${name} options`}
            title="Options"
          />
        ) : (
          <span className="layer-toggle-space" />
        )}
      </div>
      {expandable && open ? <div className="layer-options">{props.children}</div> : null}
    </>
  );
}

function FilterChecks(props: { layer: LayerId }) {
  const filters = useApp((s) => s.filters);
  const setFilters = useApp((s) => s.setFilters);
  return (
    <>
      {(FILTERS[props.layer] ?? []).map((t) => (
        <Check key={t.label} label={t.label} checked={t.get(filters)} onChange={(v) => setFilters((f) => t.set(f, v))} />
      ))}
    </>
  );
}

function HatchOptions(props: { layer: FillLayerId }) {
  const style = useApp((s) => s.styles[s.mode]);
  const setStyle = useApp((s) => s.setStyle);
  const h = style.hatch[props.layer];
  const update = (patch: Partial<typeof h>) => setStyle({ hatch: { ...style.hatch, [props.layer]: { ...h, ...patch } } });
  return (
    <>
      <div className="row">
        <NumberField label="Hatch spacing" value={h.spacing} min={0.1} max={10} step={0.05} unit="mm" onChange={(spacing) => update({ spacing })} />
        <NumberField label="Angle" value={h.angle} min={-180} max={180} step={5} unit="°" onChange={(angle) => update({ angle })} />
      </div>
      <Check label="Cross-hatch" checked={h.cross} onChange={(cross) => update({ cross })} />
    </>
  );
}

function LineWidth(props: { layer: LineLayerId }) {
  const style = useApp((s) => s.styles[s.mode]);
  const setStyle = useApp((s) => s.setStyle);
  return (
    <NumberField
      label={props.layer === 'roads' ? 'Line width (minor roads)' : 'Line width'}
      value={style.lineWidths[props.layer]}
      min={0.02}
      max={5}
      step={0.02}
      unit="mm"
      onChange={(w) => setStyle({ lineWidths: { ...style.lineWidths, [props.layer]: w } })}
    />
  );
}

function WaterOptions() {
  const water = useApp((s) => s.water);
  const set = useApp((s) => s.set);
  return (
    <div className="row">
      <NumberField
        label="Gap around buildings"
        value={water.halo}
        min={0}
        max={3}
        step={0.025}
        unit="mm"
        onChange={(halo) => set({ water: { ...water, halo } })}
      />
      <NumberField
        label="Gap under bridges"
        value={water.bridgeGap}
        min={0}
        max={3}
        step={0.05}
        unit="mm"
        onChange={(bridgeGap) => set({ water: { ...water, bridgeGap } })}
      />
    </div>
  );
}

function SidewalkOption() {
  const skip = useApp((s) => s.filters.paths.skipSidewalks);
  const setFilters = useApp((s) => s.setFilters);
  return (
    <>
      <Check label="Skip sidewalks and crossings" checked={skip} onChange={(skipSidewalks) => setFilters((f) => ({ ...f, paths: { ...f.paths, skipSidewalks } }))} />
      <div className="hint">
        The map tiles don't say which paths are sidewalks, so this downloads the sidewalks and crossings Overture Maps has from
        OpenStreetMap and leaves those out. Park paths and trails stay. It's a second download, so maps take longer.
      </div>
    </>
  );
}

function DeckOptions() {
  const decks = useApp((s) => s.decks);
  const set = useApp((s) => s.set);
  return (
    <>
      <div className="hint">Cut out of the water so piers and plazas read as land.</div>
      <Check label="Engrave them too" checked={decks.engrave} onChange={(engrave) => set({ decks: { ...decks, engrave } })} />
    </>
  );
}

export function LayersPanel() {
  const layers = useApp((s) => s.layers);
  const filters = useApp((s) => s.filters);
  const setFilters = useApp((s) => s.setFilters);
  const mode = useApp((s) => s.mode);
  const fillModes = useApp((s) => s.styles[s.mode].fillModes);
  const engraveDecks = useApp((s) => s.decks.engrave);
  const count = Object.values(layers).filter(Boolean).length;
  return (
    <Section title="Layers" summary={`${count} of ${Object.keys(layers).length}`}>
      <div className="subhead">Areas</div>
      {FILL_ORDER.map((layer) => {
        const drawn = layer !== 'decks' || engraveDecks;
        const hatched = drawn && isHatched(effectiveFillMode(fillModes[layer], mode));
        return (
          <LayerRow key={layer} layer={layer} fill hasOptions={hatched || layer === 'water' || layer === 'decks' || Boolean(FILTERS[layer])}>
            {layer === 'water' ? <WaterOptions /> : null}
            {layer === 'decks' ? <DeckOptions /> : null}
            <FilterChecks layer={layer} />
            {hatched ? <HatchOptions layer={layer} /> : null}
          </LayerRow>
        );
      })}
      <div className="subhead">Lines</div>
      {LINE_ORDER.map((layer) => (
        <LayerRow key={layer} layer={layer} fill={false} hasOptions={layer === 'raceways' || mode === 'print' || Boolean(FILTERS[layer])}>
          {layer === 'raceways' ? <div className="hint">Drawn exactly as mapped. Line cleanup skips them.</div> : null}
          <FilterChecks layer={layer} />
          {layer === 'paths' ? <SidewalkOption /> : null}
          {mode === 'print' ? <LineWidth layer={layer} /> : null}
        </LayerRow>
      ))}
      <Check
        label="Leave out tunnels"
        checked={filters.skipTunnels}
        onChange={(skipTunnels) => setFilters((f) => ({ ...f, skipTunnels }))}
      />
    </Section>
  );
}
