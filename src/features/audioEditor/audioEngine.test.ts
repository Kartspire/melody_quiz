import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioAsset, AudioClip } from '../../model/types';
import { getClipPlaybackWindow, playAudioProject, renderAudioProjectToWav } from './audioEngine';
import { decodeAudioAsset } from './audioBuffers';
import { createAudioClip, createAudioProject } from './audioProject';

vi.mock('./audioBuffers', () => ({ decodeAudioAsset: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

const source: AudioClip = {
  id: 'clip-1',
  sourceTrackId: 'track-1',
  timelineStartMs: 2_000,
  sourceStartMs: 10_000,
  sourceEndMs: 20_000,
  gainDb: 0,
  fadeInMs: 0,
  fadeOutMs: 0,
  playbackRate: 2,
};

describe('getClipPlaybackWindow', () => {
  it('keeps source offset and timeline duration in sync with playbackRate', () => {
    const window = getClipPlaybackWindow(source, 3_000, 60_000);
    expect(window).toEqual({ playFromMs: 3_000, sourceOffsetMs: 12_000, sourceDurationMs: 8_000, timelineDurationMs: 4_000 });
  });

  it('clips scheduling to the actual decoded buffer duration', () => {
    const window = getClipPlaybackWindow(source, 2_000, 15_000);
    expect(window?.sourceDurationMs).toBe(5_000);
    expect(window?.timelineDurationMs).toBe(2_500);
  });

  it('does not schedule a clip after its timeline end', () => {
    expect(getClipPlaybackWindow(source, 7_000, 60_000)).toBeNull();
  });
});

describe('fade scheduling', () => {
  type GainEvent = { kind: 'set' | 'ramp'; value: number; time: number };
  let events: GainEvent[];
  class TestAudioContext {
    currentTime = 0;
    sampleRate = 44_100;
    destination = {};
    resume = async () => undefined;
    close = async () => undefined;
    createBufferSource() { return { playbackRate: { value: 1 }, connect: (gain: unknown) => gain, start() {}, stop() {}, disconnect() {} }; }
    createChannelSplitter() { return { connect() {} }; }
    createAnalyser() { return { getFloatTimeDomainData() {} }; }
    createGain() {
      return {
        connect: () => this.destination,
        disconnect() {},
        gain: {
          setValueAtTime: (value: number, time: number) => events.push({ kind: 'set', value, time }),
          linearRampToValueAtTime: (value: number, time: number) => events.push({ kind: 'ramp', value, time }),
        },
      };
    }
    async startRendering() { return { numberOfChannels: 2, sampleRate: this.sampleRate, getChannelData: () => new Float32Array(1) }; }
  }

  async function schedule(fadeInMs: number, fadeOutMs: number, fromMs = 0, offline = true, bufferSeconds = 10) {
    events = [];
    vi.stubGlobal('AudioContext', TestAudioContext);
    vi.stubGlobal('OfflineAudioContext', TestAudioContext);
    vi.mocked(decodeAudioAsset).mockResolvedValue({ duration: bufferSeconds } as AudioBuffer);
    const project = createAudioProject();
    project.lanes[0].clips = [{ ...createAudioClip('t', 10_000), fadeInMs, fadeOutMs }];
    const tracks = [{ id: 't', audioId: 'a', name: 'Tone', createdAt: 1, updatedAt: 1 }];
    const assets: AudioAsset[] = [{ id: 'a', blob: new Blob(), name: 'Tone', type: 'audio/wav', sha256: 'test', verified: true }];
    if (offline) await renderAudioProjectToWav(project, tracks, assets);
    else (await playAudioProject(project, tracks, assets, fromMs)).stop();
    // Report automation times in project seconds, removing the realtime start delay.
    return events.map(event => ({ ...event, time: event.time + (offline ? 0 : fromMs / 1000 - 0.03) }));
  }

  it.each([true, false])('uses a continuous triangle for overlapping fades (offline=%s)', async (offline) => {
    const actual = await schedule(8000, 8000, 0, offline);
    expect(actual).toEqual([
      { kind: 'set', value: 0, time: 0 },
      { kind: 'ramp', value: 0.625, time: 5 },
      { kind: 'ramp', value: 0, time: 10 },
    ]);
  });

  it('uses the intersection of unequal fade slopes', async () => {
    expect(await schedule(9000, 3000)).toEqual([
      { kind: 'set', value: 0, time: 0 },
      { kind: 'ramp', value: 7.5 / 9, time: 7.5 },
      { kind: 'ramp', value: 0, time: 10 },
    ]);
  });

  it.each([3000, 6000])('resumes the same envelope from %s ms', async (fromMs) => {
    const actual = await schedule(8000, 8000, fromMs, false);
    expect(actual[0].value).toBe(fromMs === 3000 ? 0.375 : 0.5);
    expect(actual[0].time).toBeCloseTo(fromMs / 1000);
    expect(actual.slice(1)).toEqual(fromMs === 3000 ? [
      { kind: 'ramp', value: 0.625, time: 5 },
      { kind: 'ramp', value: 0, time: 10 },
    ] : [{ kind: 'ramp', value: 0, time: 10 }]);
  });

  it('retains the plateau between disjoint fades', async () => {
    expect(await schedule(2000, 3000)).toEqual([
      { kind: 'set', value: 0, time: 0 },
      { kind: 'ramp', value: 1, time: 2 },
      { kind: 'ramp', value: 1, time: 7 },
      { kind: 'ramp', value: 0, time: 10 },
    ]);
  });

  it('ends a shortened buffer at the envelope value of its actual end', async () => {
    expect(await schedule(8000, 8000, 0, true, 4)).toEqual([
      { kind: 'set', value: 0, time: 0 },
      { kind: 'ramp', value: 0.5, time: 4 },
    ]);
  });
});
