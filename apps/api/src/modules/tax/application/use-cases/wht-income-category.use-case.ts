import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../../audit/application/audit.service';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';
import type { RequestContext } from '@watchdog-bms/contracts';
import { assertPlatformTenant } from '../../../sales-console/application/sales-context';

const STATUSES = ['ACTIVE', 'DRAFT'] as const;
type WhtCategoryStatus = (typeof STATUSES)[number];

/**
 * Turns a seeded WHT income category on or off for withholding.
 *
 * Owner decision 2026-10-04 opens 12 categories; only Mangmee's platform administrators may
 * change this global catalog. The tenant boundary applies here too, including the legacy route.
 *
 * Deactivating is deliberately allowed and deliberately harmless to history: settled payments keep
 * the code and rate they withheld under (the columns are copies, not a foreign key), so retiring a
 * category only stops NEW withholding under it.
 */
@Injectable()
export class SetWhtIncomeCategoryStatusUseCase {
  constructor(private readonly taxRepo: PrismaTaxRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, code: string, status: string) {
    assertPlatformTenant(ctx);
    if (!ctx.permissions.includes('system.wht_income_category.manage')) throw new ForbiddenException('คุณไม่มีสิทธิ์จัดการประเภทเงินได้หัก ณ ที่จ่ายของระบบ');
    if (!STATUSES.includes(status as WhtCategoryStatus)) throw new BadRequestException('กรุณาเลือกเปิดใช้หรือปิดใช้ประเภทเงินได้');

    const existing = await this.taxRepo.prisma.client.whtIncomeCategory.findUnique({ where: { code } });
    if (!existing) throw new NotFoundException('ไม่พบประเภทเงินได้หัก ณ ที่จ่าย');

    const updated = await this.taxRepo.prisma.client.whtIncomeCategory.update({
      where: { code },
      data: { status: status as never },
    });

    // HIGH risk: this changes which statutory categories and default rates every shop can select.
    // Certificates keep the rate saved in their source payment/handoff.
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
