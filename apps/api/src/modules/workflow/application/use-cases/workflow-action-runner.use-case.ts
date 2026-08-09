import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { WorkflowActionDefinition } from '@watchdog-bms/contracts';
import { PrismaWorkflowRepository } from '../../infrastructure/prisma-workflow.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { CreateOrUpdateNotificationEventUseCase } from '../../../dashboard-notifications/application/use-cases/notification.use-cases';
import { CreateDraftRequestUseCase } from '../../../ai-draft/application/use-cases/create-draft-request.use-case';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { SHADOW_SURFACES } from '../../../feature-launch/domain/shadow-surface.catalog';
import { decryptCredential } from '../../../system-partner-management/domain/logic/credential-cipher.logic';
import { renderTemplate } from '../../domain/logic/workflow-render.logic';
import { computeNextAttemptAt, isRetryExhausted } from '../../domain/logic/workflow-idempotency.logic';
import { WORKFLOW_MAX_RETRY_ATTEMPTS } from '../../domain/workflow.constants';
import type { WorkflowActionRunRecord, WorkflowRunRecord } from '../../domain/models/workflow.model';
import { postJsonWebhook, WebhookPolicyError } from '../../domain/logic/workflow-webhook-security.logic';

/** An outbound webhook is dispatched by the workflow engine; `workflow_automation` owns its route. */
const WEBHOOK_FEATURE_KEY = 'workflow_automation';

export type ActionRunContext = {
  companyId: string;
  ruleName: string;
  sourceModule?: string;
  sourceType?: string;
  sourceId?: string;
  payload: Record<string, unknown>;
  siblingActions: WorkflowActionDefinition[];
};

// Shared by the retry sweep and both replay paths (action-run replay, dead-letter replay)
// so a re-execution sees the exact same context the original run used.
export function buildActionRunContext(run: WorkflowRunRecord): ActionRunContext {
  return {
    companyId: run.companyId,
    ruleName: run.rule?.name ?? '',
    sourceModule: run.sourceModule,
    sourceType: run.sourceType,
    sourceId: run.sourceId,
    payload: run.triggerPayloadJson,
    siblingActions: run.ruleVersion?.actionSnapshotJson ?? [],
  };
}

class RetryableActionError extends Error {}
class FinalActionError extends Error {}

function findTitleTemplate(actionKey: string, configJson: Record<string, unknown>, siblings: WorkflowActionDefinition[]): string | undefined {
  if (typeof configJson['titleTemplate'] === 'string') return configJson['titleTemplate'];
  const sibling = siblings.find((a) => a.actionKey !== actionKey && typeof a.configJson['titleTemplate'] === 'string');
  return sibling ? (sibling.configJson['titleTemplate'] as string) : undefined;
}

function findDeepLinkPathTemplate(actionKey: string, configJson: Record<string, unknown>, siblings: WorkflowActionDefinition[]): string | undefined {
  if (typeof configJson['deepLinkPathTemplate'] === 'string') return configJson['deepLinkPathTemplate'];
  const sibling = siblings.find((a) => a.actionKey !== actionKey && typeof a.configJson['deepLinkPathTemplate'] === 'string');
  return sibling ? (sibling.configJson['deepLinkPathTemplate'] as string) : undefined;
}

function sourceWebPath(sourceModule?: string, sourceType?: string, sourceId?: string, companyId?: string): string | undefined {
  if (!sourceModule || !sourceId || !companyId) return undefined;
  // Reimbursement requests have no per-id page: the hub honours ?focus=. The generic
  // /module/type/id shape 404s for them.
  if (sourceType === 'reimbursement_request') return `/companies/${companyId}/reimbursements?focus=${sourceId}`;
  return `/companies/${companyId}/${sourceModule}/${sourceType ?? ''}/${sourceId}`.replace(/\/$/, '');
}

/**
 * One resolved path per action, shared by the notification deepLinkHref (which the LINE
 * message tail appends to WEB_BASE_URL) and WorkflowTask.webDeepLink. A template-supplied
 * path wins over the generic source path; it must stay a same-origin absolute path, so an
 * admin-edited actionJson can never redirect a LINE push off-site.
 */
function resolveDeepLink(actionKey: string, cfg: Record<string, unknown>, context: ActionRunContext): string | undefined {
  const template = findDeepLinkPathTemplate(actionKey, cfg, context.siblingActions);
  if (template) {
    const rendered = renderTemplate(template, { ...context.payload, companyId: context.companyId });
    if (rendered.startsWith('/') && !rendered.startsWith('//')) return rendered;
  }
  return sourceWebPath(context.sourceModule, context.sourceType, context.sourceId, context.companyId);
}

@Injectable()
export class ExecuteWorkflowActionUseCase {
  constructor(
    private readonly repo: PrismaWorkflowRepository,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly notify: CreateOrUpdateNotificationEventUseCase,
    private readonly aiDraft: CreateDraftRequestUseCase,
    private readonly shadow: LaunchShadowProbe,
  ) {}

  // Idempotent per actionRun row: SUCCEEDED runs are never re-passed here by the caller,
  // and each side-effecting adapter re-checks for prior linked records before creating new ones.
  async execute(actionRun: WorkflowActionRunRecord, context: ActionRunContext): Promise<void> {
    const now = new Date();
    await this.repo.updateActionRun(actionRun.id, { status: 'RUNNING', startedAt: actionRun.startedAt ?? now, attemptCount: actionRun.attemptCount + 1 });

    try {
      const result = await this.dispatch(actionRun, context);
      await this.repo.updateActionRun(actionRun.id, {
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        resultJson: result?.resultJson ?? {},
        targetType: result?.targetType,
        targetId: result?.targetId,
      });
    } catch (err) {
      const attemptCount = actionRun.attemptCount + 1;
      const message = err instanceof Error ? err.message : String(err);
      const retryable = err instanceof RetryableActionError && !isRetryExhausted(attemptCount, WORKFLOW_MAX_RETRY_ATTEMPTS);

      if (retryable) {
        await this.repo.updateActionRun(actionRun.id, {
          status: 'FAILED_RETRYABLE',
          attemptCount,
          nextAttemptAt: computeNextAttemptAt(attemptCount, new Date()),
          lastErrorCode: 'ACTION_FAILED_RETRYABLE',
          lastErrorMessage: message,
        });
        return;
      }

      await this.repo.updateActionRun(actionRun.id, {
        status: 'DEAD_LETTERED',
        attemptCount,
        finishedAt: new Date(),
        lastErrorCode: err instanceof FinalActionError ? 'ACTION_FAILED_FINAL' : 'ACTION_FAILED_EXHAUSTED',
        lastErrorMessage: message,
      });
      await this.repo.createDeadLetter({
        companyId: context.companyId,
        workflowRunId: actionRun.workflowRunId,
        workflowActionRunId: actionRun.id,
        errorCode: err instanceof FinalActionError ? 'ACTION_FAILED_FINAL' : 'ACTION_FAILED_EXHAUSTED',
        errorMessage: message,
        errorDetailsJson: { actionType: actionRun.actionType, attemptCount },
      });
      void this.audit.log({
        companyId: context.companyId, action: 'workflow.action_run.dead_letter',
        targetType: 'workflow_action_run', targetId: actionRun.id, requestId: `workflow-run:${actionRun.workflowRunId}`,
        result: 'FAILED', riskLevel: 'HIGH', metadataJson: { actionType: actionRun.actionType, message },
      });
    }
  }

  private async dispatch(actionRun: WorkflowActionRunRecord, context: ActionRunContext): Promise<{ resultJson?: Record<string, unknown>; targetType?: string; targetId?: string } | void> {
    const cfg = actionRun.actionConfigSnapshotJson;
    switch (actionRun.actionType) {
      case 'SEND_NOTIFICATION':
        return this.sendNotification(actionRun, context, cfg);
      case 'CREATE_WORKFLOW_TASK':
        return this.createTask(actionRun, context, cfg, false);
      case 'CREATE_APPROVAL_REVIEW_REQUEST':
        return this.createTask(actionRun, context, cfg, true);
      case 'ADD_AUDIT_NOTE':
        return this.addAuditNote(actionRun, context, cfg);
      case 'CALL_WEBHOOK':
        return this.callWebhook(actionRun, context, cfg);
      case 'REQUEST_AI_DRAFT':
        return this.requestAiDraft(actionRun, context, cfg);
      case 'CREATE_REPORT_EXPORT_DRAFT':
        return this.createDisabledFallbackTask(actionRun, context, cfg);
      case 'NOOP_DISABLED_TEMPLATE':
        return { resultJson: { skipped: true, reason: cfg['reason'] ?? 'template disabled' } };
      default:
        throw new FinalActionError(`Unsupported action type: ${actionRun.actionType}`);
    }
  }

  private async sendNotification(actionRun: WorkflowActionRunRecord, context: ActionRunContext, cfg: Record<string, unknown>) {
    const recipientRoles = Array.isArray(cfg['recipientRoles']) ? (cfg['recipientRoles'] as string[]) : [];
    const roleRecipientUserIds = await this.repo.findUserIdsByRoles(context.companyId, recipientRoles);
    const recipientPermissions = Array.isArray(cfg['recipientPermissions'])
      ? (cfg['recipientPermissions'] as unknown[]).filter((key): key is string => typeof key === 'string')
      : [];
    const permissionRecipientUserIds = await this.repo.findUserIdsByPermissions(context.companyId, recipientPermissions);
    const recipientPayloadKeys = Array.isArray(cfg['recipientPayloadKeys'])
      ? (cfg['recipientPayloadKeys'] as unknown[]).filter((key): key is string => typeof key === 'string')
      : [];
    const payloadRecipientUserIds = recipientPayloadKeys
      .map((key) => context.payload[key])
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    // excludeRecipientPayloadKeys names payload fields (string or string[]) holding
    // user ids that must never receive this notification — e.g. the submitter and
    // recorded approvers of a dual-approval vendor bill.
    const excludeKeys = Array.isArray(cfg['excludeRecipientPayloadKeys'])
      ? (cfg['excludeRecipientPayloadKeys'] as unknown[]).filter((key): key is string => typeof key === 'string')
      : [];
    const excludedUserIds = new Set(excludeKeys.flatMap((key) => {
      const value = context.payload[key];
      if (typeof value === 'string') return [value];
      if (Array.isArray(value)) return value.filter((id): id is string => typeof id === 'string');
      return [];
    }));
    const resolvedUserIds = [...new Set([...roleRecipientUserIds, ...permissionRecipientUserIds, ...payloadRecipientUserIds])];
    const recipientUserIds = resolvedUserIds.filter((userId) => !excludedUserIds.has(userId));
    if (recipientUserIds.length === 0) {
      // Audit H-18: whether "everyone was excluded" is a failure depends on the template, so it is
      // opt-in rather than a blanket rule.
      //
      // The dual-approval vendor bill excludes the submitter and the first approver, and a company
      // with nobody left genuinely lacks an eligible second approver — that must stay a retryable
      // failure so it surfaces. An owner-only company filing its own reimbursement excludes the
      // filer and correctly has nobody to tell; retrying that would dead-letter an action on every
      // claim and make a working configuration look broken.
      //
      // Nothing resolving AT ALL is the old error in both cases: the roles or permissions name
      // people who do not exist, which a later membership change can fix.
      if (resolvedUserIds.length > 0 && cfg['skipWhenAllRecipientsExcluded'] === true) {
        return { resultJson: { skipped: true, reason: 'all_recipients_excluded' }, targetType: 'notification_event' };
      }
      throw new RetryableActionError('No active recipients resolved for configured recipientRoles, recipientPermissions, or recipientPayloadKeys (after exclusions)');
    }
    const titleTemplate = findTitleTemplate(actionRun.actionKey, cfg, context.siblingActions);
    const title = titleTemplate ? renderTemplate(titleTemplate, context.payload) : `${context.ruleName} — WatchDog Workflow`;
    // Own config only (no sibling fallback like the title): a body borrowed from a sibling action
    // is how the notification ended up printing its own title twice.
    const bodyTemplate = typeof cfg['bodyTemplate'] === 'string' ? (cfg['bodyTemplate'] as string) : undefined;
    const body = bodyTemplate ? renderTemplate(bodyTemplate, context.payload) : title;
    const webPath = resolveDeepLink(actionRun.actionKey, cfg, context);

    try {
      const result = await this.notify.execute({
        companyId: context.companyId,
        triggerKey: String(cfg['triggerKey'] ?? `workflow.${actionRun.actionKey}`),
        sourceModule: context.sourceModule ?? 'workflow',
        sourceType: context.sourceType ?? 'workflow_run',
        sourceId: context.sourceId ?? actionRun.workflowRunId,
        severity: String(cfg['severity'] ?? 'info'),
        title,
        body,
        deepLinkHref: webPath,
        sourceRefs: webPath ? [{ module: context.sourceModule, type: context.sourceType, id: context.sourceId, webPath }] : [],
        recipientUserIds,
      });
      return { resultJson: { skipped: result.skipped, reason: (result as { reason?: string }).reason }, targetType: 'notification_event', targetId: result.event?.id };
    } catch (err) {
      throw new RetryableActionError(err instanceof Error ? err.message : String(err));
    }
  }

  private async createTask(actionRun: WorkflowActionRunRecord, context: ActionRunContext, cfg: Record<string, unknown>, isApprovalReview: boolean) {
    const existing = await this.repo.findTaskByActionRunId(context.companyId, actionRun.id);
    if (existing) return { resultJson: { alreadyExisted: true }, targetType: 'workflow_task', targetId: existing.id };

    const titleTemplate = typeof cfg['titleTemplate'] === 'string' ? cfg['titleTemplate'] : `${context.ruleName}${isApprovalReview ? ' — Approval review' : ''}`;
    const title = renderTemplate(titleTemplate, context.payload);
    const assigneeRole = typeof cfg['assigneeRole'] === 'string' ? cfg['assigneeRole'] : undefined;
    const priority = typeof cfg['priority'] === 'string' ? cfg['priority'] : 'NORMAL';
    const webPath = resolveDeepLink(actionRun.actionKey, cfg, context);

    const task = await this.repo.createTask({
      companyId: context.companyId,
      workflowRunId: actionRun.workflowRunId,
      workflowActionRunId: actionRun.id,
      sourceModule: context.sourceModule,
      sourceType: context.sourceType,
      sourceId: context.sourceId,
      title: isApprovalReview ? `[Approval review] ${title}` : title,
      description: isApprovalReview ? 'Workflow-created approval-review task. Completing this task does not approve the source record.' : undefined,
      assigneeRole,
      priority,
      webDeepLink: webPath,
    });
    return { resultJson: { created: true }, targetType: 'workflow_task', targetId: task.id };
  }

  private async addAuditNote(actionRun: WorkflowActionRunRecord, context: ActionRunContext, cfg: Record<string, unknown>) {
    const noteTemplate = typeof cfg['noteTemplate'] === 'string' ? cfg['noteTemplate'] : `Workflow rule "${context.ruleName}" fired.`;
    await this.audit.log({
      companyId: context.companyId,
      action: 'workflow.audit_note',
      targetType: context.sourceType ?? 'workflow_run',
      targetId: context.sourceId ?? actionRun.workflowRunId,
      requestId: `workflow-run:${actionRun.workflowRunId}`,
      result: 'SUCCESS',
      riskLevel: 'LOW',
      metadataJson: { note: renderTemplate(noteTemplate, context.payload) },
    });
    return { resultJson: { logged: true } };
  }

  private async callWebhook(actionRun: WorkflowActionRunRecord, context: ActionRunContext, cfg: Record<string, unknown>) {
    // SHADOW ONLY (plan §3 F1): the OUTBOUND webhook row of the F0 async inventory. This is the one
    // seam every dispatch path converges on — the retry sweep, the synchronous rule run and both
    // replay paths — so measuring here cannot miss an outbound send, and a per-dispatch sweep costs
    // one upsert on a surface that only fires for rules explicitly configured with CALL_WEBHOOK.
    // Recorded BEFORE the endpoint checks: an outbound send this tenant's entitlement would have
    // been asked about is evidence whether or not its endpoint config turns out to be valid.
    const sweep = this.shadow.startSweep(SHADOW_SURFACES.workflowWebhookDispatch);
    try {
      await sweep.record(context.companyId, WEBHOOK_FEATURE_KEY);
    } finally {
      // Uniform with every other caller (piece 3 / codex r15 fix 11). Redundant while this sweep
      // holds one observation, and NOT redundant the moment a second `record` is added here.
      await sweep.flush();
    }

    const endpointId = typeof cfg['endpointId'] === 'string' ? cfg['endpointId'] : '';
    if (!endpointId) throw new FinalActionError('CALL_WEBHOOK action has no configured endpointId');

    const endpoint = await this.repo.findWebhookEndpointById(context.companyId, endpointId);
    if (!endpoint) throw new FinalActionError(`Webhook endpoint not found: ${endpointId}`);
    if (endpoint.status !== 'ENABLED') throw new FinalActionError('Webhook endpoint is disabled');
    const eventType = String(context.payload['eventType'] ?? '');
    if (!endpoint.allowedEventTypes.includes(eventType)) {
      throw new FinalActionError(`Event type not allowlisted for this webhook endpoint: ${eventType}`);
    }

    const secret = decryptCredential(endpoint.secretRef, this.config.credentialEncryptionKey);
    const body = JSON.stringify({ eventType, companyId: context.companyId, sourceModule: context.sourceModule, sourceType: context.sourceType, sourceId: context.sourceId, occurredAt: new Date().toISOString() });
    const signature = createHmac('sha256', secret).update(body).digest('hex');

    let status: number;
    try {
      ({ status } = await postJsonWebhook({
        url: endpoint.url,
        allowedHosts: this.config.workflowWebhookAllowedHosts,
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Idempotency-Key': actionRun.idempotencyKey,
        },
        body,
        timeoutMs: 10_000,
      }));
    } catch (err) {
      if (err instanceof WebhookPolicyError) throw new FinalActionError(err.message);
      throw new RetryableActionError(`Webhook request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (status < 200 || status >= 300) {
      if (status >= 500) throw new RetryableActionError(`Webhook endpoint returned ${status}`);
      throw new FinalActionError(`Webhook endpoint returned ${status}`);
    }
    return { resultJson: { statusCode: status }, targetType: 'workflow_webhook_endpoint', targetId: endpoint.id };
  }

  // REQUEST_AI_DRAFT (item 17): request a safe AI draft on behalf of the configured
  // requester. The workflow can request but never apply a draft — source-draft creation
  // stays web-only. Falls back to a review task when the action is not fully configured.
  private async requestAiDraft(actionRun: WorkflowActionRunRecord, context: ActionRunContext, cfg: Record<string, unknown>) {
    const templateKey = typeof cfg['templateKey'] === 'string' ? (cfg['templateKey'] as string) : undefined;
    const requesterUserId = typeof cfg['requesterUserId'] === 'string' ? (cfg['requesterUserId'] as string) : undefined;
    if (!templateKey || !requesterUserId) {
      return this.createDisabledFallbackTask(actionRun, context, {
        reason: 'REQUEST_AI_DRAFT requires templateKey and requesterUserId in the action config',
      });
    }
    try {
      const request = await this.aiDraft.createFromWorkflow({
        companyId: context.companyId,
        requesterUserId,
        templateKey,
        sourceModule: context.sourceModule,
        sourceRecordType: context.sourceType,
        sourceRecordId: context.sourceId,
        workflowRunId: actionRun.workflowRunId,
      });
      return { resultJson: { aiDraftRequestId: request.id, status: request.status }, targetType: 'ai_draft_request', targetId: request.id };
    } catch (err) {
      throw new RetryableActionError(err instanceof Error ? err.message : String(err));
    }
  }

  private async createDisabledFallbackTask(actionRun: WorkflowActionRunRecord, context: ActionRunContext, cfg: Record<string, unknown>) {
    const existing = await this.repo.findTaskByActionRunId(context.companyId, actionRun.id);
    if (existing) return { resultJson: { alreadyExisted: true }, targetType: 'workflow_task', targetId: existing.id };
    const task = await this.repo.createTask({
      companyId: context.companyId,
      workflowRunId: actionRun.workflowRunId,
      workflowActionRunId: actionRun.id,
      sourceModule: context.sourceModule,
      sourceType: context.sourceType,
      sourceId: context.sourceId,
      title: `[Review needed] ${context.ruleName}`,
      description: `${actionRun.actionType} is not yet available (${cfg['reason'] ?? 'provider not implemented'}). This task was created as a safe fallback for manual follow-up.`,
      priority: 'NORMAL',
    });
    return { resultJson: { fallback: true }, targetType: 'workflow_task', targetId: task.id };
  }
}
