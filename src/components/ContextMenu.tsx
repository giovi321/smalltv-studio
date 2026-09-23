/* Right-click layer actions, shared by the layer list and the preview. */
import { useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import * as S from '../store/studio';
import { useStudio } from '../store/studio';
import { Icon } from './Icon';

const useMenu = create<{ index: number; x: number; y: number } | null>()(() => null);
export function openContextMenu(index: number, x: number, y: number) {
  if (index < 0) { closeContextMenu(); return; }
  S.select(index);
  useMenu.setState({ index, x, y }, true);
}
export const closeContextMenu = () => useMenu.setState(null, true);

export function ContextMenu() {
  const menu = useMenu(), ref = useRef<HTMLDivElement>(null);
  const layer = useStudio(s => (menu ? s.theme.layers[menu.index] : null)), count = useStudio(s => s.theme.layers.length);
  const hidden = useStudio(s => !!layer && s.hidden.has(layer.id)), locked = useStudio(s => !!layer && s.locked.has(layer.id));
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const { offsetWidth: w, offsetHeight: h } = ref.current;
    setPos({ left: Math.max(4, Math.min(innerWidth - w - 8, menu.x)), top: Math.max(4, Math.min(innerHeight - h - 8, menu.y)) });
  }, [menu]);
  useLayoutEffect(() => {
    if (!menu) return;
    const outside = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) closeContextMenu(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') closeContextMenu(); };
    document.addEventListener('click', outside);
    document.addEventListener('keydown', key);
    addEventListener('blur', closeContextMenu);
    return () => { document.removeEventListener('click', outside); document.removeEventListener('keydown', key); removeEventListener('blur', closeContextMenu); };
  }, [menu]);
  if (!menu || !layer) return null;
  const run = (action: () => void) => () => { closeContextMenu(); action(); };
  return (
    <div ref={ref} className="context-menu" role="menu" style={pos}>
      <button type="button" role="menuitem" disabled={count >= S.MAX_LAYERS} onClick={run(() => S.duplicate())}><Icon name="copy" />Duplicate<kbd>Ctrl D</kbd></button>
      <button type="button" role="menuitem" disabled={menu.index >= count - 1} onClick={run(S.toFront)}><Icon name="front" />Bring to front<kbd>]</kbd></button>
      <button type="button" role="menuitem" disabled={menu.index <= 0} onClick={run(S.toBack)}><Icon name="back" />Send to back<kbd>[</kbd></button>
      <button type="button" role="menuitem" onClick={run(() => S.toggleHidden(menu.index))}><Icon name={hidden ? 'eye' : 'eye-off'} />{hidden ? 'Show in editor' : 'Hide in editor'}</button>
      <button type="button" role="menuitem" onClick={run(() => S.toggleLocked(menu.index))}><Icon name={locked ? 'unlock' : 'lock'} />{locked ? 'Unlock in editor' : 'Lock in editor'}</button>
      <hr />
      <button type="button" role="menuitem" className="danger" onClick={run(() => S.removeLayer())}><Icon name="trash" />Delete<kbd>Del</kbd></button>
    </div>
  );
}
