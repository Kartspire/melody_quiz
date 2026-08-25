import type { GameSession } from '../types';

export type StorageSaveOutcome = 'idle' | 'saved' | 'error';
export type StorageSaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/** Only the exact snapshot confirmed by IndexedDB can be cleared. */
export function pendingAfterSuccessfulSave<T>(pending: T | null, saved: T): T | null {
  return pending === saved ? null : pending;
}

export function isStorageConflict(error: unknown): boolean {
  return error instanceof Error && error.name === 'StorageConflictError';
}

export function readOnlyAfterStorageFailure(current: boolean, error: unknown): boolean {
  return current || isStorageConflict(error);
}

export function deriveStorageSaveStatus({
  outcome,
  dirty,
  saving,
}: {
  outcome: StorageSaveOutcome;
  dirty: boolean;
  saving: boolean;
}): StorageSaveStatus {
  if (saving) return 'saving';
  if (outcome === 'error') return 'error';
  if (dirty) return 'dirty';
  return outcome;
}

export function sessionActivitySnapshot(sessions: Record<string, GameSession>) {
  return new Map(Object.values(sessions).map((session) => [session.gameId, session.updatedAt]));
}

export function hasSessionActivityChanged(previous: Map<string, number>, next: Map<string, number>) {
  if (previous.size !== next.size) return true;
  for (const [gameId, updatedAt] of next) {
    if (previous.get(gameId) !== updatedAt) return true;
  }
  return false;
}
