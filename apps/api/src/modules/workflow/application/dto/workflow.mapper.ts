import type {
  WorkflowTemplateSummary,
  WorkflowRuleSummary,
  WorkflowRuleDetail,
  WorkflowRunSummary,
  WorkflowRunDetail,
  WorkflowActionRunSummary,
  WorkflowTaskSummary,
  WorkflowDeadLetterSummary,
  WorkflowWebhookEndpointSummary,
} from '@watchdog-bms/contracts';
import type {
  WorkflowTemplateRecord,
  WorkflowRuleRecord,
  WorkflowRunRecord,
  WorkflowActionRunRecord,
  WorkflowTaskRecord,
  WorkflowDeadLetterRecord,
  WorkflowWebhookEndpointRecord,
} from '../../domain/models/workflow.model';
import { WORKFLOW_TEMPLATE_CATALOG } from '../../domain/workflow-template-catalog';

const iso = (d?: Date): string | undefined => (d ? d.toISOString() : undefined);

export function toTemplateSummary(t: WorkflowTemplateRecord): WorkflowTemplateSummary {
  const display = WORKFLOW_TEMPLATE_CATALOG.find((seed) => seed.key === t.key);
  return {
    id: t.id,
    key: t.key,
    name: display?.name ?? 'แบบตั้งต้นอื่น',
    description: display?.description ?? 'ยังไม่มีรายละเอียด',
    category: t.category,
    sourceModule: t.sourceModule,
    triggerType: t.triggerType,
    defaultConditionJson: t.defaultConditionJson,
    defaultActionJson: t.defaultActionJson,
    requiredPermissions: t.requiredPermissions,
    requiredSourceModules: t.requiredSourceModules,
    defaultEnabled: t.defaultEnabled,
    status: t.status,
    unavailableReason: display?.unavailableReason,
  };
}

export function toRuleSummary(r: WorkflowRuleRecord): WorkflowRuleSummary {
  return {
    id: r.id,
    templateId: r.templateId,
    templateKey: r.template?.key,
    name: r.name,
    description: r.description,
    status: r.status,
    triggerType: r.triggerType,
    sourceModule: r.template?.sourceModule,
    cooldownSeconds: r.cooldownSeconds,
    timezone: r.timezone,
    currentVersion: r.currentVersion,
    lastRunAt: iso(r.lastRunAt),
    lastRunStatus: r.lastRunStatus,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toRuleDetail(r: WorkflowRuleRecord): WorkflowRuleDetail {
  return {
    ...toRuleSummary(r),
    triggerConfigJson: r.triggerConfigJson,
    conditionJson: r.conditionJson,
    actionJson: r.actionJson,
    recipientConfigJson: r.recipientConfigJson,
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
    enabledBy: r.enabledBy,
    enabledAt: iso(r.enabledAt),
    disabledBy: r.disabledBy,
    disabledAt: iso(r.disabledAt),
  };
}

export function toActionRunSummary(a: WorkflowActionRunRecord): WorkflowActionRunSummary {
  return {
    id: a.id,
    actionKey: a.actionKey,
    actionType: a.actionType as WorkflowActionRunSummary['actionType'],
    status: a.status,
    attemptCount: a.attemptCount,
    nextAttemptAt: iso(a.nextAttemptAt),
    lastErrorCode: a.lastErrorCode,
    lastErrorMessage: a.lastErrorMessage,
    targetType: a.targetType,
    targetId: a.targetId,
    startedAt: iso(a.startedAt),
    finishedAt: iso(a.finishedAt),
  };
}

export function toRunSummary(r: WorkflowRunRecord): WorkflowRunSummary {
  return {
    id: r.id,
    ruleId: r.ruleId,
    ruleVersionId: r.ruleVersionId,
    ruleName: r.rule?.name ?? '',
    triggerType: r.triggerType,
    sourceModule: r.sourceModule,
    sourceType: r.sourceType,
    sourceId: r.sourceId,
    status: r.status,
    startedAt: iso(r.startedAt),
    finishedAt: iso(r.finishedAt),
    createdAt: r.createdAt.toISOString(),
  };
}

export function toRunDetail(r: WorkflowRunRecord): WorkflowRunDetail {
  return {
    ...toRunSummary(r),
    triggerEventId: r.triggerEventId,
    dedupKey: r.dedupKey,
    conditionResultJson: r.conditionResultJson,
    ruleVersionSnapshot: {
      version: r.ruleVersion?.version ?? 0,
      triggerSnapshotJson: r.ruleVersion?.triggerSnapshotJson ?? {},
      conditionSnapshotJson: r.ruleVersion?.conditionSnapshotJson ?? { field: 'unknown', op: 'EXISTS' },
      actionSnapshotJson: r.ruleVersion?.actionSnapshotJson ?? [],
    },
    actionRuns: (r.actionRuns ?? []).map(toActionRunSummary),
  };
}

export function toTaskSummary(t: WorkflowTaskRecord): WorkflowTaskSummary {
  return {
    id: t.id,
    workflowRunId: t.workflowRunId,
    sourceModule: t.sourceModule,
    sourceType: t.sourceType,
    sourceId: t.sourceId,
    title: t.title,
    description: t.description,
    assigneeUserId: t.assigneeUserId,
    assigneeRole: t.assigneeRole,
    priority: t.priority,
    status: t.status,
    dueAt: iso(t.dueAt),
    snoozedUntil: iso(t.snoozedUntil),
    webDeepLink: t.webDeepLink,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function toDeadLetterSummary(d: WorkflowDeadLetterRecord): WorkflowDeadLetterSummary {
  return {
    id: d.id,
    workflowRunId: d.workflowRunId,
    workflowActionRunId: d.workflowActionRunId,
    errorCode: d.errorCode,
    errorMessage: d.errorMessage,
    resolutionStatus: d.resolutionStatus,
    resolvedBy: d.resolvedBy,
    resolvedAt: iso(d.resolvedAt),
    resolutionNote: d.resolutionNote,
    createdAt: d.createdAt.toISOString(),
  };
}

export function toWebhookEndpointSummary(w: WorkflowWebhookEndpointRecord): WorkflowWebhookEndpointSummary {
  return {
    id: w.id,
    name: w.name,
    url: w.url,
    status: w.status,
    allowedEventTypes: w.allowedEventTypes,
    createdBy: w.createdBy,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}
