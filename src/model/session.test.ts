import { describe, expect, it } from 'vitest';
import { createGame, createInterRoundStage, createRound, createSession } from './defaults';
import { createCommonTheme4InterRound, createContinueLyricsInterRound } from '../interRounds/templates';
import { normalizeGameConfig } from './migrations';
import { isRoundComplete, reconcileSession } from './session';
import type { GameConfig } from './types';

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

  it('keeps a paused unfinished question when the current round is not advanced', () => {
    const game = createGame('Тест');
    const session = createSession(game);
    const questionId = game.rounds[0].categories[0].questions[0].id;
    const teamId = game.teams[0].id;
    session.started = true;
    session.pausedQuestionId = questionId;
    session.activeExcludedTeamIds = [teamId];
    session.currentIncorrectTeamIds = [teamId];
    session.nextExcludedTeamIds = [teamId];

    const reconciled = reconcileSession(game, session);

    expect(reconciled.pausedQuestionId).toBe(questionId);
    expect(reconciled.currentIncorrectTeamIds).toEqual([teamId]);
    expect(reconciled.nextExcludedTeamIds).toEqual([teamId]);
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

  it('migrates a legacy roundIndex to the matching stage when inter-rounds exist', () => {
    const game = createGame('Тест');
    const secondRound = { ...createRound(1), id: 'round-second', name: 'Раунд 2' };
    const interRound = createContinueLyricsInterRound();
    game.rounds = [game.rounds[0], secondRound];
    game.interRounds = [interRound];
    game.stages = [
      game.stages[0],
      createInterRoundStage(interRound.id),
      { id: 'stage-second', kind: 'round', roundId: secondRound.id },
    ];

    const legacySession = {
      ...createSession(game),
      stageIndex: undefined,
      stageId: undefined,
      roundIndex: 1,
    } as unknown as Parameters<typeof reconcileSession>[1];
    const reconciled = reconcileSession(game, legacySession);

    expect(reconciled.stageIndex).toBe(2);
  });

  it('migrates legacy common-theme progress from track taskIndex to stage + trackIndex', () => {
    const game = createGame('Тест');
    const current = createCommonTheme4InterRound();
    const firstStage = current.stages[0];
    const legacyInterRound = {
      id: current.id,
      templateId: 'commonTheme4' as const,
      templateVersion: 1 as const,
      title: current.title,
      tracks: firstStage.tracks,
      commonTheme: firstStage.commonTheme,
    };
    const rawGame = {
      ...game,
      interRounds: [legacyInterRound],
      stages: [game.stages[0], createInterRoundStage(legacyInterRound.id)],
    } as unknown as GameConfig;
    const normalized = normalizeGameConfig(rawGame).game;
    const legacySession = {
      ...createSession(normalized),
      stageIndex: 1,
      stageId: undefined,
      interRound: { interRoundId: legacyInterRound.id, phase: 'play', taskIndex: 3 },
    } as unknown as Parameters<typeof reconcileSession>[1];

    const reconciled = reconcileSession(normalized, legacySession);
    const migrated = normalized.interRounds[0];

    expect(migrated.templateId).toBe('commonTheme4');
    if (migrated.templateId === 'commonTheme4') {
      expect(migrated.templateVersion).toBe(2);
      expect(migrated.stages).toHaveLength(1);
    }
    expect(reconciled.interRound?.taskIndex).toBe(0);
    expect(reconciled.interRound?.trackIndex).toBe(3);
  });


  it('keeps the same active stage when stages are reordered', () => {
    const game = createGame('Тест');
    const secondRound = { ...createRound(1), id: 'round-second', name: 'Раунд 2' };
    const secondStage = { id: 'stage-second', kind: 'round' as const, roundId: secondRound.id };
    game.rounds = [game.rounds[0], secondRound];
    game.stages = [game.stages[0], secondStage];
    const session = createSession(game);
    session.stageIndex = 1;
    session.stageId = secondStage.id;
    session.started = true;

    game.stages = [secondStage, game.stages[0]];
    const reconciled = reconcileSession(game, session);

    expect(reconciled.stageId).toBe(secondStage.id);
    expect(reconciled.stageIndex).toBe(0);
  });

  it('keeps the same inter-round item when an earlier item is removed', () => {
    const game = createGame('Тест');
    const interRound = createContinueLyricsInterRound();
    interRound.tasks.push({ ...interRound.tasks[0], id: 'task-second' });
    game.interRounds = [interRound];
    const interStage = createInterRoundStage(interRound.id);
    game.stages = [game.stages[0], interStage];
    const session = createSession(game);
    session.started = true;
    session.stageIndex = 1;
    session.stageId = interStage.id;
    session.interRound = {
      interRoundId: interRound.id,
      phase: 'play',
      taskIndex: 1,
      itemId: 'task-second',
      trackIndex: 0,
    };

    interRound.tasks = interRound.tasks.slice(1);
    const reconciled = reconcileSession(game, session);

    expect(reconciled.interRound?.itemId).toBe('task-second');
    expect(reconciled.interRound?.taskIndex).toBe(0);
  });

  it('advances from a round that became complete after editing', () => {
    const game = createGame('Тест');
    const secondRound = { ...createRound(1), id: 'round-second', name: 'Раунд 2' };
    game.rounds = [game.rounds[0], secondRound];
    game.stages = [game.stages[0], { id: 'stage-second', kind: 'round', roundId: secondRound.id }];
    const session = createSession(game);
    session.started = true;
    session.completedQuestionIds = game.rounds[0].categories[0].questions.map((question) => question.id);

    const reconciled = reconcileSession(game, session);

    expect(reconciled.stageIndex).toBe(1);
    expect(reconciled.stageId).toBe('stage-second');
  });

  it('completes a common-theme inter-round when its current last stage is removed', () => {
    const game = createGame('Тест');
    const interRound = createCommonTheme4InterRound();
    interRound.stages.push(
      { ...interRound.stages[0], id: 'theme-stage-second' },
      { ...interRound.stages[0], id: 'theme-stage-third' },
    );
    game.interRounds = [interRound];
    const interStage = createInterRoundStage(interRound.id);
    game.stages = [game.stages[0], interStage];
    const session = createSession(game);
    session.started = true;
    session.stageIndex = 1;
    session.stageId = interStage.id;
    session.interRound = {
      interRoundId: interRound.id,
      phase: 'answer',
      taskIndex: 2,
      itemId: 'theme-stage-third',
      trackIndex: 4,
    };

    interRound.stages = interRound.stages.slice(0, 2);
    const reconciled = reconcileSession(game, session);

    expect(reconciled.completedInterRoundIds).toContain(interRound.id);
    expect(reconciled.stageIndex).toBe(game.stages.length);
    expect(reconciled.interRound).toBeNull();
  });

  it('completes an inter-round when its current last item is removed while playing', () => {
    const game = createGame('Тест');
    const interRound = createContinueLyricsInterRound();
    interRound.tasks.push(
      { ...interRound.tasks[0], id: 'task-second' },
      { ...interRound.tasks[0], id: 'task-third' },
    );
    game.interRounds = [interRound];
    const interStage = createInterRoundStage(interRound.id);
    game.stages = [game.stages[0], interStage];
    const session = createSession(game);
    session.started = true;
    session.stageIndex = 1;
    session.stageId = interStage.id;
    session.interRound = {
      interRoundId: interRound.id,
      phase: 'answer',
      taskIndex: 2,
      itemId: 'task-third',
      trackIndex: 0,
    };

    interRound.tasks = interRound.tasks.slice(0, 2);
    const reconciled = reconcileSession(game, session);

    expect(reconciled.completedInterRoundIds).toContain(interRound.id);
    expect(reconciled.stageIndex).toBe(game.stages.length);
    expect(reconciled.stageId).toBeNull();
    expect(reconciled.interRound).toBeNull();
  });

});
