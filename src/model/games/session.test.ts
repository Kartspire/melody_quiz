import { allSettled, fork } from 'effector';
import { describe, expect, it } from 'vitest';
import { createGame, createSession } from '../defaults';
import { $activeGameId, $games, $sessions } from '../core/state';
import { questionClosed, questionOpened, teamIncorrectToggled } from './session';

describe('game session event flow', () => {
  it('keeps an incorrect team blocked when an unfinished question is reopened', async () => {
    const game = createGame('Session flow');
    const session = createSession(game);
    const [firstQuestion, secondQuestion] = game.rounds[0].categories[0].questions;
    const teamId = game.teams[0].id;
    const scope = fork({
      values: [
        [$games, [game]],
        [$activeGameId, game.id],
        [$sessions, { [game.id]: session }],
      ],
    });

    await allSettled(questionOpened, { scope, params: firstQuestion.id });
    await allSettled(teamIncorrectToggled, { scope, params: teamId });
    await allSettled(questionClosed, { scope, params: { completed: false } });

    const paused = scope.getState($sessions)[game.id];
    expect(paused.pausedQuestionId).toBe(firstQuestion.id);
    expect(paused.currentIncorrectTeamIds).toContain(teamId);
    expect(paused.nextExcludedTeamIds).toContain(teamId);

    await allSettled(questionOpened, { scope, params: firstQuestion.id });
    const reopened = scope.getState($sessions)[game.id];
    expect(reopened.currentIncorrectTeamIds).toContain(teamId);
    expect(reopened.nextExcludedTeamIds).toContain(teamId);

    await allSettled(questionClosed, { scope, params: { completed: false } });
    await allSettled(questionOpened, { scope, params: secondQuestion.id });
    const nextSong = scope.getState($sessions)[game.id];
    expect(nextSong.activeExcludedTeamIds).toContain(teamId);
    expect(nextSong.currentIncorrectTeamIds).not.toContain(teamId);
    expect(nextSong.nextExcludedTeamIds).not.toContain(teamId);
  });
});
