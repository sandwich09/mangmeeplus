import { Injectable } from '@nestjs/common';
import type { WorkflowTriggerType } from '@watchdog-bms/contracts';
import { PrismaWorkflowRepository } from '../../infrastructure/prisma-workflow.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { ExecuteWorkflowActionUseCase } from './workflow-action-runner.use-case';
import { evaluateCondition } from '../../domain/logic/workflow-condition.logic';
import { buildActionIdempotencyKey, isRuleInCooldown } from '../../domain/logic/workflow-idempotency.logic';
import type { WorkflowRuleRecord } from '../../domain/models/workflow.model';

export type RunWorkflowRuleInput = {
  rule: WorkflowRuleRecord;
  triggerType: WorkflowTriggerType;
  triggerEventId?: string;
  sourceModule?: string;
  sourceType?: string;
  sourceId?: string;
  dedupKey: string;
  payload: Record<string, unknown>;
  now: Date;
};

export type RunWorkflowRuleResult = {
  status: 'SKIPPED' | 'SUCCEEDED' | 'PARTIAL_FAILED' | 'FAILED';
  reason?: string;
  runId?: string;
};

@Injectable()
export class RunWorkflowRuleUseCase {
  constructor(
    private readonly repo: PrismaWorkflowRepository,
    private readonly audit: AuditService,
    private readonly executeAction: ExecuteWorkflowActionUseCase,
  ) {}

  async execute(input: RunWorkflowRuleInput): Promise<RunWorkflowRuleResult> {
    const { rule } = input;
    if (rule.status !== 'ENABLED') return { status: 'SKIPPED', reason: 'rule_not_enabled' };

    // Idempotent: a prior run for the same (companyId, ruleVersionId, dedupKey) already exists.
    const version = await this.repo.findLatestRuleVersion(rule.id);
    if (!version) return { status: 'SKIPPED', reason: 'no_rule_version' };

    const existingRun = await this.repo.findRunByDedupKey(rule.companyId, version.id, input.dedupKey);
    if (existingRun) return { status: 'SKIPPED', reason: 'duplicate_dedup_key', runId: existingRun.id };

    if (isRuleInCooldown(rule.lastRunAt, version.cooldownSeconds, input.now)) {
      return { status: 'SKIPPED', reason: 'cooldown' };
    }

    const conditionResult = evaluateCondition(version.conditionSnapshotJson, input.payload, input.now);

    const run = await this.repo.createRun({
      companyId: rule.companyId,
      ruleId: rule.id,
      ruleVersionId: version.id,
      triggerType: input.triggerType,
      triggerEventId: input.triggerEventId,
      sourceModule: input.sourceModule,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      dedupKey: input.dedupKey,
      triggerPayloadJson: input.payload,
      conditionResultJson: conditionResult,
      status: conditionResult.matched ? 'RUNNING' : 'SKIPPED',
    });

    if (!conditionResult.matched) {
      await this.repo.updateRun(run.id, { status: 'SKIPPED', finishedAt: new Date() });
      return { status: 'SKIPPED', reason: 'condition_not_matched', runId: run.id };
    }

    const actionRuns = await Promise.all(
      version.actionSnapshotJson.map((action) =>
        this.repo.createActionRun({
          companyId: rule.companyId,
          workflowRunId: run.id,
          actionKey: action.actionKey,
          actionType: action.actionType,
          actionConfigSnapshotJson: action.configJson,
          idempotencyKey: buildActionIdempotencyKey(run.id, action.actionKey),
          status: 'QUEUED',
        }),
      ),
    );

    for (const actionRun of actionRuns) {
      await this.executeAction.execute(actionRun, {
        companyId: rule.companyId,
        ruleName: rule.name,
        sourceModule: input.sourceModule,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        payload: input.payload,
        siblingActions: version.actionSnapshotJson,
      });
    }

    const finalStates = await Promise.all(actionRuns.map((a) => this.repo.findActionRunById(rule.companyId, a.id)));
    const anyFailed = finalStates.some((a) => a && ['FAILED_RETRYABLE', 'FAILED_FINAL', 'DEAD_LETTERED'].includes(a.status));
    const allFailed = finalStates.every((a) => a && ['FAILED_RETRYABLE', 'FAILED_FINAL', 'DEAD_LETTERED'].includes(a.status));
    const runStatus = allFailed && finalStates.length > 0 ? 'FAILED' : anyFailed ? 'PARTIAL_FAILED' : 'SUCCEEDED';

    await this.repo.updateRun(run.id, { status: runStatus, finishedAt: new Date() });
    void this.audit.log({
      companyId: rule.companyId, action: 'workflow.run.execute',
      targetType: 'workflow_run', targetId: run.id, requestId: `workflow-trigger:${input.triggerType}`,
      result: runStatus === 'FAILED' ? 'FAILED' : 'SUCCESS', riskLevel: 'LOW',
      metadataJson: { ruleId: rule.id, triggerType: input.triggerType, actionCount: actionRuns.length },
    });

    return { status: runStatus, runId: run.id };
  }
}
