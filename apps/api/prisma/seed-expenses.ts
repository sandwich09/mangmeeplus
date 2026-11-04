import { historicalExpensePaymentDateConfirmed } from '../src/modules/expenses/domain/logic/expense-payment-date.logic';
import { expenseEvidenceFingerprint, type ExpenseEvidenceAssessment } from '@watchdog-bms/contracts';
import type { PrismaClient, Prisma } from '../src/generated/prisma/client';
import type { PrismaService } from '../src/common/database/prisma.service';
import type { AppLogger } from '../src/common/logger/logger.service';
import { AuditService } from '../src/modules/audit/application/audit.service';
import { PrismaAuditRepository } from '../src/modules/audit/infrastructure/prisma-audit.repository';
import { PrismaExpenseRepository } from '../src/modules/expenses/infrastructure/prisma-expense.repository';
import { recordExpensePaymentEffects } from '../src/modules/expenses/application/use-cases/expense-draft.use-case';
import { expenseTaxSourceChecksum } from '../src/modules/expenses/domain/logic/expense-status.logic';
import { calcLineTotals } from '../src/modules/expenses/domain/logic/expense-totals.logic';
import { buildSeedPaymentProofPng, putSeedAttachmentObject } from './seed-attachment-storage';

// Kept separate so the money fixtures can be checked without connecting to a database.
export function seedExpenseRows(at: (dayOffset: number, hour: number, minute?: number) => Date) {
  return [
    {
      id: 'seed-expense-record-studio-supplies',
      lineId: 'seed-expense-line-studio-supplies',
      expenseNumber: 'EXP-LOCAL-0001',
      categoryId: 'seed-expense-category-office',
      vendor: 'บริษัท สตูดิโอ ซัพพลาย จำกัด',
      vendorEntityKindSnapshot: 'JURISTIC',
      vendorTaxIdSnapshot: '0994000000014',
      vendorAddressSnapshot: '1 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ กรุงเทพมหานคร 10110',
      vendorBranchCodeSnapshot: '00000',
      docNo: 'ST-INV-20260709',
      date: at(-1, 10),
      description: 'อุปกรณ์ทำความสะอาดสาขา',
      subtotal: '1850',
      vat: '129.50',
      wht: '0',
      total: '1979.50',
      netPayable: '1979.50',
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      paidAmount: '1979.50',
      payments: [{ amount: '1979.50', method: 'BANK_TRANSFER' }],
      vatMode: 'VAT_EXCLUDED',
      inputVatClaimStatus: 'CLAIMABLE',
      accountHintKey: 'expense.office_supplies',
      captureSource: 'WEB_MANUAL',
      sourceDocumentType: 'TAX_INVOICE',
      taxEvidenceStatus: 'USABLE_FOR_TAX',
      duplicateStatus: 'NO_MATCH',
      note: 'Seed expense for local DB/API verification.',
    },
    {
      id: 'seed-expense-record-ads',
      lineId: 'seed-expense-line-ads',
      expenseNumber: 'EXP-LOCAL-0002',
      categoryId: 'seed-expense-category-marketing',
      vendor: 'Meta Ads Thailand',
      docNo: 'ADS-LOCAL-001',
      date: at(-2, 11),
      description: 'ค่าโฆษณาแคมเปญจองคิว',
      subtotal: '3200',
      vat: '224',
      wht: '0',
      total: '3424',
      netPayable: '3424',
      status: 'READY_FOR_CONFIRMATION',
      paymentStatus: 'UNPAID',
      paidAmount: '0',
      payments: [],
      vatMode: 'VAT_EXCLUDED',
      inputVatClaimStatus: 'CLAIMABLE',
      accountHintKey: 'expense.marketing',
      captureSource: 'WEB_UPLOAD',
      sourceDocumentType: 'TAX_INVOICE',
      taxEvidenceStatus: 'NEEDS_REVIEW',
      duplicateStatus: 'NO_MATCH',
      note: 'Seed marketing spend waiting for confirmation.',
    },
    {
      id: 'seed-expense-record-rent',
      lineId: 'seed-expense-line-rent',
      expenseNumber: 'EXP-LOCAL-0003',
      categoryId: 'seed-expense-category-rent',
      vendor: 'บริษัท พื้นที่สวย จำกัด',
      vendorEntityKindSnapshot: 'JURISTIC',
      vendorTaxIdSnapshot: '0994000000022',
      vendorAddressSnapshot: '1 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ กรุงเทพมหานคร 10110',
      vendorBranchCodeSnapshot: '00000',
      docNo: 'RENT-202607',
      date: at(-6, 9),
      description: 'ค่าเช่าพื้นที่สาขาประจำเดือน',
      subtotal: '30000',
      vat: '0',
      wht: '1500',
      whtRate: '5',
      whtCategoryCode: 'WHT_RENT_JUR',
      total: '30000',
      netPayable: '28500',
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      paidAmount: '28500',
      payments: [{ amount: '28500', method: 'BANK_TRANSFER' }],
      vatMode: 'NO_VAT',
      inputVatClaimStatus: 'NON_CLAIMABLE',
      accountHintKey: 'expense.rent',
      captureSource: 'WEB_MANUAL',
      sourceDocumentType: 'SUPPLIER_BILL',
      taxEvidenceStatus: 'SUPPORTING_ONLY',
      duplicateStatus: 'NO_MATCH',
      note: 'ค่าเช่าหัก ณ ที่จ่าย 5%: ยอดตั้งหนี้ 30,000 บาท จ่ายสุทธิ 28,500 บาท',
    },
    {
      id: 'seed-expense-record-electricity',
      lineId: 'seed-expense-line-electricity',
      expenseNumber: 'EXP-LOCAL-0004',
      categoryId: 'seed-expense-category-utilities',
      vendor: 'การไฟฟ้านครหลวง',
      vendorEntityKindSnapshot: 'JURISTIC',
      vendorTaxIdSnapshot: '0994000000031',
      vendorAddressSnapshot: '1 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ กรุงเทพมหานคร 10110',
      vendorBranchCodeSnapshot: '00000',
      docNo: 'MEA-LOCAL-0726',
      date: at(-5, 13),
      description: 'ค่าไฟฟ้าสาขา',
      subtotal: '4200',
      vat: '294',
      wht: '0',
      total: '4494',
      netPayable: '4494',
      status: 'CONFIRMED',
      paymentStatus: 'PARTIALLY_PAID',
      paidAmount: '2000',
      payments: [{ amount: '2000', method: 'BANK_TRANSFER' }],
      vatMode: 'VAT_EXCLUDED',
      inputVatClaimStatus: 'CLAIMABLE',
      accountHintKey: 'expense.utilities',
      captureSource: 'LINE_UPLOAD',
      sourceDocumentType: 'TAX_INVOICE',
      taxEvidenceStatus: 'USABLE_FOR_TAX',
      duplicateStatus: 'NO_MATCH',
      note: 'เคสจ่ายบางส่วน คงค้าง 2,494 บาท',
    },
    {
      id: 'seed-expense-record-team-meal',
      lineId: 'seed-expense-line-team-meal',
      expenseNumber: 'EXP-LOCAL-0005',
      categoryId: 'seed-expense-category-meals',
      vendor: 'ร้านครัวอารีย์',
      docNo: 'CASH-0726-018',
      date: at(-3, 19),
      description: 'อาหารทีมหลังปิดร้าน',
      subtotal: '850',
      vat: '0',
      wht: '0',
      total: '850',
      netPayable: '850',
      status: 'NEEDS_REVIEW',
      paymentStatus: 'UNPAID',
      paidAmount: '0',
      payments: [],
      vatMode: 'NO_VAT',
      inputVatClaimStatus: 'NON_CLAIMABLE',
      accountHintKey: 'expense.meals',
      captureSource: 'LINE_UPLOAD',
      sourceDocumentType: 'HANDWRITTEN_CASH_BILL',
      taxEvidenceStatus: 'SUPPORTING_ONLY',
      duplicateStatus: 'NO_MATCH',
      note: 'บิลเงินสดไม่มีใบกำกับภาษี รอตรวจวัตถุประสงค์ทางธุรกิจ',
    },
    {
      id: 'seed-expense-record-ads-duplicate',
      lineId: 'seed-expense-line-ads-duplicate',
      expenseNumber: 'EXP-LOCAL-0006',
      categoryId: 'seed-expense-category-marketing',
      vendor: 'Meta Ads Thailand',
      docNo: 'ADS-LOCAL-001',
      date: at(-2, 11),
      description: 'ค่าโฆษณาแคมเปญจองคิว (อัปโหลดซ้ำ)',
      subtotal: '3200',
      vat: '224',
      wht: '0',
      total: '3424',
      netPayable: '3424',
      status: 'NEEDS_REVIEW',
      paymentStatus: 'UNPAID',
      paidAmount: '0',
      payments: [],
      vatMode: 'VAT_EXCLUDED',
      inputVatClaimStatus: 'NEEDS_REVIEW',
      accountHintKey: 'expense.marketing',
      captureSource: 'WEB_UPLOAD',
      sourceDocumentType: 'TAX_INVOICE',
      taxEvidenceStatus: 'NEEDS_REVIEW',
      duplicateStatus: 'POSSIBLE_DUPLICATE',
      note: 'เคสเอกสารเลขที่และยอดตรงกัน ต้องไม่ถูกรวมยอดก่อนผู้ใช้ยืนยัน',
    },
    {
      id: 'seed-expense-record-e-wht-advertising', lineId: 'seed-expense-line-e-wht-advertising',
      expenseNumber: 'EXP-LOCAL-0007', categoryId: 'seed-expense-category-marketing',
      vendor: 'บริษัท โฆษณาธนาคาร ตัวอย่าง จำกัด', vendorEntityKindSnapshot: 'JURISTIC',
      vendorTaxIdSnapshot: '0994000000014', vendorAddressSnapshot: '1 ถนนทดสอบ กรุงเทพมหานคร 10110', vendorBranchCodeSnapshot: '00000',
      docNo: 'EWHT-MIXED-BANK', date: at(0, 10), description: 'ค่าโฆษณา e-WHT ตัวอย่าง',
      subtotal: '10000', vat: '0', wht: '100', whtRate: '1', whtCategoryCode: 'WHT_ADVERTISING_JUR', whtRemittance: 'E_WHT',
      total: '10000', netPayable: '9900', status: 'CONFIRMED', paymentStatus: 'PAID', paidAmount: '9900',
      payments: [{ amount: '9900', method: 'BANK_TRANSFER', paidAtConfirmed: true }], vatMode: 'NO_VAT', inputVatClaimStatus: 'NON_CLAIMABLE',
      accountHintKey: 'expense.marketing', captureSource: 'WEB_MANUAL', sourceDocumentType: 'RECEIPT',
      taxEvidenceStatus: 'SUPPORTING_ONLY', duplicateStatus: 'NO_MATCH', note: 'EWHT_MIXED_MONTH: E_WHT',
    },
    {
      id: 'seed-expense-record-payer-files-rent', lineId: 'seed-expense-line-payer-files-rent',
      expenseNumber: 'EXP-LOCAL-0008', categoryId: 'seed-expense-category-rent',
      vendor: 'บริษัท บริการยื่นเอง ตัวอย่าง จำกัด', vendorEntityKindSnapshot: 'JURISTIC',
      vendorTaxIdSnapshot: '0994000000014', vendorAddressSnapshot: '1 ถนนทดสอบ กรุงเทพมหานคร 10110', vendorBranchCodeSnapshot: '00000',
      docNo: 'EWHT-MIXED-PAYER', date: at(0, 10), description: 'ค่าเช่าร้านยื่นแบบเองตัวอย่าง',
      subtotal: '10000', vat: '0', wht: '500', whtRate: '5', whtCategoryCode: 'WHT_RENT_JUR', whtRemittance: 'PAYER_FILES',
      total: '10000', netPayable: '9500', status: 'CONFIRMED', paymentStatus: 'PAID', paidAmount: '9500',
      payments: [{ amount: '9500', method: 'BANK_TRANSFER', paidAtConfirmed: true }], vatMode: 'NO_VAT', inputVatClaimStatus: 'NON_CLAIMABLE',
      accountHintKey: 'expense.rent', captureSource: 'WEB_MANUAL', sourceDocumentType: 'RECEIPT',
      taxEvidenceStatus: 'SUPPORTING_ONLY', duplicateStatus: 'NO_MATCH', note: 'EWHT_MIXED_MONTH: PAYER_FILES',
    },
  ] as const;
}

type SeedExpense = ReturnType<typeof seedExpenseRows>[number];
type SeedExpenseOwner = { companyId: string; branchId: string; ownerUserId: string };

export function seedExpenseData(row: SeedExpense, owner: SeedExpenseOwner) {
  const wht = 'whtRate' in row ? { ...('whtRemittance' in row && { whtRemittance: row.whtRemittance }), whtRate: row.whtRate, whtCategoryCode: row.whtCategoryCode } : {};
  const payee = 'vendorTaxIdSnapshot' in row ? {
    vendorEntityKindSnapshot: row.vendorEntityKindSnapshot, vendorTaxIdSnapshot: row.vendorTaxIdSnapshot,
    vendorAddressSnapshot: row.vendorAddressSnapshot, vendorBranchCodeSnapshot: row.vendorBranchCodeSnapshot,
  } : {};
  const line = {
    id: row.lineId, companyId: owner.companyId, expenseId: row.id, lineNumber: 1,
    description: row.description, quantity: '1', unitPrice: row.subtotal,
    vatRate: Number(row.vat) > 0 ? '0.07' : null,
    // ExpenseLine rates are fractions; the header/category rate is a percent.
    whtRate: 'whtRate' in row ? String(Number(row.whtRate) / 100) : null,
    expenseCategoryId: row.categoryId, accountHintKey: row.accountHintKey, reviewStatus: 'REVIEWED' as const,
  };
  const totals = calcLineTotals({ ...line, vatMode: row.vatMode });
  const record: Prisma.ExpenseRecordUncheckedCreateInput = {
    id: row.id, companyId: owner.companyId, branchId: owner.branchId, expenseNumber: row.expenseNumber,
    status: row.status === 'CONFIRMED' ? 'READY_FOR_CONFIRMATION' : row.status,
    captureSource: row.captureSource, vendorNameSnapshot: row.vendor, vendorDocumentNumber: row.docNo,
    ...payee, ...wht, expenseDate: row.date, receivedAt: row.date, uploadedAt: row.date,
    currency: 'THB', vatMode: row.vatMode, inputVatClaimStatus: row.inputVatClaimStatus,
    subtotalAmount: row.subtotal, taxableAmount: row.subtotal, vatAmount: row.vat,
    whtAmount: row.wht, grandTotalAmount: row.total, netPayableAmount: row.netPayable,
    paidAmount: '0', outstandingAmount: row.netPayable, paymentStatus: 'UNPAID',
    expenseCategoryId: row.categoryId, accountHintKey: row.accountHintKey,
    duplicateStatus: row.duplicateStatus,
    aiVerificationStatus: row.duplicateStatus === 'POSSIBLE_DUPLICATE' ? 'NEEDS_REVIEW' : 'HUMAN_VERIFIED',
    ...(row.status === 'CONFIRMED' && { reviewedAt: row.date, reviewedByUserId: owner.ownerUserId }),
    sourceDocumentType: row.sourceDocumentType, taxEvidenceStatus: row.taxEvidenceStatus,
    note: row.note, createdByUserId: owner.ownerUserId,
    // The meal's existing supporting files deliberately remain eligible for the certificate demo.
    primaryAttachmentId: row.id === 'seed-expense-record-team-meal' ? null : row.id.replace('record', 'attachment') + '-receipt',
  };
  return { record, line: { ...line, ...totals } };
}

/** Fresh fixtures use the real confirmation/payment transactions. Existing demo work is never reset. */
export async function seedExpenses(client: PrismaClient, owner: SeedExpenseOwner,
  rows: readonly SeedExpense[]) {
  const service = { client } as PrismaService;
  const repo = new PrismaExpenseRepository(service);
  const audit = new AuditService(new PrismaAuditRepository(service), console as unknown as AppLogger);
  const bytes = buildSeedPaymentProofPng();
  for (const row of rows) {
    if (await client.expenseRecord.findUnique({ where: { id: row.id } })) continue;
    if ('whtRemittance' in row && row.whtRemittance === 'E_WHT') await client.companyTaxProfile.upsert({
      where: { companyId: owner.companyId }, create: { companyId: owner.companyId, eWhtUsed: true }, update: { eWhtUsed: true },
    });
    const { record, line } = seedExpenseData(row, owner);
    // Upload first: the generic private-file reader uses object storage, not AttachmentBlob.
    const stored = record.primaryAttachmentId ? await putSeedAttachmentObject({
      objectKey: `seed/${owner.companyId}/expenses/${record.primaryAttachmentId}.png`, mimeType: 'image/png', bytes,
    }) : null;
    await client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seed:${owner.companyId}:${row.id}`}))`;
      if (await tx.expenseRecord.findUnique({ where: { id: row.id } })) return;
      if (record.primaryAttachmentId && stored) {
        // Trusted passive fixtures go through the same local/S3 store as the other seed files.
        await tx.attachmentObject.create({ data: {
          id: record.primaryAttachmentId, companyId: owner.companyId, branchId: owner.branchId,
          ...stored,
          originalFileName: `${row.expenseNumber}.png`, mimeType: 'image/png', byteSize: bytes.length,
          status: 'ACTIVE', visibility: 'INTERNAL', uploadedAt: row.date,
          uploadedByUserId: owner.ownerUserId, metadataJson: { seededPreviewFixture: true },
        } });
        await tx.attachmentLink.create({ data: {
          id: `${record.primaryAttachmentId}-link`, companyId: owner.companyId, attachmentId: record.primaryAttachmentId,
          targetType: 'expense.record', targetId: row.id, purpose: 'expense.receipt.primary', linkedByUserId: owner.ownerUserId,
        } });
      }
      await tx.expenseRecord.create({ data: record });
      await tx.expenseLine.create({ data: line });
      if (row.status !== 'CONFIRMED') return;

      // The paid command key precedes the funding/lifecycle locks taken by confirmation.
      const idempotencyKey = `client:seed-payment-${row.id}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${owner.companyId}:${idempotencyKey}:expense-payment-command`}))`;
      const reviewed = (await repo.findByIdWithRelations(owner.companyId, row.id, tx))!;
      const assessment: ExpenseEvidenceAssessment = {
        route: 'SOURCE_DOCUMENT', receiptProblem: 'NONE', reason: '', attachmentIds: [record.primaryAttachmentId!],
      };
      await tx.expenseRecord.update({ where: { id: row.id }, data: { aiVerificationSummaryJson: { documentReview: {
        version: 2, reviewedAt: row.date.toISOString(), reviewedByUserId: owner.ownerUserId,
        assessment, fingerprint: expenseEvidenceFingerprint(reviewed, assessment),
      } } } });
      const source = (await repo.findByIdWithRelations(owner.companyId, row.id, tx))!;
      const requestId = `seed:${row.id}`;
      await repo.finalizeAndConfirmExpenseCas({
        companyId: owner.companyId, id: row.id, actorUserId: owner.ownerUserId,
        expectedUpdatedAt: source.updatedAt, expectedSourceChecksum: expenseTaxSourceChecksum(source),
        postingStatus: 'pending', vendorSnapshotJson: null, confirmationAudit: { requestId },
        outboxEvent: { eventKey: `expense.confirmed:expense_record:${row.id}:${requestId}`,
          payloadJson: { companyId: owner.companyId, aggregateType: 'expense_record', aggregateId: row.id,
            requestId, occurredAt: row.date.toISOString(), data: { expenseId: row.id, postingStatus: 'pending' } } },
      }, async () => [], tx); // These legacy demo lines have no selected transaction Tax Code to finalize.
      const ctx = { companyId: owner.companyId, userId: owner.ownerUserId, requestId,
        authSubject: owner.ownerUserId, membershipId: 'seed', roles: ['OWNER'], authProvider: 'system' as const,
        permissions: ['expense.payment.record'], scopes: {} };
      for (const payment of row.payments) {
        await repo.recordPaymentInTransaction(tx, {
          companyId: owner.companyId, expenseId: row.id, actorUserId: owner.ownerUserId, scopes: {},
          idempotencyKey, amount: payment.amount, paymentMethod: payment.method, paidAt: row.date.toISOString().slice(0, 10), paidAtConfirmed: 'paidAtConfirmed' in payment ? payment.paidAtConfirmed : historicalExpensePaymentDateConfirmed(idempotencyKey),
        }, (db, result) => recordExpensePaymentEffects(audit, ctx, row.id, db, result));
      }
    });
  }
}
