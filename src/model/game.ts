import { combine, createEffect, createEvent, createStore, sample } from 'effector';
import { loadState, saveState, StorageConflictError, subscribeToExternalStorageChanges } from '../lib/storage';
import { getGameStartIssues, getSessionContinuationIssues, isSha256 } from './validation';
import { cloneGame, cloneSong, createCategory, createGame, createInterRoundStage, createQuestion, createRound, createRoundStage, createSession, createTeam } from './defaults';
import { DATA_LIMITS, GAME_LIMITS } from './limits';
import { findQuestion, getActiveStage, getInterRoundForStage, getRoundForStage, getRoundOrdinal, isRoundComplete, normalizeSession, reconcileSession } from './session';
import { createCommonThemeStage, createContinueLyricsTask, createInterRound, getInterRoundAnswerStepCount, getInterRoundTrackIds } from '../interRounds/templates';
import type {
  AudioAsset,
  GameConfig,
  GameSession,
  InterRound,
  InterRoundTemplateId,
  MediaTrack,
  PersistedState,
  PlayableQuestion,
  Question,
  Screen,
  Song,
  Team,
} from './types';

const initialGame = createGame('Угадай мелодию');

export const appStarted = createEvent();
export const storageRetryRequested = createEvent();
const externalStorageChangeDetected = createEvent<number>();
const storageErrorCleared = createEvent();
export const screenChanged = createEvent<Screen>();
export const activeGameChanged = createEvent<string>();
export const gameCreated = createEvent<string>();
export const gameDuplicated = createEvent<string>();
export const gameDeleted = createEvent<string>();
export const gameRestarted = createEvent();
export const persistedStateImported = createEvent<PersistedState>();

export const questionOpened = createEvent<string>();
export const questionClosed = createEvent<{ completed: boolean }>();
export const teamAwarded = createEvent<string>();
export const teamIncorrectToggled = createEvent<string>();
export const nobodyGuessed = createEvent();
export const teamScoreChanged = createEvent<{ teamId: string; score: number }>();
export const nextStageRequested = createEvent();
export const nextRoundRequested = nextStageRequested;

export const gameTitleChanged = createEvent<string>();
export const roundAdded = createEvent();
export const roundRemoved = createEvent<string>();
export const roundNameChanged = createEvent<{ roundId: string; name: string }>();
export const stageMoved = createEvent<{ stageId: string; direction: -1 | 1 }>();
export const interRoundAdded = createEvent<InterRoundTemplateId>();
export const interRoundRemoved = createEvent<string>();
export const interRoundTitleChanged = createEvent<{ interRoundId: string; title: string }>();
export const continueLyricsTaskAdded = createEvent<string>();
export const continueLyricsTaskRemoved = createEvent<{ interRoundId: string; taskId: string }>();
export const continueLyricsTaskChanged = createEvent<{ interRoundId: string; taskId: string; patch: Partial<Pick<Extract<InterRound, { templateId: 'continueLyrics' }>['tasks'][number], 'trackId' | 'requiredWordsCount' | 'cutAtMs' | 'answerText'>> }>();
export const commonThemeStageAdded = createEvent<string>();
export const commonThemeStageRemoved = createEvent<{ interRoundId: string; stageId: string }>();
export const commonThemeTrackChanged = createEvent<{ interRoundId: string; stageId: string; itemId: string; patch: Partial<Pick<Extract<InterRound, { templateId: 'commonTheme4' }>['stages'][number]['tracks'][number], 'trackId' | 'answerTitle' | 'answerArtist'>> }>();
export const commonThemeChanged = createEvent<{ interRoundId: string; stageId: string; commonTheme: string }>();
export const interRoundStarted = createEvent();
export const interRoundAnswerRevealed = createEvent();
export const commonThemeTrackAdvanced = createEvent();
export const interRoundNextRequested = createEvent();
export const categoryAdded = createEvent<{ roundId: string }>();
export const categoryRemoved = createEvent<{ roundId: string; categoryId: string }>();
export const categoryNameChanged = createEvent<{ roundId: string; categoryId: string; name: string }>();
export const questionAdded = createEvent<{ roundId: string; categoryId: string }>();
export const questionRemoved = createEvent<{ roundId: string; categoryId: string; questionId: string }>();
export const questionChanged = createEvent<{
  roundId: string;
  categoryId: string;
  questionId: string;
  patch: Partial<Pick<Question, 'points'>>;
}>();
export const questionSongChanged = createEvent<{
  roundId: string;
  categoryId: string;
  questionId: string;
  songId?: string;
}>();
export const teamAdded = createEvent();
export const teamRemoved = createEvent<string>();
export const teamChanged = createEvent<{ teamId: string; patch: Partial<Pick<Team, 'name' | 'color'>> }>();

export const songAdded = createEvent<{ song: Song; mediaTracks: MediaTrack[]; audioAssets: AudioAsset[] }>();
export const mediaTrackAdded = createEvent<{ track: MediaTrack; audioAsset: AudioAsset }>();
export const mediaTrackChanged = createEvent<{ trackId: string; patch: Partial<Pick<MediaTrack, 'name'>> }>();
export const mediaTrackAudioChanged = createEvent<{ trackId: string; audioAsset: AudioAsset }>();
export const mediaTrackDeleteRequested = createEvent<string>();
export const songChanged = createEvent<{ songId: string; patch: Partial<Pick<Song, 'artist' | 'title'>> }>();
export const songDuplicated = createEvent<string>();
export const songDeleteRequested = createEvent<string>();
export const songTrackChanged = createEvent<{
  songId: string;
  kind: 'minus' | 'plus';
  trackId?: string;
  track?: MediaTrack;
  audioAsset?: AudioAsset;
}>();
const mediaTrackAdditionApplied = createEvent<{ track: MediaTrack; audioAsset: AudioAsset }>();
const mediaTrackAudioChangeApplied = createEvent<{ trackId: string; audioAsset: AudioAsset; removableAudioId?: string }>();
const songTrackChangeApplied = createEvent<{
  songId: string;
  kind: 'minus' | 'plus';
  trackId?: string;
  track?: MediaTrack;
  audioAsset?: AudioAsset;
}>();
const mediaTrackDeletionApplied = createEvent<{ trackId: string; removableAudioId?: string }>();
const songDeletionApplied = createEvent<{ songId: string; removableAudioIds: string[] }>();
const gameDeletionApplied = createEvent<{ gameId: string; nextActiveGameId: string | null }>();

const gamePrepared = createEvent<{ game: GameConfig; session: GameSession }>();
const gameConfigUpdated = createEvent<GameConfig>();

const loadFx = createEffect(loadState);
const saveFx = createEffect(saveState);

export const $storageError = createStore<string | null>(null)
  .on(loadFx.failData, (_, error) => storageErrorMessage(error, 'Не удалось открыть локальное хранилище.'))
  .on(saveFx.failData, (_, error) => storageErrorMessage(error, 'Не удалось сохранить изменения в локальное хранилище.'))
  .on(externalStorageChangeDetected, () => 'Данные были изменены в другой вкладке. Эта вкладка переведена в режим только чтения, чтобы не затереть более новую версию. Перезагрузите страницу.')
  .on(loadFx.done, () => null)
  .on(storageErrorCleared, () => null);

export const $storageReadOnly = createStore(false)
  .on(externalStorageChangeDetected, () => true)
  .on(saveFx.failData, (readOnly, error) => error instanceof StorageConflictError ? true : readOnly)
  .on(loadFx.done, () => false);

export const $storageSaveStatus = createStore<'idle' | 'saving' | 'saved' | 'error'>('idle')
  .on(saveFx, () => 'saving')
  .on(saveFx.done, () => 'saved')
  .on(saveFx.fail, () => 'error');

sample({
  clock: saveFx.done,
  source: $storageReadOnly,
  filter: (readOnly) => !readOnly,
  target: storageErrorCleared,
});

export const $screen = createStore<Screen>('library').on(screenChanged, (_, screen) => screen);
export const $hydrated = createStore(false)
  .on(loadFx.done, () => true)
  .on(loadFx.fail, () => false);
export const $games = createStore<GameConfig[]>([initialGame]);
export const $songs = createStore<Song[]>([]);
export const $mediaTracks = createStore<MediaTrack[]>([]);
export const $audioAssets = createStore<AudioAsset[]>([]);
export const $sessions = createStore<Record<string, GameSession>>({ [initialGame.id]: createSession(initialGame) });
export const $activeGameId = createStore<string | null>(initialGame.id);

$games
  .on(loadFx.doneData, (_, state) => state.games)
  .on(gamePrepared, (games, { game }) => [...games, game])
  .on(gameConfigUpdated, (games, updated) => games.map((game) => (game.id === updated.id ? updated : game)))
  .on(gameDeletionApplied, (games, { gameId }) => games.filter((game) => game.id !== gameId))
  .on(songDeletionApplied, (games, { songId }) => games.map((game) => {
    let changed = false;
    const rounds = game.rounds.map((round) => ({
      ...round,
      categories: round.categories.map((category) => ({
        ...category,
        questions: category.questions.map((question) => {
          if (question.songId !== songId) return question;
          changed = true;
          return { id: question.id, points: question.points };
        }),
      })),
    }));
    return changed ? { ...game, rounds, updatedAt: Date.now() } : game;
  }))
  .on(persistedStateImported, (_, state) => state.games);

$songs
  .on(loadFx.doneData, (_, state) => state.songs)
  .on(songAdded, (songs, { song }) => {
    if (songs.some((item) => item.id === song.id)) return songs;
    if (song.artist.length > DATA_LIMITS.text.artist || song.title.length > DATA_LIMITS.text.songTitle || (!song.artist.trim() && !song.title.trim())) return songs;
    return [...songs, song];
  })
  .on(songDuplicated, (songs, songId) => {
    const source = songs.find((song) => song.id === songId);
    return source ? [...songs, cloneSong(source)] : songs;
  })
  .on(songChanged, (songs, { songId, patch }) => {
    if ((patch.artist !== undefined && patch.artist.length > DATA_LIMITS.text.artist) || (patch.title !== undefined && patch.title.length > DATA_LIMITS.text.songTitle)) return songs;
    return songs.map((song) => {
      if (song.id !== songId) return song;
      const next = { ...song, ...patch };
      if (!next.artist.trim() && !next.title.trim()) return song;
      return { ...next, updatedAt: Date.now() };
    });
  })
  .on(songTrackChangeApplied, (songs, { songId, kind, trackId }) =>
    songs.map((song) =>
      song.id === songId
        ? {
            ...song,
            [kind === 'minus' ? 'minusTrackId' : 'plusTrackId']: trackId,
            updatedAt: Date.now(),
          }
        : song,
    ),
  )
  .on(songDeletionApplied, (songs, { songId }) => songs.filter((song) => song.id !== songId))
  .on(persistedStateImported, (_, state) => state.songs);

$mediaTracks
  .on(loadFx.doneData, (_, state) => state.mediaTracks)
  .on(songAdded, (tracks, { mediaTracks }) => mergeById(tracks, mediaTracks))
  .on(mediaTrackAdditionApplied, (tracks, { track }) => mergeById(tracks, [track]))
  .on(mediaTrackChanged, (tracks, { trackId, patch }) => tracks.map((track) => {
    if (track.id !== trackId) return track;
    const name = patch.name ?? track.name;
    if (!name.trim() || name.length > DATA_LIMITS.text.mediaTrackName) return track;
    return { ...track, ...patch, updatedAt: Date.now() };
  }))
  .on(mediaTrackAudioChangeApplied, (tracks, { trackId, audioAsset }) => tracks.map((track) =>
    track.id === trackId ? { ...track, audioId: audioAsset.id, updatedAt: Date.now() } : track,
  ))
  .on(songTrackChangeApplied, (tracks, { track }) => track ? mergeById(tracks, [track]) : tracks)
  .on(mediaTrackDeletionApplied, (tracks, { trackId }) => tracks.filter((track) => track.id !== trackId))
  .on(persistedStateImported, (_, state) => state.mediaTracks);

$audioAssets
  .on(loadFx.doneData, (_, state) => state.audioAssets)
  .on(songAdded, (assets, { audioAssets }) => mergeAudioAssets(assets, audioAssets))
  .on(mediaTrackAdditionApplied, (assets, { audioAsset }) => mergeAudioAssets(assets, [audioAsset]))
  .on(mediaTrackAudioChangeApplied, (assets, { audioAsset, removableAudioId }) => {
    const withoutOld = removableAudioId && removableAudioId !== audioAsset.id ? assets.filter((asset) => asset.id !== removableAudioId) : assets;
    return mergeAudioAssets(withoutOld, [audioAsset]);
  })
  .on(songTrackChangeApplied, (assets, { audioAsset }) => audioAsset ? mergeAudioAssets(assets, [audioAsset]) : assets)
  .on(mediaTrackDeletionApplied, (assets, { removableAudioId }) => removableAudioId ? assets.filter((asset) => asset.id !== removableAudioId) : assets)
  .on(persistedStateImported, (_, state) => state.audioAssets);

$sessions
  .on(loadFx.doneData, (_, state) => Object.fromEntries(state.sessions.map((session) => {
    const game = state.games.find((item) => item.id === session.gameId);
    return [session.gameId, game ? reconcileSession(game, session) : normalizeSession(session)];
  })))
  .on(gamePrepared, (sessions, { session }) => ({ ...sessions, [session.gameId]: session }))
  .on(gameDeletionApplied, (sessions, { gameId }) => {
    const next = { ...sessions };
    delete next[gameId];
    return next;
  })
  .on(persistedStateImported, (_, state) =>
    Object.fromEntries(state.sessions.map((session) => {
      const game = state.games.find((item) => item.id === session.gameId);
      return [session.gameId, game ? reconcileSession(game, session) : normalizeSession(session)];
    })),
  );

$activeGameId
  .on(loadFx.doneData, (_, state) => state.activeGameId ?? state.games[0]?.id ?? null)
  .on(activeGameChanged, (_, gameId) => gameId)
  .on(gamePrepared, (_, { game }) => game.id)
  .on(gameDeletionApplied, (activeGameId, { gameId, nextActiveGameId }) =>
    activeGameId === gameId ? nextActiveGameId : activeGameId,
  )
  .on(persistedStateImported, (_, state) => state.activeGameId ?? state.games[0]?.id ?? null);

sample({ clock: [appStarted, storageRetryRequested], target: loadFx });

sample({
  clock: gameCreated,
  fn: (title) => {
    const game = createGame(title.trim() || 'Новая игра');
    return { game, session: createSession(game) };
  },
  target: gamePrepared,
});

sample({
  clock: gameDuplicated,
  source: $games,
  filter: (games, gameId) => games.some((game) => game.id === gameId),
  fn: (games, gameId) => {
    const source = games.find((game) => game.id === gameId)!;
    const game = cloneGame(source);
    return { game, session: createSession(game) };
  },
  target: gamePrepared,
});

sample({
  clock: gameDeleted,
  source: combine({ games: $games, activeGameId: $activeGameId }),
  filter: ({ games }, gameId) => games.some((game) => game.id === gameId),
  fn: ({ games, activeGameId }, gameId) => ({
    gameId,
    nextActiveGameId: activeGameId === gameId ? games.find((game) => game.id !== gameId)?.id ?? null : activeGameId,
  }),
  target: gameDeletionApplied,
});

export const $activeGame = combine($games, $activeGameId, (games, activeGameId) =>
  games.find((game) => game.id === activeGameId) ?? null,
);

export const $session = combine($sessions, $activeGame, (sessions, game) => (game ? sessions[game.id] ?? null : null));

sample({
  clock: gameRestarted,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game }) => Boolean(game),
  fn: ({ game, sessions }) => ({ ...sessions, [game!.id]: createSession(game!) }),
  target: $sessions,
});

sample({
  clock: questionOpened,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }, questionId) => {
    if (!game) return false;
    const session = sessions[game.id];
    if (!session) return false;
    const round = getRoundForStage(game, getActiveStage(game, session));
    return Boolean(round?.categories.some((category) => category.questions.some((question) => question.id === questionId)) && !session.completedQuestionIds.includes(questionId));
  },
  fn: ({ game, sessions }, questionId) => {
    const session = sessions[game!.id];
    return {
      ...sessions,
      [game!.id]: {
        ...session,
        started: true,
        activeQuestionId: questionId,
        awardedTeamId: null,
        answerRevealed: false,
        activeExcludedTeamIds: unique(session.nextExcludedTeamIds),
        currentIncorrectTeamIds: [],
        nextExcludedTeamIds: [],
      },
    };
  },
  target: $sessions,
});

sample({
  clock: questionClosed,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }) => Boolean(game && sessions[game.id]),
  fn: ({ game, sessions }, { completed }) => {
    const session = sessions[game!.id];
    return {
      ...sessions,
      [game!.id]: {
        ...session,
        activeQuestionId: null,
        awardedTeamId: null,
        answerRevealed: false,
        activeExcludedTeamIds: [],
        currentIncorrectTeamIds: [],
        nextExcludedTeamIds: completed
          ? session.nextExcludedTeamIds
          : unique(session.activeExcludedTeamIds),
      },
    };
  },
  target: $sessions,
});

sample({
  clock: teamAwarded,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }, teamId) => {
    if (!game) return false;
    const session = sessions[game.id];
    return Boolean(
      session?.activeQuestionId &&
        game.teams.some((team) => team.id === teamId) &&
        !session.answerRevealed &&
        !session.activeExcludedTeamIds.includes(teamId) &&
        !session.currentIncorrectTeamIds.includes(teamId) &&
        !session.completedQuestionIds.includes(session.activeQuestionId),
    );
  },
  fn: ({ game, sessions }, teamId) => {
    const session = sessions[game!.id];
    const question = findQuestion(game!, session.activeQuestionId!);
    return {
      ...sessions,
      [game!.id]: {
        ...session,
        awardedTeamId: teamId,
        answerRevealed: true,
        completedQuestionIds: unique([...session.completedQuestionIds, session.activeQuestionId!]),
        scores: { ...session.scores, [teamId]: (session.scores[teamId] ?? 0) + (question?.points ?? 0) },
      },
    };
  },
  target: $sessions,
});

sample({
  clock: teamIncorrectToggled,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }, teamId) => {
    if (!game) return false;
    const session = sessions[game.id];
    return Boolean(session?.activeQuestionId && game.teams.some((team) => team.id === teamId) && !session.answerRevealed && !session.activeExcludedTeamIds.includes(teamId));
  },
  fn: ({ game, sessions }, teamId) => {
    const session = sessions[game!.id];
    const isIncorrect = session.currentIncorrectTeamIds.includes(teamId);
    return {
      ...sessions,
      [game!.id]: {
        ...session,
        currentIncorrectTeamIds: isIncorrect
          ? session.currentIncorrectTeamIds.filter((id) => id !== teamId)
          : unique([...session.currentIncorrectTeamIds, teamId]),
        nextExcludedTeamIds: isIncorrect
          ? session.nextExcludedTeamIds.filter((id) => id !== teamId)
          : unique([...session.nextExcludedTeamIds, teamId]),
      },
    };
  },
  target: $sessions,
});

sample({
  clock: nobodyGuessed,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }) => {
    if (!game) return false;
    const session = sessions[game.id];
    return Boolean(
      session?.activeQuestionId &&
        !session.answerRevealed &&
        !session.completedQuestionIds.includes(session.activeQuestionId),
    );
  },
  fn: ({ game, sessions }) => {
    const session = sessions[game!.id];
    return {
      ...sessions,
      [game!.id]: {
        ...session,
        awardedTeamId: null,
        answerRevealed: true,
        completedQuestionIds: unique([...session.completedQuestionIds, session.activeQuestionId!]),
      },
    };
  },
  target: $sessions,
});

sample({
  clock: teamScoreChanged,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }, { teamId, score }) => Boolean(
    game && sessions[game.id] && game.teams.some((team) => team.id === teamId) && Number.isSafeInteger(score),
  ),
  fn: ({ game, sessions }, { teamId, score }) => {
    const session = sessions[game!.id];
    return { ...sessions, [game!.id]: { ...session, scores: { ...session.scores, [teamId]: score } } };
  },
  target: $sessions,
});

sample({
  clock: nextStageRequested,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }) => {
    if (!game) return false;
    const session = sessions[game.id];
    if (!session || session.stageIndex >= game.stages.length) return false;
    const stage = getActiveStage(game, session);
    return stage?.kind === 'round' ? isRoundComplete(game, session) : false;
  },
  fn: ({ game, sessions }) => {
    const session = sessions[game!.id];
    return {
      ...sessions,
      [game!.id]: {
        ...session,
        stageIndex: Math.min(session.stageIndex + 1, game!.stages.length),
        activeQuestionId: null,
        interRound: null,
        awardedTeamId: null,
        answerRevealed: false,
        activeExcludedTeamIds: [],
        currentIncorrectTeamIds: [],
      },
    };
  },
  target: $sessions,
});

sample({
  clock: interRoundStarted,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }) => {
    if (!game) return false;
    const session = sessions[game.id];
    return Boolean(session && getActiveStage(game, session)?.kind === 'interRound');
  },
  fn: ({ game, sessions }) => {
    const session = sessions[game!.id];
    const interRound = getInterRoundForStage(game!, getActiveStage(game!, session));
    if (!interRound) return sessions;
    return {
      ...sessions,
      [game!.id]: { ...session, started: true, interRound: { interRoundId: interRound.id, phase: 'play' as const, taskIndex: 0, trackIndex: 0 } },
    };
  },
  target: $sessions,
});

sample({
  clock: commonThemeTrackAdvanced,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }) => {
    if (!game) return false;
    const session = sessions[game.id];
    const interRound = session ? getInterRoundForStage(game, getActiveStage(game, session)) : null;
    return Boolean(
      session?.interRound?.phase === 'play'
      && interRound?.templateId === 'commonTheme4'
      && session.interRound.taskIndex < interRound.stages.length
      && session.interRound.trackIndex < 4,
    );
  },
  fn: ({ game, sessions }) => {
    const session = sessions[game!.id];
    return {
      ...sessions,
      [game!.id]: {
        ...session,
        interRound: session.interRound
          ? { ...session.interRound, trackIndex: Math.min(session.interRound.trackIndex + 1, 4) }
          : null,
      },
    };
  },
  target: $sessions,
});

sample({
  clock: interRoundAnswerRevealed,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }) => {
    if (!game) return false;
    const session = sessions[game.id];
    if (session?.interRound?.phase !== 'play') return false;
    const interRound = getInterRoundForStage(game, getActiveStage(game, session));
    return interRound?.templateId === 'commonTheme4' ? session.interRound.trackIndex >= 4 : Boolean(interRound);
  },
  fn: ({ game, sessions }) => {
    const session = sessions[game!.id];
    return { ...sessions, [game!.id]: { ...session, interRound: session.interRound ? { ...session.interRound, phase: 'answer' as const } : null } };
  },
  target: $sessions,
});

sample({
  clock: interRoundNextRequested,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }) => {
    if (!game) return false;
    const session = sessions[game.id];
    const interRound = session ? getInterRoundForStage(game, getActiveStage(game, session)) : null;
    return Boolean(session?.interRound?.phase === 'answer' && interRound);
  },
  fn: ({ game, sessions }) => {
    const session = sessions[game!.id];
    const interRound = getInterRoundForStage(game!, getActiveStage(game!, session))!;
    const taskCount = getInterRoundAnswerStepCount(interRound);
    const nextTaskIndex = (session.interRound?.taskIndex ?? 0) + 1;
    if (nextTaskIndex < taskCount) {
      return {
        ...sessions,
        [game!.id]: { ...session, interRound: { interRoundId: interRound.id, phase: 'play' as const, taskIndex: nextTaskIndex, trackIndex: 0 } },
      };
    }
    return {
      ...sessions,
      [game!.id]: {
        ...session,
        stageIndex: Math.min(session.stageIndex + 1, game!.stages.length),
        completedInterRoundIds: unique([...session.completedInterRoundIds, interRound.id]),
        interRound: null,
      },
    };
  },
  target: $sessions,
});

const activeGameSource = combine({ game: $activeGame });

sample({
  clock: gameTitleChanged,
  source: activeGameSource,
  filter: ({ game }, title) => Boolean(game && title.length <= DATA_LIMITS.text.gameTitle),
  fn: ({ game }, title) => touchGame({ ...game!, title }),
  target: gameConfigUpdated,
});

sample({
  clock: roundAdded,
  source: activeGameSource,
  filter: ({ game }) => Boolean(game && game.rounds.length < GAME_LIMITS.rounds),
  fn: ({ game }) => {
    const round = createRound(game!.rounds.length);
    return touchGame({ ...game!, rounds: [...game!.rounds, round], stages: [...game!.stages, createRoundStage(round.id)] });
  },
  target: gameConfigUpdated,
});

sample({
  clock: roundRemoved,
  source: activeGameSource,
  filter: ({ game }, roundId) => Boolean(game && game.rounds.length > 1 && game.rounds.some((round) => round.id === roundId)),
  fn: ({ game }, roundId) => touchGame({
    ...game!,
    rounds: game!.rounds.filter((round) => round.id !== roundId),
    stages: game!.stages.filter((stage) => stage.kind !== 'round' || stage.roundId !== roundId),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: roundNameChanged,
  source: activeGameSource,
  filter: ({ game }, { name }) => Boolean(game && name.length <= DATA_LIMITS.text.roundName),
  fn: ({ game }, payload) => touchGame({
    ...game!,
    rounds: game!.rounds.map((round) => (round.id === payload.roundId ? { ...round, name: payload.name } : round)),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: stageMoved,
  source: activeGameSource,
  filter: ({ game }, { stageId, direction }) => {
    if (!game) return false;
    const index = game.stages.findIndex((stage) => stage.id === stageId);
    const nextIndex = index + direction;
    return index >= 0 && nextIndex >= 0 && nextIndex < game.stages.length;
  },
  fn: ({ game }, { stageId, direction }) => {
    const stages = [...game!.stages];
    const index = stages.findIndex((stage) => stage.id === stageId);
    const nextIndex = index + direction;
    [stages[index], stages[nextIndex]] = [stages[nextIndex], stages[index]];
    return touchGame({ ...game!, stages });
  },
  target: gameConfigUpdated,
});

sample({
  clock: interRoundAdded,
  source: activeGameSource,
  filter: ({ game }) => Boolean(game && game.interRounds.length < GAME_LIMITS.interRounds),
  fn: ({ game }, templateId) => {
    const interRound = createInterRound(templateId, game!.interRounds.filter((item) => item.templateId === templateId).length);
    return touchGame({
      ...game!,
      interRounds: [...game!.interRounds, interRound],
      stages: [...game!.stages, createInterRoundStage(interRound.id)],
    });
  },
  target: gameConfigUpdated,
});

sample({
  clock: interRoundRemoved,
  source: activeGameSource,
  filter: ({ game }, interRoundId) => Boolean(game?.interRounds.some((item) => item.id === interRoundId)),
  fn: ({ game }, interRoundId) => touchGame({
    ...game!,
    interRounds: game!.interRounds.filter((item) => item.id !== interRoundId),
    stages: game!.stages.filter((stage) => stage.kind !== 'interRound' || stage.interRoundId !== interRoundId),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: interRoundTitleChanged,
  source: activeGameSource,
  filter: ({ game }, { interRoundId, title }) => Boolean(game && title.length <= DATA_LIMITS.text.interRoundTitle && game.interRounds.some((item) => item.id === interRoundId)),
  fn: ({ game }, { interRoundId, title }) => touchGame({
    ...game!,
    interRounds: game!.interRounds.map((item) => item.id === interRoundId ? { ...item, title } : item),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: continueLyricsTaskAdded,
  source: activeGameSource,
  filter: ({ game }, interRoundId) => Boolean(game?.interRounds.some((item) => item.id === interRoundId && item.templateId === 'continueLyrics' && item.tasks.length < GAME_LIMITS.continueLyricsTasks)),
  fn: ({ game }, interRoundId) => touchGame({
    ...game!,
    interRounds: game!.interRounds.map((item) => item.id === interRoundId && item.templateId === 'continueLyrics'
      ? { ...item, tasks: [...item.tasks, createContinueLyricsTask()] }
      : item),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: continueLyricsTaskRemoved,
  source: activeGameSource,
  filter: ({ game }, { interRoundId, taskId }) => Boolean(game?.interRounds.some((item) => item.id === interRoundId && item.templateId === 'continueLyrics' && item.tasks.length > 1 && item.tasks.some((task) => task.id === taskId))),
  fn: ({ game }, { interRoundId, taskId }) => touchGame({
    ...game!,
    interRounds: game!.interRounds.map((item) => item.id === interRoundId && item.templateId === 'continueLyrics'
      ? { ...item, tasks: item.tasks.filter((task) => task.id !== taskId) }
      : item),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: continueLyricsTaskChanged,
  source: activeGameSource,
  filter: ({ game }, { interRoundId, taskId, patch }) => Boolean(game
    && game.interRounds.some((item) => item.id === interRoundId && item.templateId === 'continueLyrics' && item.tasks.some((task) => task.id === taskId))
    && (patch.answerText === undefined || patch.answerText.length <= DATA_LIMITS.text.interRoundAnswer)
    && (patch.trackId === undefined || patch.trackId.length <= DATA_LIMITS.text.id)
    && (patch.requiredWordsCount === undefined || (Number.isSafeInteger(patch.requiredWordsCount) && patch.requiredWordsCount >= 1 && patch.requiredWordsCount <= 100))
    && (patch.cutAtMs === undefined || (Number.isSafeInteger(patch.cutAtMs) && patch.cutAtMs >= 500 && patch.cutAtMs <= 21_600_000))),
  fn: ({ game }, { interRoundId, taskId, patch }) => touchGame({
    ...game!,
    interRounds: game!.interRounds.map((item) => item.id === interRoundId && item.templateId === 'continueLyrics'
      ? { ...item, tasks: item.tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task) }
      : item),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: commonThemeStageAdded,
  source: activeGameSource,
  filter: ({ game }, interRoundId) => Boolean(game && game.interRounds.some((item) => item.id === interRoundId && item.templateId === 'commonTheme4' && item.stages.length < GAME_LIMITS.commonThemeStages)),
  fn: ({ game }, interRoundId) => touchGame({
    ...game!,
    interRounds: game!.interRounds.map((item) => item.id === interRoundId && item.templateId === 'commonTheme4'
      ? { ...item, stages: [...item.stages, createCommonThemeStage()] }
      : item),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: commonThemeStageRemoved,
  source: activeGameSource,
  filter: ({ game }, { interRoundId, stageId }) => Boolean(game && game.interRounds.some((item) => item.id === interRoundId && item.templateId === 'commonTheme4' && item.stages.length > 1 && item.stages.some((stage) => stage.id === stageId))),
  fn: ({ game }, { interRoundId, stageId }) => touchGame({
    ...game!,
    interRounds: game!.interRounds.map((item) => item.id === interRoundId && item.templateId === 'commonTheme4'
      ? { ...item, stages: item.stages.filter((stage) => stage.id !== stageId) }
      : item),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: commonThemeTrackChanged,
  source: activeGameSource,
  filter: ({ game }, { interRoundId, stageId, itemId, patch }) => Boolean(game
    && game.interRounds.some((item) => item.id === interRoundId && item.templateId === 'commonTheme4' && item.stages.some((stage) => stage.id === stageId && stage.tracks.some((track) => track.id === itemId)))
    && (patch.answerTitle === undefined || patch.answerTitle.length <= DATA_LIMITS.text.songTitle)
    && (patch.answerArtist === undefined || patch.answerArtist.length <= DATA_LIMITS.text.artist)
    && (patch.trackId === undefined || patch.trackId.length <= DATA_LIMITS.text.id)),
  fn: ({ game }, { interRoundId, stageId, itemId, patch }) => touchGame({
    ...game!,
    interRounds: game!.interRounds.map((item) => item.id === interRoundId && item.templateId === 'commonTheme4'
      ? {
          ...item,
          stages: item.stages.map((stage) => stage.id === stageId
            ? { ...stage, tracks: stage.tracks.map((track) => track.id === itemId ? { ...track, ...patch } : track) as typeof stage.tracks }
            : stage),
        }
      : item),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: commonThemeChanged,
  source: activeGameSource,
  filter: ({ game }, { interRoundId, stageId, commonTheme }) => Boolean(game
    && commonTheme.length <= DATA_LIMITS.text.commonTheme
    && game.interRounds.some((item) => item.id === interRoundId && item.templateId === 'commonTheme4' && item.stages.some((stage) => stage.id === stageId))),
  fn: ({ game }, { interRoundId, stageId, commonTheme }) => touchGame({
    ...game!,
    interRounds: game!.interRounds.map((item) => item.id === interRoundId && item.templateId === 'commonTheme4'
      ? { ...item, stages: item.stages.map((stage) => stage.id === stageId ? { ...stage, commonTheme } : stage) }
      : item),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: categoryAdded,
  source: activeGameSource,
  filter: ({ game }, { roundId }) => Boolean(
    game && game.rounds.some((round) => round.id === roundId && round.categories.length < GAME_LIMITS.categoriesPerRound),
  ),
  fn: ({ game }, { roundId }) => touchGame({
    ...game!,
    rounds: game!.rounds.map((round) =>
      round.id === roundId ? { ...round, categories: [...round.categories, createCategory(round.categories.length)] } : round,
    ),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: categoryRemoved,
  source: activeGameSource,
  filter: ({ game }, { roundId, categoryId }) => Boolean(
    game && game.rounds.some((round) => round.id === roundId && round.categories.length > 1 && round.categories.some((category) => category.id === categoryId)),
  ),
  fn: ({ game }, { roundId, categoryId }) => touchGame({
    ...game!,
    rounds: game!.rounds.map((round) =>
      round.id === roundId
        ? { ...round, categories: round.categories.filter((category) => category.id !== categoryId) }
        : round,
    ),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: categoryNameChanged,
  source: activeGameSource,
  filter: ({ game }, { name }) => Boolean(game && name.length <= DATA_LIMITS.text.categoryName),
  fn: ({ game }, payload) => touchGame({
    ...game!,
    rounds: game!.rounds.map((round) =>
      round.id === payload.roundId
        ? {
            ...round,
            categories: round.categories.map((category) =>
              category.id === payload.categoryId ? { ...category, name: payload.name } : category,
            ),
          }
        : round,
    ),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: questionAdded,
  source: activeGameSource,
  filter: ({ game }, { roundId, categoryId }) => Boolean(
    game && game.rounds.some((round) => round.id === roundId && round.categories.some(
      (category) => category.id === categoryId && category.questions.length < GAME_LIMITS.questionsPerCategory,
    )),
  ),
  fn: ({ game }, { roundId, categoryId }) => touchGame({
    ...game!,
    rounds: game!.rounds.map((round) =>
      round.id === roundId
        ? {
            ...round,
            categories: round.categories.map((category) => {
              if (category.id !== categoryId) return category;
              const lastPoints = category.questions.at(-1)?.points ?? 0;
              return { ...category, questions: [...category.questions, createQuestion(lastPoints + 100)] };
            }),
          }
        : round,
    ),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: questionRemoved,
  source: activeGameSource,
  filter: ({ game }, payload) => Boolean(
    game && game.rounds.some((round) => round.id === payload.roundId && round.categories.some(
      (category) => category.id === payload.categoryId && category.questions.length > 1 && category.questions.some((question) => question.id === payload.questionId),
    )),
  ),
  fn: ({ game }, payload) => touchGame(updateQuestionCollection(game!, payload, (questions) =>
    questions.filter((question) => question.id !== payload.questionId),
  )),
  target: gameConfigUpdated,
});

sample({
  clock: questionChanged,
  source: activeGameSource,
  filter: ({ game }, { roundId, categoryId, questionId, patch }) => {
    if (!game || patch.points === undefined) return Boolean(game);
    if (!Number.isSafeInteger(patch.points) || patch.points <= 0 || patch.points > DATA_LIMITS.maxQuestionPoints) return false;
    const category = game.rounds.find((round) => round.id === roundId)?.categories.find((item) => item.id === categoryId);
    return Boolean(category && !category.questions.some((question) => question.id !== questionId && question.points === patch.points));
  },
  fn: ({ game }, payload) => touchGame(updateQuestion(game!, payload, (question) => ({ ...question, ...payload.patch }))),
  target: gameConfigUpdated,
});

sample({
  clock: questionSongChanged,
  source: combine({ game: $activeGame, songs: $songs }),
  filter: ({ game, songs }, { songId }) => Boolean(game && (!songId || songs.some((song) => song.id === songId))),
  fn: ({ game }, payload) => touchGame(updateQuestion(game!, payload, (question) => ({ ...question, songId: payload.songId }))),
  target: gameConfigUpdated,
});

sample({
  clock: teamAdded,
  source: activeGameSource,
  filter: ({ game }) => Boolean(game && game.teams.length < GAME_LIMITS.teams),
  fn: ({ game }) => touchGame({ ...game!, teams: [...game!.teams, createTeam(game!.teams.length)] }),
  target: gameConfigUpdated,
});

sample({
  clock: teamRemoved,
  source: activeGameSource,
  filter: ({ game }) => Boolean(game),
  fn: ({ game }, teamId) => touchGame({
    ...game!,
    teams: game!.teams.length > 1 ? game!.teams.filter((team) => team.id !== teamId) : game!.teams,
  }),
  target: gameConfigUpdated,
});

sample({
  clock: teamChanged,
  source: activeGameSource,
  filter: ({ game }, { teamId, patch }) => {
    if (!game || (patch.name !== undefined && patch.name.length > DATA_LIMITS.text.teamName) || (patch.color !== undefined && !/^#[0-9a-f]{6}$/i.test(patch.color))) return false;
    if (patch.name?.trim()) {
      const normalized = patch.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
      if (game.teams.some((team) => team.id !== teamId && team.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU') === normalized)) return false;
    }
    if (patch.color && game.teams.some((team) => team.id !== teamId && team.color.toLowerCase() === patch.color!.toLowerCase())) return false;
    return true;
  },
  fn: ({ game }, { teamId, patch }) => touchGame({
    ...game!,
    teams: game!.teams.map((team) => (team.id === teamId ? { ...team, ...patch } : team)),
  }),
  target: gameConfigUpdated,
});

sample({
  clock: gameConfigUpdated,
  source: $sessions,
  fn: (sessions, config) => ({
    ...sessions,
    [config.id]: reconcileSession(config, sessions[config.id] ?? createSession(config)),
  }),
  target: $sessions,
});

sample({
  clock: mediaTrackAdded,
  filter: ({ track, audioAsset }) => track.name.trim().length > 0
    && track.name.length <= DATA_LIMITS.text.mediaTrackName
    && track.audioId === audioAsset.id
    && audioAsset.id === audioAsset.sha256
    && isSha256(audioAsset.id)
    && audioAsset.verified === true
    && audioAsset.blob instanceof Blob
    && audioAsset.blob.size > 0,
  target: mediaTrackAdditionApplied,
});

sample({
  clock: mediaTrackAudioChanged,
  source: $mediaTracks,
  filter: (tracks, { trackId, audioAsset }) => tracks.some((track) => track.id === trackId)
    && audioAsset.id === audioAsset.sha256
    && isSha256(audioAsset.id)
    && audioAsset.verified === true
    && audioAsset.blob instanceof Blob
    && audioAsset.blob.size > 0,
  fn: (tracks, { trackId, audioAsset }) => {
    const current = tracks.find((track) => track.id === trackId)!;
    const removableAudioId = current.audioId !== audioAsset.id
      && !tracks.some((track) => track.id !== trackId && track.audioId === current.audioId)
      ? current.audioId
      : undefined;
    return { trackId, audioAsset, removableAudioId };
  },
  target: mediaTrackAudioChangeApplied,
});

sample({
  clock: songTrackChanged,
  source: combine({ songs: $songs, mediaTracks: $mediaTracks }),
  filter: ({ songs, mediaTracks }, payload) => {
    if (!songs.some((song) => song.id === payload.songId)) return false;
    if (!payload.trackId && !payload.track) return true;
    if (payload.track) {
      return payload.track.id === (payload.trackId ?? payload.track.id)
        && payload.track.name.trim().length > 0
        && payload.track.name.length <= DATA_LIMITS.text.mediaTrackName
        && payload.audioAsset?.id === payload.track.audioId
        && payload.audioAsset.id === payload.audioAsset.sha256
        && isSha256(payload.audioAsset.id)
        && payload.audioAsset.verified === true
        && payload.audioAsset.blob instanceof Blob
        && payload.audioAsset.blob.size > 0;
    }
    return mediaTracks.some((track) => track.id === payload.trackId);
  },
  fn: (_, payload) => ({ ...payload, trackId: payload.trackId ?? payload.track?.id }),
  target: songTrackChangeApplied,
});

sample({
  clock: mediaTrackDeleteRequested,
  source: combine({ songs: $songs, mediaTracks: $mediaTracks, games: $games }),
  filter: ({ songs, mediaTracks, games }, trackId) => mediaTracks.some((track) => track.id === trackId)
    && !songs.some((song) => song.minusTrackId === trackId || song.plusTrackId === trackId)
    && !games.some((game) => game.interRounds.some((interRound) => getInterRoundTrackIds(interRound).includes(trackId))),
  fn: ({ mediaTracks }, trackId) => {
    const track = mediaTracks.find((item) => item.id === trackId)!;
    const removableAudioId = mediaTracks.some((other) => other.id !== trackId && other.audioId === track.audioId)
      ? undefined
      : track.audioId;
    return { trackId, removableAudioId };
  },
  target: mediaTrackDeletionApplied,
});

sample({
  clock: songDeleteRequested,
  source: $songs,
  filter: (songs, songId) => songs.some((song) => song.id === songId),
  fn: (_, songId) => ({ songId, removableAudioIds: [] }),
  target: songDeletionApplied,
});

export const $persistedState = combine(
  { games: $games, songs: $songs, mediaTracks: $mediaTracks, audioAssets: $audioAssets, sessions: $sessions, activeGameId: $activeGameId },
  ({ games, songs, mediaTracks, audioAssets, sessions, activeGameId }): PersistedState => {
    const usedAudioIds = new Set(mediaTracks.map((track) => track.audioId));
    return {
      version: 4,
      games,
      songs,
      mediaTracks,
      audioAssets: audioAssets.filter((asset) => usedAudioIds.has(asset.id)),
      sessions: Object.values(sessions),
      activeGameId,
    };
  },
);

let saveTimer: number | undefined;
export const persistedStateImportFx = createEffect(async (state: PersistedState) => {
  window.clearTimeout(saveTimer);
  await saveState(state);
  return state;
});

sample({ clock: persistedStateImportFx.doneData, target: persistedStateImported });

$storageError.on(persistedStateImportFx.failData, (_, error) => storageErrorMessage(error, 'Не удалось сохранить импортированные данные.'));
$storageReadOnly.on(persistedStateImportFx.failData, (readOnly, error) => error instanceof StorageConflictError ? true : readOnly);

sample({
  clock: persistedStateImportFx.done,
  source: $storageReadOnly,
  filter: (readOnly) => !readOnly,
  target: storageErrorCleared,
});

const scheduleSaveFx = createEffect((state: PersistedState) => {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveFx(state), 250);
});

sample({
  clock: $persistedState.updates,
  source: combine({ state: $persistedState, hydrated: $hydrated, readOnly: $storageReadOnly }),
  filter: ({ hydrated, readOnly }) => hydrated && !readOnly,
  fn: ({ state }) => state,
  target: scheduleSaveFx,
});

if (typeof window !== 'undefined') {
  subscribeToExternalStorageChanges((revision) => externalStorageChangeDetected(revision));
}

function flushPendingSave() {
  if (typeof window === 'undefined' || !$hydrated.getState() || $storageReadOnly.getState()) return;
  window.clearTimeout(saveTimer);
  void saveFx($persistedState.getState());
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingSave();
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPendingSave);
}

export const $activeStage = combine($activeGame, $session, (game, session) =>
  game && session ? getActiveStage(game, session) : null,
);

export const $activeRound = combine($activeGame, $activeStage, (game, stage) =>
  game ? getRoundForStage(game, stage) : null,
);

export const $activeInterRound = combine($activeGame, $activeStage, (game, stage) =>
  game ? getInterRoundForStage(game, stage) : null,
);

export const $activeRoundOrdinal = combine($activeGame, $session, (game, session) =>
  game && session ? getRoundOrdinal(game, session.stageIndex) : 1,
);

export const $activeQuestion = combine(
  { game: $activeGame, session: $session, songs: $songs, mediaTracks: $mediaTracks, audioAssets: $audioAssets },
  ({ game, session, songs, mediaTracks, audioAssets }): PlayableQuestion | null => {
    if (!game || !session?.activeQuestionId) return null;
    const question = findQuestion(game, session.activeQuestionId);
    return question ? resolveQuestion(question, songs, mediaTracks, audioAssets) : null;
  },
);

export const $isGameFinished = combine($activeGame, $session, (game, session) =>
  Boolean(game && session && session.stageIndex >= game.stages.length),
);

export { isRoundComplete };

export const resolveQuestion = (question: Question, songs: Song[], mediaTracks: MediaTrack[], audioAssets: AudioAsset[]): PlayableQuestion => {
  const song = question.songId ? songs.find((item) => item.id === question.songId) : undefined;
  const minusTrack = song?.minusTrackId ? mediaTracks.find((track) => track.id === song.minusTrackId) : undefined;
  const plusTrack = song?.plusTrackId ? mediaTracks.find((track) => track.id === song.plusTrackId) : undefined;
  return {
    ...question,
    song,
    minusTrack,
    plusTrack,
    minus: minusTrack ? audioAssets.find((asset) => asset.id === minusTrack.audioId) : undefined,
    plus: plusTrack ? audioAssets.find((asset) => asset.id === plusTrack.audioId) : undefined,
  };
};

export const getSongUsage = (games: GameConfig[], songId: string) =>
  games.flatMap((game) => {
    const count = game.rounds.reduce(
      (total, round) =>
        total +
        round.categories.reduce(
          (roundTotal, category) => roundTotal + category.questions.filter((question) => question.songId === songId).length,
          0,
        ),
      0,
    );
    return count > 0 ? [{ gameId: game.id, title: game.title, count }] : [];
  });

export { getGameStartIssues, getSessionContinuationIssues };

export const hasSessionProgress = (session?: GameSession | null) =>
  Boolean(
    session &&
      (session.started ||
        session.completedQuestionIds.length > 0 ||
        Object.values(session.scores).some((score) => score !== 0) ||
        session.stageIndex > 0 ||
        session.completedInterRoundIds.length > 0),
  );



function mergeAudioAssets(current: AudioAsset[], additions: AudioAsset[]) {
  if (additions.length === 0) return current;
  const byId = new Map(current.map((asset) => [asset.id, asset]));
  for (const asset of additions) if (!byId.has(asset.id)) byId.set(asset.id, asset);
  return [...byId.values()];
}

function mergeById<T extends { id: string }>(current: T[], additions: T[]) {
  if (additions.length === 0) return current;
  const byId = new Map(current.map((item) => [item.id, item]));
  additions.forEach((item) => byId.set(item.id, item));
  return [...byId.values()];
}

function updateQuestion(
  state: GameConfig,
  payload: { roundId: string; categoryId: string; questionId: string },
  updater: (question: Question) => Question,
): GameConfig {
  return updateQuestionCollection(state, payload, (questions) =>
    questions.map((question) => (question.id === payload.questionId ? updater(question) : question)),
  );
}

function updateQuestionCollection(
  state: GameConfig,
  payload: { roundId: string; categoryId: string },
  updater: (questions: Question[]) => Question[],
): GameConfig {
  return {
    ...state,
    rounds: state.rounds.map((round) =>
      round.id === payload.roundId
        ? {
            ...round,
            categories: round.categories.map((category) =>
              category.id === payload.categoryId ? { ...category, questions: updater(category.questions) } : category,
            ),
          }
        : round,
    ),
  };
}



function touchGame(game: GameConfig): GameConfig {
  return { ...game, updatedAt: Date.now() };
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function storageErrorMessage(error: unknown, fallback: string) {
  const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
  return `${fallback}${detail} Экспортируйте важные данные и проверьте свободное место/разрешения браузера.`;
}
