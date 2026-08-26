# Customer Journey Signal Triage

Owner role: Platform Operations, with the catalogued journey owner  
Last reviewed: 2026-08-26  
Trigger: missing/duplicate terminal signal, critical terminal failure, abnormal latency, or dashboard gap

## Preconditions

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

Inspect verifier outcome, linked canonical identity, active user/membership, and session issuance audit. Never match by display name, email, photo, or phone number.

### LINE link

Inspect canonical external identity, provider/channel binding, link-token state, and conflict disposition. Do not reassign or revive a disabled identity outside the approved recovery flow.

### Receipt intake

Inspect attachment completion, `expense.receipt_uploaded` outbox row, workflow inbox, and expense source state. A `DEAD` row requires outbox recovery; do not upload a duplicate receipt as a telemetry workaround.

### Receipt OCR

Inspect request audit, attachment safety/size, provider result, stale-write protection, and the expense review state. OCR output is a suggestion until deterministic validation and human confirmation pass.

### LINE AI answer

Join `line.ai.accepted` and `line.ai.terminal` by `webhookEventId`. Classify intentional no-op, permission refusal, and feature-disabled separately from provider/timeout/delivery failure. Preserve the permission-checked API/tool boundary.

### Outbox worker

Inspect `OutboxEvent.status`, attempts, lease/claim token, `lastError`, and DEAD count. Use the fenced claim/publish/fail path; never update a row by ID without its current claim token.

### Sales confirmation

Verify the accounting document is durably issued and its document number committed before touching the outbox row. A retry must reuse existing document/outbox identity and must not issue a second legal document.

### Expense confirmation

Verify expense status, number reservation/commit, tax snapshot, duplicate state, journal/posting state, and the `expense.confirmed` outbox row. Never reconfirm or repost to repair a missing signal.

## Verification and rollback

- Success: one accepted correlation, one terminal classification, durable source state matches the terminal, and customer-visible recovery is verified.
- Rollback: telemetry-only changes may be reverted; never roll back or rewrite durable financial/customer state merely to align a dashboard.
- Evidence must contain no secrets, raw prompts, document content, tax IDs, email addresses, LINE user IDs, or tenant IDs in metric dimensions.
