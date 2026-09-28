import { CUSTOM_FONT_ID, fontInfo } from './fonts.ts';
import { type HersheyFile, parseHershey } from './hershey.ts';
import { type LoadedFont, parseOutlineFont } from './outline.ts';

export interface CustomFont {
  name: string;
  data: ArrayBuffer;
}

export class FontLoader {
  private readonly cache = new Map<string, Promise<LoadedFont>>();
  private readonly loadAsset: (path: string) => Promise<ArrayBuffer>;

  constructor(loadAsset: (path: string) => Promise<ArrayBuffer>) {
    this.loadAsset = loadAsset;
  }

  load(id: string, custom: CustomFont | null | undefined): Promise<LoadedFont> {
    if (id === CUSTOM_FONT_ID) {
      if (!custom) return Promise.reject(new Error('Load a font file to use a custom font.'));
      const key = `custom:${custom.name}:${custom.data.byteLength}`;
      let pending = this.cache.get(key);
      if (!pending) {
        pending = Promise.resolve().then(() => parseOutlineFont(custom.data.slice(0)));
        this.cache.set(key, pending);
      }
      return pending;
    }
    const info = fontInfo(id) ?? fontInfo('montserrat')!;
    let pending = this.cache.get(info.id);
    if (!pending) {
      pending = this.loadAsset(info.file).then((buffer) =>
        info.kind === 'stroke'
          ? { kind: 'stroke' as const, font: parseHershey(JSON.parse(new TextDecoder().decode(buffer)) as HersheyFile) }
          : parseOutlineFont(buffer),
      );
      pending.catch(() => this.cache.delete(info.id));
      this.cache.set(info.id, pending);
    }
    return pending;
  }
}
