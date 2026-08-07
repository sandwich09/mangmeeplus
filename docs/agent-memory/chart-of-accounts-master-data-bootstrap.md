# Agent Memory: chart-of-accounts-master-data-bootstrap

Status: IMPLEMENTATION VERIFIED — code, local repair, audit, web, and integration checks pass; productive rollout remains gated on accountant-approved mappings and per-company review.
Owner: Codex / Product / Accounting
Scope: Automatic company chart-of-accounts master bootstrap from the reviewed 175-row Thai SME source, existing-company preview/apply, and compatibility fixes across onboarding, ledger posting, Tax Code/account-role resolution, banking links, feature readiness, UI, migration, and verification.
Decisions:
- Use one read-only `TH_SME_COA_V1` catalog and copy it into company-owned `ChartOfAccount` rows during the existing onboarding transaction. Template rows are ordinary company rows (`isSystem = false`); the template is never installed as global rows (`companyId` null).
- Existing companies preview before apply; semantic conflicts block all writes.
- Catalog stores `normalBalance` per entry as reviewed data with nine contra-account overrides (`1130-03`, `1420-02`–`1420-05` → CREDIT; `4100-03`, `4100-04` → DEBIT; `5130-02`, `5130-03` → CREDIT); the validator accepts exactly that exception list. A pure class→balance formula is wrong for these nine.
- Source name `ค่ารับรอง` is duplicated at `5200-06`/`5370-03`; curated labels append their codes rather than guessing a new accounting category.
- Semantic comparison normalizes both sides (trim/NBSP/whitespace/known typo) so raw stored values (62 local rows keep `Service expesnes` in `reportGroup`) do not create false conflicts; `reportGroup` derives from normalized `Group2`.
- Dependency scan reads code references, not only FKs: `PostingRule.mappingJson` debit/credit **codes** (company + global rows; the FK columns are dead), `BankAdjustment.ledgerDebit/CreditAccountId`, `accountAssignmentsJson` on unposted lines/tax events, plus the original id-based list. Posting resolves accounts by code, so a code is a live binding.
- `REPLACE_UNUSED` is a dedicated repository operation (standard update path blocks code/class/normalBalance and rejects `isSystem` rows; all six colliding seed rows are `isSystem = true`); replaced rows become ordinary company rows with prior values audited.
- Legacy header fix reframed after verification: CN/DN copy the source header verbatim and the VAT-mode→`O7` fallback is unreachable dead code, so the real work is server-side header↔line agreement validation (`output_tax_code_line_mismatch` at create + issue), removing the dead branch, and an API-level regression (a UI-path test passes today by construction).
- Do not use account-name matching as final authority; do not rewrite posted journals or filed tax history automatically.
- Tax templates remain draft/review-required; `upsertAccountRule` already forces `REVIEW_REQUIRED` on every write, so suggestion rules need no schema change (a provenance column is optional later scope).
- Automatic posting remains disabled until computed chart/posting/tax readiness passes.
- P2 decisions (owner-approved 2026-07-29, applied to docs): conflicts block apply by default, but `MISSING_ONLY` + `acknowledgeConflicts: true` + matching preview checksum creates only MISSING codes and reports every conflict; close blockers = open remediation / internally invalid rows / suspense usage / invalid tax mapping / posting errors — template divergence alone never blocks close (plan Phase 6 owns the task); deposit names keep ordinal suffixes (เงินฝากกระแสรายวัน 1–3 ฯลฯ), `1210-00` → `ลูกหนี้เงินให้กู้ยืม`, validator rejects duplicate Thai names; checksum split into `accountsChecksum` (provenance + CAS) and `mappingManifestChecksum` (own version; manifest edits never touch accountsChecksum); onboarding txn gets explicit options (~15 s timeout); serializable apply retries 40001 once then `coa_preview_changed`; Phase 1 fallback branch keys on a predicate that stays false until Phase 3 provenance; seed switch to catalog must stamp the seed company as a template company (else legacy fallback codes break local posting).
- P3 decisions applied: `TaxAccountDeterminationRule.sourceMetadataJson` (nullable, Phase 3) for suggestion provenance; closing spec normal-balance block aligned (SUSPENSE → DEBIT + contra overrides, governed by this spec); onboarding spec corrected — document sequences are provisioned lazily on first use (`documentSequence.upsert` in data-model-core), not in the onboarding transaction.
Open questions:
- Qualified accountant must approve the productive commercial, cash/bank, expense/category, WHT, VAT/PP36/import, and report mappings before automatic posting is enabled.
Artifacts:
- `docs/specs/chart-of-accounts-master-data-bootstrap-spec.md`
- `docs/plans/chart-of-accounts-master-data-bootstrap-plan.md`
- `docs/research/chart-of-accounts-csv-analysis.md`
- `docs/specs/double-entry-ledger-closing-spec.md` (normal-balance drift fix only)
- `docs/specs/admin-company-onboarding-spec.md` (document-sequence accuracy fix only)
Verification:
- Read-only source review: 175 rows, no invalid/duplicate codes, 64 `Service expesnes`, 12 NBSP rows, nine `999-9-99999-N` deposit placeholders + `นาย…` on `1210-00`, nine contra accounts identified.
- Code-verified review 2026-07-29 (three parallel read-only agents + DB inspection, docker `:15432`):
  - `DEFAULT_ACCOUNT_CODES` has 10 entries (`posting-engine.logic.ts:28-39`); no-rule posting silently falls back and posts (`journal.use-case.ts:500-505`); accounts resolve **by code** (`journal.use-case.ts:536`); rules bind codes via `mappingJson` (`posting-engine.logic.ts:52-53`).
  - `ChartOfAccount` already has every template field and `LedgerAccountClass` already has COST/TAX_EXPENSE/SUSPENSE; `@@unique([companyId, id])` absent (to add); update path blocks code/class/normalBalance (`prisma-ledger.repository.ts:117-129`) and rejects `isSystem` rows (`account.use-case.ts:85`); H-02 CHECK + global-account concept exist, zero global rows today.
  - Local company: 180 rows = 175 template codes + 5 seed-only (`1110-01`, `1270-00`, `1280-00`, `2210-01`, `2210-02`); contra rows already CORRECT in DB (no repo fixture exists — DB is the only per-row source); `reportGroup` raw typo on 62 rows; zero deps on `1210-00`/`5310-01` → both UNUSED_CONFLICT; `PostingRule` empty; bank ledger link null; DB predates seed `2130-01` (11/12) so local reimbursement fallback would fail.
  - Header flow: CN/DN copy header verbatim (`AccountingPages.tsx:350`), VAT-mode fallback dead (`:349`), S/4HANA header null by design, server enforces CN/DN header = source (`accounting-status.logic.ts:86`) but never compares header to line snapshots; ERP template output-only; `O1` = 10% (ERP) vs 7% (S/4), test-locked; `O0` header already blocking `AMBIGUOUS_LEGACY_O0`.
  - Tax rails: `tax_account_rule_missing`/`ambiguous` verbatim (`transaction-tax.logic.ts:136-138`), activation gate `tax_profile_incomplete` (`transaction-tax-config.use-case.ts:264`), exactly-one auto-select (`transaction-tax.logic.ts:111-113`), `upsertAccountRule` forces `REVIEW_REQUIRED` (`prisma-transaction-tax.repository.ts:391`), no name-based mapping anywhere.
  - Onboarding: one transaction, no timeout/isolation options, attach-existing-owner exists, entitlements come from a fixed default list (so `expense_auto_post` cannot be enabled at onboarding — the Phase 6 gate on `SetPartnerFeaturesUseCase` is the only enable path).
- Document sequences are provisioned lazily by the shared reservation path; the
  2026-07-29 UAT repair closed the missing implementation behind the onboarding
  contract. No sequence write occurs in the onboarding transaction.
- Docs-only change; `git diff --check` clean for tracked files; no wiki-links added or removed.
- Initial planning commit was documentation-only; implementation verification follows.
- Phase 1 compatibility slice 2026-07-29:
  - server now rejects legacy header/authoritative-line mismatch at create and issue with `output_tax_code_line_mismatch`;
  - server derives a compatibility header only when every line carries the same legacy `O7`/`OX`/`O0` code;
  - unreachable UI VAT-mode fallback was removed;
  - Bank Account create/update validates same-company active posting-enabled cash/bank asset links with `ledger_account_invalid_for_bank`;
  - focused accounting/banking tests: 63/63 PASS;
  - API typecheck: PASS;
  - Web typecheck: PASS.
- Catalog/domain slice 2026-07-29:
  - fixed `TH_SME_COA_V1` catalog contains 175 normalized accounts, the nine explicit contra balances, reviewed cash/bank markers, and review-required mapping suggestions only;
  - `accountsChecksum = 1a92339d4d0d74ce36882a34a616b76b62c0f6567d07f59c4e27a83a708e86eb`;
  - `mappingManifestChecksum = 5b3f2125011edceec400a11c90dbbf9aaa01183f646357524703d801efb01c58`;
  - catalog/semantic-preview tests: 9/9 PASS;
  - API typecheck: PASS.
- Schema/contracts/onboarding slice 2026-07-29:
  - additive Company provenance, tax suggestion provenance, company-scoped ChartOfAccount key, and BankAccount→ChartOfAccount FK migration applied successfully to the local Docker database;
  - migration performs an actionable `ledger_account_invalid_for_bank` pre-check and never clears invalid legacy links;
  - onboarding now creates and verifies exactly 175 company-owned rows inside its existing transaction, stamps provenance only after semantic post-conditions, uses `maxWait=5s`/`timeout=15s`, and returns safe metadata with automatic posting false;
  - both new-owner and attach-existing-owner paths use the same bootstrap; chart failure cannot create a completed run or success audit;
  - chart summaries now expose controlled/source-group fields and shared contracts include template/preview/apply/readiness DTOs;
  - focused catalog/bootstrap/account/onboarding tests: 38/38 PASS;
  - Prisma validate/generate: PASS; contracts and API typecheck: PASS;
  - local migration verification: provenance columns and `BankAccount_companyId_ledgerAccountId_fkey` present.
- Posting fallback gate 2026-07-29:
  - any chart-template provenance (including a partial stamp) disables built-in `DEFAULT_ACCOUNT_CODES`;
  - a template company without an active reviewed PostingRule receives `posting_rule_missing`, its source is marked `posting_error`, and no account lookup, journal number reservation, or journal insert occurs;
  - legacy fallback remains available only to companies with no template provenance;
  - focused regressions prove invoice code `1210-00` and expense code `5310-01` are never reached for template companies: 3/3 PASS; API typecheck PASS.
- Existing-company template API/readiness slice 2026-07-29:
  - added read-only template listing/preview/readiness and checksum-guarded serializable apply under existing `ledger.account.read/manage` and membership context;
  - dependency scan covers journal IDs, posting-rule IDs/codes, tax rule/reconciliation IDs, bank links/adjustments, hierarchy, all Tax Event account assignments, and unposted source-line assignments;
  - `MISSING_ONLY` is conflict-blocking by default; explicit acknowledgement creates only missing rows; `REPLACE_UNUSED` rechecks and replaces only zero-dependency rows with prior values audited;
  - apply validates catalog/checksums, retries serialization once, recomputes dependencies/readiness in the transaction, verifies post-conditions, and awaits success/failure audit;
  - template companies now select active company posting rules only; legacy companies retain company-over-global fallback. Readiness requires usable company rules for both `expense.confirmed` and `expense.claim.confirmed`, rather than treating unrelated occurrences of suggested account codes as proof;
  - readiness includes active tax-profile/account-role gaps, invalid bank links via the shared banking validator, legacy header/line mismatches, and source `posting_error` counts;
  - focused banking/catalog/query/apply/posting/DTO tests: 59/59 PASS; contracts and API typecheck PASS;
  - read-only local Postgres smoke: 180-row seed company -> 158 exact, 0 missing, 17 unused conflicts, 0 in-use; `1210-00` and `5310-01` both `UNUSED_CONFLICT`; missing rules = `EXPENSE_CLAIM_CONFIRMED`, `EXPENSE_CONFIRMED`; automatic readiness false.
- Automatic-posting and period-close enforcement slice 2026-07-29:
  - `SetPartnerFeaturesUseCase` recomputes ledger readiness before a false→true `expense_auto_post` transition; failure returns `coa_posting_readiness_incomplete`, missing posting/tax role keys, and safe aggregate readiness before any entitlement write;
  - successful enablement audits only safe template/count/readiness metadata and preserves the existing activation boundary on unrelated updates;
  - close checks now block open legacy `isSystem=true` unused-conflict remediation, invalid class/normal-balance/global-shadow semantics, unresolved per-account suspense balances, required tax-profile/account-role gaps, and period-scoped source posting errors including procurement/bank/reimbursement supplements;
  - ordinary `isSystem=false` company divergence remains customization/readiness information and does not block close; unmigrated legacy companies do not receive template remediation checks;
  - focused feature/readiness/close tests: 57/57 PASS; contracts, API, and web typecheck PASS.
- Web Master Data slice 2026-07-29:
  - added a permission-gated company settings page with all chart rows (no 80-row cap), search/class/status filters, template provenance, manual/automatic readiness, every readiness gap, and a direct Tax Account Determination link;
  - preview renders exact/missing/unused/in-use totals plus every conflict, differing semantic field, and dependency count; apply is checksum-backed, explicitly confirmed, blocks global shadows/in-use replacement, clears stale previews, and shows created/updated/skipped or a translated `role="alert"` failure;
  - onboarding handoff now shows only safe template/version/count/readiness metadata; onboarding failures remain on-form in Thai with the API request reference;
  - shared authenticated API errors now preserve `X-Request-Id` in error details, so header-only request references are not lost;
  - focused web tests: 91/91 PASS; focused readiness/feature API tests: 28/28 PASS; contracts, API, and web typecheck PASS;
  - local browser walkthrough (read-only): route returned 200, rendered 180/180 rows, preview rendered the expected 17 conflicts, search reduced `1210-00` to 1/180, apply stayed disabled until explicit conflict confirmation, refresh removed the reviewed preview, settings entry was visible, and browser console errors were 0. No apply write was performed.
- All-company audit slice 2026-07-29:
  - added `pnpm --filter @watchdog-bms/api chart:audit -- --output-dir <dir>`; it selects company IDs only, executes each company scan inside a database-enforced read-only transaction, bounds conflict samples to 20 by default (maximum 100), writes exclusive JSON/CSV evidence, preserves per-company `ERROR` rows, and exits non-zero on any partial scan failure;
  - focused audit tests: 3/3 PASS; API typecheck and `git diff --check`: PASS;
  - read-only local run scanned 4/4 companies with 0 failures; `seed-local-company` matched the measured baseline exactly: 180 company rows, 158 exact, 0 missing, 17 unused conflicts, 0 in-use conflicts, 20 dependency references (`ExpenseLineAssignment=2`, `TaxAccountRule=18`), 1 invalid bank link, and both required expense posting rules missing;
  - bounded baseline evidence is stored in `docs/research/chart-of-accounts-audit-evidence/`; an allowlist scan found no name, tax ID, email, phone, address, password, secret, or credential fields.
- Local seed repair and Tax Code review 2026-07-29:
  - Prisma seed now imports `TH_SME_COA_V1` directly, upserts inside one 120-second transaction, changes legacy `isSystem=true` collisions to ordinary company rows, asserts 175 semantic `EXACT` company-owned rows, and stamps provenance only after the post-condition; no second 175-row fixture remains;
  - reviewed local repair was chosen because `seed-local-company` is a fixed test fixture and every baseline conflict was `UNUSED_CONFLICT`; the upsert does not delete the five seed-only codes or touch source/posted/filed rows;
  - post-repair audit: 175 exact, 0 missing/conflicts, manual ledger ready, automatic posting still false because the two expense posting roles and one reviewed bank link are absent; this is intentional fail-closed behavior and no mapping was guessed;
  - all 18 active tax account-rule references remained valid and retained their prior account IDs (sampled VAT/PP36 codes before/after were identical); the active local S/4HANA fixture maps seven semantic roles to `1154-00`, `1155-00`, `2135-00`, `2136-00`, `2137-00`, and `5390-02`;
  - Tax Code behavior review confirmed auto-selection only when active profile/direction/context/effective-date filters produce exactly one definition; multiple definitions return `tax_code_ambiguous`; account mapping ranks semantic role + definition/context/source specificity + priority/version and returns `tax_account_rule_missing`/`tax_account_rule_ambiguous` instead of guessing;
  - focused Tax Code/profile/account-rule regressions: 35/35 PASS; explicit seed TypeScript check, live Prisma seed, read-only post-repair audit, and ID/reference comparison: PASS.
- Final tax integration and gap review 2026-07-29:
  - added `pnpm --filter @watchdog-bms/api chart:tax-smoke -- --company-id <id> --profile-key <key> --expense-account-code <code> --payable-account-code <code> --tax-code <code> --document-date <yyyy-mm-dd>`; every mapping/profile choice is explicit, the database transaction is enforced read-only, and output uses account codes plus 12-character opaque ID references;
  - local smoke used the reviewed test fixture choices `SAP_S4_TH_CURRENT`, input Tax Code `V1`, stationery expense `5320-01`, and payable `2120-01`; the active semantic rule resolved `INPUT_VAT_CLAIMABLE` to company account `1154-00`;
  - computed source tax `7.00`, journal tax `7`, and PP30 report amount `7.0000`; Source→event, event→journal, and event→report deltas were all `0.0000`, result `MATCHED`, journal balanced, and no database write occurred;
  - focused Expense/Tax resolver/posting/Tax Event/reconciliation regressions: 45/45 PASS; API typecheck and `git diff --check`: PASS;
  - final combined focused API run (chart catalog/bootstrap/query/apply, onboarding, posting gates, Tax Code header/resolver, banking, feature readiness, audit, Tax Event and reconciliation): 188/188 PASS; contracts/API/web typechecks and Prisma validate/generate: PASS;
  - final gap review found no remaining unapproved mapping being inferred or enabled. Open rollout gates are accountant approval of productive commercial/bank/expense/WHT/import mappings, per-company preview/apply, and explicit review handling if a production audit finds immutable header mismatches. Item 10H intentionally remains unchecked.
Next:
- Commit/push the verified final integration slice.
- Obtain accountant approval for the productive mapping manifest; then audit and preview each production company, resolve any immutable-history review issues without rewriting history, and enable automatic posting only when readiness passes.
