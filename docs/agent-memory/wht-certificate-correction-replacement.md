# Agent Memory: wht-certificate-correction-replacement

Status: Docs-only session 2026-09-22 (spec + plan authored, NOT implemented). New sibling memory file
(not an append to `wht-certificate-system-issuance.md`) — that file is already 800+ lines covering a
fully separate, already-shipped feature's full implementation log; appending this task's discovery
there would bury it. Cross-referenced instead.
Owner: Finance/Accounting lane (WHT / 50-ทวิ correction + replacement).
Scope: Enable `cap.wht50bis/SYSTEM_CONTENT_CORRECTION` and `cap.wht50bis/SYSTEM_REPLACEMENT_COPY` — the
two routes that moved ORDINARY/OPEN in the prior commit on this branch (`fc9bf7ff`) with zero code
behind them. Correction = mint a new-numbered certificate with corrected content, old one superseded.
Replacement (ใบแทน) = re-render an identical, same-numbered copy with a visible "ใบแทน" label, for a lost
PDF. Both scoped to `WhtCertificateHandoff.status === 'SYSTEM_ISSUED'` only — EXTERNAL_LINKED untouched.

## How this task started

Owner asked directly: "if [50-ทวิ] data is edited and then regenerated, would it get the new value,
right?" The honest answer, verified against the code: no — there is no edit/regenerate path at all
today, and the underlying `SupplierPayment`/`ExpenseRecord` payment cannot even be voided once a
certificate is issued (`wht_certificate_linked_requires_review`,
[prisma-procurement.repository.ts:1604](../../apps/api/src/modules/procurement/infrastructure/prisma-procurement.repository.ts)).
Owner said to build both missing features now, in the same unit of work as the SYSTEM_INITIAL_ISSUE
feature, before it all merges/deploys to UAT together.

## Decisions

- **Built on top of the existing CC5 design, not invented from scratch.** `feature-entitlement-decoupling-spec.md`
  §CC5 ([:232-258](../../docs/specs/feature-entitlement-decoupling-spec.md)) and
  `tax-thailand-2026-spec.md` ([:1260-1395](../../docs/specs/tax-thailand-2026-spec.md)) already fully
  design `WhtCommandRegistry`/`WhtCertificateCommand`/`WhtCorrectionCase`/`WhtCertificateCopyArtifact`/
  `WhtReplacementCopyHandoff`, `artifactOrigin`, and the exact correction-vs-replacement semantics
  (numbering, visible label, permission key). None of that schema exists in the codebase today —
  confirmed by grep: `WhtCertificate` (schema.prisma:5121-5151) has no `artifactOrigin`, no supersession
  field, no copy-artifact table; `WhtCertificateStatus` is still the plain `DRAFT|ISSUED|VOIDED` enum CC5
  itself says it expects ([feature-entitlement-decoupling-spec.md:234](../../docs/specs/feature-entitlement-decoupling-spec.md)).
- **v1 deliberately does NOT build the full CC5 apparatus.** That is a full event-sourced command-history
  + RD-filing-correction + refund-claim system — far larger than what the owner actually asked for
  (correct a certificate; reissue an identical copy). The spec instead extends `WhtCertificate`
  additively with the minimum needed: `supersededByCertificateId`/`supersedesCertificateId` (bidirectional
  self-relation, single-supersede only, no revision history), `correctionReason`, and a plain
  `replacementCopyCount`/`lastReplacementCopyAt`/`lastReplacementCopyByUserId` counter instead of a
  per-copy ledger table. This mirrors the exact precedent the sibling spec already set for a different
  CC5 gap ("Number-namespace merge between SYSTEM and EXTERNAL... design exists, code doesn't, v1 doesn't
  build it, must not claim it's done" — sibling spec §3/finding 2). The full CC5 apparatus remains the
  correct long-term target, explicitly not abandoned, just out of v1's scope.
- **Resolved: correction is certificate-document-scoped only, does NOT touch the ledger/TaxPeriod/source
  payment.** This was the single biggest open design question in the task brief. Grounded in three
  things: (1) CC5/tax-thailand-2026-spec themselves explicitly separate "Certificate-content correction
  and return correction are separate immutable workflows" ([tax-thailand-2026-spec.md:110](../../docs/specs/tax-thailand-2026-spec.md));
  (2) `SupplierPayment`/`ExpenseRecord` are append-only in this codebase — there is no in-place edit of
  `whtCategoryCode`/`whtRate`/`whtAmount` after RECORDED/CONFIRMED, and the only theoretical path (void +
  re-record) is already blocked once a certificate exists — so requiring "the source must already be
  corrected first" would be a real chicken-and-egg with no way out (flagged as open question 3 in the
  spec, not silently ignored); (3) the existing precedent for OTHER kinds of correction in this codebase
  (`assertPeriodUnlocked`'s `SOURCE_CHANGED_AFTER_TAX_PERIOD_LOCK` review issue,
  [sync-tax-events.use-case.ts:109-112](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts);
  `wht_tax_period_locked_requires_amendment`,
  [prisma-procurement.repository.ts:1594](../../apps/api/src/modules/procurement/infrastructure/prisma-procurement.repository.ts))
  never silently auto-corrects — it blocks and defers to a human/`TaxAdjustment`. The spec's kept guard:
  a *financial* correction (amount/rate/category/date/payee/form) is blocked outright when the
  certificate's `TaxPeriod` is `FILED`/`PAID`/`CLOSED` (new code `wht_certificate_correction_tax_period_locked`,
  mirroring the existing lock codes exactly); nonfinancial corrections (spelling, address) are never
  blocked by period lock. Documented consequence: a corrected certificate can diverge from what
  `SupplierPayment`/`ExpenseRecord`/WHT reports still say — this is a known v1 limitation, not a bug,
  consistent with CC5's own separation of concerns.
- **Numbering: correction = new number always; replacement = same number always, never reserves one.**
  Directly and unambiguously confirmed by both design docs (not a judgment call): "A corrected
  certificate supersedes the old artifact with a new number; `ใบแทน` is only a same-number
  unchanged-content copy for loss/damage" ([tax-thailand-2026-spec.md:110](../../docs/specs/tax-thailand-2026-spec.md)).
- **Replacement's visual "ใบแทน" marking: reuse the substitute-receipt convention, adapted for a
  fixed-title statutory form — NOT the diagonal `stateStamp` overlay.** Read
  `apps/api/src/modules/expenses/domain/logic/substitute-receipt-pdf.logic.ts` per the task's instruction:
  it has TWO distinct, unrelated marking mechanisms. (1) `SubstituteReceiptPrintStamp` (`'VOID' |
  'SUPERSEDED' | 'UNSIGNED' | 'AWAITING APPROVAL' | 'AWAITING REVIEW'`,
  [:65](../../apps/api/src/modules/expenses/domain/logic/substitute-receipt-pdf.logic.ts)) is a generic,
  reusable diagonal red-text overlay (opacity 0.32, centered) that marks **document lifecycle state** —
  this is what a SUPERSEDED (corrected-away) old certificate should get if it's ever re-rendered
  (mechanism plumbed through in Phase 4.2 of the plan, but not wired to any caller in v1 — see open
  question 2). (2) The actual "this is a substitute copy" identity marking is a different thing entirely:
  `substitute-receipt.logic.ts` prints `SUBSTITUTE_RECEIPT_TITLE` ("ใบรับรองแทนใบเสร็จรับเงิน") as the
  document's own title plus a "เลขใบแทน: {number}" subtitle
  ([:5,282-283](../../apps/api/src/modules/expenses/domain/logic/substitute-receipt.logic.ts)) — plain
  printed text on the document, not an overlay. 50-ทวิ can't change its title (it's a fixed government
  form), so the spec adapts this second convention: print an additional "(ใบแทน — ออกซ้ำเมื่อ ...)" line
  next to the existing เล่มที่/เลขที่ field, matching `tax-thailand-2026-spec.md`'s own requirement that
  the label be "visible in the approved header position and cannot overlap statutory fields"
  ([:1300,1302](../../docs/specs/tax-thailand-2026-spec.md)).
- **Permission: one shared `wht.certificate.correct` for both correction and replacement**, exactly the
  key name and scope the design docs already specify ("narrow audited `wht.certificate.correct`",
  [feature-entitlement-decoupling-spec.md:235](../../docs/specs/feature-entitlement-decoupling-spec.md);
  "shared certificate-only correction/cancellation/ใบแทน",
  [tax-thailand-2026-spec.md:1971](../../docs/specs/tax-thailand-2026-spec.md)) — not a new permission
  per route, not reusing `wht.certificate.issue`.

## Open question flagged for the owner (most important one — genuinely unresolved)

**Does `wht.certificate.correct` need to be `thai_tax`/ENTERPRISE-gated like `wht.certificate.issue` is?**
The full CC5/tax-thailand-2026-spec design says explicitly and repeatedly NO ("does not require buying
`thai_tax`", "not `thai_tax`") — the reasoning being that fixing/reissuing a certificate you already
issued is an ongoing legal-compliance obligation, not a new commercial feature (matters concretely for a
company that issued certificates while on ENTERPRISE and later downgraded — they still owe the payee a
correct document). But the owner's very recent, forceful 2026-09-22 decisions went the opposite direction
twice for the sibling `SYSTEM_INITIAL_ISSUE` feature and the gate-unlock that just landed on this branch,
including the broad framing "คาดหวังว่าเมื่อเปิด ENTERPRISE จะต้องได้ทวิ 50" (expects ENTERPRISE alone
should get you all of 50-ทวิ) — which reads as possibly meaning the WHOLE 50-ทวิ surface, not just initial
issuance. The spec resolves this by recommending ungated (following the documented design + the
downgrade-scenario justification) but flags it explicitly as unconfirmed for these two specific routes
and describes the one-line pack-placement change needed if the owner says otherwise (spec §8.2, §12
item 1; plan §2.1's implementer note). Two smaller open questions also recorded in spec §12 (items 2-3):
whether a superseded old certificate needs a persistent, reloadable "SUPERSEDED"-stamped re-download (v1
doesn't build this — no `pdfAttachmentId` persistence exists for this feature family at all, inherited
gap from the sibling feature), and the still-unresolved chicken-and-egg where `SupplierPayment`/
`ExpenseRecord` WHT facts can never actually be edited once a certificate exists, regardless of this
feature (v1 does not attempt to fix that — out of scope per the certificate-document-scoped resolution
above).

## Artifacts

- New spec: `docs/specs/wht-certificate-correction-replacement-spec.md`.
- New plan: `docs/plans/wht-certificate-correction-replacement-plan.md` (READY, 7 ordered phases,
  docs-only — not implemented).
- This new memory file.
- Cross-referenced (not edited): `docs/specs/wht-certificate-system-issuance-spec.md`,
  `docs/plans/wht-certificate-system-issuance-plan.md`,
  `docs/agent-memory/wht-certificate-system-issuance.md` (its "Gate-unlock + button rename" section is
  what made this task possible — both routes were SPECIALIST_LEGAL/CLOSED before that commit),
  `docs/specs/feature-entitlement-decoupling-spec.md` (§CC5 — read in full per task instruction),
  `docs/specs/tax-thailand-2026-spec.md` (owner's 2026-06-23 three-route decision + the fuller
  `WhtCertificateCommand`/`WhtCorrectionCase`/`WhtCertificateCopyArtifact` schema section, lines
  ~1260-1395, which is more detailed than the decoupling spec's own CC5 section on the exact numbering/
  labeling rules cited above).

## Verification

- Docs-only task. No code run, no tests executed, no migrations created.
- Every citation re-verified against current source during this session (not copied from an older
  pass): `WhtCertificate`/`WhtCertificateHandoff`/`WhtCertificateStatus` schema (schema.prisma:4372-4376,
  5121-5231), the void-guard's three sequential locks (`pp36_tax_period_locked_requires_amendment`,
  `wht_tax_period_locked_requires_amendment`, `wht_certificate_linked_requires_review`,
  prisma-procurement.repository.ts:1560-1610), `assertPeriodUnlocked`'s lock-review-issue path
  (sync-tax-events.use-case.ts:81-112), `TaxAdjustment` model (schema.prisma:5259-5274), both marking
  mechanisms in the expenses substitute-receipt logic, the full
  `IssueWhtCertificateFromHandoffUseCase` implementation (constructor, gate check, number reservation +
  P2002 recovery, transaction shape, audit calls) as the exact pattern this plan mirrors, and the current
  AP `WhtHandoffDetail`'s `issued` branch (AccountsPayablePages.tsx:1110-1137) as the concrete insertion
  point for the two new buttons.

## Next

- Not implemented. Next actual step is plan Phase 7 (get the owner's answer on the `thai_tax` gating
  question) in parallel with starting Phase 1 (schema, which doesn't depend on that answer), then Phases
  2-6 as a normal implementation session — not further docs work.
- Phase 5.2 (Expenses UI insertion point) needs a short discovery pass at implementation time — there is
  no persistent, cross-session detail view for a confirmed expense today (unlike AP's `WhtHandoffDetail`),
  only a same-session download prompt (`ExpenseReviewPage.tsx:1026`) — flagged in the plan rather than
  guessed.

## Open question 1 RESOLVED (owner, 2026-09-23)

Owner confirmed via direct choice: **do NOT gate `wht.certificate.correct` with `thai_tax`/ENTERPRISE**
— matches this spec's own default recommendation exactly (§8.2), following the original CC5 design's
reasoning (correction/replacement of an already-issued statutory document is an ongoing compliance
obligation, not a new commercial feature, so a company that downgrades after issuing certificates must
still be able to correct/reissue them). No spec or plan changes needed — Phase 2.1 as written
(add to the existing ungated `pack.wht.certificate.manage`, not a new gated pack) is already correct
and can proceed as-is. Phase 7's blocking condition is satisfied; implementation may begin.

## Implementation log

Status: Implementation session 2026-09-23 — Phases 1-6 of the plan DONE and committed (6 commits:
`9af38148`/`0c4ae311`/`5efad12a`/`c7ec0cf0`/`2872bd13`/[this memory-update commit] — see per-phase
detail below). Worktree: `.claude/worktrees/wht-gate-unlock-20260922`, branch
`codex/wht-gate-unlock-20260922`. Owner's minimal-testing directive (2026-09-21, still the newest
matching instruction in memory as of this session) was followed throughout: only specs touched or
newly added were run directly; the full enumerated `pnpm --filter @watchdog-bms/api test`, the full
web glob suite, and `node scripts/run-line-ai-whole-chain-acceptance.mjs` were deliberately NOT run —
left for CI at merge time per that directive and the sibling implementation session's own precedent.

**Commit-order deviation from the plan's phase numbering (flagged, not a design conflict):** the plan
lists Phase 3 (replacement) before Phase 4 (PDF template) but its own text (`docs/plans/...:16-20`,
Phase 2.2/2.3 header) already says Phase 2/3 "ต้องรอ...Phase 4...เสร็จก่อนถึงจะ end-to-end ได้" — and
concretely, `IssueWhtReplacementCopyUseCase` calls `TaxArtifactRendererService.renderWhtCertificate`'s
NEW 5th parameter (`replacementCopy`) directly, so it cannot typecheck until Phase 4's renderer
signature change exists. Rather than leave an interim commit that fails `pnpm --filter
@watchdog-bms/api typecheck`, Phase 4 was implemented and committed (`5efad12a`) before Phase 3
(`c7ec0cf0`) — the plan's own text anticipates exactly this dependency, so this is an adaptation, not
a discrepancy with the plan's design. All 6 feature commits landed in the order: 1, 2, 4, 3, 5, then
this memory update — total scope is identical to the plan's Phase 1-6.

### Phase 1 — DONE (commit `9af38148`)

Schema: `WhtCertificate` gained `supersededByCertificateId`/`supersedesCertificateId` (both `@unique`,
plain strings, no Prisma `@relation` self-relation — exactly as the plan specifies),
`correctionReason`, `replacementCopyCount` (default 0), `lastReplacementCopyAt`,
`lastReplacementCopyByUserId`. New additive migration
`apps/api/prisma/migrations/20260923100000_wht_certificate_correction_replacement/migration.sql`
(`ADD COLUMN IF NOT EXISTS` ×6 + two `CREATE UNIQUE INDEX IF NOT EXISTS`, naming convention
`WhtCertificate_<column>_key` matched against existing migrations). No changes to
`WhtCertificateHandoff` (plan §1.2 — `certificateId` already exists).

Verify: `pnpm --filter @watchdog-bms/api prisma:validate` clean; `pnpm --filter @watchdog-bms/api exec
prisma generate` regenerated the client (7.8.0) with no errors.

### Phase 2 — DONE (commit `0c4ae311`)

**2.1 (permission + pack)**: `permission-registry.ts` — new `wht.certificate.correct` (HIGH), granted
to FINANCE and ACCOUNTANT right after `wht.certificate.issue`. `capability-pack.registry.ts` — added
to the existing ungated `pack.wht.certificate.manage` (owner's 2026-09-23 decision, §7 above — NOT a
new gated pack, since Phase 7's blocking question was already resolved before this session started).

**2.2 (use case)**: new `apps/api/src/modules/tax/application/use-cases/correct-wht-certificate.use-case.ts`
— `CorrectWhtCertificateUseCase`, mirroring `IssueWhtCertificateFromHandoffUseCase`'s constructor,
number-reservation/P2002-replay, and transaction shape field-for-field. Merges the caller's optional
`corrected` fields over the current certificate's own values (never re-derives from
`SupplierPayment`/`ExpenseRecord`), computes an `isFinancial` flag by comparing every financial field
(category/rate/gross/withheld/paymentDate/formType/payee tax id) against the current certificate, and
blocks financial corrections when the certificate's `TaxPeriod` is `FILED`/`PAID`/`CLOSED` with a new
code `wht_certificate_correction_tax_period_locked` (nonfinancial corrections never blocked). Inside
one `$transaction`: create the new certificate (`supersedesCertificateId: current.id`) → commit the
reserved number → conditional `updateMany` voiding the old certificate
(`where: supersededByCertificateId: null`, so a losing concurrent correction rolls back its ENTIRE
transaction rather than leaving an orphaned second "corrected" certificate with a committed number —
a stricter race-loser outcome than the sibling's own analogous check, which the plan's step 11
explicitly calls for) → conditional `updateMany` repointing `WhtCertificateHandoff.certificateId`
(status stays `SYSTEM_ISSUED` throughout). New audit action `tax.wht_certificate.correct` (HIGH,
metadata includes `financial: boolean`).

**2.3 (route)**: `POST wht/payment-handoffs/:handoffId/system-certificate/correction`, `@RequirePermissions('wht.certificate.correct')`,
`CorrectWhtCertificateDto` new in `tax.dtos.ts` (+ two small nested override DTOs for payer/payee
snapshot fields, `class-validator`/`class-transformer` pattern mirroring `ExpenseVatSourceOverrideDto`)
and `WhtCertificateCorrectionInput`/`CorrectWhtCertificateDto` new in `packages/contracts/src/tax.ts`.
Registered in `tax.module.ts`.

**2.4 (route-readiness helper + DTO fields)**: `wht-certificate-handoff.use-case.ts` gained exported
`isSystemContentCorrectionOpen`/`isSystemReplacementCopyOpen` (thin wrappers over `isLaunchRouteOpen`,
mirroring the existing `isSystemIssuanceOpen`), plus private class methods computing them once per
request in `list()`/`get()` only (write-path methods `setPayeeAddress`/`linkExternal` keep defaulting
`false`, matching the sibling's own precedent exactly). `WhtCertificateHandoffDto` gained
`systemCorrectionOpen`/`systemReplacementOpen: boolean`.

New error codes needing Thai text (repo-wide `api-error-coverage.spec.ts` guard, learned from the
sibling's own post-push CI fix — added proactively this time instead of waiting for CI):
`wht_certificate_not_correctable`, `wht_certificate_already_superseded`,
`wht_system_correction_unavailable`, `wht_certificate_correction_tax_period_locked` added to
`apps/web/src/common/api/api-error-message.ts` in this phase (`wht_system_replacement_unavailable`
added in Phase 3, since that is where it is first thrown).

New test file `correct-wht-certificate.use-case.spec.ts` (8 cases: nonfinancial correction, financial
correction when OPEN, financial correction blocked on FILED/PAID/CLOSED ×3, nonfinancial correction
NOT blocked by a locked period, P2002 race replay, non-SYSTEM_ISSUED handoff refused, gate CLOSED
refused, already-superseded certificate refused) — registered in `apps/api/package.json`'s enumerated
test script alongside the Phase 3 spec (added together since both were known up front). One
`tax.controller.spec.ts` fix: its hand-built `TaxController` constructor call needed one more `noop`
argument for the new `correctCertificate` dependency (mechanical, not a design change).

Verify: `pnpm --filter @watchdog-bms/contracts build` clean; `pnpm --filter @watchdog-bms/api
typecheck` clean; targeted specs (`correct-wht-certificate.use-case.spec.ts`,
`wht-certificate-handoff.use-case.spec.ts`, `permission-registry.spec.ts` [new case: FINANCE/ACCOUNTANT
hold `wht.certificate.correct`], `feature-gate.logic.spec.ts` [new case: stays ungated unlike
`wht.certificate.issue`], `tax.controller.spec.ts`, `issue-wht-certificate-from-handoff.use-case.spec.ts`)
— 20+20+20+20+20+13 dots, exit 0. `api-error-coverage.spec.ts` (web) — 11/11 pass with the new codes.

### Phase 4 — DONE (commit `5efad12a`, landed before Phase 3 — see deviation note above)

**4.1**: `buildWhtCertificateSvg` gained an optional 5th param `replacementCopy?: { issuedAt: string }`
— when present, prints `(ใบแทน — ออกซ้ำเมื่อ {formatCertDate(issuedAt)})` at `x=60 y=82`, safely between
the existing เลขที่ line (`y=64`) and the payer block (`y=100`, i.e. `payerBlockTop`). No overlay, no
diagonal stamp — plain SVG `<text>`, per spec §6.1's explicit instruction to NOT reuse the
`SubstituteReceiptPrintStamp` diagonal-overlay convention for a fixed-title statutory form.

**4.2**: `renderWhtCertificatePdf` gained an optional 3rd param `options?: { stateStamp?: 'SUPERSEDED' }`
passed straight through to `renderSubstituteReceiptPdf`. `TaxArtifactRendererService.renderWhtCertificate`
gained both new params (5th `replacementCopy`, 6th `options`), passed straight through to
`buildWhtCertificateSvg`/`renderWhtCertificatePdf` respectively. Neither existing caller
(`CreateWhtCertificateUseCase`, `IssueWhtCertificateFromHandoffUseCase`) passes them, so their output
is byte-identical to before (confirmed by re-running their specs, see below). No caller yet passes
`options.stateStamp` in v1 (plan §4.2/§12 open question 2 — no PDF persistence exists to re-render a
superseded certificate from), exactly as the plan anticipates; the parameter exists as a ready seam.

New spec cases in `wht-certificate-pdf.logic.spec.ts`: "ใบแทน" label appears only with `replacementCopy`
(regression-guarded: omitted param → SVG has no "ใบแทน" text at all), and `options.stateStamp:
'SUPERSEDED'` is proven to reach the underlying raster pipeline by asserting the resulting PDF's
`getSubject()` contains `State: SUPERSEDED` (same technique `substitute-receipt-pdf.logic.spec.ts`
already uses for the identical mechanism — no mock/spy needed).

Verify: `pnpm --filter @watchdog-bms/api typecheck` clean; `wht-certificate-pdf.logic.spec.ts` (12/12,
was 9 before this phase); `create-wht-certificate.use-case.spec.ts` +
`issue-wht-certificate-from-handoff.use-case.spec.ts` re-run as a regression check on the renderer
signature change — both green (8/8 + 7/7 dots — no change in either use case's own code this phase).

### Phase 3 — DONE (commit `c7ec0cf0`, after Phase 4 — see deviation note above)

New `apps/api/src/modules/tax/application/use-cases/issue-wht-replacement-copy.use-case.ts` —
`IssueWhtReplacementCopyUseCase`. Deliberately smaller than correction: no `ReserveDocumentNumberUseCase`,
no `TaxPeriod` lookup, no `$transaction` (a single `whtCertificate.update` is the only write — no
unique constraint exists for two concurrent replacement requests to race on, so both incrementing
`replacementCopyCount` is the correct, intended outcome per plan §3.1 step 6, not a bug to guard
against). `resolveActiveCertificate()` walks the `supersededByCertificateId` chain as defense-in-depth
for a stale `handoff.certificateId` pointer (normally unreachable since correction keeps that pointer
current via its own conditional `updateMany`). New route `POST
wht/payment-handoffs/:handoffId/system-certificate/replacement-copy`, sharing the
`wht.certificate.correct` permission with the correction route (plan §2.1: one key for both actions).

New test file `issue-wht-replacement-copy.use-case.spec.ts` (5 cases: same-number reissue with
counter increment, two requests in a row both incrementing, non-SYSTEM_ISSUED refused, gate CLOSED
refused, resolves through the supersession chain to the ACTIVE certificate when the handoff still
points at a corrected-away one). `tax.controller.spec.ts` needed one more `noop` constructor arg
(mechanical).

Verify: `pnpm --filter @watchdog-bms/api typecheck` clean; targeted specs
(`issue-wht-replacement-copy.use-case.spec.ts`, `tax.controller.spec.ts`,
`correct-wht-certificate.use-case.spec.ts`, `issue-wht-certificate-from-handoff.use-case.spec.ts`) —
20+13+20+13 dots, exit 0. `api-error-coverage.spec.ts` (web) re-run with
`wht_system_replacement_unavailable` added — 11/11 pass.

### Phase 5 — DONE (commit `2872bd13`)

**5.1 (AP)**: `canCorrectWhtCertificate`/`canIssueWhtReplacementCopy` added to
`accounts-payable.model.ts`, mirroring `canIssueSystemWhtCertificate`'s shape exactly (status
`SYSTEM_ISSUED` + `certificateId` present + the route-readiness boolean + the permission).
`correctSystemWhtCertificate`/`issueSystemWhtReplacementCopy` added to `accounts-payable.api.ts`. The
`issued` block in `WhtHandoffDetail` (`AccountsPayablePages.tsx`) gained: an inline "แก้ไขหนังสือรับรอง"
toggle + form (prefilled from `handoff.prefill` — the only certificate content this screen already
has, since no `GET`-certificate-by-id endpoint exists to re-read what a prior correction changed; this
is a deliberate, documented scope limit, not an oversight — see drift note below), required reason
field, and a one-click "ออกใบแทน" button. Both download the returned PDF immediately via the existing
`downloadArtifact` (mirrors the issue button exactly — `pdfAttachmentId` is still never populated).

**5.2 (Expenses) — survey finding, reported as instructed:** the plan/spec assumed (based on an
earlier discovery pass) that no persistent, cross-session detail view exists for a confirmed expense,
only the session-only `whtIssuedPdf` state at `ExpenseReviewPage.tsx:1026`. Grepping the actual route
tree found this assumption incomplete:
`apps/web/app/(workspace)/companies/[companyId]/expenses/[expenseId]/page.tsx` renders
`ExpenseReviewPage` directly by `expenseId`, calling `getExpense(companyId, expenseId)` fresh on every
mount with no status restriction — and `ExpensesPages.tsx`'s `ExpenseListPage` already has a
`sourceView === 'confirmed'` filter whose `onSelect` (`openListExpense`) navigates to exactly this
route. So a CONFIRMED expense already has a genuine, bookmarkable, cross-session detail page — the
form is simply disabled at that status (comment already in the source: "The whole form below is
disabled at CONFIRMED, but nothing on the page said so"). This satisfies the plan's own explicit
fallback ("ถ้ามี → เพิ่มปุ่มสองตัวที่นั่น") rather than its stop-and-report branch, so implementation
proceeded rather than stopping. Added: a new effect that re-reads `GET
wht/payment-handoffs?status=SYSTEM_ISSUED&sourcePaymentId=<expenseId>` whenever `detail.status ===
'CONFIRMED' && hasWht && permissions.includes('wht.certificate.correct')` — independent of the
confirm-session-only `whtIssuePrompt`/`whtIssuedPdf` state above it, so the buttons work whether the
operator is looking at this page moments after confirming or weeks later. `canCorrectWhtCertificate`/
`canIssueWhtReplacementCopy` duplicated into `expenses.model.ts` (thin per-module copy — matches this
repo's own established convention for the WHT handoff API client functions, per the comment already in
`expenses.api.ts`: "each module keeps its own thin copy rather than a shared cross-feature client").
Same correction form/replacement button UI as AP, added to `ExpenseReviewPage.tsx`.

- **Drift/scope note (documented, not a guess):** the plan's frontend text (spec §4.1) lists the
  correction form's fields as "income category/rate/gross/withheld/payment date/form type + payee
  identity fields" — no mention of payer-snapshot fields, even though the backend's
  `WhtCertificateCorrectionInput` supports overriding both. The UI on both AP and Expenses therefore
  only exposes payee-snapshot overrides, matching the plan's literal frontend scope; a payer-snapshot
  correction (rare — the payer is the company itself) is not reachable from either UI in v1, though
  the API accepts it if a caller sends it directly.

Verify: `pnpm --filter @watchdog-bms/web typecheck` clean; `accounts-payable.model.spec.ts` (new
`canCorrectWhtCertificate`/`canIssueWhtReplacementCopy` cases), `WhtHandoffDetail.wiring.spec.ts` (new
cases: buttons inside the `issued` block, correction/replacement endpoints called, PDF downloaded
immediately ×3, reason required), `expenses.model.spec.ts` (mirrored predicate cases),
`ExpenseReviewPage.qa.spec.ts` (new cases: handoff re-read from server independent of session state,
predicates wired, endpoints called, reason required) — all green. Repo-wide UI guards re-run given the
sibling's own CI-round lessons: `api-error-coverage.spec.ts`, `no-raw-api-error-display.spec.ts`
(both new error paths route through `err()`/`apiErrorMessage`, never a raw caught message),
`action-loading.spec.ts` (both new buttons pair `aria-busy`/`disabled` correctly) — all pass locally,
avoiding the 3 CI-round surprises the sibling session hit.

### Phase 6 — DONE (this commit)

Added the plan's one remaining named regression case to `pp36-payment-reversal.repository.spec.ts`:
rather than a literally duplicate test (the guard's mock is entirely blind to `certificateId`, so a
"post-correction" fixture cannot actually differ from the existing SYSTEM_ISSUED test at this layer),
expanded the comment on the existing test to make the invariant explicit — the void guard's query is
100% on `WhtCertificateHandoff.status`, which correction/replacement never change, so there is no
separate code path a new test could exercise. Documented rather than fabricated.

**Full targeted regression pass** (owner's minimal-testing directive — only touched/new specs, full
enumerated/glob suites deferred to CI at merge, per the plan's own Phase 6 note and the sibling
session's precedent):
- API (10 files, 10/10 dot-groups, exit 0): `correct-wht-certificate.use-case.spec.ts`,
  `issue-wht-replacement-copy.use-case.spec.ts`, `issue-wht-certificate-from-handoff.use-case.spec.ts`,
  `create-wht-certificate.use-case.spec.ts`, `wht-certificate-handoff.use-case.spec.ts`,
  `wht-certificate-pdf.logic.spec.ts`, `permission-registry.spec.ts`, `feature-gate.logic.spec.ts`,
  `tax.controller.spec.ts`, `pp36-payment-reversal.repository.spec.ts`.
- Web (7 files, exit 0): `accounts-payable.model.spec.ts`, `WhtHandoffDetail.wiring.spec.ts`,
  `ExpenseReviewPage.qa.spec.ts`, `expenses.model.spec.ts`, `api-error-coverage.spec.ts`,
  `no-raw-api-error-display.spec.ts`, `action-loading.spec.ts`.
- `pnpm --filter @watchdog-bms/contracts build` clean.
- `pnpm --filter @watchdog-bms/api typecheck` clean (heap-flagged script, per the standing
  `api-typecheck-needs-the-heap-flag` memory note — bare `tsc --noEmit`/the `lint` script are known to
  OOM-abort on this machine, not re-verified again this session since the sibling session already
  confirmed it and nothing changed about the toolchain).
- `pnpm --filter @watchdog-bms/api prisma:validate` clean.
- `pnpm --filter @watchdog-bms/web typecheck` clean.
- `apps/api/src/spec-suite-coverage.spec.ts` (repo-wide "no spec file left unregistered" guard) — 4/4
  pass, confirming both new API spec files are correctly wired into `package.json`'s enumerated test
  script.

**Deliberately NOT run**: the full enumerated `pnpm --filter @watchdog-bms/api test` (hundreds of
unrelated specs), the full web glob `pnpm --filter @watchdog-bms/web test`, and `node
scripts/run-line-ai-whole-chain-acceptance.mjs` — all expected to run once at merge-time CI per the
owner's still-current minimal-testing directive (2026-09-21, no newer contradicting instruction found
in memory as of 2026-09-23).

**Total commits this session**: 5 feature-code commits (`9af38148`, `0c4ae311`, `5efad12a`, `c7ec0cf0`,
`2872bd13`) + this memory-update commit = 6.

**Deviations from the plan, summarized for the controller:**
1. Commit order 1, 2, 4, 3, 5 instead of the plan's literal 1, 2, 3, 4, 5 — Phase 3 has a hard
   compile-time dependency on Phase 4's renderer signature; the plan's own text already flags this
   exact dependency (see Phase 3/4 sections above). Scope is unchanged.
2. Phase 5.2 (Expenses) did NOT need to stop — the persistent, cross-session confirmed-expense view
   the plan asked about already exists (`[expenseId]/page.tsx` → `ExpenseReviewPage`), reachable from
   `ExpenseListPage`'s "ยืนยันแล้ว" filter. Implemented per the plan's own "if it exists, add the
   buttons there" branch.
3. The AP/Expenses correction forms expose payee-snapshot overrides only, not payer-snapshot — matches
   the plan's literal frontend field list (spec §4.1), even though the backend API accepts both.
4. No new escalation was needed — every ambiguity encountered had an explicit, literal answer already
   in the plan/spec text (financial-vs-nonfinational field list, error code naming, DTO validation
   rigor level) or a directly analogous precedent in the sibling's own shipped code.
