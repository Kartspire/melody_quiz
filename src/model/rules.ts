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


export function getNextQuestionPoints(questions: readonly { points: number }[]) {
  const used = new Set(questions.map((question) => question.points));
  const max = questions.reduce((value, question) => Math.max(value, question.points), 0);
  const nextAfterMax = max + 100;
  if (isValidQuestionPoints(nextAfterMax) && !used.has(nextAfterMax)) return nextAfterMax;

  // A category contains at most 100 questions, so one of the first N+1 standard
  // 100-point slots is guaranteed to be free.
  for (let index = 1; index <= questions.length + 1; index += 1) {
    const candidate = index * 100;
    if (isValidQuestionPoints(candidate) && !used.has(candidate)) return candidate;
  }

  // Defensive fallback for custom point distributions close to the upper limit.
  for (let candidate = 1; candidate <= questions.length + 1; candidate += 1) {
    if (!used.has(candidate)) return candidate;
  }
  return 1;
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
