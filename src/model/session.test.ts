import { describe, expect, it } from 'vitest';
import { createGame, createSession } from './defaults';
import { isRoundComplete, reconcileSession } from './session';

describe('session helpers', () => {
  it('reconciles stale teams and question ids after a game was edited', () => {
    const game = createGame('Тест');
    const session = createSession(game);
    const validQuestionId = game.rounds[0].categories[0].questions[0].id;
    session.completedQuestionIds = [validQuestionId, 'deleted-question'];
    session.activeQuestionId = 'deleted-question';
    session.scores = { ...session.scores, 'deleted-team': 900 };
    session.activeExcludedTeamIds = ['deleted-team'];
    session.currentIncorrectTeamIds = ['deleted-team'];
    session.nextExcludedTeamIds = ['deleted-team'];

    const reconciled = reconcileSession(game, session);

    expect(reconciled.completedQuestionIds).toEqual([validQuestionId]);
    expect(reconciled.activeQuestionId).toBeNull();
    expect(reconciled.scores['deleted-team']).toBeUndefined();
    expect(reconciled.activeExcludedTeamIds).toEqual([]);
    expect(reconciled.currentIncorrectTeamIds).toEqual([]);
    expect(reconciled.nextExcludedTeamIds).toEqual([]);
  });

  it('marks a round complete only after all questions are completed', () => {
    const game = createGame('Тест');
    const session = createSession(game);
    const ids = game.rounds[0].categories[0].questions.map((question) => question.id);
    session.completedQuestionIds = ids.slice(0, -1);
    expect(isRoundComplete(game, session)).toBe(false);
    session.completedQuestionIds = ids;
    expect(isRoundComplete(game, session)).toBe(true);
  });
});
