# Agent Memory: H-02 — ปิด global chart-of-account poisoning จาก mass assignment

Status: DONE 2026-07-18 — implemented, 8-angle review pass, findings fixed, checklist ticked
Owner: Claude session 2026-07-18 (requested by thawatchai)
Scope: apps/api ledger module (chart-of-accounts create/update) + DB constraint; per docs/security-remediation-checklist-merged-2026-07-17.md H-02
Decisions:
- ใช้ pattern เดียวกับ `employee-access.dtos.ts` (concrete class DTO + global ValidationPipe whitelist/forbidNonWhitelisted)
- Defense สองชั้น: DTO ที่ HTTP edge + explicit allowlist ที่ `PrismaLedgerRepository.updateAccount` (terminal sink); ตัด mapping ชั้นที่สามใน use case ออกตาม review (สาม copy = drift risk แบบ silent-drop)
- `ACCOUNT_CLASSES` derive จาก `LEDGER_ACCOUNT_CLASS_LABELS` (contracts) — Record บังคับ exhaustive ตอน compile
- คอลัมน์ NOT NULL (`nameTh`, `status`) ใช้ `@ValidateIf(v !== undefined)` แทน `@IsOptional` เพราะ IsOptional ปล่อย explicit null ทะลุไป 500 ที่ Prisma (พิสูจน์เชิงประจักษ์แล้ว); คอลัมน์ nullable ยังรับ null เพื่อ clear ได้ตามเดิม
- Create ตรวจ `parentAccountId`: ต้อง resolve ได้และเป็นของ tenant เดียวกันหรือ system account (กัน cross-tenant hierarchy edge + FK-500)
- DB CHECK `ChartOfAccount_company_or_system_check` = `companyId IS NOT NULL OR isSystem = true`; fail-closed by design + DO-block pre-check ที่ RAISE พร้อมคำสั่ง triage (row เสีย auto-heal ไม่ได้ — tenant ไม่รู้, flip isSystem = globalize ยิ่งแย่)
- Global system account สร้างได้ทาง migration/seed เท่านั้น — ไม่มี API path
- `GLOBAL_VALIDATION_PIPE_OPTIONS` แชร์ระหว่าง main.ts กับ DTO specs กัน config drift
Open questions: (none)
Artifacts:
- `apps/api/src/modules/ledger/presentation/http/ledger.dtos.ts` + `ledger.dtos.spec.ts` (ใหม่)
- `apps/api/src/modules/ledger/application/use-cases/account.use-case.ts` + `account.use-case.spec.ts` (ใหม่)
- `apps/api/src/modules/ledger/infrastructure/prisma-ledger.repository.ts` (explicit allowlist, param typed จาก contracts)
- `apps/api/src/modules/ledger/presentation/http/ledger.controller.ts` (@Body any → DTO)
- `apps/api/src/common/pipes/validation-pipe.options.ts` (ใหม่) + `apps/api/src/main.ts` ใช้ร่วม
- `apps/api/prisma/migrations/20260718090000_h02_coa_company_or_system_check/migration.sql`
- ทั้งสอง spec ลงทะเบียนใน apps/api/package.json test list แล้ว
Verification:
- ledger specs 51/51 pass (รวม dtos 10 + account use-case 7 ใหม่); tsc --noEmit สะอาด (ยกเว้น employee-access.logic.spec ของงาน H-01 session อื่นใน shared tree)
- Local DB (docker :15432): constraint ปฏิเสธ companyId NULL+isSystem false, ยอมรับ isSystem true; migration SQL idempotent re-run ผ่าน; pre-check RAISE ยิงจริงเมื่อมี row เสีย (ทดสอบใน txn แล้ว rollback)
- Review: 8 finder angles + verify → CONFIRMED 5 (null bypass, parentAccountId cross-tenant, triple mapping, enum ซ้ำ, spec/config ซ้ำ) fix ครบ; PLAUSIBLE 2 (migration fail-closed → เพิ่ม diagnostic pre-check; posting/generate ไม่มีเจ้าของ → note ใน checklist); no-change 2 (Thai guard ใน create เก็บเป็น use-case-layer defense; status union type refactor เกิน scope)
- ระหว่างทาง: resolve stale failed migration record `20260712140000_crm_booking_canonical_customer` ใน local DB (เนื้อหา apply แล้วใต้ชื่อ 130000 เดิม) ด้วย migrate resolve --applied
Next:
- Deploy prod: รัน pre-check `SELECT count(*) FROM "ChartOfAccount" WHERE "companyId" IS NULL AND "isSystem" = false;` ก่อน migrate deploy (ถ้า >0 triage ตามข้อความ RAISE)
- H-03 ควรครอบ `posting/generate` sink หรือเพิ่ม item เจ้าของ (note ไว้ใน checklist H-02 แล้ว)
- ไม่มี standing DB-backed test สำหรับ constraint (repo ไม่มี DB test infra ใน apps/api) — evidence เป็น manual verification ที่บันทึกไว้ข้างบน; ถ้าจะ squash migrations หรือใช้ db push ต้อง carry CHECK นี้ไปด้วย
