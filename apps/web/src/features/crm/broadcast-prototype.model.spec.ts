import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BROADCAST_COLOR_TONES,
  BROADCAST_TONES,
  PAST_CAMPAIGNS,
  genBroadcast,
  getSegmentCount,
  getSegmentLabel,
} from './broadcast-prototype.model';

describe('broadcast prototype model', () => {
  it('counts recipients per segment from the shared customer dataset', () => {
    assert.equal(getSegmentCount('all'), 14);
    assert.equal(getSegmentCount('vip'), 1);
    assert.equal(getSegmentCount('active'), 7);
    assert.equal(getSegmentCount('lead'), 6);
    assert.equal(getSegmentLabel('lead'), 'ลูกค้าใหม่');
  });

  it('always generates 3 options per tone, deterministically', () => {
    for (const tone of BROADCAST_TONES) {
      const options = genBroadcast('โปร A', '990 บาท', 'ติดทน', tone.id);
      assert.equal(options.length, 3);
      assert.deepEqual(options, genBroadcast('โปร A', '990 บาท', 'ติดทน', tone.id));
    }
  });

  it('weaves topic, price, and key point into the friendly tone', () => {
    const [first] = genBroadcast('โปรต่อขนตา Volume ลด 20%', '1,990 บาท', 'ติดทน 6 สัปดาห์', 'friendly');
    assert.equal(first!.headline, 'สวัสดีค่ะ · โปรต่อขนตา Volume ลด 20%');
    assert.equal(
      first!.body,
      'ทางร้านมี โปรต่อขนตา Volume ลด 20% มาฝากค่ะ 😊 ติดทน 6 สัปดาห์ เพียง 1,990 บาท สนใจทักมาจองคิวได้เลยนะคะ เดี๋ยวจัดเวลาสวยๆ ให้ค่ะ 💚',
    );
  });

  it('falls back to the default key point and drops the price fragment when blank', () => {
    const [first] = genBroadcast('โปร A', ' ', '', 'concise');
    assert.equal(first!.body, 'โปร A · บริการต่อขนตาสวยเป็นธรรมชาติ ติดทน · ทักจองเลย');
    const [fun] = genBroadcast('โปร A', '', '', 'fun');
    assert.equal(fun!.headline, 'โปร A มาแล้ว! 🎉');
    assert.ok(!fun!.body.includes('เพียง'));
  });

  it('keeps the fixed past-campaign rows and 5 poster gradients from the design', () => {
    assert.deepEqual(
      PAST_CAMPAIGNS.map((c) => [c.name, c.seg, c.date, c.reach, c.open]),
      [
        ['โปรต่อขนตา ลด 15%', 'ลูกค้าทั้งหมด', '2 วันก่อน', '248', '71%'],
        ['ชวน VIP เติมคอร์ส', 'VIP', '1 สัปดาห์ก่อน', '12', '92%'],
        ['ทักลูกค้าใหม่ครั้งแรก', 'ลูกค้าใหม่', '2 สัปดาห์ก่อน', '53', '64%'],
      ],
    );
    assert.equal(BROADCAST_COLOR_TONES.length, 5);
    assert.equal(BROADCAST_COLOR_TONES[4]!.grad, 'linear-gradient(135deg,#111827,#1F2937 55%,#B45309)');
  });
});
