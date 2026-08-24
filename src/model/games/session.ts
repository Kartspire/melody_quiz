import { combine, createEvent, sample } from 'effector';
import { createSession } from '../defaults';
import {
  findQuestion,
  getActiveStage,
  getInterRoundForStage,
  getRoundForStage,
  getRoundOrdinal,
  isRoundComplete,
  reconcileSession,
} from '../session';
import { getInterRoundAnswerStepCount } from '../../interRounds/templates';
import { $audioAssets, $games, $mediaTracks, $sessions, $songs } from '../core/state';
import { $activeGame, $session } from './selectors';
import { DATA_LIMITS } from '../limits';
import type { AudioAsset, GameConfig, GameSession, GameSessionHistoryEntry, MediaTrack, PlayableQuestion, Question, Song } from '../types';

export const gameProgressResetRequested = createEvent();
export const questionOpened = createEvent<string>();
export const questionClosed = createEvent<{ completed: boolean; advanceStage?: boolean }>();
export const teamAwarded = createEvent<string>();
export const teamIncorrectToggled = createEvent<string>();
export const nobodyGuessed = createEvent();
export const teamScoreChanged = createEvent<{ teamId: string; score: number }>();
export const nextStageRequested = createEvent();
export const previousStageRequested = createEvent();
export const interRoundStarted = createEvent();
export const interRoundAnswerRevealed = createEvent();
export const commonThemeTrackAdvanced = createEvent();
export const interRoundNextRequested = createEvent();

export const gameSessionResetRequested = createEvent<string>();

sample({
  clock: gameProgressResetRequested,
  source: $activeGame,
  filter: (game) => Boolean(game),
  fn: (game) => game!.id,
  target: gameSessionResetRequested,
});

sample({
  clock: gameSessionResetRequested,
  source: combine({ games: $games, sessions: $sessions }),
  filter: ({ games }, gameId) => games.some((game) => game.id === gameId),
  fn: ({ games, sessions }, gameId) => {
    const game = games.find((item) => item.id === gameId)!;
    return { ...sessions, [gameId]: createSession(game) };
  },
  target: $sessions,
});

sample({
  clock: questionOpened,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }, questionId) => {
    if (!game) return false;
    const session = sessions[game.id];
    if (!session) return false;
    const round = getRoundForStage(game, getActiveStage(game, session));
    return Boolean(
      !session.activeQuestionId
      && round?.categories.some((category) =>
        category.questions.some((question) => question.id === questionId),
      ) && !session.completedQuestionIds.includes(questionId),
    );
  },
  fn: ({ game, sessions }, questionId) => {
    const session = sessions[game!.id];
    return {
      ...sessions,
      [game!.id]: withCheckpoint(session, {
        started: true,
        activeQuestionId: questionId,
        pausedQuestionId: null,
        awardedTeamId: null,
        answerRevealed: false,
        activeExcludedTeamIds: session.pausedQuestionId === questionId
          ? unique(session.activeExcludedTeamIds)
          : unique(session.nextExcludedTeamIds),
        currentIncorrectTeamIds: session.pausedQuestionId === questionId
          ? unique(session.currentIncorrectTeamIds)
          : [],
        nextExcludedTeamIds: session.pausedQuestionId === questionId
          ? unique(session.nextExcludedTeamIds)
          : [],
      }),
    };
  },
  target: $sessions,
});

sample({
  clock: questionClosed,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }) => Boolean(game && sessions[game.id]?.activeQuestionId),
  fn: ({ game, sessions }, { completed, advanceStage = false }) => {
    const session = sessions[game!.id];
    if (!completed) {
      return {
        ...sessions,
        [game!.id]: {
          ...session,
          history: session.history.slice(0, -1),
          updatedAt: Date.now(),
          activeQuestionId: null,
          pausedQuestionId: session.activeQuestionId,
          awardedTeamId: null,
          answerRevealed: false,
          activeExcludedTeamIds: unique(session.activeExcludedTeamIds),
          currentIncorrectTeamIds: unique(session.currentIncorrectTeamIds),
          nextExcludedTeamIds: unique(session.nextExcludedTeamIds),
        },
      };
    }

    const nextStageIndex = advanceStage
      ? Math.min(session.stageIndex + 1, game!.stages.length)
      : session.stageIndex;
    return {
      ...sessions,
      [game!.id]: withCheckpoint(session, {
        stageIndex: nextStageIndex,
        stageId: game!.stages[nextStageIndex]?.id ?? null,
        activeQuestionId: null,
        pausedQuestionId: null,
        interRound: null,
        awardedTeamId: null,
        answerRevealed: false,
        activeExcludedTeamIds: [],
        currentIncorrectTeamIds: [],
        nextExcludedTeamIds: unique(session.nextExcludedTeamIds),
      }),
    };
  },
  target: $sessions,
});

sample({
  clock: teamAwarded,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }, teamId) => {
    if (!game) return false;
    const session = sessions[game.id];
    return Boolean(
      session?.activeQuestionId
      && game.teams.some((team) => team.id === teamId)
      && !session.answerRevealed
      && !session.activeExcludedTeamIds.includes(teamId)
      && !session.currentIncorrectTeamIds.includes(teamId)
      && !session.completedQuestionIds.includes(session.activeQuestionId),
    );
  },
  fn: ({ game, sessions }, teamId) => {
    const session = sessions[game!.id];
    const question = findQuestion(game!, session.activeQuestionId!);
    return {
      ...sessions,
      [game!.id]: withCheckpoint(session, {
        awardedTeamId: teamId,
        answerRevealed: true,
        completedQuestionIds: unique([...session.completedQuestionIds, session.activeQuestionId!]),
        scores: {
          ...session.scores,
          [teamId]: safeAddScore(session.scores[teamId] ?? 0, question?.points ?? 0),
        },
      }),
    };
  },
  target: $sessions,
});

sample({
  clock: teamIncorrectToggled,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }, teamId) => {
    if (!game) return false;
    const session = sessions[game.id];
    return Boolean(
      session?.activeQuestionId
      && game.teams.some((team) => team.id === teamId)
      && !session.answerRevealed
      && !session.activeExcludedTeamIds.includes(teamId)
      && !session.currentIncorrectTeamIds.includes(teamId),
    );
  },
  fn: ({ game, sessions }, teamId) => {
    const session = sessions[game!.id];
    return {
      ...sessions,
      [game!.id]: {
        ...session,
        updatedAt: Date.now(),
        currentIncorrectTeamIds: unique([...session.currentIncorrectTeamIds, teamId]),
        nextExcludedTeamIds: unique([...session.nextExcludedTeamIds, teamId]),
      },
    };
  },
  target: $sessions,
});

sample({
  clock: nobodyGuessed,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }) => {
    if (!game) return false;
    const session = sessions[game.id];
    return Boolean(
      session?.activeQuestionId
      && !session.answerRevealed
      && !session.completedQuestionIds.includes(session.activeQuestionId),
    );
  },
  fn: ({ game, sessions }) => {
    const session = sessions[game!.id];
    return {
      ...sessions,
      [game!.id]: withCheckpoint(session, {
        awardedTeamId: null,
        answerRevealed: true,
        completedQuestionIds: unique([...session.completedQuestionIds, session.activeQuestionId!]),
      }),
    };
  },
  target: $sessions,
});

sample({
  clock: teamScoreChanged,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }, { teamId, score }) => Boolean(
    game
    && sessions[game.id]
    && game.teams.some((team) => team.id === teamId)
    && Number.isSafeInteger(score)
    && sessions[game.id].scores[teamId] !== score,
  ),
  fn: ({ game, sessions }, { teamId, score }) => {
    const session = sessions[game!.id];
    return {
      ...sessions,
      [game!.id]: {
        ...session,
        updatedAt: Date.now(),
        scores: { ...session.scores, [teamId]: score },
        history: session.history.map((entry) => ({
          ...entry,
          scores: { ...entry.scores, [teamId]: score },
        })),
      },
    };
  },
  target: $sessions,
});

sample({
  clock: nextStageRequested,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }) => {
    if (!game) return false;
    const session = sessions[game.id];
    if (!session || session.stageIndex >= game.stages.length) return false;
    const stage = getActiveStage(game, session);
    return stage?.kind === 'round' ? isRoundComplete(game, session) : false;
  },
  fn: ({ game, sessions }) => {
    const session = sessions[game!.id];
    const nextStageIndex = Math.min(session.stageIndex + 1, game!.stages.length);
    return {
      ...sessions,
      [game!.id]: withCheckpoint(session, {
        stageIndex: nextStageIndex,
        stageId: game!.stages[nextStageIndex]?.id ?? null,
        activeQuestionId: null,
        pausedQuestionId: null,
        interRound: null,
        awardedTeamId: null,
        answerRevealed: false,
        activeExcludedTeamIds: [],
        currentIncorrectTeamIds: [],
      }),
    };
  },
  target: $sessions,
});

sample({
  clock: interRoundStarted,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }) => {
    if (!game) return false;
    const session = sessions[game.id];
    return Boolean(session && getActiveStage(game, session)?.kind === 'interRound');
  },
  fn: ({ game, sessions }) => {
    const session = sessions[game!.id];
    const interRound = getInterRoundForStage(game!, getActiveStage(game!, session));
    if (!interRound) return sessions;
    return {
      ...sessions,
      [game!.id]: withCheckpoint(session, {
        started: true,
        pausedQuestionId: null,
        activeExcludedTeamIds: [],
        currentIncorrectTeamIds: [],
        interRound: {
          interRoundId: interRound.id,
          phase: 'play' as const,
          taskIndex: 0,
          itemId: interRound.templateId === 'continueLyrics'
            ? interRound.tasks[0]?.id ?? null
            : interRound.stages[0]?.id ?? null,
          trackIndex: 0,
        },
      }),
    };
  },
  target: $sessions,
});

sample({
  clock: commonThemeTrackAdvanced,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }) => {
    if (!game) return false;
    const session = sessions[game.id];
    const interRound = session
      ? getInterRoundForStage(game, getActiveStage(game, session))
      : null;
    return Boolean(
      session?.interRound?.phase === 'play'
      && interRound?.templateId === 'commonTheme4'
      && session.interRound.taskIndex < interRound.stages.length
      && session.interRound.trackIndex < 4,
    );
  },
  fn: ({ game, sessions }) => {
    const session = sessions[game!.id];
    return {
      ...sessions,
      [game!.id]: withCheckpoint(session, {
        interRound: session.interRound
          ? { ...session.interRound, trackIndex: Math.min(session.interRound.trackIndex + 1, 4) }
          : null,
      }),
    };
  },
  target: $sessions,
});

sample({
  clock: interRoundAnswerRevealed,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }) => {
    if (!game) return false;
    const session = sessions[game.id];
    if (session?.interRound?.phase !== 'play') return false;
    const interRound = getInterRoundForStage(game, getActiveStage(game, session));
    return interRound?.templateId === 'commonTheme4'
      ? session.interRound.trackIndex >= 4
      : Boolean(interRound);
  },
  fn: ({ game, sessions }) => {
    const session = sessions[game!.id];
    return {
      ...sessions,
      [game!.id]: withCheckpoint(session, {
        interRound: session.interRound
          ? { ...session.interRound, phase: 'answer' as const }
          : null,
      }),
    };
  },
  target: $sessions,
});

sample({
  clock: interRoundNextRequested,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }) => {
    if (!game) return false;
    const session = sessions[game.id];
    const interRound = session
      ? getInterRoundForStage(game, getActiveStage(game, session))
      : null;
    return Boolean(session?.interRound?.phase === 'answer' && interRound);
  },
  fn: ({ game, sessions }) => {
    const session = sessions[game!.id];
    const interRound = getInterRoundForStage(game!, getActiveStage(game!, session))!;
    const taskCount = getInterRoundAnswerStepCount(interRound);
    const nextTaskIndex = (session.interRound?.taskIndex ?? 0) + 1;
    if (nextTaskIndex < taskCount) {
      return {
        ...sessions,
        [game!.id]: withCheckpoint(session, {
          interRound: {
            interRoundId: interRound.id,
            phase: 'play' as const,
            taskIndex: nextTaskIndex,
            itemId: interRound.templateId === 'continueLyrics'
              ? interRound.tasks[nextTaskIndex]?.id ?? null
              : interRound.stages[nextTaskIndex]?.id ?? null,
            trackIndex: 0,
          },
        }),
      };
    }
    const nextStageIndex = Math.min(session.stageIndex + 1, game!.stages.length);
    return {
      ...sessions,
      [game!.id]: withCheckpoint(session, {
        stageIndex: nextStageIndex,
        stageId: game!.stages[nextStageIndex]?.id ?? null,
        completedInterRoundIds: unique([...session.completedInterRoundIds, interRound.id]),
        interRound: null,
        pausedQuestionId: null,
      }),
    };
  },
  target: $sessions,
});

sample({
  clock: previousStageRequested,
  source: combine({ game: $activeGame, sessions: $sessions }),
  filter: ({ game, sessions }) => Boolean(game && sessions[game.id] && canNavigateBack(game, sessions[game.id])),
  fn: ({ game, sessions }) => {
    const session = sessions[game!.id];
    const restored = restorePreviousSession(game!, session);
    return restored === session ? sessions : { ...sessions, [game!.id]: restored };
  },
  target: $sessions,
});

export const $canGoToPreviousStage = combine($activeGame, $session, (game, session) =>
  Boolean(game && session && canNavigateBack(game, session)),
);

export const $activeStage = combine($activeGame, $session, (game, session) =>
  game && session ? getActiveStage(game, session) : null,
);

export const $activeRound = combine($activeGame, $activeStage, (game, stage) =>
  game ? getRoundForStage(game, stage) : null,
);

export const $activeInterRound = combine($activeGame, $activeStage, (game, stage) =>
  game ? getInterRoundForStage(game, stage) : null,
);

export const $activeRoundOrdinal = combine($activeGame, $session, (game, session) =>
  game && session ? getRoundOrdinal(game, session.stageIndex) : 1,
);

export const $activeQuestion = combine(
  {
    game: $activeGame,
    session: $session,
    songs: $songs,
    mediaTracks: $mediaTracks,
    audioAssets: $audioAssets,
  },
  ({ game, session, songs, mediaTracks, audioAssets }): PlayableQuestion | null => {
    if (!game || !session?.activeQuestionId) return null;
    const question = findQuestion(game, session.activeQuestionId);
    return question ? resolveQuestion(question, songs, mediaTracks, audioAssets) : null;
  },
);

export const $isGameFinished = combine($activeGame, $session, (game, session) =>
  Boolean(game && session && session.stageIndex >= game.stages.length),
);

function withCheckpoint(
  session: GameSession,
  changes: Partial<GameSessionHistoryEntry>,
): GameSession {
  return {
    ...session,
    ...changes,
    history: [...session.history, createCheckpoint(session)].slice(-DATA_LIMITS.sessionHistoryEntries),
    updatedAt: Date.now(),
  };
}

function createCheckpoint(session: GameSession): GameSessionHistoryEntry {
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

function canNavigateBack(game: GameConfig, session: GameSession) {
  return session.history.length > 0
    || Boolean(session.activeQuestionId)
    || Boolean(session.interRound)
    || session.stageIndex > 0;
}

function restorePreviousSession(game: GameConfig, session: GameSession): GameSession {
  const checkpoint = session.history.at(-1);
  if (checkpoint) {
    const restored = reconcileSession(
      game,
      {
        gameId: session.gameId,
        ...checkpoint,
        history: session.history.slice(0, -1),
        updatedAt: Date.now(),
      },
      { autoAdvanceCompletedStage: false },
    );
    return { ...restored, updatedAt: Date.now() };
  }

  return restoreLegacyPreviousSession(game, session);
}

function restoreLegacyPreviousSession(game: GameConfig, session: GameSession): GameSession {
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
        updatedAt: Date.now(),
        completedQuestionIds: session.completedQuestionIds.filter((id) => id !== questionId),
        scores,
        awardedTeamId: null,
        answerRevealed: false,
      };
    }
    return {
      ...session,
      updatedAt: Date.now(),
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
        updatedAt: Date.now(),
        interRound: { ...session.interRound, phase: 'play' },
      };
    }
    if (interRound.templateId === 'commonTheme4' && session.interRound.trackIndex > 0) {
      return {
        ...session,
        updatedAt: Date.now(),
        interRound: { ...session.interRound, trackIndex: session.interRound.trackIndex - 1 },
      };
    }
    if (session.interRound.taskIndex > 0) {
      const previousTaskIndex = session.interRound.taskIndex - 1;
      return {
        ...session,
        updatedAt: Date.now(),
        interRound: {
          interRoundId: interRound.id,
          phase: 'answer',
          taskIndex: previousTaskIndex,
          itemId: interRound.templateId === 'continueLyrics'
            ? interRound.tasks[previousTaskIndex]?.id ?? null
            : interRound.stages[previousTaskIndex]?.id ?? null,
          trackIndex: interRound.templateId === 'commonTheme4' ? 4 : 0,
        },
      };
    }
    return { ...session, updatedAt: Date.now(), interRound: null };
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
      updatedAt: Date.now(),
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
    updatedAt: Date.now(),
    stageIndex: previousStageIndex,
    stageId: previousStage.id,
    activeQuestionId: null,
    pausedQuestionId: null,
    interRound: null,
    awardedTeamId: null,
    answerRevealed: false,
  };
}

function resolveQuestion(
  question: Question,
  songs: Song[],
  mediaTracks: MediaTrack[],
  audioAssets: AudioAsset[],
): PlayableQuestion {
  const song = question.songId ? songs.find((item) => item.id === question.songId) : undefined;
  const minusTrack = song?.minusTrackId
    ? mediaTracks.find((track) => track.id === song.minusTrackId)
    : undefined;
  const plusTrack = song?.plusTrackId
    ? mediaTracks.find((track) => track.id === song.plusTrackId)
    : undefined;
  return {
    ...question,
    song,
    minusTrack,
    plusTrack,
    minus: minusTrack ? audioAssets.find((asset) => asset.id === minusTrack.audioId) : undefined,
    plus: plusTrack ? audioAssets.find((asset) => asset.id === plusTrack.audioId) : undefined,
  };
}

function safeAddScore(current: number, delta: number) {
  const next = current + delta;
  if (Number.isSafeInteger(next)) return next;
  return delta >= 0 ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER;
}

function unique(values: string[]) {
  return [...new Set(values)];
}
