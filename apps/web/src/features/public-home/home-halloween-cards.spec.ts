import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { GHOST_CARDS, getGhostCard, ghostCardForBucket, ghostShareUrl, SECRET_CARD_BACK, STANDARD_CARD_BACK } from './home-halloween-cards';

test('1000 equiprobable buckets give secret 1% and each ordinary card 4.5%, including boundaries', () => {
  const counts = new Map<string, number>();
  for (let bucket = 0; bucket < 1000; bucket++) {
    const id = ghostCardForBucket(bucket).id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  assert.equal(counts.size, 23);
  for (const card of GHOST_CARDS) assert.equal(counts.get(card.id), card.region === 'secret' ? 10 : 45);
  assert.equal(ghostCardForBucket(9).region, 'secret');
  assert.equal(ghostCardForBucket(10).id, '01-krasue');
  assert.equal(ghostCardForBucket(999).id, '22-cheonyeo-gwishin');
  for (const invalid of [-1, 1000, NaN, Infinity, 2.5]) assert.throws(() => ghostCardForBucket(invalid), RangeError);
});

test('the 23 approved cards, backs and public return URLs are valid and allowlisted', () => {
  assert.equal(GHOST_CARDS.length, 23);
  assert.equal(new Set(GHOST_CARDS.map(card => card.id)).size, 23);
  for (const asset of [...GHOST_CARDS.map(card => card.image), STANDARD_CARD_BACK, SECRET_CARD_BACK]) {
    assert.ok(existsSync(new URL(`../../../public${asset}`, import.meta.url)), asset);
  }
  for (const card of GHOST_CARDS) assert.equal(ghostShareUrl(card), `https://mangmeeplus.com/halloween/${card.id}`);
  for (const invalid of [undefined, '', '__proto__', 'toString', '../secret', '<script>']) assert.equal(getGhostCard(invalid), undefined);
  assert.throws(() => ghostShareUrl({ ...GHOST_CARDS[0], id: '../secret' }), RangeError);
});

test('approved replacements use their character effects and removed cards cannot resolve', () => {
  for (const [id, region] of Object.entries({
    '14-pancake': 'thai', '15-payoon': 'thai', '16-the-nun': 'western',
    '17-turbo-granny': 'japanese', '18-taew': 'thai',
  })) {
    const card = getGhostCard(id);
    assert.equal(card?.region, region, id);
    assert.equal(card?.image, `/home/events/halloween/cards/${id}.png`);
  }
  for (const id of ['14-sadako', '15-yuki-onna', '16-nine-tailed-fox', '18-kappa']) {
    assert.equal(getGhostCard(id), undefined, id);
  }
  assert.deepEqual(getGhostCard('16-the-nun')?.quote, ['สวดมนต์ไม่ถนัด', 'สวดคนอื่นจัดให้', 'สาดไปสมาชิก']);
  assert.equal(getGhostCard('21-chonggak-gwishin')?.quote.length, 3);
  assert.deepEqual(getGhostCard('22-cheonyeo-gwishin')?.quote, ['รอมนุษย์คนแรกเท่านั้น']);
  for (const card of GHOST_CARDS) {
    assert.ok(card.quote.length >= 1 && card.quote.length <= 3, card.id);
    assert.ok(card.quote.every(line => line.length > 0 && !line.includes('\n')), card.id);
  }
});
