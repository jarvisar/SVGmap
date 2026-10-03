// Just enough XML for GPX, KML and TCX. DOMParser isn't there in a worker or in
// the tests, and these files are simple: elements, attributes, text and CDATA.
// Element and attribute names lose their namespace prefix, so gx:Track is Track.
export interface XmlVisitor {
  open(name: string, attrs: Record<string, string>): void;
  close(name: string): void;
  text(text: string): void;
}

export class XmlError extends Error {}

const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^>[]|\[[\s\S]*?\])*>|<(\/?)([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTRIBUTE = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY = /&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi;
const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

const localName = (name: string) => name.slice(name.indexOf(':') + 1);

export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY, (whole, entity: string) => {
    if (entity[0] !== '#') return NAMED[entity.toLowerCase()] ?? whole;
    const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

export function walkXml(source: string, visitor: XmlVisitor): void {
  TOKEN.lastIndex = 0;
  let last = 0;
  const stack: string[] = [];
  let root = false;
  const malformed = () => { throw new XmlError("This XML file is incomplete or malformed."); };
  const text = (raw: string) => {
    if (raw.includes('<') || (!stack.length && raw.trim())) malformed();
    if (stack.length) visitor.text(decodeEntities(raw));
  };
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(source)) !== null) {
    if (match.index > last) text(source.slice(last, match.index));
    last = TOKEN.lastIndex;
    const [, cdata, slash, name, attributes, selfClosing] = match;
    if (cdata !== undefined) {
      if (!stack.length) malformed();
      visitor.text(cdata);
      continue;
    }
    if (name === undefined) continue; // comment, declaration or doctype
    const local = localName(name);
    if (slash) {
      if (attributes.trim() || selfClosing || stack.pop() !== name) malformed();
      visitor.close(local);
      continue;
    }
    if (!stack.length) {
      if (root) malformed();
      root = true;
    }
    stack.push(name);
    const attrs: Record<string, string> = {};
    if (attributes) {
      ATTRIBUTE.lastIndex = 0;
      let a: RegExpExecArray | null;
      while ((a = ATTRIBUTE.exec(attributes)) !== null) attrs[localName(a[1])] = decodeEntities(a[2] ?? a[3] ?? '');
    }
    visitor.open(local, attrs);
    if (selfClosing) {
      stack.pop();
      visitor.close(local);
    }
  }
  if (last < source.length) text(source.slice(last));
  if (stack.length || !root) malformed();
}
