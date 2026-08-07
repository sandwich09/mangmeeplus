# Agent Memory: expense-journeys-audit

Status: Audit complete + fix batch SHIPPED (2026-08-05, commits 92835028..8bb0622c; plan docs/plans/expense-audit-fix-plan.md). Owner exclusions honoured: company-signature parked, account-security parked (reset-password menu now points at /change-password), DOB initial password kept (first-login force-change verified). Notification blackout root cause was per-rule cooldownSeconds=3600, fixed to 0 for event templates + resync; BUG-7 got submit-time reason guard + ดำเนินการต่อ retry (RB-202608-00021 recovered to PAID live).
Owner: AI session (Claude) with owner Thawatchai
Scope: Real-screen + code-level audit of expense upload/manual/substitute journeys, categories, company signatures, substitute-receipt settings, Excel export, reimbursement (new create page), delete/reject/edit flows, security + employee/role flows, notifications (web bell + LINE per person), LINE AI consistency.

Decisions:
- Audit only — bugs recorded here and reported, not fixed in this pass (owner to prioritize).
- Local stack for verification: docker infra + API dist e2e-3001 (rebuilt to HEAD after PR #77 — the merge changed `expense-draft.use-case.ts`, so pre-merge dists are stale), web dev :3006, ai-gateway dist :3002 (its `dev` script is unusable: tsx strips decorator metadata → DI gets undefined), workers dist.

Confirmed working end-to-end on real screens (evidence: EXP-202608-00002..7, RB-202608-00021, SRC-...-V1):
- Upload→OCR→guided review→confirm for VAT / no-VAT / WHT(3%, ภ.ง.ด.53 field enforced) / discount / service-charge receipts. OCR (Bedrock claude-sonnet-4-6) reads amounts near-perfectly; Thai vendor names/tax-ids sometimes misread → review step catches.
- Duplicate detection (same doc number) with governed dismiss/confirm + reason.
- Manual entry (no WHT field by design gap), substitute receipt full lifecycle: fail-closed policy → settings page → prepare (category required) → payer position+preview+signature(bg-removal) → cross-user approve (ณัฐชา via policy) → ISSUED SVG → expense auto PAID → confirm.
- Categories CRUD+archive; signature upload→approve lifecycle (but consumption = dead code); Excel export summary/full 44 cols (WHT/VAT/discount included; no service-charge column); reject→reopen→delete; void with reason; ปฏิเสธ chip; delete guards (EXPENSE_NOT_DELETABLE).
- Employee wizard 4 steps → active user; role edit Staff→Sales + OWNER-escalation 403; custom role via preset builder (64 perms materialized); account security page (recovery email pending, AI opt-out, revoke-other-sessions → "146 session").
- Notifications: outbox→workers→NotificationEvent→per-person deliveries. WEB=SENT (bell badge rose live 13→16), LINE=SKIPPED `NO_LINE_DELIVERY_TARGET` (no ExternalIdentity provider=LINE locally; channel token exists in .env). LINE AI coverage suite 189/0.

Top bugs found (BUG-1..7 + key gaps; full detail in session report 2026-08-05):
1. BUG-1: Next rewrite proxy default 30s timeout kills >30s OCR responses; UI shows "ระบบขัดข้อง" though extraction succeeded server-side (double AI spend risk + GAP-10 wipes acknowledgements on re-run). Fix: `experimental.proxyTimeout` or async extraction.
2. BUG-2: `authed-fetch.ts:148` only handles 204; endpoints returning 201-empty (duplicate dismiss/confirm) crash client with raw "Unexpected end of JSON input" though server persisted. Also breaks the duplicate dialog UX.
3. BUG-3: any AI missingFields key outside the 9-key clear map (`buyerName`, `description`, `categorySuggestion` observed) permanently disables ส่งตรวจสอบ client-side with a misleading tooltip; server accepts mark-ready. Full tax invoice w/o printed buyer = guaranteed trigger.
4. BUG-4: receipt previews via download-URL variant (`response-content-disposition=attachment`) get ERR_BLOCKED_BY_ORB in Chrome → broken images intermittently.
5. BUG-5: `capture-policy?on=<ISO datetime>` → 422 spam; client silently falls back to FULL mode (fail-open on tax questions).
6. BUG-6: after substitute ISSUED, stepper's save-on-next hits 409 substitute_evidence_locks_expense silently → user stuck on step 1; chip-click bypass is undiscoverable.
7. BUG-7 (HIGH): claim w/o no-receipt reason + line w/o receipt + policy waiver → finance อนุมัติจ่าย succeeds, projection expense stays READY_FOR_CONFIRMATION, request stranded FINANCE_REVIEW forever; no UI error/retry; reconcile script no-ops; create-page labels reason "(ถ้ามี)".
8. Notification reliability: workflow business-event runner stopped creating runs after initial batch locally (last 10:44:00; SLA scan + delivery sweep still fine) with zero error logs. Verify in staging.
9. Security highlights (agent map + screen-proven): employee initial password = DOB DDMMYYYY, never expires (regenerate path is random+72h — creation should match); password change not audited & doesn't revoke sessions; self-serve reset = dead code; email = no-op outside local; no 2FA/lockout/session list; header "รีเซ็ตรหัสผ่าน" → page without password form.
10. Dead code confirmed: company-signature fill (`fillSignature` 0 callers — signatures approved but never stamped anywhere though the UI promises step 3), `SignatureFillRecord` read side, ReceiptExtraction/ReceiptAiVerification tables, EXTRACTING status, AbacModule/CompositePolicyEvaluator, workers' LINE adapter.
11. LINE AI: read-only surface, permission-rechecked; sharpest divergence = `reimbursement.list_pending_approvals` gates on `reimbursement.read` (web queue needs `reimbursement.approve`) + direct repository access (violates gateway rule). expense.list_recent buckets omit EXTRACTING/NEEDS_REVIEW/READY (under-reports WIP), no VAT/overdue answer over LINE.

Artifacts:
- Fake receipts + export xlsx + signature PNGs in session scratchpad (temporary).
- No repo code changes; this memory doc is the only commit.

Verification:
- api LINE-AI business coverage: 189 pass / 0 fail (2026-08-05).
- Screen walkthroughs in Browser pane against local stack @ HEAD 0719c2ae; DB evidence via psql (delivery rows, role rows, credential expiry).

Next:
- Owner to prioritize BUG-1/2/3/7 + GAP-E1 (DOB password) before launch; parked WHT follow-ups unchanged (see wht-settlement-capture memory).
