/* Status bar, toast and the keyboard shortcuts dialog. */
import { useEffect, useRef, useState } from 'react';
import { useStudio } from '../store/studio';
import { Icon } from './Icon';

export function StatusBar({ onShortcuts }: { onShortcuts: () => void }) {
  const problems = useStudio(s => s.problems.length), packed = useStudio(s => s.packed), notice = useStudio(s => s.notice);
  return (
    <footer className="statusbar">
      <span className={'validation' + (problems ? ' invalid' : '')}><i /><span>{problems ? problems + ' issue' + (problems === 1 ? '' : 's') + ' to fix' : 'Ready to export'}</span></span>
      <span id="status" className={notice.error ? 'error' : undefined} role="status" aria-live="polite">{notice.message.split('\n')[0]}</span>
      <span className="mono">{packed ? (packed.length / 1024).toFixed(1) + ' KiB · .stheme' : ''}</span>
      <button type="button" className="quiet small" title="Keyboard shortcuts (?)" onClick={onShortcuts}><Icon name="keyboard" />Shortcuts</button>
    </footer>
  );
}

export function Toast() {
  const notice = useStudio(s => s.notice);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!notice.serial) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), notice.error ? 8000 : 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  if (!visible) return null;
  return <div key={notice.serial} className={'toast' + (notice.error ? ' error' : '')} role="status" aria-live="polite">{notice.message}</div>;
}

const SHORTCUTS: readonly [string[], string][] = [
  [['Ctrl', 'Z'], 'Undo'], [['Ctrl', 'Shift', 'Z'], 'Redo'], [['Ctrl', 'D'], 'Duplicate layer'], [['Ctrl', 'S'], 'Export .stheme'],
  [['←', '↑', '→', '↓'], 'Nudge 1 px'], [['Shift', '+ arrows'], 'Nudge 10 px'], [['Del'], 'Delete layer'], [['[', ']'], 'Send back / bring forward'],
  [['Alt', '+ drag'], 'Move without snapping'], [['Shift', '+ drag handle'], 'Keep aspect ratio'], [['Space'], 'Play / pause'],
  [['G', '·', 'S'], 'Toggle grid · snapping'], [['+', '−'], 'Zoom'], [['Esc'], 'Deselect'], [['Right click'], 'Layer actions'],
];
const PLAIN = new Set(['+ arrows', '+ drag', '+ drag handle', '·', 'Right click']);
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal(); else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby="shortcuts-title" onClose={onClose}>
      <form method="dialog">
        <header><h2 id="shortcuts-title">Keyboard shortcuts</h2><button className="icon-btn" aria-label="Close"><Icon name="close" /></button></header>
        <dl className="shortcuts">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={what}>
              <dt>{keys.map((k, i) => (PLAIN.has(k) ? <span key={i}>{k}</span> : <kbd key={i}>{k}</kbd>))}</dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </form>
    </dialog>
  );
}
