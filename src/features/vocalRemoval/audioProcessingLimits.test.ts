import { describe, expect, it } from 'vitest';
import {
  AUDIO_PROCESSING_SAMPLE_RATE,
  MAX_AUDIO_DECODE_SECONDS,
  MAX_VOCAL_REMOVAL_SECONDS,
  assertDecodableDuration,
  assertVocalRemovalDuration,
  estimateDecodedStereoBytes,
  formatProcessingLimit,
} from './audioProcessingLimits';

describe('audio processing safety limits', () => {
  it('rejects sources that are too long to decode safely in the browser', () => {
    expect(() => assertDecodableDuration(MAX_AUDIO_DECODE_SECONDS + 0.01)).toThrow(/слишком длинный/i);
  });

  it('rejects vocal removal inputs above the memory-safe duration', () => {
    expect(() => assertVocalRemovalDuration(MAX_VOCAL_REMOVAL_SECONDS + 0.01)).toThrow(/не длиннее/i);
  });

  it('estimates decoded stereo PCM memory without using compressed file size', () => {
    expect(estimateDecodedStereoBytes(60)).toBe(60 * AUDIO_PROCESSING_SAMPLE_RATE * 2 * 4);
  });

  it('formats minute-based limits for the UI', () => {
    expect(formatProcessingLimit(120)).toBe('2 мин');
    expect(formatProcessingLimit(90)).toBe('1:30');
  });
});
