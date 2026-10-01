# Plan: สวิตช์ทางเข้า manual expense บนเว็บ

วันที่: 2026-10-01

Status: **READY FOR IMPLEMENTATION — ยังไม่เริ่มแก้โค้ด**

Source of truth: [Spec v2.0](../specs/manual-expense-web-entry-flag-spec-th.md) · [Audit](../research/manual-expense-web-entry-flag-audit-2026-10-01-th.md) · [Memory](../agent-memory/manual-expense-web-entry-flag.md)

## 1. Scope lock ก่อนเริ่ม

Owner decision ล่าสุด: เพิ่ม flag ย่อยใต้บันทึกด้วยมือ ซ่อนทางเข้า menu และให้เบื้องหลังทำงานเหมือนเดิม

- เปลี่ยนเฉพาะการรับเข้าหน้า `/expenses/manual` และลิงก์ที่พาไปหน้านี้
- **อย่า implement ข้อเสนอ audit เก่าที่ตัด `expense.create`, ปิด API หรือปิด wizard**
- เพิ่ม `expenses.manual.web_entry` (permissionKeys ว่าง); คง `expenses.manual` และ mapping create/update เดิมทุกประการ
- ไม่รวมการแก้ delete/LINE หลังบ้านใน switch diff; เก็บ F02/F03 เป็น follow-up แยกตาม spec §11–12
- ไม่แก้ `package.json`, ไม่เพิ่ม dependency, ไม่เปลี่ยน flag ใน environment ระหว่างพัฒนา
- ก่อน code edits อ่าน ponytail full จาก `.agents/skills/ponytail/SKILL.md` ใน checkout นี้ (path `/Users/spare058/WatchDog-BMS/...` ใน instructions เก่าเป็น stale path)
- `apps/web/AGENTS.md` กำหนดให้อ่าน Next.js docs ที่ติดตั้งจริงก่อนเขียน web code
- ไม่มี requirement ให้ใช้ legacy role agents หรือ legacy role-gate templates

## 2. File/change inventory

| กลุ่ม | Files / symbols หลัก | งาน |
| --- | --- | --- |
| Contracts | `packages/contracts/src/feature-entitlements.ts`, `index.ts` | New entry leaf + approved key, preserve old manual permission mapping, additive context field |
| Parent permission tests | `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.spec.ts`, `menu-entitlement-binding.spec.ts` | Assert permission invariance for NEW key; old manual and parent still gate |
| Auth propagation | `auth/domain/models/request-context.model.ts`, `application/use-cases/resolve-request-context.use-case.ts`, `presentation/auth.controller.ts` | ส่ง resolver field ถึง auth/me |
| Web context | `common/models/web-session.model.ts`, `features/web-core-workspace/workspace-scope.api.ts`, `WorkspaceLayout.tsx` | Type, fingerprint, feature-only revalidation และไม่ทิ้ง admitted form |
| Manual entry helper/gate | `features/expenses/` และ `app/(workspace)/companies/[companyId]/expenses/manual/page.tsx` | Helper เล็ก, dedicated admission; preserve mounted state |
| Nav/list | `web-core-workspace.logic.ts`, `ExpensesPages.tsx`, route page prop chains | Gate entry; keep caps.canCreate authority semantics |
| Adjacent links | `IncomeExpenseLedgerPage.tsx`, `expenses-guide.content.ts`, `ai-suggestions.logic.ts`, callers, `TransactionTaxLineSelector.tsx` | ใช้ availability เดียวกัน; direct-return route ผ่าน gate |
| Admin | `PartnerDetailPage.tsx`, `system-partners.logic.ts` | Nested child switch, no extra nav node; preserve new entry choice in preset/billing/parent transitions |
| Separate follow-up only | `expenses/presentation/http/expense.controller.ts` | F02; no controller edits in entry-switch diff |
| Separate follow-up only | `expenses/application/use-cases/expense-document.use-case.ts` + tests | F03; no LINE key change in entry-switch diff |
| Regression only by default | billing/reimbursements/capture/ledger/tax/LINE edit modules | ไม่แก้ production source ถ้า focused checks ไม่ชี้ defect ใน scope |

ทุก path กลุ่ม API ที่ย่อเริ่มจาก `apps/api/src/modules/`; web เริ่มจาก `apps/web/src/` ยกเว้น `app/` ซึ่งอยู่ที่ `apps/web/app/`

## 3. Implementation sequence และ checkpoint

### P0 — ตรวจ candidate และบันทึกฐาน

- [ ] อ่าน spec ทั้งฉบับและ task memory
- [ ] ตรวจ working tree; มี unrelated in-progress changes ให้เก็บไว้ ไม่ revert/format ทับ
- [ ] ตรวจ callers ของ `CreateExpenseDraftUseCase`, `applyPreset`, `buildNavItems`, session fingerprint และทุกลิงก์ manual อีกครั้ง
- [ ] บันทึก candidate SHA, dirty-file scope, baseline command/results
- [ ] ยืนยัน source/dist ของ contracts ตรงกันก่อนใช้ web test results; build contracts ผ่าน script เดิมหากจำเป็น

Exit: ขอบเขตและ baseline ตรวจซ้ำได้ ไม่มี code edit นอก inventory โดยไม่มีเหตุ

### P1 — New key และ session contract

- [ ] เพิ่ม flat catalog leaf `expenses.manual.web_entry` โดยคง definition ของ `expenses.manual`; ไม่มี owned permissions/pack/SKU/nav node ใหม่
- [ ] ตรวจ approved keys, absent-row inheritance, onboarding/preset default และไม่สร้าง recursive feature engine
- [ ] Forward `ResolvedAccess.entitledFeatureKeys` ผ่าน API/shared RequestContext และ `/auth/me`
- [ ] Update WebSession/MyContext/fixtures อย่างชัดเจน; array/null/unknown semantics ตาม spec §6
- [ ] Add one pure manual-entry helper; `expense.create` เป็นเงื่อนไขจำเป็น แต่ไม่เพียงพอ
- [ ] Include normalized feature snapshot ใน access fingerprint; ทดสอบ feature-only diff, reordered array, null/absent และ tenant switch
- [ ] ไม่เพิ่ม query ต่อ menu/CTA, ไม่แตะ JWT/localStorage authority

Exit: key/field/helper ถูกต้อง; old permission mapping คงเดิมและจะไม่ถูกถอนใน phase ใด

### P2 — Web admission, all entry points และฟอร์มที่เปิดอยู่

- [ ] ต่อ nav/list/ledger/guide/AI guidance กับ helper และ prop chain ที่มีอยู่
- [ ] Dedicated route/hub manual gate รองรับ direct URL, query alias และ tax return
- [ ] Gate state keyed user/company/mount; OFF ใหม่ไม่ unmount form ที่รับเข้าแล้ว
- [ ] Revalidation ใช้ poll/focus เดิม; ทดสอบ `router.refresh` ไม่ reset form/file/save key
- [ ] ลด stale prefetch ที่ dedicated links; Back/Forward ก่อน admission ต้องตรวจ context ล่าสุด
- [ ] ไม่มีการเอา entry bool ไปทับ `caps.canCreate` หรือ gate wizard/upload/shared API
- [ ] Thai copy + accessibility + mobile และ retry/error states

Exit: OFF admission ปิดครบ ข้อมูลที่ผู้ใช้กำลังกรอกยังอยู่ และ ON กลับเข้าหน้าได้โดยไม่ต้อง relogin

### P3 — Admin child switch, presets และ billing

- [ ] Render switch ใหม่ใต้ manual row เดิม; ไม่เพิ่ม sibling navigation item/route/menu card
- [ ] Parent/manual OFF แสดง stored entry choice แบบ disabled; ไม่ overwrite preference
- [ ] Admin preview/copy ระบุทางเข้าเว็บ; key เดิมยังมี semantics เดิม
- [ ] `applyPreset`, bulk/group toggles, parent off/on รักษา explicit/pending new-key choice
- [ ] Billing renewal/conversion รักษา adminOverrideKeys สำหรับ key ใหม่; missing default ไม่ถูกเขียน false จาก preset list เก่า
- [ ] Onboarding/default package มี new key ON ตาม compatibility; existing absent row ไม่ต้อง backfill
- [ ] Command/CAS/replay/payload conflict/audit/normalization/inactive controls ยังครบ

Exit: admin ปิดเฉพาะ entry ได้ ไม่มี permission/feature อื่นเปลี่ยนโดยแฝง

### P4 — Regression boundaries และ known backend bugs

- [ ] เทียบ full permission set ทุกบทบาทเมื่อ NEW key ON/OFF/ON โดยตรึง key เดิมไว้
- [ ] ทดสอบ old manual OFF และ parent OFF ว่ายังถอน authority เดิม; new key ON ไม่คืนสิทธิ์
- [ ] API create/update/delete/reviewer-ready, OCR/source draft, wizard และ reimbursement ให้ผลเดิมก่อน/หลัง new-key toggle
- [ ] เก็บ F02 DELETE mismatch และ F03 LINE invalid key เป็น known baseline แยก; ไม่แก้หลังบ้านใน switch diff
- [ ] ห้ามนับ LINE mock-success เป็น proof; real composed LINE flow ปัจจุบันต้องบันทึก 400 ตามที่เกิดจริง
- [ ] หากแยกงานแก้ F02/F03 ภายหลัง ให้ใช้ spec §11–12 และหลักฐาน E2E รอบนี้เป็น red→green; ไม่ปิด issue จากงาน visibility

Exit: switch ไม่สร้าง backend regression และรายงาน known bugs ตรงไปตรงมา

### P5 — Integration/browser/database evidence

- [ ] ทำ acceptance matrix ด้านล่างใน test tenant/local database ที่ตั้งไว้สำหรับทดสอบ
- [ ] ตรวจ duplicate prevention/transaction replay ด้วย PostgreSQL suite เดิมที่เกี่ยวข้อง
- [ ] Browser desktop/mobile; admin session แยกจาก staff/reviewer เพื่อพิสูจน์ refresh หลังเปลี่ยน flag
- [ ] Capture groups, substitute wizard, reimbursement projections, upload-without-OCR, ledger/tax/report effects ครบ
- [ ] บันทึก commands/results และข้อจำกัดจริงใน memory; no silent skip
- [ ] Update canonical docs ที่ยังอธิบาย permission mapping เดิมหลัง implementation ผ่าน

Exit: AC01–AC20 มี evidence mapping; ยังไม่ถือว่า live release สำเร็จจนผ่าน deployment protocol

## 4. Focused verification commands

คำสั่งต่อไปนี้เป็น **แผนสำหรับ implementation candidate** ไม่ใช่ผลรันงานเอกสาร และไม่ต้องเพิ่ม script ใน package.json

API จาก `apps/api`:

```sh
pnpm exec tsx --test src/modules/employee-access/domain/logic/feature-gate.logic.spec.ts src/modules/employee-access/domain/logic/menu-entitlement-binding.spec.ts src/modules/employee-access/application/entitlement.helper.spec.ts src/modules/access-control/permission-resolver.spec.ts src/modules/auth/presentation/auth.controller.spec.ts
pnpm exec tsx --test src/modules/system-partner-management/application/use-cases/set-partner-features.use-case.spec.ts src/modules/billing/application/billing-feature-entitlements.spec.ts
pnpm exec tsx --test src/modules/expenses/application/use-cases/delete-expense.use-case.spec.ts src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts src/modules/expenses/application/use-cases/expense-draft-concurrency.use-case.spec.ts src/modules/expenses/application/expense-launch-gate.spec.ts
pnpm exec tsx --test src/modules/expenses/application/use-cases/line-correction.use-case.spec.ts src/modules/expenses/application/use-cases/line-draft-update.security.spec.ts src/modules/expenses/application/use-cases/expense-capture-handoff.use-case.spec.ts src/modules/reimbursements/application/services/materialize-claim-expenses.service.spec.ts
```

Web จาก `apps/web`:

```sh
pnpm exec tsx --test src/features/system-partners/system-partners.logic.spec.ts src/features/web-core-workspace/web-core-workspace.spec.ts src/features/expenses/expenses.model.spec.ts src/features/user-guide/user-guide.content.spec.ts src/features/ai-suggestions/ai-suggestions.logic.spec.ts
```

เพิ่ม focused tests ของ session fingerprint, manual entry helper, existing-controller regression และ composed LINE baseline ในตำแหน่งใกล้ implementation และรันด้วย `pnpm exec tsx --test <exact-path>` พร้อมบันทึกชื่อจริงใน memory ไม่สร้าง test framework ใหม่

Typecheck/build ใช้ scripts เดิมของ contracts/API/web เฉพาะ workspace ที่แตะ; อ่าน Next docs ก่อน web edits ต้องบันทึก failures ของ unrelated working tree แยกจาก regression ที่เปลี่ยนนี้สร้าง

PG/browser: อ่าน fixture/setup ของ `apps/api/src/modules/expenses/expense-capture-handoff.pg.spec.ts`, `line-draft-update.pg.spec.ts`, `apps/api/src/modules/billing/application/billing-feature-entitlements.pg.spec.ts` และ `e2e/expenses.spec.ts` ก่อนรัน ใช้เฉพาะ test database/environment ที่ยืนยันแล้ว อย่าเดา DATABASE_URL หรือใช้ shared live tenant จาก local env โดยไม่ตรวจ

## 5. Acceptance matrix สำหรับ integration

| Scenario | Actor / setup | Expected / AC |
| --- | --- | --- |
| NEW key ON→OFF→ON | Parent + old manual ON, role create/update | Permissions equal ทุกสถานะ; only web entry changes (01–04) |
| Parent หรือ old manual OFF + NEW key ON | OWNER/ADMIN/custom | Old authority gate wins; ไม่คืนสิทธิ์ (02,08,09) |
| Child row absent / legacy null / missing field | แยกสาม fixture | inherited ON / legacy ON / unknown retry ตามลำดับ (03) |
| Direct URL / query alias / back / tax return | Fresh staff session | OFF ไม่รับเข้า manual ใหม่ (05) |
| Open form → admin OFF → focus/poll | มี input/file/save key | คงฟอร์มและบันทึกได้ครั้งเดียว; new tab denied (06,07) |
| Feature-only refresh | Permissions unchanged | nav/CTA เปลี่ยน; ไม่มี refresh loop (07) |
| Company A OFF → company B ON | ผู้ใช้มีสอง membership | snapshot/admission ไม่ปนกัน (08) |
| API create ON/OFF | create holder / read-only | holder success, read-only denied ทั้งสองสถานะ (09) |
| OCR failed/quota full | Existing WEB_UPLOAD draft | owner edit/mark-ready ได้ตามเดิม (10) |
| Wizard manual create และ existing-source link | Reviewer + existing create | OFF ไม่ปิด wizard; retained signatures/locks (11) |
| LINE real create + duplicate replay | Linked actor; real composed use cases | NEW key ไม่เปลี่ยนผล; known F03 400 รายงานแยก (12) |
| LINE edit/continuation/correction | Own mutable / other / confirmed | เดิมยังผ่าน/deny ตาม authority/state (14) |
| Delete / update own/other | Existing controller + use case | NEW key ไม่เปลี่ยนผล; F02 mismatch บันทึกแยก (15) |
| Capture / reimburse / finance | Upload, handoff, projection, confirm | ไม่มี manual web flag ใน source/financial decision (16) |
| Preset / billing renewal / CAS retry | Explicit OFF/ON + stale version | choice preserved, honest conflict/idempotent replay (17,19) |
| Keyboard / 390px / desktop / unavailable | UI loading/error states | ไม่มี hidden focus target/blank loop/false copy (18) |

## 6. Rollout / rollback / final handoff

- [ ] อ่าน cloud/deployment runbooks ก่อนทำ operation ที่อยู่ใน scope ของ runbook; งาน spec นี้ไม่ dispatch deploy
- [ ] API รู้จัก key ใหม่ + field พร้อม → web consumer/admin gate พร้อม → จึงอนุญาตใช้งาน switch ใหม่; mapping เดิมคงเดิมตลอด
- [ ] บันทึก source SHA, UAT/READY/Production run IDs ตาม protocol; ไม่ยิง duplicate run เพื่อหาข้อผิดพลาดถัดไป
- [ ] ไม่แก้ stored flag, role grants, invoice, expense หรือ tax data เพื่อทำให้ test ผ่าน
- [ ] บันทึก rollback limitation: web เก่าอาจแสดง entry กลับเพราะไม่อ่าน key ใหม่; ไม่เปลี่ยน authority/mapping
- [ ] Release handoff ระบุ implementation tests, PG/browser evidence และ live signed/customer OPEN evidence แยกกัน

Canonical documents ที่ต้อง reconcile เมื่อ implementation เสร็จ: `feature-entitlement-submenu-plan.md` (เพิ่ม visibility child โดยคง mapping เดิม), `feature-entitlement-decoupling-spec.md` (exception สำหรับ visibility-only child), `expense-receipt-upload-spec.md` (web entry); เอกสาร LINE/delete เปลี่ยนใน separate backend fix เท่านั้น

## 7. Current task completion

2026-10-01: [Local E2E report](../qa/manual-expense-web-entry-flag-e2e-simulation-2026-10-01-th.md) เป็นผลปิด OLD key บน baseline ก่อน v2; ห้าม tick P1–P5 หรืออ้าง acceptance ของ key ใหม่จากผลนั้น

งานปัจจุบันเสร็จเมื่อ spec/plan/audit/memory เขียนครบ, links/source references ตรวจผ่าน และ diff เป็น documentation only ไม่ทำเครื่องหมาย implementation checklist ข้างบนว่าเสร็จจากผล baseline audit
