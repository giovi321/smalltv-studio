/* Editor state, undo history and layer/data actions.
 * State is immutable: every edit works on a cloned draft, so React re-renders from plain snapshots.
 */
import { create } from 'zustand';
import * as C from '../core/core';
import { applicable } from '../core/dynamic';
import type { Sample } from '../core/core';
import type { Asset, Assets, BindTarget, Binding, DataSource, Layer, LayerType, Project, Rect, Theme } from '../core/types';

export const MAX_LAYERS = 32, MAX_SOURCES = 4, MAX_FIELDS = 8, MAX_ELAPSED = 60000;
const HISTORY = 100, MERGE_MS = 700;
export const labels: Record<LayerType, string> = { text: 'Text', image: 'Image', animation: 'Animation', shape: 'Shape' };
export type Tab = 'layers' | 'theme' | 'data';

interface Snapshot { theme: Theme; assets: Assets; selected: number }
export interface Draft { theme: Theme; assets: Assets; selected: number; sample: Sample }

export interface StudioState {
  theme: Theme;
  assets: Assets;
  selected: number;
  dirty: boolean;
  busy: boolean;
  hidden: ReadonlySet<string>;   // editor-only view flags, never exported
  locked: ReadonlySet<string>;
  sample: Sample;                // "source.field" -> preview-only value
  problems: string[];
  packed: Uint8Array<ArrayBuffer> | null;
  history: Snapshot[];
  future: Snapshot[];
  playing: boolean;
  elapsed: number;
  baseTime: number;
  snap: boolean;
  grid: boolean;
  tab: Tab;
  notice: { message: string; error: boolean; serial: number };
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function analyze(theme: Theme, assets: Assets) {
  const problems = C.validate(theme, assets);
  let packed: Uint8Array<ArrayBuffer> | null = null;
  if (!problems.length) {
    try { packed = C.pack(theme, assets); } catch (error) { problems.push((error as Error).message); }
  }
  return { problems, packed };
}
export function blankProject(): Project {
  return {
    theme: {
      spec: 1, theme: { id: 'my-theme', name: 'My theme', author: 'You', version: '1.0.0' }, display: { width: 240, height: 240, background: '#111827' },
      layers: [
        { id: 'clock', type: 'text', x: 120, y: 100, anchor: 'center', value: '{HH}:{MM}', size: 48, color: '#ffffff' },
        { id: 'date', type: 'text', x: 120, y: 150, anchor: 'center', value: '{WD} {DD} {MON}', size: 16, color: '#aab7ca' },
      ],
    },
    assets: new Map(),
  };
}
function localNow() {
  const text = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  return Date.parse(text + 'Z');
}

const initial = blankProject();
export const useStudio = create<StudioState>()(() => ({
  theme: initial.theme, assets: initial.assets, selected: 0, dirty: false, busy: false,
  hidden: new Set(), locked: new Set(), sample: {},
  ...analyze(initial.theme, initial.assets),
  history: [], future: [],
  playing: true, elapsed: 0, baseTime: localNow(), snap: true, grid: false, tab: 'layers',
  notice: { message: 'Nothing is ever uploaded. Files stay in your browser.', error: false, serial: 0 },
}));
const get = useStudio.getState, set = useStudio.setState;

/* ---------- derived helpers ---------- */
export const selectedLayer = (s: StudioState = get()): Layer | null => s.theme.layers[s.selected] ?? null;
export const previewTime = (s: Pick<StudioState, 'baseTime' | 'elapsed'> = get()) => new Date(s.baseTime + Math.floor(s.elapsed));
export const layerBounds = (l: Layer, s: StudioState = get()): Rect => C.bounds(l, s.assets, previewTime(s), s.sample);
export const sources = (s: StudioState = get()): DataSource[] => s.theme.data ?? [];
export const isHidden = (l: Layer, s: StudioState = get()) => s.hidden.has(l.id);
export const isLocked = (l: Layer, s: StudioState = get()) => s.locked.has(l.id);
export function referenced(theme: Theme): Set<string> {
  return new Set(theme.layers.flatMap(C.framePaths));
}
export function layerDimensions(l: Layer, assets: Assets = get().assets): { width: number; height: number } {
  if (l.type === 'image') { const a = assets.get(C.pathFor(l)); return a ? { width: a.width, height: a.height } : { width: 1, height: 1 }; }
  if (l.type === 'animation' || (l.type === 'shape' && l.shape === 'rectangle')) return { width: l.width ?? 1, height: l.height ?? 1 };
  return { width: 0, height: 0 };
}
export function renderFrame(s: StudioState = get()) {
  const theme = { ...s.theme, layers: s.theme.layers.filter(l => !s.hidden.has(l.id)) };
  return C.render(theme, s.assets, previewTime(s), Math.floor(s.elapsed), s.sample);
}
export function budget(theme: Theme, packed: Uint8Array | null) {
  return {
    manifest: C.bytesOf(JSON.stringify(theme)), manifestMax: C.MAX_MANIFEST,
    layers: theme.layers.length, layersMax: MAX_LAYERS,
    entries: new Set(['theme.json', ...referenced(theme)]).size, entriesMax: C.MAX_ENTRIES,
    sources: theme.data?.length ?? 0, sourcesMax: MAX_SOURCES,
    packageBytes: packed ? packed.length : null, packageMax: C.MAX_PACKAGE,
  };
}

/* ---------- feedback ---------- */
let serial = 0;
export function notify(message: string, error = false) { set({ notice: { message, error, serial: ++serial } }); }

/* ---------- history ---------- */
let mergeKey = '', mergeAt = 0;
const snapshot = (s: StudioState = get()): Snapshot => ({ theme: s.theme, assets: s.assets, selected: s.selected });
const capped = (list: Snapshot[], item: Snapshot) => [...list, item].slice(-HISTORY);
function pruneFlags(theme: Theme, flags: ReadonlySet<string>) {
  const ids = new Set(theme.layers.map(l => l.id));
  return [...flags].every(id => ids.has(id)) ? flags : new Set([...flags].filter(id => ids.has(id)));
}
/* Applies `fn` to a draft. Edits sharing a `key` within 700 ms (typing, nudging) form one undo step. */
export function edit(fn: (d: Draft) => void, key = '') {
  const s = get(), now = performance.now();
  const merge = !!key && mergeKey === key && now - mergeAt <= MERGE_MS;
  mergeKey = key; mergeAt = now;
  const d: Draft = { theme: clone(s.theme), assets: new Map(s.assets), selected: s.selected, sample: { ...s.sample } };
  fn(d);
  const used = referenced(d.theme);
  for (const path of [...d.assets.keys()]) if (!used.has(path)) d.assets.delete(path);
  set({
    ...d, dirty: true,
    hidden: pruneFlags(d.theme, s.hidden), locked: pruneFlags(d.theme, s.locked),
    history: merge ? s.history : capped(s.history, snapshot(s)), future: merge ? s.future : [],
    ...analyze(d.theme, d.assets),
  });
}
function restore(to: Snapshot, history: Snapshot[], future: Snapshot[]) {
  const s = get(), theme = clone(to.theme);
  mergeKey = '';
  set({ theme, assets: to.assets, selected: to.selected, history, future, dirty: true, hidden: pruneFlags(theme, s.hidden), locked: pruneFlags(theme, s.locked), ...analyze(theme, to.assets) });
}
export function undo() {
  const s = get(); if (!s.history.length) return;
  restore(s.history[s.history.length - 1], s.history.slice(0, -1), [...s.future, snapshot(s)]);
  notify('Change undone.');
}
export function redo() {
  const s = get(); if (!s.future.length) return;
  restore(s.future[s.future.length - 1], [...s.history, snapshot(s)], s.future.slice(0, -1));
  notify('Change redone.');
}

/* ---------- live dragging (no history until the drag ends) ---------- */
export interface DragSession { before: Snapshot }
export function beginDrag(): DragSession { return { before: snapshot() }; }
/* Recomputes the dragged state from the pre-drag snapshot, so rounding never accumulates. Returns whether anything changed. */
export function dragTo(session: DragSession, fn: (d: Draft) => void): boolean {
  const s = get(), d: Draft = { theme: clone(session.before.theme), assets: new Map(session.before.assets), selected: s.selected, sample: s.sample };
  fn(d);
  set({ theme: d.theme, assets: d.assets });
  return JSON.stringify(d.theme) !== JSON.stringify(session.before.theme) || d.assets.size !== session.before.assets.size || [...d.assets].some(([k, v]) => session.before.assets.get(k) !== v);
}
export function endDrag(session: DragSession, moved: boolean) {
  const s = get();
  mergeKey = '';
  if (moved) set({ dirty: true, history: capped(s.history, session.before), future: [], ...analyze(s.theme, s.assets) });
  else set({ theme: session.before.theme, assets: session.before.assets });
}

/* ---------- project lifecycle ---------- */
export function load(project: Project, message?: string) {
  const theme = project.theme;
  let selected = theme.layers.findIndex(l => l.type === 'text');
  if (selected < 0 && theme.layers.length) selected = 0;
  mergeKey = '';
  restartPlayback();
  set({
    theme, assets: project.assets, selected, dirty: false, history: [], future: [], hidden: new Set(), locked: new Set(), sample: {},
    elapsed: 0, playing: true, ...analyze(theme, project.assets),
  });
  if (message) notify(message);
}
export const markSaved = () => set({ dirty: false });
export const setBusy = (busy: boolean) => set({ busy });

/* ---------- layers ---------- */
function uniqueId(layers: Layer[], base: string) {
  let i = 1;
  while (layers.some(l => l.id === base + '-' + i)) i++;
  return base + '-' + i;
}
function defaults(type: LayerType, id: string): Layer {
  if (type === 'text') return { id, type, x: 120, y: 120, anchor: 'center', value: '{HH}:{MM}', size: 24, color: '#ffffff' };
  if (type === 'shape') return { id, type, shape: 'rectangle', x: 40, y: 40, width: 160, height: 50, fill: '#547875' };
  if (type === 'image') return { id, type, x: 0, y: 0, source: 'images/' + id + '.png' };
  return { id, type, x: 96, y: 160, width: 48, height: 48, source: 'animations/' + id, frames: 1, fps: 8, loop: true };
}
export function addLayer(type: LayerType): boolean {
  const s = get();
  if (s.busy || s.theme.layers.length >= MAX_LAYERS) return false;
  edit(d => { d.theme.layers.push(defaults(type, uniqueId(d.theme.layers, type))); d.selected = d.theme.layers.length - 1; });
  return true;
}
export function select(index: number) { mergeKey = ''; set({ selected: index }); }
export function removeLayer(index = get().selected) {
  if (index < 0 || index >= get().theme.layers.length) return;
  edit(d => {
    d.theme.layers.splice(index, 1);
    d.selected = Math.min(d.selected > index ? d.selected - 1 : d.selected, d.theme.layers.length - 1);
  });
}
export function duplicate(index = get().selected) {
  if (index < 0 || get().theme.layers.length >= MAX_LAYERS) return;
  edit(d => {
    const copy = clone(d.theme.layers[index]);
    copy.id = uniqueId(d.theme.layers, copy.type);
    copy.x = Math.min(479, copy.x + 8); copy.y = Math.min(479, copy.y + 8);
    if (copy.type === 'shape' && copy.x2 != null && copy.y2 != null) { copy.x2 = Math.min(479, copy.x2 + 8); copy.y2 = Math.min(479, copy.y2 + 8); }
    d.theme.layers.splice(index + 1, 0, copy); d.selected = index + 1;
  });
}
export function reorder(from: number, to: number) {
  const n = get().theme.layers.length;
  to = Math.max(0, Math.min(n - 1, to));
  if (from === to || from < 0 || from >= n) return;
  edit(d => { const [moved] = d.theme.layers.splice(from, 1); d.theme.layers.splice(to, 0, moved); d.selected = to; });
}
export const moveLayer = (delta: number) => reorder(get().selected, get().selected + delta);
export const toFront = () => reorder(get().selected, get().theme.layers.length - 1);
export const toBack = () => reorder(get().selected, 0);
/* Returns an error message, or '' on success. */
export function rename(index: number, id: string): string {
  const s = get(), l = s.theme.layers[index];
  if (!l || id === l.id) return '';
  if (!C.idOK(id)) return 'Use 1–48 letters, digits, - or _.';
  if (s.theme.layers.some((o, i) => i !== index && o.id === id)) return 'Another layer already uses this ID.';
  const carry = (flags: ReadonlySet<string>) => (flags.has(l.id) ? new Set([...flags].filter(f => f !== l.id).concat(id)) : flags);
  const hidden = carry(s.hidden), locked = carry(s.locked);
  edit(d => { d.theme.layers[index].id = id; });
  set({ hidden, locked });
  return '';
}
function toggleFlag(key: 'hidden' | 'locked', index: number) {
  const s = get(), l = s.theme.layers[index]; if (!l) return;
  const next = new Set(s[key]);
  if (!next.delete(l.id)) next.add(l.id);
  set({ [key]: next });
}
export const toggleHidden = (index: number) => toggleFlag('hidden', index);
export const toggleLocked = (index: number) => toggleFlag('locked', index);

/* Geometry shared by keyboard nudging, dragging and alignment. Keeps the layer inside the firmware's coordinate range. */
export function translate(l: Layer, dx: number, dy: number) {
  const line = l.type === 'shape' && l.shape === 'line', x2 = line ? l.x2 ?? l.x : l.x, y2 = line ? l.y2 ?? l.y : l.y;
  dx = Math.max(-240 - Math.min(l.x, x2), Math.min(479 - Math.max(l.x, x2), dx));
  dy = Math.max(-240 - Math.min(l.y, y2), Math.min(479 - Math.max(l.y, y2), dy));
  l.x += dx; l.y += dy;
  if (line) { l.x2 = x2 + dx; l.y2 = y2 + dy; }
}
export function nudge(dx: number, dy: number) {
  const l = selectedLayer(); if (!l) return;
  edit(d => translate(d.theme.layers[d.selected], dx, dy), 'nudge:' + l.id);
}
export type Edge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export function align(edge: Edge) {
  const l = selectedLayer(); if (!l) return;
  const r = layerBounds(l);
  const dx = edge === 'left' ? -r.x : edge === 'hcenter' ? Math.round((240 - r.w) / 2) - r.x : edge === 'right' ? 240 - r.w - r.x : 0;
  const dy = edge === 'top' ? -r.y : edge === 'vcenter' ? Math.round((240 - r.h) / 2) - r.y : edge === 'bottom' ? 240 - r.h - r.y : 0;
  edit(d => translate(d.theme.layers[d.selected], dx, dy));
}
/* Resamples every frame of an image or animation layer (nearest neighbour) from `from`. */
export function resizeLayer(d: Draft, l: Layer, width: number, height: number, from: Assets = d.assets) {
  if (l.type !== 'image' && l.type !== 'animation') return;
  width = Math.max(1, Math.min(240, Math.round(width))); height = Math.max(1, Math.min(240, Math.round(height)));
  for (const path of C.framePaths(l)) {
    const asset = from.get(path);
    if (asset) d.assets.set(path, C.resizeAsset(asset, width, height));
  }
  if (l.type === 'animation') { l.width = width; l.height = height; }
}
let assetSerial = 1;
/* A fresh logical source path, so replaced images never collide with the ones still in history. */
function assetRoot(l: Layer, assets: Assets) {
  let path: string;
  do path = (l.type === 'image' ? 'images/' : 'animations/') + (C.idOK(l.id) ? l.id : l.type) + '-' + assetSerial++;
  while (assets.has(path + '.png.sti') || assets.has(path + '/000.png.sti'));
  return path;
}
export function setLayerAssets(index: number, frames: Asset[]) {
  edit(d => {
    const l = d.theme.layers[index];
    if (l.type !== 'image' && l.type !== 'animation') return;
    const path = assetRoot(l, d.assets);
    l.source = l.type === 'image' ? path + '.png' : path;
    if (l.type === 'animation') Object.assign(l, { frames: frames.length, width: frames[0].width, height: frames[0].height });
    frames.forEach((asset, i) => d.assets.set(C.pathFor(l, i), asset));
  });
}

/* ---------- bindings ---------- */
/* Drops bindings a layer no longer supports, for example after its fill was removed or its shape changed. */
export function pruneBindings(l: Layer) {
  if (!l.bind) return;
  for (const target of Object.keys(l.bind) as BindTarget[]) if (!applicable(l, target)) delete l.bind[target];
  if (!Object.keys(l.bind).length) delete l.bind;
}
export function setBinding(index: number, target: BindTarget, binding: Binding | null, key = '') {
  edit(d => {
    const l = d.theme.layers[index];
    if (binding) l.bind = { ...l.bind, [target]: binding };
    else if (l.bind) { delete l.bind[target]; if (!Object.keys(l.bind).length) delete l.bind; }
  }, key);
}

/* ---------- data sources ---------- */
export function addSource() {
  const list = sources(); if (list.length >= MAX_SOURCES) return;
  let n = 1;
  while (list.some(s => s.id === 'source' + n)) n++;
  const created: DataSource = { id: 'source' + n, url: 'https://', interval: 300, insecureTls: true, fields: [{ id: 'value', path: 'value' }] };
  edit(d => { d.theme.data = [...(d.theme.data ?? []), created]; });
}
export function removeSource(i: number) {
  edit(d => { d.theme.data = (d.theme.data ?? []).filter((_, k) => k !== i); if (!d.theme.data.length) delete d.theme.data; });
}
export function addField(i: number) {
  const s = sources()[i]; if (!s || s.fields.length >= MAX_FIELDS) return;
  let n = 1;
  while (s.fields.some(f => f.id === 'field' + n)) n++;
  edit(d => { d.theme.data![i].fields.push({ id: 'field' + n, path: '' }); });
}
export function removeField(i: number, j: number) {
  const s = sources()[i]; if (!s || s.fields.length <= 1) return;
  edit(d => { d.theme.data![i].fields.splice(j, 1); });
}
/* Keeps text variables, bindings and preview values in step when a source or field ID changes. */
export function renameDataRef(d: Draft, from: string, to: string) {
  for (const l of d.theme.layers) {
    if (l.type === 'text') l.value = l.value.split('{' + from + '}').join('{' + to + '}');
    for (const b of Object.values(l.bind ?? {})) if (b.source === from) b.source = to;
  }
  if (from in d.sample) { d.sample[to] = d.sample[from]; delete d.sample[from]; }
}
export function setSample(key: string, value: string) {
  const sample = { ...get().sample };
  if (value) sample[key] = value; else delete sample[key];
  set({ sample });
}
/* Fills preview values from the live URL. Returns how many fields were found. */
export async function fetchSample(i: number): Promise<number> {
  const s = sources()[i]; if (!s) throw Error('Unknown data source.');
  const response = await fetch(s.url, { cache: 'no-store' });
  if (!response.ok) throw Error('The server answered ' + response.status + '.');
  const json: unknown = await response.json();
  const sample = { ...get().sample };
  let found = 0;
  for (const f of s.fields) {
    let v: unknown = json;
    for (const key of String(f.path).split('.')) v = v == null ? undefined : (v as Record<string, unknown>)[key];
    if (['string', 'number', 'boolean'].includes(typeof v)) { sample[s.id + '.' + f.id] = String(v); found++; }
  }
  set({ sample });
  return found;
}

/* ---------- view state ---------- */
export const setTab = (tab: Tab) => set({ tab });
export const toggleGrid = () => set(s => ({ grid: !s.grid }));
export const toggleSnap = () => set(s => ({ snap: !s.snap }));
export const setBaseTime = (baseTime: number) => set({ baseTime });

/* ---------- playback ---------- */
let started = 0;
function restartPlayback() { started = performance.now(); }
export function pause() { set({ playing: false }); }
export function play() {
  const elapsed = get().elapsed >= MAX_ELAPSED ? 0 : get().elapsed;
  started = performance.now() - elapsed;
  set({ playing: true, elapsed });
}
export const togglePlay = () => (get().playing ? pause() : play());
export function restart() { set({ elapsed: 0 }); play(); }
export function seek(elapsed: number) { set({ playing: false, elapsed }); }
/* Called from requestAnimationFrame; the preview runs at the firmware's 15 fps cap. */
export function tick(now: number) {
  const s = get();
  if (!s.playing || s.busy) return;
  const elapsed = Math.min(MAX_ELAPSED, now - started);
  set(elapsed >= MAX_ELAPSED ? { elapsed, playing: false } : { elapsed });
}
