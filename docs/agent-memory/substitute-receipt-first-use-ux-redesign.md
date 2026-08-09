# Agent Memory: substitute-receipt first-use UX redesign

Status 2026-08-08: first-use and multi-item implementation is source/PDF-verified and running in local Docker. Web typecheck, 957 web tests, and 94 focused API tests pass. Browser visual QA remains unavailable because no browser session is connected.

Owner request: redesign `/companies/seed-local-company/expenses/substitute-receipts/new` so an ordinary first-time user immediately understands what to do, all mandatory inputs have red `*`, and the complete prepare → sign → approve → issue flow feels modern and AI-assisted without unsafe automation.

Plan: [[plans/substitute-receipt-first-use-ux-redesign-plan|Substitute Receipt First-use UX Redesign Plan]]

## Settled decisions

1. **The “เลือกรายการที่ยังไม่มีใบเสร็จรับเงิน” selector belongs in this flow.** Every certificate is attached to an expense record. The UX problem was simultaneous presentation, not the route itself.
2. **Existing selection and new draft are alternate routes.** The page asks `รายการนี้ถูกบันทึกในระบบแล้วหรือยัง?` and renders only the chosen route. It no longer presents an empty candidate panel and a full new-expense form as parallel work.
3. **“บันทึกรายการค่าใช้จ่ายใหม่” means draft creation only.** The UI explicitly says it does not yet issue a certificate or post accounting entries. It can create multiple line items under one expense, with a shared date and required description/category/quantity/unit price per line.
4. **Six workflow states are grouped into four journey stages:** `expense` → รายการค่าใช้จ่าย; `details + evidence` → ข้อมูลและหลักฐาน; `certify + approve` → ลงนามและอนุมัติ; `done` → รับเอกสาร. This grouping does not change evidence statuses.
5. **Required data is explicit.** Visible mandatory labels use the shared red `*`; every entry section includes a required legend. Evidence cards also say จำเป็น/ไม่บังคับ.
6. **The readiness assistant is deterministic.** It reports missing local requirements and progress only. It does not create declarations, infer a legal answer, sign, certify, approve, or mutate server state.
7. **One certificate remains bound to one expense.** Multiple rows are `ExpenseLine` children of the same `ExpenseRecord`; the wizard does not merge independent expenses or payment events.
8. **The PDF is derived, not authoritative.** The immutable checksummed SVG remains the signed artifact. Tall printouts use bounded multi-page derivation with page/document identity rather than unreadable one-page scaling.

## Implemented experience

- First-use brand guide explains the correct use case, the three preparation facts, and the VAT/WHT boundary.
- A two-card intent choice replaces the former two-column competing forms.
- The guide and intent choice use compact-density layouts: checklist items form one desktop row, route icons sit beside their text, and decision-critical tax/lost-receipt copy remains visible and readable.
- Existing-expense route has count, search, eligible candidate cards, bounded-scan explanation, and a useful empty state.
- Candidate filtering mirrors backend tax/source/classification blockers that cannot be fixed in the wizard; changing the selected expense also resets the default no-receipt reason instead of leaking the prior selection's value.
- New-expense route has a draft-only explanation, red required marks, category-load retry, and a repeatable item builder. Users can add, remove, and reorder up to eight quick-entry rows; each row validates description, category, quantity, unit price, and rounded positive amount before one clear `สร้างฉบับร่างและใช้รายการนี้` action.
- The page explicitly allows one certificate only when payee, actual payer, expense date, payment date/event/method, no-receipt reason, and business purpose are shared. If any shared fact differs, it tells the user to split the expense/certificate.
- Candidate cards search every line description and show line count/preview. The selected confirmation always shows every row, category, `quantity × unit price`, line total, and the server-authoritative grand total.
- Item add/remove/reorder restores focus, identifies the affected item to assistive technology, and announces the change. Invalid submission focuses the precise missing date/item and links field errors programmatically.
- The chosen expense collapses into a persistent summary with a clear change action and mandatory tax acknowledgement.
- Follow-up selection UX: route selection focuses the relevant list/form; expense selection hides the large guide and moves focus/scroll to the compact confirmation; confirming moves to the details heading. The page never focuses the first input automatically, so mobile keyboards do not open unexpectedly.
- Required markers now use the actual `error-700` design token (the previous `error-600` class did not exist). The route question, expense selector, every mandatory field, conditional evidence, signatures, and acknowledgements carry a visible red `*`.
- Route cards support radio-group arrow keys and roving tab focus; candidate lists avoid nested scrolling on narrow screens and respect reduced-motion preferences.
- The compact confirmation repeats the receipt-loss, VAT, and withholding boundaries so deep-linked users receive the same compliance context.
- Details are grouped as: ผู้รับเงินคือใคร → ทำไมจึงไม่มีใบเสร็จ → ใครจ่าย และจ่ายอย่างไร.
- Evidence cards distinguish required from optional files according to payment method and runtime cash policy.
- Payer certification and approver issuance each use an explicit numbered sequence with document preview, signature, and acknowledgement.
- Completion screen prioritizes document number, PDF download/open, return-to-expense action, and three plain-language next steps; version/revision controls remain secondary.
- Thai and English copy remain paired in the workspace dictionary.

## Exact field contract in the redesigned UI

### Mandatory

- Existing route: eligible expense selection.
- New route: shared expense date; at least one item; each item requires description, expense category, positive quantity, positive unit price, and a positive rounded line total.
- Before details: explicit acknowledgement of no-receipt classification and input-VAT limitation; review permission.
- Details: payee name (prefilled from an existing vendor snapshot when available, but still explicitly required), reason type, missing-receipt explanation, business purpose, eligible actual payer, payment method, payment date.
- Evidence: ready approval policy and at least one supporting attachment.
- Payment evidence: mandatory for non-cash; for cash, mandatory only when company runtime policy requires separate payment evidence.
- Payer certification: payer position, checksum-bound full-document preview, processed signature, certification acknowledgement.
- Approval: payer-signed artifact preview, approver position, processed signature, approval acknowledgement, and existing approval permission/policy.
- Revision/cancellation: supersede reason.

### Optional or conditional

- Payee address: optional/recommended; if supplied, maximum 300 characters.
- National ID/taxpayer ID: optional/recommended; if supplied, exactly 13 digits.
- Payment evidence for cash when policy permits it to be optional.
- Candidate search text and new uploads beyond the required minimum.

Optional identity values are not counted as missing when blank. Once entered, an invalid value blocks progress so bad evidence is not silently accepted.

## Readiness model

Pure helpers live in `substitute-receipt-wizard.model.ts`:

- `resolveWizardEntryMode` preserves a deep-linked expense, prefers existing candidates, and selects new-draft mode when no candidate exists.
- `wizardJourneyStage` pins the six-to-four presentation mapping.
- `evaluateDetailsReadiness` includes invalid provided optional identity values as issues.
- `evaluateEvidenceReadiness` is driven by policy readiness and attachment counts.
- `evaluateSigningReadiness` is reused for both payer and approver.
- `isSubstituteReceiptCandidateEligible` rejects incompatible candidates before selection, while `defaultSubstituteReceiptReason` selects the correct starting reason per source.

The page uses those results for checklist rows, completion percentage, and action disabled states. The API remains the final authority.

## Tax/accounting rationale retained

- Revenue Department section 65 ter guidance says an expense can be disallowed where the payer cannot prove who received it, and its example evidence includes name, address, national ID, date, amount, item, and recipient signature: https://www.rd.go.th/827.html. The UI therefore requires the payee name and visibly recommends address/ID.
- Revenue Code section 82/5 prevents input-VAT credit where there is no tax invoice or it cannot be shown, subject to the statutory exceptions: https://www.rd.go.th/5206.html. This internal certificate remains `SUPPORTING_ONLY` and `NON_CLAIMABLE` by itself.
- Withholding duties are transaction/payee-specific and continue under rules including Revenue Department Order ท.ป.4/2528: https://www.rd.go.th/3479.html. The UI warns that this document does not remove those duties; it does not calculate a legal outcome.
- The Revenue Department audit guide's sample certificate has a multi-row date/detail/amount table: https://www.rd.go.th/fileadmin/download/15277290359.pdf. We use that as support for multiple line items inside one coherent expense/payment context, not as support for combining unrelated expense records.

This is evidence-collection guidance, not a guarantee that every item will be deductible.

## Backend invariants deliberately untouched

- eligibility, THB-only scope, amount limits, branch ABAC, permissions, and runtime policy;
- `PREPARED → PAYER_CERTIFIED → ISSUED`, plus retained `SUPERSEDED` versions;
- immutable snapshot/hash, artifact checksum, preview lock, idempotency, compare-and-set version checks;
- actual-payer signature binding and `OWNER_SELF`/`DESIGNATED_APPROVERS` enforcement;
- supporting/payment evidence rules;
- `SUPPORTING_ONLY`, `NON_CLAIMABLE`, and no VAT-input entitlement from the internal artifact;
- current `ISSUED` artifact required before confirmation;
- audit, retention, download, and supersede history.

The multi-item pass also hardens two implementation boundaries without changing those lifecycle rules:

- expense-draft numeric inputs and aggregate totals are validated against the persisted decimal precision/range at the API boundary;
- PDF generation is a bounded, identified, paginated derivation of the authoritative SVG, so long item/evidence content is not silently reduced to illegible type.

No endpoint, wire contract, Prisma schema, or migration was changed for this UX pass.

## Artifacts

- `apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx`
- `apps/web/src/features/expenses/substitute-receipt-wizard.model.ts`
- `apps/web/src/features/expenses/substitute-receipt-wizard.model.spec.ts`
- `apps/web/src/common/i18n/workspace-dictionary.ts`
- `apps/web/src/common/components/field/ThemedDate.tsx`
- `apps/web/src/common/components/field/ThemedDate.spec.ts`
- `apps/web/src/common/components/field/ThemedFile.tsx`
- `apps/web/src/common/components/field/ThemedFile.spec.ts`
- `apps/web/src/features/expenses/expenses.api.ts`
- `apps/api/src/modules/expenses/domain/logic/substitute-receipt-pdf.logic.ts`
- `apps/api/src/modules/expenses/domain/logic/substitute-receipt-pdf.logic.spec.ts`
- `docs/plans/substitute-receipt-first-use-ux-redesign-plan.md`
- `docs/agent-memory/substitute-receipt-first-use-ux-redesign.md`

## Verification record

| Gate | Result |
|---|---|
| `git diff --check` scoped to the changed source/docs files | PASS, 2026-08-08 |
| Added model coverage | PASS as part of the full web suite: route selection, six-to-four grouping, identity normalization/validation, detail/evidence/signing readiness, step resolution, and approval policy |
| Web typecheck | PASS |
| Web test suite | PASS, 957 tests |
| Focused API amount/substitute-receipt/PDF suites | PASS, 94 tests |
| PDF layout QA | PASS — eight Thai item rows produced two readable A4 pages without split rows/signatures; every page has document ID, source hash, and `Page X/Y` |
| Docker rebuild from latest source | PASS — API `sha256:09a7b54f86e7…`, web `sha256:93c773b0f01f…`; only API/web were recreated and mock-data volumes were preserved |
| Runtime health | PASS — API 200, AI gateway 200, web 307 to `/login`; Compose API healthy; 121 migrations/no pending migration; local seed completed |
| Authenticated desktop/mobile browser walk | Not run; browser visual-QA tooling unavailable in this environment |

Rendered-state visual acceptance remains pending until an environment with authenticated browser control is available.

## Renderability-bound addendum (2026-08-08)

- The manual-form limit is now the certificate limit: one substitute receipt accepts at most eight expense lines, with each rendered description at most 200 characters.
- Prepare also accepts at most eight unique linked evidence files, with each rendered original filename at most 255 characters. These four values are exported once from `packages/contracts` and consumed by both API and web.
- Existing otherwise-eligible expenses that exceed a line bound remain visible in the candidate list with an actionable warning. Selection is allowed for inspection, but the confirmation readiness row and continue action are blocked; the user can return to the expense to shorten or split it. Copy no longer suggests that the main expense screen can bypass the eight-line certificate limit.
- Evidence selection, new evidence upload, and prepare all fail early with specific guidance when the combined evidence/name bound is exceeded. Stable API codes are mapped to the same friendly Thai instructions.
- API prepare validates the line and evidence bounds before persistence. Preview/certify revalidate current expense/evidence data, and issue validates the immutable certified snapshot so a legacy over-limit version cannot create a later artifact failure. Status transitions, accounting treatment, checksums, and idempotency are unchanged.
- The worst allowed layout was rendered with 8×200-character Thai descriptions, 8×255-character evidence names, 500-character reason/purpose/note, and maximum payee/payer fields. It completed within the existing four-page/32-million-pixel ceiling.

Focused verification: contracts typecheck PASS; web typecheck PASS; wizard/error tests 29/29 PASS; prepare/issue tests 12/12 PASS; PDF renderer tests 7/7 PASS; `git diff --check` PASS. Full API typecheck remains unavailable in the host checkout because the generated Prisma client is absent; the focused TypeScript test runner compiled and exercised the changed API path.

## Browser checklist still required

1. Open the exact seed-company URL and verify the eligibility guide, tax notice, four-stage journey, and no simultaneous forms.
2. Existing route: search, empty/list states, select, change selection, and consent gate.
3. New route: every mandatory label has a red `*`; disabled action and missing count update; draft creation returns to a selected summary.
4. Details: section order, required markers, optional/recommended labels, 13-digit validation, readiness updates, and disabled next action.
5. Evidence: policy-driven required/optional state and cash voucher affordance.
6. Payer and approver: preview/signature/acknowledgement gates, including OWNER_SELF combined presentation.
7. Completed state: download/open/back-to-expense and secondary version history.
8. Check desktop screenshot proportions and at least one narrow viewport for wrapping, sticky-card fallback, and tap targets.
