/* STI2 images (spec 2): rows as runs, in RGB565 or through a palette of up to 16 colors.
 * No DOM dependencies. core.ts only dispatches here by header; the layout is the one the firmware
 * reads (smalltv-mod ThemePackage.cpp) and its packer writes (tools/theme_pack.py).
 *
 * Header (12 bytes): "STI2", width u16, height u16, alpha flag, palette size (0-16), 2 zero bytes.
 * Then the palette (RGB565, plus an alpha byte with the flag), one u32 offset per row counted from
 * the end of that table, and the rows. A row is runs: the top two bits of the first byte are the
 * kind (0 transparent, 1 one pixel repeated, 2 literal pixels, 3 reserved) and the rest the length
 * minus one. With a palette a pixel is an index: one byte in a repeat, two per byte in a literal,
 * high nibble first, an odd run's unused low nibble 0. A row equal to the one above shares its data. */
import type { Asset } from './types';

const MAX_SIDE = 240, MAX_RUN = 64, MAX_PALETTE = 16;
const sideOK = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_SIDE;
export const isSti2 = (bytes: Uint8Array) => bytes.length >= 4 && bytes[0] === 0x53 && bytes[1] === 0x54 && bytes[2] === 0x49 && bytes[3] === 0x32;

/* Reads an STI2 image, refusing exactly what the firmware refuses when it installs a package. */
export function decodeSti2(bytes: Uint8Array): Asset {
  const bad = (why: string) => Error('Invalid STI2 image: ' + why);
  if (bytes.length < 12 || !isSti2(bytes)) throw bad('header');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = v.getUint16(4, true), height = v.getUint16(6, true), flag = bytes[8], palette = bytes[9];
  if (!sideOK(width) || !sideOK(height) || flag > 1 || palette > MAX_PALETTE || bytes[10] || bytes[11]) throw bad('dimensions or header fields');
  const stride = flag ? 3 : 2, table = 12 + palette * stride, rows = table + 4 * height;
  if (bytes.length < rows + 1) throw bad('truncated');
  const data = bytes.length - rows;
  const entryColor = (at: number) => v.getUint16(at, true), entryAlpha = (at: number) => (flag ? bytes[at + 2] : 255);
  const paletteColor = new Uint16Array(palette), paletteAlpha = new Uint8Array(palette);
  for (let i = 0; i < palette; i++) { paletteColor[i] = entryColor(12 + i * stride); paletteAlpha[i] = entryAlpha(12 + i * stride); }
  const offsets = Array.from({ length: height }, (_, y) => v.getUint32(table + 4 * y, true));
  let previous = 0;
  for (const at of offsets) { if (at >= data || at < previous) throw bad('row offsets'); previous = at; }

  const colors = new Uint16Array(width * height), alpha = new Uint8Array(width * height);
  const decoded = new Map<number, { colors: Uint16Array; alpha: Uint8Array }>();
  for (let y = 0; y < height; y++) {
    const start = offsets[y];
    let row = decoded.get(start);
    if (!row) {
      // A row may run up to the next larger offset, or the end of the data.
      let limit = data;
      for (const at of offsets) if (at > start && at < limit) limit = at;
      row = { colors: new Uint16Array(width), alpha: new Uint8Array(width) };
      let pos = rows + start, px = 0;
      const read = (n: number) => { if (pos + n > rows + limit) throw bad('row data ends early'); };
      while (px < width) {
        read(1);
        const head = bytes[pos++], kind = head >> 6, length = (head & 63) + 1;
        if (kind === 3) throw bad('reserved run');
        if (kind === 0 && !flag) throw bad('transparent run without alpha');
        if (px + length > width) throw bad('run goes past the row');
        let color = 0, a = 0, pair = 0;
        for (let i = 0; i < length; i++) {
          if (kind === 2 || (kind === 1 && i === 0)) {
            if (!palette) { read(stride); color = entryColor(pos); a = entryAlpha(pos); pos += stride; }
            else {
              let index: number;
              if (kind === 1) { read(1); index = bytes[pos++]; }
              else if (i % 2 === 0) { read(1); pair = bytes[pos++]; if (i + 1 === length && (pair & 15)) throw bad('unused nibble'); index = pair >> 4; }
              else index = pair & 15;
              if (index >= palette) throw bad('palette index');
              color = paletteColor[index]; a = paletteAlpha[index];
            }
          }
          row.colors[px + i] = a ? color : 0; row.alpha[px + i] = a;
        }
        px += length;
      }
      decoded.set(start, row);
    }
    colors.set(row.colors, y * width); alpha.set(row.alpha, y * width);
  }
  return { width, height, colors, alpha };
}

/* A pixel is its RGB565 color and alpha, or null when fully transparent. */
type Pixel = [number, number] | null;
const same = (a: Pixel, b: Pixel) => a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1]);
/* Splits a row into runs of at most 64 pixels: 0 transparent, 1 one pixel repeated, 2 literal. A
 * repeat starts at `minRepeat` equal pixels. */
function rowRuns(row: Pixel[], minRepeat: number): [number, Pixel[]][] {
  const runs: [number, Pixel[]][] = [];
  let literal: Pixel[] = [];
  const add = (kind: number, pixels: Pixel[]) => { for (let s = 0; s < pixels.length; s += MAX_RUN) runs.push([kind, pixels.slice(s, s + MAX_RUN)]); };
  for (let i = 0, j; i < row.length; i = j) {
    for (j = i; j < row.length && same(row[j], row[i]); j++);
    if (row[i] === null || j - i >= minRepeat) { add(2, literal); literal = []; add(row[i] === null ? 0 : 1, row.slice(i, j)); }
    else literal.push(...row.slice(i, j));
  }
  add(2, literal);
  return runs;
}

/* STI2 for an asset, in runs of colors or, with `indexed`, of palette indices; null when an indexed
 * form needs more than 16 colors. */
export function encodeSti2(asset: Asset, indexed = false): Uint8Array<ArrayBuffer> | null {
  const { width, height, colors, alpha } = asset;
  if (!sideOK(width) || !sideOK(height) || colors.length !== width * height || alpha.length !== width * height) throw Error('Invalid image asset');
  const hasAlpha = alpha.some(a => a !== 255);
  const pixels: Pixel[] = Array.from(colors, (c, i) => (alpha[i] === 0 ? null : [c, alpha[i]]));
  const palette: [number, number][] = [], lookup = new Map<number, number>(), key = (p: [number, number]) => p[0] * 256 + p[1];
  if (indexed) {
    for (const p of pixels) {
      if (!p || lookup.has(key(p))) continue;
      lookup.set(key(p), palette.length); palette.push(p);
      if (palette.length > MAX_PALETTE) return null;
    }
  }
  const color = (p: [number, number]) => (hasAlpha ? [p[0] & 255, p[0] >> 8, p[1]] : [p[0] & 255, p[0] >> 8]);
  const encodeRow = (row: Pixel[]) => {
    const out: number[] = [];
    for (const [kind, run] of rowRuns(row, indexed ? 4 : 2)) {
      out.push(kind << 6 | (run.length - 1));
      if (kind === 1) out.push(...(indexed ? [lookup.get(key(run[0]!))!] : color(run[0]!)));
      else if (kind === 2 && indexed) {
        const indices = [...run.map(p => lookup.get(key(p!))!), 0];
        for (let k = 0; k < run.length; k += 2) out.push(indices[k] << 4 | indices[k + 1]);
      } else if (kind === 2) for (const p of run) out.push(...color(p!));
    }
    return out;
  };
  const head = [0x53, 0x54, 0x49, 0x32, width & 255, width >> 8, height & 255, height >> 8, hasAlpha ? 1 : 0, palette.length, 0, 0];
  for (const p of palette) head.push(...color(p));
  // Offsets count from the end of the table; a row equal to the one above shares its data.
  const offsets: number[] = [], body: number[] = [];
  let last: number[] | null = null;
  for (let y = 0; y < height; y++) {
    const encoded = encodeRow(pixels.slice(y * width, (y + 1) * width));
    if (last && encoded.length === last.length && encoded.every((b, i) => b === last![i])) offsets.push(offsets[offsets.length - 1]);
    else { offsets.push(body.length); for (const b of encoded) body.push(b); last = encoded; }
  }
  const table = offsets.flatMap(o => [o & 255, (o >> 8) & 255, (o >> 16) & 255, o >>> 24]);
  return new Uint8Array([...head, ...table, ...body]);
}
