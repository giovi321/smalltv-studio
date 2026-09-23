/* Inspector section that drives layer properties from fetched data fields. */
import * as C from '../core/core';
import { bindTargets, isColorBinding, isColorTarget, MAX_BINDINGS, MAX_STOPS, parseFiniteNumber, resolveColor, resolveNumeric, targetRange } from '../core/dynamic';
import type { BindTarget, Binding, ColorBinding, Layer, NumericBinding, NumericTarget } from '../core/types';
import * as S from '../store/studio';
import { useStudio } from '../store/studio';
import { Check, ColorInput, Field, NumberInput, Section } from './controls';
import { Icon } from './Icon';

const LABELS: Record<BindTarget, string> = {
  x: 'X', y: 'Y', width: 'Width', height: 'Height', radius: 'Radius', cornerRadius: 'Corner radius', x2: 'End X', y2: 'End Y',
  size: 'Size', strokeWidth: 'Stroke width', 'scroll.width': 'Scroll width', 'scroll.speed': 'Scroll speed', color: 'Color', fill: 'Fill', stroke: 'Stroke',
};
const clampTo = (t: NumericTarget, n: number) => Math.max(targetRange[t][0], Math.min(targetRange[t][1], n));

function staticColor(l: Layer, t: 'color' | 'fill' | 'stroke') {
  return (l.type === 'text' && t === 'color' ? l.color : l.type === 'shape' && t !== 'color' ? l[t] : undefined) ?? '#ffffff';
}
function defaultBinding(l: Layer, target: BindTarget, source: string): Binding {
  if (isColorTarget(target)) return { source, stops: [{ at: 0, value: staticColor(l, target) }] };
  return { source, input: [0, 100], output: [clampTo(target, 0), clampTo(target, 100)] };
}

function NumericEditor({ binding, target, update }: { binding: NumericBinding; target: NumericTarget; update: (b: NumericBinding) => void }) {
  const [lo, hi] = targetRange[target];
  const set = (key: 'input' | 'output', i: 0 | 1, v: number) => { const pair = [...binding[key]] as [number, number]; pair[i] = v; update({ ...binding, [key]: pair }); };
  return (
    <>
      <div className="field-grid">
        <Field label="Value from"><NumberInput value={binding.input[0]} step="any" unit="" min={-1e12} max={1e12} onValue={v => set('input', 0, v)} /></Field>
        <Field label="Value to"><NumberInput value={binding.input[1]} step="any" unit="" min={-1e12} max={1e12} onValue={v => set('input', 1, v)} /></Field>
      </div>
      <div className="field-grid">
        <Field label={LABELS[target] + ' from'}><NumberInput value={binding.output[0]} min={lo} max={hi} unit="" onValue={v => set('output', 0, v)} /></Field>
        <Field label={LABELS[target] + ' to'}><NumberInput value={binding.output[1]} min={lo} max={hi} unit="" onValue={v => set('output', 1, v)} /></Field>
      </div>
      <Check label="Stay within the output range" checked={binding.clamp !== false} onChange={on => { const next = { ...binding }; if (on) delete next.clamp; else next.clamp = false; update(next); }} />
      <span className="hint">Linear mapping, rounded to whole pixels. The result never leaves {lo} to {hi}.</span>
    </>
  );
}

function ColorEditor({ binding, update }: { binding: ColorBinding; update: (b: ColorBinding) => void }) {
  const setStop = (i: number, patch: Partial<ColorBinding['stops'][number]>) => update({ ...binding, stops: binding.stops.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const last = binding.stops[binding.stops.length - 1];
  return (
    <>
      {binding.stops.map((stop, i) => (
        <div key={i} className="stop-row">
          <Field label={i ? 'From value' : 'Below, and from'}><NumberInput value={stop.at} step="any" unit="" min={-1e12} max={1e12} onValue={v => setStop(i, { at: v })} /></Field>
          <div className="field"><span className="field-label">Color</span><ColorInput value={stop.value} label={'Stop ' + (i + 1)} onValue={v => setStop(i, { value: v })} /></div>
          <button type="button" className="icon-btn mini" title="Remove stop" aria-label={'Remove stop ' + (i + 1)} disabled={binding.stops.length <= 1}
            onClick={() => update({ ...binding, stops: binding.stops.filter((_, k) => k !== i) })}><Icon name="close" /></button>
        </div>
      ))}
      <button type="button" className="small" disabled={binding.stops.length >= MAX_STOPS}
        onClick={() => update({ ...binding, stops: [...binding.stops, { at: last.at + 10, value: last.value }] })}><Icon name="plus" />Add stop</button>
      <span className="hint">Each stop applies from its value upwards. Values must increase.</span>
    </>
  );
}

function BindingCard({ layer, index, target, binding, fields }: { layer: Layer; index: number; target: BindTarget; binding: Binding; fields: string[] }) {
  const raw = useStudio(s => s.sample[binding.source]), value = raw == null ? null : parseFiniteNumber(raw);
  const key = layer.id + ':bind:' + target;
  const update = (next: Binding) => S.setBinding(index, target, next, key);
  let preview = 'No numeric preview value for {' + binding.source + '}: the static value is used.';
  if (value != null) {
    const result = isColorBinding(binding) ? resolveColor(binding, value) : resolveNumeric(binding, value, ...targetRange[target as NumericTarget]);
    preview = 'Preview: ' + raw + ' → ' + result;
  }
  return (
    <div className="field-row">
      <div className="field-row-top">
        <code>{LABELS[target]}</code>
        <button type="button" className="icon-btn mini" title="Remove binding" aria-label={'Remove ' + LABELS[target] + ' binding'} onClick={() => S.setBinding(index, target, null)}><Icon name="close" /></button>
      </div>
      <Field label="Data field">
        <select value={binding.source} onChange={e => update({ ...binding, source: e.target.value })}>
          {!fields.includes(binding.source) && <option value={binding.source}>{binding.source} (not declared)</option>}
          {fields.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </Field>
      {isColorBinding(binding)
        ? <ColorEditor binding={binding} update={update} />
        : <NumericEditor binding={binding} target={target as NumericTarget} update={update} />}
      <span className="hint mono">{preview}</span>
    </div>
  );
}

export function BindingsSection({ layer, index }: { layer: Layer; index: number }) {
  const fields = C.dataFields({ data: useStudio(s => s.theme.data) }), sample = useStudio(s => s.sample);
  // Prefer a field whose preview value is a number, so a new binding shows its effect at once.
  const numericField = fields.find(f => sample[f] != null && parseFiniteNumber(sample[f]) != null) ?? fields[0];
  const bound = Object.entries(layer.bind ?? {}) as [BindTarget, Binding][];
  const free = bindTargets(layer).filter(t => !layer.bind?.[t]);
  return (
    <Section title="Data bindings">
      {!fields.length && !bound.length ? (
        <p className="hint">Declare a data source in the Data tab to move, resize or recolor this layer from live values.</p>
      ) : (
        <>
          {bound.map(([target, binding]) => <BindingCard key={target} layer={layer} index={index} target={target} binding={binding} fields={fields} />)}
          {bound.length < MAX_BINDINGS && free.length > 0 && fields.length > 0 && (
            <select aria-label="Add a binding" value="" onChange={e => { const t = e.target.value as BindTarget; if (t) S.setBinding(index, t, defaultBinding(layer, t, numericField)); }}>
              <option value="">Bind a property…</option>
              {free.map(t => <option key={t} value={t}>{LABELS[t]}</option>)}
            </select>
          )}
          <span className="hint">Preview values from the Data tab drive the preview. Without a value, the device keeps the static property.</span>
        </>
      )}
    </Section>
  );
}
