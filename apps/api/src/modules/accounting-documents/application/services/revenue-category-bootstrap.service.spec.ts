import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrapCompanyRevenueCategories,
  REVENUE_CATEGORY_TEMPLATE_KEY,
  TH_SME_REVENUE_CATEGORIES_V1,
} from './revenue-category-bootstrap.service';

describe('bootstrapCompanyRevenueCategories', () => {
  it('seeds exactly the six Owner-confirmed categories, in order, with skipDuplicates', async () => {
    let captured: any;
    const tx = {
      revenueCategory: {
        createMany: mock.fn(async (args: any) => {
          captured = args;
          return { count: args.data.length };
        }),
      },
    } as any;

    const summary = await bootstrapCompanyRevenueCategories(tx, { companyId: 'company-1' });

    assert.equal(summary.templateKey, REVENUE_CATEGORY_TEMPLATE_KEY);
    assert.equal(summary.categoryCount, 6);
    assert.equal(summary.createdCount, 6);
    assert.equal(captured.skipDuplicates, true);
    assert.deepEqual(
      captured.data.map((row: any) => row.name),
      ['ขายสินค้า', 'ค่าบริการ', 'ค่าสมาชิก/คอร์ส', 'ค่าคอมมิชชั่น', 'ค่าเช่า', 'รายได้อื่น'],
    );
    assert.deepEqual(captured.data.map((row: any) => row.sortOrder), [1, 2, 3, 4, 5, 6]);
    assert.ok(captured.data.every((row: any) => row.companyId === 'company-1'));
    // Deliberately no chart binding and no tax-code suggestion until an accountant attests values
    // (spec §9 answer 5) — the bootstrap must not smuggle either in.
    assert.ok(captured.data.every((row: any) => row.ledgerAccountCode === undefined && row.defaultOutputTaxCode === undefined));
  });

  it('is a no-op on re-run: skipDuplicates reports zero created against the unique fence', async () => {
    const tx = { revenueCategory: { createMany: mock.fn(async () => ({ count: 0 })) } } as any;
    const summary = await bootstrapCompanyRevenueCategories(tx, { companyId: 'company-1' });
    assert.equal(summary.createdCount, 0);
    assert.equal(summary.categoryCount, TH_SME_REVENUE_CATEGORIES_V1.length);
  });

  it('template rows all carry a revenue.* account hint key', () => {
    assert.ok(TH_SME_REVENUE_CATEGORIES_V1.every((row) => row.accountHintKey.startsWith('revenue.')));
  });
});
