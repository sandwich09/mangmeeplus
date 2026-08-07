import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ToolResult, SourceRef } from '@watchdog-bms/contracts';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';
import { GetWorkflowExplanationUseCase } from '../../../workflow/application/use-cases/workflow-run.use-case';
import { ListWorkflowTasksUseCase } from '../../../workflow/application/use-cases/workflow-task.use-case';
import { ListWorkflowRunsUseCase } from '../../../workflow/application/use-cases/workflow-run.use-case';
import { ListWorkflowRulesUseCase } from '../../../workflow/application/use-cases/workflow-rule.use-case';
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

// All four tools re-check ctx.permissions server-side (never trust the caller) and
// answer strictly within the same permission/ABAC scope as the web UI. None can
// enable/disable/replay anything — LINE/AI stays read-only per spec section 17.

@Injectable()
export class WorkflowExplainRunTool implements ErpReadToolPort<{ runId: string }> {
  toolName = 'workflow.explain_run';
  constructor(private readonly explain: GetWorkflowExplanationUseCase) {}

  async execute(ctx: ErpToolContext, input: { runId: string }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('workflow.run.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    if (!input?.runId) {
      return {
        toolName: this.toolName, status: 'ok', data: { needsRunId: true }, asOf,
        sourceRefs: [{ label: 'ข้อมูล workflow run', module: 'workflow', entityType: 'workflow_run_query', asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}/workflow` }],
      };
    }
    try {
      const explanation = await this.explain.execute(toCtx(ctx), input.runId);
      const sourceRefs: SourceRef[] = explanation.sourceRefs.map((r) => ({
        label: `${r.module}.${r.type}`,
        module: r.module,
        entityType: r.type,
        entityId: r.id,
        asOf,
        permissionChecked: true,
        webPath: `/companies/${ctx.companyId}/${r.module}`,
      }));
      sourceRefs.push({
        label: explanation.ruleName,
        module: 'workflow',
        entityType: 'workflow_run',
        entityId: explanation.runId,
        asOf,
        permissionChecked: true,
        webPath: `/companies/${ctx.companyId}/workflow`,
      });
      return { toolName: this.toolName, status: 'ok', data: explanation, sourceRefs, asOf };
    } catch (error) {
      if (error instanceof ForbiddenException) return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
      if (error instanceof NotFoundException) return {
        toolName: this.toolName, status: 'ok', data: { found: false }, asOf, errorCode: 'WORKFLOW_RUN_NOT_FOUND',
        sourceRefs: [{ label: 'ข้อมูล workflow run', module: 'workflow', entityType: 'workflow_run_query', asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}/workflow` }],
      };
      return { toolName: this.toolName, status: 'unavailable', sourceRefs: [], asOf };
    }
  }
}

@Injectable()
export class WorkflowListAssignedTasksTool implements ErpReadToolPort {
  toolName = 'workflow.list_assigned_tasks';
  constructor(private readonly listTasks: ListWorkflowTasksUseCase) {}

  async execute(ctx: ErpToolContext): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('workflow.task.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const { items, total } = await this.listTasks.execute(toCtx(ctx), { scope: 'own', status: 'OPEN' });
    const sourceRefs: SourceRef[] = items.map((t) => ({
      label: t.title,
      module: 'workflow',
      entityType: 'workflow_task',
      entityId: t.id,
      asOf,
      permissionChecked: true,
      webPath: `/companies/${ctx.companyId}/workflow`,
    }));
    if (sourceRefs.length === 0) sourceRefs.push({
      label: 'งานที่ได้รับมอบหมาย', module: 'workflow', entityType: 'workflow_task_list', asOf,
      permissionChecked: true, webPath: `/companies/${ctx.companyId}/workflow`,
    });
    return { toolName: this.toolName, status: 'ok', data: { total, items: items.slice(0, 10) }, sourceRefs, asOf };
  }
}

@Injectable()
export class WorkflowListRecentFailuresTool implements ErpReadToolPort {
  toolName = 'workflow.list_recent_failures';
  constructor(private readonly listRuns: ListWorkflowRunsUseCase) {}

  async execute(ctx: ErpToolContext): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('workflow.run.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const failed = await this.listRuns.execute(toCtx(ctx), { status: 'FAILED', pageSize: 10 });
    const partial = await this.listRuns.execute(toCtx(ctx), { status: 'PARTIAL_FAILED', pageSize: 10 });
    const items = [...failed.items, ...partial.items];
    const sourceRefs: SourceRef[] = items.map((r) => ({
      label: r.ruleName,
      module: 'workflow',
      entityType: 'workflow_run',
      entityId: r.id,
      asOf,
      permissionChecked: true,
      webPath: `/companies/${ctx.companyId}/workflow`,
    }));
    if (sourceRefs.length === 0) sourceRefs.push({
      label: 'รายการ workflow ที่ล้มเหลว', module: 'workflow', entityType: 'workflow_failure_list', asOf,
      permissionChecked: true, webPath: `/companies/${ctx.companyId}/workflow`,
    });
    return { toolName: this.toolName, status: 'ok', data: { count: items.length, items }, sourceRefs, asOf };
  }
}

@Injectable()
export class WorkflowSummarizeRuleHealthTool implements ErpReadToolPort {
  toolName = 'workflow.summarize_rule_health';
  constructor(private readonly listRules: ListWorkflowRulesUseCase) {}

  async execute(ctx: ErpToolContext): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('workflow.rule.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const { items, total } = await this.listRules.execute(toCtx(ctx), { pageSize: 100 });
    const enabled = items.filter((r) => r.status === 'ENABLED').length;
    const withRecentFailure = items.filter((r) => r.lastRunStatus === 'FAILED' || r.lastRunStatus === 'PARTIAL_FAILED').length;
    const sourceRefs: SourceRef[] = items.slice(0, 10).map((r) => ({
      label: r.name,
      module: 'workflow',
      entityType: 'workflow_rule',
      entityId: r.id,
      asOf,
      permissionChecked: true,
      webPath: `/companies/${ctx.companyId}/workflow`,
    }));
    if (sourceRefs.length === 0) sourceRefs.push({
      label: 'สุขภาพกฎ workflow', module: 'workflow', entityType: 'workflow_rule_summary', asOf,
      permissionChecked: true, webPath: `/companies/${ctx.companyId}/workflow`,
    });
    return { toolName: this.toolName, status: 'ok', data: { total, enabled, withRecentFailure }, sourceRefs, asOf };
  }
}
