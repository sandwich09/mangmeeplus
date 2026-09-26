# Permission Matrix

## 1. Goal

Define default role permissions for WatchDog-BMS so web, LINE AI assistant, backend, AI Gateway, and workflow automation share one access model.

## 2. Permission Principles

- Deny by default.
- Tenant boundary is always company/workspace.
- Role grants module-level capability; ownership rules narrow record access.
- Sensitive actions require audit.
- High-risk actions require approval or extra permission.
- AI tools inherit the exact permissions of the requesting user.
- LINE may expose AI answers, summaries, alerts, and web links only when role and record policy allow them.

## 3. Default Roles

- OWNER: business owner / super admin.
- ADMIN: system and master-data admin.
- MANAGER: approval and team oversight.
- SALES: customer, pipeline, quotation draft.
- INVENTORY: stock receive, issue, transfer, count.
- FINANCE: invoices, payments, expenses, tax prep.
- ACCOUNTANT: GL, journal, tax report review, period close.
- MARKETING: campaigns, platform summaries, AI marketing drafts.
- STAFF: requester for reimbursement and own tasks.
- AUDITOR_READONLY: read-only audit/report role.

## 4. Permission Legend

- `none`: no access.
- `own`: own or assigned records only.
- `team`: own team or assigned group.
- `read`: read all company records in module.
- `write`: create/update non-locked records.
- `approve`: approve/reject within policy.
- `admin`: configure module or perform sensitive action.

## 5. Module Matrix

| Module | OWNER | ADMIN | MANAGER | SALES | INVENTORY | FINANCE | ACCOUNTANT | MARKETING | STAFF | AUDITOR_READONLY |
|---|---|---|---|---|---|---|---|---|---|---|
| Users/Roles | admin | admin | none | none | none | none | none | none | none | read |
| Company setup | admin | admin | read | none | none | read | read | none | none | read |
| Company package and billing | admin | none | none | none | none | none | none | none | none | none |
| Products | admin | write | read | read | read | read | read | read | none | read |
| Inventory movement | admin | read | read | none | write | read | read | none | none | read |
| Stock count | admin | read | read | none | write | read | read | none | none | read |
| CRM customers | admin | write | assigned | own/assigned | none | accounting/contact fields | accounting/contact fields | pseudonymous fields | none | full read |
| Sales pipeline | admin | write | team | own | none | read | read | read | none | read |
| Quotation draft | admin | write | approve | write | none | read | read | read | none | read |
| Invoice/receipt | admin | read | read | own | none | write | read | none | none | read |
| Payments | admin | read | read | own summary | none | write | read | none | none | read |
| Expenses | admin | write | approve | own | own | write | read | none | own | read |
| Reimbursement | admin | read | approve | own | own | write | read | none | own | read |
| HR/Leave | admin | admin | team approve | none | none | payroll-related read | compliance read | none | own request | read |
| Payroll | admin | setup read | summary when granted | none | none | write/export | compliance admin | none | own payslip | read |
| Fixed assets | admin | setup read | approve/read | none | location read | write | admin | none | own assigned read | read |
| Tax reports | admin | none | summary | none | none | write | admin | none | none | read |
| GL/journal/closing | admin | none | none | none | none | write | admin | none | none | read |
| Dashboard | admin | read | team | own/team | own/stock | finance | finance | marketing | own | read |
| Notifications | admin | admin | team | own | own | own | own | own | own | read |
| Workflow rules | admin | admin | none | none | none | none | none | none | none | read |
| AI draft/suggestions | admin | admin | team | own sales | inventory | finance | accounting/tax | marketing-safe | own | read |
| Marketing drafts | admin | read | approve | read | stock warning | none | none | write | none | read |
| Marketplace connection | admin | admin | read | read | read | finance read | read | read | none | read |
| Audit log | admin | read | team | own | own | finance | read | own | own | read |
| AI chat | admin | read per role | team per role | own sales | inventory | finance | accounting/tax | marketing | own | read-only |

The package row shows default grants. The OWNER may add `company.plan.manage` to a custom role and assign that role to a member; the role name does not change access. ADMIN has no package grant by default and cannot grant or assign this permission. Company identity and VAT editing keep their own permissions.

## 5.0 Employee Access and Role Management Permission Keys

Use these keys for item 10C:

```text
access.employee.read
access.employee.create
access.employee.update
access.employee.disable
access.employee.credential.issue
access.employee.line_link.issue
access.employee.line_link.revoke
access.role.read
access.role.manage
access.role.operational.assign
access.role.financial.assign
access.permission.read
```

Pre-v5 Tax-only baseline grants (the v5 expansion below is authoritative for new keys):

```text
OWNER: all employee access and role permissions, including access.role.financial.assign
ADMIN: access.employee.read, access.employee.create, access.employee.update, access.employee.disable, access.employee.credential.issue, access.employee.line_link.issue, access.employee.line_link.revoke, access.role.read, access.permission.read, except protected OWNER/system-role changes — NOT access.role.manage by default (team decision 2026-07-28: role management is owner-delegated via a custom role; see auth-authorization-rbac-spec.md §8.1)
HR: STAFF baseline plus access.employee.read/create/update/disable, access.role.read, and access.role.operational.assign; no credential reissue, role management, finance/accounting/audit, or permission-catalog access
MANAGER: access.employee.read where ABAC allows team scope
AUDITOR_READONLY: access.employee.read, access.role.read, access.permission.read for audit-safe masked data
SALES, INVENTORY, FINANCE, ACCOUNTANT, MARKETING, STAFF: no employee/role mutation permissions by default
```

Rules:

- Role/permission mutation is web/API only and always audited.
- Employee role assignment is limited to roles whose permissions are a subset of the granter's effective permissions; self-role mutation is denied.
- `access.role.operational.assign` is owner-gated and lets HR assign only `MANAGER`, `SALES`, `INVENTORY`, `MARKETING`, and `STAFF`; it does not bypass the denylist for owner/platform roles and cannot assign HR, privileged, finance/accounting/audit, or custom roles.
- `FINANCE` and `ACCOUNTANT` role assignment requires the OWNER-only `access.role.financial.assign` step-up permission.
- LINE/AI must refuse user, password, employee-status, role, permission, and account-link-token mutation requests.
- Protected system roles cannot be deleted, renamed by key, or weakened through customer UI.
- Last active `OWNER` membership cannot be disabled, demoted, or stripped of owner-level access.
- Employee ID/passport values are masked by default and require encrypted/vault storage for full value.
- QR/account-link tokens must be short-lived, single-use, and must not contain a password or static permission snapshot.

Deferred individual-permission authoring note (owner clarification 2026-07-15):

- The current Settings permission matrix is a read-only projection of `RolePermission`; protected system roles are reconciled from the code registry into the database, while company custom roles are edited through the role builder.
- The current "สิทธิ์เฉพาะบุคคล" switches are not an authorization write path. Keep them disabled until a real membership-level override model, API, audit trail, entitlement filter, granter-scope ceiling, protected-role/last-owner guards, and runtime resolution exist.
- When that write path is implemented, do not let the generic `ค่าใช้จ่าย+ใบเสร็จ` menu toggle hide channel-specific meaning. The UI must explicitly show whether a person can report their own expense through LINE (`expense.receipt.line_upload`), upload through web (`expense.receipt.upload`), create/edit an own draft, review, confirm, pay, or void. Web and LINE must consume the same effective permission result.
- Until then, `expense.receipt.line_upload` for protected system roles is changed through the canonical role registry plus permission sync, not through a local-only UI switch.

## 5.1 Ledger Permission Keys

Use these keys for Double-Entry Ledger and Period Closing:

```text
ledger.account.read
ledger.account.manage
ledger.journal.read
journal.entry.create
journal.entry.post
journal.entry.reverse
ledger.posting-rule.read
ledger.posting-rule.manage
ledger.report.read
ledger.period.read
ledger.period.close
ledger.period.unclose
ledger.period.approve_close   (planned — not implemented; no such permission key exists in permission-registry.ts yet)
ledger.export
```

Default grants:

```text
OWNER: all ledger permissions
ADMIN: ledger.account.read, ledger.journal.read, ledger.report.read, ledger.period.read
FINANCE: ledger.account.read, ledger.journal.read, journal.entry.create, ledger.report.read, ledger.period.read, ledger.export
ACCOUNTANT: all ledger permissions
AUDITOR_READONLY: ledger.account.read, ledger.journal.read, ledger.report.read, ledger.period.read, ledger.export
MANAGER: ledger.report.read where ABAC allows summary
SALES, INVENTORY, MARKETING, STAFF: no ledger mutation permissions by default
```

`ledger.period.approve_close` (item 10E, owner decision 2026-07-06; not yet registered in permission-registry.ts) is granted to NO system role by default — it is explicitly excluded from OWNER/ACCOUNTANT "all ledger permissions" so the close approval chain (accountant review -> auditor approval -> human close) cannot be self-satisfied by one person. It is assigned only through a dedicated auditor collaborator role; both accountants and auditors may be external collaborators, and external memberships must carry an explicit external flag/toggle visible in UI, approval records, and audit (see Auth/RBAC Spec §22).

## 5.2 Accounting Document Permission Keys

Use these keys for Accounting Documents MVP:

```text
accounting.counterparty.read
accounting.counterparty.manage
accounting.document.read
accounting.document.read_related
accounting.document.create
accounting.document.update
accounting.document.issue
accounting.document.void
accounting.quotation.read
accounting.quotation.create
accounting.quotation.update
accounting.quotation.submit_approval
accounting.quotation.approve
accounting.quotation.issue
accounting.quotation.void
accounting.invoice.read
accounting.invoice.create
accounting.invoice.update
accounting.invoice.issue
accounting.invoice.void
accounting.billing_note.read
accounting.billing_note.create
accounting.billing_note.update
accounting.billing_note.issue
accounting.billing_note.void
accounting.receipt.read
accounting.receipt.create
accounting.receipt.update
accounting.receipt.issue
accounting.receipt.void
accounting.tax_invoice.read
accounting.tax_invoice.issue
accounting.tax_invoice.void
accounting.credit_note.read
accounting.credit_note.create
accounting.credit_note.issue
accounting.credit_note.void
accounting.debit_note.read
accounting.debit_note.create
accounting.debit_note.issue
accounting.debit_note.void
accounting.payment.read
accounting.payment.create
accounting.payment.update
accounting.payment.void
accounting.document.export
```

Default grants:

```text
ALL company roles: accounting.document.read_related; this is view-only, sales_documents-entitlement-gated, and returns only tenant/branch-scoped related records
OWNER: all accounting document permissions
ADMIN: accounting.counterparty.read, accounting.counterparty.manage, accounting.document.read, accounting.quotation.read, accounting.invoice.read, accounting.billing_note.read, accounting.receipt.read, accounting.credit_note.read, accounting.debit_note.read, accounting.tax_invoice.read, accounting.payment.read
SALES: accounting.counterparty.read, accounting.quotation.read, accounting.quotation.create, accounting.quotation.update, accounting.quotation.submit_approval, accounting.quotation.issue after approval, accounting.invoice.read where own/assigned, accounting.billing_note.read where own/assigned, accounting.receipt.read where own/assigned, accounting.payment.read where own/assigned
FINANCE: all accounting document permissions
ACCOUNTANT: accounting.counterparty.read, accounting.document.read, accounting.quotation.read, accounting.invoice.read, accounting.billing_note.read, accounting.receipt.read, accounting.tax_invoice.read, accounting.credit_note.read, accounting.debit_note.read, accounting.payment.read, accounting.document.export
AUDITOR_READONLY: accounting.counterparty.read, accounting.document.read, accounting.quotation.read, accounting.invoice.read, accounting.billing_note.read, accounting.receipt.read, accounting.tax_invoice.read, accounting.credit_note.read, accounting.debit_note.read, accounting.payment.read, accounting.document.export
MANAGER: accounting.document.read where ABAC allows team/summary, accounting.quotation.approve where ABAC allows team
INVENTORY, MARKETING, STAFF: no accounting document mutation permissions by default
pack.expense.review: accounting.counterparty.read
```

Counterparty grants, vendor-address spec §12.1 (CON-2), 20 September 2026 — no new keys, only
existing ones handed out where the journey needs them:

- `ADMIN` gains `accounting.counterparty.read` + `accounting.counterparty.manage`. An expense save
  auto-creates and fills counterparties (spec D4), and the toast announcing it links to the
  counterparty page; ADMIN previously held no counterparty key at all, so that link dead-ended for
  the role that works expenses owner-equal (Item 09 decision, 2026-07-26).
- The `pack.expense.review` capability pack gains `accounting.counterparty.read` — the reviewer is
  who sees that toast. Read only: changing a primary address, promoting an address from history and
  the "ล็อกที่อยู่หลัก" switch all still require `accounting.counterparty.manage`.
- Creating and filling a counterparty automatically is NOT gated on
  `accounting.counterparty.manage` (assumption A3, precedent `EnsureCustomerCounterpartyUseCase`):
  it is a side effect of an expense write that already passed permission and entitlement checks, and
  every one is audited with `metadataJson.source = 'expense_auto_link'`.
- A user without registry read still types addresses on the expense. The API supplies the "ดู" link
  only if this user created that counterparty or uploaded the primary receipt that created it. That
  row permission does not expose the registry list or the counterparty's expense history.

## 5.3 Expense Permission Keys

Use these keys for Expense and Receipt Upload:

```text
expense.read
expense.read_related
expense.read_own
expense.evidence.read
expense.create
expense.receipt.upload
expense.receipt.line_upload
expense.update
expense.review
expense.confirm
expense.reject
expense.void
expense.delete
expense.payment.record
expense.duplicate.resolve
expense.ocr.request
expense.ai.verify
expense.category.manage
expense.signature.self_manage
expense.signature.manage
expense.signature.approve
expense.export
```

Default grants:

```text
INTERNAL EMPLOYEE BASELINE (OWNER, ADMIN, MANAGER, SALES, INVENTORY, FINANCE, ACCOUNTANT, MARKETING, STAFF): expense.read_own, expense.create, expense.receipt.upload, expense.receipt.line_upload, expense.update own drafts, expense.signature.self_manage
OWNER: all expense permissions
ADMIN: employee baseline plus expense.read, expense.evidence.read, expense.review, expense.confirm, expense.reject, expense.void, expense.delete, expense.payment.record, expense.duplicate.resolve, expense.category.manage, expense.signature.manage, expense.export
MANAGER: employee baseline plus expense.read and expense.evidence.read where ABAC allows team/summary, expense.review where ABAC allows team, expense.duplicate.resolve where ABAC allows team
FINANCE: all expense permissions except expense.signature.approve by default
ACCOUNTANT: employee baseline plus expense.read, expense.evidence.read, expense.export
AUDITOR_READONLY: expense.read, expense.evidence.read, expense.export
SALES, INVENTORY, MARKETING, STAFF: employee baseline
```

`ADMIN` works the expense module owner-equal (owner decision 2026-07-26): intake, review, confirm, reject, void, payment recording, duplicate resolution, and substitute-receipt preparation/approval. `expense.signature.approve` stays owner-level; `expense.ocr.request` and `expense.ai.verify` stay service-lane (`expense.review` already covers reviewer-triggered extraction).

`expense.delete` hard-deletes DRAFT expenses only. OWNER, ADMIN, and FINANCE hold it by default and may delete any company draft; otherwise, a draft's creator holding `expense.update` may delete their own draft.

`expense.signature.self_manage` is the personal-signature boundary: list, preview, upload, invoke/use, replace, derive and archive are restricted to `submittedByUserId = current user` in the API. Even OWNER, ADMIN, or a holder of `expense.signature.manage` can see and invoke only their own signature. `expense.signature.manage` remains a legacy/high-risk grant but no longer widens signature visibility, invocation, or ownership. Existing signed documents keep their pinned attachment references for audit/history after a personal signature is replaced or archived.

The baseline is code-synced only to the protected internal employee roles above. `AUDITOR_READONLY`, `COMPANY_VIEW`, `SYSTEM_ADMIN`, and arbitrary company custom roles do not receive it automatically. A custom role opts in through `pack.expense.self`; existing custom roles already holding `expense.create` receive only the new owner-scoped `expense.signature.self_manage` backfill.

`expense.evidence.read` is the dedicated read boundary for the หลักฐานทางบัญชี screen and `GET /expenses/shared-evidence`. It is granted to every protected role bundle that already has `expense.read`, so introducing the narrower guard does not remove existing access. Disabling the `expenses.evidence` child entitlement strips `expense.evidence.read` and `expense.export` while leaving the other expense sub-menus intact.

`expense.read_related` is universal but view-only and is stripped when the `expenses.list` route is off. It returns only tenant/branch-scoped expenses where the caller is persisted as creator/updater/reviewer/confirmer/rejector/voider, a payment actor, a substitute-receipt preparer/payer/approver/issuer, or an actor on the source reimbursement. It never grants update, review, confirm, payment, reject, void, OCR, or signature authority; those actions still require their exact permission, actor rule, and document state. `expense.read_own` remains the narrower creator/self-service compatibility path.

`expense.ai.verify` is normally granted to service/internal actors, not broad human roles.

Sensitive expense permissions:

```text
expense.receipt.line_upload
expense.ai.verify
expense.category.manage
expense.signature.manage
expense.confirm
expense.reject
expense.void
expense.delete
expense.payment.record
expense.duplicate.resolve
expense.export
```

## 5.3A System Admin / Item 10A Permission Keys

Use these platform-scoped keys for Admin Company Onboarding and Partner Management:

```text
system.company_onboarding.create
system.company_onboarding.read
system.company_onboarding.regenerate_temporary_password
system.partner_dashboard.read
system.partner_company.create
system.partner_company.update
system.partner_company.lifecycle.manage
system.partner_feature.manage
system.partner_ai_model.manage
system.shared_line_credential.manage
```

Default grants:

```text
SYSTEM_ADMIN: all system.* permissions above
Customer company roles: none of the system.* permissions
```

Rules:

- These keys are platform-scoped and must not be granted through customer-company roles.
- Partner dashboard access is metadata-only and must not grant customer workspace access.
- `system.shared_line_credential.manage` manages WatchDog shared LINE OA platform credentials, not per-partner LINE OA credentials.
- Shared LINE webhooks must resolve company from linked identity plus selected company context, not from `messagingChannelId`.

## 5.4 Thai Tax Permission Keys

Use these keys for Thai Tax MVP:

```text
tax.profile.read
tax.profile.manage
tax.config.read
tax.config.manage
tax.period.read
tax.period.manage
tax.event.read
tax.event.sync
tax.report.read
tax.report.recompute
tax.report.export
tax.filing.mark_filed
tax.filing.mark_paid
tax.adjustment.create
tax.certificate.read
tax.certificate.issue
tax.certificate.void
tax.review_issue.read
tax.review_issue.resolve
```

Feature Entitlement Decoupling Spec v5 adds the following keys during its expand phase:

```text
wht.certificate.read
wht.certificate.prepare
wht.certificate.correct
wht.external_certificate.link
company.vat_registration.read
company.vat_registration.manage
finance.vat.review
vat.credit_outcome.correct
tax.adjustment.approve
```

The four `wht.*` keys follow visibility of the owning supplier/expense payment or exact retained pre-cutoff handoff/legal artifact and must not require `thai_tax`; they compile through entitlement-free/source-scoped `pack.wht.certificate.manage`. `company.vat_registration.read|manage` compile through the narrow entitlement-free `pack.company.vat_registration.manage` — NOT through `pack.company.settings.view|manage`, which is far more widely held (resolved 2026-08-04 against the conflicting statement further down this file; implemented in `capability-pack.registry.ts`); `finance.vat.review` compiles through shared source/Ledger-scoped `pack.finance.vat.review` and cannot create a Tax report contribution. `vat.credit_outcome.correct` compiles through the entitlement-free HIGH-risk `pack.vat.credit_outcome.correct` and authorizes only correction of an exact retained pre-disable VAT refund/external-transition outcome pinned by outcome/root hash plus cutoff; it cannot create a new Tax root, report, filing or contribution. Tax-on final application continues to require `tax.adjustment.create|approve`. Finance/Accounting presets receive the narrow WHT/VAT-review packs, but only Accounting receives the VAT-credit-outcome correction pack; it is never part of broad Finance access. Runtime ABAC still requires current source/Ledger visibility or exact retained authority for WHT/VAT review, and exact retained outcome/root hash plus cutoff for VAT credit-outcome correction. PREFIX filtering explicitly excludes `wht.*`, `finance.vat.review`, `vat.credit_outcome.correct` and `company.vat_registration.*` from the `thai_tax` bucket. `tax.adjustment.approve` is deliberately distinct from create and is granted to OWNER/ACCOUNTANT only; adjustment-approval routes remain fail-closed until this additive registry/default-grant migration lands. After that expansion, `tax.certificate.issue|void` remain deprecated compatibility aliases only: initial issue is the qualifying source-payment system action, and the legacy void route only classifies into correction/cancellation.

Older planning names removed 2026-07-29 (GAP-06 item 6.2 — they never existed in permission-registry.ts): `tax.period.prepare` (preparation is `tax.event.sync` + `tax.report.recompute`), `tax.report.review` (review is `tax.review_issue.read`/`tax.review_issue.resolve`), and `tax.reminder.read` (Tax obligation queries use `tax.period.read`; delivered reminders use notification permissions). `tax.adjustment.approve` also does not exist in the current registry, but v5 now introduces it explicitly through the guarded expand migration above rather than treating it as pre-existing.

Default grants:

```text
OWNER: all tax permissions
ADMIN: no tax permissions by default
FINANCE: tax.profile.read, tax.config.read, tax.period.read, tax.event.read, tax.event.sync, tax.report.read, tax.report.recompute, tax.report.export, tax.filing.mark_filed, tax.filing.mark_paid, tax.adjustment.create, tax.certificate.read, tax.certificate.issue, tax.certificate.void, tax.review_issue.read, tax.review_issue.resolve
ACCOUNTANT: all tax permissions
AUDITOR_READONLY: tax.profile.read, tax.config.read, tax.period.read, tax.event.read, tax.report.read, tax.report.export, tax.certificate.read, tax.review_issue.read
MANAGER: tax.profile.read, tax.config.read, tax.period.read, tax.report.read, tax.certificate.read, tax.review_issue.read (summary visibility)
SALES, INVENTORY, MARKETING, STAFF: no tax permissions by default
```

Feature Entitlement Decoupling v5 additive shared/default grants:

```text
OWNER: company.vat_registration.read/manage, finance.vat.review,
       wht.certificate.read/prepare/correct, wht.external_certificate.link,
       vat.credit_outcome.correct,
       tax.adjustment.approve
ADMIN: no company.vat_registration key by default — the keys live in the narrow
       pack.company.vat_registration.manage, not in the Company Settings packs
       (2026-08-04); no Tax/WHT/VAT-outcome key by default
FINANCE: company.vat_registration.read, finance.vat.review,
         wht.certificate.read/prepare/correct, wht.external_certificate.link;
         no vat.credit_outcome.correct or tax.adjustment.approve
ACCOUNTANT: company.vat_registration.read/manage, finance.vat.review,
            wht.certificate.read/prepare/correct, wht.external_certificate.link,
            vat.credit_outcome.correct,
            tax.adjustment.approve
AUDITOR_READONLY, MANAGER, SALES, INVENTORY, MARKETING, STAFF:
            no new shared key by default
```

The role-pack compiler maps these through the narrow `pack.company.vat_registration.manage`, `pack.finance.vat.review`, `pack.wht.certificate.manage` and `pack.vat.credit_outcome.correct`. WHT/VAT review actions additionally enforce current source visibility or the exact retained authority predicate described above; VAT credit-outcome correction instead requires the exact retained outcome/root hash plus cutoff. A default grant alone never exposes a source record or authorizes new Tax work.

Step 0 company tax identity (`company-tax-identity-setup-spec.md` §10, Release A):

```text
company.legal_identity.read    MEDIUM  pack.company.legal_identity.manage   OWNER only (QP2 open)
company.legal_identity.manage  HIGH    pack.company.legal_identity.manage   OWNER only (QP2 open)
company.vat_registration.read  LOW     pack.company.vat_registration.manage OWNER, ACCOUNTANT, FINANCE
company.vat_registration.manage HIGH   pack.company.vat_registration.manage OWNER, ACCOUNTANT
accounting.tax_document_buyer_evidence.manage HIGH pack.tax_invoice.issue   OWNER, FINANCE
system.identity_reconciliation.resolve CRITICAL (no pack — platform)        SYSTEM_ADMIN
```

Both `pack.company.*` packs above are entitlement-free: a company that never bought `thai_tax` still has one legal name, one tax id and one VAT status, and the Step 0 wizard runs for every tenant. PREFIX filtering does not reach `company.*`, which `feature-gate.logic.spec.ts` proves. `company.setup.read` continues to see a MASKED identity (last four digits of the tax id, province only); the full value needs `company.legal_identity.read`.

Sensitive tax permissions:

```text
tax.config.manage
tax.period.manage
tax.report.export
tax.filing.mark_filed
tax.filing.mark_paid
tax.adjustment.create
tax.adjustment.approve (after v5 expand; OWNER/ACCOUNTANT only)
vat.credit_outcome.correct (HIGH; exact retained outcome/root hash + cutoff; OWNER/ACCOUNTANT only)
tax.certificate.issue
tax.certificate.void
```

Item 11B tax/account mapping boundary (owner decision 2026-07-14): implemented `tax.profile.read/manage` owns company tax profile access; `tax.config.manage` owns Tax Code definitions, evidence policy, and report mappings; `ledger.posting-rule.manage` owns final account-determination mappings to company chart accounts. An API or UI action that changes both tax and ledger configuration must enforce both permissions and audit both domains. Source-document permissions remain required for line Tax Code mutation. Read-only roles may inspect permitted profile/mapping/reconciliation data but cannot activate, remap, resolve exceptions, post, or alter filed/closed history. Older planning names in this section (`tax.period.prepare`, `tax.report.review`, `tax.reminder.read`) were reconciled against the implemented permission registry and role grants on 2026-07-29 (GAP-06 item 6.2); do not introduce synonymous duplicate keys. See [[specs/sap-compatible-transaction-tax-account-determination-spec|SAP-Compatible Transaction Tax and Account Determination Spec]].

## 5.5 Bank Accounts and Reconciliation Permission Keys

Use these keys for Bank Accounts and Reconciliation:

```text
bank.account.read
bank.account.manage
bank.account.sensitive_read
bank.statement.read
bank.statement.import
bank.statement.manual_line
bank.statement.void
bank.match.read
bank.match.suggest
bank.match.confirm
bank.match.unmatch
bank.match.override
bank.adjustment.read
bank.adjustment.create
bank.adjustment.approve
bank.adjustment.void
bank.reconciliation.read
bank.reconciliation.create
bank.reconciliation.complete
bank.reconciliation.reopen
bank.reconciliation.export
bank.cash.read
```

Default grants:

```text
OWNER: all bank permissions
ADMIN: bank.account.read, bank.account.manage, bank.statement.read, bank.match.read, bank.adjustment.read, bank.reconciliation.read, bank.cash.read
FINANCE: all bank permissions except bank.adjustment.approve, bank.reconciliation.complete, and bank.reconciliation.reopen by default
ACCOUNTANT: bank.account.read, bank.statement.read, bank.match.read, bank.match.confirm, bank.match.unmatch, bank.match.override, bank.adjustment.read, bank.adjustment.approve, bank.adjustment.void, bank.reconciliation.read, bank.reconciliation.create, bank.reconciliation.complete, bank.reconciliation.reopen, bank.reconciliation.export, bank.cash.read
AUDITOR_READONLY: bank.account.read, bank.statement.read, bank.match.read, bank.adjustment.read, bank.reconciliation.read, bank.reconciliation.export, bank.cash.read
MANAGER: bank.cash.read where ABAC allows summary
SALES, INVENTORY, MARKETING, STAFF: no bank mutation permissions by default
```

Sensitive bank permissions:

```text
bank.account.sensitive_read
bank.statement.import
bank.statement.manual_line
bank.statement.void
bank.match.confirm
bank.match.unmatch
bank.match.override
bank.adjustment.approve
bank.adjustment.void
bank.reconciliation.complete
bank.reconciliation.reopen
bank.reconciliation.export
```

## 5.6 Reimbursement Permission Keys

Use these keys for Reimbursement Approval:

```text
reimbursement.read
reimbursement.read_related
reimbursement.read_own
reimbursement.create
reimbursement.update_own_draft
reimbursement.submit
reimbursement.cancel_own
reimbursement.approve
reimbursement.reject
reimbursement.finance_review
reimbursement.payment.record
reimbursement.payment.void
reimbursement.duplicate.resolve
reimbursement.policy.read
reimbursement.policy.manage
reimbursement.export
```

Default grants:

```text
ALL company roles: reimbursement.read_related; view-only and reimbursement-entitlement-gated
INTERNAL EMPLOYEE BASELINE (OWNER, ADMIN, MANAGER, SALES, INVENTORY, FINANCE, ACCOUNTANT, MARKETING, STAFF): reimbursement.read_own, reimbursement.create, reimbursement.update_own_draft, reimbursement.submit, reimbursement.cancel_own
OWNER: all reimbursement permissions
ADMIN: employee baseline plus reimbursement.read, reimbursement.approve, reimbursement.reject, reimbursement.payment.record, reimbursement.payment.void, reimbursement.policy.read, reimbursement.policy.manage, reimbursement.export (approvers are OWNER/ADMIN/MANAGER per team decision 2026-07-28; owner decision 2026-09-19 supersedes that decision's "paying stays FINANCE-only" half — see note below)
MANAGER: employee baseline plus reimbursement.read where ABAC allows team/summary, reimbursement.approve where assigned/team policy allows, reimbursement.reject where assigned/team policy allows, reimbursement.payment.record, reimbursement.payment.void (owner decision 2026-09-19, see note below)
FINANCE: employee baseline plus reimbursement.read, reimbursement.finance_review, reimbursement.payment.record, reimbursement.payment.void, reimbursement.duplicate.resolve, reimbursement.policy.read, reimbursement.export
ACCOUNTANT: employee baseline plus reimbursement.read, reimbursement.finance_review where accounting policy grants, reimbursement.export
AUDITOR_READONLY: reimbursement.read, reimbursement.export
SALES, INVENTORY, MARKETING, STAFF: employee baseline
```

Owner decision 2026-09-19 supersedes the team decision of 2026-07-28 ("paying stays FINANCE-only"):
an approver can record a reimbursement payment directly instead of handing it to finance, so ADMIN
and MANAGER now hold `reimbursement.payment.record` and `reimbursement.payment.void` alongside
`reimbursement.approve`/`reimbursement.reject` (`pack.reimbursement.approve` grants the same two keys
to a custom role built from it). `reimbursement.finance_review`, `reimbursement.duplicate.resolve`,
and `reimbursement.policy.manage` are not widened — those stay FINANCE/OWNER-only, unchanged. FINANCE
keeps its existing grants.

The employee baseline is active only while the `reimbursement` entitlement is ON. Safe-OFF continues to strip create, draft update, submit and cancel while retaining the existing runoff permissions for claims already in flight. Company custom roles opt in through `pack.reimbursement.self`; they are never widened solely because the feature is enabled.

`reimbursement.read_related` returns only records in the caller's tenant and branch scope where the caller is persisted as
requester/creator/updater/submitter/current approver, approval-step assignee or decider, finance reviewer, cancellation actor,
payment/void actor, claim-form signer, signed-copy linker, or an actor on a linked/generated expense. Every linked-expense hop
repeats branch scope. This permission never grants draft update, submit, cancel, approve/reject, finance review, payment, void,
evidence upload, signing or export; each mutation still requires its exact permission, exact actor rule and current state.
`reimbursement.read_own` remains the narrower requester-only compatibility path.

Sensitive reimbursement permissions:

```text
reimbursement.approve
reimbursement.reject
reimbursement.finance_review
reimbursement.payment.record
reimbursement.payment.void
reimbursement.duplicate.resolve
reimbursement.policy.manage
reimbursement.export
```

### Procurement related-document visibility

The following LOW-risk permissions are universal to company roles but remain gated by their exact procurement submenu:

```text
procurement.purchase_request.read_related
procurement.purchase_order.read_related
procurement.goods_receipt.read_related
procurement.vendor_bill.read_related
procurement.supplier_payment.read_related
```

Each key returns only tenant- and branch-scoped documents connected through the persisted purchase-to-pay graph:
PR → PO → goods receipt → vendor bill → supplier-payment allocation/payment. Direct actors include requester,
creator/updater, submit/approve/reject/issue/cancel/close/post/void actors, receiver, evidence reviewer, matcher/override
actor and payment/allocation actor. Successful immutable audit/approval history preserves earlier actors after mutable
header fields change. Traversal is cycle-safe, reapplies branch scope at every hop, and never treats sharing a supplier
as a relationship.

These keys do not expose supplier master data, supplier bank accounts, AP aging/statement reports, WHT handoffs or
posting sources. They never grant create, edit, submit, approve/reject, issue, receive/post, match/override, pay, void,
export or policy authority; each mutation continues to require its exact permission/actor rule and current state.

## 5.7 CRM and Sales Permission Keys

Use these keys for CRM and Sales MVP:

```text
crm.customer.read
crm.customer.create
crm.customer.update
crm.customer.archive
crm.customer.assign
crm.customer.merge
crm.customer.import
crm.customer.export
crm.contact.read
crm.contact.manage
crm.lead.read
crm.lead.create
crm.lead.update
crm.lead.assign
crm.lead.convert
crm.lead.disqualify
crm.opportunity.read
crm.opportunity.create
crm.opportunity.update
crm.opportunity.stage_move
crm.opportunity.close
crm.opportunity.reopen
crm.activity.read
crm.activity.create
crm.follow_up.read
crm.follow_up.create
crm.follow_up.update
crm.follow_up.complete
crm.pipeline.configure
crm.segment.read
crm.segment.manage
crm.quotation.link
crm.report.read
crm.ai.read
```

Default grants:

```text
OWNER: all CRM permissions
ADMIN: all CRM permissions
MANAGER: crm.customer.read assigned-only, crm.customer.assign for already-assigned customers, crm.contact.read on assigned customers, crm.lead.read, crm.lead.create, crm.lead.update where team, crm.lead.assign where team, crm.lead.convert where team, crm.lead.disqualify where team, crm.opportunity.read, crm.opportunity.create, crm.opportunity.update where team, crm.opportunity.stage_move where team, crm.opportunity.close where team, crm.opportunity.reopen where team, crm.activity.read, crm.activity.create, crm.follow_up.read, crm.follow_up.create, crm.follow_up.update where team, crm.follow_up.complete where team, crm.segment.read, crm.quotation.link where accounting permissions allow, crm.report.read, crm.ai.read
SALES: crm.customer.read own/assigned, crm.customer.create, crm.customer.update own/assigned, crm.contact.read own/assigned, crm.contact.manage own/assigned, crm.lead.read own/assigned, crm.lead.create, crm.lead.update own/assigned, crm.lead.convert own/assigned, crm.lead.disqualify own/assigned, crm.opportunity.read own/assigned, crm.opportunity.create own/assigned, crm.opportunity.update own/assigned, crm.opportunity.stage_move own/assigned, crm.opportunity.close own/assigned, crm.activity.read own/assigned, crm.activity.create own/assigned, crm.follow_up.read own/assigned, crm.follow_up.create own/assigned, crm.follow_up.update own/assigned, crm.follow_up.complete own/assigned, crm.segment.read, crm.quotation.link own/assigned where accounting permissions allow, crm.ai.read own/assigned
FINANCE: crm.customer.read accounting/contact projection, crm.contact.read accounting-contact projection, crm.opportunity.read where accounting link allows, crm.activity.read limited, crm.follow_up.read limited, crm.report.read finance-safe
ACCOUNTANT: crm.customer.read accounting/contact projection, crm.contact.read accounting-contact projection, crm.opportunity.read, crm.activity.read limited, crm.report.read
MARKETING: crm.customer.read pseudonymous projection, no crm.contact.read by default, crm.segment.read, crm.segment.manage where campaign policy allows, crm.report.read marketing-safe, crm.ai.read marketing-safe
AUDITOR_READONLY: crm.customer.read, crm.contact.read, crm.lead.read, crm.opportunity.read, crm.activity.read, crm.follow_up.read, crm.segment.read, crm.report.read, crm.customer.export
INVENTORY, STAFF: no CRM permissions by default
```

MANAGER customer visibility is explicit-assignment-only even when team ABAC exists for other CRM records. Team scope may still apply to leads, opportunities, activities, or follow-ups under their own policy, but it never expands the Customer Directory to company-wide or team-wide read.

Customer-management composition rules:

- Opening `/companies/:companyId/customers` requires `crm.customer.read`; each action independently requires its existing create/update/archive/assign/merge permission. UI hiding is convenience only.
- AI-assisted intake preview requires both `crm.ai.assist` and `crm.customer.create`. It can populate the normal form but cannot call create/update/link/merge itself.
- LINE-identity re-point is a high-risk partial merge and requires `crm.customer.merge`. `crm.customer.update` and `crm.inbox.read` never authorize re-binding. Default grant remains Owner/Admin only; Manager/Sales do not receive it implicitly.
- Full customer merge also requires `crm.customer.merge`. Preview and commit both require permission, and commit requires a reason.
- `crm.customer.create` never permits a staff caller to claim a system-only `LINE` origin. LINE origin comes only from the verified company-OA/LIFF server path.

Customer list/detail field projection is an API policy, not a web-only hiding rule. Endpoints must select or redact to the following allowlists before serialization:

| Caller | Customer row scope | Allowed customer projection |
|---|---|---|
| OWNER, ADMIN | All company customers | Operational projection: all permission-authorized customer list/detail fields, notes, consent evidence, contacts, and masked LINE identities. |
| SALES | Own/assigned customers only | Same operational projection as Owner/Admin for an allowed row. Separate permissions still govern create/update/archive/assign/link/merge actions. |
| MANAGER | Explicitly assigned customers only | Same operational projection for an assigned row. Team membership alone does not expose a customer. |
| AUDITOR_READONLY | All company customers | Full read projection, including notes, consent evidence, contacts, and masked LINE identities; no mutation permission. |
| FINANCE, ACCOUNTANT | All company customers only when `crm.customer.read` is granted | Accounting/contact allowlist only: `id`, `code`, `displayName`, `legalName`, `customerType`, `status`, `branchId`, `accountingCounterpartyId`, `primaryPhone`, `primaryEmail`, `taxId`, `createdAt`, `updatedAt`; contact allowlist is `id`, `customerId`, `name`, `role`, `phone`, `email`, `preferredChannel`, `isPrimary`, `status`. Customer/contact notes, consent evidence, owner, origin/actor provenance, tier/engagement/LTV/follow-up fields, social ids, and every LINE aggregate/identity field are excluded. |
| MARKETING | Company customers only when `crm.customer.read` is granted | Pseudonymous allowlist only: purpose-scoped `customerRef` (never raw `CrmCustomer.id`), `status`, `consentStatus`, `originSource`, `tier`, and permitted segment ids. Names, codes, phone/email/tax/address, contact-person records, notes, owner/accounting links, social ids, and every LINE aggregate/identity field are excluded. |

Mixed roles are resolved per customer row. A broader low-field role never upgrades another role's field access: Sales+Finance receives operational fields only on explicitly assigned rows and accounting/contact fields elsewhere; Sales+Marketing receives operational fields only on explicitly assigned rows and pseudonymous fields elsewhere. The API returns a discriminated `{projection, customer}` item and never casts a limited object to the operational DTO. Marketing-only access cannot call canonical-id detail/search routes.

Raw provider user ids, normalized matching keys, internal lock/storage fields, and Prisma rows are system-only and absent from every role projection, including Owner/Admin/Auditor. A duplicate-candidate response follows the caller's row scope and uses the existing redacted candidate shape when the matched customer is not readable.

Quotation draft creation also requires Accounting Documents permission:

```text
accounting.quotation.create
```

Sensitive CRM permissions:

```text
crm.customer.assign
crm.customer.merge
crm.customer.import
crm.customer.export
crm.opportunity.reopen
crm.pipeline.configure
crm.segment.manage
crm.quotation.link
```

Customer-management AI preview composes existing permissions; identity re-point does not add a raw-id or bypass permission:

```text
crm.ai.assist     # parse/preview only; combine with crm.customer.create
```

The full item-15A channel/inbox permission family remains defined in [[specs/crm-line-oa-customer-os-spec|CRM + Company LINE OA Customer OS Spec]] section 13 and must be registered/granted consistently in runtime.

## 5.8 AI Draft and Suggestion Permission Keys

Use these keys for AI Draft and Suggestion Layer:

```text
ai.suggestion.read
ai.suggestion.read_own
ai.suggestion.request
ai.suggestion.generate
ai.suggestion.review
ai.suggestion.dismiss
ai.suggestion.admin
ai.draft.read
ai.draft.request
ai.draft.review
ai.draft.create_source_draft
ai.template.read
ai.template.manage
ai.tool_invocation.read
```

Default grants:

```text
OWNER: all AI draft/suggestion permissions
ADMIN: all AI draft/suggestion permissions except source-module draft creation still requires source permissions
MANAGER: ai.suggestion.read, ai.suggestion.request, ai.suggestion.review, ai.suggestion.dismiss, ai.draft.read, ai.draft.request, ai.draft.review within team/assigned ABAC
SALES: ai.suggestion.read_own, ai.suggestion.request, ai.suggestion.dismiss own, ai.draft.read, ai.draft.request, ai.draft.review for own/assigned Sales/CRM records
INVENTORY: ai.suggestion.read_own, ai.suggestion.request, ai.suggestion.dismiss own, ai.draft.read, ai.draft.request, ai.draft.review for allowed inventory locations
FINANCE: ai.suggestion.read, ai.suggestion.request, ai.suggestion.review, ai.suggestion.dismiss, ai.draft.read, ai.draft.request, ai.draft.review for finance/tax/accounting scope
ACCOUNTANT: ai.suggestion.read, ai.suggestion.request, ai.suggestion.review, ai.suggestion.dismiss, ai.draft.read, ai.draft.request, ai.draft.review for accounting/tax scope, ai.tool_invocation.read for accounting/tax audit scope
MARKETING: ai.suggestion.read_own, ai.suggestion.request, ai.draft.read, ai.draft.request only for marketing-safe source data; external campaign generation remains item 23
STAFF: ai.suggestion.read_own, ai.suggestion.request, ai.draft.read, ai.draft.request for own tasks/requests only
AUDITOR_READONLY: ai.suggestion.read, ai.draft.read, ai.template.read, ai.tool_invocation.read
```

Extra rules:

- `ai.draft.create_source_draft` is never enough by itself. The user must also hold the source-module draft/create permission and pass ABAC.
- `ai.suggestion.generate` may be granted to service actors, but generation still runs under the requesting user's permission snapshot.
- `ai.template.manage` is OWNER/ADMIN only.
- `ai.tool_invocation.read` returns redacted payloads unless sensitive audit policy allows full detail.

Sensitive AI draft/suggestion permissions:

```text
ai.template.manage
ai.suggestion.generate
ai.suggestion.review
ai.draft.create_source_draft
ai.tool_invocation.read
```

## 5.8A Reports and BI Permission Keys

Use these keys for Reports BI item 18:

```text
report.catalog.read
report.dataset.read
report.query.run
report.view.read
report.view.create
report.view.update_own
report.view.share
report.view.manage
report.snapshot.read
report.export
report.export.read_own
report.export.manage
report.subscription.manage
report.audit.read
bi.view.read
bi.view.create
bi.view.update_own
bi.view.share
bi.admin
```

Default grants:

```text
OWNER: all report and BI permissions
ADMIN: all report and BI permissions; source-module permissions still gate data
MANAGER: catalog/dataset/query, own saved views, own export jobs, BI own views where ABAC/source permissions allow
SALES, INVENTORY, MARKETING: catalog/dataset/query, own saved views, own export jobs, BI own views only through allowed source permissions
FINANCE, ACCOUNTANT: catalog/dataset/query, saved views, share views, snapshots, export, own export jobs, BI shared views through finance/accounting/tax/bank/ledger source permissions
STAFF: catalog/dataset/query, own report saved views, own export jobs, BI read for own tasks/requests only
AUDITOR_READONLY: catalog/dataset/query, report view read, snapshots, export, own export jobs, report audit read, BI read for audit-safe reports
```

Rules:

- Report/BI permissions are never enough by themselves; every query, drill-down, export, and download also re-checks source-module permissions and ABAC.
- `report.export` is required to request a report export; `report.export.read_own` is required to download own ready export files.
- `report.view.share` is required for company/shared saved views.
- `report.view.manage`, `report.export.manage`, `report.subscription.manage`, `report.audit.read`, and `bi.admin` are sensitive admin/audit capabilities.
- LINE/AI can use catalog/dataset/query permissions for summaries and deep links only. LINE/AI cannot export, share views, manage datasets, or mutate source records.

## 5.8B Payroll and HR Compliance Permission Keys

(planned — not implemented; no `hr.*` or `payroll.*` permission keys exist in permission-registry.ts yet. This whole section describes the future item 20 design.)

Use these keys for Payroll and HR Compliance item 20:

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
ADMIN: payroll/HR setup and employee management, no sensitive payroll/bank/tax detail unless explicitly granted
HR: employee manage, sensitive read, leave/benefit manage, leave warning read/manage, payroll read, payslip read, compliance read
FINANCE: payroll run/component/payment/tax/sso/report manage/export, employee payroll-relevant read
ACCOUNTANT: payroll tax/sso/report read/export, compliance verify/manage, posting/tax exception review
MANAGER: leave read/approve and warning read for scoped team, employee read limited to team safe fields, payroll summary only when granted
STAFF: own leave request/read and own published payslip read when self-service is enabled
AUDITOR_READONLY: read/export where granted, no mutation
SALES, INVENTORY, MARKETING: no HR/payroll permissions by default beyond own employee self-service if enabled
```

Rules:

- LINE leave request intake requires an active linked LINE identity, active company membership, `line.ai.query`, `hr.leave.request`, and a server-resolved employee profile for the same user.
- LINE can create only that employee's own `PENDING_APPROVAL` leave request/ticket and must be idempotent by LINE event/message id.
- HR/manager leave approval, rejection, warning threshold management, payroll calculation, payroll approval, finalization, export, bank, tax, social-security, and filing actions are web/API only.
- Frequent-leave warning threshold defaults to 5 requests per employee per payroll period/month and is notification-only, not an approval gate.

## 5.8C Fixed Assets Permission Keys

(planned — not implemented; no `fixed_asset.*` permission keys exist in permission-registry.ts yet. This whole section describes the future item 21 design.)

Use these keys for Fixed Assets item 21:

```text
fixed_asset.category.read
fixed_asset.category.manage
fixed_asset.policy.read
fixed_asset.policy.manage
fixed_asset.asset.read
fixed_asset.asset.create
fixed_asset.asset.update
fixed_asset.asset.archive
fixed_asset.capitalization.review
fixed_asset.capitalization.approve
fixed_asset.depreciation.read
fixed_asset.depreciation.run
fixed_asset.depreciation.review
fixed_asset.depreciation.approve
fixed_asset.depreciation.post
fixed_asset.transfer.create
fixed_asset.transfer.approve
fixed_asset.adjustment.create
fixed_asset.adjustment.approve
fixed_asset.disposal.read
fixed_asset.disposal.create
fixed_asset.disposal.approve
fixed_asset.disposal.void
fixed_asset.report.read
fixed_asset.report.export
fixed_asset.ai.read
```

Default grants:

```text
OWNER: all fixed asset permissions
ADMIN: fixed_asset.category.read, fixed_asset.category.manage, fixed_asset.policy.read, fixed_asset.policy.manage, fixed_asset.asset.read, fixed_asset.report.read
FINANCE: fixed_asset.asset.read, fixed_asset.asset.create, fixed_asset.asset.update, fixed_asset.capitalization.review, fixed_asset.depreciation.read, fixed_asset.depreciation.run, fixed_asset.depreciation.review, fixed_asset.transfer.create, fixed_asset.adjustment.create, fixed_asset.disposal.read, fixed_asset.disposal.create, fixed_asset.report.read, fixed_asset.report.export, fixed_asset.ai.read
ACCOUNTANT: fixed_asset.category.read, fixed_asset.policy.read, fixed_asset.asset.read, fixed_asset.capitalization.review, fixed_asset.capitalization.approve, fixed_asset.depreciation.read, fixed_asset.depreciation.review, fixed_asset.depreciation.approve, fixed_asset.depreciation.post, fixed_asset.adjustment.create, fixed_asset.adjustment.approve, fixed_asset.disposal.read, fixed_asset.disposal.approve, fixed_asset.report.read, fixed_asset.report.export, fixed_asset.ai.read
MANAGER: fixed_asset.asset.read where ABAC/policy allows, fixed_asset.capitalization.approve where policy allows, fixed_asset.transfer.approve where policy allows, fixed_asset.disposal.approve where policy allows, fixed_asset.report.read where summary access allows, fixed_asset.ai.read
INVENTORY: fixed_asset.asset.read for assigned locations/assets when ABAC allows, fixed_asset.transfer.create when policy grants custody/location update, fixed_asset.ai.read for scoped read only
STAFF: fixed_asset.asset.read for own assigned/custodied assets only when self-service is enabled
AUDITOR_READONLY: fixed_asset.category.read, fixed_asset.policy.read, fixed_asset.asset.read, fixed_asset.depreciation.read, fixed_asset.disposal.read, fixed_asset.report.read, fixed_asset.report.export
SALES, MARKETING: no fixed asset permissions by default
```

Sensitive fixed asset permissions:

```text
fixed_asset.category.manage
fixed_asset.policy.manage
fixed_asset.asset.create
fixed_asset.asset.update
fixed_asset.asset.archive
fixed_asset.capitalization.approve
fixed_asset.depreciation.run
fixed_asset.depreciation.approve
fixed_asset.depreciation.post
fixed_asset.transfer.approve
fixed_asset.adjustment.approve
fixed_asset.disposal.approve
fixed_asset.disposal.void
fixed_asset.report.export
```

Rules:

- Web/API own all fixed-asset mutation.
- Capitalization, depreciation approval/posting readiness, impairment/adjustment, disposal/write-off, and export are audited.
- LINE/AI require `fixed_asset.ai.read` plus source read permissions for summaries and deep links only.
- LINE/AI must refuse capitalization, approval, depreciation run, disposal/write-off, transfer/custody mutation, export, posting, tax treatment, policy, or permission changes.

## 5.9 Manufacturing, MRP, and Advanced Warehouse Permission Keys

(planned — not implemented; no `manufacturing.*`, `mrp.*`, or `warehouse.*` permission keys exist in permission-registry.ts yet. This whole section describes the future design.)

Use these keys for Manufacturing, MRP, and Advanced Warehouse:

```text
manufacturing.product-planning.read
manufacturing.product-planning.manage
manufacturing.bom.read
manufacturing.bom.manage
manufacturing.bom.activate
manufacturing.routing.read
manufacturing.routing.manage
manufacturing.production-order.read
manufacturing.production-order.create
manufacturing.production-order.update
manufacturing.production-order.release
manufacturing.production-order.issue-material
manufacturing.production-order.receive-output
manufacturing.production-order.scrap
manufacturing.production-order.close
manufacturing.production-order.void
manufacturing.cost.read
manufacturing.cost.review
mrp.run.read
mrp.run.create
mrp.run.execute
mrp.suggestion.review
mrp.suggestion.convert
warehouse.zone-bin.read
warehouse.zone-bin.manage
warehouse.lot.read
warehouse.lot.manage
warehouse.task.read
warehouse.task.create
warehouse.task.assign
warehouse.task.execute
warehouse.task.override
warehouse.cycle-count.create
warehouse.cycle-count.approve
warehouse.traceability.read
```

Default grants:

```text
OWNER: all manufacturing, MRP, and warehouse permissions
ADMIN: all manufacturing setup and warehouse setup permissions, manufacturing.production-order.read, mrp.run.read, mrp.suggestion.review, warehouse.task.read, warehouse.traceability.read, manufacturing.cost.read
MANAGER: manufacturing.product-planning.read, manufacturing.bom.read, manufacturing.routing.read, manufacturing.production-order.read, manufacturing.production-order.release where ABAC/policy allows, manufacturing.production-order.close where ABAC/policy allows, mrp.run.read, mrp.suggestion.review, mrp.suggestion.convert where ABAC/policy allows, warehouse.task.read, warehouse.task.assign where ABAC allows, warehouse.task.override where policy allows, warehouse.cycle-count.approve where policy allows, warehouse.traceability.read, manufacturing.cost.read
INVENTORY: manufacturing.product-planning.read, manufacturing.bom.read, manufacturing.routing.read, manufacturing.production-order.read, manufacturing.production-order.issue-material, manufacturing.production-order.receive-output, manufacturing.production-order.scrap where assigned/policy allows, mrp.run.read, warehouse.zone-bin.read, warehouse.lot.read, warehouse.task.read, warehouse.task.execute, warehouse.cycle-count.create, warehouse.traceability.read
FINANCE: manufacturing.product-planning.read, manufacturing.bom.read, manufacturing.production-order.read, manufacturing.cost.read, mrp.run.read, mrp.suggestion.review, warehouse.traceability.read
ACCOUNTANT: manufacturing.product-planning.read, manufacturing.bom.read, manufacturing.production-order.read, manufacturing.cost.read, manufacturing.cost.review, mrp.run.read, warehouse.traceability.read
AUDITOR_READONLY: manufacturing.product-planning.read, manufacturing.bom.read, manufacturing.routing.read, manufacturing.production-order.read, manufacturing.cost.read, mrp.run.read, warehouse.zone-bin.read, warehouse.lot.read, warehouse.task.read, warehouse.traceability.read
STAFF: warehouse.task.read assigned, warehouse.task.execute assigned, warehouse.traceability.read assigned/source-scoped
SALES, MARKETING: no manufacturing/MRP/warehouse mutation permissions by default; read access only through separate source/report permissions when granted
```

Sensitive manufacturing, MRP, and warehouse permissions:

```text
manufacturing.product-planning.manage
manufacturing.bom.activate
manufacturing.production-order.release
manufacturing.production-order.issue-material
manufacturing.production-order.receive-output
manufacturing.production-order.scrap
manufacturing.production-order.close
manufacturing.production-order.void
manufacturing.cost.review
mrp.run.execute
mrp.suggestion.convert
warehouse.zone-bin.manage
warehouse.lot.manage
warehouse.task.override
warehouse.cycle-count.approve
warehouse.traceability.read
```

Broad traceability export or cross-source trace lookup is sensitive even when basic traceability read is granted.

## 6. Sensitive Actions

Always audited:

- User/role change.
- Document issue, void, credit note, debit note.
- Quotation approval, rejection, and denied self-approval.
- Payment create/update.
- Expense web/LINE upload completion, AI verification field insertion, duplicate resolution, signature upload/LINE pending-ticket intake/owner approval/background removal/fill, accountant package export, confirmation, rejection, void, and payment record.
- Expense paid.
- Reimbursement request submit/cancel, approval/rejection, denied self-approval, finance review, duplicate resolution, payment voucher generation, payment record/void, correction, export, and policy update.
- CRM customer create/update/archive/assign/import/export/identity-repoint/merge, contact consent update, lead assign/convert/disqualify, opportunity stage move/close/reopen, follow-up complete/cancel, pipeline configuration, segment management, and quotation draft link.
- Stock adjustment.
- Period close/unclose.
- Journal post/reverse/manual adjustment.
- Chart of accounts or posting rule change.
- Bank account create/update/deactivate.
- Bank statement import/manual line/void.
- Bank match confirm/unmatch/override/ignore.
- Bank adjustment approve/void.
- Bank reconciliation complete/reopen/export.
- Manufacturing product planning update, BOM create/update/activate/archive, routing update, production order release/cancel/close/void, material issue post/void, production receipt post/void, scrap/variance record, MRP run execute, MRP suggestion convert, warehouse zone/bin change, lot quarantine/unquarantine/archive, warehouse task override/complete, cycle-count adjustment, and manufacturing cost review/posting status update.
- Tax export generation.
- Workflow rule enable/disable.
- AI suggestion generation, review, source draft creation, template changes, and sensitive AI tool invocation reads.
- Marketplace account connect/disconnect.
- AI tool invocation touching finance, tax, customer, or stock data.
- Employee create/update/disable, temporary password generation/regeneration, LINE link token issue/revoke/link result, role create/update/disable, role permission grant/revoke, and employee role assignment changes.
- HR employee sensitive read/update, bank/tax/social-security profile read/update, leave request submit/cancel/approve/reject, LINE leave-request intake, frequent-leave warning threshold reached, leave warning policy change, benefit enrollment, payroll rule-set verify, payroll run calculate/submit/approve/finalize/void/reversal, payslip generate/publish/read-sensitive, payroll export create/download, and payroll compliance status update.
- Fixed asset category/policy change, capitalization submit/approve/reject/capitalize, asset sensitive value update/archive, depreciation run calculate/approve/posting-ready, transfer/custody approval, impairment/adjustment approval, disposal/write-off approve/void, fixed asset report export, and fixed asset AI tool reads over finance/accounting values.

Require approval or extra permission:

- Discount request: approval required by default.
- Quotation issue by SALES requires MANAGER or FINANCE approval by default. SALES can issue only after approval and cannot self-approve.
- Reimbursement request from 1 THB: approval required by default.
- Purchase order request from 1 THB: approval required by default.
- Company signature asset activation: OWNER approval required before a signature can be used to fill documents.
- Void issued tax invoice.
- Reopen closed accounting period.
- Reopen completed bank reconciliation.
- Confirm bank match with amount/date/reference variance.
- Void bank statement import.
- Complete bank reconciliation.
- Approve bank adjustment.
- Merge CRM customers (Owner/Admin with `crm.customer.merge` by default; preview + reason required).
- Reopen closed opportunity.
- Configure CRM pipeline stages.
- Export customer list.
- Export bank reconciliation evidence.
- Publish campaign externally.
- Change tax configuration.
- Change employee roles or permissions.
- Generate employee temporary password or LINE link QR.
- Approve/reject leave.
- Change frequent-leave warning threshold.
- Approve, finalize, void, reverse, export, or mark payroll/compliance status.
- Approve fixed asset capitalization, transfer/custody change, depreciation run, impairment/adjustment, disposal, or write-off.
- Mark fixed asset depreciation or disposal posting-ready.
- Release production order with shortage.
- Issue expired or quarantined lot.
- Convert MRP suggestion into purchase, production, transfer, or replenishment draft.
- Approve cycle-count variance.
- Close production order with variance.

Threshold means the amount or percentage where normal staff action must be approved before becoming final. Project default is strict: approve every request from 1 THB, and approve every discount request. Keep threshold values configurable for later.

## 7. Row-Level Rules

- SALES sees assigned customers/opportunities by default.
- SALES can review duplicate candidates and reuse an existing permitted customer during create, but cannot re-point LINE identity or merge customers without an explicit `crm.customer.merge` grant (not default).
- MANAGER sees only explicitly assigned customer records; team scope for other CRM record types does not widen Customer Directory access.
- INVENTORY sees stock records for allowed locations.
- FINANCE sees finance/tax records for allowed company/branch.
- ACCOUNTANT sees accounting/tax records but cannot mutate operational records unless granted.
- MARKETING sees only the purpose-scoped pseudonymous customer projection plus permitted product/channel summaries; no customer PII, contact-person record, or LINE identity is granted by default.
- STAFF sees own requests/tasks only.

## 8. LINE Permission Rules

LINE can expose:

- AI chat for any role with scoped tools.
- Summary answers for modules the user can read.
- Alerts for records the user can access.
- Source references and deep links back to web records.
- Account linking and lightweight confirmation that does not mutate business records.
- Expense-document upload for item 09 for every linked active employee role through `expense.receipt.line_upload`, including receipt, tax invoice, transfer slip, handwritten cash bill, marketplace screenshot, PDF/photo/file, and text note; this may create only the employee's own draft expense and insert AI-verified draft/review fields. `AUDITOR_READONLY`, `SYSTEM_ADMIN`, and demo-only `COMPANY_VIEW` are not employee intake roles.
- Reimbursement alerts and status summaries with web links only.
- CRM follow-up alerts, customer summaries, pipeline summaries, and web deep links when user has scoped CRM read permission.
- AI draft/suggestion request, pending summary, ready notification, source labels, and web deep links when user has scoped AI and source read permission.
- Own leave request intake for item 20 when the user is linked, has `hr.leave.request`, and maps to the same active employee profile; this creates only a pending web approval ticket.
- Leave submitted, approved, rejected, and frequent-leave warning notifications with safe payloads and web links.
- Manufacturing/MRP/warehouse summaries, shortage alerts, blocked warehouse task alerts, expiring lot alerts, production order status, traceability answers, and web deep links when user has scoped read permission.
- Fixed asset summaries, depreciation due summaries, disposal/write-off status, blocked depreciation review issues, and web deep links when user has scoped read permission.
- Employee account-link success/failure confirmation during verified LIFF/Login linking.

LINE should not expose:

- Final approve/reject actions.
- Reimbursement final approve/reject, finance review, payment voucher generation, payment record, correction, export, or policy edit.
- CRM customer, contact, lead, opportunity, activity, follow-up, assignment, merge, import/export, pipeline configuration, or quotation draft mutation.
- AI suggestion accept/dismiss/escalate, source draft creation, or review decision from LINE.
- Full expense/accounting workspace.
- Inventory receive/issue/count mutations.
- Quotation issuing or discount approval.
- GL/journal edit.
- Trial Balance edit.
- Tax filing preparation edit.
- Bank statement import, match, unmatch, reconciliation complete/reopen, or bank adjustment approval.
- BOM edit/activation, production order release/cancel/close/void, material issue, production receipt, scrap, MRP run execution, MRP suggestion conversion, warehouse task completion/override, lot quarantine/unquarantine, bin transfer, cycle-count approval, or stock adjustment.
- Fixed asset create/update/archive, capitalization submit/approve/capitalize, depreciation run/calculate/approve/post/export, transfer/custody mutation, impairment/adjustment, disposal/write-off, tax treatment, ledger posting, report export, or category/policy change.
- Final accounting confirmation, payment, void, export, or posting from OCR/AI.
- Substitute receipt (`ใบแทนใบเสร็จ`) generation without web review.
- Signature asset management, LINE pending signature-ticket intake outside the allowlisted flow, owner approval, signature background removal, signature fill, or accountant shared evidence view outside web authorization.
- User permission configuration.
- Employee user creation, temporary password generation, role assignment, permission changes, or LINE link QR generation.
- Leave approval/rejection, leave request creation for another employee, leave warning threshold management, payroll calculation/finalization/approval/export, bank/tax/social-security update, or filing/payment status mutation.
- Bulk import/export.

## 9. AI Tool Policy

AI tool categories:

- `read_summary`: allowed if user can view module summary.
- `read_detail`: allowed if user can view source record.
- `draft_create`: allowed if user can create draft in module.
- `draft_update_verified`: allowed only for allowlisted AI verification flows that insert field-level verified draft data with provenance.
- `approval_request`: allowed if user can request action.
- `source_draft_create`: web-only; allowed only when user has AI source-draft permission plus source-module draft/create permission.
- `final_mutation`: blocked for AI Gateway by default.

Rules:

- AI cannot elevate user permissions.
- AI cannot access raw unrestricted database.
- AI can insert verified expense draft fields only through allowlisted expense use cases with validation guards, confidence gates, and audit.
- AI can semantically classify expense drafts only into active company/default categories visible to the user context; it cannot depend on static keyword dictionaries and cannot create, rename, archive, reorder, or administer categories.
- AI can submit a signature image only through the allowlisted LINE signature-intake flow that creates a pending web ticket. AI cannot approve signatures, activate signatures, remove signature backgrounds, apply signatures to documents, administer signature assets, or expose accountant shared evidence outside permission-checked web views.
- AI/LINE can submit an item 20 own leave request only through the allowlisted leave-intake flow that creates a pending web approval ticket. AI/LINE cannot approve/reject leave, create leave for another employee, override leave balance, or mutate payroll.
- AI/LINE can answer fixed-asset read summaries only through permission-checked tools. AI/LINE cannot capitalize assets, run/approve depreciation, transfer custody, approve impairment, dispose/write off assets, export reports, change policy, set tax treatment, or post ledger entries.
- AI can create item 17 source-module drafts only from web review, after source-module validation, with source citations and idempotency.
- AI must include source references for finance, tax, stock, and CRM answers.
- AI must state when permission or missing data prevents answer.
- AI tool calls are logged with user, role, agent, tool, input hash, source objects, and timestamp.

## 10. Open Questions

- Which threshold values should replace the strict 1 THB default later, if the business wants less approval load?

## 11. Owner Decisions

- ACCOUNTANT starts as a normal internal company membership role. External collaborator model is deferred.
- Normal employee users (`ADMIN`, `MANAGER`, `SALES`, `INVENTORY`, `FINANCE`, `ACCOUNTANT`, `MARKETING`, `STAFF`, `AUDITOR_READONLY`) may have only one active company membership. Active multi-company membership is reserved for `OWNER`.
- Inactive or removed company membership removes all company-scoped permissions immediately. No role keeps LINE, LIFF, web, upload, notification detail, AI tool, or deep-link access after membership is inactive.
- Branch/location ABAC hooks are prepared in Auth/RBAC/Audit. Mandatory branch/location enforcement starts with Inventory MVP.
- OWNER MFA/2FA policy hooks apply to role/permission changes, exports, tax actions, period close/unclose, and voiding issued documents. Full MFA UX is deferred.
- Full company audit visibility belongs to OWNER and AUDITOR_READONLY. ADMIN audit access is admin/security category-scoped. ACCOUNTANT audit access is accounting/tax/finance category-scoped.
