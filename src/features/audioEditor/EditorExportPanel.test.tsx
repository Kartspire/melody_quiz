// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EditorExportPanel } from './EditorExportPanel';
import { createAudioProject } from './audioProject';
import { renderAudioProjectToWav } from './audioEngine';
import { addMediaTrackFileFx } from '../../model/media';
import { beginStateReplacement } from '../../model/core/writeAccess';
vi.mock('./audioEngine', () => ({ renderAudioProjectToWav: vi.fn() }));
vi.mock('../../model/media', () => ({ addMediaTrackFileFx: vi.fn() }));
const project = createAudioProject('Batch');
project.ranges = [{ id: 'a', name: 'A', startMs: 1000, endMs: 2000 }, { id: 'b', name: 'B', startMs: 3000, endMs: 5000 }];
let root: Root, el: HTMLDivElement;
let resolve: (blob: Blob) => void;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(renderAudioProjectToWav).mockReturnValue(new Promise(r => { resolve = r; }));
  vi.mocked(addMediaTrackFileFx).mockResolvedValue({ track: { id: 't', name: 'T', audioId: 'a', createdAt: 1, updatedAt: 1 }, status: 'created' });
  el = document.createElement('div'); root = createRoot(el);
  await act(async () => root.render(<EditorExportPanel project={project} tracks={[]} assets={[]} range={null} onSelectRange={vi.fn()} onChange={vi.fn()} />));
});
afterEach(async () => { await act(async () => root.unmount()); });
async function click(label: string) { await act(async () => { [...el.querySelectorAll('button')].find(b => b.textContent === label)!.click(); }); }
it('cancels the active render without saving it or starting the next range', async () => {
  await click('Выбрать все'); await click('Выбранные → медиатека'); await click('Остановить экспорт');
  await act(async () => resolve(new Blob()));
  expect(addMediaTrackFileFx).not.toHaveBeenCalled(); expect(renderAudioProjectToWav).toHaveBeenCalledOnce();
  expect(el.textContent).toContain('Остановлено');
});
it('keeps completed files when cancelling a later range', async () => {
  vi.mocked(renderAudioProjectToWav).mockResolvedValueOnce(new Blob());
  await click('Выбрать все'); await click('Выбранные → медиатека');
  expect(addMediaTrackFileFx).toHaveBeenCalledOnce(); expect(renderAudioProjectToWav).toHaveBeenCalledTimes(2);
  await click('Остановить экспорт'); await act(async () => resolve(new Blob()));
  expect(addMediaTrackFileFx).toHaveBeenCalledOnce();
});
it('does not save a render into a replaced application state', async () => {
  await click('Выбрать все'); await click('Выбранные → медиатека');
  const replacement = beginStateReplacement(); replacement.release();
  await act(async () => resolve(new Blob()));
  expect(addMediaTrackFileFx).not.toHaveBeenCalled(); expect(renderAudioProjectToWav).toHaveBeenCalledOnce();
  expect(el.textContent).toContain('Данные были импортированы');
});
