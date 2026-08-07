# Feature: Mangmee System UI Alignment

## 1. Status

- Roadmap/checklist item: Cross-cutting web UI alignment.
- Owner: Web platform and feature module owners.
- Date: 2026-07-07.
- Implementation state: First production pass implemented, then refined against the second design screenshot for company dashboard/sidebar/header/menu parity, permissions matrix parity, individual permissions parity, PO approval settings visual parity, and shared interactive accent parity across current web features.

## 2. Goal

ปรับหน้าจอใน WatchDog-BMS ให้ใช้ visual language เดียวกับต้นแบบ HTML ของระบบมั่งมี โดยยังคงสถาปัตยกรรมของ repo ปัจจุบันไว้ ได้แก่ company-scoped route, permission-aware navigation, API client ต่อ feature, shared design tokens, และ component reuse

เป้าหมายคือให้ทีมสามารถพัฒนาหน้าอื่นต่อได้โดยไม่ต้องเดาสี ระยะห่าง ปุ่ม ตาราง การ์ด ไอคอน หรือโครงหน้าใหม่เองทุกครั้ง

## 3. Source Docs

- Visual source: `/Users/bombam/Downloads/มั่งมี-ระบบทั้งหมด (เปิดได้ทุกเครื่อง).html`
- Handoff source: `../design_handoff_mangmee/README.md`
- Route reference: `../design_handoff_mangmee/routes.md`
- API contract reference: `../design_handoff_mangmee/api.ts`
- Permission reference: `../design_handoff_mangmee/permissions.ts`
- Related specs:
  - `docs/specs/web-core-workspace-spec.md`
  - `docs/specs/dashboard-notification-spec.md`
  - `docs/specs/accounting-documents-spec.md`
  - `docs/specs/tax-thailand-2026-spec.md`
  - `docs/specs/employee-access-role-management-spec.md`
  - `docs/specs/forgot-password-reset-spec.md`
- Permission matrix: `docs/specs/permission-matrix.md`

## 4. Non-goals

- ไม่ copy HTML prototype ทั้งก้อนเข้าระบบ production
- ไม่เปลี่ยน route model จาก `/companies/[companyId]/...` เป็น route แบบ prototype โดยตรง
- ไม่ทำ fake mutation หรือ fake success สำหรับ feature ที่ backend/API ยังไม่รองรับ
- อนุญาตให้เปิด planned route แบบ read-only/placeholder ได้เมื่อ route อยู่ใน company shell, มี permission gate ชัดเจน, และ copy ไม่หลอกว่า feature พร้อมใช้งานเต็มรูปแบบ
- ไม่แทนที่ auth/session/RBAC enforcement ฝั่ง backend
- ไม่ย้าย business mutation ไปอยู่บน client หรือ UI-only logic
- ไม่ทำ dark mode ใน phase นี้

## 5. User Roles

- Owner: เห็นภาพรวมธุรกิจ, เข้าถึงโมดูลหลัก, ตั้งค่าระบบ, อนุมัติและตรวจรายงาน
- Admin: จัดการ company, branch, role, user, permission และ setup
- Manager: ติดตามคิวงาน, approval, dashboard, report และ exception
- Staff: ใช้โมดูลที่ได้รับสิทธิ์ เช่น inventory, expense, CRM, procurement
- Accountant or finance: ใช้ accounting, tax, AP, banking, reimbursement และ report
- Auditor: อ่านข้อมูลและรายงานตามสิทธิ์ โดยไม่มี mutation

## 6. Business Journey

1. ผู้ใช้ sign in และเลือก company/branch scope
2. ระบบโหลด shell ที่มี sidebar, header, branch switcher, profile menu และ content area แบบ responsive
3. Sidebar แสดงเฉพาะเมนูที่ผู้ใช้มีสิทธิ์ตาม permission registry
4. ผู้ใช้เข้าหน้า dashboard หรือโมดูลที่ต้องทำงาน
5. หน้าแต่ละโมดูลใช้ `MangmeePage` สำหรับ page chrome และใช้ shared class/component สำหรับ card, table, form, badge, stat และ action
6. ถ้าโมดูลมี API รองรับแล้วให้แสดงเป็น ready และเรียก API client ของ feature นั้น
7. ถ้าโมดูลยังไม่มี API หรือ backend contract ให้แสดง planned/placeholder ที่ชัดเจนและไม่สร้าง mutation หลอก
8. Mutation ทุกจุดยังต้องผ่าน backend validation, permission, audit และ error handling ของ feature นั้น

## 7. Business Rules

- สีหลักของระบบคือ brand green ตาม prototype: `#12B76A`, `#027A48`, `#059669`
- พื้นหลัง workspace ใช้ gray-50 และ surface สีขาวแบบมี border/shadow เบา
- Sidebar expanded กว้าง 289px และ collapsed กว้าง 86px ตาม design screenshot ล่าสุด
- Header สูง 68px และต้องรองรับ branch selector, notification, profile menu แบบ compact
- Company dashboard content ต้องเริ่มใกล้ sidebar และใช้ full-width workspace padding ไม่ center max-width แบบหน้า marketing
- Text ต้องไม่ล้น container ใน desktop และ mobile
- Component ที่ใช้ซ้ำต้องอยู่ใน common layer หรือ design token layer ไม่กระจายเป็น style เฉพาะหน้า
- Icon tone ต้อง map จาก module key/group ผ่าน helper เดียวเพื่อให้ sidebar, tile, card ใช้สีเดียวกัน
- หน้า Login ยังคง public entry `Forgot password?`; authenticated reset entry อยู่ใน profile menu เป็น `Reset password`
- กลุ่ม `ตั้งค่าระบบ` ต้องแสดง `สิทธิ์การใช้งาน` เป็น parent ที่เปิดเมนูย่อยได้ และมี child rows ครบตาม design: `รายบุคคล`, `เพิ่มพนักงาน`, `อนุมัติคำสั่งซื้อ`, `นโยบายส่วนลด`, `การแจ้งเตือน`
- เมื่ออยู่หน้า child settings เช่น `อนุมัติคำสั่งซื้อ` ต้อง active เฉพาะ child row นั้น และ parent ต้องเปิดอยู่โดยไม่กลายเป็น active row ซ้ำ
- Child `รายบุคคล` ต้องเปิดหน้า `สิทธิ์รายบุคคล` ที่ `/settings/access-overview`; parent `สิทธิ์การใช้งาน` ที่ `/settings/permissions` ยังเป็น role permission matrix

## 8. Boundary and Ownership

- Web owns:
  - Design token usage
  - Shared Mangmee components
  - Responsive shell and workspace page chrome
  - Permission-aware navigation display
  - Client-side empty/loading/error/forbidden presentation
- Backend/API owns:
  - Auth/session validity
  - Company/branch scope verification
  - Permission and ABAC enforcement
  - Source-of-truth validation
  - Mutation, audit log, and persistence
- Feature modules own:
  - Domain-specific field, table, validation, API client, and business copy
  - Feature-specific unit tests
- Out of boundary:
  - Copying prototype mock data as production fixtures
  - Enabling unsupported prototype routes without backend work

## 9. Data Model Draft

This feature does not introduce a new domain data model.

Shared UI model:

- `MangmeeTone`
  - Purpose: stable tone names for icon frames and badges
  - Source of truth: `apps/web/src/common/components/mangmee/mangmee-design.ts`
- Module visual mapping
  - Purpose: map workspace module key or nav group to UI tone
  - Source of truth: `getMangmeeMenuTone`
- Design token output
  - Purpose: expose brand, gray, status, radius, and shadow tokens to CSS
  - Source of truth: `packages/design-tokens/tokens.json`

## 10. Permission and Audit

- Read permission: Existing workspace module permission registry remains source for menu visibility
- Create/update permission: Feature pages must keep using their existing API permission contracts
- Approve/export/admin permission: Must stay feature-specific and backend-enforced
- ABAC/ownership rules: Backend remains final authority for company, branch, and role scope
- Sensitive actions to audit: No new sensitive mutation introduced by this UI alignment pass
- Seeded company-view role: `COMPANY_VIEW` เป็น compact system role สำหรับ local company mock account โดยให้เฉพาะ read/menu permissions ที่ใช้กับ Mangmee company shell และไม่ให้ `system.*` platform permissions

## 11. API Behavior

- Existing supported modules continue using current feature API clients:
  - Dashboard notifications: `apps/web/src/features/dashboard-notifications/dashboard-notifications.api.ts`
  - Accounting documents: `apps/web/src/features/accounting-documents/accounting-documents.api.ts`
  - Tax: `apps/web/src/features/tax/tax.api.ts`
- Accounting and tax are marked ready in the workspace registry because page and API integration already exist
- Prototype-only contracts from `../design_handoff_mangmee/api.ts` must be adapted feature by feature before enabling full feature behavior
- Prototype menu routes that do not yet have full backend contracts may render `PlannedModulePage` placeholders. These pages must not call fake mutation endpoints and must stay behind permission-aware navigation.
- Purchase order approve/reject/issue endpoints already exist under procurement, but amount-based PO approval settings do not yet have a dedicated persisted backend contract in this pass. The `/settings/po-approval` page renders the design-aligned settings/demo from a shared frontend model and must not fake save behavior until a backend policy contract is added.
- Error handling must continue using shared API error helpers and localized messages

## 12. UI Behavior

### Web

- Main screen: company-scoped workspace at `/companies/[companyId]/dashboard`
- Layout:
  - Sidebar uses Mangmee green brand, gray navigation, rounded icon frames, group labels, and responsive collapse
  - Sidebar menu order follows the latest design: dashboard, inbox, shop operations, finance/accounting, then system settings
  - Header uses 68px height, white surface, branch selector on the left, notification button and profile avatar on the right
  - Content uses full-width workspace padding and gray-50 background
  - Company dashboard starts with breadcrumb, `สวัสดี นภา`, branch scope chip, 4 KPI cards, and quick menu chips
  - Permissions page at `/companies/[companyId]/settings/permissions` uses the latest design matrix: role list on the left, menu/action permission table on the right, selected `ฝ่ายขาย`, and top-right edit/delete/open-menu actions
  - Settings submenu opens under `สิทธิ์การใช้งาน` and includes `รายบุคคล`, `เพิ่มพนักงาน`, `อนุมัติคำสั่งซื้อ`, `นโยบายส่วนลด`, `การแจ้งเตือน`
  - Individual permissions page at `/companies/[companyId]/settings/access-overview` uses the latest design: title `สิทธิ์รายบุคคล`, employee filter/list, selected owner profile card, real visible menu chips, branch access card, and per-menu inherited toggles
  - PO approval settings page at `/companies/[companyId]/settings/po-approval` uses the latest design: breadcrumb, title `ตั้งค่าอนุมัติคำสั่งซื้อ`, branch chip, 3 amount approval steps, test-condition card, and green integration note for `ค่าใช้จ่าย+ใบเสร็จ`
- Page chrome:
  - `MangmeePage` owns title, description, eyebrow, and actions
  - `MangmeeCard` and `MangmeeMutedCard` own surfaces
  - `MangmeeStatCard` owns KPI/stat presentation
  - `mangmee-table`, `mangmee-input`, `mangmee-btn`, and `mangmee-segmented` are the default utility classes for repeated controls
- Loading/empty/error/forbidden states:
  - Must keep existing feature states
  - Planned module pages must explain module state without leaking implementation-only wording to end users
- Responsive:
  - Shell, cards, forms, tables, and action rows must wrap cleanly on mobile
  - Buttons and dense controls must keep stable dimensions and readable text

### LINE/LIFF

- No LINE/LIFF behavior changes in this pass
- Deep links to web must remain company-scoped
- LINE/AI must not perform final business mutations unless a later spec explicitly allows it

## 13. Edge Cases

- User has no permission for a module: sidebar hides module or route shows forbidden state
- Backend has not implemented a prototype feature: keep planned page or disabled action; do not fake success
- Unknown module key: visual tone falls back to nav group, then slate
- Long Thai labels: controls wrap or truncate safely without breaking shell
- Mobile viewport: sidebar/header/content remain usable without overlap

## 14. Acceptance Criteria

- [x] Design tokens include Mangmee brand, gray, status, radius, and shadow values
- [x] Shared Mangmee components/helpers exist and are used by shell/pages
- [x] Sidebar/header/workspace shell align with the HTML reference language
- [x] Sidebar/header/company dashboard align with the second design screenshot menu order, spacing, and branch/profile controls
- [x] Settings, dashboard notifications, accounting, tax, and planned-module pages use the shared style layer
- [x] Accounting and tax readiness reflects existing API-backed modules
- [x] Prototype menu routes are present as planned read-only pages where backend work is not complete
- [x] `COMPANY_VIEW` role is registered in the API permission registry and grants the compact company menu permission set
- [x] `Company / Company@123` can login to `/companies/seed-local-company/dashboard` with the company-view role
- [x] Unit tests cover Mangmee tone mapping and module readiness
- [x] API unit test covers `COMPANY_VIEW` role grants
- [x] Web typecheck passes
- [x] API typecheck passes
- [x] Web unit test suite passes
- [x] Runtime route/HTML smoke verification completed on the running local stack for the company dashboard and planned menu routes
- [x] Desktop Playwright screenshot verification completed with system Chrome at `1600x900`
- [x] Permissions matrix page was visually checked with Playwright screenshot at `1600x900`
- [x] Settings submenu renders the latest design child rows and keeps child active state for PO approval
- [x] Individual permissions page renders the latest design and active child `รายบุคคล`
- [x] PO approval settings page replaces the placeholder page with the design-aligned amount-rule/test-condition UI
- [x] Primary actions, active tabs/filters, action links, and loading indicators across current web features use the Mangmee brand accent instead of legacy blue interactive styling
- [x] Unit tests cover individual permissions model, PO approval amount boundary rules, and settings submenu nesting
- [x] Static regression test rejects legacy blue primary/tab/loading accents in feature TSX files
- [ ] Browser screenshot visual verification against the design reference is completed on tablet/mobile
- [ ] Remaining feature pages are migrated in follow-up passes
- [ ] Add a persisted backend policy contract for amount-based PO approval settings before enabling save/edit mutation behavior

## 15. Test Cases

- Unit:
  - `apps/web/src/common/components/mangmee/mangmee-design.spec.ts`
  - `apps/web/src/features/web-core-workspace/web-core-workspace.spec.ts`
  - `apps/api/src/modules/auth/permission-registry.spec.ts`
  - `apps/web/src/features/employee-access/individual-permissions-prototype.model.spec.ts`
  - `apps/web/src/features/employee-access/permission-matrix-prototype.model.spec.ts`
  - `apps/web/src/features/employee-access/po-approval-settings.model.spec.ts`
- Integration:
  - Existing feature API tests remain responsible for domain contracts
- UI:
  - Manual browser comparison against the HTML reference after local stack is running
- Permission:
  - Existing `filterModulesByPermissions`, `getActiveModuleKey`, and `buildNavItems` tests cover navigation behavior
- Edge case:
  - Unknown module tone fallback
  - Thai initials generation
  - Ready/planned module registry state

## 16. Open Questions

- Which planned menu route should become the next full backend-backed feature: inbox, bookings, broadcast, discount policy, or CRM reports
- What persisted API/table shape should own amount-based PO approval settings and how it should integrate with procurement PO approval actions
- Whether to add screenshot regression tests once a stable seeded local stack exists
- Whether product wants IBM Plex Sans Thai to remain or switch fully to Noto Sans Thai from the reference
