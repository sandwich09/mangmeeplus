import { Injectable, ForbiddenException, NotFoundException, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import type { RequestContext, ListWorkflowDeadLettersFilter, WorkflowDeadLetterSummary } from '@watchdog-bms/contracts';
import { PrismaWorkflowRepository } from '../../infrastructure/prisma-workflow.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { validateActionDefinitions } from '../../domain/logic/workflow-action.logic';
import { hasSourceModuleAccess } from '../../domain/logic/workflow-permission.logic';
import { toDeadLetterSummary } from '../dto/workflow.mapper';
import { ExecuteWorkflowActionUseCase, buildActionRunContext } from './workflow-action-runner.use-case';

@Injectable()
export class ListWorkflowDeadLettersUseCase {
  constructor(private readonly repo: PrismaWorkflowRepository) {}

  async execute(ctx: RequestContext, filter: ListWorkflowDeadLettersFilter): Promise<{ items: WorkflowDeadLetterSummary[]; total: number; page: number; pageSize: number }> {
    if (!ctx.permissions.includes('workflow.dead_letter.read')) throw new ForbiddenException('Missing permission: workflow.dead_letter.read');
    const rows = await this.repo.listDeadLetters({ companyId: ctx.companyId, resolutionStatus: filter.resolutionStatus, ruleId: filter.ruleId });
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const pageSize = filter.pageSize && filter.pageSize > 0 ? Math.min(filter.pageSize, 100) : 20;
    const start = (page - 1) * pageSize;
    return { items: rows.slice(start, start + pageSize).map(toDeadLetterSummary), total: rows.length, page, pageSize };
  }
}

@Injectable()
export class ReplayWorkflowDeadLetterUseCase {
  constructor(
    private readonly repo: PrismaWorkflowRepository,
    private readonly audit: AuditService,
    private readonly executeAction: ExecuteWorkflowActionUseCase,
  ) {}

  async execute(ctx: RequestContext, deadLetterId: string): Promise<WorkflowDeadLetterSummary> {
    if (!ctx.permissions.includes('workflow.dead_letter.replay')) throw new ForbiddenException('Missing permission: workflow.dead_letter.replay');
    const dl = await this.repo.findDeadLetterById(ctx.companyId, deadLetterId);
    if (!dl) throw new NotFoundException('Workflow dead letter not found');
    if (dl.resolutionStatus !== 'OPEN') throw new UnprocessableEntityException(`Cannot replay a dead letter with resolution ${dl.resolutionStatus}`);

    const actionRun = await this.repo.findActionRunById(ctx.companyId, dl.workflowActionRunId);
    if (!actionRun) throw new NotFoundException('Linked workflow action run not found');
    const run = await this.repo.findRunById(ctx.companyId, actionRun.workflowRunId);
    if (!run) throw new NotFoundException('Workflow run not found');
    if (!hasSourceModuleAccess(ctx.permissions, run.sourceModule)) {
      throw new ForbiddenException(`Missing source-module permission to replay this dead letter's module: ${run.sourceModule}`);
    }
    const safetyErrors = validateActionDefinitions([{ actionKey: actionRun.actionKey, actionType: actionRun.actionType as any, configJson: actionRun.actionConfigSnapshotJson }]);
    if (safetyErrors.length > 0) throw new UnprocessableEntityException(`Action is no longer safe to replay: ${safetyErrors.join('; ')}`);

    await this.repo.updateActionRun(actionRun.id, { status: 'QUEUED', nextAttemptAt: new Date(), lastErrorCode: null, lastErrorMessage: null });
    await this.executeAction.execute(actionRun, buildActionRunContext(run));
    const updated = await this.repo.updateDeadLetter(ctx.companyId, deadLetterId, {
      resolutionStatus: 'REPLAYED', resolvedByUserId: ctx.userId, resolvedAt: new Date(),
    });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'workflow.dead_letter.replay',
      targetType: 'workflow_dead_letter', targetId: deadLetterId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
    });
    return toDeadLetterSummary(updated);
  }
}

@Injectable()
export class IgnoreWorkflowDeadLetterUseCase {
  constructor(private readonly repo: PrismaWorkflowRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, deadLetterId: string, resolutionNote: string): Promise<WorkflowDeadLetterSummary> {
    if (!ctx.permissions.includes('workflow.dead_letter.replay')) throw new ForbiddenException('Missing permission: workflow.dead_letter.replay');
    if (!resolutionNote || resolutionNote.trim() === '') throw new BadRequestException('resolutionNote is required to ignore a dead letter');
    const dl = await this.repo.findDeadLetterById(ctx.companyId, deadLetterId);
    if (!dl) throw new NotFoundException('Workflow dead letter not found');
    if (dl.resolutionStatus !== 'OPEN') throw new UnprocessableEntityException(`Cannot ignore a dead letter with resolution ${dl.resolutionStatus}`);

    const updated = await this.repo.updateDeadLetter(ctx.companyId, deadLetterId, {
      resolutionStatus: 'IGNORED', resolvedByUserId: ctx.userId, resolvedAt: new Date(), resolutionNote,
    });
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'workflow.dead_letter.ignore',
      targetType: 'workflow_dead_letter', targetId: deadLetterId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { resolutionNote },
    });
    return toDeadLetterSummary(updated);
  }
}
