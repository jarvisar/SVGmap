// Saving files from the page, and making them for each format.
import { toDxf } from '../engine/export/dxf.ts';
import { layerFiles, mirrorResult, slug } from '../engine/export/files.ts';
import { toHpgl } from '../engine/export/hpgl.ts';
import { zipFiles } from '../engine/export/zip.ts';
import type { RenderResult } from '../engine/result.ts';
import { toSvg } from '../engine/svg/writer.ts';
import { toPng } from './preview/png.ts';
import type { ExportOptions, PreviewLook } from './store.ts';

export function download(name: string, content: Blob) {
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The name a file gets unless one's typed, like chicago-laser. */
export const defaultFileName = (result: RenderResult) => `${slug(result.meta.title)}-${result.mode}`;

// What's typed, with anything a file system won't take dropped, and no extension.
export function cleanFileName(typed: string, fallback: string): string {
  const name = typed
    .trim()
    .replace(/\.(svg|dxf|plt|hpgl|png|zip)$/i, '')
    .replace(/\p{Cc}/gu, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .slice(0, 120);
  return name || fallback;
}

/** The file for a render in the format asked for, and its name. */
export async function exportFile(result: RenderResult, options: ExportOptions, look: PreviewLook, name: string): Promise<{ name: string; blob: Blob }> {
  const shown = options.mirror && options.format !== 'png' ? mirrorResult(result) : result;
  switch (options.format) {
    case 'dxf':
      return { name: `${name}.dxf`, blob: new Blob([toDxf(shown)], { type: 'application/dxf' }) };
    case 'hpgl':
      return { name: `${name}.plt`, blob: new Blob([toHpgl(shown)], { type: 'application/vnd.hp-hpgl' }) };
    case 'png':
      return { name: `${name}.png`, blob: await toPng(result, look, options.pngDpi) };
    default: {
      if (!options.split) return { name: `${name}.svg`, blob: new Blob([toSvg(shown)], { type: 'image/svg+xml' }) };
      const encoder = new TextEncoder();
      const zip = zipFiles(layerFiles(shown).map((f) => ({ name: `${name}/${f.name}`, data: encoder.encode(f.svg) })));
      return { name: `${name}.zip`, blob: new Blob([zip as BlobPart], { type: 'application/zip' }) };
    }
  }
}
