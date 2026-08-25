import { describe, expect, it } from 'vitest';
import { createStoredZip, readStoredZip } from './zipStore';

describe('stored ZIP', () => {
  it('round-trips stored files', async () => {
    const zip = await createStoredZip([
      { name: 'a.txt', data: new Blob(['alpha']) },
      { name: 'nested/b.txt', data: new Blob(['beta']) },
    ]);
    const entries = await readStoredZip(zip);
    expect(await entries.get('a.txt')?.blob.text()).toBe('alpha');
    expect(await entries.get('nested/b.txt')?.blob.text()).toBe('beta');
  });

  it('rejects duplicate file names when creating an archive', async () => {
    await expect(createStoredZip([
      { name: 'a.txt', data: new Blob(['one']) },
      { name: 'a.txt', data: new Blob(['two']) },
    ])).rejects.toThrow(/повторяется/i);
  });

  it('rejects a damaged central directory', async () => {
    const zip = await createStoredZip([{ name: 'a.txt', data: new Blob(['alpha']) }]);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    const centralSignature = [0x50, 0x4b, 0x01, 0x02];
    const index = bytes.findIndex((_value, offset) => centralSignature.every((part, i) => bytes[offset + i] === part));
    expect(index).toBeGreaterThanOrEqual(0);
    bytes[index] = 0;
    await expect(readStoredZip(new Blob([bytes]))).rejects.toThrow(/централь/i);
  });
});
