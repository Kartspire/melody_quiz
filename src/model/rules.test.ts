import { describe, expect, it } from 'vitest';
import { DATA_LIMITS, INTER_ROUND_LIMITS } from './limits';
import {
  getNextQuestionPoints,
  isPersistableTeamName,
  isQuestionPointsAvailable,
  isTeamColorAvailable,
  isTeamNameAvailable,
  isValidContinueLyricsCutAtMs,
  isValidContinueLyricsRequiredWordsCount,
  isValidQuestionPoints,
  isValidTeamColor,
} from './rules';

describe('game editing rules', () => {
  it('validates question point boundaries and uniqueness', () => {
    expect(isValidQuestionPoints(1)).toBe(true);
    expect(isValidQuestionPoints(DATA_LIMITS.maxQuestionPoints)).toBe(true);
    expect(isValidQuestionPoints(0)).toBe(false);
    expect(isValidQuestionPoints(DATA_LIMITS.maxQuestionPoints + 1)).toBe(false);
    expect(isValidQuestionPoints(100.5)).toBe(false);

    const questions = [
      { id: 'q1', points: 100 },
      { id: 'q2', points: 200 },
    ];
    expect(isQuestionPointsAvailable(questions, 'q2', 300)).toBe(true);
    expect(isQuestionPointsAvailable(questions, 'q2', 100)).toBe(false);
    expect(isQuestionPointsAvailable(questions, 'q2', 200)).toBe(true);
  });

  it('uses the same normalized uniqueness rules for team names and colors', () => {
    const teams = [
      { id: 'team-1', name: 'Команда Альфа', color: '#Aa00Ff' },
      { id: 'team-2', name: 'Команда Бета', color: '#00ff00' },
    ];

    expect(isPersistableTeamName('')).toBe(true);
    expect(isPersistableTeamName('x'.repeat(DATA_LIMITS.text.teamName + 1))).toBe(false);
    expect(isTeamNameAvailable(teams, 'team-2', '  команда   альфа ')).toBe(false);
    expect(isTeamNameAvailable(teams, 'team-2', 'Команда Гамма')).toBe(true);
    expect(isTeamNameAvailable(teams, 'team-2', '   ')).toBe(true);

    expect(isValidTeamColor('#abcdef')).toBe(true);
    expect(isValidTeamColor('#ABCDEF')).toBe(true);
    expect(isValidTeamColor('abcdef')).toBe(false);
    expect(isTeamColorAvailable(teams, 'team-2', '#aa00ff')).toBe(false);
    expect(isTeamColorAvailable(teams, 'team-2', '#112233')).toBe(true);
  });

  it('validates continue-lyrics numeric limits from the shared constants', () => {
    const words = INTER_ROUND_LIMITS.continueLyrics.requiredWordsCount;
    expect(isValidContinueLyricsRequiredWordsCount(words.min)).toBe(true);
    expect(isValidContinueLyricsRequiredWordsCount(words.max)).toBe(true);
    expect(isValidContinueLyricsRequiredWordsCount(words.min - 1)).toBe(false);
    expect(isValidContinueLyricsRequiredWordsCount(words.max + 1)).toBe(false);
    expect(isValidContinueLyricsRequiredWordsCount(1.5)).toBe(false);

    const cutAt = INTER_ROUND_LIMITS.continueLyrics.cutAtMs;
    expect(isValidContinueLyricsCutAtMs(cutAt.min)).toBe(true);
    expect(isValidContinueLyricsCutAtMs(cutAt.max)).toBe(true);
    expect(isValidContinueLyricsCutAtMs(cutAt.min - 1)).toBe(false);
    expect(isValidContinueLyricsCutAtMs(cutAt.max + 1)).toBe(false);
    expect(isValidContinueLyricsCutAtMs(500.5)).toBe(false);
  });

  it('chooses a free persistable value for a newly added question', () => {
    expect(getNextQuestionPoints([{ points: 100 }, { points: 300 }, { points: 200 }])).toBe(400);
    expect(getNextQuestionPoints([{ points: 1_000_000_000 }, { points: 100 }])).toBe(200);
  });

});
