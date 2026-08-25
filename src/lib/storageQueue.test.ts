import { describe, expect, it } from 'vitest';
import { createSerializedSaveQueue } from './storageQueue';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createSerializedSaveQueue', () => {
  it('executes concurrent writes strictly in order', async () => {
    const first = deferred();
    const calls: string[] = [];
    const enqueue = createSerializedSaveQueue<string>(async (snapshot) => {
      calls.push(`start:${snapshot}`);
      if (snapshot === 'first') await first.promise;
      calls.push(`finish:${snapshot}`);
    });

    const firstTask = enqueue('first');
    const secondTask = enqueue('second');
    await Promise.resolve();

    expect(calls).toEqual(['start:first']);
    first.resolve();
    await firstTask;
    await secondTask;

    expect(calls).toEqual(['start:first', 'finish:first', 'start:second', 'finish:second']);
  });

  it('continues with the next write after a failed write', async () => {
    const calls: string[] = [];
    const enqueue = createSerializedSaveQueue<string>(async (snapshot) => {
      calls.push(snapshot);
      if (snapshot === 'broken') throw new Error('quota exceeded');
    });

    await expect(enqueue('broken')).rejects.toThrow('quota exceeded');
    await expect(enqueue('latest')).resolves.toBeUndefined();
    expect(calls).toEqual(['broken', 'latest']);
  });

  it('passes immutable snapshot references through without cloning them', async () => {
    const snapshot = { version: 1 };
    let received: typeof snapshot | null = null;
    const enqueue = createSerializedSaveQueue<typeof snapshot>(async (value) => {
      received = value;
    });

    await enqueue(snapshot);
    expect(received).toBe(snapshot);
  });
});
