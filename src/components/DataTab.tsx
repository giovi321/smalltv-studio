import { useState } from 'react';
import * as C from '../core/core';
import type { DataField, DataSource } from '../core/types';
import * as S from '../store/studio';
import { useStudio } from '../store/studio';
import { Check, Field, NumberInput } from './controls';
import { Icon } from './Icon';

/* An ID input that commits on blur/Enter, so a half-typed ID never renames variables. */
function IdInput({ value, taken, what, maxLength, label, onCommit }: {
  value: string; taken: string[]; what: 'Source' | 'Field'; maxLength: number; label: string; onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const next = (draft ?? value).trim();
    setDraft(null);
    if (next === value) return;
    if (!C.idOK(next) || next.includes('.')) { S.notify(what + ' IDs use letters, digits, - or _ (max 24–32 characters, no dots).', true); return; }
    if (taken.includes(next)) { S.notify('This ' + what.toLowerCase() + ' ID is already used.', true); return; }
    onCommit(next);
  };
  return (
    <input value={draft ?? value} maxLength={maxLength} spellCheck={false} aria-label={label} autoComplete="off"
      onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }} />
  );
}

function FieldRow({ source, i, field, j }: { source: DataSource; i: number; field: DataField; j: number }) {
  const key = source.id + '.' + field.id, sample = useStudio(s => s.sample[key] ?? '');
  return (
    <div className="field-row">
      <div className="field-row-top">
        <code>{'{' + key + '}'}</code>
        <button type="button" className="icon-btn mini" title="Remove field" aria-label={'Remove field ' + key} disabled={source.fields.length <= 1} onClick={() => S.removeField(i, j)}><Icon name="close" /></button>
      </div>
      <div className="field-grid">
        <Field label="Field ID">
          <IdInput value={field.id} what="Field" maxLength={24} label="Field ID" taken={source.fields.filter(o => o !== field).map(o => o.id)}
            onCommit={next => S.edit(d => { d.theme.data![i].fields[j].id = next; S.renameDataRef(d, key, source.id + '.' + next); })} />
        </Field>
        <Field label="JSON path">
          <input value={field.path} maxLength={96} spellCheck={false} placeholder="main.temp" aria-label="JSON path" autoComplete="off"
            onChange={e => { const v = e.target.value; S.edit(d => { d.theme.data![i].fields[j].path = v; }, 'data:' + i + ':' + j + ':path'); }} />
        </Field>
      </div>
      <Field label="Preview value (editor only)">
        <input value={sample} placeholder="Preview value" aria-label={'Preview value for ' + key} autoComplete="off" onChange={e => S.setSample(key, e.target.value)} />
      </Field>
    </div>
  );
}

function SourceCard({ source, i }: { source: DataSource; i: number }) {
  const others = (useStudio(s => s.theme.data) ?? []).filter(o => o !== source).map(o => o.id);
  const [fetching, setFetching] = useState(false);
  const https = /^https:/i.test(source.url);
  const fetchLive = async () => {
    setFetching(true);
    try {
      const n = await S.fetchSample(i);
      S.notify(n ? 'Preview values filled from ' + n + ' field' + (n === 1 ? '' : 's') + '.' : 'The response has none of the declared paths.', !n);
    } catch (error) {
      S.notify('Could not fetch this URL: ' + (error as Error).message + ' The server may not allow browser requests (CORS).', true);
    } finally { setFetching(false); }
  };
  return (
    <article className="source-card">
      <header>
        <span className="source-title"><Icon name="database" />Source</span>
        <button type="button" className="icon-btn mini danger" title="Remove data source" aria-label={'Remove data source ' + source.id} onClick={() => S.removeSource(i)}><Icon name="trash" /></button>
      </header>
      <div className="field-grid wide-first">
        <Field label="Source ID">
          <IdInput value={source.id} what="Source" maxLength={32} label="Source ID" taken={others}
            onCommit={next => S.edit(d => { for (const f of source.fields) S.renameDataRef(d, source.id + '.' + f.id, next + '.' + f.id); d.theme.data![i].id = next; })} />
        </Field>
        <Field label="Interval">
          <NumberInput value={source.interval} min={10} max={86400} unit="s" onValue={v => S.edit(d => { d.theme.data![i].interval = v; }, 'data:' + i + ':interval')} />
        </Field>
      </div>
      <Field label="JSON URL">
        <input value={source.url} maxLength={200} spellCheck={false} placeholder="https://example.com/data.json" aria-label="JSON URL" autoComplete="off"
          onChange={e => {
            const v = e.target.value;
            S.edit(d => { const s = d.theme.data![i]; s.url = v; if (/^https:/i.test(v) && s.insecureTls == null) s.insecureTls = true; }, 'data:' + i + ':url');
          }} />
      </Field>
      {https && (
        <div className="tls-row">
          <Check label="Accept an unverified HTTPS certificate" checked={source.insecureTls === true}
            onChange={on => S.edit(d => { const s = d.theme.data![i]; if (on) s.insecureTls = true; else delete s.insecureTls; })} />
          <span className="hint">Required by the firmware for HTTPS: the device cannot verify certificates.</span>
        </div>
      )}
      <div className="eyebrow">Fields</div>
      {source.fields.map((f, j) => <FieldRow key={j} source={source} i={i} field={f} j={j} />)}
      <div className="btn-row">
        <button type="button" className="small" disabled={source.fields.length >= S.MAX_FIELDS} onClick={() => S.addField(i)}><Icon name="plus" />Add field</button>
        <button type="button" className="small" disabled={fetching} title="Request the URL from this browser and fill in the preview values (needs CORS)" onClick={fetchLive}>
          <Icon name="refresh" />Fetch live values
        </button>
      </div>
    </article>
  );
}

export function DataTab() {
  const list = useStudio(s => s.theme.data) ?? [];
  return (
    <>
      <div className="panel-heading"><h2>Data sources</h2><span className="badge">{list.length} / {S.MAX_SOURCES}</span></div>
      <p className="hint">The device fetches small JSON documents and exposes chosen fields as text variables such as <code>{'{weather.temp}'}</code>.</p>
      <div className="sources">
        {list.map((s, i) => <SourceCard key={i} source={s} i={i} />)}
        {!list.length && <p className="empty-state">No data source yet. Add one to show weather, prices or any small JSON value.</p>}
      </div>
      <button type="button" className="dashed" disabled={list.length >= S.MAX_SOURCES} onClick={S.addSource}><Icon name="plus" />Add data source</button>
      <p className="hint">Sample values are shown in the preview only. They are never exported.</p>
    </>
  );
}
