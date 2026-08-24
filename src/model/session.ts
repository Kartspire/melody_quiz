import type { GameConfig, GameSession, GameStage, InterRound, InterRoundSession, Question, Round } from './types';

type LegacyCompatibleSession = Partial<GameSession> & { gameId: string; roundIndex?: number };
type LegacyCompatibleInterRoundSession = Partial<InterRoundSession> & { interRoundId?: string };

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
  if (session.stageId) {
    const byId = config.stages.find((stage) => stage.id === session.stageId);
    if (byId) return byId;
  }
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
  const ids = getRoundQuestionIds(round);
  return ids.length > 0 && ids.every((id) => session.completedQuestionIds.includes(id));
}

export function normalizeSession(rawSession: GameSession | LegacyCompatibleSession, config?: GameConfig): GameSession {
  const session = rawSession as LegacyCompatibleSession;
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

  let stageId = typeof session.stageId === 'string' && session.stageId ? session.stageId : null;
  if (config) {
    const stableStageIndex = stageId ? config.stages.findIndex((stage) => stage.id === stageId) : -1;
    if (stableStageIndex >= 0) {
      stageIndex = stableStageIndex;
    } else {
      stageIndex = Math.min(stageIndex, config.stages.length);
      stageId = config.stages[stageIndex]?.id ?? null;
    }
  }

  const rawInterRound = session.interRound as LegacyCompatibleInterRoundSession | null | undefined;
  let interRound: InterRoundSession | null = rawInterRound && typeof rawInterRound.interRoundId === 'string'
    ? {
        interRoundId: rawInterRound.interRoundId,
        phase: rawInterRound.phase === 'play' || rawInterRound.phase === 'answer' ? rawInterRound.phase : 'intro',
        taskIndex: Number.isSafeInteger(rawInterRound.taskIndex) ? Math.max(0, rawInterRound.taskIndex as number) : 0,
        itemId: typeof rawInterRound.itemId === 'string' && rawInterRound.itemId ? rawInterRound.itemId : null,
        trackIndex: Number.isSafeInteger(rawInterRound.trackIndex) ? Math.max(0, rawInterRound.trackIndex as number) : 0,
      }
    : null;

  if (interRound && config) {
    const activeStage = stageId
      ? config.stages.find((stage) => stage.id === stageId)
      : config.stages[stageIndex];
    const activeInterRound = activeStage?.kind === 'interRound'
      ? config.interRounds.find((item) => item.id === activeStage.interRoundId)
      : undefined;

    if (activeInterRound?.templateId === 'commonTheme4' && !Number.isSafeInteger(rawInterRound?.trackIndex)) {
      // In template v1 taskIndex represented the currently playing track (0..4).
      interRound = { ...interRound, taskIndex: 0, trackIndex: Math.min(interRound.taskIndex, 4) };
    }

    if (!interRound.itemId && activeInterRound) {
      interRound = {
        ...interRound,
        itemId: activeInterRound.templateId === 'continueLyrics'
          ? activeInterRound.tasks[interRound.taskIndex]?.id ?? null
          : activeInterRound.stages[interRound.taskIndex]?.id ?? null,
      };
    }
  }

  return {
    gameId: session.gameId,
    started: Boolean(session.started),
    stageIndex,
    stageId,
    activeQuestionId: typeof session.activeQuestionId === 'string' ? session.activeQuestionId : null,
    pausedQuestionId: typeof session.pausedQuestionId === 'string' ? session.pausedQuestionId : null,
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
    updatedAt: Number.isFinite(session.updatedAt) && (session.updatedAt as number) > 0
      ? session.updatedAt as number
      : config?.createdAt ?? Date.now(),
  };
}

export function reconcileSession(config: GameConfig, rawSession: GameSession | LegacyCompatibleSession): GameSession {
  const session = normalizeSession(rawSession, config);
  const teamIds = new Set(config.teams.map((team) => team.id));
  const questionIds = new Set(config.rounds.flatMap((round) => round.categories.flatMap((category) => category.questions.map((question) => question.id))));
  const interRoundIds = new Set(config.interRounds.map((interRound) => interRound.id));
  const completedQuestionIds = unique(session.completedQuestionIds.filter((id) => questionIds.has(id)));
  let completedInterRoundIds = unique(session.completedInterRoundIds.filter((id) => interRoundIds.has(id)));
  const scores = Object.fromEntries(config.teams.map((team) => [team.id, Number.isSafeInteger(session.scores?.[team.id]) ? session.scores[team.id] : 0]));

  let stageIndex = resolveStageIndex(config, session);
  let stageId = config.stages[stageIndex]?.id ?? null;
  let activeStage = config.stages[stageIndex];

  const activeRound = getRoundForStage(config, activeStage);
  const activeRoundQuestionIds = new Set(activeRound ? getRoundQuestionIds(activeRound) : []);
  let activeQuestionId = activeStage?.kind === 'round'
    && session.activeQuestionId
    && activeRoundQuestionIds.has(session.activeQuestionId)
      ? session.activeQuestionId
      : null;
  let pausedQuestionId = !activeQuestionId
    && activeStage?.kind === 'round'
    && session.pausedQuestionId
    && activeRoundQuestionIds.has(session.pausedQuestionId)
    && !completedQuestionIds.includes(session.pausedQuestionId)
      ? session.pausedQuestionId
      : null;

  if (activeStage?.kind === 'interRound' && isRemovedCurrentLastInterRoundItem(config, activeStage, session.interRound)) {
    completedInterRoundIds = unique([...completedInterRoundIds, activeStage.interRoundId]);
  }
  let interRound = completedInterRoundIds.includes(activeStage?.kind === 'interRound' ? activeStage.interRoundId : '')
    ? null
    : reconcileInterRoundProgress(config, activeStage, session.interRound);

  // Editing a running game can make the current stage already complete. Move forward
  // deterministically so the player cannot get stuck on an empty/completed board.
  if (session.started && !activeQuestionId) {
    const previousStageIndex = stageIndex;
    while (stageIndex < config.stages.length) {
      const stage = config.stages[stageIndex];
      const complete = stage.kind === 'round'
        ? isRoundCompleteByIds(config, stage, completedQuestionIds)
        : completedInterRoundIds.includes(stage.interRoundId);
      if (!complete) break;
      stageIndex += 1;
    }
    if (stageIndex !== previousStageIndex) {
      stageId = config.stages[stageIndex]?.id ?? null;
      activeStage = config.stages[stageIndex];
      if (activeStage?.kind !== 'round') activeQuestionId = null;
      pausedQuestionId = null;
      interRound = reconcileInterRoundProgress(config, activeStage, interRound);
    }
  }

  const awardedTeamId = session.awardedTeamId && teamIds.has(session.awardedTeamId)
    ? session.awardedTeamId
    : null;
  const answerRevealed = activeQuestionId ? Boolean(session.answerRevealed) : false;

  return {
    ...session,
    gameId: config.id,
    stageIndex,
    stageId,
    activeQuestionId,
    pausedQuestionId,
    completedQuestionIds,
    completedInterRoundIds,
    interRound,
    scores,
    awardedTeamId: activeQuestionId ? awardedTeamId : null,
    answerRevealed,
    activeExcludedTeamIds: activeQuestionId || pausedQuestionId
      ? unique(session.activeExcludedTeamIds.filter((id) => teamIds.has(id)))
      : [],
    currentIncorrectTeamIds: activeQuestionId || pausedQuestionId
      ? unique(session.currentIncorrectTeamIds.filter((id) => teamIds.has(id)))
      : [],
    nextExcludedTeamIds: unique(session.nextExcludedTeamIds.filter((id) => teamIds.has(id))),
  };
}

function resolveStageIndex(config: GameConfig, session: GameSession) {
  if (session.stageId) {
    const byId = config.stages.findIndex((stage) => stage.id === session.stageId);
    if (byId >= 0) return byId;
  }
  return Math.max(0, Math.min(session.stageIndex, config.stages.length));
}

function isRemovedCurrentLastInterRoundItem(
  config: GameConfig,
  activeStage: GameStage | undefined,
  progress: InterRoundSession | null,
) {
  if (activeStage?.kind !== 'interRound' || !progress || progress.interRoundId !== activeStage.interRoundId || !progress.itemId) return false;
  const interRound = config.interRounds.find((item) => item.id === activeStage.interRoundId);
  if (!interRound) return false;
  const items = interRound.templateId === 'continueLyrics' ? interRound.tasks : interRound.stages;
  const stillExists = items.some((item) => item.id === progress.itemId);
  return !stillExists && progress.taskIndex >= items.length;
}

function reconcileInterRoundProgress(
  config: GameConfig,
  activeStage: GameStage | undefined,
  progress: InterRoundSession | null,
): InterRoundSession | null {
  if (activeStage?.kind !== 'interRound' || progress?.interRoundId !== activeStage.interRoundId) return null;
  const configInterRound = config.interRounds.find((item) => item.id === activeStage.interRoundId);
  if (!configInterRound) return null;

  if (configInterRound.templateId === 'continueLyrics') {
    let taskIndex = progress.itemId
      ? configInterRound.tasks.findIndex((task) => task.id === progress.itemId)
      : -1;
    if (taskIndex < 0) taskIndex = Math.min(progress.taskIndex, Math.max(0, configInterRound.tasks.length - 1));
    return {
      ...progress,
      taskIndex,
      itemId: configInterRound.tasks[taskIndex]?.id ?? null,
      trackIndex: 0,
    };
  }

  let taskIndex = progress.itemId
    ? configInterRound.stages.findIndex((stage) => stage.id === progress.itemId)
    : -1;
  if (taskIndex < 0) taskIndex = Math.min(progress.taskIndex, Math.max(0, configInterRound.stages.length - 1));
  return {
    ...progress,
    taskIndex,
    itemId: configInterRound.stages[taskIndex]?.id ?? null,
    trackIndex: Math.min(progress.trackIndex, 4),
  };
}

function getRoundQuestionIds(round: Round) {
  return round.categories.flatMap((category) => category.questions.map((question) => question.id));
}

function isRoundCompleteByIds(config: GameConfig, stage: GameStage, completedQuestionIds: string[]) {
  const round = getRoundForStage(config, stage);
  if (!round) return false;
  const ids = getRoundQuestionIds(round);
  const completed = new Set(completedQuestionIds);
  return ids.length > 0 && ids.every((id) => completed.has(id));
}

function unique(values: string[]) {
  return [...new Set(values)];
}
