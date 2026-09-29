import { UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client.js';

/**
 * Seeds the expense categories a new Thai company needs on day one.
 *
 * Without them a new company starts with an empty catalogue, and three launched things break at
 * once: ใบรับรองแทนใบเสร็จ refuses to issue (`substitute-receipt.use-case` requires a reviewed
 * category or account hint), AI/OCR cannot classify (it may only pick from configured categories,
 * `expense-receipt-upload-spec` §27), and every confirmed expense parks at `postingStatus: pending`
 * until it fails the eventual backfill with `expense_account_unmapped:no_category`.
 *
 * The catalogue is cut by TAX BEHAVIOUR, not by cost type — the chart template has ~75 expense
 * accounts and copying them all would just move the classification problem onto the user. Two
 * categories that book differently under the Revenue Code are separate; two that book the same are
 * one. That is why ค่ารับรอง is not folded into ค่าอาหาร, and why ค่าขนส่ง is not folded into
 * ค่าเดินทาง: the first pair differs on input VAT, the second on VAT exemption.
 */
export const EXPENSE_CATEGORY_TEMPLATE_KEY = 'TH_SME_EXPENSE_CATEGORIES_V1';

/**
 * Recorded as the reviewer on bindings nobody clicked "review" on — same seam, same reasoning as
 * `TAX_CONFIG_BOOTSTRAP_ACTOR_USER_ID`. The binding is live so posting works from the first
 * expense; the sentinel keeps it honest that the chart template chose the account, not a person.
 */
export const EXPENSE_CATEGORY_BOOTSTRAP_ACTOR_USER_ID = 'system:expense-category-bootstrap';

export type ExpenseCategoryTemplateRow = {
  name: string;
  accountHintKey: string;
  /** Code in TH_SME_COA_V1. Validated against the company's bootstrapped chart before use. */
  ledgerAccountCode: string;
  /**
   * External Tax Code from WATCHDOG_TH_DOMESTIC_EXPENSE_V1, the profile onboarding activates. That
   * profile carries exactly two: `V7` ภาษีซื้อขอคืนได้ 7% and `ND` ภาษีซื้อขอคืนไม่ได้ 7%. (The
   * richer V1/VX/N1/U1 set belongs to the SAP reference template, which is documentation, not
   * something any company runs on.)
   *
   * `null` where neither fits — a VAT-exempt supply carries no input VAT to classify, and guessing
   * `ND` would misreport "VAT was charged and we may not deduct it". No suggestion means the
   * reviewer picks, which is the correct outcome when the profile cannot express the answer.
   */
  defaultInputTaxCode: string | null;
  /** Why this is its own category rather than part of a neighbour. */
  taxNote: string;
};

export const TH_SME_EXPENSE_CATEGORIES_V1: readonly ExpenseCategoryTemplateRow[] = [
  // ── Distinct VAT treatment: these five are the reason the catalogue exists at all. Fold any of
  // them into a claimable neighbour and the company reclaims input VAT it is not entitled to.
  {
    name: 'ค่ารับรอง', accountHintKey: 'expense.entertainment',
    ledgerAccountCode: '5370-03', defaultInputTaxCode: 'ND',
    taxNote: 'ภาษีซื้อต้องห้าม ม.82/5(4) — ผู้ขายเรียก VAT แต่เคลมไม่ได้ ตรงกับ ND พอดี',
  },
  {
    name: 'ค่าเช่าสำนักงานและสถานที่', accountHintKey: 'expense.rent',
    ledgerAccountCode: '5320-05', defaultInputTaxCode: null,
    taxNote: 'ให้เช่าอสังหาริมทรัพย์ยกเว้น VAT — ไม่มีภาษีซื้อให้จัดประเภท (หัก ณ ที่จ่าย 5%)',
  },
  {
    name: 'ค่าขนส่ง', accountHintKey: 'expense.freight',
    ledgerAccountCode: '5200-05', defaultInputTaxCode: null,
    taxNote: 'ขนส่งในประเทศยกเว้น VAT — ไม่มีภาษีซื้อให้จัดประเภท (หัก ณ ที่จ่าย 1%)',
  },
  {
    name: 'ค่าธรรมเนียมธนาคาร', accountHintKey: 'expense.bank_charges',
    ledgerAccountCode: '5360-04', defaultInputTaxCode: null,
    taxNote: 'ธุรกิจการเงินยกเว้น VAT — ไม่มีภาษีซื้อให้จัดประเภท',
  },
  {
    name: 'ค่าใช้จ่ายเบ็ดเตล็ด', accountHintKey: 'expense.miscellaneous',
    ledgerAccountCode: '5370-06', defaultInputTaxCode: null,
    taxNote: 'ปลายทางของสิ่งที่จัดหมวดไม่ได้ — ไม่เดาภาษีซื้อให้ ต้องให้คนเลือกเอง',
  },
  // ── Claimable input VAT. Split by withholding-tax rate, because ใบแนบ ภ.ง.ด. groups by
  // payee+ประเภทเงินได้+อัตรา and one merged category cannot be split back apart at filing time.
  {
    name: 'ค่าบริการวิชาชีพ (บัญชี/กฎหมาย/ตรวจสอบ)', accountHintKey: 'expense.professional_fees',
    ledgerAccountCode: '5360-07', defaultInputTaxCode: 'V7',
    taxNote: 'หัก ณ ที่จ่าย 3%',
  },
  {
    name: 'ค่าซ่อมแซมและบำรุงรักษา', accountHintKey: 'expense.repairs',
    ledgerAccountCode: '5320-02', defaultInputTaxCode: 'V7',
    taxNote: 'จ้างทำของ — หัก ณ ที่จ่าย 3%',
  },
  {
    name: 'ค่าโฆษณาและการตลาด', accountHintKey: 'expense.marketing',
    ledgerAccountCode: '5200-02', defaultInputTaxCode: 'V7',
    taxNote: 'หัก ณ ที่จ่าย 2%',
  },
  // ── Claimable input VAT, no withholding. Kept apart because they are the four an SME books most,
  // and a single "ค่าใช้จ่ายทั่วไป" bucket would make the P&L useless from month one.
  {
    name: 'ค่าเดินทางและยานพาหนะ', accountHintKey: 'expense.travel',
    ledgerAccountCode: '5200-09', defaultInputTaxCode: 'V7',
    taxNote: 'ภาษีซื้อขอคืนได้เมื่อมีใบกำกับภาษีเต็มรูป',
  },
  {
    name: 'ค่าอาหารและเครื่องดื่ม', accountHintKey: 'expense.meals',
    ledgerAccountCode: '5310-15', defaultInputTaxCode: 'V7',
    taxNote: 'สวัสดิการพนักงาน — แยกจากค่ารับรองซึ่งเคลมภาษีซื้อไม่ได้',
  },
  {
    name: 'ค่าสาธารณูปโภค', accountHintKey: 'expense.utilities',
    ledgerAccountCode: '5330-05', defaultInputTaxCode: 'V7',
    taxNote: 'ภาษีซื้อขอคืนได้',
  },
  {
    name: 'ค่าเครื่องเขียนและวัสดุสิ้นเปลือง', accountHintKey: 'expense.office_supplies',
    ledgerAccountCode: '5320-01', defaultInputTaxCode: 'V7',
    taxNote: 'ภาษีซื้อขอคืนได้',
  },
];

/**
 * The categories an AI reader may pick from. The catch-all's own tax note above says a person must
 * choose it, so it is never offered: "ซื้อของ 500" stays uncategorised and the draft asks, instead
 * of the model filing it under เบ็ดเตล็ด (Owner 2026-09-29). A person can still pick it anywhere.
 */
export function aiSelectableExpenseCategories<T extends { accountHintKey: string }>(categories: readonly T[]): T[] {
  return categories.filter((category) => category.accountHintKey !== 'expense.miscellaneous');
}

export type ExpenseCategoryBootstrapSummary = {
  templateKey: string;
  categoryCount: number;
  boundAccountCount: number;
};

/**
 * Call after the chart bootstrap: every `ledgerAccountCode` is checked against the company's own
 * chart under the same rule the posting-rule route enforces, so a seeded binding can never be one
 * the operator would be forbidden to set by hand.
 */
export async function bootstrapCompanyExpenseCategories(
  tx: Prisma.TransactionClient,
  input: { companyId: string; appliedAt?: Date },
): Promise<ExpenseCategoryBootstrapSummary> {
  const appliedAt = input.appliedAt ?? new Date();
  const codes = [...new Set(TH_SME_EXPENSE_CATEGORIES_V1.map((row) => row.ledgerAccountCode))];
  const accounts = await tx.chartOfAccount.findMany({
    where: { companyId: input.companyId, code: { in: codes }, status: 'ACTIVE', isPosting: true, isControlled: false },
    select: { code: true },
  });
  const postable = new Set(accounts.map((account) => account.code));
  const missing = codes.filter((code) => !postable.has(code)).sort();
  if (missing.length > 0) {
    // Fail the onboarding transaction rather than seed half a catalogue: a category whose account
    // silently did not bind looks reviewed and posts nowhere, which is the exact failure this
    // whole change exists to remove.
    throw new UnprocessableEntityException({
      code: 'expense_category_account_unmapped',
      message: 'Expense category template names accounts the bootstrapped chart does not offer.',
      details: { missing },
    });
  }

  await tx.expenseCategory.createMany({
    data: TH_SME_EXPENSE_CATEGORIES_V1.map((row, index) => ({
      companyId: input.companyId,
      name: row.name,
      accountHintKey: row.accountHintKey,
      ledgerAccountCode: row.ledgerAccountCode,
      ledgerAccountReviewedByUserId: EXPENSE_CATEGORY_BOOTSTRAP_ACTOR_USER_ID,
      ledgerAccountReviewedAt: appliedAt,
      defaultInputTaxCode: row.defaultInputTaxCode,
      sortOrder: index + 1,
    })),
  });

  return {
    templateKey: EXPENSE_CATEGORY_TEMPLATE_KEY,
    categoryCount: TH_SME_EXPENSE_CATEGORIES_V1.length,
    boundAccountCount: codes.length,
  };
}
