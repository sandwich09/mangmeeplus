# Customer Journey Signal Triage

Owner role: Platform Operations, with the catalogued journey owner  
Last reviewed: 2026-08-26  
Trigger: missing/duplicate terminal signal, critical terminal failure, abnormal latency, or dashboard gap

## Preconditions

- Open `watchdog-bms-<environment>-customer-journeys`; a dashboard body mismatch must fail `runtime-alarms.sh verify` before incident interpretation.
- Use a synthetic correlation ID or an access-controlled real correlation ID; do not paste tenant/customer payloads into tickets or metric labels.
- Confirm the catalog row is `LIVE`. A `PARTIAL` or `PLANNED` row is an implementation gap, not proof of a live outage.
- Do not retry a financial mutation until source state and idempotency key are verified.

## Common response

1. Identify `journey`, `stage`, time window, environment, correlation ID, and terminal outcome.
2. Compare accepted and terminal counts. Record missing, duplicate, and orphan correlations separately.
3. Follow the stage section below to locate the durable source of truth.
4. Recover with the existing idempotent retry/reconciliation path. Never create a second signup, company, user, accounting document, expense confirmation, or outbox event to repair telemetry.
5. Verify exactly one terminal state and observable customer recovery.
6. Record redacted evidence: Git SHA, environment, synthetic correlation ID, count/latency, failure class, recovery result, and owner.

Stop and escalate when the durable source state is ambiguous, a retry could duplicate a financial/customer mutation, credentials/provider policy are missing, or recovery requires production mutation outside an approved runbook.

## Failure routing

### API timeout and 5xx

Use the request ID to join the `request` log, service/task health, dependency health, and the current
immutable release. Probe only a read-only route. Roll back or forward-fix through the release runbook;
never replay a business mutation merely because the client saw a timeout or 5xx.

### Redis rate limit unavailable

Confirm `api.rate_limit.store_degraded` occurred once on the transition and the local limiter is still
protecting the process. Restore Redis connectivity, then verify a healthy shared-store request. Do not
restart repeatedly to manufacture recovery evidence or suppress the transition alarm.

### LINE invalid signature

Confirm `line.webhook.signature_invalid`, the endpoint/channel binding, and secret version without
printing the secret. A forged request must enqueue zero events. After configuration repair, use LINE's
original signed redelivery; do not construct a replacement customer message.

### LINE provider error

Inspect the durable LINE ledger row and terminal class (`delivery_pending` or `failed_terminal`). Use the
existing drain/orphan recovery path with the original row identity. Do not create a second AI turn or
business mutation to compensate for a failed reply/push.

### Database audit and outbox failure

For `audit.persist.failed`, verify the business source state before interpreting the request result: the
post-commit audit path deliberately does not turn a committed mutation into a 500. For outbox failures,
inspect attempts, claim token, backoff, and DEAD state. Automatic recovery stops at DEAD until a governed
reconciler exists.

## Stage routing

### Official signup receive

Inspect signature/rate-limit/idempotency classification and the durable signup request. Replay only the same signed synthetic request and key. Escalate `storage_failed` or conflicting payload hashes to Growth Platform.

### Owner claim

Inspect token expiry/revocation/use state and claim CAS outcome. Never expose or reuse the raw claim token. Escalate replay or credential conflict to Identity & Access.

### Tenant provision

Inspect signup state and existing company/user/membership before retry. Resume the provision-once workflow; never call low-level repositories to fill a partial company manually.

### Claim email delivery

Inspect the delivery-attempt state and SES message/event reference. Treat bounce, complaint, suppression, and provider failure as distinct. Do not resend until the single-attempt/idempotency and suppression policy are known.

### LINE login

Join `journey.line.login.accepted` and `.terminal` by `requestId`, then inspect verifier outcome,
linked canonical identity, active user/membership, and session issuance audit. Never match by display
name, email, photo, or phone number.

### LINE link

Join `journey.line.link.accepted` and `.terminal` by `requestId`, then inspect canonical external
identity, provider/channel binding, link-token state, and conflict disposition. Do not reassign or
revive a disabled identity outside the approved recovery flow.

### Receipt intake

Join `journey.receipt.intake.accepted` and `.terminal` for a completion call, then inspect attachment
completion, `expense.receipt_uploaded` outbox row, workflow inbox, and expense source state. A
PENDING_UPLOAD intent that never called completion is a known `PARTIAL` gap, not a missing terminal
from this request boundary. A `DEAD` row requires outbox recovery; do not upload a duplicate receipt.

### Receipt OCR

Join `journey.receipt.ocr.accepted` and `.terminal` by `requestId`, then inspect request audit,
attachment safety/size, provider result, stale-write protection, and the expense review state. OCR
output is a suggestion until deterministic validation and human confirmation pass.

### LINE AI answer

Join `line.ai.accepted` and `line.ai.terminal` by `webhookEventId`. Classify intentional no-op, permission refusal, feature-disabled, and `budget_refusal` separately from provider/timeout/delivery failure. Preserve the permission-checked API/tool boundary.

`budget_refusal` is neutral, not an outage: the company's monthly AI money reached its cap (or could not cover the job) and the turn said so through delivery. `errorCode` carries the money code and `budgetScope` the ceiling that closed. Do not raise a provider incident, do not reset the meter, and do not change a company budget from here — a cap change is a separate authorised admin action with its own audit. If the same rows show `delivery_pending` instead, the refusal did NOT reach the customer and is a delivery problem, which outranks the money reason. `mediaState` says whether the customer's picture was kept (`retained`), turned away (`not_stored_open_question`, `not_stored_no_permission`) or lost (`save_failed`).

### Outbox worker drain

Inspect `OutboxEvent.status`, attempts, lease/claim token, `lastError`, and DEAD count. Use the fenced claim/publish/fail path; never update a row by ID without its current claim token.

### Sales confirmation

Join `journey.sales.confirmation.accepted` and `.terminal` by `requestId`. Verify the accounting
document is durably issued and its document number committed before touching the outbox row. A retry
must reuse existing document/outbox identity and must not issue a second legal document.

### Expense confirmation

Join `journey.expense.confirmation.accepted` and `.terminal` by `requestId`. Verify expense status,
number reservation/commit, tax snapshot, duplicate state, journal/posting state, and the
`expense.confirmed` outbox row. Never reconfirm or repost to repair a missing signal.

## Verification and rollback

- Success: one accepted correlation, one terminal classification, durable source state matches the terminal, and customer-visible recovery is verified.
- Dashboard success: source-controlled body matches exactly; a missing metric is `UNKNOWN`, not success, and a `PARTIAL`/`PLANNED` row is never colored as healthy.
- Rollback: telemetry-only changes may be reverted; never roll back or rewrite durable financial/customer state merely to align a dashboard.
- Evidence must contain no secrets, raw prompts, document content, tax IDs, email addresses, LINE user IDs, or tenant IDs in metric dimensions.
