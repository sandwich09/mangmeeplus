# SAP-Compatible Transaction Tax and Account Determination Plan

## Status

Phases 0-9 are implemented and locally verified as of 2026-07-14. Canonical checklist item: [[plans/master-implementation-checklist|Master Implementation Checklist]] 11B remains open for productive-company configuration review and the final accountant-owned full-period acceptance fixture.

Implementation evidence: expanded item-11B API tests 239/239, tax AI adapter tests 16/16, full API 1,990/1,990, full Web 286/286, full AI Gateway 357/357, contracts/schema/typechecks/builds, upgraded and fresh 64-migration paths, seed, and authenticated browser journeys passed. Independent reviews found no P0 and every P1 was fixed/re-audited. Exact commands, boundaries, and remaining owner acceptance work are in [[agent-memory/sap-transaction-tax-account-determination-11b|Agent Memory 11B]].

Do not activate the built-in SAP templates directly. They intentionally bootstrap as `DRAFT`/`REVIEW_REQUIRED` without guessed accounts or report boxes. `PARTIALLY_DEDUCTIBLE` also remains fail-closed until the company supplies an explicit percentage and destination split policy.

## Linked Specs

- Primary spec: [[specs/sap-compatible-transaction-tax-account-determination-spec|SAP-Compatible Transaction Tax and Account Determination Spec]]
- Thai tax: [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]]
- Verified Thai baseline: [[specs/tax-2026-verified-rules|Thai Tax Verified Baseline]]
- Ledger: [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Period Closing Spec]]
- Sales documents: [[specs/accounting-documents-spec|Accounting Documents Spec]]
- Expenses: [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
- Procurement/AP: [[specs/procurement-supplier-ap-spec|Procurement, Supplier, and Accounts Payable Spec]]
- Inventory: [[specs/inventory-mvp-spec|Inventory MVP Spec]]
- Fixed assets: [[specs/fixed-assets-spec|Fixed Assets Spec]]
- Permissions: [[specs/permission-matrix|Permission Matrix]]
- Business use cases: [[product/business-use-cases|Business Use Cases]] BUC-11B

## Purpose

Replace the narrow global `O7`/`OX`/`O0` implementation with a company-profile, line-level, SAP-compatible transaction-tax model connected to:

```text
source document/evidence
-> resolved tax treatment
-> tax components/events
-> account determination and balanced journal
-> ภ.พ.30/ภ.พ.36 boxes
-> period reconciliation and review
```

The implementation must cover domestic purchases and sales, imports, imported services, exports, exempt/non-taxable/deferred/non-deductible cases, customs/excise components, and corrections without overloading one VAT code with unrelated tax regimes.

## Current Repository Facts and Gaps

- `AccountingOutputTaxCode` is a global `O7 | OX | O0` union and Prisma enum.
- Tax Code is stored at accounting-document header; document lines have rate/category but no code/profile snapshot.
- Current output tax sync retains `O7`/`O0`/`OX`, but ภ.พ.30 logic does not produce explicit boxes 1–9.
- Ledger posting receives VAT totals but drops `outputTaxCode`; `JournalLine.taxCode` exists but generated lines do not populate it.
- Default ledger behavior posts positive output VAT to `2210-01` and input VAT to `1280-00` from amount alone.
- Generic custom posting rules are two-line gross mappings and do not safely represent multi-line tax components.
- Credit-note tax events are negative, but ledger normalization still treats non-receipt documents as an invoice event and does not carry correction direction/source through account determination.
- No SAP profile/version, line-level mixed-code support, import/export evidence model, tax-account rule, report-box rule, or source-tax-ledger reconciliation run exists.
- Implemented tax permission keys and older permission-matrix/spec names are not fully aligned; Phase 0 must choose canonical existing keys and reconcile docs/role grants rather than creating duplicates.
- Existing item 11A migration and historical snapshots must remain auditable and backward compatible.

## Implementation Rules

- Existing patterns first; no new dependency unless current libraries cannot satisfy a required artifact.
- Keep SAP aliases external and company/effective-date scoped.
- Keep stable tax semantics independent from external code text.
- Keep tax configuration, tax account determination, source posting, and report mapping as separate versioned decisions.
- Use decimal-safe string money and existing money helpers.
- Put authoritative Tax Code on source line; header is derived summary only.
- Fail closed on missing evidence, account, report mapping, rate conflict, or ambiguous active rules.
- Preserve filed snapshots and posted journals; corrections use adjustment/reversal paths.
- Keep AI Gateway read-only and API-mediated.
- Add focused tests with each phase and one runnable integration check for non-trivial behavior.
- Update [[agent-memory/sap-transaction-tax-account-determination-11b|Agent Memory 11B]] throughout implementation.

## Phase 0: Reconcile Current Contracts and Freeze Fixtures

### Goal

Establish repo truth and executable business fixtures before schema changes.

### Tasks

- Inventory all `AccountingOutputTaxCode`, `vatMode`, `vatRate`, `taxCategory`, `TaxEvent`, posting-source, posting-rule, journal, PP30/PP36, purchase/import, and correction call sites.
- Confirm source ownership for sales, expenses, procurement/vendor bills, inventory capitalization, fixed assets, payment timing, and first-pass `TradeTaxEvidence` in tax module.
- Reconcile `permission-registry.ts`, role grants, controllers, permission matrix, and tax/ledger specs; record canonical keys before adding routes.
- Capture current SAP profile fixtures:
  - legacy ERP output `O7/O0/OX` plus conflicting legacy `O1=10%`;
  - current S/4 output `O1/O0/OX/WS` and input/import/deferred examples;
  - custom company profile with a renamed code.
- Capture accounting fixtures for domestic sale/purchase, mixed invoice, import goods, imported service/PP36, export, non-deductible input, credit note, debit note, and receipt payment.
- Define rounding/tolerance fixture values and effective-date boundaries.
- Confirm existing account ids/roles and list required-but-unmapped semantic account roles.
- Record exact migration behavior for issued/filed/posted legacy rows.

### Tests/Evidence

- Contract/search inventory is recorded in agent memory.
- Fixture table includes expected tax base, tax amount, sign, account roles, report boxes, and evidence state.
- No code mutation in this phase except test fixtures when explicitly approved.

### Exit Criteria

- No unresolved ownership, timing, sign, account, report-box, or migration question blocks Phase 1.
- Product/accounting fixture expectations are reviewable without reading code.

## Phase 1: Shared Semantics and Pure Resolution Logic

### Goal

Introduce stable domain language without changing production persistence yet.

### Tasks

- Add shared named types/constants for source system/profile, regime, direction, treatment, transaction context, account role, evidence status, and report-box amount source.
- Define profile-backed `TaxCodeDefinition` and line-level tax snapshot contracts.
- Add pure functions for:
  - effective-dated code lookup;
  - profile/direction conflict detection;
  - rate/mode/treatment validation;
  - evidence requirement evaluation;
  - tax component calculation and sign;
  - header `NONE | SINGLE | MIXED` summary;
  - account-rule specificity/ambiguity detection;
  - PP30/PP36 report contribution preview.
- Preserve the legacy `O7/O0/OX` API contract behind an explicit compatibility adapter; do not spread dual logic into use cases.

### Tests

- Legacy `O7=7%` and current `O1=7%` resolve to one internal standard-output treatment in different profiles.
- Legacy `O1=10%` and current `O1=7%` do not collide.
- `O0`, `OX`, and `WS` remain distinct at zero tax.
- Mixed lines derive `MIXED` header and separate tax groups.
- Ambiguous profile/rule/effective date fails closed.
- Credit/debit sign and receipt no-code invariants pass.

### Exit Criteria

- Shared contracts build.
- Pure fixture suite passes without database or network.
- One compatibility boundary owns all legacy enum translation.

## Phase 2: Persistence, Migration, and Seed Profiles

### Goal

Persist versioned profiles, definitions, account/report rules, line snapshots, evidence, and reconciliation state safely.

### Tasks

- Add `CompanyTaxCodeProfile`, `TaxCodeDefinition`, `TaxAccountDeterminationRule`, `TaxReportMappingRule`, `TradeTaxEvidence`, `TaxReconciliationRun`, and `TaxReconciliationLine` models.
- Extend tax-relevant source lines and Tax Event/journal contracts with profile/code/treatment/version snapshots.
- Prefer relations plus snapshots; do not make mutable config the only historical evidence.
- Seed inactive template profiles for SAP ERP legacy and current S/4 Thailand.
- Seed default PP30 mappings and reviewed baseline domestic account roles; do not activate missing import/deferred/customs/excise accounts.
- Backfill unambiguous legacy `O7/O0/OX` rows; mark contradictions `NEEDS_REVIEW`.
- Keep existing filed tax snapshots and posted journal lines immutable.
- Add dual-read feature/config boundary for migration comparison.

### Tests

- Prisma validate/generate.
- Fresh database applies every migration and seed.
- Legacy database fixture migrates without destructive rewrite.
- Unique/effective-window/account-rule/check constraints reject invalid states.
- Company and branch isolation passes.

### Exit Criteria

- Fresh and legacy migration paths pass.
- No template is active when required account/report mapping is absent.
- Ambiguous history is preserved and review-gated.

## Phase 3: Tax Configuration and Account-Determination APIs

### Goal

Allow reviewed company setup before tax resolution becomes authoritative.

### Tasks

- Implement profile/code list, detail, import-preview, create/update, activate, and retire use cases.
- Implement account-rule and report-rule list/update/preview use cases.
- Validate SAP code imports by profile, direction, rate, effective date, and source checksum.
- Activation verifies reviewer, evidence source, code uniqueness, required accounts, and report mappings.
- Split tax configuration permission from ledger mapping permission; do not hide both behind one guard.
- Audit all create/import/review/activate/retire actions.
- Emit outbox events only after final state mutation.

### Tests

- Permission/ABAC/company/branch tests.
- Stale preview/checksum and overlapping effective-date tests.
- Import conflict and missing-account/report-rule tests.
- Audit/outbox payload redaction tests.

### Exit Criteria

- A company can activate a complete profile and cannot activate an incomplete/ambiguous profile.
- Read-only roles cannot mutate configuration.

## Phase 4: Line-Level Sales, Purchase, and Correction Integration

### Goal

Make line Tax Code authoritative across existing source modules.

### Tasks

- Extend accounting-document, expense, procurement/vendor-bill, and applicable manual flows with line-level code/profile snapshots.
- Resolve allowed codes by transaction context, date, direction, and evidence state.
- Recalculate grouped base/tax totals and derive header summary.
- Preserve supplier VAT facts separately from input-claimability decision.
- Update tax invoice/receipt boundary: plain receipt stays no-code; receipt/tax invoice uses tax-document lines.
- Update credit/debit notes to inherit original line snapshots and correct sign.
- Reject correction-against-correction and incompatible code/rate changes.
- Keep issued source snapshots immutable.

### Tests

- Standard/zero/exempt mixed sale and mixed purchase.
- VAT included/excluded rounding and tolerance.
- Claimable/pending/non-deductible purchase treatments.
- Credit/debit/void/receipt idempotency and sign.
- API/web manual paths use identical validation.

### Exit Criteria

- Every issued tax-relevant line has an active snapshot or explicit review block.
- Header code is never used as the calculation source.

## Phase 5: Import, Export, and Foreign-Service Evidence

### Goal

Cover import goods, imported services/PP36, and export zero-rate evidence without inventing legal classifications.

### Tasks

- Add trade-tax evidence create/review/verify flows using existing attachment primitives.
- Import goods: link supplier invoice, goods receipt, customs entry, duty/excise/other tax, import VAT, payment, and capitalization destination.
- Imported service: link foreign supplier/service, payment, exchange rate, PP36 liability/payment, and input-claim evidence.
- Export: link tax invoice, customs/shipment/foreign-use/payment evidence and zero-rate eligibility.
- Store authoritative entered/assessed amounts separately from calculated preview.
- Block zero-rate or input claim when activated evidence policy is incomplete.
- Prevent duplicate evidence/event use across source records.

### Tests

- Import goods with duty + import VAT + inventory capitalization.
- Import goods with expense/asset destination.
- PP36 liability and later claimable input release.
- Export complete/missing/rejected evidence.
- Duplicate customs entry, PP36 payment, and export declaration tests.

### Exit Criteria

- All three trade contexts create reproducible evidence-backed tax components and review state.
- No automatic tariff/privilege decision exists.

## Phase 6: Ledger Tax Account Determination

### Goal

Generate balanced, code-aware, correction-safe journals from source and tax rules.

### Tasks

- Carry profile/code/treatment/context/correction source through `LedgerSourcePostingInput`.
- Resolve generic source posting and tax account rules into one preview.
- Populate `JournalLine.taxCode` and immutable tax snapshots.
- Replace amount-only output/input VAT inference with reviewed account-role resolution.
- Preserve existing `2210-01`/`1280-00` only as reviewed defaults.
- Support pending/non-deductible VAT, PP36 components, customs duty, excise, and capitalization destinations.
- Reverse credit-note components and original journal linkage; debit note increases original treatment.
- Reject missing/ambiguous accounts with `posting_error`; never use suspense silently.
- Ensure custom posting rules can express multi-line tax components or remain ineligible for tax-relevant sources.

### Tests

- Domestic sale/purchase examples balance and use configured accounts.
- O0/OX create no VAT amount line but preserve code/report semantics.
- Credit note reverses revenue/AR/tax; debit note increases.
- PP36, import duty/VAT, non-deductible, and capitalization journals balance.
- Idempotency, closed period, missing account, and existing-journal tests.

### Exit Criteria

- Every tax-relevant posting is balanced, code-aware, source-linked, and account-rule-versioned.

## Phase 7: Tax Events, PP30/PP36 Boxes, and Reconciliation

### Goal

Make tax reports reproducible and reconcilable against source and G/L.

### Tasks

- Generate tax events per source tax group/code, not one header code per document.
- Preserve zero-rated/exempt bases and correction signs.
- Implement PP30 boxes 1–9 and explicit report mapping rules.
- Implement PP36 preparation facts and link eligible input release.
- Keep WHT/customs/excise regimes separate while allowing common source refs.
- Generate source-vs-event-vs-journal-vs-report reconciliation runs.
- Add blocking review issues to tax filing and accounting close checks.
- Preserve filed/closed snapshots and route later differences to adjustment/amended workflows.

### Tests

- PP30 mixed standard/zero/exempt fixture.
- Domestic/import claimable input fixture.
- PP36 no-double-count fixture.
- Source/Event/G/L/report exact match and each mismatch class.
- Filed/closed period behavior and correction after filing.

### Exit Criteria

- PP30/PP36 output is explainable by code and source line.
- Reconciliation differences are visible, classified, and cannot be silently ignored.

## Phase 8: Web Workspaces

### Goal

Provide complete setup, document, evidence, and reconciliation journeys.

### Tasks

- Settings > Tax Codes profile/import/review/activation UI.
- Settings > Tax Account Determination matrix and posting/report preview.
- Line-level Tax Code controls on applicable sales/purchase/manual flows.
- Import/export/foreign-service evidence forms and review queues.
- Tax reconciliation screen with source/Event/G/L/report comparison.
- Loading, empty, validation, conflict, permission, inactive-profile, and period-lock states.
- Source/evidence/account/report deep links.

### Tests

- Component/model tests for code filtering, mixed summaries, and previews.
- Browser journeys for domestic mixed sale, purchase claimability, import, PP36, export, correction, and reconciliation.
- Read-only/permission and zero-console-error checks.

### Exit Criteria

- Finance/accountant can complete every acceptance journey without direct database or API intervention.

## Phase 9: Compatibility, Verification, and Handoff

### Goal

Prove safe migration and close item 11B only with full evidence.

### Tasks

- Run legacy enum vs new resolver dual-read comparison on representative records.
- Migrate unambiguous rows; export review queue for ambiguous rows.
- Verify fresh database and upgraded legacy database.
- Reconcile a full period containing sale, purchase, import, imported service, export, and corrections.
- Run API/web/build/typecheck/focused/full suites.
- Run authenticated browser smoke for setup, source entry, posting, report boxes, evidence, and reconciliation.
- Update related specs/plans/checklist/roadmap/business use cases/agent memory with actual implementation evidence.
- Keep old compatibility path until compare evidence and rollback plan pass; remove it in a later explicit cleanup.

### Exit Criteria

- All acceptance scenarios pass.
- No P0/P1 accounting, tax, tenant, permission, migration, or reconciliation issue remains.
- Checklist 11B may be checked only after evidence is recorded.

## Review Checklist

- [ ] SAP external code is never used as global business meaning.
- [ ] Legacy ERP and current S/4 profiles coexist without code collision.
- [ ] Tax Code is line-level and issued snapshots are immutable.
- [ ] Standard, zero-rated, exempt, non-taxable, deferred, reverse-charge, claimable, pending, and non-deductible treatments remain distinct.
- [ ] Domestic sales/purchases, imports, imported services, exports, and corrections have executable fixtures.
- [ ] VAT, WHT, customs duty, excise, and CIT support are not conflated.
- [ ] Account determination uses existing chart accounts and fails closed when roles are unmapped.
- [ ] Tax-relevant custom posting rules preserve multi-line tax components.
- [ ] Credit/debit notes and voids use correct original source/sign.
- [ ] PP30 boxes and PP36 facts are reproducible by source line and code.
- [ ] Import/export/PP36 evidence gates are explicit and audited.
- [ ] Source, Tax Event, G/L, and report totals reconcile.
- [ ] Closed/filed periods route differences to reversal/adjustment/amended flow.
- [ ] Permissions, company/branch scope, audit, outbox, and sensitive metadata boundaries pass.
- [ ] API/web contracts and loading/error/permission states are verified.
- [ ] Fresh and upgraded database paths pass.
- [ ] Agent memory and source-of-truth docs reflect actual implementation status.

## Definition of Done

- Company can import or configure SAP/WatchDog/custom tax profiles, review conflicts, and activate only complete effective-dated mappings.
- Source lines resolve deterministic tax snapshots and support mixed-code documents.
- Domestic sale/purchase, import goods, imported service/PP36, export, non-deductible, and correction flows post correctly.
- Generated journals carry Tax Code metadata and use reviewed tax accounts.
- PP30/PP36 preparation preserves zero/exempt/import/adjustment distinctions.
- Reconciliation proves source = Tax Event = G/L = report contribution or produces a blocking classified issue.
- Existing item 11A data is migrated or review-gated without historical rewrite.
- Focused/full tests, builds/typechecks, migration/seed, runtime smoke, and authenticated browser journeys pass.
- Master checklist 11B, roadmap, related specs/plans, business use cases, and agent memory are updated with evidence.

## Required Verification Commands

Use repo scripts where available and record exact results:

```bash
pnpm --filter @watchdog-bms/contracts build
pnpm --filter @watchdog-bms/api typecheck
pnpm --filter @watchdog-bms/api build
pnpm --filter @watchdog-bms/api test
pnpm --filter @watchdog-bms/web typecheck
pnpm --filter @watchdog-bms/web build
pnpm --filter @watchdog-bms/web test
pnpm --filter @watchdog-bms/api exec prisma validate --schema prisma/schema.prisma
pnpm --filter @watchdog-bms/api exec prisma generate --schema prisma/schema.prisma
git diff --check
```

Also require:

- fresh PostgreSQL migration + seed;
- legacy item 11A fixture migration;
- runtime/API smoke for every transaction context;
- database constraint smoke for ambiguous/invalid config;
- authenticated browser smoke with zero console errors;
- monthly reconciliation fixture including domestic sale/purchase, import, PP36, export, credit note, and receipt payment.

## First Handoff Prompt

```text
Implement Master Checklist item 11B from:
- docs/specs/sap-compatible-transaction-tax-account-determination-spec.md
- docs/plans/sap-compatible-transaction-tax-account-determination-plan.md

Read AGENTS.md and the Ponytail skill first. Start with Phase 0 and Phase 1 only.

Re-check current code and dirty worktree. Do not overwrite unrelated changes. Freeze executable fixtures for legacy SAP ERP O7/O0/OX, current S/4 O1/O0/OX/WS, domestic purchases/sales, mixed invoices, import goods, imported services/PP36, export, non-deductible input VAT, credit/debit notes, and plain receipts. Then add shared stable tax semantics and pure profile-resolution/account/report-preview logic behind one legacy compatibility adapter.

Do not add broad persistence/UI work until Phase 0 ownership, timing, sign, account, report-box, evidence, and migration questions are closed. Keep SAP code external/company-scoped, Tax Code line-level, ledger and tax ownership separate, money decimal-safe, AI read-only, and missing config fail-closed. Run focused contracts/domain tests and update docs/agent-memory/sap-transaction-tax-account-determination-11b.md with evidence and next phase.
```

## Risks and Mitigations

- Same external code means different rate across SAP versions. Mitigation: profile/direction/effective-date composite identity.
- Productive SAP tenant differs from templates. Mitigation: import-preview and accountant-reviewed activation; templates inactive by default.
- Header migration invents line meaning. Mitigation: backfill only uniform unambiguous rows; otherwise `NEEDS_REVIEW`.
- Zero-rated/exempt/non-taxable collapse because tax is zero. Mitigation: stable treatment and explicit report rules.
- Custom posting rule loses VAT split. Mitigation: tax account determination merged into posting preview and tax-relevant eligibility checks.
- Credit note posts as positive invoice. Mitigation: original-line snapshot/sign and original journal linkage tests.
- Import VAT/customs duty double-counted in cost or claim. Mitigation: separate assessed components, destination account role, and reconciliation.
- PP36 payable and input claim net invisibly. Mitigation: separate events/journal lines and evidence-gated release.
- Filing and ledger drift. Mitigation: source/Event/G/L/report reconciliation blockers before filing and close.
- Legal/config changes over time. Mitigation: effective dating, source metadata, reviewer, version snapshots, no historical rewrite.
- Scope expands into customs tariff or e-filing engine. Mitigation: keep authoritative amount/evidence accounting in scope and legal determination/submission out of scope.

## Resolved Owner Decisions

- Design covers all transaction taxes for purchase, sale, import, imported service, export, return, and correction contexts.
- SAP Tax Code is an external company/profile alias, not a global WatchDog enum.
- The existing chart of accounts is reused through semantic account roles and reviewed mapping.
- Web is the final configuration/review/mutation surface; LINE/AI remain read-only/explanatory.
- Item 11A remains completed as the narrow receipt/output-code compatibility slice; item 11B owns the full line-level/account/report integration gap.
