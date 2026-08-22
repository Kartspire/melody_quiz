import { createId } from './ids';
import { crc32Blob, digestBlobWithCrc } from './contentHash';
import { createStoredZip, readStoredZip } from './zipStore';
import { createSession } from '../model/defaults';
import { DATA_LIMITS } from '../model/limits';
import { assertValidGameStructure, getGameStartIssues, isSha256 } from '../model/validation';
import type { AudioAsset, GameConfig, PersistedState, Song } from '../model/types';
import { MELODY_PACKAGE_FORMAT_VERSION, migrateManifest, validateManifest, validatePackageSongMetadata, validatePackageSongs } from './melodyPackageSchema';
import type { MelodyPackageKind, MelodyPackageManifest, PackageAudioRef, PackageSong } from './melodyPackageSchema';

export { MELODY_PACKAGE_FORMAT_VERSION } from './melodyPackageSchema';
export type { MelodyPackageKind, MelodyPackageManifest, PackageAudioRef, PackageSong } from './melodyPackageSchema';

export const MELODY_APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export type ParsedMelodyPackage = {
  manifest: MelodyPackageManifest;
  game?: GameConfig;
  songs: PackageSong[];
  entries: Map<string, Blob>;
};

export type ImportStats = {
  newSongs: number;
  reusedSongs: number;
  deduplicatedSongs: number;
  newAudio: number;
  reusedAudio: number;
  internalAudioReuses: number;
};

export type PreparedMediaMerge = {
  songs: Song[];
  audioAssets: AudioAsset[];
  songIdMap: Map<string, string>;
  stats: ImportStats;
};

export type GameConflictMode = 'replace' | 'copy';

export type PreparedGameImport = {
  package: ParsedMelodyPackage;
  media: PreparedMediaMerge;
  hasGameConflict: boolean;
  playabilityIssues: string[];
};

type ExportEntry = {
  path: string;
  blob: Blob;
  type: string;
  sha256: string;
  crc32: number;
};

export async function exportGamePackage(
  game: GameConfig,
  songs: Song[],
  audioAssets: AudioAsset[],
): Promise<{ blob: Blob; filename: string }> {
  assertValidGameStructure(game);
  const usedSongIds = new Set(
    game.rounds.flatMap((round) =>
      round.categories.flatMap((category) =>
        category.questions.map((question) => question.songId).filter((id): id is string => Boolean(id)),
      ),
    ),
  );
  const packageSongs = songs.filter((song) => usedSongIds.has(song.id));
  const packageSongIds = new Set(packageSongs.map((song) => song.id));
  const missingSongIds = [...usedSongIds].filter((songId) => !packageSongIds.has(songId));
  if (missingSongIds.length > 0) throw new Error('Игра содержит ссылки на отсутствующие песни. Откройте редактор и назначьте песни заново.');

  const { serializedSongs, audioEntries } = await serializeSongs(packageSongs, audioAssets);
  const gameEntry = await jsonEntry('game.json', game);
  const songsEntry = await jsonEntry('songs.json', serializedSongs);
  const contentEntries = [gameEntry, songsEntry, ...audioEntries];
  const manifest = buildManifest('melody-game', contentEntries, game);
  const manifestEntry = await jsonEntry('manifest.json', manifest);
  assertExportBounds([manifestEntry, ...contentEntries]);
  const blob = await createStoredZip(
    [manifestEntry, ...contentEntries].map((entry) => ({ name: entry.path, data: entry.blob, crc32: entry.crc32 })),
  );
  return { blob, filename: `${safeFilename(game.title || 'game')}.melody` };
}

export async function exportLibraryPackage(
  songs: Song[],
  audioAssets: AudioAsset[],
): Promise<{ blob: Blob; filename: string }> {
  const { serializedSongs, audioEntries } = await serializeSongs(songs, audioAssets);
  const songsEntry = await jsonEntry('songs.json', serializedSongs);
  const contentEntries = [songsEntry, ...audioEntries];
  const manifest = buildManifest('melody-library', contentEntries);
  const manifestEntry = await jsonEntry('manifest.json', manifest);
  assertExportBounds([manifestEntry, ...contentEntries]);
  const blob = await createStoredZip(
    [manifestEntry, ...contentEntries].map((entry) => ({ name: entry.path, data: entry.blob, crc32: entry.crc32 })),
  );

  const date = new Date().toISOString().slice(0, 10);
  return { blob, filename: `melody-library-${date}.melody-library` };
}

export async function parseMelodyPackage(file: Blob): Promise<ParsedMelodyPackage> {
  if (!(file instanceof Blob) || file.size <= 0) throw new Error('Выбран пустой файл.');
  if (file.size > DATA_LIMITS.packageBytes) throw new Error('Архив превышает максимальный поддерживаемый размер 4 ГБ.');

  const zipEntries = await readStoredZip(file);
  if (zipEntries.size > DATA_LIMITS.packageFiles + 1) throw new Error('В архиве слишком много файлов.');
  const manifestEntry = zipEntries.get('manifest.json');
  if (!manifestEntry) throw new Error('В архиве отсутствует manifest.json.');
  if (manifestEntry.size > DATA_LIMITS.manifestBytes) throw new Error('manifest.json имеет недопустимый размер.');
  if (await crc32Blob(manifestEntry.blob) !== manifestEntry.crc32) throw new Error('CRC manifest.json не совпадает. Архив повреждён.');

  const rawManifest = parseJson<MelodyPackageManifest>(await manifestEntry.blob.text(), 'manifest.json');
  const manifest = migrateManifest(rawManifest);
  validateManifest(manifest);

  const allowedPaths = new Set(['manifest.json', ...manifest.files.map((descriptor) => descriptor.path)]);
  for (const path of zipEntries.keys()) {
    if (!allowedPaths.has(path)) throw new Error(`Архив содержит незаявленный файл «${path}».`);
  }

  const entries = new Map<string, Blob>();
  for (const descriptor of manifest.files) {
    const entry = zipEntries.get(descriptor.path);
    if (!entry) throw new Error(`В архиве отсутствует файл «${descriptor.path}».`);
    if (entry.size !== descriptor.size) throw new Error(`Размер файла «${descriptor.path}» не совпадает с manifest.`);
    const digests = await digestBlobWithCrc(entry.blob);
    if (digests.sha256 !== descriptor.sha256.toLowerCase()) throw new Error(`Контрольная сумма «${descriptor.path}» не совпадает. Архив повреждён.`);
    if (digests.crc32 !== entry.crc32) throw new Error(`CRC файла «${descriptor.path}» не совпадает. Архив повреждён.`);
    entries.set(descriptor.path, entry.blob);
  }

  const songsBlob = entries.get('songs.json');
  if (!songsBlob) throw new Error('В архиве отсутствует songs.json.');
  if (songsBlob.size > DATA_LIMITS.songsJsonBytes) throw new Error('songs.json имеет недопустимый размер.');
  const songs = parseJson<PackageSong[]>(await songsBlob.text(), 'songs.json');
  await validatePackageSongs(songs, entries, manifest.files);

  let game: GameConfig | undefined;
  if (manifest.type === 'melody-game') {
    const gameBlob = entries.get('game.json');
    if (!gameBlob) throw new Error('В архиве игры отсутствует game.json.');
    if (gameBlob.size > DATA_LIMITS.gameJsonBytes) throw new Error('game.json имеет недопустимый размер.');
    game = parseJson<GameConfig>(await gameBlob.text(), 'game.json');
    assertValidGameStructure(game);
    const packageSongIds = new Set(songs.map((song) => song.id));
    const missingSongReference = game.rounds
      .flatMap((round) => round.categories.flatMap((category) => category.questions))
      .find((question) => question.songId && !packageSongIds.has(question.songId));
    if (missingSongReference?.songId) throw new Error(`В game.json есть ссылка на отсутствующую песню «${missingSongReference.songId}».`);
    if (manifest.gameId && manifest.gameId !== game.id) throw new Error('gameId в manifest не совпадает с game.json.');
  } else if (entries.has('game.json')) {
    throw new Error('Архив медиатеки не должен содержать game.json.');
  }

  return { manifest, game, songs, entries };
}

export async function prepareMediaMerge(
  packageData: ParsedMelodyPackage,
  currentSongs: Song[],
  currentAudioAssets: AudioAsset[],
): Promise<PreparedMediaMerge> {
  const hashToAudioId = new Map<string, string>();
  const audioHashById = new Map<string, string>();
  for (const asset of currentAudioAssets) {
    if (!isSha256(asset.id) || asset.sha256 !== asset.id || asset.verified !== true) {
      throw new Error('Локальная медиатека содержит аудио старого формата. Перезагрузите приложение, чтобы завершить миграцию.');
    }
    hashToAudioId.set(asset.sha256, asset.id);
    audioHashById.set(asset.id, asset.sha256);
  }

  const initialAudioHashes = new Set(hashToAudioId.keys());
  const songByFingerprint = new Map<string, Song>();
  const initialSongFingerprints = new Set<string>();
  for (const song of currentSongs) {
    const fingerprint = songFingerprint(song, audioHashById);
    if (!songByFingerprint.has(fingerprint)) songByFingerprint.set(fingerprint, song);
    initialSongFingerprints.add(fingerprint);
  }

  const mergedSongs = [...currentSongs];
  const mergedAudioAssets = [...currentAudioAssets];
  const songIdMap = new Map<string, string>();
  const usedExistingAudioHashes = new Set<string>();
  const newAudioHashes = new Set<string>();
  let internalAudioReuses = 0;
  let newSongs = 0;
  let reusedSongs = 0;
  let deduplicatedSongs = 0;

  for (const packageSong of packageData.songs) {
    const importedFingerprint = packageSongFingerprint(packageSong);
    const existingSong = songByFingerprint.get(importedFingerprint);
    if (existingSong) {
      songIdMap.set(packageSong.id, existingSong.id);
      if (initialSongFingerprints.has(importedFingerprint)) reusedSongs += 1;
      else deduplicatedSongs += 1;
      for (const audioRef of [packageSong.minus, packageSong.plus]) {
        if (!audioRef) continue;
        if (initialAudioHashes.has(audioRef.sha256)) usedExistingAudioHashes.add(audioRef.sha256);
        else if (newAudioHashes.has(audioRef.sha256)) internalAudioReuses += 1;
      }
      continue;
    }

    const minusAudioId = packageSong.minus
      ? materializeAudioRef(packageSong.minus, packageData.entries, mergedAudioAssets, hashToAudioId, initialAudioHashes, usedExistingAudioHashes, newAudioHashes, () => { internalAudioReuses += 1; })
      : undefined;
    const plusAudioId = packageSong.plus
      ? materializeAudioRef(packageSong.plus, packageData.entries, mergedAudioAssets, hashToAudioId, initialAudioHashes, usedExistingAudioHashes, newAudioHashes, () => { internalAudioReuses += 1; })
      : undefined;

    const song: Song = {
      id: createId('song'),
      artist: packageSong.artist.trim(),
      title: packageSong.title.trim(),
      minusAudioId,
      plusAudioId,
      createdAt: packageSong.createdAt,
      updatedAt: packageSong.updatedAt,
    };
    mergedSongs.push(song);
    songIdMap.set(packageSong.id, song.id);
    newSongs += 1;
    songByFingerprint.set(fingerprintParts(song.artist, song.title, packageSong.minus?.sha256 ?? '', packageSong.plus?.sha256 ?? ''), song);
  }

  return {
    songs: mergedSongs,
    audioAssets: mergedAudioAssets,
    songIdMap,
    stats: {
      newSongs,
      reusedSongs,
      deduplicatedSongs,
      newAudio: newAudioHashes.size,
      reusedAudio: usedExistingAudioHashes.size,
      internalAudioReuses,
    },
  };
}

export async function prepareGameImport(
  packageData: ParsedMelodyPackage,
  state: Pick<PersistedState, 'games' | 'songs' | 'audioAssets'>,
): Promise<PreparedGameImport> {
  if (packageData.manifest.type !== 'melody-game' || !packageData.game) throw new Error('Выбранный архив не является экспортом игры.');
  const media = await prepareMediaMerge(packageData, state.songs, state.audioAssets);
  const remappedGame = remapGameSongs(packageData.game, media.songIdMap, packageData.game.id);
  return {
    package: packageData,
    media,
    hasGameConflict: state.games.some((game) => game.id === packageData.game!.id),
    playabilityIssues: getGameStartIssues(remappedGame, media.songs, media.audioAssets),
  };
}

export function finalizeGameImport(
  prepared: PreparedGameImport,
  state: PersistedState,
  conflictMode: GameConflictMode = 'copy',
): PersistedState {
  const sourceGame = prepared.package.game;
  if (!sourceGame) throw new Error('В импортируемом архиве нет игры.');

  const hasConflict = state.games.some((game) => game.id === sourceGame.id);
  const importedGameId = hasConflict && conflictMode === 'copy' ? createId('game') : sourceGame.id;
  const now = Date.now();
  const importedGame = remapGameSongs(sourceGame, prepared.media.songIdMap, importedGameId);
  importedGame.title = hasConflict && conflictMode === 'copy' ? uniqueCopyTitle(sourceGame.title, state.games) : sourceGame.title;
  importedGame.createdAt = hasConflict && conflictMode === 'copy' ? now : sourceGame.createdAt;
  importedGame.updatedAt = now;

  const games = hasConflict && conflictMode === 'replace'
    ? state.games.map((game) => (game.id === sourceGame.id ? importedGame : game))
    : [...state.games, importedGame];
  const sessions = state.sessions.filter((session) => session.gameId !== importedGame.id);
  sessions.push(createSession(importedGame));

  return {
    version: 2,
    games,
    songs: prepared.media.songs,
    audioAssets: prepared.media.audioAssets,
    sessions,
    activeGameId: importedGame.id,
  };
}

export function finalizeLibraryImport(preparedMedia: PreparedMediaMerge, state: PersistedState): PersistedState {
  return { ...state, songs: preparedMedia.songs, audioAssets: preparedMedia.audioAssets };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function serializeSongs(songs: Song[], audioAssets: AudioAsset[]) {
  if (!Array.isArray(songs) || songs.length > DATA_LIMITS.packageSongs) throw new Error('Слишком много песен для одного архива.');
  const songIds = new Set<string>();
  const assetById = new Map(audioAssets.map((asset) => [asset.id, asset]));
  const audioEntriesByHash = new Map<string, ExportEntry>();
  const serializedSongs: PackageSong[] = [];

  for (const song of songs) {
    validatePackageSongMetadata(song);
    if (songIds.has(song.id)) throw new Error(`Песня с id «${song.id}» повторяется в медиатеке.`);
    songIds.add(song.id);
    if (song.minusAudioId && !assetById.has(song.minusAudioId)) throw new Error(`У песни «${song.artist} — ${song.title}» отсутствует файл минуса.`);
    if (song.plusAudioId && !assetById.has(song.plusAudioId)) throw new Error(`У песни «${song.artist} — ${song.title}» отсутствует файл плюса.`);
    const minus = song.minusAudioId ? await serializeAudio(assetById.get(song.minusAudioId), audioEntriesByHash) : undefined;
    const plus = song.plusAudioId ? await serializeAudio(assetById.get(song.plusAudioId), audioEntriesByHash) : undefined;
    serializedSongs.push({
      id: song.id,
      artist: song.artist,
      title: song.title,
      createdAt: song.createdAt,
      updatedAt: song.updatedAt,
      minus,
      plus,
    });
  }
  return { serializedSongs, audioEntries: [...audioEntriesByHash.values()] };
}

async function serializeAudio(asset: AudioAsset | undefined, entries: Map<string, ExportEntry>): Promise<PackageAudioRef | undefined> {
  if (!asset) return undefined;
  if (!isSha256(asset.id) || asset.sha256 !== asset.id || asset.verified !== true) throw new Error(`Аудиофайл «${asset.name}» имеет некорректный идентификатор.`);
  const existing = entries.get(asset.sha256);
  if (existing) return { path: existing.path, name: asset.name, type: asset.type, size: asset.blob.size, sha256: asset.sha256 };

  const digests = await digestBlobWithCrc(asset.blob);
  if (digests.sha256 !== asset.sha256) throw new Error(`Аудиофайл «${asset.name}» изменился после сохранения. Загрузите файл заново.`);
  const path = `audio/${asset.sha256}${fileExtension(asset.name, asset.type)}`;
  entries.set(asset.sha256, { path, blob: asset.blob, type: asset.type || 'application/octet-stream', ...digests });
  return { path, name: asset.name, type: asset.type, size: asset.blob.size, sha256: asset.sha256 };
}

function materializeAudioRef(
  ref: PackageAudioRef,
  entries: Map<string, Blob>,
  audioAssets: AudioAsset[],
  hashToAudioId: Map<string, string>,
  initialAudioHashes: Set<string>,
  reusedAudioHashes: Set<string>,
  newAudioHashes: Set<string>,
  onInternalReuse: () => void,
) {
  const existingId = hashToAudioId.get(ref.sha256);
  if (existingId) {
    if (initialAudioHashes.has(ref.sha256)) reusedAudioHashes.add(ref.sha256);
    else onInternalReuse();
    return existingId;
  }
  const source = entries.get(ref.path);
  if (!source) throw new Error(`Не найден аудиофайл «${ref.path}».`);
  const asset: AudioAsset = {
    id: ref.sha256,
    name: ref.name,
    type: ref.type,
    blob: source,
    sha256: ref.sha256,
    verified: true,
  };
  audioAssets.push(asset);
  hashToAudioId.set(ref.sha256, asset.id);
  newAudioHashes.add(ref.sha256);
  return asset.id;
}

function buildManifest(kind: MelodyPackageKind, entries: ExportEntry[], game?: GameConfig): MelodyPackageManifest {
  return {
    type: kind,
    formatVersion: MELODY_PACKAGE_FORMAT_VERSION,
    appVersion: MELODY_APP_VERSION,
    exportedAt: new Date().toISOString(),
    ...(game ? { gameId: game.id, gameName: game.title } : {}),
    files: entries.map((entry) => ({ path: entry.path, size: entry.blob.size, sha256: entry.sha256, mediaType: entry.type })),
  };
}

async function jsonEntry(path: string, value: unknown): Promise<ExportEntry> {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  return { path, blob, type: 'application/json', ...(await digestBlobWithCrc(blob)) };
}


function assertExportBounds(entries: ExportEntry[]) {
  if (entries.length > DATA_LIMITS.packageFiles + 1) throw new Error('Слишком много файлов для одного архива.');
  let totalSize = 0;
  for (const entry of entries) {
    totalSize += entry.blob.size;
    if (!Number.isSafeInteger(totalSize) || totalSize > DATA_LIMITS.packageBytes) {
      throw new Error('Суммарный размер архива превышает допустимый лимит 4 ГБ.');
    }
  }
}

function parseJson<T>(value: string, name: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Не удалось прочитать ${name}.`);
  }
}


function remapGameSongs(sourceGame: GameConfig, songIdMap: Map<string, string>, gameId: string): GameConfig {
  return {
    ...sourceGame,
    id: gameId,
    rounds: sourceGame.rounds.map((round) => ({
      ...round,
      categories: round.categories.map((category) => ({
        ...category,
        questions: category.questions.map((question) => ({
          ...question,
          songId: question.songId ? songIdMap.get(question.songId) : undefined,
        })),
      })),
    })),
  };
}

function songFingerprint(song: Song, hashById: Map<string, string>) {
  return fingerprintParts(
    song.artist,
    song.title,
    song.minusAudioId ? hashById.get(song.minusAudioId) ?? `missing:${song.minusAudioId}` : '',
    song.plusAudioId ? hashById.get(song.plusAudioId) ?? `missing:${song.plusAudioId}` : '',
  );
}

function packageSongFingerprint(song: PackageSong) {
  return fingerprintParts(song.artist, song.title, song.minus?.sha256 ?? '', song.plus?.sha256 ?? '');
}

function fingerprintParts(artist: string, title: string, minusHash: string, plusHash: string) {
  return [normalizeText(artist), normalizeText(title), minusHash, plusHash].join('|');
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

function uniqueCopyTitle(title: string, games: GameConfig[]) {
  const used = new Set(games.map((game) => game.title));
  let index = 1;
  while (true) {
    const suffix = index === 1 ? ' (копия)' : ` (копия ${index})`;
    const sourceLength = Math.max(0, DATA_LIMITS.text.gameTitle - suffix.length);
    const candidate = `${title.trim().slice(0, sourceLength).trimEnd()}${suffix}`.slice(0, DATA_LIMITS.text.gameTitle);
    if (!used.has(candidate)) return candidate;
    index += 1;
  }
}

function safeFilename(value: string) {
  const normalized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ');
  return (normalized || 'game').slice(0, 120);
}

function fileExtension(name: string, type: string) {
  const match = name.match(/(\.[a-z0-9]{1,8})$/i);
  if (match) return match[1].toLowerCase();
  if (type === 'audio/mpeg') return '.mp3';
  if (type === 'audio/wav' || type === 'audio/x-wav') return '.wav';
  if (type === 'audio/ogg') return '.ogg';
  if (type === 'audio/flac') return '.flac';
  if (type === 'audio/mp4' || type === 'audio/x-m4a') return '.m4a';
  return '.bin';
}
