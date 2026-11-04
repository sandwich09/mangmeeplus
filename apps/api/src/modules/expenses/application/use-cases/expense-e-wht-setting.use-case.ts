import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { ExpenseEWhtSetting, RequestContext, UpdateExpenseEWhtSettingInput } from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { assertExpenseFinancialAccess } from '../expense-commercial-access';

const READ_PERMISSIONS = ['company.setup.manage', 'expense.review', 'expense.confirm', 'expense.create', 'expense.update', 'expense.read', 'expense.read_related', 'expense.read_own'];

@Injectable()
export class GetExpenseEWhtSettingUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext): Promise<ExpenseEWhtSetting> {
    if (!READ_PERMISSIONS.some(permission => ctx.permissions.includes(permission))) throw new ForbiddenException();
    await assertExpenseFinancialAccess(ctx, this.repo.commercialAccessDb);
    return this.repo.getEWhtSetting(ctx.companyId);
  }
}

@Injectable()
export class UpdateExpenseEWhtSettingUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, input: UpdateExpenseEWhtSettingInput): Promise<ExpenseEWhtSetting> {
    if (!ctx.permissions.includes('company.setup.manage')) throw new ForbiddenException();
    await assertExpenseFinancialAccess(ctx, this.repo.commercialAccessDb);
    if (typeof input?.used !== 'boolean') throw new BadRequestException('เลือกว่าร้านสมัครบริการหักภาษีผ่านธนาคารแล้วหรือยัง');
    return this.repo.updateEWhtSetting(ctx.companyId, input.used, ctx.userId, (tx, before) => this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      action: 'company.e_wht_setting.updated', targetType: 'company_tax_profile', targetId: ctx.companyId,
      result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { before, after: { used: input.used } },
    }, tx));
  }
}
