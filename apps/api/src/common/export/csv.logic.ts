/** Neutralize spreadsheet formulas before RFC-4180-style CSV quoting. */
export function safeCsvCell(value: unknown): string {
  const raw = value == null ? '' : String(value);
  const guarded = /^(?:\uFEFF|\s)*[=+\-@]/u.test(raw) || /^[\t\r\n]/u.test(raw) ? `'${raw}` : raw;
  const escaped = guarded.replace(/"/g, '""');
  return /[",\n\r\t]/u.test(escaped) ? `"${escaped}"` : escaped;
}
