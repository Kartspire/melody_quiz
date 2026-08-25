/**
 * Serializes asynchronous persistence writes without poisoning the queue when one write fails.
 * Each caller still receives its own rejection, while later writes continue in order.
 */
export function createSerializedSaveQueue<T>(write: (snapshot: T) => Promise<void>) {
  let queue: Promise<void> = Promise.resolve();

  return (snapshot: T): Promise<void> => {
    const task = queue.then(() => write(snapshot));
    queue = task.catch(() => undefined);
    return task;
  };
}
