/* Data bindings and text scrolling, mirroring the firmware's ThemeEngine.cpp. No DOM dependencies. */
import type { BindTarget, Binding, ColorBinding, Layer, NumericBinding, NumericTarget, Scroll } from './types';

export const MAX_BINDINGS = 8, MAX_STOPS = 8;
export const numericTargets: readonly NumericTarget[] = ['x', 'y', 'width', 'height', 'radius', 'cornerRadius', 'x2', 'y2', 'size', 'strokeWidth', 'scroll.width', 'scroll.speed'];
export const colorTargets = ['color', 'fill', 'stroke'] as const;
export const isColorTarget = (t: string): t is (typeof colorTargets)[number] => (colorTargets as readonly string[]).includes(t);
export const isColorBinding = (b: Binding): b is ColorBinding => 'stops' in b;
export const isNumericBinding = (b: Binding): b is NumericBinding => !('stops' in b);

/* Safe range of every numeric target; the resolved value is always clamped to it. */
export const targetRange: Record<NumericTarget, [number, number]> = {
  x: [-240, 479], y: [-240, 479], x2: [-240, 479], y2: [-240, 479],
  width: [0, 240], height: [0, 240], radius: [0, 240], cornerRadius: [0, 120],
  size: [8, 96], strokeWidth: [1, 32], 'scroll.width': [1, 240], 'scroll.speed': [1, 240],
};

/* Which properties a layer may bind. Colors only when the property exists statically. */
export function applicable(l: Layer, target: BindTarget): boolean {
  if (target === 'color') return l.type === 'text';
  if (target === 'fill') return l.type === 'shape' && l.fill != null;
  if (target === 'stroke') return l.type === 'shape' && l.stroke != null;
  if (target === 'x' || target === 'y') return true;
  if (target === 'scroll.width' || target === 'scroll.speed') return l.type === 'text' && l.scroll != null;
  if (l.type === 'text') return target === 'size';
  if (l.type !== 'shape') return false;
  if (target === 'strokeWidth') return true;
  if (l.shape === 'rectangle') return target === 'width' || target === 'height' || target === 'cornerRadius';
  if (l.shape === 'circle') return target === 'radius';
  return target === 'x2' || target === 'y2';
}
export const bindTargets = (l: Layer): BindTarget[] => [...numericTargets, ...colorTargets].filter(t => applicable(l, t));

/* strtod-compatible decimal parsing: surrounding ASCII space allowed, no hex, inf or nan, no over/underflow. */
export function parseFiniteNumber(text: string): number | null {
  const trimmed = text.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '');
  const match = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.exec(trimmed);
  if (!match) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  // strtod reports ERANGE when a non-zero mantissa underflows to zero or to a subnormal.
  if (/[1-9]/.test(match[1]) && Math.abs(n) < 2.2250738585072014e-308) return null;
  return n;
}

const roundHalfAway = (n: number) => Math.sign(n) * Math.round(Math.abs(n));
const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
export function resolveNumeric(b: NumericBinding, value: number, lo: number, hi: number): number {
  if (lo > hi) [lo, hi] = [hi, lo];
  const [input0, input1] = b.input, [output0, output1] = b.output;
  if (!Number.isFinite(value) || !Number.isFinite(input0) || !Number.isFinite(input1) || input0 === input1) return clampInt(output0, lo, hi);
  if (b.clamp !== false) value = Math.max(Math.min(input0, input1), Math.min(value, Math.max(input0, input1)));
  const outputDelta = output1 - output0, inputDelta = input1 - input0, numerator = (value - input0) * outputDelta;
  let mapped: number;
  if (Number.isFinite(inputDelta) && Number.isFinite(numerator)) mapped = output0 + numerator / inputDelta;
  else {
    const scale = Math.max(Math.abs(input0), Math.abs(input1));
    if (scale === 0) return clampInt(output0, lo, hi);
    const denominator = input1 / scale - input0 / scale;
    if (denominator === 0) return clampInt(output0, lo, hi);
    mapped = output0 + ((value / scale - input0 / scale) / denominator) * outputDelta;
  }
  if (Number.isNaN(mapped)) return clampInt(output0, lo, hi);
  if (mapped <= lo) return lo;
  if (mapped >= hi) return hi;
  return roundHalfAway(mapped);
}
/* The last stop at or below the value; below the first stop, the first color. */
export function resolveColor(b: ColorBinding, value: number): string {
  let result = b.stops[0]?.value ?? '#000000';
  for (const stop of b.stops) {
    if (stop.at > value) break;
    result = stop.value;
  }
  return result;
}

/* Effective geometry and colors once bindings are applied. Missing or non-numeric values keep the static ones. */
export interface Resolved {
  x: number; y: number; width: number; height: number; x2: number; y2: number; radius: number; cornerRadius: number;
  size: number; strokeWidth: number; scrollWidth: number; scrollSpeed: number;
  color?: string; fill?: string; stroke?: string;
}
export function resolveLayer(l: Layer, data: Record<string, string> = {}): Resolved {
  const shape = l.type === 'shape' ? l : null, text = l.type === 'text' ? l : null, anim = l.type === 'animation' ? l : null;
  const r: Resolved = {
    x: l.x, y: l.y, width: shape?.width ?? anim?.width ?? 0, height: shape?.height ?? anim?.height ?? 0,
    x2: shape?.x2 ?? 0, y2: shape?.y2 ?? 0, radius: shape?.radius ?? 0, cornerRadius: shape?.cornerRadius ?? 0,
    size: text?.size ?? 16, strokeWidth: shape?.strokeWidth ?? 1, scrollWidth: text?.scroll?.width ?? 0, scrollSpeed: text?.scroll?.speed ?? 0,
    color: text?.color, fill: shape?.fill, stroke: shape?.stroke,
  };
  for (const [target, binding] of Object.entries(l.bind ?? {}) as [BindTarget, Binding][]) {
    const raw = data[binding.source], value = raw == null ? null : parseFiniteNumber(raw);
    if (value == null) continue;
    if (isColorTarget(target)) { if (isColorBinding(binding)) r[target] = resolveColor(binding, value); continue; }
    if (!isNumericBinding(binding)) continue;
    const [lo, hi] = targetRange[target], n = resolveNumeric(binding, value, lo, hi);
    if (target === 'scroll.width') r.scrollWidth = n;
    else if (target === 'scroll.speed') r.scrollSpeed = n;
    else r[target] = n;
  }
  if (shape?.shape === 'rectangle') r.cornerRadius = Math.min(r.cornerRadius, Math.max(0, Math.floor(Math.min(r.width, r.height) / 2)));
  return r;
}

/* ---------- scrolling ---------- */
export const textPixelWidth = (size: number, length: number) => length * Math.floor((size * 6 + 7) / 8);
interface ScrollState { offset: number; direction: number; phase: number; lastMs: number; pauseUntil: number }
/* Scroll offset `elapsed` ms after the last reset, following the firmware's advanceScroll exactly:
 * pause, then travel at `speed` px/s with a 1/1000 px accumulator, and no drift at leg boundaries. */
export function scrollOffset(scroll: Scroll, viewport: number, speed: number, textWidth: number, elapsed: number): number {
  const pause = scroll.pause ?? 1000, loop = scroll.mode === 'loop', gap = loop ? scroll.gap ?? 24 : 0;
  const target = loop ? textWidth + gap : textWidth - viewport;
  if (textWidth <= viewport || target <= 0 || speed <= 0) return 0;
  const s: ScrollState = { offset: 0, direction: -1, phase: 0, lastMs: 0, pauseUntil: pause };
  const now = Math.max(0, Math.floor(elapsed));
  for (;;) {
    if (!(now > s.pauseUntil)) return s.offset;
    const base = s.lastMs > s.pauseUntil ? s.lastMs : s.pauseUntil;
    const ticks = (now - base) * speed + s.phase;
    const progress = loop ? s.offset : s.direction < 0 ? s.offset : target - s.offset;
    const needed = (target - progress) * 1000;
    if (ticks < needed) {
      const next = progress * 1000 + ticks, pixels = Math.floor(next / 1000);
      s.phase = next % 1000;
      s.offset = loop ? pixels : s.direction < 0 ? pixels : target - pixels;
      s.lastMs = now;
      return s.offset;
    }
    const ms = Math.ceil((needed - s.phase) / speed), completion = base + ms;
    s.phase = ms * speed + s.phase - needed;
    s.lastMs = completion;
    s.pauseUntil = completion + pause;
    if (loop) s.offset = 0;
    else if (s.direction < 0) { s.offset = target; s.direction = 1; }
    else { s.offset = 0; s.direction = -1; }
  }
}
/* Maps a viewport column to a column of the full text, or null in the loop gap. */
export function scrollColumn(scroll: Scroll | undefined, offset: number, textWidth: number, local: number): number | null {
  if (!scroll) return local;
  if (scroll.mode === 'loop') {
    const cycle = textWidth + (scroll.gap ?? 24);
    if (cycle <= 0) return null;
    const x = (local + offset) % cycle;
    return x < textWidth ? x : null;
  }
  const x = local + offset;
  return x < textWidth ? x : null;
}
