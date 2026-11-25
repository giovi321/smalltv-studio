import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as C from '../src/core/core';
import { decodeSti2, encodeSti2 } from '../src/core/sti2';
import type { Asset, Theme } from '../src/core/types';

/* The shared files of smalltv-mod's tests/theme/sti (see test/fixtures/sti/README.md). */
const dir = new URL('./fixtures/sti/', import.meta.url);
const file = (name: string) => new Uint8Array(readFileSync(new URL(name, dir)));
const expected = JSON.parse(readFileSync(new URL('expected.json', dir), 'utf8')) as Record<string, { width: number; height: number; pixels: [number, number][] }>;
const names = Object.keys(expected).sort();
const pixels = (a: Asset) => Array.from(a.colors, (c, i) => [a.alpha[i] ? c : 0, a.alpha[i]]);
const patched = (bytes: Uint8Array, at: number, value: number) => { const copy = bytes.slice(); copy[at] = value; return copy; };

describe('STI fixtures from smalltv-mod', () => {
  it('has all six files', () => expect(names).toHaveLength(6));
  for (const name of names) {
    it('decodes ' + name + ' to the expected pixels', () => {
      const asset = C.decodeImage(file(name)), want = expected[name];
      expect([asset.width, asset.height]).toEqual([want.width, want.height]);
      expect(pixels(asset)).toEqual(want.pixels);
    });
  }
  it('writes the files back byte for byte', () => {
    for (const source of ['alpha', 'opaque']) {
      const asset = C.decodeImage(file(source + '-sti1.sti'));
      expect(encodeSti2(asset)).toEqual(file(source + '-sti2-direct.sti'));
      expect(encodeSti2(asset, true)).toEqual(file(source + '-sti2-indexed.sti'));
      expect(C.encodeImage(asset)).toEqual(file(source + '-sti1.sti'));
    }
  });
  it('picks the smallest form for a spec 2 theme', () => {
    for (const source of ['alpha', 'opaque']) {
      const asset = C.decodeImage(file(source + '-sti1.sti')), sizes = ['sti1', 'sti2-direct', 'sti2-indexed'].map(f => file(source + '-' + f + '.sti').length);
      expect(C.encodeImage(asset, 2).length).toBe(Math.min(...sizes));
    }
  });
  it('gives up on an indexed form with more than 16 colors', () => {
    const colors = Uint16Array.from({ length: 17 }, (_, i) => i * 100), alpha = new Uint8Array(17).fill(255), asset = { width: 17, height: 1, colors, alpha };
    expect(encodeSti2(asset, true)).toBeNull();
    expect(C.decodeImage(encodeSti2(asset)!).colors).toEqual(colors);
  });
});

describe('STI2 refusals', () => {
  const direct = file('alpha-sti2-direct.sti'), indexed = file('opaque-sti2-indexed.sti');
  it('refuses a damaged header', () => {
    expect(() => decodeSti2(direct.subarray(0, 11))).toThrow(/STI2/);
    expect(() => decodeSti2(patched(direct, 8, 2))).toThrow(/STI2/);    // alpha flag
    expect(() => decodeSti2(patched(direct, 9, 17))).toThrow(/STI2/);   // palette size
    expect(() => decodeSti2(patched(direct, 10, 1))).toThrow(/STI2/);   // reserved
    expect(() => decodeSti2(patched(direct, 4, 0))).toThrow(/STI2/);    // width 0
  });
  it('refuses truncated rows, reserved runs and runs that do not fit', () => {
    const table = 12 + 15 * 2, rows = table + 4 * 4;   // the indexed opaque image: header, 15 palette colors, 4 row offsets
    expect(() => decodeSti2(direct.subarray(0, direct.length - 1))).toThrow(/STI2/);
    expect(() => decodeSti2(patched(indexed, rows, 0xc0))).toThrow(/reserved run/);
    expect(() => decodeSti2(patched(indexed, rows, 0x00))).toThrow(/without alpha/);
    // The third row is two repeats, 64 and 6 pixels: make the second one 16.
    const third = new DataView(indexed.buffer, indexed.byteOffset).getUint32(table + 8, true);
    expect(() => decodeSti2(patched(indexed, rows + third + 2, 0x40 | 15))).toThrow(/past the row/);
  });
  it('refuses a palette index past the palette and a set unused nibble', () => {
    const three = C.decodeImage(encodeSti2({ width: 3, height: 1, colors: Uint16Array.of(1, 2, 3), alpha: new Uint8Array(3).fill(255) }, true)!);
    expect(three.colors).toEqual(Uint16Array.of(1, 2, 3));
    const bytes = encodeSti2(three, true)!;   // header 12, 3 colors of 2 bytes, 1 offset, then: head 0x82, (0,1) (2,0)
    expect(Array.from(bytes.subarray(22))).toEqual([0x82, 0x01, 0x20]);
    expect(() => decodeSti2(patched(bytes, 24, 0x21))).toThrow(/unused nibble/);
    expect(() => decodeSti2(patched(bytes, 24, 0x50))).toThrow(/palette index/);
  });
  it('refuses row offsets that go backwards or past the data', () => {
    const table = 12 + 15 * 2;
    const back = patched(patched(indexed, table + 4, 3), table + 8, 1);
    expect(() => decodeSti2(back)).toThrow(/offsets/);
    expect(() => decodeSti2(patched(indexed, table + 12 + 3, 0x7f))).toThrow(/offsets/);
  });
});

describe('spec 1 and spec 2 packages', () => {
  const asset = C.decodeImage(file('opaque-sti1.sti'));
  const theme = (spec: 1 | 2): Theme => ({
    spec, theme: { id: 'sti', name: 'STI', author: 'Test', version: '1' }, display: { width: 240, height: 240, background: '#000000' },
    layers: [{ id: 'bg', type: 'image', x: 0, y: 0, source: 'images/bg.png' }],
  });
  const assets = new Map([['images/bg.png.sti', asset]]);
  const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

  it('keeps spec 1 on STI1 only', () => {
    const bytes = C.pack(theme(1), assets), text = latin1(bytes);
    expect(text).toContain('STI1');
    expect(text).not.toContain('STI2');
    expect(C.unpack(bytes).theme.spec).toBe(1);
  });
  it('writes STI2 for spec 2 and reads it back', () => {
    const bytes = C.pack(theme(2), assets);
    expect(latin1(bytes)).toContain('STI2');
    const back = C.unpack(bytes);
    expect(back.theme.spec).toBe(2);
    expect(back.assets.get('images/bg.png.sti')).toEqual(asset);
    expect(C.pack(back.theme, back.assets)).toEqual(bytes);
  });
  it('is smaller in spec 2', () => {
    expect(C.pack(theme(2), assets).length).toBeLessThan(C.pack(theme(1), assets).length);
  });
  it('refuses an STI2 image in a spec 1 package with the firmware message', () => {
    const bytes = C.pack(theme(2), assets), at = latin1(bytes).indexOf('"spec":2');
    expect(at).toBeGreaterThan(0);
    expect(() => C.unpack(patched(bytes, at + 7, 0x31))).toThrow('images/bg.png.sti: STI2 image needs "spec": 2');
  });
  it('accepts only spec 1 or 2', () => {
    expect(C.validate({ ...theme(1), spec: 3 }).join()).toContain('spec: expected 1 or 2');
    expect(C.validate(theme(2), assets)).toEqual([]);
  });
});

describe('spec 2 manifest rules', () => {
  const withSource = (spec: 1 | 2, id: string, field = 'temp'): Theme => ({
    spec, theme: { id: 'data', name: 'Data', author: 'Test', version: '1' }, display: { width: 240, height: 240, background: '#000000' },
    data: [{ id, url: 'http://192.168.1.2/d.json', interval: 60, fields: [{ id: field, path: 'a' }] }], layers: [],
  });
  it('refuses a data source called time or device, as the firmware does', () => {
    for (const id of ['time', 'device']) {
      expect(C.validate(withSource(1, id))).toEqual([]);
      expect(C.validate(withSource(2, id))).toEqual(['data[0].id: time and device are the names of built-in sources']);
    }
  });
  it('flags a field called age, which spec 2 reserves for the time since the last fetch', () => {
    expect(C.validate(withSource(1, 'w', 'age'))).toEqual([]);
    expect(C.validate(withSource(2, 'w', 'age')).join()).toMatch(/^data\[0\]\.fields\[0\]\.id: .*age/);
  });
});

describe('spec 2 encoding cache', () => {
  it('encodes an asset once per spec 2 export', () => {
    const asset = C.decodeImage(file('alpha-sti1.sti')), first = C.encodeImage(asset, 2);
    expect(C.encodeImage(asset, 2)).toBe(first);
    expect(C.encodeImage(asset, 1)).toEqual(file('alpha-sti1.sti'));
    expect(C.encodeImage(C.resizeAsset(asset, 35, 5), 2)).not.toBe(first);
  });
});
