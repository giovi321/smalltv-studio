/* "Send to TV": checks the device, installs the package and optionally activates it. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as D from '../device/device';
import * as S from '../store/studio';
import { useStudio } from '../store/studio';
import { Check } from './controls';
import { Icon, type IconName } from './Icon';
import { InstalledThemes } from './InstalledThemes';

const HOST_KEY = 'smalltv-studio:host', RESERVE = 16384;   // the firmware keeps 16 KiB free for settings
const kib = (n: number) => (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KiB';
function remember(host: string) { try { localStorage.setItem(HOST_KEY, host); } catch { /* convenience only */ } }
function recall() { try { return localStorage.getItem(HOST_KEY) || ''; } catch { return ''; } }

type StepKey = 'check' | 'remove' | 'upload' | 'activate';
type StepState = 'run' | 'done' | 'fail' | 'skip';
const STEPS: readonly [StepKey, string][] = [['check', 'Check the TV'], ['remove', 'Remove the old version'], ['upload', 'Upload the package'], ['activate', 'Use it on the TV']];
const GLYPH: Record<StepState, IconName> = { done: 'check', fail: 'alert', skip: 'minus', run: 'refresh' };
type Steps = Partial<Record<StepKey, { state: StepState; note?: string }>>;
type Message = { kind: '' | 'error' | 'success'; body: ReactNode } | null;
interface DeviceView { host: string; info: D.DeviceStatus; list: D.ThemeList }
interface Checked { host: string; kind: D.Transport; themes: D.InstalledTheme[]; freeBytes: number }

export function SendDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), hostInput = useRef<HTMLInputElement>(null), userInput = useRef<HTMLInputElement>(null);
  const theme = useStudio(s => s.theme), packed = useStudio(s => s.packed);
  const [host, setHost] = useState(recall), [user, setUser] = useState(''), [pass, setPass] = useState(''), [authOpen, setAuthOpen] = useState(false);
  const [activate, setActivate] = useState(true), [replace, setReplace] = useState(false);
  const [kind, setKind] = useState<D.Transport | null>(null), [device, setDevice] = useState<DeviceView | null>(null);
  const [steps, setSteps] = useState<Steps | null>(null), [message, setMessage] = useState<Message>(null), [running, setRunning] = useState(false);
  const stepsRef = useRef<Steps>({});

  const auth = (): D.Auth | null => (user || pass ? { user, pass } : null);
  const mark = (key: StepKey, state: StepState, note?: string) => { stepsRef.current = { ...stepsRef.current, [key]: { state, note } }; setSteps(stepsRef.current); };
  const resetSteps = (show: boolean) => { stepsRef.current = {}; setSteps(show ? {} : null); };
  const say = (body: ReactNode, kind: '' | 'error' | 'success' = '') => setMessage(body ? { kind, body } : null);

  useEffect(() => {
    const d = dialog.current; if (!d) return;
    if (open && !d.open) {
      d.showModal(); say(null); resetSteps(false); setDevice(null);
      void D.transport().then(k => {
        setKind(k);
        if (k === 'relay' && hostInput.current?.value) void check({ quiet: true });
        else if (!hostInput.current?.value) hostInput.current?.focus();
      });
    } else if (!open && d.open) d.close();
  }, [open]);

  /* ---------- errors ---------- */
  function showError(error: unknown) {
    const e = error as D.DeviceError, text = e.message || String(error);
    if (e.auth) { setAuthOpen(true); requestAnimationFrame(() => userInput.current?.focus()); }
    let body: ReactNode = text;
    if (e.status === 404 && /not found|Cannot GET/i.test(text)) body = 'This TV firmware has no theme support. Update it to a smalltv-mod release with theme clocks (the lean build has none).';
    say(<>
      <span><strong>Not sent. </strong>{body}</span>
    </>, 'error');
  }

  /* ---------- check ---------- */
  async function check({ quiet = false, showSteps = true } = {}): Promise<Checked | null> {
    const clean = D.cleanHost(hostInput.current?.value ?? host);
    if (!clean) { say('Enter the TV’s IP address, for example 192.168.1.42.', 'error'); hostInput.current?.focus(); return null; }
    setHost(clean);
    const transport = await D.transport();
    if (transport === 'direct') { setDevice(null); return { host: clean, kind: transport, themes: [], freeBytes: Infinity }; }
    if (showSteps) { resetSteps(true); mark('check', 'run'); say(null); }
    try {
      const [info, list] = await Promise.all([D.status(clean, auth()), D.list(clean, auth())]) as [D.DeviceStatus, D.ThemeList];
      remember(clean);
      setDevice({ host: clean, info, list });
      if (showSteps) mark('check', 'done', (info.variant ? info.variant + ' · ' : '') + 'firmware ' + (info.version || '?'));
      return { host: clean, kind: transport, themes: list.themes ?? [], freeBytes: list.freeBytes ?? 0 };
    } catch (error) {
      if (showSteps) mark('check', 'fail');
      setDevice(null);
      if (!quiet) showError(error);
      return null;
    }
  }

  /* ---------- go ---------- */
  async function go() {
    if (running) return;
    const s = S.useStudio.getState();
    if (s.problems.length || !s.packed) { say('Fix the listed issues before sending.', 'error'); return; }
    setRunning(true); say(null); resetSteps(false);
    try {
      const bytes = s.packed, id = s.theme.theme.id;
      const target = await check();
      if (!target) return;
      const existing = target.themes.find(t => t.id === id);
      if (target.kind === 'relay') {
        if (existing && !replace) { mark('remove', 'fail'); say(<span><strong>Not sent. </strong>A theme with the ID “{id}” is already on the TV. Tick “Replace”, or change the ID in the Theme tab.</span>, 'error'); return; }
        if (!existing && target.freeBytes - RESERVE < bytes.length) {
          mark('upload', 'fail');
          say(<span><strong>Not sent. </strong>The package is {kib(bytes.length)} but the TV has only {kib(Math.max(0, target.freeBytes - RESERVE))} of usable space. Remove a theme on the TV first.</span>, 'error');
          return;
        }
      }
      if (replace && (existing || target.kind === 'direct')) {
        mark('remove', 'run');
        try { await D.remove(target.host, id, auth()); mark('remove', 'done'); }
        catch (error) {
          mark('remove', 'fail');
          const text = (error as Error).message;
          say(<span><strong>Not sent. </strong>{/switch away/i.test(text) ? 'This theme is currently shown on the TV. On the TV’s web page switch to another display mode, save, then send again.' : text}</span>, 'error');
          return;
        }
      } else mark('remove', 'skip', existing ? 'Not replacing' : 'Nothing to replace');
      mark('upload', 'run');
      try { await D.install(target.host, bytes, id, auth()); mark('upload', 'done', target.kind === 'relay' ? kib(bytes.length) : 'Sent, not confirmed'); }
      catch (error) { mark('upload', 'fail'); showError(error); return; }
      if (activate) {
        mark('activate', 'run');
        if (target.kind === 'direct') await new Promise(r => setTimeout(r, 1200));   // let the TV finish the install first
        try { await D.select(target.host, id, auth()); mark('activate', 'done', target.kind === 'relay' ? '' : 'Sent, not confirmed'); }
        catch (error) { mark('activate', 'fail'); say(<span><strong>Installed, but not activated. </strong>{(error as Error).message}</span>, 'error'); return; }
      } else mark('activate', 'skip', 'Left as is');
      if (target.kind === 'relay') {
        await check({ quiet: true, showSteps: false });   // refresh the TV summary before announcing the result
        say(<span><strong>{activate ? 'Done. ' : 'Installed. '}</strong>{activate ? 'The TV now shows “' + s.theme.theme.name + '”.' : 'Choose it on the TV under Display → Theme clocks.'}</span>, 'success');
      } else {
        const url = 'http://' + target.host + '/';
        say(<span><strong>Sent. </strong>The browser cannot confirm it. Open the TV’s page to check: <a href={url} target="_blank" rel="noopener">{url}</a></span>, 'success');
      }
    } catch (error) { say(<span><strong>Not sent. </strong>{(error as Error).message}</span>, 'error'); }
    finally { setRunning(false); }
  }

  const same = device?.list.themes?.find(t => t.id === theme.theme.id);
  return (
    <dialog ref={dialog} className="send-dialog" aria-labelledby="send-title" onClose={onClose}>
      <form method="dialog" noValidate onSubmit={e => { e.preventDefault(); void go(); }}>
        <header>
          <h2 id="send-title">Send to SmallTV</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </header>
        <div className="send-body">
          <div className="send-summary"><b>{theme.theme.name}</b><span className="mono">{theme.theme.id}{packed ? ' · ' + kib(packed.length) : ''}</span></div>
          {kind && (
            <div className={'note ' + (kind === 'relay' ? 'ok' : 'warn')}>
              {kind === 'relay'
                ? <span>Connected through the local editor server. The TV’s answers are shown here.</span>
                : <span>Direct mode: the TV does not allow browsers to read its answers, so errors cannot be shown. For full feedback start the editor with <code>python3 serve.py</code>.</span>}
            </div>
          )}
          <label className="field">TV address
            <div className="send-host">
              <input ref={hostInput} type="text" inputMode="url" placeholder="192.168.1.42" autoComplete="off" spellCheck={false} aria-describedby="send-host-hint"
                value={host} onChange={e => { setHost(e.target.value); setDevice(null); }} />
              <button type="button" onClick={async () => { const d = await check(); if (d?.kind === 'direct') say('Direct mode cannot test the connection. Use Send to TV to try.'); }}>Check</button>
            </div>
            <span id="send-host-hint" className="hint">Shown on the TV at boot, and in your router’s device list.</span>
          </label>
          <details className="send-auth" open={authOpen} onToggle={e => setAuthOpen(e.currentTarget.open)}>
            <summary>The TV is password protected</summary>
            <div className="field-grid">
              <label className="field">User<input ref={userInput} autoComplete="off" spellCheck={false} value={user} onChange={e => setUser(e.target.value)} /></label>
              <label className="field">Password<input type="password" autoComplete="off" value={pass} onChange={e => setPass(e.target.value)} /></label>
            </div>
            <span className="hint">Only used for this request. Never saved.</span>
          </details>
          {device && (
            <div className="send-info">
              <div className="send-info-row"><b>SmallTV {device.info.variant ?? ''}</b><span className="mono">{device.host}</span></div>
              <div className="send-facts">
                <span>{device.list.themes?.length ?? 0} / 16 themes</span>
                <span>{kib(device.list.freeBytes ?? 0)} free</span>
                {device.list.selected && <span>active: {device.list.selected}</span>}
              </div>
              {same && <p className="hint warn">A theme with the ID “{theme.theme.id}” is already installed{same.valid === false ? ' (invalid)' : ''}. Tick “Replace” to overwrite it.</p>}
              <details className="send-auth">
                <summary>Installed themes ({device.list.themes?.length ?? 0})</summary>
                <InstalledThemes host={device.host} list={device.list} auth={auth} current={theme.theme.id} say={say}
                  onChanged={() => check({ quiet: true, showSteps: false })} />
              </details>
            </div>
          )}
          <Check label="Use this theme on the TV after installing" checked={activate} onChange={setActivate} />
          <Check className={'check replace' + (same ? ' attention' : '')} label="Replace the installed version with the same ID" checked={replace} onChange={setReplace}>
            <small>The old version is removed first, then the new one is uploaded.</small>
          </Check>
          {steps && (
            <ol className="send-steps">
              {STEPS.filter(([key]) => steps[key]).map(([key, label]) => {
                const step = steps[key]!;
                return <li key={key} className={'step ' + step.state}><Icon name={GLYPH[step.state]} /><span>{label}{step.note ? <small>{step.note}</small> : null}</span></li>;
              })}
            </ol>
          )}
          {message && <div className={'send-message ' + message.kind} role="status" aria-live="polite">{message.body}</div>}
        </div>
        <footer>
          <button type="button" className="quiet" onClick={onClose}>Close</button>
          <button type="submit" className="primary" disabled={running}><Icon name="send" />Send to TV</button>
        </footer>
      </form>
    </dialog>
  );
}
