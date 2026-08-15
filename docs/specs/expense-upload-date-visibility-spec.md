# Expense Upload-Date Visibility and Late-Document Tag Spec

## 1. Status

v0.2, 2026-08-15. **Proposed — not implemented.**

This specification records the product decision made on 2026-08-15: keep the existing Expenses list design, group its operational list by the date the record entered the system, show both document and intake dates, and show `เอกสารย้อนหลัง X วัน` only when those two dates fall in different calendar months.

Linked plan: [[plans/expense-upload-date-visibility-plan|Expense Upload-Date Visibility Plan]]

Related sources of truth:

- [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]] — owns `ExpenseRecord`, `expenseDate`, `uploadedAt`, receipt intake and accountant evidence.
- [[specs/date-time-correctness-spec|Date-Time Correctness Spec]] — owns civil-date versus instant semantics and the Asia/Bangkok boundary.
- [[specs/reimbursement-cc2-projection-spec|Reimbursement CC2 Projection Spec]] — owns expenses materialized from reimbursement lines.
- [[specs/expense-ledger-auto-post-spec|Expense Ledger Auto-Post Spec]] — owns accounting posting; this spec must not change it.
- [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]] — owns VAT/WHT periods; this spec must not change them.

## 2. Reported Bug

An expense whose receipt/document date is in June but which is uploaded in August disappears from the default August Expenses list immediately after OCR or review confirms the June document date. The user must change the list month to June to find the record they just uploaded.

Example:

| Field | Value |
| --- | --- |
| `expenseDate` | `2026-06-20` |
| `uploadedAt` | `2026-08-10T03:00:00.000Z` = 10 August in Asia/Bangkok |
| Current selected month | August 2026 |
| Current result | Row is absent because the list filters `expenseDate` |
| Required result | Row remains in August because the operational list filters `uploadedAt`; row also says document 20 June / sent into system 10 August and shows `เอกสารย้อนหลัง 51 วัน` |

This is a visibility and date-semantics defect. The record is not deleted and its accounting/tax date must not be rewritten.

## 3. Users and Product Goal

Primary users:

- employee/admin uploading a receipt and expecting to find the item they just created;
- finance/accounting reviewing newly arrived documents;
- manager/owner following current intake and pending work;
- accountant using document dates and accounting/tax reports independently of the operational list.

Goal:

1. A record remains visible in the current operational period after its real document date is extracted or corrected to an older month.
2. The original document date remains authoritative for accounting/tax review.
3. A concise tag makes cross-month late entry visible without redesigning the page.
4. The list, KPI cards, sorting, export copy and downstream accounting/tax semantics do not contradict one another.

## 4. Verified Current Facts (2026-08-15)

| Fact | Code/document evidence | Consequence |
| --- | --- | --- |
| `ExpenseRecord.uploadedAt` already exists, is non-null, defaults to record creation time and is indexed by company | `apps/api/prisma/schema.prisma:2173,2224` | No schema field or migration is needed |
| Legacy rows were backfilled with `uploadedAt = createdAt` | `apps/api/prisma/migrations/20260703000000_item09_document_intake_signature/migration.sql:24-27` | Historical rows have a stable intake approximation; no data backfill is required |
| `ExpenseSummary` already returns `uploadedAt` | `packages/contracts/src/expenses.ts:328-358`, `apps/web/src/features/expenses/expenses.model.ts:225-254` | No response-contract widening is needed |
| The list API already accepts `uploadedFromDate` / `uploadedToDate` | `packages/contracts/src/expenses.ts:466-482`, `expense.controller.ts:148-169`, `expenses.api.ts:93-101` | Main-page filtering can switch without a new endpoint |
| Repository filtering already maps those fields to `uploadedAt` with a half-open civil-day range | `prisma-expense.repository.ts:620-635` | Existing timezone-safe range behavior can be reused |
| The main Expenses list sends `fromDate` / `toDate`, which the repository maps to `expenseDate` | `ExpensesPages.tsx:1316-1325`, `prisma-expense.repository.ts:630` | This is the direct cause of the reported disappearance |
| The main list still orders by `expenseDate desc` | `prisma-expense.repository.ts:632` | Merely changing the filter is insufficient; a newly uploaded old document can still be buried or excluded by the 200-row cap |
| The list KPI cards and status counts are calculated from the period-scoped rows | `ExpensesPages.tsx:1335-1346`, `expenses.model.ts:927-954` | Switching the period changes KPI meaning from document cohort to intake cohort |
| Main-list export explicitly uses `dateField: 'expenseDate'` | `ExpensesPages.tsx:1386` | Export must be kept as an accounting/document-date action and labelled clearly; it must not silently inherit list semantics |
| Accountant Evidence already defaults to `uploadedAt` and lets users switch to `expenseDate` | `ExpensesWorkspacePanels.tsx:488,510-517,639-640` | The desired date separation already has a working precedent; no Evidence behavior change is needed |
| Evidence rows already show both `expenseDate` and `uploadedAt` | `ExpensesWorkspacePanels.tsx:798-799` | Main list can reuse the same content pattern |
| `uploadedAt` is an intake timestamp, not necessarily attachment completion | `expense-receipt-upload-spec.md:192,526`; `expenseRecord.create` relies on the DB default before upload completion | UI/business wording must mean “วันที่ส่งเข้าระบบ”; no claim of exact storage-completion time |
| Adding supporting/payment evidence later does not update `ExpenseRecord.uploadedAt` | `CompleteReceiptUploadUseCase` links attachments and updates status/primary id only | Later attachments do not move the expense into another month |
| Reimbursement expense projections use `captureSource: API_INTERNAL`, retain line `incurredDate` as `expenseDate`, and get `uploadedAt` from creation time | `materialize-claim-expenses.service.ts`, `prisma-reimbursement.repository.ts:1070-1145` | The same tag can identify a claim entered in a later month, but copy must not imply that every row has a file upload |

### 4.1 Cross-channel creation and impact audit

Every named entry channel was traced to the point where it does, or does not, create an `ExpenseRecord`:

| Source surface / path | When the Expense row and `uploadedAt` are created | `expenseDate` source | Impact from this spec | Source surface behavior that stays unchanged |
| --- | --- | --- | --- | --- |
| Web **อัปโหลดใบเสร็จ** | At `initReceiptUpload`, before storage completion and OCR | User seed, then OCR/reviewer correction | Direct: row is grouped by this intake month and remains there after OCR changes the document month | Upload form, storage completion, OCR, duplicate and review flow |
| **บันทึกด้วยมือ** | When the user saves the expense draft; an optional receipt is attached afterwards | User-entered date | Direct: row is grouped by draft-creation month; failed/later attachment does not move it | Manual form, VAT capture and stranded-draft recovery |
| **ใบรับรองแทน** for an existing Expense | No new Expense row; it retains the original row's `uploadedAt` | Existing Expense date | Direct only through the existing Expense row; issuing/signing the certificate must not refresh intake or lateness | Certificate hub month remains payment date, falling back to expense date; evidence status/order remains its own workflow |
| **ใบรับรองแทน** created from new manual lines | Wizard first creates a `WEB_MANUAL` Expense, then prepares evidence | Wizard manual date | Direct: grouped by the new Expense creation month | Certificate preparation, payer signature, approval and artifact dates do not become Expense intake |
| **ใบเบิก** draft/receipt upload/submit | Does **not** create an Expense row | Claim line `incurredDate` | No direct main-list row yet | Reimbursement Mine/Approval/Finance queues retain claim creation, submission, decision and payment semantics |
| **ใบเบิก** approved projection | One `API_INTERNAL` Expense per claim line is created during manager approval when finance review is disabled, otherwise during finance approval | Claim line `incurredDate` | Direct: the projected row is grouped by projection-creation month and may show the late tag | The original claim, attachments, approval timestamps and payout workflow are not re-dated |
| LINE direct image/file | At expense upload intent; attachment completion and OCR follow | Current Bangkok day seed, then OCR/reviewer correction | Direct: grouped by LINE Expense creation month and remains there after OCR correction | LINE idempotency, provenance, OCR and web-review deep link |
| LINE text-only expense note | At semantic-capture draft creation, despite no file | Extracted date or current Bangkok day | Direct: grouped by draft creation month; generic intake wording is required | Missing-receipt review and LINE correction flow |
| LINE media requiring clarification | Attachment and pending-media row are stored first; Expense is created only after user confirmation within 30 minutes | Current creation time until reviewed | Direct, with boundary caveat: current `uploadedAt` is clarification/resolution time, not original media arrival | Pending-media expiry/idempotency and attachment reuse |

The cross-channel audit therefore changes the product term from a literal “file upload timestamp” to an **Expense intake timestamp**. On the main Expenses list its precise meaning is “when this row entered the Expenses register.”

Trace evidence:

- web upload: `ExpensesPages.tsx:247-267` → `expense-upload.use-case.ts:49-90` → `prisma-expense.repository.ts:366-371`;
- web manual: `ExpensesPages.tsx:1617-1628` → `expense-draft.use-case.ts:61-116`;
- Substitute existing/new: `SubstituteReceiptWizardPage.tsx:255-275,841-860` and `prisma-expense.repository.ts:638-715,747-761`;
- reimbursement draft attachment: `ReimbursementCreatePage.tsx:52-91` and `reimbursements.api.ts:35-78`;
- reimbursement projection: `reimbursement-approval.use-case.ts:244-268`, `reimbursement-finance.use-case.ts:158-180`, `materialize-claim-expenses.service.ts:14-78`, `prisma-reimbursement.repository.ts:1020-1145`;
- LINE direct media: `process-line-webhook.use-case.ts:1901-2024`;
- LINE text note: `expense-document.use-case.ts:50-126`;
- LINE clarified media: `process-line-webhook.use-case.ts:2046-2304`, `schema.prisma:7197-7211`.

## 5. Thai Accounting and Tax Boundary

This feature changes only the operational discovery lens.

- `uploadedAt` answers “when did this record enter WatchDog?”
- `expenseDate` answers “what date does the source expense/document state?”
- accounting posting and closed-period handling remain owned by Ledger and the existing posting rules;
- VAT claimability/period remains owned by Thai Tax and the document/tax evidence facts;
- WHT remains tied to the applicable payment event and Thai Tax rules, not upload time;
- the late-document tag is informational and creates no journal, tax event, approval, mutation or period selection.

Thai basis:

- The Federation of Accounting Professions explains that an expense is recognized in the period in which the transaction occurs under accrual accounting, even when evidence/payment arrives later: <https://tfac.or.th/Faq/Detail/1329>.
- Revenue Department VAT Announcement No. 89 requires the purchase-tax report to retain the date stated on the tax invoice while recording received invoices under the statutory process: <https://www.rd.go.th/3374.html>.
- Revenue Department VAT Announcement No. 76 governs late input-VAT use in later tax months under its conditions: <https://www.rd.go.th/3386.html>.
- WHT remittance follows the month of payment for the applicable payment type, not the upload month: <https://www.rd.go.th/3535.html>.

These references are guardrails; this UI tag does not decide deductibility or tax claim eligibility.

## 6. Product Decisions

### D1 — Preserve the existing Expenses list design

Keep the current page shell, day/month control, branch filter, KPI cards, status chips, search, desktop grid, mobile cards, pagination and detail navigation. Do not add a new date-lens switch or a new navigation surface to the main list.

Only the following visible changes are in scope:

1. the existing day/month control filters the list by `uploadedAt`;
2. the date cell/card shows both the document date and the system-intake date;
3. a conditional `เอกสารย้อนหลัง X วัน` tag appears when R4 applies;
4. helper copy makes clear that the list period is “วันที่ส่งเข้าระบบ”.

### D2 — Reuse `uploadedAt`; do not add a new field

The requested “วันที่อัปโหลด” maps to the existing `ExpenseRecord.uploadedAt`. Its domain meaning is **วันที่เข้ารายการค่าใช้จ่าย** and the compact row label remains **ส่งเข้าระบบ** because the Expenses list also contains manual, LINE-text and reimbursement/API_INTERNAL records where no file upload occurred.

For direct `WEB_UPLOAD` / `LINE_UPLOAD` receipts this is the Expense upload-intent/creation time. For manual rows it is draft creation, and for reimbursement projections it is projection creation at the approving step. It is immutable after Expense creation for this feature.

For clarified LINE media, the attachment can precede the Expense by up to 30 minutes. Under the recommended no-schema/no-rewrite design, intake is the clarification time when a real Expense row exists. If the owner instead requires the original LINE media-arrival month, the plan must explicitly carry `LineIntakePendingMedia.createdAt` into Expense intake; implementation must not infer that expansion silently.

### D3 — Main list and KPI cohort use system-intake time

The list query uses `uploadedFromDate` / `uploadedToDate`. Status chips and KPI cards continue to operate over the rows fetched for that selected intake period.

The KPI cards therefore mean:

> totals/statuses of records sent into the system during the selected period

They do **not** mean accounting-period totals, VAT return totals or WHT return totals. Existing KPI helper copy must state the intake cohort explicitly.

Dashboard financial summaries, tax pages, accountant evidence and ledger pages retain their own date semantics.

### D4 — Accountant export remains document-date based

The existing list export remains `dateField: 'expenseDate'` because its purpose and columns are accounting/tax handoff by source-document period. It must not silently switch to upload period merely because the operational list does.

The existing helper text beside the export must be changed from ambiguous “ช่วงที่เลือก” wording to explicit wording equivalent to:

> ส่งออกตามวันที่เอกสารของวัน/เดือนที่เลือกสำหรับส่งบัญชีหรือภาษี

This means a screen can show August intake while the export button exports August document dates. The different lens is deliberate and must be visible in copy. The Accountant Evidence page remains the surface for explicitly exporting by either uploaded or document date.

### D5 — Sort by the selected operational date

When a list request contains an upload-date range and no document-date range, the repository orders by:

1. `uploadedAt desc`;
2. `id desc` as a deterministic tie-breaker if needed by the repository/query shape.

Requests without an upload range keep the existing `expenseDate desc` behavior. This preserves the Substitute Receipt candidate scan and other generic list callers.

The sort rule matters because the endpoint caps `pageSize` at 200. Client-side sorting after the query would not repair a row excluded from those first 200 results.

### D6 — Source pages retain their native workflow dates

This fix changes the main Expenses list, not every source/workflow list:

- the web upload and manual pages are creation surfaces and receive no new month filter;
- the Substitute Receipt hub keeps its existing payment-date/expense-date month and evidence-update ordering;
- the Substitute Receipt candidate scan keeps its generic no-upload-range list call and document-date ordering;
- Reimbursement Mine, Approval and Finance queues keep request/submit/approval/payment semantics;
- LINE remains a capture channel and receives no new list UI.

Rows created by every path still participate in the main Expenses intake-month filter and late-tag derivation. This separates “where the row is discovered operationally” from the source workflow's own legally/business-relevant dates.

## 7. Business Rules

### R1 — Operational filter

For the main Expenses list only:

```text
day/month range → uploadedFromDate / uploadedToDate
```

Do not send the same values as `fromDate` / `toDate` from this surface.

### R2 — Document truth is unchanged

Never copy `uploadedAt` into `expenseDate`, and never modify `expenseDate` merely to retain visibility. OCR correction, manual review, VAT registration checks, duplicate detection, Ledger and Tax continue to consume the real document date.

### R3 — Both dates are visible

Every main-list row/card shows:

- `วันที่เอกสาร {expenseDate}`
- `ส่งเข้าระบบ {uploadedAt in Asia/Bangkok}`

The capture-source badge remains. No existing status/action is removed.

### R4 — Late-document tag condition

Compute:

```text
documentCivil = expenseDate as YYYY-MM-DD
intakeCivil   = uploadedAt converted to Asia/Bangkok YYYY-MM-DD
daysLate      = whole civil days between documentCivil and intakeCivil
```

Show `เอกสารย้อนหลัง {daysLate} วัน` only when all are true:

1. both dates are valid;
2. `intakeCivil > documentCivil`;
3. `civilPeriodKey(intakeCivil) !== civilPeriodKey(documentCivil)`.

The month comparison is the product rule. Two dates in the same month show no tag even if many days apart. Crossing a month boundary by one day shows `เอกสารย้อนหลัง 1 วัน`.

### R5 — Thailand civil-day calculation

- Convert the instant `uploadedAt` with the existing `civilDate(..., 'Asia/Bangkok')` helper.
- Treat `expenseDate` as a civil date, not an instant to be re-zoned.
- Calculate day distance from civil dates using existing civil-date primitives; do not divide arbitrary local timestamps or slice `uploadedAt` as UTC.

Example boundary:

`2026-07-31T17:30:00.000Z` is 1 August in Bangkok. A 31 July document must produce August intake and `ย้อนหลัง 1 วัน`.

### R6 — Invalid/future ordering

If `intakeCivil <= documentCivil`, return no late-document tag. Do not render a negative day count. Existing validation owns future document dates; this feature does not introduce a second validation/error badge.

### R7 — Source coverage

Apply the same date comparison to every `ExpenseSummary`, including `WEB_MANUAL`, `LINE_UPLOAD` (both media and text-note subtype), `API_INTERNAL` and reimbursement projections. The tag says the **document/expense is recorded later**, not that a particular attachment upload was late.

This is why the generic row label is `ส่งเข้าระบบ`, not `อัปโหลดไฟล์`.

### R8 — Later attachments do not move the row

Uploading a supporting receipt, signed copy or payment evidence after initial creation must not modify `ExpenseRecord.uploadedAt`, reassign the list month or recalculate lateness from the attachment time.

### R9 — Existing security and tenancy

Company, branch and related/own-user filters remain ANDed with the upload-date range. No permission, ABAC, audit, attachment URL or tenant boundary changes.

### R10 — Source event dates do not rewrite Expense intake

Do not update `ExpenseRecord.uploadedAt` when any of the following occurs:

- receipt/supporting/payment attachment completion;
- OCR completion or document-date correction;
- substitute evidence preparation, payer signature, certification, approval or supersession;
- reimbursement submit, manager approval retry, payment or void after the Expense projection already exists;
- LINE correction after the Expense draft exists.

These events retain their own timestamps. A source page may filter by those timestamps without changing the main Expenses intake cohort.

## 8. UI Placement

### Desktop grid

Keep the existing five-column grid.

- Vendor/category column: unchanged except the late tag may sit in the existing metadata row where it does not replace the category or document number.
- Date/source column:
  - line 1: `วันที่เอกสาร 20 มิ.ย. 2569`
  - line 2: `ส่งเข้าระบบ 10 ส.ค. 2569`
  - capture-source badge remains visible.
- Late tag: Mangmee amber badge, text `เอกสารย้อนหลัง 51 วัน`.

The exact wrapping may be adjusted within the existing cell, but the grid, column order and row actions stay unchanged.

### Mobile card

Keep the existing card and click target. Show the two dates and the same tag. Do not hide the tag on mobile.

### Period control and empty state

- Add a short visible or immediately adjacent label: `กรองตามวันที่ส่งเข้าระบบ`.
- Empty state: `ไม่มีรายการที่ส่งเข้าระบบในช่วงเวลาที่เลือก`.
- Day/month state keys (`expenses.list.gran`, `.month`, `.day`) remain unchanged so back-navigation retention continues to work.

### Tag visibility

The tag is a derived property of the row. If the same row is rendered in another authorized surface later, the same condition yields the same tag. v1 only adds it to the main Expenses desktop/mobile list; Evidence already shows both dates and is not redesigned by this spec.

## 8.1 Backward Reasoning and Diagnostic Chain

The design must be explainable from the required user outcome back to stored truth, and diagnosable in the opposite direction:

| Required outcome | Trace backwards to the cause | Runtime proof required | Failure points to |
| --- | --- | --- | --- |
| August-uploaded June document is visible in August | visible row ← main-list response ← upload-range filter ← immutable `ExpenseRecord.uploadedAt` | captured request plus repository result containing the row | wrong request lens, wrong range conversion, scope filter or missing row |
| Newest intake is not dropped by the 200-row cap | first page ← `orderBy uploadedAt desc` ← order applied before `skip/take` | repository test with more candidates than page size | server order still follows `expenseDate` or client-only sort |
| Tag says 51 days only across months | rendered badge ← pure helper ← Bangkok intake civil date + document civil date | red/green helper cases and DOM assertion | UTC slicing, invalid month rule or wrong source date |
| Correcting OCR date does not move the row | list cohort uses immutable intake; OCR mutates only `expenseDate` | upload/correct/back E2E plus before/after values | `uploadedAt` rewritten or UI still filters document date |
| Substitute action does not move an existing Expense | main list reads original Expense intake; certificate has its own event dates | workflow assertion around prepare/sign/approve | certificate code refreshed Expense intake |
| Approved claim appears when projected into Expenses | visible projection ← approval materialization ← new `API_INTERNAL` Expense | reimbursement projection test and Expenses lookup | claim date incorrectly treated as existing Expense intake |
| Accounting/tax result is unchanged | posting/tax/export continue from `expenseDate`/payment rules; tag performs no mutation | unchanged payload assertions plus scoped file diff | scope leaked into tax, ledger, posting or export |
| Source workflow lists behave as before | main-list change is isolated from Substitute/Reimbursement query builders | source-list request and browser regression | generic list/order change affected an unrelated caller |

If evidence cannot follow one complete chain from stored values to user-visible result, the related acceptance criterion remains open.

## 9. Scenario Matrix

| # | Scenario | Main-list period | Tag | Accounting/tax effect |
| --- | --- | --- | --- | --- |
| S1 | Document 20 Jun, intake 10 Aug | Appears in August | `ย้อนหลัง 51 วัน` | None; document date remains June |
| S2 | Document 31 Jul, intake 1 Aug Bangkok | Appears in August | `ย้อนหลัง 1 วัน` | None |
| S3 | Document 1 Aug, intake 31 Aug | Appears in August | None; same month | None |
| S4 | Document and intake 10 Aug | Appears in August | None | None |
| S5 | OCR initially uses 10 Aug, then corrects document to 20 Jun | Stays in August before and after correction | Tag appears after correction | OCR/document truth changes; list cohort does not |
| S6 | Upload instant is 31 Jul 17:30 UTC = 1 Aug Bangkok | Appears in August | Based on Bangkok day | None |
| S7 | Supporting file added in September to an August intake | Remains in August | Unchanged | None |
| S8 | Manual/API_INTERNAL record with June expense date created in August | Appears in August | Tag appears | Copy says “ส่งเข้าระบบ”, not “ไฟล์อัปโหลด” |
| S9 | Reimbursement line incurred in June; projection created in August | Projection appears in August Expenses list | Tag appears | Reimbursement workflow, posting and payout remain unchanged |
| S10 | Legacy row: `uploadedAt` backfilled from `createdAt` | Appears by backfilled intake month | Tag may appear when months differ | Accepted approximation; no migration |
| S11 | Expense date after intake due to invalid legacy data | Appears by intake month | No negative tag | Existing review/validation owns anomaly |
| S12 | More than 200 intake rows in one month | API returns newest 200 by `uploadedAt` | Derived on returned rows | Existing KPI/pagination cap remains a known limitation |
| S13 | Web upload starts in August; OCR changes document from August to June | Stays in August | Tag appears after OCR | Upload/review flow unchanged |
| S14 | Manual June expense saved in August; optional receipt upload fails or finishes later | Appears in August | Tag appears | Draft recovery/attachment event does not move it |
| S15 | Existing June Expense entered in July; substitute certificate issued in August | Remains in July Expenses intake | Based on June → July, not certificate issue date | Substitute hub continues to use payment/expense month |
| S16 | Substitute wizard creates new June manual Expense in August | Appears in August | Tag appears | Later signature/approval does not move it |
| S17 | June claim drafted/submitted in July and approved/materialized in August | Projected Expense appears in August; claim remains in its own queues | Tag appears on projected Expense | Claim dates, approvals and payout unchanged |
| S18 | LINE direct receipt arrives in August; OCR finds June document date | Appears in August | Tag appears | LINE reply/deep link unchanged |
| S19 | LINE text note records June expense in August | Appears in August | Tag appears | Tag means late Expense entry, not file upload |
| S20 | LINE pending media received 31 Jul 23:50 and confirmed 1 Aug 00:05 Bangkok | Recommended current semantics: appears in August when Expense is created | Based on Expense creation | Original-media-month behavior requires explicit scope decision |

## 10. Code Impact Map

### Expected implementation touchpoints

| Area | File | Planned impact |
| --- | --- | --- |
| Main list query and rendering | `apps/web/src/features/expenses/ExpensesPages.tsx` | Send upload range; add intake label, both dates and tag in desktop/mobile; keep export on document date |
| Pure display logic | `apps/web/src/features/expenses/expenses.model.ts` | Add a pure helper returning late days/tag state from `expenseDate` + `uploadedAt` |
| Pure-logic tests | `apps/web/src/features/expenses/expenses.model.spec.ts` | Pin cross-month, same-month, Bangkok boundary, invalid/reversed date cases |
| Thai/English copy | `apps/web/src/common/i18n/workspace-dictionary.ts` | Intake-period labels, empty state, export lens and late tag |
| Repository ordering | `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts` | Sort by `uploadedAt` when upload range is used; preserve default document sort |
| Repository focused test | expense repository spec near the list query | Pin where/order behavior and branch/own/related composition |

### Verified no-change areas

| Area | Why no change |
| --- | --- |
| Prisma schema/migrations | `uploadedAt` and index already exist |
| Contracts and HTTP query DTO | summary field and upload filters already exist |
| Receipt upload lifecycle | `uploadedAt` already records initial intake and later attachments do not rewrite it |
| Expense detail/review mutation | `expenseDate` remains the editable document truth |
| Duplicate detection | must remain based on document facts |
| VAT registration-aware capture | must remain based on `expenseDate` |
| Ledger/autopost/period close | no upload-date accounting behavior |
| Thai Tax event generation | no VAT/WHT period changes |
| Dashboard financial summary | remains document/financial period based; it is not the intake queue |
| Accountant Evidence | already supports both date lenses and already defaults to upload date |
| Reimbursement pages and approvals | their own queues retain submitted/approved/paid semantics; only derived Expense list visibility changes |
| Substitute Receipt candidate scan | calls the list without upload range and retains existing document-date ordering |
| Substitute Receipt hub filter/order | retains payment-date/expense-date month and evidence `updatedAt` ordering |
| LINE pending-media storage | no schema change under recommended Expense-intake semantics; its `createdAt` remains source evidence only |

## 11. Gap and Risk Assessment

### G1 — KPI semantic drift

Switching the query automatically changes KPI cohorts. Without copy changes, users may interpret August intake totals as August accounting/VAT totals. Mitigation: D3 copy and explicit non-accounting boundary.

### G2 — Export/list mismatch

The list and export deliberately use different date lenses. Without explicit export copy, users may assume WYSIWYG export. Mitigation: D4; do not silently change tax/accounting export semantics.

### G3 — Wrong sort under a 200-row cap

Filtering by intake but sorting/taking by document date can still hide newly uploaded old documents. Mitigation: D5 server-side order by `uploadedAt` before `take`.

### G4 — “Upload” wording is false for manual/API records

Mitigation: canonical label `วันที่ส่งเข้าระบบ`; `uploadedAt` remains the technical field.

### G5 — Legacy approximation

Old rows use creation time as upload/intake time. This is already the documented migration assumption. No new migration or historical inference is justified.

### G6 — Month boundary and timezone

Slicing a UTC timestamp would misclassify uploads between 00:00 and 06:59 Bangkok. Mitigation: R5 and focused tests.

### G7 — Existing page-size ceiling

The current client-side KPI/chip/page model loads at most 200 rows. Correct sorting ensures the newest intake is present but totals can still undercount above 200. This is pre-existing and out of scope; record it in handoff/verification.

### G8 — Existing tax/posting semantic gaps are not pulled into this bug

Some tax/ledger paths may have their own date-policy work. This feature must not opportunistically change them. Any discovered issue receives a separate spec.

### G9 — Reimbursement has three different candidate “intake” dates

A claim can have attachment upload, request creation/submission and Expense projection dates. `ExpenseRecord.uploadedAt` is only the projection date because the Expense does not exist earlier. Mitigation: D2/D6 wording and S17; do not present it as the claim attachment-upload date or change Reimbursement queue filters.

### G10 — Clarified LINE media can cross a month boundary before Expense creation

Pending media stores its own `createdAt` and expires after 30 minutes, while the Expense is created on confirmation. The current field therefore uses confirmation time. Mitigation: accept the recommended Expense-intake definition, or explicitly widen the implementation plan to preserve original media time. This is an owner-review item, not an implicit code change.

## 12. Acceptance Criteria

1. AC1 — With selected month August, an expense with June `expenseDate` and August `uploadedAt` is returned and displayed.
2. AC2 — Changing that record's `expenseDate` from August to June does not remove it from the August list.
3. AC3 — The row/card shows both dates and `เอกสารย้อนหลัง 51 วัน` for 20 June → 10 August.
4. AC4 — No tag appears when the two dates are in the same `YYYY-MM`, regardless of day distance.
5. AC5 — 31 July → 1 August shows `ย้อนหลัง 1 วัน`.
6. AC6 — An upload instant at `2026-07-31T17:30Z` is classified as 1 August in Asia/Bangkok.
7. AC7 — No negative tag appears when document date is on/after intake date.
8. AC8 — Upload-range list requests are ordered by newest `uploadedAt` before pagination; document-range/no-range callers retain `expenseDate` ordering.
9. AC9 — Branch and own/related permission scopes remain applied with the upload range.
10. AC10 — Desktop and mobile preserve current layout/actions and both show the tag.
11. AC11 — KPI/helper copy states that the cohort is records sent into the system in the selected period.
12. AC12 — Main-list accountant export remains document-date based and says so explicitly.
13. AC13 — No schema migration, new permission, new dependency, tax event, journal entry or audit mutation is introduced.
14. AC14 — Evidence page behavior and its uploaded/document date switch remain unchanged.
15. AC15 — Adding a later supporting attachment does not change the list month or late-day count.
16. AC16 — Web upload, web manual, substitute-new-manual, LINE direct and LINE text paths all produce rows discoverable by their Expense creation month.
17. AC17 — Issuing/signing/approving a substitute receipt for an existing Expense does not change that Expense's intake month or late-day count.
18. AC18 — A reimbursement Expense projection uses line `incurredDate` as document date and projection creation as Expense intake; Reimbursement source queues remain unchanged.
19. AC19 — Substitute Receipt hub month/order and its no-range candidate scan retain their current semantics.
20. AC20 — Direct LINE OCR correction does not move the row out of its Expense intake month.
21. AC21 — The clarified-LINE month-boundary behavior matches the owner-approved definition recorded in D2; no timestamp is silently substituted.

## 13. Non-Goals

- Redesigning the Expenses workspace or introducing global date-lens tabs.
- Changing accounting period, posting date, VAT claim period, WHT period or deductibility.
- Adding a second upload timestamp or changing attachment timestamps.
- Adding tags to Reimbursement, Approval, AP, Ledger, Dashboard or Tax pages in v1.
- Solving server-side KPI aggregation/pagination above 200 rows.
- Changing accountant-package `accounting_period` derivation; that is separate accounting/export scope.
- Fixing unrelated pre-existing tax/ledger date-policy gaps.

## 14. Owner Decisions Recorded

- Preserve the existing page design.
- Use the existing upload/intake date to keep newly entered records in the selected upload month.
- Show `เอกสารย้อนหลัง X วัน` only when document month and intake month differ.
- Write Spec and Plan and inspect surrounding business/code impact before implementation.
- No implementation is authorized by this document-only task.
- Owner review is still required for the clarified-LINE boundary and the distinction between reimbursement attachment/submission time and Expense projection time.
