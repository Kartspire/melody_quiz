// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createEvent } from 'effector';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AudioEditorPage } from './AudioEditorPage';
import { $audioProjects, $mediaTracks, $audioAssets } from '../../model/core/state';
import { createAudioProject } from './audioProject';
import { decodeAudioAsset } from './audioBuffers';
import { beginStateReplacement } from '../../model/core/writeAccess';
vi.mock('./audioBuffers', () => ({ decodeAudioAsset: vi.fn(), clearDecodedAudioBufferCache: vi.fn() }));
const notify = vi.fn();
vi.mock('../../components/feedback/FeedbackProvider', () => ({ useFeedback: () => ({ notify, confirm: vi.fn() }) }));
vi.mock('./AudioEditorTimeline', () => ({ AudioEditorTimeline: () => null }));
const seed = createEvent();
$audioProjects.on(seed, () => [createAudioProject()]);
$mediaTracks.on(seed, () => [{ id: 't', audioId: 'a', name: 'tone', createdAt: 1, updatedAt: 1 }]);
$audioAssets.on(seed, () => [{ id: 'a', blob: new Blob(), name: 'tone.wav', type: 'audio/wav', sha256: 'test', verified: true }]);
let el: HTMLDivElement;
let root: Root;
let resolve: (value: AudioBuffer) => void;
beforeEach(async () => {
  vi.clearAllMocks();
  seed();
  vi.mocked(decodeAudioAsset).mockReturnValue(new Promise(r => { resolve = r; }));
  el = document.createElement('div'); document.body.append(el);
  root = createRoot(el);
  await act(async () => root.render(<AudioEditorPage />));
});
afterEach(async () => { await act(async () => root.unmount()); el.remove(); });
async function click(text: string) {
  await act(async () => { const button = [...el.querySelectorAll('button')].find(b => b.textContent === text)!; button.focus(); button.click(); });
}
async function finishDecode() { await act(async () => { resolve({ duration: 8 } as AudioBuffer); }); }
async function key(code: string, target: Element = document.activeElement!) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { code, ctrlKey: true, bubbles: true, cancelable: true })); });
}
it('preserves intervening edits and records the current project for undo', async () => {
  await click('Добавить'); await click('+ Дорожка');
  await finishDecode();
  expect($audioProjects.getState()[0].lanes).toHaveLength(2);
  expect($audioProjects.getState()[0].lanes[0].clips).toHaveLength(1);
  await key('KeyZ');
  expect($audioProjects.getState()[0].lanes).toHaveLength(2);
  expect($audioProjects.getState()[0].lanes[0].clips).toHaveLength(0);
});
it.each(['switch', 'unmount', 'import'] as const)('discards source decoding after %s', async (action) => {
  await click('Добавить');
  if (action === 'switch') await click('+ Новый монтаж');
  if (action === 'unmount') await act(async () => root.unmount());
  if (action === 'import') { const replacement = beginStateReplacement(); replacement.release(); }
  await finishDecode();
  expect($audioProjects.getState().flatMap(p => p.lanes.flatMap(l => l.clips))).toHaveLength(0);
});
it('undoes and redoes after duplicate button focus while preserving native input shortcuts', async () => {
  await click('Добавить'); await finishDecode(); await click('Дублировать');
  expect($audioProjects.getState()[0].lanes[0].clips).toHaveLength(2);
  await key('KeyZ'); expect($audioProjects.getState()[0].lanes[0].clips).toHaveLength(1);
  await key('KeyY', el.querySelector('button')!); expect($audioProjects.getState()[0].lanes[0].clips).toHaveLength(2);
  await key('KeyZ', el.querySelector('input')!); expect($audioProjects.getState()[0].lanes[0].clips).toHaveLength(2);
  expect(el.textContent).not.toContain('Crossfade');
});
