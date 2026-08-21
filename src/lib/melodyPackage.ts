import { createId } from './ids';
import { crc32 } from './zipStore';
import { createStoredZip, readStoredZip } from './zipStore';
import { createSession } from '../model/defaults';
import { GAME_LIMITS } from '../model/limits';
import type { AudioAsset, GameConfig, PersistedState, Song } from '../model/types';

export const MELODY_PACKAGE_FORMAT_VERSION = 1;
export const MELODY_APP_VERSION = '1.3.4';

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

export type ParsedMelodyPackage = {
  manifest: MelodyPackageManifest;
  game?: GameConfig;
  songs: PackageSong[];
  entries: Map<string, Blob>;
};

export type ImportStats = {
  newSongs: number;
  reusedSongs: number;
  newAudio: number;
  reusedAudio: number;
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
};

type Digests = { sha256: string; crc32: number };

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
  const usedSongIds = new Set(
    game.rounds.flatMap((round) =>
      round.categories.flatMap((category) =>
        category.questions.map((question) => question.songId).filter((id): id is string => Boolean(id)),
      ),
    ),
  );
  const packageSongs = songs.filter((song) => usedSongIds.has(song.id));
  const missingSongIds = [...usedSongIds].filter((songId) => !packageSongs.some((song) => song.id === songId));
  if (missingSongIds.length > 0) throw new Error('Игра содержит ссылки на отсутствующие песни. Откройте редактор и назначьте песни заново.');
  const { serializedSongs, audioEntries } = await serializeSongs(packageSongs, audioAssets);

  const gameEntry = await jsonEntry('game.json', game);
  const songsEntry = await jsonEntry('songs.json', serializedSongs);
  const contentEntries = [gameEntry, songsEntry, ...audioEntries];
  const manifest = buildManifest('melody-game', contentEntries, game);
  const manifestEntry = await jsonEntry('manifest.json', manifest);
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
  const blob = await createStoredZip(
    [manifestEntry, ...contentEntries].map((entry) => ({ name: entry.path, data: entry.blob, crc32: entry.crc32 })),
  );

  const date = new Date().toISOString().slice(0, 10);
  return { blob, filename: `melody-library-${date}.melody-library` };
}

export async function parseMelodyPackage(file: Blob): Promise<ParsedMelodyPackage> {
  const zipEntries = await readStoredZip(file);
  const manifestEntry = zipEntries.get('manifest.json');
  if (!manifestEntry) throw new Error('В архиве отсутствует manifest.json.');
  if (manifestEntry.size > 2 * 1024 * 1024) throw new Error('manifest.json имеет недопустимый размер.');

  const manifest = parseJson<MelodyPackageManifest>(await manifestEntry.blob.text(), 'manifest.json');
  validateManifest(manifest);

  const entries = new Map<string, Blob>();
  for (const descriptor of manifest.files) {
    const entry = zipEntries.get(descriptor.path);
    if (!entry) throw new Error(`В архиве отсутствует файл «${descriptor.path}».`);
    if (entry.size !== descriptor.size) throw new Error(`Размер файла «${descriptor.path}» не совпадает с manifest.`);
    const digests = await digestBlob(entry.blob);
    if (digests.sha256 !== descriptor.sha256) throw new Error(`Контрольная сумма «${descriptor.path}» не совпадает. Архив повреждён.`);
    if (digests.crc32 !== entry.crc32) throw new Error(`CRC файла «${descriptor.path}» не совпадает. Архив повреждён.`);
    entries.set(descriptor.path, entry.blob);
  }

  const songsBlob = entries.get('songs.json');
  if (!songsBlob) throw new Error('В архиве отсутствует songs.json.');
  const songs = parseJson<PackageSong[]>(await songsBlob.text(), 'songs.json');
  validatePackageSongs(songs, entries, manifest.files);

  let game: GameConfig | undefined;
  if (manifest.type === 'melody-game') {
    const gameBlob = entries.get('game.json');
    if (!gameBlob) throw new Error('В архиве игры отсутствует game.json.');
    game = parseJson<GameConfig>(await gameBlob.text(), 'game.json');
    validateGame(game);
    const packageSongIds = new Set(songs.map((song) => song.id));
    const missingSongReference = game.rounds
      .flatMap((round) => round.categories.flatMap((category) => category.questions))
      .find((question) => question.songId && !packageSongIds.has(question.songId));
    if (missingSongReference?.songId) throw new Error(`В game.json есть ссылка на отсутствующую песню «${missingSongReference.songId}».`);
    if (manifest.gameId && manifest.gameId !== game.id) throw new Error('gameId в manifest не совпадает с game.json.');
  }

  return { manifest, game, songs, entries };
}

export async function prepareMediaMerge(
  packageData: ParsedMelodyPackage,
  currentSongs: Song[],
  currentAudioAssets: AudioAsset[],
): Promise<PreparedMediaMerge> {
  const audioAssets = await enrichAudioHashes(currentAudioAssets);
  const hashToAudioId = new Map<string, string>();
  const audioHashById = new Map<string, string>();
  for (const asset of audioAssets) {
    if (!asset.sha256) continue;
    if (!hashToAudioId.has(asset.sha256)) hashToAudioId.set(asset.sha256, asset.id);
    audioHashById.set(asset.id, asset.sha256);
  }

  const songByFingerprint = new Map<string, Song>();
  for (const song of currentSongs) songByFingerprint.set(songFingerprint(song, audioHashById), song);

  const mergedSongs = [...currentSongs];
  const mergedAudioAssets = [...audioAssets];
  const songIdMap = new Map<string, string>();
  const newAudioHashes = new Set<string>();
  const reusedAudioHashes = new Set<string>();
  let newSongs = 0;
  let reusedSongs = 0;

  for (const packageSong of packageData.songs) {
    const importedFingerprint = packageSongFingerprint(packageSong);
    const existingSong = songByFingerprint.get(importedFingerprint);
    if (existingSong) {
      songIdMap.set(packageSong.id, existingSong.id);
      reusedSongs += 1;
      for (const audioRef of [packageSong.minus, packageSong.plus]) {
        if (audioRef) reusedAudioHashes.add(audioRef.sha256);
      }
      continue;
    }

    const minusAudioId = packageSong.minus
      ? materializeAudioRef(packageSong.minus, packageData.entries, mergedAudioAssets, hashToAudioId, newAudioHashes, reusedAudioHashes)
      : undefined;
    const plusAudioId = packageSong.plus
      ? materializeAudioRef(packageSong.plus, packageData.entries, mergedAudioAssets, hashToAudioId, newAudioHashes, reusedAudioHashes)
      : undefined;

    const song: Song = {
      id: createId('song'),
      artist: packageSong.artist,
      title: packageSong.title,
      minusAudioId,
      plusAudioId,
      createdAt: packageSong.createdAt || Date.now(),
      updatedAt: packageSong.updatedAt || Date.now(),
    };
    mergedSongs.push(song);
    songIdMap.set(packageSong.id, song.id);
    newSongs += 1;
    const minusHash = packageSong.minus?.sha256 ?? '';
    const plusHash = packageSong.plus?.sha256 ?? '';
    songByFingerprint.set(fingerprintParts(song.artist, song.title, minusHash, plusHash), song);
  }

  return {
    songs: mergedSongs,
    audioAssets: mergedAudioAssets,
    songIdMap,
    stats: {
      newSongs,
      reusedSongs,
      newAudio: newAudioHashes.size,
      reusedAudio: reusedAudioHashes.size,
    },
  };
}

export async function prepareGameImport(
  packageData: ParsedMelodyPackage,
  state: Pick<PersistedState, 'games' | 'songs' | 'audioAssets'>,
): Promise<PreparedGameImport> {
  if (packageData.manifest.type !== 'melody-game' || !packageData.game) throw new Error('Выбранный архив не является экспортом игры.');
  const media = await prepareMediaMerge(packageData, state.songs, state.audioAssets);
  return {
    package: packageData,
    media,
    hasGameConflict: state.games.some((game) => game.id === packageData.game!.id),
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
  const importedGame: GameConfig = {
    ...sourceGame,
    id: importedGameId,
    title: hasConflict && conflictMode === 'copy' ? uniqueCopyTitle(sourceGame.title, state.games) : sourceGame.title,
    createdAt: hasConflict && conflictMode === 'copy' ? now : sourceGame.createdAt,
    updatedAt: now,
    rounds: sourceGame.rounds.map((round) => ({
      ...round,
      categories: round.categories.map((category) => ({
        ...category,
        questions: category.questions.map((question) => ({
          ...question,
          songId: question.songId ? prepared.media.songIdMap.get(question.songId) : undefined,
        })),
      })),
    })),
  };

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
  return {
    ...state,
    songs: preparedMedia.songs,
    audioAssets: preparedMedia.audioAssets,
  };
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
  const assetById = new Map(audioAssets.map((asset) => [asset.id, asset]));
  const audioEntriesByHash = new Map<string, ExportEntry>();
  const serializedSongs: PackageSong[] = [];

  for (const song of songs) {
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
  const digests = asset.sha256 ? { sha256: asset.sha256, crc32: await crc32BlobFast(asset.blob) } : await digestBlob(asset.blob);
  const existing = entries.get(digests.sha256);
  const path = existing?.path ?? `audio/${digests.sha256}${fileExtension(asset.name, asset.type)}`;
  if (!existing) entries.set(digests.sha256, { path, blob: asset.blob, type: asset.type || 'application/octet-stream', ...digests });
  return { path, name: asset.name, type: asset.type, size: asset.size, sha256: digests.sha256 };
}

function materializeAudioRef(
  ref: PackageAudioRef,
  entries: Map<string, Blob>,
  audioAssets: AudioAsset[],
  hashToAudioId: Map<string, string>,
  newAudioHashes: Set<string>,
  reusedAudioHashes: Set<string>,
) {
  const existingId = hashToAudioId.get(ref.sha256);
  if (existingId) {
    if (!newAudioHashes.has(ref.sha256)) reusedAudioHashes.add(ref.sha256);
    return existingId;
  }
  const source = entries.get(ref.path);
  if (!source) throw new Error(`Не найден аудиофайл «${ref.path}».`);
  const asset: AudioAsset = {
    id: createId('audio'),
    name: ref.name,
    type: ref.type,
    size: ref.size,
    blob: new Blob([source], { type: ref.type || 'application/octet-stream' }),
    sha256: ref.sha256,
  };
  audioAssets.push(asset);
  hashToAudioId.set(ref.sha256, asset.id);
  newAudioHashes.add(ref.sha256);
  reusedAudioHashes.delete(ref.sha256);
  return asset.id;
}

async function enrichAudioHashes(assets: AudioAsset[]) {
  const result: AudioAsset[] = [];
  for (const asset of assets) {
    if (asset.sha256) {
      result.push(asset);
      continue;
    }
    result.push({ ...asset, sha256: (await digestBlob(asset.blob)).sha256 });
  }
  return result;
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
  return { path, blob, type: 'application/json', ...(await digestBlob(blob)) };
}

async function digestBlob(blob: Blob): Promise<Digests> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return { sha256, crc32: crc32(bytes) };
}

async function crc32BlobFast(blob: Blob) {
  return crc32(new Uint8Array(await blob.arrayBuffer()));
}

function parseJson<T>(value: string, name: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Не удалось прочитать ${name}.`);
  }
}

function validateManifest(value: MelodyPackageManifest) {
  if (!value || (value.type !== 'melody-game' && value.type !== 'melody-library')) throw new Error('Неизвестный тип Melody-архива.');
  if (value.formatVersion !== MELODY_PACKAGE_FORMAT_VERSION) {
    throw new Error(`Версия формата ${value.formatVersion} не поддерживается этой версией приложения.`);
  }
  if (typeof value.appVersion !== 'string' || typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt))) throw new Error('Некорректные метаданные manifest.');
  if (!Array.isArray(value.files) || value.files.length > 20_000) throw new Error('Некорректный список файлов в manifest.');
  const paths = new Set<string>();
  for (const file of value.files) {
    if (!file?.path || !Number.isFinite(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/i.test(file.sha256)) throw new Error('Некорректная запись файла в manifest.');
    if (file.path.startsWith('/') || file.path.includes('..') || file.path.includes('\\')) throw new Error(`Недопустимый путь «${file.path}» в manifest.`);
    if (paths.has(file.path)) throw new Error(`Файл «${file.path}» повторяется в manifest.`);
    paths.add(file.path);
  }
}

function validatePackageSongs(songs: PackageSong[], entries: Map<string, Blob>, manifestFiles: PackageManifestFile[]) {
  const manifestByPath = new Map(manifestFiles.map((file) => [file.path, file]));
  if (!Array.isArray(songs) || songs.length > 10_000) throw new Error('Некорректный список песен.');
  const songIds = new Set<string>();
  for (const song of songs) {
    if (!song?.id || typeof song.artist !== 'string' || typeof song.title !== 'string' || !Number.isFinite(song.createdAt) || !Number.isFinite(song.updatedAt)) throw new Error('Некорректная запись песни.');
    if (songIds.has(song.id)) throw new Error(`Песня с id «${song.id}» повторяется в архиве.`);
    songIds.add(song.id);
    for (const ref of [song.minus, song.plus]) {
      if (!ref) continue;
      if (typeof ref.path !== 'string' || typeof ref.name !== 'string' || typeof ref.type !== 'string' || !Number.isFinite(ref.size) || ref.size <= 0 || !ref.path.startsWith('audio/') || !entries.has(ref.path) || !/^[a-f0-9]{64}$/i.test(ref.sha256)) {
        throw new Error(`Некорректная ссылка на аудио в песне «${song.artist} — ${song.title}».`);
      }
      const manifestFile = manifestByPath.get(ref.path);
      if (!manifestFile || manifestFile.sha256 !== ref.sha256) throw new Error(`SHA-256 аудио «${ref.name}» не совпадает с manifest.`);
      if (entries.get(ref.path)!.size !== ref.size || manifestFile.size !== ref.size) throw new Error(`Некорректный размер аудио «${ref.name}».`);
    }
  }
}

function validateGame(game: GameConfig) {
  if (!game?.id || typeof game.title !== 'string' || !Number.isFinite(game.createdAt) || !Number.isFinite(game.updatedAt) || !Array.isArray(game.rounds) || !Array.isArray(game.teams)) {
    throw new Error('Некорректная структура game.json.');
  }
  if (game.rounds.length < 1 || game.rounds.length > GAME_LIMITS.rounds) throw new Error('В game.json должно быть от 1 до 10 раундов.');
  if (game.teams.length < 1 || game.teams.length > GAME_LIMITS.teams) throw new Error('Некорректное количество команд в game.json.');

  const ids = new Set<string>();
  const takeId = (id: unknown, entity: string) => {
    if (typeof id !== 'string' || !id) throw new Error(`У ${entity} отсутствует корректный id.`);
    if (ids.has(id)) throw new Error(`В game.json повторяется id «${id}».`);
    ids.add(id);
  };
  takeId(game.id, 'игры');

  for (const team of game.teams) {
    takeId(team?.id, 'команды');
    if (typeof team.name !== 'string' || typeof team.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(team.color)) throw new Error('Некорректная команда в game.json.');
  }
  for (const round of game.rounds) {
    takeId(round?.id, 'раунда');
    if (typeof round.name !== 'string' || !Array.isArray(round.categories) || round.categories.length > GAME_LIMITS.categoriesPerRound) {
      throw new Error('Некорректный раунд в game.json.');
    }
    for (const category of round.categories) {
      takeId(category?.id, 'категории');
      if (typeof category.name !== 'string' || !Array.isArray(category.questions) || category.questions.length > GAME_LIMITS.questionsPerCategory) {
        throw new Error('Некорректная категория в game.json.');
      }
      for (const question of category.questions) {
        takeId(question?.id, 'вопроса');
        if (!Number.isFinite(question.points) || question.points < 0 || (question.songId !== undefined && typeof question.songId !== 'string')) {
          throw new Error('Некорректный вопрос в game.json.');
        }
      }
    }
  }
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
  const base = `${title} (копия)`;
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${title} (копия ${index})`)) index += 1;
  return `${title} (копия ${index})`;
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
  if (type === 'audio/mp4' || type === 'audio/x-m4a') return '.m4a';
  return '.bin';
}
