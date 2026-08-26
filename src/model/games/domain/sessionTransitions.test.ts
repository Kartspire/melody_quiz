import { describe, expect, it } from 'vitest';
import { createGame, createInterRoundStage, createRound, createRoundStage, createSession } from '../../defaults';
import { createContinueLyricsInterRound } from '../../../interRounds/templates';
import { transitionGameSession } from './sessionTransitions';

const NOW = () => 1_900_000_000_000;

describe('transitionGameSession', () => {
  it('chooses the first-round selector randomly and persists it in the session', () => {
    const game = createGame('Random selector');
    const session = createSession(game, () => 0.99);

    expect(session.selectingTeamId).toBe(game.teams.at(-1)?.id);
  });

  it('gives the next song choice to the team that answered correctly', () => {
    const game = createGame('Winner selects');
    const question = game.rounds[0].categories[0].questions[0];
    const winner = game.teams[1];
    let session = createSession(game, () => 0);

    session = transitionGameSession(game, session, { type: 'openQuestion', questionId: question.id }, NOW);
    session = transitionGameSession(game, session, { type: 'awardTeam', teamId: winner.id }, NOW);

    expect(session.selectingTeamId).toBe(winner.id);
  });

  it('keeps the same selecting team when nobody guessed', () => {
    const game = createGame('Nobody guessed');
    const question = game.rounds[0].categories[0].questions[0];
    let session = createSession(game, () => 0);
    const selectingTeamId = session.selectingTeamId;

    session = transitionGameSession(game, session, { type: 'openQuestion', questionId: question.id }, NOW);
    session = transitionGameSession(game, session, { type: 'nobodyGuessed' }, NOW);

    expect(session.selectingTeamId).toBe(selectingTeamId);
  });

  it('lets the lowest-scoring team choose first in a new ordinary round', () => {
    const game = createGame('Lowest score selects');
    const secondRound = createRound(1);
    game.rounds.push(secondRound);
    game.stages.push(createRoundStage(secondRound.id));
    const [firstTeam, secondTeam] = game.teams;
    let session = createSession(game, () => 0);
    session = {
      ...session,
      scores: { [firstTeam.id]: 500, [secondTeam.id]: 100 },
    };

    session = transitionGameSession(game, session, { type: 'nextStage' }, NOW);

    expect(session.selectingTeamId).toBe(secondTeam.id);
  });

  it('manually blocks and unblocks a team for the next answer', () => {
    const game = createGame('Manual next answer block');
    const teamId = game.teams[0].id;
    let session = createSession(game);

    session = transitionGameSession(game, session, { type: 'toggleTeamNextAnswerBlock', teamId }, NOW);
    expect(session.nextExcludedTeamIds).toContain(teamId);

    const question = game.rounds[0].categories[0].questions[0];
    session = transitionGameSession(game, session, { type: 'openQuestion', questionId: question.id }, NOW);
    expect(session.activeExcludedTeamIds).toContain(teamId);
    expect(session.nextExcludedTeamIds).not.toContain(teamId);
  });

  it('keeps a team blocked when an unfinished question is reopened', () => {
    const game = createGame('Pure session flow');
    const [firstQuestion, secondQuestion] = game.rounds[0].categories[0].questions;
    const teamId = game.teams[0].id;
    let session = createSession(game);

    session = transitionGameSession(game, session, { type: 'openQuestion', questionId: firstQuestion.id }, NOW);
    session = transitionGameSession(game, session, { type: 'markTeamIncorrect', teamId }, NOW);
    session = transitionGameSession(game, session, { type: 'closeQuestion', completed: false }, NOW);
    session = transitionGameSession(game, session, { type: 'openQuestion', questionId: firstQuestion.id }, NOW);

    expect(session.currentIncorrectTeamIds).toContain(teamId);
    expect(session.nextExcludedTeamIds).toContain(teamId);

    session = transitionGameSession(game, session, { type: 'closeQuestion', completed: false }, NOW);
    session = transitionGameSession(game, session, { type: 'openQuestion', questionId: secondQuestion.id }, NOW);

    expect(session.activeExcludedTeamIds).toContain(teamId);
    expect(session.currentIncorrectTeamIds).not.toContain(teamId);
    expect(session.nextExcludedTeamIds).not.toContain(teamId);
  });


  it('manually unlocks a team from current and next-song penalties', () => {
    const game = createGame('Manual unlock');
    const question = game.rounds[0].categories[0].questions[0];
    const teamId = game.teams[0].id;
    let session = createSession(game);

    session = transitionGameSession(game, session, { type: 'openQuestion', questionId: question.id }, NOW);
    session = transitionGameSession(game, session, { type: 'markTeamIncorrect', teamId }, NOW);

    expect(session.currentIncorrectTeamIds).toContain(teamId);
    expect(session.nextExcludedTeamIds).toContain(teamId);

    session = transitionGameSession(game, session, { type: 'unlockTeam', teamId }, NOW);

    expect(session.activeExcludedTeamIds).not.toContain(teamId);
    expect(session.currentIncorrectTeamIds).not.toContain(teamId);
    expect(session.nextExcludedTeamIds).not.toContain(teamId);
  });

  it('clears all team penalties when advancing to another round', () => {
    const game = createGame('Round boundary');
    const secondRound = createRound(1);
    game.rounds.push(secondRound);
    game.stages.push(createRoundStage(secondRound.id));

    const question = game.rounds[0].categories[0].questions[0];
    const [penalizedTeam, winningTeam] = game.teams;
    let session = createSession(game);

    session = transitionGameSession(game, session, { type: 'openQuestion', questionId: question.id }, NOW);
    session = transitionGameSession(game, session, { type: 'markTeamIncorrect', teamId: penalizedTeam.id }, NOW);
    session = transitionGameSession(game, session, { type: 'awardTeam', teamId: winningTeam.id }, NOW);
    session = transitionGameSession(game, session, { type: 'closeQuestion', completed: true, advanceStage: true }, NOW);

    expect(session.stageIndex).toBe(1);
    expect(session.activeExcludedTeamIds).toEqual([]);
    expect(session.currentIncorrectTeamIds).toEqual([]);
    expect(session.nextExcludedTeamIds).toEqual([]);
  });



  it('can advance from an unfinished round and keeps skipped questions available through Back', () => {
    const game = createGame('Skip unfinished round');
    const secondRound = createRound(1);
    game.rounds.push(secondRound);
    game.stages.push(createRoundStage(secondRound.id));

    const teamId = game.teams[0].id;
    const firstQuestionId = game.rounds[0].categories[0].questions[0].id;
    let session = createSession(game);
    session = {
      ...session,
      started: true,
      nextExcludedTeamIds: [teamId],
    };

    session = transitionGameSession(game, session, { type: 'nextStage' }, NOW);

    expect(session.stageIndex).toBe(1);
    expect(session.completedQuestionIds).not.toContain(firstQuestionId);
    expect(session.activeExcludedTeamIds).toEqual([]);
    expect(session.currentIncorrectTeamIds).toEqual([]);
    expect(session.nextExcludedTeamIds).toEqual([]);

    session = transitionGameSession(game, session, { type: 'previousStage' }, NOW);

    expect(session.stageIndex).toBe(0);
    expect(session.completedQuestionIds).not.toContain(firstQuestionId);
    expect(session.nextExcludedTeamIds).toEqual([teamId]);
  });

  it('clears all team penalties when an inter-round starts', () => {
    const game = createGame('Inter-round boundary');
    const interRound = createContinueLyricsInterRound();
    const interRoundStage = createInterRoundStage(interRound.id);
    game.interRounds = [interRound];
    game.stages = [interRoundStage];

    const teamId = game.teams[0].id;
    let session = createSession(game);
    session = {
      ...session,
      started: true,
      activeExcludedTeamIds: [teamId],
      currentIncorrectTeamIds: [teamId],
      nextExcludedTeamIds: [teamId],
    };

    session = transitionGameSession(game, session, { type: 'startInterRound' }, NOW);

    expect(session.activeExcludedTeamIds).toEqual([]);
    expect(session.currentIncorrectTeamIds).toEqual([]);
    expect(session.nextExcludedTeamIds).toEqual([]);
  });

  it('rolls back an awarded answer through the Back command', () => {
    const game = createGame('Pure back flow');
    const question = game.rounds[0].categories[0].questions[0];
    const teamId = game.teams[0].id;
    let session = createSession(game);

    session = transitionGameSession(game, session, { type: 'openQuestion', questionId: question.id }, NOW);
    session = transitionGameSession(game, session, { type: 'awardTeam', teamId }, NOW);

    expect(session.scores[teamId]).toBe(question.points);
    expect(session.completedQuestionIds).toContain(question.id);

    session = transitionGameSession(game, session, { type: 'previousStage' }, NOW);

    expect(session.activeQuestionId).toBe(question.id);
    expect(session.answerRevealed).toBe(false);
    expect(session.scores[teamId]).toBe(0);
    expect(session.completedQuestionIds).not.toContain(question.id);
  });

  it('returns the exact same session for an invalid command', () => {
    const game = createGame('No-op flow');
    const session = createSession(game);

    const result = transitionGameSession(game, session, { type: 'awardTeam', teamId: game.teams[0].id }, NOW);

    expect(result).toBe(session);
  });

  it('updates manual score in history so Back does not resurrect the old score', () => {
    const game = createGame('Manual score');
    const question = game.rounds[0].categories[0].questions[0];
    const teamId = game.teams[0].id;
    let session = createSession(game);

    session = transitionGameSession(game, session, { type: 'openQuestion', questionId: question.id }, NOW);
    session = transitionGameSession(game, session, { type: 'changeTeamScore', teamId, score: 700 }, NOW);
    session = transitionGameSession(game, session, { type: 'previousStage' }, NOW);

    expect(session.scores[teamId]).toBe(700);
  });
});
