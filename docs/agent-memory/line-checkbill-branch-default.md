# Agent Memory: line-checkbill-branch-default

Status: implemented on `codex/line-checkbill-branch-default`, gates green, not yet merged.
Owner: LINE AI capture lane.
Scope: `apps/api` LINE intake — the branch a LINE-originated expense record is created with, and the
copy a LINE user gets when that record cannot be created.

## Root cause (UAT 2026-09-05 11:41–11:45Z, OA uat-mangmeeplus, build 1399bb83)

A restaurant check bill (Sub Total 725 / VAT 56 / Gratuity 72 / Amount Due 853) was correctly refused
as "not a receipt" and parked with the payment question. Answering **1 — จ่ายแล้ว แต่ไม่ได้ใบเสร็จ**
(webhookEventIds `01M1RP5V2ADDNQWZV0Z89KB0CV`, `01M1RP62NK3DGV0E74THWVDD61`) replied
`⌛ ขออภัยค่ะ เกิดข้อผิดพลาดชั่วคราว กรุณาลองใหม่อีกครั้งนะคะ` both times.

api-web level 40: `line_substitute_media_answer_failed` / `กรุณาเลือกสาขาของรายการก่อนบันทึก`,
terminal `substitute_media_answer_failed`.

`resolvePendingCheckBillAction` → `createReceiptDraftFromPendingMedia` created the draft with
`resolveCreateBranchId(companyId, scopes)` and **no selection**, so `resolveTransactionBranchId`
fell into its "exactly one in-scope ACTIVE branch or throw" rule and raised
`TRANSACTION_BRANCH_REQUIRED` in this multi-branch company. The DIRECT photo path had solved exactly
this on 2026-08-27 (Owner decision, commit `88aef194`, `pickLineDefaultBranchId`); the pending-media
lane and the text-note lane never got the rule. Two failures follow from that:

1. LINE has no branch picker, so a multi-branch company could not answer "1" at all.
2. A deterministic data state was reported with transient copy, so the retry reproduced it verbatim.

## Every LINE-originated expense creation (step 1 enumeration)

| # | Site | What it does now |
|---|------|------------------|
| 1 | `process-line-webhook.use-case.ts:4650` direct photo → `initReceiptUpload.execute({ branchId })` → `expense-upload.use-case.ts:59` | Was the only lane with the rule (inline). Now calls the shared `resolveLineCaptureBranchId`; behaviour unchanged. |
| 2 | `process-line-webhook.use-case.ts:5825` `createReceiptDraftFromPendingMedia` → `resolveCreateBranchId` | **The bug.** Now passes `resolveLineCaptureBranchId(companyId, membershipId, scopes)` as `selectedBranchId`; `resolveTransactionBranchId` still re-validates scope + ACTIVE. |
| 2a | `resolvePendingCheckBillAction` (~`:5365`) — check bill answered `PAID_NO_RECEIPT` | Threads `access.membershipId` into #2. This is the UAT turn. |
| 2b | `resolvePendingMediaAsReceipt` (~`:5657`) — RECEIPT-05 "ใช่ ใบเสร็จ", and the `new_expense` outcome of `resolveSubstituteMediaAnswer` (both reach #2) | Threads `access.membershipId` into #2. |
| 3 | `process-line-webhook.use-case.ts:3392` text capture → `CaptureLineExpenseNoteUseCase` → `CreateExpenseDraftUseCase` (`expense-draft.use-case.ts:95`) | Same latent bug (no `branchId` was ever passed). Now hands the resolved default down through a new optional `cmd.branchId`. |
| 4 | `process-line-webhook.use-case.ts:5596` `captureBeforeSubstituteContinuation` → same use case as #3 | Same fix. |

Checked and **not** affected (no record creation, or the branch comes off an existing record):
`line-substitute-receipt-continuation.use-case.ts` `startFromCheckBill` (reads the expense created by
#2 and only saves continuation state), `substitute-receipt.use-case.ts` (`assertBranch(ctx,
expense.branchId)` throughout), `line-correction.use-case.ts` (updates an existing record),
`line-expense-draft-conversation.use-case.ts` (updates). Bank slips and screenshots are ordinary
media and travel lanes #1/#2. LINE reimbursement is handoff-only and creates nothing.
`createExpense(` has exactly one call site in the whole LINE lane (#2).

## Decisions

- ONE private helper `ProcessLineWebhookUseCase.resolveLineCaptureBranchId(companyId, membershipId,
  scopes)` returns `pickLineDefaultBranchId(...)`; `undefined` still means ambiguous. Every LINE lane
  calls it, `resolveTransactionBranchId` still re-validates, and the review lane keeps the branch
  editable — no change to the Owner rule itself.
- The ambiguous answer **matches the direct path**: reply `RECEIPT_BRANCH_REQUIRED_REPLY`, terminal
  `clarification_required` + `RECEIPT_BRANCH_SELECTION_REQUIRED`, no record written, and the pending
  media row is left **PENDING** so the sender can act again (the direct path has no row to resolve
  at that point, so "leave it untouched" is the same outcome).
- `RECEIPT_BRANCH_REQUIRED_REPLY` now says "เอกสาร" not "ใบเสร็จ" — the same refusal now answers the
  check-bill lane, where calling the document a receipt is the exact claim the question exists to
  avoid — and states that nothing was recorded plus the two ways out (web app picker, or an admin
  setting the member's default branch).
- New exported `lineCaptureFailureReply(error)` is the single map from a deterministic domain code to
  copy + terminal status. Only `TRANSACTION_BRANCH_REQUIRED` / `TRANSACTION_BRANCH_INVALID` are
  mapped: those are the codes this create path can raise for a data state. Everything else keeps
  `ERROR_REPLY` and its retry. It replaces the inline check the direct path already had, so the two
  lanes cannot drift.
- Drain warn (step 4 read): `ai.line.ledger.follow_up_failed` … "waiting_user entry still inside the
  clarify window" is an **expected state logged as a failure**, not a real failure. `processEntry`
  throws to mean "leave it in the PEL — the live turn path owns this answer". Downgraded via a typed
  `LedgerEntryHeldError` → `debug` `ai.line.ledger.entry_held`. Behaviour is byte-identical (still
  unacked, still no outcome counter); only the level and the message change.

## Open questions

- None blocking. Longer term the honest ambiguous answer would be better as a branch quick-reply in
  LINE rather than a web hand-off; out of scope for a live-bug fix.

## Artifacts

- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/api/src/modules/expenses/application/use-cases/expense-document.use-case.ts`
- `apps/api/src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.ts`
- `apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts`
- `apps/api/src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.spec.ts`

## Verification

Red-first, production files stashed vs. applied, same spec:

- `line-intake-dispatch.use-case.spec.ts` — RED 172 pass / 6 fail, GREEN 178 pass / 0 fail.
  The 6: (a) membership default branch, (b) sole head office, (c) ambiguous → honest reply + row
  PENDING + `RECEIPT_BRANCH_SELECTION_REQUIRED`, (c2) `TRANSACTION_BRANCH_INVALID` mapped the same,
  (d) RECEIPT-05 answer, (f) text-note lane end to end through the REAL capture use case.
  (c3) "unknown fault keeps the transient copy" and (e) "direct photo unchanged" are guards: green
  before and after.
- `drain-line-ledger.use-case.spec.ts` — RED 23/24, GREEN 24/24 (new: a fresh `waiting_user` entry is
  held with no ack and **no** warn).
- `process-line-webhook.use-case.spec.ts` + `expense-document.use-case.spec.ts` +
  `line-receipt-branch.logic.spec.ts` — 240 pass / 0 fail.
- `tsx --test src/spec-suite-coverage.spec.ts` — 3 pass (no new spec file, so no package.json edit).
- `pnpm --filter @watchdog-bms/api typecheck` — clean.
- `node apps/api/scripts/check-di-metadata.mjs` — 789 files, 863 decorated classes, 813 with
  constructor dependencies, all carry `design:paramtypes`.
- `pnpm --filter @watchdog-bms/api test:boot` — Nest resolved every provider in 145ms.
- Full fixed api list (464 spec files) — 6712 tests, 1355 suites, **6613 pass / 0 fail**, 99 skipped,
  43.6s.

`flock(1)` does not exist on macOS; the mutex was held with an equivalent `fcntl.flock` wrapper on
`/tmp/mangmee-heavy.lock` for the full-suite run.

## Next

- Merge, then confirm on UAT with a multi-branch company: send a check bill, answer "1", expect a
  draft on the sender's own branch and the substitute continuation question — not the ⌛ copy.
- The ambiguous branch is now honest but still ends in a web hand-off; revisit if UAT hits it.
