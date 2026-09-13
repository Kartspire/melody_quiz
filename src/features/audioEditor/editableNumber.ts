export function isEditableDecimalDraft(value: string) {
  return /^-?(?:\d+(?:[.,]\d*)?|[.,]\d*)?$/.test(value);
}

export function parseEditableDecimal(value: string) {
  const normalized = value.trim().replace(',', '.');
  if (!normalized || normalized === '-' || normalized === '.' || normalized === '-.') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function clampEditableNumber(value: number, min?: number, max?: number) {
  return Math.max(min ?? -Infinity, Math.min(max ?? Infinity, value));
}

export function formatEditableNumber(value: number, digits = 3) {
  if (!Number.isFinite(value)) return '';
  const factor = 10 ** digits;
  return String(Math.round(value * factor) / factor);
}
