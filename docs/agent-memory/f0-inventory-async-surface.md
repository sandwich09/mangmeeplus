# F0 Inventory — Async Execution Surfaces (Workers / Outbox / Scanners / Webhooks)

- Generated: 2026-07-31
- Git HEAD: `ba91c102c49ab7964697a540a2f63d42a497aa6a` (branch `develop`)
- Lane: S3 (async surface inventory), phase F0 of `docs/plans/feature-entitlement-decoupling-plan.md` §3 F0
- Method: mechanical grep/read survey of `apps/workers`, `apps/api` internal controllers + sweep use-cases, and every `@Public()` inbound route. No design, no code changes.
- Machine-readable twin: `f0/s3-async.json` (63 row objects, same fields)
- Scope note: `apps/ai-gateway` contains **no** async surface (no bullmq, no cron, no interval scheduler). No infra-level EventBridge/cron rule exists — grep over `infra/`, `deploy/`, `scripts/`, `.github/` for schedule expressions returned nothing. Every schedule in this system is a BullMQ repeatable registered in-process at worker boot.

## 1. Summary counts

| Kind | Rows | entitlementCheck.present = false | BLOCKED |
|---|---:|---:|---:|
| WORKER | 11 | 11 | 3 |
| CRON | 1 | 1 | 0 |
| SCANNER | 26 | 25 | 8 |
| OUTBOX_CONSUMER | 1 | 1 | 0 |
| OUTBOX_PRODUCER | 11 | 11 | 2 |
| WEBHOOK | 7 | 6 | 4 |
| SYSTEM_CONTEXT | 6 | 5 | 0 |
| **Total** | **63** | **60** | **17** |

**60 of 63 async surfaces have no entitlement check.** These are the launch-gate / runoff rows.

The three surfaces that *do* check:

1. `expense-auto-post.use-case.ts:85-101` — filters companies by `double_entry_ledger` AND `expense_auto_post`, and uses the entitlement row's `updatedAt` as a work-eligibility floor (`:107-108`). **The reference pattern.**
2. `process-line-webhook.use-case.ts:407-412` — `lineAssistantDisabled()`, enforced at `:596` and `:1200`. The plan's verified seam.
3. `EXPENSE_AUTO_POST_WORKER_PERMISSIONS` — inherits (1)'s upstream filter.

## 2. Structural finding (drives every other row)

Entitlement filtering exists in exactly **one** place in this codebase:

```
prisma-permission-resolver.repository.ts:72-73
  const entitled = await loadEntitledFeatureKeys(this.prisma, membership.companyId);
  const permissions = filterPermissionsByEntitlement(grantedPermissions, entitled);
```

`systemWorkerContext` (`apps/api/src/modules/auth/domain/logic/system-worker-context.ts:9-27`) builds a `RequestContext` **directly** — `roles: []`, `permissions: [...input.permissions]` verbatim — and never calls the resolver. Therefore **no worker, scanner, sweep or outbox consumer inherits entitlement enforcement**. It must be added as an explicit company-selection predicate (the expense-auto-post shape) at each site.

Worse, eleven CRM scanners build **no RequestContext at all** (repo-direct with `actorType: 'SYSTEM'`), so there is not even a permission list to filter.

Two additional bypasses are load-bearing:

- `WORKER_NOTIFICATION_PERMISSIONS` grants `dashboard.*` and `inventory.product.read`, both of which `filterPermissionsByEntitlement` *would* strip via the prefix rules at `feature-gate.logic.ts:40,43`.
- `line.ai.query` and `ai.tool.invoke` live in the **ungated** `pack.core.basics` (`feature-gate.logic.ts:35-36`), so `ai_line_assistant = false` does not strip them. The synchronous webhook compensates with `lineAssistantDisabled()`; the asynchronous ledger drain and the gateway tool bridge do not.

Fail-open convention throughout: `loadEntitledFeatureKeys` returns `null` for a company with zero entitlement rows, and every consumer treats `null` as "everything entitled" (`entitlement.helper.ts:14`, `feature-gate.logic.ts:76`, `process-line-webhook.use-case.ts:411`).

## 3. WORKER (11)

All live in the single `apps/workers` ECS service; `main.ts:33-51` starts all nine BullMQ workers together behind one `QUEUE_ENABLED` flag. There is no per-worker or per-tenant enable switch.

| Name | Trigger | Mutates / external effects | Entitlement | Retry | Feature | Status |
|---|---|---|---|---|---|---|
| `main` bootstrap + heartbeat<br>`main.ts:14-52` | process start; `setInterval` 30s | HTTP health server | absent (`:33-51`) | none | PLATFORM | RESOLVED |
| `startNotificationWorker`<br>`notification-worker.ts:18-145` | queue `notifications`, concurrency 5 | POST `/internal/notifications/*`; indirect LINE push | absent (`:75-105`) | BullMQ defaults; `attempts:5` + exp 60s only on the daily cron (`:69-71`) | dashboard_notifications | RESOLVED |
| `startWorkflowWorker`<br>`workflow-worker.ts:15-75` | queue `workflow`, concurrency 2; outbox.drain 30s, 3× scan 15m, action.retry 60s | POST `/internal/workflow/*` | absent (`:41-74`) | BullMQ defaults | workflow_automation | RESOLVED |
| `startAiDraftWorker`<br>`ai-draft-worker.ts:18-67` | repeatable `draft.drain` 15s | AI model calls (billable) | absent (`:50-66`) | `scheduleWithRetry`; 10min timeout | ai_line_assistant | RESOLVED |
| `startCrmSlaWorker`<br>`crm-sla-worker.ts:11-83` | queue `crm-inbox`; **six** repeatables @60s | POST `/internal/crm/*`; indirect LINE push/reply | absent (`:25-33`) | `scheduleWithRetry`; 10min timeout | crm | RESOLVED |
| `startCrmPdpaWorker`<br>`crm-pdpa-worker.ts:21-91` | purge 24h, erasure 5m | **destructive purge** via API | absent (`:22-29`) | up to 200 passes/run (`:17,61-89`) | **BLOCKED** | BLOCKED |
| `startCrmTrustWorker`<br>`crm-trust-worker.ts:9-19` | `startScanWorker` 60m | trust scores | absent (`scan-worker.ts:14-19`) | `removeOnFail: 100`, no attempts/backoff | **BLOCKED** | BLOCKED |
| `startCrmCampaignWorker`<br>`crm-campaign-worker.ts:3-5` | `startScanWorker` **15s** | outbound marketing LINE push | absent | `removeOnFail: 100` | **BLOCKED** | BLOCKED |
| `startLineAiLedgerWorker`<br>`line-ai-ledger-worker.ts:15-64` | repeatable `ledger.drain` 60s | LINE push of AI follow-ups; AI spend | absent (`:47-63`) | Redis XAUTOCLAIM at-least-once + delivery-count parking | ai_line_assistant | RESOLVED |
| `startExpenseAutoPostWorker`<br>`expense-auto-post-worker.ts:4-15` | `startScanWorker` 60s | journal posting | absent worker-side; **present API-side** | `postingStatus='posting_error'` (terminal, no auto-retry) | expense_auto_post | RESOLVED |
| `LineMessageBufferService` (in-API)<br>`line-message-buffer.service.ts:1-129` | in-process debounce/max-wait timers; memory state | LINE reply/push; AI turns | absent at buffer; gate is downstream | orphan reprocess window, shutdown drain (`:30-31`) | ai_line_assistant | RESOLVED |

`startCrmSlaWorker` is one worker fanning out to six distinct product behaviours (SLA, new-conversation notify, inbox delivery retry, autonomy retry, booking reminder, booking-proposal expiry). Per-behaviour launch gating means splitting the six repeatables, not gating the worker.

## 4. CRON (1)

| Name | Pattern | Entitlement | Retry | Feature | Status |
|---|---|---|---|---|---|
| notifications `daily_owner_summary` | `'0 7 * * *'` tz `Asia/Bangkok`<br>`notification-jobs.ts:59` | absent — sweep selects on `NotificationRule.triggerKey/status` + `company.status` (`notification-sweeps.use-cases.ts:77-80`) | `attempts: 5`, exp base 60s; sweep throws on any per-company failure so the whole job retries (`:84-88`) | dashboard_notifications | RESOLVED |

Only true cron expression in the repo. Every other schedule is a fixed `every: N ms` interval.

## 5. SCANNER (26)

The API-side sweeps behind the worker-token internal endpoints. All 26 are guarded by `assertWorkerToken` only (constant-time compare against one shared `WORKER_INTERNAL_TOKEN`, `worker-token.ts:10-14`). Four also call `assertActiveCompany` on a caller-supplied companyId.

### 5a. dashboard-notifications (8)

| Endpoint | Cadence | Per-company iteration / skip conditions | Entitlement | External effects | Status |
|---|---|---|---|---|---|
| `/internal/notifications/delivery-sweep` | 30s | cross-tenant, none | absent (`internal.controller.ts:34-38`) | **LINE push to employees**, web deliveries | RESOLVED |
| `/internal/notifications/snapshot-sweep` | 15m | `company.findMany({status:'ACTIVE'})` — **every** active company (`notification-sweeps.use-cases.ts:56`) | absent | snapshot rows | RESOLVED |
| `/internal/notifications/stock-low-sweep` | 60m | every ACTIVE company (`:67`) | absent | notification events | RESOLVED |
| `/internal/notifications/daily-owner-summary-sweep` | cron 07:00 | companies with an ENABLED `daily_owner_summary` rule (`:77-80`) | absent | notifications → web + LINE | RESOLVED |
| `/internal/companies/:id/dashboard/snapshots/generate` | on-demand | caller-supplied id; `assertActiveCompany` (`:84-93`) | absent | snapshot rows | RESOLVED |
| `/internal/companies/:id/notifications/scan/stock-low` | on-demand | caller-supplied id; `assertActiveCompany` (`:95-103`) | absent; **no RequestContext at all** | notification events | RESOLVED |
| `/internal/companies/:id/notifications/daily-owner-summary` | on-demand | `assertActiveCompany` (`:105-115`) | absent | notifications | RESOLVED |
| `/internal/companies/:id/notification-deliveries/:did/process` | on-demand | `assertActiveCompany` (`:117-126`) | absent | **LINE push** (employee OA + CRM-linked customer) | RESOLVED |

Delivery retry is the most mature in the repo: `MAX_DELIVERY_ATTEMPTS` + `nextAttemptAt`, and a conditional claim on `(status IN QUEUED/FAILED AND attemptCount = expected)` that prevents double-push (`notification.use-cases.ts:432-446`). Suppression exists for quiet hours and channel preference (`:319-325`) but never for entitlement.

### 5b. crm-inbox (11)

| Endpoint | Cadence | Per-company iteration / skip conditions | External effects | Feature | Status |
|---|---|---|---|---|---|
| `sla-breach-scan` | 60s | groups candidates by companyId (`scan-crm-sla-breaches.use-case.ts:33`); limit 200 | manager notifications; emits `crm.conversation.sla_breached` | crm | RESOLVED |
| `new-conversation-scan` | 60s | groups by companyId (`:30`) | manager notifications | crm | RESOLVED |
| `inbox-retry-scan` | 60s | three sub-sweeps, no company filter (`:60-69`) | **re-sends customer LINE messages** (`:116`), media re-fetch, profile enrichment | crm | RESOLVED |
| `autonomy-retry-scan` | 60s | job-row driven (`:19-34`) | **replays AI auto-replies**; AI spend | **BLOCKED** | BLOCKED |
| `booking-reminder-scan` | 60s | due bookings (`:34-45`) | **LINE reminder push to customer** | **BLOCKED** | BLOCKED |
| `booking-proposal-sweep` | 60s | **explicit `for (const companyId of companyIds)`** (`sweep-crm-booking-proposals.use-case.ts:23-29`); returns `companiesScanned` | proposal expiry, recovery | **BLOCKED** | BLOCKED |
| `pdpa-purge` | 24h ×200 passes | batch limit only (`crm-pdpa.use-case.ts:50`) | **irreversible deletion** of text, media, AI turns/conversations | **BLOCKED** | BLOCKED |
| `pdpa-erasure-process` | 5m | limit 20 (`:266`) | **irreversible erasure** | **BLOCKED** | BLOCKED |
| `pdpa-post-restore-re-erasure` | operator-only (no worker caller) | requires literal confirm string + snapshot ts (`crm-internal.controller.ts:91-95`) | replays completed erasures | **BLOCKED** | BLOCKED |
| `campaign-delivery-scan` | **15s** | consent, identity status, `unfollowedAt`, `marketingRequiresExplicitConsent`, `channel.status` — entitlement is **not** among them (`deliver-crm-campaign.use-case.ts:14-23`) | **outbound marketing LINE push** | **BLOCKED** | BLOCKED |
| `trust-score-scan` | 60m | candidate driven (`crm-ai-trust.use-case.ts:13-19`) | trust scores; possible AI calls | **BLOCKED** | BLOCKED |

`inbox-retry-scan` is the highest-risk CRM runoff surface: it re-sends customer-facing LINE messages that were composed **before** a gate could have been closed. Retry semantics are real — `401/4xx` terminal, `429/5xx` retryable, stable LINE retry key for crash idempotency.

### 5c. workflow (3)

| Endpoint | Cadence | Iteration / skip | Entitlement | Retry / poison | Status |
|---|---|---|---|---|---|
| `/internal/workflow/scan` ×3 trigger types | 15m each | `listAllEnabledRulesByTrigger` — **all companies**, rule status only (`workflow-scan.use-case.ts:29`); per-rule try/catch skips unavailable source modules (`:38-42`) | absent | `buildRunDedupKey` + daily bucket for SCHEDULE, hourly otherwise (`:10-15`) | RESOLVED |
| `/internal/workflow/action-runs/retry` | 60s | `listRetryableActionRuns(now, limit)` cross-tenant (`workflow-retry.use-case.ts:15-26`) | absent | `FAILED_RETRYABLE` + `nextAttemptAt`; `WORKFLOW_MAX_RETRY_ATTEMPTS` → `DEAD_LETTERED` (`workflow-action-runner.use-case.ts:104-121`) | RESOLVED |
| `/internal/workflow/events/ingest` | direct-injection path | `assertActiveCompany` on caller-supplied companyId; normal flow bypasses this guard (`workflow-internal.controller.ts:31-34`) | absent (`workflow-event-ingest.use-case.ts:19-55`) | idempotent per `(companyId, eventId)` | RESOLVED |

Cross-feature reach: `WorkflowScanCandidatesProvider` (`workflow-scan-candidates.use-case.ts:61-118`) reads inventory, reimbursement, tax/CIT, banking and CRM ×2. Only `lowStockAlert` uses a system context (`['inventory.report.read']`); the other five go repo-direct with no context, bypassing both permission and entitlement layers. Workflow rules can therefore act on data from features the tenant never bought.

`DEAD_LETTERED` is the one existing poison-terminal that already matches the plan's F1 requirement (support-visible reconciliation item, no blind retry).

### 5d. ai / ledger (4)

| Endpoint | Cadence | Entitlement | External effects | Retry | Status |
|---|---|---|---|---|---|
| `/internal/ai/draft-requests/drain` | 15s, batch 20 | absent (`drain-draft-requests.use-case.ts:15-19`) | **AI model calls (billable)** | status transitions; batch clamped 1..100 | RESOLVED |
| `/internal/ai/draft-requests/generate` | worker-token direct, no worker caller | absent; **also no `assertActiveCompany`** (`ai-draft-internal.controller.ts:27-33`) | AI model call | none | RESOLVED |
| `/internal/ai/line-ledger/drain` | 60s, batch 20 | **absent in effect** — re-resolves permissions (`drain-line-ledger.use-case.ts:158`) but requires `line.ai.query`, which is ungated core (`feature-gate.logic.ts:35-36`) | **LINE push of AI answers**; AI spend | XAUTOCLAIM at-least-once; delivery-count parks poison; expiry acks stale | RESOLVED |
| `/internal/ledger/expense-auto-post/drain` | 60s | **PRESENT** (`expense-auto-post.use-case.ts:85-101`, activation floor `:107-108`) | journal posting | failures → `posting_error`, removed from candidate SQL, **not** auto-retried | RESOLVED |

**Entitlement bypass, named:** the synchronous LINE path refuses when `ai_line_assistant` is off (`process-line-webhook.use-case.ts:596`, `:1200`), but the asynchronous ledger drain has no equivalent gate. Queued ledger entries keep pushing AI answers after the feature is disabled. Same shape for `ai-draft` drain: `ai.draft.*` permissions *are* entitlement-gated (`feature-gate.logic.ts:49`), but this path never resolves permissions so the gate never applies.

`/internal/health` (`health-internal.controller.ts:12-19`) is worker-token protected but read-only and mutates nothing; not counted as a surface.

## 6. OUTBOX

### 6a. Consumer (1) — there is exactly one

`DrainWorkflowOutboxUseCase` (`workflow-outbox-drain.use-case.ts:15-61`), driven by `POST /internal/workflow/outbox/drain` every 30s, batch 25. Verified by grep: `claimBatch` / `markPublished` appear nowhere outside this file and the repository itself. `apps/workers/src/modules/outbox/outbox-smoke.ts` is a no-op smoke stub, not a live consumer.

- **Entitlement: absent.** Claims a cross-tenant batch and ingests every event; the only skip is `!event.companyId` → marked PUBLISHED (`:31-35`).
- **Claim is not atomic:** `findMany` then a separate `updateMany` (`prisma-outbox.repository.ts:46-71`). Two concurrent drains can claim the same rows.
- **Retry/backoff/poison** (`prisma-outbox.repository.ts:80-98`): `markFailed` → `attempts + 1`, `availableAt = now + min(2^n × 1000, 300_000)ms`; `attempts >= 5` → status `DEAD`. **There is no dead-letter handler, reconciler or alert for outbox `DEAD` rows** — unlike workflow action runs, which have `DEAD_LETTERED` with a replay path.
- Ownership: `workflow_automation`. Disabling it for all tenants stops the *only* thing that consumes outbox rows, so producers silently accumulate.

### 6b. Producers (11 rows covering 97 call sites in 41 files)

Shared helper `OutboxAppendService.append` (`outbox-append.service.ts:67-108`):
- `eventKey = eventType:aggregateType:aggregateId:(requestId | sha256 fingerprint)`; idempotent via `findUnique`-then-`create` (`prisma-outbox.repository.ts:23-27`).
- **Almost every call site uses `void this.outbox.append(...)` — fire-and-forget, outside the caller's transaction.** An outbox row is therefore not atomic with the domain mutation it describes. Append failures are swallowed and logged as `outbox.append.failed` at `riskLevel: 'HIGH'` (`:86-107`).
- Payload cap 64 KB, secret-pattern redaction (`outbox.logic.ts:6-28`).
- Awaited (not voided) exceptions: `tax.document_tax.finalized` (`document.use-case.ts:296`, `vendor-bill.use-case.ts:569`) and the tax module's appends.

| Module | Event types | Representative evidence | Feature | Status |
|---|---|---|---|---|
| ledger | `journal.posted\|reversed\|generated`, `period.closed\|reopened` | `journal.use-case.ts:278,318,612`; `period.use-case.ts:351,374` | double_entry_ledger | RESOLVED |
| expenses | `expense.receipt_uploaded`, `.line_receipt_uploaded`, `.voided`, `.payment_recorded` | `expense-upload.use-case.ts:153`; `expense-draft.use-case.ts:569,628` | expenses | RESOLVED |
| crm | `crm.lead.*`, `crm.opportunity.*`, `crm.follow_up.*`, `crm.pipeline.stage_configured`, `crm.activity.created` | `crm-lead.use-case.ts:84,182,208,371,373`; `crm-opportunity.use-case.ts:77,144,283,340,374,465` | crm | RESOLVED |
| crm-inbox | `crm.conversation.*` (9), `crm.customer.created`, `crm.channel.connected\|disabled\|settings.updated`, `crm.inbox.policy_updated` | `process-inbound-line-message.use-case.ts:292`; `scan-crm-sla-breaches`; `retry-crm-inbox-deliveries` | **BLOCKED** | BLOCKED |
| accounting-documents | `accounting.${docType}.issued\|voided`, `.document.converted`, `.quotation.*`, `.payment.*`, `tax.document_tax.finalized` | `document.use-case.ts:258,296,365,374,408,443,471,529`; `payment.use-case.ts:47,54,146` | sales_documents (+ thai_tax cross-emit) | RESOLVED |
| tax | `tax.code_profile.activated`, `.code_definitions.imported`, `.reconciliation.generated`, `.trade_evidence.reviewed`, `.legacy_remediation.applied`, `.pp36_input_claim.released` | `transaction-tax-config.use-case.ts:309,687,767`; `pp36-input-claim.use-case.ts:193` | thai_tax | RESOLVED |
| procurement | `purchase_request.*`, `purchase_order.*`, `goods_receipt.*`, `vendor_bill.*`, `supplier.*`, `supplier_payment.*` | `vendor-bill.use-case.ts:409,487,569,575,750`; `goods-receipt.use-case.ts:103,111,157` | procurement (+ `inventory.movement.created` at `goods-receipt:103`, `tax.document_tax.finalized` at `vendor-bill:569`) | RESOLVED |
| inventory | `inventory.product.created\|updated\|archived`, `inventory.location.*`, `inventory.movement.created` | `create-product.use-case.ts:71`; `location.use-cases.ts:72,102,140`; `create-movement.use-case.ts:101` | **BLOCKED** | BLOCKED |
| reimbursements | 10 `reimbursement.*` events | `reimbursement-request.use-case.ts:326,333,415`; `reimbursement-finance.use-case.ts:103,109,199,337` | reimbursement | RESOLVED |
| banking | `banking.statement_import.committed`, `.statement_line.matched\|unmatched`, `.reconciliation.completed\|reopened`, `.adjustment.approved` | `statement-import.use-case.ts:349`; `matching.use-case.ts:121,203` | bank_reconciliation | RESOLVED |

Producers on **user-facing controllers** are indirectly protected: `crm.*`, `reimbursement.*`, `inventory.product.*`, `report.*`, `dashboard.*`, `notification.*`, `ai.draft.*`, `ai.suggestion.*` are stripped at resolve time (`feature-gate.logic.ts:39-50`), so the controller is unreachable. Producers on **webhook and sweep paths** (crm-inbox) have no such protection because those paths never resolve permissions.

Cross-feature emits are launch-matrix edges: procurement → `inventory.movement.created` and → `tax.document_tax.finalized`; accounting-documents → `tax.document_tax.finalized`; procurement → `tax.pp36_input_claim.released`.

## 7. WEBHOOK (7)

| Entry point | Auth model | Entitlement | Downstream fan-out | Status |
|---|---|---|---|---|
| `POST /v1/line/webhook` + `/v1/webhooks/line` (shared WatchDog OA, employees)<br>`line-webhook.controller.ts:30-116` | HMAC `x-line-signature` vs `LINE_MESSAGING_CHANNEL_SECRET`; `@Public` | absent at entry; gate two hops downstream | `LineMessageBufferService` → AI turns → LINE reply; receipt OCR + expense mutation; signature assets | RESOLVED |
| `lineAssistantDisabled` gate<br>`process-line-webhook.use-case.ts:407-412` | — | **PRESENT**, enforced `:596-611` and `:1200-1205` | refusal reply + `ai.line.query.denied` audit | RESOLVED |
| `POST /v1/crm/line/webhook/:webhookKey` (company OA, **end customers**)<br>`crm-line-webhook.controller.ts:29-86` | webhookKey lookup → per-channel HMAC with decrypted `channelSecret`; signature verified **before** the disabled-channel drop to avoid a state oracle (`:40-44`); `@Public` | **ABSENT** | customer/conversation creation, outbox appends, autonomy job, AI auto-reply (`:971`), **autonomous booking creation** (`:132`), LINE reply/push | **BLOCKED** |
| `POST /v1/internal/ai/tools/invoke` (AI Gateway → API)<br>`internal-tools.controller.ts:214-320` | `assertInternalSecret` + single-use signed `x-actor-delegation` (jti burn) + full `resolveAccess` re-resolution + company/membership claim match (`:276`) | entry gate `ai.tool.invoke` is **ungated core**; per-tool permission may be gated | ~50 read-only tools across ~10 features (`:200-212`) | **BLOCKED** |
| `@Public` customer PDPA endpoints (consent-withdraw, data-export, erasure-request, erasure-status)<br>`crm-customer-pdpa.controller.ts:53-110` | IP + `lineChannelId` rate limit only | absent | creates erasure cases drained by the 5m scanner | **BLOCKED** |
| `@Public` customer LINE registration<br>`customer-line-register.controller.ts:39-60` | LINE `idToken` + rate limit | absent | CRM customer + channel identity rows | **BLOCKED** |
| **Outbound** `CALL_WEBHOOK` workflow action<br>`workflow-action-runner.use-case.ts:153,263-298` | endpoint config under `workflow.webhook.manage`; dispatch runs system-side; event-type allowlist (`:270`); SSRF policy in `workflow-webhook-security.logic.ts` | absent | outbound HTTP POST to a tenant-configured URL | RESOLVED |

**The asymmetry is the headline.** The employee-facing LINE webhook has an entitlement gate; the customer-facing one has none. Grep confirms the only `entitle`/`featureKey` references anywhere in `apps/api/src/modules/crm-inbox` are in `domain/logic/mvp1-0-setup.logic.ts`, a setup-script helper that is not on any request path.

**Reading the plan's cited fan-out `:623-627` precisely:** it is a *permission* fan-out, not an entitlement fan-out.

```
canQuery            = permissions.includes('line.ai.query')
canCaptureExpense   = ['expense.receipt.line_upload','expense.receipt.upload','expense.create'].some(...)
canSubmitSignature  = permissions.includes('expense.signature.manage')
if (!canQuery && !canCaptureExpense && !canSubmitSignature) → FORBIDDEN_REPLY
```

All three branches sit behind the single `ai_line_assistant` gate at `:596`. Consequences for the launch matrix: LINE receipt capture cannot be sold or gated independently of the AI assistant, and a tenant holding `expenses` but not `ai_line_assistant` loses LINE receipt upload entirely. `:1215-1217` repeats the same shape without `canQuery`.

Also note `resolveCompanyForLineUser` (`:383-404`): company comes from the user's memberships, with a multi-company owner-only selection policy — not from the channel. The CRM webhook is the opposite (channel → company, safe only because each company registers its own OA, `crm-line-webhook.controller.ts:14-18`).

No payment or OCR callback webhooks exist. Receipt OCR runs inline inside the LINE turn (`process-line-webhook.use-case.ts:1484`), and ClamAV scanning is a synchronous socket call (`attachment-malware-scanner.ts:18-48`), not an async surface.

## 8. SYSTEM_CONTEXT (6)

| Context | Permission set | Entitlement filtering | Evidence |
|---|---|---|---|
| `systemWorkerContext` (shared factory) | `roles: []`, `userId 'system'`, `membershipId 'system'`, `authProvider 'system'`, explicit permission list, `scopes {}` | **never** — bypasses `resolveAccess` by construction | `system-worker-context.ts:9-27` |
| `WORKER_NOTIFICATION_PERMISSIONS` | `dashboard.read`, `dashboard.snapshot.generate`, `inventory.report.read`, `inventory.product.read` | none — and these are exactly the prefixes `feature-gate.logic.ts:40,43` would strip | `notification-sweeps.use-cases.ts:17-31` |
| `EXPENSE_AUTO_POST_WORKER_PERMISSIONS` | `expense.read`, `journal.entry.create`, `journal.entry.post`; sets `authSubject` for audit provenance | context unfiltered, but the **company set is entitlement-filtered upstream** | `expense-auto-post.use-case.ts:9-22, 85-101` |
| workflow scan `systemCtx` | `['inventory.report.read']` only | none; five of six candidate providers use **no context at all** | `workflow-scan-candidates.use-case.ts:19-24, 61-118` |
| `assertWorkerToken` | one shared `WORKER_INTERNAL_TOKEN`, constant-time compare, fail-closed when unset | n/a — no company or feature dimension | `worker-token.ts:10-14` |
| `SYSTEM_ACTOR` / `actorType: 'SYSTEM'` (CRM sweeps) | **none** — repository-direct | n/a — no permission list exists to filter | `retry-crm-inbox-deliveries.use-case.ts:151-165` |

H-14 hardening is intact throughout: no synthesized OWNER role, least-privilege lists, `assertActiveCompany` on caller-supplied companyIds (three of four sites — `ai-draft-internal.controller.ts:27-33` is the exception). The gap is orthogonal to H-14: least privilege was solved, entitlement was not.

## 9. BLOCKED rows (17) — what is missing

Each needs an owner decision; none may inherit a sibling's answer.

**PDPA family (5)** — `startCrmPdpaWorker`, `pdpa-purge`, `pdpa-erasure-process`, `pdpa-post-restore-re-erasure`, `@Public` customer PDPA endpoints.
Missing: whether PDPA retention/erasure is owned by `crm` (and stops when CRM is unsold) or is a non-sellable platform obligation that must keep running after CRM is disabled. Deleting-vs-retaining customer data on feature-off is a legal question. Compounding: an end customer can enqueue destructive work regardless of the tenant's entitlement state, so a launch gate must not strand a legal erasure obligation.

**Booking family (2)** — `booking-reminder-scan`, `booking-proposal-sweep`.
Missing: whether booking gates on `crm`, on submenu `crm.bookings`, or on a new scheduling key. `crm-inbox.constants.ts:13-15` explicitly records that `crm_line_inbox`/`crm_scheduling` are Phase-9 vocabulary that nothing honours, and that enabling only those would strip the inbox.

**CRM-AI ownership (2)** — `crm-trust-worker` / `trust-score-scan`, `autonomy-retry-scan`.
Missing: `crm` vs `ai_line_assistant`. `feature-gate.logic.ts:46` already splits the `crm.ai.` prefix to `ai_line_assistant` while the data is `crm`. For autonomy also: whether queued jobs drain or terminalize when AI is turned off.

**Channel vs domain (4)** — `crm-campaign-worker` / `campaign-delivery-scan`, CRM-inbox outbox producers, customer LINE registration.
Missing: `crm` vs `line_oa` for work that is CRM data acquired or delivered through the LINE OA channel. `feature-gate.logic.ts:45-47` splits `crm.channel.` → `line_oa` from `crm.` → `crm`, but conversation events straddle both.

**Company OA webhook (1)** — `POST /v1/crm/line/webhook/:webhookKey`. **Highest priority.**
Missing: the key set for a path that fans into `crm` + `line_oa` + `ai_line_assistant` simultaneously, and the customer-visible fallback when the OA is live but the feature is off (silence vs a friendly message). Permission-stripping cannot help — this path never resolves a user's permissions.

**Inventory vs catalog (1)** — inventory outbox producers.
Missing: whether `inventory.product.*` belongs to `product_catalog` (sold independently per `feature-gate.logic.ts:19-20,40`) and `inventory.movement.*` to `inventory`, given that goods-receipt in **procurement** also emits `inventory.movement.created`.

**AI tool bridge (1)** — `POST /v1/internal/ai/tools/invoke`.
Missing: a per-tool feature-key map (the plan's `availableToolsForPlan` seam) covering ~50 tools across ~10 features, before this row can be resolved.

**PDPA + campaign worker duplicates** are counted once per row object in the JSON (worker row and scanner row are distinct surfaces with distinct triggers).

## 10. Cross-references for the F0 matrices

- Reference implementation for an entitlement-aware scanner: `expense-auto-post.use-case.ts:85-101` + `:107-108`. Caveat worth recording in the matrix: `entitlement.updatedAt` approximates activation time and is re-stamped by any later toggle, so it is not a durable generation fence.
- Existing poison terminal that already matches F1: workflow `DEAD_LETTERED` (`workflow-action-runner.use-case.ts:104-121`) with a replay path in `workflow-dead-letter.use-case.ts`.
- Missing poison terminal: outbox `DEAD` (`prisma-outbox.repository.ts:83,90`) has no handler, reconciler or alert.
- Existing idempotency anchors usable as work-vector seeds: outbox `eventKey`, `buildRunDedupKey` (workflow), `lineReplyRetryKeyForMessage` (CRM), campaign `retryKey`, notification `X-Idempotency-Key`, ledger Redis stream entry id.
- Existing human-confirmation precedent for an operational route: `crm-internal.controller.ts:91-95` (literal confirm string + snapshot timestamp).
- Non-atomic claim to fix before any batch-claim design: `prisma-outbox.repository.ts:46-71`.
