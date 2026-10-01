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
  SubmitReimbursementUseCase,
  UpdateReimbursementDraftUseCase,
} from './reimbursement-request.use-case';

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
    run: (repo: any, ctx: any) => new FinanceReviewReimbursementUseCase(repo, audit, projections, fakeDetailEvidence as any)
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
