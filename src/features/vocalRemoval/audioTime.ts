export function formatAudioTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const totalTenths = Math.round(seconds * 10);
  const minutes = Math.floor(totalTenths / 600);
  const secondTenths = totalTenths % 600;
  if (secondTenths % 10 === 0) {
    return `${minutes}:${Math.floor(secondTenths / 10).toString().padStart(2, '0')}`;
  }
  return `${minutes}:${(secondTenths / 10).toFixed(1).padStart(4, '0')}`;
}

export function formatEditableTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0';
  const totalTenths = Math.round(seconds * 10);
  const minutes = Math.floor(totalTenths / 600);
  const secondTenths = totalTenths % 600;
  return `${minutes}:${(secondTenths / 10).toFixed(1).padStart(4, '0')}`;
}

export function parseAudioTime(value: string) {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const parts = normalized.split(':');
  if (parts.length > 2) return null;
  const seconds = Number(parts.at(-1));
  const minutes = parts.length === 2 ? Number(parts[0]) : 0;
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || minutes < 0 || seconds < 0 || (parts.length === 2 && seconds >= 60)) {
    return null;
  }
  return minutes * 60 + seconds;
}

export function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
