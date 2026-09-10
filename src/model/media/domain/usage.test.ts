import { describe, expect, it } from 'vitest';
import type { AudioProject } from '../../types';
import { buildMediaTrackUsageMap, isMediaTrackUsed } from './usage';

const project: AudioProject = {
  id: 'project-1',
  name: 'Попурри',
  lanes: [{
    id: 'lane-1',
    name: 'Основная',
    muted: false,
    solo: false,
    clips: [{
      id: 'clip-1',
      sourceTrackId: 'track-1',
      timelineStartMs: 0,
      sourceStartMs: 0,
      sourceEndMs: 5_000,
      gainDb: 0,
      fadeInMs: 0,
      fadeOutMs: 0,
      playbackRate: 1,
    }],
  }],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

describe('media usage from audio projects', () => {
  it('protects a source MediaTrack while a project clip references it', () => {
    const usage = buildMediaTrackUsageMap([], [], [project]);
    expect(usage.get('track-1')?.[0]).toMatchObject({ label: 'Монтаж: Попурри', role: 'Основная' });
    expect(isMediaTrackUsed([], [], 'track-1', [project])).toBe(true);
  });
});
