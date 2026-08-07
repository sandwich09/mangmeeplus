/**
 * Internal endpoints for worker-triggered AI draft generation (Item 17).
 * Protected by the X-Worker-Token header instead of a user JWT, following the
 * item-16 WorkflowInternalController pattern.
 */
import { Controller, Post, Body, Headers } from '@nestjs/common';
import { Public } from '../../../../common/security/public.decorator';
import { assertWorkerToken } from '../../../../common/security/worker-token';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { SHADOW_SURFACES } from '../../../feature-launch/domain/shadow-surface.catalog';
import { DrainDraftRequestsUseCase } from '../../application/use-cases/drain-draft-requests.use-case';
import { GenerateSuggestionUseCase } from '../../application/use-cases/generate-suggestion.use-case';

@Public()
@Controller('internal/ai/draft-requests')
export class AiDraftInternalController {
  constructor(
    private readonly drain: DrainDraftRequestsUseCase,
    private readonly generate: GenerateSuggestionUseCase,
    private readonly shadow: LaunchShadowProbe,
  ) {}

  @Post('drain')
  drainQueued(@Headers('x-worker-token') token: string | undefined, @Body() body: { batchSize?: number }) {
    assertWorkerToken(token);
    return this.drain.execute(body?.batchSize);
  }

  @Post('generate')
  async generateOne(
    @Headers('x-worker-token') token: string | undefined,
    @Body() body: { companyId: string; requestId: string },
  ) {
    assertWorkerToken(token);
    // SHADOW ONLY (plan §3 F1): the direct-injection generate path, which the F0 inventory records
    // as having neither an entitlement check NOR an assertActiveCompany guard. One observation per
    // request; the drain path is measured separately under `ai.draft.drain`.
    const sweep = this.shadow.startSweep(SHADOW_SURFACES.aiDraftGenerate);
    try {
      await sweep.record(body.companyId, 'ai_line_assistant');
      // `return await`, so the flush below runs after the work rather than racing its promise.
      return await this.generate.execute(body.companyId, body.requestId);
    } finally {
      await sweep.flush();
    }
  }
}
