import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  COMPANY_TEAM_NOTE_MANAGE_PERMISSION, COMPANY_TEAM_NOTE_MAX_LENGTH, COMPANY_TEAM_NOTE_WORDS as W,
  type CompanyTeamNoteDto, type PutCompanyTeamNoteBody,
} from '@watchdog-bms/contracts';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { AuditService } from '../../audit/application/audit.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { assertPlatformTenant, isSystemAdmin, PLATFORM_TENANT_ID } from '../../sales-console/application/sales-context';
import { lockPlanTermCompany } from './lock-plan-term-company';

@Injectable()
export class CompanyTeamNoteService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async get(ctx: RequestContext, companyId: string): Promise<CompanyTeamNoteDto> {
    const canManage = this.access(ctx);
    const company = await this.prisma.client.company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!company) throw new NotFoundException({ code: 'company_team_note_company_not_found', message: W.notFound });
    const row = await this.prisma.client.companyTeamNote.findUnique({ where: { companyId } });
    return this.view(this.prisma.client, companyId, row, canManage);
  }

  async put(ctx: RequestContext, companyId: string, body: PutCompanyTeamNoteBody): Promise<CompanyTeamNoteDto> {
    const canManage = this.access(ctx);
    if (!canManage) throw new ForbiddenException({ code: 'company_team_note_edit_denied', message: W.editDenied });
    if (typeof body?.text !== 'string' || !Number.isSafeInteger(body?.expectedVersion) || body.expectedVersion < 0) {
      throw new BadRequestException({ code: 'company_team_note_invalid', message: W.invalid });
    }
    const text = body.text.trim();
    if (text.length > COMPANY_TEAM_NOTE_MAX_LENGTH) {
      throw new BadRequestException({ code: 'company_team_note_too_long', message: W.tooLong });
    }
    try {
      return await this.prisma.client.$transaction(async tx => {
        // Company is the existing lock for admin edits, including two first writes and deletion.
        await lockPlanTermCompany(tx, companyId);
        const company = await tx.company.findUnique({ where: { id: companyId }, select: { id: true } });
        if (!company) throw new NotFoundException({ code: 'company_team_note_company_not_found', message: W.notFound });
        const before = await tx.companyTeamNote.findUnique({ where: { companyId } });
        const version = before?.version ?? 0;
        if (body.expectedVersion !== version) {
          throw new ConflictException({ code: 'company_team_note_version_conflict', message: W.conflict });
        }
        if ((before?.text ?? '') === text) return this.view(tx, companyId, before, canManage);
        const updatedAt = new Date();
        const row = await tx.companyTeamNote.upsert({
          where: { companyId },
          create: { companyId, text, version: 1, updatedAt, updatedByUserId: ctx.userId },
          update: { text, version: { increment: 1 }, updatedAt, updatedByUserId: ctx.userId },
        });
        // Keep text out of all metadata: notes can contain private details, and audit strings are bounded.
        await this.audit.log({ companyId: PLATFORM_TENANT_ID, actorUserId: ctx.userId,
          action: 'system.company_team_note.update', targetType: 'Company', targetId: companyId,
          requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
          metadataJson: { beforeLength: before?.text.length ?? 0, afterLength: text.length, beforeVersion: version, afterVersion: row.version },
        }, tx);
        return this.view(tx, companyId, row, canManage);
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Prisma errors can embed submitted text. Do not let raw errors reach the global logger.
      throw new ServiceUnavailableException({ code: 'company_team_note_save_unconfirmed', message: W.saveUnknown });
    }
  }

  private access(ctx: RequestContext): boolean {
    try { assertPlatformTenant(ctx); }
    catch { throw new ForbiddenException({ code: 'company_team_note_read_denied', message: W.denied }); }
    const admin = isSystemAdmin(ctx);
    const executiveRead = ctx.permissions.includes('system.executive.read');
    if (!admin && !executiveRead && !ctx.permissions.includes('system.partner_dashboard.read')) {
      throw new ForbiddenException({ code: 'company_team_note_read_denied', message: W.denied });
    }
    return admin || (executiveRead && ctx.permissions.includes(COMPANY_TEAM_NOTE_MANAGE_PERMISSION));
  }

  private async view(tx: Prisma.TransactionClient, companyId: string, row: {
    text: string; version: number; updatedAt: Date; updatedByUserId: string;
  } | null, canManage: boolean): Promise<CompanyTeamNoteDto> {
    const actor = row ? await tx.user.findUnique({ where: { id: row.updatedByUserId }, select: { displayName: true } }) : null;
    return { companyId, text: row?.text ?? '', version: row?.version ?? 0, updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row ? { userId: row.updatedByUserId, displayName: actor?.displayName || W.unknownEditor } : null, canManage };
  }
}
