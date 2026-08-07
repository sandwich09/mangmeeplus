import { Injectable, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { RequestContext, ListWorkflowTasksFilter, WorkflowTaskSummary } from '@watchdog-bms/contracts';
import { PrismaWorkflowRepository } from '../../infrastructure/prisma-workflow.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { toTaskSummary } from '../dto/workflow.mapper';

const BROAD_READ_ROLES = ['OWNER', 'ADMIN', 'AUDITOR_READONLY'];

@Injectable()
export class ListWorkflowTasksUseCase {
  constructor(private readonly repo: PrismaWorkflowRepository) {}

  async execute(ctx: RequestContext, filter: ListWorkflowTasksFilter): Promise<{ items: WorkflowTaskSummary[]; total: number; page: number; pageSize: number }> {
    if (!ctx.permissions.includes('workflow.task.read')) throw new ForbiddenException('Missing permission: workflow.task.read');

    const canReadAll = BROAD_READ_ROLES.some((r) => ctx.roles.includes(r));
    const assigneeUserId = canReadAll && filter.scope !== 'own' ? undefined : ctx.userId;

    const rows = await this.repo.listTasks({
      companyId: ctx.companyId,
      assigneeUserId,
      // "My tasks" also includes tasks assigned to a role the caller holds but not yet
      // claimed by a specific user (e.g. CREATE_WORKFLOW_TASK assigneeRole: 'MANAGER').
      assigneeRoles: assigneeUserId ? ctx.roles : undefined,
      status: filter.status,
      priority: filter.priority,
      sourceModule: filter.sourceModule,
    });
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const pageSize = filter.pageSize && filter.pageSize > 0 ? Math.min(filter.pageSize, 100) : 20;
    const start = (page - 1) * pageSize;
    return { items: rows.slice(start, start + pageSize).map(toTaskSummary), total: rows.length, page, pageSize };
  }
}

function assertCanWork(ctx: RequestContext, task: { assigneeUserId?: string; assigneeRole?: string }): void {
  if (!ctx.permissions.includes('workflow.task.work')) throw new ForbiddenException('Missing permission: workflow.task.work');
  const canReadAll = BROAD_READ_ROLES.some((r) => ctx.roles.includes(r));
  const isOwnUser = task.assigneeUserId === ctx.userId;
  const isOwnRole = !task.assigneeUserId && !!task.assigneeRole && ctx.roles.includes(task.assigneeRole);
  if (!canReadAll && !isOwnUser && !isOwnRole) throw new ForbiddenException('Cannot work a task assigned to someone else');
}

@Injectable()
export class SnoozeWorkflowTaskUseCase {
  constructor(private readonly repo: PrismaWorkflowRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, taskId: string, snoozedUntil: string): Promise<WorkflowTaskSummary> {
    const task = await this.repo.findTaskById(ctx.companyId, taskId);
    if (!task) throw new NotFoundException('Workflow task not found');
    assertCanWork(ctx, task);
    if (task.status !== 'OPEN' && task.status !== 'SNOOZED') throw new UnprocessableEntityException(`Cannot snooze a task with status ${task.status}`);

    const updated = await this.repo.updateTask(ctx.companyId, taskId, { status: 'SNOOZED', snoozedUntil: new Date(snoozedUntil) });
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'workflow.task.snooze',
      targetType: 'workflow_task', targetId: taskId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
    });
    return toTaskSummary(updated);
  }
}

@Injectable()
export class CompleteWorkflowTaskUseCase {
  constructor(private readonly repo: PrismaWorkflowRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, taskId: string): Promise<WorkflowTaskSummary> {
    const task = await this.repo.findTaskById(ctx.companyId, taskId);
    if (!task) throw new NotFoundException('Workflow task not found');
    assertCanWork(ctx, task);
    if (task.status === 'DONE' || task.status === 'CANCELED') throw new UnprocessableEntityException(`Cannot complete a task with status ${task.status}`);

    // Completion only closes the workflow task, not the source business record.
    const updated = await this.repo.updateTask(ctx.companyId, taskId, { status: 'DONE', completedByUserId: ctx.userId, completedAt: new Date() });
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'workflow.task.complete',
      targetType: 'workflow_task', targetId: taskId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
    });
    return toTaskSummary(updated);
  }
}

@Injectable()
export class CancelWorkflowTaskUseCase {
  constructor(private readonly repo: PrismaWorkflowRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, taskId: string, reason?: string): Promise<WorkflowTaskSummary> {
    const task = await this.repo.findTaskById(ctx.companyId, taskId);
    if (!task) throw new NotFoundException('Workflow task not found');
    // Ownership check is skipped for holders of workflow.rule.manage (admin cancelling on
    // behalf of the rule), per spec: cancel requires workflow.task.work or workflow.rule.manage.
    if (!ctx.permissions.includes('workflow.rule.manage')) assertCanWork(ctx, task);
    if (task.status === 'DONE' || task.status === 'CANCELED') throw new UnprocessableEntityException(`Cannot cancel a task with status ${task.status}`);

    const updated = await this.repo.updateTask(ctx.companyId, taskId, { status: 'CANCELED', cancelReason: reason });
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'workflow.task.cancel',
      targetType: 'workflow_task', targetId: taskId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
      metadataJson: { reason },
    });
    return toTaskSummary(updated);
  }
}
