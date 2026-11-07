import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { LineAiLedgerService, ledgerKey, parseLedgerKey, fieldsToEntry, LEDGER_GROUP, type LedgerRedis } from './line-ai-ledger.service';
import { ConsumptionMarkerUnavailableError, clarificationMarkerKey } from './line-ai-consumption-marker';
import { hashMessagePreview } from '../domain/logic/line-ai-classifier.logic';
import { FakeRedis } from './line-ai-ledger-redis.fixture';

function makeService(overrides: Record<string, unknown> = {}) {
  const auditEvents: any[] = [];
  const config = {
    lineAiLedgerEnabled: true,
    redisUrl: 'redis://fake',
    lineAiLedgerMaxLen: 5,
    lineAiLedgerTtlSeconds: 3600,
    lineAiLedgerClaimMinIdleMs: 1000,
    lineAiLedgerDeliveryCap: 3,
    ...overrides,
  } as any;
  const audit = { log: async (e: unknown) => { auditEvents.push(e); } } as any;
  // Durable consumption markers: no rows unless a test seeds them; `failMarkers` proves the
  // lookup does NOT fail open the way the Redis path does.
  const markerKeys = new Set<string>();
  const markerState = { failMarkers: false };
  const prisma = {
    client: {
      outboxEvent: {
        findMany: async ({ where }: any) => {
          if (markerState.failMarkers) throw new Error('outbox_unavailable');
          return (where.eventKey.in as string[]).filter((key) => markerKeys.has(key)).map((eventKey) => ({ eventKey }));
        },
        create: async ({ data }: any) => { markerKeys.add(data.eventKey); },
      },
    },
  } as any;
  const service = new LineAiLedgerService(config, audit, prisma);
  // AC-13: capture every log payload so a test can prove no raw key / LINE id is ever printed,
  // and that a confirmed-absent stream is not logged at `warn`.
  const logs: Array<{ level: 'log' | 'warn'; payload: any }> = [];
  (service as any).logger = {
    log: (payload: any) => logs.push({ level: 'log', payload }),
    warn: (payload: any) => logs.push({ level: 'warn', payload }),
    error: () => undefined,
    debug: () => undefined,
  };
  const redis = new FakeRedis();
  service.attachClient(redis);
  return { service, redis, auditEvents, prisma, markerKeys, markerState, logs };
}

const NOW = new Date('2026-07-07T10:00:00.000Z');

describe('LineAiLedgerService (item 10F, fake Redis)', () => {
  it('key helpers round-trip company/chat', () => {
    const key = ledgerKey('company-1', 'Ugroup:chat');
    assert.deepEqual(parseLedgerKey(key), { companyId: 'company-1', chatKey: 'Ugroup:chat' });
    assert.equal(parseLedgerKey('other:key'), null);
  });

  it('appendTurn puts the entry into the PEL immediately (consume-on-append) and audits', async () => {
    const { service, redis, auditEvents } = makeService();
    const id = await service.appendTurn({ companyId: 'c1', chatKey: 'chat1', turnId: 't1', webhookEventId: 'evt1', userId: 'u1', text: 'ยอดขายวันนี้', now: NOW });
    assert.ok(id);
    const key = ledgerKey('c1', 'chat1');
    assert.equal(redis.pels.get(key)?.size, 1, 'entry is open (PEL) right away');
    assert.equal(redis.ttls.get(key), 3600, 'TTL refreshed on write');
    assert.equal(auditEvents[0]?.action, 'ai.line.ledger.appended');
    assert.equal(auditEvents[0]?.metadataJson?.kind, 'turn');
  });

  it('ack removes the entry from the PEL and mirrors the outcome to audit', async () => {
    const { service, redis, auditEvents } = makeService();
    const id = await service.appendTurn({ companyId: 'c1', chatKey: 'chat1', turnId: 't1', webhookEventId: 'evt1', userId: 'u1', text: 'x', now: NOW });
    const key = ledgerKey('c1', 'chat1');
    await service.ack({ key, id: id!, companyId: 'c1', turnId: 't1', kind: 'turn' }, 'acked');
    assert.equal(redis.pels.get(key)?.size, 0);
    assert.equal(auditEvents.at(-1)?.action, 'ai.line.ledger.acked');
  });

  it('openWaitingUser returns only unexpired waiting_user entries with their questions', async () => {
    const { service } = makeService();
    await service.appendSubRequests({
      companyId: 'c1', chatKey: 'chat1', turnId: 't1', webhookEventId: 'evt1', userId: 'u1', now: NOW,
      items: [
        { text: 'บันทึกบิล 9/11/37 หกสิบบาท', subject: 'expense', state: 'waiting_user', clarifyQuestion: 'วันที่ "9/11/37" หมายถึง 9 พ.ย. 2537 หรือ 9 พ.ย. 2580?' },
        { text: 'ยอดค้างซัพพลายเออร์', state: 'pending' },
      ],
    });
    const open = await service.openWaitingUser('c1', 'chat1', 'u1', new Date(NOW.getTime() + 60_000));
    assert.equal(open.length, 1);
    assert.equal(open[0].text, 'บันทึกบิล 9/11/37 หกสิบบาท');
    assert.ok(open[0].question.includes('2537'));
    assert.equal(open[0].subject, 'expense');

    const afterWindow = await service.openWaitingUser('c1', 'chat1', 'u1', new Date(NOW.getTime() + 16 * 60_000));
    assert.equal(afterWindow.length, 0, 'expired clarifications are not re-attached');
  });

  it('never hands one member the clarification another member was asked', async () => {
    const { service } = makeService();
    await service.appendSubRequests({
      companyId: 'c1', chatKey: 'group1', turnId: 't1', webhookEventId: 'evt1', userId: 'asker', now: NOW,
      items: [{ text: 'แก้วันที่', state: 'waiting_user', clarifyQuestion: 'วันที่ 20 เดือนไหน' }],
    });

    assert.equal((await service.openWaitingUser('c1', 'group1', 'asker', NOW)).length, 1);
    assert.deepEqual(await service.openWaitingUser('c1', 'group1', 'bystander', NOW), []);
  });

  it('carries the intake route and candidate shortlist so the answer inherits deterministically', async () => {
    const { service } = makeService();
    await service.appendSubRequests({
      companyId: 'c1', chatKey: 'chat1', turnId: 't1', webhookEventId: 'evt1', userId: 'u1', now: NOW,
      items: [{
        text: 'วันที่ผิด ต้องเป็นวันที่ 20', state: 'waiting_user', clarifyQuestion: 'เดือนและปีใด',
        clarifyForIntent: 'EXPENSE_CAPTURE_CORRECTION', candidateExpenseIds: ['expense-1', 'expense-2'],
      }],
    });

    const [open] = await service.openWaitingUser('c1', 'chat1', 'u1', NOW);
    assert.equal(open?.clarifyForIntent, 'EXPENSE_CAPTURE_CORRECTION');
    assert.deepEqual(open?.candidateExpenseIds, ['expense-1', 'expense-2']);
  });

  it('suppresses an entry whose durable consumption marker exists, even with the Redis ack lost', async () => {
    const { service, redis, markerKeys } = makeService();
    const key = ledgerKey('c1', 'chat1');
    await service.appendSubRequests({
      companyId: 'c1', chatKey: 'chat1', turnId: 't1', webhookEventId: 'evt1', userId: 'u1', now: NOW,
      items: [{ text: 'แก้ยอด', state: 'waiting_user', clarifyQuestion: 'รายการไหน' }],
    });
    const [open] = await service.openWaitingUser('c1', 'chat1', 'u1', NOW);
    assert.ok(open);

    // The mutation committed and wrote the marker; XACK then failed and was swallowed.
    markerKeys.add(clarificationMarkerKey('c1', ledgerKey('c1', 'chat1'), open.id));
    assert.equal(redis.pels.get(key)?.has(open.id), true, 'the lost ack is the premise: the entry is STILL pending in Redis');

    assert.deepEqual(await service.openWaitingUser('c1', 'chat1', 'u1', NOW), [], 'consumed entry must not be re-offered');
  });

  it('equal Redis ids in different streams do not collide as markers', () => {
    const first = clarificationMarkerKey('c1', ledgerKey('c1', 'chatA'), '1-0');
    const second = clarificationMarkerKey('c1', ledgerKey('c1', 'chatB'), '1-0');
    const otherCompany = clarificationMarkerKey('c2', ledgerKey('c2', 'chatA'), '1-0');
    assert.notEqual(first, second);
    assert.notEqual(first, otherCompany);
  });

  it('throws instead of returning an empty list when marker state cannot be read', async () => {
    const { service, markerState } = makeService();
    await service.appendSubRequests({
      companyId: 'c1', chatKey: 'chat1', turnId: 't1', webhookEventId: 'evt1', userId: 'u1', now: NOW,
      items: [{ text: 'แก้ยอด', state: 'waiting_user', clarifyQuestion: 'รายการไหน' }],
    });
    markerState.failMarkers = true;

    // Fail-closed on purpose: an empty list here would let a bare "590" be routed as a new capture.
    await assert.rejects(() => service.openWaitingUser('c1', 'chat1', 'u1', NOW), (err: unknown) => {
      assert.ok(err instanceof ConsumptionMarkerUnavailableError);
      // AC-06: the marker lookup sits OUTSIDE the Redis try/catch, so it can never be relabelled
      // as a stream-lifecycle outcome by the NOGROUP exemption.
      assert.equal(err.reason, 'marker_unavailable');
      return true;
    });
  });

  it('claimOpenEntries honors min-idle and reports growing delivery counts', async () => {
    const { service, redis } = makeService();
    await service.appendTurn({ companyId: 'c1', chatKey: 'chat1', turnId: 't1', webhookEventId: 'evt1', userId: 'u1', text: 'x', now: NOW });

    const fresh = await service.claimOpenEntries(10, 1000);
    assert.equal(fresh.length, 0, 'freshly appended entries are inside the min-idle window');

    redis.nowMs += 5000;
    const first = await service.claimOpenEntries(10, 1000);
    assert.equal(first.length, 1);
    assert.equal(first[0].deliveryCount, 2, 'append delivery + this claim');
    assert.equal(first[0].entry.kind, 'turn');

    redis.nowMs += 5000;
    const second = await service.claimOpenEntries(10, 1000);
    assert.equal(second[0].deliveryCount, 3, 'every reclaim increments the delivery count');
  });

  it('coverageToSubRequests maps needs_user/uncovered and drops covered', () => {
    const { service } = makeService();
    const items = service.coverageToSubRequests([
      { request: 'ยอดขาย', verdict: 'covered' },
      { request: 'วันที่บิล', subject: 'expense', verdict: 'needs_user', question: 'ปีไหน?' },
      { request: 'ของใกล้หมด', verdict: 'uncovered', reason: 'budget' },
    ]);
    assert.deepEqual(items, [
      { text: 'วันที่บิล', subject: 'expense', state: 'waiting_user', clarifyQuestion: 'ปีไหน?' },
      { text: 'ของใกล้หมด', state: 'pending' },
    ]);
  });

  it('MAXLEN trims oldest entries', async () => {
    const { service, redis } = makeService();
    for (let i = 0; i < 8; i++) {
      await service.appendTurn({ companyId: 'c1', chatKey: 'chat1', turnId: `t${i}`, webhookEventId: `e${i}`, userId: 'u1', text: `msg ${i}`, now: NOW });
    }
    assert.equal(redis.streams.get(ledgerKey('c1', 'chat1'))?.length, 5, 'stream bounded at MAXLEN');
  });

  it('keeps append/ack best-effort but never treats an unreadable question as no question', async () => {
    const { service, redis } = makeService();
    redis.failing = true;
    assert.equal(await service.appendTurn({ companyId: 'c1', chatKey: 'chat1', turnId: 't1', webhookEventId: 'e1', userId: 'u1', text: 'x', now: NOW }), null);
    await assert.rejects(service.openWaitingUser('c1', 'chat1', 'u1', NOW), /consumption_marker_unavailable/);
    assert.deepEqual(await service.claimOpenEntries(10, 1000), []);
    await service.ack({ key: ledgerKey('c1', 'chat1'), id: '1-0', companyId: 'c1', turnId: 't1', kind: 'turn' }, 'acked');
  });

  it('is a no-op when the flag is off', async () => {
    const { service, redis } = makeService({ lineAiLedgerEnabled: false });
    assert.equal(service.enabled, false);
    assert.equal(await service.appendTurn({ companyId: 'c1', chatKey: 'chat1', turnId: 't1', webhookEventId: 'e1', userId: 'u1', text: 'x', now: NOW }), null);
    assert.equal(redis.streams.size, 0);
  });

  it('fieldsToEntry round-trips valueCandidates and rejects malformed rows', async () => {
    const { service, redis } = makeService();
    const candidates = { amounts: [{ span: 'หกสิบ', value: '60' }], dates: [] };
    await service.appendTurn({ companyId: 'c1', chatKey: 'chat1', turnId: 't1', webhookEventId: 'e1', userId: 'u1', text: 'หกสิบบาท', valueCandidates: candidates as never, now: NOW });
    const key = ledgerKey('c1', 'chat1');
    const [row] = redis.streams.get(key)!;
    const entry = fieldsToEntry(key, row.id, row.fields);
    assert.deepEqual(entry?.valueCandidates, candidates);
    assert.equal(entry?.createdAt, NOW.toISOString());
    assert.equal(fieldsToEntry(key, '1-0', ['kind', 'nonsense']), null);
  });

  /**
   * Spec `line-ai-draft-control-spec-th.md` §5.3. A turn the reclaim worker re-runs must reach the
   * gateway with the same trusted provenance the live turn had — without it a drained business
   * question is told it is out of scope. The value is re-validated on the way out by membership,
   * exactly like `clarifyForIntent`, because a stream field is untrusted storage.
   */
  it('round-trips the trusted intake intent, and refuses one that is not a known route', async () => {
    const { service, redis } = makeService();
    const key = ledgerKey('c1', 'chat1');
    await service.appendTurn({
      companyId: 'c1', chatKey: 'chat1', turnId: 't1', webhookEventId: 'e1', userId: 'u1',
      text: 'ทำไม service charge คิดแยกเป็นอีกรายการ', intakeIntent: 'BUSINESS_READ_QUESTION', now: NOW,
    });

    const [row] = redis.streams.get(key)!;
    assert.equal(fieldsToEntry(key, row.id, row.fields)?.intakeIntent, 'BUSINESS_READ_QUESTION');

    const forged = fieldsToEntry(key, row.id, [...row.fields.slice(0, -2), 'intakeIntent', 'NOT_A_ROUTE']);
    assert.equal(forged?.intakeIntent, undefined, 'membership validation, never a cast');
  });

  it('carries no intake intent for a turn that had none', async () => {
    const { service, redis } = makeService();
    const key = ledgerKey('c1', 'chat1');
    await service.appendTurn({ companyId: 'c1', chatKey: 'chat1', turnId: 't1', webhookEventId: 'e1', userId: 'u1', text: 'x', now: NOW });
    const [row] = redis.streams.get(key)!;
    assert.equal(fieldsToEntry(key, row.id, row.fields)?.intakeIntent, undefined);
  });
});

describe('Stored question source transport', () => {
  it('round-trips original proof byte-for-byte and refuses oversized UTF-8 proof without losing the question', async () => {
    const { service, redis } = makeService();
    const sourceContext = JSON.stringify({ original: 'คำถามต้นทาง', records: ['expense-1', 'expense-2'] });
    await service.appendSubRequests({ companyId: 'company-1', chatKey: 'private-chat', userId: 'user-1', turnId: 'turn-1', webhookEventId: 'event-1', now: NOW,
      items: [{ text: 'เลือกใบเสร็จ', state: 'waiting_user', clarifyQuestion: 'รายการไหน?', sourceContext },
        { text: 'คำถามยาว', state: 'waiting_user', clarifyQuestion: 'รายการไหน?', sourceContext: 'ก'.repeat(6000) }] });
    const questions = await service.openWaitingUser('company-1', 'private-chat', 'user-1', NOW);
    assert.equal(questions.length, 2);
    assert.equal(questions[0].entry.sourceContext, sourceContext);
    assert.equal(questions[1].entry.sourceContext, undefined, 'webhook must retire the unproven question; it is never silently an empty context');
    const row = redis.streams.get(ledgerKey('company-1', 'private-chat'))![0];
    assert.equal(fieldsToEntry(ledgerKey('company-1', 'private-chat'), row.id, [...row.fields, 'sourceContext', 'ก'.repeat(6000)])?.sourceContext, undefined);
  });

  it('an enabled unavailable Redis client fails closed; an explicitly disabled ledger remains empty', async () => {
    const { service } = makeService();
    (service as any).client = null; (service as any).clientFailed = true;
    await assert.rejects(service.openWaitingUser('company-1', 'chat', 'user-1'), /consumption_marker_unavailable/);
    const disabled = makeService({ lineAiLedgerEnabled: false }).service;
    assert.deepEqual(await disabled.openWaitingUser('company-1', 'chat', 'user-1'), []);
  });
});

/**
 * Spec `line-ai-ledger-lifecycle-remediation-spec-th.md` §4. On UAT a brand-new chat could not be
 * started at all: `XPENDING` on a stream that does not exist yet raises NOGROUP, the catch turned
 * every read error into unavailable, and the turn ended `marker_unavailable` before any routing —
 * while the stream/group are only created by `append()`, which that turn never reaches.
 *
 * The distinction the whole section turns on: a CONFIRMED-absent stream is a normal lifecycle
 * state, an unreadable one is not, and only `EXISTS` on the exact key tells them apart.
 */
const LINE_CHAT_ID = 'Uab12cd34ef56ab78cd90ef12ab34cd56';

/** Asserts the typed refusal AND its machine-readable cause, which is the whole point of `reason`. */
async function rejectsWithReason(run: () => Promise<unknown>, reason: string): Promise<void> {
  await assert.rejects(run, (err: unknown) => {
    assert.ok(err instanceof ConsumptionMarkerUnavailableError, `expected ConsumptionMarkerUnavailableError, got ${String(err)}`);
    assert.equal(err.reason, reason);
    return true;
  });
}

function waitingItems(count: number, from = 0) {
  return Array.from({ length: count }, (_, i) => ({
    text: `คำถามที่ ${from + i}`, state: 'waiting_user' as const, clarifyQuestion: `ข้อ ${from + i} ปีไหน?`,
  }));
}

describe('Ledger lifecycle: absent stream, missing group and bounded reads (§4)', () => {
  it('AC-01/AC-09: a brand-new chat reads empty, and the read creates no stream or group', async () => {
    const { service, redis } = makeService();

    assert.deepEqual(await service.openWaitingUser('c1', LINE_CHAT_ID, 'u1', NOW), []);

    assert.equal(redis.streams.size, 0, 'a read must never create the stream');
    assert.equal(redis.pels.size, 0, 'a read must never create the consumer group');
    assert.equal(redis.calls.includes('xgroup'), false, 'no XGROUP CREATE in the read path');
    assert.deepEqual(redis.calls, ['xpending', 'exists'], 'EXISTS is read only AFTER the NOGROUP, once');
  });

  it('AC-02: an expired key behaves like a new chat, and the next append recreates stream and group', async () => {
    const { service, redis } = makeService();
    const key = ledgerKey('c1', 'chat1');
    await service.appendSubRequests({ companyId: 'c1', chatKey: 'chat1', turnId: 't1', webhookEventId: 'e1', userId: 'u1', now: NOW, items: waitingItems(1) });
    assert.equal((await service.openWaitingUser('c1', 'chat1', 'u1', NOW)).length, 1);

    redis.expireKey(key); // TTL elapsed: stream and group both gone

    assert.deepEqual(await service.openWaitingUser('c1', 'chat1', 'u1', NOW), [], 'expiry reads exactly like a new chat');
    assert.ok(await service.appendTurn({ companyId: 'c1', chatKey: 'chat1', turnId: 't2', webhookEventId: 'e2', userId: 'u1', text: 'ว่าไง', now: NOW }));
    assert.equal(redis.pels.get(key)?.size, 1, 'the append recreates stream and group exactly as before');
    assert.equal(redis.ttls.get(key), 3600);
  });

  it('AC-03: an existing stream whose group vanished fails closed, untouched', async () => {
    const { service, redis } = makeService();
    const key = ledgerKey('c1', 'chat1');
    await service.appendSubRequests({ companyId: 'c1', chatKey: 'chat1', turnId: 't1', webhookEventId: 'e1', userId: 'u1', now: NOW, items: waitingItems(2) });
    redis.destroyGroup(key);
    const entriesBefore = JSON.stringify(redis.streams.get(key));
    redis.calls.length = 0;

    await rejectsWithReason(() => service.openWaitingUser('c1', 'chat1', 'u1', NOW), 'group_missing');

    assert.equal(JSON.stringify(redis.streams.get(key)), entriesBefore, 'entries are never replayed, trimmed or rewritten');
    assert.equal(redis.pels.has(key), false, 'the group is never recreated by a read');
    assert.equal(redis.calls.includes('xgroup'), false, 'no XGROUP CREATE ... 0 and no $ reset');
  });

  it('AC-04: an existing group with an empty PEL still answers the turn normally', async () => {
    const { service, redis } = makeService();
    const key = ledgerKey('c1', 'chat1');
    const id = await service.appendTurn({ companyId: 'c1', chatKey: 'chat1', turnId: 't1', webhookEventId: 'e1', userId: 'u1', text: 'x', now: NOW });
    await service.ack({ key, id: id!, companyId: 'c1', turnId: 't1', kind: 'turn' }, 'acked');
    assert.equal(redis.pels.get(key)?.size, 0);

    assert.deepEqual(await service.openWaitingUser('c1', 'chat1', 'u1', NOW), []);
  });

  it('AC-05: the asker gets their stored file and proof; no other user, chat or company can', async () => {
    const { service } = makeService();
    const pendingMedia = { pendingMediaId: 'pm-1', attachmentId: 'att-1', mimeType: 'image/jpeg' };
    await service.appendSubRequests({
      companyId: 'c1', chatKey: 'chat1', turnId: 't1', webhookEventId: 'e1', userId: 'u1', now: NOW,
      items: [{ text: 'รูปนี้ของอะไร', state: 'waiting_user', clarifyQuestion: 'ใบเสร็จหรือสลิป?', sourceContext: '{"original":"proof"}', pendingMedia }],
    });

    const [open] = await service.openWaitingUser('c1', 'chat1', 'u1', NOW);
    assert.deepEqual(open?.pendingMedia, pendingMedia);
    assert.equal(open?.entry.sourceContext, '{"original":"proof"}');

    assert.deepEqual(await service.openWaitingUser('c1', 'chat1', 'u2', NOW), [], 'another member');
    assert.deepEqual(await service.openWaitingUser('c1', 'chat2', 'u1', NOW), [], 'another chat');
    assert.deepEqual(await service.openWaitingUser('c2', 'chat1', 'u1', NOW), [], 'another company');
  });

  it('AC-07: connection error, WRONGTYPE, a failing EXISTS and an unusable EXISTS reply all fail closed', async () => {
    const outage = makeService();
    outage.redis.failing = true;
    await rejectsWithReason(() => outage.service.openWaitingUser('c1', 'chat1', 'u1', NOW), 'redis_unavailable');

    const wrong = makeService();
    wrong.redis.wrongType.add(ledgerKey('c1', 'chat1'));
    await rejectsWithReason(() => wrong.service.openWaitingUser('c1', 'chat1', 'u1', NOW), 'redis_unavailable');

    const blindExists = makeService();
    blindExists.redis.failExists = true;
    await rejectsWithReason(() => blindExists.service.openWaitingUser('c1', 'chat1', 'u1', NOW), 'redis_unavailable');

    const oddExists = makeService();
    oddExists.redis.existsReply = 7; // not exactly 0 or 1 → absence is not proven
    await rejectsWithReason(() => oddExists.service.openWaitingUser('c1', 'chat1', 'u1', NOW), 'redis_unavailable');
  });

  it('AC-08: a key created between XPENDING and EXISTS fails closed, with no retry loop', async () => {
    const { service, redis } = makeService();
    const key = ledgerKey('c1', 'chat1');
    redis.beforeExists = () => { redis.streams.set(key, []); redis.pels.set(key, new Map()); };

    await rejectsWithReason(() => service.openWaitingUser('c1', 'chat1', 'u1', NOW), 'group_missing');

    assert.equal(redis.xpendingArgs.length, 1, 'exactly one XPENDING — the race is accepted, never retried');
    assert.equal(redis.calls.filter((c) => c === 'exists').length, 1);
  });

  it('R-11: finds the asker’s question past the first page of a busy group chat', async () => {
    const { service, redis } = makeService({ lineAiLedgerMaxLen: 500 });
    const base = { companyId: 'c1', chatKey: 'group1', turnId: 't1', webhookEventId: 'e1', now: NOW };
    await service.appendSubRequests({ ...base, userId: 'other', items: waitingItems(55) });
    await service.appendSubRequests({ ...base, userId: 'u1', items: [{ text: 'บันทึกบิล 9/11/37', state: 'waiting_user', clarifyQuestion: 'ปีไหน?' }] });

    const open = await service.openWaitingUser('c1', 'group1', 'u1', NOW);

    assert.equal(open.length, 1, 'entry 56 must not be invisible because 50 other members came first');
    assert.equal(open[0].question, 'ปีไหน?');
    assert.equal(redis.xpendingArgs.length, 2);
    assert.ok(redis.xpendingArgs[1].start.startsWith('('), 'the next page starts at an exclusive id');
  });

  it('R-11: an exhausted scan budget is an explicit incomplete read, never an empty list', async () => {
    const { service } = makeService({ lineAiLedgerMaxLen: 500 });
    await service.appendSubRequests({ companyId: 'c1', chatKey: 'group1', turnId: 't1', webhookEventId: 'e1', userId: 'other', now: NOW, items: waitingItems(201) });

    // Returning [] here would invite a brand-new capture for a message that is an answer.
    await rejectsWithReason(() => service.openWaitingUser('c1', 'group1', 'u1', NOW), 'scan_incomplete');
  });

  it('R-11: a malformed XPENDING reply is a protocol failure, not an empty PEL', async () => {
    for (const reply of ['not-an-array', null, [['ok', 'c', 0, 1], [42, 'c', 0, 1]]]) {
      const { service, redis } = makeService();
      await service.appendSubRequests({ companyId: 'c1', chatKey: 'chat1', turnId: 't1', webhookEventId: 'e1', userId: 'u1', now: NOW, items: waitingItems(1) });
      redis.malformedPending = reply;
      await rejectsWithReason(() => service.openWaitingUser('c1', 'chat1', 'u1', NOW), 'malformed_response');
    }
  });

  it('R-11: reclaim isolates a vanished key and a corrupt group, and still claims the healthy one', async () => {
    const { service, redis, logs } = makeService();
    for (const chatKey of ['corrupt', 'healthy']) {
      await service.appendTurn({ companyId: 'c1', chatKey, turnId: `t-${chatKey}`, webhookEventId: `e-${chatKey}`, userId: 'u1', text: 'x', now: NOW });
    }
    redis.destroyGroup(ledgerKey('c1', 'corrupt'));
    redis.scanExtraKeys.push(ledgerKey('c1', 'vanished')); // SCAN saw it; its TTL elapsed since
    redis.nowMs += 5000;
    redis.calls.length = 0;

    const claimed = await service.claimOpenEntries(10, 1000);

    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].entry.chatKey, 'healthy', 'one bad key must not cost the batch every later key');
    assert.equal(redis.calls.includes(`xautoclaim:${ledgerKey('c1', 'vanished')}`), true, 'the sweep continued past both bad keys');
    assert.equal(redis.calls.includes('xgroup'), false, 'a corrupt group is reported, never recreated');
    assert.equal(logs.filter((l) => l.payload?.msg === 'ai.line.ledger.claim_group_missing').length, 1, 'corruption is distinct from normal expiry');
  });

  it('R-11: a genuine Redis outage stops the reclaim batch instead of timing out on every key', async () => {
    const { service, redis } = makeService();
    for (const chatKey of ['first', 'second']) {
      await service.appendTurn({ companyId: 'c1', chatKey, turnId: `t-${chatKey}`, webhookEventId: `e-${chatKey}`, userId: 'u1', text: 'x', now: NOW });
    }
    redis.failKeys.add(ledgerKey('c1', 'first'));
    redis.nowMs += 5000;

    assert.deepEqual(await service.claimOpenEntries(10, 1000), []);
    assert.equal(redis.calls.includes(`xautoclaim:${ledgerKey('c1', 'second')}`), false, 'no grinding through 200 keys at one command timeout each');
  });

  it('AC-13: lifecycle logs carry a hash and a reason — never the raw key, and absence is not an outage', async () => {
    const { service, redis, logs } = makeService();

    await service.openWaitingUser('c1', LINE_CHAT_ID, 'u1', NOW);
    const absent = logs.at(-1)!;
    assert.equal(absent.level, 'log', 'a confirmed-absent stream is normal lifecycle, never a warning');
    assert.equal(absent.payload.reason, 'stream_absent');
    assert.equal(absent.payload.chatKeyHash, hashMessagePreview(LINE_CHAT_ID));

    await service.appendSubRequests({ companyId: 'c1', chatKey: LINE_CHAT_ID, turnId: 't1', webhookEventId: 'e1', userId: 'u1', now: NOW, items: waitingItems(1) });
    redis.destroyGroup(ledgerKey('c1', LINE_CHAT_ID));
    await assert.rejects(() => service.openWaitingUser('c1', LINE_CHAT_ID, 'u1', NOW));

    const rendered = JSON.stringify(logs);
    assert.equal(rendered.includes(LINE_CHAT_ID), false, 'the raw LINE id must never reach a log');
    assert.equal(rendered.includes(ledgerKey('c1', LINE_CHAT_ID)), false, 'nor the raw Redis key the NOGROUP error embeds');
    assert.equal(logs.at(-1)!.payload.reason, 'group_missing');
  });
});

/**
 * Optional real-Redis coverage: a fake is only ever as faithful as the last incident taught us, and
 * this one was invisible for exactly that reason. Runs only with `LINE_AI_LEDGER_REDIS_TEST_URL`
 * set, against a dedicated db index, on synthetic keys it creates under a random tag. It deletes
 * only those exact keys — never FLUSHDB/FLUSHALL/KEYS and never a scan-delete.
 */
const redisTestUrl = process.env.LINE_AI_LEDGER_REDIS_TEST_URL;

describe('LineAiLedgerService on real Redis Streams', { skip: !redisTestUrl }, () => {
  /**
   * One client and one random tag per test. `own()`/`keyFor()` name a key AND register it, and the
   * teardown deletes exactly those keys — no SCAN, no pattern, nothing this test did not create.
   * `claimOpenEntries` is deliberately never exercised here: its SCAN would reach keys that belong
   * to other sessions sharing this server.
   */
  async function withRealRedis(
    run: (ctx: {
      service: LineAiLedgerService;
      client: Redis;
      companyId: string;
      otherCompanyId: string;
      chat: (name: string) => string;
      own: (name: string) => string;
      keyFor: (companyId: string, name: string) => string;
    }) => Promise<void>,
    config: Record<string, unknown> = {},
  ): Promise<void> {
    const url = new URL(redisTestUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'local Redis only');
    assert.ok(url.pathname !== '' && url.pathname !== '/' && url.pathname !== '/0', 'use a dedicated db index, never the default');
    const client = new Redis(redisTestUrl!, { maxRetriesPerRequest: 1, commandTimeout: 2000 });
    const tag = randomUUID();
    const companyId = `company-${tag}`;
    const otherCompanyId = `company-other-${tag}`;
    const chat = (name: string) => `chat-${name}-${tag}`;
    const tracked = new Set<string>();
    const keyFor = (cid: string, name: string) => {
      const key = ledgerKey(cid, chat(name));
      tracked.add(key);
      return key;
    };
    const own = (name: string) => keyFor(companyId, name);
    const { service } = makeService(config);
    service.attachClient(client as unknown as LedgerRedis);
    try {
      await run({ service, client, companyId, otherCompanyId, chat, own, keyFor });
    } finally {
      if (tracked.size > 0) await client.del(...tracked);
      await client.quit();
    }
  }

  it('tells an absent stream, an expired key and a destroyed group apart', async () => {
    await withRealRedis(async ({ service, client, companyId, chat, own }) => {
      const seed = (name: string) => service.appendSubRequests({
        companyId, chatKey: chat(name), turnId: 't1', webhookEventId: 'e1', userId: 'u1', now: NOW, items: waitingItems(1),
      });

      // 1. Never created: real Redis raises NOGROUP, absence is confirmed, the turn proceeds.
      assert.deepEqual(await service.openWaitingUser(companyId, chat('fresh'), 'u1', NOW), []);
      assert.equal(await client.exists(own('fresh')), 0, 'and the read created nothing');

      // 2. A key whose TTL elapsed reads exactly like a brand-new chat.
      await seed('expiring');
      assert.equal((await service.openWaitingUser(companyId, chat('expiring'), 'u1', NOW)).length, 1);
      await client.pexpire(own('expiring'), 50);
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.deepEqual(await service.openWaitingUser(companyId, chat('expiring'), 'u1', NOW), []);

      // 3. Entries still there, group gone: fail closed and never repair.
      await seed('destroyed');
      await client.xgroup('DESTROY', own('destroyed'), LEDGER_GROUP);
      await rejectsWithReason(() => service.openWaitingUser(companyId, chat('destroyed'), 'u1', NOW), 'group_missing');
      assert.equal(await client.xlen(own('destroyed')), 1, 'entries untouched');
      assert.deepEqual(await client.xinfo('GROUPS', own('destroyed')), [], 'the group is never recreated by a read');

      // 4. Group present, PEL emptied by an ack: an ordinary empty read.
      const id = await service.appendTurn({ companyId, chatKey: chat('empty'), turnId: 't1', webhookEventId: 'e1', userId: 'u1', text: 'x', now: NOW });
      await service.ack({ key: own('empty'), id: id!, companyId, turnId: 't1', kind: 'turn' }, 'acked');
      assert.deepEqual(await service.openWaitingUser(companyId, chat('empty'), 'u1', NOW), []);
    });
  });

  /** The exclusive `(<id>` start is OUR pagination invention; only a real server can prove the
   *  `XPENDING key group (<id> + 50` form does what the fake assumes it does. */
  it('pages the real XPENDING by exclusive id and finds the asker beyond the first page', async () => {
    await withRealRedis(async ({ service, companyId, chat, own }) => {
      own('busy');
      const base = { companyId, chatKey: chat('busy'), turnId: 't1', webhookEventId: 'e1', now: NOW };
      await service.appendSubRequests({ ...base, userId: 'other', items: waitingItems(55) });
      await service.appendSubRequests({ ...base, userId: 'u1', items: [{ text: 'บันทึกบิล 9/11/37', state: 'waiting_user', clarifyQuestion: 'ปีไหน?' }] });

      const open = await service.openWaitingUser(companyId, chat('busy'), 'u1', NOW);

      assert.equal(open.length, 1, 'entry 56 must not be invisible because 55 other members came first');
      assert.equal(open[0].question, 'ปีไหน?');
    }, { lineAiLedgerMaxLen: 500 });
  });

  it('raises scan_incomplete when a real PEL outruns the page budget', async () => {
    await withRealRedis(async ({ service, companyId, chat, own }) => {
      own('flood');
      await service.appendSubRequests({
        companyId, chatKey: chat('flood'), turnId: 't1', webhookEventId: 'e1', userId: 'other', now: NOW, items: waitingItems(201),
      });

      await rejectsWithReason(() => service.openWaitingUser(companyId, chat('flood'), 'u1', NOW), 'scan_incomplete');
    }, { lineAiLedgerMaxLen: 500 });
  });

  it('treats a key of the wrong type as a Redis failure, never as an absent stream', async () => {
    await withRealRedis(async ({ service, client, companyId, chat, own }) => {
      await client.set(own('stringy'), 'not-a-stream'); // real WRONGTYPE, not a fabricated one

      await rejectsWithReason(() => service.openWaitingUser(companyId, chat('stringy'), 'u1', NOW), 'redis_unavailable');
    });
  });

  it('isolates the asker from another member, another chat and another company', async () => {
    await withRealRedis(async ({ service, client, companyId, otherCompanyId, chat, own, keyFor }) => {
      const pendingMedia = { pendingMediaId: 'pm-1', attachmentId: 'att-1', mimeType: 'image/jpeg' };
      own('iso');
      const otherChatKey = own('iso-elsewhere');
      const otherCompanyKey = keyFor(otherCompanyId, 'iso');
      await service.appendSubRequests({
        companyId, chatKey: chat('iso'), turnId: 't1', webhookEventId: 'e1', userId: 'u1', now: NOW,
        items: [{ text: 'รูปนี้ของอะไร', state: 'waiting_user', clarifyQuestion: 'ใบเสร็จหรือสลิป?', sourceContext: '{"original":"proof"}', pendingMedia }],
      });

      const [open] = await service.openWaitingUser(companyId, chat('iso'), 'u1', NOW);
      assert.deepEqual(open?.pendingMedia, pendingMedia);
      assert.equal(open?.entry.sourceContext, '{"original":"proof"}');

      // Another member reads the SAME live stream and its non-empty PEL, and still gets nothing.
      assert.deepEqual(await service.openWaitingUser(companyId, chat('iso'), 'u2', NOW), []);

      // Another chat and another company are different keys entirely: absent, hence empty.
      assert.deepEqual(await service.openWaitingUser(companyId, chat('iso-elsewhere'), 'u1', NOW), []);
      assert.equal(await client.exists(otherChatKey), 0, 'a sibling chat is a separate, absent key');
      assert.deepEqual(await service.openWaitingUser(otherCompanyId, chat('iso'), 'u1', NOW), []);
      assert.equal(await client.exists(otherCompanyKey), 0, 'and so is another tenant');
    });
  });
});

describe('read period clarification round trip', () => {
  it('stores only a read ask-back marker and returns it only to the asker', async () => {
    const { service } = makeService();
    const coverage = [{ index: 0, status: 'needs_user', reasonCode: 'READ_FILTER_NOT_UNDERSTOOD', question: 'ปีไหนคะ' }] as const;
    const sub = { index: 0, kind: 'read', goal: 'สรุปค่าใช้จ่ายเดือนสิงหาคม', requiredEvidence: [], requestedFilters: {}, dependsOn: [] };
    const items = service.coverageToSubRequests(undefined, [...coverage], [sub] as any);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.reasonCode, 'READ_FILTER_NOT_UNDERSTOOD');
    await service.appendSubRequests({ companyId: 'c1', chatKey: 'group1', userId: 'asker', turnId: 't1', webhookEventId: 'e1', items, now: NOW });
    const open = await service.openWaitingUser('c1', 'group1', 'asker', NOW);
    assert.equal(open[0]?.reasonCode, 'READ_FILTER_NOT_UNDERSTOOD');
    assert.equal(open[0]?.text, sub.goal);
    assert.equal(open[0]?.clarifyForIntent, undefined);
    assert.deepEqual(await service.openWaitingUser('c1', 'group1', 'other', NOW), []);
    for (const kind of ['write', 'file', 'public', 'general', 'help']) {
      assert.deepEqual(service.coverageToSubRequests(undefined, [...coverage], [{ ...sub, kind }] as any), []);
    }
    assert.equal(service.coverageToSubRequests([{ request: 'ถามอื่น', verdict: 'needs_user', question: 'อะไรคะ', reason: 'READ_FILTER_NOT_UNDERSTOOD' }])[0]?.reasonCode, undefined,
      'legacy prose is not a server-observed read marker');
  });
});

it('CARDS-R4 unbound substitute question count survives the owner-bound waiting entry', async () => {
  const { service } = makeService();
  await service.appendSubRequests({ companyId: 'c1', chatKey: 'chat1', turnId: 't1', webhookEventId: 'evt1', userId: 'u1', now: NOW,
    items: [{ text: 'ทำใบรับรองแทนใบเสร็จจากเมนู', state: 'waiting_user', clarifyQuestion: 'เลือกรายการ', clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION', candidateExpenseIds: ['one', 'two'], substituteTargetQuestionCount: 2 }] });
  assert.equal((await service.openWaitingUser('c1', 'chat1', 'u1', NOW))[0]?.entry.substituteTargetQuestionCount, 2);
  assert.deepEqual(await service.openWaitingUser('c1', 'chat1', 'other', NOW), []);
});
