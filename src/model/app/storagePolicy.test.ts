import { describe, expect, it } from 'vitest';
import { createGame, createSession } from '../defaults';
import {
  deriveStorageSaveStatus,
  hasSessionActivityChanged,
  pendingAfterSuccessfulSave,
  readOnlyAfterStorageFailure,
  sessionActivitySnapshot,
} from './storagePolicy';

describe('storage persistence policy', () => {
  it('does not clear a newer pending snapshot when an older save completes', () => {
    const oldSnapshot = { id: 'old' };
    const latestSnapshot = { id: 'latest' };

    expect(pendingAfterSuccessfulSave(oldSnapshot, oldSnapshot)).toBeNull();
    expect(pendingAfterSuccessfulSave(latestSnapshot, oldSnapshot)).toBe(latestSnapshot);
  });

  it('enters read-only mode only for storage conflicts', () => {
    const conflict = Object.assign(new Error('conflict'), { name: 'StorageConflictError' });
    expect(readOnlyAfterStorageFailure(false, conflict)).toBe(true);
    expect(readOnlyAfterStorageFailure(false, new Error('quota exceeded'))).toBe(false);
    expect(readOnlyAfterStorageFailure(true, new Error('another error'))).toBe(true);
  });

  it('keeps save status priority deterministic', () => {
    expect(deriveStorageSaveStatus({ outcome: 'error', dirty: true, saving: true })).toBe('saving');
    expect(deriveStorageSaveStatus({ outcome: 'error', dirty: true, saving: false })).toBe('error');
    expect(deriveStorageSaveStatus({ outcome: 'idle', dirty: true, saving: false })).toBe('dirty');
    expect(deriveStorageSaveStatus({ outcome: 'saved', dirty: false, saving: false })).toBe('saved');
  });

  it('detects only meaningful session activity changes', () => {
    const game = createGame('Policy test');
    const session = createSession(game);
    const previous = sessionActivitySnapshot({ [game.id]: session });
    const same = sessionActivitySnapshot({ [game.id]: { ...session } });
    const changed = sessionActivitySnapshot({ [game.id]: { ...session, updatedAt: session.updatedAt + 1 } });

    expect(hasSessionActivityChanged(previous, same)).toBe(false);
    expect(hasSessionActivityChanged(previous, changed)).toBe(true);
    expect(hasSessionActivityChanged(previous, new Map())).toBe(true);
  });
});
