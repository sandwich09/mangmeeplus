/**
 * Facts edit, review and accept (appendix §9, W04a).
 *
 * Hand-built fakes in the style of `expense-capture-group.use-case.spec.ts`: the repository double
 * keeps the properties the use cases lean on — the revision compare-and-set, the ACCEPTED fence on
 * PREVIEW and the observation version sequence — so "the second writer loses" tests the real
 * branch instead of a stub that always says yes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ExpenseCaptureObservations } from '@watchdog-bms/contracts';
import { ExpenseCaptureAccessService } from './expense-capture-group.use-case';
import {
  AcceptExpenseCaptureAllocationUseCase,
  PatchExpenseCaptureFactsUseCase,
  ReviewExpenseCaptureGroupUseCase,
} from './expense-capture-review.use-case';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const classification = {
  contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
  businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT'],
  confidence: 1, evidenceSignals: [], amountSignals: [], settlementSignals: [],
  missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
} as ExpenseCaptureObservations['documents'][number]['classification'];

const facts = (over: Partial<ExpenseCaptureObservations> = {}): ExpenseCaptureObservations => ({
  documents: [{
    ref: 'D1', pageIndexes: [0], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE',
    issuer: { name: 'ร้านเอ' }, currency: 'THB', classification,
  }],
  items: [
    { id: '1:1', documentRef: 'D1', description: 'สินค้า', quantity: '2', unitPrice: '50.00', amount: '100.00', event: 'sale', evidenceSpan: 'x' },
    { id: '1:2', documentRef: 'D1', description: 'สินค้าสอง', amount: '40.00', event: 'sale', evidenceSpan: 'y' },
  ],
  components: [],
  totals: [{ documentRef: 'D1', kind: 'document_total', amount: '140.00', evidenceSpan: '140' }],
  payments: [{ documentRef: 'D1', status: 'paid', occurredAt: '2026-09-02T04:00:00.000Z', evidenceSpan: 'จ่ายแล้ว' }],
  refunds: [],
  completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0], notes: [] },
  ...over,
});

// ─── fakes ────────────────────────────────────────────────────────────────────

class FakeCaptureRepo {
  groups = new Map<string, any>();
  observations: any[] = [];
  allocations: any[] = [];
  members = new Set<string>(['co-1:user-1:branch-1', 'co-1:user-2:branch-1']);
  locks: string[] = [];
  private seq = 0;

  private id(prefix: string) { this.seq += 1; return `${prefix}-${this.seq}`; }

  get client() { return {} as any; }

  transaction<T>(run: (tx: any) => Promise<T>): Promise<T> { return run({}); }

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

  async createObservation(_db: any, input: any) {
    if (this.observations.some((row) => row.companyId === input.companyId && row.fileId === input.fileId && row.version === input.version)) {
      throw new Error('unique constraint: companyId_fileId_version');
    }
    const observation = { id: this.id('obs'), createdAt: new Date(), stale: false, expenseId: null, basedOnVersion: null, ...input };
    this.observations.push(observation);
    return observation;
  }

  async nextObservationVersion(_db: any, companyId: string, key: any) {
    const rows = this.observations.filter((row) => row.companyId === companyId
      && (key.fileId ? row.fileId === key.fileId : row.fileId === null && row.expenseId === key.expenseId));
    return rows.reduce((max, row) => Math.max(max, row.version), 0) + 1;
  }

  async createAllocation(_db: any, input: any) {
    const allocation = { id: this.id('alloc'), status: 'PREVIEW', computedAt: new Date(), acceptedByUserId: null, acceptedAt: null, invalidatedReason: null, ...input };
    this.allocations.push(allocation);
    return allocation;
  }

  async findAllocation(_db: any, companyId: string, groupId: string, allocationId: string) {
    const allocation = this.allocations.find((row) => row.companyId === companyId && row.groupId === groupId && row.id === allocationId);
    return allocation ? { ...allocation } : null;
  }

  async retireAllocations(_db: any, input: any) {
    let count = 0;
    for (const allocation of this.allocations) {
      if (allocation.companyId !== input.companyId || allocation.groupId !== input.groupId) continue;
      if (!input.from.includes(allocation.status)) continue;
      if (input.exceptId && allocation.id === input.exceptId) continue;
      allocation.status = input.to;
      if (input.reason) allocation.invalidatedReason = input.reason;
      count += 1;
    }
    return count;
  }

  async acceptAllocation(_db: any, input: any) {
    const allocation = this.allocations.find((row) => row.companyId === input.companyId && row.id === input.allocationId && row.status === 'PREVIEW');
    if (!allocation) return false;
    Object.assign(allocation, { status: 'ACCEPTED', acceptedByUserId: input.acceptedByUserId, acceptedAt: new Date() });
    return true;
  }

  async isActiveCompanyMember(_db: any, input: any) {
    return this.members.has(`${input.companyId}:${input.userId}:${input.branchId ?? 'none'}`);
  }
}

const audits: any[] = [];
const audit = { log: async (entry: any) => { audits.push(entry); } } as any;
const config = { expenseCaptureGroupIntakeEnabled: true, uploadMaxBytes: 10_485_760, expenseCapturePdfMaxPages: 60 } as any;

const ctx = (over: Record<string, unknown> = {}) => ({
  requestId: 'req-1', authSubject: 'user-1', userId: 'user-1', companyId: 'co-1', membershipId: 'mem-1',
  roles: ['STAFF'], permissions: ['expense.update'], scopes: {}, authProvider: 'watchdog', ...over,
} as any);

const REVIEWER = { userId: 'user-9', permissions: ['expense.review'] };

function build(options: { observations?: ExpenseCaptureObservations | null } = {}) {
  const capture = new FakeCaptureRepo();
  capture.groups.set('g-1', {
    id: 'g-1', companyId: 'co-1', branchId: 'branch-1', createdByUserId: 'user-1', intakeChannel: 'WEB',
    status: 'OPEN', revision: 1, businessUse: 'UNKNOWN', fundingRoute: 'UNKNOWN', payerUserId: null,
    taxReviewJson: null, expenseDateSourceJson: null, handoffState: 'NONE', acceptedAllocationId: null,
    note: null, closedReason: null, closedAt: null, createdAt: new Date(), updatedAt: new Date(),
  });
  if (options.observations !== null) {
    capture.observations.push({
      id: 'obs-seed', companyId: 'co-1', groupId: 'g-1', fileId: 'f1', expenseId: null, version: 1,
      source: 'AI', basedOnVersion: null, stale: false, payloadJson: options.observations ?? facts(),
    });
  }
  const access = new ExpenseCaptureAccessService(capture as any, config);
  return {
    capture,
    patchFacts: new PatchExpenseCaptureFactsUseCase(capture as any, access, audit),
    review: new ReviewExpenseCaptureGroupUseCase(capture as any, access, audit),
    accept: new AcceptExpenseCaptureAllocationUseCase(capture as any, access, audit),
  };
}

const code = (error: any) => error?.getResponse?.()?.code ?? error?.response?.code;
const status = (error: any) => error?.getStatus?.();

/** Review once with everything selected, so the tests that need an allocation have one. */
async function reviewAll(app: ReturnType<typeof build>, over: Record<string, unknown> = {}, actor = ctx()) {
  return app.review.execute(actor, 'g-1', {
    businessUse: 'ALL_COMPANY', fundingRoute: 'EMPLOYEE', payerUserId: 'user-1',
    expectedRevision: app.capture.groups.get('g-1').revision, ...over,
  } as never);
}

// ─── review ───────────────────────────────────────────────────────────────────

describe('review', () => {
  it('computes an allocation, records the review on the group and bumps the revision', async () => {
    const app = build();
    const result = await reviewAll(app);

    assert.equal(result.status, 'PREVIEW');
    assert.equal(result.result.summary.companyAmount, '140.00');
    assert.equal(result.result.outcome, 'READY');
    assert.equal(result.revision, 2);
    const group = app.capture.groups.get('g-1');
    assert.equal(group.businessUse, 'ALL_COMPANY');
    assert.equal(group.fundingRoute, 'EMPLOYEE');
    assert.equal(group.payerUserId, 'user-1');
    assert.equal(app.capture.allocations[0]!.groupRevision, 2);
    assert.deepEqual(app.capture.locks, ['co-1:expense-capture:g-1']);
    assert.equal(audits.at(-1).action, 'expense.capture_group.review');
  });

  it('refuses a caller who is neither the creator nor a reviewer', async () => {
    const app = build();
    await assert.rejects(
      () => reviewAll(app, {}, ctx({ userId: 'user-7', permissions: ['expense.read'] })),
      (error: unknown) => status(error) === 403,
    );
  });

  it('lets a reviewer review somebody else\'s group', async () => {
    const app = build();
    const result = await reviewAll(app, { payerUserId: 'user-2' }, ctx(REVIEWER));
    assert.equal(result.status, 'PREVIEW');
    assert.equal(app.capture.groups.get('g-1').payerUserId, 'user-2');
  });

  it('A32 — naming somebody else as the payer needs expense.review', async () => {
    const app = build();
    await assert.rejects(
      () => reviewAll(app, { payerUserId: 'user-2' }),
      (error: unknown) => status(error) === 403 && code(error) === 'expense_capture_payer_forbidden',
    );
  });

  it('refuses a payer who is not an active member of this company and branch', async () => {
    const app = build();
    await assert.rejects(
      () => reviewAll(app, { payerUserId: 'user-404' }, ctx(REVIEWER)),
      (error: unknown) => status(error) === 422 && code(error) === 'expense_capture_payer_invalid',
    );
  });

  it('refuses a tax decision from somebody without expense.review', async () => {
    const app = build();
    await assert.rejects(
      () => reviewAll(app, { taxReview: { 'issuer:ร้านเอ': { vatMode: 'NO_VAT', inputVatClaimStatus: 'NON_CLAIMABLE', taxEvidenceStatus: 'SUPPORTING_ONLY' } } }),
      (error: unknown) => status(error) === 403 && code(error) === 'expense_capture_tax_review_forbidden',
    );
  });

  it('stamps a reviewer onto the tax decision and keeps it through the next non-reviewer review', async () => {
    const app = build();
    await reviewAll(app, {
      taxReview: { 'issuer:ร้านเอ': { vatMode: 'NO_VAT', inputVatClaimStatus: 'NON_CLAIMABLE', taxEvidenceStatus: 'SUPPORTING_ONLY' } },
    }, ctx(REVIEWER));
    const stored = app.capture.groups.get('g-1').taxReviewJson['issuer:ร้านเอ'];
    assert.equal(stored.reviewedByUserId, 'user-9');
    assert.ok(stored.reviewedAt);

    const again = await reviewAll(app, { businessUse: 'MIXED', selection: { 'f1:1:1': { companyQuantity: '1' } } });
    assert.equal(app.capture.groups.get('g-1').taxReviewJson['issuer:ร้านเอ'].vatMode, 'NO_VAT');
    assert.equal(again.result.scopes[0]!.claimReady, true);
  });

  it('A11 — a second review supersedes the first preview and invalidates an acceptance', async () => {
    const app = build();
    const first = await reviewAll(app);
    await app.accept.execute(ctx(REVIEWER), 'g-1', first.allocationId, { expectedRevision: 2 });
    await reviewAll(app, { businessUse: 'MIXED', selection: {} });

    assert.equal(app.capture.allocations[0]!.status, 'INVALIDATED');
    assert.equal(app.capture.allocations[0]!.invalidatedReason, 'review_recomputed');
    assert.equal(app.capture.allocations[1]!.status, 'PREVIEW');
    assert.equal(app.capture.groups.get('g-1').acceptedAllocationId, null);
  });

  it('refuses a stale revision', async () => {
    const app = build();
    await assert.rejects(
      () => app.review.execute(ctx(), 'g-1', { businessUse: 'ALL_COMPANY', fundingRoute: 'COMPANY', expectedRevision: 9 } as never),
      (error: unknown) => status(error) === 409 && code(error) === 'expense_capture_group_revision_conflict',
    );
  });

  it('refuses once the group has handed off — correction belongs to the expense', async () => {
    const app = build();
    Object.assign(app.capture.groups.get('g-1'), { status: 'HANDED_OFF', handoffState: 'ACTIVE' });
    await assert.rejects(
      () => reviewAll(app),
      (error: unknown) => status(error) === 409 && code(error) === 'expense_capture_handoff_active',
    );
  });

  for (const [label, body] of [
    ['a selection quantity that is not a number', { selection: { 'f1:1:1': { companyQuantity: 'สองชิ้น' } } }],
    ['a negative selection', { selection: { 'f1:1:1': { companyQuantity: '-1' } } }],
    ['a selection entry that is not an object', { selection: { 'f1:1:1': 2 } }],
    ['a date choice that is neither a source nor a date', { expenseDateChoice: { 'issuer:ร้านเอ': 'upload' } }],
    ['a date that is not a date', { expenseDateChoice: { 'issuer:ร้านเอ': { date: 'เมื่อวาน' } } }],
  ] as const) {
    it(`refuses ${label}`, async () => {
      const app = build();
      await assert.rejects(
        () => reviewAll(app, body),
        (error: unknown) => status(error) === 400 && code(error) === 'expense_capture_review_input_invalid',
      );
    });
  }

  it('refuses a tax review value outside the enum, even from a reviewer', async () => {
    const app = build();
    await assert.rejects(
      () => reviewAll(app, { taxReview: { 'issuer:ร้านเอ': { vatMode: 'MAYBE', inputVatClaimStatus: 'NON_CLAIMABLE', taxEvidenceStatus: 'SUPPORTING_ONLY' } } }, ctx(REVIEWER)),
      (error: unknown) => status(error) === 400 && code(error) === 'expense_capture_review_input_invalid',
    );
  });
});

// ─── accept ───────────────────────────────────────────────────────────────────

describe('accept', () => {
  it('a reviewer accepts, and the group records which allocation it accepted', async () => {
    const app = build();
    const preview = await reviewAll(app);
    const accepted = await app.accept.execute(ctx(REVIEWER), 'g-1', preview.allocationId, { expectedRevision: 2 });

    assert.equal(accepted.status, 'ACCEPTED');
    assert.equal(accepted.rule, 'expense.review');
    assert.equal(accepted.groupStatus, 'OPEN');
    assert.equal(app.capture.groups.get('g-1').acceptedAllocationId, preview.allocationId);
    assert.equal(audits.at(-1).action, 'expense.capture_group.allocation_accept');
    assert.equal(audits.at(-1).metadataJson.rule, 'expense.review');
  });

  it('the creator may accept their OWN employee-funded claim, and the audit says so', async () => {
    const app = build();
    const preview = await reviewAll(app);
    const accepted = await app.accept.execute(ctx(), 'g-1', preview.allocationId, { expectedRevision: 2 });
    assert.equal(accepted.rule, 'self_claim');
  });

  it('the creator may NOT accept a company-funded allocation', async () => {
    const app = build();
    const preview = await reviewAll(app, { fundingRoute: 'COMPANY', payerUserId: null });
    await assert.rejects(
      () => app.accept.execute(ctx(), 'g-1', preview.allocationId, { expectedRevision: 2 }),
      (error: unknown) => status(error) === 403,
    );
  });

  it('the creator may NOT accept a claim somebody else is the payer of', async () => {
    const app = build();
    const preview = await reviewAll(app, { payerUserId: 'user-2' }, ctx(REVIEWER));
    await assert.rejects(
      () => app.accept.execute(ctx(), 'g-1', preview.allocationId, { expectedRevision: 2 }),
      (error: unknown) => status(error) === 403,
    );
  });

  it('refuses a blocked allocation and names what is blocking it', async () => {
    const app = build();
    const preview = await reviewAll(app, { fundingRoute: 'UNKNOWN', payerUserId: null }, ctx(REVIEWER));
    assert.equal(preview.result.outcome, 'BLOCKED');
    await assert.rejects(
      () => app.accept.execute(ctx(REVIEWER), 'g-1', preview.allocationId, { expectedRevision: 2 }),
      (error: any) => status(error) === 422
        && code(error) === 'expense_capture_allocation_blocked'
        && error.getResponse().blockers.includes('expense_capture_funding_route_required'),
    );
  });

  it('A41 — accepting "no company portion" closes the group with its evidence', async () => {
    const app = build();
    const preview = await reviewAll(app, { businessUse: 'MIXED', selection: {} });
    assert.equal(preview.result.outcome, 'NO_COMPANY_PORTION');
    const accepted = await app.accept.execute(ctx(REVIEWER), 'g-1', preview.allocationId, { expectedRevision: 2 });

    assert.equal(accepted.groupStatus, 'CLOSED_NO_HANDOFF');
    const group = app.capture.groups.get('g-1');
    assert.equal(group.status, 'CLOSED_NO_HANDOFF');
    assert.equal(group.closedReason, 'NO_COMPANY_PORTION');
    assert.ok(group.closedAt);
  });

  it('refuses an allocation computed before a later change (A11)', async () => {
    const app = build();
    const preview = await reviewAll(app);
    app.capture.groups.get('g-1').revision = 3;
    await assert.rejects(
      () => app.accept.execute(ctx(REVIEWER), 'g-1', preview.allocationId, { expectedRevision: 3 }),
      (error: unknown) => status(error) === 409 && code(error) === 'expense_capture_allocation_stale',
    );
  });

  it('a second accept of the same allocation loses instead of accepting twice', async () => {
    const app = build();
    const preview = await reviewAll(app);
    await app.accept.execute(ctx(REVIEWER), 'g-1', preview.allocationId, { expectedRevision: 2 });
    await assert.rejects(
      () => app.accept.execute(ctx(REVIEWER), 'g-1', preview.allocationId, { expectedRevision: 3 }),
      (error: unknown) => status(error) === 409 && code(error) === 'expense_capture_allocation_not_current',
    );
  });

  it('refuses an allocation of another group, without saying whether it exists', async () => {
    const app = build();
    await reviewAll(app);
    await assert.rejects(
      () => app.accept.execute(ctx(REVIEWER), 'g-1', 'alloc-999', { expectedRevision: 2 }),
      (error: unknown) => status(error) === 404,
    );
  });

  it('refuses once the group has handed off', async () => {
    const app = build();
    const preview = await reviewAll(app);
    Object.assign(app.capture.groups.get('g-1'), { status: 'HANDED_OFF', handoffState: 'ACTIVE' });
    await assert.rejects(
      () => app.accept.execute(ctx(REVIEWER), 'g-1', preview.allocationId, { expectedRevision: 2 }),
      (error: unknown) => status(error) === 409 && code(error) === 'expense_capture_handoff_active',
    );
  });
});

// ─── facts ────────────────────────────────────────────────────────────────────

describe('facts edit', () => {
  it('writes a new HUMAN observation instead of overwriting the read (A12)', async () => {
    const app = build();
    const result = await app.patchFacts.execute(ctx(), 'g-1', {
      fileId: 'f1', patch: { items: [{ id: '1:2', amount: '55.00' }] }, expectedRevision: 1,
    });

    assert.equal(result.version, 2);
    assert.equal(result.revision, 2);
    assert.equal(app.capture.observations.length, 2);
    assert.equal(app.capture.observations[0]!.payloadJson.items[1]!.amount, '40.00');
    assert.equal(app.capture.observations[1]!.source, 'HUMAN');
    assert.equal(app.capture.observations[1]!.payloadJson.items[1]!.amount, '55.00');
    assert.deepEqual(audits.at(-1).metadataJson.fields, ['item.amount']);
  });

  it('A48 — the edit invalidates the preview and the acceptance built on the old numbers', async () => {
    const app = build();
    const preview = await reviewAll(app);
    await app.accept.execute(ctx(REVIEWER), 'g-1', preview.allocationId, { expectedRevision: 2 });
    const group = app.capture.groups.get('g-1');
    assert.equal(group.acceptedAllocationId, preview.allocationId);

    const result = await app.patchFacts.execute(ctx(), 'g-1', {
      fileId: 'f1', patch: { items: [{ id: '1:1', amount: '120.00' }] }, expectedRevision: group.revision,
    });
    assert.equal(result.invalidatedAllocations, 1);
    assert.equal(app.capture.allocations[0]!.status, 'INVALIDATED');
    assert.equal(app.capture.allocations[0]!.invalidatedReason, 'facts_changed');
    assert.equal(app.capture.groups.get('g-1').acceptedAllocationId, null);
  });

  it('the next review reads the corrected number', async () => {
    const app = build();
    await app.patchFacts.execute(ctx(), 'g-1', {
      fileId: 'f1', patch: { items: [{ id: '1:2', amount: '60.00' }], totals: [{ documentRef: 'D1', kind: 'document_total', amount: '160.00' }] }, expectedRevision: 1,
    });
    const result = await reviewAll(app);
    assert.equal(result.result.summary.companyAmount, '160.00');
  });

  it('refuses a file this group never read', async () => {
    const app = build();
    await assert.rejects(
      () => app.patchFacts.execute(ctx(), 'g-1', { fileId: 'f9', patch: { items: [{ id: '1:1', amount: '1.00' }] }, expectedRevision: 1 }),
      (error: unknown) => status(error) === 404,
    );
  });

  it('turns a refused patch into a 400 the user can read', async () => {
    const app = build();
    await assert.rejects(
      () => app.patchFacts.execute(ctx(), 'g-1', { fileId: 'f1', patch: { items: [{ id: '9:9', amount: '1.00' }] }, expectedRevision: 1 }),
      (error: any) => status(error) === 400
        && code(error) === 'expense_capture_facts_patch_unknown_target'
        && /ไม่พบรายการ/.test(error.getResponse().message),
    );
  });

  it('refuses a stale revision before it writes anything', async () => {
    const app = build();
    await assert.rejects(
      () => app.patchFacts.execute(ctx(), 'g-1', { fileId: 'f1', patch: { items: [{ id: '1:1', amount: '1.00' }] }, expectedRevision: 7 }),
      (error: unknown) => status(error) === 409 && code(error) === 'expense_capture_group_revision_conflict',
    );
    assert.equal(app.capture.observations.length, 1);
  });

  it('refuses a caller who may only read', async () => {
    const app = build();
    await assert.rejects(
      () => app.patchFacts.execute(ctx({ userId: 'user-7', permissions: ['expense.read'] }), 'g-1', {
        fileId: 'f1', patch: { items: [{ id: '1:1', amount: '1.00' }] }, expectedRevision: 1,
      }),
      (error: unknown) => status(error) === 403,
    );
  });

  it('refuses once the group has handed off — the expense is where a correction goes', async () => {
    const app = build();
    Object.assign(app.capture.groups.get('g-1'), { status: 'HANDED_OFF', handoffState: 'ACTIVE' });
    await assert.rejects(
      () => app.patchFacts.execute(ctx(), 'g-1', { fileId: 'f1', patch: { items: [{ id: '1:1', amount: '1.00' }] }, expectedRevision: 1 }),
      (error: unknown) => status(error) === 409 && code(error) === 'expense_capture_handoff_active',
    );
    assert.equal(app.capture.observations.length, 1);
  });

  it('A15 — another company\'s group is not found, not forbidden', async () => {
    const app = build();
    await assert.rejects(
      () => app.patchFacts.execute(ctx({ companyId: 'co-2' }), 'g-1', {
        fileId: 'f1', patch: { items: [{ id: '1:1', amount: '1.00' }] }, expectedRevision: 1,
      }),
      (error: unknown) => status(error) === 404,
    );
  });
});
