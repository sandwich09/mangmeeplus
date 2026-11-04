import { isSerializationFailure } from '../../../../common/database/prisma-error';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { PrismaTaxRepository } from './prisma-tax.repository.js';
import { filedWithholdingPaymentPeriods } from '../../application/services/filed-withholding-payment';

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
    eventType: { in: ['WHT_PND2', 'WHT_PND3', 'WHT_PND53'] }, status: { in: ['ACTIVE', 'EXCLUDED'] }, OR: [{ eventType: { in: ['WHT_PND3', 'WHT_PND53'] } }, { taxPeriod: { status: { notIn: ['FILED', 'PAID', 'CLOSED'] } } }, { status: 'EXCLUDED' }] },
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

// Run with TAX_REQUIRE_POSTGRES=true for the controller's no-skip proof.
describe('R10 filing checks source blockers in its transaction (real PostgreSQL)', () => {
  let clients: import('../../../../generated/prisma/client').PrismaClient[] = [];
  let unavailable: string | null = null;
  const companies: string[] = [];
  const gate = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(finish => { resolve = finish; });
    return { promise, resolve };
  };
  before(async () => {
    if (!process.env.DATABASE_URL) {
      assert.notEqual(process.env.TAX_REQUIRE_POSTGRES, 'true', 'TAX_REQUIRE_POSTGRES requires DATABASE_URL');
      unavailable = 'DATABASE_URL is not set';
      return;
    }
    const { PrismaClient } = await import('../../../../generated/prisma/client');
    const { PrismaPg } = await import('@prisma/adapter-pg');
    const { pgSpecUnreachableReason } = await import('../../../../common/database/pg-spec-guard');
    clients = [0, 1].map(() => new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) }));
    unavailable = await pgSpecUnreachableReason(() => clients[0].$queryRaw`SELECT id FROM "WhtFiling" LIMIT 0`, 'TAX_REQUIRE_POSTGRES');
  });
  const fixture = async () => {
    const { randomUUID } = await import('node:crypto');
    const companyId = `r10-${randomUUID()}`;
    await clients[0].company.create({ data: { id: companyId, name: 'Synthetic R10' } });
    companies.push(companyId);
    const period = await clients[0].taxPeriod.create({ data: { companyId, taxType: 'WHT', formType: 'PND53', periodKey: '2026-09' } });
    const ctx: any = { companyId, userId: 'r10-pg', roles: ['OWNER'], permissions: [], scopes: {}, requestId: randomUUID() };
    return { companyId, period, ctx };
  };
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const source = (f: Fixture, unknown = false) => clients[1].expenseRecord.create({ data: {
    companyId: f.companyId, status: 'CONFIRMED', expenseDate: new Date('2026-09-10'), createdByUserId: f.ctx.userId,
    whtAmount: '30', whtRate: '3', netPayableAmount: '970', taxableAmount: '1000', grandTotalAmount: '1000',
    vendorNameSnapshot: 'Synthetic payee', vendorAddressSnapshot: 'กรุงเทพ', vendorEntityKindSnapshot: unknown ? null : 'JURISTIC',
    vendorTaxIdSnapshot: unknown ? null : '1100700000001',
    payments: { create: { amount: '970', paidAt: new Date('2026-09-10'), paidAtConfirmed: true, createdByUserId: f.ctx.userId } },
  }, include: { payments: true } });
  const addBlocker = async (f: Fixture) => {
    const bad = await source(f, true);
    await clients[1].taxReviewIssue.create({ data: { companyId: f.companyId, taxPeriodId: f.period.id, sourceType: 'expense.record', sourceId: bad.id,
      issueCode: 'WHT_PAYEE_KIND_UNKNOWN', severity: 'BLOCKING', description: 'เลือกประเภทผู้รับเงินก่อนดาวน์โหลด' } });
  };
  const download = (repo: PrismaTaxRepository, f: Fixture) => repo.recordWithholdingDownload({ ctx: f.ctx, period: f.period as any,
    exportFormat: 'PDF', exportNumber: 'r10', establishmentCode: '00000', establishmentBranchId: null, preparedBy: 'SYSTEM',
    payerSnapshotJson: {}, rowsChecksum: '', rowsCertain: true,
    artifact: { fileName: 'test.pdf', mimeType: 'application/pdf', checksum: 'test', contentBase64: '', byteLength: 0 },
    stored: { bucket: 'test', objectKey: 'test', storageProvider: 'local', byteSize: 0, checksumSha256: 'test' } as any, lines: [] });
  const withTransaction = (transaction: (...args: any[]) => any) => new Proxy(clients[0], {
    get(target, key) { return key === '$transaction' ? transaction : Reflect.get(target, key); },
  });
  const controller = async (client: any) => {
    const { TaxController } = await import('../../presentation/http/tax.controller');
    const noop: any = {};
    return new TaxController({ execute: async () => {} } as any, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop,
      new PrismaTaxRepository({ client } as any), { log: async () => {} } as any);
  };
  const exportedAdditionalPaper = async (f: Fixture) => {
    const { withholdingPaymentFacts, withholdingPaymentChecksum } = await import('../../application/services/withholding-filing-state');
    const good = await source(f);
    const event = await clients[0].taxEvent.create({ data: {
      companyId: f.companyId, taxPeriodId: f.period.id, idempotencyKey: `${f.companyId}:good`, eventType: 'WHT_PND53',
      sourceType: 'expense.record', sourceId: good.id, sourceLineKey: `payment:${good.payments[0].id}`, periodKey: f.period.periodKey,
      eventDate: new Date('2026-09-10'), taxableBase: '1000', taxAmount: '30', grossAmount: '1000', withheldAmount: '30', whtRate: '3',
      whtFormType: 'PND53', payeeSnapshotJson: { name: 'Synthetic payee', taxId: '1100700000001', branchCode: null, address: 'กรุงเทพ' },
    } });
    const payment: any = { ...event, payeeSnapshot: event.payeeSnapshotJson, grossAmount: '1000', withheldAmount: '30', whtRate: '3' };
    const createPaper = async (sequence: number, status: 'FILED' | 'EXPORTED') => {
      const paper = await clients[0].whtFiling.create({ data: { companyId: f.companyId, taxPeriodId: f.period.id, formType: 'PND53', periodKey: f.period.periodKey,
        establishmentCode: '00000', sequence, status, preparedBy: 'SYSTEM', payerSnapshotJson: {}, rowsChecksum: withholdingPaymentChecksum([payment]), rowsCertain: true } });
      const pkg = await clients[0].taxFilingPackage.create({ data: { companyId: f.companyId, taxPeriodId: f.period.id, formType: 'PND53', periodKey: f.period.periodKey,
        whtFilingId: paper.id, exportNumber: `${f.companyId}:${sequence}`, exportFormat: 'PDF', checksum: `earlier-bytes-${sequence}` } });
      await clients[0].whtFiling.update({ where: { id: paper.id }, data: { filingPackageId: pkg.id } });
      await clients[0].whtFilingLine.create({ data: { whtFilingId: paper.id, rowNumber: 1, taxEventId: event.id,
        sourceType: 'expense.record', sourceId: sequence ? good.id : 'earlier-source',
        lineJson: { payment: sequence ? withholdingPaymentFacts(payment) : ['expense.record', 'earlier-source'] } } });
      return paper.id;
    };
    const earlierId = await createPaper(0, 'FILED');
    const currentId = await createPaper(1, 'EXPORTED');
    await clients[0].taxPeriod.update({ where: { id: f.period.id }, data: { status: 'EXPORTED' } });
    const readEarlier = () => clients[0].whtFiling.findUniqueOrThrow({ where: { id: earlierId }, include: { lines: true, latestPackage: true } });
    return { currentId, readEarlier, earlier: await readEarlier() };
  };
  const assertPreserved = async (f: Fixture, paper: Awaited<ReturnType<typeof exportedAdditionalPaper>>) => {
    assert.equal((await clients[0].whtFiling.findUniqueOrThrow({ where: { id: paper.currentId } })).status, 'EXPORTED');
    assert.equal((await clients[0].taxPeriod.findUniqueOrThrow({ where: { id: f.period.id } })).status, 'EXPORTED');
    assert.equal(await clients[0].taxFilingPackage.count({ where: { companyId: f.companyId } }), 2);
    assert.deepEqual(await paper.readEarlier(), paper.earlier);
  };
  it('rejects a blocker committed before the checked download snapshot without publishing a package', async t => {
    if (unavailable) return t.skip(unavailable);
    const f = await fixture();
    const beforeSnapshot = gate(), sourceCommitted = gate();
    const client = withTransaction(async (work, options) => {
      beforeSnapshot.resolve(); await sourceCommitted.promise;
      return clients[0].$transaction(work, options);
    });
    const pending = download(new PrismaTaxRepository({ client } as any), f);
    await beforeSnapshot.promise;
    try { await addBlocker(f); } finally { sourceCommitted.resolve(); }
    await assert.rejects(pending, (error: any) => error.getResponse?.().code === 'PND53_FILING_REVIEW');
    assert.equal(await clients[0].taxFilingPackage.count({ where: { companyId: f.companyId } }), 0);
    assert.equal(await clients[0].whtFiling.count({ where: { companyId: f.companyId } }), 0);
  });
  it('refuses conflicting Serializable download writes without publishing a package', async t => {
    if (unavailable) return t.skip(unavailable);
    const f = await fixture();
    const snapshot = gate(), committed = gate();
    const pending = clients[0].$transaction(async tx => {
      await tx.taxPeriod.findUniqueOrThrow({ where: { id: f.period.id } });
      snapshot.resolve(); await committed.promise;
      return download(new PrismaTaxRepository({ client: { $transaction: (work: any) => work(tx) } } as any), f);
    }, { isolationLevel: 'Serializable' });
    await snapshot.promise;
    try { await clients[1].taxPeriod.update({ where: { id: f.period.id }, data: { reviewNote: 'competing write' } }); }
    finally { committed.resolve(); }
    // A raw statement reports 40001 as P2010; the use case maps both forms (isSerializationFailure).
    await assert.rejects(pending, (error: any) => isSerializationFailure(error));
    assert.equal((await clients[0].taxPeriod.findUniqueOrThrow({ where: { id: f.period.id } })).status, 'OPEN');
    assert.equal(await clients[0].taxFilingPackage.count({ where: { companyId: f.companyId } }), 0);
  });
  it('markFiled rejects a blocker committed after sync and before its Serializable snapshot and preserves the earlier paper', async t => {
    if (unavailable) return t.skip(unavailable);
    const f = await fixture();
    const paper = await exportedAdditionalPaper(f);
    const beforeSnapshot = gate(), committed = gate();
    const client = withTransaction(async (work, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      beforeSnapshot.resolve(); await committed.promise;
      return clients[0].$transaction(work, options);
    });
    const value = await controller(client);
    const pending = value.markFiled(f.ctx, f.companyId, f.period.id, { establishmentCode: '00000', sequence: 1 });
    await beforeSnapshot.promise;
    try { await addBlocker(f); } finally { committed.resolve(); }
    await assert.rejects(pending, (error: any) => error.getResponse?.().code === 'PND53_FILING_REVIEW');
    await assertPreserved(f, paper);
  });
  it('markFiled maps a concurrent paper write to its serialization refusal and preserves the earlier paper', async t => {
    if (unavailable) return t.skip(unavailable);
    const f = await fixture();
    const paper = await exportedAdditionalPaper(f);
    const checked = gate(), committed = gate();
    const client = withTransaction((work, options) => clients[0].$transaction(tx => work(new Proxy(tx, {
      get(target, key) {
        if (key !== 'whtFiling') return Reflect.get(target, key);
        return new Proxy(target.whtFiling, { get(delegate, operation) {
          if (operation !== 'updateMany') return Reflect.get(delegate, operation);
          return async (query: any) => {
            checked.resolve(); await committed.promise;
            return delegate.updateMany(query);
          };
        } });
      },
    })), options));
    const value = await controller(client);
    const pending = value.markFiled(f.ctx, f.companyId, f.period.id, { establishmentCode: '00000', sequence: 1 });
    await Promise.race([checked.promise, pending.then(() => assert.fail('markFiled completed before its checked barrier'))]);
    try { await clients[1].whtFiling.update({ where: { id: paper.currentId }, data: { filedNote: 'competing write' } }); }
    finally { committed.resolve(); }
    await assert.rejects(pending, (error: any) => error.getResponse?.().code === 'WHT_FILING_CHANGED_AFTER_DOWNLOAD');
    await assertPreserved(f, paper);
  });
  after(async () => {
    try {
      for (const companyId of companies) {
        await clients[0].whtFiling.updateMany({ where: { companyId }, data: { filingPackageId: null } });
        await clients[0].whtFilingLine.deleteMany({ where: { filing: { companyId } } });
        await clients[0].taxFilingPackage.deleteMany({ where: { companyId } });
        await clients[0].whtFiling.deleteMany({ where: { companyId } });
        await clients[0].expensePayment.deleteMany({ where: { companyId } });
        await clients[0].expenseRecord.deleteMany({ where: { companyId } });
        await clients[0].company.deleteMany({ where: { id: companyId } });
      }
    } finally { await Promise.all(clients.map(client => client.$disconnect())); }
  });
});

describe('R6 e-WHT excluded event lifecycle', () => {
  it('finds ACTIVE and EXCLUDED source components', async () => {
    let where: any;
    const repo = new PrismaTaxRepository({ client: { taxEvent: { findFirst: async (query: any) => { where = query.where; return null; } } } } as any);
    await repo.findActiveEventBySourceComponent('c', 'expense.record', 'e', 'payment:p', null, 'WHT_PND3');
    assert.deepEqual(where.status, { in: ['ACTIVE', 'EXCLUDED'] });
  });
  it('writes EXCLUDED in a legacy locked month without reopening it, but rejects a frozen filed payment', async () => {
    let writes = 0, covered = false;
    const tx: any = { $executeRaw: async () => 0, $queryRaw: async () => [],
      expenseRecord: { findFirst: async () => ({ id: 'e', status: 'CONFIRMED' }) },
      expensePayment: { findFirst: async () => ({ id: 'p', status: 'RECORDED', paidAtConfirmed: true }) },
      whtFiling: { findMany: async () => covered ? [{ formType: 'PND3', periodKey: '2026-11', lines: [{ sourceType: 'expense.record', sourceId: 'e', lineJson: { payment: [...Array(13).fill(null), 'payment:p'] } }] }] : [] },
      taxPeriod: { findMany: async () => [{ formType: 'PND3', periodKey: '2026-11', status: 'FILED', whtFilings: [] }], updateMany: async () => assert.fail('EXCLUDED must not reopen the period') },
      taxEvent: { upsert: async ({ create }: any) => { writes++; return { id: 'event', ...create }; } } };
    const repo = new PrismaTaxRepository({ client: { $transaction: async (work: any) => work(tx) } } as any);
    const input: any = { companyId: 'c', sourceType: 'expense.record', sourceId: 'e', sourceLineKey: 'payment:p', taxPeriodId: 'period', periodKey: '2026-11',
      eventType: 'WHT_PND3', whtFormType: 'PND3', status: 'EXCLUDED', idempotencyKey: 'excluded-1', eventDate: new Date('2026-11-04'), taxableBase: '100', taxAmount: '1', currency: 'USD' };
    assert.equal((await repo.upsertEvent(input)).status, 'EXCLUDED'); assert.equal(writes, 1);
    covered = true;
    await assert.rejects(() => repo.upsertEvent(input), (e: any) => e.getResponse().code === 'expense_tax_source_changed');
    assert.equal(writes, 1);
  });
  it('keeps the form filter even with an explicit period when resolving source issues', async () => {
    let where: any;
    const repo = new PrismaTaxRepository({ client: { taxReviewIssue: { updateMany: async (query: any) => { where = query.where; } } } } as any);
    await repo.resolveSourceIssues('c', 'FUNCTIONAL_CURRENCY_FX_MISSING', 'expense.record', 'e', 'period', ['PND2', 'PND3', 'PND53']);
    assert.deepEqual(where.taxPeriod, { formType: { in: ['PND2', 'PND3', 'PND53'] } });
    assert.equal(where.taxPeriodId, 'period');
  });
});

it('R6 retires EXCLUDED without a legacy period check and resolves only its WHT warning', async () => {
  let retired: any, resolved: any;
  const tx: any = { $executeRaw: async () => 0, $queryRaw: async () => assert.fail('EXCLUDED does not take the legacy period gate'),
    taxEvent: { updateMany: async (input: any) => { retired = input; } }, taxReviewIssue: { updateMany: async (input: any) => { resolved = input; } } };
  const db: any = { taxReviewIssue: { findMany: async () => [] }, taxEvent: { findMany: async () => [{ id: 'excluded', status: 'EXCLUDED', sourceId: 'e', sourceType: 'expense.record', sourceLineKey: 'payment:p', taxPeriodId: 'p', eventDate: new Date() }] },
    $transaction: async (work: any) => work(tx) };
  await new PrismaTaxRepository({ client: db } as any).retireObsoleteExpenseWithholding('c', []);
  assert.equal(retired.data.status, 'SUPERSEDED'); assert.equal(resolved.where.issueCode, 'WHT_RATE_MISMATCH');
  assert.deepEqual(resolved.where.taxPeriod.formType.in, ['PND2', 'PND3', 'PND53']); assert.equal(resolved.where.taxPeriodId, 'p');
});

it('R7 stale issue cleanup preserves desired pairs and PP30 issues', async () => {
  let update: any;
  const issues = [{ id: 'keep', sourceId: 'e', taxPeriodId: 'p', issueCode: 'MISSING_TAX_ID', formType: 'PND3' },
    { id: 'old', sourceId: 'gone', taxPeriodId: 'p', issueCode: 'WHT_RATE_MISMATCH', formType: 'PND3' },
    { id: 'vat', sourceId: 'gone', taxPeriodId: 'vat', issueCode: 'FUNCTIONAL_CURRENCY_FX_MISSING', formType: 'PP30' }];
  const db: any = { taxReviewIssue: { findMany: async ({ where }: any) => {
    assert.equal(where.companyId, 'c'); assert.equal(where.sourceType, 'expense.record');
    return issues.filter(issue => where.taxPeriod.formType.in.includes(issue.formType));
  }, updateMany: async (input: any) => { update = input; } } };
  await new PrismaTaxRepository({ client: db } as any).resolveStaleExpenseWithholdingIssues('c', new Set([JSON.stringify(['e', 'p', 'MISSING_TAX_ID'])]));
  assert.deepEqual(update.where.id.in, ['old']); assert.equal(update.where.companyId, 'c'); assert.equal(update.data.status, 'RESOLVED');
});

it('R6 e-WHT reopen ignores a FILED line for a different payment but locks its current split payment', async () => {
  let key = 'payment:old';
  const db: any = { expensePayment: { findMany: async () => [{ id: 'current' }] },
    whtFiling: { findMany: async () => [{ formType: 'PND3', periodKey: '2026-09', lines: [{ sourceType: 'expense.record', sourceId: 'e', lineJson: { payment: [...Array(13).fill(null), key] } }] }] } };
  const read = () => filedWithholdingPaymentPeriods(db, 'c', 'expense.record', 'e', undefined, undefined, true);
  assert.deepEqual(await read(), []);
  key = 'payment:current:line:service';
  assert.deepEqual(await read(), [{ formType: 'PND3', periodKey: '2026-09' }]);
});
