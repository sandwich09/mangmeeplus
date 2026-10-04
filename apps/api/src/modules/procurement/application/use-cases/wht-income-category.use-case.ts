import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';

export type WhtIncomeCategoryOption = { code: string; nameTh: string; formType: string; defaultRate: string };

/**
 * The income categories an AP operator or Expenses reviewer may withhold under.
 *
 * The tax module already exposes this catalog, but behind `tax.config.read` — a permission the
 * finance user recording a payment has no reason to hold. A company that never bought the tax
 * feature still withholds tax and still owes its payee a 50 ทวิ, the same reasoning that keeps the
 * AP withholding panel off `thai_tax` (accounts-payable.logic.ts).
 *
 * `procurement.supplier_payment.read` OR `expense.create` — WHT certificate system issuance plan
 * §1.2 reuses this use case directly from the Expenses income-category endpoint rather than
 * duplicating the query, so a review-only Expenses role (which often lacks any procurement
 * permission — permission-registry.ts's employee/reviewer grants) must not be shut out of the same
 * catalog an AP operator sees.
 *
 * ACTIVE only: the owner's 2026-10-04 baseline opens 12 categories; exceptional categories and
 * any category later disabled by Mangmee remain unavailable for new selections.
 */
@Injectable()
export class ListWhtIncomeCategoriesUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(ctx: RequestContext): Promise<WhtIncomeCategoryOption[]> {
    if (!ctx.permissions.includes('procurement.supplier_payment.read') && !ctx.permissions.includes('expense.create')) {
      throw new ForbiddenException();
    }
    const rows = await this.prisma.client.whtIncomeCategory.findMany({
      where: { status: 'ACTIVE' },
      select: { code: true, nameTh: true, formType: true, defaultRate: true },
      orderBy: { code: 'asc' },
    });
    return rows.map((row) => ({ code: row.code, nameTh: row.nameTh, formType: String(row.formType), defaultRate: String(row.defaultRate) }));
  }
}
