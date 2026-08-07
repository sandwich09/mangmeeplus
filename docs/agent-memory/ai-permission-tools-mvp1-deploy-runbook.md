# AI Permission Tools MVP1 — Deploy Runbook

Status: MVP1 gap-closure implemented on `develop`. Plan: [[plans/ai-permission-tools-production-gap-closure-plan]]. Harness: [[agent-memory/ai-permission-tools-mvp1-harness]].

## What ships (committed)

Security + receipt/expense AI + reimbursement + customer CRM autonomy safety. Commits `db7d7e73` → `6fdca010` (interleaved with the concurrent CRM-hardening `b7b22f49`).

- SEC-01/02/03/04/06: internal ERP tool route re-resolves permissions from DB (ignores caller-supplied), enforces `ai.tool.invoke`, AgentCore carries scope + returns tool lineage, timing-safe secret compare, readiness endpoint authenticated.
- CUST-01/11 typed audit actor (fixes real-DB LIFF register 500 + durable autonomy audits); CUST-05 atomic channel cap; CUST-06 last-XFF-hop rate-limit keys; CUST-08 customer self-service PDPA (withdraw/export/erasure request); **CUST-02 booking proposal→confirmation** (no booking without explicit "ยืนยัน"). CUST-04 (staff/branch revalidation) + CUST-10 (reminder consent) landed via the concurrent CRM-hardening commit.
- RECEIPT-01/02/04/05/06: dead receipt model-tools removed, media idempotency + honest OCR reason + retryable failures, channel separation test, clarify-once for media+question, negation/redelivery/orphan/partial-failure fixes.
- TOOL-01/04/06: accounting.get_summary unblocked, non-canonical perm orphan removed, reimbursement.list_pending_approvals enabled.
- OPS-01/04/05: tool-reachability parity gate, dirty-tree ownership, hygiene.

## Deploy gates (do these)

1. **Keep `CRM_AUTO_REPLY_ENABLED=false` in prod until the canary passes.** Customer auto-reply + autonomous booking only run when this is on. With it off, everything else (receipt/expense AI, employee read tools, reimbursement, all security) works and no autonomy runs. CUST-02/03/04/05 make autonomy SAFE to turn on later — but enable it only after the canary below.

2. **Pre-check the RECEIPT-02 unique index migration.** `20260712200000_..._p1` adds a UNIQUE index on `ExpenseRecord(companyId, lineMessageId)` behind a guard that RAISES EXCEPTION if prod has historical duplicates. Before deploy run:
   ```sql
   SELECT "companyId","lineMessageId", count(*) FROM "ExpenseRecord"
   WHERE "lineMessageId" IS NOT NULL GROUP BY 1,2 HAVING count(*)>1;
   ```
   If any rows return, resolve the duplicate expenses first or the migration aborts (safe-fail, blocks deploy).

3. **Migrate before deploying the new API.** New API writes `AuditLog.actorType` and reads `CrmBookingProposal.serviceName` / `.questionSentAt` / `LineIntakePendingMedia` — apply migrations `20260712200000` + `20260712210000` + `20260712230000` + `20260712240000` (sweep indexes) first (deploy.sh already migrates-first). Old API + new schema is fine (all additive).

4. **Deploy order:** migrate → API → **workers (required this pass: crm-sla-worker gains the `proposal.sweep` repeatable job that drives booking-proposal expiry + crash recovery)** → (gateway/AgentCore unchanged this pass; SEC-01/04 are additive + backward-compatible so no hard version coupling, but ship the same immutable commit).

## Canary before enabling autonomy

On an internal test company, with `CRM_AUTO_REPLY_ENABLED=true` for that tenant only:
1. Shared-OA receipt: send a real JPEG/PDF + a text expense → one durable reviewable draft each; send a receipt image + a business question → gets the clarify question (not a silent drop).
2. Company-OA customer booking: "ขอจองพรุ่งนี้บ่ายสอง" → gets a confirm question, NO booking; reply "ยืนยัน" → exactly one booking; "ว่างไหม" alone → no booking.
3. Consent: revoke consent mid-conversation → no auto-send, no booking.
4. LIFF registration on real Postgres → succeeds (no audit-FK 500).

## CUST-02 cross-review BLOCK — fail-opens resolved (commits `43c13ea3`, `0e6695dc`)

Two codex cross-review rounds of the proposal→confirmation gate. Every path that could commit a booking WITHOUT an explicit, unambiguous customer confirmation of a slot they actually saw is closed and re-gated (classifier 18/18, proposal repo 11/11, process-inbound 81/81, full api suite, tsc 0):

- **Fail-closed confirmation** — CONFIRM only on a *bare* affirmative (token + politeness). An affirmative buried in a question/extra clause (`ตกลงกี่โมงคะ`, `can you confirm the time`) or carrying a negation/doubt emoji (`โอเค❌`, `yes 👎`) stays UNCLEAR. CANCEL stays permissive (a missed cancel never books).
- **Confirmable only after delivery** — a proposal advances to `AWAITING_CONFIRMATION` (the only resolvable state) *only after the confirm question is actually delivered*. A capped/failed send leaves it `PROPOSED` (never confirmable) to expire, so a later stray "ok" can't commit a slot the customer never saw asked.
- **Kill-switch re-resolved at the commit** — channel re-read from the DB at the resolution gate and again immediately before the commit CAS (was trusting the job-enqueue snapshot); a mid-turn toggle-off → `HANDED_TO_STAFF`, no booking.
- **One resolvable proposal** — a genuinely new slot supersedes the earlier unconfirmed one; a same-slot re-inquiry collapses to the open row (left intact); a stale terminal fingerprint is left untouched (no phantom question).
- Source message id persisted as proof; booking id attached atomically on `COMMITTING→BOOKED`; non-conflict commit failure → `HANDED_TO_STAFF` (no stranded `COMMITTING`).

## Transactional finalization + round-4 hardening — DONE (commits `68f7b946`, `1697bc06`)

The former "pre-autonomy-enable gate" is closed. Two more adversarial rounds ran on it (codex round 3 + a 3-lens review panel with per-finding refuters); all 8 confirmed findings fixed:

- **Kill-switch atomic with the write** — `writeBookingIfSlotFree` gains `assertWithinTx`/`finalizeWithinTx` hooks; the autonomous commit re-checks channel + conversation autonomy via `SELECT … FOR SHARE` INSIDE the booking transaction (row locks serialize against toggle UPDATEs) and flips `COMMITTING→BOOKED`+bookingId in the same transaction. No booking without BOOKED evidence, no BOOKED without a booking. Manual flows pass no hooks — unchanged.
- **Question provenance (`questionSentAt`)** — the resolution gate commits ONLY the proposal carrying the newest delivered confirm question; a stale question delivered last triggers a re-ask (no commit). A confirmation can never book a slot the customer didn't most-recently see asked.
- **One resolvable proposal, serialized** — `createSuperseding` runs create+supersede under a per-conversation advisory lock; `fresh` = actual insertion; a terminal row's fingerprint is rotated aside so a re-request of a cancelled/expired slot is asked again (flip-flop A→B→A books A, never the abandoned B).
- **No unrecoverable state** — every non-terminal status has an exit: PROPOSED/AWAITING expire; stuck CONFIRMED/COMMITTING (>10 min) are swept to `HANDED_TO_STAFF` by the new worker job (`proposal.sweep` → `POST internal/crm/booking-proposal-sweep`, every 60s).
- **Honest audits** — post-commit notification failure audits `booked_not_notified` with bookingId (never masquerades as commit failure); CANCEL/CONFLICTED audit the real send outcome; send boundary re-reads global flag + channel + conversation before any AI send (closes the CUST-03 residual).

Gates: full api suite 1819/1819, api tsc 0, workers tsc 0 + 7/7.

## Rounds 5–10 — cross-engine review payoff (commits `bfe9658b`, `ce77c0e4`, `1dcc20d2`, `b03bc529`, `d6f4c7de`, `5601a406`)

Codex round 4 caught a regression the unit-test mocks had hidden and a residual provenance hole; both closed and the test harness hardened so the bug class stays visible:

- **25P02 regression (round 5)**: `create → catch P2002 → continue` inside a Postgres `$transaction` can never work — the unique violation aborts the whole transaction, so every fingerprint-collision branch was unreachable and a same-slot re-request THREW. All unit tests had passed because the fake `$transaction` didn't emulate abort semantics. Now: `createSuperseding` is query-first under the per-conversation advisory lock (findUnique → create / refresh / rotate / collapse, no in-txn error handling), and the repo spec's fake transaction poisons itself on any thrown statement (25P02-faithful) so mock-hidden transaction bugs fail loudly.
- **Delivery-order provenance (rounds 5–6)**: `questionSentAt` now stamps the DB clock (`NOW()`) at send completion, ties are ambiguous (`>=`, fail-closed), and — the final piece — a per-conversation **ask lock** (`withAskLock`, advisory, cross-instance) serializes [question send → stamp → AWAITING CAS] against [provenance read → ambiguity decision → CONFIRMED CAS]. A confirmation always sees the stamp of every question the customer could have received; the race test is mutation-proven (stubbing the lock makes it fail). Every residual ordering window is fail-closed (books nothing, or books the single CONFIRMED-claimed proposal).
- CANCEL/CONFLICTED notification throws are contained after the durable terminal state (audit always records the real send outcome); sweep discovery got `(status, expiresAt)` + `(status, updatedAt)` indexes.
- **Holder-death closure (rounds 7–10)**: `questionSentAt` is pre-stamped BEFORE the send — a pod kill on deploy / connection loss / lock expiry at any point after a question could be seen leaves the stamp behind, so the next confirmation goes ambiguous and re-asks (fail-closed, enumerated for every death point on both paths); the confirm's provenance read + `AWAITING→CONFIRMED` claim run on the lock transaction (holder death rolls the claim back); lock timeout 120s; every undelivered re-ask path (returned-false, probe failure, AND send throw) restores the prior stamp; the ask-lock liveness probe runs as a `preSend` hook at the provider boundary (inside the customer lock, immediately before the LINE call), contained as an ordinary failed send (cap released, message FAILED, fail-closed); and the entire confirm decision — status guard, ambiguity comparison, restoration value — is made on an **in-lock re-read of the row**, never the pre-lock snapshot (a queued confirm can neither pass the gate on stale evidence nor clobber a legitimate stamp).

**Accepted residual (declared, not a defect):** a DB-connection loss WITHOUT process death while a push is already in flight can render a zombie question after a newer request. Outcome: the system books the customer's NEWEST explicit request — never a superseded slot; the zombie row is structurally unconfirmable. Closing this fully would require provider delivery receipts LINE does not offer.

Gates: full api suite 1834/1834, api tsc 0, workers tsc 0 + 7/7.

## Deferred (documented, not blocking this deploy)

- RECEIPT-03: automated OWNER-journey E2E + real-LINE canary (verify manually post-deploy per the canary above).
- TOOL-03 (expense metadata drift — no authz effect), CUST-09 (docs↔runtime reconciliation), OPS-02/03 (full role/runtime matrix + observability dashboards).
- RECEIPT-05 fix #8 residual: a rare claim-before-upload crash window may leave an incomplete attachment (no orphan double); a redelivery re-drive would fully close it.

## Rollback

Kill switches remain independent: `CRM_AUTO_REPLY_ENABLED=false` disables all customer autonomy; receipt intake degrades to durable manual review; the internal-route DB re-resolution + typed audit actors + booking-proposal gate are all fail-closed. Additive schema stays; no data drop needed to roll back application behavior.
