import { Injectable } from '@nestjs/common';
import type { WorkflowEventEnvelope } from '@watchdog-bms/contracts';
import { PrismaWorkflowRepository } from '../../infrastructure/prisma-workflow.repository';
import { RunWorkflowRuleUseCase, type RunWorkflowRuleResult } from './workflow-runner.use-case';
import { ruleMatchesEventType } from '../../domain/logic/workflow-event-match.logic';
import { buildRunDedupKey } from '../../domain/logic/workflow-idempotency.logic';
import { claimIdOfEvent } from '../../domain/logic/workflow-claim-task.logic';

export type IngestWorkflowEventResult = { matchedRuleCount: number; skipped: boolean; reason?: string };

/** `cooldown×2, duplicate_dedup_key×1` — stable order so the same outage always reads the same. */
function summarizeSkipReasons(results: RunWorkflowRuleResult[]): string {
  const counts = new Map<string, number>();
  for (const result of results) {
    const reason = result.reason ?? 'unknown';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([reason, n]) => `${reason}×${n}`).join(', ');
}

@Injectable()
export class IngestWorkflowEventUseCase {
  constructor(
    private readonly repo: PrismaWorkflowRepository,
    private readonly runner: RunWorkflowRuleUseCase,
  ) {}

  // Idempotent on (companyId, eventId): a re-delivered source event is stored once and
  // re-processing is a no-op. Unknown/unmatched events are recorded as SKIPPED, not FAILED.
  async execute(event: WorkflowEventEnvelope): Promise<IngestWorkflowEventResult> {
    const result = await this.ingest(event);
    // Audit B8: after the event's own rules ran (a claim event with no rule still counts), close the
    // approval tasks its claim has outlived. Not on a replay, which must change nothing at all.
    if (result.reason !== 'already_processed') await this.closeClaimTasks(event, false);
    return result;
  }

  /**
   * ponytail: best effort. A throw here would lose the event's notices for good (the retry is
   * dropped at the inbox), and a task left open is closed by the claim's next event or by the
   * sweep that runs at every release.
   */
  private async closeClaimTasks(event: WorkflowEventEnvelope, supersede: boolean): Promise<void> {
    const requestId = claimIdOfEvent(event);
    if (!requestId) return;
    try {
      await this.repo.closeSettledClaimTasks({ companyId: event.companyId, requestId, supersede });
    } catch {
      // Left for the next event or the release sweep, as described above.
    }
  }

  private async ingest(event: WorkflowEventEnvelope): Promise<IngestWorkflowEventResult> {
    const existing = await this.repo.findEventInboxByEventId(event.companyId, event.eventId);
    if (existing) return { matchedRuleCount: 0, skipped: true, reason: 'already_processed' };

    const inbox = await this.repo.createEventInbox({
      companyId: event.companyId,
      eventId: event.eventId,
      eventType: event.eventType,
      sourceModule: event.sourceModule,
      sourceType: event.sourceType,
      sourceId: event.sourceId,
      sourceVersion: event.sourceVersion,
      payloadJson: event.payload,
      dedupKey: event.dedupKey,
    });
    // A claim sent again starts a new round with its own task: whatever an earlier round left open
    // is superseded before that task is created (audit B8).
    if (event.eventType === 'reimbursement.request_submitted') await this.closeClaimTasks(event, true);

    let rules;
    try {
      rules = await this.repo.listEnabledRulesByTrigger(event.companyId, 'EVENT');
    } catch (err) {
      await this.repo.updateEventInbox(inbox.id, { status: 'FAILED', processedAt: new Date(), errorCode: 'RULE_LOOKUP_FAILED', errorMessage: err instanceof Error ? err.message : String(err) });
      throw err;
    }

    const matching = rules.filter((r) => ruleMatchesEventType(r.triggerConfigJson, event.eventType));
    if (matching.length === 0) {
      await this.repo.updateEventInbox(inbox.id, { status: 'SKIPPED', processedAt: new Date() });
      return { matchedRuleCount: 0, skipped: true, reason: 'no_matching_rules' };
    }

    const now = new Date();
    const results: RunWorkflowRuleResult[] = [];
    for (const rule of matching) {
      results.push(await this.runner.execute({
        rule,
        triggerType: 'EVENT',
        triggerEventId: event.eventId,
        sourceModule: rule.template?.sourceModule ?? event.sourceModule,
        sourceType: event.sourceType,
        sourceId: event.sourceId,
        dedupKey: buildRunDedupKey({ triggerType: 'EVENT', eventDedupKey: event.dedupKey }),
        // actorUserId rides the envelope, not `payload` (spec §10: payload holds only stable
        // condition/source-ref fields) — but an action's excludeRecipientPayloadKeys reads it off
        // the run payload like any other field, so it is folded in here for that one purpose.
        payload: { ...event.payload, eventType: event.eventType, actorUserId: event.actorUserId },
        now,
      }));
    }

    // MATCHED still means "rules subscribed to this event" (the enum's semantics), but when every
    // one of them skipped, the event produced no notification and no run row at all. Recording the
    // reasons here is the only trace of that: cooldown/duplicate skips return before createRun.
    const allSkipped = results.length > 0 && results.every((r) => r.status === 'SKIPPED');
    await this.repo.updateEventInbox(inbox.id, {
      status: 'MATCHED',
      processedAt: new Date(),
      errorCode: allSkipped ? 'RUNS_SKIPPED' : null,
      errorMessage: allSkipped ? summarizeSkipReasons(results) : null,
    });
    return { matchedRuleCount: matching.length, skipped: false };
  }
}
