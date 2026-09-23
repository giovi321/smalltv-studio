/* SmallTV V1 model, package codec and RGB565 renderer. No DOM dependencies.
 * Keep compatibility covered by tests against the firmware's package format.
 */
import { applicable, isColorTarget, MAX_BINDINGS, MAX_STOPS, resolveLayer, scrollColumn, scrollOffset, targetRange, textPixelWidth } from './dynamic';
import { font } from './font';
import type { Anchor, Asset, Assets, Layer, NumericTarget, Rect, Theme } from './types';

const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
export const MAX_PACKAGE = 3 * 1024 * 1024, MAX_ENTRIES = 256, MAX_MANIFEST = 16384;
export const anchors: readonly Anchor[] = ['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'];
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const tokens = ['HH', 'hh', 'MM', 'SS', 'DD', 'MON', 'MONTH', 'WD', 'WEEKDAY', 'YYYY'] as const;

export const idOK = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(s);
export const pathOK = (s: unknown): s is string =>
  typeof s === 'string' && s.length > 0 && s.length <= 120 && /^[A-Za-z0-9_./-]+$/.test(s) && s.split('/').every(p => p && p !== '.' && p !== '..');
const rgb565 = (r: number, g: number, b: number) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
const color = (s: string) => { const n = parseInt(s.slice(1), 16); return rgb565(n >> 16, (n >> 8) & 255, n & 255); };
export const bytesOf = (s: string) => encoder.encode(s).length;

// Manifest sources are logical source paths (for example images/logo.png).
// The editor stores compiled STI entries separately. Accepting a pasted STI
// suffix here makes imports resilient to manifests copied from package tools
// without ever producing the accidental `.sti.sti` path.
const logicalSource = (s: string) => (s.endsWith('.sti') ? s.slice(0, -4) : s);
export function pathFor(l: { type: string; source: string }, frame = 0): string {
  const source = logicalSource(l.source);
  return l.type === 'image' ? source + '.sti' : source + '/' + String(frame).padStart(3, '0') + '.png.sti';
}
/* Every compiled path a layer needs, in package order. */
export function framePaths(l: Layer): string[] {
  if (l.type !== 'image' && l.type !== 'animation') return [];
  const count = l.type === 'image' ? 1 : Math.min(240, Math.max(0, l.frames || 0));
  return Array.from({ length: count }, (_, i) => pathFor(l, i));
}

/* `source.field` names a theme declares, in declaration order. */
export function dataFields(theme: Pick<Theme, 'data'>): string[] {
  return Array.isArray(theme.data) ? theme.data.flatMap(s => (Array.isArray(s?.fields) ? s.fields.map(f => s.id + '.' + f?.id) : [])) : [];
}

function validText(s: unknown, fields: readonly string[]): boolean {
  if (typeof s !== 'string' || /[^\x20-\x7e]/.test(s)) return false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '}') return false;
    if (s[i] !== '{') continue;
    const end = s.indexOf('}', i); if (end < 0) return false;
    const token = s.slice(i + 1, end), bits = token.split('.');
    const dynamic = bits.length === 2 && bits.every(id => /^[A-Za-z0-9_-]+$/.test(id));
    if (!(tokens as readonly string[]).includes(token) && !(dynamic && fields.includes(token))) return false;
    i = end;
  }
  return true;
}

/* Returns every problem as "path: reason". The manifest arrives as untrusted JSON, so it is read loosely. */
type Loose = Record<string, any>;
export function validate(theme: unknown, assets: Assets | null = null): string[] {
  const errors: string[] = [], fail = (p: string, why: string) => { errors.push(p + ': ' + why); };
  const object = (o: unknown, p: string, allowed: string[]): o is Loose => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) { fail(p, 'expected an object'); return false; }
    for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(p + '.' + k, 'unknown field');
    return true;
  };
  const string = (o: Loose, k: string, p: string, max: number, optional = false) => {
    const v = o[k]; if (v == null && optional) return;
    if (typeof v !== 'string' || bytesOf(v) < 1 || bytesOf(v) > max || /[\x00-\x1f\x7f]/.test(v)) fail(p + '.' + k, 'expected 1–' + max + ' bytes without control characters');
  };
  const number = (o: Loose, k: string, p: string, min: number, max: number, optional = false) => {
    if (o[k] == null && optional) return;
    if (!Number.isInteger(o[k]) || o[k] < min || o[k] > max) fail(p + '.' + k, 'expected an integer from ' + min + ' to ' + max);
  };
  const checkColor = (o: Loose, k: string, p: string) => { if (typeof o[k] !== 'string' || !/^#[0-9a-f]{6}$/i.test(o[k])) fail(p + '.' + k, 'expected #RRGGBB'); };

  if (!object(theme, 'theme.json', ['spec', 'theme', 'display', 'layers', 'data'])) return errors;
  if (bytesOf(JSON.stringify(theme)) > MAX_MANIFEST) fail('theme.json', 'exceeds 16 KiB');
  if (depth(theme) > 8) fail('theme.json', 'exceeds 8 levels of nesting');
  if (theme.spec !== 1) fail('spec', 'expected 1');
  if (object(theme.theme, 'theme', ['id', 'name', 'author', 'version'])) {
    for (const [k, max] of [['id', 48], ['name', 96], ['author', 96], ['version', 32]] as const) string(theme.theme, k, 'theme', max);
    if (!idOK(theme.theme.id)) fail('theme.id', 'use letters, digits, - or _');
  }
  if (object(theme.display, 'display', ['width', 'height', 'background'])) {
    number(theme.display, 'width', 'display', 240, 240); number(theme.display, 'height', 'display', 240, 240); checkColor(theme.display, 'background', 'display');
  }
  const fields: string[] = [];
  if (theme.data != null) {
    if (!Array.isArray(theme.data) || theme.data.length > 4) fail('data', 'expected an array with at most 4 sources');
    const sourceIds = new Set<unknown>();
    (Array.isArray(theme.data) ? theme.data : []).forEach((source: unknown, i: number) => {
      const p = 'data[' + i + ']';
      if (source && typeof source === 'object' && 'id' in source) {
        if (sourceIds.has(source.id)) fail(p + '.id', 'duplicate data source ID');
        sourceIds.add(source.id);
      }
      if (!object(source, p, ['id', 'url', 'interval', 'insecureTls', 'fields'])) return;
      string(source, 'id', p, 32); string(source, 'url', p, 200); number(source, 'interval', p, 10, 86400);
      if (!idOK(source.id) || source.id.includes('.')) fail(p + '.id', 'use letters, digits, - or _');
      if (source.insecureTls != null && typeof source.insecureTls !== 'boolean') fail(p + '.insecureTls', 'expected true or false');
      if (typeof source.url === 'string') {
        if (!/^https?:\/\/[^/?#]/.test(source.url)) fail(p + '.url', 'expected an http:// or https:// URL that includes a host');
        else if (/^https:/.test(source.url) && source.insecureTls !== true) fail(p + '.insecureTls', 'set to true: HTTPS certificates cannot be verified on the device');
      }
      if (!Array.isArray(source.fields) || source.fields.length < 1 || source.fields.length > 8) { fail(p + '.fields', 'expected 1 to 8 fields'); return; }
      const ids = new Set<string>();
      source.fields.forEach((field: unknown, j: number) => {
        const fp = p + '.fields[' + j + ']';
        if (!object(field, fp, ['id', 'path'])) return;
        string(field, 'id', fp, 24); string(field, 'path', fp, 96);
        if (!idOK(field.id) || field.id.includes('.')) fail(fp + '.id', 'use letters, digits, - or _');
        if (ids.has(field.id)) fail(fp + '.id', 'duplicate field ID');
        ids.add(field.id);
        if (typeof field.path === 'string' && !/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(field.path)) fail(fp + '.path', 'use a dotted JSON object path');
        fields.push(source.id + '.' + field.id);
      });
    });
  }
  if (!Array.isArray(theme.layers) || theme.layers.length > 32) { fail('layers', 'expected an array with at most 32 layers'); return errors; }
  const ids = new Set<unknown>();
  theme.layers.forEach((l: unknown, i: number) => {
    const p = 'layers[' + i + ']';
    if (!l || typeof l !== 'object' || Array.isArray(l)) { fail(p, 'expected an object'); return; }
    const o = l as Loose;
    if (!idOK(o.id) || ids.has(o.id)) fail(p + '.id', 'expected a unique ID (letters, digits, - or _)');
    ids.add(o.id);
    number(o, 'x', p, -240, 479); number(o, 'y', p, -240, 479);
    const allowed = ['id', 'type', 'x', 'y', 'scroll', 'bind'];
    if (o.type === 'text') {
      allowed.push('anchor', 'value', 'size', 'color'); string(o, 'value', p, 128); number(o, 'size', p, 8, 96); checkColor(o, 'color', p);
      if (!validText(o.value, fields)) fail(p + '.value', 'use printable ASCII and supported clock variables');
      if (o.anchor != null && !anchors.includes(o.anchor)) fail(p + '.anchor', 'unsupported anchor');
    } else if (o.type === 'image' || o.type === 'animation') {
      allowed.push('source'); string(o, 'source', p, 110);
      if (!pathOK(o.source)) fail(p + '.source', 'expected a safe relative path');
      if (o.type === 'animation') {
        allowed.push('width', 'height', 'frames', 'fps', 'loop');
        number(o, 'width', p, 1, 240); number(o, 'height', p, 1, 240); number(o, 'frames', p, 1, 240); number(o, 'fps', p, 1, 15);
        if (typeof o.loop !== 'boolean') fail(p + '.loop', 'expected true or false');
      }
      if (typeof o.source === 'string' && pathFor(o as Layer & { source: string }).length > 120) fail(p + '.source', 'compiled path exceeds 120 bytes');
      if (assets && typeof o.source === 'string') {
        const count = o.type === 'image' ? 1 : Math.min(240, Math.max(0, o.frames || 0));
        for (let f = 0; f < count; f++) {
          const path = pathFor(o as Layer & { source: string }, f), asset = assets.get(path);
          if (!asset) { fail(p + '.source', 'missing ' + path + '; import the asset before exporting'); break; }
          if (o.type === 'animation' && (asset.width !== o.width || asset.height !== o.height)) { fail(p + '.source', 'frame dimensions do not match width/height'); break; }
        }
      }
    } else if (o.type === 'shape') {
      allowed.push('shape', 'stroke', 'strokeWidth'); number(o, 'strokeWidth', p, 1, 32, true);
      if (o.shape === 'rectangle') {
        allowed.push('width', 'height', 'fill', 'cornerRadius'); number(o, 'width', p, 1, 240); number(o, 'height', p, 1, 240); number(o, 'cornerRadius', p, 0, 120, true);
      }
      else if (o.shape === 'circle') { allowed.push('radius', 'fill'); number(o, 'radius', p, 1, 240); }
      else if (o.shape === 'line') { allowed.push('x2', 'y2'); number(o, 'x2', p, -240, 479); number(o, 'y2', p, -240, 479); }
      else fail(p + '.shape', 'expected rectangle, circle or line');
      if (o.fill == null && o.stroke == null) fail(p, 'provide fill or stroke');
      if (o.fill != null) checkColor(o, 'fill', p);
      if (o.stroke != null) checkColor(o, 'stroke', p);
      if (o.shape === 'line' && o.stroke == null) fail(p + '.stroke', 'required for a line');
    } else fail(p + '.type', 'expected text, image, animation or shape');
    object(o, p, allowed);
    if (o.scroll !== undefined) {
      if (o.type !== 'text') fail(p + '.scroll', 'only allowed on text layers');
      else if (object(o.scroll, p + '.scroll', ['width', 'mode', 'speed', 'pause', 'gap'])) {
        const sp = p + '.scroll';
        number(o.scroll, 'width', sp, 1, 240); number(o.scroll, 'speed', sp, 1, 240);
        number(o.scroll, 'pause', sp, 0, 10000, true); number(o.scroll, 'gap', sp, 0, 240, true);
        if (o.scroll.mode !== 'loop' && o.scroll.mode !== 'bounce') fail(sp + '.mode', 'expected loop or bounce');
        else if (o.scroll.mode === 'bounce' && o.scroll.gap !== undefined) fail(sp + '.gap', 'not allowed in bounce mode');
      }
    }
    if (o.bind !== undefined) validateBindings(o, p, fields, fail, object, checkColor);
  });
  return errors;
}

function depth(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  return 1 + Math.max(0, ...Object.values(value).map(depth));
}
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function validateBindings(o: Loose, p: string, fields: string[], fail: (p: string, why: string) => void,
  object: (o: unknown, p: string, allowed: string[]) => o is Loose, checkColor: (o: Loose, k: string, p: string) => void) {
  const bp = p + '.bind';
  if (!o.bind || typeof o.bind !== 'object' || Array.isArray(o.bind)) { fail(bp, 'expected an object'); return; }
  const entries = Object.entries(o.bind as Loose);
  if (entries.length > MAX_BINDINGS) fail(bp, 'expected at most ' + MAX_BINDINGS + ' bindings');
  for (const [target, b] of entries) {
    const tp = bp + '.' + target, color = isColorTarget(target);
    if (!color && !(target in targetRange)) { fail(tp, 'unknown binding target'); continue; }
    if (!applicable(o as Layer, target as NumericTarget)) { fail(tp, 'binding is not applicable to this layer'); continue; }
    if (!object(b, tp, color ? ['source', 'stops'] : ['source', 'input', 'output', 'clamp'])) continue;
    if (typeof b.source !== 'string' || !fields.includes(b.source)) fail(tp + '.source', 'expected a declared data field');
    if (color) {
      if (!Array.isArray(b.stops) || b.stops.length < 1 || b.stops.length > MAX_STOPS) { fail(tp + '.stops', 'expected 1 to ' + MAX_STOPS + ' stops'); continue; }
      b.stops.forEach((stop: unknown, i: number) => {
        const sp = tp + '.stops[' + i + ']';
        if (!object(stop, sp, ['at', 'value'])) return;
        if (!isNumber(stop.at)) fail(sp + '.at', 'expected a finite number');
        else if (i && isNumber(b.stops[i - 1]?.at) && stop.at <= b.stops[i - 1].at) fail(sp + '.at', 'stops must be strictly increasing');
        checkColor(stop, 'value', sp);
      });
      continue;
    }
    const [lo, hi] = targetRange[target as NumericTarget];
    if (!Array.isArray(b.input) || b.input.length !== 2 || !b.input.every(isNumber)) fail(tp + '.input', 'expected exactly two finite numbers');
    else if (b.input[0] === b.input[1]) fail(tp + '.input', 'endpoints must differ');
    if (!Array.isArray(b.output) || b.output.length !== 2 || !b.output.every((n: unknown) => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi))
      fail(tp + '.output', 'expected exactly two integers from ' + lo + ' to ' + hi);
    if (b.clamp !== undefined && typeof b.clamp !== 'boolean') fail(tp + '.clamp', 'expected true or false');
  }
}

/* ---------- STI images ---------- */
const view = (input: ArrayBuffer | ArrayBufferView) => {
  const bytes = ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
  return { bytes, v: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
};
const magic = (bytes: Uint8Array) => String.fromCharCode(...bytes.subarray(0, 4));

export function decodeImage(input: ArrayBuffer | ArrayBufferView): Asset {
  const { bytes, v } = view(input);
  if (bytes.length < 12 || magic(bytes) !== 'STI1') throw Error('Invalid STI image');
  const width = v.getUint16(4, true), height = v.getUint16(6, true), stride = bytes[8] ? 3 : 2;
  if (width < 1 || width > 240 || height < 1 || height > 240 || bytes[8] > 1 || bytes[9] || bytes[10] || bytes[11] || bytes.length !== 12 + width * height * stride) throw Error('Invalid STI image dimensions or length');
  const colors = new Uint16Array(width * height), alpha = new Uint8Array(width * height);
  for (let i = 0; i < colors.length; i++) { colors[i] = v.getUint16(12 + i * stride, true); alpha[i] = stride === 3 ? bytes[14 + i * stride] : 255; }
  return { width, height, colors, alpha };
}
const sideOK = (n: number) => Number.isInteger(n) && n >= 1 && n <= 240;
export function fromRGBA(width: number, height: number, pixels: ArrayLike<number>): Asset {
  if (!sideOK(width) || !sideOK(height) || pixels.length !== width * height * 4) throw Error('Images must be 1–240 pixels per side');
  const colors = new Uint16Array(width * height), alpha = new Uint8Array(width * height);
  for (let i = 0; i < colors.length; i++) { colors[i] = rgb565(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]); alpha[i] = pixels[i * 4 + 3]; }
  return { width, height, colors, alpha };
}
/* Nearest-neighbour resample. */
export function resizeAsset(asset: Asset, width: number, height: number): Asset {
  if (!asset || !sideOK(width) || !sideOK(height)) throw Error('Image dimensions must be 1–240 pixels');
  const colors = new Uint16Array(width * height), alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.min(asset.width - 1, Math.floor(x * asset.width / width)), sy = Math.min(asset.height - 1, Math.floor(y * asset.height / height));
    const from = sy * asset.width + sx, to = y * width + x;
    colors[to] = asset.colors[from]; alpha[to] = asset.alpha[from];
  }
  return { width, height, colors, alpha };
}
export function encodeImage(asset: Asset): Uint8Array<ArrayBuffer> {
  const { width, height, colors, alpha } = asset;
  if (!sideOK(width) || !sideOK(height) || colors.length !== width * height || alpha.length !== width * height) throw Error('Invalid image asset');
  const transparent = alpha.some(a => a !== 255), stride = transparent ? 3 : 2, bytes = new Uint8Array(12 + width * height * stride), v = new DataView(bytes.buffer);
  bytes.set(encoder.encode('STI1')); v.setUint16(4, width, true); v.setUint16(6, height, true); bytes[8] = transparent ? 1 : 0;
  for (let i = 0; i < colors.length; i++) { v.setUint16(12 + i * stride, colors[i], true); if (transparent) bytes[14 + i * stride] = alpha[i]; }
  return bytes;
}
/* RGBA pixels for drawing an asset on a canvas. */
export function assetRGBA(asset: Asset): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(asset.width * asset.height * 4);
  for (let i = 0; i < asset.colors.length; i++) {
    const c = asset.colors[i];
    out[i * 4] = Math.floor((c >> 11) * 255 / 31); out[i * 4 + 1] = Math.floor(((c >> 5) & 63) * 255 / 63); out[i * 4 + 2] = Math.floor((c & 31) * 255 / 31); out[i * 4 + 3] = asset.alpha[i];
  }
  return out;
}

/* ---------- .stheme packages ---------- */
export function unpack(input: ArrayBuffer | ArrayBufferView): { theme: Theme; assets: Assets } {
  const { bytes, v } = view(input);
  if (bytes.length < 8 || bytes.length > MAX_PACKAGE || magic(bytes) !== 'STH1' || v.getUint16(6, true)) throw Error('Invalid .stheme package');
  const count = v.getUint16(4, true);
  if (!count || count > MAX_ENTRIES) throw Error('Invalid package entry count');
  let offset = 8, theme: unknown;
  const seen = new Set<string>(), assets: Assets = new Map();
  for (let i = 0; i < count; i++) {
    if (offset + 6 > bytes.length) throw Error('Truncated package entry');
    const nameLength = v.getUint16(offset, true), size = v.getUint32(offset + 2, true); offset += 6;
    if (!nameLength || nameLength > 120 || offset + nameLength + size > bytes.length) throw Error('Truncated package payload');
    const name = decoder.decode(bytes.subarray(offset, offset + nameLength)); offset += nameLength;
    if (!pathOK(name) || seen.has(name)) throw Error('Unsafe or duplicate package path');
    seen.add(name);
    const payload = bytes.subarray(offset, offset + size); offset += size;
    if (name === 'theme.json') {
      if (size > MAX_MANIFEST) throw Error('Manifest exceeds 16 KiB');
      theme = JSON.parse(decoder.decode(payload));
    } else {
      if (!name.endsWith('.sti')) throw Error('Unsupported package entry: ' + name);
      assets.set(name, decodeImage(payload));
    }
  }
  if (offset !== bytes.length) throw Error('Trailing package bytes');
  const errors = validate(theme, assets);
  if (errors.length) throw Error(errors.join('\n'));
  return { theme: theme as Theme, assets };
}
export function pack(theme: Theme, assets: Assets): Uint8Array<ArrayBuffer> {
  const errors = validate(theme, assets);
  if (errors.length) throw Error(errors.join('\n'));
  const entries = new Map<string, Uint8Array<ArrayBuffer>>([['theme.json', encoder.encode(JSON.stringify(theme))]]);
  for (const l of theme.layers) for (const name of framePaths(l)) if (!entries.has(name)) entries.set(name, encodeImage(assets.get(name)!));
  if (entries.size > MAX_ENTRIES) throw Error('Package exceeds 256 entries');
  let size = 8;
  for (const [name, data] of entries) size += 6 + bytesOf(name) + data.length;
  if (size > MAX_PACKAGE) throw Error('Package exceeds 3 MiB');
  const bytes = new Uint8Array(size), v = new DataView(bytes.buffer);
  bytes.set(encoder.encode('STH1')); v.setUint16(4, entries.size, true);
  let offset = 8;
  for (const [name, data] of entries) {
    const path = encoder.encode(name);
    v.setUint16(offset, path.length, true); v.setUint32(offset + 2, data.length, true); offset += 6;
    bytes.set(path, offset); offset += path.length; bytes.set(data, offset); offset += data.length;
  }
  return bytes;
}

/* ---------- text and geometry ---------- */
export type Sample = Record<string, string>;
/* Expands clock and data variables. The device clock runs in local time, which the preview models as UTC. */
export function expand(value: string, time: Date, data: Sample = {}): string {
  const pad = (n: number) => String(n).padStart(2, '0'), h = time.getUTCHours(), month = months[time.getUTCMonth()], day = days[time.getUTCDay()];
  const values: Record<string, string> = {
    HH: pad(h), hh: pad(h % 12 || 12), MM: pad(time.getUTCMinutes()), SS: pad(time.getUTCSeconds()), DD: pad(time.getUTCDate()),
    MON: month.slice(0, 3), MONTH: month, WD: day.slice(0, 3), WEEKDAY: day, YYYY: String(time.getUTCFullYear()).padStart(4, '0'),
  };
  return value.replace(/\{([^}]+)\}/g, (_, key: string) => values[key] ?? data[key] ?? '--');
}
export const cellWidth = (size: number) => Math.ceil(size * 6 / 8);
/* Screen rectangle of a layer after bindings. A scrolling text layer occupies its viewport. */
export function bounds(l: Layer, assets: Assets, time: Date, data?: Sample): Rect {
  const r = resolveLayer(l, data);
  if (l.type === 'text') {
    const w = l.scroll ? r.scrollWidth : textPixelWidth(r.size, expand(l.value, time, data).length), a = anchors.indexOf(l.anchor ?? 'top-left');
    return { x: r.x - Math.trunc(w * (a % 3) / 2), y: r.y - Math.trunc(r.size * Math.floor(a / 3) / 2), w, h: r.size };
  }
  if (l.type === 'shape' && l.shape === 'circle') return r.radius === 0 ? { x: r.x, y: r.y, w: 0, h: 0 } : { x: r.x - r.radius, y: r.y - r.radius, w: r.radius * 2 + 1, h: r.radius * 2 + 1 };
  if (l.type === 'shape' && l.shape === 'line') {
    const pad = Math.floor((r.strokeWidth + 1) / 2);
    return { x: Math.min(r.x, r.x2) - pad, y: Math.min(r.y, r.y2) - pad, w: Math.abs(r.x - r.x2) + 2 * pad + 1, h: Math.abs(r.y - r.y2) + 2 * pad + 1 };
  }
  if (l.type === 'image') { const asset = assets.get(pathFor(l)); return { x: r.x, y: r.y, w: asset?.width ?? 0, h: asset?.height ?? 0 }; }
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

/* ---------- renderer (mirrors the firmware pixel for pixel) ---------- */
function blend(bg: number, fg: number, a: number) {
  if (a === 255) return fg;
  if (a === 0) return bg;
  const b = 255 - a;
  return (Math.floor(((fg >> 11) * a + (bg >> 11) * b + 127) / 255) << 11) | (Math.floor((((fg >> 5) & 63) * a + ((bg >> 5) & 63) * b + 127) / 255) << 5) | Math.floor(((fg & 31) * a + (bg & 31) * b + 127) / 255);
}
export function animationFrame(l: { fps: number; frames: number; loop: boolean }, elapsed: number) {
  const n = Math.floor(elapsed * l.fps / 1000);
  return l.loop ? n % l.frames : Math.min(l.frames - 1, n);
}
/* The device restarts scrolling whenever the expanded text changes, for example when {SS} ticks.
 * Returns the elapsed time at which the current text appeared (0 when it never changed). */
function textSince(value: string, time: Date, elapsed: number, data?: Sample) {
  const now = time.getTime(), text = expand(value, time, data);
  let start = Math.floor(elapsed) - (((now % 1000) + 1000) % 1000);
  while (start > 0 && expand(value, new Date(now - (Math.floor(elapsed) - start) - 1), data) === text) start -= 1000;
  return Math.max(0, start);
}
/* Rounded rectangle: fill covers the rounded outline, stroke the ring down to radius - strokeWidth. */
function rectangleHit(x: number, y: number, rx: number, ry: number, rw: number, rh: number, radius: number, sw: number) {
  const straight = () => ({ inside: true, edge: x - rx < sw || rx + rw - x <= sw || y - ry < sw || ry + rh - y <= sw });
  if (radius <= 0) return straight();
  const left = x < rx + radius, right = x >= rx + rw - radius, top = y < ry + radius, bottom = y >= ry + rh - radius;
  if (!((left || right) && (top || bottom))) return straight();
  const cx = left ? rx + radius : rx + rw - radius - 1, cy = top ? ry + radius : ry + rh - radius - 1;
  const dist = (x - cx) ** 2 + (y - cy) ** 2, inside = dist <= radius * radius, inner = Math.max(0, radius - sw);
  return { inside, edge: inside && (inner === 0 || dist > inner * inner) };
}
export function render(theme: Theme, assets: Assets, time: Date, elapsed = 0, data?: Sample): Uint8ClampedArray<ArrayBuffer> {
  const errors = validate(theme, null);
  if (errors.length) throw Error(errors[0]);
  const output = new Uint16Array(240 * 240);
  output.fill(color(theme.display.background));
  for (const l of theme.layers) {
    const r = bounds(l, assets, time, data), x1 = Math.max(0, r.x), y1 = Math.max(0, r.y), x2 = Math.min(240, r.x + r.w), y2 = Math.min(240, r.y + r.h);
    if (x1 >= x2 || y1 >= y2) continue;
    const v = resolveLayer(l, data);
    if (l.type === 'image' || l.type === 'animation') {
      const asset = assets.get(pathFor(l, l.type === 'animation' ? animationFrame(l, elapsed) : 0));
      if (!asset) continue;
      for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) {
        const i = (y - v.y) * asset.width + x - v.x, at = y * 240 + x;
        if (i >= 0 && i < asset.colors.length) output[at] = blend(output[at], asset.colors[i], asset.alpha[i]);
      }
      continue;
    }
    if (l.type === 'text') {
      const text = expand(l.value, time, data), cell = cellWidth(v.size), fg = color(v.color!), width = textPixelWidth(v.size, text.length);
      const offset = l.scroll ? scrollOffset(l.scroll, v.scrollWidth, v.scrollSpeed, width, elapsed - textSince(l.value, time, elapsed, data)) : 0;
      for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) {
        const column = scrollColumn(l.scroll, offset, width, x - r.x);
        if (column == null) continue;
        const col = Math.floor((column % cell) * 6 / cell), row = Math.floor((y - r.y) * 8 / v.size);
        if (col < 5 && (font[text.charCodeAt(Math.floor(column / cell)) * 5 + col] & (1 << row))) output[y * 240 + x] = fg;
      }
      continue;
    }
    const fill = v.fill ? color(v.fill) : 0, stroke = v.stroke ? color(v.stroke) : 0, sw = v.strokeWidth;
    for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) {
      let inside = false, edge = false;
      if (l.shape === 'rectangle') ({ inside, edge } = rectangleHit(x, y, v.x, v.y, v.width, v.height, v.cornerRadius, sw));
      else if (l.shape === 'circle') {
        const dx = x - v.x, dy = y - v.y, dist = dx * dx + dy * dy, inner = Math.max(0, v.radius - sw);
        inside = dist <= v.radius * v.radius; edge = inside && (inner === 0 || dist > inner * inner);
      } else {
        const dx = v.x2 - v.x, dy = v.y2 - v.y, px = x - v.x, py = y - v.y, len = dx * dx + dy * dy, dot = px * dx + py * dy;
        if (dot <= 0 || len === 0) inside = 4 * (px * px + py * py) <= sw * sw;
        else if (dot >= len) inside = 4 * ((x - v.x2) ** 2 + (y - v.y2) ** 2) <= sw * sw;
        else inside = 4 * (px * dy - py * dx) ** 2 <= sw * sw * len;
        edge = inside;
      }
      const at = y * 240 + x;
      if (inside && l.fill) output[at] = fill;
      if (edge && l.stroke) output[at] = stroke;
    }
  }
  const rgba = new Uint8ClampedArray(240 * 240 * 4);
  for (let i = 0; i < output.length; i++) {
    const c = output[i];
    rgba[i * 4] = Math.floor((c >> 11) * 255 / 31); rgba[i * 4 + 1] = Math.floor(((c >> 5) & 63) * 255 / 63); rgba[i * 4 + 2] = Math.floor((c & 31) * 255 / 31); rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
