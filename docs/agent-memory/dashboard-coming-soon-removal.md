# Agent Memory: dashboard-coming-soon-removal

Status: Done (uncommitted)
Owner: thawatchai
Scope: ลบส่วน "เร็ว ๆ นี้" (placeholder widgets ของโมดูลที่ยังไม่เปิด) ออกจากแดชบอร์ด ทั้งฝั่ง web และต้นทางฝั่ง api

Decisions:
- ปิดที่ต้นทาง ไม่ใช่ซ่อนอย่างเดียว: ลบ `ModuleStatusProvider` ทิ้ง (เป็น static array `FUTURE_MODULES` 5 รายการ ไม่แตะ DB) แทนการใส่ feature flag — flag จะกลายเป็น dead code รอ และ git เก็บโค้ดเดิมไว้อยู่แล้ว
- คงตัวกรอง `!w.unavailableReason` ฝั่ง web ไว้ เพราะ snapshot row เก่าใน DB ยังมี widget เหล่านี้ค้างใน `metricsJson` และ `toDto()` จะ fallback ไปอ่านค่านั้นเมื่อ snapshot ยัง fresh
- คง `'module_status'` ใน `DashboardWidgetKind` (packages/contracts) ไว้ ด้วยเหตุผลเดียวกัน — snapshot เก่ายังถือ kind นี้อยู่
- ไม่แตะ `InventoryHealthProvider`: มัน early-return ก่อนยิง Prisma อยู่แล้วเมื่อไม่มีสิทธิ์ `inventory.report.read` / `inventory.product.read` และเมื่อมีสิทธิ์มันคือ widget จริงที่ไปแสดงในส่วน "ภาพรวม"

Artifacts:
- apps/web/src/features/dashboard-notifications/DashboardPages.tsx (ลบบล็อก "เร็ว ๆ นี้", ตัวแปร `unavailableWidgets`, และสาขา unavailable ใน `WidgetCard` ที่กลายเป็น dead code)
- apps/api/src/modules/dashboard-notifications/application/providers/module-status.provider.ts (ลบไฟล์)
- apps/api/src/modules/dashboard-notifications/application/use-cases/generate-snapshot.use-case.ts (เหลือ provider เดียว ไม่ต้อง Promise.all)
- apps/api/src/modules/dashboard-notifications/dashboard-notifications.module.ts (ถอดออกจาก providers)

Verification:
- `pnpm exec tsc --noEmit` ที่ apps/web → ผ่าน
- `pnpm exec tsc --noEmit` ที่ apps/api → ผ่าน
- บูต API จริง (`node apps/api/dist/apps/api/src/main.js`, PORT=3999) → `GET /v1/health` = 200 `{"status":"ok","db":"ok"}`, boot log ไม่มี error → ยืนยัน Nest DI ยังผูกครบหลังถอด provider
- ไม่ได้ตรวจผ่านเบราว์เซอร์ (หน้าแดชบอร์ดต้อง auth + DB ครบ)

Next:
- ถ้าจะเปิดโมดูลใหม่ในอนาคต ให้เพิ่ม provider จริงที่ปล่อย widget ที่มี metrics ไม่ใช่คืน placeholder ที่มี `unavailableReason`
