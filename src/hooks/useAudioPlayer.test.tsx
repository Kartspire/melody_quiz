// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAudioPlayer } from './useAudioPlayer';

let container: HTMLDivElement;
let root: Root;
let loadMock: ReturnType<typeof vi.fn>;
let pauseMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  loadMock = vi.fn();
  pauseMock = vi.fn();

  Object.defineProperty(HTMLMediaElement.prototype, 'load', {
    configurable: true,
    value: loadMock,
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: pauseMock,
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

describe('useAudioPlayer', () => {
  it('reloads only when the source changes and keeps metadata in controller state', async () => {
    await renderHarness({ source: 'blob:first' });
    const audio = getAudio();
    expect(loadMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(audio, 'duration', { configurable: true, value: 125 });
    await act(async () => {
      audio.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(container.querySelector('[data-duration]')?.getAttribute('data-duration')).toBe('125');

    await renderHarness({ source: 'blob:first', startAt: 10, stopAt: 20, resetOnRangeChange: true });
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(audio.currentTime).toBe(10);

    await renderHarness({ source: 'blob:second' });
    expect(loadMock).toHaveBeenCalledTimes(2);
  });

  it('stops once at stopAt and can keep the playhead on the boundary', async () => {
    const onRangeEnd = vi.fn();
    await renderHarness({ source: 'blob:range', stopAt: 10, onRangeEnd });
    const audio = getAudio();
    Object.defineProperty(audio, 'duration', { configurable: true, value: 60 });
    audio.currentTime = 10;

    await act(async () => {
      audio.dispatchEvent(new Event('timeupdate'));
    });
    expect(onRangeEnd).toHaveBeenCalledTimes(1);
    expect(pauseMock).toHaveBeenCalled();
    expect(audio.currentTime).toBe(10);

    await act(async () => {
      audio.dispatchEvent(new Event('timeupdate'));
    });
    expect(onRangeEnd).toHaveBeenCalledTimes(1);
  });

  it('can reset a bounded preview to its start after reaching stopAt', async () => {
    const onRangeEnd = vi.fn();
    await renderHarness({
      source: 'blob:range',
      startAt: 12,
      stopAt: 22,
      resetOnRangeChange: true,
      rangeEndBehavior: 'reset',
      onRangeEnd,
    });
    const audio = getAudio();
    Object.defineProperty(audio, 'duration', { configurable: true, value: 60 });
    audio.currentTime = 22;

    await act(async () => {
      audio.dispatchEvent(new Event('timeupdate'));
    });
    expect(onRangeEnd).toHaveBeenCalledTimes(1);
    expect(audio.currentTime).toBe(12);
    expect(container.querySelector('[data-current]')?.getAttribute('data-current')).toBe('12');
  });


  it('allows a bounded reset preview to reach stopAt again after replay', async () => {
    const onRangeEnd = vi.fn();
    await renderHarness({
      source: 'blob:repeat',
      startAt: 5,
      stopAt: 15,
      resetOnRangeChange: true,
      rangeEndBehavior: 'reset',
      onRangeEnd,
    });
    const audio = getAudio();
    Object.defineProperty(audio, 'duration', { configurable: true, value: 40 });
    audio.currentTime = 15;

    await act(async () => {
      audio.dispatchEvent(new Event('timeupdate'));
    });
    expect(onRangeEnd).toHaveBeenCalledTimes(1);
    expect(audio.currentTime).toBe(5);

    const playButton = container.querySelector<HTMLButtonElement>('[data-play]');
    if (!playButton) throw new Error('Play button was not rendered.');
    await act(async () => {
      playButton.click();
    });
    audio.currentTime = 15;
    await act(async () => {
      audio.dispatchEvent(new Event('timeupdate'));
    });

    expect(onRangeEnd).toHaveBeenCalledTimes(2);
    expect(audio.currentTime).toBe(5);
  });

  it('delegates natural end only when there is no bounded stopAt', async () => {
    const onEnded = vi.fn();
    await renderHarness({ source: 'blob:full', onEnded });
    const audio = getAudio();
    Object.defineProperty(audio, 'duration', { configurable: true, value: 90 });

    await act(async () => {
      audio.dispatchEvent(new Event('ended'));
    });
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-current]')?.getAttribute('data-current')).toBe('90');
  });
});

interface HarnessProps {
  source: string;
  startAt?: number;
  stopAt?: number;
  resetOnRangeChange?: boolean;
  rangeEndBehavior?: 'pause' | 'reset';
  onRangeEnd?: () => void;
  onEnded?: () => void;
}

async function renderHarness(props: HarnessProps) {
  await act(async () => {
    root.render(<Harness {...props} />);
  });
}

function Harness(props: HarnessProps) {
  const player = useAudioPlayer(props);
  return (
    <div>
      <audio ref={player.audioRef} src={props.source} />
      <button data-play onClick={() => void player.play()}>play</button>
      <span data-duration={player.duration} data-current={player.currentTime} data-playing={player.playing} />
    </div>
  );
}

function getAudio() {
  const audio = container.querySelector('audio');
  if (!audio) throw new Error('Audio element was not rendered.');
  return audio;
}
