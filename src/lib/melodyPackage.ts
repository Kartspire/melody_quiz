import { createId } from './ids';
import { crc32Blob, digestBlobWithCrc } from './contentHash';
import { createStoredZip, readStoredZip } from './zipStore';
import { createSession } from '../model/defaults';
import { normalizeGameConfig } from '../model/migrations';
import { getInterRoundTrackIds, remapInterRoundTrackIds } from '../interRounds/templates';
import { DATA_LIMITS } from '../model/limits';
import { assertValidGameStructure, assertValidMediaTrack, assertValidSong, getGameStartIssues, isSha256 } from '../model/validation';
import type { AudioAsset, GameConfig, MediaTrack, PersistedState, Song } from '../model/types';
import {
  MELODY_PACKAGE_FORMAT_VERSION,
  migrateManifest,
  validateLegacyPackageSongsV1,
  validateManifest,
  validatePackageSongMetadata,
  validatePackageSongs,
  validatePackageTrackMetadata,
  validatePackageTracks,
} from './melodyPackageSchema';
import type {
  LegacyPackageSongV1,
  MelodyPackageKind,
  MelodyPackageManifest,
  PackageAudioRef,
  PackageMediaTrack,
  PackageSong,
} from './melodyPackageSchema';

export { MELODY_PACKAGE_FORMAT_VERSION } from './melodyPackageSchema';
export type { MelodyPackageKind, MelodyPackageManifest, PackageAudioRef, PackageMediaTrack, PackageSong } from './melodyPackageSchema';

export const MELODY_APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export type ParsedMelodyPackage = {
  manifest: MelodyPackageManifest;
  game?: GameConfig;
  songs: PackageSong[];
  tracks: PackageMediaTrack[];
  entries: Map<string, Blob>;
};

export type ImportStats = {
  newSongs: number;
  reusedSongs: number;
  deduplicatedSongs: number;
  newTracks: number;
  reusedTracks: number;
  deduplicatedTracks: number;
  newAudio: number;
  reusedAudio: number;
  internalAudioReuses: number;
};

export type PreparedMediaMerge = {
  songs: Song[];
  mediaTracks: MediaTrack[];
  audioAssets: AudioAsset[];
  songIdMap: Map<string, string>;
  trackIdMap: Map<string, string>;
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
  mediaTracks: MediaTrack[],
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

  const usedTrackIds = new Set(packageSongs.flatMap((song) => [song.minusTrackId, song.plusTrackId].filter((id): id is string => Boolean(id))));
  for (const interRound of game.interRounds) {
    for (const trackId of getInterRoundTrackIds(interRound)) if (trackId) usedTrackIds.add(trackId);
  }
  const packageTracks = mediaTracks.filter((track) => usedTrackIds.has(track.id));
  const foundTrackIds = new Set(packageTracks.map((track) => track.id));
  if ([...usedTrackIds].some((trackId) => !foundTrackIds.has(trackId))) throw new Error('Игра содержит песню со ссылкой на отсутствующий аудиотрек.');

  const { serializedTracks, audioEntries } = await serializeTracks(packageTracks, audioAssets);
  const serializedSongs = serializeSongs(packageSongs, foundTrackIds);
  const gameEntry = await jsonEntry('game.json', game);
  const songsEntry = await jsonEntry('songs.json', serializedSongs);
  const tracksEntry = await jsonEntry('tracks.json', serializedTracks);
  const contentEntries = [gameEntry, songsEntry, tracksEntry, ...audioEntries];
  const manifest = buildManifest('melody-game', contentEntries, game);
  const manifestEntry = await jsonEntry('manifest.json', manifest);
  assertExportBounds([manifestEntry, ...contentEntries]);
  const blob = await createStoredZip([manifestEntry, ...contentEntries].map((entry) => ({ name: entry.path, data: entry.blob, crc32: entry.crc32 })));
  return { blob, filename: `${safeFilename(game.title || 'game')}.melody` };
}

export async function exportLibraryPackage(
  songs: Song[],
  mediaTracks: MediaTrack[],
  audioAssets: AudioAsset[],
): Promise<{ blob: Blob; filename: string }> {
  const trackIds = new Set(mediaTracks.map((track) => track.id));
  const serializedSongs = serializeSongs(songs, trackIds);
  const { serializedTracks, audioEntries } = await serializeTracks(mediaTracks, audioAssets);
  const songsEntry = await jsonEntry('songs.json', serializedSongs);
  const tracksEntry = await jsonEntry('tracks.json', serializedTracks);
  const contentEntries = [songsEntry, tracksEntry, ...audioEntries];
  const manifest = buildManifest('melody-library', contentEntries);
  const manifestEntry = await jsonEntry('manifest.json', manifest);
  assertExportBounds([manifestEntry, ...contentEntries]);
  const blob = await createStoredZip([manifestEntry, ...contentEntries].map((entry) => ({ name: entry.path, data: entry.blob, crc32: entry.crc32 })));
  return { blob, filename: `melody-library-${new Date().toISOString().slice(0, 10)}.melody-library` };
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

  const manifest = migrateManifest(parseJson<MelodyPackageManifest>(await manifestEntry.blob.text(), 'manifest.json'));
  validateManifest(manifest);

  const allowedPaths = new Set(['manifest.json', ...manifest.files.map((descriptor) => descriptor.path)]);
  for (const path of zipEntries.keys()) if (!allowedPaths.has(path)) throw new Error(`Архив содержит незаявленный файл «${path}».`);

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

  let songs: PackageSong[];
  let tracks: PackageMediaTrack[];
  if (manifest.formatVersion === 1) {
    const legacySongs = parseJson<LegacyPackageSongV1[]>(await songsBlob.text(), 'songs.json');
    await validateLegacyPackageSongsV1(legacySongs, entries, manifest.files);
    ({ songs, tracks } = migrateLegacyPackageV1(legacySongs));
  } else {
    const tracksBlob = entries.get('tracks.json');
    if (!tracksBlob) throw new Error('В архиве отсутствует tracks.json.');
    if (tracksBlob.size > DATA_LIMITS.tracksJsonBytes) throw new Error('tracks.json имеет недопустимый размер.');
    tracks = parseJson<PackageMediaTrack[]>(await tracksBlob.text(), 'tracks.json');
    await validatePackageTracks(tracks, entries, manifest.files);
    songs = parseJson<PackageSong[]>(await songsBlob.text(), 'songs.json');
    validatePackageSongs(songs, new Set(tracks.map((track) => track.id)));
  }

  let game: GameConfig | undefined;
  if (manifest.type === 'melody-game') {
    const gameBlob = entries.get('game.json');
    if (!gameBlob) throw new Error('В архиве игры отсутствует game.json.');
    if (gameBlob.size > DATA_LIMITS.gameJsonBytes) throw new Error('game.json имеет недопустимый размер.');
    const parsedGame = parseJson<GameConfig>(await gameBlob.text(), 'game.json');
    game = normalizeGameConfig(parsedGame).game;
    assertValidGameStructure(game);
    const packageSongIds = new Set(songs.map((song) => song.id));
    const missingSongReference = game.rounds.flatMap((round) => round.categories.flatMap((category) => category.questions)).find((question) => question.songId && !packageSongIds.has(question.songId));
    if (missingSongReference?.songId) throw new Error(`В game.json есть ссылка на отсутствующую песню «${missingSongReference.songId}».`);
    const packageTrackIds = new Set(tracks.map((track) => track.id));
    for (const interRound of game.interRounds) {
      const missingTrackId = getInterRoundTrackIds(interRound).find((trackId) => trackId && !packageTrackIds.has(trackId));
      if (missingTrackId) throw new Error(`В game.json есть ссылка на отсутствующий медиатрек «${missingTrackId}».`);
    }
    if (manifest.gameId && manifest.gameId !== game.id) throw new Error('gameId в manifest не совпадает с game.json.');
  } else if (entries.has('game.json')) {
    throw new Error('Архив медиатеки не должен содержать game.json.');
  }

  return { manifest, game, songs, tracks, entries };
}

export async function prepareMediaMerge(
  packageData: ParsedMelodyPackage,
  currentSongs: Song[],
  currentMediaTracks: MediaTrack[],
  currentAudioAssets: AudioAsset[],
): Promise<PreparedMediaMerge> {
  const hashToAudioId = new Map<string, string>();
  for (const asset of currentAudioAssets) {
    if (!isSha256(asset.id) || asset.sha256 !== asset.id || asset.verified !== true) throw new Error('Локальная медиатека содержит аудио старого формата. Перезагрузите приложение, чтобы завершить миграцию.');
    hashToAudioId.set(asset.sha256, asset.id);
  }
  currentMediaTracks.forEach(assertValidMediaTrack);
  currentSongs.forEach(assertValidSong);

  const initialAudioHashes = new Set(hashToAudioId.keys());
  const mergedAudioAssets = [...currentAudioAssets];
  const mergedTracks = [...currentMediaTracks];
  const mergedSongs = [...currentSongs];
  const usedExistingAudioHashes = new Set<string>();
  const newAudioHashes = new Set<string>();
  let internalAudioReuses = 0;

  const trackByFingerprint = new Map<string, MediaTrack>();
  const initialTrackFingerprints = new Set<string>();
  for (const track of currentMediaTracks) {
    const fingerprint = trackFingerprint(track.name, track.audioId);
    if (!trackByFingerprint.has(fingerprint)) trackByFingerprint.set(fingerprint, track);
    initialTrackFingerprints.add(fingerprint);
  }

  const usedTrackIds = new Set(currentMediaTracks.map((track) => track.id));
  const trackIdMap = new Map<string, string>();
  let newTracks = 0;
  let reusedTracks = 0;
  let deduplicatedTracks = 0;

  for (const packageTrack of packageData.tracks) {
    const fingerprint = trackFingerprint(packageTrack.name, packageTrack.audio.sha256);
    const existing = trackByFingerprint.get(fingerprint);
    if (existing) {
      trackIdMap.set(packageTrack.id, existing.id);
      if (initialTrackFingerprints.has(fingerprint)) reusedTracks += 1;
      else deduplicatedTracks += 1;
      countAudioReuse(packageTrack.audio.sha256, initialAudioHashes, newAudioHashes, usedExistingAudioHashes, () => { internalAudioReuses += 1; });
      continue;
    }

    const audioId = materializeAudioRef(
      packageTrack.audio,
      packageData.entries,
      mergedAudioAssets,
      hashToAudioId,
      initialAudioHashes,
      usedExistingAudioHashes,
      newAudioHashes,
      () => { internalAudioReuses += 1; },
    );
    const trackId = usedTrackIds.has(packageTrack.id) ? createId('track') : packageTrack.id;
    usedTrackIds.add(trackId);
    const track: MediaTrack = {
      id: trackId,
      name: packageTrack.name.trim(),
      audioId,
      createdAt: packageTrack.createdAt,
      updatedAt: packageTrack.updatedAt,
    };
    mergedTracks.push(track);
    trackIdMap.set(packageTrack.id, track.id);
    trackByFingerprint.set(fingerprint, track);
    newTracks += 1;
  }

  const songByFingerprint = new Map<string, Song>();
  const initialSongFingerprints = new Set<string>();
  for (const song of currentSongs) {
    const fingerprint = songFingerprint(song.artist, song.title, song.minusTrackId, song.plusTrackId);
    if (!songByFingerprint.has(fingerprint)) songByFingerprint.set(fingerprint, song);
    initialSongFingerprints.add(fingerprint);
  }
  const usedSongIds = new Set(currentSongs.map((song) => song.id));
  const songIdMap = new Map<string, string>();
  let newSongs = 0;
  let reusedSongs = 0;
  let deduplicatedSongs = 0;

  for (const packageSong of packageData.songs) {
    const minusTrackId = packageSong.minusTrackId ? trackIdMap.get(packageSong.minusTrackId) : undefined;
    const plusTrackId = packageSong.plusTrackId ? trackIdMap.get(packageSong.plusTrackId) : undefined;
    if (packageSong.minusTrackId && !minusTrackId) throw new Error(`Не удалось сопоставить минус песни «${packageSong.artist} — ${packageSong.title}».`);
    if (packageSong.plusTrackId && !plusTrackId) throw new Error(`Не удалось сопоставить плюс песни «${packageSong.artist} — ${packageSong.title}».`);
    const fingerprint = songFingerprint(packageSong.artist, packageSong.title, minusTrackId, plusTrackId);
    const existing = songByFingerprint.get(fingerprint);
    if (existing) {
      songIdMap.set(packageSong.id, existing.id);
      if (initialSongFingerprints.has(fingerprint)) reusedSongs += 1;
      else deduplicatedSongs += 1;
      continue;
    }

    const songId = usedSongIds.has(packageSong.id) ? createId('song') : packageSong.id;
    usedSongIds.add(songId);
    const song: Song = {
      id: songId,
      artist: packageSong.artist.trim(),
      title: packageSong.title.trim(),
      minusTrackId,
      plusTrackId,
      createdAt: packageSong.createdAt,
      updatedAt: packageSong.updatedAt,
    };
    mergedSongs.push(song);
    songIdMap.set(packageSong.id, song.id);
    songByFingerprint.set(fingerprint, song);
    newSongs += 1;
  }

  return {
    songs: mergedSongs,
    mediaTracks: mergedTracks,
    audioAssets: mergedAudioAssets,
    songIdMap,
    trackIdMap,
    stats: {
      newSongs,
      reusedSongs,
      deduplicatedSongs,
      newTracks,
      reusedTracks,
      deduplicatedTracks,
      newAudio: newAudioHashes.size,
      reusedAudio: usedExistingAudioHashes.size,
      internalAudioReuses,
    },
  };
}

export async function prepareGameImport(
  packageData: ParsedMelodyPackage,
  state: Pick<PersistedState, 'games' | 'songs' | 'mediaTracks' | 'audioAssets'>,
): Promise<PreparedGameImport> {
  if (packageData.manifest.type !== 'melody-game' || !packageData.game) throw new Error('Выбранный архив не является экспортом игры.');
  const media = await prepareMediaMerge(packageData, state.songs, state.mediaTracks, state.audioAssets);
  const remappedGame = remapGameReferences(packageData.game, media.songIdMap, media.trackIdMap, packageData.game.id);
  return {
    package: packageData,
    media,
    hasGameConflict: state.games.some((game) => game.id === packageData.game!.id),
    playabilityIssues: getGameStartIssues(remappedGame, media.songs, media.mediaTracks, media.audioAssets),
  };
}

export function finalizeGameImport(prepared: PreparedGameImport, state: PersistedState, conflictMode: GameConflictMode = 'copy'): PersistedState {
  const sourceGame = prepared.package.game;
  if (!sourceGame) throw new Error('В импортируемом архиве нет игры.');

  const hasConflict = state.games.some((game) => game.id === sourceGame.id);
  const importedGameId = hasConflict && conflictMode === 'copy' ? createId('game') : sourceGame.id;
  const now = Date.now();
  const importedGame = remapGameReferences(sourceGame, prepared.media.songIdMap, prepared.media.trackIdMap, importedGameId);
  importedGame.title = hasConflict && conflictMode === 'copy' ? uniqueCopyTitle(sourceGame.title, state.games) : sourceGame.title;
  importedGame.createdAt = hasConflict && conflictMode === 'copy' ? now : sourceGame.createdAt;
  importedGame.updatedAt = now;

  const games = hasConflict && conflictMode === 'replace' ? state.games.map((game) => (game.id === sourceGame.id ? importedGame : game)) : [...state.games, importedGame];
  const sessions = state.sessions.filter((session) => session.gameId !== importedGame.id);
  sessions.push(createSession(importedGame));

  return {
    version: 4,
    games,
    songs: prepared.media.songs,
    mediaTracks: prepared.media.mediaTracks,
    audioAssets: prepared.media.audioAssets,
    sessions,
    activeGameId: importedGame.id,
  };
}

export function finalizeLibraryImport(preparedMedia: PreparedMediaMerge, state: PersistedState): PersistedState {
  return { ...state, songs: preparedMedia.songs, mediaTracks: preparedMedia.mediaTracks, audioAssets: preparedMedia.audioAssets };
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

function serializeSongs(songs: Song[], trackIds: Set<string>): PackageSong[] {
  if (!Array.isArray(songs) || songs.length > DATA_LIMITS.packageSongs) throw new Error('Слишком много песен для одного архива.');
  const songIds = new Set<string>();
  return songs.map((song) => {
    validatePackageSongMetadata(song);
    if (songIds.has(song.id)) throw new Error(`Песня с id «${song.id}» повторяется в медиатеке.`);
    songIds.add(song.id);
    for (const trackId of [song.minusTrackId, song.plusTrackId]) if (trackId && !trackIds.has(trackId)) throw new Error(`У песни «${song.artist} — ${song.title}» отсутствует связанный медиатрек.`);
    return { ...song };
  });
}

async function serializeTracks(mediaTracks: MediaTrack[], audioAssets: AudioAsset[]) {
  if (!Array.isArray(mediaTracks) || mediaTracks.length > DATA_LIMITS.packageTracks) throw new Error('Слишком много аудиотреков для одного архива.');
  const trackIds = new Set<string>();
  const assetById = new Map(audioAssets.map((asset) => [asset.id, asset]));
  const audioEntriesByHash = new Map<string, ExportEntry>();
  const serializedTracks: PackageMediaTrack[] = [];

  for (const track of mediaTracks) {
    validatePackageTrackMetadata(track);
    if (trackIds.has(track.id)) throw new Error(`Медиатрек с id «${track.id}» повторяется.`);
    trackIds.add(track.id);
    const asset = assetById.get(track.audioId);
    if (!asset) throw new Error(`У медиатрека «${track.name}» отсутствует физический аудиофайл.`);
    const audio = await serializeAudio(asset, audioEntriesByHash);
    serializedTracks.push({ id: track.id, name: track.name, createdAt: track.createdAt, updatedAt: track.updatedAt, audio });
  }
  return { serializedTracks, audioEntries: [...audioEntriesByHash.values()] };
}

async function serializeAudio(asset: AudioAsset, entries: Map<string, ExportEntry>): Promise<PackageAudioRef> {
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
    countAudioReuse(ref.sha256, initialAudioHashes, newAudioHashes, reusedAudioHashes, onInternalReuse);
    return existingId;
  }
  const source = entries.get(ref.path);
  if (!source) throw new Error(`Не найден аудиофайл «${ref.path}».`);
  const asset: AudioAsset = { id: ref.sha256, name: ref.name, type: ref.type, blob: source, sha256: ref.sha256, verified: true };
  audioAssets.push(asset);
  hashToAudioId.set(ref.sha256, asset.id);
  newAudioHashes.add(ref.sha256);
  return asset.id;
}

function countAudioReuse(
  sha256: string,
  initialAudioHashes: Set<string>,
  newAudioHashes: Set<string>,
  reusedAudioHashes: Set<string>,
  onInternalReuse: () => void,
) {
  if (initialAudioHashes.has(sha256)) reusedAudioHashes.add(sha256);
  else if (newAudioHashes.has(sha256)) onInternalReuse();
}

function migrateLegacyPackageV1(legacySongs: LegacyPackageSongV1[]): { songs: PackageSong[]; tracks: PackageMediaTrack[] } {
  const tracks: PackageMediaTrack[] = [];
  const trackIdByAudioHash = new Map<string, string>();
  const ensureTrack = (ref: PackageAudioRef | undefined, createdAt: number, updatedAt: number) => {
    if (!ref) return undefined;
    const existing = trackIdByAudioHash.get(ref.sha256);
    if (existing) return existing;
    const id = createId('track');
    trackIdByAudioHash.set(ref.sha256, id);
    tracks.push({ id, name: ref.name || 'Аудиотрек', createdAt, updatedAt, audio: ref });
    return id;
  };
  const songs: PackageSong[] = legacySongs.map((song) => ({
    id: song.id,
    artist: song.artist,
    title: song.title,
    minusTrackId: ensureTrack(song.minus, song.createdAt, song.updatedAt),
    plusTrackId: ensureTrack(song.plus, song.createdAt, song.updatedAt),
    createdAt: song.createdAt,
    updatedAt: song.updatedAt,
  }));
  return { songs, tracks };
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
    if (!Number.isSafeInteger(totalSize) || totalSize > DATA_LIMITS.packageBytes) throw new Error('Суммарный размер архива превышает допустимый лимит 4 ГБ.');
  }
}

function parseJson<T>(value: string, name: string): T {
  try { return JSON.parse(value) as T; } catch { throw new Error(`Не удалось прочитать ${name}.`); }
}

function remapGameReferences(
  sourceGame: GameConfig,
  songIdMap: Map<string, string>,
  trackIdMap: Map<string, string>,
  gameId: string,
): GameConfig {
  return {
    ...sourceGame,
    id: gameId,
    rounds: sourceGame.rounds.map((round) => ({
      ...round,
      categories: round.categories.map((category) => ({
        ...category,
        questions: category.questions.map((question) => ({ ...question, songId: question.songId ? songIdMap.get(question.songId) : undefined })),
      })),
    })),
    interRounds: sourceGame.interRounds.map((interRound) => remapInterRoundTrackIds(interRound, (trackId) => trackIdMap.get(trackId))),
  };
}

function songFingerprint(artist: string, title: string, minusTrackId?: string, plusTrackId?: string) {
  return [normalizeText(artist), normalizeText(title), minusTrackId ?? '', plusTrackId ?? ''].join('|');
}

function trackFingerprint(name: string, audioHash: string) {
  return `${normalizeText(name)}|${audioHash}`;
}

function normalizeText(value: string) { return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU'); }

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
