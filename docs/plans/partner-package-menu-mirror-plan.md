# Plan: แพ็กเกจการใช้งาน = กระจกของเมนูบริษัท

Status: READY FOR IMPLEMENTATION
Spec: `docs/specs/partner-package-menu-mirror-spec.md` (อ่านก่อนเริ่ม — ตารางผูกเมนูอยู่ §5 กติกาอยู่ §3/§6/§7)
Owner: Claude (harness engineer) → Codex (implementation)
Scope: `packages/contracts` + `apps/api` (gate, helper, registry, bundle, backfill script) + `apps/web` (nav gate 1 จุด, logic, UI)
ไม่มี Prisma migration ไม่มี permission key ใหม่

## Phase 1 — contracts + การบังคับใช้ฝั่ง API

1. `packages/contracts/src/feature-entitlements.ts`
   - เพิ่ม 3 feature ใหม่: `reimbursement` (group finance, label `การเบิกจ่าย`), `product_catalog` (operate, `สินค้าและบริการ`), `line_oa` (operate, `เชื่อมต่อ LINE OA`) — `submenus: []` ทั้งสามตัว
   - แก้ `crm.overview` เป็น label `รายงาน CRM`, route `/crm-reports`, `permissionKeys: ['crm.report.read']` (คง key เดิม)
   - เพิ่ม `export const LEGACY_FEATURE_INHERITANCE` ตาม spec §6
2. `packages/contracts/src/menu-entitlements.ts` (ไฟล์ใหม่) — `MenuEntitlementBinding` + `MENU_ENTITLEMENT_BINDINGS` ตาม spec §5 และ `FEATURE_PACKAGE_PRESETS` ตาม §8
   `gatePermissions` **ต้องคัดลอกจาก `apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts` ตรงตัว** (ยกเว้น `dashboard` ที่กลายเป็น `['dashboard.read']` ในข้อ 7) — export ทั้งสองไฟล์จาก package index
3. `apps/api/.../feature-gate.logic.ts` — แก้/เพิ่ม `PREFIX_FEATURE_RULES` ตาม spec §4 ลำดับสำคัญ: `crm.channel.` และ `crm.ai.` ต้องอยู่ก่อน `crm.`
4. `apps/api/.../entitlement.helper.ts` — ใส่กติกา `LEGACY_FEATURE_INHERITANCE` (§6) ก่อนขั้นสืบทอดลูกเมนู
5. `apps/api/.../feature-registry.ts` — `DEFAULT_ENABLED_FEATURE_KEYS` += `reimbursement`, `product_catalog`, `line_oa`, `dashboard_notifications` (กับดัก T3)
6. `apps/api/src/modules/auth/permission-registry.ts` — STAFF bundle += `dashboard.read` (กับดัก T1)
7. `apps/web/.../web-core-workspace.constants.ts` — แคบ nav gate 3 จุดตาม spec §5.1 (พร้อมคอมเมนต์เหตุผลแบบเดียวกับโมดูลอื่นในไฟล์)
   - `dashboard`: `['dashboard.read']`
   - `reports`: `['report.catalog.read']`
   - `accounting`: `['accounting.document.read', 'accounting.invoice.read']`
8. สคริปต์ backfill `apps/api/src/scripts/backfill-dashboard-entitlement.ts` — อัปเดตแถว `CompanyFeatureEntitlement` ที่ `featureKey='dashboard_notifications' AND enabled=false` ให้เป็น `true` พร้อม log จำนวนแถว (กับดัก T2) และบันทึกขั้นตอนใน memory doc ว่าต้องรันตอน deploy พร้อม permission sync
9. เทสต์ฝั่ง API (ต้อง **append ชื่อไฟล์ใน `apps/api/package.json` script `test`** ไม่งั้นไม่ถูกรัน)
   - ต่อยอด `feature-gate.logic.spec.ts`: key ใหม่ 3 ตัวคุม prefix ของตัวเองจริง, `dashboard.`/`notification.` ถูก strip เมื่อ `dashboard_notifications` ปิด, `crm.channel.*` ตาม `line_oa` ไม่ใช่ `crm`, `crm.ai.read` ยังตาม `ai_line_assistant`
   - ไฟล์ใหม่ `menu-entitlement-binding.spec.ts` = ข้อพิสูจน์หลัก (AC1/AC2): วนทุก binding → สร้าง entitled set ที่เปิดทุก key ยกเว้น `entitlementKeys` ของ binding นั้น → ยืนยันว่า `filterPermissionsByEntitlement` ตัด `gatePermissions` **ครบทุกตัว** (เมนูหาย) และเมื่อเปิดคืน อย่างน้อยหนึ่งตัวรอด (เมนูกลับมา) พร้อมยืนยันว่า `entitlementKeys` ทุกตัวอยู่ใน `ALL_FEATURE_ENTITLEMENT_KEYS`
   - `entitlement.helper` inheritance: บริษัทเดิมที่มี `expenses: true` ไม่มีแถว `reimbursement` → ยังได้ `reimbursement.*` (AC3)
   - `set-partner-features.use-case.spec.ts`: รับ key ใหม่ 3 ตัว, ปฏิเสธ key มั่ว, ส่งหลาย key พร้อมกันในคำขอเดียว

## Phase 2 — หน้าจอแอดมิน (กระจกเมนู + พรีวิว + แพ็กเกจ + บันทึกรวม)

10. `apps/web/.../system-partners.logic.ts` — ฟังก์ชันบริสุทธิ์ทั้งหมด พร้อม `.spec.ts`
    - `buildMenuCards(bindings, catalog, entitlements)` → การ์ดเรียงตามกลุ่มแถบเมนูจริง พร้อมสถานะการ์ด (§7) และลูกเมนูของ parent
    - `toggleMenuCard(state, binding, next)` → รายการ change ตาม §7
    - `toggleSubmenu(state, submenuKey, next)` (คงพฤติกรรมเดิม)
    - `applyPreset(state, presetKey)` → สถานะเต็มชุด (§8, `expense_auto_post` เป็น false เสมอ)
    - `diffEntitlements(server, pending)` → `{ turningOn[], turningOff[] }` พร้อมป้ายเมนูไทย
    - `previewNavGroups(cards)` → โครงแถบเมนูที่ลูกค้าจะเห็น (กลุ่ม + ป้าย + ไอคอน + สถานะปิด)
    - `filterMenuCards(cards, query)` — ค้นด้วยป้ายไทย / route / key
11. `apps/web/.../web-core-workspace.spec.ts` (หรือไฟล์ใหม่) — parity: ชุด `navKey` ของ `MENU_ENTITLEMENT_BINDINGS` เท่ากับ `WORKSPACE_MODULES` และทุกตัว `group`/`iconKey`/`gatePermissions` ตรงกับโมดูล (กันดริฟต์ P7)
12. `PartnerDetailPage.tsx` — แทน `FeatureEntitlementsSection` ด้วย `PackageMenuSection` ตาม spec §9
    - state ที่ยังไม่บันทึกอยู่ในคอมโพเนนต์ + ปุ่มคืนค่า
    - ปุ่มแพ็กเกจ 3 ปุ่ม + เปิด/ปิดทั้งกลุ่ม
    - แผงพรีวิวสติกกี้ + สวิตช์ "แสดงเมนูที่ปิดด้วย"
    - แถบล่างสรุปจำนวนที่เปลี่ยน → โมดัล diff (แดง=จะหาย, เขียว=จะเพิ่ม) → `setPartnerFeatures` ครั้งเดียวเฉพาะ key ที่เปลี่ยน → refetch + toast
    - ส่วน "การทำงานเบื้องหลัง" สำหรับ `expense_auto_post` (คง error COA readiness เดิม)
    - `fieldsLocked` ล็อกทุกอย่างเหมือนเดิม
13. `docs/agent-memory/partner-package-menu-mirror.md` ตามเทมเพลต + บันทึกขั้นตอน deploy (backfill + permission sync)

## Verification protocol (harness รันซ้ำเองทั้งหมด — ไม่เชื่อรายงาน)

1. `corepack pnpm --filter @watchdog-bms/contracts build`
2. `corepack pnpm --filter @watchdog-bms/api test` → 0 fail และ **ยืนยันว่าไฟล์ spec ใหม่ถูกเพิ่มใน script `test` จริง** (grep ชื่อไฟล์ใน `apps/api/package.json`)
3. `corepack pnpm --filter @watchdog-bms/web test` → `typecheck` → `build`
4. อ่าน diff ทั้งก้อนเทียบกติกา §3/§6/§7 โดยเฉพาะ: ลำดับ prefix rule, ไม่มี Prisma migration, ไม่มี permission key ใหม่, `crm.overview` ไม่ถูกเปลี่ยน key
5. พิสูจน์ backward compat (AC3) ด้วยเทสต์ที่รันจริง ไม่ใช่การให้เหตุผล
6. เดินหน้าจอจริง: ปิด `การเบิกจ่าย` ของบริษัททดสอบ → เมนูหายจากแถบข้างบริษัทนั้น, `ค่าใช้จ่ายและใบเสร็จ` ยังอยู่, API เบิกจ่ายตอบปฏิเสธ

## Rollout

รัน permission sync (STAFF ได้ `dashboard.read`) **ก่อน** deploy โค้ดที่เปลี่ยน nav gate แล้วจึงรัน backfill `dashboard_notifications` ลำดับนี้กัน STAFF ตกแดชบอร์ดระหว่างทาง
