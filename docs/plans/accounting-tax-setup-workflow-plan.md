# Plan: Accounting and Thai Tax Setup Workflow

Status: IMPLEMENTED — automated verification complete; signed-in browser UAT pending
Owner: Product / Accounting / Web / Tax / Ledger
Date: 2026-07-30
Spec: [[specs/accounting-tax-setup-workflow-spec|Accounting and Thai Tax Setup Workflow Spec]]
Memory: [[agent-memory/accounting-tax-setup-workflow|Agent Memory]]

## 1. Objective

Replace the current “three technical settings pages plus direct links” setup experience with:

- discoverable Settings sidebar navigation;
- one guided accounting/tax setup entry;
- separate route-backed workflow steps;
- one primary CTA per screen;
- exact readiness and blocker information before activation;
- advanced maintenance pages preserved for expert users.

This plan changes UX orchestration, adds a small read-only readiness contract, and adds one reviewed
non-SAP domestic-expense preset. It does not merge Ledger and Tax ownership or weaken final activation.

### Implementation result

Completed on 2026-07-30:

- permission-filtered Settings submenu, workflow entry, advanced links, and most-specific active state;
- seven route-backed workflow screens with one current step and one primary outcome action;
- chart preview/review/apply orchestration through the existing checksum/CAS endpoints;
- profile readiness contract/API reusing the activation validators, including overlap blockers;
- review-gated `WATCHDOG_TH_DOMESTIC_EXPENSE_V1` (`V7`, `ND`) baseline;
- manifest-backed account suggestions with template version/checksum provenance;
- account/report mapping through existing permission-checked upserts;
- final audited activation through the existing command;
- same-company expense recovery link and validated return target.

No database migration, new dependency, wizard-state table, permission key, final-mutation bypass, or
change to issued tax snapshots was introduced. Automated contract, API, tax-regression, web, navigation,
and type checks pass. Signed-in desktop/mobile browser UAT remains a release verification item.

## 2. Confirmed Baseline

### Navigation

- `SETTINGS_MENU_ITEMS` powers only the `/settings` landing cards.
- `WORKSPACE_MODULES.settings` is a leaf and `buildNavItems()` does not add settings children.
- `canAccessWorkspacePath()` has exact child rules for some settings routes but not Tax Code or Tax
  Account Determination.
- Active-route behavior mixes modules, moduleless subitems, and settings fallback.

### Current pages

- `ChartOfAccountsSettingsPage` owns chart preview/apply/readiness and full maintenance.
- `TaxCodeSettingsPage` owns profiles, SAP templates, manual creation, import, definitions, and activation.
- `TaxAccountSettingsPage` owns account rules, report rules, resolve preview, and rule lists.
- The advanced pages are useful, but they are not an ordered first-time setup flow.

### Existing backend seams to reuse

- Chart template list/preview/apply/readiness APIs.
- Tax profile/template/definition/account/report APIs.
- `validateTaxCodeDefinition`, `missingConfiguration`, semantic rule validation, and activation logic.
- `TH_SME_COA_V1_MAPPING_MANIFEST`.
- Existing permission, audit, outbox, tenant, and serializable transaction boundaries.

## 3. Smallest Correct Architecture

Reuse the existing settings registry, APIs, domain validation, and advanced pages.

Add only:

1. route metadata needed to render Settings cards and sidebar children consistently;
2. thin Next.js routes plus one shared workflow shell/stepper;
3. pure workflow-state derivation;
4. one profile-readiness endpoint derived from activation validation;
5. one reviewed WatchDog domestic-expense template;
6. focused workflow screens that call existing mutations.

Do not add:

- a wizard-progress database table;
- another chart readiness model;
- a new permission or entitlement;
- a form framework;
- a second account-suggestion engine;
- a second activation validator;
- a replacement for the advanced pages.

## 4. Route and Navigation Target

### Sidebar children

Use shared Settings route definitions for:

- `/settings` — ภาพรวมการตั้งค่า;
- `/settings/accounting-tax-setup` — ตั้งค่าบัญชีและภาษี;
- `/settings/chart-of-accounts` — ผังบัญชี Master Data (ขั้นสูง);
- `/settings/tax-codes` — Tax Code และ Tax Profile (ขั้นสูง);
- `/settings/tax-accounts` — Tax Account Determination (ขั้นสูง);
- existing branches/security items.

Do not duplicate LINE OA or CRM catalog in Settings if their current module-owned sidebar entries remain.

### Workflow routes

Implement the route family from spec section 7.3 with thin page files. Use a shared layout/component for:

- step labels and `aria-current`;
- Back/primary action bar;
- readiness loading/error/readonly states;
- validated `profileId` and same-company `returnTo`.

## 5. Implementation Phases

### Phase 0 — Accounting review and contract lock

Deliverables:

- [ ] Confirm the first WatchDog preset remains domestic-expense-only.
- [ ] Approve `V7` and `ND` visible meanings, claimability, calculation method, PP30 contributions, and
      evidence posture.
- [ ] Confirm the exact reviewed mapping-manifest keys used by the preset.
- [ ] Confirm that no-VAT lines continue to use no Tax Code.
- [ ] Record reviewer/date/source in the template metadata.

Gate:

- Navigation work may start.
- Preset/template code must not start until the accounting decisions above are signed off.

### Phase 1 — Navigation reachability

Likely files:

- `apps/web/src/features/web-core-workspace/settings-menu.logic.ts`
- `apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts`
- `apps/web/src/features/web-core-workspace/web-core-workspace.model.ts`
- `apps/web/src/features/web-core-workspace/web-core-workspace.spec.ts`
- `apps/web/src/features/web-core-workspace/settings-menu.logic.spec.ts`
- `apps/web/app/(workspace)/companies/[companyId]/settings/page.tsx`
- workspace dictionary entries

Tasks:

- [ ] Extend the existing Settings route definition with sidebar ownership/order/label metadata instead
      of creating a second list.
- [ ] Make Settings an expand-only parent with a child for its own overview route.
- [ ] Add accounting/tax workflow and advanced children using effective permissions.
- [ ] Align exact direct-route checks for chart, Tax Code, Tax Account Determination, and workflow routes.
- [ ] Fix active-child resolution so only the most specific Settings child highlights.
- [ ] Replace the three equal-weight technical Settings cards with one workflow card and grouped advanced
      links.
- [ ] Keep unrelated module-owned items from appearing twice.

Focused check:

```bash
corepack pnpm --filter @watchdog-bms/web exec tsx --test \
  src/features/web-core-workspace/settings-menu.logic.spec.ts \
  src/features/web-core-workspace/web-core-workspace.spec.ts
```

Acceptance:

- Every offered menu route passes the same permission rules as direct access.
- A user can reach every in-scope page without editing the URL.

### Phase 2 — Read-only workflow shell and state

Likely files:

- new `apps/web/src/features/accounting-tax-setup/` feature folder
- thin routes under
  `apps/web/app/(workspace)/companies/[companyId]/settings/accounting-tax-setup/`
- `apps/web/src/features/ledger/ledger.api.ts`
- `apps/web/src/features/tax/transaction-tax.api.ts`

Tasks:

- [ ] Add the shared stepper/layout and separate step routes.
- [ ] Add a pure `deriveAccountingTaxSetupState()` from entitlements/permissions, chart readiness,
      profiles, selected profile readiness, and optional return target.
- [ ] Implement prerequisite, chart summary, profile summary, mapping summary, and final review as
      read-only screens first.
- [ ] Support refresh/resume without client-only wizard state.
- [ ] Require explicit selection when multiple draft profiles exist.
- [ ] Render prerequisite blockers for feature-off and read-only users.
- [ ] Keep one primary CTA and one current-step content surface per page.

Focused check:

- Pure state tests covering all states in spec section 12.
- Route rendering checks for loading/error/read-only/mobile labels.

Acceptance:

- Reloading any workflow route reconstructs the same step from server state.
- A future route with unmet prerequisites shows a blocker and correct backward CTA.

### Phase 3 — Tax Profile readiness API

Likely files:

- `packages/contracts/src/transaction-tax.ts`
- `apps/api/src/modules/tax/presentation/http/transaction-tax.controller.ts`
- `apps/api/src/modules/tax/application/use-cases/transaction-tax-config.use-case.ts`
- `apps/api/src/modules/tax/domain/logic/tax-configuration.logic.ts`
- existing transaction-tax controller/use-case/domain specs
- `apps/web/src/features/tax/transaction-tax.api.ts`

Tasks:

- [ ] Add `TaxProfileSetupReadiness` contract.
- [ ] Add `GET code-profiles/:profileId/readiness`.
- [ ] Build readiness by calling the same validation functions used by activation.
- [ ] Include definition/account/report/effective-window/overlap blockers with stable codes.
- [ ] Bound response size and verify company ownership/permissions.
- [ ] Keep activation as the final authority.
- [ ] Update Thai error/blocker labels without hiding external code/account role details.

Focused check:

- Table-driven parity test: every incomplete activation fixture reports the same readiness blocker.

Acceptance:

- The user sees exact missing rules before pressing Activate.
- Readiness cannot return `canActivate=true` when the same unchanged state would fail activation.

### Phase 4 — Chart workflow mutations

Likely reuse:

- `ChartOfAccountsSettingsPage` API calls and pure `chart-master.logic.ts`
- existing chart template endpoints/contracts

Tasks:

- [ ] Implement chart preview screen.
- [ ] Implement separate chart review/apply screen.
- [ ] Preserve expected template/preview checksums, conflict acknowledgement, and serializable apply.
- [ ] Navigate forward only after apply success.
- [ ] Skip mutation for a compatible bootstrapped company.
- [ ] Handle legacy zero-account companies and stale previews.

Focused check:

- Existing chart logic/API tests plus a browser path for zero accounts and compatible chart.

Acceptance:

- Preview and apply order is unambiguous; the page never shows both as competing primary buttons.

### Phase 5 — Reviewed WatchDog domestic-expense preset

Likely files:

- `apps/api/src/modules/tax/domain/tax-code-template.catalog.ts`
- transaction-tax template/use-case/repository specs
- web template contract type
- source docs if accounting review changes the preset

Tasks:

- [ ] Generalize the template contract from SAP-only to include `WATCHDOG`.
- [ ] Add `WATCHDOG_TH_DOMESTIC_EXPENSE_V1` with only the approved definitions.
- [ ] Preserve `DRAFT` profile and `REVIEW_REQUIRED` definitions.
- [ ] Store source/reviewer/template provenance.
- [ ] Make creation idempotent for the company/template/effective identity.
- [ ] Present standard vs SAP/ERP mode on a focused profile screen.
- [ ] Warn when the effective date excludes open historic documents.

Focused check:

- Catalog semantics, idempotency, permissions, audit, tenant isolation, and effective-date tests.

Acceptance:

- A non-SAP company does not manually author profile identity, rounding, definitions, direction,
  treatment, and claimability for the baseline journey.

### Phase 6 — Mapping review workflow

Likely files:

- new workflow mapping components/model tests
- `apps/web/src/features/tax/transaction-tax.api.ts`
- existing account/report upsert endpoints
- ledger mapping manifest contract/read adapter if not already exposed

Tasks:

- [ ] Render only rules required by selected profile readiness.
- [ ] Resolve reviewed manifest suggestions to active company-owned accounts.
- [ ] Display provenance and keep suggestions review-required.
- [ ] Hide free-form role/report authoring from the standard workflow.
- [ ] Submit reviewed changed rows through existing idempotent endpoints.
- [ ] Refetch after partial failure and show succeeded/remaining rows.
- [ ] Keep advanced Account Determination page for custom configuration.

Focused check:

- Pure mapping-view tests for `ND`, `V7`, missing account, mismatched chart template, partial failure, and
  read-only permissions.

Acceptance:

- `ND` can be completed with one reviewed account mapping and no report mapping.
- `V7` cannot be marked ready without both account and PP30 mappings.

### Phase 7 — Review, activation, and expense recovery

Likely files:

- workflow review screen
- `apps/web/src/features/expenses/ExpensesPages.tsx`
- shared API error/deep-link logic
- expense review model/specs

Tasks:

- [ ] Render final per-code readiness and overlap/effective-date warnings.
- [ ] Use outcome label `ยืนยันและเปิดใช้งาน Tax Profile`.
- [ ] Refetch and remain on review when activation loses a race.
- [ ] Add `ตั้งค่าภาษี` CTA to the VAT Tax Code blocker.
- [ ] Validate same-company relative `returnTo`.
- [ ] Return and refetch the expense selector after activation.
- [ ] Preserve human review for the suggested source-line code.

Focused check:

- API/web integration plus browser journey from blocked expense through setup and back.

Acceptance:

- No user needs a copied direct URL or hidden page link to recover from the blocker.

### Phase 8 — Integration, accessibility, and handoff

Tasks:

- [ ] Verify desktop and mobile sidebar/stepper/action bar.
- [ ] Verify keyboard/focus/`aria-current`/field error associations.
- [ ] Verify loading, error, empty, stale, read-only, and duplicate-submit states.
- [ ] Verify no existing advanced bookmark or active configuration changes behavior.
- [ ] Run contracts/API/web typechecks and focused suites.
- [ ] Run the complete UAT journey with a fresh legacy-style zero-account company and a newly onboarded
      company.
- [ ] Update linked specs/plans/checklist and task memory with evidence.

## 6. Impact and Regression Checklist

### Product/journey

- [ ] Thai standard and SAP/ERP users do not enter the wrong path accidentally.
- [ ] Existing drafts are visible and explicitly selectable.
- [ ] The primary CTA order is clear on every page.
- [ ] Advanced users retain direct maintenance access.

### Navigation/access

- [ ] Settings parent, overview child, active state, mobile drawer, and browser back work.
- [ ] Settings card/sidebar/direct route predicates cannot drift.
- [ ] Tax-only, ledger-only, combined, and read-only permissions are covered.
- [ ] Feature-off behavior is consistent with entitlement stripping.

### Contracts/backend

- [ ] Readiness reuses activation validation.
- [ ] Preset creation is additive and idempotent.
- [ ] No new cross-company account reference path exists.
- [ ] No new final mutation bypasses ledger/tax permissions or audit.

### Ledger/chart

- [ ] New-company chart provenance still skips writes.
- [ ] Existing zero/missing/conflicting charts keep current safety rules.
- [ ] Suggestions bind account IDs only after company chart resolution.

### Tax/report

- [ ] External code remains profile-scoped.
- [ ] Effective windows and default-profile overlap remain enforced.
- [ ] Non-deductible VAT never enters claimable PP30 totals.
- [ ] Active/issued snapshots remain immutable.

### Expense/source

- [ ] Tax Code selector filters by active status, direction, context, and document date.
- [ ] Return flow does not lose unsaved source-document work without warning.
- [ ] Receipt/supporting-only boundaries remain unchanged.

### UI quality

- [ ] No guided page contains all maintenance forms/tables.
- [ ] One primary CTA per page.
- [ ] Disabled CTA has visible reason.
- [ ] Thai copy explains business outcomes before internal codes.

## 7. Verification Commands

Use the smallest focused commands first, then package gates:

```bash
corepack pnpm --filter @watchdog-bms/contracts build
corepack pnpm --filter @watchdog-bms/web test
corepack pnpm --filter @watchdog-bms/web typecheck
corepack pnpm --filter @watchdog-bms/api test
```

Add a focused browser/UAT path:

```text
blocked VAT expense
→ setup CTA
→ prerequisites
→ chart preview/review/apply
→ WatchDog preset
→ reviewed mappings
→ activation
→ return to expense
→ applicable Tax Code visible
```

Record exact pass/fail evidence in task memory. If a full suite cannot run, record the exact blocker and
the focused checks that did run.

## 8. Rollout

1. Navigation reachability.
2. Read-only workflow/readiness.
3. Chart workflow.
4. Accounting-approved WatchDog preset and mapping review.
5. Activation and expense recovery deep link.

Keep existing advanced pages throughout. Do not redirect old URLs or remove existing APIs in this work.

## 9. Stop Conditions

Stop and request one precise owner/accounting decision if:

- the domestic preset's claimability/evidence policy is not approved;
- the reviewed mapping manifest does not contain a required role;
- an account/report rule would need to be guessed;
- a requested shortcut would auto-activate configuration;
- route visibility and backend permission would disagree;
- completing the workflow would require rewriting active or issued history.
