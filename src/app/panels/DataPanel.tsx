import { DEFAULT_SOURCE } from '../../engine/settings.ts';
import { Check, NumberField, Section, TextField } from '../components/controls.tsx';
import { useApp } from '../store.ts';

export function DataPanel() {
  const source = useApp((s) => s.source);
  const buildingsShown = useApp((s) => s.layers.buildings);
  // Skipping sidewalks under Layers downloads from Overture too.
  const sidewalks = useApp((s) => s.filters.paths.skipSidewalks && s.layers.paths);
  const set = useApp((s) => s.set);
  const custom = source.tiles !== DEFAULT_SOURCE.tiles;
  const summary = `${custom ? 'Custom source' : 'OpenFreeMap'}${source.overtureBuildings || sidewalks ? ' + Overture' : ''}`;
  return (
    <Section title="Map data" summary={summary}>
      <TextField
        label="Tile source"
        value={source.tiles}
        commitOnBlur
        onChange={(tiles) => set({ source: { ...source, tiles: tiles.trim() || DEFAULT_SOURCE.tiles } })}
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
      <Check
        label="Add missing buildings from Overture"
        checked={source.overtureBuildings}
        disabled={!buildingsShown}
        onChange={(overtureBuildings) => set({ source: { ...source, overtureBuildings } })}
      />
      <div className="hint">
        Adds the building outlines Overture Maps has and OpenStreetMap doesn't, mostly Microsoft's and Google's
        machine-learning footprints. It fills in suburbs and towns nobody has mapped yet, and adds little in big city
        centers. It's a second download, so maps take longer, and it only works at full detail (zoom 14).
        {buildingsShown ? null : ' Turn on the Buildings layer to use it.'}
      </div>
    </Section>
  );
}
