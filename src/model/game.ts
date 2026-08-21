import { combine, createEffect, createEvent, createStore, sample } from 'effector';
import { loadState, saveState } from '../lib/storage';
import { cloneGame, createCategory, createGame, createQuestion, createRound, createSession, createTeam } from './defaults';
import { GAME_LIMITS } from './limits';
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
  .on(loadFx.done, () => null)
  .on(saveFx.done, () => null);

export const $screen = createStore<Screen>('library').on(screenChanged, (_, screen) => screen);
export const $hydrated = createStore(false).on(loadFx.finally, () => true);
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
  .on(songAdded, (songs, { song }) => [...songs, song])
  .on(songChanged, (songs, { songId, patch }) =>
    songs.map((song) => (song.id === songId ? { ...song, ...patch, updatedAt: Date.now() } : song)),
  )
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
  .on(songAdded, (assets, { audioAssets }) => [...assets, ...audioAssets])
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
  .on(loadFx.doneData, (_, state) => Object.fromEntries(state.sessions.map((session) => [session.gameId, normalizeSession(session)])))
  .on(gamePrepared, (sessions, { session }) => ({ ...sessions, [session.gameId]: session }))
  .on(gameDeletionApplied, (sessions, { gameId }) => {
    const next = { ...sessions };
    delete next[gameId];
    return next;
  })
  .on(persistedStateImported, (_, state) =>
    Object.fromEntries(state.sessions.map((session) => [session.gameId, normalizeSession(session)])),
  );

$activeGameId
  .on(loadFx.doneData, (_, state) => state.activeGameId ?? state.games[0]?.id ?? null)
  .on(activeGameChanged, (_, gameId) => gameId)
  .on(gamePrepared, (_, { game }) => game.id)
  .on(gameDeletionApplied, (activeGameId, { gameId, nextActiveGameId }) =>
    activeGameId === gameId ? nextActiveGameId : activeGameId,
  )
  .on(persistedStateImported, (_, state) => state.activeGameId ?? state.games[0]?.id ?? null);

sample({ clock: appStarted, target: loadFx });

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
  filter: ({ game, sessions }) => Boolean(game && sessions[game.id]),
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
    return Boolean(session?.activeQuestionId && !session.answerRevealed && !session.activeExcludedTeamIds.includes(teamId));
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
  filter: ({ game, sessions }) => Boolean(game && sessions[game.id]),
  fn: ({ game, sessions }, { teamId, score }) => {
    const session = sessions[game!.id];
    return { ...sessions, [game!.id]: { ...session, scores: { ...session.scores, [teamId]: score } } };
  },
  target: $sessions,
});

sample({
  clock: nextRoundRequested,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }) => Boolean(game && sessions[game.id]),
  fn: ({ game, sessions }) => {
    const session = sessions[game!.id];
    return {
      ...sessions,
      [game!.id]: {
        ...session,
        roundIndex: session.roundIndex + 1,
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
  filter: ({ game }) => Boolean(game),
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
  filter: ({ game }) => Boolean(game),
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
  filter: ({ game }) => Boolean(game),
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
  filter: ({ game }) => Boolean(game),
  fn: ({ game }, payload) => touchGame(updateQuestion(game!, payload, (question) => ({ ...question, ...payload.patch }))),
  target: gameConfigUpdated,
});

sample({
  clock: questionSongChanged,
  source: activeGameSource,
  filter: ({ game }) => Boolean(game),
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
  filter: ({ game }) => Boolean(game),
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
  filter: (songs, { songId }) => songs.some((song) => song.id === songId),
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

$storageError
  .on(persistedStateImportFx.failData, (_, error) => storageErrorMessage(error, 'Не удалось сохранить импортированные данные.'))
  .on(persistedStateImportFx.done, () => null);

const scheduleSaveFx = createEffect((state: PersistedState) => {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveFx(state), 250);
});

sample({
  clock: $persistedState.updates,
  source: combine({ state: $persistedState, hydrated: $hydrated }),
  filter: ({ hydrated }) => hydrated,
  fn: ({ state }) => state,
  target: scheduleSaveFx,
});

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

export const isRoundComplete = (config: GameConfig, session: GameSession) => {
  const round = config.rounds[session.roundIndex];
  if (!round) return true;
  const ids = round.categories.flatMap((category) => category.questions.map((question) => question.id));
  return ids.length > 0 && ids.every((id) => session.completedQuestionIds.includes(id));
};

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

export const getGameStartIssues = (config: GameConfig, songs: Song[], audioAssets: AudioAsset[]) => {
  const issues: string[] = [];
  const songById = new Map(songs.map((song) => [song.id, song]));
  const audioById = new Map(audioAssets.map((asset) => [asset.id, asset]));

  if (!config.title.trim()) issues.push('Не задано название игры.');
  if (config.rounds.length === 0) issues.push('В игре нет раундов.');
  if (config.teams.length === 0) issues.push('В игре нет команд.');
  const teamNames = new Set<string>();
  const teamColors = new Set<string>();
  config.teams.forEach((team, teamIndex) => {
    const name = team.name.trim();
    if (!name) issues.push(`Команда ${teamIndex + 1}: не задано название.`);
    const normalized = name.toLocaleLowerCase('ru-RU');
    if (normalized && teamNames.has(normalized)) issues.push(`Команда ${teamIndex + 1}: название «${name}» уже используется.`);
    if (normalized) teamNames.add(normalized);

    const color = team.color.toLocaleLowerCase('en-US');
    if (!/^#[0-9a-f]{6}$/.test(color)) issues.push(`Команда ${teamIndex + 1}: задан некорректный цвет.`);
    else if (teamColors.has(color)) issues.push(`Команда ${teamIndex + 1}: этот цвет уже используется другой командой.`);
    teamColors.add(color);
  });

  for (const [roundIndex, round] of config.rounds.entries()) {
    if (!round.name.trim()) issues.push(`Раунд ${roundIndex + 1}: не задано название.`);
    if (round.categories.length === 0) {
      issues.push(`Раунд ${roundIndex + 1} не содержит категорий.`);
      continue;
    }
    for (const [categoryIndex, category] of round.categories.entries()) {
      if (!category.name.trim()) issues.push(`Раунд ${roundIndex + 1}, категория ${categoryIndex + 1}: не задано название.`);
      if (category.questions.length === 0) {
        issues.push(`Раунд ${roundIndex + 1}, категория ${categoryIndex + 1}: нет вопросов.`);
        continue;
      }
      const usedPoints = new Set<number>();
      for (const [questionIndex, question] of category.questions.entries()) {
        const prefix = `Раунд ${roundIndex + 1}, «${category.name || `Категория ${categoryIndex + 1}`}», вопрос ${questionIndex + 1}`;
        if (!Number.isFinite(question.points) || question.points <= 0) {
          issues.push(`${prefix}: стоимость должна быть больше нуля.`);
        } else if (usedPoints.has(question.points)) {
          issues.push(`${prefix}: стоимость ${question.points} уже используется в этой категории.`);
        }
        if (Number.isFinite(question.points) && question.points > 0) usedPoints.add(question.points);
        if (!question.songId) {
          issues.push(`${prefix}: не выбрана песня.`);
          continue;
        }
        const song = songById.get(question.songId);
        if (!song) {
          issues.push(`${prefix}: выбранная песня отсутствует в медиатеке.`);
          continue;
        }
        if (!hasPlayableAudio(song.minusAudioId, audioById)) issues.push(`${prefix}: отсутствует или повреждён минус.`);
        if (!hasPlayableAudio(song.plusAudioId, audioById)) issues.push(`${prefix}: отсутствует или повреждён плюс.`);
      }
    }
  }

  return issues;
};

export const hasSessionProgress = (session?: GameSession | null) =>
  Boolean(
    session &&
      (session.started ||
        session.completedQuestionIds.length > 0 ||
        Object.values(session.scores).some((score) => score !== 0) ||
        session.roundIndex > 0),
  );

function findQuestion(config: GameConfig, questionId: string) {
  for (const round of config.rounds) {
    for (const category of round.categories) {
      const question = category.questions.find((item) => item.id === questionId);
      if (question) return question;
    }
  }
  return undefined;
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

function normalizeSession(session: GameSession): GameSession {
  const activeExcludedTeamIds = Array.isArray(session.activeExcludedTeamIds) ? session.activeExcludedTeamIds : [];
  const nextExcludedTeamIds = Array.isArray(session.nextExcludedTeamIds) ? session.nextExcludedTeamIds : [];
  const answerRevealed = session.answerRevealed ?? Boolean(session.awardedTeamId);
  const inferredCurrentIncorrectTeamIds = session.activeQuestionId && !answerRevealed
    ? nextExcludedTeamIds.filter((id) => !activeExcludedTeamIds.includes(id))
    : [];

  return {
    ...session,
    answerRevealed,
    activeExcludedTeamIds,
    currentIncorrectTeamIds: Array.isArray(session.currentIncorrectTeamIds)
      ? session.currentIncorrectTeamIds
      : inferredCurrentIncorrectTeamIds,
    nextExcludedTeamIds,
  };
}

function reconcileSession(config: GameConfig, rawSession: GameSession): GameSession {
  const session = normalizeSession(rawSession);
  const teamIds = new Set(config.teams.map((team) => team.id));
  const scores = Object.fromEntries(config.teams.map((team) => [team.id, session.scores[team.id] ?? 0]));
  const questionIds = new Set(
    config.rounds.flatMap((round) => round.categories.flatMap((category) => category.questions.map((question) => question.id))),
  );

  return {
    ...session,
    gameId: config.id,
    roundIndex: Math.min(session.roundIndex, config.rounds.length),
    activeQuestionId: session.activeQuestionId && questionIds.has(session.activeQuestionId) ? session.activeQuestionId : null,
    completedQuestionIds: session.completedQuestionIds.filter((id) => questionIds.has(id)),
    scores,
    awardedTeamId: session.awardedTeamId && teamIds.has(session.awardedTeamId) ? session.awardedTeamId : null,
    activeExcludedTeamIds: session.activeExcludedTeamIds.filter((id) => teamIds.has(id)),
    currentIncorrectTeamIds: session.currentIncorrectTeamIds.filter((id) => teamIds.has(id)),
    nextExcludedTeamIds: session.nextExcludedTeamIds.filter((id) => teamIds.has(id)),
  };
}

function touchGame(game: GameConfig): GameConfig {
  return { ...game, updatedAt: Date.now() };
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function hasPlayableAudio(audioId: string | undefined, audioById: Map<string, AudioAsset>) {
  if (!audioId) return false;
  const asset = audioById.get(audioId);
  return Boolean(asset && asset.blob instanceof Blob && asset.blob.size > 0 && asset.size > 0);
}

function storageErrorMessage(error: unknown, fallback: string) {
  const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
  return `${fallback}${detail} Экспортируйте важные данные и проверьте свободное место/разрешения браузера.`;
}
