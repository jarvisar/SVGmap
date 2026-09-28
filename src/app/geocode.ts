// Photon allows search as you type (Nominatim's policy doesn't). The caller
// debounces and cancels old requests, and results are cached here.
export interface Place {
  id: string;
  name: string;
  detail: string;
  lon: number;
  lat: number;
  widthM: number;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_id?: number;
    osm_type?: string;
    name?: string;
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    type?: string;
    osm_value?: string;
    extent?: [number, number, number, number];
  };
}

const cache = new Map<string, Place[]>();

// Starting widths for the map window, in metres. A city's extent covers the
// whole municipality, which is far too much for a street map, so it is capped.
const WIDTH_BY_TYPE: Record<string, number> = {
  country: 400000,
  state: 150000,
  county: 40000,
  city: 5000,
  town: 3500,
  village: 2000,
  district: 3000,
  locality: 2000,
  street: 1200,
  house: 800,
};

function widthFor(f: PhotonFeature): number {
  const byType = WIDTH_BY_TYPE[f.properties.type ?? ''] ?? 3000;
  const extent = f.properties.extent;
  if (!extent) return byType;
  const [west, north, east, south] = extent;
  const lat = (north + south) / 2;
  const w = ((east - west) * Math.PI) / 180 * 6378137 * Math.cos((lat * Math.PI) / 180);
  const h = ((north - south) * Math.PI) / 180 * 6378137;
  const size = Math.max(w, h * 1.4);
  return size > 200 ? Math.min(Math.max(size, 600), byType) : byType;
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const cached = cache.get(q.toLowerCase());
  if (cached) return cached;
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Search failed (${response.status}).`);
  const data = (await response.json()) as { features: PhotonFeature[] };
  const places = data.features.map((f, i): Place => {
    const p = f.properties;
    const detail = [p.city !== p.name ? p.city : undefined, p.state, p.country].filter(Boolean).join(', ');
    return {
      id: `${p.osm_type ?? ''}${p.osm_id ?? i}`,
      name: p.name ?? p.street ?? q,
      detail,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      widthM: widthFor(f),
    };
  });
  cache.set(q.toLowerCase(), places);
  return places;
}
