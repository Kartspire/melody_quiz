import { validateAudioBlob } from './audio';
import { DATA_LIMITS } from '../model/limits';
import { isBoundedText, isSha256, isValidTimestamp } from '../model/validation';
import type { Song } from '../model/types';

export const MELODY_PACKAGE_FORMAT_VERSION = 1;

export type MelodyPackageKind = 'melody-game' | 'melody-library';

export type PackageAudioRef = {
  path: string;
  name: string;
  type: string;
  size: number;
  sha256: string;
};

export type PackageSong = Omit<Song, 'minusAudioId' | 'plusAudioId'> & {
  minus?: PackageAudioRef;
  plus?: PackageAudioRef;
};

export type PackageManifestFile = {
  path: string;
  size: number;
  sha256: string;
  mediaType: string;
};

export type MelodyPackageManifest = {
  type: MelodyPackageKind;
  formatVersion: number;
  appVersion: string;
  exportedAt: string;
  gameId?: string;
  gameName?: string;
  files: PackageManifestFile[];
};

export function migrateManifest(value: MelodyPackageManifest): MelodyPackageManifest {
  switch (value?.formatVersion) {
    case 1:
      return value;
    default:
      throw new Error(`Версия формата ${String(value?.formatVersion)} не поддерживается этой версией приложения.`);
  }
}

export function validateManifest(value: MelodyPackageManifest) {
  if (!value || (value.type !== 'melody-game' && value.type !== 'melody-library')) throw new Error('Неизвестный тип Melody-архива.');
  if (value.formatVersion !== MELODY_PACKAGE_FORMAT_VERSION) throw new Error(`Версия формата ${value.formatVersion} не поддерживается этой версией приложения.`);
  if (!isBoundedText(value.appVersion, 50) || !isBoundedText(value.exportedAt, 100) || !Number.isFinite(Date.parse(value.exportedAt))) throw new Error('Некорректные метаданные manifest.');
  if (!Array.isArray(value.files) || value.files.length > DATA_LIMITS.packageFiles) throw new Error('Некорректный список файлов в manifest.');
  const paths = new Set<string>();
  let totalSize = 0;
  for (const file of value.files) {
    if (!file || !isBoundedText(file.path, 500) || !file.path || !Number.isSafeInteger(file.size) || file.size < 0 || !isSha256(file.sha256) || !isBoundedText(file.mediaType, DATA_LIMITS.text.mimeType)) {
      throw new Error('Некорректная запись файла в manifest.');
    }
    if (file.path === 'manifest.json' || file.path.startsWith('/') || file.path.includes('..') || file.path.includes('\\')) throw new Error(`Недопустимый путь «${file.path}» в manifest.`);
    if (paths.has(file.path)) throw new Error(`Файл «${file.path}» повторяется в manifest.`);
    paths.add(file.path);
    totalSize += file.size;
    if (!Number.isSafeInteger(totalSize) || totalSize > DATA_LIMITS.packageBytes) throw new Error('Суммарный размер файлов в manifest превышает допустимый лимит.');
  }
  if (!paths.has('songs.json')) throw new Error('manifest не содержит обязательный songs.json.');
  if (value.type === 'melody-game' && !paths.has('game.json')) throw new Error('manifest игры не содержит обязательный game.json.');
}

export async function validatePackageSongs(songs: PackageSong[], entries: Map<string, Blob>, manifestFiles: PackageManifestFile[]) {
  const manifestByPath = new Map(manifestFiles.map((file) => [file.path, file]));
  if (!Array.isArray(songs) || songs.length > DATA_LIMITS.packageSongs) throw new Error('Некорректный список песен.');
  const songIds = new Set<string>();
  const validatedAudioPaths = new Set<string>();
  for (const song of songs) {
    validatePackageSongMetadata(song);
    if (songIds.has(song.id)) throw new Error(`Песня с id «${song.id}» повторяется в архиве.`);
    songIds.add(song.id);
    for (const ref of [song.minus, song.plus]) {
      if (!ref) continue;
      if (!isBoundedText(ref.path, 500) || !isBoundedText(ref.name, DATA_LIMITS.text.audioName) || !isBoundedText(ref.type, DATA_LIMITS.text.mimeType) || !Number.isSafeInteger(ref.size) || ref.size <= 0 || ref.size > DATA_LIMITS.audioFileBytes || !ref.path.startsWith('audio/') || !entries.has(ref.path) || !isSha256(ref.sha256)) {
        throw new Error(`Некорректная ссылка на аудио в песне «${song.artist} — ${song.title}».`);
      }
      const manifestFile = manifestByPath.get(ref.path);
      if (!manifestFile || manifestFile.sha256.toLowerCase() !== ref.sha256.toLowerCase()) throw new Error(`SHA-256 аудио «${ref.name}» не совпадает с manifest.`);
      if (entries.get(ref.path)!.size !== ref.size || manifestFile.size !== ref.size) throw new Error(`Некорректный размер аудио «${ref.name}».`);
      if (!validatedAudioPaths.has(ref.path)) {
        await validateAudioBlob(entries.get(ref.path)!, ref.name, ref.type, true);
        validatedAudioPaths.add(ref.path);
      }
    }
  }
}

export function validatePackageSongMetadata(song: Pick<PackageSong, 'id' | 'artist' | 'title' | 'createdAt' | 'updatedAt'>) {
  if (!song || !isBoundedText(song.id, DATA_LIMITS.text.id) || !song.id || !isBoundedText(song.artist, DATA_LIMITS.text.artist) || !isBoundedText(song.title, DATA_LIMITS.text.songTitle) || (!song.artist.trim() && !song.title.trim()) || !isValidTimestamp(song.createdAt) || !isValidTimestamp(song.updatedAt)) {
    throw new Error('Некорректная запись песни.');
  }
}
