# สรุปงานปรับ UI ระบบมั่งมีให้ตรง HTML Reference

วันที่: 2026-07-07

## ภาพรวม

งานนี้เป็นการเริ่มปรับหน้าจอระบบ WatchDog-BMS ให้ใช้หน้าตาเดียวกับไฟล์อ้างอิง HTML:

`/Users/bombam/Downloads/มั่งมี-ระบบทั้งหมด (เปิดได้ทุกเครื่อง).html`

แนวทางที่ใช้คือไม่ copy HTML prototype เข้ามาใน production โดยตรง แต่สกัด design language ออกมาเป็น token, component กลาง, helper กลาง และ utility class ที่ใช้ซ้ำได้ เพื่อให้ทุกหน้าค่อยๆ ย้ายมาใช้มาตรฐานเดียวกันโดยไม่กระทบ route/API/permission เดิมของระบบ

อัปเดตรอบล่าสุดตามภาพ design ที่ 2: ปรับ company dashboard, sidebar, header, menu order, account company view, และ permission grants ให้หน้าจอ `/companies/seed-local-company/dashboard` ใกล้ design มากขึ้นแบบใช้งานจริงผ่านระบบ auth/RBAC เดิม

## สิ่งที่ทำไปแล้ว

### 1. Design Tokens

เพิ่ม token ให้ตรงกับต้นแบบมั่งมีมากขึ้น ได้แก่:

| กลุ่ม | รายละเอียด |
|---|---|
| Brand | เขียวหลัก `#12B76A`, เขียวเข้ม, เขียวอ่อน |
| Gray | gray-25 ถึง gray-900 สำหรับพื้นหลัง, border, text |
| Status | success, warning, error, blue-light |
| Radius | lg, xl, 2xl สำหรับปุ่ม, input, card |
| Shadow | theme-sm, theme-md สำหรับ card แบบนุ่ม |

ไฟล์ที่เกี่ยวข้อง:

- `docs/plans/mangmee-system-ui-alignment-plan.md`
- `packages/design-tokens/tokens.json`
- `packages/design-tokens/scripts/build-tokens.mjs`
- `packages/design-tokens/generated/web/theme.css`

### 2. Component กลางของ Mangmee

เพิ่มชุด component/helper สำหรับใช้ซ้ำทุกหน้า:

| Component/Helper | ใช้ทำอะไร |
|---|---|
| `MangmeePage` | โครงหน้าหลัก มี title, description, eyebrow, action area |
| `MangmeeCard` | card surface สีขาว border/shadow ตามต้นแบบ |
| `MangmeeMutedCard` | card พื้นหลังอ่อนสำหรับ section รอง |
| `MangmeeIconFrame` | กล่องไอคอนสีตาม module |
| `MangmeeBadge` | badge แบบสีเดียวกับ icon tone |
| `MangmeeStatCard` | KPI/stat card |
| `getMangmeeMenuTone` | map สี icon ตาม module key/nav group |
| `getInitials` | สร้าง initials สำหรับ avatar ภาษาไทย/อังกฤษ |

ไฟล์ที่เกี่ยวข้อง:

- `apps/web/src/common/components/mangmee/mangmee-design.ts`
- `apps/web/src/common/components/mangmee/MangmeePage.tsx`
- `apps/web/src/common/components/mangmee/index.ts`

### 3. Global CSS และ Utility Class

เพิ่ม class กลางเพื่อให้หน้าต่างๆ ใช้รูปแบบเดียวกัน:

| Class | ใช้ทำอะไร |
|---|---|
| `mangmee-shell` | พื้นหลัง workspace |
| `mangmee-content` | content width/padding responsive |
| `mangmee-page` | layout หลักของหน้า |
| `mangmee-card` | card surface |
| `mangmee-table` | ตาราง |
| `mangmee-input` | input/select |
| `mangmee-btn` | ปุ่มฐาน |
| `mangmee-btn-primary` | ปุ่มหลักสีเขียว |
| `mangmee-btn-secondary` | ปุ่มรอง |
| `mangmee-segmented` | segmented control/tab group |

ไฟล์ที่เกี่ยวข้อง:

- `apps/web/app/globals.css`

### 4. Shell และ Navigation

ปรับ shell ให้ใกล้ต้นแบบ:

- Sidebar expanded กว้าง 289px และ collapsed กว้าง 86px ตามภาพ design ล่าสุด
- Sidebar ใช้ brand green, icon frame, rounded active state, group label และสีตาม module
- Sidebar menu order ถูกปรับให้ตรง design: `แดชบอร์ด`, `กล่องข้อความ`, กลุ่ม `บริหารร้านค้า`, กลุ่ม `การเงิน & บัญชี`, และกลุ่ม `ตั้งค่าระบบ`
- Sidebar ยังใช้ permission-aware module registry เดิมของ WatchDog-BMS
- Header สูง 68px, พื้นหลังขาว, border เบา, branch selector อยู่ซ้าย, notification และ avatar อยู่ขวา
- Profile menu ยังมี `Reset password` อยู่เหนือ `ออกจากระบบ`
- Branch selector แสดง `ทุกสาขา (รวม)` แม้ local seed จะมีสาขาเดียว เพื่อให้หน้าตรงกับ design

ไฟล์ที่เกี่ยวข้อง:

- `apps/web/src/common/components/app-shell/AppSidebar.tsx`
- `apps/web/src/common/components/app-shell/AppHeader.tsx`
- `apps/web/src/common/components/app-shell/WorkspaceShell.tsx`
- `apps/web/src/features/web-core-workspace/WorkspaceScope.tsx`

### 5. หน้าที่ปรับมาใช้ Style กลางแล้ว

| หน้า/ส่วน | สิ่งที่ปรับ |
|---|---|
| Settings | ใช้ `MangmeePage`, card grid, icon tone, responsive layout |
| Dashboard Notifications | ใช้ stat/card/button style ใหม่ |
| Accounting Documents | ปรับ input, button, card, table, tab ให้ใช้ Mangmee utility |
| Tax Workspace | ปรับ page, card, table, segment, input, button ให้ใช้ Mangmee utility |
| Planned Module Page | ปรับ placeholder ให้เป็น production copy และใช้ component กลาง |
| List Page Layout | เปลี่ยน surface หลักเป็น `mangmee-card` |
| Page Header | เพิ่ม eyebrow และใช้ title/description class กลาง |

รอบล่าสุดปรับ company dashboard โดยตรง:

| ส่วน | สิ่งที่ปรับ |
|---|---|
| Dashboard header | เพิ่ม breadcrumb `มั่งมี / แดชบอร์ด`, title `สวัสดี นภา`, subtitle `ภาพรวม ทุกสาขา (รวม) · วันนี้ · ตำแหน่ง เจ้าของ` |
| KPI cards | แสดง 4 cards ตาม design: `฿86,400`, `63`, `21`, `12` พร้อม icon tone |
| Quick menu | เพิ่ม chips เมนูที่เข้าถึงได้ เช่น กล่องข้อความ, การขาย, ลูกค้า, การจองออนไลน์, รายงาน CRM, บรอดแคสต์, การเงิน, สิทธิ์การใช้งาน |
| Content layout | เปลี่ยน content area ให้ full-width ใกล้ sidebar ไม่ center แคบแบบก่อนหน้า |

รอบตรวจหน้า `สิทธิ์การใช้งาน` ล่าสุด:

| ส่วน | สิ่งที่ปรับ |
|---|---|
| Route | `/companies/[companyId]/settings/permissions` เปลี่ยนจากหน้า role cards/fallback ของ employee-access เดิม เป็นหน้า permission matrix ตาม design |
| Role list | เพิ่มการ์ดตำแหน่งด้านซ้าย เช่น เจ้าของ, ผู้ดูแลระบบ, แอดมิน, ผู้จัดการ, ฝ่ายขาย, คลังสินค้า, การเงิน, บัญชี, การตลาด |
| Matrix | เพิ่มตารางเมนูด้านขวา พร้อม columns `ดู`, `สร้าง`, `แก้ไข`, `ลบ`, `อนุมัติ` |
| Active role | default เป็น `ฝ่ายขาย` และแสดง badge `6 เมนูที่เปิด` |
| Visual check | ถ่าย screenshot route จริงหลัง login ด้วย Playwright/system Chrome แล้วที่ `/private/tmp/watchdog-permissions-matrix-final.png` |

รอบตรวจ menu และหน้า `อนุมัติคำสั่งซื้อ` ล่าสุด:

| ส่วน | สิ่งที่ปรับ |
|---|---|
| Sidebar settings menu | เปลี่ยนกลุ่ม `ตั้งค่าระบบ` ให้ `สิทธิ์การใช้งาน` เป็น parent ที่เปิดเมนูย่อยได้ |
| Sub-menu | เพิ่ม/จัด child rows ให้ครบตาม design: `รายบุคคล`, `เพิ่มพนักงาน`, `อนุมัติคำสั่งซื้อ`, `นโยบายส่วนลด`, `การแจ้งเตือน` |
| Active state | เมื่ออยู่หน้า `อนุมัติคำสั่งซื้อ` จะ active เฉพาะ child row นี้ และ parent `สิทธิ์การใช้งาน` เปิดอยู่โดยไม่ highlight ซ้ำ |
| PO approval route | `/companies/[companyId]/settings/po-approval` เปลี่ยนจาก placeholder เป็นหน้าตั้งค่าตามภาพ reference |
| Amount rules | เพิ่ม 3 ขั้นอนุมัติ: `ยอดไม่เกิน ฿1000` เป็น Auto approve, `มากกว่า ฿1,000 ถึง ฿10000` ให้ผู้จัดการอนุมัติ, และ `มากกว่า ฿10,000` ให้ผู้จัดการหรือเจ้าของ |
| Test condition | เพิ่ม card `ทดลองเงื่อนไข` พร้อม input ยอดใบสั่งซื้อ และ timeline 3 ขั้นตามภาพ |
| Expense link note | เพิ่มกล่องเขียว `เชื่อมกับ “ค่าใช้จ่าย+ใบเสร็จ”` อธิบายว่าใบสั่งซื้อที่อนุมัติครบจะเข้าสู่รายการซื้อ/รายจ่าย |
| Reuse | เพิ่ม `MangmeeBranchChip` เป็น component กลาง แล้วให้หน้า permissions และ PO approval ใช้ร่วมกัน |
| API boundary | ตรวจแล้ว backend มี action อนุมัติ/ปฏิเสธ/ออก PO อยู่ใน procurement แต่ยังไม่มี persisted contract สำหรับตั้งค่า threshold ตามวงเงิน รอบนี้จึงไม่ทำ fake save mutation |

รอบตรวจหน้า `สิทธิ์รายบุคคล` ล่าสุด:

| ส่วน | สิ่งที่ปรับ |
|---|---|
| Route | `/companies/[companyId]/settings/access-overview` เปลี่ยนเป็นหน้า `สิทธิ์รายบุคคล` ตามภาพ design |
| Menu mapping | child `รายบุคคล` ใต้ `สิทธิ์การใช้งาน` ชี้ไป `/settings/access-overview` แล้ว ส่วน parent `/settings/permissions` ยังเป็นหน้า matrix `สิทธิ์การใช้งาน` |
| Header | เพิ่ม title `สิทธิ์รายบุคคล` และ subtitle `ปรับสิทธิ์เมนู สาขา ตำแหน่ง และสถานะบัญชีของพนักงานเป็นรายคน — ค่าเริ่มต้นมาจากตำแหน่ง` |
| Employee list | เพิ่ม panel พนักงานด้านซ้าย มี search, role filter chips และรายชื่อ 9 คนตาม design |
| Selected profile | เพิ่ม card `คุณนภา วงศ์กอง`, badge `เจ้าของ`, email `napa@room45.co`, และ account status toggle |
| Visible menus | เพิ่มกล่องเขียว `เมนูที่ คุณนภา วงศ์กอง จะเห็นจริง` พร้อม chips เมนูและ icon tone ครบ |
| Branch access | เพิ่ม card `สาขาที่เข้าถึงได้`, badge `เข้าถึงทุกสาขา (เจ้าของร้าน)` และ branch chips 3 สาขา |
| Individual permissions | เพิ่ม section `สิทธิ์เฉพาะบุคคล` พร้อม badge `super-admin` และ rows toggle ตามเมนู |
| Sidebar UX | เพิ่ม auto-scroll ให้ active child ใน sidebar แสดงอยู่ใน viewport และแก้ SVG icon sizing ไม่ให้ custom icon ล้น |

### 6. API/Module Readiness

ตรวจแล้วว่า module ที่มี API/page เดิม เช่น expenses, reports, notifications และ permissions ยังใช้ route/API เดิมของระบบ ส่วนเมนู prototype ที่ backend ยังไม่ครบถูกเปิดเป็น planned route แบบ read-only/placeholder เพื่อให้เมนูและ navigation ตรง design แต่ไม่สร้าง fake mutation หรือ fake success

ไฟล์ที่เกี่ยวข้อง:

- `apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts`
- `apps/web/src/features/web-core-workspace/web-core-workspace.spec.ts`
- `apps/web/app/(workspace)/companies/[companyId]/inbox/page.tsx`
- `apps/web/app/(workspace)/companies/[companyId]/sales/page.tsx`
- `apps/web/app/(workspace)/companies/[companyId]/customers/page.tsx`
- `apps/web/app/(workspace)/companies/[companyId]/bookings/page.tsx`
- `apps/web/app/(workspace)/companies/[companyId]/crm-reports/page.tsx`
- `apps/web/app/(workspace)/companies/[companyId]/broadcast/page.tsx`
- `apps/web/app/(workspace)/companies/[companyId]/journal/page.tsx`
- `apps/web/app/(workspace)/companies/[companyId]/sales-documents/page.tsx`
- `apps/web/app/(workspace)/companies/[companyId]/period-closing/page.tsx`
- `apps/web/app/(workspace)/companies/[companyId]/settings/permissions/page.tsx`
- `apps/web/app/(workspace)/companies/[companyId]/settings/po-approval/page.tsx`
- `apps/web/app/(workspace)/companies/[companyId]/settings/discount-policy/page.tsx`

สำหรับ feature ที่ยังไม่มี backend contract สมบูรณ์ เช่น inbox, bookings, broadcast, discount policy ยังเป็น planned page และต้องทำ API, permission, audit, test เพิ่มก่อนเปิดเป็น business flow จริง

สำหรับ `รายบุคคล` ตอนนี้มีหน้า design-aligned ที่แสดงโครงสิทธิ์จริงตามภาพแล้ว โดยแยกจากหน้า backend matrix เดิมเพื่อไม่ทำให้ route ชนกัน ส่วนการเชื่อม live mutation รายบุคคล เช่น menu override ต่อคน ควรต่อกับ contract ใน `docs/specs/mangmee-flow-a-be-integration-spec.md` เรื่อง `MembershipMenuOverride` ในรอบถัดไป

สำหรับ `อนุมัติคำสั่งซื้อ` ตอนนี้มีหน้า settings ตาม design แล้ว แต่ยังเป็น UI/model สำหรับกำหนดและทดลองเงื่อนไขวงเงินใน frontend ก่อน เพราะยังไม่พบ API สำหรับบันทึก policy threshold โดยตรง ต้องเพิ่ม backend contract/table หรือ reuse policy service ให้ชัดก่อนเปิดการแก้ไข/บันทึกจริง

### 7. Company Mock Account และ RBAC

สร้าง/ปรับ account สำหรับ login ในมุมมอง Company:

| รายการ | ค่า |
|---|---|
| Username | `Company` |
| Password | `Company@123` |
| Company route | `/companies/seed-local-company/dashboard` |
| Role | `COMPANY_VIEW` |
| Display ตาม design | ผู้ใช้ `นภา`, ตำแหน่ง `เจ้าของ` |

สิ่งที่ทำเพิ่ม:

- เพิ่ม `COMPANY_VIEW` เข้า API permission registry เป็น system role แบบถาวร
- ให้สิทธิ์เฉพาะ read/menu permissions ที่จำเป็นต่อ company shell เพื่อให้เมนูครบและ JWT cookie ไม่ใหญ่เกิน
- Sync permissions ลง local DB แล้ว role `COMPANY_VIEW` มี 23 grants
- ตรวจว่า login ด้วย `Company / Company@123` สำเร็จและ redirect ไป dashboard ได้

## Unit Test ที่เพิ่ม/ปรับ

เพิ่ม test สำหรับ helper กลาง:

`apps/web/src/common/components/mangmee/mangmee-design.spec.ts`

ครอบคลุม:

- module key ที่รู้จักต้อง map ไป tone ที่ถูก
- unknown key ต้อง fallback จาก nav group
- tone ทุกตัวต้องมี icon และ badge class
- initials สำหรับ Thai avatar ต้องถูกต้อง

เพิ่ม test ใน workspace registry:

`apps/web/src/features/web-core-workspace/web-core-workspace.spec.ts`

ครอบคลุม:

- permission-aware filtering ของ menu prototype
- planned route ยัง clickable ได้เมื่อ user มี permission
- module ready/planned state ถูกต้อง
- settings sub-menu ต้อง nest อยู่ใต้ `สิทธิ์การใช้งาน` และไม่ render `อนุมัติคำสั่งซื้อ` เป็น top-level row

เพิ่ม test ใน API permission registry:

`apps/api/src/modules/auth/permission-registry.spec.ts`

ครอบคลุม:

- `COMPANY_VIEW` ต้องอยู่ใน `SYSTEM_ROLES` และ `ROLE_GRANTS`
- grants ของ `COMPANY_VIEW` ต้องอ้าง permission key ที่มีจริง
- `COMPANY_VIEW` ต้องมี permission ที่จำเป็นต่อ Mangmee company shell
- `COMPANY_VIEW` ต้องไม่ถือ `system.*` platform permissions

เพิ่ม test สำหรับหน้าอนุมัติคำสั่งซื้อ:

`apps/web/src/features/employee-access/po-approval-settings.model.spec.ts`

ครอบคลุม:

- ยอด `100` และ `1000` ต้องเข้า rule Auto approve
- ยอด `1001` ถึง `10000` ต้องเข้า rule ผู้จัดการอนุมัติ
- ยอดเกิน `10000` ต้องเข้า rule ผู้จัดการหรือเจ้าของ
- demo flow สำหรับยอด `100` ต้องแสดง `Auto approve ทันที`
- input ที่มี `฿` และ comma ต้อง normalize ก่อนคำนวณ rule ได้ถูกต้อง

เพิ่ม test สำหรับหน้า `สิทธิ์รายบุคคล`:

`apps/web/src/features/employee-access/individual-permissions-prototype.model.spec.ts`

ครอบคลุม:

- default selected employee ต้องเป็น `คุณนภา วงศ์กอง` role `เจ้าของ`
- filter พนักงานตาม role และ search query ต้องถูกต้อง
- จำนวนเมนูที่เห็นจริงและจำนวนสาขาต้องตรง design

## Verification

รันคำสั่งตรวจแล้ว:

| Command | Result |
|---|---|
| `corepack pnpm --filter @watchdog-bms/design-tokens build` | ผ่าน |
| `corepack pnpm --filter @watchdog-bms/web typecheck` | ผ่าน |
| `corepack pnpm --filter @watchdog-bms/web test` | ผ่าน 163 tests |
| `corepack pnpm --filter @watchdog-bms/web exec tsx --test src/features/employee-access/permission-matrix-prototype.model.spec.ts` | ผ่าน 3 tests |
| `corepack pnpm --filter @watchdog-bms/web exec tsx --test src/features/employee-access/po-approval-settings.model.spec.ts src/features/web-core-workspace/web-core-workspace.spec.ts` | ผ่าน 17 tests |
| `corepack pnpm --filter @watchdog-bms/web exec tsx --test src/features/employee-access/individual-permissions-prototype.model.spec.ts src/features/employee-access/po-approval-settings.model.spec.ts src/features/web-core-workspace/web-core-workspace.spec.ts` | ผ่าน 20 tests |
| `corepack pnpm --filter @watchdog-bms/web test` | ผ่าน 173 tests |
| `corepack pnpm --filter @watchdog-bms/api typecheck` | ผ่าน |
| `corepack pnpm --filter @watchdog-bms/api exec tsx --test src/modules/auth/permission-registry.spec.ts` | ผ่าน 7 tests |
| Permission sync script | ผ่าน: 301 permissions, 12 roles, 1162 grants |
| Login `Company / Company@123` | ผ่าน: 200 และ redirect ไป `/companies/seed-local-company/dashboard` |
| `HEAD /companies/seed-local-company/dashboard` หลัง login | 200 |
| `HEAD /companies/seed-local-company/inbox` หลัง login | 200 |
| `HEAD /companies/seed-local-company/settings/permissions` หลัง login | 200 |
| Rendered dashboard HTML | พบเมนู design ครบ, `ทุกสาขา (รวม)`, `สวัสดี นภา`, `฿86,400` |
| Playwright desktop screenshot | ผ่านด้วย system Chrome ที่ viewport `1600x900`, ไฟล์ `/private/tmp/watchdog-company-dashboard-fixed.png` |
| Playwright permissions screenshot | ผ่านด้วย system Chrome ที่ viewport `1600x900`, ไฟล์ `/private/tmp/watchdog-permissions-matrix-final.png` |
| Playwright individual permissions screenshot | ผ่านด้วย system Chrome ที่ viewport `1600x900`, ไฟล์ `/private/tmp/watchdog-individual-permissions-final.png` |
| Playwright PO approval screenshot | ผ่านด้วย system Chrome ที่ viewport `1600x900`, ไฟล์ `/private/tmp/watchdog-po-approval-final.png` |
| `HEAD /` บน dev server | 200 |
| `HEAD /login` บน dev server | 200 |
| `HEAD /companies/demo/dashboard` บน dev server | 307 ไป `/login?next=%2Fcompanies%2Fdemo%2Fdashboard&fresh=1` ตาม auth guard |

หมายเหตุ: รอบแรกของ web test ติด sandbox เพราะ `tsx --test` ต้องสร้าง IPC socket ใน temp directory ของ macOS จึงรันซ้ำแบบขอสิทธิ์เพิ่ม และผ่านเรียบร้อย

Dev server เปิดไว้ที่:

`http://127.0.0.1:3000`

## เหตุผลทาง Engineering

- แยก token และ component กลางเพื่อไม่ให้แต่ละ feature สร้างสี/spacing/button/table เอง
- เปิด planned route ได้เฉพาะแบบ placeholder/read-only เพื่อให้ menu/navigation ตรง design โดยไม่หลอกว่ามี business transaction จริง
- ใช้ module registry และ permission helper เดิมต่อ เพื่อไม่ทำให้ RBAC/ABAC drift
- เพิ่ม `COMPANY_VIEW` ใน API registry แทนการ patch เฉพาะ DB เพื่อให้ seed/sync รอบถัดไปไม่ลบ role หรือ grants ที่ company mock ต้องใช้
- แก้ `bell.svg` ให้ใช้ `fill="currentColor"` เพื่อให้ไอคอน notification/broadcast แสดงสีตรง tone ไม่เป็นกล่องว่าง
- ปรับทีละชั้นจาก shell, shared component, page layout, แล้วค่อย feature page เพื่อให้ migrate ต่อได้ง่าย
- เพิ่ม unit test ที่จุด helper/registry เพราะถ้า map สี/icon หรือ role grants ผิด จะกระทบ sidebar/card/เมนูหลายหน้าในอนาคต

## งานที่ควรทำต่อ

1. เปิด local stack พร้อม seed data แล้วเทียบ screenshot กับ HTML reference แบบจอ desktop/tablet/mobile
2. ย้าย feature pages ที่เหลือให้ใช้ `MangmeePage`, `MangmeeCard`, `mangmee-table`, `mangmee-input`, `mangmee-btn`
3. ตกลงลำดับ backend สำหรับ prototype flows ที่ยังไม่ครบ เช่น inbox, booking, broadcast, PO approval, discount policy
4. เพิ่ม screenshot regression test หลังจาก route และ seed data เสถียร
5. สรุป design checklist ให้ dev ใช้ก่อน merge feature page ใหม่ทุกครั้ง
