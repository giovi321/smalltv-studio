import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as C from '../src/core/core';
import type { DataSource, Theme } from '../src/core/types';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL('../fixtures/' + name + '.stheme', import.meta.url)));
const time = new Date('2026-09-18T00:02:03Z');

describe('pixel-room package', () => {
  const original = fixture('pixel-room');
  const project = C.unpack(original);

  it('unpacks and validates', () => {
    expect(project.theme.theme.id).toBe('pixel-room');
    expect(project.assets.size).toBe(5);
    expect(C.validate(project.theme, project.assets)).toEqual([]);
  });
  it('accepts a pasted .sti suffix without doubling it', () => {
    const pasted = structuredClone(project.theme);
    (pasted.layers[0] as { source: string }).source = 'images/background.png.sti';
    expect(C.validate(pasted, project.assets)).toEqual([]);
  });
  it('packs back to the exact same bytes', () => {
    expect(C.pack(project.theme, project.assets)).toEqual(original);
  });
  it('reports bad colors and truncated packages', () => {
    const bad = structuredClone(project.theme) as Theme;
    (bad.layers[1] as { color: string }).color = 'red';
    expect(C.validate(bad, project.assets).join('\n')).toMatch(/layers\[1\]\.color/);
    expect(() => C.unpack(original.subarray(0, original.length - 1))).toThrow(/package|truncated/i);
  });
  it('expands every clock variable', () => {
    expect(C.expand('{HH} {hh} {MM} {SS} {DD} {MON} {MONTH} {WD} {WEEKDAY} {YYYY}', time)).toBe('00 12 02 03 18 Sep September Fri Friday 2026');
  });
  it('renders, resizes and measures', () => {
    expect(C.render(project.theme, project.assets, time, 0).length).toBe(240 * 240 * 4);
    const resized = C.resizeAsset(project.assets.get('images/background.png.sti')!, 32, 24);
    expect([resized.width, resized.height, resized.colors.length, resized.alpha.length]).toEqual([32, 24, 768, 768]);
    expect(C.bounds(project.theme.layers[1], project.assets, time)).toEqual({ x: 45, y: 35, w: 150, h: 40 });
  });
  it('round-trips STI images', () => {
    for (const asset of project.assets.values()) expect(C.decodeImage(C.encodeImage(asset))).toEqual(asset);
  });
});

describe('data sources', () => {
  const original = fixture('terminal-ops');
  const terminal = C.unpack(original);
  const withData = structuredClone(terminal.theme);
  withData.data = [{ id: 'weather', url: 'https://example.local/w.json', interval: 300, insecureTls: true, fields: [{ id: 'temp', path: 'main.temp' }, { id: 'city', path: 'name' }] }];
  const text = withData.layers.findIndex(l => l.type === 'text');
  (withData.layers[text] as { value: string }).value = '{weather.city} {weather.temp}C';
  const source = (t: Theme) => t.data![0] as DataSource;

  it('keeps the terminal-ops fixture byte-identical', () => {
    expect(terminal.theme.theme.id).toBe('terminal-ops');
    expect(C.validate(terminal.theme, terminal.assets)).toEqual([]);
    expect(C.pack(terminal.theme, terminal.assets)).toEqual(original);
  });
  it('accepts declared data variables', () => {
    expect(C.validate(withData, terminal.assets)).toEqual([]);
    expect(C.dataFields(withData)).toEqual(['weather.temp', 'weather.city']);
  });
  it('follows the firmware rules for insecureTls and hosts', () => {
    const noTls = structuredClone(withData); delete source(noTls).insecureTls;
    expect(C.validate(noTls, terminal.assets).join('\n')).toMatch(/data\[0\]\.insecureTls/);
    const plain = structuredClone(noTls); source(plain).url = 'http://192.168.1.2/w.json';
    expect(C.validate(plain, terminal.assets)).toEqual([]);
    const noHost = structuredClone(plain); source(noHost).url = 'http://';
    expect(C.validate(noHost, terminal.assets).join('\n')).toMatch(/data\[0\]\.url/);
    const badTls = structuredClone(withData); (source(badTls) as { insecureTls: unknown }).insecureTls = 'yes';
    expect(C.validate(badTls, terminal.assets).join('\n')).toMatch(/data\[0\]\.insecureTls/);
  });
  it('rejects undeclared data variables', () => {
    const undeclared = structuredClone(withData); delete undeclared.data;
    expect(C.validate(undeclared, terminal.assets).join('\n')).toMatch(/layers\[\d+\]\.value/);
  });
  it('uses preview values only when given', () => {
    expect(C.expand('{weather.city} {weather.temp}C', time)).toBe('-- --C');
    expect(C.expand('{weather.city} {weather.temp}C', time, { 'weather.city': 'Paris', 'weather.temp': '21' })).toBe('Paris 21C');
    expect(C.bounds({ id: 't', type: 'text', x: 0, y: 0, size: 8, color: '#ffffff', value: '{weather.city}' }, new Map(), time, { 'weather.city': 'Paris' }).w).toBe(5 * Math.ceil(8 * 6 / 8));
    expect(C.render(withData, terminal.assets, time, 0, { 'weather.city': 'Paris', 'weather.temp': '21' }).length).toBe(240 * 240 * 4);
  });
});

describe('unsynchronized clock', () => {
  it('shows -- for clock variables but keeps data values', () => {
    expect(C.expand('{HH}:{MM} {w.t}C', null, { 'w.t': '21' })).toBe('--:-- 21C');
    const project = C.unpack(new Uint8Array(readFileSync(new URL('../fixtures/terminal-ops.stheme', import.meta.url))));
    expect(C.render(project.theme, project.assets, null, 0).length).toBe(240 * 240 * 4);
  });
});
