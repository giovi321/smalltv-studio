/* Application shell: layout, keyboard shortcuts, file drops and the playback clock. */
import { useEffect, useState } from 'react';
import * as F from './lib/files';
import * as S from './store/studio';
import { useStudio } from './store/studio';
import { ContextMenu } from './components/ContextMenu';
import { ShortcutsDialog, StatusBar, Toast } from './components/Feedback';
import { IconSprite } from './components/Icon';
import { Inspector } from './components/Inspector';
import { LeftPanel } from './components/LeftPanel';
import { SendDialog } from './components/SendDialog';
import { isTyping, Stage } from './components/Stage';
import { TopBar } from './components/TopBar';

const FRAME_MS = 1000 / 15;   // the firmware redraws at most 15 times per second

function usePlaybackClock() {
  useEffect(() => {
    let frame = 0, last = 0;
    const loop = (now: number) => {
      if (now - last >= FRAME_MS) { last = now; S.tick(now); }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);
}

function useShortcuts(openShortcuts: () => void, modalOpen: boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = S.useStudio.getState();
      if (s.busy || modalOpen) return;
      const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase(), active = document.activeElement as HTMLElement | null;
      if (mod && key === 's') { e.preventDefault(); F.exportPackage(); return; }
      if (isTyping()) return;
      if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) S.redo(); else S.undo(); return; }
      if (mod && key === 'y') { e.preventDefault(); S.redo(); return; }
      if (mod && key === 'd') { e.preventDefault(); S.duplicate(); return; }
      if (mod || e.altKey) return;
      const onButton = active?.tagName === 'BUTTON' || active?.tagName === 'SUMMARY';
      if (key === ' ' && !onButton) { e.preventDefault(); S.togglePlay(); return; }
      if (key === 'g') { S.toggleGrid(); return; }
      if (key === 's') { S.toggleSnap(); return; }
      if (key === '?') { openShortcuts(); return; }
      if (key === 'escape') { if (s.selected >= 0) S.select(-1); return; }
      const l = S.selectedLayer(s);
      if (!l) return;
      if (key === 'delete' || key === 'backspace') { e.preventDefault(); S.removeLayer(); return; }
      if (key === '[') { S.moveLayer(-1); return; }
      if (key === ']') { S.moveLayer(1); return; }
      const step = ({ arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] } as Record<string, [number, number]>)[key];
      // Arrow keys nudge, except on menus and in the layer list, where they belong to the focused row.
      if (step && (!onButton || (active?.tagName === 'BUTTON' && !active.closest('.layer')))) {
        e.preventDefault();
        if (s.locked.has(l.id)) { S.notify('This layer is locked.'); return; }
        const amount = e.shiftKey ? 10 : 1;
        S.nudge(step[0] * amount, step[1] * amount);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openShortcuts, modalOpen]);
}

/* Drop a package, a manifest or images anywhere on the page. */
function useFileDrop() {
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setDropping(true); } };
    const leave = (e: DragEvent) => { if (hasFiles(e) && --depth <= 0) { depth = 0; setDropping(false); } };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; setDropping(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      const packages = files.filter(F.isPackage), images = files.filter(F.isImage);
      if (packages.length === 1 && !images.length) { if (F.confirmReplace()) void F.operation(() => F.openFile(packages[0])); }
      else if (images.length) {
        if (!S.addLayer(images.length > 1 ? 'animation' : 'image')) { S.notify('This theme already has 32 layers.', true); return; }
        void F.operation(() => F.importAssets(images));
      } else S.notify('Drop a .stheme, a theme.json or PNG / JPEG / WebP images.', true);
    };
    addEventListener('dragenter', enter); addEventListener('dragleave', leave); addEventListener('dragover', over); addEventListener('drop', drop);
    return () => { removeEventListener('dragenter', enter); removeEventListener('dragleave', leave); removeEventListener('dragover', over); removeEventListener('drop', drop); };
  }, []);
  useEffect(() => { document.body.classList.toggle('dropping', dropping); }, [dropping]);
}

export function App() {
  const [shortcuts, setShortcuts] = useState(false), [sending, setSending] = useState(false);
  const busy = useStudio(s => s.busy), dirty = useStudio(s => s.dirty), name = useStudio(s => s.theme.theme.name);
  usePlaybackClock();
  useShortcuts(() => setShortcuts(true), shortcuts || sending);
  useFileDrop();
  useEffect(() => { F.loadExample('pixel-room'); }, []);
  useEffect(() => { document.title = (dirty ? '• ' : '') + (name || 'Untitled') + ' — SmallTV Studio'; }, [dirty, name]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => { if (S.useStudio.getState().dirty) { e.preventDefault(); e.returnValue = ''; } };
    addEventListener('beforeunload', guard);
    return () => removeEventListener('beforeunload', guard);
  }, []);
  return (
    <>
      <IconSprite />
      <TopBar onSend={() => { if (S.useStudio.getState().problems.length) S.notify('Fix the listed issues before sending.', true); else setSending(true); }} />
      <main className="workspace" inert={busy}>
        <LeftPanel />
        <Stage />
        <Inspector />
      </main>
      <StatusBar onShortcuts={() => setShortcuts(true)} />
      <ContextMenu />
      <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
      <SendDialog open={sending} onClose={() => setSending(false)} />
      <Toast />
    </>
  );
}
