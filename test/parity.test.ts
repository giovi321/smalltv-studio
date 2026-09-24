/* Renders themes with the firmware's own C++ engine and compares every frame with the studio's renderer.
 * Runs when SMALLTV_MOD points at a smalltv-mod checkout whose native theme tool can build. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as C from '../src/core/core';
import { sourceFiles } from '../src/core/source';
import type { Theme } from '../src/core/types';

const firmware = process.env.SMALLTV_MOD;
const EPOCH = 1790164800, FPS = 15, FRAMES = 120;   // 2026-09-23T12:00:00Z, 8 seconds

function native(): string {
  const script = 'import sys; sys.path.insert(0, "tools"); import theme_native; print(theme_native.executable())';
  return execFileSync('python3', ['-c', script], { cwd: firmware, encoding: 'utf8' }).trim();
}
function compare(name: string, bytes: Uint8Array, data: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'smalltv-parity-')), pkg = join(dir, name + '.stheme'), out = join(dir, name + '.stp');
  writeFileSync(pkg, bytes);
  execFileSync(native(), ['preview', pkg, out, String(EPOCH), String(FPS), String(FRAMES), ...Object.entries(data).map(([k, v]) => k + '=' + v)]);
  const frames = readFileSync(out), { theme, assets } = C.unpack(bytes);
  expect(frames.subarray(0, 4).toString()).toBe('STP1');
  for (let i = 0; i < FRAMES; i++) {
    const ms = Math.floor((i * 1000 + FPS - 1) / FPS), reference = frames.subarray(12 + i * 240 * 240 * 3, 12 + (i + 1) * 240 * 240 * 3);
    const ours = C.render(theme, assets, new Date(EPOCH * 1000 + ms), ms, data);
    for (let p = 0; p < 240 * 240; p++) {
      if (ours[p * 4] !== reference[p * 3] || ours[p * 4 + 1] !== reference[p * 3 + 1] || ours[p * 4 + 2] !== reference[p * 3 + 2])
        throw Error(name + ': frame ' + i + ' (' + ms + ' ms) differs at x=' + (p % 240) + ' y=' + Math.floor(p / 240));
    }
  }
}
const fixture = (name: string) => new Uint8Array(readFileSync(new URL('../fixtures/' + name + '.stheme', import.meta.url)));

/* Every dynamic capability, including values that clamp, fall back or shrink a shape to nothing. */
const dynamic: Theme = {
  spec: 1, theme: { id: 'parity', name: 'Parity', author: 'Studio', version: '1' }, display: { width: 240, height: 240, background: '#101820' },
  data: [{ id: 'd', url: 'http://192.168.1.2/d.json', interval: 60, fields: [{ id: 'a', path: 'a' }, { id: 'b', path: 'b' }, { id: 'bad', path: 'bad' }, { id: 'text', path: 'text' }] }],
  layers: [
    { id: 'round', type: 'shape', shape: 'rectangle', x: 10, y: 10, width: 100, height: 40, cornerRadius: 30, fill: '#335577', stroke: '#ffffff', strokeWidth: 3 },
    { id: 'pill', type: 'shape', shape: 'rectangle', x: 120, y: 10, width: 9, height: 60, cornerRadius: 12, stroke: '#ff8800', strokeWidth: 2,
      bind: { width: { source: 'd.a', input: [0, 100], output: [0, 110] }, cornerRadius: { source: 'd.b', input: [0, 1], output: [0, 120] } } },
    { id: 'dot', type: 'shape', shape: 'circle', x: 60, y: 100, radius: 20, fill: '#00ff00',
      bind: { radius: { source: 'd.a', input: [100, 0], output: [0, 30], clamp: false }, fill: { source: 'd.a', stops: [{ at: 0, value: '#0000ff' }, { at: 50, value: '#ff0000' }] } } },
    { id: 'gone', type: 'shape', shape: 'circle', x: 200, y: 100, radius: 15, fill: '#ffffff', bind: { radius: { source: 'd.b', input: [0, 1], output: [0, 0] } } },
    { id: 'ray', type: 'shape', shape: 'line', x: 10, y: 140, x2: 100, y2: 140, stroke: '#ffff00', strokeWidth: 4,
      bind: { x2: { source: 'd.a', input: [0, 100], output: [0, 230] }, strokeWidth: { source: 'd.bad', input: [0, 1], output: [1, 32] } } },
    { id: 'loop', type: 'text', x: 120, y: 160, anchor: 'top-center', value: '{d.text} loops around', size: 12, color: '#ffffff',
      scroll: { width: 150, mode: 'loop', speed: 37, pause: 300, gap: 10 }, bind: { color: { source: 'd.a', stops: [{ at: 60, value: '#88ff88' }] } } },
    { id: 'bounce', type: 'text', x: 20, y: 180, value: 'Bouncing back and forth {d.text}', size: 16, color: '#ffcc00',
      scroll: { width: 100, mode: 'bounce', speed: 90, pause: 0 }, bind: { 'scroll.width': { source: 'd.b', input: [0, 1], output: [60, 200] } } },
    { id: 'fits', type: 'text', x: 20, y: 205, value: 'short', size: 8, color: '#aaaaaa', scroll: { width: 200, mode: 'loop', speed: 50 },
      bind: { size: { source: 'd.a', input: [0, 100], output: [8, 24] }, y: { source: 'd.a', input: [0, 100], output: [230, 200] } } },
  ],
};

/* Each mutation breaks one rule; the firmware and the studio must both reject it, on the same field. */
type Mutation = [string, (t: Theme & Record<string, any>) => void];
const layer = (t: Theme, id: string) => t.layers.find(l => l.id === id) as Record<string, any>;
const mutations: Mutation[] = [
  ['scroll on a shape', t => { layer(t, 'round').scroll = { width: 10, mode: 'loop', speed: 1 }; }],
  ['scroll mode', t => { layer(t, 'loop').scroll.mode = 'wave'; }],
  ['scroll width', t => { layer(t, 'loop').scroll.width = 0; }],
  ['scroll speed', t => { layer(t, 'loop').scroll.speed = 241; }],
  ['scroll pause', t => { layer(t, 'loop').scroll.pause = 10001; }],
  ['scroll gap in bounce', t => { layer(t, 'bounce').scroll.gap = 4; }],
  ['scroll unknown key', t => { layer(t, 'loop').scroll.delay = 4; }],
  ['corner radius range', t => { layer(t, 'round').cornerRadius = 121; }],
  ['corner radius on a circle', t => { layer(t, 'dot').cornerRadius = 2; }],
  ['unknown binding target', t => { layer(t, 'round').bind = { opacity: { source: 'd.a', input: [0, 1], output: [0, 1] } }; }],
  ['inapplicable binding', t => { layer(t, 'dot').bind.width = { source: 'd.a', input: [0, 1], output: [0, 1] }; }],
  ['color binding without static color', t => { layer(t, 'pill').bind.fill = { source: 'd.a', stops: [{ at: 0, value: '#ffffff' }] }; }],
  ['scroll binding without scroll', t => { layer(t, 'ray').bind = { 'scroll.speed': { source: 'd.a', input: [0, 1], output: [1, 2] } }; }],
  ['undeclared source', t => { layer(t, 'pill').bind.width.source = 'd.missing'; }],
  ['equal input endpoints', t => { layer(t, 'pill').bind.width.input = [5, 5]; }],
  ['output out of range', t => { layer(t, 'pill').bind.width.output = [0, 241]; }],
  ['fractional output', t => { layer(t, 'pill').bind.width.output = [0, 1.5]; }],
  ['three inputs', t => { layer(t, 'pill').bind.width.input = [0, 1, 2]; }],
  ['clamp type', t => { layer(t, 'pill').bind.width.clamp = 'yes'; }],
  ['unknown binding field', t => { layer(t, 'pill').bind.width.ease = 'in'; }],
  ['no stops', t => { layer(t, 'dot').bind.fill.stops = []; }],
  ['nine stops', t => { layer(t, 'dot').bind.fill.stops = Array.from({ length: 9 }, (_, i) => ({ at: i, value: '#000000' })); }],
  ['decreasing stops', t => { layer(t, 'dot').bind.fill.stops[1].at = 0; }],
  ['stop color', t => { layer(t, 'dot').bind.fill.stops[0].value = 'red'; }],
  ['nine bindings', t => { layer(t, 'fits').bind = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map(k => [k, {}])); }],
  ['duplicate source ID', t => { t.data!.push({ ...t.data![0] }); }],
  ['empty path component', t => { t.data![0].fields[0].path = 'a..b'; }],
  ['too deep', t => { layer(t, 'dot').bind.fill.stops[0].value = [[['#000000']]]; }],
];

describe.skipIf(!firmware)('parity with the firmware renderer', () => {
  it('accepts and rejects the same manifests', () => {
    const dir = mkdtempSync(join(tmpdir(), 'smalltv-validate-')), file = join(dir, 'theme.json');
    const firmwareError = (t: Theme) => {
      writeFileSync(file, JSON.stringify(t));
      try { execFileSync(native(), ['validate-manifest', file], { stdio: 'pipe' }); return ''; }
      catch (error) { return String((error as { stderr: Buffer }).stderr).trim(); }
    };
    expect(firmwareError(dynamic)).toBe('');
    expect(C.validate(dynamic)).toEqual([]);
    for (const [name, mutate] of mutations) {
      const t = structuredClone(dynamic) as Theme & Record<string, any>;
      mutate(t);
      const theirs = firmwareError(t), ours = C.validate(t);
      expect(theirs, name).not.toBe('');
      const field = theirs.slice(0, theirs.indexOf(':'));
      expect(ours.some(e => e.startsWith(field + ':') || e.startsWith(field + '.')), name + ': ' + theirs + ' vs ' + ours.join(' | ')).toBe(true);
    }
  });
  it('renders the bundled examples identically', () => {
    compare('pixel-room', fixture('pixel-room'));
    compare('terminal-ops', fixture('terminal-ops'));
    compare('live-status', fixture('live-status'), { 'status.label': 'SmallTV dynamic dashboard headline', 'status.level': '82', 'status.state': 'Warning' });
  }, 120000);
  it('renders scrolling, rounded corners and bindings identically', () => {
    const bytes = C.pack(dynamic, new Map());
    compare('dynamic', bytes, { 'd.a': '73.5', 'd.b': '0.5', 'd.bad': '12px', 'd.text': 'Hello' });
    compare('dynamic-fallback', bytes);
    compare('dynamic-low', bytes, { 'd.a': ' -20 ', 'd.b': '1e0', 'd.text': '' });
  }, 120000);
  it('exports source folders the firmware packer rebuilds byte for byte', async () => {
    const accented = C.unpack(fixture('pixel-room'));
    accented.theme.theme.name = 'Pièce pixel ☕';
    const cases: [string, C.Unpacked][] = [['pixel-room', C.unpack(fixture('pixel-room'))], ['live-status', C.unpack(fixture('live-status'))],
      ['dynamic', { theme: dynamic, assets: new Map() }], ['accented', accented]];
    for (const [name, { theme, assets }] of cases) {
      const dir = mkdtempSync(join(tmpdir(), 'smalltv-source-')), out = join(dir, 'built.stheme');
      for (const [path, data] of await sourceFiles(theme, assets)) {
        mkdirSync(dirname(join(dir, name, path)), { recursive: true });
        writeFileSync(join(dir, name, path), data);
      }
      execFileSync('python3', ['tools/smalltv_theme.py', 'build', join(dir, name), out], { cwd: firmware, stdio: 'pipe' });
      expect(new Uint8Array(readFileSync(out)), name).toEqual(C.pack(theme, assets));
    }
  }, 120000);
});
