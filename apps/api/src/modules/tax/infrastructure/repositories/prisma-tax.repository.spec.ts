import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PrismaTaxRepository } from './prisma-tax.repository.js';

const issueInput = {
  companyId: 'company-1',
  taxPeriodId: 'period-1',
  severity: 'BLOCKING' as const,
  issueCode: 'INPUT_VAT_NOT_CLAIMABLE',
  description: 'Input VAT recorded as non-claimable',
  sourceType: 'expense.record',
  sourceId: 'expense-1',
};

const existingRow = {
  id: 'issue-1', companyId: 'company-1', taxPeriodId: 'period-1', taxEventId: null,
  severity: 'BLOCKING', status: 'OPEN', issueCode: 'INPUT_VAT_NOT_CLAIMABLE',
  description: 'Input VAT recorded as non-claimable', sourceType: 'expense.record', sourceId: 'expense-1',
  resolvedAt: null, resolvedNote: null, resolvedByUserId: null,
  createdAt: new Date('2026-07-01T00:00:00.000Z'), updatedAt: new Date('2026-07-01T00:00:00.000Z'),
};

function repoWith(findFirstResult: unknown) {
  let findFirstWhere: any;
  const created: any[] = [];
  const client = {
    taxReviewIssue: {
      findFirst: async (query: any) => { findFirstWhere = query.where; return findFirstResult; },
      create: async (query: any) => { created.push(query.data); return { ...existingRow, ...query.data, id: 'issue-new' }; },
    },
  };
  return { repo: new PrismaTaxRepository({ client } as any), created, whereUsed: () => findFirstWhere };
}

describe('PrismaTaxRepository createIssue dedupe', () => {
  it('returns the existing OPEN issue with the same (company, period, code, source) without creating', async () => {
    const h = repoWith(existingRow);

    const record = await h.repo.createIssue(issueInput);

    assert.equal(h.created.length, 0);
    assert.equal(record.id, 'issue-1');
    assert.deepEqual(h.whereUsed(), {
      companyId: 'company-1', taxPeriodId: 'period-1', issueCode: 'INPUT_VAT_NOT_CLAIMABLE',
      sourceType: 'expense.record', sourceId: 'expense-1', status: 'OPEN',
    });
  });

  it('creates a new OPEN issue when no open duplicate exists', async () => {
    const h = repoWith(null);

    const record = await h.repo.createIssue(issueInput);

    assert.equal(h.created.length, 1);
    assert.equal(h.created[0]?.status, 'OPEN');
    assert.equal(h.created[0]?.issueCode, 'INPUT_VAT_NOT_CLAIMABLE');
    assert.equal(record.id, 'issue-new');
  });
});


describe('expense tax events cannot cross correction', () => {
  for (const [status, version] of [['NEEDS_REVIEW', 1], ['REJECTED', 1], ['VOIDED', 1], ['CONFIRMED', 2]] as const) {
    it(`refuses stale synchronization at ${status}/${version}`, async () => {
      let writes = 0;
      const client: any = {
        $transaction: async (work: any) => work({ ...client }), $executeRaw: async () => 0,
        expenseRecord: { findFirst: async () => ({ status, confirmedAt: new Date(version), updatedAt: new Date(100) }) },
        taxEvent: { upsert: async ({ create }: any) => { writes++; return { id: 'event', ...create }; } },
      };
      await assert.rejects(new PrismaTaxRepository({ client } as any).upsertEvent({ companyId: 'c1', sourceType: 'expense.record', sourceId: 'e1', expectedExpenseConfirmedAt: new Date(1), idempotencyKey: 'old' } as any), (e: any) => e.getResponse?.().code === 'expense_tax_source_changed');
      assert.equal(writes, 0);
      // A fresh confirmation still syncs when posting has stamped an unrelated write time.
      client.expenseRecord.findFirst = async () => ({ status: 'CONFIRMED', confirmedAt: new Date(3), updatedAt: new Date(100) });
      await new PrismaTaxRepository({ client } as any).upsertEvent({ companyId: 'c1', sourceType: 'expense.record', sourceId: 'e1', expectedExpenseConfirmedAt: new Date(3), idempotencyKey: 'current' } as any);
      assert.equal(writes, 1);
    });
  }
});

it('guards EXPORTED at the database write so filing during rendering cannot be undone', async () => {
  let status = 'FILED';
  const repo = new PrismaTaxRepository({ client: { taxPeriod: {
    findFirst: async () => ({ id: 'p', companyId: 'c', status }),
    update: async () => { throw new Error('unconditional export write'); },
    updateMany: async ({ where, data }: any) => {
      assert.deepEqual(where, { id: 'p', companyId: 'c', status: { notIn: ['FILED', 'PAID', 'CLOSED'] } });
      if (!where.status.notIn.includes(status)) status = data.status;
      return { count: status === data.status ? 1 : 0 };
    },
  } } } as any);
  assert.equal((await repo.updatePeriodStatus('c', 'p', 'EXPORTED')).status, 'FILED');
  status = 'OPEN';
  assert.equal((await repo.updatePeriodStatus('c', 'p', 'EXPORTED')).status, 'EXPORTED');
});


it('removes only unlocked active withholding fallbacks when a source kind is unknown', async () => {
  let query: any;
  const repo = new PrismaTaxRepository({ client: { taxPeriod: { findMany: async () => [] }, taxEvent: { updateMany: async (input: any) => { query = input; return { count: 1 }; } } } } as any);
  await repo.supersedeUnclassifiedWithholding('c', 'expense.record', 'expense');
  assert.deepEqual(query, { where: { companyId: 'c', sourceType: 'expense.record', sourceId: 'expense',
    eventType: { in: ['WHT_PND2', 'WHT_PND3', 'WHT_PND53'] }, status: 'ACTIVE', OR: [{ eventType: { in: ['WHT_PND3', 'WHT_PND53'] } }, { taxPeriod: { status: { notIn: ['FILED', 'PAID', 'CLOSED'] } } }] },
    data: { status: 'SUPERSEDED' } });
});

it('refreshes the unknown-kind sentence on the existing open issue without creating a duplicate', async () => {
  const description = 'ยังไม่รู้ว่า สมชาย เป็นบริษัทหรือบุคคล เปิดคู่ค้าแล้วเลือกประเภทก่อน';
  let updates = 0;
  const repo = new PrismaTaxRepository({ client: { taxReviewIssue: {
    findFirst: async () => ({ ...existingRow, issueCode: 'WHT_PAYEE_KIND_UNKNOWN' }),
    update: async ({ where, data }: any) => { updates++; assert.equal(where.id, existingRow.id); return { ...existingRow, ...data }; },
    create: async () => { throw new Error('must reuse the open issue'); },
  } } } as any);
  assert.equal((await repo.createIssue({ ...issueInput, issueCode: 'WHT_PAYEE_KIND_UNKNOWN', description })).description, description);
  assert.equal(updates, 1);
});

it('rerouting retires other unlocked withholding forms while preserving the selected form', async () => {
  let query: any;
  const repo = new PrismaTaxRepository({ client: { taxPeriod: { findMany: async () => [] }, taxEvent: { updateMany: async (input: any) => { query = input; } } } } as any);
  for (const keep of ['WHT_PND2', 'WHT_PND3', 'WHT_PND53']) {
    await repo.supersedeUnclassifiedWithholding('c', 'expense.record', 'expense', keep as any);
    assert.deepEqual(query.where.eventType, { in: ['WHT_PND2', 'WHT_PND3', 'WHT_PND53'], not: keep });
    assert.deepEqual(query.where.OR[1].taxPeriod.status, { notIn: ['FILED', 'PAID', 'CLOSED'] });
  }
});

describe('filed withholding papers are immutable', () => {
  it('refuses replacing the filing, its lines or file after filing', async () => {
    let writes = 0;
    const tx: any = { whtFiling: { findFirst: async () => ({ id: 'f', status: 'FILED' }), updateMany: async () => { writes++; return { count: 1 }; } } };
    const repo = new PrismaTaxRepository({ client: tx } as any);
    await assert.rejects(() => repo.assertWithholdingFilingMutable(tx, 'company-1', 'f'), (error: any) => {
      assert.equal(error.getResponse().code, 'WHT_FILING_ALREADY_FILED'); return true;
    });
    assert.equal(writes, 0);
  });
  it('marks only the current exported frozen paper filed with its actor and date', async () => {
    let written: any;
    const tx: any = { whtFiling: { findFirst: async () => ({ id: 'f', status: 'EXPORTED', rowsCertain: true }),
      updateMany: async (query: any) => { written = query; return { count: 1 }; } } };
    const repo = new PrismaTaxRepository({ client: tx } as any);
    const at = new Date('2026-10-07');
    await repo.markWithholdingFilingFiled(tx, 'company-1', 'pkg', 'actor', at, 'filed');
    assert.deepEqual(written, { where: { id: 'f', companyId: 'company-1', status: 'EXPORTED', filingPackageId: 'pkg', rowsCertain: true },
      data: { status: 'FILED', filedAt: at, filedByUserId: 'actor', filedNote: 'filed' } });
  });
});


describe('withholding payer mode facts', () => {
  function setup() {
    const facts: any[] = []; let filed: string | null = null;
    const branches = [{ id: 'head', type: 'HEAD_OFFICE', status: 'ACTIVE' }];
    const db: any = {
      $queryRaw: async () => [{ id: 'company-1', timezone: 'Asia/Bangkok' }],
      company: { findUnique: async () => ({ timezone: 'Asia/Bangkok' }) },
      branch: { findMany: async () => branches },
      whtFiling: { findFirst: async () => filed ? { periodKey: filed } : null },
      taxPeriod: { findFirst: async () => null },
      whtPayerModeFact: {
        findMany: async () => facts,
        updateMany: async ({ where, data }: any) => { for (const f of facts) if (f.effectiveFromPeriodKey === where.effectiveFromPeriodKey && !f.supersededAt) Object.assign(f, data); },
        create: async ({ data }: any) => { const f = { id: String(facts.length), supersededAt: null, ...data }; facts.push(f); return f; },
      },
    };
    db.$transaction = async (work: any) => work(db);
    return { repo: new PrismaTaxRepository({ client: db } as any), facts, db, branches, setFiled: (value: string) => { filed = value; } };
  }
  it('does not ask a one-branch shop; saves dated history and supersedes only the same start month', async () => {
    const h = setup();
    assert.equal((await h.repo.readWhtPayerMode('company-1', '2026-08')).asked, false);
    await h.repo.answerWhtPayerMode({ companyId: 'company-1', userId: 'u', permissions: ['company.legal_identity.manage'] } as any, { mode: 'HEAD_OFFICE_PAYS_ALL', effectiveFromPeriodKey: '2026-08' });
    await h.repo.answerWhtPayerMode({ companyId: 'company-1', userId: 'u', permissions: ['company.legal_identity.manage'] } as any, { mode: 'EACH_BRANCH_PAYS', effectiveFromPeriodKey: '2026-09' });
    await h.repo.answerWhtPayerMode({ companyId: 'company-1', userId: 'u', permissions: ['company.legal_identity.manage'] } as any, { mode: 'HEAD_OFFICE_PAYS_ALL', effectiveFromPeriodKey: '2026-09' });
    assert.equal(h.facts[0].supersededAt, null); assert.ok(h.facts[1].supersededAt); assert.equal(h.facts[2].supersededAt, null);
    assert.equal(h.facts[2].answeredByUserId, 'u');
    h.branches.push({ id: 'branch', type: 'BRANCH', status: 'ACTIVE' });
    const before = await h.repo.readWhtPayerMode('company-1', '2026-07');
    assert.equal(before.asked, true); assert.equal(before.mode, null);
    assert.equal((await h.repo.readWhtPayerMode('company-1', '2026-08')).mode, 'HEAD_OFFICE_PAYS_ALL');
    assert.equal((await h.repo.readWhtPayerMode('company-1', '2026-09')).mode, 'HEAD_OFFICE_PAYS_ALL');
  });
  it('defaults to the shop current month and validates modes/months without writing facts', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T18:00:00Z') });
    const h = setup(), actor: any = { companyId: 'company-1', userId: 'u', permissions: ['company.legal_identity.manage'] };
    assert.equal((await h.repo.answerWhtPayerMode(actor, { mode: 'EACH_BRANCH_PAYS' })).periodKey, '2026-10');
    for (const month of ['2026-00', '2026-13', 'October', '2026-09-01']) await assert.rejects(h.repo.answerWhtPayerMode(actor, { mode: 'EACH_BRANCH_PAYS', effectiveFromPeriodKey: month }), (e: any) => e.getResponse().code === 'WHT_PAYER_MODE_MONTH_INVALID');
    await assert.rejects(h.repo.answerWhtPayerMode(actor, { mode: 'UNKNOWN' } as any), (e: any) => e.getResponse().code === 'WHT_PAYER_MODE_INVALID');
    assert.equal(h.facts.length, 1);
    h.db.taxPeriod.findFirst = async ({ where }: any) => { assert.deepEqual(where.status.in, ['FILED', 'PAID', 'CLOSED']); return { periodKey: '2026-10' }; };
    await assert.rejects(h.repo.answerWhtPayerMode(actor, { mode: 'HEAD_OFFICE_PAYS_ALL' }), (e: any) => e.getResponse().firstAllowedPeriodKey === '2026-11');
  });
  it('requires legal identity permission and offers the first safe month for a filed or backdated answer', async () => {
    const h = setup();
    await assert.rejects(h.repo.answerWhtPayerMode({ companyId: 'company-1', userId: 'u', permissions: ['wht.pnd53.prepare'] } as any, { mode: 'EACH_BRANCH_PAYS' }), (e: any) => e.getResponse().code === 'WHT_PAYER_MODE_FORBIDDEN');
    h.setFiled('2026-12');
    for (const month of ['2026-09', '2026-12']) await assert.rejects(h.repo.answerWhtPayerMode({ companyId: 'company-1', userId: 'u', permissions: ['company.legal_identity.manage'] } as any, { mode: 'EACH_BRANCH_PAYS', effectiveFromPeriodKey: month }), (e: any) => e.getResponse().code === 'WHT_PAYER_MODE_FILED' && e.getResponse().firstAllowedPeriodKey === '2027-01');
    assert.equal(h.facts.length, 0);
    assert.equal((await h.repo.readWhtPayerMode('company-1', '2026-12')).firstAllowedPeriodKey, '2027-01');
  });
});

it('supersession preserves a filed source while another source in the same month can be rerouted', async () => {
  const writes: any[] = [];
  const repo = new PrismaTaxRepository({ client: {
    taxPeriod: { findMany: async ({ where }: any) => where.whtFilings?.some.lines.some.sourceId === 'filed' ? [{ formType: 'PND3', periodKey: '2026-09' }] : [] },
    taxEvent: { updateMany: async (q: any) => { writes.push(q); } },
  } } as any);
  await repo.supersedeUnclassifiedWithholding('c', 'expense.record', 'filed');
  await repo.supersedeUnclassifiedWithholding('c', 'expense.record', 'open');
  assert.equal(writes.length, 1); assert.equal(writes[0].where.sourceId, 'open');
});

it('supersession never retires a payment in a legacy filed form without frozen lines', async () => {
  let writes = 0;
  const repo = new PrismaTaxRepository({ client: {
    taxPeriod: { findMany: async ({ where }: any) => where.whtFilings ? [] : [{ formType: 'PND53', periodKey: '2026-09', status: 'FILED', whtFilings: [] }] },
    taxEvent: { updateMany: async () => { writes++; } },
  } } as any);
  await repo.supersedeUnclassifiedWithholding('c', 'expense.record', 'legacy');
  assert.equal(writes, 0);
});

it('a new off-paper event clears only a new-style FILED month roll-up, never a legacy month or frozen payment', async () => {
  let update: any;
  const db: any = { taxEvent: { upsert: async ({ create }: any) => ({ id: 'late', ...create }) }, taxPeriod: { updateMany: async (q: any) => { update = q; return { count: 1 }; } } };
  const repo = new PrismaTaxRepository({ client: db } as any);
  await repo.upsertEvent({ companyId: 'c', taxPeriodId: 'p', eventType: 'WHT_PND53', sourceType: 'procurement.supplier_payment', sourceId: 'late', status: 'ACTIVE' } as any);
  assert.deepEqual(update, { where: { id: 'p', companyId: 'c', status: 'FILED',
    whtFilings: { some: { status: 'FILED', lines: { some: {} } }, none: { status: 'FILED', lines: { some: { sourceType: 'procurement.supplier_payment', sourceId: 'late' } } } } },
    data: { status: 'EXPORTED', filedAt: null } });
});

it('a stale VAT sync cannot claim after a newer decision without changing confirmation', async () => {
  let writes = 0;
  const client: any = { $transaction: async (work: any) => work({ ...client }), $executeRaw: async () => 0,
    expenseRecord: { findFirst: async () => ({ status: 'CONFIRMED', confirmedAt: new Date(1), inputVatClaimStatus: 'NON_CLAIMABLE', taxEvidenceStatus: 'USABLE_FOR_TAX' }) },
    taxEvent: { upsert: async ({ create }: any) => { writes++; return { id: 'event', ...create }; } } };
  await assert.rejects(new PrismaTaxRepository({ client } as any).upsertEvent({ companyId: 'c1', sourceType: 'expense.record', sourceId: 'e1',
    expectedExpenseConfirmedAt: new Date(1), expectedInputVatClaimStatus: 'CLAIMABLE', expectedTaxEvidenceStatus: 'USABLE_FOR_TAX', idempotencyKey: 'before-decision' } as any),
    (e: any) => e.getResponse?.().code === 'expense_tax_source_changed');
  assert.equal(writes, 0);
});
