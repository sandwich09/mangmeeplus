import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { AiGatewayConfigService } from '../config/ai-gateway-config.service';
import { drainAiBudgetDurability } from './ai-budget-durability';

/**
 * Graceful drain on SIGTERM (hold-reconciliation spec §3), wired by `app.enableShutdownHooks()`.
 *
 * Nest has already closed the HTTP listener when this runs, which is step 1 of the spec ("stop
 * accepting new work"). Steps 2 and 3 — let the guarded provider calls that are ALREADY running
 * finish, then post their evidence before the process exits — are what this adds, because a
 * settlement that never leaves the process is a hold the operator has to reconcile by hand.
 *
 * Nothing here is provider- or company-specific and it holds no state: the queue and the in-flight
 * gauge are process-wide (`ai-budget-durability.ts`), because `createProvider` builds a fresh seam
 * per provider. Tests call `onApplicationShutdown()` directly — no real signal, no real timers.
 *
 * With no company on SPLIT there is nothing to wait for and nothing to flush, so this is a
 * sub-millisecond no-op that logs one line.
 */
@Injectable()
export class AiBudgetShutdownService implements OnApplicationShutdown {
  // Explicit token, like every other provider in this gateway: `app.boot.spec.ts` boots the graph
  // under the tsx local-dev loader, which emits no constructor metadata, so an inferred dependency
  // resolves to `undefined` and the shutdown hook throws on the way out.
  constructor(@Inject(AiGatewayConfigService) private readonly config: AiGatewayConfigService) {}

  async onApplicationShutdown(signal?: string): Promise<void> {
    await drainAiBudgetDurability({
      budgetMs: this.config.shutdownDrainMs,
      // Same sink the money seam and the provider guard use (`console.warn` of one JSON line), so
      // the drain is readable in CloudWatch beside them without a logger instance to inject.
      log: (line) => console.warn(JSON.stringify({ ...line, signal: signal ?? 'unknown' })),
    });
  }
}
