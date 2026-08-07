import { Injectable, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { RequestContext, ListWorkflowRunsFilter, WorkflowRunSummary, WorkflowRunDetail, WorkflowExplanation } from '@watchdog-bms/contracts';
import { PrismaWorkflowRepository } from '../../infrastructure/prisma-workflow.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { hasSourceModuleAccess } from '../../domain/logic/workflow-permission.logic';
import { validateActionDefinitions } from '../../domain/logic/workflow-action.logic';
import { toRunSummary, toRunDetail } from '../dto/workflow.mapper';
import { summarizeTrigger, summarizeCondition, summarizeAction, nextActionHint } from '../../domain/logic/workflow-explanation.logic';
import { ExecuteWorkflowActionUseCase, buildActionRunContext } from './workflow-action-runner.use-case';

function assertSourceModuleAccess(ctx: RequestContext, sourceModule?: string): void {
  if (!hasSourceModuleAccess(ctx.permissions, sourceModule)) {
    throw new ForbiddenException(`Missing source-module permission to read this run's module: ${sourceModule}`);
  }
}

@Injectable()
export class ListWorkflowRunsUseCase {
  constructor(private readonly repo: PrismaWorkflowRepository) {}

  async execute(ctx: RequestContext, filter: ListWorkflowRunsFilter): Promise<{ items: WorkflowRunSummary[]; total: number; page: number; pageSize: number }> {
    if (!ctx.permissions.includes('workflow.run.read')) throw new ForbiddenException('Missing permission: workflow.run.read');

    const rows = (await this.repo.listRuns({
      companyId: ctx.companyId,
      ruleId: filter.ruleId,
      status: filter.status,
      sourceModule: filter.sourceModule,
      from: filter.from ? new Date(filter.from) : undefined,
      to: filter.to ? new Date(filter.to) : undefined,
    })).filter((r) => hasSourceModuleAccess(ctx.permissions, r.sourceModule));

    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const pageSize = filter.pageSize && filter.pageSize > 0 ? Math.min(filter.pageSize, 100) : 20;
    const start = (page - 1) * pageSize;
    return { items: rows.slice(start, start + pageSize).map(toRunSummary), total: rows.length, page, pageSize };
  }
}

@Injectable()
export class GetWorkflowRunDetailUseCase {
  constructor(private readonly repo: PrismaWorkflowRepository) {}

  async execute(ctx: RequestContext, id: string): Promise<WorkflowRunDetail> {
    if (!ctx.permissions.includes('workflow.run.read')) throw new ForbiddenException('Missing permission: workflow.run.read');
    const run = await this.repo.findRunById(ctx.companyId, id);
    if (!run) throw new NotFoundException('Workflow run not found');
    assertSourceModuleAccess(ctx, run.sourceModule);
    return toRunDetail(run);
  }
}

@Injectable()
export class GetWorkflowExplanationUseCase {
  constructor(private readonly repo: PrismaWorkflowRepository) {}

  async execute(ctx: RequestContext, runId: string): Promise<WorkflowExplanation> {
    if (!ctx.permissions.includes('workflow.run.read')) throw new ForbiddenException('Missing permission: workflow.run.read');
    const run = await this.repo.findRunById(ctx.companyId, runId);
    if (!run) throw new NotFoundException('Workflow run not found');
    assertSourceModuleAccess(ctx, run.sourceModule);

    const actionRuns = run.actionRuns ?? [];
    const actionDefs = run.ruleVersion?.actionSnapshotJson ?? [];
    return {
      runId: run.id,
      ruleName: run.rule?.name ?? '',
      triggerType: run.triggerType,
      triggerSummary: summarizeTrigger(run.triggerType, run.sourceModule, run.sourceType),
      conditionSummary: summarizeCondition(run.conditionResultJson),
      actionSummaries: actionRuns.map((a) => {
        const def = actionDefs.find((d) => d.actionKey === a.actionKey) ?? { actionKey: a.actionKey, actionType: a.actionType as any, configJson: {} };
        return summarizeAction(def, a.status);
      }),
      sourceRefs: run.sourceModule && run.sourceType && run.sourceId
        ? [{ module: run.sourceModule, type: run.sourceType, id: run.sourceId }]
        : [],
      nextAction: nextActionHint(run.status),
    };
  }
}

@Injectable()
export class ReplayWorkflowActionRunUseCase {
  constructor(
    private readonly repo: PrismaWorkflowRepository,
    private readonly audit: AuditService,
    private readonly executeAction: ExecuteWorkflowActionUseCase,
  ) {}

  async execute(ctx: RequestContext, actionRunId: string): Promise<{ queued: boolean; status: string }> {
    if (!ctx.permissions.includes('workflow.run.replay')) throw new ForbiddenException('Missing permission: workflow.run.replay');

    const actionRun = await this.repo.findActionRunById(ctx.companyId, actionRunId);
    if (!actionRun) throw new NotFoundException('Workflow action run not found');
    if (!['FAILED_RETRYABLE', 'FAILED_FINAL', 'DEAD_LETTERED'].includes(actionRun.status)) {
      throw new UnprocessableEntityException(`Cannot replay an action run with status ${actionRun.status}`);
    }

    const run = await this.repo.findRunById(ctx.companyId, actionRun.workflowRunId);
    if (!run) throw new NotFoundException('Workflow run not found');
    if (!hasSourceModuleAccess(ctx.permissions, run.sourceModule)) {
      throw new ForbiddenException(`Missing source-module permission to replay this action's module: ${run.sourceModule}`);
    }

    const safetyErrors = validateActionDefinitions([{
      actionKey: actionRun.actionKey,
      actionType: actionRun.actionType as any,
      configJson: actionRun.actionConfigSnapshotJson,
    }]);
    if (safetyErrors.length > 0) throw new UnprocessableEntityException(`Action is no longer safe to replay: ${safetyErrors.join('; ')}`);

    await this.repo.updateActionRun(actionRun.id, { status: 'QUEUED', nextAttemptAt: new Date(), lastErrorCode: null, lastErrorMessage: null });
    await this.executeAction.execute(actionRun, buildActionRunContext(run));
    const finalState = await this.repo.findActionRunById(ctx.companyId, actionRun.id);

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'workflow.action_run.replay',
      targetType: 'workflow_action_run', targetId: actionRun.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { workflowRunId: actionRun.workflowRunId, actionType: actionRun.actionType, resultStatus: finalState?.status },
    });
    return { queued: true, status: finalState?.status ?? 'QUEUED' };
  }
}
