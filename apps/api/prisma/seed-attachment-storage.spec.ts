import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { PLAIN_SHOP, UNANSWERED_PLAIN_SHOP, INPUT_VAT_SHOP, PACKAGE_SHOP, plainShopEntitlements, seedPlainShop } from './seed-plain-shop';
import { FEATURE_PACKAGE_PRESETS } from '@watchdog-bms/contracts';
import { CompanyVatRegistrationUseCase } from '../src/modules/data-model-core/application/use-cases/company-vat-registration.use-case';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { seedExpenseRows, seedExpenseData, seedExpenses } from './seed-expenses';
import { validateConfirm, validateDomesticInputVatEvidence } from '../src/modules/expenses/domain/logic/expense-status.logic';
import { ExpenseSourceAdapter } from '../src/modules/tax/infrastructure/adapters/expense-source.adapter';
import { assertExpenseSourceDraftComplete } from '../src/modules/expenses/domain/logic/expense-source-draft.logic';
import { inspectAttachmentBytes } from '../src/modules/data-model-core/domain/logic/attachment.logic';
import {
  buildSeedPaymentProofPng,
  buildSeedSupportingPdf,
  putSeedAttachmentObject,
} from './seed-attachment-storage';

describe('seed expense money facts', () => {
  const rows = seedExpenseRows((offset, hour) => new Date(Date.UTC(2026, 9, 13 + offset, hour)));

  it('e-WHT mixed-month fixture keeps bank and payer-file payments distinct', () => {
    const bank = rows.find(row => row.id === 'seed-expense-record-e-wht-advertising');
    const payer = rows.find(row => row.id === 'seed-expense-record-payer-files-rent');
    assert.ok(bank); assert.ok(payer);
    assert.equal(bank.date.toISOString().slice(0, 7), payer.date.toISOString().slice(0, 7));
    assert.equal(seedExpenseData(bank, { companyId: 'shop', branchId: 'branch', ownerUserId: 'owner' }).record.whtRemittance, 'E_WHT');
    assert.equal(seedExpenseData(payer, { companyId: 'shop', branchId: 'branch', ownerUserId: 'owner' }).record.whtRemittance, 'PAYER_FILES');
    assert.equal(bank.payments[0].method, 'BANK_TRANSFER');
    assert.equal((bank.payments[0] as any).paidAtConfirmed, true);
    assert.equal((payer.payments[0] as any).paidAtConfirmed, true);
  });

  it('paid seed expenses have recorded payments that add up to the header', () => {
    for (const row of rows) {
      const payments = (row as any).payments ?? [];
      assert.equal(payments.reduce((sum: number, payment: { amount: string }) => sum + Number(payment.amount), 0),
        Number(row.paidAmount), row.expenseNumber);
      if (Number(row.paidAmount) > 0) assert.equal(row.status, 'CONFIRMED', row.expenseNumber);
      assert.equal(Number(row.total) - Number(row.wht), Number(row.netPayable), row.expenseNumber);
      assert.equal(Number(row.subtotal) + Number(row.vat), Number(row.total), row.expenseNumber);
    }
  });

  it('confirmed withholding seed expenses have a matching payee kind, income type, tax number and address', () => {
    const rent = rows.find(row => row.id === 'seed-expense-record-rent')!;
    assert.equal(rent.expenseNumber, 'EXP-LOCAL-0003');
    assert.equal(rent.vendor, 'บริษัท พื้นที่สวย จำกัด');
    for (const row of rows.filter(row => row.status === 'CONFIRMED' && Number(row.wht) > 0)) {
      const payee = row as any;
      assert.ok(['INDIVIDUAL', 'JURISTIC'].includes(payee.vendorEntityKindSnapshot), row.expenseNumber);
      assert.match(payee.whtCategoryCode, payee.vendorEntityKindSnapshot === 'INDIVIDUAL' ? /_IND$/ : /_JUR$/);
      assert.match(payee.vendorTaxIdSnapshot, /^\d{13}$/);
      assert.ok(payee.vendorAddressSnapshot?.trim());
      assert.equal(Number(row.subtotal) * Number(payee.whtRate) / 100, Number(row.wht));
    }
  });

  it('seed line arithmetic and receipt facts pass the production confirmation checks', () => {
    for (const row of rows) {
      const { record, line } = seedExpenseData(row, { companyId: 'shop', branchId: 'branch', ownerUserId: 'owner' });
      for (const [header, detail] of [['subtotalAmount', 'lineSubtotalAmount'], ['taxableAmount', 'taxableAmount'],
        ['vatAmount', 'vatAmount'], ['whtAmount', 'whtAmount'], ['grandTotalAmount', 'lineTotalAmount']]) {
        assert.equal(Number((record as any)[header!]), Number((line as any)[detail!]), `${row.expenseNumber}: ${header}`);
      }
      if (row.status !== 'CONFIRMED') continue;
      assert.ok(record.primaryAttachmentId, row.expenseNumber);
      assert.equal(validateConfirm({ ...record, hasMissingReceiptPermission: true } as any), null, row.expenseNumber);
      assert.equal(validateDomesticInputVatEvidence({ ...record, lines: [line] } as any), null, row.expenseNumber);
      assert.doesNotThrow(() => assertExpenseSourceDraftComplete(null,
        { ...record, lines: [line], createdAt: row.date, updatedAt: row.date } as any), row.expenseNumber);
    }
  });

  it('rent reaches withholding sync only after its generated payment date is confirmed, with company rent facts intact', async () => {
    const row = rows.find(row => row.id === 'seed-expense-record-rent')!;
    const { record, line } = seedExpenseData(row, { companyId: 'shop', branchId: 'branch', ownerUserId: 'owner' });
    const payment = { id: 'rent-payment', amount: record.netPayableAmount, paidAt: row.date, paidAtConfirmed: false, status: 'RECORDED', createdAt: row.date };
    const adapter = new ExpenseSourceAdapter({ client: { company: { findUnique: async () => ({ timezone: 'Asia/Bangkok' }) }, whtFilingLine: { findMany: async () => [] }, expenseRecord: { findMany: async () => [
      { ...record, payments: [payment], lines: [line], confirmedAt: row.date, updatedAt: row.date },
    ] } } } as any);
    assert.deepEqual(await adapter.findConfirmedWithWhtByCompany('shop'), []);
    payment.paidAtConfirmed = true;
    const [source] = await adapter.findConfirmedWithWhtByCompany('shop');
    assert.equal(source!.payeeEntityKind, 'JURISTIC');
    assert.equal(source!.incomeCategoryCode, 'WHT_RENT_JUR');
    assert.equal(source!.whtRate, '5.0000');
    assert.equal(source!.grossAmount, '30000');
    assert.equal(source!.whtAmount, '1500');
    assert.ok(source!.vendorTaxId);
    assert.ok(source!.vendorAddress);
  });

  it('a second seed leaves existing expenses and their payments untouched', async () => {
    const reads: string[] = [];
    const tx = { $executeRaw: async () => 0, expenseRecord: { findUnique: async ({ where }: any) => {
      reads.push(where.id); return { id: where.id, status: 'VOIDED' };
    } } };
    await seedExpenses({ expenseRecord: tx.expenseRecord, $transaction: async (work: any) => work(tx) } as any,
      { companyId: 'shop', branchId: 'branch', ownerUserId: 'owner' }, rows);
    assert.deepEqual(reads, rows.map(row => row.id));
    // The fake has no write methods: restoring demo totals/status or paying again fails this test.
  });
});

describe('seed preview attachment fixtures', () => {
  it('builds the same valid passive PNG on every run', async () => {
    const bytes = buildSeedPaymentProofPng();
    const metadata = await sharp(bytes).metadata();

    assert.deepEqual(bytes, buildSeedPaymentProofPng());
    // Pin the picture, not the compressed bytes: `deflateSync` output depends on the zlib Node was
    // built with (official builds bundle Chromium's zlib, Homebrew's node links the system zlib, and
    // the two compress this image one byte apart), while the decoded pixels are identical everywhere.
    assert.equal(createHash('sha256').update(await sharp(bytes).raw().toBuffer()).digest('hex'), '351357072108eb11c0947878822938ec8260842bcde85bfb4126b2a1c3c6ec1e');
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, 640);
    assert.equal(metadata.height, 400);
    assert.equal(inspectAttachmentBytes('image/png', bytes), null);
  });

  it('builds the same valid one-page passive PDF on every run', async () => {
    const bytes = buildSeedSupportingPdf();
    const pdf = await PDFDocument.load(bytes);

    assert.deepEqual(bytes, buildSeedSupportingPdf());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), '58e1ebbf33493a9e87a65ebb4708f30392ab421a2531631f5dd60fe6dd85aaed');
    assert.equal(pdf.getPageCount(), 1);
    assert.equal(inspectAttachmentBytes('application/pdf', bytes), null);
  });

  it('reuses an identical S3 object version instead of uploading on every seed', async () => {
    const envKeys = ['S3_BUCKET', 'S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_FORCE_PATH_STYLE'] as const;
    const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    const originalSend = S3Client.prototype.send;
    const bytes = buildSeedPaymentProofPng();
    let current: { VersionId: string; ContentLength: number; ContentType: string; ChecksumSHA256: string; Metadata: Record<string, string> } | null = null;
    let puts = 0;

    process.env['S3_BUCKET'] = 'seed-test-bucket';
    process.env['S3_ENDPOINT'] = 'http://127.0.0.1:9';
    process.env['S3_REGION'] = 'local';
    process.env['S3_ACCESS_KEY_ID'] = 'seed-test';
    process.env['S3_SECRET_ACCESS_KEY'] = 'seed-test-secret';
    process.env['S3_FORCE_PATH_STYLE'] = 'true';
    (S3Client.prototype as any).send = async (command: HeadObjectCommand | PutObjectCommand) => {
      if (command instanceof HeadObjectCommand) {
        if (!current) throw Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
        return current;
      }
      if (command instanceof PutObjectCommand) {
        puts += 1;
        current = {
          VersionId: `version-${puts}`,
          ContentLength: command.input.ContentLength!,
          ContentType: command.input.ContentType!,
          ChecksumSHA256: command.input.ChecksumSHA256!,
          Metadata: command.input.Metadata!,
        };
        return { VersionId: current.VersionId, ChecksumSHA256: current.ChecksumSHA256 };
      }
      throw new Error('Unexpected S3 command in seed idempotence test');
    };

    try {
      const input = { objectKey: 'seed/idempotent-payment.png', mimeType: 'image/png', bytes };
      const first = await putSeedAttachmentObject(input);
      const second = await putSeedAttachmentObject(input);
      assert.equal(puts, 1);
      assert.equal(first.objectVersionId, 'version-1');
      assert.equal(second.objectVersionId, first.objectVersionId);
      assert.equal(second.checksumSha256, createHash('sha256').update(bytes).digest('hex'));
    } finally {
      (S3Client.prototype as any).send = originalSend;
      for (const key of envKeys) {
        const value = previousEnv[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});


describe('plain shop journey seed', () => {
  it('uses the exact starter preset, four QA roles, and no withholding packs', () => {
    assert.deepEqual(PLAIN_SHOP.roleKeys, ['OWNER', 'MANAGER', 'FINANCE', 'STAFF']);
    assert.deepEqual(plainShopEntitlements().filter(row => row.enabled).map(row => row.featureKey).sort(), [...FEATURE_PACKAGE_PRESETS.starter.featureKeys].sort());
    for (const key of ['wht_50bis', 'wht_pnd53', 'thai_tax']) assert.equal(plainShopEntitlements().find(row => row.featureKey === key)!.enabled, false);
    const seed = readFileSync(new URL('./seed-plain-shop.ts', import.meta.url), 'utf8');
    assert.match(seed, /bootstrapCompanyChartOfAccounts\(tx/);
    assert.match(seed, /bootstrapCompanyExpenseCategories\(tx/);
    assert.match(seed, /type: 'HEAD_OFFICE', isVatEstablishment: false/);
    assert.doesNotMatch(seed, /taxId:|registeredName:|addressJson:|memberPayoutAccount\.create/);
    assert.match(readFileSync(new URL('./seed.ts', import.meta.url), 'utf8'), /await seedPlainShop\(prisma\)/);
  });
  it('re-seeding preserves an existing shop and repeats only the idempotent VAT command', async () => {
    const commands: any[] = [];
    const put = mock.method(CompanyVatRegistrationUseCase.prototype, 'put', async (...args: any[]) => { commands.push(args); return { version: 1, resultKind: 'UPSERT_FACT', replayed: true }; });
    let creates = 0;
    const prisma = { user: { findUniqueOrThrow: async () => ({ id: 'seed-qa-user-owner' }) },
      $transaction: async (run: any) => run({ company: { findUnique: async () => ({ id: PLAIN_SHOP.id }), create: async () => { creates++; } } }) };
    try {
      await seedPlainShop(prisma as any); await seedPlainShop(prisma as any);
      assert.equal(creates, 0);
      assert.deepEqual(commands[0], commands[1]);
      assert.equal(commands[0][1], PLAIN_SHOP.id);
      assert.deepEqual(commands[0][2], { commandId: PLAIN_SHOP.vatCommandId, expectedVersion: 0,
        command: { kind: 'UPSERT_FACT', status: 'NOT_REGISTERED', effectiveFrom: '2020-01-01' } });
    } finally { put.mock.restore(); }
  });
});


it('the unanswered plain shop has the same starter setup and never writes or resets a VAT answer', async () => {
  assert.equal(UNANSWERED_PLAIN_SHOP.name, 'ร้านทั่วไป (ยังไม่ตอบเรื่อง VAT)');
  assert.equal(UNANSWERED_PLAIN_SHOP.id, 'seed-local-plain-shop-unanswered');
  assert.equal(UNANSWERED_PLAIN_SHOP.branchId, 'seed-plain-unanswered-branch-ho');
  assert.equal(UNANSWERED_PLAIN_SHOP.vatCommandId, null);
  assert.deepEqual(UNANSWERED_PLAIN_SHOP.roleKeys, PLAIN_SHOP.roleKeys);
  assert.deepEqual(plainShopEntitlements(UNANSWERED_PLAIN_SHOP.id), plainShopEntitlements().map(row => ({ ...row, companyId: UNANSWERED_PLAIN_SHOP.id })));
  const put = mock.method(CompanyVatRegistrationUseCase.prototype, 'put', async () => { throw new Error('Must not answer VAT'); });
  const readIds: string[] = [];
  const prisma = { user: { findUniqueOrThrow: async () => ({ id: 'seed-qa-user-owner' }) },
    $transaction: async (run: any) => run({ company: { findUnique: async ({ where }: any) => { readIds.push(where.id); return { id: where.id }; } } }) };
  try {
    await seedPlainShop(prisma as any, UNANSWERED_PLAIN_SHOP);
    await seedPlainShop(prisma as any, UNANSWERED_PLAIN_SHOP);
    assert.deepEqual(readIds, [UNANSWERED_PLAIN_SHOP.id, UNANSWERED_PLAIN_SHOP.id]);
    assert.equal(put.mock.callCount(), 0);
  } finally { put.mock.restore(); }
  assert.match(readFileSync(new URL('./seed.ts', import.meta.url), 'utf8'), /await seedPlainShop\(prisma, UNANSWERED_PLAIN_SHOP\)/);
});

import { CAPABILITY_PACK_BY_KEY } from '../src/modules/employee-access/domain/registries/capability-pack.registry';

it('the input VAT journey shop grants review through starter, has four QA people and never answers VAT or posts journals', async () => {
  assert.equal(INPUT_VAT_SHOP.name, 'ร้านทดลองภาษีซื้อ');
  assert.equal(INPUT_VAT_SHOP.id, 'seed-local-input-vat-shop');
  assert.equal(INPUT_VAT_SHOP.branchId, 'seed-input-vat-branch-ho');
  assert.deepEqual(INPUT_VAT_SHOP.roleKeys, PLAIN_SHOP.roleKeys); assert.equal(INPUT_VAT_SHOP.vatCommandId, null);
  const rights = plainShopEntitlements(INPUT_VAT_SHOP.id);
  const review = CAPABILITY_PACK_BY_KEY.get('pack.expense.review')!;
  assert.ok(review.permissionKeys.includes('expense.review'));
  assert.equal(rights.find(row => row.featureKey === review.featureEntitlementKey)?.enabled, true);
  for (const key of ['double_entry_ledger', 'expense_auto_post']) assert.equal(rights.find(row => row.featureKey === key)?.enabled, false);
  const put = mock.method(CompanyVatRegistrationUseCase.prototype, 'put', async () => { throw new Error('Must not answer VAT'); });
  const prisma = { user: { findUniqueOrThrow: async () => ({ id: 'seed-qa-user-owner' }) },
    $transaction: async (run: any) => run({ company: { findUnique: async () => ({ id: INPUT_VAT_SHOP.id }) } }) };
  try { await seedPlainShop(prisma as any, INPUT_VAT_SHOP); assert.equal(put.mock.callCount(), 0); } finally { put.mock.restore(); }
  assert.match(readFileSync(new URL('./seed.ts', import.meta.url), 'utf8'), /await seedPlainShop\(prisma, INPUT_VAT_SHOP\)/);
  assert.match(readFileSync(new URL('../../../scripts/local-proof/proof-journeys.sh', import.meta.url), 'utf8'), /seed-local-input-vat-shop/);
});

it('the fresh input VAT journey shop offers claimable tax codes and their rules without changing its VAT answer or entitlements', async () => {
  let company: any = null;
  const accounts: any[] = [], definitions: any[] = [], accountRules: any[] = [], reportRules: any[] = [], entitlements: any[] = [];
  const create = async () => ({ id: 'seed-row' });
  const tx = {
    user: { findUniqueOrThrow: async () => ({ id: 'owner' }) },
    company: { findUnique: async () => company, create: async ({ data }: any) => (company = data), update: create },
    branch: { create }, role: { findUniqueOrThrow: create }, companyMembership: { create }, membershipRole: { create },
    employeeAccessProfile: { findUniqueOrThrow: async () => ({}), create },
    chartOfAccount: {
      count: async () => accounts.length,
      createMany: async ({ data }: any) => { accounts.push(...data.map((row: any) => ({ id: row.code, ...row }))); return { count: data.length }; },
      findMany: async ({ where }: any) => accounts.filter(row => row.companyId === where.companyId && (!where.code?.in || where.code.in.includes(row.code))),
    },
    expenseCategory: { createMany: create },
    companyTaxCodeProfile: { count: async () => 0, create: async ({ data }: any) => ({ id: 'profile', ...data }) },
    taxCodeDefinition: { create: async ({ data }: any) => { const row = { id: data.externalCode, ...data }; definitions.push(row); return row; } },
    taxAccountDeterminationRule: { createMany: async ({ data }: any) => { accountRules.push(...data); } },
    taxReportMappingRule: { createMany: async ({ data }: any) => { reportRules.push(...data); } },
    companyFeatureEntitlement: { createMany: async ({ data }: any) => { entitlements.push(...data); } },
    companyEntitlementSet: { create }, companyEntitlementNormalization: { create }, companyWebEntrySetting: { create },
  };
  const prisma = { user: { findUniqueOrThrow: async () => ({ id: 'owner' }) }, $transaction: async (run: any) => run(tx) };
  const put = mock.method(CompanyVatRegistrationUseCase.prototype, 'put', async () => { throw new Error('Must not answer VAT'); });
  try {
    await seedPlainShop(prisma as any, INPUT_VAT_SHOP);
    assert.deepEqual(definitions.map(row => [row.externalCode, row.status]), [['V7', 'ACTIVE'], ['ND', 'ACTIVE']]);
    assert.ok(accountRules.some(row => row.accountRole === 'INPUT_VAT_CLAIMABLE'));
    assert.ok(reportRules.some(row => row.boxKey === 'box_7_input_tax'));
    assert.deepEqual(entitlements, plainShopEntitlements(INPUT_VAT_SHOP.id));
    await seedPlainShop(prisma as any, INPUT_VAT_SHOP);
    assert.equal(definitions.length, 2, 're-seeding keeps the existing tax configuration');
    assert.equal(put.mock.callCount(), 0);
  } finally { put.mock.restore(); }
});

it('the package journey shop starts on the 999 menus with its owner only, and the journeys warm it', async () => {
  assert.equal(PACKAGE_SHOP.id, 'seed-local-package-shop');
  assert.deepEqual(PACKAGE_SHOP.roleKeys, ['OWNER']);
  const rights = plainShopEntitlements(PACKAGE_SHOP.id);
  for (const key of ['wht_pnd53', 'wht_50bis']) assert.equal(rights.find(row => row.featureKey === key)?.enabled, false);
  assert.match(readFileSync(new URL('./seed.ts', import.meta.url), 'utf8'), /await seedPlainShop\(prisma, PACKAGE_SHOP\)/);
  assert.match(readFileSync(new URL('../../../scripts/local-proof/proof-journeys.sh', import.meta.url), 'utf8'), /seed-local-package-shop/);
});
