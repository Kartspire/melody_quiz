import type { GameConfig, GameSession, Question } from './types';

export function findQuestion(config: GameConfig, questionId: string): Question | undefined {
  for (const round of config.rounds) {
    for (const category of round.categories) {
      const question = category.questions.find((item) => item.id === questionId);
      if (question) return question;
    }
  }
  return undefined;
}

export function isRoundComplete(config: GameConfig, session: GameSession) {
  const round = config.rounds[session.roundIndex];
  if (!round) return true;
  const ids = round.categories.flatMap((category) => category.questions.map((question) => question.id));
  return ids.length > 0 && ids.every((id) => session.completedQuestionIds.includes(id));
}

export function normalizeSession(session: GameSession): GameSession {
  const activeExcludedTeamIds = Array.isArray(session.activeExcludedTeamIds) ? session.activeExcludedTeamIds : [];
  const nextExcludedTeamIds = Array.isArray(session.nextExcludedTeamIds) ? session.nextExcludedTeamIds : [];
  const answerRevealed = session.answerRevealed ?? Boolean(session.awardedTeamId);
  const inferredCurrentIncorrectTeamIds = session.activeQuestionId && !answerRevealed
    ? nextExcludedTeamIds.filter((id) => !activeExcludedTeamIds.includes(id))
    : [];

  return {
    ...session,
    answerRevealed,
    activeExcludedTeamIds,
    currentIncorrectTeamIds: Array.isArray(session.currentIncorrectTeamIds)
      ? session.currentIncorrectTeamIds
      : inferredCurrentIncorrectTeamIds,
    nextExcludedTeamIds,
  };
}

export function reconcileSession(config: GameConfig, rawSession: GameSession): GameSession {
  const session = normalizeSession(rawSession);
  const teamIds = new Set(config.teams.map((team) => team.id));
  const scores = Object.fromEntries(config.teams.map((team) => [team.id, Number.isSafeInteger(session.scores?.[team.id]) ? session.scores[team.id] : 0]));
  const questionIds = new Set(
    config.rounds.flatMap((round) => round.categories.flatMap((category) => category.questions.map((question) => question.id))),
  );

  return {
    ...session,
    gameId: config.id,
    started: Boolean(session.started),
    roundIndex: Number.isSafeInteger(session.roundIndex) ? Math.max(0, Math.min(session.roundIndex, config.rounds.length)) : 0,
    activeQuestionId: session.activeQuestionId && questionIds.has(session.activeQuestionId) ? session.activeQuestionId : null,
    completedQuestionIds: Array.isArray(session.completedQuestionIds) ? [...new Set(session.completedQuestionIds.filter((id) => questionIds.has(id)))] : [],
    scores,
    awardedTeamId: session.awardedTeamId && teamIds.has(session.awardedTeamId) ? session.awardedTeamId : null,
    answerRevealed: Boolean(session.answerRevealed),
    activeExcludedTeamIds: [...new Set(session.activeExcludedTeamIds.filter((id) => teamIds.has(id)))],
    currentIncorrectTeamIds: [...new Set(session.currentIncorrectTeamIds.filter((id) => teamIds.has(id)))],
    nextExcludedTeamIds: [...new Set(session.nextExcludedTeamIds.filter((id) => teamIds.has(id)))],
  };
}
