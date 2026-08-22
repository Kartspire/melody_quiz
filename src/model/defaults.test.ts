import { describe, expect, it } from 'vitest';
import { createGame, createRound } from './defaults';

describe('default game structure', () => {
  it('creates a new game with one round and one category', () => {
    const game = createGame('Новая игра');
    expect(game.rounds).toHaveLength(1);
    expect(game.rounds[0].categories).toHaveLength(1);
    expect(game.rounds[0].categories[0].questions).toHaveLength(5);
    expect(game.interRounds).toEqual([]);
    expect(game.stages).toHaveLength(1);
    expect(game.stages[0]).toMatchObject({ kind: 'round', roundId: game.rounds[0].id });
  });

  it('creates every added round with one category', () => {
    const round = createRound(1);
    expect(round.categories).toHaveLength(1);
  });
});
