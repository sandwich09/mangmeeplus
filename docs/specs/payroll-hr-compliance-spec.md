# Payroll and HR Compliance Spec

## 1. Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 20.

Active implementer target: Sonnet 4.6 or later.

This spec is a product and engineering baseline, not legal, tax, payroll, labour, or social-security advice. Before implementation, activation, export, or release, verify current Thai payroll withholding, personal income tax, social security, labour leave, form, filing, and export rules against official agencies and accountant/HR review.

Official source snapshot checked for this handoff on 2026-06-23:

- Revenue Department Personal Income Tax page: https://www.rd.go.th/english/6045.html
- Revenue Department e-filing guidance for ภ.ง.ด.1/3/53 and ภ.พ.30 from [[specs/tax-2026-verified-rules|Thai Tax 2026 Verified Baseline]]
- Thai Tax 2026 working baseline in [[specs/tax-2026-verified-rules|Thai Tax 2026 Verified Baseline]]

The implementer must re-check Social Security Office and labour/leave rules before production activation. Store statutory rates, caps, due dates, form layouts, and leave entitlements as verified configuration rows, never hard-coded business logic.

Linked plan: [[plans/payroll-hr-compliance-plan|Payroll and HR Compliance Plan]]

## 2. Goal

Ship the first trustworthy HR/payroll compliance slice for Thai SMEs:

- Employee master and sensitive employee profile.
- Employment, compensation, bank/payment, tax, social security, and benefit records.
- Monthly payroll preparation, calculation, review, approval, finalization, and correction.
- Payroll withholding tax source events for ภ.ง.ด.1 preparation.
- Social security contribution preparation, reminders, manual filing/payment status, and accountant/HR export.
- Payslip generation and publication.
- Payroll-backed 50 ทวิ support through the item 11 tax certificate workflow.
- Leave policy, leave request, leave balance, unpaid leave adjustment, and benefit deduction records.
- LINE leave request intake for linked employees, creating a web approval ticket for manager/HR review.
- LINE notifications to employees for leave submitted, approved, rejected, and frequent-leave warning events.
- Ledger-ready payroll posting inputs for item 10.
- Reports BI, Dashboard/Notification, Workflow Automation, and read-only AI/LINE hooks.

Item 20 must connect earlier foundations without creating parallel systems. Payroll tax facts flow into item 11. Payroll posting inputs flow into item 10. Reports use item 18 registry/adapters when available. Notifications use item 06. AI/LINE use item 07 and item 17 boundaries.

## 3. Non-goals

- Legal, tax, labour, or HR advice as final authority.
- Auto-filing, auto-submission, or direct mutation of Revenue Department, Social Security Office, bank, or government portals.
- Final bank transfer execution or payroll disbursement through payment rails.
- Full HRIS suite: recruitment, onboarding workflows, performance reviews, disciplinary cases, learning management, org chart modeling, shift scheduling, biometric time attendance, corporate insurance integration, provident fund carrier integration, or employee portal beyond first-pass payslip/leave visibility.
- Multi-country payroll or multi-currency payroll.
- Contractor/vendor payments. Procurement/AP owns supplier payments; payroll may hold contractor-like HR records only if owner creates separate scope.
- Complex overtime/time-clock engine. First pass supports manual/imported payroll adjustment lines with audit trail.
- Automatic tax planning or allowance optimization.
- Replacing item 11 tax filing periods, WHT certificate engine, or tax export package lifecycle.
- Replacing item 10 ledger journal generation, chart of accounts, period close, or financial statements.
- LINE or AI mutation for payroll calculation, approval, finalization, export, leave approval, bank detail change, tax config, or filing status.

## 4. Product Decisions for First Pass

- Web/API own all payroll and HR mutations.
- LINE and AI are read-only for payroll, payroll-sensitive, approval, export, bank, tax, social-security, and filing actions.
- LINE may create only the linked employee's own leave request as `PENDING_APPROVAL` through the same permission-checked leave request use case. Approval/rejection stays web/API-owned.
- Leave request notifications use linked LINE identities when available and web notification fallback otherwise.
- Frequent-leave warning threshold defaults to 5 leave requests per employee per payroll period/month until company policy overrides it.
- Payroll runs are monthly by default.
- Payroll calculation uses versioned `PayrollComplianceRuleSet` rows.
- All statutory values are config-driven with source URL, checked date, reviewer, and status.
- Payroll can produce review JSON, CSV, and PDF/payslip outputs. XLSX uses existing spreadsheet writer when available; otherwise use typed unavailable behavior until dependency policy allows.
- Payroll payment file/export is review-only. It never executes bank transfer.
- Employee full bank account number storage is deferred unless encryption/tokenization primitives exist. Store masked/last4 display data only.
- Employee self-service is limited to own payslip and own leave request/status if auth and web shell support it.
- Payroll 50 ทวิ support means item 20 emits payroll WHT/certificate source data; item 11 remains certificate issue/PDF/export authority unless implementation discovers item 11 explicitly left employee certificates to item 20.

## 4.1 Backlog Notes

Do not build these in the first implementation pass:

- Full employee self-service profile, tax profile, bank profile, or personal-data update flow.
- Payroll 50 ทวิ certificate authority inside payroll when item 11 tax certificate workflow can own certificate issue/PDF/export.
- PDF-first payslip pipeline if current file/PDF tooling is not stable.
- Government portal submission, e-filing, direct RD/SSO mutation, or bank transfer execution.
- Full bank account, national id, or social security number plaintext storage without encryption/tokenization/vault primitives.
- Recruitment, onboarding, performance review, org chart, shift scheduling, biometric time clock, carrier integration, or full HRIS features.
- Complex overtime/time-attendance engine beyond audited manual/imported adjustment lines.
- LINE/AI payroll, leave approval, bank, tax, export, or filing mutation beyond the explicitly allowlisted own leave-request intake.

Recommended follow-up when first pass is stable:

- Confirm payroll compliance reviewer split: `HR` owns employee/leave correctness; `ACCOUNTANT` owns tax/SSO verification.
- Enable employee self-service only for own published payslip and own leave request/status first; add profile/tax/bank change request later with HR approval and audit.
- Start payslip with HTML snapshot plus metadata; add PDF only after attachment/file/PDF rendering pipeline is proven.
- Keep 50 ทวิ certificate issue/PDF/export in item 11; payroll emits employee income/tax source data and yearly source totals.
- Add secure vault/encryption before storing full bank/tax/social-security identifiers.
- Add time attendance, overtime, configurable leave-frequency policies beyond the first default threshold, provident fund/carrier integrations, and bank payment execution only as separate approved scopes.

## 5. User Roles

- Owner: sees payroll totals, employer cost, compliance deadlines, approval state, payroll exceptions, and audit trail.
- Admin: configures HR/payroll settings when granted, without default sensitive salary access unless policy grants it.
- HR: manages employee profiles, employment records, leave, benefits, sensitive documents, and HR compliance exports.
- Finance/Payroll: manages compensation, payroll runs, calculation review, payment preparation, payroll exports, and accountant handoff.
- Accountant: reviews payroll tax, social security, ledger posting status, ภ.ง.ด.1 preparation data, and 50 ทวิ source totals.
- Manager: reviews team leave and payroll-safe headcount summaries where ABAC allows; no salary detail by default.
- Employee: reads own profile subset, own leave balances/requests, and own published payslips where enabled.
- Auditor readonly: reads payroll/HR records, export packages, source refs, posting/tax status, and audit trail without mutation.
- AI assistant user: asks summaries and explanations through permission-checked read tools only.

## 6. Business Workflow

1. Admin/HR configures company payroll profile: payroll calendar, default pay date rule, tax reviewer, social security reviewer, sequence keys, and export policy.
2. Accountant/HR verifies payroll compliance rule set for target tax year/effective dates.
3. HR creates employee profile with employment status, branch, department/team, manager, tax id, social security eligibility, bank display data, and attachments.
4. HR/Payroll creates compensation records and recurring component assignments.
5. HR configures leave policies, benefit plans, and employee benefit enrollments.
6. Employee creates a leave request in web or linked LINE, or HR creates it on the employee's behalf. LINE intake creates only a pending approval ticket with safe notification payloads. Manager/HR approves according to policy in web/API. Approved unpaid leave becomes payroll adjustment candidate.
7. Finance/Payroll creates monthly payroll run for company/branch/pay group.
8. System snapshots active employees, compensation, benefits, leave, prior payroll YTD, rule set version, and selected adjustment/import data.
9. Payroll calculation computes gross pay, taxable income, statutory deductions, social security, other deductions, employer contributions, net pay, tax events, posting input, and review issues.
10. Payroll user resolves blocking review issues: missing tax id, missing SSO status, unverified rules, missing bank display data, negative net pay, duplicate period, missing approval, or closed period conflict.
11. Payroll run is submitted for approval.
12. Owner/Finance/Accountant approves according to threshold/policy and segregation-of-duty rules.
13. Payroll run is finalized. Finalization locks employee payroll snapshots, payslip data, tax/social-security source events, payment instruction preview, export metadata, and posting source input.
14. Payslips are generated and optionally published to employees.
15. Finance exports accountant review data, payroll bank review file, ภ.ง.ด.1 preparation data, social security preparation data, and payroll summary where granted.
16. Accountant/Finance manually updates filing/payment status after external portal action.
17. Corrections after finalization use reversal/adjustment payroll run, not silent mutation.
18. Item 10 generates journals from payroll posting inputs.
19. Item 11 syncs payroll WHT events into payroll tax period/report/certificate preparation.
20. Dashboard/Notification sends deadline reminders, blocking issue alerts, leave approval notifications, and leave-frequency warnings.
21. LINE/AI can summarize status, explain totals, create only own pending leave-request intake, and deep-link to web for review/approval/action.

## 7. Core Business Rules

- Server derives company, user, membership, roles, permissions, ABAC scope, and employee identity from trusted auth context.
- Client-sent company, role, permission, branch, team, manager, employee, and salary scope are hints only.
- Salary, tax id, bank detail, payslip, leave reason, health/benefit attachment, and termination data are sensitive.
- Sensitive fields require dedicated permissions and must not appear in list, audit preview, outbox payload, notification body, or AI answer unless specifically allowed.
- Employee profile edits do not rewrite finalized payroll, payslip, tax, social security, ledger, filing, export, or audit snapshots.
- Employee status changes are effective-dated.
- Compensation changes are effective-dated and audited.
- Payroll period is unique per company/pay group/period key unless correction/reversal mode explicitly allows a linked run.
- Draft payroll run may be recalculated.
- Submitted payroll run cannot be recalculated unless returned to draft with audit reason.
- Finalized payroll run is locked.
- Correction uses adjustment/reversal run linked to original run. Do not edit finalized pay lines silently.
- Payroll finalization checks ledger closed period from item 10 when available.
- Payroll tax/social-security export and filing status checks tax/compliance period close from item 11 when available.
- Payroll statutory rates, caps, brackets, allowances, and due dates are configuration rows with source URL, checkedAt, reviewer, and status.
- Unverified statutory config creates blocking review issue before finalization/export.
- Use decimal-safe math for money, rates, quantities, days, hours, tax, and employer cost. Contracts use strings for money/decimal values.
- Payroll withholding tax is modeled from payment/payroll facts and joins monthly ภ.ง.ด.1 preparation by configured period rule.
- Social security contribution is modeled as separate employee and employer contribution facts.
- Benefits can create taxable earning, non-taxable earning, pre-tax deduction, post-tax deduction, employer contribution, or memo-only line depending on verified config.
- Leave can create payroll adjustment only through approved request/imported adjustment and configured policy.
- LINE leave intake must resolve user, company, active membership, linked employee profile, and `hr.leave.request` permission from server context before creating a request.
- LINE leave intake must create `PENDING_APPROVAL` leave requests only. It must not approve, reject, cancel another user's request, override balance, alter payroll adjustment status, or modify payroll.
- Leave-frequency warning is evaluated when a leave request is submitted or approved. Default policy warns when an employee has at least 5 leave requests in the payroll period/month. The warning is informational and must not auto-reject leave.
- Unpaid leave must be visible as a payroll component with source ref.
- Negative net pay is blocked unless owner-approved special policy exists.
- Overpayment/advance recovery is out of first pass unless modeled as explicit deduction component with source ref and approval.
- Bank payment export is review-only and audited.
- External filing/payment status updates are manual, audited, and evidence-linked.
- LINE/AI are read-only for item 20 except the explicitly allowlisted own leave-request intake.

## 8. Statuses and Enumerations

Employee status:

```text
DRAFT
ACTIVE
ON_LEAVE
SUSPENDED
TERMINATED
ARCHIVED
```

Employment type:

```text
FULL_TIME
PART_TIME
PROBATION
TEMPORARY
INTERN
CONTRACT
OTHER
```

Payroll run status:

```text
DRAFT
CALCULATED
NEEDS_REVIEW
PENDING_APPROVAL
APPROVED
FINALIZED
PAID_MARKED
VOIDED
REVERSED
```

Payroll run type:

```text
REGULAR
OFF_CYCLE
BONUS
ADJUSTMENT
REVERSAL
FINAL_PAY
```

Payroll component kind:

```text
EARNING
DEDUCTION
EMPLOYER_CONTRIBUTION
TAX
MEMO
```

Payroll component category:

```text
BASIC_SALARY
OVERTIME
BONUS
COMMISSION
ALLOWANCE_TAXABLE
ALLOWANCE_NON_TAXABLE
BENEFIT_TAXABLE
BENEFIT_NON_TAXABLE
REIMBURSEMENT_NON_TAXABLE
UNPAID_LEAVE_DEDUCTION
LATE_ABSENCE_DEDUCTION
SOCIAL_SECURITY_EMPLOYEE
SOCIAL_SECURITY_EMPLOYER
PERSONAL_INCOME_TAX_WITHHELD
PROVIDENT_FUND_EMPLOYEE
PROVIDENT_FUND_EMPLOYER
OTHER_EARNING
OTHER_DEDUCTION
OTHER_EMPLOYER_COST
```

Rule set status:

```text
DRAFT
NEEDS_REVIEW
ACTIVE
SUSPENDED
RETIRED
```

Leave request status:

```text
DRAFT
PENDING_APPROVAL
APPROVED
REJECTED
CANCELLED
TAKEN
VOIDED
```

Compliance form type:

```text
PAYROLL_PND1
PAYROLL_PND1_KOR
SOCIAL_SECURITY_MONTHLY
PAYROLL_50_TAWI_SOURCE
PAYSLIP
PAYROLL_BANK_REVIEW_FILE
```

Filing/payment status:

```text
NOT_REQUIRED
NOT_STARTED
PREPARED
SUBMITTED_MANUAL
ACCEPTED_MANUAL
PAID_MANUAL
REJECTED_MANUAL
VOIDED
```

Review issue severity:

```text
INFO
WARNING
BLOCKING
```

## 9. Data Model Draft

Use repo conventions and current Prisma naming when implementation starts. Shape below is required business contract, not exact ORM syntax.

### CompanyPayrollProfile

```text
CompanyPayrollProfile
- id
- companyId unique
- defaultCurrency
- payrollPeriodType: MONTHLY
- defaultPayDateRuleJson
- defaultPayGroupCode
- payrollReviewerUserId nullable
- taxReviewerUserId nullable
- socialSecurityReviewerUserId nullable
- payslipPublishPolicy: MANUAL, ON_FINALIZE, DISABLED
- bankExportPolicy: REVIEW_ONLY, DISABLED
- ruleSetId nullable
- leaveFrequencyWarningThreshold default 5
- leaveFrequencyWarningPeriod: PAYROLL_PERIOD, MONTH
- status: DRAFT, ACTIVE, SUSPENDED
- createdAt
- updatedAt
```

### PayrollRuleSource

```text
PayrollRuleSource
- id
- companyId nullable
- sourceType: RD, SSO, LABOUR, ACCOUNTANT, HR_POLICY, INTERNAL_POLICY, OTHER
- sourceTitle
- sourceUrl nullable
- checkedAt
- checkedByUserId nullable
- note nullable
- createdAt
```

### PayrollComplianceRuleSet

```text
PayrollComplianceRuleSet
- id
- companyId nullable
- taxYear
- name
- effectiveFrom
- effectiveTo nullable
- status: DRAFT, NEEDS_REVIEW, ACTIVE, SUSPENDED, RETIRED
- sourceIds
- configJson
- verifiedByUserId nullable
- verifiedAt nullable
- createdAt
- updatedAt
```

`configJson` must support at minimum:

- PIT bracket table by effective date.
- Employment income deduction/allowance config.
- Payroll withholding method config.
- Social security employee/employer rate and base cap config.
- Eligible/ineligible component tags for tax and social security.
- Form/report due rules.
- Leave statutory floor and company policy overrides.
- Export format version metadata.

### EmployeeProfile

```text
EmployeeProfile
- id
- companyId
- employeeCode
- displayName
- legalName
- preferredName nullable
- branchId nullable
- departmentId nullable
- teamId nullable
- managerEmployeeId nullable
- employmentType
- status
- hireDate
- probationEndDate nullable
- terminationDate nullable
- defaultPayGroupCode
- defaultCurrency
- createdAt
- updatedAt
```

### EmployeeSensitiveProfile

```text
EmployeeSensitiveProfile
- id
- employeeId unique
- nationalIdEncryptedOrMasked nullable
- taxIdMasked nullable
- socialSecurityNumberMasked nullable
- birthDate nullable
- addressSnapshotJson nullable
- emergencyContactJson nullable
- bankAccountDisplayName nullable
- bankName nullable
- bankBranch nullable
- bankAccountMasked nullable
- bankAccountLast4 nullable
- fullBankTokenRef nullable
- personalEmail nullable
- phone nullable
- createdAt
- updatedAt
```

Do not store full national id, social security number, or bank account number in plaintext. If encryption/tokenization does not exist, store masked/last4 display data only.

### EmployeeTaxProfile

```text
EmployeeTaxProfile
- id
- employeeId
- taxYear
- taxResidentStatus: THAI_RESIDENT, NON_RESIDENT, UNKNOWN
- taxIdMasked nullable
- filingStatus nullable
- spouseAllowanceClaimed boolean
- childAllowanceCount integer
- parentAllowanceCount integer
- disabilityAllowanceJson nullable
- insuranceAllowanceJson nullable
- providentFundAllowanceJson nullable
- socialSecurityAllowanceMode
- otherAllowanceJson nullable
- sourceAttachmentIds
- verifiedByUserId nullable
- verifiedAt nullable
- status: DRAFT, NEEDS_REVIEW, VERIFIED, SUSPENDED
- createdAt
- updatedAt
```

### EmployeeSocialSecurityProfile

```text
EmployeeSocialSecurityProfile
- id
- employeeId
- eligible boolean
- registrationStatus: NOT_REGISTERED, REGISTERED, EXEMPT, UNKNOWN
- registrationDate nullable
- ssoBranchCode nullable
- contributionRuleCode nullable
- verifiedByUserId nullable
- verifiedAt nullable
- status
- createdAt
- updatedAt
```

### PayrollComponentDefinition

```text
PayrollComponentDefinition
- id
- companyId
- code
- name
- kind
- category
- taxableTreatment: TAXABLE, NON_TAXABLE, PARTIAL, REVIEW
- socialSecurityTreatment: INCLUDED, EXCLUDED, PARTIAL, REVIEW
- ledgerAccountHint nullable
- recurringAllowed boolean
- employeeEditable boolean
- requiresApproval boolean
- status: ACTIVE, INACTIVE
- createdAt
- updatedAt
```

### EmployeeCompensationAssignment

```text
EmployeeCompensationAssignment
- id
- employeeId
- componentDefinitionId
- amount
- currency
- frequency: MONTHLY, DAILY, HOURLY, ONE_TIME, PER_PAY_RUN
- effectiveFrom
- effectiveTo nullable
- sourceRefType nullable
- sourceRefId nullable
- approvalId nullable
- status: DRAFT, ACTIVE, ENDED, VOIDED
- createdAt
- updatedAt
```

### LeavePolicy

```text
LeavePolicy
- id
- companyId
- leaveTypeCode
- name
- paidMode: PAID, UNPAID, PARTIAL, CONFIGURED
- accrualRuleJson
- carryForwardRuleJson nullable
- statutoryFloorSourceIds
- requiresApproval boolean
- payrollAdjustmentComponentId nullable
- status
- createdAt
- updatedAt
```

### EmployeeLeaveBalance

```text
EmployeeLeaveBalance
- id
- employeeId
- leavePolicyId
- periodKey
- openingAmount
- accruedAmount
- usedAmount
- adjustedAmount
- availableAmount
- unit: DAY, HOUR
- computedAt
- status
```

### LeaveRequest

```text
LeaveRequest
- id
- companyId
- employeeId
- leavePolicyId
- startAt
- endAt
- amount
- unit
- paidModeSnapshot
- reason nullable
- attachmentIds
- status
- sourceChannel: WEB, LINE, IMPORT, API_INTERNAL
- sourceMessageId nullable
- approvalTicketId nullable
- warningStatus: NONE, THRESHOLD_REACHED, NOTIFIED
- requestedByUserId
- approvedByUserId nullable
- approvedAt nullable
- rejectedReason nullable
- payrollAdjustmentStatus: NOT_REQUIRED, PENDING, LINKED, BLOCKED
- payrollRunLineId nullable
- createdAt
- updatedAt
```

### BenefitPlan and EmployeeBenefitEnrollment

```text
BenefitPlan
- id
- companyId
- code
- name
- benefitType: CASH, INSURANCE, PROVIDENT_FUND, MEAL, TRAVEL, OTHER
- payrollComponentDefinitionIds
- taxTreatment
- socialSecurityTreatment
- employerCostMode
- employeeDeductionMode
- status

EmployeeBenefitEnrollment
- id
- employeeId
- benefitPlanId
- effectiveFrom
- effectiveTo nullable
- employeeAmount nullable
- employerAmount nullable
- configJson
- status: ACTIVE, SUSPENDED, ENDED
```

### PayrollRun

```text
PayrollRun
- id
- companyId
- payGroupCode
- periodKey
- periodStart
- periodEnd
- payDate
- runType
- status
- ruleSetId
- currency
- employeeCount
- grossPayTotal
- taxableIncomeTotal
- employeeDeductionTotal
- employerContributionTotal
- pitWithheldTotal
- socialSecurityEmployeeTotal
- socialSecurityEmployerTotal
- netPayTotal
- createdByUserId
- submittedByUserId nullable
- approvedByUserId nullable
- finalizedByUserId nullable
- finalizedAt nullable
- originalRunId nullable
- correctionReason nullable
- createdAt
- updatedAt
```

### PayrollRunLine

```text
PayrollRunLine
- id
- payrollRunId
- employeeId
- employeeSnapshotJson
- taxProfileSnapshotJson
- socialSecurityProfileSnapshotJson
- compensationSnapshotJson
- leaveSnapshotJson
- grossPay
- taxableIncome
- employeeDeductionTotal
- employerContributionTotal
- pitWithheld
- socialSecurityEmployee
- socialSecurityEmployer
- netPay
- paymentStatus: NOT_READY, READY, EXPORTED, MARKED_PAID, BLOCKED
- payslipStatus: NOT_GENERATED, GENERATED, PUBLISHED, VOIDED
- reviewStatus: OK, WARNING, BLOCKED
- sourceChecksum
- createdAt
- updatedAt
```

### PayrollLineComponent

```text
PayrollLineComponent
- id
- payrollRunLineId
- componentDefinitionId
- codeSnapshot
- nameSnapshot
- kind
- category
- amount
- currency
- taxableAmount
- socialSecurityBaseAmount
- quantity nullable
- rate nullable
- sourceRefType nullable
- sourceRefId nullable
- note nullable
```

### PayrollReviewIssue

```text
PayrollReviewIssue
- id
- companyId
- payrollRunId nullable
- payrollRunLineId nullable
- employeeId nullable
- issueType
- severity
- message
- sourceRefType nullable
- sourceRefId nullable
- blocking boolean
- resolvedByUserId nullable
- resolvedAt nullable
- resolutionNote nullable
- createdAt
```

### PayrollTaxEvent

```text
PayrollTaxEvent
- id
- companyId
- payrollRunId
- payrollRunLineId
- employeeId
- taxType: PIT
- formType: PAYROLL_PND1
- periodKey
- paymentDate
- employeeTaxIdMasked nullable
- grossIncome
- taxableIncome
- taxWithheld
- ruleSetId
- certificateSourceStatus: NOT_READY, READY, SYNCED, BLOCKED
- taxSyncStatus: PENDING, SYNCED, ERROR, NOT_REQUIRED
- sourceChecksum
- createdAt
```

### PayrollSocialSecurityEvent

```text
PayrollSocialSecurityEvent
- id
- companyId
- payrollRunId
- payrollRunLineId
- employeeId
- periodKey
- contributionBase
- employeeContribution
- employerContribution
- ruleSetId
- filingStatus
- paymentStatus
- sourceChecksum
- createdAt
```

### PayrollPostingInput

```text
PayrollPostingInput
- id
- companyId
- payrollRunId
- postingDate
- sourceStatus: PENDING, POSTED, POSTING_ERROR, REVERSED, NOT_REQUIRED
- postingMode: ACCRUAL_ON_FINALIZE, PAYMENT_ON_PAY_DATE, CONFIGURED
- linesJson
- ledgerJournalId nullable
- lastError nullable
- createdAt
- updatedAt
```

Minimum posting line roles:

```text
SALARY_EXPENSE
EMPLOYER_SOCIAL_SECURITY_EXPENSE
BENEFIT_EXPENSE
SALARY_PAYABLE
PIT_WITHHOLDING_PAYABLE
SOCIAL_SECURITY_PAYABLE
OTHER_DEDUCTION_PAYABLE
CASH_OR_BANK_CLEARING
```

### PayrollExportPackage

```text
PayrollExportPackage
- id
- companyId
- payrollRunId nullable
- periodKey nullable
- formType
- format: JSON, CSV, XLSX, PDF
- status: QUEUED, READY, FAILED, EXPIRED, VOIDED
- fileRefId nullable
- checksum nullable
- generatedByUserId
- generatedAt
- expiresAt nullable
- sourceRuleSetId nullable
- sourceChecksum
- note nullable
```

### Payslip

```text
Payslip
- id
- payrollRunLineId unique
- employeeId
- payrollRunId
- periodKey
- status: GENERATED, PUBLISHED, VOIDED
- pdfFileRefId nullable
- htmlSnapshotFileRefId nullable
- publishedAt nullable
- viewedAt nullable
- checksum
- createdAt
```

## 10. Calculation Rules

Implementation should build pure domain calculators before API/UI:

- `calculatePayrollRun`
- `calculateEmployeePayrollLine`
- `calculateTaxableIncome`
- `calculatePitWithholding`
- `calculateSocialSecurityContribution`
- `calculateNetPay`
- `calculateEmployerCost`
- `calculateLeaveAdjustment`
- `buildPayrollPostingInput`
- `buildPayrollTaxEvent`
- `buildPayrollSocialSecurityEvent`
- `buildPayrollReviewIssues`

Rules:

- Inputs and outputs use decimal strings.
- Calculators accept rule set snapshot; they do not query database directly.
- Calculator output includes formula/version metadata and source refs.
- Missing required config returns review issue, not guessed value.
- Employee-specific missing tax allowance data uses configured fallback only when accountant-approved; otherwise create review issue.
- Payroll withholding method must be configurable. A common method can project annual income, deduct allowances/deductions, apply PIT brackets, subtract year-to-date withholding, and allocate remaining tax across remaining payroll periods, but activation requires accountant/RD verification.
- Social security contribution base, rates, caps, eligibility, and included components are config-driven.
- Rounding mode is config-driven and recorded in rule set.
- Recalculation must be deterministic for same inputs/rule set.
- Finalized run stores snapshots and checksums.

## 11. Tax and Compliance Integration

Payroll owns source facts:

- Payroll income by employee.
- Payroll PIT withheld by employee/payment period.
- Employee tax profile snapshot.
- Payroll 50 ทวิ source totals.
- Payroll social security contribution facts.
- Payroll compliance review issues.

Thai Tax item 11 owns:

- Tax periods.
- Filing package lifecycle.
- WHT/tax certificate issue/PDF/export flow unless item 11 implementation explicitly delegates employee certificates.
- Filing status model when already present.
- Tax AI behavior and tax report screens beyond payroll-specific prep.

Integration requirements:

- Payroll emits `PAYROLL_PND1` source tax events.
- Payroll can expose `PAYROLL_50_TAWI_SOURCE` summary by employee/tax year.
- Tax sync is idempotent by company, payrollRunLine, tax type, form type, period key, and source checksum.
- Payroll export does not mark tax filing as accepted.
- Filing/payment status update stores actor, timestamp, source, evidence ref, and audit.
- Missing tax id, unverified rule set, inconsistent totals, stale source checksum, or filed/closed period conflict creates review issue.

## 12. Ledger Integration

Item 10 owns journal generation and period close. Item 20 provides source posting input.

Default payroll posting intent:

```text
Dr Salary Expense
Dr Employer Social Security Expense
Dr Benefit Expense where employer-paid
Cr Salary Payable or Cash/Bank Clearing
Cr PIT Withholding Payable
Cr Social Security Payable
Cr Other Deduction Payable
```

Rules:

- Payroll source posting input is generated only for finalized payroll runs.
- Draft/submitted runs use posting status `not_required`.
- Finalized runs use posting status `pending`.
- Item 10 may update posting status to `posted`, `posting_error`, or `reversed`.
- Closed accounting period blocks finalize, void, reversal, or correction unless item 10 exposes allowed adjustment workflow.
- Posting input must contain source refs down to payroll run and line/component where useful.

## 13. Reports, Dashboard, Workflow, and Notification

Reports BI after item 20 can register:

- Payroll summary by period.
- Employer cost by department/branch.
- Payroll variance vs previous period.
- Payroll tax withheld by period.
- Social security contribution by period.
- Leave balance and leave usage.
- Headcount by status/department/branch.

Dashboard/Notification can show:

- Payroll run pending review/approval.
- Blocking payroll issues.
- Upcoming payroll date.
- ภ.ง.ด.1 preparation reminder.
- Social security preparation/payment reminder.
- Payslip published notification.
- Leave approval notification.
- Leave request received from LINE notification to employee.
- Leave request pending approval ticket/notification to manager/HR.
- Frequent-leave warning notification when employee leave request count reaches the configured threshold, default 5 per payroll period/month.

Workflow Automation can trigger:

- Payroll approval task after submit.
- Review issue task for blocking payroll issue.
- Deadline reminder tasks.
- Leave approval tasks.
- LINE leave request approval tasks for manager/HR.

Workflow must not auto-finalize payroll, auto-export sensitive files, auto-submit government forms, or auto-execute bank transfers.

## 14. API Behavior

Route bases:

```text
/v1/companies/:companyId/hr
/v1/companies/:companyId/payroll
```

All routes require server-derived company membership and permission metadata.

Employee and HR:

- `GET /v1/companies/:companyId/hr/employees`
  - Permission: `hr.employee.read`
  - Returns filtered employee list with no sensitive salary/bank/tax values unless specific permission exists.
- `POST /v1/companies/:companyId/hr/employees`
  - Permission: `hr.employee.manage`
  - Creates draft/active employee with audit.
- `GET /v1/companies/:companyId/hr/employees/:employeeId`
  - Permission: `hr.employee.read`; sensitive sections require `hr.employee.sensitive.read`.
- `PATCH /v1/companies/:companyId/hr/employees/:employeeId`
  - Permission: `hr.employee.manage`
  - Updates profile with effective-date/audit requirements.
- `GET /v1/companies/:companyId/hr/employees/:employeeId/bank`
  - Permission: `hr.employee.bank.read`
  - Returns masked/tokenized data only unless secure vault support exists.
- `PATCH /v1/companies/:companyId/hr/employees/:employeeId/bank`
  - Permission: `hr.employee.bank.manage`
  - Updates bank display/token ref with audit.
- `GET /v1/companies/:companyId/hr/leave/requests`
  - Permission: `hr.leave.read`
- `POST /v1/companies/:companyId/hr/leave/requests`
  - Permission: `hr.leave.request`; LINE webhook uses the same use case with `sourceChannel=LINE` after server-side linked-employee resolution.
- `POST /v1/companies/:companyId/hr/leave/requests/:requestId/approve`
  - Permission: `hr.leave.approve`
- `POST /v1/companies/:companyId/hr/leave/requests/:requestId/reject`
  - Permission: `hr.leave.approve`
- `GET /v1/companies/:companyId/hr/leave/balances`
  - Permission: `hr.leave.read`
- `POST /v1/companies/:companyId/hr/benefits/enrollments`
  - Permission: `hr.benefit.manage`

Payroll configuration:

- `GET /v1/companies/:companyId/payroll/profile`
  - Permission: `payroll.profile.read`
- `PATCH /v1/companies/:companyId/payroll/profile`
  - Permission: `payroll.profile.manage`
- `GET /v1/companies/:companyId/payroll/rule-sets`
  - Permission: `payroll.compliance.read`
- `POST /v1/companies/:companyId/payroll/rule-sets`
  - Permission: `payroll.compliance.manage`
- `POST /v1/companies/:companyId/payroll/rule-sets/:ruleSetId/verify`
  - Permission: `payroll.compliance.verify`

Payroll runs:

- `GET /v1/companies/:companyId/payroll/runs`
  - Permission: `payroll.run.read`
- `POST /v1/companies/:companyId/payroll/runs`
  - Permission: `payroll.run.create`
- `GET /v1/companies/:companyId/payroll/runs/:runId`
  - Permission: `payroll.run.read`
- `PATCH /v1/companies/:companyId/payroll/runs/:runId`
  - Permission: `payroll.run.update`
- `POST /v1/companies/:companyId/payroll/runs/:runId/calculate`
  - Permission: `payroll.run.calculate`
- `POST /v1/companies/:companyId/payroll/runs/:runId/submit`
  - Permission: `payroll.run.submit`
- `POST /v1/companies/:companyId/payroll/runs/:runId/approve`
  - Permission: `payroll.run.approve`
- `POST /v1/companies/:companyId/payroll/runs/:runId/finalize`
  - Permission: `payroll.run.finalize`
- `POST /v1/companies/:companyId/payroll/runs/:runId/void`
  - Permission: `payroll.run.void`
- `POST /v1/companies/:companyId/payroll/runs/:runId/reversal`
  - Permission: `payroll.run.void`

Payslips and exports:

- `POST /v1/companies/:companyId/payroll/runs/:runId/payslips/generate`
  - Permission: `payroll.payslip.generate`
- `POST /v1/companies/:companyId/payroll/runs/:runId/payslips/publish`
  - Permission: `payroll.payslip.publish`
- `GET /v1/companies/:companyId/payroll/payslips/:payslipId`
  - Permission: `payroll.payslip.read`; employee can read own only when policy enables.
- `POST /v1/companies/:companyId/payroll/runs/:runId/exports`
  - Permission depends on export type:
    - `payroll.report.export`
    - `payroll.payment.export`
    - `payroll.tax.export`
    - `payroll.sso.export`
- `GET /v1/companies/:companyId/payroll/exports/:exportId`
  - Same read/export permission as creation.

Compliance:

- `GET /v1/companies/:companyId/payroll/tax/pnd1`
  - Permission: `payroll.tax.read`
- `GET /v1/companies/:companyId/payroll/tax/50-tawi-source`
  - Permission: `payroll.tax.read`
- `GET /v1/companies/:companyId/payroll/social-security`
  - Permission: `payroll.sso.read`
- `PATCH /v1/companies/:companyId/payroll/compliance-periods/:periodId/status`
  - Permission: `payroll.compliance.manage`

## 15. API Response and Error Behavior

- Missing auth returns `401`.
- Missing membership, permission, or ABAC scope returns `403`.
- Missing employee/run/export returns `404` without leaking existence across company.
- Duplicate payroll period returns `409 payroll_period_already_exists`.
- Finalized run mutation returns `409 payroll_run_locked`.
- Closed accounting/tax/compliance period returns `409 closed_period`.
- Unverified rule set returns `422 payroll_rules_unverified`.
- Missing sensitive config returns `422 payroll_config_missing`.
- Negative net pay returns `422 payroll_negative_net_pay`.
- Invalid decimal or totals mismatch returns `422 payroll_total_mismatch`.
- Export format unsupported returns `422 export_format_unavailable`.
- Attempted LINE/AI mutation returns `403 ai_payroll_mutation_forbidden`.
- LINE leave request without linked active employee profile returns `403 line_hr_employee_context_required`.
- LINE leave request approval/rejection attempt returns `403 line_leave_approval_forbidden`.

Every error should include stable `code`, user-safe `message`, and optional `fieldErrors`.

## 16. Web UX

First-pass web routes should fit existing full workspace patterns:

- HR employee list: filters by status, branch, department, pay group; sensitive columns hidden by default.
- Employee detail: profile, employment, compensation, tax, social security, bank display, leave, benefits, documents, audit.
- Leave workspace: request list, calendar/list view, approvals, balances, policy setup.
- Payroll dashboard: current period state, deadlines, approval state, review issues, totals, employer cost, export status.
- Payroll run list and detail: employee lines, components, review issues, recalculation, submit, approve, finalize, correction.
- Payslip list/detail: generation, publication, employee access state.
- Compliance workspace: ภ.ง.ด.1 prep data, social security prep data, filing/payment status, evidence links, exports.
- Payroll settings: pay calendar, pay groups, component definitions, rule sets, leave policies, benefit plans.

UX rules:

- Never show salary/tax/bank/payslip detail to users without specific permissions.
- Sensitive table cells should show masked value or unavailable state.
- All high-risk actions require confirmation and reason when needed.
- Finalize/void/reversal/export buttons show blocking review issues before action.
- Every export shows data scope, generatedAt, source rule set, checksum, expiry, and audit status.
- Empty/missing-module states must be explicit, not fake zero.

## 17. LINE and AI Behavior

Allowed read intents through permission-checked tools:

- "เดือนนี้ payroll ถึงขั้นไหนแล้ว"
- "มี payroll issue อะไรต้องแก้"
- "ยอด payroll เดือนนี้เท่าไหร่" for users with payroll summary permission.
- "เงินเดือนสุทธิของฉันเดือนนี้เท่าไหร่" for employee own published payslip only.
- "มีพนักงานขาด tax id หรือ SSO info ไหม"
- "ภ.ง.ด.1 เดือนนี้พร้อมไหม"
- "ประกันสังคมเดือนนี้ยอดเท่าไหร่"
- "ใบลาของทีมรออนุมัติกี่ใบ" for managers with scoped leave read/approve.

Allowed LINE intake intent:

- Employee says they want to take leave with enough date/type context. System creates only that employee's own `PENDING_APPROVAL` leave request/ticket through `hr.leave.request`, replies with request status and web link, and notifies manager/HR for approval.

AI/LINE must:

- Use permission-checked ERP APIs/tools only.
- Cite source refs and computedAt.
- Say when data is missing, blocked by permission, or not implemented.
- Provide web deep links for review/approval/export.
- Notify the employee through LINE when leave is submitted, approved, rejected, or reaches the frequent-leave warning threshold, without exposing sensitive leave reason in push payloads.
- Refuse mutation requests.
- Avoid exposing employee salary, tax id, bank, leave reason, health/benefit info, or payslip details beyond allowed scope.

AI/LINE must not:

- Calculate/finalize/approve payroll.
- Approve/reject leave.
- Create leave requests for another employee or edit/cancel/override an existing leave request from LINE.
- Generate or download sensitive exports.
- Change employee bank/tax/social-security data.
- Mark filing or payment status.
- Submit to RD/SSO/bank.

## 18. Permission Keys

Add or map these permissions:

```text
hr.employee.read
hr.employee.manage
hr.employee.sensitive.read
hr.employee.bank.read
hr.employee.bank.manage
hr.leave.read
hr.leave.request
hr.leave.manage
hr.leave.approve
hr.leave.warning.read
hr.leave.warning.manage
hr.benefit.read
hr.benefit.manage
payroll.profile.read
payroll.profile.manage
payroll.component.read
payroll.component.manage
payroll.compliance.read
payroll.compliance.manage
payroll.compliance.verify
payroll.run.read
payroll.run.create
payroll.run.update
payroll.run.calculate
payroll.run.submit
payroll.run.approve
payroll.run.finalize
payroll.run.void
payroll.payslip.read
payroll.payslip.generate
payroll.payslip.publish
payroll.payment.read
payroll.payment.export
payroll.tax.read
payroll.tax.export
payroll.sso.read
payroll.sso.export
payroll.report.read
payroll.report.export
payroll.ai.read
```

Default grants:

```text
OWNER: all HR and payroll permissions
ADMIN: HR/payroll profile/component/policy manage, employee read/manage, no bank/tax/salary detail unless granted
HR: employee manage, sensitive read, leave/benefit manage, leave warning read/manage, payroll read, payslip read, compliance read
FINANCE: payroll run/component/payment/tax/sso/report manage/export, employee payroll-relevant read
ACCOUNTANT: payroll tax/sso/report read/export, compliance verify/manage, posting/tax exception review
MANAGER: leave read/approve and warning read for scoped team, employee read limited to team safe fields, payroll summary only when granted
EMPLOYEE: own safe profile read, own leave request/read, own published payslip read when self-service enabled
AUDITOR_READONLY: read/export where granted, no mutation
SALES, INVENTORY, MARKETING, STAFF: no HR/payroll permissions by default beyond own employee self-service if enabled
```

Server-side ABAC must restrict company, branch, department/team, manager scope, own employee record, pay group, and sensitive field access.

## 19. Audit Actions

Audit successful and denied high-risk actions where primitives exist:

```text
hr.employee.create
hr.employee.update
hr.employee.sensitive.read
hr.employee.bank.read
hr.employee.bank.update
hr.leave.request
hr.leave.approve
hr.leave.reject
hr.leave.warning_threshold_reached
hr.benefit.enroll
payroll.rule_set.create
payroll.rule_set.verify
payroll.component.create
payroll.component.update
payroll.run.create
payroll.run.calculate
payroll.run.submit
payroll.run.approve
payroll.run.finalize
payroll.run.void
payroll.run.reversal
payroll.payslip.generate
payroll.payslip.publish
payroll.export.create
payroll.export.download
payroll.compliance.status_update
payroll.ai_tool.read_sensitive
```

Audit payloads must mask salary line details, tax id, bank account, and personal identifiers unless audit viewer has sensitive permission. Store source ids/checksums for traceability.

## 20. Events and Outbox

Publish outbox events when primitives exist:

```text
hr.employee.created
hr.employee.updated
hr.leave.requested
hr.leave.approved
hr.leave.rejected
hr.leave.warning_threshold_reached
payroll.run.created
payroll.run.calculated
payroll.run.needs_review
payroll.run.submitted
payroll.run.approved
payroll.run.finalized
payroll.run.voided
payroll.payslip.generated
payroll.payslip.published
payroll.export.ready
payroll.compliance.deadline_due
payroll.review_issue.created
```

Outbox payloads must not include raw salary/tax/bank/payslip detail unless event channel is explicitly sensitive and access-controlled.

## 21. Edge Cases

- Employee hired mid-period: prorate only according to configured policy; otherwise require manual adjustment.
- Employee terminated mid-period: final pay run must include termination date and review issue if final-pay policy absent.
- Employee without tax id: block tax export/finalize unless verified policy allows temporary placeholder.
- Employee not eligible for social security: require reason/status.
- Duplicate employee code: block within company.
- Duplicate payroll run period: block unless correction/reversal run type.
- Compensation changed after draft run calculation: mark run stale and require recalculation.
- Rule set changed after calculation: mark run stale and require recalculation.
- Leave approved after calculation: mark run stale if it affects payroll period.
- Leave request count reaches configured warning threshold: send informational LINE/web notification to employee and HR/manager without blocking request or exposing sensitive reason.
- Duplicate LINE webhook/message id for leave request: do not create duplicate request; reply with the existing request/ticket status where safe.
- Negative net pay: block by default.
- Unverified statutory config: block finalization/export.
- Closed accounting period: block finalization/correction unless allowed adjustment flow.
- Filed/accepted compliance period: block source mutation; require adjustment/amended flow.
- Missing spreadsheet dependency: CSV remains available; XLSX returns typed unavailable.
- AI asked for another employee payslip: refuse unless user has permission and ABAC scope.

## 22. Acceptance Criteria

- [ ] Employee master supports profile, sensitive data, employment status, branch/team/manager, tax, social security, bank display, leave, benefit, and audit records.
- [ ] Sensitive employee/payroll fields are protected by dedicated permissions and do not leak through lists, notifications, audit previews, outbox, LINE, or AI.
- [ ] Payroll rule sets are versioned, verified, source-linked, and config-driven.
- [ ] Monthly payroll run can snapshot employees/components/leave/benefits, calculate deterministic totals, create review issues, submit, approve, finalize, and lock.
- [ ] Finalized payroll produces payslip records, payroll tax events, social security events, export package metadata, and ledger posting inputs.
- [ ] Payroll corrections use reversal/adjustment run, not silent finalized-run edits.
- [ ] Payroll WHT/ภ.ง.ด.1 source data is idempotent and sync-ready for item 11.
- [ ] Social security prep data/reminders/status are audit-visible and exportable for accountant/HR review.
- [ ] Payroll posting inputs map salary, employer contributions, PIT withheld, SSO payable, deductions, and salary payable/cash clearing for item 10.
- [ ] Leave request/balance workflow supports employee request, manager/HR approval, unpaid leave payroll adjustment candidate, and audit.
- [ ] Linked employee can request leave from LINE, creating only their own pending approval ticket with idempotency and web approval link.
- [ ] Leave approval/rejection and frequent-leave warning notifications can be delivered through LINE/web without leaking sensitive leave reason.
- [ ] Web screens cover employee, leave, payroll run, payslip, compliance, export, and settings workflows.
- [ ] LINE/AI read tools are permission-checked, cite sources, deep-link to web, and refuse mutation/sensitive leakage.
- [ ] Master Implementation Checklist item 20 remains unchecked until all implementation phases and verification pass.

## 23. Test Cases

Unit/domain:

- Payroll calculator handles salary, taxable allowance, non-taxable allowance, unpaid leave deduction, employee deduction, employer contribution, PIT withheld, SSO employee/employer, net pay, and employer cost.
- Decimal math avoids floating-point drift.
- PIT withholding returns blocking issue when rule set is unverified or employee tax profile is incomplete.
- SSO calculation uses configured cap/rate/component eligibility.
- Leave balance calculation handles accrual, taken leave, cancellation, and unpaid leave source refs.
- Posting input balances debit/credit totals.

Integration/API:

- Permission denial for sensitive employee, bank, payroll run, payslip, export, compliance status, and finalize routes.
- Payroll run create/calculate/submit/approve/finalize lifecycle.
- Duplicate period conflict.
- Finalized run mutation blocked.
- Stale run requires recalculation after compensation/rule/leave change.
- Export creates package metadata and audit event.
- Tax event sync idempotency key prevents duplicates.
- Closed period blocks finalization/correction.

UI:

- Employee list hides salary/bank/tax fields without permission.
- Payroll run detail shows review issues and disables finalize when blocking.
- Payslip publish flow shows state and permission gate.
- Compliance screen shows source refs, rule set, export status, and filing/payment status.
- Leave approval works for scoped manager and denies out-of-scope manager.

AI/LINE:

- Employee can read own published payslip summary only.
- Manager can read team leave pending count only within scope.
- Linked employee can create own LINE leave request only, receives submitted/approved/rejected notification, and duplicate LINE event does not create duplicate leave.
- Frequent-leave warning fires when request count reaches the configured threshold, default 5, and does not auto-reject.
- User without payroll permission gets refusal without data leak.
- AI refuses payroll finalize/export/bank/tax mutation and LINE leave approval/rejection mutation.

Security/privacy:

- Audit/outbox/notification payloads mask sensitive values.
- Sensitive export download is permission-checked and audited.
- Bank/tax identifiers are not stored in plaintext when vault/encryption is absent.

## 24. Implementation Handoff Checklist

- [ ] Read [[plans/master-implementation-checklist|Master Implementation Checklist]] item 20.
- [ ] Read [[plans/payroll-hr-compliance-plan|Payroll and HR Compliance Plan]].
- [ ] Read [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]] and [[specs/tax-2026-verified-rules|Thai Tax 2026 Verified Baseline]] for payroll tax source-event rules.
- [ ] Read [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Closing Spec]] for source posting adapter and closed-period policy.
- [ ] Read [[specs/reports-bi-spec|Reports BI Spec]] for report adapter registration when item 18 exists.
- [ ] Read [[specs/dashboard-notification-spec|Dashboard and Notification Spec]] for reminders.
- [ ] Read [[specs/workflow-automation-spec|Workflow Automation Spec]] for approval/review tasks.
- [ ] Read [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]] and [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]] before AI/LINE work.
- [ ] Read [[specs/permission-matrix|Permission Matrix]] and extend it if implementation policy requires central registration.
- [ ] Read backend/frontend/security guidelines.
- [ ] Re-check current RD, SSO, and labour rules before enabling statutory calculations/exports.
- [ ] Implement one phase from the plan at a time.
- [ ] Keep item 20 unchecked until verification commands pass and docs record implementation status.

## 25. Sonnet 4.6 Prompt

Implement Master Implementation Checklist item 20: Payroll and HR Compliance.

Start by reading `docs/plans/payroll-hr-compliance-plan.md` and `docs/specs/payroll-hr-compliance-spec.md`. Then inspect current code because earlier roadmap items may already add Prisma, auth, audit, outbox, document sequence, attachment storage, tax adapters, ledger source posting adapters, reports registry, notifications, workflow, AI tools, and web route patterns.

Implement Phase 0 and Phase 1 first unless owner explicitly expands scope. Use current repo conventions. Do not hard-code statutory rates, caps, due dates, form layouts, or leave entitlements. Keep payroll/HR sensitive data permission-protected, audited, source-linked, config-driven, and web-first. Keep LINE/AI read-only except the explicitly allowlisted own leave-request intake that creates only a pending approval ticket; approval/rejection stays web/API-owned. Default frequent-leave warning threshold is 5 requests per employee per payroll period/month until company policy overrides it. Keep Master Implementation Checklist item 20 unchecked until all phases and verification pass.
