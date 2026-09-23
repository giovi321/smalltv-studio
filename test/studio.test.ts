import { beforeEach, describe, expect, it } from 'vitest';
import * as S from '../src/store/studio';
import type { TextLayer } from '../src/core/types';

const state = () => S.useStudio.getState();
const text = (i: number) => state().theme.layers[i] as TextLayer;

describe('studio store', () => {
  beforeEach(() => { S.load(S.blankProject()); });

  it('starts valid and packable', () => {
    expect(state().problems).toEqual([]);
    expect(state().packed).not.toBeNull();
  });
  it('merges keyed edits into one undo step', () => {
    S.edit(d => { (d.theme.layers[0] as TextLayer).value = 'A'; }, 'typing');
    S.edit(d => { (d.theme.layers[0] as TextLayer).value = 'AB'; }, 'typing');
    expect(state().history.length).toBe(1);
    S.undo();
    expect(text(0).value).toBe('{HH}:{MM}');
    S.redo();
    expect(text(0).value).toBe('AB');
  });
  it('adds, duplicates, reorders and removes layers', () => {
    expect(S.addLayer('shape')).toBe(true);
    S.duplicate();
    expect(state().theme.layers.map(l => l.id)).toEqual(['clock', 'date', 'shape-1', 'shape-2']);
    S.toBack();
    expect(state().theme.layers[0].id).toBe('shape-2');
    S.removeLayer(0);
    expect(state().theme.layers.length).toBe(3);
  });
  it('rejects duplicate layer IDs and keeps editor flags on rename', () => {
    expect(S.rename(0, 'date')).toMatch(/already/);
    S.toggleHidden(0);
    expect(S.rename(0, 'time')).toBe('');
    expect(state().hidden.has('time')).toBe(true);
  });
  it('rewrites text variables when a data field is renamed', () => {
    S.addSource();
    S.edit(d => { d.theme.data![0].url = 'https://example.com/x.json'; (d.theme.layers[0] as TextLayer).value = '{source1.value}'; });
    expect(state().problems).toEqual([]);
    S.edit(d => { d.theme.data![0].fields[0].id = 'temp'; S.renameDataRef(d, 'source1.value', 'source1.temp'); });
    expect(text(0).value).toBe('{source1.temp}');
    expect(state().problems).toEqual([]);
  });
  it('acknowledges unverified HTTPS for new sources', () => {
    S.addSource();
    S.edit(d => { d.theme.data![0].url = 'https://example.com/x.json'; });
    expect(state().theme.data![0].insecureTls).toBe(true);
    expect(state().problems).toEqual([]);
  });
  it('clamps translation to the firmware coordinate range', () => {
    S.select(0);
    S.nudge(10000, -10000);
    expect([text(0).x, text(0).y]).toEqual([479, -240]);
  });
});

describe('bindings in the store', () => {
  beforeEach(() => { S.load(S.blankProject()); });
  it('follow data field renames and drop when no longer applicable', () => {
    S.addSource();
    S.edit(d => { d.theme.data![0].url = 'http://192.168.1.2/x.json'; });
    S.addLayer('shape');
    const index = state().selected;
    S.setBinding(index, 'fill', { source: 'source1.value', stops: [{ at: 0, value: '#ff0000' }] });
    expect(state().problems).toEqual([]);
    S.edit(d => { d.theme.data![0].fields[0].id = 'level'; S.renameDataRef(d, 'source1.value', 'source1.level'); });
    expect(state().theme.layers[index].bind?.fill?.source).toBe('source1.level');
    S.edit(d => { const l = d.theme.layers[index]; if (l.type === 'shape') { l.stroke = '#ffffff'; delete l.fill; } S.pruneBindings(l); });
    expect(state().theme.layers[index].bind).toBeUndefined();
    expect(state().problems).toEqual([]);
  });
});
