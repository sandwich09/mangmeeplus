import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RequestContext } from '@watchdog-bms/contracts';
import {
  assertCanReadRequest,
  GetReimbursementDetailUseCase,
  ReimbursementInternalNotesUseCase,
  ListReimbursementsUseCase,
} from './reimbursement-request.use-case';
import { GetReimbursementAiSummaryUseCase } from './reimbursement-summary.use-case';
import { ListFinanceQueueUseCase } from './reimbursement-finance.use-case';
import {
  PrismaReimbursementRepository,
  reimbursementRelatedToUserWhere,
} from '../../infrastructure/prisma-reimbursement.repository';
import { ReimbursementController } from '../../presentation/http/reimbursement.controller';
import { ReimbursementPayoutController } from '../../presentation/http/reimbursement-payout.controller';
import { RevealClaimPayoutUseCase } from './reimbursement-payout-reveal.use-case';
import { sealPayoutDestination } from '../../domain/logic/payout-destination.logic';
import { fakePayoutTables } from '../../infrastructure/reimbursement-payout.fixture';
import { readClaimPayout, readClaimPayoutSecret, readDraftDefaultPayout, readMemberPayoutAccount } from '../../infrastructure/reimbursement-payout';
import {
  REQUIRED_ANY_PERMISSIONS_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from '../../../../common/security/permissions.decorator';

const ctx = (overrides: Partial<RequestContext> = {}): RequestContext => ({
  userId: 'actor-1',
  companyId: 'company-1',
  authSubject: 'actor-1',
  membershipId: 'membership-1',
  authProvider: 'watchdog',
  roles: ['STAFF'],
  permissions: ['reimbursement.read_related'],
  scopes: { branchIds: ['branch-1'] },
  requestId: 'request-1',
  ...overrides,
});

const request = {
  id: 'reimbursement-1',
  requesterUserId: 'requester-1',
  branchId: 'branch-1',
};

// ---- Who may see a claim's full account number (owner decision D2, payout spec §11.1) ----

describe('claim account number reveal: the requester, that claim approver, the payment recorder, nobody else', () => {
  const key = Buffer.alloc(32, 11);
  const sentAt = new Date('2026-10-01T03:00:00.000Z');
  const decidedAt = new Date('2026-10-01T04:00:00.000Z');

  function world(overrides: Record<string, unknown> = {}, options: { related?: string[]; destinationFrozen?: boolean } = {}) {
    const tables = fakePayoutTables();
    const sealed = sealPayoutDestination({ payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountNumber: '0123456789' }, key)!;
    tables.destinations.push({
      id: 'destination-1', companyId: 'company-1', reimbursementRequestId: 'reimbursement-1', version: 1, ...sealed,
      source: 'DEFAULT_ACCOUNT', createdByUserId: 'requester-1', frozenAt: options.destinationFrozen === false ? null : sentAt,
    });
    const claim: any = {
      id: 'reimbursement-1', companyId: 'company-1', branchId: 'branch-1', requestNo: 'RB-202610-00001',
      requesterUserId: 'requester-1', requesterDisplayNameSnapshot: 'สมชาย', createdByUserId: 'preparer-1',
      reason: 'ค่าเดินทาง', categoryKey: 'travel', amount: '500.0000', currency: 'THB', incurredDate: sentAt,
      status: 'READY_FOR_PAYMENT', submittedAt: sentAt, approvedAt: decidedAt,
      financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'UNPAID', duplicateStatus: 'NO_MATCH',
      receiptRequirementStatus: 'ATTACHED', postingStatus: 'pending', paymentTotalAmount: '0.0000', outstandingAmount: '500.0000',
      createdAt: sentAt, updatedAt: decidedAt, lines: [], payments: [], duplicateCandidates: [], claimSignatures: [],
      payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 1, payoutFingerprint: sealed.fingerprint,
      approvalSteps: [{
        id: 'step-1', companyId: 'company-1', reimbursementRequestId: 'reimbursement-1', sequenceNo: 1,
        approverRoleSnapshot: 'MANAGER', assignedApproverUserIds: ['approver-1'], status: 'APPROVED',
        decisionByUserId: 'approver-1', decidedAt, assignedAt: sentAt, createdAt: sentAt, updatedAt: decidedAt,
      }],
      ...overrides,
    };
    const audits: any[] = [];
    const repo = {
      findRequestById: async (companyId: string, id: string) => (companyId === claim.companyId && id === claim.id ? claim : null),
      findActiveApproverUserIds: async (_companyId: string, ids: string[]) => new Set(ids),
      findPolicy: async () => null,
      isUserRelatedToRequest: async (_companyId: string, _requestId: string, userId: string) => (options.related ?? []).includes(userId),
      getUserDisplayNames: async () => ({}),
      listSignedClaimFormCopies: async () => [],
      listInternalNotes: async () => [],
      findClaimPayout: (row: any) => readClaimPayout(tables.client, row),
      findDraftDefaultPayout: (row: any) => readDraftDefaultPayout(tables.client, row),
      // The requester's own detail compares the claim with their default as it is now (§22 hint).
      findMemberPayoutAccount: (companyId: string, userId: string) => readMemberPayoutAccount(tables.client, companyId, userId),
      findClaimPayoutSecret: (companyId: string, requestId: string, version: number) => readClaimPayoutSecret(tables.client, companyId, requestId, version),
    } as any;
    const audit = { log: async (entry: any) => { audits.push(entry); }, logOrThrow: async (entry: any) => { audits.push(entry); } } as any;
    return {
      claim, audits, repo,
      reveal: new RevealClaimPayoutUseCase(repo, audit, { credentialEncryptionKey: key } as any),
      detail: new GetReimbursementDetailUseCase(repo, { getAttachmentFileName: async () => undefined, getAttachmentFileNames: async () => ({}) } as any),
    };
  }

  const viewer = (userId: string, permissions: string[], overrides: Partial<RequestContext> = {}) => ctx({ userId, authSubject: userId, permissions, roles: ['STAFF'], ...overrides });
  const requester = viewer('requester-1', ['reimbursement.read_own', 'reimbursement.create']);
  const approver = viewer('approver-1', ['reimbursement.read', 'reimbursement.approve', 'reimbursement.reject']);
  const payer = viewer('payer-1', ['reimbursement.read', 'reimbursement.payment.record']);
  const refused: Array<[string, RequestContext]> = [
    ['finance reviewer without the payment right', viewer('finance-1', ['reimbursement.read', 'reimbursement.finance_review'])],
    ['auditor (read only)', viewer('auditor-1', ['reimbursement.read', 'reimbursement.export'])],
    ['holder of the approval right who was never sent this claim', viewer('other-approver', ['reimbursement.read', 'reimbursement.approve'], { roles: ['MANAGER'] })],
    ['related viewer', viewer('related-1', ['reimbursement.read_related'])],
    ['whoever prepared the claim for the requester', viewer('preparer-1', ['reimbursement.read', 'reimbursement.finance_review', 'reimbursement.create'])],
    ['payment recorder of another branch', viewer('payer-2', ['reimbursement.read', 'reimbursement.payment.record'], { scopes: { branchIds: ['branch-2'] } })],
    ['approver of another branch', viewer('approver-1', ['reimbursement.read', 'reimbursement.approve'], { scopes: { branchIds: ['branch-2'] } })],
    ['payment right without any way to read the claim', viewer('payer-3', ['reimbursement.payment.record'])],
    ['HR (employee data only)', viewer('hr-1', ['access.employee.read', 'access.employee.update', 'reimbursement.read_own'])],
  ];

  it('gives the full number to exactly the three groups, with an audit row each time and never the number in it', async () => {
    for (const [group, who] of [['REQUESTER', requester], ['APPROVER', approver], ['PAYER', payer]] as const) {
      const { reveal, audits } = world();
      assert.deepEqual(await reveal.execute(who, 'reimbursement-1'), { accountNumber: '0123456789' }, group);
      assert.equal(audits.length, 1);
      assert.deepEqual([audits[0].action, audits[0].result, audits[0].riskLevel, audits[0].actorUserId, audits[0].targetId], [
        'reimbursement.payout.reveal', 'SUCCESS', 'HIGH', who.userId, 'reimbursement-1',
      ]);
      assert.deepEqual(audits[0].metadataJson, { group, version: 1, payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountLast4: '6789' });
      assert.ok(!JSON.stringify(audits).includes('0123456789'));
    }
  });

  it('refuses everyone else with payout_reveal_denied and records the refusal', async () => {
    for (const [name, who] of refused) {
      const { reveal, audits } = world({}, { related: ['related-1'] });
      await assert.rejects(reveal.execute(who, 'reimbursement-1'), /payout_reveal_denied/, name);
      assert.deepEqual(audits.map((row) => [row.action, row.result, row.actorUserId]), [['reimbursement.payout.reveal', 'DENIED', who.userId]], name);
    }
    // Another company cannot even tell the claim exists, and leaves nothing in this company's audit.
    const { reveal, audits } = world();
    await assert.rejects(reveal.execute(viewer('payer-1', ['reimbursement.read', 'reimbursement.payment.record'], { companyId: 'company-2' }), 'reimbursement-1'), /not found/i);
    assert.equal(audits.length, 0);
  });

  it('counts an approver by this claim: the pending assignee and the routed role, not every holder of the right', async () => {
    const pending = { status: 'PENDING_APPROVAL', approvedAt: undefined, currentApprovalStepId: 'step-1' };
    const assigned = world({ ...pending, approvalSteps: [{ id: 'step-1', sequenceNo: 1, approverRoleSnapshot: 'MANAGER', assignedApproverUserIds: ['assignee-1'], status: 'PENDING', assignedAt: sentAt }] });
    // A frozen assignee keeps the task after losing the permission, and so can read the account they must attest.
    assert.equal((await assigned.reveal.execute(viewer('assignee-1', []), 'reimbursement-1')).accountNumber, '0123456789');
    await assert.rejects(assigned.reveal.execute(viewer('manager-2', ['reimbursement.read', 'reimbursement.approve'], { roles: ['MANAGER'] }), 'reimbursement-1'), /payout_reveal_denied/);

    const routed = world({ ...pending, approvalSteps: [{ id: 'step-1', sequenceNo: 1, approverRoleSnapshot: 'MANAGER', status: 'PENDING', assignedAt: sentAt }] });
    assert.equal((await routed.reveal.execute(viewer('manager-2', ['reimbursement.read', 'reimbursement.approve'], { roles: ['MANAGER'] }), 'reimbursement-1')).accountNumber, '0123456789');
    await assert.rejects(routed.reveal.execute(viewer('sales-1', ['reimbursement.read', 'reimbursement.approve'], { roles: ['SALES'] }), 'reimbursement-1'), /payout_reveal_denied/);

    // Approved in an earlier round, then sent again: that approval was of an older snapshot.
    const resent = world({ submittedAt: new Date('2026-10-01T05:00:00.000Z') });
    await assert.rejects(resent.reveal.execute(approver, 'reimbursement-1'), /payout_reveal_denied/);
  });

  it('has nothing to reveal on a cash or a legacy claim, and keeps a draft to its requester', async () => {
    for (const noAccount of [{ payoutMethod: 'CASH', payoutDestinationVersion: undefined }, { payoutMethod: undefined, payoutDestinationVersion: undefined, payoutFingerprint: undefined }]) {
      const { reveal } = world(noAccount);
      for (const who of [requester, approver, payer]) await assert.rejects(reveal.execute(who, 'reimbursement-1'), /payout_reveal_denied/);
    }
    const draft = world({ status: 'DRAFT', submittedAt: undefined, approvedAt: undefined, approvalSteps: [], requestNo: undefined }, { destinationFrozen: false });
    assert.equal((await draft.reveal.execute(requester, 'reimbursement-1')).accountNumber, '0123456789');
    for (const who of [payer, approver, refused[4]![1]]) await assert.rejects(draft.reveal.execute(who, 'reimbursement-1'), /payout_reveal_denied/);
  });

  it('never answers when the audit row cannot be written', async () => {
    const { repo } = world();
    const reveal = new RevealClaimPayoutUseCase(repo, { log: async () => undefined, logOrThrow: async () => { throw new Error('audit store down'); } } as any, { credentialEncryptionKey: key } as any);
    await assert.rejects(reveal.execute(requester, 'reimbursement-1'), /audit store down/);
  });

  it('offers the button exactly when the reveal would answer, and shows every viewer the same masked account', async () => {
    const masked = { payoutMethod: 'BANK_TRANSFER', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountLast4: '6789', version: 1, source: 'DEFAULT_ACCOUNT' };
    const readers: Array<[string, RequestContext]> = [['requester', requester], ['approver', approver], ['payer', payer],
      ...refused.filter(([name]) => !/another branch|without any way to read|HR/.test(name))];
    for (const [name, who] of readers) {
      const { reveal, detail } = world({}, { related: ['related-1'] });
      const shown = (await detail.execute(who, 'reimbursement-1')).payout;
      const answered = await reveal.execute(who, 'reimbursement-1').then(() => true, () => false);
      assert.equal(shown?.canRevealAccountNumber, answered, name);
      // Identical for everyone, whatever they may reveal: bank, account name and the last 4 digits.
      assert.deepEqual({ ...shown, canRevealAccountNumber: undefined }, { ...masked, canRevealAccountNumber: undefined }, name);
      assert.ok(!JSON.stringify(shown).includes('0123456789'), name);
    }
    // A legacy claim reads the same to all three groups: no payout block at all.
    for (const who of [requester, approver, payer]) {
      const { detail } = world({ payoutMethod: undefined, payoutDestinationVersion: undefined, payoutFingerprint: undefined });
      assert.equal((await detail.execute(who, 'reimbursement-1')).payout, undefined);
    }
  });

  it('exposes the payout routes with the narrowest permission each, and no way to reveal another member default account', () => {
    const prototype = ReimbursementPayoutController.prototype;
    assert.deepEqual(Object.getOwnPropertyNames(prototype).filter((name) => name !== 'constructor').sort(),
      ['deleteOwn', 'getForMember', 'getOwn', 'revealForClaim', 'revealOwn', 'setForMember', 'setOwn']);
    for (const handler of ['getOwn', 'setOwn', 'deleteOwn', 'revealOwn'] as const) {
      assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype[handler]), ['reimbursement.create'], handler);
    }
    assert.deepEqual(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, prototype.getForMember), ['access.employee.read', 'access.employee.update']);
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype.setForMember), ['access.employee.update']);
    // Like the claim detail: the session permission opens the route, the claim's own reveal group decides.
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype.revealForClaim), ['account.session.read']);
  });
});

describe('reimbursement related-view ABAC', () => {
  it('opens only read/signer entry routes to related actors and keeps business mutations exact', () => {
    const prototype = ReimbursementController.prototype;
    const readAny = ['reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own'];
    for (const handler of [
      'summary', 'list', 'previewClaimForm', 'initClaimSignature',
      'completeClaimSignature', 'signClaimForm', 'linkSignedCopy',
    ] as const) {
      assert.deepEqual(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, prototype[handler]), readAny);
    }
    // Detail is also the inspection surface for an exact frozen approval assignment;
    // account.session.read satisfies the global deny-by-default guard, then the use case applies
    // both normal read ABAC and that task-scoped capability.
    assert.equal(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, prototype.get), undefined);
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype.get), ['account.session.read']);
    for (const handler of ['addInternalNote', 'editInternalNote', 'deleteInternalNote'] as const) {
      assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype[handler]), ['account.session.read']);
    }
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype.listApprovalQueue), ['account.session.read']);
    assert.deepEqual(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, prototype.update), ['reimbursement.update_own_draft', 'reimbursement.finance_review']);
    // Approve/reject are gated by exact frozen assignment or current permission in the
    // use case and repeated inside the transaction; the route-level session permission only
    // makes the dynamic authorization path explicit to the global guard.
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype.approveRequest), ['account.session.read']);
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype.rejectRequest), ['account.session.read']);
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype.createPayment), ['reimbursement.payment.record']);
    // The payment-step duplicate clear rides this endpoint; the use case splits the two keys per call.
    assert.deepEqual(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, prototype.reviewRequest), [
      'reimbursement.finance_review', 'reimbursement.duplicate.resolve', 'reimbursement.payment.record',
    ]);
    assert.deepEqual(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, prototype.cancelRequest), [
      'reimbursement.cancel_own', 'reimbursement.finance_review',
    ]);
  });

  it('allows a persisted related actor and rejects an unrelated actor', async () => {
    const allowedRepo = {
      isUserRelatedToRequest: async () => true,
    } as unknown as PrismaReimbursementRepository;
    await assert.doesNotReject(assertCanReadRequest(ctx(), request, allowedRepo));

    const deniedRepo = {
      isUserRelatedToRequest: async () => false,
    } as unknown as PrismaReimbursementRepository;
    await assert.rejects(
      assertCanReadRequest(ctx(), request, deniedRepo),
      /Cannot read this reimbursement/,
    );
  });

  it('enforces branch scope before evaluating the actor graph', async () => {
    let relationChecked = false;
    const repo = {
      isUserRelatedToRequest: async () => { relationChecked = true; return true; },
    } as unknown as PrismaReimbursementRepository;
    await assert.rejects(
      assertCanReadRequest(ctx({ scopes: { branchIds: ['branch-2'] } }), request, repo),
      /outside your assigned branch scope/,
    );
    assert.equal(relationChecked, false);
  });

  it('lets a frozen assignee inspect only their pending task after role permissions change', async () => {
    const now = new Date('2026-08-21T00:00:00.000Z');
    const pending = {
      id: 'reimbursement-1', companyId: 'company-1', branchId: 'branch-1',
      requesterUserId: 'requester-1', requesterDisplayNameSnapshot: 'Requester',
      reason: 'ค่าเดินทาง', categoryKey: 'travel', amount: '500.0000', currency: 'THB',
      incurredDate: now, status: 'PENDING_APPROVAL', currentApprovalStepId: 'step-1',
      financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'UNPAID', duplicateStatus: 'NOT_CHECKED',
      receiptRequirementStatus: 'ATTACHED', postingStatus: 'not_required',
      paymentTotalAmount: '0.0000', outstandingAmount: '500.0000', createdByUserId: 'requester-1',
      createdAt: now, updatedAt: now, lines: [], payments: [], duplicateCandidates: [], claimSignatures: [],
      approvalSteps: [{
        id: 'step-1', companyId: 'company-1', reimbursementRequestId: 'reimbursement-1', sequenceNo: 1,
        approverRoleSnapshot: 'MANAGER', assignedApproverUserIds: ['actor-1'], status: 'PENDING',
        assignedAt: now, createdAt: now, updatedAt: now,
      }],
    } as any;
    const noteRepo = {
      findRequestById: async () => pending,
      findActiveApproverUserIds: async (_companyId: string, ids: string[]) => new Set(ids),
      findPolicy: async () => null,
      isUserRelatedToRequest: async () => false,
      getUserDisplayNames: async () => ({ 'actor-1': 'Approver' }),
      listSignedClaimFormCopies: async () => [],
      listInternalNotes: async () => [{ id: 'note-1', authorUserId: 'actor-1', body: 'สำหรับทีม', createdAt: now, updatedAt: now }],
      createInternalNote: async (_companyId: string, _requestId: string, authorUserId: string, body: string) =>
        ({ id: 'note-2', authorUserId, body, createdAt: now, updatedAt: now }),
    } as any;
    const useCase = new GetReimbursementDetailUseCase(noteRepo, {
      getAttachmentFileName: async () => undefined,
      getAttachmentFileNames: async () => ({}),
    } as any);
    const notes = new ReimbursementInternalNotesUseCase(noteRepo, { log: async () => undefined } as any);

    const detail = await useCase.execute(ctx({ permissions: [], roles: ['STAFF'] }), pending.id);
    assert.deepEqual(detail.approvalActions, { canApprove: true, canReject: true });
    assert.deepEqual(detail.internalNotes?.map(note => [note.authorName, note.body]), [['Approver', 'สำหรับทีม']]);
    assert.equal((await notes.create(ctx({ permissions: [], roles: ['STAFF'] }), pending.id, 'สำหรับผู้อนุมัติ')).body, 'สำหรับผู้อนุมัติ');

    pending.approvalSteps[0].assignedApproverUserIds = ['someone-else'];
    await assert.rejects(
      useCase.execute(ctx({ permissions: [], roles: ['STAFF'] }), pending.id),
      /Cannot read this reimbursement/,
    );
    await assert.rejects(() => notes.create(ctx({ permissions: [], roles: ['STAFF'] }), pending.id, 'ไม่ควรได้'), /Cannot read this reimbursement/);
  });

  it('lists only related records under the caller branch scope', async () => {
    let received: any;
    const useCase = new ListReimbursementsUseCase({
      findPolicy: async () => null,
      listRequests: async (where: any) => { received = where; return []; },
      findPendingApprovalSteps: async () => [],
      getUserDisplayNames: async () => ({}),
    } as any);
    const result = await useCase.execute(ctx(), { scope: 'related' });
    assert.deepEqual(result.items, []);
    assert.equal(received.relatedUserId, 'actor-1');
    assert.deepEqual(received.scopes, { branchIds: ['branch-1'] });
    assert.equal(received.requesterUserId, undefined);
  });

  it('scopes LINE/AI reimbursement summaries to related records and branches', async () => {
    let received: any;
    const useCase = new GetReimbursementAiSummaryUseCase({
      findPolicy: async () => null,
      listRequests: async (where: any) => { received = where; return []; },
    } as any, { log: async () => undefined } as any);
    await useCase.execute(ctx());
    assert.equal(received.relatedUserId, 'actor-1');
    assert.deepEqual(received.scopes, { branchIds: ['branch-1'] });
  });

  // Item 1 (spec R-A1 row 18, eval: 15 turns): the summary now states its own own/related/company
  // scope, the same classification requesterUserId/relatedUserId above already derive.
  it('reports accessScope alongside the summary: related, own, and company', async () => {
    const repoFor = () => ({ findPolicy: async () => null, listRequests: async () => [] } as any);
    const audit = { log: async () => undefined } as any;
    const related = await new GetReimbursementAiSummaryUseCase(repoFor(), audit).execute(ctx());
    assert.equal(related.accessScope, 'related');
    const own = await new GetReimbursementAiSummaryUseCase(repoFor(), audit)
      .execute(ctx({ permissions: ['reimbursement.read_own'] }));
    assert.equal(own.accessScope, 'own');
    const company = await new GetReimbursementAiSummaryUseCase(repoFor(), audit)
      .execute(ctx({ permissions: ['reimbursement.read', 'reimbursement.read_own'] }));
    assert.equal(company.accessScope, 'company');
  });

  it('pushes branch scope into the finance queue query', async () => {
    let received: any;
    const useCase = new ListFinanceQueueUseCase({
      listRequests: async (where: any) => { received = where; return []; },
    } as any);
    await useCase.execute(ctx({ permissions: ['reimbursement.finance_review'] }));
    assert.deepEqual(received.scopes, { branchIds: ['branch-1'] });
    assert.deepEqual(received.statuses, ['FINANCE_REVIEW', 'READY_FOR_PAYMENT', 'PARTIALLY_PAID']);
  });

  it('covers direct workflow actors, linked expenses and signed-copy linkers', () => {
    const where = reimbursementRelatedToUserWhere('actor-1', ['expense-1'], ['reimbursement-2']);
    const serialized = JSON.stringify(where);
    for (const actorField of [
      'requesterUserId', 'createdByUserId', 'updatedByUserId', 'submittedByUserId',
      'currentApproverUserId', 'financeReviewedByUserId', 'cancellationPendingByUserId',
      'approverUserId', 'decisionByUserId', 'paidByUserId', 'voidedByUserId', 'signedByUserId',
    ]) {
      assert.match(serialized, new RegExp(`"${actorField}":"actor-1"`));
    }
    assert.match(serialized, /"linkedExpenseId":\{"in":\["expense-1"\]\}/);
    assert.match(serialized, /"id":\{"in":\["reimbursement-2"\]\}/);
    assert.match(serialized, /"sourceExpenses"/);
  });

  it('keeps branch and relation OR predicates as separate AND clauses', async () => {
    let capturedWhere: any;
    let capturedExpenseWhere: any;
    const prisma = {
      client: {
        expenseRecord: { findMany: async ({ where }: any) => { capturedExpenseWhere = where; return []; } },
        attachmentLink: { findMany: async () => [] },
        reimbursementRequest: {
          findMany: async ({ where }: any) => { capturedWhere = where; return []; },
        },
      },
    };
    const repo = new PrismaReimbursementRepository(prisma as any, {} as any);
    await repo.listRequests({
      companyId: 'company-1',
      relatedUserId: 'actor-1',
      scopes: { branchIds: ['branch-1'] },
      status: 'DRAFT',
    });
    assert.equal(capturedWhere.companyId, 'company-1');
    assert.equal(capturedWhere.status, 'DRAFT');
    assert.equal(capturedWhere.AND.length, 2);
    assert.deepEqual(capturedWhere.AND[0], {
      OR: [{ branchId: { in: ['branch-1'] } }, { branchId: null }],
    });
    assert.ok(Array.isArray(capturedWhere.AND[1].OR));
    assert.deepEqual(capturedExpenseWhere.AND[0], {
      OR: [{ branchId: { in: ['branch-1'] } }, { branchId: null }],
    });
  });

  // F2 (tuning-6b): rows created in the same instant (seeded data, bulk imports) came back in
  // arbitrary order under a createdAt-only sort, so the LINE approval queue's "1./2." numbering
  // ("ใบที่สอง") could point at a different claim between two asks of the same question.
  it('breaks a createdAt tie with a stable id order, shared by the web approval list', async () => {
    let capturedOrderBy: any;
    const prisma = {
      client: {
        reimbursementRequest: {
          findMany: async ({ orderBy }: any) => { capturedOrderBy = orderBy; return []; },
        },
      },
    };
    const repo = new PrismaReimbursementRepository(prisma as any, {} as any);
    await repo.listRequests({ companyId: 'company-1' });
    assert.deepEqual(capturedOrderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
  });
});
