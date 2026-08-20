# VAT-Registration-Aware Expense Capture Spec

## 1. Status

v1.3, 2026-08-05. **Implemented** (plan steps 1–7). v1.3 moves the VAT question out of manual capture and into admin company registration — see §8.1 for the two defects that placement caused. v1.1 recorded the owner's answers to Q1–Q3 (§16) and the export/reporting impact analysis (§12.1). v1.2 records what implementation changed: the derivation now lets an answered `NOT_REGISTERED` outrank the `thai_tax` entitlement (§5), the claim guard sits at confirmation rather than the draft write (§7.6), and the per-document escape hatch was dropped in favour of the question itself (§7.7).

Owner: thawtchai. Product trigger: early users include solo operators and older users starting a first business. The expense capture flow currently asks every user Thai VAT questions unconditionally, including companies that are not VAT-registered and have no reason to answer them. The requirement confirmed by the owner is **both**: a non-VAT company must get a simple capture flow, and a VAT-registered company must keep the full tax capture it has today. Neither may be traded for the other.

Linked plan: [[plans/vat-registration-aware-expense-capture-plan|VAT-Registration-Aware Expense Capture Plan]]

Depends on: [[specs/company-tax-identity-setup-spec|Company Tax Identity Setup Spec]] §5 (VAT registration facts, tri-state accessor, ask-once prompt). That spec owns the *fact*; this spec owns what expense capture *does* with it. Release A4 of that plan owns the wizard that asks the question; this spec does not re-specify it and must not duplicate it.

Related: [[specs/feature-entitlement-decoupling-spec|Feature Entitlement Decoupling Spec]] v5.1 CC4 (`thai_tax` entitlement), [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]] (capture surfaces), [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]] (downstream tax events).

## 2. Goal

Make Thai VAT questions appear in the expense/reimbursement journey only when they are answerable and consequential for that company on that document's date, without weakening any existing tax-capture behavior for VAT-registered companies.

Concretely:

1. A company with no VAT registration sees a capture form about *money and evidence*, not about *Tax Codes and claimability*.
2. A VAT-registered company sees exactly what it sees today.
3. A company nobody has asked yet is never silently downgraded and never silently upgraded — it keeps working and gets asked once, in place.
4. A document dated before the company's VAT effective date is treated by its own date, not by today's status.
5. An input-VAT claim that the company is factually not entitled to is refused at the API, not only hidden in the UI.

## 3. Source Facts (verified in code on 2026-08-05)

| Fact | Evidence |
| --- | --- |
| VAT registration is a dated interval history with a tri-state accessor (`REGISTERED` / `NOT_REGISTERED` / `UNKNOWN`) | `apps/api/src/modules/data-model-core/domain/logic/company-vat-registration.logic.ts:68` |
| `GET/PUT /v1/companies/:companyId/vat-registration` exists, `asOf` supported, `company.vat_registration.read` / `.manage` | `apps/api/src/modules/data-model-core/presentation/http/company-vat-registration.controller.ts:54,66` |
| `GET company-identity` already returns `vatRegistration` + `readiness.vat` | `apps/api/src/modules/data-model-core/application/use-cases/company-identity.use-case.ts:142` |
| **No web code reads VAT registration status anywhere** | `rg 'vatRegistered\|vat-registration' apps/web/src` → 1 unrelated hit |
| **No UI ever writes a VAT registration fact or resolves the prompt** — `vatRegistrationPrompt` is only ever read | `company-identity.use-case.ts:75,341`; no `create`/`upsert` in the repo |
| Therefore every real company today is `UNKNOWN` | consequence of the two rows above |
| Manual capture renders the Tax Code card unconditionally | `apps/web/src/features/expenses/ExpensesPages.tsx:1552` |
| Review edit renders the per-line Tax Code selector gated only on document type | `ExpensesPages.tsx:1107` |
| Tax Code list endpoint is gated on `company.branch.read`, not on `thai_tax` and not on any tax permission | `apps/api/src/modules/tax/presentation/http/transaction-tax.controller.ts:125` |
| Selector shows an amber "ยังไม่มี Tax Code … · ตั้งค่าภาษี" CTA when the list is empty | `apps/web/src/features/tax/TransactionTaxLineSelector.tsx:128` |
| Ledger already zeroes VAT for a non-claimable expense before posting | `apps/api/src/modules/ledger/application/use-cases/journal.use-case.ts:70` |
| Claimability today is decided by document type + evidence status only, never by company VAT registration | `apps/api/src/modules/expenses/domain/logic/expense-status.logic.ts:172` |
| Tax module capability packs are `thai_tax`-entitled; the ภาษี menu is permission-gated | `capability-pack.registry.ts:410`; `web-core-workspace.constants.ts:192` |

## 4. Non-goals

- Re-specifying the VAT registration wizard, prompt copy, or fact-write command. Release A4 of Company Tax Identity Setup owns those.
- Changing the sales/tax-invoice issuance gate. `taxInvoiceEligible` already governs it.
- Changing what the ภาษี (Tax Workspace) module does. Hiding it is an entitlement decision, not a code change.
- Changing tax computation, Tax Code semantics, posting rules, or report mapping.
- Changing the accountant export payload — index CSV, index XLSX, or evidence manifest. See §12.1 for why this is a non-goal rather than an oversight.
- Inferring VAT registration status from legacy data. Recorded lesson from Company Tax Identity Setup: legacy `TAX_INVOICE` rows from a baseline that never enforced VAT do not prove registration. No proxy fact may be invented here.
- Backfilling VAT facts for existing companies.

## 5. Key Design Decision — capture mode is a presentation policy, not a fact

Two distinct things must not be conflated:

- **`vatStatus`** — a fact about the company, tri-state, dated, HIGH-risk to write, permission-gated to read.
- **`captureMode`** — a UI policy: `FULL` or `SIMPLE`. Derived, never persisted, never audited as a fact, never used to decide tax correctness.

`captureMode` is derived as:

```
captureMode(companyId, on) =
  FULL    if vatStatus(on) == REGISTERED
  SIMPLE  if vatStatus(on) == NOT_REGISTERED
  FULL    if UNKNOWN and thai_tax entitlement is enabled
  SIMPLE  if UNKNOWN and it is not
```

An **answered** fact decides on its own. Only `UNKNOWN` defers to the entitlement.

Rationale for each arm:

- `REGISTERED` ⇒ `FULL` is the fact-driven case.
- `NOT_REGISTERED` ⇒ `SIMPLE` **outranks the entitlement**. `thai_tax` is ON by default for every new company (`DEFAULT_ENABLED_FEATURE_KEYS`, owner decision 2026-08-04), so an entitlement-first rule would show the full tax UI to a company that has told us it is not registered — and the §7.6 claim guard would then reject exactly what that UI invited.
- `UNKNOWN` + entitled ⇒ `FULL` protects every existing company. No UI writes a registration fact yet, so every company in production reads `UNKNOWN`; without this arm they would all lose tax capture on deploy. This arm reads an entitlement, never a proxy for registration.
- `UNKNOWN` + not entitled ⇒ `SIMPLE`. No tax module and no answer means no tax questions.

`UNKNOWN` therefore never blocks anything and never changes an entitled company's screen. This is consistent with Company Tax Identity Setup §5 ("ไม่มีผู้อ่าน boolean ตรง … ผลเฉพาะ readiness/wizard") and its Q4 ("UNKNOWN ไม่ block, default = พฤติกรรมเดิม") — this spec adds a reader that treats `UNKNOWN` as *do not change today's behavior*, not as *not registered*.

**Sequencing consequence, and it is the important one.** Because `thai_tax` defaults on, a company reaches `SIMPLE` only once somebody actually answers the VAT question. Hiding the tax questions requires asking one first. This makes the ask (§8, plan step 6) the step that delivers the product value, not a nicety bolted on the end — and it makes G1 a hard dependency for the persona rather than a background gap.

## 6. Business Journey

**Solo owner, not VAT-registered (SIMPLE).** Opens บันทึกด้วยมือ → enters date, vendor, description, amount, optional service charge → attaches the receipt photo → saves. No Tax Code card, no VAT mode dropdown, no "ตั้งค่าภาษี" CTA, no หลักฐานภาษี badge in the primary path. If the receipt happens to be a full tax invoice they can tick **"ใบนี้เป็นใบกำกับภาษี"**, which asks the VAT registration question once (§8) rather than silently opening a claim path.

**VAT-registered company (FULL).** Unchanged from today, in every capture surface.

**Company that registers for VAT mid-year.** Expenses dated before the effective date stay SIMPLE; expenses dated on/after are FULL, in the same list, without any migration.

## 7. Business Rules

1. `captureMode` is evaluated per document using the **document's own date** (`expenseDate`), never `today`. A manual form with no date yet uses today as a provisional value and re-evaluates when the date changes.
2. `SIMPLE` mode hides, and never pre-fills with a guess: the per-line Tax Code selector, the VAT mode selector, the input-VAT claimability control, and the "ตั้งค่าภาษี" CTA.
3. `SIMPLE` mode submits `vatMode = 'NO_VAT'`, `inputVatClaimStatus = 'NON_CLAIMABLE'`, no `taxCodeDefinitionId`. These are the values the manual form already defaults to; SIMPLE stops asking, it does not change the default.
4. Hiding is presentation only. An existing expense that already carries tax data keeps it. `SIMPLE` mode must not null, zero, or rewrite stored `vatMode`, `vatRate`, `vatAmount`, `taxCodeDefinitionId`, or `taxSnapshot` on load or on save.
5. An expense whose stored data contradicts SIMPLE (any line with `vatAmount ≠ 0`, or any Tax Code) renders in FULL regardless of mode, read-only where the user lacks the permission to change it. A capture policy may not make existing data invisible to the person responsible for it.
6. **API guard (fact-based):** when `vatStatus(expenseDate) == NOT_REGISTERED`, **confirmation** of a `CLAIMABLE` expense is refused with `400 input_vat_not_available_company_not_vat_registered`. `UNKNOWN` never rejects — absence of a fact is not a fact.

   Guarded at confirmation rather than on the draft write, because confirmation is the single point every route converges on — `finalizeAndConfirmExpenseCas` has exactly one caller, and web, LINE, AI and reimbursement all reach it — and only a `CLAIMABLE` + `CONFIRMED` expense is visible to tax sync. A write-time guard would leave a draft created directly with `CLAIMABLE` unchecked. `400` rather than `422` matches every sibling rule in the same validator; the stable code, not the status, is what the web translates.

   The registration read happens only when a claim is actually at stake, so the ordinary confirmation path issues no extra query.
7. SIMPLE mode has no tax-related affordance at all. The question that decides the mode is asked once at company registration (§8), not on a transaction form.

   **The per-document "ใบนี้เป็นใบกำกับภาษี" escape hatch was dropped during implementation.** It would have revealed VAT mode and rate so a non-registered company could split out VAT it cannot claim — but the expense's gross total is already the amount it actually paid, and that VAT is cost either way, so the split records nothing the ledger or the accountant uses. The case it was really protecting against is a *registered* company that has not answered yet, and the question answers that directly. Reinstate the hatch only if a non-registered company turns out to need the VAT split for its own reporting.
8. The Tax Code selector must not show the "ยังไม่มี Tax Code … ตั้งค่าภาษี" CTA to a caller who cannot act on it. The CTA renders only when the caller holds `tax.config.manage`.
9. Nothing in this spec changes what a confirmed expense posts to the ledger. `normalizeExpenseVatForLedger` already zeroes non-claimable VAT.

## 8. Asking the Question

**Asked once, at company registration, by the system admin** — the same form that already collects company name and business category, and the same transaction that already creates the VAT registration state row. A company-level fact that is answered once belongs where the company is created, not on a transaction form.

Three answers: จดทะเบียนแล้ว (with the ภ.พ.20 effective date), ยังไม่ได้จดทะเบียน (effective from the registration date — there is nothing earlier to claim on, and older documents stay `UNKNOWN` and behave exactly as they do today), and **ยังไม่ทราบ**, which writes no fact at all. "Unknown" is not "not registered" and is never recorded as one.

The first fact is written directly in the onboarding transaction rather than through the CAS command path. That is safe **only** here: the company does not exist yet for anyone else, so there is no concurrent answer to lose, and `planVatFactChange` on an empty history reduces to exactly that single insert. The state row starts at version 1 so a later answer's compare-and-set has the right expected version.

Not owned here: correcting the answer afterwards, the onboarding wizard for company identity, and the RD prefill. Those are Company Tax Identity Setup Release A4.

### 8.1 Why not inline in expense capture

v1.2 shipped the question inside manual capture and it was wrong twice over, both found by the owner reading the screen:

1. **It could never reach the people it was for.** It rendered only under `SIMPLE`, but `thai_tax` is on by default, so every new company reads `UNKNOWN` → `FULL` and never saw it. The question that unlocks `SIMPLE` appeared only to companies already in `SIMPLE` — a closed loop.
2. **It asked forever.** The condition tested the mode, not whether the question was answered, so a company that answered "ยังไม่ได้จดทะเบียน" was asked again on every visit.

Both are symptoms of the same mistake: a company-level, answer-once setting was placed on a per-document form, where the only state available to gate it was that document's state. Registration has neither problem — it happens once, before any expense exists, and the answer is part of the record being created.

## 9. Contract Impact

New read model, additive:

```
GET /v1/companies/:companyId/expenses/capture-policy?on=YYYY-MM-DD
RequireAnyPermission: expense.read | expense.read_own | expense.create | expense.review
200 {
  mode: 'FULL' | 'SIMPLE',
  vatStatus: 'REGISTERED' | 'NOT_REGISTERED' | 'UNKNOWN' | 'HIDDEN',
  canAnswerVatStatus: boolean,      // caller holds company.vat_registration.manage
  canConfigureTax: boolean          // caller holds tax.config.manage
}
```

`canConfigureTax` rides along rather than being threaded as a prop: the Tax Code selector renders in components that never received `permissions`, and every one of them already reads this policy.

`vatStatus` is masked to `HIDDEN` unless the caller holds `company.vat_registration.read`. `mode` alone is enough to render, so a clerk without the HIGH-risk read still gets a correct form and learns nothing about the company's tax status. This mirrors the masking already used in `company-identity.use-case.ts:106`.

`on` is not echoed back. The client always knows the date it asked for — a manual form has an `expenseDate`, a review screen has the stored one — so an echo would be dead weight. Omitting `on` falls back to today in the company's timezone, which the reused VAT read already resolves.

Any authority that puts a user on an expense screen may read the policy, hence `RequireAnyPermission` rather than a single key: a reviewer holds `expense.review` and not `expense.create`, and a clerk holds `expense.read_own` and neither. The answer is only whether the form asks VAT questions, and the fact itself stays masked.

Implementation reuses `CompanyVatRegistrationUseCase.get(companyId, asOf)` rather than re-loading facts, so the policy and the VAT read can never disagree about the interval accessor or the `asOf` validation.

No schema change. No new table. No new enum. No contract change to expense create/update DTOs.

## 10. Permission and Audit

- Reading the policy: any of `expense.read`, `expense.read_own`, `expense.create`, `expense.review` — the permissions the caller already needs to be on the screen.
- Reading `vatStatus` unmasked: `company.vat_registration.read`.
- Answering the question: `company.vat_registration.manage`, HIGH risk, audited by the existing command.
- The policy read is not audited. It derives from facts that are audited at write time.

## 11. UI Behavior by Surface

| Surface | File | FULL | SIMPLE |
| --- | --- | --- | --- |
| Manual capture — tax card | `ExpensesPages.tsx:1552-1564` | unchanged | card not rendered |
| Review edit — per-line Tax Code | `ExpensesPages.tsx:1107-1124` | unchanged | selector not rendered; the "เลือกได้เมื่อเอกสารเป็นใบกำกับภาษี" note also not rendered |
| Review edit — per-line VAT rate / printed VAT amount | `ExpensesPages.tsx:1058-1110` | unchanged | not rendered. Hiding the Tax Code but leaving the rate editor would still ask a VAT question, and would let a SIMPLE company record a rate the rest of the mode denies |
| Tax Code selector empty-state CTA | `TransactionTaxLineSelector.tsx:128-133` | CTA only with `tax.config.manage`; without it, "กรุณาติดต่อผู้ดูแลการตั้งค่าภาษีของบริษัท" | n/a — the selector itself is hidden |
| Review — VAT summary row | `ExpenseReviewPage.tsx:464` | unchanged | hidden when the expense has no VAT |
| List filter — สถานะหลักฐานภาษี | `ExpensesWorkspacePanels.tsx:576` | unchanged | filter hidden |
| List column — หลักฐานภาษี | `ExpensesWorkspacePanels.tsx:662,712` | unchanged | column hidden |
| Category "ภาษีซื้อเริ่มต้น" column and control | `ExpensesWorkspacePanels.tsx` | **removed for both modes** | **removed** — Q1 asked for it hidden under SIMPLE; the follow-up sweep showed nothing ever read it, so it is gone entirely rather than conditionally hidden (G7) |
| Reimbursements | `ReimbursementsPages.tsx` | no tax UI today | no change |

An expense matching rule §7.5 renders FULL rows even inside a SIMPLE workspace.

## 12. Impact Analysis

**Directly changed:** expense capture UI, one new read endpoint, one API claim guard.

**Adjacent, unchanged but verified:**

- *Ledger* — non-claimable VAT is already zeroed before posting (`journal.use-case.ts:70`), so SIMPLE mode changes no journal.
- *Tax sync* — `findConfirmedWithVatByCompany` only creates a `VAT_INPUT` event when `inputVatClaimStatus === 'CLAIMABLE'` and evidence is `USABLE_FOR_TAX` (`sync-tax-events.use-case.ts:217`). SIMPLE mode produces neither, so no tax events appear.
- *Entitlement* — hiding the ภาษี module is `thai_tax` configuration, already supported, no code.

### 12.1 Export and reporting impact

Traced because hiding the category column (Q1) raised the question of whether anything downstream consumes the same tax fields. Findings:

| Surface | Tax content | Impact of SIMPLE mode | Decision |
| --- | --- | --- | --- |
| Accountant index **CSV** (`buildAccountantIndexCsv`) | always the full `ACCOUNTANT_INDEX_COLUMNS` order | none — SIMPLE writes `0` into `vat_amount` etc., the columns stay | **Do not change.** It is documented as the machine-key contract "for system-to-system consumers" (`packages/contracts/src/expenses.ts:838`); dropping columns by capture mode would break a fixed-order parser |
| Accountant index **XLSX**, `summary` set (the UI default, `ExpensesPages.tsx:1180`) | includes `vat_amount` → "ภาษีมูลค่าเพิ่ม (VAT)" | a non-VAT company gets a column of zeros | **Do not change.** A zero VAT column is a true statement and is what an accounting office expects to see as evidence there is no input VAT |
| Accountant index **XLSX**, `full` set | adds `taxable_amount`, `wht_amount`, `tax_evidence_status`, `tax_evidence_reason`, `vendor_tax_id`, `vendor_branch_code`, `company_tax_id` | same — populated, just uninteresting | **Do not change** |
| Evidence panel export (`ExpensesWorkspacePanels.tsx:449`) | hardcodes `columnSet: 'full'` | none | **Do not change** |
| Evidence manifest (`buildManifestEntry`) | `tax_evidence_status` per attachment | none — the field is always populated | **Do not change** |
| Report `expense.accountant_evidence` | only dimension is `taxEvidenceStatus`; gated on `expense.export`, **not** on `thai_tax` | for a non-VAT company the dimension is effectively constant | Cosmetic only. Out of scope; noted as G8 |
| Report `tax.summary` | gated on `tax.report.read`, a `thai_tax` permission | already absent for a non-VAT company | No action needed |
| Ledger journals | VAT already zeroed for non-claimable (`journal.use-case.ts:70`) | none | No action needed |
| Tax events / PP30 | only built from `CLAIMABLE` + `USABLE_FOR_TAX` (`sync-tax-events.use-case.ts:217`) | none | No action needed |

**Conclusion: the export is not impacted, and must not be made to depend on capture mode.** The reason is the §5 separation: `captureMode` is a presentation policy. Letting a presentation policy decide the shape of a file that leaves the system would make an exported artifact's schema depend on a UI decision — the precise conflation this spec exists to prevent. A non-VAT company's export is already correct today: the tax columns are present and zero, which is exactly what is true.

**Gaps found during discovery, ranked. Only G1 and G4 are in scope for this spec.**

| # | Gap | Severity | Owner |
| --- | --- | --- | --- |
| G1 | The VAT question is never asked anywhere in the product. `vatRegistrationPrompt` has readers and no writers, so `sellerIdentityCompleteHO` can never be satisfied and every company is permanently `UNKNOWN`. **Combined with `thai_tax` defaulting on, this means no company can reach SIMPLE until it is asked** — G1 is a hard dependency for the persona, not background noise. | High | Company Tax Identity Setup A4 owns the onboarding wizard; this spec's §8 inline ask is what unblocks the expense journey on its own |
| G2 | Sales-document issuance does not consult `taxInvoiceEligible`. A non-VAT company can issue a document carrying OUTPUT_VAT — `journal.use-case.ts:110` posts `taxTotal` with no registration check, unlike the expense path. | High | Company Tax Identity Setup §7 (issuance gate). Out of scope here; flagged. |
| G3 | `GET tax/code-definitions` is gated on `company.branch.read` and carries no `thai_tax` entitlement, so a company without the tax module can still list Tax Codes. | Medium | Feature Entitlement. Out of scope; §7.8 removes the user-visible symptom only. |
| G4 | The Tax Code selector shows "ยังไม่มี Tax Code … ตั้งค่าภาษี" to users who cannot run the setup wizard, pushing non-VAT and unprivileged users toward a wizard they must not complete. | Medium | This spec, §7.8 |
| G5 | The upload path defaults every draft to `inputVatClaimStatus: 'NEEDS_REVIEW'` (`expense-upload.use-case.ts:63`) regardless of registration, so a non-VAT company accumulates drafts flagged for a review decision it cannot make. Confirmation is not blocked by it (`validateConfirm` does not test claimability), so the impact is queue noise, not a stuck flow. | Low | This spec, §13 E4 |
| G6 | A `NOT_REGISTERED` company can today be driven to `CLAIMABLE` through a Tax Code selection and, with `thai_tax` on, would produce a `VAT_INPUT` event and a PP30 claim it is not entitled to. No layer checks registration. | High if `thai_tax` on, otherwise latent | This spec, §7.6 |
| G7 | **RESOLVED 2026-08-05.** `ExpenseCategory.inputVatDefault` was dead configuration — written by the category UI, stored, displayed, and read by nothing. A follow-up sweep found the defect was wider: **no field on `ExpenseCategory` is inherited by an expense at all.** `taxCategory` and `accountHintKey` are equally unread there; the `accountHintKey`/`taxCategory` the ledger actually posts from (`journal.use-case.ts:158`) live on `ExpenseRecord`/`ExpenseLine`, same names, different columns. The control, the column mapping and the contract fields for `inputVatDefault` are removed; the Prisma column is kept (it has a DB default, and dropping it is a migration and an irreversible data decision). | Medium — silent no-op | Done |
| G8 | Report `expense.accountant_evidence` is gated on `expense.export` and not on `thai_tax`, and its only dimension is `taxEvidenceStatus`, so a non-VAT company can run a report whose grouping is constant. | Low, cosmetic | Reports/feature-entitlement. Out of scope |

**Bugs found during discovery:** G4 is a live UI defect independent of this feature. G7 is a live silent no-op — the category "ภาษีซื้อเริ่มต้น" setting does nothing today. G6 is a latent correctness defect. G2 is a correctness defect on the sales side and is the one worth escalating outside this work. No bug was found in the ledger, tax-sync, or export paths — all three already fail closed or are already correct.

## 13. Edge Cases

- **E1 Date moved across the VAT effective date.** Re-evaluate on every `expenseDate` change. Moving from FULL to SIMPLE hides fields but keeps values (§7.4); the form shows that stored VAT data exists on a date where it does not apply, and blocks save with `422` only if the claim is `CLAIMABLE` under a `NOT_REGISTERED` date.
- **E2 Policy fetch fails.** Fail to `FULL`. A missing policy must never hide a field a VAT-registered company needs. Show no error banner for this — a degraded read renders today's screen.
- **E3 Company registers for VAT after months of SIMPLE capture.** Old expenses are untouched and stay non-claimable; that is factually correct. No backfill, no re-open.
- **E4 Upload drafts under SIMPLE.** The draft is created with `inputVatClaimStatus: 'NON_CLAIMABLE'` instead of `'NEEDS_REVIEW'` when the policy for the extracted date is SIMPLE, so the review queue does not fill with unanswerable decisions. When extraction returns no date, the mode for today applies.
- **E5 Expense with a Tax Code, company later answers `NOT_REGISTERED` backdated.** The fact write itself already refuses to cross a filed tax period (`company-vat-registration.logic.ts:180`). Where it succeeds, existing expenses keep their data and render FULL per §7.5; no retroactive rewrite.
- **E6 Caller cannot read VAT status.** `vatStatus: 'HIDDEN'`, `mode` still correct, escape hatch shows "ต้องให้เจ้าของกิจการตอบสถานะจด VAT ก่อน".
- **E7 `thai_tax` disabled after use.** Mode falls back to the fact. A company with `REGISTERED` stays FULL; one still `UNKNOWN` goes SIMPLE and rule §7.5 keeps its existing tax rows visible.

## 14. Acceptance Criteria

1. AC1 — A company with `vatStatus = NOT_REGISTERED` and `thai_tax` off shows no Tax Code card, no VAT mode selector, and no "ตั้งค่าภาษี" CTA in manual capture or review edit.
2. AC2 — A company with `vatStatus = REGISTERED` shows byte-identical capture UI to the pre-change build.
3. AC3 — A company with `vatStatus = UNKNOWN` and `thai_tax` on shows byte-identical capture UI to the pre-change build.
4. AC4 — A company with `vatStatus = UNKNOWN` and `thai_tax` off shows SIMPLE capture, and a company with `vatStatus = NOT_REGISTERED` shows SIMPLE capture **whether or not** `thai_tax` is on.
5. AC5 — Policy is evaluated per `expenseDate`: for a company registered from 2026-07-01, an expense dated 2026-06-30 is SIMPLE and one dated 2026-07-01 is FULL, in the same session.
6. AC6 — Confirming a `CLAIMABLE` expense whose date falls under a `NOT_REGISTERED` fact fails with `input_vat_not_available_company_not_vat_registered`, and the web renders its Thai label rather than the raw code.
7. AC7 — The same confirmation under `UNKNOWN` or `REGISTERED` behaves exactly as today, and a `NON_CLAIMABLE` expense confirms normally under `NOT_REGISTERED`.
8. AC8 — An expense carrying `vatAmount ≠ 0` or a Tax Code renders its tax fields even when the workspace mode is SIMPLE.
9. AC9 — Switching a company from FULL to SIMPLE changes no stored expense row. Verified by comparing `vatMode`, `vatRate`, `vatAmount`, `taxCodeDefinitionId`, `taxSnapshot` before and after a load-and-save cycle.
10. AC10 — The empty-state "ตั้งค่าภาษี" CTA renders only for a caller with `tax.config.manage`.
11. AC11 — Under SIMPLE, an upload-created draft is `NON_CLAIMABLE`, and the review queue shows no claimability decision for it.
12. AC12 — Policy endpoint failure renders FULL.
13. AC13 — **The accountant export is byte-identical before and after this change**, for both `summary` and `full` column sets, in CSV and XLSX, under SIMPLE and FULL. This is the regression test for §12.1.
14. AC14 — Under SIMPLE the category list has no "ภาษีซื้อเริ่มต้น" column and the create modal has no such control; a category created this way stores `NON_CLAIMABLE`, and an existing category's stored `inputVatDefault` is unchanged by viewing or renaming it under SIMPLE.
15. AC15 — A company registered with "จดทะเบียนแล้ว" reads FULL from its first expense; one registered with "ยังไม่ได้จดทะเบียน" reads SIMPLE; one registered with "ยังไม่ทราบ" has no VAT fact and behaves exactly as a company created before this change.

## 15. Test Cases

- Unit, `expense-capture-policy.logic.spec.ts` — the derivation table of §5 across `{REGISTERED, NOT_REGISTERED, UNKNOWN} × {thai_tax on, off}`, plus date selection against a two-interval fact history.
- Unit, `expense-status.logic.spec.ts` — §7.6 guard: `NOT_REGISTERED` + `CLAIMABLE` rejects; `UNKNOWN` + `CLAIMABLE` passes; `REGISTERED` + `CLAIMABLE` passes.
- Unit, web `expenses.model.spec.ts` — §7.5 override: a line with `vatAmount ≠ 0` forces FULL rendering under SIMPLE.
- API, `expense-capture-policy.controller.spec.ts` — masking of `vatStatus` without `company.vat_registration.read`; `on` echo; default to today.
- E2E — AC1, AC2, AC5, AC6 through the browser path already used by the expense E2E suite.

## 16. Resolved Questions

All three answered by the owner on 2026-08-05. No open questions block implementation.

- **Q1 — hide the หมวดหมู่ "ภาษีซื้อเริ่มต้น" column, or only the editor control? → Hide both** (§11). Discovery for this answer produced §12.1 and gap G7: the field turned out to have no consumer at all, so hiding it is functionally inert. Export is unaffected and deliberately stays unaffected.
- **Q2 — offer the inline VAT question to `OWNER` only, or to anyone holding `company.vat_registration.manage`? → Anyone holding the permission.** The permission is already HIGH-risk and audited, and `pack.company.vat_registration.manage` exists precisely to delegate it (`capability-pack.registry.ts:76`). No role check is added on top.
- **Q3 — is G2 (sales issuance without a registration gate) tracked elsewhere? → Confirmed.** It stays with Company Tax Identity Setup §7; no separate task is opened, and this work must not touch it.

## 17. Open Questions

None.

## 18. Follow-up: document VAT arithmetic in SIMPLE capture

[[specs/expense-vat-source-reconciliation-spec|Expense VAT Source Capture and Reconciliation]]
supersedes only §7.3, §7.7, and the affected §11/AC1 hiding behavior when a document has
VAT evidence, stored VAT, a WHT base dependency, or the reviewer explicitly opens
ใบนี้ระบุ VAT.

SIMPLE still hides Tax Code, claimability, tax configuration, and tax-evidence workflow.
A new no-VAT draft stays simple. The conditional document VAT card records source arithmetic
as non-claimable cost and must not open a VAT claim path. This exception is required because
source VAT is now OCR audit evidence and can determine the WHT base.
