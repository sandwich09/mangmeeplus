import assert from 'node:assert/strict';
import test from 'node:test';
import { formatThaiDate, formatThaiDateTime, formatThaiMonth, formatThaiTime } from './thai-date';

test('formats dates with a short Thai month and Buddhist year', () => {
  assert.equal(formatThaiDate('2026-07-16T12:00:00+07:00'), '16 ก.ค. 2569');
});

test('date-time formatting keeps the shared Thai date format', () => {
  assert.match(formatThaiDateTime('2026-07-16T12:00:00+07:00'), /^16 ก\.ค\. 2569 /);
});

test('renders instants at the Bangkok day and month boundary regardless of browser timezone', () => {
  const instant = '2026-08-31T19:00:00.000Z';
  assert.equal(formatThaiDate(instant), '1 ก.ย. 2569');
  assert.equal(formatThaiDateTime(instant), '1 ก.ย. 2569 02:00 น.');
  assert.equal(formatThaiTime(instant), '02:00 น.');
  assert.equal(formatThaiMonth(instant), 'ก.ย. 2569');
});

test('uses the requested fallback for an empty value', () => {
  assert.equal(formatThaiDate(undefined, '-'), '-');
});

test('time-only formatting matches the time half of the date-time format', () => {
  assert.equal(formatThaiTime('2026-07-25T09:04:00.000Z'), '16:04 น.');
});

test('month formatting drops the day for period keys', () => {
  assert.equal(formatThaiMonth('2026-07'), 'ก.ค. 2569');
});
