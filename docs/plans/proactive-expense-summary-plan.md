# Proactive Expense Summary Plan

Status: READY (docs-first) — reviewed 3 rounds 2026-10-24, no HIGH open; see Must close before coding (spec §16.1)
Owner: Expenses / Notifications lane
Spec: `docs/specs/proactive-expense-summary-spec.md`
Memory: `docs/agent-memory/proactive-expense-summary.md`
Related: `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md` (ข้อ 14), `docs/guidelines/thai-ux-standard.md` §7
Baseline: main 6c54ba208 (2026-10-23)
หลักการ: ponytail full — ใช้ระบบแจ้งเตือน/การส่ง LINE/provider/หน้ารายจ่ายตามหมวดที่มีอยู่, ไม่มี dependency ใหม่, ไม่มี feature switch, 0 AI call

## ลำดับและการพึ่งพา

```
Phase 1 (เมนู + หน้ารายจ่ายตามหมวด)        — อิสระ ส่งก่อนได้
Phase 2 (สมัคร/ยกเลิก + การ์ดบัญชีของฉัน + retire รายวัน) — อิสระจาก 1
Phase 3 (คำนวณสรุป + sweep + ด่านส่ง + การ์ด LINE) — ต้องมี 2 และ 1.2
Phase 4 (คู่มือ + ปล่อยจริง)                   — หลัง 3; 4.3 รอ Q5
```

รอคำตอบเจ้าของ: 2.7 (Q2), Q3 = "ทันที" ต้องเขียนสเปกเพิ่ม, 4.3 (Q5), ค่า 13 เดือนใน 3.4 (Q7), หน้าแรก B9 (spec §16.1 M4)

ต้องปิดก่อนเฟส (spec §16.1): M3, M9 ก่อน 1.2; M6, M7 ก่อน 2.4; M5 ก่อน 3.2; M1, M2, M8 ก่อน 3.5

หลักฐาน UI ทุกขั้นที่แตะหน้าจอ (ตาม `docs/guidelines/thai-ux-standard.md:110-117`): เปิด browser จริงที่ **390 และ 1280** (+ ~1,556 ที่เจ้าของใช้) ด้วยข้อมูลไทย ดูภาพ, **วัด** ความสูง/กว้างปุ่มในกลุ่ม, กด journey หลักรวมทางผิดหนึ่งครั้ง, บันทึกสิ่งที่ไม่ได้ดู

---

## Phase 1 — เมนู "รายจ่ายตามหมวด" + โหมดรายจ่าย (web only)

### 1.1 เมนูย่อย

- `apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts` (`:285-354`): sub-item `expenses.by_category` / `รายจ่ายตามหมวด` / `/companies/${companyId}/income-expense-ledger?side=expense` / `PieChartIcon` ต่อจาก `expenses.list` เมื่อมี `expense.read`
- ตรวจ `resolveMenuKey`/`collectMenuTargets` (`:453-470`) ให้ active ถูกเมื่อ href มี query (ถ้าเทียบทั้งสตริง ให้เก็บ query นอก href แล้วต่อเฉพาะตอน render)
- test: `web-core-workspace.spec.ts`
- verify: `pnpm --filter @watchdog-bms/web typecheck` + `pnpm --filter @watchdog-bms/web exec tsx --test src/features/web-core-workspace/web-core-workspace.spec.ts`

### 1.2 `IncomeExpenseLedgerPage` โหมดรายจ่าย (แก้ B2)

- `income-expense-ledger.logic.ts`: pure `ledgerPageMode(permissions)` และ `initialChartSide(permissions, sideParam)`
- `IncomeExpenseLedgerPage.tsx`: อ่าน `side` (`:302`); โหมด `expense_only` ซ่อน `:473-475`, `:478`, `:501-505`, grid 2 คอลัมน์, ไม่มี toggle; ทุกโหมดไม่ render ฝั่ง `NO_PERMISSION`; ลบ `เปิดฝั่งนี้เร็ว ๆ นี้` (`:100-102`)
- test: `income-expense-ledger.logic.spec.ts` (3 โหมด, `side=expense`, ไม่มีสตริง `เร็ว ๆ นี้`)
- **แก้ B8 (สกุลเงิน)**: `income-expense-ledger.use-case.ts:151-165` ฝั่งรายจ่าย (ยอดบันทึก, จ่ายแล้ว, หมวด — ตัวเลขสรุปเท่านั้น; **entries และไฟล์ CSV/XLSX `:338` ไม่ตัดแถวสกุลอื่น** แต่แสดงคอลัมน์สกุลเงินและยอดรวมแยกตามสกุล — spec §11 แถว Export, M9) กรอง `currency` เป็นบาท (`upper(currency)='THB'`) และคืน field ใหม่ `expense.otherCurrencyCount` (additive ใน `IncomeExpenseLedgerSummary`, `packages/contracts/src/accounting-documents.ts:452-469`); หน้าแสดงบรรทัด `ไม่รวมรายจ่ายสกุลอื่น {N} ใบ` ใต้การ์ด "รายจ่ายที่บันทึก" เมื่อ N > 0; ฝั่งรายรับ (เอกสารขาย ไม่ได้ขาย) ไม่แตะในงานนี้
- test B8: `src/modules/accounting-documents/infrastructure/prisma-accounting.repository.atomic-issue.spec.ts` (อยู่ใน list แล้ว ใช้ `IncomeExpenseLedgerUseCase` `:1164`) — USD 100 + THB 100 → ฿100.00 + `otherCurrencyCount: 1`
- verify: web typecheck + spec; local stack (memory "Local dev server recipe") ร้าน starter ที่ **390 / 1280 / 1556** — ภาพ + ไม่มีการ์ดรายรับ

### 1.3 Browser journey

- `e2e/journeys/shop-menus-everyday.journey.spec.ts`: กดเมนู → heading `รายจ่ายตามหมวด`, `ยอดตามหมวด`; ไม่มี `ยอดขายจากเอกสาร`; รันที่ 390 และ 1280 บน proof stack (ฐานข้อมูลสด)

---

## Phase 2 — สมัคร/ยกเลิก + การ์ดบัญชีของฉัน + เลิกสรุปรายวัน

### 2.1 Schema + migration + seed

- `schema.prisma`: `ExpenseWeeklySummarySubscription` (ผูก `membershipId @unique`, cascade) + back-relation บน `Company`, `CompanyMembership`
- migration `2026102X000000_expense_weekly_summary_subscription`: CREATE TABLE/FK/index + data steps รายวัน (rule → DISABLED, event OPEN → RESOLVED, delivery QUEUED/FAILED → SUPPRESSED `TRIGGER_RETIRED`) — idempotent
- `seed.ts`: ลบ `daily_owner_summary` จาก `DEFAULT_RULES` (`:2795-2806`); เพิ่ม subscription ของเจ้าของร้าน seed (upsert ตาม membershipId)
- verify: `pnpm --filter @watchdog-bms/api prisma:validate`; `prisma migrate deploy` กับ docker Postgres (:15432); `prisma generate` ใหม่ใน worktree; รัน migration สองครั้งไม่ error

### 2.2 Contracts

- `packages/contracts/src/dashboard.ts`: DTO/Row/Audience/Card ตาม spec §7
- verify: `pnpm --filter @watchdog-bms/contracts build`

### 2.3 เลิกสรุปรายวันจริง (F10)

- `notification.model.ts`: ลบ `daily_owner_summary` จาก `IMPLEMENTED_TRIGGER_KEYS` (`:136`); เพิ่ม `RETIRED_TRIGGER_KEYS`
- `notification.use-cases.ts`: `CreateDailyOwnerSummaryUseCase.execute` คืน `{ skipped: true, reason: 'retired' }` ทันที (ไม่ generate snapshot); `ListRulesUseCase` กรอง retired; `UpdateRuleUseCase` ปฏิเสธ retired (400 ข้อความไทย `กฎนี้เลิกใช้แล้ว`)
- tests: `internal.controller.spec.ts` (route `:128-139` ไม่สร้าง event), `notification-preference.use-case.spec.ts` (list/update), `process-due-deliveries.use-case.spec.ts` (delivery รายวันที่ค้างไม่ส่ง)
- verify: api typecheck (สคริปต์มี heap flag — อ่าน exit code จริง) + focused specs (เขียน path เต็มทีละไฟล์)

### 2.4 API สมัคร/ยกเลิก

- ใหม่ `application/use-cases/expense-weekly-summary-subscription.use-case.ts`: `get/subscribe/unsubscribe` ผูก membership ของ `ctx`; `lineLinked` query แบบ `notification.use-cases.ts:387-390`; `lineChannelOn` จาก preference (ไม่มีแถว = `DEFAULT_ENABLED_CHANNELS`); `nextCheckDate` จาก pure helper (วางใน `expense-weekly-summary.logic.ts` ตั้งแต่ขั้นนี้); `unsubscribe` resolve event สรุป OPEN ของ membership (`updateMany` triggerKey/sourceId/status) ใน transaction เดียวกับการลบแถว; audit LOW
- ใหม่ `presentation/http/expense-weekly-summary.controller.ts` (GET/PUT/DELETE ตาม spec §7) + ลงทะเบียนใน `dashboard-notifications.module.ts`; DELETE ล็อกแถว membership `FOR UPDATE` ก่อนลบแถวและ resolve event (ลำดับเดียวกับด่านส่ง)
- `auth/presentation/auth.guard.ts` สำหรับ GET/DELETE `/v1/companies/:id/expense-weekly-summary/me` เท่านั้น (PUT ไม่ได้): (ก) เพิ่มในข้อยกเว้นด่านวันหมดอายุ (`isTermExpiryExempt` `:107-110`, ด่าน `:294-305`); (ข) `isExpenseWeeklySummaryRecoveryRoute` ต่อเข้า `allowTermRecovery` (`:245`, pattern `:68-72`); (ค) บริบทแคบที่ไม่ผ่าน resolver เมื่อสาขาที่เลือกถูกปิดหมด (`prisma-permission-resolver.repository.ts:108-109`) — use case ตรวจแค่ session user + membership มีอยู่ (ผล M6, M7)
- test: `src/modules/auth/auth.guard.spec.ts` (อยู่ใน list แล้ว) — หมดอายุก่อนระงับ / หลังระงับ / สาขาที่เลือกถูกปิดหมด: GET/DELETE ผ่าน; PUT ถูกปฏิเสธ; path อื่นไม่ได้ตาม (spec AC28)
- tests: `notification-preference.use-case.spec.ts` (403/DELETE เสมอ/resolve/audit); PG ใน `dashboard-notification-correctness.spec.ts` (unique, cascade)
- verify: focused specs + PG block (`NOTIFICATION_TEST_DATABASE_URL`)

### 2.5 การรวมบัญชี (F11)

- `auth/application/use-cases/account-merge.use-case.ts` บล็อก `close_duplicate` (`:206-213`): ย้าย subscription ไป membership ที่เหลือ หรือลบถ้ามีแล้ว (ใน `tx` เดิม); กรณี move ไม่ต้องแก้
- `account-merge.use-case.ts` หลังย้าย membership (`:216-219`): `notificationRecipient.updateMany({ where: { userId: <ผู้ถูกรวม>, event: { triggerKey: 'expense.weekly_summary', sourceId: { in: movedMembershipIds } } }, data: { userId: row.existingUserId } })` ใน tx เดิม; บล็อก `close_duplicate` (`:206-213`): event สรุป OPEN ของ membership ที่ถูกปิด → resolve ถ้า membership ที่เหลือมี event สัปดาห์เดียวกันแล้ว, ไม่งั้นย้ายผู้รับ (spec §6)
- test: `src/modules/auth/application/use-cases/account-merge.use-case.spec.ts` (อยู่ใน list แล้ว) — close_duplicate ย้าย / ลบเมื่อมีแล้ว / move ไม่แตะ subscription; ผู้รับของสรุปที่รอส่งย้ายไปบัญชีที่เหลือ
- verify: focused spec

### 2.6 การ์ด "บัญชีของฉัน"

- `dashboard-notifications.api.ts`: 3 client fn
- ใหม่ `apps/web/src/features/company-profile/WeeklySummaryCard.tsx` + pure `weeklySummaryCardCopy(dto)` ใน `company-profile.logic.ts` (5 สถานะ spec §10.3; toast แบบมีเงื่อนไข "จะดูให้…และส่งถ้ามีเรื่องให้สรุป")
- `CompanyProfilePage.tsx` `#account` (`:523`): render หลังการ์ดรหัสผ่าน เมื่อ `eligible || subscribed`
- `company-profile.logic.ts:68`: เพิ่ม `weekly-summary` ใน `COMPANY_PROFILE_SECTION_IDS` → section `account`; `CompanyProfilePage.tsx` effect `:171-191`: เลื่อนไป `#weekly-summary` เมื่อการ์ดโหลดเสร็จ (เรียกจาก `WeeklySummaryCard` หลัง GET สำเร็จ ถ้า hash ตรง) ทั้ง cold และ `hashchange`
- tests: `company-profile.logic.spec.ts` (`sectionIdFromHash('#weekly-summary')`), `CompanyProfilePage.qa.spec.ts` (ไม่มีคำรับประกันวันส่ง, ปุ่ม class เดียวกับการ์ดข้างเคียง, เลื่อนหลังโหลดแบบ cold และ hashchange)
- verify: web typecheck + specs; browser **390 / 1280 / 1556** — วัดปุ่มเทียบการ์ด "รหัสผ่านสำรอง", กดเริ่ม → หยุด → เริ่มซ้ำเร็ว ๆ (ทางผิด)

### 2.7 (รอ Q2) บรรทัดชวนบนหน้าแรก

- `DashboardPages.tsx` ใต้ `ExpenseMonthsCard` (`:322`): Notice หนึ่งบรรทัด + `รับสรุป`/`ไม่ต้อง` ขนาดเท่ากัน; "ไม่ต้อง" จำใน `localStorage` (try/catch); ซ่อนเมื่อ subscribed
- verify: `DashboardPages.rendered.spec.ts` + browser 390/1280

---

## Phase 3 — คำนวณสรุป + sweep + ด่านส่ง + การ์ด LINE

### 3.1 Pure logic

- ใหม่ `domain/logic/expense-weekly-summary.logic.ts`: `weekWindow`, `nextCheckDate`, ค่าคงที่ (spec §5.2–5.6 รวม `WEEKLY_SUMMARY_RETENTION_MONTHS=13`, `RD_EFILING_8_DAY_EXTENSION_LAST_STATUTORY_DUE='2027-01-31'`), `scopeKey(scopes)`, `buildWeeklySummaryCard(facts)` (null = เงียบ; ทุกถ้อยคำมาจากที่นี่ที่เดียว), `taxReminderRows`, `buildExpenseWeeklySummaryLineMessage`, `weeklySummaryBellText`
- `data-model-core/domain/logic/company-vat-registration.logic.ts`: pure `registeredDuringMonth(facts, monthStart, nextMonthStart)` ใช้ `live()` เดียวกับ `effectiveVatStatus` (`:80-97`)
- `reimbursements/domain/logic/reimbursement.logic.ts`: pure `claimPayableSince(request, lastVoidAt)` ย้ายจาก `workflow-scan-candidates.use-case.ts:216-220`; scan เรียกฟังก์ชันนี้แทน (พฤติกรรมเดิม)
- `tax/domain/logic/` (ไฟล์ logic ของ tax ที่มีอยู่): pure `withholdingFormType(payeeKind, juristicKind, categoryFilingRoute)` ย้ายจาก `sync-tax-events.use-case.ts:60-77` (ส่วนตัดสินแบบ ไม่รวมการเขียน review issue) และให้ `withholdingForm` เรียกใช้ — พฤติกรรมเดิม
- tests: `notification.logic.spec.ts` — **fixture spec §10.1 → การ์ดตรงทุกแถว** และกรณีตามตาราง §10.5 ทุกแถว (รวม `เท่ากัน` ผ่าน, "2 เท่า" ไม่ผ่าน, สกุลเงินอื่น, PND2/ไม่รู้ประเภท/ยื่นแล้วบางแบบ); `registeredDuringMonth` 3 กรณี; `workflow-scan.use-case.spec.ts` และ `sync-tax-events-wht-form.use-case.spec.ts` ผ่านเหมือนเดิม
- verify: focused specs

### 3.2 Provider queries

- `expense-summary.provider.ts`: `collectWeeklyDigest({ companyId, scopes, canPayClaims, companyWide, weekStart, weekEnd, asOf })`; query ยอดและนับใบใช้ `branchScopeWhere(scopes)` (`branch.logic.ts:80-83`) **ยกเว้น** query ประวัติ "เคยมีมาก่อน" ของ A2 ซึ่งต้องทั้งร้านไม่กรองสาขา (spec §5.2); ยอดเงินทุกตัวกรอง `upper(currency)='THB'` + นับใบสกุลอื่น (spec §5.1)
  - totals 10 สัปดาห์ + วันรายจ่ายยืนยันแรก (หนึ่ง `$queryRaw`)
  - หมวด: `expenseLine.groupBy` แบบ `income-expense-ledger.use-case.ts:161-165`
  - รอตรวจ/ค้างจ่าย: เงื่อนไขเดียวกับ `collectMetrics` (`:75-81`) — แยก helper ภายใน ไม่คัดลอก
  - A2: กุญแจ `cp:`/`tax:` ตาม spec §5.2 ทั้งสัปดาห์และ `NOT EXISTS` ก่อน `weekStart` (join `AccountingCounterparty.taxId`)
  - A3: count
  - A4 (เมื่อ `canPayClaims`): `PrismaReimbursementRepository.listRequests({ statuses: ['READY_FOR_PAYMENT','PARTIALLY_PAID'], withDuplicateCandidates: true })` + `findPolicy` (pattern `workflow-scan-candidates.use-case.ts:192-203`) + void ล่าสุด (query แบบ `prisma-workflow.repository.ts:211-220`) → `claimPayableSince` + `claimPaymentDuplicateBlock !== 'CONFIRMED'`
  - ภาษี (เมื่อ `companyWide`): `ExpenseSourceAdapter.findConfirmedWithWhtByCompany` (ลงทะเบียน adapter เป็น provider ของ dashboard-notifications — constructor รับแค่ `PrismaService` `expense-source.adapter.ts:12-13`; ไม่ import TaxModule) → วันจ่ายในเดือนภาษี → `withholdingFormType` → แปลงแถว adapter เป็น `{ sourceType: 'expense.record', sourceId: row.id, sourceLineKey: row.sourceLineKey }` (`source-reader.port.ts:74`, `withholding-filing-state.ts:73`) → `withholdingPaperPayments(mapped, WhtFiling FILED + WhtFilingLine ของแบบ+งวด)` → ถ้ามี paper `rowsCertain=false` หรือบรรทัดไม่มี payment key ของเอกสารในเดือนนั้น ไม่ขึ้นแถวแบบนั้น (spec §5.3, AC27) (`withholding-filing-state.ts:73-76`) → แถวต่อแบบที่เหลือ; **ไม่ใช้สถานะ `TaxPeriod`**; `companyVatRegistrationFact` (select แบบ `company-vat-registration.use-case.ts:223-226`) → `registeredDuringMonth`
- tests: `expense-summary.provider.spec.ts` (fake prisma: scope ทุก query ยอด, query ประวัติ A2 **ไม่มี** scope, currency THB, flags ปิดไม่ query); PG ใน `dashboard-notification-correctness.spec.ts` (fixture ตัวเลข; สาขา 100 + ส่วนกลาง 200 = 300 เท่ากับ ledger summary หลังแก้ B8; ผู้ขายเคยใช้ที่สาขา B ไม่ "ใหม่" สำหรับผู้รับสาขา A; A2 สองทิศ; A4 void วันนี้; A4 ครบ 7 วันพอดีไม่ขึ้น / 7 วัน 1 นาทีขึ้น; สัปดาห์มีแต่ USD ไม่เงียบ; WHT ยังไม่ยืนยันวัน; WHT paper `rowsCertain=false` หรือบรรทัดไม่มี key → ไม่มีแถว; PND2/ไม่รู้ประเภท/PND53 ยื่นแล้วแต่ PND3 ค้าง/รายการจ่ายมาหลังยื่น; USD+THB)
- verify: focused specs + PG block

### 3.3 Create-event + supersession (F2, F3)

- `notification.use-cases.ts` `execute`: รับ `payloadJson?` (แทน `{}` ที่ `:257`), `onlyIfAbsent?` (คืน `skipped:'exists'` เมื่อพบ dedupKey สถานะใดก็ได้), `supersedeBy?: 'record' | 'source'` ส่งต่อให้ `resolveEarlier`
- `prisma-notification.repository.ts` `resolveEarlier` (`:188-201`): option `matchBy`; `source` = `sourceModule/sourceType/sourceId` + `createdAt < event.createdAt`; ค่าเดิม `record` ไม่เปลี่ยนพฤติกรรม
- tests: PG — สอง subscriber ไม่ปิดกัน; สัปดาห์ใหม่ปิดเฉพาะของคนเดิม; สอง sweep พร้อมกันผ่าน `executeInTransaction` → 1 event 2 deliveries; ผู้เรียกเดิมที่ใช้ `supersedeEarlier` (หาด้วย grep `supersedeEarlier: true`) ผ่าน spec เดิม
- verify: focused + PG

### 3.4 Sweep + internal route + purge

- `notification-sweeps.use-cases.ts`: `CreateWeeklyExpenseSummariesSweepUseCase` ตาม spec §7 ข้อ 1–5 (วนตาม id ของ subscription; per-subscriber `prisma.$transaction(tx => …)` ที่ล็อกแถว subscription + membership `FOR SHARE` อ่าน `membershipId/userId/status` ใหม่ แล้วจึง `createEvent.executeInTransaction({...}, tx)` — กัน race กับการรวมบัญชี spec §6); **purge แยกจาก loop และทำเสมอ**: ลบ event สรุปอายุ > 13 เดือนของทุกบริษัท (ไม่ขึ้นกับผู้สมัครหรือสถานะบริษัท) ทีละ batch ≤ 1,000 จนหมด แม้ loop มี failure
- test purge (PG): บริษัทที่ยังมีผู้สมัคร / ไม่มีผู้สมัครแล้ว / ถูกระงับ → ลบทั้งสาม
- `feature-launch/domain/shadow-surface.catalog.ts`: surface ตาม pattern daily (`:110,146,152`) ถ้า catalog test บังคับ
- `internal.controller.ts`: `POST weekly-expense-summary-sweep` (pattern `:55-60`)
- `dashboard-notifications.module.ts`: import `AccessControlModule` (export `access-control.module.ts:35`); ไม่ import `DataModelCoreModule` (provider อ่าน fact ตรง); ใช้ `PrismaReimbursementRepository` แบบที่ workflow ทำ (`workflow-scan-candidates.use-case.ts:2`) — repo ไม่มี `forwardRef` ที่ใดเลย ถ้าเกิด cycle ให้หยุดและบันทึก
- tests: `internal.controller.spec.ts`; PG (สมาชิกถูกปิดไม่สร้าง; purge)
- verify: api typecheck + `pnpm --filter @watchdog-bms/api test:boot` + focused + PG

### 3.5 ด่านส่ง + การมองเห็นในกระดิ่ง (F1)

- ต้องปิดก่อน: spec §16.1 M1 (ผู้เขียนสิทธิ์ทุกตัวล็อก `Company`/advisory ตามลำดับ) และ M2 (อ่านสิทธิ์ใน tx ได้)
- `ProcessQueuedDeliveryUseCase.pushClaimedNonCustomerLineNotification` (`:485-582`): สำหรับ triggerKey สรุป ทำตาม spec §8 ข้อ 2 a–e **ครบทุกขั้น ไม่มีทางลัด**: advisory shared (`:498`) → `Company FOR SHARE` (ใหม่ ก่อน `:506`) → membership `FOR UPDATE` (`:506-513`) → อ่าน subscription + สิทธิ์ปัจจุบันใน tx → ไม่ตรง `SUPPRESSED` `SUMMARY_AUDIENCE_CHANGED` / ตรง `buildExpenseWeeklySummaryLineMessage` แล้วยิงใน tx เดิม
- `ListNotificationsUseCase` + `GetUnreadCountUseCase` (`:34-53`) และ repository `list`/`countUnread` (`prisma-notification.repository.ts:130,241`): ตัวกรองก่อนแบ่งหน้า (ไม่มี `expense.read` → ตัด trigger สรุป; มี → JSON path `payloadJson.card.audience.scopeKey = ปัจจุบัน` และสิทธิ์ไม่กว้างกว่าปัจจุบัน)
- `notification.model.ts`: key ใหม่ใน IMPLEMENTED / ALWAYS_DELIVERED / FEATURE_KEYS
- tests: `process-due-deliveries.use-case.spec.ts` (4 กรณีเปลี่ยนสิทธิ์ + unsubscribe + ปกติ; ลำดับคำสั่งล็อกถูกเรียกครบ); PG กระดิ่ง/unread; **PG interleaving** ใน `dashboard-notification-correctness.spec.ts` ตาม spec §14 (i)–(iv) ด้วยสอง connection และ stub push ที่รอ latch
- verify: focused + PG

### 3.6 Worker

- `notification-jobs.ts`: kind + `WEEKLY_EXPENSE_SUMMARY_CRON = { pattern: '0 8 * * 1', tz: 'Asia/Bangkok' } as const`
- `notification-worker.ts`: repeatable `notifications-weekly-expense-summary-sweep` attempts 5 exponential 60s + case
- test: `notification-jobs.spec.ts`
- verify: `pnpm --filter @watchdog-bms/workers typecheck` + `pnpm --filter @watchdog-bms/workers test`

### 3.7 list `view=duplicates`

- `ExpensesPages.tsx` (`:2691-2692,2780`) + web api client → `duplicateStatus=POSSIBLE_DUPLICATE` (API รับอยู่ `expense.controller.ts:194,213`)
- test: `expense-list-navigation.logic.spec.ts`; browser 390/1280

### 3.8 ตรวจของจริงบนเครื่อง

- local stack + LINE fake harness (memory "Local LINE fake harness"): สอง subscriber (ไม่จำกัด + จำกัดสาขา), fixture spec §10.1 ตั้งเวลา `now` = 2 พ.ย. 2569 08:00 → เรียก internal sweep สองครั้งพร้อมกัน → drain → Flex ที่ fake รับ = spec §10.1, ไม่มีแถวใน AI usage ledger; ถอด `expense.read` คนหนึ่งก่อน drain → ไม่ส่ง
- เปิด URL ทุกปุ่มที่ 390 และ 1280

---

## Phase 4 — คู่มือ ปล่อยจริง ปิดเอกสาร

### 4.1 คู่มือเว็บ
- `apps/web/src/features/user-guide/getting-started-guide.content.ts` กลุ่ม `notifications` "รับสรุปรายจ่ายทาง LINE" — ไฟล์อยู่ใน W00 hash (`line-ai-capability-manifest.ts:160`) → `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1` + `node scripts/run-line-ai-whole-chain-acceptance.mjs`

### 4.2 คำตอบวิธีใช้ของน้องมั่งมี (follow-up)
- ร่างใน `apps/ai-gateway/src/modules/line-ai/agents/product-help-draft-cards.ts` เข้ารอบอนุมัติ pack ปกติ

### 4.3 ก่อน deploy (รอ Q5)
- ยืนยันแพ็กเกจ OA `@695ultfm`; งบตาม 5 ข้อความต่อ membership ที่สมัคร ในเดือนที่มีจันทร์ 5 วัน (คนเดียวสมัครสองร้าน = 10) + แจ้งเตือนอื่น
- runbook: เตือนอัปเดต `RD_EFILING_8_DAY_EXTENSION_LAST_STATUTORY_DUE` ก่อน ม.ค. 2570
- deploy ตาม `docs/runbooks/uat-production-v2-deployment.md`

### 4.4 ปิดเอกสาร
- memory: ผลตรวจจริงทุกขั้น + ภาพ/ค่าที่วัด 390/1280/1556 + สิ่งที่ไม่ได้รัน
- follow-up แยก: B3, B5, B7, G3, G7

## การตัดสินใจที่ล็อกแล้ว

1. Opt-in ต่อ membership (ตารางใหม่) — การรวมบัญชีพาไปเอง (และย้ายผู้รับของสรุปที่รอส่ง); ไม่ใช้ `NotificationPreference`; เพดานและงบนับต่อ membership ที่สมัคร
2. 0 AI call; ปุ่ม LINE เป็น URI ล้วน ไม่แตะ webhook
3. ฐาน = CONFIRMED ตามวันที่รายจ่าย หมวดระดับบรรทัด ขอบเขต `branchScopeWhere` (รวมส่วนกลาง) เท่าหน้ารายจ่ายตามหมวด; เงินเป็นบาทล้วน (B8 แก้พร้อมกัน); ประวัติ A2 ทั้งร้าน
4. ตรวจสิทธิ์สามจุด: ตอนสร้าง ตอนส่ง (ใต้ล็อก advisory → Company → membership ไม่มีทางลัด) ตอนแสดงในกระดิ่ง; ยกเลิกได้แม้แพ็กหมดอายุ
4a. ภาษี: อ่านด้วย adapter ของ ภ.ง.ด. + จัดแบบ + ความครอบคลุมรายรายการ ไม่ใช้สถานะงวด
5. สร้าง event ผ่าน `executeInTransaction` + `onlyIfAbsent`; supersede ตาม source ของ membership ไม่ใช่ลิงก์
6. ไม่มี %, อันดับ, เท่า; วันภาษีใช้ "ภายใน" + วันฐาน; ไม่รับประกันวันส่ง
7. เลิก `daily_owner_summary` ทุกทาง (inert + retired key + migration) แต่คง cron
8. ไม่เปิดหน้าตั้งค่าการแจ้งเตือนให้แพ็กที่ขาย; ทางออกคือ "หยุดรับสรุป"
