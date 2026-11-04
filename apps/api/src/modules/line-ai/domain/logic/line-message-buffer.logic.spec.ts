import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLineAiApiTrace,
  bufferAtCapacity,
  debounceCohortMs,
  fittingPrefixCount,
  joinGroupText,
  joinedTextLength,
  lineMediaGroupAckStage,
  lineMediaGroupAckText,
  lineWaitCardHeader,
  lineWaitStageMessage,
  lineWaitStages,
  lineWaitStatusText,
  nextFlushDelayMs,
  segmentBatch,
  sortBatchItems,
  LINE_AI_DEBOUNCE_COHORTS_MS,
  LINE_BUFFER_MAX_ITEMS,
  LINE_BUFFER_MAX_TEXT_CHARS,
  LINE_FILE_RECEIVED_TEXT,
  LINE_MEDIA_RECEIVED_TEXT,
  LINE_MEDIA_SLOW_STATUS_TEXT,
  LINE_SLOW_TURN_STATUS_TEXT,
  LINE_WAIT_STATUS_DELAY_MS,
  LINE_WAIT_STATUS_SLOW_DELAY_MS,
} from './line-message-buffer.logic';
import type { LineBufferItem, LineBufferTextItem, LineBufferMediaItem } from './line-message-buffer.logic';

let seq = 0;
function text(id: string, body: string, opts: { kind?: 'text' | 'command'; timestamp?: number } = {}): LineBufferTextItem {
  seq += 1;
  return { kind: opts.kind ?? 'text', webhookEventId: id, replyToken: `rt-${id}`, text: body, timestamp: opts.timestamp ?? seq, acceptedAt: opts.timestamp ?? seq, seq };
}
function media(id: string, opts: { timestamp?: number } = {}): LineBufferMediaItem {
  seq += 1;
  return { kind: 'media', webhookEventId: id, replyToken: `rt-${id}`, lineMessageId: `mid-${id}`, messageType: 'image', timestamp: opts.timestamp ?? seq, acceptedAt: opts.timestamp ?? seq, seq };
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
  const timing = { debounceMs: 2000, maxWaitMs: 8000 };
  it('uses the debounce window while max wait is far away', () => {
    assert.equal(nextFlushDelayMs(10_000, 10_000, timing), 2000);
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

describe('waiting feedback microcopy', () => {
  it('keeps the receipt acknowledgement truthful, and promises no time nobody knows (design lock §8)', () => {
    assert.match(LINE_MEDIA_RECEIVED_TEXT, /ได้รับรูปแล้ว.*กำลังอ่านเอกสารอยู่.*สรุปให้ทางแชตนี้.*คุยกับน้องต่อได้เลย/);
    // The sentence is the scanning card's canonical text: what a notification shows and what is sent
    // where the card cannot be drawn. The lock bans a duration or a percentage there as on the card.
    for (const types of [['image'], ['file'], ['image', 'image'], ['file', 'file', 'file'], ['image', 'file']] as Array<Array<'image' | 'file'>>) {
      assert.doesNotMatch(lineMediaGroupAckText(types), /นาที|วินาที|ชั่วโมง|%|เปอร์เซ็นต์/u, types.join('+'));
    }
    for (const text of [LINE_MEDIA_SLOW_STATUS_TEXT, LINE_SLOW_TURN_STATUS_TEXT]) assert.doesNotMatch(text, /นาที|วินาที|ชั่วโมง|%|เปอร์เซ็นต์/u);
  });

  // UAT 2026-09-29 "ส่งรูปที่ 2 ต่อกันแล้วเงียบไป": a burst is acknowledged once, by count, on arrival.
  it('acknowledges a media group once, keeping the single-photo and single-file sentences', () => {
    assert.equal(lineMediaGroupAckText(['image']), LINE_MEDIA_RECEIVED_TEXT);
    assert.equal(lineMediaGroupAckText(['file']), LINE_FILE_RECEIVED_TEXT);
    const burst = lineMediaGroupAckText(['image', 'image']);
    assert.match(burst, /^ได้รับรูปแล้ว 2 รูปค่ะ/);
    assert.match(burst, /ทีละรูปตามลำดับ.*ครบทุกรูป.*คุยกับน้องต่อได้เลยค่ะ$/);
    assert.doesNotMatch(burst, /นาที/, 'no acknowledgement names a time');
    assert.match(lineMediaGroupAckText(['file', 'file', 'file']), /^ได้รับไฟล์แล้ว 3 ไฟล์ค่ะ/);
    const mixed = lineMediaGroupAckText(['image', 'file']);
    assert.match(mixed, /^ได้รับรูป 1 รูปและไฟล์ 1 ไฟล์แล้วค่ะ/, 'a file is never called a รูป (§17.1)');
  });

  it('selects relevant copy and varies repeated generic turns deterministically', () => {
    assert.match(lineWaitStatusText('ขอดูบัญชีเดือนนี้', 'turn-1'), /ตรวจสอบ|เช็กข้อมูล/);
    assert.match(lineWaitStatusText('ช่วยเปรียบเทียบยอดขาย', 'turn-2'), /เปรียบเทียบ|ความต่าง/);

    const repeated = new Set(Array.from(
      { length: 12 },
      (_, index) => lineWaitStatusText('ขอบคุณนะ', `turn-${index}`),
    ));
    assert.ok(repeated.size > 1, 'repeated generic turns do not show one fixed sentence forever');
    assert.equal(lineWaitStatusText('ขอบคุณนะ', 'same-turn'), lineWaitStatusText('ขอบคุณนะ', 'same-turn'));
    assert.equal([...repeated].some((status) => status.includes('ขอคิดสักครู่')), false);
  });
});

// Design lock context 8 "กำลังสแกน": the media acknowledgement, at the same moment and once per group,
// as the locked scanning card. Its sentence is still the canonical text and the fallback.
describe('scanning card — the media acknowledgement on the locked design', () => {
  const WEB = 'https://app.example.test';
  const texts = (message: any): string[] => {
    const found: string[] = [];
    const walk = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (node.type === 'text' && typeof node.text === 'string') found.push(node.text);
      Object.values(node).forEach(walk);
    };
    walk(message.contents);
    return found;
  };

  it('one picture: two header lines, what is being read, and where the result will come', () => {
    const stage = lineMediaGroupAckStage(['image']);
    assert.equal(stage.text, LINE_MEDIA_RECEIVED_TEXT, 'the acknowledgement sentence is the card\'s canonical text');
    assert.deepEqual(stage.card, {
      mascot: 'scanning', header: { lines: ['เอกสารที่ส่งมา', 'กำลังสแกน'] },
      banner: { tone: 'scanning', text: 'กำลังอ่านข้อมูลจากรูป' },
      text: 'อ่านเสร็จแล้ว น้องจะส่งสรุปให้ในแชตนี้ค่ะ ระหว่างนี้คุยกับน้องต่อได้เลย',
    });
  });

  it('never calls a file a picture, and names a burst by its real counts', () => {
    const file = lineMediaGroupAckStage(['file']);
    assert.equal(file.text, LINE_FILE_RECEIVED_TEXT);
    assert.equal(file.card?.banner?.text, 'กำลังอ่านข้อมูลจากไฟล์');
    assert.doesNotMatch(JSON.stringify(file.card), /รูป/);
    assert.equal(lineMediaGroupAckStage(['image', 'image']).card?.banner?.text, 'กำลังอ่านข้อมูลจากรูป 2 รูป');
    assert.match(lineMediaGroupAckStage(['image', 'image']).card?.text ?? '', /ทีละรูปตามลำดับ.*ครบทุกรูป/);
    const files = lineMediaGroupAckStage(['file', 'file', 'file']);
    assert.equal(files.card?.banner?.text, 'กำลังอ่านข้อมูลจากไฟล์ 3 ไฟล์');
    assert.doesNotMatch(JSON.stringify(files.card), /รูป/);
    const mixed = lineMediaGroupAckStage(['image', 'file', 'image']);
    assert.equal(mixed.card?.banner?.text, 'กำลังอ่านข้อมูลจากรูป 2 รูปและไฟล์ 1 ไฟล์');
    assert.equal(mixed.text, lineMediaGroupAckText(['image', 'file', 'image']));
  });

  it('claims no progress and no finishing time, and has neither of the two rows the owner cut', () => {
    for (const types of [['image'], ['file'], ['image', 'image'], ['image', 'file']] as Array<Array<'image' | 'file'>>) {
      const card = JSON.stringify(lineMediaGroupAckStage(types).card);
      assert.doesNotMatch(card, /%|เปอร์เซ็นต์|นาที|วินาที|เอกสารที่รับ|สถานะ|อ่านสำเร็จ|อ่านเรียบร้อย/, types.join('+'));
    }
  });

  it('is sent as one Flex card whose fallback is the sentence; with no https base it is that sentence as before', () => {
    const stage = lineMediaGroupAckStage(['image']);
    const message = lineWaitStageMessage(stage, WEB);
    assert.equal(message.type, 'flex');
    if (message.type !== 'flex') return;
    assert.equal(message.canonicalText, LINE_MEDIA_RECEIVED_TEXT);
    assert.equal(message.altText, 'กำลังอ่านข้อมูลจากรูป อ่านเสร็จแล้ว น้องจะส่งสรุปให้ในแชตนี้ค่ะ ระหว่างนี้คุยกับน้องต่อได้เลย');
    assert.deepEqual(texts(message), ['เอกสารที่ส่งมา', 'กำลังสแกน', 'กำลังอ่านข้อมูลจากรูป', 'อ่านเสร็จแล้ว น้องจะส่งสรุปให้ในแชตนี้ค่ะ ระหว่างนี้คุยกับน้องต่อได้เลย']);
    assert.match(JSON.stringify(message.contents), /system-card-mascot-scanning-\d{8}\.png/);
    assert.doesNotMatch(JSON.stringify(message.contents), /"type":"(?:postback|uri|message)"/, 'a waiting card has nothing to press');
    for (const base of [undefined, '', 'http://localhost:3000']) {
      assert.deepEqual(lineWaitStageMessage(stage, base), { type: 'text', text: LINE_MEDIA_RECEIVED_TEXT });
    }
    // A stage with no card is its sentence wherever it is sent.
    assert.deepEqual(lineWaitStageMessage({ delayMs: 0, text: 'ข้อความ' }, WEB), { type: 'text', text: 'ข้อความ' });
  });
});

describe('lineWaitStages', () => {
  const base = { messageText: 'ขอสรุปยอดขาย', seed: 'turn-1', latestAcceptedAt: 10_000, now: 10_000 };

  it('a photo turn keeps one slow-read status before the spinner window lapses; its group already acked', () => {
    const stages = lineWaitStages({ ...base, kind: 'media', loadingEnabled: true });
    assert.deepEqual(stages, [
      // Design lock context 8: still the same read, so still the scanning card — the nudge is its sentence.
      { delayMs: LINE_WAIT_STATUS_SLOW_DELAY_MS, text: LINE_MEDIA_SLOW_STATUS_TEXT, card: {
        mascot: 'scanning', header: { lines: ['เอกสารที่ส่งมา', 'กำลังสแกน'] }, banner: { tone: 'scanning', text: 'กำลังอ่านข้อมูลจากรูป' }, text: LINE_MEDIA_SLOW_STATUS_TEXT,
      } },
    ]);
    assert.ok(LINE_WAIT_STATUS_SLOW_DELAY_MS < 60_000, 'slow status must land before LINE loading (60 s) expires');
    assert.deepEqual(lineWaitStages({ ...base, kind: 'media', mediaType: 'file', loadingEnabled: true }), [],
      'a file read finishes with its own push, so its turn promises nothing more');
  });

  it('with the spinner on, a text turn stays bubble-free until the single slow-turn status (Owner 2026-08-27)', () => {
    assert.deepEqual(lineWaitStages({ ...base, kind: 'text', loadingEnabled: true }), [
      // Design lock context 5 "กำลังตรวจสอบ": the status sentence unchanged, on the locked waiting card.
      { delayMs: LINE_WAIT_STATUS_SLOW_DELAY_MS, text: LINE_SLOW_TURN_STATUS_TEXT,
        card: { mascot: 'general', header: { lines: ['ข้อมูลที่คุณขอ', 'กำลังตรวจสอบ'] }, text: LINE_SLOW_TURN_STATUS_TEXT } },
    ]);
  });

  it('heads a waiting card by what is being worked on: asked-for data, or simply the reader\'s message', () => {
    for (const asked of ['ขอสรุปยอดขาย', 'ค่าใช้จ่ายเดือนนี้เท่าไหร่', 'สถานะรายการที่ 3', 'ขอรายงานภาษี']) {
      assert.deepEqual(lineWaitCardHeader(asked), ['ข้อมูลที่คุณขอ', 'กำลังตรวจสอบ'], asked);
    }
    // Small talk asked for no data: the card must not say data is being checked.
    for (const said of ['วันนี้เหนื่อยจัง', 'สวัสดีค่ะ', 'hello']) {
      assert.deepEqual(lineWaitCardHeader(said), said === 'hello' ? ['Your request', 'Checking the details'] : ['ข้อความของคุณ', 'กำลังหาคำตอบ'], said);
    }
    const [stage] = lineWaitStages({ ...base, messageText: 'วันนี้เหนื่อยจัง', kind: 'text', loadingEnabled: true });
    assert.deepEqual(stage!.card?.header, { lines: ['ข้อความของคุณ', 'กำลังหาคำตอบ'] });
  });

  it('with the spinner off, the 5 s topic status returns as the fallback and the slow status still follows (spec §10)', () => {
    const stages = lineWaitStages({ ...base, kind: 'text', loadingEnabled: false });
    assert.equal(stages.length, 2);
    assert.equal(stages[0]!.delayMs, LINE_WAIT_STATUS_DELAY_MS);
    assert.equal(stages[0]!.text, lineWaitStatusText('ขอสรุปยอดขาย', 'turn-1'));
    assert.deepEqual(stages[0]!.card, { mascot: 'general', header: { lines: ['ข้อมูลที่คุณขอ', 'กำลังตรวจสอบ'] }, text: stages[0]!.text });
    assert.deepEqual(stages[1], { delayMs: LINE_WAIT_STATUS_SLOW_DELAY_MS, text: LINE_SLOW_TURN_STATUS_TEXT,
      card: { mascot: 'general', header: { lines: ['ข้อมูลที่คุณขอ', 'กำลังตรวจสอบ'] }, text: LINE_SLOW_TURN_STATUS_TEXT } });
  });

  it('anchors text delays to durable acceptance, clamped at zero when dispatch starts late', () => {
    const stages = lineWaitStages({
      ...base, kind: 'text', loadingEnabled: false, now: 10_000 + LINE_WAIT_STATUS_DELAY_MS + 1_000,
    });
    assert.equal(stages[0]!.delayMs, 0, 'an already-due status fires immediately');
    assert.equal(stages[1]!.delayMs, LINE_WAIT_STATUS_SLOW_DELAY_MS - LINE_WAIT_STATUS_DELAY_MS - 1_000);
  });
});

describe('buildLineAiApiTrace', () => {
  const base = {
    webhookEventId: 'evt-1', oneToOne: true, segment: 'text' as const,
    firstAcceptedAtMs: 1_000, flushedAtMs: 1_250, dequeuedAtMs: 1_260,
    loadingRequested: true,
  };

  it('computes only the ingress/buffer/queue seam (no lumped dispatch) and derives the chat kind', () => {
    assert.deepEqual(buildLineAiApiTrace(base), {
      webhookEventId: 'evt-1', chat: 'one_to_one', segment: 'text', acceptedAtMs: 1_000,
      bufferWaitMs: 250, queueWaitMs: 10, loadingRequested: true,
    });
    assert.equal(buildLineAiApiTrace({ ...base, oneToOne: false }).chat, 'group');
  });

  it('clamps negative or unknown intervals to 0 (clock skew, absent accept time)', () => {
    assert.equal(buildLineAiApiTrace({ ...base, flushedAtMs: 500 }).bufferWaitMs, 0);
    assert.equal(buildLineAiApiTrace({ ...base, firstAcceptedAtMs: null }).bufferWaitMs, 0);
    assert.equal(buildLineAiApiTrace({ ...base, dequeuedAtMs: 0 }).queueWaitMs, 0);
  });

  it('carries no dispatch duration, raw message text, or LINE user id (only the correlation event id)', () => {
    const trace = buildLineAiApiTrace(base);
    assert.deepEqual(Object.keys(trace).sort(), [
      'acceptedAtMs', 'bufferWaitMs', 'chat', 'loadingRequested', 'queueWaitMs', 'segment', 'webhookEventId',
    ]);
  });
});

describe('debounceCohortMs', () => {
  const base = { secret: 'experiment-secret', assignmentKey: 'co-1:chat-1', configuredMs: 2_000 };

  it('returns the configured debounce when the experiment is off, has no secret, or has no key', () => {
    assert.equal(debounceCohortMs({ ...base, enabled: false }), 2_000);
    assert.equal(debounceCohortMs({ ...base, enabled: true, secret: undefined }), 2_000);
    assert.equal(debounceCohortMs({ ...base, enabled: true, assignmentKey: '' }), 2_000);
    assert.equal(debounceCohortMs({ enabled: false, secret: undefined, assignmentKey: '', configuredMs: 0 }), 0);
  });

  it('assigns only a declared cohort value when enabled', () => {
    const cohort = debounceCohortMs({ ...base, enabled: true });
    assert.ok((LINE_AI_DEBOUNCE_COHORTS_MS as readonly number[]).includes(cohort), `${cohort} is a declared cohort`);
    assert.equal(typeof cohort, 'number');
  });

  it('is stable for the same (company, chat) and independent of the configured value', () => {
    const a = debounceCohortMs({ ...base, enabled: true });
    const b = debounceCohortMs({ ...base, enabled: true, configuredMs: 999 });
    assert.equal(a, b);
  });

  it('depends on the secret, so a rotated secret reshuffles assignment', () => {
    const withA = new Set(Array.from({ length: 200 }, (_, i) => debounceCohortMs({ enabled: true, secret: 'secret-a', assignmentKey: `co:${i}`, configuredMs: 2_000 })));
    const withB = new Set(Array.from({ length: 200 }, (_, i) => debounceCohortMs({ enabled: true, secret: 'secret-b', assignmentKey: `co:${i}`, configuredMs: 2_000 })));
    // Both secrets exercise every cohort; the point is the mapping is keyed on the secret, not fixed.
    assert.equal(withA.size, LINE_AI_DEBOUNCE_COHORTS_MS.length);
    assert.equal(withB.size, LINE_AI_DEBOUNCE_COHORTS_MS.length);
  });

  it('spreads a population of keys across all three concurrent cohorts', () => {
    const counts = new Map<number, number>();
    for (let i = 0; i < 3_000; i += 1) {
      const ms = debounceCohortMs({ enabled: true, secret: 'experiment-secret', assignmentKey: `co-1:chat-${i}`, configuredMs: 2_000 });
      counts.set(ms, (counts.get(ms) ?? 0) + 1);
    }
    for (const cohort of LINE_AI_DEBOUNCE_COHORTS_MS) {
      assert.ok((counts.get(cohort) ?? 0) > 500, `cohort ${cohort} is represented (${counts.get(cohort) ?? 0})`);
    }
  });
});

it('R23 control is a singleton command', () => {
  for (const control of [{ workflowStart: 'reimbursement_claim' as const }, { fixedReadControl: { id: 'expense_month' as const } },
    { workflowControl: { action: 'wf_choice' as const, token: 'choice', pick: 'other' as const } }]) {
    const command = { ...text('control', 'เลือกงาน', { kind: 'command' }), ...control };
    const groups = segmentBatch([text('before', 'ก่อนหน้า'), command, text('after', 'ถัดไป')]);
    assert.equal(groups.length, 3);
    assert.deepEqual(groups[1], { kind: 'command', item: command });
  }
});
