import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../../audit/application/audit.service';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';
import type { RequestContext } from '@watchdog-bms/contracts';

const STATUSES = ['ACTIVE', 'DRAFT'] as const;
type WhtCategoryStatus = (typeof STATUSES)[number];

/**
 * Turns a seeded WHT income category on or off for withholding.
 *
 * The catalog ships DRAFT with "Accountant verification required" on every row, because a rate
 * nobody has checked against the RD must never reach a 50 ทวิ. Until this existed nothing in the
 * codebase could move a row out of DRAFT — the seed was the only writer — so the verification the
 * note asks for had no way to be recorded and the pay-side withholding form had nothing to offer.
 *
 * Deactivating is deliberately allowed and deliberately harmless to history: settled payments keep
 * the code and rate they withheld under (the columns are copies, not a foreign key), so retiring a
 * category only stops NEW withholding under it.
 */
@Injectable()
export class SetWhtIncomeCategoryStatusUseCase {
  constructor(private readonly taxRepo: PrismaTaxRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, code: string, status: string) {
    if (!ctx.permissions.includes('tax.config.manage')) throw new ForbiddenException('Missing permission: tax.config.manage');
    if (!STATUSES.includes(status as WhtCategoryStatus)) throw new BadRequestException(`status must be one of ${STATUSES.join(', ')}`);

    const existing = await this.taxRepo.prisma.client.whtIncomeCategory.findUnique({ where: { code } });
    if (!existing) throw new NotFoundException(`WHT income category ${code} was not found`);

    const updated = await this.taxRepo.prisma.client.whtIncomeCategory.update({
      where: { code },
      data: { status: status as never },
    });

    // HIGH risk on purpose: activating a category is the act of vouching for a statutory rate, and
    // every certificate issued afterwards inherits it.
    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.wht_income_category.set_status',
      targetType: 'wht_income_category', targetId: code, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { code, from: existing.status, to: status, defaultRate: String(existing.defaultRate), formType: String(existing.formType) },
    });

    return {
      code: updated.code, nameTh: updated.nameTh, formType: String(updated.formType),
      defaultRate: String(updated.defaultRate), status: String(updated.status),
    };
  }
}
