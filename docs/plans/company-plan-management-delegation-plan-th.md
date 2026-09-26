# แผน: มอบสิทธิ์จัดการแพ็กเกจบริษัทให้ role ที่ตั้งชื่อเอง

Spec: [company-plan-management-delegation-spec-th.md](../specs/company-plan-management-delegation-spec-th.md)

## งาน

1. ลงทะเบียน `company.plan.manage` และชุด `pack.company.plan.manage`; ตรวจ OWNER ได้ permission โดยอัตโนมัติและ default ADMIN ไม่ได้
2. บังคับให้ OWNER จริงเป็นผู้มอบ permission นี้ใน create/update role และแสดงสถานะ grantable ใน catalog/preview
3. เปลี่ยน package-change request และ billing authorization จากเช็ก role name/key เป็น permission พร้อมตรวจ active membership และ role
4. ใช้ permission เดียวกันใน auth/me company list, company switcher, billing picker, navigation, quota CTA และ plan-term/expired UI
5. ตรวจ auth guard recovery แยก permission ตาม HTTP method และ route สำหรับ identity, business type และ VAT; เพิ่ม VAT GET recovery หาก route รองรับ
6. ทบทวนทุกจุดที่เช็ก OWNER เพื่อแยก package authority จาก legal ownership/last-owner checks
7. เพิ่ม API regression และ E2E ตาม harness ที่มีสำหรับ owner grant, arbitrary custom role, no-permission denial, package flow และ term recovery
8. อัปเดต permission matrix และ task memory

## ตรวจสอบ

- API focused tests: permission registry, role-grant policy, package-change request, billing authorization, plan-term notice และ auth guard recovery
- Web focused checks: workspace navigation และ plan-term logic/UI contracts
- E2E: role builder/employee assignment เข้าถึง billing ด้วย custom role หาก local harness จัด role และ company state ได้
- `git diff --check`; ไม่แก้ package.json และไม่ deploy

## สถานะดำเนินการ

- [x] ลงทะเบียน permission/pack และตรวจ OWNER-only assignment ของ package permission
- [x] เปลี่ยน billing, package request, navigation, company switcher และ recovery ให้ใช้ permission
- [x] เพิ่ม regression สำหรับ role ชื่อเอง, profile/VAT permission และผู้ไม่มีสิทธิ์
- [x] เพิ่ม BR17 E2E สำหรับ role builder → employee login → billing, profile/VAT edit และ denied staff
- [x] API focused 247 tests, Web focused 115 tests, Web typecheck, E2E parse/list และ `git diff --check` ผ่าน
- [x] รัน BR17 browser E2E ผ่านบนฐาน PostgreSQL แยกในเครื่อง (2026-09-26)

การรวมกับ `main` วันที่ 2026-09-26: API และ Web typecheck ผ่านบน worktree แยก; browser E2E ผ่านบนฐานข้อมูลทดสอบแยก
