# Agent Memory: wht-certificate-system-issuance

Status: Implementation session 2026-09-22 — Phases 1-5 of 6 DONE and committed (6 commits:
dc20214c/ed2f6f7e/bb463f02/b61e0685/f133386c/233d5249 — see "Implementation log" at the end of this
file for full per-phase detail, verification, and commit hashes). The 6th commit is a controller-made
correctness fix found and confirmed by the owner after Phase 5 landed (see "Post-Phase-5 fix" at the
end). Phase 6 (golden-fixture accountant review + actually opening `cap.wht50bis/SYSTEM_INITIAL_ISSUE`)
is a human/process step, out of scope for this session by the task's own instruction — not started.
Plan: `docs/plans/wht-certificate-system-issuance-plan.md`.
Owner: Finance/Accounting lane (WHT / 50-ทวิ system issuance).
Scope: Phase A discovery scan + Phase B spec authoring for enabling `cap.wht50bis/SYSTEM_INITIAL_ISSUE`
at the two existing confirm-time entry points (AP payment WHT tab, Expenses confirm). Correction/
replacement routes and e-Withholding bank integration stay explicitly out of scope (owner-agreed).

Decisions:

- New sibling spec file (not an edit to `wht-settlement-capture-spec.md`, which explicitly lists
  "Expense-side 50 ทวิ handoff" and system issuance as non-goals owned by a different slice).
  Cross-references both `wht-settlement-capture-spec.md` and `feature-entitlement-decoupling-spec.md`
  without editing them.
- Recommended a NEW narrow, ungated permission `wht.certificate.issue` (added to the existing
  `pack.wht.certificate.manage`, same pattern as `wht.certificate.read`/`wht.external_certificate.link`)
  rather than reusing `tax.certificate.issue` (which is `thai_tax`-gated via `pack.tax.prepare` and
  therefore contradicts feature-entitlement-decoupling-spec.md:331's explicit "thai_tax and
  Tax-workspace issue permission are not required" rule) or overloading
  `procurement.supplier_payment.create`/`expense.confirm`.
- Recommended the new AP/Expenses issuance use case NOT reuse `CreateWhtCertificateUseCase`'s shape
  unchanged: that use case requires a pre-existing `TaxPeriod` + `TaxEventIds`, which only exist after
  a separate accountant-triggered `POST tax/sync` (`thai_tax`-gated). To issue "at confirmation moment"
  without requiring `thai_tax`, the new use case should mint the certificate directly off the
  settlement/expense facts, mirroring how `createWhtHandoffForPayment`'s prefill already works without
  needing `TaxPeriod`/`TaxEventIds`. This is flagged as the single biggest implementation-plan fork.
- `cap.wht50bis/SYSTEM_INITIAL_ISSUE` already exists in `launch-matrix.catalog.ts` as
  `routeClass: SPECIALIST_LEGAL`, seed CLOSED — the spec does not invent a new gate, only defines the
  evidence needed to OPEN the existing one (real PDF template + specialist/accountant review +
  regression fixtures), reusing the golden-fixture language already in
  feature-entitlement-decoupling-spec.md.
- Data-model stance: build on `WhtCertificate`/`WhtCertificateHandoff` as-is. `WhtCertificateHandoff
  .status = SYSTEM_ISSUED` and `.certificateId` already exist in the schema and are already honored by
  the void-guard and the AP UI status label, but NOTHING writes them today — confirmed this is a
  deliberately prepared seam from H4, not a gap needing new columns.
- **ENTERPRISE-only gating for the SYSTEM-issue button (owner decision, 2026-09-22, follow-up chat,
  REVERSES the Phase-A-informed recommendation above)**: owner's exact words: "ทวิ 50 ปุ่มกดออกเอกสาร
  ต้องเป็น pack ENTERPRISE เท่านั้น, pack อื่นจะเป็น เก็บข้อมูลแต่ไม่มีปุ่มกดออกเอกสาร." The new
  `wht.certificate.issue` permission must now carry `featureEntitlementKey: 'thai_tax'`
  (`ENTERPRISE_1999` is the only tier whose featureKeys include `thai_tax`, confirmed at
  `packages/contracts/src/menu-entitlements.ts:442-495`). Scoped narrowly: only the SYSTEM-issue
  button/permission is gated — WHT data-capture fields, `WhtCertificateHandoff` auto-creation, and the
  EXTERNAL-issue-then-attach flow are all unaffected and remain ungated, exactly as already scoped.
  Because `featureEntitlementKey` gates at the capability-*pack* level, not per-permission
  (`feature-gate.logic.ts:99-104`, `capability.logic.ts:55`), the spec now recommends a NEW sibling
  pack (e.g. `pack.wht.certificate.issue`, gated) holding only `wht.certificate.issue`, leaving the
  existing ungated `pack.wht.certificate.manage` (read/link) untouched. This decision directly
  contradicts `feature-entitlement-decoupling-spec.md:331` and the tier-independent framing in
  `mangmee-package-entitlements-spec-th.md` — both are flagged (spec §2 goal 4, §7, §8, §12 finding 9,
  §13) but neither file was edited (out of scope for this docs task); whoever owns those docs next
  should reconcile the wording.
- **Signature/seal handling (RESOLVED, owner decision 2026-09-22, same follow-up chat as above)**:
  owner picked option (ค) — a per-company configurable setting, not auto-stamp-always or
  blank-always. Minimal design: extend `CompanyTaxProfile` additively with a `signatureMode`
  (`AUTO_STAMP`/`BLANK`, default `BLANK` until a company opts in) plus, when `AUTO_STAMP`, an
  `AttachmentObject` reference. New minimal company-level settings UI, explicitly NOT reusing
  `CompanySignatureAsset` (the existing per-employee personal signature feature,
  `expense.signature.self_manage`/`.manage`) — different concept (personal vs. company
  authorized-signatory) — but reusing the same generic upload/attachment plumbing
  (`CreateUploadIntentUseCase`/`CompleteAttachmentUploadUseCase` + `AttachmentObject`, the same pattern
  `signature-asset.use-case.ts` already uses). PDF template: `AUTO_STAMP` places the stored image at
  the existing signature-block position; `BLANK` leaves it empty exactly like today. **Superseded in
  part by Decision A below (seal dropped from v1).**
- **Decision A (owner, 2026-09-22, post-plan-draft follow-up): v1 ships SIGNATURE only, seal deferred.**
  Owner's exact words: "ตอนนี้ใช้แค่ลายเซ็นไปก่อน ตราประทับเดี๋ยวตามมาทีหลัง." `companySealImageAttachmentId`
  is dropped entirely from v1 (schema, upload UI, PDF wiring) — `CompanyTaxProfile` gets only
  `signatureMode` + `signatureImageAttachmentId`. The seal position on the real 50-ทวิ form stays blank
  in v1 even under `AUTO_STAMP` (no placeholder drawn) — a known, intentional visual gap vs. the real
  form, deferred to a later slice. This narrows spec §5/§6/§10 and acceptance criterion S10 (which
  still describe signature+seal together) — the spec file itself was NOT edited (out of scope for the
  docs task that produced the plan); the plan document carries the narrower v1 scope and flags the gap
  against the spec explicitly (plan Phase 3 header + §3.5).
- **Decision B (2026-09-22, controller recommendation raised during plan review, no owner objection):
  split the signature-UPLOAD permission from the certificate-ISSUE permission, and make upload
  OWNER-only.** Precedent found while grounding the plan: personal e-signature images are readable only
  by their own owner even against `attachment.read` holders (`create-download-url.use-case.ts:42-52`),
  and editing company legal-identity/VAT fields is already OWNER-only by omission from every other
  role's grant list (`company.legal_identity.manage`, not present in FINANCE/ACCOUNTANT grants,
  `permission-registry.ts:930-932`; `OWNER: COMPANY_PERMISSION_KEYS` at line 506 is what makes omission
  equal OWNER-only). A company's authorized-signatory signature is at least as sensitive as either.
  Resolution: keep `wht.certificate.issue` exactly as already planned (FINANCE/ACCOUNTANT/OWNER,
  `thai_tax`-gated via `pack.wht.certificate.issue`) for *issuing* a certificate, but gate
  *uploading/managing* the company signature setting with a NEW, separate permission
  `company.tax_signature.manage` — registered but deliberately never added to FINANCE's or
  ACCOUNTANT's grant list (so it is OWNER-only the same way `company.legal_identity.manage` is), and
  placed in its own new capability pack `pack.company.tax_signature.manage` (`module: 'tax'`,
  `featureEntitlementKey: 'thai_tax'` — unlike the ungated `pack.company.legal_identity.manage`, this
  setting is meaningless without the WHT-certificate feature at all, so entitlement-gating it too is
  consistent with the rest of this feature's ENTERPRISE-only design). The `PATCH
  companies/:companyId/tax/profile/signature` endpoint (plan Phase 3.3) is guarded by this new
  permission, not by `tax.profile.manage`.

- **Spec-drift backport (2026-09-22, this docs-only follow-up session):** the plan's "สิ่งที่ต่างจากสเปก"
  findings (Phase B, items 1-4 below) were backported into the SPEC itself as small corrective notes, so
  the spec no longer misleads a reader who does not also read the plan. Exactly four spots got a note
  (spec file, `docs/specs/wht-certificate-system-issuance-spec.md`), each citing the plan section that
  resolves it — no spec text was rewritten/removed, only additive notes:
  - §6 (PDF template requirement) — noted `buildMinimalPdf`/`buildTaxExportArtifact` is shared with
    `GenerateTaxFilingPackageUseCase` (`generate-tax-filing-package.use-case.ts:64`), so it must NOT be
    replaced in place; points to plan §2.5's dedicated `wht-certificate-pdf.logic.ts` +
    `TaxArtifactRendererService.renderWhtCertificate` approach.
  - §5 (data model) — noted `WhtCertificate.taxPeriodId` is a NOT NULL required FK to `TaxPeriod`
    (schema.prisma:5116-5117,5137 — line numbers re-verified against current source during this session,
    still accurate) and points to plan §2.2 item 5's `PrismaTaxRepository.upsertPeriod` find-or-create
    answer.
  - §4.1 (AP journey) — flagged that `WhtHandoffDetail` only branches on `status === 'EXTERNAL_LINKED'`
    (`AccountsPayablePages.tsx:980`, re-verified this session), with no `SYSTEM_ISSUED` branch at all
    today; points to plan §4.1 as a required UI fix, not just a new button.
  - §12 finding 8b (Expenses income-category gap) — added a one-line pointer that
    `ListWhtIncomeCategoriesUseCase` already exists and is already exported from `procurement.module.ts`
    (re-verified this session), per plan Phase 1.2, so a future implementer does not re-derive this.
- **Golden-fixture test case added to plan Phase 6 (2026-09-22, same session):** owner supplied a real,
  already-issued 50-ทวิ certificate PDF (their own company → เลิฟไดร์ฟ คาร์เร้นท์, doc number
  `WT2026090002`, 1,000.00 บาท gross / 50.00 บาท withheld / 5% / ภ.ง.ด.53 / signature+seal both blank in
  the real example). Plan Phase 6 now has a new "Golden-fixture ตัวอย่างจริงที่ใช้ทดสอบ" subsection with
  the full field-value table transcribed from that PDF, named as the primary acceptance case for the
  existing S8 golden-fixture accountant review item (in addition to whatever other cases the reviewer
  picks).
  - **Source file handling — owner-confirmed instruction, not just this session's judgment call:** the
    original PDF (`~/Downloads/บริษัท มั่งมียั่งยืน จำกัด (สำนักงานใหญ่)_WT2026090002_บริษัท เลิฟไดร์ฟ
    คาร์เร้นท์ จำกัด (สำนักง....pdf`) was read once (to transcribe field values accurately) and was
    **never copied into the repo**. Mid-task, the owner explicitly confirmed (via the controller relaying
    a clarification) to keep the file **outside the repo on the owner's own machine** (Downloads folder)
    for the accountant/reviewer to use during the actual Phase 6 review, and to **delete it once that
    review is complete**. This is now recorded as an owner instruction. A future session should surface
    this if the owner ever asks "where did the original file go" or once Phase 6 review actually
    happens — someone needs to confirm the file was deleted afterward (not yet done, since Phase 6 has
    not run).

Open questions:

- None blocking. All items previously listed here as "for the implementation-plan stage" are now
  resolved by the plan (`docs/plans/wht-certificate-system-issuance-plan.md`):
  - Permission/pack strings finalized: `wht.certificate.issue` in new pack
    `pack.wht.certificate.issue` (`module: 'tax'`, `featureEntitlementKey: 'thai_tax'`), granted to
    FINANCE (permission-registry.ts:875) and ACCOUNTANT (:941) alongside the existing
    `wht.certificate.read`/`wht.external_certificate.link`. A second new permission
    `company.tax_signature.manage` (pack `pack.company.tax_signature.manage`, same module/entitlement
    key) is OWNER-only by omission from every other role's grant list (Decision B).
  - `CompanyTaxProfile` confirmed to still fit cleanly (schema.prisma:4544-4561, unchanged shape) — v1
    additive fields are only `signatureMode` + `signatureImageAttachmentId` (seal field dropped, Decision A).
  - Route decided: a NEW endpoint `POST companies/:companyId/wht/payment-handoffs/:handoffId/system-certificate`
    in `TaxController`, sibling to the existing `linkExternalWhtCertificate` route (same
    non-`tax/`-prefixed `wht/payment-handoffs` URL family) — NOT an overload of `POST tax/wht-certificates`
    (different input shape entirely: the new route takes only a `handoffId`, no `TaxPeriod`/`TaxEventIds`).
  - New use-case design finalized: `IssueWhtCertificateFromHandoffUseCase` operates on an existing
    `WhtCertificateHandoff` row (both AP and Expenses always create one at confirm time), and resolves
    finding 8a concretely by calling `PrismaTaxRepository.upsertPeriod(...)` — the exact find-or-create
    helper `sync-tax-events.use-case.ts` already uses — to satisfy `WhtCertificate.taxPeriodId`'s NOT
    NULL FK without requiring a prior `POST tax/sync`/`TaxEventIds` (see Phase B finding 1 below; this FK
    constraint was not previously known and sharpens finding 8a beyond what the spec stated).

Artifacts:

- New spec: `docs/specs/wht-certificate-system-issuance-spec.md`.
- New plan: `docs/plans/wht-certificate-system-issuance-plan.md` (READY, ordered Phases 1-6, docs-only —
  not implemented).
- Cross-referenced (not edited): `docs/specs/wht-settlement-capture-spec.md`,
  `docs/specs/feature-entitlement-decoupling-spec.md`, `docs/agent-memory/wht-durable-prefilled-handoff.md`,
  `docs/specs/tax-thailand-2026-spec.md`, `docs/specs/mangmee-package-entitlements-spec-th.md`.

## Phase A findings a future implementation session must know

1. **Permission mismatch**: `tax.certificate.issue` (the endpoint that already implements the OPEN-path
   number-reservation + PDF-render + certificate-row-create when the gate is OPEN,
   `apps/api/src/modules/tax/application/use-cases/create-wht-certificate.use-case.ts`) is
   `thai_tax`-gated via `pack.tax.prepare`. This is the wrong permission for AP/Expenses entry points
   per the decoupling design — do not reuse it as-is.
2. **Numbering**: `ReserveDocumentNumberUseCase`/`PrismaDocumentSequenceRepository.reserveNumberInTransaction`
   protects via two real DB unique constraints (`@@unique([companyId, documentType, documentNumber])`,
   `@@unique([companyId, documentType, idempotencyKey])`), not an advisory lock (the advisory lock only
   covers `documentType === 'expense.record'`). There is NO catch-and-replay for a P2002 race on this
   path (unlike `WhtCertificateHandoffUseCase.createOrReplay`'s F5 fix) — a genuine double-click race
   would surface a raw P2002. Also: the "external numbers register into the same namespace" design
   (feature-entitlement-decoupling-spec.md:238) is NOT yet implemented — `linkExternal` never calls
   `ReserveDocumentNumberUseCase` — so that collision-avoidance claim is a documented future intent,
   not current behavior.
3. **Thai font rendering**: confirmed working via the substitute-receipt SVG→sharp/librsvg→raster→pdf-lib
   pipeline, using "Noto Sans Thai" baked into the API Docker image only
   (`apps/api/Dockerfile` build-time-asserts the font file exists) plus a runtime dark-pixel-ratio guard.
   Output text is a rasterized image, not selectable PDF text — acceptable but worth knowing.
   `buildMinimalPdf` (`apps/api/src/modules/tax/domain/logic/tax-export.logic.ts`) cannot render Thai at
   all (standard Helvetica, no Thai glyphs) and must be fully replaced, not patched.
4. **No whole-chain acceptance harness for tax/billing** exists (unlike LINE-AI's
   `scripts/run-line-ai-whole-chain-acceptance.mjs`). The full list of specs that must stay green is in
   spec §12 finding 4 — no suite today covers minting a certificate from a business confirm action.
5. **Branch bug found**: `CreateWhtCertificateUseCase` hardcodes `payerSnapshot.branchCode: null` always,
   even though `Branch.taxBranchCode` exists in the schema for exactly this purpose. Every
   system-issued certificate today would print a blank payer branch code regardless of which branch
   paid. Flagged as a required fix within v1 scope (populate from existing field, not a new one).
6. **VAT-registration status confirmed NOT to interact** with WHT certificate content/eligibility
   (grepped `vatRegistered`/`VatRegistrationStatus` across the relevant tax use-cases/logic — zero
   hits). UAT's `NOT_VAT_REGISTERED` default has no bearing here.
7. **Expenses has zero WHT income-category capture today** (`ExpenseRecord` only has `whtAmount` and
   `vendorEntityKindSnapshot` — schema.prisma:~2496-2508 re-verified during plan drafting shows there is
   no `whtRate` or `whtCategoryCode` column at all on `ExpenseRecord`, not even under a different name;
   an earlier note in this file overstated this as "whtAmount/whtRate/vendorEntityKindSnapshot" — corrected
   here). This is a real prerequisite gap, not just a "wire up the handoff" task — Expenses needs its own
   `whtCategoryCode`/`whtRate` columns (flat, mirroring `SupplierPayment`'s shape) plus an income-category
   dropdown + read endpoint before a certificate can be correctly populated from that side (plan Phase 1.2).

## Phase B (plan-drafting) findings that sharpen or correct the spec

Grounded 2026-09-22 against commit `18768642` while writing `docs/plans/wht-certificate-system-issuance-plan.md`.

1. **`WhtCertificate.taxPeriodId` is NOT NULL with a required relation to `TaxPeriod`**
   (schema.prisma:5116-5117, 5137) — the spec's §5 claim "no new migration needed for these fields" is
   true for column additions, but doesn't address that this FK is mandatory. Finding 8a's "mint directly
   off settlement/expense facts" therefore needs an answer for where `taxPeriodId` comes from without a
   prior `POST tax/sync`. The plan resolves this by having the new use case call the existing
   `PrismaTaxRepository.upsertPeriod({ companyId, taxType, formType, periodKey })` find-or-create helper
   (already used by every loop in `sync-tax-events.use-case.ts`) — no schema change needed, just reuse of
   an existing primitive the spec didn't name. `taxEventIdsJson` stays `[]` (its existing default) since no
   discrete `TaxEvent` rows are linked.
2. **`buildMinimalPdf`/`buildTaxExportArtifact` (`tax-export.logic.ts`) is shared with
   `GenerateTaxFilingPackageUseCase`** (`generate-tax-filing-package.use-case.ts:64`), not exclusive to
   `CreateWhtCertificateUseCase`. The spec's §6 instruction to "replace `buildMinimalPdf`" would have
   silently changed the unrelated tax filing-package PDF too. The plan instead adds a new, dedicated
   renderer path (`wht-certificate-pdf.logic.ts` + a new `TaxArtifactRendererService.renderWhtCertificate`
   method) and leaves `buildMinimalPdf`/filing packages untouched.
3. **The actual SVG→raster→pdf-lib primitive to reuse is `renderSubstituteReceiptPdf` itself**
   (`apps/api/src/modules/expenses/domain/logic/substitute-receipt-pdf.logic.ts:341`) — it is a
   general-purpose "paginate this SVG buffer into a PDF" function (Thai-font raster guard included) with
   no expense-specific logic baked in, so the plan calls it directly from a new WHT-specific SVG-building
   function rather than forking the raster pipeline.
4. **`AccountsPayablePages.tsx`'s `WhtHandoffDetail` only branches on `status === 'EXTERNAL_LINKED'`**
   to hide the "attach externally issued certificate" form — it has no branch for `SYSTEM_ISSUED` at all
   today (nothing writes that status yet, so this was never exercised). The plan's frontend phase must add
   that branch, not just add a new button.
5. **`ListWhtIncomeCategoriesUseCase` already exists and is already exported** from
   `apps/api/src/modules/procurement/application/use-cases/wht-income-category.use-case.ts` /
   `procurement.module.ts` — the Expenses income-category endpoint (finding 7 above) can import and reuse
   it directly (adding `ProcurementModule` to `ExpensesModule`'s imports; no import cycle) instead of
   writing a new query, once Expenses has its own `whtCategoryCode`/`whtRate` columns to populate from it.
6. **The attachment-linking pattern (`attachmentLink` table) is duplicated per-module by convention** —
   `expenses`, `procurement`, `reimbursements`, and `crm-inbox` each carry their own small
   `linkAttachmentToTarget`-shaped repository method rather than sharing one. The new company-signature
   linking method (Phase 3) should follow this same convention as a small addition to
   `PrismaTaxRepository`, not a new cross-module shared service.

Verification:

- Docs-only task. No code run, no tests executed, no migrations touched (none created).
- All Phase A claims above are grounded in direct source reads (file:line citations are in the spec
  itself, section 12) rather than assumption — cross-checked against `docs/agent-memory/wht-durable-prefilled-handoff.md`
  and `docs/specs/feature-entitlement-decoupling-spec.md` for consistency with prior owner rulings.
- **2026-09-22 backport session:** re-verified all four spec-drift citations directly against current
  source before writing the spec's corrective notes — `generate-tax-filing-package.use-case.ts:64` calls
  `buildTaxExportArtifact`; `WhtCertificate.taxPeriodId`/`taxPeriod` relation confirmed at
  schema.prisma:5116-5117/5137 exactly; `AccountsPayablePages.tsx:980` confirmed as
  `const linked = handoff.status === 'EXTERNAL_LINKED'`; `ListWhtIncomeCategoriesUseCase` confirmed
  exported from `procurement.module.ts`. Golden-fixture PDF read once via the PDF-reading tool to
  transcribe exact field values (not paraphrased) before writing the plan's fixture table; file itself
  never written to the repo at any point in this session.

Next:

- **Plan is written and READY** (`docs/plans/wht-certificate-system-issuance-plan.md`, 6 ordered,
  independently-shippable phases: 1 prerequisite fixes, 2 permission+use-case+PDF template (still
  CLOSED), 3 company signature setting, 4 frontend wiring (still CLOSED), 5 tests, 6 evidence/rollout to
  actually OPEN the gate). All four items this file previously listed as "must still resolve at the plan
  stage" are resolved — see the "Open questions" section above for the concrete answers and the plan
  itself for full detail (§2.2 for the use-case design, §2.1/§2.1b for permission/pack strings, §3.1 for
  the schema, §2.3 for the route).
- Two more owner/controller decisions landed after the plan's first draft and are folded in (see
  Decisions above): **Decision A** (signature only in v1, seal deferred) and **Decision B** (signature
  upload/management gets its own OWNER-only permission `company.tax_signature.manage`, separate from
  `wht.certificate.issue`).
- Not implemented yet. Next actual step is Phase 1 of the plan (prerequisite fixes) — a normal
  implementation session, not further docs work. This memory file and the plan do not need another
  discovery pass before that starts.
- Still flagged, still not this task's scope to fix: the plan's Phase 6 item 6 repeats the spec's
  §13 note that `feature-entitlement-decoupling-spec.md:331` and `mangmee-package-entitlements-spec-th.md`
  are now contradicted by the ENTERPRISE-gating decision — neither file has been edited by any session
  yet.

## Implementation log

Status: Phases 1-5 implementation session, 2026-09-22. Working tree:
`.claude/worktrees/agent-afe8507423ce5af21` (branch `worktree-agent-afe8507423ce5af21`). Environment
note: this worktree had no `node_modules` at all (nested under the main checkout, so plain `tsx`
resolved via Node's ancestor walk-up to the main repo's root `node_modules`, but package-local bins
like `apps/api/node_modules/.bin/prisma` were unreachable) — `pnpm install --frozen-lockfile` at the
worktree root fixed this in ~4s (pnpm's global content-addressable store already had everything
cached, so it was pure linking, no download). Recorded here in case a future session in a fresh
worktree hits the same `prisma: command not found`/OOM-looking failure.

### Phase 1 — DONE

**1.1 (payer branch-code bug)**: `prisma-procurement.repository.ts`'s `createWhtHandoffForPayment`
now queries `tx.branch.findUnique({ where: { companyId_id: { companyId, id: data.branchId } },
select: { taxBranchCode: true } })` when `data.branchId` is present and writes `.taxBranchCode` into
`payerSnapshot.branchCode` (previously hardcoded `null`). Verify: extended
`prisma-procurement-integrity.repository.spec.ts` (new passing test + `branch.findUnique` mock added
to the shared `settlementClient` fixture) — 19/19 pass.
  - **Drift found**: the plan's note "ไม่มี data.branchId... คงเป็น null เหมือนเดิม" assumed a
    branch-less supplier payment is still possible. Since commit `18768642` (a prior "AP branch
    field" fix), `createSupplierPayment` now calls `requireTransactionBranchId` unconditionally, so
    every AP payment always carries a branchId — the "no branch" case is currently unreachable
    through the real endpoint. Kept the defensive `data.branchId ? ... : null` branch in the fix
    itself (harmless, matches the plan's stated intent for the function's own contract) but dropped
    the "no branch → stays null" regression test since it cannot be exercised without bypassing a
    guard that has nothing to do with this feature.

**1.2 (Expenses WHT income-category field + endpoint)**: full vertical slice, DONE.
  - Schema: `ExpenseRecord.whtCategoryCode String?` / `whtRate Decimal? @db.Decimal(8,4)`, additive
    migration `apps/api/prisma/migrations/20260922000000_expense_record_wht_category/migration.sql`.
    `prisma validate` clean, `prisma generate` regenerated the client.
  - Contracts: `UpdateExpenseDraftInput`/`ExpenseDetail` (`packages/contracts/src/expenses.ts`) gained
    `whtCategoryCode?`/`whtRate?`.
  - New endpoint `GET companies/:companyId/expenses/wht-income-categories` in
    `expense.controller.ts`, guarded by `expense.create`, calling `ListWhtIncomeCategoriesUseCase`
    (reused from `ProcurementModule`, now imported into `ExpensesModule` — no cycle, confirmed
    `ProcurementModule` only imports Audit/DataModelCore/Inventory/Tax).
  - `expense-status.logic.ts`: new `validateConfirm` rule mirroring RA-18 — blocks confirm when
    `whtAmount > 0 && !whtCategoryCode`. Call site (`expense-draft.use-case.ts`) passes
    `whtCategoryCode: r.whtCategoryCode`.
  - `prisma-expense.repository.ts`: new `createWhtHandoffForExpense` helper (mirrors
    `createWhtHandoffForPayment` field-for-field) wired into BOTH `confirmExpenseCas` and
    `finalizeAndConfirmExpenseCas`, inside the same transaction as the CONFIRMED write. Unlike AP
    (which only records a handoff while `whtSystemIssuanceOpen === false`), Expenses records it
    unconditionally whenever `whtAmount > 0` — this matches spec S3's literal text ("เสมอ... ไม่ว่า
    gate จะ OPEN หรือ CLOSED") even though it does NOT actually match AP's current code (see drift
    note below). `finalizeAndConfirmExpenseCas` reads the withheld amount from `acceptedRecord` (not
    `current`) because a VAT-source override can recompute `whtAmount`.
  - Web: dropdown "ประเภทเงินได้ (หัก ณ ที่จ่าย)" added to `ExpenseReviewEditSection` in
    `ExpensesPages.tsx` (NOT `ExpenseReviewPage.tsx` — see drift note below), mirroring the
    `vendorEntityKindSnapshot` dropdown exactly: fetches ACTIVE categories via new
    `listExpenseWhtIncomeCategories` (`expenses.api.ts`), shown only when `withholdsTax`, picking a
    category fills `whtRate` from its `defaultRate` (no separate rate-edit input, unlike AP's payment
    form — this is a classification field, not a new payment entry). Client-side validation mirror
    added to `expense-review-validation.ts` (`whtCategoryCode` issue, blocks confirm exactly like
    `vendorEntityKindSnapshot`). New i18n keys `expenses.wht_income_category` /
    `expenses.v_wht_category_required` (th+en) in `workspace-dictionary.ts`.
  - Verify: `expense-status.logic.spec.ts` (52/52 pass, 2 new cases),
    `prisma-expense.repository.atomic-confirm.spec.ts` (30/30 pass, 2 new cases: handoff created with
    correct prefill incl. branch code, no handoff when whtAmount is 0), web
    `expense-review-validation.spec.ts` (51/51 pass, 1 new case), web `expenses.model.spec.ts`
    (77/77 pass, regression only). `pnpm --filter @watchdog-bms/contracts build`,
    `pnpm --filter @watchdog-bms/api typecheck`, `pnpm --filter @watchdog-bms/web typecheck` all clean.
    `prisma:validate` clean.

  - **Drift found #1 (adapted, not a design conflict)**: `ListWhtIncomeCategoriesUseCase.execute`
    (the use case the plan says to "reuse ตรง ๆ ไม่ copy query") hardcodes
    `if (!ctx.permissions.includes('procurement.supplier_payment.read')) throw new
    ForbiddenException()` internally. Reusing it as-is behind the NEW endpoint's `expense.create`
    controller guard would still 403 for any real Expenses-only role that lacks
    `procurement.supplier_payment.read` (confirmed several such roles exist in
    `permission-registry.ts` — `expense.create` holders commonly carry only
    `procurement.supplier_payment.read_related`, a different, narrower permission). This is a
    concrete functional break, not a documentation nit, so it was adapted rather than silently
    worked around: loosened the internal check to `procurement.supplier_payment.read` OR
    `expense.create` (additive, does not narrow the existing AP path at all). Doc comment on the use
    case updated to explain both callers. Flagged here per the task's escalation instruction instead
    of guessing silently.
  - **Drift found #2 (file location, adapted)**: the plan names
    `apps/web/src/features/expenses/ExpenseReviewPage.tsx` as the file to add the dropdown to. That
    file only *displays* `vendorNameSnapshot`/`whtAmount` (read-only) and renders
    `<ExpenseReviewEditSection .../>` — the actual `vendorEntityKindSnapshot` dropdown this task must
    mirror lives in `ExpenseReviewEditSection`, which is defined and exported from
    `ExpensesPages.tsx`, not `ExpenseReviewPage.tsx`. Added the new dropdown next to its twin in the
    same component/file (`ExpensesPages.tsx`) rather than forcing it into the page file the plan
    named — the user-facing result is identical (it renders inside the confirm page either way, since
    `ExpenseReviewPage.tsx` renders `ExpenseReviewEditSection`).
  - **Drift found #3 (documentation-only, no code impact)**: the plan claims (Phase 1.2 intro) that
    `ExpenseRecord` has no `whtInputJson` field. It does (`schema.prisma`, used for the whole-bill
    RATE/AMOUNT withholding-amount input toggle) — but that field captures HOW `whtAmount` itself is
    computed, not the income-category classification `whtCategoryCode`/`whtRate` this phase adds, so
    the plan's actual design (add two new flat columns) was unaffected. Noted so a future reader does
    not think there is a second, more direct extension point that was missed.
  - **Behavioral note (not a code change, flagged for whoever eventually flips the gate in Phase 6)**:
    spec S3's "handoff created regardless of gate state, mirroring AP" is not literally true of AP's
    current code — `createSupplierPayment` only creates a handoff `when whtOptions.whtSystemIssuanceOpen
    === false`. Since the route-readiness gate stays CLOSED for the entire duration of Phases 1-5 (Phase
    6 is explicitly out of scope for this session), this divergence has zero observable effect today —
    but the moment the gate is opened, AP will STOP creating handoffs for new payments while Expenses
    keeps creating them unconditionally. Implemented Expenses exactly as the spec's literal S3 text and
    Phase 1.2 instruct (unconditional); did not touch AP's existing gate-condition (out of Phase 1.1's
    scope, which named only the `branchCode: null` line). Whoever owns Phase 6 should decide whether AP's
    condition needs updating at that point — recording it now so it is not a surprise later.

Commit: `dc20214c` — "feat(wht): Phase 1 — payer branch code fix + Expenses WHT income category"

### Phase 2 — DONE

**2.1/2.1b (permission + pack)**: `permission-registry.ts` — new `wht.certificate.issue` (HIGH,
granted to FINANCE and ACCOUNTANT right after `wht.external_certificate.link`) and
`company.tax_signature.manage` (HIGH, deliberately not added to any role's grant list — OWNER-only
by omission, mirrors `company.legal_identity.manage`). `capability-pack.registry.ts` — new
`pack.wht.certificate.issue` (`featureEntitlementKey: 'thai_tax'`, holds only
`wht.certificate.issue`) and `pack.company.tax_signature.manage` (same entitlement key, holds only
`company.tax_signature.manage`), both siblings of the existing ungated `pack.wht.certificate.manage`.

**2.2 (new use case)**: `apps/api/src/modules/tax/application/use-cases/issue-wht-certificate-from-handoff.use-case.ts`
— `IssueWhtCertificateFromHandoffUseCase`, mints straight off a `WhtCertificateHandoff` row: tenant
check → `REQUIRED` status check → route-gate check → `formType`/income-category null guards →
`upsertPeriod` (finding 8a's answer, no `POST tax/sync` needed) → reserve number (P2002
catch-and-replay) → render PDF → one `$transaction` (certificate create + number commit + conditional
handoff `updateMany` to `SYSTEM_ISSUED`) → audit → return DTO + `pdfArtifact`.

**2.3 (route)**: `POST companies/:companyId/wht/payment-handoffs/:handoffId/system-certificate` added
to `tax.controller.ts`, sibling to `linkExternalWhtCertificate`, guarded by `wht.certificate.issue`.
Registered in `tax.module.ts`.

**2.4 (gate visibility)**: `WhtCertificateHandoffUseCase.list`/`.get`/`toDto()` now compute
`systemIssuanceOpen` once per request and include it in `WhtCertificateHandoffDto`. Also added
`certificateId` to the same DTO (not explicitly named in plan §2.4's text, but required for Phase
4.1's "download the certificate after SYSTEM_ISSUED" — see finding below) — both additive, default
to `false`/pass-through on the write-path methods (`setPayeeAddress`/`linkExternal`) which the plan
does not name.

**2.5 (PDF template)**: new `apps/api/src/modules/tax/domain/logic/wht-certificate-pdf.logic.ts`
(`buildWhtCertificateSvg` pure SVG builder + `renderWhtCertificatePdf` thin wrapper over
`renderSubstituteReceiptPdf`), new `TaxArtifactRendererService.renderWhtCertificate()` method.
`CreateWhtCertificateUseCase` updated to call `renderWhtCertificate(...)` instead of
`render('PDF', ...)` — `buildMinimalPdf`/`buildTaxExportArtifact`/`GenerateTaxFilingPackageUseCase`
untouched. Signature wiring (`CompanyTaxProfile` lookup) is a Phase 3 stub for now
(`resolveSignature()` always returns `undefined` = BLANK) in both the new use case and
`CreateWhtCertificateUseCase` — Phase 3 will wire the real lookup into both, for consistency (see
finding below; plan §3.4 only names the new use case explicitly).

Verify: `pnpm --filter @watchdog-bms/contracts build` clean; `pnpm --filter @watchdog-bms/api
typecheck` clean (heap-flagged script — see below); `pnpm --filter @watchdog-bms/api prisma:validate`
clean (no schema change this phase); targeted specs all green —
`issue-wht-certificate-from-handoff.use-case.spec.ts` (new, 7/7), `wht-certificate-pdf.logic.spec.ts`
(new, 7/7), `create-wht-certificate.use-case.spec.ts` (8/8, updated renderer mock),
`wht-certificate-handoff.use-case.spec.ts` (33/33, updated gate stub), `permission-registry.spec.ts`
(all pass), `tax.controller.spec.ts` (all pass, constructor arg count fixed). Both new spec files
registered in `apps/api/package.json`'s enumerated `test` script (repo convention — see recent commits
like `test(api): register the new reimbursement defaults and workflow template specs`). Did not run
the full enumerated `pnpm --filter @watchdog-bms/api test` list or `node
scripts/run-line-ai-whole-chain-acceptance.mjs` — owner's minimal-testing directive defers the
full/whole-chain suites to CI at merge time; only the specs touched or newly added this phase were run
directly.

- **`pnpm --filter @watchdog-bms/api lint` OOM-aborts** (confirmed directly — bare `tsc --noEmit`,
  no heap flag, `SIGABRT`), exactly matching the standing memory note
  (`api-typecheck-needs-the-heap-flag`). Used `pnpm --filter @watchdog-bms/api typecheck`
  (`NODE_OPTIONS=--max-old-space-size=8192 tsc --noEmit` — the identical check, just with enough
  memory) as the real verification instead, per that same memory note's guidance.
- **Finding (adapted, not a plan contradiction): `CommitDocumentNumberUseCase.execute()` cannot be
  called from inside the use case's own `$transaction`.** It opens its own nested
  `this.prisma.client.$transaction(...)` internally, which would not share the outer transaction —
  breaking the atomicity plan step 8 explicitly requires ("create WhtCertificate row →
  commitNumber.execute(...) → whtCertificateHandoff.updateMany(...)" all "ใน Prisma $transaction
  เดียว"). Injected `PrismaDocumentSequenceRepository` instead and called
  `commitNumberInTransaction(tx, ...)` directly inside the transaction — the exact pattern
  `expenseNumberInTransaction` (`prisma-expense.repository.ts`) already established for the identical
  reserve-then-atomic-commit problem. Manually reproduced the `document.number.commit` LOW-risk audit
  entry `CommitDocumentNumberUseCase` would otherwise have logged, so the audit trail is unaffected.
  `ReserveDocumentNumberUseCase` is still used as-is (its own micro-transaction, outside the main one,
  with the P2002 catch — reserving inside the main transaction would poison it on a genuine race,
  exactly why `WhtCertificateHandoffUseCase.createOrReplay`'s own doc comment says the recovery
  cannot be attempted inside a caller's transaction).
- **Finding (real, not yet fully resolved — flagged for Phase 4): nothing ever populates
  `WhtCertificate.pdfAttachmentId`.** Confirmed by grep: the existing `CreateWhtCertificateUseCase`
  (Tax-workspace path) has never written it either — the PDF is delivered ONLY as the inline
  `pdfArtifact.contentBase64` in the mint response, never persisted as an `AttachmentObject`. Plan
  Phase 4.1 assumes "GET/download attachment ตาม pattern ดาวน์โหลดไฟล์ที่มีอยู่แล้วในrepo" using
  `pdfAttachmentId` — that field will always be null, so this specific download mechanism cannot work
  as literally described. Phase 4 will need to trigger the download directly from the mint response's
  `pdfArtifact.contentBase64` (e.g. a `data:application/pdf;base64,...` URL/Blob) instead of a
  separate attachment fetch. Added `certificateId` to `WhtCertificateHandoffDto` (this phase, §2.4)
  so the AP/Expenses UI can at least identify which certificate a `SYSTEM_ISSUED` handoff points to,
  but the actual PDF bytes only exist in that one mint response today — there is currently no GET
  endpoint that re-fetches a previously-issued certificate's PDF at all (Tax-workspace has the same
  gap). This is pre-existing scope, not something Phase 2 introduced.

Commit: `ed2f6f7e` — "feat(wht): Phase 2 — issue permission/pack, use case, route, PDF template"

### Phase 3 — DONE

**3.1 (schema)**: `CompanyTaxProfile.signatureMode String @default("BLANK")` +
`signatureImageAttachmentId String?`, additive migration
`20260922010000_company_tax_profile_signature_mode`. No seal column at all (Decision A). `prisma
validate`/`generate` clean.

**3.2 (upload/link)**: no dedicated upload endpoints added — the web page reuses the existing
GENERIC `companies/:companyId/attachments/{upload-intent,:id/complete}` endpoints
(`AttachmentController`, gated by the already-broad `attachment.create`) exactly like
`transaction-tax.api.ts`'s `uploadTradeTaxEvidenceAttachment` already does for a different tax
upload. Only the LINKING is tax-specific: new `PrismaTaxRepository.linkAttachmentToTarget()` (fifth
copy of the pattern, `targetType: 'company.tax_signature'`, `targetId: companyId`) — did NOT reuse
the generic `LinkAttachmentUseCase`, because it hardcodes an allow-list of exactly two target types
(`expense.record`, `accounting.document'`) and would need modification (out of scope) to accept a
third.

**3.3 (API + UI)**: new `PATCH companies/:companyId/tax/profile/signature`
(`UpdateCompanyTaxSignatureUseCase`, guarded by `company.tax_signature.manage`) validates
`AUTO_STAMP` requires `signatureAttachmentId` + the attachment is `ACTIVE` + PNG/JPEG (the only two
formats the PDF's `<image>` can embed), links it, upserts `CompanyTaxProfile`; `BLANK` always clears
`signatureImageAttachmentId` (never a stale reference a later re-enable would silently reuse). New
DTO `UpdateCompanyTaxSignatureDto` (`tax.dtos.ts`) + contract type (`tax.ts`). `GET tax/profile`'s
no-row fallback now includes `signatureMode: 'BLANK'`/`signatureImageAttachmentId: null`.
Web: new `apps/web/src/features/tax/TaxSignatureSettingsPage.tsx` (there was NO existing company
tax-settings page to extend — confirmed by grep, `CompanyTaxProfile` fields were entirely unread by
the web app before this) + route
`apps/web/app/(workspace)/companies/[companyId]/settings/tax-signature/page.tsx` + menu entry in
`settings-menu.logic.ts` (`section: 'advanced'`) + route-permission rule in `route-permissions.ts`
(`anyOf: ['company.tax_signature.manage']`) — both existing generic mechanisms already hide/show
cards and refuse routes by permission, so FINANCE/ACCOUNTANT never see or reach this page at all
(not just a 403 after opening it).

**3.4 (PDF wiring)**: `IssueWhtCertificateFromHandoffUseCase.resolveSignature()` now really queries
`CompanyTaxProfile`, loads the attachment via `PrismaAttachmentRepository`/`ATTACHMENT_STORAGE`
(mirrors `GetSignatureImageUseCase`'s exact retrieval pattern), returns base64 + real mime type.
**Went beyond §3.4's literal text on purpose**: also wired the identical `resolveSignature()` into
`CreateWhtCertificateUseCase` (the Tax-workspace path) — the plan names only the handoff use case,
but §2.5 explicitly requires "the same gate... must render the same real PDF" for both entry
points, and leaving Tax-workspace permanently BLANK regardless of the company's setting would
silently break that promise the moment any company opts into AUTO_STAMP. `WhtCertificateSignature`
gained `signatureImageMimeType` (defaults to PNG) since an uploaded signature can legitimately be
either PNG or JPEG.

Verify: `prisma validate`/`generate` clean; `pnpm --filter @watchdog-bms/contracts build` clean;
`pnpm --filter @watchdog-bms/api typecheck` clean; `pnpm --filter @watchdog-bms/web typecheck`
clean. New `update-company-tax-signature.use-case.spec.ts` (7/7: AUTO_STAMP requires attachmentId,
BLANK always clears, ACTIVE+PNG/JPEG validation, successful link+persist+audit). New
`permission-registry.spec.ts` case: `company.tax_signature.manage` absent from every non-OWNER role,
present via `COMPANY_PERMISSION_KEYS`, while `wht.certificate.issue` stays on FINANCE/ACCOUNTANT
(the two-permission split from Decision B, both asserted in one place). Re-ran
`create-wht-certificate.use-case.spec.ts` (8/8), `issue-wht-certificate-from-handoff.use-case.spec.ts`
(7/7), `wht-certificate-pdf.logic.spec.ts` (7/7), `tax.controller.spec.ts` — all green after
constructor-arg updates. Web: `settings-menu.logic.spec.ts` updated for the 9th card and re-passes
(9/9), including its generic "every card's route rule actually grants what the card promises" loop.
New use-case spec registered in `apps/api/package.json`'s enumerated test script.

Commit: `bb463f02` — "feat(wht): Phase 3 — company signature setting for the 50 ทวิ PDF"

### Phase 4 — DONE

**4.1 (AP `WhtHandoffDetail`)**: fixed the confirmed drift — `const issued = handoff.status ===
'SYSTEM_ISSUED'` added alongside the existing `const linked = handoff.status === 'EXTERNAL_LINKED'`
(previously SYSTEM_ISSUED fell through to the external-attach form). New "ออกเอกสารในระบบ" button,
gated by a new pure predicate `canIssueSystemWhtCertificate(handoff, permissions)`
(`accounts-payable.model.ts` — status REQUIRED + `systemIssuanceOpen` + the permission, which already
folds in the `thai_tax` entitlement), placed beside the existing "แนบหนังสือรับรองที่ออกภายนอกแล้ว"
form inside the same `REQUIRED`-only branch. `WhtHandoffPanel` now passes `permissions` straight
through instead of pre-computing a `canIssue` boolean, so the component and the test both call the
same real predicate. New client `issueSystemWhtCertificate` in `accounts-payable.api.ts`.

**4.2 (Expenses confirm flow)**: both confirm buttons (guided-step and approver-only paths, which
called an identical inline `confirmExpense` lambda) now go through one shared `doConfirm` handler,
so the post-confirm logic lives in exactly one place. After a successful confirm, if the expense
withheld tax (`hasWht`, read from the pre-confirm `detail` closure — whtAmount does not change as a
*result* of confirming) and the caller holds `wht.certificate.issue`, it queries
`GET wht/payment-handoffs?status=REQUIRED&sourcePaymentId=<expenseId>` and offers a dismissible
prompt (never mandatory, per spec §4.2 item 3) to issue immediately. New client functions
(`listWhtHandoffs`, `issueSystemWhtCertificate`) added directly to `expenses.api.ts` — a second thin
copy of what `accounts-payable.api.ts` already has, matching the backend's own established
per-module-copy convention rather than a shared cross-feature client.

- **Drift found and fixed (backend, needed for §4.2 to work at all)**: the plan's §4.2 text assumes
  `WhtCertificateHandoffUseCase.list()` can already filter by `sourcePaymentId` ("ที่มีอยู่แล้วในรูปแบบ
  WhtCertificateHandoffUseCase.list") — it could not; `.list()` only accepted `status`/`branchId`.
  Added `sourcePaymentId` as a third optional filter (mirrors the existing two exactly), threaded
  through `TaxController.listWhtHandoffs`'s new `@Query('sourcePaymentId')` param. This is the
  plan's own explicitly-named fallback path ("query handoff แยกทันทีหลัง confirm... เลือกแบบหลังถ้า
  response เดิมไม่อยากแก้ shape เยอะ") — chosen over extending `ConfirmExpenseDto`'s response shape,
  which the plan itself frames as the more invasive alternative.
- **Design finding carried from Phase 2, now visible in the UI**: `WhtCertificate.pdfAttachmentId`
  is never populated (confirmed again here), so there is no persistent "download" link to show after
  a page reload — both AP and Expenses trigger the browser download immediately from the mint
  response's `pdfArtifact.contentBase64` (new shared `apps/web/src/common/files/download-artifact.ts`,
  mirrors `TaxWorkspacePage.tsx`'s existing local `downloadArtifact`, promoted to a shared util once
  a THIRD call site needed the identical 8 lines) and keep the artifact in local React state only
  long enough to offer a same-session "download again" button. This is a real, deliberate departure
  from the plan's literal "pdfAttachmentId จาก certificate" text, necessitated by the Phase 2 finding,
  not a new problem introduced here.

Verify: `pnpm --filter @watchdog-bms/api typecheck` clean; `pnpm --filter @watchdog-bms/web
typecheck` clean. New `wht-certificate-handoff.use-case.spec.ts` case for the `sourcePaymentId`
filter (34/34 total, mock `findMany` extended to honor it). New
`accounts-payable.model.spec.ts` cases for `canIssueSystemWhtCertificate` (S9: both gates, and
never past REQUIRED). New `WhtHandoffDetail.wiring.spec.ts` (source-text assertions, mirrors the
existing `ForeignCurrencyNotice.spec.ts` technique for a component too large/stateful to render:
confirms SYSTEM_ISSUED is its own branch, the button calls the shared predicate not a duplicated
condition, issuing downloads the PDF immediately, and the issued banner is checked before linked).
New cases appended to the existing `ExpenseReviewPage.qa.spec.ts` (same technique: both confirm
buttons share one handler, the prompt's gate condition, the dismiss control proving it is optional,
and the issue-and-download wiring). All new/updated specs pass.

Commit: `b61e0685` — "feat(wht): Phase 4 — frontend wiring at the AP and Expenses entry points"

### Phase 5 — DONE

Everything Phase 5 names beyond what Phases 1-4 already added test coverage for, plus a full
regression pass:

- **Item 6 (void path, S7)**: the plan cites `prisma-procurement.repository.spec.ts`, which does not
  exist — the real file covering the supplier-payment void path is
  `pp36-payment-reversal.repository.spec.ts` (drift, adapted). Its existing "refuses the void once a
  real 50 ทวิ has been issued" test used a `whtCertificateHandoff.count` mock that ignored `where`
  entirely (`count: async () => options.certificateLinked ? 1 : 0`), so it was only trivially true —
  it never actually proved the guard's `status: { in: ['EXTERNAL_LINKED', 'SYSTEM_ISSUED'] }` query
  covers `SYSTEM_ISSUED` specifically. Tightened the mock to inspect `where.status.in`, then added a
  new test naming `SYSTEM_ISSUED` explicitly (renamed the original to say "externally linked" for
  clarity). No production code changed — the guard already covered both, per finding 8d.
- **Item 9 (pack gating)**: no `capability-pack.registry.spec.ts` exists (plan said "ถ้ามี"). Added
  an end-to-end test to the existing `feature-gate.logic.spec.ts` instead, right beside the two
  tests that already prove the H4 default (`wht.certificate.read`/`.external_certificate.link`
  survive without `thai_tax`): proves `wht.certificate.issue` is stripped without `thai_tax` and
  kept with it, using the real `filterPermissionsByEntitlement` function — the same function that
  would let a permission "leak" ungated if it were ever accidentally added to
  `pack.wht.certificate.manage`. This is a stronger proof than a static registry-shape assertion
  would have been (it exercises the actual filtering behavior, not just the data).
- **Item 10**: already done in Phase 3 (`permission-registry.spec.ts`).
- **Items 1-5, 7-8**: already done in their respective phases (Phase 1: prisma-procurement-integrity,
  expense-status.logic, prisma-expense.repository.atomic-confirm; Phase 2:
  issue-wht-certificate-from-handoff.use-case.spec.ts, wht-certificate-pdf.logic.spec.ts; Phase 4:
  accounts-payable.model.spec.ts + WhtHandoffDetail.wiring.spec.ts, expense-review-validation.spec.ts
  + ExpenseReviewPage.qa.spec.ts).

**Full regression pass** (the "รายการที่มีอยู่แล้วต้องเขียวต่อ" list plus every spec touched or added
across all 5 phases, run together):
- API: `create-wht-certificate.use-case.spec.ts`, `wht-certificate-handoff.use-case.spec.ts`,
  `wht-income-category.use-case.spec.ts`, `wht-report.logic.spec.ts`,
  `sync-tax-events-supplier-payment-wht.use-case.spec.ts`, `expense-status.logic.spec.ts`,
  `prisma-expense.repository.atomic-confirm.spec.ts`,
  `issue-wht-certificate-from-handoff.use-case.spec.ts`, `wht-certificate-pdf.logic.spec.ts`,
  `prisma-procurement-integrity.repository.spec.ts`, `pp36-payment-reversal.repository.spec.ts`,
  `permission-registry.spec.ts`, `feature-gate.logic.spec.ts`,
  `update-company-tax-signature.use-case.spec.ts`, `tax.controller.spec.ts` — **283/283 pass**.
- Web: `accounts-payable.logic.spec.ts`, `accounts-payable.model.spec.ts`,
  `WhtHandoffDetail.wiring.spec.ts`, `ExpenseReviewPage.qa.spec.ts`,
  `expense-review-validation.spec.ts`, `expenses.model.spec.ts`, `settings-menu.logic.spec.ts` —
  **182/182 pass**.
- `pnpm --filter @watchdog-bms/contracts build` clean.
- `pnpm --filter @watchdog-bms/api typecheck` clean (heap-flagged script; bare `tsc --noEmit`/the
  `lint` script OOM-aborts on this machine, confirmed in Phase 2 and unchanged since).
- `pnpm --filter @watchdog-bms/web typecheck` clean.
- `pnpm --filter @watchdog-bms/api prisma:validate` clean.

**Deliberately NOT run** (owner's minimal-testing directive, explicit in this task's brief): the full
enumerated `pnpm --filter @watchdog-bms/api test` (hundreds of unrelated specs), the full glob
`pnpm --filter @watchdog-bms/web test` (every `*.spec.ts` in the web app), and
`node scripts/run-line-ai-whole-chain-acceptance.mjs` (unrelated LINE-AI suite). All of these are
expected to run once at merge time in CI per the standing directive; only specs touched, extended,
or newly added by this task were run directly, across every phase.

### Post-Phase-5 fix — DONE (commit `233d5249`)

While reviewing the Phase 5 completion report, the controller (main thread, not a subagent) found a
genuine correctness bug by reading `prisma-procurement.repository.ts`'s `createSupplierPayment`
directly: it only called `createWhtHandoffForPayment` when `whtOptions.whtSystemIssuanceOpen === false`
— pre-existing code from before this session (blame traces to the initial import commit `668a2d08`),
built on the assumption that once `cap.wht50bis/SYSTEM_INITIAL_ISSUE` opens, the system would mint a
certificate **inline at settlement** instead of ever creating a handoff (a real, deliberately-tested
pre-existing behavior — `prisma-procurement-integrity.repository.spec.ts` had a named test: "creates no
handoff when the SYSTEM route is open (the system issues the certificate itself)").

That assumption is superseded by everything this whole session actually built: the spec/plan's AP
journey (§4.1) puts the "ออกเอกสารในระบบ" button **on the existing handoff panel**, and
`IssueWhtCertificateFromHandoffUseCase` (Phase 2) operates on an existing `WhtCertificateHandoff` row
by `handoffId` only. If the gate had opened in production without this fix, `createSupplierPayment`
would have stopped creating handoffs for AP payments entirely — the new button would have had nothing
to act on, silently breaking the whole feature for the AP entry point the moment Phase 6 completed.
Expenses (Phase 1.2, this session) already creates its handoff unconditionally per spec S3's literal
text, so this was a real AP/Expenses divergence, not a hypothetical.

**Confirmed with the owner before fixing** (this was a genuine "system behavior" conflict per AGENTS.md's
escalation rule, not a guess) — owner said "ยืนยัน" (confirmed) to fix AP to always create the handoff,
matching Expenses and the spec/plan's actual button-driven design.

**Fix**: removed the dead `whtOptions: { whtSystemIssuanceOpen?: boolean }` parameter from
`createSupplierPayment` (confirmed via grep it had exactly one call site,
`supplier-payment.use-case.ts`, itself only used to compute this one flag — removed that computation,
its now-dead `WhtCertificateHandoffUseCase` constructor injection, and the now-unused import); the
handoff is now created whenever `whtAmount > 0`, unconditionally. Updated every test that constructed
`CreateSupplierPaymentUseCase` or called `createSupplierPayment` with the now-removed argument (7 call
sites across 4 spec files) and rewrote the one test that asserted the old "no handoff when open"
behavior into one that asserts the handoff is still recorded (renamed, `prisma-procurement-integrity.repository.spec.ts`).

**Verify**: ran the 4 touched spec files directly (`prisma-procurement-integrity.repository.spec.ts`,
`supplier-payment-integrity.use-case.spec.ts`, `vendor-bill-maker-checker.use-case.spec.ts`,
`vendor-bill-transaction-tax.use-case.spec.ts`) via `npx tsx --test --test-reporter=dot` from
`apps/api` — 67/67 pass, exit 0. `pnpm --filter @watchdog-bms/api typecheck` (heap-flagged script)
clean, exit 0. Not re-run: the full 283/283 regression pass from Phase 5 (out of scope for this
narrow fix per the owner's minimal-testing directive; nothing else references the removed parameter
per a repo-wide grep, so no other spec should be affected — worth a full run at the next merge-time CI).

**Still true, unchanged by this fix**: the payment itself is never blocked by an unissued certificate
(spec:299) — this fix only changes when a handoff is *recorded*, never whether the settlement succeeds.

### Post-push CI fix — DONE (commit `92963900`)

PR #720 (develop-bound) CI caught a real gap the local "touched specs only" verification never
would: `apps/web/src/common/api/api-error-coverage.spec.ts` enforces Thai text for every error code
a default-open module can throw, scanning API source directly rather than a restated list. Six new
codes from this session's work had none, so they would have reached the user as raw snake_case:
`wht_handoff_not_issuable`, `wht_system_issuance_unavailable`, `wht_handoff_form_type_unresolved`,
`wht_handoff_income_category_missing`, `wht_certificate_issue_in_progress`,
`wht_signature_attachment_required`. Fixed by adding entries to
`apps/web/src/common/api/api-error-message.ts`'s dictionary, next to the existing `wht_handoff_*`
entries, reusing the Thai text already embedded in each backend exception's `message` field (already
well-written and specific, per grep of `issue-wht-certificate-from-handoff.use-case.ts` and
`update-company-tax-signature.use-case.ts`). `wht_handoff_not_issuable` has two throw sites with
different messages (wrong status vs. status changed mid-request); the dictionary entry generalizes
both since it's keyed by code, not call site.

Verified locally: `npx tsx --test src/common/api/api-error-coverage.spec.ts` from `apps/web` —
11/11 pass (was failing 1/3 subtests before the fix). Pushed; awaiting the re-triggered PR #720 CI run.

**Lesson for future sessions doing web-facing error-code work in this repo**: the plan/spec's own
"tests to add" lists did not name this suite because it's a repo-wide guard, not something scoped to
this feature — any new user-facing exception code needs a matching entry here, and CI is the actual
backstop since it scans API source directly rather than trusting a hand-maintained list.

### Second CI round — two more repo-wide UI guards caught real gaps (commit `5ca3e6af`)

Same PR #720, next CI run after the Thai-text fix: two DIFFERENT repo-wide guards failed, both
against the new `TaxSignatureSettingsPage.tsx` (Phase 3) specifically:
1. `no-raw-api-error-display.spec.ts` — all three `catch (cause) { setError(cause instanceof Error ?
   cause.message : String(cause)); }` blocks displayed a raw caught exception message instead of
   routing through the reviewed `apiErrorMessage()` translator (the pattern every other page in this
   app already uses, e.g. `TaxWorkspacePage.tsx`, `BillingCollectionPanel.tsx`). Fixed by importing
   `apiErrorMessage` from `@/common/api/api-error-message` and replacing all three catch bodies.
2. `action-loading.spec.ts` — the "บันทึก" save button was `disabled={busy}` without `aria-busy={busy}`,
   the accessibility pairing every other busy-gated button in this app follows (confirmed pattern in
   `TaxWorkspacePage.tsx`). Fixed by adding `aria-busy={busy}` to the one button.

Verified locally: `npx tsx --test` on all three touched guard specs (Thai-coverage +
no-raw-api-error-display + action-loading) — 25/25 pass. `pnpm --filter @watchdog-bms/web typecheck`
clean. Pushed; awaiting the third PR #720 CI run.

**Compounding lesson**: this is now the SECOND and THIRD repo-wide UI-quality guard this feature's new
UI code tripped, both on the same new file. Neither guard was named in the plan's "tests to add" list
because both are project-wide invariants scanned from source (like the Thai-coverage one), not
feature-scoped tests a plan would think to enumerate. Any future new page/component in this repo
should expect CI, not the plan, to be the actual backstop for these three source-scanning guards:
Thai error-text coverage, no-raw-error-display, and busy/aria-busy pairing.

### Third CI round — unrelated pre-existing gap surfaced by the develop merge (commit `b3241ece`)

Not caused by this feature: `modules/billing/application/billing-deal-subscription-cancel.spec.ts`
(from an unrelated billing/sales-deal feature already merged to `develop` before this branch merged
develop in) was never wired into any test runner, tripping `spec-suite-coverage.spec.ts`'s "leaves no
spec file unreferenced" guard. The spec itself passes cleanly (2/2) — purely a wiring gap on develop's
side that this PR's CI run happened to be the one to surface, since it runs against the merged tree.
Fixed by adding it to `scripts/line-ai-whole-chain-acceptance.catalog.mjs` next to its sibling billing
specs (billing specs are wired there, not in `apps/api/package.json`, per that file's own comments).
Verified locally: the spec itself (2/2 pass) and `spec-suite-coverage.spec.ts` (3/3 pass). This fix
rides into `develop` with this PR's merge, benefiting every other branch going forward too.
