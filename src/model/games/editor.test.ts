import { allSettled, fork } from 'effector';
import { describe, expect, it } from 'vitest';
import { createGame, createSession } from '../defaults';
import { $activeGameId, $games, $sessions } from '../core/state';
import { gameTitleChanged, roundAdded } from './editor';

describe('game editor orchestration', () => {
  it('does not reconcile the game session for a cosmetic edit', async () => {
    const game = createGame('Before');
    const session = createSession(game);
    const scope = fork({
      values: [
        [$games, [game]],
        [$activeGameId, game.id],
        [$sessions, { [game.id]: session }],
      ],
    });

    await allSettled(gameTitleChanged, { scope, params: 'After' });

    expect(scope.getState($games)[0].title).toBe('After');
    expect(scope.getState($sessions)[game.id]).toBe(session);
  });

  it('reconciles the game session after a structural edit', async () => {
    const game = createGame('Structure');
    const session = createSession(game);
    const scope = fork({
      values: [
        [$games, [game]],
        [$activeGameId, game.id],
        [$sessions, { [game.id]: session }],
      ],
    });

    await allSettled(roundAdded, { scope });

    expect(scope.getState($games)[0].rounds).toHaveLength(2);
    expect(scope.getState($sessions)[game.id]).not.toBe(session);
    expect(scope.getState($sessions)[game.id].stageId).toBe(game.stages[0].id);
  });
});
