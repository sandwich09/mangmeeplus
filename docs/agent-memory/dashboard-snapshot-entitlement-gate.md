# Agent Memory: Dashboard snapshot — entitlement decides content, reader decides visibility

Status: Code + tests done 2026-08-04 (unit + tsc); ยังไม่ได้ verify บน docker stack (image ต้อง rebuild)
Owner: Claude (bug report จาก dev localhost: การ์ด "สุขภาพคลังสินค้า" ขึ้นบนบริษัทที่ปิด Inventory)
Scope: `apps/api/src/modules/dashboard-notifications` (generate-snapshot use case, providers 2 ตัว, worker sweep permissions)

## อาการ

บริษัท `Sandwich Com` เปิดเฉพาะ expenses/reimbursement/tax/... และปิด `inventory` + `product_catalog`
แต่ `/dashboard` แสดงการ์ด "สุขภาพคลังสินค้า" การ์ดเดียว และ **ไม่มี** การ์ดค่าใช้จ่ายที่บริษัทซื้อจริง

## Root cause

- `DashboardSnapshot` cache เป็น per (company, periodKind) ไม่ผูกกับ user — `GenerateSnapshotUseCase` คืน snapshot เดิมถ้าอายุ ≤ 15 นาที โดยไม่ดูสิทธิ์ผู้อ่าน
- worker sweep (`snapshot-sweep`, ทุก 15 นาที) เขียนทับ snapshot ของทุกบริษัทด้วย `WORKER_NOTIFICATION_PERMISSIONS` ซึ่งเป็น literal list ที่ **ไม่ผ่าน** `filterPermissionsByEntitlement` → มี `inventory.report.read` เสมอ (คำนวณการ์ดคลังให้บริษัทที่ปิดโมดูล) และไม่มี `expense.read` (การ์ดค่าใช้จ่ายกลายเป็น unavailable แล้วถูก web กรองทิ้งที่ `DashboardPages.tsx`)
- หลักฐาน: snapshot `cmseuzsev000201ogrm5wdzkj` (16:15Z = 23:15 น.) เก็บ `inventory_health` 3 metrics + `expense_summary` unavailable `ต้องการสิทธิ์: expense.read`

## Decisions

- **แยกสองคำถามออกจากกัน**: *อะไรถูกคำนวณ* = feature entitlement ของบริษัท (`loadEntitledFeatureKeys`); *ใครเห็นอะไร* = permission ของ caller ต่อ request. เดิมใช้ permission ของ "คนที่บังเอิญ generate" ตอบทั้งสองคำถาม
- Provider ประกาศ `featureKey` (entitlement ที่ควบคุมการคำนวณ) + `readPermissions` (สิทธิ์ที่มองเห็นการ์ด) และ **ไม่รับ** `permissions` ใน input อีก
- `visibleWidgets()` deny-by-default: widget ที่ `module` ไม่ตรง provider ตัวไหนเลย = ไม่คืน (provider ใหม่ต้องลงทะเบียนใน `providers` getter)
- **Cache invalidation ตาม entitlement**: reuse snapshot เฉพาะเมื่อ module set ของ widget ที่ cache ไว้ตรงกับ provider ที่ entitled ตอนนี้ — ปิดฟีเจอร์แล้วการ์ดต้องหายทันทีที่ load ถัดไป ไม่ใช่รอ 15 นาที
- `toDto` ไม่ fallback ไป `metricsJson.widgets` อีก (เดิม fallback เมื่อ list ว่าง = leak widget ที่ไม่ควรเห็น)
- `WORKER_NOTIFICATION_PERMISSIONS` เหลือ `dashboard.read` + `dashboard.snapshot.generate` (ดู `h-14-internal-services-private-no-owner-synthesis.md`)
- entitled === null (บริษัทไม่มี entitlement row เลย) ยัง fail-open ตาม convention ของ `loadEntitledFeatureKeys`

## Artifacts

- `application/use-cases/generate-snapshot.use-case.ts` (+ `.spec.ts` ใหม่, ลงทะเบียนใน `apps/api/package.json` test list)
- `application/providers/{inventory-health,expense-summary}.provider.ts` (+ specs)
- `application/use-cases/notification-sweeps.use-cases.ts`

## Verification

- `npx tsx --test src/modules/dashboard-notifications/application/{use-cases/generate-snapshot.use-case,providers/expense-summary.provider,providers/inventory-health.provider}.spec.ts` → 13/13 pass
- `npx tsc --noEmit` (apps/api) → clean

## Next

- ต้อง rebuild image `docker compose -f infra/docker/compose.local.yml up -d --build api workers` แล้วเปิด `/dashboard` ซ้ำเพื่อยืนยันว่าการ์ดคลังหาย + การ์ดค่าใช้จ่ายขึ้น
- snapshot เก่าใน DB ไม่ต้องลบ: module-set check บังคับ regenerate ให้เอง
