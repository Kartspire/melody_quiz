import { describe, expect, it } from 'vitest';
import type { AudioClip } from '../../model/types';
import { getClipPlaybackWindow } from './audioEngine';

const source: AudioClip = {
  id: 'clip-1',
  sourceTrackId: 'track-1',
  timelineStartMs: 2_000,
  sourceStartMs: 10_000,
  sourceEndMs: 20_000,
  gainDb: 0,
  fadeInMs: 0,
  fadeOutMs: 0,
  playbackRate: 2,
};

describe('getClipPlaybackWindow', () => {
  it('keeps source offset and timeline duration in sync with playbackRate', () => {
    const window = getClipPlaybackWindow(source, 3_000, 60_000);
    expect(window).toEqual({ playFromMs: 3_000, sourceOffsetMs: 12_000, sourceDurationMs: 8_000, timelineDurationMs: 4_000 });
  });

  it('clips scheduling to the actual decoded buffer duration', () => {
    const window = getClipPlaybackWindow(source, 2_000, 15_000);
    expect(window?.sourceDurationMs).toBe(5_000);
    expect(window?.timelineDurationMs).toBe(2_500);
  });

  it('does not schedule a clip after its timeline end', () => {
    expect(getClipPlaybackWindow(source, 7_000, 60_000)).toBeNull();
  });
});
