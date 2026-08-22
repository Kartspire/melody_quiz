import { combine, createEvent, sample } from 'effector';
import { cloneGame, createGame, createSession } from '../defaults';
import { $activeGameId, $games, $sessions } from '../core/state';
import type { GameConfig, GameSession } from '../types';

export const activeGameChanged = createEvent<string>();
export const gameCreated = createEvent<string>();
export const gameDuplicated = createEvent<string>();
export const gameDeleted = createEvent<string>();

const gamePrepared = createEvent<{ game: GameConfig; session: GameSession }>();
const gameDeletionApplied = createEvent<{ gameId: string; nextActiveGameId: string | null }>();

$games
  .on(gamePrepared, (games, { game }) => [...games, game])
  .on(gameDeletionApplied, (games, { gameId }) => games.filter((game) => game.id !== gameId));

$sessions
  .on(gamePrepared, (sessions, { session }) => ({ ...sessions, [session.gameId]: session }))
  .on(gameDeletionApplied, (sessions, { gameId }) => {
    const next = { ...sessions };
    delete next[gameId];
    return next;
  });

$activeGameId
  .on(activeGameChanged, (_, gameId) => gameId)
  .on(gamePrepared, (_, { game }) => game.id)
  .on(gameDeletionApplied, (activeGameId, { gameId, nextActiveGameId }) =>
    activeGameId === gameId ? nextActiveGameId : activeGameId,
  );

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
    nextActiveGameId: activeGameId === gameId
      ? games.find((game) => game.id !== gameId)?.id ?? null
      : activeGameId,
  }),
  target: gameDeletionApplied,
});
