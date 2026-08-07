import assert from 'node:assert/strict';
import test from 'node:test';
import { formatThaiDate, formatThaiDateTime, formatThaiMonth, formatThaiTime } from './thai-date';

test('formats dates with a short Thai month and Buddhist year', () => {
  assert.equal(formatThaiDate('2026-07-16T12:00:00+07:00'), '16 ก.ค. 2569');
});

test('date-time formatting keeps the shared Thai date format', () => {
  assert.match(formatThaiDateTime('2026-07-16T12:00:00+07:00'), /^16 ก\.ค\. 2569 /);
});

test('uses the requested fallback for an empty value', () => {
  assert.equal(formatThaiDate(undefined, '-'), '-');
});

// Local-time Date literals keep these assertions independent of the runner's timezone.
test('time-only formatting matches the time half of the date-time format', () => {
  assert.equal(formatThaiTime(new Date(2026, 6, 25, 16, 4)), '16:04 น.');
});

test('month formatting drops the day for period keys', () => {
  assert.equal(formatThaiMonth(new Date(2026, 6, 1)), 'ก.ค. 2569');
});
