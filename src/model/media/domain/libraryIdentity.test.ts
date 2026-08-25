import { describe, expect, it } from 'vitest';
import type { MediaTrack, Song } from '../../types';
import { areSongsEquivalent, findEquivalentMediaTrack, mediaTrackNameFromFileName, normalizeMediaIdentityText } from './libraryIdentity';

const track: MediaTrack = {
  id: 'track-a',
  name: 'Кино - Группа крови - минус',
  audioId: 'a'.repeat(64),
  createdAt: 1,
  updatedAt: 1,
};

describe('media library identity', () => {
  it('uses a file name without its audio extension as the automatic track name', () => {
    expect(mediaTrackNameFromFileName('song.mp3')).toBe('song');
    expect(mediaTrackNameFromFileName('final.version.flac')).toBe('final.version');
  });

  it('normalizes user-facing text consistently', () => {
    expect(normalizeMediaIdentityText('  КИНО   -  Группа крови ')).toBe('кино - группа крови');
  });

  it('deduplicates a logical track only when both audio and normalized name match', () => {
    expect(findEquivalentMediaTrack([track], track.audioId, '  КИНО   - Группа крови - минус ')).toBe(track);
    expect(findEquivalentMediaTrack([track], track.audioId, 'Версия для финала')).toBeUndefined();
    expect(findEquivalentMediaTrack([track], 'b'.repeat(64), track.name)).toBeUndefined();
  });

  it('treats songs as equivalent only when metadata and resolved track links match', () => {
    const base: Song = {
      id: 'song-a',
      artist: 'Кино',
      title: 'Группа крови',
      minusTrackId: 'minus-a',
      plusTrackId: 'plus-a',
      createdAt: 1,
      updatedAt: 1,
    };
    const equivalent: Song = { ...base, id: 'song-b', artist: ' кино ', title: 'ГРУППА   КРОВИ' };
    const differentTrack: Song = { ...base, id: 'song-b', minusTrackId: 'minus-b' };
    expect(areSongsEquivalent(base, equivalent)).toBe(true);
    expect(areSongsEquivalent(base, differentTrack)).toBe(false);
  });
});
