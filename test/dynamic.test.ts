/* Cases ported from the firmware's tests/theme/test_engine.cpp and test_validation.cpp. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as C from '../src/core/core';
import { bindTargets, parseFiniteNumber, resolveColor, resolveLayer, resolveNumeric, scrollOffset } from '../src/core/dynamic';
import type { Layer, NumericBinding, Scroll } from '../src/core/types';

const numeric = (input: [number, number], output: [number, number], clamp?: boolean): NumericBinding => ({ source: 'd.v', input, output, clamp });

describe('bound values', () => {
  it('parses numbers like strtod, without hex, inf, nan or overflow', () => {
    expect(parseFiniteNumber(' 20.5 ')).toBe(20.5);
    expect(parseFiniteNumber('+1.25e2')).toBe(125);
    for (const bad of ['', '20C', 'nan', 'inf', '1e999', '1e-9999', '0x1p2']) expect(parseFiniteNumber(bad)).toBeNull();
  });
  it('maps linearly, clamps and rounds halves away from zero', () => {
    expect(resolveNumeric(numeric([0, 40], [0, 200]), 20, -240, 479)).toBe(100);
    expect(resolveNumeric(numeric([0, 40], [0, 200]), -5, -240, 479)).toBe(0);
    expect(resolveNumeric(numeric([40, 0], [0, 200]), 30, -240, 479)).toBe(50);
    expect(resolveNumeric(numeric([0, 40], [0, 200], false), 100, 0, 240)).toBe(240);
    expect(resolveNumeric(numeric([0, 2], [0, 1]), 1, -10, 10)).toBe(1);
    expect(resolveNumeric(numeric([0, 2], [0, -1]), 1, -10, 10)).toBe(-1);
    expect(resolveNumeric(numeric([0, 12], [0, 54]), 7, -100, 100)).toBe(32);
    expect(resolveNumeric(numeric([0, 12], [0, -54]), 7, -100, 100)).toBe(-32);
  });
  it('survives extreme inputs', () => {
    expect(resolveNumeric(numeric([-Number.MAX_VALUE, Number.MAX_VALUE], [-100, 100]), 0, -240, 479)).toBe(0);
    expect(resolveNumeric(numeric([Number.MAX_VALUE, -Number.MAX_VALUE], [0, 200]), 0, -240, 479)).toBe(100);
    expect(resolveNumeric(numeric([Number.MIN_VALUE, 2 * Number.MIN_VALUE], [0, 10], false), Number.MAX_VALUE, 0, 240)).toBe(240);
  });
  it('picks the last color stop at or below the value', () => {
    const b = { source: 'd.v', stops: [{ at: 0, value: '#00ff00' }, { at: 25, value: '#ffaa00' }, { at: 35, value: '#ff0000' }] };
    expect([resolveColor(b, -1), resolveColor(b, 25), resolveColor(b, 100)]).toEqual(['#00ff00', '#ffaa00', '#ff0000']);
  });
  it('resolves a rectangle and keeps static values without a numeric value', () => {
    const bar: Layer = { id: 'bar', type: 'shape', shape: 'rectangle', x: 20, y: 120, width: 10, height: 18, cornerRadius: 8, fill: '#00ff00',
      bind: { width: numeric([0, 50], [0, 100]), fill: { source: 'd.v', stops: [{ at: 0, value: '#00ff00' }, { at: 50, value: '#ffff00' }] } } };
    expect(resolveLayer(bar)).toMatchObject({ width: 10, fill: '#00ff00', cornerRadius: 5 });
    expect(resolveLayer(bar, { 'd.v': '50' })).toMatchObject({ width: 100, fill: '#ffff00', cornerRadius: 8 });
    expect(resolveLayer(bar, { 'd.v': 'not-a-number' })).toMatchObject({ width: 10, fill: '#00ff00', cornerRadius: 5 });
  });
  it('lists only the properties a layer can bind', () => {
    expect(bindTargets({ id: 't', type: 'text', x: 0, y: 0, value: 'a', size: 8, color: '#ffffff' })).toEqual(['x', 'y', 'size', 'color']);
    expect(bindTargets({ id: 'i', type: 'image', x: 0, y: 0, source: 'a.png' })).toEqual(['x', 'y']);
    expect(bindTargets({ id: 'l', type: 'shape', shape: 'line', x: 0, y: 0, x2: 1, y2: 1, stroke: '#ffffff' })).toEqual(['x', 'y', 'x2', 'y2', 'strokeWidth', 'stroke']);
  });
});

describe('scrolling', () => {
  // "ABCDEFGHIJ" at size 8 is 60 px wide in a 24 px viewport.
  const loop: Scroll = { width: 24, mode: 'loop', speed: 20, pause: 1000, gap: 6 };
  const bounce: Scroll = { width: 24, mode: 'bounce', speed: 20, pause: 1000 };
  const at = (s: Scroll, ms: number, speed = s.speed) => scrollOffset(s, s.width, speed, 60, ms);
  it('loops with a pause at every wrap', () => {
    expect([0, 999, 1049, 1050, 1500, 4299, 4300, 5300, 5350].map(ms => at(loop, ms))).toEqual([0, 0, 0, 1, 10, 65, 0, 0, 1]);
    expect(at(loop, 430001500)).toBe(10);
  });
  it('bounces between both ends', () => {
    expect([1500, 2800, 3800, 3850, 5600, 6600].map(ms => at(bounce, ms))).toEqual([10, 36, 36, 35, 0, 0]);
    expect(at(bounce, 560004350)).toBe(25);
    expect([1800, 1850, 3600].map(ms => at({ ...bounce, pause: 0 }, ms))).toEqual([36, 35, 0]);
  });
  it('carries sub-pixel progress across legs without drift', () => {
    const slow: Scroll = { ...loop, speed: 7, pause: 333 };
    expect([68331, 68806, 68807].map(ms => at(slow, ms))).toEqual([0, 0, 1]);
  });
  it('keeps text that fits still', () => {
    for (const width of [0, 18, 24]) expect(scrollOffset(loop, 24, 20, width, 1000000)).toBe(0);
  });
  it('clips to the viewport and places it with the anchor', () => {
    const text: Layer = { id: 't', type: 'text', x: 120, y: 100, anchor: 'center', value: 'ABCDEFGHIJ', size: 8, color: '#ffffff', scroll: loop };
    expect(C.bounds(text, new Map(), new Date(0))).toEqual({ x: 108, y: 96, w: 24, h: 8 });
  });
});

describe('validation of dynamic properties', () => {
  const live = C.unpack(new Uint8Array(readFileSync(new URL('../fixtures/live-status.stheme', import.meta.url))));
  it('accepts the firmware live-status example and packs it back byte for byte', () => {
    expect(C.validate(live.theme, live.assets)).toEqual([]);
    expect(C.pack(live.theme, live.assets)).toEqual(new Uint8Array(readFileSync(new URL('../fixtures/live-status.stheme', import.meta.url))));
  });
  it('reports scroll, corner radius and binding problems on the right field', () => {
    const t = structuredClone(live.theme) as unknown as { layers: any[] };
    t.layers[3].scroll.gap = 4;                                 // headline-bounce
    t.layers[4].cornerRadius = 121;                             // level-track
    t.layers[5].bind.width.source = 'status.nope';              // level-bar
    t.layers[6].bind.color.stops[1].at = 0;                     // level-caption
    t.layers[1].bind = { fill: { source: 'status.level', stops: [{ at: 0, value: '#ffffff' }] } };  // a line has no fill
    const errors = C.validate(t).join('\n');
    expect(errors).toMatch(/layers\[3\]\.scroll\.gap: not allowed in bounce mode/);
    expect(errors).toMatch(/layers\[4\]\.cornerRadius/);
    expect(errors).toMatch(/layers\[5\]\.bind\.width\.source: expected a declared data field/);
    expect(errors).toMatch(/layers\[6\]\.bind\.color\.stops\[1\]\.at: stops must be strictly increasing/);
    expect(errors).toMatch(/layers\[1\]\.bind\.fill: binding is not applicable to this layer/);
  });
});
