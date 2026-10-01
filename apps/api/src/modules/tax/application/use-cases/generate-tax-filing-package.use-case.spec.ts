import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GenerateTaxFilingPackageUseCase } from './generate-tax-filing-package.use-case.js';
import { PDFDocument } from 'pdf-lib';
import { printablePnd53PayeeAddress, renderPnd53OfficialForm } from '../../domain/logic/pnd53-official-form.logic';

const ctx = { companyId: 'c1', userId: 'u1', requestId: 'r1' } as any;
function harness(reconciliation: any, issues: any[] = []) {
  const period = { id: 'p1', companyId: 'c1', taxType: 'VAT', formType: 'PP30', periodKey: '2026-07', status: 'REVIEWED', createdAt: new Date(), updatedAt: new Date() };
  const taxRepo = {
    findPeriodById: async () => period,
    findEventsByPeriod: async () => [],
    findIssuesByPeriod: async () => issues,
    updatePeriodStatus: async () => period,
    prisma: { client: {
      taxReportSnapshot: { findFirst: async () => null }, taxReconciliationRun: { findFirst: async () => reconciliation },
      taxFilingPackage: { create: async ({ data }: any) => ({ id: 'pkg1', ...data, status: 'GENERATED', generatedAt: new Date(), downloadedAt: null, voidedAt: null, filedManuallyAt: null, createdAt: new Date() }) },
    } },
  } as any;
  return new GenerateTaxFilingPackageUseCase(taxRepo, { execute: async () => ({ id: 'seq1', documentNumber: 'TX-1' }) } as any, { execute: async () => undefined } as any, { log: async () => undefined } as any);
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
      findIssuesByPeriod: async () => [], updatePeriodStatus: async () => period,
      prisma: { client: {
        taxReportSnapshot: { findFirst: async () => null },
        company: { findUnique: async () => ({ registeredName: 'บริษัท ผู้จ่าย จำกัด', taxId: '0994000163011',
          addressJson: { line1: '123/4 ถนนลาดพร้าว', subdistrict: 'จอมพล', district: 'จตุจักร', province: 'กรุงเทพมหานคร', postalCode: '10900' } }) },
        companyTaxProfile: { findUnique: async () => null },
        whtIncomeCategory: { findMany: async () => [{ code: 'WHT_SERVICE_5', nameTh: 'ค่าบริการ (นิติบุคคล)' }, { code: 'WHT_DIVIDEND', nameTh: 'เงินปันผล' }] },
        expenseRecord: { findFirst: async () => ({ vendorEntityKindSnapshot: 'JURISTIC' }) },
        taxFilingPackage: { create: async ({ data }: any) => ({ id: 'pkg53', ...data, status: 'GENERATED', generatedAt: new Date(), createdAt: new Date() }) },
      } },
    } as any;
    const useCase = new GenerateTaxFilingPackageUseCase(taxRepo,
      { execute: async () => { reserved++; return { id: 'seq53', documentNumber: 'TX-53' }; } } as any,
      { execute: async () => undefined } as any, { log: async () => undefined } as any);
    return { useCase, get reserved() { return reserved; } };
  }

  it('exports a printable RD main form and attachment without form widgets', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: filingDay });
    const harness = pnd53Harness();
    const result = await harness.useCase.execute(ctx, 'p53', 'PDF');
    const pdf = await PDFDocument.load(Buffer.from(result.artifact.contentBase64, 'base64'));
    assert.equal(pdf.getPageCount(), 2);
    assert.equal(pdf.getForm().getFields().length, 0);
    assert.equal(result.artifact.fileName, 'PND53-2026-09.pdf');
    assert.equal(harness.reserved, 1);
  });

  it('refuses missing payee address before reserving a filing number', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: filingDay });
    const harness = pnd53Harness({ payeeSnapshot: { ...event.payeeSnapshot, address: null } });
    await assert.rejects(() => harness.useCase.execute(ctx, 'p53', 'PDF'), /complete payee/);
    assert.equal(harness.reserved, 0);
  });

  it('refuses a category whose statutory section is not present in the source event', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: filingDay });
    const harness = pnd53Harness({ incomeCategoryCode: 'WHT_DIVIDEND' });
    await assert.rejects(() => harness.useCase.execute(ctx, 'p53', 'PDF'), /income category/);
    assert.equal(harness.reserved, 0);
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
});
