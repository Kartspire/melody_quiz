import { describe, expect, it } from 'vitest';
import type { AudioClip, AudioProject } from '../../model/types';
import { getClipTimelineEndMs } from './audioProject';
import {
  addProjectMarker,
  moveClipsToLane,
  copyClips,
  deleteClips,
  insertClip,
  moveClips,
  pasteClips,
  snapSelectionDelta,
  snapTimelinePosition,
  trimClipEnd,
  trimClipStart,
} from './timelineEditing';

function clip(id: string, start: number, duration: number, sourceTrackId = 'track-1'): AudioClip {
  return {
    id,
    sourceTrackId,
    timelineStartMs: start,
    sourceStartMs: 0,
    sourceEndMs: duration,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    playbackRate: 1,
  };
}

function project(lanes: AudioProject['lanes']): AudioProject {
  return { id: 'project-1', name: 'Test', lanes, markers: [], createdAt: 1, updatedAt: 1 };
}

function lane(id: string, clips: AudioClip[] = []) {
  return { id, name: id, muted: false, solo: false, clips };
}

describe('audio editor timeline editing', () => {
  it('inserts a clip at the cursor without moving existing material', () => {
    const source = project([lane('lane-1', [clip('a', 0, 10_000)])]);
    const inserted = clip('b', 0, 2_000, 'track-2');
    const result = insertClip(source, 'lane-1', inserted, 5_000);
    const clips = result.lanes[0]!.clips.sort((a, b) => a.timelineStartMs - b.timelineStartMs);

    expect(clips).toHaveLength(2);
    expect(clips[0]!.id).toBe('a');
    expect(clips[0]!.timelineStartMs).toBe(0);
    expect(clips[1]!.id).toBe('b');
    expect(clips[1]!.timelineStartMs).toBe(5_000);
  });

  it('deletes selected clips without closing the gap', () => {
    const source = project([lane('lane-1', [clip('a', 0, 1_000), clip('b', 1_000, 2_000), clip('c', 3_000, 1_000)])]);
    const result = deleteClips(source, ['b']);
    expect(result.lanes[0]!.clips.map((item) => [item.id, item.timelineStartMs])).toEqual([['a', 0], ['c', 3_000]]);
  });

  it('snaps to playhead, markers and clip edges before falling back to the 50 ms grid', () => {
    const source = project([lane('lane-1', [clip('a', 5_000, 1_000)])]);
    source.markers = [{ id: 'm1', positionMs: 3_000, label: 'Drop' }];

    expect(snapTimelinePosition(source, 4_920, { pixelsPerSecond: 40 }).valueMs).toBe(5_000);
    expect(snapTimelinePosition(source, 3_090, { pixelsPerSecond: 40 }).valueMs).toBe(3_000);
    expect(snapTimelinePosition(source, 2_120, { pixelsPerSecond: 40, playheadMs: 2_000 }).valueMs).toBe(2_000);
    expect(snapTimelinePosition(source, 2_333, { pixelsPerSecond: 180 }).valueMs).toBe(2_350);
  });

  it('moves multiple selected clips as one group and snaps an edge to another clip', () => {
    const source = project([lane('lane-1', [clip('a', 0, 1_000), clip('b', 1_500, 1_000), clip('anchor', 5_000, 1_000)])]);
    const snap = snapSelectionDelta(source, ['a', 'b'], 2_430, { pixelsPerSecond: 40 });
    const result = moveClips(source, ['a', 'b'], snap.deltaMs);
    const moved = result.lanes[0]!.clips.filter((item) => item.id === 'a' || item.id === 'b');

    expect(snap.guideMs).toBe(5_000);
    expect(Math.max(...moved.map(getClipTimelineEndMs))).toBe(5_000);
    expect(moved[1]!.timelineStartMs - moved[0]!.timelineStartMs).toBe(1_500);
  });

  it('trims clip edges without changing playback alignment or crossing source bounds', () => {
    const source = project([lane('lane-1', [{ ...clip('a', 1_000, 4_000), sourceStartMs: 1_000, sourceEndMs: 5_000 }])]);
    const leftTrimmed = trimClipStart(source, 'a', 1_500);
    const left = leftTrimmed.lanes[0]!.clips[0]!;
    expect(left.timelineStartMs).toBe(1_500);
    expect(left.sourceStartMs).toBe(1_500);

    const rightTrimmed = trimClipEnd(leftTrimmed, 'a', 5_500, 8_000);
    const right = rightTrimmed.lanes[0]!.clips[0]!;
    expect(getClipTimelineEndMs(right)).toBe(5_500);
    expect(right.sourceEndMs).toBe(5_500);
  });

  it('copies and pastes a multi-lane selection preserving relative time and lane offsets', () => {
    const source = project([
      lane('lane-1', [clip('a', 1_000, 1_000)]),
      lane('lane-2', [clip('b', 1_500, 500)]),
    ]);
    const clipboard = copyClips(source, ['a', 'b']);
    expect(clipboard).not.toBeNull();
    const pasted = pasteClips(source, clipboard!, 5_000, 'lane-1');
    const first = pasted.project.lanes[0]!.clips.find((item) => pasted.clipIds.includes(item.id))!;
    const second = pasted.project.lanes[1]!.clips.find((item) => pasted.clipIds.includes(item.id))!;

    expect(first.timelineStartMs).toBe(5_000);
    expect(second.timelineStartMs).toBe(5_500);
  });

  it('preserves manual fades when clips overlap after timeline operations', () => {
    const a = { ...clip('a', 0, 8_000), fadeInMs: 250, fadeOutMs: 500 };
    const b = { ...clip('b', 6_000, 8_000), fadeInMs: 750, fadeOutMs: 300 };
    const source = project([lane('lane-1', [a, b]), lane('lane-2')]);
    const results = [
      insertClip(source, 'lane-1', clip('c', 0, 4_000), 5_000),
      moveClips(source, ['b'], -1_000),
      trimClipStart(source, 'b', 6_500),
      trimClipEnd(source, 'a', 7_000, 8_000),
      moveClipsToLane(source, ['b'], 'lane-1'),
      pasteClips(source, copyClips(source, ['b'])!, 4_000, 'lane-1').project,
    ];
    for (const result of results) {
      for (const original of [a, b]) {
        const actual = result.lanes.flatMap(l => l.clips).find(c => c.id === original.id)!;
        expect([actual.fadeInMs, actual.fadeOutMs]).toEqual([original.fadeInMs, original.fadeOutMs]);
      }
    }
    const clips = results[5].lanes[0].clips;
    const pasted = clips[clips.length - 1];
    expect([pasted.fadeInMs, pasted.fadeOutMs]).toEqual([750, 300]);
  });

  it('adds persistent markers to the project', () => {
    const source = project([lane('lane-1')]);
    const result = addProjectMarker(source, 1_234, 'Припев');
    expect(result?.project.markers).toHaveLength(1);
    expect(result?.marker.positionMs).toBe(1_234);
    expect(result?.marker.label).toBe('Припев');
  });
});
