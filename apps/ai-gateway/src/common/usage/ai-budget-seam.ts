/**
 * The gateway's client for the two API-owned money seams (ADR 0013 §6, spec §12.3/§12.6):
 * `POST /internal/ai/budget-step` before every provider call after the first, and
 * `POST /internal/ai/budget-settle` with that invocation's evidence afterwards.
 *
 * Same transport and the same configuration `erp-tool.client.ts` already uses — `fetch`, the
 * shared `X-Internal-Secret` header, `ERP_CORE_INTERNAL_URL`, `AI_TOOL_TIMEOUT_MS` — because the
 * gateway still has NO database access and no second way to reach the API. Nothing but ids,
 * counters and typed codes crosses: never a prompt, a cap, a balance or a company name.
 */
import { AI_BUDGET_REFUSAL_CODES, parseAiBudgetEnvelope, type AiBudgetEnvelope, type AiBudgetRefusalCode, type AiBudgetScope, type AiUsageEntry } from '@watchdog-bms/contracts';

export type AiBudgetStepOutcome =
  | { ok: true; envelope: AiBudgetEnvelope }
  | { ok: false; code: AiBudgetRefusalCode; budgetScope: AiBudgetScope };

export type AiBudgetSettleOutcome = 'recorded' | 'rejected' | 'unreachable';

/** What the decorator needs; a fake of this is all a test has to supply. */
export type AiBudgetSeam = {
  step(input: {
    companyId: string;
    attemptKey: string;
    stepKind: string;
    ordinal: number;
    monthKey: string;
  }): Promise<AiBudgetStepOutcome>;
  settle(input: {
    invocationKey: string;
    sourceRoute: string;
    requestId?: string;
    entry: AiUsageEntry;
  }): Promise<AiBudgetSettleOutcome>;
};

export type AiBudgetSeamConfig = {
  /** `ERP_CORE_INTERNAL_URL`, already carrying the API's `/v1` prefix. */
  baseUrl: string;
  secret: string | undefined;
  timeoutMs: number;
};

/** `settled`, `duplicate` and `settled-anomaly` all mean the money IS recorded (ADR 0013 §11.6). */
const RECORDED = new Set(['settled', 'duplicate', 'settled-anomaly']);
/** One retry only: the money path must not turn a slow API into a long provider stall. */
const SETTLE_ATTEMPTS = 2;
const SETTLE_RETRY_MS = 200;

/**
 * A refusal the gateway could not read is `unavailable`, never a money answer: the same rule the
 * API's own seam applies to an undeclared step kind. Waiting does not open it, so it is not `busy`.
 */
function refused(code: unknown, scope: unknown): AiBudgetStepOutcome {
  const known = typeof code === 'string'
    && (Object.values(AI_BUDGET_REFUSAL_CODES) as string[]).includes(code);
  return {
    ok: false,
    code: known ? (code as AiBudgetRefusalCode) : AI_BUDGET_REFUSAL_CODES.unavailable,
    budgetScope: scope === 'CHAT' || scope === 'OCR' ? scope : 'TOTAL',
  };
}

export function createAiBudgetSeam(
  config: AiBudgetSeamConfig,
  log: (line: Record<string, unknown>) => void,
  fetchImpl: typeof fetch = fetch,
): AiBudgetSeam {
  const post = async (path: string, body: unknown): Promise<{ ok: boolean; json?: unknown }> => {
    if (!config.secret) return { ok: false };
    try {
      const response = await fetchImpl(`${config.baseUrl}/internal/ai/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': config.secret },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (!response.ok) return { ok: false };
      return { ok: true, json: await response.json() };
    } catch {
      // Ids only — an exception message from fetch carries the URL, never the secret header, but
      // there is nothing here worth logging beyond the caller's own typed outcome.
      return { ok: false };
    }
  };

  return {
    async step(input) {
      const result = await post('budget-step', input);
      if (!result.ok) {
        log({ msg: 'ai.budget.step_unreachable', stepKind: input.stepKind, ordinal: input.ordinal });
        return refused(undefined, undefined);
      }
      const body = (result.json ?? {}) as Record<string, unknown>;
      if (body['ok'] !== true) return refused(body['code'], body['budgetScope']);
      // The step response decides the next provider call's money, so it is validated exactly as
      // strictly as the request body was: an envelope that does not rebuild is `unavailable`.
      const envelope = parseAiBudgetEnvelope(body['envelope'], input.companyId, input.ordinal);
      if (!envelope || envelope.stepKind !== input.stepKind || envelope.attemptKey !== input.attemptKey) {
        log({ msg: 'ai.budget.step_envelope_invalid', stepKind: input.stepKind, ordinal: input.ordinal });
        return refused(undefined, undefined);
      }
      return { ok: true, envelope };
    },

    async settle(input) {
      const body = {
        invocationKey: input.invocationKey,
        sourceRoute: input.sourceRoute,
        ...(input.requestId ? { requestId: input.requestId } : {}),
        usage: {
          modelId: input.entry.modelId,
          tag: input.entry.tag,
          ok: input.entry.ok,
          inputTokens: input.entry.inputTokens,
          outputTokens: input.entry.outputTokens,
          cacheReadInputTokens: input.entry.cacheReadInputTokens,
          cacheWriteInputTokens: input.entry.cacheWriteInputTokens,
          ...(input.entry.usageBasis ? { usageBasis: input.entry.usageBasis } : {}),
        },
      };
      for (let attempt = 1; attempt <= SETTLE_ATTEMPTS; attempt += 1) {
        const result = await post('budget-settle', body);
        if (result.ok) {
          const outcome = (result.json as { result?: unknown } | undefined)?.result;
          if (typeof outcome === 'string' && RECORDED.has(outcome)) return 'recorded';
          // A rejection is a state problem the API already logged and alerted on; retrying it would
          // only repeat it. The hold stays DISPATCHED -> UNRESOLVED, which is the designed
          // conservative outcome (ADR 0013 §6): money is never released without evidence.
          log({ msg: 'ai.budget.settle_rejected', sourceRoute: input.sourceRoute, result: String(outcome) });
          return 'rejected';
        }
        if (attempt < SETTLE_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, SETTLE_RETRY_MS));
      }
      // Never fails the business call (ADR 0013 §6 step 4): the reservation stays held instead.
      log({ msg: 'ai.budget.settle_unreachable', sourceRoute: input.sourceRoute, attempts: SETTLE_ATTEMPTS });
      return 'unreachable';
    },
  };
}
