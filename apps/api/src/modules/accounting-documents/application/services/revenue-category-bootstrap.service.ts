import type { Prisma } from '../../../../generated/prisma/client.js';

/**
 * Seeds the revenue categories a new Thai company needs on day one (ledger spec F-LED-2).
 *
 * The six names are the Owner's confirmed set (2026-08-26). Unlike the expense catalogue there is
 * deliberately NO ledger-account binding and NO default output Tax Code yet: sales posting books
 * to the default revenue account regardless of category (posting-engine.logic), and suggesting an
 * output code per category needs the named-accountant confirmation the spec §9 answer 5 defers to
 * tax-2026-verified-rules. A null suggestion means the picker offers nothing — the safe outcome —
 * and the columns are ready the day an accountant attests real values.
 *
 * Idempotent by construction: `RevenueCategory.companyId` is NOT NULL, so
 * `@@unique([companyId, name])` is a real fence and `skipDuplicates` makes re-runs no-ops. This is
 * the property the expense-side global rows lack (NULL-distinct; LED-FIN-03).
 */
export const REVENUE_CATEGORY_TEMPLATE_KEY = 'TH_SME_REVENUE_CATEGORIES_V1';

export type RevenueCategoryTemplateRow = {
  name: string;
  accountHintKey: string;
};

export const TH_SME_REVENUE_CATEGORIES_V1: readonly RevenueCategoryTemplateRow[] = [
  { name: 'ขายสินค้า', accountHintKey: 'revenue.goods' },
  { name: 'ค่าบริการ', accountHintKey: 'revenue.services' },
  { name: 'ค่าสมาชิก/คอร์ส', accountHintKey: 'revenue.membership' },
  { name: 'ค่าคอมมิชชั่น', accountHintKey: 'revenue.commission' },
  { name: 'ค่าเช่า', accountHintKey: 'revenue.rent' },
  { name: 'รายได้อื่น', accountHintKey: 'revenue.other' },
];

export type RevenueCategoryBootstrapSummary = {
  templateKey: string;
  categoryCount: number;
  createdCount: number;
};

export async function bootstrapCompanyRevenueCategories(
  tx: Prisma.TransactionClient,
  input: { companyId: string },
): Promise<RevenueCategoryBootstrapSummary> {
  const created = await tx.revenueCategory.createMany({
    data: TH_SME_REVENUE_CATEGORIES_V1.map((row, index) => ({
      companyId: input.companyId,
      name: row.name,
      accountHintKey: row.accountHintKey,
      sortOrder: index + 1,
    })),
    skipDuplicates: true,
  });

  return {
    templateKey: REVENUE_CATEGORY_TEMPLATE_KEY,
    categoryCount: TH_SME_REVENUE_CATEGORIES_V1.length,
    createdCount: created.count,
  };
}
