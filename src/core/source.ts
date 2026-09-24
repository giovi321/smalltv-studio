/* Source theme export: theme.json plus lossless PNGs, laid out as the firmware's source folders
 * (images/background.png, animations/cat/000.png, ...), bundled in a reproducible ZIP.
 * `tools/smalltv_theme.py build` turns the folder back into a byte-identical package. */
import { assetRGBA, framePaths } from './core';
import type { Assets, Theme } from './types';

const encoder = new TextEncoder();
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes: Uint8Array, crc = 0): number {
  crc = ~crc >>> 0;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 255] ^ (crc >>> 8);
  return ~crc >>> 0;
}
async function deflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

/* RGBA PNG, unfiltered. Written by hand because a canvas round trip premultiplies alpha and loses colors. */
export async function encodePNG(width: number, height: number, rgba: Uint8ClampedArray | Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(encoder.encode(type), 4); out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const header = new Uint8Array(13), hv = new DataView(header.buffer);
  hv.setUint32(0, width); hv.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);   // 8-bit RGBA, deflate, no filter, no interlace
  return concat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array())]);
}

/* Uncompressed ZIP with fixed timestamps, so the same theme always exports the same archive. */
export function zip(files: [string, Uint8Array][]): Uint8Array<ArrayBuffer> {
  const local: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const path = encoder.encode(name), crc = crc32(data);
    const head = new Uint8Array(30 + path.length), h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);   // 1980-01-01
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, path.length, true);
    head.set(path, 30);
    const entry = new Uint8Array(46 + path.length), e = new DataView(entry.buffer);
    e.setUint32(0, 0x02014b50, true); e.setUint16(4, 20, true); e.setUint16(6, 20, true); e.setUint16(14, 0x21, true);
    e.setUint32(16, crc, true); e.setUint32(20, data.length, true); e.setUint32(24, data.length, true); e.setUint16(28, path.length, true);
    e.setUint32(42, offset, true);
    entry.set(path, 46);
    local.push(head, data); central.push(entry);
    offset += head.length + data.length;
  }
  const directory = concat(central), end = new Uint8Array(22), d = new DataView(end.buffer);
  d.setUint32(0, 0x06054b50, true); d.setUint16(8, files.length, true); d.setUint16(10, files.length, true);
  d.setUint32(12, directory.length, true); d.setUint32(16, offset, true);
  return concat([...local, directory, end]);
}

/* Every file of the source folder, theme.json first, then assets in package order. */
export async function sourceFiles(theme: Theme, assets: Assets): Promise<[string, Uint8Array][]> {
  const files: [string, Uint8Array][] = [['theme.json', encoder.encode(JSON.stringify(theme, null, 2) + '\n')]];
  const seen = new Set<string>();
  for (const l of theme.layers) for (const path of framePaths(l)) {
    const asset = assets.get(path);
    if (!asset || seen.has(path)) continue;
    seen.add(path);
    files.push([path.slice(0, -'.sti'.length), await encodePNG(asset.width, asset.height, assetRGBA(asset))]);
  }
  return files;
}
