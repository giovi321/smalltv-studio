import * as S from '../store/studio';
import { useStudio } from '../store/studio';
import { ColorInput } from './controls';

const kib = (n: number) => (n / 1024).toFixed(1) + ' KiB';
const META = [['name', 'Name', 96], ['id', 'ID', 48], ['version', 'Version', 32], ['author', 'Author', 96]] as const;
type MetaKey = (typeof META)[number][0];

function Meter({ label, value, max, text, warn = 0.8 }: { label: string; value: number; max: number; text: string; warn?: number }) {
  const ratio = max ? Math.min(1, value / max) : 0, cls = value > max ? ' over' : ratio >= warn ? ' warn' : '';
  return (
    <div className="budget-row">
      <div className="budget-head"><span>{label}</span><span className="mono">{text}</span></div>
      <div className={'meter' + cls} role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}><i style={{ width: Math.round(ratio * 100) + '%' }} /></div>
    </div>
  );
}

export function ThemeTab() {
  const meta = useStudio(s => s.theme.theme), background = useStudio(s => s.theme.display.background);
  const b = S.budget(useStudio(s => s.theme), useStudio(s => s.packed));
  const input = (key: MetaKey) => {
    const [, label, max] = META.find(m => m[0] === key)!;
    return (
      <label className="field">{label}
        <input value={meta[key]} maxLength={max} spellCheck={key === 'id' ? false : undefined} autoComplete="off"
          onChange={e => { const v = e.target.value; S.edit(d => { d.theme.theme[key] = v; }, 'theme:' + key); }} />
      </label>
    );
  };
  return (
    <>
      <div className="panel-heading"><h2>Theme</h2></div>
      <div className="form">
        {input('name')}
        <div className="field-grid wide-first">{input('id')}{input('version')}</div>
        {input('author')}
        <div className="field">
          <span className="field-label">Screen background</span>
          <ColorInput value={background} label="Screen background" id="background" onValue={v => S.edit(d => { d.theme.display.background = v; }, 'background')} />
        </div>
        <p className="hint">The ID becomes the file name on the device: <code>/themes/{meta.id || '…'}.stheme</code></p>
      </div>
      <div className="panel-heading spaced"><h2>Budget</h2></div>
      <div className="budget">
        <Meter label="Package" value={b.packageBytes ?? 0} max={b.packageMax} text={b.packageBytes == null ? 'fix issues to measure' : kib(b.packageBytes) + ' / 3 MiB'} />
        <Meter label="Manifest" value={b.manifest} max={b.manifestMax} text={kib(b.manifest) + ' / 16 KiB'} />
        <Meter label="Layers" value={b.layers} max={b.layersMax} text={b.layers + ' / ' + b.layersMax} warn={0.9} />
        <Meter label="Package entries" value={b.entries} max={b.entriesMax} text={b.entries + ' / ' + b.entriesMax} />
        <Meter label="Data sources" value={b.sources} max={b.sourcesMax} text={b.sources + ' / ' + b.sourcesMax} warn={1} />
      </div>
      <p className="hint">Limits come from the firmware: 16 KiB manifest, 32 layers, 256 package entries, 3 MiB package.</p>
    </>
  );
}
