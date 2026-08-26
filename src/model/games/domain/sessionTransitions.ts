import {
  findQuestion,
  getActiveStage,
  getRoundForStage,
} from '../../session';
import type { GameConfig, GameSession } from '../../types';
import {
  transitionInterRoundSession,
  type InterRoundSessionCommand,
} from './interRoundSessionTransitions';
import {
  canNavigateBack,
  restorePreviousSession,
  withSessionCheckpoint,
} from './sessionHistory';

export type GameSessionCommand =
  | { type: 'openQuestion'; questionId: string }
  | { type: 'closeQuestion'; completed: boolean; advanceStage?: boolean }
  | { type: 'awardTeam'; teamId: string }
  | { type: 'markTeamIncorrect'; teamId: string }
  | { type: 'unlockTeam'; teamId: string }
  | { type: 'nobodyGuessed' }
  | { type: 'changeTeamScore'; teamId: string; score: number }
  | { type: 'nextStage' }
  | { type: 'previousStage' }
  | InterRoundSessionCommand;

/**
 * Applies one gameplay command without touching Effector stores.
 * Invalid/no-op commands return the exact same session reference.
 */
export function transitionGameSession(
  game: GameConfig,
  session: GameSession,
  command: GameSessionCommand,
  now: () => number = Date.now,
): GameSession {
  switch (command.type) {
    case 'openQuestion': {
      const round = getRoundForStage(game, getActiveStage(game, session));
      const canOpen = !session.activeQuestionId
        && Boolean(round?.categories.some((category) =>
          category.questions.some((question) => question.id === command.questionId),
        ))
        && !session.completedQuestionIds.includes(command.questionId);
      if (!canOpen) return session;

      const isPausedQuestion = session.pausedQuestionId === command.questionId;
      return withSessionCheckpoint(session, {
        started: true,
        activeQuestionId: command.questionId,
        pausedQuestionId: null,
        awardedTeamId: null,
        answerRevealed: false,
        activeExcludedTeamIds: isPausedQuestion
          ? unique(session.activeExcludedTeamIds)
          : unique(session.nextExcludedTeamIds),
        currentIncorrectTeamIds: isPausedQuestion
          ? unique(session.currentIncorrectTeamIds)
          : [],
        nextExcludedTeamIds: isPausedQuestion
          ? unique(session.nextExcludedTeamIds)
          : [],
      }, now);
    }

    case 'closeQuestion': {
      if (!session.activeQuestionId) return session;
      if (!command.completed) {
        return {
          ...session,
          history: session.history.slice(0, -1),
          updatedAt: now(),
          activeQuestionId: null,
          pausedQuestionId: session.activeQuestionId,
          awardedTeamId: null,
          answerRevealed: false,
          activeExcludedTeamIds: unique(session.activeExcludedTeamIds),
          currentIncorrectTeamIds: unique(session.currentIncorrectTeamIds),
          nextExcludedTeamIds: unique(session.nextExcludedTeamIds),
        };
      }

      const nextStageIndex = command.advanceStage
        ? Math.min(session.stageIndex + 1, game.stages.length)
        : session.stageIndex;
      const stageChanged = nextStageIndex !== session.stageIndex;
      return withSessionCheckpoint(session, {
        stageIndex: nextStageIndex,
        stageId: game.stages[nextStageIndex]?.id ?? null,
        activeQuestionId: null,
        pausedQuestionId: null,
        interRound: null,
        awardedTeamId: null,
        answerRevealed: false,
        activeExcludedTeamIds: [],
        currentIncorrectTeamIds: [],
        nextExcludedTeamIds: stageChanged ? [] : unique(session.nextExcludedTeamIds),
      }, now);
    }

    case 'awardTeam': {
      if (
        !session.activeQuestionId
        || !game.teams.some((team) => team.id === command.teamId)
        || session.answerRevealed
        || session.activeExcludedTeamIds.includes(command.teamId)
        || session.currentIncorrectTeamIds.includes(command.teamId)
        || session.completedQuestionIds.includes(session.activeQuestionId)
      ) return session;

      const question = findQuestion(game, session.activeQuestionId);
      return withSessionCheckpoint(session, {
        awardedTeamId: command.teamId,
        answerRevealed: true,
        completedQuestionIds: unique([...session.completedQuestionIds, session.activeQuestionId]),
        scores: {
          ...session.scores,
          [command.teamId]: safeAddScore(session.scores[command.teamId] ?? 0, question?.points ?? 0),
        },
      }, now);
    }

    case 'markTeamIncorrect': {
      if (
        !session.activeQuestionId
        || !game.teams.some((team) => team.id === command.teamId)
        || session.answerRevealed
        || session.activeExcludedTeamIds.includes(command.teamId)
        || session.currentIncorrectTeamIds.includes(command.teamId)
      ) return session;

      return {
        ...session,
        updatedAt: now(),
        currentIncorrectTeamIds: unique([...session.currentIncorrectTeamIds, command.teamId]),
        nextExcludedTeamIds: unique([...session.nextExcludedTeamIds, command.teamId]),
      };
    }

    case 'unlockTeam': {
      if (
        !game.teams.some((team) => team.id === command.teamId)
        || !isTeamBlocked(session, command.teamId)
      ) return session;

      return {
        ...session,
        updatedAt: now(),
        activeExcludedTeamIds: withoutTeam(session.activeExcludedTeamIds, command.teamId),
        currentIncorrectTeamIds: withoutTeam(session.currentIncorrectTeamIds, command.teamId),
        nextExcludedTeamIds: withoutTeam(session.nextExcludedTeamIds, command.teamId),
      };
    }

    case 'nobodyGuessed': {
      if (
        !session.activeQuestionId
        || session.answerRevealed
        || session.completedQuestionIds.includes(session.activeQuestionId)
      ) return session;

      return withSessionCheckpoint(session, {
        awardedTeamId: null,
        answerRevealed: true,
        completedQuestionIds: unique([...session.completedQuestionIds, session.activeQuestionId]),
      }, now);
    }

    case 'changeTeamScore': {
      if (
        !game.teams.some((team) => team.id === command.teamId)
        || !Number.isSafeInteger(command.score)
        || session.scores[command.teamId] === command.score
      ) return session;

      return {
        ...session,
        updatedAt: now(),
        scores: { ...session.scores, [command.teamId]: command.score },
        history: session.history.map((entry) => ({
          ...entry,
          scores: { ...entry.scores, [command.teamId]: command.score },
        })),
      };
    }

    case 'nextStage': {
      if (session.stageIndex >= game.stages.length) return session;
      const stage = getActiveStage(game, session);
      if (stage?.kind !== 'round') return session;

      const nextStageIndex = Math.min(session.stageIndex + 1, game.stages.length);
      return withSessionCheckpoint(session, {
        stageIndex: nextStageIndex,
        stageId: game.stages[nextStageIndex]?.id ?? null,
        activeQuestionId: null,
        pausedQuestionId: null,
        interRound: null,
        awardedTeamId: null,
        answerRevealed: false,
        activeExcludedTeamIds: [],
        currentIncorrectTeamIds: [],
        nextExcludedTeamIds: [],
      }, now);
    }

    case 'previousStage':
      return canNavigateBack(session) ? restorePreviousSession(game, session, now) : session;

    case 'startInterRound':
    case 'revealInterRoundAnswer':
    case 'advanceCommonThemeTrack':
    case 'nextInterRoundStep':
      return transitionInterRoundSession(game, session, command, now);
  }
}

function safeAddScore(current: number, delta: number) {
  const next = current + delta;
  if (Number.isSafeInteger(next)) return next;
  return delta >= 0 ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function withoutTeam(values: string[], teamId: string) {
  return values.filter((id) => id !== teamId);
}

function isTeamBlocked(session: GameSession, teamId: string) {
  return session.activeExcludedTeamIds.includes(teamId)
    || session.currentIncorrectTeamIds.includes(teamId)
    || session.nextExcludedTeamIds.includes(teamId);
}

export { canNavigateBack, createSessionCheckpoint } from './sessionHistory';
