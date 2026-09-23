/* Preview stage: pixel rendering, selection overlay, handles, snapping, rulers and zoom. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import * as C from '../core/core';
import type { Layer, Rect } from '../core/types';
import * as S from '../store/studio';
import { useStudio, type StudioState } from '../store/studio';
import { openContextMenu } from './ContextMenu';
import { Icon } from './Icon';
import { Playback } from './Playback';

const RULER = 18, ACCENT = '#c4ee83', GUIDE = '#ff6fb5', HANDLE = 8, SNAP_PX = 6;
const ZOOMS = [1, 2, 3, 4, 5];
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const dpr = () => Math.max(1, devicePixelRatio || 1);

type Point = { x: number; y: number };
type HandleKey = 'corner' | 'text-size' | 'radius' | 'p1' | 'p2';
type Handle = { key: HandleKey; x: number; y: number; cursor: string };
type Guides = { x: number[]; y: number[] };
interface DragState { mode: HandleKey | 'move'; start: Point; bounds: Rect; dims: { width: number; height: number }; session: S.DragSession; moved: boolean }

/* ---------- geometry ---------- */
function handlesOf(l: Layer, r: Rect): Handle[] {
  if (l.type === 'image' || l.type === 'animation') return [{ key: 'corner', x: r.x + r.w, y: r.y + r.h, cursor: 'nwse-resize' }];
  if (l.type === 'text') {
    const a = C.anchors.indexOf(l.anchor ?? 'top-left'), col = (a % 3) / 2, row = Math.floor(a / 3) / 2;
    return [{ key: 'text-size', x: col <= 0.5 ? r.x + r.w : r.x, y: row <= 0.5 ? r.y + r.h : r.y, cursor: 'ns-resize' }];
  }
  if (l.shape === 'rectangle') return [{ key: 'corner', x: l.x + (l.width ?? 0), y: l.y + (l.height ?? 0), cursor: 'nwse-resize' }];
  if (l.shape === 'circle') return [{ key: 'radius', x: l.x + (l.radius ?? 0), y: l.y, cursor: 'ew-resize' }];
  return [{ key: 'p1', x: l.x, y: l.y, cursor: 'crosshair' }, { key: 'p2', x: l.x2 ?? l.x, y: l.y2 ?? l.y, cursor: 'crosshair' }];
}
function hits(s: StudioState, l: Layer, p: Point, scale: number) {
  if (s.hidden.has(l.id)) return false;
  if (l.type === 'shape' && l.shape === 'line') {
    const dx = (l.x2 ?? l.x) - l.x, dy = (l.y2 ?? l.y) - l.y, len = dx * dx + dy * dy, t = len ? clamp(((p.x - l.x) * dx + (p.y - l.y) * dy) / len, 0, 1) : 0;
    return Math.hypot(p.x - (l.x + t * dx), p.y - (l.y + t * dy)) <= Math.max(4 / scale, (l.strokeWidth ?? 1) / 2 + 1);
  }
  if (l.type === 'shape' && l.shape === 'circle') return Math.hypot(p.x - l.x, p.y - l.y) <= (l.radius ?? 0) + 1;
  const r = S.layerBounds(l, s);
  return p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;
}
function hitLayer(s: StudioState, p: Point, scale: number) {
  for (let i = s.theme.layers.length - 1; i >= 0; i--) if (hits(s, s.theme.layers[i], p, scale)) return i;
  return -1;
}

/* ---------- snapping ---------- */
function snapTargets(s: StudioState, skip: number) {
  const xs = [0, 120, 240], ys = [0, 120, 240];
  s.theme.layers.forEach((l, i) => {
    if (i === skip || s.hidden.has(l.id)) return;
    const r = S.layerBounds(l, s);
    xs.push(r.x, r.x + r.w / 2, r.x + r.w); ys.push(r.y, r.y + r.h / 2, r.y + r.h);
  });
  return { xs, ys };
}
function nearest(values: number[], targets: number[], tol: number) {
  let best: { d: number; at: number } | null = null;
  for (const v of values) for (const t of targets) { const d = t - v; if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t }; }
  return best;
}

/* ---------- drawing ---------- */
function drawOverlay(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, s: StudioState, scale: number, hover: number, guides: Guides) {
  const k = scale, px = 1 / k;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
  g.setTransform(k * dpr(), 0, 0, k * dpr(), 0, 0);
  if (s.grid) {
    const minor = scale >= 2 ? 10 : 20;
    for (let u = minor; u < 240; u += minor) {
      g.fillStyle = u % 40 === 0 ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.07)';
      g.fillRect(u - px / 2, 0, px, 240); g.fillRect(0, u - px / 2, 240, px);
    }
    g.fillStyle = 'rgba(196,238,131,.22)'; g.fillRect(120 - px / 2, 0, px, 240); g.fillRect(0, 120 - px / 2, 240, px);
  }
  const hovered = s.theme.layers[hover];
  if (hovered && hover !== s.selected) {
    const r = S.layerBounds(hovered, s);
    g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = px; g.strokeRect(r.x, r.y, r.w, r.h);
  }
  const l = S.selectedLayer(s);
  if (l && !s.hidden.has(l.id)) {
    const r = S.layerBounds(l, s), locked = s.locked.has(l.id);
    g.lineWidth = px; g.strokeStyle = locked ? '#9aa4b2' : ACCENT;
    g.setLineDash(locked ? [] : [4 * px, 3 * px]); g.strokeRect(r.x, r.y, r.w, r.h); g.setLineDash([]);
    if (l.type === 'text') { g.fillStyle = ACCENT; g.fillRect(l.x - 2 * px, l.y - 2 * px, 4 * px, 4 * px); }
    if (!locked) for (const h of handlesOf(l, r)) {
      const size = HANDLE * px;
      g.fillStyle = ACCENT; g.strokeStyle = '#0b0e12'; g.lineWidth = px;
      g.fillRect(h.x - size / 2, h.y - size / 2, size, size); g.strokeRect(h.x - size / 2, h.y - size / 2, size, size);
    }
  }
  g.fillStyle = GUIDE;
  for (const x of guides.x) g.fillRect(x - px / 2, 0, px, 240);
  for (const y of guides.y) g.fillRect(0, y - px / 2, 240, px);
}
function drawRuler(c: HTMLCanvasElement, horizontal: boolean, scale: number, selection: Rect | null, cursor: Point | null) {
  const g = c.getContext('2d')!, ratio = dpr(), labelStep = scale >= 2 ? 20 : 40, span = 240 * scale;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.setTransform(ratio, 0, 0, ratio, 0, 0);
  g.fillStyle = '#161a21'; g.fillRect(0, 0, horizontal ? span : RULER, horizontal ? RULER : span);
  if (selection) {
    g.fillStyle = 'rgba(196,238,131,.16)';
    const a = (horizontal ? selection.x : selection.y) * scale, b = (horizontal ? selection.w : selection.h) * scale;
    if (horizontal) g.fillRect(a, 0, b, RULER); else g.fillRect(0, a, RULER, b);
  }
  g.strokeStyle = '#4b5464'; g.fillStyle = '#8590a0'; g.lineWidth = 1; g.font = '9px ui-monospace,SFMono-Regular,Menlo,monospace'; g.textBaseline = 'top';
  g.beginPath();
  for (let u = 0; u <= 240; u += 10) {
    if (u % (scale >= 2 ? 10 : 20) !== 0) continue;
    const len = u % labelStep === 0 ? RULER : u % 20 === 0 ? 7 : 4, p = Math.round(u * scale) + 0.5;
    if (horizontal) { g.moveTo(p, RULER); g.lineTo(p, RULER - len); } else { g.moveTo(RULER, p); g.lineTo(RULER - len, p); }
  }
  g.stroke();
  for (let u = 0; u <= 240; u += labelStep) {
    const p = Math.round(u * scale);
    if (horizontal) g.fillText(String(u), p + 3, 2);
    else { g.save(); g.translate(2, p + 3); g.rotate(-Math.PI / 2); g.fillText(String(u), -g.measureText(String(u)).width - 1, 0); g.restore(); }
  }
  if (cursor) {
    g.strokeStyle = ACCENT; g.beginPath();
    const p = Math.round((horizontal ? cursor.x : cursor.y) * scale) + 0.5;
    if (horizontal) { g.moveTo(p, 0); g.lineTo(p, RULER); } else { g.moveTo(0, p); g.lineTo(RULER, p); }
    g.stroke();
  }
}

/* ---------- component ---------- */
export function Stage() {
  const area = useRef<HTMLDivElement>(null), preview = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLCanvasElement>(null);
  const rulerX = useRef<HTMLCanvasElement>(null), rulerY = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState<'fit' | number>('fit'), [fitScale, setFitScale] = useState(2);
  const scale = zoom === 'fit' ? fitScale : zoom;
  const [hover, setHover] = useState(-1), [cursor, setCursor] = useState<Point | null>(null), [guides, setGuides] = useState<Guides>({ x: [], y: [] });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<DragState | null>(null);
  const s = useStudio();
  const grid = s.grid, snap = s.snap, empty = s.theme.layers.length === 0;

  /* Fit zoom follows the stage size. */
  useLayoutEffect(() => {
    const el = area.current; if (!el) return;
    const fit = () => { const spare = 2 * 20 + RULER + 2 * 14; setFitScale(clamp(Math.floor(Math.min(el.clientWidth - spare, el.clientHeight - spare) / 240), 1, 5)); };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => { document.documentElement.style.setProperty('--preview-size', 240 * scale + 'px'); }, [scale]);

  /* Pixels: redrawn whenever anything the renderer reads changes. Keeps the last valid frame while a field is incomplete. */
  useEffect(() => {
    try { preview.current?.getContext('2d')!.putImageData(new ImageData(S.renderFrame(s), 240, 240), 0, 0); } catch { /* keep the last valid frame */ }
  }, [s.theme, s.assets, s.hidden, s.sample, s.target, s.baseTime, s.elapsed]);
  useEffect(() => {
    const c = overlay.current; if (!c) return;
    const size = Math.round(240 * scale * dpr());
    if (c.width !== size) c.width = c.height = size;
    drawOverlay(c.getContext('2d')!, c, s, scale, hover, guides);
  });
  useEffect(() => {
    const l = S.selectedLayer(s), selection = l && !s.hidden.has(l.id) ? S.layerBounds(l, s) : null;
    for (const [c, horizontal] of [[rulerX.current, true], [rulerY.current, false]] as const) {
      if (!c) continue;
      const long = Math.round(240 * scale * dpr()), short = Math.round(RULER * dpr());
      const w = horizontal ? long : short, h = horizontal ? short : long;
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      drawRuler(c, horizontal, scale, selection, cursor);
    }
  });

  const zoomBy = useCallback((step: number) => setZoom(clamp(ZOOMS[clamp(ZOOMS.indexOf(scale) + step, 0, ZOOMS.length - 1)], 1, 5)), [scale]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping() || S.useStudio.getState().busy) return;
      if (e.key === '+' || e.key === '=') zoomBy(1);
      else if (e.key === '-') zoomBy(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [zoomBy]);

  /* ---------- pointer ---------- */
  const rawPoint = (e: { clientX: number; clientY: number }): Point => {
    const r = overlay.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) * 240 / r.width, y: (e.clientY - r.top) * 240 / r.height };
  };
  const intPoint = (p: Point) => ({ x: Math.floor(p.x), y: Math.floor(p.y) });
  const handleAt = (st: StudioState, l: Layer, p: Point) => {
    const tol = (HANDLE + 2) / scale;
    return handlesOf(l, S.layerBounds(l, st)).find(h => Math.abs(p.x - h.x) <= tol && Math.abs(p.y - h.y) <= tol) ?? null;
  };

  function applyDrag(e: ReactPointerEvent) {
    const d = drag.current!, st = S.useStudio.getState(), raw = intPoint(rawPoint(e)), free = !st.snap || e.altKey, index = st.selected;
    let next: Guides = { x: [], y: [] };
    const snapPoint = (p: Point) => {
      const { xs, ys } = snapTargets(st, index), tol = SNAP_PX / scale, bx = nearest([p.x], xs, tol), by = nearest([p.y], ys, tol);
      next = { x: bx ? [bx.at] : [], y: by ? [by.at] : [] };
      return { x: bx ? Math.round(bx.at) : p.x, y: by ? Math.round(by.at) : p.y };
    };
    d.moved = S.dragTo(d.session, draft => {
      const l = draft.theme.layers[index];
      if (d.mode === 'move') {
        let dx = raw.x - d.start.x, dy = raw.y - d.start.y;
        if (!free) {
          const r = d.bounds, { xs, ys } = snapTargets(st, index), tol = SNAP_PX / scale;
          const bx = nearest([r.x + dx, r.x + r.w / 2 + dx, r.x + r.w + dx], xs, tol), by = nearest([r.y + dy, r.y + r.h / 2 + dy, r.y + r.h + dy], ys, tol);
          next = { x: bx ? [bx.at] : [], y: by ? [by.at] : [] };
          dx += bx ? Math.round(bx.d) : 0; dy += by ? Math.round(by.d) : 0;
        }
        S.translate(l, dx, dy);
        return;
      }
      const p = free ? raw : snapPoint(raw);
      if (d.mode === 'corner') {
        const { width: w0, height: h0 } = d.dims;
        let w = p.x - l.x, h = p.y - l.y;
        if (e.shiftKey && w0 && h0) { if (Math.abs(w / w0) >= Math.abs(h / h0)) h = Math.round(w * h0 / w0); else w = Math.round(h * w0 / h0); }
        if (l.type === 'shape') { l.width = clamp(w, 1, 240); l.height = clamp(h, 1, 240); } else S.resizeLayer(draft, l, w, h);
      } else if (d.mode === 'radius' && l.type === 'shape') l.radius = clamp(Math.round(Math.hypot(p.x - l.x, p.y - l.y)), 1, 240);
      else if (d.mode === 'p1') { l.x = clamp(p.x, -240, 479); l.y = clamp(p.y, -240, 479); }
      else if (d.mode === 'p2' && l.type === 'shape') { l.x2 = clamp(p.x, -240, 479); l.y2 = clamp(p.y, -240, 479); }
      else if (d.mode === 'text-size' && l.type === 'text') {
        const row = Math.floor(C.anchors.indexOf(l.anchor ?? 'top-left') / 3) / 2, factor = row <= 0.5 ? 1 - row : row;
        l.size = clamp(Math.round(Math.abs(p.y - l.y) / factor), 8, 96);
      }
    });
    setGuides(next);
  }
  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const st = S.useStudio.getState();
    if (st.busy || e.button !== 0) return;
    e.currentTarget.focus();
    const raw = rawPoint(e), current = S.selectedLayer(st);
    const handle = current && !st.locked.has(current.id) ? handleAt(st, current, raw) : null;
    let mode: DragState['mode'] | null = handle?.key ?? null;
    if (!handle) {
      const index = hitLayer(st, raw, scale);
      if (index !== st.selected) S.select(index);
      if (index < 0) return;
      if (!st.locked.has(st.theme.layers[index].id)) mode = 'move';
    }
    if (!mode) { S.notify('This layer is locked. Unlock it in the Layers list to move it.'); return; }
    const now = S.useStudio.getState(), l = S.selectedLayer(now)!;
    S.pause();
    drag.current = { mode, start: intPoint(raw), bounds: S.layerBounds(l, now), dims: S.layerDimensions(l, now.assets), session: S.beginDrag(), moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  }
  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const raw = rawPoint(e);
    setCursor({ x: clamp(raw.x, 0, 240), y: clamp(raw.y, 0, 240) });
    if (drag.current) { applyDrag(e); return; }
    const st = S.useStudio.getState(), l = S.selectedLayer(st), handle = l && !st.locked.has(l.id) ? handleAt(st, l, raw) : null;
    const index = handle ? st.selected : hitLayer(st, raw, scale);
    e.currentTarget.style.cursor = handle ? handle.cursor : index < 0 ? 'default' : st.locked.has(st.theme.layers[index].id) ? 'not-allowed' : 'grab';
    setHover(index);
  }
  function finishDrag() {
    const d = drag.current; if (!d) return;
    drag.current = null;
    S.endDrag(d.session, d.moved);
    setGuides({ x: [], y: [] }); setDragging(false);
  }

  return (
    <section className="stage-panel" aria-label="Preview">
      <div className="stage-toolbar">
        <div className="tool-group" role="group" aria-label="View options">
          <button type="button" className="toggle" aria-pressed={grid} title="Pixel grid (G)" onClick={S.toggleGrid}><Icon name="grid" />Grid</button>
          <button type="button" className="toggle" aria-pressed={snap} title="Snap to canvas and other layers (S). Hold Alt to bypass." onClick={S.toggleSnap}><Icon name="magnet" />Snap</button>
        </div>
        <div className="tool-group" role="group" aria-label="Zoom">
          <button type="button" className="icon-btn" title="Zoom out (−)" aria-label="Zoom out" onClick={() => zoomBy(-1)}><Icon name="minus" /></button>
          <select aria-label="Zoom level" value={zoom === 'fit' ? 'fit' : String(scale)} onChange={e => setZoom(e.target.value === 'fit' ? 'fit' : Number(e.target.value))}>
            <option value="fit">Fit</option>
            {ZOOMS.map(z => <option key={z} value={z}>{z * 100} %</option>)}
          </select>
          <button type="button" className="icon-btn" title="Zoom in (+)" aria-label="Zoom in" onClick={() => zoomBy(1)}><Icon name="plus" /></button>
        </div>
        <div className="readout" aria-live="off">
          <span className="readout-label">240 × 240 px</span>
          <span className="mono">{cursor ? 'x ' + Math.floor(cursor.x) + ' · y ' + Math.floor(cursor.y) : 'x – · y –'}</span>
        </div>
      </div>

      <div className="stage-area" ref={area}>
        <div className="stage-frame">
          <div className="ruler-corner" />
          <canvas ref={rulerX} className="ruler ruler-x" aria-hidden="true" />
          <canvas ref={rulerY} className="ruler ruler-y" aria-hidden="true" />
          <div className="device">
            <div className="canvas-wrap">
              <canvas id="preview" ref={preview} width={240} height={240} aria-label="Live preview, 240 by 240 pixels" />
              <canvas
                id="selection" ref={overlay} tabIndex={0} className={dragging ? 'dragging' : undefined}
                aria-label="Select and move layers. Arrow keys nudge the selection."
                onPointerDown={onPointerDown} onPointerMove={onPointerMove}
                onPointerLeave={() => { setCursor(null); setHover(-1); }}
                onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
                onContextMenu={e => { e.preventDefault(); openContextMenu(hitLayer(S.useStudio.getState(), rawPoint(e), scale), e.clientX, e.clientY); }}
              />
              {empty && <div className="empty-hint">Add a layer to start designing</div>}
            </div>
          </div>
        </div>
      </div>
      <Playback />
    </section>
  );
}

export function isTyping() {
  const active = document.activeElement as HTMLElement | null;
  return !!active && (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable);
}
