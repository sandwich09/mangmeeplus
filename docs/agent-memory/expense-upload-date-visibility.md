# Agent Memory: expense-upload-date-visibility

Status:
Spec and plan v0.2 drafted 2026-08-15; not implemented. Awaiting owner review/sign-off on cross-channel date semantics.

Owner:
Product owner requested existing-design preservation, upload-month visibility, a cross-month `เอกสารย้อนหลัง X วัน` tag, and mandatory spec/plan plus surrounding impact discovery before implementation.

Scope:
Document-only discovery for the Expenses main-list bug where a receipt uploaded in August disappears after its document date resolves to June. Includes UI/API/repository, KPI, export, Evidence, web upload, manual entry, substitute receipt, reimbursement projection, LINE capture, Ledger/Tax and Thai business-boundary impact. No runtime or application-code change.

Decisions:

- Preserve the existing Expenses page layout and controls; no new date-lens UI on the main list.
- Reuse existing `ExpenseRecord.uploadedAt`; no schema field/migration.
- Main list day/month and its KPI/status cohort use `uploadedAt`.
- Visible business wording is `วันที่ส่งเข้าระบบ` because manual/API/reimbursement rows may have no file upload.
- Precise domain meaning is `วันที่เข้ารายการค่าใช้จ่าย`: web upload intent, manual draft creation, substitute-new Expense creation, reimbursement projection creation, or LINE Expense creation depending on source.
- Show `เอกสารย้อนหลัง X วัน` only when intake is later and the two Asia/Bangkok civil dates have different `YYYY-MM` values.
- Keep `expenseDate` unchanged for accounting/tax/document truth.
- Server must order upload-range queries by `uploadedAt desc` before the 200-row cap.
- Main-list accountant export remains document-date based; helper copy must state that explicitly.
- Evidence Panel, Dashboard financial summaries, Reimbursement workflow, Ledger and Thai Tax behavior are unchanged.
- Substitute evidence created for an existing Expense never refreshes the Expense intake; its hub keeps payment/expense-date filtering.
- Reimbursement receipt upload/submit does not create an Expense; an `API_INTERNAL` Expense is materialized at manager/finance approval.
- LINE clarified media stores an attachment before Expense creation; current `uploadedAt` is confirmation time within the 30-minute window.
- No implementation is authorized in this task.

Open questions:

- Owner sign-off on the full spec, especially canonical copy `วันที่ส่งเข้าระบบ` and the deliberate list-versus-export date-lens separation.
- Owner sign-off that reimbursement Expense rows belong to projection-creation month, not claim attachment/submission month.
- Owner sign-off that clarified LINE media belongs to Expense confirmation/creation month (recommended); original media-arrival month would widen implementation scope.
- The existing 200-row client KPI ceiling remains a known, non-blocking limitation outside this scope.

Artifacts:

- `docs/specs/expense-upload-date-visibility-spec.md`
- `docs/plans/expense-upload-date-visibility-plan.md`
- `docs/agent-memory/expense-upload-date-visibility.md`

Verification:

- Inspected current expense contracts, schema, migration, UI list/filter/KPI/export, API controller/use case/repository, Evidence date lenses, reimbursement expense projection, report/dashboard/tax/ledger consumers and civil-date helpers.
- Traced web upload, manual entry, substitute existing/new, reimbursement draft/attachment/submit/projection, and LINE direct media/text/clarified-media flows to their Expense creation point.
- Confirmed `uploadedAt` and upload-range filters already exist and are indexed.
- Confirmed current main-list query filters `expenseDate` and current repository sort is `expenseDate desc`.
- Baseline focused suites passed: web Expense/Substitute 65/65, Expense upload/Substitute API 27/27, Reimbursement mapping/approval/finance 78/78 and LINE intake 73/73.
- Identified missing proof that must be added red-first during implementation: repository upload-order-before-pagination, main-list request payload, cross-month helper/UI, source immutability and clarified-LINE month boundary.
- Confirmed no application code, schema, configuration, package manifest or runtime behavior was changed.
- Working tree already contained unrelated user change `docs/agent-memory/legal-acceptance-item3-data-deletion.md`; left untouched.

Next:

1. Owner reviews/specifies any wording or export-lens change.
2. Only after sign-off, implement the scoped plan and record focused verification evidence here.
