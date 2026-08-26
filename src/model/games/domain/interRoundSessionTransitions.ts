import { getInterRoundAnswerStepCount } from '../../../interRounds/templates';
import { getActiveStage, getInterRoundForStage } from '../../session';
import type { GameConfig, GameSession } from '../../types';
import { withSessionCheckpoint } from './sessionHistory';

export type InterRoundSessionCommand =
  | { type: 'startInterRound' }
  | { type: 'revealInterRoundAnswer' }
  | { type: 'advanceCommonThemeTrack' }
  | { type: 'nextInterRoundStep' };

export function transitionInterRoundSession(
  game: GameConfig,
  session: GameSession,
  command: InterRoundSessionCommand,
  now: () => number,
): GameSession {
  switch (command.type) {
    case 'startInterRound': {
      if (getActiveStage(game, session)?.kind !== 'interRound') return session;
      const interRound = getInterRoundForStage(game, getActiveStage(game, session));
      if (!interRound) return session;

      return withSessionCheckpoint(session, {
        started: true,
        pausedQuestionId: null,
        activeExcludedTeamIds: [],
        currentIncorrectTeamIds: [],
        nextExcludedTeamIds: [],
        interRound: {
          interRoundId: interRound.id,
          phase: 'play',
          taskIndex: 0,
          itemId: interRound.templateId === 'continueLyrics'
            ? interRound.tasks[0]?.id ?? null
            : interRound.stages[0]?.id ?? null,
          trackIndex: 0,
        },
      }, now);
    }

    case 'advanceCommonThemeTrack': {
      const interRound = getInterRoundForStage(game, getActiveStage(game, session));
      if (
        session.interRound?.phase !== 'play'
        || interRound?.templateId !== 'commonTheme4'
        || session.interRound.taskIndex >= interRound.stages.length
        || session.interRound.trackIndex >= 4
      ) return session;

      return withSessionCheckpoint(session, {
        interRound: {
          ...session.interRound,
          trackIndex: Math.min(session.interRound.trackIndex + 1, 4),
        },
      }, now);
    }

    case 'revealInterRoundAnswer': {
      if (session.interRound?.phase !== 'play') return session;
      const interRound = getInterRoundForStage(game, getActiveStage(game, session));
      if (!interRound) return session;
      if (interRound.templateId === 'commonTheme4') {
        const lastStageIndex = Math.max(0, interRound.stages.length - 1);
        if (session.interRound.taskIndex !== lastStageIndex || session.interRound.trackIndex < 4) return session;
      }

      return withSessionCheckpoint(session, {
        interRound: { ...session.interRound, phase: 'answer' },
      }, now);
    }

    case 'nextInterRoundStep': {
      const interRound = getInterRoundForStage(game, getActiveStage(game, session));
      if (!interRound || !session.interRound) return session;

      if (interRound.templateId === 'commonTheme4') {
        if (session.interRound.phase === 'play') {
          if (session.interRound.trackIndex < 4) return session;
          const nextTaskIndex = session.interRound.taskIndex + 1;
          if (nextTaskIndex >= interRound.stages.length) return session;

          return withSessionCheckpoint(session, {
            interRound: {
              interRoundId: interRound.id,
              phase: 'play',
              taskIndex: nextTaskIndex,
              itemId: interRound.stages[nextTaskIndex]?.id ?? null,
              trackIndex: 0,
            },
          }, now);
        }

        if (session.interRound.phase !== 'answer') return session;
        return completeInterRound(game, session, interRound.id, now);
      }

      if (session.interRound.phase !== 'answer') return session;
      const taskCount = getInterRoundAnswerStepCount(interRound);
      const nextTaskIndex = session.interRound.taskIndex + 1;
      if (nextTaskIndex < taskCount) {
        return withSessionCheckpoint(session, {
          interRound: {
            interRoundId: interRound.id,
            phase: 'play',
            taskIndex: nextTaskIndex,
            itemId: interRound.tasks[nextTaskIndex]?.id ?? null,
            trackIndex: 0,
          },
        }, now);
      }

      return completeInterRound(game, session, interRound.id, now);
    }
  }
}

function completeInterRound(
  game: GameConfig,
  session: GameSession,
  interRoundId: string,
  now: () => number,
) {
  const nextStageIndex = Math.min(session.stageIndex + 1, game.stages.length);
  return withSessionCheckpoint(session, {
    stageIndex: nextStageIndex,
    stageId: game.stages[nextStageIndex]?.id ?? null,
    completedInterRoundIds: unique([...session.completedInterRoundIds, interRoundId]),
    interRound: null,
    pausedQuestionId: null,
    activeExcludedTeamIds: [],
    currentIncorrectTeamIds: [],
    nextExcludedTeamIds: [],
  }, now);
}

function unique(values: string[]) {
  return [...new Set(values)];
}
