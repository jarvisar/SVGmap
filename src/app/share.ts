// Share links hold the settings that differ from the defaults, as base64url JSON
// in the URL hash.
import { type Settings, defaultSettings, fillRouteColours, isObject, mergeSettings, packPicks, unpackPicks } from './settings.ts';

function diff(current: unknown, base: unknown): unknown {
  if (isObject(current) && isObject(base)) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(current)) {
      const d = diff(value, base[key]);
      if (d !== undefined) out[key] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return JSON.stringify(current) === JSON.stringify(base) ? undefined : current;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

// Links from before routes have no route colour, so old links (no v) get one
// from their own palette in fillRouteColours. Newer links leave it out only
// when it's the default, and filling it in would change a colour the user
// picked to match the default palette's.
const SHARE_VERSION = 2;

export function encodeSettings(settings: Settings): string {
  const changed = diff(packPicks(settings), packPicks(defaultSettings())) ?? {};
  return toBase64Url(JSON.stringify({ v: SHARE_VERSION, ...(changed as object) }));
}

// null when the text isn't a share link at all.
export function decodeSettings(encoded: string): Settings | null {
  try {
    const json: unknown = JSON.parse(fromBase64Url(encoded));
    const current = isObject(json) && typeof json.v === 'number' && json.v >= SHARE_VERSION;
    return mergeSettings(defaultSettings(), unpackPicks(current ? json : fillRouteColours(json)));
  } catch {
    return null;
  }
}

export function shareUrl(settings: Settings): string {
  const url = new URL(window.location.href);
  url.hash = `s=${encodeSettings(settings)}`;
  return url.href;
}

export function settingsFromUrl(): Settings | null {
  const match = /(?:^#|&)s=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  return match ? decodeSettings(match[1]) : null;
}
