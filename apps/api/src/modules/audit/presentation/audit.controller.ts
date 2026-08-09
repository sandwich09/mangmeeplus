import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequirePermissions } from '../../../common/security/permissions.decorator';
import { AuditService } from '../application/audit.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { assertRouteCompany } from '../../data-model-core/presentation/http/assert-route-company';

export type AuditLogDto = {
  id: string;
  action: string;
  targetType: string;
  targetId?: string;
  actorUserId?: string;
  result: string;
  riskLevel: string;
  createdAt: string;
  requestId: string;
};

const FULL_AUDIT_ROLES = ['OWNER', 'AUDITOR_READONLY'];
const ROLE_AUDIT_CATEGORIES: Record<string, string[]> = {
  ADMIN: ['admin', 'security'],
  ACCOUNTANT: ['accounting', 'tax', 'finance'],
};

@Controller('companies/:companyId/audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  @RequirePermissions('audit.log.read')
  @ApiOperation({ summary: 'List audit logs for the current company' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'targetType', required: false })
  @ApiQuery({ name: 'actorUserId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiResponse({ status: 200, description: 'Paginated audit logs' })
  async getLogs(
    @Req() req: Request & { context: RequestContext },
    @Param('companyId') companyId: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('targetType') targetType?: string,
    @Query('actorUserId') actorUserId?: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
  ): Promise<{ data: AuditLogDto[]; total: number; page: number; pageSize: number }> {
    const ctx = req.context;
    assertRouteCompany(ctx, companyId);
    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr ?? '20', 10) || 20));

    const hasFullCompanyAudit = ctx.roles.some((role) => FULL_AUDIT_ROLES.includes(role));
    const categories = hasFullCompanyAudit
      ? undefined
      : [...new Set(ctx.roles.flatMap((role) => ROLE_AUDIT_CATEGORIES[role] ?? []))];
    const filterActorUserId = hasFullCompanyAudit || (categories?.length ?? 0) > 0 ? actorUserId : ctx.userId;

    const from = fromStr ? new Date(fromStr) : undefined;
    const to = toStr ? new Date(toStr) : undefined;

    const result = await this.auditService.getCompanyLogs({
      companyId,
      actorUserId: filterActorUserId,
      targetType,
      categories,
      from,
      to,
      page,
      pageSize,
    });

    return {
      data: result.data.map((r) => ({
        id: r.id,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        actorUserId: r.actorUserId,
        result: r.result,
        riskLevel: r.riskLevel ?? 'LOW',
        createdAt: r.createdAt.toISOString(),
        requestId: r.requestId,
      })),
      total: result.total,
      page,
      pageSize,
    };
  }
}
