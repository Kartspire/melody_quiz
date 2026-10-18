import { describe, expect, it } from 'vitest';
import { createAudioClip, createAudioProject, getClipTimelineDurationMs, getClipTimelineEndMs, getProjectDurationMs, normalizeAudioClip, splitAudioClip } from './audioProject';

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

  it.each([0.25, 0.5])('rejects splits leaving less than 50 ms of source at speed %s', (playbackRate) => {
    const source = { ...createAudioClip('track-1', 1000), playbackRate };
    const minimumDuration = 50 / playbackRate;
    expect(splitAudioClip(source, minimumDuration / 2)).toBeNull();
    expect(splitAudioClip(source, getClipTimelineDurationMs(source) - minimumDuration / 2)).toBeNull();
  });

  it.each([0.25, 0.5, 0.75, 1, 1.3, 2, 4])('keeps split parts contiguous at speed %s', (playbackRate) => {
    const source = { ...clip(), playbackRate };
    const [left, right] = splitAudioClip(source, 2345)!;
    expect(left.sourceEndMs).toBe(right.sourceStartMs);
    expect(getClipTimelineEndMs(left)).toBe(right.timelineStartMs);
    expect(getClipTimelineEndMs(right)).toBeCloseTo(getClipTimelineEndMs(source), 8);
    expect(normalizeAudioClip({ ...right, gainDb: -3 }).timelineStartMs).toBe(right.timelineStartMs);
    expect(left.sourceStartMs).toBe(source.sourceStartMs);
    expect(right.sourceEndMs).toBe(source.sourceEndMs);
  });

  it('keeps fades within a clip shorter than a whole number of milliseconds', () => {
    const normalized = normalizeAudioClip({ ...createAudioClip('track-1', 50), playbackRate: 4, fadeInMs: 50, fadeOutMs: 50 });
    expect(normalized.fadeInMs).toBe(12.5);
    expect(normalized.fadeOutMs).toBe(12.5);
  });

});
