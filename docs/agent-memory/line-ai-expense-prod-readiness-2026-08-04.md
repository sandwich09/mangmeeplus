# Agent Memory: line-ai-expense-prod-readiness-2026-08-04

Status: Assessment complete; owner decisions A/B/C implemented on branch `launch-prep/line-ai-expense` (d5fcabf7, 5752dd55, 2d37f1f3, 360a072e) + final cross-item review closed
Owner: thawatchai (decision owner)
Scope: Production-readiness audit for launching ONLY the LINE AI company-expense set (expenses, receipts, reimbursements) with conditions: (1) employee-usable by default, (2) Thai tax default / data stored tax-shaped so enable-later needs no migration, (3) include/exclude impact list.

## Verdict

NOT ready to deploy today. Feature code for expense/receipt capture is near-ready; blockers are deploy/process-side plus one scope reality: reimbursement claims cannot be created via LINE (web-only journey by design).

## Conditions

1. Employee default permissions: MET at company level. Onboarding seeds explicit entitlement rows; DEFAULT_ENABLED_FEATURE_KEYS (system-partner-management/domain/feature-registry.ts:21-31) includes expenses, reimbursement, ai_line_assistant, dashboard_notifications. STAFF system role (auth/permission-registry.ts:833-845) carries full capture + reimbursement self set. Residual: employee creation requires picking >=1 role (no preselect); default ADMIN cannot assign STAFF role (OWNER-only provisioning); multi-company non-OWNER users are hard-blocked from the whole LINE surface (process-line-webhook.use-case.ts:484).
2. Thai tax default / no-migration: STRUCTURALLY MET regardless of entitlement — onboarding bootstraps Thai chart of accounts + CompanyVatRegistrationState + branch 00000 in one transaction; ExpenseRecord stores vatMode/inputVatClaimStatus always; enable-later = idempotent tax-event sync + ledger backfill (recompute, not migration). BUT thai_tax/double_entry_ledger/expense_auto_post are explicitly OFF (enabled=false rows) for new companies. Decision needed: add thai_tax(+ledger) to defaults (1-line) vs accept toggle-later. Only true capture-time data gap: payee entity kind (PND3 vs PND53) not captured. Claimable input VAT (TAX_INVOICE) hard-fails at FINAL confirm without active tax profile + reviewed account determination rules (needs thai_tax + double_entry_ledger packs).
3. Reimbursement via LINE: DOES NOT EXIST. LINE has capture + correction + approver read-only list. Claim create/approve/pay is web-only (live-verified 2026-07-28); links LINE-captured expenses via linkedExpenseId. Chat-based claim creation = net-new feature, no spec.

## Blockers (verified against code at HEAD 799e0fc1)

- B1 Prod compute at 0; deployed build 6d66bdc7 (2026-07-19) predates all P1/P2 hardening → fresh full deploy of promoted image mandatory.
- B2 Launch scope not on main (origin/main 461 commits behind develop); deploy-production.yml only accepts refs reachable from main; protected main needs independent reviewer approval.
- B3 Reimbursement writes production-quiesced; legacy approval path throws 409 legacy_reimbursement_approval_path_disabled; CC2 two-phase evidence (race/rollback/real-PG) incomplete → unquiesce not authorized.
- B4 Deploy hard-gates unmet: SECURITY_ALERT_TOPIC_ARN (no SNS topic in ap-southeast-1); AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF needs real DPO/legal evidence (this launch IS the AI feature).
- B5 Real-LINE UAT debt: employee QR-link→message E2E, correction incident script retest, uncaptioned photo, real PDF, re-extract after Sonnet config fix — all untested on a real OA; UAT runs unsigned direct images (d94a62be, 2026-08-04 07:23 ICT).

## Must-fix / decide before launch

- Redis: prod secret exists but no ElastiCache found; rate limiting mandatory + fail-closed → dead Redis kills LINE AI turns.
- RDS below baseline: single-AZ, 7-day retention, deletion protection OFF (owner cost approval pending).
- Production shared LINE OA: no provisioning runbook (one webhook per channel → prod OA must be distinct from UAT; QR/LIFF/rich menu; UAT links don't carry over).
- ~~Runoff constraint~~ RESOLVED 2026-08-04 (item C below): post-onboarding DISABLE now succeeds for every sellable family under freeze-in-place — the family stops working, existing data stays stored and dormant, residual/in-flight work never blocks the disable, and a re-enable resumes where it froze. Enable-later AND disable-later are both possible, so DEFAULT_ENABLED_FEATURE_KEYS is no longer a one-way door (still worth setting to the intended launch subset so customers do not see menus they did not buy). Only platform invariants (employee_access, company_settings — and their submenus) stay undisableable. One caveat: re-enabling `expense_auto_post`/`double_entry_ledger` restamps the activation cutoff, so postings pending at the freeze resume through the guarded backfill, not the automatic drain (see item C).
- Legacy fail-open: zero-entitlement-row companies evaluate as entitled to everything; new onboarding is safe; if any legacy prod company exists, run F2 normalization first.
- AI budget: 2,000 THB/month default, fail-closed, silent mid-month stop, admin-console-only visibility → size the cap + assign a watcher.
- Substitute receipt: no-receipt claim lines hard-require ISSUED ใบรับรองแทนใบเสร็จ artifact at confirm → exercise in UAT or restrict guidance to receipt-attached claims.
- PDPA boundary: verify the 90-day AI purge sweep can never touch expense attachments/extractions (5-year tax evidence). One focused check.
- Rollback runbook: canary auto-rollback trap (don't poll routes during bake); migrations forward-only.

## Known non-blockers (accepted/ship-as-is)

- LINE PDF gets no OCR prefill (image-only on LINE path; PDF OCR is web re-extract only) → draft still created for manual review.
- Voice messages silently dropped (no reply) — should at least get an unsupported reply eventually.
- WHT derivation defects + PP30 boxes zero until CompanyTaxCodeProfile activated (RA-16); ledger posting blocked RA-01/RA-02 — fine while ledger off, backfill exists.
- Satang rounding uses JS float Math.round (works for typical magnitudes; decimal.js later).

## Include / Exclude (launch matrix)

INCLUDE: expenses(+submenus), reimbursement (web journey), ai_line_assistant (hard gate for entire LINE surface incl. receipt upload), dashboard_notifications, employee_access, company_settings, workflow_automation (recommended; reimbursement notifications ride auto-enabled templates), decide thai_tax+double_entry_ledger posture. Infra: api webhook + shared OA, ai-gateway, workers + Redis, attachment storage, web workspace (expenses, reimbursements, notifications, settings/signature+substitute-receipt).
EXCLUDE (graceful): expense_auto_post (pending postings accumulate; guarded backfill on enable), banking (payment = manual record), sales_documents, procurement, inventory, product_catalog, reports, crm + per-company line_oa (employee path uses shared OA via ExternalIdentity; excluding crm empties dashboard = cosmetic), tax filing surfaces (ภ.พ.30/ภ.พ.36/50ทวิ) even if thai_tax capture config is on.

## Artifacts

- Full audit output: workflow run wf_b1af1271-29b (15 agents, 6 dimensions + 8 adversarial verifications + completeness critic), 2026-08-04.
- Key sources: feature-registry.ts, create-company-onboarding.use-case.ts:153-221, process-line-webhook.use-case.ts:484,500-505,2031-2096, runoff-matrix.catalog.ts:170,217, prisma-reimbursement.repository.ts:1289, infra/prod-ecs-express/deploy.sh:82-83,164-165, docs/agent-memory/uat-environment.md, production-u5-live-prerequisites.md.

## Next

1. Owner decisions: thai_tax+ledger ON at launch vs toggle-later (both directions now reversible — item C); final DEFAULT_ENABLED_FEATURE_KEYS subset; reimbursement leg = web-only OK?; RDS/Redis cost approvals; SNS alert destination; AI budget cap sizing.
2. Close CC2 reimbursement evidence → unquiesce path.
3. Promotion: merge to main (independent review) → signed CI build → real-LINE UAT acceptance list → U5 prerequisites → deploy.
4. Provision production LINE OA + runbook.

## Implemented 2026-08-04 — payee entity kind (PND3 vs PND53), branch `launch-prep/line-ai-expense`

Owner decision: capture the WHT payee's taxpayer class at expense review from day one, so a company
that turns tax filing on later never re-enters it and needs no data migration. This closes the one
true capture-time data gap named in condition 2 above (RA-18) and the two one-line defects in the
same flow (RA-19 partial).

- **Stored fact**: `ExpenseRecord.vendorEntityKindSnapshot` — reuses enum `BuyerEntityKind`
  (`JURISTIC` / `INDIVIDUAL`), nullable, no default, no backfill. Migration
  `20260804190000_expense_payee_entity_kind` is hand-written and idempotent
  (`ADD COLUMN IF NOT EXISTS`) because the pre-existing `20260728120000_stock_movement_single_reversal`
  drift still blocks `prisma migrate dev`; apply with `prisma db execute` + `migrate resolve --applied`.
- **Required at confirm**: `validateConfirm` (`expense-status.logic.ts`) refuses an expense with
  `whtAmount > 0` and no class. This is the load-bearing half of "no re-entry": the class is writable
  only pre-confirm (`UpdateExpenseDraftUseCase` rejects CONFIRMED) and CONFIRMED only transitions to
  VOIDED, so without the confirm rule the null → PND53 fallback would be a permanent misfiling with no
  in-product correction path. Reimbursement-projected expenses are unaffected — they are materialised
  with `whtAmount` zero (`materialize-claim-expenses.service.ts:45`).
- **Derivation**: `sync-tax-events.use-case.ts` — `INDIVIDUAL → PND3`, `JURISTIC → PND53`, `null →
  PND53` for rows confirmed before this release. Nothing is inferred from the tax ID: a 13-digit Thai
  TIN does not distinguish the two classes and no such helper exists in the repo. No cross-form
  supersede branch: because the class cannot change after confirmation an expense can never move
  between ภ.ง.ด.3 and ภ.ง.ด.53 after its first sync, and the code comment records that adding a
  reclassification seam later must also assert the *other* form's period lock.
- **Defects fixed in the same pass**: the WHT rate now comes from `ExpenseLine.whtRate`, **scaled from
  the expense-side fraction to the tax-side percent** (`calcLineTotals` does `taxable * whtRate`, while
  `WhtIncomeCategory.defaultRate` and `vendor-bill.use-case.ts:670` both mean percent — emitting the
  raw fraction would print an อัตรา of 0.03 on the ใบแนบ and split groups against AP-sourced events).
  A document mixing rates keeps `null` (one header event can only carry one rate, and the ใบแนบ groups
  by payee + category + rate). `grossAmount` is the taxable sum of the **withholding lines only**, not
  the header taxable, so gross x rate reconciles with the withheld amount on a mixed document.
  `payeeSnapshot.branchCode` now carries `vendorBranchCodeSnapshot` on both the VAT-input and WHT
  events instead of `null`.
- **LINE capture unchanged**: the AI never guesses the class; LINE-captured expenses arrive with the
  field null and it is asked for at review only when the document withholds tax.
- **payeeSnapshot direction (recorded decision)**: on a purchase-side `VAT_INPUT` event
  `payeeSnapshot` is the vendor — name and taxId already worked that way, so `branchCode` follows them.
  `TaxEvent.sellerBranchCode` (added by `20260804180000`) still has zero readers/writers and remains
  the sell-side field; the รายงานภาษีซื้อ work (RA-14/RA-17) must not treat it as the purchase-side
  seller branch.
- **Not done (deliberate)**: RA-20 (AP supplier-payment → tax event) is untouched; `incomeCategoryCode`
  is still the free-text expense category; the accountant CSV export gained no column; the field is not
  in `financeOnlyFields` (it sits with `vendorTaxIdSnapshot`, which any draft owner may edit); the PATCH
  body is still a plain type alias so the enum is not validated at the boundary (pre-existing for
  `vatMode`, `inputVatClaimStatus`, `taxEvidenceStatus`, `sourceDocumentType` on the same route).
  Pre-existing CONFIRMED expenses with WHT stay on the PND53 fallback — there is no backfill or
  reclassification path, and the confirm rule only protects new captures.

Files: `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260804190000_expense_payee_entity_kind/migration.sql`,
`packages/contracts/src/expenses.ts`, `apps/api/src/modules/expenses/domain/models/expense.model.ts`,
`apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`,
`apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts`,
`apps/api/src/modules/tax/domain/ports/source-reader.port.ts`,
`apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts`,
`apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts`,
`apps/api/src/modules/expenses/domain/logic/expense-status.logic.ts`,
`apps/web/src/features/expenses/expenses.model.ts`, `apps/web/src/features/expenses/ExpensesPages.tsx`,
`apps/web/src/common/i18n/workspace-dictionary.ts`, plus specs
`sync-tax-events-wht-form.use-case.spec.ts` (new, registered in `apps/api/package.json`),
`expense-source.adapter.spec.ts`, `expense-status.logic.spec.ts`,
`expense-draft-vat-decouple.use-case.spec.ts`, `prisma-expense.repository.void.spec.ts`,
`apps/web/src/features/expenses/expenses.model.spec.ts`.

Verification: `prisma validate` valid; `cd apps/api && npx tsc --noEmit` = **8** errors, all
pre-existing and unrelated (7x TS2339 in `company-vat-registration.logic.spec.ts`, 1x TS18048 in
`prisma-reimbursement.repository.ts`; both files unmodified on this branch, so the repo-wide lint gate
is red for inherited reasons and wants a separate fix); `apps/web` tsc clean. Focused API specs
(sync-tax-events-wht-form, expense-source.adapter, expense-status.logic,
expense-draft-vat-decouple.use-case, prisma-expense.repository.void) = 59/59 pass. Full
`apps/web` spec glob = 655/655 pass. Mutation-checked: reverting the percent scaling, the WHT-line
gross base, the Prisma line `include`, the line `whtAmount > 0` filter, the write allowlist entry, the
`materialFields` entry, the use-case pass-through, or the confirm requirement each turns a test red.
Not run: full API suite (out of scope), real-DB migration apply (no DB in this session).

---

## Item B — Thai tax accounting ON by default for new companies (2026-08-04)

Owner decision: a new company must land with the Thai tax/accounting journey already usable, not
behind two operator toggles and an admin tax-config wizard.

Decisions:
- `DEFAULT_ENABLED_FEATURE_KEYS` (`system-partner-management/domain/feature-registry.ts`) += `thai_tax`,
  `double_entry_ledger`, `workflow_automation`. Onboarding writes an explicit row for EVERY canonical
  key with `enabled = DEFAULT_ENABLED_FEATURE_KEYS.includes(parentFeatureKey(key))`, so the 6
  `workflow_automation.*` submenus follow their parent automatically — no separate submenu list.
  Chosen now, before customers onboard, because the runoff constraint refuses post-onboarding DISABLE
  for these families (enable-later is possible, disable-later is not).
- `expense_auto_post` stays OFF. `FEATURE_DEPENDENCIES` declares `expense_auto_post ⇒
  double_entry_ledger`; `unmetFeatureDependencies` only flags an ON child with an OFF prerequisite, so
  turning the prerequisite on does not drag the child on and nothing in `set-partner-features` breaks.
  Postings keep accumulating as pending and the enable-later guarded backfill stays the design.
- RA-16 fix path taken as written: onboarding now seeds an **ACTIVE** `CompanyTaxCodeProfile` from the
  built-in `WATCHDOG_TH_DOMESTIC_EXPENSE_V1` template (Tax Codes `V7` claimable 7% + `ND`
  non-deductible 7%), its account-determination rules, and its ภ.พ.30 report mappings — inside the
  SAME onboarding transaction, right after the chart bootstrap it maps onto.
  New: `apps/api/src/modules/tax/application/services/tax-config-bootstrap.service.ts`.
- No mapping logic was invented (the safety rail did not have to be used). Required roles/boxes come
  from `requiredAccountAssignments` / `requiredReportMappings` — the same functions `activateProfile`
  uses to decide a profile is complete — and the accounts come from `TH_SME_COA_V1_MAPPING_MANIFEST`,
  the chart template's own reviewed manifest (`INPUT_VAT_CLAIMABLE → 1154-00`,
  `NONDEDUCTIBLE_VAT_EXPENSE → 5390-02`). If a required role ever loses its manifest entry, or the
  mapped account is missing/inactive/non-posting, the bootstrap throws
  (`tax_config_account_role_unmapped` / `tax_config_account_missing`) and the whole onboarding rolls
  back rather than committing a half-mapped company.
- Rules are written with `transactionContext = null` and `sourceModule = null`: one rule per role
  serves expense, procurement and accounting, which is exactly the least-specific match
  `selectTaxAccountRule` ranks last. Definitions/rules land `ACTIVE`, but the review attestation is
  **`reviewedByUserId = 'system:tax-config-bootstrap'`** (exported
  `TAX_CONFIG_BOOTSTRAP_ACTOR_USER_ID`, not an FK), the same seam shape as
  `WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID`: the owner's temporary password is still in the handoff
  envelope at that moment, so stamping the owner would fabricate a human review of a tax account
  mapping. `createdByUserId` stays the owner, matching the chart bootstrap. Account rules also carry
  `sourceMetadataJson = { bootstrap: 'company-onboarding', builtInTemplate, mappingManifestVersion }`
  — the only provenance column a rule has (`TaxReportMappingRule` has none).
- Profile `effectiveFrom` = **1 January of the year BEFORE onboarding**. The first draft used 1 January
  of the onboarding year, which is a zero-width window for a company created on 1 January and
  contradicted its own six-month rationale: `listProfiles` filters `effectiveFrom <= documentDate`
  (`prisma-transaction-tax.repository.ts:267`), so a company onboarded 2026-02-10 uploading a
  legitimately claimable 2025-12-18 tax invoice would have hit 422 "No active Tax Code profile"
  (`transaction-tax-config.use-case.ts:476`) — the exact failure this item removes. An earlier window
  is strictly more permissive and this is the company's only profile. `isDefault` stays `false`,
  matching `createProfileFromTemplate`, so no `overlapping_default_profile` constraint is created for
  later profiles. Exactly one ACTIVE profile exists, which is what lets `buildPreview` select it with
  no explicit `profileId`.
- The seam refuses to run twice (`tax_config_already_bootstrapped` when the company already has any
  `CompanyTaxCodeProfile` row), mirroring `persistCompanyChartOfAccounts`'s `coa_semantic_conflict`.
  Unreachable today (one call site, fresh `companyId` per run) but the exported function is a general
  seam and `@@unique([companyId, sourceSystem, sourceProfileKey, effectiveFrom, version])` would not
  stop a second call in a later calendar year.
- **VAT-registration consistency (recorded decision, not a side effect):** the seeded `V7` claimable
  code is handed to every new company, including ones that have not answered the VAT question
  (`CompanyVatRegistrationState` is created with `version = 0` twelve lines earlier and
  `Company.vatRegistered` keeps its `false` default). Accepted because onboarding already presumes VAT
  registration (the head-office branch is created `isVatEstablishment: true`), the code must be picked
  by a human (no server-side default), `inputVatClaimStatus` starts `NEEDS_REVIEW`, receipts/substitute
  receipts are refused a Tax Code, and `expense_auto_post` is OFF so nothing posts automatically. If
  the owner wants below-threshold companies to see only `ND`, that is a follow-up gated on the VAT
  answer, not a change to this bootstrap.
- **Not changed on purpose:** no guard was added against a second ACTIVE profile. Two overlapping
  ACTIVE profiles under different source identities are explicitly permitted by
  `sap-compatible-transaction-tax-account-determination-spec.md:376` ("multiple profiles may coexist
  for migration or multiple SAP company codes"), and `transaction-tax-config.use-case.spec.ts` already
  documents the resulting semantics (explicit definition disambiguates; bare external code fails). So
  the seeded ACTIVE profile makes the pre-existing "ambiguous profile" trap reachable one admin click
  earlier, and the mitigation is operational: the runbook now tells operators to retire the seeded
  profile before activating a fuller one, and how to re-point a seeded account rule (narrow
  `transactionContext`, since an equivalent open-context rule is refused 409 and the seeded ACTIVE rule
  is immutable with no per-rule retire endpoint).

Constraint recorded: **only NEW companies get this.** No backfill was written for existing companies —
the 7 UAT companies keep their explicit `enabled=false` rows for `thai_tax` / `double_entry_ledger` /
`workflow_automation` and have no tax profile. They must be re-onboarded or toggled by hand
(`docs/runbooks/uat-feature-package-provisioning.md`), and their tax config still has to be built
through the admin wizard.

Verified unchanged: `autoEnableWorkflowTemplatesForCompany` is idempotent (`existing.length > 0 →
continue`) and entitlement-blind, so entitling `workflow_automation` cannot make it double-fire. The
outbox drain stays entitlement-blind too — `outboxEventFeatureKey` (`tax → thai_tax`,
`journal|period → double_entry_ledger`) feeds `LaunchShadowProbe` only and never gates dispatch, so
the only change is that shadow observations now record an entitled feature, which is the point.

Files: `apps/api/src/modules/system-partner-management/domain/feature-registry.ts`,
`apps/api/src/modules/tax/application/services/tax-config-bootstrap.service.ts` (new),
`apps/api/src/modules/system-onboarding/application/use-cases/create-company-onboarding.use-case.ts`,
`apps/api/src/modules/system-onboarding/application/use-cases/create-company-onboarding.spec.ts`,
`docs/runbooks/uat-feature-package-provisioning.md`,
`docs/specs/accounting-tax-readiness-assessment.md`,
`docs/agent-memory/f0-inventory-contracts-permissions.md`,
`docs/agent-memory/f0-entitlement-cohorts-baseline.md`.

Verification: `cd apps/api && npx tsc --noEmit` = **8** errors, byte-identical to the pre-existing
baseline (7x `company-vat-registration.logic.spec.ts`, 1x `prisma-reimbursement.repository.ts:1316`) —
nothing new. `create-company-onboarding.spec.ts` 22/22 pass, including the new focused case which
asserts the four entitlement flags, the seeded ACTIVE profile/codes/rules/mappings, and then feeds the
seeded config to `resolveTransactionTaxPreview` for a `DOMESTIC_PURCHASE` V7 line and asserts
`errors === []`, `claimability === 'CLAIMABLE'`, the account resolves to `1154-00`, and ภ.พ.30 boxes 6/7
carry 100.00 / 7.00 — i.e. the exact 422 this item removes. Also re-ran clean: tax config/template/
transaction-tax/chart-template specs (54/54) and the entitlement-adjacent set
(role-management, get-access-matrix, feature-gate, shadow-surface, permission-resolver,
set-partner-features, normalize-entitlements, entitlement.helper, seed-launch-gates). Not run:
`prisma validate` (no schema change — none was needed), full API suite, real DB onboarding.

Next: no code follow-up for this item. Remaining-items candidates — (1) existing/UAT companies need a
manual toggle + tax-config path, deliberately not automated here; (2) `docs/specs/
feature-entitlement-launch-matrix.md` / `.json` record launch-gate seed states only and carry no
onboarding-default field, so nothing there needed changing; (3) **ภ.พ.30 is seeded on the purchase side
only** — the template has no OUTPUT code, so `requiredReportMappings` emits box 6/7 and never box 1/5,
and a launch-package company cannot issue a tax invoice anyway (`sales_documents` is OFF). Result:
`box8TaxPayable = 0.00` and `box9TaxOverpaid` = the whole input VAT for any period with expenses. That
is arithmetically right for a purchases-only period but reads as a refund position, so it needs an owner
decision: seed an OUTPUT code, add `sales_documents` to the package, or label the reconciliation page
input-only. Recorded in `accounting-tax-readiness-assessment.md` §2 and under RA-16 (ค).

Review pass (2026-08-04, same day): 14 findings reviewed. Fixed — system review actor + rule
provenance, `effectiveFrom` moved to the previous 1 January, re-run precondition, spec chart mock now
honours `code`/`status`/`isPosting`, spec comment corrected (it exercises `resolveTransactionTaxPreview`,
i.e. the configuration half; `buildPreview` adds per-document evidence/trust errors on top), runbook
starter-package paragraph de-staled + two operating rules, readiness-table ภ.พ.30 row scoped to
box 6/7, stale "9 keys" notes in `f0-inventory-contracts-permissions.md` / `f0-entitlement-cohorts-baseline.md`
dated. Rejected — a code guard against a second ACTIVE profile (spec:376 permits coexistence, see
above).

## Item C — post-onboarding DISABLE allowed, freeze in place (2026-08-04)

Owner decision (verbatim): "ควรปิดได้และหยุดทำงาน แต่ถ้ามีข้อมูลเดิมค้างก็แค่ปิดไว้ไม่บล็อค".

Semantics adopted: a sellable feature family may be switched OFF at any time after onboarding. The
feature STOPS (permissions stripped at the one resolver chokepoint, surfaces hidden, APIs answer the
honest `feature_not_enabled` refusal, LINE AI replies its Thai refusal when `ai_line_assistant` is off).
Existing data is neither exported, archived nor migrated — it stays stored, dormant and untouched.
Residual/in-flight work NEVER blocks the disable. A later re-enable resumes from the frozen state.

What changed (branch `launch-prep/line-ai-expense`):

- `feature-launch/domain/runoff-matrix.catalog.ts` — deleted `runoffPreflight`, `IN_SCOPE_FAMILIES`
  (`{'reports'}`), the `RunoffPreflight` verdict type and the `RUNOFF_PREFLIGHT_MODE`/`GLOBAL_BLOCK`
  owner-veto switch. The file keeps the per-family aggregate and `RUNOFF_MATRIX_VERSION` as
  DOCUMENTATION plus the snapshot stamp; it is no longer a gate.
- `set-partner-features.use-case.ts` — deleted the 422 `feature_disable_pending_runoff` branch. Kept:
  the `platform_feature_not_disableable` refusal, the dependency cascade (preview → explicit confirm →
  atomic child disable → `feature_cascade_incomplete` backstop), the `DISABLE_REQUESTED`→`OFF`
  lifecycle with its immutable cutoff snapshot, and the HIGH-risk audit row (actor, changedKeys,
  cascadedOffKeys, cutoffAt).
- `runoff-lifecycle.ts` — `buildRunoffRoots` no longer throws for the six families with
  `PRE_CUTOFF_RUNOFF_ONLY` rows (freeze-in-place grants no continuation, so an empty membership is the
  literal truth for every family); `canEnumerateRunoffRoots` deleted.
- `entitlement-exception.use-case.ts` (repair path) — deleted the `repair_disable_pending_enumeration`
  refusal and `unenumerableTargets`; `DISABLE_DEPENDENT` is now always `available`.
- `get-partner-detail.use-case.ts` — `canDisable` is now `!platformInvariant`; the safe-OFF-pending
  Thai reason is gone (the platform-invariant reason stays). The web's directional lock therefore
  allows ON→OFF for sellable families with no UI change.
- `production-a5-evidence.logic.ts` — `safeOffAdmissionHash`/`allowListHash` now hash the
  freeze-in-place admission policy (every key except the platform invariants) instead of the
  per-surface runoff verdict.
- `apps/web/src/common/api/api-error-message.ts` — `feature_disable_pending_runoff` copy deleted with
  the branch that threw it.
- Docs: `feature-entitlement-runoff-matrix.md` header note, `feature-entitlement-decoupling-spec.md`
  §1 amendment bullet.

Verification (`cd apps/api`):
- `npx tsc --noEmit` → the 8 known baseline errors only (7x `company-vat-registration.logic.spec.ts`,
  1x `prisma-reimbursement.repository.ts:1316`).
- `set-partner-features.use-case.spec.ts` 73/73. New focused case: `expenses` (4 BLOCKED matrix rows,
  7 runoff-root rows, existing `expenses.categories` data mocked) disables → row `enabled=false`,
  submenu row untouched at `true`, snapshot roots `[]` → re-enables → `enabled=true`, epoch bumped
  once. Also: cascade disables parent+child atomically with `cascadedFrom` recorded; a submenu
  disables alone; the effective-ON evaluator still decides DISABLE_REQUESTED vs OFF.
- `runoff-matrix.catalog.spec.ts` + `runoff-lifecycle.spec.ts` 49/49 (drift guard vs the approved
  matrix JSON kept; empty snapshot now asserted for every family).
- Freeze semantics verified with existing specs: `permission-resolver.spec.ts` strips permissions for
  `enabled:false` rows (incl. OWNER grants); `report.use-cases.spec.ts` + `auth.guard.spec.ts` +
  `entitlement.helper.spec.ts` answer `feature_not_enabled` rather than 500;
  `process-line-webhook.use-case.spec.ts` keeps the Thai AI refusal; `expense-auto-post.use-case.spec.ts`
  extended to the real post-disable row shape (`enabled:false` with activation timestamps) and proves
  the drain skips the company instead of reading its expenses. Notification delivery sweep and the
  workflow outbox drain stay entitlement-blind by design (shadow-only, per-row error isolation).
- `partner.controller.spec.ts`, `expense-auto-post.use-case.spec.ts`, `production-a5-evidence.logic.spec.ts`
  and the web `system-partners.logic.spec.ts` re-run green.
- ~~NOT run (no local database)~~ RUN in review round 1: the local Postgres was 5 migrations behind
  HEAD (pre-existing drift from A4/A4b/item A), so `prisma migrate deploy` applied
  `20260804150000_ai_turn_intent_correction`, `..._reimbursement_line_compatibility`,
  `20260804170000_reimbursement_cc2_projection_source`, `20260804180000_company_tax_identity_step0`,
  `20260804190000_expense_payee_entity_kind`. Then, per file:
  `entitlement-exception.use-case.spec.ts` 6/6 PASS (this is the real evidence for the rewritten
  repair path: `DISABLE_DEPENDENT` now writes the disable through the lifecycle with an empty
  snapshot) and `runoff-lifecycle.race.spec.ts` 16/16 PASS.
  KNOWN, PRE-EXISTING: those two files interfere when run in the SAME command — node:test runs spec
  files as concurrent processes against one shared database, and the exception spec's teardown removes
  the `User` row the race spec borrows for `AuditLog.actorUserId`, so 8 race tests fail with
  `AuditLog_actorUserId_fkey`. Not caused by this change (the race fixture borrows the lowest existing
  user id by design) and not a product defect; run DB-backed spec files one at a time.

### Review round 1 (2026-08-04) — the freeze had holes in three background workers

The disable command was admitted correctly, but three paths that bypass the resolver chokepoint kept
the "frozen" family working and MUTATED its stored data after the cutoff. Fixed:

- `ledger/.../expense-auto-post.use-case.ts` — **the blocker.** `expense_auto_post` is a top-level
  family, not an `expenses` submenu, and nothing declares `expense_auto_post ⇒ expenses`, so
  disabling `expenses` alone cascaded nothing and the drain (which mints its own worker context with
  hardcoded permissions) kept creating GENERATED journals from, and writing `postingStatus`/
  `journalEntryId` onto, the frozen family's `ExpenseRecord` rows. `AUTO_POST_REQUIRED_FEATURES` now
  includes `'expenses'`. Chosen over declaring the contracts dependency ON PURPOSE: a cascade would
  switch `expense_auto_post` off and its re-enable would restamp `updatedAt`, i.e. the activation
  cutoff — see the caveat below. `AUTO_POST_ENTITLEMENT_FILTER` derives from the same list, so the
  historical backfill refuses honestly (`expense_auto_post_not_enabled`, 403) while `expenses` is off.
- `line-ai/.../drain-line-ledger.use-case.ts` — the synchronous webhook refuses when
  `ai_line_assistant` is off, but the pending-entry drain accepted on `line.ai.query` alone (an
  UNGATED `pack.core.basics` permission the disable never strips), so an in-flight turn was still
  answered and PUSHED into the customer's chat after the cutoff. It now re-reads the entitlement at
  execution time with the webhook's own `lineAssistantDisabled` predicate (exported, not copied) and
  acks the entry `refused` / `reason: 'feature_disabled'`.
- `reimbursements/.../reimbursement-projection-reconciler.service.ts` — its intent queries are
  cross-tenant and it runs under a synthetic context with `permissions: []`, so it advanced claims to
  READY_FOR_PAYMENT, materialized claim-born expenses and enqueued notification outbox events for a
  frozen family. It now skips a company whose `reimbursement` is off (both the projection and the
  cancellation loop), leaving the intents PENDING so a re-enable resumes them where they stopped. The
  canonical evaluator is used, so an unconfigured zero-row company still fails OPEN and its partial
  projections are not stranded.

Also fixed in the same round:

- `set-partner-features.use-case.ts` + `get-partner-detail.use-case.ts` — the surviving platform
  refusal was exact-key only, so the five platform SUBMENUS (`employee_access.employees|roles|overview`,
  `company_settings.branches|security`) became disableable for the first time — the deleted preflight
  had covered them by inheriting the parent verdict. Disabling `company_settings.security` would have
  stripped `account.password.change`/`account.identity.link|unlink`. Both sites now resolve
  `parentFeatureKey(featureKey)`.
- `domain/feature-registry.ts` — the comment above `DEFAULT_ENABLED_FEATURE_KEYS` still gave the
  one-way-door ("post-onboarding DISABLE is refused ... reversing is not") as the RATIONALE for the
  default-ON set, and still claimed the platform keys were per-company disableable. Both corrected.
- `apps/web/.../system-partners.logic.ts` — the deleted runoff refusal copy survived as the
  `disableBlockForChange` fallback (reachable when an affected key has no readiness row at all).
  Replaced with mixed-version/reload copy.
- Docs: supersession notes on `feature-entitlement-launch-matrix.md` (its `Close preflight` column
  still read BLOCKED for all 16 families), `feature-entitlement-decoupling-spec.md` (§1 U5 Safe-OFF
  bullet, and the 2026-08-01 amendment items 4 and 5 — item 5's `repair_disable_pending_enumeration`
  had no withdrawal marker at all — plus the `RUNOFF_PREFLIGHT_MODE` revert path),
  `feature-entitlement-decoupling-plan.md:247` (a `[MUST]` on the deleted `IN_SCOPE_FAMILIES`), and
  `feature-entitlement-decoupling-implementation.md:289` (the advertised veto lever).

**Caveat on "a re-enable resumes where it froze" — not literal for pending auto-postings.**
`CompanyFeatureEntitlement.updatedAt` is `@updatedAt` and IS the auto-post activation cutoff
(`expense-auto-post.use-case.ts` reads it; the candidate SQL requires `confirmedAt >= activationAt`).
A disable and a re-enable both restamp it, so expenses confirmed-and-pending BEFORE the freeze fall
outside the automatic drain afterwards. They are not lost: they are exactly the population the
guarded preview+confirm backfill covers (`expense-backfill.use-case.ts`). Operator rule: after
re-enabling `expense_auto_post` or `double_entry_ledger`, run the backfill to drain the frozen queue.
Recorded in the runbook's reverting section.

Not changed, with reasons: `RUNOFF_MATRIX_FEATURES`/`isNonFeatureBucket` are now read only by their
own drift spec — kept deliberately as the coverage/erratum record the matrix header points at, and
`RUNOFF_MATRIX_VERSION` (same file) is still stamped on every snapshot. The workflow outbox drain and
the notification sweep stay entitlement-blind by design.

Next: nothing blocking. Optional follow-ups — (1) the partner screen could say "ปิดแล้วข้อมูลเดิมยังอยู่"
next to a disable toggle (copy only, no logic); (2) `docs/specs/feature-entitlement-runoff-matrix.json`
is now a historical survey artifact — its BLOCKED/PRE_CUTOFF counts gate nothing and only the drift
spec reads them; (3) the DB-backed spec files cannot share one `tsx --test` invocation (see the
`AuditLog_actorUserId_fkey` note above) — worth giving the race fixture its own throwaway `User`
rather than borrowing the lowest existing id, in a separate change.

## Final review round (2026-08-04)

Fixed:

- `expenses/.../prisma-expense.repository.ts` (`updateExpense` `materialFields`) — DEADLOCK.
  `vendorEntityKindSnapshot` was in the substitute-receipt lock set, but the payee taxpayer class is
  never printed on the ใบรับรองแทนใบเสร็จ artifact (`substitute-receipt.logic.ts`), so the lock bought
  no document integrity while making a whole class of expense unconfirmable: confirming a
  substitute-reliant expense requires the evidence already ISSUED
  (`expense-draft.use-case.ts:380`), and `validateConfirm` REQUIRES the class whenever
  `whtAmount > 0` (`expense-status.logic.ts:199`). Removed from the set, with the rationale in place.
  `prisma-expense.repository.void.spec.ts` now asserts the OPPOSITE — the class stays writable while
  evidence is ISSUED, and a printed field (`vendorNameSnapshot`) still locks — so a future re-add
  fails a test.
- `scripts/production-a5-evidence.logic.ts:1116` — the freeze-in-place admission projection compared
  the raw key against `PLATFORM_INVARIANT_FEATURE_KEYS`, so the five platform submenus were published
  as clear-to-off in `allowListHash`/`safeOffAdmissionHash` while `set-partner-features.use-case.ts:143`
  refuses to write them. Now resolves `parentFeatureKey(featureKey)` first, matching both the command
  path and `get-partner-detail.use-case.ts:103`. New case in `production-a5-evidence.logic.spec.ts`
  pins the allowlist hash to the parent-resolved projection.
- `apps/web/.../expense-review-validation.ts` — the client mirror had no payee-class rule, so the form
  let a withholding expense reach a confirm the API refuses. New blocking issue on
  `vendorEntityKindSnapshot` (`expenses.v_payee_kind_required`, th+en) using the same predicate as the
  form's `withholdsTax` (stored `whtAmount > 0` or any line `whtRate > 0`), passed in through the
  existing `opts` shape. `ExpensesPages.tsx` wires the issue note/`aria-invalid` onto the existing
  select. Spec extended.
- `reimbursements/.../reimbursement-projection-reconciler.service.ts:32` — `frozen()` only checked
  `reimbursement`, but the orchestrator materializes and CONFIRMS `ExpenseRecord` rows per claim line,
  so a frozen `expenses` family was still written into. Both keys are now checked off the SAME
  entitlement query, because contracts forbid a reimbursement ⇒ expenses dependency edge (declaring
  one would cascade `reimbursement` off and restamp its activation cutoff on the re-enable) — the same
  reasoning as `AUTO_POST_REQUIRED_FEATURES`. Spec extended with the expenses-off case.
- `line-ai/.../drain-line-ledger.use-case.ts` — a queued `kind: 'turn'` refused because
  `ai_line_assistant` went off was acked terminally and dropped SILENTLY. The claim delay is min-idle
  (seconds), not the 15-minute context window, so the user was usually still waiting and the
  assistant just looked hung; the old comment claiming the window "has expired long before that
  anyway" was arithmetically false and is corrected. An in-window turn now gets the same Thai
  `feature_disabled` refusal the synchronous webhook sends, through the drain's own
  `lineReply.sendPush` + `buildTextMessage` seam. Terminal ack kept. Out-of-window turns and
  `sub_request`/`waiting_user` keep the old silent behaviour. Window test extracted to
  `inContextWindow`, shared with the clarify-expiry branch. Spec asserts push in-window / no push
  out-of-window.
- `tax/.../tax-config-bootstrap.service.ts` (comments only) — stopped calling
  `TH_SME_COA_V1_MAPPING_MANIFEST` "reviewed". Every suggestion in it is `reviewStatus
  REVIEW_REQUIRED` by construction (`chart-template.logic.ts:153` errors otherwise). Reworded: it is
  the standard template mapping, unreviewed by a human; bootstrap deliberately adopts it as the launch
  default and stamps `TAX_CONFIG_BOOTSTRAP_ACTOR_USER_ID` as the attestation seam.
- `apps/api/package.json` — registered `ledger/application/use-cases/expense-auto-post.use-case.spec.ts`
  in the `test` file list. Pre-existing gap: the `expenses`-frozen guard added this round had zero CI
  coverage despite having a spec.

Recorded, NOT fixed:

- **`TaxEvent.payeeSnapshot.branchCode` has no reader yet.** The field is captured on every event, but
  ใบแนบ grouping (`wht-report.logic.ts:31-38`) keys on `name|taxId|incomeCategoryCode|whtRate` with no
  branch component, so withholdings against different tax branches of one payee merge into a single
  group, and the WHT certificate renders the caller's own snapshot rather than the grouped one.
  Acceptable for launch precisely because the FACT is already stored — adding branch to the grouping
  key later is a pure read-side change with no migration and no data loss. There is no ใบแนบ generator
  in the codebase yet, so nothing is currently mis-filed.
- **ภ.พ.30 output boxes 1/2/3/5 are structurally zero for launch companies.** The bootstrapped profile
  is the input-only domestic-expense template and `sales_documents` is excluded at launch, so no output
  VAT ever reaches the form; boxes 8/9 consequently read as refund-due on every filing. Escalated as an
  owner decision under item B rather than patched here — the numbers are arithmetically correct for the
  data that exists, and the question is whether such a return may be filed at all.
