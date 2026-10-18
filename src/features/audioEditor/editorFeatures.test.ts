import { describe, expect, it } from 'vitest';
import { createAudioClip, createAudioEditorLane, createAudioProject, duplicateAudioProject } from './audioProject';
import { getClipPlaybackWindow, resolveRenderRange } from './audioEngine';
import { shiftClipLanes, snapSelectionDelta, snapTimelinePosition } from './timelineEditing';
import { analyzeStereo48k, normalizationGain } from './loudness';
import { rangeExportNames, safeAudioName } from './editorExport';
import { assertValidPersistedState } from '../../model/validation';
import type { PersistedState } from '../../model/types';
import { persistedStateImported } from '../../model/app/storage';
import { audioProjectAdded, audioProjectDeleted } from './model';
import { $editorSessions, editorHistory, editorSessionChanged } from './editorSession';

describe('editor feature domain', () => {
  it('duplicates logical IDs while retaining source references and saved ranges', () => {
    const p = createAudioProject('Montage'); p.masterGainDb = -3;
    p.lanes[0].clips = [createAudioClip('original', 1000)];
    p.markers = [{ id: 'm', label: 'M', positionMs: 500 }];
    p.ranges = [{ id: 'r', name: 'R', startMs: 100, endMs: 600 }];
    const copy = duplicateAudioProject(p);
    expect(copy.id).not.toBe(p.id); expect(copy.lanes[0].id).not.toBe(p.lanes[0].id);
    expect(copy.lanes[0].clips[0].id).not.toBe(p.lanes[0].clips[0].id);
    expect(copy.lanes[0].clips[0].sourceTrackId).toBe('original');
    expect(copy.ranges?.[0].id).not.toBe('r'); expect(copy.markers?.[0].id).not.toBe('m');
    expect(copy.masterGainDb).toBe(-3);
  });
  it('bounds a source window by both range end and playback rate', () => {
    const c = { ...createAudioClip('t', 10000, 1000), sourceStartMs: 2000, playbackRate: 2 };
    expect(getClipPlaybackWindow(c, 2000, 10000, 3000)).toEqual({ playFromMs: 2000, sourceOffsetMs: 4000, sourceDurationMs: 2000, timelineDurationMs: 1000 });
    expect(getClipPlaybackWindow(c, 0, 10000, 500)).toBeNull();
  });
  it('can select a short export range beyond ten minutes in a long project', () => {
    const p = createAudioProject(); p.lanes[0].clips = [createAudioClip('t', 10000, 1200000)];
    expect(resolveRenderRange(p, { startMs: 1201000, endMs: 1203000 })).toEqual({ startMs: 1201000, endMs: 1203000 });
    expect(() => resolveRenderRange(p, { startMs: 10, endMs: 9 })).toThrow();
  });
  it('translates groups vertically without collapsing lane spacing at boundaries', () => {
    const p = createAudioProject(); p.lanes.push(createAudioEditorLane(1), createAudioEditorLane(2), createAudioEditorLane(3));
    const a = createAudioClip('t', 1000), b = createAudioClip('t', 1000, 700);
    p.lanes[0].clips = [a]; p.lanes[2].clips = [b];
    const moved = shiftClipLanes(p, [a.id, b.id], 20);
    expect(moved.lanes.map(l => l.clips.map(c => c.id))).toEqual([[], [a.id], [], [b.id]]);
    expect(moved.lanes[3].clips[0].timelineStartMs).toBe(700);
  });
  it('Alt bypasses grid and nearby edges but retains timeline bounds', () => {
    const p = createAudioProject(); const c = createAudioClip('t', 1000, 1000); p.lanes[0].clips = [c];
    expect(snapTimelinePosition(p, 1023, { pixelsPerSecond: 36, disabled: true }).valueMs).toBe(1023);
    expect(snapSelectionDelta(p, [c.id], 23, { pixelsPerSecond: 36, disabled: true }).deltaMs).toBe(23);
    expect(snapSelectionDelta(p, [c.id], -9000, { pixelsPerSecond: 36, disabled: true }).deltaMs).toBe(-1000);
  });
  it('keeps history outside components and resets it together with sessions on import/delete', () => {
    const p = createAudioProject(); audioProjectAdded(p); editorHistory.push(p);
    editorSessionChanged({ id: p.id, patch: { zoom: 80, playheadMs: 3456 } });
    expect(editorHistory.undo({ ...p, name: 'edit' })?.name).toBe(p.name);
    expect(editorHistory.redo(p)?.name).toBe('edit');
    const state: PersistedState = { version: 5, audioProjects: [p], audioAssets: [], mediaTracks: [], games: [], sessions: [], songs: [], activeGameId: null };
    persistedStateImported(state);
    expect(editorHistory.status(p.id).canUndo).toBe(false); expect($editorSessions.getState()[p.id]).toBeUndefined();
    editorHistory.push(p); editorSessionChanged({ id: p.id, patch: { zoom: 90 } }); audioProjectDeleted(p.id);
    expect(editorHistory.status(p.id).canUndo).toBe(false); expect($editorSessions.getState()[p.id]).toBeUndefined();
  });
  it('validates optional new fields without rejecting old v5 projects', () => {
    const p = createAudioProject(); delete p.masterGainDb; delete p.ranges;
    const state: PersistedState = { version: 5, audioProjects: [p], audioAssets: [], mediaTracks: [], games: [], sessions: [], songs: [], activeGameId: null };
    expect(() => assertValidPersistedState(state)).not.toThrow();
    p.masterGainDb = NaN; expect(() => assertValidPersistedState(state)).toThrow();
    p.masterGainDb = -2; p.ranges = [{ id: 'r', name: 'Test', startMs: 100, endMs: 90 }];
    expect(() => assertValidPersistedState(state)).toThrow();
    p.ranges[0].endMs = 200; expect(() => assertValidPersistedState(state)).not.toThrow();
    p.ranges.push({ ...p.ranges[0] }); expect(() => assertValidPersistedState(state)).toThrow();
  });
  it('generates safe unique names for duplicate ranges and repeated library export', () => {
    const ranges = ['A/B', 'A:B'].map((name, i) => ({ id: String(i), name, startMs: 0, endMs: 1000 }));
    expect(rangeExportNames('Mix', ranges, ['Mix — A-B'])).toEqual(['Mix — A-B (2).wav', 'Mix — A-B (3).wav']);
    expect(safeAudioName('CON')).toBe('_CON'); expect(safeAudioName('..')).toBe('audio-mix');
  });
});
describe('loudness analysis', () => {
  const tone = (amplitude: number, seconds = 1) => Float32Array.from({ length: 48000 * seconds }, (_, i) => amplitude * Math.sin(2 * Math.PI * 997 * i / 48000));
  it('matches the stereo 997 Hz calibration and gain scaling', () => {
    const a = tone(0.1); const result = analyzeStereo48k([a, a]);
    expect(result.lufs).toBeCloseTo(-20, 1); expect(result.peakDb).toBeCloseTo(-20, 2);
    const b = tone(0.2); expect(analyzeStereo48k([b, b]).lufs! - result.lufs!).toBeCloseTo(6.0206, 2);
  });
  it('excludes long silence via the absolute and relative gates', () => {
    const signal = new Float32Array(480000); signal.set(tone(0.1));
    expect(analyzeStereo48k([signal, signal]).lufs).toBeCloseTo(-20.7, 0);
  });
  it('does not invent LUFS for silence or a too-short selection', () => {
    expect(analyzeStereo48k([new Float32Array(48000), new Float32Array(48000)]).lufs).toBeNull();
    const a = tone(0.1, 0.1); expect(analyzeStereo48k([a, a]).lufs).toBeNull();
    expect(() => normalizationGain({ peakDb: null, lufs: null, durationMs: 1000 }, 0, 'peak')).toThrow(/тишину/);
  });
  it('reports a peak-constrained LUFS target and handles master gain limits', () => {
    const result = normalizationGain({ peakDb: -2, lufs: -25, durationMs: 1000 }, 0, 'lufs', -16);
    expect(result).toMatchObject({ gainDb: 1, limited: true, peakDb: -1, lufs: -24 });
    expect(normalizationGain({ peakDb: -40, lufs: -42, durationMs: 1000 }, 0, 'peak')).toMatchObject({ gainDb: 24, limited: true });
  });
});
