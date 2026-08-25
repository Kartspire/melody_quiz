// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createInstrumentalMock,
  createTrimmedWavMock,
  addGeneratedTrackToLibraryMock,
  prepareVocalSeparatorMock,
  releaseVocalSeparatorMock,
} = vi.hoisted(() => ({
  createInstrumentalMock: vi.fn(async () => new Blob(['minus'], { type: 'audio/wav' })),
  createTrimmedWavMock: vi.fn(async () => new Blob(['trimmed'], { type: 'audio/wav' })),
  addGeneratedTrackToLibraryMock: vi.fn(async (_blob: Blob, _fileName: string) => ({
    track: { id: 'track-added' },
    status: 'created' as 'created' | 'existing',
  })),
  prepareVocalSeparatorMock: vi.fn(),
  releaseVocalSeparatorMock: vi.fn(async () => undefined),
}));

vi.mock('./addGeneratedTrackToLibrary', () => ({
  addGeneratedTrackToLibrary: addGeneratedTrackToLibraryMock,
}));

vi.mock('./audioClip', async () => {
  const actual = await vi.importActual<typeof import('./audioClip')>('./audioClip');
  return {
    ...actual,
    createTrimmedWav: createTrimmedWavMock,
  };
});

vi.mock('./separator', () => ({
  createInstrumental: createInstrumentalMock,
  getVocalRemovalCapabilities: () => ({
    webGpu: false,
    crossOriginIsolated: false,
    maxSourceBytes: 100 * 1024 * 1024,
    maxDurationSeconds: 90,
    maxDecodeDurationSeconds: 8 * 60,
    recommendedDurationSeconds: 60,
  }),
  prepareVocalSeparator: prepareVocalSeparatorMock,
  releaseVocalSeparator: releaseVocalSeparatorMock,
}));

import { FeedbackProvider } from '../../components/feedback/FeedbackProvider';
import { VocalRemovalPage } from './VocalRemovalPage';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  createInstrumentalMock.mockClear();
  createTrimmedWavMock.mockClear();
  addGeneratedTrackToLibraryMock.mockClear();
  prepareVocalSeparatorMock.mockClear();
  releaseVocalSeparatorMock.mockClear();

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => `blob:test-${Math.random()}`),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'load', {
    configurable: true,
    value: vi.fn(),
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
  vi.useRealTimers();
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('VocalRemovalPage', () => {
  it('waits for metadata before full-track vocal removal and enables a safe duration', async () => {
    await renderWithFile();

    const fullButton = findButton('Минус из всего трека');
    const fragmentButton = findButton('Минус из фрагмента');

    expect(fullButton.disabled).toBe(true);
    expect(fragmentButton.disabled).toBe(true);

    await setOriginalDuration(90);
    expect(fullButton.disabled).toBe(false);
    expect(fragmentButton.disabled).toBe(false);

    await act(async () => {
      fullButton.click();
      await Promise.resolve();
    });

    expect(createInstrumentalMock).toHaveBeenCalledTimes(1);
  });

  it('warms the separator as soon as the processing page becomes active', async () => {
    await act(async () => {
      root.render(withFeedback(<VocalRemovalPage active />));
    });

    expect(prepareVocalSeparatorMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the prepared separator alive during a short sidebar switch', async () => {
    vi.useFakeTimers();
    await renderWithFile();
    prepareVocalSeparatorMock.mockClear();
    releaseVocalSeparatorMock.mockClear();

    await act(async () => {
      root.render(withFeedback(<VocalRemovalPage active={false} />));
    });
    expect(releaseVocalSeparatorMock).not.toHaveBeenCalled();

    await act(async () => {
      root.render(withFeedback(<VocalRemovalPage active />));
    });
    expect(releaseVocalSeparatorMock).not.toHaveBeenCalled();
    expect(prepareVocalSeparatorMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('releases the prepared separator after five minutes away from the processing page', async () => {
    vi.useFakeTimers();
    await renderWithFile();
    releaseVocalSeparatorMock.mockClear();

    await act(async () => {
      root.render(withFeedback(<VocalRemovalPage active={false} />));
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(releaseVocalSeparatorMock).toHaveBeenCalledTimes(1);
  });

  it('disables full-track separation when the source exceeds the memory-safe limit', async () => {
    await renderWithFile();
    await setOriginalDuration(180);

    expect(findButton('Минус из всего трека').disabled).toBe(true);
    expect(container.textContent).toContain('Весь трек длиннее безопасного лимита');
  });


  it('adds a generated minus directly to the media library', async () => {
    await renderWithFile();
    await setOriginalDuration(90);

    await act(async () => {
      findButton('Минус из всего трека').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const addButton = findButton('Добавить минус в медиатеку');
    await act(async () => {
      addButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(addGeneratedTrackToLibraryMock).toHaveBeenCalledTimes(1);
    const [blob, fileName] = addGeneratedTrackToLibraryMock.mock.calls[0]!;
    expect(blob).toBeInstanceOf(Blob);
    expect(fileName).toBe('song - минус.wav');
    expect(container.textContent).toContain('✓ Минус добавлен в медиатеку');
  });

  it('adds the uploaded original track directly to the media library', async () => {
    await renderWithFile();

    const addButton = findButton('Добавить оригинал в медиатеку');
    await act(async () => {
      addButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(addGeneratedTrackToLibraryMock).toHaveBeenCalledTimes(1);
    const [blob, fileName] = addGeneratedTrackToLibraryMock.mock.calls[0]!;
    expect(blob).toBeInstanceOf(File);
    expect(fileName).toBe('song.mp3');
    expect(container.textContent).toContain('✓ Оригинал добавлен в медиатеку');
  });

  it('reports an already existing original without creating a duplicate UI state', async () => {
    addGeneratedTrackToLibraryMock.mockResolvedValueOnce({
      track: { id: 'track-existing' },
      status: 'existing',
    });
    await renderWithFile();

    await act(async () => {
      findButton('Добавить оригинал в медиатеку').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(addGeneratedTrackToLibraryMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('✓ Уже есть в медиатеке');
  });

  it('adds the trimmed track directly to the media library', async () => {
    await renderWithFile();
    await setOriginalDuration(180);

    await act(async () => {
      findButton('Подготовить обрезанный WAV').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Фрагмент готов');
    expect(container.querySelectorAll('.track-editor-card')).toHaveLength(1);
    expect(container.querySelector('.track-clip-result')).toBeNull();

    await act(async () => {
      findButton('Добавить фрагмент в медиатеку').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createTrimmedWavMock).toHaveBeenCalledTimes(1);
    expect(addGeneratedTrackToLibraryMock).toHaveBeenCalledTimes(1);
    const [blob, fileName] = addGeneratedTrackToLibraryMock.mock.calls[0]!;
    expect(blob).toBeInstanceOf(Blob);
    expect(fileName).toBe('song - фрагмент.wav');
    expect(container.textContent).toContain('✓ Фрагмент добавлен в медиатеку');
  });


  it('keeps the loaded track and generated state when the page becomes inactive and active again', async () => {
    await renderWithFile();
    await setOriginalDuration(180);

    await act(async () => {
      findButton('Подготовить обрезанный WAV').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('song.mp3');
    expect(container.textContent).toContain('Фрагмент готов');

    await act(async () => {
      root.render(withFeedback(<VocalRemovalPage active={false} />));
    });
    await act(async () => {
      root.render(withFeedback(<VocalRemovalPage active />));
    });

    expect(container.textContent).toContain('song.mp3');
    expect(container.textContent).toContain('Фрагмент готов');
  });

  it('shows a toast after a track is added to the media library', async () => {
    await renderWithFile();

    await act(async () => {
      findButton('Добавить оригинал в медиатеку').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const toast = container.querySelector('.app-toast');
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toContain('Оригинал добавлен в медиатеку');
  });

  it('keeps a full-track minus when only the trim range changes', async () => {
    await renderWithFile();
    await setOriginalDuration(90);

    await act(async () => {
      findButton('Минус из всего трека').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Минус готов');

    const startRange = container.querySelector<HTMLInputElement>('.trim-range-input--start');
    expect(startRange).not.toBeNull();

    await act(async () => {
      startRange!.value = '10';
      startRange!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container.textContent).toContain('Минус готов');
  });
});

function withFeedback(node: ReactNode) {
  return <FeedbackProvider>{node}</FeedbackProvider>;
}

async function renderWithFile() {
  await act(async () => {
    root.render(withFeedback(<VocalRemovalPage />));
  });

  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  const file = new File(['audio'], 'song.mp3', { type: 'audio/mpeg' });
  Object.defineProperty(input!, 'files', {
    configurable: true,
    value: [file],
  });

  await act(async () => {
    input!.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
}

async function setOriginalDuration(duration: number) {
  const audio = container.querySelector<HTMLAudioElement>('.vocal-track-card audio');
  expect(audio).not.toBeNull();
  Object.defineProperty(audio!, 'duration', {
    configurable: true,
    value: duration,
  });

  await act(async () => {
    audio!.dispatchEvent(new Event('loadedmetadata', { bubbles: true }));
  });
}

function findButton(text: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}
