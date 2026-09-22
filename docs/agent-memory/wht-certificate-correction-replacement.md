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
