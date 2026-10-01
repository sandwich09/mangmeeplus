import { ForbiddenException, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { WorkflowActionDefinition } from '@watchdog-bms/contracts';
import { PrismaWorkflowRepository } from '../../infrastructure/prisma-workflow.repository';
import { PermissionResolverService } from '../../../access-control/application/permission-resolver.service';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import { AuditService } from '../../../audit/application/audit.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { CreateOrUpdateNotificationEventUseCase } from '../../../dashboard-notifications/application/use-cases/notification.use-cases';
import { REIMBURSEMENT_DECISION_WORDS } from '../../../dashboard-notifications/infrastructure/document-notification-state';
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
  triggerType?: string;
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
    triggerType: run.triggerType,
    sourceModule: run.sourceModule,
    sourceType: run.sourceType,
    sourceId: run.sourceId,
    payload: run.triggerPayloadJson,
    siblingActions: run.ruleVersion?.actionSnapshotJson ?? [],
  };
}

class RetryableActionError extends Error {}
class FinalActionError extends Error {}

const SCAN_TRIGGER_TYPES = ['SCHEDULE', 'THRESHOLD_SCAN', 'SLA_SCAN'];

/**
 * The period a notice belongs to (review M1). The notice store keeps ONE notice per trigger, record
 * and period, and a workflow notice is never resolved, so with no period a claim was notified once
 * per person, ever: a claim sent again never reached its approver, "approved" after "rejected" was
 * never pushed and the bell kept the old text.
 * An event happens once, so its run is its period: a retry of the same run repeats nothing, the
 * next event of the same kind is a new notice. A scan comes round every window and must not nag,
 * so it has no period of its own; a scan that wants one push per period names it in the payload.
 */
function notificationPeriodKey(context: ActionRunContext, actionRun: WorkflowActionRunRecord): string | undefined {
  const named = context.payload['notificationPeriodKey'];
  if (typeof named === 'string' && named.length > 0) return named;
  return context.triggerType && !SCAN_TRIGGER_TYPES.includes(context.triggerType) ? actionRun.workflowRunId : undefined;
}

/**
 * The payload as a person reads it (audit B15): a claim's `decision` code word becomes the words
 * the claim page uses. Done here rather than in each template so that no rule snapshot, however
 * old or admin-edited, can put a raw code word in a notice. Conditions and links keep the raw payload.
 */
function readablePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const decision = payload['decision'];
  return typeof decision === 'string' && Object.hasOwn(REIMBURSEMENT_DECISION_WORDS, decision)
    ? { ...payload, decision: REIMBURSEMENT_DECISION_WORDS[decision] }
    : payload;
}

/** The user ids that the named payload fields hold: each field is one id or a list of them. */
function payloadUserIds(keys: unknown, payload: Record<string, unknown>): string[] {
  if (!Array.isArray(keys)) return [];
  return keys.flatMap((key) => {
    const value = typeof key === 'string' ? payload[key] : undefined;
    if (typeof value === 'string' && value.length > 0) return [value];
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
  });
}

/**
 * Owner rule 2026-10-01: an action notice goes to the person whose turn it is, not to everyone
 * who holds the right (a shop owner holds every right and was pushed for every claim in every
 * branch). `preferRecipientPayloadKeys` names payload fields in order of preference. The first one
 * that names somebody ABLE to act narrows the group to those people; when none does, the whole
 * group stands, which keeps a solo owner, an approver without the right and one who has since left.
 * `neverPreferRecipientPayloadKeys` names people who are never the preferred ones (a requester is
 * not told alone to pay their own claim) though they stay in the whole group.
 * A rule snapshot without the key keeps the whole group, exactly as before.
 */
function narrowToPreferred(able: string[], cfg: Record<string, unknown>, payload: Record<string, unknown>): string[] {
  const preferKeys = Array.isArray(cfg['preferRecipientPayloadKeys']) ? cfg['preferRecipientPayloadKeys'] : [];
  const never = new Set(payloadUserIds(cfg['neverPreferRecipientPayloadKeys'], payload));
  for (const key of preferKeys) {
    const named = new Set(payloadUserIds([key], payload));
    const preferred = able.filter((userId) => named.has(userId) && !never.has(userId));
    if (preferred.length > 0) return preferred;
  }
  return able;
}

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
  // Reimbursement step-journey spec §11/§13: one journey page per request, not the generic
  // /module/type/id shape (which 404s for them).
  if (sourceType === 'reimbursement_request') return `/companies/${companyId}/reimbursements/${sourceId}`;
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
    private readonly access: PermissionResolverService,
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
    const permissionRecipientUserIds = narrowToPreferred(await this.membersAbleToAct(context, recipientPermissions), cfg, context.payload);
    const recipientPayloadKeys = Array.isArray(cfg['recipientPayloadKeys'])
      ? (cfg['recipientPayloadKeys'] as unknown[]).filter((key): key is string => typeof key === 'string')
      : [];
    const payloadRecipientUserIds = recipientPayloadKeys.flatMap((key) => {
      const value = context.payload[key];
      if (typeof value === 'string' && value.length > 0) return [value];
      if (Array.isArray(value)) return value.filter((id): id is string => typeof id === 'string' && id.length > 0);
      return [];
    });
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
      // A scan-driven reminder is retried by the next scan window, so it opts out of the retry and
      // dead letter an event gets: an event happens once, a scan would dead-letter every window.
      if (cfg['skipWhenNoRecipients'] === true) {
        return { resultJson: { skipped: true, reason: 'no_recipients' }, targetType: 'notification_event' };
      }
      throw new RetryableActionError('No active recipients resolved for configured recipientRoles, recipientPermissions, or recipientPayloadKeys (after exclusions)');
    }
    const readable = readablePayload(context.payload);
    const titleTemplate = findTitleTemplate(actionRun.actionKey, cfg, context.siblingActions);
    const title = titleTemplate ? renderTemplate(titleTemplate, readable) : `${context.ruleName} — WatchDog Workflow`;
    // Own config only (no sibling fallback like the title): a body borrowed from a sibling action
    // is how the notification ended up printing its own title twice.
    const bodyTemplate = typeof cfg['bodyTemplate'] === 'string' ? (cfg['bodyTemplate'] as string) : undefined;
    const body = bodyTemplate ? renderTemplate(bodyTemplate, readable) : title;
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
        periodKey: notificationPeriodKey(context, actionRun),
        supersedeEarlier: true,
      });
      return { resultJson: { skipped: result.skipped, reason: (result as { reason?: string }).reason }, targetType: 'notification_event', targetId: result.event?.id };
    } catch (err) {
      throw new RetryableActionError(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Audit B12: a recipient picked by permission must be able to ACT on this record, or the notice
   * is a link that answers 403. "Able to act" has one definition, the permission resolver (ACTIVE
   * role, entitlement filter, branch scope), so each holder is put through it instead of a second
   * copy of those rules living in the recipient query.
   * ponytail: one resolver round-trip per holder; batch it if a company ever has hundreds of them.
   */
  private async membersAbleToAct(context: ActionRunContext, permissionKeys: string[]): Promise<string[]> {
    const holders = await this.repo.findUserIdsByPermissions(context.companyId, permissionKeys);
    if (holders.length === 0) return [];
    const branchId = await this.repo.findSourceBranchId(context.companyId, context.sourceType, context.sourceId);
    const able = await Promise.all(holders.map(async (userId) => {
      try {
        const access = await this.access.resolveAccess(userId, context.companyId);
        return permissionKeys.some((key) => access.permissions.includes(key)) && isBranchInScope(access.scopes, branchId);
      } catch (err) {
        // The resolver refuses outright a member it would not let into this company at all.
        if (err instanceof ForbiddenException) return false;
        throw err;
      }
    }));
    return holders.filter((_, index) => able[index]);
  }

  private async createTask(actionRun: WorkflowActionRunRecord, context: ActionRunContext, cfg: Record<string, unknown>, isApprovalReview: boolean) {
    const existing = await this.repo.findTaskByActionRunId(context.companyId, actionRun.id);
    if (existing) return { resultJson: { alreadyExisted: true }, targetType: 'workflow_task', targetId: existing.id };

    const titleTemplate = typeof cfg['titleTemplate'] === 'string' ? cfg['titleTemplate'] : `${context.ruleName}${isApprovalReview ? ' — Approval review' : ''}`;
    const title = renderTemplate(titleTemplate, context.payload);
    const assigneeUserPayloadKey = typeof cfg['assigneeUserPayloadKey'] === 'string' ? cfg['assigneeUserPayloadKey'] : undefined;
    const payloadAssigneeUser = assigneeUserPayloadKey ? context.payload[assigneeUserPayloadKey] : undefined;
    const assigneeUserId = typeof payloadAssigneeUser === 'string' && payloadAssigneeUser.length > 0
      ? payloadAssigneeUser
      : undefined;
    const assigneeRolePayloadKey = typeof cfg['assigneeRolePayloadKey'] === 'string' ? cfg['assigneeRolePayloadKey'] : undefined;
    const payloadAssigneeRole = assigneeRolePayloadKey ? context.payload[assigneeRolePayloadKey] : undefined;
    const assigneeRole = typeof payloadAssigneeRole === 'string' && payloadAssigneeRole.length > 0
      ? payloadAssigneeRole
      : typeof cfg['assigneeRole'] === 'string' ? cfg['assigneeRole'] : undefined;
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
      assigneeUserId,
      // A person snapshot is exact authority. Keeping the old role as a second assignee would
      // expose the reminder to later role holders even though the reimbursement API refuses them.
      assigneeRole: assigneeUserId ? undefined : assigneeRole,
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
