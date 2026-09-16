// Billing operator dates use Bangkok time regardless of the device's timezone.
export function billingLocalTime(value: string | number | null) {
  if (value === null) return '';
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms + 7 * 3600000).toISOString().slice(0, 16) : '';
}
export function billingTimeIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}+07:00`);
  return Number.isFinite(ms) && billingLocalTime(ms) === value ? new Date(ms).toISOString() : null;
}
export function billingCompletedDays(days: number, now = Date.now()) {
  const today = billingLocalTime(now).slice(0, 10);
  const end = Date.parse(`${today}T00:00:00+07:00`);
  return { start: billingLocalTime(end - days * 86400000), end: billingLocalTime(end) };
}
