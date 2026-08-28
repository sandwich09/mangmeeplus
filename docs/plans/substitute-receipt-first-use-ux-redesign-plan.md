# Substitute Receipt — First-use UX Redesign

Status: IMPLEMENTED, SOURCE/PDF-VERIFIED, AND RUNNING IN LOCAL DOCKER — authenticated-browser visual verification remains pending because no browser session is connected.
Date: 2026-08-08
Owner request: redesign `/companies/[companyId]/expenses/substitute-receipts/new` so a first-time user understands the whole journey, required information is marked with a red `*`, and the experience feels modern and assisted without delegating factual declarations or signatures to AI.
Memory: [[agent-memory/substitute-receipt-first-use-ux-redesign|Substitute Receipt First-use UX Redesign Memory]]
Related: [[substitute-receipt-standalone-menu-plan]], [[substitute-receipt-evidence-hardening-plan]]

## 1. Approved problem

The existing first step put two different intents side by side with equal visual weight:

1. choose an expense already recorded without a receipt; or
2. record a new expense before preparing a certificate.

Both routes are valid because every substitute-receipt certificate must belong to an expense record. The selection of an existing expense therefore **does belong in this flow**, but it must not compete on screen with a second full form. A new user first needs to answer one plain-language question: **“รายการนี้ถูกบันทึกในระบบแล้วหรือยัง?”**

The prior six-step progress bar also exposed implementation detail too early, labels did not consistently distinguish required from optional data, and the screen gave no simple explanation of when this document should or should not be used.

## 2. Goals

- Make the correct first action obvious without accounting vocabulary.
- Keep existing-expense selection and new-expense creation as **alternate routes to the same certificate**, never two simultaneous tasks.
- Support multiple item lines inside one expense/certificate when they belong to the same payment context, while making the split-into-separate-certificates rule explicit.
- Explain that the new-expense route creates only a draft; it does not issue a certificate or post accounting entries.
- Show one consistent red `*` on every mandatory label and a required-field legend on each data-entry section.
- Reduce perceived complexity by grouping the six existing workflow states into four user-facing journey stages.
- Provide deterministic completeness feedback while keeping factual declarations, signatures, and approvals human-controlled.
- Preserve every backend lifecycle, permission, evidence, tax, checksum, and audit invariant.

## 3. Non-goals

- No combining multiple independent `ExpenseRecord` records into one certificate. The certificate remains bound to one `expenseId`.
- No per-line payee, payer, expense/payment date, payment method, reason, business purpose, or attachment model. If any of those shared facts differ, the user must create a separate expense/certificate.
- No database, evidence-status, or approval-policy change.
- No AI generation of payee identity, missing-receipt reason, business purpose, signature, or approval.
- No claim that an internal certificate is a tax invoice or that it guarantees deductibility.
- No automatic withholding-tax decision or rate calculation in this redesign.

## 4. First-use flow decision

### 4.1 Eligibility guide

Before asking for data, the page explains that this route is for a real business expense where the payee could not issue a receipt from the outset and other supporting evidence exists. It also shows the persistent tax notice:

> เอกสารนี้ไม่ใช่ใบกำกับภาษี จึงใช้ขอคืน VAT ไม่ได้ และไม่ยกเว้นหน้าที่ภาษีหัก ณ ที่จ่าย

If a receipt or tax invoice was issued and later lost, the user is told to request a copy or replacement from the issuer first.

### 4.2 One question, two mutually exclusive routes

| User answer | UI route | Result |
|---|---|---|
| **บันทึกรายการไว้แล้ว** | Search and choose an eligible expense that has no receipt and has not started a certificate | Existing expense becomes the selected record |
| **ยังไม่ได้บันทึกรายการ** | Enter the minimum draft fields | A manual expense draft is created and selected; no certificate or ledger posting occurs yet |

Rules:

- A deep link carrying `expenseId` resolves to the existing-expense route and keeps the supplied selection.
- When eligible candidates exist, the existing route is the recommended default; when there are none, the new-draft route is selected.
- Only the active route's content is rendered.
- The existing list supports search, count, bounded recent-candidate messaging, and a direct empty-state action to create a new draft.
- Candidate eligibility mirrors the backend blockers that cannot be corrected inside this wizard, and the reason defaults to `RECEIPT_UNAVAILABLE` when the selected source is a receipt/tax invoice.
- After an expense is selected, both route forms collapse into one confirmation summary with a clear “เปลี่ยนรายการ” action.

### 4.3 Explicit tax/classification acknowledgement

Before continuing, the user must acknowledge that the expense is being handled without a receipt and that input VAT cannot be claimed from this internal evidence. The existing update behaviour remains guarded:

- only unresolved `NEEDS_REVIEW` document/tax-evidence fields are advanced to the substitute path;
- already reviewed classifications are not overwritten;
- incompatible input-tax selections are cleared and the item becomes non-claimable where the existing rules require it.

### 4.4 Multiple items in one certificate

One substitute receipt remains one `ExpenseRecord` and one certificate version, but that expense may contain multiple `ExpenseLine` rows. The compact new-expense route therefore provides a repeatable item builder with add, remove, reorder, per-line validation, and a derived running total.

Items may be grouped only when all rows share the same company/branch/currency, payee, actual payer, expense date, payment date/payment event and method, missing-receipt reason, and business purpose. Description, quantity, amount, and accounting category may differ by line. If a shared fact differs, the UI instructs the user to create a separate expense and certificate.

The first-use builder accepts up to eight rows so an ad-hoc entry stays reviewable. This is a UX limit, not permission to merge unrelated payments. Existing expenses can contain more rows; the derived PDF printout paginates tall artifacts instead of shrinking every row onto one unreadable A4 page. Each continuation page carries the document identity and page position, while the immutable checksummed SVG remains the authoritative signed artifact.

## 5. Four user-facing stages over the existing six workflow states

The backend-facing wizard still uses the same six states. The redesign groups them only for navigation comprehension:

| User-facing stage | Existing wizard state(s) | User outcome |
|---|---|---|
| 1. **รายการค่าใช้จ่าย** | `expense` | choose an existing expense or create/select a draft; acknowledge tax limitations |
| 2. **ข้อมูลและหลักฐาน** | `details`, `evidence` | identify the payee and payment, explain the business reason, attach required evidence, prepare the document |
| 3. **ลงนามและอนุมัติ** | `certify`, `approve` | actual payer reviews and signs; authorized approver reviews and issues |
| 4. **รับเอกสาร** | `done` | download/open the issued document, return to the expense, or inspect version history |

This is presentation grouping only. The evidence lifecycle remains `PREPARED → PAYER_CERTIFIED → ISSUED`, with `SUPERSEDED` retained for cancelled/revised versions.

## 6. Exact required and optional information

All required labels carry a red `*`. Workflow actions use the same deterministic requirement set; the multi-item draft action stays clickable so it can identify, expand, and focus the first missing field instead of leaving the user to hunt through item cards.

### Stage 1 — expense

| Route/section | Required | Optional / conditional |
|---|---|---|
| Existing expense | one eligible expense selection | search text |
| New expense draft | shared expense date; at least one item; per item: description, expense category, positive quantity, positive unit price/amount | add/remove/reorder up to the first-use limit |
| Selection confirmation | tax/classification acknowledgement; `expense.review` capability | none |

### Stage 2A — payee, reason, and payment

| Required | Optional / recommended |
|---|---|
| payee name (prefilled from an existing vendor snapshot when available, but the visible field itself must remain populated); reason type; missing-receipt explanation; business purpose; eligible actual payer; payment method; payment date | payee address (recommended, maximum 300 characters); national ID/taxpayer ID (recommended; if entered, exactly 13 digits) |

Payee name is limited to 200 characters. Optional identity fields do not block when blank, but an invalid value that the user has entered does block progress until corrected or removed.

### Stage 2B — evidence and preparation

| Required | Optional / conditional |
|---|---|
| company approval policy is ready; at least one supporting-evidence attachment | separate payment evidence is required for every non-cash method and for cash when company policy is `REQUIRE_SEPARATE_PAYMENT_EVIDENCE`; otherwise it is optional but recommended |

For cash, the existing printable `ใบสำคัญรับเงิน` remains available so the payee can sign it and the user can attach a photo or scan.

### Stage 3A — actual payer certification

Required:

1. actual payer position;
2. open and review the full prepared document, producing the existing preview checksum;
3. a processed signature, drawn on screen or uploaded and background-cleaned;
4. explicit payer certification acknowledgement.

Only the recorded actual payer can perform this action.

### Stage 3B — approval and issuance

Required:

1. open and review the payer-signed artifact;
2. approver position;
3. a processed approver signature;
4. explicit approval acknowledgement.

Approval still requires `expense.confirm` and the existing company policy. Self-approval is allowed only for an OWNER under `OWNER_SELF`; `DESIGNATED_APPROVERS` preserves separation of duties.

### Stage 4 — completed document and revisions

There are no new mandatory fields for an issued document. Cancelling or revising a current version still requires a supersede reason.

Version history and the existing permission/source-state-checked cancellation controls remain available while a version is `PREPARED` or `PAYER_CERTIFIED`, not only after issuance. A cancelled version shows its cancellation state and retained reason without directing the user to confirm the expense as if the certificate were issued. This does not relax reviewer permission or confirmed-source restrictions.

## 7. Deterministic readiness assistant

The “ผู้ช่วยตรวจความพร้อม” is a local, deterministic checklist—not an LLM decision-maker.

- `evaluateDetailsReadiness` checks identity validation, reason, business purpose, eligible payer, and payment date.
- `evaluateEvidenceReadiness` checks runtime policy plus supporting/payment attachment counts.
- `evaluateSigningReadiness` is shared by payer and approver and checks position, preview, processed signature, and acknowledgement.
- `isSubstituteReceiptCandidateEligible` filters out incompatible tax/source/classification states before selection; `defaultSubstituteReceiptReason` resets the reason appropriately whenever the selected expense changes.
- Stage 1 separately checks expense selection, explicit tax acknowledgement, and permission.

It may show completion percentage and missing items, but it must never:

- invent or rewrite a factual declaration;
- infer tax treatment beyond existing deterministic rules;
- sign, certify, or approve;
- mutate backend state merely because a checklist becomes complete.

The Thai copy states this boundary directly: `ระบบตรวจจากข้อมูลที่คุณกรอก โดยจะไม่ลงนามหรืออนุมัติแทนคุณ`.

## 8. Visual system

- Compact brand-tinted first-use guide with its badge and title inline, a semantic three-column eligibility checklist on desktop, and always-visible tax and lost-receipt guidance.
- Compact selectable route rows place the icon beside the title/help text and keep the recommended badge in normal flow, while preserving the full-card target and selected state.
- One-column progressive disclosure instead of competing side-by-side forms.
- Numbered content groups for payee, reason, and payment facts.
- Searchable candidate cards with expense number, date, description/vendor, and amount.
- Candidate and confirmation summaries expose the line count and every item; confirmation shows category plus `quantity × unit price = line total` before the tax acknowledgement.
- The new-expense route uses responsive item cards, keyboard-operable reorder controls, focus restoration after add/remove/move, an announced running total, and focused per-item validation.
- Selected-expense summary reused on later stages to preserve context.
- Selecting a route scrolls/focuses its list or mini-form; selecting an expense hides the large guide and scrolls/focuses the compact confirmation instead of leaving the user at the old list position.
- Confirming the selected expense scrolls/focuses the details heading without focusing an input or opening the mobile keyboard. Reduced-motion preferences are respected.
- Candidate lists use document scrolling on narrow screens and a bounded internal list only from the `sm` breakpoint upward.
- Responsive two-column layout on wide screens: primary task plus a sticky readiness card; one column on small screens.
- Required/optional badges on evidence panels, reviewed/ready status chips, and modern empty/error/loading states.
- Empty category and payer lists explain the missing setup/permission state instead of leaving a permanently disabled action with no guidance.
- Signature and approval tasks are shown as a numbered sequence: position → document review → signature → acknowledgement.

## 9. Tax and accounting basis

The design separates three questions that users commonly conflate:

1. **Can the business identify the real payee and prove the expense?** Revenue Department guidance for Revenue Code section 65 ter (18) explains that an unidentifiable payee can make an expense non-deductible and gives an evidence example containing the payee's name, address, national ID, date, amount, item, and payee signature: https://www.rd.go.th/827.html. This is why name is required and address/ID are visibly recommended rather than hidden.
2. **Does this create input-VAT entitlement?** Revenue Code section 82/5 states that input VAT generally cannot be credited where there is no tax invoice or it cannot be produced: https://www.rd.go.th/5206.html. The internal certificate therefore remains `SUPPORTING_ONLY` and `NON_CLAIMABLE` by itself.
3. **Does the document remove withholding-tax duties?** It does not. Withholding depends on the payee and payment type under the Revenue Department's withholding rules, including Order ท.ป.4/2528: https://www.rd.go.th/3479.html. The UI provides a warning, not an automatic legal conclusion or rate.
4. **May one certificate contain more than one item row?** The Revenue Department audit guide's sample substitute certificate uses an itemized table with multiple date/detail/amount rows: https://www.rd.go.th/fileadmin/download/15277290359.pdf. The product infers from that form structure that several line items can sit in one certificate when they describe one coherent payment context; it does not infer permission to merge unrelated payees or payment events.

This product guidance supports evidence collection; it is not a guarantee of tax deductibility for every fact pattern.

## 10. Backend invariants preserved and print hardening

- Same eligibility validation, THB-only scope, branch/permission checks, runtime policy, and maximum-amount controls.
- Same endpoints and request/response contracts.
- Same immutable expense snapshot, canonical hash, artifact checksum, preview-before-sign lock, compare-and-set version checks, and idempotency handling.
- Same actual-payer binding and approval-policy enforcement.
- Same supporting/payment evidence policy.
- Same `SUPPORTING_ONLY` + `NON_CLAIMABLE` tax boundary and no input-VAT event from this internal evidence alone.
- Same requirement that confirmation relies on a current `ISSUED` artifact, not only a text reason.
- Same supersede/version history and retained audit trail.
- Same singular `expenseId` relationship: multiple rows are `ExpenseLine` children of one expense, never a multi-expense certificate.
- The signed/checksummed SVG remains authoritative. PDF remains a derived printout and now uses bounded multi-page rendering with document/page identity instead of silently scaling an arbitrarily tall artifact onto one page.

No endpoint, request/response contract, Prisma schema, or migration is changed. The expense-draft API helper now uses the canonical `CreateExpenseDraftInput` type, and the API validates decimal precision/range before persisting derived totals.

## 11. Implementation artifacts

- `apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx` — progressive first-use UI, four-stage journey, required markers, sectioned forms, readiness panels, evidence/signing sequences, and refreshed completion state.
- `apps/web/src/features/expenses/substitute-receipt-wizard.model.ts` — entry-mode resolver, journey-stage mapping, and pure readiness evaluators.
- `apps/web/src/features/expenses/substitute-receipt-wizard.model.spec.ts` — route, stage, identity, evidence-policy, signing, and approval regressions.
- `apps/web/src/common/i18n/workspace-dictionary.ts` — matched Thai/English UX copy.
- `apps/web/src/common/components/field/ThemedDate.tsx` and `.spec.ts` — exposes required date state to assistive technology and verifies the visible picker contract.
- `apps/web/src/common/components/field/ThemedFile.tsx` and `.spec.ts` — exposes an accessible required state for controlled uploads without creating an impossible native validation state.
- `apps/web/src/features/expenses/expenses.api.ts` — uses the canonical multi-line draft contract including per-line category.
- `apps/api/src/modules/expenses/domain/logic/substitute-receipt-pdf.logic.ts` and `.spec.ts` — bounded, identified multi-page PDF derivation for tall immutable SVG artifacts.
- `docs/plans/substitute-receipt-first-use-ux-redesign-plan.md`
- `docs/agent-memory/substitute-receipt-first-use-ux-redesign.md`

## 12. Verification status

| Gate | Status |
|---|---|
| Source diff whitespace check | PASS (`git diff --check` on the scoped source/docs files, 2026-08-08) |
| Focused wizard/model/accessibility tests | PASS as part of the full web suite |
| Web typecheck | PASS |
| Web test suite | PASS, 957 tests |
| Focused API amount/substitute-receipt/PDF suites | PASS, 94 tests |
| Multi-item PDF layout QA | PASS — an eight-item Thai certificate rendered as two readable A4 pages; item rows/signature blocks were not split and every page carried document ID, source hash, and `Page X/Y` |
| Latest-code Docker rebuild | PASS — `docker-api:latest` `sha256:09a7b54f86e7…`; `docker-web:latest` `sha256:93c773b0f01f…`; only `api` and `web` recreated, data services/volumes preserved |
| Container/HTTP health | PASS — Compose reports API healthy; internal Docker-network checks return API 200, AI gateway 200, and web 307 to `/login`; API startup reports 121 migrations/no pending migration plus `Seed complete` |
| Authenticated browser walk at `/companies/seed-local-company/expenses/substitute-receipts/new` | Not run; browser visual-QA tooling unavailable in this environment |
| Browser checks for first-use, existing route, new-draft route, required stars, responsive layout, and signing readiness | Pending an environment with authenticated browser control |

The latest implementation is running and source/build/PDF verified. Visual browser acceptance remains open until an authenticated browser session is available to walk the rendered interactive states.

## 13. Acceptance criteria

1. A first-time user can explain when to use this document from the page header alone.
2. The first action is answering whether the expense already exists; only the chosen route appears.
3. The new route explicitly says it creates a draft and neither issues nor posts anything.
4. Every mandatory visible field has a red `*`; optional identity fields are labelled optional/recommended.
5. The progress UI shows four stages while all six workflow states and backend statuses continue to work.
6. No incomplete draft can be submitted: the draft action reports and focuses the first missing field, while later workflow actions remain blocked until deterministic readiness is complete.
7. The assistant never generates facts, signs, or approves.
8. VAT and WHT limitations remain visible before the user commits to the flow.
9. Existing backend lifecycle, tax, evidence, permission, checksum, audit, and version invariants remain unchanged.
10. Docker rebuild and authenticated browser verification pass on the latest code.
