import { getInterRoundAnswerStepCount } from '../../../interRounds/templates';
import { DATA_LIMITS } from '../../limits';
import {
  findQuestion,
  getActiveStage,
  getInterRoundForStage,
  reconcileSession,
} from '../../session';
import type { GameConfig, GameSession, GameSessionHistoryEntry } from '../../types';

export function canNavigateBack(session: GameSession) {
  return session.history.length > 0
    || Boolean(session.activeQuestionId)
    || Boolean(session.interRound)
    || session.stageIndex > 0;
}

export function createSessionCheckpoint(session: GameSession): GameSessionHistoryEntry {
  return {
    started: session.started,
    stageIndex: session.stageIndex,
    stageId: session.stageId,
    activeQuestionId: session.activeQuestionId,
    pausedQuestionId: session.pausedQuestionId,
    completedQuestionIds: [...session.completedQuestionIds],
    completedInterRoundIds: [...session.completedInterRoundIds],
    interRound: session.interRound ? { ...session.interRound } : null,
    scores: { ...session.scores },
    awardedTeamId: session.awardedTeamId,
    answerRevealed: session.answerRevealed,
    activeExcludedTeamIds: [...session.activeExcludedTeamIds],
    currentIncorrectTeamIds: [...session.currentIncorrectTeamIds],
    nextExcludedTeamIds: [...session.nextExcludedTeamIds],
  };
}

export function withSessionCheckpoint(
  session: GameSession,
  changes: Partial<GameSessionHistoryEntry>,
  now: () => number,
): GameSession {
  return {
    ...session,
    ...changes,
    history: [...session.history, createSessionCheckpoint(session)].slice(-DATA_LIMITS.sessionHistoryEntries),
    updatedAt: now(),
  };
}

export function restorePreviousSession(
  game: GameConfig,
  session: GameSession,
  now: () => number,
): GameSession {
  const checkpoint = session.history.at(-1);
  if (checkpoint) {
    const restored = reconcileSession(
      game,
      {
        gameId: session.gameId,
        ...checkpoint,
        history: session.history.slice(0, -1),
        updatedAt: now(),
      },
      { autoAdvanceCompletedStage: false },
    );
    return { ...restored, updatedAt: now() };
  }

  return restoreLegacyPreviousSession(game, session, now);
}

function restoreLegacyPreviousSession(
  game: GameConfig,
  session: GameSession,
  now: () => number,
): GameSession {
  if (session.activeQuestionId) {
    if (session.answerRevealed) {
      const questionId = session.activeQuestionId;
      const question = findQuestion(game, questionId);
      const scores = { ...session.scores };
      if (session.awardedTeamId && question) {
        scores[session.awardedTeamId] = safeAddScore(scores[session.awardedTeamId] ?? 0, -question.points);
      }
      return {
        ...session,
        updatedAt: now(),
        completedQuestionIds: session.completedQuestionIds.filter((id) => id !== questionId),
        scores,
        awardedTeamId: null,
        answerRevealed: false,
      };
    }
    return {
      ...session,
      updatedAt: now(),
      activeQuestionId: null,
      pausedQuestionId: session.activeQuestionId,
      awardedTeamId: null,
      answerRevealed: false,
    };
  }

  if (session.interRound) {
    const interRound = getInterRoundForStage(game, getActiveStage(game, session));
    if (!interRound) return session;
    if (session.interRound.phase === 'answer') {
      return {
        ...session,
        updatedAt: now(),
        interRound: { ...session.interRound, phase: 'play' },
      };
    }
    if (interRound.templateId === 'commonTheme4' && session.interRound.trackIndex > 0) {
      return {
        ...session,
        updatedAt: now(),
        interRound: { ...session.interRound, trackIndex: session.interRound.trackIndex - 1 },
      };
    }
    if (session.interRound.taskIndex > 0) {
      const previousTaskIndex = session.interRound.taskIndex - 1;
      return {
        ...session,
        updatedAt: now(),
        interRound: {
          interRoundId: interRound.id,
          phase: interRound.templateId === 'commonTheme4' ? 'play' : 'answer',
          taskIndex: previousTaskIndex,
          itemId: interRound.templateId === 'continueLyrics'
            ? interRound.tasks[previousTaskIndex]?.id ?? null
            : interRound.stages[previousTaskIndex]?.id ?? null,
          trackIndex: interRound.templateId === 'commonTheme4' ? 4 : 0,
        },
      };
    }
    return { ...session, updatedAt: now(), interRound: null };
  }

  if (session.stageIndex <= 0) return session;
  const previousStageIndex = Math.min(session.stageIndex - 1, game.stages.length - 1);
  const previousStage = game.stages[previousStageIndex];
  if (!previousStage) return session;
  if (previousStage.kind === 'interRound') {
    const interRound = game.interRounds.find((item) => item.id === previousStage.interRoundId);
    if (!interRound) return session;
    const lastTaskIndex = Math.max(0, getInterRoundAnswerStepCount(interRound) - 1);
    return {
      ...session,
      updatedAt: now(),
      stageIndex: previousStageIndex,
      stageId: previousStage.id,
      activeQuestionId: null,
      pausedQuestionId: null,
      completedInterRoundIds: session.completedInterRoundIds.filter((id) => id !== interRound.id),
      interRound: {
        interRoundId: interRound.id,
        phase: 'answer',
        taskIndex: lastTaskIndex,
        itemId: interRound.templateId === 'continueLyrics'
          ? interRound.tasks[lastTaskIndex]?.id ?? null
          : interRound.stages[lastTaskIndex]?.id ?? null,
        trackIndex: interRound.templateId === 'commonTheme4' ? 4 : 0,
      },
      awardedTeamId: null,
      answerRevealed: false,
    };
  }

  return {
    ...session,
    updatedAt: now(),
    stageIndex: previousStageIndex,
    stageId: previousStage.id,
    activeQuestionId: null,
    pausedQuestionId: null,
    interRound: null,
    awardedTeamId: null,
    answerRevealed: false,
  };
}

function safeAddScore(current: number, delta: number) {
  const next = current + delta;
  if (Number.isSafeInteger(next)) return next;
  return delta >= 0 ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER;
}
