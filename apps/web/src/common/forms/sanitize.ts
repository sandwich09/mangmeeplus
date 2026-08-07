export function stripDisallowed(value: string): string {
  return value.replace(/\\/g, '').replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '');
}

export function findForbiddenChars(value: string): string[] {
  return [...new Set(value.match(/[<>{}|^`]/g) ?? [])];
}

/**
 * Reject/void reasons: Thai and English letters, digits, whitespace, and common
 * finance/accounting punctuation only. Backslash and control characters are always
 * stripped (they are unsafe for downstream storage); everything else outside the
 * allowlist is dropped as it is typed. Hard cap 500 characters.
 */
export const REASON_MAX_LENGTH = 500;
const REASON_DISALLOWED = /[^฀-๿a-zA-Z0-9\s.,\-+/()%#:;'"&@_=*฿$€£¥]/g;

export function sanitizeReasonInput(value: string): string {
  return stripDisallowed(value).replace(REASON_DISALLOWED, '').slice(0, REASON_MAX_LENGTH);
}
