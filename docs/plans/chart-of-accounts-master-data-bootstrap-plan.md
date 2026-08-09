# Chart of Accounts Master Data Bootstrap and Compatibility Plan

## Status

Pre-amendment baseline implementation verified on 2026-07-29. Compatibility fixes, catalog/schema/onboarding,
template-company posting fail-closed behavior, dependency/readiness queries,
existing-company preview/apply APIs, feature/close gates, web UX, and the
read-only all-company audit are implemented and verified. The local reviewed
repair and read-only Source→Tax→G/L→report integration smoke pass. Productive
mapping approval and per-company production preview/apply remain rollout gates.
The 2026-07-31 §10.2.1 VAT-control binding/presentation/close-check amendment is
planned below and is not yet implemented or verified.

## Linked Specs and Evidence

- Primary spec: [[specs/chart-of-accounts-master-data-bootstrap-spec|Chart of Accounts Master Data Bootstrap and Compatibility Spec]]
- Ledger spec: [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Period Closing Spec]]
- Onboarding spec: [[specs/admin-company-onboarding-spec|Admin Company Onboarding Spec]]
- Transaction tax spec: [[specs/sap-compatible-transaction-tax-account-determination-spec|SAP-Compatible Transaction Tax and Account Determination Spec]]
- Banking spec: [[specs/bank-reconciliation-spec|Bank Accounts and Reconciliation Spec]]
- Source analysis: [[research/chart-of-accounts-csv-analysis|Chart of Accounts CSV Analysis]]
- Task memory: [[agent-memory/chart-of-accounts-master-data-bootstrap|Agent Memory]]

## Purpose

Implement the smallest safe path from the reviewed 175-row chart to company master data:

1. fix existing compatibility paths that can silently assign the wrong account or Tax Code header;
2. create one validated template catalog;
3. reuse the current `ChartOfAccount` model and onboarding transaction;
4. add preview/apply/readiness for existing companies;
5. gate automatic posting on reviewed mappings;
6. verify end to end with no partial success or hidden error.

## Confirmed Current Impacts

### Chart/posting

- `1210-00` is built-in Accounts Receivable but means loan receivable in the supplied chart.
- `5310-01` is built-in General Expenses but means salary in the supplied chart.
- `DEFAULT_ACCOUNT_CODES` has ten entries; `4100-01` (revenue) and `2120-01` (payable) match source meaning, while `1110-01`, `1280-00`, `1270-00`, `2130-01`, `2210-01`, and `2210-02` are not the reviewed source equivalents (none of those six codes exists in the source at all).
- Posting rules bind accounts by **code** through `mappingJson.debitAccountCode`/`creditAccountCode`; the `debitAccountId`/`creditAccountId` relation columns are dead, and journal generation resolves accounts by code. A code is therefore a live posting binding.
- The chart update path cannot change `code`/`accountClass`/`normalBalance` (DTO whitelist + use-case guard + terminal repository allowlist) and rejects every update to an `isSystem` row — all six colliding seed rows are `isSystem = true`, so `REPLACE_UNUSED` needs a dedicated repository operation.
- Nine source accounts are contra accounts (`1130-03`, `1420-02`–`1420-05` credit-normal; `4100-03`, `4100-04` debit-normal; `5130-02`, `5130-03` credit-normal). The one-time local import already stored the correct opposite balances — the local DB is the only correct per-row source today; the repository has no import fixture.
- The one-time local import kept six existing rows by code and therefore did not prove semantic consistency. Measured 2026-07-29: the local company holds 180 rows (175 template codes + 5 seed-only codes) with `reportGroup` stored as raw `Group2` including the `Service expesnes` typo on 62 rows; `1210-00` and `5310-01` have **zero** journal/posting/tax/bank references, so both classify `UNUSED_CONFLICT`.
- The local DB predates seed account `2130-01` (11 of 12 seed rows exist), so local reimbursement-settlement fallback posting would already fail with `ไม่พบรหัสบัญชี 2130-01`; reseed before Phase 8 smoke tests.

### Tax Code

- Tax Code templates install definitions only and correctly remain draft/review-required.
- Runtime account mapping already resolves active semantic account roles and correctly errors on missing/ambiguity.
- There is no existing name-based automatic chart-account mapping.
- A legacy web helper still maps VAT mode to `O7/OX/O0` (`O7` is the fall-through default), but its only production call site is an unreachable `TAX_INVOICE` branch of linked-document creation — credit/debit notes copy the source header verbatim and the server enforces CN/DN header = source header. No UI flow can fabricate `O7` over S/4HANA `O1` lines today.
- The real gap: the server never validates that a provided header agrees with line-level Tax Code snapshots, so a direct API call can persist `O7` over authoritative `O1` lines; S/4HANA documents carry a null header by design (`O1`/`O2`/`WS`/`DL`/`DM`/`DN` are unrepresentable in the `O7|OX|O0` enum). The dead fallback branch is a latent landmine for future re-wiring.
- The SAP ERP template ships output-side codes only, and `O1` means 10% in the ERP template vs 7% in S/4HANA (profile-scoped, test-locked); tax-event sync already treats an `O0` header as blocking `AMBIGUOUS_LEGACY_O0`.

### Banking

- `BankAccount.ledgerAccountId` is not a Prisma relation and create/update does not validate tenant/account suitability; `BankAdjustment.ledgerDebitAccountId`/`ledgerCreditAccountId` are equally bare strings and must join the dependency scan.

These are implementation prerequisites, not optional cleanup.

## Implementation Rules

- Follow Ponytail full: one catalog, one bootstrap service, existing transactions/permissions first, no new dependency.
- Do not maintain a second 175-row list in Prisma seed. When the seed switches to the catalog, stamp the seed company's template provenance too (it becomes a template company) — otherwise the removed legacy fallback codes (`1110-01`, `2130-01`, …) break local posting. Reseed local first; the current DB already lacks `2130-01`.
- Do not guess productive account mappings from names.
- Do not rewrite posted journals or filed tax history.
- Every non-trivial parser/comparator/readiness rule receives one focused runnable test.
- Every write is tenant-scoped, permission-checked, audited, transactional, and checksum/CAS guarded.
- Any incomplete mapping fails closed before journal creation.
- Web errors are visible and translated; no console-only failure.

## Phase 0: Freeze the Reviewed Fixture and Accounting Decisions

### Tasks

- [x] Copy a curated normalized representation of the 175 rows into the ledger domain; do not use the absolute Documents path at runtime.
- [x] Normalize typo, BOM, non-breaking spaces, and placeholder bank identities (nine deposit rows `999-9-99999-N`, plus the `นาย…` person placeholder on `1210-00`). Deposit names keep ordinal suffixes (`เงินฝากกระแสรายวัน 1`–`3`, `เงินฝากออมทรัพย์ 1`–`3`, `เงินฝากประจำ 1`–`3`); `1210-00` becomes `ลูกหนี้เงินให้กู้ยืม`; the validator rejects duplicate Thai names.
- [x] Disambiguate the duplicate source name `ค่ารับรอง` without semantic guessing: `ค่ารับรอง (5200-06)` and `ค่ารับรอง (5370-03)`.
- [x] Record the reviewed contra-account overrides per spec §7.3 (`1130-03`, `1420-02`–`1420-05` → CREDIT; `4100-03`, `4100-04` → DEBIT; `5130-02`, `5130-03` → CREDIT); cross-check against the local seed company rows, which already store the correct values — the repository has no import fixture, so the local DB is the only correct per-row source.
- [x] Define per-entry `reportGroup` from normalized `Group2`; the comparator normalizes both sides so the 62 locally stored raw `Service expesnes` values do not become false conflicts.
- [x] Define `TH_SME_COA_V1`, version 1, canonical ordering, and two SHA-256 checksums: `accountsChecksum` (canonical account entries; stored as company provenance and used for apply CAS) and `mappingManifestChecksum` (reviewed mapping manifest with its own version — manifest edits never change `accountsChecksum`).
- [x] Add a catalog validation spec proving 175 unique valid entries.
- [ ] Produce a reviewed mapping manifest for:
  - receivable;
  - payable;
  - employee payable;
  - cash and bank;
  - revenue;
  - expense/cost by source/category;
  - WHT payable/receivable;
  - input/output/deferred VAT;
  - PP36/import/customs/excise roles;
  - suspense.
- [x] Mark every unreviewed mapping as suggestion-only.
- [ ] Record accountant approval before enabling automatic posting.

### Gate

- Catalog checksum and all normalization tests pass.
- All nine contra accounts carry their reviewed normal balance; the validator accepts exactly that exception list.
- No reviewed role points to a missing template code.
- No productive mapping is inferred from name alone.

## Phase 1: Fix Existing Silent Compatibility Risks

This phase lands before automatic chart bootstrap.

### Accounting-document Tax Code header

- [x] Add server-side header/line agreement validation: reject `output_tax_code_line_mismatch` at create and at issue when a provided `outputTaxCode` disagrees with authoritative line codes.
- [x] Remove the unreachable VAT-mode fallback branch in linked-document creation (the `TAX_INVOICE` branch no caller reaches); keep credit/debit-note verbatim header inheritance, which the server already enforces.
- [x] Keep header derivation only when every authoritative line shares one compatible legacy code (already the linked-tax-invoice behavior; make the server authoritative for it).
- [x] Add an API-level regression: S/4HANA `O1` lines + `O7` header payload reject; an `O1` correction keeps a null-or-compatible header. A UI-path-only test passes today by construction and proves nothing.
- [x] Add a read-only data scan for existing header/line mismatches.

Likely files:

- `apps/web/src/features/accounting-documents/accounting-documents.model.ts`
- `apps/web/src/features/accounting-documents/AccountingPages.tsx`
- `apps/api/src/modules/accounting-documents/domain/logic/accounting-status.logic.ts`
- associated specs

### Ledger fallback

- [x] Add a template-company readiness branch before built-in `DEFAULT_ACCOUNT_CODES`. The branch keys on a template-company predicate that returns false for every company until the Phase 3 provenance fields exist — it lands dead in Phase 1 and activates through Phase 3 data, so Phase ordering stays valid.
- [x] Keep legacy fallback only for non-migrated companies during compatibility rollout.
- [x] Return stable mapping errors before reserving a journal number.
- [x] Add regression cases for `1210-00` and `5310-01`.

Likely files:

- `apps/api/src/modules/ledger/domain/logic/posting-engine.logic.ts`
- `apps/api/src/modules/ledger/application/use-cases/journal.use-case.ts`
- focused ledger specs

### Bank ledger link

- [x] Validate same-company, active, posting-enabled cash/bank account in create/update use cases.
- [x] Add stable error mapping and focused tests.
- [x] Prepare schema pre-check for later FK.

### Gate

- S/4HANA header regression is closed.
- Unsafe hard-coded template posting cannot create a journal.
- Invalid bank ledger link cannot persist through API.

## Phase 2: Catalog, Preview, Dependency Scan, and Readiness Domain

### Tasks

- [x] Implement typed `TH_SME_COA_V1` catalog and validator (contra exception list included).
- [x] Implement canonical checksum.
- [x] Implement semantic equality with both-sides normalization (trim/NBSP/whitespace/known typo) per spec §8.
- [x] Implement exact/missing/unused-conflict/in-use-conflict preview, including the global-account shadow check (`companyId` null rows).
- [x] Implement dependency scanner per spec §8: `JournalLine.accountId`, `PostingRule.mappingJson` debit/credit account **codes** (company and global rows — the FK columns are dead), `TaxAccountDeterminationRule.accountId`, `TaxReconciliationLine.journalTaxAccountId`, `BankAccount.ledgerAccountId`, `BankAdjustment.ledgerDebitAccountId`/`ledgerCreditAccountId`, `accountAssignmentsJson` on unposted document/expense/procurement lines and tax events, and parent/child hierarchy.
- [x] Implement computed readiness.
- [x] Keep domain logic free of Nest/Prisma where possible.

Suggested files:

```text
apps/api/src/modules/ledger/domain/catalog/th-sme-chart-of-accounts-v1.ts
apps/api/src/modules/ledger/domain/logic/chart-template.logic.ts
apps/api/src/modules/ledger/domain/logic/chart-template.logic.spec.ts
```

### Gate

- Focused tests prove catalog invariants, collision detection, dependency classification, and readiness.
- Preview output is deterministic for the same database state and template checksum.

## Phase 3: Schema, Contracts, and Repository Integration

### Prisma

No new `ChartOfAccount` columns were required for the original bootstrap scope — `reportGroup`, `normalBalance`, `isPosting`, `isControlled`, `taxCategory`, `cashFlowCategory`, `sourceGroup1`, and `sourceGroup2` already exist, and `LedgerAccountClass` already includes `COST`/`TAX_EXPENSE`/`SUSPENSE`. The later Feature Entitlement Decoupling FIN amendment owns the additive `statementPresentationKey` and role-binding schema required by Spec §10.2.1; it must not alter this plan's completed v1 catalog/checksum.

- [x] Add template provenance fields to `Company` (`chartOfAccountsTemplateChecksum` stores the `accountsChecksum`).
- [x] Add nullable `sourceMetadataJson` to `TaxAccountDeterminationRule` (suggestion provenance; mirrors `TaxCodeDefinition.sourceMetadataJson`).
- [x] Add `@@unique([companyId, id])` to `ChartOfAccount`.
- [x] Add company-scoped optional bank-account relation after a pre-check.
- [x] Add no speculative index: the measured five-company local audit completed in about 1.2 seconds; require production query evidence before adding another index.
- [x] Migration must stop with an actionable pre-check if existing bank links are invalid.

### Contracts

- [x] Add template metadata, preview, conflict, apply, and readiness DTOs (template metadata carries `accountsChecksum` + `mappingManifestChecksum`; apply input carries `acknowledgeConflicts`; apply output carries `acknowledgedConflicts`).
- [x] Add chart summary fields needed by master UI.
- [x] Keep additions backward compatible.

### Repository/service

- [x] Add one bootstrap service that accepts the current Prisma transaction client.
- [x] Persist source groups and controlled status.
- [x] Apply using `createMany`/bounded queries rather than 175 HTTP calls.
- [x] Re-check preview/dependencies inside serializable transaction.
- [x] Assert post-condition count and semantics before commit.

### Gate

- Prisma validate/generate and contract typecheck pass.
- Migration pre-check behavior is tested.
- One row failure produces zero committed rows.

## Phase 4: Company Onboarding Integration

### Tasks

- [x] Call the bootstrap service inside the existing `CreateCompanyOnboardingUseCase` transaction.
- [x] Set explicit transaction options on that transaction (`timeout` ≈ 15 s plus explicit `maxWait`) — it currently runs on Prisma defaults (5 s) and gains the 175-row insert plus post-condition checks.
- [x] Apply the fixed standard template for both new-owner and attach-existing-owner journeys.
- [x] Record template provenance on `Company`.
- [x] Include safe chart metadata/readiness in onboarding result.
- [x] Create onboarding run and success audit only after chart post-conditions pass.
- [x] Preserve the system-admin customer-data boundary.
- [x] Update current inline Prisma test doubles with chart operations.

### Tests

- [x] 175 rows created.
- [x] Attach-existing-owner path also creates 175.
- [x] Chart failure rolls back all onboarding records.
- [x] No partial `COMPLETED` run.
- [x] Response/audit excludes account contents and credentials.

### Gate

- Focused onboarding suite passes.
- Runtime onboarding smoke shows 175 rows for the new company.

## Phase 5: Existing-Company APIs

### Tasks

- [x] Add list-template, preview, apply, and readiness endpoints to the ledger module.
- [x] Reuse `ledger.account.read/manage`.
- [x] Restrict existing-company detail operations to customer membership context.
- [x] Implement checksum/CAS guards (`expectedTemplateChecksum` = `accountsChecksum`); retry a serializable failure (40001) once and return `coa_preview_changed` when the in-transaction re-check diverges from the preview.
- [x] Default apply mode is `MISSING_ONLY`; any conflict blocks by default.
- [x] Implement `acknowledgeConflicts`: with the flag and a matching preview checksum, create only `MISSING` codes, never write a conflicted code, and return every acknowledged conflict.
- [x] Add explicit `REPLACE_UNUSED`; never replace in-use conflicts. Implement it as a dedicated repository operation: the standard update path blocks `code`/`accountClass`/`normalBalance` and rejects `isSystem` rows, and all six colliding seed rows are `isSystem = true`. The replaced row becomes an ordinary company row (`isSystem = false`, H-02 CHECK still satisfied) and prior values are audited.
- [x] Preview asserts no global system account (`companyId` null) shadows a template code; the template is never installed as global rows.
- [x] Await success/failure audit.
- [x] Add Thai translations for stable chart/apply/readiness, posting-rule, bank-link, and Tax Code header mismatch error codes.

### Tests

- [x] permission/tenant isolation;
- [x] preview read-only;
- [x] idempotent exact reapply;
- [x] stale checksum;
- [x] no-write blocking conflict;
- [x] acknowledged `MISSING_ONLY` creates only missing codes and reports every conflict;
- [x] serializable-retry divergence returns `coa_preview_changed`;
- [x] dependency race detected inside transaction;
- [x] bounded error details.

## Phase 6: Posting, Tax, and Feature Readiness

### Posting rules

- [x] Create reviewed company posting rules only for mappings approved in Phase 0.
      **Landed 2026-08-09 as source-specific account bindings, not `PostingRule` rows** — spec §9.2 allows
      either, and the four mappings the owner approved are all per-document, which a flat
      `(documentType, ruleKey) → {debit, credit}` rule cannot express: the expense debit varies by
      category, WHT by payee statutory form, cash by payment method. Binding lives on
      `ExpenseCategory.ledgerAccountCode` (migration `20260809130000_expense_category_ledger_account`).
- [x] Leave unreviewed category/bank/WHT mappings incomplete and visible.
- [x] Resolve account IDs from the newly created company rows.
      Bindings are held as codes and resolved through the existing `findAccountByCode(companyId, …)`
      path at journal-creation time, which is company-scoped by construction.
- [x] Do not copy another company's account IDs.
      `loadExpenseAccountBindings` filters `expenseCategory` by `companyId`, so a category belonging
      to another tenant resolves to nothing and the posting reports `expense_account_unmapped`.

Owner mapping decisions 2026-08-09 (the "Phase 0 approval" for these four):

| บทบาท | ตัดสิน | สถานะ |
|---|---|---|
| บัญชีเดบิตค่าใช้จ่าย | ผูกรายหมวด `ExpenseCategory` | ✅ ลงแล้ว |
| เจ้าหนี้พนักงาน (ใบเบิก) | `2131-09` ค่าใช้จ่ายค้างจ่าย-อื่น ๆ | ✅ ค่าคงที่ `REVIEWED_PAYABLE_CODES` |
| ภาษีหัก ณ ที่จ่าย | แยกตามประเภทผู้รับเงิน (`2132-03` ภ.ง.ด.3 / `2132-04` ภ.ง.ด.53) | ⬜ ยังไม่ทำ — เอกสารที่มี WHT คืน `wht_account_unmapped` |
| เงินสด/ธนาคารตอนจ่าย | resolve จากวิธีจ่ายจริง | ⬜ ยังไม่ทำ — `expense.payment` / `reimbursement.payment` ยังคืน `posting_rule_missing` |

- [ ] WHT payable by payee entity kind — needs the payee's `entityKind` carried into the posting source.
- [ ] Cash/bank from the settlement's payment method / bank account.
- [x] Writer for `ExpenseCategory.ledgerAccountCode` under the existing `ledger.posting-rule.manage`
      permission (the accounting UI is closed this launch, so an API/operator path is what is needed).
      **Landed 2026-08-09**: `GET|PUT /companies/:companyId/posting/expense-account-bindings[/:categoryId]`
      → `expense-account-binding.use-case.ts`. Guarded by `ledger.posting-rule.read|manage` rather than
      `expense.category.manage`, so renaming a category and deciding where its money books stay separate
      duties. Both permissions were already carried by `pack.ledger.view` / `pack.ledger.manage`, so the
      route is reachable without touching the access matrix. Write validates the code against the
      company's own chart (ACTIVE + `isPosting` + not `isControlled`, company rows only — a shared
      system account is never a valid tenant mapping) and audits `from`/`to` at HIGH risk.

### Tax Code

- [x] Keep built-in template install behavior unchanged: profile draft, definitions review-required.
- [x] Defer optional account-role suggestion rows until an accountant approves the mapping manifest; chart creation never guesses or activates them.
- [x] Keep any future suggestion write on the existing repository path that forces `REVIEW_REQUIRED`; no suggestion rows are emitted in this scope.
- [x] Preserve the additive `sourceMetadataJson` provenance seam for future reviewed suggestions; no fabricated provenance is attached to pre-existing productive rules.
- [ ] Implement Spec §10.2.1 VAT-control bindings only through the Feature Entitlement Decoupling Ledger workstream. For exact verified `TH_SME_COA_V1`, zero-form bind all five G/L controls: claimable 1154, pending 1155, refund 1156, gross-output 2135 and net-payable 2137. Keep them on five distinct account IDs across the full company binding history and effective FINAL/explicit/system result; v5 allows no sequential/overlapping alias or colliding FINAL winner. Validate ASSET/DEBIT/TRADE_AND_OTHER_CURRENT_RECEIVABLES for 1154/1156, ASSET/DEBIT/OTHER_CURRENT_ASSETS for 1155 and LIABILITY/CREDIT/TRADE_AND_OTHER_CURRENT_PAYABLES for 2135/2137 plus every ownership/status/posting/control/effective-window/non-overlap invariant. Do not activate any Tax Code/profile/account-determination/report rule. Backfill presentation only on exact verified standard/system rows. Classify all charts deploy-owned with evidence as SYSTEM_MANAGED/CUSTOM_WRITABLE/EXTERNAL_LOCKED/UNRESOLVED, no company-wide form. Reuse each customized-standard row only by provenance + full fingerprint; otherwise provision every missing writable custom role independently without name matching. Locked/unresolved roles dedupe internally but appear as one consolidated prefilled chart exception with child facts and one approval only at the Ledger boundary. Bind dates are role/action-specific; a late earlier open source extends the same account, and Tax-only work never waits. Add exact/custom/external/unknown fixtures, zero-prompt five-role binding/presentation, FINAL/explicit collision, historical/sequential alias and concurrent-provisioning tests. Ledger close inspects only Ledger-owned effective-period VAT projections; it ignores a Tax projection pending solely because Tax is off, and enable-after-closed uses current-open correction.
- [x] Preserve active-rule specificity/priority/effective-date selection.
- [x] Preserve missing/ambiguous fail-closed errors.
- [x] Verify Source → Tax Event → G/L → report reconciliation with the repaired company account IDs.

### Close blockers

- [x] Extend period-close checks per spec §17 invariant 11: open unused-conflict remediation, internally invalid chart rows (class/normal-balance outside catalog rules), suspense usage, invalid tax mapping, and source posting errors block close. Template divergence alone is readiness information and never blocks close — later customization is allowed.

### Feature entitlement

- [x] Extend `SetPartnerFeaturesUseCase` so enabling `expense_auto_post` requires computed readiness in addition to `double_entry_ledger`.
- [x] Return `coa_posting_readiness_incomplete` with missing role keys.
- [x] Do not block manual chart/ledger access when only automatic mappings are missing.

### Gate

- Automatic posting cannot turn on before readiness.
- Reviewed tax profile can activate only after account/report rules pass existing gates.
- Missing mapping produces visible `posting_error` and no journal.
- Close blockers reject exactly the defined conditions and ignore mere template divergence.

## Phase 7: Web Master Data Experience

### System onboarding

- [x] Show standard template metadata/count in success handoff.
- [x] Show translated, visible failure with request reference.

### Company chart settings

- [x] Add searchable/filterable full chart list.
- [x] Remove current 80-row display cap for the master surface.
- [x] Show template provenance and readiness.
- [x] Add preview/apply confirmation.
- [x] Show blocking conflicts and dependency counts.
- [x] Link tax readiness to current Tax Account Determination page.
- [x] Cover loading, empty, forbidden, stale-preview, conflict, server-error, and success states.
- [x] Use `role="alert"` and prevent silent native form aborts.

### Gate

- Browser walkthrough completes with zero console errors.
- No button appears successful when API apply/onboarding failed.

## Phase 8: Existing Data Audit and Repair

### Dry-run command

- [x] Add a read-only command that reports every company without exposing secrets.
- [x] Include chart coverage/conflicts/dependencies, posting readiness, tax mapping readiness, bank-link validity, and legacy header mismatches.
- [x] Save bounded JSON/CSV evidence for review.

### Current local seed company

Measured 2026-07-29 (docker `:15432`): the company holds 180 rows (175 template codes + 5 seed-only codes `1110-01`, `1270-00`, `1280-00`, `2210-01`, `2210-02`); `1210-00`/`5310-01` have zero journal/posting/tax/bank dependencies → both `UNUSED_CONFLICT`; `PostingRule` is empty; the only `BankAccount` has a null ledger link; the DB predates seed account `2130-01`. Expected dry-run shape with both-sides normalization: the six kept seed rows conflict (English names, snake_case report groups), the nine deposit rows conflict once curated names drop placeholders, and the remaining imported rows classify `EXACT`.

- [x] Re-run dry-run against the current local company and confirm it matches the measured shape above.
- [x] Reseed local before smoke tests. The seed now repairs from the single catalog and stamps provenance, so template-company posting fails closed instead of looking for removed legacy fallback `2130-01`.
- [x] Treat the fixed-ID local seed tenant as test-only and use reviewed idempotent upsert repair; do not delete the five pre-existing seed-only accounts or any source/history row.
- [x] Reconcile local posting/tax bindings after repair: all 18 tax-rule references retained their existing company account IDs; no posting rule existed to remap, so both missing expense roles remain visible rather than guessed.
- [x] Re-run VAT expense and source→journal→tax reconciliation smoke.

### Production companies

- [x] Do not auto-apply at migration deploy.
- [x] Apply only after company/accountant preview.
- [x] Do not rewrite posted/filed history.
- [ ] Create explicit review issues for immutable mismatches.

### Gate

- Dry-run has no unexplained conflict.
- Every repair decision has actor, evidence, and verification.

## Phase 9: Verification and Handoff

### Focused checks

```bash
corepack pnpm --filter @watchdog-bms/contracts typecheck
corepack pnpm --filter @watchdog-bms/api exec prisma validate
corepack pnpm --filter @watchdog-bms/api exec prisma generate
corepack pnpm --filter @watchdog-bms/api exec tsx --test \
  src/modules/ledger/domain/logic/chart-template.logic.spec.ts \
  src/modules/system-onboarding/application/use-cases/create-company-onboarding.spec.ts \
  src/modules/ledger/application/use-cases/account.use-case.spec.ts \
  src/modules/ledger/application/use-cases/payment-posting-source.use-case.spec.ts \
  src/modules/accounting-documents/domain/logic/accounting-status.logic.spec.ts \
  src/modules/tax/application/use-cases/transaction-tax-config.use-case.spec.ts \
  src/modules/banking/application/use-cases/bank-account.use-case.spec.ts \
  src/modules/system-partner-management/application/use-cases/set-partner-features.use-case.spec.ts
corepack pnpm --filter @watchdog-bms/api typecheck
corepack pnpm --filter @watchdog-bms/web typecheck
```

Use actual filenames after implementation; register new focused specs in the API test script.

### Runtime integration

- [x] New company onboarding produces 175 accounts.
- [x] Existing-company preview produces no writes.
- [x] Blocking conflict apply produces no writes.
- [x] S/4HANA `O1` tax invoice correction does not fabricate `O7`.
- [x] Reviewed Tax Code profile resolves to company account IDs.
- [x] VAT expense posts and reconciles Source = Tax Event = G/L = report contribution.
- [x] Invalid bank ledger link rejects.
- [x] `expense_auto_post` activation fails before readiness and succeeds after reviewed mappings.
- [x] Browser flow has no silent error or console error.

### Documentation

- [x] Update the linked specs/plans/checklist.
- [x] Record exact commands/results and data-repair decisions in task memory.
- [x] Keep item 10H unchecked until accountant-approved productive mappings and per-company rollout gates pass.

## Rollout Order

1. Phase 1 compatibility fixes.
2. Catalog/domain tests.
3. Additive schema/contracts.
4. Onboarding bootstrap.
5. Existing-company APIs.
6. Posting/tax/readiness integration.
7. UI.
8. Dry-run and environment-specific repair.
9. Enable new onboarding path after runtime evidence.

The order prevents new template companies from entering the unsafe legacy fallback/header paths.

## Definition of Done

- New companies receive the chart automatically with no CSV upload.
- Existing companies can preview/apply safely.
- Semantic conflicts cannot be hidden by duplicate-code skipping.
- Automatic posting cannot run with incomplete/wrong account mappings.
- Tax Code definition, account role, report mapping, and immutable snapshot remain consistent.
- Bank ledger links are company-safe.
- Every failure is visible, stable-coded, and auditable.
- Focused/full checks and runtime/browser evidence are recorded.

## Explicitly Skipped

- General custom CSV import UI.
- Automatic name-based productive account mapping.
- Automatic Tax Code profile activation.
- Automatic rewrite of posted/filed history.

Add these only through separately reviewed scope.
