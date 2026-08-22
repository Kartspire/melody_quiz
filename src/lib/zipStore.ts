export type ZipInput = {
  name: string;
  data: Blob;
  crc32?: number;
};

export type ZipEntry = {
  name: string;
  blob: Blob;
  crc32: number;
  size: number;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const MAX_UINT32 = 0xffffffff;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

export const crc32Blob = async (blob: Blob) => crc32(new Uint8Array(await blob.arrayBuffer()));

const dosDateTime = (date = new Date()) => {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
};

const makeView = (size: number) => {
  const buffer = new ArrayBuffer(size);
  return { buffer, view: new DataView(buffer) };
};

export async function createStoredZip(inputs: ZipInput[]): Promise<Blob> {
  const localParts: BlobPart[] = [];
  const centralParts: BlobPart[] = [];
  let localOffset = 0;
  let centralSize = 0;
  const { dosTime, dosDate } = dosDateTime();

  if (inputs.length > 0xffff) throw new Error('Слишком много файлов для ZIP без ZIP64.');
  const inputNames = new Set<string>();

  for (const input of inputs) {
    if (!input.name || input.name.includes('\u0000')) throw new Error('ZIP содержит файл с некорректным именем.');
    if (inputNames.has(input.name)) throw new Error(`Файл «${input.name}» повторяется в ZIP-архиве.`);
    inputNames.add(input.name);
    if (input.data.size > MAX_UINT32) throw new Error(`Файл «${input.name}» превышает лимит 4 ГБ.`);
    if (localOffset > MAX_UINT32) throw new Error('Архив превышает лимит ZIP32 (4 ГБ).');

    const nameBytes = textEncoder.encode(input.name);
    if (nameBytes.length > 0xffff) throw new Error(`Имя файла «${input.name}» слишком длинное для ZIP.`);
    const checksum = input.crc32 ?? await crc32Blob(input.data);
    const size = input.data.size;

    const local = makeView(30);
    let offset = 0;
    local.view.setUint32(offset, 0x04034b50, true); offset += 4;
    local.view.setUint16(offset, 20, true); offset += 2;
    local.view.setUint16(offset, 0x0800, true); offset += 2;
    local.view.setUint16(offset, 0, true); offset += 2;
    local.view.setUint16(offset, dosTime, true); offset += 2;
    local.view.setUint16(offset, dosDate, true); offset += 2;
    local.view.setUint32(offset, checksum, true); offset += 4;
    local.view.setUint32(offset, size, true); offset += 4;
    local.view.setUint32(offset, size, true); offset += 4;
    local.view.setUint16(offset, nameBytes.length, true); offset += 2;
    local.view.setUint16(offset, 0, true);

    localParts.push(local.buffer, nameBytes, input.data);

    const central = makeView(46);
    offset = 0;
    central.view.setUint32(offset, 0x02014b50, true); offset += 4;
    central.view.setUint16(offset, 20, true); offset += 2;
    central.view.setUint16(offset, 20, true); offset += 2;
    central.view.setUint16(offset, 0x0800, true); offset += 2;
    central.view.setUint16(offset, 0, true); offset += 2;
    central.view.setUint16(offset, dosTime, true); offset += 2;
    central.view.setUint16(offset, dosDate, true); offset += 2;
    central.view.setUint32(offset, checksum, true); offset += 4;
    central.view.setUint32(offset, size, true); offset += 4;
    central.view.setUint32(offset, size, true); offset += 4;
    central.view.setUint16(offset, nameBytes.length, true); offset += 2;
    central.view.setUint16(offset, 0, true); offset += 2;
    central.view.setUint16(offset, 0, true); offset += 2;
    central.view.setUint16(offset, 0, true); offset += 2;
    central.view.setUint16(offset, 0, true); offset += 2;
    central.view.setUint32(offset, 0, true); offset += 4;
    central.view.setUint32(offset, localOffset, true);

    centralParts.push(central.buffer, nameBytes);
    const localLength = 30 + nameBytes.length + size;
    const centralLength = 46 + nameBytes.length;
    localOffset += localLength;
    centralSize += centralLength;
  }

  if (localOffset > MAX_UINT32 || centralSize > MAX_UINT32) throw new Error('Архив превышает лимит ZIP32 (4 ГБ).');

  const eocd = makeView(22);
  let offset = 0;
  eocd.view.setUint32(offset, 0x06054b50, true); offset += 4;
  eocd.view.setUint16(offset, 0, true); offset += 2;
  eocd.view.setUint16(offset, 0, true); offset += 2;
  eocd.view.setUint16(offset, inputs.length, true); offset += 2;
  eocd.view.setUint16(offset, inputs.length, true); offset += 2;
  eocd.view.setUint32(offset, centralSize, true); offset += 4;
  eocd.view.setUint32(offset, localOffset, true); offset += 4;
  eocd.view.setUint16(offset, 0, true);

  return new Blob([...localParts, ...centralParts, eocd.buffer], { type: 'application/zip' });
}

export async function readStoredZip(file: Blob): Promise<Map<string, ZipEntry>> {
  if (file.size < 22) throw new Error('Файл слишком маленький и не является ZIP-архивом.');
  if (file.size > MAX_UINT32) throw new Error('ZIP64 и архивы больше 4 ГБ не поддерживаются.');

  const tailSize = Math.min(file.size, 65_557);
  const tailOffset = file.size - tailSize;
  const tail = new Uint8Array(await file.slice(tailOffset).arrayBuffer());
  let eocdIndex = -1;
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (tail[index] === 0x50 && tail[index + 1] === 0x4b && tail[index + 2] === 0x05 && tail[index + 3] === 0x06) {
      eocdIndex = index;
      break;
    }
  }
  if (eocdIndex < 0) throw new Error('Не найден конец ZIP-архива.');
  if (eocdIndex + 22 > tail.length) throw new Error('Повреждён конец ZIP-архива.');

  const eocdView = new DataView(tail.buffer, tail.byteOffset + eocdIndex, tail.length - eocdIndex);
  const diskNumber = eocdView.getUint16(4, true);
  const centralDisk = eocdView.getUint16(6, true);
  const diskEntries = eocdView.getUint16(8, true);
  const entryCount = eocdView.getUint16(10, true);
  const centralSize = eocdView.getUint32(12, true);
  const centralOffset = eocdView.getUint32(16, true);
  const commentLength = eocdView.getUint16(20, true);
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== entryCount) throw new Error('Многотомные ZIP-архивы не поддерживаются.');
  if (entryCount === 0xffff || centralSize === MAX_UINT32 || centralOffset === MAX_UINT32) throw new Error('ZIP64 не поддерживается.');
  if (eocdIndex + 22 + commentLength !== tail.length) throw new Error('Повреждён комментарий ZIP-архива.');
  if (centralOffset + centralSize > file.size) throw new Error('Центральный каталог ZIP выходит за границы файла.');
  if (centralOffset + centralSize > tailOffset + eocdIndex) throw new Error('Центральный каталог ZIP пересекается с концом архива.');

  const centralBytes = new Uint8Array(await file.slice(centralOffset, centralOffset + centralSize).arrayBuffer());
  if (centralBytes.byteLength !== centralSize) throw new Error('Не удалось полностью прочитать центральный каталог ZIP.');
  const centralView = new DataView(centralBytes.buffer, centralBytes.byteOffset, centralBytes.byteLength);
  const entries = new Map<string, ZipEntry>();
  let cursor = 0;

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    ensureRange(cursor, 46, centralBytes.length, 'Повреждён центральный каталог ZIP.');
    if (centralView.getUint32(cursor, true) !== 0x02014b50) throw new Error('Повреждён центральный каталог ZIP.');
    const flags = centralView.getUint16(cursor + 8, true);
    const compression = centralView.getUint16(cursor + 10, true);
    const checksum = centralView.getUint32(cursor + 16, true);
    const compressedSize = centralView.getUint32(cursor + 20, true);
    const uncompressedSize = centralView.getUint32(cursor + 24, true);
    const nameLength = centralView.getUint16(cursor + 28, true);
    const extraLength = centralView.getUint16(cursor + 30, true);
    const entryCommentLength = centralView.getUint16(cursor + 32, true);
    const diskStart = centralView.getUint16(cursor + 34, true);
    const localHeaderOffset = centralView.getUint32(cursor + 42, true);
    const recordLength = 46 + nameLength + extraLength + entryCommentLength;
    ensureRange(cursor, recordLength, centralBytes.length, 'Повреждена запись центрального каталога ZIP.');

    const nameBytes = centralBytes.slice(cursor + 46, cursor + 46 + nameLength);
    const name = textDecoder.decode(nameBytes);
    if (!name || name.includes('\u0000')) throw new Error('ZIP содержит файл с некорректным именем.');
    if (entries.has(name)) throw new Error(`Файл «${name}» повторяется в ZIP-архиве.`);
    if (diskStart !== 0) throw new Error('Многотомные ZIP-архивы не поддерживаются.');
    if ((flags & 0x0001) !== 0) throw new Error(`Файл «${name}» зашифрован и не поддерживается.`);
    if ((flags & 0x0008) !== 0) throw new Error(`Файл «${name}» использует неподдерживаемый data descriptor.`);
    if (compression !== 0) throw new Error(`Файл «${name}» использует неподдерживаемое ZIP-сжатие.`);
    if (compressedSize === MAX_UINT32 || uncompressedSize === MAX_UINT32 || localHeaderOffset === MAX_UINT32) throw new Error('ZIP64 не поддерживается.');
    if (compressedSize !== uncompressedSize) throw new Error(`Некорректный размер файла «${name}».`);
    if (localHeaderOffset + 30 > centralOffset) throw new Error(`Локальный заголовок «${name}» выходит за границы данных ZIP.`);

    const localHeaderBytes = new Uint8Array(await file.slice(localHeaderOffset, localHeaderOffset + 30).arrayBuffer());
    if (localHeaderBytes.byteLength !== 30) throw new Error(`Повреждён локальный заголовок «${name}».`);
    const localHeader = new DataView(localHeaderBytes.buffer, localHeaderBytes.byteOffset, localHeaderBytes.byteLength);
    if (localHeader.getUint32(0, true) !== 0x04034b50) throw new Error(`Повреждён локальный заголовок «${name}».`);
    const localFlags = localHeader.getUint16(6, true);
    const localCompression = localHeader.getUint16(8, true);
    const localChecksum = localHeader.getUint32(14, true);
    const localCompressedSize = localHeader.getUint32(18, true);
    const localUncompressedSize = localHeader.getUint32(22, true);
    const localNameLength = localHeader.getUint16(26, true);
    const localExtraLength = localHeader.getUint16(28, true);
    if (localFlags !== flags || localCompression !== compression || localChecksum !== checksum || localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize) {
      throw new Error(`Локальный заголовок «${name}» не совпадает с центральным каталогом.`);
    }

    const localNameStart = localHeaderOffset + 30;
    const dataStart = localNameStart + localNameLength + localExtraLength;
    const dataEnd = dataStart + uncompressedSize;
    if (dataStart > centralOffset || dataEnd > centralOffset || dataEnd > file.size) throw new Error(`Данные файла «${name}» выходят за границы ZIP.`);
    const localNameBytes = new Uint8Array(await file.slice(localNameStart, localNameStart + localNameLength).arrayBuffer());
    if (textDecoder.decode(localNameBytes) !== name) throw new Error(`Имя файла «${name}» не совпадает в заголовках ZIP.`);

    const blob = file.slice(dataStart, dataEnd);
    if (blob.size !== uncompressedSize) throw new Error(`Не удалось полностью прочитать файл «${name}».`);
    entries.set(name, { name, blob, crc32: checksum, size: uncompressedSize });
    cursor += recordLength;
  }

  if (cursor !== centralBytes.length) throw new Error('Центральный каталог ZIP содержит лишние или повреждённые данные.');
  return entries;
}

function ensureRange(offset: number, length: number, total: number, message: string) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > total) {
    throw new Error(message);
  }
}
