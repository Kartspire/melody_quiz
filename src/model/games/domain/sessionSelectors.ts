import type { AudioAsset, MediaTrack, PlayableQuestion, Question, Song } from '../../types';

export function resolvePlayableQuestion(
  question: Question,
  songs: readonly Song[],
  mediaTracks: readonly MediaTrack[],
  audioAssets: readonly AudioAsset[],
): PlayableQuestion {
  const song = question.songId ? songs.find((item) => item.id === question.songId) : undefined;
  const minusTrack = song?.minusTrackId
    ? mediaTracks.find((track) => track.id === song.minusTrackId)
    : undefined;
  const plusTrack = song?.plusTrackId
    ? mediaTracks.find((track) => track.id === song.plusTrackId)
    : undefined;

  return {
    ...question,
    song,
    minusTrack,
    plusTrack,
    minus: minusTrack ? audioAssets.find((asset) => asset.id === minusTrack.audioId) : undefined,
    plus: plusTrack ? audioAssets.find((asset) => asset.id === plusTrack.audioId) : undefined,
  };
}
