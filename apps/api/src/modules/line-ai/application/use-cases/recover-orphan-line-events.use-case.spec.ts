import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RecoverOrphanLineEventsUseCase, parseBufferEnvelope, ORPHAN_REPLAY_MAX_AGE_MS } from './recover-orphan-line-events.use-case';
import { LINE_BUFFER_ORPHAN_REPROCESS_MS } from '../../domain/logic/line-message-buffer.logic';

type Row = {
  id: string;
  webhookEventId: string;
  status: string;
  errorCode: string | null;
  payloadJson: unknown;
  processedAt: Date | null;
  createdAt: Date;
};

const envelopeFor = (id: string) => ({
  chatId: 'U-chat',
  lineUserId: 'U-user',
  messagingChannelId: '2010',
  item: { kind: 'text', webhookEventId: id, replyToken: 'token', text: 'ยอดขายเดือนนี้', timestamp: 1 },
});

function makeHarness(rows: Row[], opts: { casWins?: boolean; enqueueThrows?: boolean; retentionDays?: number } = {}) {
  const store = new Map(rows.map((row) => [row.id, { ...row }]));
  const enqueued: any[] = [];
  const audits: any[] = [];

  const prisma = {
    client: {
      lineWebhookEventLog: {
        findMany: async ({ where, take }: any) => {
          const list = [...store.values()].filter((row) => {
            if (where.payloadJson && row.payloadJson == null) return false;
            if (where.createdAt?.lte && row.createdAt > where.createdAt.lte) return false;
            if (where.createdAt?.lt && row.createdAt >= where.createdAt.lt) return false;
            if (!where.OR) return true;
            return where.OR.some((clause: any) => {
              if (clause.status !== row.status) return false;
              if (clause.errorCode === null) return row.errorCode === null;
              if (clause.errorCode?.startsWith) return (row.errorCode ?? '').startsWith(clause.errorCode.startsWith);
              return true;
            });
          });
          list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          return list.slice(0, take);
        },
        updateMany: async ({ where, data }: any) => {
          const row = store.get(where.id);
          if (!row || row.status !== where.status || (row.errorCode ?? null) !== (where.errorCode ?? null)) return { count: 0 };
          if (opts.casWins === false) return { count: 0 };
          Object.assign(row, data, { payloadJson: 'payloadJson' in data ? null : row.payloadJson });
          return { count: 1 };
        },
        deleteMany: async ({ where }: any) => {
          let count = 0;
          for (const id of where.id.in as string[]) if (store.delete(id)) count += 1;
          return { count };
        },
      },
    },
  } as any;

  const config = { aiDataRetentionDays: opts.retentionDays ?? 90 } as any;
  const audit = { log: async (entry: any) => { audits.push(entry); } } as any;
  const buffer = {
    enqueue: async (envelope: any) => {
      if (opts.enqueueThrows) throw new Error('buffer unavailable');
      enqueued.push(envelope);
    },
  } as any;

  return { useCase: new RecoverOrphanLineEventsUseCase(prisma, config, audit, buffer), store, enqueued, audits };
}

const rowAt = (id: string, ageMs: number, over: Partial<Row> = {}): Row => ({
  id,
  webhookEventId: id,
  status: 'received',
  errorCode: null,
  payloadJson: envelopeFor(id),
  processedAt: null,
  createdAt: new Date(Date.now() - ageMs),
  ...over,
});

describe('parseBufferEnvelope', () => {
  it('accepts a stored text envelope', () => {
    assert.equal(parseBufferEnvelope(envelopeFor('e1'))?.chatId, 'U-chat');
  });

  it('rejects junk instead of throwing mid-sweep', () => {
    for (const value of [null, 'text', [], {}, { chatId: 'c' }, { ...envelopeFor('e1'), item: { kind: 'text', webhookEventId: 'e1', replyToken: 't' } }]) {
      assert.equal(parseBufferEnvelope(value), null);
    }
  });
});

describe('RecoverOrphanLineEventsUseCase', () => {
  it('replays an orphaned row through the buffer and marks it reclaimable', async () => {
    const { useCase, store, enqueued } = makeHarness([rowAt('e1', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000)]);
    const result = await useCase.execute();
    assert.equal(result.replayed, 1);
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0].item.webhookEventId, 'e1');
    // acceptEvent() only reclaims `received` + RETRYABLE_, so the stamp is what makes replay work.
    assert.equal(store.get('e1')?.status, 'received');
    assert.equal(store.get('e1')?.errorCode, 'RETRYABLE_ORPHAN_REPLAY');
    assert.equal(store.get('e1')?.processedAt, null);
  });

  it('leaves an in-flight row alone', async () => {
    const { useCase, enqueued } = makeHarness([rowAt('e2', 5_000)]);
    const result = await useCase.execute();
    assert.equal(result.replayed, 0);
    assert.equal(enqueued.length, 0);
  });

  it('replays a row parked by a failed dispatch notice', async () => {
    const { useCase, enqueued } = makeHarness([
      rowAt('e3', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000, { status: 'delivery_pending', errorCode: 'RETRYABLE_LINE_BUFFER_DISPATCH_FAILED' }),
    ]);
    const result = await useCase.execute();
    assert.equal(result.replayed, 1);
    assert.equal(enqueued[0].item.webhookEventId, 'e3');
  });

  it('parks an over-age row instead of answering a stale question, and drops its payload', async () => {
    const { useCase, store, enqueued } = makeHarness([rowAt('e4', ORPHAN_REPLAY_MAX_AGE_MS + 60_000)]);
    const result = await useCase.execute();
    assert.equal(result.expired, 1);
    assert.equal(enqueued.length, 0);
    assert.equal(store.get('e4')?.status, 'orphan_expired');
    assert.equal(store.get('e4')?.payloadJson, null);
  });

  it('parks an unreadable payload without replaying it', async () => {
    const { useCase, store, enqueued } = makeHarness([rowAt('e5', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000, { payloadJson: { chatId: 'only' } })]);
    const result = await useCase.execute();
    assert.equal(result.skipped, 1);
    assert.equal(enqueued.length, 0);
    assert.equal(store.get('e5')?.status, 'orphan_unreadable');
  });

  it('never double-replays when another sweeper won the row', async () => {
    const { useCase, enqueued } = makeHarness([rowAt('e6', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000)], { casWins: false });
    const result = await useCase.execute();
    assert.equal(result.replayed, 0);
    assert.equal(result.skipped, 1);
    assert.equal(enqueued.length, 0);
  });

  it('does not replay a row whose turn already answered with an error', async () => {
    // executeReceiptUpload / media download answer the user, then release the row as RETRYABLE_.
    // Replaying those would send a second error message on every tick.
    const { useCase, enqueued } = makeHarness([
      rowAt('e7', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000, { errorCode: 'RETRYABLE_LINE_MEDIA_DOWNLOAD_FAILED' }),
    ]);
    const result = await useCase.execute();
    assert.equal(result.replayed, 0);
    assert.equal(enqueued.length, 0);
  });

  it('stops replaying a row the buffer never took back', async () => {
    const rows = [rowAt('e8', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000)];
    const { useCase, store, enqueued } = makeHarness(rows, { enqueueThrows: true });
    await useCase.execute();
    // Still `received`, but now stamped — the next tick must not enqueue it a second time.
    assert.equal(store.get('e8')?.status, 'received');
    assert.equal(store.get('e8')?.errorCode, 'RETRYABLE_ORPHAN_REPLAY');
    const second = await useCase.execute();
    assert.equal(second.replayed, 0);
    assert.equal(enqueued.length, 0);
  });

  it('purges event rows past the AI retention window', async () => {
    const day = 24 * 60 * 60 * 1000;
    const { useCase, store } = makeHarness([
      rowAt('old', 91 * day, { status: 'completed', payloadJson: null }),
      rowAt('recent', 2 * day, { status: 'completed', payloadJson: null }),
    ]);
    const result = await useCase.execute();
    assert.equal(result.purged, 1);
    assert.equal(store.has('old'), false);
    assert.equal(store.has('recent'), true);
  });
});
