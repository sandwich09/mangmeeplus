import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEscapePenalty, ESCAPE_COLORS, ESCAPE_RUNES, escapeAudioPressure, escapeCaption, escapeElapsedSeconds, escapeTier, makeEscapeRound } from './home-halloween-escape';

function seededRandom(seed = 20261030) {
  return () => ((seed = seed * 1664525 + 1013904223 >>> 0) / 2 ** 32);
}

test('every escape round has one haunted portrait, three candles and one matching shuffled key', () => {
  const random = seededRandom();
  for (let run = 0; run < 50; run++) {
    const round = makeEscapeRound(random);
    assert.ok(round.portraitIndex >= 0 && round.portraitIndex < 6);
    assert.equal(round.candleSequence.length, 3);
    assert.equal(round.clueColor, round.candleSequence[2]);
    assert.equal(new Set(round.keys.map(key => key.id)).size, 3);
    assert.equal(round.keys.filter(key => key.id === round.correctKeyId).length, 1);
    const answer = round.keys.find(key => key.id === round.correctKeyId);
    assert.equal(answer?.rune, round.rune);
    assert.equal(answer?.color, round.clueColor);
  }
});

test('escape outcomes use the approved inclusive time boundaries and caption', () => {
  assert.equal(applyEscapePenalty(60_000), 55_000);
  assert.equal(escapeTier(false, 0).title, 'สมาชิกใหม่ของคฤหาสน์');
  assert.equal(escapeTier(true, 10).id, 'narrow');
  assert.equal(escapeTier(true, 11).id, 'solver');
  assert.equal(escapeTier(true, 30).id, 'solver');
  assert.equal(escapeTier(true, 31).title, 'ผู้พิชิตคฤหาสน์ไร้ทางออก');
  assert.equal(escapeElapsedSeconds(44), 16);
  assert.equal(escapeCaption(true, 44), 'ฉันหนีออกมาได้ใน 16 วินาที\nผู้พิชิตคฤหาสน์ไร้ทางออก\nกล้าเข้าคฤหาสน์นี้ไหม?\nhttps://mangmeeplus.com/halloween');
});

test('escape clues and final audio pressure use the approved boundaries', () => {
  assert.deepEqual(Object.values(ESCAPE_RUNES).map(rune => rune.label), ['จันทร์เสี้ยว', 'ดาว', 'พระอาทิตย์']);
  assert.deepEqual(Object.values(ESCAPE_COLORS).map(color => color.label), ['สีส้ม', 'สีม่วง', 'สีเขียว']);
  assert.deepEqual(escapeAudioPressure(16), { rate: 1, gain: .045, tick: false });
  assert.deepEqual(escapeAudioPressure(15), { rate: 1.18, gain: .055, tick: false });
  assert.deepEqual(escapeAudioPressure(6), { rate: 1.18, gain: .055, tick: false });
  assert.deepEqual(escapeAudioPressure(5), { rate: 1.42, gain: .065, tick: true });
  assert.deepEqual(escapeAudioPressure(0), { rate: 1.42, gain: .065, tick: false });
});
