import { describe, expect, it } from 'vitest';
import { createInitialState } from '../model/defaults';
import type { AudioAsset, MediaTrack, PersistedState } from '../model/types';
import { sha256Blob } from './contentHash';
import { createStoredZip, readStoredZip } from './zipStore';
import { exportAppBackup, parseAppBackup } from './appBackup';

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
  return {
    ...base,
    mediaTracks: [track],
    audioAssets: [audio],
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
    expect(parsed.state.activeGameId).toBe(state.activeGameId);
    expect(parsed.state.audioAssets).toHaveLength(1);
    expect(parsed.state.audioAssets[0].sha256).toBe(state.audioAssets[0].sha256);
    expect(await parsed.state.audioAssets[0].blob.arrayBuffer()).toEqual(await state.audioAssets[0].blob.arrayBuffer());
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
