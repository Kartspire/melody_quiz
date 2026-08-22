import { describe, expect, it } from 'vitest';
import { createGame, createInterRoundStage, createSession } from './defaults';
import { createCommonTheme4InterRound, createContinueLyricsInterRound } from '../interRounds/templates';
import { assertValidGameStructure, assertValidPersistedState, getGameStartIssues, getGameStorageIssues, getSessionContinuationIssues } from './validation';
import { INTER_ROUND_LIMITS } from './limits';
import type { CommonThemeStage, PersistedState, Song } from './types';

const emptyState = (): PersistedState => ({ version: 4, games: [], songs: [], mediaTracks: [], audioAssets: [], sessions: [], activeGameId: null });

describe('game validation', () => {
  it('rejects game structures that the editor must not import', () => {
    const game = createGame('Тест');
    game.rounds[0].categories[0].questions[0].points = 0;
    expect(() => assertValidGameStructure(game)).toThrow(/стоимость/i);

    game.rounds[0].categories[0].questions[0].points = 100;
    game.teams[1].name = game.teams[0].name;
    expect(() => assertValidGameStructure(game)).toThrow(/название/i);
  });

  it('rejects timestamps outside the supported Date range', () => {
    const game = createGame('Тест');
    game.updatedAt = 1e300;
    expect(() => assertValidGameStructure(game)).toThrow(/дата/i);
  });

  it('allows safe editor drafts in local persistence', () => {
    const game = createGame('');
    game.rounds[0].name = '';
    game.rounds[0].categories[0].name = '';
    game.teams[0].name = '';
    const state = emptyState();
    state.games = [game];
    state.sessions = [createSession(game)];
    state.activeGameId = game.id;
    expect(() => assertValidPersistedState(state)).not.toThrow();
  });

  it('does not require audio from questions already completed in a saved session', () => {
    const game = createGame('Тест');
    const question = game.rounds[0].categories[0].questions[0];
    const now = Date.now();
    const song: Song = { id: 'song-1', artist: 'Исполнитель', title: 'Песня', createdAt: now, updatedAt: now };
    question.songId = song.id;

    expect(getGameStartIssues(game, [song], [], []).some((issue) => issue.includes('минус'))).toBe(true);
    const session = createSession(game);
    session.completedQuestionIds = [question.id];
    // Other unassigned questions still produce issues, but the completed song must not.
    const issues = getSessionContinuationIssues(game, session, [song], [], []);
    expect(issues.some((issue) => issue.includes('вопрос 1') && issue.includes('минус'))).toBe(false);
  });

  it('applies continue-lyrics numeric limits even to persisted drafts', () => {
    const game = createGame('Тест');
    const lyrics = createContinueLyricsInterRound();
    game.interRounds = [lyrics];
    game.stages.push(createInterRoundStage(lyrics.id));

    lyrics.tasks[0].requiredWordsCount = INTER_ROUND_LIMITS.continueLyrics.requiredWordsCount.min - 1;
    expect(getGameStorageIssues(game).some((issue) => issue.includes('количество слов'))).toBe(true);

    lyrics.tasks[0].requiredWordsCount = INTER_ROUND_LIMITS.continueLyrics.requiredWordsCount.max;
    lyrics.tasks[0].cutAtMs = INTER_ROUND_LIMITS.continueLyrics.cutAtMs.max;
    expect(getGameStorageIssues(game).some((issue) => issue.includes('количество слов') || issue.includes('время остановки'))).toBe(false);

    lyrics.tasks[0].cutAtMs = INTER_ROUND_LIMITS.continueLyrics.cutAtMs.max + 1;
    expect(getGameStorageIssues(game).some((issue) => issue.includes('время остановки'))).toBe(true);
  });

  it('validates the specific configuration required by each inter-round template', () => {
    const game = createGame('Тест');
    const lyrics = createContinueLyricsInterRound();
    game.interRounds = [lyrics];
    game.stages.push(createInterRoundStage(lyrics.id));
    expect(() => assertValidGameStructure(game)).toThrow(/аудиотрек/i);

    lyrics.tasks[0].trackId = 'track-lyrics';
    lyrics.tasks[0].answerText = 'пять следующих слов ответа';
    expect(() => assertValidGameStructure(game)).not.toThrow();

    const commonTheme = createCommonTheme4InterRound();
    commonTheme.stages[0].commonTheme = 'Лето';
    commonTheme.stages[0].tracks = commonTheme.stages[0].tracks.map((track, index) => ({
      ...track,
      trackId: `track-${index + 1}`,
      answerArtist: `Исполнитель ${index + 1}`,
      answerTitle: `Песня ${index + 1}`,
    })) as CommonThemeStage['tracks'];
    game.interRounds = [commonTheme];
    game.stages = [game.stages[0], createInterRoundStage(commonTheme.id)];
    expect(() => assertValidGameStructure(game)).not.toThrow();
  });

});
