import { BadRequestException, Injectable, ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { PrismaLocationRepository } from '../../infrastructure/repositories/prisma-location.repository';
import { PrismaBalanceQuery } from '../../infrastructure/queries/balance.query';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import type { InventoryLocation, InventoryRecordStatus } from '../../domain/models/inventory.model';
import type { LocationPage } from '../../domain/ports/inventory.repository.port';
import { parseDecimalUnits } from '../../domain/logic/stock-movement.logic';

// ---- List / Get ----

@Injectable()
export class ListLocationsUseCase {
  constructor(private readonly locations: PrismaLocationRepository) {}

  async execute(ctx: RequestContext, query: { status?: InventoryRecordStatus; type?: InventoryLocation['type']; search?: string; branchId?: string; page?: number; pageSize?: number }): Promise<LocationPage> {
    if (!ctx.permissions.includes('inventory.location.read')) throw new ForbiddenException();
    if (ctx.scopes.branchIds && query.branchId && !ctx.scopes.branchIds.includes(query.branchId)) throw new ForbiddenException();
    return this.locations.list(ctx.companyId, { ...query, branchIds: ctx.scopes.branchIds });
  }
}

@Injectable()
export class GetLocationUseCase {
  constructor(private readonly locations: PrismaLocationRepository) {}

  async execute(ctx: RequestContext, locationId: string): Promise<InventoryLocation> {
    if (!ctx.permissions.includes('inventory.location.read')) throw new ForbiddenException();
    const loc = await this.locations.findById(ctx.companyId, locationId);
    if (!loc) throw new NotFoundException('Location not found');
    assertLocationScope(ctx, loc);
    return loc;
  }
}

// ---- Create ----

export type CreateLocationCommand = {
  code: string;
  name: string;
  type?: InventoryLocation['type'];
  branchId?: string;
};

@Injectable()
export class CreateLocationUseCase {
  constructor(
    private readonly locations: PrismaLocationRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(ctx: RequestContext, cmd: CreateLocationCommand): Promise<InventoryLocation> {
    if (!ctx.permissions.includes('inventory.location.manage')) throw new ForbiddenException();
    if (ctx.scopes.branchIds && cmd.branchId && !ctx.scopes.branchIds.includes(cmd.branchId)) throw new ForbiddenException();
    if (!cmd.code?.trim()) throw new BadRequestException('Location code is required');
    if (!cmd.name?.trim()) throw new BadRequestException('Location name is required');
    const existing = await this.locations.findByCode(ctx.companyId, cmd.code.trim());
    if (existing) throw new ConflictException(`Location code "${cmd.code}" already exists`);

    const loc = await this.locations.create({
      companyId: ctx.companyId,
      code: cmd.code.trim(),
      name: cmd.name,
      type: cmd.type,
      branchId: cmd.branchId,
      createdByUserId: ctx.userId,
    });

    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'inventory.location.created', targetType: 'inventoryLocation', targetId: loc.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW' });
    void this.outbox.append('inventory.location.created', 'inventoryLocation', loc.id, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      requestId: ctx.requestId,
      aggregateType: 'inventoryLocation',
      aggregateId: loc.id,
      occurredAt: loc.createdAt.toISOString(),
      data: { code: loc.code, name: loc.name, type: loc.type, status: loc.status },
    });
    return loc;
  }
}

// ---- Update ----

@Injectable()
export class UpdateLocationUseCase {
  constructor(
    private readonly locations: PrismaLocationRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(ctx: RequestContext, locationId: string, cmd: { name?: string; type?: InventoryLocation['type'] }): Promise<InventoryLocation> {
    if (!ctx.permissions.includes('inventory.location.manage')) throw new ForbiddenException();
    const loc = await this.locations.findById(ctx.companyId, locationId);
    if (!loc) throw new NotFoundException('Location not found');
    assertLocationScope(ctx, loc);
    const updated = await this.locations.update(ctx.companyId, locationId, { ...cmd, updatedByUserId: ctx.userId });
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'inventory.location.updated', targetType: 'inventoryLocation', targetId: locationId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW' });
    void this.outbox.append('inventory.location.updated', 'inventoryLocation', updated.id, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      requestId: ctx.requestId,
      aggregateType: 'inventoryLocation',
      aggregateId: updated.id,
      occurredAt: updated.updatedAt.toISOString(),
      data: { code: updated.code, name: updated.name, type: updated.type, status: updated.status },
    });
    return updated;
  }
}

// ---- Archive ----

@Injectable()
export class ArchiveLocationUseCase {
  constructor(
    private readonly locations: PrismaLocationRepository,
    private readonly balance: PrismaBalanceQuery,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(ctx: RequestContext, locationId: string): Promise<InventoryLocation> {
    if (!ctx.permissions.includes('inventory.location.manage')) throw new ForbiddenException();
    const loc = await this.locations.findById(ctx.companyId, locationId);
    if (!loc) throw new NotFoundException('Location not found');
    assertLocationScope(ctx, loc);
    if (loc.status === 'ARCHIVED') throw new ConflictException('Location is already archived');

    // Block archive if non-zero balance exists at this location
    const balances = await this.balance.listBalances(ctx.companyId, { locationId });
    const hasStock = balances.some((b) => (parseDecimalUnits(b.quantity) ?? 0n) > 0n);
    if (hasStock) throw new ConflictException('Cannot archive location with non-zero stock balance');

    const updated = await this.locations.update(ctx.companyId, locationId, { status: 'ARCHIVED', updatedByUserId: ctx.userId });
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'inventory.location.archived', targetType: 'inventoryLocation', targetId: locationId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM' });
    void this.outbox.append('inventory.location.archived', 'inventoryLocation', updated.id, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      requestId: ctx.requestId,
      aggregateType: 'inventoryLocation',
      aggregateId: updated.id,
      occurredAt: updated.updatedAt.toISOString(),
      data: { code: updated.code, status: updated.status },
    });
    return updated;
  }
}

function assertLocationScope(ctx: RequestContext, location: InventoryLocation): void {
  if (ctx.scopes.branchIds && location.branchId && !ctx.scopes.branchIds.includes(location.branchId)) {
    throw new ForbiddenException();
  }
}
