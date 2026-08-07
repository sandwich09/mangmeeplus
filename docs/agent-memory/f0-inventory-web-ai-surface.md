# F0 Inventory — Web Navigation + AI Gateway Surface (lane S4)

Generated: 2026-07-31
Git HEAD: `ba91c102c49ab7964697a540a2f63d42a497aa6a` (branch `develop`, clean tree at scan start)
Lane: S4 (web navigation + AI-gateway surface inventory), phase F0 of `docs/plans/feature-entitlement-decoupling-plan.md` §3 F0
Method: mechanical Grep/Read inventory. No design, no code changes. Feature keys derived from `PREFIX_FEATURE_RULES` + `CAPABILITY_PACKS.featureEntitlementKey` + `FEATURE_CATALOG` submenu rules, in the exact precedence `filterPermissionsByEntitlement` uses (`apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:75-88`).
Machine-readable rows: `/private/tmp/claude-501/-Users-spare058-WatchDog-BMS/43926035-0e2c-488a-854d-1b42e51887fd/scratchpad/f0/s4-web-ai.json` (216 rows).

## 0. Summary counts

| Metric | Count |
|---|---|
| Total `page.tsx` routes in `apps/web/app` | 80 |
| — workspace routes (`/companies/{companyId}/…`) | 69 |
| — platform routes (`/system/…`) | 5 |
| — public / pre-company routes | 6 |
| Workspace routes with **no route-level permission gate** | **0** |
| Workspace routes with **no in-page permission read** (rely only on the client-side layout redirect) | **21** |
| Platform routes gated by **role only**, no permission and no feature | **5** |
| Public routes with gating `NONE` | **6** |
| LIFF / customer portal / public share / print surfaces | **0 (none exist)** |
| NAV_ITEM rows (modules + settings cards + hard-coded sub-items + whitelist/header) | 48 |
| — workspace modules | 28 |
| — settings cards | 8 |
| — hard-coded sidebar sub-items | 10 |
| Permitted modules suppressed by the hard-coded sidebar whitelist | 13 |
| AI tools in `LINE_TOOL_REGISTRY` | **59** |
| — router-enabled (`ROUTER_ENABLED_TOOLS`) | 54 |
| — router-disabled (`backend_tool_not_wired`, **build reason, not entitlement**) | 5 |
| **AI tools with any availability / entitlement filtering** | **0 of 59** |
| AI tools reachable by no specialist allowlist (dead even if router-enabled) | 4 |
| AI_ROUTER rows | 4 |
| AI_ORCHESTRATOR rows (6 seams + 14 gateway endpoints + 1 signal row) | 21 |
| **BLOCKED rows** | **14** |

### The five findings that matter

1. **Web has no entitlement concept at all.** `WebSession` (`apps/web/src/common/models/web-session.model.ts:2-12`) carries `roles` + `permissions` only. Every menu/route decision is `permissions.includes(...)`. Entitlement is projected into permissions server-side by `filterPermissionsByEntitlement` inside the permission resolver (`apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts:4-5`). Consequence: web cannot tell "not purchased" from "no permission" and has nowhere to render `feature_not_enabled` / purchased-but-temporarily-unavailable (plan F1).
2. **The workspace route gate is client-side.** `WorkspaceLayout.tsx:70-78` runs `canAccessWorkspacePath` in a `'use client'` component and redirects via `useEffect` + `return null`. The page's server component still executes and its RSC payload is still produced. The API is the only real boundary.
3. **The AI business route consumes no availability input.** `IntentRouterAgent.route()` (`intent-router.agent.ts:180-183`) takes only `messageText, hasAttachment, conversationContext, openClarifications`.
4. **`enabledFeatures` in `routeIntake` is a dead field.** Declared optional at `packages/contracts/src/line-ai.ts:331`, read at `intent-router.agent.ts:196` — and never populated by its only producer (`process-line-webhook.use-case.ts:460-479`). It is always `[]`, and even when set it would be advisory prompt text only (`intent-router.agent.ts:162`).
5. **Exactly one entitlement signal reaches the gateway today**: the all-or-nothing `ai_line_assistant` kill switch, enforced in `apps/api` *before* the call (`process-line-webhook.use-case.ts:407-412`, call sites `:596`, `:1200`), plus an already-filtered `permissions` array. No feature key, entitlement set or availability vector crosses the HTTP boundary.

---

## 1. Web gating layers (read this before the tables)

| Layer | File:line | What it decides | Entitlement-aware? |
|---|---|---|---|
| L0 cookie presence | `apps/web/proxy.ts:72-76` + `src/common/auth/middleware.logic.ts:6-8` | bounces cookie-less visits to `/companies/*` and `/system/*` | no |
| L1 real session | `app/(workspace)/companies/[companyId]/layout.tsx:18-27` (workspace) / `app/system/layout.tsx:17-25` (platform) | `GET /v1/auth/me`; `signed_out` → `/login`, `unavailable` → throw, `forbidden` → `CompanyAccessUnavailable`; platform additionally requires `isSystemAdmin` | indirectly (permissions arrive pre-filtered) |
| L2 route permission gate | `WorkspaceLayout.tsx:70-78` → `canAccessWorkspacePath` `web-core-workspace.logic.ts:39-83` | `exactSettingsRules` (`:46-68`) win; else longest-matching module href (`:72-82`); denial = `router.replace(dashboard)` + `return null` | indirectly |
| L3 nav visibility | `filterModulesByPermissions` `:7-20`, `buildNavItems` `:85-252`, `filterSettingsMenuItems/SidebarItems` `settings-menu.logic.ts:108-127` | which rows render | indirectly |
| L3b sidebar whitelist | `WorkspaceLayout.tsx:25-43,62-66` | **hard-coded 15-key order**, applied after permissions | no — design freeze |
| L4 in-page | per-page `permissions` prop | which cards/tabs/buttons render | indirectly |

`canAccessWorkspacePath` returns `true` when no rule and no module href matches (`:79`). Every one of the 69 workspace routes matches something, so there is no route-level hole — but the fall-through is fail-**open** and would silently ungate any future route added outside a module href.

---

## 2. WEB_PAGE — workspace routes (69)

Gate = the resolved L2 rule. `featureKey` = union of derived keys over the gate's permission keys (`parent|submenu` pairs shown where a `FEATURE_CATALOG` submenu rule applies).

| Route | Gate kind | Gate keys | featureKey | L2 evidence | In-page | Status |
|---|---|---|---|---|---|---|
| `/companies/{companyId}/accounting` | PERMISSION | accounting.document.read, accounting.invoice.read | sales_documents | module 'accounting' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:170-181 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop from server session | RESOLVED |
| `/companies/{companyId}/accounts-payable` | PERMISSION | procurement.vendor_bill.read, procurement.supplier_payment.read, procurement.ap.report | procurement\|procurement.vendor_bills, procurement\|procurement.supplier_payments, procurement\|procurement.ap_aging | module 'accounts-payable' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:202-217 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop | RESOLVED |
| `/companies/{companyId}/ai-suggestions` | PERMISSION | ai.suggestion.read, ai.suggestion.read_own | ai_line_assistant | module 'ai-suggestions' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:130-139 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | **none** | RESOLVED |
| `/companies/{companyId}/banking` | PERMISSION | bank.account.read, bank.cash.read, bank.statement.read, bank.match.read, bank.reconciliation.read, bank.adjustment.read | bank_reconciliation\|bank_reconciliation.accounts, bank_reconciliation\|bank_reconciliation.cash, bank_reconciliation\|bank_reconciliation.import, bank_reconciliation\|bank_reconciliation.matching, bank_reconciliation\|bank_reconciliation.reconciliations, bank_reconciliation\|bank_reconciliation.adjustments | module 'banking' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:228-246 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop | RESOLVED |
| `/companies/{companyId}/bookings` | PERMISSION | crm.booking.read | crm\|crm.bookings | module 'booking' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:45-54 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | session redirect + permissions prop | RESOLVED |
| `/companies/{companyId}/crm-reports` | PERMISSION | crm.report.read | crm\|crm.overview | module 'crmreport' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:55-64 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | session redirect + permissions prop | RESOLVED |
| `/companies/{companyId}/crm` | PERMISSION | crm.customer.read, crm.lead.read, crm.opportunity.read, crm.report.read, crm.follow_up.read | crm\|crm.customers, crm\|crm.leads, crm\|crm.pipeline, crm\|crm.overview, crm\|crm.followups | module 'crm' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:268-285 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop | RESOLVED |
| `/companies/{companyId}/crm/customers/{customerId}` | PERMISSION | crm.customer.read, crm.lead.read, crm.opportunity.read, crm.report.read, crm.follow_up.read | crm\|crm.customers, crm\|crm.leads, crm\|crm.pipeline, crm\|crm.overview, crm\|crm.followups | module 'crm' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:268-285 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop | RESOLVED |
| `/companies/{companyId}/crm/payment-proofs` | PERMISSION | crm.customer.read, crm.lead.read, crm.opportunity.read, crm.report.read, crm.follow_up.read | crm\|crm.customers, crm\|crm.leads, crm\|crm.pipeline, crm\|crm.overview, crm\|crm.followups | module 'crm' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:268-285 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | **none** | RESOLVED |
| `/companies/{companyId}/customers` | PERMISSION | crm.customer.read | crm\|crm.customers | module 'customers' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:35-44 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | session redirect + permissions prop | RESOLVED |
| `/companies/{companyId}/dashboard` | PERMISSION | dashboard.read | dashboard_notifications | module 'dashboard' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:4-14 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop | RESOLVED |
| `/companies/{companyId}/expenses` | PERMISSION | expense.read, expense.read_own, expense.receipt.upload, expense.create, expense.category.manage, expense.signature.manage, expense.evidence.read | expenses\|expenses.list, expenses\|expenses.upload, expenses\|expenses.manual, expenses\|expenses.categories, expenses\|expenses.substitute_receipt, expenses\|expenses.evidence | module 'expenses' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:140-159 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop | RESOLVED |
| `/companies/{companyId}/expenses/{expenseId}` | PERMISSION | expense.read, expense.read_own, expense.receipt.upload, expense.create, expense.category.manage, expense.signature.manage, expense.evidence.read | expenses\|expenses.list, expenses\|expenses.upload, expenses\|expenses.manual, expenses\|expenses.categories, expenses\|expenses.substitute_receipt, expenses\|expenses.evidence | module 'expenses' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:140-159 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | redirect into /expenses?expenseId= | RESOLVED |
| `/companies/{companyId}/expenses/categories` | PERMISSION | expense.read, expense.read_own, expense.receipt.upload, expense.create, expense.category.manage, expense.signature.manage, expense.evidence.read | expenses\|expenses.list, expenses\|expenses.upload, expenses\|expenses.manual, expenses\|expenses.categories, expenses\|expenses.substitute_receipt, expenses\|expenses.evidence | module 'expenses' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:140-159 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop, tab=categories | RESOLVED |
| `/companies/{companyId}/expenses/evidence` | PERMISSION | expense.read, expense.read_own, expense.receipt.upload, expense.create, expense.category.manage, expense.signature.manage, expense.evidence.read | expenses\|expenses.list, expenses\|expenses.upload, expenses\|expenses.manual, expenses\|expenses.categories, expenses\|expenses.substitute_receipt, expenses\|expenses.evidence | module 'expenses' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:140-159 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop, tab=evidence | RESOLVED |
| `/companies/{companyId}/expenses/manual` | PERMISSION | expense.read, expense.read_own, expense.receipt.upload, expense.create, expense.category.manage, expense.signature.manage, expense.evidence.read | expenses\|expenses.list, expenses\|expenses.upload, expenses\|expenses.manual, expenses\|expenses.categories, expenses\|expenses.substitute_receipt, expenses\|expenses.evidence | module 'expenses' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:140-159 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop, tab=manual | RESOLVED |
| `/companies/{companyId}/expenses/signatures` | PERMISSION | expense.read, expense.read_own, expense.receipt.upload, expense.create, expense.category.manage, expense.signature.manage, expense.evidence.read | expenses\|expenses.list, expenses\|expenses.upload, expenses\|expenses.manual, expenses\|expenses.categories, expenses\|expenses.substitute_receipt, expenses\|expenses.evidence | module 'expenses' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:140-159 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop, tab=signatures | RESOLVED |
| `/companies/{companyId}/expenses/upload` | PERMISSION | expense.read, expense.read_own, expense.receipt.upload, expense.create, expense.category.manage, expense.signature.manage, expense.evidence.read | expenses\|expenses.list, expenses\|expenses.upload, expenses\|expenses.manual, expenses\|expenses.categories, expenses\|expenses.substitute_receipt, expenses\|expenses.evidence | module 'expenses' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:140-159 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop, tab=upload | RESOLVED |
| `/companies/{companyId}/inbox` | PERMISSION | crm.inbox.read | crm\|crm.inbox | module 'inbox' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:15-24 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | session redirect + permissions prop | RESOLVED |
| `/companies/{companyId}/inventory` | PERMISSION | inventory.location.read, inventory.movement.read, inventory.movement.create, inventory.stock_count.create, inventory.movement.adjust, inventory.report.read | inventory\|inventory.locations, inventory\|inventory.movements, inventory, inventory\|inventory.stock_report | module 'inventory' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:76-94 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | visibleInventoryTabs(permissions) + ForbiddenState :28-29 | RESOLVED |
| `/companies/{companyId}/inventory/locations` | PERMISSION | inventory.location.read, inventory.movement.read, inventory.movement.create, inventory.stock_count.create, inventory.movement.adjust, inventory.report.read | inventory\|inventory.locations, inventory\|inventory.movements, inventory, inventory\|inventory.stock_report | module 'inventory' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:76-94 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | **none** | RESOLVED |
| `/companies/{companyId}/inventory/movements` | PERMISSION | inventory.location.read, inventory.movement.read, inventory.movement.create, inventory.stock_count.create, inventory.movement.adjust, inventory.report.read | inventory\|inventory.locations, inventory\|inventory.movements, inventory, inventory\|inventory.stock_report | module 'inventory' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:76-94 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | **none** | RESOLVED |
| `/companies/{companyId}/inventory/movements/new` | PERMISSION | inventory.location.read, inventory.movement.read, inventory.movement.create, inventory.stock_count.create, inventory.movement.adjust, inventory.report.read | inventory\|inventory.locations, inventory\|inventory.movements, inventory, inventory\|inventory.stock_report | module 'inventory' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:76-94 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | **none** | RESOLVED |
| `/companies/{companyId}/inventory/products` | PERMISSION | inventory.location.read, inventory.movement.read, inventory.movement.create, inventory.stock_count.create, inventory.movement.adjust, inventory.report.read | inventory\|inventory.locations, inventory\|inventory.movements, inventory, inventory\|inventory.stock_report | module 'inventory' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:76-94 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | **none** | RESOLVED |
| `/companies/{companyId}/inventory/products/new` | PERMISSION | inventory.location.read, inventory.movement.read, inventory.movement.create, inventory.stock_count.create, inventory.movement.adjust, inventory.report.read | inventory\|inventory.locations, inventory\|inventory.movements, inventory, inventory\|inventory.stock_report | module 'inventory' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:76-94 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | **none** | RESOLVED |
| `/companies/{companyId}/inventory/products/{productId}` | PERMISSION | inventory.location.read, inventory.movement.read, inventory.movement.create, inventory.stock_count.create, inventory.movement.adjust, inventory.report.read | inventory\|inventory.locations, inventory\|inventory.movements, inventory, inventory\|inventory.stock_report | module 'inventory' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:76-94 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | **none** | RESOLVED |
| `/companies/{companyId}/inventory/reports/stock` | PERMISSION | inventory.location.read, inventory.movement.read, inventory.movement.create, inventory.stock_count.create, inventory.movement.adjust, inventory.report.read | inventory\|inventory.locations, inventory\|inventory.movements, inventory, inventory\|inventory.stock_report | module 'inventory' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:76-94 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | **none** | RESOLVED |
| `/companies/{companyId}/inventory/scan` | PERMISSION | inventory.location.read, inventory.movement.read, inventory.movement.create, inventory.stock_count.create, inventory.movement.adjust, inventory.report.read | inventory\|inventory.locations, inventory\|inventory.movements, inventory, inventory\|inventory.stock_report | module 'inventory' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:76-94 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | **none** | RESOLVED |
| `/companies/{companyId}/inventory/stock-count` | PERMISSION | inventory.location.read, inventory.movement.read, inventory.movement.create, inventory.stock_count.create, inventory.movement.adjust, inventory.report.read | inventory\|inventory.locations, inventory\|inventory.movements, inventory, inventory\|inventory.stock_report | module 'inventory' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:76-94 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | **none** | RESOLVED |
| `/companies/{companyId}/journal` | PERMISSION | ledger.journal.read | double_entry_ledger | module 'journal' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:160-169 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | **none** | RESOLVED |
| `/companies/{companyId}/notifications` | PERMISSION | notification.read | dashboard_notifications | module 'notifications' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:343-354 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop | RESOLVED |
| `/companies/{companyId}/notifications/preferences` | PERMISSION | notification.read | dashboard_notifications | module 'notifications' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:343-354 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | redirect to /settings/notifications | RESOLVED |
| `/companies/{companyId}/notifications/rules` | PERMISSION | notification.read | dashboard_notifications | module 'notifications' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:343-354 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop | RESOLVED |
| `/companies/{companyId}/period-closing` | PERMISSION | ledger.period.read | double_entry_ledger | module 'closing' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:258-267 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | **none** | RESOLVED |
| `/companies/{companyId}/procurement` | PERMISSION | procurement.supplier.read, procurement.purchase_request.read, procurement.purchase_order.read, procurement.goods_receipt.read | procurement\|procurement.suppliers, procurement\|procurement.purchase_requests, procurement\|procurement.purchase_orders, procurement\|procurement.goods_receipts | module 'procurement' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:95-111 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop | RESOLVED |
| `/companies/{companyId}/reimbursements` | PERMISSION | reimbursement.read, reimbursement.read_own, reimbursement.approve, reimbursement.finance_review | reimbursement | module 'reimbursements' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:218-227 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions + roles props | RESOLVED |
| `/companies/{companyId}/reports` | PERMISSION | report.catalog.read | reports | module 'reports' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:247-257 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | **none** | RESOLVED |
| `/companies/{companyId}/sales` | PERMISSION | accounting.quotation.read, accounting.invoice.read | sales_documents | module 'sales' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:25-34 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | **none** | RESOLVED |
| `/companies/{companyId}/sales-documents` | PERMISSION | accounting.document.read | sales_documents | module 'salesdoc' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:182-191 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop (renders AccountingHubPage) | RESOLVED |
| `/companies/{companyId}/settings` | PERMISSION | company.settings.view, company.setup.manage, ledger.account.read, ledger.account.manage, tax.profile.read, tax.profile.manage, tax.config.read, tax.config.manage, ledger.posting-rule.read, ledger.posting-rule.manage | UNMAPPED, UNGATED, double_entry_ledger, thai_tax | module 'settings' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:296-322 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | filterSettingsMenuItems(permissions) | BLOCKED |
| `/companies/{companyId}/settings/access-overview` | PERMISSION | access.effective.read | employee_access\|employee_access.overview\|UNGATED | canAccessWorkspacePath exactSettingsRules apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:47 | viewerPermissions prop | RESOLVED |
| `/companies/{companyId}/settings/accounting-tax-setup` | PERMISSION | company.settings.view, company.setup.manage, ledger.account.read, ledger.account.manage, tax.profile.read, tax.profile.manage, tax.config.read, tax.config.manage | UNMAPPED, UNGATED, double_entry_ledger, thai_tax | canAccessWorkspacePath exactSettingsRules apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:57-64 | permissions via AccountingTaxSetupRoute | BLOCKED |
| `/companies/{companyId}/settings/accounting-tax-setup/chart` | PERMISSION | company.settings.view, company.setup.manage, ledger.account.read, ledger.account.manage, tax.profile.read, tax.profile.manage, tax.config.read, tax.config.manage | UNMAPPED, UNGATED, double_entry_ledger, thai_tax | canAccessWorkspacePath exactSettingsRules apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:57-64 | permissions via AccountingTaxSetupRoute | BLOCKED |
| `/companies/{companyId}/settings/accounting-tax-setup/chart/review` | PERMISSION | company.settings.view, company.setup.manage, ledger.account.read, ledger.account.manage, tax.profile.read, tax.profile.manage, tax.config.read, tax.config.manage | UNMAPPED, UNGATED, double_entry_ledger, thai_tax | canAccessWorkspacePath exactSettingsRules apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:57-64 | permissions via AccountingTaxSetupRoute | BLOCKED |
| `/companies/{companyId}/settings/accounting-tax-setup/mappings` | PERMISSION | company.settings.view, company.setup.manage, ledger.account.read, ledger.account.manage, tax.profile.read, tax.profile.manage, tax.config.read, tax.config.manage | UNMAPPED, UNGATED, double_entry_ledger, thai_tax | canAccessWorkspacePath exactSettingsRules apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:57-64 | permissions via AccountingTaxSetupRoute | BLOCKED |
| `/companies/{companyId}/settings/accounting-tax-setup/prerequisites` | PERMISSION | company.settings.view, company.setup.manage, ledger.account.read, ledger.account.manage, tax.profile.read, tax.profile.manage, tax.config.read, tax.config.manage | UNMAPPED, UNGATED, double_entry_ledger, thai_tax | canAccessWorkspacePath exactSettingsRules apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:57-64 | permissions via AccountingTaxSetupRoute | BLOCKED |
| `/companies/{companyId}/settings/accounting-tax-setup/profile` | PERMISSION | company.settings.view, company.setup.manage, ledger.account.read, ledger.account.manage, tax.profile.read, tax.profile.manage, tax.config.read, tax.config.manage | UNMAPPED, UNGATED, double_entry_ledger, thai_tax | canAccessWorkspacePath exactSettingsRules apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:57-64 | permissions via AccountingTaxSetupRoute | BLOCKED |
| `/companies/{companyId}/settings/accounting-tax-setup/review` | PERMISSION | company.settings.view, company.setup.manage, ledger.account.read, ledger.account.manage, tax.profile.read, tax.profile.manage, tax.config.read, tax.config.manage | UNMAPPED, UNGATED, double_entry_ledger, thai_tax | canAccessWorkspacePath exactSettingsRules apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:57-64 | permissions via AccountingTaxSetupRoute | BLOCKED |
| `/companies/{companyId}/settings/branches` | PERMISSION | company.branch.read, company.branch.manage | company_settings\|company_settings.branches\|UNGATED | canAccessWorkspacePath exactSettingsRules apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:55 | **none** | RESOLVED |
| `/companies/{companyId}/settings/chart-of-accounts` | PERMISSION | ledger.account.read, ledger.account.manage | double_entry_ledger | canAccessWorkspacePath exactSettingsRules apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:65 | permissions prop | RESOLVED |
| `/companies/{companyId}/settings/crm-catalog` | PERMISSION | inventory.product.read | product_catalog | module 'crmsettings' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:65-74 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | session redirect + canManage=inventory | RESOLVED |
| `/companies/{companyId}/settings/crm-catalog/new` | PERMISSION | inventory.product.read | product_catalog | module 'crmsettings' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:65-74 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | hard redirect unless inventory | RESOLVED |
| `/companies/{companyId}/settings/crm-catalog/{productId}` | PERMISSION | inventory.product.read | product_catalog | module 'crmsettings' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:65-74 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | session redirect + canManage | RESOLVED |
| `/companies/{companyId}/settings/discount-policy` | PERMISSION | company.setup.read | UNGATED | module 'discount' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:333-342 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | **none** | RESOLVED |
| `/companies/{companyId}/settings/employees` | PERMISSION | access.employee.read | employee_access\|employee_access.employees\|UNGATED | canAccessWorkspacePath exactSettingsRules apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:50 | viewerPermissions prop | RESOLVED |
| `/companies/{companyId}/settings/line-oa` | PERMISSION | crm.channel.read | line_oa | module 'lineoa' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:355-364 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | **none** | RESOLVED |
| `/companies/{companyId}/settings/notification-rules` | PERMISSION | company.settings.view, company.setup.manage, ledger.account.read, ledger.account.manage, tax.profile.read, tax.profile.manage, tax.config.read, tax.config.manage, ledger.posting-rule.read, ledger.posting-rule.manage | UNMAPPED, UNGATED, double_entry_ledger, thai_tax | module 'settings' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:296-322 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop | BLOCKED |
| `/companies/{companyId}/settings/notifications` | PERMISSION | company.settings.view, company.setup.manage, ledger.account.read, ledger.account.manage, tax.profile.read, tax.profile.manage, tax.config.read, tax.config.manage, ledger.posting-rule.read, ledger.posting-rule.manage | UNMAPPED, UNGATED, double_entry_ledger, thai_tax | module 'settings' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:296-322 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop | BLOCKED |
| `/companies/{companyId}/settings/permissions` | PERMISSION | access.role.read | employee_access\|employee_access.roles\|UNGATED | canAccessWorkspacePath exactSettingsRules apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:48 | viewerPermissions prop | RESOLVED |
| `/companies/{companyId}/settings/po-approval` | PERMISSION | procurement.purchase_order.read | procurement\|procurement.purchase_orders | module 'poapproval' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:323-332 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | **none** | RESOLVED |
| `/companies/{companyId}/settings/roles` | PERMISSION | access.role.read | employee_access\|employee_access.roles\|UNGATED | canAccessWorkspacePath exactSettingsRules apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:49 | redirect to /settings/permissions | RESOLVED |
| `/companies/{companyId}/settings/security` | PERMISSION | account.password.change, account.identity.link, account.identity.unlink | company_settings\|company_settings.security\|UNGATED | canAccessWorkspacePath exactSettingsRules apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:51-54 | **none** | RESOLVED |
| `/companies/{companyId}/settings/substitute-receipt` | PERMISSION | company.setup.manage | UNGATED | canAccessWorkspacePath exactSettingsRules apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:56 | **none** | RESOLVED |
| `/companies/{companyId}/settings/tax-accounts` | PERMISSION | tax.config.read, tax.config.manage, ledger.posting-rule.read, ledger.posting-rule.manage | thai_tax, double_entry_ledger | canAccessWorkspacePath exactSettingsRules apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:67 | permissions prop | RESOLVED |
| `/companies/{companyId}/settings/tax-codes` | PERMISSION | tax.profile.read, tax.profile.manage, tax.config.read, tax.config.manage | thai_tax | canAccessWorkspacePath exactSettingsRules apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:66 | permissions prop | RESOLVED |
| `/companies/{companyId}/tax` | PERMISSION | tax.profile.read, tax.config.read, tax.period.read, tax.event.read, tax.report.read | thai_tax | module 'tax' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:192-201 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop | RESOLVED |
| `/companies/{companyId}/tax/evidence` | PERMISSION | tax.profile.read, tax.config.read, tax.period.read, tax.event.read, tax.report.read | thai_tax | module 'tax' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:192-201 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop | RESOLVED |
| `/companies/{companyId}/tax/reconciliation` | PERMISSION | tax.profile.read, tax.config.read, tax.period.read, tax.event.read, tax.report.read | thai_tax | module 'tax' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:192-201 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop | RESOLVED |
| `/companies/{companyId}/workflow` | PERMISSION | workflow.template.read, workflow.rule.read, workflow.task.read, workflow.run.read, workflow.dead_letter.read, workflow.webhook.manage | workflow_automation\|workflow_automation.templates, workflow_automation\|workflow_automation.rules, workflow_automation\|workflow_automation.tasks, workflow_automation\|workflow_automation.runs, workflow_automation\|workflow_automation.dead_letters, workflow_automation\|workflow_automation.webhooks | module 'workflow' apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:112-129 via apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:72-82 | permissions prop | RESOLVED |

### 2a. Workspace routes with NO in-page permission read (21) — flagged

These render entirely behind the client-side L2 redirect. Their data safety depends on the API alone.

- `/companies/{companyId}/ai-suggestions` — apps/web/app/(workspace)/companies/[companyId]/ai-suggestions/page.tsx:1-10
- `/companies/{companyId}/crm/payment-proofs` — apps/web/app/(workspace)/companies/[companyId]/crm/payment-proofs/page.tsx:1-10
- `/companies/{companyId}/inventory/locations` — apps/web/app/(workspace)/companies/[companyId]/inventory/locations/page.tsx:1-10
- `/companies/{companyId}/inventory/movements` — apps/web/app/(workspace)/companies/[companyId]/inventory/movements/page.tsx:1-10
- `/companies/{companyId}/inventory/movements/new` — apps/web/app/(workspace)/companies/[companyId]/inventory/movements/new/page.tsx:1-10
- `/companies/{companyId}/inventory/products` — apps/web/app/(workspace)/companies/[companyId]/inventory/products/page.tsx:1-13
- `/companies/{companyId}/inventory/products/new` — apps/web/app/(workspace)/companies/[companyId]/inventory/products/new/page.tsx:1-10
- `/companies/{companyId}/inventory/products/{productId}` — apps/web/app/(workspace)/companies/[companyId]/inventory/products/[productId]/page.tsx:1-10
- `/companies/{companyId}/inventory/reports/stock` — apps/web/app/(workspace)/companies/[companyId]/inventory/reports/stock/page.tsx:1-10
- `/companies/{companyId}/inventory/scan` — apps/web/app/(workspace)/companies/[companyId]/inventory/scan/page.tsx:1-10
- `/companies/{companyId}/inventory/stock-count` — apps/web/app/(workspace)/companies/[companyId]/inventory/stock-count/page.tsx:1-10
- `/companies/{companyId}/journal` — apps/web/app/(workspace)/companies/[companyId]/journal/page.tsx:1-6
- `/companies/{companyId}/period-closing` — apps/web/app/(workspace)/companies/[companyId]/period-closing/page.tsx:1-6
- `/companies/{companyId}/reports` — apps/web/app/(workspace)/companies/[companyId]/reports/page.tsx:1-10
- `/companies/{companyId}/sales` — apps/web/app/(workspace)/companies/[companyId]/sales/page.tsx:1-6
- `/companies/{companyId}/settings/branches` — apps/web/app/(workspace)/companies/[companyId]/settings/branches/page.tsx:1-10
- `/companies/{companyId}/settings/discount-policy` — apps/web/app/(workspace)/companies/[companyId]/settings/discount-policy/page.tsx:1-6
- `/companies/{companyId}/settings/line-oa` — apps/web/app/(workspace)/companies/[companyId]/settings/line-oa/page.tsx:1-10
- `/companies/{companyId}/settings/po-approval` — apps/web/app/(workspace)/companies/[companyId]/settings/po-approval/page.tsx:1-6
- `/companies/{companyId}/settings/security` — apps/web/app/(workspace)/companies/[companyId]/settings/security/page.tsx:1-10
- `/companies/{companyId}/settings/substitute-receipt` — apps/web/app/(workspace)/companies/[companyId]/settings/substitute-receipt/page.tsx:1-10

---

## 3. WEB_PAGE — platform routes (5) — role-gated only

| Route | Gate | featureKey | Evidence | Notes |
|---|---|---|---|---|
| `/system/partners` | role:SYSTEM_ADMIN | N/A (platform control plane, not a company feature) | apps/web/app/system/partners/page.tsx:1-5 | ROLE gate only — no permission key, no feature entitlement. These are the partner-entitlement control-plane pages themselves (PartnerDetailPage writes entitlements). No page-level permission read. |
| `/system/partners/{companyId}` | role:SYSTEM_ADMIN | N/A (platform control plane, not a company feature) | apps/web/app/system/partners/[companyId]/page.tsx:3-10 | ROLE gate only — no permission key, no feature entitlement. These are the partner-entitlement control-plane pages themselves (PartnerDetailPage writes entitlements). No page-level permission read. |
| `/system/line-settings` | role:SYSTEM_ADMIN | N/A (platform control plane, not a company feature) | apps/web/app/system/line-settings/page.tsx:1-5 | ROLE gate only — no permission key, no feature entitlement. These are the partner-entitlement control-plane pages themselves (PartnerDetailPage writes entitlements). No page-level permission read. |
| `/system/ai-budget` | role:SYSTEM_ADMIN | N/A (platform control plane, not a company feature) | apps/web/app/system/ai-budget/page.tsx:1-5 | ROLE gate only — no permission key, no feature entitlement. These are the partner-entitlement control-plane pages themselves (PartnerDetailPage writes entitlements). No page-level permission read. |
| `/system/company-onboardings/new` | role:SYSTEM_ADMIN | N/A (platform control plane, not a company feature) | apps/web/app/system/company-onboardings/new/page.tsx:1-5 | ROLE gate only — no permission key, no feature entitlement. These are the partner-entitlement control-plane pages themselves (PartnerDetailPage writes entitlements). No page-level permission read. |

Gate is `isSystemAdmin(session)` at `app/system/layout.tsx:23-25` (`SYSTEM_ADMIN_ROLE = 'SYSTEM_ADMIN'`, `src/common/auth/session-gate.logic.ts:7,24-26`). No permission key, no feature key, no per-page check. These pages *are* the entitlement control plane.

---

## 4. PORTAL / public surfaces (7)

| Surface | Gate | Evidence | Notes |
|---|---|---|---|
| `/` | NONE | apps/web/app/page.tsx:4 | Static redirect to /login. |
| `/login` | NONE | apps/web/app/login/page.tsx:19-24 | Public. Server-validates session and redirects an authenticated visitor (resolveLoginLanding). |
| `/forgot-password` | NONE | apps/web/app/forgot-password/page.tsx:1-5 | Public, unauthenticated password-reset entry. |
| `/verify-email` | NONE | apps/web/app/verify-email/page.tsx:1-6 | Public, token-based email verification. |
| `/privacy` | NONE | apps/web/app/privacy/page.tsx:3-10 | Deliberately public+static PDPA notice; linked from LINE OA first-contact message. |
| `/change-password` | SESSION | apps/web/app/change-password/page.tsx:15-17 | Session-gated only (mustChangePassword === false check); no permission or feature key. |
| `LINE LIFF / customer portal / public share / print pages` | NONE | apps/web/app (80 page.tsx files, none under a LIFF/portal/share/print segment) | NO LIFF page, customer portal, public share-token page or print/PDF page exists in apps/web today. The only customer-facing surface is the LINE OA webhook (apps/api). "portal" hits in apps/web are React createPortal popovers only. |

---

## 5. NAV_ITEM — module registry (28)

Source: `apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts`. Visibility = ANY of `requiredAnyPermissions` (`filterModulesByPermissions`, `web-core-workspace.logic.ts:7-20`, called at `WorkspaceLayout.tsx:51-54`).

| Module | Href | requiredAnyPermissions | featureKey | constants.ts | In sidebar whitelist? |
|---|---|---|---|---|---|
| `dashboard` | `/dashboard` | dashboard.read | dashboard_notifications | 4-14 | yes |
| `inbox` | `/inbox` | crm.inbox.read | crm\|crm.inbox | 15-24 | yes |
| `sales` | `/sales` | accounting.quotation.read, accounting.invoice.read | sales_documents | 25-34 | **no** |
| `customers` | `/customers` | crm.customer.read | crm\|crm.customers | 35-44 | yes |
| `booking` | `/bookings` | crm.booking.read | crm\|crm.bookings | 45-54 | yes |
| `crmreport` | `/crm-reports` | crm.report.read | crm\|crm.overview | 55-64 | yes |
| `crmsettings` | `/settings/crm-catalog` | inventory.product.read | product_catalog | 65-74 | yes |
| `inventory` | `/inventory` | inventory.location.read, inventory.movement.read, inventory.movement.create, inventory.stock_count.create, inventory.movement.adjust, inventory.report.read | inventory\|inventory.locations, inventory\|inventory.movements, inventory, inventory\|inventory.stock_report | 76-94 | **no** |
| `procurement` | `/procurement` | procurement.supplier.read, procurement.purchase_request.read, procurement.purchase_order.read, procurement.goods_receipt.read | procurement\|procurement.suppliers, procurement\|procurement.purchase_requests, procurement\|procurement.purchase_orders, procurement\|procurement.goods_receipts | 95-111 | **no** |
| `workflow` | `/workflow` | workflow.template.read, workflow.rule.read, workflow.task.read, workflow.run.read, workflow.dead_letter.read, workflow.webhook.manage | workflow_automation\|workflow_automation.templates, workflow_automation\|workflow_automation.rules, workflow_automation\|workflow_automation.tasks, workflow_automation\|workflow_automation.runs, workflow_automation\|workflow_automation.dead_letters, workflow_automation\|workflow_automation.webhooks | 112-129 | **no** |
| `ai-suggestions` | `/ai-suggestions` | ai.suggestion.read, ai.suggestion.read_own | ai_line_assistant | 130-139 | **no** |
| `expenses` | `/expenses` | expense.read, expense.read_own, expense.receipt.upload, expense.create, expense.category.manage, expense.signature.manage, expense.evidence.read | expenses\|expenses.list, expenses\|expenses.upload, expenses\|expenses.manual, expenses\|expenses.categories, expenses\|expenses.substitute_receipt, expenses\|expenses.evidence | 140-159 | yes |
| `journal` | `/journal` | ledger.journal.read | double_entry_ledger | 160-169 | yes |
| `accounting` | `/accounting` | accounting.document.read, accounting.invoice.read | sales_documents | 170-181 | **no** |
| `salesdoc` | `/sales-documents` | accounting.document.read | sales_documents | 182-191 | yes |
| `tax` | `/tax` | tax.profile.read, tax.config.read, tax.period.read, tax.event.read, tax.report.read | thai_tax | 192-201 | yes |
| `accounts-payable` | `/accounts-payable` | procurement.vendor_bill.read, procurement.supplier_payment.read, procurement.ap.report | procurement\|procurement.vendor_bills, procurement\|procurement.supplier_payments, procurement\|procurement.ap_aging | 202-217 | **no** |
| `reimbursements` | `/reimbursements` | reimbursement.read, reimbursement.read_own, reimbursement.approve, reimbursement.finance_review | reimbursement | 218-227 | yes |
| `banking` | `/banking` | bank.account.read, bank.cash.read, bank.statement.read, bank.match.read, bank.reconciliation.read, bank.adjustment.read | bank_reconciliation\|bank_reconciliation.accounts, bank_reconciliation\|bank_reconciliation.cash, bank_reconciliation\|bank_reconciliation.import, bank_reconciliation\|bank_reconciliation.matching, bank_reconciliation\|bank_reconciliation.reconciliations, bank_reconciliation\|bank_reconciliation.adjustments | 228-246 | **no** |
| `reports` | `/reports` | report.catalog.read | reports | 247-257 | yes |
| `closing` | `/period-closing` | ledger.period.read | double_entry_ledger | 258-267 | yes |
| `crm` | `/crm` | crm.customer.read, crm.lead.read, crm.opportunity.read, crm.report.read, crm.follow_up.read | crm\|crm.customers, crm\|crm.leads, crm\|crm.pipeline, crm\|crm.overview, crm\|crm.followups | 268-285 | **no** |
| `roles` | `/settings/permissions` | access.role.read, access.employee.read, access.effective.read | employee_access\|employee_access.roles\|UNGATED, employee_access\|employee_access.employees\|UNGATED, employee_access\|employee_access.overview\|UNGATED | 286-295 | yes |
| `settings` | `/settings` | company.settings.view, company.setup.manage, ledger.account.read, ledger.account.manage, tax.profile.read, tax.profile.manage, tax.config.read, tax.config.manage, ledger.posting-rule.read, ledger.posting-rule.manage | UNMAPPED, UNGATED, double_entry_ledger, thai_tax | 296-322 | yes |
| `poapproval` | `/settings/po-approval` | procurement.purchase_order.read | procurement\|procurement.purchase_orders | 323-332 | **no** |
| `discount` | `/settings/discount-policy` | company.setup.read | UNGATED | 333-342 | **no** |
| `notifications` | `/notifications` | notification.read | dashboard_notifications | 343-354 | **no** |
| `lineoa` | `/settings/line-oa` | crm.channel.read | line_oa | 355-364 | **no** |

**Sidebar whitelist (`DESIGN_HANDOFF_NAV_ORDER`, `WorkspaceLayout.tsx:25-43,62-66`)** admits only: dashboard, inbox, customers, booking, salesdoc, crmreport, crmsettings, expenses, reimbursements, journal, tax, reports, closing, roles, settings. The other 13 modules never render as sidebar rows even when permitted; their routes stay reachable by URL. `notifications` is additionally suppressed by `settingsChildKeys` (`web-core-workspace.logic.ts:95,98`) because the notification centre is reached from the header bell.

## 5a. NAV_ITEM — settings cards (8)

Source: `apps/web/src/features/web-core-workspace/settings-menu.logic.ts`. Hub rendering uses `filterSettingsMenuItems` (`:108-113`); the sidebar submenu uses `filterSettingsSidebarItems` (`:124-127`) which additionally intersects the fixed `SETTINGS_SIDEBAR_KEYS` list (`:115-122`).

| Card | Href | requiredAnyPermissions | featureKey | Evidence | Sidebar? |
|---|---|---|---|---|---|
| `line-oa` | `/settings/line-oa` | crm.channel.read | line_oa | apps/web/src/features/web-core-workspace/settings-menu.logic.ts:17-25 | hub only |
| `crm-catalog` | `/settings/crm-catalog` | inventory.product.read | product_catalog | apps/web/src/features/web-core-workspace/settings-menu.logic.ts:26-34 | hub only |
| `security` | `/settings/security` | account.password.change, account.identity.link, account.identity.unlink | company_settings\|company_settings.security\|UNGATED | apps/web/src/features/web-core-workspace/settings-menu.logic.ts:36-47 | yes |
| `branches` | `/settings/branches` | company.branch.read, company.branch.manage | company_settings\|company_settings.branches\|UNGATED | apps/web/src/features/web-core-workspace/settings-menu.logic.ts:48-56 | yes |
| `accounting-tax-setup` | `/settings/accounting-tax-setup` | company.settings.view, company.setup.manage, ledger.account.read, ledger.account.manage, tax.profile.read, tax.profile.manage, tax.config.read, tax.config.manage | UNMAPPED, UNGATED, double_entry_ledger, thai_tax | apps/web/src/features/web-core-workspace/settings-menu.logic.ts:57-75 | yes |
| `tax-codes` | `/settings/tax-codes` | tax.profile.read, tax.profile.manage, tax.config.read, tax.config.manage | thai_tax | apps/web/src/features/web-core-workspace/settings-menu.logic.ts:76-85 | yes |
| `tax-accounts` | `/settings/tax-accounts` | tax.config.read, tax.config.manage, ledger.posting-rule.read, ledger.posting-rule.manage | thai_tax, double_entry_ledger | apps/web/src/features/web-core-workspace/settings-menu.logic.ts:86-95 | yes |
| `chart-of-accounts` | `/settings/chart-of-accounts` | ledger.account.read, ledger.account.manage | double_entry_ledger | apps/web/src/features/web-core-workspace/settings-menu.logic.ts:96-105 | yes |

## 5b. NAV_ITEM — hard-coded sub-items (10)

Submenu visibility rule: the parent module must survive `filterModulesByPermissions` first, then each child is gated independently by `hasAnyPermission` inside `buildNavItems`. Children `poapproval`/`discount`/`lineoa` are re-parented under `roles` (`web-core-workspace.logic.ts:143-153`) with no gate beyond their own module filter.

| Sub-item | Href | Gate keys | featureKey | Evidence |
|---|---|---|---|---|
| `expenses.list` | `/expenses` | expense.read, expense.read_own | expenses\|expenses.list | apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:160 |
| `expenses.upload` | `/expenses/upload` | expense.receipt.upload | expenses\|expenses.upload | apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:169 |
| `expenses.manual` | `/expenses/manual` | expense.create | expenses\|expenses.manual | apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:178 |
| `expenses.categories` | `/expenses/categories` | expense.category.manage | expenses\|expenses.categories | apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:187 |
| `expenses.signatures` | `/expenses/signatures` | expense.signature.manage | expenses\|expenses.substitute_receipt | apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:196 |
| `expenses.substitute_receipt_policy` | `/settings/substitute-receipt` | company.setup.manage | UNGATED | apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:205 |
| `expenses.evidence` | `/expenses/evidence` | expense.evidence.read | expenses\|expenses.evidence | apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:214 |
| `roles.permissions` | `/settings/permissions` | access.role.read | employee_access\|employee_access.roles\|UNGATED | apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:115 |
| `roles.individual` | `/settings/access-overview` | access.effective.read | employee_access\|employee_access.overview\|UNGATED | apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:124 |
| `employees` | `/settings/employees` | access.employee.read | employee_access\|employee_access.employees\|UNGATED | apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:133 |

## 5c. NAV_ITEM — other

| Item | Gate | Evidence | Notes |
|---|---|---|---|
| sidebar whitelist DESIGN_HANDOFF_NAV_ORDER | NONE | apps/web/src/features/web-core-workspace/WorkspaceLayout.tsx:25-43 | HARD-CODED 15-key whitelist applied AFTER permission filtering. 13 permitted modules (inventory, procurement, workflow, ai-suggestions, accounting, accounts-payable, banking, crm, poapproval, discount, notifications, lineoa, sales) never appear in the sidebar even when the user holds their permissions. Not an entitlement signal — a design freeze. Routes remain reachable by URL. |
| header notification bell / account-security menu | PERMISSION (notification.read, account.password.change, account.identity.link, account.identity.unlink) | apps/web/src/features/web-core-workspace/WorkspaceLayout.tsx:91,94-98 | Only non-sidebar nav surfaces with their own permission gates. |

---

## 6. Web client-side feature/entitlement helpers (3)

### [helper] client-side feature/entitlement helper

- Gating: `NONE`
- Evidence: apps/web/src/common/auth/server-session.ts:16-48; apps/web/src/common/models/web-session.model.ts:2-12
- Detail: apps/web/src/common/models/web-session.model.ts:2-12 — WebSession has roles+permissions only, NO enabledFeatures/entitlements field; grep for entitle|enabledFeatures|FEATURE_CATALOG in apps/web/src returns hits ONLY in features/system-partners/* (the admin editor) and one comment in web-core-workspace.constants.ts:75
- KEY FINDING: the workspace web app has NO entitlement helper. It decides show/hide purely from session.permissions; entitlement is projected into permissions server-side by filterPermissionsByEntitlement (apps/api/.../feature-gate.logic.ts:75-88) inside the permission resolver (apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts:4-5). Consequence: web cannot distinguish "not entitled" from "no permission" and has no place to render a purchased-but-unavailable / feature_not_enabled state (plan F1).

### [helper] system-partners entitlement editor logic

- Gating: `PERMISSION`
- Evidence: apps/web/src/features/system-partners/system-partners.logic.ts:19-166
- Detail: apps/web/src/features/system-partners/system-partners.logic.ts:19-166 (Entitlement type :19, configuredEntitlements :63, effectiveEntitlements :95, editableEntitlements :111, entitlementEnabled :121)
- The ONLY place apps/web reads FEATURE_CATALOG / LEGACY_FEATURE_INHERITANCE / ALL_FEATURE_ENTITLEMENT_KEYS. Legacy fail-open: entitlements.length===0 => all-on default except expense_auto_post (:111-118). Not reachable from the tenant workspace.

### [helper] api-error entitlement mapping

- Gating: `NONE`
- Evidence: apps/web/src/features/employee-access/EmployeeAccessPages.tsx:57,917
- Detail: apps/web/src/common/api/api-error.logic.ts contains a "requiredAnyPermissions" reference but no feature_not_enabled code; apps/web/src/features/employee-access/EmployeeAccessPages.tsx:57 maps not_entitled -> "แพ็กเกจบริษัทยังไม่เปิดฟีเจอร์นี้" (capability-pack picker only)
- The only user-visible "not entitled" copy in the tenant workspace lives in the capability-pack picker, not in any route/menu. No shared feature_not_enabled mapping exists yet (plan F1 item).


---

## 7. AI_ROUTER (4)

### IntentRouterAgent.route() (business read turn) — `NONE` — **RESOLVED**

- Evidence: apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts:180-183 signature (messageText, hasAttachment, conversationContext, openClarifications) — NO permissions and NO enabledFeatures parameter; apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts:236-273 modelRoute builds the payload from messageText/hasAttachment/conversationContext/openClarifications only
- CONFIRMED: the business route has NO availability input at all. Availability is decided later by the static ROUTER_ENABLED_TOOLS set (normalizeToolAvailability :311-334) and by permissions at the orchestrator (availableToolsForPlan :688-700). Router can therefore emit a plan for a tool the company has not bought; the user learns only from the downstream PERMISSION_DENIED/empty result.

### IntentRouterAgent.routeIntake() (LINE intake route) — `FEATURE` — **BLOCKED**

- Evidence: apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts:186-234; payload apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts:191-201 includes permissions (:195) and enabledFeatures (:196, defaults to [])
- BLOCKED/DEAD SIGNAL: LineIntakeRouteRequest.enabledFeatures is optional (packages/contracts/src/line-ai.ts:331) and NO producer sets it — the only caller, apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:460-479, omits the field, so it is ALWAYS []. Both permissions and enabledFeatures are model-visible advisory context only: the prompt states enforcement happens outside (:162). Missing: an API-side producer, and a deterministic (non-prompt) filter.

### ROUTER_ENABLED_TOOLS (static enabled catalog) — `NONE` — **RESOLVED**

- Evidence: apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts:51-106 — a module-level static Set of 54 tool names, built at import time with no company/tenant/entitlement input
- Same catalog for every tenant. buildFeatureCatalog (:295-309) serializes it as the cacheable prompt prefix — a per-company catalog would break that cache checkpoint (:237-242). This is the single seam where a per-company availability vector would have to enter.

### ROUTER_DISABLED_TOOLS (static disabled catalog) — `NONE` — **RESOLVED**

- Evidence: apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts:111-117 — 5 tool names, reason hard-coded 'backend_tool_not_wired' (:307)
- Disabled for BUILD reasons (adapter not implemented), not entitlement. normalizeToolAvailability (:311-334) already produces the exact UX an entitlement gate needs — refusal reason feature_disabled (:332,:355) and PARTIAL downgrade — but it is driven by the static set, never by the company.


### route() vs routeIntake() — input comparison

| Input | `route()` (business read) | `routeIntake()` (LINE intake) |
|---|---|---|
| `messageText` | yes (`:180`) | yes (`:192`) |
| `hasAttachment` / `attachments` | bool only (`:180`) | full attachment metadata + inline images (`:187-194`) |
| `conversationContext` | yes (`:180,252`) | yes (`:198`) |
| `openClarifications` | yes (`:180,253`) | yes (`:200`) |
| `locale` | no | yes (`:193`) |
| `permissions` | **no** | yes (`:195`) — advisory prompt context only (`:162`) |
| `enabledFeatures` | **no** | field exists (`:196`) but **always `[]`** — no producer |
| `activeCategories` | no | yes (`:197`) |
| `valueCandidates` | no | yes (`:199`) |
| tool/feature catalog | static `ROUTER_ENABLED_TOOLS` + `ROUTER_DISABLED_TOOLS` via `buildFeatureCatalog()` (`:242,295-309`) | none (the intake router routes to intents, not tools) |

Availability enforcement after `route()` is entirely static: `normalizeToolAvailability` (`:311-334`) drops intents whose tools are in `ROUTER_DISABLED_TOOLS` → `PARTIAL` + refusal `feature_disabled` (`:332`), or `UNROUTABLE` + `feature_disabled` when nothing survives (`:327,350-358`). The friendly refusal shape an entitlement gate needs already exists; only the per-company input is missing.

---

## 8. AI_TOOL — full catalog (59)

Registry: `packages/contracts/src/ai-tools.ts:63+`. Permission enforcement: `hasToolPermissions` (`:57-60`), applied at `availableToolsForPlan` (`orchestrator.agent.ts:694`) and `dispatchByPlan` (`:404-406`); ERP core re-checks every call (`requiresErpPermissionCheck`, `tool-policy-enforcer.service.ts:16-18`).

**No tool has any availability/entitlement filter.** The only two filters are (a) the static `ROUTER_ENABLED_TOOLS` membership test and (b) the caller's permissions — which are entitlement-filtered upstream in `apps/api`, so entitlement reaches tools only as *absent permissions*, never as a distinguishable state.

| Tool | ai-tools.ts | requiredPermissions | anyOfPermissions | featureKey | sourceModule | Router | Specialist | Status |
|---|---|---|---|---|---|---|---|---|
| `company.get_current_context` | 65 | company.setup.read | — | UNGATED | data-model-core | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `company.list_branches` | 77 | company.branch.read | — | company_settings\|company_settings.branches\|UNGATED | data-model-core | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `dashboard.get_business_health_summary` | 89 | dashboard.read | — | dashboard_notifications | dashboard-notifications | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `notifications.list_open_alerts` | 101 | notification.read | — | dashboard_notifications | dashboard-notifications | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `notifications.get_daily_summary` | 113 | notification.read | — | dashboard_notifications | dashboard-notifications | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `inventory.search_products` | 125 | inventory.product.read | — | product_catalog | inventory | enabled | inventory | RESOLVED |
| `inventory.get_product_detail` | 138 | inventory.product.read | — | product_catalog | inventory | enabled | inventory | RESOLVED |
| `inventory.get_stock_balance` | 151 | inventory.product.read, inventory.movement.read | — | product_catalog, inventory\|inventory.movements | inventory | enabled | inventory | RESOLVED |
| `inventory.list_low_stock` | 163 | inventory.product.read, inventory.report.read | — | product_catalog, inventory\|inventory.stock_report | inventory | enabled | inventory | RESOLVED |
| `inventory.summarize_stock_movements` | 175 | inventory.movement.read | — | inventory\|inventory.movements | inventory | enabled | inventory | RESOLVED |
| `ledger.get_financial_summary` | 188 | ledger.report.read | — | double_entry_ledger | ledger | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `expense.list_recent` | 200 | expense.read, expense.review, expense.read_own | yes (see JSON) | expenses\|expenses.list, expenses | expenses | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `expense.get_detail` | 214 | expense.read, expense.review, expense.read_own | yes (see JSON) | expenses\|expenses.list, expenses | expenses | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `sales.get_sales_summary` | 228 | crm.report.read | — | crm\|crm.overview | accounting-documents | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `crm.get_customer_summary` | 241 | crm.customer.read | — | crm\|crm.customers | crm | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `crm.search_customers` | 254 | crm.customer.read | — | crm\|crm.customers | crm | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `crm.get_customer_360` | 267 | crm.customer.read | — | crm\|crm.customers | crm | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `crm.get_report_summary` | 280 | crm.report.read | — | crm\|crm.overview | crm-inbox | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `crm.get_pipeline_summary` | 293 | crm.opportunity.read | — | crm\|crm.pipeline | crm | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `crm.list_open_followups` | 306 | crm.follow_up.read | — | crm\|crm.followups | crm | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `crm.get_booking_summary` | 319 | crm.booking.read | — | crm\|crm.bookings | crm | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `crm.list_bookings` | 332 | crm.booking.read | — | crm\|crm.bookings | crm | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `crm.get_inbox_summary` | 345 | crm.inbox.read | — | crm\|crm.inbox | crm-inbox | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `crm.list_conversations` | 357 | crm.inbox.read | — | crm\|crm.inbox | crm-inbox | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `crm.get_conversation_summary` | 370 | crm.inbox.read | — | crm\|crm.inbox | crm-inbox | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `crm.suggest_sales_followups` | 383 | crm.customer.read | — | crm\|crm.customers | crm-sales | **disabled** | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `accounting.capture_receipt_evidence` | 395 | expense.receipt.upload | — | expenses\|expenses.upload | expenses | **disabled** | NONE | RESOLVED |
| `accounting.get_summary` | 413 | accounting.document.read | — | sales_documents | accounting-documents | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `accounting.list_recent_documents` | 426 | accounting.document.read | — | sales_documents | accounting-documents | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `accounting.get_document_detail` | 439 | accounting.document.read | — | sales_documents | accounting-documents | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `accounting.get_receivable_summary` | 452 | accounting.document.read | — | sales_documents | accounting-documents | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `procurement.get_ap_outstanding` | 464 | procurement.ap.report | — | procurement\|procurement.ap_aging | procurement | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `procurement.get_summary` | 476 | procurement.purchase_order.read | — | procurement\|procurement.purchase_orders | procurement | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `procurement.search_suppliers` | 489 | procurement.supplier.read | — | procurement\|procurement.suppliers | procurement | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `procurement.get_purchase_order_detail` | 502 | procurement.purchase_order.read | — | procurement\|procurement.purchase_orders | procurement | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `ledger.get_period_status` | 515 | ledger.period.read | — | double_entry_ledger | ledger | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `ledger.get_report_summary` | 528 | ledger.report.read, ledger.period.read | — | double_entry_ledger | ledger | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `company.get_employee_summary` | 542 | access.employee.read | — | employee_access\|employee_access.employees\|UNGATED | employee-access | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `company.get_employee_detail` | 555 | access.employee.read | — | employee_access\|employee_access.employees\|UNGATED | employee-access | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `expense.get_breakdown` | 568 | expense.read, expense.review, expense.read_own | yes (see JSON) | expenses\|expenses.list, expenses | expenses | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `bank.get_account_balances` | 583 | bank.account.read | — | bank_reconciliation\|bank_reconciliation.accounts | banking | **disabled** | NONE | RESOLVED |
| `bank.get_reconciliation_status` | 595 | bank.reconciliation.read | — | bank_reconciliation\|bank_reconciliation.reconciliations | banking | **disabled** | NONE | RESOLVED |
| `reimbursement.list_pending_approvals` | 607 | reimbursement.read | — | reimbursement | reimbursements | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `reimbursement.get_summary` | 619 | reimbursement.read, reimbursement.read_own | yes (see JSON) | reimbursement | reimbursements | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `reimbursement.get_detail` | 632 | reimbursement.read, reimbursement.read_own | yes (see JSON) | reimbursement | reimbursements | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `hr.get_leave_summary` | 646 | hr.leave.read | — | UNMAPPED | hr | **disabled** | NONE | BLOCKED |
| `reports.get_monthly_report_summary` | 659 | report.catalog.read, report.dataset.read, report.query.run | — | reports | reports | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `tax.get_upcoming_tax_obligations` | 678 | tax.period.read | — | thai_tax | tax | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `tax.get_vat_summary` | 690 | tax.period.read, tax.event.read | — | thai_tax | tax | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `tax.get_wht_summary` | 702 | tax.period.read, tax.event.read | — | thai_tax | tax | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `tax.get_cit_calendar` | 714 | tax.period.read | — | thai_tax | tax | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `tax.list_missing_tax_documents` | 726 | tax.period.read, tax.review_issue.read | — | thai_tax | tax | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `tax.get_tax_code_profile` | 739 | tax.profile.read, tax.config.read | — | thai_tax | tax | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `tax.get_transaction_tax_summary` | 752 | tax.profile.read, tax.period.read, tax.report.read, tax.event.read, tax.review_issue.read | — | thai_tax | tax | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `tax.get_reconciliation_summary` | 765 | tax.profile.read, tax.period.read, tax.report.read, tax.event.read, ledger.journal.read, tax.review_issue.read | — | thai_tax, double_entry_ledger | tax | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `workflow.explain_run` | 779 | workflow.run.read | — | workflow_automation\|workflow_automation.runs | workflow | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `workflow.list_assigned_tasks` | 792 | workflow.task.read | — | workflow_automation\|workflow_automation.tasks | workflow | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `workflow.list_recent_failures` | 804 | workflow.run.read | — | workflow_automation\|workflow_automation.runs | workflow | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |
| `workflow.summarize_rule_health` | 816 | workflow.rule.read | — | workflow_automation\|workflow_automation.rules | workflow | enabled | accounting(shared by accounting/cfo/sales/crm/tax/general/notifications) | RESOLVED |

### 8a. Router-disabled tools (5) — disabled for BUILD reasons, not entitlement

- `crm.suggest_sales_followups` — `intent-router.agent.ts:111-117`, reason hard-coded `backend_tool_not_wired` (`:307`). featureKey: crm|crm.customers
- `accounting.capture_receipt_evidence` — `intent-router.agent.ts:111-117`, reason hard-coded `backend_tool_not_wired` (`:307`). featureKey: expenses|expenses.upload
- `bank.get_account_balances` — `intent-router.agent.ts:111-117`, reason hard-coded `backend_tool_not_wired` (`:307`). featureKey: bank_reconciliation|bank_reconciliation.accounts
- `bank.get_reconciliation_status` — `intent-router.agent.ts:111-117`, reason hard-coded `backend_tool_not_wired` (`:307`). featureKey: bank_reconciliation|bank_reconciliation.reconciliations
- `hr.get_leave_summary` — `intent-router.agent.ts:111-117`, reason hard-coded `backend_tool_not_wired` (`:307`). featureKey: UNMAPPED

### 8b. Tools no specialist can reach (4)

`allowedToolsForAgent` (`orchestrator.agent.ts:703-718`) maps every agent to exactly one of two static allowlists: `INVENTORY_ALLOWED_TOOLS` (`inventory.agent.ts:10-16`, 5 tools) or `ACCOUNTING_ALLOWED_TOOLS` (`accounting-summary.agent.ts:10-60`, 50 tools), the latter shared by accounting/cfo/sales/crm/tax/general/notifications. 5 + 50 = 55 of the 59 registry tools. The remaining 4 appear in neither list and are unreachable regardless of router state or permissions: `accounting.capture_receipt_evidence`, `bank.get_account_balances`, `bank.get_reconciliation_status`, `hr.get_leave_summary` — all 4 are also router-disabled, so the two suppressions overlap exactly. `crm.suggest_sales_followups` is the fifth router-disabled tool but IS in the accounting allowlist, so it becomes reachable the moment the router flag flips.

---

## 9. AI_ORCHESTRATOR (21)

### 9a. Plan / act seams

| Seam | file:line | Gate kind | What it filters on |
|---|---|---|---|
| `availableToolsForPlan()` | apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts:688-700 | PERMISSION | THE plan/act availability seam. Intersects: routed agent allowlist (allowedToolsForAgent :703-718) x ROUTER_ENABLED_TOOLS (:692) x isSubjectCompatible (:692) x hasToolPermissions(meta, ctx.permissions) (:694). No entitlement/feature input. Callers: dispatchByModelLoop :438, dispatchByNativeToolLoop :486. |
| `dispatchByPlan() (deterministic fallback)` | apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts:396-422 | PERMISSION | Filters plan.requiredTools by isSubjectCompatible (:403) then hasToolPermissions (:404-406); emits PERMISSION_DENIED output (:408-415) when a subject-compatible tool exists but no permission. This is the only user-visible denial shape today — an entitlement denial would currently be indistinguishable from it. |
| `dispatchByModelLoop() (JSON one-tool loop)` | apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts:432-467 | PERMISSION | Uses availableToolsForPlan(:438); a model-named tool outside the map stops the loop (:453). |
| `dispatchByNativeToolLoop() (native tool-use)` | apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts:478-500+ | PERMISSION | Uses availableToolsForPlan(:486); returns unavailable when the map is empty (:487). |
| `allowedToolsForAgent() (domain isolation)` | apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts:703-718 | NONE | Static per-agent allowlists: INVENTORY_ALLOWED_TOOLS (inventory.agent.ts:10-16, 5 tools) and ACCOUNTING_ALLOWED_TOOLS (accounting-summary.agent.ts:10-60, 50 tools) shared by accounting/cfo/sales/crm/tax/general/notifications. accounting.capture_receipt_evidence, bank.*, hr.* belong to NO specialist allowlist, so they are unreachable even if router-enabled. |
| `ToolPolicyEnforcerService.assertToolCanExecute()` | apps/ai-gateway/src/common/ai/tool-policy-enforcer.service.ts:9-24 | NONE | Global env switches only (AI_TOOL_POLICY_ENFORCED, AI_TOOL_AUDIT_ENABLED, AI_FINAL_MUTATION_ENABLED) + requiresErpCorePermissionCheck. No per-company dimension; toolMetaToPolicy (erp-tool.client.ts:29-40) collapses requiredPermissions to its FIRST element for the policy record. |

### 9b. AI-gateway HTTP surfaces (14)

Every one is `@Public()` (bypasses `DenyByDefaultGuard`, `deny-by-default.guard.ts:18-25`) and authenticates with a shared `x-internal-secret` only. No permission decorator and no company entitlement check exists at the gateway boundary.

| Endpoint | file:line |
|---|---|
| `POST /internal/ai/line-turn` | apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts:35-40 |
| `POST /internal/ai/line-intake-route` | apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts:54-59 |
| `POST /internal/ai/receipt-ocr` | apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts:73-78 |
| `POST /internal/ai/bank-statement-extract` | apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts:185-190 |
| `GET /internal/ai/agents` | apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts:249-252 |
| `POST /internal/ai/crm-booking-extract` | apps/ai-gateway/src/modules/crm-customer-ai/crm-customer-ai-internal.controller.ts:60-61 |
| `POST /internal/ai/crm-intake` | apps/ai-gateway/src/modules/crm-customer-ai/crm-customer-ai-internal.controller.ts:82-83 |
| `POST /internal/ai/crm-customer-profile-extract` | apps/ai-gateway/src/modules/crm-customer-ai/crm-customer-ai-internal.controller.ts:98-99 |
| `POST /internal/ai/crm-reply-draft` | apps/ai-gateway/src/modules/crm-customer-ai/crm-customer-ai-internal.controller.ts:123-124 |
| `POST /internal/ai/crm-trust-score` | apps/ai-gateway/src/modules/crm-customer-ai/crm-customer-ai-internal.controller.ts:147-148 |
| `POST /internal/ai/crm-summary` | apps/ai-gateway/src/modules/crm-customer-ai/crm-customer-ai-internal.controller.ts:164-165 |
| `POST /internal/ai/crm-insights` | apps/ai-gateway/src/modules/crm-customer-ai/crm-customer-ai-internal.controller.ts:180-181 |
| `POST /internal/ai/crm-broadcast` | apps/ai-gateway/src/modules/crm-customer-ai/crm-customer-ai-internal.controller.ts:196-197 |
| `POST /internal/ai/draft-generate` | apps/ai-gateway/src/modules/ai-draft/ai-draft-internal.controller.ts:26-27 |

### 9c. What entitlement signal reaches the gateway today

- Gate: `FEATURE` — ai_line_assistant (indirect, API-side only)
- Evidence: apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:407-412 lineAssistantDisabled() + call sites :596 and :1200; apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts:4-5 applies filterPermissionsByEntitlement before userContext.permissions is built
- ONLY TWO signals reach the gateway: (1) an all-or-nothing ai_line_assistant kill switch enforced in apps/api BEFORE any gateway call (legacy fail-open when the company has zero entitlement rows, :410-411); (2) an already-entitlement-FILTERED permissions array inside userContext (orchestrator.agent.ts:262). No feature key, no entitlement set, no availability vector crosses the HTTP boundary. line.ai.query itself lives in an ungated foundation pack, which is why the explicit kill switch exists.

---

## 10. BLOCKED rows (14)

| Surface | Row | What is missing |
|---|---|---|
| WEB_PAGE | `/companies/{companyId}/settings` |  (featureKey unresolvable): company.settings.view — not in CAPABILITY_PACKS, no PREFIX_FEATURE_RULES prefix, not in any FEATURE_CATALOG submenu (company_settings only lists branches + security). Never stripped by entitlement. Missing: an owner decision on which of the 18 top-level keys owns this permission (or an explicit "always-on/non-sellable" ruling). |
| WEB_PAGE | `/companies/{companyId}/settings/accounting-tax-setup` |  (featureKey unresolvable): company.settings.view — not in CAPABILITY_PACKS, no PREFIX_FEATURE_RULES prefix, not in any FEATURE_CATALOG submenu (company_settings only lists branches + security). Never stripped by entitlement. Missing: an owner decision on which of the 18 top-level keys owns this permission (or an explicit "always-on/non-sellable" ruling). |
| WEB_PAGE | `/companies/{companyId}/settings/accounting-tax-setup/chart` |  (featureKey unresolvable): company.settings.view — not in CAPABILITY_PACKS, no PREFIX_FEATURE_RULES prefix, not in any FEATURE_CATALOG submenu (company_settings only lists branches + security). Never stripped by entitlement. Missing: an owner decision on which of the 18 top-level keys owns this permission (or an explicit "always-on/non-sellable" ruling). |
| WEB_PAGE | `/companies/{companyId}/settings/accounting-tax-setup/chart/review` |  (featureKey unresolvable): company.settings.view — not in CAPABILITY_PACKS, no PREFIX_FEATURE_RULES prefix, not in any FEATURE_CATALOG submenu (company_settings only lists branches + security). Never stripped by entitlement. Missing: an owner decision on which of the 18 top-level keys owns this permission (or an explicit "always-on/non-sellable" ruling). |
| WEB_PAGE | `/companies/{companyId}/settings/accounting-tax-setup/mappings` |  (featureKey unresolvable): company.settings.view — not in CAPABILITY_PACKS, no PREFIX_FEATURE_RULES prefix, not in any FEATURE_CATALOG submenu (company_settings only lists branches + security). Never stripped by entitlement. Missing: an owner decision on which of the 18 top-level keys owns this permission (or an explicit "always-on/non-sellable" ruling). |
| WEB_PAGE | `/companies/{companyId}/settings/accounting-tax-setup/prerequisites` |  (featureKey unresolvable): company.settings.view — not in CAPABILITY_PACKS, no PREFIX_FEATURE_RULES prefix, not in any FEATURE_CATALOG submenu (company_settings only lists branches + security). Never stripped by entitlement. Missing: an owner decision on which of the 18 top-level keys owns this permission (or an explicit "always-on/non-sellable" ruling). |
| WEB_PAGE | `/companies/{companyId}/settings/accounting-tax-setup/profile` |  (featureKey unresolvable): company.settings.view — not in CAPABILITY_PACKS, no PREFIX_FEATURE_RULES prefix, not in any FEATURE_CATALOG submenu (company_settings only lists branches + security). Never stripped by entitlement. Missing: an owner decision on which of the 18 top-level keys owns this permission (or an explicit "always-on/non-sellable" ruling). |
| WEB_PAGE | `/companies/{companyId}/settings/accounting-tax-setup/review` |  (featureKey unresolvable): company.settings.view — not in CAPABILITY_PACKS, no PREFIX_FEATURE_RULES prefix, not in any FEATURE_CATALOG submenu (company_settings only lists branches + security). Never stripped by entitlement. Missing: an owner decision on which of the 18 top-level keys owns this permission (or an explicit "always-on/non-sellable" ruling). |
| WEB_PAGE | `/companies/{companyId}/settings/notification-rules` |  (featureKey unresolvable): company.settings.view — not in CAPABILITY_PACKS, no PREFIX_FEATURE_RULES prefix, not in any FEATURE_CATALOG submenu (company_settings only lists branches + security). Never stripped by entitlement. Missing: an owner decision on which of the 18 top-level keys owns this permission (or an explicit "always-on/non-sellable" ruling). |
| WEB_PAGE | `/companies/{companyId}/settings/notifications` |  (featureKey unresolvable): company.settings.view — not in CAPABILITY_PACKS, no PREFIX_FEATURE_RULES prefix, not in any FEATURE_CATALOG submenu (company_settings only lists branches + security). Never stripped by entitlement. Missing: an owner decision on which of the 18 top-level keys owns this permission (or an explicit "always-on/non-sellable" ruling). |
| NAV_ITEM | `module 'settings' -> /settings` |  (featureKey unresolvable): company.settings.view — not in CAPABILITY_PACKS, no PREFIX_FEATURE_RULES prefix, not in any FEATURE_CATALOG submenu (company_settings only lists branches + security). Never stripped by entitlement. Missing: an owner decision on which of the 18 top-level keys owns this permission (or an explicit "always-on/non-sellable" ruling). |
| NAV_ITEM | `settings card 'accounting-tax-setup' -> /settings/accounting-tax-setup` |  (featureKey unresolvable): company.settings.view — not in CAPABILITY_PACKS, no PREFIX_FEATURE_RULES prefix, not in any FEATURE_CATALOG submenu (company_settings only lists branches + security). Never stripped by entitlement. Missing: an owner decision on which of the 18 top-level keys owns this permission (or an explicit "always-on/non-sellable" ruling). |
| AI_ROUTER | `IntentRouterAgent.routeIntake() (LINE intake route)` | /DEAD SIGNAL: LineIntakeRouteRequest.enabledFeatures is optional (packages/contracts/src/line-ai.ts:331) and NO producer sets it — the only caller, apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:460-479, omits the field, so it is ALWAYS []. Both permissions and enabledFeatures are model-visible advisory context only: the prompt states enforcement happens outside (:162). Missing: an API-side producer, and a deterministic (non-prompt) filter. |
| AI_TOOL | `hr.get_leave_summary` | : permission belongs to no capability pack and matches no PREFIX_FEATURE_RULES entry, so filterPermissionsByEntitlement falls through to `return true` (feature-gate.logic.ts:86) — feature key unresolvable without an owner decision. BLOCKED (featureKey unresolvable): hr.leave.read — no `hr` feature key exists in FEATURE_CATALOG (18 keys) and no capability pack carries hr.*; the owning HR module is unbuilt. Missing: an owner decision on which of the 18 top-level keys owns this permission (or an explicit "always-on/non-sellable" ruling). |

### Unresolvable permission→feature mappings (root cause of 13 of the 14)

| Permission | Why unresolvable | Surfaces affected |
|---|---|---|
| `company.settings.view` | In no capability pack; matches no `PREFIX_FEATURE_RULES` prefix; not in any `FEATURE_CATALOG` submenu (the `company_settings` feature lists only `branches` and `security`). `filterPermissionsByEntitlement` therefore falls through to `return true` (`feature-gate.logic.ts:86`) — the permission is entitlement-blind. | `settings` module + 10 settings routes (incl. all 7 accounting-tax-setup steps) + the `accounting-tax-setup` card |
| `hr.leave.read` | No `hr` key exists among the 18 `FEATURE_CATALOG` top-level keys and no pack carries `hr.*`; the owning module is unbuilt. | AI tool `hr.get_leave_summary` |

Owner decision needed for both: which top-level key owns the permission, or an explicit "always-on / non-sellable" ruling. Not inferred here.

---

## 11. Notes for downstream F0 lanes

- The single chokepoint for web + AI permission stripping is `filterPermissionsByEntitlement` (`feature-gate.logic.ts:75-88`). Its precedence is: `FEATURE_CATALOG` submenu deny-check (`:79-80`) → `PREFIX_FEATURE_RULES` first-match (`:81-82`) → ungated pack (`:83`) → gated pack ANY-of (`:84-85`) → **fail-open `return true`** (`:86`). The fail-open tail is what makes `company.settings.view` and `hr.leave.read` invisible to entitlement.
- `PREFIX_FEATURE_RULES` lives at `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:39-50`, **not** in `packages/contracts` as the lane brief assumed. `packages/contracts/src/feature-entitlements.ts` owns `FEATURE_CATALOG` (18 top-level keys), `LEGACY_FEATURE_INHERITANCE` (`:554-558`), `FEATURE_KEYS`/`ALL_FEATURE_ENTITLEMENT_KEYS` (`:560-565`) and `DEFAULT_ON_FEATURE_KEYS = ['employee_access','company_settings']` (`:551`).
- Legacy fail-open appears in three places that must move together: `loadEntitledFeatureKeys`/`filterPermissionsByEntitlement` (`entitled === null` → all-on), `lineAssistantDisabled` (`process-line-webhook.use-case.ts:410-411`), and the web admin editor `editableEntitlements` (`system-partners.logic.ts:111-118`, all-on except `expense_auto_post`).
- `buildFeatureCatalog()` output rides as the router's **cacheable prompt prefix** (`intent-router.agent.ts:237-242`). Any per-company availability vector injected there breaks the shared cache checkpoint — a design constraint for F1, recorded here as evidence only.
