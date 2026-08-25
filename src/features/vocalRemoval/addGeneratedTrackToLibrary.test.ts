import { describe, expect, it } from 'vitest';
import type { MediaTrack } from '../../model/types';
import { findEquivalentMediaTrack, trackNameFromFileName } from './addGeneratedTrackToLibrary';

describe('trackNameFromFileName', () => {
  it('uses the generated file name without its extension as the media track name', () => {
    expect(trackNameFromFileName('Кино - Группа крови - минус.wav')).toBe('Кино - Группа крови - минус');
  });

  it('falls back to a readable track name', () => {
    expect(trackNameFromFileName('.wav')).toBe('Аудиотрек');
  });
});

describe('findEquivalentMediaTrack', () => {
  const track: MediaTrack = {
    id: 'track-existing',
    name: 'Кино - Группа крови - минус',
    audioId: 'a'.repeat(64),
    createdAt: 1,
    updatedAt: 1,
  };

  it('finds the same physical audio with the same normalized logical name', () => {
    expect(findEquivalentMediaTrack(
      [track],
      track.audioId,
      '  КИНО   - Группа крови - минус  ',
    )).toBe(track);
  });

  it('allows the same physical audio to exist under a different logical name', () => {
    expect(findEquivalentMediaTrack([track], track.audioId, 'Версия для финала')).toBeUndefined();
  });

  it('does not merge different physical audio with the same name', () => {
    expect(findEquivalentMediaTrack([track], 'b'.repeat(64), track.name)).toBeUndefined();
  });
});
