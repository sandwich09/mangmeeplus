/**
 * Audit H-2: branch ABAC was enforced on the reimbursement queues but not on the writes.
 *
 * The queues read through `listRequests`, which folds in `branchScopeWhere`, so a branch-restricted
 * user never sees another branch's claim in a list and the module looks enforced from the outside.
 * Every write below takes an id, though, and an id needs no list to guess — finance could pay,
 * reverse a posted journal, export the whole claim, or edit the amount of a draft belonging to a
 * branch they cannot see.
 *
 * Each case asserts the refusal at the exact use case, because that is the only layer that has both
 * the caller's scope and the record's branch. The coverage guard at the bottom is what stops the
 * next use case from being added without one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import { requireTransactionBranchId } from '../../../data-model-core/application/services/transaction-branch';
import {
  ExportReimbursementEvidenceUseCase,
  FinanceReviewReimbursementUseCase,
  ListUnpostedReimbursementPaymentsUseCase,
  RecordReimbursementPaymentUseCase,
  VoidReimbursementPaymentUseCase,
} from './reimbursement-finance.use-case';
import {
  CancelReimbursementUseCase,
  CreateReimbursementDraftUseCase,
  GetReimbursementDetailUseCase,
  ReimbursementInternalNotesUseCase,
  ReopenRejectedReimbursementUseCase,
  ResumeReimbursementUseCase,
  SubmitReimbursementUseCase,
  UpdateReimbursementDraftUseCase,
  WithdrawReimbursementCancellationUseCase,
} from './reimbursement-request.use-case';
import { ApproveReimbursementUseCase, RejectReimbursementUseCase } from './reimbursement-approval.use-case';
import { RequestPayoutCorrectionUseCase, SubmitPayoutCorrectionUseCase } from './reimbursement-payout-correction.use-case';
import {
  AttachPaymentSlipUseCase,
  CompletePaymentSlipUploadUseCase,
  CreatePaymentSlipDownloadUrlUseCase,
  InitPaymentSlipUploadUseCase,
} from './reimbursement-payment-slip.use-case';
import {
  CompleteClaimSignatureUploadUseCase,
  InitClaimSignatureUploadUseCase,
  LinkSignedClaimFormCopyUseCase,
  SignClaimFormUseCase,
} from './reimbursement-claim-signature.use-case';
import { PreviewReimbursementClaimFormUseCase } from './reimbursement-claim-form.use-case';

// Evidence fake for detailWithFileNames — decision endpoints now return the same hydrated
// detail as a GET (names + file names), so their specs feed the assembler harmless lookups.
const fakeDetailEvidence = { getAttachmentFileName: async () => undefined, getAttachmentFileNames: async () => ({}) };

const audit = { log: async () => undefined } as any;
const outbox = { append: async () => undefined } as any;
const sequence = { execute: async () => ({ id: 'seq-1', documentNumber: 'RBPAY-202601-000001' }) } as any;
const projections = { execute: async () => undefined } as any;
const evidence = { validate: async () => undefined } as any;
const noPayouts = {} as any;
const voidExpense = { executeForReimbursement: async () => undefined } as any;
const approverRoutes = { resolveSubmissionRoute: async () => assert.fail('branch guard must run before routing') } as any;

/** Restricted to branch-1. The claim in every case below lives in branch-2. */
function scopedTo(branchIds: string[], permissions: string[]) {
  return {
    requestId: 'req-1', authSubject: 's', userId: 'fin-1', companyId: 'co-1', membershipId: 'm',
    roles: ['FINANCE'], permissions, scopes: { branchIds }, authProvider: 'dev',
  } as any;
}

function otherBranchClaim(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rb-1', companyId: 'co-1', branchId: 'branch-2', requestNo: 'RB-202601-000001',
    requesterUserId: 'staff-9', requesterDisplayNameSnapshot: 'พนักงานสาขาอื่น',
    status: 'READY_FOR_PAYMENT', financeReviewStatus: 'APPROVED_FOR_PAYMENT', paymentStatus: 'UNPAID',
    amount: '500.0000', outstandingAmount: '500.0000', currency: 'THB', categoryKey: 'travel',
    incurredDate: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    lines: [], payments: [], approvalSteps: [], duplicateCandidates: [],
    ...overrides,
  } as any;
}

/** Throws on anything a refused call should never reach. */
function repoFor(claim: any) {
  return new Proxy({
    findRequestById: async () => claim,
    findPaymentById: async () => ({ id: 'pay-1', reimbursementRequestId: 'rb-1', status: 'RECORDED' }),
    listSignedClaimFormCopies: async () => [],
  } as Record<string, unknown>, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return async () => assert.fail(`refused call still reached repo.${prop}`);
    },
  }) as any;
}

const WRITES = [
  {
    name: 'record a payment',
    permissions: ['reimbursement.payment.record'],
    claim: otherBranchClaim(),
    run: (repo: any, ctx: any) => new RecordReimbursementPaymentUseCase(repo, audit, sequence, sequence, fakeDetailEvidence as any)
      .execute(ctx, 'rb-1', {
        paidAmount: '500.00', paymentMethod: 'TRANSFER', paidAt: '2026-01-02T00:00:00.000Z',
      } as any),
  },
  {
    name: 'void a payment and its ledger reversal',
    permissions: ['reimbursement.payment.void'],
    claim: otherBranchClaim(),
    run: (repo: any, ctx: any) => new VoidReimbursementPaymentUseCase(repo, fakeDetailEvidence as any)
      .execute(ctx, 'rb-1', 'pay-1', { reason: 'จ่ายผิด' } as any),
  },
  {
    name: 'export the whole claim as evidence',
    permissions: ['reimbursement.export'],
    claim: otherBranchClaim(),
    run: (repo: any, ctx: any) => new ExportReimbursementEvidenceUseCase(repo, audit).execute(ctx, 'rb-1'),
  },
  {
    name: 'finance-review a claim',
    permissions: ['reimbursement.finance_review'],
    claim: otherBranchClaim({ status: 'FINANCE_REVIEW' }),
    run: (repo: any, ctx: any) => new FinanceReviewReimbursementUseCase(repo, audit, projections, fakeDetailEvidence as any, { executeForReimbursement: async () => 0 } as any)
      .execute(ctx, 'rb-1', { decision: 'APPROVED_FOR_PAYMENT' } as any),
  },
  {
    name: 'edit the amount of a draft',
    permissions: ['reimbursement.finance_review'],
    claim: otherBranchClaim({ status: 'DRAFT' }),
    run: (repo: any, ctx: any) => new UpdateReimbursementDraftUseCase(repo, audit, evidence, noPayouts)
      .execute(ctx, 'rb-1', { reason: 'แก้ไข' } as any),
  },
  {
    name: 'submit a draft into another branch approval chain',
    permissions: ['reimbursement.submit', 'reimbursement.finance_review'],
    claim: otherBranchClaim({ status: 'DRAFT' }),
    run: (repo: any, ctx: any) => new SubmitReimbursementUseCase(repo, audit, outbox, evidence, approverRoutes, projections).execute(ctx, 'rb-1'),
  },
  {
    name: 'cancel a claim',
    permissions: ['reimbursement.finance_review'],
    claim: otherBranchClaim({ status: 'DRAFT' }),
    run: (repo: any, ctx: any) => new CancelReimbursementUseCase(repo, audit, voidExpense).execute(ctx, 'rb-1', 'ยกเลิก'),
  },
];

it('refuses a new payout without the saved claim branch before reserving a number or writing', async () => {
  const payment = WRITES[0]!;
  const ctx = { ...scopedTo(['branch-1'], payment.permissions), scopes: {} };
  await assert.rejects(() => payment.run(repoFor(otherBranchClaim({ branchId: null })), ctx),
    (error: any) => error.getStatus() === 422 && error.getResponse().code === 'TRANSACTION_BRANCH_REQUIRED');
});

/**
 * Final review item 18. On several endpoints the branch check sat after answers that depend on the claim: to
 * a caller the claim detail refuses, approve said "Cannot approve from status READY_FOR_PAYMENT" or
 * `payout_correction_in_progress`, cancel and the finance review said which status they could not act from,
 * and the withdraw and the resume each had two refusals that told two states of the claim apart.
 *
 * Every endpoint that decides something on a claim now asks what the detail asks before anything else about
 * the claim, so whoever cannot open the claim gets the detail's own answer wherever the claim stands. The
 * routes that take another id beside the claim's (a payment, a slip, an uploaded file, a note) are held to
 * the same here: the answer does not say whether that id exists. The payer's endpoints keep the rule they
 * had, the pay right and the branch ahead of everything about the claim (`payer` below).
 */
describe('a caller the claim detail refuses gets that same answer from every endpoint, wherever the claim stands', () => {
  const never = (name: string) => new Proxy({}, { get: (_target, prop: string) => () => assert.fail(`refused call still reached ${name}.${prop}`) }) as any;
  const at = (iso: string) => new Date(iso);
  const step = (overrides: Record<string, unknown> = {}) => ({
    id: 'step-1', companyId: 'co-1', reimbursementRequestId: 'rb-1', sequenceNo: 1, status: 'PENDING',
    assignedApproverUserIds: ['mgr-1'], approverRoleSnapshot: 'MANAGER', assignedAt: at('2026-01-01T01:00:00.000Z'), ...overrides,
  });
  const approvedStep = step({ status: 'APPROVED', decisionByUserId: 'mgr-1', decidedAt: at('2026-01-02T01:00:00.000Z') });
  const setAside = { invalidatedAt: at('2026-01-04T01:00:00.000Z'), invalidatedReason: 'payout_account_correction' };
  const payment = (status: string) => ({ id: 'pay-1', companyId: 'co-1', reimbursementRequestId: 'rb-1', status, paidAmount: '500.0000', currency: 'THB', paymentMethod: 'CASH', paidAt: at('2026-01-03T01:00:00.000Z'), idempotencyKey: 'k-1' });
  /** Where a claim can stand. Every answer that used to differ between two of these was an answer about the claim. */
  const STATES: Record<string, Record<string, unknown>> = {
    'a draft': { status: 'DRAFT', paymentStatus: 'NOT_PAYABLE' },
    'waiting for approval': { status: 'PENDING_APPROVAL', submittedAt: at('2026-01-01T01:00:00.000Z'), currentApprovalStepId: 'step-1', approvalSteps: [step()] },
    'approved, waiting for the system': { status: 'PENDING_APPROVAL', submittedAt: at('2026-01-01T01:00:00.000Z'), currentApprovalStepId: 'step-1', approvalSteps: [approvedStep] },
    'sent back for its payout account': {
      status: 'PENDING_APPROVAL', submittedAt: at('2026-01-01T01:00:00.000Z'), payoutCorrectionRequestedAt: at('2026-01-04T01:00:00.000Z'), approvalSteps: [{ ...approvedStep, ...setAside }],
    },
    'waiting for approval of a new account': {
      status: 'PENDING_APPROVAL', submittedAt: at('2026-01-01T01:00:00.000Z'), payoutCorrectionRequestedAt: at('2026-01-04T01:00:00.000Z'),
      payoutCorrectionSubmittedAt: at('2026-01-05T01:00:00.000Z'), currentApprovalStepId: 'step-2',
      approvalSteps: [{ ...approvedStep, ...setAside }, step({ id: 'step-2', sequenceNo: 2 })],
    },
    'in finance review': { status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING' },
    'ready for payment': { status: 'READY_FOR_PAYMENT' },
    'being cancelled': { status: 'READY_FOR_PAYMENT', cancellationPendingAt: at('2026-01-06T01:00:00.000Z'), cancellationPendingReason: 'ยกเลิกคำขอเบิกค่าใช้จ่าย', cancellationPendingByUserId: 'staff-9' },
    paid: { status: 'PAID', paymentStatus: 'PAID', outstandingAmount: '0.0000', payments: [payment('RECORDED')] },
    'paid, then voided': { status: 'READY_FOR_PAYMENT', payments: [payment('VOIDED')] },
    rejected: { status: 'REJECTED', paymentStatus: 'NOT_PAYABLE' },
    cancelled: { status: 'CANCELLED', paymentStatus: 'NOT_PAYABLE' },
  };

  /** The claim, the lookups the detail's own gate makes, and nothing else: a refused call reads no further. */
  function gatedRepo(claim: any) {
    return new Proxy({
      findRequestById: async () => claim,
      findActiveApproverUserIds: async (_companyId: string, userIds: string[]) => new Set(userIds),
      findPolicy: async () => null,
      isUserRelatedToRequest: async () => false,
    } as Record<string, unknown>, {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        return async () => assert.fail(`refused call still reached repo.${prop}`);
      },
    }) as any;
  }

  const ACTIONS = [
    'reimbursement.approve', 'reimbursement.reject', 'reimbursement.finance_review', 'reimbursement.duplicate.resolve',
    'reimbursement.payment.record', 'reimbursement.payment.void', 'reimbursement.cancel_own', 'reimbursement.update_own_draft', 'reimbursement.submit',
  ];
  // Neither is the claim's requester (staff-9) or the approver its step names (mgr-1).
  const READERS: Record<string, any> = {
    // Holds every right, the three read rights included, and is restricted to another branch.
    'from another branch': scopedTo(['branch-1'], [...ACTIONS, 'reimbursement.read', 'reimbursement.read_own', 'reimbursement.read_related']),
    // Holds the claim's branch and every right to act on a claim, and no right to read this one.
    'with no right to read the claim': scopedTo(['branch-2'], ACTIONS),
  };

  const slipFile = { originalFileName: 'slip.png', mimeType: 'image/png', byteSize: 10 };
  /**
   * `payer`: an endpoint of whoever records the payment. Its rule is the pay (or void) right and the claim's
   * branch, both asked before anything about the claim, and the claim page names exactly the members that rule
   * takes (owner rule 2026-10-01, spec §18.3; "claim detail paymentDesk" pins both directions). A caller of
   * another branch gets the detail's answer from it like from every other endpoint; a caller of the claim's
   * branch who holds that right is someone the claim waits for, whatever their read rights, and is not held to
   * the detail's gate here. Asking a read right of them as well would change who can pay.
   */
  const ENDPOINTS: Array<{ family: string; name: string; payer?: true; run: (repo: any, ctx: any) => Promise<unknown> }> = [
    { family: 'approval', name: 'approve', run: (repo, ctx) => new ApproveReimbursementUseCase(repo, audit, never('projections'), fakeDetailEvidence as any).execute(ctx, 'rb-1', undefined, 'hash-1', 1) },
    { family: 'approval', name: 'reject', run: (repo, ctx) => new RejectReimbursementUseCase(repo, audit, fakeDetailEvidence as any).execute(ctx, 'rb-1', 'เอกสารไม่ครบถ้วน') },
    { family: 'approval', name: 'resume a decision', run: (repo, ctx) => new ResumeReimbursementUseCase(repo, audit, never('reconciler'), fakeDetailEvidence as any).execute(ctx, 'rb-1') },
    { family: 'payout account correction', name: 'send back for the payout account', run: (repo, ctx) => new RequestPayoutCorrectionUseCase(repo, audit, fakeDetailEvidence as any).execute(ctx, 'rb-1', { reasonCode: 'ACCOUNT_NUMBER_WRONG' }) },
    { family: 'payout account correction', name: 'give the payout account', run: (repo, ctx) => new SubmitPayoutCorrectionUseCase(repo, audit, fakeDetailEvidence as any, never('payouts'), never('approverRoutes')).execute(ctx, 'rb-1', { mode: 'CASH' } as any) },
    { family: 'cancellation', name: 'cancel', run: (repo, ctx) => new CancelReimbursementUseCase(repo, audit, never('voidExpense')).execute(ctx, 'rb-1', 'ยกเลิกคำขอเบิกค่าใช้จ่าย') },
    { family: 'cancellation', name: 'withdraw a cancellation', run: (repo, ctx) => new WithdrawReimbursementCancellationUseCase(repo, audit).execute(ctx, 'rb-1') },
    { family: 'cancellation', name: 'withdraw or reopen as a draft', run: (repo, ctx) => new ReopenRejectedReimbursementUseCase(repo, audit).execute(ctx, 'rb-1') },
    { family: 'finance review', name: 'decide a finance review', run: (repo, ctx) => new FinanceReviewReimbursementUseCase(repo, audit, never('projections'), fakeDetailEvidence as any, { executeForReimbursement: async () => 0 } as any).execute(ctx, 'rb-1', { decision: 'APPROVED_FOR_PAYMENT' } as any) },
    { family: 'payment', name: 'clear a duplicate block at the payment step', payer: true, run: (repo, ctx) => new FinanceReviewReimbursementUseCase(repo, audit, never('projections'), fakeDetailEvidence as any, { executeForReimbursement: async () => 0 } as any).execute(ctx, 'rb-1', { resolveDuplicate: true, duplicateResolutionReason: 'คนละรายการ' } as any) },
    { family: 'payment', name: 'record a payment', payer: true, run: (repo, ctx) => new RecordReimbursementPaymentUseCase(repo, audit, never('reserve'), never('commit'), fakeDetailEvidence as any).execute(ctx, 'rb-1', { paidAmount: '500.0000', paymentMethod: 'CASH', paidAt: '2026-01-07T00:00:00.000Z' } as any) },
    ...['pay-1', 'pay-unknown'].map((paymentId) => ({
      family: 'payment', name: `void payment ${paymentId}`, payer: true as const,
      run: (repo: any, ctx: any) => new VoidReimbursementPaymentUseCase(repo, fakeDetailEvidence as any).execute(ctx, 'rb-1', paymentId, { reason: 'บันทึกผิดรายการ' } as any),
    })),
    { family: 'payment slip', name: 'start a slip upload', payer: true, run: (repo, ctx) => new InitPaymentSlipUploadUseCase(repo, never('createUpload')).execute(ctx, 'rb-1', slipFile) },
    { family: 'payment slip', name: 'complete a slip upload', payer: true, run: (repo, ctx) => new CompletePaymentSlipUploadUseCase(repo, never('completeUpload')).execute(ctx, 'rb-1', 'att-unknown', {}) },
    ...['pay-1', 'pay-unknown'].map((paymentId) => ({
      family: 'payment slip', name: `attach a slip to payment ${paymentId}`, payer: true as const,
      run: (repo: any, ctx: any) => new AttachPaymentSlipUseCase(repo, audit, fakeDetailEvidence as any).execute(ctx, 'rb-1', paymentId, { attachmentId: 'att-unknown' } as any),
    })),
    ...['pay-1', 'pay-unknown'].map((paymentId) => ({
      family: 'payment slip', name: `open a slip of payment ${paymentId}`,
      run: (repo: any, ctx: any) => new CreatePaymentSlipDownloadUrlUseCase(repo, never('storage'), audit).execute(ctx, 'rb-1', paymentId, 'att-unknown'),
    })),
    { family: 'claim form', name: 'print the claim form', run: (repo, ctx) => new PreviewReimbursementClaimFormUseCase(repo, never('storage'), audit, never('config')).execute(ctx, 'rb-1') },
    { family: 'claim form', name: 'start a signature upload', run: (repo, ctx) => new InitClaimSignatureUploadUseCase(repo, never('createUpload')).execute(ctx, 'rb-1', { role: 'APPROVER', ...slipFile }) },
    { family: 'claim form', name: 'complete a signature upload', run: (repo, ctx) => new CompleteClaimSignatureUploadUseCase(repo, never('completeUpload')).execute(ctx, 'rb-1', 'att-unknown', { role: 'APPROVER' }) },
    { family: 'claim form', name: 'sign the claim form', run: (repo, ctx) => new SignClaimFormUseCase(repo, never('storage'), audit).execute(ctx, 'rb-1', { role: 'APPROVER', snapshotHash: 'hash-1', signatureAttachmentId: 'att-unknown' } as any) },
    { family: 'claim form', name: 'attach a signed copy', run: (repo, ctx) => new LinkSignedClaimFormCopyUseCase(repo, never('attachments'), audit).execute(ctx, 'rb-1', { attachmentId: 'att-unknown' } as any) },
    { family: 'internal notes', name: 'add a note', run: (repo, ctx) => new ReimbursementInternalNotesUseCase(repo, audit).create(ctx, 'rb-1', 'บันทึก') },
    { family: 'internal notes', name: 'edit a note', run: (repo, ctx) => new ReimbursementInternalNotesUseCase(repo, audit).update(ctx, 'rb-1', 'note-unknown', 'บันทึก') },
    { family: 'internal notes', name: 'delete a note', run: (repo, ctx) => new ReimbursementInternalNotesUseCase(repo, audit).delete(ctx, 'rb-1', 'note-unknown') },
  ];

  const answer = (run: () => Promise<unknown>) => run().then(() => 'answered with the claim', (error: any) => (
    typeof error?.getStatus === 'function' ? `${error.getStatus()} ${error.message}` : `threw ${String(error?.message ?? error)}`
  ));

  for (const [who, ctx] of Object.entries(READERS)) {
    describe(`a caller ${who}`, () => {
      it('is refused the claim detail with one answer, wherever the claim stands', async () => {
        const answers = new Set<string>();
        for (const state of Object.values(STATES)) {
          answers.add(await answer(() => new GetReimbursementDetailUseCase(gatedRepo(otherBranchClaim(state)), fakeDetailEvidence as any).execute(ctx, 'rb-1')));
        }
        assert.deepEqual([...answers], [who === 'from another branch' ? '403 Branch is outside your assigned branch scope.' : '403 Cannot read this reimbursement']);
      });

      for (const endpoint of ENDPOINTS) {
        if (endpoint.payer && who !== 'from another branch') continue;
        it(`${endpoint.family}: "${endpoint.name}" answers what the detail answers`, async () => {
          const differing: string[] = [];
          for (const [name, state] of Object.entries(STATES)) {
            const claim = otherBranchClaim(state);
            const expected = await answer(() => new GetReimbursementDetailUseCase(gatedRepo(claim), fakeDetailEvidence as any).execute(ctx, 'rb-1'));
            const actual = await answer(() => endpoint.run(gatedRepo(claim), ctx));
            if (actual !== expected) differing.push(`${name}: ${actual}`);
          }
          assert.deepEqual(differing, []);
        });
      }
    });
  }

  // Control: the gate lets through whoever can open the claim, so the cases above are not satisfied by
  // endpoints that refuse everyone. The reader's own branch and the read right: past the gate, each
  // endpoint goes on to its own rules, and none of them answers "cannot read" or "outside your branch".
  it('lets a caller who can open the claim through to each endpoint\'s own rules', async () => {
    const reader = scopedTo(['branch-2'], [...ACTIONS, 'reimbursement.read']);
    const open = (claim: any) => new Proxy({
      findRequestById: async () => claim,
      findActiveApproverUserIds: async (_companyId: string, userIds: string[]) => new Set(userIds),
      findPolicy: async () => null,
    } as Record<string, unknown>, { get: (target, prop: string) => (prop in target ? target[prop] : async () => { throw new Error(`past the gate: repo.${prop}`); }) }) as any;
    for (const endpoint of ENDPOINTS) {
      for (const state of Object.values(STATES)) {
        const actual = await answer(() => endpoint.run(open(otherBranchClaim(state)), reader));
        assert.doesNotMatch(actual, /Cannot read this reimbursement|outside your assigned branch scope/, `${endpoint.name}: ${actual}`);
      }
    }
  });
});

describe('reimbursement branch ABAC (audit H-2)', () => {
  for (const write of WRITES) {
    it(`refuses to ${write.name} in a branch outside the caller's scope`, async () => {
      await assert.rejects(
        () => write.run(repoFor(write.claim), scopedTo(['branch-1'], write.permissions)),
        (error: unknown) => {
          assert.ok(error instanceof ForbiddenException, `${write.name} threw ${String(error)}`);
          assert.match((error as Error).message, /outside your assigned branch scope/);
          return true;
        },
      );
    });

    // Control: the same call past the branch gate when branch-2 is in scope. It may still fail
    // further in on a stub the refused path never reaches — what it must not do is fail on branch,
    // otherwise the assertion above would be satisfied by an endpoint that refuses everyone.
    it(`stops refusing on branch once branch-2 is in scope: ${write.name}`, async () => {
      await write
        .run(repoFor(write.claim), scopedTo(['branch-1', 'branch-2'], write.permissions))
        .catch((error: unknown) => {
          assert.doesNotMatch(String((error as Error).message), /outside your assigned branch scope/);
        });
    });
  }

  describe('creating a claim', () => {
    it('refuses a branch the requester cannot see', async () => {
      await assert.rejects(
        () => new CreateReimbursementDraftUseCase(repoFor(null), audit, evidence, noPayouts).execute(
          scopedTo(['branch-1'], ['reimbursement.create']),
          { branchId: 'branch-2', reason: 'ไปพบลูกค้า', lines: [] } as any,
        ),
        ForbiddenException,
      );
    });

    // The quieter half of the same bug: with no branchId the claim used to be created
    // company-central, which `branchScopeWhere` then showed to every branch's queue.
    it('tags an omitted branch with the requester own branch rather than company-central', async () => {
      let written: any;
      const repo = {
        resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => requireTransactionBranchId(selected ?? scopes.branchIds?.[0]),
        assertReimbursementRequester: async (_company: string, _branch: string, userId: string) => ({ userId, displayName: 'สมชาย' }),
        resolveSourceLines: async (_company: string, _user: string, _branch: string, _currency: string, lines: any[]) => lines,
        findPolicy: async () => null,
        getUserDisplayName: async () => 'สมชาย',
        createRequest: async (data: any) => { written = data; return { ...data, id: 'rb-new', status: 'DRAFT', createdAt: new Date(), updatedAt: new Date() }; },
      } as any;

      await new CreateReimbursementDraftUseCase(repo, audit, evidence, noPayouts).execute(
        scopedTo(['branch-1'], ['reimbursement.create']),
        {
          reason: 'ไปพบลูกค้า',
          lines: [{ lineNo: 1, incurredDate: '2026-01-05T00:00:00.000Z', description: 'แท็กซี่', categoryKey: 'travel', categoryLabel: 'เดินทาง', amount: '100.00', attachmentId: 'att-1' }],
        } as any,
      );

      assert.equal(written.branchId, 'branch-1');
    });

    it('rejects an unrestricted requester without a selection when multiple branches exist', async () => {
      let written: any;
      const repo = {
        resolveCreateBranchId: async () => requireTransactionBranchId(null),
        findPolicy: async () => null,
        getUserDisplayName: async () => 'สมชาย',
        createRequest: async (data: any) => { written = data; return { ...data, id: 'rb-new', status: 'DRAFT', createdAt: new Date(), updatedAt: new Date() }; },
      } as any;
      const unrestricted = { ...scopedTo(['branch-1'], ['reimbursement.create']), scopes: {} };

      await assert.rejects(() => new CreateReimbursementDraftUseCase(repo, audit, evidence, noPayouts).execute(unrestricted, {
        reason: 'ไปพบลูกค้า',
        lines: [{ lineNo: 1, incurredDate: '2026-01-05T00:00:00.000Z', description: 'แท็กซี่', categoryKey: 'travel', categoryLabel: 'เดินทาง', amount: '100.00', attachmentId: 'att-1' }],
      } as any), /เลือกสาขา/);

      assert.equal(written, undefined);
    });
  });

  // A worklist, not a write, but it is where finance gets the payment ids it posts from — an
  // unscoped read here hands over exactly what the write assertions above refuse.
  it('scopes the unposted-payment worklist instead of listing every branch', async () => {
    let passedScopes: unknown;
    const repo = { listUnpostedReimbursementPayments: async (_c: string, scopes: unknown) => { passedScopes = scopes; return []; } } as any;

    await new ListUnpostedReimbursementPaymentsUseCase(repo).execute(scopedTo(['branch-1'], ['reimbursement.finance_review']));
    assert.deepEqual(passedScopes, { branchIds: ['branch-1'] });
  });

  /**
   * Exempt by design, with the reason, so an exemption is a decision rather than an omission:
   *  - policy read/write is company-level (`findPolicy(companyId, null)`), it has no branch
   *  - the three signature steps are gated on being the recorded requester or approver of that
   *    exact claim, which is a narrower test than branch and is not weakened by adding one
   *  - the account-number reveal is gated on that claim's reveal group (its requester, its approver,
   *    whoever may record its payment); `claimPayoutRevealGroup` holds everyone but the requester to
   *    the claim's branch, and the requester is reading their own account
   */
  const EXEMPT = new Set([
    'GetReimbursementPolicyUseCase',
    'ListReimbursementApproverOptionsUseCase',
    'UpdateReimbursementPolicyUseCase',
    'InitClaimSignatureUploadUseCase',
    'CompleteClaimSignatureUploadUseCase',
    'SignClaimFormUseCase',
    'RevealClaimPayoutUseCase',
  ]);

  it('leaves no use case in the module without branch handling or a recorded exemption', () => {
    const dir = __dirname;
    const unguarded: string[] = [];

    for (const file of readdirSync(dir).filter((name) => name.endsWith('.use-case.ts'))) {
      const lines = readFileSync(join(dir, file), 'utf8').split('\n');
      const starts = lines.flatMap((line, index) => /^export class (\w+UseCase)/.test(line) ? [index] : []);
      starts.forEach((start, position) => {
        const name = /^export class (\w+UseCase)/.exec(lines[start]!)![1]!;
        const body = lines.slice(start, starts[position + 1] ?? lines.length).join('\n');
        const guarded = /assertReimbursementBranchInScope|assertCanReadRequest|scopes: ctx\.scopes|ctx\.scopes \?\? \{\}/.test(body);
        if (!guarded && !EXEMPT.has(name)) unguarded.push(`${file}: ${name}`);
      });
    }

    assert.deepEqual(unguarded, [], `branch scope is neither enforced nor exempted in: ${unguarded.join(', ')}`);
  });
});
