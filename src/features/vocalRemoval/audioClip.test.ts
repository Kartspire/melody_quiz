import { describe, expect, it } from 'vitest';
import { resolveTrimSampleRange } from './audioClip';

describe('resolveTrimSampleRange', () => {
  it('converts seconds into a bounded sample range', () => {
    expect(resolveTrimSampleRange(10, 1_000, 2.25, 7.5)).toEqual({
      start: 2.25,
      end: 7.5,
      startSample: 2_250,
      endSample: 7_500,
    });
  });

  it('clamps a selection to the source duration', () => {
    expect(resolveTrimSampleRange(5, 100, -2, 10)).toEqual({
      start: 0,
      end: 5,
      startSample: 0,
      endSample: 500,
    });
  });

  it('rejects an empty or nearly empty selection', () => {
    expect(() => resolveTrimSampleRange(5, 100, 2, 2.05)).toThrow(/слишком короткий/i);
  });
});
