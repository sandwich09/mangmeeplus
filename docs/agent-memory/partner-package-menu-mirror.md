# Agent Memory: partner-package-menu-mirror

Status: STARTER PRESET FOLLOW-UP VERIFIED (2026-08-21) — preset aligned to the approved 7-menu baseline
Owner: Claude (harness engineer) → Codex (Phase 1 + Phase 2 implementation/verification)

Scope:
- `packages/contracts` — feature catalog เพิ่ม 3 key, ไฟล์ใหม่ `menu-entitlements.ts` (binding เมนู↔สวิตช์ + preset)
- `apps/api` — prefix rules, entitlement inheritance, default keys, STAFF bundle, backfill script, spec ผูกเมนู
- `apps/web` Phase 1 — nav gate 3 จุด (`dashboard` / `reports` / `accounting`)
- `apps/web` Phase 2 — กระจกเมนูจาก binding, พรีวิวสด, preset, กลุ่ม, submenu, background auto-post, pending diff และ batched save

Decisions:
- หน่วยที่ขาย = เมนูในแถบข้างของบริษัท ไม่ใช่ชื่อโมดูลภายใน หน้าจอแอดมินจึงมิเรอร์แถบเมนูจริง + มีพรีวิวสด (ผู้ใช้เลือกเอง 2026-07-29)
- เพิ่มสวิตช์ใหม่ 3 ตัว `reimbursement` / `product_catalog` / `line_oa` และเปิดบังคับใช้ `dashboard_notifications` ที่เดิมไม่เคยทำงาน
- ไม่แตะ chokepoint เดิม: ยัง strip ที่ `filterPermissionsByEntitlement` ตอน resolve permission — nav กับ API จึงหาย/ปฏิเสธพร้อมกัน
- ไม่มี Prisma migration: key ใหม่ใช้กติกา `LEGACY_FEATURE_INHERITANCE` (บริษัทที่ไม่มีแถว = สืบทอดจาก key ต้นทางเดิม) แทนการ migrate
- บันทึกรวมครั้งเดียว + แพ็กเกจสำเร็จรูป (endpoint `PUT /v1/system/partners/:id/features` รับ array อยู่แล้ว ไม่ต้องแก้ API)
- Preset เป็น explicit data: `starter` / `standard` ระบุ `employee_access` children 3 ตัวและ `company_settings` children 2 ตัวครบ เพราะ `applyPreset` เขียน key ที่ไม่อยู่ในรายการเป็น `false`
- Ownership resolution: `reports` gate เหลือ `report.catalog.read`, `accounting` gate เหลือคีย์ `accounting.*`; `settings` เป็น foundation binding `{ parentFeatureKey: 'company_settings', entitlementKeys: [] }` เพื่อแสดงสวิตช์ลูก ส่วน `discount` คง `{ parentFeatureKey: null, entitlementKeys: [] }`
- Foundation นิยามจาก `entitlementKeys.length === 0` เท่านั้น จึงไม่มีสวิตช์การ์ดและแสดงป้าย "พื้นฐาน — ปิดไม่ได้" แม้มี parent สำหรับผูก submenu
- การเปิด submenu จะเปิด catalog parent ด้วย เพื่อให้บริษัทที่มี explicit `company_settings=false` จาก UI เดิมเปิด สาขา / ความปลอดภัยบัญชี กลับมาได้; การปิดลูกไม่ปิด foundation parent
- คง foundation permission behavior เดิม ไม่ขยาย gate และไม่ย้าย enforcement chokepoint
- คง API/web test runner เป็น `tsx --test`; `apps/api/package.json` เพิ่มเฉพาะ `menu-entitlement-binding.spec.ts` ในรายชื่อ test
- Phase 2 เรนเดอร์ label/group/icon/status/order จาก `MENU_ENTITLEMENT_BINDINGS`; route มาจาก `WORKSPACE_MODULES.buildHref` เพราะ binding ไม่มี route
- state ที่ยังไม่บันทึกเก็บ explicit/absent rows ไว้ เพื่อให้ legacy inheritance ตรงกับ API; diff สำหรับรีวิวใช้ effective state ส่วน payload ใช้ explicit changed rows
- บริษัท legacy ที่ไม่มี entitlement row เลยต้อง materialize fail-open snapshot ในการเขียนครั้งแรก มิฉะนั้น partial row แรกจะทำให้ key อื่นที่ absent ถูกปิดทั้งหมด
- `expense_auto_post` แยกจากเมนู, absent = ปิด และคง client dependency guard + server COA-readiness error message เดิม
- คง production build เป็น Turbopack ตาม repo contract; owner ยืนยัน normal Node 24.14.0 path สร้าง route table ครบและ exit 0 จึงไม่แก้ build config และไม่เปลี่ยนเป็น webpack
- เมื่อกด preset `starter` จะได้ Dashboard + Notifications (shared key), AI แนะนำ, Expenses 6/6, Reimbursement, Employee Access 3/3 และ Company Settings 2/2 รวม 7 เมนู; `standard`/`full`, onboarding/default entitlement และ tax background behavior คงเดิม

Open questions:
- Binding order และป้าย `crm` (`ลูกค้า (CRM)`) ไม่ตรง runtime sidebar registry/dictionary ทุกจุด แม้ parity guard จะยืนยัน navKey/group/icon/gate แล้ว ต้องแก้ source-of-truth contract ก่อนจึงจะ mirror ได้ตรงตัวทั้งหมด

Artifacts:
- `docs/specs/partner-package-menu-mirror-spec.md`
- `docs/plans/partner-package-menu-mirror-plan.md`
- `packages/contracts/src/menu-entitlements.ts`
- `apps/api/src/modules/employee-access/domain/logic/menu-entitlement-binding.spec.ts`
- `apps/api/src/scripts/backfill-dashboard-entitlement.ts`
- `apps/web/src/features/system-partners/PartnerDetailPage.tsx`
- `apps/web/src/features/system-partners/system-partners.logic.ts`
- `apps/web/src/features/system-partners/system-partners.logic.spec.ts`
- `apps/web/src/features/web-core-workspace/web-core-workspace.spec.ts`

Verification:
- 2026-08-21 follow-up: contracts build PASS; API menu/preset 8/8 PASS; web system-partners logic 36/36 PASS; `git diff --check` PASS
- `corepack pnpm --filter @watchdog-bms/contracts build` → PASS (`tsc -p tsconfig.json`, exit 0)
- Preset guard red-before-fix → `starter/roles: card=true menu=false`, `standard/roles: card=true menu=false`; `full` ผ่าน
- Preset guard green-after-fix → starter / standard / full ผ่านทั้งหมด (6 tests, 6 pass, exit 0)
รันโดย harness เองทั้งหมดบนเครื่อง owner (Node 24.14.0) ไม่ใช่รายงานจาก implementer:
- `corepack pnpm --filter @watchdog-bms/api test` → PASS (0 fail) และ `typecheck` → PASS
- `corepack pnpm typecheck` (root, ครบ api/web/workers/ai-gateway) → PASS
- `corepack pnpm test` (root) → PASS
- `corepack pnpm --filter @watchdog-bms/web test` → PASS 565/565 · `typecheck` → PASS
- `corepack pnpm --filter @watchdog-bms/web build` → PASS บน Turbopack path ปกติ ได้ route table ครบ (implementer รายงานว่าค้าง แต่เป็นข้อจำกัด sandbox ของ implementer เอง ไม่ใช่โค้ด)
- `corepack pnpm config:validate` → PASS 39/39 · `prisma:validate` → PASS · `security:audit` → PASS (เหลือ moderate 5 รายการเดิม ต่ำกว่าเกณฑ์ high)
- Binding ownership spec: sellable bindings strip every OR gate and restore at least one when re-enabled; foundation bindings จำแนกด้วย empty `entitlementKeys`, คง gate อย่างน้อยหนึ่งตัวเมื่อ entitlement ทั้งหมดปิด และ preset ทุกตัวบังคับ card/menu parity
- Backward compatibility: `expenses:true` โดยไม่มีแถว `reimbursement` ยังรักษา `reimbursement.*`; explicit false ชนะ
- Phase 2 logic specs cover §7 shared-parent writes, sparse inheritance, zero-row materialization, presets, effective diff, preview grouping, filtering/routes, submenu ownership, legacy parent recovery และ group toggles
- Drift guard compares identical navKey sets plus group/iconKey/gatePermissions for every binding/module pair
- `git diff --check` → PASS

Local end-to-end run (docker stack rebuilt จาก working tree, ฐานข้อมูล local เท่านั้น — ไม่แตะ production):
- `prisma/sync-permissions.ts` → 324 permissions, 12 roles, 1256 grants upserted, 0 revoked; query ยืนยันว่า `dashboard.read` ลงครบทุก company-facing system role รวม STAFF
- `src/scripts/backfill-dashboard-entitlement.ts` → `{"updatedCount":0}` (local มีแถวเดียวและเปิดอยู่แล้ว — ยืนยันว่า idempotent)
- Browser (Playwright, seeded system admin + owner): หน้าจอแสดงครบทั้งการ์ดมิเรอร์เมนู, แผงพรีวิว "เมนูที่บริษัทจะเห็น", ปุ่มแพ็กเกจ 3 แบบ, ป้าย "พื้นฐาน — ปิดไม่ได้", ส่วน "การทำงานเบื้องหลัง"
- Browser: ปิด `การเบิกจ่าย` → บันทึก → แถบเมนูของ owner เปลี่ยนจาก `… หลักฐานทางบัญชี | การเบิกจ่าย | สมุดรายวัน …` เป็น `… หลักฐานทางบัญชี | สมุดรายวัน …` โดย `ค่าใช้จ่ายและใบเสร็จ` ยังอยู่ครบ และเปิดคืนแล้วเมนูกลับมา — ข้อพิสูจน์ตรงว่าสวิตช์แอดมินกับเมนูลูกค้าเป็นสิ่งเดียวกัน
- ยังไม่ได้ทำ: รัน sync/backfill กับฐานข้อมูล production (ต้องทำตาม Deploy order ตอน deploy จริง)

Deploy order (สำคัญ):
1. จาก `apps/api` รัน `./node_modules/.bin/tsx prisma/sync-permissions.ts` เพื่อ re-sync system roles (รวม STAFF) และ backfill `dashboard.read` แบบ additive ให้ company-scoped custom roles ก่อน
2. deploy โค้ด Phase 1 ที่เปลี่ยน nav gates และ entitlement enforcement
3. จาก `apps/api` รัน `./node_modules/.bin/tsx src/scripts/backfill-dashboard-entitlement.ts` เพื่อ backfill `dashboard_notifications=false → true` (สคริปต์ idempotent และ log `updatedCount`)

Next:
- รัน permission sync แล้ว deploy แล้ว backfill ตาม Deploy order กับ environment จริง (UAT ก่อน production)
