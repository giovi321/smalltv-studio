import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import * as C from '../src/core/core';
import { crc32, encodePNG, sourceFiles, zip } from '../src/core/source';

/* Minimal reader for the unfiltered RGBA PNGs the exporter writes. */
function decodePNG(png: Uint8Array) {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength), idat: Uint8Array[] = [];
  let width = 0, height = 0;
  for (let at = 8; at < png.length;) {
    const length = v.getUint32(at), type = String.fromCharCode(...png.subarray(at + 4, at + 8)), data = png.subarray(at + 8, at + 8 + length);
    expect(v.getUint32(at + 8 + length)).toBe(crc32(png.subarray(at + 4, at + 8 + length)));
    if (type === 'IHDR') { width = v.getUint32(at + 8); height = v.getUint32(at + 12); }
    if (type === 'IDAT') idat.push(data);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat)), rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (width * 4 + 1)]).toBe(0);
    rgba.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  }
  return { width, height, rgba };
}

describe('source export', () => {
  const project = C.unpack(new Uint8Array(readFileSync(new URL('../fixtures/pixel-room.stheme', import.meta.url))));
  it('writes the firmware source layout', async () => {
    const files = await sourceFiles(project.theme, project.assets);
    expect(files.map(([p]) => p)).toEqual(['theme.json', 'images/background.png', 'animations/cat/000.png', 'animations/cat/001.png', 'animations/cat/002.png', 'animations/cat/003.png']);
    expect(JSON.parse(new TextDecoder().decode(files[0][1]))).toEqual(project.theme);
  });
  it('keeps every RGB565 pixel and alpha value through PNG', async () => {
    for (const [path, asset] of project.assets) {
      const png = decodePNG(await encodePNG(asset.width, asset.height, C.assetRGBA(asset)));
      expect(C.fromRGBA(png.width, png.height, png.rgba), path).toEqual(asset);
    }
  });
  it('escapes non-ASCII in the packaged manifest like json.dumps', () => {
    const theme = structuredClone(project.theme);
    theme.theme.name = 'Café 😀';
    const bytes = C.pack(theme, project.assets), text = new TextDecoder().decode(bytes);
    expect(text).toContain('"name":"Caf\\u00e9 \\ud83d\\ude00"');
    expect(C.unpack(bytes).theme.theme.name).toBe('Café 😀');
  });
  it('builds a valid, reproducible ZIP', () => {
    const a = zip([['t/theme.json', new Uint8Array([123, 125])], ['t/x.png', new Uint8Array([1, 2, 3])]]);
    expect(a).toEqual(zip([['t/theme.json', new Uint8Array([123, 125])], ['t/x.png', new Uint8Array([1, 2, 3])]]));
    const v = new DataView(a.buffer), end = a.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
