/* Small form controls shared by the side panels and the inspector. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

/* Shows the store value, except while focused: the user's draft wins, so typing "48" never bounces through "4". */
export function NumberInput({ value, onValue, min = -240, max = 479, unit = 'px', id, step = 1, label }: {
  value: number | undefined; onValue: (v: number) => void; min?: number; max?: number; unit?: string; id?: string; step?: number | 'any'; label?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <span className="input-unit">
      <input
        type="number" id={id} min={min} max={max} step={step} aria-label={label}
        value={draft ?? (value ?? '')}
        onChange={e => { setDraft(e.target.value); const v = e.target.valueAsNumber; if (Number.isFinite(v)) onValue(v); }}
        onBlur={() => setDraft(null)}
      />
      {unit ? <em>{unit}</em> : null}
    </span>
  );
}

export function normalizeHex(text: string, lenient: boolean): string | null {
  let v = String(text).trim().toLowerCase();
  if (v && v[0] !== '#') v = '#' + v;
  if (lenient && /^#[0-9a-f]{3}$/.test(v)) v = '#' + [...v.slice(1)].map(c => c + c).join('');
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
}
export function ColorInput({ value, onValue, label, id, disabled = false }: {
  value: string; onValue: (v: string) => void; label: string; id?: string; disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const safe = /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '#ffffff';
  const invalid = draft != null && !normalizeHex(draft, false);
  return (
    <div className="color-input">
      <input type="color" value={safe} disabled={disabled} aria-label={label + ' color picker'} onChange={e => { setDraft(null); onValue(e.target.value); }} />
      <input
        type="text" className={'hex mono' + (invalid ? ' invalid' : '')} id={id} maxLength={7} spellCheck={false} autoComplete="off" disabled={disabled}
        aria-label={label + ' hex value'} value={draft ?? value}
        onChange={e => { setDraft(e.target.value); const v = normalizeHex(e.target.value, false); if (v) onValue(v); }}
        onBlur={() => { const v = draft == null ? null : normalizeHex(draft, true); if (v) onValue(v); setDraft(null); }}
      />
    </div>
  );
}

export function Check({ label, checked, onChange, id, className = 'check', children }: {
  label: ReactNode; checked: boolean; onChange: (on: boolean) => void; id?: string; className?: string; children?: ReactNode;
}) {
  return (
    <label className={className}>
      <input type="checkbox" id={id} checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>{label}{children}</span>
    </label>
  );
}

export function Segmented<T extends string>({ options, value, onPick, label }: {
  options: readonly (readonly [T, string, IconName?])[]; value: T; onPick: (v: T) => void; label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([v, text, icon]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onPick(v)}>{icon ? <Icon name={icon} /> : null}{text}</button>
      ))}
    </div>
  );
}

/* Collapsible inspector section. Open/closed state survives layer switches. */
const sectionOpen = new Map<string, boolean>();
export function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(sectionOpen.get(title) ?? true);
  return (
    <details className="property-section" open={open} onToggle={e => { const next = e.currentTarget.open; sectionOpen.set(title, next); setOpen(next); }}>
      <summary><span>{title}</span><Icon name="chevron" className="icon caret" /></summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

/* Dropdown built on <details>: one open at a time, closes on outside click, Escape or a pick. */
let closeOthers: (() => void) | null = null;
export function Menu({ summary, summaryClass = 'button', label, end = false, children }: {
  summary: ReactNode; summaryClass?: string; label?: string; end?: boolean; children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    if (closeOthers && closeOthers !== close) closeOthers();
    closeOthers = close;
    const outside = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('click', outside);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('click', outside); document.removeEventListener('keydown', key); if (closeOthers === close) closeOthers = null; };
  }, [open]);
  return (
    <details ref={ref} className={'menu' + (end ? ' menu-end' : '')} open={open} onToggle={e => setOpen(e.currentTarget.open)}>
      <summary className={summaryClass} aria-label={label}>{summary}</summary>
      <div className="menu-pop" onClick={e => { if ((e.target as HTMLElement).closest('button')) setOpen(false); }}>{children}</div>
    </details>
  );
}
export function MenuItem({ title, detail, onClick }: { title: string; detail: string; onClick: () => void }) {
  return <button type="button" onClick={onClick}><b>{title}</b><small>{detail}</small></button>;
}
