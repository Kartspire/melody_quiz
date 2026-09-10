import { DATA_LIMITS } from './limits';
import type { GameConfig, GameSession, GameSessionHistoryEntry, GameStage, InterRound, InterRoundSession, Question, Round } from './types';

type LegacyCompatibleSession = Partial<GameSession> & { gameId: string; roundIndex?: number };
type LegacyCompatibleInterRoundSession = Partial<InterRoundSession> & { interRoundId?: string };
type LegacyHistoryEntry = Partial<GameSessionHistoryEntry>;

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

export function getLowestScoringTeamId(config: GameConfig, scores: Record<string, number>) {
  let selectedId: string | null = null;
  let selectedScore = Number.POSITIVE_INFINITY;
  for (const team of config.teams) {
    const score = Number.isSafeInteger(scores[team.id]) ? scores[team.id] : 0;
    if (score < selectedScore) {
      selectedId = team.id;
      selectedScore = score;
    }
  }
  return selectedId;
}

/**
 * Keeps the random selector for the first ordinary round and chooses the lowest-scoring
 * team whenever a later ordinary round is entered. Non-round stages keep the value hidden.
 */
export function getSelectingTeamIdForStageEntry(
  config: GameConfig,
  scores: Record<string, number>,
  stageIndex: number,
  currentSelectingTeamId: string | null,
) {
  const teamIds = new Set(config.teams.map((team) => team.id));
  const validCurrent = currentSelectingTeamId && teamIds.has(currentSelectingTeamId)
    ? currentSelectingTeamId
    : null;
  const stage = config.stages[stageIndex];
  if (stage?.kind !== 'round') return validCurrent;
  if (getRoundOrdinal(config, stageIndex) === 1) return validCurrent ?? config.teams[0]?.id ?? null;
  return getLowestScoringTeamId(config, scores);
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

  const history = Array.isArray(session.history)
    ? session.history
        .slice(-DATA_LIMITS.sessionHistoryEntries)
        .map((entry) => normalizeHistoryEntry(entry, config))
        .filter((entry): entry is GameSessionHistoryEntry => Boolean(entry))
    : [];

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
    selectingTeamId: typeof session.selectingTeamId === 'string'
      ? session.selectingTeamId
      : typeof session.awardedTeamId === 'string'
        ? session.awardedTeamId
        : null,
    awardedTeamId: typeof session.awardedTeamId === 'string' ? session.awardedTeamId : null,
    answerRevealed: Boolean(answerRevealed),
    activeExcludedTeamIds,
    currentIncorrectTeamIds: Array.isArray(session.currentIncorrectTeamIds)
      ? session.currentIncorrectTeamIds
      : inferredCurrentIncorrectTeamIds,
    nextExcludedTeamIds,
    history,
    updatedAt: Number.isFinite(session.updatedAt) && (session.updatedAt as number) > 0
      ? session.updatedAt as number
      : config?.createdAt ?? Date.now(),
  };
}

export function reconcileSession(
  config: GameConfig,
  rawSession: GameSession | LegacyCompatibleSession,
  options: { autoAdvanceCompletedStage?: boolean } = {},
): GameSession {
  const session = normalizeSession(rawSession, config);
  const teamIds = new Set(config.teams.map((team) => team.id));
  const questionIds = new Set(config.rounds.flatMap((round) => round.categories.flatMap((category) => category.questions.map((question) => question.id))));
  const interRoundIds = new Set(config.interRounds.map((interRound) => interRound.id));
  const completedQuestionIds = unique(session.completedQuestionIds.filter((id) => questionIds.has(id)));
  let completedInterRoundIds = unique(session.completedInterRoundIds.filter((id) => interRoundIds.has(id)));
  const scores = Object.fromEntries(config.teams.map((team) => [team.id, Number.isSafeInteger(session.scores?.[team.id]) ? session.scores[team.id] : 0]));

  let stageIndex = resolveStageIndex(config, session);
  const initialStageIndex = stageIndex;
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
  if (options.autoAdvanceCompletedStage !== false && session.started && !activeQuestionId) {
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
  const preservedSelectingTeamId = initialStageIndex === stageIndex
    && session.selectingTeamId && teamIds.has(session.selectingTeamId)
      ? session.selectingTeamId
      : null;
  const selectingTeamId = preservedSelectingTeamId ?? getSelectingTeamIdForStageEntry(
    config,
    scores,
    stageIndex,
    null,
  );

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
    selectingTeamId,
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

function normalizeHistoryEntry(rawEntry: unknown, config?: GameConfig): GameSessionHistoryEntry | null {
  if (!rawEntry || typeof rawEntry !== 'object') return null;
  const entry = rawEntry as LegacyHistoryEntry;
  let stageIndex = Number.isSafeInteger(entry.stageIndex) ? Math.max(0, entry.stageIndex as number) : 0;
  let stageId = typeof entry.stageId === 'string' && entry.stageId ? entry.stageId : null;
  if (config) {
    const stableStageIndex = stageId ? config.stages.findIndex((stage) => stage.id === stageId) : -1;
    if (stableStageIndex >= 0) {
      stageIndex = stableStageIndex;
    } else {
      stageIndex = Math.min(stageIndex, config.stages.length);
      stageId = config.stages[stageIndex]?.id ?? null;
    }
  }
  const interRound = entry.interRound && typeof entry.interRound.interRoundId === 'string'
    ? {
        interRoundId: entry.interRound.interRoundId,
        phase: entry.interRound.phase === 'play' || entry.interRound.phase === 'answer' ? entry.interRound.phase : 'intro' as const,
        taskIndex: Number.isSafeInteger(entry.interRound.taskIndex) ? Math.max(0, entry.interRound.taskIndex as number) : 0,
        itemId: typeof entry.interRound.itemId === 'string' && entry.interRound.itemId ? entry.interRound.itemId : null,
        trackIndex: Number.isSafeInteger(entry.interRound.trackIndex) ? Math.max(0, entry.interRound.trackIndex as number) : 0,
      }
    : null;
  return {
    started: Boolean(entry.started),
    stageIndex,
    stageId,
    activeQuestionId: typeof entry.activeQuestionId === 'string' ? entry.activeQuestionId : null,
    pausedQuestionId: typeof entry.pausedQuestionId === 'string' ? entry.pausedQuestionId : null,
    completedQuestionIds: Array.isArray(entry.completedQuestionIds) ? entry.completedQuestionIds.filter((id): id is string => typeof id === 'string') : [],
    completedInterRoundIds: Array.isArray(entry.completedInterRoundIds) ? entry.completedInterRoundIds.filter((id): id is string => typeof id === 'string') : [],
    interRound,
    scores: entry.scores && typeof entry.scores === 'object'
      ? Object.fromEntries(Object.entries(entry.scores).filter(([, score]) => Number.isSafeInteger(score)))
      : {},
    selectingTeamId: typeof entry.selectingTeamId === 'string'
      ? entry.selectingTeamId
      : typeof entry.awardedTeamId === 'string'
        ? entry.awardedTeamId
        : null,
    awardedTeamId: typeof entry.awardedTeamId === 'string' ? entry.awardedTeamId : null,
    answerRevealed: Boolean(entry.answerRevealed),
    activeExcludedTeamIds: Array.isArray(entry.activeExcludedTeamIds) ? entry.activeExcludedTeamIds.filter((id): id is string => typeof id === 'string') : [],
    currentIncorrectTeamIds: Array.isArray(entry.currentIncorrectTeamIds) ? entry.currentIncorrectTeamIds.filter((id): id is string => typeof id === 'string') : [],
    nextExcludedTeamIds: Array.isArray(entry.nextExcludedTeamIds) ? entry.nextExcludedTeamIds.filter((id): id is string => typeof id === 'string') : [],
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
