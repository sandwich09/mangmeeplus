import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TaxController } from './tax.controller.js';

const ctx = { companyId: 'company-1', userId: 'user-1', roles: ['ACCOUNTANT'], permissions: [], scopes: {}, requestId: 'request-1' } as any;

function controller(repo: any) {
  const noop = {} as any;
  return new TaxController(noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, repo, { log: async () => undefined } as any);
}

/** Wraps a repo with a companyTaxProfile.findUnique stub (null → default ACCOUNTANT reviewer). */
function withProfile(repo: any, taxReviewerRole: string | null = null) {
  const client = repo.prisma?.client ?? {};
  return {
    ...repo,
    prisma: { client: { ...client, companyTaxProfile: { findUnique: async () => (taxReviewerRole === null ? null : { companyId: 'company-1', taxReviewerRole }) } } },
  };
}

describe('TaxController tenant and filing transition gates', () => {
  it('does not resolve a review issue outside the request company', async () => {
    let resolved = false;
    const value = controller(withProfile({
      prisma: { client: { taxReviewIssue: { findFirst: async ({ where }: any) => {
        assert.equal(where.companyId, 'company-1');
        return null;
      } } } },
      resolveIssue: async () => { resolved = true; },
    }));
    await assert.rejects(() => value.resolveIssue(ctx, 'company-1', 'foreign-issue', { note: 'checked' }), /not found/i);
    assert.equal(resolved, false);
  });

  it('requires an exported period before mark-filed', async () => {
    const value = controller(withProfile({
      findPeriodById: async (companyId: string) => ({ id: 'period-1', companyId, status: 'REVIEWED', formType: 'PP30', periodKey: '2026-07' }),
    }));
    await assert.rejects(() => value.markFiled(ctx, 'company-1', 'period-1', {}), /current reviewed export package/i);
  });

  it('rejects a route company that differs from the authenticated company', async () => {
    const value = controller({});
    await assert.rejects(() => value.markPaid(ctx, 'company-2', 'period-1', {}), /company/i);
  });
});

describe('narrow PND53 routes', () => {
  it('lists only PND53 periods for the authenticated company', async () => {
    const value = controller({
      findPeriods: async (companyId: string, filters: unknown) => {
        assert.equal(companyId, 'company-1');
        assert.deepEqual(filters, { taxType: 'WHT', formType: 'PND53', pageSize: 100 });
        return { items: [], total: 0 };
      },
    });
    assert.deepEqual(await value.listPnd53Periods(ctx, 'company-1'), { items: [], total: 0 });
    await assert.rejects(() => value.listPnd53Periods(ctx, 'company-2'), /company/i);
  });

  it('refuses export and event reads for a VAT or PND3 period before calling the report service', async () => {
    for (const formType of ['PP30', 'PND3']) {
      const value = controller({
        findPeriodById: async () => ({ id: 'other-period', formType, periodKey: '2026-09' }),
      });
      await assert.rejects(() => value.exportPnd53(ctx, 'company-1', 'other-period', { exportFormat: 'PDF' }), /PND53 period not found/);
      await assert.rejects(() => value.listPnd53Events(ctx, 'company-1', 'other-period'), /PND53 period not found/);
      await assert.rejects(() => value.listPnd53Issues(ctx, 'company-1', 'other-period'), /PND53 period not found/);
      await assert.rejects(() => value.markPnd53Filed(ctx, 'company-1', 'other-period', {}), /PND53 period not found/);
    }
  });
});

describe('GAP-04 taxReviewerRole enforcement', () => {
  // A period stuck at REVIEWED so mark-filed reaches its transition guard only after the reviewer-role gate passes.
  const reviewedPeriodRepo = (taxReviewerRole: string | null) => withProfile({
    findPeriodById: async (companyId: string) => ({ id: 'period-1', companyId, status: 'REVIEWED', formType: 'PP30', periodKey: '2026-07' }),
  }, taxReviewerRole);

  it('lets the default ACCOUNTANT reviewer through the gate (no profile row)', async () => {
    const value = controller(reviewedPeriodRepo(null));
    // ACCOUNTANT clears the reviewer gate, then fails the later transition guard, not a 403.
    await assert.rejects(() => value.markFiled(ctx, 'company-1', 'period-1', {}), /current reviewed export package/i);
  });

  it('blocks a FINANCE user (holds permission, wrong reviewer role) with 403 tax_reviewer_role_required', async () => {
    const financeCtx = { ...ctx, roles: ['FINANCE'] };
    const value = controller(reviewedPeriodRepo(null)); // default reviewer = ACCOUNTANT
    await assert.rejects(
      () => value.markFiled(financeCtx, 'company-1', 'period-1', {}),
      (err: any) => {
        assert.equal(err?.response?.code, 'tax_reviewer_role_required');
        assert.match(err?.response?.message, /ACCOUNTANT/);
        return true;
      },
    );
  });

  it('OWNER passes the gate regardless of configured reviewer role', async () => {
    const ownerCtx = { ...ctx, roles: ['OWNER'] };
    const value = controller(reviewedPeriodRepo('FINANCE'));
    await assert.rejects(() => value.markFiled(ownerCtx, 'company-1', 'period-1', {}), /current reviewed export package/i);
  });

  it('with reviewer role FINANCE, a FINANCE user passes and an ACCOUNTANT is blocked', async () => {
    const financeCtx = { ...ctx, roles: ['FINANCE'] };
    const passRepo = reviewedPeriodRepo('FINANCE');
    await assert.rejects(() => controller(passRepo).markFiled(financeCtx, 'company-1', 'period-1', {}), /current reviewed export package/i);

    const blockRepo = reviewedPeriodRepo('FINANCE');
    await assert.rejects(
      () => controller(blockRepo).markFiled(ctx, 'company-1', 'period-1', {}),
      (err: any) => {
        assert.equal(err?.response?.code, 'tax_reviewer_role_required');
        assert.match(err?.response?.message, /FINANCE/);
        return true;
      },
    );
  });

  it('gates resolveIssue on the reviewer role too', async () => {
    const financeCtx = { ...ctx, roles: ['FINANCE'] };
    let resolved = false;
    const value = controller(withProfile({
      prisma: { client: { taxReviewIssue: { findFirst: async () => { resolved = true; return null; } } } },
      resolveIssue: async () => { resolved = true; },
    }, null));
    await assert.rejects(
      () => value.resolveIssue(financeCtx, 'company-1', 'issue-1', { note: 'x' }),
      (err: any) => { assert.equal(err?.response?.code, 'tax_reviewer_role_required'); return true; },
    );
    assert.equal(resolved, false); // rejected before touching the issue
  });
});


describe('persistent certificate route authority', () => {
  it('lets readers, issuers, correctors and external recorders load the card and download, while issuance remains separately guarded', async () => {
    const { REQUIRED_ANY_PERMISSIONS_KEY, REQUIRED_PERMISSIONS_KEY } = await import('../../../../common/security/permissions.decorator');
    const proto = TaxController.prototype;
    assert.equal(typeof proto.downloadSystemWhtCertificate, 'function');
    for (const handler of [proto.listWhtHandoffs, proto.downloadSystemWhtCertificate]) {
      assert.deepEqual(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, handler), ['wht.certificate.read', 'wht.certificate.issue', 'wht.certificate.correct', 'wht.external_certificate.link']);
    }
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, proto.issueSystemWhtCertificate), ['wht.certificate.issue']);
  });
});


describe('certificate card payee address authority', () => {
  it('lets issuers or external recorders save the address, without giving readers mutation authority', async () => {
    const { REQUIRED_ANY_PERMISSIONS_KEY, REQUIRED_PERMISSIONS_KEY } = await import('../../../../common/security/permissions.decorator');
    const handler = TaxController.prototype.setWhtHandoffPayeeAddress;
    assert.deepEqual(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, handler), ['wht.external_certificate.link', 'wht.certificate.issue']);
    assert.equal(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler), undefined);
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, TaxController.prototype.linkExternalWhtCertificate), ['wht.external_certificate.link']);
  });
});

describe('expense certificate history route', () => {
  it('accepts all certificate card reader permissions and checks the route company before reading', async () => {
    const { REQUIRED_ANY_PERMISSIONS_KEY } = await import('../../../../common/security/permissions.decorator');
    assert.deepEqual(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, TaxController.prototype.getExpenseWhtCertificateHistory), ['wht.certificate.read', 'wht.certificate.issue', 'wht.certificate.correct', 'wht.external_certificate.link']);
    const noop = {} as any;
    const calls: any[] = [];
    const handoffs = { getExpenseHistory: async (...args: any[]) => { calls.push(args); return []; } } as any;
    const value = new TaxController(noop, noop, noop, noop, noop, handoffs, noop, noop, noop, noop, noop, noop, noop, noop);
    await assert.rejects(() => value.getExpenseWhtCertificateHistory(ctx, 'company-2', 'exp-1'), /company/i);
    assert.equal(calls.length, 0);
    assert.deepEqual(await value.getExpenseWhtCertificateHistory(ctx, 'company-1', 'exp-1'), []);
    assert.deepEqual(calls, [[ctx, 'exp-1']]);
  });
});


describe('C1 handoff list route compatibility', () => {
  it('keeps both existing array callers and selects the paged read only when pagination is requested', async () => {
    const calls: any[] = [];
    const handoffs = { list: async (_ctx: any, filters: any) => { calls.push(['array', filters]); return []; },
      listPaged: async (_ctx: any, filters: any) => { calls.push(['paged', filters]); return { rows: [], total: 0, page: 1, pageSize: 20, counts: {} }; } };
    const noop = {} as any;
    const value = new TaxController(noop, noop, noop, noop, noop, handoffs as any, noop, noop, noop, noop, noop, noop, noop, noop);
    assert.deepEqual(await value.listWhtHandoffs(ctx, ctx.companyId), []);
    assert.deepEqual(await value.listWhtHandoffs(ctx, ctx.companyId, undefined, undefined, 'expense-1'), []);
    const result = await (value.listWhtHandoffs as any)(ctx, ctx.companyId, 'REQUIRED', 'branch-1', undefined, '1', '20', 'ผู้รับ');
    assert.ok(Array.isArray(result.rows));
    assert.deepEqual(calls.map(call => call[0]), ['array', 'array', 'paged']);
    assert.equal(calls[1][1].sourcePaymentId, 'expense-1');
    assert.deepEqual(calls[2][1], { status: 'REQUIRED', branchId: 'branch-1', sourcePaymentId: undefined, page: 1, pageSize: 20, search: 'ผู้รับ' });
    await assert.rejects(() => (value.listWhtHandoffs as any)(ctx, 'other-company', undefined, undefined, undefined, '1'), /company/i);
    assert.equal(calls.length, 3);
  });
});


describe('C1 by-id controller delegation', () => {
  it('preserves caller branch and expense scope and missing-id responses at all seven entries', async () => {
    const { NotFoundException } = await import('@nestjs/common');
    const entries = [
      ['getWhtHandoff', 'get', []],
      ['setWhtHandoffPayeeAddress', 'setPayeeAddress', [{ payeeAddress: 'ที่อยู่' }]],
      ['linkExternalWhtCertificate', 'linkExternal', [{ commandId: 'cmd', externalCertificateNumber: 'EXT', externalEvidenceRef: 'paper', issuedDate: '2026-07-20' }]],
      ['issueSystemWhtCertificate', 'execute', []],
      ['downloadSystemWhtCertificate', 'download', []],
      ['correctSystemWhtCertificate', 'execute', [{ corrected: {}, reason: 'แก้ที่อยู่' }]],
      ['issueSystemWhtReplacementCopy', 'execute', []],
    ] as const;
    for (const [route, method, body] of entries) {
      let reject = false;
      const calls: any[] = [];
      const delegate = { [method]: async (...args: any[]) => {
        calls.push(args);
        if (reject) throw new NotFoundException('WHT handoff not found.');
        return { id: args[1] };
      } };
      const noop = {} as any;
      const value = new TaxController(noop, noop, noop, noop, noop, delegate as any, delegate as any, delegate as any, delegate as any, noop, noop, noop, noop, noop);
      for (const actor of [{ ...ctx, scopes: { branchIds: ['branch-1'] } }, { ...ctx, permissions: ['expense.read_own'] }, ctx]) {
        assert.deepEqual(await (value[route] as any)(actor, ctx.companyId, 'handoff-1', ...body), { id: 'handoff-1' });
        assert.equal(calls.at(-1)[0], actor); assert.equal(calls.at(-1)[1], 'handoff-1');
      }
      const before = calls.length;
      await assert.rejects(() => (value[route] as any)(ctx, 'other-company', 'handoff-1', ...body), /company/i);
      assert.equal(calls.length, before);
      reject = true;
      await assert.rejects(() => (value[route] as any)(ctx, ctx.companyId, 'missing', ...body), (error: any) => {
        assert.equal(error.getStatus(), 404);
        assert.deepEqual(error.getResponse(), { message: 'WHT handoff not found.', error: 'Not Found', statusCode: 404 });
        return true;
      });
    }
  });

  it('selects the paged response with pageSize alone and retains array responses when only search is supplied', async () => {
    const calls: any[] = [];
    const handoffs = { list: async () => { calls.push('array'); return []; }, listPaged: async (_ctx: any, filter: any) => { calls.push(filter); return { rows: [] }; } };
    const noop = {} as any;
    const value = new TaxController(noop, noop, noop, noop, noop, handoffs as any, noop, noop, noop, noop, noop, noop, noop, noop);
    assert.deepEqual(await value.listWhtHandoffs(ctx, ctx.companyId, undefined, undefined, undefined, undefined, undefined, 'payee'), []);
    await value.listWhtHandoffs(ctx, ctx.companyId, undefined, undefined, undefined, undefined, '100');
    assert.equal(calls[0], 'array'); assert.ok(Number.isNaN(calls[1].page)); assert.equal(calls[1].pageSize, 100);
  });
});

describe('C5 self-issued change route', () => {
  it('requires only external recording authority and preserves the route company boundary and body', async () => {
    const { REQUIRED_PERMISSIONS_KEY } = await import('../../../../common/security/permissions.decorator');
    const handler = (TaxController.prototype as any).changeExternalWhtCertificate;
    assert.equal(typeof handler, 'function');
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler), ['wht.external_certificate.link']);
    const noop = {} as any, calls: any[] = [];
    const body = { commandId: 'change-1', externalCertificateNumber: 'EXT-2', issuedDate: '2026-07-21', externalEvidenceRef: '', note: 'แก้เลขที่' };
    const value = new TaxController(noop, noop, noop, noop, noop, { changeExternal: async (...args: any[]) => { calls.push(args); return { externalCertificateNumber: 'EXT-2' }; } } as any, noop, noop, noop, noop, noop, noop, noop, noop);
    await assert.rejects(() => (value as any).changeExternalWhtCertificate(ctx, 'company-2', 'handoff', body), /company/i);
    assert.deepEqual(calls, []);
    assert.deepEqual(await (value as any).changeExternalWhtCertificate(ctx, 'company-1', 'handoff', body), { externalCertificateNumber: 'EXT-2' });
    assert.deepEqual(calls, [[ctx, 'handoff', body]]);
    assert.equal(Reflect.getMetadata('path', handler), 'wht/payment-handoffs/:handoffId/external-certificate/change');
  });
});


describe('C15 self-issued removal route', () => {
  it('requires recording permission, guards route company and forwards the versioned removal body', async () => {
    const { REQUIRED_PERMISSIONS_KEY } = await import('../../../../common/security/permissions.decorator');
    const handler = TaxController.prototype.removeExternalWhtCertificate;
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler), ['wht.external_certificate.link']);
    assert.equal(Reflect.getMetadata('path', handler), 'wht/payment-handoffs/:handoffId/external-certificate/remove');
    const noop = {} as any, calls: any[] = [];
    const body = { commandId: 'remove-1', expectedUpdatedAt: '2026-10-12T00:00:00.000Z', reason: 'บันทึกผิด' };
    const value = new TaxController(noop, noop, noop, noop, noop, { removeExternal: async (...args: any[]) => { calls.push(args); return { status: 'REQUIRED' }; } } as any, noop, noop, noop, noop, noop, noop, noop, noop);
    await assert.rejects(value.removeExternalWhtCertificate(ctx, 'company-2', 'handoff', body), /company/i);
    assert.deepEqual(calls, []);
    assert.deepEqual(await value.removeExternalWhtCertificate(ctx, 'company-1', 'handoff', body), { status: 'REQUIRED' });
    assert.deepEqual(calls, [[ctx, 'handoff', body]]);
  });
});
