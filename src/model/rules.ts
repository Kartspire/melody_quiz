import { DATA_LIMITS, INTER_ROUND_LIMITS } from './limits';

export function normalizeRuleText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

export function isValidQuestionPoints(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 1
    && value <= DATA_LIMITS.maxQuestionPoints;
}

export function isQuestionPointsAvailable(
  questions: readonly { id: string; points: number }[],
  questionId: string,
  points: number,
) {
  return isValidQuestionPoints(points)
    && !questions.some((question) => question.id !== questionId && question.points === points);
}

export function isPersistableTeamName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= DATA_LIMITS.text.teamName;
}

export function isValidTeamColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

export function isTeamNameAvailable(
  teams: readonly { id: string; name: string }[],
  teamId: string,
  name: string,
) {
  const normalized = normalizeRuleText(name);
  if (!normalized) return true;
  return !teams.some((team) => team.id !== teamId && normalizeRuleText(team.name) === normalized);
}

export function isTeamColorAvailable(
  teams: readonly { id: string; color: string }[],
  teamId: string,
  color: string,
) {
  const normalized = color.toLowerCase();
  return !teams.some((team) => team.id !== teamId && team.color.toLowerCase() === normalized);
}

export function isValidContinueLyricsRequiredWordsCount(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= INTER_ROUND_LIMITS.continueLyrics.requiredWordsCount.min
    && value <= INTER_ROUND_LIMITS.continueLyrics.requiredWordsCount.max;
}

export function isValidContinueLyricsCutAtMs(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= INTER_ROUND_LIMITS.continueLyrics.cutAtMs.min
    && value <= INTER_ROUND_LIMITS.continueLyrics.cutAtMs.max;
}
