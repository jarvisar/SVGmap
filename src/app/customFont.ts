// Kept in IndexedDB so a loaded font survives a reload.
import type { CustomFont } from '../engine/text/loadFont.ts';

const DB_NAME = 'svgmap';
const STORE = 'files';
const KEY = 'custom-font';

let current: CustomFont | null = null;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function getCustomFont(): CustomFont | null {
  return current;
}

export async function loadStoredFont(): Promise<CustomFont | null> {
  try {
    current = (await withStore<CustomFont | undefined>('readonly', (s) => s.get(KEY))) ?? null;
  } catch {
    current = null;
  }
  return current;
}

export async function storeFont(font: CustomFont | null): Promise<void> {
  current = font;
  try {
    await withStore<unknown>('readwrite', (s) => (font ? s.put(font, KEY) : s.delete(KEY)) as IDBRequest<unknown>);
  } catch {
    // Private windows can refuse storage. The font still works until reload.
  }
}
