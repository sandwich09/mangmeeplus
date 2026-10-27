import assert from 'node:assert/strict';
import test from 'node:test';
import { countdownParts, formatCountdown, HALLOWEEN_GAME_DEADLINES } from './home-halloween-countdown';

test('fixed Bangkok deadlines resolve to the same UTC instant for every visitor', () => {
  assert.equal(HALLOWEEN_GAME_DEADLINES.candy, Date.UTC(2026, 9, 28, 17));
  assert.equal(HALLOWEEN_GAME_DEADLINES.escape, Date.UTC(2026, 9, 29, 17));
});

test('each door counts down independently and hides its numbers at and after its deadline', () => {
  const candy = HALLOWEEN_GAME_DEADLINES.candy;
  const escape = HALLOWEEN_GAME_DEADLINES.escape;
  assert.deepEqual(countdownParts(candy, candy - 1000), { days: 0, hours: 0, minutes: 0, seconds: 1 });
  assert.deepEqual(countdownParts(escape, candy), { days: 1, hours: 0, minutes: 0, seconds: 0 });
  assert.equal(countdownParts(candy, candy), null);
  assert.equal(countdownParts(candy, candy + 1000), null);
  assert.deepEqual(countdownParts(escape, escape - 1000), { days: 0, hours: 0, minutes: 0, seconds: 1 });
  assert.equal(countdownParts(escape, escape), null);
});

test('countdown text shows days and zero-padded HH:MM:SS', () => {
  assert.equal(formatCountdown({ days: 1, hours: 2, minutes: 3, seconds: 4 }), '1 วัน 02:03:04');
  assert.equal(formatCountdown({ days: 0, hours: 0, minutes: 0, seconds: 1 }), '0 วัน 00:00:01');
});
