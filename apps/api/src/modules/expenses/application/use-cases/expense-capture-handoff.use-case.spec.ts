/**
 * Handoff and the §3.2 auto handoff (appendix §9, W05).
 *
 * Hand-built fakes in the style of `expense-capture-review.use-case.spec.ts`. The doubles keep the
 * properties the use case leans on — the revision compare-and-set, the `updatedAt` CAS on an
 * expense, the accepted-allocation fence and the consumption list — so "the second caller replays"
 * and "a used source refuses" exercise the real branch instead of a stub that always says yes.
 *
 * What a fake CANNOT prove — the `handoffBatchKey` unique, the per-scope unique index, the lock
 * order and two真 concurrent transactions — is in `expense-capture-handoff.pg.spec.ts`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationPipe } from '@nestjs/common';
import {
  EXPENSE_CAPTURE_ALLOCATION_POLICY,
  EXPENSE_CAPTURE_ALLOCATION_POLICY_VERSION,
  type CaptureAllocationResult,
  type ExpenseCaptureObservations,
} from '@watchdog-bms/contracts';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';
import { computeCaptureAllocation } from '../../domain/logic/expense-capture-allocation.logic';
import { assembleCaptureFacts } from '../../domain/logic/expense-capture-facts.logic';
import { ExpenseCaptureHandoffDto } from '../../presentation/http/expense-capture.dtos';
import { ExpenseCaptureAccessService } from './expense-capture-group.use-case';
import {
  AutoHandoffSingleDocumentCaptureUseCase,
  HandoffExpenseCaptureGroupUseCase,
} from './expense-capture-handoff.use-case';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const classification = {
  contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
  businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT'],
  confidence: 1, evidenceSignals: [], amountSignals: [], settlementSignals: [],
  missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
} as ExpenseCaptureObservations['documents'][number]['classification'];

const document = (ref: string, issuer: Record<string, string>) => ({
  ref, pageIndexes: [0], kind: 'RECEIPT' as const, family: 'EXPENSE_EVIDENCE' as const,
  issuer, documentNumber: `${ref}-001`, documentDate: '2026-09-10', currency: 'THB', classification,
});

/** Two sellers on one file: ร้านเอ 100, ร้านบี 40 — the two-scope case §5 exists for. */
const twoSellers = (): ExpenseCaptureObservations => ({
  documents: [
    document('D1', { name: 'ร้านเอ', taxId: '0105560012345' }),
    document('D2', { name: 'ร้านบี', taxId: '0105560099999' }),
  ],
  items: [
    { id: '1:1', documentRef: 'D1', description: 'กระดาษ', quantity: '2', unitPrice: '50.00', amount: '100.00', event: 'sale', evidenceSpan: 'กระดาษ' },
    { id: '1:2', documentRef: 'D2', description: 'ปากกา', quantity: '1', unitPrice: '40.00', amount: '40.00', event: 'sale', evidenceSpan: 'ปากกา' },
  ],
  components: [],
  totals: [
    { documentRef: 'D1', kind: 'document_total', amount: '100.00', evidenceSpan: '100' },
    { documentRef: 'D2', kind: 'document_total', amount: '40.00', evidenceSpan: '40' },
  ],
  payments: [
    { documentRef: 'D1', status: 'paid', amount: '100.00', occurredAt: '2026-09-10T04:00:00.000Z', evidenceSpan: '100' },
    { documentRef: 'D2', status: 'paid', amount: '40.00', occurredAt: '2026-09-10T04:00:00.000Z', evidenceSpan: '40' },
  ],
  refunds: [],
  completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0], notes: [] },
});

const oneSeller = (): ExpenseCaptureObservations => {
  const base = twoSellers();
  return {
    ...base,
    documents: [base.documents[0]!],
    items: [base.items[0]!],
    totals: [base.totals[0]!],
    payments: [base.payments[0]!],
  };
};

const allocationResult = (payload: ExpenseCaptureObservations, over: Record<string, unknown> = {}): CaptureAllocationResult =>
  computeCaptureAllocation({
    facts: assembleCaptureFacts([{
      id: 'obs-1', companyId: 'co-1', groupId: 'g-1', fileId: 'f1', expenseId: null, version: 1,
      source: 'AI', stale: false, payloadJson: payload,
    }] as never),
    businessUse: 'ALL_COMPANY', selection: {}, fundingRoute: 'EMPLOYEE', payerUserId: 'user-payer',
    taxReview: {}, expenseDateChoice: {}, policy: EXPENSE_CAPTURE_ALLOCATION_POLICY,
    todayIso: '2026-09-19T00:00:00.000Z',
    ...over,
  } as never);

// ─── fakes ────────────────────────────────────────────────────────────────────

class FakeCaptureRepo {
  groups = new Map<string, any>();
  observations: any[] = [];
  allocations: any[] = [];
  files: any[] = [];
  jobs: any[] = [];
  expenses: any[] = [];
  consumers: Array<{ expenseId: string; reason: string }> = [];
  locks: string[] = [];

  get client() { return this as any; }

  transaction<T>(run: (tx: any) => Promise<T>): Promise<T> { return run(this.tx()); }

  /** The bits of a Prisma client the use case reaches for directly. */
  private tx() {
    const self = this;
    return {
      expenseRecord: {
        async updateMany({ where, data }: any) {
          let count = 0;
          for (const row of self.expenses) {
            if (row.companyId !== where.companyId || row.id !== where.id) continue;
            if (where.captureGroupId !== undefined && row.captureGroupId !== where.captureGroupId) continue;
            Object.assign(row, data);
            count += 1;
          }
          return { count };
        },
      },
      attachmentLink: { async findMany() { return []; } },
      async $executeRaw() { return 0; },
    };
  }

  async lockGroup(_db: any, companyId: string, groupId: string) { this.locks.push(`${companyId}:expense-capture:${groupId}`); }

  async findGroup(_db: any, companyId: string, groupId: string) {
    const group = this.groups.get(groupId);
    return group && group.companyId === companyId ? { ...group } : null;
  }

  async bumpRevision(_db: any, input: any) {
    const group = this.groups.get(input.groupId);
    if (!group || group.companyId !== input.companyId || group.revision !== input.expectedRevision) return null;
    Object.assign(group, input.data ?? {}, { revision: input.expectedRevision + 1 });
    return group.revision;
  }

  async listObservations(_db: any, companyId: string, groupId: string) {
    return this.observations.filter((row) => row.companyId === companyId && row.groupId === groupId && !row.stale);
  }

  async listFiles(_db: any, companyId: string, groupId: string) {
    return this.files.filter((row) => row.companyId === companyId && row.groupId === groupId);
  }

  async listStoredFiles(_db: any, companyId: string, groupId: string) {
    return (await this.listFiles(null, companyId, groupId)).filter((row) => row.uploadState === 'STORED');
  }

  async listJobsByGroup(_db: any, companyId: string, groupId: string) {
    return this.jobs.filter((row) => row.companyId === companyId && row.groupId === groupId);
  }

  async findAcceptedAllocation(_db: any, companyId: string, groupId: string, allocationId: string) {
    const row = this.allocations.find((allocation) => allocation.companyId === companyId
      && allocation.groupId === groupId && allocation.id === allocationId && allocation.status === 'ACCEPTED');
    return row ? { ...row } : null;
  }

  async listDerivedSourceStates(_db: any, companyId: string, groupId: string) {
    return this.expenses
      .filter((row) => row.companyId === companyId && row.captureGroupId === groupId)
      .map((row) => ({ ...row }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  async findHandoffConsumers(_db: any, companyId: string, groupId: string) {
    const ids = new Set((await this.listDerivedSourceStates(null, companyId, groupId)).map((row) => row.id));
    return this.consumers.filter((row) => ids.has(row.expenseId));
  }

  async isReopenableAfterHandoff(db: any, companyId: string, groupId: string) {
    const rows = await this.listDerivedSourceStates(db, companyId, groupId);
    if (rows.length === 0) return false;
    return (await this.findHandoffConsumers(db, companyId, groupId)).length === 0;
  }

  async deleteDerivedSource(_db: any, companyId: string, expenseId: string, expectedUpdatedAt: Date) {
    const index = this.expenses.findIndex((row) => row.companyId === companyId && row.id === expenseId
      && row.updatedAt.getTime() === expectedUpdatedAt.getTime());
    if (index === -1) return false;
    this.expenses.splice(index, 1);
    return true;
  }
}

class FakeExpenseRepo {
  links: Array<{ attachmentId: string; targetType: string; targetId: string; purpose: string }> = [];
  lines = new Map<string, any[]>();
  private seq = 0;

  constructor(private readonly capture: FakeCaptureRepo) {}

  async createExpense(input: any, _withinTx?: unknown, db?: unknown) {
    assert.ok(db, 'a derived source must be created inside the handoff transaction');
    this.seq += 1;
    // The real unique index, in miniature: one derived source per scope per group.
    if (this.capture.expenses.some((row) => row.companyId === input.companyId
      && row.captureGroupId === input.captureGroupId && row.captureScopeKey === input.captureScopeKey)) {
      throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
    }
    const expense = { ...input, id: `exp-${this.seq}`, updatedAt: new Date(2026, 8, 19, 0, 0, this.seq), paidAmount: '0', paymentStatus: 'UNPAID', postingStatus: 'not_required', journalEntryId: null, sourceReimbursementRequestId: null, primaryAttachmentId: null };
    this.capture.expenses.push(expense);
    return expense;
  }

  /** Set to simulate another writer saving the expense between the read and this write. */
  raceBeforeUpdate = false;

  async updateExpense(input: any, _withinTx?: unknown, db?: unknown) {
    assert.ok(db, 'a rewrite must join the handoff transaction');
    const row = this.capture.expenses.find((expense) => expense.id === input.id && expense.companyId === input.companyId);
    if (!row) throw new Error('not found');
    if (this.raceBeforeUpdate) row.updatedAt = new Date(row.updatedAt.getTime() + 60_000);
    if (input.expectedUpdatedAt && row.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
      throw Object.assign(new Error('EXPENSE_UPDATE_CONFLICT'), { code: 'EXPENSE_UPDATE_CONFLICT' });
    }
    const { id: _id, companyId: _companyId, expectedUpdatedAt: _expected, ...rest } = input;
    Object.assign(row, rest, { updatedAt: new Date(row.updatedAt.getTime() + 1_000) });
    return row;
  }

  async upsertLines(companyId: string, expenseId: string, lines: any[], db?: unknown) {
    assert.ok(db, 'lines belong to the same transaction as the record');
    assert.ok(lines.every((line) => line.companyId === companyId && line.expenseId === expenseId));
    this.lines.set(expenseId, lines);
  }

  async linkAttachmentToTarget(attachmentId: string, targetType: string, targetId: string, purpose: string) {
    this.links.push({ attachmentId, targetType, targetId, purpose });
  }
}

const audits: any[] = [];
const audit = { log: async (entry: any) => { audits.push(entry); } } as any;
const outboxEvents: any[] = [];
const outbox = { append: async (eventType: string, aggregateType: string, aggregateId: string, payload: any) => { outboxEvents.push({ eventType, aggregateType, aggregateId, payload }); } } as any;
const config = { expenseCaptureGroupIntakeEnabled: true, uploadMaxBytes: 10_485_760, expenseCapturePdfMaxPages: 60 } as any;

const ctx = (over: Record<string, unknown> = {}) => ({
  requestId: 'req-1', authSubject: 'user-1', userId: 'user-1', companyId: 'co-1', membershipId: 'mem-1',
  roles: ['STAFF'], permissions: ['expense.create'], scopes: {}, authProvider: 'watchdog', ...over,
} as any);

const code = (error: any) => error?.getResponse?.()?.code ?? error?.response?.code;
const status = (error: any) => error?.getStatus?.();
const body = (error: any) => error?.getResponse?.() ?? {};

function build(options: { payload?: ExpenseCaptureObservations; intakeChannel?: 'WEB' | 'LINE'; group?: Record<string, unknown>; intakeEnabled?: boolean } = {}) {
  const capture = new FakeCaptureRepo();
  capture.groups.set('g-1', {
    id: 'g-1', companyId: 'co-1', branchId: 'branch-1', createdByUserId: 'user-1',
    intakeChannel: options.intakeChannel ?? 'WEB', status: 'OPEN', revision: 3,
    businessUse: 'ALL_COMPANY', fundingRoute: 'EMPLOYEE', payerUserId: 'user-payer',
    taxReviewJson: null, expenseDateSourceJson: null, handoffState: 'NONE', handoffBatchKey: null,
    acceptedAllocationId: null, lineChatKeyHash: null, note: null, closedReason: null, closedAt: null,
    createdAt: new Date(), updatedAt: new Date(), ...options.group,
  });
  capture.observations.push({
    id: 'obs-1', companyId: 'co-1', groupId: 'g-1', fileId: 'f1', expenseId: null, version: 1,
    source: 'AI', stale: false, payloadJson: options.payload ?? twoSellers(),
  });
  capture.files.push({ id: 'f1', companyId: 'co-1', groupId: 'g-1', attachmentId: 'att-1', position: 1, uploadState: 'STORED' });
  capture.jobs.push({ id: 'job-1', companyId: 'co-1', groupId: 'g-1', fileId: 'f1', status: 'DONE' });

  const expenses = new FakeExpenseRepo(capture);
  const access = new ExpenseCaptureAccessService(capture as any,
    options.intakeEnabled === false ? { ...config, expenseCaptureGroupIntakeEnabled: false } : config);
  return {
    capture, expenses,
    handoff: new HandoffExpenseCaptureGroupUseCase(capture as any, expenses as any, access, audit, outbox),
    auto: new AutoHandoffSingleDocumentCaptureUseCase(capture as any, expenses as any, audit),
  };
}

/** Put an ACCEPTED allocation on the group exactly as `accept` leaves it: revision = groupRevision + 1. */
function accept(app: ReturnType<typeof build>, result: CaptureAllocationResult, id = 'alloc-1') {
  const group = app.capture.groups.get('g-1');
  app.capture.allocations.push({
    id, companyId: 'co-1', groupId: 'g-1', groupRevision: group.revision,
    policyVersion: EXPENSE_CAPTURE_ALLOCATION_POLICY_VERSION, status: 'ACCEPTED',
    fundingRoute: 'EMPLOYEE', payerUserId: 'user-payer', resultJson: result,
  });
  group.revision += 1;
  group.acceptedAllocationId = id;
  return { allocationId: id, expectedRevision: group.revision as number };
}

// ─── handoff ──────────────────────────────────────────────────────────────────

describe('handoff', () => {
  it('creates one ordinary expense per scope, links the evidence and stamps the batch', async () => {
    const app = build();
    const { allocationId, expectedRevision } = accept(app, allocationResult(twoSellers()));

    const result = await app.handoff.execute(ctx(), 'g-1', { allocationId, expectedRevision, idempotencyKey: 'key-1' });

    assert.equal(result.handoffBatchKey, 'g-1:alloc-1');
    assert.equal(result.groupStatus, 'HANDED_OFF');
    assert.equal(result.replayed, false);
    assert.equal(result.regenerated, false);
    assert.equal(result.expenses.length, 2, 'one derived source per issuer scope');
    assert.deepEqual(result.expenses.map((expense) => expense.grandTotalAmount).sort(), ['100.0000', '40.0000']);
    assert.deepEqual(result.expenses.map((expense) => expense.webPath), result.expenses.map((expense) => `/companies/co-1/expenses/${expense.expenseId}`));

    const group = app.capture.groups.get('g-1');
    assert.equal(group.status, 'HANDED_OFF');
    assert.equal(group.handoffState, 'ACTIVE');
    assert.equal(group.handoffBatchKey, 'g-1:alloc-1');
    // §2.4 lock order: the evidence keys before the group's own key.
    assert.deepEqual(app.capture.locks, ['co-1:expense-capture:g-1']);

    for (const expense of app.capture.expenses) {
      assert.equal(expense.status, 'NEEDS_REVIEW');
      assert.equal(expense.captureGroupId, 'g-1');
      assert.equal(expense.captureAllocationId, 'alloc-1');
      assert.equal(expense.payerUserId, 'user-payer');
      assert.equal(expense.createdByUserId, 'user-1');
      assert.equal(expense.primaryAttachmentId, 'att-1');
    }
    assert.deepEqual(app.expenses.links.map((link) => link.purpose), ['expense.receipt.primary', 'expense.receipt.primary']);
    assert.equal(audits.at(-1).action, 'expense.capture_handoff.create');
    assert.deepEqual(audits.at(-1).metadataJson.expenseIds.sort(), app.capture.expenses.map((row) => row.id).sort());
    assert.equal(outboxEvents.at(-1).eventType, 'expense.capture_handoff.created');
    assert.equal(outboxEvents.at(-1).payload.data.handoffBatchKey, 'g-1:alloc-1');
  });

  /**
   * A47 / IG13 (W08). Turning intake off must stop NEW evidence, not strand a group whose files
   * are already stored and already reviewed. Handing that group off is how the customer finishes.
   */
  it('hands off with intake closed (A47)', async () => {
    const app = build({ intakeEnabled: false });
    const { allocationId, expectedRevision } = accept(app, allocationResult(twoSellers()));

    const result = await app.handoff.execute(ctx(), 'g-1', { allocationId, expectedRevision, idempotencyKey: 'key-closed' });

    assert.equal(result.expenses.length, 2, 'the work already in the system still reaches money');
    assert.equal(app.capture.groups.get('g-1').status, 'HANDED_OFF');
  });

  it('answers a second call for the same allocation with the first batch, writing nothing', async () => {
    const app = build();
    const command = accept(app, allocationResult(twoSellers()));
    const first = await app.handoff.execute(ctx(), 'g-1', command);
    const revisionAfterFirst = app.capture.groups.get('g-1').revision;
    const publishedBefore = outboxEvents.length;

    const replay = await app.handoff.execute(ctx(), 'g-1', { ...command, idempotencyKey: 'a-different-key' });

    assert.equal(replay.replayed, true);
    assert.equal(replay.handoffBatchKey, first.handoffBatchKey);
    assert.deepEqual(replay.expenses.map((expense) => expense.expenseId).sort(), first.expenses.map((expense) => expense.expenseId).sort());
    assert.equal(app.capture.expenses.length, 2, 'no second batch');
    assert.equal(app.capture.groups.get('g-1').revision, revisionAfterFirst, 'a replay is not a mutation');
    assert.equal(outboxEvents.length, publishedBefore,
      'the replay publishes nothing: the first call already announced this batch');
  });

  it('refuses a caller who is neither the creator nor a reviewer', async () => {
    const app = build();
    const command = accept(app, allocationResult(twoSellers()));
    await assert.rejects(
      () => app.handoff.execute(ctx({ userId: 'user-7', permissions: ['expense.create'] }), 'g-1', command),
      (error: unknown) => status(error) === 403,
    );
    await assert.rejects(
      () => app.handoff.execute(ctx({ permissions: ['expense.read'] }), 'g-1', command),
      (error: unknown) => status(error) === 403,
    );
  });

  it('lets a reviewer hand off somebody else’s group', async () => {
    const app = build();
    const command = accept(app, allocationResult(twoSellers()));
    const result = await app.handoff.execute(ctx({ userId: 'user-9', permissions: ['expense.review'] }), 'g-1', command);
    assert.equal(result.expenses.length, 2);
    assert.ok(app.capture.expenses.every((row) => row.createdByUserId === 'user-9'));
  });

  it('refuses an allocation that is not the one the group accepted', async () => {
    const app = build();
    const command = accept(app, allocationResult(twoSellers()));
    await assert.rejects(
      () => app.handoff.execute(ctx(), 'g-1', { ...command, allocationId: 'alloc-other' }),
      (error: unknown) => status(error) === 409 && code(error) === 'expense_capture_allocation_not_current',
    );
  });

  it('refuses once anything moved the group after the acceptance', async () => {
    const app = build();
    const command = accept(app, allocationResult(twoSellers()));
    // A file added after the accept: the evidence is no longer what was reviewed.
    app.capture.groups.get('g-1').revision += 1;

    await assert.rejects(
      () => app.handoff.execute(ctx(), 'g-1', { ...command, expectedRevision: command.expectedRevision + 1 }),
      (error: unknown) => status(error) === 409 && code(error) === 'expense_capture_allocation_stale',
    );
    assert.equal(app.capture.expenses.length, 0);
  });

  it('refuses a stale expectedRevision before it looks at the allocation', async () => {
    const app = build();
    const command = accept(app, allocationResult(twoSellers()));
    await assert.rejects(
      () => app.handoff.execute(ctx(), 'g-1', { ...command, expectedRevision: 1 }),
      (error: unknown) => status(error) === 409 && code(error) === 'expense_capture_group_revision_conflict',
    );
  });

  it('refuses a blocked allocation and a no-company-portion one', async () => {
    const blocked = build();
    const blockedCommand = accept(blocked, allocationResult(twoSellers(), { fundingRoute: 'UNKNOWN', payerUserId: null }));
    await assert.rejects(
      () => blocked.handoff.execute(ctx(), 'g-1', blockedCommand),
      (error: unknown) => status(error) === 409 && code(error) === 'expense_capture_allocation_blocked'
        && body(error).blockers.includes('expense_capture_funding_route_required'),
    );

    const zero = build();
    const zeroCommand = accept(zero, { ...allocationResult(twoSellers()), outcome: 'NO_COMPANY_PORTION', scopes: [] });
    await assert.rejects(
      () => zero.handoff.execute(ctx(), 'g-1', zeroCommand),
      (error: unknown) => status(error) === 409 && code(error) === 'expense_capture_no_company_portion',
    );
    assert.equal(zero.capture.expenses.length, 0, 'A41: no zero-money destination');
  });

  it('refuses a closed or cancelled group', async () => {
    for (const status_ of ['CLOSED_NO_HANDOFF', 'CANCELLED'] as const) {
      const app = build();
      const command = accept(app, allocationResult(twoSellers()));
      app.capture.groups.get('g-1').status = status_;
      await assert.rejects(
        () => app.handoff.execute(ctx(), 'g-1', command),
        (error: unknown) => status(error) === 409 && code(error) === 'expense_capture_group_closed',
      );
    }
  });

  it('answers 404 for a group of another company', async () => {
    const app = build();
    const command = accept(app, allocationResult(twoSellers()));
    await assert.rejects(
      () => app.handoff.execute(ctx({ companyId: 'co-2' }), 'g-1', command),
      (error: unknown) => status(error) === 404,
    );
  });
});

// ─── regenerate ───────────────────────────────────────────────────────────────

describe('regenerate', () => {
  /** Hand off, then accept a second allocation on the same group, as a reopened review does. */
  async function handedOff(over: Record<string, unknown> = {}) {
    const app = build(over);
    const first = accept(app, allocationResult((over as { payload?: ExpenseCaptureObservations }).payload ?? twoSellers()));
    const batch = await app.handoff.execute(ctx(), 'g-1', first);
    return { app, batch };
  }

  function acceptSecond(app: ReturnType<typeof build>, result: CaptureAllocationResult) {
    const group = app.capture.groups.get('g-1');
    app.capture.allocations.push({
      id: 'alloc-2', companyId: 'co-1', groupId: 'g-1', groupRevision: group.revision,
      policyVersion: EXPENSE_CAPTURE_ALLOCATION_POLICY_VERSION, status: 'ACCEPTED',
      fundingRoute: 'EMPLOYEE', payerUserId: 'user-payer', resultJson: result,
    });
    group.revision += 1;
    group.acceptedAllocationId = 'alloc-2';
    return { allocationId: 'alloc-2', expectedRevision: group.revision as number };
  }

  it('rewrites the surviving sources in place and releases the one the new allocation dropped', async () => {
    const { app, batch } = await handedOff();
    const keptId = batch.expenses.find((expense) => expense.grandTotalAmount === '100.0000')!.expenseId;
    const droppedId = batch.expenses.find((expense) => expense.grandTotalAmount === '40.0000')!.expenseId;

    const command = acceptSecond(app, allocationResult(oneSeller()));
    const result = await app.handoff.execute(ctx(), 'g-1', command);

    assert.equal(result.regenerated, true);
    assert.equal(result.handoffBatchKey, 'g-1:alloc-2');
    assert.equal(result.expenses.length, 1);
    assert.equal(result.expenses[0]!.expenseId, keptId, 'A44: the surviving source keeps its id and its deep link');
    assert.deepEqual(app.capture.expenses.map((row) => row.id), [keptId]);
    assert.equal(app.capture.expenses.some((row) => row.id === droppedId), false);
    assert.equal(app.capture.expenses[0]!.captureAllocationId, 'alloc-2');
    assert.equal(audits.at(-1).action, 'expense.capture_handoff.regenerate');
    assert.deepEqual(audits.at(-1).metadataJson.releasedExpenseIds, [droppedId]);
    assert.deepEqual(audits.at(-1).metadataJson.rewrittenExpenseIds, [keptId]);
  });

  for (const consumption of ['status', 'paid', 'posted', 'claim', 'certificate', 'claim_projection'] as const) {
    it(`refuses and names the expense when one source is consumed by ${consumption}`, async () => {
      const { app, batch } = await handedOff();
      const usedId = batch.expenses[0]!.expenseId;
      app.capture.consumers.push({ expenseId: usedId, reason: consumption });

      const command = acceptSecond(app, allocationResult(oneSeller()));
      await assert.rejects(
        () => app.handoff.execute(ctx(), 'g-1', command),
        (error: unknown) => status(error) === 409
          && code(error) === 'expense_capture_handoff_consumed'
          && body(error).expenseIds.includes(usedId),
      );
      assert.equal(app.capture.expenses.length, 2, 'nothing is released while one source is in use');
    });
  }

  it('allows the regenerate again once the consuming claim is gone', async () => {
    const { app, batch } = await handedOff();
    app.capture.consumers.push({ expenseId: batch.expenses[0]!.expenseId, reason: 'claim' });
    const command = acceptSecond(app, allocationResult(oneSeller()));
    await assert.rejects(() => app.handoff.execute(ctx(), 'g-1', command), (error: unknown) => code(error) === 'expense_capture_handoff_consumed');

    app.capture.consumers.length = 0;
    const result = await app.handoff.execute(ctx(), 'g-1', command);
    assert.equal(result.regenerated, true);
    assert.equal(result.expenses.length, 1);
  });

  /** §3.1: a converted expense is already `captureGroupId`-bound, so the FIRST handoff rewrites it. */
  it('rewrites a converted expense in place instead of creating a second source for its scope', async () => {
    const app = build({ payload: oneSeller() });
    const converted = {
      id: 'exp-converted', companyId: 'co-1', captureGroupId: 'g-1', captureScopeKey: 'issuer:0105560012345',
      captureAllocationId: null, status: 'NEEDS_REVIEW', updatedAt: new Date(2026, 8, 18),
      paidAmount: '0', paymentStatus: 'UNPAID', postingStatus: 'not_required', journalEntryId: null,
      sourceReimbursementRequestId: null, grandTotalAmount: '0', netPayableAmount: '0',
      primaryAttachmentId: null, createdByUserId: 'user-1',
    };
    app.capture.expenses.push(converted);

    const command = accept(app, allocationResult(oneSeller()));
    const result = await app.handoff.execute(ctx(), 'g-1', command);

    assert.equal(result.expenses.length, 1);
    assert.equal(result.expenses[0]!.expenseId, 'exp-converted');
    assert.equal(app.capture.expenses.length, 1);
    assert.equal(converted.grandTotalAmount, '100.0000');
    assert.equal(converted.captureAllocationId, 'alloc-1');
    assert.equal((converted as { payerUserId?: string }).payerUserId, 'user-payer');
    assert.ok(app.expenses.lines.get('exp-converted')!.length > 0);
  });

  it('refuses when a converted expense changed under the handoff', async () => {
    const app = build({ payload: oneSeller() });
    app.capture.expenses.push({
      id: 'exp-converted', companyId: 'co-1', captureGroupId: 'g-1', captureScopeKey: 'issuer:0105560012345',
      captureAllocationId: null, status: 'NEEDS_REVIEW', updatedAt: new Date(2026, 8, 18),
      paidAmount: '0', paymentStatus: 'UNPAID', postingStatus: 'not_required', journalEntryId: null,
      sourceReimbursementRequestId: null, grandTotalAmount: '0', netPayableAmount: '0',
      primaryAttachmentId: null, createdByUserId: 'user-1',
    });
    const command = accept(app, allocationResult(oneSeller()));
    // Somebody saved the expense between the read and the write.
    app.expenses.raceBeforeUpdate = true;

    await assert.rejects(
      () => app.handoff.execute(ctx(), 'g-1', command),
      (error: unknown) => (code(error) ?? (error as Error).message) === 'EXPENSE_UPDATE_CONFLICT',
    );
  });
});

// ─── §3.2 auto handoff ────────────────────────────────────────────────────────

describe('single-document auto handoff', () => {
  it('creates one NEEDS_REVIEW draft with no allocation and marks the group handed off', async () => {
    const app = build({ payload: oneSeller(), intakeChannel: 'LINE', group: { lineChatKeyHash: 'chat-1' } });

    const result = await app.auto.execute(ctx({ userId: 'system' }), 'g-1');

    assert.ok('expenseId' in result);
    const expense = app.capture.expenses[0]!;
    assert.equal(expense.status, 'NEEDS_REVIEW');
    assert.equal(expense.captureSource, 'LINE_UPLOAD');
    assert.equal(expense.captureAllocationId, null);
    assert.equal(expense.payerUserId, null, 'nobody has said who paid yet');
    assert.equal(expense.createdByUserId, 'user-1', 'the group’s creator owns the draft, not the system actor');
    assert.equal(expense.grandTotalAmount, '100.0000');
    assert.equal(expense.primaryAttachmentId, 'att-1');
    assert.equal((expense.sourceChannelMetadataJson as any).chatKeyHash, 'chat-1');

    const group = app.capture.groups.get('g-1');
    assert.equal(group.status, 'HANDED_OFF');
    assert.equal(group.handoffState, 'ACTIVE');
    assert.equal(group.handoffBatchKey, 'g-1:auto');
    assert.equal(group.acceptedAllocationId, null);
    assert.equal(audits.at(-1).metadataJson.rule, 'auto_single_document');
  });

  it('skips a web group, a second file, an unfinished read and a second issuer', async () => {
    assert.deepEqual(await build({ payload: oneSeller() }).auto.execute(ctx(), 'g-1'), { skipped: 'not_line_channel' });

    const twoFiles = build({ payload: oneSeller(), intakeChannel: 'LINE' });
    twoFiles.capture.files.push({ id: 'f2', companyId: 'co-1', groupId: 'g-1', attachmentId: 'att-2', position: 2, uploadState: 'STORED' });
    assert.deepEqual(await twoFiles.auto.execute(ctx(), 'g-1'), { skipped: 'not_single_file' });

    const reading = build({ payload: oneSeller(), intakeChannel: 'LINE' });
    reading.capture.jobs[0]!.status = 'READING';
    assert.deepEqual(await reading.auto.execute(ctx(), 'g-1'), { skipped: 'read_not_done' });

    const twoIssuers = build({ payload: twoSellers(), intakeChannel: 'LINE' });
    assert.deepEqual(await twoIssuers.auto.execute(ctx(), 'g-1'), { skipped: 'not_single_document' });

    const handedOff = build({ payload: oneSeller(), intakeChannel: 'LINE', group: { handoffState: 'ACTIVE', status: 'HANDED_OFF' } });
    assert.deepEqual(await handedOff.auto.execute(ctx(), 'g-1'), { skipped: 'handoff_exists' });

    assert.deepEqual(await build({ payload: oneSeller(), intakeChannel: 'LINE' }).auto.execute(ctx(), 'missing'), { skipped: 'not_found' });
  });

  it('writes nothing when it skips', async () => {
    const app = build({ payload: twoSellers(), intakeChannel: 'LINE' });
    await app.auto.execute(ctx(), 'g-1');
    assert.equal(app.capture.expenses.length, 0);
    assert.equal(app.capture.groups.get('g-1').status, 'OPEN');
  });
});

// ─── HTTP boundary ────────────────────────────────────────────────────────────

describe('handoff dto', () => {
  const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
  const validate = (value: unknown) => pipe.transform(value, { type: 'body', metatype: ExpenseCaptureHandoffDto });

  it('accepts the documented body and refuses a server-owned field', async () => {
    assert.deepEqual(await validate({ allocationId: 'alloc-1', expectedRevision: 4, idempotencyKey: 'k' }),
      Object.assign(new ExpenseCaptureHandoffDto(), { allocationId: 'alloc-1', expectedRevision: 4, idempotencyKey: 'k' }));
    // §5: a client may not name the payer, the batch key or the lineage.
    await assert.rejects(() => validate({ allocationId: 'alloc-1', expectedRevision: 4, payerUserId: 'user-9' }));
    await assert.rejects(() => validate({ expectedRevision: 4 }));
    await assert.rejects(() => validate({ allocationId: 'alloc-1', expectedRevision: 0 }));
  });
});
