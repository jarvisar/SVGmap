// Share links hold the settings that differ from the defaults, as base64url JSON
// in the URL hash.
import { type Settings, deepMerge, defaultSettings } from './store.ts';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

export function shareUrl(settings: Settings): string {
  const changed = diff(settings, defaultSettings()) ?? {};
  const url = new URL(window.location.href);
  url.hash = `s=${toBase64Url(JSON.stringify(changed))}`;
  return url.href;
}

export function settingsFromUrl(): Settings | null {
  const match = /(?:^#|&)s=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  if (!match) return null;
  try {
    return deepMerge(defaultSettings(), JSON.parse(fromBase64Url(match[1])));
  } catch {
    return null;
  }
}
