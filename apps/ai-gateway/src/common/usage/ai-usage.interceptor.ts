/**
 * Opens the request-scoped usage collector around the three internal AI controllers and attaches
 * what the providers measured to the JSON response (metering spec §7.2). Health routes are not
 * decorated, so they stay untouched.
 *
 * This is also the receiver boundary for the SPLIT budget envelope (ADR 0013 §6): the optional
 * `budgetEnvelope` on the internal request body is wire JSON, so it is validated here — strictly
 * and fail-closed — before any provider can be built. A request without one behaves exactly as it
 * did before: nothing is stored and nothing downstream changes.
 */
import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import {
  parseAiBudgetEnvelope,
  parseAiBudgetGrantV2,
  parseLineAiInputEvidence,
  type AiUsageEntry,
  aiBudgetV2RepairsBefore,
} from '@watchdog-bms/contracts';
import { drainUsage, runWithUsageContext, type BudgetRequestState } from './usage-context';

type UsageBody = {
  companyId?: unknown;
  requestId?: unknown;
  messageText?: unknown;
  budgetEnvelope?: unknown;
  inputEvidence?: unknown;
  budgetGrantV2?: unknown;
  contractCapabilities?: unknown;
  publicAdmission?: { payerCompanyId?: unknown };
  userContext?: { companyId?: unknown };
};

/** `/v1/internal/ai/receipt-ocr?x=1` -> `receipt-ocr`: what the API's own meter calls this seam,
 *  so an evidence settlement and a response settlement stamp the same `sourceRoute`. */
export function internalAiSourceRoute(url: string | undefined): string {
  const path = (url ?? '').split('?')[0] ?? '';
  const marker = path.indexOf('/internal/ai/');
  if (marker < 0) return 'internal-ai';
  return path.slice(marker + '/internal/ai/'.length).split('/')[0] || 'internal-ai';
}

@Injectable()
export class AiUsageInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ body?: UsageBody; url?: string; originalUrl?: string }>();
    const body = request?.body;
  const raw = typeof body?.companyId === 'string' ? body.companyId
    : typeof body?.userContext?.companyId === 'string' ? body.userContext.companyId
      : body?.publicAdmission?.payerCompanyId;
    const companyId = typeof raw === 'string' && raw ? raw : undefined;
    const budget = readBudgetState(body, companyId, internalAiSourceRoute(request?.originalUrl ?? request?.url));

    // Nest's CallHandler is lazy: the route handler runs on SUBSCRIBE, not when handle() is
    // called. So the subscription itself has to happen inside the ALS run — otherwise every
    // provider call would append outside the store and each response would report nothing.
    // The store lives only as long as the request's async tree; the returned Subscription is
    // the teardown, so nothing is retained after unsubscribe.
    return new Observable((subscriber) =>
      runWithUsageContext({ companyId, ...(budget ? { budget } : {}) }, () =>
        next.handle().pipe(map(attachUsage)).subscribe(subscriber)),
    );
  }
}

/**
 * No `budgetEnvelope` ⇒ `undefined`, and every reader downstream keeps today's behaviour.
 *
 * An envelope that is present but does not rebuild from the declared bounds table for this
 * company is `invalid`, NOT absent: the provider decorator then refuses every call with
 * `AI_BUDGET_UNAVAILABLE` instead of running a provider whose cost nobody reserved (spec §12.3).
 * That includes the case where the body carries an envelope but no company at all.
 */
function readBudgetState(
  body: UsageBody | undefined,
  companyId: string | undefined,
  sourceRoute: string,
): BudgetRequestState | undefined {
  const hasV2 = body?.inputEvidence !== undefined || body?.budgetGrantV2 !== undefined || body?.contractCapabilities !== undefined;
  const hasLegacy = body?.budgetEnvelope !== undefined && body.budgetEnvelope !== null;
  if (hasV2 && hasLegacy) return { status: 'invalid' };
  if (hasV2) {
    const evidence = typeof body?.messageText === 'string'
      ? parseLineAiInputEvidence(body.inputEvidence, body.messageText)
      : undefined;
    const grant = parseAiBudgetGrantV2(body?.budgetGrantV2);
    const capabilities = body?.contractCapabilities;
    if (!companyId || !evidence || !grant || grant.payerCompanyId !== companyId
      || evidence.turnKey !== grant.turnKey || !Array.isArray(capabilities) || capabilities.length !== 2
      || capabilities.includes('input-evidence-v2') !== true || capabilities.includes('budget-envelope-v2') !== true) {
      return { status: 'invalid' };
    }
    return {
      status: 'active-v2', grant, inputDigest: evidence.joinedSha256, sourceRoute,
      ...(typeof body?.requestId === 'string' && body.requestId ? { requestId: body.requestId } : {}),
      calls: grant.nextOrdinal ?? 0, repairCount: aiBudgetV2RepairsBefore(grant),
    };
  }
  if (!hasLegacy) return undefined;
  const envelope = companyId ? parseAiBudgetEnvelope(body.budgetEnvelope, companyId) : undefined;
  if (!envelope) return { status: 'invalid' };
  return {
    status: 'active',
    envelope,
    sourceRoute,
    ...(typeof body.requestId === 'string' && body.requestId ? { requestId: body.requestId } : {}),
    calls: 0,
  };
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
