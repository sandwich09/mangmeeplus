# Payroll and HR Compliance Implementation Plan

## Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 20.

Implementation owner/model should implement one phase at a time. First handoff scope is Phase 0 and Phase 1 unless owner explicitly expands scope.

## Linked Spec

- Spec: [[specs/payroll-hr-compliance-spec|Payroll and HR Compliance Spec]]
- Roadmap item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 20. Payroll and HR Compliance
- Related specs:
  - [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]]
  - [[specs/tax-2026-verified-rules|Thai Tax 2026 Verified Baseline]]
  - [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Closing Spec]]
  - [[specs/reports-bi-spec|Reports BI Spec]]
  - [[specs/dashboard-notification-spec|Dashboard and Notification Spec]]
  - [[specs/workflow-automation-spec|Workflow Automation Spec]]
  - [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
  - [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
  - [[specs/ai-draft-suggestion-layer-spec|AI Draft and Suggestion Layer Spec]]
  - [[specs/permission-matrix|Permission Matrix]]
  - [[specs/data-model-core-spec|Data Model Core Spec]]
  - [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
  - [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
- Related guidelines:
  - [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
  - [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
  - [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Related ADRs:
  - [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

## Purpose

Implement the first HR/payroll compliance slice for WatchDog-BMS:

- Employee master and sensitive employee data.
- Employment, compensation, leave, benefit, tax, social security, and payment display records.
- Monthly payroll run lifecycle.
- Payroll calculation, review issues, approval, finalization, correction, and payslips.
- ภ.ง.ด.1 payroll withholding source data.
- Social security preparation, reminders, manual filing/payment status, and exports.
- Ledger posting inputs, tax source events, report adapters, notifications, workflow tasks, and read-only AI/LINE summaries.
- LINE leave request intake for linked employees, manager/HR approval tickets, approval/rejection notifications, and frequent-leave warning notifications.

This plan should give Sonnet 4.6 enough detail to implement without reopening product or architecture decisions.

## Current Repository Context

Current docs snapshot on 2026-06-23 shows item 20 follows these foundations:

- Item 02 auth/RBAC/audit owns trusted request context, permissions, role grants, sensitive action audit, and AI tool permission inheritance.
- Item 03 web core owns full workspace shell, navigation, forms, table/detail conventions.
- Item 04 data model core owns company, branch, document sequence, attachment, audit, and outbox primitives.
- Item 06 dashboard/notification owns dashboard provider hooks and notification delivery.
- Item 07 LINE AI assistant owns account-linked read-only tools and web deep links.
- Item 10 ledger owns generated journals, source posting adapter contract, period close, and financial reports.
- Item 11 tax owns tax periods, filing packages, WHT/50 ทวิ certificate workflow, and tax verification/config baseline.
- Item 16 workflow owns approval/review/deadline tasks.
- Item 17 AI draft/suggestion owns cited draft/suggestion review, not final payroll mutation.
- Item 18 reports owns report registry, safe export behavior, and BI views.

Before implementation, inspect latest code again because previous roadmap items may add Prisma, request context, auth guards, permission registry, audit, outbox, attachment storage, document sequence, tax adapters, ledger source adapters, report registry, dashboard providers, notification events, workflow actions, AI tool registry, web shell routes, shared API client, and current package scripts.

## Implementation Readiness Status

Status: ready for implementation handoff as of 2026-06-23.

Active implementer target: Sonnet 4.6 or later.

Product decisions for first pass:

- Web/API own all payroll and HR mutations.
- LINE and AI are read-only for payroll, payroll-sensitive, approval, export, bank, tax, social-security, and filing actions.
- LINE may create only the linked employee's own leave request as a pending approval ticket through the same permission-checked leave request use case.
- Frequent-leave warning threshold defaults to 5 leave requests per employee per payroll period/month until company policy overrides it.
- Monthly payroll is default.
- Payroll statutory behavior is driven by versioned `PayrollComplianceRuleSet`.
- RD/SSO/labour rates, caps, due dates, form layouts, and leave floors are verified config rows, not code constants.
- Employee full bank account number storage is deferred unless secure vault/encryption/tokenization primitives already exist.
- Bank payment exports are review-only and never execute transfer.
- Payroll 50 ทวิ support emits source data for item 11 unless current item 11 implementation delegates employee certificates to payroll.

Start point:

1. Read this plan first.
2. Read `docs/specs/payroll-hr-compliance-spec.md`.
3. Read `docs/specs/tax-thailand-2026-spec.md`.
4. Read `docs/specs/tax-2026-verified-rules.md`.
5. Read `docs/specs/double-entry-ledger-closing-spec.md`.
6. Read `docs/specs/reports-bi-spec.md` if report adapters exist.
7. Read `docs/specs/dashboard-notification-spec.md` and `docs/specs/workflow-automation-spec.md` if notification/workflow hooks exist.
8. Read `docs/specs/permission-matrix.md`.
9. Read backend/frontend/security guidelines.
10. Inspect `apps/api`, `apps/web`, `apps/ai-gateway`, `apps/workers`, `packages/contracts`, `packages/config`, and current database/prisma state.
11. Start at Phase 0: Baseline and Compliance Reconciliation.

Do not mark Master Implementation Checklist item 20 complete until Phase 0 through Phase 10 exit criteria pass and verification commands are recorded.

## Implementation Rules

- Reuse current repo conventions and outputs from items 01 through 19.
- Extend existing Prisma/auth/audit/outbox/document-sequence/attachment/request-context primitives. Do not duplicate them.
- Keep controllers thin. Controllers call use cases only.
- Keep Prisma usage inside infrastructure repositories, queries, DB mappers, and shared Prisma service.
- Do not use Prisma generated types as domain models.
- Use decimal-safe calculations. Use strings in shared contracts for money and decimals.
- Do not hard-code statutory rates, caps, brackets, allowances, due dates, leave entitlements, or export formats in business logic.
- Rule sets must carry source URL/title, checkedAt, reviewer, status, effective date, and version/checksum metadata.
- Sensitive employee/payroll fields require explicit permission and masking.
- Audit all high-risk sensitive read/mutation/export actions when audit primitives exist.
- Outbox/notification payloads must not contain raw salary, tax id, bank, payslip, leave reason, or health/benefit data.
- Finalized payroll runs are locked. Corrections use adjustment/reversal runs.
- Respect item 10 closed-period policy.
- Respect item 11 tax/compliance filed-period policy.
- Item 20 emits payroll source facts; item 10 generates journals; item 11 owns tax filing/certificate lifecycle unless current implementation says otherwise.
- LINE and AI remain read-only except the explicitly allowlisted own leave-request intake. They use permission-checked ERP APIs/tools and refuse approval/final payroll/sensitive mutations.
- Each phase must leave touched packages typecheckable.

## Scope

### In Scope

- Shared HR/payroll contracts in `packages/contracts`.
- API module(s) for HR and payroll using local hexagonal folder structure.
- Permission keys and default grants for HR/payroll.
- Employee master, sensitive employee profile, tax profile, social security profile, compensation assignment, leave policy/request/balance, benefit enrollment.
- Payroll compliance rule set/config/source verification.
- Payroll run lifecycle: create, calculate, review, submit, approve, finalize, void/reversal/adjustment.
- Payroll calculation domain services.
- Payslip generation/publication metadata and first-pass PDF/HTML behavior using current file/attachment primitives.
- Payroll tax events for ภ.ง.ด.1 and payroll 50 ทวิ source data.
- Social security contribution events, prep screen/export, manual filing/payment status.
- Ledger posting inputs.
- Report adapter/provider hooks when item 18 exists.
- Dashboard/notification/workflow hooks when primitives exist.
- Web feature folders/routes for HR, leave, payroll, payslip, compliance, settings.
- LINE leave request intake and LINE/web notifications for leave submitted, approved, rejected, pending approval, and frequent-leave warning.
- Read-only AI/LINE tools or API payloads when current AI Gateway integration points exist, plus the allowlisted LINE leave-request intake.
- Tests for domain, permissions, lifecycle, exports, UI, and AI/LINE denial behavior where test setup supports them.

### Out of Scope

- Auto-filing or portal submission to RD/SSO.
- Bank transfer execution.
- Full bank account plaintext vault if encryption/tokenization primitives do not exist.
- Recruitment, onboarding, performance, disciplinary, training, shift scheduling, biometric time clock, org chart, or document e-sign workflows.
- Complex overtime/time attendance engine beyond audited manual/imported adjustment lines.
- Multi-country or multi-currency payroll.
- Provident fund carrier, insurance carrier, or benefits provider integrations.
- Contractor/AP payments.
- LINE/AI payroll, leave approval/rejection, bank, tax, export, filing, or sensitive mutation beyond own leave-request intake.
- Replacing item 10 ledger or item 11 tax/certificate workflows.

## Backlog and Next-Scope Notes

### Not in First Pass

- Employee self-service profile edits, tax profile edits, bank account edits, or personal-data change requests.
- Payroll-owned 50 ทวิ certificate issue/PDF/export when item 11 can own certificate lifecycle.
- PDF-first payslip pipeline if current PDF/file tooling is absent or unstable.
- Direct RD/SSO portal submission, e-filing automation, government API mutation, or acceptance polling.
- Direct bank transfer execution, payment rail integration, PromptPay initiation, or bank API upload.
- Full plaintext storage for employee bank account, national id, tax id, or social security number without secure vault/encryption/tokenization.
- Recruitment, onboarding workflow, performance review, disciplinary case, org chart, shift scheduling, time clock, biometric attendance, learning, or full HRIS suite.
- Complex overtime/time-attendance engine beyond audited manual/imported payroll adjustment lines.
- Provident fund carrier, insurance carrier, benefit provider, or payroll bureau integration.
- Multi-country payroll, contractor/AP payment, or multi-currency payroll.
- LINE/AI mutation for payroll, leave approval/rejection, employee bank/tax data, exports, filing/payment status, or approval beyond own leave-request intake.

### Recommended Next Work

- Keep reviewer split explicit: `HR` verifies employee, leave, benefit, and profile data; `ACCOUNTANT` verifies payroll tax, SSO, rule sets, and filing/export readiness.
- Enable employee self-service narrowly: own published payslip and own leave request/status first. Add profile/tax/bank change request later with HR approval and audit.
- Start payslip as HTML snapshot plus checksum/file metadata. Add PDF after current attachment/PDF pipeline is stable.
- Keep 50 ทวิ certificate authority in item 11. Payroll should emit employee income/tax source data, yearly source totals, and source checksums.
- Add secure vault/encryption/tokenization before storing full sensitive identifiers.
- Add time attendance/overtime as separate scope after payroll run lifecycle is stable.
- Add bank payment file and bank transfer execution only after bank/reconciliation and approval controls are mature.
- Add RD/SSO e-filing automation only after manual export/status workflow is audited in production-like use.

## First Implementation Defaults

Use these defaults unless owner explicitly changes them:

- IDs: repo standard; otherwise `String @id @default(cuid())`.
- Currency: explicit `THB` string by default.
- Period key: `YYYY-MM`.
- Payroll period type: `MONTHLY`.
- Default pay group: `default`.
- Route bases:
  - `/v1/companies/:companyId/hr`
  - `/v1/companies/:companyId/payroll`
- Document/export sequence keys:
  - `hr.employee`
  - `hr.leave_request`
  - `payroll.run`
  - `payroll.payslip`
  - `payroll.export`
- Export formats:
  - Required: review JSON and CSV.
  - PDF: payslip and summary when existing PDF/file tooling exists; otherwise generate structured unavailable error for PDF except payslip fallback HTML snapshot.
  - XLSX: use existing spreadsheet writer or dependency-approved package; otherwise typed unavailable.
- Payroll correction:
  - Adjustment run for additional amount.
  - Reversal run for full void/reverse.
- Salary/bank/tax values:
  - Mask in lists and audit previews.
  - Full sensitive read requires dedicated permission.
- Employee self-service:
  - Own leave request/read and own published payslip read only when current auth/web supports it.
- LINE/AI:
  - Summaries and links only, except own leave-request intake.
- Leave warning:
  - Default warning threshold: 5 leave requests per employee per payroll period/month.
  - Warning is informational; it does not auto-reject leave.
  - HR/admin can configure later through payroll/leave settings.

## Phase 0: Baseline and Compliance Reconciliation

### Goal

Confirm current implementation state, official compliance assumptions, and extension points before editing code.

### Tasks

- [ ] Inspect root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, and package scripts.
- [ ] Inspect `apps/api/package.json`, `apps/api/src/common`, `apps/api/src/modules`, and current database/prisma state.
- [ ] Inspect existing modules for auth, permissions, audit, outbox, attachment/file storage, document sequence, request context, tax, ledger, reports, notifications, workflow, and AI tools.
- [ ] Inspect `apps/web` shell, route structure, feature folder conventions, common components, form/table patterns, and API client helpers.
- [ ] Inspect `apps/ai-gateway` tool registry/integration points.
- [ ] Inspect `packages/contracts` and `packages/config` style.
- [ ] Re-check current RD payroll/PIT/PND1 references and record source URL/date in rule set seed notes.
- [ ] Re-check current SSO contribution/rate/cap/filing references and record source URL/date in rule set seed notes.
- [ ] Re-check current labour/leave statutory floor references and record source URL/date in leave policy seed notes.
- [ ] Confirm accountant/owner decision for initial payroll withholding method, social security applicability, and payslip/export formats.
- [ ] Identify whether item 11 WHT certificate flow already supports employee 50 ทวิ. If yes, integrate; if no, add source data only and document gap.
- [ ] Identify item 10 source posting adapter shape and closed-period API.
- [ ] Identify item 18 report adapter shape if present.
- [ ] Write a short implementation note in PR/commit body or docs if official compliance verification changes scope.

### Tests

- None required unless existing docs/source validation scripts exist.

### Exit Criteria

- Current code extension points are known.
- Official compliance values are not hard-coded from memory.
- Rule set seed strategy is documented as config-driven.
- First implementation surface for Phase 1 is clear.

## Phase 1: Contracts, Permissions, and Domain Calculators

### Goal

Create shared contracts, permission keys, status enums, and pure domain logic before persistence/API.

### Tasks

- [ ] Add HR/payroll contract exports in `packages/contracts` following repo style.
- [ ] Define statuses/enums from spec for employee, payroll run, component, leave, export, compliance, and review issue.
- [ ] Define request/response DTO types for employee, leave, LINE leave intake, payroll run, payslip, tax, social security, export, and settings endpoints.
- [ ] Add permission keys to central registry/seed if it exists.
- [ ] Add default role grants according to spec when seed system exists.
- [ ] Implement domain value objects/helpers for decimal money, period key, effective-date lookup, source checksum, and review issue creation using existing utilities when available.
- [ ] Implement pure calculators:
  - `calculatePayrollRun`
  - `calculateEmployeePayrollLine`
  - `calculateTaxableIncome`
  - `calculatePitWithholding`
  - `calculateSocialSecurityContribution`
  - `calculateNetPay`
  - `calculateEmployerCost`
  - `calculateLeaveAdjustment`
  - `evaluateLeaveFrequencyWarning`
  - `buildPayrollPostingInput`
  - `buildPayrollTaxEvent`
  - `buildPayrollSocialSecurityEvent`
- [ ] Make calculators accept rule set snapshots and source data only; no database access.
- [ ] Add review issue outputs for missing/unverified rule set, missing tax profile, missing SSO profile, invalid totals, negative net pay, and stale source checksum.

### Tests

- [ ] Contract typecheck.
- [ ] Domain unit tests for decimal-safe payroll totals.
- [ ] Unit tests for PIT/SSO returning review issues when config missing/unverified.
- [ ] Unit tests for social security base inclusion/exclusion from config.
- [ ] Unit tests for unpaid leave adjustment source refs.
- [ ] Unit tests for leave-frequency warning threshold defaulting to 5 and not blocking approval flow.
- [ ] Unit tests for posting input debit/credit balance.

### Exit Criteria

- Shared contracts compile.
- Permission keys exist or are explicitly queued for seed integration.
- Payroll domain calculators are deterministic and test-covered.
- No API/db/web dependency required for domain tests.

## Phase 2: Persistence, Repositories, Audit, and Outbox

### Goal

Persist HR/payroll state using existing data primitives and repository boundaries.

### Tasks

- [ ] Add/migrate schema for company payroll profile, rule source, rule set, employee profile, sensitive profile, tax profile, social security profile, component definition, compensation assignment, leave policy/balance/request with source channel/message id/ticket/warning status, benefit plan/enrollment, payroll run, run line, line component, review issue, tax event, social security event, posting input, export package, and payslip.
- [ ] Use existing company/branch/team/user/attachment/document sequence/audit/outbox refs.
- [ ] Mask or omit sensitive values by default in queries.
- [ ] Store only masked/last4 bank/tax/social-security identifiers unless encryption/tokenization exists.
- [ ] Implement repositories and query services behind ports.
- [ ] Add transaction boundaries for create/calculate/submit/approve/finalize/void/export where current infrastructure supports it.
- [ ] Add audit action writers for sensitive reads, bank updates, payroll lifecycle, payslip, export, and compliance status.
- [ ] Add outbox event writers with safe payloads.
- [ ] Add idempotency for LINE leave intake by provider message/event id.
- [ ] Add idempotency keys/checksums for tax/social-security/posting/export facts.

### Tests

- [ ] Repository tests if current setup supports database tests.
- [ ] Unit tests for sensitive projection masking.
- [ ] Unit tests for audit payload masking.
- [ ] Integration tests for unique payroll period and finalized-run lock where persistence exists.

### Exit Criteria

- Schema/migrations compile.
- Repositories return safe projections by default.
- Sensitive data is not stored or emitted in plaintext when vault/encryption is absent.
- Audit/outbox behavior is wired or explicitly no-op behind existing missing primitives.

## Phase 3: Employee, Leave, Benefit, and Payroll Settings APIs

### Goal

Expose HR/payroll setup APIs with server-side permission and ABAC checks.

### Tasks

- [ ] Create API module(s) for HR and payroll settings using local architecture.
- [ ] Add controllers/routes for employee CRUD, sensitive profile, bank display/token refs, tax profile, social security profile, leave policies, leave requests, leave balances, benefit plans/enrollments, payroll profile, rule sets, component definitions, and compensation assignments.
- [ ] Enforce permissions and ABAC on every route.
- [ ] Add effective-date validation for employment/compensation/benefits.
- [ ] Add leave approval flow with manager/team scope.
- [ ] Add LINE leave request intake path that resolves linked employee from server context and calls the same leave request use case with `sourceChannel=LINE`.
- [ ] Create pending approval ticket/task for manager/HR when leave is requested through LINE.
- [ ] Evaluate frequent-leave warning on leave request submit/approval using default threshold 5.
- [ ] Add sensitive read audit for tax/bank/payslip/salary fields.
- [ ] Add rule-set verify flow with reviewer/source metadata.
- [ ] Return stable typed errors.

### Tests

- [ ] API tests for employee create/read/update and sensitive projection.
- [ ] API tests for bank/tax data permission denial.
- [ ] API tests for leave request/approve/reject with scoped manager.
- [ ] API/LINE-use-case tests for own linked employee leave request, duplicate LINE event id, and forbidden another-employee request.
- [ ] Notification tests for leave submitted, approved, rejected, and frequent-leave warning safe payloads.
- [ ] API tests for rule set create/verify and unverified status.
- [ ] API tests for compensation effective-date validation.

### Exit Criteria

- HR setup APIs are permission-protected.
- Sensitive data cannot leak through list/detail without permission.
- Leave workflow can feed payroll adjustment candidates.
- Rule sets and component definitions can be managed for Phase 4.

## Phase 4: Payroll Run Lifecycle and Calculation APIs

### Goal

Implement payroll run lifecycle from draft to finalized locked run.

### Tasks

- [ ] Add payroll run create/list/detail/update routes.
- [ ] Snapshot eligible employees by pay group, status, branch, and period.
- [ ] Add calculate/recalculate use case that builds line components, totals, review issues, tax events, social-security events, and posting input preview.
- [ ] Add stale-run detection when source data changes after calculation.
- [ ] Add submit/approve/finalize workflow with segregation-of-duty and threshold hooks where available.
- [ ] Add finalized-run lock and correction/reversal scaffolding.
- [ ] Add negative-net-pay block by default.
- [ ] Respect item 10 closed-period API when available.
- [ ] Respect item 11 filed/closed tax/compliance period API when available.
- [ ] Generate audit/outbox events for lifecycle transitions.

### Tests

- [ ] Payroll run lifecycle integration test: create -> calculate -> submit -> approve -> finalize.
- [ ] Duplicate period conflict.
- [ ] Finalized mutation blocked.
- [ ] Recalculate blocked after submit unless returned to draft.
- [ ] Stale source detection after compensation/rule/leave change.
- [ ] Negative net pay blocked.
- [ ] Closed period blocked when adapter available.
- [ ] Permission denial for calculate/approve/finalize.

### Exit Criteria

- Payroll run can be finalized with locked snapshots and deterministic totals.
- Blocking review issues prevent finalization.
- Reversal/adjustment path exists enough to avoid silent finalized mutation.
- Lifecycle is auditable.

## Phase 5: Tax, Social Security, Ledger, and Report Adapters

### Goal

Connect finalized payroll facts to tax, social security, ledger, and reports without duplicating ownership.

### Tasks

- [ ] Implement payroll tax event query/sync adapter for `PAYROLL_PND1`.
- [ ] Implement payroll 50 ทวิ source summary by employee/tax year.
- [ ] Integrate with item 11 tax source adapter if present; otherwise expose stable payroll tax source API and mark sync pending.
- [ ] Implement social security contribution period summary and manual filing/payment status.
- [ ] Implement social security export package metadata and CSV/review JSON output.
- [ ] Implement ledger posting input adapter for finalized payroll runs.
- [ ] Integrate with item 10 posting status writer/reader if present.
- [ ] Register report datasets/providers with item 18 if present:
  - payroll summary
  - employer cost
  - payroll variance
  - payroll tax withheld
  - social security contribution
  - leave balance/usage
  - headcount
- [ ] Add review issues for stale source checksum, missing tax id, unverified rule set, posting error, tax sync error, and social-security config gap.

### Tests

- [ ] Tax event idempotency and grouping by period.
- [ ] 50 ทวิ source totals by employee/tax year.
- [ ] Social security summary totals by period.
- [ ] Posting input balanced and source-ref complete.
- [ ] Posting status update from ledger adapter.
- [ ] Report adapter denies missing source permission.

### Exit Criteria

- Payroll tax/social-security/ledger source facts are reproducible and idempotent.
- Payroll does not own final tax filing or ledger journal generation.
- Reports can consume payroll datasets when item 18 exists.

## Phase 6: Web HR and Payroll Workspace

### Goal

Build usable web screens for HR/payroll workflows.

### Tasks

- [ ] Add web navigation entries according to existing workspace pattern.
- [ ] Build HR employee list/detail/edit screens.
- [ ] Build sensitive sections with masked values and permission states.
- [ ] Build leave request, approval, balance, and policy screens.
- [ ] Build benefit and compensation screens.
- [ ] Build payroll settings screens for profile, pay groups, component definitions, rule sets, and verification status.
- [ ] Build payroll run list/detail screens with line table, components, review issues, totals, lifecycle actions, and stale warnings.
- [ ] Build payslip generation/publication screens.
- [ ] Build payroll compliance screens for ภ.ง.ด.1 source data, social security summary, filing/payment status, and exports.
- [ ] Add loading/error/empty/partial/unavailable states.
- [ ] Keep UI dense, work-focused, and consistent with existing app style.

### Tests

- [ ] Web typecheck.
- [ ] Component tests if framework exists.
- [ ] Manual/Playwright smoke for employee list/detail, leave approval, payroll run lifecycle, payslip, compliance export.
- [ ] Permission-state smoke for sensitive fields hidden/visible.

### Exit Criteria

- User can complete first-pass HR/payroll workflow in web.
- Sensitive data display is gated and polished.
- Payroll finalization/export actions are blocked visibly when review issues exist.

## Phase 7: Notifications, Workflow, LINE, and AI Tools

### Goal

Expose safe reminders, tasks, read-only conversational access, and the narrow LINE leave-request intake.

### Tasks

- [ ] Register dashboard/notification providers for payroll run pending review, pending approval, blocking issue, upcoming pay date, ภ.ง.ด.1 reminder, social security reminder, payslip published, leave submitted, leave approval/rejection, and frequent-leave warning.
- [ ] Add workflow task hooks for payroll approval, review issue, compliance deadline, and leave approval when item 16 exists.
- [ ] Ensure LINE leave request creates a pending web approval ticket/task only; HR/manager approval/rejection stays web/API-owned.
- [ ] Add AI/LINE read tool metadata with required permissions and risk levels.
- [ ] Implement AI/LINE read endpoints/tools for payroll status, own payslip summary, review issue summary, PND1 readiness, social security summary, and team leave pending count.
- [ ] Implement LINE own leave-request intake using existing webhook/account-link/company-context/idempotency patterns.
- [ ] Ensure tools call ERP permission-checked APIs only.
- [ ] Add refusal behavior for mutation and sensitive out-of-scope reads.
- [ ] Add source refs, computedAt, and web deep links.

### Tests

- [ ] Notification payload masking tests.
- [ ] Workflow action creates task/notification only, not final payroll or leave approval mutation.
- [ ] LINE leave request creates only own pending request/ticket and refuses approval/rejection.
- [ ] AI tool permission denial.
- [ ] Employee own payslip allowed only after publish.
- [ ] AI refuses finalize/export/approve/bank/tax mutation.
- [ ] Frequent-leave warning fires at threshold 5 by default and never auto-rejects leave.
- [ ] AI does not reveal another employee salary/payslip without permission/ABAC.

### Exit Criteria

- Payroll reminders/tasks exist without sensitive leakage.
- LINE/AI can answer safe read questions and deep-link to web.
- LINE can create only own pending leave requests; all approval/final/sensitive payroll-HR mutations remain blocked.

## Phase 8: Payslips, Exports, and File Handling

### Goal

Finalize user-facing output files and accountant/HR handoff packages.

### Tasks

- [ ] Implement payslip generation using current PDF/HTML/file primitives.
- [ ] Store payslip checksum, file refs, published status, and viewedAt.
- [ ] Implement payroll summary export: JSON and CSV required.
- [ ] Implement bank review export: masked/review-only, no execution.
- [ ] Implement ภ.ง.ด.1 preparation export from payroll tax events.
- [ ] Implement social security preparation export from social-security events.
- [ ] Implement payroll 50 ทวิ source export or item 11 adapter handoff.
- [ ] Add export expiry and download audit where file primitives support it.
- [ ] Add typed unavailable responses for XLSX/PDF when unsupported.

### Tests

- [ ] Export package metadata includes source checksum, rule set, generatedAt, actor, format, expiry.
- [ ] CSV export totals match payroll run totals.
- [ ] Payslip data matches finalized payroll line.
- [ ] Sensitive export download requires permission and audits.
- [ ] Unsupported XLSX/PDF returns stable `export_format_unavailable` while CSV still works.

### Exit Criteria

- Accountant/HR can export review data.
- Payslips can be generated/published/read by allowed users.
- Export does not imply external filing/submission/payment.

## Phase 9: Hardening, Privacy, and Migration Safety

### Goal

Close payroll-specific security, privacy, and operational risks.

### Tasks

- [ ] Review all API responses for sensitive field leakage.
- [ ] Review audit/outbox/notification/AI payloads for sensitive leakage.
- [ ] Review DB indexes and uniqueness constraints for company/pay group/period/employee.
- [ ] Add or document retention policy hooks for payslip/export/employee attachments.
- [ ] Add seed data guarded for development only.
- [ ] Add migration rollback notes where repo convention supports it.
- [ ] Add manual QA script for owner/admin/HR/finance/accountant/manager/employee/auditor roles.
- [ ] Add docs note for production compliance verification.

### Tests

- [ ] Permission matrix tests where available.
- [ ] Sensitive projection tests.
- [ ] Export download audit test.
- [ ] AI/LINE leakage denial tests.
- [ ] Full typecheck/lint/test/build subset.

### Exit Criteria

- No known sensitive data leak paths.
- Production activation requires verified statutory config.
- Role-based manual QA path is documented.

## Phase 10: Verification, Docs, and Checklist Gate

### Goal

Verify implementation, update docs, and only then close Master Implementation Checklist item 20.

### Tasks

- [ ] Run relevant commands from current scripts:
  - `pnpm --filter @watchdog-bms/contracts typecheck`
  - `pnpm --filter @watchdog-bms/api typecheck`
  - `pnpm --filter @watchdog-bms/web typecheck`
  - `pnpm test`
  - `pnpm lint`
  - `pnpm build`
- [ ] If full repo commands are too slow or blocked, run touched package commands and document why full commands were not run.
- [ ] Verify web manually or with Playwright if UI changed.
- [ ] Record official RD/SSO/labour source checks and accountant/HR reviewer status.
- [ ] Update this plan with implementation notes if scope changed.
- [ ] Update [[specs/permission-matrix|Permission Matrix]] if central permission doc is policy source.
- [ ] Update [[plans/master-implementation-checklist|Master Implementation Checklist]] item 20 checkbox only after all exit criteria pass.
- [ ] Add ADR if implementation introduced new payroll privacy, encryption, export, or compliance architecture decisions.

### Exit Criteria

- All phase exit criteria pass.
- Relevant verification commands are recorded.
- Compliance rule sets are verified or clearly blocked from production activation.
- Master checklist item 20 remains unchecked until implementation and verification are truly complete.

## Risks

- Statutory rules can change. Mitigation: config-driven rule sets with source verification and accountant/HR review.
- Payroll data is highly sensitive. Mitigation: dedicated permissions, masking, audit, export expiry, safe outbox/notification payloads.
- Earlier modules may not expose tax/ledger/report adapters yet. Mitigation: stable source APIs and pending sync statuses.
- Secure bank/tax identifier storage may not exist. Mitigation: masked/last4 only, defer full values.
- Payroll calculation disputes can be costly. Mitigation: deterministic snapshots, checksums, review issues, correction runs, and clear audit.
- AI/LINE could leak sensitive data or overreach from leave intake into approval/payroll actions if scoped poorly. Mitigation: ERP permission-checked APIs only, own-record rules, idempotent LINE intake, sensitive tests, refusal behavior, and web-owned approval.

## Open Questions

- Which official SSO contribution setup applies to target company and employee types for first production year?
- Which leave policies should override statutory minimums for this company?
- Who is payroll compliance reviewer: HR, Accountant, Owner, or external payroll office?
- Should employee self-service beyond own leave request/status and own published payslip be enabled in first pass, or keep HR/Finance-only web access?
- Should first-pass payslip be PDF, HTML snapshot, or both?
- Does item 11 implementation issue employee 50 ทวิ, or should item 20 add a payroll-specific certificate issue path later?

## Review Checklist

- [ ] No statutory rates/caps/deadlines/forms/leave entitlements hard-coded in business logic.
- [ ] Employee salary/tax/bank/payslip/leave-sensitive data masked by default.
- [ ] LINE leave request intake creates only own pending approval ticket, uses linked employee context, and is idempotent.
- [ ] Frequent-leave warning defaults to 5 requests per employee per payroll period/month and is notification-only.
- [ ] Payroll run lifecycle is auditable and locked after finalization.
- [ ] Corrections use adjustment/reversal runs.
- [ ] Tax/social-security/ledger source facts are idempotent and source-linked.
- [ ] LINE/AI are read-only except own leave-request intake, and all access is permission-checked.
- [ ] Exports are audited, scoped, and review-only.
- [ ] Master Implementation Checklist item 20 remains unchecked until verification passes.

## Sonnet 4.6 Implementation Prompt

Implement Master Implementation Checklist item 20: Payroll and HR Compliance.

Read `docs/plans/payroll-hr-compliance-plan.md` and `docs/specs/payroll-hr-compliance-spec.md` first. Then inspect current code because earlier items may already add auth, permissions, Prisma, audit, outbox, attachments, document sequences, ledger source adapters, tax source adapters, report registry, notifications, workflow tasks, AI tools, and web route patterns.

Start with Phase 0 and Phase 1 only unless owner expands scope. Reuse current repo patterns. Keep payroll statutory rules config-driven and verified. Do not hard-code rates/caps/due dates/forms/leave entitlements. Protect all sensitive HR/payroll data. Keep LINE/AI read-only except own leave-request intake that creates only a pending approval ticket. Approval/rejection, payroll, bank, tax, export, and filing actions stay web/API-owned. Default frequent-leave warning threshold is 5 requests per employee per payroll period/month. Keep Master Implementation Checklist item 20 unchecked until all phases and verification pass.
