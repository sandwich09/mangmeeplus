import { LINE_AI_ERROR_CODES, type LineAiRefusalReason } from '@watchdog-bms/contracts';

export const LINE_AI_TERMINAL_CLASSES = [
  'delivered',
  'clarification',
  'intentional_noop',
  'permission_refusal',
  'feature_disabled',
  'provider_unavailable',
  'timeout',
  'delivery_pending',
  'failed_terminal',
] as const;

export type LineAiTerminalClass = (typeof LINE_AI_TERMINAL_CLASSES)[number];
export type LineAiGatewayFailureOutcome = {
  status: 'ai_error' | 'provider_unavailable' | 'rate_limited' | 'ai_budget_exceeded';
  errorCode: string;
  replyKind: 'timeout' | 'unavailable' | 'rate_limited' | 'budget_exceeded';
};

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
  'unlinked',
]);
const DELIVERED_STATUSES = new Set([
  'completed',
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
  if (status === 'delivery_pending') return 'delivery_pending';
  if (status === 'failed_terminal' || status.startsWith('orphan_')) return 'failed_terminal';
  if (
    status === 'rate_limited'
    || status === 'batched'
    || status === 'duplicate_media_pending'
    || status === 'safety_crisis'
    || status === 'privacy_rumor'
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
  if (CLARIFICATION_STATUSES.has(status)) return 'clarification';
  if (PERMISSION_REFUSAL_STATUSES.has(status)) return 'permission_refusal';
  if (DELIVERED_STATUSES.has(status) || status.startsWith('staff_menu_')) return 'delivered';
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
  if (status === 429 && code === 'AI_MONTHLY_BUDGET_EXCEEDED') {
    return {
      status: 'ai_budget_exceeded',
      errorCode: LINE_AI_ERROR_CODES.RATE_LIMITED,
      replyKind: 'budget_exceeded',
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

export function emitLineAiTerminalOutcome(
  logger: { log: (fields: Record<string, unknown>) => void },
  input: { webhookEventId: string; status: string; errorCode?: string | null; companyId?: string | null },
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
    });
  } catch {
    // Telemetry cannot change the outcome it observes.
  }
}
