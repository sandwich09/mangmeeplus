# F0 Inventory — Contracts + Permissions (Lane S1)

| | |
| --- | --- |
| Generated | 2026-07-31 |
| Git HEAD | `ba91c102c49ab7964697a540a2f63d42a497aa6a` (branch `develop`) |
| Lane | S1 — contracts + permissions inventory, phase F0 |
| Plan | `docs/plans/feature-entitlement-decoupling-plan.md` §3 F0 |
| Nature | Mechanical inventory. Every row carries `file:line` evidence. Unresolvable items are listed in §10 BLOCKED. |

Counts: **featureKeys** 18 · **allEntitlementKeys** 60 · **submenuKeys** 42 · **prefixRules** 10 · **permissionKeys** 324 · **permissionPrefixes** 26 · **capabilityPacks** 51 · **unmapped** 39 · **bypasses** 8 · **blocked** 5

> Extraction method: constants imported directly from source via `tsx` (`PERMISSIONS`, `CAPABILITY_PACKS`, `FEATURE_CATALOG`, `LEGACY_FEATURE_INHERITANCE`, `DEFAULT_ON_FEATURE_KEYS`), not re-typed. Line numbers resolved by scanning the source files.

---

## 1. Canonical feature keys

**Defined in `packages/contracts/src/feature-entitlements.ts:17-550` (`FEATURE_CATALOG`).** Derived exports: `FEATURE_KEYS` (:560, 18 parents), `ALL_FEATURE_ENTITLEMENT_KEYS` (:562-565, 60 = 18 parents + 42 submenus), `parentFeatureKey()` (:567-569).

Re-exported to the API as `APPROVED_FEATURE_KEYS` / `APPROVED_FEATURE_ENTITLEMENT_KEYS` at `apps/api/src/modules/system-partner-management/domain/feature-registry.ts:6-7`. Contracts barrel export: `packages/contracts/src/index.ts:261`.

**The expected 18-key list matches code exactly — no diff.** (Verified against `FEATURE_KEYS` at runtime.)

| # | Feature key | Evidence | Group | Submenus | Always-on | Default-enabled at onboarding | Gate mechanism |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `inventory` | `packages/contracts/src/feature-entitlements.ts:19` | operate | 3 | no | no | packs ×3 + submenu ×3 |
| 2 | `product_catalog` | `packages/contracts/src/feature-entitlements.ts:48` | operate | 0 | no | yes | prefix `inventory.product.` |
| 3 | `sales_documents` | `packages/contracts/src/feature-entitlements.ts:55` | operate | 0 | no | no | packs ×9 |
| 4 | `expenses` | `packages/contracts/src/feature-entitlements.ts:62` | finance | 6 | no | yes | packs ×4 + submenu ×6 |
| 5 | `reimbursement` | `packages/contracts/src/feature-entitlements.ts:112` | finance | 0 | no | yes | prefix `reimbursement.` |
| 6 | `double_entry_ledger` | `packages/contracts/src/feature-entitlements.ts:119` | finance | 0 | no | no | packs ×3 |
| 7 | `expense_auto_post` | `packages/contracts/src/feature-entitlements.ts:130` | finance | 0 | no | no | **NONE** |
| 8 | `thai_tax` | `packages/contracts/src/feature-entitlements.ts:137` | finance | 0 | no | no | packs ×3 |
| 9 | `procurement` | `packages/contracts/src/feature-entitlements.ts:144` | operate | 7 | no | no | packs ×6 + submenu ×7 |
| 10 | `bank_reconciliation` | `packages/contracts/src/feature-entitlements.ts:235` | finance | 6 | no | no | packs ×5 + submenu ×6 |
| 11 | `crm` | `packages/contracts/src/feature-entitlements.ts:295` | growth | 7 | no | yes | prefix `crm.` + packs ×3 + submenu ×7 |
| 12 | `dashboard_notifications` | `packages/contracts/src/feature-entitlements.ts:387` | operate | 2 | no | yes | prefix `dashboard.` `notification.` + packs ×2 + submenu ×2 |
| 13 | `ai_line_assistant` | `packages/contracts/src/feature-entitlements.ts:409` | operate | 0 | no | yes | prefix `crm.ai.` `ai.suggestion.` `ai.draft.` |
| 14 | `line_oa` | `packages/contracts/src/feature-entitlements.ts:416` | operate | 0 | no | yes | prefix `crm.channel.` |
| 15 | `reports` | `packages/contracts/src/feature-entitlements.ts:423` | finance | 0 | no | no | prefix `report.` |
| 16 | `workflow_automation` | `packages/contracts/src/feature-entitlements.ts:430` | operate | 6 | no | no | packs ×3 + submenu ×6 |
| 17 | `employee_access` | `packages/contracts/src/feature-entitlements.ts:480` | operate | 3 | **YES** | yes | submenu ×3 |
| 18 | `company_settings` | `packages/contracts/src/feature-entitlements.ts:525` | operate | 2 | **YES** | yes | submenu ×2 |

### Always-on / non-sellable

`DEFAULT_ON_FEATURE_KEYS = ['employee_access', 'company_settings']` — `packages/contracts/src/feature-entitlements.ts:552`.

Applied at `apps/api/src/modules/employee-access/application/entitlement.helper.ts:17-19`: an **absent** row means enabled; an **explicit `false`** row still disables the feature. So "always-on" is a default, not an invariant — the Partner screen can turn both off. Rationale comment: `apps/api/src/modules/system-partner-management/domain/feature-registry.ts:16-19`.

`DEFAULT_ENABLED_FEATURE_KEYS` (the onboarding "Mangmee baseline", 9 keys at the time of this inventory; 12 from 2026-08-04 — `thai_tax`, `double_entry_ledger`, `workflow_automation` added) — `apps/api/src/modules/system-partner-management/domain/feature-registry.ts:21-31`.

Commercial presets `FEATURE_PACKAGE_PRESETS` (`starter` / `standard` / `full`) — `packages/contracts/src/menu-entitlements.ts:405-431`. `full` is `ALL_FEATURE_ENTITLEMENT_KEYS` minus `expense_auto_post` (:429).

**No key is marked sellable/non-sellable in code** — see §10 BLOCKED B1.

---

## 2. `PREFIX_FEATURE_RULES`

**Defined in `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:39-50`** (NOT in contracts). Rationale comments: :17-38. Evaluated at :81-82 with `Array.find` — **first matching prefix wins**, so order is load-bearing.

A rule is satisfied if **ANY** listed feature key is entitled (`featureKeys.some(...)`, :82). All 10 rules currently list exactly one feature key.

| Order | Prefix | → Feature key | Evidence | Registered perms matching | …gated *solely* by this rule |
| --- | --- | --- | --- | --- | --- |
| 1 | `inventory.product.` | `product_catalog` | `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:40` | 2 | 2 |
| 2 | `report.` | `reports` | `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:41` | 14 | 14 |
| 3 | `reimbursement.` | `reimbursement` | `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:42` | 15 | 15 |
| 4 | `dashboard.` | `dashboard_notifications` | `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:43` | 3 | 3 |
| 5 | `notification.` | `dashboard_notifications` | `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:44` | 5 | 3 |
| 6 | `crm.channel.` | `line_oa` | `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:45` | 2 | 2 |
| 7 | `crm.ai.` | `ai_line_assistant` | `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:46` | 2 | 2 |
| 8 | `crm.` | `crm` | `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:47` | 43 | 4 |
| 9 | `ai.suggestion.` | `ai_line_assistant` | `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:48` | 7 | 7 |
| 10 | `ai.draft.` | `ai_line_assistant` | `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:49` | 4 | 4 |

Ordering hazards that are live today: `crm.channel.` (line_oa) and `crm.ai.` (ai_line_assistant) **must** precede `crm.` (:45-47) or they would be swallowed by the CRM toggle. `inventory.product.` (:40) is not shadowed by any later rule because no `inventory.` rule exists.

No rule is dead: every one of the 10 prefixes matches ≥2 registered permission keys.

---

## 3. Submenu / subfeature rules

42 submenu definitions across 8 parents (10 parents have zero submenus). Source: the `submenus[]` arrays inside `FEATURE_CATALOG`, flattened into `SUBFEATURE_RULES` at `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:13-15`.

### 3a. Auto-enable-with-parent semantics

`apps/api/src/modules/employee-access/application/entitlement.helper.ts:25-29`:

```
for (const feature of FEATURE_CATALOG)
  for (const submenu of feature.submenus)
    if (entitled.has(feature.key) && explicit.get(submenu.key) !== false) entitled.add(submenu.key);
```

- Parent entitled + **no** submenu row → submenu is **ENABLED** (inherits).
- Parent entitled + submenu row `enabled=true` → enabled.
- Parent entitled + submenu row `enabled=false` → **disabled** (explicit false is the only way to turn a child off).
- Parent **not** entitled → submenu never added, regardless of its own row.

The plan notes this block is scheduled for removal at the end of CC7 (`docs/plans/feature-entitlement-decoupling-plan.md:22`).

### 3b. Runtime veto semantics

`feature-gate.logic.ts:79-80`:

```
const subfeature = SUBFEATURE_RULES.find((rule) => rule.permissionKeys.includes(permission));
if (subfeature && (!entitled.has(subfeature.parentKey) || !entitled.has(subfeature.key))) return false;
```

This is a **veto only**: a permission needs BOTH parent and submenu entitled to survive, but surviving does **not** short-circuit — execution falls through to the prefix rule (:81) and then the pack checks (:83-85). 112 of the 324 registered permissions are subject to both a submenu veto and a second gate (AND semantics). `Array.find` takes the first matching submenu; today no permission key appears in two submenus, so the ambiguity is latent, not live.

### 3c. Submenu table

| Submenu key | Parent | Route | Perms | Evidence |
| --- | --- | --- | --- | --- |
| `inventory.locations` | `inventory` | `/inventory/locations` | 2 | `packages/contracts/src/feature-entitlements.ts:25` |
| `inventory.movements` | `inventory` | `/inventory/movements` | 1 | `packages/contracts/src/feature-entitlements.ts:32` |
| `inventory.stock_report` | `inventory` | `/inventory/reports/stock` | 1 | `packages/contracts/src/feature-entitlements.ts:39` |
| `expenses.list` | `expenses` | `/expenses` | 2 | `packages/contracts/src/feature-entitlements.ts:68` |
| `expenses.upload` | `expenses` | `/expenses/upload` | 3 | `packages/contracts/src/feature-entitlements.ts:75` |
| `expenses.manual` | `expenses` | `/expenses/manual` | 2 | `packages/contracts/src/feature-entitlements.ts:82` |
| `expenses.categories` | `expenses` | `/expenses/categories` | 1 | `packages/contracts/src/feature-entitlements.ts:89` |
| `expenses.evidence` | `expenses` | `/expenses/evidence` | 2 | `packages/contracts/src/feature-entitlements.ts:96` |
| `expenses.substitute_receipt` | `expenses` | `/expenses/signatures` | 2 | `packages/contracts/src/feature-entitlements.ts:103` |
| `procurement.suppliers` | `procurement` | `/procurement?tab=suppliers` | 4 | `packages/contracts/src/feature-entitlements.ts:150` |
| `procurement.purchase_requests` | `procurement` | `/procurement?tab=pr` | 3 | `packages/contracts/src/feature-entitlements.ts:162` |
| `procurement.purchase_orders` | `procurement` | `/procurement?tab=po` | 5 | `packages/contracts/src/feature-entitlements.ts:173` |
| `procurement.goods_receipts` | `procurement` | `/procurement?tab=gr` | 3 | `packages/contracts/src/feature-entitlements.ts:186` |
| `procurement.vendor_bills` | `procurement` | `/accounts-payable?tab=bills` | 9 | `packages/contracts/src/feature-entitlements.ts:197` |
| `procurement.supplier_payments` | `procurement` | `/accounts-payable?tab=payments` | 4 | `packages/contracts/src/feature-entitlements.ts:214` |
| `procurement.ap_aging` | `procurement` | `/accounts-payable?tab=aging` | 1 | `packages/contracts/src/feature-entitlements.ts:226` |
| `bank_reconciliation.accounts` | `bank_reconciliation` | `/banking?tab=accounts` | 3 | `packages/contracts/src/feature-entitlements.ts:241` |
| `bank_reconciliation.cash` | `bank_reconciliation` | `/banking?tab=cash` | 1 | `packages/contracts/src/feature-entitlements.ts:248` |
| `bank_reconciliation.import` | `bank_reconciliation` | `/banking?tab=import` | 3 | `packages/contracts/src/feature-entitlements.ts:255` |
| `bank_reconciliation.matching` | `bank_reconciliation` | `/banking?tab=matching` | 4 | `packages/contracts/src/feature-entitlements.ts:262` |
| `bank_reconciliation.reconciliations` | `bank_reconciliation` | `/banking?tab=reconciliations` | 4 | `packages/contracts/src/feature-entitlements.ts:269` |
| `bank_reconciliation.adjustments` | `bank_reconciliation` | `/banking?tab=adjustments` | 4 | `packages/contracts/src/feature-entitlements.ts:281` |
| `crm.overview` | `crm` | `/crm-reports` | 1 | `packages/contracts/src/feature-entitlements.ts:301` |
| `crm.leads` | `crm` | `/crm?tab=leads` | 6 | `packages/contracts/src/feature-entitlements.ts:308` |
| `crm.pipeline` | `crm` | `/crm?tab=pipeline` | 10 | `packages/contracts/src/feature-entitlements.ts:322` |
| `crm.followups` | `crm` | `/crm?tab=followups` | 3 | `packages/contracts/src/feature-entitlements.ts:340` |
| `crm.customers` | `crm` | `/customers` | 10 | `packages/contracts/src/feature-entitlements.ts:347` |
| `crm.inbox` | `crm` | `/inbox` | 5 | `packages/contracts/src/feature-entitlements.ts:365` |
| `crm.bookings` | `crm` | `/bookings` | 4 | `packages/contracts/src/feature-entitlements.ts:378` |
| `dashboard_notifications.preferences` | `dashboard_notifications` | `/notifications/preferences` | 1 | `packages/contracts/src/feature-entitlements.ts:393` |
| `dashboard_notifications.rules` | `dashboard_notifications` | `/notifications/rules` | 1 | `packages/contracts/src/feature-entitlements.ts:400` |
| `workflow_automation.templates` | `workflow_automation` | `/workflow?tab=templates` | 1 | `packages/contracts/src/feature-entitlements.ts:436` |
| `workflow_automation.rules` | `workflow_automation` | `/workflow?tab=rules` | 3 | `packages/contracts/src/feature-entitlements.ts:443` |
| `workflow_automation.runs` | `workflow_automation` | `/workflow?tab=runs` | 2 | `packages/contracts/src/feature-entitlements.ts:450` |
| `workflow_automation.tasks` | `workflow_automation` | `/workflow?tab=tasks` | 2 | `packages/contracts/src/feature-entitlements.ts:457` |
| `workflow_automation.dead_letters` | `workflow_automation` | `/workflow?tab=dead-letters` | 2 | `packages/contracts/src/feature-entitlements.ts:464` |
| `workflow_automation.webhooks` | `workflow_automation` | `/workflow?tab=webhooks` | 1 | `packages/contracts/src/feature-entitlements.ts:471` |
| `employee_access.employees` | `employee_access` | `/settings/employees` | 7 | `packages/contracts/src/feature-entitlements.ts:486` |
| `employee_access.roles` | `employee_access` | `/settings/permissions` | 7 | `packages/contracts/src/feature-entitlements.ts:501` |
| `employee_access.overview` | `employee_access` | `/settings/access-overview` | 1 | `packages/contracts/src/feature-entitlements.ts:516` |
| `company_settings.branches` | `company_settings` | `/settings/branches` | 2 | `packages/contracts/src/feature-entitlements.ts:531` |
| `company_settings.security` | `company_settings` | `/settings/security` | 3 | `packages/contracts/src/feature-entitlements.ts:538` |

Parents with **zero** submenus (gated only by prefix rule and/or capability pack): `product_catalog`, `sales_documents`, `reimbursement`, `double_entry_ledger`, `expense_auto_post`, `thai_tax`, `ai_line_assistant`, `line_oa`, `reports`.

### 3d. Subfeature dependency table

**None exists.** No submenu→submenu or submenu→feature dependency constant is declared anywhere in `packages/contracts`. See §10 BLOCKED B2.

---

## 4. `LEGACY_FEATURE_INHERITANCE` and legacy fail-open

### 4a. Full contents

Defined at `packages/contracts/src/feature-entitlements.ts:554-558`. Complete — three entries, no others exist:

| Feature key | Inherits if ANY of | Evidence |
| --- | --- | --- |
| `reimbursement` | `expenses`, `procurement` | `packages/contracts/src/feature-entitlements.ts:555` |
| `product_catalog` | `inventory`, `crm` | `packages/contracts/src/feature-entitlements.ts:556` |
| `line_oa` | `crm` | `packages/contracts/src/feature-entitlements.ts:557` |

Applied at `apps/api/src/modules/employee-access/application/entitlement.helper.ts:20-24`:

```
if (!explicit.has(featureKey) && legacyFeatureKeys.some((legacyKey) => entitled.has(legacyKey)))
  entitled.add(featureKey);
```

Guard `!explicit.has(featureKey)` means inheritance applies **only when the company has no row at all** for that key — an explicit `false` row is respected. Note the check reads `entitled` (post-`DEFAULT_ON` merge), so ordering relative to :17-19 matters, though none of the three source keys is in `DEFAULT_ON_FEATURE_KEYS`.

Mirrored (independently reimplemented) in the web app at `apps/web/src/features/system-partners/system-partners.logic.ts:80-84`.

### 4b. Legacy fail-open (`entitled === null`)

Two halves:

| Half | Evidence | Semantics |
| --- | --- | --- |
| Producer | `apps/api/src/modules/employee-access/application/entitlement.helper.ts:14` | `if (rows.length === 0) return null;` — zero `CompanyFeatureEntitlement` rows for the company → `null`. Note: **zero rows**, not "zero enabled rows". A company with 18 rows all `enabled=false` returns an empty `Set`, not `null`. |
| Consumer | `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:75-76` | `if (entitled === null) return permissions;` — every granted permission survives, unfiltered. Documented at :73-74. |

Deliberate, with a stated exit condition — `entitlement.helper.ts:6-8`: fail-open "until every company is guaranteed to have entitlement rows seeded at onboarding". Onboarding now does seed rows (`create-company-onboarding.use-case.ts:166-173`), so only pre-onboarding-change tenants remain in the fail-open cohort.

Other consumers of the same `null` convention:

- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:409-412` — `lineAssistantDisabled` returns `entitled !== null && !entitled.has('ai_line_assistant')`, i.e. **null ⇒ not disabled**.
- `apps/api/src/modules/crm-inbox/domain/logic/mvp1-0-setup.logic.ts:26-28,66-70,84-90` — surfaces the null cohort as a `WARN` check.
- `apps/api/prisma/crm-mvp1-0-setup.ts:37`.
- **Divergent:** `apps/web/src/features/system-partners/system-partners.logic.ts:63-68` treats "no rows" as *everything on except `expense_auto_post`*, whereas the API treats it as *everything on including `expense_auto_post`*. See anomaly A5.

---

## 5. The entitlement chokepoint

`filterPermissionsByEntitlement(permissions: string[], entitled: Set<string> | null): string[]` — `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:75-88`.

### 5a. Exact evaluation order (per permission)

| Step | Evidence | Rule | Terminal? |
| --- | --- | --- | --- |
| 1 | `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:76` | entitled === null => return permissions unchanged (LEGACY FAIL-OPEN, no filtering at all) | yes (whole call) |
| 2 | `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:79-80` | SUBFEATURE_RULES.find(first submenu whose permissionKeys includes the permission); if found and (parent not entitled OR submenu key not entitled) => DENY. Veto only; a pass falls through. | only on DENY |
| 3 | `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:81-82` | PREFIX_FEATURE_RULES.find(first prefix the permission startsWith); if found => ALLOW iff ANY listed featureKey is entitled. Terminal (return). | yes |
| 4 | `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:83` | permission belongs to any capability pack with NO featureEntitlementKey => ALLOW unconditionally. Terminal. | yes |
| 5 | `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:84-85` | permission belongs to >=1 gated pack => ALLOW iff ANY of those featureEntitlementKeys is entitled. Terminal. | yes |
| 6 | `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:86` | fallthrough => ALLOW (default-open for unmapped permissions) | yes |

Net effect: **deny requires an explicit rule; the default is allow** (step 6). The pack index (`permissionFeatureIndex`, :52-71) is memoized in a module-level `index` variable, built once from `CAPABILITY_PACKS` (`apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts`, 51 packs).

### 5b. Callers

| Call site | Kind |
| --- | --- |
| `apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts:72-73` | PRIMARY runtime authorization path (resolveForUser). Every JWT/session-backed API request, workspace nav and LINE AI tool flows from here. |
| `apps/api/src/modules/employee-access/application/use-cases/list-roles.use-case.ts:19,27` | read-only projection (effectivePermissionCount) |
| `apps/api/src/modules/employee-access/application/use-cases/get-access-matrix.use-case.ts:18,24` | read-only projection (access matrix grid) |
| `apps/api/src/modules/employee-access/application/use-cases/preview-role.use-case.ts:18` | loadEntitledFeatureKeys only (no filter call) |
| `apps/api/src/modules/employee-access/application/use-cases/list-capability-packs.use-case.ts:12` | loadEntitledFeatureKeys only (no filter call) |
| `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:409-412` | loadEntitledFeatureKeys only; single-key ai_line_assistant check, then delegates to permissionResolver.resolveAccess (which DOES filter) |

`prisma-permission-resolver.repository.ts:72-73` is the **only** authorization-effective call site. Everything else is a read-only projection or a single-key check. All API guards, the workspace nav, and LINE AI tools inherit from that one resolve.

### 5c. Paths that bypass the chokepoint

| Context | Evidence | Detail |
| --- | --- | --- |
| systemWorkerContext (all background workers) | `apps/api/src/modules/auth/domain/logic/system-worker-context.ts:9-27` | Builds a RequestContext with a hardcoded permission array and roles:[]; never calls loadEntitledFeatureKeys or filterPermissionsByEntitlement. Permissions are NOT entitlement-filtered. |
| worker: notification sweeps | `apps/api/src/modules/dashboard-notifications/application/use-cases/notification-sweeps.use-cases.ts:17-31` | Grants dashboard.read, dashboard.snapshot.generate, inventory.report.read, inventory.product.read regardless of dashboard_notifications / inventory / product_catalog entitlement. |
| worker: expense auto-post drain | `apps/api/src/modules/ledger/application/use-cases/expense-auto-post.use-case.ts:9-22` | Grants expense.read, journal.entry.create, journal.entry.post. Entitlement IS enforced, but by a direct Prisma company filter (:88-91), not the chokepoint. |
| worker: workflow scan | `apps/api/src/modules/workflow/application/use-cases/workflow-scan-candidates.use-case.ts:21-27` | Grants inventory.report.read with no inventory entitlement check. |
| public webhook: company LINE OA (customer channel) | `apps/api/src/modules/crm-inbox/presentation/http/crm-line-webhook.controller.ts:29-33` | @Public() route; company resolved from the channel record. No loadEntitledFeatureKeys / crm / line_oa check anywhere in the controller or ProcessInboundLineMessageUseCase. |
| public internal controllers (worker-token authed) | `apps/api/src/modules/dashboard-notifications/presentation/http/internal.controller.ts:24,61-70` (+6 more) | grep for loadEntitledFeatureKeys\|filterPermissionsByEntitlement\|featureEntitlement\|resolveAccess returns 0 hits in every one of these files. |
| public: customer LINE register + PDPA self-service | `apps/api/src/modules/crm-inbox/presentation/http/customer-line-register.controller.ts` (+1 more) | End-customer @Public() routes with 0 entitlement hits. |
| NOT a bypass: ai-gateway tool invocation | `apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.ts:250-255` | @Public() at the transport layer but re-resolves via PermissionResolverService.resolveAccess, so it DOES pass through the chokepoint. Recorded here to close the survey. |

Full evidence lists for the multi-file rows are in the JSON artifact under `bypasses[]`.

Two workers do enforce entitlement, but **outside** the chokepoint, via direct Prisma company filters:

- `apps/api/src/modules/ledger/application/use-cases/expense-auto-post.use-case.ts:85-101` — requires `double_entry_ledger` **AND** `expense_auto_post` rows both `enabled=true`, and uses the `expense_auto_post` row's `updatedAt` as the activation boundary.
- `apps/api/src/modules/ledger/application/use-cases/expense-backfill.use-case.ts:89-115` — same pair; throws `expense_auto_post_not_enabled` (400).

---

## 6. Permission-key catalog

**Canonical list: `apps/api/src/modules/auth/permission-registry.ts:12-848` (`PERMISSIONS`, 324 keys, zero duplicates).** This is *not* in `packages/contracts` — contracts declares only `export type PermissionKey = string` (`packages/contracts/src/index.ts:28`). See §10 BLOCKED B4.

Grouped by first-segment prefix (26 prefixes). "→ feature key" is the mapping from §2 `PREFIX_FEATURE_RULES` **only**; the extra columns show the other two gate sources, because most prefixes are gated by capability packs or submenu rules rather than prefix rules.

| Prefix | Count | → Feature key (rule §2) | Also gated by packs | Also gated by submenus (parent) | Effective gate breakdown |
| --- | --- | --- | --- | --- | --- |
| `access.` | 15 | — | — | `employee_access` | SUBFEATURE:15 |
| `account.` | 4 | — | — | `company_settings` | UNGATED_PACK:1, SUBFEATURE:3 |
| `accounting.` | 45 | — | `sales_documents` | — | PACK:45 |
| `admin.` | 4 | — | — | — | NONE:4 |
| `ai.` | 15 | `ai_line_assistant` (via `ai.suggestion.`)<br>`ai_line_assistant` (via `ai.draft.`) | — | — | UNGATED_PACK:1, PREFIX:11, NONE:3 |
| `attachment.` | 3 | — | — | — | UNGATED_PACK:3 |
| `audit.` | 1 | — | — | — | UNGATED_PACK:1 |
| `bank.` | 22 | — | `bank_reconciliation` | `bank_reconciliation` | SUBFEATURE:19, PACK:3 |
| `bi.` | 5 | — | — | — | NONE:5 |
| `company.` | 5 | — | — | `company_settings` | UNGATED_PACK:2, NONE:1, SUBFEATURE:2 |
| `crm.` | 47 | `line_oa` (via `crm.channel.`)<br>`ai_line_assistant` (via `crm.ai.`)<br>`crm` | `crm` | `crm` | SUBFEATURE:39, PREFIX:8 |
| `dashboard.` | 3 | `dashboard_notifications` | `dashboard_notifications` | — | PREFIX:3 |
| `document.` | 2 | — | — | — | UNGATED_PACK:2 |
| `expense.` | 20 | — | `expenses` | `expenses` | SUBFEATURE:12, PACK:8 |
| `inventory.` | 10 | `product_catalog` (via `inventory.product.`) | `inventory` | `inventory` | PREFIX:2, SUBFEATURE:4, PACK:4 |
| `journal.` | 3 | — | `double_entry_ledger` | — | PACK:3 |
| `ledger.` | 10 | — | `double_entry_ledger` | — | PACK:10 |
| `line.` | 1 | — | — | — | UNGATED_PACK:1 |
| `notification.` | 5 | `dashboard_notifications` | `dashboard_notifications` | `dashboard_notifications` | PREFIX:3, SUBFEATURE:2 |
| `outbox.` | 1 | — | — | — | UNGATED_PACK:1 |
| `procurement.` | 30 | — | `procurement` | `procurement` | SUBFEATURE:29, PACK:1 |
| `reimbursement.` | 15 | `reimbursement` | — | — | PREFIX:15 |
| `report.` | 14 | `reports` | — | — | PREFIX:14 |
| `system.` | 13 | — | — | — | NONE:13 |
| `tax.` | 19 | — | `thai_tax` | — | PACK:19 |
| `workflow.` | 12 | — | `workflow_automation` | `workflow_automation` | SUBFEATURE:11, UNGATED_PACK:1 |

Breakdown legend — which branch of `filterPermissionsByEntitlement` first decides the key: `SUBFEATURE` (:79-80 veto, may then also hit a prefix/pack rule), `PREFIX` (:81-82), `PACK` (:84-85), `UNGATED_PACK` (:83, always allow), `NONE` (:86 fallthrough, always allow).

Note `inventory.` spans three gates: `inventory.product.*` → `product_catalog` by prefix rule, `inventory.location/movement/report.*` → `inventory` by submenu + pack, `inventory.label/stock_count.*` → `inventory` by pack only.

### 6a. Full key list per prefix

**`access.`** (15) — `access.employee.read`, `access.employee.create`, `access.employee.update`, `access.employee.disable`, `access.employee.credential.issue`, `access.employee.line_link.issue`, `access.employee.line_link.revoke`, `access.role.read`, `access.role.manage`, `access.role.financial.assign`, `access.permission.read`, `access.capability_pack.read`, `access.role_template.read`, `access.role_template.manage`, `access.effective.read`

**`account.`** (4) — `account.session.read`, `account.password.change`, `account.identity.link`, `account.identity.unlink`

**`accounting.`** (45) — `accounting.counterparty.read`, `accounting.counterparty.manage`, `accounting.document.read`, `accounting.document.create`, `accounting.document.update`, `accounting.document.issue`, `accounting.document.void`, `accounting.document.export`, `accounting.quotation.read`, `accounting.quotation.create`, `accounting.quotation.update`, `accounting.quotation.submit_approval`, `accounting.quotation.approve`, `accounting.quotation.issue`, `accounting.quotation.void`, `accounting.invoice.read`, `accounting.invoice.create`, `accounting.invoice.update`, `accounting.invoice.issue`, `accounting.invoice.void`, `accounting.billing_note.read`, `accounting.billing_note.create`, `accounting.billing_note.update`, `accounting.billing_note.issue`, `accounting.billing_note.void`, `accounting.receipt.read`, `accounting.receipt.create`, `accounting.receipt.update`, `accounting.receipt.issue`, `accounting.receipt.void`, `accounting.tax_invoice.read`, `accounting.tax_invoice.issue`, `accounting.tax_invoice.void`, `accounting.credit_note.read`, `accounting.credit_note.create`, `accounting.credit_note.issue`, `accounting.credit_note.void`, `accounting.debit_note.read`, `accounting.debit_note.create`, `accounting.debit_note.issue`, `accounting.debit_note.void`, `accounting.payment.read`, `accounting.payment.create`, `accounting.payment.update`, `accounting.payment.void`

**`admin.`** (4) — `admin.user.read`, `admin.user.manage`, `admin.role.read`, `admin.role.manage`

**`ai.`** (15) — `ai.tool.invoke`, `ai.suggestion.read`, `ai.suggestion.read_own`, `ai.suggestion.request`, `ai.suggestion.generate`, `ai.suggestion.review`, `ai.suggestion.dismiss`, `ai.suggestion.admin`, `ai.draft.read`, `ai.draft.request`, `ai.draft.review`, `ai.draft.create_source_draft`, `ai.template.read`, `ai.template.manage`, `ai.tool_invocation.read`

**`attachment.`** (3) — `attachment.read`, `attachment.create`, `attachment.delete`

**`audit.`** (1) — `audit.log.read`

**`bank.`** (22) — `bank.account.read`, `bank.account.manage`, `bank.account.sensitive_read`, `bank.statement.read`, `bank.statement.import`, `bank.statement.manual_line`, `bank.statement.void`, `bank.match.read`, `bank.match.suggest`, `bank.match.confirm`, `bank.match.unmatch`, `bank.match.override`, `bank.adjustment.read`, `bank.adjustment.create`, `bank.adjustment.approve`, `bank.adjustment.void`, `bank.reconciliation.read`, `bank.reconciliation.create`, `bank.reconciliation.complete`, `bank.reconciliation.reopen`, `bank.reconciliation.export`, `bank.cash.read`

**`bi.`** (5) — `bi.view.read`, `bi.view.create`, `bi.view.update_own`, `bi.view.share`, `bi.admin`

**`company.`** (5) — `company.setup.read`, `company.setup.manage`, `company.settings.view`, `company.branch.read`, `company.branch.manage`

**`crm.`** (47) — `crm.customer.read`, `crm.customer.create`, `crm.customer.update`, `crm.customer.archive`, `crm.customer.assign`, `crm.customer.merge`, `crm.customer.export`, `crm.customer.erase`, `crm.contact.read`, `crm.contact.manage`, `crm.lead.read`, `crm.lead.create`, `crm.lead.update`, `crm.lead.assign`, `crm.lead.convert`, `crm.lead.disqualify`, `crm.opportunity.read`, `crm.opportunity.create`, `crm.opportunity.update`, `crm.opportunity.stage_move`, `crm.opportunity.close`, `crm.opportunity.reopen`, `crm.activity.read`, `crm.activity.create`, `crm.follow_up.read`, `crm.follow_up.create`, `crm.follow_up.update`, `crm.follow_up.complete`, `crm.pipeline.configure`, `crm.quotation.link`, `crm.report.read`, `crm.ai.read`, `crm.channel.read`, `crm.channel.manage`, `crm.inbox.read`, `crm.inbox.reply`, `crm.ai.assist`, `crm.inbox.note`, `crm.inbox.assign`, `crm.inbox.resolve`, `crm.template.read`, `crm.template.manage`, `crm.inbox.policy_manage`, `crm.booking.read`, `crm.booking.create`, `crm.booking.update`, `crm.booking.cancel`

**`dashboard.`** (3) — `dashboard.read`, `dashboard.configure`, `dashboard.snapshot.generate`

**`document.`** (2) — `document.sequence.read`, `document.sequence.manage`

**`expense.`** (20) — `expense.read`, `expense.evidence.read`, `expense.read_own`, `expense.create`, `expense.receipt.upload`, `expense.receipt.line_upload`, `expense.update`, `expense.review`, `expense.confirm`, `expense.reject`, `expense.void`, `expense.delete`, `expense.payment.record`, `expense.duplicate.resolve`, `expense.ocr.request`, `expense.ai.verify`, `expense.category.manage`, `expense.signature.manage`, `expense.signature.approve`, `expense.export`

**`inventory.`** (10) — `inventory.product.read`, `inventory.product.manage`, `inventory.location.read`, `inventory.location.manage`, `inventory.movement.read`, `inventory.movement.create`, `inventory.movement.adjust`, `inventory.stock_count.create`, `inventory.report.read`, `inventory.label.manage`

**`journal.`** (3) — `journal.entry.create`, `journal.entry.post`, `journal.entry.reverse`

**`ledger.`** (10) — `ledger.account.read`, `ledger.account.manage`, `ledger.journal.read`, `ledger.posting-rule.read`, `ledger.posting-rule.manage`, `ledger.report.read`, `ledger.period.read`, `ledger.period.close`, `ledger.period.unclose`, `ledger.export`

**`line.`** (1) — `line.ai.query`

**`notification.`** (5) — `notification.read`, `notification.preference.manage`, `notification.rule.manage`, `notification.delivery.read`, `notification.delivery.retry`

**`outbox.`** (1) — `outbox.event.read`

**`procurement.`** (30) — `procurement.supplier.read`, `procurement.supplier.manage`, `procurement.supplier.bank.read`, `procurement.supplier.bank.manage`, `procurement.purchase_request.read`, `procurement.purchase_request.create`, `procurement.purchase_request.approve`, `procurement.purchase_order.read`, `procurement.purchase_order.create`, `procurement.purchase_order.approve`, `procurement.purchase_order.issue`, `procurement.purchase_order.manage`, `procurement.goods_receipt.read`, `procurement.goods_receipt.create`, `procurement.goods_receipt.post`, `procurement.goods_receipt.void`, `procurement.vendor_bill.read`, `procurement.vendor_bill.create`, `procurement.vendor_bill.direct_entry`, `procurement.vendor_bill.approve`, `procurement.vendor_bill.void`, `procurement.vendor_bill.match`, `procurement.vendor_bill.match.override`, `procurement.supplier_payment.read`, `procurement.supplier_payment.create`, `procurement.supplier_payment.release`, `procurement.supplier_payment.void`, `procurement.approval_policy.read`, `procurement.approval_policy.manage`, `procurement.ap.report`

**`reimbursement.`** (15) — `reimbursement.read`, `reimbursement.read_own`, `reimbursement.create`, `reimbursement.update_own_draft`, `reimbursement.submit`, `reimbursement.cancel_own`, `reimbursement.approve`, `reimbursement.reject`, `reimbursement.finance_review`, `reimbursement.payment.record`, `reimbursement.payment.void`, `reimbursement.duplicate.resolve`, `reimbursement.policy.read`, `reimbursement.policy.manage`, `reimbursement.export`

**`report.`** (14) — `report.catalog.read`, `report.dataset.read`, `report.query.run`, `report.view.read`, `report.view.create`, `report.view.update_own`, `report.view.share`, `report.view.manage`, `report.snapshot.read`, `report.export`, `report.export.read_own`, `report.export.manage`, `report.subscription.manage`, `report.audit.read`

**`system.`** (13) — `system.company_onboarding.create`, `system.company_onboarding.read`, `system.company_onboarding.regenerate_temporary_password`, `system.line_binding.manage`, `system.partner_dashboard.read`, `system.partner_company.create`, `system.partner_company.update`, `system.partner_company.lifecycle.manage`, `system.partner_feature.manage`, `system.partner_ai_model.manage`, `system.partner_line_credential.manage`, `system.partner_member.read`, `system.partner_member.manage`

**`tax.`** (19) — `tax.profile.read`, `tax.profile.manage`, `tax.config.read`, `tax.config.manage`, `tax.period.read`, `tax.period.manage`, `tax.event.read`, `tax.event.sync`, `tax.report.read`, `tax.report.recompute`, `tax.report.export`, `tax.filing.mark_filed`, `tax.filing.mark_paid`, `tax.certificate.read`, `tax.certificate.issue`, `tax.certificate.void`, `tax.review_issue.read`, `tax.review_issue.resolve`, `tax.adjustment.create`

**`workflow.`** (12) — `workflow.template.read`, `workflow.rule.read`, `workflow.rule.manage`, `workflow.rule.enable`, `workflow.run.read`, `workflow.run.replay`, `workflow.task.read`, `workflow.task.work`, `workflow.dead_letter.read`, `workflow.dead_letter.replay`, `workflow.webhook.manage`, `workflow.audit.read`

### 6b. UNMAPPED — permissions no feature key gates

39 of 324 permissions survive `filterPermissionsByEntitlement` unconditionally regardless of entitlement state. Two distinct causes:

**B-i. `UNGATED_PACK` (13)** — member of a capability pack that carries no `featureEntitlementKey`, so `feature-gate.logic.ts:83` returns `true` before any pack-feature check. Packs involved: `pack.core.basics` (`capability-pack.registry.ts:26-34`), `pack.company.settings.view` (:51-55), `pack.company.settings.manage` (:57-61), `pack.audit.read` (:82-86) — the "no featureEntitlementKey" choice is deliberate and documented at :43-49.

| Key | Prefix |
| --- | --- |
| `account.session.read` | `account.` |
| `company.setup.read` | `company.` |
| `company.setup.manage` | `company.` |
| `audit.log.read` | `audit.` |
| `ai.tool.invoke` | `ai.` |
| `attachment.read` | `attachment.` |
| `attachment.create` | `attachment.` |
| `attachment.delete` | `attachment.` |
| `document.sequence.read` | `document.` |
| `document.sequence.manage` | `document.` |
| `outbox.event.read` | `outbox.` |
| `line.ai.query` | `line.` |
| `workflow.audit.read` | `workflow.` |

**B-ii. `NO_RULE` (26)** — matches no submenu rule, no prefix rule and no capability pack at all; falls through to `feature-gate.logic.ts:86` (`return true`). These are the true unmapped keys.

| Key | Prefix | Note |
| --- | --- | --- |
| `company.settings.view` | `company.` | hub entry permission; the two child submenus ARE gated (anomaly A3) |
| `admin.user.read` | `admin.` | legacy admin surface |
| `admin.user.manage` | `admin.` | legacy admin surface |
| `admin.role.read` | `admin.` | legacy admin surface |
| `admin.role.manage` | `admin.` | legacy admin surface |
| `system.company_onboarding.create` | `system.` | platform-operator surface (system-partner-management); arguably correct to be tenant-entitlement-free |
| `system.company_onboarding.read` | `system.` | platform-operator surface (system-partner-management); arguably correct to be tenant-entitlement-free |
| `system.company_onboarding.regenerate_temporary_password` | `system.` | platform-operator surface (system-partner-management); arguably correct to be tenant-entitlement-free |
| `system.line_binding.manage` | `system.` | platform-operator surface (system-partner-management); arguably correct to be tenant-entitlement-free |
| `system.partner_dashboard.read` | `system.` | platform-operator surface (system-partner-management); arguably correct to be tenant-entitlement-free |
| `system.partner_company.create` | `system.` | platform-operator surface (system-partner-management); arguably correct to be tenant-entitlement-free |
| `system.partner_company.update` | `system.` | platform-operator surface (system-partner-management); arguably correct to be tenant-entitlement-free |
| `system.partner_company.lifecycle.manage` | `system.` | platform-operator surface (system-partner-management); arguably correct to be tenant-entitlement-free |
| `system.partner_feature.manage` | `system.` | platform-operator surface (system-partner-management); arguably correct to be tenant-entitlement-free |
| `system.partner_ai_model.manage` | `system.` | platform-operator surface (system-partner-management); arguably correct to be tenant-entitlement-free |
| `system.partner_line_credential.manage` | `system.` | platform-operator surface (system-partner-management); arguably correct to be tenant-entitlement-free |
| `system.partner_member.read` | `system.` | platform-operator surface (system-partner-management); arguably correct to be tenant-entitlement-free |
| `system.partner_member.manage` | `system.` | platform-operator surface (system-partner-management); arguably correct to be tenant-entitlement-free |
| `ai.template.read` | `ai.` | `ai.template.*` / `ai.tool_invocation.read` match neither `ai.suggestion.` nor `ai.draft.` |
| `ai.template.manage` | `ai.` | `ai.template.*` / `ai.tool_invocation.read` match neither `ai.suggestion.` nor `ai.draft.` |
| `ai.tool_invocation.read` | `ai.` | `ai.template.*` / `ai.tool_invocation.read` match neither `ai.suggestion.` nor `ai.draft.` |
| `bi.view.read` | `bi.` | BI surface — sibling `report.*` IS gated to `reports` by rule §2 line 41 |
| `bi.view.create` | `bi.` | BI surface — sibling `report.*` IS gated to `reports` by rule §2 line 41 |
| `bi.view.update_own` | `bi.` | BI surface — sibling `report.*` IS gated to `reports` by rule §2 line 41 |
| `bi.view.share` | `bi.` | BI surface — sibling `report.*` IS gated to `reports` by rule §2 line 41 |
| `bi.admin` | `bi.` | BI surface — sibling `report.*` IS gated to `reports` by rule §2 line 41 |

**Unmapped prefixes** (prefixes containing ≥1 unmapped key): `account.`, `company.`, `admin.`, `audit.`, `ai.`, `attachment.`, `document.`, `outbox.`, `line.`, `system.`, `workflow.`, `bi.`. Of these, `admin.`, `bi.`, `system.` are **wholly** unmapped (100% of their keys ungated).

---

## 7. Partner entitlement save guard

`SetPartnerFeaturesUseCase.execute` — `apps/api/src/modules/system-partner-management/application/use-cases/set-partner-features.use-case.ts:27-121`. Ordered semantics:

| # | Evidence | Behaviour |
| --- | --- | --- |
| 1 | :28-32 | Company must exist → 404 `NotFoundException`. |
| 2 | :34-35 | `partnerMetadataLockError(company.status)` → 422 if the partner lifecycle status locks metadata. |
| 3 | :37-42 | **Validate-all-before-write**: every submitted `featureKey` must be in `APPROVED_FEATURE_ENTITLEMENT_KEYS` (all 60 parent+submenu keys) → 422 `Unknown feature keys: …`. Explicitly "no partial save". |
| 4 | :45-51 | Builds `effectiveMap` = existing DB rows overlaid with the submitted deltas — the invariant is checked against the **resulting** configuration, not the payload alone. |
| 5 | :52-56 | **Platform invariant**: `effectiveMap.get('expense_auto_post') === true && effectiveMap.get('double_entry_ledger') !== true` → 422. Note `!== true` treats absent/undefined as not-enabled, so a company relying on legacy fail-open cannot enable auto-post without an explicit ledger row. |
| 6 | :58-60 | `changedFeatures` = only rows whose effective value actually differs; `changedKeys` records `{featureKey, fromEnabled, toEnabled}` for audit. |
| 7 | :61-75 | Enabling `expense_auto_post` additionally loads `ChartReadinessService` and requires `readyForAutomaticPosting`, else 422 `coa_posting_readiness_incomplete` with `missingRoleKeys` (posting + tax roles) and the full readiness object. Runs **only** when auto-post is transitioning to enabled. |
| 8 | :79-108 | Single `$transaction`: upsert **only changed** rows (comment :77-78 — preserves each entitlement's `updatedAt` activation boundary, which the auto-post worker reads as its cutoff) + one `auditLog` row `system.partner_feature.update`, `riskLevel: HIGH`, metadata carrying `changedKeys` and the readiness snapshot. |
| 9 | :110-119 | Re-reads and returns the full saved set ordered by `featureKey`. |

Not present in this guard: no cascade when a **parent** is disabled (submenu rows keep their stored values and are neutralised only at read time by `entitlement.helper.ts:25-29`); no set-version / optimistic concurrency; no dependency check other than the single `expense_auto_post` rule.

UI pre-check mirror (both directions, toast-only): `apps/web/src/features/system-partners/PartnerDetailPage.tsx:457-483`.

---

## 8. Platform invariants and dependency constants in contracts

**There are none.** `packages/contracts/src/feature-entitlements.ts` exports exactly six symbols: `SubFeatureDefinition` (:1), `FeatureDefinition` (:9), `FEATURE_CATALOG` (:17), `DEFAULT_ON_FEATURE_KEYS` (:552), `LEGACY_FEATURE_INHERITANCE` (:554), `FEATURE_KEYS` (:560), `ALL_FEATURE_ENTITLEMENT_KEYS` (:562), `parentFeatureKey` (:567). `packages/contracts/src/menu-entitlements.ts` adds `MENU_ENTITLEMENT_BINDINGS` (:14) and `FEATURE_PACKAGE_PRESETS` (:405). None is a dependency/invariant structure.

The one real invariant, `expense_auto_post ⇒ double_entry_ledger`, is **imperative and duplicated in five places**:

| # | Site | Form |
| --- | --- | --- |
| 1 | `apps/api/src/modules/system-partner-management/application/use-cases/set-partner-features.use-case.ts:52-56` | partner save guard (422 UnprocessableEntity) |
| 2 | `apps/api/src/modules/ledger/application/use-cases/expense-auto-post.use-case.ts:88-91` | worker drain company filter (AND of both entitlement rows enabled) |
| 3 | `apps/api/src/modules/ledger/application/use-cases/expense-backfill.use-case.ts:93-97` | backfill activation guard (400 expense_auto_post_not_enabled) |
| 4 | `apps/web/src/features/system-partners/PartnerDetailPage.tsx:457-483` | UI pre-check toast (both directions) |
| 5 | `packages/contracts/src/menu-entitlements.ts:429` | FEATURE_PACKAGE_PRESETS.full excludes expense_auto_post |

Prose statement of the invariant also lives in the catalog comment at `packages/contracts/src/feature-entitlements.ts:126-129`.

---

## 9. Anomalies found during the survey

| ID | Finding | Evidence | Effect |
| --- | --- | --- | --- |
| A1 | expense_auto_post gates ZERO permission keys through the chokepoint: no capability pack carries it, no prefix rule names it, it has no submenus. | `packages/contracts/src/feature-entitlements.ts:126-135; apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts (grep featureEntitlementKey); apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:39-50` | Disabling expense_auto_post strips no permission; enforcement is 100% the direct Prisma filters in ledger use-cases. |
| A2 | workflow.audit.read is in BOTH an ungated pack (pack.audit.read) and a gated pack (pack.workflow.view, workflow_automation). | `apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts:82-86,100-104; apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:83` | The ungated branch is checked first, so workflow.audit.read is never stripped even with workflow_automation off. |
| A3 | company.settings.view has no submenu rule, no prefix rule and no pack. | `apps/api/src/modules/auth/permission-registry.ts:23; apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:86` | The ตั้งค่าบริษัท hub entry permission is default-open even if company_settings is explicitly disabled; only the two child submenus (branches, security) are gated. |
| A4 | crm.follow_up.update, crm.template.*, crm.inbox.policy_manage match the crm. prefix rule but are in NO submenu; crm.customer.merge/erase, crm.inbox.*, crm.booking.* are in submenus but no pack. | `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:47,79-82` | Mixed AND/OR coverage inside one feature; only submenu-listed crm keys get the two-level (parent AND submenu) veto. |
| A5 | Web mirrors the entitlement evaluator with DIFFERENT no-rows semantics. | `apps/api/src/modules/employee-access/application/entitlement.helper.ts:14 returns null (fail-open, everything incl. expense_auto_post) vs apps/web/src/features/system-partners/system-partners.logic.ts:63-68 (everything EXCEPT expense_auto_post)` | Two independent implementations of the same rules; divergence risk for F1/F2. |
| A6 | Onboarding seeds 18 parent rows only, never the 42 submenu rows. | `apps/api/src/modules/system-onboarding/application/use-cases/create-company-onboarding.use-case.ts:166-173` | Every new company relies on the auto-enable-with-parent rule (entitlement.helper.ts:25-29) for all submenus. |
| A7 | No permission key is listed in more than one submenu, no permission maps to more than one featureEntitlementKey via packs, and every catalog/pack permission is a registered key. | `computed over PERMISSIONS x FEATURE_CATALOG x CAPABILITY_PACKS; multiSub=[], multiFeat=[], catalogOrphans=[], packOrphans=[], duplicates=[]` | No first-wins ambiguity today; the Array.find ordering hazard is latent, not live. |

---

## 10. BLOCKED

Items F0 asks for that cannot be resolved mechanically from code at this HEAD.

### B1. sellable flag per feature key

No `sellable`, `nonSellable`, SKU or price field exists anywhere in packages/contracts or apps/api. The only mechanical signals are DEFAULT_ON_FEATURE_KEYS (packages/contracts/src/feature-entitlements.ts:552 = employee_access, company_settings) and DEFAULT_ENABLED_FEATURE_KEYS (apps/api/src/modules/system-partner-management/domain/feature-registry.ts:21-31). "Sellable" for the other 16 keys is asserted only in docs/plans/feature-entitlement-decoupling-plan.md:11, which is not code. Owner must define where sellability is represented.

### B2. declarative subfeature/platform dependency table

No dependency constant exists in packages/contracts (grepped ALL exports of feature-entitlements.ts and menu-entitlements.ts). The single real dependency (expense_auto_post => double_entry_ledger) is an inline `if` in set-partner-features.use-case.ts:52-56 and is duplicated in 4 more places. Nothing declares submenu->submenu or cross-feature dependencies.

### B3. platform invariants constant in contracts

F0 asks to "freeze the contracts-owned map for ... platform invariants". packages/contracts/src/feature-entitlements.ts exports only FEATURE_CATALOG, DEFAULT_ON_FEATURE_KEYS, LEGACY_FEATURE_INHERITANCE, FEATURE_KEYS, ALL_FEATURE_ENTITLEMENT_KEYS, parentFeatureKey. No invariant structure exists to inventory.

### B4. canonical permission catalog location

The task assumed the permission catalog lives in packages/contracts. It does NOT: packages/contracts/src/index.ts:28 declares only `export type PermissionKey = string`. The canonical 324-key list is apps/api/src/modules/auth/permission-registry.ts:12-848 (PERMISSIONS). Recorded as an inventory finding, not an unresolved blocker, but F1 must decide whether the catalog moves into contracts.

### B5. sub-feature rows are never seeded at onboarding

apps/api/src/modules/system-onboarding/application/use-cases/create-company-onboarding.use-case.ts:166-173 seeds explicit rows for APPROVED_FEATURE_KEYS (18 parents) only, not ALL_FEATURE_ENTITLEMENT_KEYS (60). Whether the resulting 42 absent submenu rows are intended to rely on the auto-enable-with-parent rule permanently is a product decision, not derivable from code.

---

## 11. Machine-readable artifact

`/private/tmp/claude-501/-Users-spare058-WatchDog-BMS/43926035-0e2c-488a-854d-1b42e51887fd/scratchpad/f0/s1-contracts.json` — same content plus the full 324-key resolution table (`permissionCatalog[].keys`), all 51 capability packs, and complete multi-file evidence lists for §5c bypasses.
