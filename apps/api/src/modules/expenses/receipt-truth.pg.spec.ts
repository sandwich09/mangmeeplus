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
import { AuditService } from '../audit/application/audit.service';
import { PrismaAuditRepository } from '../audit/infrastructure/prisma-audit.repository';
import { PrismaExpenseRepository } from './infrastructure/prisma-expense.repository';
import { ReceiptOcrApplyService, RECEIPT_REVIEW_REASONS } from './application/services/receipt-ocr-apply.service';
import { CorrectLineCapturedExpenseUseCase } from './application/use-cases/line-correction.use-case';
import { UpdateExpenseDraftUseCase } from './application/use-cases/expense-draft.use-case';

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
  assert.equal(url.pathname, '/watchdog_bms', 'refusing to write to anything but the local docker database');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
}

describe('receipt truth on real PostgreSQL (spec §11)', { skip: !databaseUrl }, () => {
  const tag = `receipt-truth-${randomUUID().slice(0, 8)}`;
  const companyId = `${tag}-company`;
  const userId = `${tag}-user`;
  const branchId = `${tag}-branch`;
  let client!: PrismaClient;

  before(async () => {
    client = connect();
    await client.user.create({ data: { id: userId, displayName: 'ผู้ทดสอบ', status: 'ACTIVE' } });
    await client.company.create({ data: { id: companyId, name: `ร้าน ${tag}`, businessCategory: 'SERVICE' } });
    await client.branch.create({ data: { id: branchId, companyId, code: 'HO', name: 'สำนักงานใหญ่', type: 'HEAD_OFFICE', createdByUserId: userId } });
  });

  after(async () => {
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
  // The correction lane never reaches transaction-tax resolution (it writes header fields and, at
  // most, the single trivial line a text note creates), so the real service is not wired here.
  const updateDraft = () => new UpdateExpenseDraftUseCase(
    new PrismaExpenseRepository({ client } as any),
    audit(),
    { resolveLines: async (_c: unknown, lines: unknown) => lines } as any,
  );
  const apply = () => new ReceiptOcrApplyService({ client } as any, new PrismaExpenseRepository({ client } as any));

  /** A LINE-captured draft exactly as `initReceiptUpload` leaves it: the upload day as a placeholder
   *  in a NOT NULL column, and the provenance note nothing may overwrite. */
  const draft = async (note = 'LINE receipt upload') => (await client.expenseRecord.create({
    data: {
      companyId, branchId, createdByUserId: userId, status: 'NEEDS_REVIEW', captureSource: 'LINE_UPLOAD',
      expenseDate: new Date(`${TODAY}T00:00:00.000Z`), note, currency: 'THB', vatMode: 'NO_VAT',
      sourceDocumentType: 'RECEIPT',
    },
  })).id;

  it('writes a charge row the printed VAT proves, with no withholding on it', async () => {
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

  it('persists an assumed date as a real date, flagged and NOT forced into review', async () => {
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

  it('leaves the placeholder date alone and marks the record for review when nothing was read', async () => {
    const expenseId = await draft();

    const outcome = await apply().apply(ctx(), expenseId, { grandTotalAmount: '580.00' } as never, { todayIso: TODAY });

    const record = await client.expenseRecord.findUniqueOrThrow({ where: { id: expenseId } });
    assert.equal(record.expenseDate.toISOString().slice(0, 10), TODAY, 'the NOT NULL column keeps the upload day');
    assert.equal(record.aiVerificationStatus, 'NEEDS_REVIEW', 'and nothing lets it pass as a reading');
    assert.equal(outcome.dateStatus, 'unverified');
    assert.deepEqual(outcome.reviewReasons, [RECEIPT_REVIEW_REASONS.dateUnverified]);
  });

  it('appends the user note through the real transaction without losing the provenance', async () => {
    const expenseId = await draft();
    const record = await client.expenseRecord.findUniqueOrThrow({ where: { id: expenseId } });
    const useCase = new CorrectLineCapturedExpenseUseCase(
      { client } as any,
      new PrismaExpenseRepository({ client } as any),
      updateDraft(),
      audit(),
    );
    const text = 'จากบิลเมื่อกี้มี service charge 10% นะ แก้ไขได้ใช่ไหม';

    const outcome = await useCase.execute(ctx(), {
      lineMessageIdHash: `${tag}-msg`,
      candidates: [{ id: expenseId, label: 'BHC' }] as never,
      hints: { note: { to: text } } as never,
      evidence: [{ text, todayIso: TODAY }],
    });

    assert.equal(outcome.status, 'applied');
    const after = await client.expenseRecord.findUniqueOrThrow({ where: { id: expenseId } });
    assert.ok(after.note?.startsWith('LINE receipt upload'), `provenance must survive, got: ${after.note}`);
    assert.ok(after.note?.includes(`ผู้ใช้แจ้ง: ${text}`));
    assert.ok((after.note?.length ?? 0) <= 500, 'the column never grows past the cap');
    assert.equal(after.grandTotalAmount.toFixed(2), record.grandTotalAmount.toFixed(2), 'and no money moved');
  });

  it('caps a full note in the column rather than dropping what the user said', async () => {
    const expenseId = await draft(`LINE receipt upload${'!'.repeat(441)}`);
    const useCase = new CorrectLineCapturedExpenseUseCase(
      { client } as any,
      new PrismaExpenseRepository({ client } as any),
      updateDraft(),
      audit(),
    );
    const text = 'จากบิลเมื่อกี้มี service charge 10% นะ แก้ไขได้ใช่ไหม';

    const outcome = await useCase.execute(ctx(), {
      lineMessageIdHash: `${tag}-msg-cap`,
      candidates: [{ id: expenseId, label: 'BHC' }] as never,
      hints: { note: { to: text } } as never,
      evidence: [{ text, todayIso: TODAY }],
    });

    assert.equal((outcome as { noteOutcome?: string }).noteOutcome, 'truncated');
    const after = await client.expenseRecord.findUniqueOrThrow({ where: { id: expenseId } });
    assert.ok(after.note!.length <= 500);
    assert.ok(after.note!.startsWith('LINE receipt upload'));
    assert.ok(after.note!.includes('ผู้ใช้แจ้ง:'), 'something of what he said is recorded, not nothing');
  });
});
