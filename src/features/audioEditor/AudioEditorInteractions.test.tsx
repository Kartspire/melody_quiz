// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createEvent } from 'effector';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AudioEditorPage } from './AudioEditorPage';
import { createAudioClip, createAudioProject } from './audioProject';
import { $audioProjects, $audioAssets, $mediaTracks } from '../../model/core/state';

vi.mock('./audioBuffers', () => ({
  decodeAudioAsset: vi.fn(async () => ({ duration: 10 })),
  clearDecodedAudioBufferCache: vi.fn(),
}));
vi.mock('./WaveformCanvas', () => ({ WaveformCanvas: () => null }));
vi.mock('../../components/feedback/FeedbackProvider', () => ({
  useFeedback: () => ({ notify: vi.fn(), confirm: vi.fn() }),
}));

const seed = createEvent();
$audioProjects.on(seed, () => {
  const project = createAudioProject();
  project.lanes[0].clips = [
    { ...createAudioClip('t', 10_000), id: 'a', fadeInMs: 1000 },
    { ...createAudioClip('t', 10_000, 12_000), id: 'b', fadeInMs: 2000 },
  ];
  return [project];
});
$mediaTracks.on(seed, () => [
  { id: 't', audioId: 'asset', name: 'Tone', createdAt: 1, updatedAt: 1 },
  { id: 't2', audioId: 'asset', name: 'Second tone', createdAt: 1, updatedAt: 1 },
]);
$audioAssets.on(seed, () => [{ id: 'asset', blob: new Blob(), name: 'tone.wav', type: 'audio/wav', sha256: 'test', verified: true }]);

let el: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  URL.createObjectURL = vi.fn(() => 'blob:fixture');
  URL.revokeObjectURL = vi.fn();
  seed();
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () => root.render(<AudioEditorPage />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  el.remove();
});

function clips() { return $audioProjects.getState()[0].lanes[0].clips; }
function clipNode(id: string) { return el.querySelector<HTMLElement>(`[data-clip-id="${id}"]`)!; }
async function pointer(target: Element, type: string, clientX = 0) {
  await act(async () => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX })); });
}
async function selectClip(id: string) {
  await pointer(clipNode(id), 'pointerdown');
  await pointer(clipNode(id), 'pointerup');
}
async function editFade(value: string) {
  const input = el.querySelector<HTMLInputElement>('input[aria-label="Fade in, сек"]')!;
  await act(async () => input.focus());
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
async function undo() {
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, bubbles: true })); });
}

it('selects a source from the search results without the page blur handler closing them early', async () => {
  const input = el.querySelector<HTMLInputElement>('[role="combobox"]')!;
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'second');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const option = el.querySelector<HTMLButtonElement>('[role="option"]')!;
  expect(option.textContent).toBe('Second tone');
  await pointer(option, 'pointerdown');
  expect(option.isConnected).toBe(true);
  await act(async () => option.click());
  expect(input.value).toBe('Second tone');
  expect(input.getAttribute('aria-expanded')).toBe('false');
  await act(async () => { [...el.querySelectorAll('button')].find(b => b.textContent === 'Добавить')!.click(); });
  expect(clips().at(-1)?.sourceTrackId).toBe('t2');
});

it('chooses sources with the keyboard and restores the choice when an unmatched search is cancelled', async () => {
  const input = el.querySelector<HTMLInputElement>('[role="combobox"]')!;
  await act(async () => input.focus());
  for (const key of ['ArrowDown', 'Enter']) {
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
  }
  expect(input.value).toBe('Second tone');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'missing');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(el.querySelector('[role="status"]')?.textContent).toBe('Ничего не найдено');
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(input.value).toBe('Second tone');
  expect(el.querySelector('[role="listbox"]')).toBeNull();
});

it('commits a draft to its original clip before selecting another clip', async () => {
  await selectClip('a');
  const input = await editFade('3,5');
  await selectClip('b');
  await act(async () => input.blur());
  expect(clips().map(c => c.fadeInMs)).toEqual([3500, 2000]);
  expect(el.querySelector<HTMLInputElement>('input[aria-label="Fade in, сек"]')!.value).toBe('2');
  await undo();
  expect(clips().map(c => c.fadeInMs)).toEqual([1000, 2000]);
});

it('includes the committed draft in a subsequent drag snapshot and undo', async () => {
  await selectClip('a');
  await editFade('3');
  const node = clipNode('b');
  await pointer(node, 'pointerdown', 0);
  await pointer(node, 'pointermove', 72);
  await pointer(node, 'pointerup', 72);
  expect(clips().map(c => [c.timelineStartMs, c.fadeInMs])).toEqual([[0, 3000], [14_000, 2000]]);
  await undo();
  expect(clips().map(c => [c.timelineStartMs, c.fadeInMs])).toEqual([[0, 3000], [12_000, 2000]]);
  await undo();
  expect(clips()[0].fadeInMs).toBe(1000);
});

it.each(['move', 'left', 'right', 'fade-in', 'fade-out'])('restores a %s gesture returned to its starting point without adding an undo entry', async (action) => {
  await selectClip('a');
  const input = await editFade('3');
  await act(async () => input.blur());
  const before = structuredClone(clips());
  const selector = action === 'move' ? null : action === 'left' || action === 'right'
    ? `.audio-editor-trim-handle--${action}` : `.audio-editor-fade-handle--${action === 'fade-in' ? 'in' : 'out'}`;
  const node = selector ? clipNode('b').querySelector(selector)! : clipNode('b');
  const delta = action === 'right' || action === 'fade-out' ? -36 : 36;
  await pointer(node, 'pointerdown', 100);
  await pointer(node, 'pointermove', 100 + delta);
  expect(clips()).not.toEqual(before);
  await pointer(node, 'pointermove', 100);
  await pointer(node, 'pointerup', 100);
  expect(clips()).toEqual(before);
  await undo();
  expect(clips()[0].fadeInMs).toBe(1000);
});

it('restores selection, cursor and undo after leaving and reopening the editor', async () => {
  await selectClip('a');
  const fade = await editFade('4'); await act(async () => fade.blur());
  const cursor = el.querySelector<HTMLInputElement>('input[aria-label="Курсор, сек"]')!;
  await act(async () => { cursor.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(cursor, '2.345'); cursor.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => cursor.blur());
  await act(async () => root.unmount()); root = createRoot(el);
  await act(async () => root.render(<AudioEditorPage />));
  expect(el.querySelector<HTMLInputElement>('input[aria-label="Курсор, сек"]')!.value).toBe('2.345');
  expect(clipNode('a').classList.contains('audio-editor-clip--selected')).toBe(true);
  await undo(); expect(clips()[0].fadeInMs).toBe(1000);
});

it('selects and resizes a time range without changing clip selection', async () => {
  await selectClip('a');
  const ruler = el.querySelector('.audio-editor-ruler')!;
  await pointer(ruler, 'pointerdown', 100); await pointer(ruler, 'pointermove', 160); await pointer(ruler, 'pointerup', 160);
  expect(clipNode('a').classList.contains('audio-editor-clip--selected')).toBe(true);
  const start = el.querySelector<HTMLInputElement>('input[aria-label="Начало диапазона, сек"]')!;
  expect(start.value).toBe('2.8');
  const end = el.querySelector('button[aria-label="Конец диапазона"]')!;
  await pointer(end, 'pointerdown', 160); await pointer(end, 'pointermove', 200); await pointer(end, 'pointerup', 200);
  expect(el.querySelector<HTMLInputElement>('input[aria-label="Конец диапазона, сек"]')!.value).toBe('5.55');
});

it('moves a clip between lanes and records exactly one undo step', async () => {
  await act(async () => { [...el.querySelectorAll('button')].find(b => b.textContent === '+ Дорожка')!.click(); });
  const node = clipNode('a');
  await pointer(node, 'pointerdown', 0);
  await act(async () => window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 36, clientY: 100 })));
  await act(async () => window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 36, clientY: 100 })));
  expect($audioProjects.getState()[0].lanes[1].clips[0]).toMatchObject({ id: 'a', timelineStartMs: 1000 });
  await undo(); expect($audioProjects.getState()[0].lanes[1].clips).toHaveLength(0); expect(clips()[0].timelineStartMs).toBe(0);
});

it('groups live gain changes into one undo and one redo action', async () => {
  await selectClip('a');
  const slider = el.querySelector<HTMLInputElement>('input[aria-label="Громкость фрагмента"]')!;
  for (const value of ['-3', '-6']) await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, value); slider.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(clips()[0].gainDb).toBe(-6);
  await pointer(slider, 'pointerup'); await undo(); expect(clips()[0].gainDb).toBe(0);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyY', ctrlKey: true, bubbles: true })));
  expect(clips()[0].gainDb).toBe(-6);
});
