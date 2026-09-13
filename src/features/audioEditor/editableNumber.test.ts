import { describe, expect, it } from 'vitest';
import {
  clampEditableNumber,
  formatEditableNumber,
  isEditableDecimalDraft,
  parseEditableDecimal,
} from './editableNumber';

describe('editableNumber', () => {
  it('allows temporary empty and fractional drafts', () => {
    expect(isEditableDecimalDraft('')).toBe(true);
    expect(isEditableDecimalDraft('1.')).toBe(true);
    expect(isEditableDecimalDraft('1,')).toBe(true);
    expect(isEditableDecimalDraft('.5')).toBe(true);
    expect(isEditableDecimalDraft(',5')).toBe(true);
    expect(isEditableDecimalDraft('12.75')).toBe(true);
    expect(isEditableDecimalDraft('12,75')).toBe(true);
    expect(isEditableDecimalDraft('12a')).toBe(false);
  });

  it('parses both dot and comma decimals', () => {
    expect(parseEditableDecimal('1.25')).toBe(1.25);
    expect(parseEditableDecimal('1,25')).toBe(1.25);
    expect(parseEditableDecimal('.5')).toBe(0.5);
    expect(parseEditableDecimal(',5')).toBe(0.5);
    expect(parseEditableDecimal('')).toBeNull();
    expect(parseEditableDecimal('-')).toBeNull();
  });

  it('clamps only on commit and formats without trailing zeroes', () => {
    expect(clampEditableNumber(-1, 0, 4)).toBe(0);
    expect(clampEditableNumber(5, 0, 4)).toBe(4);
    expect(clampEditableNumber(1.275, 0, 4)).toBe(1.275);
    expect(formatEditableNumber(1.25)).toBe('1.25');
    expect(formatEditableNumber(0)).toBe('0');
  });
});
