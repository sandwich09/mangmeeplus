import { Injectable } from '@nestjs/common';
import type { WorkflowTriggerType } from '@watchdog-bms/contracts';
import { PrismaWorkflowRepository } from '../../infrastructure/prisma-workflow.repository';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { SHADOW_SURFACES } from '../../../feature-launch/domain/shadow-surface.catalog';
import { RunWorkflowRuleUseCase } from './workflow-runner.use-case';
import { WorkflowScanCandidatesProvider } from './workflow-scan-candidates.use-case';
import { buildRunDedupKey } from '../../domain/logic/workflow-idempotency.logic';

export type ScanTriggerType = 'SCHEDULE' | 'THRESHOLD_SCAN' | 'SLA_SCAN';

/** The scan is `workflow_automation` work; the matched rule's own company owns the route. */
const SCAN_FEATURE_KEY = 'workflow_automation';

function periodKeyFor(triggerType: WorkflowTriggerType, now: Date): string {
  // SCHEDULE templates fire at most once per calendar day regardless of how often the
  // scan job itself runs. THRESHOLD_SCAN/SLA_SCAN use an hourly bucket so the rule's own
  // cooldownSeconds (not this dedup bucket) governs real alert-repeat cadence.
  return triggerType === 'SCHEDULE' ? now.toISOString().slice(0, 10) : now.toISOString().slice(0, 13);
}

@Injectable()
export class RunWorkflowScanUseCase {
  constructor(
    private readonly repo: PrismaWorkflowRepository,
    private readonly candidates: WorkflowScanCandidatesProvider,
    private readonly runner: RunWorkflowRuleUseCase,
    private readonly shadow: LaunchShadowProbe,
  ) {}

  // Scans across every company with at least one ENABLED rule of this trigger type.
  // Long scans page through source read APIs via WorkflowScanCandidatesProvider rather
  // than loading full company data — each adapter bounds its own query.
  async execute(triggerType: ScanTriggerType): Promise<{ rulesScanned: number; runsCreated: number }> {
    const rules = await this.repo.listAllEnabledRulesByTrigger(triggerType);
    const now = new Date();
    let runsCreated = 0;
    // SHADOW ONLY (plan §3 F1): this sweep never resolves permissions, so it is entitlement-blind
    // today. Record what the CC1 guard WOULD decide per rule, then scan exactly as before. Nothing
    // below branches on the result — a caller that did would have flipped enforcement.
    const sweep = this.shadow.startSweep(SHADOW_SURFACES.workflowScan);

    try {
      for (const rule of rules) {
        // Before the templateKey skip: a rule with a broken template is still work this company's
        // entitlement would have been asked about, and dropping it would understate the denominator.
        await sweep.record(rule.companyId, SCAN_FEATURE_KEY);
        const templateKey = rule.template?.key;
        if (!templateKey) continue;

        let items;
        try {
          items = await this.candidates.forTemplate(templateKey, rule.companyId, now);
        } catch {
          continue; // source module unavailable for this scan tick — skip, do not fail the whole batch
        }

        for (const item of items) {
          const result = await this.runner.execute({
            rule,
            triggerType: rule.triggerType,
            sourceModule: rule.template?.sourceModule,
            sourceType: item.sourceType,
            sourceId: item.sourceId,
            dedupKey: buildRunDedupKey({ triggerType: rule.triggerType, periodKey: periodKeyFor(rule.triggerType, now), sourceType: item.sourceType, sourceId: item.sourceId }),
            payload: item.payload,
            now,
          });
          if (result.runId && result.status !== 'SKIPPED') runsCreated++;
        }
      }
    } finally {
      // `finally`, not a trailing await (piece 3 / codex r15 fix 11): an observation already
      // recorded IS evidence. A throw from the runner or the repository would otherwise drop the
      // whole sweep's buffered counts with no bucket row AND no persist_failed warn, after which
      // later healthy sweeps leave the health view looking normal while a BLOCKING observation has
      // silently vanished. `flush()` swallows and warns, so this cannot mask the original error.
      await sweep.flush();
    }

    return { rulesScanned: rules.length, runsCreated };
  }
}
