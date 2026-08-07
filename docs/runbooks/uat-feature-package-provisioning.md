# UAT Feature Package Provisioning (document-journey acceptance)

Why this exists: partner-console onboarding is deny-by-default since `1874f1db`
(2026-07-08) — a new company gets an explicit `CompanyFeatureEntitlement` row for every
canonical key, `enabled=true` only for the starter package (`DEFAULT_ENABLED_FEATURE_KEYS`).
The 7 UAT companies were onboarded when that package was the 9-key set (expenses,
reimbursement, product_catalog, crm, line_oa, dashboard_notifications, ai_line_assistant,
employee_access, company_settings), so for **them** `sales_documents`, `thai_tax`, `reports`,
`double_entry_ledger`, `bank_reconciliation`, `workflow_automation` are OFF and the permission
resolver strips those families at runtime. Document/tax/report journeys therefore cannot be
accepted on UAT until the tested families are enabled per company. The current package is the
12-key one described below.
Full diagnosis: `docs/agent-memory/uat-print-file-open-diagnosis.md`.

**Changed 2026-08-04 — applies to NEW companies only.** The starter package now also includes
`thai_tax`, `double_entry_ledger` and `workflow_automation` (owner decision; at the time this was
finalised disable-later was still refused — since the 2026-08-04 freeze-in-place decision it is not,
so the package is adjustable after onboarding). `expense_auto_post` is still OFF. Onboarding additionally seeds an ACTIVE
`CompanyTaxCodeProfile` (`WATCHDOG_TH_DOMESTIC_EXPENSE_V1`) with its Tax Codes, account
determination rules and ภ.พ.30 mappings, so a new company can confirm a claimable input-VAT
line with no admin tax setup. **There is no backfill.** The 7 existing UAT companies keep their
`enabled=false` rows and have no tax profile — re-onboard them, or use Option A/B below and then
build their tax config through the admin wizard.

Two operating rules for the seeded tax config (both are consequences of existing admin-path
guards, not new restrictions):

- **Do not activate a second Tax Code profile while the seeded one is ACTIVE.** The seeded
  profile covers domestic input VAT only; a company that also needs output VAT must
  `POST .../code-profiles/:id/retire` the seeded profile first, then create/review/activate the
  fuller template. Definitions of an ACTIVE profile are immutable
  (`transaction-tax-config.use-case.ts:359`), and two overlapping ACTIVE profiles — which
  `activateProfile` permits across different source identities, per
  `sap-compatible-transaction-tax-account-determination-spec.md:376` — make every line that
  carries no explicit Tax Code fail with 422 `Tax profile is ambiguous`
  (`transaction-tax-config.use-case.ts:469,476`) and make the company tax-profile widget read
  as "none" (`GetCompanyTaxCodeProfileUseCase`).
- **To point input VAT at a different account,** add a rule that narrows
  `transactionContext` to `DOMESTIC_PURCHASE` (specificity 6 beats the seeded rule's 4 in
  `selectTaxAccountRule`). Re-submitting the same open-context rule is refused with 409
  "overlaps an equivalent rule", the seeded ACTIVE rule is immutable, and there is no
  per-rule retire endpoint.

This is an **owner/operator action** — do not enable families casually while the
entitlement-decoupling pilot is collecting shadow evidence on UAT; coordinate with the
pilot owner first (enabling a family changes that family's lifecycle counts and
would_block denominators).

## Option A — Partner Companies screen (preferred)

1. Sign in to `https://uat.mangmeeplus.com` with the UAT system admin.
2. `/system/partners` → open the target company → feature package panel.
3. Apply the `standard` preset (adds `sales_documents`, `thai_tax`,
   `double_entry_ledger`, `reports`, `inventory`, CRM submenus — see
   `FEATURE_PACKAGE_PRESETS` in `packages/contracts/src/menu-entitlements.ts`) or toggle
   the exact families under test. Confirm any cascade prompt
   (`feature_cascade_confirmation_required`).

## Option B — API (same authority, scriptable)

`PUT /v1/system/partners/:partnerCompanyId/features` with
`system.partner_feature.manage` (UAT system admin bearer token), body shape:

Read `setVersion` from `GET /v1/system/partners/:partnerCompanyId` immediately before
each change. Generate one UUID for `commandId` and reuse that same UUID only when
retrying the exact same payload after a timeout or transport failure.

```json
{ "features": [ { "featureKey": "sales_documents", "enabled": true },
                 { "featureKey": "thai_tax", "enabled": true },
                 { "featureKey": "reports", "enabled": true } ],
  "commandId": "<new UUID for this exact command>",
  "expectedSetVersion": 0,
  "confirmCascade": false }
```

Replace `expectedSetVersion` with the value returned by the GET; never hard-code it.
A `409 entitlement_set_version_conflict` means another command won first: reload the
detail, review the current feature set, then submit a new command with a new UUID.

422 answers name the exact problem (unknown key, unmet dependency, platform key, cascade
confirmation required) — resend with `confirmCascade: true` only after reading the
cascade preview.

## Verification

- `GET /v1/system/launch-gates/health` (system admin) → `featureLifecycle`: the enabled
  family's `companiesOn` count includes the target company.
- Re-login as the company owner: the family's menu is visible and its screens load; a
  quick print/export (พิมพ์ใบเบิก, tax export, report CSV) round-trips.
- Users with an active session get the new permissions on their next request-context
  resolution (no re-login required; the resolver reads entitlements per request).

## Reverting

Same endpoint/screen with `enabled: false`, a freshly read `setVersion`, and a new
`commandId`. Since the owner's 2026-08-04 freeze-in-place decision this SUCCEEDS for every sellable
family: the family stops working immediately, its existing data stays stored and dormant (nothing is
deleted or archived), and re-enabling it later resumes from that state. Residual work never holds the
disable up. Two refusals remain: `platform_feature_not_disableable` (`employee_access`,
`company_settings`, and their submenus), and `feature_cascade_confirmation_required` when a dependent
family would be stranded — re-send with `confirmCascade: true` to switch the parent and its dependents
off together.

One manual step on the way back up: `expense_auto_post`'s activation cutoff is its entitlement row's
`updatedAt`, and both the disable and the re-enable restamp it. Expenses that were confirmed and
`postingStatus=pending` BEFORE the freeze therefore sit outside the automatic drain after a re-enable.
Nothing is lost — run the guarded historical backfill (preview, then confirm) for that company to
drain them. Applies to `double_entry_ledger` too, since it cascades `expense_auto_post` off.
