import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { RequestContext, CrmInboxPolicyDto, UpdateCrmInboxPolicyInput } from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';
import { effectiveInboxPolicy, validateInboxPolicyInput } from '../../domain/logic/crm-inbox.logic';
import type { CrmInboxPolicyRecord } from '../../domain/models/crm-inbox.model';

function requirePermission(ctx: RequestContext, permission: string): void {
  if (!ctx.permissions.includes(permission)) throw new ForbiddenException(`Missing permission: ${permission}`);
}

function toPolicyDto(record: CrmInboxPolicyRecord | null): CrmInboxPolicyDto {
  const effective = effectiveInboxPolicy(record);
  return {
    firstResponseMinutes: effective.firstResponseMinutes,
    businessHours: effective.businessHours,
    isDefault: !record,
    updatedAt: record?.updatedAt.toISOString(),
  };
}

@Injectable()
export class GetCrmInboxPolicyUseCase {
  constructor(private readonly repo: PrismaCrmInboxRepository) {}

  async execute(ctx: RequestContext): Promise<CrmInboxPolicyDto> {
    requirePermission(ctx, 'crm.inbox.policy_manage');
    return toPolicyDto(await this.repo.getInboxPolicy(ctx.companyId));
  }
}

@Injectable()
export class UpdateCrmInboxPolicyUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(ctx: RequestContext, input: UpdateCrmInboxPolicyInput): Promise<CrmInboxPolicyDto> {
    requirePermission(ctx, 'crm.inbox.policy_manage');

    const businessHours = input.businessHours ?? null;
    const error = validateInboxPolicyInput({ firstResponseMinutes: input.firstResponseMinutes, businessHours });
    if (error) throw new BadRequestException(error);

    const record = await this.repo.upsertInboxPolicy(ctx.companyId, {
      firstResponseMinutes: input.firstResponseMinutes,
      businessHoursJson: businessHours,
      updatedByUserId: ctx.userId,
    });

    const now = new Date();
    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'crm.inbox.policy_update',
      targetType: 'crm_inbox_policy',
      targetId: record.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'HIGH',
      metadataJson: { firstResponseMinutes: input.firstResponseMinutes, businessHours },
    });
    void this.outbox.append('crm.inbox.policy_updated', 'crm_inbox_policy', record.id, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      requestId: ctx.requestId,
      aggregateType: 'crm_inbox_policy',
      aggregateId: record.id,
      occurredAt: now.toISOString(),
      data: { firstResponseMinutes: input.firstResponseMinutes, businessHours },
    });

    return toPolicyDto(record);
  }
}
