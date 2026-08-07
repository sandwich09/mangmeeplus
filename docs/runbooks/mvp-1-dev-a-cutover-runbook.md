# MVP 1 — Dev A Cutover Runbook (A10)

Cutover checklist for the Dev A lane of the MVP 1 CRM/LINE bill-capture work (tasks A1–A9).
Follows the ECS canary + RollbackAlarm precedent recorded in [[agent-memory/crm-line-oa-customer-os-15a]]
(2026-07-06 prod deploy). Dev A owns the core cutover; Dev B runs the AI-side cutover (B12).

> A10 is ops/coordination, not code. This doc is the artifact; execute it at deploy time.

## 1. Pre-deploy — build & test gates

- [ ] `pnpm -r typecheck` clean (api + web + workers).
- [ ] `apps/api` suite green (1243+/1243+ at time of writing), `apps/web` suite, `apps/workers` suite.
- [ ] `apps/api` `pnpm prisma:validate` OK.
- [ ] Contracts build clean.

## 2. Migrations (additive; deploy in timestamp order)

Two NEW migrations ship in this lane — both additive (columns + indexes only), safe to `migrate deploy`
before the new code goes live:

- [ ] `20260709030000_item15a_crm_reply_retry` — `CrmMessage.deliveryAttemptCount` + `deliveryNextAttemptAt` + index.
- [ ] `20260709040000_item15a_booking_reminder` — `CrmBooking.reminderSentAt` + `@@index([status,startAt])`.

Run: `DATABASE_URL=... pnpm --filter @watchdog-bms/api exec prisma migrate deploy` (boot already runs it on ECS).
No destructive/renamed columns. The A6 PDPA purge + erasure reuse existing columns — no migration.

> Migration-lane note (parallel plan): Dev B also ships migrations (trust columns, auto-reply toggle).
> Order by timestamp; both lanes are additive. Announce before deploy.

Customer-management closure adds two later migrations:

- [ ] `20260712150000_crm_customer_identity_management` — typed provenance, marketing pseudonym refs, canonical identity/merge lineage, repair/backfill, indexes, and validated same-company composite FKs. Schedule a short CRM write window: the migration uses fail-fast locks and intentionally aborts on historical tenant/lineage mismatch instead of guessing repairs.
- [ ] `20260712170000_crm_booking_reminder_delivery_state` — reminder claim lease, attempt/backoff/error state, and due-delivery index.

The verified local gate applied and seeded all 53 migrations from an empty PostgreSQL database. Production still follows normal backup/canary/rollback controls; local proof is not evidence that production migration has run.

## 3. Permission sync

New permission added: `crm.customer.erase` (CRITICAL; granted ADMIN, OWNER auto).
- [ ] Boot runs `prisma/sync-permissions.ts` — confirm the new key is upserted (permission count +1).
- [ ] Verify OWNER/ADMIN can see the PDPA erase action; other roles 403.

## 4. Environment / secrets verify

Required environment and secret checks:
- [ ] `WORKER_INTERNAL_TOKEN` set (shared by all internal scanner endpoints) — same value in api + workers.
- [ ] `INTERNAL_API_URL` set in the workers service (points at the api `/v1`).
- [ ] `REDIS_URL` + `QUEUE_ENABLED=true` in workers (drives all repeatable jobs).
- [ ] `WEB_BASE_URL` / `PUBLIC_BASE_URL` set (deep links in LINE pushes + notifications).
- [ ] `CREDENTIAL_ENCRYPTION_KEY` present (channel secret decrypt for reply-retry / reminder / delivery push).
- [ ] `PDPA_PSEUDONYMIZATION_KEY` present as a dedicated 64-character lowercase hex key and different from `CREDENTIAL_ENCRYPTION_KEY`.
- [ ] First dedicated-key deployment: `PDPA_PSEUDONYMIZATION_PREVIOUS_KEYS` includes the prior credential-derived pseudonym root so erased-identifier suppression remains resolvable across the cutover. Later rotations append the outgoing PDPA key to this comma-separated key ring before switching current.
- [ ] Do not remove a previous pseudonym key until the longest erased-identifier suppression/retention window and any planned data migration are complete. Never log or paste current/previous key values into deployment evidence.
- [ ] `UPLOAD_MAX_BYTES` set (media re-fetch bound).

## 5. Workers — new repeatable jobs (verify they register & fire)

On the `watchdog-bms-workers` service, confirm these log lines + BullMQ repeat jobs:
- [ ] `crm_sla_worker_started` — queue `crm-inbox`, jobs: `crm-inbox-sla-scan` (60s), **new** `crm-inbox-newconv-scan` (60s, A4), `crm-inbox-retry-scan` (60s, A5), `crm-inbox-reminder-scan` (60s, A7).
- [ ] `crm_pdpa_worker_started` — queue `crm-pdpa`, job `crm-pdpa-purge` (daily, A6).
- [ ] `notification_worker` — **new** repeatable `notifications-delivery-sweep` (30s, A4) drives the delivery dispatcher.
- [ ] Confirm the api logs show the paired internal endpoints returning 2xx:
  `/internal/crm/{sla-breach-scan,new-conversation-scan,inbox-retry-scan,booking-reminder-scan,pdpa-purge}`
  and `/internal/notifications/delivery-sweep`.

## 6. Pilot-tenant setup (A2)

- [ ] `DATABASE_URL=... pnpm --filter @watchdog-bms/api crm:mvp1-0-setup <bombamCompanyId> --apply`
  → enables the `crm` entitlement, prints PASS/WARN/FAIL. Resolve any ✗ before go-live.
- [ ] LINE OA channel connected (Dev B / B1) — the script WARNs until then.

## 7. Queue / DLQ health

- [ ] BullMQ queues `crm-inbox`, `crm-pdpa`, `notifications` reachable; no jobs stuck in `failed`.
- [ ] Delivery sweep is draining: `NotificationDelivery` rows move QUEUED → SENT/SKIPPED/SUPPRESSED
  (was permanently QUEUED before A4). Retryable LINE failures show a future `nextAttemptAt`, not terminal.
- [ ] Reply-retry: no `CrmMessage` stuck PENDING with a long-past `deliveryNextAttemptAt`.
- [ ] Booking reminders: due rows use `reminderClaimedAt` as a lease, increment `reminderAttemptCount`, and either set `reminderSentAt` on successful completion or schedule `reminderNextAttemptAt` with bounded backoff. A stale claim retries with the deterministic LINE retry key; overlapping workers must not double-send.

## 8. Cross-tenant battery (core)

- [ ] Two companies A/B: verify every new read/list scopes by companyId —
  daily-brief counts, payment-proof queue, customer bookings, create-from-conversation, PDPA erasure.
- [ ] SALES scope: create-from-conversation + payment-proof flag respect conversation ownership (403 on other's).
- [ ] PDPA erasure on a company-A customer never touches company-B rows; finance-linked evidence retained.
- [ ] Payment-proof review page 403s for a role without `crm.inbox.read`.

## 9. Canary + rollback

- [ ] Deploy api-web canary (single active config per ECS precedent); health 200 via the pilot domain.
- [ ] RollbackAlarm armed (per 2026-07-06 precedent) — 5xx / health-check breach auto-rolls-back.
- [ ] Workers service healthy (`/health` 200) + heartbeat logs.
- [ ] Post-deploy smoke: send a LINE message → conversation appears → new-conversation notification fires
  → staff reply → (if channel real) customer receives; flag an image as payment proof → appears in the
  review page; create a deal from the conversation → opportunity created + in-thread note.

## 10. Post-cutover

- [ ] Record evidence in [[agent-memory/mvp-1-crm-line-bill-capture-sequence]].
- [ ] Standing external blocker: real-LINE end-to-end (physical channel/tunnel) — all LINE push/fetch
  paths are unit-covered; live smoke requires Dev B's OA connect.

## Deferred (not blocking cutover; tracked in the sequence memory)

- A3: send quotation/invoice to LINE (needs a customer-facing short-lived signed-link primitive);
  inbox sidebar latest-deal/open-tasks read widgets; payment-proof web flag button in the thread.
- A8: pipeline/quotations-awaiting widgets (in the CRM sales dashboard); response-time median.
