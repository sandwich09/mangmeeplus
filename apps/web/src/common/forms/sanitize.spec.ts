import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findForbiddenChars, normalizeDecimalInput, REASON_MAX_LENGTH, sanitizeReasonInput, stripDisallowed } from './sanitize';

describe('decimal input normalization', () => {
  it('removes redundant leading zeros without rounding or changing decimal editing', () => {
    for (const [input, expected] of [
      ['0400', '400'], ['0007', '7'], ['00', '0'], ['000.402', '0.402'],
      ['', ''], ['0', '0'], ['0.', '0.'], ['0.402', '0.402'], ['0.0042', '0.0042'],
      ['4.00', '4.00'], ['00099999999999999.9999', '99999999999999.9999'],
      ['-1', '-1'], ['1e3', '1e3'], ['1.23456', '1.23456'],
    ]) assert.equal(normalizeDecimalInput(input!), expected, input);
  });
});

describe('expense text sanitization', () => {
  it('strips backslashes and control characters but keeps newlines', () => {
    assert.equal(stripDisallowed('ใบ\\เสร็จ\u0000\u0009\nบรรทัดสอง'), 'ใบเสร็จ\nบรรทัดสอง');
  });

  it('allows real-world Thai text and normal punctuation', () => {
    const value = 'บจก. เอ/บี (สาขา 1) & Co.';
    assert.equal(stripDisallowed(value), value);
    assert.deepEqual(findForbiddenChars(value), []);
  });

  it('finds each forbidden character once', () => {
    assert.deepEqual(findForbiddenChars('<script>{x}|^`<>'), ['<', '>', '{', '}', '|', '^', '`']);
  });

  it('returns empty results for empty input', () => {
    assert.equal(stripDisallowed(''), '');
    assert.deepEqual(findForbiddenChars(''), []);
  });
});

describe('reject and void reason sanitization', () => {
  it('keeps Thai, English, digits, spaces, and newlines', () => {
    const value = 'เหตุผลที่ ๐๑๒๓๔๕๖๗๘๙ Amount 456\nบรรทัดใหม่';
    assert.equal(sanitizeReasonInput(value), value);
  });

  it('keeps every allowlisted finance symbol', () => {
    const value = `. , - + / ( ) % # : ; ' " & @ _ = * ฿ $ € £ ¥`;
    assert.equal(sanitizeReasonInput(value), value);
  });

  it('strips backslashes, non-allowlisted symbols, emoji, and control characters', () => {
    assert.equal(sanitizeReasonInput('ab\\cd\\\\ef<>{}|^`😀\u0000\u0009\u000B\u001F\u007Fไทย'), 'abcdefไทย');
  });

  it('caps at 500 characters after stripping', () => {
    assert.equal(sanitizeReasonInput('a'.repeat(REASON_MAX_LENGTH + 1)).length, REASON_MAX_LENGTH);
    assert.equal(
      sanitizeReasonInput(`${'<'.repeat(REASON_MAX_LENGTH)}${'a'.repeat(REASON_MAX_LENGTH + 1)}`),
      'a'.repeat(REASON_MAX_LENGTH),
    );
  });
});
