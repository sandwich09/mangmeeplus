# Feature: Smart Roles — Capability Packs, Job Presets, and Effective-Access View (v2 Phase 1)

## 1. Status

- Roadmap/checklist item: **10C+ Phase 1** (see [[plans/master-implementation-checklist|Master Implementation Checklist]] item 10C+). Part of [[plans/employee-access-role-management-v2-plan|Employee Access & Role Management v2 Plan]] — Pillar B (Human-Friendly Roles) + Pillar F (Visibility).
- Owner: Product / Customer Owner & Admin.
- Date: 2026-07-03.
- Readiness: **Implement-ready.** This spec controls behavior/interfaces for Phase 1 only. It builds strictly on shipped item 10C primitives and adds no new authorization mechanism — only a human-friendly author-time layer over the same permission keys.

## 2. Goal

Let a non-technical SME owner/admin build a working role in under a minute by choosing a **job preset** or toggling plain-language **capability packs**, see a live **"this person will be able to…"** preview before saving, and view a **who-can-do-what matrix** across the company — instead of facing the raw ~200-key permission grid that item 10C ships today.

Business value: removes the #1 blocker to giving employees their own accounts (unclear permissions → owners over-grant or keep sharing the owner login). This is the highest-usability, lowest-risk slice of v2 and ships first.

## 3. Source Docs

- Product/overview: [[specs/sme-business-os-overview|SME Business OS Overview]], [[product/business-model|Business Model]]
- Related specs: [[specs/employee-access-role-management-spec|Employee Access & Role Management Spec]] (10C), [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]], [[specs/permission-matrix|Permission Matrix]], [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
- Related plans: [[plans/employee-access-role-management-v2-plan|Employee Access & Role Management v2 Plan]], [[plans/employee-access-role-management-plan|10C Plan]], [[plans/admin-company-onboarding-plan|10A Plan]] (feature entitlement)
- Permission registry (source of truth for keys): `apps/api/src/modules/auth/permission-registry.ts`
- Thai summary: `Doc/employee-access-role-management-v2-summary-th.md`

## 4. Non-goals (Phase 1)

- Self-service invites, bulk import (Phases 2–3).
- Teams, branch/team ABAC, approval limits, time-bound access (Phases 4–5).
- AI role suggestion / explain-access (Phase 6 — Phase 1 ships the guided builder that Phase 6 later feeds).
- Delegation, offboarding, access review, MFA (Phases 7–8).
- Any change to the runtime authorization path (guards, permission resolution, ABAC). Packs/presets compile to the **same** `permissionKeys` that `RolePermission` already stores.
- New base/system roles. Presets are curated bundles that produce **company custom roles**; the 11 seeded system roles are unchanged.
- Removing legacy `admin.user.*` / `admin.role.*` keys (left as-is per 10C decision; excluded from packs).

## 5. User Roles

- **Owner:** builds/edits any role, applies any preset, sees full who-can-do-what matrix. Only role that can grant packs it does not itself hold.
- **Admin:** builds/edits company custom roles and applies presets, but **cannot grant a capability pack whose keys exceed the admin's own effective permissions** (no self-elevation); cannot touch OWNER/SYSTEM_ADMIN; sees the matrix.
- **Manager:** reads capability packs and presets (to understand access) and reads roles. Effective-access matrix is granted in Phase 4 once team scope exists; Phase 1 grants matrix read to Owner/Admin/Auditor only.
- **Auditor (read-only):** reads packs, presets, roles, and the effective-access matrix (masked) for audit.
- **AI assistant user:** no Phase 1 surface (Phase 6 adds read-only suggestion/explanation).

## 6. Business Journey

1. **Trigger:** owner/admin opens Settings > Roles and clicks "Add role" (or "Add employee" and needs a role).
2. **Main user action:** choose a starting point — **Job preset** (e.g. แคชเชียร์), **blank**, then toggle **capability packs** in plain language (progressive disclosure: advanced raw-key grid available but collapsed).
3. **System response:** live preview compiles selected packs (+ any advanced keys) into effective permissions, filters by company feature entitlement and by the granter's own effective permissions, and renders "This person will be able to: …" grouped by area, flagging high-risk capabilities.
4. **Review/approval:** owner/admin confirms; system creates/updates a company custom `Role` with the compiled `permissionKeys` and records which packs were selected (for round-trip editing). Audited.
5. **Completion state:** role appears in the list with a human-readable capability summary; assignable to employees via the existing 10C flow.
6. **Exception path:** a pack referencing a non-entitled feature shows as locked and its keys are excluded; an admin selecting a pack beyond their own permissions sees it disabled with a reason; empty/entitlement-filtered result blocks save with a clear message.

## 7. Business Rules

- **Deny by default preserved.** Compiled keys = `union(expand(packs), advancedKeys)` then intersected with `COMPANY_PERMISSION_KEYS` ∩ company feature entitlement ∩ granter's own effective permissions. Never a superset of what the granter holds (Owner exempt).
- **Packs are author-time only.** The runtime authorization path is unchanged; roles still carry `permissionKeys`.
- **System roles are read-only** in the builder (existing 10C `isSystem` guard). Presets can be *applied* to spawn a new editable company role, never to mutate a system role.
- **`OWNER`/`SYSTEM_ADMIN` remain non-assignable** and are never producible by any pack/preset (existing `NON_ASSIGNABLE_ROLE_KEYS`).
- **Feature entitlement is enforced here for the first time** (closes the 10C deferred item): a pack with a `featureEntitlementKey` the company lacks is hidden/locked and its keys are dropped from compilation.
- **Every role create/update via packs is audited** with the selected pack keys and the resolved permission-key delta (never secrets).
- **Effective-access matrix** shows only company-scoped, masked data; it never reveals platform `system.*` grants or sensitive identifiers.

## 8. Boundary and Ownership

- **Web owns:** the guided builder, preview, matrix, and preset application UI (source of truth for all access mutation).
- **LINE/LIFF owns:** nothing in Phase 1 (no access mutation on LINE).
- **Backend/API owns:** pack/preset catalog, compilation (packs → keys), entitlement + granter-scope filtering, effective-access computation, role persistence, audit.
- **AI Gateway owns:** nothing in Phase 1.
- **Workers/notifications own:** nothing in Phase 1.
- **Out of boundary:** payroll/HR data, runtime guard/ABAC changes, teams/scope/time/limit.

## 9. Data Model Draft

Additive. Reuse `Role`, `RolePermission`, `Permission`, `Company`, `CompanyMembership`, `MembershipRole`, `AuditLog`. Capability packs and system presets are **seeded catalog data (code registries + seed rows)**, mirroring how `PERMISSIONS`/`ROLE_GRANTS` already live in `permission-registry.ts`.

```text
CapabilityPack        # curated, plain-language bundle over existing permission keys
- key                 # e.g. 'pack.sales.operate'  (stable)
- module              # grouping bucket for UI ('sales','billing','inventory',...)
- nameTh, nameEn
- description         # plain-language "what this lets a person do"
- permissionKeys[]    # all existing keys this pack expands to (⊆ COMPANY_PERMISSION_KEYS)
- riskLevel           # max riskLevel among its keys (LOW|MEDIUM|HIGH|CRITICAL)
- featureEntitlementKey?   # gates visibility; null = always available
- isCore              # true = auto-applied to every role, not individually removable
  # Seeded from a code registry (capability-pack.registry.ts); NOT a mutable DB table in Phase 1.

RoleTemplate (JobPreset)
- key                 # e.g. 'tpl.retail.cashier'
- nameTh, nameEn
- description
- industryTag?        # 'retail'|'trading'|'service'|'ecommerce'|'crosscutting'
- capabilityPackKeys[]# packs this preset turns on
- isSystem            # true for seeded presets
- companyId?          # set for company-authored presets (Phase 1: system presets only; company create allowed but optional)
  # System presets seeded from role-template.registry.ts. Company-authored presets persist as rows.

RoleCapabilityPack    # NEW join: remembers which packs authored a role (round-trip editing)
- roleId
- packKey
- @@id([roleId, packKey])
  # The role's permissionKeys (via RolePermission) stay the authorization source of truth.
  # This table only records author intent so the builder can re-open a role with the right toggles.
```

Migration adds only `RoleCapabilityPack` (and, if company-authored presets ship in Phase 1, a `RoleTemplate` table; otherwise system presets are code-seeded and no template table is needed until a later phase). Capability packs are a code registry, not a table.

## 10. Permission and Audit

New permission keys (append to `permission-registry.ts`; deny-by-default):

```text
access.capability_pack.read   LOW     # read the capability-pack catalog
access.role_template.read     LOW     # read job presets
access.role_template.manage   HIGH    # create/update company-authored presets
access.effective.read         MEDIUM  # read who-can-do-what matrix + per-employee effective access
```

Default grants (extend `ROLE_GRANTS`; OWNER already gets all via `COMPANY_PERMISSION_KEYS`):

```text
ADMIN:            access.capability_pack.read, access.role_template.read, access.role_template.manage, access.effective.read
MANAGER:          access.capability_pack.read, access.role_template.read
AUDITOR_READONLY: access.capability_pack.read, access.role_template.read, access.effective.read
(others: none)
```

New audit actions (append to `audit-action.ts`):

```text
ACCESS_ROLE_TEMPLATE_APPLY:  'access.role_template.apply'   # preset -> new role
ACCESS_ROLE_TEMPLATE_CREATE: 'access.role_template.create'
ACCESS_ROLE_TEMPLATE_UPDATE: 'access.role_template.update'
```

Existing `ACCESS_ROLE_CREATE` / `ACCESS_ROLE_UPDATE` still fire for role writes; their metadata gains `selectedPackKeys` and `resolvedPermissionKeyDelta`. Audit metadata contains pack keys and permission-key deltas only — never secrets.

## 11. API Behavior

All routes under `/v1`, extending the existing 10C controllers at `companies/:companyId/settings/*`. Server-derived company context + active-membership checks apply to all.

```text
GET  /companies/:companyId/settings/capability-packs
- Permission: access.capability_pack.read
- Returns catalog grouped by module, each pack with entitlement/lock state for THIS company
- Validation: none; read-only

GET  /companies/:companyId/settings/role-templates
- Permission: access.role_template.read
- Returns system presets + company-authored presets (with per-company entitlement lock flags)

POST /companies/:companyId/settings/role-templates            (optional in Phase 1)
- Permission: access.role_template.manage
- Body: CreateRoleTemplateInput (name, description, capabilityPackKeys)
- Audit: access.role_template.create

PATCH /companies/:companyId/settings/role-templates/:templateId   (optional in Phase 1)
- Permission: access.role_template.manage
- Audit: access.role_template.update

POST /companies/:companyId/settings/roles/preview
- Permission: access.role.read
- Body: { capabilityPackKeys?: string[]; permissionKeys?: string[]; roleTemplateKey?: string }
- Returns RolePreviewResult (compiled EffectiveAccessView) WITHOUT persisting
- Applies entitlement + granter-scope filtering; marks dropped/locked keys with reasons
- Idempotent, no writes

POST /companies/:companyId/settings/roles           (EXTEND existing 10C endpoint)
- Permission: access.role.manage
- Body: CreateRoleInput + optional capabilityPackKeys + optional roleTemplateKey
- Behavior: compile -> filter -> create Role + RolePermission + RoleCapabilityPack in one tx
- Audit: access.role.create (+ access.role_template.apply if from a preset)

PATCH /companies/:companyId/settings/roles/:roleId   (EXTEND existing 10C endpoint)
- Permission: access.role.manage
- Body: UpdateRoleInput + optional capabilityPackKeys
- Behavior: recompile; replace RolePermission + RoleCapabilityPack; block on system roles (403)
- Audit: access.role.update

GET  /companies/:companyId/settings/effective-access
- Permission: access.effective.read
- Returns CompanyAccessMatrix (all active memberships x capability summary), masked
- Supports pagination/filter by role/name

GET  /companies/:companyId/settings/employees/:employeeId/effective-access
- Permission: access.effective.read (or access.employee.read for own-team later)
- Returns EffectiveAccessView for one employee
```

Error cases: missing permission `403`; system-role edit `403`; unknown pack/template key `422`; entitlement-emptied result on save `422` with reason; cross-company `404`.

## 12. UI Behavior

### Web (Settings > Roles, extends existing `EmployeeAccessPages.tsx`)

- **Main screen:** role list gains a human-readable capability summary chip row per role ("ขายได้ • เห็นสต๊อก • รับชำระเงิน").
- **Guided builder (create/edit role):**
  - Step 1 — **Start from:** Job preset picker (grouped by industry tag) | Blank.
  - Step 2 — **Capability packs:** toggles grouped by area (ขาย, บิล/เอกสาร, สต๊อก, การเงิน, ภาษี, บัญชี, จัดซื้อ, ค่าใช้จ่าย, เบิกจ่าย, คน/สิทธิ์, ระบบ). Each toggle shows Thai name + one-line description + a risk badge (สูง/วิกฤติ). Non-entitled packs render locked with reason; packs beyond the granter's own permissions render disabled with reason.
  - Step 3 — **Advanced (collapsed):** the existing raw permission-key grid grouped by module, for power users; stays in sync with pack toggles.
  - **Live preview panel:** "คนนี้จะทำอะไรได้บ้าง" — effective capabilities grouped by area, high-risk items flagged, count of permissions, and a "what changed" delta on edit.
- **Who-can-do-what matrix (Settings > Roles > ภาพรวมสิทธิ์):** table of active employees × capability areas with role chips; drill into one person's EffectiveAccessView.
- **Loading/cover loader:** builder and matrix show skeletons; preview debounced.
- **Empty/error/forbidden/readonly:** system roles read-only badge; forbidden shows 403 message; empty entitlement result blocks save with guidance; preview error is non-blocking (retry).
- **Admin actions:** apply preset, save role, open matrix. No destructive actions beyond existing 10C role disable.

### LINE/LIFF

- No Phase 1 surface. (Phase 6 adds read-only "explain my access".)

## 13. Edge Cases

- Company loses a feature entitlement after a role already holds those keys → keys remain on the role until next edit; matrix flags them as "granted but not entitled"; recompile on edit drops them.
- Admin edits a role that contains keys above the admin's own permissions (e.g. created by owner) → admin can keep existing keys but cannot add new above-scope packs; removing is always allowed.
- Preset references a pack later removed from the registry → unknown pack keys are ignored on apply with a surfaced warning.
- Two admins edit the same role concurrently → last-write-wins on `RolePermission`/`RoleCapabilityPack`; audit records both.
- Legacy `admin.user.*`/`admin.role.*` keys appear in the advanced grid? → excluded from packs and hidden by default (documented legacy), never produced by presets.
- Role built entirely from packs then edited only in the advanced grid → `RoleCapabilityPack` may not fully round-trip; builder shows "custom (edited beyond packs)" and preserves raw keys as source of truth.

## 14. Acceptance Criteria

- [ ] An owner creates a working role by picking a job preset in under a minute without opening the raw permission grid.
- [ ] Capability-pack toggles compile to exactly the documented permission keys (Appendix A), verified by test.
- [ ] Live preview shows correct effective capabilities and flags high-risk items before save.
- [ ] Feature-entitlement filtering hides/locks non-entitled packs and drops their keys from compilation (first real enforcement).
- [ ] An admin cannot grant a pack exceeding their own effective permissions; owner can.
- [ ] System roles remain read-only; `OWNER`/`SYSTEM_ADMIN` are never producible; last-owner protection intact.
- [ ] Who-can-do-what matrix renders every active employee's effective capabilities, masked, permission-gated by `access.effective.read`.
- [ ] Role create/update audits selected pack keys + permission-key delta without secrets.
- [ ] Backward compatible: existing item 10C roles/grants/employees keep working unchanged.

## 15. Test Cases

- **Unit:** pack→keys expansion for every pack; preset→packs→keys; max-riskLevel derivation; entitlement filter; granter-scope intersection; delta computation.
- **Integration:** `POST /roles` from preset creates Role+RolePermission+RoleCapabilityPack in one tx; `PATCH` recompiles; `preview` never writes; matrix pagination.
- **Permission:** each endpoint returns `403` without its key; system-role edit `403`; effective matrix hidden without `access.effective.read`.
- **UI:** builder toggles ↔ advanced grid sync; locked-pack rendering; preview delta; readonly system role; forbidden/empty states.
- **Edge:** non-entitled-after-grant flag; admin above-scope block; unknown pack key ignored; concurrent edit last-write-wins.
- **Regression:** 10C role create/disable, protected-role 403, employee create/assign still pass.

## 16. Open Questions

- Persist company-authored presets in Phase 1 (`RoleTemplate` table) or defer to a later phase and ship system presets only? (Lean: system presets code-seeded now; company-authored `POST/PATCH` optional, table added only if pulled in.)
- Exact `CompanyFeatureEntitlement` shape to key packs against — confirm in Phase 0 discovery against the 10A implementation.
- Should the advanced raw-key grid stay visible to Admin, or Owner-only, to keep the surface simple?

---

## Appendix A — Capability Pack Catalog (implement-ready)

Curated bundles over the existing `permission-registry.ts` keys plus the explicitly planned Feature Entitlement Decoupling v5 additive keys. `Risk` = max risk among the pack's keys. `Entitlement` names the `CompanyFeatureEntitlement` gate (— = always on). v5 packs remain unavailable/fail closed until their permission expand migration lands. `pack.core.basics` is `isCore` (auto-applied to every role).

### Foundation

| Pack key | ไทย | English | Risk | Entitlement | Permission keys |
|---|---|---|---|---|---|
| `pack.core.basics` | พื้นฐาน (ทุกคน) | Core basics | MEDIUM | — | account.session.read, account.password.change, account.identity.link, account.identity.unlink, notification.read, notification.preference.manage, dashboard.read, attachment.read, company.branch.read, ai.tool.invoke, line.ai.query, accounting.document.read_related (ยังถูก gate ด้วย sales_documents) |
| `pack.workflow.tasks` | งานที่ได้รับมอบหมาย | My tasks | MEDIUM | workflow | workflow.task.read, workflow.task.work |

### Company setup & administration

| Pack key | ไทย | English | Risk | Entitlement | Permission keys |
|---|---|---|---|---|---|
| `pack.company.settings.view` | ดูตั้งค่าบริษัท | View company setup | LOW | — | company.setup.read, company.branch.read, document.sequence.read, company.vat_registration.read |
| `pack.company.settings.manage` | จัดการตั้งค่าบริษัท | Manage company setup | HIGH | — | company.setup.manage, company.branch.manage, document.sequence.manage, company.vat_registration.read, company.vat_registration.manage, attachment.create, attachment.delete, outbox.event.read |
| `pack.company.vat_registration.manage` | จัดการสถานะจด VAT | Manage VAT registration fact | HIGH | — | company.vat_registration.read, company.vat_registration.manage |
| `pack.people.view` | ดูพนักงานและสิทธิ์ | View people & roles | LOW | — | access.employee.read, access.role.read, access.permission.read, access.capability_pack.read, access.role_template.read, access.effective.read |
| `pack.people.manage` | จัดการพนักงานและสิทธิ์ | Manage people & roles | CRITICAL | — | access.employee.create, access.employee.update, access.employee.disable, access.employee.credential.issue, access.employee.line_link.issue, access.employee.line_link.revoke, access.role.manage, access.role_template.manage |
| `pack.audit.read` | ดูบันทึกการใช้งาน (audit) | Read audit log | MEDIUM | — | audit.log.read, workflow.audit.read |
| `pack.dashboard.manage` | ปรับแต่งแดชบอร์ด | Configure dashboard | MEDIUM | — | dashboard.configure, dashboard.snapshot.generate |
| `pack.notification.admin` | จัดการแจ้งเตือน (แอดมิน) | Notification admin | HIGH | — | notification.rule.manage, notification.delivery.read, notification.delivery.retry |
| `pack.workflow.view` | ดูออโตเมชัน | View automation | MEDIUM | workflow | workflow.template.read, workflow.rule.read, workflow.run.read, workflow.dead_letter.read, workflow.audit.read |
| `pack.workflow.manage` | จัดการออโตเมชัน | Manage automation | CRITICAL | workflow | workflow.rule.manage, workflow.rule.enable, workflow.run.replay, workflow.dead_letter.replay, workflow.webhook.manage |

`pack.people.view` and `pack.people.manage` remain independently composable. An employee creator/editor
or role manager may read the minimum role/address/catalog data required to complete that exact action via
equivalent-authority OR guards. This does not imply `access.employee.read`: the role page does not load the
company employee list without that key, and the employee overview/list routes remain read-gated.

### Products & inventory

| Pack key | ไทย | English | Risk | Entitlement | Permission keys |
|---|---|---|---|---|---|
| `pack.inventory.view` | ดูสินค้าและสต๊อก | View products & stock | LOW | inventory | inventory.product.read, inventory.location.read, inventory.movement.read, inventory.report.read |
| `pack.inventory.operate` | รับ-จ่ายสต๊อก | Operate stock | MEDIUM | inventory | inventory.product.manage, inventory.location.manage, inventory.movement.create, inventory.label.manage |
| `pack.inventory.adjust` | ปรับ/นับสต๊อก | Adjust & count stock | HIGH | inventory | inventory.movement.adjust, inventory.stock_count.create |

### Sales & customers (CRM)

| Pack key | ไทย | English | Risk | Entitlement | Permission keys |
|---|---|---|---|---|---|
| `pack.crm.view` | ดูลูกค้าและไปป์ไลน์ | View customers & pipeline | LOW | crm | crm.customer.read, crm.contact.read, crm.lead.read, crm.opportunity.read, crm.activity.read, crm.follow_up.read, crm.report.read, crm.ai.read |
| `pack.crm.operate` | ทำงานขายรายวัน | Work sales daily | MEDIUM | crm | crm.customer.create, crm.customer.update, crm.contact.manage, crm.lead.create, crm.lead.update, crm.lead.convert, crm.lead.disqualify, crm.opportunity.create, crm.opportunity.update, crm.opportunity.stage_move, crm.opportunity.close, crm.activity.create, crm.follow_up.create, crm.follow_up.update, crm.follow_up.complete, crm.quotation.link |
| `pack.crm.manage` | จัดการลูกค้า/ไปป์ไลน์ | Manage customers & pipeline | HIGH | crm | crm.customer.archive, crm.customer.assign, crm.customer.export, crm.lead.assign, crm.opportunity.reopen, crm.pipeline.configure |

### Quotations & selling documents

| Pack key | ไทย | English | Risk | Entitlement | Permission keys |
|---|---|---|---|---|---|
| `pack.quotation.operate` | ทำใบเสนอราคา | Work quotations | MEDIUM | accounting | accounting.counterparty.read, accounting.quotation.read, accounting.quotation.create, accounting.quotation.update, accounting.quotation.submit_approval, accounting.quotation.issue |
| `pack.quotation.approve` | อนุมัติใบเสนอราคา | Approve quotations | HIGH | accounting | accounting.quotation.approve, accounting.quotation.void |

### Billing & documents

| Pack key | ไทย | English | Risk | Entitlement | Permission keys |
|---|---|---|---|---|---|
| `pack.billing.view` | ดูบิล/ใบเสร็จ/ใบกำกับ | View billing docs | LOW | accounting | accounting.counterparty.read, accounting.document.read, accounting.invoice.read, accounting.receipt.read, accounting.billing_note.read, accounting.credit_note.read, accounting.debit_note.read, accounting.tax_invoice.read |
| `pack.billing.operate` | ออกร่างเอกสารขาย | Draft billing docs | MEDIUM | accounting | accounting.counterparty.manage, accounting.document.create, accounting.document.update, accounting.invoice.create, accounting.invoice.update, accounting.receipt.create, accounting.receipt.update, accounting.billing_note.create, accounting.billing_note.update, accounting.credit_note.create, accounting.debit_note.create |
| `pack.billing.issue` | ออกจริง/ยกเลิกเอกสาร | Issue & void billing docs | HIGH | accounting | accounting.document.issue, accounting.document.void, accounting.document.export, accounting.invoice.issue, accounting.invoice.void, accounting.receipt.issue, accounting.receipt.void, accounting.billing_note.issue, accounting.billing_note.void, accounting.credit_note.issue, accounting.credit_note.void, accounting.debit_note.issue, accounting.debit_note.void |
| `pack.tax_invoice.issue` | ออก/ยกเลิกใบกำกับภาษี | Issue & void tax invoices | CRITICAL | accounting | accounting.tax_invoice.issue, accounting.tax_invoice.void |
| `pack.payment.view` | ดูการรับชำระ | View payments | LOW | accounting | accounting.payment.read |
| `pack.payment.record` | รับชำระเงิน | Record payments | HIGH | accounting | accounting.payment.create, accounting.payment.update |
| `pack.payment.void` | ยกเลิกการรับชำระ | Void payments | CRITICAL | accounting | accounting.payment.void |

### Expenses

| Pack key | ไทย | English | Risk | Entitlement | Permission keys |
|---|---|---|---|---|---|
| `pack.expense.self` | บันทึกค่าใช้จ่ายของฉัน | Capture own expenses | MEDIUM | expense | expense.read_own, expense.create, expense.receipt.upload, expense.receipt.line_upload, expense.update, expense.ocr.request, expense.signature.self_manage, attachment.create |
| `pack.expense.review` | ตรวจค่าใช้จ่าย | Review expenses | HIGH | expense | expense.read, expense.evidence.read, expense.read_own, expense.review, expense.ai.verify, expense.category.manage, expense.duplicate.resolve, attachment.create |
| `pack.expense.finance` | อนุมัติ/จ่ายค่าใช้จ่าย | Confirm & pay expenses | CRITICAL | expense | expense.confirm, expense.reject, expense.void, expense.delete, expense.payment.record, expense.export |

### Reimbursement

| Pack key | ไทย | English | Risk | Entitlement | Permission keys |
|---|---|---|---|---|---|
| `pack.reimbursement.self` | ขอเบิกของฉัน | Request own reimbursement | MEDIUM | reimbursement | reimbursement.read_own, reimbursement.create, reimbursement.update_own_draft, reimbursement.submit, reimbursement.cancel_own |
| `pack.reimbursement.approve` | อนุมัติการเบิก | Approve reimbursement | HIGH | reimbursement | reimbursement.read, reimbursement.read_own, reimbursement.approve, reimbursement.reject |
| `pack.reimbursement.review` | ตรวจสอบการเบิก | Review reimbursement | HIGH | reimbursement | reimbursement.read, reimbursement.read_own, reimbursement.read_related, reimbursement.finance_review, reimbursement.export |
| `pack.reimbursement.finance` | ตรวจ/จ่ายการเบิก | Finance review & pay | CRITICAL | reimbursement | reimbursement.read, reimbursement.read_own, reimbursement.finance_review, reimbursement.payment.record, reimbursement.payment.void, reimbursement.duplicate.resolve, reimbursement.export |
| `pack.reimbursement.policy` | ตั้งนโยบายการเบิก | Manage reimbursement policy | HIGH | reimbursement | reimbursement.policy.read, reimbursement.policy.manage |

### Procurement & accounts payable

| Pack key | ไทย | English | Risk | Entitlement | Permission keys |
|---|---|---|---|---|---|
| `pack.procurement.view` | ดูจัดซื้อ/เจ้าหนี้ | View procurement & AP | LOW | procurement | procurement.supplier.read, procurement.purchase_request.read, procurement.purchase_order.read, procurement.goods_receipt.read, procurement.vendor_bill.read, procurement.supplier_payment.read, procurement.ap.report |
| `pack.procurement.request` | ขอซื้อ/รับของ | Request purchases & receive | MEDIUM | procurement | procurement.purchase_request.create, procurement.purchase_order.create, procurement.goods_receipt.create |
| `pack.procurement.approve` | อนุมัติจัดซื้อ | Approve procurement | HIGH | procurement | procurement.purchase_request.approve, procurement.purchase_order.approve, procurement.purchase_order.issue, procurement.vendor_bill.approve |
| `pack.procurement.ap_manage` | จัดการเจ้าหนี้/จ่ายเงิน | Manage AP & pay suppliers | CRITICAL | procurement | procurement.supplier.manage, procurement.purchase_order.manage, procurement.goods_receipt.post, procurement.goods_receipt.void, procurement.vendor_bill.create, procurement.vendor_bill.direct_entry, procurement.vendor_bill.void, procurement.vendor_bill.match, procurement.supplier_payment.create, procurement.supplier_payment.void |
| `pack.procurement.supplier_bank` | ดู/แก้บัญชีธนาคารผู้ขาย | Supplier bank details | CRITICAL | procurement | procurement.supplier.bank.read, procurement.supplier.bank.manage, procurement.vendor_bill.match.override |

### Banking & reconciliation

| Pack key | ไทย | English | Risk | Entitlement | Permission keys |
|---|---|---|---|---|---|
| `pack.cash.view` | ดูยอดเงินสด | View cash position | LOW | banking | bank.cash.read |
| `pack.bank.view` | ดูธนาคาร/กระทบยอด | View banking | LOW | banking | bank.account.read, bank.statement.read, bank.match.read, bank.adjustment.read, bank.reconciliation.read, bank.cash.read |
| `pack.bank.operate` | นำเข้า/จับคู่รายการ | Import & match | HIGH | banking | bank.account.manage, bank.statement.import, bank.statement.manual_line, bank.match.suggest, bank.match.confirm, bank.match.unmatch, bank.adjustment.create, bank.reconciliation.create |
| `pack.bank.reconcile_manage` | ปิด/เปิดกระทบยอด | Complete & reopen reconciliation | CRITICAL | banking | bank.statement.void, bank.match.override, bank.adjustment.approve, bank.adjustment.void, bank.reconciliation.complete, bank.reconciliation.reopen, bank.reconciliation.export |
| `pack.bank.sensitive` | ดูข้อมูลบัญชีเชิงลึก | Read sensitive bank fields | HIGH | banking | bank.account.sensitive_read |

### Accounting core (ledger)

| Pack key | ไทย | English | Risk | Entitlement | Permission keys |
|---|---|---|---|---|---|
| `pack.ledger.view` | ดูบัญชีแยกประเภท/งบ | View GL & reports | LOW | ledger | ledger.account.read, ledger.journal.read, ledger.posting-rule.read, ledger.report.read, ledger.period.read, ledger.export |
| `pack.ledger.operate` | ลงรายการบัญชีร่าง | Draft journal entries | MEDIUM | ledger | journal.entry.create |
| `pack.ledger.manage` | ปิดงวด/ผังบัญชี | Post, close & manage ledger | CRITICAL | ledger | ledger.account.manage, journal.entry.post, journal.entry.reverse, ledger.posting-rule.manage, ledger.period.close, ledger.period.unclose |

### Tax

| Pack key | ไทย | English | Risk | Entitlement | Permission keys |
|---|---|---|---|---|---|
| `pack.wht.certificate.manage` | จัดการ 50 ทวิจากรายการจ่าย | Manage payment-linked 50 bis | HIGH | — | wht.certificate.read, wht.certificate.prepare, wht.certificate.correct, wht.external_certificate.link |
| `pack.finance.vat.review` | ตรวจสถานะ/การลงบัญชี VAT | Review VAT accounting facts | HIGH | — | finance.vat.review |
| `pack.vat.credit_outcome.correct` | แก้ผลลัพธ์เครดิต VAT เดิม | Correct retained VAT credit outcome | HIGH | — | vat.credit_outcome.correct |
| `pack.tax.view` | ดูภาษี/รายงาน | View tax & reports | LOW | tax | tax.profile.read, tax.config.read, tax.period.read, tax.event.read, tax.report.read, tax.certificate.read, tax.review_issue.read |
| `pack.tax.prepare` | เตรียม/ยื่นภาษี | Prepare & file tax | HIGH | tax | tax.event.sync, tax.report.recompute, tax.report.export, tax.filing.mark_filed, tax.filing.mark_paid, tax.certificate.issue, tax.certificate.void, tax.review_issue.resolve, tax.adjustment.create |
| `pack.tax.manage` | ตั้งค่าภาษี/แก้งวด | Manage tax config & periods | CRITICAL | tax | tax.profile.manage, tax.config.manage, tax.period.manage |

Feature Entitlement Decoupling Spec v5 supersedes only the 50 ทวิ portion of `pack.tax.prepare`: after its permission expansion, `tax.certificate.issue|void` are compatibility aliases and must not authorize direct issue/void. `pack.wht.certificate.manage` has no sellable-feature entitlement because the same operator may discover/read a handoff or repair an exact retained artifact after a source feature is OFF; every route still requires current supplier/expense payment visibility **or** exact retained pre-cutoff handoff/legal-artifact authority, tenant/branch scope and the narrow key. `pack.finance.vat.review` likewise requires current source/Ledger visibility **or exact retained pre-disable source/VAT-resolution/projection authority**; retained mode is cutoff/hash scoped, masks unrelated source detail, permits only exact-root repair and cannot create a Tax contribution unless Tax is on. `pack.vat.credit_outcome.correct` is a separate entitlement-free HIGH-risk correction-only pack for an exact retained pre-disable VAT refund/external-transition outcome pinned by outcome/root hash plus cutoff; it cannot create a new Tax root, report, filing or contribution, and Tax-on final application continues to require `tax.adjustment.create|approve`. Its default grant/preset policy is OWNER/ACCOUNTANT only; the broad Finance role and Finance preset never receive it. These packs grant neither ordinary source access nor `thai_tax`, and permission-prefix filtering must not place `wht.*`, `finance.vat.review`, `vat.credit_outcome.correct` or `company.vat_registration.*` under the Tax entitlement. The same expand migration adds `tax.adjustment.approve` to an OWNER/ACCOUNTANT-only approval policy (not `pack.tax.prepare`); its route fails closed until seeded.

**Legacy note:** `admin.user.read`, `admin.user.manage`, `admin.role.read`, `admin.role.manage` (item 02) are intentionally **not** in any pack — superseded by `access.*`; hidden from the builder by default. `system.*` keys are platform-scoped and excluded from all company packs.

## Appendix B — Job Preset (RoleTemplate) definitions

Every preset auto-includes `pack.core.basics` + `pack.workflow.tasks`. Presets compile to company custom roles (never system roles). `crosscutting` presets map closely to existing seeded roles for consistency; niche presets are finer-grained combos that no system role provides today.

`accounting.document.read_related` is carried by the core pack so every related member can reach source-owned record ABAC.
It is an explicit exception to the core pack's always-on label: the runtime prefix gate removes it unless
`sales_documents` is enabled, and the accounting source returns only records linked to that caller inside tenant/branch scope.

### Cross-cutting

| Preset key | ไทย | English | Packs (beyond core) |
|---|---|---|---|
| `tpl.x.readonly` | อ่านอย่างเดียว/ผู้ตรวจสอบ | Read-only / Auditor | pack.people.view, pack.audit.read, pack.inventory.view, pack.crm.view, pack.billing.view, pack.payment.view, pack.expense.review(read subset via view)*, pack.procurement.view, pack.bank.view, pack.ledger.view, pack.tax.view |
| `tpl.x.accounting` | บัญชี/ผู้ทำบัญชี | Bookkeeper / Accountant | pack.company.settings.view, pack.company.vat_registration.manage, pack.billing.view, pack.payment.view, pack.ledger.manage, pack.tax.manage, pack.finance.vat.review, pack.wht.certificate.manage, pack.vat.credit_outcome.correct, pack.bank.reconcile_manage, pack.expense.review, pack.reimbursement.review, pack.procurement.view, pack.audit.read |
| `tpl.x.marketing` | การตลาด | Marketing | pack.crm.view, pack.dashboard.manage |
| `tpl.x.manager` | ผู้จัดการ | Manager | pack.crm.manage, pack.quotation.approve, pack.billing.view, pack.payment.view, pack.inventory.view, pack.expense.review, pack.reimbursement.approve, pack.procurement.approve, pack.cash.view, pack.dashboard.manage, pack.people.view, pack.tax.view, pack.ledger.view |
| `tpl.x.finance` | การเงิน (AR/AP) | Finance | pack.company.settings.view, pack.billing.operate, pack.billing.issue, pack.payment.record, pack.payment.void, pack.bank.operate, pack.procurement.ap_manage, pack.tax.prepare, pack.finance.vat.review, pack.wht.certificate.manage, pack.ledger.operate, pack.expense.finance, pack.reimbursement.finance |

*Read-only preset uses view-tier packs only; `pack.expense.review` is replaced by an expense read via `pack.billing.view`/audit where a dedicated `expense read` view is needed — confirm whether to add a `pack.expense.view` (read-only) during Phase 0 (recommended, so the read-only preset never pulls a mutate-capable pack).

### Retail

| Preset key | ไทย | English | Packs (beyond core) |
|---|---|---|---|
| `tpl.retail.cashier` | แคชเชียร์ | Cashier | pack.billing.operate, pack.billing.issue, pack.payment.record, pack.inventory.view, pack.crm.view |
| `tpl.retail.sales` | พนักงานขาย | Sales staff | pack.crm.operate, pack.quotation.operate, pack.billing.view, pack.inventory.view, pack.expense.self, pack.reimbursement.self |
| `tpl.retail.stock` | พนักงานคลัง | Stock staff | pack.inventory.operate, pack.inventory.adjust, pack.procurement.request, pack.expense.self, pack.reimbursement.self |
| `tpl.retail.store_manager` | ผู้จัดการร้าน | Store manager | = `tpl.x.manager` packs |

### Trading

| Preset key | ไทย | English | Packs (beyond core) |
|---|---|---|---|
| `tpl.trading.sales` | ฝ่ายขาย | Sales | pack.crm.operate, pack.quotation.operate, pack.billing.view, pack.inventory.view, pack.expense.self, pack.reimbursement.self |
| `tpl.trading.purchasing` | ฝ่ายจัดซื้อ | Purchasing | pack.procurement.view, pack.procurement.request, pack.inventory.view, pack.crm.view, pack.expense.self |
| `tpl.trading.inventory` | คลังสินค้า | Warehouse | pack.inventory.operate, pack.inventory.adjust, pack.procurement.request, pack.expense.self, pack.reimbursement.self |
| `tpl.trading.finance` | การเงิน/บัญชีเจ้าหนี้ | Finance/AP | = `tpl.x.finance` packs |

### Service

| Preset key | ไทย | English | Packs (beyond core) |
|---|---|---|---|
| `tpl.service.front_desk` | หน้าร้าน/ต้อนรับ | Front desk | pack.crm.operate, pack.billing.operate, pack.payment.record, pack.reimbursement.self |
| `tpl.service.sales` | ฝ่ายขาย/CRM | Sales / CRM | pack.crm.operate, pack.quotation.operate, pack.billing.view, pack.expense.self, pack.reimbursement.self |
| `tpl.service.finance` | การเงิน | Finance | = `tpl.x.finance` packs |
| `tpl.service.manager` | ผู้จัดการ | Manager | = `tpl.x.manager` packs |

### E-commerce

| Preset key | ไทย | English | Packs (beyond core) |
|---|---|---|---|
| `tpl.ecom.order_ops` | จัดการออเดอร์ | Order operations | pack.crm.operate, pack.billing.operate, pack.billing.issue, pack.payment.record, pack.inventory.view |
| `tpl.ecom.fulfillment` | แพ็ก/ส่งของ | Fulfillment | pack.inventory.operate, pack.inventory.adjust, pack.procurement.request, pack.expense.self |
| `tpl.ecom.finance` | การเงิน | Finance | = `tpl.x.finance` packs |
| `tpl.ecom.marketing` | การตลาดออนไลน์ | Online marketing | = `tpl.x.marketing` packs |

## Appendix C — Contract additions (`packages/contracts/src/employee-access.ts`)

Extend the existing 10C module; do not fork.

```ts
export type CapabilityPack = {
  key: string;
  module: string;
  nameTh: string;
  nameEn: string;
  description: string;
  permissionKeys: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  featureEntitlementKey?: string;
  isCore: boolean;
};

export type CapabilityPackCatalog = {
  modules: Array<{ module: string; packs: CapabilityPackView[] }>;
};

export type CapabilityPackView = CapabilityPack & {
  locked: boolean;          // not entitled for this company
  lockReason?: string;
  grantableByCurrentUser: boolean; // false if pack exceeds granter's own permissions
};

export type RoleTemplate = {
  key: string;
  nameTh: string;
  nameEn: string;
  description: string;
  industryTag?: 'retail' | 'trading' | 'service' | 'ecommerce' | 'crosscutting';
  capabilityPackKeys: string[];
  isSystem: boolean;
};

export type EffectivePermission = {
  key: string;
  module: string;
  description: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
};

export type EffectiveCapability = {
  packKey: string;
  nameTh: string;
  nameEn: string;
  enabled: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
};

export type EffectiveAccessView = {
  membershipId?: string;
  displayName?: string;
  roleKeys: string[];
  capabilities: EffectiveCapability[];
  permissions: EffectivePermission[];
  permissionCount: number;
};

export type RolePreviewInput = {
  capabilityPackKeys?: string[];
  permissionKeys?: string[];
  roleTemplateKey?: string;
};

export type RolePreviewResult = EffectiveAccessView & {
  droppedKeys: Array<{ key: string; reason: 'not_entitled' | 'above_granter_scope' | 'unknown' }>;
  addedVsCurrent?: string[];   // when editing an existing role
  removedVsCurrent?: string[];
};

export type CompanyAccessMatrixRow = {
  membershipId: string;
  displayName: string;
  roleKeys: string[];
  capabilitySummary: string[]; // human-readable pack nameTh list
  highRiskCount: number;
};

export type CompanyAccessMatrix = {
  rows: CompanyAccessMatrixRow[];
  total: number;
};

// EXTEND existing 10C inputs (additive, optional fields keep BC):
export type CreateRoleInput = {
  name: string;
  description?: string;
  permissionKeys: string[];          // existing
  capabilityPackKeys?: string[];     // NEW
  roleTemplateKey?: string;          // NEW (apply preset)
};

export type UpdateRoleInput = {
  name?: string;
  description?: string;
  permissionKeys?: string[];         // existing
  capabilityPackKeys?: string[];     // NEW
};
```
