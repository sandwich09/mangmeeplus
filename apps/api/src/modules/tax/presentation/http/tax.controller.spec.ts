import { E_WHT_WORDS } from '@watchdog-bms/contracts';
import { expenseSourceForEvent } from '../../testing/withholding-source.fixture';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';
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
  client.company ??= { findUnique: async () => ({ timezone: 'Asia/Bangkok' }) };
  client.expenseRecord ??= { findMany: async () => [] };
  client.whtFilingLine ??= { findMany: async () => [] };
  client.accountingCounterparty ??= { findMany: async () => [] };
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
    assert.deepEqual(await value.listWhtHandoffs(ctx, ctx.companyId, { sourcePaymentId: 'expense-1' }), []);
    const result = await (value.listWhtHandoffs as any)(ctx, ctx.companyId, { status: 'REQUIRED', branchId: 'branch-1', page: '1', pageSize: '20', search: 'ผู้รับ', order: 'oldest' });
    assert.ok(Array.isArray(result.rows));
    assert.deepEqual(calls.map(call => call[0]), ['array', 'array', 'paged']);
    assert.equal(calls[1][1].sourcePaymentId, 'expense-1');
    assert.deepEqual(calls[2][1], { status: 'REQUIRED', branchId: 'branch-1', sourcePaymentId: undefined, page: 1, pageSize: 20, search: 'ผู้รับ', order: 'oldest' });
    await assert.rejects(() => (value.listWhtHandoffs as any)(ctx, 'other-company', { page: '1' }), /company/i);
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
    assert.deepEqual(await value.listWhtHandoffs(ctx, ctx.companyId, { search: 'payee' }), []);
    await value.listWhtHandoffs(ctx, ctx.companyId, { pageSize: '100' });
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


describe('form-aware withholding routes', () => {
  it('shares narrow handlers and permissions with the PND53 alias and validates the path form', async () => {
    const { REQUIRED_PERMISSIONS_KEY } = await import('../../../../common/security/permissions.decorator');
    const handler = TaxController.prototype.listPnd53Periods;
    assert.deepEqual(Reflect.getMetadata('path', handler), ['tax/pnd53/periods', 'tax/withholding/:formType/periods']);
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler), ['wht.pnd53.read']);
    for (const form of ['PND3', 'PND53']) {
      const value = controller({ findPeriods: async (_c: string, filter: any) => { assert.equal(filter.formType, form); return []; } });
      await value.listPnd53Periods(ctx, ctx.companyId, form);
    }
    await assert.rejects(controller({}).listPnd53Periods(ctx, ctx.companyId, 'PP30'), (e: any) => e.getStatus() === 400);
  });
  it('rejects the other form at every period boundary', async () => {
    for (const form of ['PND3', 'PND53']) {
      const value = controller({ findPeriodById: async () => ({ formType: form === 'PND3' ? 'PND53' : 'PND3' }),
        prisma: { client: { taxReviewIssue: { findFirst: async () => ({ taxPeriodId: 'p' }) } } } });
      for (const call of [() => value.listPnd53Events(ctx, ctx.companyId, 'p', form),
        () => value.generatePnd53(ctx, ctx.companyId, 'p', form),
        () => value.exportPnd53(ctx, ctx.companyId, 'p', { exportFormat: 'PDF' }, form),
        () => value.listPnd53Issues(ctx, ctx.companyId, 'p', form),
        () => value.markPnd53Filed(ctx, ctx.companyId, 'p', {}, form),
        () => value.resolvePnd53Issue(ctx, ctx.companyId, 'i', { note: 'checked' }, form)]) {
        await assert.rejects(call, (e: any) => e.getStatus() === 404);
      }
    }
  });
});

describe('withholding month read', () => {
  it('joins both forms, exact totals, scoped issues and downloadable certificates without creating periods', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-05') });
    const { GenerateWhtReportUseCase } = await import('../../application/use-cases/generate-wht-report.use-case');
    const periods = ['PND3', 'PND53'].map(formType => ({ id: formType, formType, status: 'OPEN', periodKey: '2026-09', dueDate: null }));
    const event = (id: string, form: string, sourceId: string) => ({ id, eventType: `WHT_${form}`, whtFormType: form, taxPeriodId: form, sourceType: 'expense.record', sourceId,
      eventDate: new Date('2026-09-10'), periodKey: '2026-09', grossAmount: '1000.1000', withheldAmount: '30.0030', whtRate: '3.0000',
      incomeCategoryCode: form === 'PND3' ? null : 'WHT_SERVICE_5', payeeSnapshotJson: { name: 'ผู้รับเงิน', taxId: '1100700000001', address: '55 ถนนสุขุมวิท กรุงเทพมหานคร' }, currency: 'THB', branchId: null });
    const issues = [{ id: 'unknown', taxPeriodId: 'PND53', sourceType: 'expense.record', sourceId: 'unknown-expense', issueCode: 'WHT_PAYEE_KIND_UNKNOWN', description: 'ต้องแก้ไข', severity: 'BLOCKING' },
      { id: 'hidden', taxPeriodId: 'PND53', sourceType: 'expense.record', sourceId: 'outside', issueCode: 'WHT_PAYEE_KIND_UNKNOWN' }];
    let linked = true;
    let actor: any = { ...ctx, permissions: ['wht.pnd53.read', 'wht.certificate.read', 'expense.read'], scopes: { branchIds: ['b1'] } };
    const handoff: any = { id: 'h', companyId: ctx.companyId, status: 'SYSTEM_ISSUED', sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-1', sourceBranchId: 'b1', certificateId: 'cert', taxEventIdsJson: ['e1'] };
    const db: any = {
      whtFiling: { findFirst: async () => null, findMany: async () => [] },
      taxPeriod: { findMany: async ({ where }: any) => { assert.equal(where.companyId, ctx.companyId); return periods; } },
      taxEvent: { findMany: async ({ where, orderBy }: any) => {
        if (orderBy) assert.deepEqual(orderBy, [{ eventDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]);
        assert.equal(where.companyId, ctx.companyId);
        if (where.status === 'EXCLUDED') return [];
        assert.equal(where.status, 'ACTIVE');
        if (where.OR) assert.deepEqual(where.OR, [{ branchId: { in: ['b1'] } }, { branchId: null }]);
        return [event('e1', 'PND3', 'expense-1'), event('e2', 'PND53', 'expense-2'), event('e3', 'PND3', 'outside')];
      } },
      taxReviewIssue: { findMany: async () => issues.map(i => ({ ...i, taxPeriod: { formType: 'PND53' } })) },
      whtFilingLine: { findMany: async () => [] },
      accountingCounterparty: { findMany: async () => [] },
      expenseRecord: { findMany: async ({ where }: any) => {
        if (where.whtAmount && !where.OR) return [...[event('e1', 'PND3', 'expense-1'), event('e2', 'PND53', 'expense-2')].map(e => expenseSourceForEvent(e, { branchId: 'b1', vendorCounterpartyId: linked ? `cp-${e.sourceId}` : null })), { id: 'unknown-expense', companyId: ctx.companyId, status: 'CONFIRMED', branchId: 'b1', vendorCounterpartyId: linked ? 'cp-unknown-expense' : null, vendorAddressSnapshot: 'กรุงเทพ', vendorNameSnapshot: 'สมชาย', vendorEntityKindSnapshot: null,
          expenseDate: new Date('2026-09-10'), updatedAt: new Date(), whtAmount: '30', netPayableAmount: '970', grandTotalAmount: '1000', taxableAmount: '1000', lines: [], payments: [{ id: 'unknown-pay', amount: '970', status: 'RECORDED', paidAtConfirmed: true, paidAt: new Date('2026-09-10'), createdAt: new Date() }] }];
        if (!where.id) assert.ok(JSON.stringify(where).includes('b1'));
        else if (where.OR) assert.ok(JSON.stringify(where).includes('b1'));
        else assert.ok(where.id.in.length > 0);
        return ['expense-1', 'expense-2', 'unknown-expense'].map(id => ({ id, payments: [{ createdAt: new Date(id === 'expense-1' ? '2026-09-12' : '2026-09-11') }], branchId: 'b1', vendorCounterpartyId: linked ? `cp-${id}` : null, vendorNameSnapshot: 'สมชาย', vendorEntityKindSnapshot: id === 'expense-1' ? 'INDIVIDUAL' : 'JURISTIC', whtCategoryCode: 'WHT_SERVICE_3' }));
      } },
      company: { findUnique: async () => ({ registeredName: 'ร้าน', taxId: '1100700000001', addressJson: { line1: '55 ถนน', subdistrict: 'จอมพล', district: 'จตุจักร', province: 'กรุงเทพมหานคร', postalCode: '10900' } }) },
      companyTaxProfile: { findUnique: async () => null },
      supplierPayment: { findMany: async () => [] },
      whtIncomeCategory: { findMany: async () => [{ code: 'WHT_SERVICE_3', nameTh: 'ค่าบริการบุคคล' }, { code: 'WHT_SERVICE_5', nameTh: 'ค่าบริการบริษัท' }] },
      whtCertificateHandoff: { findMany: async ({ select }: any) => select?.sourcePaymentId ? [{ sourcePaymentId: 'expense-1' }] : [handoff] },
      whtCertificate: { findMany: async () => [{ id: 'cert', status: 'ISSUED', certificateNumber: 'WT-1' }] },
    };
    db.whtFiling ??= { findMany: async () => [] };
    db.whtPayerModeFact ??= { findMany: async () => [] };
    db.branch ??= { findMany: async () => [] };
    db.$transaction = async (work: any) => work(db);
  db.company ??= { findUnique: async () => ({ timezone: 'Asia/Bangkok' }) };
  db.whtFilingLine ??= { findMany: async ({ where }: any) => (await db.whtFiling.findMany({ where: { companyId: ctx.companyId } })).filter((p: any) => p.status === 'FILED' && (!where.filing.formType || (p.formType ?? p.taxPeriodId) === where.filing.formType)).flatMap((p: any) => p.lines ?? []) };
  db.accountingCounterparty ??= { findMany: async () => [] };
  const reader = new GenerateWhtReportUseCase({ prisma: { client: db } } as any);
    const result = await reader.getMonth(actor, '2026-09');
    assert.equal(result.periodKey, '2026-09'); assert.equal(result.payments.length, 2);
    assert.deepEqual(result.forms.map(f => [f.formType, f.paymentCount, f.totalPaid, f.totalWithheld]), [
      ['PND3', 1, '1000.1000', '30.0030'], ['PND53', 1, '1000.1000', '30.0030'],
    ]);
    assert.equal(result.forms[0].dueDate, '2026-10-07');
    assert.equal(result.forms[1].issues.length, 1);
    assert.equal(result.forms[1].issues[0].counterpartyId, 'cp-unknown-expense');
    assert.equal(result.forms[1].issues[0].sourceId, 'unknown-expense');
    assert.equal(result.forms[1].issues[0].expenseId, 'unknown-expense');
    assert.equal(result.forms[1].issues[0].description, 'ยังไม่รู้ว่า สมชาย เป็นบริษัทหรือบุคคล เปิดคู่ค้าแล้วเลือกประเภทก่อน');
    linked = false;
    const unlinked = (await reader.getMonth(actor, '2026-09')).forms[1].issues[0];
    assert.equal(unlinked.counterpartyId, null);
    assert.equal(unlinked.expenseId, 'unknown-expense');
    assert.equal(unlinked.description, 'ยังไม่รู้ว่า สมชาย เป็นบริษัทหรือบุคคล เปิดรายจ่ายแล้วเลือกว่าผู้รับเงินเป็นบริษัทหรือบุคคล');

    assert.equal(result.payments[0].incomeCategoryLabel, 'ค่าบริการบุคคล');
    assert.equal(result.payments[0].certificate?.number, 'WT-1');
    assert.equal(result.payments[0].certificate?.canDownload, true);
    handoff.taxEventIdsJson = [];
    handoff.prefillSnapshotJson = { expensePaymentId: 'another-payment' };
    assert.equal((await reader.getMonth(actor, '2026-09')).payments[0].certificate, null, 'a different partial payment cannot borrow this certificate');
    delete handoff.prefillSnapshotJson;
    actor = { ...actor, permissions: ['wht.pnd53.read'] };
    assert.equal((await reader.getMonth(actor, '2026-09')).payments[0].certificate?.canDownload, false);
    await assert.rejects(reader.getMonth(actor, '2026-13'), (e: any) => e.getStatus() === 400);
  });
  it('lists months newest first from withholding payments or returns, and returns two empty cards for an empty month', async () => {
    const { GenerateWhtReportUseCase } = await import('../../application/use-cases/generate-wht-report.use-case');
    const db: any = {
      company: { findUnique: async () => ({ timezone: 'Asia/Bangkok' }) },
      taxPeriod: { findMany: async () => [{ periodKey: '2026-07' }, { periodKey: '2026-09' }] },
      taxEvent: { findMany: async () => [{ periodKey: '2026-08' }, { periodKey: '2026-09' }] },
      expenseRecord: { findMany: async () => [] }, supplierPayment: { findMany: async () => [] },
    };
    db.whtFiling ??= { findMany: async () => [] };
    db.whtPayerModeFact ??= { findMany: async () => [] };
    db.branch ??= { findMany: async () => [] };
    db.$transaction = async (work: any) => work(db);
  db.company ??= { findUnique: async () => ({ timezone: 'Asia/Bangkok' }) };
  db.whtFilingLine ??= { findMany: async ({ where }: any) => (await db.whtFiling.findMany({ where: { companyId: ctx.companyId } })).filter((p: any) => p.status === 'FILED' && (!where.filing.formType || (p.formType ?? p.taxPeriodId) === where.filing.formType)).flatMap((p: any) => p.lines ?? []) };
  db.accountingCounterparty ??= { findMany: async () => [] };
  const reader = new GenerateWhtReportUseCase({ prisma: { client: db } } as any);
    assert.deepEqual(await reader.listMonths(ctx), { months: ['2026-09', '2026-08', '2026-07'] });
    db.taxPeriod.findMany = async () => []; db.taxEvent.findMany = async () => [];
    db.taxReviewIssue = { findMany: async () => [] };
    db.whtIncomeCategory = { findMany: async () => [] };
    const empty = await reader.getMonth(ctx, '2026-10');
    assert.equal(empty.forms.length, 2); assert.deepEqual(empty.payments, []);
    assert.ok(empty.forms.every(f => f.periodId === null && f.status === null && f.paymentCount === 0 && f.totalPaid === '0.0000'));
  });
});


it('narrow handlers keep the alias, both forms, prepare permissions and reviewer gate', async () => {
  const { REQUIRED_PERMISSIONS_KEY } = await import('../../../../common/security/permissions.decorator');
  const calls: any[] = [];
  const service = { execute: async (...args: any[]) => { calls.push(args); return {}; } } as any;
  const noop = {} as any;
  for (const form of ['PND3', 'PND53', undefined]) {
    const expected = form ?? 'PND53';
    const repo = withProfile({ findPeriodById: async () => ({ id: 'p', formType: expected, periodKey: '2026-09', status: 'OPEN' }),
      findEventsByPeriod: async () => [], findIssuesByPeriod: async () => [],
      prisma: { client: { taxReviewIssue: { findFirst: async () => ({ taxPeriodId: 'p' }) } } } });
    const value = new TaxController(service, noop, service, service, noop, noop, noop, noop, noop, noop, noop, noop, repo, noop);
    await value.syncPnd53(ctx, ctx.companyId, form);
    assert.deepEqual(calls.at(-1), [ctx.companyId, undefined, form === undefined ? 'PND53' : 'WHT']);
    await value.generatePnd53(ctx, ctx.companyId, 'p', form);
    assert.deepEqual(calls.at(-1), [ctx.companyId, expected, '2026-09']);
    await value.exportPnd53(ctx, ctx.companyId, 'p', { exportFormat: 'PDF' }, form);
    assert.deepEqual(calls.at(-1), [ctx, 'p', 'PDF', undefined, undefined]);
    await value.exportPnd53(ctx, ctx.companyId, 'p', { exportFormat: 'XLSX', establishmentCode: '00000', sequence: 2 }, form);
    assert.deepEqual(calls.at(-1), [ctx, 'p', 'XLSX', '00000', 2]);
    assert.deepEqual(await value.listPnd53Events(ctx, ctx.companyId, 'p', form), []);
    assert.deepEqual(await value.listPnd53Issues(ctx, ctx.companyId, 'p', form), []);
    for (const action of [() => value.markPnd53Filed({ ...ctx, roles: ['FINANCE'] }, ctx.companyId, 'p', {}, form),
      () => value.resolvePnd53Issue({ ...ctx, roles: ['FINANCE'] }, ctx.companyId, 'i', { note: 'ตรวจแล้ว' }, form)]) {
      await assert.rejects(action, (e: any) => e.getResponse().code === 'tax_reviewer_role_required');
    }
  }
  for (const method of ['syncPnd53', 'generatePnd53', 'exportPnd53', 'resolvePnd53Issue', 'markPnd53Filed'] as const) {
    const handler = TaxController.prototype[method];
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler), ['wht.pnd53.prepare']);
    assert.equal(Reflect.getMetadata('path', handler).length, 2);
  }
  for (const method of ['listWithholdingMonths', 'getWithholdingMonth'] as const) {
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, TaxController.prototype[method]), ['wht.pnd53.read']);
  }
});

it('offers a month with withheld source payments before its first sync', async () => {
  const { GenerateWhtReportUseCase } = await import('../../application/use-cases/generate-wht-report.use-case');
  const reader = new GenerateWhtReportUseCase({ prisma: { client: {
    company: { findUnique: async () => ({ timezone: 'Asia/Bangkok' }) },
    taxPeriod: { findMany: async () => [] }, taxEvent: { findMany: async () => [] },
    expenseRecord: { findMany: async ({ where }: any) => { assert.equal(where.status, 'CONFIRMED'); assert.deepEqual(where.whtAmount, { gt: 0 }); return [{ expenseDate: new Date('2026-10-28'), payments: [{ paidAt: new Date('2026-11-04T18:00:00Z') }] }]; } },
    supplierPayment: { findMany: async ({ where }: any) => { assert.equal(where.status, 'RECORDED'); return [{ paymentDate: new Date('2026-09-20') }]; } },
  } } } as any);
  assert.deepEqual(await reader.listMonths(ctx), { months: ['2026-11', '2026-09'] });
});


it('official export refusals return a stable 409 code and every current Thai reason for both forms', async (t) => {
  const { GenerateTaxFilingPackageUseCase } = await import('../../application/use-cases/generate-tax-filing-package.use-case');
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-05') });
  for (const formType of ['PND3', 'PND53']) {
    for (const reason of ['PAYER', 'REVIEW']) {
      const recorded: any[] = [];
      const period = { id: 'p', formType, periodKey: '2026-09', status: 'OPEN', dueDate: new Date('2026-10-07') };
      const repo = withProfile({
        findPeriodById: async () => period,
        findEventsByPeriod: async () => [{ id: 'event', eventDate: new Date('2026-09-10'), branchId: null }],
        findIssuesByPeriod: async () => reason === 'REVIEW' ? [{ id: 'missing', issueCode: 'MISSING_TAX_ID', description: 'ยังไม่มีเลขผู้เสียภาษี', severity: 'BLOCKING', sourceType: null, sourceId: null }] : [],
        createIssue: async (issue: any) => { recorded.push(issue); },
        prisma: { client: { taxReviewIssue: { findMany: async () => reason === 'REVIEW' ? [{ id: 'payer', issueCode: 'MISSING_TAX_ID', description: 'ยังไม่มีเลขผู้เสียภาษี', severity: 'BLOCKING', sourceType: null, sourceId: null, taxPeriod: { formType } }] : [] }, whtFiling: { findFirst: async () => null, findMany: async () => [] }, taxReportSnapshot: { findFirst: async () => null }, company: { findUnique: async () => ({}) },
          branch: { findMany: async () => [] }, whtPayerModeFact: { findMany: async () => [] }, whtIncomeCategory: { findMany: async () => [] } } },
      });
      const noop = {} as any;
      const filing = new GenerateTaxFilingPackageUseCase(repo as any, noop, noop, noop, noop);
      const value = new TaxController(noop, noop, noop, filing, noop, noop, noop, noop, noop, noop, noop, noop, repo as any, noop);
      await assert.rejects(value.exportPnd53(ctx, ctx.companyId, 'p', { exportFormat: 'PDF' }, formType), (error: any) => {
        assert.equal(error.getStatus(), 409);
        assert.equal(error.getResponse().code, `${formType}_FILING_${reason}`);
        assert.equal(error.getResponse().message, error.getResponse().issues[0].description);
        assert.ok(error.getResponse().issues.length > 1, 'one refusal exposes all current faults');
        assert.equal(recorded.length, 0);
        assert.match(error.getResponse().message, /[ก-๙]/);
        return true;
      });
    }
  }
});


it('both narrow filing routes reject changed payments with a Thai 409 and accept a fresh download', async () => {
  const { withholdingPaymentFacts } = await import('../../application/services/withholding-filing-state');
  for (const formType of ['PND3', 'PND53']) for (const exportFormat of ['PDF', 'XLSX']) {
    const first: any = { currency: 'THB', eventType: `WHT_${formType}`, payeeSnapshot: { name: 'ผู้รับเงิน', taxId: '1100700000001', address: 'กรุงเทพ', branchCode: null }, sourceType: 'expense.record', sourceId: 'expense-1', eventDate: new Date('2026-09-10'), grossAmount: '1000', withheldAmount: '30', whtRate: '3' };
    let events = [first], frozen = events.map(event => ({ lineJson: { payment: withholdingPaymentFacts(event) } })), updates = 0, syncs = 0;
    const pkg = { id: 'pkg', exportFormat, generatedAt: new Date() };
    const db: any = {
      $queryRaw: async () => [], taxReviewIssue: { findMany: async () => [] }, branch: { findMany: async () => [] }, whtPayerModeFact: { findMany: async () => [] },
      taxFilingPackage: { findFirst: async ({ where }: any) => { assert.ok(where.exportFormat.in.includes(exportFormat)); return pkg; }, update: async () => { updates++; } },
      whtFiling: { findMany: async () => [{ id: 'f', status: 'FILED', lines: frozen }], findFirst: async () => ({ id: 'f', establishmentCode: '00000', status: 'EXPORTED', rowsCertain: true, lines: frozen, latestPackage: pkg }), updateMany: async ({ data }: any) => { assert.equal(data.filedByUserId, ctx.userId); assert.ok(data.filedAt instanceof Date); updates++; return { count: 1 }; } },
      taxPeriod: { findFirst: async () => ({ status: 'EXPORTED' }), update: async () => { updates++; } },
      expenseRecord: { findMany: async () => events.map(event => expenseSourceForEvent(event)) },
      $transaction: async (operations: any) => typeof operations === 'function' ? operations(db) : Promise.all(operations),
      whtIncomeCategory: { findMany: async () => [] }, taxEvent: { findMany: async () => events.map(event => ({ ...event, payeeSnapshotJson: event.payeeSnapshot })) },
    };
    const repo = withProfile({ prisma: { client: db }, findPeriodById: async () => ({ id: 'p', formType, status: 'EXPORTED', periodKey: '2026-09' }),
      findEventsByPeriod: async () => events, findIssuesByPeriod: async () => [], markWithholdingFilingFiled: PrismaTaxRepository.prototype.markWithholdingFilingFiled });
    const noop = {} as any;
    const value = new TaxController({ execute: async () => { syncs++; } } as any, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, repo, { log: async () => {} } as any);
    for (const changed of [[first, { ...first, sourceId: 'expense-2' }], [], [{ ...first, withheldAmount: '60' }]]) {
      events = changed;
      await assert.rejects(value.markPnd53Filed(ctx, ctx.companyId, 'p', {}, formType), (e: any) => {
        assert.equal(e.getStatus(), 409); assert.equal(e.getResponse().code, 'WHT_FILING_CHANGED_AFTER_DOWNLOAD');
        assert.equal(e.getResponse().message, 'มีรายการเปลี่ยนหลังดาวน์โหลดแบบ ดาวน์โหลดแบบใหม่ก่อนยื่น'); return true;
      });
      assert.equal(updates, 0);
    }
    events = [first]; frozen = events.map(event => ({ lineJson: { payment: withholdingPaymentFacts(event) } }));
    await value.markPnd53Filed(ctx, ctx.companyId, 'p', {}, formType);
    assert.equal(updates, 3); assert.equal(syncs, 4);
    updates = 0;
    repo.prisma.client.$transaction = async (work: any) => {
      events = [...events, { ...first, sourceId: 'raced-payment' }];
      return typeof work === 'function' ? work(db) : Promise.all(work);
    };
    await assert.rejects(value.markPnd53Filed(ctx, ctx.companyId, 'p', {}, formType), (e: any) => e.getResponse().code === 'WHT_FILING_CHANGED_AFTER_DOWNLOAD');
    assert.equal(updates, 0, 'recheck the payment set inside the filing transaction');
  }
});


it('month payments sort by payment date then source recording time with a stable source tie-break', async () => {
  const { GenerateWhtReportUseCase } = await import('../../application/use-cases/generate-wht-report.use-case');
  const events = ['older', 'newer', 'same-time', 'next-day'].map((id, i) => ({ id, sourceId: id, sourceType: 'expense.record',
    eventType: 'WHT_PND3', eventDate: new Date(i === 3 ? '2026-09-11' : '2026-09-10'), createdAt: new Date(2030 - i, 1), grossAmount: '1000', withheldAmount: '30', payeeSnapshotJson: { name: id } }));
  const db: any = { taxPeriod: { findMany: async () => [] }, taxEvent: { findMany: async () => events }, taxReviewIssue: { findMany: async () => [] },
    expenseRecord: { findMany: async () => events.map(e => expenseSourceForEvent(e, { payments: [{ ...expenseSourceForEvent(e).payments[0], createdAt: new Date(e.id === 'older' ? '2026-09-12T01:00:00Z' : '2026-09-12T02:00:00Z') }] })) },
    whtIncomeCategory: { findMany: async () => [] }, whtCertificateHandoff: { findMany: async () => [] } };
  db.whtFiling ??= { findMany: async () => [] };
    db.whtPayerModeFact ??= { findMany: async () => [] };
    db.branch ??= { findMany: async () => [] };
    db.$transaction = async (work: any) => work(db);
  db.company ??= { findUnique: async () => ({ timezone: 'Asia/Bangkok' }) };
  db.whtFilingLine ??= { findMany: async ({ where }: any) => (await db.whtFiling.findMany({ where: { companyId: ctx.companyId } })).filter((p: any) => p.status === 'FILED' && (!where.filing.formType || (p.formType ?? p.taxPeriodId) === where.filing.formType)).flatMap((p: any) => p.lines ?? []) };
  db.accountingCounterparty ??= { findMany: async () => [] };
  const reader = new GenerateWhtReportUseCase({ prisma: { client: db } } as any);
  const read = async () => (await reader.getMonth(ctx, '2026-09')).payments.map(p => p.id);
  assert.deepEqual(await read(), ['next-day', 'same-time', 'newer', 'older']);
  events.reverse(); assert.deepEqual(await read(), ['next-day', 'same-time', 'newer', 'older']);
});


describe('payer mode foundation routes and additive month fields', () => {
  it('reads the chosen month, accepts only legal-identity managers, and preserves tenant boundaries', async () => {
    const { REQUIRED_PERMISSIONS_KEY, REQUIRED_ANY_PERMISSIONS_KEY } = await import('../../../../common/security/permissions.decorator');
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, TaxController.prototype.answerWhtPayerMode), ['company.legal_identity.manage']);
    assert.deepEqual(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, TaxController.prototype.getWhtPayerMode), ['wht.pnd53.read', 'company.legal_identity.manage', 'company.branch.read']);
    let saved = 0;
    const value = controller({
      readWhtPayerMode: async (companyId: string, month: string) => ({ companyId, periodKey: month, asked: true }),
      answerWhtPayerMode: async () => { saved++; return { asked: true }; },
    });
    assert.equal((await value.getWhtPayerMode(ctx, 'company-1', '2026-09')).periodKey, '2026-09');
    await assert.rejects(value.answerWhtPayerMode(ctx, 'company-1', { mode: 'EACH_BRANCH_PAYS' }), (e: any) => e.getResponse().code === 'WHT_PAYER_MODE_FORBIDDEN');
    await assert.rejects(value.answerWhtPayerMode({ ...ctx, permissions: ['company.legal_identity.manage'] }, 'other', { mode: 'EACH_BRANCH_PAYS' }), /company/i);
    await value.answerWhtPayerMode({ ...ctx, permissions: ['company.legal_identity.manage'] }, 'company-1', { mode: 'EACH_BRANCH_PAYS' });
    assert.equal(saved, 1);
  });
  it('retains every payment and unchanged cards while adding resolved or unanswered establishments', async () => {
    const { GenerateWhtReportUseCase } = await import('../../application/use-cases/generate-wht-report.use-case');
    const branches: any[] = [{ id: 'head', name: 'ร้าน', type: 'HEAD_OFFICE', status: 'ACTIVE', taxBranchCode: null }];
    const facts: any[] = [];
    const db: any = {
      branch: { findMany: async () => branches }, whtPayerModeFact: { findMany: async () => facts },
      taxPeriod: { findMany: async () => [] }, taxReviewIssue: { findMany: async () => [] },
      taxEvent: { findMany: async () => [{ id: 'e', branchId: null, sourceType: 'expense.record', sourceId: 'expense', eventType: 'WHT_PND3', eventDate: new Date('2026-09-01'), grossAmount: '1000', withheldAmount: '30' }] },
      expenseRecord: { findMany: async () => [expenseSourceForEvent({ id: 'e', sourceId: 'expense', branchId: 'branch', eventType: 'WHT_PND3', eventDate: new Date('2026-09-01'), grossAmount: '1000', withheldAmount: '30' })] }, supplierPayment: { findMany: async () => [] },
      whtIncomeCategory: { findMany: async () => [] }, whtCertificateHandoff: { findMany: async () => [] },
    };
    db.whtFiling ??= { findMany: async () => [] }; db.$transaction = async (fn: any) => fn(db);
  db.company ??= { findUnique: async () => ({ timezone: 'Asia/Bangkok' }) };
  db.whtFilingLine ??= { findMany: async ({ where }: any) => (await db.whtFiling.findMany({ where: { companyId: ctx.companyId } })).filter((p: any) => p.status === 'FILED' && (!where.filing.formType || (p.formType ?? p.taxPeriodId) === where.filing.formType)).flatMap((p: any) => p.lines ?? []) };
  db.accountingCounterparty ??= { findMany: async () => [] };
  const reader = new GenerateWhtReportUseCase({ prisma: { client: db } } as any);
    const one = await reader.getMonth(ctx, '2026-09');
    assert.deepEqual(one.payments[0].establishment, { kind: 'ESTABLISHMENT', code: '00000', branchId: 'head', name: 'สำนักงานใหญ่' });
    assert.deepEqual(one.establishments?.map(({ forms, ...e }) => e), [one.payments[0].establishment]);
    branches.push({ id: 'branch', name: 'สาขา', type: 'BRANCH', status: 'ACTIVE', taxBranchCode: null });
    const unanswered = await reader.getMonth(ctx, '2026-09');
    assert.deepEqual(unanswered.payments[0].establishment, { kind: 'SHOP_HAS_NOT_ANSWERED' });
    facts.push({ id: 'fact', mode: 'EACH_BRANCH_PAYS', effectiveFromPeriodKey: '2026-09', answeredAt: new Date(), supersededAt: null });
    const missing = await reader.getMonth(ctx, '2026-09');
    assert.equal(missing.payments.length, 1);
    assert.deepEqual(missing.payments[0].establishment, { kind: 'BRANCH_HAS_NO_CODE', branchId: 'branch' });
    assert.deepEqual(missing.establishments, []);
    assert.equal(missing.establishmentIssues?.[0].issueCode, 'WHT_BRANCH_HAS_NO_CODE'); assert.equal(missing.establishmentIssues?.[0].paymentCount, 1);
    branches[1].taxBranchCode = '00002';
    const resolved = await reader.getMonth(ctx, '2026-09');
    assert.deepEqual(resolved.establishments?.map(({ forms, ...e }) => e), [{ kind: 'ESTABLISHMENT', code: '00002', branchId: 'branch', name: 'สาขา' }]);
    assert.equal(resolved.forms[0].paymentCount, one.forms[0].paymentCount); assert.equal(resolved.forms[0].establishmentCode, '00002');
  });
});


it('payer mode body validates the two choices and a monthly boundary', async () => {
  const { validate } = await import('class-validator');
  const { AnswerWhtPayerModeDto } = await import('./tax.dtos');
  for (const body of [{ mode: 'HEAD_OFFICE_PAYS_ALL' }, { mode: 'EACH_BRANCH_PAYS', effectiveFromPeriodKey: '2026-09' }]) {
    assert.equal((await validate(Object.assign(new AnswerWhtPayerModeDto(), body))).length, 0);
  }
  for (const body of [{}, { mode: 'ANY' }, { mode: 'EACH_BRANCH_PAYS', effectiveFromPeriodKey: '2026-13' }]) {
    assert.ok((await validate(Object.assign(new AnswerWhtPayerModeDto(), body))).length > 0);
  }
});

it('month separates both forms by establishment, narrows faults, and keeps missing-code rows off every paper', async () => {
  const { GenerateWhtReportUseCase } = await import('../../application/use-cases/generate-wht-report.use-case');
  const address = { line1: '55 ถนนลาดพร้าว', subdistrict: 'จอมพล', district: 'จตุจักร', province: 'กรุงเทพมหานคร', postalCode: '10900' };
  const branches = [{ id: 'head', type: 'HEAD_OFFICE', status: 'ACTIVE', name: 'ร้าน', taxBranchCode: null },
    { id: 'b', type: 'BRANCH', status: 'ACTIVE', name: 'สาขาสอง', taxBranchCode: '00002', addressJson: address },
    { id: 'missing', type: 'BRANCH', status: 'ACTIVE', name: 'สาขายังไม่มีรหัส', taxBranchCode: null }];
  const events = ['head', 'b', 'missing'].flatMap(branchId => ['PND3', 'PND53'].map(form => ({
    id: `${branchId}-${form}`, sourceId: `${branchId}-${form}`, sourceType: 'expense.record', branchId, taxPeriodId: form, eventType: `WHT_${form}`, whtFormType: form,
    eventDate: new Date('2026-09-10'), currency: 'THB', incomeCategoryCode: form, whtRate: '3', grossAmount: '1000', withheldAmount: '30',
    payeeSnapshotJson: { name: 'ผู้รับเงิน', taxId: branchId === 'b' && form === 'PND3' ? null : '1100700000001', address: '55 กรุงเทพ 10110' },
  })));
  const facts: any[] = [{ mode: 'EACH_BRANCH_PAYS', effectiveFromPeriodKey: '2026-01', supersededAt: null }];
  const db: any = {
    branch: { findMany: async () => branches, findFirst: async ({ where }: any) => branches.find(b => b.id === where.id) }, whtPayerModeFact: { findMany: async () => facts },
    taxPeriod: { findMany: async () => ['PND3', 'PND53'].map(formType => ({ id: formType, formType, periodKey: '2026-09', status: 'OPEN', dueDate: new Date('2099-10-07') })) },
    taxEvent: { findMany: async ({ where }: any) => where.OR ? events.filter(e => where.OR[0].branchId.in.includes(e.branchId)) : events },
    expenseRecord: { findMany: async () => events.map(e => expenseSourceForEvent(e)) },
    supplierPayment: { findMany: async () => [] }, taxReviewIssue: { findMany: async () => [] }, whtFiling: { findMany: async () => [] },
    company: { findUnique: async () => ({ registeredName: 'ร้าน', taxId: '0994000163011', addressJson: address }) }, companyTaxProfile: { findUnique: async () => null },
    whtIncomeCategory: { findMany: async () => ['PND3', 'PND53'].map(code => ({ code, formType: code, nameTh: 'ค่าบริการ' })) },
    whtCertificateHandoff: { findMany: async () => [] },
    $transaction: async (fn: any) => fn(db),
  };
  db.company ??= { findUnique: async () => ({ timezone: 'Asia/Bangkok' }) };
  db.whtFilingLine ??= { findMany: async ({ where }: any) => (await db.whtFiling.findMany({ where: { companyId: ctx.companyId } })).filter((p: any) => p.status === 'FILED' && (!where.filing.formType || (p.formType ?? p.taxPeriodId) === where.filing.formType)).flatMap((p: any) => p.lines ?? []) };
  db.accountingCounterparty ??= { findMany: async () => [] };
  const reader = new GenerateWhtReportUseCase({ prisma: { client: db } } as any);
  const month = await reader.getMonth(ctx, '2026-09');
  assert.equal(month.payments.length, 6);
  assert.deepEqual(month.establishments?.map(e => [e.code, e.forms.map(f => f.paymentCount)]), [['00000', [1, 1]], ['00002', [1, 1]]]);
  assert.equal(month.establishments?.[0].forms[0].canDownload, true);
  assert.equal(month.establishments?.[1].forms[0].canDownload, false);
  assert.equal(month.establishments?.[1].forms[1].canDownload, true);
  assert.equal(month.establishmentIssues?.[0].issueCode, 'WHT_BRANCH_HAS_NO_CODE');
  assert.equal(month.establishmentIssues?.[0].paymentCount, 2);
  const scoped = await reader.getMonth({ ...ctx, scopes: { branchIds: ['b'] } }, '2026-09');
  assert.deepEqual(scoped.establishments?.map(e => e.code), ['00002']);
  assert.equal(scoped.payments.length, 2);
  const head = events.find(e => e.id === 'head-PND3') ?? events.find(e => e.branchId === 'h' && e.whtFormType === 'PND3') ?? events[0];
  db.whtFiling.findMany = async () => [{ id: 'filed-head', taxPeriodId: 'PND3', establishmentCode: '00000', establishmentBranchId: head.branchId, status: 'FILED', rowsCertain: true, preparedBy: 'SYSTEM', lines: [{ sourceType: head.sourceType, sourceId: head.sourceId, lineJson: { payment: [null, null, null, null, null, null, '1000', '30'] } }] }];
  events.push({ ...head, id: 'late-head', sourceId: 'late-head' });
  const late = await reader.getMonth(ctx, '2026-09');
  assert.equal(late.establishments?.find(e => e.code === '00000')?.forms[0].unfiledPaymentCount, 1);
  assert.equal(late.establishments?.find(e => e.code === '00000')?.forms[0].paymentCount, 1, 'filed totals stay frozen');
  const additionalForm = late.establishments!.find(e => e.code === '00000')!.forms[0];
  assert.equal(additionalForm.paymentBasisChanged, true, 'old filed document-date rows with no recorded payment require accountant review');
  assert.deepEqual(additionalForm.papers?.map(p => [p.sequence, p.status, p.paymentCount, p.totalWithheld]), [[0, 'FILED', 1, '30.0000'], [1, 'OPEN', 1, '30.0000']]);
  assert.deepEqual(additionalForm.monthTotals, { paymentCount: 2, totalPaid: '2000.0000', totalWithheld: '60.0000' });
  assert.equal(additionalForm.papers?.[1].noticeCode, 'WHT_ADDITIONAL_SURCHARGE_MANUAL');
  assert.equal(late.payments.find(p => p.sourceId === 'late-head')?.paper?.sequence, 1);
  assert.equal(late.payments.find(p => p.sourceId === head.sourceId)?.paper?.sequence, 0);
  assert.equal(additionalForm.papers?.[1].canDownload, true);
  assert.equal(additionalForm.papers?.[1].canMarkFiled, false);
  const kept = await db.whtFiling.findMany();
  kept.push({ ...kept[0], id: 'filed-additional', sequence: 1, lines: [{ sourceType: head.sourceType, sourceId: 'late-head', lineJson: { payment: [null, null, null, null, null, null, '1000', '30'] } }] });
  db.whtFiling.findMany = async () => kept;
  const closed = await reader.getMonth(ctx, '2026-09');
  assert.deepEqual(closed.establishments!.find(e => e.code === '00000')!.forms[0].papers!.map(p => p.sequence), [0, 1], 'no empty next additional paper');
  events.push({ ...head, id: 'late-head-2', sourceId: 'late-head-2' });
  const next = await reader.getMonth(ctx, '2026-09');
  const nextForm = next.establishments!.find(e => e.code === '00000')!.forms[0];
  assert.deepEqual(nextForm.papers!.map(p => [p.sequence, p.status, p.paymentCount]), [[0, 'FILED', 1], [1, 'FILED', 1], [2, 'OPEN', 1]]);
  assert.equal(nextForm.monthTotals!.totalWithheld, '90.0000');
  assert.equal(next.payments.find(p => p.sourceId === 'late-head-2')?.paper?.sequence, 2);
  assert.equal(next.payments.find(p => p.sourceId === 'late-head')?.paper?.sequence, 1);
  // Cancellation is read from the source, but totals and rows remain those filed.
  const originalReader = db.expenseRecord.findMany;
  kept[0].lines[0].lineJson.payment[9] = 'ผู้รับเงิน';
  kept[0].lines[0].lineJson.payment[10] = '1100700000001';
  db.expenseRecord.findMany = async (query: any) => (await originalReader(query)).map((row: any) => row.id === head.sourceId
    ? { ...row, status: 'VOIDED', voidedAt: new Date('2026-10-12'), voidedByUserId: 'canceller' } : row);
  const cancelled = await reader.getMonth(ctx, '2026-09');
  const cancelledForm = cancelled.establishments!.find(e => e.code === '00000')!.forms[0];
  assert.equal(cancelledForm.papers![0].cancellations![0].cancelledByUserId, 'canceller');
  assert.equal(cancelledForm.papers![0].totalWithheld, '30.0000');
  assert.deepEqual(cancelledForm.papers![2].cancelledPayeeNames, ['ผู้รับเงิน']);
  assert.equal(cancelledForm.papers![2].totalWithheld, '30.0000', 'new payment enters in full, never netted');
  kept[0].rowsCertain = false;
  const uncertain = await reader.getMonth({ ...ctx, permissions: ['wht.pnd53.prepare'] }, '2026-09');
  const uncertainForm = uncertain.establishments!.find(e => e.code === '00000')!.forms[0];
  assert.equal(uncertainForm.papers![0].canConfirmRows, true);
  assert.equal(uncertainForm.papers![0].canDownload, false);
  assert.equal(uncertainForm.papers![0].rowsUncertainNotice, 'รายการของแบบที่ยื่นไว้ตรวจได้ไม่ครบ ให้ผู้ทำบัญชีเทียบกับแบบที่ยื่นจริง');
  assert.equal(uncertain.payments.find(p => p.sourceId === 'late-head-2')?.paper, null);
  assert.equal(uncertainForm.papers!.some(p => p.sequence === 2), false);
  const readOnly = await reader.getMonth(ctx, '2026-09');
  assert.equal(readOnly.establishments![0].forms[0].papers![0].canConfirmRows, false);
  kept[0].rowsCertain = true;
  kept[0].payerSnapshotJson = { rowsConfirmation: { userId: 'accountant', at: '2026-10-14T01:00:00Z' } };
  db.user = { findMany: async () => [{ id: 'accountant', displayName: 'สมใจ' }] };
  const confirmed = await reader.getMonth(ctx, '2026-09');
  assert.equal(confirmed.establishments![0].forms[0].papers![0].rowsConfirmation?.displayName, 'สมใจ');
  db.expenseRecord.findMany = originalReader;
  events.pop();


  events.pop(); db.whtFiling.findMany = async () => [];
  facts.length = 0;
  const unanswered = await reader.getMonth(ctx, '2026-09');
  assert.equal(unanswered.establishments?.length, 0);
  assert.equal(unanswered.establishmentIssues?.[0].issueCode, 'WHT_PAYER_MODE_REQUIRED');
  assert.ok(unanswered.forms.every(f => !f.canDownload));
  assert.ok(unanswered.forms.every(f => !f.issues.some(i => i.issueCode.endsWith('_FILING_BRANCHES'))), 'only the linked question, not the old branch fault');
  db.taxFilingPackage = { findFirst: async () => null };
  for (const blocked of ['PND3', 'PND53']) {
    const original = [...events];
    events.splice(0, events.length, ...original.filter(e => e.whtFormType === blocked || e.branchId === 'head'));
    db.whtFiling.findMany = async () => [{ id: 'downloaded', taxPeriodId: blocked, establishmentCode: '00000', establishmentBranchId: 'head', status: 'EXPORTED', rowsCertain: true, sequence: 0, lines: [] }];
    const mixed = await reader.getMonth(ctx, '2026-09');
    const waiting = mixed.forms.find(f => f.formType === blocked)!;
    assert.equal(waiting.monthTotals?.paymentCount, 3, 'earlier download must not hide the unanswered form’s rows');
    assert.equal(waiting.canDownload, false);
    assert.equal(mixed.forms.find(f => f.formType !== blocked)?.canDownload, true, 'the one-branch form stays downloadable');
    assert.ok(mixed.forms.every(f => !f.issues.some(i => i.issueCode.endsWith('_FILING_EMPTY') || i.issueCode.endsWith('_FILING_BRANCHES'))));
    events.splice(0, events.length, ...original);
  }
  facts.push({ mode: 'EACH_BRANCH_PAYS', effectiveFromPeriodKey: '2026-01', supersededAt: null });
  db.whtFiling.findMany = async () => [];
  events.splice(events.findIndex(e => e.id === 'b-PND53'), 1);
  const empty = (await reader.getMonth(ctx, '2026-09')).establishments!.find(e => e.code === '00002')!.forms[1];
  assert.equal(empty.paymentCount, 0);
  assert.deepEqual(empty.issues, [], 'an empty establishment form is a fact, not a sync warning');

});

it('filing one establishment files only its frozen paper and leaves the other payment unlocked', async () => {
  const { withholdingPaymentFacts } = await import('../../application/services/withholding-filing-state');
  const { filedWithholdingPaymentPeriods } = await import('../../application/services/filed-withholding-payment');
  const events: any[] = ['head', 'b'].map((branchId, i) => ({ currency: 'THB', eventType: 'WHT_PND3', payeeSnapshot: { name: 'ผู้รับเงิน', taxId: '1100700000001', address: 'กรุงเทพ', branchCode: null }, sourceType: 'expense.record', sourceId: branchId, branchId,
    eventDate: new Date('2026-09-10'), grossAmount: '1000', withheldAmount: '30', whtRate: '3', payeeSnapshotJson: { name: 'ผู้รับเงิน', taxId: '1100700000001', address: 'กรุงเทพ', branchCode: null } }));
  const currentIssues = [{ issueCode: 'MISSING_TAX_ID', severity: 'BLOCKING', sourceType: 'expense.record', sourceId: 'b', description: 'ผู้รับเงินยังไม่มีเลขผู้เสียภาษี เปิดคู่ค้าแล้วกรอกเลข' }];
  const papers: any[] = events.map((event, i) => ({ sequence: 0, id: `f${i}`, establishmentCode: i ? '00002' : '00000', filingPackageId: `pkg${i}`, status: 'EXPORTED', rowsCertain: true,
    latestPackage: { id: `pkg${i}` }, lines: [{ sourceType: event.sourceType, sourceId: event.sourceId, lineJson: { payment: withholdingPaymentFacts(event) } }] }));
  const period = { id: 'p', formType: 'PND3', periodKey: '2026-09', status: 'EXPORTED' };
  const db: any = {
    $queryRaw: async () => [], $transaction: async (fn: any) => fn(db), taxReviewIssue: { findMany: async () => currentIssues.map(i => ({ ...i, taxPeriod: { formType: 'PND3' } })) },
    branch: { findMany: async () => [{ id: 'head', type: 'HEAD_OFFICE', status: 'ACTIVE', taxBranchCode: null }, { id: 'b', type: 'BRANCH', status: 'ACTIVE', taxBranchCode: '00002' }] },
    whtPayerModeFact: { findMany: async () => [{ mode: 'EACH_BRANCH_PAYS', effectiveFromPeriodKey: '2026-01', supersededAt: null }] },
    company: { findUnique: async () => ({ timezone: 'Asia/Bangkok' }) }, whtIncomeCategory: { findMany: async () => [] }, whtFilingLine: { findMany: async () => papers.filter(p => p.status === 'FILED').flatMap(p => p.lines) },
    taxEvent: { findMany: async () => events }, expenseRecord: { findMany: async () => events.map(e => expenseSourceForEvent(e, { vendorTaxIdSnapshot: e.sourceId === 'b' && currentIssues.length ? null : e.payeeSnapshot.taxId })) },
    whtFiling: {
      findMany: async () => papers,
      findFirst: async ({ where }: any) => papers.find(p => (!where.establishmentCode || where.establishmentCode === p.establishmentCode) && (!where.filingPackageId || where.filingPackageId === p.filingPackageId) && (where.sequence === undefined || where.sequence === p.sequence)),
      updateMany: async ({ where, data }: any) => { const p = papers.find(p => p.id === where.id && p.status === where.status)!; Object.assign(p, data); return { count: 1 }; },
    }, taxFilingPackage: { update: async () => {} },
    taxPeriod: { update: async ({ data }: any) => Object.assign(period, data), findMany: async ({ where }: any) => papers.some(p => p.status === 'FILED' && p.lines.some((l: any) => l.sourceId === where.whtFilings?.some.lines.some.sourceId)) ? [period] : [] },
  };
  const repo = withProfile({ prisma: { client: db }, findPeriodById: async () => period, markWithholdingFilingFiled: PrismaTaxRepository.prototype.markWithholdingFilingFiled });
  const noop = {} as any;
  const controller = new TaxController({ execute: async () => {} } as any, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, repo, { log: async () => {} } as any);
  await controller.markPnd53Filed(ctx, ctx.companyId, 'p', { establishmentCode: '00000' }, 'PND3');
  assert.deepEqual(papers.map(p => p.status), ['FILED', 'EXPORTED']); assert.equal(period.status, 'EXPORTED');
  assert.equal((await filedWithholdingPaymentPeriods(db, ctx.companyId, 'expense.record', 'head')).length, 1);
  assert.equal((await filedWithholdingPaymentPeriods(db, ctx.companyId, 'expense.record', 'b')).length, 0);
  await assert.rejects(controller.markPnd53Filed(ctx, ctx.companyId, 'p', { establishmentCode: '00002' }, 'PND3'), (e: any) => e.getResponse().code === 'PND3_FILING_REVIEW');
  currentIssues.length = 0;
  await controller.markPnd53Filed(ctx, ctx.companyId, 'p', { establishmentCode: '00002' }, 'PND3');
  assert.equal(period.status, 'FILED');
  const originals = structuredClone(papers);
  for (const sequence of [1, 2]) {
    const late = { ...events[0], sourceId: `late-${sequence}` };
    events.push(late); period.status = 'EXPORTED';
    papers.push({ id: `additional-${sequence}`, establishmentCode: '00000', sequence, filingPackageId: `additional-pkg-${sequence}`, status: 'EXPORTED', rowsCertain: true,
      latestPackage: { id: `additional-pkg-${sequence}` }, lines: [{ sourceType: late.sourceType, sourceId: late.sourceId, lineJson: { payment: withholdingPaymentFacts(late) } }] });
    await controller.markPnd53Filed(ctx, ctx.companyId, 'p', { establishmentCode: '00000', sequence }, 'PND3');
    assert.equal(papers.at(-1).status, 'FILED');
    assert.equal(period.status, 'FILED');
    assert.deepEqual(papers.slice(0, 2), originals);
  }
});

it('legacy filed forms cannot be filed again or replaced without a preserved paper', async () => {
  for (const formType of ['PND3', 'PND53']) {
    const period = { id: 'old', formType, periodKey: '2026-09', status: 'FILED', whtFilings: [] };
    const db: any = { $queryRaw: async () => [], $transaction: async (fn: any) => fn(db),
      taxPeriod: { findMany: async ({ where }: any) => where.whtFilings ? [] : [period] } };
    const repo = withProfile({ prisma: { client: db }, findPeriodById: async () => period });
    const noop = {} as any;
    const value = new TaxController({ execute: async () => {} } as any, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, repo, { log: async () => {} } as any);
    await assert.rejects(value.markFiled(ctx, ctx.companyId, 'old', {}), (e: any) => e.getResponse?.().code === 'WHT_FILING_ALREADY_FILED');
  }
});


it('export and filing bodies accept only non-negative integer paper sequences', async () => {
  const { validate } = await import('class-validator');
  const { ExportPnd53Dto, ExportTaxPackageDto, MarkPnd53FiledDto } = await import('./tax.dtos');
  for (const Dto of [ExportPnd53Dto, ExportTaxPackageDto, MarkPnd53FiledDto]) {
    for (const sequence of [undefined, 0, 1, 2]) assert.equal((await validate(Object.assign(new Dto(), { exportFormat: 'PDF', sequence }))).length, 0);
    for (const sequence of [-1, 1.5, '1', NaN]) assert.ok((await validate(Object.assign(new Dto(), { exportFormat: 'PDF', sequence }))).length > 0);
  }
});

it('confirmation is a validated prepare-only command scoped to the route company', async () => {
  const { validate } = await import('class-validator');
  const { ConfirmWhtFilingRowsDto } = await import('./tax.dtos');
  assert.equal((await validate(Object.assign(new ConfirmWhtFilingRowsDto(), { confirmed: true }))).length, 0);
  assert.ok((await validate(Object.assign(new ConfirmWhtFilingRowsDto(), { confirmed: false }))).length > 0);
  assert.ok((await validate(new ConfirmWhtFilingRowsDto())).length > 0);
  const value = controller({}); let called = 0;
  (value as any).generateFilingPackage = { confirmRows: async (_ctx: any, id: string) => { called++; assert.equal(id, 'f'); return { confirmed: true }; } };
  const permissions = Reflect.getMetadata('watchdog:requiredPermissions', TaxController.prototype.confirmWhtFilingRows);
  assert.ok(JSON.stringify(permissions).includes('wht.pnd53.prepare'));
  await assert.rejects(value.confirmWhtFilingRows(ctx, 'other', 'f', { confirmed: true }));
  assert.equal(called, 0);
  assert.deepEqual(await value.confirmWhtFilingRows(ctx, ctx.companyId, 'f', { confirmed: true }), { confirmed: true });
});

it('W4 month read exposes undated payments without assigning a month or creating a paper', async () => {
  const { GenerateWhtReportUseCase } = await import('../../application/use-cases/generate-wht-report.use-case');
  const db: any = { taxReviewIssue: { findMany: async () => [] }, taxPeriod: { findMany: async () => [] }, taxEvent: { findMany: async () => [] },
    whtIncomeCategory: { findMany: async () => [] }, branch: { findMany: async () => [] }, whtPayerModeFact: { findMany: async () => [] },
    whtFiling: { findMany: async () => [] }, whtCertificateHandoff: { findMany: async () => [] },
    expenseRecord: { findMany: async ({ where }: any) => { assert.equal(where.status, 'CONFIRMED'); assert.equal(where.whtAmount.gt, 0); return [expenseSourceForEvent({ id: 'e', sourceId: 'e', grossAmount: '100', withheldAmount: '3', eventDate: new Date('2026-11-09') }, { vendorNameSnapshot: 'สมชาย', payments: [{ id: 'p', paidAt: new Date('2026-11-09'), paidAtConfirmed: false, status: 'RECORDED', amount: '97', createdAt: new Date('2026-11-09'), createdByUserId: 'u' }] })]; } },
    $transaction: async (fn: any) => fn(db) };
  db.company ??= { findUnique: async () => ({ timezone: 'Asia/Bangkok' }) };
  db.whtFilingLine ??= { findMany: async () => [] };
  const month = await new GenerateWhtReportUseCase({ prisma: { client: db } } as any).getMonth(ctx, '2026-10');
  assert.deepEqual(month.payments, []);
  assert.deepEqual(month.undatedPayments, [{ paymentId: 'p', expenseId: 'e', payeeName: 'สมชาย', amount: '97', recordedAt: '2026-11-09T00:00:00.000Z', recordedByUserId: 'u' }]);
  assert.equal(month.forms.every(f => f.paymentCount === 0), true);
});


it('WHT-OUTSIDE-2 file routes keep external-link mutation permission and the handoff read boundary', async () => {
  const { REQUIRED_ANY_PERMISSIONS_KEY, REQUIRED_PERMISSIONS_KEY } = await import('../../../../common/security/permissions.decorator');
  for (const handler of [TaxController.prototype.externalWhtFileIntent, TaxController.prototype.completeExternalWhtFile]) {
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler), ['wht.external_certificate.link']);
  }
  assert.deepEqual(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, TaxController.prototype.externalWhtFile), ['wht.certificate.read', 'wht.certificate.issue', 'wht.certificate.correct', 'wht.external_certificate.link']);
  let calls = 0;
  const value = Object.assign(Object.create(TaxController.prototype), { whtHandoffs: { externalFileIntent: async () => { calls++; }, completeExternalFile: async () => { calls++; }, externalFile: async () => { calls++; } } });
  await assert.rejects(() => value.externalWhtFileIntent(ctx, 'other-company', 'handoff', {}), /company/i);
  await assert.rejects(() => value.completeExternalWhtFile(ctx, 'other-company', 'handoff', 'file', {}), /company/i);
  await assert.rejects(() => value.externalWhtFile(ctx, 'other-company', 'handoff', 'file'), /company/i);
  assert.equal(calls, 0);
});


it('R10 exported paper cannot be filed with omitted payments', async () => {
  const { withholdingPaymentFacts } = await import('../../application/services/withholding-filing-state');
  for (const formType of ['PND3', 'PND53']) {
    const event: any = { id: 'event', eventType: `WHT_${formType}`, sourceType: 'expense.record', sourceId: 'good', eventDate: new Date('2026-09-10'), grossAmount: '1000', withheldAmount: '30', whtRate: '3' };
    let writes = 0;
    const issue = { id: 'hidden-issue', sourceType: 'expense.record', sourceId: 'secret', issueCode: 'WHT_PAYEE_KIND_UNKNOWN', severity: 'BLOCKING', description: 'secret name', taxPeriod: { formType: 'PND53', periodKey: '2026-09' } };
    const db: any = { $queryRaw: async () => [], taxEvent: { findMany: async () => [event] },
      taxReviewIssue: { findMany: async () => [issue] },
      branch: { findMany: async () => [{ id: 'head', type: 'HEAD_OFFICE', status: 'ACTIVE', name: 'สำนักงานใหญ่', taxBranchCode: '00000' }, { id: 'secret-branch', type: 'BRANCH', status: 'ACTIVE', name: 'hidden', taxBranchCode: '00002' }] },
      whtPayerModeFact: { findMany: async () => [{ mode: 'HEAD_OFFICE_PAYS_ALL', effectiveFromPeriodKey: '2026-01', supersededAt: null }] },
      expenseRecord: { findMany: async ({ where }: any) => where.whtAmount ? [{ id: 'secret', companyId: ctx.companyId, branchId: 'secret-branch', status: 'CONFIRMED',
        expenseDate: new Date('2026-09-10'), updatedAt: new Date(), vendorNameSnapshot: 'secret name', vendorEntityKindSnapshot: null, vendorCounterpartyId: null, vendorAddressSnapshot: 'hidden',
        whtAmount: '30', netPayableAmount: '970', taxableAmount: '1000', grandTotalAmount: '1000', whtRate: '3', lines: [],
        payments: [{ id: 'secret-pay', status: 'RECORDED', amount: '970', paidAtConfirmed: true, paidAt: new Date('2026-09-10'), createdAt: new Date() }] }] : [{ id: 'good' }] },
      company: { findUnique: async () => ({ timezone: 'Asia/Bangkok' }) },
      whtIncomeCategory: { findMany: async () => [] }, whtFilingLine: { findMany: async () => [] },
      whtFiling: { findFirst: async () => ({ id: 'paper', status: 'EXPORTED', rowsCertain: true, latestPackage: { id: 'pkg' }, lines: [{ lineJson: { payment: withholdingPaymentFacts(event) } }] }) },
    };
    db.$transaction = async (fn: any) => fn(db);
    const repo = withProfile({ prisma: { client: db }, findPeriodById: async () => ({ id: 'p', formType, status: 'EXPORTED', periodKey: '2026-09' }), markWithholdingFilingFiled: async () => { writes++; } });
    const noop = {} as any;
    const value = new TaxController({ execute: async () => {} } as any, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, repo, { log: async () => {} } as any);
    await assert.rejects(value.markFiled({ ...ctx, scopes: { branchIds: ['head'] } }, ctx.companyId, 'p', {}), (error: any) => {
      const response = error.getResponse();
      assert.equal(response.code, `${formType}_FILING_REVIEW`);
      assert.equal(response.message, E_WHT_WORDS['W-T5']);
      assert.doesNotMatch(JSON.stringify(response), /secret|hidden-issue|"hidden"/); return true;
    });
    assert.equal(writes, 0);
  }
});

it('R10 rejects a payment date or source edited after sync before download or markFiled', async () => {
  const { GenerateTaxFilingPackageUseCase } = await import('../../application/use-cases/generate-tax-filing-package.use-case');
  const { withholdingPaymentFacts, withholdingPaymentChecksum } = await import('../../application/services/withholding-filing-state');
  const { computeSourceHash } = await import('../../domain/logic/tax-event.logic');
  for (const formType of ['PND3', 'PND53']) for (const change of ['date', 'payee', 'amount', 'kind', 'void', 'branch', 'revision']) {
    const period: any = { id: 'period', companyId: ctx.companyId, formType, periodKey: '2026-09', status: 'EXPORTED', dueDate: new Date('2099-10-07') };
    const payment: any = { id: 'payment', amount: '970', status: 'RECORDED', paidAtConfirmed: true, paidAt: new Date('2026-09-10'), createdAt: new Date('2026-09-10') };
    const source: any = { id: 'source', companyId: ctx.companyId, branchId: null, status: 'CONFIRMED', expenseDate: new Date('2026-09-01'), updatedAt: new Date('2026-09-10'),
      vendorCounterpartyId: null, vendorNameSnapshot: 'ผู้รับเงิน', vendorTaxIdSnapshot: '1100700000001', vendorBranchCodeSnapshot: null, vendorAddressSnapshot: 'กรุงเทพ',
      vendorEntityKindSnapshot: formType === 'PND3' ? 'INDIVIDUAL' : 'JURISTIC', whtAmount: '30', netPayableAmount: '970', taxableAmount: '1000', grandTotalAmount: '1000', whtRate: '3', whtCategoryCode: 'SERVICE', lines: [], payments: [payment] };
    const event: any = { id: 'event', taxPeriodId: period.id, periodKey: period.periodKey, eventType: `WHT_${formType}`, sourceType: 'expense.record', sourceId: source.id, sourceLineKey: 'payment:payment', branchId: null,
      eventDate: new Date('2026-09-10'), currency: 'THB', incomeCategoryCode: 'SERVICE', grossAmount: '1000', withheldAmount: '30', whtRate: '3',
      payeeSnapshot: { name: 'ผู้รับเงิน', taxId: '1100700000001', branchCode: null, address: 'กรุงเทพ' } };
    event.sourceHash = computeSourceHash({ sourceLineKey: event.sourceLineKey, paymentDate: event.eventDate.toISOString(), grossAmount: '1000', whtAmount: '30', updatedAt: source.updatedAt.toISOString(), incomeCategoryCode: 'SERVICE' });
    const frozen = [{ sourceType: event.sourceType, sourceId: event.sourceId, lineJson: { payment: withholdingPaymentFacts(event) } }];
    let packages = 0, filed = 0, objects = 0, numbers = 0;
    const db: any = { $queryRaw: async () => [],
      company: { findUnique: async () => ({ timezone: 'Asia/Bangkok', baseCurrency: 'THB', registeredName: 'ร้าน', taxId: '1100700000001', addressJson: { line1: '1 ถนน', subdistrict: 'บางนา', district: 'บางนา', province: 'กรุงเทพมหานคร', postalCode: '10260' } }) },
      companyTaxProfile: { findUnique: async () => null }, branch: { findMany: async () => [] }, whtPayerModeFact: { findMany: async () => [] },
      taxReviewIssue: { findMany: async () => [] }, taxEvent: { findMany: async () => [{ ...event, payeeSnapshotJson: event.payeeSnapshot }] },
      expenseRecord: { findMany: async ({ where }: any) => !where.status || where.status === source.status ? [source] : [] },
      expensePayment: { findMany: async () => payment.status === 'RECORDED' ? [payment] : [] },
      whtIncomeCategory: { findMany: async () => [{ code: 'SERVICE', formType, nameTh: 'ค่าบริการ', filingRoute: 'SYSTEM_FILLS' }] },
      whtFilingLine: { findMany: async () => [] },
      whtFiling: { findMany: async () => [], findFirst: async ({ where }: any) => where.status === 'FILED' ? null : ({ id: 'paper', status: 'EXPORTED', rowsCertain: true, latestPackage: { id: 'pkg' }, lines: frozen }) },
      taxReportSnapshot: { findFirst: async () => null }, taxPeriod: { update: async () => {}, findMany: async () => [] }, taxFilingPackage: { update: async () => {} },
    };
    db.$transaction = async (fn: any) => fn(db);
    const repo: any = { prisma: { client: db }, findPeriodById: async () => period, findEventsByPeriod: async () => [event], findIssuesByPeriod: async () => [],
      recordWithholdingDownload: async () => { packages++; return { id: 'new-pkg', generatedAt: new Date(), createdAt: new Date() }; }, markWithholdingFilingFiled: async () => { filed++; } };
    const noop: any = {};
    const exporter = new GenerateTaxFilingPackageUseCase(repo, { execute: async () => { numbers++; return { id: 'number', documentNumber: 'number' }; } } as any, { execute: async () => {} } as any, { log: async () => {} } as any,
      { putObject: async () => { objects++; return {}; } } as any);
    (exporter as any).buildWithholdingArtifact = async () => ({ fileName: 'test.pdf', mimeType: 'application/pdf', contentBase64: '', checksum: 'test', byteLength: 0 });
    const controller = new TaxController({ execute: async () => {} } as any, noop, noop, exporter, noop, noop, noop, noop, noop, noop, noop, noop, repo, { log: async () => {} } as any);
    if (change === 'date') payment.paidAt = new Date('2026-10-01');
    if (change === 'payee') source.vendorTaxIdSnapshot = null;
    if (change === 'amount') source.whtAmount = '60';
    if (change === 'kind') source.vendorEntityKindSnapshot = formType === 'PND3' ? 'JURISTIC' : 'INDIVIDUAL';
    if (change === 'void') payment.status = 'VOIDED';
    if (change === 'branch') { source.branchId = 'changed-branch'; source.updatedAt = new Date('2026-09-11'); }
    if (change === 'revision') source.updatedAt = new Date('2026-09-11');
    const refuses = (error: any) => { assert.equal(error.getStatus(), 409); assert.ok(error.getResponse().code.includes('FILING_')); return true; };
    await assert.rejects(exporter.execute(ctx, period.id, 'PDF'), refuses, `${formType}/${change}/download`);
    await assert.rejects(controller.markFiled(ctx, ctx.companyId, period.id, {}), refuses, `${formType}/${change}/markFiled`);
    assert.deepEqual({ packages, filed, objects, numbers }, { packages: 0, filed: 0, objects: 0, numbers: 0 });
    // Exercise the repository recheck after preflight with the old event checksum too.
    await assert.rejects(new PrismaTaxRepository({ client: db } as any).recordWithholdingDownload({ ctx, period, exportFormat: 'PDF', exportNumber: 'reserved',
      establishmentCode: '00000', establishmentBranchId: null, preparedBy: 'SYSTEM', payerSnapshotJson: {}, rowsChecksum: withholdingPaymentChecksum([event]), rowsCertain: true,
      artifact: {} as any, stored: {} as any, lines: [{ taxEventId: event.id, sourceType: event.sourceType, sourceId: event.sourceId, lineJson: frozen[0].lineJson }] }), refuses);
    assert.deepEqual({ packages, filed, objects, numbers }, { packages: 0, filed: 0, objects: 0, numbers: 0 });
  }
});

it('R10 source-only corrections and FILED omission warnings follow payment coverage and form sequences', async () => {
  const { GenerateWhtReportUseCase } = await import('../../application/use-cases/generate-wht-report.use-case');
  const { withholdingPaymentFacts } = await import('../../application/services/withholding-filing-state');
  const periods: any[] = ['PND3', 'PND53'].map(formType => ({ id: formType, formType, periodKey: '2026-09', status: 'OPEN', dueDate: new Date('2099-10-07') }));
  const good: any = { id: 'good-event', sourceType: 'expense.record', sourceId: 'good', sourceLineKey: 'payment:good-payment', branchId: 'head', eventType: 'WHT_PND3', taxPeriodId: 'PND3', periodKey: '2026-09',
    eventDate: new Date('2026-09-10'), currency: 'THB', incomeCategoryCode: 'PND3', grossAmount: '1000', withheldAmount: '30', whtRate: '3', payeeSnapshotJson: { name: 'ผู้รับเงินครบ', taxId: '1100700000001', address: 'กรุงเทพ', branchCode: null } };
  const bad: any = { ...good, id: 'bad-event', sourceId: 'bad', sourceLineKey: 'payment:bad-payment', branchId: 'branch', payeeSnapshotJson: { ...good.payeeSnapshotJson, name: 'ผู้รับเงินที่ต้องแก้', taxId: null } };
  const sources: any[] = [expenseSourceForEvent(good), expenseSourceForEvent(bad, { vendorEntityKindSnapshot: null })];
  const events: any[] = [good], papers: any[] = [];
  const branches = [{ id: 'head', name: 'สำนักงานใหญ่', type: 'HEAD_OFFICE', status: 'ACTIVE', taxBranchCode: '00000' }, { id: 'branch', name: 'สาขาลับ', type: 'BRANCH', status: 'ACTIVE', taxBranchCode: '00002' }];
  let mode = 'HEAD_OFFICE_PAYS_ALL';
  const db: any = {
    company: { findUnique: async () => ({ timezone: 'Asia/Bangkok', baseCurrency: 'THB', registeredName: 'ร้าน', taxId: '1100700000001', addressJson: { line1: '1 ถนน', subdistrict: 'บางนา', district: 'บางนา', province: 'กรุงเทพมหานคร', postalCode: '10260' } }) },
    companyTaxProfile: { findUnique: async () => null }, branch: { findMany: async () => branches, findFirst: async ({ where }: any) => branches.find(b => b.id === where.id) },
    whtPayerModeFact: { findMany: async () => [{ mode, effectiveFromPeriodKey: '2026-01', supersededAt: null }] },
    taxPeriod: { findMany: async () => periods }, taxReviewIssue: { findMany: async () => [] },
    expenseRecord: { findMany: async ({ where }: any) => sources.filter(s => (!where.id || where.id.in.includes(s.id)) && (!where.status || where.status === s.status) && (!where.OR || where.OR[0].branchId.in.includes(s.branchId))) },
    expensePayment: { findMany: async () => sources.flatMap(s => s.payments) }, supplierPayment: { findMany: async () => [] },
    taxEvent: { findMany: async ({ where }: any) => events.filter(e => (!where.OR || where.OR[0].branchId.in.includes(e.branchId))) },
    whtIncomeCategory: { findMany: async () => ['PND3', 'PND53'].map(formType => ({ code: formType, formType, nameTh: 'ค่าบริการ', filingRoute: 'SYSTEM_FILLS' })) },
    whtFiling: { findMany: async () => papers }, whtFilingLine: { findMany: async ({ where }: any) => papers.filter(p => p.status === 'FILED' && (!where.filing.formType || p.formType === where.filing.formType)).flatMap(p => p.lines) },
    whtCertificateHandoff: { findMany: async () => [] }, user: { findMany: async () => [] },
  };
  db.$transaction = async (work: any) => work(db);
  const reader = new GenerateWhtReportUseCase({ prisma: { client: db } } as any);
  const read = (actor = ctx) => reader.getMonth(actor, '2026-09');
  const warning = E_WHT_WORDS['W-T6']('ผู้รับเงินที่ต้องแก้');
  let month = await read();
  assert.ok(month.forms.every(f => f.issues.some(i => i.issueCode === 'WHT_PAYEE_KIND_UNKNOWN')));
  sources[1].vendorEntityKindSnapshot = 'JURISTIC';
  month = await read();
  assert.ok(!month.forms[0].issues.some(i => i.sourceId === 'bad'));
  assert.ok(month.forms[1].issues.some(i => i.issueCode === 'MISSING_TAX_ID' && i.sourceId === 'bad'));
  sources[1].vendorEntityKindSnapshot = null;
  events.length = 0; periods.splice(0, 1);
  month = await read();
  assert.ok(month.forms.every(f => f.paymentCount === 0 && f.issues.some(i => i.issueCode === 'WHT_PAYEE_KIND_UNKNOWN')));
  periods.unshift({ id: 'PND3', formType: 'PND3', periodKey: '2026-09', status: 'FILED', dueDate: new Date('2099-10-07') }); events.push(good);
  papers.push({ id: 'filed', formType: 'PND3', taxPeriodId: 'PND3', establishmentCode: '00000', establishmentBranchId: 'head', sequence: 0, status: 'FILED', rowsCertain: true,
    preparedBy: 'SYSTEM', lines: [{ sourceType: good.sourceType, sourceId: good.sourceId, lineJson: { payment: withholdingPaymentFacts({ ...good, payeeSnapshot: good.payeeSnapshotJson }) } }] });
  const frozen = JSON.stringify(papers);
  month = await read();
  assert.ok(month.forms[0].issues.some(i => i.description === warning));
  assert.equal(month.forms[0].canDownload, true); assert.equal(JSON.stringify(papers), frozen);
  const hidden = await read({ ...ctx, permissions: ['wht.pnd53.read', 'expense.read'], scopes: { branchIds: ['head'] } });
  assert.ok(hidden.forms[0].issues.some(i => i.description === E_WHT_WORDS['W-T6']('รายการของสาขาที่คุณไม่ได้ดูแล')));
  assert.doesNotMatch(JSON.stringify(hidden), /ผู้รับเงินที่ต้องแก้|สาขาลับ|bad-payment|"bad"/);
  mode = 'EACH_BRANCH_PAYS';
  month = await read();
  assert.ok(!month.establishments!.find(e => e.code === '00000')!.forms[0].issues.some(i => i.description === warning));
  assert.ok(month.establishments!.find(e => e.code === '00002')!.forms.every(f => f.issues.length));
  (branches[1] as any).taxBranchCode = null;
  const noCode = await read();
  assert.ok(noCode.establishmentIssues!.some(issue => issue.issueCode === 'WHT_BRANCH_HAS_NO_CODE' && issue.branchId === 'branch'), 'a source-only branch still offers its branch-code correction');
  branches[1].taxBranchCode = '00002';
  mode = 'HEAD_OFFICE_PAYS_ALL'; sources[1].vendorEntityKindSnapshot = 'INDIVIDUAL'; sources[1].vendorTaxIdSnapshot = '1100700000002';
  bad.payeeSnapshotJson.taxId = '1100700000002'; events.push(bad);
  month = await read();
  assert.ok(month.forms[0].papers!.some(p => p.sequence === 1 && p.canDownload));
  assert.equal(month.forms[0].canDownload, true); assert.equal(JSON.stringify(papers), frozen);
  // A different unfiled form uses its normal paper, without changing the filed form's bytes/rows.
  sources[1].vendorEntityKindSnapshot = 'JURISTIC'; sources[1].whtCategoryCode = 'PND53'; bad.eventType = 'WHT_PND53'; bad.taxPeriodId = 'PND53'; bad.incomeCategoryCode = 'PND53';
  month = await read();
  assert.equal(month.forms[1].papers![0].sequence, 0); assert.equal(month.forms[1].papers![0].canDownload, true);
  assert.equal(JSON.stringify(papers), frozen);
  // A source-level match cannot hide an omitted second payment on the very same expense.
  sources[0].payments.push({ ...sources[0].payments[0], id: 'new-good-payment', amount: '0', paidAt: new Date('2026-09-11') });
  sources[0].vendorEntityKindSnapshot = null;
  month = await read();
  assert.ok(month.forms[0].issues.some(i => i.description === E_WHT_WORDS['W-T6']('ผู้รับเงินครบ')));
  sources[0].payments.pop();
  month = await read();
  assert.ok(!month.forms[0].issues.some(i => i.description === E_WHT_WORDS['W-T6']('ผู้รับเงินครบ')));
});

describe('R9 fresh e-WHT export (paid read permission)', () => {
  async function fixture() {
    const { GenerateWhtReportUseCase } = await import('../../application/use-cases/generate-wht-report.use-case');
    const branches = [{ id: 'head', type: 'HEAD_OFFICE', name: 'สำนักงานใหญ่', taxBranchCode: '00000', status: 'ACTIVE' }, { id: 'other', type: 'BRANCH', name: 'สาขาสอง', taxBranchCode: '00002', status: 'ACTIVE' }];
    const events: any[] = ['THB', 'USD'].map((currency, n) => ({ id: `bank-${n}`, sourceType: 'expense.record', sourceId: `expense-${n}`, status: 'EXCLUDED', branchId: 'head', eventType: 'WHT_PND3',
      eventDate: new Date('2026-09-10'), currency, grossAmount: n ? '200' : '1000', withheldAmount: n ? '2' : '10', whtRate: '1', incomeCategoryCode: 'WHT_ADVERTISING_IND', payeeSnapshotJson: { name: `ผู้รับเงิน ${n}`, taxId: '1100700000001', address: 'กรุงเทพ', branchCode: null } }));
    events.push({ ...events[0], id: 'hidden', sourceId: 'hidden', branchId: 'other', payeeSnapshotJson: { name: 'ความลับของสาขาอื่น' } });
    events.push({ ...events[0], id: 'legacy-hidden', sourceId: 'legacy-hidden', branchId: null, sourceBranchId: 'other', payeeSnapshotJson: { name: 'ความลับที่แถวภาษียังไม่มีสาขา' } });
    const audits: any[] = [];
    const db: any = { taxEvent: { findMany: async ({ where }: any) => { assert.equal(where.status, 'EXCLUDED'); assert.equal(where.companyId, ctx.companyId);
      return events.filter(e => !where.OR || where.OR.some((p: any) => p.branchId?.in?.includes(e.branchId) || p.branchId === null && e.branchId === null)); } },
      expenseRecord: { findMany: async ({ where }: any) => events.filter(e => where.id.in.includes(e.sourceId) && (!where.OR || where.OR.some((p: any) => p.branchId?.in?.includes(e.sourceBranchId ?? e.branchId) || p.branchId === null && !e.sourceBranchId && e.branchId === null))).map(e => ({ id: e.sourceId })) },
      branch: { findMany: async () => branches }, whtPayerModeFact: { findMany: async () => [{ mode: 'EACH_BRANCH_PAYS', effectiveFromPeriodKey: '2026-01', supersededAt: null }] },
      whtIncomeCategory: { findMany: async () => [{ code: 'WHT_ADVERTISING_IND', nameTh: 'ค่าโฆษณา' }] },
      taxFilingPackage: { create: async () => assert.fail('no package') }, documentNumber: { create: async () => assert.fail('no number') } };
    db.$transaction = async (work: any) => work(db);
    const noop = {} as any;
    const controller = new TaxController(noop, noop, new GenerateWhtReportUseCase({ prisma: { client: db } } as any), noop, noop, noop, noop, noop, noop, noop, noop, noop, {} as any, { log: async (input: any) => audits.push(input) } as any);
    return { controller, events, audits };
  }
  function xml(artifact: any) {
    const file = Buffer.from(artifact.contentBase64, 'base64'); let result = '';
    for (let offset = 0; file.readUInt32LE(offset) === 0x04034b50;) {
      const size = file.readUInt32LE(offset + 18), length = file.readUInt16LE(offset + 26), extra = file.readUInt16LE(offset + 28), start = offset + 30 + length + extra;
      const bytes = file.subarray(start, start + size); result += (file.readUInt16LE(offset + 8) === 8 ? require('node:zlib').inflateRawSync(bytes) : bytes).toString(); offset = start + size;
    } return result;
  }
  it('requires the month-read permission; no permission (including free shops) is refused', async () => {
    const { REQUIRED_PERMISSIONS_KEY } = await import('../../../../common/security/permissions.decorator');
    const handler = (TaxController.prototype as any).exportEWht;
    assert.ok(handler); assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler), ['wht.pnd53.read']);
    const { DenyByDefaultGuard } = await import('../../../../common/security/deny-by-default.guard'); const { Reflector } = await import('@nestjs/core');
    const execution: any = { getHandler: () => handler, getClass: () => TaxController, switchToHttp: () => ({ getRequest: () => ({ context: { ...ctx, freeExpenseDrafts: true, permissions: [] } }) }) };
    assert.throws(() => new DenyByDefaultGuard(new Reflector()).canActivate(execution), /permission/i);
    const { isFreeExpenseDraftRoute } = await import('../../../system-partner-management/application/free-expense-access');
    for (const suffix of ['', '/e-wht-export']) assert.equal(isFreeExpenseDraftRoute('GET', `/v1/companies/${ctx.companyId}/tax/withholding/months/2026-09${suffix}`), false, 'free source-drafts cannot reach this financial read');
  });
  it('exports only current scoped bank payments with currency totals, then includes new payments after filing', async () => {
    const h = await fixture(); const actor = { ...ctx, permissions: ['wht.pnd53.read'], scopes: { branchIds: ['head'] } };
    const first = await (h.controller as any).exportEWht(actor, ctx.companyId, '2026-09');
    const content = xml(first); assert.match(first.fileName, /จ่ายผ่าน e-WHT/); assert.match(content, /สกุลเงิน/); assert.match(content, /ค่าโฆษณา/);
    assert.match(content, /บาท/); assert.match(content, /ดอลลาร์สหรัฐ/); assert.equal((content.match(/>รวม</g) ?? []).length, 2); assert.doesNotMatch(content, /ความลับ|50 ทวิ/);
    h.events.push({ ...h.events[0], id: 'new-after-filed', sourceId: 'new', payeeSnapshotJson: { name: 'จ่ายเพิ่มหลังยื่น' } });
    const second = await (h.controller as any).exportEWht(actor, ctx.companyId, '2026-09', '00000');
    assert.match(xml(second), /จ่ายเพิ่มหลังยื่น/); assert.notEqual(second.checksum, first.checksum);
    assert.equal(h.audits.length, 2); assert.equal(h.audits[0].action, 'tax.withholding.e_wht_export');
    const hidden = await (h.controller as any).exportEWht(actor, ctx.companyId, '2026-09', '00002'); assert.doesNotMatch(xml(hidden), /ความลับ|ผู้รับเงิน 0|ผู้รับเงิน 1|จ่ายเพิ่มหลังยื่น/);
    await assert.rejects(() => (h.controller as any).exportEWht(actor, 'another-company', '2026-09'), /company/i);
  });
});
