import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  RequestContext,
  CrmMessageTemplateSummary,
  CreateCrmMessageTemplateInput,
  UpdateCrmMessageTemplateInput,
} from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';
import type { CrmMessageTemplateRecord } from '../../domain/models/crm-inbox.model';

function requirePermission(ctx: RequestContext, permission: string): void {
  if (!ctx.permissions.includes(permission)) throw new ForbiddenException(`Missing permission: ${permission}`);
}

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 4000; // keep within one LINE push text message

function validateTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new BadRequestException('Template title is required');
  if (trimmed.length > MAX_TITLE_LENGTH) throw new BadRequestException(`Template title must be at most ${MAX_TITLE_LENGTH} characters`);
  return trimmed;
}

function validateBody(bodyText: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed) throw new BadRequestException('Template body is required');
  if (trimmed.length > MAX_BODY_LENGTH) throw new BadRequestException(`Template body must be at most ${MAX_BODY_LENGTH} characters`);
  return trimmed;
}

export function toTemplateSummary(record: CrmMessageTemplateRecord): CrmMessageTemplateSummary {
  return {
    id: record.id,
    companyId: record.companyId,
    title: record.title,
    bodyText: record.bodyText,
    category: record.category ?? undefined,
    status: record.status,
    version: record.version,
    aiApproved: record.status === 'ACTIVE' && record.aiApprovedVersion === record.version,
    aiApprovedVersion: record.aiApprovedVersion ?? undefined,
    aiApprovedAt: record.aiApprovedAt?.toISOString(),
    aiApprovedByUserId: record.aiApprovedByUserId ?? undefined,
    createdByUserId: record.createdByUserId,
    updatedByUserId: record.updatedByUserId ?? undefined,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

@Injectable()
export class ListCrmMessageTemplatesUseCase {
  constructor(private readonly repo: PrismaCrmInboxRepository) {}

  async execute(ctx: RequestContext, includeArchived = false): Promise<CrmMessageTemplateSummary[]> {
    requirePermission(ctx, 'crm.template.read');
    const active = await this.repo.listTemplates(ctx.companyId, 'ACTIVE');
    if (!includeArchived) return active.map(toTemplateSummary);
    const archived = await this.repo.listTemplates(ctx.companyId, 'ARCHIVED');
    return [...active, ...archived].map(toTemplateSummary);
  }
}

@Injectable()
export class CreateCrmMessageTemplateUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, input: CreateCrmMessageTemplateInput): Promise<CrmMessageTemplateSummary> {
    requirePermission(ctx, 'crm.template.manage');
    const title = validateTitle(input.title ?? '');
    const bodyText = validateBody(input.bodyText ?? '');

    // Friendly pre-check; the partial unique index is the real guarantee.
    if (await this.repo.findActiveTemplateByTitle(ctx.companyId, title)) {
      throw new ConflictException(`Active template titled "${title}" already exists`);
    }

    const record = await this.repo.createTemplate({
      companyId: ctx.companyId,
      title,
      bodyText,
      category: input.category?.trim() || undefined,
      createdByUserId: ctx.userId,
    });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.template.create',
      targetType: 'crm_message_template', targetId: record.id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'LOW',
      metadataJson: { title: record.title },
    });

    return toTemplateSummary(record);
  }
}

@Injectable()
export class UpdateCrmMessageTemplateUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, templateId: string, input: UpdateCrmMessageTemplateInput): Promise<CrmMessageTemplateSummary> {
    requirePermission(ctx, 'crm.template.manage');

    const existing = await this.repo.findTemplateById(ctx.companyId, templateId);
    if (!existing) throw new NotFoundException(`Template ${templateId} not found`);
    if (existing.status !== 'ACTIVE') throw new BadRequestException('Archived templates cannot be edited');

    const title = input.title !== undefined ? validateTitle(input.title) : undefined;
    const bodyText = input.bodyText !== undefined ? validateBody(input.bodyText) : undefined;

    if (title && title !== existing.title) {
      const clash = await this.repo.findActiveTemplateByTitle(ctx.companyId, title);
      if (clash && clash.id !== templateId) throw new ConflictException(`Active template titled "${title}" already exists`);
    }

    const record = await this.repo.updateTemplate(ctx.companyId, templateId, {
      title,
      bodyText,
      category: input.category === undefined ? undefined : input.category?.trim() || null,
      version: existing.version + 1,
      aiApprovedVersion: null,
      aiApprovedAt: null,
      aiApprovedByUserId: null,
      updatedByUserId: ctx.userId,
    });
    if (!record) throw new NotFoundException(`Template ${templateId} not found`);

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.template.update',
      targetType: 'crm_message_template', targetId: templateId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'LOW',
      metadataJson: { title: record.title },
    });

    return toTemplateSummary(record);
  }
}

@Injectable()
export class ApproveCrmMessageTemplateForAiUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, templateId: string): Promise<CrmMessageTemplateSummary> {
    requirePermission(ctx, 'crm.template.manage');
    const existing = await this.repo.findTemplateById(ctx.companyId, templateId);
    if (!existing) throw new NotFoundException(`Template ${templateId} not found`);
    if (existing.status !== 'ACTIVE') throw new BadRequestException('Archived templates cannot be approved for AI');
    if (existing.aiApprovedVersion === existing.version) return toTemplateSummary(existing);

    const record = await this.repo.approveTemplateVersionForAi(
      ctx.companyId,
      templateId,
      existing.version,
      ctx.userId,
    );
    if (!record) throw new ConflictException('Template changed during review; review the latest version and approve again');

    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.template.ai_approve',
      targetType: 'crm_message_template', targetId: templateId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { title: record.title, version: record.version },
    });
    return toTemplateSummary(record);
  }
}

@Injectable()
export class ArchiveCrmMessageTemplateUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, templateId: string): Promise<CrmMessageTemplateSummary> {
    requirePermission(ctx, 'crm.template.manage');

    const existing = await this.repo.findTemplateById(ctx.companyId, templateId);
    if (!existing) throw new NotFoundException(`Template ${templateId} not found`);
    if (existing.status === 'ARCHIVED') return toTemplateSummary(existing);

    const record = await this.repo.updateTemplate(ctx.companyId, templateId, {
      status: 'ARCHIVED',
      updatedByUserId: ctx.userId,
    });
    if (!record) throw new NotFoundException(`Template ${templateId} not found`);

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.template.archive',
      targetType: 'crm_message_template', targetId: templateId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'LOW',
      metadataJson: { title: record.title },
    });

    return toTemplateSummary(record);
  }
}
