import { Injectable } from '@nestjs/common';
import { PrismaAiDraftRepository } from '../../infrastructure/prisma-ai-draft.repository';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { SHADOW_SURFACES } from '../../../feature-launch/domain/shadow-surface.catalog';
import { GenerateSuggestionUseCase } from './generate-suggestion.use-case';

/**
 * `ai.draft.*` permissions ARE entitlement-gated (`feature-gate.logic.ts:49`), but this drain never
 * resolves permissions, so the gate never applies to it — F0 async inventory §5d, "Entitlement
 * bypass, named". `ai_line_assistant` owns the route.
 */
const DRAFT_FEATURE_KEY = 'ai_line_assistant';

// Drains QUEUED draft requests by running generation for each. Invoked by the worker
// on a short interval (mirrors the item-16 workflow outbox drain). Generation is
// idempotent per request, so re-draining a partially processed batch is safe.
@Injectable()
export class DrainDraftRequestsUseCase {
  constructor(
    private readonly repo: PrismaAiDraftRepository,
    private readonly generate: GenerateSuggestionUseCase,
    private readonly shadow: LaunchShadowProbe,
  ) {}

  async execute(batchSize = 20): Promise<{ processed: number; results: Array<{ requestId: string; status: string }> }> {
    const queued = await this.repo.listQueuedRequestIds(Math.min(Math.max(batchSize, 1), 100));
    const results: Array<{ requestId: string; status: string }> = [];
    // SHADOW ONLY (plan §3 F1): each item here is a billable AI model call made with no entitlement
    // check. Record what the CC1 guard WOULD decide, then generate exactly as before.
    const sweep = this.shadow.startSweep(SHADOW_SURFACES.aiDraftDrain);
    try {
      for (const q of queued) {
        await sweep.record(q.companyId, DRAFT_FEATURE_KEY);
        const r = await this.generate.execute(q.companyId, q.id);
        results.push({ requestId: r.requestId, status: r.status });
      }
    } finally {
      // `finally`, not a trailing await (piece 3 / codex r15 fix 11): a throw from generation would
      // otherwise drop the whole batch's buffered counts with no bucket row and no persist_failed
      // warn. `flush()` swallows and warns, so this cannot mask the original error.
      await sweep.flush();
    }
    return { processed: results.length, results };
  }
}
