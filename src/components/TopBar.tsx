import * as F from '../lib/files';
import * as S from '../store/studio';
import { useStudio } from '../store/studio';
import { Menu, MenuItem } from './controls';
import { Icon } from './Icon';

export function TopBar({ onSend }: { onSend: () => void }) {
  const canUndo = useStudio(s => s.history.length > 0), canRedo = useStudio(s => s.future.length > 0);
  const busy = useStudio(s => s.busy), ready = useStudio(s => s.problems.length === 0);
  return (
    <header className="topbar">
      <a className="brand" href="#" aria-label="SmallTV Studio" onClick={e => e.preventDefault()}>
        <Icon name="logo" className="icon brand-icon" />
        <span>SmallTV <strong>Studio</strong></span>
        <span className="tag">V1</span>
      </a>

      <div className="top-actions">
        <span className="privacy" title="Everything runs in this page. Files are never uploaded."><i />Local · offline</span>
        <div className="btn-group" role="group" aria-label="History">
          <button type="button" className="icon-btn" title="Undo (Ctrl/Cmd Z)" aria-label="Undo" disabled={!canUndo} onClick={S.undo}><Icon name="undo" /></button>
          <button type="button" className="icon-btn" title="Redo (Ctrl/Cmd Shift Z)" aria-label="Redo" disabled={!canRedo} onClick={S.redo}><Icon name="redo" /></button>
        </div>
        <button type="button" disabled={busy} onClick={() => { if (F.confirmReplace()) S.load(S.blankProject(), 'New theme. Add layers, then export the package.'); }}>
          <Icon name="plus" />New
        </button>

        <Menu summary={<>Examples<Icon name="chevron" className="icon caret" /></>}>
          {(Object.keys(F.EXAMPLES) as F.ExampleId[]).map(id => (
            <MenuItem key={id} title={F.EXAMPLES[id].name} detail={F.EXAMPLES[id].blurb} onClick={() => { if (F.confirmReplace()) F.loadExample(id); }} />
          ))}
        </Menu>

        <Menu summary={<><Icon name="upload" />Import<Icon name="chevron" className="icon caret" /></>}>
          <MenuItem title="Package or manifest" detail=".stheme or theme.json" onClick={F.openPackageDialog} />
          <MenuItem title="Source folder" detail="theme.json with its images" onClick={F.openFolderDialog} />
        </Menu>

        <button type="button" title="Install the theme on a SmallTV Pro over your network" disabled={busy || !ready} onClick={onSend}>
          <Icon name="send" />Send to TV
        </button>

        <div className="split">
          <button type="button" className="primary" disabled={busy || !ready} onClick={F.exportPackage}><Icon name="download" />Export .stheme</button>
          <Menu end summaryClass="button primary" label="More export options" summary={<Icon name="chevron" className="icon caret" />}>
            <MenuItem title="Manifest only" detail="theme.json, without images" onClick={F.saveManifest} />
            <MenuItem title="Preview image" detail="240 × 240 PNG of the current frame" onClick={F.savePreview} />
          </Menu>
        </div>
      </div>
    </header>
  );
}
