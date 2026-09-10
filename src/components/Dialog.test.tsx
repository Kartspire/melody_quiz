// @vitest-environment jsdom
import { act, StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

it('closes only the inner dialog, keeps the draft, restores focus and scroll lock', async () => {
  await act(async () => root.render(<StrictMode><NestedDialogs /></StrictMode>));
  const opener = container.querySelector<HTMLButtonElement>('[data-open]')!;
  opener.focus();
  await act(async () => opener.click());
  expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(2);
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(container.querySelector<HTMLInputElement>('[data-draft]')?.value).toBe('Черновик песни');
  expect(document.activeElement).toBe(opener);
  expect(document.body.style.overflow).toBe('hidden');
  await act(async () => opener.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(0);
  expect(document.body.style.overflow).not.toBe('hidden');
});

it('wraps keyboard focus when the dialog container itself is focused', async () => {
  await act(async () => root.render(<Dialog title="Focus" onClose={() => undefined}><button>Last</button></Dialog>));
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
  dialog.focus();
  await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
  expect(document.activeElement?.textContent).toBe('Last');
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Закрыть');
});

it('blocks closing and submit controls while busy', async () => {
  const close = vi.fn();
  const submit = vi.fn();
  await act(async () => root.render(<Dialog busy title="Import" onClose={close}><button onClick={submit}>Import</button></Dialog>));
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[aria-label="Закрыть"]')!.click();
    container.querySelector<HTMLFieldSetElement>('fieldset')!.querySelector('button')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
  expect(close).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});

function NestedDialogs() {
  const [parent, setParent] = useState(true);
  const [child, setChild] = useState(false);
  return parent && <Dialog title="Song" onClose={() => setParent(false)}>
    <input data-draft defaultValue="Черновик песни" />
    <button data-open onClick={() => setChild(true)}>Choose track</button>
    {child && <Dialog title="Track" onClose={() => setChild(false)}><input autoFocus /></Dialog>}
  </Dialog>;
}
