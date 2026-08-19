# Agent Memory: LINE substitute-receipt assisted issuance

Status: Implementing on branch `codex/line-substitute-receipt-assisted-issuance` (worktree off origin/develop), 2026-08-20. Phase 1 (dead-end fix: permission gate, absolute links, formatter replies, NFKC→NFC) and Phase 2 (R1 capture-first, R5 zero-attachment prepare + evidenceNone ask-once, R6 cash-default flip + migration, labeled() single-line robustness) implemented and committed after Opus adversarial review rounds (Phase 1: 8 findings fixed; Phase 2: BLOCK on stub-only capture evidence — capture-first now synthesizes captureHints from valueCandidates + substituteRequestExpenseText and is proven against the real CaptureLineExpenseNoteUseCase). Phases 3-5 next.

Implementation findings worth keeping:
- Repo has pre-existing Prisma schema drift (migration 20260809120000 wrote updatedAt DEFAULT CURRENT_TIMESTAMP vs @updatedAt models: DataRightsCase/RemoteRelease* + 4 index renames). Every `prisma migrate dev` re-emits that noise — hand-trim generated migrations to the intended statements (Phase 2's is one SET DEFAULT). Phases 4-5 migrations must do the same.
- `hasActiveSubstituteContinuation(rows)` (continuation use case) is the "open substitute work in this chat" signal — reuse it for §11 media classification in Phase 4 instead of adding another.
- The evidence question is the last collectable blocker, so "preflight clean" is exactly where R13's ให้ออกเอกสารเลยไหมคะ fires in Phase 4.
- `evidenceNone` reaches the web via LineSubstituteReceiptPrefill but the wizard ignores it on apply (excluded from the prefill count); Phase 4 prepare-from-LINE should carry it so the ask stays once.
- Capture-first fires only on: substitute vocabulary + amount candidate + capture permission + zero recent candidates + no open SUBSTITUTE/EXPENSE_DOCUMENT_CAPTURE clarification + no OPEN/PAUSED workflow in chat.
Owner: thawatchai
Scope: `docs/specs/line-substitute-receipt-assisted-issuance-spec.md`. Implementation will touch `apps/api` (line-ai webhook, expenses substitute-receipt + policy + storage delivery), `apps/web` (public delivery route, substitute wizard deep link), `packages/contracts`, and `prisma/schema.prisma`.

Decisions (owner, 2026-08-18):

- LINE carries the work up to the point where a signature is needed. The confirm/approve button opens ONE web page and finishes there — approval never happens in chat.
- Two signature routes, both built: reusable signature image (primary) and print-sign-photograph (fallback). The reusable route is primary because print-sign-scan needs a printer, which most SMEs do not have.
- Issued PDF is delivered as `{web}/d/{token}` → 302 → presigned URL for a temp COPY in an opaque, identifier-free key, deleted after 3 days. Raw S3 links are never put in a chat: they cannot be revoked and `safeTenantLink` drops them anyway.
- Cash-evidence default flips to `ALLOW_SUPPORTING_EVIDENCE_ONLY`, and a receipt-less expense is allowed with zero attachments — **no amount ceiling, no monthly cap** (owner, 2026-08-18: "ไม่มีเพดาน"). The remaining controls are mandatory business purpose + place/route, payer identity, two signatures, and a `evidenceCount: 0` audit field that makes every self-certified no-evidence document listable. No threshold columns are added to the policy table.
- Only `ใบรับรองแทนใบเสร็จรับเงิน` is built. When the payee could have signed, the assistant explains `ใบสำคัญรับเงิน` and stops rather than producing the weaker document silently.
- Delivery link expiry is a fixed 3 days, not configurable; expired means ask for a new one, never extend.
- Certify and approve stay two explicit acknowledgements with two audit rows, even under `OWNER_SELF` where they are the same person. They may share one page as two steps.
- A returned paper form is matched by chat context plus one confirming question that names the document number and amount — no OCR, no QR. The number is printed large on the form so the user verifies by eye. QR stays available as a later optimisation that nothing depends on.

Findings that changed the design:

- The dead-end in the UAT screenshot is a guard-ordering bug, not a missing feature: `process-line-webhook.use-case.ts:1316` intercepts substitute vocabulary before the intake router at `:1370`, so text capture never runs and `line-substitute-receipt-continuation.use-case.ts:399-407` returns hard-coded copy that discards everything typed.
- **Signatures cannot be reused today.** `prisma-expense.repository.ts:1048-1065` looks up the signature by `metadataJson = { generatedFor: 'substitute_receipt_signature', evidenceId, role }`, i.e. one upload per evidence per role. This — not the web-vs-LINE boundary — is what makes the flow heavy. A company signature library and a LINE signature-upload route already exist and are simply not wired to certification.
- The product demands more evidence than the law does: prepare hard-requires one supporting attachment, and the default cash policy requires a second file. Research confirms `ใบรับรองแทนใบเสร็จรับเงิน` needs no payee signature, no ID copy and no attachment — the employee certifies. So the most common real case (cash motorcycle-taxi fare) was impossible.
- The document number is reserved at PREPARE (`prisma-expense.repository.ts:1088`, `:1195-1209`), so a printable unsigned form with a stable identity is possible before any signature. `renderSubstituteReceiptPdf` already takes a `stateStamp`, so the `UNSIGNED` watermark is a parameter, not a new renderer.
- LINE cannot send files at all — no file message type. Delivery must be a link or an image.
- `safeTenantLink` (`line-business-card.logic.ts:17-29`) accepts only same-origin URLs under `/companies/{companyId}/`. Any delivery-link design must either live in the tenant path or add one narrow exact-shape allowance; the spec chose the latter so a public page never sits inside the authenticated tree.

Correction made while writing v0.2: v0.1 said the issued artifact is always system-rendered from the snapshot. That is wrong for the paper route — the ink exists only on the photograph, so a system render would show empty signature boxes. R11 now says the `PAPER` artifact is the scan followed by a system attestation page carrying both checksums.

Open questions: none blocking. Bucket-vs-prefix for the delivery temp copy is an operational call at implementation time; the R15 `ใบสำคัญรับเงิน` copy should be reviewed against a real conversation.

Artifacts:

- `docs/specs/line-substitute-receipt-assisted-issuance-spec.md` — the spec (R1-R16, journeys A/B/C, §12 delivery design, §18 five-step rollout). v0.3 links the plan and records the 2026-08-19 re-verification + second UAT screenshot (`สร้างใบแทนใบเสร็จได้ไหม`).
- `docs/plans/line-substitute-receipt-assisted-issuance-plan.md` — implementation plan, phases 1-5 = spec §18 steps, with current file:line anchors (re-verified 2026-08-19), per-phase changes/tests/exit criteria, and the §16 acceptance-criteria → phase map.

Verification:

- Discovery only; no code executed. Every source fact in spec §5.A carries a file:line read on 2026-08-18 and was re-verified 2026-08-19 while writing the plan (all hold; anchors drifted — plan carries current lines: guard `process-line-webhook.use-case.ts:1439`, dead-end `line-substitute-receipt-continuation.use-case.ts:406`, candidates filter `prisma-expense.repository.ts:2223-2256`, absolute-URL-only card buttons `line-business-card.logic.ts:93`).
- Plan-writing discovery additions: the capture→continuation chain ALREADY exists on the pending-media path (`process-line-webhook.use-case.ts:2800-2859`) and is the R1 pattern to reuse for text; signature reuse maps to `CompanySignatureAsset` `status: ACTIVE` + `submittedByUserId` (schema `:2412-2435`, no new column); the R6 default-flip fallback sweep list is `substitute-receipt.use-case.ts:436,744`, `line-substitute-receipt-continuation.use-case.ts:469`, `substitute-receipt-policy.use-case.ts`, `contracts/expenses.ts`, web `SubstituteReceiptWizardPage/SubstituteReceiptSettingsPage/ExpensesPages`.

Next:

- Implement plan Phase 1 (absolute links + permission gate + shared formatter) — independently shippable, fixes the screenshot's worst symptom with no policy/boundary change.
- Then phases 2-5 in order; do not start a phase before the prior phase's exit checks are green.
