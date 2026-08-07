# Chart of Accounts Master Data Bootstrap and Compatibility Spec

## 1. Status

- Status: Draft, ready for implementation planning; amended 2026-07-31 with the narrow VAT control-account provisioning rule required by Feature Entitlement Decoupling Spec v5.
- Roadmap: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 10H.
- Owner: Product / Accounting / Platform.
- Date: 2026-07-29.
- Implementation plan: [[plans/chart-of-accounts-master-data-bootstrap-plan|Chart of Accounts Master Data Bootstrap and Compatibility Plan]].
- Task memory: [[agent-memory/chart-of-accounts-master-data-bootstrap|Agent Memory]].

## 2. Goal

Give every newly onboarded company a complete, company-scoped chart-of-accounts master automatically from a reviewed Thai SME template. Existing companies may preview and apply the same template without uploading the source file themselves.

The integration must preserve the current tenant, permission, audit, posting, tax, reconciliation, and immutable-history boundaries. It must fail closed instead of:

- partially applying accounts;
- silently keeping an existing account whose code matches but whose accounting meaning differs;
- posting through a hard-coded account code with the wrong meaning;
- activating tax mappings without accountant review;
- linking bank or tax records to another company's account;
- returning success while onboarding, mapping, or readiness work failed.

## 3. Source and Existing System

### 3.1 Source template

The reviewed source is `/Users/spare058/Documents/ผังบัญชี.csv`, analyzed in [[research/chart-of-accounts-csv-analysis|Chart of Accounts CSV Analysis]].

Confirmed source facts:

- 175 account rows and 4 source columns.
- Account codes follow `dddd-dd`.
- No blank source rows, invalid codes, or duplicate codes.
- `Group1` is not a reliable financial-statement class because revenue, cost, and expenses are stored under `Equity`.
- `Group2 = Service expesnes` occurs 64 times and must normalize to `Service expenses`.
- Non-breaking spaces occur in Thai names and must normalize to regular spaces.
- The source repeats the Thai display name `ค่ารับรอง` at `5200-06` and `5370-03`; the curated catalog appends the account code to those two labels so uniqueness is deterministic without guessing a new accounting meaning.
- Placeholder bank-account numbers occur in source names and must not become assumed real bank identities: the nine deposit accounts `1112-01`–`1114-03` all use the placeholder pattern `999-9-99999-N`, and `1210-00` carries a person-name placeholder (`ลูกหนี้เงินให้กู้ยืม-นาย…`).
- Nine accounts are contra accounts whose normal balance is the opposite of their class default: `1130-03` ค่าเผื่อหนี้สงสัยจะสูญ and `1420-02`–`1420-05` ค่าเสื่อมราคาสะสม are credit-normal assets; `4100-03` รับคืนสินค้า and `4100-04` ส่วนลดจ่าย are debit-normal revenue; `5130-02` ส่วนลดรับ and `5130-03` ส่งคืนสินค้า are credit-normal cost.
- `9999-99 บัญชีพัก` is a controlled suspense account.

### 3.2 Existing application behavior

The application already has:

- company-scoped `ChartOfAccount` rows with a unique `(companyId, code)` key; the H-02 CHECK (`companyId IS NOT NULL OR isSystem = true`) additionally allows global system rows with null `companyId`, which every tenant's account lookup can resolve — no global rows exist today;
- chart list/create/update APIs under the ledger module; update cannot change `code`, `accountClass`, or `normalBalance` (DTO whitelist, use-case guard, and a terminal repository allowlist) and rejects every update to an `isSystem` row;
- journal lines, posting rules, tax account-determination rules, tax reconciliation, and reports that reference chart accounts; posting rules bind their debit/credit accounts as code strings inside `mappingJson` (the `debitAccountId`/`creditAccountId` relation columns are unused), and journal generation resolves accounts by code;
- onboarding that creates company, owner user with credential, membership, membership-role assignment, branch, feature entitlements, workflow defaults, onboarding run, and audit in one transaction (the OWNER role itself is looked up from seed data, not created);
- a minimal Prisma seed chart used by built-in posting fallback codes;
- SAP ERP/SAP S/4HANA Tax Code templates that install definitions as `DRAFT` / `REVIEW_REQUIRED`;
- runtime tax-account resolution through active semantic `accountRole` rules;
- an active-profile gate that rejects missing or ambiguous account/report mappings.

The application does not yet have:

- automatic chart bootstrap during company onboarding;
- a reusable chart template catalog/version/checksum;
- chart-template preview/apply/readiness APIs;
- a safe existing-company conflict workflow;
- a full chart-master UI;
- a productized bulk CSV import for chart accounts.

The local seed company was populated once through repeated `POST /chart-of-accounts` calls: 169 rows were created and 6 matching codes kept their pre-existing seed rows. That operation proves the data can be stored, but it is not a safe reusable bootstrap because equality was based on code rather than accounting meaning.

## 4. Product Decisions

1. The 175-row curated catalog is a read-only platform template named `TH_SME_COA_V1`.
2. Creating a company copies the template into company-owned `ChartOfAccount` rows in the same onboarding transaction.
3. A company does not share mutable operational accounts with another company.
4. After bootstrap, the company-owned rows are the operational source of truth; later company edits do not mutate the platform template.
5. Existing companies use preview before apply. No row is written when any blocking conflict exists.
6. First pass does not require each company to upload the CSV.
7. First pass does not build a general CSV designer/importer. A custom company import is later scope.
8. Applying the chart does not automatically activate Tax Code profiles, tax account mappings, report mappings, or auto-posting.
9. Account selection must never use a Thai/English name match as final authority.
10. Posted journals and filed tax snapshots are never rewritten automatically to force template equality.
11. Legacy `outputTaxCode` values `O7`, `OX`, and `O0` remain compatibility metadata only. Line-level Tax Code definitions and immutable snapshots are authoritative.
12. The accounting readiness state is computed from current accounts and active mappings; it is not a manually editable status.

## 5. Scope

### In scope

- Curated, versioned chart template catalog and checksum.
- Deterministic normalization and catalog validation.
- Automatic onboarding bootstrap.
- Existing-company preview, apply, and readiness.
- Semantic conflict detection with dependency counts.
- Posting-rule and built-in fallback compatibility.
- Tax Code definition/account-role/report-mapping impact.
- Legacy accounting-document Tax Code header compatibility.
- Bank-account ledger-link integrity.
- Feature-activation readiness gate for automatic posting.
- Audit, structured errors, UI error states, migration checks, and focused integration verification.

### Non-goals

- A general-purpose CSV mapping wizard in the first pass.
- Automatically choosing productive SAP Tax Codes for a company.
- Automatically activating a Tax Code profile.
- Automatically accepting an account suggestion based only on account name.
- Rewriting posted journals, filed tax periods, or immutable tax snapshots.
- Making system admins able to browse an existing customer's operational chart details.
- Adding AI Gateway database access or AI-executed accounting mutations.
- Building account hierarchy from code prefixes unless the curated template supplies explicit reviewed parent codes.

## 6. Roles and Journeys

### 6.1 New company

1. System admin submits the existing company-onboarding form.
2. Backend validates the fixed `TH_SME_COA_V1` catalog before any company write.
3. Existing onboarding transaction creates the company and foundational records.
4. The same transaction inserts all 175 company chart rows and records template key/version/checksum/applied time on `Company`.
5. Backend verifies post-conditions inside the transaction.
6. Onboarding run becomes `COMPLETED` only when the chart post-conditions pass.
7. Response shows template key, version, account count, and readiness summary without exposing account details to the system admin.
8. If any chart step fails, the entire onboarding transaction rolls back and the API returns a stable visible error.

### 6.2 Existing company

1. Company owner/accountant with ledger permissions opens chart settings.
2. User requests template preview.
3. Backend returns exact matches, missing codes, semantic conflicts, and dependency counts.
4. Blocking conflicts produce no writes by default.
5. When preview is clean — or the user explicitly acknowledges conflicts for a `MISSING_ONLY` apply (section 8) — user confirms apply with the preview checksum/template checksum.
6. Backend re-checks current state and applies in one serializable transaction.
7. UI shows created/skipped counts and readiness gaps.
8. Accountant reviews posting and tax mappings before enabling automatic posting or activating a Tax Code profile.

### 6.3 Later company customization

- Company users may add or update accounts through current permission-checked APIs.
- Template origin remains visible, but the system never overwrites later company customization during ordinary template reads.
- A future template version uses a new preview/apply operation; it is not pushed silently.

## 7. Template Contract

### 7.1 Template metadata

```text
key: TH_SME_COA_V1
version: 1
accountsChecksum: SHA-256 of the canonical normalized account entries
mappingManifestChecksum: SHA-256 of the reviewed mapping manifest (manifest has its own version)
source: reviewed Thai SME CSV analysis
accountCount: 175
```

The two checksums are deliberately separate: editing account entries bumps the template version and changes `accountsChecksum`; editing the mapping manifest (for example, an accountant approving more suggestions) bumps only the manifest version and never changes `accountsChecksum`, so company provenance recorded at bootstrap time stays stable and comparable.

### 7.2 Account entry

```text
code
nameTh
nameEn nullable
accountClass
reportGroup nullable
normalBalance
parentCode nullable
isPosting
isControlled
taxCategory nullable
cashFlowCategory nullable
sourceGroup1
sourceGroup2
```

The runtime catalog lives in the ledger domain as typed repository data. The absolute Documents path is never used at runtime. `parentCode` is a template-level reference; it resolves to `ChartOfAccount.parentAccountId` after the company rows exist.

### 7.3 Normalization

- Remove UTF-8 BOM from the first header/value.
- Trim leading/trailing whitespace.
- Convert non-breaking spaces to normal spaces and collapse repeated spaces.
- Normalize `Service expesnes` to `Service expenses`.
- Preserve source groups only as provenance.
- Derive `accountClass` from code prefix plus normalized group:
  - `1xxx` → `ASSET`
  - `2xxx` → `LIABILITY`
  - `3xxx` → `EQUITY`
  - `4xxx` → `REVENUE`
  - `5xxx` + `Cost` → `COST`
  - other `5xxx` → `EXPENSE`
  - `6xxx` → `TAX_EXPENSE`
  - `9xxx` → `SUSPENSE`
- Derive `reportGroup` from the normalized `Group2` value; the curated catalog stores the reviewed value per entry.
- Derive normal balance from the class default, then apply the reviewed contra-account overrides:
  - class defaults: `ASSET`, `COST`, `EXPENSE`, `TAX_EXPENSE`, `SUSPENSE` → `DEBIT`; `LIABILITY`, `EQUITY`, `REVENUE` → `CREDIT`
  - contra overrides (normal balance opposite to class): `1130-03`, `1420-02`, `1420-03`, `1420-04`, `1420-05` → `CREDIT`; `4100-03`, `4100-04` → `DEBIT`; `5130-02`, `5130-03` → `CREDIT`
  - The catalog stores `normalBalance` per entry as reviewed data; the derivation above documents how the reviewed values were produced, it is not a runtime formula. The local seed company rows already store the correct contra values and serve as cross-check evidence (the repository contains no import fixture).
- Mark `9999-99` as `isControlled = true`.
- Remove placeholder bank-account numbers and the `นาย…` person placeholder from curated display names; real bank identity belongs to `BankAccount`, not the chart template. Deposit accounts keep an ordinal suffix so they stay distinguishable (`เงินฝากกระแสรายวัน 1`–`3`, `เงินฝากออมทรัพย์ 1`–`3`, `เงินฝากประจำ 1`–`3`), and `1210-00` becomes `ลูกหนี้เงินให้กู้ยืม`.
- Disambiguate the two source labels named `ค่ารับรอง` as `ค่ารับรอง (5200-06)` and `ค่ารับรอง (5370-03)`; the suffix preserves the reviewed source wording and does not infer a new category.

### 7.4 Catalog self-validation

Implementation and CI must reject a catalog that has:

- account count other than 175;
- blank or duplicate code;
- code outside `^\d{4}-\d{2}$`;
- blank Thai name;
- a duplicate Thai display name;
- a class/normal-balance combination that is neither the class default nor one of the nine reviewed contra exceptions;
- a contra-exception list that differs from the nine reviewed accounts;
- unnormalized source group or whitespace;
- a parent code not present in the catalog;
- a reviewed posting/tax suggestion that references a missing code;
- `9999-99` not marked controlled;
- placeholder bank-account identities;
- an `accountsChecksum` different from the reviewed fixture.

## 8. Semantic Conflict Rules

Code equality is not semantic equality.

An existing row is an exact match only when these values match the curated entry after normalization:

```text
code
nameTh
accountClass
normalBalance
reportGroup
isPosting
isControlled
```

Both sides of the comparison are normalized with the same §7.3 rules (trim, non-breaking spaces, collapsed whitespace, known source typo) before equality. Raw stored values such as `reportGroup = "Service expesnes"` — which the earlier one-time import wrote on 62 local rows — must not create false conflicts.

Preview classifies each template code:

- `EXACT`: no write required.
- `MISSING`: safe candidate to create.
- `UNUSED_CONFLICT`: code exists with different meaning and has no dependency.
- `IN_USE_CONFLICT`: code exists with different meaning and has one or more dependencies.

Posting resolves accounts by code at journal-creation time, so an account code is a live binding: any posting rule or built-in fallback that names a code depends on whichever row currently holds that code. The dependency scan must therefore cover code references, not only id references.

Dependency scan includes at least:

- `JournalLine.accountId`
- `PostingRule.mappingJson` debit/credit account **codes** — the live binding; scan both company rows and global rows (`companyId` null). The `PostingRule.debitAccountId`/`creditAccountId` relation columns are unused by the posting engine but are scanned for completeness.
- `TaxAccountDeterminationRule.accountId`
- `TaxReconciliationLine.journalTaxAccountId`
- `BankAccount.ledgerAccountId`
- `BankAdjustment.ledgerDebitAccountId` / `BankAdjustment.ledgerCreditAccountId` (bare string columns, no relation)
- `accountAssignmentsJson` account references on unposted source lines: `AccountingDocumentLine`, `ExpenseLine`, `PurchaseRequestLine`, `PurchaseOrderLine`, `VendorBillLine`, and `TaxEvent`
- parent/child chart relations

Apply behavior:

- Any conflict (`IN_USE_CONFLICT` or `UNUSED_CONFLICT`) blocks apply by default.
- `MISSING_ONLY` with `acknowledgeConflicts: true` and a still-matching preview checksum may proceed past conflicts: it creates only `MISSING` codes, never writes a conflicted code, and the response lists every acknowledged conflict. This lets a customized company keep receiving newly added template codes without pretending its divergent rows match. Omitting the flag keeps the default blocking behavior; global-shadow conflicts and a stale preview always block.
- `UNUSED_CONFLICT` remediation stays separate from acknowledgement: an explicit `REPLACE_UNUSED` confirmation may update the safe row after a second dependency check inside the transaction. The remediation write is a dedicated repository operation, because the standard update path blocks `code`/`accountClass`/`normalBalance` changes and rejects `isSystem` rows entirely — and all six currently colliding seed rows are `isSystem = true`. The replaced row becomes an ordinary company row (`isSystem = false`, satisfying the H-02 `company_or_system` CHECK) and its prior values are audited.
- For period-close purposes, an “open unused-conflict remediation” is specifically an `UNUSED_CONFLICT` whose existing company row still has the legacy `isSystem = true` marker. `REPLACE_UNUSED` clears that marker. Divergence on an ordinary company row (`isSystem = false`) is company customization/readiness information and does not block close merely because it differs from the template.
- A global system account (`companyId` null) whose code equals a template code is a blocking conflict. The platform template is never installed as global rows.
- A changed preview checksum or template checksum returns conflict and writes nothing. A serializable-transaction failure (Postgres 40001) retries once; if the in-transaction re-check then differs from the preview, the API returns `coa_preview_changed`.
- No API returns `200/201` with hidden row failures.

### 8.1 Confirmed legacy collisions

| Code | Existing seed meaning | Curated source meaning | Risk |
|---|---|---|---|
| `1210-00` | Accounts receivable | ลูกหนี้เงินให้กู้ยืม | invoices/payments can post to a loan-receivable account silently |
| `5310-01` | General expenses | เงินเดือน | expenses/procurement can post to salary silently |

Other kept codes such as `2120-01`, `3100-00`, `4100-01`, and `9999-99` are closer in meaning but still pass through the same semantic comparison.

## 9. Posting Compatibility

### 9.1 Existing risk

The built-in `DEFAULT_ACCOUNT_CODES` assumes codes that do not match the curated template:

- some default codes are absent from the 175-row source;
- some matching codes have different meaning;
- one generic cash/bank code cannot identify the real bank ledger account;
- one generic expense code cannot safely represent salary, supplies, fees, or other expense categories;
- WHT payable is split by statutory form in the source;
- posting rules and fallbacks reference accounts by code (`mappingJson` / `DEFAULT_ACCOUNT_CODES`), so whichever row currently holds a code receives the posting.

Merely inserting the chart therefore does not make automatic posting safe.

### 9.2 Required behavior

- Companies bootstrapped from `TH_SME_COA_V1` must not use built-in hard-coded fallback codes as final posting authority.
- Reviewed company `PostingRule` records or source-specific account bindings must resolve commercial debit/credit accounts.
- Payment posting resolves cash/bank from the selected payment/bank account when available; it does not guess a generic bank code.
- Expense/procurement posting resolves the expense/cost account from reviewed source/category/posting configuration; it must not default to `5310-01`.
- Missing commercial mapping sets source posting status to `posting_error` with a stable actionable code and creates no journal.
- Existing legacy companies may retain current fallback behavior until migrated, but readiness must expose the dependency and automatic template application must not change its meaning silently.
- `expense_auto_post` cannot be enabled unless the computed ledger readiness check passes.

### 9.3 Readiness

Readiness is computed and returns:

```text
chartTemplateApplied
chartAccountCount
chartConflicts
requiredPostingRolesMissing
requiredTaxAccountRolesMissing
taxProfilesNeedingReview
bankLedgerLinksInvalid
legacyTaxHeaderMismatches
sourcePostingErrors
taxConfigurationRequired
readyForManualLedger
readyForAutomaticPosting
```

`readyForManualLedger` may be true when the chart is valid even if posting mappings are incomplete. `readyForAutomaticPosting` requires all mappings used by enabled source modules. `chartConflicts` counts template divergence for review; divergence alone never blocks period close (§17 invariant 11).

## 10. Tax Code and Account-Role Interaction

### 10.1 Current behavior that remains

- Built-in SAP templates create Tax Code definitions only.
- Created definitions remain `REVIEW_REQUIRED`; the profile remains `DRAFT`.
- UI normally asks the user to select a Tax Code per line.
- Server resolution may select a definition automatically only when active filters leave exactly one applicable definition. Zero or multiple matches return explicit errors.
- Active tax account rules resolve by semantic `accountRole`, effective window, transaction context, source module, specificity, priority, and version.
- Missing or equally ranked rules return `tax_account_rule_missing` or `tax_account_rule_ambiguous`.
- Profile activation rejects incomplete account/report mappings.

These are fail-closed controls and must not be weakened.

### 10.2 No automatic productive account mapping

The chart template may provide account-role suggestions to reduce setup time, but:

- suggestions are not selected by name alone;
- suggestions are stored only as `REVIEW_REQUIRED`;
- suggestion rules carry provenance in `sourceMetadataJson` (template key/version, mapping basis, confidence) so a reviewer can see where each suggestion came from;
- an accountant must review the actual account, posting side, contexts, and effective dates;
- installing the chart must not activate the SAP profile or account/report rules;
- account IDs are resolved after company rows exist, never copied from another company.

The locally observed mappings, including `1154-00`, `1155-00`, `2135-00`, `2136-00`, `2137-00`, and `5390-02`, are implementation evidence for that one company, not universal productive defaults.

### 10.2.1 Narrow exception: required VAT control-account binding

The general no-automatic-productive-mapping rule above remains unchanged. The sole exception is a system-required company account-role binding for the five verified VAT control accounts needed to preserve unresolved commercial VAT and post gross controls plus net ภ.พ.30 receivable/payable, as specified by `feature-entitlement-decoupling-spec.md` CC4. It is not a Tax Code/profile, account-determination or report-rule activation and creates no report contribution by itself.

- Add effective-dated `CompanyAccountRoleBinding`. Resolver order is applicable reviewed FINAL snapshot/tax rule first, then explicit reviewed company binding, then system-required binding. An explicit binding wins among applicable `CompanyAccountRoleBinding` candidates only after no FINAL assignment resolves; equal-rank or overlapping ambiguity fails closed.
- At bind time and again at source-date resolution, verify tenant/company ownership, `status=ACTIVE`, `isPosting=true`, `isControlled=false`, compatible account class/type, normal side and effective canonical statement presentation, an effective window covering the source date, and no overlapping or equal-rank role ambiguity. Across the company's binding history, `INPUT_VAT_CLAIMABLE`, `INPUT_VAT_PENDING`, `VAT_REFUND_RECEIVABLE`, `OUTPUT_VAT_PAYABLE` and `VAT_SETTLEMENT_PAYABLE` must use five distinct posting account IDs; v5 permits no sequential or overlapping cross-role alias. Validate the effective five-role result after FINAL/explicit/system precedence too: a colliding FINAL mapping fails at the Ledger boundary instead of winning. Effective presentation is the compatible stored key or, only when absent on a preserved custom/locked account, the deterministic role-derived fallback below; an explicitly conflicting stored key fails. A later valid binding supersedes only by effective date and never changes posted provenance.
- For an unmodified standard `TH_SME_COA_V1` chart, the system may independently bind all five roles—`INPUT_VAT_CLAIMABLE` to 1154-00, `INPUT_VAT_PENDING` to 1155-00, `VAT_REFUND_RECEIVABLE` to 1156-00, `OUTPUT_VAT_PAYABLE` to gross 2135-00 and `VAT_SETTLEMENT_PAYABLE` to net 2137-00—only after verifying all constraints above, exact template key/version/checksum and a new versioned required-control role/code manifest. If the company originated from that template but the whole chart later diverged, each untouched role row may be reused only when stored template provenance plus the complete versioned row fingerprint still matches; otherwise that role follows the custom path. Gross 2135 must never be reused for net 2137. Do not mutate the historical v1 suggestion manifest/checksum. Record `SYSTEM_REQUIRED_CONTROL_ACCOUNT` provenance.
- This exception activates only those five G/L control-role bindings. It does not activate a Tax Code definition/profile, transaction account-determination rule, report rule, PP36 role or any other `REVIEW_REQUIRED` suggestion.
- Additive `ChartMutationPolicy` is `SYSTEM_MANAGED | CUSTOM_WRITABLE | EXTERNAL_LOCKED | UNRESOLVED` with source/version evidence. A deploy-owned classifier maps an exact verified/system-owned template to SYSTEM_MANAGED, a proven external sync/ownership lock to EXTERNAL_LOCKED, and an internally editable custom chart to CUSTOM_WRITABLE only when existing authority/config proves system account creation is allowed. Conflicting or absent evidence becomes UNRESOLVED, never a permissive default. This background classification has no company-wide migration form; UNRESOLVED creates one prefilled accountant task only when Ledger needs a missing role.
- A custom chart is never attached to an existing account from its name alone. Validate/provision every missing role independently. When its mutation policy is `SYSTEM_MANAGED` or `CUSTOM_WRITABLE`, lock the VAT-control role set, create a dedicated Thai-named, role-tagged account (`ภาษีซื้อ`, `ภาษีซื้อ-ยังไม่ถึงกำหนด`, `ลูกหนี้กรมสรรพากร`, `ภาษีขาย`, or `เจ้าหนี้กรมสรรพากร`) with collision-safe code and bind it atomically; concurrent provisioning and explicit bindings cannot reuse one account across roles. For both standard and custom system bindings, source-control roles 1154 claimable, 1155 pending and 2135 gross output start at the earliest relevant source date in the authorized readiness/backfill scope that lies in an open period; refund 1156/payable 2137 start at the applicable settlement recognition date (or earliest open-scope settlement date during backfill); if none exists, use Ledger activation date. A later-discovered earlier open source reuses the verified role account and atomically prepends/extends a non-overlapping binding segment; a date gap alone never creates a second account. A closed/filed source uses a current-open correction date and never rewrites history. When `EXTERNAL_LOCKED` or still UNRESOLVED, deduplicate internally per missing role but present one consolidated prefilled chart exception with all missing roles/codes/evidence and one approval only when Ledger posting needs them; keep affected projections in review/unposted state while Tax-only work continues. This is not a migration/mapping wizard.
- Add a separate canonical `statementPresentationKey`: `TRADE_AND_OTHER_CURRENT_RECEIVABLES` / **ลูกหนี้การค้าและลูกหนี้หมุนเวียนอื่น** for claimable 1154 and refund 1156; `OTHER_CURRENT_ASSETS` / **สินทรัพย์หมุนเวียนอื่น** for pending 1155; and `TRADE_AND_OTHER_CURRENT_PAYABLES` / **เจ้าหนี้การค้าและเจ้าหนี้หมุนเวียนอื่น** for gross output 2135 and net payable 2137. The required type/normal side is ASSET/DEBIT for 1154/1155/1156 and LIABILITY/CREDIT for 2135/2137. Wire it through contracts, balance-sheet calculation, UI and exports without mutating the immutable v1 `reportGroup` or checksum. Deploy-owned backfill writes only exact verified standard/system-created role rows; a preserved custom or `EXTERNAL_LOCKED` account without metadata derives presentation from its effective VAT role until explicitly reviewed.
- Account creation/binding uses a company-scoped VAT-role-set lock or expected-version CAS, an idempotency key and one transaction. It never renames/reuses an incompatible account, binds one account to two VAT-control roles, overwrites a collision, or rewrites posted history.

This is a narrow correctness/control exception and must not become a name-based auto-mapping precedent.

### 10.3 Legacy header compatibility defects

The web compatibility helper maps VAT mode to legacy header codes (`VAT_INCLUDED`/`VAT_EXCLUDED` → `O7`, `EXEMPT` → `OX`, `NO_VAT` → `O0`, with `O7` as the fall-through default for any other mode). Verified current behavior (2026-07-29):

- Credit/debit-note creation copies the source document's header verbatim; the VAT-mode fallback sits only in a `TAX_INVOICE` branch of the linked-creation flow that no caller reaches. Today no UI flow can stamp `O7` over an authoritative S/4HANA `O1` line.
- An S/4HANA document stores a **null** header from creation, because `O1`/`O2`/`WS`/`DL`/`DM`/`DN` cannot be represented in the `O7|OX|O0` enum; issue-time validation accepts the null header when authoritative line tax exists.
- The server already enforces: header ∈ {`O7`,`OX`,`O0`}, header↔VAT-mode agreement, header↔document VAT amount, and credit/debit-note header equal to the source header.
- The server never compares the header to line-level Tax Code snapshots. A direct API call can therefore persist a header that contradicts authoritative lines (for example `O7` over S/4HANA `O1` lines under a VAT-carrying mode) — this is the actual defect.
- Tax-event sync already treats an `O0` header as a blocking `AMBIGUOUS_LEGACY_O0` review issue. `O0`/`OX` carry different definitions between the SAP ERP and S/4HANA templates, the ERP template ships output-side codes only, and `O1` itself means 10% in the ERP template but 7% in S/4HANA.

Required fix before chart bootstrap:

- line `taxCodeDefinitionId`, external code snapshot, profile key/version, account-role assignment, and report contribution remain authoritative;
- add server-side header/line agreement validation: reject a provided compatibility header that disagrees with authoritative line codes (`output_tax_code_line_mismatch`) at create and at issue;
- derive `outputTaxCode` only when every authoritative line has the same compatible legacy code `O7`, `OX`, or `O0`; otherwise keep the compatibility header null and use `taxCodeSummary`;
- remove the unreachable VAT-mode fallback branch so no future re-wiring can fabricate a header from VAT mode when authoritative line data exists;
- credit/debit notes keep inheriting immutable source line tax snapshots and only a compatible source header (already enforced server-side; keep it covered by tests);
- scan existing tax invoices/credit notes/debit notes for header/line mismatch.

Data repair policy:

- draft/unissued records may clear or recompute the compatibility header after checksum/CAS guards;
- issued, posted, reconciled, or filed history is not rewritten automatically;
- immutable-history mismatches become explicit review/reconciliation issues with source references.

## 11. Data Model

### 11.1 Reuse

Reuse `ChartOfAccount`; no parallel master table is required.

### 11.2 Company template provenance

Add nullable fields to `Company`:

```text
chartOfAccountsTemplateKey
chartOfAccountsTemplateVersion
chartOfAccountsTemplateChecksum
chartOfAccountsTemplateAppliedAt
```

These fields record origin and last successful apply, not a claim that the company has never customized its chart.

### 11.3 Account integrity

- Persist `sourceGroup1` and normalized `sourceGroup2` for template rows.
- Add `@@unique([companyId, id])` to support company-scoped references where required.
- Preserve the current rule that normal application flows cannot change tenant/system ownership.
- Code/class/normal-balance changes for an existing row are available only to the reviewed unused-conflict remediation path, implemented as a dedicated repository operation — the standard update path already blocks these fields and rejects `isSystem` rows at the use-case layer.
- Template bootstrap writes ordinary company rows (`companyId` set, `isSystem = false`); the platform template is never installed as global rows, and the H-02 `company_or_system` CHECK continues to hold.

### 11.4 Bank ledger link

`BankAccount.ledgerAccountId` currently has no database relation to `ChartOfAccount` and the create/update use cases do not validate the account.

Required fix:

- validate that the linked account exists in the same company, is active, posting-enabled, and appropriate for cash/bank use;
- add a company-scoped optional foreign-key relation after a migration pre-check repairs or rejects invalid existing links;
- reject invalid links with `ledger_account_invalid_for_bank`;
- never silently clear an invalid link.

### 11.5 Suggestion provenance

Add nullable `sourceMetadataJson` to `TaxAccountDeterminationRule`, mirroring `TaxCodeDefinition.sourceMetadataJson`, so review-required suggestion rules record template key/version, mapping basis, and confidence. Additive; no behavior change for existing rules.

## 12. API Contract

### 12.1 Company chart template

```text
GET  /v1/companies/:companyId/chart-of-accounts/templates
GET  /v1/companies/:companyId/chart-of-accounts/templates/:templateKey/preview
POST /v1/companies/:companyId/chart-of-accounts/templates/:templateKey/apply
GET  /v1/companies/:companyId/chart-of-accounts/readiness
```

Apply input:

```json
{
  "expectedTemplateChecksum": "sha256",
  "expectedPreviewChecksum": "sha256",
  "mode": "MISSING_ONLY",
  "acknowledgeConflicts": false
}
```

`expectedTemplateChecksum` is the template's `accountsChecksum`. `acknowledgeConflicts` defaults to false; its semantics are defined in section 8.

Apply output:

```json
{
  "templateKey": "TH_SME_COA_V1",
  "templateVersion": 1,
  "templateChecksum": "sha256",
  "created": 175,
  "updated": 0,
  "skipped": 0,
  "acknowledgedConflicts": 0,
  "accountCount": 175,
  "readiness": {}
}
```

### 12.2 Stable errors

- `coa_template_not_found`
- `coa_template_invalid`
- `coa_template_checksum_mismatch`
- `coa_preview_changed`
- `coa_semantic_conflict`
- `coa_account_in_use_conflict`
- `coa_postcondition_failed`
- `coa_posting_readiness_incomplete`
- `ledger_account_invalid_for_bank`
- `output_tax_code_line_mismatch`

Error responses include `requestId` through the existing exception boundary and bounded row/conflict details. Raw database errors, absolute file paths, and customer data are not exposed.

### 12.3 Existing chart API

Additive chart summary fields needed by the master UI:

```text
reportGroup
isPosting
isControlled
taxCategory
cashFlowCategory
sourceGroup1
sourceGroup2
```

Existing consumers remain compatible.

## 13. UI Behavior

### System onboarding

- Uses the fixed standard chart template without a file-upload step.
- Success summary shows template/version/account count/readiness only.
- Failure remains on the form with a visible Thai error and request reference.
- Onboarding cannot show `COMPLETED` when chart bootstrap failed.

### Company chart settings

- List all accounts with search/filter/status instead of truncating at 80.
- Show template origin and readiness.
- Preview exact/missing/conflicting counts before apply.
- Show every blocking conflict and dependency counts.
- Disable apply while preview is loading, stale, or blocking.
- Use an inline `role="alert"` for API errors; never rely on console logging.
- Success shows created/updated/skipped counts.
- Tax mapping readiness links to the existing Tax Account Determination page.

## 14. Permissions, Tenant Boundary, and Audit

- Listing chart/templates/readiness uses `ledger.account.read`.
- Applying a template uses `ledger.account.manage`.
- Posting/tax rule review keeps existing `ledger.posting-rule.manage`, `tax.config.manage`, and `tax.profile.manage`.
- No new permission key is required.
- System onboarding invokes bootstrap internally under `system.company_onboarding.create`.
- System admins see onboarding template metadata/counts only. They do not gain access to an existing customer's account names, mappings, balances, journals, or tax data.
- Existing-company preview/apply is a customer owner/accountant operation.
- Success and failure are audited with template key/version/checksum, counts, mode, the acknowledge flag with acknowledged-conflict count, actor, company, request ID, and bounded conflict codes; never store source file contents.
- High-risk audit writes for template apply are awaited and participate in the transaction.

Audit actions:

```text
ledger.chart_template.preview
ledger.chart_template.apply
ledger.chart_template.apply_failed
ledger.chart_template.unused_conflict_replace
ledger.readiness.view
```

## 15. Impact Matrix and Required Remediation

| Area | Existing impact | Required remediation |
|---|---|---|
| Company onboarding | completes without chart master | apply catalog and post-conditions in the existing transaction |
| Prisma seed | maintains a separate 12-account list | reuse the same catalog/bootstrap service for seed companies; do not maintain a second semantic list |
| Ledger fallback | hard-coded codes are absent or semantically different | use reviewed rules/readiness for template companies; fail closed when missing |
| Expense/procurement posting | `5310-01` fallback means salary in source | resolve reviewed expense/cost mapping; never silently use salary |
| Invoice/payment posting | `1210-00` fallback conflicts with loan receivable | use reviewed receivable/payment mappings |
| Bank payments | generic cash/bank fallback loses real bank identity | resolve through validated `BankAccount.ledgerAccountId` or explicit cash mapping |
| Chart API/UI | list only, limited fields, UI displays at most 80 | expose additive fields and full searchable master page |
| Tax template install | definitions are installed but accounts/reports are not | keep review gate; optional suggestions remain `REVIEW_REQUIRED` |
| Tax runtime resolution | automatic role selection already exists | preserve missing/ambiguous fail-closed behavior |
| Accounting document header | no server check that the legacy header agrees with line snapshots; unreachable VAT-mode fallback branch is a latent landmine; S/4HANA documents carry a null header by design | add header/line agreement validation; remove the dead fallback; line snapshot authoritative |
| Feature entitlement | `expense_auto_post` only checks ledger entitlement | also require ledger readiness |
| Bank ledger link | no FK/account validation; `BankAccount.ledgerAccountId` and `BankAdjustment.ledgerDebitAccountId`/`ledgerCreditAccountId` are bare strings | validate and add company-scoped relation after pre-check; include the adjustment columns in the dependency scan |
| Reports/close | wrong class/mapping corrupts P&L/BS without arithmetic imbalance | semantic catalog validation plus readiness/close blocker |
| LINE/AI | reads ledger results | no mutation; surface readiness/incomplete configuration without inventing treatment |

## 16. Migration and Compatibility

### 16.1 Pre-deploy dry run

For every company, report:

- current chart count;
- template exact/missing/unused-conflict/in-use-conflict counts;
- dependency counts by table;
- missing required posting roles;
- invalid bank ledger links;
- Tax Code profile/account/report readiness;
- accounting-document compatibility header mismatches.

The report performs no writes.

### 16.2 New companies

After deployment, every new onboarding must receive the fixed catalog atomically.

### 16.3 Existing companies

- No automatic bulk mutation at migration deploy.
- Companies with no history may apply after preview and explicit confirmation.
- Companies with in-use semantic conflicts remain unchanged and receive a remediation report.
- Production posted journals and filed tax data are never bulk-relabeled.
- Local/test seed companies may be reset/reseeded or repaired through a reviewed environment-specific migration after dependency inspection.

### 16.4 Rollback

- Schema changes are additive before behavior switches.
- If application rollback is required, company chart rows remain valid ordinary accounts.
- Template provenance fields may remain populated.
- Do not delete applied accounts automatically.
- Disable automatic posting when readiness cannot be proven.

## 17. No-Silent-Error Invariants

1. Catalog validation runs in tests and before apply.
2. Onboarding/apply uses one transaction.
3. Apply re-checks dependencies and checksums inside the transaction.
4. Success requires post-condition count and semantic coverage checks.
5. Any row failure rolls back all row writes.
6. Missing/ambiguous posting or tax mapping creates no journal.
7. UI renders every API failure visibly.
8. Failure logs contain stable code and request ID.
9. Audit/log failures must not be hidden behind an unconditional success response.
10. Readiness is recomputed from database state before enabling automatic posting.
11. Close checks treat open unused-conflict remediation, internally invalid chart rows (class/normal-balance outside catalog rules), suspense usage, invalid tax mapping, and source posting errors as blockers. Divergence from the template alone is readiness information, never a close blocker — later company customization is explicitly allowed.
12. The §10.2.1 control binding activates only after exact standard-template verification or atomic dedicated custom-account creation; no name-only path can activate a productive role.

## 18. Acceptance Criteria

- [x] New company onboarding creates exactly 175 normalized company chart rows automatically.
- [x] The nine reviewed contra accounts carry their reviewed normal balance, not the class default.
- [x] Template bootstrap writes company-scoped rows only; no global system account shadows a template code.
- [x] Onboarding and chart bootstrap commit or roll back together.
- [x] Template key/version/checksum/applied time are stored.
- [x] System admin does not see customer chart details.
- [x] Existing company can preview without writes.
- [x] Code-only equality cannot skip a semantic conflict.
- [x] `1210-00` and `5310-01` conflicts are detected in the current seed-company shape.
- [x] In-use conflict blocks apply by default and returns dependency counts; `MISSING_ONLY` with `acknowledgeConflicts` creates only missing codes and never writes a conflicted code.
- [x] Stale preview/checksum writes nothing.
- [x] Template company cannot auto-post through unsafe built-in fallback codes.
- [x] Automatic posting remains disabled until readiness passes.
- [x] Tax template creation remains draft/review-required and does not auto-activate.
- [x] Tax account selection remains semantic-role/effective-date based and fails on missing/ambiguity.
- [x] A provided compatibility header that disagrees with authoritative line snapshots is rejected with `output_tax_code_line_mismatch` at create and issue; the unreachable VAT-mode fallback branch is removed.
- [x] Existing header/line mismatches are reported; immutable history is not silently rewritten.
- [x] Bank ledger links are same-company and valid.
- [x] Full chart UI shows loading, empty, forbidden, conflict, error, and success states.
- [x] No endpoint returns success with partial row errors.
- [x] Audit and structured error evidence are recorded.
- [ ] Feature-decoupling control binding preserves every review-required Tax Code/profile/account-determination rule while safely binding/provisioning all five verified VAT G/L control roles under §10.2.1; gross 2135 output VAT is never used as net 2137 payable.
- [ ] `OTHER_CURRENT_ASSETS`, `TRADE_AND_OTHER_CURRENT_RECEIVABLES` and `TRADE_AND_OTHER_CURRENT_PAYABLES` render consistently in contracts, balance sheet, UI and export without mutating v1 metadata/checksum or rewriting historical journals.

## 19. Required Tests

### Catalog/domain

- Catalog has 175 unique normalized entries and stable checksum.
- Class/normal-balance derivation covers every prefix/group.
- Contra-account overrides produce the reviewed normal balance for all nine contra accounts.
- Semantic comparison normalizes both sides; a stored raw `Service expesnes` report group does not create a false conflict.
- Suspense and placeholder normalization pass.
- Semantic equality distinguishes code match from meaning match.
- Dependency classifier returns exact/missing/unused/in-use correctly.

### Onboarding

- New onboarding writes all chart rows in the existing transaction.
- One chart-row failure rolls back company, owner, membership, branch, entitlements, workflows, run, and chart.
- Completed onboarding response includes chart metadata.
- Attach-existing-owner path receives the same company chart.

### Existing-company apply

- Preview is read-only.
- Apply is idempotent for exact rows.
- Stale preview/checksum rejects.
- Any blocking conflict yields zero writes.
- `MISSING_ONLY` with acknowledged conflicts creates only missing codes and reports every conflict.
- A serializable-failure retry whose re-check diverges returns `coa_preview_changed`.
- `REPLACE_UNUSED` re-checks dependencies inside the transaction.

### Ledger/posting

- Template company with missing rule fails before journal creation.
- Invoice/payment/expense/reimbursement/procurement cases resolve reviewed accounts.
- No template path uses `1210-00` as receivable or `5310-01` as general expense.
- Readiness blocks `expense_auto_post` enablement.

### Tax

- Tax template creates review-required definitions only.
- Missing/ambiguous account role still fails closed.
- Required-control manifest is versioned separately from v1; exact pristine standard 1154/1155/1156/2135/2137 bindings succeed independently and atomically without activating Tax Code/profile/account-determination rules, verified presentation backfills safely, customized-standard untouched rows reuse only provenance + full fingerprint, 2135 remains gross output VAT, unverifiable divergence fails closed, applicable FINAL rules precede explicit/system bindings, a valid explicit custom role wins within the binding layer, writable custom charts create each missing dedicated role-tagged account without duplicating verified rows, and an external lock creates one consolidated task containing all missing-role child facts only when Ledger needs them.
- Concurrent account provision/bind is idempotent and company-scoped. Foreign-company, inactive, non-posting, controlled, incompatible class/type/side/presentation, out-of-window, overlapping/ambiguous, name-only and code-collision candidates never activate.
- Presentation migration leaves v1 `reportGroup`/checksum unchanged, backfills only verified standard/system-created roles and derives a missing locked/custom presentation from the effective role without writing that chart.
- With Ledger enabled, period close blocks effective-period VAT projections in `PENDING|READY|NEEDS_REVIEW`; Tax-only companies are unaffected, and VAT history discovered after a period is closed uses a current-open correction instead of reopening or re-keying.
- API-level: S/4HANA `O1` lines submitted with an `O7` header reject at create and issue; an `O1` correction keeps a null-or-compatible header. (The UI correction path already copies the source header verbatim, so a UI-path-only test passes without the fix and proves nothing.)
- Compatible legacy lines derive a matching header.
- Header/line mismatch rejects with stable code.
- Draft mismatch repair and immutable-history review issue behavior pass.

### Banking

- Foreign-company, inactive, non-posting, and non-bank-compatible ledger links reject.
- Database migration pre-check catches invalid existing links.

### Integration/UI

- Onboarding → login → chart list shows 175 rows.
- Chart preview/apply/readiness flow has no console error or silent submit.
- Tax profile/account mapping preview uses the newly created company account IDs.
- Source document → tax snapshot → journal → tax event/report reconciliation remains equal.

## 20. Review Gate

Implementation cannot enable automatic posting for `TH_SME_COA_V1` until a qualified accountant reviews:

- commercial posting-role mappings;
- cash/bank behavior;
- expense/category mappings;
- WHT account/form mappings;
- VAT/PP36/import account-role suggestions;
- report groups and tax report mappings;
- suspense-account policy.

Until that gate passes, the system may create the chart and allow manual ledger setup, but must fail closed for missing automatic mappings.

The narrow §10.2.1 five-role VAT control binding is exempt only from the suggestion-review item above because it is a system-required reversible G/L control path with exact/dedicated account semantics. It does not waive review for PP36, Tax Code/profile, transaction account determination, report contribution, or any other productive rule.
