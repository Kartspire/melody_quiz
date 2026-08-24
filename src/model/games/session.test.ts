import { allSettled, fork } from 'effector';
import { describe, expect, it } from 'vitest';
import { createGame, createInterRoundStage, createSession } from '../defaults';
import { createCommonTheme4InterRound } from '../../interRounds/templates';
import { $activeGameId, $games, $sessions } from '../core/state';
import {
  commonThemeTrackAdvanced,
  interRoundStarted,
  nextStageRequested,
  previousStageRequested,
  questionClosed,
  questionOpened,
  teamAwarded,
  teamIncorrectToggled,
} from './session';

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

  it('returns from an answer to the same question and rolls back the automatic award', async () => {
    const game = createGame('Session back flow');
    const session = createSession(game);
    const question = game.rounds[0].categories[0].questions[0];
    const teamId = game.teams[0].id;
    const scope = fork({
      values: [
        [$games, [game]],
        [$activeGameId, game.id],
        [$sessions, { [game.id]: session }],
      ],
    });

    await allSettled(questionOpened, { scope, params: question.id });
    await allSettled(teamAwarded, { scope, params: teamId });
    const answered = scope.getState($sessions)[game.id];
    expect(answered.answerRevealed).toBe(true);
    expect(answered.scores[teamId]).toBe(question.points);
    expect(answered.completedQuestionIds).toContain(question.id);

    await allSettled(previousStageRequested, { scope });
    const restored = scope.getState($sessions)[game.id];
    expect(restored.activeQuestionId).toBe(question.id);
    expect(restored.answerRevealed).toBe(false);
    expect(restored.scores[teamId]).toBe(0);
    expect(restored.completedQuestionIds).not.toContain(question.id);
  });

  it('returns from the round board to the previous answer without changing its result', async () => {
    const game = createGame('Session back flow');
    const session = createSession(game);
    const question = game.rounds[0].categories[0].questions[0];
    const teamId = game.teams[0].id;
    const scope = fork({
      values: [
        [$games, [game]],
        [$activeGameId, game.id],
        [$sessions, { [game.id]: session }],
      ],
    });

    await allSettled(questionOpened, { scope, params: question.id });
    await allSettled(teamAwarded, { scope, params: teamId });
    await allSettled(questionClosed, { scope, params: { completed: true } });
    expect(scope.getState($sessions)[game.id].activeQuestionId).toBeNull();

    await allSettled(previousStageRequested, { scope });
    const restored = scope.getState($sessions)[game.id];
    expect(restored.activeQuestionId).toBe(question.id);
    expect(restored.answerRevealed).toBe(true);
    expect(restored.scores[teamId]).toBe(question.points);
    expect(restored.completedQuestionIds).toContain(question.id);
  });

  it('returns from the next stage to the answer of the last question', async () => {
    const game = createGame('Session back flow');
    const session = createSession(game);
    const questions = game.rounds[0].categories[0].questions;
    const lastQuestion = questions.at(-1)!;
    const teamId = game.teams[0].id;
    session.completedQuestionIds = questions.slice(0, -1).map((question) => question.id);
    const scope = fork({
      values: [
        [$games, [game]],
        [$activeGameId, game.id],
        [$sessions, { [game.id]: session }],
      ],
    });

    await allSettled(questionOpened, { scope, params: lastQuestion.id });
    await allSettled(teamAwarded, { scope, params: teamId });
    await allSettled(questionClosed, { scope, params: { completed: true, advanceStage: true } });
    expect(scope.getState($sessions)[game.id].stageIndex).toBe(game.stages.length);

    await allSettled(previousStageRequested, { scope });
    const restored = scope.getState($sessions)[game.id];
    expect(restored.stageIndex).toBe(0);
    expect(restored.activeQuestionId).toBe(lastQuestion.id);
    expect(restored.answerRevealed).toBe(true);
  });

  it('steps backwards through common-theme tracks and then back to the inter-round intro', async () => {
    const game = createGame('Inter-round back flow');
    const interRound = createCommonTheme4InterRound();
    const interStage = createInterRoundStage(interRound.id);
    game.interRounds = [interRound];
    game.stages = [game.stages[0], interStage];
    const session = createSession(game);
    session.started = true;
    session.stageIndex = 1;
    session.stageId = interStage.id;
    const scope = fork({
      values: [
        [$games, [game]],
        [$activeGameId, game.id],
        [$sessions, { [game.id]: session }],
      ],
    });

    await allSettled(interRoundStarted, { scope });
    await allSettled(commonThemeTrackAdvanced, { scope });
    expect(scope.getState($sessions)[game.id].interRound?.trackIndex).toBe(1);

    await allSettled(previousStageRequested, { scope });
    expect(scope.getState($sessions)[game.id].interRound?.trackIndex).toBe(0);

    await allSettled(previousStageRequested, { scope });
    expect(scope.getState($sessions)[game.id].interRound).toBeNull();
    expect(scope.getState($sessions)[game.id].stageId).toBe(interStage.id);
  });


  it('can return to a completed round board without auto-advancing it again', async () => {
    const game = createGame('Completed round back flow');
    const session = createSession(game);
    session.started = true;
    session.completedQuestionIds = game.rounds[0].categories[0].questions.map((question) => question.id);
    const scope = fork({
      values: [
        [$games, [game]],
        [$activeGameId, game.id],
        [$sessions, { [game.id]: session }],
      ],
    });

    await allSettled(nextStageRequested, { scope });
    expect(scope.getState($sessions)[game.id].stageIndex).toBe(game.stages.length);

    await allSettled(previousStageRequested, { scope });
    const restored = scope.getState($sessions)[game.id];
    expect(restored.stageIndex).toBe(0);
    expect(restored.stageId).toBe(game.stages[0].id);
    expect(restored.activeQuestionId).toBeNull();
    expect(restored.completedQuestionIds).toHaveLength(game.rounds[0].categories[0].questions.length);
  });

});
