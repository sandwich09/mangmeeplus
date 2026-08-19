# LINE Substitute-Receipt Assisted Issuance Implementation Plan

## Status

- State: Ready for implementation — spec v0.2 owner-decided 2026-08-18 (D1–D9, no open questions); this plan authored 2026-08-19 after re-verifying every spec §5.A code fact against the current tree. No code changed yet.
- Trigger: two UAT screenshots (2026-08-18 `สร้างใบทดแทนใบเสร็จ ค่าวินมอไซต์ ... 50 บาท`, 2026-08-19 `สร้างใบแทนใบเสร็จได้ไหม`) both dead-ending in the hard-coded `ยังระบุรายการค่าใช้จ่ายไม่ได้ค่ะ` reply with a non-clickable relative link.
- Owner: thawatchai
- Phases map 1:1 to spec §18 rollout steps. Each phase is independently releasable and independently reversible; do not start phase N+1 before phase N's exit checks are green.
- Phase 1 is a pure defect fix (no policy/boundary change) and may ship alone ahead of everything else.

## Linked Spec

[[specs/line-substitute-receipt-assisted-issuance-spec|LINE Substitute-Receipt Assisted Issuance Spec]] v0.2 — R1–R16, journeys A/B/C, §11 media classification, §12 delivery links, §13 badges, §16 acceptance criteria. This plan does not restate rules; it locates them in code.

## Purpose

Let a staff member produce a complete, legally usable `ใบรับรองแทนใบเสร็จรับเงิน` for a small out-of-pocket expense from LINE alone, with exactly one web visit at the signing/approval moment, and get the finished document back in the chat. Kill the current dead-end (discarded input, unchecked permission, unclickable link) as step one.

## Current Repository Context (anchors re-verified 2026-08-19)

Dispatcher — `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`:
- Substitute vocabulary guard + continuation dispatch: `:1437-1489` (guard `:1439-1440`, `execute` call `:1446`, `recentCandidates` from `recentCapturedExpenses` `:1449`, reply delivery `:1458-1487`). Runs BEFORE the intake router.
- Intake router: `tryRouteIntake` `:1495-1508`; text capture branch `EXPENSE_DOCUMENT_CAPTURE` `:1544-1632` (`captureExpenseNote.execute` `:1573`, `LineTextExpenseCaptureIncompleteError` → clarify `:1590-1609`).
- Pending-media capture→continuation chain (the R1 pattern to reuse): `:2800-2859` — captures the expense, then runs the continuation with `recentCandidates: [{id: newExpenseId, …}]` and merges both replies (`:2819-2836`).
- Correction candidates: `loadCorrectionCandidates` `:2885-2911`, 24 h window `CORRECTION_CANDIDATE_WINDOW_MS` `:168`; repository filter `listRecentLineCaptures` `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:2223-2256` (captureSource `LINE_UPLOAD`, same `chatKeyHash`, status DRAFT/NEEDS_REVIEW/READY_FOR_CONFIRMATION) — a first-time requester always has zero candidates.
- `absoluteWebLink` `:305`; `formatPaypersReply` `:1612`; signature ticket branches `SIGNATURE_UPLOAD_TICKET` `:1695`, `:2315`.

Continuation — `apps/api/src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.ts`:
- Dead-end fallback copy `:397-409` (hard-coded relative link `:406`); multi-target selection `:392-395`; returns before any permission check.
- `workflowLink` (relative) `:291-293`; `resumeCapsule` `:295-307`; `formatResult` `:309-348` (link line `:341`); `preflight` `:211-256` (`supporting_evidence_required` `:250`, `payment_evidence_required` `:251-254`); `QUESTIONS` `:258-266`; `execute` `:377-513` (cash policy fallback `:469`); `loadForWeb` `:354-375`.

Card renderer — `apps/api/src/modules/line-ai/domain/logic/line-business-card.logic.ts`:
- `safeTenantLink` `:17-30` (same-origin AND under `/companies/{companyId}/` only); `bubble` `:44-84`; `buildLineAssistantTextCardMessage` `:87-109` — lifts ONLY absolute `https?://` URLs into buttons (`:93`); a relative path stays plain text.

Web-only substitute lifecycle — `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts`:
- `assertWeb` `:63`; Prepare `:365-487` (assertWeb `:375`, `expense.review` `:376`, supporting-attachment hard throw `:424`, cash policy `:435-440`, payment date `:441-442`, audit `:468-472`, payer-pending notify `:474`); Preview `:490`; PDF download `:513-566` (ISSUED/SUPERSEDED only `:520-524`, `stateStamp` param `:541-544`); Certify `:600` (assertWeb `:612`, SVG+signature `:633`); Approve `:696` (assertWeb `:705`, cash policy re-check `:744`, dual-signature SVG `:761`, approver notify `:672`); signature resolution helper `:951` → `findPersonalSignatureAttachment` `prisma-expense.repository.ts:1048-1066` (metadataJson pinned to `{generatedFor, evidenceId, role}` — one upload per evidence per role, no reuse).
- Renderer: `renderSubstituteReceiptSvg` (with/without signatures), `renderSubstituteReceiptPdf(svg, documentNumber, { stateStamp })` — watermark is a parameter.

Signature library — `apps/api/src/modules/expenses/application/use-cases/signature-asset.use-case.ts`: Create `:36`, Approve→ACTIVE `:87-97`, Fill requires ACTIVE `:197-216`, List `:243`. Model `CompanySignatureAsset` `apps/api/prisma/schema.prisma:2412-2435` — has `submittedByUserId` + `derivedAttachmentId`, no per-user owner column.

Schema — `apps/api/prisma/schema.prisma`: `ExpenseSubstituteReceiptEvidence` `:2458-2517`; `ExpenseSubstituteReceiptPolicy` `:2519-2533` (`cashEvidencePolicy` default `REQUIRE_SEPARATE_PAYMENT_EVIDENCE` `:2524`).

Contracts — `packages/contracts/src/expenses.ts` (`LineSubstituteReceiptPrefill` `:705`, `ExpenseCashEvidencePolicy`); `packages/contracts/src/line-ai.ts` (`LineAiAnswerCard` `:536`).

Web — wizard page `apps/web/app/(workspace)/companies/[companyId]/expenses/substitute-receipts/new/page.tsx` → `apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx`; settings `SubstituteReceiptSettingsPage.tsx`. Both carry `REQUIRE_SEPARATE_PAYMENT_EVIDENCE` fallbacks (Phase 2 sweep list below).

Tests: `line-substitute-receipt-continuation.use-case.spec.ts`, `substitute-receipt.use-case.spec.ts`, `substitute-receipt-policy.use-case.spec.ts`, `substitute-receipt-download.use-case.spec.ts`, `line-business-card.logic.spec.ts`, plus the webhook dispatcher specs beside `process-line-webhook.use-case.ts`.

## Implementation Rules

- Ponytail full: shortest correct diff; reuse the pending-media capture→continuation pattern (`:2800-2859`), `CaptureLineExpenseNoteUseCase`, `extractValues`, `formatResult`, the signature library, and the existing pending-media clarification mechanism. No new dependencies. No speculative abstraction ("other document types" stays out — D6).
- Deterministic guards decide every write; AI classifies/routes only. The §11 media classes and R1 fact-detection are deterministic signals first (amount candidates, caption keywords, awaiting-scan state), model assist only where the spec says so.
- Additive contract changes only; older gateway/web keep working through every phase.
- AI Gateway stays out of direct repositories; everything below goes through permission-checked use cases.
- Every phase lands with its focused checks green before the next starts; every schema change is one additive migration.

## Scope

### In Scope

Phases 1–5 below = spec §18 steps 1–5: dead-end fixes; capture-first guard order + evidence-policy defaults; reusable signatures; LINE prepare + unsigned form + paper route + media classification; delivery links + badges + ISSUED push-back.

### Out of Scope

- `ใบสำคัญรับเงิน` / `ใบสำคัญจ่าย` issuance (R15 explains and stops — D6).
- Signing or approving inside chat (D4); moving certify/approve/preview/download off `assertWeb`.
- Input-VAT treatment changes; bulk/recurring/mileage; OCR/QR matching of returned forms (D9 is chat-context + one question; QR is a later optimisation).
- Migrating existing `cashEvidencePolicy` rows (R6 is new-rows-only).

## Phase 1 — Kill the dead-end: absolute links, permission gate, shared formatter (spec R2/R3; §18.1)

### Goal

The screenshot reply becomes: permission-checked, formatter-produced, echoes what was understood, and carries a tappable button. No behavioural/policy change.

### Changes

`line-substitute-receipt-continuation.use-case.ts`:
1. `execute` input gains optional `webBaseUrl?: string`. Add a tiny local `absoluteLink(webBaseUrl, path)` (same semantics as `absoluteWebLink` `process-line-webhook.use-case.ts:305`; falls back to the relative path when `webBaseUrl` is unset so dev/test behavior degrades, never crashes).
2. Early permission gate at the top of `execute`: no `expense.review` → return new `FORBIDDEN` result (formatter-produced: who may do this, no link) BEFORE target discovery. Today the no-target branch (`:397-409`) exits before `preflight` ever checks it.
3. Replace the hard-coded `TARGET_REQUIRED` copy (`:399-408`) with a formatter-produced reply: echo the values `extractValues` understood from this message labelled `ยังไม่บันทึก` (nothing is persisted until a target exists — Phase 2 adds capture), list numbered candidates when present, one next question, and the absolute wizard link.
4. Every emitted path (`workflowLink` results, `formatResult` `:341`, `resumeCapsule` `:305`, STALE `:328`) goes through `absoluteLink`.

`process-line-webhook.use-case.ts`: pass `webBaseUrl: this.config.webBaseUrl` at both continuation call sites (`:1446`, `:2821`).

### Tests / Verification

- Extend `line-substitute-receipt-continuation.use-case.spec.ts`: FORBIDDEN without `expense.review` (reply has reason, zero links); TARGET_REQUIRED echoes extracted values + absolute URL; every status reply asserts **no** bare `/companies/` string when `webBaseUrl` is set; existing cases stay green.
- `pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.spec.ts` (the repo's runner is `tsx --test`), plus `tsc --noEmit` for `apps/api`.

### Exit / Rollback

Spec §16 bullet "no relative link, no link without permission" passes for the conversation surface. Rollback = revert one commit; the new input field is optional/additive.

## Phase 2 — Capture-first guard order + evidence-policy defaults (spec R1, R5, R6; §18.2)

### Goal

`สร้างใบทดแทนใบเสร็จ ค่าวินมอไซต์ … 50 บาท` from a first-time user creates the draft, opens the continuation on it, and replies with recorded values + full blocker list + one question. A cash expense with zero attachments can reach `ISSUED` on the web under default policy.

### Changes

R1 — `process-line-webhook.use-case.ts` substitute guard block (`:1439-1489`):
- Before dispatching the continuation, when the message carries an amount candidate (`extractValueCandidates(normalizedText).amounts.length > 0` — reuse the already-computed `valueCandidates` near `:1504` by hoisting it above the guard) AND `canCaptureExpense` AND `this.captureExpenseNote`: run `captureExpenseNote.execute` first (same call shape as `:1573`), then run the continuation with `recentCandidates: [{ id: captured.expense.id, label: … }]`, merging both replies — mirror the pending-media chain `:2819-2836` verbatim in structure (including its try/catch degradation copy).
- `LineTextExpenseCaptureIncompleteError` or no capture permission → fall through to the Phase-1 target-selection reply, never the old dead-end.
- Keep the existing behaviour when an OPEN/PAUSED continuation already exists (states-first resolution in the use case is unchanged).

R5 — `substitute-receipt.use-case.ts` Prepare:
- Delete the hard throw `:424`. Zero-attachment prepare is legal; `businessPurpose`/`missingReceiptReason`/payer/payment date guards all stay.
- Audit metadata gains `evidenceCount: allIds.length` (`:471`) so every self-certified no-evidence document is listable in one query.
- LINE preflight (`line-substitute-receipt-continuation.use-case.ts:250`): `supporting_evidence_required` becomes an ask-once collectable blocker — new accepted value `evidenceNone: boolean` (deterministic extraction of `ไม่มีหลักฐาน/ไม่มีสลิป/ไม่มีรูป` when it is the pending field); declared-none clears the blocker; a yes-I-have answer keeps pointing at web upload. The assistant always asks; silence is the fallback, not the happy path.

R6 — cash default flip (new rows only; no data migration):
- `schema.prisma:2524` default → `ALLOW_SUPPORTING_EVIDENCE_ONLY` + one additive migration (`ALTER TABLE … SET DEFAULT`).
- Sweep every `?? 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE'` fallback to `?? 'ALLOW_SUPPORTING_EVIDENCE_ONLY'`: `substitute-receipt.use-case.ts:436,744`, `line-substitute-receipt-continuation.use-case.ts:469`, `substitute-receipt-policy.use-case.ts`, `packages/contracts/src/expenses.ts`, `apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx`, `SubstituteReceiptSettingsPage.tsx`, `ExpensesPages.tsx` (grep to confirm the closed list at implementation time).
- Non-cash expenses keep requiring payment evidence (`:435-439` non-cash branch, preflight `:251-254`) — a transfer slip exists by nature.
- Web wizard: remove any client-side ≥1-attachment requirement so it matches the API (verify in `SubstituteReceiptWizardPage.tsx` while sweeping).

R15 (wrong-document detection) is deferred to Phase 4 where the conversation surface is already open.

### Tests / Verification

- Dispatcher spec: combined message → one turn creates draft + opens continuation + single merged reply; incomplete text falls to target selection; no path reaches the removed dead-end copy.
- `substitute-receipt.use-case.spec.ts`: zero-attachment cash prepare at a large amount succeeds under default policy and audits `evidenceCount: 0`; non-cash without payment evidence still throws; explicit `REQUIRE_SEPARATE_PAYMENT_EVIDENCE` rows still enforce.
- Continuation spec: `evidenceNone` ask-once flow.
- `pnpm --filter @watchdog-bms/api exec prisma migrate dev` on a scratch DB; focused API suites + contracts/web typecheck.

### Exit / Rollback

Spec §16 bullets 1 and 3 pass. Rollback: revert code commit; the default-flip migration reverses with a second `SET DEFAULT` (no row data touched).

## Phase 3 — Reusable signature (spec R9; §18.3)

### Goal

A second substitute receipt by the same user requires no signature upload. Largest single effort reduction; no schema change.

### Changes

- `prisma-expense.repository.ts`: new `findReusableSignatureAsset(companyId, userId)` — `CompanySignatureAsset` with `status: 'ACTIVE'` and `submittedByUserId: userId` (newest first), resolving `derivedAttachmentId ?? originalAttachmentId` to bucket/key/mime. "Owned by the user" = submitted by them and owner-approved; no new column.
- `substitute-receipt.use-case.ts` signature resolution helper (`:951`): keep the per-evidence lookup first (backward compatibility), fall back to the reusable asset for the same role's actor. Certify/Approve call sites unchanged; snapshot/checksum flow unchanged (the asset's attachment bytes feed the same dataUrl path).
- LINE side: nothing new — `SIGNATURE_UPLOAD_TICKET` already feeds the library pending owner approval; Phase 4's R13 flow will point at it.

### Tests / Verification

- One signature asset satisfies certification on two different evidences (reuse), per-evidence upload still wins when present, PENDING/REJECTED/ARCHIVED assets never resolve, and another user's asset never resolves.
- Focused `substitute-receipt.use-case.spec.ts` run.

### Exit / Rollback

Spec §16 bullet 4 passes. Rollback = revert; the fallback is purely additive.

## Phase 4 — LINE prepare, unsigned form, paper route, media classification (spec R7, R8, R10, R11, R13, R14/§11, R15; §18.4)

### Goal

Journey A through the R13 ask and prepare; Journey B through a hand-signed scan; incoming media lands on the open work instead of forking new drafts.

### Changes

Schema (one additive migration on `ExpenseSubstituteReceiptEvidence`): `signatureMode` enum `DIGITAL|PAPER` default `DIGITAL`; `wetSignedScanAttachmentId String? @unique`; `wetSignedScanChecksumSha256 String?`; `preparedFromChannel` enum `WEB|LINE` default `WEB`.

R7 — Prepare from LINE: `PrepareSubstituteReceiptUseCase` replaces its `assertWeb` (`:375`) with a channel gate: `authProvider: 'line'` allowed when the caller holds `expense.review`, branch in scope (`assertBranch` already runs), and the payer resolves to an active member (already `:398-399`); audit metadata + row gain `preparedFromChannel: 'LINE'`. Preview/certify/approve/download keep `assertWeb` untouched (§16 last bullet).

R8 — `แบบฟอร์มรอลงนาม`: new thin `DownloadSubstituteReceiptFormPdfUseCase` (web; status `PREPARED`) rendering the preview snapshot via the existing renderer with `stateStamp: 'UNSIGNED'` + the incompleteness line; never stored as an evidence artifact; never worded `ออกเอกสารแล้ว`. Until Phase 5, the form is fetched from the authenticated wizard page; the LINE card links there.

R13 — the ask: continuation, on clean preflight, sets a new pending state offering `ออกเอกสาร (ใช้ลายเซ็นที่บันทึกไว้)` / `ขอฟอร์มไปเซ็นเอง` / `แก้ข้อมูลก่อน`. `ออกเอกสาร` with no ACTIVE reusable signature → ask for one (quick reply `cameraRoll`, `line-reply.adapter.ts:9-15`) routed through the existing signature ticket; with one → prepare (R7, carrying `continuationId`), reply `รอยืนยัน` + web button. `ขอฟอร์มไปเซ็นเอง` → prepare + point at the R8 form.

R10/R11 — paper route: media classifier per §11's table implemented over the existing pending-media mechanism — deterministic signals first (awaiting-scan state in this chat, caption keywords, amount mismatch), one numbered question when ambiguous, bytes kept pending. D9 confirm names document number + amount; on `ใช่` link the photo as `wetSignedScanAttachmentId`, set `signatureMode: 'PAPER'`. Approve for PAPER skips digital signature embedding; issued artifact = scan first + system attestation page (snapshot values, identities, timestamps, both checksums) — renderer extension in `substitute-receipt-pdf.logic`. Two acknowledgements stay (R12); a photo never issues anything by itself.

R15 — deterministic payee-could-sign detection (`ผู้รับเงินเซ็นให้ได้|ให้เขาเซ็นแล้ว|มีสำเนาบัตร…`) → one-paragraph `ใบสำคัญรับเงิน` explanation + explicit choice to continue; wording reviewed with the owner against a real conversation (spec §19).

### Tests / Verification

Unit: channel gate (LINE prepare without `expense.review` refused; approve from LINE always refused); UNSIGNED form never storable as artifact; §11 classification incl. D9 with zero/one/several awaiting forms; PAPER artifact contains both checksums. Integration: Journey A to `รอยืนยัน`; Journey B end-to-end on a seeded company; stale-expense conflict after prepare. Migration on scratch DB; full expenses + line-ai focused suites.

### Exit / Rollback

Spec §16 bullets 6, 7, 8, 10, 11, 13 pass. Sub-releasable in two cuts if needed: 4a (R7/R8/R13) then 4b (paper + §11). Rollback per cut; schema columns are additive with defaults.

## Phase 5 — Delivery links, badges, ISSUED push-back (spec §12, §13, R16; §18.5)

### Goal

The finished document arrives in the chat as a revocable 3-day link; every card carries its state badge.

### Changes

- Schema: new `DocumentDeliveryLink` exactly per spec §10 (token never stored; `tokenHashSha256` unique; opaque `line-delivery/{random}.pdf` temp key).
- API: create/resolve/revoke use cases + audit actions `document.delivery.link.create|open|revoke`; storage copy via the existing signed-GET-capable storage port; resolve = hash lookup, expiry/revocation check, `openCount++`, audit, 302 to short-lived presigned URL. `ขอลิงก์ใหม่` re-copies to a fresh key/token (old temp object already lifecycle-deleted or revoked).
- Web: public session-less `/d/{token}` route (public route tree, NOT under `/companies/…`); expired page shows no document data + `ขอลิงก์ใหม่`.
- `safeTenantLink` (`line-business-card.logic.ts:17-30`): exactly one added allowance — exact-shape `/d/{token}` on the configured origin.
- LINE: on `ISSUED`, push the `ออกเอกสารแล้ว` card (document number, amount, download button + expiry line) — reuse the existing notification path that `notifySignaturePending` (`:283`) rides. `ขอฟอร์มไปเซ็นเอง` delivery switches from the Phase-4 web link to a §12 link with `kind: UNSIGNED_FORM_PDF`.
- Badges: `LineAiAnswerCard` gains optional `badge` (contracts, additive); renderer row above the body; continuation formatter maps state→badge per spec §13 table.
- Ops: record the delivery bucket/prefix + 3-day lifecycle rule and the no-`s3:ListBucket` requirement in `docs/runbooks/cloud-environment-operations.md`; bucket-vs-prefix is decided here (spec prefers a separate bucket when operationally cheap).

### Tests / Verification

Token hashing/expiry/revocation; key contains no identifiers; expired-link page; per-recipient links never pushed to group chats; badge selection per state; `safeTenantLink` still rejects everything else. Integration: issue → push → open → audit rows → revoke → dead link.

### Exit / Rollback

Spec §16 bullets 5 (push card), 9, 12 pass. Rollback: feature-flag the push + delivery-link creation off; table is additive.

## Acceptance criteria → phase map (spec §16)

| §16 bullet | Phase |
| --- | --- |
| First-time combined message creates draft + continuation + full card | 2 |
| No relative link; no link without permission | 1 |
| Zero-attachment cash expense reaches ISSUED, audit `evidenceCount: 0` | 2 |
| Second receipt needs no signature upload | 3 |
| Two audit rows under OWNER_SELF | already true today — regression-guard in 4 |
| UNSIGNED watermark form, never "issued" | 4 |
| D9 confirm; photo alone never issues | 4 |
| Paper artifact = scan + attestation, both checksums | 4 |
| Expired link: no data, `ขอลิงก์ใหม่`, new opaque key | 5 |
| Mid-conversation slip attaches, no new draft | 4 |
| Payee-signed → `ใบสำคัญรับเงิน` explanation + choice | 4 |
| Delivery link audited/expiring/revocable/opaque | 5 |
| Certify/approve/download still refuse `authProvider: 'line'` | 4 (guard tests) |

## Verification commands (per phase; the API runner is `tsx --test`, matching the package `test` scripts)

```bash
pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.spec.ts src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts src/modules/line-ai/domain/logic/line-business-card.logic.spec.ts
```

```bash
pnpm --filter @watchdog-bms/api exec tsc --noEmit && pnpm --filter @watchdog-bms/contracts test && pnpm --filter @watchdog-bms/web exec tsc --noEmit
```

Schema phases additionally: fresh `prisma migrate dev` + seed on a scratch database; record run output in task memory.

## Open implementation decisions (spec §19)

- Delivery temp copy: separate bucket vs prefix — decide in Phase 5 with ops evidence; bucket preferred.
- R15 explanation wording — draft in Phase 4, review with owner against a real conversation before release.

## Task Memory

`docs/agent-memory/line-substitute-receipt-assisted-issuance.md` — update per phase with verification evidence and any deviation from this plan.
