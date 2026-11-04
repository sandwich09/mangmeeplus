import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RecoverOrphanLineEventsUseCase, parseBufferEnvelope, parseOutcomeMessages, ORPHAN_REPLAY_MAX_AGE_MS } from './recover-orphan-line-events.use-case';
import { LINE_RECEIPT_RETRY_LEASE_CODE, LINE_RECEIPT_RETRY_LEASE_MS, LINE_RECEIPT_RETRY_WAIT_CODE } from '../company-ocr-governance';
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

type Outcome = { webhookEventId: string; messagesJson: unknown; authorizationJson?: unknown; attempts: number; deliveredAt: Date | null };

/** Capture appendix §8 / D08: a group past the retention window and the files it still holds. */
type RetentionGroup = {
  id: string;
  companyId: string;
  files: Array<{ id: string; attachmentId: string; uploadState?: string; linkedToExpense?: boolean; heldByCertificate?: boolean }>;
};

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
  /** W07-int: capture groups whose `linePushTargetId` the sweep should find past retention. */
  captureGroupsWithPushTarget?: Array<{ id: string }>;
  /** W08 / §8: groups past the window whose files the sweep may delete. */
  retentionGroups?: RetentionGroup[];
  /** §8.3 durable terminal-outcome replay (LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED). Default off. */
  replayEnabled?: boolean;
  outcomes?: Outcome[];
  pushResult?: string;
  pushThrows?: boolean;
  outcomeCasWins?: boolean;
  sourceCurrent?: boolean;
  verifyThrows?: boolean;
  duringVerify?: (store: Map<string, Row>) => void;
  /** Events the buffer still holds in memory (queued behind another read, or mid-turn). */
  held?: string[];
} = {}) {
  const store = new Map(rows.map((row) => [row.id, { ...row }]));
  const outcomeStore = new Map((opts.outcomes ?? []).map((outcome) => [outcome.webhookEventId, { ...outcome, authorizationJson: outcome.authorizationJson === undefined ? { synthetic: 'original-read-proof' } : outcome.authorizationJson }]));
  const enqueued: any[] = [];
  const audits: any[] = [];
  const pushes: Array<{ to: string; messages: any[]; operationId?: string }> = [];

  const capturePushTargetSweeps: any[] = [];
  const capturePushTargetClears: any[] = [];
  const captureRetentionSweeps: any[] = [];
  const captureGroupsWithPushTarget: Array<{ id: string }> = opts.captureGroupsWithPushTarget ?? [];
  const retentionGroups: RetentionGroup[] = opts.retentionGroups ?? [];
  const markedDeleted: string[] = [];
  const detached: any[] = [];
  const cancelledJobs: any[] = [];
  const prisma = {
    client: {
      lineAiTaskRun: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
      lineReadEvidence: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
      lineLedgerDelivery: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
    // The pre-capture LINE intake diagnostic ages out in this same sweep (capture appendix §2.2),
    // and so does the raw chat id a capture group keeps to push its result back (§8, W07-int).
    lineIntakeAttempt: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
      expenseCaptureGroup: {
        findMany: async (args: any) => {
          if (args.where.linePushTargetId) { capturePushTargetSweeps.push(args); return captureGroupsWithPushTarget; }
          captureRetentionSweeps.push(args);
          return retentionGroups.map((group) => ({ id: group.id, companyId: group.companyId }));
        },
        updateMany: async (args: any) => { capturePushTargetClears.push(args); return { count: 1 }; },
      },
      expenseCaptureFile: {
        findMany: async ({ where }: any) => (retentionGroups.find((group) => group.id === where.groupId)?.files ?? [])
          .filter((file) => file.uploadState !== 'DETACHED'),
      },
      attachmentLink: {
        findFirst: async ({ where }: any) => {
          const file = retentionGroups.flatMap((group) => group.files).find((row) => row.attachmentId === where.attachmentId);
          return file?.linkedToExpense ? { id: 'link-1' } : null;
        },
      },
      lineTurnOutcome: {
        findMany: async ({ where }: any) => [...outcomeStore.values()].filter((outcome) => (
          (where.webhookEventId?.in as string[] | undefined)?.includes(outcome.webhookEventId) !== false
          && (where.deliveredAt !== null || outcome.deliveredAt === null)
        )),
        updateMany: async ({ where, data }: any) => {
          if (where.messagesJson && opts.outcomeCasWins === false) return { count: 0 };
          const outcome = outcomeStore.get(where.webhookEventId);
          if (!outcome || (where.deliveredAt === null && outcome.deliveredAt !== null)
            || (where.messagesJson && JSON.stringify(where.messagesJson.equals) !== JSON.stringify(outcome.messagesJson))) return { count: 0 };
          if (data.attempts?.increment) outcome.attempts += data.attempts.increment;
          if (data.deliveredAt) outcome.deliveredAt = data.deliveredAt;
          if (data.messagesJson) outcome.messagesJson = data.messagesJson;
          return { count: 1 };
        },
      },
      lineWebhookEventLog: {
        findMany: async ({ where, take }: any) => {
          const list = [...store.values()].filter((row) => {
            if (where.payloadJson && row.payloadJson == null) return false;
            if (where.createdAt?.lte && row.createdAt > where.createdAt.lte) return false;
            if (where.createdAt?.lt && row.createdAt >= where.createdAt.lt) return false;
            const before = where.AND?.[0]?.OR?.[1]?.processedAt?.lte;
            if (before && row.processedAt && row.processedAt > before) return false;
            if (!where.OR) return true;
            return where.OR.some((clause: any) => {
              if (clause.status !== row.status) return false;
              if (typeof clause.errorCode === 'string' && clause.errorCode !== row.errorCode) return false;
              if (clause.processedAt?.lte && row.processedAt && row.processedAt > clause.processedAt.lte) return false;
              if (clause.errorCode === null) return row.errorCode === null;
              if (typeof clause.errorCode?.startsWith === 'string') return (row.errorCode ?? '').startsWith(clause.errorCode.startsWith);
              return true;
            });
          });
          list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          return list.slice(0, take);
        },
        updateMany: async ({ where, data }: any) => {
          const row = store.get(where.id);
          if (!row || row.status !== where.status || (row.errorCode ?? null) !== (where.errorCode ?? null)) return { count: 0 };
          if (opts.casWins === false || (where.processedAt !== undefined && row.processedAt?.getTime() !== where.processedAt?.getTime())) return { count: 0 };
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
    expenseCaptureRetentionDays: opts.retentionDays ?? 90,
    lineAiTerminalOutcomeReplayEnabled: opts.replayEnabled ?? false,
  } as any;
  const audit = { log: async (entry: any) => { audits.push(entry); } } as any;
  const buffer = {
    enqueue: async (envelope: any, orphanReplay?: boolean) => {
      if (opts.enqueueThrows) throw new Error('buffer unavailable');
      enqueued.push({ ...envelope, orphanReplay });
    },
    holds: (webhookEventId: string) => opts.held?.includes(webhookEventId) ?? false,
  } as any;
  const lineReply = {
    sendPush: async (to: string, messages: any[], operationId?: string) => {
      if (opts.pushThrows) throw new Error('LINE unreachable');
      pushes.push({ to, messages, operationId });
      return opts.pushResult ?? 'ok';
    },
    sendReply: async () => { throw new Error('a replay must never spend a reply token'); },
    buildTextMessage: (text: string) => ({ type: 'text', text }),
  } as any;

  const useCase = new RecoverOrphanLineEventsUseCase(prisma, config, audit, buffer, lineReply);
  const verified: any[] = [];
  (useCase as any).readEvidence = { verifyDelivery: async (proof: any, recipient: any) => {
    verified.push({ proof, recipient }); opts.duringVerify?.(store);
    if (opts.verifyThrows) throw new Error('source unavailable');
    return proof?.synthetic === 'original-read-proof' && opts.sourceCurrent !== false;
  } };
  // The real repository refuses a certified substitute-receipt hold or a live claim by throwing
  // (`prisma-attachment.repository.ts` markDeleted); the sweep must treat that as "leave it".
  (useCase as any).attachments = {
    markDeleted: async ({ id }: { id: string }) => {
      const file = retentionGroups.flatMap((group) => group.files).find((row) => row.attachmentId === id);
      if (file?.heldByCertificate) throw new Error('SUBSTITUTE_EVIDENCE_RETENTION_LOCKED');
      markedDeleted.push(id);
      return { id };
    },
  };
  (useCase as any).capture = {
    markFileDetached: async (_db: unknown, input: unknown) => { detached.push(input); return true; },
    cancelJobsForFile: async (_db: unknown, companyId: string, fileId: string) => { cancelledJobs.push({ companyId, fileId }); return 1; },
  };
  return {
    useCase, verified,
    store, outcomeStore, enqueued, audits, pushes,
    capturePushTargetSweeps, capturePushTargetClears,
    captureRetentionSweeps, markedDeleted, detached, cancelledJobs,
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

describe('AP22 original outcome authorization', () => {
  for (const fault of ['legacy', 'changed', 'unavailable', 'lease-lost', 'unchanged'] as const) it(`revalidates original proof without rerouting: ${fault}`, async () => {
    const id = `authorization-${fault}`;
    const h = makeHarness([rowAt(id, LINE_BUFFER_ORPHAN_REPROCESS_MS + 1000, { status: 'delivery_pending', errorCode: 'LINE_DELIVERY_FAILED_OTHER' })], {
      replayEnabled: true, sourceCurrent: fault !== 'changed', verifyThrows: fault === 'unavailable',
      ...(fault === 'lease-lost' ? { duringVerify: store => { store.get(id)!.processedAt = new Date(Date.now() + 1000); } } : {}),
      outcomes: [{ webhookEventId: id, messagesJson: STORED_MESSAGES, authorizationJson: fault === 'legacy' ? null : { synthetic: 'original-read-proof' }, attempts: 1, deliveredAt: null }],
    });
    const result = await h.useCase.execute();
    assert.equal(h.enqueued.length, 0); assert.equal(h.verified.length, 1);
    assert.equal(h.verified[0].recipient.webhookEventId, id);
    if (fault === 'unchanged') { assert.equal(result.replayed, 1); assert.deepEqual(h.pushes[0].messages, STORED_MESSAGES); }
    else if (fault === 'lease-lost') assert.equal(h.pushes.length, 0);
    else {
      assert.equal(h.store.get(id)?.errorCode, 'LINE_OUTCOME_REAUTHORIZATION_REQUIRED');
      assert.equal(h.outcomeStore.get(id)?.deliveredAt, null);
      assert.equal(h.pushes.length, 1); assert.doesNotMatch(JSON.stringify(h.pushes), /125,000/);
      assert.match(JSON.stringify(h.pushes), /กรุณาเปิดเว็บ/);
      assert.ok(h.audits.some(row => row.metadataJson?.reason === 'outcome_reauthorization_required'));
      await h.useCase.execute(); assert.equal(h.pushes.length, 1, 'the generic notice is attempted once');
    }
  });
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

  it('replays a valid card-bound preview id and rejects malformed or legacy draft postback bindings', () => {
    const previewId = '550e8400-e29b-41d4-a716-446655440000';
    const envelope = envelopeFor('draft-confirm');
    envelope.item.text = 'ยืนยันการแก้ไข';
    (envelope.item as any).draftUpdatePreviewId = previewId;
    assert.equal((parseBufferEnvelope(envelope)?.item as any)?.draftUpdatePreviewId, previewId);
    assert.equal(parseBufferEnvelope({ ...envelope, item: { ...envelope.item, draftUpdatePreviewId: 'bad-id' } }), null);
    assert.equal(parseBufferEnvelope({ ...envelope, item: { ...envelope.item, draftUpdatePreviewId: undefined } }), null);
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
  it('repairs the incident preview before replaying the same complete card, without intake or quota work', async () => {
    const message = { ...STORED_MESSAGES[0], altText: '🧾📋' + 'ก'.repeat(398), canonicalText: 'รายละเอียดครบพร้อมลิงก์ตรวจสอบ' };
    const h = makeHarness([
      rowAt('emoji-result', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000, { status: 'delivery_pending', errorCode: 'LINE_OUTCOME_NOT_RECORDED' }),
    ], { replayEnabled: true, outcomes: [{ webhookEventId: 'emoji-result', messagesJson: [message], attempts: 1, deliveredAt: null }] });
    assert.equal((await h.useCase.execute()).replayed, 1);
    const sent = h.pushes[0]!.messages[0];
    assert.equal(sent.type, 'flex');
    assert.ok(sent.altText.length <= 400);
    assert.deepEqual(sent.contents, message.contents);
    assert.equal(sent.canonicalText, message.canonicalText);
    assert.deepEqual(h.outcomeStore.get('emoji-result')?.messagesJson, [sent]);
    assert.equal(h.pushes[0]!.operationId, 'emoji-result');
    assert.equal(h.enqueued.length, 0, 'no OCR, expense creation or quota re-admission');
    await h.useCase.execute();
    assert.equal(h.pushes.length, 1);
  });

  it('does not send a repaired card after losing either the representation or event claim', async () => {
    for (const opts of [{ outcomeCasWins: false }, { casWins: false }]) {
      const h = makeHarness([
        rowAt('lost-repair', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000, { status: 'delivery_pending', errorCode: 'LINE_OUTCOME_NOT_RECORDED' }),
      ], { ...opts, replayEnabled: true, outcomes: [{ webhookEventId: 'lost-repair', messagesJson: [{ ...STORED_MESSAGES[0], altText: '🧾📋' + 'ก'.repeat(398) }], attempts: 1, deliveredAt: null }] });
      await h.useCase.execute();
      assert.equal(h.pushes.length, 0);
      assert.equal(h.enqueued.length, 0);
    }
  });

  it('keeps full canonical text on a provider-rejected Flex and preserves valid unsent cards', async () => {
    for (const errorCode of ['LINE_OUTCOME_REPRESENTATION_PENDING', 'LINE_OUTCOME_NOT_RECORDED']) {
      const message = { ...STORED_MESSAGES[0], canonicalText: 'รายละเอียดครบ '.repeat(80) };
      const h = makeHarness([
        rowAt('full-fallback', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000, { status: 'delivery_pending', errorCode }),
      ], { replayEnabled: true, outcomes: [{ webhookEventId: 'full-fallback', messagesJson: [message], attempts: 1, deliveredAt: null }] });
      await h.useCase.execute();
      assert.deepEqual(h.pushes[0]!.messages, errorCode === 'LINE_OUTCOME_REPRESENTATION_PENDING'
        ? [{ type: 'text', text: message.canonicalText }] : [message]);
    }
  });
  it('replays an orphaned row through the buffer and marks it reclaimable', async () => {
    const { useCase, store, enqueued } = makeHarness([rowAt('e1', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000)]);
    const result = await useCase.execute();
    assert.equal(result.replayed, 1);
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0].item.webhookEventId, 'e1');
    // Owner 2026-09-30: an already-accepted message is still owed its answer, so it may pass the AI credit cap.
    assert.equal(enqueued[0].orphanReplay, true);
    // acceptEvent() only reclaims `received` + RETRYABLE_, so the stamp is what makes replay work.
    assert.equal(store.get('e1')?.status, 'received');
    assert.equal(store.get('e1')?.errorCode, 'RETRYABLE_ORPHAN_REPLAY');
    assert.equal(store.get('e1')?.processedAt, null);
  });

  // UAT 2026-09-29: a photo queued behind a slow read passes the 2-minute mark while still in memory.
  // Replaying it would acknowledge ("ได้รับรูปแล้ว") and read the same photo a second time.
  it('leaves a row the buffer still holds alone, however old it is', async () => {
    const h = makeHarness([rowAt('queued-photo', LINE_BUFFER_ORPHAN_REPROCESS_MS + 60_000)], { held: ['queued-photo'] });
    const result = await h.useCase.execute();
    assert.equal(result.replayed, 0);
    assert.equal(result.skipped, 1);
    assert.equal(h.enqueued.length, 0, 'no second copy enters the buffer');
    assert.equal(h.store.get('queued-photo')?.errorCode ?? null, null, 'the held row is not re-stamped for replay');
  });

  it('leaves an in-flight row alone', async () => {
    const { useCase, enqueued } = makeHarness([rowAt('e2', 5_000)]);
    const result = await useCase.execute();
    assert.equal(result.replayed, 0);
    assert.equal(enqueued.length, 0);
  });

  it('waits for a provider-input lease before retrying the same durable input', async () => {
    for (const errorCode of [LINE_RECEIPT_RETRY_LEASE_CODE, LINE_RECEIPT_RETRY_WAIT_CODE]) {
      const h = makeHarness([rowAt('provider-wait', LINE_RECEIPT_RETRY_LEASE_MS + 1000, {
        status: 'received', errorCode, processedAt: new Date(Date.now() - LINE_BUFFER_ORPHAN_REPROCESS_MS - 1000),
      })]);
      assert.equal((await h.useCase.execute()).replayed, 0);
      assert.equal(h.enqueued.length, 0);
      h.store.get('provider-wait')!.processedAt = new Date(Date.now() - LINE_RECEIPT_RETRY_LEASE_MS - 1000);
      assert.equal((await h.useCase.execute()).replayed, 1);
      assert.equal(h.enqueued[0].item.webhookEventId, 'provider-wait');
    }
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
    assert.deepEqual(pushes[0]!.messages, STORED_MESSAGES, 'byte-for-byte the FIRST push payload');
    assert.equal(pushes[0]!.operationId, 'replay-1');
    // Delivery — and only delivery — closes the turn.
    assert.equal(store.get('replay-1')?.status, 'completed');
    assert.equal(store.get('replay-1')?.errorCode, null);
    assert.equal(store.get('replay-1')?.payloadJson, null, 'raw chat ids leave with the terminal status');
    assert.ok(outcomeStore.get('replay-1')?.deliveredAt instanceof Date, 'deliveredAt is the separate delivery status');
    assert.equal(outcomeStore.get('replay-1')?.attempts, 2, 'attempts counts sends, not successes');
  });

  it('drops the context prefix, never the answer, when the stored outcome already fills LINE\'s 5-message cap', async () => {
    const fullPayload = Array.from({ length: 5 }, (_, index) => ({ type: 'text', text: `ส่วนที่ ${index + 1}` }));
    const { useCase, pushes } = makeHarness([
      rowAt('replay-full', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000, { status: 'delivery_pending', errorCode: 'LINE_DELIVERY_FAILED_TOKEN' }),
    ], { replayEnabled: true, outcomes: [{ webhookEventId: 'replay-full', messagesJson: fullPayload, attempts: 1, deliveredAt: null }] });

    const result = await useCase.execute();

    assert.equal(result.replayed, 1);
    assert.deepEqual(pushes[0]!.messages, fullPayload, 'a full payload ships verbatim with no prefix');
  });

  it('converts a provider-rejected representation without rerunning the business operation', async () => {
    for (const errorCode of ['LINE_OUTCOME_REPRESENTATION_PENDING']) {
      const { useCase, store, enqueued, pushes, outcomeStore } = makeHarness([
        rowAt('stale-flex-1', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000, { status: 'delivery_pending', errorCode }),
      ], { replayEnabled: true, outcomes: [{ webhookEventId: 'stale-flex-1', messagesJson: STORED_MESSAGES, attempts: 1, deliveredAt: null }] });
      assert.equal((await useCase.execute()).replayed, 1);
      assert.deepEqual(pushes[0]!.messages, [{ type: 'text', text: STORED_MESSAGES[0].altText }]);
      assert.deepEqual(outcomeStore.get('stale-flex-1')!.messagesJson, pushes[0]!.messages);
      assert.equal(enqueued.length, 0);
      assert.equal(store.get('stale-flex-1')?.status, 'completed');
    }
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

  it('parks a missing business outcome for repair instead of repeating its mutation', async () => {
    const { useCase, enqueued, pushes, store } = makeHarness([
      rowAt('replay-5', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000, { status: 'delivery_pending', errorCode: 'LINE_OUTCOME_NOT_RECORDED' }),
    ], { replayEnabled: true });
    assert.equal((await useCase.execute()).skipped, 1);
    assert.equal(pushes.length, 0);
    assert.equal(enqueued.length, 0);
    assert.equal(store.get('replay-5')?.errorCode, 'LINE_OUTCOME_RECOVERY_REQUIRED');
  });

  it('reconciles accepted outcomes after a restart without pushing or rerouting them', async () => {
    const { useCase, enqueued, pushes, store } = makeHarness([
      rowAt('accepted', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000, { status: 'delivery_pending', errorCode: 'LINE_DELIVERY_FAILED_OTHER' }),
    ], { replayEnabled: true, outcomes: [{ webhookEventId: 'accepted', messagesJson: STORED_MESSAGES, attempts: 1, deliveredAt: new Date() }] });
    assert.equal((await useCase.execute()).skipped, 1);
    assert.equal(pushes.length, 0);
    assert.equal(enqueued.length, 0);
    assert.equal(store.get('accepted')?.status, 'completed');
  });

  it('leases a failed attempt until the retry interval and parks permanent failure', async () => {
    const pending = makeHarness([
      rowAt('retry', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000, { status: 'delivery_pending', errorCode: 'LINE_DELIVERY_FAILED_OTHER' }),
    ], { replayEnabled: true, pushResult: 'failed_other', outcomes: [{ webhookEventId: 'retry', messagesJson: STORED_MESSAGES, attempts: 1, deliveredAt: null }] });
    await pending.useCase.execute();
    await pending.useCase.execute();
    assert.equal(pending.pushes.length, 1, 'no repeated push on the next immediate worker tick');
    pending.store.get('retry')!.processedAt = new Date(Date.now() - LINE_BUFFER_ORPHAN_REPROCESS_MS - 1);
    await pending.useCase.execute();
    assert.equal(pending.pushes.length, 2);
    assert.deepEqual(pending.pushes[0], pending.pushes[1], 'recipient, bytes and retry operation survive the lease');
    const permanent = makeHarness([
      rowAt('permanent', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000, { status: 'delivery_pending', errorCode: 'LINE_DELIVERY_FAILED_OTHER' }),
    ], { replayEnabled: true, pushResult: 'failed_permanent', outcomes: [{ webhookEventId: 'permanent', messagesJson: STORED_MESSAGES, attempts: 1, deliveredAt: null }] });
    await permanent.useCase.execute();
    assert.equal(permanent.store.get('permanent')?.status, 'delivery_failed');
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

  it('parks a rejected Flex push just as a permanent rejection without replaying it', async () => {
    const h = makeHarness([
      rowAt('flex-rejected', LINE_BUFFER_ORPHAN_REPROCESS_MS + 1_000, { status: 'delivery_pending', errorCode: 'LINE_DELIVERY_FAILED_OTHER' }),
    ], { replayEnabled: true, pushResult: 'failed_flex', outcomes: [{ webhookEventId: 'flex-rejected', messagesJson: STORED_MESSAGES, attempts: 1, deliveredAt: null }] });
    await h.useCase.execute();
    await h.useCase.execute();
    assert.equal(h.store.get('flex-rejected')?.status, 'delivery_failed');
    assert.equal(h.store.get('flex-rejected')?.errorCode, 'LINE_DELIVERY_FAILED_PERMANENT');
    assert.equal(h.pushes.length, 1);
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

  /**
   * Capture appendix §8 (W07-int): a capture group keeps the raw chat id its result is pushed
   * into. That is customer data of the same kind as the webhook payload beside it, so it ages out
   * in the same sweep — and the push then falls back to the sender's own 1:1 chat.
   */
  it('clears the chat id a stale capture group was keeping to push into', async () => {
    const day = 24 * 60 * 60 * 1000;
    const { useCase, capturePushTargetSweeps, capturePushTargetClears } = makeHarness([], {
      captureGroupsWithPushTarget: [{ id: 'group-old' }],
    });
    await useCase.execute();

    assert.equal(capturePushTargetSweeps.length, 1);
    const where = capturePushTargetSweeps[0].where;
    assert.deepEqual(where.linePushTargetId, { not: null }, 'only rows that still hold one');
    assert.ok(Date.now() - where.updatedAt.lt.getTime() >= 90 * day, 'and only past the window');
    assert.deepEqual(capturePushTargetClears[0].data, { linePushTargetId: null });
    assert.deepEqual(capturePushTargetClears[0].where, { id: { in: ['group-old'] } });
  });

  it('touches no capture group when none is holding a chat id', async () => {
    const { useCase, capturePushTargetClears } = makeHarness([]);
    await useCase.execute();
    assert.equal(capturePushTargetClears.length, 0);
  });

  /**
   * Capture appendix §8 / D08 (W08): the evidence half of the same window. A group that never
   * produced a financial document loses the files nothing points at; a file a derived expense or a
   * certified substitute receipt still owns is left exactly where it is.
   */
  it('deletes only the orphan files of a group past the retention window', async () => {
    const h = makeHarness([], {
      retentionGroups: [{
        id: 'group-closed', companyId: 'company-1', files: [
          { id: 'file-orphan', attachmentId: 'att-orphan' },
          { id: 'file-used', attachmentId: 'att-used', linkedToExpense: true },
          { id: 'file-held', attachmentId: 'att-held', heldByCertificate: true },
          { id: 'file-gone', attachmentId: 'att-gone', uploadState: 'DETACHED' },
        ],
      }],
    });
    const result = await h.useCase.execute();

    assert.equal(result.captureFilesPurged, 1);
    assert.deepEqual(h.markedDeleted, ['att-orphan'], 'a derived expense and a certificate hold keep their bytes');
    assert.deepEqual(h.detached, [{ companyId: 'company-1', fileId: 'file-orphan', reason: 'retention' }]);
    assert.deepEqual(h.cancelledJobs, [{ companyId: 'company-1', fileId: 'file-orphan' }], 'a late read must not apply to bytes that are gone');
  });

  it('selects groups by age and never a handed-off one, 100 per tick', async () => {
    const day = 24 * 60 * 60 * 1000;
    const { useCase, captureRetentionSweeps } = makeHarness([]);
    await useCase.execute();

    assert.equal(captureRetentionSweeps.length, 1);
    const sweep = captureRetentionSweeps[0];
    assert.deepEqual(sweep.where.status, { in: ['CLOSED_NO_HANDOFF', 'CANCELLED', 'OPEN'] }, 'HANDED_OFF is not in scope');
    assert.ok(Date.now() - sweep.where.updatedAt.lt.getTime() >= 90 * day, 'only past the window');
    assert.equal(sweep.take, 100);
  });

  it('audits one row per purged group with ids and counts only', async () => {
    const h = makeHarness([], {
      retentionGroups: [
        { id: 'group-a', companyId: 'company-1', files: [{ id: 'file-a1', attachmentId: 'att-a1' }, { id: 'file-a2', attachmentId: 'att-a2' }] },
        { id: 'group-b', companyId: 'company-2', files: [{ id: 'file-b1', attachmentId: 'att-b1', linkedToExpense: true }] },
      ],
    });
    const result = await h.useCase.execute();

    assert.equal(result.captureFilesPurged, 2);
    const purgeAudits = h.audits.filter((entry) => entry.action === 'expense.capture_group.retention_purge');
    assert.equal(purgeAudits.length, 1, 'group-b lost nothing, so it is not audited');
    assert.equal(purgeAudits[0].targetId, 'group-a');
    assert.equal(purgeAudits[0].companyId, 'company-1');
    assert.deepEqual(purgeAudits[0].metadataJson, { fileIds: ['file-a1', 'file-a2'], fileCount: 2, retentionDays: 90 });
  });
});

it('Round 2 A: orphan replay accepts only a well-shaped signed expense-action binding', () => {
  const control = { action: 'expense_action_confirm', token: '550e8400-e29b-41d4-a716-446655440000.' + 'a'.repeat(43) };
  const envelope = envelopeFor('expense-action-confirm');
  (envelope.item as any).expenseActionControl = control;
  assert.deepEqual((parseBufferEnvelope(envelope)?.item as any)?.expenseActionControl, control);
  for (const bad of [{ ...control, token: 'bad' }, { ...control, action: 'execute' }, { ...control, expenseId: 'injected' }, undefined]) {
    assert.equal(parseBufferEnvelope({ ...envelope, item: { ...envelope.item, expenseActionControl: bad } }), null);
  }
});

it('Round 4 recovers only strictly shaped package purchase controls', () => {
  const control = { action: 'package_purchase_confirm', token: '550e8400-e29b-41d4-a716-446655440000.' + 'a'.repeat(43) };
  const envelope = envelopeFor('package-confirm');
  (envelope.item as any).packagePurchaseControl = control;
  assert.deepEqual((parseBufferEnvelope(envelope)?.item as any)?.packagePurchaseControl, control);
  for (const bad of [{ ...control, token: 'bad' }, { ...control, action: 'charge' }, { ...control, companyId: 'other' }, undefined])
    assert.equal(parseBufferEnvelope({ ...envelope, item: { ...envelope.item, packagePurchaseControl: bad } }), null);
});


it('R24 task retention uses the webhook cutoff and deletes tasks before event logs', async () => {
  const h = makeHarness([]), order: string[] = [];
  const client = (h.useCase as any).prisma.client;
  let taskCutoff: Date | undefined, eventCutoff: Date | undefined;
  client.lineAiTaskRun = { findMany: async ({ where }: any) => { taskCutoff = where.startedAt.lt; return [{ id: 'old-task' }]; },
    deleteMany: async () => { order.push('task'); return { count: 1 }; } };
  client.lineWebhookEventLog.findMany = async ({ where }: any) => {
    if (where.createdAt?.lt) { eventCutoff = where.createdAt.lt; return [{ id: 'old-event' }]; }
    return [];
  };
  client.lineWebhookEventLog.deleteMany = async () => { order.push('event'); return { count: 1 }; };
  await (h.useCase as any).purgeExpiredEvents(Date.now());
  assert.deepEqual(order, ['task', 'event']);
  assert.equal(taskCutoff?.getTime(), eventCutoff?.getTime());
});
