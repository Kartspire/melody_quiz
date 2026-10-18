// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createEvent } from 'effector';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useEditorImport } from './useEditorImport';
import { createAudioProject, createAudioEditorLane } from './audioProject';
import { $audioAssets, $audioProjects, $mediaTracks } from '../../model/core/state';
import { audioProjectReplaced } from './model';
import { decodeAudioAsset } from './audioBuffers';
import { addMediaTrackFileFx } from '../../model/media';
import { beginStateReplacement } from '../../model/core/writeAccess';
vi.mock('./audioBuffers', () => ({ decodeAudioAsset: vi.fn() }));
vi.mock('../../model/media', () => ({ addMediaTrackFileFx: vi.fn() }));
const seed = createEvent();
let project = createAudioProject();
const track = { id: 't', audioId: 'asset', name: 'Tone', createdAt: 1, updatedAt: 1 };
$audioProjects.on(seed, () => [project]);
$mediaTracks.on(seed, () => [track]);
$audioAssets.on(seed, () => [{ id: 'asset', blob: new Blob(), name: 'tone.wav', type: 'audio/wav', sha256: 'fixture', verified: true }]);
let root: Root;
let api: ReturnType<typeof useEditorImport>;
let currentId: string;
let resolve: (buffer: AudioBuffer) => void;
function Probe() { api = useEditorImport(currentId); return null; }
beforeEach(async () => {
  vi.clearAllMocks(); project = createAudioProject(); currentId = project.id; seed();
  vi.mocked(addMediaTrackFileFx).mockImplementation(async params => { params.assertCurrent?.(); return { track, status: 'existing' }; });
  vi.mocked(decodeAudioAsset).mockReturnValue(new Promise(r => { resolve = r; }));
  root = createRoot(document.createElement('div')); await act(async () => root.render(<Probe />));
});
afterEach(async () => { await act(async () => root.unmount()); });
async function start(files = [new File(['tone'], 'tone.wav')]) {
  let pending!: Promise<void>;
  await act(async () => { pending = api.importFiles(files, project.lanes[0].id, 1234); });
  return { pending };
}
it('uses the captured destination and preserves edits made during decode', async () => {
  const { pending } = await start();
  await act(async () => audioProjectReplaced({ ...project, name: 'Intervening edit', lanes: [...project.lanes, createAudioEditorLane(1)] }));
  await act(async () => { resolve({ duration: 2 } as AudioBuffer); await pending; });
  const result = $audioProjects.getState()[0];
  expect(result.name).toBe('Intervening edit'); expect(result.lanes).toHaveLength(2);
  expect(result.lanes[0].clips[0].timelineStartMs).toBe(1234);
});
it.each(['switch', 'replacement', 'lane removal', 'cancel'] as const)('rejects stale placement after %s', async action => {
  const { pending } = await start();
  await act(async () => {
    if (action === 'switch') { currentId = 'new'; root.render(<Probe />); }
    if (action === 'replacement') { const guard = beginStateReplacement(); guard.release(); }
    if (action === 'lane removal') audioProjectReplaced({ ...project, lanes: [createAudioEditorLane(0)] });
    if (action === 'cancel') api.cancel();
  });
  await act(async () => { resolve({ duration: 2 } as AudioBuffer); await pending; });
  expect($audioProjects.getState()[0].lanes.flatMap(l => l.clips)).toHaveLength(0);
});
it('imports sequentially, reports a bad file and continues with the next one', async () => {
  vi.mocked(decodeAudioAsset).mockResolvedValue({ duration: 2 } as AudioBuffer);
  vi.mocked(addMediaTrackFileFx).mockImplementation(async params => { params.assertCurrent?.(); if (params.fileName === 'bad.wav') throw new Error('Bad audio'); return { track, status: 'existing' }; });
  const { pending } = await start(['a.wav', 'bad.wav', 'c.wav'].map(name => new File(['tone'], name)));
  await act(async () => pending);
  expect($audioProjects.getState()[0].lanes[0].clips.map(c => c.timelineStartMs)).toEqual([1234, 3234]);
  expect(api.errors).toEqual(['bad.wav: Bad audio']); expect(api.busy).toBe(false);
});
