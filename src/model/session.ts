import type { GameConfig, GameSession, GameStage, InterRound, Question, Round } from './types';

export function findQuestion(config: GameConfig, questionId: string): Question | undefined {
  for (const round of config.rounds) {
    for (const category of round.categories) {
      const question = category.questions.find((item) => item.id === questionId);
      if (question) return question;
    }
  }
  return undefined;
}

export function getActiveStage(config: GameConfig, session: GameSession): GameStage | null {
  return config.stages[session.stageIndex] ?? null;
}

export function getRoundForStage(config: GameConfig, stage: GameStage | null | undefined): Round | null {
  if (!stage || stage.kind !== 'round') return null;
  return config.rounds.find((round) => round.id === stage.roundId) ?? null;
}

export function getInterRoundForStage(config: GameConfig, stage: GameStage | null | undefined): InterRound | null {
  if (!stage || stage.kind !== 'interRound') return null;
  return config.interRounds.find((interRound) => interRound.id === stage.interRoundId) ?? null;
}

export function getRoundOrdinal(config: GameConfig, stageIndex: number): number {
  let ordinal = 0;
  for (let index = 0; index <= Math.min(stageIndex, config.stages.length - 1); index += 1) {
    if (config.stages[index]?.kind === 'round') ordinal += 1;
  }
  return Math.max(1, ordinal);
}

export function isRoundComplete(config: GameConfig, session: GameSession) {
  const round = getRoundForStage(config, getActiveStage(config, session));
  if (!round) return false;
  const ids = round.categories.flatMap((category) => category.questions.map((question) => question.id));
  return ids.length > 0 && ids.every((id) => session.completedQuestionIds.includes(id));
}

export function normalizeSession(rawSession: GameSession | (Partial<GameSession> & { roundIndex?: number }), config?: GameConfig): GameSession {
  const session = rawSession as Partial<GameSession> & { roundIndex?: number; gameId: string };
  const activeExcludedTeamIds = Array.isArray(session.activeExcludedTeamIds) ? session.activeExcludedTeamIds : [];
  const nextExcludedTeamIds = Array.isArray(session.nextExcludedTeamIds) ? session.nextExcludedTeamIds : [];
  const answerRevealed = session.answerRevealed ?? Boolean(session.awardedTeamId);
  const inferredCurrentIncorrectTeamIds = session.activeQuestionId && !answerRevealed
    ? nextExcludedTeamIds.filter((id) => !activeExcludedTeamIds.includes(id))
    : [];

  let stageIndex = Number.isSafeInteger(session.stageIndex) ? Math.max(0, session.stageIndex as number) : 0;
  if (!Number.isSafeInteger(session.stageIndex) && Number.isSafeInteger(session.roundIndex) && config) {
    const targetRoundIndex = Math.max(0, session.roundIndex as number);
    let seenRounds = 0;
    stageIndex = config.stages.length;
    for (let index = 0; index < config.stages.length; index += 1) {
      if (config.stages[index].kind !== 'round') continue;
      if (seenRounds === targetRoundIndex) {
        stageIndex = index;
        break;
      }
      seenRounds += 1;
    }
  }

  let interRound = session.interRound && typeof session.interRound.interRoundId === 'string'
    ? {
        interRoundId: session.interRound.interRoundId,
        phase: session.interRound.phase === 'play' || session.interRound.phase === 'answer' ? session.interRound.phase : 'intro' as const,
        taskIndex: Number.isSafeInteger(session.interRound.taskIndex) ? Math.max(0, session.interRound.taskIndex) : 0,
        trackIndex: Number.isSafeInteger(session.interRound.trackIndex) ? Math.max(0, session.interRound.trackIndex) : 0,
      }
    : null;

  if (interRound && config) {
    const activeStage = config.stages[stageIndex];
    const activeInterRound = activeStage?.kind === 'interRound'
      ? config.interRounds.find((item) => item.id === activeStage.interRoundId)
      : undefined;
    if (activeInterRound?.templateId === 'commonTheme4' && !Number.isSafeInteger(session.interRound?.trackIndex)) {
      // In template v1 taskIndex represented the currently playing track (0..4).
      interRound = { ...interRound, taskIndex: 0, trackIndex: Math.min(interRound.taskIndex, 4) };
    }
  }

  return {
    gameId: session.gameId,
    started: Boolean(session.started),
    stageIndex,
    activeQuestionId: typeof session.activeQuestionId === 'string' ? session.activeQuestionId : null,
    completedQuestionIds: Array.isArray(session.completedQuestionIds) ? session.completedQuestionIds : [],
    completedInterRoundIds: Array.isArray(session.completedInterRoundIds) ? session.completedInterRoundIds : [],
    interRound,
    scores: session.scores && typeof session.scores === 'object' ? session.scores : {},
    awardedTeamId: typeof session.awardedTeamId === 'string' ? session.awardedTeamId : null,
    answerRevealed: Boolean(answerRevealed),
    activeExcludedTeamIds,
    currentIncorrectTeamIds: Array.isArray(session.currentIncorrectTeamIds)
      ? session.currentIncorrectTeamIds
      : inferredCurrentIncorrectTeamIds,
    nextExcludedTeamIds,
  };
}

export function reconcileSession(config: GameConfig, rawSession: GameSession | (Partial<GameSession> & { roundIndex?: number })): GameSession {
  const session = normalizeSession(rawSession, config);
  const teamIds = new Set(config.teams.map((team) => team.id));
  const scores = Object.fromEntries(config.teams.map((team) => [team.id, Number.isSafeInteger(session.scores?.[team.id]) ? session.scores[team.id] : 0]));
  const questionIds = new Set(config.rounds.flatMap((round) => round.categories.flatMap((category) => category.questions.map((question) => question.id))));
  const interRoundIds = new Set(config.interRounds.map((interRound) => interRound.id));
  const stageIndex = Math.max(0, Math.min(session.stageIndex, config.stages.length));
  const activeStage = config.stages[stageIndex];
  const activeQuestionId = activeStage?.kind === 'round' && session.activeQuestionId && questionIds.has(session.activeQuestionId)
    ? session.activeQuestionId
    : null;
  let interRound = activeStage?.kind === 'interRound' && session.interRound?.interRoundId === activeStage.interRoundId && interRoundIds.has(activeStage.interRoundId)
    ? session.interRound
    : null;
  if (interRound && activeStage?.kind === 'interRound') {
    const configInterRound = config.interRounds.find((item) => item.id === activeStage.interRoundId);
    if (configInterRound?.templateId === 'continueLyrics') {
      interRound = {
        ...interRound,
        taskIndex: Math.min(interRound.taskIndex, Math.max(0, configInterRound.tasks.length - 1)),
        trackIndex: 0,
      };
    } else if (configInterRound?.templateId === 'commonTheme4') {
      interRound = {
        ...interRound,
        taskIndex: Math.min(interRound.taskIndex, Math.max(0, configInterRound.stages.length - 1)),
        trackIndex: Math.min(interRound.trackIndex, 4),
      };
    }
  }

  return {
    ...session,
    gameId: config.id,
    stageIndex,
    activeQuestionId,
    completedQuestionIds: [...new Set(session.completedQuestionIds.filter((id) => questionIds.has(id)))],
    completedInterRoundIds: [...new Set(session.completedInterRoundIds.filter((id) => interRoundIds.has(id)))],
    interRound,
    scores,
    awardedTeamId: session.awardedTeamId && teamIds.has(session.awardedTeamId) ? session.awardedTeamId : null,
    answerRevealed: Boolean(session.answerRevealed),
    activeExcludedTeamIds: [...new Set(session.activeExcludedTeamIds.filter((id) => teamIds.has(id)))],
    currentIncorrectTeamIds: [...new Set(session.currentIncorrectTeamIds.filter((id) => teamIds.has(id)))],
    nextExcludedTeamIds: [...new Set(session.nextExcludedTeamIds.filter((id) => teamIds.has(id)))],
  };
}
