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
import { validateHeaderValue } from 'node:http';
import { ForbiddenException } from '@nestjs/common';
import { ROLE_GRANTS, SYSTEM_ROLES } from '../../../auth/permission-registry';
import {
  REQUIRED_ANY_PERMISSIONS_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from '../../../../common/security/permissions.decorator';
import { DenyByDefaultGuard } from '../../../../common/security/deny-by-default.guard';
import { ExpenseController, ExpenseSignatureController } from '../../presentation/http/expense.controller';
import { ListSignatureAssetsUseCase } from './signature-asset.use-case';
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

const APPROVER_JOURNEY = [
  'getExpense',
  'listSubstituteHistory',
  'downloadSubstitutePdf',
  'approveSubstitute',
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

  it('accepts expense.confirm throughout the approver journey', () => {
    for (const handler of APPROVER_JOURNEY) {
      assert.ok(acceptedPermissions(handler).includes('expense.confirm'), `${handler} rejects expense.confirm`);
    }
  });

  it('lets an expense reviewer complete an evidence upload', () => {
    assert.ok(acceptedPermissions('completeReceiptUpload').includes('expense.review'));
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

  it('lets an expense confirmer load the history required by the approval screen', async () => {
    const repo = {
      findById: async () => expense,
      isUserRelatedToExpense: async () => assert.fail('expense.confirm must not depend on payer relation'),
      listSubstituteEvidenceHistory: async () => history,
    } as any;
    const confirmer = { ...staffPayer, userId: 'approver-1', permissions: ['expense.confirm'] };
    assert.deepEqual(await new ListSubstituteReceiptHistoryUseCase(repo).execute(confirmer, 'exp-1'), history);
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

/**
 * F2, same failure shape one screen over: `RequirePermissions` is ALL-of, so a signature endpoint
 * demanded every listed key at once. Since the personal-signature decision (2026-08-20) there are
 * compatible authorities — the two signing acts, the personal self-manage key, and the legacy manage
 * key — so every route on this controller must use the any-of decorator, and every route must accept
 * the same four. Own-vs-any
 * scope is the use case's call: a decorator cannot see whose row is being asked for.
 */
describe('signature endpoint access (F2)', () => {
  const REVIEW_ONLY = {
    requestId: 'req-1', authSubject: 'payer-1', userId: 'payer-1', companyId: 'co-1',
    membershipId: 'mem-1', roles: ['STAFF'], permissions: ['expense.review'],
    scopes: {}, authProvider: 'watchdog',
  } as any;

  function acceptedByController(handler: keyof ExpenseSignatureController): { all: string[]; any: string[] } {
    const method = (ExpenseSignatureController.prototype as unknown as Record<string, object>)[handler]!;
    return {
      all: (Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, method) ?? []) as string[],
      any: (Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, method) ?? []) as string[],
    };
  }

  it('gates every signature route on the same four authorities, and lets a payer through', async () => {
    const handlers: Array<keyof ExpenseSignatureController> = [
      'list', 'initSignatureUpload', 'createSignature', 'archiveSignature', 'setDerivedAsset',
    ];
    for (const handler of handlers) {
      const gate = acceptedByController(handler);
      assert.deepEqual(gate.all, [], `${handler}: must not use the ALL-of decorator`);
      assert.deepEqual(
        [...gate.any].sort(),
        ['expense.confirm', 'expense.review', 'expense.signature.manage', 'expense.signature.self_manage'],
        `${handler}: the four equivalent authorities`,
      );
      assert.ok(new DenyByDefaultGuard(reflectorFor(gate)).canActivate(guardContext(REVIEW_ONLY)), handler);
    }
    // The approval lifecycle is gone: no route may still be reachable on its permission.
    assert.equal(
      handlers.some((handler) => acceptedByController(handler).any.includes('expense.signature.approve')),
      false,
    );

    const repo = { listSignatureAssets: async () => [] } as any;
    const storage = { createDownloadUrl: async () => ({ url: 'u', expiresAt: new Date() }) } as any;
    assert.deepEqual(
      await new ListSignatureAssetsUseCase(repo, { log: async () => undefined } as any).execute(REVIEW_ONLY),
      [],
    );
  });

  /** The real guard, fed the real decorator metadata — not a restatement of its rules. */
  function reflectorFor(gate: { all: string[]; any: string[] }) {
    return {
      getAllAndOverride: (key: string) => (key === REQUIRED_PERMISSIONS_KEY ? gate.all : key === REQUIRED_ANY_PERMISSIONS_KEY ? gate.any : undefined),
    } as any;
  }

  function guardContext(ctx: unknown) {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ context: ctx }) }),
    } as any;
  }

  /**
   * The route exists so the signer SEES the signature before certifying. On this product the
   * uploaded file is named in Thai — “ลายเซ็น.png” — and a non-latin1 byte in a header value is
   * `ERR_INVALID_CHAR`, so quoting the name raw turned that one request into a 500 and put the
   * signer straight back to certifying blind. Node's own header validator is the check, because it
   * is the thing that used to throw.
   */
  it('serves a Thai-named signature image with a header Node will actually accept', async () => {
    for (const [fileName, mimeType, expectedAscii] of [
      ['ลายเซ็น.png', 'image/png', 'signature.png'],
      ['ลายเซ็นของผม.jpg', 'image/jpeg', 'signature.jpg'],
      ['signature "quoted"\r\n.png', 'image/png', 'signature.png'],
    ] as const) {
      const controller = new ExpenseSignatureController(
        null as any, null as any, null as any, null as any, null as any,
        { execute: async () => ({ bytes: Buffer.from([1]), mimeType, fileName }) } as any,
      );
      const headers: Record<string, string> = {};
      const file = await controller.signatureImageBytes(
        REVIEW_ONLY,
        'att-1',
        { setHeader: (name: string, value: string) => { headers[name] = value; } } as any,
      );

      const disposition = String(file.getHeaders().disposition);
      assert.doesNotThrow(() => validateHeaderValue('Content-Disposition', disposition), fileName);
      assert.match(disposition, new RegExp(`^inline; filename="${expectedAscii}"; filename\\*=UTF-8''`));
      assert.ok(disposition.includes(encodeURIComponent(fileName)), 'the signer’s own filename still reaches clients that read RFC 5987');
      assert.equal(headers['Cache-Control'], 'private, no-store, max-age=0');
    }
  });
});
