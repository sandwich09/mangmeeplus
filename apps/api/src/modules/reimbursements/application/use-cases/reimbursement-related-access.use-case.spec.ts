import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RequestContext } from '@watchdog-bms/contracts';
import {
  assertCanReadRequest,
  ListReimbursementsUseCase,
} from './reimbursement-request.use-case';
import { GetReimbursementAiSummaryUseCase } from './reimbursement-summary.use-case';
import { ListFinanceQueueUseCase } from './reimbursement-finance.use-case';
import {
  PrismaReimbursementRepository,
  reimbursementRelatedToUserWhere,
} from '../../infrastructure/prisma-reimbursement.repository';
import { ReimbursementController } from '../../presentation/http/reimbursement.controller';
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

describe('reimbursement related-view ABAC', () => {
  it('opens only read/signer entry routes to related actors and keeps business mutations exact', () => {
    const prototype = ReimbursementController.prototype;
    const readAny = ['reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own'];
    for (const handler of [
      'summary', 'list', 'get', 'previewClaimForm', 'initClaimSignature',
      'completeClaimSignature', 'signClaimForm', 'linkSignedCopy',
    ] as const) {
      assert.deepEqual(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, prototype[handler]), readAny);
    }
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype.update), ['reimbursement.update_own_draft']);
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype.approveRequest), ['reimbursement.approve']);
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype.createPayment), ['reimbursement.payment.record']);
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

  it('lists only related records under the caller branch scope', async () => {
    let received: any;
    const useCase = new ListReimbursementsUseCase({
      listRequests: async (where: any) => { received = where; return []; },
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
});
