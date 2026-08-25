import { describe, expect, it } from 'vitest';
import { canonicalAudioMimeType, inferAudioFormat, inspectAudioHeader, isVerifiedAudioAsset } from './audioAsset';

describe('audio asset domain', () => {
  it('detects supported containers from bytes instead of trusting extension or MIME', () => {
    expect(inspectAudioHeader(new Uint8Array([0x49, 0x44, 0x33, 0, 0]))?.format).toBe('mp3');
    expect(inspectAudioHeader(new TextEncoder().encode('RIFF....WAVE'))?.format).toBe('wav');
    expect(inspectAudioHeader(new TextEncoder().encode('OggS....'))?.format).toBe('ogg');
    expect(inspectAudioHeader(new TextEncoder().encode('fLaC....'))?.format).toBe('flac');
  });

  it('normalizes known MIME aliases', () => {
    expect(inferAudioFormat('track.bin', 'audio/x-wav')).toBe('wav');
    expect(inferAudioFormat('track.m4a', '')).toBe('mp4');
    expect(canonicalAudioMimeType('mp4')).toBe('audio/mp4');
  });

  it('keeps integrity separate from browser playability', () => {
    const id = 'a'.repeat(64);
    expect(isVerifiedAudioAsset({ id, name: 'track.mp3', type: 'audio/mpeg', sha256: id, verified: true, blob: new Blob(['x']) })).toBe(true);
    expect(isVerifiedAudioAsset({ id, name: 'track.mp3', type: 'audio/mpeg', sha256: id, verified: false, blob: new Blob(['x']) })).toBe(false);
  });
});
