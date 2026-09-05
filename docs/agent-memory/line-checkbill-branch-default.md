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

- The refusal's TAIL is lane-specific, and that is load-bearing (adversarial review F1). The shared
  sentence carries cause and fix; the caller appends how to get back in:
  - `BRANCH_RETRY_RESEND` — direct photo. The refusal precedes every write, so re-sending works.
  - `BRANCH_RETRY_ANSWER` — pending media. The bytes are still parked, and `ensurePendingMedia`
    (~`:4920`) answers ANY new image with `{ created: false }` while that row lives
    (`PENDING_MEDIA_TTL_MINUTES = 30`), logging `duplicate_media_pending` and storing nothing. A
    re-send here is silently swallowed; answering the same question again is what works. Telling
    this sender to resend would have been the same class of lie as the transient copy.
  `tail` is a REQUIRED argument, not a defaulted one — a forgotten tail is exactly the defect it
  exists to prevent, so the type system asks every call site.

## Open questions

- None blocking. Longer term the honest ambiguous answer would be better as a branch quick-reply in
  LINE rather than a web hand-off; out of scope for a live-bug fix.

## Accepted, not fixed here (adversarial review of e1fea654)

- **F5 — the `resolveSubstituteMediaAnswer` catch is wider than the create.** `updateExpense` and the
  continuation finalize can in principle also raise `TRANSACTION_BRANCH_INVALID` for an ALREADY
  existing record; the branch copy ("จึงยังไม่ได้บันทึกรายการ") would then be slightly off, since a
  draft does exist by that point. Low probability — those paths address a record whose branch was
  already validated — and the alternative (narrowing the catch to the create call) would let a real
  fault escape to the generic dispatcher reply. Left as is; revisit if it is ever observed.
- **F6 — a branch refusal writes no audit row.** Pre-existing on the direct path since 2026-08-27 and
  unchanged here: `audit.log` runs only after a successful create. A refused capture is visible in
  `lineWebhookEventLog` (`clarification_required` / `RECEIPT_BRANCH_SELECTION_REQUIRED`) and at warn,
  but not in the audit trail. Worth fixing with the other "refusals are not audited" cases rather
  than one lane at a time.
- **F7 — two racing "1" answers.** The loser hits `@@unique(companyId, lineMessageId)` on
  `createExpense`, surfaces as a raw P2002, and gets `ERROR_REPLY` — while the winner already
  resolved the row and recorded the draft. The honest answer is "this is already recorded", and a
  `P2002 → already-recorded` entry is the natural next member of `lineCaptureFailureReply`'s map now
  that the map exists. Pre-existing; needs its own copy decision, so not smuggled into this fix.

## Artifacts

- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/api/src/modules/expenses/application/use-cases/expense-document.use-case.ts`
- `apps/api/src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.ts`
- `apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts`
- `apps/api/src/modules/line-ai/application/use-cases/line-capture-branch-default.spec.ts` (new; the
  only `apps/api/package.json` edit is its one-line registration in the `test` list)
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

Mutation checks (each mutant applied alone, spec run, then reverted):

| Mutant | Killed by |
|---|---|
| direct lane skips the shared map | `(c5)` |
| direct lane prints the parked tail | `(c5)` |
| parked lane prints the direct tail | `(c)` |
| drop `status: 'ACTIVE'` from the branch query | 7 of 10 in the focused spec |
| drop `companyId` from the branch query | 7 of 10 |
| drop the `id.in` scope filter | 3 of 10 |
| `branchIds: []` treated as "all branches" (`?.length`) | the empty-scope case |

**Mutex:** `/tmp/mangmee-heavy.lock` is a **mkdir** lock shared with the other sessions —
`mkdir` to acquire, `rmdir` to release. `flock(1)` does not exist on macOS, and an earlier
`fcntl.flock` wrapper here created the path as a REGULAR FILE, which makes every other session's
`mkdir` fail permanently. That file was removed and the wrapper replaced with mkdir/rmdir
(`cb-heavy-lock.sh`); never open this path as a file.

## Next

- Merge, then confirm on UAT with a multi-branch company: send a check bill, answer "1", expect a
  draft on the sender's own branch and the substitute continuation question — not the ⌛ copy.
- The ambiguous branch is now honest but still ends in a web hand-off; revisit if UAT hits it.
