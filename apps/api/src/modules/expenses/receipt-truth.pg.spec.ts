/**
 * Spec `line-ai-draft-control-spec-th.md` §11, against real PostgreSQL.
 *
 * Slice A decides three things that only a database can prove it actually WROTE: which VAT rate a
 * charge row carries, whether a withholding rate reached that row, and what the record's date and
 * `aiVerificationStatus` are once an unread date has been reviewed. Every one of those is a
 * `Decimal`, an enum or a `@db.Date` column, and an in-memory fake settles all three by echoing
 * whatever the service handed it — including a `null` rate a real column would have to accept, and
 * a `'NEEDS_REVIEW'` line status that has never been written before this slice.
 *
 * The note append is here for the same reason: the correction lane runs inside ONE transaction with
 * two advisory locks, and the cap it enforces is a property of the string that lands in the column.
 *
 * Run with:
 *   RECEIPT_TRUTH_TEST_DATABASE_URL='postgresql://…@127.0.0.1:15432/watchdog_bms?schema=public' \
 *     npx tsx --test src/modules/expenses/receipt-truth.pg.spec.ts
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { pgSpecUnreachableReason } from '../../common/database/pg-spec-guard';
import { AuditService } from '../audit/application/audit.service';
import { PrismaAuditRepository } from '../audit/infrastructure/prisma-audit.repository';
import { PrismaExpenseRepository } from './infrastructure/prisma-expense.repository';
import { ReceiptOcrApplyService, RECEIPT_REVIEW_REASONS } from './application/services/receipt-ocr-apply.service';
import { CorrectLineCapturedExpenseUseCase } from './application/use-cases/line-correction.use-case';

const databaseUrl = process.env.RECEIPT_TRUTH_TEST_DATABASE_URL;

const TODAY = '2026-09-05';
/** สินค้า 1,520.00 + ค่าบริการ 152.00 = 1,672.00 ฐานภาษี, VAT 7% 117.04, รวม 1,789.04. */
const BHC = {
  vatMode: 'VAT_EXCLUDED' as const,
  expenseDate: '2026-09-03',
  expenseDateAssumptions: ['order_assumed_day_month', 'two_digit_year_resolved_plausible_era'],
  subtotalAmount: '1520.00', taxableAmount: '1672.00', vatAmount: '117.04', vatRate: '0.07',
  grandTotalAmount: '1789.04', quantity: '1', unitPrice: '1520.00', whtRate: '0.03',
  additionalCharges: [{
    kind: 'SERVICE_CHARGE', description: 'ค่าบริการ 10%', amount: '152.00', evidenceSignal: 'Service charge 10%',
  }],
};

function connect(): PrismaClient {
  const url = new URL(databaseUrl!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'only an explicit local test database is allowed');
  // Localhost alone is NOT proof of a local database: the production access recipe port-forwards
  // prod to 127.0.0.1 through SSM. This spec writes to the real `public` schema, so it also
  // requires the local docker database by name before it creates a single row.
  assert.ok(url.pathname === '/watchdog_bms' || url.port === '15432' && url.pathname === '/mangmee_billing_20260912', 'refusing an unknown local database');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
}

describe('receipt truth on real PostgreSQL (spec §11)', { skip: !databaseUrl }, () => {
  const tag = `receipt-truth-${randomUUID().slice(0, 8)}`;
  const companyId = `${tag}-company`;
  const userId = `${tag}-user`;
  const branchId = `${tag}-branch`;
  let client!: PrismaClient;
  let unreachable: string | null = null;

  before(async () => {
    client = connect();
    // Shared with the other real-PostgreSQL suites: a URL that is set but whose server does not
    // answer is the same "no database here" condition the unset case skips for, not a red test on
    // a developer's stopped docker. Still a failure in CI, which started the database one step
    // earlier, or under RECEIPT_TRUTH_REQUIRE_POSTGRES=true.
    unreachable = await pgSpecUnreachableReason(
      () => client.$queryRaw`SELECT 1`, 'RECEIPT_TRUTH_REQUIRE_POSTGRES');
    if (unreachable) return;
    await client.user.create({ data: { id: userId, displayName: 'ผู้ทดสอบ', status: 'ACTIVE' } });
    await client.company.create({ data: { id: companyId, name: `ร้าน ${tag}` } });
    await client.branch.create({ data: { id: branchId, companyId, code: 'HO', name: 'สำนักงานใหญ่', type: 'HEAD_OFFICE', createdByUserId: userId } });
  });

  after(async () => {
    if (unreachable) { await client.$disconnect(); return; }
    try {
      await client.auditLog.deleteMany({ where: { companyId } });
      await client.outboxEvent.deleteMany({ where: { companyId } });
      await client.expenseLine.deleteMany({ where: { companyId } });
      await client.expenseRecord.deleteMany({ where: { companyId } });
      await client.branch.deleteMany({ where: { companyId } });
      await client.company.deleteMany({ where: { id: companyId } });
      await client.user.deleteMany({ where: { id: userId } });
    } finally {
      await client.$disconnect();
    }
  });

  const ctx = () => ({ companyId, userId, requestId: randomUUID(), permissions: ['expense.update'], scopes: {} } as any);
  const audit = () => new AuditService(new PrismaAuditRepository({ client } as any), { error: () => undefined } as any);
  const apply = () => new ReceiptOcrApplyService({ client } as any, new PrismaExpenseRepository({ client } as any));

  /** A LINE-captured draft exactly as `initReceiptUpload` leaves it: the upload day as a placeholder
   *  in a NOT NULL column, and the provenance note nothing may overwrite. */
  const draft = async (note = 'LINE receipt upload') => (await client.expenseRecord.create({
    data: {
      companyId, branchId, createdByUserId: userId, status: 'NEEDS_REVIEW', captureSource: 'LINE_UPLOAD',
      expenseDate: new Date(`${TODAY}T00:00:00.000Z`), note, currency: 'THB', vatMode: 'NO_VAT',
      sourceDocumentType: 'RECEIPT', sourceChannelMetadataJson: { chatKeyHash: 'receipt-truth-chat' },
    },
  })).id;

  it('writes a charge row the printed VAT proves, with no withholding on it', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const expenseId = await draft();

    const outcome = await apply().apply(ctx(), expenseId, BHC as never, { todayIso: TODAY });

    assert.equal(outcome.chargesApplied, 1);
    const lines = await client.expenseLine.findMany({ where: { expenseId }, orderBy: { lineNumber: 'asc' } });
    const chargeRow = lines.find((line) => line.description === 'ค่าบริการ 10%');
    assert.ok(chargeRow, 'the charge is a printed row and must exist in the database');
    assert.equal(chargeRow.vatRate?.toFixed(4), '0.0700', 'the printed VAT covers base + charge, which IS the proof');
    // The three the column types decide, and an object fake cannot: a real NULL, a real zero
    // Decimal, and an enum value this codebase had never written until §5.1.
    assert.equal(chargeRow.whtRate, null, 'withholding never lands on a service charge');
    assert.equal(chargeRow.whtAmount.toFixed(2), '0.00');
    const productRow = lines.find((line) => line.description !== 'ค่าบริการ 10%')!;
    assert.equal(productRow.whtRate?.toFixed(4), '0.0300', 'and the printed rate still applies to what it was withheld on');
    assert.equal(productRow.whtAmount.toFixed(2), '45.60', 'the WHOLE printed withholding, undiluted by the charge');

    const record = await client.expenseRecord.findUniqueOrThrow({ where: { id: expenseId } });
    assert.equal(record.grandTotalAmount.toFixed(2), '1789.04');
    assert.ok(outcome.reviewReasons.includes(RECEIPT_REVIEW_REASONS.whtWithCharges));
  });

  it('commits paid and free OCR item rows as valid PostgreSQL Decimals (receipt reliability T01)', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const expenseId = await draft();
    const outcome = await apply().apply(ctx(), expenseId, {
      vatMode: 'NO_VAT', expenseDate: TODAY,
      subtotalAmount: '300.00', grandTotalAmount: '300.00',
      lines: [
        { description: 'สินค้า A', quantity: '1', amount: '100.00', evidenceSignal: 'สินค้า A 1 100.00' },
        { description: 'สินค้า B', quantity: '2', amount: '200.00', evidenceSignal: 'สินค้า B 2 200.00' },
        { description: 'รายการแถม', quantity: '1', unitPrice: '0.00', amount: '0.00', evidenceSignal: 'รายการแถม 1 0.00' },
      ],
    }, { todayIso: TODAY });
    assert.equal(outcome.chargeReconciliationStatus, 'RECONCILED_ITEM_LINES');
    const record = await client.expenseRecord.findUniqueOrThrow({
      where: { id: expenseId }, include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    assert.equal(record.lines.length, 3);
    assert.deepEqual(record.lines.map((line) => line.unitPrice.toFixed(4)), ['100.0000', '100.0000', '0.0000']);
    assert.equal(record.lines[2]!.lineTotalAmount.toFixed(4), '0.0000');
    assert.equal(record.grandTotalAmount.toFixed(4), '300.0000');
  });

  /**
   * UAT 2026-09-06 (cmtp9v5bc…): a bill printing `130.00 + ค่าบริการ 13.00 + VAT 10.01 = 153.01` was
   * labelled `VAT_INCLUDED` by the extractor and stored as ONE 153.01 line with `chargeKind` NULL,
   * while the chat card listed the service charge. The mode comes off the printed arithmetic now,
   * and only a real database can show the enum, the `Decimal(18,4)` rates and the header/line split
   * that the object fake settles by echoing whatever the service handed it.
   */
  it('splits a mislabelled VAT_INCLUDED bill into a base and a service-charge row', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const expenseId = await draft();

    const outcome = await apply().apply(ctx(), expenseId, {
      vatMode: 'VAT_INCLUDED', vatRate: '0.07', quantity: '1', unitPrice: '130.00',
      subtotalAmount: '130.00', vatAmount: '10.01', grandTotalAmount: '153.01',
      expenseDate: '2026-09-05',
      additionalCharges: [{
        kind: 'SERVICE_CHARGE', amount: '13.00', vatRate: '0.07', confidence: 0.93,
        description: 'ค่าบริการ (10%)', evidenceSignal: 'ค่าบริการ (10%) 13.00',
      }],
      description: 'Heineken bottle x1 with service charge',
    } as never, { todayIso: TODAY });

    assert.equal(outcome.chargeReconciliationStatus, 'RECONCILED_CHARGE_LINES');
    assert.equal(outcome.chargesApplied, 1);
    assert.equal(outcome.reviewReasons.includes(RECEIPT_REVIEW_REASONS.chargesFolded), false);
    assert.deepEqual(outcome.charges, [{ kind: 'SERVICE_CHARGE', label: 'ค่าบริการ', amount: '13.0000', vatAmount: '0.9100' }]);

    const lines = await client.expenseLine.findMany({ where: { expenseId }, orderBy: { lineNumber: 'asc' } });
    assert.equal(lines.length, 2);
    assert.equal(lines[0]!.chargeKind, null);
    assert.equal(lines[0]!.unitPrice.toFixed(2), '130.00');
    assert.equal(lines[1]!.chargeKind, 'SERVICE_CHARGE');
    assert.equal(lines[1]!.unitPrice.toFixed(2), '13.00');
    assert.equal(lines[1]!.vatRate?.toFixed(4), '0.0700');

    const record = await client.expenseRecord.findUniqueOrThrow({ where: { id: expenseId } });
    assert.equal(record.vatMode, 'VAT_EXCLUDED', 'the printed 130 + 13 + 10.01 = 153.01 is VAT added on top');
    assert.equal(record.subtotalAmount.toFixed(2), '130.00', 'a service charge is not goods');
    assert.equal(record.taxableAmount.toFixed(2), '143.00');
    assert.equal(record.vatAmount.toFixed(2), '10.01');
    assert.equal(record.grandTotalAmount.toFixed(2), '153.01', 'and what the shop paid never moved');
  });

  /**
   * The Owner's check bill: 725.00 of food, Gratuity 72.00, and a VAT box printed as a whole 56 baht
   * where 7% of 797.00 is 55.79. The first cut of this fix answered the 0.21 with a synthesized
   * `ปัดเศษ` row; that row is withdrawn — a whole-baht VAT remainder belongs in the VAT, not in the
   * tax base. Only a real database proves the negative: seven rows, `chargeKind` on exactly one of
   * them, and no eighth row that the document never printed.
   */
  it('records the check bill exactly as printed and invents no rounding row', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const expenseId = await draft();

    const outcome = await apply().apply(ctx(), expenseId, {
      vatMode: 'VAT_EXCLUDED', vatRate: '0.07', expenseDate: '2026-09-04',
      subtotalAmount: '725.00', vatAmount: '56.00', grandTotalAmount: '853.00',
      additionalCharges: [{
        kind: 'SERVICE_CHARGE', amount: '72.00', confidence: 0.9,
        description: 'Gratuity', evidenceSignal: 'Gratuity 72.00',
      }],
      lines: [270, 160, 190, 30, 50, 25].map((amount, index) => ({
        description: `อาหาร ${index + 1}`, amount: `${amount}.00`, quantity: '1', evidenceSignal: `${amount}.00`,
      })),
    } as never, { todayIso: TODAY });

    assert.equal(outcome.chargeReconciliationStatus, 'RECONCILED_ITEM_LINES');
    assert.equal(outcome.chargesApplied, 1);
    assert.ok(outcome.reviewReasons.some((reason) => reason.startsWith(RECEIPT_REVIEW_REASONS.vatRounding)),
      `the 0.21 is named for the reviewer: ${JSON.stringify(outcome.reviewReasons)}`);
    assert.deepEqual(outcome.charges, [{ kind: 'SERVICE_CHARGE', label: 'ค่าบริการ', amount: '72.0000', vatAmount: '5.0400' }]);

    const lines = await client.expenseLine.findMany({ where: { expenseId }, orderBy: { lineNumber: 'asc' } });
    assert.equal(lines.length, 7, 'six goods rows and the gratuity');
    assert.deepEqual(lines.map((line) => line.chargeKind), [null, null, null, null, null, null, 'SERVICE_CHARGE']);
    assert.equal(lines[6]!.unitPrice.toFixed(2), '72.00');

    const record = await client.expenseRecord.findUniqueOrThrow({ where: { id: expenseId } });
    assert.equal(record.subtotalAmount.toFixed(2), '725.00', 'the gratuity is not goods');
    assert.equal(record.taxableAmount.toFixed(2), '797.00');
    assert.equal(record.vatAmount.toFixed(2), '55.79', 'per-line VAT is rate × taxable, and stays so');
    assert.equal(record.grandTotalAmount.toFixed(2), '852.79');
    assert.equal((record.vatCaptureSnapshotJson as any).reconciliation.status, 'MISMATCH',
      'the printed 56.00 is still the reviewer‘s call, and confirmation is still blocked until it is made');
  });

  it('persists an assumed date as a real date, flagged and NOT forced into review', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const expenseId = await draft();

    // No printed WHT here: the only thing that could send this record to review is the date, which
    // is exactly what the assertion below is about.
    const { whtRate: _wht, ...noWht } = BHC;
    const outcome = await apply().apply(ctx(), expenseId, noWht as never, { todayIso: TODAY });

    const record = await client.expenseRecord.findUniqueOrThrow({ where: { id: expenseId } });
    assert.equal(record.expenseDate.toISOString().slice(0, 10), '2026-09-03', 'the bill said 03/09/69 and the column holds it');
    assert.equal(record.aiVerificationStatus, 'PARTIAL', 'reading a Thai DD/MM date is not a defect');
    assert.equal(outcome.dateStatus, 'assumed');
    assert.deepEqual(outcome.dateAssumptions, BHC.expenseDateAssumptions);
  });

  it('leaves the placeholder date alone and marks the record for review when nothing was read', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const expenseId = await draft();

    const outcome = await apply().apply(ctx(), expenseId, { grandTotalAmount: '580.00' } as never, { todayIso: TODAY });

    const record = await client.expenseRecord.findUniqueOrThrow({ where: { id: expenseId } });
    assert.equal(record.expenseDate.toISOString().slice(0, 10), TODAY, 'the NOT NULL column keeps the upload day');
    assert.equal(record.aiVerificationStatus, 'NEEDS_REVIEW', 'and nothing lets it pass as a reading');
    assert.equal(outcome.dateStatus, 'unverified');
    assert.deepEqual(outcome.reviewReasons, [RECEIPT_REVIEW_REASONS.dateUnverified]);
  });

  it('keeps the legacy correction adapter read-only; preview/apply tests own note writes', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const expenseId = await draft();
    const before = await client.expenseRecord.findUniqueOrThrow({ where: { id: expenseId } });
    const outcome = await new CorrectLineCapturedExpenseUseCase().execute(ctx(), {
      lineMessageIdHash: `${tag}-msg`, chatKeyHash: 'receipt-truth-chat',
      candidates: [{ id: expenseId, label: 'BHC' }] as never,
      hints: { note: { to: 'เพิ่มหมายเหตุจากไลน์' } } as never,
      evidence: [{ text: 'เพิ่มหมายเหตุจากไลน์', todayIso: TODAY }],
    });
    assert.equal(outcome.status, 'guidance');
    if (outcome.status === 'guidance') assert.equal(outcome.reason, 'preview_required');
    const after = await client.expenseRecord.findUniqueOrThrow({ where: { id: expenseId } });
    assert.equal(after.note, before.note);
    assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
    assert.equal(after.grandTotalAmount.toFixed(2), before.grandTotalAmount.toFixed(2));
  });
});
