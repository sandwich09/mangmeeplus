import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateRevenueCategoryInput, RequestContext, RevenueCategorySummary, UpdateRevenueCategoryInput } from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { PrismaAccountingRepository } from '../../infrastructure/prisma-accounting.repository';

// ─── Revenue category management (accounting.revenue_category.manage) ────────
// Mirrors the expense-category admin surface (expense-document.use-case.ts); web/API only —
// LINE/AI can never call these. Categories archive, they never hard-delete (ledger spec §2.5).

function hasPerm(ctx: RequestContext, permission: string): boolean {
  return ctx.permissions.includes(permission);
}

@Injectable()
export class ListRevenueCategoriesUseCase {
  constructor(private readonly repo: PrismaAccountingRepository) {}

  /** ACTIVE rows only, for pickers. Gated by the document-read family at the controller. */
  async execute(ctx: RequestContext): Promise<RevenueCategorySummary[]> {
    return this.repo.listRevenueCategories(ctx.companyId);
  }
}

@Injectable()
export class ListAllRevenueCategoriesUseCase {
  constructor(private readonly repo: PrismaAccountingRepository) {}

  async execute(ctx: RequestContext): Promise<RevenueCategorySummary[]> {
    if (!hasPerm(ctx, 'accounting.revenue_category.manage')) {
      throw new ForbiddenException('Missing permission: accounting.revenue_category.manage');
    }
    return this.repo.listAllRevenueCategories(ctx.companyId);
  }
}

@Injectable()
export class CreateRevenueCategoryUseCase {
  constructor(private readonly repo: PrismaAccountingRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, input: CreateRevenueCategoryInput): Promise<RevenueCategorySummary> {
    if (!hasPerm(ctx, 'accounting.revenue_category.manage')) {
      throw new ForbiddenException('Missing permission: accounting.revenue_category.manage');
    }
    if (!input.name?.trim()) throw new BadRequestException('Category name is required');
    if (!input.accountHintKey?.trim()) throw new BadRequestException('accountHintKey is required');
    try {
      const category = await this.repo.createRevenueCategory(ctx.companyId, { ...input, name: input.name.trim() });
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'accounting.revenue_category.create', targetType: 'revenue_category', targetId: category.id,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { name: category.name },
      });
      return category;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new ConflictException(`Category name already exists: ${input.name}`);
      throw err;
    }
  }
}

@Injectable()
export class UpdateRevenueCategoryUseCase {
  constructor(private readonly repo: PrismaAccountingRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, categoryId: string, input: UpdateRevenueCategoryInput): Promise<RevenueCategorySummary> {
    if (!hasPerm(ctx, 'accounting.revenue_category.manage')) {
      throw new ForbiddenException('Missing permission: accounting.revenue_category.manage');
    }
    const existing = await this.repo.findRevenueCategoryById(ctx.companyId, categoryId);
    if (!existing) throw new NotFoundException('Revenue category not found');
    if (input.name !== undefined && !input.name.trim()) throw new BadRequestException('Category name cannot be empty');
    try {
      const updated = await this.repo.updateRevenueCategory(ctx.companyId, categoryId, {
        ...input,
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      });
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'accounting.revenue_category.update', targetType: 'revenue_category', targetId: categoryId,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
        metadataJson: { name: updated.name, status: updated.status },
      });
      return updated;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new ConflictException(`Category name already exists: ${input.name}`);
      throw err;
    }
  }
}
