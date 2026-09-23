import type { KeyboardEvent } from 'react';
import * as S from '../store/studio';
import { useStudio, type Tab } from '../store/studio';
import { DataTab } from './DataTab';
import { Icon, type IconName } from './Icon';
import { LayersTab } from './LayersTab';
import { ThemeTab } from './ThemeTab';

const TABS: readonly [Tab, string, IconName][] = [['layers', 'Layers', 'layers'], ['theme', 'Theme', 'sliders'], ['data', 'Data', 'database']];

export function LeftPanel() {
  const tab = useStudio(s => s.tab);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(i + step + TABS.length) % TABS.length][0];
    S.setTab(next);
    document.getElementById('tab-btn-' + next)?.focus();
  };
  return (
    <aside className="left-panel" aria-label="Theme structure">
      <div className="tabs" role="tablist" aria-label="Theme sections">
        {TABS.map(([id, label, icon], i) => (
          <button key={id} type="button" role="tab" id={'tab-btn-' + id} aria-selected={tab === id} aria-controls={'tab-' + id} tabIndex={tab === id ? 0 : -1}
            onClick={() => S.setTab(id)} onKeyDown={e => onKey(e, i)}>
            <Icon name={icon} />{label}
          </button>
        ))}
      </div>
      <section className="tab-panel" id={'tab-' + tab} role="tabpanel" aria-labelledby={'tab-btn-' + tab}>
        {tab === 'layers' ? <LayersTab /> : tab === 'theme' ? <ThemeTab /> : <DataTab />}
      </section>
    </aside>
  );
}
