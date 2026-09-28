import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { computeLayout } from '../../engine/layout/layout.ts';
import { PLACE_PRESETS } from '../../engine/presets.ts';
import { Field, NumberInput, Section, Select, Slider } from '../components/controls.tsx';
import { type Place, searchPlaces } from '../geocode.ts';
import { useApp } from '../store.ts';

function formatCoord(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(5)}° ${value >= 0 ? positive : negative}`;
}

function PlaceSearch() {
  const setArea = useApp((s) => s.setArea);
  const setLabel = useApp((s) => s.setLabel);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const abort = useRef<AbortController | null>(null);
  // The name of the place just picked, which doesn't need searching again.
  const picked = useRef('');
  const listId = useId();

  useEffect(() => {
    abort.current?.abort();
    if (query.trim().length < 3 || query === picked.current) {
      setResults([]);
      setMessage('');
      return;
    }
    const timer = setTimeout(() => {
      const controller = new AbortController();
      abort.current = controller;
      searchPlaces(query, controller.signal)
        .then((places) => {
          setResults(places);
          setActive(0);
          setMessage(places.length ? '' : 'No places found.');
        })
        .catch((error: unknown) => {
          if ((error as Error).name !== 'AbortError') setMessage('Search is unavailable right now.');
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  const choose = (place: Place) => {
    setArea({ lon: place.lon, lat: place.lat, widthM: place.widthM, bearing: 0 });
    setLabel({ text: place.name.toUpperCase() });
    picked.current = place.name;
    setQuery(place.name);
    setOpen(false);
  };

  const showList = open && results.length > 0;
  return (
    <div className="search">
      <input
        className="input"
        type="search"
        placeholder="Search for a place"
        aria-label="Search for a place"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList ? `${listId}-${active}` : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
            const step = e.key === 'ArrowDown' ? 1 : -1;
            setActive((a) => Math.max(0, Math.min(results.length - 1, a + step)));
          }
          if (e.key === 'Enter' && results.length > 0) choose(results[Math.min(active, results.length - 1)]);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {showList ? (
        <ul className="search-results" id={listId} role="listbox">
          {results.map((place, i) => (
            <li
              key={place.id + i}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              // Keeps focus in the input, so blur doesn't close the list before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(place)}
            >
              {place.name}
              {place.detail ? <span className="detail">{place.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {message ? <div className="hint">{message}</div> : null}
    </div>
  );
}

export function LocationPanel() {
  const area = useApp((s) => s.area);
  const setArea = useApp((s) => s.setArea);
  const applyPlace = useApp((s) => s.applyPlace);
  const product = useApp((s) => s.product);
  const border = useApp((s) => s.border);

  const windowWidth = useMemo(() => {
    try {
      return computeLayout(product, border).window.w;
    } catch {
      return product.width;
    }
  }, [product, border]);
  const scale = Math.round((area.widthM / windowWidth) * 1000);
  const km = area.widthM / 1000;

  return (
    <Section title="Location" summary={`1:${scale.toLocaleString()}`} defaultOpen>
      <Field label="Find a place">
        <PlaceSearch />
      </Field>
      <Field label="Examples">
        <Select
          value=""
          label="Examples"
          options={[{ value: '', label: 'Choose a city…' }, ...PLACE_PRESETS.map((p) => ({ value: p.id, label: p.name }))]}
          onChange={(id) => id && applyPlace(id)}
        />
      </Field>
      <div className="row">
        <Field label="Map width">
          <NumberInput
            value={km}
            step={0.1}
            min={0.1}
            max={60}
            unit="km"
            label="Map width"
            onChange={(v) => setArea({ widthM: v * 1000 })}
          />
        </Field>
        <Field label="Scale (1:n)">
          <NumberInput
            value={scale}
            step={500}
            min={100}
            max={2000000}
            label="Scale"
            onChange={(v) => setArea({ widthM: (v * windowWidth) / 1000 })}
          />
        </Field>
      </div>
      <Slider
        label="Rotation"
        value={Math.round(area.bearing * 10) / 10}
        min={-180}
        max={180}
        step={1}
        unit="°"
        onChange={(bearing) => setArea({ bearing })}
      />
      <div className="hint">
        {formatCoord(area.lat, 'N', 'S')}, {formatCoord(area.lon, 'E', 'W')}
      </div>
    </Section>
  );
}
