import { combine, createEvent, createStore, sample } from 'effector';
import { screenChanged } from '../app/navigation';
import { $audioAssets, $games, $mediaTracks, $sessions, $songs } from '../core/state';
import {
  evaluateGameLaunch,
  type GameLaunchDecision,
  type GameLaunchPrompt,
  type GameLaunchRequest,
} from '../launch';
import { activeGameChanged } from './library';
import { gameSessionResetRequested } from './session';

export const gameLaunchRequested = createEvent<GameLaunchRequest>();
export const gameLaunchRestartConfirmed = createEvent();
export const gameLaunchPromptDismissed = createEvent();

const gameLaunchEvaluated = createEvent<GameLaunchDecision>();
const gameLaunchReady = createEvent<Extract<GameLaunchDecision, { type: 'ready' }>>();

export const $gameLaunchPrompt = createStore<GameLaunchPrompt | null>(null)
  .on(gameLaunchEvaluated, (prompt, decision) => decision.type === 'ready' ? prompt : decision)
  .on(gameLaunchReady, () => null)
  .on(gameLaunchPromptDismissed, () => null);

const gameLaunchSource = combine({
  games: $games,
  sessions: $sessions,
  songs: $songs,
  mediaTracks: $mediaTracks,
  audioAssets: $audioAssets,
});

sample({
  clock: gameLaunchRequested,
  source: gameLaunchSource,
  filter: ({ games }, request) => games.some((game) => game.id === request.gameId),
  fn: ({ games, sessions, songs, mediaTracks, audioAssets }, request) => {
    const game = games.find((item) => item.id === request.gameId)!;
    return evaluateGameLaunch({
      request,
      game,
      session: sessions[game.id],
      songs,
      mediaTracks,
      audioAssets,
    });
  },
  target: gameLaunchEvaluated,
});

sample({
  clock: gameLaunchEvaluated,
  filter: (decision) => decision.type === 'ready',
  fn: (decision) => decision as Extract<GameLaunchDecision, { type: 'ready' }>,
  target: gameLaunchReady,
});

sample({
  clock: gameLaunchRestartConfirmed,
  source: $gameLaunchPrompt,
  filter: (prompt) => prompt?.type === 'confirm-restart',
  fn: (prompt) => {
    const confirmed = prompt as Extract<GameLaunchPrompt, { type: 'confirm-restart' }>;
    return { type: 'ready' as const, gameId: confirmed.gameId, resetSession: true };
  },
  target: gameLaunchReady,
});

sample({
  clock: gameLaunchEvaluated,
  filter: (decision) => decision.type === 'invalid',
  fn: (decision) => decision.gameId,
  target: activeGameChanged,
});

sample({
  clock: gameLaunchEvaluated,
  filter: (decision) => decision.type === 'invalid',
  fn: () => 'admin' as const,
  target: screenChanged,
});

sample({
  clock: gameLaunchReady,
  fn: ({ gameId }) => gameId,
  target: activeGameChanged,
});

sample({
  clock: gameLaunchReady,
  filter: ({ resetSession }) => resetSession,
  fn: ({ gameId }) => gameId,
  target: gameSessionResetRequested,
});

sample({
  clock: gameLaunchReady,
  fn: () => 'game' as const,
  target: screenChanged,
});
