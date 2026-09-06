/**
 * The LINE capture branch rule, tested against a branch table that actually enforces the predicate.
 *
 * The dispatch harness's `branch.findMany` ignores `where.companyId` and `where.status`, so dropping
 * either from `resolveLineCaptureBranchId` survived every other spec in the repo (adversarial review
 * of e1fea654, F3). Here the double honours company, status and the `id.in` scope filter, so each of
 * those three is load-bearing: a member's default branch from another company, a deactivated one, or
 * one outside their branch scope must never become the branch of an accounting record.
 *
 * The rule itself (`pickLineDefaultBranchId`) has its own unit spec; what is proven here is the
 * QUERY that feeds it, which is where the containment lives.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException, UnprocessableEntityException } from '@nestjs/common';
import { ProcessLineWebhookUseCase, lineCaptureFailureReply } from './process-line-webhook.use-case';

type BranchRow = { id: string; type: string; companyId: string; status: string };

const BRANCHES: BranchRow[] = [
  { id: 'hq', type: 'HEAD_OFFICE', companyId: 'company-1', status: 'ACTIVE' },
  { id: 'silom', type: 'BRANCH', companyId: 'company-1', status: 'ACTIVE' },
  { id: 'ari', type: 'BRANCH', companyId: 'company-1', status: 'ACTIVE' },
  { id: 'closed', type: 'BRANCH', companyId: 'company-1', status: 'INACTIVE' },
  { id: 'other-hq', type: 'HEAD_OFFICE', companyId: 'company-2', status: 'ACTIVE' },
];

/** Honours exactly the three clauses the production query sends: companyId, status, and `id.in`. */
function makePrisma(rows: BranchRow[] = BRANCHES, memberDefaultBranchId: string | null = null) {
  const findManyArgs: any[] = [];
  const membershipArgs: any[] = [];
  return {
    findManyArgs,
    membershipArgs,
    prisma: {
      client: {
        branch: {
          findMany: async (args: any) => {
            findManyArgs.push(args);
            const where = args?.where ?? {};
            return rows.filter((row) =>
              row.companyId === where.companyId
              && row.status === where.status
              && (!where.id?.in || where.id.in.includes(row.id)));
          },
        },
        companyMembership: {
          findUnique: async (args: any) => {
            membershipArgs.push(args);
            return memberDefaultBranchId === null ? null : { defaultBranchId: memberDefaultBranchId };
          },
        },
      },
    },
  };
}

/** The rule is a private method: drive it off the prototype with only the collaborator it uses. */
function resolveBranch(
  prisma: unknown,
  membershipId: string | undefined,
  scopes: { branchIds?: string[] },
  companyId = 'company-1',
): Promise<string | undefined> {
  return (ProcessLineWebhookUseCase.prototype as any)
    .resolveLineCaptureBranchId.call({ prisma }, companyId, membershipId, scopes);
}

describe('resolveLineCaptureBranchId — the query behind the LINE branch default', () => {
  it('takes the member default branch when it is in scope, ACTIVE and in this company', async () => {
    const { prisma } = makePrisma(BRANCHES, 'silom');
    assert.equal(await resolveBranch(prisma, 'mem-1', {}), 'silom');
  });

  it('never lets an OUT-OF-SCOPE member default win — it falls back to the head office', async () => {
    const { prisma, findManyArgs } = makePrisma(BRANCHES, 'ari');
    // This member may only touch hq and silom; their stored default points outside that.
    assert.equal(await resolveBranch(prisma, 'mem-1', { branchIds: ['hq', 'silom'] }), 'hq');
    assert.deepEqual(findManyArgs[0].where.id, { in: ['hq', 'silom'] }, 'the scope filter is sent');
  });

  it('never lets a DEACTIVATED member default win', async () => {
    const { prisma, findManyArgs } = makePrisma(BRANCHES, 'closed');
    assert.equal(await resolveBranch(prisma, 'mem-1', {}), 'hq', 'falls back, does not use the closed branch');
    assert.equal(findManyArgs[0].where.status, 'ACTIVE', 'only ACTIVE rows are candidates');
  });

  it('never lets a member default from ANOTHER company win', async () => {
    const { prisma, findManyArgs } = makePrisma(BRANCHES, 'other-hq');
    assert.equal(await resolveBranch(prisma, 'mem-1', {}), 'hq');
    assert.equal(findManyArgs[0].where.companyId, 'company-1', 'the read is company-scoped');
    // And the other company's own branches are never candidates for this one.
    assert.equal(await resolveBranch(prisma, 'mem-1', {}, 'company-2'), 'other-hq');
  });

  it('falls back to the head office only when exactly one ACTIVE one is in scope', async () => {
    const { prisma } = makePrisma(BRANCHES);
    assert.equal(await resolveBranch(prisma, 'mem-1', {}), 'hq', 'one head office → it defaults');

    const twoHeadOffices = makePrisma([
      ...BRANCHES,
      { id: 'hq-2', type: 'HEAD_OFFICE', companyId: 'company-1', status: 'ACTIVE' },
    ]);
    assert.equal(await resolveBranch(twoHeadOffices.prisma, 'mem-1', {}), undefined, 'two → ambiguous, never a guess');

    const noHeadOffice = makePrisma(BRANCHES.filter((row) => row.type !== 'HEAD_OFFICE'));
    assert.equal(await resolveBranch(noHeadOffice.prisma, 'mem-1', {}), undefined);
  });

  it('defaults the single in-scope branch even when it is not a head office', async () => {
    const { prisma } = makePrisma(BRANCHES);
    assert.equal(await resolveBranch(prisma, 'mem-1', { branchIds: ['ari'] }), 'ari');
  });

  it('an EMPTY branch scope is no branches at all, never all of them', async () => {
    const { prisma } = makePrisma(BRANCHES, 'silom');
    // `branchIds: []` is a member scoped to nothing; `{}` (below) is the unrestricted read.
    assert.equal(await resolveBranch(prisma, 'mem-1', { branchIds: [] }), undefined);
  });

  it('skips the membership read entirely when the turn carries no membership', async () => {
    const { prisma, membershipArgs } = makePrisma(BRANCHES, 'silom');
    assert.equal(await resolveBranch(prisma, undefined, {}), 'hq', 'head-office fallback, no member default');
    assert.equal(membershipArgs.length, 0);
  });
});

describe('lineCaptureFailureReply — what counts as a deterministic capture refusal', () => {
  const TAIL = '\nTAIL';

  it('maps the two branch codes off a real Nest exception', async () => {
    for (const code of ['TRANSACTION_BRANCH_REQUIRED', 'TRANSACTION_BRANCH_INVALID']) {
      const mapped = lineCaptureFailureReply(new UnprocessableEntityException({ code, message: 'x' }), TAIL);
      assert.equal(mapped?.status, 'clarification_required');
      assert.equal(mapped?.errorCode, 'RECEIPT_BRANCH_SELECTION_REQUIRED');
      assert.ok(mapped?.reply.endsWith(TAIL), 'the caller-supplied tail is what ends the reply');
    }
  });

  it('returns undefined — and never throws — for anything else', () => {
    const notOurs: unknown[] = [
      new Error('connection terminated'),
      undefined,
      null,
      'a string someone threw',
      { code: 'TRANSACTION_BRANCH_REQUIRED' }, // the right code on a plain object is still not ours
      new HttpException('plain string body', 422), // getResponse() returns a string, not an object
      new UnprocessableEntityException({ code: 'EXPENSE_VAT_OVERRIDE_STALE' }),
    ];
    for (const error of notOurs) {
      assert.equal(lineCaptureFailureReply(error, TAIL), undefined, String(error));
    }
  });
});
