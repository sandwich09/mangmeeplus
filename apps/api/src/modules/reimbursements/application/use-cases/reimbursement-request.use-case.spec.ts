import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CreateReimbursementDraftUseCase,
  CancelReimbursementUseCase,
  ReopenRejectedReimbursementUseCase,
  UpdateReimbursementDraftUseCase,
  SubmitReimbursementUseCase,
  ReimbursementInternalNotesUseCase,
  GetReimbursementDetailUseCase,
  ListReimbursementsUseCase,
  reimbursementPeriodKey,
} from './reimbursement-request.use-case';
import { RevealClaimPayoutUseCase } from './reimbursement-payout-reveal.use-case';
import { ExportReimbursementEvidenceUseCase, FinanceReviewReimbursementUseCase } from './reimbursement-finance.use-case';
import { claimSignatureAckHash, claimSnapshotFields, computeSnapshotHash } from '../../domain/logic/reimbursement.logic';
import { hasPayoutSnapshot, payoutAttestationError, sealPayoutDestination } from '../../domain/logic/payout-destination.logic';
import { ReimbursementEvidenceService } from '../services/reimbursement-evidence.service';
import { PLATFORM_ROLE_KEYS, ROLE_GRANTS } from '../../../auth/permission-registry';
import { compileRole } from '../../../employee-access/domain/logic/capability.logic';
import { filterPermissionsByEntitlement } from '../../../employee-access/domain/logic/feature-gate.logic';
import {
  approverModeForRole,
  buildReimbursementApproverRoleOptions,
  GetReimbursementPolicyUseCase,
  ListReimbursementApproverOptionsUseCase,
  UpdateReimbursementPolicyUseCase,
  type ApproverRoleCandidate,
} from './reimbursement-policy.use-case';
import { parseReimbursementPolicySnapshot } from '../../domain/reimbursement.constants';
import { MemberPayoutAccountUseCase } from './reimbursement-payout.use-case';
import { fakePayoutTables } from '../../infrastructure/reimbursement-payout.fixture';
import {
  applyDraftPayout, deleteMemberPayoutAccount, draftPayoutAfterReopen, freezePayoutAtSubmit, readClaimPayout, readClaimPayoutSecret,
  readDraftDefaultPayout, readMemberPayoutAccount, readMemberPayoutSecret, readSubmitPayoutPlan, writeMemberPayoutAccount,
} from '../../infrastructure/reimbursement-payout';

// Lane C: one claim, many lines. The header total, category and date are a
// server-side rollup of the lines — a client never sends them.

const noopAudit = { log: async () => undefined } as any;
const noopOutbox = { append: async () => undefined } as any;
const readyApproverRoutes = {
  resolveNamedSubmissionRoute: async () => null,
  resolveSubmissionRoute: async ({ roleKey }: any) => ({
    responsibilityRole: roleKey, effectiveTaskRole: roleKey,
    recipientUserIds: ['approver-1'], ownerRecipientUserIds: ['owner-1'], ownerFallbackUsed: false,
  }),
} as any;
const noopProjections = { execute: async () => undefined } as any;

function submitUseCase(repo: any, audit: any, outbox: any, evidence: any) {
  return new SubmitReimbursementUseCase(repo, audit, outbox, evidence, readyApproverRoutes, noopProjections);
}

describe('reimbursementPeriodKey', () => {
  it('rolls the month at Bangkok midnight rather than UTC midnight', () => {
    assert.equal(reimbursementPeriodKey(new Date('2026-07-31T16:59:59.999Z')), '2026-07');
    assert.equal(reimbursementPeriodKey(new Date('2026-07-31T17:00:00.000Z')), '2026-08');
  });
});

describe('ReimbursementInternalNotesUseCase', () => {
  it('keeps notes company-scoped and lets only the author or owner edit and delete', async () => {
    const now = new Date('2026-09-25T00:00:00.000Z');
    const notes: any[] = [];
    const auditRows: any[] = [];
    let claimStatus = 'DRAFT';
    const repo = {
      findRequestById: async (companyId: string) => companyId === 'co-1'
        ? { id: 'claim-1', companyId, branchId: 'branch-1', requesterUserId: 'staff-1', status: claimStatus } : null,
      createInternalNote: async (_companyId: string, _requestId: string, authorUserId: string, body: string) => {
        const note = { id: 'note-1', authorUserId, body, createdAt: now, updatedAt: now }; notes.push(note); return note;
      },
      findInternalNote: async (_companyId: string, _requestId: string, noteId: string) => notes.find(note => note.id === noteId) ?? null,
      updateInternalNote: async (_companyId: string, _requestId: string, noteId: string, body: string) => { notes.find(note => note.id === noteId).body = body; },
      deleteInternalNote: async (_companyId: string, _requestId: string, noteId: string) => { notes.splice(notes.findIndex(note => note.id === noteId), 1); },
      getUserDisplayNames: async () => ({ 'staff-1': 'ผู้เบิก' }),
    } as any;
    const useCase = new ReimbursementInternalNotesUseCase(repo, { log: async (entry: any) => { auditRows.push(entry); } } as any);
    const author = ctx({ scopes: { branchIds: ['branch-1'] } });
    claimStatus = 'PAID';
    const created = await useCase.create(author, 'claim-1', '  ตรวจเอกสารแล้ว  ');
    assert.equal(created.body, 'ตรวจเอกสารแล้ว');
    await assert.rejects(() => useCase.create(author, 'claim-1', '   '), /internal_note_body_invalid/);
    await assert.rejects(() => useCase.create(ctx({ companyId: 'co-2' }), 'claim-1', 'x'), /not found/i);
    await assert.rejects(() => useCase.create(ctx({ scopes: { branchIds: ['branch-2'] } }), 'claim-1', 'x'), /branch/i);
    await assert.rejects(() => useCase.update(ctx({ userId: 'other', permissions: ['reimbursement.read'] }), 'claim-1', 'note-1', 'changed'), /Cannot edit/);
    await useCase.update(ctx({ userId: 'owner', roles: ['OWNER'], permissions: ['reimbursement.read'] }), 'claim-1', 'note-1', '  checked  ');
    assert.equal(notes[0].body, 'checked');
    await assert.rejects(() => useCase.delete(ctx({ userId: 'other', permissions: ['reimbursement.read'] }), 'claim-1', 'note-1'), /Cannot delete/);
    await useCase.delete(author, 'claim-1', 'note-1');
    assert.equal(notes.length, 0);
    assert.deepEqual(auditRows.map(row => row.action), ['reimbursement.internal_note.create', 'reimbursement.internal_note.update', 'reimbursement.internal_note.delete']);
    assert.ok(auditRows.every(row => !JSON.stringify(row.metadataJson).includes('checked')));
  });
});

function ctx(overrides: Partial<any> = {}) {
  return {
    requestId: 'req-1', authSubject: 's', userId: 'staff-1', companyId: 'co-1',
    membershipId: 'm', roles: ['STAFF'],
    permissions: ['reimbursement.create', 'reimbursement.update_own_draft', 'reimbursement.submit', 'reimbursement.read_own'],
    scopes: {}, authProvider: 'dev', ...overrides,
  } as any;
}

function inputLine(overrides: Partial<any> = {}): any {
  return {
    lineNo: 1, incurredDate: '2026-01-05T00:00:00.000Z', description: 'แท็กซี่ไปหาลูกค้า',
    categoryKey: 'travel', categoryLabel: 'เดินทาง', amount: '100.00', ...overrides,
  };
}

function evidenceService() {
  const attachment = { id: 'att-1', companyId: 'co-1', branchId: 'branch-1', originalFileName: 'receipt.pdf', status: 'ACTIVE', uploadedByUserId: 'staff-1' };
  return new ReimbursementEvidenceService(
    {
      findById: async ({ id }: any) => ({ ...attachment, id }),
      findManyByIds: async ({ ids }: any) => ids.map((id: string) => ({ ...attachment, id })),
    } as any,
    { findById: async (_c: string, id: string) => ({ id, companyId: 'co-1', branchId: 'branch-1', createdByUserId: 'staff-1' }) } as any,
  );
}

type RepoOptions = {
  policy?: Record<string, unknown> | null;
  claimedElsewhere?: { lineNo: number; attachmentId?: string; linkedExpenseId?: string; requestNo?: string }[];
  duplicateCandidates?: any[];
  status?: string;
  submitError?: Error;
  documentNumberReused?: boolean;
  supersededDuplicateCandidateCount?: number;
  supersededApprovalStepCount?: number;
  /** Expense projections a cancellation has to void before the claim may close. */
  claimProjections?: Array<{ id: string; sourceReimbursementLineId: string; status?: string }>;
  /** Payout: by default the fixture claim asks for cash, so a test about something else needs no account; this leaves it with no choice. */
  noDefaultPayout?: boolean;
  /** Payout: members an employee-data editor can look up (`findPayoutMember`). */
  payoutMembers?: Record<string, { displayName: string; membershipStatus?: string; hasEmployeeProfile: boolean; allBranches: boolean; branchIds: string[]; managesPeople: boolean }>;
};

/** Captures the outbox rows a two-phase repository method writes inside its transaction. */
function fakeTx(rows: any[]) {
  return { outboxEvent: { createMany: async ({ data }: any) => { rows.push(...data); return { count: data.length }; } } };
}

function fakeRepo(options: RepoOptions = {}) {
  let request: any = null;
  // The payout tables are in memory, but every read and write below is the production function.
  const payoutTables = fakePayoutTables();
  const payoutDb = payoutTables.client;
  const projections = (options.claimProjections ?? []).map((projection) => ({ status: 'CONFIRMED', ...projection }));
  const calls = {
    claimQueries: [] as any[], duplicates: [] as any[], audits: [] as any[], outbox: [] as any[],
    approvalSteps: [] as any[], voided: [] as string[], projections: [] as any[],
  };
  const repo = {
    assertReimbursementRequester: async (_company: string, _branch: string, userId: string) => ({ userId, displayName: 'Somchai' }),
    resolveSourceLines: async (_company: string, _user: string, _branch: string, _currency: string, lines: any[]) => lines.map(line => ({ ...line, ...(line.linkedExpenseId ? { sourceExpenseSnapshot: { schemaVersion: 1, expenseId: line.linkedExpenseId } } : {}) })),
    resolveCreateBranchId: async () => 'branch-1',
    findPolicy: async () => options.policy ?? null,
    getUserDisplayName: async () => 'Somchai',
    // Lane D: the detail path resolves approver/reviewer/payer names in one batch.
    getUserDisplayNames: async () => ({}),
    // Lane F: the detail path also lists uploaded scans of the signed claim form.
    listSignedClaimFormCopies: async () => [],
    createRequest: async (data: any, payout?: any) => {
      request = {
        id: 'rb-1', status: options.status ?? 'DRAFT', requesterUserId: data.requesterUserId,
        paymentTotalAmount: '0.0000', outstandingAmount: data.amount, duplicateStatus: 'NOT_CHECKED',
        financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'UNPAID', postingStatus: 'not_required',
        createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...data,
        lines: data.lines.map((line: any, index: number) => ({ ...line, id: `rbl-${index + 1}`, companyId: data.companyId, reimbursementRequestId: 'rb-1' })),
      };
      if (!options.noDefaultPayout && !payout) request.payoutMethod = 'CASH';
      if (payout) {
        Object.assign(request, await applyDraftPayout(payoutDb, data.companyId, request.id, payout.write));
        await payout.onPersisted?.(fakeTx(calls.outbox));
      }
      return request;
    },
    updateDraftRequest: async (companyId: string, id: string, expectedUpdatedAt: Date, data: any, lines?: any[], payout?: any) => {
      assert.equal(expectedUpdatedAt, request.updatedAt);
      if (payout) {
        Object.assign(request, await applyDraftPayout(payoutDb, companyId, id, payout.write));
        await payout.onPersisted?.(fakeTx(calls.outbox));
      }
      Object.assign(request, data, { updatedAt: new Date(request.updatedAt.getTime() + 1) });
      if (lines) request.lines = lines.map((line: any, index: number) => ({
        ...line, id: `rbl-${index + 1}`, companyId, reimbursementRequestId: id,
      }));
      return request;
    },
    findRequestById: async (companyId: string, id: string, withRelations?: boolean) => request?.companyId !== companyId || request?.id !== id
      ? null : withRelations ? { ...request, approvalSteps: [], payments: [], duplicateCandidates: [] } : request,
    updateRequest: async (_companyId: string, _id: string, data: any) => { Object.assign(request, data); return request; },
    reopenRejectedRequest: async (_companyId: string, _id: string, expectedUpdatedAt: Date, actorUserId: string, expectedStatus = 'REJECTED') => {
      assert.equal(expectedUpdatedAt, request.updatedAt);
      // Mirrors the repository: a withdraw needs the current step still undecided, and cancels it.
      const current = calls.approvalSteps.find((step) => step.id === request.currentApprovalStepId);
      if (request.status !== expectedStatus || (expectedStatus === 'PENDING_APPROVAL' && current?.status)) {
        throw new Error('reimbursement_changed');
      }
      if (expectedStatus === 'PENDING_APPROVAL') Object.assign(current ?? {}, { status: 'CANCELLED', invalidatedReason: 'withdrawn_by_requester' });
      Object.assign(request, await draftPayoutAfterReopen(payoutDb, request), {
        status: 'DRAFT', rejectedAt: null, rejectionReason: null, approvalSnapshotHash: null, approvalPolicySnapshotJson: null,
        currentApprovalStepId: null, updatedByUserId: actorUserId, updatedAt: new Date(request.updatedAt.getTime() + 1),
      });
      return request;
    },
    // Cancellation is two-phase since d1d3b23e: the intent commits first, every claim expense
    // projection is voided outside the transaction, and only a claim with no live projection may
    // close. Both fakes keep the repository's guards so the spec still proves that order.
    listClaimProjections: async () => projections,
    beginCancellationAtomic: async (data: any) => {
      assert.equal(data.expectedStatus, request.status);
      assert.equal(data.expectedUpdatedAt, request.updatedAt);
      if (request.cancellationPendingAt) return { request, resumed: true };
      if (request.paymentStatus === 'PAID' || request.paymentStatus === 'PARTIALLY_PAID') {
        throw new Error('reimbursement_cancellation_has_payment');
      }
      Object.assign(request, {
        cancellationPendingAt: data.startedAt,
        cancellationPendingByUserId: data.actorUserId,
        cancellationPendingReason: data.reason,
        updatedAt: new Date(request.updatedAt.getTime() + 1),
      });
      await data.onIntentPersisted(fakeTx(calls.outbox));
      return { request, resumed: false };
    },
    completeCancellationAtomic: async (data: any) => {
      if (!request.cancellationPendingAt || request.cancellationPendingByUserId !== data.actorUserId) {
        throw new Error('reimbursement_cancellation_intent_changed');
      }
      if (projections.some((projection) => projection.status !== 'VOIDED')) {
        throw new Error('reimbursement_cancellation_projection_live');
      }
      Object.assign(request, {
        status: 'CANCELLED',
        cancelledAt: data.completedAt,
        rejectionReason: request.cancellationPendingReason,
        paymentStatus: 'NOT_PAYABLE',
        updatedAt: new Date(request.updatedAt.getTime() + 1),
      });
      await data.onCancelledPersisted(fakeTx(calls.outbox));
      return request;
    },
    findLinesClaimedElsewhere: async (companyId: string, excludeId: string, attachmentIds: string[], expenseIds: string[]) => {
      calls.claimQueries.push({ companyId, excludeId, attachmentIds, expenseIds });
      return options.claimedElsewhere ?? [];
    },
    findDuplicateCandidates: async () => options.duplicateCandidates ?? [],
    createDuplicateCandidate: async (data: any) => { calls.duplicates.push(data); },
    createApprovalStep: async () => ({ id: 'step-1' }),
    submitDraftAtomic: async ({ expectedUpdatedAt, request: data, duplicateCandidates, approvalStep, payout, onSubmittedPersisted }: any) => {
      if (options.submitError) throw options.submitError;
      assert.equal(expectedUpdatedAt, request.updatedAt);
      // Like the repository transaction: the payout is decided, checked against what was shown and
      // frozen first, by the production function, and the claim's hash is made from its columns.
      const frozen = payout ? await freezePayoutAtSubmit(payoutDb, { ...request }, payout) : undefined;
      const snapshotHash = frozen ? payout.snapshotHash(frozen.columns) : approvalStep?.requestSnapshotHash;
      const step = approvalStep ? {
        id: `step-${calls.approvalSteps.length + 1}`, ...approvalStep, requestSnapshotHash: snapshotHash,
        assignedApproverUserIds: approvalStep.assignedApproverUserIdsJson,
      } : undefined;
      if (step) calls.approvalSteps.push(step);
      calls.duplicates.push(...duplicateCandidates);
      const documentNumber = { id: 'num-1', documentNumber: 'RB-202601-000001' };
      Object.assign(request, data, frozen && { ...frozen.columns, approvalSnapshotHash: snapshotHash }, {
        requestNo: documentNumber.documentNumber,
        currentApprovalStepId: step?.id ?? null,
        updatedAt: new Date(request.updatedAt.getTime() + 1),
      });
      await onSubmittedPersisted(fakeTx(calls.outbox), {
        step, documentNumber, documentNumberReused: options.documentNumberReused ?? false,
        supersededDuplicateCandidateCount: options.supersededDuplicateCandidateCount ?? 0,
        supersededApprovalStepCount: options.supersededApprovalStepCount ?? 0,
        payout: frozen,
      });
      return {
        step,
        documentNumber,
        documentNumberReused: options.documentNumberReused ?? false,
        supersededDuplicateCandidateCount: options.supersededDuplicateCandidateCount ?? 0,
        supersededApprovalStepCount: options.supersededApprovalStepCount ?? 0,
      };
    },
    completePolicyProjectionAtomic: async (data: any) => {
      Object.assign(request, {
        status: 'READY_FOR_PAYMENT', financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'UNPAID',
        postingStatus: 'pending', currentApprovalStepId: null, currentApproverUserId: null,
      });
      await data.onReadyPersisted(fakeTx(calls.outbox));
      return request;
    },
    // ---- Payout: thin wrappers, like the repository's own ----
    findMemberPayoutAccount: (companyId: string, userId: string) => readMemberPayoutAccount(payoutDb, companyId, userId),
    findMemberPayoutSecret: (companyId: string, userId: string) => readMemberPayoutSecret(payoutDb, companyId, userId),
    setMemberPayoutAccount: async (data: any, onPersisted: any) => {
      const change = await writeMemberPayoutAccount(payoutDb, data);
      await onPersisted(fakeTx(calls.outbox), change);
      return change.after;
    },
    removeMemberPayoutAccount: async (companyId: string, userId: string, onPersisted: any) => {
      const before = await deleteMemberPayoutAccount(payoutDb, companyId, userId);
      if (before) await onPersisted(fakeTx(calls.outbox), before);
      return !!before;
    },
    // A member of the fixture is ACTIVE unless a case says otherwise.
    findPayoutMember: async (_companyId: string, userId: string) => (options.payoutMembers?.[userId] ? { membershipStatus: 'ACTIVE', ...options.payoutMembers[userId] } : null),
    findClaimPayout: (claim: any) => readClaimPayout(payoutDb, claim),
    findDraftDefaultPayout: (claim: any) => readDraftDefaultPayout(payoutDb, claim),
    findClaimPayoutSecret: (companyId: string, requestId: string, version: number) => readClaimPayoutSecret(payoutDb, companyId, requestId, version),
    planSubmitPayout: (claim: any) => readSubmitPayoutPlan(payoutDb, claim),
  } as any;
  // Voiding a projection is what makes it safe to close the claim, so the fake really flips it.
  const voidExpense = {
    executeForReimbursement: async (_ctx: any, expenseId: string) => {
      calls.voided.push(expenseId);
      const projection = projections.find((row) => row.id === expenseId);
      if (projection) projection.status = 'VOIDED';
    },
  } as any;
  return { repo, calls, voidExpense, projections, payoutTables, get request() { return request; } };
}

/** The real payout use case over the fake repository; its key never leaves this process. */
const PAYOUT_KEY = Buffer.alloc(32, 7);
function payoutUseCase(repo: any, audit: any = noopAudit, notifications: any[] = []) {
  return new MemberPayoutAccountUseCase(
    repo, audit, { credentialEncryptionKey: PAYOUT_KEY } as any,
    { executeInTransaction: async (input: any) => { notifications.push(input); } } as any,
  );
}

function useCases(state: { repo: any; calls?: { audits: any[] } }) {
  const evidence = evidenceService();
  const audit = state.calls
    ? { log: async (data: any) => { state.calls!.audits.push(data); } } as any
    : noopAudit;
  const payouts = payoutUseCase(state.repo, audit);
  return {
    payouts,
    create: new CreateReimbursementDraftUseCase(state.repo, audit, evidence, payouts),
    update: new UpdateReimbursementDraftUseCase(state.repo, audit, evidence, payouts),
    submit: new SubmitReimbursementUseCase(
      state.repo, audit, noopOutbox, evidence, readyApproverRoutes,
      { execute: async (...args: any[]) => { (state.calls as any)?.projections?.push(args); } } as any,
    ),
  };
}

describe('preparing reimbursement for another member', () => {
  it('requires finance authority and keeps the selected recipient separate from the preparer', async () => {
    const state = fakeRepo();
    const cases = useCases(state);
    const input = { reason: 'prepare for employee', requesterUserId: 'staff-1', lines: [inputLine({ attachmentId: 'att-1' })] };
    await assert.rejects(cases.create.execute(ctx({ userId: 'other-staff' }), input), /Cannot prepare a reimbursement for another member/);
    assert.equal(state.request, null);
    const created = await cases.create.execute(ctx({ userId: 'finance-1', permissions: ['reimbursement.create', 'reimbursement.finance_review'] }), input);
    assert.equal(created.requesterUserId, 'staff-1');
    const saved = await state.repo.findRequestById('co-1', created.id);
    assert.equal(saved.createdByUserId, 'finance-1');
  });
});

describe('every company role own reimbursement journey', () => {
  const roles = { ...ROLE_GRANTS, CUSTOM_READONLY: compileRole({ entitledFeatureKeys: null }).permissionKeys };
  // PLATFORM_ROLE_KEYS, not just SYSTEM_ADMIN: the มั่งมี sales roles are members of the platform
  // tenant and hold no business permission at all (S29), so "every company role can file its own
  // reimbursement" is not a rule about them.
  for (const [role, permissions] of Object.entries(roles).filter(([key]) => !PLATFORM_ROLE_KEYS.includes(key))) {
    it(`${role} creates, attaches evidence, updates and submits its own draft`, async () => {
      const state = fakeRepo();
      const cases = useCases(state);
      const caller = ctx({ roles: [role], permissions });
      assert.ok(permissions.includes('attachment.create'));
      assert.ok(permissions.includes('company.branch.read'));
      const created = await cases.create.execute(caller, { reason: 'เดินทาง', branchId: 'branch-1', lines: [inputLine()] } as any);
      assert.equal(created.requesterUserId, caller.userId);
      await cases.update.execute(caller, created.id, { lines: [inputLine({ attachmentId: 'att-1' })] });
      const submitted = await cases.submit.execute(caller, created.id);
      assert.equal(submitted.status, 'PENDING_APPROVAL');
      assert.equal(state.request.submittedByUserId, caller.userId);
      assert.equal(state.calls.approvalSteps[0].assignedApproverUserIds.includes(caller.userId), false);
    });
  }

  it('keeps custom self service own-only, branch scoped and feature gated at create and submit', async () => {
    const state = fakeRepo();
    const cases = useCases(state);
    const own = ctx({ roles: ['CUSTOM_READONLY'], permissions: roles.CUSTOM_READONLY, scopes: { branchIds: ['branch-1'] } });
    const created = await cases.create.execute(own, { branchId: 'branch-1', reason: 'เดินทาง', lines: [inputLine({ attachmentId: 'att-1' })] } as any);
    const other = { ...own, userId: 'other-user' };
    await assert.rejects(() => cases.update.execute(other, created.id, { reason: 'not mine' }), /Cannot update/);
    await assert.rejects(() => cases.submit.execute(other, created.id), /Only the requester/);
    await assert.rejects(() => cases.submit.execute({ ...own, companyId: 'co-2' }, created.id), /not found/);
    await assert.rejects(() => cases.submit.execute({ ...own, scopes: { branchIds: ['branch-2'] } }, created.id), /branch/i);
    const off = { ...own, permissions: filterPermissionsByEntitlement(own.permissions, new Set()) };
    await assert.rejects(() => cases.create.execute(off, { reason: 'เดินทาง', lines: [inputLine()] } as any), /Missing permission/);
    await assert.rejects(() => cases.submit.execute(off, created.id), /Missing permission/);
    assert.equal(state.request.status, 'DRAFT');
    assert.equal(state.calls.approvalSteps.length, 0);
  });
});

describe('CreateReimbursementDraftUseCase (multi-line)', () => {
  it('rejects future dates at create/update/submit without mutation and accepts correction at Bangkok midnight', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-12-31T17:00:00.000Z') });
    const state = fakeRepo();
    const cases = useCases(state);
    const future = inputLine({ incurredDate: '2027-01-02', attachmentId: 'att-1' });
    await assert.rejects(() => cases.create.execute(ctx(), { reason: 'r', lines: [future] } as any), /line_incurred_date_in_future:1/);
    assert.equal(state.request, null);
    assert.equal(state.calls.audits.length, 0);

    const today = inputLine({ incurredDate: '2027-01-01', attachmentId: 'att-1' });
    const created = await cases.create.execute(ctx(), { reason: 'r', lines: [today] } as any);
    const beforeUpdate = structuredClone(state.request);
    await assert.rejects(() => cases.update.execute(ctx(), created.id, { lines: [future] }), /line_incurred_date_in_future:1/);
    assert.deepEqual(state.request, beforeUpdate);

    // A pre-fix persisted future draft cannot bypass validation by sending an empty submit body.
    state.request!.lines[0].incurredDate = new Date('2027-01-02T00:00:00Z');
    const beforeSubmit = structuredClone(state.request);
    await assert.rejects(() => cases.submit.execute(ctx(), created.id), /line_incurred_date_in_future:1/);
    assert.deepEqual(state.request, beforeSubmit);
    assert.equal(state.calls.approvalSteps.length, 0);
    assert.equal(state.calls.duplicates.length, 0);
    assert.equal(state.calls.outbox.length, 0);
    assert.equal(state.calls.projections.length, 0);

    await cases.update.execute(ctx(), created.id, { lines: [today] });
    const submitted = await cases.submit.execute(ctx(), created.id);
    assert.equal(submitted.status, 'PENDING_APPROVAL');
    assert.equal(state.request!.lines[0].incurredDate.toISOString(), '2027-01-01T00:00:00.000Z');
  });
  it('rolls the header up from the lines instead of trusting the client', async () => {
    const state = fakeRepo();
    const created = await useCases(state).create.execute(ctx(), {
      reason: 'ไปพบลูกค้า 2 วัน',
      lines: [
        inputLine({ lineNo: 1, amount: '100.50', incurredDate: '2026-01-05T00:00:00.000Z' }),
        inputLine({ lineNo: 2, amount: '249.50', incurredDate: '2026-01-03T00:00:00.000Z', description: 'ที่พัก', categoryKey: 'accommodation', categoryLabel: 'ที่พัก' }),
      ],
    } as any);

    assert.equal(created.amount, '350.0000');
    assert.equal(created.lineCount, 2);
    // Mixed categories: line 1's key, and a label naming the row count.
    assert.equal(created.categoryKey, 'travel');
    assert.equal(created.categoryLabelSnapshot, 'หลายหมวด (2 รายการ)');
    // Earliest line date wins for the header.
    assert.equal(created.incurredDate, '2026-01-03T00:00:00.000Z');
    assert.equal(state.request.outstandingAmount, '350.0000');
  });

  it('keeps the single-category label when every line shares a category', async () => {
    const state = fakeRepo();
    const created = await useCases(state).create.execute(ctx(), {
      reason: 'เดินทาง',
      lines: [inputLine({ lineNo: 1, amount: '10' }), inputLine({ lineNo: 2, amount: '20' })],
    } as any);
    assert.equal(created.categoryLabelSnapshot, 'เดินทาง');
    assert.equal(created.amount, '30.0000');
  });

  it('normalizes line money to satang before storing the line and header', async () => {
    const state = fakeRepo();
    const created = await useCases(state).create.execute(ctx(), {
      reason: 'ปัดเศษตามเอกสาร',
      lines: [inputLine({ amount: '10.0050' })],
    } as any);
    assert.equal(created.amount, '10.0100');
    assert.equal(state.request.lines[0].amount, '10.0100');
  });

  it('rejects a value that rounds to zero or exceeds Decimal(18,4)', async () => {
    for (const [amount, code] of [
      ['0.0049', 'line_amount_must_be_positive'],
      ['99999999999999.9999', 'amount_exceeds_limit'],
    ]) {
      const state = fakeRepo();
      await assert.rejects(
        () => useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine({ amount })] } as any),
        new RegExp(code),
      );
    }
  });

  it('rejects a claim with no lines', async () => {
    const state = fakeRepo();
    await assert.rejects(
      () => useCases(state).create.execute(ctx(), { reason: 'r', lines: [] } as any),
      /lines_required/,
    );
  });

  it('rejects a claim whose lines exceed the 50-row cap', async () => {
    const state = fakeRepo();
    const lines = Array.from({ length: 51 }, (_v, i) => inputLine({ lineNo: i + 1 }));
    await assert.rejects(
      () => useCases(state).create.execute(ctx(), { reason: 'r', lines } as any),
      /too_many_lines/,
    );
  });

  it('rejects a claim without the create permission', async () => {
    const state = fakeRepo();
    await assert.rejects(
      () => useCases(state).create.execute(ctx({ permissions: [] }), { reason: 'r', lines: [inputLine()] } as any),
      /permission/i,
    );
  });
});

describe('UpdateReimbursementDraftUseCase (multi-line)', () => {
  it('replaces the lines wholesale and recomputes the rollup', async () => {
    const state = fakeRepo();
    const uc = useCases(state);
    await uc.create.execute(ctx(), { reason: 'r', lines: [inputLine({ amount: '100' }), inputLine({ lineNo: 2, amount: '100' })] } as any);
    const updated = await uc.update.execute(ctx(), 'rb-1', { lines: [inputLine({ amount: '75.25' })] } as any);

    assert.equal(updated.amount, '75.2500');
    assert.equal(state.request.lines.length, 1);
    assert.equal(state.request.outstandingAmount, '75.2500');
  });

  it('rejects an update that empties the lines', async () => {
    const state = fakeRepo();
    const uc = useCases(state);
    await uc.create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    await assert.rejects(() => uc.update.execute(ctx(), 'rb-1', { lines: [] } as any), /lines_required/);
  });

  it('leaves the lines untouched when the body omits them', async () => {
    const state = fakeRepo();
    const uc = useCases(state);
    await uc.create.execute(ctx(), { reason: 'r', lines: [inputLine({ amount: '42' })] } as any);
    const updated = await uc.update.execute(ctx(), 'rb-1', { title: 'ใบเบิกเดือนมกราคม' } as any);
    assert.equal(updated.amount, '42.0000');
    assert.equal(state.request.lines.length, 1);
  });
});

describe('CancelReimbursementUseCase', () => {
  it('passes the observed status and version to the atomic cancellation transition', async () => {
    const state = fakeRepo();
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    const cancel = new CancelReimbursementUseCase(state.repo, noopAudit, state.voidExpense);
    const result = await cancel.execute(ctx({ permissions: ['reimbursement.cancel_own'] }), 'rb-1', 'ไม่ใช้แล้ว');
    assert.equal(result.status, 'CANCELLED');
    assert.equal(state.request.rejectionReason, 'ไม่ใช้แล้ว');
    assert.equal(state.request.paymentStatus, 'NOT_PAYABLE');
    // Both phases are durable: intent first, cancellation only after the projections are gone.
    assert.deepEqual(state.calls.outbox.map((row: any) => row.eventType), [
      'reimbursement.cancellation_started', 'reimbursement.cancelled',
    ]);
  });

  it('voids every claim expense projection before the claim closes', async () => {
    const state = fakeRepo({ claimProjections: [
      { id: 'exp-1', sourceReimbursementLineId: 'rbl-1' },
      { id: 'exp-2', sourceReimbursementLineId: 'rbl-2' },
    ] });
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    const cancel = new CancelReimbursementUseCase(state.repo, noopAudit, state.voidExpense);
    const result = await cancel.execute(ctx({ permissions: ['reimbursement.cancel_own'] }), 'rb-1', 'ไม่ใช้แล้ว');
    assert.equal(result.status, 'CANCELLED');
    assert.deepEqual(state.calls.voided, ['exp-1', 'exp-2']);
  });

  it('allows an authorized finance reviewer to cancel a non-owned request', async () => {
    const state = fakeRepo();
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    const cancel = new CancelReimbursementUseCase(state.repo, noopAudit, state.voidExpense);
    const result = await cancel.execute(ctx({ userId: 'finance-1', permissions: ['reimbursement.finance_review'] }), 'rb-1', 'ยกเลิกหลังกลับรายการจ่าย');
    assert.equal(result.status, 'CANCELLED');
    assert.equal(state.request.rejectionReason, 'ยกเลิกหลังกลับรายการจ่าย');
  });

  it('refuses to close the claim when a projection survives the void', async () => {
    const state = fakeRepo({ claimProjections: [{ id: 'exp-1', sourceReimbursementLineId: 'rbl-1' }] });
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    // A void that silently no-ops must not let an expense outlive its cancelled claim.
    const brokenVoid = { executeForReimbursement: async () => undefined } as any;
    const cancel = new CancelReimbursementUseCase(state.repo, noopAudit, brokenVoid);
    await assert.rejects(
      () => cancel.execute(ctx({ permissions: ['reimbursement.cancel_own'] }), 'rb-1', 'ไม่ใช้แล้ว'),
      /reimbursement_cancellation_projection_live/,
    );
    assert.notEqual(state.request.status, 'CANCELLED');
    assert.ok(state.request.cancellationPendingAt, 'the intent stays pending so a retry can finish it');
  });
});

describe('ReopenRejectedReimbursementUseCase', () => {
  it('reopens a rejected claim as a draft and clears the request-level rejection fields', async () => {
    const state = fakeRepo();
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    Object.assign(state.request, { status: 'REJECTED', rejectedAt: new Date(), rejectionReason: 'ยอดไม่ตรงกับใบเสร็จ', requestNo: 'RB-202601-000001' });
    const reopen = new ReopenRejectedReimbursementUseCase(state.repo, noopAudit);
    const result = await reopen.execute(ctx(), 'rb-1');
    assert.equal(result.status, 'DRAFT');
    assert.equal(state.request.rejectionReason, null);
    assert.equal(state.request.rejectedAt, null);
    // The document number survives the reopen so resubmission reuses it.
    assert.equal(state.request.requestNo, 'RB-202601-000001');
  });

  it('refuses reopen for non-requesters without finance review and for non-rejected claims', async () => {
    const state = fakeRepo();
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    const reopen = new ReopenRejectedReimbursementUseCase(state.repo, noopAudit);
    await assert.rejects(() => reopen.execute(ctx(), 'rb-1'), /Cannot reopen from status DRAFT/);
    Object.assign(state.request, { status: 'REJECTED' });
    await assert.rejects(
      () => reopen.execute(ctx({ userId: 'someone-else', permissions: ['reimbursement.update_own_draft'] }), 'rb-1'),
      /Cannot reopen this reimbursement/,
    );
  });

  // Spec §6 step 2: "แก้ไข (เปิดกลับเป็นร่าง)" while the claim waits for approval.
  it('lets the requester withdraw a claim nobody has decided, under the same number, and audits it', async () => {
    const state = fakeRepo();
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    Object.assign(state.request, { status: 'PENDING_APPROVAL', requestNo: 'RB-202601-000001' });
    const reopen = new ReopenRejectedReimbursementUseCase(state.repo, { log: async (entry: any) => { state.calls.audits.push(entry); } } as any);

    const result = await reopen.execute(ctx(), 'rb-1');

    assert.equal(result.status, 'DRAFT');
    assert.equal(state.request.requestNo, 'RB-202601-000001');
    const audit = state.calls.audits.find((entry: any) => entry.action === 'reimbursement.request.withdraw');
    assert.deepEqual(audit?.metadataJson, { requestNo: 'RB-202601-000001', previousStatus: 'PENDING_APPROVAL' });
  });

  it('refuses a withdraw after a decision, and from anyone but the requester — finance included', async () => {
    const state = fakeRepo();
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    Object.assign(state.request, { status: 'PENDING_APPROVAL', currentApprovalStepId: 'step-1' });
    const reopen = new ReopenRejectedReimbursementUseCase(state.repo, noopAudit);
    const finance = ctx({ userId: 'fin-1', permissions: ['reimbursement.update_own_draft', 'reimbursement.finance_review'] });

    await assert.rejects(() => reopen.execute(finance, 'rb-1'), /Cannot reopen this reimbursement/);
    state.calls.approvalSteps.push({ id: 'step-1', status: 'APPROVED' });
    await assert.rejects(() => reopen.execute(ctx(), 'rb-1'), /reimbursement_changed/);
    assert.equal(state.request.status, 'PENDING_APPROVAL');
    // Finance's wider reach still reopens a refusal, as before.
    Object.assign(state.request, { status: 'REJECTED' });
    assert.equal((await reopen.execute(finance, 'rb-1')).status, 'DRAFT');
  });

  it('builds a fresh route when the withdrawn claim is sent again', async () => {
    const policy = {
      id: 'policy-1', updatedAt: new Date('2026-01-01T00:00:00.000Z'), currency: 'THB', approvalRequiredFromAmount: '1.00',
      approverMode: 'MANAGER_ROLE', defaultApproverRole: 'MANAGER', allowSelfApproval: false, duplicatePolicy: 'WARN',
      financeReviewRequired: false, status: 'ACTIVE', requireReceipt: false, allowMissingReceiptWithReason: false,
    } as any;
    const state = fakeRepo({ policy });
    const routeInputs: any[] = [];
    const routes = {
      resolveNamedSubmissionRoute: async () => null,
      // Self-approval off leaves the requester off their own route; on, they are on it.
      resolveSubmissionRoute: async (input: any) => {
        routeInputs.push(input);
        return {
          responsibilityRole: input.roleKey, effectiveTaskRole: input.roleKey,
          recipientUserIds: input.allowSelfApproval ? [input.requesterUserId] : ['owner-1'],
          ownerRecipientUserIds: ['owner-1'], ownerFallbackUsed: !input.allowSelfApproval,
        };
      },
    } as any;
    const submit = new SubmitReimbursementUseCase(state.repo, noopAudit, noopOutbox, evidenceService(), routes, noopProjections);
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()], missingReceiptReason: 'ใบเสร็จหาย' } as any);
    await submit.execute(ctx(), 'rb-1');

    await new ReopenRejectedReimbursementUseCase(state.repo, noopAudit).execute(ctx(), 'rb-1');
    policy.allowSelfApproval = true;
    await submit.execute(ctx(), 'rb-1');

    assert.equal(routeInputs.length, 2, 'the route is resolved again, not carried over');
    assert.equal(routeInputs[1].allowSelfApproval, true);
    assert.deepEqual(state.calls.approvalSteps.map((step) => [step.id, step.status ?? 'PENDING', step.assignedApproverUserIdsJson]), [
      ['step-1', 'CANCELLED', ['owner-1']],
      ['step-2', 'PENDING', ['staff-1']],
    ]);
    assert.equal(state.request.status, 'PENDING_APPROVAL');
    assert.equal(state.request.currentApprovalStepId, 'step-2');
    assert.equal(state.request.approvalPolicySnapshotJson.allowSelfApproval, true);
  });
});

describe('SubmitReimbursementUseCase (multi-line)', () => {
  // Policy rows always carry these columns; the fakes mirror that.
  const basePolicy = {
    id: 'policy-1', updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    currency: 'THB', approvalRequiredFromAmount: '1.00', approverMode: 'MANAGER_ROLE',
    defaultApproverRole: 'MANAGER', allowSelfApproval: false, duplicatePolicy: 'WARN',
    financeReviewRequired: true, status: 'ACTIVE',
  };
  const requireReceipt = { ...basePolicy, requireReceipt: true, allowMissingReceiptWithReason: true } as any;
  const noReceiptNeeded = { ...basePolicy, requireReceipt: false, allowMissingReceiptWithReason: false } as any;
  // Receipt-less rows may be submitted only with the claim-level reason: the expense projection
  // created at อนุมัติจ่าย confirms on an attachment or that reason, whatever the claim policy says.
  const withReason = { missingReceiptReason: 'ใบเสร็จหาย' };

  async function draftWith(state: any, lines: any[], extra: Record<string, unknown> = {}) {
    await useCases(state).create.execute(ctx(), { reason: 'r', lines, ...extra } as any);
  }

  it('freezes exact approver recipients on a human approval step', async () => {
    const state = fakeRepo({ policy: noReceiptNeeded });
    await draftWith(state, [inputLine({ amount: '1.00' })], withReason);
    await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.equal(state.request.status, 'PENDING_APPROVAL');
    assert.deepEqual(state.calls.approvalSteps[0]?.assignedApproverUserIdsJson, ['approver-1']);
    // An ordinary route adds no solo flag, so its snapshot keeps the shape it always had.
    assert.equal('soloSelfApprovalAtSubmission' in state.request.approvalPolicySnapshotJson.route, false);
  });

  it('freezes a solo route on the step, the policy snapshot and the submit audit (owner order 2026-09-21)', async () => {
    const state = fakeRepo({ policy: noReceiptNeeded });
    const soloRoutes = {
      resolveNamedSubmissionRoute: async () => null,
      resolveSubmissionRoute: async ({ roleKey, requesterUserId }: any) => ({
        responsibilityRole: roleKey, effectiveTaskRole: roleKey, recipientUserIds: [requesterUserId],
        ownerRecipientUserIds: [], ownerFallbackUsed: false, soloSelfApproval: true,
      }),
    } as any;
    const audit = { log: async (entry: any) => { state.calls.audits.push(entry); } } as any;
    await draftWith(state, [inputLine()], withReason);
    await new SubmitReimbursementUseCase(state.repo, audit, noopOutbox, evidenceService(), soloRoutes, noopProjections).execute(ctx(), 'rb-1');

    assert.equal(state.request.status, 'PENDING_APPROVAL');
    assert.deepEqual(state.calls.approvalSteps[0]?.assignedApproverUserIdsJson, ['staff-1']);
    // Frozen with the route, so every later reader parses the same reason.
    assert.equal(parseReimbursementPolicySnapshot(state.request.approvalPolicySnapshotJson)?.route?.soloSelfApprovalAtSubmission, true);
    const submitAudit = state.calls.audits.find((entry: any) => entry.action === 'reimbursement.request.submit');
    assert.equal(submitAudit.metadataJson.soloSelfApproval, true);
  });

  it('skips human approval below threshold and enters finance review when configured', async () => {
    const state = fakeRepo({ policy: { ...noReceiptNeeded, approvalRequiredFromAmount: '100.00' } });
    await draftWith(state, [inputLine({ amount: '99.99' })], withReason);
    await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.equal(state.request.status, 'FINANCE_REVIEW');
    assert.equal(state.request.financeReviewStatus, 'PENDING');
    assert.equal(state.calls.approvalSteps.length, 0);
    assert.ok(state.calls.outbox.some((event: any) => event.eventType === 'reimbursement.approval_not_required'));
    assert.ok(state.calls.outbox.some((event: any) => event.eventType === 'reimbursement.finance_review_requested'));
  });

  it('reaches ready-for-payment through POLICY projection below threshold when finance is off', async () => {
    const state = fakeRepo({ policy: {
      ...noReceiptNeeded, approvalRequiredFromAmount: '100.00', financeReviewRequired: false,
    } });
    await draftWith(state, [inputLine({ amount: '99.99' })], withReason);
    await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.equal(state.request.status, 'READY_FOR_PAYMENT');
    assert.equal(state.calls.approvalSteps.length, 0);
    assert.equal(state.calls.projections[0]?.[2]?.kind, 'POLICY');
    assert.ok(state.calls.outbox.some((event: any) => event.eventType === 'reimbursement.ready_for_payment'));
  });

  it('blocks INACTIVE policy before submit mutation', async () => {
    const state = fakeRepo({ policy: { ...noReceiptNeeded, status: 'INACTIVE' } });
    await draftWith(state, [inputLine()], withReason);

    await assert.rejects(() => useCases(state).submit.execute(ctx(), 'rb-1'), /reimbursement_policy_inactive/);
    assert.equal(state.request.status, 'DRAFT');
    assert.equal(state.calls.approvalSteps.length, 0);
    assert.equal(state.calls.outbox.length, 0);
  });

  it('freezes the outstanding amount to the line rollup', async () => {
    const state = fakeRepo({ policy: noReceiptNeeded });
    await draftWith(state, [inputLine({ amount: '120' }), inputLine({ lineNo: 2, amount: '80' })], withReason);
    const detail = await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.equal(detail.status, 'PENDING_APPROVAL');
    assert.equal(detail.amount, '200.0000');
    assert.equal(state.request.outstandingAmount, '200.0000');
    assert.equal(detail.lines.length, 2);
  });

  it('clears the prior finance correction decision when the corrected draft is resubmitted', async () => {
    const state = fakeRepo({ policy: noReceiptNeeded });
    await draftWith(state, [inputLine()], withReason);
    Object.assign(state.request, {
      financeReviewStatus: 'NEEDS_INFO',
      financeReviewedByUserId: 'finance-1',
      financeReviewedAt: new Date('2026-01-02T00:00:00.000Z'),
      financeReviewNote: 'แก้ยอด',
      approvedAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.equal(state.request.financeReviewStatus, 'NOT_REQUIRED');
    assert.equal(state.request.financeReviewedByUserId, null);
    assert.equal(state.request.financeReviewedAt, null);
    assert.equal(state.request.financeReviewNote, null);
    assert.equal(state.request.approvedAt, null);
  });

  it('emits document-number audits only after the atomic submit succeeds', async () => {
    const state = fakeRepo({ policy: noReceiptNeeded });
    const uc = useCases(state);
    await uc.create.execute(ctx(), { reason: 'r', lines: [inputLine()], ...withReason } as any);
    state.calls.audits.length = 0;
    await uc.submit.execute(ctx(), 'rb-1');
    assert.deepEqual(
      state.calls.audits
        .map((entry: any) => entry.action)
        .filter((action: string) => action.startsWith('document.number.')),
      ['document.number.reserve', 'document.number.commit'],
    );

    const failed = fakeRepo({ policy: noReceiptNeeded, submitError: new Error('transaction_failed') });
    const failedUc = useCases(failed);
    await failedUc.create.execute(ctx(), { reason: 'r', lines: [inputLine()], ...withReason } as any);
    failed.calls.audits.length = 0;
    await assert.rejects(() => failedUc.submit.execute(ctx(), 'rb-1'), /transaction_failed/);
    assert.equal(failed.calls.audits.some((entry: any) => entry.action.startsWith('document.number.')), false);

    const reused = fakeRepo({ policy: noReceiptNeeded, documentNumberReused: true });
    const reusedUc = useCases(reused);
    await reusedUc.create.execute(ctx(), { reason: 'r', lines: [inputLine()], ...withReason } as any);
    reused.calls.audits.length = 0;
    await reusedUc.submit.execute(ctx(), 'rb-1');
    assert.equal(reused.calls.audits.some((entry: any) => entry.action.startsWith('document.number.')), false);

    const healed = fakeRepo({
      policy: noReceiptNeeded,
      documentNumberReused: true,
      supersededDuplicateCandidateCount: 2,
      supersededApprovalStepCount: 1,
    });
    const healedUc = useCases(healed);
    await healedUc.create.execute(ctx(), { reason: 'r', lines: [inputLine()], ...withReason } as any);
    healed.calls.audits.length = 0;
    await healedUc.submit.execute(ctx(), 'rb-1');
    const submitAudit = healed.calls.audits.find((entry: any) => entry.action === 'reimbursement.request.submit');
    assert.deepEqual(submitAudit.metadataJson.legacyRecovery, {
      documentNumberReused: true,
      supersededDuplicateCandidateCount: 2,
      supersededApprovalStepCount: 1,
    });
  });

  it('blocks submit when one line of several has no receipt', async () => {
    const state = fakeRepo({ policy: requireReceipt });
    await draftWith(state, [inputLine({ attachmentId: 'att-1' }), inputLine({ lineNo: 2 })]);
    await assert.rejects(() => useCases(state).submit.execute(ctx(), 'rb-1'), /missing_receipt/);
  });

  // BUG-7: without the reason the claim's expense projection can never be confirmed, and the
  // finance approval that materializes it is already durable when that fails — the claim would
  // sit at FINANCE_REVIEW forever. A waive policy does not exempt it.
  it('blocks submit when a line carries no receipt and the claim carries no reason', async () => {
    const state = fakeRepo({ policy: noReceiptNeeded });
    await draftWith(state, [inputLine({ attachmentId: 'att-1' }), inputLine({ lineNo: 2 })]);
    await assert.rejects(
      () => useCases(state).submit.execute(ctx(), 'rb-1'),
      /missing_receipt_reason_required/,
    );
    assert.equal(state.request.status, 'DRAFT', 'the claim stays a draft the requester can fix');
  });

  it('submits the same receipt-less claim once the reason is filled in', async () => {
    const state = fakeRepo({ policy: noReceiptNeeded });
    await draftWith(state, [inputLine(), inputLine({ lineNo: 2 })], withReason);
    const detail = await useCases(state).submit.execute(ctx(), 'rb-1');
    assert.equal(detail.status, 'PENDING_APPROVAL');
    assert.equal(detail.receiptRequirementStatus, 'WAIVED_BY_POLICY');
    assert.equal(detail.missingReceiptReason, 'ใบเสร็จหาย');
  });

  it('accepts a claim-level reason covering several missing receipts', async () => {
    const state = fakeRepo({ policy: requireReceipt });
    await draftWith(state, [inputLine(), inputLine({ lineNo: 2 })], { missingReceiptReason: 'ใบเสร็จหาย' });
    const detail = await useCases(state).submit.execute(ctx(), 'rb-1');
    assert.equal(detail.receiptRequirementStatus, 'MISSING_WITH_REASON');
  });

  it('marks the claim ATTACHED when every line is evidenced by receipt or linked expense', async () => {
    const state = fakeRepo({ policy: requireReceipt });
    await draftWith(state, [inputLine({ attachmentId: 'att-1' }), inputLine({ lineNo: 2, linkedExpenseId: 'exp-1' })]);
    const detail = await useCases(state).submit.execute(ctx(), 'rb-1');
    assert.equal(detail.receiptRequirementStatus, 'ATTACHED');
  });

  it('rejects an expense already claimed by another live claim', async () => {
    const state = fakeRepo({ claimedElsewhere: [{ lineNo: 1, linkedExpenseId: 'exp-1', requestNo: 'RB-202601-000009' }] });
    await draftWith(state, [inputLine({ linkedExpenseId: 'exp-1' })]);
    await assert.rejects(() => useCases(state).submit.execute(ctx(), 'rb-1'), /expense_already_claimed/);
  });

  it('rejects an attachment already claimed by another live claim', async () => {
    const state = fakeRepo({ claimedElsewhere: [{ lineNo: 2, attachmentId: 'att-1', requestNo: 'RB-202601-000009' }] });
    await draftWith(state, [inputLine({ attachmentId: 'att-1' })]);
    await assert.rejects(() => useCases(state).submit.execute(ctx(), 'rb-1'), /attachment_already_claimed/);
  });

  it('asks only about this claim\'s evidence, excluding itself', async () => {
    const state = fakeRepo();
    await draftWith(state, [inputLine({ attachmentId: 'att-1' }), inputLine({ lineNo: 2, linkedExpenseId: 'exp-2' })]);
    await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.deepEqual(state.calls.claimQueries, [{
      companyId: 'co-1', excludeId: 'rb-1', attachmentIds: ['att-1'], expenseIds: ['exp-2'],
    }]);
  });

  it('records a duplicate candidate naming the line that shares a receipt', async () => {
    const state = fakeRepo({
      duplicateCandidates: [{
        id: 'rb-9', requestNo: 'RB-202601-000009', requesterUserId: 'staff-1', amount: '100.0000', currency: 'THB',
        incurredDate: new Date('2026-01-05T00:00:00.000Z'), categoryKey: 'travel', reason: 'r',
        lines: [{ lineNo: 1, attachmentId: 'att-1' }],
      }],
    });
    await draftWith(state, [inputLine({ attachmentId: 'att-2' }), inputLine({ lineNo: 2, attachmentId: 'att-1' })]);
    const detail = await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.equal(detail.duplicateStatus, 'POSSIBLE_DUPLICATE');
    assert.equal(state.calls.duplicates.length, 1);
    assert.equal(state.calls.duplicates[0].candidateType, 'ATTACHMENT_CHECKSUM');
    assert.equal(state.calls.duplicates[0].candidateAttachmentId, 'att-1');
    assert.match(state.calls.duplicates[0].reason, /line 2/);
  });
});

const approverPermissions = ['reimbursement.read', 'reimbursement.approve', 'reimbursement.reject'];
const approverBranches = [{ id: 'b1', name: 'สำนักงานใหญ่' }, { id: 'b2', name: 'สาขาสอง' }];
const approverHolder = (branchIds: string[]): ApproverRoleCandidate['holders'][number] => ({
  branchScopeMode: 'SELECTED_BRANCHES', defaultBranchId: null, branchIds,
});
const approverRole = (
  overrides: Partial<ApproverRoleCandidate> & Pick<ApproverRoleCandidate, 'key' | 'name'>,
): ApproverRoleCandidate => ({
  status: 'ACTIVE', permissionKeys: approverPermissions, holders: [], ...overrides,
});

describe('reimbursement approver role options', () => {
  it('returns only executable routes as selectable and uses OWNER for safe branch recovery', () => {
    const options = buildReimbursementApproverRoleOptions([
      approverRole({ key: 'OWNER', name: 'Owner', holders: [approverHolder(['b1', 'b2'])] }),
      approverRole({ key: 'MANAGER', name: 'Manager', holders: [approverHolder(['b1', 'b2'])] }),
      approverRole({ key: 'ACCOUNTANT', name: 'Accountant', holders: [approverHolder(['b1'])] }),
      approverRole({ key: 'FINANCE', name: 'Finance', holders: [] }),
      approverRole({ key: 'STAFF', name: 'Staff', permissionKeys: ['reimbursement.read'], holders: [approverHolder(['b1', 'b2'])] }),
      approverRole({ key: 'SYSTEM_ADMIN', name: 'System Admin', holders: [approverHolder(['b1', 'b2'])] }),
    ], approverBranches);

    assert.equal(options.find((item) => item.key === 'MANAGER')?.coverage, 'COMPLETE');
    assert.equal(options.find((item) => item.key === 'MANAGER')?.selectable, true);
    assert.deepEqual(options.find((item) => item.key === 'ACCOUNTANT')?.uncoveredBranchNames, ['สาขาสอง']);
    assert.equal(options.find((item) => item.key === 'ACCOUNTANT')?.coverage, 'PARTIAL');
    assert.equal(options.find((item) => item.key === 'ACCOUNTANT')?.selectable, true);
    assert.equal(options.find((item) => item.key === 'FINANCE')?.unavailableReason, 'NO_ACTIVE_HOLDERS');
    assert.equal(options.find((item) => item.key === 'STAFF')?.unavailableReason, 'MISSING_CAPABILITY');
    assert.equal(options.some((item) => item.key === 'SYSTEM_ADMIN'), false);
  });

  it('blocks partial coverage when OWNER cannot recover the uncovered branch', () => {
    const options = buildReimbursementApproverRoleOptions([
      approverRole({ key: 'OWNER', name: 'Owner', holders: [approverHolder(['b1'])] }),
      approverRole({ key: 'MANAGER', name: 'Manager', holders: [approverHolder(['b1'])] }),
    ], approverBranches);
    assert.equal(options.find((item) => item.key === 'MANAGER')?.selectable, false);
    assert.equal(options.find((item) => item.key === 'MANAGER')?.unavailableReason, 'OWNER_RECOVERY_NOT_READY');
  });

  it('does not use OWNER as recovery when the role lacks approval capability', () => {
    const options = buildReimbursementApproverRoleOptions([
      approverRole({ key: 'OWNER', name: 'Owner', permissionKeys: ['reimbursement.read'], holders: [approverHolder(['b1', 'b2'])] }),
      approverRole({ key: 'MANAGER', name: 'Manager', holders: [approverHolder(['b1'])] }),
    ], approverBranches);
    assert.equal(options.find((item) => item.key === 'MANAGER')?.selectable, false);
    assert.equal(options.find((item) => item.key === 'MANAGER')?.unavailableReason, 'OWNER_RECOVERY_NOT_READY');
  });

  it('maps the selected role to the server-owned routing mode', () => {
    assert.equal(approverModeForRole('MANAGER'), 'MANAGER_ROLE');
    assert.equal(approverModeForRole('OWNER'), 'OWNER_ROLE');
    assert.equal(approverModeForRole('ACCOUNTANT'), 'CUSTOM_ROLE');
  });
});

// Owner order 2026-09-21 ("ผู้ใช้คนเดียวที่กำหนดบทบาทเอง ต้องทำได้นะ"): a requester dropped from the
// route only as a self-approver gets the step back when nobody else could take it.
describe('submission route when the requester is the only approver', () => {
  const APPROVE = ['reimbursement.read', 'reimbursement.approve', 'reimbursement.reject'];
  type Holder = { userId: string; branchScopeMode?: string; branchIds?: string[] };
  /** Just enough Prisma for routing: approve-capable roles with their holders, no entitlement rows (all on). */
  function resolver(roles: Record<string, Holder[]>, named: unknown = null) {
    return new ListReimbursementApproverOptionsUseCase({ client: {
      role: { findMany: async () => Object.entries(roles).map(([key, holders]) => ({
        key, name: key, scopeKey: 'system', status: 'ACTIVE',
        permissions: APPROVE.map((permission) => ({ permission: { key: permission } })),
        memberships: holders.map((holder) => ({ membership: {
          userId: holder.userId, branchScopeMode: holder.branchScopeMode ?? 'ALL_BRANCHES', defaultBranchId: null,
          branchScopes: (holder.branchIds ?? []).map((branchId) => ({ branchId })), roles: [{ role: { key, status: 'ACTIVE' } }],
        } })),
      })) },
      branch: { findMany: async () => [] },
      companyFeatureEntitlement: { findMany: async () => [] },
      companyMembership: { findFirst: async () => named },
    } } as any);
  }
  const input = { companyId: 'co-1', roleKey: 'CUSTOM_SOLO', branchId: 'branch-1', requesterUserId: 'solo-1', allowSelfApproval: false };
  const otherBranch = { branchScopeMode: 'SELECTED_BRANCHES', branchIds: ['branch-2'] };

  it('gives the step back to a solo holder of the routed role instead of refusing the claim', async () => {
    assert.deepEqual(await resolver({ CUSTOM_SOLO: [{ userId: 'solo-1' }], OWNER: [] }).resolveSubmissionRoute(input), {
      responsibilityRole: 'CUSTOM_SOLO', effectiveTaskRole: 'CUSTOM_SOLO', recipientUserIds: ['solo-1'],
      ownerRecipientUserIds: [], ownerFallbackUsed: false, soloSelfApproval: true,
    });
    // "Anyone else eligible" covers this claim's branch: an owner elsewhere does not count.
    const ownerElsewhere = await resolver({ CUSTOM_SOLO: [{ userId: 'solo-1' }], OWNER: [{ userId: 'owner-1', ...otherBranch }] }).resolveSubmissionRoute(input);
    assert.deepEqual([ownerElsewhere.recipientUserIds, ownerElsewhere.soloSelfApproval], [['solo-1'], true]);
  });

  it('keeps the normal rule whenever someone else can approve', async () => {
    const peer = await resolver({ CUSTOM_SOLO: [{ userId: 'solo-1' }, { userId: 'peer-1' }], OWNER: [] }).resolveSubmissionRoute(input);
    assert.deepEqual([peer.recipientUserIds, peer.soloSelfApproval], [['peer-1'], undefined]);
    // The OWNER fallback is still preferred when the owner is someone else and covers the branch.
    const owner = await resolver({ CUSTOM_SOLO: [{ userId: 'solo-1' }], OWNER: [{ userId: 'owner-1' }] }).resolveSubmissionRoute(input);
    assert.deepEqual([owner.recipientUserIds, owner.effectiveTaskRole, owner.ownerFallbackUsed, owner.soloSelfApproval], [['owner-1'], 'OWNER', true, undefined]);
  });

  it('drops the requester but keeps every other holder of every policy role', async () => {
    const roles = { CEO: [{ userId: 'solo-1' }, { userId: 'ceo-1' }], OWNER: [{ userId: 'owner-1' }], MANAGER: [{ userId: 'mgr-1' }] };
    const both = await resolver(roles).resolveSubmissionRoute({ ...input, roleKey: 'CEO', roleKeys: ['CEO', 'OWNER'] });
    assert.deepEqual([both.responsibilityRole, both.effectiveTaskRole, both.recipientUserIds, both.ownerFallbackUsed], ['CEO', 'CEO', ['ceo-1', 'owner-1'], false]);
    // Nobody in any listed role: the owner fallback still applies.
    const empty = await resolver({ CEO: [], MANAGER: [], OWNER: [{ userId: 'owner-1' }] }).resolveSubmissionRoute({ ...input, roleKey: 'CEO', roleKeys: ['CEO', 'MANAGER'] });
    assert.deepEqual([empty.recipientUserIds, empty.effectiveTaskRole, empty.ownerFallbackUsed], [['owner-1'], 'OWNER', true]);
  });

  it('still refuses when the requester could not approve it either', async () => {
    // Not a holder of the routed role (the default MANAGER route, their own role elsewhere)…
    await assert.rejects(() => resolver({ MANAGER: [], OWNER: [] }).resolveSubmissionRoute({ ...input, roleKey: 'MANAGER' }), /reimbursement_approver_not_ready/);
    // …or a holder who does not cover the claim's branch.
    await assert.rejects(() => resolver({ CUSTOM_SOLO: [{ userId: 'solo-1', ...otherBranch }], OWNER: [] }).resolveSubmissionRoute(input), /reimbursement_approver_not_ready/);
  });

  it('is decided at submit only: a background re-read never routes a claim to its requester', async () => {
    const { companyId, ...routeInput } = input;
    assert.deepEqual(await resolver({ CUSTOM_SOLO: [{ userId: 'solo-1' }], OWNER: [] }).resolveSubmissionRoutesBestEffort(companyId, [routeInput]), [null]);
  });

  it('gives a named approver who filed the claim the step only when nobody else could take it', async () => {
    const named = { userId: 'solo-1', branchScopeMode: 'ALL_BRANCHES', defaultBranchId: null, branchScopes: [],
      roles: [{ role: { key: 'CUSTOM_SOLO', permissions: APPROVE.map((key) => ({ permission: { key } })) } }] };
    const namedInput = { companyId: 'co-1', userId: 'solo-1', branchId: 'branch-1', requesterUserId: 'solo-1', allowSelfApproval: false, fallbackRole: 'MANAGER' };
    assert.deepEqual(await resolver({ MANAGER: [], OWNER: [] }, named).resolveNamedSubmissionRoute(namedInput), {
      responsibilityRole: 'MANAGER', effectiveTaskRole: 'MANAGER', recipientUserIds: ['solo-1'],
      ownerRecipientUserIds: [], ownerFallbackUsed: false, soloSelfApproval: true,
    });
    // An owner can take it: the named route steps aside and the caller's role route picks the owner.
    assert.equal(await resolver({ MANAGER: [], OWNER: [{ userId: 'owner-1' }] }, named).resolveNamedSubmissionRoute(namedInput), null);
  });
});

describe('reimbursement policy role save', () => {
  const policyCtx = {
    companyId: 'co-1', userId: 'user-1', requestId: 'req-1',
    permissions: ['reimbursement.policy.manage'],
  } as any;
  const option = {
    key: 'ACCOUNTANT', name: 'Accountant', optionLabel: 'Accountant',
    eligibleApproverCount: 1, coverage: 'COMPLETE' as const, uncoveredBranchNames: [], selectable: true,
  };
  const policy = (data: Record<string, unknown>) => ({
    id: 'policy-1', companyId: 'co-1', currency: 'THB', approvalThresholdAmount: '1.00',
    approvalRequiredFromAmount: '1.00', approverMode: 'CUSTOM_ROLE', defaultApproverRole: 'ACCOUNTANT',
    allowSelfApproval: false, requireReceipt: true, allowMissingReceiptWithReason: false,
    duplicatePolicy: 'WARN', financeReviewRequired: true, status: 'ACTIVE', createdByUserId: 'user-1',
    createdAt: new Date('2026-08-21T00:00:00.000Z'), updatedAt: new Date('2026-08-21T00:00:00.000Z'),
    ...data,
  });

  it('lets policy managers read the form they are allowed to save', async () => {
    const useCase = new GetReimbursementPolicyUseCase({ findPolicy: async () => policy({}) } as any);
    const result = await useCase.execute(policyCtx);
    assert.equal(result.id, 'policy-1');
  });

  it('revalidates and canonicalizes an explicit role edit before writing', async () => {
    let written: Record<string, unknown> | undefined;
    const repo = {
      findPolicy: async () => null,
      upsertPolicy: async (_companyId: string, _branchId: null, data: Record<string, unknown>) => {
        written = data;
        return policy(data);
      },
    };
    const useCase = new UpdateReimbursementPolicyUseCase(
      repo as any, { log: async () => undefined } as any,
      { load: async () => [option, { ...option, key: 'OWNER', name: 'Owner', optionLabel: 'Owner' }] } as any,
    );

    await useCase.execute(policyCtx, { defaultApproverRoles: [' ACCOUNTANT ', 'OWNER', 'ACCOUNTANT'] });
    assert.deepEqual(written, {
      defaultApproverRoles: ['ACCOUNTANT', 'OWNER'], defaultApproverRole: 'ACCOUNTANT',
      approverMode: 'CUSTOM_ROLE', defaultApproverUserId: null,
    });
  });

  it('rejects a stale or ineligible role without writing the policy', async () => {
    let wrote = false;
    const useCase = new UpdateReimbursementPolicyUseCase(
      { findPolicy: async () => null, upsertPolicy: async () => { wrote = true; return policy({}); } } as any,
      { log: async () => undefined } as any,
      { load: async () => [{ ...option, selectable: false }, { ...option, key: 'OWNER' }] } as any,
    );

    // One unready role is enough to refuse the whole list.
    await assert.rejects(useCase.execute(policyCtx, { defaultApproverRoles: ['OWNER', 'ACCOUNTANT'] }), /approver_role_not_eligible/);
    assert.equal(wrote, false);
  });

  it('persists audit and policy-updated outbox facts in the policy transaction', async () => {
    const outboxRows: any[] = [];
    const audits: any[] = [];
    const saved = policy({});
    const repo = {
      findPolicy: async () => null,
      upsertPolicy: async (
        _companyId: string, _branchId: null, _data: Record<string, unknown>, _userId: string,
        _expectedUpdatedAt: Date | undefined, onPersisted: (tx: any, before: null, after: any) => Promise<void>,
      ) => {
        await onPersisted({ outboxEvent: { createMany: async ({ data }: any) => { outboxRows.push(...data); } } }, null, saved);
        return saved;
      },
    };
    const useCase = new UpdateReimbursementPolicyUseCase(
      repo as any,
      { log: async (entry: any, tx: any) => { assert.ok(tx); audits.push(entry); } } as any,
      { load: async () => [option] } as any,
    );

    await useCase.execute(policyCtx, { defaultApproverRoles: ['ACCOUNTANT'] });
    assert.equal(audits[0]?.action, 'reimbursement.policy.update');
    assert.equal(outboxRows[0]?.eventType, 'reimbursement.policy_updated');
    assert.equal(outboxRows[0]?.aggregateId, 'policy-1');
  });
});

// ---- Payout account (payout spec §8–§11, owner decisions 2026-10-01) ----
//
// The repository fake keeps the two payout tables in memory, and every read and write on them is the
// production function, so these cases exercise the real freeze, masking and reveal code.

const KBANK = { payoutMethod: 'BANK_TRANSFER' as const, payoutKind: 'BANK_ACCOUNT' as const, bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountNumber: '012-3-45678-9' };
const SCB = { payoutMethod: 'BANK_TRANSFER' as const, payoutKind: 'BANK_ACCOUNT' as const, bankName: 'ธนาคารไทยพาณิชย์', accountName: 'นาย สมชาย ใจดี', accountNumber: '000123456789012' };
const PROMPTPAY = { payoutMethod: 'BANK_TRANSFER' as const, payoutKind: 'PROMPTPAY_PHONE' as const, accountName: 'นาย สมชาย ใจดี', accountNumber: '081-234-5678' };
const PAYOUT_NAMES: Record<string, string> = { 'staff-1': 'สมชาย', 'manager-1': 'วิภา', 'finance-1': 'อรทัย', 'owner-1': 'เจ้าของร้าน' };
/** Every full number a case types in, as stored and as typed. None may ever appear in a payload, an audit row or a notification. */
const FULL_NUMBERS = ['0123456789', '012-3-45678-9', '000123456789012', '0812345678', '081-234-5678'];
const leaksNumber = (value: unknown) => FULL_NUMBERS.some((number) => JSON.stringify(value ?? null).includes(number));

function payoutWorld(options: RepoOptions = {}) {
  const state = fakeRepo({ noDefaultPayout: true, ...options });
  Object.assign(state.repo, {
    getUserDisplayNames: async (_companyId: string, ids: string[]) => Object.fromEntries(ids.filter((id) => PAYOUT_NAMES[id]).map((id) => [id, PAYOUT_NAMES[id]])),
    listInternalNotes: async () => [],
    findActiveApproverUserIds: async (_companyId: string, ids: string[]) => new Set(ids),
    isUserRelatedToRequest: async () => false,
  });
  const audits: any[] = [];
  const notifications: any[] = [];
  const audit = { log: async (entry: any) => { audits.push(entry); }, logOrThrow: async (entry: any) => { audits.push(entry); } } as any;
  const payouts = payoutUseCase(state.repo, audit, notifications);
  const evidence = evidenceService();
  const submit = new SubmitReimbursementUseCase(state.repo, audit, noopOutbox, evidence, readyApproverRoutes, noopProjections);
  const detail = new GetReimbursementDetailUseCase(state.repo, evidence);
  return {
    state, audits, notifications, payouts,
    create: new CreateReimbursementDraftUseCase(state.repo, audit, evidence, payouts),
    update: new UpdateReimbursementDraftUseCase(state.repo, audit, evidence, payouts),
    submit,
    detail,
    /** What the claim page does: read the claim, then send it with the token of the account that page showed. */
    send: async (context: any, id: string) => submit.execute(context, id, { payoutSubmitToken: (await detail.execute(context, id)).payout?.submitToken }),
    reopen: new ReopenRejectedReimbursementUseCase(state.repo, audit),
    reveal: new RevealClaimPayoutUseCase(state.repo, audit, { credentialEncryptionKey: PAYOUT_KEY } as any),
  };
}

const claimInput = (extra: Record<string, unknown> = {}) => ({ reason: 'ค่าเดินทาง', branchId: 'branch-1', lines: [inputLine({ attachmentId: 'att-1' })], ...extra }) as any;
const financeCtx = () => ctx({
  userId: 'finance-1', roles: ['FINANCE'],
  permissions: ['reimbursement.create', 'reimbursement.finance_review', 'reimbursement.submit', 'reimbursement.read', 'reimbursement.update_own_draft'],
});
const managerCtx = (overrides: Partial<any> = {}) => ctx({
  userId: 'manager-1', roles: ['MANAGER'], permissions: ['access.employee.read', 'access.employee.update', 'reimbursement.create'], ...overrides,
});
const EMPLOYEE = { displayName: 'สมชาย', hasEmployeeProfile: true, allBranches: false, branchIds: ['branch-1'], managesPeople: false };

describe('payout: a member sets their own default account', () => {
  it('works for every self-service role and for an owner who has no employee record', async () => {
    for (const [role, permissions] of Object.entries(ROLE_GRANTS).filter(([key]) => !PLATFORM_ROLE_KEYS.includes(key))) {
      // No employee record anywhere in this world: the account hangs off the membership alone.
      const world = payoutWorld();
      const me = ctx({ userId: `${role}-user`, roles: [role], permissions });
      const set = await world.payouts.setOwn(me, KBANK);
      assert.deepEqual(set.account && { bank: set.account.bankName, last4: set.account.accountLast4, name: set.account.accountName },
        { bank: 'ธนาคารกสิกรไทย', last4: '6789', name: 'นาย สมชาย ใจดี' }, role);
      assert.equal((await world.payouts.revealOwn(me)).accountNumber, '0123456789', role);
      assert.equal((await world.payouts.setOwn(me, { payoutMethod: 'CASH' })).account?.payoutMethod, 'CASH', role);
      assert.deepEqual(await world.payouts.deleteOwn(me), { account: null });
      assert.deepEqual(await world.payouts.getOwn(me), { account: null, canEdit: true });
    }
  });

  it('keeps every digit: leading zeros, 6 to 20 digits, and a PromptPay mobile number', async () => {
    const world = payoutWorld();
    for (const [input, full, last4] of [[KBANK, '0123456789', '6789'], [SCB, '000123456789012', '9012'], [PROMPTPAY, '0812345678', '5678']] as const) {
      assert.equal((await world.payouts.setOwn(ctx(), input)).account?.accountLast4, last4);
      assert.equal((await world.payouts.revealOwn(ctx())).accountNumber, full);
    }
    await assert.rejects(world.payouts.setOwn(ctx(), { ...KBANK, accountNumber: '12345' }), /payout_destination_invalid/);
    await assert.rejects(world.payouts.setOwn(ctx(), { ...KBANK, accountNumber: '123456789012345678901' }), /payout_destination_invalid/);
    await assert.rejects(world.payouts.setOwn(ctx(), { ...PROMPTPAY, accountNumber: '1234567890123' }), /payout_destination_invalid/);
    await assert.rejects(world.payouts.setOwn(ctx(), { payoutMethod: 'BANK_TRANSFER' } as any), /payout_destination_required/);
    await assert.rejects(world.payouts.setOwn(ctx(), { payoutMethod: 'CHEQUE' } as any), /payout_method_required/);
    // Cash needs no account at all.
    assert.deepEqual(Object.keys((await world.payouts.setOwn(ctx(), { payoutMethod: 'CASH' })).account!).sort(), ['payoutMethod', 'updatedAt', 'userId']);
  });

  it('is one account per company, and no payload or audit row ever carries the number', async () => {
    const world = payoutWorld();
    const here = ctx();
    const elsewhere = ctx({ companyId: 'co-2' });
    const answers = [await world.payouts.setOwn(here, KBANK), await world.payouts.setOwn(elsewhere, SCB), await world.payouts.getOwn(here)];
    assert.equal((await world.payouts.getOwn(here)).account?.accountLast4, '6789');
    assert.equal((await world.payouts.getOwn(elsewhere)).account?.accountLast4, '9012');
    assert.equal((await world.payouts.revealOwn(elsewhere)).accountNumber, '000123456789012');
    assert.equal(leaksNumber(answers), false);
    assert.equal(leaksNumber(world.audits), false);
    assert.ok(answers.every((answer) => !('accountNumber' in (answer.account ?? {})) && !('accountNumberEncrypted' in (answer.account ?? {}))));
    // Every change and every reveal is on record, with the last 4 before and after.
    assert.deepEqual(world.audits.map((row) => row.action), [
      'reimbursement.payout_account.set', 'reimbursement.payout_account.set', 'reimbursement.payout_account.reveal',
    ]);
    assert.deepEqual(world.audits[0].metadataJson, {
      accountUserId: 'staff-1', byOwner: true, before: null,
      after: { payoutMethod: 'BANK_TRANSFER', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountLast4: '6789', version: 1 },
    });
  });

  it('refuses a member who may not file claims, and a reveal with nothing set', async () => {
    const world = payoutWorld();
    const noClaims = ctx({ permissions: ['reimbursement.read_own'] });
    for (const call of [() => world.payouts.getOwn(noClaims), () => world.payouts.setOwn(noClaims, KBANK), () => world.payouts.deleteOwn(noClaims), () => world.payouts.revealOwn(noClaims)]) {
      await assert.rejects(call, /Missing permission: reimbursement.create/);
    }
    await assert.rejects(world.payouts.revealOwn(ctx()), /payout_account_not_set/);
    assert.equal(world.state.payoutTables.accounts.length, 0);
  });
});

describe('payout: someone else sets a member account (owner decision 2026-10-01)', () => {
  it('lets an employee-data editor set a subordinate account, records it and tells the account owner', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    const answer = await world.payouts.setForMember(managerCtx(), 'staff-1', KBANK);
    // The editor typed the full number once; what comes back is the last 4, like for everyone else.
    assert.equal(answer.account?.accountLast4, '6789');
    assert.equal(answer.account?.setByOtherName, 'วิภา');
    assert.equal(leaksNumber(answer), false);

    assert.equal(world.audits.length, 1);
    assert.deepEqual([world.audits[0].action, world.audits[0].riskLevel, world.audits[0].actorUserId, world.audits[0].metadataJson.byOwner], [
      'reimbursement.payout_account.set', 'HIGH', 'manager-1', false,
    ]);
    assert.equal(leaksNumber(world.audits), false);

    // The owner's condition: the account owner is told who, when and which account, last 4 only.
    assert.equal(world.notifications.length, 1);
    const notice = world.notifications[0];
    assert.deepEqual(notice.recipientUserIds, ['staff-1']);
    assert.equal(notice.title, 'วิภา ตั้งบัญชีรับเงินคืนของคุณ');
    assert.match(notice.body, /^ธนาคารกสิกรไทย เลขบัญชีลงท้าย 6789 ตั้งเมื่อ .+ ถ้าไม่ใช่บัญชีของคุณ เปิดดูแล้วแก้ได้ทันที$/);
    assert.equal(notice.deepLinkHref, '/companies/co-1/reimbursements/payout-account');
    assert.equal(notice.triggerKey, 'reimbursement.payout_account_set_by_other');
    // Where a person's money goes: not held back by quiet hours, and a failed push is recorded.
    assert.equal(notice.severity, 'critical');
    assert.equal(leaksNumber(notice), false);

    // The account owner sees who set it until they save it themselves; the editor still cannot read the number.
    assert.equal((await world.payouts.getOwn(ctx())).account?.setByOtherName, 'วิภา');
    assert.equal((await world.payouts.getForMember(managerCtx(), 'staff-1')).account?.accountLast4, '6789');
    assert.equal(typeof (world.payouts as any).revealForMember, 'undefined', 'there is no way to reveal someone else default account');
    await assert.rejects(world.payouts.revealOwn(managerCtx()), /payout_account_not_set/, "the editor's own reveal reads the editor's own account");
    assert.equal((await world.payouts.revealOwn(ctx())).accountNumber, '0123456789');
  });

  it('notifies again on every later change by someone else, including a switch to cash', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    await world.payouts.setForMember(managerCtx(), 'staff-1', KBANK);
    await world.payouts.setForMember(managerCtx(), 'staff-1', PROMPTPAY);
    await world.payouts.setForMember(managerCtx(), 'staff-1', { payoutMethod: 'CASH' });
    assert.equal(world.notifications.length, 3);
    // One notification per change: the dedup period is the change itself (its version and its moment).
    assert.deepEqual(world.notifications.map((notice) => notice.periodKey.split(':')[0]), ['v1', 'v2', 'v3']);
    assert.equal(new Set(world.notifications.map((notice) => notice.periodKey)).size, 3);
    assert.match(world.notifications[1].body, /^พร้อมเพย์เบอร์ลงท้าย 5678 ตั้งเมื่อ /);
    assert.match(world.notifications[2].body, /^ตั้งให้คุณรับเงินคืนเป็นเงินสด เมื่อ .+ ถ้าไม่ถูกต้อง เปิดดูแล้วแก้ได้ทันที$/);
    assert.equal(leaksNumber(world.notifications), false);
  });

  // The version starts again at 1 after the member deletes the account. A period made of the version
  // alone would fold the second notice into the first, and the member would not be told.
  it('tells the member again when someone sets the account after the member deleted it', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    await world.payouts.setForMember(managerCtx(), 'staff-1', KBANK);
    await world.payouts.deleteOwn(ctx());
    await world.payouts.setForMember(managerCtx(), 'staff-1', SCB);
    assert.deepEqual(world.notifications.map((notice) => notice.periodKey.split(':')[0]), ['v1', 'v1']);
    assert.notEqual(world.notifications[0].periodKey, world.notifications[1].periodKey);
    assert.match(world.notifications[1].body, /^ธนาคารไทยพาณิชย์ เลขบัญชีลงท้าย 9012 ตั้งเมื่อ /);
  });

  it('sends nothing when the account owner edits their own account', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE, 'manager-1': { ...EMPLOYEE, displayName: 'วิภา' } } });
    await world.payouts.setOwn(ctx(), KBANK);
    await world.payouts.setOwn(ctx(), SCB);
    // An editor saving their OWN account through the employee page is a self-edit too.
    await world.payouts.setForMember(managerCtx(), 'manager-1', KBANK);
    assert.equal(world.notifications.length, 0);
    assert.ok(world.audits.every((row) => row.metadataJson.byOwner === true && row.riskLevel === 'MEDIUM'));
    // Saving it themselves also clears "set by someone else".
    await world.payouts.setForMember(managerCtx(), 'staff-1', PROMPTPAY);
    assert.equal((await world.payouts.getOwn(ctx())).account?.setByOtherName, 'วิภา');
    await world.payouts.setOwn(ctx(), KBANK);
    assert.equal((await world.payouts.getOwn(ctx())).account?.setByOtherName, undefined);
  });

  // Security review M1: the notice is the owner's condition for letting anyone else set an account,
  // and the notification writer makes recipients of ACTIVE members only. A draft, invited, suspended
  // or disabled member would never be told, so nobody sets their account for them: not a manager,
  // not an admin, not the owner.
  it('refuses a member who is not active, whoever asks, and tells an active member', async () => {
    const editRights = ['access.employee.read', 'access.employee.update', 'reimbursement.create'];
    const editors = [managerCtx(), ctx({ userId: 'admin-1', roles: ['ADMIN'], permissions: editRights }), ctx({ userId: 'owner-1', roles: ['OWNER'], permissions: editRights })];
    for (const membershipStatus of ['DRAFT', 'INVITED', 'SUSPENDED', 'DISABLED']) {
      for (const editor of editors) {
        const label = `${editor.roles[0]} → ${membershipStatus}`;
        const world = payoutWorld({ payoutMembers: { 'staff-1': { ...EMPLOYEE, membershipStatus } } });
        assert.equal((await world.payouts.getForMember(editor, 'staff-1')).canEdit, false, `${label}: no button`);
        await assert.rejects(world.payouts.setForMember(editor, 'staff-1', KBANK), (error: any) => {
          assert.equal(error.getStatus(), 409, label);
          assert.match(error.message, /^payout_account_member_not_active$/, label);
          return true;
        }, label);
        // The same through "save as the requester's default" on a claim filed for them.
        const preparer = ctx({ ...editor, permissions: [...editRights, 'reimbursement.finance_review', 'reimbursement.update_own_draft'] });
        await assert.rejects(world.create.execute(preparer, claimInput({ requesterUserId: 'staff-1', payout: { mode: 'SPECIFIED', ...KBANK, saveAsDefault: true } })), /^ConflictException: payout_account_member_not_active$/, label);
        // Each attempt is on record with its reason; nothing was written and no notice went into the void.
        assert.deepEqual(world.audits.map((row) => [row.action, row.result, row.metadataJson.reason]),
          Array(2).fill(['reimbursement.payout_account.set', 'DENIED', 'target_not_active']), label);
        assert.deepEqual([world.state.payoutTables.accounts.length, world.notifications.length], [0, 0], label);
      }
    }
    // The same member once active: the account is set, and they are the one and only person told.
    for (const editor of editors) {
      const world = payoutWorld({ payoutMembers: { 'staff-1': { ...EMPLOYEE, membershipStatus: 'ACTIVE' } } });
      assert.equal((await world.payouts.getForMember(editor, 'staff-1')).canEdit, true);
      assert.equal((await world.payouts.setForMember(editor, 'staff-1', KBANK)).account?.accountLast4, '6789');
      assert.deepEqual(world.notifications.map((notice) => notice.recipientUserIds), [['staff-1']]);
    }
  });

  it('refuses another company, an owner with no employee record, another branch, and a company without reimbursements', async () => {
    const world = payoutWorld({ payoutMembers: {
      'staff-1': EMPLOYEE,
      'owner-1': { displayName: 'เจ้าของร้าน', hasEmployeeProfile: false, allBranches: true, branchIds: [], managesPeople: true },
      'staff-b2': { ...EMPLOYEE, branchIds: ['branch-2'] },
      'staff-both': { ...EMPLOYEE, branchIds: ['branch-1', 'branch-2'] },
      'admin-1': { ...EMPLOYEE, allBranches: true, branchIds: [] },
    } });
    const branchManager = managerCtx({ scopes: { branchIds: ['branch-1'] } });

    // A user id from another company is simply not a member here.
    await assert.rejects(world.payouts.setForMember(managerCtx(), 'user-of-another-company', KBANK), /payout_member_not_found/);
    await assert.rejects(world.payouts.getForMember(managerCtx(), 'user-of-another-company'), /payout_member_not_found/);
    // A business owner has no employee record: only they set their own.
    await assert.rejects(world.payouts.setForMember(managerCtx(), 'owner-1', KBANK), /payout_member_not_found/);
    // A branch-limited editor: only members wholly inside the editor's branches.
    assert.equal((await world.payouts.setForMember(branchManager, 'staff-1', KBANK)).account?.accountLast4, '6789');
    for (const outside of ['staff-b2', 'staff-both', 'admin-1']) {
      await assert.rejects(world.payouts.setForMember(branchManager, outside, KBANK), /payout_account_edit_denied/, outside);
    }
    assert.equal(world.audits.filter((row) => row.result === 'DENIED' && row.metadataJson.reason === 'outside_editor_branch_scope').length, 3);
    // An editor with every branch is not limited.
    assert.equal((await world.payouts.setForMember(managerCtx(), 'staff-b2', SCB)).account?.accountLast4, '9012');
    // No right to edit employee data, or the company does not use reimbursements.
    await assert.rejects(world.payouts.setForMember(managerCtx({ permissions: ['access.employee.read'] }), 'staff-1', KBANK), /payout_account_edit_denied/);
    await assert.rejects(world.payouts.setForMember(managerCtx({ entitlementDeniedPermissions: { 'reimbursement.create': 'reimbursements' } }), 'staff-1', KBANK), /payout_account_edit_denied/);
    await assert.rejects(world.payouts.getForMember(ctx(), 'staff-1'), /Missing permission: access.employee.read/);
    // Nothing refused left a row or a notification behind.
    assert.deepEqual(world.state.payoutTables.accounts.map((row) => row.userId).sort(), ['staff-1', 'staff-b2']);
    assert.equal(world.notifications.length, 2);
  });
});

// Owner direction 2026-10-01 (security): the employee-edit right reaches the whole company, so on its
// own it would let a manager point a peer's, an admin's or another branch's reimbursements at any
// account. Whose account an editor may set is its own rule.
describe('payout: whose account an editor may set (payment-redirection guard)', () => {
  const members = {
    'staff-1': EMPLOYEE,
    'staff-b2': { ...EMPLOYEE, displayName: 'พนักงานสาขาสอง', branchIds: ['branch-2'] },
    'finance-1': { ...EMPLOYEE, displayName: 'อรทัย', allBranches: true, branchIds: [] },
    'manager-2': { ...EMPLOYEE, displayName: 'ผู้จัดการอีกคน', managesPeople: true },
    'hr-1': { ...EMPLOYEE, displayName: 'ฝ่ายบุคคล', managesPeople: true, allBranches: true, branchIds: [] },
    'admin-1': { ...EMPLOYEE, displayName: 'ผู้ดูแลบริษัท', managesPeople: true, allBranches: true, branchIds: [] },
    'owner-1': { displayName: 'เจ้าของร้าน', hasEmployeeProfile: false, managesPeople: true, allBranches: true, branchIds: [] },
  };
  const editRights = ['access.employee.read', 'access.employee.update', 'reimbursement.create'];
  const editors = {
    owner: ctx({ userId: 'owner-1', roles: ['OWNER'], permissions: editRights }),
    admin: ctx({ userId: 'admin-1', roles: ['ADMIN'], permissions: editRights }),
    manager: ctx({ userId: 'manager-1', roles: ['MANAGER'], permissions: editRights }),
    branchManager: ctx({ userId: 'manager-1', roles: ['MANAGER'], permissions: editRights, scopes: { branchIds: ['branch-1'] } }),
    hr: ctx({ userId: 'hr-1', roles: ['HR'], permissions: editRights }),
    customRole: ctx({ userId: 'custom-1', roles: ['SHIFT_LEAD'], permissions: editRights, scopes: { branchIds: ['branch-1'] } }),
  };

  it('lets an owner or an admin set any employee account, and tells the account owner each time', async () => {
    for (const editor of [editors.owner, editors.admin]) {
      const world = payoutWorld({ payoutMembers: members });
      for (const target of ['staff-1', 'staff-b2', 'finance-1', 'manager-2', 'hr-1'].filter((id) => id !== editor.userId)) {
        assert.equal((await world.payouts.getForMember(editor, target)).canEdit, true, `${editor.roles[0]} → ${target}`);
        assert.equal((await world.payouts.setForMember(editor, target, KBANK)).account?.accountLast4, '6789', `${editor.roles[0]} → ${target}`);
      }
      // Nobody but the member sets the member's own account without the notice: one per change, to that member.
      assert.deepEqual(world.notifications.map((notice) => notice.recipientUserIds[0]), ['staff-1', 'staff-b2', 'finance-1', 'manager-2', 'hr-1']);
      assert.equal(world.audits.filter((row) => row.result === 'DENIED').length, 0);
    }
    // The business owner has no employee record: not even an admin sets the owner's account.
    const world = payoutWorld({ payoutMembers: members });
    await assert.rejects(world.payouts.setForMember(editors.admin, 'owner-1', KBANK), /payout_member_not_found/);
  });

  it('holds everyone else to their own people: no peer, no superior, no other branch', async () => {
    const refusals: Array<[keyof typeof editors, string, string]> = [
      // A manager and a peer manager, the admin, and HR (who edit employee data themselves).
      ['manager', 'manager-2', 'target_manages_people'], ['manager', 'admin-1', 'target_manages_people'], ['manager', 'hr-1', 'target_manages_people'],
      // HR and a custom role with the employee-edit right are held to the same rule.
      ['hr', 'manager-2', 'target_manages_people'], ['hr', 'admin-1', 'target_manages_people'], ['customRole', 'manager-2', 'target_manages_people'],
      // A branch-limited editor: another branch, and a member who works across every branch.
      ['branchManager', 'staff-b2', 'outside_editor_branch_scope'], ['branchManager', 'finance-1', 'outside_editor_branch_scope'],
      ['customRole', 'staff-b2', 'outside_editor_branch_scope'],
      // The peer rule comes first: a peer in the editor's own branch is still a peer.
      ['branchManager', 'manager-2', 'target_manages_people'],
    ];
    for (const [editor, target, reason] of refusals) {
      const world = payoutWorld({ payoutMembers: members });
      assert.equal((await world.payouts.getForMember(editors[editor], target)).canEdit, false, `${editor} → ${target}: no button`);
      await assert.rejects(world.payouts.setForMember(editors[editor], target, KBANK), (error: any) => {
        assert.equal(error.getStatus(), 403);
        assert.match(error.message, /payout_account_edit_denied/);
        return true;
      }, `${editor} → ${target}`);
      // The attempt is on record with its reason; nothing was written and nobody was notified.
      assert.deepEqual(world.audits.map((row) => [row.action, row.result, row.riskLevel, row.actorUserId, row.targetId, row.metadataJson.reason]),
        [['reimbursement.payout_account.set', 'DENIED', 'HIGH', editors[editor].userId, target, reason]], `${editor} → ${target}`);
      assert.deepEqual([world.state.payoutTables.accounts.length, world.notifications.length], [0, 0]);
      // The same refusal through "save as the requester's default" on a claim filed on their behalf.
      const preparer = ctx({ ...editors[editor], permissions: [...editRights, 'reimbursement.finance_review', 'reimbursement.update_own_draft'] });
      await assert.rejects(world.create.execute(preparer, claimInput({ requesterUserId: target, lines: [inputLine()], payout: { mode: 'SPECIFIED', ...KBANK, saveAsDefault: true } })), /payout_account_edit_denied/);
      assert.equal(world.state.payoutTables.accounts.length, 0);
    }
  });

  it('lets a manager, HR and a custom role set the account of their own people', async () => {
    for (const [editor, targets] of [['manager', ['staff-1', 'staff-b2', 'finance-1']], ['branchManager', ['staff-1']], ['hr', ['staff-1', 'staff-b2', 'finance-1']], ['customRole', ['staff-1']]] as const) {
      const world = payoutWorld({ payoutMembers: members });
      for (const target of targets) {
        assert.equal((await world.payouts.getForMember(editors[editor], target)).canEdit, true, `${editor} → ${target}`);
        assert.equal((await world.payouts.setForMember(editors[editor], target, KBANK)).canEdit, true, `${editor} → ${target}`);
      }
      assert.equal(world.notifications.length, targets.length);
    }
  });

  it('never needs the rule for a member own account, whichever screen it is saved from', async () => {
    const world = payoutWorld({ payoutMembers: members });
    // A manager manages people, so nobody but an owner or admin could set theirs; they still set their own.
    assert.equal((await world.payouts.setForMember(editors.manager, 'manager-1', KBANK)).account?.setByOtherName, undefined);
    assert.equal((await world.payouts.getOwn(editors.manager)).canEdit, true);
    assert.deepEqual([world.notifications.length, world.audits[0].metadataJson.byOwner], [0, true]);
  });
});

describe('payout: a draft follows the latest default until submit', () => {
  it('shows the requester default as it is now: set, edited, switched to cash, removed', async () => {
    const world = payoutWorld();
    const draft = await world.create.execute(ctx(), claimInput());
    const tokens: Array<string | undefined> = [];
    /** The payout block without its token; the tokens are collected to compare below. */
    const shown = async () => {
      const { submitToken, ...payout } = (await world.detail.execute(ctx(), draft.id)).payout!;
      tokens.push(submitToken);
      return payout;
    };

    assert.deepEqual(await shown(), { followsDefault: true, notReadyReason: 'payout_method_required', canRevealAccountNumber: false });
    await world.payouts.setOwn(ctx(), KBANK);
    assert.deepEqual(await shown(), {
      followsDefault: true, payoutMethod: 'BANK_TRANSFER', source: 'DEFAULT_ACCOUNT', payoutKind: 'BANK_ACCOUNT',
      bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountLast4: '6789', canRevealAccountNumber: false,
    });
    await world.payouts.setOwn(ctx(), SCB);
    assert.equal((await shown()).accountLast4, '9012');
    await world.payouts.setOwn(ctx(), { payoutMethod: 'CASH' });
    assert.deepEqual(await shown(), { followsDefault: true, payoutMethod: 'CASH', source: 'DEFAULT_ACCOUNT', canRevealAccountNumber: false });
    await world.payouts.deleteOwn(ctx());
    assert.equal((await shown()).notReadyReason, 'payout_method_required');
    // The token names what a submit would freeze: none while nothing can be sent, and a different
    // one for every account or method the page showed.
    assert.deepEqual([tokens[0], tokens[4]], [undefined, undefined]);
    for (const token of tokens.slice(1, 4)) assert.match(token!, /^[0-9a-f]{32}$/);
    assert.equal(new Set(tokens.slice(1, 4)).size, 3);
    // A draft never keeps a copy: nothing was written to the claim's own table.
    assert.equal(world.state.payoutTables.destinations.length, 0);
    assert.equal(world.state.request.payoutMethod ?? null, null);
  });

  it('names who set the default when it was not the requester', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    const draft = await world.create.execute(ctx(), claimInput());
    await world.payouts.setForMember(managerCtx(), 'staff-1', KBANK);
    assert.equal((await world.detail.execute(ctx(), draft.id)).payout?.enteredByName, 'วิภา');
    await world.payouts.setOwn(ctx(), KBANK);
    assert.equal((await world.detail.execute(ctx(), draft.id)).payout?.enteredByName, undefined);
  });

  it('takes cash, or an account for this claim only, in place of the default', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(ctx(), claimInput({ payout: { mode: 'CASH' } }));
    const shown = async () => { const { submitToken: _token, ...payout } = (await world.detail.execute(ctx(), draft.id)).payout!; return payout; };
    assert.deepEqual(await shown(), { payoutMethod: 'CASH', canRevealAccountNumber: false });

    await world.update.execute(ctx(), draft.id, { payout: { mode: 'SPECIFIED', ...SCB } });
    assert.deepEqual(await shown(), {
      payoutMethod: 'BANK_TRANSFER', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารไทยพาณิชย์', accountName: 'นาย สมชาย ใจดี',
      accountLast4: '9012', version: 1, source: 'REQUESTER', canRevealAccountNumber: true,
    });
    // The default is untouched, and typing again edits the same working row instead of piling versions up.
    assert.equal((await world.payouts.getOwn(ctx())).account?.accountLast4, '6789');
    await world.update.execute(ctx(), draft.id, { payout: { mode: 'SPECIFIED', ...PROMPTPAY } });
    assert.deepEqual(world.state.payoutTables.destinations.map((row) => [row.version, row.accountLast4, row.frozenAt]), [[1, '5678', null]]);
    // Back to the default: the draft keeps no ciphertext of its own.
    await world.update.execute(ctx(), draft.id, { payout: { mode: 'DEFAULT' } });
    assert.equal(world.state.payoutTables.destinations.length, 0);
    assert.equal((await world.detail.execute(ctx(), draft.id)).payout?.accountLast4, '6789');
  });

  it('refuses an account that is missing or malformed without changing the draft', async () => {
    const world = payoutWorld();
    const draft = await world.create.execute(ctx(), claimInput());
    await assert.rejects(world.update.execute(ctx(), draft.id, { payout: { mode: 'SPECIFIED', payoutKind: 'BANK_ACCOUNT' } as any }), /payout_destination_required/);
    await assert.rejects(world.update.execute(ctx(), draft.id, { payout: { mode: 'SPECIFIED', ...KBANK, accountNumber: '12345' } }), /payout_destination_invalid/);
    await assert.rejects(world.create.execute(ctx(), claimInput({ payout: { mode: 'SPECIFIED', ...KBANK, accountName: '123456' } })), /payout_destination_invalid/);
    assert.equal(world.state.payoutTables.destinations.length, 0);
  });

  it('saves a typed account as the default and lets the claim follow it', async () => {
    const world = payoutWorld();
    const draft = await world.create.execute(ctx(), claimInput({ payout: { mode: 'SPECIFIED', ...KBANK, saveAsDefault: true } }));
    assert.equal((await world.payouts.getOwn(ctx())).account?.accountLast4, '6789');
    assert.equal((await world.detail.execute(ctx(), draft.id)).payout?.followsDefault, true);
    assert.equal(world.state.payoutTables.destinations.length, 0);
    assert.equal(world.notifications.length, 0, 'their own account, so nobody is notified');
    // The next claim needs no typing.
    const submitted = await world.send(ctx(), draft.id);
    assert.deepEqual([submitted.payout?.payoutMethod, submitted.payout?.accountLast4, submitted.payout?.source], ['BANK_TRANSFER', '6789', 'DEFAULT_ACCOUNT']);
  });
});

describe('payout: submit gate and the claim own snapshot', () => {
  it('refuses a claim with no receiving method and takes cash without an account', async () => {
    const world = payoutWorld();
    const draft = await world.create.execute(ctx(), claimInput());
    await assert.rejects(world.send(ctx(), draft.id), /payout_method_required/);
    assert.equal(world.state.request.status, 'DRAFT');
    await world.update.execute(ctx(), draft.id, { payout: { mode: 'CASH' } });
    const submitted = await world.send(ctx(), draft.id);
    assert.deepEqual(submitted.payout, { payoutMethod: 'CASH' });
    assert.equal(submitted.payoutMethod, 'CASH');
    assert.equal(world.state.payoutTables.destinations.length, 0);
  });

  it('freezes its own copy at submit: later changes to the default never reach the claim', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(ctx(), claimInput());
    const submitted = await world.send(ctx(), draft.id);
    const frozen = { payoutMethod: 'BANK_TRANSFER', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountLast4: '6789', version: 1, source: 'DEFAULT_ACCOUNT' };
    assert.deepEqual(submitted.payout, frozen);
    assert.equal(leaksNumber(submitted), false);
    const request = world.state.request;
    const stored = { method: request.payoutMethod, version: request.payoutDestinationVersion, fingerprint: request.payoutFingerprint, hash: request.approvalSnapshotHash };
    // The approval hash covers exactly this snapshot.
    assert.equal(stored.hash, computeSnapshotHash({
      amount: request.amount, currency: request.currency, categoryKey: request.categoryKey, incurredDate: request.incurredDate.toISOString(),
      reason: request.reason, primaryAttachmentId: request.primaryAttachmentId, lines: request.lines,
      approvalPolicySnapshotJson: request.approvalPolicySnapshotJson,
      payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 1, payoutFingerprint: world.state.payoutTables.destinations[0]!.fingerprint,
    }));

    // The member now edits the default twice and finally removes it.
    for (const change of [() => world.payouts.setOwn(ctx(), SCB), () => world.payouts.setOwn(ctx(), { payoutMethod: 'CASH' as const }), () => world.payouts.deleteOwn(ctx())]) {
      await change();
      const now = await world.detail.execute(ctx(), draft.id);
      assert.deepEqual(now.payout, { ...frozen, canRevealAccountNumber: true }, 'display');
      assert.equal((await world.reveal.execute(ctx(), draft.id)).accountNumber, '0123456789', 'reveal');
      assert.deepEqual({ method: world.state.request.payoutMethod, version: world.state.request.payoutDestinationVersion, fingerprint: world.state.request.payoutFingerprint, hash: world.state.request.approvalSnapshotHash }, stored, 'attestation target and hash');
    }
    assert.equal(world.state.payoutTables.destinations.length, 1);
    // The frozen copy itself cannot be rewritten, whatever code tries.
    await assert.rejects(
      world.state.payoutTables.client.reimbursementPayoutDestination.updateMany({ where: { reimbursementRequestId: draft.id }, data: { accountLast4: '0000' } }),
      /reimbursement_payout_destination_frozen/,
    );
  });

  it('refuses the submit when the default changed after it was read, instead of freezing an account nobody hashed', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(ctx(), claimInput());
    const submitAtomic = world.state.repo.submitDraftAtomic;
    // The member saves a different default between the use case reading it and the transaction.
    world.state.repo.submitDraftAtomic = async (data: any) => { await world.payouts.setOwn(ctx(), SCB); return submitAtomic(data); };
    await assert.rejects(world.send(ctx(), draft.id), /payout_destination_changed/);
    assert.equal(world.state.payoutTables.destinations.length, 0);
    world.state.repo.submitDraftAtomic = submitAtomic;
    assert.equal((await world.send(ctx(), draft.id)).payout?.accountLast4, '9012');
  });

  it('sent again after a withdraw: an unchanged account keeps its version, a changed default gets the next', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(ctx(), claimInput());
    await world.send(ctx(), draft.id);
    await world.reopen.execute(ctx(), draft.id);
    // Back in draft it follows the default again, so it shows whatever the default is now.
    assert.equal(world.state.request.payoutMethod, null);
    assert.equal((await world.detail.execute(ctx(), draft.id)).payout?.followsDefault, true);
    assert.equal((await world.send(ctx(), draft.id)).payout?.version, 1);

    await world.reopen.execute(ctx(), draft.id);
    await world.payouts.setOwn(ctx(), SCB);
    const resent = await world.send(ctx(), draft.id);
    assert.deepEqual([resent.payout?.version, resent.payout?.accountLast4], [2, '9012']);
    // Version 1 stays as history, untouched.
    assert.deepEqual(world.state.payoutTables.destinations.map((row) => [row.version, row.accountLast4]).sort(), [[1, '6789'], [2, '9012']]);
  });

  it('an account named for the claim survives a withdraw, and a new one becomes the next version', async () => {
    const world = payoutWorld();
    const draft = await world.create.execute(ctx(), claimInput({ payout: { mode: 'SPECIFIED', ...KBANK } }));
    await world.send(ctx(), draft.id);
    await world.reopen.execute(ctx(), draft.id);
    assert.deepEqual([world.state.request.payoutMethod, world.state.request.payoutDestinationVersion], ['BANK_TRANSFER', 1]);
    assert.equal((await world.detail.execute(ctx(), draft.id)).payout?.accountLast4, '6789');
    await world.update.execute(ctx(), draft.id, { payout: { mode: 'SPECIFIED', ...SCB } });
    const resent = await world.send(ctx(), draft.id);
    assert.deepEqual([resent.payout?.version, resent.payout?.accountLast4], [2, '9012']);
    assert.equal(world.state.payoutTables.destinations.every((row) => row.frozenAt), true);
  });

  it('records which snapshot was frozen in the submit audit, without any account detail', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(ctx(), claimInput());
    await world.send(ctx(), draft.id);
    const submit = world.audits.find((row) => row.action === 'reimbursement.request.submit');
    assert.deepEqual(submit.metadataJson.payout, { method: 'BANK_TRANSFER', version: 1, followsDefault: true });
    assert.equal(leaksNumber(world.audits), false);
    assert.equal(leaksNumber(world.state.calls.outbox), false);
    assert.ok(world.state.calls.outbox.every((event: any) => !/payout|account/i.test(JSON.stringify(event.payloadJson.data))), 'no event payload carries account data');
  });
});

describe('payout: filing a claim on behalf of someone', () => {
  it("uses the requester's account, never the preparer's, and follows the requester's default until submit", async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(financeCtx(), SCB); // the preparer's own account, which must never appear
    await world.payouts.setOwn(ctx(), KBANK); // the requester's
    const draft = await world.create.execute(financeCtx(), claimInput({ requesterUserId: 'staff-1' }));
    const seenByPreparer = async () => (await world.detail.execute(financeCtx(), draft.id)).payout;

    assert.deepEqual([(await seenByPreparer())?.accountLast4, (await seenByPreparer())?.canRevealAccountNumber], ['6789', false]);
    // The requester changes their default while the claim is still a draft: the draft shows the new one.
    await world.payouts.setOwn(ctx(), PROMPTPAY);
    assert.equal((await seenByPreparer())?.accountLast4, '5678');

    const submitted = await world.send(financeCtx(), draft.id);
    assert.deepEqual([submitted.payout?.accountLast4, submitted.payout?.source, submitted.payout?.enteredByName], ['5678', 'DEFAULT_ACCOUNT', undefined]);
    // After submit the requester's default changes again; the claim does not.
    await world.payouts.setOwn(ctx(), KBANK);
    assert.equal((await seenByPreparer())?.accountLast4, '5678');
    assert.equal((await world.reveal.execute(ctx(), draft.id)).accountNumber, '0812345678', 'the requester reads their own frozen number');
    // The preparer holds no payment right and is not the approver: last 4 only.
    assert.equal((await seenByPreparer())?.canRevealAccountNumber, false);
    await assert.rejects(world.reveal.execute(financeCtx(), draft.id), /payout_reveal_denied/);
  });

  it('lets the preparer type the requester account, records who typed it, and shows them the last 4 afterwards', async () => {
    const world = payoutWorld();
    const draft = await world.create.execute(financeCtx(), claimInput({ requesterUserId: 'staff-1', payout: { mode: 'SPECIFIED', ...KBANK } }));
    const forPreparer = (await world.detail.execute(financeCtx(), draft.id)).payout;
    assert.deepEqual([forPreparer?.source, forPreparer?.enteredByName, forPreparer?.accountLast4, forPreparer?.canRevealAccountNumber], ['PREPARER', 'อรทัย', '6789', false]);
    await assert.rejects(world.reveal.execute(financeCtx(), draft.id), /payout_reveal_denied/);
    // The requester opens their own claim and sees the account that was put on it.
    const forRequester = (await world.detail.execute(ctx(), draft.id)).payout;
    assert.deepEqual([forRequester?.enteredByName, forRequester?.canRevealAccountNumber], ['อรทัย', true]);
    assert.equal((await world.reveal.execute(ctx(), draft.id)).accountNumber, '0123456789');
    assert.equal(world.state.payoutTables.accounts.length, 0, 'nobody default was set');
  });

  it('saves it as the requester default only for a preparer who may edit employee data, and tells the requester', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    const input = claimInput({ requesterUserId: 'staff-1', payout: { mode: 'SPECIFIED', ...KBANK, saveAsDefault: true } });
    await assert.rejects(world.create.execute(financeCtx(), input), /payout_account_edit_denied/);
    assert.equal(world.state.payoutTables.accounts.length, 0);

    const hr = ctx({ userId: 'finance-1', permissions: [...financeCtx().permissions, 'access.employee.update'] });
    const draft = await world.create.execute(hr, input);
    assert.deepEqual(world.state.payoutTables.accounts.map((row) => [row.userId, row.accountLast4, row.updatedByUserId]), [['staff-1', '6789', 'finance-1']]);
    assert.equal((await world.detail.execute(hr, draft.id)).payout?.followsDefault, true);
    assert.deepEqual(world.notifications.map((notice) => notice.recipientUserIds), [['staff-1']]);
  });
});

describe('payout: a draft made from LINE', () => {
  // LINE writes a draft with no account data at all (it has no payout field); it is sent on the web.
  it('submits on the web when the requester has a default account, with nothing to add', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const lineDraft = await world.create.execute(ctx(), claimInput());
    assert.equal(world.state.request.payoutMethod ?? null, null);
    assert.equal((await world.send(ctx(), lineDraft.id)).payout?.accountLast4, '6789');
  });

  it('says what is missing when the requester has none, and submits once a method is chosen', async () => {
    const world = payoutWorld();
    const lineDraft = await world.create.execute(ctx(), claimInput());
    assert.deepEqual((await world.detail.execute(ctx(), lineDraft.id)).payout, { followsDefault: true, notReadyReason: 'payout_method_required', canRevealAccountNumber: false });
    await assert.rejects(world.send(ctx(), lineDraft.id), /payout_method_required/);
    await world.payouts.setOwn(ctx(), { payoutMethod: 'CASH' });
    assert.equal((await world.send(ctx(), lineDraft.id)).payout?.payoutMethod, 'CASH');
  });
});

describe('payout: lists carry the receiving method and nothing of the account', () => {
  it('returns the method on a row and no bank, name, last 4 or number', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(ctx(), claimInput());
    await world.send(ctx(), draft.id);
    Object.assign(world.state.repo, { listRequests: async () => [world.state.request], findPendingApprovalSteps: async () => [] });
    const page = await new ListReimbursementsUseCase(world.state.repo).execute(ctx(), {});
    assert.equal(page.items[0]!.payoutMethod, 'BANK_TRANSFER');
    assert.ok(!/payout(?!Method)|bankName|accountName|accountLast4|accountNumber|fingerprint/i.test(JSON.stringify(page)));
    assert.equal(leaksNumber(page), false);
  });
});

// Owner direction 2026-10-01: a draft follows the member's default account, and since a manager may
// change that default, the requester could send a claim to an account they never saw. The page shows
// the account that will be frozen, and the submit is bound to what it showed.
describe('payout: the claim is sent with the account its page showed (show before freeze)', () => {
  it('refuses a submit that names no account, and one whose default was changed after the page was read', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(ctx(), claimInput());
    // A list-row submit, a browser tab from before the release, a script: nothing was shown, nothing is sent.
    await assert.rejects(world.submit.execute(ctx(), draft.id), /payout_destination_changed/);
    await assert.rejects(world.submit.execute(ctx(), draft.id, null), /payout_destination_changed/);
    await assert.rejects(world.submit.execute(ctx(), draft.id, { payoutSubmitToken: 'f'.repeat(32) }), /payout_destination_changed/);

    // The requester reads the page, then a manager changes their default before they press send.
    const seen = (await world.detail.execute(ctx(), draft.id)).payout!;
    assert.equal(seen.accountLast4, '6789');
    await world.payouts.setForMember(managerCtx(), 'staff-1', SCB);
    await assert.rejects(world.submit.execute(ctx(), draft.id, { payoutSubmitToken: seen.submitToken }), (error: any) => {
      assert.equal(error.getStatus(), 409);
      assert.match(error.message, /payout_destination_changed/);
      return true;
    });
    assert.deepEqual([world.state.request.status, world.state.request.payoutFingerprint ?? null, world.state.payoutTables.destinations.length], ['DRAFT', null, 0]);

    // They look again: the page now shows the new account and says who set it. That is what they send.
    const latest = (await world.detail.execute(ctx(), draft.id)).payout!;
    assert.deepEqual([latest.accountLast4, latest.enteredByName], ['9012', 'วิภา']);
    assert.notEqual(latest.submitToken, seen.submitToken);
    const sent = await world.submit.execute(ctx(), draft.id, { payoutSubmitToken: latest.submitToken });
    assert.deepEqual([sent.status, sent.payout?.accountLast4, sent.payout?.submitToken], ['PENDING_APPROVAL', '9012', undefined]);
    assert.equal((await world.detail.execute(ctx(), draft.id)).payout?.submitToken, undefined, 'a sent claim has nothing left to send');
  });

  it('refuses when the default was removed, or switched between a transfer and cash, after the page was read', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(ctx(), claimInput());
    const tokenOf = async () => (await world.detail.execute(ctx(), draft.id)).payout?.submitToken;

    const transfer = await tokenOf();
    await world.payouts.setOwn(ctx(), { payoutMethod: 'CASH' });
    await assert.rejects(world.submit.execute(ctx(), draft.id, { payoutSubmitToken: transfer }), /payout_destination_changed/, 'a transfer the page showed is not sent as cash');
    const cash = await tokenOf();
    await world.payouts.setOwn(ctx(), KBANK);
    await assert.rejects(world.submit.execute(ctx(), draft.id, { payoutSubmitToken: cash }), /payout_destination_changed/, 'cash the page showed is not sent as a transfer');
    // The same account saved again is the same account: no needless refusal.
    assert.equal(await tokenOf(), transfer);
    await world.payouts.deleteOwn(ctx());
    await assert.rejects(world.submit.execute(ctx(), draft.id, { payoutSubmitToken: transfer }), (error: any) => {
      assert.equal(error.getStatus(), 409);
      assert.match(error.message, /payout_method_required/);
      return true;
    });
    assert.equal(world.state.request.status, 'DRAFT');
  });

  it('takes the draft own choice without a token, and refuses a token that is not what the claim would freeze', async () => {
    for (const payout of [{ mode: 'CASH' as const }, { mode: 'SPECIFIED' as const, ...KBANK }]) {
      const world = payoutWorld();
      const draft = await world.create.execute(ctx(), claimInput({ payout }));
      await assert.rejects(world.submit.execute(ctx(), draft.id, { payoutSubmitToken: 'e'.repeat(32) }), /payout_destination_changed/);
      // Cash, or an account typed into this claim, depends on nobody else's edit.
      assert.equal((await world.submit.execute(ctx(), draft.id)).status, 'PENDING_APPROVAL');
    }
  });
});

describe('payout: a legacy claim is one thing everywhere', () => {
  /** What an older build stores on submit: no payout columns of its own, a hash without a payout part. */
  function sendWithAnOlderBuild(request: any) {
    Object.assign(request, {
      status: 'PENDING_APPROVAL', submittedAt: new Date('2026-10-01T03:00:00.000Z'), requestNo: 'RB-202610-000009',
      approvalSnapshotHash: computeSnapshotHash(claimSnapshotFields({ ...request, payoutFingerprint: undefined })),
    });
  }

  // The rollback window: the draft chose its account under this build, an older build sent it.
  it('shows, lists, hashes, attests and reveals a draft choice sent by an older build as a legacy claim', async () => {
    const world = payoutWorld();
    const draft = await world.create.execute(ctx(), claimInput({ payout: { mode: 'SPECIFIED', ...KBANK } }));
    const request = world.state.request;
    sendWithAnOlderBuild(request);
    assert.deepEqual([request.payoutMethod, request.payoutDestinationVersion, request.payoutFingerprint ?? null], ['BANK_TRANSFER', 1, null]);

    assert.equal((await world.detail.execute(ctx(), draft.id)).payout, undefined, 'no account is shown for the claim');
    Object.assign(world.state.repo, { listRequests: async () => [request], findPendingApprovalSteps: async () => [] });
    assert.equal((await new ListReimbursementsUseCase(world.state.repo).execute(ctx(), {})).items[0]!.payoutMethod, undefined);
    await assert.rejects(world.reveal.execute(ctx(), draft.id), /payout_reveal_denied/);
    // The live approval check recomputes exactly what the older build stored, and asks for no attestation.
    assert.equal(computeSnapshotHash(claimSnapshotFields(request, request.approvalPolicySnapshotJson)), request.approvalSnapshotHash);
    assert.equal(payoutAttestationError(request, undefined), null);
    assert.equal(hasPayoutSnapshot(request), false);

    // Withdrawn under this build, the draft's own choice is back, and sending it freezes a real snapshot.
    await world.reopen.execute(ctx(), draft.id);
    assert.equal((await world.detail.execute(ctx(), draft.id)).payout?.accountLast4, '6789');
    const sent = await world.send(ctx(), draft.id);
    assert.deepEqual([sent.payout?.version, hasPayoutSnapshot(world.state.request), world.state.payoutTables.destinations[0]!.frozenAt !== null], [1, true, true]);
  });

  // Part B stores a copy of the account a legacy claim was paid to. The claim itself stays legacy.
  it('keeps a claim sent before the field existed legacy, also when account rows exist for it', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(ctx(), claimInput());
    const request = world.state.request;
    sendWithAnOlderBuild(request);
    const before = { hash: request.approvalSnapshotHash, signature: claimSignatureAckHash(request) };
    const sealed = sealPayoutDestination(KBANK, PAYOUT_KEY)!;
    world.state.payoutTables.destinations.push({
      id: 'destination-paid', companyId: 'co-1', reimbursementRequestId: draft.id, version: 1, ...sealed,
      source: 'DEFAULT_ACCOUNT', createdByUserId: 'finance-1', frozenAt: new Date('2026-10-02T00:00:00.000Z'),
    });

    assert.equal((await world.detail.execute(ctx(), draft.id)).payout, undefined);
    await assert.rejects(world.reveal.execute(ctx(), draft.id), /payout_reveal_denied/);
    assert.deepEqual({ hash: computeSnapshotHash(claimSnapshotFields(request, request.approvalPolicySnapshotJson)), signature: claimSignatureAckHash(request) }, before);
    assert.equal(payoutAttestationError(request, undefined), null);
    // The member's default is not shown as the claim's account either: nothing after submit reads it.
    await world.payouts.setOwn(ctx(), SCB);
    assert.equal((await world.detail.execute(ctx(), draft.id)).payout, undefined);
  });
});

describe('payout: nothing but the two reveal calls carries the number', () => {
  it('keeps the number, the ciphertext and the fingerprint out of every response, row, audit entry, notice, event and export', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    const out: unknown[] = [];
    out.push(await world.payouts.setForMember(managerCtx(), 'staff-1', KBANK), await world.payouts.getForMember(managerCtx(), 'staff-1'));
    out.push(await world.payouts.setOwn(ctx(), PROMPTPAY), await world.payouts.getOwn(ctx()));
    const draft = await world.create.execute(ctx(), claimInput());
    out.push(draft, await world.detail.execute(ctx(), draft.id));
    out.push(await world.update.execute(ctx(), draft.id, { payout: { mode: 'SPECIFIED', ...SCB } }), await world.detail.execute(ctx(), draft.id));
    out.push(await world.send(ctx(), draft.id), await world.detail.execute(ctx(), draft.id));
    Object.assign(world.state.repo, { listRequests: async () => [world.state.request], findPendingApprovalSteps: async () => [] });
    out.push(await new ListReimbursementsUseCase(world.state.repo).execute(ctx(), {}));
    out.push(await new ExportReimbursementEvidenceUseCase(world.state.repo, { log: async (entry: any) => { world.audits.push(entry); } } as any)
      .execute(ctx({ permissions: ['reimbursement.export', 'reimbursement.read'] }), draft.id));
    out.push(world.audits, world.notifications, world.state.calls.outbox);

    const { accounts, destinations } = world.state.payoutTables;
    const secrets = [...FULL_NUMBERS, ...[...accounts, ...destinations].flatMap((row) => [row.accountNumberEncrypted, row.fingerprint])];
    assert.equal(secrets.length, FULL_NUMBERS.length + 4);
    const text = JSON.stringify(out);
    for (const secret of secrets) assert.equal(text.includes(secret), false, `leaked: ${String(secret).slice(0, 12)}…`);
    assert.doesNotMatch(text, /"(?:payout)?(?:accountNumber\w*|fingerprint)":/i, 'no field is even named after them');
    // The last 4 digits are what everyone may see, and the two reveal calls are the only way to the rest.
    assert.match(text, /"accountLast4":"9012"/);
    assert.equal((await world.reveal.execute(ctx(), draft.id)).accountNumber, '000123456789012');
    assert.equal((await world.payouts.revealOwn(ctx())).accountNumber, '0812345678');
  });

  it('never echoes what was typed in a refusal', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE, 'admin-1': { ...EMPLOYEE, allBranches: true, branchIds: [] } } });
    const typed = '0123456789';
    const refusals: unknown[] = [];
    const refused = async (attempt: Promise<unknown>) => {
      await assert.rejects(attempt, (error: any) => { refusals.push([error.message, error.getResponse?.()]); return true; });
    };
    await refused(world.payouts.setOwn(ctx(), { ...KBANK, accountNumber: `${typed}${typed}${typed}` }));
    await refused(world.payouts.setOwn(ctx(), { ...KBANK, accountNumber: `${typed}x` }));
    await refused(world.payouts.setOwn(ctx(), { ...KBANK, accountName: typed }));
    await refused(world.payouts.setOwn(ctx(), { payoutMethod: 'BANK_TRANSFER', accountNumber: typed } as any));
    await refused(world.payouts.setOwn(ctx(), { ...KBANK, accountNumber: typed, payoutMethod: 'TRANSFER_TO_ME' } as any));
    await refused(world.payouts.setForMember(managerCtx({ scopes: { branchIds: ['branch-9'] } }), 'staff-1', { ...KBANK, accountNumber: typed }));
    await refused(world.payouts.setForMember(managerCtx(), 'nobody', { ...KBANK, accountNumber: typed }));
    await refused(world.create.execute(ctx(), claimInput({ payout: { mode: 'SPECIFIED', ...KBANK, accountNumber: `${typed}x` } })));
    await refused(world.create.execute(financeCtx(), claimInput({ requesterUserId: 'staff-1', payout: { mode: 'SPECIFIED', ...KBANK, accountNumber: typed, saveAsDefault: true } })));
    assert.equal(refusals.length, 9);
    assert.equal(JSON.stringify([refusals, world.audits]).includes(typed), false);
  });
});

// The finance note is copied into the requester's notification (web and LINE). People write account
// numbers there ("โอนเข้า 123-4-56789-0 แทน"), and a plain "six digits in a row" check lets that through.
describe('payout: a note that goes into a notification carries no account number', () => {
  it('refuses the finance note before anything is decided, and takes an ordinary one', async () => {
    const decisions: any[] = [];
    const repo = {
      findRequestById: async () => ({ id: 'rb-1', companyId: 'co-1', branchId: 'branch-1', status: 'FINANCE_REVIEW', updatedAt: new Date('2026-10-01T00:00:00.000Z') }),
      recordFinanceReviewAtomic: async (data: any) => { decisions.push(data); throw new Error('stop after the guard'); },
      beginFinanceApprovalAtomic: async (data: any) => { decisions.push(data); throw new Error('stop after the guard'); },
    } as any;
    const review = new FinanceReviewReimbursementUseCase(repo, { log: async () => undefined } as any, {} as any, {} as any);
    const finance = ctx({ userId: 'finance-1', permissions: ['reimbursement.finance_review'] });
    for (const note of ['บัญชีผิด โอนเข้า 123-4-56789-0 แทน', 'พร้อมเพย์ 081 000 1234', 'เลขบัญชี 0123456789']) {
      for (const decision of ['NEEDS_INFO', 'APPROVED_FOR_PAYMENT'] as const) {
        await assert.rejects(review.execute(finance, 'rb-1', { decision, note }), (error: any) => {
          assert.equal(error.getStatus?.(), 400);
          assert.match(error.message, /^note_contains_account_number$/);
          return true;
        }, note);
      }
    }
    assert.equal(decisions.length, 0);
    // A note without one goes on to the decision.
    await assert.rejects(review.execute(finance, 'rb-1', { decision: 'NEEDS_INFO', note: 'ใบเสร็จลงวันที่ 01-10-2569 ไม่ตรงกับวันที่เบิก' }), /stop after the guard/);
    assert.equal(decisions.length, 1);
  });
});
