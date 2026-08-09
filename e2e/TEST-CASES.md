# WatchDog-BMS — E2E Test Cases & Steps

Authored for Codex CLI to implement as Playwright specs. Read [`HANDOFF.md`](./HANDOFF.md) first.

**Conventions for every case below:**
- Import `{ test, expect }` from `./harness/fixtures`; `{ expectNoClientError }` from `./harness/auth`.
- `:id` = `companyId` fixture (`seed-local-company`). Navigate by URL. Assert by role with `th|en` regexes.
- After each `goto`, call `expectNoClientError(page)` even when not restated.
- Suggested spec file per suite is named under each heading. One `test.describe` per suite, tag tests `@smoke` / `@p1` / `@p2` matching **Pri**.
- "Backend truth" steps use the `api` fixture.

Priority: **P0** blocking · **P1** core journey · **P2** breadth/edge.

---

## SMOKE — rig proof  ·  `_reference.spec.ts` (already implemented)
Keep as-is. If red, the environment is broken — fix env, not tests.

| ID | Pri | It asserts |
|---|---|---|
| SMOKE-01 | P0 | dashboard loads, generate button visible |
| SMOKE-02 | P0 | inventory/accounting/reports render |
| SMOKE-03 | P0 | API `/health` + `/auth/me` return, company id matches |

---

## LOGIN — auth & session  ·  `login.spec.ts`
Use a **fresh, unauthenticated** context here (plain `@playwright/test` `test` or a context without the fixture). Do not use `authedPage`.

| ID | Pri | Precondition | Steps | Expected |
|---|---|---|---|---|
| LOGIN-01 | P0 | logged out | 1. `goto('/companies/seed-local-company/dashboard')` | Redirected to `/login?next=…`; login form (`#login-identifier`, `#login-password`) visible |
| LOGIN-02 | P0 | on `/login` | 1. Fill `#login-identifier`=`Owner`, `#login-password`=`Owner@12345` 2. Click submit (`/เข้าสู่ระบบ|Sign in/`) | Lands on a `/companies/…` page; owner is authenticated; `expectNoClientError` |
| LOGIN-03 | P1 | on `/login` | 1. Fill identifier=`Owner`, password=`wrong` 2. Submit | Stays on `/login`; `role=alert` error banner visible; not redirected |
| LOGIN-04 | P1 | on `/login` | 1. Submit empty form | Required-field validation blocks submit (native `required`); no navigation |
| LOGIN-05 | P1 | logged in (`authedPage`) | 1. Open user menu / logout control 2. Confirm logout | Redirected to `/login`; revisiting a workspace URL redirects back to `/login` (session cleared) |
| LOGIN-06 | P2 | on `/login` | 1. Click language toggle (`EN`/`ไทย`) | Labels switch language (`auth.login.submit` becomes `Sign in`/`เข้าสู่ระบบ`) |
| LOGIN-07 | P2 | logged out | 1. `goto('/forgot-password')` | Forgot-password page renders its form; no client error |
| LOGIN-08 | P2 | API only | 1. `api.get('/auth/me')` without token (new plain context) | 401 Unauthorized |

---

## DASH — dashboard  ·  `dashboard.spec.ts`

| ID | Pri | Steps | Expected |
|---|---|---|---|
| DASH-01 | P0 | `goto('/companies/:id/dashboard')` | Generate button (`/สร้างใหม่|generate/i`) visible; no client error |
| DASH-02 | P1 | Read the KPI/summary tiles region | At least one metric tile / heading renders with a value (not a spinner stuck, not empty error) |
| DASH-03 | P1 | Click the primary "generate/สร้างใหม่" action | A panel/result appears (AI summary or generated view); no `Unauthorized/Request failed` |
| DASH-04 | P2 | `api.get('/companies/:id/dashboard...')` (confirm the endpoint the page calls via network tab) | 200; body shape matches what the page renders |

---

## INV — inventory  ·  `inventory.spec.ts`  (P0 anchor suite)

| ID | Pri | Precondition | Steps | Expected |
|---|---|---|---|---|
| INV-01 | P0 | — | `goto('/companies/:id/inventory')`; click `link Products` | `heading Products` visible; product list/table renders |
| INV-02 | P1 | on products list | Read the table | Seeded products listed; columns render; no empty-error |
| INV-03 | P0 | — | `goto('/inventory/products/new')`; fill required fields (name, SKU=`E2E-SKU-<ts>`, price/uom as required); submit | Success toast/redirect to product; new SKU appears in list |
| INV-03b | P0 | after INV-03 | `api.get` products list (or product by id) | Created SKU present in API response (backend truth) |
| INV-04 | P1 | seeded product exists | Open a product detail `/inventory/products/:pid` | Detail renders name, stock, movement history section |
| INV-05 | P1 | — | `goto('/inventory/movements')` | Movements list renders |
| INV-06 | P1 | product exists | `goto('/inventory/movements/new')`; create an IN movement qty=`5` for the product; submit | Movement recorded; product on-hand increases by 5 (assert via detail page or `api`) |
| INV-07 | P1 | — | `goto('/inventory/stock-count')` | Stock-count workspace renders; can start/open a count sheet |
| INV-08 | P1 | — | `goto('/inventory/locations')` | Locations list renders (branches/warehouses) |
| INV-09 | P1 | — | `goto('/inventory/reports/stock')` | Stock report renders with rows/totals |
| INV-10 | P2 | — | `goto('/inventory/scan')` | Scan page renders; camera/permission-less fallback input present (durability: page must not crash without camera) |
| INV-11 | P2 | new product form | Submit with missing required field | Inline validation blocks submit; no server 500 |

---

## EXP — expenses + receipts  ·  `expenses.spec.ts`  (P0 anchor suite)

| ID | Pri | Steps | Expected |
|---|---|---|---|
| EXP-01 | P0 | `goto('/companies/:id/expenses')` | `table` visible; text `Posting`/`ค่าใช้จ่าย` present; status filter chips (`ทั้งหมด/ฉบับร่าง/รอตรวจสอบ/ยืนยันแล้ว/ปฏิเสธ`) render |
| EXP-02 | P1 | On list, read summary tiles | Totals (`ค่าใช้จ่ายรวม`, `ภาษีซื้อ (VAT)`, `ค้างจ่าย`, `เกินกำหนดชำระ`) render numeric values |
| EXP-03 | P0 | Create a new expense (open create panel `รายการค่าใช้จ่าย`; fill vendor, amount=`1000`, category; save as draft) | Draft created; appears in list with status `ฉบับร่าง/Draft` |
| EXP-04 | P1 | Open the created expense `/expenses/:id` | Detail renders totals (`ยอดก่อนหักส่วนลด`, `ส่วนลด`, `ฐานภาษี`), status transitions available |
| EXP-05 | P1 | Move draft → submit for review → confirm | Status changes to `รอตรวจสอบ` then `ยืนยันแล้ว`; assert final status via `api` |
| EXP-06 | P2 | Upload receipt (`อัปโหลดใบเสร็จ`) | **Quarantine (`test.fixme`) unless MinIO up.** If up: file attaches, appears as evidence |
| EXP-07 | P2 | Filter by status chip `ยืนยันแล้ว` | List filters to confirmed only |

---

## ACCT — accounting documents  ·  `accounting.spec.ts`

| ID | Pri | Steps | Expected |
|---|---|---|---|
| ACCT-01 | P0 | `goto('/companies/:id/accounting')` | `heading Accounting documents` + `heading New document` visible |
| ACCT-02 | P1 | Create a new document (pick a type, add a line item qty×price, save) | Document created with a running number; totals computed; appears in list |
| ACCT-03 | P1 | Open the created doc; verify totals | Subtotal/VAT/total match line math; status is Draft |
| ACCT-04 | P1 | Confirm/issue the document | Status transitions; document number assigned; assert via `api` list |
| ACCT-05 | P2 | Create doc with zero line items | Validation prevents issue; clear message |

---

## RPT — reports & BI  ·  `reports.spec.ts`  (mirror existing `reports-bi-smoke.spec.ts`)

| ID | Pri | Steps | Expected |
|---|---|---|---|
| RPT-01 | P0 | `goto('/companies/:id/reports')` | `heading Reports and BI` + text `Trial Balance` visible |
| RPT-02 | P1 | Click `Run report` | `Result table` appears with rows |
| RPT-03 | P1 | Click `Save view` | Saved view appears in the aside with a date stamp |
| RPT-04 | P0 | Click `Export CSV`; await download | Download filename ends `.csv`; aside shows an export with status `READY` |
| RPT-05 | P1 | Reload page | Saved view + `READY` export persist |
| RPT-06 | P1 | `api.get('/companies/:id/reports/exports')` | 200; some item `status==='READY'` |
| RPT-07 | P1 | `api.get('/companies/:id/notifications?triggerKey=report_ready')` | Contains a `report_ready` notification |
| RPT-08 | P1 | `api.get('/companies/:id/audit/logs?targetType=report_export_request')` | Contains action `report.export.request` (audit trail intact) |

---

## JRNL — journal / ledger  ·  `journal.spec.ts`

| ID | Pri | Steps | Expected |
|---|---|---|---|
| JRNL-01 | P0 | `goto('/companies/:id/journal')` | Journal page renders; title `สมุดรายวัน`/Journal visible |
| JRNL-02 | P1 | Read the ledger report tiles | `ผลต่างงบทดลอง`, `กำไรสุทธิ`, `สินทรัพย์รวม` tiles render values |
| JRNL-03 | P1 | Change the period selector (`งวด`) | Report reloads for the selected period without error |

---

## BANK — banking  ·  `banking.spec.ts`

| ID | Pri | Steps | Expected |
|---|---|---|---|
| BANK-01 | P0 | `goto('/companies/:id/banking')` | Banking page renders (accounts / statements) |
| BANK-02 | P1 | Open statement import / reconciliation view | Import + matching UI renders; no client error |
| BANK-03 | P2 | Import a sample statement (if supported without file) or open matching for a seeded statement | Matches list; can mark a match |

---

## AP — accounts payable  ·  `accounts-payable.spec.ts`

| ID | Pri | Steps | Expected |
|---|---|---|---|
| AP-01 | P0 | `goto('/companies/:id/accounts-payable')` | AP page renders; payables list/aging visible |
| AP-02 | P1 | Open a payable / create one | Detail renders; due date + amount present |

---

## REIMB — reimbursements  ·  `reimbursements.spec.ts`

| ID | Pri | Steps | Expected |
|---|---|---|---|
| REIMB-01 | P0 | `goto('/companies/:id/reimbursements')` | Reimbursements list renders |
| REIMB-02 | P1 | Create a reimbursement request (amount, description); submit | Request appears with status Pending/รออนุมัติ |
| REIMB-03 | P1 | Approve then mark financed (as OWNER) | Status transitions Approved → Paid/Financed; assert via `api` |

---

## PROC — procurement  ·  `procurement.spec.ts`

| ID | Pri | Steps | Expected |
|---|---|---|---|
| PROC-01 | P0 | `goto('/companies/:id/procurement')` | Procurement / PO list renders |
| PROC-02 | P1 | Create a purchase order (vendor, line, qty); submit | PO created; number assigned |
| PROC-03 | P1 | Route PO for approval (ties to PO-approval settings) | PO enters approval state; visible in approvals |

---

## WF — workflow  ·  `workflow.spec.ts`

| ID | Pri | Steps | Expected |
|---|---|---|---|
| WF-01 | P0 | `goto('/companies/:id/workflow')` | Workflow page renders; seeded template catalog listed |
| WF-02 | P1 | Open a workflow template | Definition (conditions/actions) renders |
| WF-03 | P2 | Toggle/enable a workflow; trigger its event path if reachable | State updates; no client error |

---

## AISUG — AI suggestions  ·  `ai-suggestions.spec.ts`

| ID | Pri | Steps | Expected |
|---|---|---|---|
| AISUG-01 | P0 | `goto('/companies/:id/ai-suggestions')` | Page renders (suggestion inbox / review list). AI provider is `disabled` in test env, so expect empty-state or seeded drafts, not a crash |
| AISUG-02 | P1 | Open a suggestion (if any seeded) | Review UI renders with approve/reject; final-mutation is OFF (guardrail) — approve should not execute a live mutation |

---

## NOTIF — notifications  ·  `notifications.spec.ts`

| ID | Pri | Steps | Expected |
|---|---|---|---|
| NOTIF-01 | P0 | `goto('/companies/:id/notifications')` | Notifications list renders |
| NOTIF-02 | P1 | `goto('/notifications/preferences')` | Preferences form renders; toggle a channel + save persists |
| NOTIF-03 | P1 | `goto('/notifications/rules')` | Rules list renders; can open/create a rule |
| NOTIF-04 | P1 | `api.get('/companies/:id/notifications?pageSize=5')` | 200; `items` array present |

---

## CRM — inbox, customers, payment proofs  ·  `crm.spec.ts`

| ID | Pri | Steps | Expected |
|---|---|---|---|
| CRM-01 | P0 | `goto('/companies/:id/inbox')` | Conversation inbox renders; seeded conversations (คุณพิม, คุณจอย …) listed with status chips (`ใหม่/กำลังคุย/รอลูกค้า/…`) |
| CRM-02 | P1 | Open a conversation | Message thread renders (inbound/outbound/notes); composer visible |
| CRM-03 | P1 | Filter inbox by status `ใหม่/New` | List filters to NEW conversations only |
| CRM-04 | P1 | `goto('/companies/:id/crm')` | CRM pipeline/board renders with seeded stages + deals |
| CRM-05 | P1 | Open a customer 360 `/crm/customers/:cid` (use a seeded customer id) | Profile renders: contact, tier (VIP/ACTIVE/LEAD), LTV, conversations, deals, bookings |
| CRM-06 | P1 | `goto('/crm/payment-proofs')` | Payment-proof review list renders; can open an item |
| CRM-07 | P2 | Send a message in a conversation (composer) | Message appended optimistically; persists on reload (assert via reload or `api`) |
| CRM-08 | P1 | `api.get('/companies/:id/crm/...customers')` | 200; seeded customers returned (backend truth for CRM-05) |

---

## BOOK — bookings  ·  `bookings.spec.ts`

| ID | Pri | Steps | Expected |
|---|---|---|---|
| BOOK-01 | P0 | `goto('/companies/:id/bookings')` | Booking calendar/week view renders; seeded bookings visible (คุณเบล รีทัช, คุณจอย เติมขนตา …) |
| BOOK-02 | P1 | Navigate week (`สัปดาห์ก่อนหน้า`/next) | Calendar moves; bookings reflow without error |
| BOOK-03 | P1 | Open a booking; cancel (`ยกเลิกคิว`) a throwaway one you created (do not cancel seed) | Booking status updates to cancelled |

---

## SET — settings  ·  `settings.spec.ts`

| ID | Pri | Route | Steps | Expected |
|---|---|---|---|---|
| SET-01 | P0 | `/settings` | Open settings hub | Renders settings sections/links |
| SET-02 | P0 | `/settings/employees` | Open employees | Seeded staff (มายด์/ไนซ์/แพรว/เตย) listed with roles + branch |
| SET-03 | P1 | `/settings/employees` | Create an employee (name, role, branch); submit | New employee appears; assert via `api` |
| SET-04 | P1 | `/settings/roles` | Open roles | System roles + grants render |
| SET-05 | P1 | `/settings/permissions` | Open permissions | Permission matrix renders (access-control) |
| SET-06 | P1 | `/settings/branches` | Open branches | 3 seeded branches (SIAM/AREE/THONG) listed; can create a branch |
| SET-07 | P1 | `/settings/security` | Open security | Self-service security settings render (password/2FA/session) |
| SET-08 | P1 | `/settings/access-overview` | Open access overview | Access matrix renders per employee |
| SET-09 | P2 | `/settings/po-approval` | Open | PO approval policy renders (`ยอดทดลองใบสั่งซื้อ` tile) |
| SET-10 | P2 | `/settings/discount-policy` | Open | Discount policy renders |
| SET-11 | P2 | `/settings/line-oa` | Open | LINE OA settings render (no live LINE call) |
| SET-12 | P2 | `/settings/notification-rules`, `/settings/notifications` | Open each | Render without client error |

---

## SYS — system admin  ·  `system-admin.spec.ts`
Log in as **systemAdmin** (`thawatchai.watchdog`). Build a separate authed context via the real login form, or extend the harness with a `systemAdminPage` fixture.

| ID | Pri | Route | Expected |
|---|---|---|---|
| SYS-01 | P0 | `/system/partners` | Partner list renders (system company scope) |
| SYS-02 | P1 | `/system/partners/:companyId` | Partner detail renders (profile, features, LINE credential) |
| SYS-03 | P1 | `/system/company-onboardings/new` | Onboarding form renders; can start a draft onboarding |
| SYS-04 | P2 | `/system/line-settings` | Shared LINE settings render |
| SYS-05 | P1 | as OWNER (non-admin) `goto('/system/partners')` | Access denied / redirect — OWNER cannot reach system scope |

---

## PLAN — planned-module placeholders  ·  `planned.spec.ts`
Depth = SMOKE. Each: `goto` route → page renders → `expectNoClientError`. Where the nav shows a "Coming Soon"/`เร็วๆ นี้` badge, also assert the badge in the nav for that module.

| ID | Pri | Route |
|---|---|---|
| PLAN-01 | P2 | `/sales` |
| PLAN-02 | P2 | `/customers` |
| PLAN-03 | P2 | `/sales-documents` |
| PLAN-04 | P2 | `/tax` |
| PLAN-05 | P2 | `/crm-reports` |
| PLAN-06 | P2 | `/broadcast` |
| PLAN-07 | P2 | `/period-closing` |

> Note: `/accounting` carries a planned *badge* but a **working** route — it is covered by ACCT-*, not here.

---

## XC — cross-cutting  ·  `cross-cutting.spec.ts`

| ID | Pri | Steps | Expected |
|---|---|---|---|
| XC-01 | P0 | Sweep every **ready** route in §5 with `authedPage` in a data-driven loop; after each `goto`, `expectNoClientError` + assert `<main>`/heading present | Every ready route renders under auth with zero client-error banners |
| XC-02 | P1 | Toggle workspace language EN⇄TH (shell language control) | Nav + labels switch; selection persists across a reload (localStorage `locale`) |
| XC-03 | P1 | Log in as **companyView** (`Company`/`Company@123`); visit an OWNER-only area (e.g. `/settings/permissions` or `/settings/employees` create) | Limited user is blocked / controls hidden — permission enforcement holds (ABAC) |
| XC-04 | P1 | Visit a bogus company id `/companies/not-a-company/dashboard` as OWNER | Not-found / forbidden handled gracefully (no unhandled crash) |
| XC-05 | P1 | Visit a deep route directly while logged out (e.g. `/companies/:id/reports`) | Redirect to `/login?next=<that route>`; after login, land back on it |
| XC-06 | P2 | Intercept an API route to 500 (Playwright `route.fulfill`) on a list page | Page shows an error/empty state, not a white screen |
| XC-07 | P2 | Check page has no console errors of severity `error` during a core-module sweep | No uncaught console errors (allowlist known-noisy if needed, documented) |
| XC-08 | P2 | Responsive: set viewport to mobile (`390×844`), open dashboard + inbox | Layout adapts; nav collapses; no horizontal overflow crash |

---

## Coverage summary

| Suite | Cases | P0 | Anchor |
|---|---|---|---|
| SMOKE | 3 | 3 | rig proof |
| LOGIN | 8 | 2 | auth |
| DASH | 4 | 1 | |
| INV | 12 | 3 | ✅ write flow |
| EXP | 7 | 2 | ✅ write flow |
| ACCT | 5 | 1 | ✅ write flow |
| RPT | 8 | 2 | ✅ export flow |
| JRNL/BANK/AP/REIMB/PROC | 13 | 5 | |
| WF/AISUG/NOTIF | 9 | 3 | |
| CRM/BOOK | 11 | 2 | |
| SET | 12 | 2 | |
| SYS | 5 | 1 | |
| PLAN | 7 | 0 | placeholders |
| XC | 8 | 1 | invariants |
| **Total** | **~112** | **28** | |

Implement P0 first (28 cases → all green), then P1, then P2. Report per [`HANDOFF.md`](./HANDOFF.md) §7.
