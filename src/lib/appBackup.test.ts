import { describe, expect, it } from 'vitest';
import { createInitialState } from '../model/defaults';
import type { AudioAsset, MediaTrack, PersistedState } from '../model/types';
import { digestBlobWithCrc, sha256Blob } from './contentHash';
import { createStoredZip, readStoredZip } from './zipStore';
import { exportAppBackup, parseAppBackup } from './appBackup';
import { createAudioClip, createAudioProject } from '../features/audioEditor/audioProject';

const makeAudio = async (): Promise<AudioAsset> => {
  const blob = new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4])], { type: 'audio/mpeg' });
  const sha256 = await sha256Blob(blob);
  return { id: sha256, name: 'backup.mp3', type: 'audio/mpeg', blob, sha256, verified: true };
};

async function makeState(): Promise<PersistedState> {
  const base = createInitialState();
  const audio = await makeAudio();
  const now = Date.now();
  const track: MediaTrack = {
    id: 'backup-track',
    name: 'Трек для резервной копии',
    audioId: audio.id,
    createdAt: now,
    updatedAt: now,
  };
  const game = base.games[0];
  const teamId = game.teams[0].id;
  const session = {
    ...base.sessions[0],
    started: true,
    scores: { ...base.sessions[0].scores, [teamId]: 700 },
    updatedAt: now,
  };
  const project = createAudioProject('Резервный монтаж');
  project.lanes[0].clips = [createAudioClip(track.id, 5_000)];
  return {
    ...base,
    mediaTracks: [track],
    audioAssets: [audio],
    audioProjects: [project],
    sessions: [session],
  };
}

describe('full application backup', () => {
  it('round-trips games, media, active game and session progress', async () => {
    const state = await makeState();
    const exported = await exportAppBackup(state);
    const parsed = await parseAppBackup(exported.blob);

    expect(exported.filename).toMatch(/\.melody-backup$/);
    expect(parsed.state.games).toEqual(state.games);
    expect(parsed.state.mediaTracks).toEqual(state.mediaTracks);
    expect(parsed.state.sessions).toEqual(state.sessions);
    expect(parsed.state.audioProjects).toEqual(state.audioProjects);
    expect(parsed.state.activeGameId).toBe(state.activeGameId);
    expect(parsed.state.audioAssets).toHaveLength(1);
    expect(parsed.state.audioAssets[0].sha256).toBe(state.audioAssets[0].sha256);
    expect(await parsed.state.audioAssets[0].blob.arrayBuffer()).toEqual(await state.audioAssets[0].blob.arrayBuffer());
  });

  it('restores version 4 backups without audio projects', async () => {
    const exported = await exportAppBackup(await makeState());
    const entries = await readStoredZip(exported.blob);
    const stateEntry = entries.get('state.json');
    const manifestEntry = entries.get('manifest.json');
    expect(stateEntry).toBeDefined();
    expect(manifestEntry).toBeDefined();

    const legacyState = JSON.parse(await stateEntry!.blob.text()) as Record<string, unknown>;
    legacyState.version = 4;
    delete legacyState.audioProjects;
    const legacyStateBlob = new Blob([JSON.stringify(legacyState)], { type: 'application/json' });
    const stateDigest = await digestBlobWithCrc(legacyStateBlob);

    const legacyManifest = JSON.parse(await manifestEntry!.blob.text()) as {
      stateVersion: number;
      files: Array<{ path: string; size: number; sha256: string; crc32: number }>;
    };
    legacyManifest.stateVersion = 4;
    legacyManifest.files = legacyManifest.files.map((file) => file.path === 'state.json' ? {
      ...file,
      size: legacyStateBlob.size,
      sha256: stateDigest.sha256,
      crc32: stateDigest.crc32,
    } : file);
    const legacyManifestBlob = new Blob([JSON.stringify(legacyManifest)], { type: 'application/json' });

    const rebuilt = await createStoredZip([
      { name: 'manifest.json', data: legacyManifestBlob },
      { name: 'state.json', data: legacyStateBlob, crc32: stateDigest.crc32 },
      ...[...entries.values()]
        .filter((entry) => entry.name !== 'manifest.json' && entry.name !== 'state.json')
        .map((entry) => ({ name: entry.name, data: entry.blob, crc32: entry.crc32 })),
    ]);

    const parsed = await parseAppBackup(rebuilt);
    expect(parsed.state.version).toBe(5);
    expect(parsed.state.audioProjects).toEqual([]);
  });

  it('rejects a backup when a declared file was changed after export', async () => {
    const exported = await exportAppBackup(await makeState());
    const entries = await readStoredZip(exported.blob);
    const stateEntry = entries.get('state.json');
    expect(stateEntry).toBeDefined();

    const tampered = new Blob([await stateEntry!.blob.text(), ' '], { type: 'application/json' });
    const rebuilt = await createStoredZip([...entries.values()].map((entry) => ({
      name: entry.name,
      data: entry.name === 'state.json' ? tampered : entry.blob,
    })));

    await expect(parseAppBackup(rebuilt)).rejects.toThrow(/Размер файла|Контрольная сумма|CRC/);
  });

  it('rejects undeclared files in the archive', async () => {
    const exported = await exportAppBackup(await makeState());
    const entries = await readStoredZip(exported.blob);
    const rebuilt = await createStoredZip([
      ...[...entries.values()].map((entry) => ({ name: entry.name, data: entry.blob, crc32: entry.crc32 })),
      { name: 'unexpected.txt', data: new Blob(['unexpected']) },
    ]);

    await expect(parseAppBackup(rebuilt)).rejects.toThrow(/незаявленный файл/);
  });
});
