# Agent Memory: web-receipt-ocr-review-edit

Status: **CLOSED 2026-07-10 — all phases shipped + committed** (W1 `6ba67242`, W2 `f3a53272`, W4a e2e `7948cc2b`, W3 `f8d5c348`, W4b docs in final commit). Deploy NOT executed this round (same posture as gap-closure harness — dirty shared worktree ships on next deploy).
Owner: thawtchai (owner decisions in spec §19a, 2026-07-10)
Scope: Closed two prod-pilot gaps: (1) web receipt upload never triggered OCR (only LINE path did) → drafts stayed ฿0/no vendor; (2) web review panel could not edit vendor/amounts/lines ("ราคาไม่ตรง" uncorrectable).
Decisions:
- Request-driven synchronous extraction, no queue/worker, no schema change (spec §19a.1). Web calls `POST :expenseId/extraction-request` right after upload complete; same endpoint is the retry.
- Permission: `expense.ocr.request` | `expense.review` | uploader-own-draft with `expense.receipt.upload` (§19a.2). Route decorator `expense.read_own` matches the `GET :expenseId` pattern (guard is hasAll; MANAGER/FINANCE/STAFF all hold read_own).
- Apply-logic moved verbatim to expenses `ReceiptOcrApplyService`; LINE webhook delegates (pure lift — no behavior drift). Expenses module has zero line-ai imports.
- JPEG/PNG only, ≤10MB; PDF → `unsupported` manual review (§19a.4). `not_configured` when AI gateway secret/Typhoon key absent.
- Storage: `AttachmentStoragePort.getObject` added (S3 GetObjectCommand + local fs); local adapter now persists uploads to tmpdir (was drain-and-discard) so local getObject works.
- W3 replaced the read-only lines table with the editable form (values still visible read-only via disabled inputs); per-line reviewStatus chips dropped — acceptable ponytail trade, revisit if reviewers miss them.
- Executor: `codex exec -m gpt-5.6-sol -c model_reasoning_effort="xhigh" -s workspace-write`; Claude gated each phase (diff-vs-intent + boundary + business), ran real gates, committed explicit paths. W2 ∥ W4a ran in parallel (disjoint file scopes).
Open questions: none.
Artifacts: spec addendum `docs/specs/expense-receipt-upload-spec.md` §19a (+Shipped line); plan `docs/plans/web-receipt-ocr-review-edit-codex-handoff.md`; API `expense-extraction.use-case.ts`, `receipt-ocr-apply.service.ts`, `receipt-ocr.client.ts`; web `ExpensesPages.tsx` (upload wiring, banners, retry, edit form, mismatch warnings), `expenses.model.ts` (`hasAiGrandTotalMismatch`, `buildExpenseDraftReviewPayload`); e2e EXP-07/08 (prior EXP-07 renamed EXP-09).
Verification:
- W1: contracts build PASS; api typecheck PASS; full api suite (real `pnpm test`) 1,448/1,448 PASS.
- W2: web typecheck PASS; web production build PASS (codex sandbox couldn't fetch fonts; Claude ran it); live e2e expenses 9/9 PASS (S3_E2E=1, MinIO :19000, postgres :5432).
- W3: web tests 220/220 PASS (glob script — no registry needed); web typecheck PASS; web production build PASS; live e2e expenses 9/9 PASS again.
- W4a: EXP-07 (real MinIO upload → extraction `not_configured` → stays NEEDS_REVIEW) + EXP-08 (PATCH lines 2×150 → server-recomputed 300 → mark-ready → confirm) both green live.
Next: nothing pending in this harness. Ops follow-ups live elsewhere: deploy (canary posture per [[project_ecs_express_canary_verify]] memory), Typhoon key present in prod env → extraction returns `ok` there; PDF OCR remains backlog (spec §20).
