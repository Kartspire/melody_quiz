import { combine } from 'effector';
import { $activeGameId, $games, $sessions } from '../core/state';

export const $activeGame = combine($games, $activeGameId, (games, activeGameId) =>
  games.find((game) => game.id === activeGameId) ?? null,
);

export const $session = combine($sessions, $activeGame, (sessions, game) =>
  game ? sessions[game.id] ?? null : null,
);
