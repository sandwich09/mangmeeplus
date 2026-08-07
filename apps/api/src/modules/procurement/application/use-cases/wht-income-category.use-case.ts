import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';

export type WhtIncomeCategoryOption = { code: string; nameTh: string; formType: string; defaultRate: string };

/**
 * The income categories an AP operator may withhold under.
 *
 * The tax module already exposes this catalog, but behind `tax.config.read` — a permission the
 * finance user recording a payment has no reason to hold. A company that never bought the tax
 * feature still withholds tax and still owes its payee a 50 ทวิ, the same reasoning that keeps the
 * AP withholding panel off `thai_tax` (accounts-payable.logic.ts).
 *
 * ACTIVE only, and deliberately so: the catalog ships DRAFT pending accountant review, and a rate
 * nobody has verified must not end up on a legal document.
 */
@Injectable()
export class ListWhtIncomeCategoriesUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(ctx: RequestContext): Promise<WhtIncomeCategoryOption[]> {
    if (!ctx.permissions.includes('procurement.supplier_payment.read')) throw new ForbiddenException();
    const rows = await this.prisma.client.whtIncomeCategory.findMany({
      where: { status: 'ACTIVE' },
      select: { code: true, nameTh: true, formType: true, defaultRate: true },
      orderBy: { code: 'asc' },
    });
    return rows.map((row) => ({ code: row.code, nameTh: row.nameTh, formType: String(row.formType), defaultRate: String(row.defaultRate) }));
  }
}
