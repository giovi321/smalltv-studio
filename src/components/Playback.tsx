import * as S from '../store/studio';
import { useStudio } from '../store/studio';
import { Icon } from './Icon';

const toLocalInput = (t: number) => new Date(t).toISOString().slice(0, 19);

export function Playback() {
  const playing = useStudio(s => s.playing), elapsed = useStudio(s => s.elapsed), baseTime = useStudio(s => s.baseTime), synced = useStudio(s => s.synced);
  return (
    <section className="playback" aria-label="Playback">
      <div className="playback-row">
        <button type="button" className="icon-btn play-button" title="Play / pause (Space)" aria-label={playing ? 'Pause' : 'Play'} onClick={S.togglePlay}>
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <button type="button" className="icon-btn" title="Restart the simulation" aria-label="Restart" onClick={S.restart}><Icon name="restart" /></button>
        <input id="timeline" type="range" min={0} max={S.MAX_ELAPSED} step={1} value={elapsed} aria-label="Simulation position" onChange={e => S.seek(Number(e.target.value))} />
        <output id="elapsed" className="mono">{(elapsed / 1000).toFixed(2)} s</output>
        <button type="button" className="toggle" aria-pressed={synced} title="Before its first NTP sync, the device shows -- for every clock variable" onClick={S.toggleSynced}>
          <Icon name="refresh" />Clock synced
        </button>
        <label className="time-label">Simulated time
          <input
            type="datetime-local" step={1} disabled={!synced} defaultValue={toLocalInput(baseTime)}
            onChange={e => {
              const t = Date.parse(e.target.value + 'Z');
              if (Number.isFinite(t)) S.setBaseTime(t); else S.notify('Choose a valid date and time.', true);
            }}
          />
        </label>
      </div>
    </section>
  );
}
