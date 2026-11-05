import {
  AI_BUDGET_REFUSAL_CODES,
  LINE_AI_ERROR_CODES,
  isAiBudgetPermanentRefusal,
  isAiBudgetRefusalCode,
  type AiBudgetRefusalCode,
  type AiBudgetScope,
  type LineAiRefusalReason,
} from '@watchdog-bms/contracts';

export const LINE_AI_TERMINAL_CLASSES = [
  'delivered',
  'clarification',
  'intentional_noop',
  'permission_refusal',
  'feature_disabled',
  'provider_unavailable',
  'timeout',
  // Spec §9.3: the company's monthly AI MONEY ran out and the turn answered that correctly. A policy
  // refusal that was delivered is not an AI outage, so it must not sit in `failed_terminal` with the
  // real failures — but it is also not `delivered`, so the money reason stays countable on its own.
  'budget_refusal',
  'delivery_pending',
  'failed_terminal',
] as const;

export type LineAiTerminalClass = (typeof LINE_AI_TERMINAL_CLASSES)[number];
export type LineAiGatewayFailureOutcome = {
  status: 'ai_error' | 'provider_unavailable' | 'rate_limited' | 'ai_budget_exceeded' | 'ai_budget_insufficient';
  errorCode: string;
  replyKind: 'timeout' | 'unavailable' | 'rate_limited' | 'budget_exceeded' | 'budget_unavailable';
  /** Present only for a refusal our OWN money gate produced. */
  budgetCode?: AiBudgetRefusalCode;
  budgetScope?: AiBudgetScope;
};

/** The durable statuses a money refusal ends on. Separate from the generic failures so the row (and
 *  the alarm) can tell "we said no on purpose" from "the assistant broke". */
const BUDGET_REFUSAL_STATUSES = new Set(['ai_budget_exceeded', 'ai_budget_insufficient']);

/**
 * Our OWN money gate's 429 — and only that. The body code has to be one `companyAiBudgetRefusal`
 * emits; any other 429, provider error or similarly named message keeps its existing handling
 * (spec §9.1: a lookalike error is not authority to change a budget answer).
 */
export function knownAiBudgetRefusal(error: unknown): { code: AiBudgetRefusalCode; budgetScope?: AiBudgetScope } | null {
  const status = typeof (error as { getStatus?: unknown })?.getStatus === 'function'
    ? (error as { getStatus: () => number }).getStatus()
    : undefined;
  if (status !== 429) return null;
  const response = typeof (error as { getResponse?: unknown })?.getResponse === 'function'
    ? (error as { getResponse: () => unknown }).getResponse()
    : undefined;
  if (!response || typeof response !== 'object') return null;
  return knownAiBudgetResponse(response as { code?: unknown; budgetScope?: unknown });
}

/** Only use on an authenticated gateway response, never on customer/provider text. */
export function knownAiBudgetResponse(response: { code?: unknown; errorCode?: unknown; budgetScope?: unknown }): { code: AiBudgetRefusalCode; budgetScope?: AiBudgetScope } | null {
  const code = response.errorCode ?? response.code;
  const { budgetScope } = response;
  if (!isAiBudgetRefusalCode(typeof code === 'string' ? code : undefined)) return null;
  return {
    code: code as AiBudgetRefusalCode,
    // Only an explicit, recognised scope is carried — never inferred.
    ...(budgetScope === 'TOTAL' || budgetScope === 'CHAT' || budgetScope === 'OCR' ? { budgetScope } : {}),
  };
}

const NON_TERMINAL_STATUSES = new Set(['received', 'processing', 'response_ready']);
const CLARIFICATION_STATUSES = new Set([
  'clarification_required',
  'needs_company_selection',
  'company_context_selection_invalid',
]);
const PERMISSION_REFUSAL_STATUSES = new Set([
  'ai_opt_out',
  'company_context_forbidden',
  'forbidden',
  'legal_acceptance_required',
  'no_membership',
  // P29: the company's plan term ran out and the sweep disabled it. A kept status of its own so the
  // durable row can tell "term expired" from "never a member", but a refusal like the rest — an
  // expired subscription answered correctly is not an AI outage on the alarm that watches
  // `failed_terminal`.
  'plan_term_expired',
  // J1/R14: the shop has no usable package and was answered with the "เลือกแพ็กเกจ" card. Same
  // class as the expiry above — a policy refusal the customer received, never an AI outage.
  'package_required',
  'unlinked',
]);
const DELIVERED_STATUSES = new Set([
  'completed',
  'free_expense_month_summary',
  'company_context_listed',
  'company_context_switched',
]);

/** Unknown terminal statuses fail visibly into `failed_terminal`; only the explicit in-flight
 * states above are allowed to produce no terminal metric. This keeps new error branches from
 * silently disappearing from reconciliation. */
export function classifyLineAiTerminalOutcome(
  status: string,
  errorCode?: string | null,
): LineAiTerminalClass | null {
  if (NON_TERMINAL_STATUSES.has(status)) return null;
  // Delivery truth outranks semantics (spec §9.3): a refusal the customer never received must keep
  // looking broken, so these two stay AHEAD of the budget branch below.
  if (status === 'delivery_pending') return 'delivery_pending';
  if (status === 'failed_terminal' || status.startsWith('orphan_')) return 'failed_terminal';
  if (BUDGET_REFUSAL_STATUSES.has(status)) return 'budget_refusal';
  if (
    status === 'rate_limited'
    || status === 'batched'
    || status === 'duplicate_media_pending'
    || status === 'expense_action_duplicate'
    || status === 'safety_crisis'
    || status === 'privacy_rumor'
    // An intentional 24h AI pause the customer asked for by tapping "ติดต่อเจ้าหน้าที่". Nothing
    // failed and nothing is owed on this turn; without this it fell through to `failed_terminal`
    // and every support handover looked like an AI outage.
    || status === 'support_follow_up'
  ) {
    return 'intentional_noop';
  }
  // `launch_route_closed` is the P3 kill switch (an operator closed `ai_line_assistant`), kept as a
  // distinct STATUS so the durable row and the audit trail can tell a planned CLOSE from a company
  // that never enabled the feature — but classified here as `feature_disabled` so a drill does not
  // register as an outage on the AI-failure alarm.
  // `unsupported_yet` (spec §5.3) is the same operational class as `unsupported_module`: the turn
  // was answered honestly and nothing failed. Only the sentence the customer read differs.
  if (status === 'feature_disabled' || status === 'unsupported_module' || status === 'unsupported_yet' || status === 'launch_route_closed') return 'feature_disabled';
  if (status === 'ai_timeout' || /TIMEOUT/.test(errorCode ?? '')) return 'timeout';
  if (status === 'unavailable_delivered' || status === 'provider_unavailable') return 'provider_unavailable';
  // Spec §9.3 "หากเก็บรูปไว้รอคำตอบให้รักษา clarification state โดยแนบ budget reason": an image turn
  // that kept the picture and asked the numbered question is still WAITING on the customer, so the
  // workflow class stays `clarification` and the money reason rides along as the errorCode. Only a
  // turn with nothing left to answer is reclassified below.
  if (CLARIFICATION_STATUSES.has(status)) return 'clarification';
  if (PERMISSION_REFUSAL_STATUSES.has(status)) return 'permission_refusal';
  if (DELIVERED_STATUSES.has(status) || status.startsWith('staff_menu_')) return 'delivered';
  // A delivered refusal whose durable reason is a permanent money refusal, on a status this
  // classifier does not otherwise know. Last, so it can only ever rescue rows that would have been
  // counted as an outage — never reclassify one of the explicit classes above.
  if (isAiBudgetPermanentRefusal(errorCode)) return 'budget_refusal';
  return 'failed_terminal';
}

export function terminalStatusForLineTurn(input: {
  refused: boolean;
  refusalReason?: LineAiRefusalReason;
  errorCode?: string;
}): string {
  if (!input.refused) return 'completed';
  if (input.refusalReason === 'ai_timeout' || /TIMEOUT/.test(input.errorCode ?? '')) return 'ai_timeout';
  if (input.refusalReason === 'tool_unavailable') return 'unavailable_delivered';
  if (input.refusalReason === 'feature_disabled') return 'feature_disabled';
  if (input.refusalReason === 'unsupported_module') return 'unsupported_module';
  // A distinct STATUS so the durable row can tell "we do not cover that" from "not on LINE yet" —
  // the second is a backlog signal. Without this the reason falls to `refused_untyped`, which
  // `classifyLineAiTerminalOutcome` reads as `failed_terminal`, i.e. a false AI-outage alarm.
  if (input.refusalReason === 'unsupported_yet') return 'unsupported_yet';
  if (input.refusalReason === 'ambiguous_company') return 'needs_company_selection';
  if (input.refusalReason === 'safety_crisis' || input.refusalReason === 'privacy_rumor') {
    return input.refusalReason;
  }
  if (input.refusalReason === 'line_delivery_failure') return 'line_delivery_failure';
  if (['forbidden', 'unlinked_user', 'mutation_blocked'].includes(input.refusalReason ?? '')) {
    return 'forbidden';
  }
  return 'refused_untyped';
}

export function classifyLineAiGatewayFailure(error: unknown): LineAiGatewayFailureOutcome {
  const status = typeof (error as { getStatus?: unknown })?.getStatus === 'function'
    ? (error as { getStatus: () => number }).getStatus()
    : undefined;
  const response = typeof (error as { getResponse?: unknown })?.getResponse === 'function'
    ? (error as { getResponse: () => unknown }).getResponse()
    : undefined;
  const code = (error as { code?: unknown })?.code
    ?? (response && typeof response === 'object' ? (response as { code?: unknown }).code : undefined);
  // G-05: the monthly budget running out is NOT congestion. It used to collapse into `rate_limited`,
  // whose reply asks the shop to wait and try again — advice that can never work this month, and
  // that invites more spending attempts. It gets its own outcome and its own answer.
  //
  // Spec §9.1 "Code/scope ต้องอยู่ใน durable result": the errorCode used to be RATE_LIMITED here, so
  // the durable row said "rate limited" for a money refusal and the reason was gone by the time
  // anyone replayed it. The real budget code is stored instead — the same string every other seam
  // carries — and the scope rides beside it.
  const budget = knownAiBudgetRefusal(error);
  if (budget && isAiBudgetPermanentRefusal(budget.code)) {
    return {
      status: budget.code === AI_BUDGET_REFUSAL_CODES.insufficient ? 'ai_budget_insufficient' : 'ai_budget_exceeded',
      errorCode: budget.code,
      replyKind: 'budget_exceeded',
      budgetCode: budget.code,
      ...(budget.budgetScope ? { budgetScope: budget.budgetScope } : {}),
    };
  }
  // The meter itself could not be read. Not exhaustion, not congestion: say it could not be checked.
  if (budget?.code === AI_BUDGET_REFUSAL_CODES.unavailable) {
    return {
      status: 'provider_unavailable',
      errorCode: budget.code,
      replyKind: 'budget_unavailable',
      budgetCode: budget.code,
      ...(budget.budgetScope ? { budgetScope: budget.budgetScope } : {}),
    };
  }
  if (status === 429 && code !== 'AI_BUDGET_UNAVAILABLE') {
    return { status: 'rate_limited', errorCode: LINE_AI_ERROR_CODES.RATE_LIMITED, replyKind: 'rate_limited' };
  }
  const message = error instanceof Error ? error.message : '';
  if (code === 'AI_GATEWAY_TIMEOUT' || message === 'AI_GATEWAY_TIMEOUT') {
    return { status: 'ai_error', errorCode: LINE_AI_ERROR_CODES.AI_TIMEOUT, replyKind: 'timeout' };
  }
  return {
    status: 'provider_unavailable',
    errorCode: LINE_AI_ERROR_CODES.PROVIDER_UNAVAILABLE,
    replyKind: 'unavailable',
  };
}

/**
 * What happened to the customer's picture on this turn. Structured so a budget refusal that KEPT the
 * file can be told apart from one that did not — never a money amount, never company config
 * (spec §9.3). `redelivered` means the same message arrived twice and the first copy is still parked;
 * `not_stored_open_question` means a DIFFERENT picture was turned away because one question is
 * already open, so nothing of it was stored.
 */
export type LineAiTerminalMediaState =
  | 'retained'
  | 'save_failed'
  | 'redelivered'
  | 'not_stored_open_question'
  | 'not_stored_no_permission';

export function emitLineAiTerminalOutcome(
  logger: { log: (fields: Record<string, unknown>) => void },
  input: {
    webhookEventId: string;
    status: string;
    errorCode?: string | null;
    companyId?: string | null;
    budgetScope?: AiBudgetScope | null;
    mediaState?: LineAiTerminalMediaState | null;
  },
): void {
  const terminalClass = classifyLineAiTerminalOutcome(input.status, input.errorCode);
  if (!terminalClass) return;
  try {
    logger.log({
      msg: 'line.ai.terminal',
      surface: 'employee_oa',
      webhookEventId: input.webhookEventId,
      companyId: input.companyId ?? null,
      status: input.status,
      terminalClass,
      errorCode: input.errorCode ?? null,
      // Emitted only when the turn really carried them, so the metric filters above stay unchanged
      // and no row gains a field it has no evidence for.
      ...(input.budgetScope ? { budgetScope: input.budgetScope } : {}),
      ...(input.mediaState ? { mediaState: input.mediaState } : {}),
    });
  } catch {
    // Telemetry cannot change the outcome it observes.
  }
}
