const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const toHex = (bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

let queue = Promise.resolve();

self.onmessage = (event) => {
  const payload = event.data;
  queue = queue.then(() => processDigest(payload));
};

async function processDigest({ id, blob, includeCrc }) {
  try {
    if (!(blob instanceof Blob)) throw new Error('Hash worker получил некорректный Blob.');
    // Process requests sequentially so several large imports cannot allocate several
    // full-size ArrayBuffers in this worker at the same time.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    self.postMessage({
      id,
      sha256: toHex(new Uint8Array(digest)),
      crc32: includeCrc ? crc32(bytes) : undefined,
    });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
}
