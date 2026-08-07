import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaAccountingRepository } from '../../infrastructure/prisma-accounting.repository';
import { AuditService } from '../../../audit/application/audit.service';
import type { RequestContext } from '@watchdog-bms/contracts';
import type { CreateCounterpartyInput, UpdateCounterpartyInput, CounterpartyRecord } from '../../domain/models/accounting.model';

@Injectable()
export class CreateCounterpartyUseCase {
  constructor(private readonly repo: PrismaAccountingRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, input: Omit<CreateCounterpartyInput, 'companyId' | 'createdByUserId'>): Promise<CounterpartyRecord> {
    if (!ctx.permissions.includes('accounting.counterparty.manage')) throw new ForbiddenException('Missing permission: accounting.counterparty.manage');

    const result = await this.repo.createCounterparty({ ...input, companyId: ctx.companyId, createdByUserId: ctx.userId });

    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'accounting.counterparty.create', targetType: 'accounting_counterparty', targetId: result.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM' });

    return result;
  }
}

@Injectable()
export class UpdateCounterpartyUseCase {
  constructor(private readonly repo: PrismaAccountingRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, counterpartyId: string, input: Omit<UpdateCounterpartyInput, 'companyId' | 'counterpartyId' | 'updatedByUserId'>): Promise<CounterpartyRecord> {
    if (!ctx.permissions.includes('accounting.counterparty.manage')) throw new ForbiddenException('Missing permission: accounting.counterparty.manage');

    const existing = await this.repo.findCounterpartyById(ctx.companyId, counterpartyId);
    if (!existing) throw new NotFoundException(`Counterparty ${counterpartyId} not found`);

    const result = await this.repo.updateCounterparty({ ...input, companyId: ctx.companyId, counterpartyId, updatedByUserId: ctx.userId });

    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'accounting.counterparty.update', targetType: 'accounting_counterparty', targetId: result.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM' });

    return result;
  }
}

@Injectable()
export class GetCounterpartyUseCase {
  constructor(private readonly repo: PrismaAccountingRepository) {}

  async execute(ctx: RequestContext, counterpartyId: string): Promise<CounterpartyRecord> {
    if (!ctx.permissions.includes('accounting.counterparty.read')) throw new ForbiddenException('Missing permission: accounting.counterparty.read');
    const result = await this.repo.findCounterpartyById(ctx.companyId, counterpartyId);
    if (!result) throw new NotFoundException(`Counterparty ${counterpartyId} not found`);
    return result;
  }
}

@Injectable()
export class ListCounterpartiesUseCase {
  constructor(private readonly repo: PrismaAccountingRepository) {}

  async execute(ctx: RequestContext, page = 1, pageSize = 20): Promise<{ data: CounterpartyRecord[]; total: number }> {
    if (!ctx.permissions.includes('accounting.counterparty.read')) throw new ForbiddenException('Missing permission: accounting.counterparty.read');
    return this.repo.listCounterparties(ctx.companyId, page, pageSize);
  }
}
