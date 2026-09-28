import { DEFAULT_SOURCE } from '../../engine/settings.ts';
import { NumberField, Section, TextField } from '../components/controls.tsx';
import { useApp } from '../store.ts';

export function DataPanel() {
  const source = useApp((s) => s.source);
  const set = useApp((s) => s.set);
  const custom = source.tiles !== DEFAULT_SOURCE.tiles;
  return (
    <Section title="Map data" summary={custom ? 'Custom source' : 'OpenFreeMap'}>
      <TextField
        label="Tile source"
        value={source.tiles}
        onChange={(tiles) => set({ source: { ...source, tiles } })}
        hint="A TileJSON URL, a {z}/{x}/{y} template or a .pmtiles file. It has to use the OpenMapTiles schema."
      />
      {custom ? (
        <button type="button" className="btn btn-small" style={{ marginTop: 6 }} onClick={() => set({ source: { ...source, tiles: DEFAULT_SOURCE.tiles } })}>
          Use OpenFreeMap
        </button>
      ) : null}
      <NumberField
        label="Most tiles per map"
        value={source.maxTiles}
        min={4}
        max={2000}
        step={10}
        onChange={(maxTiles) => set({ source: { ...source, maxTiles } })}
        hint="Bigger areas switch to less detailed tiles to stay under this."
      />
    </Section>
  );
}
