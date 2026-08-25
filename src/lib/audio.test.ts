import { describe, expect, it } from 'vitest';
import { validateAudioBlob } from './audio';

const validMp3 = () => new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4])], { type: 'audio/mpeg' });

describe('audio validation', () => {
  it('rejects empty and obviously invalid known audio formats', async () => {
    await expect(validateAudioBlob(new Blob([], { type: 'audio/mpeg' }), 'empty.mp3', 'audio/mpeg', false)).rejects.toThrow(/пустой/i);
    await expect(validateAudioBlob(new Blob(['not mp3'], { type: 'audio/mpeg' }), 'broken.mp3', 'audio/mpeg', false)).rejects.toThrow(/не похож/i);
  });

  it('accepts a known MP3 signature before browser metadata validation', async () => {
    await expect(validateAudioBlob(validMp3(), 'track.mp3', 'audio/mpeg', false)).resolves.toMatchObject({
      format: 'mp3',
      mimeType: 'audio/mpeg',
    });
  });

  it('rejects a misleading extension or MIME that conflicts with the physical container', async () => {
    await expect(validateAudioBlob(validMp3(), 'track.wav', 'audio/wav', true)).rejects.toThrow(/не соответствует/i);
  });

  it('can normalize stale stored metadata from the physical container', async () => {
    await expect(validateAudioBlob(validMp3(), 'old-track.wav', 'audio/wav', false)).resolves.toMatchObject({
      format: 'mp3',
      mimeType: 'audio/mpeg',
    });
  });

  it('accepts a known container even when the original metadata is missing', async () => {
    await expect(validateAudioBlob(validMp3(), 'track', '', false)).resolves.toMatchObject({
      format: 'mp3',
      mimeType: 'audio/mpeg',
    });
  });
});
