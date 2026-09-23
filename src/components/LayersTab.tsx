import { useEffect, useRef, useState, type DragEvent } from 'react';
import * as C from '../core/core';
import type { Asset, Assets, Layer, LayerType } from '../core/types';
import * as F from '../lib/files';
import * as S from '../store/studio';
import { useStudio } from '../store/studio';
import { Icon, type IconName } from './Icon';
import { openContextMenu } from './ContextMenu';

const ADD: readonly [LayerType, string, IconName][] = [['text', 'Text', 'text'], ['image', 'Image', 'image'], ['animation', 'Animation', 'film'], ['shape', 'Shape', 'shape']];

/* ---------- thumbnails ---------- */
const assetCanvases = new WeakMap<Asset, HTMLCanvasElement>();
export function assetCanvas(asset: Asset) {
  let c = assetCanvases.get(asset);
  if (c) return c;
  c = Object.assign(document.createElement('canvas'), { width: asset.width, height: asset.height });
  c.getContext('2d')!.putImageData(new ImageData(C.assetRGBA(asset), asset.width, asset.height), 0, 0);
  assetCanvases.set(asset, c);
  return c;
}
function drawThumb(c: HTMLCanvasElement, l: Layer, assets: Assets, background: string) {
  const g = c.getContext('2d')!, size = c.width;
  g.clearRect(0, 0, size, size); g.fillStyle = background; g.fillRect(0, 0, size, size); g.imageSmoothingEnabled = false;
  const fit = (w: number, h: number) => { const s = Math.min((size - 8) / w, (size - 8) / h); return { w: Math.max(1, w * s), h: Math.max(1, h * s) }; };
  if (l.type === 'image' || l.type === 'animation') {
    const a = assets.get(C.pathFor(l, 0));
    if (a) { const d = fit(a.width, a.height); g.drawImage(assetCanvas(a), (size - d.w) / 2, (size - d.h) / 2, d.w, d.h); }
    else { g.strokeStyle = '#6b7686'; g.setLineDash([3, 3]); g.strokeRect(6, 6, size - 12, size - 12); }
  } else if (l.type === 'text') {
    g.fillStyle = /^#[0-9a-f]{6}$/i.test(l.color) ? l.color : '#fff';
    g.font = '700 ' + Math.round(size * 0.5) + 'px ui-monospace,Menlo,monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('Aa', size / 2, size / 2 + 1);
  } else if (l.shape === 'rectangle') {
    const d = fit(l.width || 1, l.height || 1), x = (size - d.w) / 2, y = (size - d.h) / 2;
    if (l.fill) { g.fillStyle = l.fill; g.fillRect(x, y, d.w, d.h); }
    if (l.stroke) { g.strokeStyle = l.stroke; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, d.w - 2, d.h - 2); }
  } else if (l.shape === 'circle') {
    g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
    if (l.fill) { g.fillStyle = l.fill; g.fill(); }
    if (l.stroke) { g.strokeStyle = l.stroke; g.lineWidth = 2; g.stroke(); }
  } else {
    g.strokeStyle = l.stroke || '#fff'; g.lineWidth = 2; g.lineCap = 'round'; g.beginPath();
    const dx = (l.x2 ?? l.x) - l.x, dy = (l.y2 ?? l.y) - l.y, m = Math.max(Math.abs(dx), Math.abs(dy), 1), k = (size - 14) / m;
    g.moveTo(size / 2 - dx * k / 2, size / 2 - dy * k / 2); g.lineTo(size / 2 + dx * k / 2, size / 2 + dy * k / 2); g.stroke();
  }
}
function Thumb({ layer }: { layer: Layer }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const assets = useStudio(s => s.assets), background = useStudio(s => s.theme.display.background);
  useEffect(() => { if (ref.current) drawThumb(ref.current, layer, assets, background); }, [layer, assets, background]);
  return <canvas ref={ref} className="layer-thumb" width={56} height={56} />;
}

function subtitle(l: Layer) {
  if (l.type === 'text') return l.value;
  if (l.type === 'animation') return 'Animation · ' + l.frames + ' frame' + (l.frames === 1 ? '' : 's');
  if (l.type === 'shape') return 'Shape · ' + l.shape;
  return 'Image';
}

function RenameInput({ index, id, onDone }: { index: number; id: string; onDone: () => void }) {
  const done = useRef(false);
  const finish = (commit: boolean, value: string) => {
    if (done.current) return;
    done.current = true;
    const error = commit ? S.rename(index, value.trim()) : '';
    if (error) S.notify(error, true);
    onDone();
  };
  return (
    <input
      className="rename" defaultValue={id} maxLength={48} spellCheck={false} aria-label="Layer ID" autoFocus onFocus={e => e.currentTarget.select()}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(true, e.currentTarget.value); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false, ''); }
      }}
      onBlur={e => finish(true, e.currentTarget.value)}
    />
  );
}

type Drop = { index: number; above: boolean } | null;
function LayerRow({ layer, index, dragFrom, drop, setDrag, setDrop }: {
  layer: Layer; index: number; dragFrom: number; drop: Drop; setDrag: (i: number) => void; setDrop: (d: Drop) => void;
}) {
  const selected = useStudio(s => s.selected === index), hidden = useStudio(s => s.hidden.has(layer.id)), locked = useStudio(s => s.locked.has(layer.id));
  const [renaming, setRenaming] = useState(false);
  const flag = (on: boolean, onIcon: IconName, offIcon: IconName, title: string, toggle: (i: number) => void) => (
    <button type="button" className={'icon-btn mini' + (on ? ' active' : '')} title={title} aria-label={title} aria-pressed={on} onClick={e => { e.stopPropagation(); toggle(index); }}>
      <Icon name={on ? onIcon : offIcon} />
    </button>
  );
  const half = (e: DragEvent<HTMLDivElement>) => { const r = e.currentTarget.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; };
  const cls = ['layer', selected && 'selected', hidden && 'is-hidden', locked && 'is-locked', dragFrom === index && 'dragging',
    drop?.index === index && (drop.above ? 'drop-above' : 'drop-below')].filter(Boolean).join(' ');
  return (
    <div
      className={cls} role="listitem" draggable={!renaming}
      onContextMenu={e => { e.preventDefault(); openContextMenu(index, e.clientX, e.clientY); }}
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(index)); requestAnimationFrame(() => setDrag(index)); }}
      onDragEnd={() => { setDrag(-1); setDrop(null); }}
      onDragOver={e => { if (dragFrom < 0) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDrop({ index, above: half(e) }); }}
      onDragLeave={() => setDrop(null)}
      onDrop={e => {
        if (dragFrom < 0) return;
        e.preventDefault();
        // The list shows the top layer first, so "above" means a higher index.
        const after = dragFrom < index ? index - 1 : index;
        S.reorder(dragFrom, half(e) ? after + 1 : after);
        setDrag(-1); setDrop(null);
      }}
    >
      <span className="grip" aria-hidden="true"><Icon name="grip" /></span>
      <button type="button" className="layer-main" aria-pressed={selected} title="Select · double-click to rename" onClick={() => S.select(index)} onDoubleClick={() => setRenaming(true)}>
        <Thumb layer={layer} />
        <span className="layer-copy">
          {renaming ? <RenameInput index={index} id={layer.id} onDone={() => setRenaming(false)} /> : <span className="layer-name">{layer.id || 'Untitled'}</span>}
          <span className="layer-sub">{subtitle(layer)}</span>
        </span>
      </button>
      {flag(hidden, 'eye-off', 'eye', hidden ? 'Show layer in preview' : 'Hide layer in preview', S.toggleHidden)}
      {flag(locked, 'lock', 'unlock', locked ? 'Unlock layer' : 'Lock layer', S.toggleLocked)}
    </div>
  );
}

export function LayersTab() {
  const layers = useStudio(s => s.theme.layers), busy = useStudio(s => s.busy);
  const flagged = useStudio(s => s.hidden.size + s.locked.size > 0);
  const [dragFrom, setDrag] = useState(-1);
  const [drop, setDrop] = useState<Drop>(null);
  const full = layers.length >= S.MAX_LAYERS;
  const add = (type: LayerType) => {
    if (!S.addLayer(type)) return;
    if (type === 'image' || type === 'animation') void F.pickAssets(type);
  };
  return (
    <>
      <div className="panel-heading"><h2>Layers</h2><span className="badge">{layers.length} / {S.MAX_LAYERS}</span></div>
      <p className="hint">Top of the list is drawn in front. Drag to reorder, double-click to rename.</p>
      <div className="layers" role="list" aria-label="Theme layers">
        {!layers.length && <p className="empty-state">Your screen is empty. Add a first layer below.</p>}
        {layers.map((l, i) => ({ l, i })).reverse().map(({ l, i }) => (
          <LayerRow key={l.id + ':' + i} layer={l} index={i} dragFrom={dragFrom} drop={drop} setDrag={setDrag} setDrop={setDrop} />
        ))}
      </div>
      {flagged && <p className="note">Hidden and locked layers only affect this editor. Hidden layers are still exported.</p>}
      <div className="add-block">
        <div className="eyebrow">Add layer</div>
        <div className="add-buttons">
          {ADD.map(([type, label, icon]) => (
            <button key={type} type="button" disabled={full || busy} onClick={() => add(type)}><Icon name={icon} />{label}</button>
          ))}
        </div>
      </div>
    </>
  );
}
