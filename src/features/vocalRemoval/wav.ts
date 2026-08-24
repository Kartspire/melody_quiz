const WAV_HEADER_BYTES = 44;
const PCM16_MAX = 0x7fff;
const PCM16_MIN = -0x8000;

export function encodeStereoWav(left: Float32Array, right: Float32Array, sampleRate: number): Blob {
  const sampleCount = Math.min(left.length, right.length);
  const bytesPerSample = 2;
  const channelCount = 2;
  const dataBytes = sampleCount * channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = WAV_HEADER_BYTES;
  for (let index = 0; index < sampleCount; index += 1) {
    view.setInt16(offset, toPcm16(left[index]), true);
    view.setInt16(offset + 2, toPcm16(right[index]), true);
    offset += 4;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function toPcm16(value: number) {
  const normalized = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
  return normalized < 0
    ? Math.round(normalized * -PCM16_MIN)
    : Math.round(normalized * PCM16_MAX);
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
