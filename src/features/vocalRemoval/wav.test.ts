import { describe, expect, it } from 'vitest';
import { encodeStereoWav } from './wav';

describe('encodeStereoWav', () => {
  it('creates a stereo PCM16 WAV with the expected header', async () => {
    const blob = encodeStereoWav(
      new Float32Array([0, 0.5, -0.5]),
      new Float32Array([0.25, -0.25, 1]),
      44_100,
    );
    const view = new DataView(await blob.arrayBuffer());

    expect(blob.type).toBe('audio/wav');
    expect(readAscii(view, 0, 4)).toBe('RIFF');
    expect(readAscii(view, 8, 4)).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44_100);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(12);
  });

  it('clamps samples before writing PCM16 values', async () => {
    const blob = encodeStereoWav(
      new Float32Array([2, -2]),
      new Float32Array([1, -1]),
      44_100,
    );
    const view = new DataView(await blob.arrayBuffer());

    expect(view.getInt16(44, true)).toBe(32_767);
    expect(view.getInt16(46, true)).toBe(32_767);
    expect(view.getInt16(48, true)).toBe(-32_768);
    expect(view.getInt16(50, true)).toBe(-32_768);
  });
});

function readAscii(view: DataView, offset: number, length: number) {
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }
  return value;
}
