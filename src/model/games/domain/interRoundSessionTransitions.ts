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
      if (interRound.templateId === 'commonTheme4' && session.interRound.trackIndex < 4) return session;

      return withSessionCheckpoint(session, {
        interRound: { ...session.interRound, phase: 'answer' },
      }, now);
    }

    case 'nextInterRoundStep': {
      if (session.interRound?.phase !== 'answer') return session;
      const interRound = getInterRoundForStage(game, getActiveStage(game, session));
      if (!interRound) return session;

      const taskCount = getInterRoundAnswerStepCount(interRound);
      const nextTaskIndex = session.interRound.taskIndex + 1;
      if (nextTaskIndex < taskCount) {
        return withSessionCheckpoint(session, {
          interRound: {
            interRoundId: interRound.id,
            phase: 'play',
            taskIndex: nextTaskIndex,
            itemId: interRound.templateId === 'continueLyrics'
              ? interRound.tasks[nextTaskIndex]?.id ?? null
              : interRound.stages[nextTaskIndex]?.id ?? null,
            trackIndex: 0,
          },
        }, now);
      }

      const nextStageIndex = Math.min(session.stageIndex + 1, game.stages.length);
      return withSessionCheckpoint(session, {
        stageIndex: nextStageIndex,
        stageId: game.stages[nextStageIndex]?.id ?? null,
        completedInterRoundIds: unique([...session.completedInterRoundIds, interRound.id]),
        interRound: null,
        pausedQuestionId: null,
      }, now);
    }
  }
}

function unique(values: string[]) {
  return [...new Set(values)];
}
