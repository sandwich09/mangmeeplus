# Audit: manual expense flag — code, impact, bugs และขอบเขตเว็บ

วันที่: 2026-10-01 · Audit baseline HEAD: `4a5817b42` พร้อม existing uncommitted changes ใน shared working tree

Status: **AUDIT + LOCAL E2E COMPLETE; v2 CHILD FLAG IMPLEMENTATION NOT STARTED**

## หมายเหตุกำกับ 2026-10-01 (เพิ่มหลังรีวิวอิสระ) — อ่านก่อนใช้เอกสารนี้

เนื้อหาใต้หมายเหตุนี้คงไว้ตามที่เขียนเดิมเพื่อเป็นประวัติ ไม่ได้ถูกแก้ แหล่งอ้างอิงปัจจุบันคือ [spec v3.0](../specs/manual-expense-web-entry-flag-spec-th.md) และ[รีวิวอิสระ](manual-expense-web-entry-flag-review-2026-10-01-th.md)

- **ฐานที่ตรวจ**: `4a5817b42` พร้อมไฟล์ที่ยังไม่ commit ใน working tree ร่วม ฐานนี้ **ไม่ใช่บรรพบุรุษของ `origin/develop`** โดย develop (`ae13970b0`) มี commit ที่ฐานนี้ไม่มี 842 รายการ และไฟล์ 3,728 ไฟล์ที่ evidence เก็บ hash ไว้ต่างจาก develop 596 ไฟล์
- **ข้อความที่ไม่เป็นจริงแล้วบน develop**
  1. F03 ทุกจุด (สองแถวของ F03 ใน §2, ย่อหน้าใต้ตาราง §2, §4.2 API ข้อ 8–9 และ recipe F03 ใน §4.3): บั๊ก key ของ LINE ถูกแก้ใน `6fddca795` (2026-09-29) การสร้าง draft จากข้อความ LINE สำเร็จแล้ว ไม่มีงานค้าง และห้ามเปลี่ยนสูตร key อีก
  2. F09: มี unit test ยืนยันรูป key แล้วใน `expense-document.use-case.spec.ts`
  3. §1: แนวทาง key `expenses.manual.web_entry` ถูกแทนด้วยค่าตั้งรายร้านใน spec v3.0 ซึ่งยังเป็นข้อเสนอรอเจ้าของยืนยัน
  4. §3 แถว “System partner command/controller/UI”: ที่ develop command นี้เรียก `invalidateLineConversationState` เมื่อค่าสิทธิ์ที่มีผลเปลี่ยน (เพิ่มเมื่อ 2026-09-27) จึงมีผลต่อ LINE ซึ่งเอกสารนี้ไม่ได้กล่าวถึง
  5. §3 แถว “Billing”: ที่ develop `billingFeaturePlan` บังคับว่าชุดแถวสิทธิ์ของร้านต้องตรง catalog ทุกแถว การเพิ่ม key เข้า catalog จึงกระทบการชำระเงิน ซึ่งเอกสารนี้ไม่ได้กล่าวถึง
  6. ข้อความของแนวทาง v1 ที่ค้างอยู่: §3 แถว “Expense list/review/manual” (“ถอด visibility flag ออกจากทั้ง create/update”), แถว “System partner…” (“เพิ่ม copy และ preset preservation เท่านั้น”) และ §4.2 API ข้อ 4 (“ผลกระทบที่ต้องหายไป”) ภายใต้ v3.0 การปิด `expenses.manual` ยังตัดสิทธิ์ตามเดิมทุกประการ
  7. ขอบเขตของ F02: ผู้ได้รับผลคือบทบาทที่สร้างจากเทมเพลตการเงินสี่แบบ ไม่ใช่บทบาท FINANCE ในระบบ รายละเอียดอยู่ใน[เอกสารบั๊ก B1](manual-expense-current-code-bugs-2026-10-01-th.md)
  8. F05: fingerprint มี `roleNames` ด้วย ไม่ได้มีเพียง roles, permissions และ scopes
  9. จำนวน key ใน catalog: ฐานนี้มี 60 ตัว ส่วน develop มี 62 ตัว
  10. เลขบรรทัดทุกจุดเป็นของฐานเก่า
- **ข้อความที่ตรวจซ้ำที่ `ae13970b0` แล้วยังจริง**: กลไกของ F01, F02, F04, F05, F07 และ F08
- **ผลทดสอบใน §4**: 359 tests และ 19 assertions รันบนฐานเก่า ใช้เป็นประวัติเท่านั้น

เอกสารนี้บันทึกสิ่งที่ตรวจพบ ไม่ใช่รายงานว่า target spec implement แล้ว

- [Target spec](../specs/manual-expense-web-entry-flag-spec-th.md)
- [Implementation plan](../plans/manual-expense-web-entry-flag-plan-th.md)
- [Memory](../agent-memory/manual-expense-web-entry-flag.md)

## 1. Owner decision ล่าสุด

Owner เริ่มจากขอ audit และ spec โดย “ปิดแค่ทางเข้าการ manual บน web” ต่อมาขอ E2E simulation และเสนอ **เพิ่ม flag ย่อยใต้ฟีเจอร์บันทึกด้วยมือ ให้เบื้องหลังเหมือนเดิม**

[Spec v2](../specs/manual-expense-web-entry-flag-spec-th.md) จึงเพิ่ม `expenses.manual.web_entry` (permissionKeys ว่าง) และคง key/mapping ของ `expenses.manual` เดิม ไม่คืนสิทธิ์ให้บริษัทที่ปิด key เดิมโดยอัตโนมัติ ข้อเสนอ v1 ให้ reuse key เดิม/ถอด mapping ถูก supersede แล้ว

[Local E2E report](../qa/manual-expense-web-entry-flag-e2e-simulation-2026-10-01-th.md): 72 valid case/browser variants บน isolated source/API/DB/storage; 55 passed, 15 ไม่ตรงเป้าหมาย v1 เมื่อปิด key เดิม, 2 baseline UI expectation gaps และ LINE real-composition PG อีก 4 attempts ยืนยัน existing key-validation bug ผลนี้ไม่ใช่ acceptance ของ key ใหม่ที่ยังไม่ implement

F02 DELETE และ F03 LINE เป็น separate backend follow-up ไม่รวม code changes ในงานสวิตช์ใหม่ตาม owner update งานนี้ไม่แก้ application source หรือ flag จริง

## 2. Findings พร้อม source references

เลขบรรทัดเป็น snapshot ขณะตรวจ ให้ใช้ symbol/function ตามชื่อเมื่อไฟล์เปลี่ยน

| ID | หลักฐานจาก source ปัจจุบัน | ความหมาย |
| --- | --- | --- |
| F01 | [feature-entitlements.ts](../../packages/contracts/src/feature-entitlements.ts), manual row ประมาณ 92–96 | child เป็นเจ้าของ create/update ทั้งคู่ |
| F01 | [feature-gate.logic.ts](../../apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts), `featureKeyDeniedByEntitlement` | subfeature rule มาก่อน capability-pack rule จึงตัดสอง permission แม้ parent เปิด |
| F01 | [capability-pack.registry.ts](../../apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts), `pack.expense.self` | create/update มี parent `expenses` อยู่แล้ว ไม่ต้องเพิ่ม permission/pack |
| F02 | [expense.controller.ts](../../apps/api/src/modules/expenses/presentation/http/expense.controller.ts), `removeExpense` ประมาณ 240 | controller บังคับ update |
| F02 | [expenses.model.ts](../../apps/web/src/features/expenses/expenses.model.ts), `canDeleteExpense` ประมาณ 1497; [delete use case](../../apps/api/src/modules/expenses/application/use-cases/delete-expense.use-case.ts) | UI/use case รับ delete หรือ update-own; mismatch มีจริงแม้ไม่เปลี่ยน manual flag |
| F03 | [expense-document.use-case.ts](../../apps/api/src/modules/expenses/application/use-cases/expense-document.use-case.ts), `CaptureLineExpenseNoteUseCase` ประมาณ 195 | ส่ง key ที่มี `line-draft:` |
| F03 | [expense-draft.use-case.ts](../../apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts), `CreateExpenseDraftUseCase` ประมาณ 109; [validator](../../apps/api/src/modules/accounting-documents/domain/logic/accounting-money-validation.logic.ts), `PAYMENT_IDEMPOTENCY_KEY_PATTERN` | colon ไม่ผ่าน regex; การสร้างจริงถูก 400 ก่อนตรวจ permission/บันทึก |
| F04 | [resolver repository](../../apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts), `resolveForUser` | คืน entitledFeatureKeys แล้ว |
| F04 | [resolve-request-context](../../apps/api/src/modules/auth/application/use-cases/resolve-request-context.use-case.ts), [auth.controller.ts](../../apps/api/src/modules/auth/presentation/auth.controller.ts), `me`; [WebSession](../../apps/web/src/common/models/web-session.model.ts) | field ไม่ได้ forward ถึง web session |
| F05 | [workspace-scope.api.ts](../../apps/web/src/features/web-core-workspace/workspace-scope.api.ts), `accessContextFingerprint` | ไม่มี features ใน fingerprint |
| F05/F08 | [WorkspaceLayout.tsx](../../apps/web/src/features/web-core-workspace/WorkspaceLayout.tsx), `BusinessWorkspaceLayout` | focus/visibility/poll 60 วินาที → router.refresh เมื่อ fingerprint เปลี่ยน; ต้องออกแบบไม่ทิ้ง admitted form |
| F06 | [ExpensesPages.tsx](../../apps/web/src/features/expenses/ExpensesPages.tsx), `ExpensesHubPage`/`ExpenseListPage`; [nav logic](../../apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts) | manual entry ปัจจุบันดู create permission เป็นหลัก |
| F07 | [system-partners.logic.ts](../../apps/web/src/features/system-partners/system-partners.logic.ts), `applyPreset` | argument `_state` ถูกละทิ้ง; preset ตั้ง manual true ใหม่ |
| F09 | [expense-document.use-case.spec.ts](../../apps/api/src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts), `createDraft` fixture ประมาณ 37 | mock คืน record เลย ไม่ validate key ที่ caller ส่งมา |

ข้อแก้ไขคำอธิบาย audit ตอนต้น: “LINE ยังสร้างได้เมื่อ manual OFF” ยืนยันได้เฉพาะ permission gate ไม่ใช่การสร้างสำเร็จ เมื่อเชื่อม real use cases พบ F03 ทั้ง ON/OFF แล้ว รายงาน implementation ต้องไม่ใช้คำอธิบายเก่านั้นต่อ

## 3. Neighbor module inventory

| Module / file ที่ตรวจ | สิ่งที่พบ | ผลต่อ implementation |
| --- | --- | --- |
| Employee access resolver/helper/registry | Child inherits parent; explicit false; legacy null; parent pack owns update/create | แยก manual visibility โดยไม่เปลี่ยน business grants |
| System partner command/controller/UI | commandId, CAS, normalization, status locks, audit มีอยู่แล้ว | ใช้เดิม เพิ่ม copy และ preset preservation เท่านั้น |
| Billing `billing-feature-entitlements.ts` | `adminOverrideKeys` คืน stored choice เหนือ target package | ทดสอบ override; ไม่ทำ engine ใหม่ |
| Web shell/session/page route | server no-store; broad expense route check; inner manual tab checks create | เพิ่ม feature snapshot + dedicated gate ไม่ gate ทั้งโมดูล |
| Expense list/review/manual | list CTA create; owner edit/mark-ready ใช้ update; review แยก permission | ถอด visibility flag ออกจากทั้ง create/update |
| IncomeExpenseLedgerPage | manual CTA + empty-state; upload มี predicate ของตน | gate เฉพาะ manual action |
| User guide / AI suggestions | มี permission-filtered manual links | ต้องเพิ่ม visibility condition แม้ permissions คงเดิม |
| TransactionTaxLineSelector | sourceId `new-*` returnTo manual, existing id returnTo expense detail | new-page return ผ่าน gate; existing-record return ปกติ |
| SubstituteReceiptWizardPage | `canCreate` = expense.create; createExpenseDraft WEB_MANUAL | ห้ามใช้ manual visibility ปิด wizard; role/state requirements คงเดิม |
| Upload/OCR/capture policy | อัปโหลดใช้ upload permission; manual review เมื่อ OCR unavailable ยังจำเป็น | entry flag ไม่ใช่ OCR governance switch |
| Capture groups / handoff | create authority เป็น OR; handoff มี evidence/allocation/transaction locks ของตน | ไม่ gate shared repository; upload/handoff regression ต้องผ่าน |
| LINE text capture / webhook | permission OR upload/line_upload/create; draft creator คนเดียวกับ web | F03 แยกแก้; manual-entry OFF ไม่ใช่ capture refusal |
| LINE continuation / correction / draft update | corrections/preview/apply และ edit explanation ใช้ update | ต้องยังทำได้เมื่อ entry OFF ตาม authority เดิม |
| Reimbursement materialization | สร้าง expense projections เป็น API_INTERNAL ใน saga ของ claim | ไม่เติม gate ที่ global create repository |
| Ledger/tax/payment/numbering | downstream consume ordinary ExpenseRecord และ final states | ไม่มี source filtering/data migration จากการซ่อนหน้า |
| Reporting/export/notifications | อ่าน/ลิงก์ existing records ตามสิทธิ์เดิม | ไม่ซ่อน historical WEB_MANUAL records เมื่อ flag OFF |

ไฟล์รอบข้างที่ตรวจเฉพาะจุด:

- `apps/api/src/modules/expenses/application/use-cases/expense-capture-group.use-case.ts`
- `apps/api/src/modules/expenses/application/use-cases/expense-capture-handoff.use-case.ts`
- `apps/api/src/modules/reimbursements/application/services/materialize-claim-expenses.service.ts`
- `apps/api/src/modules/expenses/application/use-cases/line-draft-update.use-case.ts`
- `apps/api/src/modules/expenses/application/use-cases/line-correction.use-case.ts`
- `apps/api/src/modules/expenses/application/use-cases/line-expense-draft-conversation.use-case.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/api/src/modules/line-ai/application/use-cases/erp-core-detail-tools.use-case.ts`
- `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts`
- `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`

Inventory นี้เป็น code-path review ไม่ใช่คำรับรองว่าแต่ละ module ผ่าน browser/provider/PG test ใน audit นี้

## 4. Verification ที่รันแล้วในรอบ audit ก่อนเขียน spec

### 4.1 Existing test suites — 359 tests ผ่าน, 0 failed

API (`apps/api`) — 135 tests:

```sh
pnpm exec tsx --test src/modules/employee-access/domain/logic/feature-gate.logic.spec.ts src/modules/employee-access/application/entitlement.helper.spec.ts src/modules/system-partner-management/application/use-cases/set-partner-features.use-case.spec.ts src/modules/expenses/application/expense-launch-gate.spec.ts
```

Web (`apps/web`) — 203 tests:

```sh
pnpm exec tsx --test src/features/system-partners/system-partners.logic.spec.ts src/features/expenses/expenses.model.spec.ts src/features/web-core-workspace/web-core-workspace.spec.ts
```

LINE capture unit subset (`apps/api`) — 21 tests:

```sh
pnpm exec tsx --test --test-name-pattern=CaptureLineExpenseNoteUseCase src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts
```

ทั้งสามชุดใช้ baseline implementation; LINE subset ยัง mock ขั้นตอนที่มี F03 จึงผ่านแม้ composed flow มี bug ไม่ใช่การทดสอบโค้ดหลังแก้

### 4.2 In-memory diagnostic probes — 11 API + 8 web assertions

รันผ่าน `pnpm exec tsx -e` โดยไม่สร้าง source/test files ใช้ repositories/audit/outbox แบบ in-memory ไม่มี database/network writes

API observations:

1. ON→OFF ตัดเฉพาะ create/update จาก full registry; เปิดกลับคืนชุดเดิม (baseline OLD key เท่านั้น; v2 ต้อง invariant เมื่อ toggle NEW key)
2. Parent inheritance / explicit child OFF / parent OFF precedence ทำงาน
3. Actual HTTP guard ของ POST create ปฏิเสธ manual OFF ด้วย 403 + feature key (v2 คง old-key gate นี้; NEW key ต้องไม่กระทบ create permission)
4. Upload/reviewer path ยังผ่าน; staff mark-ready ถูกปฏิเสธหลัง OFF (ผลกระทบที่ต้องหายไป)
5. Delete permission อยู่ แต่ actual DELETE controller guard ปฏิเสธเมื่อไม่มี update — reproduce F02
6. Existing OCR draft: actual MarkExpenseReadyUseCase ผ่าน ON, ไม่ผ่าน OFF, ผ่านหลัง ON
7. Actual UpdateExpenseDraftUseCase ปฏิเสธ own OCR draft หลัง OFF
8. Real LINE note + real create use case คืน 400 key error ทั้ง ON และ OFF — reproduce F03
9. เปลี่ยน create step เป็น stub ยืนยันว่า LINE permission gate ผ่านและส่ง key prefix ที่ผิด
10. Internal draft creator รับ upload-equivalent permissions ได้; external POST guard เป็นอีกชั้น ห้ามสับสนสอง boundary
11. Read-only role ไม่ได้ create permission จากการเปิด flag

Web observations:

1. Expense feature catalog จาก compiled contracts ตรงกับ source
2. OFF เปลี่ยนเฉพาะ row manual; parent/upload/list คงเดิม
3. ON→OFF→ON คืน switch state เดิม ไม่มี sibling delta
4. Admin card แสดง manual OFF/upload ON ตรง state
5. Nav ซ่อน manual ตาม permission snapshot เดิม และยังแสดง list/upload
6. Generic workspace route ยอมเข้ากรอบ expense page แต่ inner manual tab ไม่ render form เมื่อ create permission หาย; จึงไม่ใช่ form bypass ใน baseline
7. UI ยังอนุญาต delete-only holder เห็นปุ่ม — เชื่อมกับ API observation 5 เป็น F02
8. Starter preset ตั้ง manual กลับ true — reproduce preset impact

**19 assertions นี้ยืนยันพฤติกรรมที่สังเกต รวมถึงยืนยันว่าบั๊กเกิดได้ ไม่ใช่ 19 acceptance cases ของ feature ที่แก้แล้ว**

### 4.3 Minimal reproduction recipes สำหรับ implementer

F02: สร้าง context ที่มี `expense.delete`, ไม่มี `expense.update` → `canDeleteExpense(DRAFT, actor, caps)` เป็น true → เรียก `DenyByDefaultGuard` กับ actual `ExpenseController.prototype.removeExpense` → 403 ส่วนแก้ต้องทำให้ controller ไปถึง use case แล้ว use case ยังตรวจ ownership/state/retention ตามจริง

F03: สร้าง `CaptureLineExpenseNoteUseCase` โดย inject actual `CreateExpenseDraftUseCase` (stub เฉพาะ persistence/audit/tax/launch boundary) → ข้อความ “ค่ากาแฟ 65 บาท”, hints amount=65, event id คงที่ → key `line-draft:...` → `400 Invalid draft idempotency key` ก่อน insert ใช้ case นี้เป็น red→green integration test

## 5. Evidence limitations และสิ่งที่ต้องทำหลังเริ่ม implement

- ไม่อ่าน/เปลี่ยน deployment, cloud environment, customer flag หรือ live records
- รอบ audit ดั้งเดิมยังไม่รัน browser/PG; รอบ simulation ถัดมารันแล้วตาม [E2E report](../qa/manual-expense-web-entry-flag-e2e-simulation-2026-10-01-th.md) แต่ยังไม่รัน actual LINE OA/provider
- ไม่ได้พิสูจน์ orphan legacy-key population ใน database; spec กำหนด compatibility investigation ก่อนตัดสินว่าไม่ต้องมี lookup
- ไม่มี code patch, schema change, package.json change หรือ release จากงานเอกสารนี้
- 359 + 19 เป็นผลจากรอบ audit ใน chat นี้; งานเขียนเอกสารไม่ได้ rerun application suites เพื่ออ้าง implementation readiness
- Next verification คือ new-key candidate ตาม spec v2 AC01–AC20; ต้องรันใหม่ ห้ามนับ old-key simulation แทน
