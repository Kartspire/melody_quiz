// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAudioEditorPlayback } from './useAudioEditorPlayback';
import { createAudioProject, createAudioClip } from './audioProject';
import { playAudioProject, type AudioProjectPlayback } from './audioEngine';
import type { AudioAsset, MediaTrack } from '../../model/types';
vi.mock('./audioEngine', () => ({ playAudioProject: vi.fn() }));
const mediaTracks: MediaTrack[] = [];
const audioAssets: AudioAsset[] = [];
let root: Root;
let api: ReturnType<typeof useAudioEditorPlayback>;
let project = createAudioProject();
let resolve: (value: AudioProjectPlayback) => void;
let reject: (reason: Error) => void;
const onError = vi.fn();
function Probe() {
  api = useAudioEditorPlayback({ project, mediaTracks, audioAssets, onError });
  return null;
}
beforeEach(async () => {
  vi.clearAllMocks();
  project = createAudioProject();
  project.lanes[0].clips.push(createAudioClip('t', 8000));
  vi.mocked(playAudioProject).mockReturnValue(new Promise((yes, no) => { resolve = yes; reject = no; }));
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Probe />));
});
afterEach(async () => { await act(async () => root.unmount()); });
async function start() {
  let pending!: Promise<void>;
  await act(async () => { pending = api.toggle(); });
  return { pending };
}
it.each(['unmount', 'reset', 'seek', 'edit', 'switch'] as const)('cancels pending playback on %s', async (action) => {
  const { pending } = await start();
  expect(api.isStarting).toBe(true);
  await act(async () => {
    if (action === 'unmount') root.unmount();
    if (action === 'reset') api.reset();
    if (action === 'seek') api.seek(1000);
    if (action === 'edit' || action === 'switch') {
      project = { ...project, id: action === 'switch' ? 'other' : project.id, name: 'Edited' };
      root.render(<Probe />);
    }
  });
  const stop = vi.fn();
  await act(async () => { resolve({ stop }); await pending; });
  expect(stop).toHaveBeenCalledOnce();
  expect(api.isPlaying).toBe(false);
});
it('cancels a second Play without launching another audio graph', async () => {
  const { pending } = await start();
  await act(async () => { await api.toggle(); });
  expect(playAudioProject).toHaveBeenCalledTimes(1);
  const stop = vi.fn();
  await act(async () => { resolve({ stop }); await pending; });
  expect(stop).toHaveBeenCalledOnce();
  expect(api.isStarting).toBe(false);
});
it('starts normally and stops the active graph on pause', async () => {
  const { pending } = await start();
  const stop = vi.fn();
  await act(async () => { resolve({ stop }); await pending; });
  expect(api.isPlaying).toBe(true);
  expect(api.isStarting).toBe(false);
  await act(async () => { await api.toggle(); });
  expect(stop).toHaveBeenCalledOnce();
  expect(api.isPlaying).toBe(false);
});
it('ignores errors from a cancelled request', async () => {
  const { pending } = await start();
  await act(async () => api.reset());
  await act(async () => { reject(new Error('decode failed')); await pending; });
  expect(onError).not.toHaveBeenCalled();
});
it('reports a current request failure and allows retry', async () => {
  const { pending } = await start();
  await act(async () => { reject(new Error('decode failed')); await pending; });
  expect(onError).toHaveBeenCalledOnce();
  expect(api.isStarting).toBe(false);
  vi.mocked(playAudioProject).mockResolvedValue({ stop: vi.fn() });
  await act(async () => { await api.toggle(); });
  expect(api.isPlaying).toBe(true);
});
