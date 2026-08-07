import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { AuditService } from '../../../audit/application/audit.service';
import { PrismaQrLabelRepository } from '../../infrastructure/repositories/prisma-qrlabel.repository';
import { PrismaProductRepository } from '../../infrastructure/repositories/prisma-product.repository';
import { PrismaLocationRepository } from '../../infrastructure/repositories/prisma-location.repository';
import { buildProductQrPayload, buildLocationQrPayload, parseQrPayload, QrScanResult } from '../../domain/logic/stock-movement.logic';
import type { InternalQrLabel } from '../../domain/models/inventory.model';

// ---- Generate QR label ----

export type GenerateQrLabelCommand = {
  entityType: 'PRODUCT' | 'LOCATION';
  entityId: string;
  labelText?: string;
};

@Injectable()
export class GenerateQrLabelUseCase {
  constructor(
    private readonly labels: PrismaQrLabelRepository,
    private readonly products: PrismaProductRepository,
    private readonly locations: PrismaLocationRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, cmd: GenerateQrLabelCommand): Promise<InternalQrLabel> {
    if (!ctx.permissions.includes('inventory.label.manage')) throw new ForbiddenException();

    const labelText = await this.resolveLabelText(ctx, cmd);
    const payload =
      cmd.entityType === 'PRODUCT'
        ? buildProductQrPayload(cmd.entityId)
        : buildLocationQrPayload(cmd.entityId);

    // Return existing if already generated (idempotent)
    const existing = await this.labels.findByPayload(ctx.companyId, payload);
    if (existing) return existing;

    const label = await this.labels.create({
      companyId: ctx.companyId,
      entityType: cmd.entityType,
      entityId: cmd.entityId,
      payload,
      labelText,
      createdByUserId: ctx.userId,
    });

    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'inventory.label.generated',
      targetType: 'internalQrLabel',
      targetId: label.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'LOW',
    });

    return label;
  }

  private async resolveLabelText(ctx: RequestContext, cmd: GenerateQrLabelCommand): Promise<string> {
    if (cmd.entityType === 'PRODUCT') {
      const product = await this.products.findById(ctx.companyId, cmd.entityId);
      if (!product) throw new NotFoundException('Product not found');
      if (product.status !== 'ACTIVE') throw new BadRequestException('Archived product cannot receive active QR label');
      return cmd.labelText?.trim() || `${product.sku} ${product.name}`;
    }

    const location = await this.locations.findById(ctx.companyId, cmd.entityId);
    if (!location) throw new NotFoundException('Location not found');
    if (ctx.scopes.branchIds && location.branchId && !ctx.scopes.branchIds.includes(location.branchId)) throw new ForbiddenException();
    if (location.status !== 'ACTIVE') throw new BadRequestException('Archived location cannot receive active QR label');
    return cmd.labelText?.trim() || `${location.code} ${location.name}`;
  }
}

// ---- Resolve QR scan ----

@Injectable()
export class ResolveQrScanUseCase {
  constructor(
    private readonly labels: PrismaQrLabelRepository,
    private readonly products: PrismaProductRepository,
    private readonly locations: PrismaLocationRepository,
  ) {}

  async execute(ctx: RequestContext, rawPayload: string): Promise<QrScanResult> {
    const parsed = parseQrPayload(rawPayload);
    if (!parsed) throw new BadRequestException('Unrecognized QR payload format');

    // Verify entity is accessible in this company by checking a label exists
    const labels = await this.labels.findByEntity(ctx.companyId, parsed.entityType, parsed.entityId);
    if (labels.length === 0) throw new NotFoundException('QR label not found in this company');
    if (parsed.entityType === 'PRODUCT') {
      const product = await this.products.findById(ctx.companyId, parsed.entityId);
      if (!product) throw new NotFoundException('Product not found');
    } else {
      const location = await this.locations.findById(ctx.companyId, parsed.entityId);
      if (!location) throw new NotFoundException('Location not found');
      if (ctx.scopes.branchIds && location.branchId && !ctx.scopes.branchIds.includes(location.branchId)) throw new ForbiddenException();
    }

    return parsed;
  }
}

// ---- Mark Printed ----

@Injectable()
export class MarkQrLabelPrintedUseCase {
  constructor(
    private readonly labels: PrismaQrLabelRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, labelId: string): Promise<InternalQrLabel> {
    if (!ctx.permissions.includes('inventory.label.manage')) throw new ForbiddenException();
    const updated = await this.labels.markPrinted(ctx.companyId, labelId, ctx.userId);
    if (!updated) throw new NotFoundException('Label not found');
    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'inventory.label.printed',
      targetType: 'internalQrLabel',
      targetId: labelId,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'LOW',
    });
    return updated;
  }
}

// ---- List labels ----

@Injectable()
export class ListQrLabelsUseCase {
  constructor(private readonly labels: PrismaQrLabelRepository) {}

  async execute(ctx: RequestContext, entityType: 'PRODUCT' | 'LOCATION', entityId: string): Promise<InternalQrLabel[]> {
    if (!ctx.permissions.includes('inventory.label.manage') && !ctx.permissions.includes('inventory.product.read')) {
      throw new ForbiddenException();
    }
    return this.labels.findByEntity(ctx.companyId, entityType, entityId);
  }
}
