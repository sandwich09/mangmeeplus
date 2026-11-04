import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { PrismaClient } from '../../apps/api/src/generated/prisma/client';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { E_WHT_WORDS } from '@watchdog-bms/contracts';
import { expect } from '../harness/fixtures';
import { json, unique, chooseThemedOption } from '../harness/e2e-utils';
import { AFTER_PRESS, FIRST_SIGHT, MAIN_SHOP, periodKey, pressMenu } from './journey-kit';

/** Own branch isolates paper rows; restore all shared shop facts even after a failed press. */
export async function withEWhtBranch(api: APIRequestContext, run: (branch: { name: string; code: string }) => Promise<void>) {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is required for the isolated e-WHT journey');
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(connectionString).hostname);
  const apiRequire = createRequire(resolve('apps/api/package.json'));
  const { PrismaPg } = apiRequire('@prisma/adapter-pg');
  const dist = process.env['API_DIST_DIR'] ?? `dist/e2e-${process.env['API_PORT'] ?? '3001'}`;
  const { PrismaClient, Prisma } = apiRequire(resolve(`apps/api/${dist}/apps/api/src/generated/prisma/client.js`));
  const db: PrismaClient = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const setting = await json<{ used: boolean }>(await api.get(`companies/${MAIN_SHOP}/expense-settings/e-wht`));
  const payerFacts = await db.whtPayerModeFact.findMany({ where: { companyId: MAIN_SHOP } });
  const periods = await db.taxPeriod.findMany({ where: { companyId: MAIN_SHOP, periodKey: periodKey(), formType: { in: ['PND3', 'PND53'] } },
    select: { id: true, status: true, reviewNote: true, filedAt: true, paidAt: true, closedAt: true } });
  const identity = await db.company.findUniqueOrThrow({ where: { id: MAIN_SHOP }, select: { registeredName: true, taxId: true, addressJson: true } });
  const owner = await db.user.findUniqueOrThrow({ where: { username: 'qa.owner' } });
  const name = unique('สาขาทดลอง e-WHT');
  let code = 92000;
  while (await db.branch.findFirst({ where: { companyId: MAIN_SHOP, taxBranchCode: String(code) } })) code++;
  const branch = await db.branch.create({ data: { companyId: MAIN_SHOP, code: unique('EWHT'), name, taxBranchCode: String(code), isVatEstablishment: true, createdByUserId: owner.id } });
  try {
    await db.company.update({ where: { id: MAIN_SHOP }, data: { registeredName: 'บริษัท ร้านทดลอง e-WHT จำกัด', taxId: '0105558000014',
      addressJson: { line1: '88 ถนนพระราม 4', subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' } } });
    await db.whtPayerModeFact.updateMany({ where: { companyId: MAIN_SHOP, supersededAt: null }, data: { supersededAt: new Date() } });
    await db.whtPayerModeFact.create({ data: { companyId: MAIN_SHOP, mode: 'EACH_BRANCH_PAYS', effectiveFromPeriodKey: periodKey(), answeredByUserId: owner.id } });
    await run({ name, code: String(code) });
  } finally {
    try {
      await db.$transaction(async tx => {
        await tx.expensePayment.updateMany({ where: { companyId: MAIN_SHOP, expense: { branchId: branch.id } }, data: { status: 'VOIDED', voidedAt: new Date(), voidedByUserId: owner.id } });
        await tx.expenseRecord.updateMany({ where: { companyId: MAIN_SHOP, branchId: branch.id }, data: { status: 'VOIDED', voidedAt: new Date(), voidedByUserId: owner.id, voidReason: 'จบการทดสอบ e-WHT' } });
        await tx.disbursementVoucher.updateMany({ where: { companyId: MAIN_SHOP, branchId: branch.id, paidDate: { not: null } }, data: { cancelledAfterPaid: true } });
        await tx.disbursementVoucher.updateMany({ where: { companyId: MAIN_SHOP, branchId: branch.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledByUserId: owner.id, cancelReason: 'จบการทดสอบ e-WHT' } });
        await tx.taxEvent.updateMany({ where: { companyId: MAIN_SHOP, branchId: branch.id, status: { in: ['ACTIVE', 'EXCLUDED'] } }, data: { status: 'SUPERSEDED' } });
        const papers = await tx.whtFiling.findMany({ where: { companyId: MAIN_SHOP, establishmentBranchId: branch.id }, select: { id: true } });
        const paperIds = papers.map((paper: { id: string }) => paper.id);
        await tx.whtFiling.updateMany({ where: { id: { in: paperIds } }, data: { filingPackageId: null } });
        await tx.taxFilingPackage.deleteMany({ where: { companyId: MAIN_SHOP, whtFilingId: { in: paperIds } } });
        await tx.whtFilingLine.deleteMany({ where: { whtFilingId: { in: paperIds } } });
        await tx.whtFiling.deleteMany({ where: { id: { in: paperIds } } });
        await tx.branch.update({ where: { id: branch.id }, data: { status: 'DISABLED' } });
        await tx.company.update({ where: { id: MAIN_SHOP }, data: { ...identity, addressJson: identity.addressJson ?? Prisma.DbNull } });
        for (const { id, ...data } of periods) await tx.taxPeriod.update({ where: { id }, data });
        await tx.companyTaxProfile.update({ where: { companyId: MAIN_SHOP }, data: { eWhtUsed: setting.used } });
        await tx.whtPayerModeFact.deleteMany({ where: { companyId: MAIN_SHOP } });
        if (payerFacts.length) await tx.whtPayerModeFact.createMany({ data: payerFacts });
      }, { timeout: 30_000, maxWait: 30_000 });
    } finally { await db.$disconnect(); }
  }
}

export async function setEWhtSetting(page: Page, used: boolean) {
  await page.goto(`/companies/${MAIN_SHOP}/settings/e-wht`, FIRST_SIGHT);
  await expect(page.getByRole('heading', { level: 1, name: E_WHT_WORDS['S-1'], exact: true })).toBeVisible(FIRST_SIGHT);
  await page.getByRole('radio', { name: E_WHT_WORDS['S-4'][used ? 'yes' : 'no'], exact: true }).check();
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: E_WHT_WORDS[used ? 'S-6' : 'S-7'] })).toBeVisible(AFTER_PRESS);
}

export async function openEWhtMonth(page: Page, branch: { name: string; code: string }) {
  await pressMenu(page, 'ภาษีหัก ณ ที่จ่าย');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'ภ.ง.ด.53 (จ่ายให้บริษัท)', exact: true })).toBeVisible(AFTER_PRESS);
  const chooser = main.getByRole('combobox', { name: 'ยื่นในนาม', exact: true });
  await expect(chooser).toBeVisible(AFTER_PRESS);
  await chooseThemedOption(page, chooser, `${branch.name} (${branch.code})`);
}

export async function expectButtonGroup(group: Locator, width: number) {
  const buttons = group.locator('button.mangmee-btn, a.mangmee-btn').filter({ visible: true });
  const boxes = await buttons.evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(Math.abs(box.height - (width < 640 ? 44 : 40))).toBeLessThan(1);
    expect(Math.abs(box.width - boxes[0]!.width)).toBeLessThan(1);
  }
}

/** Inspect every decompressed sheet, including UTF-8 Thai payee names. */
export function workbookXml(buffer: Buffer) {
  const xml: string[] = [];
  for (let offset = 0; offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50;) {
    const size = buffer.readUInt32LE(offset + 18), length = buffer.readUInt16LE(offset + 26);
    const name = buffer.subarray(offset + 30, offset + 30 + length).toString();
    const start = offset + 30 + length + buffer.readUInt16LE(offset + 28);
    const bytes = buffer.subarray(start, start + size);
    if (name.endsWith('.xml')) xml.push((buffer.readUInt16LE(offset + 8) === 8 ? inflateRawSync(bytes) : bytes).toString('utf8'));
    offset = start + size;
  }
  expect(xml.length).toBeGreaterThan(0);
  return xml.join('\n');
}

/** PDF metadata timestamps can differ; compare the actual decompressed printed page bytes. */
export async function printedPdfPages(bytes: Buffer) {
  const apiRequire = createRequire(resolve('apps/api/package.json'));
  const { PDFDocument, PDFArray, decodePDFRawStream } = apiRequire('pdf-lib');
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((page: any) => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
    return Buffer.concat(streams.map((stream: any) => Buffer.from(decodePDFRawStream(pdf.context.lookup(stream)).decode())));
  });
}

/** Valid, distinct synthetic tax numbers prevent reuse of another journey's address-book entry. */
export function eWhtPayeeTaxId(branchCode: string, suffix: number) {
  const base = `0${branchCode}${String(suffix).padStart(6, '0')}`;
  const check = (11 - [...base].reduce((sum, digit, index) => sum + Number(digit) * (13 - index), 0) % 11) % 10;
  return `${base}${check}`;
}
