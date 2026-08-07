/**
 * Dashboard and notification ERP read tool adapters for LINE AI.
 * Each adapter re-checks server-side permissions; returns ToolResult with source refs.
 */
import { Injectable } from '@nestjs/common';
import type { ToolResult, SourceRef } from '@watchdog-bms/contracts';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';
import { GenerateSnapshotUseCase } from '../../../dashboard-notifications/application/use-cases/generate-snapshot.use-case';
import { ListNotificationsUseCase, GetUnreadCountUseCase } from '../../../dashboard-notifications/application/use-cases/notification.use-cases';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';

function now(): string { return new Date().toISOString(); }

function toCtx(ctx: ErpToolContext): RequestContext {
  return {
    requestId: ctx.requestId ?? '',
    authSubject: ctx.userId,
    userId: ctx.userId,
    companyId: ctx.companyId,
    membershipId: ctx.membershipId ?? '',
    roles: [],
    permissions: ctx.permissions,
    scopes: { branchIds: ctx.branchIds, locationIds: ctx.locationIds },
    authProvider: 'watchdog',
  };
}

// ---- company.get_current_context ----

@Injectable()
export class CompanyGetCurrentContextTool implements ErpReadToolPort {
  toolName = 'company.get_current_context';
  constructor(private readonly prisma: PrismaService) {}

  async execute(ctx: ErpToolContext): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('company.setup.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const company = await this.prisma.client.company.findUnique({
      where: { id: ctx.companyId },
      select: { id: true, name: true, taxId: true },
    });
    if (!company) return { toolName: this.toolName, status: 'unavailable', sourceRefs: [], asOf };
    const sourceRefs: SourceRef[] = [{ label: company.name, module: 'data-model-core', entityType: 'company', entityId: company.id, asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}/settings` }];
    return { toolName: this.toolName, status: 'ok', data: { id: company.id, name: company.name, taxId: company.taxId }, sourceRefs, asOf };
  }
}

// ---- company.list_branches ----

@Injectable()
export class CompanyListBranchesTool implements ErpReadToolPort {
  toolName = 'company.list_branches';
  constructor(private readonly prisma: PrismaService) {}

  async execute(ctx: ErpToolContext): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('company.branch.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const branches = await this.prisma.client.branch.findMany({
      where: { companyId: ctx.companyId, status: 'ACTIVE' },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    const sourceRefs: SourceRef[] = [{
      label: 'สาขาของบริษัท',
      module: 'data-model-core',
      entityType: 'branch_list',
      asOf,
      permissionChecked: true,
      webPath: `/companies/${ctx.companyId}/settings/branches`,
    }];
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        total: branches.length,
        branches: branches.map((b) => ({ code: b.code, name: b.name, type: b.type })),
        // Caller's own branch scope (empty = sees all branches)
        scopedBranchNames: ctx.branchIds?.length
          ? branches.filter((b) => ctx.branchIds!.includes(b.id)).map((b) => b.name)
          : [],
      },
      sourceRefs,
      asOf,
    };
  }
}

// ---- dashboard.get_business_health_summary ----

@Injectable()
export class DashboardGetHealthSummaryTool implements ErpReadToolPort {
  toolName = 'dashboard.get_business_health_summary';
  constructor(private readonly snapshot: GenerateSnapshotUseCase) {}

  async execute(ctx: ErpToolContext): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('dashboard.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const dto = await this.snapshot.execute(toCtx(ctx), ctx.companyId, { periodKind: 'today' });
    const sourceRefs: SourceRef[] = [{ label: 'แดชบอร์ดสุขภาพธุรกิจ', module: 'dashboard-notifications', entityType: 'dashboard_snapshot', entityId: dto.id, asOf: dto.generatedAt, permissionChecked: true, webPath: `/companies/${ctx.companyId}/dashboard` }];
    return { toolName: this.toolName, status: 'ok', data: { widgets: dto.widgets, freshnessStatus: dto.freshnessStatus, generatedAt: dto.generatedAt }, sourceRefs, asOf, stale: dto.freshnessStatus !== 'fresh' };
  }
}

// ---- notifications.list_open_alerts ----

@Injectable()
export class NotificationsListOpenAlertsTool implements ErpReadToolPort {
  toolName = 'notifications.list_open_alerts';
  constructor(private readonly listNotifications: ListNotificationsUseCase) {}

  async execute(ctx: ErpToolContext): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('notification.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const { items } = await this.listNotifications.execute(toCtx(ctx), ctx.companyId, { status: 'open', pageSize: 10 });
    const sourceRefs: SourceRef[] = items.map((ev: any) => ({
      label: ev.title ?? ev.triggerKey,
      module: 'dashboard-notifications',
      entityType: 'notification_event',
      entityId: ev.id,
      asOf,
      permissionChecked: true,
      webPath: `/companies/${ctx.companyId}/notifications`,
    }));
    if (sourceRefs.length === 0) sourceRefs.push({
      label: 'รายการแจ้งเตือน', module: 'dashboard-notifications', entityType: 'notification_list',
      asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}/notifications`,
    });
    return { toolName: this.toolName, status: 'ok', data: { count: items.length, items: items.slice(0, 5).map((ev: any) => ({ id: ev.id, title: ev.title, severity: ev.severity, createdAt: ev.createdAt })) }, sourceRefs, asOf };
  }
}

// ---- notifications.get_daily_summary ----

@Injectable()
export class NotificationsGetDailySummaryTool implements ErpReadToolPort {
  toolName = 'notifications.get_daily_summary';
  constructor(private readonly unread: GetUnreadCountUseCase) {}

  async execute(ctx: ErpToolContext): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('notification.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const count = await this.unread.execute(toCtx(ctx), ctx.companyId);
    const sourceRefs: SourceRef[] = [{ label: 'สรุปการแจ้งเตือน', module: 'dashboard-notifications', entityType: 'notification_summary', permissionChecked: true, asOf, webPath: `/companies/${ctx.companyId}/notifications` }];
    return { toolName: this.toolName, status: 'ok', data: count, sourceRefs, asOf };
  }
}
