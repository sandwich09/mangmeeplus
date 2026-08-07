// ---- Item 16: Workflow Automation ----
//
// Safe workflow automation: admin-configured rules react to events, schedules,
// threshold/SLA scans, or manual replay, evaluate a constrained JSON condition
// tree, and run a bounded set of safe actions (notify, create task, create
// approval-review task, request AI draft, request export draft, call
// allowlisted webhook, add audit note). Workflow never performs final money,
// stock, tax, accounting, permission, export, approval, or publishing
// mutations — those stay owned by source modules.

export type WorkflowTriggerType = 'EVENT' | 'SCHEDULE' | 'THRESHOLD_SCAN' | 'SLA_SCAN' | 'MANUAL_TEST' | 'MANUAL_REPLAY';

export type WorkflowConditionGroupType = 'ALL' | 'ANY' | 'NOT';

export type WorkflowConditionOperator =
  | 'EQ' | 'NEQ' | 'GT' | 'GTE' | 'LT' | 'LTE'
  | 'IN' | 'NOT_IN' | 'EXISTS' | 'MISSING'
  | 'CONTAINS' | 'STARTS_WITH' | 'OLDER_THAN' | 'WITHIN_NEXT' | 'BETWEEN';

export type WorkflowActionType =
  | 'SEND_NOTIFICATION'
  | 'CREATE_WORKFLOW_TASK'
  | 'CREATE_APPROVAL_REVIEW_REQUEST'
  | 'REQUEST_AI_DRAFT'
  | 'CREATE_REPORT_EXPORT_DRAFT'
  | 'CALL_WEBHOOK'
  | 'ADD_AUDIT_NOTE'
  | 'NOOP_DISABLED_TEMPLATE';

export type WorkflowTemplateStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'DEPRECATED';
export type WorkflowRuleStatus = 'DRAFT' | 'ENABLED' | 'DISABLED' | 'ARCHIVED';
export type WorkflowRunStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL_FAILED' | 'FAILED' | 'SKIPPED' | 'CANCELED';
export type WorkflowActionRunStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED_RETRYABLE' | 'FAILED_FINAL' | 'DEAD_LETTERED' | 'SKIPPED' | 'CANCELED';
export type WorkflowTaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
export type WorkflowTaskStatus = 'OPEN' | 'SNOOZED' | 'DONE' | 'CANCELED';
export type WorkflowDeadLetterResolutionStatus = 'OPEN' | 'REPLAYED' | 'IGNORED' | 'RESOLVED_EXTERNALLY';
export type WorkflowWebhookStatus = 'DISABLED' | 'ENABLED';
export type WorkflowEventInboxStatus = 'RECEIVED' | 'MATCHED' | 'SKIPPED' | 'FAILED';

// ---- Condition tree (constrained JSON only — no code/SQL execution) ----

export type WorkflowConditionLeaf = {
  field: string;
  op: WorkflowConditionOperator;
  value?: unknown;
};

export type WorkflowConditionGroup = {
  type: WorkflowConditionGroupType;
  conditions: WorkflowConditionNode[];
};

export type WorkflowConditionNode = WorkflowConditionGroup | WorkflowConditionLeaf;

export type WorkflowConditionEvalResult = {
  matched: boolean;
  reason?: string;
  errors?: string[];
};

// ---- Actions ----

export type WorkflowActionDefinition = {
  actionKey: string;
  actionType: WorkflowActionType;
  configJson: Record<string, unknown>;
};

// ---- Event envelope (spec section 10) ----

export type WorkflowEventEnvelope = {
  eventId: string;
  eventType: string;
  companyId: string;
  sourceModule: string;
  sourceType: string;
  sourceId: string;
  sourceVersion?: string;
  occurredAt: string;
  actorUserId?: string;
  dedupKey: string;
  payload: Record<string, unknown>;
  schemaVersion: number;
};

// ---- Templates ----

export type WorkflowTemplateSummary = {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  sourceModule: string;
  triggerType: WorkflowTriggerType;
  defaultConditionJson: WorkflowConditionNode;
  defaultActionJson: WorkflowActionDefinition[];
  requiredPermissions: string[];
  requiredSourceModules: string[];
  defaultEnabled: boolean;
  status: WorkflowTemplateStatus;
  unavailableReason?: string;
};

export type EnableWorkflowTemplateInput = {
  name?: string;
  description?: string;
  triggerConfigJson?: Record<string, unknown>;
  conditionJson?: WorkflowConditionNode;
  actionJson?: WorkflowActionDefinition[];
  recipientConfigJson?: Record<string, unknown>;
  cooldownSeconds?: number;
  timezone?: string;
  activate?: boolean;
};

// ---- Rules ----

export type WorkflowRuleSummary = {
  id: string;
  templateId?: string;
  templateKey?: string;
  name: string;
  description?: string;
  status: WorkflowRuleStatus;
  triggerType: WorkflowTriggerType;
  sourceModule?: string;
  cooldownSeconds: number;
  timezone: string;
  currentVersion: number;
  lastRunAt?: string;
  lastRunStatus?: WorkflowRunStatus;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowRuleDetail = WorkflowRuleSummary & {
  triggerConfigJson: Record<string, unknown>;
  conditionJson: WorkflowConditionNode;
  actionJson: WorkflowActionDefinition[];
  recipientConfigJson: Record<string, unknown>;
  createdBy: string;
  updatedBy?: string;
  enabledBy?: string;
  enabledAt?: string;
  disabledBy?: string;
  disabledAt?: string;
};

export type CreateWorkflowRuleInput = {
  templateId?: string;
  name: string;
  description?: string;
  triggerType: WorkflowTriggerType;
  triggerConfigJson: Record<string, unknown>;
  conditionJson: WorkflowConditionNode;
  actionJson: WorkflowActionDefinition[];
  recipientConfigJson?: Record<string, unknown>;
  cooldownSeconds?: number;
  timezone?: string;
};

export type UpdateWorkflowRuleInput = Partial<Omit<CreateWorkflowRuleInput, 'templateId' | 'triggerType'>>;

export type ListWorkflowRulesFilter = {
  status?: WorkflowRuleStatus;
  triggerType?: WorkflowTriggerType;
  sourceModule?: string;
  templateId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type WorkflowRuleTestResult = {
  conditionResult: WorkflowConditionEvalResult;
  actionPlan: WorkflowActionDefinition[];
  sampleUsed: Record<string, unknown>;
};

// ---- Runs and action runs ----

export type WorkflowActionRunSummary = {
  id: string;
  actionKey: string;
  actionType: WorkflowActionType;
  status: WorkflowActionRunStatus;
  attemptCount: number;
  nextAttemptAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  targetType?: string;
  targetId?: string;
  startedAt?: string;
  finishedAt?: string;
};

export type WorkflowRunSummary = {
  id: string;
  ruleId: string;
  ruleVersionId: string;
  ruleName: string;
  triggerType: WorkflowTriggerType;
  sourceModule?: string;
  sourceType?: string;
  sourceId?: string;
  status: WorkflowRunStatus;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
};

export type WorkflowRunDetail = WorkflowRunSummary & {
  triggerEventId?: string;
  dedupKey: string;
  conditionResultJson: WorkflowConditionEvalResult;
  ruleVersionSnapshot: {
    version: number;
    triggerSnapshotJson: Record<string, unknown>;
    conditionSnapshotJson: WorkflowConditionNode;
    actionSnapshotJson: WorkflowActionDefinition[];
  };
  actionRuns: WorkflowActionRunSummary[];
};

export type ListWorkflowRunsFilter = {
  ruleId?: string;
  status?: WorkflowRunStatus;
  sourceModule?: string;
  actionType?: WorkflowActionType;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type WorkflowExplanation = {
  runId: string;
  ruleName: string;
  triggerType: WorkflowTriggerType;
  triggerSummary: string;
  conditionSummary: string;
  actionSummaries: string[];
  sourceRefs: Array<{ module: string; type: string; id: string; webPath?: string }>;
  nextAction: string;
};

// ---- Tasks ----

export type WorkflowTaskSummary = {
  id: string;
  workflowRunId?: string;
  sourceModule?: string;
  sourceType?: string;
  sourceId?: string;
  title: string;
  description?: string;
  assigneeUserId?: string;
  assigneeRole?: string;
  priority: WorkflowTaskPriority;
  status: WorkflowTaskStatus;
  dueAt?: string;
  snoozedUntil?: string;
  webDeepLink?: string;
  createdAt: string;
  updatedAt: string;
};

export type ListWorkflowTasksFilter = {
  scope?: 'own' | 'team' | 'all';
  status?: WorkflowTaskStatus;
  priority?: WorkflowTaskPriority;
  sourceModule?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

// ---- Dead letters ----

export type WorkflowDeadLetterSummary = {
  id: string;
  workflowRunId: string;
  workflowActionRunId: string;
  errorCode?: string;
  errorMessage?: string;
  resolutionStatus: WorkflowDeadLetterResolutionStatus;
  resolvedBy?: string;
  resolvedAt?: string;
  resolutionNote?: string;
  createdAt: string;
};

export type ListWorkflowDeadLettersFilter = {
  resolutionStatus?: WorkflowDeadLetterResolutionStatus;
  ruleId?: string;
  page?: number;
  pageSize?: number;
};

// ---- Webhook endpoints ----

export type WorkflowWebhookEndpointSummary = {
  id: string;
  name: string;
  url: string;
  status: WorkflowWebhookStatus;
  allowedEventTypes: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertWorkflowWebhookEndpointInput = {
  name: string;
  url: string;
  allowedEventTypes: string[];
  secretRef: string;
};

// ---- Permission keys (spec section 12) ----

export const WORKFLOW_PERMISSION_KEYS = {
  TEMPLATE_READ: 'workflow.template.read',
  RULE_READ: 'workflow.rule.read',
  RULE_MANAGE: 'workflow.rule.manage',
  RULE_ENABLE: 'workflow.rule.enable',
  RUN_READ: 'workflow.run.read',
  RUN_REPLAY: 'workflow.run.replay',
  TASK_READ: 'workflow.task.read',
  TASK_WORK: 'workflow.task.work',
  DEAD_LETTER_READ: 'workflow.dead_letter.read',
  DEAD_LETTER_REPLAY: 'workflow.dead_letter.replay',
  WEBHOOK_MANAGE: 'workflow.webhook.manage',
  AUDIT_READ: 'workflow.audit.read',
} as const;
