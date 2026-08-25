// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineAudioPlayer } from './InlineAudioPlayer';

let container: HTMLDivElement;
let root: Root;
let loadMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  loadMock = vi.fn();

  Object.defineProperty(HTMLMediaElement.prototype, 'load', {
    configurable: true,
    value: loadMock,
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('InlineAudioPlayer', () => {
  it('does not reload a full-track source after loadedmetadata updates duration', async () => {
    await act(async () => {
      root.render(<InlineAudioPlayer source="blob:source" label="Оригинал" />);
    });

    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    expect(loadMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(audio!, 'duration', {
      configurable: true,
      value: 180,
    });

    await act(async () => {
      audio!.dispatchEvent(new Event('loadedmetadata', { bubbles: true }));
    });

    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.time-row')?.textContent).toContain('3:00');
  });

  it('seeks when the trim range changes without reloading the media source', async () => {
    await act(async () => {
      root.render(
        <InlineAudioPlayer
          source="blob:source"
          label="Фрагмент"
          range={{ start: 10, end: 20 }}
        />,
      );
    });

    const audio = container.querySelector('audio')!;
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(audio.currentTime).toBe(10);

    await act(async () => {
      root.render(
        <InlineAudioPlayer
          source="blob:source"
          label="Фрагмент"
          range={{ start: 12, end: 20 }}
        />,
      );
    });

    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(audio.currentTime).toBe(12);
  });
});
