import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canOpenReimbursementPaymentSlip, isReimbursementClaimApprover, isReimbursementPayoutParty, type RequestContext } from '@watchdog-bms/contracts';
import { CreatePaymentSlipDownloadUrlUseCase } from './reimbursement-payment-slip.use-case';
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
      // The claim waits at the payment desk, so its detail also names who can pay it.
      listPaymentRecorderNames: async () => [],
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
    // Slip writes are the payer's. Opening a slip is decided per claim in the use case, like the detail.
    for (const handler of ['initPaymentSlip', 'completePaymentSlip', 'attachPaymentSlip'] as const) {
      assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype[handler]), ['reimbursement.payment.record']);
    }
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype.paymentSlipDownloadUrl), ['account.session.read']);
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
      listRequestPage: async (where: any) => { received = where; return { rows: [], groups: [] }; },
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

// Owner decision 2026-10-01: a payment slip is opened by the requester, that claim's approver,
// holders of the payment-record right, and holders of the finance-review right. Nobody else.
describe('who may open a payment slip', () => {
  const at = new Date('2026-09-28T03:00:00.000Z');
  const step = (overrides: Record<string, unknown>) => ({
    companyId: 'company-1', reimbursementRequestId: 'reimbursement-1', sequenceNo: 1, status: 'APPROVED',
    approverRoleSnapshot: 'MANAGER', assignedAt: at, createdAt: at, updatedAt: at, requestSnapshotHash: 'h', ...overrides,
  });
  const paidClaim = (overrides: Record<string, unknown> = {}) => ({
    id: 'reimbursement-1', companyId: 'company-1', branchId: 'branch-1',
    requesterUserId: 'requester-1', requesterDisplayNameSnapshot: 'Requester',
    reason: 'ค่าเดินทาง', categoryKey: 'travel', amount: '500.0000', currency: 'THB', incurredDate: at,
    status: 'PAID', financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'PAID', duplicateStatus: 'NO_MATCH',
    receiptRequirementStatus: 'ATTACHED', postingStatus: 'not_required',
    paymentTotalAmount: '500.0000', outstandingAmount: '0.0000', createdByUserId: 'requester-1', createdAt: at, updatedAt: at,
    // The current round: the claim was corrected and sent again on the 26th.
    submittedAt: new Date('2026-09-26T03:00:00.000Z'),
    lines: [], duplicateCandidates: [], claimSignatures: [],
    approvalSteps: [
      // An earlier round, undone by a correction: its approver is no longer this claim's approver.
      step({ id: 'step-0', decisionByUserId: 'earlier-approver', decidedAt: new Date('2026-09-20T03:00:00.000Z'), invalidatedAt: new Date('2026-09-21T03:00:00.000Z') }),
      // Approved, never invalidated, then the claim was corrected and resubmitted to someone else:
      // an approved step stays APPROVED in the history, and only the resubmission date tells it is past.
      step({ id: 'step-0b', decisionByUserId: 'superseded-approver', decidedAt: new Date('2026-09-22T03:00:00.000Z') }),
      step({ id: 'step-1', decisionByUserId: 'approver-1', decidedAt: new Date('2026-09-27T03:00:00.000Z') }),
    ],
    payments: [{ id: 'pay-1', status: 'RECORDED', paidByUserId: 'payer-1', paidAt: at }],
    ...overrides,
  }) as any;

  function harness(claim = paidClaim(), related = true) {
    const audits: any[] = [];
    const minted: any[] = [];
    const lookups: any[] = [];
    const repo = {
      findRequestById: async () => claim,
      findActiveApproverUserIds: async (_companyId: string, ids: string[]) => new Set(ids),
      findPolicy: async () => null,
      isUserRelatedToRequest: async () => related,
      findPaymentSlipFile: async (companyId: string, paymentId: string, attachmentId: string) => {
        lookups.push([companyId, paymentId, attachmentId]);
        return paymentId === 'pay-1' && attachmentId === 'att-slip-1'
          ? { id: 'att-slip-1', bucket: 'private', objectKey: 'evidence/company-1/slip', objectVersionId: 'v1', mimeType: 'image/jpeg', originalFileName: 'slip.jpg' }
          : null;
      },
      // What the claim detail reads beside the claim itself.
      getUserDisplayNames: async () => ({}),
      listSignedClaimFormCopies: async () => [],
      listInternalNotes: async () => [],
      listPaymentSlips: async () => ({ 'pay-1': [{ attachmentId: 'att-slip-1', attachedAt: at }] }),
    } as any;
    const storage = { createDownloadUrl: async (input: any) => { minted.push(input); return { url: 'https://files.example/signed?token=secret', expiresAt: at }; } } as any;
    const useCase = new CreatePaymentSlipDownloadUrlUseCase(repo, storage, { log: async (entry: any) => { audits.push(entry); } } as any);
    const open = (viewer: RequestContext, paymentId = 'pay-1', attachmentId = 'att-slip-1') =>
      useCase.execute(viewer, 'reimbursement-1', paymentId, attachmentId, 'inline');
    /** The claim detail as this viewer gets it: where the web learns whether to offer ดูสลิป. */
    const detail = (viewer: RequestContext) => new GetReimbursementDetailUseCase(repo, {
      getAttachmentFileName: async () => undefined, getAttachmentFileNames: async () => ({}),
    } as any).execute(viewer, 'reimbursement-1');
    return { open, detail, audits, minted, lookups };
  }

  const reader = (userId: string, permissions: string[]) => ctx({ userId, permissions });

  it('opens the slip for the requester, the claim\'s approver, a payment-record holder and a finance reviewer', async () => {
    const viewers: [string, RequestContext][] = [
      ['the requester', reader('requester-1', ['reimbursement.read_own'])],
      ['the approver who decided the claim', reader('approver-1', ['reimbursement.read_related'])],
      ['a holder of the payment-record right', reader('payer-2', ['reimbursement.read', 'reimbursement.payment.record'])],
      // Owner answer 2026-10-01 to the spec's open question: a finance reviewer who cannot pay may still open it.
      ['a finance reviewer without the pay right', reader('accountant-1', ['reimbursement.read', 'reimbursement.finance_review'])],
    ];
    for (const [label, viewer] of viewers) {
      const h = harness();
      const result = await h.open(viewer);
      assert.equal(result.downloadUrl, 'https://files.example/signed?token=secret', label);
      assert.deepEqual(h.minted, [{ bucket: 'private', objectKey: 'evidence/company-1/slip', objectVersionId: 'v1', mimeType: 'image/jpeg', fileName: 'slip.jpg', disposition: 'inline' }], label);
      // Every opening is on the audit trail, with ids only: no URL, storage key or file name.
      assert.deepEqual(h.audits.map((entry) => [entry.action, entry.result, entry.actorUserId, entry.targetId, entry.metadataJson]), [
        ['reimbursement.payment.slip.open', 'SUCCESS', viewer.userId, 'pay-1', { requestId: 'reimbursement-1', slipAttachmentId: 'att-slip-1' }],
      ], label);
      assert.doesNotMatch(JSON.stringify(h.audits), /https?:|token|evidence\/|slip\.jpg/, label);
    }
  });

  it('refuses everyone else who can read the claim, and mints no URL for them', async () => {
    const refused: [string, RequestContext][] = [
      ['an ordinary reader such as an auditor', reader('auditor-1', ['reimbursement.read', 'reimbursement.export'])],
      ['an approval-permission holder this claim was never routed to', reader('manager-2', ['reimbursement.read', 'reimbursement.approve', 'reimbursement.reject'])],
      ['the approver of a round a correction undid', reader('earlier-approver', ['reimbursement.read'])],
      ['the approver of a round the claim was resubmitted after', reader('superseded-approver', ['reimbursement.read'])],
      ['a related reader who only attached a signed copy', reader('clerk-1', ['reimbursement.read_related'])],
      ['the payer of record once the pay right is gone', reader('payer-1', ['reimbursement.read'])],
    ];
    for (const [label, viewer] of refused) {
      const h = harness();
      await assert.rejects(() => h.open(viewer), (error: any) => error.getStatus() === 403 && error.message === 'payment_slip_access_denied', label);
      assert.deepEqual(h.minted, [], label);
      assert.deepEqual(h.lookups, [], `${label}: the file is not even looked up`);
      assert.deepEqual(h.audits.map((entry) => [entry.result, entry.riskLevel]), [['DENIED', 'HIGH']], label);
    }
  });

  // The web offers ดูสลิป from the detail's verdict alone. For every reader of the claim that verdict
  // and the endpoint's answer must be the same, in both directions: no button that is refused, and
  // no reader the endpoint would serve left without the button.
  it('tells each viewer in the claim detail exactly what the slip endpoint will answer them', async () => {
    const viewers: [string, RequestContext][] = [
      ['requester', reader('requester-1', ['reimbursement.read_own'])],
      ['claim approver', reader('approver-1', ['reimbursement.read_related'])],
      ['payment-record holder', reader('payer-2', ['reimbursement.read', 'reimbursement.payment.record'])],
      ['finance reviewer without the pay right', reader('accountant-1', ['reimbursement.read', 'reimbursement.finance_review'])],
      ['auditor', reader('auditor-1', ['reimbursement.read', 'reimbursement.export'])],
      ['approval-right holder off this claim', reader('manager-2', ['reimbursement.read', 'reimbursement.approve', 'reimbursement.reject'])],
      ['approver of an undone round', reader('earlier-approver', ['reimbursement.read'])],
      ['approver of a superseded round', reader('superseded-approver', ['reimbursement.read'])],
      ['related reader', reader('clerk-1', ['reimbursement.read_related'])],
      ['void-right holder who cannot record', reader('voider-1', ['reimbursement.read', 'reimbursement.payment.void'])],
    ];
    const verdicts: Record<string, boolean> = {};
    for (const [label, viewer] of viewers) {
      const h = harness();
      const detail = await h.detail(viewer);
      const told = detail.payments[0]!.viewerCanOpenSlips;
      assert.equal(typeof told, 'boolean', `${label}: the detail always answers`);
      // Everyone who reads the claim sees that a slip exists. Which file it is goes only to someone
      // who may open it: a reader the endpoint refuses is not handed the file id either.
      assert.equal(detail.payments[0]!.slipCount, 1, label);
      assert.deepEqual(detail.payments[0]!.slips, told ? [{ attachmentId: 'att-slip-1', attachedAt: at.toISOString() }] : [], label);
      if (!told) assert.doesNotMatch(JSON.stringify(detail), /att-slip-1/, `${label}: the slip's id is nowhere in the detail`);
      const served = await h.open(viewer).then(() => true, (error: any) => {
        assert.equal(error.message, 'payment_slip_access_denied', label);
        return false;
      });
      assert.equal(told, served, `${label}: the button and the endpoint agree`);
      verdicts[label] = served;
    }
    assert.deepEqual(verdicts, {
      requester: true, 'claim approver': true, 'payment-record holder': true, 'finance reviewer without the pay right': true,
      auditor: false, 'approval-right holder off this claim': false, 'approver of an undone round': false,
      'approver of a superseded round': false, 'related reader': false, 'void-right holder who cannot record': false,
    });

    // A frozen assignee of a pending step, with no permission left: the detail and the endpoint agree there too.
    const pending = paidClaim({
      status: 'PENDING_APPROVAL', paymentStatus: 'UNPAID', currentApprovalStepId: 'step-2',
      approvalSteps: [step({ id: 'step-2', status: 'PENDING', assignedApproverUserIds: ['assignee-1'] })],
      payments: [{ id: 'pay-1', status: 'VOIDED', paidByUserId: 'payer-1', paidAt: at }],
    });
    const assigned = harness(pending, false);
    assert.equal((await assigned.detail(reader('assignee-1', []))).payments[0]!.viewerCanOpenSlips, true);
    assert.ok((await assigned.open(reader('assignee-1', []))).downloadUrl);
  });

  it('keeps the claim\'s own read gate in front: another branch, or no way to read the claim at all', async () => {
    const outsideBranch = harness();
    await assert.rejects(
      () => outsideBranch.open(ctx({ userId: 'payer-2', permissions: ['reimbursement.read', 'reimbursement.payment.record'], scopes: { branchIds: ['branch-2'] } })),
      /outside your assigned branch scope/,
    );
    const unrelated = harness(paidClaim(), false);
    await assert.rejects(
      () => unrelated.open(reader('accountant-1', ['reimbursement.read_related', 'reimbursement.finance_review'])),
      /Cannot read this reimbursement/,
    );
    const requesterWithoutRead = harness(paidClaim(), false);
    await assert.rejects(() => requesterWithoutRead.open(reader('requester-1', [])), /Cannot read this reimbursement/);
    for (const h of [outsideBranch, unrelated, requesterWithoutRead]) assert.deepEqual(h.minted, []);
  });

  it('counts whoever may decide the pending step as the claim\'s approver, by assignment and not by role', async () => {
    // A claim waiting on approval that already carries a voided payment's slip.
    const pending = paidClaim({
      status: 'PENDING_APPROVAL', paymentStatus: 'UNPAID', currentApprovalStepId: 'step-2',
      approvalSteps: [step({ id: 'step-2', status: 'PENDING', assignedApproverUserIds: ['assignee-1'] })],
      payments: [{ id: 'pay-1', status: 'VOIDED', paidByUserId: 'payer-1', paidAt: at }],
    });
    const assigned = harness(pending, false);
    assert.ok((await assigned.open(reader('assignee-1', []))).downloadUrl);
    const sameRole = harness(pending, true);
    await assert.rejects(() => sameRole.open(ctx({ userId: 'manager-2', roles: ['MANAGER'], permissions: ['reimbursement.read', 'reimbursement.approve'] })), /payment_slip_access_denied/);
  });

  it('opens only a slip that is on that payment of that claim', async () => {
    const payer = reader('payer-2', ['reimbursement.read', 'reimbursement.payment.record']);
    const h = harness();
    await assert.rejects(() => h.open(payer, 'pay-1', 'att-receipt'), (error: any) => error.getStatus() === 404);
    await assert.rejects(() => h.open(payer, 'pay-of-another-claim', 'att-slip-1'), (error: any) => error.getStatus() === 404);
    assert.deepEqual(h.lookups, [['company-1', 'pay-1', 'att-receipt']], 'a payment of another claim is refused without a lookup');
    assert.deepEqual(h.minted, []);
  });

  it('is one rule: the payout parties, and finance reviewers for the slip only', () => {
    const claim = paidClaim();
    const viewer = (userId: string, permissions: string[]) => ({ userId, permissions });
    for (const [who, party, slip] of [
      [viewer('requester-1', []), true, true],
      [viewer('approver-1', []), true, true],
      [viewer('payer-2', ['reimbursement.payment.record']), true, true],
      [viewer('accountant-1', ['reimbursement.finance_review']), false, true],
      [viewer('earlier-approver', []), false, false],
      [viewer('superseded-approver', []), false, false],
      [viewer('manager-2', ['reimbursement.approve', 'reimbursement.read']), false, false],
      [viewer('', ['reimbursement.read']), false, false],
    ] as const) {
      assert.equal(isReimbursementPayoutParty(who, claim), party, JSON.stringify(who));
      assert.equal(canOpenReimbursementPaymentSlip(who, claim), slip, JSON.stringify(who));
    }
    // The web detail carries the same facts as ISO strings and gets the same answers.
    const detail = { requesterUserId: 'requester-1', submittedAt: claim.submittedAt.toISOString(), approvalSteps: claim.approvalSteps.map((row: any) => ({
      status: row.status, decisionByUserId: row.decisionByUserId, decidedAt: row.decidedAt?.toISOString(), invalidatedAt: row.invalidatedAt?.toISOString(),
    })) };
    assert.equal(canOpenReimbursementPaymentSlip(viewer('approver-1', []), detail), true);
    assert.equal(canOpenReimbursementPaymentSlip(viewer('earlier-approver', []), detail), false);
    assert.equal(canOpenReimbursementPaymentSlip(viewer('superseded-approver', []), detail), false);
    assert.equal(canOpenReimbursementPaymentSlip(viewer('assignee-1', []), { ...detail, approvalActions: { canApprove: true, canReject: false } }), true);
  });

  // An approved step is never invalidated when the claim is corrected and sent again: only PENDING
  // steps are. So "the latest approval still in force" kept naming the earlier approver. The round
  // the claim is in starts at its current submission, and only an approval made in it counts.
  it('counts an approval only in the round the claim is in: resubmitted, its earlier approver is out', () => {
    const viewer = (userId: string) => ({ userId, permissions: [] });
    const approved = (userId: string, decidedAt: string) => ({ status: 'APPROVED', decisionByUserId: userId, decidedAt, invalidatedAt: null });
    const first = { requesterUserId: 'requester-1', submittedAt: '2026-09-20T02:00:00.000Z', approvalSteps: [approved('approver-a', '2026-09-20T05:00:00.000Z')] };
    assert.equal(isReimbursementClaimApprover('approver-a', first), true);
    assert.equal(isReimbursementPayoutParty(viewer('approver-a'), first), true);

    // Corrected and sent again on the 25th, to somebody else, who has not decided yet.
    const resubmitted = { ...first, submittedAt: '2026-09-25T02:00:00.000Z' };
    assert.equal(isReimbursementClaimApprover('approver-a', resubmitted), false);
    assert.equal(isReimbursementPayoutParty(viewer('approver-a'), resubmitted), false);
    assert.equal(canOpenReimbursementPaymentSlip(viewer('approver-a'), resubmitted), false);

    // The new approver decides: theirs counts, the earlier one still does not.
    const reapproved = { ...resubmitted, approvalSteps: [...first.approvalSteps, approved('approver-b', '2026-09-25T06:00:00.000Z')] };
    assert.deepEqual(['approver-a', 'approver-b'].map((userId) => isReimbursementClaimApprover(userId, reapproved)), [false, true]);
    // Decided at the very instant of the submission still belongs to that round.
    assert.equal(isReimbursementClaimApprover('approver-b', { ...reapproved, submittedAt: '2026-09-25T06:00:00.000Z' }), true);

    // Back with the requester for a correction (no submission in force): nobody is its approver by a past decision.
    for (const submittedAt of [null, undefined]) {
      assert.equal(isReimbursementClaimApprover('approver-b', { ...reapproved, submittedAt }), false);
      assert.equal(isReimbursementPayoutParty(viewer('approver-b'), { ...reapproved, submittedAt }), false);
      // The requester, and whoever may decide the step it waits on, never depended on a past decision.
      assert.equal(isReimbursementPayoutParty(viewer('requester-1'), { ...reapproved, submittedAt }), true);
      assert.equal(isReimbursementPayoutParty(viewer('approver-c'), { ...reapproved, submittedAt, approvalActions: { canApprove: true, canReject: true } }), true);
    }
  });
});
