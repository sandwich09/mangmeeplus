# F0 — Entitlement Cohorts, Baseline Detection, Preset Fixtures (Lane F0.F)

| | |
| --- | --- |
| Generated | 2026-07-31 |
| Git HEAD | `42be72995bf21afbaa4bd5397b305b585c9b629d` (branch `develop`) |
| Lane | F0.F — freeloader/legacy cohorts, preset fixtures, baseline detection |
| Plan | `docs/plans/feature-entitlement-decoupling-plan.md` §3 F0; F2 normalization at :42-45; §8 commercial rollout |
| Spec | `docs/specs/feature-entitlement-decoupling-spec.md` CC7 (§232-238) |
| Upstream | `docs/agent-memory/f0-inventory-contracts-permissions.md` (lane S1 — key/permission inventory) |
| Nature | Docs + read-only SQL. No schema change, no `apps/` code change, no git write. |
| Consumers | **F1** shadow mode (`would_block` denominator = §B7), **F2** legacy normalization (workload = §B2/§B3) |

Status: cohort SQL was authored and executed against the LOCAL bare-seed DB only. This is a historical F0 record. The current live UAT evidence path is **`A5-RO`** through dedicated `watchdog_a5_ro` and remains pending execution after an accepted exact-SHA UAT deploy (§D). It is not, and never authorizes, `A5-CAPACITY-MUTATING`, entitlement enforcement, WHT OPEN or production promotion.

---

## 0. Evaluator semantics this document encodes

Every cohort/baseline rule below is a SQL transcription of one real code path. The SQL is only correct as long as these lines are:

| # | Semantic | Evidence |
| --- | --- | --- |
| S-1 | **Zero rows ⇒ `null` ⇒ fail-open.** A company with no `CompanyFeatureEntitlement` rows returns `null`, and `filterPermissionsByEntitlement` short-circuits to "return every permission". | `apps/api/src/modules/employee-access/application/entitlement.helper.ts:14`; `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:76` |
| S-2 | **Base set = rows with `enabled = true`.** `explicit` is the full row map (both true and false). | `entitlement.helper.ts:15-16` |
| S-3 | **DEFAULT_ON added unless explicitly false.** `explicit.get(k) !== false` — an **absent** row enables; only `enabled = false` disables. `DEFAULT_ON_FEATURE_KEYS = ['employee_access','company_settings']`. | `entitlement.helper.ts:17-19`; `packages/contracts/src/feature-entitlements.ts:552` |
| S-4 | **Legacy inheritance, 3 entries**, applied only when the target has **no row at all** (`!explicit.has`) and at least one source is already entitled. | `entitlement.helper.ts:20-24`; `packages/contracts/src/feature-entitlements.ts:554-558` |
| S-5 | **Submenu auto-enable.** For each of the 42 submenus: parent entitled **and** submenu not explicitly false ⇒ enabled. Onboarding never writes submenu rows, so all 42 are implicit for every existing company. | `entitlement.helper.ts:25-29`; seeding at `apps/api/src/modules/system-onboarding/application/use-cases/create-company-onboarding.use-case.ts:166-173` |
| S-6 | **Explicit-true submenu does not beat a disabled parent.** The submenu loop only runs `entitled.add` when the parent is entitled, so a stored `true` on an orphaned submenu is effectively OFF. | `entitlement.helper.ts:27` |
| S-7 | **Order matters for DEFAULT_ON → submenu.** `employee_access` / `company_settings` are added at S-3 *before* the submenu loop, so their 5 submenus auto-enable off an absent parent row. | `entitlement.helper.ts:17-19` then `:25-29` |
| S-8 | **Inheritance never chains.** Targets are `reimbursement`, `product_catalog`, `line_oa`; sources are `expenses`, `procurement`, `inventory`, `crm`. Disjoint ⇒ `Object.entries` iteration order is irrelevant. | `packages/contracts/src/feature-entitlements.ts:554-558` |
| S-9 | **`expense_auto_post` bypasses this evaluator entirely.** Both drain paths query the row directly with `enabled: true`, so a fail-open (zero-row) company is *not* auto-posting even though the permission layer says "everything on". It also has no permission gate at all (S1 inventory §1: gate mechanism NONE). | `apps/api/src/modules/ledger/application/use-cases/expense-auto-post.use-case.ts:88-90`; `apps/api/src/modules/ledger/application/use-cases/expense-backfill.use-case.ts:96-101` |

### The 3 `LEGACY_FEATURE_INHERITANCE` entries (verbatim)

`packages/contracts/src/feature-entitlements.ts:554-558`

| Target key | Source keys (any one enabled ⇒ target ON) | Applies when |
| --- | --- | --- |
| `reimbursement` | `expenses`, `procurement` | target has **no row** |
| `product_catalog` | `inventory`, `crm` | target has **no row** |
| `line_oa` | `crm` | target has **no row** |

### Table shape

`CompanyFeatureEntitlement` — `apps/api/prisma/schema.prisma:2398-2410`.
`id`, `companyId`, `featureKey` (String, free-form — **not** an enum/FK), `enabled` (Boolean, `@default(false)`, NOT NULL), `updatedBySystemAdminUserId`, `createdAt`, `updatedAt`; `@@unique([companyId, featureKey])`.

Two consequences the SQL relies on: `enabled` is never NULL (so "null rows = fail-open" means *absent rows*, not null values), and `featureKey` is unconstrained (so orphan/unknown keys are possible — §B5 detects them).

`CompanyEntitlementNormalization` (spec CC7) **does not exist yet** — confirmed absent from the local schema. F2 adds it; nothing here depends on it.

---

## A. Cohorts

### A.0 Shared prelude — BLOCK E

Every query in §A and §B is **BLOCK E + one tail**. BLOCK E is pure `SELECT`/`VALUES`; it reads only `Company` and `CompanyFeatureEntitlement`. It replays S-1…S-8 in SQL and emits `eff(company_id, k, origin)` — the effective-ON set with the reason each key is ON. The corrected B6 no longer reads `JournalEntry` because its shared source type cannot prove auto-post provenance.

`origin` values: `EXPLICIT_TRUE`, `FAIL_OPEN`, `DEFAULT_ON`, `INHERITED`, `SUBMENU_AUTO`. `UNEXPECTED_ORIGIN` is an assertion — it must always return zero rows; if it ever appears, the evaluator drifted from this SQL.

```sql
WITH
parent_key(k) AS (VALUES
  ('inventory'), ('product_catalog'), ('sales_documents'), ('expenses'), ('reimbursement'),
  ('double_entry_ledger'), ('expense_auto_post'), ('thai_tax'), ('procurement'), ('bank_reconciliation'),
  ('crm'), ('dashboard_notifications'), ('ai_line_assistant'), ('line_oa'), ('reports'),
  ('workflow_automation'), ('employee_access'), ('company_settings')
),
sub_key(k, parent) AS (VALUES
  ('inventory.locations','inventory'), ('inventory.movements','inventory'),
  ('inventory.stock_report','inventory'), ('expenses.list','expenses'), ('expenses.upload','expenses'),
  ('expenses.manual','expenses'), ('expenses.categories','expenses'), ('expenses.evidence','expenses'),
  ('expenses.substitute_receipt','expenses'), ('procurement.suppliers','procurement'),
  ('procurement.purchase_requests','procurement'), ('procurement.purchase_orders','procurement'),
  ('procurement.goods_receipts','procurement'), ('procurement.vendor_bills','procurement'),
  ('procurement.supplier_payments','procurement'), ('procurement.ap_aging','procurement'),
  ('bank_reconciliation.accounts','bank_reconciliation'), ('bank_reconciliation.cash','bank_reconciliation'),
  ('bank_reconciliation.import','bank_reconciliation'), ('bank_reconciliation.matching','bank_reconciliation'),
  ('bank_reconciliation.reconciliations','bank_reconciliation'),
  ('bank_reconciliation.adjustments','bank_reconciliation'), ('crm.overview','crm'), ('crm.leads','crm'),
  ('crm.pipeline','crm'), ('crm.followups','crm'), ('crm.customers','crm'), ('crm.inbox','crm'),
  ('crm.bookings','crm'), ('dashboard_notifications.preferences','dashboard_notifications'),
  ('dashboard_notifications.rules','dashboard_notifications'),
  ('workflow_automation.templates','workflow_automation'), ('workflow_automation.rules','workflow_automation'),
  ('workflow_automation.runs','workflow_automation'), ('workflow_automation.tasks','workflow_automation'),
  ('workflow_automation.dead_letters','workflow_automation'),
  ('workflow_automation.webhooks','workflow_automation'), ('employee_access.employees','employee_access'),
  ('employee_access.roles','employee_access'), ('employee_access.overview','employee_access'),
  ('company_settings.branches','company_settings'), ('company_settings.security','company_settings')
),
default_on(k) AS (VALUES ('employee_access'),('company_settings')),
inherit(target, src) AS (VALUES ('reimbursement','expenses'),('reimbursement','procurement'),('product_catalog','inventory'),('product_catalog','crm'),('line_oa','crm')),
canon(k) AS (SELECT k FROM parent_key UNION ALL SELECT k FROM sub_key),
co AS (SELECT id AS company_id, name, status FROM "Company"),
ent AS (SELECT "companyId" AS company_id, "featureKey" AS k, enabled FROM "CompanyFeatureEntitlement"),
n AS (
  SELECT co.company_id, co.name, co.status,
         (SELECT count(*) FROM ent e WHERE e.company_id = co.company_id) AS row_count
  FROM co
),
-- S-2: base set
s1 AS (SELECT company_id, k FROM ent WHERE enabled),
-- S-3: DEFAULT_ON unless explicit false
s2 AS (
  SELECT n.company_id, d.k FROM n CROSS JOIN default_on d
  WHERE n.row_count > 0
    AND NOT EXISTS (SELECT 1 FROM ent e WHERE e.company_id = n.company_id AND e.k = d.k AND e.enabled = false)
),
e2 AS (SELECT company_id, k FROM s1 UNION SELECT company_id, k FROM s2),
-- S-4: legacy inheritance, only when the target has no row at all
s3 AS (
  SELECT n.company_id, i.target AS k FROM n CROSS JOIN inherit i
  WHERE n.row_count > 0
    AND NOT EXISTS (SELECT 1 FROM ent e WHERE e.company_id = n.company_id AND e.k = i.target)
    AND EXISTS (SELECT 1 FROM e2 WHERE e2.company_id = n.company_id AND e2.k = i.src)
  GROUP BY n.company_id, i.target
),
e3 AS (SELECT company_id, k FROM e2 UNION SELECT company_id, k FROM s3),
-- S-5/S-6/S-7: submenu auto-enable off the post-DEFAULT_ON, post-inheritance parent set
s4 AS (
  SELECT e3.company_id, sk.k FROM e3 JOIN sub_key sk ON sk.parent = e3.k
  WHERE NOT EXISTS (SELECT 1 FROM ent e WHERE e.company_id = e3.company_id AND e.k = sk.k AND e.enabled = false)
),
e4 AS (SELECT company_id, k FROM e3 UNION SELECT company_id, k FROM s4),
-- S-1: fail-open companies get the whole canonical set
s0 AS (SELECT n.company_id, c.k FROM n CROSS JOIN canon c WHERE n.row_count = 0),
eff AS (
  SELECT company_id, k, 'FAIL_OPEN'::text AS origin FROM s0
  UNION ALL
  SELECT x.company_id, x.k,
    CASE
      WHEN EXISTS (SELECT 1 FROM ent e WHERE e.company_id = x.company_id AND e.k = x.k AND e.enabled) THEN 'EXPLICIT_TRUE'
      WHEN x.k IN (SELECT k FROM default_on) THEN 'DEFAULT_ON'
      WHEN x.k IN (SELECT target FROM inherit) THEN 'INHERITED'
      WHEN x.k IN (SELECT k FROM sub_key) THEN 'SUBMENU_AUTO'
      ELSE 'UNEXPECTED_ORIGIN'
    END
  FROM e4 x
),
flags AS (
  SELECT n.company_id, n.name, n.status, n.row_count,
    (SELECT count(*) FROM ent e JOIN canon c ON c.k = e.k WHERE e.company_id = n.company_id) AS canon_rows,
    (SELECT count(*) FROM ent e WHERE e.company_id = n.company_id
       AND e.k NOT IN (SELECT k FROM canon)) AS unknown_rows,
    (SELECT count(*) FROM ent e WHERE e.company_id = n.company_id
       AND e.k IN (SELECT k FROM sub_key)) AS submenu_rows,
    (SELECT count(*) FROM ent e WHERE e.company_id = n.company_id AND e.enabled = false) AS explicit_false_rows,
    EXISTS (SELECT 1 FROM ent e WHERE e.company_id = n.company_id
       AND e.k IN (SELECT k FROM default_on) AND e.enabled = false) AS always_on_disabled,
    (SELECT count(*) FROM eff WHERE eff.company_id = n.company_id AND eff.origin = 'INHERITED') AS inherited_keys,
    (SELECT count(*) FROM eff WHERE eff.company_id = n.company_id AND eff.origin <> 'EXPLICIT_TRUE') AS implicit_on_keys,
    (SELECT count(*) FROM eff WHERE eff.company_id = n.company_id) AS effective_on_keys
  FROM n
),
cohort AS (
  SELECT f.*,
    CASE
      WHEN f.row_count = 0                       THEN 'C0_NO_ROWS_LEGACY_FAIL_OPEN'
      WHEN f.always_on_disabled                  THEN 'C1_ALWAYS_ON_DISABLED_ANOMALY'
      WHEN f.canon_rows = 60                     THEN 'C2_FULL_EXPLICIT'
      WHEN f.inherited_keys > 0                  THEN 'C3_LEGACY_INHERITANCE_DEPENDENT'
      WHEN f.submenu_rows = 0                    THEN 'C4_PARENT_ROWS_ONLY'
      WHEN f.explicit_false_rows > 0             THEN 'C5_PARTIAL_WITH_EXPLICIT_FALSE'
      ELSE                                            'C6_PARTIAL_MIXED_ROWS'
    END AS cohort
  FROM flags f
)
```

`co` deliberately includes **every** company regardless of `status`. F2's exit criterion is "zero incomplete companies" (spec CC7), which is not status-scoped. `status` is carried through so ops can partition later.

### A.1 Cohort definitions (mutually exclusive, exhaustive)

Exclusivity is by **first match in precedence order**, which is how the `cohort` CTE's `CASE` is written. Precedence is by decreasing operational urgency, not by row count. Overlaps are real (the local C3 company is also parent-rows-only) and are reported un-collapsed in §A.2.

| # | Cohort | Predicate (first match wins) | What it means | F2 workload |
| --- | --- | --- | --- | --- |
| C0 | `NO_ROWS_LEGACY_FAIL_OPEN` | `row_count = 0` | The freeloader cohort. Zero rows ⇒ `null` ⇒ `filterPermissionsByEntitlement` returns every permission (S-1). All 60 canonical keys are effectively ON, for free, including keys never sold. | Insert 60 rows. Every ON key is a normalization decision. |
| C1 | `ALWAYS_ON_DISABLED_ANOMALY` | `employee_access` or `company_settings` has an `enabled = false` row | The DEFAULT_ON default has been explicitly overridden. Legal per `feature-registry.ts:16-19` (the operator *can* disable them), but it means the company cannot add employees or see its own branches. **Needs owner confirmation before F2 preserves it** — F2 preserving an accidental false is how a tenant stays locked out forever under `grantOrigin=LEGACY` (no expiry, spec CC7). | Preserve-or-correct decision required per company. |
| C2 | `FULL_EXPLICIT` | `canon_rows = 60` | Every canonical key has a row. Nothing implicit. Only reachable by an operator who set all 60 by hand — onboarding writes 18 (below). | Zero inserts; F2 is a status flip. |
| C3 | `LEGACY_INHERITANCE_DEPENDENT` | `inherited_keys > 0` | At least one of `reimbursement` / `product_catalog` / `line_oa` is ON **only** because of an S-4 rule. These are the keys that silently disappear the moment enforcement flips or the operator writes any row for that key. | Materialize 1-3 inheritance targets + whatever else is implicit. |
| C4 | `PARENT_ROWS_ONLY` | `submenu_rows = 0` | Has parent rows, zero submenu rows — relies on S-5 for all 42 submenus. **This is the onboarding shape**: `create-company-onboarding.use-case.ts:166-173` writes exactly 18 rows (`APPROVED_FEATURE_KEYS`) with `enabled = DEFAULT_ENABLED_FEATURE_KEYS.includes(k)` (9 true / 9 false **as of this baseline**; from 2026-08-04 the default set is 12 keys and onboarding writes a row for every canonical key — see `line-ai-expense-prod-readiness-2026-08-04.md` item B), and never a submenu row. So every company onboarded through the product lands here or in C3. | Insert up to 42 submenu rows. Dominant volume. |
| C5 | `PARTIAL_WITH_EXPLICIT_FALSE` | `explicit_false_rows > 0` (and has submenu rows, and not full) | Mixed coverage with at least one deliberate OFF. The false rows are the ones F2 must **not** flip on. | Partial insert; preserve every false. |
| C6 | `PARTIAL_MIXED_ROWS` | else | Residual: some submenu rows, no explicit false, not full coverage. | Partial insert. |

Exhaustive by construction: C0 covers `row_count = 0`, C6 is the unconditional `ELSE`.

**Tail A3-classify** (counts per cohort):

```sql
SELECT cohort, count(*) AS companies,
       sum(row_count) AS rows_total,
       round(avg(implicit_on_keys), 1) AS avg_implicit_on_keys,
       round(avg(effective_on_keys), 1) AS avg_effective_on_keys
FROM cohort GROUP BY cohort ORDER BY cohort;
```

**Tail A3-per-company** (the row-level worksheet ops actually hands to F2):

```sql
SELECT company_id, name, status, cohort, row_count, canon_rows, submenu_rows,
       explicit_false_rows, unknown_rows, always_on_disabled, inherited_keys,
       implicit_on_keys, effective_on_keys
FROM cohort ORDER BY cohort, name;
```

### A.2 Overlay flags (NOT mutually exclusive)

Precedence hides real overlap, so these are counted independently. A company can appear in several.

```sql
-- Tail A2-overlays
SELECT
  count(*) FILTER (WHERE row_count = 0)                     AS f_no_rows,
  count(*) FILTER (WHERE row_count > 0 AND canon_rows = 60)  AS f_full_explicit,
  count(*) FILTER (WHERE row_count > 0 AND submenu_rows = 0) AS f_parent_rows_only,
  count(*) FILTER (WHERE always_on_disabled)                 AS f_always_on_disabled,
  count(*) FILTER (WHERE inherited_keys > 0)                 AS f_inheritance_dependent,
  count(*) FILTER (WHERE explicit_false_rows > 0)            AS f_has_explicit_false,
  count(*) FILTER (WHERE unknown_rows > 0)                   AS f_unknown_key_rows,
  count(*)                                                   AS companies_total
FROM cohort;
```

```sql
-- Tail A2-inherit-per-rule: which of the 3 S-4 rules is load-bearing, and for how many companies
SELECT eff.k AS inherited_target, count(DISTINCT eff.company_id) AS companies
FROM eff WHERE eff.origin = 'INHERITED' GROUP BY 1 ORDER BY 1;
```

```sql
-- Tail A2-explicit-false-keys: exactly which keys carry a deliberate OFF (BLOCK E not required)
SELECT "featureKey" AS feature_key, count(*) AS companies_with_explicit_false
FROM "CompanyFeatureEntitlement" WHERE enabled = false GROUP BY 1 ORDER BY 2 DESC, 1;
```

---

## B. Baseline detection — the F2 workload and the F1 `would_block` denominator

Definition: a key is **implicit-ON** for a company when it is effectively ON but has no `enabled = true` row — i.e. `eff.origin <> 'EXPLICIT_TRUE'`. Under EXPLICIT semantics (absent row = OFF) every implicit-ON key flips OFF. That set is simultaneously (a) F2's materialization list and (b) the population F1's shadow mode will emit `would_block` for.

### B1 — per feature key, companies that would flip OFF, split by why

```sql
SELECT eff.k AS feature_key, eff.origin, count(DISTINCT eff.company_id) AS companies
FROM eff WHERE eff.origin <> 'EXPLICIT_TRUE'
GROUP BY 1, 2 ORDER BY 3 DESC, 1, 2;
```

### B1b — totals by origin (the four implicit mechanisms, ranked)

```sql
SELECT eff.origin, count(*) AS key_rows, count(DISTINCT eff.company_id) AS companies
FROM eff GROUP BY 1 ORDER BY 2 DESC;
```

### B2 — per-company F2 workload

```sql
SELECT company_id, name, cohort, canon_rows AS rows_today,
       60 - canon_rows AS rows_to_insert, implicit_on_keys AS implicit_on_to_materialize
FROM cohort ORDER BY rows_to_insert DESC, name;
```

### B3 — total F2 workload (sizing the bootstrap command)

```sql
SELECT count(*) AS companies, sum(canon_rows) AS canon_rows_today,
       sum(60 - canon_rows) AS rows_to_insert, count(*) * 60 AS rows_after_f2,
       sum(implicit_on_keys) AS implicit_on_key_rows
FROM cohort;
```

### B4 — reverse flip: explicit `true` masked by a disabled parent (S-6)

A submenu row stored `true` whose parent is not entitled is effectively OFF today. Naive "keep the stored value" normalization would turn it **ON**. F2 must write the *effective* value (`false`), per spec CC7 "materializes every deterministic effective row".

```sql
SELECT e.company_id, e.k AS submenu_key, sk.parent
FROM ent e JOIN sub_key sk ON sk.k = e.k
WHERE e.enabled = true
  AND NOT EXISTS (SELECT 1 FROM eff WHERE eff.company_id = e.company_id AND eff.k = e.k)
ORDER BY 1, 2;
```

### B5 — orphan / unknown `featureKey` rows

`featureKey` is an unconstrained String (`schema.prisma:2401`). Rows outside the 60 canonical keys still suppress fail-open (they count toward `rows.length`) but affect nothing else. F2 must decide: drop, or carry forward.

```sql
SELECT e.k AS unknown_feature_key, count(*) AS rows, count(DISTINCT e.company_id) AS companies
FROM ent e WHERE e.k NOT IN (SELECT k FROM canon) GROUP BY 1 ORDER BY 2 DESC;
```

### B6 — `expense_auto_post` carve-out (historical erratum applied)

BLOCK E models the *permission-resolver* view, in which a fail-open company shows `expense_auto_post` ON. Per S-9 that is a modelling artifact — the drain paths require a literal `enabled: true` row, so those companies are not auto-posting. The original F0 text treated `JournalEntry.sourceType = 'expense.record'` as execution provenance. That was incorrect: manual/backfill and auto-post paths share that source identity, so the journal row cannot prove which worker created it. A5 therefore does not read `JournalEntry` for this decision.

```sql
SELECT c.cohort,
  count(*) AS companies,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ent e WHERE e.company_id = c.company_id
      AND e.k = 'expense_auto_post' AND e.enabled)) AS explicit_true_today,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM eff WHERE eff.company_id = c.company_id
      AND eff.k = 'expense_auto_post' AND eff.origin <> 'EXPLICIT_TRUE')) AS implicit_on_needs_carveout
FROM cohort c GROUP BY 1 ORDER BY 1;
```

F2 rule: preserve ON only when a literal explicit enabled entitlement exists, or when a separately designed and reviewed worker-specific provenance source proves the auto-post path. In the current rollout no such independent worker provenance is approved, so a merely implicit/fail-open value normalizes to OFF. Never infer ON from `JournalEntry.sourceType='expense.record'`.

### B7 — F1 shadow `would_block` denominator, per feature key

`on_implicit_would_block` is the expected shadow-mode `would_block` company count for that key **before** F2 completes. After F2 completes it must be 0 for every key; a non-zero value after F2 is a normalization defect, not a gate defect. F1 should assert against this table, not against a re-derived number.

```sql
SELECT eff.k AS feature_key,
  count(DISTINCT eff.company_id) FILTER (WHERE eff.origin = 'EXPLICIT_TRUE') AS on_explicit,
  count(DISTINCT eff.company_id) FILTER (WHERE eff.origin <> 'EXPLICIT_TRUE') AS on_implicit_would_block,
  count(DISTINCT eff.company_id) AS on_total
FROM eff GROUP BY 1 ORDER BY 3 DESC, 1;
```

### B8 — always-on disabled detail (BLOCK E not required)

```sql
SELECT e."companyId", e."featureKey" AS always_on_key, e.enabled, e."updatedAt"
FROM "CompanyFeatureEntitlement" e
WHERE e."featureKey" IN ('employee_access','company_settings') AND e.enabled = false
ORDER BY 1, 2;
```

---

## C. Local run results

> **LOCAL BARE-SEED DB — NOT REPRESENTATIVE. UAT/prod run pending owner ops approval.**
> 5 companies, 12 entitlement rows total. Four of the five are seed/probe shells with zero rows. Nothing here should be used to size the real F2 batch, to estimate blast radius, or to argue any cohort is empty in production. Its only valid use is **proving the SQL runs and the semantics transcription is correct** — which it did.

Run: 2026-07-31, `psql 15`, `postgresql://watchdog@localhost:15432/watchdog_bms` (root `.env` `DATABASE_URL`), session forced read-only via `PGOPTIONS='-c default_transaction_read_only=on'`. No writes, no DDL, no transactions.

**A3-classify**

| cohort | companies | rows_total | avg_implicit_on_keys | avg_effective_on_keys |
| --- | --- | --- | --- | --- |
| `C0_NO_ROWS_LEGACY_FAIL_OPEN` | 4 | 0 | 60.0 | 60.0 |
| `C3_LEGACY_INHERITANCE_DEPENDENT` | 1 | 12 | 23.0 | 26.0 |

C1, C2, C4, C5, C6 are empty locally. **Empty here is evidence of a bare seed, not evidence the cohort does not exist in UAT/prod.**

**A3-per-company**

| company_id | name | cohort | rows | canon | submenu | false | unknown | inherited | implicit_ON | effective_ON |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `seed-local-company-2` | Bloom Beauty Clinic | C0 | 0 | 0 | 0 | 0 | 0 | 0 | 60 | 60 |
| `seed-local-company` | WatchDog Local Company | C0 | 0 | 0 | 0 | 0 | 0 | 0 | 60 | 60 |
| `seed-watchdog-system-company` | WatchDog System | C0 | 0 | 0 | 0 | 0 | 0 | 0 | 60 | 60 |
| `h04_probe` | probe | C0 | 0 | 0 | 0 | 0 | 0 | 0 | 60 | 60 |
| `cmrqi2gcx0002j9qtq72utehs` | H09 Reissue Verify Co | C3 | 12 | 12 | 0 | 9 | 0 | 3 | 23 | 26 |

**A2-overlays**: `f_no_rows` 4 · `f_full_explicit` 0 · `f_parent_rows_only` **1** · `f_always_on_disabled` 0 · `f_inheritance_dependent` 1 · `f_has_explicit_false` 1 · `f_unknown_key_rows` 0 · total 5.

Note the overlap the precedence hid: the single C3 company is *also* parent-rows-only and *also* has explicit-false rows. In a real dataset most row-bearing companies will satisfy C3, C4 and C5 simultaneously.

**A2-inherit-per-rule**: `line_oa` 1 · `product_catalog` 1 · `reimbursement` 1 — all three S-4 rules fire on the same company. Traced: it has `expenses=true`, `crm=true`, `inventory=false`, `procurement=false`, and no rows for the three targets, so `reimbursement`←`expenses`, `product_catalog`←`crm`, `line_oa`←`crm`.

**A2-explicit-false-keys**: 9 keys, 1 company each — `bank_reconciliation`, `dashboard_notifications`, `double_entry_ledger`, `inventory`, `procurement`, `reports`, `sales_documents`, `thai_tax`, `workflow_automation`.

**B1b-by-origin** (the ranking that matters for F2):

| origin | key_rows | companies |
| --- | --- | --- |
| `FAIL_OPEN` | 240 | 4 |
| `SUBMENU_AUTO` | 18 | 1 |
| `EXPLICIT_TRUE` | 3 | 1 |
| `INHERITED` | 3 | 1 |
| `DEFAULT_ON` | 2 | 1 |
| `UNEXPECTED_ORIGIN` | **0** | 0 |

`UNEXPECTED_ORIGIN = 0` is the assertion in §A.0 passing: every effective-ON key was explained by exactly one of the five modelled mechanisms.

Hand-check of the C3 company against `entitlement.helper.ts:15-29`: 3 explicit-true (`ai_line_assistant`, `crm`, `expenses`) + 2 DEFAULT_ON (S-3, absent rows) + 3 INHERITED (S-4) + 18 SUBMENU_AUTO (S-5: the 6 `expenses.*`, 7 `crm.*`, 3 `employee_access.*`, 2 `company_settings.*` — the last five auto-enabled off a DEFAULT_ON parent, confirming S-7) = **26 effective ON, 23 implicit**. Matches the query exactly.

**B1 / B7**: all 60 canonical keys appear. Locally every key has `on_implicit_would_block` ≥ 4 (the four fail-open shells); only `ai_line_assistant`, `crm`, `expenses` have any explicit-ON company at all (1 each).

**B2 / B3 total workload**: 5 companies · 12 canon rows today · **288 rows to insert** · 300 rows after F2 · 263 implicit-ON key rows to decide.

**B4** (explicit-true masked by parent): **0 rows** — the reverse-flip hazard does not occur locally. Local emptiness proves nothing about UAT/prod; this query is a required prod check.

**B5** (unknown keys): **0 rows** locally.

**B6** (`expense_auto_post`): 0 companies have an explicit-true row and 4 (the fail-open shells) are flagged `implicit_on_needs_carveout`. The historical “0 have execution evidence” result is withdrawn because `JournalEntry.sourceType='expense.record'` is not auto-post provenance. Per the corrected F2 rule all five local companies normalize to `expense_auto_post = false`.

**B8**: 0 rows — no always-on key is disabled locally.

---

## D. `A5-RO` UAT runbook — DEDICATED ZERO-WRITE PATH, EXECUTION PENDING

**Not yet accepted as live evidence.** Candidate deploy run `30774515157` stopped safely before health/M-01 because ECS `SUCCESSFUL` preceded old-configuration drain. A new full-SHA UAT deployment is required before A5 can bind itself to an accepted serving build. The current A5 path is UAT-only; production needs a separately provisioned/reviewed role and fresh preflight.

### D.1 Authority boundary

- PostgreSQL role: exact `watchdog_a5_ro`, `NOINHERIT`, no role memberships/ownership, no DML, no database/schema `CREATE`, no executable application `SECURITY DEFINER`, and no privilege outside `SELECT` on this exact list: `_prisma_migrations`, `Company`, `CompanyFeatureEntitlement`, `CompanyEntitlementNormalization`, `EntitlementTransition`, `AuditLog`, `CompanyOnboardingRun`, `FeatureLaunchGate`, `FeatureLaunchGateTransition`, `FeatureLaunchObservationBucket`, `ExecutionAttempt`, `RunoffSnapshot`, and `WorkflowTask`.
- Execution: `A5-RO`, F2 PLAN and F2 VERIFY run directly with the dedicated read-only database secret and **no ECS task role**. Enforce read-only twice: role default plus transaction/session `default_transaction_read_only=on`. Any guard mismatch is a hard stop.
- Writer separation: only F2 APPLY receives the writer secret and durable remote-operation wrapper. APPLY re-plans under each company lock and expected-version/hash CAS before mutation; it cannot treat the prior PLAN as a write result. VERIFY returns to `watchdog_a5_ro`.
- Data minimization: the A5 artifact contains only tenant-anonymous aggregates. It never includes a company id, company name or row-level customer payload. The separate restricted F2 review artifact may carry the minimum per-company hashes/orphan detail required for approval; do not merge it into A5 or a public summary.
- No authority expansion: A5 approval does not authorize `A5-CAPACITY-MUTATING`, enforcement, route OPEN, production deploy, or WHT. All `cap.wht50bis/*` rows remain CLOSED.

### D.2 Artifact contract and readiness

The deterministic A5 artifact records environment, exact serving/source full SHA, schema/query version, `queryCatalogHash`, `evidenceHash`, generated time, migration/catalog/normalization/launch-health aggregates, `WorkflowTask` duplicate aggregates, blockers and advisories. Recompute the evidence hash over the canonical payload with volatile/hash fields excluded and reject a mismatch. The source SHA must equal the accepted UAT serving SHA; historical transition/shadow builds do not substitute.

`f2PrecheckReady=true` requires the exact-SHA guard, a valid true read-only A5 run and a clean human-reviewed F2 PLAN. It authorizes F2 APPLY only. Missing shadow windows or representative capacity remains an advisory here and does not block the current per-company state-only F2 APPLY; it is a hard blocker for `enforcementReady(feature/route)` and `promotionReady`. F2 fixed-point/matrix/shadow/`would_block`/runoff/live-UAT/capacity evidence is evaluated later per feature/route. Production additionally requires journeys, rollback/recovery, security, accessibility/usability and its own read-only preflight.

Re-run points: immediately before the reviewed F2 PLAN, freshly in the APPLY workflow before the writer starts, and after APPLY through independent F2 VERIFY. Environment/source/query-catalog identity must match. Operational aggregates such as shadow/attempt counts may evolve normally; any changed entitlement-estate membership or per-company state changes the normalization hash and is refused by APPLY for a fresh PLAN. A stale or changed plan is regenerated, never edited in place.

This process is deploy-owned and zero-form. It does not ask customers to migrate, re-enter history, map route keys or supply new setup data.

---

## E. Preset fixture spec

Recipes only — **fixtures are not written in this lane**. Each recipe names an existing helper so F1/F2 construct them the repo's way instead of inventing a new factory.

### E.1 Existing helpers (real names, real files)

| Level | Helper | Location | Shape | Use for |
| --- | --- | --- | --- | --- |
| Unit (evaluator) | `prismaWithEntitlements(rows)` | `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.spec.ts:307` | returns `{ client: { companyFeatureEntitlement: { findMany: async () => rows } } }`; `rows: Array<{ featureKey, enabled }>` | direct `loadEntitledFeatureKeys` cohort assertions |
| Unit (evaluator, duplicate) | `prismaWithEntitlements(rows)` | `apps/api/src/modules/employee-access/domain/logic/menu-entitlement-binding.spec.ts:13` | byte-equivalent second copy | menu-binding parity; **hoist to one shared helper when F1 adds a third caller** |
| Unit (resolver) | `makePrismaResolver(membership, activeBranchIds, entitlements)` | `apps/api/src/modules/access-control/permission-resolver.spec.ts:76` | third arg is the entitlement rows | end-to-end permission-stripping per cohort |
| Unit (writer) | inline prisma double with `opts.existing` | `apps/api/src/modules/system-partner-management/application/use-cases/set-partner-features.use-case.spec.ts:30-110` | stubs `findMany` (twice — 2nd call returns `updatedAt`), `upsert`, `auditLog.create`, `$transaction` | F2 bootstrap-command tests: asserts which keys got upserted |
| DB (real seeding path) | `CreateCompanyOnboardingUseCase` | `apps/api/src/modules/system-onboarding/.../create-company-onboarding.use-case.ts:166-173` | `createMany` over `APPROVED_FEATURE_KEYS` (18), `enabled = DEFAULT_ENABLED_FEATURE_KEYS.includes(k)` | producing a genuine C4 company without hand-writing rows |
| Key lists | `FEATURE_PACKAGE_PRESETS` (`starter`/`standard`/`full`) | `packages/contracts/src/menu-entitlements.ts:404-431` | `full` = all 60 minus `expense_auto_post` | building C2 and package-shaped fixtures |
| Key lists | `APPROVED_FEATURE_KEYS` (18) / `APPROVED_FEATURE_ENTITLEMENT_KEYS` (60) / `DEFAULT_ENABLED_FEATURE_KEYS` (9) | `apps/api/src/modules/system-partner-management/domain/feature-registry.ts:6-7,21-31` | — | every recipe below |

**Gap to close in F1, not here:** there is **no DB-level entitlement fixture** anywhere. `e2e/harness/fixtures.ts` exposes only `companyId` (`COMPANY_ID = 'seed-local-company'`), which is a **C0 zero-row company** — so today's whole E2E suite runs under fail-open and cannot observe a gate at all. F1 needs either a per-cohort seeded company or a fixture that writes rows for the test company.

### E.2 Recipes (9)

Rows are `{ featureKey, enabled }`. "absent" means write no row for that key — absence is the load-bearing part of every legacy recipe.

| # | Fixture | Recipe | Asserts |
| --- | --- | --- | --- |
| R0 | `fixtureC0_noRowsFailOpen` | `prismaWithEntitlements([])` | `loadEntitledFeatureKeys` → `null`; `filterPermissionsByEntitlement(perms, null)` → `perms` unchanged (S-1). F1 shadow must emit `would_block` for every gated permission; F2 must materialize 60 rows. |
| R1 | `fixtureC1_alwaysOnDisabled` | 18 parent rows as onboarding writes them, then override `employee_access: false` (and a variant with `company_settings: false`) | `entitled` excludes `employee_access` **and** its 3 submenus (S-3 + S-5 interaction). This is the anomaly F2 must not silently preserve. |
| R2 | `fixtureC2_fullExplicit` | all 60 `APPROVED_FEATURE_ENTITLEMENT_KEYS` with `enabled` from `FEATURE_PACKAGE_PRESETS.full` (i.e. all true except `expense_auto_post`) | zero implicit keys; effective set under legacy semantics == effective set under EXPLICIT semantics. The F2 idempotence target: normalizing this company changes nothing. |
| R3 | `fixtureC3_inheritanceDependent` | `[{expenses,true},{crm,true},{inventory,false},{procurement,false}]`, **absent**: `reimbursement`, `product_catalog`, `line_oa` | all three S-4 rules fire: the three targets ON with no rows. Mirrors the real local C3 company. Sub-variants: `R3a` `expenses` only (→`reimbursement`), `R3b` `inventory` only (→`product_catalog`), `R3c` `crm` only (→ all three targets, since `crm` sources both `product_catalog` and `line_oa`). |
| R3n | `fixtureC3_inheritanceBlockedByRow` | same as R3 but add `{reimbursement,false}` | S-4's `!explicit.has` guard: an explicit false row **suppresses** inheritance. Proves F2 must not resurrect it. |
| R4 | `fixtureC4_parentRowsOnly` | exactly the onboarding output: 18 rows, `enabled = DEFAULT_ENABLED_FEATURE_KEYS.includes(k)`, zero submenu rows | 42 submenus resolve purely by S-5; submenus of the 9 disabled parents stay OFF. Largest F2 insert count. Build via `CreateCompanyOnboardingUseCase` for the DB-level variant so the fixture cannot drift from onboarding. |
| R5 | `fixtureC5_partialExplicitFalse` | R4 rows plus a handful of submenu rows including at least one `false` under an enabled parent (e.g. `{expenses,true}` + `{expenses.substitute_receipt,false}`) | S-5's `explicit.get(submenu.key) !== false`: the one false submenu stays OFF while its siblings auto-enable. F2 must preserve it. |
| R6 | `fixtureC6_partialMixed` | some parents + some submenu rows, all `true`, coverage < 60 | residual-path coverage; nothing exotic, just proves the classifier's `ELSE` branch and partial insert math. |
| R7 | `fixtureEdge_explicitTrueMaskedByParent` | `{inventory,false}` + `{inventory.locations,true}` | S-6: stored `true`, effective **OFF**. The §B4 hazard. F2 must write `false`, not carry the stored `true`. |
| R8 | `fixtureEdge_unknownKeyRow` | `[{ featureKey: 'legacy_removed_feature', enabled: true }]` only | one junk row suppresses fail-open (`rows.length !== 0`), so the company gets an **empty** entitled set — every gated permission stripped. The nastiest legacy shape: a single stale row silently locks a tenant out. §B5 detects it in prod. |

Recipe-to-cohort coverage is 1:1 with §A.1 (R0→C0 … R6→C6), plus R3n/R7/R8 for the three suppression/masking edges that no cohort row can express.

---

## F. Open questions and resolved later decisions

1. **C1 / B8** — is any always-on disable intentional? F2 preserves effective state with `grantOrigin=LEGACY` and **no expiry** (spec CC7), so an accidental false becomes permanent.
2. **B5** — orphan `featureKey` rows: drop during normalization, or carry forward? Carrying them forward keeps a tenant's set non-empty for no benefit; dropping them can flip a company from "one junk row" to fail-open if F2 partially fails.
3. **B4** — confirm F2 writes the *effective* value (`false`) for a masked explicit-true submenu rather than the stored value.
4. **B6 — RESOLVED/ERRATUM:** `JournalEntry.sourceType='expense.record'` is not accepted provenance because manual/backfill and auto-post share it. Preserve ON only from an explicit enabled entitlement or separately reviewed worker-specific provenance.
5. **§D / `A5-RO` — UAT design resolved, execution pending:** use dedicated exact-core-SELECT `watchdog_a5_ro`, no task role, double read-only enforcement and a tenant-anonymous hash-bound artifact. This approval is UAT-only and separate from both production provisioning/review and explicit owner approval for `A5-CAPACITY-MUTATING`; none implies another.
