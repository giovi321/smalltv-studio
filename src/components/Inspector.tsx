/* Right panel: properties of the selected layer, and the problems that block exporting. */
import { useRef, useState } from 'react';
import * as C from '../core/core';
import { textPixelWidth } from '../core/dynamic';
import type { AnimationLayer, Assets, ImageLayer, Layer, Scroll, ShapeKind, ShapeLayer, TextLayer } from '../core/types';
import * as F from '../lib/files';
import * as S from '../store/studio';
import { useStudio } from '../store/studio';
import { BindingsSection } from './Bindings';
import { Check, ColorInput, Field, NumberInput, Section, Segmented } from './controls';
import { Icon } from './Icon';

const TOKEN_HELP: Record<string, string> = {
  HH: 'Hour, 00–23', hh: 'Hour, 01–12', MM: 'Minute, 00–59', SS: 'Second, 00–59', DD: 'Day of month, 01–31',
  MON: 'Month, abbreviated', MONTH: 'Month, full name', WD: 'Weekday, abbreviated', WEEKDAY: 'Weekday, full name', YYYY: 'Year',
};
const ALIGN: readonly [S.Edge, string][] = [['left', 'Align left'], ['hcenter', 'Center horizontally'], ['right', 'Align right'], ['top', 'Align top'], ['vcenter', 'Center vertically'], ['bottom', 'Align bottom']];
const kib = (n: number) => (n / 1024).toFixed(1) + ' KiB';

/* Edits the selected layer. `key` merges quick successive edits into one undo step. */
function editLayer<T extends Layer>(fn: (l: T) => void, key = '') {
  S.edit(d => fn(d.theme.layers[d.selected] as T), key);
}

function LayerSection({ layer, index }: { layer: Layer; index: number }) {
  const hidden = useStudio(s => s.hidden.has(layer.id)), locked = useStudio(s => s.locked.has(layer.id));
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const error = S.rename(index, draft.trim());
    if (error) S.notify(error, true);
    setDraft(null);
  };
  return (
    <Section title="Layer">
      <Field label="ID">
        <input id="field-id" value={draft ?? layer.id} maxLength={48} spellCheck={false} autoComplete="off"
          onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }} />
      </Field>
      <div className="btn-row">
        <button type="button" className={'small' + (hidden ? ' active' : '')} aria-pressed={hidden} onClick={() => S.toggleHidden(index)}><Icon name={hidden ? 'eye-off' : 'eye'} />{hidden ? 'Hidden' : 'Visible'}</button>
        <button type="button" className={'small' + (locked ? ' active' : '')} aria-pressed={locked} onClick={() => S.toggleLocked(index)}><Icon name={locked ? 'lock' : 'unlock'} />{locked ? 'Locked' : 'Unlocked'}</button>
      </div>
    </Section>
  );
}

function PositionSection({ layer }: { layer: Layer }) {
  const line = layer.type === 'shape' && layer.shape === 'line';
  const num = (key: 'x' | 'y' | 'x2' | 'y2') => (
    <NumberInput id={'field-' + key} value={(layer as ShapeLayer)[key]} onValue={v => editLayer<ShapeLayer>(l => { l[key] = v; }, layer.id + ':' + key)} />
  );
  return (
    <Section title="Position">
      <div className="field-grid"><Field label={line ? 'Start X' : 'X'}>{num('x')}</Field><Field label={line ? 'Start Y' : 'Y'}>{num('y')}</Field></div>
      {line && <div className="field-grid"><Field label="End X">{num('x2')}</Field><Field label="End Y">{num('y2')}</Field></div>}
      {layer.bind && ['x', 'y', 'x2', 'y2'].some(k => k in layer.bind!) && <p className="hint">Bound coordinates follow the data; the values here are the fallback used until a value arrives.</p>}
      <div className="field">
        <span className="field-label">Align to screen</span>
        <div className="align-row" role="group" aria-label="Align to screen">
          {ALIGN.map(([edge, title]) => <button key={edge} type="button" className="icon-btn" title={title} aria-label={title} onClick={() => S.align(edge)}><Icon name={('al-' + edge) as 'al-left'} /></button>)}
        </div>
      </div>
    </Section>
  );
}

function TextSections({ layer }: { layer: TextLayer }) {
  const input = useRef<HTMLInputElement>(null);
  const sample = useStudio(s => s.sample), time = new Date(useStudio(s => s.baseTime));
  const names = C.dataFields({ data: useStudio(s => s.theme.data) });
  const bad = /[^\x20-\x7e]/.test(layer.value);
  const insert = (token: string) => {
    const el = input.current!, text = '{' + token + '}';
    const a = el.selectionStart ?? layer.value.length, b = el.selectionEnd ?? a;
    editLayer<TextLayer>(l => { l.value = l.value.slice(0, a) + text + l.value.slice(b); });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + text.length, a + text.length); });
  };
  return (
    <>
      <Section title="Text">
        <Field label="Content">
          <input ref={input} type="text" id="field-value" value={layer.value} maxLength={128} spellCheck={false} autoComplete="off" aria-label="Text content"
            onChange={e => { const v = e.target.value; editLayer<TextLayer>(l => { l.value = v; }, layer.id + ':value'); }} />
        </Field>
        <span className={'hint counter mono' + (bad ? ' invalid' : '')} title={bad ? 'Only printable ASCII is supported by the bitmap font.' : ''}>
          {layer.value.length} / 128{bad ? ' · ASCII only' : ''}
        </span>
        <div className="eyebrow">Insert clock variable</div>
        <div className="chip-row">
          {C.tokens.map(t => <button key={t} type="button" className="chip mono" title={TOKEN_HELP[t] + ' · now: ' + C.expand('{' + t + '}', time, sample)} onClick={() => insert(t)}>{'{' + t + '}'}</button>)}
        </div>
        {names.length ? (
          <>
            <div className="eyebrow">Insert data variable</div>
            <div className="chip-row">
              {names.map(n => <button key={n} type="button" className="chip mono data" title={'Data field · preview: ' + (sample[n] ?? '--')} onClick={() => insert(n)}>{'{' + n + '}'}</button>)}
            </div>
          </>
        ) : <p className="hint">Need weather or other live values? Declare a source in the Data tab.</p>}
      </Section>
      <Section title="Appearance">
        <Field label="Size"><NumberInput id="field-size" value={layer.size} min={8} max={96} onValue={v => editLayer<TextLayer>(l => { l.size = v; }, layer.id + ':size')} /></Field>
        <div className="chip-row">
          {[8, 16, 24, 32, 48, 64, 96].map(n => (
            <button key={n} type="button" className="chip mono" aria-pressed={layer.size === n} title={'Uniform pixel scaling: ' + n + ' px'} onClick={() => editLayer<TextLayer>(l => { l.size = n; })}>{n}</button>
          ))}
        </div>
        <div className="field"><span className="field-label">Color</span>
          <ColorInput value={layer.color} label="Text color" id="field-color" onValue={v => editLayer<TextLayer>(l => { l.color = v; }, layer.id + ':color')} />
        </div>
        <div className="field">
          <span className="field-label">Anchor</span>
          <div className="anchor-grid" role="group" aria-label="Text anchor">
            {C.anchors.map(a => (
              <button key={a} type="button" className="anchor-cell" aria-pressed={(layer.anchor ?? 'top-left') === a} title={a.replace('-', ' ')} aria-label={a.replace('-', ' ')}
                onClick={() => editLayer<TextLayer>(l => { l.anchor = a; })}><i /></button>
            ))}
          </div>
          <span className="hint">The X / Y position refers to this point of the text box.</span>
        </div>
        <p className="hint">Built-in bitmap font: printable ASCII only. Weekday and month names are English.</p>
      </Section>
      <ScrollSection layer={layer} />
    </>
  );
}

function ScrollSection({ layer }: { layer: TextLayer }) {
  const scroll = layer.scroll, sample = useStudio(s => s.sample), baseTime = useStudio(s => s.baseTime);
  const textWidth = textPixelWidth(layer.size, C.expand(layer.value, new Date(baseTime), sample).length);
  const setScroll = (patch: Partial<Scroll>, key = '') => editLayer<TextLayer>(l => {
    const next = { ...l.scroll!, ...patch } as Scroll;
    if (next.mode === 'bounce') delete next.gap;
    for (const k of ['pause', 'gap'] as const) if (k in patch && patch[k] === undefined) delete next[k];
    l.scroll = next;
  }, key && layer.id + ':scroll:' + key);
  const toggle = (on: boolean) => editLayer<TextLayer>(l => {
    if (on) l.scroll = { width: Math.max(24, Math.min(200, Math.floor(textWidth / 2) || 120)), mode: 'loop', speed: 30 };
    else delete l.scroll;
    S.pruneBindings(l);
  });
  return (
    <Section title="Scrolling">
      <Check label="Scroll inside a fixed-width viewport" checked={!!scroll} onChange={toggle} />
      {scroll ? (
        <>
          <Segmented options={[['loop', 'Loop'], ['bounce', 'Bounce']] as const} value={scroll.mode} onPick={mode => setScroll({ mode })} label="Scroll mode" />
          <div className="field-grid">
            <Field label="Viewport width"><NumberInput id="field-scroll-width" value={scroll.width} min={1} max={240} onValue={width => setScroll({ width }, 'width')} /></Field>
            <Field label="Speed"><NumberInput value={scroll.speed} min={1} max={240} unit="px/s" onValue={speed => setScroll({ speed }, 'speed')} /></Field>
          </div>
          <div className="field-grid">
            <Field label="Pause"><NumberInput value={scroll.pause ?? 1000} min={0} max={10000} unit="ms" onValue={pause => setScroll({ pause }, 'pause')} /></Field>
            {scroll.mode === 'loop' && <Field label="Gap"><NumberInput value={scroll.gap ?? 24} min={0} max={240} onValue={gap => setScroll({ gap }, 'gap')} /></Field>}
          </div>
          <p className="hint">
            {textWidth > scroll.width ? 'The text is ' + textWidth + ' px wide, so it scrolls.' : 'The text is ' + textWidth + ' px wide and fits: it stays still.'}
            {' '}X, Y and the anchor place the viewport. The device restarts the scroll whenever the text changes, for example every second with {'{SS}'}.
          </p>
        </>
      ) : <p className="hint">Long text is clipped at the edge of the screen unless it scrolls.</p>}
    </Section>
  );
}

function OptionalColor({ layer, prop, label }: { layer: ShapeLayer; prop: 'fill' | 'stroke'; label: string }) {
  const on = layer[prop] != null, last = useRef(layer[prop] ?? '#ffffff');
  if (layer[prop]) last.current = layer[prop]!;
  return (
    <div className="field">
      <Check label={label} checked={on} id={'enable-' + prop} onChange={checked => editLayer<ShapeLayer>(l => { if (checked) l[prop] = last.current; else delete l[prop]; S.pruneBindings(l); })} />
      <ColorInput value={layer[prop] ?? last.current} label={label} id={'field-' + prop} disabled={!on} onValue={v => editLayer<ShapeLayer>(l => { l[prop] = v; }, layer.id + ':' + prop)} />
    </div>
  );
}
function ShapeSections({ layer }: { layer: ShapeLayer }) {
  const line = layer.shape === 'line';
  const setShape = (shape: ShapeKind) => {
    if (shape === layer.shape) return;
    editLayer<ShapeLayer>(l => {
      for (const key of ['width', 'height', 'radius', 'cornerRadius', 'x2', 'y2'] as const) delete l[key];
      l.shape = shape;
      if (shape === 'rectangle') { Object.assign(l, { width: 100, height: 50 }); if (l.fill == null && l.stroke == null) l.fill = '#547875'; }
      else if (shape === 'circle') { l.radius = 40; if (l.fill == null && l.stroke == null) l.fill = '#547875'; }
      else { delete l.fill; Object.assign(l, { x2: Math.min(479, l.x + 80), y2: l.y, stroke: l.stroke || '#ffffff', strokeWidth: l.strokeWidth || 1 }); }
      S.pruneBindings(l);
    });
  };
  const size = (key: 'width' | 'height' | 'radius', label: string) => (
    <Field label={label}><NumberInput id={'field-' + key} value={layer[key]} min={1} max={240} onValue={v => editLayer<ShapeLayer>(l => { l[key] = v; }, layer.id + ':' + key)} /></Field>
  );
  return (
    <>
      <Section title="Shape">
        <Segmented options={[['rectangle', 'Rectangle', 'rect'], ['circle', 'Circle', 'circle'], ['line', 'Line', 'line']] as const} value={layer.shape} onPick={setShape} label="Shape type" />
        {layer.shape === 'rectangle' && <div className="field-grid">{size('width', 'Width')}{size('height', 'Height')}</div>}
        {layer.shape === 'rectangle' && (
          <Field label="Corner radius" hint="Limited to half the shorter side.">
            <NumberInput id="field-cornerRadius" value={layer.cornerRadius ?? 0} min={0} max={120}
              onValue={v => editLayer<ShapeLayer>(l => { if (v) l.cornerRadius = v; else delete l.cornerRadius; }, layer.id + ':cornerRadius')} />
          </Field>
        )}
        {layer.shape === 'circle' && <div className="field-grid">{size('radius', 'Radius')}</div>}
      </Section>
      <Section title="Colors">
        {!line && <OptionalColor layer={layer} prop="fill" label="Fill" />}
        <OptionalColor layer={layer} prop="stroke" label={line ? 'Line color' : 'Outline'} />
        <Field label={line ? 'Thickness' : 'Outline width'}>
          <NumberInput id="field-strokeWidth" value={layer.strokeWidth ?? 1} min={1} max={32} onValue={v => editLayer<ShapeLayer>(l => { l.strokeWidth = v; }, layer.id + ':strokeWidth')} />
        </Field>
        {line && <p className="hint">A line needs a stroke color.</p>}
      </Section>
    </>
  );
}

let keepRatioDefault = true;
function AssetSections({ layer }: { layer: ImageLayer | AnimationLayer }) {
  const assets = useStudio(s => s.assets);
  const [keepRatio, setKeepRatio] = useState(keepRatioDefault);
  // Resample from the pixels the user started with, so typing "48" never goes through a destructive "4".
  const base = useRef<Assets | null>(null);
  const isImage = layer.type === 'image', dims = S.layerDimensions(layer, assets), ratio = dims.width / dims.height || 1;
  const present = assets.has(C.pathFor(layer));
  const bytes = C.framePaths(layer).reduce((n, p) => { const a = assets.get(p); return a ? n + C.encodeImage(a).length : n; }, 0);
  const resize = (width: number, height: number) => S.edit(d => S.resizeLayer(d, d.theme.layers[d.selected], width, height, base.current ?? d.assets), layer.id + ':resize');
  return (
    <>
      <Section title={isImage ? 'Image' : 'Animation'}>
        <button type="button" className="dashed" onClick={() => void F.pickAssets(layer.type)}><Icon name="upload" />{isImage ? 'Import / replace image' : 'Import animation frames'}</button>
        <div className="field-grid" onFocus={() => { base.current ??= S.useStudio.getState().assets; }} onBlur={() => { base.current = null; }}>
          <Field label="Width"><NumberInput id="field-width" value={dims.width} min={1} max={240} onValue={v => resize(v, keepRatio ? v / ratio : dims.height)} /></Field>
          <Field label="Height"><NumberInput id="field-height" value={dims.height} min={1} max={240} onValue={v => resize(keepRatio ? v * ratio : dims.width, v)} /></Field>
        </div>
        <Check label="Keep aspect ratio" checked={keepRatio} onChange={on => { keepRatioDefault = on; setKeepRatio(on); }} />
        <p className="hint">{present ? dims.width + ' × ' + dims.height + ' px' + (isImage ? '' : ' · ' + layer.frames + ' frames') + ' · ' + kib(bytes) + ' in the package' : 'No file yet. Import an image to continue.'}</p>
        <p className="hint">Resizing resamples pixels (nearest neighbour). Undo restores the original.</p>
        <p className="hint mono">{layer.source}</p>
      </Section>
      {layer.type === 'animation' && (
        <Section title="Playback">
          <Field label="Speed"><NumberInput id="field-fps" value={layer.fps} min={1} max={15} unit="fps" onValue={v => editLayer<AnimationLayer>(l => { l.fps = v; }, layer.id + ':fps')} /></Field>
          <Check label="Loop" checked={layer.loop !== false} onChange={on => editLayer<AnimationLayer>(l => { l.loop = on; })} />
          <p className="hint">Select all frames at once when importing. They are sorted by name and must share one size.</p>
        </Section>
      )}
    </>
  );
}

function ArrangeSection({ index }: { index: number }) {
  const count = useStudio(s => s.theme.layers.length);
  return (
    <Section title="Arrange">
      <div className="btn-grid">
        <button type="button" className="small" disabled={index >= count - 1} onClick={() => S.moveLayer(1)}><Icon name="up" />Forward</button>
        <button type="button" className="small" disabled={index <= 0} onClick={() => S.moveLayer(-1)}><Icon name="down" />Backward</button>
        <button type="button" className="small" disabled={count >= S.MAX_LAYERS} onClick={() => S.duplicate()}><Icon name="copy" />Duplicate</button>
        <button type="button" className="small danger" onClick={() => S.removeLayer()}><Icon name="trash" />Delete</button>
      </div>
    </Section>
  );
}

function Problems() {
  const problems = useStudio(s => s.problems);
  if (!problems.length) return null;
  return (
    <section className="problems">
      <h3><Icon name="alert" /><span>Fix before exporting ({problems.length})</span></h3>
      <ul>
        {problems.slice(0, 12).map((message, i) => {
          const layer = /^layers\[(\d+)\]/.exec(message), data = /^data\b/.test(message);
          if (layer) return <li key={i}><button type="button" className="link" onClick={() => { S.setTab('layers'); S.select(Number(layer[1])); }}>{message}</button></li>;
          if (data) return <li key={i}><button type="button" className="link" onClick={() => S.setTab('data')}>{message}</button></li>;
          return <li key={i}>{message}</li>;
        })}
        {problems.length > 12 && <li className="more">…and {problems.length - 12} more</li>}
      </ul>
    </section>
  );
}

export function Inspector() {
  const index = useStudio(s => s.selected), layer = useStudio(s => s.theme.layers[s.selected] ?? null);
  return (
    <aside className="inspector" aria-label="Properties">
      <div className="panel-heading"><h2>Properties</h2><span className="badge">{layer ? S.labels[layer.type] : ''}</span></div>
      <div>
        {!layer ? (
          <div className="empty-state big">
            <Icon name="layers" className="icon xl" />
            <p>Select a layer in the list, or click one on the preview.</p>
            <p className="hint">Drag on the preview to move. Arrow keys nudge by 1 px, Shift + arrows by 10 px.</p>
          </div>
        ) : (
          <div key={index + ':' + layer.type}>
            <LayerSection layer={layer} index={index} />
            <PositionSection layer={layer} />
            {layer.type === 'text' ? <TextSections layer={layer} /> : layer.type === 'shape' ? <ShapeSections layer={layer} /> : <AssetSections layer={layer} />}
            <BindingsSection layer={layer} index={index} />
            <ArrangeSection index={index} />
          </div>
        )}
      </div>
      <Problems />
    </aside>
  );
}
