import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DISBURSEMENT_VOUCHER_NOTICE_WORDS } from '@watchdog-bms/contracts';
import { BadRequestException, ForbiddenException, NotFoundException, RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { GetExpenseUseCase, GetExpenseHistoryUseCase, ListExpensesUseCase, MarkExpenseReadyUseCase } from './expense-draft.use-case';
import { ListCompanySubstituteReceiptsUseCase } from './substitute-receipt.use-case';
import { expenseRelatedToUserWhere, PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { ListExpenseCategoriesUseCase } from './expense-upload.use-case';
import { ReadDisbursementVoucherSourcesUseCase } from './disbursement-voucher-read.use-case';
import { recordExpensePaymentBlocker } from '../../infrastructure/expense-void-blocker';
import { DisbursementVoucherController, DisbursementVoucherPdfReadFilter } from '../../presentation/http/disbursement-voucher.controller';
import { REQUIRED_PERMISSIONS_KEY, REQUIRED_ANY_PERMISSIONS_KEY } from '../../../../common/security/permissions.decorator';
import { DisbursementVoucherNoticeService } from '../services/disbursement-voucher-notice.service';
import { CancelExpensePaymentUseCase } from './expense-draft.use-case';
import { DisbursementVoucherUseCase } from './disbursement-voucher.use-case';
import { PrismaDisbursementVoucherRepository } from '../../infrastructure/prisma-disbursement-voucher.repository';
import { cancelDisbursementVouchersForPayments, disbursementVoucherHeader, disbursementVoucherActions, disbursementVoucherPrimaryAction } from '../../domain/logic/disbursement-voucher.logic';

const ctx = {
  requestId: 'request-1', authSubject: 'actor-1', userId: 'actor-1', companyId: 'company-1',
  membershipId: 'member-1', roles: [], permissions: ['expense.read_related'],
  scopes: { branchIds: ['branch-1'] }, authProvider: 'watchdog',
} as any;

const detail = {
  id: 'expense-1', companyId: 'company-1', branchId: 'branch-1', createdByUserId: 'creator-1',
  substituteReceiptEvidence: null,
} as any;

describe('expense related-view ABAC', () => {
  it('allows a persisted related actor and denies an unrelated member', async () => {
    let related = true;
    const repo = {
      findByIdWithRelations: async () => detail,
      isUserRelatedToExpense: async (_companyId: string, _expenseId: string, userId: string, scopes: unknown) => {
        assert.equal(userId, 'actor-1');
        assert.deepEqual(scopes, { branchIds: ['branch-1'] });
        return related;
      },
    } as any;
    const useCase = new GetExpenseUseCase(repo);
    assert.equal((await useCase.execute(ctx, detail.id)).id, detail.id);

    related = false;
    await assert.rejects(() => useCase.execute(ctx, detail.id), ForbiddenException);
  });

  it('does not offer a document reservation link or buttons to a LINE viewer', async () => {
    let caller: any;
    const repo: any = { expenseCorrectionCapabilities: async (_company: any, _id: any, _permissions: any, scope: any) => { caller = scope; return {}; } };
    const useCase = new GetExpenseUseCase(repo);
    await useCase.correctionCapabilities({ ...ctx, authProvider: 'line', permissions: ['expense.read', 'expense.disbursement.read', 'expense.disbursement.prepare'] }, 'expense-1');
    assert.equal(caller, undefined);
  });

  it('passes related-user scope to the list repository instead of widening to company rows', async () => {
    let captured: unknown[] = [];
    const repo = {
      listExpenses: async (...args: unknown[]) => {
        captured = args;
        return { data: [], total: 0, page: 1, pageSize: 20 };
      },
    } as any;
    await new ListExpensesUseCase(repo).execute(ctx, { page: 1, pageSize: 20 });
    assert.equal((captured[0] as any).createdByUserId, undefined);
    assert.deepEqual(captured[1], ctx.scopes);
    assert.equal(captured[2], ctx.userId);
  });

  // Item 1 (spec R-A1 row 18, eval: 15 turns): the AI answer must state when a read is scoped to
  // less than the whole company. `readAiSummary`/`readAiBreakdown` now echo the SAME own/related/
  // company classification `readScope` already uses to build the repository filter/scope above,
  // so a tool adapter can read it off the snapshot without re-deriving the permission logic.
  it('readAiSummary echoes accessScope: related for a read_related-only caller (same ctx as above)', async () => {
    const repo = { readAiExpenseSummary: async () => ({ total: 0 }) } as any;
    const result = await new ListExpensesUseCase(repo).readAiSummary(ctx, { fromDate: '2026-08-01', toDate: '2026-08-31' }, 20);
    assert.equal((result as any).accessScope, 'related');
  });

  it('readAiSummary echoes accessScope: own for a read_own-only caller', async () => {
    const repo = { readAiExpenseSummary: async () => ({ total: 0 }) } as any;
    const ownCtx = { ...ctx, permissions: ['expense.read_own'] };
    const result = await new ListExpensesUseCase(repo).readAiSummary(ownCtx, { fromDate: '2026-08-01', toDate: '2026-08-31' }, 20);
    assert.equal((result as any).accessScope, 'own');
  });

  it('readAiSummary echoes accessScope: company for a full expense.read caller, even with read_own too', async () => {
    const repo = { readAiExpenseSummary: async () => ({ total: 0 }) } as any;
    const fullCtx = { ...ctx, permissions: ['expense.read', 'expense.read_own'] };
    const result = await new ListExpensesUseCase(repo).readAiSummary(fullCtx, { fromDate: '2026-08-01', toDate: '2026-08-31' }, 20);
    assert.equal((result as any).accessScope, 'company');
  });

  it('readAiBreakdown echoes the same accessScope classification as readAiSummary', async () => {
    const repo = { readAiExpenseBreakdown: async () => ({}) } as any;
    const ownCtx = { ...ctx, permissions: ['expense.read_own'] };
    const result = await new ListExpensesUseCase(repo).readAiBreakdown(ownCtx, { fromDate: '2026-08-01', toDate: '2026-08-31' });
    assert.equal((result as any).accessScope, 'own');
  });

  it('scopes the substitute-receipt preparation hub to the reader’s own recorded expenses', async () => {
    let capturedScope: any;
    const repo = {
      listCompanySubstituteReceipts: async (_companyId: string, _filter: unknown, scope: unknown) => {
        capturedScope = scope;
        return { rows: [], total: 0 };
      },
    } as any;
    await new ListCompanySubstituteReceiptsUseCase(repo).execute(ctx, { page: 1, pageSize: 20 });
    assert.deepEqual(capturedScope, {
      branchIds: ['branch-1'], onlyPayerUserId: null, createdByUserId: 'actor-1',
      userId: 'actor-1', canApprove: false, canSelfApprove: false,
    });
  });

  it('covers direct, payment, substitute-receipt, and source-claim actors in the repository predicate', () => {
    const json = JSON.stringify(expenseRelatedToUserWhere('actor-1'));
    for (const field of [
      'createdByUserId', 'reviewedByUserId', 'payments', 'preparedByUserId', 'payerUserId',
      'approverUserId', 'issuedByUserId', 'sourceReimbursementRequest', 'currentApproverUserId',
      'financeReviewedByUserId', 'claimSignatures',
    ]) assert.match(json, new RegExp(`"${field}"`));
  });

  it('lets a related viewer load the category labels needed by the read-only detail', async () => {
    const repo = { listCategories: async () => [{ id: 'category-1' }] } as any;
    assert.deepEqual(await new ListExpenseCategoriesUseCase(repo).execute(ctx), [{ id: 'category-1' }]);
  });

  it('keeps branch, relation, and month OR clauses isolated under AND', async () => {
    let capturedWhere: any;
    const delegate = {
      findMany: async ({ where }: any) => { capturedWhere = where; return []; },
      count: async () => 0,
    };
    const prisma = {
      client: {
        expenseSubstituteReceiptEvidence: delegate,
        $transaction: async (run: any) => run({ expenseSubstituteReceiptEvidence: delegate, $queryRaw: async () => [] }),
      },
    } as any;
    await new PrismaExpenseRepository(prisma).listCompanySubstituteReceipts(
      'company-1',
      { yearMonth: '2026-08', page: 1, pageSize: 20 },
      { branchIds: ['branch-1'], onlyPayerUserId: null, relatedUserId: 'actor-1' },
    );

    assert.equal(capturedWhere.OR, undefined);
    assert.equal(capturedWhere.AND.length, 3);
    assert.deepEqual(capturedWhere.AND[0].OR, [
      { branchId: { in: ['branch-1'] } }, { branchId: null },
    ]);
    assert.ok(capturedWhere.AND[1].OR.some((clause: any) => clause.approverUserId === 'actor-1'));
    assert.ok(capturedWhere.AND[2].OR.some((clause: any) => clause.paymentDate));
  });

  it('orders upload-range lists by newest intake before applying the page limit', async () => {
    let capturedFindMany: any;
    const prisma = {
      client: {
        expenseRecord: {
          findMany: async (input: any) => { capturedFindMany = input; return []; },
          count: async () => 0,
        },
      },
    } as any;

    await new PrismaExpenseRepository(prisma).listExpenses({
      companyId: 'company-1', uploadedFromDate: '2026-08-01', uploadedToDate: '2026-08-31', pageSize: 200,
    }, { branchIds: ['branch-1'] }, 'actor-1');

    assert.deepEqual(capturedFindMany.orderBy, [{ uploadedAt: 'desc' }, { id: 'desc' }]);
    assert.equal(capturedFindMany.take, 200);
    assert.equal(capturedFindMany.where.companyId, 'company-1');
    assert.deepEqual(capturedFindMany.where.OR, [
      { branchId: { in: ['branch-1'] } }, { branchId: null },
    ]);
    assert.equal(capturedFindMany.where.AND.length, 1);
    assert.match(JSON.stringify(capturedFindMany.where.AND[0]), /"createdByUserId":"actor-1"/);
    assert.deepEqual(capturedFindMany.where.uploadedAt, {
      gte: new Date('2026-07-31T17:00:00.000Z'),
      lt: new Date('2026-08-31T17:00:00.000Z'),
    });
    assert.equal(capturedFindMany.where.expenseDate, undefined);
  });

  it('keeps document-date ordering for callers without a dedicated upload-date lens', async () => {
    let capturedFindMany: any;
    const prisma = {
      client: {
        expenseRecord: {
          findMany: async (input: any) => { capturedFindMany = input; return []; },
          count: async () => 0,
        },
      },
    } as any;

    await new PrismaExpenseRepository(prisma).listExpenses({ companyId: 'company-1', pageSize: 20 });

    assert.deepEqual(capturedFindMany.orderBy, [{ expenseDate: 'desc' }, { id: 'desc' }]);

    await new PrismaExpenseRepository(prisma).listExpenses({
      companyId: 'company-1', fromDate: '2026-08-01', uploadedFromDate: '2026-08-01', pageSize: 20,
    });

    assert.deepEqual(capturedFindMany.orderBy, [{ expenseDate: 'desc' }, { id: 'desc' }]);
  });
});

describe('disbursement voucher drafts and visibility', () => {
  const context = (patch: any = {}) => ({ ...ctx, permissions: ['expense.disbursement.prepare', 'expense.disbursement.read', 'expense.read'], ...patch });
  const source = (id: string, patch: any = {}) => ({
    id, companyId: 'company-1', branchId: 'branch-1', expenseNumber: `EXP-${id}`, status: 'CONFIRMED', currency: 'THB',
    createdByUserId: 'actor-1', vendorNameSnapshot: 'ร้าน ก', vendorTaxIdSnapshot: '0-1234-56789-01-2', vendorBranchCodeSnapshot: '00001',
    expenseDate: new Date('2026-10-01'), createdAt: new Date('2026-10-01'), updatedAt: new Date('2026-10-01'), outstandingAmount: '104.0000',
    grandTotalAmount: '107.0000', whtAmount: '3.0000', netPayableAmount: '104.0000', paidAmount: '0.0000', substituteReceiptEvidences: [],
    sourceReimbursementRequestId: null, reservedByDisbursementVoucherId: null, ...patch,
  });
  const body = (patch: any = {}) => ({ plannedMethod: 'CASH', commandId: 'draft-command-1', lines: [{ expenseId: 'a', amount: '10.10' }], ...patch });
  function harness(rows = [source('a'), source('b')]) {
    const member = (userId: string, mode = 'ALL_BRANCHES', branches = ['branch-1'], permission = true) => ({
      userId, companyId: 'company-1', status: 'ACTIVE', branchScopeMode: mode, defaultBranchId: branches[0],
      branchScopes: branches.map(branchId => ({ branchId })), company: { status: 'ACTIVE', planTerm: null },
      user: { status: 'ACTIVE', displayName: userId === 'actor-1' ? 'สมใจ' : 'สมชาย' },
      roles: [{ role: { key: 'CUSTOM', status: 'ACTIVE', permissions: permission ? [{ permission: { key: 'expense.disbursement.approve' } }] : [] } }],
    });
    const state: any = { noticeInputs: [], inTransaction: false, vouchers: [], lines: [], commands: [], audits: [], expenses: rows, revisions: [], locks: [], numbers: [], payments: [], events: [], transactions: [], attachments: [], attachmentLinks: [],
      members: [member('actor-1'), member('someone'), member('other-branch', 'SELECTED_BRANCHES', ['branch-2']), member('no-right', 'ALL_BRANCHES', [], false)] };
    const matches = (value: any, where: any): boolean => Object.entries(where).every(([key, expected]: any) => {
      if (key === 'AND') return expected.every((w: any) => matches(value, w));
      if (key === 'OR') return expected.some((w: any) => matches(value, w));
      if (key === 'NOT') return !matches(value, expected);
      if (key === 'attachment') return matches(state.attachments.find((a: any) => a.id === value.attachmentId), expected);
      if (key === 'lines') return state.lines.filter((l: any) => l.voucherId === value.id).every((l: any) => matches(state.expenses.find((e: any) => e.id === l.expenseId), expected.every.expense.is));
      if (expected instanceof Date) return value[key] instanceof Date && value[key].getTime() === expected.getTime();
      if (expected && typeof expected === 'object') {
        if ('in' in expected) return expected.in.includes(value[key]);
        if ('contains' in expected) return String(value[key] ?? '').toLocaleLowerCase('th').includes(expected.contains.toLocaleLowerCase('th'));
        if ('gt' in expected) return Number(value[key]) > expected.gt;
        if ('lte' in expected) return Number(value[key]) <= expected.lte;
        if ('path' in expected) return expected.path.reduce((v: any, k: string) => v?.[k], value[key]) === expected.equals;
        if ('equals' in expected) return JSON.stringify(value[key]) === JSON.stringify(expected.equals);
        if ('not' in expected) return value[key] !== expected.not;
      }
      return value[key] === expected;
    });
    const withRelations = (v: any) => v ? { ...v, lines: state.lines.filter((l: any) => l.voucherId === v.id).sort((a: any, b: any) => a.position - b.position)
      .map((l: any) => ({ ...l, expense: state.expenses.find((e: any) => e.id === l.expenseId) })), revisions: state.revisions.filter((r: any) => r.voucherId === v.id), _count: { lines: state.lines.filter((l: any) => l.voucherId === v.id).length } } : null;
    const client: any = {
      companySignatureAsset: { findMany: async ({ where }: any) => (state.signatures ?? []).filter((a: any) => matches(a, where)) },
      $queryRaw: async (query: any) => {
        if (!query.sql?.includes('COALESCE("paidDate", "plannedPayDate", "createdAt"::date)')) return [{ locked: true }];
        assert.match(query.sql, /ORDER BY COALESCE\("paidDate", "plannedPayDate", "createdAt"::date\) (ASC|DESC), "createdAt" \1, "id" \1/);
        const [companyId, ids, take, skip] = query.values;
        assert.equal(companyId, 'company-1'); assert.ok(Array.isArray(ids));
        const sign = query.sql.includes(' ASC') ? 1 : -1;
        const date = (v: any) => (v.paidDate ?? v.plannedPayDate ?? v.createdAt).toISOString().slice(0, 10);
        return state.vouchers.filter((v: any) => v.companyId === companyId && ids.includes(v.id))
          .sort((a: any, b: any) => sign * (date(a).localeCompare(date(b)) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)))
          .slice(skip, skip + take).map((v: any) => ({ id: v.id }));
      },
      $executeRaw: async (parts: TemplateStringsArray, ...values: any[]) => {
        const sql = parts.join('?'); state.locks.push({ sql, values });
        if (!sql.includes('UPDATE "ExpenseRecord"')) return 0;
        if (sql.includes('SET "reservedByDisbursementVoucherId" = "reservedByDisbursementVoucherId"')) return state.expenses.filter((e: any) => e.companyId === values[0] && values[1].values.includes(e.id)).length;
        const clear = sql.includes('= NULL'), companyId = values[clear ? 0 : 1], voucherId = values[clear ? 1 : 0];
        const ids = clear ? null : values[2].values;
        const changed = state.expenses.filter((e: any) => e.companyId === companyId && (clear ? e.reservedByDisbursementVoucherId === voucherId : ids.includes(e.id) && e.reservedByDisbursementVoucherId === null));
        changed.forEach((e: any) => { e.reservedByDisbursementVoucherId = clear ? null : voucherId; }); return changed.length;
      },
      $transaction: async (work: any, options: any) => {
        const saved = structuredClone(state);
        state.transactions.push(options); state.inTransaction = true;
        try { return await work(client); } catch (error) { Object.assign(state, saved); throw error; } finally { state.inTransaction = false; }
      },
      expenseRecord: {
        findFirst: async ({ where }: any) => state.expenses.find((e: any) => matches(e, where)) ?? null,
        findFirstOrThrow: async ({ where }: any) => state.expenses.find((e: any) => matches(e, where)),
        findMany: async ({ where }: any) => state.expenses.filter((e: any) => matches(e, where)),
        count: async ({ where }: any) => state.expenses.filter((e: any) => matches(e, where)).length,
        updateMany: async ({ where, data }: any) => { const rows = state.expenses.filter((e: any) => matches(e, where)); rows.forEach((e: any) => Object.assign(e, data, { updatedAt: new Date(e.updatedAt.getTime() + 1) })); return { count: rows.length }; },
      },
      expensePayment: {
        findFirstOrThrow: async ({ where }: any) => state.payments.find((p: any) => matches(p, where)),
        findFirst: async ({ where }: any) => state.payments.find((p: any) => matches(p, where)) ?? null,
        findMany: async ({ where }: any) => state.payments.filter((p: any) => matches(p, where)),
        create: async ({ data }: any) => { state.locks.push({ sql: 'WRITE payment', values: [] }); const p = { ...data, id: `pay-${state.payments.length}`, createdAt: new Date(), updatedAt: new Date() }; state.payments.push(p); return p; },
      },
      outboxEvent: { create: async ({ data }: any) => { state.events.push(data); return data; } },
      company: { findUnique: async () => ({ status: 'ACTIVE', archivedAt: null, planTerm: null }), findFirst: async ({ where }: any) => where.id === 'company-1' ? { id: where.id, name: 'กิจการทดสอบ', registeredName: 'กิจการทดสอบ', taxId: '0123456789012', addressJson: {} } : null },
      attachmentObject: { findFirst: async ({ where }: any) => state.attachments.find((a: any) => matches(a, where)) ?? null, findMany: async ({ where }: any) => state.attachments.filter((a: any) => matches(a, where)) },
      attachmentLink: {
        findFirst: async ({ where, include }: any) => { const l = state.attachmentLinks.find((l: any) => matches(l, where)); return l ? { ...l, ...(include?.attachment ? { attachment: state.attachments.find((a: any) => a.id === l.attachmentId) } : {}) } : null; },
        findMany: async ({ where, include }: any) => state.attachmentLinks.filter((l: any) => matches(l, where)).map((l: any) => ({ ...l, ...(include?.attachment ? { attachment: state.attachments.find((a: any) => a.id === l.attachmentId) } : {}) })),
        deleteMany: async ({ where }: any) => { const before = state.attachmentLinks.length; state.attachmentLinks = state.attachmentLinks.filter((l: any) => !matches(l, where)); return { count: before - state.attachmentLinks.length }; },
        create: async ({ data }: any) => { const l = { id: `link-${state.attachmentLinks.length}`, createdAt: new Date(), ...data }; state.attachmentLinks.push(l); return l; },
      }, reimbursementLine: { findMany: async () => [], findFirst: async () => null },
      expenseSubstituteReceiptEvidence: { findFirst: async ({ where }: any) => state.expenses.find((e: any) => e.id === where.expenseId)?.substituteReceiptEvidences[0] ?? null },
      companyMembership: { findMany: async ({ where }: any) => state.members.filter((m: any) => m.companyId === where.companyId && m.status === 'ACTIVE' && (!where.userId?.in || where.userId.in.includes(m.userId)) && (!where.roles || m.roles.some((r: any) => r.role.permissions.length))),
        findFirst: async ({ where }: any) => state.members.find((m: any) => m.companyId === where.companyId && m.userId === where.userId && m.status === 'ACTIVE') ?? null },
      companyFeatureEntitlement: { findMany: async () => [] },
      branch: { findFirst: async ({ where }: any) => where.companyId === 'company-1' ? { id: where.id, name: 'สำนักงานใหญ่', code: 'HO', taxBranchCode: '00000', addressJson: {} } : null,
        findMany: async ({ where }: any) => [{ id: 'branch-1' }, { id: 'branch-2' }].filter(b => !where?.id?.in || where.id.in.includes(b.id)) },
      user: {
        findMany: async ({ where }: any) => state.members.map((m: any) => ({ id: m.userId, displayName: m.user.displayName })).filter((u: any) => (!where?.id?.in || where.id.in.includes(u.id)) && state.members.some((m: any) => m.userId === u.id && m.companyId === where.memberships.some.companyId && (!where.memberships.some.status || m.status !== where.memberships.some.status.not))),
        findFirst: async ({ where }: any) => {
          assert.equal(where.memberships.some.companyId, 'company-1');
          return where.id === 'actor-1' ? { displayName: 'สมใจ' } : null;
        },
      },
      disbursementVoucher: {
        findFirstOrThrow: async ({ where }: any) => withRelations(state.vouchers.find((v: any) => matches(v, where))),
        findFirst: async ({ where }: any) => withRelations(state.vouchers.find((v: any) => matches(v, where))),
        findMany: async ({ where, skip = 0, take }: any) => state.vouchers.filter((v: any) => matches(v, where))
          .sort((a: any, b: any) => (a.plannedPayDate?.getTime() ?? Infinity) - (b.plannedPayDate?.getTime() ?? Infinity))
          .slice(skip, take ? skip + take : undefined).map(withRelations),
        groupBy: async ({ where, _sum }: any) => Object.entries(state.vouchers.filter((v: any) => matches(v, where)).reduce((totals: any, v: any) => ({ ...totals, [v.status]: (totals[v.status] ?? 0) + 1 }), {}))
          .map(([status, count]) => ({ status, _count: { _all: count }, ...(_sum ? { _sum: { totalAmount: state.vouchers.filter((v: any) => matches(v, where) && v.status === status).reduce((sum: number, v: any) => sum + Number(v.totalAmount), 0) } } : {}) })),
        create: async ({ data }: any) => { const v = { id: `dv-${state.vouchers.length + 1}`, documentNumber: null, revision: 0, status: 'DRAFT', version: 0, currency: 'THB', paidDate: null, createdAt: new Date(), updatedAt: new Date(), ...data }; state.vouchers.push(v); return withRelations(v); },
        updateMany: async ({ where, data }: any) => { const found = state.vouchers.filter((v: any) => matches(v, where)); found.forEach((v: any) => Object.entries(data).forEach(([k, value]: any) => { v[k] = value?.increment ? v[k] + value.increment : value?.constructor?.name === 'DbNull' ? null : value; })); return { count: found.length }; },
        deleteMany: async ({ where }: any) => { const found = state.vouchers.filter((v: any) => matches(v, where)); state.vouchers = state.vouchers.filter((v: any) => !found.includes(v)); state.lines = state.lines.filter((l: any) => !found.some((v: any) => v.id === l.voucherId)); return { count: found.length }; },
      },
      disbursementVoucherLine: {
        findFirst: async ({ where }: any) => state.lines.find((l: any) => matches(l, where)) ?? null,
        findMany: async ({ where }: any) => state.lines.filter((l: any) => matches(l, where)),
        updateMany: async ({ where, data }: any) => { const found = state.lines.filter((l: any) => matches(l, where)); found.forEach((l: any) => Object.assign(l, data)); return { count: found.length }; },
        createMany: async ({ data }: any) => { state.lines.push(...data.map((l: any, i: number) => ({ expensePaymentId: null, coversPaymentId: null, ...l, id: `line-${state.lines.length + i}` }))); return { count: data.length }; },
        deleteMany: async ({ where }: any) => { state.lines = state.lines.filter((l: any) => !matches(l, where)); return { count: 1 }; },
      },
      disbursementVoucherCommand: {
        findUnique: async ({ where }: any) => state.commands.find((c: any) => matches(c, where.companyId_commandId)) ?? null,
        findFirst: async ({ where }: any) => [...state.commands].reverse().find((c: any) => matches(c, where)) ?? null,
        create: async ({ data }: any) => { const row = { createdAt: new Date(), ...data }; state.commands.push(row); return row; },
      },
      disbursementVoucherRevision: {
        create: async ({ data }: any) => { const r = { id: `rev-${state.revisions.length}`, decision: null, decidedAt: null, decidedByUserId: null, decisionReason: null, postApprovalAction: null, postApprovalAt: null, postApprovalByUserId: null, postApprovalReason: null, ...data }; state.revisions.push(r); return r; },
        updateMany: async ({ where, data }: any) => { const found = state.revisions.filter((r: any) => matches(r, where)); found.forEach((r: any) => Object.assign(r, data)); return { count: found.length }; },
      },
    };
    const prisma = { client } as any;
    const expenseRepo = new PrismaExpenseRepository(prisma);
    const numbers = { reserveNumberInTransaction: async (_tx: any, input: any) => { const n = { id: `number-${state.numbers.length}`, documentNumber: `PV-202610-${String(state.numbers.length + 1).padStart(5, '0')}`, status: 'RESERVED', ...input }; state.numbers.push(n); return n; }, commitNumberInTransaction: async () => undefined } as any;
    const repo = new PrismaDisbursementVoucherRepository(prisma, numbers);
    const audit = { log: async (entry: any) => { state.audits.push(entry); }, logOrThrow: async (entry: any) => { state.audits.push(entry); } } as any;
    const notifier = { finishDocumentWaiting: async () => { assert.equal(state.inTransaction, false); }, execute: async (input: any) => { assert.equal(state.inTransaction, false); state.noticeInputs.push(input); } };
    const notices = new DisbursementVoucherNoticeService(repo, notifier as any);
    return { state, client, repo, audit, notices, notifier, useCase: new (DisbursementVoucherUseCase as any)(repo, expenseRepo, new ListExpensesUseCase(expenseRepo), audit, { credentialEncryptionKey: Buffer.alloc(32, 7) }, undefined, undefined, undefined, undefined, notices) as DisbursementVoucherUseCase };
  }
  const refusal = (code: string, message: string) => (error: any) => error.getResponse?.().code === code && error.getResponse().message === message;

  it('expense reviewer candidates use effective confirm rights and branch scope and exclude the sender', async () => {
    const h = harness();
    for (const member of h.state.members) if (member.roles[0].role.permissions.length) member.roles[0].role.permissions = [{ permission: { key: 'expense.confirm' } }];
    const disabled = structuredClone(h.state.members[1]); disabled.userId = 'disabled'; disabled.status = 'DISABLED'; h.state.members.push(disabled);
    const request = new MarkExpenseReadyUseCase({ findById: async () => source('a') } as any, h.repo);
    const candidates = await request.reviewers(context({ permissions: ['expense.review'] }), 'a');
    assert.deepEqual(candidates.map(person => person.userId), ['someone']);
    await assert.rejects(() => request.execute(context({ permissions: ['expense.review'] }), 'a', 'other-branch'), /คนนี้ยืนยันรายจ่ายของสาขานี้ไม่ได้ เลือกคนอื่น/);
    await assert.rejects(() => request.execute(context({ permissions: ['expense.review'] }), 'a', 'no-right'), /คนนี้ยืนยันรายจ่ายของสาขานี้ไม่ได้ เลือกคนอื่น/);
  });

  it('reads each line withholding certificate state in one company-scoped query without a certificate permission', async () => {
    const ids = ['none', 'pending', 'system', 'external', 'cancelled', 'missing', 'voided'];
    const h = harness(ids.map(id => source(id, { whtAmount: id === 'none' ? '0.0000' : '3.0000' })));
    const draft = await h.useCase.create(context(), body({ lines: ids.map(expenseId => ({ expenseId, amount: '1.00' })) }));
    let queries = 0;
    h.client.$queryRaw = async (parts: TemplateStringsArray, ...values: any[]) => {
      queries++;
      const sql = parts.join('?');
      assert.match(sql, /LEFT JOIN "WhtCertificate"/);
      assert.match(sql, /c\."companyId" = h\."companyId"/);
      assert.match(sql, /c\."status" = 'ISSUED'/);
      assert.match(sql, /h\."companyId" = \?/);
      assert.match(sql, /h\."sourcePaymentType" = 'expense.record'/);
      assert.equal(values[0], 'company-1');
      assert.deepEqual(values[1].values, ids.filter(id => id !== 'none'));
      return [
        { sourcePaymentId: 'pending', status: 'REQUIRED', certificateNumber: null, externalCertificateNumber: null },
        { sourcePaymentId: 'system', status: 'SYSTEM_ISSUED', certificateNumber: 'WHT-CURRENT', externalCertificateNumber: null },
        { sourcePaymentId: 'external', status: 'EXTERNAL_LINKED', certificateNumber: null, externalCertificateNumber: 'PAPER-1' },
        { sourcePaymentId: 'cancelled', status: 'REQUIRED', certificateNumber: 'WHT-CANCELLED', externalCertificateNumber: 'PAPER-CANCELLED' },
        { sourcePaymentId: 'voided', status: 'SYSTEM_ISSUED', certificateNumber: null, externalCertificateNumber: null },
      ];
    };
    const result = await h.useCase.get(context({ permissions: ['expense.disbursement.read', 'expense.read'] }), draft.id);
    assert.deepEqual(result.lines.map((line: any) => line.withholdingCertificate), [
      { state: 'NONE', number: null }, { state: 'PENDING', number: null },
      { state: 'SYSTEM_ISSUED', number: 'WHT-CURRENT' }, { state: 'EXTERNAL_LINKED', number: 'PAPER-1' },
      { state: 'PENDING', number: null }, { state: 'PENDING', number: null }, { state: 'PENDING', number: null },
    ]);
    assert.equal(queries, 1);
    await assert.rejects(h.useCase.get(context({ companyId: 'other-company' }), draft.id), (e: any) => e.getStatus() === 404);
    assert.equal(queries, 1);
  });

  it('sends pending tasks only to the chosen active approver, never the actor or self-approval', async () => {
    for (const requestedApproverUserId of [undefined, 'actor-1', 'someone']) {
      const h = harness(), draft = await h.useCase.create(context(), body());
      await h.useCase.submit(context(), draft.id, { ...command(0), requestedApproverUserId });
      assert.equal(h.state.noticeInputs.length, requestedApproverUserId === 'someone' ? 1 : 0);
      if (requestedApproverUserId === 'someone') {
        const notice = h.state.noticeInputs[0];
        assert.deepEqual(notice.recipientUserIds, ['someone']); assert.equal(notice.periodKey, '1'); assert.equal(notice.severity, 'action');
        assert.equal(notice.title, 'รออนุมัติ: ใบเตรียมจ่ายเลขที่ PV-202610-00001');
        assert.equal(notice.body, 'สมใจ ส่งใบเตรียมจ่ายมาให้คุณตรวจและอนุมัติ จ่ายให้ ร้าน ก ยอด 10.10 บาท');
        assert.equal(notice.deepLinkHref, `/companies/company-1/expenses/disbursement-vouchers/${draft.id}`);
        h.state.members.find((m: any) => m.userId === 'someone').status = 'DISABLED';
        await h.notices.send(context(), h.state.vouchers[0], 'submit');
        assert.equal(h.state.noticeInputs.length, 1);
      }
    }
    const h = harness(), draft = await h.useCase.create(context(), body());
    await h.useCase.submit(context({ permissions: ['expense.disbursement.prepare', 'expense.disbursement.approve', 'expense.read'] }), draft.id, { ...command(0), approveNow: true, requestedApproverUserId: 'someone' });
    assert.equal(h.state.noticeInputs.length, 0);
  });

  it('notifies the preparer on approval and adds branch payers only when neither preparer nor approver can pay', async () => {
    for (const payerId of ['neither', 'actor-1', 'someone']) {
      const h = harness(), draft = await h.useCase.create(context(), body());
      const addPayer = (id: string, patch: any = {}) => {
        const member = structuredClone(h.state.members[1]); member.userId = id;
        member.roles[0].role.permissions = [{ permission: { key: 'expense.disbursement.pay' } }];
        h.state.members.push({ ...member, ...patch });
      };
      addPayer('pay-user'); addPayer('foreign-branch', { branchScopeMode: 'SELECTED_BRANCHES', branchScopes: [{ branchId: 'branch-2' }] });
      addPayer('foreign-company', { companyId: 'company-2' }); addPayer('inactive', { status: 'DISABLED' });
      if (payerId !== 'neither') h.state.members.find((m: any) => m.userId === payerId).roles[0].role.permissions.push({ permission: { key: 'expense.disbursement.pay' } });
      await h.useCase.submit(context(), draft.id, command(0));
      await h.useCase.approve(approvalContext(), draft.id, command(1));
      assert.deepEqual(h.state.noticeInputs[0].recipientUserIds, ['actor-1']);
      assert.equal(h.state.noticeInputs[0].triggerKey, 'expense.disbursement_approved');
      assert.equal(h.state.noticeInputs[0].severity, payerId === 'actor-1' ? 'action' : 'info');
      assert.equal(h.state.noticeInputs[0].body, payerId === 'actor-1' ? 'สมชาย อนุมัติแล้ว จ่ายเงินให้ ร้าน ก ยอด 10.10 บาท แล้วบันทึกว่าจ่ายแล้วที่ใบนี้' : 'สมชาย อนุมัติแล้ว รอผู้มีสิทธิ์บันทึกจ่าย');
      if (payerId === 'neither') {
        const task = h.state.noticeInputs[1]; assert.deepEqual(task.recipientUserIds, ['pay-user']); assert.equal(task.severity, 'action');
        assert.equal(task.title, 'รอคุณบันทึกจ่าย: ใบเตรียมจ่ายเลขที่ PV-202610-00001');
        assert.equal(task.body, 'จ่ายเงินให้ ร้าน ก ยอด 10.10 บาท แล้วบันทึกว่าจ่ายแล้วที่ใบนี้');
      }
      assert.equal(h.state.noticeInputs[0].periodKey, '1');
    }
    const h = harness(), draft = await h.useCase.create(context(), body());
    await h.useCase.submit(context({ userId: 'someone' }), draft.id, command(0));
    await h.useCase.approve(approvalContext('someone'), draft.id, command(1));
    assert.deepEqual(h.state.noticeInputs[0].recipientUserIds, ['actor-1'], 'self-approval still informs the other preparer');
    const immediate = harness(), prepared = await immediate.useCase.create(context(), body());
    await immediate.useCase.submit(context({ userId: 'someone', permissions: ['expense.disbursement.prepare', 'expense.disbursement.approve', 'expense.read'] }), prepared.id, { ...command(0), approveNow: true });
    assert.deepEqual(immediate.state.noticeInputs.map((n: any) => [n.triggerKey, n.recipientUserIds]), [['expense.disbursement_approved', ['actor-1']]]);
    const other = harness(), second = await other.useCase.create(context(), body());
    await other.useCase.submit(context({ userId: 'someone' }), second.id, command(0));
    await other.useCase.approve(approvalContext('actor-1'), second.id, command(1));
    assert.equal(other.state.vouchers[0].selfApproved, false); assert.equal(other.state.noticeInputs.length, 0, 'the preparer who approves receives no notice');
  });

  it('sends return, withdraw, paid and cancelled notices only to the other active preparer, once after commit', async () => {
    for (const action of ['return', 'withdraw', 'cancel', 'pay'] as const) {
      for (const actor of ['actor-1', 'someone']) {
        const h = harness(), draft = await h.useCase.create(context(), body());
        await h.useCase.submit(context({ userId: action === 'withdraw' || action === 'cancel' ? actor : 'actor-1' }), draft.id, command(0));
        if (action === 'return' && actor === 'actor-1') {
          await assert.rejects(() => h.useCase.return(approvalContext(actor), draft.id, { ...command(1), reason: 'ตรวจใหม่' }), ForbiddenException);
          assert.equal(h.state.noticeInputs.length, 0);
          continue;
        }
        let version = 1;
        if (action === 'pay') { await h.useCase.approve(approvalContext(), draft.id, command(1)); version++; h.state.noticeInputs = []; }
        const input = { ...command(version), ...(action !== 'pay' ? { reason: 'ตรวจใหม่' } : {}) };
        const caller = action === 'pay' ? payer({ userId: actor }) : approvalContext(actor);
        const result = await h.useCase[action](caller, draft.id, input);
        assert.equal(h.state.noticeInputs.length, actor === 'actor-1' ? 0 : 1, action);
        if (actor !== 'actor-1') {
          const notice = h.state.noticeInputs[0];
          assert.deepEqual(notice.recipientUserIds, ['actor-1']); assert.equal(notice.severity, action === 'return' || action === 'withdraw' ? 'action' : 'info');
          assert.equal(notice.periodKey, action === 'pay' || action === 'cancel' ? draft.id : '1');
          if (action === 'return') assert.equal(notice.body, 'สมชาย ส่งกลับให้แก้ เหตุผล: ตรวจใหม่ แก้แล้วส่งใหม่ได้ด้วยเลขที่เดิม');
          if (action === 'withdraw') assert.equal(notice.body, 'สมชาย นำใบกลับไปแก้ เหตุผล: ตรวจใหม่ แก้แล้วส่งใหม่ได้ด้วยเลขที่เดิม');
          if (action === 'cancel') assert.equal(notice.body, 'สมชาย ยกเลิกใบนี้ เหตุผล: ตรวจใหม่ รายจ่ายในใบกลับไปเป็นยังไม่จ่าย');
          if (action === 'pay') assert.match(notice.body, /^สมชาย บันทึกว่าจ่ายให้ ร้าน ก ยอด 10.10 บาท เมื่อ .+ ใบนี้เป็นใบสำคัญจ่ายแล้ว$/);
        }
        assert.equal((await h.useCase[action](caller, draft.id, input)).status, result.status);
        assert.equal(h.state.noticeInputs.length, actor === 'actor-1' ? 0 : 1, 'replay sends nothing');
      }
    }
  });

  it('does not notify an inactive preparer on return, withdraw, cancellation or payment', async () => {
    for (const action of ['return', 'withdraw', 'cancel', 'pay'] as const) {
      const h = harness(), draft = await h.useCase.create(context(), body());
      await h.useCase.submit(context({ userId: action !== 'pay' ? 'someone' : 'actor-1' }), draft.id, command(0));
      let version = 1;
      if (action === 'pay') { await h.useCase.approve(approvalContext(), draft.id, command(1)); version++; h.state.noticeInputs = []; }
      h.state.members.find((m: any) => m.userId === 'actor-1').status = 'DISABLED';
      await h.useCase[action](action === 'pay' ? payer({ userId: 'someone' }) : approvalContext(action === 'return' ? 'another-approver' : 'someone'), draft.id,
        { ...command(version), ...(action !== 'pay' ? { reason: 'ตรวจใหม่' } : {}) });
      assert.equal(h.state.noticeInputs.length, 0, action);
    }
  });

  it('creates a new pending round after resubmit, skips removed preparers and preserves success on notice failure', async () => {
    const h = harness(), draft = await h.useCase.create(context(), body());
    await h.useCase.submit(context(), draft.id, { ...command(0), requestedApproverUserId: 'someone' });
    await h.useCase.withdraw(context(), draft.id, command(1));
    await h.useCase.submit(context(), draft.id, { ...command(2), requestedApproverUserId: 'someone' });
    assert.deepEqual(h.state.noticeInputs.map((n: any) => n.periodKey), ['1', '2']);
    h.state.members.find((m: any) => m.userId === 'actor-1').status = 'DISABLED';
    await h.useCase.approve(approvalContext(), draft.id, command(3));
    assert.equal(h.state.noticeInputs.length, 2);
    const failing = harness(), other = await failing.useCase.create(context(), body());
    failing.notifier.execute = async () => { throw new Error('notice unavailable'); };
    const submitted = await failing.useCase.submit(context(), other.id, { ...command(0), requestedApproverUserId: 'someone' });
    assert.equal(submitted.status, 'PENDING_APPROVAL'); assert.equal(failing.state.commands.length, 2);
  });

  it('limits reminders per recipient across A → B → A, replays truthfully and exposes the next reminder time', async () => {
    const h = harness(), draft = await h.useCase.create(context(), body());
    await h.useCase.submit(context(), draft.id, command(0));
    const input = { ...command(1), approverUserId: 'someone' };
    const first = await h.useCase.remind(context(), draft.id, input);
    assert.equal(first.reminderCount, 1); assert.equal(first.lastReminderToUserId, 'someone');
    const detail = await h.useCase.get(context(), draft.id);
    assert.equal(detail.lastReminderToName, 'สมชาย'); assert.equal(detail.nextReminderAt, new Date(new Date(first.lastReminderAt!).getTime() + 3600000).toISOString());
    const prior = h.state.commands.at(-1), at = new Date(Date.now() - 300000);
    prior.resultJson.reminder.at = at.toISOString();
    await h.useCase.remind(context(), draft.id, { ...command(2), approverUserId: 'actor-1' });
    assert.equal((await h.useCase.remind(context(), draft.id, input)).reminderCount, 2);
    await assert.rejects(() => h.useCase.remind(context(), draft.id, { ...input, approverUserId: 'actor-1' }), (e: any) => e.getResponse().code === 'disbursement_command_conflict');
    const nextTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at.getTime() + 3600000));
    await assert.rejects(() => h.useCase.remind(context(), draft.id, { ...command(3), approverUserId: 'someone' }), refusal('disbursement_reminder_cooldown', `เพิ่งส่งเตือน สมชาย ไปเมื่อ 5 นาทีที่แล้ว ส่งได้อีกครั้งหลัง ${nextTime} น. หรือเลือกผู้อนุมัติคนอื่น`));
    assert.equal(h.state.vouchers[0].reminderCount, 2);
    h.state.commands.find((c: any) => c.commandId === input.commandId).resultJson.reminder.at = new Date(Date.now() - 3600001).toISOString();
    await h.useCase.remind(context(), draft.id, { ...command(3), approverUserId: 'someone' });
    assert.deepEqual(h.state.noticeInputs.map((n: any) => n.periodKey), ['1:1', '1:3']);
    await assert.rejects(() => h.useCase.remind(context(), draft.id, { ...command(1, { commandId: 'stale-remind' }), approverUserId: 'someone' }), (e: any) => e.getResponse().code === 'disbursement_version_conflict');
  });

  it('shows reminders only in their current revision while the hourly limit survives a return and resubmit', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-11T22:00:00Z').getTime() });
    const h = harness(), draft = await h.useCase.create(context(), body());
    await h.useCase.submit(context(), draft.id, command(0));
    await h.useCase.remind(context(), draft.id, { ...command(1), approverUserId: 'someone' });
    await h.useCase.return(approvalContext(), draft.id, { ...command(2), reason: 'ตรวจใหม่' });
    await h.useCase.submit(context(), draft.id, command(3));
    // Also project documents submitted before this fix from the exact journal revision, not timestamps.
    h.state.vouchers[0].lastReminderToUserId = 'someone'; h.state.vouchers[0].lastReminderAt = new Date();
    const detail = await h.useCase.get(context(), draft.id);
    assert.equal(detail.header.lastReminderToUserId, null); assert.equal(detail.header.lastReminderAt, null);
    assert.equal(detail.lastReminderToName, null); assert.equal(detail.nextReminderAt, null);
    await assert.rejects(() => h.useCase.remind(context(), draft.id, { ...command(4), approverUserId: 'someone' }), (e: any) => e.getResponse().code === 'disbursement_reminder_cooldown');
    t.mock.timers.setTime(Date.now() + 3600001);
    const reminded = await h.useCase.remind(context(), draft.id, { ...command(4), approverUserId: 'someone' });
    assert.equal((await h.useCase.get(context(), draft.id)).header.lastReminderAt, reminded.lastReminderAt);
  });

  it('returns the typed payment cancellation reason on the detail without changing the frozen paid snapshot', async () => {
    const h = harness(), v = await approvedDraft(h); await h.useCase.pay(payer(), v.id, command(1));
    const frozen = structuredClone(h.state.vouchers[0].paidSnapshotJson);
    await cancelDisbursementVouchersForPayments(h.client, 'company-1', [h.state.payments[0].id], 'someone', new Date(), 'EXP-a', false, 'โอนผิดบัญชี');
    const detail = await h.useCase.get(context(), v.id);
    assert.equal(detail.header.cancelSourceReason, 'โอนผิดบัญชี'); assert.equal(detail.header.cancelReason, 'การจ่ายของรายการ EXP-a ถูกยกเลิก');
    assert.deepEqual(h.state.vouchers[0].paidSnapshotJson, frozen);
  });

  it('distinguishes reminders, formats notice amounts and says just now during the first minute', async () => {
    const h = harness([source('a', { outstandingAmount: '4000', netPayableAmount: '4000' })]);
    const draft = await h.useCase.create(context(), body({ lines: [{ expenseId: 'a', amount: '4000' }] }));
    await h.useCase.submit(context(), draft.id, { ...command(0), requestedApproverUserId: 'someone' });
    assert.match(h.state.noticeInputs[0].body, /4,000.00 บาท/);
    await h.useCase.remind(context(), draft.id, { ...command(1), approverUserId: 'someone' });
    const notice = h.state.noticeInputs[1]; assert.equal(notice.title, 'เตือนอีกครั้ง: ใบเตรียมจ่ายเลขที่ PV-202610-00001 รออนุมัติ');
    assert.equal(notice.body, 'สมใจ ขอให้คุณตรวจและอนุมัติใบเตรียมจ่ายนี้ จ่ายให้ ร้าน ก ยอด 4,000.00 บาท');
    await assert.rejects(() => h.useCase.remind(context(), draft.id, { ...command(2), approverUserId: 'someone' }), (e: any) => {
      assert.match(e.getResponse().message, /เพิ่งส่งเตือน สมชาย ไปเมื่อสักครู่/); assert.doesNotMatch(e.getResponse().message, /0 นาที/); return true;
    });
  });

  it('notifies cancellation of covered documents after cancel-payment commits', async () => {
    const h = harness(); let committed = false;
    const repo: any = { findById: async () => ({ branchId: 'branch-1' }), cancelPaymentAtomic: async (_input: any, callback: any) => {
      await callback({}, ['dv-1']); committed = true; return { id: 'a' };
    } };
    const notices = { cancelled: async (_ctx: any, ids: string[]) => { assert.equal(committed, true); assert.deepEqual(ids, ['dv-1']); h.state.noticeInputs.push(ids); } };
    const cancel = new (CancelExpensePaymentUseCase as any)(repo, h.audit, notices);
    await cancel.execute(context({ permissions: ['expense.payment.record'] }), 'a', 'pay', 'ยอดผิด');
    assert.equal(h.state.noticeInputs.length, 1);
  });

  it('cancellation after payment tells the other preparer what remains, once, and never rewrites payment history', async () => {
    for (const remaining of [false, true]) {
      const h = harness(), draft = await h.useCase.create(context(), body());
      await h.useCase.submit(context({ permissions: ['expense.disbursement.prepare', 'expense.disbursement.approve', 'expense.read'] }), draft.id, { ...command(0), approveNow: true });
      await h.useCase.pay(payer(), draft.id, command(1));
      h.state.payments[0].status = 'VOIDED';
      const paymentId = h.state.payments[0].id;
      if (remaining) {
        h.state.payments.push({ id: 'remaining-payment', companyId: 'company-1', status: 'RECORDED' });
        h.state.lines.push({ companyId: 'company-1', voucherId: draft.id, expensePaymentId: 'remaining-payment', coversPaymentId: 'remaining-payment', expenseId: 'b', position: 2 });
      }
      const ids = await cancelDisbursementVouchersForPayments(h.client, 'company-1', [paymentId], 'someone', new Date(), 'EXP-a');
      assert.deepEqual(ids, [draft.id]);
      await h.notices.cancelled(approvalContext(), ids);
      const notice = h.state.noticeInputs[0];
      assert.equal(notice.triggerKey, 'expense.disbursement_cancelled'); assert.equal(notice.periodKey, draft.id); assert.deepEqual(notice.recipientUserIds, ['actor-1']);
      assert.equal(notice.body, remaining ? 'ใบนี้ถูกยกเลิกเพราะการจ่ายของรายการ EXP-a ถูกยกเลิก การจ่ายรายการอื่นในใบยังอยู่ ออกใบใหม่สำหรับการจ่ายที่เหลือได้ที่หน้าของใบ'
        : 'ใบนี้ถูกยกเลิกเพราะการจ่ายของรายการ EXP-a ถูกยกเลิก ไม่มีการจ่ายที่ยังมีผลเหลืออยู่ในใบนี้');
      assert.ok(h.state.lines.every((l: any) => l.coversPaymentId === null && l.expensePaymentId));
      assert.deepEqual(await cancelDisbursementVouchersForPayments(h.client, 'company-1', [paymentId], 'someone', new Date(), 'EXP-a'), []);
      await h.notices.send(context(), disbursementVoucherHeader(h.state.vouchers[0]), 'cancel');
      assert.equal(h.state.noticeInputs.length, 1, 'the preparer who acts is never told');
    }
  });

  it('describes earlier partial payments truthfully on a pre-payment cancel and omits an absent withdrawal reason', async () => {
    const h = harness([source('a', { outstandingAmount: '94.0000', paidAmount: '10.0000' })]), draft = await h.useCase.create(context(), body());
    await h.useCase.submit(context({ userId: 'someone' }), draft.id, command(0));
    await h.useCase.cancel(approvalContext(), draft.id, { ...command(1), reason: 'ไม่ใช้ใบนี้' });
    assert.equal(h.state.noticeInputs[0].body, 'สมชาย ยกเลิกใบนี้ เหตุผล: ไม่ใช้ใบนี้ การจ่ายที่บันทึกไว้ก่อนหน้านี้ยังอยู่');
    const other = harness(), second = await other.useCase.create(context(), body());
    await other.useCase.submit(context({ userId: 'someone' }), second.id, command(0));
    await other.useCase.withdraw(approvalContext(), second.id, command(1));
    assert.equal(other.state.noticeInputs[0].body, 'สมชาย นำใบกลับไปแก้ แก้แล้วส่งใหม่ได้ด้วยเลขที่เดิม');
  });

  it('reminders roll back on collisions, send no notice and retain their own retry sentence', async () => {
    const h = harness(), draft = await h.useCase.create(context(), body());
    await h.useCase.submit(context(), draft.id, command(0));
    for (const error of [{ code: 'P2034' }, { code: 'P2028' }, { code: '55P03' }]) {
      const transaction = h.client.$transaction;
      h.client.$transaction = async () => { throw error; };
      await assert.rejects(() => h.useCase.remind(context(), draft.id, { ...command(1), approverUserId: 'someone' }), refusal('disbursement_changed_retry', 'มีการทำรายการกับใบนี้หรือรายจ่ายในใบพร้อมกัน ระบบยังไม่ได้บันทึกสิ่งที่คุณเพิ่งทำ เปิดหน้านี้ใหม่แล้วลองอีกครั้ง'));
      h.client.$transaction = transaction;
      assert.equal(h.state.noticeInputs.length, 0); assert.equal(h.state.vouchers[0].version, 1);
    }
  });

  it('reminders require prepare, a visible pending document and an eligible branch approver', async () => {
    const h = harness(), draft = await h.useCase.create(context(), body());
    const remind = (c: any, input: any) => (h.useCase as any).remind(c, draft.id, input);
    const input = { ...command(0), approverUserId: 'someone' };
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, DisbursementVoucherController.prototype.remind), ['expense.disbursement.prepare']);
    assert.equal(Reflect.getMetadata(PATH_METADATA, DisbursementVoucherController.prototype.remind), ':id/remind');
    assert.equal(Reflect.getMetadata(METHOD_METADATA, DisbursementVoucherController.prototype.remind), RequestMethod.POST);
    await assert.rejects(() => remind(approvalContext(), input), refusal('disbursement_permission_denied', 'คุณยังไม่มีสิทธิ์ทำรายการนี้ ให้ผู้ดูแลร้านเพิ่มสิทธิ์ก่อนแล้วลองอีกครั้ง'));
    await assert.rejects(() => remind(context(), input), refusal('disbursement_status_changed', 'สถานะของใบนี้เปลี่ยนไปแล้ว เปิดหน้านี้ใหม่เพื่อดูสถานะล่าสุด'));
    await h.useCase.submit(context(), draft.id, command(0));
    for (const approverUserId of ['other-branch', 'no-right', 'missing']) await assert.rejects(() => remind(context(), { ...command(1), approverUserId }), refusal('disbursement_approver_ineligible', 'ผู้อนุมัติที่เลือกไม่มีสิทธิ์อนุมัติใบของสาขานี้แล้ว เลือกใหม่'));
    await assert.rejects(() => remind(context({ authProvider: 'line' }), { ...command(1), approverUserId: 'someone' }), (e: any) => e.getResponse().code === 'disbursement_line_session_denied');
    await assert.rejects(() => remind(context({ scopes: { branchIds: ['branch-2'] } }), { ...command(1), approverUserId: 'someone' }), (e: any) => e.getResponse().code === 'disbursement_not_found');
    h.state.expenses[0].createdByUserId = 'someone';
    await assert.rejects(() => remind(context({ permissions: ['expense.disbursement.prepare', 'expense.read_own'] }), { ...command(1), approverUserId: 'someone' }), (e: any) => e.getResponse().code === 'disbursement_not_found');
    await assert.rejects(() => remind(context({ companyId: 'elsewhere' }), { ...command(1), approverUserId: 'someone' }), (e: any) => e.getResponse().code === 'disbursement_not_found');
  });

  it('prefills only a visible same-payee account, ranks paid before newer drafts and never returns secrets', async () => {
    const h = harness();
    const key = (await new ReadDisbursementVoucherSourcesUseCase(new PrismaExpenseRepository({ client: h.client } as any), new ListExpensesUseCase(new PrismaExpenseRepository({ client: h.client } as any))).payees(context(), {})).data[0]!.payeeKey;
    assert.equal(await (h.useCase as any).payeeAccount(context(), key), null);
    const first = await h.useCase.create(context(), body({ payeeBankName: 'ธนาคาร', payeeAccountName: 'ร้าน ก', payeeAccountNumber: '1234567890' }));
    h.state.vouchers[0].status = 'PAID';
    await h.useCase.create(context(), body({ commandId: 'newer', payeeBankName: 'ใหม่', payeeAccountNumber: '5555555555' }));
    assert.deepEqual(await (h.useCase as any).payeeAccount(context(), key), { bankName: 'ธนาคาร', accountName: 'ร้าน ก', last4: '7890', sourceVoucherId: first.id });
    assert.equal(await (h.useCase as any).payeeAccount(context({ scopes: { branchIds: ['branch-2'] } }), key), null);
    assert.equal(await (h.useCase as any).payeeAccount(context({ companyId: 'other' }), key), null);
    assert.equal(await (h.useCase as any).payeeAccount(context(), 'other-payee'), null);
    h.state.vouchers[1].status = 'PAID'; h.state.vouchers[1].createdAt = new Date(Date.now() + 1000);
    assert.equal((await (h.useCase as any).payeeAccount(context(), key)).sourceVoucherId, h.state.vouchers[1].id);
    h.state.vouchers[0].status = 'DRAFT'; h.state.vouchers[1].status = 'APPROVED';
    assert.equal((await (h.useCase as any).payeeAccount(context(), key)).sourceVoucherId, h.state.vouchers[1].id);
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, DisbursementVoucherController.prototype.payeeAccount), ['expense.disbursement.prepare']);
    await assert.rejects(() => (h.useCase as any).payeeAccount(context({ permissions: ['expense.read'] }), key), (e: any) => e.getStatus() === 403);
  });

  it('copies account ciphertext on create and update, checks source company and payee, and typed number wins', async () => {
    const h = harness();
    const first = await h.useCase.create(context(), body({ payeeBankName: 'ธนาคาร', payeeAccountName: 'ร้าน ก', payeeAccountNumber: '1234567890' }));
    const copied = await h.useCase.create(context(), body({ commandId: 'copy', payeeAccountFromVoucherId: first.id }));
    assert.equal(h.state.vouchers[1].payeeAccountCiphertext, h.state.vouchers[0].payeeAccountCiphertext);
    assert.equal(copied.payeeAccountLast4, '7890');
    await h.useCase.update(context(), copied.id, { ...body({ commandId: 'copy-update', payeeAccountFromVoucherId: first.id }), expectedVersion: 0 });
    h.state.expenses[1].vendorTaxIdSnapshot = '9999999999999';
    await assert.rejects(() => h.useCase.create(context(), body({ commandId: 'wrong-payee', lines: [{ expenseId: 'b', amount: '10' }], payeeAccountFromVoucherId: first.id })), (e: any) => e.getStatus() === 409);
    const combined = await h.useCase.create(context(), body({ commandId: 'confirmed-other-lines', lines: [{ expenseId: 'a', amount: '10' }, { expenseId: 'b', amount: '10' }], payeeConfirmed: true, payeeAccountFromVoucherId: first.id }));
    assert.equal(combined.payeeAccountLast4, '7890');
    h.state.expenses.push(source('branch-two', { branchId: 'branch-2' }));
    await assert.rejects(() => h.useCase.create(context({ scopes: { branchIds: ['branch-2'] } }), body({ commandId: 'wrong-branch', lines: [{ expenseId: 'branch-two', amount: '10' }], payeeAccountFromVoucherId: first.id })), (e: any) => e.getStatus() === 403);
    h.state.vouchers[0].companyId = 'other';
    await assert.rejects(() => h.useCase.create(context(), body({ commandId: 'wrong-company', payeeAccountFromVoucherId: first.id })), (e: any) => e.getStatus() === 403);
    const typed = await h.useCase.create(context(), body({ commandId: 'typed', payeeAccountFromVoucherId: first.id, payeeBankName: 'ใหม่', payeeAccountNumber: '9999999999' }));
    assert.equal(typed.payeeAccountLast4, '9999');
  });

  it('seals optional payee accounts, validates number and bank, preserves omitted values and clears an empty number', async () => {
    const h = harness();
    for (const number of ['12345', '123456789012345678901', '12345x']) {
      await assert.rejects(() => h.useCase.create(context(), body({ payeeAccountNumber: number, payeeBankName: 'ธนาคาร' } as any)), refusal('disbursement_account_number_invalid', 'เลขบัญชีผู้รับเงินต้องเป็นตัวเลข 6 ถึง 20 หลัก แก้เลขบัญชีแล้วลองอีกครั้ง'));
    }
    await assert.rejects(() => h.useCase.create(context(), body({ payeeAccountNumber: '1234567890' } as any)), refusal('disbursement_account_bank_required', 'ยังไม่ได้ระบุธนาคารของบัญชีผู้รับเงิน เลือกธนาคารก่อนบันทึก'));
    const draft = await h.useCase.create(context(), body({ payeeBankName: 'ธนาคาร', payeeAccountName: 'ร้าน ก', payeeAccountNumber: '123-456 7890' } as any));
    assert.equal((draft as any).payeeAccountLast4, '7890');
    assert.notEqual(h.state.vouchers[0].payeeAccountCiphertext, '1234567890');
    const saved = await h.useCase.update(context(), draft.id, { ...body({ commandId: 'preserve' }), expectedVersion: 0 });
    assert.equal((saved as any).payeeAccountLast4, '7890');
    await assert.rejects(() => h.useCase.update(context(), draft.id, { ...body({ commandId: 'empty-bank', payeeBankName: '' }), expectedVersion: 1 }), refusal('disbursement_account_bank_required', 'ยังไม่ได้ระบุธนาคารของบัญชีผู้รับเงิน เลือกธนาคารก่อนบันทึก'));
    const cleared = await h.useCase.update(context(), draft.id, { ...body({ commandId: 'clear', payeeAccountNumber: '' } as any), expectedVersion: 1 });
    for (const key of ['payeeBankName', 'payeeAccountName', 'payeeAccountLast4', 'payeeAccountCiphertext']) assert.equal(h.state.vouchers[0][key], null);
    assert.equal((cleared as any).payeeAccountLast4, null);
  });

  it('fingerprints account numbers as stable keyed hashes and refuses a changed-number replay', async () => {
    const h = harness(), input = body({ payeeBankName: 'ธนาคาร', payeeAccountNumber: '9988-776655' });
    const first = await h.useCase.create(context(), input);
    assert.equal((await h.useCase.create(context(), { ...input, payeeAccountNumber: '9988776655' })).id, first.id);
    await assert.rejects(() => h.useCase.create(context(), { ...input, payeeAccountNumber: '9988776656' }), refusal('disbursement_command_conflict', 'ข้อมูลไม่ตรงกับคำสั่งที่บันทึกไว้ ให้เปิดใบตรวจข้อมูล แล้วใช้คำสั่งใหม่ถ้าต้องการแก้ไข'));
    assert.ok(!JSON.stringify(h.state.commands).includes('9988776655'));
  });

  it('reveals to draft editors, approvers or payers after audit and keeps the number out of public JSON', async () => {
    const h = harness();
    const draft = await h.useCase.create(context(), body({ payeeBankName: 'ธนาคาร', payeeAccountNumber: '9988776655' } as any));
    const reveal = (ctx: any) => (h.useCase as any).revealAccount(ctx, draft.id);
    assert.deepEqual(await reveal(context()), { accountNumber: '9988776655' });
    assert.deepEqual(await reveal(approvalContext()), { accountNumber: '9988776655' });
    assert.equal(h.state.audits.at(-1).action, 'expense.disbursement.payee_account.reveal');
    assert.deepEqual(await reveal(payer()), { accountNumber: '9988776655' });
    await assert.rejects(() => reveal({ ...approvalContext(), authProvider: 'line' }), (e: any) => e.getResponse().code === 'disbursement_line_session_denied');
    await assert.rejects(() => reveal({ ...approvalContext(), companyId: 'other-company' }), refusal('disbursement_not_found', 'ไม่พบใบเตรียมจ่ายที่เปิดดูได้ ให้กลับไปหน้ารายการแล้วเลือกใบใหม่'));
    const empty = await h.useCase.create(context(), body({ commandId: 'no-account' }));
    await assert.rejects(() => (h.useCase as any).revealAccount(approvalContext(), empty.id), refusal('disbursement_account_missing', 'ใบนี้ไม่ได้ระบุบัญชีผู้รับเงิน เปิดใบนี้เพื่อตรวจวิธีจ่าย'));
    const submitted = await h.useCase.submit(context(), draft.id, command(0));
    const publicJson = JSON.stringify([await h.useCase.list(context(), {}), await h.useCase.get(context(), draft.id), h.state.revisions, h.state.audits, h.state.commands]);
    assert.ok(!publicJson.includes('9988776655') && !publicJson.includes(h.state.vouchers[0].payeeAccountCiphertext));
    h.state.vouchers[0].payeeAccountCiphertext = 'broken-cipher';
    h.audit.logOrThrow = async () => { throw new Error('audit failed'); };
    await assert.rejects(() => reveal(approvalContext()), /audit failed/);
    assert.equal(submitted.status, 'PENDING_APPROVAL');
  });

  it('draft account reveal reuses edit rights; later states require approve/pay unless revealing a readable prefill source', async () => {
    const h = harness();
    const draft = await h.useCase.create(context(), body({ payeeBankName: 'ธนาคาร', payeeAccountNumber: '9988776655' }));
    const reveal = (ctx = context(), purpose?: 'prefill') => h.useCase.revealAccount(ctx, draft.id, purpose);
    for (const status of ['PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED']) {
      h.state.vouchers[0].status = status;
      await assert.rejects(() => reveal(), (e: any) => e.getStatus() === 403);
      assert.deepEqual(await reveal(approvalContext()), { accountNumber: '9988776655' });
      assert.deepEqual(await reveal(payer()), { accountNumber: '9988776655' });
      assert.deepEqual(await reveal(context(), 'prefill'), { accountNumber: '9988776655' });
      assert.equal(h.state.audits.at(-1).targetId, draft.id);
      assert.equal(h.state.audits.at(-1).metadataJson.purpose, 'prefill');
    }
    for (const purpose of [undefined, 'prefill'] as const) {
      h.state.vouchers[0].status = 'DRAFT';
      for (const ctx of [context({ companyId: 'elsewhere' }), context({ scopes: { branchIds: ['branch-2'] } })]) {
        await assert.rejects(() => reveal(ctx, purpose), (e: any) => e.getStatus() === 404);
      }
      await assert.rejects(() => reveal(context({ permissions: ['expense.read', 'expense.disbursement.read'] }), purpose), (e: any) => e.getStatus() === 403);
      h.state.vouchers[0].payeeAccountCiphertext = 'invalid-cipher-must-not-be-opened';
      h.audit.logOrThrow = async () => { throw new Error('audit failed before decrypt'); };
      await assert.rejects(() => reveal(context(), purpose), /audit failed before decrypt/);
    }
  });

  it('freezes the accounting print facts without full account numbers on submission and payment', async () => {
    const h = harness([source('a', { vendorDocumentNumber: 'INV-W7', vendorAddressSnapshot: '88 ถนนผู้ขาย', vendorBranchCodeSnapshot: '00001' })]);
    const companyFind = h.client.company.findFirst;
    h.client.company.findFirst = async (query: any) => ({ ...await companyFind(query), phone: '02-123-4567' });
    const draft = await h.useCase.create(context(), body({ payeeBankName: 'ธนาคาร', payeeAccountNumber: '9988776655', plannedPayDate: '2026-10-20' }));
    await h.useCase.submit(context(), draft.id, command(0));
    const prepared = h.state.revisions[0].snapshotJson;
    assert.equal(prepared.company.phone, '02-123-4567');
    assert.equal(prepared.documentDate, h.state.vouchers[0].createdAt.toISOString());
    assert.equal(prepared.lines[0].vendorDocumentNumber, 'INV-W7'); assert.equal(prepared.lines[0].vendorAddress, '88 ถนนผู้ขาย');
    assert.equal(prepared.lines[0].vendorBranchCode, '00001');
    await h.useCase.approve(approvalContext(), draft.id, command(1)); await h.useCase.pay(payer(), draft.id, command(2));
    const paid = h.state.vouchers[0].paidSnapshotJson;
    assert.equal(paid.lines[0].vendorDocumentNumber, 'INV-W7'); assert.equal(paid.lines[0].vendorAddress, '88 ถนนผู้ขาย');
    assert.equal(paid.company.phone, '02-123-4567'); assert.equal(paid.plannedPayDate, '2026-10-20');
    assert.ok(!JSON.stringify([prepared, paid]).includes('9988776655'));
  });
  it('audits full accounts on fresh PDF downloads only for reveal-authorized readers and never rewrites stored paid bytes', async () => {
    const h = harness(), draft = await h.useCase.create(context(), body({ payeeBankName: 'ธนาคาร', payeeAccountNumber: '9988776655' }));
    await h.useCase.submit(context(), draft.id, command(0));
    const frozen = JSON.stringify(h.state.revisions);
    const reveals = () => h.state.audits.filter((a: any) => a.action === 'expense.disbursement.payee_account.reveal');
    await h.useCase.documentPdf(context(), draft.id); assert.equal(reveals().length, 0);
    for (const reader of [approvalContext(), payer()]) await h.useCase.documentPdf(reader, draft.id);
    assert.equal(reveals().length, 2); assert.equal(reveals()[0].targetId, draft.id);
    assert.equal(reveals()[0].riskLevel, 'HIGH'); assert.equal(reveals()[0].actorUserId, approvalContext().userId);
    for (const reader of [context({ companyId: 'elsewhere' }), context({ scopes: { branchIds: ['branch-2'] } })]) {
      await assert.rejects(() => h.useCase.documentPdf(reader, draft.id), (e: any) => e.getStatus?.() === 404);
    }
    assert.equal(reveals().length, 2); assert.equal(JSON.stringify(h.state.revisions), frozen);
    Object.assign(h.state.vouchers[0], { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'ยอดผิด' });
    await h.useCase.documentPdf(approvalContext(), draft.id); assert.equal(reveals().length, 3);
    h.audit.logOrThrow = async () => { throw new Error('audit failed'); };
    await assert.rejects(() => h.useCase.documentPdf(approvalContext(), draft.id), /audit failed/);
    Object.assign(h.state.vouchers[0], { status: 'PAID', pdfAttachmentId: 'stored' });
    (h.useCase as any).files = { withSignatures: async (_company: string, snapshot: any) => snapshot, ensure: async () => ({ data: Buffer.from('%PDF stored masked'), fileName: 'PV.pdf' }) };
    assert.equal((await h.useCase.documentPdf(approvalContext(), draft.id)).data.toString(), '%PDF stored masked');
    assert.ok(!JSON.stringify([h.state.audits, h.state.revisions]).includes('9988776655'));
  });

  it('prints submitted revisions only and hides PDFs outside the document read scope', async () => {
    const h = harness(), draft = await h.useCase.create(context(), body());
    const download = (ctx: any = context()) => (h.useCase as any).documentPdf(ctx, draft.id);
    await assert.rejects(() => download(), refusal('disbursement_print_unsubmitted', 'ใบนี้ยังไม่ได้ส่งอนุมัติ จึงยังพิมพ์ไม่ได้ บันทึกแล้วส่งอนุมัติก่อน'));
    await assert.rejects(() => download(context({ permissions: ['expense.read'] })), refusal('disbursement_not_found', 'ไม่พบใบเตรียมจ่ายที่เปิดดูได้ ให้กลับไปหน้ารายการแล้วเลือกใบใหม่'));
    await h.useCase.submit(context(), draft.id, command(0));
    const pdf = await download(); assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
    assert.equal(h.state.vouchers[0].pdfAttachmentId, undefined);
    await h.useCase.return(approvalContext(), draft.id, { ...command(1), reason: 'ตรวจใหม่' });
    assert.equal((await download()).data.subarray(0, 4).toString(), '%PDF');
    await assert.rejects(() => download({ ...context(), companyId: 'another-company' }), refusal('disbursement_not_found', 'ไม่พบใบเตรียมจ่ายที่เปิดดูได้ ให้กลับไปหน้ารายการแล้วเลือกใบใหม่'));
    const details = await h.useCase.get(context(), draft.id);
    assert.equal((details as any).returnedByName, 'สมชาย');
  });

  it('serves a newly marked cancelled PDF while preserving the stored original and frozen snapshot', async () => {
    for (const paid of [false, true]) {
      const h = harness(), v = await approvedDraft(h);
      if (paid) await h.useCase.pay(payer(), v.id, command(1));
      const voucher = h.state.vouchers[0];
      Object.assign(voucher, { status: 'CANCELLED', cancelledAfterPaid: paid, cancelledAt: new Date(), cancelReason: 'ยอดผิด', pdfAttachmentId: paid ? 'original' : null });
      if (paid) h.state.payments[0].status = 'VOIDED';
      const snapshot = structuredClone(paid ? voucher.paidSnapshotJson : h.state.revisions[0].snapshotJson);
      (h.useCase as any).files = { withSignatures: async (_company: string, snapshot: any) => snapshot, ensure: async () => assert.fail('a cancelled download must render a marked copy') };
      const pdf = await h.useCase.documentPdf(context(), v.id);
      assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
      assert.equal(voucher.pdfAttachmentId, paid ? 'original' : null);
      assert.deepEqual(paid ? voucher.paidSnapshotJson : h.state.revisions[0].snapshotJson, snapshot);
    }
  });

  it('freezes only the payment evidence present when paid, despite a later replacement', async () => {
    const h = harness(), v = await approvedDraft(h);
    h.state.vouchers[0].slipAttachmentId = 'slip';
    h.state.attachmentLinks.push({ companyId: 'company-1', attachmentId: 'slip', targetType: 'disbursement_voucher', targetId: v.id,
      purpose: 'expense.disbursement_voucher.slip', linkedByUserId: 'someone', createdAt: new Date('2026-10-11T03:00:00Z') });
    await h.useCase.pay(payer(), v.id, command(1));
    const evidence = h.state.vouchers[0].paidSnapshotJson.paymentEvidence;
    assert.deepEqual(evidence, { attachedByName: 'สมชาย', attachedAt: '2026-10-11T03:00:00.000Z' });
    h.state.vouchers[0].slipAttachmentId = 'replacement';
    assert.deepEqual(h.state.vouchers[0].paidSnapshotJson.paymentEvidence, evidence);
    const none = harness(), without = await approvedDraft(none); await none.useCase.pay(payer(), without.id, command(1));
    assert.equal(none.state.vouchers[0].paidSnapshotJson.paymentEvidence, null);
  });

  it('masks PDF permission-guard refusals as the same missing document while retaining LINE refusal', () => {
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, DisbursementVoucherController.prototype.documentPdf), ['expense.disbursement.read']);
    let status = 0, payload: any;
    const response = { status: (s: number) => { status = s; return response; }, json: (p: any) => { payload = p; } };
    const host = { switchToHttp: () => ({ getResponse: () => response }) } as any;
    new DisbursementVoucherPdfReadFilter().catch(new ForbiddenException('Insufficient permissions.'), host);
    assert.equal(status, 404); assert.equal(payload.code, 'disbursement_not_found');
    new DisbursementVoucherPdfReadFilter().catch(new ForbiddenException({ code: 'disbursement_line_session_denied', message: 'เข้าผ่านไลน์ไม่ได้' }), host);
    assert.equal(status, 403); assert.equal(payload.code, 'disbursement_line_session_denied');
  });

  it('retains each revision requested approver and returns null after that company member is removed', async () => {
    const h = harness(), draft = await h.useCase.create(context(), body());
    await h.useCase.submit(context(), draft.id, { ...command(0), requestedApproverUserId: 'someone' });
    await h.useCase.withdraw(context(), draft.id, command(1));
    await h.useCase.submit(context(), draft.id, { ...command(2), commandId: 'second-submit', requestedApproverUserId: 'actor-1' });
    const detail = await h.useCase.get(context(), draft.id);
    assert.deepEqual(detail.revisions.map((r: any) => r.requestedApproverName), ['สมชาย', 'สมใจ']);
    h.state.members = h.state.members.filter((m: any) => m.userId !== 'someone');
    assert.equal((await h.useCase.get(context(), draft.id)).revisions[0]!.requestedApproverName, null);
  });

  it('commits payment before file storage, answers success on storage failure and recovers from the frozen snapshot', async () => {
    const h = harness(), draft = await h.useCase.create(context(), body());
    await h.useCase.submit(context({ permissions: ['expense.disbursement.prepare', 'expense.disbursement.approve', 'expense.read'] }), draft.id, { ...command(0), approveNow: true });
    let fail = true, calls = 0;
    (h.useCase as any).files = { withSignatures: async (_company: string, snapshot: any) => snapshot, ensure: async (_company: string, id: string) => {
      calls++; const v = h.state.vouchers.find((v: any) => v.id === id);
      assert.ok(v.status === 'PAID' || v.status === 'CANCELLED' && v.cancelledAfterPaid); assert.equal(h.state.commands.at(-1).voucherId, id);
      if (fail) throw new Error('storage failed');
      v.pdfAttachmentId = 'stored-pdf'; return { data: Buffer.from('%PDF frozen'), fileName: `${v.documentNumber}.pdf` };
    } };
    const paid = await h.useCase.pay(payer(), draft.id, command(1));
    assert.equal(paid.status, 'PAID'); assert.equal(paid.documentFileReady, false);
    await assert.rejects(() => (h.useCase as any).documentPdf(context(), draft.id), refusal('disbursement_file_unavailable', 'ยังจัดทำไฟล์ใบสำคัญจ่ายไม่สำเร็จ การจ่ายและเลขใบยังอยู่ ลองดาวน์โหลดอีกครั้ง'));
    const frozen = JSON.stringify(h.state.vouchers[0].paidSnapshotJson);
    fail = false; h.state.expenses[0].vendorNameSnapshot = 'ชื่อใหม่';
    const pdf = await (h.useCase as any).documentPdf(context(), draft.id);
    assert.equal(pdf.data.toString(), '%PDF frozen'); assert.equal(calls, 3);
    assert.equal(JSON.stringify(h.state.vouchers[0].paidSnapshotJson), frozen);
    Object.assign(h.state.vouchers[0], { status: 'CANCELLED', cancelledAfterPaid: true });
    assert.equal((await h.useCase.documentPdf(context(), draft.id)).data.subarray(0, 4).toString(), '%PDF');
    assert.equal(calls, 3, 'cancelled download bypasses the original file');
    assert.equal((await h.useCase.pay(payer(), draft.id, command(1))).status, 'CANCELLED');
  });

  it('creates an unnumbered unreserved draft from current snapshots, with exact amounts and first-line defaults', async () => {
    const h = harness();
    const result = await h.useCase.create(context(), body({ lines: [{ expenseId: 'a', amount: '10.10' }, { expenseId: 'b', amount: '0.20' }], plannedPayDate: '2026-11-01', plannedMethod: 'BANK_TRANSFER', note: 'จ่ายเดือนหน้า' }));
    assert.equal(result.totalAmount, '10.3000'); assert.equal(result.documentNumber, null); assert.equal(result.status, 'DRAFT'); assert.equal(result.version, 0);
    assert.equal(result.payeeName, 'ร้าน ก'); assert.equal(result.payeeTaxId, '0-1234-56789-01-2'); assert.equal(result.payeeBranchCode, '00001'); assert.equal(result.payeeBasis, 'TAX_ID');
    assert.equal(result.plannedPayDate, '2026-11-01'); assert.equal(h.state.lines.length, 2);
    assert.ok(h.state.expenses.every((e: any) => e.reservedByDisbursementVoucherId === null)); assert.equal(h.state.audits.length, 1);
  });

  it('uses SINGLE, normalized TAX_ID and explicit PREPARER_CONFIRMED without trusting names or counterparty links', async () => {
    const h = harness([source('a'), source('b', { vendorNameSnapshot: 'ร้าน ข', vendorTaxIdSnapshot: '๐๑๒๓๔๕๖๗๘๙๐๑๒', vendorCounterpartyId: 'stale' })]);
    assert.equal((await h.useCase.create(context(), body())).payeeBasis, 'SINGLE');
    const multi = body({ commandId: 'multi', lines: [{ expenseId: 'a', amount: '1' }, { expenseId: 'b', amount: '1' }] });
    assert.equal((await h.useCase.create(context(), multi)).payeeBasis, 'TAX_ID');
    h.state.expenses[1].vendorTaxIdSnapshot = null;
    await assert.rejects(() => h.useCase.create(context(), { ...multi, commandId: 'mismatch' }), refusal('disbursement_payee_confirmation_required', 'รายการที่เลือกมีชื่อหรือเลขผู้เสียภาษีของผู้ขายไม่ตรงกัน ถ้าเป็นผู้รับเงินรายเดียวกัน ให้ติ๊กยืนยันก่อน'));
    const confirmed = await h.useCase.create(context(), { ...multi, commandId: 'confirmed', payeeConfirmed: true, payeeName: 'ผู้รับเงิน' });
    assert.equal(confirmed.payeeBasis, 'PREPARER_CONFIRMED'); assert.equal(confirmed.payeeConfirmedByUserId, ctx.userId);
  });

  it('uses all four payee bases in order and requires a tick for mixed tax ids or empty/different names', async () => {
    const cases = [
      { vendors: [[null, '']], basis: 'SINGLE' },
      { vendors: [['0123456789012', 'ร้าน ก']], basis: 'SINGLE' },
      { vendors: [['0-1234-56789-01-2', 'ร้าน ก'], ['๐๑๒๓๔๕๖๗๘๙๐๑๒', 'ร้าน ข']], basis: 'TAX_ID' },
      { vendors: [['0123456789012', 'ร้านป้าแดง'], ['0123456789012', 'ร้านป้าแดง']], basis: 'TAX_ID' },
      { vendors: [[null, 'ร้าน ป้าแดง'], ['', 'ร้านป้าแดง.'], ['  ', 'ร้านป้าแดง']], basis: 'SAME_NAME' },
      { vendors: [[null, 'Market Stall'], [null, 'market-stall.']], basis: 'SAME_NAME' },
      { vendors: [[null, 'ร้านป้าแดง'], ['0123456789012', 'ร้านป้าแดง']], basis: 'PREPARER_CONFIRMED' },
      { vendors: [['0123456789012', 'ร้านป้าแดง'], [null, 'ร้านป้าแดง']], basis: 'PREPARER_CONFIRMED' },
      { vendors: [['0123456789012', 'ร้านป้าแดง'], ['0123456789013', 'ร้านป้าแดง']], basis: 'PREPARER_CONFIRMED' },
      { vendors: [['123', 'ร้านป้าแดง'], ['123', 'ร้านป้าแดง']], basis: 'PREPARER_CONFIRMED' },
      { vendors: [[null, 'ร้านป้าแดง'], [null, 'ร้านป้าขาว']], basis: 'PREPARER_CONFIRMED' },
      { vendors: [[null, 'ร้านป้าแดง'], [null, '']], basis: 'PREPARER_CONFIRMED' },
      { vendors: [[null, '. '], [null, '']], basis: 'PREPARER_CONFIRMED' },
    ];
    for (const { vendors, basis } of cases) {
      const rows = vendors.map(([vendorTaxIdSnapshot, vendorNameSnapshot], i) => source(String(i), { vendorTaxIdSnapshot, vendorNameSnapshot }));
      const h = harness(rows), input = body({ lines: rows.map(e => ({ expenseId: e.id, amount: '1' })) });
      if (basis === 'PREPARER_CONFIRMED') {
        await assert.rejects(() => h.useCase.create(context(), input), refusal('disbursement_payee_confirmation_required',
          'รายการที่เลือกมีชื่อหรือเลขผู้เสียภาษีของผู้ขายไม่ตรงกัน ถ้าเป็นผู้รับเงินรายเดียวกัน ให้ติ๊กยืนยันก่อน'));
      } else {
        const automatic = await h.useCase.create(context(), input);
        assert.equal(automatic.payeeBasis, basis); assert.equal(automatic.payeeConfirmedByUserId, null);
      }
      const confirmed = await h.useCase.create(context(), { ...input, commandId: 'ticked', payeeConfirmed: true });
      assert.equal(confirmed.payeeBasis, basis);
      assert.equal(confirmed.payeeConfirmedByUserId, basis === 'PREPARER_CONFIRMED' ? ctx.userId : null);
    }
  });

  it('requires confirmation when an edit adds a different name and clears the confirmer when names match again', async () => {
    const h = harness([source('a', { vendorTaxIdSnapshot: null, vendorNameSnapshot: 'ร้าน ป้าแดง' }),
      source('b', { vendorTaxIdSnapshot: null, vendorNameSnapshot: 'ร้านป้าแดง.' }),
      source('c', { vendorTaxIdSnapshot: null, vendorNameSnapshot: 'ร้านป้าขาว' })]);
    const input = body({ lines: [{ expenseId: 'a', amount: '1' }, { expenseId: 'b', amount: '1' }] });
    const draft = await h.useCase.create(context(), input); assert.equal(draft.payeeBasis, 'SAME_NAME');
    const changed = { ...input, commandId: 'edit', expectedVersion: 0, lines: [...input.lines, { expenseId: 'c', amount: '1' }] };
    await assert.rejects(() => h.useCase.update(context(), draft.id, changed), refusal('disbursement_payee_confirmation_required',
      'รายการที่เลือกมีชื่อหรือเลขผู้เสียภาษีของผู้ขายไม่ตรงกัน ถ้าเป็นผู้รับเงินรายเดียวกัน ให้ติ๊กยืนยันก่อน'));
    assert.equal(h.state.vouchers[0].version, 0); assert.equal(h.state.lines.length, 2);
    const confirmed = await h.useCase.update(context(), draft.id, { ...changed, payeeConfirmed: true });
    assert.equal(confirmed.payeeBasis, 'PREPARER_CONFIRMED');
    const detail = await h.useCase.get(context(), draft.id); assert.equal(detail.payeeConfirmerName, 'สมใจ');
    const matched = await h.useCase.update(context(), draft.id, { ...input, commandId: 'matched', expectedVersion: 1 });
    assert.equal(matched.payeeBasis, 'SAME_NAME'); assert.equal(matched.payeeConfirmedByUserId, null);
    assert.equal((await h.useCase.get(context(), draft.id)).payeeConfirmerName, null);
  });

  it('detail returns the basis and confirmer display name only for preparer-confirmed documents', async () => {
    const h = harness([source('a'), source('b', { vendorTaxIdSnapshot: null })]);
    const draft = await h.useCase.create(context(), body({ payeeConfirmed: true, lines: [{ expenseId: 'a', amount: '1' }, { expenseId: 'b', amount: '1' }] }));
    const detail = await h.useCase.get(context(), draft.id);
    assert.equal(detail.header.payeeBasis, 'PREPARER_CONFIRMED'); assert.equal(detail.payeeConfirmerName, 'สมใจ');
    h.state.vouchers[0].payeeConfirmedByUserId = 'deleted-user';
    assert.equal((await h.useCase.get(context(), draft.id)).payeeConfirmerName, null);
    h.state.vouchers[0].payeeBasis = 'TAX_ID'; h.state.vouchers[0].payeeConfirmedByUserId = ctx.userId;
    h.client.user.findFirst = async () => { throw new Error('automatic basis must not look up a confirmer'); };
    assert.equal((await h.useCase.get(context(), draft.id)).payeeConfirmerName, null);
    await assert.rejects(() => h.useCase.get(context({ companyId: 'other' }), draft.id), (e: any) => e.getStatus?.() === 404);
  });

  it('never-paid source-drafts permissions still refuse 30-line substitute and voucher financial workflows', async () => {
    const { freeExpenseDraftPermissions, isFreeExpenseDraftRoute } = await import('../../../system-partner-management/application/free-expense-access');
    const permissions = freeExpenseDraftPermissions(['expense.read', 'expense.update', 'expense.receipt.upload', 'expense.review', 'expense.confirm', 'expense.disbursement.prepare']);
    assert.deepEqual(permissions, ['expense.read', 'expense.update', 'expense.receipt.upload']);
    assert.equal(isFreeExpenseDraftRoute('PATCH', '/v1/companies/company-1/expenses/expense-1'), true);
    assert.equal(isFreeExpenseDraftRoute('POST', '/v1/companies/company-1/disbursement-vouchers'), false);
    assert.equal(isFreeExpenseDraftRoute('POST', '/v1/companies/company-1/expenses/expense-1/substitute-receipts'), false);
    const h = harness(Array.from({ length: 30 }, (_, i) => source(`expense-${i + 1}`)));
    await assert.rejects(() => h.useCase.create(context({ permissions }), body({ lines: h.state.expenses.map((row: any) => ({ expenseId: row.id, amount: '1' })) })),
      (error: any) => error.getResponse().code === 'disbursement_permission_denied');
    assert.equal(h.state.vouchers.length, 0);
  });

  it('accepts 30 paid-shop voucher lines through create, update, submission and payment', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => source(`expense-${i + 1}`));
    const h = harness(rows), lines = rows.map(row => ({ expenseId: row.id, amount: '1' }));
    const draft = await h.useCase.create(context(), body({ lines }));
    assert.equal(h.state.lines.length, 30);
    assert.equal(draft.totalAmount, '30.0000');
    await h.useCase.update(context(), draft.id, body({ commandId: 'update-30', expectedVersion: 0, lines }));
    assert.equal(h.state.lines.length, 30);
    assert.ok(h.state.expenses.every((row: any) => row.reservedByDisbursementVoucherId === null));
    await assert.rejects(() => h.useCase.update(context(), draft.id, body({ commandId: 'update-31', expectedVersion: 1,
      lines: [...lines, { expenseId: 'expense-31', amount: '1' }] })), refusal('disbursement_too_many_lines',
      'ใบเตรียมจ่ายหนึ่งใบรวมได้ไม่เกิน 30 รายการ แบ่งรายการที่เหลือไปทำอีกใบ'));
    assert.equal(h.state.lines.length, 30);
    await h.useCase.submit(context({ permissions: ['expense.disbursement.prepare', 'expense.disbursement.approve', 'expense.read'] }), draft.id, { ...command(1), approveNow: true });
    assert.ok(h.state.expenses.every((row: any) => row.reservedByDisbursementVoucherId === draft.id));
    assert.equal((await h.useCase.pay(payer(), draft.id, command(2))).status, 'PAID');
    assert.equal(h.state.payments.length, 30);
  });

  it('refuses empty, oversized, repeated and cross-branch selections with their own Thai sentences', async () => {
    const h = harness([source('a'), source('b', { branchId: 'branch-2' })]);
    const full = context({ scopes: {} });
    await assert.rejects(() => h.useCase.create(full, body({ lines: [] })), refusal('disbursement_lines_required', 'ยังไม่ได้เลือกรายจ่าย ให้เลือกอย่างน้อย 1 รายการก่อนบันทึก'));
    await assert.rejects(() => h.useCase.create(full, body({ lines: Array.from({ length: 31 }, () => ({ expenseId: 'a', amount: '1' })) })), refusal('disbursement_too_many_lines', 'ใบเตรียมจ่ายหนึ่งใบรวมได้ไม่เกิน 30 รายการ แบ่งรายการที่เหลือไปทำอีกใบ'));
    await assert.rejects(() => h.useCase.create(full, body({ lines: [{ expenseId: 'a', amount: '1' }, { expenseId: 'a', amount: '1' }] })), refusal('disbursement_duplicate_expense', 'เลือกรายจ่ายรายการเดิมซ้ำในใบเดียวกันไม่ได้ ให้เอารายการที่ซ้ำออกก่อน'));
    await assert.rejects(() => h.useCase.create(full, body({ lines: [{ expenseId: 'a', amount: '1' }, { expenseId: 'b', amount: '1' }] })), refusal('disbursement_branch_mismatch', 'รายการที่เลือกอยู่คนละสาขา หนึ่งใบรวมได้เฉพาะรายการของสาขาเดียว ให้เลือกรายการจากสาขาเดียวกัน'));
    assert.equal(h.state.vouchers.length, 0);
  });

  it('prepares and pays the rounded legacy balance accepted by direct payment', async () => {
    const h = harness([source('a', { netPayableAmount: '2209780.6682', outstandingAmount: '2209780.6682', grandTotalAmount: '2209780.6682' })]);
    const draft = await h.useCase.create(context(), body({ lines: [{ expenseId: 'a', amount: '2209780.67' }] }));
    await h.useCase.submit(context({ permissions: ['expense.disbursement.prepare', 'expense.disbursement.approve', 'expense.read'] }), draft.id, { ...command(0), approveNow: true });
    assert.equal((await h.useCase.pay(payer(), draft.id, command(1))).status, 'PAID');
    assert.equal(h.state.payments[0].amount, '2209780.6700');
  });

  it('voucher amount guards agree with satang settlement for 3000 seeded legacy balances', async () => {
    let seed = 614;
    for (let i = 0; i < 3000; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const units = BigInt(seed + 10000), cents = (units + 50n) / 100n;
      const outstanding = `${units / 10000n}.${String(units % 10000n).padStart(4, '0')}`;
      const amount = `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
      const h = harness([source('a', { netPayableAmount: outstanding, outstandingAmount: outstanding })]);
      const prepared = await (h.useCase as any).prepare(context(), body({ lines: [{ expenseId: 'a', amount }] }), { companyId: ctx.companyId }, h.client, h.state.expenses);
      assert.equal(Number(prepared.totalAmount), Number(amount));
      const tooMuch = `${(cents + 1n) / 100n}.${String((cents + 1n) % 100n).padStart(2, '0')}`;
      await assert.rejects(() => (h.useCase as any).prepare(context(), body({ lines: [{ expenseId: 'a', amount: tooMuch }] }), { companyId: ctx.companyId }, h.client, h.state.expenses), (e: any) => e.getResponse().code === 'disbursement_amount_invalid');
    }
  });

  it('refuses zero, negative, excessive, fractional, malformed and overflow amounts with the expense and outstanding', async () => {
    for (const amount of ['0', '-1', '104.01', '1.001', 'NaN', '1e2', '100000000000000', 10]) {
      const h = harness();
      await assert.rejects(() => h.useCase.create(context(), body({ lines: [{ expenseId: 'a', amount }] })), refusal('disbursement_amount_invalid', 'ยอดของรายการ EXP-a ต้องมากกว่า 0 และไม่เกินยอดค้างจ่าย 104.0000 แก้ยอดแล้วบันทึกอีกครั้ง'));
      assert.equal(h.state.vouchers.length, 0);
    }
  });

  it('refuses each shared selection blocker, naming the expense and retaining the B3 sentence', async () => {
    const cases: any[] = [
      [{ reservedByDisbursementVoucherId: 'another' }, 'reserved', 'อยู่ในใบเตรียมจ่ายอีกใบที่รออนุมัติ'],
      [{ sourceReimbursementRequestId: 'claim' }, 'claim', 'รายการนี้อยู่ในใบเบิก ให้จ่ายผ่านใบเบิก'],
      [{ substituteReceiptEvidences: [{ fundingSource: 'PERSONAL_ADVANCE' }] }, 'personal_advance', 'พนักงานจ่ายร้านไปแล้ว ให้คืนเงินพนักงานผ่านใบเบิก'],
      [{ branchId: null }, 'missing_branch', 'รายการนี้ยังไม่มีสาขา เปิดรายจ่ายเพื่อระบุสาขาก่อน'],
      [{ currency: 'USD' }, 'foreign_currency', 'รายการนี้ไม่ใช่เงินบาท ยังรวมในใบเตรียมจ่ายไม่ได้'],
      [{ status: 'DRAFT' }, 'not_confirmed', 'รายการนี้ยังไม่ยืนยัน เปิดรายจ่ายและยืนยันก่อน'],
      [{ outstandingAmount: '0' }, 'no_balance', 'รายการนี้ไม่มียอดค้างจ่าย ให้เลือกรายการอื่น'],
    ];
    for (const [patch, code, message] of cases) {
      const h = harness([source('a', patch)]);
      await assert.rejects(() => h.useCase.create(context(), body()), refusal(`disbursement_expense_${code}`, `รายการ EXP-a: ${message}`));
    }
  });

  it('refuses unreadable, cross-company and out-of-branch source expenses without revealing their facts', async () => {
    for (const patch of [{ companyId: 'another' }, { createdByUserId: 'someone' }, { branchId: 'another' }]) {
      const h = harness([source('a', patch)]);
      await assert.rejects(() => h.useCase.create(context({ permissions: ['expense.disbursement.prepare', 'expense.read_own'] }), body()), refusal('disbursement_expense_unreadable', 'ไม่พบรายจ่ายที่เลือกหรือคุณไม่มีสิทธิ์อ่าน ให้เลือกรายจ่ายที่เปิดดูได้แล้วลองอีกครั้ง'));
    }
  });

  it('replays create and edit command ids, conflicts on changed bodies, and rejects stale versions', async () => {
    const h = harness(); const first = await h.useCase.create(context(), body());
    h.state.expenses[0].outstandingAmount = '0';
    assert.deepEqual(await h.useCase.create(context(), body()), first); assert.equal(h.state.vouchers.length, 1); assert.equal(h.state.audits.length, 1);
    await assert.rejects(() => h.useCase.create(context(), body({ note: 'เปลี่ยน' })), refusal('disbursement_command_conflict', 'ข้อมูลไม่ตรงกับคำสั่งที่บันทึกไว้ ให้เปิดใบตรวจข้อมูล แล้วใช้คำสั่งใหม่ถ้าต้องการแก้ไข'));
    h.state.expenses[0].outstandingAmount = '104';
    const update = body({ commandId: 'edit', expectedVersion: 0, note: 'แก้แล้ว' });
    const changed = await h.useCase.update(context(), first.id, update); assert.equal(changed.version, 1);
    assert.deepEqual(await h.useCase.update(context(), first.id, update), changed);
    await assert.rejects(() => h.useCase.update(context(), first.id, { ...update, commandId: 'stale' }), refusal('disbursement_version_conflict', 'ใบนี้ถูกแก้ไขจากที่อื่นแล้ว เปิดหน้านี้ใหม่ก่อนบันทึก'));
  });

  it('rechecks original source visibility before replaying or reporting a command conflict', async () => {
    const h = harness(); await h.useCase.create(context(), body());
    const own = context({ userId: 'someone', permissions: ['expense.disbursement.prepare', 'expense.read_own'] });
    for (const input of [body(), body({ note: 'different' })]) {
      await assert.rejects(() => h.useCase.create(own, input), refusal('disbursement_not_found', 'ไม่พบใบเตรียมจ่ายที่เปิดดูได้ ให้กลับไปหน้ารายการแล้วเลือกใบใหม่'));
    }
  });

  it('registers draft and document routes with their permissions and delegates the parsed list query', async () => {
    for (const [method, path, verb, permission] of [
      ['create', '/', RequestMethod.POST, 'prepare'], ['update', ':id', RequestMethod.PUT, 'prepare'],
      ['delete', ':id', RequestMethod.DELETE, 'prepare'], ['list', '/', RequestMethod.GET, 'read'], ['get', ':id', RequestMethod.GET, 'read'],
    ] as const) {
      const handler = DisbursementVoucherController.prototype[method];
      assert.equal(Reflect.getMetadata(PATH_METADATA, handler), path);
      assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), verb);
      assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler), [`expense.disbursement.${permission}`]);
    }
    const controller = new DisbursementVoucherController({} as any, { list: async (actual: any, query: any) => { assert.equal(actual, ctx); return query; } } as any);
    assert.deepEqual(await controller.list(ctx, { status: 'DRAFT', branchId: 'branch-1', page: '2', pageSize: '5' }),
      { status: 'DRAFT', branchId: 'branch-1', page: 2, pageSize: 5, order: 'newest' });
  });

  it('refuses deletion of a draft with a prior revision even without a number', async () => {
    const h = harness(); const draft = await h.useCase.create(context(), body());
    h.state.vouchers[0].revision = 1;
    assert.equal((await h.useCase.get(context(), draft.id)).actions.delete, false);
    await assert.rejects(() => h.useCase.delete(context(), draft.id), (e: any) => e.getResponse?.().code === 'disbursement_status_changed');
    assert.equal(h.state.vouchers.length, 1);
  });

  it('deletes a never-sent draft and releases only its own expenses atomically', async () => {
    const h = harness([source('a'), source('b')]); const draft = await h.useCase.create(context(), body());
    h.state.expenses[0].reservedByDisbursementVoucherId = draft.id;
    h.state.expenses[1].reservedByDisbursementVoucherId = 'another';
    await h.useCase.delete(context(), draft.id);
    assert.equal(h.state.vouchers.length, 0);
    assert.equal(h.state.expenses[0].reservedByDisbursementVoucherId, null);
    assert.equal(h.state.expenses[1].reservedByDisbursementVoucherId, 'another');
  });

  it('rolls draft deletion and expense release back when its audit fails', async () => {
    const h = harness(); const draft = await h.useCase.create(context(), body());
    h.state.expenses[0].reservedByDisbursementVoucherId = draft.id;
    h.audit.log = async () => { throw new Error('audit failed'); };
    await assert.rejects(() => h.useCase.delete(context(), draft.id), /audit failed/);
    assert.equal(h.state.vouchers.length, 1);
    assert.equal(h.state.lines.length, 1);
    assert.equal(h.state.expenses[0].reservedByDisbursementVoucherId, draft.id);
  });

  it('lets another preparer in scope edit/delete, preserves the author, and refuses numbered or non-draft deletion', async () => {
    const h = harness(); const draft = await h.useCase.create(context(), body());
    const other = context({ userId: 'someone' });
    assert.equal((await h.useCase.update(other, draft.id, body({ commandId: 'other-edit', expectedVersion: 0 }))).preparedByUserId, ctx.userId);
    h.state.vouchers[0].documentNumber = 'PV-1';
    await assert.rejects(() => h.useCase.delete(other, draft.id), refusal('disbursement_numbered_delete', 'ใบที่มีเลขแล้วลบไม่ได้ ให้ใช้ยกเลิกแทน'));
    h.state.vouchers[0].documentNumber = null; h.state.vouchers[0].status = 'PENDING_APPROVAL';
    await assert.rejects(() => h.useCase.update(other, draft.id, body({ commandId: 'not-draft', expectedVersion: 1 })), (e: any) => e.getResponse?.().code === 'disbursement_status_changed');
    await assert.rejects(() => h.useCase.delete(other, draft.id), (e: any) => e.getResponse?.().code === 'disbursement_status_changed');
    h.state.vouchers[0].status = 'DRAFT'; await h.useCase.delete(other, draft.id);
    assert.equal(h.state.vouchers.length, 0); assert.equal(h.state.lines.length, 0);
    assert.equal((await h.useCase.create(context(), body())).id, draft.id); assert.equal(h.state.vouchers.length, 0, 'a deleted draft command must not create a replacement');
  });

  it('returns vendor invoice numbers only through the scoped voucher detail read', async () => {
    const h = harness([source('a', { vendorDocumentNumber: 'INV-W7' }), source('b', { vendorDocumentNumber: null })]);
    const draft = await h.useCase.create(context(), body({ lines: [{ expenseId: 'a', amount: '1' }, { expenseId: 'b', amount: '1' }] }));
    let selected = false;
    const findFirst = h.client.disbursementVoucher.findFirst;
    h.client.disbursementVoucher.findFirst = async (query: any) => {
      selected = query.include?.lines?.include?.expense?.select?.vendorDocumentNumber === true;
      return findFirst(query);
    };
    const detail = await h.useCase.get(context(), draft.id);
    assert.deepEqual(detail.lines.map((line: any) => line.vendorInvoiceNumber), ['INV-W7', null]);
    assert.equal(selected, true, 'the database projection includes the vendor document number');
    await assert.rejects(() => h.useCase.get(context({ companyId: 'other-company' }), draft.id), (e: any) => e.getStatus?.() === 404);
    h.state.expenses[1].branchId = 'branch-2';
    await assert.rejects(() => h.useCase.get(context(), draft.id), (e: any) => e.getStatus?.() === 404);
    h.state.expenses[1].branchId = 'branch-1'; h.state.expenses[1].createdByUserId = 'someone';
    await assert.rejects(() => h.useCase.get(context({ permissions: ['expense.disbursement.read', 'expense.read_own'] }), draft.id), (e: any) => e.getStatus?.() === 404);
  });

  it('freezes picker descriptions at submit, carries them through payment and leaves old snapshot lines null', async () => {
    const h = harness([source('a', { lines: [{ description: '  ค่าพิมพ์นามบัตร  ' }] })]);
    const draft = await h.useCase.create(context(), body());
    await h.useCase.submit(context(), draft.id, command(0));
    assert.equal(h.state.revisions[0].snapshotJson.lines[0].description, 'ค่าพิมพ์นามบัตร');
    h.state.expenses[0].lines[0].description = 'ค่าซื้อของที่แก้ภายหลัง';
    assert.equal((await h.useCase.get(context(), draft.id)).lines[0].description, 'ค่าพิมพ์นามบัตร');
    await h.useCase.approve(approvalContext(), draft.id, command(1));
    await h.useCase.pay(payer(), draft.id, command(2));
    assert.equal(h.state.vouchers[0].paidSnapshotJson.lines[0].description, 'ค่าพิมพ์นามบัตร');
    assert.equal((await h.useCase.get(payer(), draft.id)).lines[0].description, 'ค่าพิมพ์นามบัตร');
    delete h.state.vouchers[0].paidSnapshotJson.lines[0].description;
    assert.equal((await h.useCase.get(payer(), draft.id)).lines[0].description, null);
  });
  it('VOUCH-LIST2 orders all statuses by paid, planned or created day with stable ties and server paging in both directions', async () => {
    const h = harness();
    const dates = [
      { status: 'PAID', paidDate: new Date('2026-10-12'), plannedPayDate: new Date('2026-12-01') },
      { status: 'APPROVED', plannedPayDate: new Date('2026-10-14') },
      { status: 'DRAFT', plannedPayDate: null },
      { status: 'PENDING_APPROVAL', plannedPayDate: new Date('2026-10-14') },
      { status: 'CANCELLED', plannedPayDate: new Date('2026-10-14') },
    ];
    for (let i = 0; i < dates.length; i++) {
      await h.useCase.create(context(), body({ commandId: `sort-${i}` }));
      Object.assign(h.state.vouchers[i], { createdAt: new Date(i === 4 ? '2026-10-11T02:00:00Z' : '2026-10-11T01:00:00Z'), ...dates[i] });
    }
    const expected = [4, 3, 1, 0, 2].map(i => h.state.vouchers[i].id);
    for (const order of [undefined, 'newest', 'oldest'] as const) {
      const pages = await Promise.all([1, 2, 3].map(page => h.useCase.list(context(), { page, pageSize: 2, order })));
      assert.deepEqual(pages.flatMap(page => page.data.map(v => v.id)), order === 'oldest' ? [...expected].reverse() : expected);
      assert.deepEqual(pages[0].counts, pages[2].counts); assert.deepEqual(pages[0].sums, pages[2].sums); assert.equal(pages[0].total, 5);
    }
    await assert.rejects(h.useCase.list(context(), { order: 'DESC' } as any), BadRequestException);
    assert.deepEqual((await h.useCase.list(context(), { status: 'DRAFT', order: 'oldest' })).data.map(v => v.id), [expected[4]]);
  });

  it('returns effective cancelled payment amounts with one scoped aggregate for the visible list page', async () => {
    const h = harness([source('a', { outstandingAmount: '2910', netPayableAmount: '2910' }), source('b', { outstandingAmount: '19400', netPayableAmount: '19400' })]);
    const docs: { id: string }[] = [];
    for (const commandId of ['cancelled', 'same', 'zero', 'paid']) docs.push(await h.useCase.create(context(), body({ commandId, lines: [{ expenseId: 'a', amount: '2910' }, { expenseId: 'b', amount: '19400' }] })));
    h.state.vouchers.forEach((v: any, i: number) => Object.assign(v, { status: i === 3 ? 'PAID' : 'CANCELLED', cancelledAfterPaid: i !== 3 }));
    let queries = 0;
    const queryRaw = h.client.$queryRaw;
    h.client.$queryRaw = async (parts: any, ...values: any[]) => {
      if (parts.sql) return queryRaw(parts, ...values);
      queries++; const sql = parts.join('?');
      assert.match(sql, /SUM\(l\."amount"\)/); assert.match(sql, /p\."status" = 'RECORDED'/);
      assert.match(sql, /p\."companyId" = l\."companyId"/); assert.match(sql, /p\."expenseId" = l\."expenseId"/);
      assert.equal(values[0], 'company-1');
      return values[1].values.map((voucherId: string) => ({ voucherId, amount: voucherId === docs[0].id ? '19400.0000' : voucherId === docs[1].id ? '22310.0000' : '0.0000' }));
    };
    const first = await h.useCase.list(context(), { pageSize: 2 });
    assert.deepEqual(first.data.map((r: any) => r.amountInEffect), [null, '0.0000']); assert.equal(queries, 1);
    const second = await h.useCase.list(context(), { pageSize: 2, page: 2 });
    assert.deepEqual(second.data.map((r: any) => r.amountInEffect), [null, '19400.0000']); assert.equal(queries, 2);
    assert.equal(first.total, 4); assert.deepEqual(first.counts, second.counts);
    assert.equal((await h.useCase.list(context({ companyId: 'other' }), {})).total, 0); assert.equal(queries, 2);
  });

  it('reads current draft descriptions and freezes them again at each submission', async () => {
    const h = harness([source('a', { lines: [{ description: '  ค่าพิมพ์นามบัตร  ' }] })]);
    const draft = await h.useCase.create(context(), body());
    assert.equal((await h.useCase.get(context(), draft.id)).lines[0].description, 'ค่าพิมพ์นามบัตร');
    h.state.expenses[0].lines[0].description = 'ค่าพิมพ์ใบปลิว';
    assert.equal((await h.useCase.get(context(), draft.id)).lines[0].description, 'ค่าพิมพ์ใบปลิว');
    await h.useCase.submit(context(), draft.id, command(0));
    h.state.expenses[0].lines[0].description = 'แก้แล้วรอส่งใหม่';
    assert.equal((await h.useCase.get(context(), draft.id)).lines[0].description, 'ค่าพิมพ์ใบปลิว');
    await h.useCase.return(approvalContext(), draft.id, { ...command(1), reason: 'ตรวจใหม่' });
    assert.equal((await h.useCase.get(context(), draft.id)).lines[0].description, 'แก้แล้วรอส่งใหม่');
    await h.useCase.submit(context(), draft.id, command(2));
    assert.equal((await h.useCase.get(context(), draft.id)).lines[0].description, h.state.revisions[1].snapshotJson.lines[0].description);
  });

  it('VOUCH-LIST returns scoped status sums, header creation date and authoritative delete capability', async () => {
    const h = harness([source('a'), source('b', { branchId: 'branch-2' })]);
    const full = context({ scopes: {} });
    for (const [commandId, status, documentNumber, revision, amount] of [
      ['plain', 'DRAFT', null, 0, '10.10'], ['numbered', 'DRAFT', 'PV-1', 0, '20.20'],
      ['revised', 'DRAFT', null, 1, '30.30'], ['pending', 'PENDING_APPROVAL', 'PV-2', 1, '40.40'],
      ['approved', 'APPROVED', 'PV-3', 1, '50.50'],
    ] as const) {
      const draft = await h.useCase.create(full, body({ commandId, payeeName: 'ร้านหาเจอ', lines: [{ expenseId: 'a', amount }] }));
      Object.assign(h.state.vouchers.find((v: any) => v.id === draft.id), { status, documentNumber, revision, createdAt: new Date('2026-10-15T01:00:00Z') });
    }
    await h.useCase.create(full, body({ commandId: 'elsewhere', payeeName: 'ร้านหาเจอ', lines: [{ expenseId: 'b', amount: '90.00' }] }));
    await h.useCase.create(full, body({ commandId: 'other-payee', payeeName: 'ร้านอื่น', lines: [{ expenseId: 'a', amount: '80.00' }] }));
    const page = await h.useCase.list(context(), { q: 'หาเจอ', pageSize: 2 });
    assert.deepEqual(page.sums, { DRAFT: '60.60', PENDING_APPROVAL: '40.40', APPROVED: '50.50', PAID: '0.00', CANCELLED: '0.00' });
    const all = await h.useCase.list(context(), { q: 'หาเจอ' });
    assert.deepEqual(all.data.map(row => [row.id, row.canDelete]).sort(), [['dv-1', true], ['dv-2', false], ['dv-3', false], ['dv-4', false], ['dv-5', false]]);
    assert.ok(all.data.every(row => row.createdAt === '2026-10-15T01:00:00.000Z'));
    const readOnly = await h.useCase.list(context({ permissions: ['expense.disbursement.read', 'expense.read'] }), { q: 'หาเจอ' });
    assert.ok(readOnly.data.every(row => row.canDelete === false));
    assert.deepEqual((await h.useCase.list(context(), { q: 'หาเจอ', status: 'APPROVED' })).sums, page.sums);
    assert.deepEqual((await h.useCase.list(context({ companyId: 'other' }), {})).sums, { DRAFT: '0.00', PENDING_APPROVAL: '0.00', APPROVED: '0.00', PAID: '0.00', CANCELLED: '0.00' });
  });

  it('searches every list page by trimmed Thai payee or case-insensitive number and shares q with status counts', async () => {
    const h = harness();
    const one = await h.useCase.create(context(), body({ commandId: 'q-one', payeeName: 'ร้าน ป้าแดง' }));
    const two = await h.useCase.create(context(), body({ commandId: 'q-two', payeeName: 'ร้าน ป้าแดง' }));
    await h.useCase.create(context(), body({ commandId: 'q-three', payeeName: 'ร้านอื่น' }));
    Object.assign(h.state.vouchers.find((v: any) => v.id === two.id), { status: 'PAID', documentNumber: 'PV-MATCH-1' });
    const query: any = { q: '  ป้าแดง  ', pageSize: 1, page: 2 };
    const page = await h.useCase.list(context(), query); assert.equal(page.total, 2); assert.equal(page.data.length, 1);
    assert.deepEqual(page.counts, { DRAFT: 1, PENDING_APPROVAL: 0, APPROVED: 0, PAID: 1, CANCELLED: 0 });
    const tab = await h.useCase.list(context(), { ...query, status: 'DRAFT', page: 1 });
    assert.equal(tab.total, 1); assert.equal(tab.data[0].id, one.id); assert.deepEqual(tab.counts, page.counts);
    assert.equal((await h.useCase.list(context(), { q: 'pv-match' } as any)).data[0].id, two.id);
    assert.equal((await h.useCase.list(context(), { q: '   ' } as any)).total, 3);
    assert.equal((await h.useCase.list(context({ companyId: 'other' }), query)).total, 0);
    await assert.rejects(h.useCase.list(context(), { q: 7 } as any), (e: any) => e.getStatus() === 400);
    let captured: any;
    const controller = new DisbursementVoucherController({} as any, { list: async (_ctx: any, q: any) => { captured = q; } } as any);
    await controller.list(context(), { q: 'ป้าแดง', page: '2' }); assert.equal(captured.q, 'ป้าแดง');
  });

  it('uses every source line for list/detail visibility and keeps counts consistent with the same company/branch/actor scope', async () => {
    const h = harness([source('a'), source('b', { createdByUserId: 'someone' }), source('c', { branchId: 'branch-2' })]);
    const full = context({ scopes: {} });
    const own = await h.useCase.create(full, body({ plannedPayDate: '2026-11-02' }));
    const mixed = await h.useCase.create(full, body({ commandId: 'mixed', lines: [{ expenseId: 'a', amount: '1' }, { expenseId: 'b', amount: '1' }], plannedPayDate: '2026-11-01' }));
    const branch = await h.useCase.create(full, body({ commandId: 'branch', lines: [{ expenseId: 'c', amount: '1' }], plannedPayDate: '2026-10-31' }));
    const all = await h.useCase.list(full, {}); assert.deepEqual(all.data.map((v: any) => v.id), [own.id, mixed.id, branch.id]); assert.equal(all.counts.DRAFT, 3); assert.equal(all.total, 3);
    const scoped = await h.useCase.list(context(), {}); assert.equal(scoped.total, 2); assert.equal(scoped.counts.DRAFT, 2);
    const ownContext = context({ permissions: ['expense.disbursement.read', 'expense.read_own'] });
    const ownList = await h.useCase.list(ownContext, {}); assert.deepEqual(ownList.data.map((v: any) => v.id), [own.id]); assert.equal(ownList.counts.DRAFT, 1);
    await assert.rejects(() => h.useCase.get(ownContext, mixed.id), (e: any) => e.getStatus?.() === 404);
    assert.deepEqual(await h.useCase.get(ownContext, mixed.id).catch((e: any) => e.getResponse()), await h.useCase.get(ownContext, 'missing').catch((e: any) => e.getResponse()));
    await assert.rejects(() => h.useCase.get(context(), branch.id), (e: any) => e.getStatus?.() === 404);
    const elsewhere = context({ companyId: 'other-company' }); assert.equal((await h.useCase.list(elsewhere, {})).total, 0);
    await assert.rejects(() => h.useCase.get(elsewhere, own.id), (e: any) => e.getStatus?.() === 404);
    const detail = await h.useCase.get(context(), own.id); assert.equal(detail.lines[0].whtAmount, '3.0000'); assert.equal(detail.lines[0].outstandingAmount, '104.0000'); assert.equal(detail.lines[0].amount, '10.1000'); assert.deepEqual(detail.revisions, []); assert.equal(detail.actions.edit, true);
    assert.equal((await h.useCase.list(full, { status: 'PAID' })).data.length, 0); assert.equal((await h.useCase.list(full, { status: 'PAID' })).counts.DRAFT, 3);
  });

  it('computes lifecycle actions by status and permission, enabling approved payment and pending reminders', () => {
    const permissions = ['expense.disbursement.prepare', 'expense.disbursement.approve', 'expense.disbursement.pay'];
    for (const [status, expected] of [['DRAFT', 'submit'], ['PENDING_APPROVAL', 'approve'], ['APPROVED', 'pay'], ['PAID', 'view'], ['CANCELLED', 'view']]) {
      assert.equal(disbursementVoucherPrimaryAction(status as any, permissions), expected);
      assert.equal(disbursementVoucherPrimaryAction(status as any, []), 'view');
      const actions = disbursementVoucherActions({ status, documentNumber: null } as any, permissions);
      assert.equal(actions.edit, status === 'DRAFT'); assert.equal(actions.delete, status === 'DRAFT'); assert.equal(actions.submit, status === 'DRAFT');
      assert.equal(actions.submitAndApprove, status === 'DRAFT'); assert.equal(actions.approve, status === 'PENDING_APPROVAL'); assert.equal(actions.return, status === 'PENDING_APPROVAL');
      assert.equal(actions.withdraw, status === 'PENDING_APPROVAL' || status === 'APPROVED'); assert.equal(actions.cancel, status === 'PENDING_APPROVAL' || status === 'APPROVED');
      assert.equal(actions.pay, status === 'APPROVED'); assert.equal(actions.remind, status === 'PENDING_APPROVAL');
    }
    assert.equal(disbursementVoucherActions({ status: 'DRAFT', documentNumber: 'PV-1' } as any, permissions).delete, false);
    assert.equal(disbursementVoucherActions({ status: 'DRAFT', documentNumber: 'PV-1' }, permissions).cancel, true);
    assert.equal(disbursementVoucherActions({ status: 'APPROVED', documentNumber: 'PV-1' }, ['expense.disbursement.approve']).withdraw, true);
    assert.equal(disbursementVoucherActions({ status: 'APPROVED', documentNumber: 'PV-1' }, ['expense.disbursement.prepare']).cancel, true);
    assert.equal(disbursementVoucherActions({ status: 'APPROVED', documentNumber: 'PV-1' }, ['expense.disbursement.pay']).pay, true);
    assert.equal(disbursementVoucherActions({ status: 'APPROVED', documentNumber: 'PV-1' }, ['expense.payment.record']).pay, false);
  });

  it('refuses LINE, missing command/read permission and inaccessible documents on every entry point', async () => {
    const h = harness(); const draft = await h.useCase.create(context(), body());
    for (const denied of [context({ authProvider: 'line' }), context({ permissions: ['expense.read'] })]) {
      for (const call of [() => h.useCase.create(denied, body()), () => h.useCase.update(denied, draft.id, body({ expectedVersion: 0 })), () => h.useCase.delete(denied, draft.id), () => h.useCase.list(denied, {}), () => h.useCase.get(denied, draft.id)]) await assert.rejects(call, ForbiddenException);
    }
    await assert.rejects(() => h.useCase.delete(context({ companyId: 'other' }), draft.id), (e: any) => e.getStatus?.() === 404);
  });

  it('rolls the draft, lines and command journal back when the audit fails', async () => {
    const h = harness(); h.useCase = new DisbursementVoucherUseCase(h.repo, new PrismaExpenseRepository({ client: h.client } as any), new ListExpensesUseCase({} as any), { log: async () => { throw new Error('audit failed'); } } as any);
    await assert.rejects(() => h.useCase.create(context(), body()), /audit failed/);
    assert.equal(h.state.vouchers.length, 0); assert.equal(h.state.commands.length, 0); assert.equal(h.state.lines.length, 0);
  });

  it('rejects malformed header fields and a total that exceeds the money column before writing', async () => {
    for (const patch of [{ commandId: '' }, { plannedPayDate: '2026-02-30' }, { plannedMethod: 'CRYPTO' }, { payeeConfirmed: 'true' }, { payeeName: {} }, { note: [] }, { companyId: 'forged' }]) {
      await assert.rejects(() => harness().useCase.create(context(), body(patch)), (e: any) => e.getResponse?.().code === 'disbursement_invalid_input');
    }
    const h = harness([source('a', { outstandingAmount: '99999999999999.9999' }), source('b', { outstandingAmount: '99999999999999.9999' })]);
    await assert.rejects(() => h.useCase.create(context(), body({ lines: [{ expenseId: 'a', amount: '99999999999999.99' }, { expenseId: 'b', amount: '1' }] })), (e: any) => e.getResponse?.().code === 'disbursement_total_overflow');
    assert.equal(h.state.vouchers.length, 0);
  });

  const approvalContext = (userId = 'someone') => context({ userId, permissions: ['expense.disbursement.approve', 'expense.disbursement.read', 'expense.read'] });
  const command = (expectedVersion: number, patch: any = {}) => ({ commandId: `command-${expectedVersion}`, expectedVersion, ...patch });

  it('keeps both inactive authors named and refuses return while leaving approval available', async () => {
    const h = harness(), draft = await h.useCase.create(context(), body());
    await h.useCase.submit(context({ userId: 'someone' }), draft.id, command(0));
    h.state.members.find((m: any) => m.userId === 'actor-1').status = 'DISABLED';
    h.state.members.find((m: any) => m.userId === 'someone').status = 'SUSPENDED';
    for (const roles of [['MANAGER'], ['OWNER']]) {
      const caller = approvalContext('another-owner'); caller.roles = roles;
      const detail = await h.useCase.get(caller, draft.id);
      assert.equal(detail.preparerName, 'สมใจ');
      assert.equal(detail.submittedByName, 'สมชาย');
      assert.equal(detail.preparerActive, false);
      assert.equal(detail.senderActive, false);
      assert.equal(detail.actions.return, false);
      assert.equal(detail.actions.approve, true);
      await assert.rejects(() => h.useCase.return(caller, draft.id, { ...command(1), reason: 'ตรวจใหม่' }),
        refusal('disbursement_permission_denied', 'ให้เจ้าของกิจการกลับไปแก้หรือยกเลิกใบนี้'));
    }
  });

  it('allows only an owner to recover a document when both preparer and sender are inactive', async () => {
    for (const state of ['PENDING_APPROVAL', 'APPROVED', 'RETURNED']) for (const authorActive of [true, false]) for (const role of ['OWNER', 'MANAGER']) for (const action of ['withdraw', 'cancel'] as const) {
      const h = harness(), draft = await h.useCase.create(context(), body());
      await h.useCase.submit(context(), draft.id, command(0));
      let version = 1;
      if (state === 'APPROVED') { await h.useCase.approve(approvalContext(), draft.id, command(1)); version++; }
      if (state === 'RETURNED') { await h.useCase.return(approvalContext(), draft.id, { ...command(1), reason: 'ตรวจใหม่' }); version++; }
      if (!authorActive) h.state.members.find((m: any) => m.userId === 'actor-1').status = 'DISABLED';
      const caller = context({ userId: 'someone', roles: [role], permissions: ['expense.read', 'expense.disbursement.read', 'expense.disbursement.prepare', 'expense.disbursement.approve'] });
      const allowed = role === 'OWNER' && !authorActive && (action === 'cancel' || state !== 'RETURNED');
      const detail = await h.useCase.get(caller, draft.id);
      assert.equal(detail.actions[action], allowed, `${state}/${authorActive}/${role}/${action}`);
      if (authorActive && state === 'PENDING_APPROVAL') { assert.equal(detail.actions.approve, true); assert.equal(detail.actions.return, true); }
      const input = { ...command(version), ...(action === 'cancel' ? { reason: 'ผู้เตรียมไม่ได้ใช้งานแล้ว' } : {}) };
      if (allowed) assert.equal((await h.useCase[action](caller, draft.id, input)).status, action === 'cancel' ? 'CANCELLED' : 'DRAFT');
      else await assert.rejects(() => h.useCase[action](caller, draft.id, input), (error: any) => {
        if (!authorActive) {
          assert.doesNotMatch(error.getResponse().message, /ให้คนนั้น/);
          if (role === 'MANAGER') assert.match(error.getResponse().message, /เจ้าของกิจการ/);
        }
        return error.getStatus() === 403 || error.getResponse().code === 'disbursement_status_changed';
      });
    }
  });

  it('keeps owner recovery unavailable while a different sender remains active and uses shop membership status', async () => {
    const h = harness(), draft = await h.useCase.create(context(), body());
    await h.useCase.submit(context({ userId: 'someone' }), draft.id, command(0));
    h.state.members.find((m: any) => m.userId === 'actor-1').status = 'SUSPENDED';
    const caller = context({ userId: 'another-owner', roles: ['OWNER'] });
    assert.equal((await h.useCase.get(caller, draft.id)).actions.cancel, false);
    await assert.rejects(() => h.useCase.cancel(caller, draft.id, { ...command(1), reason: 'ไม่ใช้ใบนี้' }), ForbiddenException);
    h.state.members.find((m: any) => m.userId === 'someone').status = 'SUSPENDED';
    assert.equal((await h.useCase.get(caller, draft.id)).actions.cancel, true);
    await h.useCase.cancel(caller, draft.id, { ...command(1), reason: 'ไม่ใช้ใบนี้' });
  });

  it('matches read actions and commands for approver, preparer and both on pending and approved documents', async () => {
    for (const status of ['PENDING_APPROVAL', 'APPROVED']) for (const person of ['approver', 'preparer', 'both']) for (const action of ['return', 'withdraw', 'cancel'] as const) {
      const h = harness(), draft = await h.useCase.create(context(), body());
      await h.useCase.submit(context(), draft.id, command(0));
      if (status === 'APPROVED') await h.useCase.approve(approvalContext(), draft.id, command(1));
      const caller = context({ userId: person === 'approver' ? 'someone' : 'actor-1', permissions: [
        'expense.read', 'expense.disbursement.read', ...(person !== 'approver' ? ['expense.disbursement.prepare'] : []),
        ...(person !== 'preparer' ? ['expense.disbursement.approve'] : []),
      ] });
      const allowed = action === 'return' ? person === 'approver' && status === 'PENDING_APPROVAL' : person !== 'approver';
      const detail = await h.useCase.get(caller, draft.id);
      assert.equal(detail.actions[action], allowed, `${status}/${person}/${action}`);
      const input = command(status === 'APPROVED' ? 2 : 1, action === 'withdraw' ? {} : { reason: 'ตรวจใหม่' });
      if (allowed) {
        const result = await h.useCase[action](caller, draft.id, input);
        assert.equal(result.status, action === 'cancel' ? 'CANCELLED' : 'DRAFT');
        if (action === 'return') assert.match(h.state.noticeInputs.at(-1).body, /เหตุผล: ตรวจใหม่/);
        if (action === 'withdraw') assert.equal(h.state.revisions[0][status === 'APPROVED' ? 'postApprovalReason' : 'decisionReason'], null);
      } else {
        await assert.rejects(() => h.useCase[action](caller, draft.id, input), (error: any) => {
          if (person === 'approver' && action === 'return') return error.getResponse().code === 'disbursement_status_changed';
          assert.equal(error.getStatus(), 403);
          assert.equal(error.getResponse().code, 'disbursement_permission_denied');
          assert.match(error.getResponse().message, action === 'return' ? /กลับไปแก้/ : /ผู้เตรียมหรือผู้ส่ง/);
          return true;
        });
        assert.equal(h.state.vouchers[0].status, status);
      }
    }
  });

  it('lets the sender withdraw and cancel another preparer’s document with either existing right', async () => {
    for (const status of ['PENDING_APPROVAL', 'APPROVED']) for (const action of ['withdraw', 'cancel'] as const) for (const right of ['prepare', 'approve']) {
      const h = harness(), draft = await h.useCase.create(context(), body());
      await h.useCase.submit(context({ userId: 'someone' }), draft.id, command(0));
      if (status === 'APPROVED') await h.useCase.approve(approvalContext(), draft.id, command(1));
      const sender = context({ userId: 'someone', permissions: [`expense.disbursement.${right}`, 'expense.read', 'expense.disbursement.read'] });
      assert.equal((await h.useCase.get(sender, draft.id)).actions[action], true);
      await h.useCase[action](sender, draft.id, command(status === 'APPROVED' ? 2 : 1, action === 'cancel' ? { reason: 'ไม่ใช้ใบนี้' } : {}));
    }
  });

  it('submits under ordered locks, reserves without changing expense versions and freezes the complete revision before numbering', async () => {
    const h = harness(); const draft = await h.useCase.create(context(), body({ lines: [{ expenseId: 'b', amount: '1' }, { expenseId: 'a', amount: '2' }] }));
    h.state.locks = [];
    const pending = await h.useCase.submit(context(), draft.id, command(0, { requestedApproverUserId: 'someone' }));
    assert.equal(pending.status, 'PENDING_APPROVAL'); assert.equal(pending.revision, 1); assert.equal(pending.version, 1); assert.equal(pending.documentNumber, 'PV-202610-00001');
    assert.ok(h.state.expenses.every((e: any) => e.reservedByDisbursementVoucherId === draft.id && e.updatedAt.toISOString() === '2026-10-01T00:00:00.000Z'));
    const keys = h.state.locks.map((l: any) => l.values[0]).filter((v: any) => typeof v === 'string');
    assert.equal(keys[0], `company-1:${draft.id}:disbursement-voucher-lifecycle`);
    assert.deepEqual(keys.filter((k: string) => k.includes('reimbursement-evidence')), ['company-1:reimbursement-evidence:expense:a', 'company-1:reimbursement-evidence:expense:b']);
    assert.deepEqual(keys.filter((k: string) => k.endsWith('expense-record-lifecycle')), ['company-1:a:expense-record-lifecycle', 'company-1:b:expense-record-lifecycle']);
    const revision = h.state.revisions[0]; assert.equal(revision.snapshotHash.length, 64);
    assert.equal(revision.snapshotJson.payee.basis, 'TAX_ID'); assert.equal(revision.snapshotJson.total, '3.0000');
    assert.deepEqual(revision.snapshotJson.lines.map((l: any) => [l.expenseNumber, l.grandTotal, l.wht, l.netPayable, l.outstanding, l.amount]), [['EXP-b', '107.0000', '3.0000', '104.0000', '104.0000', '1.0000'], ['EXP-a', '107.0000', '3.0000', '104.0000', '104.0000', '2.0000']]);
    assert.ok(h.state.lines.every((l: any) => l.sourceHashAtSubmit.length === 64));
    const detail = await h.useCase.get(context(), draft.id); assert.equal(detail.preparerName, 'สมใจ'); assert.equal(detail.submittedByName, 'สมใจ'); assert.equal(detail.requestedApproverName, 'สมชาย');
    assert.equal(detail.revisions[0].submittedByName, 'สมใจ'); assert.equal(detail.actions.approve, false); assert.equal(detail.actions.withdraw, true);
  });

  it('approveNow requires both rights and approves the new revision atomically with self-approval recorded', async () => {
    const h = harness(); const draft = await h.useCase.create(context(), body());
    await assert.rejects(() => h.useCase.submit(context(), draft.id, command(0, { approveNow: true })), refusal('disbursement_permission_denied', 'คุณยังไม่มีสิทธิ์ทำรายการนี้ ให้ผู้ดูแลร้านเพิ่มสิทธิ์ก่อนแล้วลองอีกครั้ง'));
    assert.equal(h.state.expenses[0].reservedByDisbursementVoucherId, null); assert.equal(h.state.numbers.length, 0);
    const both = context({ permissions: [...context().permissions, 'expense.disbursement.approve'] });
    const approved = await h.useCase.submit(both, draft.id, command(0, { approveNow: true }));
    assert.equal(approved.status, 'APPROVED'); assert.equal(approved.selfApproved, true); assert.equal(approved.approvedByUserId, ctx.userId);
    assert.equal(h.state.revisions[0].decision, 'APPROVED'); assert.equal(h.state.revisions[0].decidedByUserId, ctx.userId);
    assert.deepEqual(h.state.audits.slice(1).map((a: any) => a.action), ['expense.disbursement.submit', 'expense.disbursement.approve']);
  });

  it('approves for any eligible actor and derives selfApproved from this revision submitter', async () => {
    for (const userId of ['actor-1', 'someone']) {
      const h = harness(); const draft = await h.useCase.create(context(), body());
      await h.useCase.submit(context(), draft.id, command(0, { requestedApproverUserId: 'actor-1' }));
      h.state.expenses[0].updatedAt = new Date('2030-01-01');
      const approved = await h.useCase.approve(approvalContext(userId), draft.id, command(1));
      assert.equal(approved.selfApproved, userId === 'actor-1'); assert.equal(approved.approvedByUserId, userId);
      assert.equal(h.state.revisions[0].decision, 'APPROVED');
    }
  });

  it('refuses every approval source drift with the expense-specific remedy and keeps reservations', async () => {
    for (const patch of [{ outstandingAmount: '10.09' }, { vendorNameSnapshot: 'ร้านใหม่' }, { vendorTaxIdSnapshot: '0123456789013' },
      { status: 'DRAFT' }, { netPayableAmount: '103' }, { currency: 'USD' }, { reservedByDisbursementVoucherId: null }]) {
      const h = harness(); const draft = await h.useCase.create(context(), body()); await h.useCase.submit(context(), draft.id, command(0));
      Object.assign(h.state.expenses[0], patch);
      await assert.rejects(() => h.useCase.approve(approvalContext(), draft.id, command(1)), refusal('disbursement_source_changed',
        'รายการ EXP-a ถูกเปลี่ยนแปลงหลังส่งอนุมัติ ใบนี้จึงอนุมัติไม่ได้ กด "ส่งกลับให้แก้" พร้อมเหตุผลให้ผู้เตรียมตรวจรายการใหม่'));
      assert.equal(h.state.vouchers[0].status, 'PENDING_APPROVAL'); assert.equal(h.state.revisions[0].decision, null);
    }
  });

  it('snapshots only the presser signature at submit and approve, and clears it on return', async () => {
    const h = harness(), draft = await h.useCase.create(context(), body());
    (h.useCase as any).ownSignature = async (_tx: any, ctx: any) => ({ attachmentId: ctx.userId, checksumSha256: 'checksum', userId: ctx.userId });
    await h.useCase.submit(context(), draft.id, command(0));
    assert.equal(h.state.vouchers[0].preparerSignatureJson.userId, 'actor-1');
    await h.useCase.return(approvalContext(), draft.id, command(1, { reason: 'ตรวจใหม่' }));
    assert.equal(h.state.vouchers[0].preparerSignatureJson, null);
    h.state.vouchers[0].preparedByUserId = 'someone';
    const both = context({ permissions: ['expense.disbursement.prepare', 'expense.disbursement.approve', 'expense.read'] });
    await h.useCase.submit(both, draft.id, command(2, { approveNow: true }));
    assert.equal(h.state.vouchers[0].preparerSignatureJson, null);
    assert.equal(h.state.vouchers[0].approverSignatureJson.userId, 'actor-1');
    assert.equal(h.state.audits.at(-1).metadataJson.signatureChecksums.approver, 'checksum');
    await h.useCase.withdraw(both, draft.id, command(3));
    assert.equal(h.state.vouchers[0].approverSignatureJson, null);
  });
  it('return and resubmit retain the number, advance revisions, and preserve approval when later withdrawn or cancelled', async () => {
    const h = harness(); const draft = await h.useCase.create(context(), body()); const pending = await h.useCase.submit(context(), draft.id, command(0));
    const returned = await h.useCase.return(approvalContext(), draft.id, command(1, { reason: '  ตรวจใหม่  ' }));
    assert.equal(returned.status, 'DRAFT'); assert.equal(returned.documentNumber, pending.documentNumber); assert.equal(returned.returnReason, 'ตรวจใหม่');
    assert.equal(h.state.revisions[0].decision, 'RETURNED'); assert.ok(h.state.expenses.every((e: any) => e.reservedByDisbursementVoucherId === null));
    await assert.rejects(() => h.useCase.delete(context(), draft.id), refusal('disbursement_numbered_delete', 'ใบที่มีเลขแล้วลบไม่ได้ ให้ใช้ยกเลิกแทน'));
    const next = await h.useCase.submit(context({ userId: 'someone' }), draft.id, command(2)); assert.equal(next.revision, 2); assert.equal(next.documentNumber, pending.documentNumber); assert.equal(h.state.numbers.length, 1);
    await h.useCase.approve(approvalContext(), draft.id, command(3));
    const approval = { by: h.state.revisions[1].decidedByUserId, at: h.state.revisions[1].decidedAt };
    await h.useCase.withdraw(context({ userId: 'someone' }), draft.id, command(4, { reason: 'เปลี่ยนยอด' }));
    assert.equal(h.state.revisions[1].decision, 'APPROVED'); assert.equal(h.state.revisions[1].decidedByUserId, approval.by); assert.deepEqual(h.state.revisions[1].decidedAt, approval.at);
    assert.equal(h.state.revisions[1].postApprovalAction, 'WITHDRAWN'); assert.equal(h.state.revisions[1].postApprovalReason, 'เปลี่ยนยอด');
    const cancelled = await h.useCase.cancel(approvalContext(), draft.id, command(5, { reason: 'ไม่ใช้ใบนี้' })); assert.equal(cancelled.status, 'CANCELLED');
    assert.ok(h.state.expenses.every((e: any) => e.reservedByDisbursementVoucherId === null && e.updatedAt.toISOString() === '2026-10-01T00:00:00.000Z'));
    const detail = await h.useCase.get(context(), draft.id); assert.equal(detail.revisions[1].decidedByName, 'สมชาย'); assert.equal(detail.revisions[1].postApprovalByName, 'สมชาย');
    h.state.members = []; const anonymous = await h.useCase.get(context(), draft.id); assert.equal(anonymous.preparerName, null); assert.equal(anonymous.revisions[1].decidedByName, null);
  });

  it('prepare or approve holders cannot withdraw/cancel another author and leave histories unchanged', async () => {
    for (const status of ['PENDING_APPROVAL', 'APPROVED']) for (const action of ['withdraw', 'cancel'] as const) for (const right of ['prepare', 'approve']) {
      const h = harness(); const draft = await h.useCase.create(context(), body()); await h.useCase.submit(context(), draft.id, command(0));
      let version = 1; if (status === 'APPROVED') { await h.useCase.approve(approvalContext(), draft.id, command(1)); version = 2; }
      const other = context({ userId: 'someone', permissions: [`expense.disbursement.${right}`, 'expense.read'] });
      await assert.rejects(() => h.useCase[action](other, draft.id, command(version, { reason: 'ไม่ใช้ใบนี้' })), ForbiddenException);
      assert.equal(h.state.vouchers[0].status, status); assert.equal(h.state.expenses[0].reservedByDisbursementVoucherId, draft.id);
      assert.equal(h.state.revisions[0][status === 'APPROVED' ? 'postApprovalAction' : 'decision'], null);
    }
  });

  it('validates approver eligibility, trimmed reasons, versions, statuses and permissions with their Thai sentences', async () => {
    const h = harness(); const draft = await h.useCase.create(context(), body());
    assert.deepEqual(await h.useCase.approvers(context(), 'branch-1'), [{ userId: 'actor-1', displayName: 'สมใจ' }, { userId: 'someone', displayName: 'สมชาย' }]);
    for (const requestedApproverUserId of ['other-branch', 'no-right', 'removed']) await assert.rejects(() => h.useCase.submit(context(), draft.id, command(0, { requestedApproverUserId })),
      refusal('disbursement_approver_ineligible', 'ผู้อนุมัติที่เลือกไม่มีสิทธิ์อนุมัติใบของสาขานี้แล้ว เลือกใหม่'));
    await assert.rejects(() => h.useCase.approve(approvalContext(), draft.id, command(0)), refusal('disbursement_status_changed', 'สถานะของใบนี้เปลี่ยนไปแล้ว เปิดหน้านี้ใหม่เพื่อดูสถานะล่าสุด'));
    await assert.rejects(() => h.useCase.cancel(context(), draft.id, command(0, { reason: 'ไม่ใช้ใบนี้' })), refusal('disbursement_status_changed', 'สถานะของใบนี้เปลี่ยนไปแล้ว เปิดหน้านี้ใหม่เพื่อดูสถานะล่าสุด'));
    for (const reason of [undefined, '', '  กข  ']) for (const action of ['return', 'cancel'] as const) await assert.rejects(() => h.useCase[action](approvalContext(), draft.id, command(0, { reason })),
      refusal(`disbursement_${action}_reason_required`, action === 'return' ? 'เหตุผลที่ส่งกลับให้แก้สั้นเกินไป กรอกอย่างน้อย 3 ตัวอักษร' : 'เหตุผลที่ยกเลิกสั้นเกินไป กรอกอย่างน้อย 3 ตัวอักษร'));
    await h.useCase.submit(context(), draft.id, command(0));
    await assert.rejects(() => h.useCase.approve(approvalContext(), draft.id, command(0, { commandId: 'stale' })), refusal('disbursement_version_conflict', 'ใบนี้ถูกแก้ไขจากที่อื่นแล้ว เปิดหน้านี้ใหม่ก่อนบันทึก'));
    await assert.rejects(() => h.useCase.approve(context(), draft.id, command(1)), refusal('disbursement_permission_denied', 'คุณยังไม่มีสิทธิ์ทำรายการนี้ ให้ผู้ดูแลร้านเพิ่มสิทธิ์ก่อนแล้วลองอีกครั้ง'));
  });

  it('rechecks submit amounts, payee facts and reservations before allocating any number', async () => {
    const h = harness(); const first = await h.useCase.create(context(), body());
    const second = await h.useCase.create(context(), body({ commandId: 'second', lines: [{ expenseId: 'a', amount: '1' }, { expenseId: 'b', amount: '1' }] }));
    h.state.expenses[0].outstandingAmount = '10.09';
    await assert.rejects(() => h.useCase.submit(context(), first.id, command(0)), refusal('disbursement_amount_invalid', 'ยอดของรายการ EXP-a ต้องมากกว่า 0 และไม่เกินยอดค้างจ่าย 10.0900 แก้ยอดแล้วบันทึกอีกครั้ง'));
    assert.equal(h.state.numbers.length, 0); h.state.expenses[0].outstandingAmount = '104';
    await h.useCase.submit(context(), first.id, command(0));
    await assert.rejects(() => h.useCase.submit(context(), second.id, command(0, { commandId: 'second-submit' })), refusal('disbursement_expense_reserved', 'รายการ EXP-a: อยู่ในใบเตรียมจ่ายเลขที่ PV-202610-00001 แล้ว'));
    assert.equal(h.state.expenses[1].reservedByDisbursementVoucherId, null); assert.equal(h.state.numbers.length, 1); assert.equal(h.state.vouchers[1].status, 'DRAFT');
    const moved = harness(); const movedDraft = await moved.useCase.create(context(), body());
    moved.state.expenses[0].branchId = 'branch-2';
    await assert.rejects(() => moved.useCase.submit(context({ scopes: { branchIds: null } }), movedDraft.id, command(0)), refusal('disbursement_branch_changed', 'สาขาของรายจ่ายเปลี่ยนไป ให้กลับไปแก้ใบและตรวจสาขาของรายการก่อนส่งอนุมัติ'));
    assert.equal(moved.state.numbers.length, 0);
  });

  it('replays current headers, rejects changed command bodies and refuses LINE on all new routes', async () => {
    const h = harness(); const draft = await h.useCase.create(context(), body()); const submit = command(0);
    await h.useCase.submit(context(), draft.id, submit); await h.useCase.approve(approvalContext(), draft.id, command(1));
    assert.equal((await h.useCase.create(context(), body())).status, 'APPROVED');
    assert.equal((await h.useCase.submit(context(), draft.id, submit)).status, 'APPROVED');
    await h.useCase.withdraw(context(), draft.id, command(2)); assert.equal((await h.useCase.approve(approvalContext(), draft.id, command(1))).status, 'DRAFT');
    await assert.rejects(() => h.useCase.submit(context(), draft.id, { ...submit, approveNow: true }), refusal('disbursement_permission_denied', 'คุณยังไม่มีสิทธิ์ทำรายการนี้ ให้ผู้ดูแลร้านเพิ่มสิทธิ์ก่อนแล้วลองอีกครั้ง'));
    await assert.rejects(() => h.useCase.submit(context(), draft.id, { ...submit, requestedApproverUserId: 'someone' }), refusal('disbursement_command_conflict', 'ข้อมูลไม่ตรงกับคำสั่งที่บันทึกไว้ ให้เปิดใบตรวจข้อมูล แล้วใช้คำสั่งใหม่ถ้าต้องการแก้ไข'));
    const line = context({ authProvider: 'line', permissions: [...context().permissions, 'expense.disbursement.approve'] });
    for (const action of ['submit', 'approve', 'return', 'withdraw', 'cancel'] as const) await assert.rejects(() => h.useCase[action](line, draft.id, command(3, { reason: 'ตรวจใหม่' })),
      refusal('disbursement_line_session_denied', 'การเตรียมจ่ายใช้บัญชีที่เข้าผ่านไลน์ไม่ได้ ให้เข้าสู่ระบบด้วยบัญชีบนเว็บแล้วลองอีกครั้ง'));
    await assert.rejects(() => h.useCase.approvers(line, 'branch-1'), (e: any) => e.getStatus?.() === 403);
  });

  it('maps serialization and lock timeouts to delivery ก retry words and rolls submission back on audit failure', async () => {
    for (const error of [{ code: 'P2034' }, { code: 'P2028' }, { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '55P03' } } } }]) {
      const h = harness(); const draft = await h.useCase.create(context(), body()); h.client.$executeRaw = async () => { throw error; };
      await assert.rejects(() => h.useCase.submit(context(), draft.id, command(0)), (e: any) => e.getResponse?.().code === 'disbursement_changed_retry' && e.getResponse().message.includes('เปิดหน้านี้ใหม่แล้วลองอีกครั้ง'));
    }
    const h = harness(); const draft = await h.useCase.create(context(), body());
    h.useCase = new DisbursementVoucherUseCase(h.repo, new PrismaExpenseRepository({ client: h.client } as any), new ListExpensesUseCase({} as any), { log: async () => { throw new Error('audit failed'); } } as any);
    await assert.rejects(() => h.useCase.submit(context(), draft.id, command(0)), /audit failed/);
    assert.equal(h.state.expenses[0].reservedByDisbursementVoucherId, null); assert.equal(h.state.revisions.length, 0); assert.equal(h.state.numbers.length, 0);
  });

  it('keeps database failures from funding reads as retry refusals and always permits releasing a changed source', async () => {
    const h = harness(); const draft = await h.useCase.create(context(), body()); await h.useCase.submit(context(), draft.id, command(0));
    h.client.expenseSubstituteReceiptEvidence.findFirst = async () => { throw { code: 'P2034' }; };
    await assert.rejects(() => h.useCase.approve(approvalContext(), draft.id, command(1)), (e: any) => e.getResponse?.().code === 'disbursement_changed_retry');
    const withdrawn = await h.useCase.withdraw(context(), draft.id, command(1)); assert.equal(withdrawn.status, 'DRAFT'); assert.equal(h.state.expenses[0].reservedByDisbursementVoucherId, null);
  });

  const payer = (patch: any = {}) => context({ permissions: ['expense.disbursement.pay', 'expense.read', 'expense.disbursement.read'], ...patch });
  const approvedDraft = async (h: ReturnType<typeof harness>, patch: any = {}) => {
    const draft = await h.useCase.create(context(), body(patch));
    return h.useCase.submit(context({ permissions: ['expense.disbursement.prepare', 'expense.disbursement.approve', 'expense.read'] }), draft.id, command(0, { approveNow: true }));
  };

  it('signs each act from only its owner library, keeps prior snapshots after replacement and signs nothing without an asset', async () => {
    const h = harness();
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
    const hash = createHash('sha256').update(bytes).digest('hex');
    h.state.signatures = [{ companyId: 'company-1', submittedByUserId: 'actor-1', status: 'ACTIVE', originalAttachmentId: 'own' },
      { companyId: 'company-1', submittedByUserId: 'someone', status: 'ACTIVE', originalAttachmentId: 'other' }];
    h.state.attachments = ['own', 'other', 'replacement'].map(id => ({ id, companyId: 'company-1', status: 'ACTIVE', mimeType: 'image/png', byteSize: bytes.length, checksumSha256: hash, bucket: 'private', objectKey: id }));
    const reads: string[] = [];
    (h.useCase as any).storage = { getObject: async ({ objectKey }: any) => { reads.push(objectKey); return { bytes }; } };
    const draft = await h.useCase.create(context(), body());
    await assert.rejects(() => h.useCase.submit(context(), draft.id, command(0, { signatureAttachmentId: 'other' })), (e: any) => e.getResponse().code === 'disbursement_invalid_input');
    await h.useCase.submit(context(), draft.id, command(0));
    assert.equal(h.state.vouchers[0].preparerSignatureJson.attachmentId, 'own');
    assert.equal(h.state.revisions[0].snapshotJson.actors.preparer.signature.attachmentId, 'own');
    await h.useCase.approve(approvalContext(), draft.id, command(1));
    assert.equal(h.state.vouchers[0].approverSignatureJson.attachmentId, 'other');
    h.state.signatures[0].originalAttachmentId = 'replacement';
    await h.useCase.pay(payer(), draft.id, command(2, { paidDate: '2026-10-01', paymentMethod: 'CASH' }));
    const paid = h.state.vouchers[0];
    assert.equal(paid.payerSignatureJson.attachmentId, 'replacement');
    assert.equal(paid.paidSnapshotJson.actors.preparer.signature.attachmentId, 'own');
    assert.equal(paid.paidSnapshotJson.actors.approver.signature.attachmentId, 'other');
    assert.equal(paid.paidSnapshotJson.actors.payer.signature.attachmentId, 'replacement');
    assert.deepEqual(reads, ['own', 'other', 'replacement']);
    assert.equal(h.state.audits.find((a: any) => a.action === 'expense.disbursement.pay').metadataJson.signatureChecksumSha256, hash);
    const noSignature = harness();
    noSignature.state.signatures = [h.state.signatures[1]]; noSignature.state.attachments = h.state.attachments;
    const approved = await approvedDraft(noSignature);
    assert.equal((await noSignature.useCase.get(context(), approved.id)).hasOwnSignature, false);
    assert.equal((await noSignature.useCase.get(context({ userId: 'someone' }), approved.id)).hasOwnSignature, true);
    await noSignature.useCase.pay(payer(), approved.id, command(1, { paidDate: '2026-10-01', paymentMethod: 'CASH' }));
    for (const role of ['preparer', 'approver', 'payer']) assert.equal(noSignature.state.vouchers[0].paidSnapshotJson.actors[role].signature, null);
  });

  it('supporting files reject unrelated uploads and direct file access outside the voucher scope', async () => {
    const h = harness(), draft = await h.useCase.create(context(), body());
    const file = { id: 'support', companyId: 'company-1', branchId: 'branch-1', status: 'ACTIVE', uploadedByUserId: 'actor-1', originalFileName: 'bank.png', mimeType: 'image/png', byteSize: 100, uploadedAt: new Date(), metadataJson: { generatedFor: 'disbursement_voucher_supporting', voucherId: draft.id } };
    for (const patch of [{ companyId: 'other' }, { branchId: 'branch-2' }, { status: 'PENDING_UPLOAD' }, { uploadedByUserId: 'someone' }, { mimeType: 'image/svg+xml' }, { metadataJson: { generatedFor: 'disbursement_voucher_supporting', voucherId: 'other' } }]) {
      h.state.attachments = [{ ...file, ...patch }];
      await assert.rejects(() => h.useCase.changeSupportingFile(context(), draft.id, file.id, false), (e: any) => e.getResponse().code === 'disbursement_supporting_not_owned');
      assert.equal(h.state.attachmentLinks.length, 0);
    }
    h.state.attachments = [file];
    for (const remove of [true, false]) await assert.rejects(() => h.useCase.changeSupportingFile(payer(), draft.id, file.id, remove), ForbiddenException);
    await h.useCase.changeSupportingFile(context(), draft.id, file.id, false);
    let reads = 0;
    (h.useCase as any).storage = { getObject: async () => { reads++; return { bytes: Buffer.from('bank') }; } };
    for (const reader of [context({ companyId: 'other' }), context({ scopes: { branchIds: ['branch-2'] } }), context({ permissions: ['expense.read'] })]) {
      await assert.rejects(() => h.useCase.supportingFileBytes(reader, draft.id, file.id), NotFoundException);
    }
    await assert.rejects(() => h.useCase.supportingFileBytes(context(), draft.id, 'other-file'), NotFoundException);
    assert.equal(reads, 0);
    assert.equal((await h.useCase.supportingFileBytes(context(), draft.id, file.id)).data.toString(), 'bank');
  });

  it('supporting files require prepare and a visible draft, freeze on submit and reopen on return', async () => {
    const h = harness(), draft = await h.useCase.create(context(), body());
    const upload = { originalFileName: 'bank.png', mimeType: 'image/png', byteSize: 100 };
    (h.useCase as any).createUpload = { execute: async (_: any, input: any) => input };
    const intent = await h.useCase.startSupportingUpload(context(), draft.id, upload);
    assert.equal((intent as any).metadataJson.generatedFor, 'disbursement_voucher_supporting');
    for (const reader of [payer(), context({ permissions: ['expense.read'] })]) await assert.rejects(() => h.useCase.startSupportingUpload(reader, draft.id, upload), ForbiddenException);
    for (const reader of [context({ companyId: 'other' }), context({ scopes: { branchIds: ['branch-2'] } })]) await assert.rejects(() => h.useCase.supportingFiles(reader, draft.id), NotFoundException);
    for (const bad of [{ mimeType: 'image/svg+xml' }, { byteSize: 0 }, { byteSize: 10485761 }]) await assert.rejects(() => h.useCase.startSupportingUpload(context(), draft.id, { ...upload, ...bad }));
    h.state.attachments.push({ id: 'support', companyId: 'company-1', branchId: 'branch-1', status: 'PENDING_UPLOAD', uploadedByUserId: 'actor-1', originalFileName: 'bank.png', mimeType: 'image/png', byteSize: 100, uploadedAt: new Date(), metadataJson: { generatedFor: 'disbursement_voucher_supporting', voucherId: draft.id } });
    (h.useCase as any).completeUpload = { execute: async () => { throw new Error('scan rejected'); } };
    await assert.rejects(() => h.useCase.completeSupportingUpload(context(), draft.id, 'support', {}), /scan rejected/);
    assert.equal(h.state.attachmentLinks.length, 0);
    (h.useCase as any).completeUpload = { execute: async () => { h.state.attachments[0].status = 'ACTIVE'; } };
    await h.useCase.completeSupportingUpload(context(), draft.id, 'support', {});
    await h.useCase.changeSupportingFile(context(), draft.id, 'support', false);
    const files = await h.useCase.supportingFiles(context(), draft.id);
    assert.equal(files[0].name, 'bank.png'); assert.equal(files[0].uploadedByUserId, 'actor-1');
    assert.equal((await h.useCase.get(context(), draft.id)).supportingFiles?.length, 1);
    (h.useCase as any).storage = { createDownloadUrl: async () => ({ url: '/signed', expiresAt: new Date() }) };
    assert.equal((await h.useCase.openSupportingFile(context(), draft.id, 'support')).downloadUrl, '/signed');
    await h.useCase.submit(context(), draft.id, command(0));
    for (const remove of [true, false]) await assert.rejects(() => h.useCase.changeSupportingFile(context(), draft.id, 'support', remove), (e: any) => e.getResponse().code === 'disbursement_supporting_frozen');
    await h.useCase.return(approvalContext(), draft.id, command(1, { reason: 'เพิ่มไฟล์' }));
    await h.useCase.changeSupportingFile(context(), draft.id, 'support', true);
    assert.equal((await h.useCase.supportingFiles(context(), draft.id)).length, 0);
    assert.equal(h.state.attachments[0].status, 'ACTIVE', 'removal unlinks without destroying bytes');
    assert.ok(h.state.audits.some((a: any) => a.action === 'expense.disbursement.supporting.remove'));

  });
  it('Round 5 LINE previews reuse voucher source/permission/status guards without reservations, audits or document writes', async () => {
    const all = ['expense.read', 'expense.disbursement.read', 'expense.disbursement.prepare', 'expense.disbursement.approve', 'expense.disbursement.pay'];
    for (const action of ['create', 'submit', 'approve', 'return', 'pay', 'cancel'] as const) {
      const h = harness(), line = context({ authProvider: 'line', permissions: all, ...(action === 'return' ? { userId: 'someone' } : {}) });
      const draft = await h.useCase.create(context(), body());
      if (!['create','submit'].includes(action)) await h.useCase.submit(context({ permissions: all }), draft.id, command(0));
      if (action === 'pay') await h.useCase.approve(context({ permissions: all }), draft.id, command(1));
      const counts = () => [h.state.audits.length, h.state.commands.length, h.state.numbers.length, h.state.payments.length, h.state.expenses[0].reservedByDisbursementVoucherId];
      const before = counts();
      const input = { id: draft.id, draft: body(), reason: 'ข้อมูลไม่ตรง', payment: { commandId: 'preview', expectedVersion: h.state.vouchers[0].version, paidDate: '2026-10-15', paymentMethod: 'CASH' as const } };
      await h.useCase.previewLineAction(line, action, input); assert.deepEqual(counts(), before, action);
      await assert.rejects(() => h.useCase.previewLineAction({ ...line, permissions: ['expense.read', 'expense.disbursement.read'] }, action, input), ForbiddenException);
      if (action === 'create') { h.state.expenses[0].status = 'DRAFT'; await assert.rejects(() => h.useCase.previewLineAction(line, action, input)); }
      else { h.state.vouchers[0].status = 'PAID'; await assert.rejects(() => h.useCase.previewLineAction(line, action, input)); }
      assert.deepEqual(counts(), before, action);
    }
  });
  it('LINE voucher previews keep the sold ownership and inactive-preparer recovery rules without writes', async () => {
    const h = harness();
    const draft = await h.useCase.create(context(), body());
    await h.useCase.submit(context(), draft.id, command(0));
    const line = context({ authProvider: 'line', permissions: ['expense.read', 'expense.disbursement.prepare', 'expense.disbursement.approve'] });
    const input = { id: draft.id, reason: 'ข้อมูลไม่ตรง' };
    const before = h.state.commands.length;
    await assert.rejects(() => h.useCase.previewLineAction(line, 'return', input), ForbiddenException);
    await assert.rejects(() => h.useCase.previewLineAction({ ...line, userId: 'someone' }, 'cancel', input), ForbiddenException);
    await h.useCase.previewLineAction({ ...line, userId: 'someone' }, 'return', input);
    h.state.members = [];
    await assert.rejects(() => h.useCase.previewLineAction({ ...line, userId: 'someone' }, 'return', input), ForbiddenException);
    await h.useCase.previewLineAction({ ...line, userId: 'someone', roles: ['OWNER'] }, 'cancel', input);
    assert.equal(h.state.commands.length, before);
    assert.equal(h.state.vouchers[0].status, 'PENDING_APPROVAL');
  });
  it('Round 5 LINE create preserves the user ctx and fences source revision under the existing source lock; ordinary HTTP LINE remains denied', async () => {
    const h = harness(), line = context({ authProvider: 'line' });
    await assert.rejects(() => h.useCase.create(line, body()), (error: any) => error.getResponse().code === 'disbursement_line_session_denied');
    const revisions = [{ id: 'a', revision: h.state.expenses[0].updatedAt.toISOString() }];
    h.state.expenses[0].updatedAt = new Date('2026-10-02');
    await assert.rejects(() => h.useCase.create(line, body(), true, revisions), (error: any) => error.getResponse().code === 'disbursement_source_changed');
    assert.equal(h.state.vouchers.length, 0); assert.equal(h.state.audits.length, 0);
    revisions[0].revision = h.state.expenses[0].updatedAt.toISOString();
    const created = await h.useCase.create(line, body(), true, revisions); assert.equal(created.status, 'DRAFT');
    assert.equal(h.state.audits[0].actorUserId, line.userId);
    await assert.rejects(() => h.useCase.get(line, created.id));
    assert.equal((await h.useCase.get(line, created.id, true)).header.id, created.id);
    await assert.rejects(() => h.useCase.previewLineAction({ ...line, scopes: { branchIds: ['branch-other'] } }, 'submit', { id: created.id }));
  });
  it('Round 5 LINE slip uses upload, completion/scanning, and exclusive attach before pay; foreign/stale/inactive evidence refuses', async () => {
    for (const mismatch of ['valid', 'chat', 'revision', 'owner', 'inactive', 'branch']) {
      const h = harness(), v = await approvedDraft(h), line = payer({ authProvider: 'line' });
      const capture = source('line-slip', { captureSource: 'LINE_UPLOAD', status: 'DRAFT', sourceDocumentType: 'TRANSFER_SLIP', primaryAttachmentId: 'chat-slip', sourceChannelMetadataJson: { chatKeyHash: 'private-chat' } });
      h.state.expenses.push(capture);
      slipUpload(h, '', 'chat-slip', { metadataJson: {}, ...(mismatch === 'inactive' ? { status: 'PENDING_UPLOAD' } : {}) });
      if (mismatch === 'chat') capture.sourceChannelMetadataJson.chatKeyHash = 'foreign';
      if (mismatch === 'owner') capture.createdByUserId = 'someone';
      if (mismatch === 'branch') capture.branchId = 'branch-other';
      const evidence = { id: capture.id, attachmentId: 'chat-slip', chat: 'private-chat', revision: mismatch === 'revision' ? new Date('2026-10-02').toISOString() : capture.updatedAt.toISOString() };
      const calls: string[] = [];
      (h.useCase as any).storage = { getObject: async () => { calls.push('read'); return { bytes: Buffer.from('image') }; }, putObject: async () => { calls.push('upload'); return { byteSize: 5, checksumSha256: 'checked' }; } };
      (h.useCase as any).createUpload = { execute: async (context: any, input: any) => { calls.push('intent'); assert.equal(context.userId, line.userId); assert.deepEqual(input.metadataJson, { generatedFor: 'disbursement_voucher_slip', voucherId: v.id }); slipUpload(h, v.id, 'voucher-copy', { status: 'PENDING_UPLOAD' }); return { attachmentId: 'voucher-copy' }; } };
      (h.useCase as any).completeUpload = { execute: async (context: any, input: any) => { calls.push('complete'); assert.equal(context.userId, line.userId); assert.equal(input.checksumSha256, 'checked'); h.state.attachments.find((file: any) => file.id === 'voucher-copy').status = 'ACTIVE'; } };
      if (mismatch !== 'valid') { await assert.rejects(() => h.useCase.attachLineSlip(line, v.id, evidence, v.version)); assert.equal(h.state.vouchers[0].slipAttachmentId ?? null, null); assert.deepEqual(calls, []); }
      else { const attached = await h.useCase.attachLineSlip(line, v.id, evidence, v.version); assert.equal(attached.slip?.attachmentId, 'voucher-copy'); assert.deepEqual(calls, ['read','intent','upload','complete']); assert.equal((await h.useCase.pay(line, v.id, { ...command(attached.header.version), slipAttachmentId: 'voucher-copy' }, true)).status, 'PAID'); }
    }
  });

  it('allows slip uploads only for visible approved or paid documents with the pay right, never LINE', async () => {
    const h = harness(), draft = await h.useCase.create(context(), body());
    const upload = { originalFileName: 'slip.png', mimeType: 'image/png', byteSize: 100 };
    (h.useCase as any).createUpload = { execute: async (ctx: any, input: any) => ({ ctx, input }) };
    await assert.rejects(() => (h.useCase as any).startSlipUpload(payer(), draft.id, upload), refusal('disbursement_slip_status', 'สถานะของใบนี้ยังแนบหลักฐานการจ่ายไม่ได้ แนบได้เมื่ออนุมัติแล้ว รอจ่าย หรือจ่ายแล้ว เปิดใบตรวจสถานะอีกครั้ง'));
    h.state.vouchers[0].status = 'APPROVED';
    for (const denied of [context(), payer({ authProvider: 'line' })]) await assert.rejects(() => (h.useCase as any).startSlipUpload(denied, draft.id, upload), ForbiddenException);
    for (const denied of [payer({ companyId: 'other' }), payer({ scopes: { branchIds: ['branch-2'] } }), payer({ userId: 'someone', permissions: ['expense.disbursement.pay', 'expense.read_own'] })]) {
      await assert.rejects(() => (h.useCase as any).startSlipUpload(denied, draft.id, upload), refusal('disbursement_not_found', 'ไม่พบใบเตรียมจ่ายที่เปิดดูได้ ให้กลับไปหน้ารายการแล้วเลือกใบใหม่'));
    }
    for (const patch of [{ mimeType: 'image/svg+xml' }, { byteSize: 10 * 1024 * 1024 + 1 }, { byteSize: 0 }, { byteSize: 1.5 }]) await assert.rejects(() => (h.useCase as any).startSlipUpload(payer(), draft.id, { ...upload, ...patch }), refusal('disbursement_slip_invalid', 'หลักฐานการจ่ายต้องเป็นรูปภาพหรือไฟล์ PDF ขนาดไม่เกิน 10 เมกะไบต์ เลือกไฟล์ใหม่'));
    for (const status of ['APPROVED', 'PAID']) {
      h.state.vouchers[0].status = status;
      const result = await (h.useCase as any).startSlipUpload(payer({ permissions: ['expense.disbursement.pay', 'expense.read'] }), draft.id, upload);
      assert.ok(result.ctx.permissions.includes('attachment.create'));
      assert.deepEqual(result.input.metadataJson, { generatedFor: 'disbursement_voucher_slip', voucherId: draft.id });
      assert.equal(result.input.branchId, 'branch-1');
    }
    for (const status of ['DRAFT', 'PENDING_APPROVAL', 'CANCELLED']) { h.state.vouchers[0].status = status; await assert.rejects(() => (h.useCase as any).startSlipUpload(payer(), draft.id, upload), (e: any) => e.getResponse().code === 'disbursement_slip_status'); }
  });

  it('refuses another document’s slip at payment before creating any payment', async () => {
    const h = harness(), approved = await approvedDraft(h);
    await assert.rejects(() => h.useCase.pay(payer(), approved.id, command(1, { slipAttachmentId: 'someone-elses-file' })), refusal('disbursement_slip_not_owned', 'หลักฐานการจ่ายนี้ไม่ได้อัปโหลดสำหรับใบนี้ หรือยังอัปโหลดไม่เสร็จ อัปโหลดหลักฐานการจ่ายของใบนี้ใหม่'));
    assert.equal(h.state.payments.length, 0);
    assert.equal(h.state.vouchers[0].status, 'APPROVED');
  });

  it('requires the upload tag and document binding even when a payment slip pointer and link were forged', async () => {
    const h = harness(), v = await approvedDraft(h);
    h.state.vouchers[0].slipAttachmentId = 'forged';
    slipUpload(h, 'other-document', 'forged');
    h.state.attachmentLinks.push({ companyId: 'company-1', attachmentId: 'forged', targetType: 'disbursement_voucher', targetId: v.id, purpose: 'expense.disbursement_voucher.slip' });
    await assert.rejects(() => h.useCase.pay(payer(), v.id, command(1, { slipAttachmentId: 'forged' })), refusal('disbursement_slip_not_owned', 'หลักฐานการจ่ายนี้ไม่ได้อัปโหลดสำหรับใบนี้ หรือยังอัปโหลดไม่เสร็จ อัปโหลดหลักฐานการจ่ายของใบนี้ใหม่'));
    assert.equal(h.state.payments.length, 0);
  });

  const slipUpload = (h: ReturnType<typeof harness>, voucherId: string, id = 'slip-1', patch: any = {}) => {
    const file = { id, companyId: 'company-1', branchId: 'branch-1', status: 'ACTIVE', mimeType: 'image/png', byteSize: 100,
      uploadedByUserId: 'actor-1', metadataJson: { generatedFor: 'disbursement_voucher_slip', voucherId },
      bucket: 'test', objectKey: 'private-slip', objectVersionId: 'version-1', originalFileName: 'slip.png', ...patch };
    h.state.attachments.push(file); return file;
  };

  it('confirms only the payer’s upload for this document through the shared completion and propagates scan refusal', async () => {
    const h = harness(), v = await approvedDraft(h);
    slipUpload(h, v.id, 'valid', { status: 'PENDING_UPLOAD' });
    slipUpload(h, 'another-document', 'foreign', { status: 'PENDING_UPLOAD' });
    slipUpload(h, v.id, 'another-user', { uploadedByUserId: 'someone', status: 'PENDING_UPLOAD' });
    let calls = 0;
    (h.useCase as any).completeUpload = { execute: async (ctx: any, body: any) => {
      calls++; assert.ok(ctx.permissions.includes('attachment.create')); assert.equal(body.attachmentId, 'valid'); throw new BadRequestException('scan rejected');
    } };
    for (const id of ['foreign', 'another-user', 'missing']) await assert.rejects(() => h.useCase.completeSlipUpload(payer(), v.id, id, {}), (e: any) => e.getResponse().code === 'disbursement_slip_not_owned');
    assert.equal(calls, 0);
    await assert.rejects(() => h.useCase.completeSlipUpload(payer(), v.id, 'valid', {}), /scan rejected/);
    assert.equal(h.state.attachmentLinks.length, 0);
    (h.useCase as any).completeUpload = { execute: async () => { h.state.attachments[0].status = 'ACTIVE'; } };
    assert.deepEqual(await h.useCase.completeSlipUpload(payer(), v.id, 'valid', {}), { attachmentId: 'valid' });
  });

  it('attaches and replaces one exclusive slip, keeps the old file, records the attacher, and pays with the attached slip', async () => {
    const h = harness(), v = await approvedDraft(h);
    slipUpload(h, v.id);
    const attached = await h.useCase.attachSlip(payer(), v.id, 'slip-1');
    assert.equal(attached.header.version, 2);
    assert.equal(attached.slip?.attachedByName, 'สมใจ');
    assert.ok(attached.slip?.attachedAt);
    assert.deepEqual(await h.useCase.attachSlip(payer({ userId: 'someone' }), v.id, 'slip-1'), attached);
    assert.equal(h.state.audits.filter((a: any) => a.action === 'expense.disbursement.slip.attach').length, 1);
    slipUpload(h, v.id, 'slip-2', { uploadedByUserId: 'someone' });
    await h.useCase.attachSlip(payer({ userId: 'someone' }), v.id, 'slip-2');
    assert.equal(h.state.attachmentLinks.length, 1);
    assert.equal(h.state.attachments[0].status, 'ACTIVE');
    const detail = await h.useCase.get(payer(), v.id);
    assert.equal(detail.slip?.attachmentId, 'slip-2'); assert.equal(detail.slip?.attachedByName, 'สมชาย');
    assert.equal(detail.canAttachSlip, true);
    assert.equal((await h.useCase.get(context(), v.id)).canAttachSlip, false);
    let download: any;
    (h.useCase as any).storage = { createDownloadUrl: async (input: any) => { download = input; return { url: 'signed-url', expiresAt: new Date() }; } };
    assert.equal((await h.useCase.slip(context(), v.id)).downloadUrl, 'signed-url');
    assert.equal(download.objectVersionId, 'version-1');
    (h.useCase as any).storage.getObject = async (input: any) => { download = input; return { bytes: Buffer.from('original-slip') }; };
    const bundled = await h.useCase.slipBytes(context(), v.id);
    assert.equal(bundled.data.toString(), 'original-slip');
    assert.equal(bundled.mimeType, 'image/png');
    assert.equal(download.objectVersionId, 'version-1');
    await assert.rejects(() => h.useCase.slipBytes(context({ permissions: ['expense.read'] }), v.id), refusal('disbursement_not_found', 'ไม่พบใบเตรียมจ่ายที่เปิดดูได้ ให้กลับไปหน้ารายการแล้วเลือกใบใหม่'));

    await assert.rejects(() => h.useCase.pay(payer(), v.id, command(3, { slipAttachmentId: 'slip-1' })), (e: any) => e.getResponse().code === 'disbursement_slip_not_owned');
    assert.equal((await h.useCase.pay(payer(), v.id, command(3, { slipAttachmentId: 'slip-2' }))).status, 'PAID');
    assert.equal((await h.useCase.get(payer(), v.id)).canAttachSlip, true);
    const snapshot = structuredClone(h.state.vouchers[0].paidSnapshotJson);
    slipUpload(h, v.id, 'late-slip');
    await h.useCase.attachSlip(payer(), v.id, 'late-slip');
    assert.equal(h.state.vouchers[0].status, 'PAID');
    assert.deepEqual(h.state.vouchers[0].paidSnapshotJson, snapshot);
    assert.equal(h.state.attachmentLinks.length, 1);
  });

  it('refuses slips already used elsewhere, foreign uploads, pending files and wrong branches without changing the pointer', async () => {
    const h = harness(), v = await approvedDraft(h);
    for (const [id, patch] of [['foreign', { metadataJson: { generatedFor: 'disbursement_voucher_slip', voucherId: 'other' } }],
      ['pending', { status: 'PENDING_UPLOAD' }], ['wrong-branch', { branchId: 'branch-2' }], ['wrong-user', { uploadedByUserId: 'someone' }]] as const) {
      slipUpload(h, v.id, id, patch);
      await assert.rejects(() => h.useCase.attachSlip(payer(), v.id, id), (e: any) => e.getResponse().code === 'disbursement_slip_not_owned');
    }
    slipUpload(h, v.id, 'in-use');
    h.state.attachmentLinks.push({ companyId: 'company-1', attachmentId: 'in-use', targetType: 'expense.record', targetId: 'a', purpose: 'expense.receipt.primary' });
    await assert.rejects(() => h.useCase.attachSlip(payer(), v.id, 'in-use'), refusal('disbursement_slip_link_conflict', 'ไฟล์นี้ใช้กับเอกสารอื่นอยู่แล้ว จึงใช้เป็นหลักฐานการจ่ายของใบนี้ไม่ได้ อัปโหลดหลักฐานการจ่ายใหม่'));
    assert.equal(h.state.vouchers[0].slipAttachmentId, undefined);
    assert.equal(h.state.vouchers[0].version, 1);
  });

  it('conceals both file endpoints when even one line is unreadable, and says when no slip exists', async () => {
    const h = harness([source('a'), source('b', { createdByUserId: 'someone' })]);
    const v = await approvedDraft(h, { lines: [{ expenseId: 'a', amount: '1' }, { expenseId: 'b', amount: '1' }] });
    const own = context({ permissions: ['expense.disbursement.read', 'expense.read_own'] });
    for (const method of ['slip', 'slipBytes', 'documentPdf']) await assert.rejects(() => (h.useCase as any)[method](own, v.id), refusal('disbursement_not_found', 'ไม่พบใบเตรียมจ่ายที่เปิดดูได้ ให้กลับไปหน้ารายการแล้วเลือกใบใหม่'));
    await assert.rejects(() => (h.useCase as any).slip(context(), v.id), refusal('disbursement_slip_missing', 'ใบนี้ยังไม่มีหลักฐานการจ่าย เปิดใบนี้เพื่อตรวจไฟล์ที่แนบ'));
  });

  it('pays exact approved amounts with the pay right alone, one transaction, all locks before writes and direct payment effects', async () => {
    const h = harness(); const approved = await approvedDraft(h, { lines: [{ expenseId: 'b', amount: '0.20' }, { expenseId: 'a', amount: '10.10' }], plannedMethod: 'BANK_TRANSFER' });
    Object.assign(h.state.vouchers[0], { payeeBankName: 'ธนาคารทดสอบ', payeeAccountName: 'ร้าน ก', payeeAccountLast4: '6789', payeeAccountCiphertext: 'secret-account-ciphertext' });
    h.state.locks.length = 0;
    const paid = await h.useCase.pay(payer(), approved.id, command(1, { paidDate: '2026-10-01', paidFromRef: '  เงินสดหน้าร้าน  ' }));
    assert.equal(paid.status, 'PAID'); assert.equal(paid.documentNumber, approved.documentNumber); assert.equal(paid.totalAmount, '10.3000');
    assert.equal(paid.paidMethod, 'BANK_TRANSFER'); assert.equal(paid.paidFromRef, 'เงินสดหน้าร้าน'); assert.equal(h.state.transactions.at(-1).timeout, 20000);
    assert.equal(h.state.payments.length, 2); assert.equal(h.state.events.length, 2);
    for (const e of h.state.expenses) { const amount = e.id === 'a' ? '10.1000' : '0.2000'; assert.equal(e.paidAmount, amount); assert.equal(e.reservedByDisbursementVoucherId, null); }
    assert.deepEqual(h.state.lines.map((l: any) => [l.expensePaymentId, l.coversPaymentId]), [['pay-0', 'pay-0'], ['pay-1', 'pay-1']]);
    for (const p of h.state.payments) { assert.equal(p.paidAtConfirmed, true); assert.equal(p.bankAccountRef, 'เงินสดหน้าร้าน'); assert.equal(p.paidAt.toISOString(), '2026-09-30T17:00:00.000Z'); assert.match(p.idempotencyKey, /^dv:/); }
    for (const event of h.state.events) { assert.equal(event.eventType, 'expense.payment_recorded'); assert.equal(event.eventKey, `expense.payment_recorded:expense_payment:${event.aggregateId}`); assert.equal(event.payloadJson.data.paymentId, event.aggregateId); }
    assert.equal(h.state.audits.filter((a: any) => a.action === 'expense.payment.record').length, 2);
    const keys = h.state.locks.filter((l: any) => l.values[0]?.endsWith('expense-payment-command')).map((l: any) => l.values[0]);
    assert.deepEqual(keys, [...keys].sort()); assert.equal(keys.length, 2);
    const firstWrite = h.state.locks.findIndex((l: any) => l.sql === 'WRITE payment');
    const correctionIndices = h.state.locks.flatMap((l: any, i: number) => l.values[0]?.endsWith('expense-record-lifecycle') ? [i] : []);
    assert.equal(correctionIndices.length, 2); assert.ok(correctionIndices.every((i: number) => i < firstWrite));
    const snapshot = h.state.vouchers[0].paidSnapshotJson;
    assert.equal(snapshot.company.name, 'กิจการทดสอบ'); assert.equal(snapshot.branch.name, 'สำนักงานใหญ่'); assert.equal(snapshot.totals.paidThisTime, '10.3000');
    assert.equal(snapshot.totals.grandTotal, '214.0000'); assert.equal(snapshot.totals.wht, '6.0000'); assert.equal(snapshot.totals.netPayable, '208.0000'); assert.equal(snapshot.totals.outstandingAfter, '197.7000');
    assert.equal(snapshot.actors.payer.name, 'สมใจ'); assert.equal(snapshot.actors.approver.selfApproved, true); assert.equal(snapshot.paidDate, '2026-10-01');
    assert.deepEqual(snapshot.payeeAccount, { bankName: 'ธนาคารทดสอบ', accountName: 'ร้าน ก', last4: '6789' });
    assert.equal(snapshot.paidRecordedAt, paid.paidRecordedAt); assert.match(h.state.vouchers[0].paidSnapshotHash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(snapshot).includes('secret-account-ciphertext'), false);
    assert.equal(JSON.stringify(snapshot).includes('Ciphertext'), false);
    const detail = await h.useCase.get(payer(), paid.id); assert.equal(detail.paidByName, 'สมใจ'); assert.ok(detail.lines.every((l: any) => l.paymentInEffect));
    h.state.payments[0].status = 'VOIDED'; assert.equal((await h.useCase.get(payer(), paid.id)).lines[0].paymentInEffect, false);
    h.state.members[0].status = 'DISABLED'; assert.equal((await h.useCase.get(payer({ userId: 'someone' }), paid.id)).paidByName, 'สมใจ');
    assert.equal(snapshot.actors.payer.name, 'สมใจ', 'the paid snapshot retains the name frozen at recording');
  });

  it('defaults to Bangkok today and the planned method, refuses future dates and requires a payment method', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T17:30:00Z').getTime() });
    const h = harness(); const approved = await approvedDraft(h, { plannedMethod: 'CASH' });
    await assert.rejects(() => h.useCase.pay(payer(), approved.id, command(1, { paidDate: '2026-10-06' })), refusal('expense_payment_future_date', 'วันที่จ่ายเงินจริงต้องไม่เกินวันนี้'));
    assert.equal(h.state.payments.length, 0);
    const paid = await h.useCase.pay(payer(), approved.id, command(1)); assert.equal(paid.paidDate, '2026-10-05'); assert.equal(paid.paidMethod, 'CASH');
    assert.ok(h.state.payments.every((p: any) => p.paidAtConfirmed === false));
    t.mock.timers.setTime(new Date('2026-10-05T17:30:00Z').getTime());
    assert.equal((await h.useCase.pay(payer(), approved.id, command(1))).paidDate, '2026-10-05', 'omitted-date replay stays the original payment across Bangkok midnight');
    const other = harness(); const v = await approvedDraft(other);
    other.state.expenses[0].updatedAt = new Date('2026-10-05T17:35:00Z');
    const override = await other.useCase.pay(payer(), v.id, command(1, { paymentMethod: 'BANK_TRANSFER' }));
    assert.equal(override.paidMethod, 'BANK_TRANSFER'); assert.equal(override.paidDate, '2026-10-06');
    const noMethod = harness(); const without = await approvedDraft(noMethod, { plannedMethod: undefined });
    await assert.rejects(() => noMethod.useCase.pay(payer(), without.id, command(1)), refusal('disbursement_payment_method_required', 'เลือกวิธีจ่ายก่อนบันทึก'));
    assert.equal(noMethod.state.payments.length, 0);
  });

  it('refuses payment source drift by expense number before any payment write', async () => {
    for (const patch of [{ outstandingAmount: '0.10' }, { status: 'READY_FOR_CONFIRMATION' }, { vendorNameSnapshot: 'เปลี่ยนร้าน' }, { vendorTaxIdSnapshot: '1111111111111' }, { netPayableAmount: '105' }, { currency: 'USD' }, { reservedByDisbursementVoucherId: null }, { sourceReimbursementRequestId: 'claim' }]) {
      const h = harness(); const approved = await approvedDraft(h, { lines: [{ expenseId: 'a', amount: '1' }, { expenseId: 'b', amount: '1' }] });
      Object.assign(h.state.expenses[1], patch);
      await assert.rejects(() => h.useCase.pay(payer(), approved.id, command(1)), refusal('disbursement_payment_source_changed', 'รายการ EXP-b ถูกเปลี่ยนแปลงหลังอนุมัติ จึงบันทึกจ่ายไม่ได้ ให้ผู้เตรียมหรือผู้ส่งใบนี้กด "กลับไปแก้" เพื่อตรวจรายการใหม่ แล้วส่งอนุมัติอีกครั้ง'));
      assert.equal(h.state.payments.length, 0); assert.equal(h.state.events.length, 0); assert.equal(h.state.vouchers[0].status, 'APPROVED');
    }
  });

  it('checks pay permission, status, version, LINE, tenant and every-line visibility and rejects client amounts', async () => {
    const h = harness(); const approved = await approvedDraft(h);
    for (const denied of [context({ permissions: ['expense.payment.record', 'expense.read'] }), payer({ permissions: ['expense.read'] })]) await assert.rejects(() => h.useCase.pay(denied, approved.id, command(1)), refusal('disbursement_permission_denied', 'คุณยังไม่มีสิทธิ์ทำรายการนี้ ให้ผู้ดูแลร้านเพิ่มสิทธิ์ก่อนแล้วลองอีกครั้ง'));
    await assert.rejects(() => h.useCase.pay(payer({ authProvider: 'line' }), approved.id, command(1)), refusal('disbursement_line_session_denied', 'การเตรียมจ่ายใช้บัญชีที่เข้าผ่านไลน์ไม่ได้ ให้เข้าสู่ระบบด้วยบัญชีบนเว็บแล้วลองอีกครั้ง'));
    for (const denied of [payer({ companyId: 'another' }), payer({ scopes: { branchIds: ['branch-2'] } }), payer({ userId: 'someone', permissions: ['expense.disbursement.pay', 'expense.read_own'] })]) await assert.rejects(() => h.useCase.pay(denied, approved.id, command(1)), refusal('disbursement_not_found', 'ไม่พบใบเตรียมจ่ายที่เปิดดูได้ ให้กลับไปหน้ารายการแล้วเลือกใบใหม่'));
    await assert.rejects(() => h.useCase.pay(payer(), approved.id, command(0, { commandId: 'stale-pay' })), refusal('disbursement_version_conflict', 'ใบนี้ถูกแก้ไขจากที่อื่นแล้ว เปิดหน้านี้ใหม่ก่อนบันทึก'));
    for (const patch of [{ amount: '1' }, { paymentMethod: 'bad' }, { paidDate: '2026-02-30' }, { paidFromRef: 'x'.repeat(129) }, { paidFromRef: null }]) await assert.rejects(() => h.useCase.pay(payer(), approved.id, command(1, patch)), refusal('disbursement_invalid_input', 'ข้อมูลใบเตรียมจ่ายไม่ถูกต้อง ให้ตรวจรายการ วันที่และวิธีจ่าย แล้วลองบันทึกใหม่'));
    h.state.vouchers[0].status = 'DRAFT'; await assert.rejects(() => h.useCase.pay(payer(), approved.id, command(1)), refusal('disbursement_status_changed', 'สถานะของใบนี้เปลี่ยนไปแล้ว เปิดหน้านี้ใหม่เพื่อดูสถานะล่าสุด'));
    assert.equal(h.state.payments.length, 0);
  });

  it('replays the current paid or cancelled header, conflicts on another body and rejects pre-existing line payment keys', async () => {
    const h = harness(); const approved = await approvedDraft(h); const pay = command(1);
    const paid = await h.useCase.pay(payer(), approved.id, pay); assert.deepEqual(await h.useCase.pay(payer(), approved.id, pay), paid);
    assert.equal(h.state.payments.length, 1); assert.equal(h.state.events.length, 1);
    h.state.vouchers[0].status = 'CANCELLED'; assert.equal((await h.useCase.pay(payer(), approved.id, pay)).status, 'CANCELLED');
    await assert.rejects(() => h.useCase.pay(payer(), approved.id, { ...pay, paidFromRef: 'อีกบัญชี' }), refusal('disbursement_command_conflict', 'ข้อมูลไม่ตรงกับคำสั่งที่บันทึกไว้ ให้เปิดใบตรวจข้อมูล แล้วใช้คำสั่งใหม่ถ้าต้องการแก้ไข'));
    for (const status of ['RECORDED', 'VOIDED']) {
      const conflict = harness(); const v = await approvedDraft(conflict); conflict.state.payments.push({ companyId: 'company-1', idempotencyKey: `dv:${v.id}:${conflict.state.lines[0].id}`, status });
      await assert.rejects(() => conflict.useCase.pay(payer(), v.id, command(1)), refusal('disbursement_payment_key_conflict', 'พบรายการจ่ายของใบนี้อยู่แล้ว แต่ใบยังไม่แสดงว่าจ่ายแล้ว เปิดใบนี้ใหม่และตรวจประวัติการจ่ายก่อนลองอีกครั้ง'));
      assert.equal(conflict.state.payments.length, 1); assert.equal(conflict.state.vouchers[0].status, 'APPROVED');
    }
  });

  it('refuses inconsistent approved totals before creating any payment', async () => {
    const h = harness(); const approved = await approvedDraft(h);
    h.state.vouchers[0].totalAmount = '99.0000';
    await assert.rejects(() => h.useCase.pay(payer(), approved.id, command(1)), refusal('disbursement_payment_total_changed', 'ยอดรวมของใบไม่ตรงกับรายการที่อนุมัติ จึงบันทึกจ่ายไม่ได้ ให้ผู้จัดทำหรือผู้อนุมัติตรวจยอดก่อนส่งอนุมัติอีกครั้ง'));
    assert.equal(h.state.payments.length, 0); assert.equal(h.state.vouchers[0].status, 'APPROVED');
  });

  it('rolls back all document payments on payment, audit or outbox failure and maps timeouts to retry words', async () => {
    for (const failure of ['payment', 'audit', 'outbox', 'timeout', 'serialization', 'lock-timeout']) {
      const h = harness(); const approved = await approvedDraft(h, { lines: [{ expenseId: 'a', amount: '1' }, { expenseId: 'b', amount: '1' }] });
      if (failure === 'payment') { const create = h.client.expensePayment.create; h.client.expensePayment.create = async (input: any) => { if (h.state.payments.length) throw new Error('second payment unavailable'); return create(input); }; }
      if (failure === 'audit') (h.useCase as any).audit.log = async () => { throw new Error('audit unavailable'); };
      if (failure === 'outbox') h.client.outboxEvent.create = async () => { throw new Error('outbox unavailable'); };
      if (failure === 'timeout') h.client.expensePayment.create = async () => { throw Object.assign(new Error('timeout'), { code: 'P2028' }); };
      if (failure === 'serialization') h.client.expensePayment.create = async () => { throw Object.assign(new Error('serialization'), { code: 'P2034' }); };
      if (failure === 'lock-timeout') h.client.expensePayment.create = async () => { throw Object.assign(new Error('lock-timeout'), { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '55P03' } } } }); };
      await assert.rejects(() => h.useCase.pay(payer(), approved.id, command(1)), ['timeout', 'serialization', 'lock-timeout'].includes(failure) ? refusal('disbursement_payment_retry', 'บันทึกไม่สำเร็จ ยังไม่มีการบันทึกจ่ายรายการใด ลองอีกครั้ง') : /unavailable/);
      assert.equal(h.state.payments.length, 0); assert.equal(h.state.events.length, 0); assert.ok(h.state.expenses.every((e: any) => e.paidAmount === '0.0000' && e.reservedByDisbursementVoucherId === approved.id));
      assert.equal(h.state.vouchers[0].status, 'APPROVED'); assert.ok(h.state.lines.every((l: any) => !l.expensePaymentId));
    }
  });

  const issuer = (patch: any = {}) => context({ permissions: ['expense.disbursement.issue', 'expense.disbursement.read', 'expense.read'], ...patch });
  const direct = async (h: ReturnType<typeof harness>, expenseId = 'a', amount = '10') => new PrismaExpenseRepository({ client: h.client } as any).recordPaymentAtomic({
    companyId: 'company-1', expenseId, actorUserId: 'actor-1', scopes: {}, idempotencyKey: `direct-${expenseId}`, amount, paidAt: '2026-10-01', paymentMethod: 'CASH', bankAccountRef: 'หน้าร้าน' });

  it('issues a numbered direct-payment document once, copies actual payment facts and replays its current header', async () => {
    const h = harness(), result = await direct(h);
    const input = { commandId: 'issue-1', expenseId: 'a', paymentId: result.payment.id };
    const issued = await h.useCase.fromPayment(issuer(), input);
    assert.equal(issued.status, 'PAID'); assert.equal(issued.origin, 'DIRECT_PAYMENT'); assert.equal(issued.payeeBasis, 'SINGLE');
    assert.ok(h.state.locks.some((l: any) => l.sql.includes('SET "reservedByDisbursementVoucherId" = "reservedByDisbursementVoucherId"')), 'fence Serializable void snapshots without altering expense fields');
    assert.equal(issued.totalAmount, '10.0000'); assert.equal(issued.paidDate, '2026-10-01'); assert.equal(issued.paidMethod, 'CASH');
    assert.equal(issued.approvedByUserId, null); assert.equal(h.state.lines[0].coversPaymentId, result.payment.id);
    assert.equal(h.state.vouchers[0].paidSnapshotJson.actors.approver.userId, null);
    assert.equal(h.state.vouchers[0].paidSnapshotJson.directPayment, true);
    assert.deepEqual(await h.useCase.fromPayment(issuer({ userId: 'someone' }), { ...input, commandId: 'issue-2' }), issued);
    assert.equal(h.state.numbers.length, 1); assert.equal(h.state.vouchers.length, 1);
    await assert.rejects(() => h.useCase.fromPayment(issuer(), { ...input, expenseId: 'b' }), refusal('disbursement_command_conflict', 'ข้อมูลไม่ตรงกับคำสั่งที่บันทึกไว้ ให้เปิดใบตรวจข้อมูล แล้วใช้คำสั่งใหม่ถ้าต้องการแก้ไข'));
    h.state.vouchers[0].status = 'CANCELLED';
    assert.equal((await h.useCase.fromPayment(issuer(), input)).status, 'CANCELLED');
  });

  it('refuses issuance for cancelled, missing, unconfirmed, claim and unreadable sources with actionable sentences', async () => {
    for (const [change, code, sentence] of [
      ['voided', 'disbursement_issue_payment_cancelled', 'การจ่ายรายการนี้ถูกยกเลิกแล้ว จึงออกใบสำคัญจ่ายไม่ได้ เปิดรายจ่ายแล้วเลือกการจ่ายที่ยังมีผล'],
      ['cancelled', 'disbursement_issue_payment_cancelled', 'การจ่ายรายการนี้ถูกยกเลิกแล้ว จึงออกใบสำคัญจ่ายไม่ได้ เปิดรายจ่ายแล้วเลือกการจ่ายที่ยังมีผล'],
      ['claim', 'disbursement_issue_claim', 'รายการนี้จ่ายผ่านใบเบิก จึงออกใบสำคัญจ่ายจากหน้านี้ไม่ได้ ดูหลักฐานการจ่ายได้ที่ใบเบิก'],
      ['status', 'disbursement_expense_not_confirmed', 'รายการนี้ยังไม่ยืนยัน เปิดรายจ่ายและยืนยันก่อน'],
      ['branch', 'disbursement_expense_missing_branch', 'รายการนี้ยังไม่มีสาขา เปิดรายจ่ายเพื่อระบุสาขาก่อน'],
      ['missing', 'disbursement_issue_payment_not_found', 'ไม่พบการจ่ายที่เลือก ให้เปิดรายจ่ายใหม่และเลือกการจ่ายที่ยังมีผล'],
    ]) {
      const h = harness(), result = await direct(h);
      if (change === 'cancelled' || change === 'voided') h.state.payments[0].status = 'VOIDED';
      if (change === 'voided') h.state.expenses[0].status = 'VOIDED';
      if (change === 'claim') h.state.expenses[0].sourceReimbursementRequestId = 'claim';
      if (change === 'status') h.state.expenses[0].status = 'DRAFT';
      if (change === 'branch') h.state.expenses[0].branchId = null;
      await assert.rejects(() => h.useCase.fromPayment(issuer({ scopes: {} }), { commandId: 'issue', expenseId: 'a', paymentId: change === 'missing' ? 'absent' : result.payment.id }), refusal(code!, sentence!));
      assert.equal(h.state.vouchers.length, 0); assert.equal(h.state.numbers.length, 0);
    }
    const h = harness(), result = await direct(h), input = { commandId: 'issue', expenseId: 'a', paymentId: result.payment.id };
    for (const denied of [issuer({ scopes: { branchIds: ['branch-2'] } }), issuer({ companyId: 'other' }), issuer({ userId: 'someone', permissions: ['expense.disbursement.issue', 'expense.read_own'] })]) {
      await assert.rejects(() => h.useCase.fromPayment(denied, input), (e: any) => e.getResponse?.().code === 'disbursement_expense_unreadable');
    }
    for (const action of [() => h.useCase.fromPayment(issuer({ authProvider: 'line' }), input), () => h.useCase.reissue(issuer({ authProvider: 'line' }), 'absent', { commandId: 'reissue' })]) await assert.rejects(action, (e: any) => e.getResponse?.().code === 'disbursement_line_session_denied');
    await assert.rejects(() => h.useCase.fromPayment(context(), input), (e: any) => e.getResponse?.().code === 'disbursement_permission_denied');
    await assert.rejects(() => h.useCase.reissue(context(), 'absent', { commandId: 'reissue' }), (e: any) => e.getResponse?.().code === 'disbursement_permission_denied');
    for (const patch of [{ amount: '1' }, { commandId: '' }, { expenseId: null }, { paymentId: '' }]) await assert.rejects(() => h.useCase.fromPayment(issuer(), { ...input, ...patch } as any), (e: any) => e.getResponse?.().code === 'disbursement_invalid_input');
    for (const patch of [{ expectedVersion: 1 }, { commandId: '' }]) await assert.rejects(() => h.useCase.reissue(issuer(), 'absent', { commandId: 'reissue', ...patch }), (e: any) => e.getResponse?.().code === 'disbursement_invalid_input');
  });

  it('issues company-paid substitute payments and preserves the actual Thai paid day and expense version', async () => {
    const h = harness(), result = await direct(h, 'a', '104');
    h.state.expenses[0].substituteReceiptEvidences = [{ fundingSource: 'COMPANY', status: 'ISSUED' }];
    h.state.payments[0].paidAt = new Date('2026-09-30T18:00:00Z');
    const before = h.state.expenses[0].updatedAt.toISOString();
    const issued = await h.useCase.fromPayment(issuer({ permissions: ['expense.disbursement.issue', 'expense.read'] }), { commandId: 'substitute-issue', expenseId: 'a', paymentId: result.payment.id });
    assert.equal(issued.paidDate, '2026-10-01'); assert.equal(h.state.expenses[0].updatedAt.toISOString(), before);
    assert.ok(h.state.audits.some((a: any) => a.action === 'expense.disbursement.issue'));
    assert.equal(h.state.events.length, 0);
    assert.equal(h.state.expenses[0].reservedByDisbursementVoucherId, null);
    assert.equal(h.state.vouchers[0].paidSnapshotJson.lines[0].outstandingAfter, '0.0000');
  });

  it('reads an unchanged B6 paid snapshot with mixed tax ids without falsely reporting a source change', async () => {
    const h = harness([source('a'), source('b', { vendorTaxIdSnapshot: null })]);
    const approved = await approvedDraft(h, { lines: [{ expenseId: 'a', amount: '1' }, { expenseId: 'b', amount: '1' }], payeeConfirmed: true });
    const paid = await h.useCase.pay(payer(), approved.id, command(1));
    h.state.vouchers[0].paidSnapshotJson.lines.forEach((l: any) => { delete l.sourceHashAfterPaid; delete l.vendorTaxId; });
    assert.equal((await h.useCase.get(payer(), paid.id)).sourceChangedAfterPaid, false);
  });

  it('issuance rolls back its document, coverage and number when audit fails and maps lock timeouts to retry words', async () => {
    const h = harness(), result = await direct(h);
    const useCase = new DisbursementVoucherUseCase(h.repo, new PrismaExpenseRepository({ client: h.client } as any), new ListExpensesUseCase(new PrismaExpenseRepository({ client: h.client } as any)), { log: async () => { throw new Error('issue audit unavailable'); } } as any);
    await assert.rejects(() => useCase.fromPayment(issuer(), { commandId: 'issue-fail', expenseId: 'a', paymentId: result.payment.id }), /issue audit unavailable/);
    assert.equal(h.state.vouchers.length, 0); assert.equal(h.state.lines.length, 0); assert.equal(h.state.numbers.length, 0); assert.equal(h.state.commands.length, 0);
    h.client.$executeRaw = async () => { throw Object.assign(new Error('lock timeout'), { code: 'P2010', meta: { code: '55P03' } }); };
    await assert.rejects(() => h.useCase.fromPayment(issuer(), { commandId: 'issue-lock', expenseId: 'a', paymentId: result.payment.id }), refusal('disbursement_changed_retry', 'มีการทำรายการกับใบนี้หรือรายจ่ายในใบพร้อมกัน ระบบยังไม่ได้บันทึกสิ่งที่คุณเพิ่งทำ เปิดหน้านี้ใหม่แล้วลองอีกครั้ง'));
  });

  it('refuses a busy cross-command id without waiting while holding expense locks', async () => {
    const h = harness(), result = await direct(h);
    h.client.$queryRaw = async () => [{ locked: false }];
    await assert.rejects(() => h.useCase.fromPayment(issuer(), { commandId: 'busy-command', expenseId: 'a', paymentId: result.payment.id }), refusal('disbursement_changed_retry', 'มีการทำรายการกับใบนี้หรือรายจ่ายในใบพร้อมกัน ระบบยังไม่ได้บันทึกสิ่งที่คุณเพิ่งทำ เปิดหน้านี้ใหม่แล้วลองอีกครั้ง'));
    assert.equal(h.state.vouchers.length, 0); assert.equal(h.state.numbers.length, 0);
  });

  it('reissue freezes only its own slip evidence and never claims the cancelled document slip', async () => {
    const h = harness(), approved = await approvedDraft(h, { lines: [{ expenseId: 'a', amount: '1' }, { expenseId: 'b', amount: '2' }] });
    h.state.vouchers[0].slipAttachmentId = 'old-slip';
    h.state.attachmentLinks.push({ companyId: 'company-1', attachmentId: 'old-slip', targetType: 'disbursement_voucher', targetId: approved.id,
      purpose: 'expense.disbursement_voucher.slip', linkedByUserId: 'someone', createdAt: new Date('2026-10-11T03:00:00Z') });
    const paid = await h.useCase.pay(payer(), approved.id, command(1));
    const original = structuredClone(h.state.vouchers[0].paidSnapshotJson);
    assert.ok(original.paymentEvidence);
    Object.assign(h.state.vouchers[0], { status: 'CANCELLED', cancelledAfterPaid: true });
    h.state.lines.forEach((l: any) => { l.coversPaymentId = null; }); h.state.payments[0].status = 'VOIDED';
    const next = await h.useCase.reissue(issuer(), paid.id, { commandId: 'reissue-evidence' });
    const fresh = h.state.vouchers.find((v: any) => v.id === next.id);
    assert.equal(fresh.slipAttachmentId ?? null, null);
    assert.equal(fresh.paidSnapshotJson.paymentEvidence, null);
    assert.deepEqual(h.state.vouchers[0].paidSnapshotJson, original);
  });

  it('paid notices use the same short Thai date as the document screens', async () => {
    const h = harness(), approved = await approvedDraft(h);
    h.state.noticeInputs = [];
    await h.useCase.pay(payer({ userId: 'someone' }), approved.id, { ...command(1), paidDate: '2026-10-12' });
    assert.equal(h.state.noticeInputs[0].body, 'สมชาย บันทึกว่าจ่ายให้ ร้าน ก ยอด 10.10 บาท เมื่อ 12 ต.ค. 2569 ใบนี้เป็นใบสำคัญจ่ายแล้ว');
  });

  it('reissues only uncovered live payments once, links both documents and refuses when none remain', async () => {
    const h = harness(), approved = await approvedDraft(h, { lines: [{ expenseId: 'a', amount: '1' }, { expenseId: 'b', amount: '2' }] });
    const paid = await h.useCase.pay(payer(), approved.id, command(1));
    h.state.vouchers[0].status = 'CANCELLED'; h.state.vouchers[0].cancelledAfterPaid = true;
    h.state.lines.forEach((l: any) => { l.coversPaymentId = null; }); h.state.payments[0].status = 'VOIDED';
    const next = await h.useCase.reissue(issuer(), paid.id, { commandId: 'reissue-1' });
    assert.equal(next.origin, 'REISSUED'); assert.equal(next.replacesVoucherId, paid.id); assert.equal(next.totalAmount, '2.0000'); assert.notEqual(next.documentNumber, paid.documentNumber);
    assert.equal(h.state.lines.filter((l: any) => l.voucherId === next.id).length, 1);
    assert.deepEqual(await h.useCase.reissue(issuer(), paid.id, { commandId: 'reissue-2' }), next);
    const old = await h.useCase.get(issuer(), paid.id), fresh = await h.useCase.get(issuer(), next.id);
    assert.equal(old.canReissue, false); assert.equal(old.reissuedVoucher?.documentNumber, next.documentNumber); assert.equal(fresh.replacesVoucher?.documentNumber, paid.documentNumber);
    const empty = harness(), payment = await direct(empty), v = await empty.useCase.fromPayment(issuer(), { commandId: 'issue', expenseId: 'a', paymentId: payment.payment.id });
    empty.state.vouchers[0].status = 'CANCELLED'; empty.state.vouchers[0].cancelledAfterPaid = true; empty.state.payments[0].status = 'VOIDED'; empty.state.lines[0].coversPaymentId = null;
    await assert.rejects(() => empty.useCase.reissue(issuer(), v.id, { commandId: 'reissue' }), refusal('disbursement_reissue_empty', 'ไม่มีการจ่ายที่ยังมีผลเหลืออยู่ในใบนี้ จึงไม่ต้องออกใบใหม่'));
    await assert.rejects(() => h.useCase.reissue(issuer(), next.id, { commandId: 'wrong-state' }), (e: any) => e.getResponse?.().code === 'disbursement_status_changed');
  });

  it('detects changed paid sources without changing frozen snapshots and gives button instructions only to eligible callers', async () => {
    const h = harness(), approved = await approvedDraft(h), pay = command(1);
    const paid = await h.useCase.pay(payer(), approved.id, pay), snapshot = structuredClone(h.state.vouchers[0].paidSnapshotJson);
    assert.equal((await h.useCase.get(payer(), paid.id)).sourceChangedAfterPaid, false);
    h.state.expenses[0].updatedAt = new Date(); assert.equal((await h.useCase.get(payer(), paid.id)).sourceChangedAfterPaid, false);
    for (const patch of [{ vendorNameSnapshot: 'ร้านใหม่' }, { vendorTaxIdSnapshot: '1111111111111' }, { currency: 'USD' }, { netPayableAmount: '105' }, { outstandingAmount: '80' }, { status: 'DRAFT' }, { branchId: 'branch-2' }]) {
      const old = { ...h.state.expenses[0] }; Object.assign(h.state.expenses[0], patch);
      assert.equal((await h.useCase.get(payer({ scopes: {} }), paid.id)).sourceChangedAfterPaid, true); Object.assign(h.state.expenses[0], old);
    }
    assert.deepEqual(h.state.vouchers[0].paidSnapshotJson, snapshot);
    const manager = harness(), v = await approvedDraft(manager); manager.state.expenses[0].vendorNameSnapshot = 'ร้านใหม่';
    await assert.rejects(() => manager.useCase.pay(payer({ permissions: [...payer().permissions, 'expense.disbursement.prepare'] }), v.id, command(1)), refusal('disbursement_payment_source_changed', 'รายการ EXP-a ถูกเปลี่ยนแปลงหลังอนุมัติ จึงบันทึกจ่ายไม่ได้ กด "กลับไปแก้" เพื่อตรวจรายการใหม่ หรือยกเลิกใบนี้'));
    assert.equal(Reflect.getMetadata(PATH_METADATA, DisbursementVoucherController.prototype.fromPayment), 'from-payment');
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, DisbursementVoucherController.prototype.reissue), ['expense.disbursement.issue']);
  });

  it('gives an eligible recovery owner their own way out when approved sources changed', async () => {
    const h = harness(), approved = await approvedDraft(h);
    h.state.members.find((m: any) => m.userId === 'actor-1').status = 'DISABLED';
    h.state.expenses[0].vendorNameSnapshot = 'ร้านใหม่';
    const owner = payer({ userId: 'someone', roles: ['OWNER'], permissions: [...payer().permissions, 'expense.disbursement.prepare'] });
    await assert.rejects(() => h.useCase.pay(owner, approved.id, command(1)), refusal('disbursement_payment_source_changed', 'รายการ EXP-a ถูกเปลี่ยนแปลงหลังอนุมัติ จึงบันทึกจ่ายไม่ได้ กด "กลับไปแก้" เพื่อตรวจรายการใหม่ หรือยกเลิกใบนี้'));
    assert.equal((await h.useCase.get(owner, approved.id)).actions.withdraw, true);
  });

  it('registers approvers before the id reader and declares the five lifecycle permissions including either-right commands', () => {
    const names = Object.getOwnPropertyNames(DisbursementVoucherController.prototype);
    assert.ok(names.indexOf('approvers') < names.indexOf('get'));
    for (const [action, permission] of [['submit', 'prepare'], ['approve', 'approve'], ['return', 'approve'], ['pay', 'pay']] as const) {
      const handler = DisbursementVoucherController.prototype[action];
      assert.equal(Reflect.getMetadata(PATH_METADATA, handler), `:id/${action}`); assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), RequestMethod.POST);
      assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler), [`expense.disbursement.${permission}`]);
    }
    for (const action of ['withdraw', 'cancel'] as const) assert.deepEqual(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, DisbursementVoucherController.prototype[action]), ['expense.disbursement.prepare', 'expense.disbursement.approve']);
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, DisbursementVoucherController.prototype.approvers), ['expense.disbursement.prepare']);
  });
});

describe('disbursement voucher source readers', () => {
  const prepareCtx = { ...ctx, permissions: ['expense.disbursement.prepare', 'expense.read'] };
  const row = (id: string, patch: Record<string, unknown> = {}): any => ({
    id, companyId: 'company-1', branchId: 'branch-1', expenseNumber: `EXP-${id}`,
    status: 'CONFIRMED', currency: 'THB', vendorNameSnapshot: 'ร้าน ก', vendorTaxIdSnapshot: null,
    expenseDate: new Date('2026-10-01'), createdAt: new Date('2026-10-01'),
    grandTotalAmount: '107.0000', whtAmount: '3.0000', netPayableAmount: '104.0000', outstandingAmount: '104.0000',
    recordPaymentBlocker: null, reservedByDisbursementVoucherId: null, reservation: null, ...patch,
  });
  const reader = (rows: any[], capture?: (args: any[]) => void) => {
    const repo = { readDisbursementPayableExpenses: async (...args: any[]) => { capture?.(args); return rows; } } as any;
    return new ReadDisbursementVoucherSourcesUseCase(repo, new ListExpensesUseCase(repo));
  };

  it('a payee with nothing payable is not offered (owner 2026-10-15)', async () => {
    const result = await reader([
      row('reserved', { vendorNameSnapshot: 'ร้าน จ', outstandingAmount: '9999', reservedByDisbursementVoucherId: 'old', recordPaymentBlocker: 'disbursement_reserved' }),
      row('available', { vendorNameSnapshot: 'ร้าน ก', outstandingAmount: '10' }),
    ]).payees(prepareCtx, { pageSize: 1 });
    assert.equal(result.total, 1); assert.equal(result.data[0].displayName, 'ร้าน ก');
    assert.equal(result.data[0].allReserved, false);
    const none = await reader([row('reserved', { reservedByDisbursementVoucherId: 'old' })]).payees(prepareCtx, {});
    assert.equal(none.total, 0); assert.deepEqual(none.data, []);
  });

  it('reports excluded expense counts by existing blockers without hiding unnamed or partially paid bills', async () => {
    const useCase = reader([
      row('available', { outstandingAmount: '12' }),
      row('unnamed', { vendorNameSnapshot: null, outstandingAmount: '20' }),
      row('partial', { outstandingAmount: '40' }),
      row('reserved', { reservedByDisbursementVoucherId: 'other' }),
      row('claim', { recordPaymentBlocker: 'live_claim' }),
      row('advance', { recordPaymentBlocker: 'personal_advance' }),
      row('branch', { branchId: null, recordPaymentBlocker: 'missing_branch' }),
      row('foreign', { currency: 'USD' }),
    ]);
    const result = await useCase.payees(prepareCtx, { pageSize: 1 });
    const excluded = { reserved: 1, claim: 1, personal_advance: 1, missing_branch: 1, foreign_currency: 1 };
    assert.deepEqual(result.excludedExpenses, excluded);
    assert.equal(result.total, 2);
    assert.equal(result.data[0].expenseCount, 2);
    assert.equal(result.data[0].totalOutstanding, '52.0000');
    assert.deepEqual((await useCase.payees(prepareCtx, { search: 'ไม่พบ', page: 2 })).excludedExpenses, excluded);
    const bills = await useCase.payableExpenses(prepareCtx, {});
    assert.deepEqual(bills.filter(bill => bill.selectable).map(bill => bill.expenseId), ['available', 'unnamed', 'partial']);
  });

  it('pages tied payees into disjoint stable ten-row pages of payable payees only', async () => {
    const rows = Array.from({ length: 20 }, (_, index) => row(`page-${index}`, {
      vendorNameSnapshot: `ร้าน ${index}`, outstandingAmount: '100.0000',
      ...(index >= 15 ? { reservedByDisbursementVoucherId: 'other' } : {}),
    }));
    const first = await reader(rows).payees(prepareCtx, { page: 1, pageSize: 10 });
    const second = await reader([...rows].reverse()).payees(prepareCtx, { page: 2, pageSize: 10 });
    assert.equal(first.total, 15); assert.equal(second.total, 15);
    assert.equal(first.data.length, 10); assert.equal(second.data.length, 5);
    const combined = [...first.data, ...second.data];
    assert.equal(new Set(combined.map(payee => payee.payeeKey)).size, 15);
    assert.ok(combined.every(payee => !payee.allReserved));
    assert.ok(combined.every(payee => payee.expenseCount === 1 && payee.totalOutstanding === '100.0000'));
    assert.deepEqual((await reader([...rows].reverse()).payees(prepareCtx, { page: 1, pageSize: 10 })).data, first.data);
    assert.deepEqual((await reader(rows).payees(prepareCtx, { page: 2, pageSize: 10 })).data, second.data);
  });
  it('gives whitespace-only and absent payee names a readable fallback while retaining the tax ID', async () => {
    for (const vendorNameSnapshot of [null, '', ' \t\n ']) {
      const result = await reader([row('unnamed', { vendorNameSnapshot, vendorTaxIdSnapshot: '0123456789012' })]).payees(prepareCtx, {});
      assert.equal(result.data[0].displayName, 'ไม่มีชื่อผู้รับเงิน');
      assert.equal(result.data[0].taxId, '0123456789012');
    }
  });

  it('searches every typed payee-name word and puts a full prefix first before paging', async () => {
    const useCase = reader([
      row('unrelated', { vendorNameSnapshot: 'ร้านอื่น', vendorTaxIdSnapshot: '1234567890123', outstandingAmount: '900' }),
      row('contains', { vendorNameSnapshot: 'สาขา T3B ร้านวัสดุทวีทรัพย์', outstandingAmount: '500' }),
      row('prefix', { vendorNameSnapshot: 'T3B ร้านวัสดุทวีทรัพย์', outstandingAmount: '10' }),
      row('only-one-word', { vendorNameSnapshot: 'T3B ร้านอาหาร', outstandingAmount: '800' }),
    ]);
    const result = await useCase.payees(prepareCtx, { search: '  t3b ร้านวัสดุ  ', pageSize: 1 });
    assert.equal(result.total, 2);
    assert.equal(result.data[0].displayName, 'T3B ร้านวัสดุทวีทรัพย์');
    assert.equal((await useCase.payees(prepareCtx, { search: 't3b ร้านวัสดุ', page: 2, pageSize: 1 })).data[0].displayName, 'สาขา T3B ร้านวัสดุทวีทรัพย์');
    assert.equal((await useCase.payees(prepareCtx, { search: 'วัสดุ\tT3b' })).total, 2);
    assert.equal((await useCase.payees(prepareCtx, { search: 'ร้านวัสดุ ไม่มี' })).total, 0);
    assert.equal((await useCase.payees(prepareCtx, { search: '   ' })).total, 4);
  });

  it('filters the displayed newest payee name without dropping grouped expenses or changing eligibility', async () => {
    const useCase = reader([
      row('older', { vendorNameSnapshot: 'T3B ร้านวัสดุเก่า', vendorTaxIdSnapshot: '1234567890123' }),
      row('newer', { vendorNameSnapshot: 'ชื่อใหม่', vendorTaxIdSnapshot: '1234567890123', createdAt: new Date('2026-10-02') }),
    ]);
    assert.equal((await useCase.payees(prepareCtx, { search: 'T3B ร้านวัสดุ' })).total, 0);
    const found = await useCase.payees(prepareCtx, { search: 'ชื่อใหม่' });
    assert.equal(found.data[0].expenseCount, 2);
    assert.equal(found.data[0].selectableExpenseCount, 2);
    assert.equal(found.data[0].totalOutstanding, '208.0000');
  });

  it('groups dashed and Thai tax digits across names and branches, with exact outstanding totals and newest name', async () => {
    const rows = [row('a', { vendorTaxIdSnapshot: '0-1234-56789-01-2', outstandingAmount: '0.1000' }),
      row('b', { vendorTaxIdSnapshot: '๐๑๒๓๔๕๖๗๘๙๐๑๒', vendorNameSnapshot: 'ร้าน ข', branchId: 'branch-2', createdAt: new Date('2026-10-02'), outstandingAmount: '0.2000' }),
      row('c', { vendorTaxIdSnapshot: '0123456789012', outstandingAmount: '104.0001' })];
    const result = await reader(rows).payees(prepareCtx, {});
    assert.equal(result.total, 1);
    assert.equal(result.data[0].displayName, 'ร้าน ข');
    assert.equal(result.data[0].taxId, '0123456789012');
    assert.equal(result.data[0].expenseCount, 3);
    assert.equal(result.data[0].totalOutstanding, '104.3001');
    assert.equal(result.data[0].selectableExpenseCount, 3);
    assert.equal((await reader(rows).payees(prepareCtx, { search: '๐๑๒๓๔' })).total, 1);
  });

  it('returns the opaque payee group key and its kind on every payable row without normalizing away a typed tax id', async () => {
    const useCase = reader([
      row('tax-a', { vendorTaxIdSnapshot: '0-1234-56789-01-2' }),
      row('tax-b', { vendorTaxIdSnapshot: '๐๑๒๓๔๕๖๗๘๙๐๑๒', vendorNameSnapshot: 'ร้าน ข' }),
      row('name-a', { vendorNameSnapshot: 'ร้าน-ก' }), row('name-b', { vendorNameSnapshot: ' ร้าน ก ' }),
      row('invalid-tax', { vendorTaxIdSnapshot: '123', vendorNameSnapshot: 'ร้าน ก' }),
      row('nameless', { vendorNameSnapshot: null }),
    ]);
    const rows = await useCase.payableExpenses(prepareCtx, {});
    assert.equal(rows[0].payeeKeyKind, 'TAX_ID');
    assert.equal(rows[0].payeeKey, rows[1].payeeKey);
    assert.equal(rows[2].payeeKeyKind, 'NAME');
    assert.equal(rows[2].payeeKey, rows[3].payeeKey);
    assert.equal(rows[4].vendorTaxId, '123');
    assert.equal(rows[4].payeeKeyKind, 'NAME');
    assert.equal(rows[5].payeeKeyKind, null);
    for (const group of (await useCase.payees(prepareCtx, {})).data) {
      assert.ok(rows.some(row => row.payeeKey === group.payeeKey));
      assert.deepEqual((await useCase.payableExpenses(prepareCtx, { payeeKey: group.payeeKey })).map(row => row.payeeKey),
        rows.filter(row => row.payeeKey === group.payeeKey).map(row => row.payeeKey));
    }
  });

  it('keeps four fractional digits when over 200 maximum-sized expenses share a payee', async () => {
    const result = await reader(Array.from({ length: 201 }, (_, i) => row(String(i), { outstandingAmount: '99999999999999.9999' }))).payees(prepareCtx, {});
    assert.equal(result.data[0].totalOutstanding, '20099999999999999.9799');
    assert.equal(result.data[0].expenseCount, 201);
  });

  it('normalizes names, keeps nameless expenses separate and pages groups by largest outstanding', async () => {
    const rows = [row('a', { vendorNameSnapshot: ' ร้าน-ก ', outstandingAmount: '10' }), row('b', { outstandingAmount: '20' }),
      row('c', { vendorNameSnapshot: null, outstandingAmount: '50' }), row('d', { vendorNameSnapshot: '', outstandingAmount: '40' })];
    const result = await reader(rows).payees(prepareCtx, { page: 2, pageSize: 1 });
    assert.equal(result.total, 3);
    assert.equal(result.data[0].displayName, 'ไม่มีชื่อผู้รับเงิน');
    assert.equal(result.data[0].totalOutstanding, '40.0000');
    assert.equal((await reader(rows).payees(prepareCtx, { search: 'ร้าน ก' })).data[0].expenseCount, 2);
    assert.equal((await reader(rows).payees(prepareCtx, {})).data.length, 3);
  });

  it('F21 groups current vendor snapshots even when the OCR counterparty is stale', async () => {
    const rows = [row('old', { vendorCounterpartyId: 'shop-a', vendorTaxIdSnapshot: '0123456789012' }),
      row('corrected', { vendorCounterpartyId: 'shop-a', vendorNameSnapshot: 'ร้าน ข', vendorTaxIdSnapshot: '9876543210123' })];
    const useCase = reader(rows);
    const result = await useCase.payees(prepareCtx, {});
    assert.equal(result.total, 2);
    const shopB = result.data.find(p => p.taxId === '9876543210123')!;
    assert.deepEqual((await useCase.payableExpenses(prepareCtx, { payeeKey: shopB.payeeKey })).map(e => e.expenseId), ['corrected']);
    assert.deepEqual((await useCase.payableExpenses(prepareCtx, { search: 'EXP-corrected' })).map(e => e.expenseId), ['corrected']);
    assert.equal((await useCase.payableExpenses(prepareCtx, { search: '9-8765-43210-12-3' })).length, 1);
  });

  it('distinguishes same-shop expenses and reports zero selectable expenses when all are reserved', async () => {
    const rows = [row('a', { vendorDocumentNumber: 'INV-1', branchName: 'ตลาด', lines: [{ description: '  ซื้อของใช้  ' }], reservedByDisbursementVoucherId: 'dv-1' }),
      row('b', { lines: [{ description: ' ก'.repeat(90) }], reservedByDisbursementVoucherId: 'dv-2' }),
      row('c', { lines: [{ description: 'ค่าบริการ' }], vendorDocumentNumber: 'INV-3', reservedByDisbursementVoucherId: 'dv-3' }),
      row('d', { lines: [{ description: 'ค่าขนส่ง' }], reservedByDisbursementVoucherId: 'dv-4' })];
    const useCase = reader(rows), result = await useCase.payableExpenses(prepareCtx, {});
    assert.equal(result[0].description, 'ซื้อของใช้'); assert.equal(result[0].vendorInvoiceNumber, 'INV-1'); assert.equal(result[0].branchName, 'ตลาด');
    assert.equal(result[1].description!.length, 80);
    assert.deepEqual((await useCase.payees(prepareCtx, {})).data, []); // all reserved: the payee is not offered
  });

  it('reports every selection refusal and reservation number/preparer without requiring payment authority', async () => {
    const rows = [row('reserved', { reservedByDisbursementVoucherId: 'dv-1', reservation: { documentNumber: 'PV-1', preparerName: 'สมใจ' } }),
      row('draft-reserved', { reservedByDisbursementVoucherId: 'dv-2', reservation: { documentNumber: null, preparerName: 'สมใจ' } }),
      row('claim', { recordPaymentBlocker: 'live_claim' }), row('advance', { recordPaymentBlocker: 'personal_advance' }),
      row('branch', { branchId: null, recordPaymentBlocker: 'missing_branch' }), row('foreign', { currency: 'USD' }), row('ok')];
    const result = await reader(rows).payableExpenses(prepareCtx, {});
    assert.deepEqual(result.map(e => e.reasonCode), ['reserved', 'reserved', 'claim', 'personal_advance', 'missing_branch', 'foreign_currency', null]);
    assert.deepEqual(result.map(e => e.selectable), [false, false, false, false, false, false, true]);
    assert.deepEqual(result[0].reservation, { documentNumber: 'PV-1', preparerName: 'สมใจ' });
    assert.equal(result[6].whtAmount, '3.0000');
    assert.equal((await reader(rows).payees(prepareCtx, {})).data[0].selectableExpenseCount, 1);
  });

  it('uses the expense list own/related/all precedence, branch scope and caller company for both readers', async () => {
    for (const readPermissions of [['expense.read_own'], ['expense.read_related', 'expense.read_own'], ['expense.review', 'expense.read_own']]) {
      let args: any[] = [];
      const useCase = reader([], captured => { args = captured; });
      const own = { ...ctx, permissions: ['expense.disbursement.prepare', ...readPermissions] };
      for (const read of [() => useCase.payees(own, {}), () => useCase.payableExpenses(own, {})]) {
        await read();
        assert.equal(args[0].companyId, ctx.companyId);
        assert.equal(args[0].createdByUserId, readPermissions.length === 1 ? ctx.userId : undefined);
        assert.deepEqual(args[1], ctx.scopes);
        assert.equal(args[2], readPermissions.includes('expense.read_related') ? ctx.userId : undefined);
      }
      await assert.rejects(() => useCase.payees(own, { branchId: 'branch-other' }), ForbiddenException);
      await assert.rejects(() => useCase.payableExpenses(own, { branchId: 'branch-other' }), ForbiddenException);
    }
  });

  it('refuses LINE and missing prepare/read authority before reading either source', async () => {
    const useCase = reader([], () => { assert.fail('a refused session must not query'); });
    for (const denied of [{ ...prepareCtx, authProvider: 'line' }, { ...prepareCtx, permissions: ['expense.read'] },
      { ...prepareCtx, permissions: ['expense.disbursement.prepare'] }]) {
      await assert.rejects(() => useCase.payees(denied, {}), ForbiddenException);
      await assert.rejects(() => useCase.payableExpenses(denied, {}), ForbiddenException);
    }
  });

  it('rejects malformed search parameters without querying', async () => {
    const useCase = reader([], () => { assert.fail('invalid query must not reach the repository'); });
    await assert.rejects(() => useCase.payees(prepareCtx, { search: ['ร้าน'] } as any), BadRequestException);
    await assert.rejects(() => useCase.payableExpenses(prepareCtx, { branchId: ['branch-1'] } as any), BadRequestException);
    await assert.rejects(() => useCase.payableExpenses(prepareCtx, { payeeKey: {} } as any), BadRequestException);
  });

  it('registers both GET routes outside expenses with prepare permission and parses payee pagination', async () => {
    assert.equal(Reflect.getMetadata(PATH_METADATA, DisbursementVoucherController), 'companies/:companyId/disbursement-vouchers');
    for (const [method, path] of [['payees', 'payees'], ['payableExpenses', 'payable-expenses']] as const) {
      const handler = DisbursementVoucherController.prototype[method];
      assert.equal(Reflect.getMetadata(PATH_METADATA, handler), path);
      assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), RequestMethod.GET);
      assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler), ['expense.disbursement.prepare']);
    }
    const controller = new DisbursementVoucherController({
      payees: async (context: unknown, query: unknown) => { assert.equal(context, prepareCtx); return query; },
    } as any, {} as any);
    assert.deepEqual(await controller.payees(prepareCtx, { search: 'ร้าน', branchId: 'branch-1', page: '2', pageSize: '5' }),
      { search: 'ร้าน', branchId: 'branch-1', page: 2, pageSize: 5 });
  });

  it('returns only confirmed positive balances in the caller company, own scope and readable branches', async () => {
    const rows = [row('own', { createdByUserId: 'actor-1' }), row('someone', { createdByUserId: 'someone-else' }),
      row('central', { branchId: null, createdByUserId: 'actor-1' }), row('branch-other', { branchId: 'branch-other', createdByUserId: 'actor-1' }),
      row('company-other', { companyId: 'company-other', createdByUserId: 'actor-1' }), row('draft', { status: 'DRAFT', createdByUserId: 'actor-1' }),
      row('settled', { outstandingAmount: '0', createdByUserId: 'actor-1' })];
    const client = {
      expenseRecord: { findMany: async ({ where }: any) => rows.filter(e => e.companyId === where.companyId && e.status === where.status
        && Number(e.outstandingAmount) > where.outstandingAmount.gt && (!where.createdByUserId || e.createdByUserId === where.createdByUserId)
        && (!where.branchId || e.branchId === where.branchId) && (!where.OR || where.OR.some((b: any) => b.branchId === null ? e.branchId === null : b.branchId.in.includes(e.branchId))))
        .map(e => ({ ...e, substituteReceiptEvidences: [] })) },
      attachmentLink: { findMany: async () => [] }, reimbursementLine: { findMany: async () => [] }, branch: { findMany: async () => [] },
    };
    const repo = new PrismaExpenseRepository({ client } as any);
    const useCase = new ReadDisbursementVoucherSourcesUseCase(repo, new ListExpensesUseCase(repo));
    const own = { ...ctx, permissions: ['expense.disbursement.prepare', 'expense.read_own'] };
    assert.deepEqual((await useCase.payableExpenses(own, {})).map(e => e.expenseId), ['own', 'central']);
    assert.equal((await useCase.payees(own, {})).data[0].expenseCount, 1); // the central row has no branch: not payable by a voucher, not counted
    assert.deepEqual((await useCase.payableExpenses(prepareCtx, {})).map(e => e.expenseId), ['own', 'someone', 'central']);
    assert.equal((await useCase.payees(prepareCtx, { branchId: 'branch-1' })).data[0].expenseCount, 2);
    const payee = (await useCase.payees(prepareCtx, {})).data[0];
    const otherCompany = { ...prepareCtx, companyId: 'company-other' };
    assert.deepEqual((await useCase.payableExpenses(otherCompany, { payeeKey: payee.payeeKey })).map(e => e.expenseId), ['company-other']);
    assert.equal((await useCase.payees(otherCompany, {})).data[0].expenseCount, 1);
  });

  it('shares the direct-payment facts, including claim projections and personal advances', () => {
    const expense = { status: 'CONFIRMED', branchId: 'branch-1', outstandingAmount: '0.0001' };
    assert.equal(recordExpensePaymentBlocker(expense, false, null), null);
    assert.equal(recordExpensePaymentBlocker(expense, true, null), 'live_claim');
    assert.equal(recordExpensePaymentBlocker({ ...expense, sourceReimbursementRequestId: 'ended-claim' }, false, null), 'live_claim');
    assert.equal(recordExpensePaymentBlocker(expense, false, 'PERSONAL_ADVANCE'), 'personal_advance');
    assert.equal(recordExpensePaymentBlocker({ ...expense, branchId: null }, false, null), 'missing_branch');
    assert.equal(recordExpensePaymentBlocker({ ...expense, status: 'DRAFT' }, false, null), 'not_confirmed');
    assert.equal(recordExpensePaymentBlocker({ ...expense, outstandingAmount: '0' }, false, null), 'no_balance');
  });

  it('reads over 200 minimal rows and checks live claims through expense ids and shared attachments', async () => {
    let query: any;
    const rows = Array.from({ length: 201 }, (_, i) => ({ ...row(String(i)), substituteReceiptEvidences: [] }));
    rows[2].substituteReceiptEvidences = [{ fundingSource: 'PERSONAL_ADVANCE' }] as any;
    rows[3].reservedByDisbursementVoucherId = 'dv-1';
    rows[4].sourceReimbursementRequestId = 'claim-source';
    const client: any = {
      expenseRecord: { findMany: async (input: any) => { query = input; return rows; } },
      branch: { findMany: async ({ where }: any) => { assert.equal(where.companyId, 'company-1'); assert.deepEqual(where.id.in, ['branch-1']); return [{ id: 'branch-1', name: 'ตลาด' }]; } },
      attachmentLink: { findMany: async ({ where }: any) => { assert.equal(where.companyId, 'company-1'); return [{ targetId: '1', attachmentId: 'shared' }]; } },
      reimbursementLine: { findMany: async ({ where }: any) => {
        assert.equal(where.companyId, 'company-1');
        assert.deepEqual(where.request.status.notIn, ['DRAFT', 'REJECTED', 'CANCELLED', 'VOIDED']);
        assert.deepEqual(where.OR[0].linkedExpenseId.in, rows.map(e => e.id));
        assert.deepEqual(where.OR[1].attachmentId.in, ['shared']);
        return [{ linkedExpenseId: '0', attachmentId: null }, { linkedExpenseId: null, attachmentId: 'shared' }];
      } },
      disbursementVoucher: { findMany: async ({ where, select }: any) => {
        assert.deepEqual(where, { companyId: 'company-1', id: { in: ['dv-1'] } });
        assert.deepEqual(Object.keys(select).sort(), ['documentNumber', 'id', 'preparedByUserId', 'status']);
        return [{ id: 'dv-1', documentNumber: 'PV-1', preparedByUserId: 'preparer-1' }];
      } },
      user: { findMany: async ({ where }: any) => {
        assert.equal(where.memberships.some.companyId, 'company-1');
        return [{ id: 'preparer-1', displayName: 'สมใจ' }];
      } },
    };
    const repo = new PrismaExpenseRepository({ client } as any);
    const result = await repo.readDisbursementPayableExpenses({ companyId: 'company-1', createdByUserId: 'actor-1' }, ctx.scopes, 'actor-1');
    assert.equal(result.length, 201);
    assert.equal(query.take, undefined);
    assert.equal(query.skip, undefined);
    assert.equal(query.where.companyId, 'company-1');
    assert.equal(query.where.status, 'CONFIRMED');
    assert.deepEqual(query.where.outstandingAmount, { gt: 0 });
    assert.equal(query.where.createdByUserId, 'actor-1');
    assert.deepEqual(query.where.OR, [{ branchId: { in: ['branch-1'] } }, { branchId: null }]);
    assert.deepEqual(query.where.AND, [expenseRelatedToUserWhere('actor-1')]);
    assert.equal(query.select.vendorCounterpartyId, undefined);
    assert.equal(query.select.note, undefined);
    assert.equal(query.select.vendorDocumentNumber, true);
    assert.deepEqual(query.select.lines, { orderBy: { lineNumber: 'asc' }, take: 1, select: { description: true } });
    assert.equal(result[0].branchName, 'ตลาด');
    assert.deepEqual(query.select.substituteReceiptEvidences, { orderBy: { version: 'desc' }, take: 1, select: { fundingSource: true } });
    assert.deepEqual(result.slice(0, 5).map(e => e.recordPaymentBlocker), ['live_claim', 'live_claim', 'personal_advance', null, 'live_claim']);
    assert.deepEqual(result[3].reservation, { voucherId: null, documentNumber: 'PV-1', preparerName: 'สมใจ' });
  });
});


it('disbursement notice titles start with the event and keep the document number; reminders keep their own title', () => {
  const titles = Object.fromEntries(Object.entries(DISBURSEMENT_VOUCHER_NOTICE_WORDS).filter(([key]) => key.endsWith('Title')));
  assert.deepEqual(titles, {
    pendingTitle: 'รออนุมัติ: ใบเตรียมจ่ายเลขที่ {number}',
    reminderTitle: 'เตือนอีกครั้ง: ใบเตรียมจ่ายเลขที่ {number} รออนุมัติ',
    payerTitle: 'รอคุณบันทึกจ่าย: ใบเตรียมจ่ายเลขที่ {number}',
    approvedTitle: 'อนุมัติแล้ว รอจ่าย: ใบเตรียมจ่ายเลขที่ {number}',
    returnedTitle: 'ส่งกลับให้แก้: ใบเตรียมจ่ายเลขที่ {number}',
    paidTitle: 'จ่ายแล้ว: ใบสำคัญจ่ายเลขที่ {number}',
    cancelledTitle: 'ยกเลิก: ใบเลขที่ {number}',
  });
});

describe('expense draft document read model', () => {
  it('extends the reservation source with a draft and only exposes its link to a permitted viewer', async () => {
    const { readDisbursementReservations } = await import('../../infrastructure/expense-void-blocker');
    const calls: any[] = [];
    const db: any = { user: { findMany: async () => [{ id: 'preparer', displayName: 'ผู้จัดทำ' }] },
      disbursementVoucher: { findMany: async (query: any) => { calls.push(query); return query.select.lines ? [{ id: 'draft', companyId: 'co', branchId: 'b1', status: 'DRAFT', documentNumber: null, preparedByUserId: 'preparer', lines: [{ expenseId: 'expense' }] }] : [{ id: 'draft' }]; } } };
    const loaded = [{ id: 'expense', reservedByDisbursementVoucherId: null }];
    const readable = await readDisbursementReservations(db, 'co', ['expense'], { companyId: 'co', scopes: { branchIds: ['b1'] }, permissions: ['expense.disbursement.read'] }, loaded, true);
    assert.equal(readable.get('expense')?.status, 'DRAFT'); assert.equal(readable.get('expense')?.preparerName, 'ผู้จัดทำ'); assert.equal(readable.get('expense')?.canOpen, true);
    assert.ok(calls[0].where.OR.some((part: any) => part.status === 'DRAFT' && part.lines.some.expenseId.in.includes('expense')));
    const hidden = await readDisbursementReservations(db, 'co', ['expense'], { companyId: 'co', scopes: {}, permissions: [] }, loaded, true);
    assert.equal(hidden.get('expense')?.canOpen, false);
  });
});


describe('voucher list query DTO', () => {
  it('defaults newest, accepts oldest and refuses other directions at the HTTP boundary', async () => {
    const { ValidationPipe } = await import('@nestjs/common');
    const { GLOBAL_VALIDATION_PIPE_OPTIONS } = await import('../../../../common/pipes/validation-pipe.options');
    const { DisbursementVoucherListQueryDto } = await import('../../presentation/http/disbursement-voucher.dtos');
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    const metadata = { type: 'query' as const, metatype: DisbursementVoucherListQueryDto };
    assert.equal((await pipe.transform({}, metadata)).order, 'newest');
    assert.equal((await pipe.transform({ order: 'oldest', page: '2', pageSize: '10', q: 'ร้าน' }, metadata)).order, 'oldest');
    for (const order of ['ASC', '', ['newest', 'oldest'], null]) await assert.rejects(pipe.transform({ order }, metadata), BadRequestException);
  });
});


describe('voucher account reveal HTTP boundary', () => {
  it('allows prepare through the route guard and validates an explicit prefill purpose', async () => {
    assert.deepEqual(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, DisbursementVoucherController.prototype.revealAccount),
      ['expense.disbursement.prepare', 'expense.disbursement.approve', 'expense.disbursement.pay']);
    const { ValidationPipe } = await import('@nestjs/common');
    const { GLOBAL_VALIDATION_PIPE_OPTIONS } = await import('../../../../common/pipes/validation-pipe.options');
    const { RevealDisbursementVoucherAccountQueryDto } = await import('../../presentation/http/disbursement-voucher.dtos');
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    const metadata = { type: 'query' as const, metatype: RevealDisbursementVoucherAccountQueryDto };
    assert.equal((await pipe.transform({}, metadata)).purpose, undefined);
    assert.equal((await pipe.transform({ purpose: 'prefill' }, metadata)).purpose, 'prefill');
    for (const purpose of ['edit', '', ['prefill'], null]) await assert.rejects(pipe.transform({ purpose }, metadata), BadRequestException);
  });
});

describe('expense activity history authorization and projection', () => {
  it('reuses detail permission, branch, own/related and company checks before reading any audit rows', async () => {
    let historyReads = 0;
    let related = false;
    const repo = {
      findByIdWithRelations: async (companyId: string) => companyId === 'company-1' ? detail : null,
      isUserRelatedToExpense: async () => related,
      findMemberDisplayName: async (companyId: string, userId: string) => {
        assert.equal(companyId, 'company-1'); assert.equal(userId, detail.createdByUserId); return 'ผู้สร้าง';
      },
      listExpenseHistory: async (companyId: string, expenseId: string, page: number) => {
        historyReads++;
        assert.equal(companyId, 'company-1'); assert.equal(expenseId, detail.id);
        return { data: [], total: 0, page, pageSize: 20 };
      },
    } as any;
    const history = new GetExpenseHistoryUseCase(new GetExpenseUseCase(repo), repo);
    await assert.rejects(() => history.execute(ctx, detail.id), ForbiddenException);
    await assert.rejects(() => history.execute({ ...ctx, permissions: ['expense.read_own'] }, detail.id), ForbiddenException);
    await assert.rejects(() => history.execute({ ...ctx, companyId: 'company-2', permissions: ['expense.read'] }, detail.id), NotFoundException);
    await assert.rejects(() => history.execute({ ...ctx, scopes: { branchIds: ['branch-2'] }, permissions: ['expense.read'] }, detail.id), ForbiddenException);
    await assert.rejects(() => history.execute({ ...ctx, permissions: [] }, detail.id), ForbiddenException);
    assert.equal(historyReads, 0);
    related = true;
    assert.equal((await history.execute(ctx, detail.id, 2)).page, 2);
    assert.equal((await history.execute({ ...ctx, userId: detail.createdByUserId, permissions: ['expense.read_own'] }, detail.id)).page, 1);
    assert.equal((await history.execute({ ...ctx, permissions: ['expense.read'] }, detail.id)).pageSize, 20);
    for (const page of [0, -1, NaN, Infinity, 1.5, 100_001]) await assert.rejects(() => history.execute(ctx, detail.id, page), BadRequestException);
    assert.equal(historyReads, 3);
  });

  it('rejects commercial access loss before querying document activity', async () => {
    let reads = 0;
    const repo = {
      commercialAccessDb: { company: { findUnique: async () => ({ status: 'DISABLED', planTerm: null }) } },
      listExpenseHistory: async () => { reads++; },
    } as any;
    const history = new GetExpenseHistoryUseCase(new GetExpenseUseCase(repo), repo);
    await assert.rejects(() => history.execute({ ...ctx, permissions: ['expense.read'] }, detail.id), ForbiddenException);
    assert.equal(reads, 0);
  });

  it('returns the actual expense creator independently of viewer, returned events, and empty history pages', async () => {
    let creatorName: string | null = 'ผู้สร้างจริง';
    const creatorLookups: string[] = [];
    const repo = {
      findByIdWithRelations: async () => detail,
      listExpenseHistory: async (_companyId: string, _expenseId: string, page: number) => ({
        data: page === 1 ? [{ actorDisplayName: 'คนแก้ไขล่าสุด' }] : [], total: 1, page, pageSize: 20,
      }),
      findMemberDisplayName: async (companyId: string, userId: string) => {
        assert.equal(companyId, 'company-1'); creatorLookups.push(userId); return creatorName;
      },
    } as any;
    const history = new GetExpenseHistoryUseCase(new GetExpenseUseCase(repo), repo);
    const viewer = { ...ctx, permissions: ['expense.read'] };
    assert.equal((await history.execute(viewer, detail.id, 1)).creatorDisplayName, 'ผู้สร้างจริง');
    assert.equal((await history.execute(viewer, detail.id, 4)).creatorDisplayName, 'ผู้สร้างจริง');
    assert.deepEqual(creatorLookups, [detail.createdByUserId, detail.createdByUserId]);
    assert.notEqual(detail.createdByUserId, viewer.userId);
    creatorName = null;
    assert.equal((await history.execute(viewer, detail.id, 4)).creatorDisplayName, null);
  });

  it('bounds targets to this company and its persisted payment/substitute IDs, and strips private audit data', async () => {
    let query: any;
    let countWhere: any;
    const client: any = {
      expensePayment: { findMany: async ({ where, select }: any) => {
        assert.deepEqual(where, { companyId: 'company-1', expenseId: 'expense-1' }); assert.deepEqual(select, { id: true }); return [{ id: 'payment-1' }];
      } },
      expenseSubstituteReceiptEvidence: { findMany: async ({ where }: any) => {
        assert.deepEqual(where, { companyId: 'company-1', expenseId: 'expense-1' }); return [{ id: 'evidence-1' }];
      } },
      auditLog: {
        findMany: async (args: any) => {
          if (Object.keys(args.select).length === 1) {
            assert.equal(args.where.companyId, 'company-1');
            assert.deepEqual(args.where.OR, [
              { targetType: 'expense_record', targetId: 'expense-1' },
              { targetType: 'expense_payment', targetId: { in: ['payment-1'] } },
              { targetType: 'expense_substitute_receipt', targetId: { in: ['evidence-1'] } },
            ]);
            assert.deepEqual(args.where.action, { in: ['expense.confirm', 'expense.void'] });
            assert.deepEqual(args.where.AND, [{ OR: [
              { metadataJson: { path: ['authority'], equals: 'REIMBURSEMENT_APPROVAL' } },
              { metadataJson: { path: ['authority'], equals: 'REIMBURSEMENT_CANCELLATION' } },
            ] }]);
            return [{ id: 'automatic-reimbursement' }];
          }
          if (args.where.action?.in?.includes('expense.upload.complete')) {
            assert.deepEqual(args.where, { companyId: 'company-1', targetType: 'expense_record', targetId: 'expense-1', result: 'SUCCESS',
              action: { in: ['expense.upload.complete', 'expense.create', 'expense.line_upload.receive'] } });
            return [];
          }
          query = args; return [
          { id: 'audit-1', action: 'expense.review.update', result: 'SUCCESS', actorType: 'USER', actor: { displayName: 'ผู้ตรวจ', email: 'secret@example.com' },
            createdAt: new Date(VERSION_FOR_HISTORY), requestId: 'private', metadataJson: { token: 'secret', expenseHistoryChanges: { note: { before: null, after: 'saved' } } } },
          { id: 'audit-2', action: 'expense.upload.complete', result: 'FAILED', actorType: 'CRM_CUSTOMER', actor: { displayName: 'do not expose' }, createdAt: new Date(VERSION_FOR_HISTORY), metadataJson: { before: 'legacy' } },
        ]; },
        count: async ({ where }: any) => { countWhere = where; return 22; },
      },
      $transaction: async (read: (tx: any) => Promise<unknown>, options: unknown) => {
        assert.deepEqual(options, { isolationLevel: 'RepeatableRead' });
        return read(client);
      },
    };
    const result = await new PrismaExpenseRepository({ client } as any).listExpenseHistory('company-1', 'expense-1', 2);
    assert.deepEqual(query.where, { companyId: 'company-1', OR: [
      { targetType: 'expense_record', targetId: 'expense-1' },
      { targetType: 'expense_payment', targetId: { in: ['payment-1'] } },
      { targetType: 'expense_substitute_receipt', targetId: { in: ['evidence-1'] } },
    ], actorType: { in: ['USER', 'CRM_CUSTOMER'] },
      action: { notIn: ['tax.document_tax.finalize', 'expense.substitute_receipt.source_refreshed', 'expense.ocr.request', 'expense.line_draft.start', 'expense.line_draft.transition', 'expense.upload_intent.create'] },
      NOT: { action: { startsWith: 'journey.' } }, id: { notIn: ['automatic-reimbursement'] },
    });
    assert.deepEqual(countWhere, query.where);
    for (const humanAction of ['expense.create', 'expense.line_draft.answer', 'expense.line_ai.draft_update',
      'expense.evidence.review', 'expense.confirm', 'expense.void', 'expense.upload.complete', 'expense.substitute_receipt.certify']) {
      assert.ok(!query.where.action.notIn.includes(humanAction), humanAction);
    }
    assert.deepEqual(query.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
    assert.equal(query.skip, 20); assert.equal(query.take, 20);
    assert.deepEqual(query.select.actor, { select: { displayName: true } });
    assert.deepEqual(Object.keys(result.data[0]!).sort(), ['action', 'actorDisplayName', 'actorType', 'changes', 'createdAt', 'id', 'result']);
    assert.deepEqual(result.data[0]!.changes, [{ field: 'note', before: null, after: 'saved' }]);
    assert.equal(result.data[1]!.actorDisplayName, null); assert.deepEqual(result.data[1]!.changes, []);
    assert.equal(result.total, 22); assert.equal(result.page, 2); assert.equal(result.pageSize, 20);
    assert.ok(!JSON.stringify(result).includes('secret'));
    assert.ok(!JSON.stringify(result).includes('private'));
  });

  it('projects one upload only on a proven completion match, before pagination/count, without losing standalone uploads or text creation', async () => {
    const event = (id: string, action: string, requestId: string, extra: Record<string, unknown> = {}) => ({
      id, companyId: 'company-1', targetType: 'expense_record', targetId: 'expense-1', action,
      actorType: 'USER', actorUserId: 'user-1', actorRefId: null, requestId, result: 'SUCCESS', metadataJson: null,
      actor: { displayName: 'ผู้ทำรายการ' }, createdAt: new Date(VERSION_FOR_HISTORY), ...extra,
    });
    const events = [
      event('file-complete', 'expense.upload.complete', 'file-1'),
      event('second-file-same-request', 'expense.upload.complete', 'file-1'),
      event('file-follow-on', 'expense.line_upload.receive', 'file-1'),
      event('standalone', 'expense.line_upload.receive', 'standalone'),
      event('intent', 'expense.upload_intent.create', 'file-1'),
      event('other-actor', 'expense.line_upload.receive', 'file-1', { actorUserId: 'user-2' }),
      event('other-request', 'expense.line_upload.receive', 'other-request'),
      event('create-text', 'expense.create', 'text-1'),
      event('text-follow-on', 'expense.line_upload.receive', 'text-1', { metadataJson: { kind: 'text_note' } }),
      event('legacy-text', 'expense.line_upload.receive', 'old-text', { metadataJson: { kind: 'text_note' } }),
      event('failed-receive', 'expense.line_upload.receive', 'file-1', { result: 'FAILED' }),
      event('denied-receive', 'expense.line_upload.receive', 'file-1', { result: 'DENIED' }),
      event('unknown-actor', 'expense.line_upload.receive', 'file-1', { actorUserId: null }),
      event('no-request', 'expense.line_upload.receive', ''),
      event('crm-complete', 'expense.upload.complete', 'crm-file', { actorType: 'CRM_CUSTOMER', actorUserId: null, actorRefId: 'customer-1' }),
      event('crm-follow-on', 'expense.line_upload.receive', 'crm-file', { actorType: 'CRM_CUSTOMER', actorUserId: null, actorRefId: 'customer-1' }),
      event('other-crm', 'expense.line_upload.receive', 'crm-file', { actorType: 'CRM_CUSTOMER', actorUserId: null, actorRefId: 'customer-2' }),
      event('other-actor-kind', 'expense.line_upload.receive', 'crm-file', { actorUserId: 'customer-1' }),
      event('failed-complete', 'expense.upload.complete', 'failed-complete', { result: 'FAILED' }),
      event('receive-after-failure', 'expense.line_upload.receive', 'failed-complete'),
      event('other-company', 'expense.upload.complete', 'standalone', { companyId: 'company-2' }),
      event('other-expense', 'expense.upload.complete', 'standalone', { targetId: 'expense-2' }),
      // Same timestamp and actor, distinct actual uploads: both must survive, even across pages.
      ...Array.from({ length: 22 }, (_, i) => event(`repeated-${String(i).padStart(2, '0')}`, 'expense.upload.complete', `request-${i}`)),
    ];
    const originalCount = events.length;
    const queries: any[] = [];
    const inExpense = (row: typeof events[number]) => row.companyId === 'company-1' && row.targetId === 'expense-1';
    const visible = (where: any) => events.filter(row => inExpense(row) && where.actorType.in.includes(row.actorType)
      && !where.action.notIn.includes(row.action) && !row.action.startsWith(where.NOT.action.startsWith) && !where.id?.notIn.includes(row.id));
    const client: any = {
      expensePayment: { findMany: async () => [] }, expenseSubstituteReceiptEvidence: { findMany: async () => [] },
      auditLog: {
        findMany: async (query: any) => {
          if (Object.keys(query.select).length === 1) return [];
          if (query.where.action.in) {
            assert.equal(query.where.companyId, 'company-1'); assert.equal(query.where.targetId, 'expense-1');
            assert.equal(query.where.targetType, 'expense_record'); assert.equal(query.where.result, 'SUCCESS');
            return events.filter(row => inExpense(row) && row.result === 'SUCCESS' && query.where.action.in.includes(row.action));
          }
          queries.push(query);
          assert.deepEqual(query.where.id.notIn.sort(), ['crm-follow-on', 'file-follow-on', 'text-follow-on']);
          return visible(query.where).sort((a, b) => b.id.localeCompare(a.id)).slice(query.skip, query.skip + query.take);
        },
        count: async ({ where }: any) => { assert.deepEqual(where, queries.at(-1).where); return visible(where).length; },
      },
      $transaction: async (read: (tx: any) => Promise<unknown>, options: unknown) => {
        assert.deepEqual(options, { isolationLevel: 'RepeatableRead' }); return read(client);
      },
    };
    const repo = new PrismaExpenseRepository({ client } as any);
    const first = await repo.listExpenseHistory('company-1', 'expense-1', 1);
    const second = await repo.listExpenseHistory('company-1', 'expense-1', 2);
    assert.equal(first.total, originalCount - 6); assert.equal(second.total, first.total);
    assert.equal(first.data.length, 20); assert.equal(second.data.length, first.total - 20);
    const data = [...first.data, ...second.data];
    assert.equal(new Set(data.map(row => row.id)).size, first.total);
    for (const id of ['standalone', 'other-actor', 'other-request', 'unknown-actor', 'no-request', 'other-crm', 'other-actor-kind',
      'failed-complete', 'receive-after-failure', 'failed-receive', 'denied-receive', 'second-file-same-request', 'repeated-00', 'repeated-21']) {
      assert.ok(data.some(row => row.id === id), id);
    }
    assert.equal(data.find(row => row.id === 'legacy-text')!.action, 'expense.create');
    assert.equal(data.find(row => row.id === 'standalone')!.action, 'expense.line_upload.receive');
    assert.equal(data.filter(row => row.action === 'expense.create').length, 2);
    assert.equal(events.length, originalCount);
  });

});
const VERSION_FOR_HISTORY = '2026-10-30T10:00:00.000Z';

it('MC2 LINE voucher list keeps web results and read/branch guards while unsigned writes stay refused', async () => {
  const reads: any[] = [];
  const repo: any = { list: async (scope: any, query: any) => { reads.push({ scope, query }); return { rows: [], counts: {}, sums: {}, total: 0, amountsInEffect: new Map() }; } };
  const expenses: any = { readScope: (actor: any, branchId?: string) => {
    if (branchId && !actor.scopes.branchIds.includes(branchId)) throw new ForbiddenException();
    return { filter: {}, scope: { relatedUserId: actor.userId } };
  } };
  const useCase = new DisbursementVoucherUseCase(repo, {} as any, expenses, {} as any);
  const actor = { ...ctx, permissions: ['expense.disbursement.read', 'expense.disbursement.prepare', 'expense.disbursement.approve', 'expense.disbursement.pay', 'expense.disbursement.issue'] };
  const query = { page: 1, pageSize: 100, branchId: 'branch-1' };
  const web = await useCase.list(actor, query);
  const line = { ...actor, authProvider: 'line' };
  assert.deepEqual(await useCase.listForLine(line, query), web);
  assert.deepEqual(reads[1], reads[0]);
  await assert.rejects(useCase.listForLine({ ...line, permissions: [] }, query), ForbiddenException);
  await assert.rejects(useCase.listForLine(line, { ...query, branchId: 'other' }), ForbiddenException);
  for (const write of [() => useCase.create(line, {} as any), () => useCase.approve(line, 'voucher', {} as any),
    () => useCase.pay(line, 'voucher', {} as any), () => useCase.fromPayment(line, {} as any)]) {
    await assert.rejects(write, (error: any) => error.getResponse().code === 'disbursement_line_session_denied');
  }
});

it('MC1 LINE creator picker reads only its own records for the two permitted actions', async () => {
  const reads: any[] = [];
  const repo: any = { listExpenses: async (...args: any[]) => { reads.push(args); return { data: [], total: 0, page: 1, pageSize: 100 }; } };
  const useCase = new ListExpensesUseCase(repo);
  const actor = { ...ctx, authProvider: 'line', permissions: ['expense.create', 'expense.update'] };
  for (const lineAction of ['MARK_READY', 'DELETE_DRAFT'] as const) {
    await useCase.execute(actor, { pageSize: 100, createdByUserId: 'another' }, { lineAction });
    assert.equal(reads.at(-1)[0].createdByUserId, actor.userId);
    assert.equal(reads.at(-1)[0].companyId, actor.companyId);
    assert.deepEqual(reads.at(-1)[1], actor.scopes);
  }
  await assert.rejects(useCase.execute(actor, {}), ForbiddenException);
  await assert.rejects(useCase.execute({ ...actor, authProvider: 'watchdog' }, {}, { lineAction: 'MARK_READY' }), ForbiddenException);
  await assert.rejects(useCase.execute({ ...actor, permissions: ['expense.create'] }, {}, { lineAction: 'MARK_READY' }), ForbiddenException);
  await assert.rejects(useCase.execute(actor, { branchId: 'other' }, { lineAction: 'DELETE_DRAFT' }), ForbiddenException);
});
