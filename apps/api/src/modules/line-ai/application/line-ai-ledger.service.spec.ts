import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LineAiLedgerService, ledgerKey, parseLedgerKey, fieldsToEntry, LEDGER_GROUP, type LedgerRedis } from './line-ai-ledger.service';
import { clarificationMarkerKey } from './line-ai-consumption-marker';

// In-memory Redis Streams fake: only the surface the ledger uses (XADD MAXLEN, consumer group
// PEL semantics, XAUTOCLAIM idle/delivery counting, XRANGE/XPENDING/SCAN/EXPIRE).
class FakeRedis implements LedgerRedis {
  nowMs = 1_000_000;
  streams = new Map<string, Array<{ id: string; fields: string[] }>>();
  pels = new Map<string, Map<string, { deliveryCount: number; lastDeliveryMs: number }>>();
  delivered = new Map<string, Set<string>>();
  ttls = new Map<string, number>();
  failing = false;
  private seq = 0;

  private assertUp(): void {
    if (this.failing) throw new Error('connection refused');
  }

  async xgroup(...args: Array<string | number>): Promise<unknown> {
    this.assertUp();
    const key = String(args[1]);
    if (this.pels.has(key)) throw new Error('BUSYGROUP Consumer Group name already exists');
    this.streams.set(key, this.streams.get(key) ?? []);
    this.pels.set(key, new Map());
    this.delivered.set(key, new Set());
    return 'OK';
  }

  async xadd(...args: Array<string | number>): Promise<string | null> {
    this.assertUp();
    const key = String(args[0]);
    const maxlen = Number(args[3]);
    const pairs = args.slice(5).map(String);
    const id = `${++this.seq}-0`;
    const stream = this.streams.get(key) ?? [];
    stream.push({ id, fields: pairs });
    while (stream.length > maxlen) {
      const dropped = stream.shift();
      if (dropped) {
        this.pels.get(key)?.delete(dropped.id);
        this.delivered.get(key)?.delete(dropped.id);
      }
    }
    this.streams.set(key, stream);
    return id;
  }

  async xreadgroup(...args: Array<string | number>): Promise<unknown> {
    this.assertUp();
    const key = String(args[6]);
    const stream = this.streams.get(key) ?? [];
    const seen = this.delivered.get(key) ?? new Set<string>();
    const pel = this.pels.get(key) ?? new Map();
    const fresh = stream.filter((e) => !seen.has(e.id));
    for (const entry of fresh) {
      seen.add(entry.id);
      pel.set(entry.id, { deliveryCount: 1, lastDeliveryMs: this.nowMs });
    }
    this.delivered.set(key, seen);
    this.pels.set(key, pel);
    return fresh.length > 0 ? [[key, fresh.map((e) => [e.id, e.fields])]] : null;
  }

  async xack(key: string, _group: string, id: string): Promise<number> {
    this.assertUp();
    return this.pels.get(key)?.delete(id) ? 1 : 0;
  }

  async xautoclaim(...args: Array<string | number>): Promise<unknown> {
    this.assertUp();
    const key = String(args[0]);
    const minIdle = Number(args[3]);
    const count = Number(args[6]);
    const pel = this.pels.get(key) ?? new Map<string, { deliveryCount: number; lastDeliveryMs: number }>();
    const stream = this.streams.get(key) ?? [];
    const claimed: Array<[string, string[]]> = [];
    for (const [id, meta] of pel) {
      if (claimed.length >= count) break;
      if (this.nowMs - meta.lastDeliveryMs < minIdle) continue;
      meta.deliveryCount += 1;
      meta.lastDeliveryMs = this.nowMs;
      const entry = stream.find((e) => e.id === id);
      if (entry) claimed.push([entry.id, entry.fields]);
    }
    return ['0-0', claimed, []];
  }

  async xrange(key: string, start: string, end: string): Promise<Array<[string, string[]]>> {
    this.assertUp();
    const stream = this.streams.get(key) ?? [];
    return stream
      .filter((e) => (start === '-' || e.id >= start) && (end === '+' || e.id <= end))
      .map((e) => [e.id, e.fields]);
  }

  async xpending(...args: Array<string | number>): Promise<unknown> {
    this.assertUp();
    const key = String(args[0]);
    const pel = this.pels.get(key) ?? new Map<string, { deliveryCount: number; lastDeliveryMs: number }>();
    return [...pel.entries()].map(([id, meta]) => [id, 'consumer', this.nowMs - meta.lastDeliveryMs, meta.deliveryCount]);
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.assertUp();
    this.ttls.set(key, seconds);
    return 1;
  }

  async scan(_cursor: string, ...args: Array<string | number>): Promise<[string, string[]]> {
    this.assertUp();
    const pattern = String(args[1]).replace('*', '');
    return ['0', [...this.streams.keys()].filter((k) => k.startsWith(pattern))];
  }

  async quit(): Promise<unknown> { return 'OK'; }
}

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
  const redis = new FakeRedis();
  service.attachClient(redis);
  return { service, redis, auditEvents, prisma, markerKeys, markerState };
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
    const { service, markerKeys } = makeService();
    await service.appendSubRequests({
      companyId: 'c1', chatKey: 'chat1', turnId: 't1', webhookEventId: 'evt1', userId: 'u1', now: NOW,
      items: [{ text: 'แก้ยอด', state: 'waiting_user', clarifyQuestion: 'รายการไหน' }],
    });
    const [open] = await service.openWaitingUser('c1', 'chat1', 'u1', NOW);
    assert.ok(open);

    // The mutation committed and wrote the marker; XACK then failed and was swallowed.
    markerKeys.add(clarificationMarkerKey('c1', ledgerKey('c1', 'chat1'), open.id));

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
    await assert.rejects(() => service.openWaitingUser('c1', 'chat1', 'u1', NOW), /consumption_marker_unavailable/);
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

  it('fails open on every operation when Redis is down (turn proceeds unledgered)', async () => {
    const { service, redis } = makeService();
    redis.failing = true;
    assert.equal(await service.appendTurn({ companyId: 'c1', chatKey: 'chat1', turnId: 't1', webhookEventId: 'e1', userId: 'u1', text: 'x', now: NOW }), null);
    assert.deepEqual(await service.openWaitingUser('c1', 'chat1', 'u1', NOW), []);
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
});
