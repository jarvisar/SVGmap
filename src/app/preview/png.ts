// PNG of the piece as the preview shows it, so a laser map comes out as wood
// and not as LightBurn layer colours with hairline strokes.
import { crc32 } from '../../engine/export/crc32.ts';
import type { RenderResult } from '../../engine/result.ts';
import { escapeXml, fmt } from '../../engine/svg/format.ts';
import type { PreviewLook } from '../store.ts';
import { groupPaint, previewBackground } from './paint.ts';

// Safari won't make a canvas bigger than 16384 px a side, and big canvases
// fail on phones. A 600 x 400 mm piece at 300 DPI is about 33 million pixels.
const MAX_SIDE = 16384;
const MAX_PIXELS = 50_000_000;

function previewSvg(result: RenderResult, look: PreviewLook, px: number, py: number): string {
  const w = fmt(result.width);
  const h = fmt(result.height);
  // Print's transparent background stays transparent. The preview only shows it as white.
  const background = result.mode === 'print' && result.background === null ? null : previewBackground(result, look);
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${py}" viewBox="0 0 ${w} ${h}">`,
  ];
  if (background) out.push(`<path d="${result.outline}" fill="${escapeXml(background)}"/>`);
  for (const group of result.groups) {
    const paint = groupPaint(group, result, look);
    let attributes = `fill="${escapeXml(paint.fill)}" stroke="${escapeXml(paint.stroke)}"`;
    if (paint.fillOpacity !== undefined) attributes += ` fill-opacity="${paint.fillOpacity}"`;
    if (paint.strokeOpacity !== undefined) attributes += ` stroke-opacity="${paint.strokeOpacity}"`;
    if (paint.strokeWidth !== undefined) attributes += ` stroke-width="${fmt(paint.strokeWidth)}"`;
    out.push(`<g ${attributes} stroke-linecap="round" stroke-linejoin="round">`);
    for (const p of group.paths) {
      const width = p.strokeWidth !== undefined ? ` stroke-width="${fmt(p.strokeWidth)}"` : '';
      out.push(`<path${width} d="${p.d}"/>`);
    }
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('\n');
}

// Canvas PNGs have no resolution, so most programs open them at 72 or 96 DPI.
// A pHYs chunk after the header makes them open at the piece's real size.
async function withResolution(png: Blob, pixelsPerMetre: number): Promise<Blob> {
  const bytes = new Uint8Array(await png.arrayBuffer());
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // pHYs
  view.setUint32(8, pixelsPerMetre);
  view.setUint32(12, pixelsPerMetre);
  chunk[16] = 1; // Unit is the metre
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  // The signature is 8 bytes and IHDR is always first at 25 bytes.
  const headerEnd = 33;
  return new Blob([bytes.subarray(0, headerEnd), chunk, bytes.subarray(headerEnd)], { type: 'image/png' });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not draw the map.'));
    image.src = url;
  });
}

// dpi is the resolution asked for. It comes down for a piece too big for the browser's canvas.
export async function toPng(result: RenderResult, look: PreviewLook, dpi = 300): Promise<Blob> {
  let scale = dpi / 25.4;
  scale = Math.min(scale, MAX_SIDE / Math.max(result.width, result.height));
  scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (result.width * result.height)));
  // Halve the size when the browser can't make a canvas that big.
  for (let attempt = 0; attempt < 4; attempt++, scale /= 2) {
    const px = Math.round(result.width * scale);
    const py = Math.round(result.height * scale);
    const url = URL.createObjectURL(new Blob([previewSvg(result, look, px, py)], { type: 'image/svg+xml' }));
    try {
      const image = await loadImage(url);
      const canvas = document.createElement('canvas');
      canvas.width = px;
      canvas.height = py;
      const context = canvas.getContext('2d');
      if (!context) continue;
      context.drawImage(image, 0, 0, px, py);
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      canvas.width = 0;
      if (png) return await withResolution(png, Math.round(scale * 1000));
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  throw new Error('The map is too big for this browser to save as a PNG.');
}
