# Agent Memory: themed-date-rollout

Status: COMPLETE LOCALLY (2026-08-08) — typecheck / unit 759/759 / webpack build
all pass. E2E not run. Not committed.
Owner: Claude (harness engineer)
Scope: Owner reported the substitute-receipt hub still showed the native OS
calendar. Swept ALL remaining native `<input type="date"|"month">` in
`apps/web` (19 sites, 8 feature files) onto the shared `ThemedDate` popover
(`src/common/components/field/ThemedDate.tsx`) so every calendar matches the
themed date grid / month grid with Thai Buddhist years.

Decisions:
- `ThemedDate` gained native-parity props instead of converting FormData forms
  to controlled state: `name` renders an **sr-only text input** (NOT
  `type="hidden"`) carrying the value — FormData picks it up by name AND native
  `required` validation still fires; browser focus-on-invalid opens the
  calendar via its `onFocus`. `defaultValue` + internal state make the
  component usable uncontrolled.
- Swapped sites: expenses/SubstituteReceiptHubPage (month filter — the reported
  page), tax/TradeTaxEvidencePage, tax/TaxAccountSettingsPage (×4 FormData),
  tax/TaxCodeSettingsPage (×4), accounts-payable/AccountsPayablePages (×6),
  system-partners/PartnerDetailPage, system-onboarding/SystemOnboardingNewPage,
  accounting-tax-setup/AccountingTaxSetupPage.
- `/system/*` pages were swapped too — both contain mixed Thai/English UI
  already and no WorkspaceLocaleContext provider exists there, so ThemedDate
  falls back to `th` labels; acceptable per owner's "ทั้งหมดในระบบ".
- NOT swapped (out of scope, ThemedDate has no time support):
  `type="time"` (BookingsPrototypePage:768, LineOaSettingsPage:515,517) and
  `type="datetime-local"` (CrmPages:503 dueAt). If the owner wants these themed
  a time-picker mode must be designed first.
- Spec: `ThemedDate.spec.ts` (3 tests) asserts the sr-only form input contract,
  uncontrolled label rendering, and month-mode Buddhist-year label.

Verification: `grep -rn 'type="date"|type="month"' apps/web/src/features
apps/web/app` → 0 rows; unit 759/759; webpack build compiled.

Next:
- [ ] Host E2E run (tax/AP form flows) → commit alongside the toast v2 work.
