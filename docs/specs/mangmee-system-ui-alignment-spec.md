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
2. ระบบโหลด shell ที่มี sidebar พร้อม user menu ด้านล่างสุด, header, branch switcher และ content area แบบ responsive
3. Sidebar แสดงเฉพาะเมนูที่ผู้ใช้มีสิทธิ์ตาม permission registry
4. ผู้ใช้เข้าหน้า dashboard หรือโมดูลที่ต้องทำงาน
5. หน้าแต่ละโมดูลใช้ `MangmeePage` สำหรับ page chrome และใช้ shared class/component สำหรับ card, table, form, badge, stat และ action
6. ถ้าโมดูลมี API รองรับแล้วให้แสดงเป็น ready และเรียก API client ของ feature นั้น
7. ถ้าโมดูลยังไม่มี API หรือ backend contract ให้แสดง planned/placeholder ที่ชัดเจนและไม่สร้าง mutation หลอก
8. Mutation ทุกจุดยังต้องผ่าน backend validation, permission, audit และ error handling ของ feature นั้น

## 7. Business Rules

- สีหลักอ้างอิง `packages/design-tokens/tokens.json`: brand green; ปุ่มตัวอักษรขาวใช้ brand-700 ถึง brand-800 เพื่อความชัดเจน ไม่ใช้ค่าสีจาก prototype เก่าทับ tokens
- พื้นหลัง workspace ใช้ gray-50 และ surface สีขาวแบบมี border/shadow เบา
- Sidebar expanded กว้าง 289px และ collapsed กว้าง 86px ตาม design screenshot ล่าสุด
- Header สูง 68px และต้องรองรับ branch selector กับ notification; profile avatar/menu ไม่แสดงซ้ำใน header
- Company dashboard content ต้องเริ่มใกล้ sidebar และใช้ full-width workspace padding ไม่ center max-width แบบหน้า marketing
- Text ต้องไม่ล้น container ใน desktop และ mobile
- Owner correction 2026-09-17: หน้า dashboard เน้นภาพรวม ไม่แสดงกล่อง CTA "ใบเสร็จรอตรวจ" แยกเหนือภาพรวม; จำนวนรอตรวจยังอยู่ในสรุปข้อมูลเดิม ย้าย "ข้อมูลร้านยังไม่ครบ" ไว้ใต้ส่วนหัวก่อนข้อมูลภาพรวม โดยคงสิทธิ์ผู้เห็น การพับ และ "ไว้ก่อน" ตามเดิม
- Component ที่ใช้ซ้ำต้องอยู่ใน common layer หรือ design token layer ไม่กระจายเป็น style เฉพาะหน้า
- Icon tone ต้อง map จาก module key/group ผ่าน helper เดียวเพื่อให้ sidebar, tile, card ใช้สีเดียวกัน
- หน้า Login ยังคง public entry `Forgot password?`; authenticated reset entry อยู่ใน sidebar user menu เป็น `Reset password`
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
  - Header uses 68px height, white surface, branch selector on the left, and notification button on the right; account actions live in the sidebar footer user menu
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

## 2026-09-16: UX ordering for local owner review

Owner authorized implementation and local review after the [system UX audit](../research/mangmee-system-ux-audit-2026-09-16-th.md). No merge, push, CI dispatch or deployment in this batch.

- Billing: show current rights/payment outcome before email settings. Verified identity email and billing recipient remain distinct; expose unmet prerequisites with a direct path, not unexplained disabled purchase buttons. Primary return after success is “กลับไปใช้งาน”. Quote and final consent remain required. Keep cancellation and recovery accessible.
- Receipt review: one next-step primary action; destructive actions under “เพิ่มเติม” on every eligible step, including invalid drafts. Keep all capability checks, reason fields, busy states and confirmations.
- Dashboard: work queue precedes optional profile completion. Compact optional checklist with clear nonblocking copy and existing seven-day dismissal.
- Shared primary controls: normal-text contrast >=4.5:1, visible keyboard focus, important touch targets >=44px; preserve semantic warning/danger colors.
- Admin billing: explain draft → impact → identity confirmation → submit/approval. Place password confirmation beside final actions; preserve five-minute proof, server permissions, audit and idempotency. Never lose the current draft on expired proof.
- Daily lists: compact mobile summaries; show task actions before optional explanations. AI empty state has one starting action; instructions remain available in a disclosure.
- Admin navigation: customer/daily work before system settings, Thai labels, mobile navigation without a long horizontal ribbon. Technical workflow JSON belongs in advanced settings with explicit labels.
- Marketing: local trial remains 15 receipts, one branch, two accounts; remove decorative repeated CTA animation. Preserve current logos while brand artwork remains unconfirmed. LINE existing routing/auth aliases stay intact; do not activate a new OA menu as part of local review.

Acceptance: local desktop and 390px mobile inspection of changed journeys, focused existing checks plus web typecheck; record exercised and unexercised cases separately. Local data/providers isolated from UAT/Production. No claim of whole-system E2E from representative UX checks.

Local discovered acceptance additions: admin default login target is partners (explicit safe deep links still win); concurrent first billing settings reads must return the same CLOSED baseline without a409 and without resetting existing operator settings. Scroll/focus to errors or the impact result so mobile users are not stranded below an invisible message.

## 2026-09-16: Company directory review, one page at a time

Owner requests this page first, then pauses for visual review. `/system/partners` separates บริษัท and ผู้ใช้งาน into two views. Each view owns its search, status filter, result count, loading/error/empty state and results in one section. Company search matches company name, registered name or full company ID on the server before pagination; user lookup retains its existing exact email/username or partial display-name semantics and 20-result cap, explained in Thai. User status filtering applies before the cap. Company and user statuses are separate, all supported statuses are offered. URL state preserves both searches/filters and company page on view changes and browser return; stale responses must not replace newer results.

Use Thai labels, one เพิ่มบริษัท page action, and one ดูรายละเอียด action per company. Keep technical metadata on existing detail pages; do not invent plan data absent from the list contract. Keep permission checks and metadata-only read boundaries. No business mutation, schema change or dependency change. Shared sidebar scope awaits the owner's optional preference; no other feature page content is in this review.

Acceptance: local real-API search + status + clear + empty result + pagination, person/company separation, back navigation and mobile 390px usability. Exercise permission/error handling using existing checks or explicit browser simulations. Owner reviews local before any next page, merge, CI or deploy.

Owner confirmed shared admin sidebar in this batch. Replace the horizontal menu with a persistent desktop sidebar, short topbar with environment badge, and a collapsible mobile menu. Keep permission filtering, support counts and logout behavior; remove duplicate global onboarding entry (company-page action remains). Other page content remains outside scope.


## 2026-09-16: Billing directory owner review

Owner approved the six-point billing-page UX review. Scope: `/system/billing` company directory and its navigation/help chrome, with existing detail/issue mutations preserved. Align with company directory theme: tab-like navigation with active state, primary company/issue/settlement destinations, advanced inspection links in a labelled disclosure, settings secondary. Search by company name/ID with a permanently visible clear button; URL-backed search and numeric page retain context on browser return. Desktop table / mobile cards show plan once, payment and access separately, trial/service end dates from termEndsAt, and paidThrough only when present. Never equate subscription NONE with unpaid or no rights.

Extend the existing overview read with optional numeric `page` and optional pagination `{page,pageSize,total}`. Count and records use the same authorized company/search predicate; fixed 25/page, bounded positive page, reject simultaneous cursor+page. Existing cursor callers/batches stay compatible. No schema or payment-policy change.

Remove the blanket “ติดต่อผู้ดูแลพร้อมเลขอ้างอิง” footer. On a read error show retry plus the actual request ID if returned, for internal investigation; never invent an ID or expose raw provider errors/secrets. Owner clarified that Mangmee is the operator: remove all suggestions to email Mangmee itself, including contact destinations. Loading/error must not erase search or move search controls. Keep metadata/financial permission boundaries and generation guards.

Acceptance: scoped count and pagination unit check, typechecks, local real API E2E search/clear/next/previous/back/mobile plus simulated 503 with actual reference and retry. Check navigation remains available after errors and no ordinary click causes financial mutations. Owner review before another page. No CI, merge, push or deploy.

## 2026-09-16: Billing issue queue theme and language

Owner approved aligning `/system/billing/issues` after visual review. Name the shared destination and queue heading “ปัญหาการชำระเงิน”, explain it tracks payment/access problems, and rename the advanced disclosure “ตรวจสอบกับ Stripe” with descriptions of provider history versus confirmed batch reconciliation. Keep all capability/mode checks and existing mutation confirmations.

Use the existing ThemedSelect and directory surface: filter, permanent clear, secondary “โหลดรายการใหม่”, result count for this page only, loading/error/empty state and cursor navigation in one white panel. Filters: “ยังไม่เสร็จทั้งหมด”, “ยังไม่มีคนรับเรื่อง”, “เกินกำหนดติดตาม”. Refresh reads Mangmee's stored issues; it must not trigger provider reconciliation. List each company's problem, status/responsible person and follow-up due time with one details action. Technical references stay in detail. Empty filtered/later-page/disabled-provider states must offer a useful recovery or explanation without declaring the whole system healthy. Preserve query/cursor on detail return; reset cursor on filter/clear; prevent stale reads; preserve navigation on transient read errors, clear privileges on401/403.

Acceptance: local real API/DB issue fixtures for filters, paging and detail/back; loading/error/retry and no billing mutations from read controls; mobile390px themed dropdown/no overflow and desktop visual review. No API/schema/policy change, CI, merge, push or deploy. Stop for owner review.


## 2026-09-16: Actionable billing issue detail

Owner authorized making the issue detail guide real resolution, beyond work tracking. Keep the existing issue queue and its return filter/cursor. Show company/problem, a concrete next action and observed resolution; tracking/assignment and contact notes are secondary disclosures. Reuse existing preview/confirm repair commands and server permissions, source versions/hashes, idempotency and audit. Taking ownership may supply a clear automatic audit note; changing work status still requires a reason and never changes financial/access state.

For PAID_NOT_APPLIED/PAID_HELD, map the issue reference (provider invoice ID or local ID) to the original invoice under the same authorized company, Stripe account and mode. Detail-only optional relatedInvoiceId; never guess an invoice or search across tenants. Allow a scoped read and existing RETRY_APPLY flow inline with an editable prefilled reason. If the invoice is absent, route to existing invoice discovery for that company with a plain explanation. Other known problem kinds lead to their existing original command/source tools; unresolved/financial decisions must not falsely report completion or create duplicate refunds.

Close paid-application issues only after the original verified invoice is APPLIED with appliedAt. Resolve exact local/provider references through the existing audited issue resolver, including repeat purchases and idempotent already-applied retries. Do not close other invoices, financial/refund issues or another company/account/mode; do not add quota again. Viewing or refreshing a detail cannot mutate billing. A completed command alone is not evidence that the issue is resolved. Show the actual issue state on explicit result refresh.

Acceptance: focused real-PG scope/idempotency/rollback checks, API-to-UI mapping and local browser preview/confirmation/result/error/return path checks with isolated data. Provider results may be simulated and must be labelled as such in evidence. Desktop/mobile visual check. No migration, CI, push, merge, deploy or real payment/email in this batch.

Owner detail follow-up: successful tracking/contact actions and read refreshes must update in place, preserving other drafts, expanded sections, scroll and original queue/cursor URL. Keep optimistic concurrency and refresh the issue version after contact commits. Transient read failures retain drafts; revoked access clears privileged data. Contact controls use the same themed select/input styles. Steps share the same visual treatment; the inline original-invoice result action is unavailable until a server-observed submitted command exists (preview/cancel alone is insufficient). Reloading/returning may recover submitted history for the same invoice; this enables reading a result, never proves closure. Keep simple self-assignment visible and move team assignment/search under “เปลี่ยนผู้รับผิดชอบ”, with its team purpose explained. Verify actual local HTTP saves/preview/submit/cancel, preserved drafts/disclosures/context and result ordering; no external CI.

Owner sequential-action correction: embedded invoice repair must present one current journey: inspect original purchase → read a plain-language summary and explicitly confirm → observe the actual issue result. Remove the preparatory button that only opens another form, nested standalone panel heading/border and repeated prose. Keep the editable audit reason and technical identifiers in a disclosure; append the original issue ID to the audited command internally, never ask operators to handle it in the main form. Explain internal references where expanded. History is collapsed, uses status/date labels and excludes the currently shown command. Group source/command refresh into one read-only control inside this disclosure (visible retry on error). Show a result action only after a submitted command is observed; terminal command observations request an in-place issue read automatically, without treating command success as issue closure. Existing preview/hash/version/idempotency, permission guards, cancellation and review/failed recovery remain unchanged. Existing drafts and disclosure state must survive these reads. Verify local initial/preview/cancel/queued/final/error/history paths and desktop/mobile layout before owner review.


Owner history-destination correction: `/system/billing/operations/[id]` must use the same Mangmee surface and plain Thai as the issue journey. Present task, command status and its meaning, dated facts, then the next permitted action. Separate command completion/cancellation from payment/entitlement/issue outcomes. Show saved source period and actual observed result with explicit labels. Put unmodified audit reason, internal IDs and technical fields in one collapsed reference section with a purpose explanation. Remove the self-link and duplicate nested generic heading. Returning from issue history preserves validated issue/queue/cursor context for navigation only; never derive authority from the audit reason or URL. Preserve the shared loader, polling, preview/hash/version/idempotency and server allowedActions. Failed reads retain existing data but disable mutations until a successful refresh; revoked access clears data. Verify cancelled and preview history round trips, state/error/action variants, and desktop/mobile locally. No CI/merge/deploy.


### Billing menu: company-first operator UX (owner follow-up)

Admin audience: Mangmee operators, including nontechnical users. Company landing must answer current package, access, receipt balance and actionable open issues before presenting tools. Keep payment, application, access and missing data distinct; never infer success from a paid invoice or treat missing package data as a free plan. Show actual company identity and mode. Organize company overview, invoices, history and adjustments into named URL-backed sections. Keep open issues in the overview and provide direct issue resolution; no repair form or audit feed on initial landing. Company tools explain when to use them; adjustments and repair retain explicit preview/confirmation/permission/audit boundaries. No automatic mutations on page/tab/view, and navigation is never labelled as a completed action.

Review all routes under /system/billing for consistent cards, readable Thai dates, input/select styles, meaningful back links, loading/empty/denied states and restrained primary actions. Fold technical references and secondary history; do not hide required warnings/impact summaries. Remove self-links and admin self-email loops. Existing provider/financial API contracts and policy remain unchanged. Test local real-API company sections/issue/history round trips and representative menu routes, including mobile, source failures and no mutation on viewing. Record route inventory and exact coverage; no claim of real provider proof. No CI, push, merge or deploy.

Design references: [GOV.UK Details](https://design-system.service.gov.uk/components/details/) for secondary information disclosure; [GOV.UK Buttons](https://design-system.service.gov.uk/components/button/) for primary/secondary action hierarchy. Mangmee tokens/components remain the visual source of truth.

Implementation clarification: company section changes and read refreshes retain local drafts; denied reads clear all privileged company/history UI. Selects must have explicit accessible names and honor disabled/busy/permission states even inside disabled fieldsets. Plan tools show one selected task at a time. Company invoice and history lists use25-item paging; the company issue summary explicitly labels its25-record cap. Missing source/plan data is shown as unknown, never as unlimited quota. Detailed local evidence and the37-route audit are in `docs/evidence/mangmee-ux-audit-2026-09-16/billing-menu-operator-ux.json`.

### Owner correction: task clarity on five billing destinations

Scope: settlement report, invoice documents, paid-invoice entitlement repair, plan adjustment (including blocked company), and configuration. A route rendering without overflow is not acceptance for operator UX. Each page must explain its purpose, current factual state and the next eligible action, use descriptive field labels, and keep reload/navigation visually secondary. Verify populated, blocked and provider-error states, not just empty route smoke.

Settlement defaults to completed Bangkok calendar days with yesterday/last7days choices; custom date/time uses the existing themed date picker and explicit Bangkok time, retaining the31-day/exclusive-end/provider-lag rules. Viewing/picking a period does not create a job. Invoice document errors distinguish denied/missing/unverified source/provider unavailable, with relevant recovery and no implication that the operator lacks permission in every case. Refunds stay secondary to documents. Paid-invoice repair distinguishes paid evidence from package activation, names period/start/end facts and explains that inspection precedes confirmation without another charge. Plan adjustment eligibility failures explain why controls are unavailable and link to the company's payments rather than an unhelpful loop. Configuration opens with current settings, then one chosen edit topic; proposed values and emergency stop stay distinct. Preview replaces the edit surface, with explicit reauthentication/confirmation and unchanged server policy/audit/version/hash guards. No CI/merge/deploy or real-provider mutation.

### Settlement result clarity correction

- A run that has not completed and has observed zero rows has **no monetary result yet**; show “ยังสรุปยอดไม่ได้”, never default-zero money cards. A completed empty run may show confirmed zero totals. Partial results must say how many rows they cover and remain separate from completion.
- Lead with plain outcome, selected period and one next eligible action. Blocked source verification should lead to checking the Stripe connection, with no claim that customer money is missing or totals differ. Existing coarse error codes must not be presented as a specific proven mismatch.
- Manual resume after blocked-source review is secondary and requires the operator to acknowledge checking the cause; existing backend authorization/version checks still decide eligibility. Stop is secondary, explains that it ends only this check and does not resolve money differences, and requires an explicit second confirmation.
- Reload is scoped to the result card. Reference IDs, internal notes and issue tracking are folded; the issue page must not be the primary route when it leads back to the same result.
- Verify zero unobserved, partial, completed empty, blocked, waiting/retry, permission-limited, and cancellation interactions locally without provider side effects.
### Email status and shared LINE settings theme correction

Company detail follow-up: replace the continuous configuration page with five URL-backed sections: overview, members, package/features, AI/document quotas, contact/history. Only the selected section is visible; previously opened sections stay mounted to retain drafts. Visits from support requests default to contact/history. Company lifecycle actions and technical references are secondary. Feature editing defaults to a single menu group, with search across groups and existing review/dependency guards. No member/password/LINE messages or settings are mutated by navigation.

- Email status and LINE settings use the existing admin typography, green controls, themed selectors, light gray card borders and responsive spacing.
- Email status prioritizes its seven-day summary and filterable/paginated history. Historical rows can span all dates; delivery acceptance is not evidence of reading. Missing configuration is not an empty successful result. Connection diagnostics and retention policy stay secondary.
- Refreshing/filtering email history must not remount the retention editor or discard its draft. Existing preview, scope/version, idempotency and permission gates remain.
- LINE settings show configuration availability, provider-validation and inbound-webhook evidence separately. Technical references and credential replacement are disclosed on demand. No claim of successful message delivery from configuration availability alone.
- Preserve existing LINE credential acknowledgement, password, version and rotation identifiers; never submit credentials while visually reviewing the page. No provider, backend or deployment changes in this correction.

## Owner amendment: AI works in context — 2026-09-17

- Owner approved hiding “AI แนะนำ” from primary navigation. Mark its shared menu binding `navigation: contextual`; exclude it from customer navigation, admin menu cards and sidebar preview. Keep existing authenticated suggestion review URLs and permission checks.
- Move `ai_line_assistant` switch to the existing background-work section; keep the same pending changes, lock/disable guards, review, audit and save path. AI entitlement, quota, starter 17 keys, provider readiness and final-mutation confirmation do not change.
- Starter remains seven capabilities: six navigation entries (including notifications in the header) plus background AI. Earlier seven-menu evidence describes the former presentation; no new feature replaces the removed menu.
- Verify navigation absence, allowed/denied direct-route access, retained AI permission grants, admin background toggle diff, local typecheck and browser smoke. No new contextual workflow, real provider call, migration, CI, merge or deployment in this amendment.
