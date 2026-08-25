// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackProvider, useFeedback } from './FeedbackProvider';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('FeedbackProvider', () => {
  it('shows and automatically dismisses a toast', async () => {
    await act(async () => root.render(<FeedbackProvider><ToastHarness /></FeedbackProvider>));

    await act(async () => findButton('Уведомить').click());
    expect(container.querySelector('.app-toast')?.textContent).toContain('Готово');

    await act(async () => vi.advanceTimersByTime(4000));
    expect(container.querySelector('.app-toast')).toBeNull();
  });

  it('resolves a dangerous confirmation only after explicit approval', async () => {
    await act(async () => root.render(<FeedbackProvider><ConfirmHarness /></FeedbackProvider>));

    await act(async () => findButton('Удалить').click());
    expect(container.querySelector('.confirm-dialog')?.textContent).toContain('Удалить объект?');
    expect(container.textContent).toContain('pending');

    await act(async () => findButton('Подтвердить удаление').click());
    expect(container.querySelector('.confirm-dialog')).toBeNull();
    expect(container.textContent).toContain('confirmed');
  });
});

function ToastHarness() {
  const { notify } = useFeedback();
  return <button onClick={() => notify({ kind: 'success', message: 'Готово', durationMs: 1500 })}>Уведомить</button>;
}

function ConfirmHarness() {
  const { confirm } = useFeedback();
  const [result, setResult] = useState('pending');
  const run = async () => {
    const confirmed = await confirm({ title: 'Удалить объект?', confirmLabel: 'Подтвердить удаление', tone: 'danger' });
    setResult(confirmed ? 'confirmed' : 'cancelled');
  };
  return (
    <>
      <button onClick={() => void run()}>Удалить</button>
      <span>{result}</span>
    </>
  );
}

function findButton(text: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}
