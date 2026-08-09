/**
 * Audit H-4: the payer must be able to open the certificate they are being asked to sign.
 *
 * The payer is deliberately not the reviewer — that separation is the control this whole feature
 * exists to produce. But any active member can be designated payer, and SALES / STAFF / INVENTORY
 * hold no `expense.review`, so while the history endpoint required that key the wizard's
 * `Promise.all([getExpense, listSubstituteReceiptHistory])` rejected on the second call and its one
 * catch turned the signing page into an error screen. The two-person rule worked only when the
 * payer happened to also be a reviewer, which is the single case it is not for.
 *
 * The related-view ABAC pass closed it, but the property now rests on three independent facts in
 * three files: the endpoint accepts `expense.read_related`, every company role grants that key, and
 * the repository predicate counts a payer as related to the expense. Nothing says out loud what
 * those three combine to produce, so narrowing any one of them reads as harmless in review and
 * fails in production on the one screen a finance control depends on. This spec says it out loud.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { ROLE_GRANTS, SYSTEM_ROLES } from '../../../auth/permission-registry';
import {
  REQUIRED_ANY_PERMISSIONS_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from '../../../../common/security/permissions.decorator';
import { ExpenseController } from '../../presentation/http/expense.controller';
import { GetExpenseUseCase } from './expense-draft.use-case';
import { ListSubstituteReceiptHistoryUseCase } from './substitute-receipt.use-case';

/**
 * Every endpoint the wizard calls between "payer opens the notification" and "payer has signed".
 * Read off the controller rather than restated, so narrowing a decorator fails here.
 */
const PAYER_JOURNEY = [
  'getExpense',
  'listSubstituteHistory',
  'previewSubstitute',
  'initSubstituteSignature',
  'completeSubstituteSignature',
  'certifySubstitute',
] as const;

// Typed against the controller so renaming a handler fails to compile here rather than quietly
// leaving that endpoint uncovered.
function acceptedPermissions(handler: keyof ExpenseController): string[] {
  const prototype = ExpenseController.prototype as unknown as Record<string, object>;
  const method = prototype[handler];
  return (Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, method)
    ?? Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, method)
    ?? []) as string[];
}

/** SYSTEM_ADMIN is platform-only and never a company member, so it can never be a payer. */
const COMPANY_ROLES = SYSTEM_ROLES.map((role) => role.key).filter((key) => key !== 'SYSTEM_ADMIN');

/** A payer on the smallest possible role: no review, no confirm, no company-wide expense read. */
const staffPayer = {
  requestId: 'req-1', authSubject: 'payer-1', userId: 'payer-1', companyId: 'co-1',
  membershipId: 'mem-1', roles: ['STAFF'], permissions: ROLE_GRANTS.STAFF,
  scopes: { branchIds: ['branch-1'] }, authProvider: 'watchdog',
} as any;

/** Reviewed and prepared by someone else — the two-person split this finding is about. */
const expense = {
  id: 'exp-1', companyId: 'co-1', branchId: 'branch-1', createdByUserId: 'reviewer-1',
  substituteReceiptEvidence: { id: 'sub-1', payerUserId: 'payer-1' },
} as any;

const history = [{ id: 'sub-1', payerUserId: 'payer-1', status: 'PREPARED' }] as any;

describe('substitute-receipt payer access (audit H-4)', () => {
  it('never requires expense.review on the journey the payer has to walk', () => {
    for (const handler of PAYER_JOURNEY) {
      const accepted = acceptedPermissions(handler);
      assert.ok(accepted.length > 0, `${handler} has no permission metadata at all`);
      assert.notDeepEqual(accepted, ['expense.review'], `${handler} is reviewer-only again`);
    }
  });

  // The finding in one assertion: a payer is picked from the whole company, so a role that cannot
  // reach these endpoints is a role that cannot be picked — and nothing stops it being picked.
  it('leaves every company role able to reach every endpoint on that journey', () => {
    for (const handler of PAYER_JOURNEY) {
      const accepted = new Set(acceptedPermissions(handler));
      for (const role of COMPANY_ROLES) {
        assert.ok(
          (ROLE_GRANTS[role] ?? []).some((permission) => accepted.has(permission)),
          `${role} cannot call ${handler}, so it cannot be designated payer — accepts ${[...accepted].join(', ')}`,
        );
      }
    }
  });

  it('answers the certificate history to a payer who did not create the expense', async () => {
    const repo = {
      findById: async () => expense,
      isUserRelatedToExpense: async (companyId: string, expenseId: string, userId: string) => {
        assert.deepEqual([companyId, expenseId, userId], ['co-1', 'exp-1', 'payer-1']);
        return true;
      },
      listSubstituteEvidenceHistory: async () => history,
    } as any;

    assert.deepEqual(await new ListSubstituteReceiptHistoryUseCase(repo).execute(staffPayer, 'exp-1'), history);
  });

  // The other half of the same rule: read_related is relation-scoped, not a company-wide read.
  it('still refuses a colleague on the same role who is on none of the versions', async () => {
    const repo = {
      findById: async () => expense,
      isUserRelatedToExpense: async () => false,
      listSubstituteEvidenceHistory: async () => history,
    } as any;

    await assert.rejects(
      () => new ListSubstituteReceiptHistoryUseCase(repo).execute(
        { ...staffPayer, userId: 'bystander-1' },
        'exp-1',
      ),
      ForbiddenException,
    );
  });

  // A second, independent path to the same screen: read_own counts the payer as an owner of the
  // record. Asserted with read_own alone so it keeps working if the relation predicate ever changes.
  it('recognizes the payer through read_own even with no relation permission at all', async () => {
    const repo = {
      findByIdWithRelations: async () => expense,
      isUserRelatedToExpense: async () => assert.fail('read_own must not depend on the relation query'),
    } as any;
    const readOwnOnly = { ...staffPayer, permissions: ['expense.read_own'] };

    assert.equal((await new GetExpenseUseCase(repo).execute(readOwnOnly, 'exp-1')).id, 'exp-1');
  });

  // The history endpoint used to read `read_own` as "created it" while the expense detail and the
  // hub list both read it as "created it or paid it" — one permission, three siblings, two
  // agreeing. The hub would list the row and opening it answered 403.
  it('reads read_own the same way its siblings do: created it or paid it', async () => {
    const repo = {
      findById: async () => expense,
      isUserRelatedToExpense: async () => assert.fail('read_own must not depend on the relation query'),
      listSubstituteEvidenceHistory: async () => history,
    } as any;
    const readOwnOnly = { ...staffPayer, permissions: ['expense.read_own'] };

    assert.deepEqual(await new ListSubstituteReceiptHistoryUseCase(repo).execute(readOwnOnly, 'exp-1'), history);
  });

  // Any version counts, matching the relation predicate: superseding a certificate does not erase
  // the person whose name and signature are on the version it replaced.
  it('keeps the payer of a superseded version, and admits nobody else', async () => {
    const superseded = [
      { id: 'sub-2', payerUserId: 'payer-2', status: 'PREPARED' },
      { id: 'sub-1', payerUserId: 'payer-1', status: 'SUPERSEDED' },
    ] as any;
    const repo = {
      findById: async () => expense,
      isUserRelatedToExpense: async () => false,
      listSubstituteEvidenceHistory: async () => superseded,
    } as any;
    const readOwnOnly = { ...staffPayer, permissions: ['expense.read_own'] };

    assert.deepEqual(await new ListSubstituteReceiptHistoryUseCase(repo).execute(readOwnOnly, 'exp-1'), superseded);
    await assert.rejects(
      () => new ListSubstituteReceiptHistoryUseCase(repo).execute({ ...readOwnOnly, userId: 'payer-3' }, 'exp-1'),
      ForbiddenException,
    );
  });
});
