import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type {
  WorkflowTemplateRecord,
  WorkflowRuleRecord,
  WorkflowRuleVersionRecord,
  WorkflowEventInboxRecord,
  WorkflowRunRecord,
  WorkflowActionRunRecord,
  WorkflowTaskRecord,
  WorkflowDeadLetterRecord,
  WorkflowWebhookEndpointRecord,
} from '../domain/models/workflow.model';

function opt<T>(v: T | null | undefined): T | undefined {
  return v == null ? undefined : v;
}

export type ListWorkflowRulesWhere = {
  companyId: string;
  status?: string;
  triggerType?: string;
  sourceModule?: string;
  templateId?: string;
  search?: string;
};

export type ListWorkflowRunsWhere = {
  companyId: string;
  ruleId?: string;
  status?: string;
  sourceModule?: string;
  from?: Date;
  to?: Date;
};

export type ListWorkflowTasksWhere = {
  companyId: string;
  assigneeUserId?: string;
  /** OR'd with assigneeUserId: matches tasks assigned to one of these roles (no specific user). */
  assigneeRoles?: string[];
  status?: string;
  priority?: string;
  sourceModule?: string;
};

export type ListWorkflowDeadLettersWhere = {
  companyId: string;
  resolutionStatus?: string;
  ruleId?: string;
};

@Injectable()
export class PrismaWorkflowRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Templates ----

  async listTemplates(): Promise<WorkflowTemplateRecord[]> {
    const rows = await this.prisma.client.workflowTemplate.findMany({ orderBy: { key: 'asc' } });
    return rows.map((r) => this.toTemplate(r));
  }

  async findTemplateById(id: string): Promise<WorkflowTemplateRecord | null> {
    const row = await this.prisma.client.workflowTemplate.findUnique({ where: { id } });
    return row ? this.toTemplate(row) : null;
  }

  async findTemplateByKey(key: string): Promise<WorkflowTemplateRecord | null> {
    const row = await this.prisma.client.workflowTemplate.findUnique({ where: { key } });
    return row ? this.toTemplate(row) : null;
  }

  // ---- Rules ----

  async createRule(data: {
    companyId: string;
    templateId?: string;
    name: string;
    description?: string;
    triggerType: string;
    triggerConfigJson: Record<string, unknown>;
    conditionJson: unknown;
    actionJson: unknown;
    recipientConfigJson: Record<string, unknown>;
    cooldownSeconds: number;
    timezone: string;
    createdByUserId: string;
  }): Promise<WorkflowRuleRecord> {
    const row = await this.prisma.client.workflowRule.create({
      data: {
        companyId: data.companyId,
        templateId: data.templateId,
        name: data.name,
        description: data.description,
        triggerType: data.triggerType as any,
        triggerConfigJson: data.triggerConfigJson as any,
        conditionJson: data.conditionJson as any,
        actionJson: data.actionJson as any,
        recipientConfigJson: data.recipientConfigJson as any,
        cooldownSeconds: data.cooldownSeconds,
        timezone: data.timezone,
        createdByUserId: data.createdByUserId,
      },
    });
    return this.toRule(row);
  }

  async findRuleById(companyId: string, id: string): Promise<WorkflowRuleRecord | null> {
    const row = await this.prisma.client.workflowRule.findFirst({
      where: { id, companyId },
      include: { template: { select: { key: true, sourceModule: true } }, runs: { where: { status: { in: ['SUCCEEDED', 'PARTIAL_FAILED', 'FAILED'] } }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return row ? this.toRule(row) : null;
  }

  async listRules(where: ListWorkflowRulesWhere): Promise<WorkflowRuleRecord[]> {
    const rows = await this.prisma.client.workflowRule.findMany({
      where: {
        companyId: where.companyId,
        status: where.status as any,
        triggerType: where.triggerType as any,
        templateId: where.templateId,
        template: where.sourceModule ? { sourceModule: where.sourceModule } : undefined,
        name: where.search ? { contains: where.search, mode: 'insensitive' } : undefined,
      },
      include: { template: { select: { key: true, sourceModule: true } }, runs: { where: { status: { in: ['SUCCEEDED', 'PARTIAL_FAILED', 'FAILED'] } }, orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((r) => this.toRule(r));
  }

  async listEnabledRulesByTrigger(companyId: string, triggerType: string): Promise<WorkflowRuleRecord[]> {
    const rows = await this.prisma.client.workflowRule.findMany({
      where: { companyId, status: 'ENABLED', triggerType: triggerType as any },
      include: { template: { select: { key: true, sourceModule: true } }, runs: { where: { status: { in: ['SUCCEEDED', 'PARTIAL_FAILED', 'FAILED'] } }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return rows.map((r) => this.toRule(r));
  }

  async listAllEnabledRulesByTrigger(triggerType: string): Promise<WorkflowRuleRecord[]> {
    const rows = await this.prisma.client.workflowRule.findMany({
      where: { status: 'ENABLED', triggerType: triggerType as any },
      include: { template: { select: { key: true, sourceModule: true } }, runs: { where: { status: { in: ['SUCCEEDED', 'PARTIAL_FAILED', 'FAILED'] } }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return rows.map((r) => this.toRule(r));
  }

  async findUserIdsByRoles(companyId: string, roleKeys: string[]): Promise<string[]> {
    if (roleKeys.length === 0) return [];
    const rows = await this.prisma.client.companyMembership.findMany({
      where: { companyId, status: 'ACTIVE', roles: { some: { role: { key: { in: roleKeys } } } } },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  async findUserIdsByPermissions(companyId: string, permissionKeys: string[]): Promise<string[]> {
    if (permissionKeys.length === 0) return [];
    const rows = await this.prisma.client.companyMembership.findMany({
      where: { companyId, status: 'ACTIVE', roles: { some: { role: { permissions: { some: { permission: { key: { in: permissionKeys } } } } } } } },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  /**
   * Branch of the record a run is about, so recipients picked by permission can be held to the
   * branch rule that record's own API enforces (audit B12). Claims and vendor bills are the two
   * sources whose notices pick recipients that way; any other source stays company-wide.
   */
  async findSourceBranchId(companyId: string, sourceType?: string, sourceId?: string): Promise<string | null> {
    if (!sourceId) return null;
    const query = { where: { id: sourceId, companyId }, select: { branchId: true } };
    const row = sourceType === 'reimbursement_request' ? await this.prisma.client.reimbursementRequest.findFirst(query)
      : sourceType === 'vendor_bill' ? await this.prisma.client.vendorBill.findFirst(query)
        : null;
    return row?.branchId ?? null;
  }

  async updateRule(companyId: string, id: string, data: Record<string, unknown>): Promise<WorkflowRuleRecord> {
    const row = await this.prisma.client.workflowRule.update({ where: { id }, data: data as any });
    return this.toRule(row);
  }

  // ---- Rule versions ----

  async createRuleVersion(data: {
    ruleId: string;
    companyId: string;
    version: number;
    status: string;
    triggerSnapshotJson: Record<string, unknown>;
    conditionSnapshotJson: unknown;
    actionSnapshotJson: unknown;
    recipientSnapshotJson: Record<string, unknown>;
    cooldownSeconds: number;
    createdByUserId: string;
  }): Promise<WorkflowRuleVersionRecord> {
    const row = await this.prisma.client.workflowRuleVersion.create({
      data: {
        ruleId: data.ruleId,
        companyId: data.companyId,
        version: data.version,
        status: data.status as any,
        triggerSnapshotJson: data.triggerSnapshotJson as any,
        conditionSnapshotJson: data.conditionSnapshotJson as any,
        actionSnapshotJson: data.actionSnapshotJson as any,
        recipientSnapshotJson: data.recipientSnapshotJson as any,
        cooldownSeconds: data.cooldownSeconds,
        createdByUserId: data.createdByUserId,
      },
    });
    return this.toRuleVersion(row);
  }

  async findRuleVersionById(id: string): Promise<WorkflowRuleVersionRecord | null> {
    const row = await this.prisma.client.workflowRuleVersion.findUnique({ where: { id } });
    return row ? this.toRuleVersion(row) : null;
  }

  async findLatestRuleVersion(ruleId: string): Promise<WorkflowRuleVersionRecord | null> {
    const row = await this.prisma.client.workflowRuleVersion.findFirst({ where: { ruleId }, orderBy: { version: 'desc' } });
    return row ? this.toRuleVersion(row) : null;
  }

  // ---- Event inbox ----

  async findEventInboxByEventId(companyId: string, eventId: string): Promise<WorkflowEventInboxRecord | null> {
    const row = await this.prisma.client.workflowEventInbox.findUnique({ where: { companyId_eventId: { companyId, eventId } } });
    return row ? this.toEventInbox(row) : null;
  }

  async createEventInbox(data: {
    companyId: string;
    eventId: string;
    eventType: string;
    sourceModule: string;
    sourceType: string;
    sourceId: string;
    sourceVersion?: string;
    payloadJson: Record<string, unknown>;
    dedupKey: string;
  }): Promise<WorkflowEventInboxRecord> {
    const row = await this.prisma.client.workflowEventInbox.create({ data: { ...data, payloadJson: data.payloadJson as any, status: 'RECEIVED' } });
    return this.toEventInbox(row);
  }

  async updateEventInbox(id: string, data: Record<string, unknown>): Promise<void> {
    await this.prisma.client.workflowEventInbox.update({ where: { id }, data: data as any });
  }

  // ---- Runs ----

  async findRunByDedupKey(companyId: string, ruleVersionId: string, dedupKey: string): Promise<WorkflowRunRecord | null> {
    const row = await this.prisma.client.workflowRun.findUnique({
      where: { companyId_ruleVersionId_dedupKey: { companyId, ruleVersionId, dedupKey } },
    });
    return row ? this.toRun(row) : null;
  }

  async createRun(data: {
    companyId: string;
    ruleId: string;
    ruleVersionId: string;
    triggerType: string;
    triggerEventId?: string;
    sourceModule?: string;
    sourceType?: string;
    sourceId?: string;
    dedupKey: string;
    triggerPayloadJson: Record<string, unknown>;
    conditionResultJson: Record<string, unknown>;
    status: string;
  }): Promise<WorkflowRunRecord> {
    const row = await this.prisma.client.workflowRun.create({
      data: {
        companyId: data.companyId,
        ruleId: data.ruleId,
        ruleVersionId: data.ruleVersionId,
        triggerType: data.triggerType as any,
        triggerEventId: data.triggerEventId,
        sourceModule: data.sourceModule,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        dedupKey: data.dedupKey,
        triggerPayloadJson: data.triggerPayloadJson as any,
        conditionResultJson: data.conditionResultJson as any,
        status: data.status as any,
        startedAt: new Date(),
      },
    });
    return this.toRun(row);
  }

  async updateRun(id: string, data: Record<string, unknown>): Promise<WorkflowRunRecord> {
    const row = await this.prisma.client.workflowRun.update({ where: { id }, data: data as any });
    return this.toRun(row);
  }

  async findRunById(companyId: string, id: string): Promise<WorkflowRunRecord | null> {
    const row = await this.prisma.client.workflowRun.findFirst({
      where: { id, companyId },
      include: { rule: { select: { name: true } }, ruleVersion: true, actionRuns: { orderBy: { createdAt: 'asc' } } },
    });
    return row ? this.toRun(row) : null;
  }

  async listRuns(where: ListWorkflowRunsWhere): Promise<WorkflowRunRecord[]> {
    const rows = await this.prisma.client.workflowRun.findMany({
      where: {
        companyId: where.companyId,
        ruleId: where.ruleId,
        status: where.status as any,
        sourceModule: where.sourceModule,
        createdAt: where.from || where.to ? { gte: where.from, lte: where.to } : undefined,
      },
      include: { rule: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.toRun(r));
  }

  // ---- Action runs ----

  async createActionRun(data: {
    companyId: string;
    workflowRunId: string;
    actionKey: string;
    actionType: string;
    actionConfigSnapshotJson: Record<string, unknown>;
    idempotencyKey: string;
    status: string;
  }): Promise<WorkflowActionRunRecord> {
    const row = await this.prisma.client.workflowActionRun.create({
      data: {
        companyId: data.companyId,
        workflowRunId: data.workflowRunId,
        actionKey: data.actionKey,
        actionType: data.actionType,
        actionConfigSnapshotJson: data.actionConfigSnapshotJson as any,
        idempotencyKey: data.idempotencyKey,
        status: data.status as any,
      },
    });
    return this.toActionRun(row);
  }

  async findActionRunByIdempotencyKey(companyId: string, actionType: string, idempotencyKey: string): Promise<WorkflowActionRunRecord | null> {
    const row = await this.prisma.client.workflowActionRun.findUnique({
      where: { companyId_actionType_idempotencyKey: { companyId, actionType, idempotencyKey } },
    });
    return row ? this.toActionRun(row) : null;
  }

  async findActionRunById(companyId: string, id: string): Promise<WorkflowActionRunRecord | null> {
    const row = await this.prisma.client.workflowActionRun.findFirst({ where: { id, companyId } });
    return row ? this.toActionRun(row) : null;
  }

  async updateActionRun(id: string, data: Record<string, unknown>): Promise<WorkflowActionRunRecord> {
    const row = await this.prisma.client.workflowActionRun.update({ where: { id }, data: data as any });
    return this.toActionRun(row);
  }

  async listRetryableActionRuns(now: Date, limit = 50): Promise<WorkflowActionRunRecord[]> {
    const rows = await this.prisma.client.workflowActionRun.findMany({
      where: { status: 'FAILED_RETRYABLE', nextAttemptAt: { lte: now } },
      take: limit,
      orderBy: { nextAttemptAt: 'asc' },
    });
    return rows.map((r) => this.toActionRun(r));
  }

  // ---- Tasks ----

  async createTask(data: {
    companyId: string;
    workflowRunId?: string;
    workflowActionRunId?: string;
    sourceModule?: string;
    sourceType?: string;
    sourceId?: string;
    title: string;
    description?: string;
    assigneeUserId?: string;
    assigneeRole?: string;
    priority: string;
    dueAt?: Date;
    webDeepLink?: string;
  }): Promise<WorkflowTaskRecord> {
    const row = await this.prisma.client.workflowTask.create({
      data: { ...data, priority: data.priority as any, status: 'OPEN' },
    });
    return this.toTask(row);
  }

  async findTaskById(companyId: string, id: string): Promise<WorkflowTaskRecord | null> {
    const row = await this.prisma.client.workflowTask.findFirst({ where: { id, companyId } });
    return row ? this.toTask(row) : null;
  }

  async findTaskByActionRunId(companyId: string, workflowActionRunId: string): Promise<WorkflowTaskRecord | null> {
    const row = await this.prisma.client.workflowTask.findFirst({ where: { companyId, workflowActionRunId } });
    return row ? this.toTask(row) : null;
  }

  async listTasks(where: ListWorkflowTasksWhere): Promise<WorkflowTaskRecord[]> {
    const assigneeFilter = where.assigneeUserId
      ? where.assigneeRoles && where.assigneeRoles.length > 0
        ? { OR: [{ assigneeUserId: where.assigneeUserId }, { assigneeRole: { in: where.assigneeRoles } }] }
        : { assigneeUserId: where.assigneeUserId }
      : {};
    const rows = await this.prisma.client.workflowTask.findMany({
      where: {
        companyId: where.companyId,
        status: where.status as any,
        priority: where.priority as any,
        sourceModule: where.sourceModule,
        ...assigneeFilter,
      },
      orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }],
      take: 200,
    });
    return rows.map((r) => this.toTask(r));
  }

  async updateTask(companyId: string, id: string, data: Record<string, unknown>): Promise<WorkflowTaskRecord> {
    const row = await this.prisma.client.workflowTask.update({ where: { id }, data: data as any });
    return this.toTask(row);
  }

  // ---- Dead letters ----

  async createDeadLetter(data: {
    companyId: string;
    workflowRunId: string;
    workflowActionRunId: string;
    errorCode?: string;
    errorMessage?: string;
    errorDetailsJson?: Record<string, unknown>;
  }): Promise<WorkflowDeadLetterRecord> {
    const row = await this.prisma.client.workflowDeadLetter.create({ data: { ...data, errorDetailsJson: data.errorDetailsJson as any, resolutionStatus: 'OPEN' } });
    return this.toDeadLetter(row);
  }

  async findDeadLetterById(companyId: string, id: string): Promise<WorkflowDeadLetterRecord | null> {
    const row = await this.prisma.client.workflowDeadLetter.findFirst({ where: { id, companyId } });
    return row ? this.toDeadLetter(row) : null;
  }

  async listDeadLetters(where: ListWorkflowDeadLettersWhere): Promise<WorkflowDeadLetterRecord[]> {
    const rows = await this.prisma.client.workflowDeadLetter.findMany({
      where: {
        companyId: where.companyId,
        resolutionStatus: where.resolutionStatus as any,
        workflowRun: where.ruleId ? { ruleId: where.ruleId } : undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.toDeadLetter(r));
  }

  async updateDeadLetter(companyId: string, id: string, data: Record<string, unknown>): Promise<WorkflowDeadLetterRecord> {
    const row = await this.prisma.client.workflowDeadLetter.update({ where: { id }, data: data as any });
    return this.toDeadLetter(row);
  }

  // ---- Webhook endpoints ----

  async listWebhookEndpoints(companyId: string): Promise<WorkflowWebhookEndpointRecord[]> {
    const rows = await this.prisma.client.workflowWebhookEndpoint.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => this.toWebhookEndpoint(r));
  }

  async findWebhookEndpointById(companyId: string, id: string): Promise<WorkflowWebhookEndpointRecord | null> {
    const row = await this.prisma.client.workflowWebhookEndpoint.findFirst({ where: { id, companyId } });
    return row ? this.toWebhookEndpoint(row) : null;
  }

  async createWebhookEndpoint(data: {
    companyId: string;
    name: string;
    url: string;
    allowedEventTypes: string[];
    secretRef: string;
    createdByUserId: string;
  }): Promise<WorkflowWebhookEndpointRecord> {
    const row = await this.prisma.client.workflowWebhookEndpoint.create({
      data: { ...data, allowedEventTypes: data.allowedEventTypes as any, status: 'DISABLED' },
    });
    return this.toWebhookEndpoint(row);
  }

  async updateWebhookEndpoint(companyId: string, id: string, data: Record<string, unknown>): Promise<WorkflowWebhookEndpointRecord> {
    const row = await this.prisma.client.workflowWebhookEndpoint.update({ where: { id }, data: data as any });
    return this.toWebhookEndpoint(row);
  }

  // ---- Mappers ----

  private toTemplate(row: any): WorkflowTemplateRecord {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      category: row.category,
      sourceModule: row.sourceModule,
      triggerType: row.triggerType,
      defaultConditionJson: row.defaultConditionJson,
      defaultActionJson: row.defaultActionJson,
      requiredPermissions: (row.requiredPermissions ?? []) as string[],
      requiredSourceModules: (row.requiredSourceModules ?? []) as string[],
      defaultEnabled: row.defaultEnabled,
      status: row.status,
      unavailableReason: opt(row.unavailableReason),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toRule(row: any): WorkflowRuleRecord {
    const lastRun = Array.isArray(row.runs) ? row.runs[0] : undefined;
    return {
      id: row.id,
      companyId: row.companyId,
      templateId: opt(row.templateId),
      name: row.name,
      description: opt(row.description),
      status: row.status,
      triggerType: row.triggerType,
      triggerConfigJson: row.triggerConfigJson,
      conditionJson: row.conditionJson,
      actionJson: row.actionJson,
      recipientConfigJson: row.recipientConfigJson,
      cooldownSeconds: row.cooldownSeconds,
      timezone: row.timezone,
      createdBy: row.createdByUserId,
      updatedBy: opt(row.updatedByUserId),
      enabledBy: opt(row.enabledByUserId),
      enabledAt: opt(row.enabledAt),
      disabledBy: opt(row.disabledByUserId),
      disabledAt: opt(row.disabledAt),
      currentVersion: row.currentVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      template: row.template ? { key: row.template.key, sourceModule: row.template.sourceModule } : undefined,
      lastRunAt: lastRun?.createdAt,
      lastRunStatus: lastRun?.status,
    };
  }

  private toRuleVersion(row: any): WorkflowRuleVersionRecord {
    return {
      id: row.id,
      ruleId: row.ruleId,
      companyId: row.companyId,
      version: row.version,
      status: row.status,
      triggerSnapshotJson: row.triggerSnapshotJson,
      conditionSnapshotJson: row.conditionSnapshotJson,
      actionSnapshotJson: row.actionSnapshotJson,
      recipientSnapshotJson: row.recipientSnapshotJson,
      cooldownSeconds: row.cooldownSeconds,
      createdBy: row.createdByUserId,
      createdAt: row.createdAt,
    };
  }

  private toEventInbox(row: any): WorkflowEventInboxRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      eventId: row.eventId,
      eventType: row.eventType,
      sourceModule: row.sourceModule,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      sourceVersion: opt(row.sourceVersion),
      payloadJson: row.payloadJson,
      dedupKey: row.dedupKey,
      status: row.status,
      receivedAt: row.receivedAt,
      processedAt: opt(row.processedAt),
      errorCode: opt(row.errorCode),
      errorMessage: opt(row.errorMessage),
    };
  }

  private toRun(row: any): WorkflowRunRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      ruleId: row.ruleId,
      ruleVersionId: row.ruleVersionId,
      triggerType: row.triggerType,
      triggerEventId: opt(row.triggerEventId),
      sourceModule: opt(row.sourceModule),
      sourceType: opt(row.sourceType),
      sourceId: opt(row.sourceId),
      dedupKey: row.dedupKey,
      triggerPayloadJson: (row.triggerPayloadJson ?? {}) as Record<string, unknown>,
      conditionResultJson: row.conditionResultJson,
      status: row.status,
      startedAt: opt(row.startedAt),
      finishedAt: opt(row.finishedAt),
      createdAt: row.createdAt,
      rule: row.rule ? { name: row.rule.name } : undefined,
      ruleVersion: row.ruleVersion ? this.toRuleVersion(row.ruleVersion) : undefined,
      actionRuns: Array.isArray(row.actionRuns) ? row.actionRuns.map((a: any) => this.toActionRun(a)) : undefined,
    };
  }

  private toActionRun(row: any): WorkflowActionRunRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      workflowRunId: row.workflowRunId,
      actionKey: row.actionKey,
      actionType: row.actionType,
      actionConfigSnapshotJson: row.actionConfigSnapshotJson,
      status: row.status,
      idempotencyKey: row.idempotencyKey,
      targetType: opt(row.targetType),
      targetId: opt(row.targetId),
      attemptCount: row.attemptCount,
      nextAttemptAt: opt(row.nextAttemptAt),
      lastErrorCode: opt(row.lastErrorCode),
      lastErrorMessage: opt(row.lastErrorMessage),
      resultJson: opt(row.resultJson),
      startedAt: opt(row.startedAt),
      finishedAt: opt(row.finishedAt),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toTask(row: any): WorkflowTaskRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      workflowRunId: opt(row.workflowRunId),
      workflowActionRunId: opt(row.workflowActionRunId),
      sourceModule: opt(row.sourceModule),
      sourceType: opt(row.sourceType),
      sourceId: opt(row.sourceId),
      title: row.title,
      description: opt(row.description),
      assigneeUserId: opt(row.assigneeUserId),
      assigneeRole: opt(row.assigneeRole),
      priority: row.priority,
      status: row.status,
      dueAt: opt(row.dueAt),
      snoozedUntil: opt(row.snoozedUntil),
      completedBy: opt(row.completedByUserId),
      completedAt: opt(row.completedAt),
      cancelReason: opt(row.cancelReason),
      webDeepLink: opt(row.webDeepLink),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toDeadLetter(row: any): WorkflowDeadLetterRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      workflowRunId: row.workflowRunId,
      workflowActionRunId: row.workflowActionRunId,
      errorCode: opt(row.errorCode),
      errorMessage: opt(row.errorMessage),
      errorDetailsJson: opt(row.errorDetailsJson),
      resolutionStatus: row.resolutionStatus,
      resolvedBy: opt(row.resolvedByUserId),
      resolvedAt: opt(row.resolvedAt),
      resolutionNote: opt(row.resolutionNote),
      createdAt: row.createdAt,
    };
  }

  private toWebhookEndpoint(row: any): WorkflowWebhookEndpointRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      name: row.name,
      url: row.url,
      status: row.status,
      secretRef: row.secretRef,
      allowedEventTypes: (row.allowedEventTypes ?? []) as string[],
      createdBy: row.createdByUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
