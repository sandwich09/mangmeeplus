# Plan: สวิตช์ทางเข้า manual expense บนเว็บ

วันที่: 2026-10-01 · ปรับสถานะล่าสุด: 2026-10-02 · แก้ตาม spec v3.1 (ค่าเริ่มต้นคือไม่แสดง — เจ้าของสั่ง 2 ต.ค. 2569)

Status: **เจ้าของสั่งเริ่ม implement เมื่อ 2 ต.ค. 2569 — กำลังสร้างบน branch `claude/manual-expense-web-entry-20261002` (เริ่มจาก develop `608b4a6f5`) ยังไม่ปล่อย กล่องที่ติ๊กคือขั้นที่ทำเสร็จและมีผลรันจริงใน memory**

ข้อตัดสินใจ D1–D8 ใน spec §1.2: ตัดสินแล้ว 2 ต.ค. 2569 (เจ้าของ: ตามที่แนะนำ) · ครึ่งแรกของ D2 ถูกเจ้าของเปลี่ยนในวันเดียวกัน: **ค่าเริ่มต้นคือไม่แสดงเมนู** ร้านไม่มีแถวอ่านได้ว่าไม่แสดง ผู้ดูแลระบบเปิดให้ทีละร้าน (การอ่านของผู้ควบคุมงาน ขอเจ้าของยืนยันอยู่)

Source of truth: [Spec v3.1](../specs/manual-expense-web-entry-flag-spec-th.md) · [รีวิวอิสระ](../research/manual-expense-web-entry-flag-review-2026-10-01-th.md) · [Memory](../agent-memory/manual-expense-web-entry-flag.md) · [บั๊กที่แก้แยก](../research/manual-expense-current-code-bugs-2026-10-01-th.md)

แผนนี้เขียนตามคำตอบ D1–D8 ซึ่งเจ้าของตัดสินตามนั้นแล้ว จึงใช้ได้ตามที่เขียนทั้งฉบับ ทางเลือกของ D1 (เป็น key ใน catalog) ไม่ได้เลือก และแผนนี้ใช้กับทางนั้นไม่ได้ สิ่งที่ทางนั้นต้องสร้างเพิ่มเก็บไว้เป็นบันทึกใน spec ภาคผนวก B

## 1. Scope lock ก่อนเริ่ม

- เจ้าของตัดสิน D1–D8 แล้วเมื่อ 2 ต.ค. 2569 และวันที่บันทึกใน memory แล้ว เจ้าของสั่งเริ่ม implement ในวันเดียวกัน และเปลี่ยนค่าเริ่มต้นเป็นไม่แสดง (spec §1.2)
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

- [ ] `me()` คืน `manualExpenseWebEntry` ของบริษัทใน context ร้านไม่มีแถวได้ **false** ผ่านจุดตัดสินเดียวกับรายละเอียดร้าน
- [ ] เพิ่ม field ใน `WebSession` และ `MyContext` แบบ optional
- [ ] เพิ่ม helper `canOpenManualWeb` ตาม spec §6.2 ค่าหายถือว่าแสดง (predicate ฝั่งเว็บไม่เปลี่ยนตามค่าเริ่มต้นใหม่)
- [ ] seed ของร้านตัวอย่าง (`apps/api/prisma/seed.ts`) เขียนแถว “แสดง” เพื่อให้ e2e เดิม local stack และร้านตัวอย่างยังเห็นเมนู ไม่แก้ที่ตัว test
- [ ] เพิ่ม boolean ใน `accessContextFingerprint` เท่านั้น
- [ ] ไม่แตะ JWT, localStorage, resolver หรือ `RequestContext`

Exit: เว็บรู้ค่าของร้าน ร้านที่ไม่มีแถวไม่เห็นทางเข้า และแท็บที่เปิดค้างปรับเมนูในรอบ focus/poll เดิม

### P3 — Gate, ทางเข้า และคู่มือ

- [ ] gate ครอบเฉพาะ `ManualExpensePanel` ตามกติกา spec §7.1: รับเข้าแล้วจำผล ไม่ถอนเมื่อ prop เปลี่ยน
- [ ] server page ส่งผลของ helper เป็น prop และ render gate กับฟอร์มเสมอ
- [ ] ต่อ nav, ปุ่มหน้ารายการ, ledger (ปุ่ม, การ์ด, empty state), AI แนะนำ กับ helper ตาม prop chain ที่มีอยู่
- [ ] แปลงผลลัพธ์ของ `buildExpensesGuide` ในไฟล์ใหม่: ตัดปุ่มของหัวข้อ `manual` และเพิ่มหมายเหตุ ไม่แก้ไฟล์ที่ถูกตรึง
- [ ] ข้อความตาม spec §8 รวมสถานะที่ไม่มีปุ่มให้แสดง, accessibility และ 390px
- [ ] ไม่เอาผลของ helper ไปทับ `caps.canCreate` หรือ gate wizard/upload/shared API

Exit: ร้านที่ไม่แสดงเมนูไม่มีทางเข้าใน spec §9.1 เลย ผู้ดูแลเปิดแล้วทางเข้ามาโดยไม่ต้อง login ใหม่ ปิดแล้วฟอร์มที่กรอกค้างยังอยู่

### P4 — หน้าผู้ดูแล

- [ ] แสดงสวิตช์ใต้แถว “บันทึกด้วยมือ” ไม่เพิ่มแถวเมนู, route หรือ navigation item
- [ ] บันทึกผ่าน command ใหม่ทันทีหลังยืนยัน ไม่อยู่ใน pending ของชุดสิทธิ์ ไม่ผ่าน `toggleSubmenu`, `applyPreset` หรือปุ่ม “ตรวจสอบและบันทึก”
- [ ] กดไม่ได้เมื่อ `expenses` หรือ `expenses.manual` ที่บันทึกแล้วปิดอยู่ แสดงค่าที่เก็บไว้
- [ ] ข้อความยืนยันเฉพาะตอนเปลี่ยนจากแสดงเป็นไม่แสดง (การเปิดไม่ต้องยืนยัน) คำเตือนเพิ่มในขั้นยืนยัน และหมายเหตุประจำแถว เมื่อ `expenses.upload` ของร้านปิดอยู่
- [ ] 409 แสดงข้อความให้โหลดใหม่ และโหลดรายละเอียดร้านใหม่

Exit: ผู้ดูแลแสดงและซ่อนเมนูให้ร้านเดิมได้ รวมร้านที่ชุดสิทธิ์ยังรอการเตรียม โดยรายการเปลี่ยนแปลงของชุดสิทธิ์ไม่ขยับ

### P5 — Invariants และ regression

- [ ] `git diff --stat` เทียบ commit เริ่มงาน: ไม่มีไฟล์ในรายการห้ามแก้ของ §1 และ §2
- [ ] permissions และ `entitledFeatureKeys` ของ `/auth/me` เท่าเดิมก่อนและหลังสลับค่า สำหรับทุกบทบาทใน `ROLE_GRANTS` และทุกเทมเพลตใน `ROLE_TEMPLATES`
- [ ] สลับค่าแล้ว `CompanyEntitlementSet.setVersion` และ `billingFeaturePlan().plan.sourceHash` ของร้านไม่เปลี่ยน
- [ ] สลับค่าแล้วแถว `AiConversation`, `AiTurn`, `LineIntakePendingMedia`, `LineDeliveryPlan` ของร้านไม่เปลี่ยน
- [ ] สร้างร้านใหม่ผ่าน onboarding แล้วไม่มีแถวค่าตั้ง และ `/auth/me` คืน **false**
- [ ] API create/update/delete/mark-ready, OCR/source draft, wizard และ reimbursement ให้ผลเดิมก่อนและหลังสลับค่า
- [ ] e2e เดิมที่เปิดหน้า manual ผ่านโดยไม่แก้
- [ ] ตรวจสามสถานะฐานของ P0 ซ้ำ ต้องยังเขียวและ `status=current`

Exit: งานนี้ไม่สร้าง regression นอกหน้าจอ และพิสูจน์ได้ว่าไม่แตะเงิน สิทธิ์ และ LINE

### P6 — Integration/browser/database evidence และ release handoff

- [ ] ทำ acceptance matrix ใน §5 ใน test tenant/local database ที่ตั้งไว้สำหรับทดสอบ
- [ ] Browser desktop และ 390px โดย session ของผู้ดูแลแยกจากพนักงาน เพื่อพิสูจน์ refresh หลังสลับค่า
- [ ] บันทึก commands/results และข้อจำกัดจริงใน memory ไม่มี silent skip
- [ ] เขียน e2e ใหม่ใต้ `e2e/` โดยสลับค่าตั้งใหม่ ไม่นำ harness ใน `docs/evidence` มาใช้
- [ ] ปรับเอกสารหลักที่อ้างพฤติกรรมนี้ (§6)

Exit: AC01–AC20 มี evidence mapping ยังไม่ถือว่า live release สำเร็จจนผ่าน deployment protocol

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
| invariants | PostgreSQL spec ใหม่หนึ่งไฟล์ | รายการใน P5 ข้อ 2–5 |

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

## 6. Rollout / rollback / final handoff

- [ ] อ่าน cloud/deployment runbooks ก่อนทำ operation ที่อยู่ใน scope ของ runbook งานเอกสารนี้ไม่ dispatch deploy
- [ ] งานนี้เป็น application change ที่มี migration จึงใช้เส้นทาง PR/CI → UAT `all` → Passport ใหม่ → READY → Production ตาม protocol บันทึก source SHA และ UAT/READY/Production run IDs ไม่ยิง duplicate run เพื่อหาข้อผิดพลาดถัดไป
- [ ] migration, API และ web ออกใน release เดียวกัน (web และ API อยู่ image เดียว)
- [ ] ไม่แก้ค่าตั้งของร้าน, role grants, invoice, expense หรือ tax data เพื่อทำให้ test ผ่าน
- [ ] บันทึกผลของวันปล่อยตาม spec §15: ทางเข้าหายสำหรับทุกร้านที่มีอยู่จนกว่าผู้ดูแลจะเปิดให้ทีละร้าน และข้อจำกัดของ rollback ตามข้อ 4: ถอย image แล้วทุกร้านเห็นเมนู ตารางใหม่ถูกปล่อยไว้
- [ ] Release handoff ระบุ implementation tests, PG/browser evidence และ live signed/customer OPEN evidence แยกกัน

เอกสารหลักที่ต้องปรับเมื่อ implementation เสร็จ: `expense-receipt-upload-spec.md` (ทางเข้าหน้า manual ขึ้นกับค่าตั้งของร้าน) และ `docs/runbooks/cloud-environment-operations.md` ถ้ามี inventory ของตาราง `feature-entitlement-submenu-plan.md` และ `feature-entitlement-decoupling-spec.md` **ไม่ต้องแก้** เพราะงานนี้ไม่เพิ่ม key และไม่ทำ nav-only gating ในชุดสิทธิ์

## 7. สถานะงานเอกสาร

2026-10-01: [Local E2E report](../qa/manual-expense-web-entry-flag-e2e-simulation-2026-10-01-th.md) เป็นผลปิด key เดิม `expenses.manual` บนฐานโค้ดเก่า ห้าม tick P1–P6 หรืออ้าง acceptance จากผลนั้น

2026-10-01 (รีวิวอิสระและฉบับแก้): spec ปรับเป็น v3.0 และแผนนี้ถูกเขียนใหม่ตาม[รีวิวอิสระ](../research/manual-expense-web-entry-flag-review-2026-10-01-th.md) สิ่งที่แผนฉบับ v2 ขาดและฉบับนี้เพิ่ม: เริ่มจาก develop ล่าสุดและตรวจซ้ำ (RM-01), ลำดับที่ไม่ทิ้งช่วงให้ระบบชำระเงินพัง (RM-03, RM-19), W00 manifest กับ reliability corpus (RM-09), ไฟล์คู่มือที่ถูกตรึง (RM-10), ไฟล์ที่ถูกตรึงสำหรับ maintenance และการลงทะเบียน spec (RM-19)

2026-10-02 (เจ้าของตัดสิน): เจ้าของตอบ D1–D8 ว่า “ตามที่แนะนำทั้งหมด” spec และแผนนี้จึงเปลี่ยนสถานะเป็นตัดสินแล้ว ไม่มีคำตอบข้อใดต่างจากที่เขียนไว้ จึงไม่มีขั้นตอนของแผนที่ต้องแก้ D8 (บั๊กปุ่มลบ B1) แก้แยกและ merge แล้วใน PR #950 (develop) และ PR #951 (main) เจ้าของยังไม่ได้สั่งเริ่ม implement

งานเอกสารรอบนี้เสร็จเมื่อ spec/plan/audit/QA/memory สอดคล้องกัน, links ตรวจผ่าน และ diff เป็น documentation only ไม่ทำเครื่องหมาย implementation checklist ข้างบนว่าเสร็จ

2026-10-02 (เจ้าของสั่งเริ่มและเปลี่ยนค่าเริ่มต้น): เจ้าของสั่งเริ่ม implement งานเริ่มจาก develop `608b4a6f5` บน branch `claude/manual-expense-web-entry-20261002` ระหว่างงาน (ประมาณ 23:08) เจ้าของสั่ง “สวิตช์ซ่อนเมนู ให้เป็น default ปิดไปเลยนะ” แผนนี้จึงปรับ P1, P2, P4, P5, §4 และ §5 ตาม spec v3.1: ร้านไม่มีแถว = ไม่แสดง ตัดสินที่จุดเดียวฝั่ง API, seed ของร้านตัวอย่างเขียนแถว “แสดง”, e2e ใหม่เริ่มจากร้านที่ไม่มีแถว คำถามเรื่องที่รันของ spec ฝั่ง API (เดิมค้างใน §4) ปิดแล้ว: ไม่แก้ `package.json`
