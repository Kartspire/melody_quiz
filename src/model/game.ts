import { combine, createEffect, createEvent, createStore, sample } from 'effector';
import { loadState, saveState, StorageConflictError, subscribeToExternalStorageChanges } from '../lib/storage';
import { getGameStartIssues, getSessionContinuationIssues, isSha256 } from './validation';
import { cloneGame, cloneSong, createCategory, createGame, createQuestion, createRound, createSession, createTeam } from './defaults';
import { DATA_LIMITS, GAME_LIMITS } from './limits';
import { findQuestion, isRoundComplete, normalizeSession, reconcileSession } from './session';
import type {
  AudioAsset,
  GameConfig,
  GameSession,
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
export const nextRoundRequested = createEvent();

export const gameTitleChanged = createEvent<string>();
export const roundAdded = createEvent();
export const roundRemoved = createEvent<string>();
export const roundNameChanged = createEvent<{ roundId: string; name: string }>();
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

export const songAdded = createEvent<{ song: Song; audioAssets: AudioAsset[] }>();
export const songChanged = createEvent<{ songId: string; patch: Partial<Pick<Song, 'artist' | 'title'>> }>();
export const songDuplicated = createEvent<string>();
export const songAudioChanged = createEvent<{
  songId: string;
  kind: 'minus' | 'plus';
  asset?: AudioAsset;
}>();
export const songDeleteRequested = createEvent<string>();
const songAudioChangeApplied = createEvent<{
  songId: string;
  kind: 'minus' | 'plus';
  asset?: AudioAsset;
  previousAudioId?: string;
  removePrevious: boolean;
}>();
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
  .on(songAudioChangeApplied, (songs, { songId, kind, asset }) =>
    songs.map((song) =>
      song.id === songId
        ? {
            ...song,
            [kind === 'minus' ? 'minusAudioId' : 'plusAudioId']: asset?.id,
            updatedAt: Date.now(),
          }
        : song,
    ),
  )
  .on(songDeletionApplied, (songs, { songId }) => songs.filter((song) => song.id !== songId))
  .on(persistedStateImported, (_, state) => state.songs);

$audioAssets
  .on(loadFx.doneData, (_, state) => state.audioAssets)
  .on(songAdded, (assets, { audioAssets }) => {
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    audioAssets.forEach((asset) => byId.set(asset.id, asset));
    return [...byId.values()];
  })
  .on(songAudioChangeApplied, (assets, { asset, previousAudioId, removePrevious }) => {
    let next = removePrevious && previousAudioId ? assets.filter((item) => item.id !== previousAudioId) : assets;
    if (asset && !next.some((item) => item.id === asset.id)) next = [...next, asset];
    return next;
  })
  .on(songDeletionApplied, (assets, { removableAudioIds }) => {
    const removable = new Set(removableAudioIds);
    return removable.size > 0 ? assets.filter((asset) => !removable.has(asset.id)) : assets;
  })
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
    const round = game.rounds[session?.roundIndex ?? -1];
    return Boolean(session && round?.categories.some((category) => category.questions.some((question) => question.id === questionId)) && !session.completedQuestionIds.includes(questionId));
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
  clock: nextRoundRequested,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }) => Boolean(game && sessions[game.id] && sessions[game.id].roundIndex < game.rounds.length && isRoundComplete(game, sessions[game.id])),
  fn: ({ game, sessions }) => {
    const session = sessions[game!.id];
    return {
      ...sessions,
      [game!.id]: {
        ...session,
        roundIndex: Math.min(session.roundIndex + 1, game!.rounds.length),
        activeQuestionId: null,
        awardedTeamId: null,
        answerRevealed: false,
        activeExcludedTeamIds: [],
        currentIncorrectTeamIds: [],
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
  fn: ({ game }) => touchGame({ ...game!, rounds: [...game!.rounds, createRound(game!.rounds.length)] }),
  target: gameConfigUpdated,
});

sample({
  clock: roundRemoved,
  source: activeGameSource,
  filter: ({ game }, roundId) => Boolean(game && game.rounds.length > 1 && game.rounds.some((round) => round.id === roundId)),
  fn: ({ game }, roundId) => touchGame({ ...game!, rounds: game!.rounds.filter((round) => round.id !== roundId) }),
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
  clock: songAudioChanged,
  source: $songs,
  filter: (songs, { songId, asset }) => songs.some((song) => song.id === songId) && (!asset || (asset.id === asset.sha256 && isSha256(asset.id) && asset.verified === true && asset.blob instanceof Blob && asset.blob.size > 0)),
  fn: (songs, payload) => {
    const current = songs.find((song) => song.id === payload.songId)!;
    const previousAudioId = payload.kind === 'minus' ? current.minusAudioId : current.plusAudioId;
    const usedByAnotherReference = previousAudioId
      ? songs.some((song) => {
          if (song.id !== payload.songId) return song.minusAudioId === previousAudioId || song.plusAudioId === previousAudioId;
          return payload.kind === 'minus' ? song.plusAudioId === previousAudioId : song.minusAudioId === previousAudioId;
        })
      : false;
    return { ...payload, previousAudioId, removePrevious: Boolean(previousAudioId && !usedByAnotherReference) };
  },
  target: songAudioChangeApplied,
});

sample({
  clock: songDeleteRequested,
  source: $songs,
  filter: (songs, songId) => songs.some((song) => song.id === songId),
  fn: (songs, songId) => {
    const song = songs.find((item) => item.id === songId)!;
    const candidates = [song.minusAudioId, song.plusAudioId].filter((id): id is string => Boolean(id));
    const removableAudioIds = candidates.filter((audioId) => !songs.some(
      (other) => other.id !== songId && (other.minusAudioId === audioId || other.plusAudioId === audioId),
    ));
    return { songId, removableAudioIds };
  },
  target: songDeletionApplied,
});

export const $persistedState = combine(
  { games: $games, songs: $songs, audioAssets: $audioAssets, sessions: $sessions, activeGameId: $activeGameId },
  ({ games, songs, audioAssets, sessions, activeGameId }): PersistedState => {
    const usedAudioIds = new Set(songs.flatMap((song) => [song.minusAudioId, song.plusAudioId].filter((id): id is string => Boolean(id))));
    return {
      version: 2,
      games,
      songs,
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

export const $activeRound = combine($activeGame, $session, (game, session) =>
  game && session ? game.rounds[session.roundIndex] ?? null : null,
);

export const $activeQuestion = combine(
  { game: $activeGame, session: $session, songs: $songs, audioAssets: $audioAssets },
  ({ game, session, songs, audioAssets }): PlayableQuestion | null => {
    if (!game || !session?.activeQuestionId) return null;
    const question = findQuestion(game, session.activeQuestionId);
    return question ? resolveQuestion(question, songs, audioAssets) : null;
  },
);

export const $isGameFinished = combine($activeGame, $session, (game, session) =>
  Boolean(game && session && session.roundIndex >= game.rounds.length),
);

export { isRoundComplete };

export const resolveQuestion = (question: Question, songs: Song[], audioAssets: AudioAsset[]): PlayableQuestion => {
  const song = question.songId ? songs.find((item) => item.id === question.songId) : undefined;
  return {
    ...question,
    song,
    minus: song?.minusAudioId ? audioAssets.find((asset) => asset.id === song.minusAudioId) : undefined,
    plus: song?.plusAudioId ? audioAssets.find((asset) => asset.id === song.plusAudioId) : undefined,
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
        session.roundIndex > 0),
  );



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
