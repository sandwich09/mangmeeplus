# Expense/Reimbursement Audit Fix Plan (2026-08-05)

Source findings: `docs/agent-memory/expense-journeys-audit.md` (commit b0fd9ce6).
Execution rule: design → implement (smallest correct diff, ponytail full) → focused test → commit per fix → second review pass at the end.

STATUS 2026-08-05: ALL SHIPPED (commits 92835028..8bb0622c). Final gates: api suite exit 0, web 705/705, ai-gateway 518/0, workers 15/0. Live smokes: ISO capture-policy 200; upload→OCR→preview renders (inline + crossOrigin); reason-less claim blocked with Thai message; claim WITH reason submits; two consecutive claims BOTH notified (blackout gone, OWNER included); stranded RB-202608-00021 recovered via ดำเนินการต่อ → READY → PAID; parked routes redirect. Extra discovery during smoke: ORB blocks opaque no-cors storage loads even with inline+image/png — previews additionally load with crossOrigin=anonymous (1f752be6). No `package.json` edits. Owner exclusions: company-signature = disable feature, account-security = disable feature, DOB initial password = keep (first-login force-change already enforced by `mustChangePassword` + auth.guard).

## Fix list (one commit each)

F1. NOTI-COOLDOWN (highest impact) — event-triggered reimbursement rules carry `cooldownSeconds: 3600` and `RunWorkflowRuleUseCase` skips inside cooldown per RULE (`workflow-runner.use-case.ts:47`), so after one claim, every other claim's notification inside an hour is silently dropped (verified live: RB-202608-00021 submit+approve both MATCHED, zero runs, zero logs).
   - Set `cooldownSeconds: 0` for the four EVENT templates (`reimbursement_pending_approval`, `reimbursement_decision_requester`, `reimbursement_ready_for_payment`, `reimbursement_payment_recorded`) in the catalog default; keep scan templates (SLA breach) on 3600. Per-event dedup already prevents true replays (`event:<eventKey>` unique).
   - Make `sync-workflow-templates` (and template auto-update path, if separate) push the new cooldown to existing materialized rule versions.
   - Observability: ingest currently discards the runner's `{status:'SKIPPED', reason}` — record reason (cooldown/duplicate/condition) into `WorkflowEventInbox.errorCode`/log line so silent drops are visible.
   - Test: runner spec — two events, same rule, cooldown 0 → two runs; cooldown 3600 → second SKIPPED with recorded reason.

F2. BUG-7 REIMB-STRAND — claim w/o receipts + w/o reason + waive policy strands at FINANCE_REVIEW after อนุมัติจ่าย (projection confirm throws → 409 swallowed by web → no retry lever; `completeFinanceProjectionAtomic` never runs).
   - Submit-time guard (`SubmitReimbursementRequestUseCase`): when any line lacks a receipt AND `missingReceiptReason` blank → 400 `missing_receipt_reason_required` (regardless of waive policy — the projection needs the reason later).
   - Create page: mark the reason field required-when-receiptless (label "จำเป็นเมื่อไม่มีใบเสร็จ"), client validation mirrors server.
   - Recovery: finance queue/drawer — when `status=FINANCE_REVIEW && financeReviewStatus=APPROVED_FOR_PAYMENT` show "ดำเนินการต่อ" that re-invokes the same finance decision endpoint (saga is documented retry-safe; verify `beginFinanceApprovalAtomic` tolerates already-approved, adjust guard if needed).
   - Error surfacing: web finance mutation must show the API error (currently invisible).
   - Test: submit-without-reason 400; with-reason full flow → READY_FOR_PAYMENT; stranded fixture + retry → READY.

F3. BUG-3 MISSINGFIELDS — unknown AI `missingFields` keys ('buyerName','description','categorySuggestion',…) permanently disable ส่งตรวจสอบ client-side with a misleading tooltip; server accepts mark-ready.
   - Web `expenseAiMissingFields` (expenses.model.ts): allowlist — track only keys the UI can clear (vendor,vendorName,vendorTaxId,documentNumber,expenseDate,vatAmount,grandTotalAmount,amount → data; category → evidence); ignore everything else. Spec updated.

F4. BUG-2 EMPTY-201 — `authed-fetch.ts:148` handles only 204; 201-empty responses (duplicate dismiss/confirm) throw raw JSON error though persisted; dialog hangs.
   - Parse via text(): empty body → undefined, else JSON.parse. Covers every empty-body endpoint. Spec for both shapes.

F5. BUG-1 PROXY-TIMEOUT — Next rewrite proxy default (~30s) kills >30s OCR; UI claims failure though extraction applied.
   - `next.config.mjs` `experimental.proxyTimeout` ≥ API OCR abort (120s) + margin (verify units against installed Next). Web extraction-catch: before showing failure, refetch the expense once; if `aiVerifiedAt` advanced, treat as success (prevents double-run + acknowledgement wipe).

F6. BUG-5 CAPTURE-POLICY 422 — web sends `?on=<ISO datetime>`; API rejects → silent FULL fallback + 422 spam.
   - Server: accept full ISO by normalizing to date (fixes all shipped clients); keep web param as-is or trim to YYYY-MM-DD (pick one during implementation, server-normalize preferred). Spec: ISO datetime accepted.

F7. BUG-4 ORB-IMAGES — presigned GET carries `response-content-disposition: attachment`; Chrome ORB blocks <img> embeds → broken previews.
   - Download-url endpoint (or storage presign helper): support inline disposition for image/* when caller requests preview (query param `disposition=inline` or `download=0`); web preview callers pass it; explicit download keeps attachment. Spec.

F8. BUG-6 LOCKED-STEPPER — after substitute ISSUED, step-1 "ถัดไป" save 409s (`substitute_evidence_locks_expense`) silently; user stuck.
   - ExpenseReviewPage: when detail has ISSUED substitute evidence (locked), skip the save-on-navigate (form is read-only) and navigate; surface the lock as an info banner. Spec for the nav predicate.

F9. EXPORT — (a) evidence-panel 0-row guard (mirror ebed6dfb list fix), (b) list-page export forwards the active status chip + branch: add `branchId` to `SharedEvidenceFilter` → repo where (validated against ctx scopes) → UI passes current branch + status chip. Search box stays list-only (no API support; out of scope). Truncated>200 already flagged by API; show notice when `truncated`.

F10. OCR-FOLD VISIBILITY — discount/charges folded into a summary line invisibly; placeholder "Receipt OCR line" leaks.
   - Review page: when `aiVerificationSummaryJson.chargeReconciliation.status` = FOLDED_INTO_SUMMARY_NEEDS_REVIEW/SUMMARY_LINE with charges>0 or a dropped discount, render a warn hint ("AI พับส่วนลด/ค่าบริการเข้ารายการเดียว — ตรวจยอดกับใบเสร็จ").
   - Fallback line description: use OCR summary/vendor text instead of the literal "Receipt OCR line" (locate producer and replace with Thai fallback).

F11. UI-FRESHNESS — reject leaves header ฉบับร่าง; finance queue keeps stale row after approve.
   - Refetch detail after reject/void/confirm actions; refetch finance queue after decision mutation success.

F12. LINE-AI PARITY — (a) `reimbursement.list_pending_approvals` require `reimbursement.approve` (registry + use case) and reuse `ListApprovalQueueUseCase`; (b) `expense.list_recent`: pending bucket per `EXPENSE_PENDING_STATUSES` (draft+extracting+needs_review+ready) so WIP isn't under-reported, `total` = counted (non-cancelled) with `cancelledCount` kept, page loop capped (≤10 pages, `truncated` flag); (c) LINE webhook identity lookup filters `providerChannelId` when the webhook's channel id is known, with channel-less fallback + warn (mirrors notification delivery pattern). Tests: line-ai business coverage suite + targeted specs.

F13. SEED-CATEGORIES — global default categories silently skipped (`.catch(()=>{})`, NULL-unique quirk). findFirst-then-create per name; drop the silent catch. Boot-safe test not needed (seed script); verify by rerun on local.

F14. DISABLE COMPANY-SIGNATURE (owner decision) — hide nav item + expenses "signatures" tab + route redirect → expenses list; LINE `SIGNATURE_UPLOAD_TICKET` intent replies "ฟีเจอร์ปิดปรับปรุง". API stays (data preserved, permission-gated). Substitute-receipt per-certificate signatures unaffected.

F15. DISABLE ACCOUNT-SECURITY PAGE (owner decision) — remove settings menu card + header menu entry; route redirect → dashboard. Header "รีเซ็ตรหัสผ่าน" now points to `/change-password` (the real form — also closes GAP-S9). PDPA note: LINE-AI opt-out lost its only UI; recorded as accepted trade-off while the page is off.

F16. NOTI-RECIPIENTS — `reimbursement_pending_approval` recipients `['MANAGER']` → `['MANAGER','OWNER']` (matches `matchesApproverRole` OWNER wildcard; owner-only companies currently get nothing) + new template `reimbursement_finance_review` (event `reimbursement.finance_review_updated`, recipients by permission `reimbursement.finance_review`) so the finance queue is notified; notification body strings include requestNo + amount (title≠body). Sync path must update existing companies.

Deferred (explicit, with reason):
- Expense/OCR notification templates — new feature (needs spec/plan per AGENTS.md docs-first rule).
- `expense.get_breakdown` direct-Prisma refactor — behavior correct today; parity spec added under F12(b) scope if cheap, else noted.
- Excel `service_charge` column — no line-level charge-kind column exists (GAP-8); needs schema/spec work.
- Multi-company non-owner LINE lockout — deliberate policy; product call.
- 2FA/lockout/session list/reset-password revival — inside the disabled account-security scope.

Verification protocol per fix: focused unit/spec run + typecheck of touched app; end-of-batch: api test (touched suites), web tests, e2e expenses+reimbursements specs, screen smoke (upload→confirm, claim submit w/o reason blocked, noti for two consecutive claims).
