import { describe, expect, it } from 'vitest';
import { createGame, createSession } from './defaults';
import { evaluateGameLaunch, hasSessionProgress } from './launch';
import type { AudioAsset, GameConfig, MediaTrack, Song } from './types';

function createPlayableFixture() {
  const game = createGame('Тестовая игра');
  const now = Date.now();
  const minusAudioId = 'a'.repeat(64);
  const plusAudioId = 'b'.repeat(64);
  const audioAssets: AudioAsset[] = [
    {
      id: minusAudioId,
      sha256: minusAudioId,
      name: 'minus.mp3',
      type: 'audio/mpeg',
      blob: new Blob(['minus'], { type: 'audio/mpeg' }),
      verified: true,
    },
    {
      id: plusAudioId,
      sha256: plusAudioId,
      name: 'plus.mp3',
      type: 'audio/mpeg',
      blob: new Blob(['plus'], { type: 'audio/mpeg' }),
      verified: true,
    },
  ];
  const mediaTracks: MediaTrack[] = [
    { id: 'track-minus', name: 'Минус', audioId: minusAudioId, createdAt: now, updatedAt: now },
    { id: 'track-plus', name: 'Плюс', audioId: plusAudioId, createdAt: now, updatedAt: now },
  ];
  const song: Song = {
    id: 'song-main',
    artist: 'Исполнитель',
    title: 'Песня',
    minusTrackId: 'track-minus',
    plusTrackId: 'track-plus',
    createdAt: now,
    updatedAt: now,
  };
  game.rounds.forEach((round) => round.categories.forEach((category) => category.questions.forEach((question) => {
    question.songId = song.id;
  })));

  return { game, songs: [song], mediaTracks, audioAssets };
}

function decide(
  fixture: ReturnType<typeof createPlayableFixture>,
  mode: 'continue' | 'fresh' | 'restart',
  session = createSession(fixture.game),
) {
  return evaluateGameLaunch({
    request: { gameId: fixture.game.id, mode },
    game: fixture.game,
    session,
    songs: fixture.songs,
    mediaTracks: fixture.mediaTracks,
    audioAssets: fixture.audioAssets,
  });
}

describe('game launch use-case', () => {
  it('starts a fresh valid game with a clean session without asking for confirmation', () => {
    const fixture = createPlayableFixture();

    expect(decide(fixture, 'fresh')).toEqual({
      type: 'ready',
      gameId: fixture.game.id,
      resetSession: true,
    });
  });

  it('asks for confirmation before a fresh start when saved progress exists', () => {
    const fixture = createPlayableFixture();
    const session = createSession(fixture.game);
    session.started = true;
    session.scores[fixture.game.teams[0].id] = 300;

    expect(decide(fixture, 'fresh', session)).toEqual({
      type: 'confirm-restart',
      gameId: fixture.game.id,
      gameTitle: fixture.game.title,
    });
  });

  it('continues a saved game using only the still-unplayed questions for media validation', () => {
    const fixture = createPlayableFixture();
    const session = createSession(fixture.game);
    const completedQuestion = fixture.game.rounds[0].categories[0].questions[0];
    completedQuestion.songId = 'deleted-song';
    session.started = true;
    session.completedQuestionIds = [completedQuestion.id];

    expect(decide(fixture, 'continue', session)).toEqual({
      type: 'ready',
      gameId: fixture.game.id,
      resetSession: false,
    });
  });

  it('returns validation issues instead of launching an invalid game', () => {
    const fixture = createPlayableFixture();
    fixture.game.rounds[0].categories[0].questions[0].songId = undefined;

    const decision = decide(fixture, 'continue');

    expect(decision.type).toBe('invalid');
    if (decision.type === 'invalid') {
      expect(decision.gameId).toBe(fixture.game.id);
      expect(decision.issues.some((issue) => issue.includes('не выбрана песня'))).toBe(true);
    }
  });

  it('restarts an already played game immediately after validation', () => {
    const fixture = createPlayableFixture();
    const session = createSession(fixture.game);
    session.started = true;
    session.scores[fixture.game.teams[0].id] = 500;

    expect(decide(fixture, 'restart', session)).toEqual({
      type: 'ready',
      gameId: fixture.game.id,
      resetSession: true,
    });
  });

  it('opens finished results without revalidating media that is no longer needed', () => {
    const fixture = createPlayableFixture();
    const session = createSession(fixture.game);
    session.started = true;
    session.stageIndex = fixture.game.stages.length;
    fixture.game.rounds[0].categories[0].questions[0].songId = 'deleted-song';

    expect(decide(fixture, 'continue', session)).toEqual({
      type: 'ready',
      gameId: fixture.game.id,
      resetSession: false,
    });
  });

  it('detects every meaningful form of saved progress', () => {
    const game: GameConfig = createGame('Тест');
    const session = createSession(game);
    expect(hasSessionProgress(session)).toBe(false);

    session.completedInterRoundIds = ['inter-round'];
    expect(hasSessionProgress(session)).toBe(true);
  });
});
