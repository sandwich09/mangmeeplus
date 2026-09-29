# Agent Memory: sales-event-discounts-implementation

Status: SD-A (data model + sales-team console) implemented 2026-09-29 on branch `claude/sales-event-sd-a-20260929` (worktree `/private/tmp/mangmee-sales-event-sd-a-20260929`, base develop `3a863b70` = #878 add-on PR A). Not pushed, no PR, not deployed. SD-B (LINE claim), SD-C/SD-D (discount at purchase), SD-E (report) and SD-F (credit) are being built in parallel by other agents on top of the checkpoint `e7ab6a4a`; the controller integrates.
Owner: thawatchai / Claude (controller + implementers)
Scope: spec `docs/specs/sales-event-discounts-spec-th.md` (DRAFT v3 + SD-O10), plan `docs/plans/sales-event-discounts-plan-th.md` §2 SD-A.

Decisions:
- SD-O10 (Owner 2026-09-29 "อย่าทำ switch อีก เปิดไว้เลยเสมอ"; controller applied it here): no `event_discounts` gate, flag or env. The batch is the control: "พักแจก" stops the QR, "ระงับการใช้" stops use of unused tickets, "เพิกถอน" kills one ticket. `BILLING_ACTIONS` untouched; `SALES_EVENT_DISABLED` never added. Recorded in spec §1.1 (SD-O10, supersedes §7.2/§7.3/§11/SD-E16/SD-E31 gate text) and plan §1 + SD-B row.
- SD-O9 defaults apply: expiry = claim end + 30 days, RESTART discountable, sales credit unchanged, one ticket per shop per batch.
- Migration `20260929180000_sales_event_discounts` (PR B already took `20260929150000_receipt_unit_entries`). Additive: 4 tables, indexes, FKs (agents/QR tokens cascade with the batch, tickets RESTRICT), CHECKs, 2 partial uniques.
- CHECKs (spec §6.1–§6.3 as data): batch state IN (OPEN,PAUSED,SUSPENDED); discount and AI credit are multiples of 100 and ≥ 0; at least one reward > 0; 1 ≤ issueCap and 0 ≤ issuedCount ≤ issueCap; claimEndsAt > claimStartsAt. Ticket: ISSUED/REVOKED ⇒ redeemedAs, companyId, attemptId, invoiceId, appliedDiscountSatang all NULL; RESERVED ⇒ DISCOUNT + companyId + attemptId; USED ⇒ redeemedAs + companyId; REVOKED ⇒ revokedAt/By/Reason. SD-B/SD-C/SD-F writes must respect these.
- Partial uniques: `SalesEventTicket_company_discount_key` (companyId) WHERE state IN (RESERVED,USED) AND redeemedAs = DISCOUNT; `SalesEventTicket_batch_company_key` (batchId, companyId) WHERE state IN (RESERVED,USED).
- `SalesEventBatch.version` is the console's edit fence; claims must NOT bump it (they lock the row and increment `issuedCount`). PATCH guards `issuedCount <= newCap` in its WHERE.
- Permission `sales.event.manage` (HIGH): MANGMEE_SALES_LEAD + SYSTEM_ADMIN (via `...SALES_PERMISSION_KEYS`); MANGMEE_SALES reads (`sales.console.read`) and shows QR only when an active assignee with an ACTIVE profile. Manage = SYSTEM_ADMIN any batch, lead only batches they created. Visibility: admin all; lead own + batches assigned to their team (incl. themselves); seller assigned batches, own tickets only (and own-only counts).
- QR: token/hash/link/serial/expiry live in SD-B's shared `apps/api/src/modules/sales-console/domain/sales-event-claim.logic.ts` (merged from `6bbfef83`); SD-A imports `newSalesEventQrToken`, `salesEventQrLink`, `salesEventTicketDisplayState`. QR life = min(now + 5 min, claim end); only the hash is stored; audit uses `qrId` (a key containing "token" is redacted by the audit sanitizer).
- ฿10 floor at publish: `firstOfferBelowMinimum` over `BillingService.catalog()` offers (active policy prices and tax treatment; code catalog when billing is disabled). `BillingModule` now exports `BillingService` (one line). SD-C must import `eventDiscountUnitAmountSatang` / `SALES_EVENT_MIN_UNIT_AMOUNT_SATANG` from `sales-event.logic.ts`.
- Error codes added: SALES_EVENT_BATCH_INVALID, _REWARD_REQUIRED, _DISCOUNT_TOO_HIGH (body carries `offerKey`, `interval`; the web names the package), _BATCH_STALE (also answers an action the state does not offer), _NOT_FOUND, _CLAIM_CLOSED, _ISSUE_FULL, _AGENT_INACTIVE, _TICKET_NOT_REVOCABLE — all with Thai text. SD-B added _QR_EXPIRED and _SELF_CLAIM. A seller outside the lead's team → existing SALES_AGENT_NOT_FOUND.
- Web today (controller scope 2026-09-29): the credit inputs are NOT on the form (SD-F adds them); an edit carries stored credit through untouched, so the form requires a discount > 0 unless the batch already carries credit. Ticket serial is shown as "เลขส่วนลด" (the human reference number by design).
- Not done in SD-A on purpose: report route (SD-E owns `GET /v1/sales/events/report` in its own controller/service); claim/LIFF (SD-B); anything in billing beyond the one export.

Open questions:
- None blocking. The add-on memory `chat-credit-addons-implementation.md` still lists "does O-04 cover `event_discounts`?" as open — answered yes by SD-O10; left for that task's owner to close.

Artifacts:
- Commits on the branch: `e7ab6a4a` data model + contracts checkpoint; merge of SD-B `6bbfef83`; `3ffdb3e8` API; `1c06effb` logic + permission specs; `864478d0` web console; final commit with the PG spec, `ci.yml` line and docs (see git log).
- API: `apps/api/prisma/schema.prisma`, migration above, `sales-console/domain/sales-event.logic.ts`, `application/sales-events.service.ts`, `presentation/http/sales-events.controller.ts` + `sales-events.dto.ts`, `sales-console.module.ts`, `billing/billing.module.ts` (export), `auth/permission-registry.ts`, `audit/domain/models/audit-action.ts` (`sales.event.*`, literal-pinned line untouched).
- Contracts: `packages/contracts/src/sales.ts` (permission key, states, paths, actions, constants, input/view types, error codes).
- Web: `apps/web/app/sales/events/page.tsx`, `apps/web/app/sales/events/[batchId]/page.tsx`, `features/sales-console/{SalesEventsPage,SalesEventBatchForm,SalesEventBatchPage}.tsx`, `sales-events.logic.ts`, `sales.api.ts`, `SalesHeader.tsx` menu "ส่วนลดจากงาน", `api-error-message.ts`.
- Tests: `sales-event.logic.spec.ts` (catalog `api-behavior`), `sales-event-discounts.pg.spec.ts` (`ci.yml` Migrations and Boot, env `SALES_EVENT_TEST_DATABASE_URL`, after sales-console line), `permission-registry.spec.ts` (lead-only key), web `sales-events.logic.spec.ts` (+ `sales-console.qa.spec.ts` page list).
- `ci.yml` changed → must twin to main byte-identically before any UAT `all` dispatch (plan §3.3).

Verification (2026-09-29, worktree above; per controller: full API/web suites and whole-chain run once by the controller on the integrated branch):
- contracts build 0, typecheck 0; `prisma validate` ok; `prisma generate` ok; migration passes `assertProductionA5NoDestructiveSql`.
- API typecheck 0; `check-di-metadata` on sales-console + billing: all constructors carry metadata.
- API focused: `sales-event.logic.spec.ts` 16/16; `permission-registry.spec.ts` 43/43; `spec-suite-coverage.spec.ts` 3/3.
- Web: typecheck 0; focused `sales-events.logic.spec.ts` + `sales-console.qa.spec.ts` + `sales-console.logic.spec.ts` + `api-error-message.spec.ts` + `no-raw-api-error-display.spec.ts` 164/164.
- PG (throwaway postgres:16 `mangmee-sd-a-pg-20260929`, fresh `migrate deploy`, removed afterwards): see the final report / next update of this file.
- Pins `--check`: current (no pinned file touched). W00 not regenerated (no hashed file touched).

Next:
- Controller: integrate SD-A with SD-B/SD-C/SD-D/SD-E, run full suites + whole-chain once, then push/PR develop + twin main (ci.yml parity).
- SD-F: add the two credit inputs to `SalesEventBatchForm.tsx` (fields already in the form state) and the credit column of the ticket list.
- UAT: plan §3.9 U2 (lead creates a batch with 2 sellers; an unassigned seller cannot open the QR; QR expires in 5 minutes) on a phone at 390 px.
