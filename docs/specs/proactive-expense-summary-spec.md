# Proactive Expense Summary Spec — สรุปรายจ่ายทาง LINE ทุกสัปดาห์ + เรื่องที่ควรดู + ทางเข้าหน้ารายจ่ายตามหมวด

Status: READY (docs-first) — reviewed 3 rounds 2026-10-24, no HIGH open; see Must close before coding (§16.1)
Owner: Expenses / Notifications lane
Related: `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md` (ข้อ 14), `docs/plans/proactive-expense-summary-plan.md`, `docs/agent-memory/proactive-expense-summary.md`, `docs/specs/mangmee-income-expense-ledger-spec-th.md`, `docs/agent-memory/sold-features-fixes-2026-10-04.md` (owner decision เรื่องตั้งค่าการแจ้งเตือน), `docs/guidelines/thai-ux-standard.md`
Baseline: main 6c54ba208 (2026-10-23) — worktree `claude/expense-specs-20261023` tree เดียวกัน (`7593ad1f…`)

---

## 1. ปัญหา (พฤติกรรมปัจจุบัน)

ร้านต้อง "เปิดมาดูเอง" ถึงจะรู้ว่าเงินไปไหน ระบบไม่เคยบอกก่อน

**สิ่งที่มีอยู่แล้ว (ใช้ต่อได้)**

- หน้าแรกเว็บ: ยอดรายจ่ายที่ยืนยันแล้วตามช่วง, ใบเสร็จรอตรวจ (ทุกช่วงเวลา), ค้างจ่าย (ทุกช่วงเวลา) — `apps/api/src/modules/dashboard-notifications/application/providers/expense-summary.provider.ts:65-118`; แท็บ วันนี้/สัปดาห์/เดือน/กำหนดเอง — `apps/web/src/features/dashboard-notifications/DashboardPages.tsx:30-35`, `:111-117`; กราฟรายเดือน — `DashboardPages.tsx:322` → `ExpenseMonthsCard.tsx:29-119`
- หน้า `/income-expense-ledger` มีกราฟ "ยอดตามหมวด" ฝั่งรายจ่าย (`apps/web/src/features/accounting-documents/IncomeExpenseLedgerPage.tsx:509-530`) เปิดได้ด้วย `expense.read` (`apps/web/src/features/web-core-workspace/route-permissions.ts:75`, API `income-expense-ledger.controller.ts:9,32-37`) **แต่ไม่มีลิงก์ใดในเว็บชี้ไปหน้านี้** — grep `income-expense-ledger` ใน `apps/web/src` + `apps/web/app` พบแค่ route file, route rule, api client และตัวหน้าเอง; เมนูย่อยของ "ค่าใช้จ่ายและใบเสร็จ" สร้างที่ `web-core-workspace.logic.ts:285-354` ไม่มีรายการนี้
- ขอบเขตสาขาของหน้านั้นใช้ `branchScopeWhere` = สาขาที่มีสิทธิ์ **รวมรายการส่วนกลาง (`branchId=null`)** (`data-model-core/domain/logic/branch.logic.ts:80-83`, ใช้ที่ `income-expense-ledger.use-case.ts:109`) ส่วน provider หน้าแรกเมื่อส่ง `branchIds` ใช้ exact match ไม่รวมส่วนกลาง (`expense-summary.provider.ts:51-53`) — สองหน้านี้นับต่างกันสำหรับผู้ใช้ที่จำกัดสาขา
- LINE: `expense.get_breakdown` แยกตามหมวด สาขา ผู้ขาย (`apps/api/src/modules/line-ai/application/use-cases/erp-business-tools.use-case.ts:349-470`) — ต้องพิมพ์ถามเอง และนับทุกสถานะยกเว้นปฏิเสธ/ยกเลิก (`:446` `statusBasis: 'exclude_rejected_voided'`) ไม่ใช่ฐาน "ยืนยันแล้ว"
- ระบบเตือนผู้จ่ายเมื่อใบเบิกรอจ่ายเกินกำหนด (`workflow-template-catalog.ts:278-300`, auto-enable) — **แต่ทำงานเฉพาะร้านที่ตั้ง `slaHours`** (`workflow-scan-candidates.use-case.ts:194-203`) และค่าตั้งต้นไม่มี `slaHours` (`reimbursements/domain/reimbursement.constants.ts:48-61`); นิยาม "รอจ่ายตั้งแต่เมื่อไร" อยู่ที่ `workflow-scan-candidates.use-case.ts:216-220` (ล่าสุดของ financeReviewedAt/approvedAt ไม่มีก็ submittedAt; ถ้ามีการยกเลิกการจ่ายที่ใหม่กว่า ใช้วันยกเลิก)
- ระบบจับใบเสร็จที่อาจซ้ำอยู่แล้ว: `DuplicateStatus.POSSIBLE_DUPLICATE` (`apps/api/prisma/schema.prisma:2383-2389`), list API กรอง `duplicateStatus` ได้ (`expense.controller.ts:194,213`, `prisma-expense.repository.ts:1271`) แต่หน้า list เว็บไม่มี view นี้ (`ExpensesPages.tsx:2691-2692` รับแค่ `pending|unpaid|addressMissing|confirmed`)

**งานสรุปเจ้าของร้าน 07:00 ที่มีอยู่ ใช้ไม่ได้จริง**

- cron 07:00 Asia/Bangkok (`apps/workers/src/modules/notifications/notification-jobs.ts:59`, ตั้งงานที่ `notification-worker.ts:63-74`) → sweep อ่านเฉพาะ `NotificationRule` ที่ `triggerKey='daily_owner_summary'` และ ENABLED (`notification-sweeps.use-cases.ts:114-121`)
- **แต่มีทางสร้างโดยไม่ดู rule**: internal route `POST /internal/companies/:companyId/notifications/daily-owner-summary` เรียก use case ตรง (`internal.controller.ts:128-139`) และ `daily_owner_summary` ยังอยู่ใน `IMPLEMENTED_TRIGGER_KEYS` (`notification.model.ts:136`) จึงเปิด rule กลับได้ (`notification.use-cases.ts:146-148`)
- rule ถูกสร้าง **โดย `seed.ts` เท่านั้น** (`apps/api/prisma/seed.ts:2795-2806`); grep `notificationRule.create|upsert|createMany` ทั้ง `apps/api/src` ไม่พบ และไม่มี migration ใดสร้าง (ยังยืนยันไม่ได้ว่า DB Production เคยรัน seed หรือไม่ — ไม่ได้แตะ cloud)
- ส่งให้ **ทุก OWNER และ ADMIN ตามบทบาท** (`notification.use-cases.ts:305-312`) — ขัดกฎเจ้าของ "แจ้งเฉพาะคนที่เกี่ยวข้อง"
- ข้อความคือ `แดชบอร์ดอัปเดตแล้ว ${snapshot.widgets.length} วิดเจ็ต` (`notification.use-cases.ts:322`) — ดู §13 B1

**ช่องทาง สิทธิ์ และกลไกแจ้งเตือนที่เกี่ยว**

- การแจ้งเตือนพนักงานส่งผ่าน OA ระบบของมั่งมีตัวเดียว (`notification.use-cases.ts:382-391`) ซึ่งตั้งแต่ 2026-10-12 คือ `@695ultfm` (premium `@mangmeeplus`) — `docs/runbooks/cloud-environment-operations.md:623-633`
- ร้านแพ็กที่ขาย (preset `starter`, `packages/contracts/src/menu-entitlements.ts:432-450,496-501`) ได้ `dashboard_notifications` แต่ **ไม่ได้** `dashboard_notifications.preferences` / `.rules` (`feature-entitlements.ts:434-449`; onboarding เขียน `enabled:false` — `create-company-onboarding.use-case.ts:584-592`; gate ตัด permission — `feature-gate.logic.ts:126-131`) ตาม owner decision 2026-10-04 (`docs/agent-memory/sold-features-fixes-2026-10-04.md:180-182`)
- ตอนส่ง LINE ระบบตรวจแค่ membership ACTIVE + entitlement + สถานะ event (`notification.use-cases.ts:349-351,506-530`) — **ไม่ตรวจสิทธิ์อ่านข้อมูลหรือขอบเขตสาขาของผู้รับอีก**
- `resolveEarlier` (ที่ `supersedeEarlier` ใช้) จับ "เรื่องเดียวกัน" ด้วย `deepLinkHref` ก่อน ถ้ามี (`infrastructure/prisma-notification.repository.ts:188-201`) — ถ้าทุกคนได้ลิงก์เดียวกัน event ของคนหนึ่งจะปิด event ของอีกคน
- `CreateOrUpdateNotificationEventUseCase.execute` หา event ด้วย `findByDedupKey` แล้วค่อยสร้าง (`notification.use-cases.ts:248-258`) และ `dedupKey` มีแค่ index ไม่ unique (`schema.prisma:1570`) — เรียกซ้อนกันสร้างซ้ำได้; มี `executeInTransaction` ที่ล็อก advisory ต่อ dedupKey อยู่แล้ว (`notification.use-cases.ts:203-212`)
- ไม่มีงานลบ notification อัตโนมัติ (grep `notificationEvent.deleteMany` พบแค่สคริปต์ smoke) — ข้อมูลอยู่จนบริษัทถูกลบ (cascade)
- การรวมบัญชี (account merge) ย้าย `CompanyMembership.userId` ไปบัญชีที่เหลือ (`auth/application/use-cases/account-merge.use-case.ts:205-219`) — ตารางที่เก็บ `userId` ตรง ๆ จะค้างกับบัญชีที่ถูกปิด รวมทั้ง `NotificationRecipient.userId` (`schema.prisma:1577`): notice ที่ยังรอส่งของ membership ที่ย้ายจะถูกระงับ เพราะผู้รับเดิมไม่มี membership แล้ว (`notification.use-cases.ts:506-514`)
- ผู้แก้สิทธิ์/บทบาท/สาขา/สถานะสมาชิกล็อกแถว `Company` แบบ `FOR UPDATE` ก่อน (`update-role.use-case.ts:71` → `lockPlanTermCompany`, `system-partner-management/application/lock-plan-term-company.ts:4-6`; ผู้เรียกตัวอื่นเช่น `update-employee`, `set-employee-status`, `create-role`) แล้วจึงลบ/เขียน `rolePermission` (`update-role.use-case.ts:137-138`); ผู้แก้ entitlement ล็อก advisory exclusive (`set-partner-features.use-case.ts:253`) ส่วนการส่ง LINE ถือ advisory shared (`notification.use-cases.ts:498`) และล็อกแค่แถว membership (`:506-513`) — วันนี้ไม่มีอะไรกันการถอดสิทธิ์ที่ commit ระหว่างอ่านสิทธิ์กับยิง LINE
- สกุลเงิน: `ExpenseRecord.currency` ค่าตั้งต้น THB (`expense-draft.use-case.ts:166`), ไม่มีคอลัมน์อัตราแลกเปลี่ยน; หน้าแรก (`expense-summary.provider.ts:27-34,65-81`) และ ledger (`income-expense-ledger.use-case.ts:151-165`) รวมยอดข้ามสกุลเงิน (§13 B8, B9); ระบบรู้จักรายจ่ายที่ไม่ใช่บาท (`SubstituteReceiptWizardPage.tsx:214` "ค่าใช้จ่ายนี้ไม่ใช่เงินบาท")
- ร้านที่แพ็กหมดอายุ (`DISABLED` + `termDisabledAt`) ถูกปฏิเสธทุก route ด้วย `company_term_expired` (`access-control/infrastructure/prisma-permission-resolver.repository.ts:62-73`) ยกเว้น route กู้คืน (`auth/presentation/auth.guard.ts:57-72,245`)
- หัก ณ ที่จ่ายไม่ได้แปลว่า ภ.ง.ด.3/53 เสมอ: ระบบจัดแบบจากประเภทผู้รับ (ไม่รู้ = ไม่จัด + review issue) และหมวดเงินได้ (`SEPARATE_PND2` → ภ.ง.ด.2) — `tax/application/use-cases/sync-tax-events.use-case.ts:60-77`; "ยื่นแล้ว" ดูทีละรายการจ่ายเทียบบรรทัดในแบบที่ยื่น (`tax/application/services/withholding-filing-state.ts:60-76`) ไม่ใช่สถานะงวด (`TaxPeriod` unique ต่อแบบ+งวด `schema.prisma:5666`)
- `ACCOUNTING_UI_HIDDEN` ปิดเฉพาะโมดูล `journal`/`closing` (`web-core-workspace.constants.ts:14-17`, `web-core-workspace.logic.ts:164`); `/income-expense-ledger` ไม่มีโมดูล ใช้ route rule (`route-permissions.ts:75`) จึงไม่ถูกซ่อน

## 2. เป้าหมาย

1. คนที่ขอรับ (opt-in) ได้การ์ด LINE วันจันทร์ 08:00 สรุปรายจ่ายสัปดาห์ที่แล้วเป็นคำธรรมดาและจำนวนเงิน — ไม่มีเปอร์เซ็นต์ อันดับ หรือ "กี่เท่า" — เฉพาะสัปดาห์ที่มีเรื่องให้สรุป
2. การ์ดเดียวกันบอก "เรื่องที่ควรดู" จากกติกาตายตัว 4 ข้อ และวันยื่น ภ.ง.ด.3/53 / ภ.พ.30 เมื่อเป็นจริงกับร้านนั้น
3. **ไม่เรียก AI เลย** (0 model call); ไม่เกิน 1 ข้อความ LINE ต่อ **membership ที่สมัคร** ต่อสัปดาห์ (คนเดียวสมัครสองร้าน = 2 ข้อความ)
4. ข้อมูลการเงินในการ์ดถึงเฉพาะคนที่ **ตอนส่ง** ยังสมัครอยู่ ยังมี `expense.read` และขอบเขตสาขาเดิม
5. เมนู "รายจ่ายตามหมวด" เปิดกราฟหมวดที่มีอยู่แล้ว โดยร้านที่ไม่มีฝั่งรายรับไม่เห็นการ์ดรายรับที่ว่างเปล่า
6. เลิกสรุปรายวันแบบเดิมจริง (ทุกทางที่สร้างได้)

## 3. Non-goals

- ไม่ทำพยากรณ์ ไม่ทำเตือนทันทีรายรายการ (รอ §17 Q3)
- ไม่ให้ร้านปรับเกณฑ์เอง รุ่นแรกใช้ค่าคงที่
- ไม่เปิดหน้าตั้งค่าการแจ้งเตือน/กฎให้แพ็กที่ขาย (คง owner decision 2026-10-04)
- ไม่แก้ quiet hours ของระบบกลาง (§13 B3 แยกงาน)
- ไม่ส่งผ่าน OA ของร้าน (`line_oa`) และไม่ใช้ AI Gateway; ไม่เพิ่ม LINE AI tool; ไม่แก้คำตอบวิธีใช้ที่อนุมัติแล้วในรอบนี้
- ไม่ทำนโยบายเก็บ/ลบ notification ทั้งระบบ — สเปกนี้ลบเฉพาะสรุปรายสัปดาห์ของตัวเอง (§5.6)

## 4. ผู้ใช้และ journey

| ผู้ใช้ | เว็บ | LINE |
|---|---|---|
| เจ้าของร้าน / คนที่มี `expense.read` ไม่จำกัดสาขา | "บัญชีของฉัน" → การ์ด "สรุปรายจ่ายทาง LINE" → "เริ่มรับสรุป"; เมนู ค่าใช้จ่ายและใบเสร็จ → "รายจ่ายตามหมวด" | จันทร์ 08:00 ได้การ์ด (ถ้ามีเรื่อง) กดปุ่มเปิดเว็บ (URI ไม่ผ่าน AI) |
| มี `expense.read` แต่จำกัดสาขา | เหมือนบน | ตัวเลข = สาขาของตน + รายการส่วนกลาง (ฐานเดียวกับหน้ารายจ่ายตามหมวด); ไม่มีแถวภาษี |
| ผู้จ่ายใบเบิก (`reimbursement.payment.record`) ที่สมัคร | — | มีแถว "ใบเบิกรอจ่ายเกิน 7 วัน" |
| มีแค่ `expense.read_own` / `read_related` | ไม่เห็นการ์ดสมัคร | ไม่ได้รับ |
| ถูกลดสิทธิ์ / ถูกจำกัดสาขาเพิ่ม / ออกจากร้าน หลังสร้างการ์ดแต่ก่อนส่ง | กระดิ่งซ่อนสรุปที่ไม่ตรงสิทธิ์ปัจจุบัน; การ์ดบัญชีบอกสถานะ + "หยุดรับสรุป" กดได้ | push ที่ค้างถูกระงับก่อนส่ง (§8) |
| กด "หยุดรับสรุป" ขณะมีการ์ดรอส่ง | — | การ์ดที่รอส่งถูกระงับ |
| ยังไม่เชื่อม LINE | การ์ดบอกว่าสรุปจะอยู่ที่กระดิ่ง | — |
| รวมบัญชี (account merge) | subscription ย้ายตาม membership (§6) | ส่งถึงบัญชีที่เหลือ |

ไม่มี journey ที่ระบบสมัครให้เองหรือส่งให้เจ้าของร้าน "โดยตำแหน่ง"

## 5. กติกา / ข้อยกเว้น

### 5.1 ช่วงเวลา ฐานตัวเลข และขอบเขต

- สัปดาห์ = จันทร์ 00:00 – อาทิตย์ 23:59 Asia/Bangkok; `weekStart` = วันจันทร์ (civil date); ตรวจและส่งจันทร์ถัดไป 08:00 (cron `{ pattern: '0 8 * * 1', tz: 'Asia/Bangkok' }`)
- "เดือนภาษี" ของการ์ด = เดือนปฏิทินก่อนเดือนของวันส่ง (การ์ด 2 พ.ย. → ต.ค.)
- ฐาน: `ExpenseRecord.status='CONFIRMED'`, ตาม `expenseDate` (civil), ยอด `grandTotalAmount`; หมวดใช้ `ExpenseLine.expenseCategoryId` ผลรวม `lineTotalAmount` แบบเดียวกับ `income-expense-ledger.use-case.ts:161-165`
- **ขอบเขตสาขา: `branchScopeWhere(access.scopes)`** (`branch.logic.ts:80-83`) — ผู้ใช้ไม่จำกัดสาขา = ทั้งร้าน; ผู้ใช้จำกัดสาขา = สาขาของตน + รายการส่วนกลาง เหมือนหน้า "รายจ่ายตามหมวด" ที่ปุ่มเปิด (ตัวอย่าง: สาขา 100 + ส่วนกลาง 200 → การ์ดและหน้าเดียวกันบอก 300) — ต่างจากหน้าแรกเมื่อเลือกสาขาเดียว (exact match) ซึ่งเป็นการเลือกมุมมอง ไม่ใช่ขอบเขตสิทธิ์; ระบุใน sub ของการ์ด (§10.5)
- "ใบเสร็จรอตรวจ" ใช้สถานะ `EXPENSE_PENDING_STATUSES` และเงื่อนไขเดียวกับ `expense-summary.provider.ts:75-77`; "ค้างจ่าย" ตาม `:78-81` — ทั้งสองค่า ณ เวลาสร้างการ์ด ภายใต้ขอบเขตข้างบน
- การ์ดไม่ได้อ้างว่าตัวเลขตรงกับหน้าใด (หน้าเปิดเป็นรายเดือน การ์ดเป็นรายสัปดาห์) — อ้างแค่ว่า **ฐานเดียวกัน** (สถานะ วันที่ ขอบเขต หมวดระดับบรรทัด)
- เงิน 2 ตำแหน่งพร้อมคั่นหลักพัน + "บาท" ตาม `DashboardPages.tsx:91`
- **สกุลเงิน: ทุกยอดเงินนับเฉพาะ `upper(currency) = 'THB'`** — รวม, เทียบสัปดาห์, หมวด, ค้างจ่าย, A1, A2 (เกณฑ์เป็นบาท) — เพราะไม่มีอัตราแลกเปลี่ยนให้แปลง; ถ้ามีรายการไม่ใช่บาทที่จะเข้ากลุ่มของแถวเงินใด ๆ ให้เพิ่มแถว `สกุลเงินอื่น (ไม่รวมด้านบน)` → `{N} ใบ` (นับใบ ไม่บวกเงิน); แถวนับใบ (รอตรวจ, อาจซ้ำ, ใบเบิก) ไม่กรองสกุล; หน้า "รายจ่ายตามหมวด" ต้องแก้ให้ใช้กติกาเดียวกัน (B8, plan 1.2) ส่วนหน้าแรก (B9) อยู่ใน §16.1

### 5.2 กติกา "เรื่องที่ควรดู" (ค่าคงที่ใน `expense-weekly-summary.logic.ts`)

| สัญญาณ | เงื่อนไขขึ้นแถว | ข้อมูลที่ใช้ |
|---|---|---|
| A1 ยอดสูงกว่าปกติ | ประวัติ N สัปดาห์ก่อน `weekStart` โดย N = จำนวนสัปดาห์หลังรายจ่ายยืนยันแรกของร้าน จำกัด 4 ≤ N ≤ 8 (N < 4 ไม่ประเมิน); `mean` = ผลรวม N สัปดาห์ ÷ N (สัปดาห์ที่เป็น 0 นับด้วย); ขึ้นเมื่อ `ยอดสัปดาห์นี้ − mean ≥ 3,000.00` **และ** `ยอดสัปดาห์นี้ ≥ 2 × mean`; ค่าที่แสดง = `ยอดสัปดาห์นี้ − mean` ปัด 2 ตำแหน่ง | `$queryRaw` group by `date_trunc('week', "expenseDate")` 9 สัปดาห์ |
| A2 ผู้ขายใหม่ยอดสูง | ตัวตนผู้ขาย = เซตกุญแจ {`cp:<vendorCounterpartyId>` ถ้ามี, `tax:<เลข 13 หลักที่ตัดอักขระอื่นออก>` จาก `vendorTaxIdSnapshot` หรือ `AccountingCounterparty.taxId` ของ counterparty ที่ผูก}; รายการที่ไม่มีกุญแจเลย **ไม่นับ**; รวมยอดยืนยันในสัปดาห์ต่อผู้ขาย (รวมกลุ่มเมื่อกุญแจซ้อนกัน) ≥ 3,000.00 (ยอดในสัปดาห์คิด **ในขอบเขตของผู้รับ** `branchScopeWhere`) และ **ไม่มี** รายจ่ายยืนยันใดของร้าน (ทั้งร้าน ทุกสาขา — query ประวัตินี้ **ไม่ใช้** `branchScopeWhere`) ก่อน `weekStart` ที่มีกุญแจตัวใดตัวหนึ่งตรงกัน; ร้านต้องมีประวัติ ≥ 4 สัปดาห์ — ครอบคลุมทั้งกรณีของเก่ามีแค่เลขภาษีแล้วของใหม่ถูกผูก counterparty (`expense-draft.use-case.ts:1025`) และกลับกัน | `NOT EXISTS` ด้วยกุญแจทั้งสองแบบ |
| A3 อาจซ้ำ | `duplicateStatus='POSSIBLE_DUPLICATE'` และ `status NOT IN ('REJECTED','VOIDED')` ในขอบเขต (ณ เวลาสร้าง) > 0 | ตัวจับซ้ำเดิม |
| A4 ใบเบิกรอจ่ายนาน | เฉพาะผู้รับที่มี `reimbursement.payment.record`; `status IN ('READY_FOR_PAYMENT','PARTIALLY_PAID')`, `cancellationPendingAt IS NULL`, `claimPaymentDuplicateBlock(r, policy) !== 'CONFIRMED'` (`reimbursement.logic.ts:812`), และ `payableSince < now − 7 วัน` (เข้มงวด: ครบ 7 วันพอดียังไม่ "เกิน") โดย `payableSince` คำนวณด้วย **ฟังก์ชันเดียวกับ scan** (ย้ายตรรกะ `workflow-scan-candidates.use-case.ts:216-220` เป็น pure `claimPayableSince(request, lastVoidAt)` ใน `reimbursement.logic.ts`; void ล่าสุดจากคำสั่งแบบ `prisma-workflow.repository.ts:211-220`) — ใบที่เพิ่งถูกยกเลิกการจ่ายวันนี้จะไม่ขึ้นทันที; ขอบเขต `branchScopeWhere` | ไม่พึ่ง `slaHours` |

แสดงหมวดสูงสุด 3 แถว และผู้ขายใหม่สูงสุด 2 แถว (ที่เหลือ: `ผู้ขายใหม่อีก` → `N ราย`) เรียงตามยอดจากมากไปน้อย **ไม่มีเลขลำดับ ไม่มีคำว่า "อันดับ"**

### 5.3 วันยื่นภาษี

| แบบ | ขึ้นแถวเมื่อ (เดือนภาษี M) | ตามกฎหมาย | ทางอินเทอร์เน็ต |
|---|---|---|---|
| ภ.ง.ด.3 และ ภ.ง.ด.53 (แถวแยกต่อแบบ) | อ่านรายการจ่ายด้วย adapter เดียวกับหน้า ภ.ง.ด. — `ExpenseSourceAdapter.findConfirmedWithWhtByCompany` (`tax/infrastructure/adapters/expense-source.adapter.ts:70-135`: รายจ่าย `CONFIRMED` `whtAmount > 0`, เฉพาะรายการจ่าย `paidAtConfirmed` `:111` (`schema.prisma:2910`), วันจ่ายเป็นวันของงวด `:119`, ประเภทผู้รับเติมจากคู่ค้า `:84-89`) กรองวันจ่ายในเดือน M → จัดแบบด้วย pure `withholdingFormType(kind, category)` ที่ย้ายออกจาก `sync-tax-events.use-case.ts:60-77` (ไม่รู้ประเภทผู้รับ = ไม่นับ; `SEPARATE_PND2` = ภ.ง.ด.2 ไม่ขึ้นแถว) → แปลงแถวเป็นรูปที่ helper รับ (`sourceType: 'expense.record'`, `sourceId: row.id`, `sourceLineKey: row.sourceLineKey` — `source-reader.port.ts:74`, `withholding-filing-state.ts:73`) → ตัดรายการที่อยู่ในแบบที่ยื่นแล้วด้วย `withholdingPaperPayments(mapped, WhtFiling FILED + lines ของแบบนั้น งวด M)` → **ถ้าความครอบคลุมไม่แน่นอน ไม่ขึ้นแถวของแบบนั้น** (ไม่อ้างทั้ง "ยื่นแล้ว" และ "ยังไม่ยื่น"): มี FILED paper ที่ `rowsCertain = false` (แบบเก่าที่ไม่มีบรรทัดแช่แข็ง — ตรงกับเงื่อนไขที่หน้า ภ.ง.ด. แสดง `rowsUncertainNotice` `generate-wht-report.use-case.ts:197`) หรือมีบรรทัดที่ไม่มี payment key ซึ่งครอบคลุมทั้งเอกสาร (`withholding-filing-state.ts:63` `!key`) สำหรับเอกสารที่มีรายการจ่ายในเดือน M (`withholding-filing-state.ts:73-76`) → ขึ้นแถวของแบบที่ยังเหลือ ≥ 1 รายการ | ภายในวันที่ 7 ของเดือนถัดไป | +8 วัน (วันที่ 15) |
| ภ.พ.30 | มี VAT fact ที่ยังไม่ถูกแทน (`supersededAt IS NULL`) สถานะ `REGISTERED` ที่ **ช่วงมีผลทับเดือน M** (`effectiveFrom ≤ วันสุดท้ายของ M` และ `effectiveTo IS NULL OR effectiveTo > วันแรกของ M`) — ภาระเริ่มตามวันที่ในใบทะเบียน ไม่ใช่สถานะวันส่ง: ร้านที่จดมีผล 1 พ.ย. ไม่ได้แถว ภ.พ.30 เดือน ต.ค. (ประมวลรัษฎากร ม.85/… https://www.rd.go.th/5208.html "นับแต่วันที่ระบุไว้ในใบทะเบียนภาษีมูลค่าเพิ่ม"); อ่าน fact แบบ `company-vat-registration.use-case.ts:219-232` และใช้กติกา "live fact" เดียวกับ `effectiveVatStatus` (`company-vat-registration.logic.ts:81-97`) | ภายในวันที่ 15 ของเดือนถัดไป | +8 วัน (วันที่ 23) |

- แหล่ง: ปฏิทินภาษีกรมสรรพากร (ต.ค. 2569: ภ.ง.ด. 7/15, ภ.พ.30 15/26 — 26 น่าจะเพราะ 23 ต.ค. วันปิยมหาราชตรงวันศุกร์ต่อเสาร์–อาทิตย์; อนุมาน) https://www.rd.go.th/62348.html ; หน้าแนะนำยื่นผ่านอินเทอร์เน็ต (วันสุดท้ายตรงวันหยุดยื่นวันทำการถัดไป) https://www.rd.go.th/39808.html ; ประกาศกระทรวงการคลัง เรื่อง การขยายกำหนดเวลาการยื่นแบบฯ ผ่านระบบเครือข่ายอินเทอร์เน็ต (ฉบับที่ 8) ลงวันที่ 1 มี.ค. 2567 ขยาย 8 วันสำหรับแบบที่ต้องยื่นระหว่าง 1 ก.พ. 2567 – 31 ม.ค. 2570 (ข้อความที่เผยแพร่ซ้ำ https://www.ryt9.com/s/rdn/3502705 ; คู่มือกรมสรรพากรอ้างฉบับที่ 8 https://www.rd.go.th/fileadmin/user_upload/lorkhor/newspr/2025/vat_refund.pdf — **ยังไม่ได้เปิดตัวประกาศบน rd.go.th โดยตรง**)
- **ภ.พ.30 ยื่นแยกรายสถานประกอบการ** เว้นแต่ได้รับอนุมัติให้ยื่นรวม (ประมวลรัษฎากร ม.83 https://www.rd.go.th/5207.html "ให้แยกยื่นและชำระเป็นรายสถานประกอบการ") — แถวนี้บอกแค่ **วันยื่น** ซึ่งเท่ากันทุกสถานประกอบการ ไม่บอกว่ายื่นที่ไหนกี่ฉบับ
- **ข้อจำกัดของผลิตภัณฑ์**: แถวภาษีแสดงเฉพาะผู้รับที่ไม่จำกัดสาขา เพราะระบบไม่รู้ว่าใครรับผิดชอบยื่นของสถานประกอบการใด — ไม่ได้อ้างว่าการยื่นเป็นระดับบริษัท
- คำในการ์ดใช้ "ภายใน" + วันฐาน (7/15/23) ไม่เลื่อนตามวันหยุด → ยื่นถึงวันนั้นตรงเวลาเสมอ
- ค่าคงที่ `RD_EFILING_8_DAY_EXTENSION_LAST_STATUTORY_DUE = '2027-01-31'`: วันครบกำหนดตามกฎหมายเลยวันนี้ → แสดงวันตามกฎหมายอย่างเดียว จนกว่าจะอัปเดตค่าคงที่
- แถวขึ้นเฉพาะการ์ดที่ส่ง **ไม่เกิน** วันยื่นทางเน็ตของงวด; หลังนั้นไม่มีแถว
- ไม่ใช้สถานะ `TaxPeriod` ตัดสินว่ายื่นแล้ว: แบบหนึ่งยื่นแล้วไม่ได้แปลว่าอีกแบบยื่นแล้ว และรายการจ่ายที่มาทีหลังอาจไม่อยู่ในแบบที่ยื่น — ใช้ความครอบคลุมรายรายการข้างบนเท่านั้น

### 5.4 สัปดาห์เงียบ

ไม่สร้าง event เลยเมื่อ: ยอดยืนยัน (บาท) สัปดาห์นั้น = 0 **และ** ไม่มีรายจ่ายยืนยันสกุลอื่นในสัปดาห์นั้น **และ** รอตรวจ = 0 **และ** ไม่มีแถว A1–A4 **และ** ไม่มีแถวภาษี — ค้างจ่ายเก่าอย่างเดียวไม่ทำให้ส่ง; สัปดาห์ที่มีแต่รายจ่าย USD ยืนยันแล้ว **ไม่เงียบ** → การ์ดมี `รายจ่ายยืนยันแล้ว` `0.00 บาท` + `สกุลเงินอื่น (ไม่รวมด้านบน)` `{N} ใบ`

### 5.5 ต้นทุน

- AI: 0 call — SQL ใน API ล้วน; ไม่ผ่าน `line-ai-budget-authority`; ไม่มีอะไรคิดเงินลูกค้า
- LINE: push นับโควตา reply ไม่นับ นับตามผู้รับ (https://developers.line.biz/en/docs/messaging-api/pricing/) → **สูงสุด 5 ข้อความ/membership ที่สมัคร/เดือน** ในเดือนที่มีวันจันทร์ 5 วัน (เฉลี่ยทั้งปีราว 4.35); คนเดียวที่สมัครหลายร้านได้ตามจำนวนร้าน (2 ร้าน = สูงสุด 10) — ต้องตั้งงบตามเดือนสูงสุด และนับรวมกับการแจ้งเตือนอื่นที่ใช้ OA เดียวกัน
- ราคา LINE OA ไทย (ไม่รวม VAT 7%): Free 300 ข้อความ/เดือน ซื้อเพิ่มไม่ได้; Basic 1,280 บาท 15,000 ข้อความ เกินข้อความละ 0.10 บาท; Pro 1,780 บาท 35,000 ข้อความ เกิน 0.06 บาท — https://lineforbusiness.com/th/service/line-oa-features ; Free ลดจาก 500 เป็น 300 ตั้งแต่ 1 ส.ค. 2567 — https://lineforbusiness.com/th/news/20240619_1
- ผู้จ่ายคือ OA ระบบของมั่งมี (`@695ultfm`) ไม่ใช่ร้าน; โควตาใช้ร่วมกับการแจ้งเตือนพนักงานทั้งหมด (`docs/runbooks/b1-b2-line-external-setup.md:106`); **แพ็กเกจปัจจุบันของ OA ไม่อยู่ใน git** (§17 Q5)
- ตัวอย่าง: 300 membership ที่สมัคร → สูงสุด 1,500 ข้อความในเดือนที่มีจันทร์ 5 วัน (เกิน Free เต็มตัว; Basic เหลือ ~13,500 ให้แจ้งเตือนอื่น)

### 5.6 การเก็บข้อมูลของสรุป

- ไม่มีงานลบ notification ของระบบให้พึ่ง (§1) → sweep รายสัปดาห์มีขั้น purge **แยกจาก loop subscriber และทำเสมอ**: ลบ `NotificationEvent` ที่ `triggerKey='expense.weekly_summary'` และ `createdAt < now − 13 เดือน` **ของทุกบริษัท ไม่ว่าบริษัทนั้นยังมีผู้สมัคร หรือยัง ACTIVE หรือไม่** (ทีละ batch ≤ 1,000 แถวจนหมด) — recipient/delivery ลบตาม cascade (`schema.prisma:1587,1610`); ทำแม้ loop ส่งมี failure — 13 เดือนพอเทียบปีต่อปี; เปลี่ยนได้ด้วยค่าคงที่ `WEEKLY_SUMMARY_RETENTION_MONTHS`
- เก็บชื่อผู้ขายเฉพาะแถว A2 (≤ 2 ชื่อ) ไม่เก็บเลขผู้เสียภาษีในการ์ด

## 6. Data model (additive)

```prisma
/// สมัครรับสรุปรายจ่ายรายสัปดาห์: มีแถว = รับอยู่, ลบแถว = หยุดรับ (audit เก็บประวัติ)
/// ผูกกับ membership ไม่ใช่ userId: การรวมบัญชีย้าย membership (account-merge.use-case.ts:219)
/// แถวนี้จึงตามไปเองโดยไม่ต้องเขียนเพิ่ม; ไม่ใช้ NotificationPreference เพราะการสร้างแถวนั้น
/// ครั้งแรกแช่แข็งรายการ trigger (notification.use-cases.ts:366-372)
model ExpenseWeeklySummarySubscription {
  id           String            @id @default(cuid())
  companyId    String
  membershipId String            @unique
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt
  company      Company           @relation(fields: [companyId], references: [id], onDelete: Cascade)
  membership   CompanyMembership @relation(fields: [membershipId], references: [id], onDelete: Cascade)

  @@index([companyId])
}
```

- back-relation บน `Company` และ `CompanyMembership`
- กรณีรวมบัญชีแบบ `close_duplicate` (membership ซ้ำถูกปิด ไม่ย้าย — `account-merge.use-case.ts:206-213`): ใน transaction เดียวกัน ถ้า membership ที่ถูกปิดมี subscription และ membership ที่เหลือยังไม่มี → ย้าย `membershipId`; ถ้ามีแล้วทั้งคู่ → ลบแถวของ membership ที่ถูกปิด (ความหมายเท่ากัน "รับอยู่"; เป็นคนเดียวกันที่รวมบัญชีเอง)
- **notice สรุปที่ยังรอส่ง** ของ membership ที่ย้าย: ใน transaction รวมบัญชีเดียวกัน ย้าย `NotificationRecipient.userId` → บัญชีที่เหลือ สำหรับ event `triggerKey='expense.weekly_summary'` ที่ `sourceId IN movedMembershipIds` (event ละผู้รับเดียว ไม่ชน `@@unique([eventId, userId])` `schema.prisma:1590`); delivery ผูก recipient จึงตามไปเอง — ถ้าไม่ย้าย ด่านส่งจะระงับ (ผู้รับเดิมไม่มี membership) และ `onlyIfAbsent` กันการสร้างใหม่ในสัปดาห์นั้น; notice ชนิดอื่นไม่อยู่ในขอบเขต (G9)
- **membership ซ้ำที่ถูกปิด (`close_duplicate`, `account-merge.use-case.ts:206-213`)**: ใน tx เดียวกัน event สรุปที่ยัง OPEN ของ membership ที่ถูกปิด — ถ้า membership ที่เหลือมี event สรุปของสัปดาห์เดียวกัน (periodKey เดียวกัน) อยู่แล้ว → resolve event ของตัวที่ถูกปิด (push ที่ค้างถูกระงับด้วยเช็คสถานะ event); ถ้าไม่มี → ย้ายผู้รับไปบัญชีที่เหลือ
- **race ระหว่าง sweep กับการรวมบัญชี**: sweep วนตาม **id ของ subscription** และใน tx สร้าง event ล็อก `ExpenseWeeklySummarySubscription` แถวนั้นและ `CompanyMembership` ที่มันชี้ (`FOR SHARE`) แล้วอ่าน `membershipId`, `userId`, `status` ใหม่ — ใช้ค่าที่อ่านใหม่เป็นผู้รับ; membership ไม่ ACTIVE → ข้ามโดยไม่สร้าง event; การรวมบัญชีอัปเดตแถวเดียวกันจึงต้องรอหรือ commit ก่อน → ไม่มี event ที่ไม่มีผู้รับซึ่ง `onlyIfAbsent` จะกันการซ่อม
- migration `2026102X000000_expense_weekly_summary_subscription`: CREATE TABLE + FK + index; data steps สำหรับเลิกสรุปรายวัน: `UPDATE "NotificationRule" SET "status"='DISABLED' WHERE "triggerKey"='daily_owner_summary' AND "status"='ENABLED'`; `UPDATE "NotificationEvent" SET "status"='RESOLVED', "resolvedAt"=now() WHERE "triggerKey"='daily_owner_summary' AND "status"='OPEN'`; ระงับ delivery ที่ยังค้างของ event เหล่านั้น (`status IN ('QUEUED','FAILED')` → `SUPPRESSED`, `errorCode='TRIGGER_RETIRED'`, `nextAttemptAt=NULL`) — idempotent ทั้งหมด
- ไม่มีคอลัมน์ใหม่ใน `NotificationEvent`: เนื้อการ์ดอยู่ใน `payloadJson` (`schema.prisma:1554`; repository รับอยู่แล้ว `prisma-notification.repository.ts:160-182` แต่ use case ส่ง `{}` ตายตัวที่ `notification.use-cases.ts:257`)

## 7. Contracts / API

`packages/contracts/src/dashboard.ts`:

```ts
export type ExpenseWeeklySummarySubscriptionDto = {
  eligible: boolean;        // มี expense.read ตอนนี้
  subscribed: boolean;
  lineLinked: boolean;      // ExternalIdentity LINE ACTIVE บน channel ระบบ
  lineChannelOn: boolean;   // ไม่ได้ปิด LINE ใน NotificationPreference (ไม่มีแถว = เปิด)
  nextCheckDate: string;    // YYYY-MM-DD จันทร์ถัดไป (Asia/Bangkok) — วันตรวจ ไม่ใช่วันที่รับประกันว่าจะส่ง
};
export type ExpenseWeeklySummaryRow = { label: string; value: string };
export type ExpenseWeeklySummaryAudience = {
  membershipId: string;
  scopeKey: string;         // 'ALL' หรือ branchIds เรียงแล้วคั่น ','
  canPayClaims: boolean;
  companyWide: boolean;
};
export type ExpenseWeeklySummaryCard = {
  version: 1; weekStart: string; weekEnd: string; asOf: string;
  audience: ExpenseWeeklySummaryAudience;
  scopeLabel: string; headline: ExpenseWeeklySummaryRow[];
  categories: ExpenseWeeklySummaryRow[]; pending: ExpenseWeeklySummaryRow[];
  watch: ExpenseWeeklySummaryRow[]; tax: ExpenseWeeklySummaryRow[];
  buttons: Array<{ label: string; path: string }>;
};
```

| Method | Path | Guard | ผล |
|---|---|---|---|
| GET | `/v1/companies/:companyId/expense-weekly-summary/me` | `notification.read`; ระหว่างแพ็กหมดอายุใช้ route กู้คืน (ด้านล่าง) | DTO ของผู้เรียกเอง (ร้านหมดอายุ: `eligible=false`) |
| PUT | `/v1/companies/:companyId/expense-weekly-summary/me` | `notification.read` + `expense.read` | upsert แถวของ membership ผู้เรียก (idempotent) + audit `expense_weekly_summary.subscribe` |
| DELETE | `/v1/companies/:companyId/expense-weekly-summary/me` | ปกติ `notification.read` (ไม่ต้องมี `expense.read`); ต้องผ่านได้แม้ (ก) แพ็กหมดอายุแต่ยังไม่ถูกระงับ — ยกเว้นจากด่านวันหมดอายุแยก `auth.guard.ts:294-305` (`isTermExpiryExempt` `:107-110`); (ข) ถูกระงับเพราะหมดอายุ — ต่อเข้า `allowTermRecovery` (`:245`) ด้วย `isExpenseWeeklySummaryRecoveryRoute` (เฉพาะ GET/DELETE path นี้ — pattern `isAccountEmailRecoveryRoute` `:68-72`); (ค) สาขาที่เลือกถูกปิดหมด — resolver ปฏิเสธก่อน (`prisma-permission-resolver.repository.ts:108-109`) จึงต้องใช้บริบทแคบที่ไม่ผ่าน resolver: use case ตรวจแค่ session user + `CompanyMembership(companyId, userId)` มีอยู่ (§16.1 M7) — ทางออกกดได้เสมอ | ล็อกแถว membership `FOR UPDATE` ก่อน (ลำดับเดียวกับด่านส่ง §8) แล้วลบแถว + resolve event สรุปที่ยัง OPEN ของ membership นี้ (push ที่ค้างจะถูกระงับด้วยเช็คสถานะ event ตอนส่ง `notification.use-cases.ts:514`) + audit `expense_weekly_summary.unsubscribe`; ไม่มีแถว = 200 |
| POST | `/v1/internal/notifications/weekly-expense-summary-sweep` | worker token (`internal.controller.ts:28-60`) | `{ processed, created, existing, quiet, skippedNoAccess, purged, failures }`; failures > 0 → non-2xx |

**Sweep** `CreateWeeklyExpenseSummariesSweepUseCase` (`notification-sweeps.use-cases.ts`):

1. อ่าน subscription + membership `status='ACTIVE'` + `company.status='ACTIVE'`
2. ต่อคน `PermissionResolverService.resolveAccess(membership.userId, companyId)` → ไม่มี `expense.read` = ข้าม
3. `ExpenseSummaryProvider.collectWeeklyDigest({ companyId, scopes: access.scopes, canPayClaims, companyWide, weekStart, weekEnd, asOf })` → `buildWeeklySummaryCard(facts)`; `null` = เงียบ → ข้าม
4. **ใน transaction เดียว** `createEvent.executeInTransaction({ ..., onlyIfAbsent: true }, tx)` — ใช้ advisory lock ต่อ dedupKey ที่มีอยู่ (`notification.use-cases.ts:203-212`); flag ใหม่ `onlyIfAbsent` ให้ `execute` คืน `skipped: 'exists'` เมื่อพบ event dedupKey นี้ในสถานะใดก็ตาม (ไม่ reopen event ที่ถูก resolve จากการยกเลิก)
   - input: `triggerKey: 'expense.weekly_summary'`, `sourceModule: 'expenses'`, `sourceType: 'weekly_summary'`, `sourceId: membershipId`, `periodKey: weekStart`, `severity: 'info'`, title/body จาก `weeklySummaryBellText`, `payloadJson: { card }`, `deepLinkHref: '/companies/:id/income-expense-ledger?side=expense'`, `recipientUserIds: [userId]`, `supersedeEarlier: true`, `supersedeBy: 'source'`
5. หลัง loop: purge ตาม §5.6 (ทุกบริษัท แยกจาก loop และทำเสมอ); failures > 0 → throw (worker retry; ไม่ซ้ำเพราะข้อ 4)

**Supersession**: `resolveEarlier` รับ option ใหม่ `matchBy: 'record' | 'source'` (ค่าเดิม `record` = พฤติกรรมเดิมทุก byte); `source` จับ `sourceModule + sourceType + sourceId` (= membership เดียวกัน) **และ** `createdAt < event.createdAt` แม้ event มี `deepLinkHref` — ไม่ใช้ลิงก์ ledger ร่วม (`prisma-notification.repository.ts:194`) ที่ทำให้ event ของคน B ปิด event ของคน A

**Delivery**: `ProcessQueuedDeliveryUseCase` เดิม + ด่านสำหรับ `expense.weekly_summary` ใน transaction ส่ง ตามลำดับล็อกใน §8 ข้อ 2; ผ่านแล้วใช้ `buildExpenseWeeklySummaryLineMessage(card, companyId)` แทน `buildLineMessage` (`:544-551`)

**Model keys** (`notification.model.ts`): เพิ่ม `'expense.weekly_summary'` ใน `IMPLEMENTED_TRIGGER_KEYS`, `ALWAYS_DELIVERED_TRIGGER_KEYS` (ผู้รับขอเอง — รายการ trigger ที่แช่แข็งต้องไม่ตัด แต่ยังเคารพการปิดช่อง LINE), `NOTIFICATION_TRIGGER_FEATURE_KEYS['expense.weekly_summary'] = ['expenses']`; **ลบ** `'daily_owner_summary'` ออกจาก `IMPLEMENTED_TRIGGER_KEYS` และเพิ่ม `RETIRED_TRIGGER_KEYS = ['daily_owner_summary']` (ใช้กรองใน `ListRulesUseCase` และปฏิเสธใน `UpdateRuleUseCase`)

**เลิกสรุปรายวันจริง**: `CreateDailyOwnerSummaryUseCase.execute` คืน `{ skipped: true, reason: 'retired' }` โดยไม่ generate snapshot และไม่สร้าง event — ทั้ง sweep (`notification-sweeps.use-cases.ts:106-129`) และ internal route (`internal.controller.ts:128-139`) จึงไม่มีผล; cron/BullMQ repeatable คงไว้ (ลบ case ออกจะเกิด log `unknown_job_kind` ทุกวันเพราะ repeatable ค้างใน Redis)

## 8. สิทธิ์ ABAC และขอบเขต tenant

- สมัครได้เฉพาะ `expense.read`; ยกเลิกได้เสมอ
- ตรวจสิทธิ์ **สามจุด**:
  1. ตอนสร้างการ์ด (sweep) — `resolveAccess` รวม entitlement filter (`feature-gate.logic.ts:120-123`)
  2. **ตอนส่ง LINE** — ใน transaction เดียวกับการยิง LINE ตามลำดับล็อกนี้ (ห้ามลัด ห้ามเหลือแค่ตรวจ subscription):
     a. advisory entitlement แบบ shared (มีอยู่ `notification.use-cases.ts:498`)
     b. `SELECT id FROM "Company" WHERE id = $1 FOR SHARE` — ชนกับ `FOR UPDATE` ที่ผู้แก้สิทธิ์/บทบาท/สาขา/สถานะสมาชิกถือผ่าน `lockPlanTermCompany` → การถอดสิทธิ์ที่กำลังทำต้อง commit ก่อนเราอ่าน หรือรอจนเรายิง LINE และ commit แล้ว
     c. แถว membership `FOR UPDATE` (มีอยู่ `:506-513`) — DELETE ยกเลิกรับล็อกแถวเดียวกัน จึงเรียงลำดับกับการส่ง
     d. อ่าน subscription และสิทธิ์ปัจจุบัน (role permissions, entitlement filter, branch scope) **หลัง** b–c — ถ้า resolver รับ tx client ไม่ได้ ให้เพิ่มพารามิเตอร์ `db` หรืออ่านด้วยคำสั่งเทียบเท่าใน tx; เทียบ `expense.read`, `scopeKey`, `canPayClaims`, `companyWide` กับ `audience`
     e. ไม่ผ่าน → `SUPPRESSED` `SUMMARY_AUDIENCE_CHANGED` (ไม่ retry); ผ่าน → ยิง LINE แล้ว commit
     ผล: การถอดสิทธิ์/ยกเลิกที่ commit ก่อน b/c ถูกเห็นเสมอ; ที่เริ่มหลังจากนั้นต้องรอจนส่งเสร็จ (= ส่งก่อนถอด) — ไม่มีช่องที่อ่านสิทธิ์เก่าแล้วยิงหลังการถอด commit; ผู้แก้สิทธิ์ที่ยัง **ไม่** ล็อก `Company` (ต้องไล่ให้ครบ §16.1) ต้องเพิ่ม `lockPlanTermCompany` ก่อนปล่อย; ลำดับ advisory → Company → membership ต้องตรงกับผู้แก้ entitlement (advisory ก่อน — `set-partner-features.use-case.ts:253`) เพื่อไม่ให้ deadlock
  3. **ตอนแสดงในกระดิ่ง**: `ListNotificationsUseCase` และ `GetUnreadCountUseCase` กรองก่อนแบ่งหน้า (ตามหลัก `prisma-notification.repository.ts:21-25`) — ผู้ดูที่ไม่มี `expense.read` ไม่เห็น `expense.weekly_summary` เลย; มีแล้วเห็นเฉพาะ event ที่ `payloadJson.card.audience.scopeKey` เท่ากับขอบเขตปัจจุบัน และ `canPayClaims`/`companyWide` ไม่กว้างกว่าสิทธิ์ปัจจุบัน (Prisma JSON path filter)
- ตัวเลขทุกตัว `where companyId` + `branchScopeWhere(scopes)`; A2 "ใหม่" ตรวจประวัติทั้งร้าน (บอกแค่ว่าใหม่หรือไม่ ไม่เปิดเผยรายการสาขาอื่น)
- endpoint ไม่รับ `userId`/`membershipId` จาก client; AI Gateway ไม่เกี่ยว; ไม่มี mutation ทางธุรกิจ

## 9. State transitions

```
(ไม่มีแถว) --PUT [expense.read]--> SUBSCRIBED --DELETE--> (ไม่มีแถว) + event สรุป OPEN ของ membership → RESOLVED
SUBSCRIBED --account merge (move)--> SUBSCRIBED (membership เดิม userId ใหม่)
SUBSCRIBED --account merge (close_duplicate)--> ย้ายไป membership ที่เหลือ หรือลบถ้ามีแล้ว
จันทร์ 08:00 ต่อ subscription:
  membership/บริษัทไม่ ACTIVE, ไม่มี expense.read → ข้าม (แถวคงอยู่)
  เงียบ → ข้าม
  มี event dedupKey นี้แล้ว (สถานะใดก็ได้) → ข้าม
  ไม่เงียบ → NotificationEvent OPEN; event สรุปเก่าของ membership เดียวกัน → RESOLVED
            → Delivery WEB: SENT
            → Delivery LINE: SENT | SKIPPED(NO_LINE_DELIVERY_TARGET)
                             | SUPPRESSED(SUMMARY_AUDIENCE_CHANGED | PREFERENCE_SUPPRESSED | QUIET_HOURS | FEATURE_NOT_ENABLED | RECIPIENT_OR_EVENT_INACTIVE)
                             | FAILED → retry ≤ 5
หลัง loop: event สรุปอายุ > 13 เดือนของบริษัทนั้น → ลบ
```

`daily_owner_summary`: rule ENABLED → DISABLED, event OPEN → RESOLVED, delivery ค้าง → SUPPRESSED(TRIGGER_RETIRED) โดย migration; use case คืน `retired`; เปิด rule กลับไม่ได้ และไม่แสดงในรายการกฎ

## 10. UI และถ้อยคำ

### 10.1 LINE card (Flex bubble `mega`, OA ระบบ)

ตัวอย่างสร้างจาก fixture ที่ผ่านทุกกติกา (ใช้เป็น fixture ใน test ด้วย):

- การ์ดส่ง **จันทร์ 2 พ.ย. 2569** สรุปสัปดาห์ 26 ต.ค. – 1 พ.ย. 2569 เดือนภาษี = ต.ค.
- ยอดยืนยันสัปดาห์นี้ 12,450.00; สัปดาห์ก่อน (19–25 ต.ค.) 11,250.00; 8 สัปดาห์ก่อนหน้ารวม 40,000.00 (11,250 + 7 สัปดาห์รวม 28,750) → mean 5,000.00 → 12,450 ≥ 10,000 และส่วนต่าง 7,450 ≥ 3,000 → A1 ขึ้น
- หมวด: วัตถุดิบ 5,200 + ค่าเช่า 4,000 + น้ำมัน 1,850 = 11,050 (อื่น ๆ 1,400)
- ผู้ขายใหม่ "ร้านสมใจ" 4,500.00 (มีเลขภาษี ไม่เคยพบในร้าน; ร้านมีประวัติ 8 สัปดาห์)
- ผู้รับไม่จำกัดสาขา มีสิทธิ์จ่ายใบเบิก; มีจ่ายที่หัก ณ ที่จ่ายให้นิติบุคคล ยืนยันวันจ่ายแล้วใน ต.ค. และยังไม่อยู่ในแบบที่ยื่น (→ ภ.ง.ด.53 เท่านั้น); ทุกรายการเป็น THB; ร้านจด VAT มีผลตลอด ต.ค.

```
[header สีเขียว]  น้องมั่งมีสรุปรายจ่ายสัปดาห์ที่แล้วให้แล้วค่ะ
[sub]             26 ต.ค. – 1 พ.ย. 2569 · ทุกสาขา
──────────────
รายจ่ายยืนยันแล้ว            12,450.00 บาท
เทียบสัปดาห์ก่อน          มากกว่า 1,200.00 บาท
ค่าวัตถุดิบ                   5,200.00 บาท
ค่าเช่า                       4,000.00 บาท
ค่าน้ำมัน                     1,850.00 บาท
── งานค้าง ณ 2 พ.ย. ──
ใบเสร็จรอตรวจ                       3 ใบ
ค้างจ่าย                       8,000.00 บาท
── ควรดู ──
สูงกว่าค่าเฉลี่ย 8 สัปดาห์       7,450.00 บาท
ผู้ขายใหม่ · ร้านสมใจ           4,500.00 บาท
อาจซ้ำ                              2 ใบ
ใบเบิกรอจ่ายเกิน 7 วัน              1 ใบ
── ภาษี ──
ภ.ง.ด.53 เดือน ต.ค.       ยื่นเน็ตภายใน 15 พ.ย.
ภ.พ.30 เดือน ต.ค.        ยื่นเน็ตภายใน 23 พ.ย.
[footer] [ดูรายจ่ายตามหมวด] [ดูใบเสร็จรอตรวจ] [หยุดรับสรุปนี้]
```

- แต่ละแถว = box `baseline` ป้ายซ้าย (`flex 3`, `wrap: true`) ค่าขวา (`flex 2`, `align: end`) — **ค่าเดียวสั้น ๆ ต่อแถว**; หัวข้อย่อยที่ไม่มีแถวไม่แสดง
- ปุ่ม `type: uri` ทั้งหมด `height: sm` เรียงแนวตั้งเต็มกว้าง → **ขนาดเท่ากัน**; "ดูใบเสร็จรอตรวจ" เฉพาะรอตรวจ > 0
- ปลายทาง: `/companies/:id/income-expense-ledger?side=expense`, `/companies/:id/expenses?view=pending`, `/companies/:id/account#weekly-summary` ผ่าน `webLink()` + `withLineExternalBrowserLinks` (`notification.use-cases.ts:785-786,849`)
- `altText`: `[มั่งมีพลัส] สรุปรายจ่าย 26 ต.ค.–1 พ.ย. 12,450.00 บาท` ผ่าน `lineMessagePreview` (≤ 400 ตัวอักษร)
- ไม่มีรายการลำดับตัวเลข ไม่มีปุ่ม postback (ไม่เข้า webhook ไม่เข้า AI)

### 10.2 กระดิ่งเว็บ

- title: `สรุปรายจ่าย 26 ต.ค. – 1 พ.ย.`; body: แถวเดียวกับการ์ด `ป้าย: ค่า` คั่นบรรทัด; เปิดแล้วไป `/income-expense-ledger?side=expense` (`notificationSourceHref` คืน `deepLinkHref` ตรง ๆ — `notification.logic.ts:172-177`); การมองเห็นตาม §8 ข้อ 3

### 10.3 "บัญชีของฉัน" (`CompanyProfilePage` accountOnly, `CompanyProfilePage.tsx:523`) — การ์ด `id="weekly-summary"`

- รูปแบบเดียวกับแถว "รหัสผ่านสำรอง" (`MangmeeCard` ชื่อ + บรรทัดสถานะ + ปุ่มเดียว); 390 px: ปุ่มเต็มกว้างใต้ข้อความ; 1280 px และ ~1,556 px: ชื่อซ้าย ปุ่มชิดขวาแถวเดียว การ์ดเต็มกว้าง container; ปุ่มสูง/กว้างเท่าปุ่มของการ์ดข้างเคียง (วัดจริง)
- แสดงเมื่อ `eligible || subscribed`

| สถานะ | บรรทัดสถานะ | ปุ่ม |
|---|---|---|
| ยังไม่รับ, เชื่อม LINE | ส่งวันจันทร์ 08:00 น. เฉพาะสัปดาห์ที่มีเรื่องให้สรุป | เริ่มรับสรุป |
| รับอยู่, เชื่อม LINE, LINE เปิด | รับอยู่ · ตรวจครั้งถัดไปวันจันทร์ 2 พ.ย. 08:00 น. | หยุดรับสรุป |
| ยังไม่เชื่อม LINE (รับหรือไม่รับ) | บัญชีนี้ยังไม่เชื่อม LINE สรุปจะอยู่ที่กระดิ่งแจ้งเตือน | เริ่มรับสรุป / หยุดรับสรุป |
| รับอยู่, ปิด LINE ในตั้งค่าการแจ้งเตือน | ปิด LINE ไว้ในตั้งค่าการแจ้งเตือน สรุปจะอยู่ที่กระดิ่ง | หยุดรับสรุป |
| รับอยู่ แต่ไม่มี `expense.read` แล้ว | บัญชีนี้ดูรายจ่ายทั้งร้านไม่ได้แล้ว จึงหยุดส่ง | หยุดรับสรุป |

- toast: `เริ่มรับสรุปแล้ว จะดูให้วันจันทร์ 2 พ.ย. และส่งถ้ามีเรื่องให้สรุป` / `หยุดรับสรุปแล้ว`; ล้มเหลว: Notice สีแดง `บันทึกไม่สำเร็จ` + `ลองอีกครั้ง`
- ไม่มีประโยคใดรับประกันวันส่งฉบับแรก/ถัดไป (สัปดาห์เงียบไม่ส่ง และ LINE อาจถูกระงับ)
- ลิงก์ `#weekly-summary` จากปุ่ม LINE: เพิ่ม `weekly-summary` ใน `COMPANY_PROFILE_SECTION_IDS` (`company-profile.logic.ts:68`) ให้ map ไป section `account`; การ์ดโหลดแบบ async จึงต้องเลื่อนเมื่อ element มีแล้ว (รอผล GET เสร็จ) ไม่ใช่แค่ `requestAnimationFrame` แบบ `vat-status` (`CompanyProfilePage.tsx:171-191`); รองรับทั้งเปิดแบบ cold และ `hashchange` ขณะหน้าเปิดอยู่

### 10.4 เมนู + หน้า "รายจ่ายตามหมวด"

- `web-core-workspace.logic.ts` expenses sub-items: `{ key: 'expenses.by_category', label: 'รายจ่ายตามหมวด', href: '/companies/:id/income-expense-ledger?side=expense', icon: PieChartIcon }` ต่อจาก "รายการค่าใช้จ่าย" เมื่อมี `expense.read`
- `IncomeExpenseLedgerPage`: อ่าน `side=expense` → `chartSide` เริ่ม `EXPENSE` (วันนี้เริ่ม `INCOME` เมื่อมี `accounting.document.read`, `:302`)
- ไม่มี `accounting.document.read` → โหมดรายจ่าย: title `รายจ่ายตามหมวด`, description `รายจ่ายที่ยืนยันแล้วของเดือนที่เลือก`; ซ่อน stat รายรับ (`:473-475`), "ส่วนต่างเงินรับ–เงินจ่าย" (`:478`), การ์ดส่วนต่าง (`:501-505`); stat `grid-cols-2`; ไม่มี toggle ฝั่งกราฟ
- ทุกโหมด: ฝั่ง `unavailableReason === 'NO_PERMISSION'` ไม่แสดงการ์ดเลย (แทน `เปิดฝั่งนี้เร็ว ๆ นี้` `:100-102`); `DATA_MISMATCH` คงเดิม
- 390 px: stat 2 คอลัมน์ กราฟเต็มกว้าง; 1280 / ~1,556 px: หน้าเต็มกว้าง (MangmeePage)
- หน้า list ค่าใช้จ่าย: รับ `view=duplicates` → `duplicateStatus=POSSIBLE_DUPLICATE` (รุ่นแรกไม่มีปุ่มนี้บนการ์ด LINE เพื่อคง ≤ 3 ปุ่ม)

### 10.5 ตารางพื้นผิว × กรณี

| ประโยค/ป้าย | พื้นผิว | กรณี | แสดงอะไร | ทำไมจริง |
|---|---|---|---|---|
| `น้องมั่งมีสรุปรายจ่ายสัปดาห์ที่แล้วให้แล้วค่ะ` | LINE | ทุกการ์ด | เสมอ | ส่งเมื่อมีสรุปจริงเท่านั้น |
| `{จันทร์}–{อาทิตย์} · ทุกสาขา` | LINE, กระดิ่ง | ไม่จำกัดสาขา | `ทุกสาขา` | ไม่กรองสาขา |
| — | — | จำกัด 1–2 สาขา | `{ชื่อสาขา} · รวมส่วนกลาง` | นับสาขา + `branchId=null` จริง |
| — | — | จำกัด ≥ 3 สาขา | `{N} สาขา · รวมส่วนกลาง` | — |
| `รายจ่ายยืนยันแล้ว` | LINE, กระดิ่ง | ยอด > 0 / = 0 แต่ไม่เงียบ | จำนวนเงิน / `0.00 บาท` | ฐาน CONFIRMED, THB |
| `สกุลเงินอื่น (ไม่รวมด้านบน)` | LINE, กระดิ่ง | มีรายการไม่ใช่บาทในกลุ่มแถวเงิน / ไม่มี | `{N} ใบ` / ไม่แสดง | ยอดทุกแถวเป็นบาทล้วน ไม่แปลงสกุล |
| `เทียบสัปดาห์ก่อน` | LINE, กระดิ่ง | มากกว่า/น้อยกว่า/เท่ากัน; ก่อนหน้า = 0 | `มากกว่า X บาท` / `น้อยกว่า X บาท` / `เท่ากัน` | เป็นบาท ไม่มี % |
| ชื่อหมวด | LINE, กระดิ่ง | มีหมวด / บรรทัดไม่มีหมวด | ≤ 3 แถว / `ยังไม่จัดหมวด` | ไม่มีเลขลำดับ |
| `งานค้าง ณ {วันส่ง}` | LINE | รอตรวจ > 0 หรือ ค้างจ่าย > 0 | หัวข้อ + แถว | ระบุวันที่ จริงแม้อ่านวันหลัง |
| `สูงกว่าค่าเฉลี่ย {N} สัปดาห์` | LINE, กระดิ่ง | A1 ผ่าน | ส่วนต่างเป็นบาท; N จริง 4–8 | ไม่อ้าง 8 ถ้ามีไม่ถึง |
| `ผู้ขายใหม่ · {ชื่อ}` | LINE, กระดิ่ง | A2 ผ่าน (ทุกทิศของการผูก counterparty) | ≤ 2 แถว + `ผู้ขายใหม่อีก` `{N} ราย` | ใหม่ต่อร้านตามกุญแจทั้งสองแบบ |
| `อาจซ้ำ` | LINE, กระดิ่ง | A3 > 0 | `{N} ใบ` | ตัวจับซ้ำของระบบ |
| `ใบเบิกรอจ่ายเกิน 7 วัน` | LINE, กระดิ่ง | ผู้รับจ่ายได้ + มี / จ่ายไม่ได้ | `{N} ใบ` / ไม่แสดง | นิยามเดียวกับ scan; แจ้งเฉพาะคนเกี่ยวข้อง |
| `ภ.ง.ด.3 เดือน {M}` / `ภ.ง.ด.53 เดือน {M}` (แถวละแบบ) | LINE, กระดิ่ง | มีรายการจ่ายของแบบนั้นที่ยืนยันวันจ่ายใน M และยังไม่อยู่ในแบบที่ยื่นแล้ว, ไม่เกินวันยื่นเน็ต, due ≤ 2027-01-31 / due หลังนั้น | `ยื่นเน็ตภายใน 15 {M+1}` / `ยื่นภายใน 7 {M+1}` | จัดแบบด้วยกติกาเดียวกับหน้า ภ.ง.ด.; ยื่นถึงวันนั้นตรงเวลาเสมอ |
| — | — | ไม่มีหัก, วันจ่ายยังไม่ยืนยัน, ไม่รู้ประเภทผู้รับ, จัดเป็น ภ.ง.ด.2, ทุกรายการอยู่ในแบบที่ยื่นแล้ว, จำกัดสาขา, เลยวันยื่น | ไม่แสดง | ไม่อ้างสิ่งที่ไม่รู้ |
| `ภ.พ.30 เดือน {M}` | LINE, กระดิ่ง | REGISTERED ทับเดือน M, ไม่เกินวันยื่นเน็ต | `ยื่นเน็ตภายใน 23 {M+1}` (หลังสิ้นสุดประกาศ `ยื่นภายใน 15 {M+1}`) | วันเท่ากันทุกสถานประกอบการ |
| — | — | จดมีผลหลัง M / ไม่ทราบสถานะ / จำกัดสาขา | ไม่แสดง | ภาระเริ่มตามวันในใบทะเบียน |
| `ดูรายจ่ายตามหมวด` | ปุ่ม LINE | ทุกการ์ด | หน้าเดือนปัจจุบัน ฝั่งรายจ่าย | ป้ายไม่อ้างว่าเป็นสัปดาห์ |
| `หยุดรับสรุปนี้` | ปุ่ม LINE | ทุกการ์ด | การ์ดในบัญชีของฉัน | DELETE กดได้เสมอ |
| ข้อความบัญชีของฉัน + toast | เว็บ | 5 สถานะ §10.3 | ตามตาราง | ใช้คำว่า "ตรวจ/ดูให้" ไม่รับประกันการส่ง |
| `รายจ่ายตามหมวด` (เมนู+title) | เว็บ | ไม่มี `accounting.document.read` / มีทั้งสอง | โหมดรายจ่าย / title เดิม "สมุดรายรับ–รายจ่าย" กราฟเริ่มฝั่งรายจ่าย | ปลายทางมีกราฟรายจ่ายจริง |

## 11. Impact analysis

| พื้นที่ | ผลกระทบ |
|---|---|
| `dashboard-notifications` (API) | provider method ใหม่, sweep, controller ใหม่, internal route, model keys + retired keys, Flex builder, `payloadJson` + `onlyIfAbsent` ใน create-event, `matchBy` ใน `resolveEarlier`, ด่านส่ง, ตัวกรองกระดิ่ง/unread, daily use case inert |
| `expenses` | read-only (provider "Prisma directly, read-only" `expense-summary.provider.ts:7-10`) |
| `reimbursements` | ย้าย payable-since เป็น pure `claimPayableSince` (scan ใช้ต่อ พฤติกรรมเดิม); read-only สำหรับ A4 |
| `workflow` | `workflow-scan-candidates.use-case.ts:216-220` เรียก `claimPayableSince` แทนโค้ดในที่ |
| `data-model-core` | pure helper `registeredDuringMonth(facts, M)` ข้าง `effectiveVatStatus`; provider อ่าน `companyVatRegistrationFact` ตรง (ไม่ import module → ไม่เสี่ยง DI cycle) |
| `access-control` | ใช้ `PermissionResolverService` (export `access-control.module.ts:35`) ทั้ง sweep และด่านส่ง |
| `auth` (account merge) | `close_duplicate` ย้าย/ลบ subscription ใน transaction เดิม; กรณี move ไม่ต้องแก้ (ผูก membership); ย้าย `NotificationRecipient.userId` ของสรุปที่รอส่ง (§6) |
| `auth` (guard) | route กู้คืน `isExpenseWeeklySummaryRecoveryRoute` สำหรับ GET/DELETE path นี้เท่านั้น (`auth.guard.ts:57-72,245`) |
| `tax` | ลงทะเบียน `ExpenseSourceAdapter` (constructor รับแค่ `PrismaService` `expense-source.adapter.ts:12-13`) เป็น provider ใน dashboard-notifications โดยไม่ import TaxModule; ย้าย pure `withholdingFormType` ออกจาก `sync-tax-events.use-case.ts:60-77` (พฤติกรรมเดิม); ใช้ `withholdingPaperPayments` เดิม |
| `accounting-documents` | แก้ B8: ฝั่งรายจ่ายของ ledger summary/entries นับบาทล้วน + จำนวนใบสกุลอื่น (field ใหม่แบบ additive ใน `IncomeExpenseLedgerSummary`) |
| สิทธิ์ (employee-access ฯลฯ) | ผู้เขียนสิทธิ์ที่ยังไม่ล็อก `Company` ต้องเพิ่ม `lockPlanTermCompany` (ผลจาก §16.1 M1) |
| `apps/workers` | job kind + cron + case ใหม่ |
| หน้าเว็บ | บัญชีของฉัน, เมนูค่าใช้จ่าย, `IncomeExpenseLedgerPage`, list ค่าใช้จ่าย (`view=duplicates`), กระดิ่ง (ไม่แก้ UI — กรองที่ API) |
| LINE path | push อย่างเดียว; **ไม่แตะ webhook / `process-line-webhook.use-case.ts`** |
| AI tool / help card | ไม่มี tool ใหม่; คำตอบวิธีใช้เป็น follow-up ผ่านการอนุมัติ pack (`approved-product-help.ts` อยู่ใน W00 hash) |
| Export | ไฟล์ CSV/XLSX ของหน้า "รายจ่ายตามหมวด" (`income-expense-ledger.use-case.ts:338` ใช้ `listEntries`): **ไม่ตัดแถวสกุลอื่นออก** — ทุกแถวมีคอลัมน์ `สกุลเงิน` (เพิ่มถ้ายังไม่มี) และยอดรวมท้ายไฟล์ (ถ้ามี) แยกตามสกุล ไม่บวกข้ามสกุล; เฉพาะตัวเลขสรุปบนหน้าเป็นบาทล้วน + บรรทัด `ไม่รวมรายจ่ายสกุลอื่น {N} ใบ` |
| Notification | trigger ใหม่; retire `daily_owner_summary` ทุกทาง |
| Billing / entitlement | ทุกแพ็กที่ขาย 249/499/999/1999 (`expenses` + `dashboard_notifications` อยู่ใน starter); ไม่มี feature switch |
| Migration | 1 ตาราง + data steps (rule/event/delivery ของรายวัน) additive/idempotent |
| W00 manifest | ไม่เปลี่ยนตราบไม่แตะไฟล์ใน `SOURCE_REFERENCES` (`line-ai-capability-manifest.ts:223-248`); คู่มือ (Phase 4) ต้อง regen + whole-chain |
| Whole-chain catalog | ไม่เพิ่ม scenario |
| Browser journeys | `e2e/journeys/shop-menus-everyday.journey.spec.ts` ที่ 390 + 1280 (+ 1556 สำหรับเจ้าของ) |
| Seed | subscription ของเจ้าของร้าน seed; ลบ `daily_owner_summary` จาก `DEFAULT_RULES` (`seed.ts:2795-2806`) |

## 12. Gaps

- G1 แพ็กที่ขายตั้ง quiet hours หรือปิด LINE ไม่ได้ (owner decision 2026-10-04) → "หยุดรับสรุป" เป็นทางเดียวที่หยุดข้อความนี้ — จึงมีปุ่มในทุกการ์ด
- G2 ใบเบิกค้างจ่ายไม่มีการเตือนสำหรับร้านที่ไม่ได้ตั้ง `slaHours` — การ์ดนี้ปิดช่องเฉพาะคนที่สมัคร
- G3 LINE `expense.get_breakdown` ใช้ฐาน "ทุกสถานะยกเว้นปฏิเสธ/ยกเลิก" ต่างจากการ์ด — ไม่แก้รอบนี้
- G4 ไม่มีจอแก้เกณฑ์สัญญาณ
- G5 แพ็กเกจ OA `@695ultfm` และปริมาณข้อความต่อเดือนไม่อยู่ใน git
- G6 ไม่มีการเฝ้าโควตา LINE (`GET /v2/bot/message/quota/consumption` — https://developers.line.biz/en/reference/messaging-api/) — งาน ops แยก
- G7 notification อื่นทุกชนิดไม่มีการลบตามอายุ — สเปกนี้ลบเฉพาะของตัวเอง; นโยบายทั้งระบบเป็นงานแยก
- G8 ผู้ขายที่ไม่มีทั้ง counterparty และเลขภาษี (บิลเงินสดร้านทั่วไป) ไม่เคยถูกจับเป็น "ผู้ขายใหม่"
- G9 notice ชนิดอื่น (ไม่ใช่สรุป) ไม่ย้ายผู้รับตอนรวมบัญชี (`NotificationRecipient.userId` `schema.prisma:1577`) — สเปกนี้ย้ายเฉพาะสรุป; ที่เหลือเป็นงานแยก
- G10 หน้าแรกยังรวมยอดข้ามสกุล (B9) — การ์ดเป็นบาทล้วน จึงอาจไม่เท่ากับหน้าแรกสำหรับร้านที่มีบิลต่างสกุลจนกว่า B9 จะแก้

## 13. Bugs ที่พบในโค้ดปัจจุบัน

| # | ที่ | เกิดอะไร | ความรุนแรง |
|---|---|---|---|
| B1 | `notification.use-cases.ts:304,322` + `notification-sweeps.use-cases.ts:23-26` + `generate-snapshot.use-case.ts:128-131` | สรุป 07:00 สร้าง snapshot ด้วย worker context ที่มีแค่ `dashboard.read`,`dashboard.snapshot.generate`; `visibleWidgets` กรองตาม `readPermissions` (`expense.read`) → ร้านแพ็กที่ขายได้ `แดชบอร์ดอัปเดตแล้ว 0 วิดเจ็ต` ทาง LINE ถึงทุก OWNER/ADMIN ทุกเช้า — เกิดกับร้านที่มี rule (seed) หรือเมื่อ worker เรียก internal route `:128-139` ตรง | ต่ำ / ข้อความเท็จ |
| B2 | `IncomeExpenseLedgerPage.tsx:100-102` | ผู้ที่ไม่มีสิทธิ์ฝั่งใดฝั่งหนึ่งเห็น `เปิดฝั่งนี้เร็ว ๆ นี้` — ไม่จริงสำหรับแพ็กที่ขายและพนักงานที่ขาดสิทธิ์ | ต่ำวันนี้ (ไม่มีลิงก์) → **ต้องแก้ก่อนใส่เมนู** |
| B3 | `notification.use-cases.ts:369-379` | LINE ในช่วงเงียบถูก `SUPPRESSED` ถาวร ไม่เลื่อน — ขัดเจตนา "can wait until morning" (`workflow-template-catalog.ts:298-299`) และต่างจาก billing ที่เลื่อน 30 นาที (`billing-notifications.service.ts:498`) | กลาง (เฉพาะร้านที่ตั้ง quiet hours ได้) |
| B4 | `notification.use-cases.ts:305-312` + `notification.model.ts:32-33` | สรุปรายวันส่งทุก OWNER+ADMIN ตามบทบาท | ต่ำ (แก้ด้วย §7 retire) |
| B5 | `notification.use-cases.ts:857` + `notification.model.ts:341` | 429 ถูกจัดเป็น `RATE_LIMIT` แล้ว retry; โควตารายเดือนหมดก็ตอบ 429 → FAILED ทุกข้อความที่เหลือของเดือนโดยไม่มี alert เฉพาะ | กลาง (§17 Q5) |
| B6 | `prisma-notification.repository.ts:188-201` | `resolveEarlier` จับเรื่องเดียวกันด้วย `deepLinkHref` อย่างเดียวเมื่อมี — notice สองคนที่เปิดหน้าเดียวกันแต่เป็นคนละเรื่องจะปิดกันเอง (ผู้ใช้ปัจจุบันเป็น notice ใบเบิกที่ลิงก์ = ใบเบิก จึงยังถูก; จะผิดทันทีที่ trigger ใดใช้ลิงก์ร่วม) | ต่ำวันนี้ / กันด้วย `matchBy` |
| B7 | `notification.use-cases.ts:248-258` + `schema.prisma:1570` | `execute` ตรง (ไม่ผ่าน `executeInTransaction`) ไม่ idempotent เมื่อเรียกซ้อน — producer ที่เรียกตรงอาจสร้าง event/delivery ซ้ำเมื่อ sweep ซ้อน (ตรวจรายตัวว่ามี producer ใดเรียกซ้อนได้จริง — ยังไม่ได้ไล่ทุกตัว) | ต่ำ–กลาง / unverified per producer |
| B8 | `income-expense-ledger.use-case.ts:151-165` | ยอด "รายจ่ายที่บันทึก" / "จ่ายแล้ว" / หมวด รวม `grandTotalAmount` / `amount` / `lineTotalAmount` ทุกสกุลเงินโดยไม่แปลง — รายจ่าย USD 100 + THB 100 ยืนยันในเดือนเดียวกันแสดง ฿200.00 | กลาง — แก้ใน plan 1.2 (หน้าที่เมนูใหม่เปิด) |
| B9 | `expense-summary.provider.ts:27-34,65-81` | หน้าแรก (ยอดช่วง, กราฟรายเดือน, ค้างจ่าย) รวมข้ามสกุลแบบเดียวกัน | กลาง — §16.1 (แตะแบบ HOME-01) |

## 14. Test plan

ไม่รันในรอบเขียนสเปก (ไม่มี node_modules)

**API (ไฟล์ที่อยู่ใน `apps/api/package.json` "test" แล้วเท่านั้น)**

- `src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts`: import จาก `expense-weekly-summary.logic.ts` — weekWindow/nextCheckDate ข้ามเดือน/ปี; quiet rule; **fixture §10.1 ให้ผลการ์ดตรงทุกแถว**; A1 (N=3 ไม่ประเมิน, N=5 แสดง "5 สัปดาห์", mean 6,250 กับ 12,450 ไม่ขึ้น, ส่วนต่าง < 3,000 ไม่ขึ้น); เทียบสัปดาห์ 4 กรณี; scope label 0/1/2/3 สาขา + "รวมส่วนกลาง"; วันภาษี (ก่อน/ตรง/หลังวันยื่น, due 2027-01-31 vs 2027-02-07); Flex: ปุ่ม uri + height เท่ากัน ไม่มี postback altText ≤ 400; ไม่มี `%`, `อันดับ` และไม่มีการเปรียบเทียบแบบคูณ (regex `/[0-9๐-๙.,]+\s*เท่า|เท่าตัว/`) — คำ `เท่ากัน` ต้องผ่าน; สกุลเงิน: USD 100 + THB 100 → ยอด 100.00 และแถว `สกุลเงินอื่น` `1 ใบ`; `withholdingFormType` (INDIVIDUAL → PND3, INDIVIDUAL + `SEPARATE_PND2` → PND2 ไม่มีแถว, JURISTIC → PND53, ไม่รู้ → ไม่มีแถว); ความครอบคลุมการยื่น: PND53 ยื่นแล้วไม่ซ่อน PND3 ที่ยังค้าง, รายการจ่ายที่มาหลังยื่นยังขึ้นแถว; `registeredDuringMonth` (จดมีผล 1 พ.ย. → ต.ค. ไม่ขึ้น, 15 ต.ค. → ขึ้น, เลิกจด 10 ต.ค. → ขึ้น)
- `src/modules/dashboard-notifications/application/providers/expense-summary.provider.spec.ts`: ทุก query มี `companyId`; query ยอดและนับใบมี `branchScopeWhere` **ยกเว้น** query ประวัติ "เคยมีมาก่อน" ของ A2 ที่ต้องไม่มี branch filter; flags ปิดแล้วไม่ query; WHT query มี `paidAtConfirmed: true`
- `src/modules/dashboard-notifications/application/use-cases/process-due-deliveries.use-case.spec.ts`: Flex การ์ด; preference แช่แข็งยังได้ LINE; ปิด LINE ไม่ได้; ด่าน §8 ข้อ 2 — unsubscribe/ถอด `expense.read`/สาขาแคบลง/ถอดสิทธิ์จ่าย ระหว่างสร้างกับส่ง → `SUMMARY_AUDIENCE_CHANGED`; event RESOLVED → ไม่ส่ง; daily ที่ค้าง → ไม่ส่ง
- `src/modules/dashboard-notifications/presentation/http/internal.controller.spec.ts`: route ใหม่ต้องมี worker token, failures>0 → non-2xx; route daily คืน retired ไม่สร้าง event
- `src/modules/dashboard-notifications/application/use-cases/notification-preference.use-case.spec.ts`: subscribe/unsubscribe (403 เมื่อไม่มี `expense.read`; DELETE ไม่ต้องมี; resolve event OPEN; audit); `UpdateRuleUseCase` ปฏิเสธ `daily_owner_summary`; `ListRulesUseCase` ไม่คืน
- `src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts` (real PostgreSQL, `NOTIFICATION_TEST_DATABASE_URL` แบบบล็อก `:730`, `:929`):
  - unique `membershipId`; cascade เมื่อลบ membership/company
  - **สอง sweep พร้อมกัน** (Promise.all) สัปดาห์เดียวกัน → 1 event, 2 deliveries
  - **สอง subscriber** บริษัทเดียวกันสัปดาห์เดียวกัน → 2 event OPEN ทั้งคู่ แล้ว drain → ทั้งสองคนได้ LINE (ไม่ปิดกันเอง); สัปดาห์ใหม่ปิดเฉพาะของคนเดิม
  - ตัวเลข = fixture (CONFIRMED เท่านั้น; ผู้ใช้จำกัดสาขา: สาขา 100 + ส่วนกลาง 200 = 300 เท่ากับ ledger summary ช่วงเดียวกัน)
  - A2 สองทิศ: เก่าเลขภาษีอย่างเดียว → ใหม่ผูก counterparty เลขเดียวกัน = ไม่ใหม่; เก่าผูก counterparty → ใหม่เลขภาษีอย่างเดียว = ไม่ใหม่; ผู้ขายเคยมีในสาขาอื่น = ไม่ใหม่
  - A4: ใบเบิกอนุมัติ 20 วันก่อน ถูกยกเลิกการจ่ายวันนี้ → ไม่ขึ้น; ใบที่ duplicate block CONFIRMED → ไม่ขึ้น
  - WHT: จ่ายใน ต.ค. `paidAtConfirmed=false` → ไม่มีแถว
  - กระดิ่ง: ผู้ถูกถอด `expense.read` → list/unread ไม่นับสรุป; สาขาแคบลง → ไม่เห็นสรุปเก่าขอบเขตกว้าง
  - account merge `close_duplicate` ย้าย/ลบ subscription ถูก
  - purge: event อายุ 14 เดือนถูกลบพร้อม recipient/delivery; 12 เดือนอยู่; **บริษัทที่ไม่มีผู้สมัครเหลือ** และ **บริษัทที่ถูกระงับ/หมดอายุ** ก็ถูก purge
  - **interleaving สิทธิ์ × ส่ง** (สอง connection, stub `pushLineMessage` ที่รอ latch): (i) role update ถอด `expense.read` ถือ `Company FOR UPDATE` อยู่ → delivery รอที่ `FOR SHARE` แล้ว `SUMMARY_AUDIENCE_CHANGED`; (ii) delivery ถือ `FOR SHARE` และค้างใน push → role update รอจน delivery commit (ส่งก่อนถอด); (iii) DELETE ยกเลิกระหว่าง delivery → เรียงบนแถว membership, ไม่มีกรณียิงหลังลบแถว commit; (iv) entitlement `expenses` OFF พร้อมกัน → ไม่ deadlock (ลำดับ advisory → Company → membership)
  - รวมบัญชี: event สรุปที่รอส่งของ membership ที่ย้าย → ผู้รับย้ายไปบัญชีที่เหลือและส่งถึง
  - หน้า ledger (B8): ทดสอบใน `src/modules/accounting-documents/infrastructure/prisma-accounting.repository.atomic-issue.spec.ts` (อยู่ใน list แล้ว ใช้ `IncomeExpenseLedgerUseCase` `:1164`) — USD + THB ไม่บวกกัน
  - migration: rule DISABLED, event รายวัน RESOLVED, delivery ค้าง SUPPRESSED
- `src/modules/workflow/application/use-cases/workflow-scan.use-case.spec.ts` (อยู่ใน list แล้ว; ครอบ `paymentSlaBreach`) ต้องผ่านเหมือนเดิมหลังย้าย `claimPayableSince`
- `src/modules/employee-access/domain/logic/feature-gate.logic.spec.ts`: regression (ไม่มี permission ใหม่)
- `src/modules/auth/auth.guard.spec.ts` (อยู่ใน list แล้ว): ร้านแพ็กหมดอายุ — GET/DELETE `expense-weekly-summary/me` ผ่าน route กู้คืน, PUT ถูกปฏิเสธ `company_term_expired`, path อื่นไม่ได้สิทธิ์กู้คืนตาม
- `src/modules/tax/application/use-cases/sync-tax-events-wht-form.use-case.spec.ts` (อยู่ใน list แล้ว): ผลจัดแบบเดิมไม่เปลี่ยนหลังย้ายเป็น `withholdingFormType`

**Workers**: `apps/workers/src/modules/notifications/notification-jobs.spec.ts`

**Web (`tsx --test "src/**/*.spec.ts"`)**: `web-core-workspace.spec.ts`; `income-expense-ledger.logic.spec.ts`; `company-profile.logic.spec.ts` + `CompanyProfilePage.qa.spec.ts` (5 สถานะ, ไม่มีคำรับประกันวันส่ง); `expense-list-navigation.logic.spec.ts`

**Browser** (ตาม `docs/guidelines/thai-ux-standard.md:110-117`): หน้าที่แก้ทุกหน้า (รายจ่ายตามหมวด, บัญชีของฉัน) เปิดใน browser จริงที่ **390 และ 1280** (+ ~1,556 ที่เจ้าของใช้ตรวจ) ด้วยข้อมูลไทย ดูภาพจริง, **วัดความสูง/กว้างปุ่มในกลุ่ม**, กด journey หลักหนึ่งรอบรวมทางผิดหนึ่งครั้ง (กดเริ่มรับซ้ำเร็ว ๆ / เปิดหน้าโดยไม่มีสิทธิ์); `e2e/journeys/shop-menus-everyday.journey.spec.ts`; `e2e/notifications.spec.ts` เห็นสรุปในกระดิ่งหลังเรียก internal sweep บน proof stack; บันทึกสิ่งที่ไม่ได้ดูตรง ๆ

## 15. Acceptance criteria

| # | Scenario | ผลที่ต้องได้ |
|---|---|---|
| AC1 | เจ้าของร้านแพ็ก 249 (มี `expense.read`, เชื่อม LINE) กด "เริ่มรับสรุป" | แถว subscription 1 แถว (ผูก membership); toast บอกวันตรวจแบบมีเงื่อนไข; audit 1 รายการ |
| AC2 | จันทร์ 2 พ.ย. 2569 08:00 ด้วย fixture §10.1 | LINE 1 การ์ดตรง §10.1 ทุกแถว; ไม่มี AI call; กระดิ่งมี title `สรุปรายจ่าย 26 ต.ค. – 1 พ.ย.` |
| AC3 | สัปดาห์เงียบ | ไม่มี event/delivery |
| AC4 | sweep ซ้อนกันสองตัว / retry วันเดียวกัน | event 1, LINE 1 |
| AC5 | สอง subscriber บริษัทเดียวกัน | ทั้งสองได้การ์ดของตน; ไม่มีใครถูกระงับเพราะอีกคน |
| AC6 | ผู้รับจำกัดสาขา A | ตัวเลข = สาขา A + ส่วนกลาง (เท่ากับหน้ารายจ่ายตามหมวดช่วงเดียวกัน); sub `สาขา A · รวมส่วนกลาง`; ไม่มีแถวภาษี |
| AC7 | หลังสร้างการ์ดแต่ก่อนส่ง: ยกเลิก / ถอด `expense.read` / สาขาแคบลง | LINE ไม่ส่ง (`SUMMARY_AUDIENCE_CHANGED` หรือ event RESOLVED); กระดิ่งไม่แสดงเมื่อสิทธิ์ไม่ตรง |
| AC8 | พนักงานที่มีแค่ `expense.read_own` | ไม่เห็นการ์ดสมัคร; PUT → 403 |
| AC9 | ผู้ขายใหม่ 4,500.00 ร้านมีประวัติ 6 สัปดาห์ / 3 สัปดาห์ / ผู้ขายเดิมแต่เพิ่งผูก counterparty | ขึ้น / ไม่ขึ้น / ไม่ขึ้น |
| AC10 | จ่ายหัก ณ ที่จ่ายยืนยันวันจ่ายใน ต.ค. 2569: การ์ด 2 พ.ย. และ 9 พ.ย. / 16 พ.ย. / วันจ่ายยังไม่ยืนยัน | `ยื่นเน็ตภายใน 15 พ.ย.` / ไม่มี / ไม่มี |
| AC11 | ร้านจด VAT มีผล 1 พ.ย. 2569, การ์ด 2 พ.ย. | ไม่มีแถว ภ.พ.30 เดือน ต.ค. |
| AC12 | ใบเบิกอนุมัติ 20 วันก่อน การจ่ายถูกยกเลิกวันนี้ | ไม่ขึ้นแถว A4 |
| AC13 | ร้านแพ็ก 249 เปิดเมนู "รายจ่ายตามหมวด" ที่ 390, 1280, 1556 px | title `รายจ่ายตามหมวด`; ไม่มีการ์ดรายรับ/ส่วนต่าง; ไม่มี `เร็ว ๆ นี้`; กราฟหมวดแสดง; ภาพ + ค่าที่วัดได้บันทึกใน memory |
| AC14 | ไม่มีข้อความใดมี `%`, `อันดับ`, หรือการเปรียบเทียบแบบคูณ ("2 เท่า", "เท่าตัว") | assert ใน test; `เท่ากัน` ผ่าน |
| AC15 | หลัง migration + deploy | rule รายวัน DISABLED และไม่แสดงในรายการกฎ; PATCH เปิด → 400; internal route รายวันไม่สร้าง event; delivery รายวันค้าง SUPPRESSED |
| AC16 | ปุ่มบน LINE ทุกปุ่ม | `uri`, ความสูงเท่ากัน, เปิดหน้าถูก |
| AC17 | รวมบัญชีแบบ move และ close_duplicate | subscription ตามไปที่บัญชีที่เหลือ หนึ่งแถว |
| AC18 | event สรุปอายุ > 13 เดือน (บริษัทยังมีผู้สมัคร / ไม่มีผู้สมัครแล้ว / ถูกระงับ) | ถูกลบใน sweep ถัดไปทุกกรณี |
| AC19 | role update ถอด `expense.read` ขณะ delivery กำลังทำ | ไม่มีกรณีที่ LINE ถูกยิงหลังการถอด commit (ตาม interleaving test i–iii) |
| AC20 | ร้านแพ็กหมดอายุ ผู้ใช้เปิด "บัญชีของฉัน" | เห็นการ์ดและกด "หยุดรับสรุป" สำเร็จ; "เริ่มรับสรุป" ไม่แสดง |
| AC21 | รวมบัญชีวันจันทร์หลังสร้างการ์ดแต่ก่อนส่ง | บัญชีที่เหลือได้การ์ดสัปดาห์นั้น 1 ใบ |
| AC22 | จ่ายหัก ณ ที่จ่ายให้บุคคลธรรมดาหมวด `SEPARATE_PND2` / ผู้รับไม่รู้ประเภท / ภ.ง.ด.53 ยื่นแล้วแต่ ภ.ง.ด.3 ค้าง | ไม่มีแถว / ไม่มีแถว / มีแถว `ภ.ง.ด.3 เดือน {M}` อย่างเดียว |
| AC23 | สัปดาห์มีรายจ่าย USD 100 และ THB 100 | `รายจ่ายยืนยันแล้ว` `100.00 บาท` + `สกุลเงินอื่น (ไม่รวมด้านบน)` `1 ใบ`; หน้ารายจ่ายตามหมวดไม่บวก USD เป็นบาท |
| AC24 | กดปุ่ม "หยุดรับสรุปนี้" จาก LINE (cold) และเปลี่ยน hash ขณะหน้าเปิด | หน้าเลื่อนไปการ์ด `#weekly-summary` หลังโหลดเสร็จทั้งสองแบบ |
| AC25 | สัปดาห์มีแต่รายจ่าย USD ยืนยันแล้ว | ไม่เงียบ: `0.00 บาท` + `สกุลเงินอื่น (ไม่รวมด้านบน)` `{N} ใบ` |
| AC26 | ใบเบิกรอจ่ายมาครบ 7 วันพอดี / 7 วัน 1 นาที | ไม่ขึ้น / ขึ้น |
| AC27 | ภ.ง.ด.53 งวดนั้นมีแบบยื่นแล้ว `rowsCertain=false` หรือบรรทัดไม่มี payment key ของเอกสารในเดือนนั้น | ไม่มีแถว ภ.ง.ด.53 (ไม่อ้างทั้งยื่นแล้วและยังไม่ยื่น) |
| AC28 | ยกเลิกรับสรุป: แพ็กหมดอายุก่อนระงับ / หลังระงับ / สาขาที่เลือกถูกปิดหมด | DELETE สำเร็จทั้งสามกรณี |
| AC29 | รวมบัญชีระหว่าง sweep (ทั้ง move และ close_duplicate) | ไม่มี event ที่ไม่มีผู้รับ; บัญชีที่เหลือได้สรุปสัปดาห์นั้นไม่เกิน 1 ใบต่อ membership ที่เหลือ |
| AC30 | ไฟล์ CSV/XLSX ของเดือนที่มี USD + THB | มีทั้งสองแถวพร้อมคอลัมน์สกุลเงิน; ไม่มียอดที่บวกข้ามสกุล |

## 16. Risks / rollout

- **โควตา LINE** (B5, Q5): งบตามเดือนที่มีจันทร์ 5 วัน (5 ข้อความต่อ membership ที่สมัคร — คนเดียวสมัครสองร้าน = 10) + แจ้งเตือนอื่นใน OA เดียวกัน; ยืนยันแพ็กเกจ OA ก่อนปล่อย; opt-in ทำให้โตช้า
- ไม่มี feature switch — เปิดพร้อม deploy; คุมด้วย opt-in
- ด่านส่งถือ `Company FOR SHARE` ตลอดการยิง LINE (push timeout 30 วินาที `notification.use-cases.ts:850`, tx timeout 35 วินาที `:581`) — ผู้แก้สิทธิ์ของร้านนั้นอาจรอได้ถึงเวลาส่งหนึ่งข้อความ; **ห้าม** ลดการตรวจเหลือแค่ subscription หรือย้ายการอ่านสิทธิ์ออกนอกล็อก; ถ้ารอนานเกินรับได้ ให้กลับมาแก้สเปก ไม่ใช่ลัด
- จันทร์ 08:00: sweep ต่อคน (~10 query + 1 transaction) และ delivery sweep ≤ 200 ต่อรอบทุก 30 วินาที (`notification.model.ts:335`, `notification-jobs.ts:56`)
- `daily_owner_summary`: inert + migration + retired key; ไม่ลบโค้ด cron (repeatable ค้างใน Redis)
- ชื่อผู้ขายใน payload อาจเป็นบุคคลธรรมดา — อยู่ใน tenant เดียวกับรายจ่ายต้นทาง, เห็นเฉพาะผู้มีสิทธิ์ (§8), ลบหลัง 13 เดือน (§5.6)
- วันภาษี: อัปเดต `RD_EFILING_8_DAY_EXTENSION_LAST_STATUTORY_DUE` เมื่อมีประกาศต่อ (ปฏิทิน ops ม.ค. 2570)

### 16.1 Must close before coding

รายการที่ตัดสินจากการอ่านโค้ดในรอบนี้ไม่ได้ — ต้องปิดก่อนเริ่มเฟสที่ระบุ

| # | เรื่อง | ระดับ | เจ้าของ / ขั้นต่อไป | ก่อนเฟส |
|---|---|---|---|---|
| M1 | ไล่ผู้เขียนสิทธิ์ทุกตัว (role, role permission, membership role, branch scope, membership status, entitlement, billing apply, plan-term sweep) ว่าล็อก `Company FOR UPDATE` หรือ advisory entitlement ก่อนเขียน และลำดับล็อกไม่สวนกับ advisory → Company → membership | MEDIUM | implementer: grep `rolePermission\.|membershipRole\.|membershipBranchScope\.|companyFeatureEntitlement\.` ทุก writer + ตาราง lock order ใน memory; ตัวที่ไม่ล็อกให้เพิ่ม `lockPlanTermCompany` เป็นขั้นแยก | 3.5 |
| M2 | `PermissionResolverService` อ่านด้วย tx client ได้หรือไม่ (ด่านส่ง §8 ข้อ 2d) | MEDIUM | implementer: อ่าน `prisma-permission-resolver.repository.ts`; ถ้าไม่ได้ เพิ่มพารามิเตอร์ `db` (additive) | 3.5 |
| M3 | มีทางสร้างรายจ่ายสกุลอื่นจริงหรือไม่ (เว็บ, OCR, LINE) — ถ้าไม่มี B8/B9 เป็น latent | LOW | implementer: ไล่ผู้ตั้ง `currency` ของ `ExpenseRecord`; ผลกำหนดว่า B9 ต้องแก้ด่วนหรือไม่ | 1.2 |
| M4 | แก้หน้าแรก (B9) ให้เป็นบาทล้วน + บรรทัดสกุลอื่น — แตะแบบ HOME-01 | MEDIUM | **เจ้าของ** ตัดสินคำ/ตำแหน่ง; ข้อเสนอ: ใต้ตัวเลขแรก บรรทัดเดียว `ไม่รวมรายจ่ายสกุลอื่น {N} ใบ` | ไม่ block เฟสนี้ (G10) |
| M5 | `ExpenseSourceAdapter` อ่านรายจ่ายหัก ณ ที่จ่ายทั้งหมดของร้านทุกครั้ง (`expense-source.adapter.ts:70-80` ไม่จำกัดช่วง) — ต้นทุนต่อ subscriber ต่อสัปดาห์ | LOW | implementer: วัดบน proof stack ร้านข้อมูลใหญ่; ถ้าช้า ให้ cache ผลต่อบริษัทต่อรอบ sweep (ไม่ใช่แก้ adapter) | 3.2 |
| M6 | สถานะ/สิทธิ์ใน route กู้คืน: resolver ให้ permission อะไรระหว่าง `termRecovery` (`prisma-permission-resolver.repository.ts:62-80`) — GET ต้องแสดงสถานะได้, DELETE ต้องพึ่งแค่ membership | LOW | implementer: อ่านต่อจาก `:80`; เขียน guard ของ route นี้ไม่พึ่ง permission | 2.4 |
| M7 | guard รองรับ "route ของบริษัทที่ตรวจแค่ session + membership" (ข้าม resolver ที่ปฏิเสธเมื่อสาขาที่เลือกถูกปิดหมด `prisma-permission-resolver.repository.ts:108-109` และด่านวันหมดอายุ `auth.guard.ts:294-305`) หรือไม่ | MEDIUM | implementer: อ่าน `auth.guard.ts` ทั้งไฟล์หา pattern เดิม (เช่น account/profile recovery `isCompanyProfileRecoveryRoute`); ถ้าไม่มี ให้เพิ่ม flag แคบที่ใช้กับ GET/DELETE นี้เท่านั้น + test สามกรณีของ AC28 | 2.4 |
| M8 | race ปิดบทบาท: `DisableRoleUseCase` นับ assignment ก่อน transaction และไม่ล็อก `Company` (`disable-role.use-case.ts:24-33`) ขณะที่ `update-employee` ผูกบทบาทใน tx ของตัวเอง (`update-employee.use-case.ts:288`) → ปิดบทบาทที่เพิ่งถูกผูกได้ = การถอดสิทธิ์ที่ไม่ผ่านล็อก `Company` (ด่านส่ง §8 ไม่ถูกเรียงลำดับด้วย) | MEDIUM | implementer: ให้ทั้งสอง writer ล็อก `Company` แล้วตรวจสถานะบทบาท/จำนวน assignment ใหม่ใต้ล็อก + test สองลำดับสลับกัน; เป็นส่วนหนึ่งของ M1 | 3.5 |
| M9 | ไฟล์ export ของ ledger มีคอลัมน์สกุลเงินอยู่แล้วหรือไม่ และยอดรวมท้ายไฟล์คำนวณอย่างไร | LOW | implementer: อ่าน `income-expense-ledger.use-case.ts:320-358` + ตัวสร้าง CSV/XLSX; ทำตามแถว Export ใน §11 | 1.2 |

## 17. Open questions (เรื่องธุรกิจ — มีคำแนะนำ)

| # | คำถาม | คำแนะนำ |
|---|---|---|
| Q1 | ใครได้รับโดยไม่ต้องกด: ไม่มีใคร หรือสมัครให้คนเปิดร้านอัตโนมัติ | **opt-in ล้วน** |
| Q2 | ยอมให้มีบรรทัดชวนสมัครครั้งเดียวบนหน้าแรก (ใต้ "รายจ่ายรายเดือน": `รับสรุปรายจ่ายทาง LINE วันจันทร์` [รับสรุป] [ไม่ต้อง]) — แตะแบบ HOME-01 | **ยอม** เฉพาะคนที่มี `expense.read` จนกว่าจะเลือกครั้งเดียว |
| Q3 | เรื่องผิดปกติ: รวมในการ์ดวันจันทร์อย่างเดียว หรือส่งทันที | **รวมในการ์ดอย่างเดียว** รุ่นแรก |
| Q4 | สัปดาห์ไม่มีอะไร: ไม่ส่ง หรือส่งว่าไม่มีรายจ่าย | **ไม่ส่ง** |
| Q5 | OA `@695ultfm` แพ็กเกจอะไร และงบค่าข้อความเท่าไร | ตรวจใน LINE OA Manager; ถ้า Free ให้ขึ้น **Basic 1,280 บาท/เดือน (+VAT)** |
| Q6 | เตือนวันยื่น ภ.พ.30 ให้ร้านที่จด VAT แม้แพ็กไม่มีหน้า VAT | **เตือน** (แถวข้อมูล ไม่มีปุ่ม) |
| Q7 | เก็บสรุปรายสัปดาห์ในกระดิ่งนานเท่าไร | **13 เดือน** แล้วลบ (§5.6) |
