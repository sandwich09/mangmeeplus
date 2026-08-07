/**
 * Internal endpoint for the CC1 runoff reconciler (spec:69, runbook R5 §4.5).
 *
 * Worker-token protected, not user-JWT: this is a SYSTEM sweep with no tenant actor, following the
 * `WorkflowInternalController` / `InternalNotificationController` pattern already used for every
 * other drain in this codebase.
 *
 * SCHEDULERLESS BY RULING (OQ-7). The partner command completes an empty drain post-commit, which
 * covers every case reachable today; this endpoint exists so R5 has a real action for the crash
 * window (commit succeeded, completion call died) and so a future non-empty drain has a caller.
 * Wiring a cadence is an ops item, deliberately not smuggled in here.
 *
 * It takes no `companyId`: a caller-supplied tenant would be a direct-injection surface, and the
 * sweep's whole job is to find drains nobody is watching.
 */
import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Public } from '../../../../common/security/public.decorator';
import { assertWorkerToken } from '../../../../common/security/worker-token';
import { PrismaService } from '../../../../common/database/prisma.service';
import {
  clampDrainingLimit,
  decodeDrainCursor,
  listDrainingPage,
  sweepDrainingLifecycles,
} from '../../application/runoff-lifecycle';

@Public()
@Controller('internal/feature-launch')
export class RunoffInternalController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Appends OFF to every lifecycle whose runoff snapshot has drained. Never widens snapshot
   * membership (spec:69) and never forces OFF while items are open — it only re-asks the
   * derivation, so R5 step 3's "never force OFF while items are open" is structural here.
   */
  @Post('runoff/sweep')
  async sweep(
    @Headers('x-worker-token') token: string | undefined,
    @Body() body: { limit?: number; cursorId?: string },
  ) {
    assertWorkerToken(token);
    // r18 F5 — clamped at the boundary AND pushed into the DB read, so no caller can ask an ops
    // endpoint for an unbounded scan (a junk or huge `limit` lands on the ceiling, never on zero).
    // r19-1 — `cursorId` continues past a page: without it a lifecycle that never completes would
    // permanently starve every drain behind it. Feed `nextCursorId` back until it comes back null.
    // Validated HERE so a malformed token is a 422 at the boundary rather than a silently empty page.
    decodeDrainCursor(body?.cursorId);
    return sweepDrainingLifecycles(this.prisma, clampDrainingLimit(body?.limit), body?.cursorId ?? null);
  }

  /**
   * R5 step 1 triage: what is draining right now, and for how long. Tenant-scoped ids ARE returned
   * here because this is the internal operator surface a support engineer needs to act on — unlike
   * the health view (§2.3), which is tenant-anonymous by contract.
   */
  @Post('runoff/draining')
  async draining(
    @Headers('x-worker-token') token: string | undefined,
    @Body() body: { limit?: number; cursorId?: string },
  ) {
    assertWorkerToken(token);
    decodeDrainCursor(body?.cursorId);
    const page = await listDrainingPage(this.prisma, clampDrainingLimit(body?.limit), body?.cursorId ?? null);
    const lifecycles = page.lifecycles;
    const now = Date.now();
    return {
      count: lifecycles.length,
      nextCursorId: page.nextCursorId,
      lifecycles: lifecycles.map((lifecycle) => ({
        transitionId: lifecycle.transitionId,
        companyId: lifecycle.companyId,
        featureKey: lifecycle.featureKey,
        disableSeq: lifecycle.disableSeq,
        cutoffAt: lifecycle.cutoffAt.toISOString(),
        requestedAt: lifecycle.requestedAt.toISOString(),
        // A broken drain (DISABLE_REQUESTED with no snapshot) reports its open items as null rather
        // than Infinity, which is not JSON — and a null here means "cannot tell", never "drained".
        openItems: Number.isFinite(lifecycle.openItems) ? lifecycle.openItems : null,
        ageHours: Math.floor((now - lifecycle.requestedAt.getTime()) / 3_600_000),
      })),
    };
  }
}
