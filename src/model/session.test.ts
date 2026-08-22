import { describe, expect, it } from 'vitest';
import { createGame, createInterRoundStage, createSession } from './defaults';
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
    const secondRound = { ...game.rounds[0], id: 'round-second', name: 'Раунд 2' };
    const interRound = createContinueLyricsInterRound();
    game.rounds = [game.rounds[0], secondRound];
    game.interRounds = [interRound];
    game.stages = [
      game.stages[0],
      createInterRoundStage(interRound.id),
      { id: 'stage-second', kind: 'round', roundId: secondRound.id },
    ];

    const legacySession = { ...createSession(game), stageIndex: undefined, roundIndex: 1 } as unknown as Parameters<typeof reconcileSession>[1];
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

});
