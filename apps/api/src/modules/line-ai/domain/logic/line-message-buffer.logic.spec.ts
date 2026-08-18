import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bufferAtCapacity,
  fittingPrefixCount,
  joinGroupText,
  joinedTextLength,
  lineWaitStatusText,
  nextFlushDelayMs,
  segmentBatch,
  sortBatchItems,
  LINE_BUFFER_MAX_ITEMS,
  LINE_BUFFER_MAX_TEXT_CHARS,
} from './line-message-buffer.logic';
import type { LineBufferItem, LineBufferTextItem, LineBufferMediaItem } from './line-message-buffer.logic';

let seq = 0;
function text(id: string, body: string, opts: { kind?: 'text' | 'command'; timestamp?: number } = {}): LineBufferTextItem {
  seq += 1;
  return { kind: opts.kind ?? 'text', webhookEventId: id, replyToken: `rt-${id}`, text: body, timestamp: opts.timestamp ?? seq, seq };
}
function media(id: string, opts: { timestamp?: number } = {}): LineBufferMediaItem {
  seq += 1;
  return { kind: 'media', webhookEventId: id, replyToken: `rt-${id}`, lineMessageId: `mid-${id}`, messageType: 'image', timestamp: opts.timestamp ?? seq, seq };
}

describe('segmentBatch', () => {
  it('joins consecutive text into one group', () => {
    const groups = segmentBatch([text('a', 'ขอ'), text('b', 'รายชื่อ'), text('c', 'ลูกค้า')]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].kind, 'text');
    assert.equal(joinGroupText((groups[0] as any).textItems), 'ขอ\nรายชื่อ\nลูกค้า');
  });

  it('commands are their own group and split content around them', () => {
    const groups = segmentBatch([
      text('a', 'ขอรายชื่อลูกค้า'),
      text('b', '/company 2', { kind: 'command' }),
      text('c', 'ยอดขายเดือนนี้'),
    ]);
    assert.equal(groups.length, 3);
    assert.deepEqual(groups.map((g) => g.kind), ['text', 'command', 'text']);
    assert.equal((groups[1] as any).item.webhookEventId, 'b');
  });

  it('media absorbs surrounding text of the same content group as caption source', () => {
    const groups = segmentBatch([text('a', 'บันทึกค่าใช้จ่าย'), media('m1'), media('m2'), text('b', 'ร้านกาแฟ')]);
    assert.equal(groups.length, 1);
    const group = groups[0] as any;
    assert.equal(group.kind, 'media');
    assert.equal(group.mediaItems.length, 2);
    assert.equal(joinGroupText(group.textItems), 'บันทึกค่าใช้จ่าย\nร้านกาแฟ');
  });

  it('command between text and media separates the caption scope', () => {
    const groups = segmentBatch([text('a', 'ยอดขาย'), text('b', '/companies', { kind: 'command' }), media('m1')]);
    assert.deepEqual(groups.map((g) => g.kind), ['text', 'command', 'media']);
    assert.equal((groups[2] as any).textItems.length, 0);
  });

  it('handles media-only and empty batches', () => {
    assert.equal(segmentBatch([media('m1')])[0].kind, 'media');
    assert.deepEqual(segmentBatch([]), []);
  });
});

describe('sortBatchItems', () => {
  it('orders by LINE timestamp then arrival seq', () => {
    const a = text('a', 'สอง', { timestamp: 200 });
    const b = text('b', 'หนึ่ง', { timestamp: 100 });
    const c = text('c', 'สาม', { timestamp: 200 });
    // c arrived after a; same timestamp → arrival order wins the tie.
    const sorted = sortBatchItems([a, b, c]);
    assert.deepEqual(sorted.map((i) => i.webhookEventId), ['b', 'a', 'c']);
  });
});

describe('nextFlushDelayMs', () => {
  const timing = { debounceMs: 2500, maxWaitMs: 8000 };
  it('uses the debounce window while max wait is far away', () => {
    assert.equal(nextFlushDelayMs(10_000, 10_000, timing), 2500);
  });
  it('caps at the remaining max wait anchored to the FIRST item', () => {
    assert.equal(nextFlushDelayMs(10_000, 17_000, timing), 1000);
  });
  it('returns 0 once max wait has elapsed', () => {
    assert.equal(nextFlushDelayMs(10_000, 19_000, timing), 0);
  });
});

describe('capacity rules', () => {
  it('caps by item count', () => {
    const items: LineBufferItem[] = [];
    for (let i = 0; i < LINE_BUFFER_MAX_ITEMS - 1; i++) items.push(text(`t${i}`, 'x'));
    assert.equal(bufferAtCapacity(items), false);
    items.push(text('last', 'x'));
    assert.equal(bufferAtCapacity(items), true);
  });

  it('caps by joined text length; media contributes no chars', () => {
    const big = text('big', 'ก'.repeat(LINE_BUFFER_MAX_TEXT_CHARS));
    assert.equal(bufferAtCapacity([big]), true);
    assert.equal(joinedTextLength([media('m1')]), 0);
    assert.equal(bufferAtCapacity([media('m1')]), false);
  });

  it('fittingPrefixCount admits an order-preserving prefix only', () => {
    const pending: LineBufferItem[] = [];
    for (let i = 0; i < LINE_BUFFER_MAX_ITEMS - 2; i++) pending.push(text(`p${i}`, 'x'));
    const incoming = [text('i1', 'x'), text('i2', 'x'), text('i3', 'x')];
    assert.equal(fittingPrefixCount(pending, incoming), 2);
    assert.equal(fittingPrefixCount([], incoming), 3);
  });

  it('fittingPrefixCount stops at the char cap', () => {
    const pending = [text('p', 'ก'.repeat(LINE_BUFFER_MAX_TEXT_CHARS - 10))];
    const incoming = [text('i1', 'ยาวเกินสิบตัวอักษรแน่นอน')];
    assert.equal(fittingPrefixCount(pending, incoming), 0);
  });
});

describe('lineWaitStatusText', () => {
  it('selects one waiting line from the request situation', () => {
    assert.match(lineWaitStatusText('ช่วยทำรายงานยอดขาย'), /จัดเตรียมรายงาน/);
    assert.match(lineWaitStatusText('สรุปค่าใช้จ่ายเดือนนี้'), /สรุปข้อมูล/);
    assert.match(lineWaitStatusText('เปรียบเทียบยอดขายสองสาขา'), /เปรียบเทียบข้อมูล/);
    assert.match(lineWaitStatusText('ยอดรวมทั้งหมดเท่าไหร่'), /คำนวณตัวเลข/);
    assert.match(lineWaitStatusText('วิเคราะห์แนวโน้มสินค้า'), /วิเคราะห์ข้อมูล/);
    assert.match(lineWaitStatusText('ค้นข้อมูลเอกสารเลขที่ 123'), /ค้นข้อมูล/);
    assert.match(lineWaitStatusText('ขอดูสถานะใบแจ้งหนี้'), /ตรวจสอบข้อมูลในระบบ/);
    assert.match(lineWaitStatusText('เล่าเรื่องสนุกให้ฟังหน่อย'), /ขอคิดสักครู่/);
    assert.match(lineWaitStatusText('', 'media'), /ตรวจสอบเอกสาร/);
  });
});
