import assert from 'node:assert/strict';
import test from 'node:test';
import { candyCaption, candyMusicRate, candyScore, candySpawnDelay, candyTier } from './home-halloween-candy';

test('candy scoring, clamping and thief expiry follow the approved rules', () => {
  assert.equal(candyScore(0, 'ordinary'), 1);
  assert.equal(candyScore(2, 'gold'), 7);
  assert.equal(candyScore(2, 'cursed'), 0);
  assert.equal(candyScore(4, 'thief'), 4, 'caught thief changes no score');
  assert.equal(candyScore(1, 'thief', true), 0, 'missed thief steals two without going negative');
});

test('all four result boundaries and exact approved Thai copy remain stable', () => {
  assert.equal(candyTier(0).title, 'มาขอลูกอม หรือมาชมบ้าน?');
  assert.equal(candyTier(10).id, 'sad');
  assert.equal(candyTier(11).title, 'นักล่าลูกอมฝึกหัด');
  assert.equal(candyTier(25).id, 'trainee');
  assert.equal(candyTier(26).title, 'หวานจนผียังเรียกพี่');
  assert.equal(candyTier(40).id, 'sweet');
  assert.equal(candyTier(41).title, 'ราชาแห่งคืนปล่อยผี');
  assert.equal(candyCaption(26), 'ฉันเก็บลูกอมได้ 26 คะแนน\nหวานจนผียังเรียกพี่\nกล้าทำลายสถิติฉันไหม?\nhttps://mangmeeplus.com/halloween');
});

test('music and spawning accelerate at 20 and 5 seconds', () => {
  assert.equal(candySpawnDelay(0, 30), 720);
  assert.equal(candySpawnDelay(0, 21), 720);
  assert.equal(candySpawnDelay(0, 20), 540);
  assert.equal(candySpawnDelay(8, 20), 396);
  assert.equal(candySpawnDelay(99, 20), 300);
  assert.equal(candySpawnDelay(0, 6), 540);
  assert.equal(candySpawnDelay(0, 5), 190);
  assert.equal(candyMusicRate(21), 1);
  assert.equal(candyMusicRate(20), 1.15);
  assert.equal(candyMusicRate(6), 1.15);
  assert.equal(candyMusicRate(5), 1.3);
});
