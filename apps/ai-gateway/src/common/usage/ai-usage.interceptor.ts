/**
 * Opens the request-scoped usage collector around the three internal AI controllers and attaches
 * what the providers measured to the JSON response (metering spec §7.2). Health routes are not
 * decorated, so they stay untouched.
 */
import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import type { AiUsageEntry } from '@watchdog-bms/contracts';
import { drainUsage, runWithUsageContext } from './usage-context';

type UsageBody = { companyId?: unknown; userContext?: { companyId?: unknown } };

@Injectable()
export class AiUsageInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const body = context.switchToHttp().getRequest<{ body?: UsageBody }>()?.body;
    const raw = typeof body?.companyId === 'string' ? body.companyId : body?.userContext?.companyId;
    const companyId = typeof raw === 'string' && raw ? raw : undefined;

    // Nest's CallHandler is lazy: the route handler runs on SUBSCRIBE, not when handle() is
    // called. So the subscription itself has to happen inside the ALS run — otherwise every
    // provider call would append outside the store and each response would report nothing.
    // The store lives only as long as the request's async tree; the returned Subscription is
    // the teardown, so nothing is retained after unsubscribe.
    return new Observable((subscriber) =>
      runWithUsageContext({ companyId }, () => next.handle().pipe(map(attachUsage)).subscribe(subscriber)),
    );
  }
}

/** Attaches only when something was actually measured, so a response with no model call stays
 *  byte-for-byte what it is today. Entries already on the response (the AgentCore passthrough
 *  reports the artifact's own rows) are kept — dropping them would undercount real spend. */
function attachUsage(data: unknown): unknown {
  const usage = drainUsage();
  if (usage.length === 0 || !data || typeof data !== 'object' || Array.isArray(data)) return data;
  const existing = (data as { usage?: AiUsageEntry[] }).usage;
  return { ...data, usage: Array.isArray(existing) ? [...existing, ...usage] : usage };
}
