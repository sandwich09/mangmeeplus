# Chart of Accounts CSV Analysis

## Source

- Local source file reviewed: `/Users/spare058/Documents/ผังบัญชี.csv`
- Reviewed on: 2026-06-23
- Re-verified against the file, the local database, and code on 2026-07-29 (all counts below confirmed; contra-account and placeholder detail added)
- Encoding: UTF-8 CSV
- Row count: 175 account rows plus header

Do not depend on the absolute source path in implementation. Treat this note as analysis input. If the CSV should become a product seed, copy a curated seed file into the repository in a later accounting/ledger implementation task.

## Columns

```text
Group1
Group2
รหัสบัญชี
รายละเอียด
```

`รหัสบัญชี` uses a clean `dddd-dd` pattern. No invalid account codes or duplicate account codes were found in this review.

## High-Level Distribution

| Classification | Count | Code range |
|---|---:|---|
| Asset | 44 | `1111-00` to `1500-04` |
| Liability | 30 | `2120-01` to `2300-00` |
| Equity | 3 | `3100-00` to `3300-00` |
| Income | 16 | `4100-01` to `4200-08` |
| Cost | 8 | `5110-00` to `5130-07` |
| Sale expenses | 10 | `5200-01` to `5200-10` |
| Service expenses | 64 | `5310-01` to `9999-99` |

Note: source `Group2` has typo `Service expesnes`. Normalize to `Service expenses` during import or seed preparation.

## Code Prefix Pattern

| Prefix | Meaning from file | Count |
|---|---|---:|
| `1xxx` | Assets | 44 |
| `2xxx` | Liabilities | 30 |
| `3xxx` | Equity | 3 |
| `4xxx` | Income/revenue | 16 |
| `5xxx` | Cost and operating expenses | 80 |
| `6xxx` | Corporate income tax | 1 |
| `9xxx` | Suspense/clearing account | 1 |

`Group1` should not be trusted as the final account class because the source places revenue, cost, and expenses under `Group1 = Equity`. Use account code prefix and normalized `Group2` for future ledger/report classification.

## Contra Accounts (normal balance opposite to class)

Nine accounts must not receive the class-default normal balance:

| Code | Name | Class | Correct normal balance |
|---|---|---|---|
| `1130-03` | ค่าเผื่อหนี้สงสัยจะสูญ | ASSET | CREDIT |
| `1420-02` | ค่าเสื่อมราคาสะสม-อาคาร | ASSET | CREDIT |
| `1420-03` | ค่าเสื่อมราคาสะสม-อุปกรณ์สำนักงาน | ASSET | CREDIT |
| `1420-04` | ค่าเสื่อมราคาสะสม-เครื่องตกแต่งสำนักงาน | ASSET | CREDIT |
| `1420-05` | ค่าเสื่อมราคาสะสม-ยานพาหนะ | ASSET | CREDIT |
| `4100-03` | รับคืนสินค้า | REVENUE | DEBIT |
| `4100-04` | ส่วนลดจ่าย | REVENUE | DEBIT |
| `5130-02` | ส่วนลดรับ | COST | CREDIT |
| `5130-03` | ส่งคืนสินค้า | COST | CREDIT |

The local seed company rows already store these correct values (verified 2026-07-29); the curated `TH_SME_COA_V1` catalog must carry them as reviewed per-row data with a validator exception list — a pure class→balance formula silently corrupts all nine.

Placeholder detail: the nine deposit accounts `1112-01`–`1114-03` use the placeholder number pattern `999-9-99999-N`, and `1210-00` carries a person-name placeholder (`ลูกหนี้เงินให้กู้ยืม-นาย…`). Decided 2026-07-29: curated deposit names keep ordinal suffixes (`เงินฝากกระแสรายวัน 1`–`3`, `เงินฝากออมทรัพย์ 1`–`3`, `เงินฝากประจำ 1`–`3`), `1210-00` becomes `ลูกหนี้เงินให้กู้ยืม`, and the catalog validator rejects duplicate Thai names.

## Useful Seed Categories

Keyword scan suggests these future seed mappings:

| Category | Approx. count | Use |
|---|---:|---|
| Cash/bank | 14 | Bank accounts and reconciliation |
| Accounts receivable | 5 | Invoice/payment posting |
| Inventory | 10 | Inventory valuation and COGS |
| Fixed assets | 16 | Fixed asset module |
| VAT/tax/WHT | 19 | Thai tax reporting |
| Accounts payable | 3 | Procurement/AP |
| Revenue | 15 | Sales documents and P&L |
| Expense | 85 | Expense, reimbursement, and P&L |

## Product Implications

- This belongs mainly to checklist item 10, Double-Entry Ledger and Period Closing.
- Accounting Documents MVP can reference this mapping later when finalized documents generate journal entries.
- Data Model Core item 04 should not absorb chart-of-accounts tables; item 04 only provides tenant, branch, attachment, sequence, audit, and outbox primitives.
- Future ledger seed should keep raw source columns as import evidence but derive normalized fields for reporting.

## Suggested Future Model Shape

```text
ChartOfAccount
- id
- companyId
- code
- nameTh
- accountClass
- reportGroup
- normalBalance
- parentCode nullable
- isPosting
- isSystem
- taxCategory nullable
- cashFlowCategory nullable
- sourceGroup1 nullable
- sourceGroup2 nullable
- status
- createdAt
- updatedAt
- unique companyId,code
```

Recommended `accountClass` derivation:

```text
1xxx -> ASSET
2xxx -> LIABILITY
3xxx -> EQUITY
4xxx -> REVENUE
5xxx -> EXPENSE or COST depending on Group2
6xxx -> TAX_EXPENSE
9xxx -> SUSPENSE
```

Recommended `normalBalance` (class default plus reviewed contra overrides):

```text
ASSET, EXPENSE, COST, TAX_EXPENSE -> DEBIT
LIABILITY, EQUITY, REVENUE -> CREDIT
SUSPENSE -> DEBIT
contra overrides: 1130-03, 1420-02..1420-05 -> CREDIT; 4100-03, 4100-04 -> DEBIT; 5130-02, 5130-03 -> CREDIT
```

## Import Guardrails

- Normalize `Group2` typo before storing. The one-time local import did not: 62 rows store raw `Service expesnes` in `reportGroup`, so any semantic comparator must normalize both sides before equality.
- Keep source columns for audit/import trace.
- Do not use `Group1` alone for financial statement classification.
- Treat `9999-99 บัญชีพัก` as a controlled suspense account, not a normal posting target for user workflows.
- Bank account names in source use placeholder account numbers. Product seed should not assume real bank account identities from this file.
- Validate code uniqueness per company.
- Keep account code editable only before journal lines reference it; after first ledger use, lock code and allow name/status/report mapping changes by policy.

## Open Follow-Up

- Resolved 2026-07-29: use the reviewed normalized data as fixed versioned template `TH_SME_COA_V1`, copied into company-owned rows during onboarding; companies do not upload this file separately.
- Define official Thai/English account names before exposing in bilingual UI.
- Have a qualified accountant approve productive commercial, cash/bank, VAT/WHT/PP36/import, and report mappings before automatic posting or Tax Code profile activation.

## Integration Impact Review 2026-07-29

The source can become master data only with compatibility controls. The detailed contract and implementation sequence are in [[specs/chart-of-accounts-master-data-bootstrap-spec|Chart of Accounts Master Data Bootstrap Spec]] and [[plans/chart-of-accounts-master-data-bootstrap-plan|its plan]].

Confirmed impacts:

| Area | Finding | Required treatment |
|---|---|---|
| Existing seed/posting | `1210-00` currently means Accounts Receivable but the source means loan receivable | semantic conflict blocks apply and hard-coded fallback |
| Existing seed/posting | `5310-01` currently means General Expenses but the source means salary | semantic conflict blocks apply and hard-coded fallback |
| Posting defaults | several built-in cash, VAT, WHT, and employee-payable codes do not match reviewed source equivalents | accountant-reviewed company posting rules; missing mapping fails closed |
| Contra accounts | nine source accounts are contra accounts; a class-derived normal balance stores the wrong side for all nine | catalog carries reviewed per-row normal balance with a contra exception list |
| Posting binding | posting rules and fallbacks bind accounts by **code** (`mappingJson` / `DEFAULT_ACCOUNT_CODES`); the rule FK columns are dead | dependency scan reads `mappingJson` codes (company and global rows); treat a code as a live binding |
| Tax Code | active semantic account-role resolver already rejects missing/ambiguous rules | preserve this fail-closed behavior; chart creation must not auto-activate rules |
| Legacy Tax Code header | server never validates header against line snapshots (a mismatched header can be persisted via direct API); the VAT-mode→`O7` fallback is unreachable dead code today, and S/4HANA documents carry a null header by design | add header/line agreement validation; remove the dead fallback; line snapshot authoritative |
| Bank ledger link | `BankAccount.ledgerAccountId` and `BankAdjustment.ledgerDebit/CreditAccountId` have no database relation and API writes do not validate tenant/account suitability | add company-scoped validation, pre-check, and relation; scan adjustment columns |
| Existing local import | 169 accounts created + 6 codes kept by code only; measured 2026-07-29: 180 total rows (175 template + 5 seed-only), `reportGroup` stored raw (62 typo rows), zero dependencies on `1210-00`/`5310-01` (both `UNUSED_CONFLICT`) | run preview/dependency scan; do not treat this as semantic migration proof |

No historical posted journal or filed tax snapshot is rewritten automatically. Existing-company repair requires a dry-run, dependency evidence, accountant decision, backup, and an audited rollback-ready operation.
