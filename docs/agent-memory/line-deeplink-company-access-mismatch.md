# Agent Memory: line-deeplink-company-access-mismatch

Status: Diagnosed on UAT; UX now names both the signed-in account and blocked company. Not deployed in this task.

Owner: thawatchai

Scope: `apps/web` company workspace layout + `CompanyAccessUnavailable` screen. No API change.

Decisions:
- The UAT report ("สร้าง staff ใหม่ → ส่งบิลเข้า LINE → กดลิงก์แล้วเจอ *ไม่สามารถเข้าถึงบริษัทนี้ได้*")
  is **not** a permission bug. LINE's in-app browser keeps its own cookie jar, so it was still
  signed in as the previous test account while the LINE identity belonged to the new staff.
- Evidence (UAT, 2026-08-18 15:00 UTC = 22:00 น. ตรงกับสกรีนช็อต):
  - `ExternalIdentity` `Ua7e0c86f…` → `kimtae@gmail.com`, STAFF ของ `cmsyp3ex701ip2j5jdjylqzdq`
    (ป๋อจ้าน Company), ACTIVE, ALL_BRANCHES — ลิงก์จาก AI ชี้บริษัทนี้ถูกต้อง
  - `AuditLog` 15:00:09.579 `auth.session.refresh` ของ `bombamse5@gmail.com` (session ตั้งแต่ 17/08)
  - api log 15:00:09.842 `GET /v1/auth/me` → 200 (ไม่ส่ง company) แล้ว 15:00:10.020 → **403**
    (ส่ง `X-Company-Id: cmsyp3ex…`) — `bombamse5` ไม่ได้เป็นสมาชิกบริษัทนั้น
  - 403 มาจาก `PrismaPermissionResolverRepository.resolveForUser` → `No active company membership.`
- ปุ่ม "ไปยังบริษัทที่ใช้งานได้" ใช้ได้ เพราะพา `bombamse5` กลับบริษัทของตัวเอง — เป็นสัญญาณยืนยันว่าคนละบัญชี
- UX gap ที่แก้: จอเดิมไม่บอกว่ากำลัง login ด้วยบัญชีไหน (อ่านแล้วเหมือน "สิทธิ์ถูกถอน") และปุ่ม
  "ออกจากระบบ" ทิ้งปลายทางของลิงก์
- Follow-up 2026-08-19: scoped `GET /auth/me` denials now return only the requested company's
  display name, so the screen says `บริษัท [ชื่อบริษัท]` instead of `บริษัทนี้`; other forbidden
  responses keep their existing shape. The available-company link centers its label on mobile.

Open questions: none.

Artifacts:
- `apps/web/app/(workspace)/companies/[companyId]/layout.tsx` — forbidden branch เรียก
  `fetchServerSession()` (ไม่ส่ง companyId, จึงผ่าน) เพื่อส่ง `displayName` ให้จอ
- `apps/web/src/features/auth/CompanyAccessUnavailable.tsx` — โชว์ชื่อบัญชีปัจจุบัน และ sign out
  ด้วย `signInAgainPath()` เพื่อคง `next=` ของลิงก์เดิม
- `apps/web/src/features/auth/auth.logic.ts` — `signInAgainPath(pathname, search)`
- `apps/api/src/modules/auth/presentation/auth.guard.ts` — adds `companyName` only to a scoped
  `/auth/me` company-access denial
- `apps/web/src/common/auth/server-session.ts` + company layout — carry that label to the screen
- `apps/web/src/features/auth/auth.logic.ts` — formats the named Thai/English access description
- LINE deep link สร้างจาก `BASE_WEB_URL + webPath` (`line-ai-formatter.logic.ts`) — เป็น URL เปล่า
  ไม่มี session handoff จึงพึ่ง cookie ของเบราว์เซอร์ที่เปิดล้วน ๆ

Verification:
- `pnpm --filter @watchdog-bms/web test` → 951 pass / 0 fail (รวมเคสใหม่ `signInAgainPath`)
- `pnpm --filter @watchdog-bms/web typecheck` → ผ่าน
- `pnpm --filter @watchdog-bms/api exec tsx --test src/modules/auth/auth.guard.spec.ts` → 29 pass / 0 fail
- `pnpm --filter @watchdog-bms/web exec tsx --test src/features/auth/auth.logic.spec.ts` → 11 pass / 0 fail
- `pnpm --filter @watchdog-bms/api typecheck` → ผ่าน
- `pnpm --filter @watchdog-bms/web typecheck` → ผ่าน

Next:
- เวลาสลับบัญชีทดสอบบนมือถือ ต้อง logout ในเบราว์เซอร์ของ LINE ด้วย ไม่ใช่แค่ Safari
- ถ้าอยากตัดปัญหาให้ขาด ต้องมี session handoff ในลิงก์จาก LINE (ยังไม่ทำ, นอก scope)
