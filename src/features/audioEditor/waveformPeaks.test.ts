import { describe, expect, it } from 'vitest';
import { calculateWaveformPeaks } from './waveformPeaks';

describe('calculateWaveformPeaks', () => {
  it('reduces the source once into reusable peak buckets', () => {
    const left = new Float32Array([0, 0.25, -0.5, 1, 0.1, -0.2, 0.3, -0.4]);
    const buffer = {
      length: left.length,
      numberOfChannels: 1,
      getChannelData: () => left,
    } as Pick<AudioBuffer, 'getChannelData' | 'numberOfChannels' | 'length'>;

    const peaks = calculateWaveformPeaks(buffer, 4);
    expect(peaks[0]).toBeCloseTo(0.25);
    expect(peaks[1]).toBeCloseTo(1);
    expect(peaks[2]).toBeCloseTo(0.2);
    expect(peaks[3]).toBeCloseTo(0.4);
  });

  it('uses the loudest channel for each bucket', () => {
    const channels = [new Float32Array([0.1, 0.2]), new Float32Array([0.8, 0.1])];
    const buffer = {
      length: 2,
      numberOfChannels: 2,
      getChannelData: (channel: number) => channels[channel]!,
    } as Pick<AudioBuffer, 'getChannelData' | 'numberOfChannels' | 'length'>;

    const peaks = calculateWaveformPeaks(buffer, 2);
    expect(peaks[0]).toBeCloseTo(0.8);
    expect(peaks[1]).toBeCloseTo(0.2);
  });
});
