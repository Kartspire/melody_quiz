import { canonicalizeAudioAsset } from './audio';
import { digestBlobWithCrc } from './contentHash';
import { createStoredZip, readStoredZip, type ZipInput } from './zipStore';
import { DATA_LIMITS } from '../model/limits';
import { assertValidPersistedState, isSha256 } from '../model/validation';
import type { AudioAsset, PersistedState } from '../model/types';

const BACKUP_TYPE = 'melody-app-backup';
const BACKUP_FORMAT_VERSION = 1;
const STATE_PATH = 'state.json';
const MANIFEST_PATH = 'manifest.json';

export type AppBackupManifest = {
  type: typeof BACKUP_TYPE;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  stateVersion: 4 | PersistedState['version'];
  createdAt: number;
  files: AppBackupFileDescriptor[];
};

type AppBackupFileDescriptor = {
  path: string;
  size: number;
  sha256: string;
  crc32: number;
};

type BackupAudioAsset = Omit<AudioAsset, 'blob'> & {
  path: string;
  size: number;
};

type BackupStatePayload = Omit<PersistedState, 'version' | 'audioAssets' | 'audioProjects'> & {
  version: 4 | PersistedState['version'];
  audioAssets: BackupAudioAsset[];
  audioProjects?: PersistedState['audioProjects'];
};

export type ParsedAppBackup = {
  manifest: AppBackupManifest;
  state: PersistedState;
};

export async function exportAppBackup(state: PersistedState) {
  assertValidPersistedState(state);

  const files: AppBackupFileDescriptor[] = [];
  const zipInputs: ZipInput[] = [];
  const audioAssets: BackupAudioAsset[] = [];

  // Verify every audio blob while creating the backup. This prevents a corrupted
  // IndexedDB entry from being silently copied into the user's emergency backup.
  for (const asset of state.audioAssets) {
    const path = audioPath(asset.id);
    const backupAsset: BackupAudioAsset = {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      sha256: asset.sha256,
      verified: true,
      path,
      size: asset.blob.size,
    };
    validateBackupAudioAsset(backupAsset);
    const digest = await digestBlobWithCrc(asset.blob);
    if (digest.sha256 !== asset.sha256 || asset.id !== asset.sha256) {
      throw new Error(`Аудиофайл «${asset.name}» повреждён: контрольная сумма не совпадает.`);
    }
    const descriptor = descriptorFor(path, asset.blob.size, digest.sha256, digest.crc32);
    files.push(descriptor);
    zipInputs.push({ name: path, data: asset.blob, crc32: digest.crc32 });
    audioAssets.push(backupAsset);
  }

  const statePayload: BackupStatePayload = {
    version: state.version,
    games: state.games,
    songs: state.songs,
    mediaTracks: state.mediaTracks,
    audioAssets,
    audioProjects: state.audioProjects,
    sessions: state.sessions,
    activeGameId: state.activeGameId,
  };
  const stateBlob = jsonBlob(statePayload);
  if (stateBlob.size > DATA_LIMITS.backupStateJsonBytes) {
    throw new Error('Метаданные резервной копии слишком велики.');
  }
  const stateDigest = await digestBlobWithCrc(stateBlob);
  files.unshift(descriptorFor(STATE_PATH, stateBlob.size, stateDigest.sha256, stateDigest.crc32));
  zipInputs.unshift({ name: STATE_PATH, data: stateBlob, crc32: stateDigest.crc32 });

  const manifest: AppBackupManifest = {
    type: BACKUP_TYPE,
    formatVersion: BACKUP_FORMAT_VERSION,
    stateVersion: state.version,
    createdAt: Date.now(),
    files,
  };
  const manifestBlob = jsonBlob(manifest);
  if (manifestBlob.size > DATA_LIMITS.manifestBytes) throw new Error('Manifest резервной копии слишком велик.');
  const manifestDigest = await digestBlobWithCrc(manifestBlob);

  const rawSize = manifestBlob.size + zipInputs.reduce((sum, input) => sum + input.data.size, 0);
  if (rawSize > DATA_LIMITS.packageBytes) throw new Error('Резервная копия превышает максимальный поддерживаемый размер 2 ГБ.');

  const blob = await createStoredZip([
    { name: MANIFEST_PATH, data: manifestBlob, crc32: manifestDigest.crc32 },
    ...zipInputs,
  ]);
  if (blob.size > DATA_LIMITS.packageBytes) throw new Error('Резервная копия превышает максимальный поддерживаемый размер 2 ГБ.');

  return {
    blob,
    filename: `melody-full-backup-${new Date(manifest.createdAt).toISOString().slice(0, 10)}.melody-backup`,
    manifest,
  };
}

export async function parseAppBackup(file: Blob): Promise<ParsedAppBackup> {
  if (!(file instanceof Blob) || file.size <= 0) throw new Error('Выбран пустой файл резервной копии.');
  if (file.size > DATA_LIMITS.packageBytes) throw new Error('Резервная копия превышает максимальный поддерживаемый размер 2 ГБ.');

  const entries = await readStoredZip(file);
  if (entries.size > DATA_LIMITS.packageFiles + 2) throw new Error('В резервной копии слишком много файлов.');

  const manifestEntry = entries.get(MANIFEST_PATH);
  if (!manifestEntry) throw new Error('В резервной копии отсутствует manifest.json.');
  if (manifestEntry.size > DATA_LIMITS.manifestBytes) throw new Error('manifest.json имеет недопустимый размер.');
  const manifestDigest = await digestBlobWithCrc(manifestEntry.blob);
  if (manifestDigest.crc32 !== manifestEntry.crc32) throw new Error('CRC manifest.json не совпадает. Резервная копия повреждена.');

  const manifest = parseJson<AppBackupManifest>(await manifestEntry.blob.text(), 'manifest.json');
  validateManifest(manifest);

  const allowedPaths = new Set([MANIFEST_PATH, ...manifest.files.map((descriptor) => descriptor.path)]);
  if (allowedPaths.size !== manifest.files.length + 1) throw new Error('Manifest содержит повторяющиеся пути файлов.');
  for (const path of entries.keys()) {
    if (!allowedPaths.has(path)) throw new Error(`Резервная копия содержит незаявленный файл «${path}».`);
  }

  const verifiedEntries = new Map<string, Blob>();
  for (const descriptor of manifest.files) {
    const entry = entries.get(descriptor.path);
    if (!entry) throw new Error(`В резервной копии отсутствует файл «${descriptor.path}».`);
    if (entry.size !== descriptor.size) throw new Error(`Размер файла «${descriptor.path}» не совпадает с manifest.`);
    const digest = await digestBlobWithCrc(entry.blob);
    if (digest.sha256 !== descriptor.sha256) throw new Error(`Контрольная сумма «${descriptor.path}» не совпадает. Резервная копия повреждена.`);
    if (digest.crc32 !== descriptor.crc32 || digest.crc32 !== entry.crc32) throw new Error(`CRC файла «${descriptor.path}» не совпадает. Резервная копия повреждена.`);
    verifiedEntries.set(descriptor.path, entry.blob);
  }

  const stateBlob = verifiedEntries.get(STATE_PATH);
  if (!stateBlob) throw new Error('В резервной копии отсутствует state.json.');
  if (stateBlob.size > DATA_LIMITS.backupStateJsonBytes) throw new Error('state.json имеет недопустимый размер.');
  const payload = parseJson<BackupStatePayload>(await stateBlob.text(), 'state.json');
  validateStatePayload(payload, manifest);

  const audioAssets: AudioAsset[] = [];
  const audioPaths = new Set<string>();
  for (const asset of payload.audioAssets) {
    validateBackupAudioAsset(asset);
    if (audioPaths.has(asset.path)) throw new Error(`Аудиофайл «${asset.path}» повторяется в state.json.`);
    audioPaths.add(asset.path);
    const blob = verifiedEntries.get(asset.path);
    if (!blob) throw new Error(`В резервной копии отсутствует аудиофайл «${asset.path}».`);
    if (blob.size !== asset.size) throw new Error(`Размер аудиофайла «${asset.name}» не совпадает с state.json.`);
    audioAssets.push(await canonicalizeAudioAsset({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      blob,
      sha256: asset.sha256,
      verified: true,
    }, { verifyBrowserPlayback: true, verifyMetadata: false }));
  }

  const expectedAudioPaths = new Set(manifest.files.filter((item) => item.path !== STATE_PATH).map((item) => item.path));
  if (expectedAudioPaths.size !== audioPaths.size || [...expectedAudioPaths].some((path) => !audioPaths.has(path))) {
    throw new Error('Список аудиофайлов в state.json не совпадает с manifest.');
  }

  const state: PersistedState = {
    version: 5,
    games: payload.games,
    songs: payload.songs,
    mediaTracks: payload.mediaTracks,
    audioAssets,
    audioProjects: payload.audioProjects ?? [],
    sessions: payload.sessions,
    activeGameId: payload.activeGameId,
  };
  assertValidPersistedState(state);
  return { manifest, state };
}

function validateManifest(value: AppBackupManifest) {
  if (!value || typeof value !== 'object') throw new Error('manifest.json имеет неподдерживаемую структуру.');
  if (value.type !== BACKUP_TYPE || value.formatVersion !== BACKUP_FORMAT_VERSION) throw new Error('Неподдерживаемый формат резервной копии.');
  if (value.stateVersion !== 4 && value.stateVersion !== 5) throw new Error('Резервная копия создана несовместимой версией приложения.');
  if (!Number.isSafeInteger(value.createdAt) || value.createdAt <= 0) throw new Error('В manifest указана некорректная дата создания.');
  if (!Array.isArray(value.files) || value.files.length < 1 || value.files.length > DATA_LIMITS.packageFiles + 1) throw new Error('Некорректный список файлов резервной копии.');
  let stateFiles = 0;
  for (const descriptor of value.files) {
    if (!descriptor || typeof descriptor !== 'object') throw new Error('Manifest содержит некорректное описание файла.');
    if (!isSafeBackupPath(descriptor.path)) throw new Error(`Некорректный путь файла «${String(descriptor.path)}».`);
    if (!Number.isSafeInteger(descriptor.size) || descriptor.size < 0 || descriptor.size > DATA_LIMITS.audioFileBytes) throw new Error(`Некорректный размер файла «${descriptor.path}».`);
    if (!isSha256(descriptor.sha256)) throw new Error(`Некорректная контрольная сумма файла «${descriptor.path}».`);
    if (!Number.isSafeInteger(descriptor.crc32) || descriptor.crc32 < 0 || descriptor.crc32 > 0xffffffff) throw new Error(`Некорректный CRC файла «${descriptor.path}».`);
    if (descriptor.path === STATE_PATH) stateFiles += 1;
  }
  if (stateFiles !== 1) throw new Error('Manifest должен содержать ровно один state.json.');
}

function validateStatePayload(value: BackupStatePayload, manifest: AppBackupManifest) {
  if (!value || typeof value !== 'object' || (value.version !== 4 && value.version !== 5)) throw new Error('state.json имеет неподдерживаемую структуру.');
  if (manifest.stateVersion !== value.version) throw new Error('Версия state.json не совпадает с manifest.');
  if (!Array.isArray(value.games) || !Array.isArray(value.songs) || !Array.isArray(value.mediaTracks) || !Array.isArray(value.audioAssets) || !Array.isArray(value.sessions) || (value.version === 5 && !Array.isArray(value.audioProjects))) {
    throw new Error('state.json не содержит обязательные разделы приложения.');
  }
  if (value.audioAssets.length > DATA_LIMITS.packageFiles) throw new Error('В резервной копии слишком много аудиофайлов.');
}

function validateBackupAudioAsset(asset: BackupAudioAsset) {
  if (!asset || typeof asset !== 'object' || !isSha256(asset.id) || asset.sha256 !== asset.id || asset.verified !== true) {
    throw new Error('state.json содержит повреждённое описание аудиофайла.');
  }
  if (typeof asset.name !== 'string' || !asset.name.trim() || asset.name.length > DATA_LIMITS.text.audioName) throw new Error('state.json содержит некорректное имя аудиофайла.');
  if (typeof asset.type !== 'string' || asset.type.length > DATA_LIMITS.text.mimeType) throw new Error(`Аудиофайл «${asset.name}» содержит некорректный MIME-тип.`);
  if (asset.path !== audioPath(asset.id)) throw new Error(`Некорректный путь аудиофайла «${asset.name}».`);
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > DATA_LIMITS.audioFileBytes) throw new Error(`Некорректный размер аудиофайла «${asset.name}».`);
}

function descriptorFor(path: string, size: number, sha256: string, crc32: number): AppBackupFileDescriptor {
  return { path, size, sha256, crc32 };
}

function audioPath(id: string) {
  return `audio/${id}`;
}

function isSafeBackupPath(path: unknown): path is string {
  return typeof path === 'string'
    && path.length > 0
    && path.length <= 300
    && !path.includes('\\')
    && !path.includes('\u0000')
    && !path.startsWith('/')
    && !path.split('/').some((part) => part === '' || part === '.' || part === '..')
    && (path === STATE_PATH || /^audio\/[a-f0-9]{64}$/.test(path));
}

function jsonBlob(value: unknown) {
  return new Blob([JSON.stringify(value)], { type: 'application/json' });
}

function parseJson<T>(value: string, name: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Не удалось прочитать ${name}.`);
  }
}
