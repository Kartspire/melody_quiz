import { describe, expect, it } from 'vitest';
import { formatAudioTime, parseAudioTime } from './audioTime';

describe('audio time helpers', () => {
  it('formats whole and fractional seconds without producing 0:60', () => {
    expect(formatAudioTime(65)).toBe('1:05');
    expect(formatAudioTime(59.96)).toBe('1:00');
    expect(formatAudioTime(65.4)).toBe('1:05.4');
  });

  it('parses mm:ss and plain seconds', () => {
    expect(parseAudioTime('1:05.5')).toBe(65.5);
    expect(parseAudioTime('12,5')).toBe(12.5);
  });

  it('rejects invalid time values', () => {
    expect(parseAudioTime('1:75')).toBeNull();
    expect(parseAudioTime('-2')).toBeNull();
    expect(parseAudioTime('abc')).toBeNull();
  });
});
