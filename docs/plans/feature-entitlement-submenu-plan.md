# Plan: Sub-Menu Feature Entitlements + Admin Screen Redesign

Status: IMPLEMENTED — Phase 1, Phase 2, and Phase 2b correction complete, 2026-07-28
Owner: Claude (harness engineer) → Codex (implementation)
Scope: `packages/contracts` + `apps/api` (registry, gate, one new permission key) + `apps/web` (system-admin UI, workspace nav, module tab gating)
Supersedes: the flat 12-key toggle list in `apps/web/src/features/system-partners/PartnerDetailPage.tsx:39-69`

## Problem

1. `Feature Entitlements` on the partner detail screen is a flat list of 12 raw `font-mono` keys. Turning `expenses` on/off is all-or-nothing — a system admin cannot say "this company gets อัปโหลดใบเสร็จ but not หมวดหมู่".
2. The screen does not resemble what the end user sees. The admin toggles `expenses`; the user sees ค่าใช้จ่าย+ใบเสร็จ with six sub-menus. Nothing on the admin screen shows that mapping.
3. `FEATURE_KEY_CATALOG` / `FEATURE_IMPACT` in `PartnerDetailPage.tsx` are hand-copied mirrors of `apps/api/.../feature-registry.ts` — the file's own comment admits it. Two sources of truth.
4. `/system/*` screens have breadcrumb links but no Back control; navigating in is easy, out is not.

## Product rules (the spec)

1. A feature entitlement has two levels: **โมดูล** (parent, e.g. `expenses`) and **เมนูย่อย** (child, e.g. `expenses.upload`). A system admin can enable/disable either.
2. **Child rows inherit by default.** A company with `expenses: true` and no child rows keeps every sub-menu — this is what every existing company looks like today, and nothing may change for them. Only an explicit `enabled = false` child row closes a sub-menu.
3. **Parent wins.** When the parent is off, every child is off regardless of its own row. No cascade write is needed: the gate ANDs child against parent.
4. **One chokepoint.** Sub-menu entitlements are enforced exactly where feature entitlements already are — `filterPermissionsByEntitlement` at permission-resolve time — so API guards, workspace nav, and LINE AI tools deny and hide together. No nav-only gating.
5. **A sub-menu is gateable unless its permission is governed by a multi-feature prefix rule, owned by another feature, or shared by two tabs in the same module.** Module entry keys are gateable when the module nav gate is the union of its own tab keys, so disabling one child cannot orphan enabled siblings.
6. Disabling is destructive to live users, so it is **confirmed**; enabling is one click. Saves stay immediate (existing `setPartnerFeatures` endpoint, existing audit row).
7. The admin screen shows the real user-facing menu tree — Thai label + route — so "what I toggle" and "what they see" are visibly the same thing.
8. Foundation areas (บัญชีผู้ใช้, แดชบอร์ด, แจ้งเตือน, พนักงาน/สิทธิ์, ตั้งค่า) stay ungated, as today.

## Architecture decisions

### A1 — Dotted child keys, no schema migration

`CompanyFeatureEntitlement` is keyed `(companyId, featureKey)` with `featureKey String`. Children are dotted keys under the parent (`expenses.upload`). The existing table, endpoint, DTO, and audit row all carry them unchanged. **No Prisma migration.**

### A2 — Inheritance is materialized in the loader

`loadEntitledFeatureKeys` (`apps/api/src/modules/employee-access/application/entitlement.helper.ts`) currently returns the set of enabled keys, or `null` for legacy companies with no rows. Extend it to, after building the enabled set, add every registry child key whose parent is enabled **and** which has no explicit `enabled: false` row.

This keeps `filterPermissionsByEntitlement(permissions, entitled)`'s signature and all five call sites unchanged, keeps the `null` fail-open convention, and makes rule 2 true by construction.

### A3 — One shared registry in contracts

New `packages/contracts/src/feature-entitlements.ts` is the single source of truth for both the API gate and the admin UI:

```ts
export type SubFeatureDefinition = {
  key: string;              // 'expenses.upload'
  labelTh: string;          // 'อัปโหลดใบเสร็จ'
  descriptionTh: string;    // one plain-Thai line
  route: string;            // '/expenses/upload' — what the user actually opens
  permissionKeys: string[]; // stripped when this sub-feature is off
};

export type FeatureDefinition = {
  key: string;              // 'expenses'
  labelTh: string;          // 'ค่าใช้จ่าย+ใบเสร็จ'
  descriptionTh: string;
  group: 'operate' | 'finance' | 'growth';   // mirrors NAV_GROUP_ORDER
  submenus: SubFeatureDefinition[];
};

export const FEATURE_CATALOG: FeatureDefinition[];
export const FEATURE_KEYS: string[];                  // parents
export const ALL_FEATURE_ENTITLEMENT_KEYS: string[];  // parents + children
export function parentFeatureKey(key: string): string;
```

`apps/api/.../feature-registry.ts` keeps `APPROVED_FEATURE_KEYS` / `DEFAULT_ENABLED_FEATURE_KEYS` but derives the accepted-key set from `ALL_FEATURE_ENTITLEMENT_KEYS`. `PartnerDetailPage.tsx` deletes its local `FEATURE_KEY_CATALOG` and `FEATURE_IMPACT` and reads the contract.

### A4 — Gate order in `feature-gate.logic.ts`

Sub-feature rules are checked **first**, then the existing `PREFIX_FEATURE_RULES`, then pack membership. A permission listed in a sub-feature's `permissionKeys` is kept only when that child key is in `entitled`. Because A2 materializes inheritance, an untouched company has every child key present and the added branch is a no-op.

### A5 — Tabs must actually gate

`procurement`, `banking`, `accounts-payable`, `workflow`, and `crm` render their tab bars unconditionally today — a user without `bank.match.read` still sees จับคู่รายการ and gets a 403 inside. `reimbursements` already does this correctly (`HUB_TAB_PERMISSIONS` + `visibleHubTabs` in `reimbursements.logic.ts:139-160`). **Reuse that exact pattern.** Gating those tabs is a prerequisite for sub-menu entitlements to have any visible effect, and is a correctness fix in its own right.

## Permission gaps (found during discovery — read before implementing)

Rule 5 fails in two places. Both are in expenses and both are cheap:

1. **หลักฐานทางบัญชี** — `GET /expenses/shared-evidence` guards on `expense.read` (`expense.controller.ts:145`), the module-wide read key also used by the list and detail. Gating the evidence sub-menu on `expense.read` would take the whole module down with it.
   **Fix:** add one permission key `expense.evidence.read` (riskLevel `LOW`), grant it in every role bundle and capability pack that holds `expense.read` today, swap the guard on `shared-evidence`, and swap `canViewSharedEvidence` in `expenses.model.ts:514` plus the nav sub-item gate. No role loses access. Requires a permission sync run against any live DB.

2. **รายการค่าใช้จ่าย** — keys off `expense.read` / `expense.read_own`, which are also the expenses module's nav gate (`web-core-workspace.constants.ts:123`). Turning the list off would orphan the module even when upload is still on.
   **Fix:** widen the module's `requiredAnyPermissions` to any expense view key (`expense.read`, `expense.read_own`, `expense.receipt.upload`, `expense.create`, `expense.category.manage`, `expense.signature.manage`, `expense.evidence.read`), and gate the `list` tab in `canAccessExpenseTab` on view instead of the unconditional `true` it returns today. All added keys are `expense.*`, so the "reimbursement must not leak the expenses menu" constraint in that file's comment still holds.

3. **ภาษี VAT / WHT / CIT** (`TaxWorkspacePage.tsx:91`) have no per-type permission keys and are **not gateable**. They stay under the `thai_tax` parent toggle. Do not invent keys for them.

## Registry content

### expenses — verified, implement exactly as written

| child key | labelTh | route | permissionKeys |
|---|---|---|---|
| `expenses.list` | รายการค่าใช้จ่าย | `/expenses` | `expense.read`, `expense.read_own` |
| `expenses.upload` | อัปโหลดใบเสร็จ | `/expenses/upload` | `expense.receipt.upload`, `expense.receipt.line_upload`, `expense.ocr.request` |
| `expenses.manual` | บันทึกด้วยมือ | `/expenses/manual` | `expense.create`, `expense.update` |
| `expenses.categories` | หมวดหมู่ | `/expenses/categories` | `expense.category.manage` |
| `expenses.evidence` | หลักฐานทางบัญชี | `/expenses/evidence` | `expense.evidence.read`, `expense.export` |
| `expenses.substitute_receipt` | ใบรับรองแทนใบเสร็จ | `/expenses/signatures` | `expense.signature.manage`, `expense.signature.approve` |

### Other modules — derive, do not guess

For each remaining feature, read the page's own tab array and map each tab to the permission key the tab's endpoints already require (check the controller's `@RequirePermissions`). Candidates confirmed to exist:

- `procurement` → ผู้จำหน่าย / ใบขอซื้อ (PR) / ใบสั่งซื้อ (PO) / ใบรับสินค้า (GR) (`ProcurementPages.tsx:253-259`) + ใบวางบิล / การชำระเงิน / AP Aging (`AccountsPayablePages.tsx:561-566`)
- `bank_reconciliation` → บัญชีธนาคาร / สถานะเงินสด / นำเข้า statement / จับคู่รายการ / กระทบยอด / รายการปรับปรุง (`BankingPages.tsx:380-388`)
- `workflow_automation` → เทมเพลต / กฎอัตโนมัติ / ประวัติการทำงาน / งานที่มอบหมาย / ข้อผิดพลาดค้าง / Webhook (`WorkflowPages.tsx:39-46`)
- `crm` → tabs in `CrmPages.tsx:34-40` + routes `/crm/customers`, `/crm/payment-proofs`, `/inbox`, `/customers`, `/bookings`
- `inventory` → routes `/inventory/{products,locations,movements,stock-count,scan,reports}`
- `dashboard_notifications` → routes `/notifications/{preferences,rules}`

Leave out only the known unsafe surfaces: Inventory Products and Scan (`inventory.product.*` spans Inventory + CRM), CRM payment proofs (`accounting.document.read` belongs to `sales_documents`), Inventory Stock Action and Stock Count (`inventory.stock_count.create` is shared), and the `thai_tax` tabs (no per-type keys). Do not add permission keys beyond the one named in §Permission gaps.

## UI design — Feature Entitlements section

Stays inline on the partner detail page (no new route). Uses the Mangmee design system already in `apps/web/app/globals.css` (`mangmee-card`, `mangmee-badge`, `mangmee-icon-frame`, tone classes), which the rest of the app uses and this screen currently does not.

```
┌─ แพ็กเกจการใช้งาน ──────────────── เปิด 7/12 โมดูล · 21/24 เมนู ─┐
│  [ ค้นหาโมดูลหรือเมนู…                                        ]  │
│                                                                  │
│  ── การเงิน ────────────────────────────────────────────────     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ ▣  ค่าใช้จ่าย+ใบเสร็จ                          [●] เปิด    │  │
│  │    บันทึกค่าใช้จ่าย ใบเสร็จ และหลักฐานทางบัญชี              │  │
│  │    expenses                                                 │  │
│  │    ▾ เมนูย่อย 5/6                                           │  │
│  │      รายการค่าใช้จ่าย      /expenses            [●]         │  │
│  │      อัปโหลดใบเสร็จ        /expenses/upload     [●]         │  │
│  │      บันทึกด้วยมือ         /expenses/manual     [●]         │  │
│  │      หมวดหมู่              /expenses/categories [○]         │  │
│  │      หลักฐานทางบัญชี       /expenses/evidence   [●]         │  │
│  │      ใบรับรองแทนใบเสร็จ    /expenses/signatures [●]         │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

Rules:

- **Grouped** by `NAV_GROUP_ORDER` (ปฏิบัติการ / การเงิน / เติบโต) so the admin reads it in the same order as the user's sidebar.
- **Thai-first.** Bold Thai name, plain-Thai description always visible (not hidden behind ⓘ — delete the ⓘ disclosure), raw key demoted to small mono text for support/debugging.
- **Search** filters on Thai label, English name, and key; matching children auto-expand their parent.
- **Counter chips** at section level (`เปิด 7/12 โมดูล`) and per feature (`เมนูย่อย 5/6`).
- **Sub-menu panel** collapsed by default, expanded by the counter chip. Each row: Thai label, route in mono, switch. Route text is what makes "สอดคล้องกับหน้าจอผู้ใช้งาน" literally true.
- **Parent off** → children dimmed, switches disabled, one line: `ปิดทั้งหมดเพราะโมดูลปิดอยู่`.
- **Confirm on disable only** (rule 6): a dialog naming what will disappear and for whom. Enabling saves straight away.
- **Optimistic switch + toast**, keeping the current immediate-save behavior and the existing `setPartnerFeatures` call.
- `fieldsLocked` (DISABLED/ARCHIVED companies) keeps every switch disabled, as today.

## UI design — Back navigation

- New shared `apps/web/src/common/components/app-shell/BackLink.tsx` — `{ href, label }`, renders a `←` + label button in the Mangmee style. One component, used by all four system screens.
- Placed top-left above the page title on `/system/partners`, `/system/partners/[companyId]`, `/system/line-settings`, `/system/company-onboardings/new`. Replaces the ad-hoc `BackToPartnersLink` in `SystemOnboardingNewPage.tsx:12-20`.
- `SystemHeader.tsx` gains section links (พาร์ทเนอร์ · เปิดบริษัทใหม่ · LINE) with an active state, so cross-section moves do not require Back at all.
- Keep the existing breadcrumb on the detail page; Back and breadcrumb answer different questions.

## Implementation phases

Two Codex handoffs so each is independently verifiable.

### Phase 1 — mechanism + expenses + UI

1. `packages/contracts/src/feature-entitlements.ts` per A3, expenses populated per §Registry content, other features present with `submenus: []`. Export from the package index. Rebuild contracts.
2. `permission-registry.ts`: add `expense.evidence.read`; add it everywhere `expense.read` appears in role bundles. `capability-pack.registry.ts`: add to `pack.expense.view` and `pack.expense.review`.
3. `expense.controller.ts:145`: guard `shared-evidence` with `expense.evidence.read`.
4. `entitlement.helper.ts`: inheritance materialization per A2.
5. `feature-gate.logic.ts`: sub-feature rule layer per A4 + spec cases (child absent = inherit; child explicitly off strips only its keys; parent off strips all; `null` still fail-open).
6. `set-partner-features.use-case.ts`: accept child keys (validate against `ALL_FEATURE_ENTITLEMENT_KEYS`), reject unknown as today. Extend its spec.
7. Web: expenses module nav gate widened + `canAccessExpenseTab.list` gated + `canViewSharedEvidence` swapped + evidence nav sub-item gate swapped.
8. Web: `FeatureEntitlementsSection` redesign per §UI design. Extract the pure parts (`buildFeatureRows`, counters, search filter) into `system-partners.logic.ts` with a `.spec.ts`.
9. Web: `BackLink` + the four screens + `SystemHeader` nav.
10. Docs: update `docs/specs/permission-matrix.md`; write `docs/agent-memory/feature-entitlement-submenu.md` per template.

### Phase 2 — remaining modules

11. Populate `submenus` for procurement / banking / AP / workflow / crm / inventory / notifications per §Registry content, deriving each from the page + controller.
12. Gate each module's tab bar with the `reimbursements.logic.ts` pattern (`<MODULE>_TAB_PERMISSIONS` + `visible<Module>Tabs`, each with a `.spec.ts`).
13. Report every tab that could not be gated and why.

### Phase 2b — correct the entry-key over-exclusion

14. Add the 20 safe tabs omitted by Phase 2: Workflow 5, CRM 6, Banking 2, Procurement/AP 4, and Inventory 3.
15. Widen Inventory, Procurement, Accounts Payable, Banking, Workflow, and CRM module gates to the union of their feature-owned tab keys. Keep `inventory.product.*` and `crm.ai.*` out of those nav unions so another feature cannot leak the module.
16. Reuse the workspace sidebar icon aliases for 12 distinct entitlement-card icons; add no SVG or dependency.

## Verification protocol (harness re-runs independently — do not trust the report)

1. `corepack pnpm --filter @watchdog-bms/contracts build`
2. API: record the baseline test count first, then full run — 0 fail. **`apps/api/package.json`'s `test` script lists spec files explicitly; new specs MUST be appended there or they silently never run.**
3. `corepack pnpm --filter @watchdog-bms/web test` → `typecheck` → `build`
4. Full-diff review against rules 1–8, especially: inheritance is materialized in the loader (not in the gate), sub-rules run before prefix rules, no Prisma migration appeared, no permission key added beyond `expense.evidence.read`.
5. Backward-compat proof: a company with `expenses: true` and zero child rows resolves to the identical permission set as before the change. This is the regression that matters most.
6. `expense.evidence.read` present in every role bundle that has `expense.read` — diff the two lists mechanically.
7. Manual walk: toggle หมวดหมู่ off for a test company, confirm the sub-menu disappears from that company's sidebar and `GET /expenses/categories`-backed calls deny; confirm other sub-menus are untouched.

## Out of scope

- Prisma schema changes; per-role sub-menu overrides (that is G15, `docs/plans/membership-menu-override-plan.md`); ภาษี VAT/WHT/CIT tab gating; new permission keys other than `expense.evidence.read`; changes to `DEFAULT_ENABLED_FEATURE_KEYS`; LIFF/LINE menu surfaces.
