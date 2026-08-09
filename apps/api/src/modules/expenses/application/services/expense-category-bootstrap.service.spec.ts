import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TH_SME_COA_V1 } from '../../../ledger/domain/catalog/th-sme-chart-of-accounts-v1';
import { findTaxCodeProfileTemplate } from '../../../tax/domain/tax-code-template.catalog';
import {
  bootstrapCompanyExpenseCategories,
  EXPENSE_CATEGORY_BOOTSTRAP_ACTOR_USER_ID,
  TH_SME_EXPENSE_CATEGORIES_V1,
} from './expense-category-bootstrap.service';

const ONBOARDING_TAX_TEMPLATE_KEY = 'WATCHDOG_TH_DOMESTIC_EXPENSE_V1';

function txSeeding(chartCodes: readonly string[]) {
  const captured: { rows?: any[] } = {};
  const tx = {
    chartOfAccount: {
      findMany: async ({ where }: any) => where.code.in
        .filter((code: string) => chartCodes.includes(code))
        .map((code: string) => ({ code })),
    },
    expenseCategory: {
      createMany: async ({ data }: any) => { captured.rows = data; return { count: data.length }; },
    },
  };
  return { tx, captured };
}

const ALL_TEMPLATE_CODES = TH_SME_EXPENSE_CATEGORIES_V1.map((row) => row.ledgerAccountCode);

describe('bootstrapCompanyExpenseCategories', () => {
  // The catalogue names accounts by code, so a typo would only surface at a customer's onboarding.
  // Checking it against the chart template that onboarding actually installs moves that to build time.
  it('names only accounts the bootstrapped chart offers, postable and not a control account', () => {
    const postable = new Map(TH_SME_COA_V1.accounts.map((account) => [account.code, account]));
    for (const row of TH_SME_EXPENSE_CATEGORIES_V1) {
      const account = postable.get(row.ledgerAccountCode);
      assert.ok(account, `${row.name} names ${row.ledgerAccountCode}, absent from TH_SME_COA_V1`);
      assert.equal(account.accountClass, 'EXPENSE', `${row.name} books to a non-expense account`);
      assert.equal(account.isPosting, true, `${row.name} books to a header account`);
      assert.equal(account.isControlled, false, `${row.name} books to a control account`);
    }
  });

  it('uses only Tax Codes the onboarding tax profile activates', () => {
    const template = findTaxCodeProfileTemplate(ONBOARDING_TAX_TEMPLATE_KEY);
    assert.ok(template, `${ONBOARDING_TAX_TEMPLATE_KEY} is missing`);
    const codes = new Set(template.definitions.map((definition) => definition.externalCode));
    for (const row of TH_SME_EXPENSE_CATEGORIES_V1) {
      if (row.defaultInputTaxCode === null) continue;
      assert.ok(codes.has(row.defaultInputTaxCode), `${row.name} suggests unknown Tax Code ${row.defaultInputTaxCode}`);
    }
  });

  // The five below are the reason the catalogue is cut by tax behaviour: each would silently
  // reclaim input VAT it is not entitled to if it inherited a claimable neighbour's code.
  it('keeps the non-claimable and exempt categories off claimable input VAT', () => {
    const byName = new Map(TH_SME_EXPENSE_CATEGORIES_V1.map((row) => [row.name, row]));
    // VAT was charged and may not be deducted — exactly what ND means.
    assert.equal(byName.get('ค่ารับรอง')?.defaultInputTaxCode, 'ND');
    // Exempt supplies carry no input VAT at all, and the profile has no code that says so. No
    // suggestion beats a wrong one: ND would claim VAT was charged when none was.
    for (const name of ['ค่าเช่าสำนักงานและสถานที่', 'ค่าขนส่ง', 'ค่าธรรมเนียมธนาคาร', 'ค่าใช้จ่ายเบ็ดเตล็ด']) {
      assert.equal(byName.get(name)?.defaultInputTaxCode, null, name);
    }
  });

  it('has no duplicate category name or account hint', () => {
    assert.equal(new Set(TH_SME_EXPENSE_CATEGORIES_V1.map((r) => r.name)).size, TH_SME_EXPENSE_CATEGORIES_V1.length);
    assert.equal(new Set(TH_SME_EXPENSE_CATEGORIES_V1.map((r) => r.accountHintKey)).size, TH_SME_EXPENSE_CATEGORIES_V1.length);
  });

  it('seeds every category bound and stamped as machine-attested', async () => {
    const { tx, captured } = txSeeding(ALL_TEMPLATE_CODES);
    const summary = await bootstrapCompanyExpenseCategories(tx as any, { companyId: 'company-1' });

    assert.equal(summary.categoryCount, TH_SME_EXPENSE_CATEGORIES_V1.length);
    assert.equal(captured.rows?.length, TH_SME_EXPENSE_CATEGORIES_V1.length);
    for (const row of captured.rows!) {
      assert.equal(row.companyId, 'company-1');
      assert.ok(row.ledgerAccountCode, `${row.name} seeded without a binding`);
      // Bound so posting works from the first expense, but never claiming a person reviewed it.
      assert.equal(row.ledgerAccountReviewedByUserId, EXPENSE_CATEGORY_BOOTSTRAP_ACTOR_USER_ID);
      assert.ok(row.ledgerAccountReviewedAt instanceof Date);
    }
    assert.deepEqual(captured.rows!.map((r: any) => r.sortOrder), TH_SME_EXPENSE_CATEGORIES_V1.map((_, i) => i + 1));
  });

  it('fails onboarding rather than seed a category whose account did not bind', async () => {
    const { tx, captured } = txSeeding(ALL_TEMPLATE_CODES.slice(1));
    await assert.rejects(
      () => bootstrapCompanyExpenseCategories(tx as any, { companyId: 'company-1' }),
      (error: any) => error.getResponse?.().code === 'expense_category_account_unmapped',
    );
    assert.equal(captured.rows, undefined, 'a partial catalogue was written');
  });
});
