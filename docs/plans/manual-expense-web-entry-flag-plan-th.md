# Plan: สวิตช์ทางเข้า manual expense บนเว็บ

วันที่: 2026-10-01 · ปรับสถานะล่าสุด: 2026-10-03 · แก้ตาม spec v3.1 (ค่าเริ่มต้นคือไม่แสดง — เจ้าของสั่ง 2 ต.ค. 2569 ยืนยัน 3 ต.ค. 2569)

Status: **สร้างเสร็จ 2–3 ต.ค. 2569 บน branch `claude/manual-expense-web-entry-20261002` (เจ้าของสั่งเริ่ม 2 ต.ค. 2569 เริ่มจาก develop `608b4a6f5`) ยังไม่ push ยังไม่ merge และยังไม่ปล่อย กล่องที่ติ๊กคือขั้นที่ทำเสร็จและมีผลรันจริงใน memory**

ข้อตัดสินใจ D1–D8 ใน spec §1.2: ตัดสินแล้ว 2 ต.ค. 2569 (เจ้าของ: ตามที่แนะนำ) · ครึ่งแรกของ D2 ถูกเจ้าของเปลี่ยนในวันเดียวกัน: **ค่าเริ่มต้นคือไม่แสดงเมนู** ร้านไม่มีแถวอ่านได้ว่าไม่แสดง ผู้ดูแลระบบเปิดให้ทีละร้าน (เจ้าของยืนยัน 3 ต.ค. 2569: “ปิดเป็นค่าเริ่มต้นทุกร้าน รวมร้านเก่าด้วย”)

Source of truth: [Spec v3.1](../specs/manual-expense-web-entry-flag-spec-th.md) · [รีวิวอิสระ](../research/manual-expense-web-entry-flag-review-2026-10-01-th.md) · [Memory](../agent-memory/manual-expense-web-entry-flag.md) · [บั๊กที่แก้แยก](../research/manual-expense-current-code-bugs-2026-10-01-th.md)

แผนนี้เขียนตามคำตอบ D1–D8 ซึ่งเจ้าของตัดสินตามนั้นแล้ว จึงใช้ได้ตามที่เขียนทั้งฉบับ ทางเลือกของ D1 (เป็น key ใน catalog) ไม่ได้เลือก และแผนนี้ใช้กับทางนั้นไม่ได้ สิ่งที่ทางนั้นต้องสร้างเพิ่มเก็บไว้เป็นบันทึกใน spec ภาคผนวก B

## 1. Scope lock ก่อนเริ่ม

- เจ้าของตัดสิน D1–D8 แล้วเมื่อ 2 ต.ค. 2569 และวันที่บันทึกใน memory แล้ว เจ้าของสั่งเริ่ม implement ในวันเดียวกัน และเปลี่ยนค่าเริ่มต้นเป็นไม่แสดง ซึ่งเจ้าของยืนยันเมื่อ 3 ต.ค. 2569 ว่ารวมร้านเดิมด้วย (spec §1.2)
- เปลี่ยนเฉพาะสี่กลุ่ม: ที่เก็บค่าตั้งรายร้านกับ command ของผู้ดูแล, field เดียวใน `/auth/me`, helper/gate/ทางเข้าฝั่งเว็บ และสวิตช์ในหน้าผู้ดูแล
- **ห้ามแก้** `packages/contracts/src/feature-entitlements.ts`, `menu-entitlements.ts`, `SetPartnerFeaturesUseCase`, โมดูล billing, onboarding, `normalize-entitlements`, โมดูล LINE, `apps/ai-gateway`, expense guards และ expense use cases ถ้าพบว่าจำเป็นต้องแก้ไฟล์กลุ่มนี้ ให้หยุดและถามก่อน เพราะแปลว่าออกนอก spec
- ไม่รวมการแก้บั๊ก B1, B3, B4 ใน[เอกสารบั๊กแยก](../research/manual-expense-current-code-bugs-2026-10-01-th.md)
- ไม่เพิ่ม environment switch, permission, pack, SKU หรือ entitlement key
- ไม่แก้ `package.json` เว้นแต่เป็นการเปลี่ยน dependency (งานนี้ไม่มี) ดูข้อยกเว้นเรื่องการลงทะเบียน spec ใน §4
- ก่อน code edits อ่าน ponytail full จาก `.agents/skills/ponytail/SKILL.md` ใน checkout นี้ (path `/Users/spare058/WatchDog-BMS/...` ใน instructions เก่าเป็น stale path)
- `apps/web/AGENTS.md` กำหนดให้อ่าน Next.js docs ที่ติดตั้งจริงก่อนเขียน web code หัวข้อที่เกี่ยวคือ `use-router` (router.refresh), client cache และ `staleTimes`
- ไม่มี requirement ให้ใช้ legacy role agents หรือ legacy role-gate templates

## 2. File/change inventory

| กลุ่ม | Files / symbols หลัก | งาน |
| --- | --- | --- |
| Schema | `apps/api/prisma/schema.prisma`, migration ใหม่หนึ่งรายการใต้ `apps/api/prisma/migrations/`, `apps/api/prisma/seed.ts` | model ค่าตั้งรายร้าน (spec §5.1) สร้างตารางใหม่อย่างเดียว และแถว “แสดง” ของร้านตัวอย่างใน seed |
| Contracts | `packages/contracts/src/partner-management.ts` | DTO ของค่าตั้งใน `PartnerCompanyDetailDto` และ body/result ของ command |
| Admin API | use case ใหม่ข้าง `set-partner-ocr-config.use-case.ts`, `domain/logic/manual-expense-web-entry.logic.ts` (จุดตัดสินเดียวของค่าเริ่มต้น), `presentation/http/partner.controller.ts`, `get-partner-detail.use-case.ts`, `system-partner-management.module.ts` | command ตาม spec §5.3 และคืนค่าในรายละเอียดร้าน |
| Auth | `auth/presentation/auth.controller.ts` (`me`) | เพิ่ม `manualExpenseWebEntry` อ่านผ่าน `PrismaService` ที่ controller มีอยู่แล้ว ไม่แก้ `auth.module.ts`, `auth.guard.ts`, resolver หรือ `RequestContext` |
| Web session | `common/models/web-session.model.ts`, `features/web-core-workspace/workspace-scope.api.ts` | type ของ field และ fingerprint |
| Helper / gate | ไฟล์ใหม่ใน `features/expenses/` (ชื่อเสนอ `manual-expense-entry.logic.ts` และ gate component), `app/(workspace)/companies/[companyId]/expenses/manual/page.tsx`, `ExpensesPages.tsx` | predicate เดียว และ admission ตาม spec §7 |
| ทางเข้า | `web-core-workspace.logic.ts` (`buildNavItems`), `WorkspaceLayout.tsx`, `ExpensesPages.tsx` (`ExpenseListPage`), `IncomeExpenseLedgerPage.tsx`, `ai-suggestions.logic.ts` กับ page ที่เรียก | ใช้ helper เดียวกันตาม spec §9.1 |
| คู่มือ | ไฟล์ใหม่ใน `features/user-guide/` สำหรับแปลงผลลัพธ์, `app/(workspace)/companies/[companyId]/user-guide/expenses/page.tsx` | ซ่อนปุ่มและใส่หมายเหตุ โดยไม่แก้ `expenses-guide.content.ts` |
| หน้าผู้ดูแล | `features/system-partners/PartnerDetailPage.tsx`, `system-partners.api.ts` | สวิตช์ย่อยใต้แถว “บันทึกด้วยมือ” บันทึกแยกจากชุดสิทธิ์ |
| ข้อความ | `common/i18n/workspace-dictionary.ts` (ถ้าใช้ dictionary), `common/api/api-error-message.ts` | ข้อความตาม spec §8 ทั้งไทยและอังกฤษถ้าคีย์ข้างเคียงมีสองภาษา และข้อความไทยของรหัส 409 (test `api-error-coverage.spec.ts` บังคับให้ทุกรหัสของโมดูลนี้มีข้อความไทย) |

ทุก path กลุ่ม API ที่ย่อเริ่มจาก `apps/api/src/modules/`; web เริ่มจาก `apps/web/src/` ยกเว้น `app/` ซึ่งอยู่ที่ `apps/web/app/`

ไฟล์ที่ไม่ต้องแก้ และมีขั้นตอนเพิ่มถ้าถูกแก้

| ไฟล์ | เหตุผล | ถ้าจำเป็นต้องแก้ |
| --- | --- | --- |
| `apps/web/src/common/auth/server-session.ts`, `session-gate.logic.ts`, `apps/web/app/(workspace)/companies/[companyId]/layout.tsx`, `apps/api/src/modules/auth/presentation/auth.guard.ts`, `auth.module.ts` | ถูกตรึงโดย `infra/security/validate-production-maintenance-release.sh` และงานนี้ไม่ต้องใช้ (`fetchServerSession` ส่ง JSON ของ `/auth/me` ผ่านอยู่แล้ว) | ทำตาม §4 แถว “ไฟล์ที่ถูกตรึงสำหรับ maintenance” |
| `apps/web/src/features/user-guide/expenses-guide.content.ts` | ถูกตรึง hash โดยชุดคำตอบ LINE | ทำตาม §4 แถว “ไฟล์คู่มือ” |
| `packages/contracts/src/feature-entitlements.ts`, `menu-entitlements.ts` และไฟล์ LINE | อยู่ใน W00 manifest และงานนี้ห้ามแก้ | หยุดและถามก่อน (§1) |

## 3. Implementation sequence และ checkpoint

### P0 — เริ่มจาก develop ล่าสุดและตรวจซ้ำ

- [x] ยืนยันว่าเจ้าของตอบ D1–D8 แล้ว และ spec/plan/memory สะท้อนคำตอบ (คำตอบ: ตัดสินแล้ว 2 ต.ค. 2569 (เจ้าของ: ตามที่แนะนำ) บันทึกใน spec §1.2 และ memory รวมการเปลี่ยนครึ่งแรกของ D2)
- [x] สร้าง worktree ใหม่จาก `origin/develop` ล่าสุด ไม่ใช้ checkout ร่วม บันทึก SHA (`608b4a6f5`)
- [x] ตรวจ F01–F13 ใน spec §3 ซ้ำที่ SHA นั้นทีละข้อด้วยชื่อ symbol ถ้าข้อใดไม่ตรง ให้แก้ spec และ plan ก่อนเขียนโค้ด (ยังจริงทุกข้อ F02 แก้แล้วตามที่ spec ระบุ)
- [x] ตรวจทางเข้าใน spec §9 ซ้ำด้วยการค้น `expenses/manual` ทั้ง `apps/web` ถ้าพบจุดใหม่ให้เพิ่มใน spec ก่อน (ไม่พบจุดใหม่)
- [x] รัน baseline ใน §4 และบันทึกจำนวน test ที่ผ่าน (API 133, 112 และ 91 ข้อ, web 232 ข้อ, ai-gateway 9 ข้อ ไม่มีข้อที่แดง)
- [x] ยืนยันสามสถานะฐาน: `node infra/security/sync-production-maintenance-release-pins.mjs --check` ได้ `status=current`, `approved-knowledge.spec.ts` เขียว, `line-ai-capability-manifest.spec.ts` เขียว
- [x] ยืนยัน source/dist ของ contracts ตรงกันก่อนใช้ผล web test (build ใหม่จาก source)

Exit: ขอบเขตและ baseline ตรวจซ้ำได้ที่ commit เริ่มงาน ไม่มีข้อค้นพบใดอ้างฐานเก่า

### P1 — ที่เก็บ, command และรายละเอียดร้าน

- [x] เพิ่ม model และ migration แบบ additive ตรวจด้วย `prisma validate` และ generate client (`CompanyWebEntrySetting`, migration `20261002230000_company_web_entry_setting`, คอลัมน์ค่าไม่มีค่าเริ่มต้นในฐานข้อมูล)
- [x] เขียน use case ตามรูปแบบ `SetPartnerOcrConfigUseCase`: ค่าเท่าเดิมเป็น no-op, version ไม่ตรงได้ 409, ร้านที่ล็อกถูกปฏิเสธ, upsert พร้อม audit ใน transaction เดียว (`SetPartnerManualExpenseWebEntryUseCase`)
- [x] เพิ่ม endpoint ใต้ partner controller ด้วย `system.partner_feature.manage` (`PUT :partnerCompanyId/manual-expense-web-entry`)
- [x] `get-partner-detail` คืนค่าและ version เสมอ ร้านไม่มีแถวได้ค่า**ไม่แสดง**กับ version 0 ผ่านจุดตัดสินเดียว `MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW`
- [x] ไม่ import หรือเรียกสิ่งใดจากโมดูล entitlement, billing หรือ LINE ใน use case ใหม่ (test ใช้ transaction ปลอมที่โยน error เมื่อแตะตารางอื่น)

Exit: ผู้ดูแลตั้งค่าได้ผ่าน API ไม่มีตาราง entitlement ใดถูกเขียน

### P2 — `/auth/me` และ session ฝั่งเว็บ

- [x] `me()` คืน `manualExpenseWebEntry` ของบริษัทใน context ร้านไม่มีแถวได้ **false** ผ่านจุดตัดสินเดียวกับรายละเอียดร้าน
- [x] เพิ่ม field ใน `WebSession` และ `MyContext` แบบ optional
- [x] เพิ่ม helper `canOpenManualWeb` ตาม spec §6.2 ค่าหายถือว่าแสดง (predicate ฝั่งเว็บไม่เปลี่ยนตามค่าเริ่มต้นใหม่) ใน `features/expenses/manual-expense-entry.logic.ts`
- [x] seed ของร้านตัวอย่าง (`apps/api/prisma/seed.ts`) เขียนแถว “แสดง” เพื่อให้ e2e เดิม local stack และร้านตัวอย่างยังเห็นเมนู ไม่แก้ที่ตัว test (ร้าน `seed-local-company` และ `seed-local-company-2`)
- [x] เพิ่ม boolean ใน `accessContextFingerprint` เท่านั้น (ค่าหายอ่านเป็นแสดง จึงไม่ refresh เพราะ field หาย)
- [x] ไม่แตะ JWT, localStorage, resolver หรือ `RequestContext`

Exit: เว็บรู้ค่าของร้าน ร้านที่ไม่มีแถวไม่เห็นทางเข้า และแท็บที่เปิดค้างปรับเมนูในรอบ focus/poll เดิม

### P3 — Gate, ทางเข้า และคู่มือ

- [x] gate ครอบเฉพาะส่วนฟอร์มของแท็บบันทึกด้วยมือตามกติกา spec §7.1: รับเข้าแล้วจำผล ไม่ถอนเมื่อ prop เปลี่ยน (state ใน `ExpensesHubPage` ตรรกะใน `manual-expense-entry.logic.ts`)
- [x] server page ส่งผลของ helper เป็น prop และ render gate กับฟอร์มเสมอ
- [x] ต่อ nav, ปุ่มหน้ารายการ, ledger (ปุ่ม, การ์ด, empty state), AI แนะนำ กับ helper ตาม prop chain ที่มีอยู่
- [x] แปลงผลลัพธ์ของ `buildExpensesGuide` ในไฟล์ใหม่: ตัดปุ่มของหัวข้อ `manual` และเพิ่มหมายเหตุ ไม่แก้ไฟล์ที่ถูกตรึง (`expenses-guide-manual-entry.ts`; hash ของไฟล์คู่มือยังเป็น `73f50c33…`)
- [x] ข้อความตาม spec §8 รวมสถานะที่ไม่มีปุ่มให้แสดง, accessibility และ 390px (ข้อความอยู่ใน `workspace-dictionary.ts` ทั้งไทยและอังกฤษ; การดูจริงที่ 390px อยู่ใน P6)
- [x] ไม่เอาผลของ helper ไปทับ `caps.canCreate` หรือ gate wizard/upload/shared API

Exit: ร้านที่ไม่แสดงเมนูไม่มีทางเข้าใน spec §9.1 เลย ผู้ดูแลเปิดแล้วทางเข้ามาโดยไม่ต้อง login ใหม่ ปิดแล้วฟอร์มที่กรอกค้างยังอยู่

### P4 — หน้าผู้ดูแล

- [x] แสดงสวิตช์ใต้แถว “บันทึกด้วยมือ” ไม่เพิ่มแถวเมนู, route หรือ navigation item (ปุ่มกาง “เมนูย่อย” กดได้เสมอ เพื่อให้ถึงแถวนี้ได้แม้สวิตช์ของชุดสิทธิ์ถูกล็อก)
- [x] บันทึกผ่าน command ใหม่ทันทีหลังยืนยัน ไม่อยู่ใน pending ของชุดสิทธิ์ ไม่ผ่าน `toggleSubmenu`, `applyPreset` หรือปุ่ม “ตรวจสอบและบันทึก” และไม่รีเซ็ต pending ที่ผู้ดูแลยังไม่ได้บันทึก
- [x] กดไม่ได้เมื่อ `expenses` หรือ `expenses.manual` ที่บันทึกแล้วปิดอยู่ แสดงค่าที่เก็บไว้
- [x] ข้อความยืนยันเฉพาะตอนเปลี่ยนจากแสดงเป็นไม่แสดง (การเปิดไม่ต้องยืนยัน) คำเตือนเพิ่มในขั้นยืนยัน และหมายเหตุประจำแถว เมื่อ `expenses.upload` ของร้านปิดอยู่
- [x] 409 แสดงข้อความให้ตรวจค่าล่าสุด และอ่านรายละเอียดร้านใหม่เพื่อแสดงค่าล่าสุดของสวิตช์นี้ (ไม่รีเซ็ตรายการเปลี่ยนแปลงของชุดสิทธิ์)

Exit: ผู้ดูแลแสดงและซ่อนเมนูให้ร้านเดิมได้ รวมร้านที่ชุดสิทธิ์ยังรอการเตรียม โดยรายการเปลี่ยนแปลงของชุดสิทธิ์ไม่ขยับ

### P5 — Invariants และ regression

- [x] `git diff --stat` เทียบ commit เริ่มงาน: ไม่มีไฟล์ในรายการห้ามแก้ของ §1 และ §2 (และไม่มี `package.json` ใดถูกแก้)
- [x] permissions และ `entitledFeatureKeys` ของ `/auth/me` เท่าเดิมก่อนและหลังสลับค่า สำหรับทุกบทบาทใน `ROLE_GRANTS` และทุกเทมเพลตใน `ROLE_TEMPLATES` (resolver จริงบน PostgreSQL สี่สถานะ: ไม่มีแถว เปลี่ยน เปลี่ยนกลับ เปลี่ยนอีก รวม `lineDeliveryAccessFingerprint`)
- [x] สลับค่าแล้ว `CompanyEntitlementSet.setVersion` และ `billingFeaturePlan().plan.sourceHash` ของร้านไม่เปลี่ยน และ plan ที่ pin ก่อนสลับยัง apply ได้หลังสลับ
- [x] สลับค่าแล้วแถว `AiConversation`, `AiTurn`, `LineIntakePendingMedia`, `LineDeliveryPlan` ของร้านไม่เปลี่ยน
- [x] สร้างร้านใหม่ผ่าน onboarding แล้วไม่มีแถวค่าตั้ง และ `/auth/me` คืน **false** (`CreateCompanyOnboardingUseCase` จริงบน PostgreSQL)
- [x] API create/update/mark-ready/delete ให้ผลเดิมก่อนและหลังสลับค่า ทั้งผู้ถือสิทธิ์ (สำเร็จ) และผู้อ่านอย่างเดียว (ถูกปฏิเสธ) ด้วย use case จริงบน PostgreSQL
- [ ] OCR/source draft, wizard และ reimbursement: **ไม่ได้รันเป็น flow ในงานนี้** หลักฐานที่มีเป็นเชิงโครงสร้าง: test สแกน source ของ API ยืนยันว่ามีเพียงห้าไฟล์ที่อ้างค่าตั้งนี้ (command, logic, รายละเอียดร้าน, controller ของผู้ดูแล, `/auth/me`) และ permissions ที่ flow เหล่านี้ใช้เท่าเดิมทุกสถานะตามข้อบน
- [x] e2e เดิมที่เปิดหน้า manual ผ่านโดยไม่แก้ (รันใน P6 บนฐานข้อมูลที่ seed เขียนแถว “แสดง” ให้ร้านตัวอย่าง ทุก test ที่เปิดหน้า manual ผ่าน e2e เดิม 13 ข้อในไฟล์เดียวกันที่ล้ม ล้มที่บรรทัดเดียวกันบนเว็บของ commit เริ่มงาน จึงไม่ใช่ผลของงานนี้ รายชื่ออยู่ใน memory)
- [x] ตรวจสามสถานะฐานของ P0 ซ้ำ ต้องยังเขียวและ `status=current` (pins `status=current`, `approved-knowledge.spec.ts` 9 ข้อ, `line-ai-capability-manifest.spec.ts` อยู่ในชุด 91 ข้อที่ผ่าน)

Exit: งานนี้ไม่สร้าง regression นอกหน้าจอ และพิสูจน์ได้ว่าไม่แตะเงิน สิทธิ์ และ LINE

### P6 — Integration/browser/database evidence และ release handoff

- [x] ทำ acceptance matrix ใน §5 ใน test tenant/local database ที่ตั้งไว้สำหรับทดสอบ (PostgreSQL ใน container ของงานนี้เอง หลักฐานต่อ AC อยู่ใน §5.1)
- [x] Browser desktop และ 390px โดย session ของผู้ดูแลแยกจากพนักงาน เพื่อพิสูจน์ refresh หลังสลับค่า (e2e ใหม่ และการดูด้วยตาที่ 390, 640, 768, 1024 และ 1280 px)
- [x] บันทึก commands/results และข้อจำกัดจริงใน memory ไม่มี silent skip
- [x] เขียน e2e ใหม่ใต้ `e2e/` โดยสลับค่าตั้งใหม่ ไม่นำ harness ใน `docs/evidence` มาใช้ (`e2e/manual-expense-web-entry.spec.ts`)
- [x] ปรับเอกสารหลักที่อ้างพฤติกรรมนี้ (§6): `expense-receipt-upload-spec.md` แล้ว ส่วน `cloud-environment-operations.md` ไม่มี inventory ของตารางฐานข้อมูลจึงไม่แก้

Exit: AC01–AC20 มี evidence mapping ยังไม่ถือว่า live release สำเร็จจนผ่าน deployment protocol

### P7 — รอบแก้ถ้อยคำ 3 ต.ค. 2569 (หลังเจ้าของยืนยันค่าเริ่มต้น)

เจ้าของยืนยันว่าทุกร้านรวมร้านเดิมเริ่มที่ไม่แสดงเมนู ข้อความที่จริงเฉพาะร้านที่แสดงเมนูจึงเป็นข้อบกพร่อง ผู้ควบคุมงานสั่งแก้ทั้งกลุ่ม รายละเอียดเดิมและใหม่อยู่ในภาคผนวก C และ §9.2–9.3 ของ spec

- [x] คู่มือค่าใช้จ่าย (`expenses-guide.content.ts` ไฟล์ที่ถูกตรึง): ประโยคที่เสนอการบันทึกด้วยมือจริงทั้งร้านที่แสดงและไม่แสดงเมนู หกประโยค (ภาพรวมสองจุด สรุปหัวข้อเมนูย่อย สรุปหัวข้อ “บันทึกด้วยมือ” ลิงก์กรณีไม่มีใบเสร็จ คำตอบ “ไม่พบเมนูย่อยบางรายการ”) ทำตามขั้นตอนของ §4 สำหรับไฟล์คู่มือที่ถูกตรึง: ย้าย hash ใน `approved-product-help.ts` ตรวจการ์ดทุกใบที่อ้างไฟล์นี้ รัน `approved-knowledge.spec.ts` และ whole-chain acceptance
- [x] การ์ด LINE `expense.start`: เงื่อนไขช่องทางของร้านและสิทธิ์ของผู้อ่าน (อยู่ใน `apps/ai-gateway` ต้องปล่อยผู้ช่วยในรอบเดียวกัน)
- [x] สถานะข้างสวิตช์ของผู้ดูแลบอกสิ่งที่ร้านเห็น: ฟีเจอร์แม่ที่บันทึกแล้วปิด หรือบริษัทปิดใช้งาน แสดง “ไม่แสดง” แบบกดไม่ได้ ค่าที่เก็บไม่เปลี่ยน
- [x] ข้อความใต้ชุดสิทธิ์ขณะล็อกระบุว่าสวิตช์นี้ยังกดได้ เฉพาะเมื่อกดได้จริง
- [x] คำอธิบายใต้สวิตช์ไม่สมมุติว่าทุกร้านเชื่อม LINE
- [x] บรรทัดติดต่อในหน้าที่ไม่แสดง: “กรุณาติดต่อเจ้าของกิจการ” (ใช้ประโยคขอสิทธิ์กลางเมื่องานชื่อบทบาทเข้า develop)
- [x] ลิงก์ “ไม่มีไฟล์ใบเสร็จ/ใบกำกับภาษี? …” ในหน้าอัปโหลดแสดงเฉพาะผู้มีสิทธิ์ทั้งสร้างและตรวจสอบค่าใช้จ่าย (เกณฑ์ของ wizard และหน้าใบรับรอง)
- [x] `expense-receipt-upload-spec.md` บรรทัดที่บอกว่าหน้าอัปโหลดลิงก์ไปบันทึกด้วยมือ แก้ตามโค้ด
- [x] e2e ใหม่ตรวจสถานะล็อกและข้อความใต้ชุดสิทธิ์ ทุก test ใหม่แดงบนโค้ดก่อนแก้ และย้อนทีละบรรทัดแล้วแดง (ผลอยู่ใน memory)

## 4. Verification และขั้นตอนเพิ่มเมื่อแตะไฟล์บางกลุ่ม

คำสั่งต่อไปนี้เป็น **แผนสำหรับ implementation candidate** ไม่ใช่ผลรันงานเอกสาร

Baseline และ regression จาก `apps/api`:

```sh
pnpm exec tsx --test src/modules/auth/presentation/auth.controller.spec.ts src/modules/system-partner-management/presentation/http/partner.controller.spec.ts src/modules/system-partner-management/application/use-cases/get-partner-detail.use-case.spec.ts src/modules/system-partner-management/application/use-cases/set-partner-features.use-case.spec.ts
pnpm exec tsx --test src/modules/employee-access/domain/logic/feature-gate.logic.spec.ts src/modules/employee-access/domain/logic/menu-entitlement-binding.spec.ts src/modules/employee-access/application/entitlement.helper.spec.ts src/modules/billing/application/billing-feature-entitlements.spec.ts src/modules/system-onboarding/application/use-cases/create-company-onboarding.spec.ts
pnpm exec tsx --test src/modules/expenses/application/use-cases/delete-expense.use-case.spec.ts src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts src/modules/expenses/application/expense-launch-gate.spec.ts src/modules/line-ai/line-ai-capability-manifest.spec.ts
```

จาก `apps/web`:

```sh
pnpm exec tsx --test src/features/system-partners/system-partners.logic.spec.ts src/features/web-core-workspace/web-core-workspace.spec.ts src/features/expenses/expenses.model.spec.ts src/features/user-guide/user-guide.content.spec.ts src/features/ai-suggestions/ai-suggestions.logic.spec.ts
```

จาก `apps/ai-gateway` (ยืนยันว่าไฟล์คู่มือไม่ถูกแตะ):

```sh
pnpm exec tsx --test src/modules/line-ai/agents/approved-knowledge.spec.ts
```

ตัวเลขฐานที่ผู้รีวิวรันที่ `ae13970b0` (ใช้เทียบใน P0 เท่านั้น ไม่ใช่หลักฐานของงาน): API สามบรรทัดผ่าน 133, 109 และ 89 ข้อ, web 227 ข้อ, ai-gateway 9 ข้อ ไม่มีข้อที่แดง

Typecheck ใช้ script ของแต่ละ package (`typecheck` ของ API ตั้ง heap ไว้ให้แล้ว อย่ารัน `tsc --noEmit` ตรง ๆ) และอ่านค่า exit code จริง ต้องบันทึก failures ของ working tree ที่ไม่เกี่ยวแยกจาก regression ที่งานนี้สร้าง

Test ใหม่ที่ต้องเขียน

| เรื่อง | ตำแหน่งที่เสนอ | สิ่งที่ยืนยัน |
| --- | --- | --- |
| command ของผู้ดูแล | `partner.controller.spec.ts` (อยู่ในรายการ `test` อยู่แล้ว) | no-op, เปลี่ยนจริง, 409, ร้านล็อก, audit หนึ่งแถว, ไม่เรียกตาราง entitlement หรือ LINE |
| รายละเอียดร้าน | `partner.controller.spec.ts` (มี describe ของ `GetPartnerDetailUseCase` อยู่แล้ว) | ร้านไม่มีแถวได้ค่าไม่แสดงและ version 0 ผ่านจุดตัดสินเดียว และ test หนึ่งข้อตรึงค่าของจุดนั้น |
| `/auth/me` | `auth.controller.spec.ts` | false เมื่อไม่มีแถว (ผ่านจุดตัดสินเดียว), ตามค่าที่เก็บเมื่อมีแถว, ไม่ปนข้ามบริษัท, permissions ไม่เปลี่ยน |
| helper | spec ข้าง helper | ตารางค่าใน spec §6.1–6.2 รวมค่าหาย |
| fingerprint | `web-core-workspace.spec.ts` หรือ spec ข้าง `workspace-scope.api.ts` | เปลี่ยนเมื่อค่านี้เปลี่ยน ไม่เปลี่ยนเมื่อไม่เกี่ยว |
| gate | spec ของ logic ที่แยกจาก component | รับเข้าแล้วไม่ถอน, ไม่แสดงแล้วไม่รับเข้า, เปลี่ยนเป็นแสดงแล้วรับเข้า |
| ทางเข้า | `web-core-workspace.spec.ts`, `ai-suggestions.logic.spec.ts`, spec ของ ledger ถ้ามี logic แยก | ไม่แสดงครบตาม spec §9.1 เมื่อค่าเป็น false และไม่มีการ์ดเปล่า |
| คู่มือ | spec ข้างไฟล์แปลงผลลัพธ์ | ปุ่มหาย มีหมายเหตุ หัวข้ออื่นไม่เปลี่ยน |
| หน้าผู้ดูแล | `system-partners.logic.spec.ts` | `applyPreset`, เปิดปิดกลุ่ม และ `changedEntitlements` ไม่มี key หรือค่าของสวิตช์ใหม่ |
| invariants | PostgreSQL spec ใหม่หนึ่งไฟล์ `apps/api/src/modules/system-partner-management/manual-expense-web-entry.pg.spec.ts` ลงทะเบียนใน `.github/workflows/ci.yml` (ตัวแปร `MANUAL_EXPENSE_WEB_ENTRY_TEST_DATABASE_URL`) | รายการใน P5 ข้อ 2–6 รวม migration ที่สร้างเฉพาะตารางของตัวเอง command บนฐานข้อมูลจริง และผู้ดูแลสองคนกดพร้อมกัน |

spec ใหม่ฝั่ง API ต้องมีที่ที่ CI รัน: script `test` ของ `apps/api/package.json` ระบุไฟล์ทีละไฟล์ และ `.github/workflows/ci.yml` มีรายการของตัวเองบางขั้น **ข้อตัดสินของงานนี้ (2 ต.ค. 2569):** ไม่แก้ `package.json` ใด test ฝั่ง API ทั้งหมดเขียนลงในไฟล์ spec ที่รายการ `test` มีอยู่แล้ว ส่วน spec PostgreSQL ไฟล์ใหม่ของ P5 ลงทะเบียนใน `.github/workflows/ci.yml` แบบเดียวกับ `data-rights-single-admin.pg.spec.ts` ห้ามปล่อย spec ใหม่ไว้โดยไม่มีที่รัน ฝั่งเว็บใช้ glob จึงไม่ต้องลงทะเบียน

ขั้นตอนเพิ่มเมื่อ diff แตะไฟล์บางกลุ่ม (งานนี้ไม่ควรแตะ ถ้าแตะให้ทำครบ)

| ถ้า diff แตะ | ต้องทำ |
| --- | --- |
| ไฟล์ที่อยู่ใน `sourceHashes` ของ `docs/research/mangmee-ai-capability-manifest-2026-09-27.json` (เช่น `feature-entitlements.ts`, `menu-entitlements.ts`, `line-conversation-context.service.ts`) | รัน `line-ai-capability-manifest.spec.ts` ด้วย `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1` เพื่อสร้าง manifest ใหม่ แล้วรันซ้ำโดยไม่ตั้งค่า จากนั้นรัน `node scripts/run-line-ai-whole-chain-acceptance.mjs` |
| รายการ key ใน `ALL_FEATURE_ENTITLEMENT_KEYS` | สร้าง corpus ใหม่ด้วย `scripts/line-ai-reliability-corpus.ts --write` แล้วรัน `scripts/line-ai-reliability-corpus.spec.ts` และ whole-chain |
| ไฟล์คู่มือที่ชุดคำตอบ LINE ตรึงไว้ (`expenses-guide.content.ts`, `reimbursement-guide.content.ts`, `substitute-receipt-guide.content.ts`, `reports-guide.content.ts`) | อัปเดต hash ใน `sources` ของ `apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts`, ทบทวนว่าการ์ดที่อ้างไฟล์นั้นยังถูกต้อง, รัน `approved-knowledge.spec.ts` และแจ้งว่ามีการเปลี่ยนใน `apps/ai-gateway` ซึ่งต้อง deploy ผู้ช่วยด้วย |
| ไฟล์ที่ถูกตรึงสำหรับ maintenance (รายการใน `infra/security/validate-production-maintenance-release.sh`) | รัน `node infra/security/sync-production-maintenance-release-pins.mjs` ซึ่งแก้ทั้ง validator และ `.github/workflows/deploy-production.yml` commit ทั้งสองไฟล์ แล้วตรวจด้วย `--check` |
| `apps/api/prisma/schema.prisma` | migration แบบ additive, `prisma validate`, generate และปล่อยตามแถว “Application, Dockerfile, dependency, migration” ของ deployment protocol คือ PR/CI → UAT `all` → Passport ใหม่ → READY → Production |
| `package.json` ใดก็ตาม | ทำได้เฉพาะการเปลี่ยน dependency นอกนั้นต้องได้รับอนุญาตจากเจ้าของก่อน |

PG/browser: อ่าน fixture/setup ของ PostgreSQL spec ที่มีอยู่ในโมดูลใกล้เคียงและ `e2e/expenses.spec.ts` ก่อนรัน ใช้เฉพาะ test database/environment ที่ยืนยันแล้ว อย่าเดา DATABASE_URL หรือใช้ shared live tenant จาก local env โดยไม่ตรวจ

## 5. Acceptance matrix สำหรับ integration

| Scenario | Actor / setup | Expected / AC |
| --- | --- | --- |
| ไม่แสดง (ไม่มีแถว)→แสดง→ไม่แสดง | ร้านที่ `expenses` และ `expenses.manual` เปิด, บทบาทมี create/update | permissions และ `entitledFeatureKeys` เท่ากันทุกสถานะ มีเพียงทางเข้าที่เปลี่ยน (01, 02, 04) |
| ร้านไม่มีแถวค่าตั้ง | ร้านเดิม และร้านที่เพิ่งสร้าง | `/auth/me` ได้ false เมนูไม่แสดง จนกว่าผู้ดูแลเปิดให้ (01, 03, 13) |
| API เก่าหรือ field หาย | จำลอง response ที่ไม่มี field | เว็บแสดงเมนู (03) |
| URL ตรง / alias / ลิงก์กลับจากภาษี / deep link ผ่าน login | พนักงาน session ใหม่ ร้านไม่แสดงเมนู | ไม่เปิดฟอร์ม ได้สถานะตาม spec §8 ไม่มี 403 หรือ redirect (05) |
| ฟอร์มเปิดค้าง → ผู้ดูแลปิด → focus/poll | ร้านที่เปิดเมนูไว้ มี input, ไฟล์ และ save key | ฟอร์มอยู่ บันทึกครั้งเดียวได้ โหลดใหม่แล้วไม่เปิดฟอร์ม (06, 07) |
| สลับค่าที่ไม่กระทบ permissions | ผู้ดูแลเปลี่ยนชุดสิทธิ์อื่นของร้าน | fingerprint ไม่เปลี่ยนเพราะค่านี้ ไม่มี refresh loop (07) |
| บริษัท A ไม่แสดง, บริษัท B แสดง | ผู้ใช้มีสอง membership | ค่าและผลรับเข้าไม่ปนกัน (08) |
| API create ทั้งสองสถานะ | ผู้ถือ create และ read-only | ผู้ถือสำเร็จ read-only ถูกปฏิเสธ ทั้งสองสถานะ (09) |
| OCR failed / quota full / wizard / reimbursement | draft `WEB_UPLOAD`, reviewer, ผู้เบิก | ทำได้ตามเดิม (10) |
| LINE ระหว่างสลับค่า | มีบทสนทนา, รูปที่รอคำตอบ, คำตอบที่รอส่ง | ทุกอย่างคงอยู่และคำตอบถูกส่ง (11) |
| ชำระเงินระหว่างสลับค่า | plan ถูก pin แล้วผู้ดูแลสลับค่า | `sourceHash` เท่าเดิม apply ได้ invoice ไม่ HELD (12) |
| ซื้อ อัปเกรด ดีล ชุดสำเร็จรูป | ร้านที่ผู้ดูแลเปิดไว้ และร้านที่ไม่มีแถว | ค่าคงเดิมหลังเหตุการณ์ทุกแบบ ร้านที่ไม่มีแถวยังไม่มีแถว (13) |
| ผู้ดูแลกับร้านเดิม | ร้านมีแถวสิทธิ์ครบ, ร้านไม่มีแถวสิทธิ์ (ชุดสิทธิ์ยังรอการเตรียม), ร้านที่ฟีเจอร์แม่ปิด | สองแบบแรกสลับได้ แบบสุดท้ายกดไม่ได้และค่าที่เก็บไม่เปลี่ยน (14) |
| command | กดซ้ำ, ผู้ดูแลสองคน, ร้านล็อก | no-op, 409, ปฏิเสธ, audit หนึ่งแถวต่อการเปลี่ยนจริง (15) |
| ข้อความ | ร้านที่ `expenses.upload` ปิด | มีหมายเหตุประจำแถวเมื่อไม่แสดงเมนู และคำเตือนเพิ่มในขั้นยืนยัน ไม่มีคำว่าไม่มีสิทธิ์หรือระบบถูกปิด (16) |
| คู่มือ | ร้านไม่แสดงเมนู | ปุ่มหาย มีหมายเหตุ ไฟล์ที่ถูกตรึงไม่เปลี่ยน (17) |
| Keyboard / 390px / desktop | loading และ error states | ไม่มี focus target ที่ซ่อนอยู่ ไม่มี blank loop (18) |
| Migration และถอยรุ่น | ฐานข้อมูลทดสอบ | additive, ถอย image แล้วเมนูกลับมาทุกร้าน ค่าที่ตั้งไว้ยังอยู่ (19) |

### 5.1 หลักฐานต่อ AC (P6, 3 ต.ค. 2569)

ผลรันจริงและตัวเลขอยู่ใน memory ตาราง “ผ่าน” หมายถึงมี test ที่แดงบนโค้ดเดิมหรือเมื่อย้อนบรรทัดของงานนี้ และเขียวบนโค้ดใหม่ ส่วนที่ไม่ได้รันเขียนไว้ตรง ๆ

| AC | หลักฐาน | สถานะ |
| --- | --- | --- |
| AC01 | `partner.controller.spec.ts` มี test ตรึงค่าเริ่มต้นที่จุดเดียว (สลับค่าคงที่แล้วแดงเฉพาะข้อนั้น), PG spec: ร้านจาก onboarding จริงไม่มีแถวและอ่านได้ว่าไม่แสดงทั้ง `/auth/me` และรายละเอียดร้าน, e2e: `/auth/me` ของร้านที่ไม่มีแถวได้ false, diff ไม่แตะ catalog, bindings หรือ presets | ผ่าน |
| AC02 | PG spec: ทุกบทบาทใน `ROLE_GRANTS` และทุกเทมเพลตใน `ROLE_TEMPLATES` ผ่าน resolver จริงสี่สถานะ เทียบทั้งก้อนรวม `entitledFeatureKeys` | ผ่าน |
| AC03 | `auth.controller.spec.ts` (ไม่มีแถวได้ false, ตามค่าที่เก็บ, อ่านบริษัทที่ร้องขอ), `manual-expense-entry.logic.spec.ts` และ `workspace-scope.api.spec.ts` (field หายถือว่าแสดง), e2e | ผ่าน |
| AC04 | unit และ wiring ของทุกจุดใน §9.1 ของ spec; e2e: ร้านที่ไม่มีแถวไม่มีปุ่ม “บันทึกเอง” รายการใน sidebar การ์ดและปุ่มในสมุดรายรับรายจ่าย ลิงก์ในหน้า AI และปุ่มในคู่มือ แล้วรายการใน sidebar กลับมาเมื่อผู้ดูแลเปิด; ย้อนโค้ดทีละจุดสิบจุดแล้ว e2e แดงที่บรรทัดของจุดนั้น; §9.2: ปุ่มอัปโหลดยังอยู่ใน e2e และไฟล์ของ wizard กับหน้ารายละเอียดไม่ถูกแก้ | ผ่านสำหรับ §9.1; §9.2 ยืนยันจากโค้ดที่ไม่ถูกแก้ ไม่ได้รัน wizard |
| AC05 | e2e: เปิด address ตรงได้ 200 ไม่ redirect ไม่มีคำว่าไม่มีสิทธิ์ แสดงสถานะตาม §8 และ `?tab=manual` ได้สถานะเดียวกัน | URL ตรงและ alias ผ่าน; ลิงก์กลับจากหน้าภาษีและ deep link ผ่าน login ไม่ได้รันแยก (ทั้งสองทางมาถึง address เดียวกันซึ่งหน้าเองเป็นผู้ตัดสิน) |
| AC06 | e2e: ฟอร์มที่กรอกค้างอยู่ต่อหลังผู้ดูแลซ่อน (เอกสารเดิม ไม่โหลดใหม่) ค่าที่กรอกยังอยู่ มีข้อความตาม §8 บันทึกได้หนึ่งรายการ (`WEB_MANUAL`, `DRAFT`) และเปิดใหม่แล้วไม่เปิดฟอร์ม; ย้อนการไม่ถอนผลรับเข้าแล้ว e2e แดง | ผ่าน (ไม่ได้แนบไฟล์ในฟอร์มระหว่างทดสอบ) |
| AC07 | `workspace-scope.api.spec.ts` (fingerprint เปลี่ยนเมื่อค่านี้เปลี่ยน ไม่เปลี่ยนเมื่อสิ่งอื่นที่ไม่เกี่ยวเปลี่ยน), e2e: หน้าที่เปิดอยู่รับค่าใหม่โดยไม่โหลดใหม่; ตัด field ออกจาก fingerprint แล้ว e2e แดง | ผ่าน (การไม่เกิด loop พิสูจน์ระดับ unit) |
| AC08 | `auth.controller.spec.ts` (อ่านแถวของบริษัทที่ร้องขอ), helper ตรวจบริษัทตรงกัน, PG spec (แยกบริษัทและลบตามบริษัท) | ผ่านระดับ unit/PG; การสลับบริษัทในเบราว์เซอร์ไม่ได้รัน |
| AC09 | PG spec: สร้าง แก้ ส่งพร้อม และลบ ด้วย use case จริงสามสถานะ ผู้ถือสิทธิ์สำเร็จ ผู้อ่านอย่างเดียวถูกปฏิเสธ; permissions ทุกบทบาทเท่าเดิม (AC02); e2e บันทึกร่างได้หลังซ่อนเมนู | ผ่านสำหรับสองบทบาทที่รัน; cross-tenant/cross-branch ไม่ได้รันใหม่ (โค้ดส่วนนั้นไม่ถูกแก้) |
| AC10 | เชิงโครงสร้าง: test ใน PG spec ยืนยันว่ามีเพียงห้าไฟล์ฝั่ง API ที่อ้างค่านี้ และ permissions เท่าเดิม | **ไม่ได้พิสูจน์เป็น flow**: upload, OCR-failed, quota-full, wizard และ reimbursement ไม่ได้รัน |
| AC11 | PG spec: แถว `AiConversation`, `AiTurn`, `LineIntakePendingMedia`, `LineDeliveryPlan` และ `lineDeliveryAccessFingerprint` เท่าเดิม; unit: command ไม่แตะตารางอื่น | ผ่านสำหรับ state; การส่งคำตอบ LINE จริงไม่ได้รัน |
| AC12 | PG spec: `setVersion`, `sourceHash`, `planHash` เท่าเดิม ไม่มีแถว transition, run-off หรือ command และ plan ที่ pin ก่อนสลับ apply ได้หลังสลับ | ผ่าน; ไม่ได้รัน invoice จริง |
| AC13 | PG spec: ร้านจาก onboarding จริงไม่มีแถวและอ่านได้ว่าไม่แสดง, scan ว่ามีเพียงห้าไฟล์ฝั่ง API ที่อ้างค่านี้, `system-partners.logic.spec.ts` (preset เปิดปิดกลุ่ม และรายการเปลี่ยนแปลงไม่มีค่านี้) | ผ่าน (onboarding รันจริง; ซื้อ อัปเกรด และดีลพิสูจน์เชิงโครงสร้าง) |
| AC14 | e2e: ร้านตัวอย่างที่ไม่มีแถวสิทธิ์ (ชุดสิทธิ์ยังรอการเตรียม) สลับได้และตัวนับรายการเปลี่ยนแปลงอยู่ที่ 0, ร้านที่มีแถวสิทธิ์ครบสลับได้, ฟีเจอร์แม่ปิดแล้วกดไม่ได้พร้อมเหตุผลและค่าที่เก็บไม่เปลี่ยน; ล็อกปุ่ม “เมนูย่อย” กลับแล้ว e2e แดง | ผ่าน |
| AC15 | unit และ PG spec (no-op, 409, ร้านปิดหรือเก็บถาวรถูกปฏิเสธ, audit หนึ่งแถวต่อการเปลี่ยน, กดพร้อมกันได้การเปลี่ยนเดียว), e2e (audit หนึ่งแล้วสองแถว, 409 แสดงข้อความไทยแล้วกดครั้งถัดไปบันทึกได้) | ผ่าน |
| AC16 | e2e ตรวจข้อความตรงตัวทุกจุดที่แสดงในการเดินทาง รวมสถานะ “ไม่แสดง” เมื่อฟีเจอร์แม่ปิดและข้อความใต้ชุดสิทธิ์ขณะล็อก และหน้าที่ไม่แสดงไม่มีคำว่าไม่มีสิทธิ์; unit ต่อสถานะ; ประโยคที่แก้อยู่ในภาคผนวก C ของ spec (P7 เพิ่มอีกหกจุด) | ผ่าน (บรรทัด “กรุณาติดต่อเจ้าของกิจการ” พิสูจน์ด้วย render test เท่านั้น) |
| AC17 | e2e (ปุ่มหาย หมายเหตุอยู่ต้นหัวข้อ), unit, test ประโยคของคู่มือที่เสนอการบันทึกด้วยมือ (P7), hash ใน `approved-product-help.ts` ตรงกับไฟล์ที่แก้, `approved-knowledge.spec.ts` 10 ข้อผ่าน, การ์ดหกใบที่อ้างคู่มือนี้ตรวจแล้ว | ผ่าน |
| AC18 | ภาพที่ 390, 640, 768, 1024 และ 1280 px ไม่มีส่วนเกินขอบจอ, keyboard focus ถึงสวิตช์, e2e วัดความกว้างทั้งสอง session, สวิตช์กดไม่ได้ระหว่างบันทึก (wiring), error 500 แสดงข้อความไทยและกดต่อได้ | ผ่าน |
| AC19 | migration สร้างตารางใหม่กับ index และ foreign key ของตัวเองเท่านั้น (test ใน PG spec; เพิ่มคำสั่งที่แตะตารางอื่นแล้วแดง), `prisma migrate deploy` 274 รายการผ่านบนฐานข้อมูลเปล่า, ไม่มี backfill | additive ผ่าน; การถอย image ไม่ได้รัน (เหตุผลตาม spec §15 ข้อ 4: โค้ดเก่าไม่อ่านตารางนี้) |
| AC20 | สร้างจาก develop `608b4a6f5`; ไม่ใช้ผล e2e เดิมใน `docs/evidence`; e2e เดิม 13 ข้อที่ล้มบนฐานข้อมูลเดียวกันล้มที่บรรทัดเดียวกันบนเว็บของ commit เริ่มงาน จึงระบุแยกใน memory | ผ่าน |

## 6. Rollout / rollback / final handoff

- [ ] อ่าน cloud/deployment runbooks ก่อนทำ operation ที่อยู่ใน scope ของ runbook งานเอกสารนี้ไม่ dispatch deploy
- [ ] งานนี้เป็น application change ที่มี migration จึงใช้เส้นทาง PR/CI → UAT `all` → Passport ใหม่ → READY → Production ตาม protocol บันทึก source SHA และ UAT/READY/Production run IDs ไม่ยิง duplicate run เพื่อหาข้อผิดพลาดถัดไป
- [ ] migration, API และ web ออกใน release เดียวกัน (web และ API อยู่ image เดียว)
- [ ] ผู้ช่วย (`apps/ai-gateway`: การ์ด `expense.start` และ hash ของคู่มือ) ปล่อยในรอบเดียวกัน มิฉะนั้นคำตอบใน LINE ยังเสนอการบันทึกด้วยมือโดยไม่มีเงื่อนไข
- [ ] ไม่แก้ค่าตั้งของร้าน, role grants, invoice, expense หรือ tax data เพื่อทำให้ test ผ่าน
- [ ] บันทึกผลของวันปล่อยตาม spec §15: ทางเข้าหายสำหรับทุกร้านที่มีอยู่จนกว่าผู้ดูแลจะเปิดให้ทีละร้าน และข้อจำกัดของ rollback ตามข้อ 4: ถอย image แล้วทุกร้านเห็นเมนู ตารางใหม่ถูกปล่อยไว้
- [ ] Release handoff ระบุ implementation tests, PG/browser evidence และ live signed/customer OPEN evidence แยกกัน

เอกสารหลักที่ต้องปรับเมื่อ implementation เสร็จ: `expense-receipt-upload-spec.md` (ทางเข้าหน้า manual ขึ้นกับค่าตั้งของร้าน) และ `docs/runbooks/cloud-environment-operations.md` ถ้ามี inventory ของตาราง `feature-entitlement-submenu-plan.md` และ `feature-entitlement-decoupling-spec.md` **ไม่ต้องแก้** เพราะงานนี้ไม่เพิ่ม key และไม่ทำ nav-only gating ในชุดสิทธิ์ (3 ต.ค. 2569: แก้ `expense-receipt-upload-spec.md` แล้ว; runbook มีเพียง inventory ของทรัพยากร cloud ไม่มีตารางฐานข้อมูล จึงไม่แก้)

## 7. สถานะงานเอกสาร

2026-10-01: [Local E2E report](../qa/manual-expense-web-entry-flag-e2e-simulation-2026-10-01-th.md) เป็นผลปิด key เดิม `expenses.manual` บนฐานโค้ดเก่า ห้าม tick P1–P6 หรืออ้าง acceptance จากผลนั้น

2026-10-01 (รีวิวอิสระและฉบับแก้): spec ปรับเป็น v3.0 และแผนนี้ถูกเขียนใหม่ตาม[รีวิวอิสระ](../research/manual-expense-web-entry-flag-review-2026-10-01-th.md) สิ่งที่แผนฉบับ v2 ขาดและฉบับนี้เพิ่ม: เริ่มจาก develop ล่าสุดและตรวจซ้ำ (RM-01), ลำดับที่ไม่ทิ้งช่วงให้ระบบชำระเงินพัง (RM-03, RM-19), W00 manifest กับ reliability corpus (RM-09), ไฟล์คู่มือที่ถูกตรึง (RM-10), ไฟล์ที่ถูกตรึงสำหรับ maintenance และการลงทะเบียน spec (RM-19)

2026-10-02 (เจ้าของตัดสิน): เจ้าของตอบ D1–D8 ว่า “ตามที่แนะนำทั้งหมด” spec และแผนนี้จึงเปลี่ยนสถานะเป็นตัดสินแล้ว ไม่มีคำตอบข้อใดต่างจากที่เขียนไว้ จึงไม่มีขั้นตอนของแผนที่ต้องแก้ D8 (บั๊กปุ่มลบ B1) แก้แยกและ merge แล้วใน PR #950 (develop) และ PR #951 (main) เจ้าของยังไม่ได้สั่งเริ่ม implement

2026-10-03 (เจ้าของยืนยันค่าเริ่มต้น): เจ้าของยืนยันการอ่านของผู้ควบคุมงาน “ปิดเป็นค่าเริ่มต้นทุกร้าน รวมร้านเก่าด้วย” ทางเลือกที่ให้ร้านเดิมคงเมนูไว้ด้วยแถว “แสดง” ครั้งเดียวไม่เอา และไม่ได้สร้าง ไม่มีขั้นตอนของแผนหรือโค้ดที่ต้องแก้เพราะงานสร้างตามการอ่านนี้อยู่แล้ว

2026-10-03 (P6): e2e ใหม่ `e2e/manual-expense-web-entry.spec.ts` สองข้อผ่านบน stack ทดสอบของงานนี้ และย้อนโค้ดเว็บทีละบรรทัดสิบจุดแล้ว e2e แดงที่บรรทัดของจุดนั้น e2e เดิมที่เปิดหน้า manual ผ่านโดยไม่แก้เพราะ seed เขียนแถว “แสดง” (ลบแถวนั้นแล้ว TAX-11B-03 แดง ใส่คืนแล้วเขียว) หลักฐานต่อ AC อยู่ใน §5.1 ยังไม่ปล่อย ขั้นใน §6 ยังไม่ได้ทำ

2026-10-03 (P7 รอบแก้ถ้อยคำ): หลังเจ้าของยืนยันค่าเริ่มต้น ผู้ควบคุมงานสั่งแก้ข้อความที่จริงเฉพาะร้านที่แสดงเมนู: คู่มือค่าใช้จ่าย การ์ด LINE `expense.start` สถานะข้างสวิตช์เมื่อฟีเจอร์แม่ปิด ข้อความใต้ชุดสิทธิ์ขณะล็อก บรรทัดติดต่อ (เจ้าของกิจการ) และ `expense-receipt-upload-spec.md` ระหว่างแก้พบเพิ่มสองจุดในกลุ่มเดียวกันและแก้ด้วย: คำอธิบายใต้สวิตช์ที่สมมุติว่าทุกร้านเชื่อม LINE และลิงก์ไม่มีไฟล์ใบเสร็จที่เสนอ “บันทึกด้วยมือ” กับพนักงานที่ wizard ไม่ให้ทำ

งานเอกสารรอบนี้เสร็จเมื่อ spec/plan/audit/QA/memory สอดคล้องกัน, links ตรวจผ่าน และ diff เป็น documentation only ไม่ทำเครื่องหมาย implementation checklist ข้างบนว่าเสร็จ

2026-10-02 (เจ้าของสั่งเริ่มและเปลี่ยนค่าเริ่มต้น): เจ้าของสั่งเริ่ม implement งานเริ่มจาก develop `608b4a6f5` บน branch `claude/manual-expense-web-entry-20261002` ระหว่างงาน (ประมาณ 23:08) เจ้าของสั่ง “สวิตช์ซ่อนเมนู ให้เป็น default ปิดไปเลยนะ” แผนนี้จึงปรับ P1, P2, P4, P5, §4 และ §5 ตาม spec v3.1: ร้านไม่มีแถว = ไม่แสดง ตัดสินที่จุดเดียวฝั่ง API, seed ของร้านตัวอย่างเขียนแถว “แสดง”, e2e ใหม่เริ่มจากร้านที่ไม่มีแถว คำถามเรื่องที่รันของ spec ฝั่ง API (เดิมค้างใน §4) ปิดแล้ว: ไม่แก้ `package.json`
