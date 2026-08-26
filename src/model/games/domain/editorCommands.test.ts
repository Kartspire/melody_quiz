import { describe, expect, it } from 'vitest';
import { createGame } from '../../defaults';
import { createContinueLyricsInterRound } from '../../../interRounds/templates';
import { applyGameEditorCommand } from './editorCommands';

const FIXED_NOW = 1_900_000_000_000;

function context(overrides: { hasMediaTrack?: (trackId: string) => boolean; hasSong?: (songId: string) => boolean } = {}) {
  return { ...overrides, now: () => FIXED_NOW };
}

describe('applyGameEditorCommand', () => {
  it('updates cosmetic data without requiring session reconciliation', () => {
    const game = createGame('Before');
    const result = applyGameEditorCommand(game, { type: 'changeGameTitle', title: 'After' }, context());

    expect(result.changed).toBe(true);
    expect(result.sessionImpact).toBe('none');
    expect(result.game.title).toBe('After');
    expect(result.game.updatedAt).toBe(FIXED_NOW);
  });

  it('returns the original game for a no-op command', () => {
    const game = createGame('Same title');
    const result = applyGameEditorCommand(game, { type: 'changeGameTitle', title: game.title }, context());

    expect(result.changed).toBe(false);
    expect(result.game).toBe(game);
    expect(result.sessionImpact).toBe('none');
  });

  it('marks structural changes for session reconciliation', () => {
    const game = createGame('Structure');
    const round = game.rounds[0];
    const category = round.categories[0];
    const question = category.questions[0];

    const result = applyGameEditorCommand(game, {
      type: 'removeQuestion',
      roundId: round.id,
      categoryId: category.id,
      questionId: question.id,
    }, context());

    expect(result.changed).toBe(true);
    expect(result.sessionImpact).toBe('reconcile');
    expect(result.game.rounds[0].categories[0].questions).not.toContainEqual(question);
  });

  it('rejects references to a media track that is not in the command context', () => {
    const game = createGame('Inter round');
    const interRound = createContinueLyricsInterRound();
    game.interRounds = [interRound];
    const task = interRound.tasks[0];

    const result = applyGameEditorCommand(game, {
      type: 'changeContinueLyricsTask',
      interRoundId: interRound.id,
      taskId: task.id,
      patch: { trackId: 'missing-track' },
    }, context({ hasMediaTrack: () => false }));

    expect(result.changed).toBe(false);
    expect(result.game).toBe(game);
  });

  it('accepts valid song assignment without reconciling gameplay state', () => {
    const game = createGame('Song assignment');
    const round = game.rounds[0];
    const category = round.categories[0];
    const question = category.questions[0];

    const result = applyGameEditorCommand(game, {
      type: 'changeQuestionSong',
      roundId: round.id,
      categoryId: category.id,
      questionId: question.id,
      songId: 'song-1',
    }, context({ hasSong: (songId) => songId === 'song-1' }));

    expect(result.changed).toBe(true);
    expect(result.sessionImpact).toBe('none');
    expect(result.game.rounds[0].categories[0].questions[0].songId).toBe('song-1');
  });

  it('updates custom inter-round rules without reconciling gameplay state', () => {
    const game = createGame('Custom rules');
    const interRound = createContinueLyricsInterRound();
    game.interRounds = [interRound];

    const result = applyGameEditorCommand(game, {
      type: 'changeInterRoundRules',
      interRoundId: interRound.id,
      rules: 'Первое правило\nВторое правило',
    }, context());

    expect(result.changed).toBe(true);
    expect(result.sessionImpact).toBe('none');
    expect(result.game.interRounds[0].rules).toBe('Первое правило\nВторое правило');
  });
});
