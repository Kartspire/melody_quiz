import { describe, expect, it } from 'vitest';
import { createAudioClip, createAudioProject, getClipTimelineDurationMs, getProjectDurationMs, splitAudioClip } from './audioProject';

function clip() {
  return { ...createAudioClip('track-1', 10_000), timelineStartMs: 2_000 };
}

describe('audio project domain', () => {
  it('calculates project duration from non-destructive clips', () => {
    const project = createAudioProject();
    project.lanes[0].clips = [clip()];
    expect(getProjectDurationMs(project)).toBe(12_000);
  });

  it('splits a clip without changing its source track', () => {
    const source = clip();
    const result = splitAudioClip(source, 7_000);
    expect(result).not.toBeNull();
    const [left, right] = result!;
    expect(left.sourceTrackId).toBe(source.sourceTrackId);
    expect(right.sourceTrackId).toBe(source.sourceTrackId);
    expect(left.sourceStartMs).toBe(0);
    expect(left.sourceEndMs).toBe(5_000);
    expect(right.sourceStartMs).toBe(5_000);
    expect(right.sourceEndMs).toBe(10_000);
    expect(right.timelineStartMs).toBe(7_000);
  });

  it('takes playback rate into account', () => {
    const source = { ...clip(), playbackRate: 2 };
    expect(getClipTimelineDurationMs(source)).toBe(5_000);
  });

  it('keeps timeline duration consistent for very short accelerated clips', () => {
    const source = { ...createAudioClip('track-1', 50), playbackRate: 4 };
    expect(getClipTimelineDurationMs(source)).toBe(12.5);
  });

});
