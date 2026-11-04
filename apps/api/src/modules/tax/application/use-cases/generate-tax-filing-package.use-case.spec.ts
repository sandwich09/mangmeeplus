import { expenseSourceForEvent } from '../../testing/withholding-source.fixture';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';
import { inflateRawSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GenerateTaxFilingPackageUseCase } from './generate-tax-filing-package.use-case.js';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { numberAndRoad, printablePnd53PayeeAddress, renderPnd53OfficialForm, renderOfficialWithholdingForm } from '../../domain/logic/pnd53-official-form.logic';
import { renderPnd3OfficialForm, splitPnd3PayeeName } from '../../domain/logic/pnd3-official-form.logic';

function filingStore(repo: any) {
  const db = repo.prisma.client;
  const readSources = db.expenseRecord?.findMany;
  if (readSources) db.expenseRecord.findMany = async (query: any) => {
    const rows = await readSources(query);
    if (!query.where.whtAmount) return rows;
    const events = await repo.findEventsByPeriod();
    return rows.filter((row: any) => events.some((e: any) => e.sourceType === 'expense.record' && e.sourceId === row.id) || row.payments).map((row: any) => row.payments ? row : expenseSourceForEvent(events.find((e: any) => e.sourceId === row.id) ?? { sourceId: row.id }, row));
  };
  db.accountingCounterparty ??= { findMany: async () => [] };

  const state: any = { filing: null, lines: [], packages: [], attachments: [], objects: new Map(), writes: 0 };
  const papers = new Map<string, any>();
  const lines = new Map<string, any[]>();
  const matches = (where: any) => state.filing && Object.entries(where).every(([key, value]: any) =>
    typeof value === 'object' ? state.filing[key] !== value.not : state.filing[key] === value);
  db.whtFiling = {
    findMany: async () => [...papers.values()].map(p => ({ ...p, lines: lines.get(p.id) ?? [] })),
    findFirst: async ({ where }: any) => { const paper = [...papers.values()].find(row => Object.entries(where).every(([k,v]) => typeof v === 'object' || row[k] === v)); return paper ? { ...paper, lines: lines.get(paper.id) ?? [], latestPackage: state.packages.find((p: any) => p.id === paper.filingPackageId) } : null; },
    findUnique: async ({ where }: any) => { const key = where.companyId_formType_periodKey_establishmentCode_sequence; state.filing = key ? [...papers.values()].find(p => p.establishmentCode === key.establishmentCode && p.sequence === key.sequence) ?? null : papers.get(where.id) ?? null; return state.filing; },
    create: async ({ data }: any) => { state.filing = { id: `filing-${papers.size}`, ...data }; papers.set(state.filing.id, state.filing); return state.filing; },
    updateMany: async ({ where, data }: any) => { state.filing = papers.get(where.id) ?? state.filing; if (!matches(where)) return { count: 0 }; Object.assign(state.filing, data); state.writes++; return { count: 1 }; },
  };
  db.whtFilingLine = { findMany: async ({ where }: any) => [...papers.values()].filter(p => p.status === 'FILED' && (!where.filing.formType || p.formType === where.filing.formType)).flatMap(p => lines.get(p.id) ?? []), deleteMany: async ({ where }: any) => { state.lines = []; lines.set(where.whtFilingId, []); }, createMany: async ({ data }: any) => { state.lines = data; if (data.length) lines.set(data[0].whtFilingId, data); } };
  db.attachmentObject = { create: async ({ data }: any) => { const row = { id: `file-${state.attachments.length}`, ...data }; state.attachments.push(row); return row; },
    findFirst: async ({ where }: any) => state.attachments.find((a: any) => a.id === where.id && a.companyId === where.companyId) };
  db.attachmentLink = { create: async () => ({}) };
  db.taxReviewIssue.findMany ??= async () => [];
  db.taxEvent ??= { findMany: async () => (await repo.findEventsByPeriod()).map((e: any) => ({ ...e, payeeSnapshotJson: e.payeeSnapshot })) };
  db.$queryRaw = async () => [];
  db.$transaction = async (work: any) => work(db);
  db.taxFilingPackage.create = async ({ data }: any) => {
    const row = { id: `pkg-${state.packages.length}`, ...data, status: 'GENERATED', generatedAt: new Date(), createdAt: new Date() };
    state.packages.push(row); return row;
  };
  db.taxFilingPackage.findFirst = async () => state.packages.at(-1) ?? null;
  const real = new PrismaTaxRepository(repo.prisma);
  repo.recordWithholdingDownload = async (input: any) => {
    db.taxPeriod ??= {};
    db.taxPeriod.updateMany ??= async () => {
      if (!['FILED', 'PAID', 'CLOSED'].includes((await repo.findPeriodById()).status)) await repo.updatePeriodStatus(input.ctx.companyId, input.period.id, 'EXPORTED');
      return { count: 1 };
    };
    const readEvents = db.taxEvent.findMany;
    db.taxEvent.findMany = async (query: any) => query.where.taxPeriodId === input.period.id
      ? (await repo.findEventsByPeriod()).map((e: any) => ({ ...e, payeeSnapshotJson: e.payeeSnapshot })) : readEvents(query);
    try { return await real.recordWithholdingDownload(input); } finally { db.taxEvent.findMany = readEvents; }
  };
  repo.markWithholdingFilingFiled = real.markWithholdingFilingFiled.bind(real);
  const storage: any = { putObject: async ({ objectKey, bytes }: any) => { state.objects.set(objectKey, Buffer.from(bytes)); return { bucket: 'test', objectKey, storageProvider: 'local', objectVersionId: 'v1', byteSize: bytes.length, checksumSha256: 'test' }; },
    getObject: async ({ objectKey }: any) => ({ bytes: state.objects.get(objectKey) }), deleteObject: async ({ objectKey }: any) => { state.objects.delete(objectKey); } };
  return { state, storage, papers };
}

const ctx = { companyId: 'c1', userId: 'u1', requestId: 'r1' } as any;
function harness(reconciliation: any, issues: any[] = []) {
  const period = { id: 'p1', companyId: 'c1', taxType: 'VAT', formType: 'PP30', periodKey: '2026-07', status: 'REVIEWED', createdAt: new Date(), updatedAt: new Date() };
  const taxRepo = {
    findPeriodById: async () => period,
    findEventsByPeriod: async () => [],
    findIssuesByPeriod: async () => issues,
    updatePeriodStatus: async () => period,
    prisma: { client: {
      taxReportSnapshot: { findFirst: async () => null, create: async ({ data }: any) => data }, taxReconciliationRun: { findFirst: async () => reconciliation },
      taxFilingPackage: { create: async ({ data }: any) => ({ id: 'pkg1', ...data, status: 'GENERATED', generatedAt: new Date(), downloadedAt: null, voidedAt: null, filedManuallyAt: null, createdAt: new Date() }) },
    } },
  } as any;
  return new GenerateTaxFilingPackageUseCase(taxRepo, { execute: async () => ({ id: 'seq1', documentNumber: 'TX-1' }) } as any, { execute: async () => undefined } as any, { log: async () => undefined } as any, {} as any);
}

describe('GenerateTaxFilingPackageUseCase reconciliation gate', () => {
  it('blocks export when there is no current reconciliation', async () => {
    await assert.rejects(() => harness(null).execute(ctx, 'p1', 'REVIEW_JSON'), /reconciliation run is required/);
  });
  it('blocks unreviewed or blocking reconciliation', async () => {
    await assert.rejects(() => harness({ status: 'NEEDS_REVIEW', blockingIssueCount: 1 }).execute(ctx, 'p1', 'REVIEW_JSON'), /must be reviewed/);
  });
  it('allows export after a current reviewed reconciliation with no blockers', async () => {
    const result = await harness({ status: 'REVIEWED', blockingIssueCount: 0, reviewedAt: new Date(), updatedAt: new Date() }).execute(ctx, 'p1', 'REVIEW_JSON');
    assert.equal(result.status, 'GENERATED');
  });
});

describe('GenerateTaxFilingPackageUseCase official PND53 paper form', () => {
  it('prints legacy structured payee addresses as Thai address text, never JSON', () => {
    assert.equal(printablePnd53PayeeAddress(JSON.stringify({
      line1: '123 ถนนสุขุมวิท', subdistrict: 'คลองเตย', district: 'วัฒนา',
      province: 'กรุงเทพมหานคร', postalCode: '10110',
    })), '123 ถนนสุขุมวิท คลองเตย วัฒนา กรุงเทพมหานคร 10110');
    assert.equal(printablePnd53PayeeAddress('{"line1":'), null);
  });
  const period = { id: 'p53', companyId: 'c1', formType: 'PND53', periodKey: '2026-09', status: 'OPEN', dueDate: new Date('2026-10-31') };
  // The form refuses an overdue period and reads the clock itself, so the cases that produce it
  // pin "now" inside this period's filing window.
  const filingDay = new Date('2026-10-05T03:00:00.000Z');
  const event = {
    id: 'e53', companyId: 'c1', eventType: 'WHT_PND53', sourceType: 'expense.record', sourceId: 'expense-1',
    branchId: null, eventDate: new Date('2026-09-10T00:00:00Z'), currency: 'THB',
    payeeSnapshot: { name: 'บริษัท ทดสอบ จำกัด', taxId: '0105555000001', branchCode: '00000', address: '55 ถนนสุขุมวิท กรุงเทพมหานคร 10110' },
    incomeCategoryCode: 'WHT_SERVICE_5', whtRate: '3.0000', grossAmount: '1000.0000', withheldAmount: '30.0000',
  };
  function pnd53Harness(changes: Record<string, unknown> = {}) {
    let reserved = 0;
    const taxRepo = { findPeriodById: async () => period, findEventsByPeriod: async () => [{ ...event, ...changes }],
      findIssuesByPeriod: async () => [], createIssue: async () => undefined, updatePeriodStatus: async () => period,
      prisma: { client: {
        taxReportSnapshot: { findFirst: async () => null, create: async ({ data }: any) => data }, taxReviewIssue: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
        company: { findUnique: async () => ({ registeredName: 'บริษัท ผู้จ่าย จำกัด', taxId: '0994000163011',
          addressJson: { line1: '123/4 ถนนลาดพร้าว', subdistrict: 'จอมพล', district: 'จตุจักร', province: 'กรุงเทพมหานคร', postalCode: '10900' } }) },
        companyTaxProfile: { findUnique: async () => null },
        branch: { findMany: async () => [] }, whtPayerModeFact: { findMany: async () => [] },
        whtIncomeCategory: { findMany: async () => [{ code: 'WHT_SERVICE_5', nameTh: 'ค่าบริการ (นิติบุคคล)' }, { code: 'WHT_DIVIDEND', nameTh: 'เงินปันผล', filingRoute: 'ACCOUNTANT_PREPARES' }] },
        expenseRecord: { findMany: async () => [{ id: 'expense-1', vendorEntityKindSnapshot: 'JURISTIC' }] },
        taxFilingPackage: { create: async ({ data }: any) => ({ id: 'pkg53', ...data, status: 'GENERATED', generatedAt: new Date(), createdAt: new Date() }) },
      } },
    } as any;
    const persistence = filingStore(taxRepo);
    const useCase = new GenerateTaxFilingPackageUseCase(taxRepo,
      { execute: async () => { reserved++; return { id: 'seq53', documentNumber: 'TX-53' }; } } as any,
      { execute: async () => undefined } as any, { log: async () => undefined } as any, persistence.storage);
    return { useCase, get reserved() { return reserved; } };
  }

  it('exports a printable RD main form and attachment without form widgets', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: filingDay });
    const harness = pnd53Harness();
    const result = await harness.useCase.execute(ctx, 'p53', 'PDF');
    const pdf = await PDFDocument.load(Buffer.from(result.artifact.contentBase64, 'base64'));
    assert.equal(pdf.getPageCount(), 2);
    assert.equal(pdf.getForm().getFields().length, 0);
    assert.equal(result.artifact.fileName, 'ภ.ง.ด.53-2026-09-00000.pdf');
    assert.equal(harness.reserved, 1);
  });

  it('refuses missing payee address before reserving a filing number', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: filingDay });
    const harness = pnd53Harness({ payeeSnapshot: { ...event.payeeSnapshot, address: null } });
    await assert.rejects(() => harness.useCase.execute(ctx, 'p53', 'PDF'), /ข้อมูลผู้รับเงิน/);
    assert.equal(harness.reserved, 0);
  });

  it('refuses the official form for a dividend routed to its accountant', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: filingDay });
    const harness = pnd53Harness({ incomeCategoryCode: 'WHT_DIVIDEND' });
    await assert.rejects(() => harness.useCase.execute(ctx, 'p53', 'PDF'), /ผู้ทำบัญชีจัดทำแบบนี้เอง/);
    assert.equal(harness.reserved, 0);
  });

  it('does not print "ถนน" twice: the road slot follows the form\'s own label', () => {
    assert.deepEqual(numberAndRoad('88 ถนนพระราม 4'), ['88', 'พระราม 4']);
    assert.deepEqual(numberAndRoad(' 99/1  ถนน เพชรบุรีตัดใหม่ '), ['99/1', 'เพชรบุรีตัดใหม่']);
    assert.deepEqual(numberAndRoad('123/4 ซอยลาดพร้าว 1 ถนนลาดพร้าว'), ['123/4', 'ซอยลาดพร้าว 1 ถนนลาดพร้าว']);
    assert.deepEqual(numberAndRoad('55'), ['55', '']);
  });

  it('continues the RD attachment on a second sheet after six payees', async () => {
    const filing = {
      periodKey: '2026-09', payerName: 'บริษัท ผู้จ่าย จำกัด', payerTaxId: '0994000163011', payerBranch: '00000',
      payerAddress: { line1: '123/4 ถนนลาดพร้าว', subdistrict: 'จอมพล', district: 'จตุจักร', province: 'กรุงเทพมหานคร', postalCode: '10900' },
      lines: Array.from({ length: 7 }, (_, index) => ({
        payeeName: `บริษัท ผู้รับ ${index + 1} จำกัด`, payeeTaxId: `010555500000${index}`,
        payeeBranch: '00000', payeeAddress: '55 ถนนสุขุมวิท กรุงเทพมหานคร 10110',
        paidAt: new Date('2026-09-10T00:00:00Z'), incomeType: 'ค่าบริการ (นิติบุคคล)', rate: 3, income: 1000, withheld: 30,
      })),
    };
    const pdf = await PDFDocument.load(await renderPnd53OfficialForm(filing));
    assert.equal(pdf.getPageCount(), 3);
    assert.equal(pdf.getForm().getFields().length, 0);
  });

  it('fills the RD ภ.ง.ด.3 form: one sheet for six individuals, a second for the seventh, three payments a row', async () => {
    const line = (index: number) => ({
      payeeName: `นาย ผู้รับ คนที่${index + 1}`, payeeTaxId: `110070000000${index}`, payeeBranch: '',
      payeeAddress: '55 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110',
      paidAt: new Date('2026-09-10T00:00:00Z'), incomeType: 'ค่าบริการ', rate: 3, income: 1000, withheld: 30,
    });
    const filing = {
      periodKey: '2026-09', payerName: 'บริษัท ผู้จ่าย จำกัด', payerTaxId: '0994000163011', payerBranch: '00000',
      payerAddress: { line1: '123/4 ถนนลาดพร้าว', line2: 'อาคารตัวอย่างทาวเวอร์ ชั้น 21 ห้อง 2105', subdistrict: 'จอมพล', district: 'จตุจักร', province: 'กรุงเทพมหานคร', postalCode: '10900' },
      lines: [line(0), line(0), line(0), line(0), ...Array.from({ length: 5 }, (_, index) => line(index + 1))],
    };
    // One person paid four times takes two numbered rows (three payments, then one): six rows, one sheet.
    const oneSheet = await PDFDocument.load(await renderPnd3OfficialForm({ ...filing, lines: filing.lines.slice(0, 8) }));
    assert.equal(oneSheet.getPageCount(), 2);
    const twoSheets = await PDFDocument.load(await renderPnd3OfficialForm(filing));
    assert.equal(twoSheets.getPageCount(), 3);
    assert.equal(twoSheets.getForm().getFields().length, 0);
    assert.deepEqual(twoSheets.getPage(1).getSize(), { width: 841.89, height: 595.276 });
  });
});

describe('PND3 validation and withholding re-export', () => {
  function setup(formType = 'PND3', status = 'OPEN') {
    const period: any = { id: 'p', formType, periodKey: '2026-09', status, dueDate: new Date('2099-10-31') };
    const event: any = { id: 'e', eventType: `WHT_${formType}`, whtFormType: formType, sourceType: 'expense.record', sourceId: 'expense-1', branchId: null,
      eventDate: new Date('2026-09-10'), currency: 'THB', payeeSnapshot: { name: 'ผู้รับเงิน', taxId: '1100700000001', address: '55 ถนนสุขุมวิท กรุงเทพ 10110', branchCode: null },
      incomeCategoryCode: formType === 'PND3' ? 'WHT_SERVICE_3' : 'WHT_SERVICE_5', whtRate: '3', grossAmount: '1000', withheldAmount: '30' };
    const events: any[] = [event];
    const payer: any = { registeredName: 'บริษัท ผู้จ่าย จำกัด', taxId: '0994000163011', addressJson: { line1: '123 ถนนลาดพร้าว', subdistrict: 'จอมพล', district: 'จตุจักร', province: 'กรุงเทพมหานคร', postalCode: '10900' } };
    const source = { vendorEntityKindSnapshot: formType === 'PND3' ? 'INDIVIDUAL' : 'JURISTIC' };
    const issues: any[] = [], transitions: string[] = [];
    let reserved = 0;
    const client: any = {
      company: { findUnique: async () => payer }, companyTaxProfile: { findUnique: async () => null },
      whtIncomeCategory: { findMany: async () => ['WHT_SERVICE_3', 'WHT_RENT_IND', 'WHT_PROFESSIONAL_IND', 'WHT_ADVERTISING_IND', 'WHT_TRANSPORT_IND', 'WHT_SERVICE_5'].map(code => ({ code, nameTh: 'ค่าบริการ', formType: code === 'WHT_SERVICE_5' ? 'PND53' : 'PND3' })) },
      expenseRecord: { findMany: async () => events.map(event => ({ id: event.sourceId, ...source })) }, branch: { findFirst: async () => null, findMany: async () => [] }, whtPayerModeFact: { findMany: async () => [] },
      taxReportSnapshot: { findFirst: async () => null, create: async ({ data }: any) => data },
      taxReviewIssue: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
      whtCertificate: { findMany: async () => [] },
      taxFilingPackage: { create: async ({ data }: any) => ({ id: 'pkg', ...data, status: 'GENERATED', generatedAt: new Date(), createdAt: new Date() }) },
    };
    const repo: any = { prisma: { client }, findPeriodById: async () => period, findEventsByPeriod: async () => events, findIssuesByPeriod: async () => issues,
      createIssue: async (input: any) => { issues.push(input); }, updatePeriodStatus: async (_c: string, _p: string, next: string) => { transitions.push(next); } };
    const persistence = filingStore(repo);
    const useCase = new GenerateTaxFilingPackageUseCase(repo, { execute: async () => { reserved++; return { id: 'seq', documentNumber: 'TX' }; } } as any,
      { execute: async () => undefined } as any, { log: async () => undefined } as any, persistence.storage);
    return { useCase, repo, ...persistence, period, event, events, payer, source, issues, transitions, client, get reserved() { return reserved; } };
  }
  it('R10 a missing source preserves FILED bytes and a correction opens only an additional paper', async () => {
    const h = setup();
    const filed = await h.useCase.execute(ctx, 'p', 'PDF');
    await h.repo.markWithholdingFilingFiled(h.client, ctx.companyId, filed.id, ctx.userId, new Date());
    h.period.status = 'FILED';
    const frozen = JSON.stringify(h.state.lines);
    const badEvent = { ...h.event, id: 'bad', sourceId: 'bad', sourceLineKey: 'payment:bad-payment', payeeSnapshot: { ...h.event.payeeSnapshot, taxId: null } };
    const badSource = expenseSourceForEvent(badEvent, { vendorEntityKindSnapshot: null });
    h.client.expensePayment = { findMany: async () => badSource.payments };
    const readSources = h.client.expenseRecord.findMany;
    h.client.expenseRecord.findMany = async (query: any) => {
      const rows = (await readSources(query)).filter((row: any) => row.id !== 'bad');
      return !query.where.id || query.where.id.in.includes('bad') ? [...rows, badSource] : rows;
    };
    const preserved = await h.useCase.execute(ctx, 'p', 'PDF');
    assert.equal(preserved.artifact.checksum, filed.artifact.checksum);
    assert.equal(preserved.artifact.contentBase64, filed.artifact.contentBase64);
    await assert.rejects(h.useCase.execute(ctx, 'p', 'PDF', '00000', 1), (error: any) => error.getResponse().issues.some((issue: any) => issue.sourceId === 'bad'));
    assert.equal(h.reserved, 1); assert.equal(JSON.stringify(h.state.lines), frozen);
    badSource.vendorEntityKindSnapshot = 'INDIVIDUAL'; badSource.vendorTaxIdSnapshot = '1100700000002'; badEvent.payeeSnapshot.taxId = '1100700000002';
    h.events.push(badEvent);
    const additional = await h.useCase.execute(ctx, 'p', 'PDF', '00000', 1);
    assert.match(additional.artifact.fileName, /เพิ่มเติมครั้งที่-1/);
    assert.equal((await h.useCase.execute(ctx, 'p', 'PDF', '00000', 0)).artifact.contentBase64, filed.artifact.contentBase64);
    assert.equal(h.state.objects.size, 2);
  });
  it('R10 serialization failures delete only the new stored object and preserve the earlier paper', async () => {
    for (const error of [{ code: 'P2034' }, { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '40001' } } } }]) {
      const h = setup('PND53');
      const earlier = await h.useCase.execute(ctx, 'p', 'PDF');
      const [earlierKey, earlierBytes] = [...h.state.objects.entries()][0] as [string, Buffer];
      const deleted: string[] = [];
      const remove = h.storage.deleteObject;
      h.storage.deleteObject = async (object: any) => { deleted.push(object.objectKey); await remove(object); };
      h.repo.recordWithholdingDownload = async () => { throw error; };
      await assert.rejects(h.useCase.execute(ctx, 'p', 'PDF'), (failure: any) => {
        assert.equal(failure.getResponse().code, 'WHT_FILING_CHANGED_DURING_DOWNLOAD');
        assert.equal(failure.getResponse().message, 'มีรายการเปลี่ยนระหว่างดาวน์โหลด ดาวน์โหลดอีกครั้ง');
        return true;
      });
      assert.equal(deleted.length, 1); assert.notEqual(deleted[0], earlierKey);
      assert.equal(h.state.objects.size, 1); assert.deepEqual(h.state.objects.get(earlierKey), earlierBytes);
      assert.equal(h.state.packages.length, 1); assert.equal(h.state.packages[0].id, earlier.id);
      assert.equal(h.state.attachments.length, 1);
    }
  });
  it('R10 missing-source blockers stop PDF and XLSX', async () => {
    for (const form of ['PND3', 'PND53']) for (const format of ['PDF', 'XLSX'] as const)
      for (const unknown of [false, true]) for (const accountant of [false, true]) for (const reverse of [false, true]) {
      const h = setup(form);
      const issue = { id: 'missing', taxPeriodId: unknown ? 'other-form' : 'p', sourceType: 'expense.record', sourceId: 'bad',
        issueCode: unknown ? 'WHT_PAYEE_KIND_UNKNOWN' : 'MISSING_TAX_ID', description: 'ข้อมูลผู้รับเงินยังไม่ครบ เปิดค่าใช้จ่ายแล้วแก้ไข', severity: 'BLOCKING', taxPeriod: { formType: unknown ? 'PND53' : form, periodKey: h.period.periodKey } };
      h.issues.push(issue);
      h.client.taxReviewIssue.findMany = async () => [issue];
      h.client.whtFilingLine.findMany = async () => [];
      const original = h.client.expenseRecord.findMany;
      h.client.expenseRecord.findMany = async (query: any) => query.where.whtAmount ? ['expense-1', 'bad'].map(id => ({
        id, companyId: 'c1', status: 'CONFIRMED', branchId: null, expenseDate: new Date('2026-09-10'), updatedAt: new Date('2026-09-10'),
        vendorNameSnapshot: 'ผู้รับเงิน', vendorEntityKindSnapshot: id === 'bad' && unknown ? null : h.source.vendorEntityKindSnapshot,
        vendorTaxIdSnapshot: id === 'bad' ? null : '1100700000001', vendorAddressSnapshot: 'กรุงเทพ', vendorCounterpartyId: null,
        whtAmount: '30', netPayableAmount: '970', taxableAmount: '1000', grandTotalAmount: '1000', whtRate: '3', whtCategoryCode: h.event.incomeCategoryCode,
        lines: [], payments: [{ id: id + '-payment', amount: '970', status: 'RECORDED', paidAtConfirmed: true, paidAt: new Date('2026-09-10'), createdAt: new Date('2026-09-10') }],
      })).sort(() => reverse ? -1 : 1) : original(query);
      if (accountant) {
        const categories = h.client.whtIncomeCategory.findMany;
        h.client.whtIncomeCategory.findMany = async () => (await categories()).map((c: any) => ({ ...c, filingRoute: 'ACCOUNTANT_PREPARES' }));
      }
      await assert.rejects(h.useCase.execute(ctx, 'p', format), (error: any) => {
        assert.equal(error.getStatus(), 409);
        assert.ok(error.getResponse().issues?.some((i: any) => i.sourceId === 'bad'));
        return true;
      });
      assert.equal(h.reserved, 0); assert.equal(h.state.objects.size, 0); assert.equal(h.state.packages.length, 0);
    }
  });
  it('opens two successive additional papers through the PDF and accountant routes without changing any filed bytes', async () => {
    for (const form of ['PND3', 'PND53']) for (const format of ['PDF', 'XLSX'] as const) {
      const h = setup(form);
      h.client.taxEvent = { findMany: async () => [] };
      h.client.whtCertificateHandoff = { findMany: async () => [] };
      if (format === 'XLSX') h.client.whtIncomeCategory.findMany = async () => [{ code: h.event.incomeCategoryCode, nameTh: 'อื่นๆ', formType: form, filingRoute: 'ACCOUNTANT_PREPARES' }];
      const original = await h.useCase.execute(ctx, 'p', format, '00000');
      await h.repo.markWithholdingFilingFiled(h.client, 'c1', original.id, 'u1', new Date());
      const normal = structuredClone(h.state.filing);
      h.period.dueDate = new Date('2000-01-01');
      for (const sequence of [1, 2]) {
        const late = { ...h.event, id: `late-${sequence}`, sourceId: `late-${sequence}`, grossAmount: '2000', withheldAmount: '60' };
        h.event.id = `resynced-${sequence}`;
        h.events.push(late);
        const downloaded = await h.useCase.execute(ctx, 'p', format, '00000', sequence);
        assert.equal(h.state.filing.sequence, sequence);
        assert.ok(downloaded.artifact.fileName.endsWith(`-00000-เพิ่มเติมครั้งที่-${sequence}.${format.toLowerCase()}`));
        assert.deepEqual(h.state.lines.map((l: any) => l.sourceId), [late.sourceId]);
        assert.equal(h.state.lines[0].lineJson.payment[7], '60');
        await h.repo.markWithholdingFilingFiled(h.client, 'c1', downloaded.id, 'u1', new Date());
        assert.equal((await h.useCase.execute(ctx, 'p', format, '00000', sequence)).artifact.contentBase64, downloaded.artifact.contentBase64);
        assert.deepEqual(h.papers.get(normal.id), normal);
        assert.equal((await h.useCase.execute(ctx, 'p', format, '00000')).artifact.contentBase64, original.artifact.contentBase64);
      }
      await assert.rejects(h.useCase.execute(ctx, 'p', format, '00000', 4), (e: any) => e.getResponse().code === 'WHT_FILING_SEQUENCE_INVALID');
    }
  });
  it('a changed payer mode and re-synced event never move or rewrite the filed source and file', async () => {
    const h = setup();
    const branches = [{ id: 'head', type: 'HEAD_OFFICE', status: 'ACTIVE', taxBranchCode: null, addressJson: h.payer.addressJson }, { id: 'b', type: 'BRANCH', status: 'ACTIVE', name: 'สาขา', taxBranchCode: '00002', addressJson: h.payer.addressJson }];
    const fact = { mode: 'HEAD_OFFICE_PAYS_ALL', effectiveFromPeriodKey: '2026-01', supersededAt: null };
    h.client.branch.findMany = async () => branches;
    h.client.branch.findFirst = async ({ where }: any) => branches.find(b => b.id === where.id);
    h.client.whtPayerModeFact.findMany = async () => [fact];
    h.event.branchId = 'b';
    const original = await h.useCase.execute(ctx, 'p', 'PDF', '00000');
    await h.repo.markWithholdingFilingFiled(h.client, 'c1', original.id, 'u1', new Date());
    const frozen = structuredClone(h.state.filing), lines = structuredClone(h.state.lines);
    fact.mode = 'EACH_BRANCH_PAYS'; h.event.id = 'resynced-event';
    h.events.push({ ...h.event, id: 'late', sourceId: 'late' });
    await h.useCase.execute(ctx, 'p', 'PDF', '00002');
    assert.deepEqual(h.state.lines.map((l: any) => l.sourceId), ['late']);
    assert.deepEqual(h.papers.get(frozen.id), frozen);
    assert.deepEqual((await h.client.whtFiling.findFirst({ where: { id: frozen.id } })).lines, lines);
    assert.equal((await h.useCase.execute(ctx, 'p', 'PDF', '00000')).artifact.contentBase64, original.artifact.contentBase64);
  });
  it('an unanswered other form does not block this form’s PDF or workbook, in either direction', async () => {
    for (const form of ['PND3', 'PND53']) for (const format of ['PDF', 'XLSX'] as const) {
      const h = setup(form);
      const branches = [{ id: 'head', type: 'HEAD_OFFICE', status: 'ACTIVE', name: 'ร้าน', taxBranchCode: null }, { id: 'b', type: 'BRANCH', status: 'ACTIVE', name: 'สาขา', taxBranchCode: '00002' }];
      h.client.branch.findMany = async () => branches;
      h.client.whtCertificateHandoff = { findMany: async () => [] };
      h.client.taxEvent = { findMany: async ({ where }: any) => where.eventType === 'WHT_PND2' ? [] : [h.event, { ...h.event, id: 'other-form', eventType: form === 'PND3' ? 'WHT_PND53' : 'WHT_PND3', branchId: 'b' }] };
      assert.ok((await h.useCase.execute(ctx, 'p', format)).artifact.byteLength > 0);
      h.events.push({ ...h.event, id: 'same-form-other-branch', sourceId: 'other', branchId: 'b' });
      await assert.rejects(h.useCase.execute(ctx, 'p', format), (e: any) => e.getResponse().code === 'WHT_PAYER_MODE_REQUIRED');
    }
  });
  it('keeps the single-establishment PDF bytes and only adds the code to its filename', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-05') });
    const { validateWithholdingFiling } = await import('../services/withholding-filing-validation');
    for (const form of ['PND3', 'PND53']) {
      const h = setup(form);
      const validation = await validateWithholdingFiling(h.client, 'c1', form as any, h.period, h.events, []);
      const before = form === 'PND3' ? await renderPnd3OfficialForm(validation.filing!) : await renderPnd53OfficialForm(validation.filing!);
      const after = await h.useCase.execute(ctx, 'p', 'PDF');
      assert.deepEqual(Buffer.from(after.artifact.contentBase64, 'base64'), Buffer.from(before));
      assert.match(after.artifact.fileName, /-00000\.pdf$/);
    }
  });
  it('isolates two establishment papers, payer addresses, stored files and scope for PDF and workbook', async () => {
    for (const format of ['PDF', 'XLSX'] as const) {
      const h = setup();
      const branches = [{ id: 'head', type: 'HEAD_OFFICE', status: 'ACTIVE', name: 'ร้าน', taxBranchCode: null },
        { id: 'b2', type: 'BRANCH', status: 'ACTIVE', name: 'สาขาสอง', taxBranchCode: '00002', addressJson: { ...h.payer.addressJson, line1: '88 ถนนสาขา' } }];
      h.client.branch.findMany = async () => branches;
      h.client.branch.findFirst = async ({ where }: any) => branches.find(b => b.id === where.id);
      h.client.whtPayerModeFact.findMany = async () => [{ mode: 'EACH_BRANCH_PAYS', effectiveFromPeriodKey: '2026-01', supersededAt: null }];
      h.events.push({ ...h.event, id: 'e2', sourceId: 'expense-2', branchId: 'b2' });
      h.client.taxEvent = { findMany: async () => [] };
      h.client.whtCertificateHandoff = { findMany: async () => [] };
      await assert.rejects(h.useCase.execute(ctx, 'p', format), (e: any) => e.getResponse().code === 'WHT_ESTABLISHMENT_REQUIRED');
      const first = await h.useCase.execute(ctx, 'p', format, '00000');
      const head = h.state.filing;
      assert.equal(head.establishmentCode, '00000'); assert.equal(h.state.lines.length, 1);
      assert.equal(h.state.lines[0].sourceId, 'expense-1');
      const second = await h.useCase.execute(ctx, 'p', format, '00002');
      assert.equal(h.papers.size, 2); assert.equal(h.state.lines[0].sourceId, 'expense-2');
      assert.equal(h.state.filing.payerSnapshotJson.payerBranch, '00002');
      assert.match(JSON.stringify(h.state.filing.payerSnapshotJson), /88/);
      assert.doesNotMatch(JSON.stringify(head.payerSnapshotJson), /88/);
      assert.match(first.artifact.fileName, /-00000\.(pdf|xlsx)$/); assert.match(second.artifact.fileName, /-00002\.(pdf|xlsx)$/);
      head.status = 'FILED';
      h.state.attachments[0].originalFileName = first.artifact.fileName.replace('-00000.', '.');
      assert.equal((await h.useCase.execute(ctx, 'p', format, '00000')).artifact.fileName, first.artifact.fileName, 'stored older names gain the code without rewriting the file');
      h.events[0].withheldAmount = '900';
      assert.equal((await h.useCase.execute(ctx, 'p', format, '00000')).artifact.contentBase64, first.artifact.contentBase64);
      assert.equal(h.papers.get(h.state.filing.id)?.status, 'EXPORTED');
      await assert.rejects(h.useCase.execute({ ...ctx, scopes: { branchIds: ['b2'] } }, 'p', format, '00000'), (e: any) => e.getResponse().code === 'WHT_ESTABLISHMENT_FORBIDDEN');
    }
  });
  it('accountant additional export warns about a cancelled filed payee and includes the new payment in full', async () => {
    const h = setup('PND53');
    h.client.taxEvent = { findMany: async () => [] };
    h.client.whtCertificateHandoff = { findMany: async () => [] };
    h.client.whtIncomeCategory.findMany = async () => [{ code: h.event.incomeCategoryCode, nameTh: 'อื่นๆ', formType: 'PND53', filingRoute: 'ACCOUNTANT_PREPARES' }];
    const first = await h.useCase.execute(ctx, 'p', 'XLSX', '00000');
    await h.repo.markWithholdingFilingFiled(h.client, 'c1', first.id, 'u1', new Date('2026-09-20'));
    const filed = JSON.stringify(h.state.lines);
    const old = h.events[0]; h.events.splice(0, 1, { ...old, id: 'new', sourceId: 'new', grossAmount: '2000', withheldAmount: '60' });
    h.client.expenseRecord.findMany = async ({ where }: any) => where.status === 'VOIDED'
      ? [{ id: old.sourceId, voidedAt: new Date('2026-09-21'), voidedByUserId: 'u2' }]
      : h.events.map(e => expenseSourceForEvent(e, h.source));
    const second = await h.useCase.execute(ctx, 'p', 'XLSX', '00000', 1);
    const file = Buffer.from(second.artifact.contentBase64, 'base64');
    let xml = '';
    for (let offset = 0; file.readUInt32LE(offset) === 0x04034b50;) {
      const size = file.readUInt32LE(offset + 18), nameLength = file.readUInt16LE(offset + 26);
      const start = offset + 30 + nameLength + file.readUInt16LE(offset + 28);
      const bytes = file.subarray(start, start + size);
      xml += (file.readUInt16LE(offset + 8) === 8 ? inflateRawSync(bytes) : bytes).toString();
      offset = start + size;
    }
    assert.ok(xml.includes('มีผู้รับเงินที่ถูกยกเลิกหลังยื่นในเดือนนี้: ผู้รับเงิน ให้ผู้ทำบัญชีตรวจยอดก่อนยื่น'));
    assert.equal(h.state.lines[0].lineJson.payment[7], '60');
    assert.equal((await h.useCase.execute(ctx, 'p', 'XLSX', '00000')).artifact.contentBase64, first.artifact.contentBase64);
    const normal = await h.client.whtFiling.findFirst({ where: { sequence: 0 } });
    assert.equal(JSON.stringify(normal.lines), filed);
  });
  it('freezes ordered lines, payer and stored bytes; replaces before filing and serves unchanged bytes after cancellation or addition', async () => {
    for (const form of ['PND3', 'PND53']) for (const format of ['PDF', 'XLSX'] as const) {
      const h = setup(form);
      h.event.sourceLineKey = 'payment:original';
      let paymentRecorded = true;
      h.client.expensePayment = { findMany: async () => paymentRecorded ? [{ id: 'original' }] : [] };
      h.client.taxEvent = { findMany: async () => [] };
      h.client.whtCertificateHandoff = { findMany: async () => [] };
      if (format === 'XLSX') h.client.whtIncomeCategory.findMany = async () => [{ code: h.event.incomeCategoryCode, nameTh: 'อื่นๆ', filingRoute: 'ACCOUNTANT_PREPARES' }];
      h.events.push({ ...h.event, id: 'earlier', sourceId: 'expense-2', eventDate: new Date('2026-09-01'), payeeSnapshot: { ...h.event.payeeSnapshot, branchCode: form === 'PND53' ? '00000' : null } });
      const first = await h.useCase.execute(ctx, 'p', format);
      assert.equal(h.state.filing.sequence, 0);
      assert.equal(h.state.filing.establishmentCode, '00000');
      assert.equal(h.state.filing.payerSnapshotJson.payerName, h.payer.registeredName);
      assert.equal(h.state.filing.preparedBy, format === 'XLSX' ? 'ACCOUNTANT' : 'SYSTEM');
      assert.deepEqual(h.state.lines.map((l: any) => [l.rowNumber, l.taxEventId]), [[1, 'earlier'], [2, 'e']]);
      assert.ok(h.state.lines.every((l: any) => l.lineJson.payment && (format === 'XLSX' ? l.lineJson.cells : l.lineJson.payeeName)));
      assert.equal(h.state.objects.size, 1);
      assert.equal(first.attachmentId, h.state.attachments[0].id);
      h.events.pop();
      const second = await h.useCase.execute(ctx, 'p', format);
      assert.equal(h.state.lines.length, 1);
      assert.notEqual(first.attachmentId, second.attachmentId);
      await h.repo.markWithholdingFilingFiled(h.client, ctx.companyId, second.id, ctx.userId, new Date(), 'ยื่นแล้ว');
      h.period.status = 'FILED';
      const frozen = JSON.stringify(h.state.lines), writes = h.state.writes;
      h.events.length = 0; // cancellation can leave no current rows at all
      h.payer.registeredName = ''; // even invalid live payer facts must not block the stored download
      const cancelled = await h.useCase.execute(ctx, 'p', format);
      assert.equal(cancelled.artifact.contentBase64, second.artifact.contentBase64);
      h.events.push({ ...h.event, id: 'new', sourceId: 'new-payment' });
      const added = await h.useCase.execute(ctx, 'p', format);
      assert.equal(added.artifact.contentBase64, second.artifact.contentBase64);
      assert.equal(JSON.stringify(h.state.lines), frozen);
      assert.equal(h.state.writes, writes);
      assert.equal(h.state.objects.size, 2, 'older package files are retained, never overwritten');
      h.state.objects.set(h.state.attachments[1].objectKey, Buffer.from('corrupt'));
      await assert.rejects(h.useCase.execute(ctx, 'p', format), (error: any) => error.getResponse().code === 'WHT_FILING_FILE_UNAVAILABLE');
      assert.equal(h.state.writes, writes, 'a missing/corrupt stored file never falls back to live rendering');
    }
  });
  it('legacy reconstructed snapshots require confirmation instead of replacing their uncertain rows', async () => {
    const h = setup('PND3', 'FILED');
    h.client.taxPeriod = { findMany: async () => [h.period] };
    h.client.taxEvent = { findMany: async () => h.events.map(event => ({ ...event, payeeSnapshotJson: event.payeeSnapshot })) };
    h.client.taxReviewIssue.findMany = async () => [];
    h.client.whtCertificateHandoff = { findMany: async () => [] };
    const { GenerateWhtReportUseCase } = await import('./generate-wht-report.use-case');
    const reader = new GenerateWhtReportUseCase(h.repo);
    const certainty = async () => (await reader.getMonth({ ...ctx, permissions: [], scopes: {} }, h.period.periodKey)).forms[0].rowsCertain;
    assert.equal(await certainty(), false, 'old FILED month is uncertain before its first new download');
    await h.useCase.execute(ctx, 'p', 'PDF');
    assert.equal(await certainty(), false, 'reconstruction is not proof of the original filed paper');
    assert.equal(h.state.filing.rowsCertain, false);
    assert.equal(h.state.filing.status, 'EXPORTED');
    h.event.grossAmount = '2000'; h.event.withheldAmount = '60';
    await assert.rejects(h.useCase.execute(ctx, 'p', 'PDF'), (e: any) => e.getResponse().code === 'WHT_FILING_ROWS_UNCERTAIN');
    assert.equal(h.state.lines[0].lineJson.income, 1000);
    assert.equal(h.period.status, 'FILED');
  });
  it('routes mixed service and prize payments by catalogue and groups interleaved payees before building rows', async () => {
    for (const formType of ['PND3', 'PND53'] as const) for (const sequence of [0, 1]) {
    const h = setup(formType);
    const prizeCode = formType === 'PND3' ? 'WHT_PRIZE' : 'WHT_PRIZE_JUR';
    h.client.whtIncomeCategory.findMany = async () => [
      { code: h.event.incomeCategoryCode, nameTh: 'ค่าบริการ', filingRoute: 'SYSTEM_FILLS' },
      { code: prizeCode, nameTh: 'รางวัลจากการประกวด แข่งขัน หรือชิงโชค (บุคคลธรรมดา)', filingRoute: 'SYSTEM_FILLS' },
    ];
    h.events.splice(0, 1, ...[1, 2, 3, 4, 5, 6].map((day, i) => ({ ...h.event, id: `e${i}`, sourceId: `expense-${i}`,
      eventDate: new Date(`2026-09-0${day}`), payeeSnapshot: { ...h.event.payeeSnapshot, taxId: [1, 3].includes(i) ? '1100700000002' : '1100700000001' },
      ...(i === 5 ? { incomeCategoryCode: prizeCode, whtRate: '5', withheldAmount: '50' } : {}),
    })));
    const { validateWithholdingFiling } = await import('../services/withholding-filing-validation');
    const result = await validateWithholdingFiling(h.client, 'c1', formType, h.period, h.events, [], undefined, sequence);
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.filing!.lines.map(row => row.paidAt.getUTCDate()), [1, 3, 5, 6, 2, 4]);
    let count = 0;
    await renderOfficialWithholdingForm({ main: join(__dirname, `../../assets/rd-${formType.toLowerCase()}-main.pdf`), annex: join(__dirname, `../../assets/rd-${formType.toLowerCase()}-attachment.pdf`) }, result.filing!,
      (_f, payees, _pages, income, tax) => { count = payees; assert.equal(income, 6000); assert.equal(tax, 200); return []; },
      (_f, _p, _pages, rows) => { assert.deepEqual(rows.map(row => row.length), [3, 1, 2]); assert.equal(rows[1][0].rate, 5); return []; });
    assert.equal(count, 3);
    }
  });
  it('an accountant route has no filing faults and exports every form payment plus PND2 on a second sheet', async () => {
    const h = setup('PND53'); h.event.incomeCategoryCode = 'WHT_OTHER_JUR';
    h.events.push({ ...h.event, id: 'service', sourceId: 'service-expense', incomeCategoryCode: 'WHT_SERVICE_5', payeeSnapshot: { ...h.event.payeeSnapshot, name: 'บริษัท บริการ' } });
    h.client.whtIncomeCategory.findMany = async () => [{ code: 'WHT_SERVICE_5', nameTh: 'ค่าบริการ', filingRoute: 'SYSTEM_FILLS' }, { code: 'WHT_OTHER_JUR', nameTh: 'อื่นๆ (นิติบุคคล)', filingRoute: 'ACCOUNTANT_PREPARES' }, { code: 'WHT_INTEREST', nameTh: 'ดอกเบี้ย (บุคคลธรรมดา)', filingRoute: 'SEPARATE_PND2' }];
    h.client.taxPeriod = { findFirst: async () => ({ id: 'p2' }) };
    h.client.taxEvent = { findMany: async () => [{ ...h.event, eventType: 'WHT_PND2', sourceId: 'expense-1', incomeCategoryCode: 'WHT_INTEREST', payeeSnapshotJson: h.event.payeeSnapshot }] };
    h.client.whtCertificateHandoff = { findMany: async () => [{ sourcePaymentType: 'expense.record', sourcePaymentId: 'service-expense', status: 'EXTERNAL_LINKED', externalCertificateNumber: 'EXT-50-1' }, { sourcePaymentType: 'expense.record', sourcePaymentId: h.event.sourceId, status: 'SYSTEM_ISSUED', certificateId: 'certificate' }] };
    h.client.whtCertificate.findMany = async ({ where }: any) => { assert.equal(where.companyId, ctx.companyId); assert.deepEqual(where.id.in, ['certificate']); return [{ id: 'certificate', certificateNumber: 'WHT-50-2' }]; };
    const { validateWithholdingFiling } = await import('../services/withholding-filing-validation');
    const result = await validateWithholdingFiling(h.client, 'c1', 'PND53', h.period, h.events, []);
    assert.equal(result.accountantPrepared, true); assert.deepEqual(result.issues, []); assert.equal(result.filing, null);
    await assert.rejects(h.useCase.execute(ctx, 'p', 'PDF'), (e: any) => e.getResponse().code === 'WHT_ACCOUNTANT_PREPARES');
    const artifact = (await h.useCase.execute(ctx, 'p', 'XLSX')).artifact;
    assert.match(artifact.fileName, /\.xlsx$/);
    const file = Buffer.from(artifact.contentBase64, 'base64');
    assert.equal(file.subarray(0, 2).toString(), 'PK');
    let xml = '';
    for (let offset = 0; file.readUInt32LE(offset) === 0x04034b50;) {
      const size = file.readUInt32LE(offset + 18), nameLength = file.readUInt16LE(offset + 26);
      const start = offset + 30 + nameLength + file.readUInt16LE(offset + 28);
      const bytes = file.subarray(start, start + size);
      xml += (file.readUInt16LE(offset + 8) === 8 ? inflateRawSync(bytes) : bytes).toString();
      offset = start + size;
    }
    for (const label of ['ภ.ง.ด.53', 'ภ.ง.ด.2', 'เลขผู้เสียภาษี', 'รวม', 'อื่นๆ (นิติบุคคล)', 'ดอกเบี้ย (บุคคลธรรมดา)', 'บริษัท บริการ', 'EXT-50-1', 'WHT-50-2', '<v>2000</v>', '<v>60</v>']) assert.ok(xml.includes(label), label);
    assert.deepEqual(h.transitions, ['EXPORTED']);
  });
  it('XLSX cannot bypass normal form validation when no type asks for an accountant', async () => {
    const h = setup(); h.event.payeeSnapshot.taxId = '';
    h.client.taxEvent = { findMany: async () => [] }; h.client.whtCertificateHandoff = { findMany: async () => [] };
    await assert.rejects(h.useCase.execute(ctx, 'p', 'XLSX'), (e: any) => e.getResponse().code === 'PND3_FILING_PAYEE');
    assert.equal(h.reserved, 0);
  });
  it('unoffered catalogue fixtures follow their route without a hard-coded income whitelist', async () => {
    const { validateWithholdingFiling } = await import('../services/withholding-filing-validation');
    for (const [formType, code, route] of [
      ['PND53', 'WHT_PRIZE_JUR', 'SYSTEM_FILLS'], ['PND53', 'WHT_INTEREST_JUR', 'ACCOUNTANT_PREPARES'],
      ['PND53', 'WHT_DIVIDEND', 'ACCOUNTANT_PREPARES'], ['PND3', 'WHT_OTHER_IND', 'ACCOUNTANT_PREPARES'],
    ] as const) {
      const h = setup(formType); h.event.incomeCategoryCode = code;
      h.client.whtIncomeCategory.findMany = async () => [{ code, nameTh: 'ประเภททดสอบ', formType, filingRoute: route, status: 'DRAFT' }];
      const result = await validateWithholdingFiling(h.client, 'c1', formType, h.period, h.events, []);
      assert.deepEqual(result.issues, []); assert.equal(result.accountantPrepared, route === 'ACCOUNTANT_PREPARES');
      if (route === 'SYSTEM_FILLS') assert.equal(result.filing!.lines[0].incomeType, 'ประเภททดสอบ');
    }
  });
  it('PND2 stays outside both month cards and has no system filing download', async () => {
    const { GenerateWhtReportUseCase } = await import('./generate-wht-report.use-case');
    const h = setup();
    const separate = { ...h.event, id: 'pnd2-event', sourceId: 'separate-expense', taxPeriodId: 'p2', eventType: 'WHT_PND2', incomeCategoryCode: 'WHT_INTEREST', grossAmount: '5000', withheldAmount: '50' };
    const originalCategories = h.client.whtIncomeCategory.findMany;
    h.client.whtIncomeCategory.findMany = async () => [...await originalCategories(), { code: 'WHT_INTEREST', nameTh: 'ดอกเบี้ย', formType: 'PND2', filingRoute: 'SEPARATE_PND2' }];
    h.client.taxPeriod = { findMany: async () => [h.period, { ...h.period, id: 'p2', formType: 'PND2' }] };
    h.client.taxEvent = { findMany: async () => [h.event, separate].map(event => ({ ...event, taxPeriodId: event.taxPeriodId ?? 'p', payeeSnapshotJson: event.payeeSnapshot })) };
    h.client.expenseRecord.findMany = async () => [h.event, separate].map(event => expenseSourceForEvent(event, h.source));
    h.client.taxReviewIssue.findMany = async () => [];
    h.client.whtCertificateHandoff = { findMany: async () => [] };
    h.client.$transaction = async (work: any) => work(h.client);
    const result = await new GenerateWhtReportUseCase({ prisma: { client: h.client } } as any).getMonth({ ...ctx, permissions: [], scopes: {} }, '2026-09');
    assert.deepEqual(result.forms.map(form => [form.paymentCount, form.totalPaid, form.totalWithheld]), [[1, '1000.0000', '30.0000'], [0, '0.0000', '0.0000']]);
    assert.equal(result.forms[0].issues.length, 0); assert.equal(result.payments.length, 1);
    assert.equal(result.separatePnd2![0].paid, '5000'); assert.equal(result.separatePnd2![0].incomeCategoryLabel, 'ดอกเบี้ย');
    h.period.formType = 'PND2';
    for (const format of ['PDF', 'XLSX'] as const) await assert.rejects(h.useCase.execute(ctx, 'p', format), (e: any) => e.getResponse().code === 'WHT_PND2_SEPARATE');
    assert.equal(h.reserved, 0);
  });
  it('tracks the downloaded payment set for both forms: additions, cancellation, amounts, re-download and filed months', async () => {
    const { GenerateWhtReportUseCase } = await import('./generate-wht-report.use-case');
    for (const formType of ['PND3', 'PND53']) {
      const h = setup(formType);
      let snapshot: any = null, pkg: any = null;
      h.client.taxReportSnapshot = { findFirst: async () => snapshot, create: async ({ data }: any) => { snapshot = data; return data; } };
      h.client.taxFilingPackage = { findFirst: async () => pkg, create: async ({ data }: any) => (pkg = { id: 'pkg', ...data, generatedAt: new Date(), createdAt: new Date() }) };
      h.client.taxPeriod = { findMany: async () => [h.period] };
      h.client.taxEvent = { findMany: async () => h.events.map(event => ({ ...event, taxPeriodId: 'p', payeeSnapshotJson: event.payeeSnapshot })) };
      h.client.taxReviewIssue.findMany = async () => [];
      h.client.whtCertificateHandoff = { findMany: async () => [] };
      h.client.$transaction = async (work: any) => work(h.client);
      const reader = new GenerateWhtReportUseCase({ prisma: { client: h.client } } as any);
      const stale = async () => (await reader.getMonth({ ...ctx, permissions: [], scopes: {} }, '2026-09')).forms.find(f => f.formType === formType)!.issues.some(i => i.issueCode === 'WHT_FILING_CHANGED_AFTER_DOWNLOAD');
      await h.useCase.execute(ctx, 'p', 'PDF'); h.period.status = 'EXPORTED';
      assert.equal(await stale(), false);
      h.events.push({ ...h.event, id: 'second', sourceId: 'expense-2' });
      assert.equal(await stale(), true, 'new payment invalidates the paper');
      await h.useCase.execute(ctx, 'p', 'PDF'); assert.equal(await stale(), false);
      const originalSources = h.client.expenseRecord.findMany;
      h.client.expenseRecord.findMany = async (args: any) => (await originalSources(args)).filter((row: any) => !args.where.status || row.id !== 'expense-2');
      assert.equal(await stale(), true, 'cancelled source invalidates the paper even before its event is retired');
      await h.useCase.execute(ctx, 'p', 'PDF'); assert.equal(await stale(), false, 'new paper excludes the cancelled source');
      h.client.expenseRecord.findMany = originalSources;
      h.events.pop(); assert.equal(await stale(), false, 'retiring a cancelled event does not change the new paper');
      await h.useCase.execute(ctx, 'p', 'PDF'); assert.equal(await stale(), false);
      h.event.grossAmount = '2000'; h.event.withheldAmount = '60';
      assert.equal(await stale(), true, 'changed amounts invalidate the paper');
      await h.useCase.execute(ctx, 'p', 'PDF'); assert.equal(await stale(), false);
      h.event.id = 'resynced'; h.event.grossAmount = '2000.0000';
      assert.equal(await stale(), false, 'event identity and decimal formatting are not payment changes');
      h.state.filing = null; h.papers.clear(); assert.equal(await stale(), true, 'legacy packages need frozen lines, not a checksum alone');
      for (const status of ['FILED', 'PAID', 'CLOSED']) { h.period.status = status; assert.equal(await stale(), false); }
    }
  });
  it('reads every current fault, drops repaired and historical filing faults, and exports the same clean facts', async () => {
    const { GenerateWhtReportUseCase } = await import('./generate-wht-report.use-case');
    for (const formType of ['PND3', 'PND53']) {
      const h = setup(formType);
      h.payer.registeredName = '';
      h.event.payeeSnapshot.address = null;
      h.events.push({ ...h.event, id: 'e2', sourceId: 'expense-2', payeeSnapshot: { ...h.event.payeeSnapshot, name: 'ผู้รับคนที่สอง' } });
      h.issues.push({ id: 'old', issueCode: `${formType}_FILING_CATEGORY`, description: 'old fault', taxPeriodId: 'p', severity: 'BLOCKING', sourceId: 'expense-1', sourceType: 'expense.record' });
      h.client.taxPeriod = { findMany: async () => [h.period] };
      h.client.taxEvent = { findMany: async () => h.events.map(event => ({ ...event, taxPeriodId: 'p', payeeSnapshotJson: event.payeeSnapshot })) };
      h.client.taxReviewIssue.findMany = async () => h.issues;
      h.client.expenseRecord.findMany = async () => h.events.map(event => expenseSourceForEvent(event, h.source));
      h.client.whtCertificateHandoff = { findMany: async () => [] };
      h.client.$transaction = async (work: any) => work(h.client);
      const reader = new GenerateWhtReportUseCase({ prisma: { client: h.client } } as any);
      const read = async () => (await reader.getMonth({ ...ctx, permissions: [], scopes: {} }, '2026-09')).forms.find(f => f.formType === formType)!;
      const faults = (await read()).issues;
      assert.equal(faults.filter(i => i.issueCode.endsWith('_PAYEE')).length, 2);
      assert.equal(faults.filter(i => i.issueCode.endsWith('_PAYER')).length, 1);
      assert.equal(faults.some(i => i.id === 'old'), false);
      assert.equal(new Set(faults.map(i => `${i.sourceId}:${i.issueCode}`)).size, faults.length);
      assert.match(faults.find(i => i.issueCode.endsWith('_PAYER'))!.description, /ข้อมูลร้านยังขาด: ชื่อจดทะเบียน/);
      assert.doesNotMatch(faults.find(i => i.issueCode.endsWith('_PAYER'))!.description, /เลขผู้เสียภาษี|ที่อยู่/);
      await assert.rejects(h.useCase.execute(ctx, 'p', 'PDF'), (error: any) => { assert.deepEqual([...error.getResponse().issues].sort((a: any, b: any) => a.id.localeCompare(b.id)), [...faults].sort((a, b) => a.id.localeCompare(b.id)));  return true; });
      h.payer.registeredName = 'ร้านครบแล้ว';
      assert.equal((await read()).issues.some(i => i.issueCode.endsWith('_PAYER')), false, 'repair is visible without a download');
      for (const event of h.events) event.payeeSnapshot.address = '55 ถนนสุขุมวิท กรุงเทพมหานคร';
      assert.deepEqual((await read()).issues, []);
      assert.equal((await h.useCase.execute(ctx, 'p', 'PDF')).artifact.fileName, `${formType === 'PND3' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53'}-2026-09-00000.pdf`);
      assert.equal(h.issues.length, 1, 'filing checks do not append historical issues');
    }
  });
  it('obsolete unknown sources clear while live period review issues still block', async () => {
    for (const formType of ['PND3', 'PND53']) {
      const h = setup(formType);
      h.issues.push({ id: 'unknown', issueCode: 'WHT_PAYEE_KIND_UNKNOWN', severity: 'BLOCKING', description: 'ยังไม่รู้ประเภทผู้รับเงิน', sourceType: 'expense.record', sourceId: 'unknown-expense' });
      await h.useCase.execute(ctx, 'p', 'PDF');
      h.issues.push({ id: 'missing', issueCode: 'MISSING_TAX_ID', severity: 'BLOCKING', description: 'ยังไม่มีเลขผู้เสียภาษี', sourceType: null, sourceId: null, taxPeriod: { formType } });
      h.client.taxReviewIssue.findMany = async () => h.issues.filter(i => i.id === 'missing');
      await assert.rejects(h.useCase.execute(ctx, 'p', 'PDF'), (error: any) => {
        assert.equal(error.getResponse().issues.some((i: any) => i.issueCode === 'MISSING_TAX_ID'), true);
        assert.equal(error.getResponse().issues.some((i: any) => i.issueCode === 'WHT_PAYEE_KIND_UNKNOWN'), false);
        return true;
      });
    }
  });
  it('returns a live Thai payer refusal on either form and permits retry after repair', async () => {
    for (const form of ['PND3', 'PND53']) {
      const h = setup(form); h.payer.registeredName = '';
      await assert.rejects(h.useCase.execute(ctx, 'p', 'PDF'), (error: any) => {
        assert.equal(error.getResponse().code, `${form}_FILING_PAYER`);
        assert.match(error.message, /ข้อมูลร้านยังขาด: ชื่อจดทะเบียน/); return true;
      });
      assert.equal(h.issues.length, 0);
      h.payer.registeredName = 'ร้านทดสอบ';
      await h.useCase.execute(ctx, 'p', 'PDF');
    }
  });
  it('names only missing or oversized fields and keeps one payee fault per payment', async () => {
    for (const formType of ['PND3', 'PND53']) {
      const h = setup(formType);
      h.payer.registeredName = 'ก'.repeat(81);
      h.payer.addressJson = null;
      h.event.payeeSnapshot = { name: 'สมชาย', taxId: '', address: null, branchCode: '123' };
      await assert.rejects(h.useCase.execute(ctx, 'p', 'PDF'), (error: any) => {
        const faults = error.getResponse().issues;
        const payer = faults.find((i: any) => i.issueCode.endsWith('_PAYER'));
        assert.match(payer.description, /ข้อมูลร้านยังขาด: ที่อยู่/);
        assert.match(payer.description, /ชื่อจดทะเบียนยาวเกินช่องของแบบ \(80 ตัวอักษร\)/);
        assert.doesNotMatch(payer.description, /เลขผู้เสียภาษี|รหัสสาขาภาษี/);
        const payees = faults.filter((i: any) => i.issueCode.endsWith('_PAYEE'));
        assert.equal(payees.length, 1);
        assert.match(payees[0].description, /สมชาย: ข้อมูลผู้รับเงินยังขาด: เลขผู้เสียภาษี · ที่อยู่/);
        assert.match(payees[0].description, /รหัสสาขาภาษีต้องมี 5 หลัก/);
        assert.doesNotMatch(payees[0].description, /ชื่อผู้รับเงินยาว/);
        return true;
      });
      assert.equal(h.reserved, 0);
    }
  });
  it('produces a PND3 packet with a blank individual branch', async () => {
    const h = setup();
    const result = await h.useCase.execute(ctx, 'p', 'PDF');
    assert.equal(result.artifact.fileName, 'ภ.ง.ด.3-2026-09-00000.pdf');
    assert.equal((await PDFDocument.load(Buffer.from(result.artifact.contentBase64, 'base64'))).getPageCount(), 2);
    assert.deepEqual(h.transitions, ['EXPORTED']);
  });
  it('refuses invalid individual facts in Thai before reserving and exposes a source review issue', async () => {
    const invalid = [
      (h: any) => { h.source.vendorEntityKindSnapshot = 'JURISTIC'; },
      (h: any) => { h.event.incomeCategoryCode = 'WHT_SERVICE_5'; },
      (h: any) => { h.event.payeeSnapshot.address = null; },
      (h: any) => { h.event.payeeSnapshot.taxId = '123'; },
      (h: any) => { h.event.payeeSnapshot.branchCode = '12'; },
      (h: any) => { h.event.whtRate = null; },
      (h: any) => { h.event.withheldAmount = '29'; },
      (h: any) => { h.event.currency = 'USD'; },
      (h: any) => { h.event.eventDate = new Date('2026-08-31'); },
      (h: any) => { h.payer.addressJson.postalCode = ''; },
      (h: any) => { h.period.dueDate = new Date('2000-01-01'); },
      (h: any) => { h.period.periodKey = '2026-13'; },
      (h: any) => { h.events.length = 0; },
      (h: any) => { h.events.push({ ...h.event, branchId: 'other' }); h.client.branch.findMany = async () => [{ id: 'head', type: 'HEAD_OFFICE', status: 'ACTIVE' }, { id: 'other', type: 'BRANCH', status: 'ACTIVE' }]; h.client.taxEvent = { findMany: async () => h.events }; },
      (h: any) => { h.event.branchId = 'missing'; h.client.branch.findMany = async () => [{ id: 'head', type: 'HEAD_OFFICE', status: 'ACTIVE' }, { id: 'missing', type: 'BRANCH', status: 'ACTIVE' }]; h.client.whtPayerModeFact.findMany = async () => [{ mode: 'EACH_BRANCH_PAYS', effectiveFromPeriodKey: '2026-01', supersededAt: null }]; },
      (h: any) => { h.event.sourceType = 'other'; },
      (h: any) => { h.event.eventType = 'WHT_PND53'; },
      (h: any) => { h.event.payeeSnapshot.name = ''; },
      (h: any) => { h.event.grossAmount = '0'; },
      (h: any) => { h.payer.taxId = '123'; },
    ];
    for (const change of invalid) {
      const h = setup(); change(h);
      await assert.rejects(h.useCase.execute(ctx, 'p', 'PDF'), (e: any) => {
        assert.match(e.message, /[ก-๙]/);
        assert.equal(e.getStatus(), 409);
        assert.ok(e.getResponse().code); if (e.getResponse().issues) assert.equal(e.getResponse().code, e.getResponse().issues[0].issueCode);
        if (e.getResponse().issues) { assert.equal(e.getResponse().message, e.getResponse().issues[0].description);
          assert.ok(e.getResponse().issues.every((issue: any) => issue.severity === 'BLOCKING')); }
        return true;
      });
      assert.equal(h.reserved, 0);
      assert.equal(h.issues.length, 0);
    }
  });
  it('accepts all five individual categories and a confirmed individual supplier payment', async () => {
    for (const category of ['WHT_SERVICE_3', 'WHT_RENT_IND', 'WHT_PROFESSIONAL_IND', 'WHT_ADVERTISING_IND', 'WHT_TRANSPORT_IND']) {
      const h = setup(); h.event.incomeCategoryCode = category; h.event.payeeSnapshot.branchCode = '00001';
      h.event.sourceType = 'procurement.supplier_payment';
      h.client.supplierPayment = { findMany: async () => [{ id: 'expense-1', supplier: { supplierType: 'INDIVIDUAL' } }] };
      assert.equal((await h.useCase.execute(ctx, 'p', 'PDF')).artifact.fileName, 'ภ.ง.ด.3-2026-09-00000.pdf');
    }
  });
  it('revalidates corrected facts while ignoring historical export review issues', async () => {
    const h = setup(); h.event.payeeSnapshot.address = null;
    await assert.rejects(h.useCase.execute(ctx, 'p', 'PDF'), (error: any) => {
      assert.equal(error.getResponse().issues[0].sourceId, 'expense-1');
      assert.equal(error.getResponse().issues[0].issueCode, 'PND3_FILING_PAYEE'); return true;
    });
    h.issues.push({ id: 'old', issueCode: 'PND3_FILING_PAYEE', severity: 'BLOCKING', description: 'old fault' });
    h.event.payeeSnapshot.address = '55 ถนนสุขุมวิท กรุงเทพมหานคร';
    await h.useCase.execute(ctx, 'p', 'PDF');
    assert.equal(h.reserved, 1);
    assert.equal(h.issues.length, 1, 'historical records stay historical; checks do not write them');
  });
  it('honours the Thai end of day at the default paper deadline', async (t) => {
    const h = setup(); h.period.dueDate = null;
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-07T16:59:59.999Z') });
    await h.useCase.execute(ctx, 'p', 'PDF');
    t.mock.timers.setTime(new Date('2026-10-07T17:00:00.000Z').getTime());
    await assert.rejects(h.useCase.execute(ctx, 'p', 'PDF'), /พ้นกำหนดยื่นแล้ว/);
  });
  it('never moves FILED, PAID or CLOSED backwards for either withholding form', async () => {
    for (const form of ['PND3', 'PND53']) for (const state of ['FILED', 'PAID', 'CLOSED']) {
      const h = setup(form, state);
      await h.useCase.execute(ctx, 'p', 'PDF');
      assert.deepEqual(h.transitions, []);
    }
  });
});


describe('official withholding packet payee rows and names', () => {
  for (const form of ['pnd3', 'pnd53']) for (const sequence of [0, 1]) it(`${form} sequence ${sequence}: four payments to one payee count as two attachment rows on the cover`, async () => {
    const line = { payeeName: 'สมหญิง ใจดี', payeeTaxId: '1100700000001', payeeBranch: '', payeeAddress: '55 กรุงเทพ 10110',
      paidAt: new Date('2026-09-10'), incomeType: 'ค่าบริการ', rate: 3, income: 1000, withheld: 30 };
    const filing = { sequence, periodKey: '2026-09', payerName: 'ร้านทดสอบ', payerTaxId: '0994000163011', payerBranch: '00000',
      payerAddress: { line1: '55', subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' },
      lines: Array.from({ length: 4 }, (_, i) => ({ ...line, paidAt: new Date(`2026-09-${10 + i}`) })) };
    let coverCount = 0;
    let rowPayments: number[] = [];
    const pdf = await renderOfficialWithholdingForm({ main: join(__dirname, `../../assets/rd-${form}-main.pdf`), annex: join(__dirname, `../../assets/rd-${form}-attachment.pdf`) }, filing,
      (_filing, payeeCount, annexCount, income, tax) => {
        coverCount = payeeCount; assert.equal(annexCount, 1); assert.equal(income, 4000); assert.equal(tax, 120); return [];
      }, (_filing, page, pages, rows) => {
        assert.equal(page, 1); assert.equal(pages, 1); rowPayments = rows.map(row => row.length);
        assert.ok(rows.every(row => row.every(payment => payment.payeeTaxId === line.payeeTaxId))); return [];
      });
    assert.deepEqual(rowPayments, [3, 1]); assert.equal(coverCount, 2); assert.equal(coverCount, rowPayments.length);
    assert.equal((await PDFDocument.load(pdf)).getPageCount(), 2);
  });
  it('splits PND3 first name with its explicit title from all remaining surname words', () => {
    for (const title of ['นาย', 'นาง', 'นางสาว', 'น.ส.', 'ด.ช.', 'ด.ญ.']) {
      for (const gap of ['', ' ']) assert.deepEqual(splitPnd3PayeeName(`${title}${gap}สมหญิง ใจดี`), [`${title}${gap}สมหญิง`, 'ใจดี']);
    }
    assert.deepEqual(splitPnd3PayeeName('สมหญิง'), ['สมหญิง', '']);
    assert.deepEqual(splitPnd3PayeeName('สมหญิง ใจดี มาก'), ['สมหญิง', 'ใจดี มาก']);
    assert.deepEqual(splitPnd3PayeeName('  น.ส.สมหญิง   ใจดี  '), ['น.ส.สมหญิง', 'ใจดี']);
    assert.deepEqual(splitPnd3PayeeName('ร้อยเอก สมชาย ใจดี'), ['ร้อยเอก', 'สมชาย ใจดี'], 'do not guess ranks');
  });
});

it('both official covers tick only additional, print its number, and leave surcharge and grand total blank', async () => {
  const { pnd3MainMarks } = await import('../../domain/logic/pnd3-official-form.logic');
  const { pnd53MainMarks } = await import('../../domain/logic/pnd53-official-form.logic');
  const filing: any = { periodKey: '2026-09', payerTaxId: '0994000163011', payerBranch: '00000', payerName: 'ร้าน', payerAddress: { line1: '1', subdistrict: 'จอมพล', district: 'จตุจักร', province: 'กรุงเทพมหานคร', postalCode: '10900' }, lines: [] };
  for (const [make, normalX, additionalX, additionalY, numberX, numberY, taxY, surchargeY, totalY] of [
    [pnd3MainMarks, 87.75, 183.97, 568.51, 288.43, 567.9, 316.7, 298.65, 280.7],
    [pnd53MainMarks, 375.65, 472.01, 646.54, 557.99, 645.7, 341.9, 322, 302],
  ] as const) {
    const marks = make({ ...filing, sequence: 2 }, 3, 1, 3000, 90);
    assert.ok(marks.some(m => m.x === additionalX && m.y === additionalY - 3.5 && m.value === '✓'));
    assert.ok(marks.some(m => m.x === numberX && m.y === numberY && m.value === '2'));
    assert.ok(!marks.some(m => m.x === normalX && m.value === '✓'));
    assert.ok(marks.some(m => m.y === taxY && m.value === '90'));
    assert.ok(!marks.some(m => m.y === surchargeY || m.y === totalY));
    const normal = make(filing, 3, 1, 3000, 90);
    assert.ok(normal.some(m => m.x === normalX && m.value === '✓'));
    assert.ok(normal.some(m => m.y === surchargeY && m.value === '0'));
  }
});

describe('legacy withholding papers', () => {
  async function legacyHarness(exact = false) {
    const { restoreLegacyWithholdingPeriod, confirmWithholdingRows } = await import('../services/legacy-withholding-filing');
    const events: any[] = [{ id: 'e', sourceType: 'expense.record', sourceId: 'old', branchId: null, eventType: 'WHT_PND3',
      eventDate: new Date('2026-09-01'), currency: 'THB', incomeCategoryCode: 'SERVICE', grossAmount: '1000', withheldAmount: '30', whtRate: '3',
      payeeSnapshotJson: { name: 'สมใจ', taxId: '1234567890123', address: 'บ้านเลขที่ 1 กรุงเทพ' } }];
    const { withholdingPaymentChecksum } = await import('../services/withholding-filing-state');
    const state: any = { papers: [], packages: [], objects: new Map(), audits: [], renders: 0 };
    const period: any = { id: 'old-period', companyId: 'c1', formType: 'PND3', periodKey: '2026-09', status: 'FILED', filedAt: new Date('2026-10-01') };
    const db: any = { $queryRaw: async () => [], $transaction: async (fn: any) => fn(db),
      taxPeriod: { findFirst: async () => period },
      taxEvent: { findMany: async () => events },
      taxFilingPackage: { findFirst: async () => ({ id: 'old-package', generatedByUserId: 'u1', generatedAt: new Date('2026-09-30'), exportFormat: 'PDF' }), create: async ({ data }: any) => { const row = { id: 'new-package', ...data }; state.packages.push(row); return row; } },
      taxReportSnapshot: { findFirst: async () => exact ? { checksum: withholdingPaymentChecksum(events.map(e => ({ ...e, payeeSnapshot: e.payeeSnapshotJson }))) } : null },
      whtFiling: { findFirst: async ({ where }: any) => state.papers.find((p: any) => !where.id || p.id === where.id) ?? null,
        create: async ({ data }: any) => { const p = { id: 'restored', ...data, lines: data.lines.create.map((l: any) => ({ ...l })) }; state.papers.push(p); return p; },
        updateMany: async ({ where, data }: any) => { const p = state.papers.find((p: any) => p.id === where.id && (where.rowsCertain === undefined || p.rowsCertain === where.rowsCertain)); if (!p) return { count: 0 }; Object.assign(p, data); return { count: 1 }; } },
      expenseRecord: { findMany: async () => [{ id: 'old', vendorEntityKindSnapshot: 'INDIVIDUAL' }] },
      company: { findUnique: async () => ({ registeredName: 'ร้าน', taxId: '0994000163011', addressJson: { line1: '1', subdistrict: 'คลองตัน', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' } }) },
      companyTaxProfile: { findUnique: async () => null }, branch: { findFirst: async () => null },
      whtIncomeCategory: { findMany: async () => [{ code: 'SERVICE', formType: 'PND3', nameTh: 'ค่าบริการ' }] },
      attachmentObject: { create: async ({ data }: any) => ({ id: 'attachment', ...data }) }, attachmentLink: { create: async () => ({}) },
      auditLog: { create: async ({ data }: any) => state.audits.push(data) },
    };
    const storage: any = { putObject: async ({ objectKey, bytes }: any) => { state.objects.set(objectKey, bytes); return { objectKey, bucket: 'local', storageProvider: 'local', byteSize: bytes.length, checksumSha256: 'hash' }; }, deleteObject: async () => assert.fail('no stored file may be deleted on success') };
    const render: any = async (p: any) => { state.renders++; assert.equal(p.lines.length, 1); return { fileName: 'แบบ.pdf', mimeType: 'application/pdf', contentBase64: Buffer.from('frozen-bytes').toString('base64'), checksum: 'hash', byteLength: 12 }; };
    return { state, db, period, restore: () => restoreLegacyWithholdingPeriod(db, storage, period, render), confirm: (actor = { ...ctx, permissions: ['wht.pnd53.prepare'] }) => confirmWithholdingRows(db, storage, actor, 'restored', render) };
  }
  it('restores exact rows once with a stored file; a second run leaves every byte and line untouched', async () => {
    const h = await legacyHarness(true);
    assert.equal(await h.restore(), 'exact');
    assert.equal(h.state.papers[0].rowsCertain, true); assert.equal(h.state.papers[0].status, 'FILED');
    const frozen = JSON.stringify(h.state.papers);
    assert.equal(await h.restore(), 'skipped'); assert.equal(h.state.renders, 1);
    assert.equal(JSON.stringify(h.state.papers), frozen); assert.equal(h.state.objects.size, 1);
  });
  it('reconstructs historical rows even if their income type now routes to a different form', async () => {
    const h = await legacyHarness(true);
    h.db.whtIncomeCategory.findMany = async () => [{ code: 'SERVICE', formType: 'PND2', filingRoute: 'SEPARATE_PND2', nameTh: 'ดอกเบี้ย' }];
    assert.equal(await h.restore(), 'exact');
    assert.equal(h.state.papers[0].lines.length, 1);
    assert.equal(h.state.papers[0].lines[0].lineJson.incomeType, 'ดอกเบี้ย');
    assert.equal(h.state.papers[0].lines[0].lineJson.payment[7], '30');
  });
  it('keeps unproven rows uncertain, confirms once with actor and audit, never replaces the lines', async () => {
    const h = await legacyHarness(); assert.equal(await h.restore(), 'uncertain');
    assert.equal(h.state.objects.size, 0); const lines = JSON.stringify(h.state.papers[0].lines);
    h.state.papers[0].status = 'EXPORTED'; // provisional snapshot made by the pre-release download path
    await assert.rejects(h.confirm({ ...ctx, permissions: [] }), (e: any) => e.getStatus() === 403);
    assert.equal(h.state.renders, 0);
    await h.confirm(); assert.equal(h.state.papers[0].rowsCertain, true);
    assert.equal(h.state.papers[0].status, 'FILED');
    assert.equal(h.state.papers[0].payerSnapshotJson.rowsConfirmation.userId, 'u1');
    assert.equal(h.state.audits.length, 1); assert.equal(h.state.renders, 1);
    await h.confirm(); assert.equal(h.state.renders, 1); assert.equal(h.state.audits.length, 1);
    assert.equal(JSON.stringify(h.state.papers[0].lines), lines);
  });
});
