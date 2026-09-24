/* The themes already on the TV, with Use and Remove. Needs the relay: direct mode cannot read the list. */
import { useState, type ReactNode } from 'react';
import * as D from '../device/device';
import { Icon } from './Icon';

const kib = (n: number) => (n < 1024 ? n + ' B' : (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KiB');

export function InstalledThemes({ host, list, auth, current, onChanged, say }: {
  host: string; list: D.ThemeList; auth: () => D.Auth | null; current: string;
  onChanged: () => Promise<unknown>; say: (body: ReactNode, kind?: '' | 'error' | 'success') => void;
}) {
  const [busy, setBusy] = useState(''), [confirming, setConfirming] = useState('');
  const themes = list.themes ?? [];
  if (!themes.length) return <p className="hint">No theme installed yet.</p>;

  async function run(id: string, action: 'use' | 'remove') {
    setBusy(id); setConfirming('');
    try {
      if (action === 'use') await D.select(host, id, auth());
      else await D.remove(host, id, auth());
      await onChanged();
      say(<span><strong>{action === 'use' ? 'Done. ' : 'Removed. '}</strong>{action === 'use' ? 'The TV now shows “' + id + '”.' : '“' + id + '” is no longer on the TV.'}</span>, 'success');
    } catch (error) {
      const text = (error as Error).message;
      say(<span><strong>{action === 'use' ? 'Not activated. ' : 'Not removed. '}</strong>{/switch away/i.test(text)
        ? 'This theme is shown on the TV right now. Use another theme first, or switch the TV to another display mode on its web page.'
        : text}</span>, 'error');
    } finally { setBusy(''); }
  }

  return (
    <ul className="installed">
      {list.error && <li className="hint warn">The TV reports: {list.error}</li>}
      {themes.map(t => {
        const active = t.id === list.selected, valid = t.valid !== false;
        return (
          <li key={t.id} className={'installed-row' + (valid ? '' : ' invalid')}>
            <span className="installed-copy">
              <b>{t.name || t.id}</b>
              <small className="mono">
                {t.id}{t.version ? ' · v' + t.version : ''}{t.bytes != null ? ' · ' + kib(t.bytes) : ''}
                {active && <em className="badge">active</em>}{t.id === current && <em className="badge">this theme</em>}
              </small>
              {!valid && <small className="warn">{t.error || 'Invalid package'}</small>}
            </span>
            <span className="installed-actions">
              <button type="button" className="small" disabled={!!busy || !valid || active} title={valid ? 'Show this theme on the TV' : 'An invalid package cannot be used'} onClick={() => run(t.id, 'use')}>
                {busy === t.id ? <Icon name="refresh" className="icon spin" /> : null}Use
              </button>
              {confirming === t.id
                ? <button type="button" className="small danger" disabled={!!busy} onClick={() => run(t.id, 'remove')}>Confirm</button>
                : <button type="button" className="icon-btn mini danger" disabled={!!busy} title="Remove from the TV" aria-label={'Remove ' + t.id + ' from the TV'} onClick={() => setConfirming(t.id)}><Icon name="trash" /></button>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
