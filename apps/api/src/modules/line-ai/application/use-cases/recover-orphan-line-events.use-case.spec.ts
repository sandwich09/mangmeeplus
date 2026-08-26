import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RecoverOrphanLineEventsUseCase, parseBufferEnvelope, parseOutcomeMessages, ORPHAN_REPLAY_MAX_AGE_MS } from './recover-orphan-line-events.use-case';
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

type Outcome = { webhookEventId: string; messagesJson: unknown; attempts: number; deliveredAt: Date | null };

/** The exact rendered payload a turn would have delivered — a Flex card, not a text preview. */
const STORED_MESSAGES = [
  { type: 'flex', altText: 'ยอดขายเดือนนี้ 125,000 บาท', contents: { type: 'bubble' } },
] as const;

const envelopeFor = (id: string) => ({
  chatId: 'U-chat',
  lineUserId: 'U-user',
  messagingChannelId: '2010',
  item: { kind: 'text', webhookEventId: id, replyToken: 'token', text: 'ยอดขายเดือนนี้', timestamp: 1 },
});

function makeHarness(rows: Row[], opts: {
  casWins?: boolean;
  enqueueThrows?: boolean;
  retentionDays?: number;
  /** §8.3 durable terminal-outcome replay (LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED). Default off. */
  replayEnabled?: boolean;
  outcomes?: Outcome[];
  pushResult?: string;
  pushThrows?: boolean;
} = {}) {
  const store = new Map(rows.map((row) => [row.id, { ...row }]));
  const outcomeStore = new Map((opts.outcomes ?? []).map((outcome) => [outcome.webhookEventId, { ...outcome }]));
  const enqueued: any[] = [];
  const audits: any[] = [];
  const pushes: Array<{ to: string; messages: any[] }> = [];

  const prisma = {
    client: {
      lineTurnOutcome: {
        findMany: async ({ where }: any) => [...outcomeStore.values()].filter((outcome) => (
          (where.webhookEventId?.in as string[] | undefined)?.includes(outcome.webhookEventId) !== false
          && (where.deliveredAt !== null || outcome.deliveredAt === null)
        )),
        updateMany: async ({ where, data }: any) => {
          const outcome = outcomeStore.get(where.webhookEventId);
          if (!outcome || (where.deliveredAt === null && outcome.deliveredAt !== null)) return { count: 0 };
          if (data.attempts?.increment) outcome.attempts += data.attempts.increment;
          if (data.deliveredAt) outcome.deliveredAt = data.deliveredAt;
          return { count: 1 };
        },
      },
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

  const config = {
    aiDataRetentionDays: opts.retentionDays ?? 90,
    lineAiTerminalOutcomeReplayEnabled: opts.replayEnabled ?? false,
  } as any;
  const audit = { log: async (entry: any) => { audits.push(entry); } } as any;
  const buffer = {
    enqueue: async (envelope: any) => {
      if (opts.enqueueThrows) throw new Error('buffer unavailable');
      enqueued.push(envelope);
    },
  } as any;
  const lineReply = {
    sendPush: async (to: string, messages: any[]) => {
      if (opts.pushThrows) throw new Error('LINE unreachable');
      pushes.push({ to, messages });
      return opts.pushResult ?? 'ok';
    },
    sendReply: async () => { throw new Error('a replay must never spend a reply token'); },
  } as any;

  return {
    useCase: new RecoverOrphanLineEventsUseCase(prisma, config, audit, buffer, lineReply),
    store, outcomeStore, enqueued, audits, pushes,
  };
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

describe('parseOutcomeMessages', () => {
  it('accepts a stored LINE message array', () => {
    assert.equal(parseOutcomeMessages(STORED_MESSAGES)?.length, 1);
    assert.equal(parseOutcomeMessages([{ type: 'text', text: 'สรุปยอด' }])?.length, 1);
  });

  it('refuses anything that would push a half-formed payload into a real chat', () => {
    for (const value of [null, [], 'text', {}, [{ type: 'text' }], [{ type: 'flex', altText: 'a' }], [{ type: 'sticker' }]]) {
      assert.equal(parseOutcomeMessages(value), null, JSON.stringify(value));
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

  it('replays a response claim interrupted before the fallback delivery result was persisted', async () => {
    const { useCase, enqueued } = makeHarness([
      rowAt('e3-claimed', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000, {
        status: 'response_ready',
        errorCode: 'RETRYABLE_LINE_BUFFER_DISPATCH_FAILED',
      }),
    ]);
    const result = await useCase.execute();
    assert.equal(result.replayed, 1);
    assert.equal(enqueued[0].item.webhookEventId, 'e3-claimed');
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

  it('leaves a failed in-turn delivery alone while the replay flag is off', async () => {
    // Default-off must select exactly the rows it selects today: a `LINE_DELIVERY_*` row is not in
    // any legacy arm, so nothing may touch it even when an outcome happens to exist.
    const { useCase, store, enqueued, pushes } = makeHarness([
      rowAt('off-1', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000, { status: 'delivery_pending', errorCode: 'LINE_DELIVERY_FAILED_OTHER' }),
    ], { outcomes: [{ webhookEventId: 'off-1', messagesJson: STORED_MESSAGES, attempts: 1, deliveredAt: null }] });
    const result = await useCase.execute();
    assert.equal(result.replayed, 0);
    assert.equal(enqueued.length, 0);
    assert.equal(pushes.length, 0);
    assert.equal(store.get('off-1')?.errorCode, 'LINE_DELIVERY_FAILED_OTHER', 'the row is untouched');
  });

  it('pushes the STORED outcome verbatim and never re-routes the input (§8.3)', async () => {
    const { useCase, store, outcomeStore, enqueued, pushes } = makeHarness([
      rowAt('replay-1', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000, { status: 'delivery_pending', errorCode: 'LINE_DELIVERY_FAILED_TOKEN' }),
    ], { replayEnabled: true, outcomes: [{ webhookEventId: 'replay-1', messagesJson: STORED_MESSAGES, attempts: 1, deliveredAt: null }] });

    const result = await useCase.execute();

    assert.equal(result.replayed, 1);
    // The whole point of the gap: re-routing may answer the same question differently, so the buffer
    // (and with it the intake router) must not be called at all.
    assert.equal(enqueued.length, 0, 'a stored outcome is replayed, never re-routed');
    assert.equal(pushes.length, 1, 'exactly one push, and no reply token is spent');
    assert.equal(pushes[0]!.to, 'U-chat', 'pushed into the source chat, not the user id');
    assert.deepEqual(pushes[0]!.messages, STORED_MESSAGES, 'byte-for-byte the rendered payload');
    // Delivery — and only delivery — closes the turn.
    assert.equal(store.get('replay-1')?.status, 'completed');
    assert.equal(store.get('replay-1')?.errorCode, null);
    assert.equal(store.get('replay-1')?.payloadJson, null, 'raw chat ids leave with the terminal status');
    assert.ok(outcomeStore.get('replay-1')?.deliveredAt instanceof Date, 'deliveredAt is the separate delivery status');
    assert.equal(outcomeStore.get('replay-1')?.attempts, 2, 'attempts counts sends, not successes');
  });

  it('keeps the row claimable when the replay push does not reach LINE', async () => {
    const { useCase, store, outcomeStore, pushes } = makeHarness([
      rowAt('replay-2', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000, { status: 'delivery_pending', errorCode: 'LINE_DELIVERY_FAILED_OTHER' }),
    ], {
      replayEnabled: true, pushResult: 'failed_other',
      outcomes: [{ webhookEventId: 'replay-2', messagesJson: STORED_MESSAGES, attempts: 1, deliveredAt: null }],
    });

    const result = await useCase.execute();

    assert.equal(result.replayed, 0);
    assert.equal(result.skipped, 1);
    assert.equal(pushes.length, 1);
    // Still pending, still owed, and stamped RETRYABLE_ so the next tick picks it up again.
    assert.equal(store.get('replay-2')?.status, 'delivery_pending');
    assert.equal(store.get('replay-2')?.errorCode, 'RETRYABLE_OUTCOME_REPLAY');
    assert.equal(outcomeStore.get('replay-2')?.deliveredAt, null, 'a failed push is not a delivery');
  });

  it('never pushes a stored outcome twice when another sweeper won the claim', async () => {
    const { useCase, pushes } = makeHarness([
      rowAt('replay-3', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000, { status: 'delivery_pending', errorCode: 'LINE_DELIVERY_FAILED_OTHER' }),
    ], {
      replayEnabled: true, casWins: false,
      outcomes: [{ webhookEventId: 'replay-3', messagesJson: STORED_MESSAGES, attempts: 1, deliveredAt: null }],
    });
    const result = await useCase.execute();
    assert.equal(result.skipped, 1);
    assert.equal(pushes.length, 0, 'the CAS is what serialises two pods on one chat');
  });

  it('parks an over-age row instead of pushing an hour-old answer', async () => {
    const { useCase, store, pushes } = makeHarness([
      rowAt('replay-4', ORPHAN_REPLAY_MAX_AGE_MS + 60_000, { status: 'delivery_pending', errorCode: 'LINE_DELIVERY_FAILED_OTHER' }),
    ], { replayEnabled: true, outcomes: [{ webhookEventId: 'replay-4', messagesJson: STORED_MESSAGES, attempts: 1, deliveredAt: null }] });
    const result = await useCase.execute();
    assert.equal(result.expired, 1);
    assert.equal(pushes.length, 0, 'the age bound applies to the replay lane too — it IS the retry bound');
    assert.equal(store.get('replay-4')?.status, 'orphan_expired');
  });

  it('falls back to the legacy input replay when no outcome was recorded', async () => {
    // The fail-closed delivery seam parks a row it could not record as LINE_OUTCOME_NOT_RECORDED.
    // Nothing reached the user and nothing is stored, so recomputing is the only honest recovery.
    const { useCase, enqueued, pushes } = makeHarness([
      rowAt('replay-5', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000, { status: 'delivery_pending', errorCode: 'LINE_OUTCOME_NOT_RECORDED' }),
    ], { replayEnabled: true });
    const result = await useCase.execute();
    assert.equal(result.replayed, 1);
    assert.equal(pushes.length, 0);
    assert.equal(enqueued.length, 1, 'no stored outcome means the legacy branch still owns the row');
    assert.equal(enqueued[0].item.webhookEventId, 'replay-5');
  });

  it('parks an unreadable stored outcome rather than pushing a half-formed payload', async () => {
    const { useCase, store, pushes } = makeHarness([
      rowAt('replay-6', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000, { status: 'delivery_pending', errorCode: 'LINE_DELIVERY_FAILED_OTHER' }),
    ], { replayEnabled: true, outcomes: [{ webhookEventId: 'replay-6', messagesJson: [{ type: 'flex' }], attempts: 1, deliveredAt: null }] });
    const result = await useCase.execute();
    assert.equal(result.skipped, 1);
    assert.equal(pushes.length, 0);
    assert.equal(store.get('replay-6')?.errorCode, 'ORPHAN_OUTCOME_UNREADABLE');
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
