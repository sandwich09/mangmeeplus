/**
 * L-14: stable, dotted security-event names for the production CloudWatch alarm.
 *
 * The alarm's metric filter (infra/prod-ecs-express/deploy.sh) already keys on
 * `$.riskLevel = "CRITICAL" || $.riskLevel = "HIGH" || $.msg = "ai.provider.failure" ||
 * $.msg = "ai.tool.invoke.denied"`. Emitting a root-level `riskLevel` therefore covers every
 * event here with NO infrastructure change — which is why the emitter, not the deploy script,
 * is the fix. Free-text English sentences cannot be alarm keys; these names are the contract.
 *
 * This file is duplicated byte-identically in apps/api and apps/ai-gateway (the existing
 * `NestPinoLoggerBridge` precedent) and guarded by a cross-app test. Edit both or neither.
 */
export const SECURITY_EVENT = {
  authLoginDenied: 'auth.login.denied',
  authRateLimitExceeded: 'auth.rate_limit.exceeded',
  authPasswordResetDenied: 'auth.password_reset.denied',
  authSessionRefreshReuse: 'auth.session.refresh_reuse_detected',
  apiRateLimitStoreDegraded: 'api.rate_limit.store_degraded',
  lineWebhookSignatureInvalid: 'line.webhook.signature_invalid',
  workflowWebhookBlocked: 'workflow.webhook.blocked',
  attachmentUploadRejected: 'attachment.upload.rejected',
  aiToolInvokeDenied: 'ai.tool.invoke.denied',
  /**
   * P12-3b: a LINE deep-link handoff token was presented and refused. The token is a bearer
   * credential in a chat log, so a burst of invalid ones is exactly the shape guessing takes —
   * the same reason `auth.login.denied` exists. The refusal reason stays in audit; this line
   * carries only the alarm-shaped name.
   */
  authLineHandoffDenied: 'auth.line_handoff.denied',
  /**
   * Metering spec §7.6. A company at or over its effective monthly AI budget was refused at an
   * AI seam; the operator alert channel for the admin-only scope this feature ships with.
   */
  aiCompanyBudgetExceeded: 'ai.company_budget.exceeded',
  /**
   * Metering spec §7.6. Month-to-date spend just crossed 80% of the effective budget — once per
   * company-month by construction (the unique aggregate row serializes increments). HIGH, not a
   * quieter level: `SecurityEventRisk` has no MEDIUM and the deployed metric filter matches only
   * HIGH/CRITICAL, so anything quieter would be invisible to the one alarm that exists.
   */
  aiCompanyBudgetThreshold: 'ai.company_budget.threshold',
} as const;

export type SecurityEventName = (typeof SECURITY_EVENT)[keyof typeof SECURITY_EVENT];
export type SecurityEventRisk = 'HIGH' | 'CRITICAL';

/**
 * Emits one alarm-shaped line: `msg` is the event name, `riskLevel` is root-level.
 *
 * Takes a `{ warn }` duck type rather than a pino instance so guards, middleware, and Nest's
 * `Logger` (bridged to pino by M-02) can all emit without extra wiring, and so a spec can assert
 * the emitted object directly. Telemetry must never break the control it observes, so any logger
 * failure is swallowed.
 */
export function emitSecurityEvent(
  logger: { warn: (obj: Record<string, unknown>) => void },
  name: SecurityEventName,
  riskLevel: SecurityEventRisk,
  fields?: Record<string, unknown>,
): void {
  try {
    logger.warn({ ...fields, msg: name, riskLevel });
  } catch {
    // A failed security log must not turn a denial into a 500.
  }
}
