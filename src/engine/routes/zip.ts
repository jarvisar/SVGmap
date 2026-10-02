// Reads the KML out of a KMZ, which is a zip file. Google Earth and My Maps
// call it doc.kml, but any .kml file counts. Only stored and deflated entries
// are supported, which is all a KMZ normally has, and no ZIP64.
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_KML_BYTES = 100 * 1024 * 1024;

export class ZipError extends Error {}

interface Entry {
  name: string;
  method: number;
  size: number;
  offset: number;
}

function entries(view: DataView): Entry[] {
  // The end record is at most a 64 KB comment from the end.
  let eocd = -1;
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 22 - 65535); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("This KMZ file couldn't be opened.");
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const out: Entry[] = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > view.byteLength || view.getUint32(at, true) !== CENTRAL) break;
    const nameLength = view.getUint16(at + 28, true);
    const name = decoder.decode(new Uint8Array(view.buffer, view.byteOffset + at + 46, nameLength));
    out.push({
      name,
      method: view.getUint16(at + 10, true),
      size: view.getUint32(at + 20, true),
      offset: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return out;
}

// Stops at the limit instead of filling memory with a zip bomb.
async function inflateRaw(bytes: Uint8Array<ArrayBuffer>, limit: number): Promise<Uint8Array> {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new ZipError('The KML in this KMZ file is too big.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

export async function kmlFromKmz(data: ArrayBuffer): Promise<string> {
  const view = new DataView(data);
  const kml = entries(view).filter((e) => /\.kml$/i.test(e.name) && !e.name.startsWith('__MACOSX/'));
  // doc.kml first, then the least deeply nested.
  kml.sort((a, b) => Number(/(^|\/)doc\.kml$/i.test(b.name)) - Number(/(^|\/)doc\.kml$/i.test(a.name)) || a.name.split('/').length - b.name.split('/').length);
  const entry = kml[0];
  if (!entry) throw new ZipError('This KMZ file has no KML in it.');
  if (entry.offset + 30 > view.byteLength || view.getUint32(entry.offset, true) !== LOCAL) {
    throw new ZipError("This KMZ file couldn't be opened.");
  }
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
  const compressed = new Uint8Array(data, start, Math.min(entry.size, data.byteLength - start));
  let bytes: Uint8Array;
  if (entry.method === 0) bytes = compressed;
  else if (entry.method === 8) bytes = await inflateRaw(compressed.slice(), MAX_KML_BYTES);
  else throw new ZipError("This KMZ file uses a kind of compression that can't be read.");
  return new TextDecoder().decode(bytes);
}
