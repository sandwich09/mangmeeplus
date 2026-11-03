# Proactive Expense Summary Plan

Status: DRAFT — documents only; sold ceiling and traceability revised 2026-10-26; owner Q1–Q5/Q7 and remaining engineering proof open; Q6 removed (ceiling); Re-anchored to develop e7c422802 on 2026-11-04; controller accepted 2026-11-04 (R19 paid-only eligibility checked against free-expense-access.ts and BILLING_PAID_TIERS)
Owner: Expenses / Notifications lane
Spec: `docs/specs/proactive-expense-summary-spec.md`
Memory: `docs/agent-memory/proactive-expense-summary.md`
Related: `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md` (ข้อ 14), `docs/guidelines/thai-ux-standard.md` §7
Baseline: develop `e7c4228026eec3c696fa76986420d2c97cb26676`, tree `1034bf4789c15b460ff2e293be912142f62954c9`, citations rechecked in this worktree 2026-11-04; original review/research dates remain historical
Scope: paid shops only under R19; free source-drafts shops receive no weekly summary, opt-in/home invitation or tax reminder; existing free routes remain unchanged.
หลักการ: ponytail full — ใช้ระบบแจ้งเตือน/การส่ง LINE/provider และหน้าที่ขายอยู่, ไม่มี dependency ใหม่, ไม่มี feature switch, 0 AI call

## Re-anchor dispositions — 2026-11-04

| Current finding / opened evidence | Plan action |
|---|---|
| `049aa51de`: never-paid source-draft access exists; expense.read survives intersection (`apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts:65–74,130–131`; `apps/api/src/modules/system-partner-management/application/free-expense-access.ts:58–83`) | Correct uniform expiry blocking; add R19 eligibility only, no free quota/source/route implementation. |
| `9036b8552`: welcome/package advisor exists (`apps/api/src/modules/external-signup/application/line-signup-notify.service.ts:402–428,453–457`) | Preserve it; no new welcome/campaign/advisor work. Optional 2.7 remains Q2-gated and paid only. |
| `1fbba874e`/`884ba5307`: activity history exists (`apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts:292–304,1207–1212`; `apps/web/src/features/expenses/ExpenseHistoryModal.tsx:77–96`) | Summary reads never save an expense/create activity; no history API/UI implementation. |
| `3f6db1729`: accepted-confirmation suppression exists (`apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:3717–3731`); `48295b57c`: picker command text survives delivery (`apps/api/src/modules/line-ai/domain/logic/line-language.logic.ts:7–14`) | Preserve both; summary is URI push and touches neither webhook/buffer nor sanitizer. Picker preservation is in the text transformer. |
| G14: daily sweep/creator lacks explicit free-cohort exclusion (`notification-sweeps.use-cases.ts:115–121`; `notification.use-cases.ts:303–325`) | Out of scope for a separate daily free filter; keep already-approved R10 retirement, with no new daily implementation/test. |

B1–B9 and the writer/lock/anchor gaps retain current evidence; these merged features do not fix them. R16–R18, AC11/AC13/AC30, M9 and Q6 stay removed tombstones.

## R19 additions within existing steps

These paid/free clauses take precedence over older permission-only wording below. No new step, permission, route allowance, table or generic commercial-access service is added. Reuse current `isFreeExpenseDraftCompany` through the resolver and existing `BILLING_PAID_TIERS` (`packages/contracts/src/billing.ts:9`); a missing/free/unknown/inactive/expired access result is not paid eligibility.

| Existing steps / dependency | Exact implementation target and boundary | First tests / verification |
|---|---|---|
| 2.2/2.4 after 2.1/2.2 contracts | `expense-weekly-summary.logic.ts`: one local `weeklySummaryPaidEligible` over current access + active company/unexpired enabled paid term. `expense-weekly-summary-subscription.use-case.ts` get/subscribe checks before subscription/data reads. AuthGuard must keep free weekly routes closed; own expired-paid GET/DELETE recovery returns only metadata/cleanup, no facts/PUT. | `src/modules/dashboard-notifications/application/use-cases/notification-preference.use-case.spec.ts` — `R19 only current paid readers can subscribe or read weekly metadata`; `src/modules/auth/auth.guard.spec.ts` — `R19 free weekly routes stay outside recovery`; API, TYPE_API, PG as already listed |
| 2.6 and optional 2.7 after 2.4; 2.7 also Q2 | Pass existing session.freeExpenseDrafts from `apps/web/app/(workspace)/companies/[companyId]/account/page.tsx:7–9` and `apps/web/app/(workspace)/companies/[companyId]/settings/profile/page.tsx:16–21` into `CompanyProfilePage` (:72); free never mounts `WeeklySummaryCard` or calls GET. For Q2, pass the flag through dashboard page → `WorkspaceDashboardPage` → `CompanyDashboardPage`, and require positive server-paid eligibility before any invitation, including cached/loading states. No free home unlock or substitute invitation. | `apps/web/src/features/company-profile/CompanyProfilePage.qa.spec.ts` — `R19 free account hides weekly summary without an API request`; `apps/web/src/features/dashboard-notifications/DashboardPages.rendered.spec.ts` — `R19 free home never invites weekly opt-in`; WEB, TYPE_WEB, BROWSER at 390/1280/~1556 |
| 3.2/3.4 after 3.1/3.3 and subscription dependencies | `ExpenseSummaryProvider.collectWeeklyDigest` re-reads company/paid term before expense/claim/WHT reads, using the same local predicate and current resolver facts where present; no new input authority/DB port. Sweep checks before provider and again under its existing creation locks; free/stale/unknown cases skip without an event/delivery. Global purge remains independent. | `src/modules/dashboard-notifications/application/providers/expense-summary.provider.spec.ts` — `R19 free access never reaches weekly expense or WHT queries`; `src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts` — `R19 commercial eligibility is rechecked for sweep bell and delivery`; API, TYPE_API, PG |
| 3.5 after 2.4/3.3 and M1/M8 | `ProcessQueuedDeliveryUseCase` rechecks paid term/free access with its tx-bound resolver under advisory → Company → membership locks before rendering/push. `ListNotificationsUseCase`/`GetUnreadCountUseCase` deny weekly reads/counts before returning stored amounts or tax rows; no cached permission-only admission. | `src/modules/dashboard-notifications/application/use-cases/process-due-deliveries.use-case.spec.ts` — `R19 nonpaid queued summaries are suppressed before push`; same registered PG test above; API, TYPE_API, PG interleavings |
| 3.8 after 2.6/3.2–3.7 | Keep paid opt-in/read/URI/opt-out; free account and permitted expense entry plus guarded home deep link have no weekly request/card/invitation/tax row; ordinary source results, quota, welcome/advisor and history remain. No AI/export/tax-write or LINE webhook change. | `e2e/journeys/shop-menus-everyday.journey.spec.ts` — `R19 paid summary and free source-only journeys at three widths`; BROWSER 390/1280/~1556 with images/button measurements |

Run each named API first test with `pnpm --filter @watchdog-bms/api exec node --import tsx --test <relative file above>`, then `bash scripts/local-proof/tsc.sh api`; web uses `bash scripts/local-proof/tsc.sh web` and WEB notation below. No schema command is needed for R19; existing additive subscription migration still uses SCHEMA. Test free+expense.read, paid positive control, trial-only/unknown/expired, and term/access changes after collection before read/send; no new tests for unsold modules or already-built quota/delivery/history features.

## ลำดับและการพึ่งพา

```
Phase 1 (1.1–1.3) removed 2026-10-26 (ceiling)
Phase 2 (สมัคร/ยกเลิก + การ์ดบัญชีของฉัน + retire รายวัน) — อิสระ
Phase 3 (คำนวณสรุป + sweep + ด่านส่ง + การ์ด LINE) — ต้องมี 2; no dependency on removed Phase 1
Phase 4 (คู่มือ + ปล่อยจริง)                   — หลัง 3; 4.3 รอ Q5
```

รอคำตอบเจ้าของ: 2.7 (Q2), Q3 = "ทันที" ต้องเขียนสเปกเพิ่ม, 4.3 (Q5), ค่า 13 เดือนใน 3.4 (Q7), หน้าแรก B9 (spec §16.1 M4)

ต้องปิดก่อนเฟส (spec §16.1): M3 resolved (explicit API currency); M9 removed (ceiling); M6/M7 resolved by trace; implement their narrow route before 2.4 is complete; M5 ก่อน 3.2; M1, M2, M8 ก่อน 3.5

หลักฐาน UI ทุกขั้นที่แตะหน้าจอ (ตาม `docs/guidelines/thai-ux-standard.md:110-117`): เปิด browser จริงที่ **390 และ 1280** (+ ~1,556 ที่เจ้าของใช้) ด้วยข้อมูลไทย ดูภาพ, **วัด** ความสูง/กว้างปุ่มในกลุ่ม, กด journey หลักรวมทางผิดหนึ่งครั้ง, บันทึกสิ่งที่ไม่ได้ดู

---

## Phase 1 — removed 2026-10-26 (ceiling)

### 1.1 removed 2026-10-26 (ceiling) — ledger menu
No `expenses.by_category` menu, conversion or web tests.

### 1.2 removed 2026-10-26 (ceiling) — ledger page/currency/export
No ledger UI/API/contracts/export changes or tests. B2/B8 remain documented, out of scope. Summary THB filtering is independently required in 3.2 (R2).

### 1.3 removed 2026-10-26 (ceiling) — ledger journey
No ledger browser acceptance. Account opt-in and sold card destinations still require browser checks at 390, 1280 and about 1556 px under 2.6 / 3.8.

---

## Phase 2 — สมัคร/ยกเลิก + การ์ดบัญชีของฉัน + เลิกสรุปรายวัน

### 2.1 Schema + migration + seed

- `schema.prisma`: `ExpenseWeeklySummarySubscription` (ผูก `membershipId @unique`, cascade) + back-relation บน `Company`, `CompanyMembership`
- migration `2026102X000000_expense_weekly_summary_subscription`: CREATE TABLE/FK/index + data steps รายวัน (rule → DISABLED, event OPEN → RESOLVED, delivery QUEUED/FAILED → SUPPRESSED `TRIGGER_RETIRED`) — idempotent
- `seed.ts`: ลบ `daily_owner_summary` จาก `DEFAULT_RULES` (`:2795-2806`); เพิ่ม subscription **เฉพาะ fixture ที่จำลองการสมัครเอง** (upsert ตาม membershipId); production ไม่สมัครให้เจ้าของร้านอัตโนมัติ
- verify: `pnpm --filter @watchdog-bms/api exec prisma validate --schema prisma/schema.prisma`; additive `prisma migrate deploy` กับ isolated local Postgres (:15432); `pnpm --filter @watchdog-bms/api exec prisma generate --schema prisma/schema.prisma`; รัน migration สองครั้งไม่ error

### 2.2 Contracts

- `packages/contracts/src/dashboard.ts`: DTO/Row/Audience/Card ตาม spec §7; eligible = R19 current paid eligibility AND expense.read
- verify: `pnpm --filter @watchdog-bms/contracts build`

### 2.3 เลิกสรุปรายวันจริง (F10)

- `notification.model.ts`: ลบ `daily_owner_summary` จาก `IMPLEMENTED_TRIGGER_KEYS` (`:136`); เพิ่ม `RETIRED_TRIGGER_KEYS`
- `notification.use-cases.ts`: `CreateDailyOwnerSummaryUseCase.execute` คืน `{ skipped: true, reason: 'retired' }` ทันที (ไม่ generate snapshot); `ListRulesUseCase` กรอง retired; `UpdateRuleUseCase` ปฏิเสธ retired (400 ข้อความไทย `กฎนี้เลิกใช้แล้ว`)
- tests: `internal.controller.spec.ts` (route `:128-139` ไม่สร้าง event), `notification-preference.use-case.spec.ts` (list/update), `process-due-deliveries.use-case.spec.ts` (delivery รายวันที่ค้างไม่ส่ง)
- verify: `bash scripts/local-proof/tsc.sh api` (สคริปต์มี heap flag — อ่าน exit code จริง) + focused specs (เขียน path เต็มทีละไฟล์)

### 2.4 API สมัคร/ยกเลิก

- ใหม่ `application/use-cases/expense-weekly-summary-subscription.use-case.ts`: `get/subscribe/unsubscribe` ผูก membership ของ `ctx`; `lineLinked` query แบบ `notification.use-cases.ts:387-390`; `lineChannelOn` จาก preference (ไม่มีแถว = `DEFAULT_ENABLED_CHANNELS`); `nextCheckDate` จาก pure helper (วางใน `expense-weekly-summary.logic.ts` ตั้งแต่ขั้นนี้); `unsubscribe` resolve event สรุป OPEN ของ membership (`updateMany` triggerKey/sourceId/status) ใน transaction เดียวกับการลบแถว; audit LOW
- ใหม่ `presentation/http/expense-weekly-summary.controller.ts` (GET/PUT/DELETE ตาม spec §7) + ลงทะเบียนใน `dashboard-notifications.module.ts`; DELETE ล็อกแถว membership `FOR UPDATE` ก่อนลบแถวและ resolve event (ลำดับเดียวกับด่านส่ง)
- `auth/presentation/auth.guard.ts` สำหรับ GET/DELETE `/v1/companies/:id/expense-weekly-summary/me` เท่านั้น (PUT ไม่ได้): (ก) เพิ่มในข้อยกเว้นด่านวันหมดอายุ (`isTermExpiryExempt` `:108-111`, ด่าน `:295-309`); (ข) `isExpenseWeeklySummaryRecoveryRoute` ต่อเข้า `allowTermRecovery` (`:246`, pattern `:69-73`); (ค) บริบทแคบที่ไม่ผ่าน resolver เมื่อสาขาที่เลือกถูกปิดหมด (`prisma-permission-resolver.repository.ts:111-112`) — use case ตรวจแค่ session user + membership มีอยู่ (ผล M6, M7)
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
- `CompanyProfilePage.tsx` `#account` (`:523`): free session does not mount/request this card; paid/recovery session renders หลังการ์ดรหัสผ่าน เมื่อ `eligible || subscribed`
- `company-profile.logic.ts:68`: เพิ่ม `weekly-summary` ใน `COMPANY_PROFILE_SECTION_IDS` → section `account`; `CompanyProfilePage.tsx` effect `:171-191`: เลื่อนไป `#weekly-summary` เมื่อการ์ดโหลดเสร็จ (เรียกจาก `WeeklySummaryCard` หลัง GET สำเร็จ ถ้า hash ตรง) ทั้ง cold และ `hashchange`
- tests: `company-profile.logic.spec.ts` (`sectionIdFromHash('#weekly-summary')`), `CompanyProfilePage.qa.spec.ts` (ไม่มีคำรับประกันวันส่ง, ปุ่ม class เดียวกับการ์ดข้างเคียง, เลื่อนหลังโหลดแบบ cold และ hashchange)
- verify: `bash scripts/local-proof/tsc.sh web` + specs; browser **390 / 1280 / 1556** — วัดปุ่มเทียบการ์ด "รหัสผ่านสำรอง", กดเริ่ม → หยุด → เริ่มซ้ำเร็ว ๆ (ทางผิด)

### 2.7 (รอ Q2) บรรทัดชวนบนหน้าแรก

- `DashboardPages.tsx` ใต้ `ExpenseMonthsCard` (`:322`): Notice หนึ่งบรรทัด + `รับสรุป`/`ไม่ต้อง` ขนาดเท่ากัน; "ไม่ต้อง" จำใน `localStorage` (try/catch); ซ่อนเมื่อ subscribed
- verify: `DashboardPages.rendered.spec.ts` + browser 390/1280

---

## Phase 3 — คำนวณสรุป + sweep + ด่านส่ง + การ์ด LINE

### 3.1 Pure logic

- ใหม่ `domain/logic/expense-weekly-summary.logic.ts`: `weekWindow`, `nextCheckDate`, ค่าคงที่ (spec §5.2–5.6 รวม `WEEKLY_SUMMARY_RETENTION_MONTHS=13`, `RD_EFILING_8_DAY_EXTENSION_LAST_STATUTORY_DUE='2027-01-31'`), `scopeKey(scopes)`, `buildWeeklySummaryCard(facts)` (null = เงียบ; ทุกถ้อยคำมาจากที่นี่ที่เดียว), `taxReminderRows`, `buildExpenseWeeklySummaryLineMessage`, `weeklySummaryBellText`
- `reimbursements/domain/logic/reimbursement.logic.ts`: pure `claimPayableSince(request, lastVoidAt)` ย้ายจาก `workflow-scan-candidates.use-case.ts:216-220`; scan เรียกฟังก์ชันนี้แทน (พฤติกรรมเดิม)
- `tax/domain/logic/` (ไฟล์ logic ของ tax ที่มีอยู่): pure `withholdingFormType(payeeKind, juristicKind, categoryFilingRoute)` ย้ายจาก `sync-tax-events.use-case.ts:60-77` (ส่วนตัดสินแบบ ไม่รวมการเขียน review issue) และให้ `withholdingForm` เรียกใช้ — พฤติกรรมเดิม
- tests: `notification.logic.spec.ts` — **fixture spec §10.1 → การ์ดตรงทุกแถว** และกรณีตามตาราง §10.5 ทุกแถว (รวม `เท่ากัน` ผ่าน, "2 เท่า" ไม่ผ่าน, สกุลเงินอื่น, PND2/ไม่รู้ประเภท/ยื่นแล้วบางแบบ); `workflow-scan.use-case.spec.ts` และ `sync-tax-events-wht-form.use-case.spec.ts` ผ่านเหมือนเดิม
- verify: focused specs

### 3.2 Provider queries

- `expense-summary.provider.ts`: `collectWeeklyDigest({ companyId, scopes, canPayClaims, companyWide, weekStart, weekEnd, asOf })`; query ยอดและนับใบใช้ `branchScopeWhere(scopes)` (`branch.logic.ts:80-83`) **ยกเว้น** query ประวัติ "เคยมีมาก่อน" ของ A2 ซึ่งต้องทั้งร้านไม่กรองสาขา (spec §5.2); ยอดเงินทุกตัวกรอง `upper(currency)='THB'` + นับใบสกุลอื่น (spec §5.1)
  - totals 10 สัปดาห์ + วันรายจ่ายยืนยันแรก (หนึ่ง `$queryRaw`)
  - หมวด: `expenseLine.groupBy` แบบ `income-expense-ledger.use-case.ts:161-165`
  - รอตรวจ/ค้างจ่าย: เงื่อนไขเดียวกับ `collectMetrics` (`:75-81`) — แยก helper ภายใน ไม่คัดลอก
  - A2: กุญแจ `cp:`/`tax:` ตาม spec §5.2 ทั้งสัปดาห์และ `NOT EXISTS` ก่อน `weekStart` (join `AccountingCounterparty.taxId`)
  - A3: count
  - A4 (เมื่อ `canPayClaims`): `PrismaReimbursementRepository.listRequests({ statuses: ['READY_FOR_PAYMENT','PARTIALLY_PAID'], withDuplicateCandidates: true })` + `findPolicy` (pattern `workflow-scan-candidates.use-case.ts:192-203`) + void ล่าสุด (query แบบ `prisma-workflow.repository.ts:211-220`) → `claimPayableSince` + `claimPaymentDuplicateBlock !== 'CONFIRMED'`
  - ภาษี (เมื่อ `companyWide`): `ExpenseSourceAdapter.findConfirmedWithWhtByCompany` (ลงทะเบียน adapter เป็น provider ของ dashboard-notifications — constructor รับแค่ `PrismaService` `expense-source.adapter.ts:12-13`; ไม่ import TaxModule) → exclude explicit `whtRemittance=E_WHT` once e-WHT plan 2.1 adds that source field (absent/null legacy rows remain ordinary) → วันจ่ายในเดือนภาษี → `withholdingFormType` → แปลงแถว adapter เป็น `{ sourceType: 'expense.record', sourceId: row.id, sourceLineKey: row.sourceLineKey }` (`source-reader.port.ts:74`, `withholding-filing-state.ts:73`) → `withholdingPaperPayments(mapped, WhtFiling FILED + WhtFilingLine ของแบบ+งวด)` → ถ้ามี paper `rowsCertain=false` หรือบรรทัดไม่มี payment key ของเอกสารในเดือนนั้น ไม่ขึ้นแถวแบบนั้น (spec §5.3, AC27) (`withholding-filing-state.ts:73-76`) → แถวต่อแบบที่เหลือ; **ไม่ใช้สถานะ `TaxPeriod`**; lower packs receive this information without a form button; no VAT-fact read
- tests: `expense-summary.provider.spec.ts` (fake prisma: scope ทุก query ยอด, query ประวัติ A2 **ไม่มี** scope, currency THB, flags ปิดไม่ query); PG ใน `dashboard-notification-correctness.spec.ts` (fixture ตัวเลข; สาขา 100 + ส่วนกลาง 200 = 300 ตาม `branchScopeWhere`; no ledger comparison; ผู้ขายเคยใช้ที่สาขา B ไม่ "ใหม่" สำหรับผู้รับสาขา A; A2 สองทิศ; A4 void วันนี้; A4 ครบ 7 วันพอดีไม่ขึ้น / 7 วัน 1 นาทีขึ้น; สัปดาห์มีแต่ USD ไม่เงียบ; explicit E_WHT never produces a payer reminder; WHT ยังไม่ยืนยันวัน; WHT paper `rowsCertain=false` หรือบรรทัดไม่มี key → ไม่มีแถว; PND2/ไม่รู้ประเภท/PND53 ยื่นแล้วแต่ PND3 ค้าง/รายการจ่ายมาหลังยื่น; USD+THB)
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
- `dashboard-notifications.module.ts`: import `AccessControlModule` (export `access-control.module.ts:35`); ไม่ import `DataModelCoreModule` (ไม่มี VAT-fact read); ใช้ `PrismaReimbursementRepository` แบบที่ workflow ทำ (`workflow-scan-candidates.use-case.ts:2`) — repo ไม่มี `forwardRef` ที่ใดเลย ถ้าเกิด cycle ให้หยุดและบันทึก
- tests: `internal.controller.spec.ts`; PG (สมาชิกถูกปิดไม่สร้าง; purge)
- verify: `bash scripts/local-proof/tsc.sh api` + `pnpm --filter @watchdog-bms/api test:boot` + focused + PG

### 3.5 ด่านส่ง + การมองเห็นในกระดิ่ง (F1)

- ต้องปิดก่อน: spec §16.1 M1 (ผู้เขียนสิทธิ์ทุกตัวล็อก `Company`/advisory ตามลำดับ) และ M2 (อ่านสิทธิ์ใน tx ได้)
- `ProcessQueuedDeliveryUseCase`: construct a transaction-bound instance of existing `PrismaPermissionResolverRepository` with `{ client: tx } as PrismaService` and wrap in existing `PermissionResolverService`, following `CreateOrUpdateNotificationEventUseCase.executeInTransaction` (`notification.use-cases.ts:206–211`); all membership/entitlement/branch reads then use tx. No domain-port or resolver signature change (M2).
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

- `ExpensesPages.tsx:2704–2705,2793` + web api client → `duplicateStatus=POSSIBLE_DUPLICATE` (API รับอยู่ `expense.controller.ts:196,215`)
- test: `expense-list-navigation.logic.spec.ts`; browser 390/1280

### 3.8 ตรวจของจริงบนเครื่อง

- local stack + LINE fake harness (memory "Local LINE fake harness"): สอง subscriber (ไม่จำกัด + จำกัดสาขา), fixture spec §10.1 ตั้งเวลา `now` = 2 พ.ย. 2569 08:00 → เรียก internal sweep สองครั้งพร้อมกัน → drain → Flex ที่ fake รับ = spec §10.1, ไม่มีแถวใน AI usage ledger; ถอด `expense.read` คนหนึ่งก่อน drain → ไม่ส่ง
- เปิด URL ทุกปุ่มที่ 390, 1280 และประมาณ 1556; only sold home, pending expenses and account anchor

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
3. ฐาน = CONFIRMED ตามวันที่รายจ่าย หมวดระดับบรรทัด ขอบเขต `branchScopeWhere` (รวมส่วนกลาง) ไม่อ้างว่ายอดตรงหน้าแรก; เงินเป็นบาทล้วน (B8/B9 แยกงาน); ประวัติ A2 ทั้งร้าน
4. R19 paid eligibility before opt-in/read/send; free expense.read alone never qualifies. ตรวจสิทธิ์สามจุด: ตอนสร้าง ตอนส่ง (ใต้ล็อก advisory → Company → membership ไม่มีทางลัด) ตอนแสดงในกระดิ่ง; ยกเลิกได้แม้แพ็กหมดอายุ
4a. ภาษี: อ่านด้วย adapter ของ ภ.ง.ด. + จัดแบบ + ความครอบคลุมรายรายการ ไม่ใช้สถานะงวด
5. สร้าง event ผ่าน `executeInTransaction` + `onlyIfAbsent`; supersede ตาม source ของ membership ไม่ใช่ลิงก์
6. ไม่มี %, อันดับ, เท่า; วันภาษีใช้ "ภายใน" + วันฐาน; ไม่รับประกันวันส่ง
7. เลิก `daily_owner_summary` ทุกทาง (inert + retired key + migration) แต่คง cron
8. ไม่เปิดหน้าตั้งค่าการแจ้งเตือนให้แพ็กที่ขาย; ทางออกคือ "หยุดรับสรุป"

## Traceability

R-ids, proposed test names, evidence and acceptance rows resolve in the companion spec's Traceability table. Phase 1 and AC11/AC13/AC30 remain tombstones; no ledger or VAT work is smuggled into another step. The reminder is PND3/PND53 information only for lower packs, with no form button. APIs and LINE have no new permission key or environment feature switch.

Implementation rounds of about five steps: 2.1–2.5; 2.6 + 3.1–3.4; 3.5–3.8 + 4.1; then 4.3/4.4. Optional 2.7 waits Q2; 4.2 is a separate help-pack approval. Dependencies below take precedence; no code is changed in this documents round.

Commands: **API** = `pnpm --filter @watchdog-bms/api exec node --import tsx --test <listed file relative to apps/api>`; **TYPE_API/TYPE_WEB** = `bash scripts/local-proof/tsc.sh api` / `bash scripts/local-proof/tsc.sh web`; **WEB** = `pnpm --filter @watchdog-bms/web exec tsx --test <listed file relative to apps/web>`; **SCHEMA** = `pnpm --filter @watchdog-bms/api exec prisma validate --schema prisma/schema.prisma` then `pnpm --filter @watchdog-bms/api exec prisma generate --schema prisma/schema.prisma`. Migrations additive only, deployed to the isolated local proof DB. **PG** runs the listed registered spec with `NOTIFICATION_TEST_DATABASE_URL` set to that isolated DB; inspect that the real-PG blocks did not skip. **BROWSER** = `pnpm exec playwright test --project=journeys-mobile e2e/journeys/shop-menus-everyday.journey.spec.ts` with the new digest journey explicitly iterating 390, 1280 and approximately 1556; run the existing notification test separately for bell behavior. Do not assume a project name proves all widths.

| Step | Requirement | Dependency | Exact focused test file(s), names in spec trace | Verification |
|---|---|---|---|---|
| 1.1/1.2/1.3 | R16/R18 removed | None | None | No code or tests; removed 2026-10-26 (ceiling) |
| 2.1 | R1/R9/R10 | None | apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts | SCHEMA; API; additive migration on isolated DB twice |
| 2.2 | R1/R11/R12/R19 | 2.1 contract shape | apps/api/src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts | contracts build; TYPE_API; TYPE_WEB |
| 2.3 | R10 | 2.1 | apps/api/src/modules/dashboard-notifications/presentation/http/internal.controller.spec.ts; apps/api/src/modules/dashboard-notifications/application/use-cases/notification-preference.use-case.spec.ts | API; TYPE_API |
| 2.4 | R1/R7/R12/R19 | 2.1/2.2; guard design M6/M7 | apps/api/src/modules/dashboard-notifications/application/use-cases/notification-preference.use-case.spec.ts; apps/api/src/modules/auth/auth.guard.spec.ts; apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts | API; TYPE_API; PG |
| 2.5 | R8 | 2.1 | apps/api/src/modules/auth/application/use-cases/account-merge.use-case.spec.ts; apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts | API; TYPE_API; PG |
| 2.6 | R12/R14/R19 | 2.4 | apps/web/src/features/company-profile/company-profile.logic.spec.ts; apps/web/src/features/company-profile/CompanyProfilePage.qa.spec.ts | WEB; TYPE_WEB; browser 390/1280/~1556 |
| 2.7 (optional) | R12/R14/R19 | 2.4/2.6 + owner Q2 | apps/web/src/features/dashboard-notifications/DashboardPages.rendered.spec.ts | WEB; TYPE_WEB; browser all three widths |
| 3.1 | R2–R5/R11/R15 | 2.2 | apps/api/src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts; apps/api/src/modules/workflow/application/use-cases/workflow-scan.use-case.spec.ts; apps/api/src/modules/tax/application/use-cases/sync-tax-events-wht-form.use-case.spec.ts | API; TYPE_API |
| 3.2 | R2/R3/R4/R5/R19 | 3.1; adapter volume proof M5 | apps/api/src/modules/dashboard-notifications/application/providers/expense-summary.provider.spec.ts; apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts | API; TYPE_API; PG; no VAT/ledger tests |
| 3.3 | R6 | 2.2 | apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts | API; TYPE_API; PG |
| 3.4 | R5/R6/R8/R9/R19 | 2.4/2.5/3.2/3.3; owner Q7 retention | apps/api/src/modules/dashboard-notifications/presentation/http/internal.controller.spec.ts; apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts | API; TYPE_API; PG; existing test:boot |
| 3.5 | R7/R19 | 2.4/3.3; M1/M8 writers audited and fixed | apps/api/src/modules/dashboard-notifications/application/use-cases/process-due-deliveries.use-case.spec.ts; apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts | API; TYPE_API; PG interleaving without skipped blocks |
| 3.6 | R5 | 3.4/3.5 | apps/workers/src/modules/notifications/notification-jobs.spec.ts | workers typecheck/test; local job→API proof |
| 3.7 | R13 | Existing expense filter API | apps/web/src/features/expenses/expense-list-navigation.logic.spec.ts | WEB; TYPE_WEB; browser 390/1280/~1556 |
| 3.8 | R2/R5/R7/R11/R12/R14/R15/R19 | 2.6/3.2–3.7 | e2e/journeys/shop-menus-everyday.journey.spec.ts; e2e/notifications.spec.ts | BROWSER at 390/1280/~1556; inspect images and grouped-button dimensions |
| 4.1 | R11/R14 | 3.8 | apps/web/src/features/user-guide/user-guide.content.spec.ts | WEB; existing W00/whole-chain; no new unregistered API assertion |
| 4.2 (follow-up) | R11/R14 | Separate help-pack approval | Existing help-pack approval tests only | No new module/tool or unsolicited publication |
| 4.3 | R4/R14 | 3.8 + owner Q5 budget; legal source reconfirmed | e2e/journeys/shop-menus-everyday.journey.spec.ts | Mandatory deployment runbook; exact UAT/READY/Production ids; signed result and customer OPEN |
| 4.4 | R14/R15 | After implementation evidence | Docs evidence only | Record focused/API/PG/browser results and omissions |

Registration rechecked with `grep -c "<file>" apps/api/package.json` on 2026-11-04; no package edits, new API spec files or runtime execution.

| API test file (relative to apps/api) | grep count |
|---|---|
| `src/modules/auth/application/use-cases/account-merge.use-case.spec.ts` | 1 |
| `src/modules/auth/auth.guard.spec.ts` | 1 |
| `src/modules/dashboard-notifications/application/providers/expense-summary.provider.spec.ts` | 1 |
| `src/modules/dashboard-notifications/application/use-cases/notification-preference.use-case.spec.ts` | 1 |
| `src/modules/dashboard-notifications/application/use-cases/process-due-deliveries.use-case.spec.ts` | 1 |
| `src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts` | 1 |
| `src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts` | 1 |
| `src/modules/dashboard-notifications/presentation/http/internal.controller.spec.ts` | 1 |
| `src/modules/tax/application/use-cases/sync-tax-events-wht-form.use-case.spec.ts` | 1 |
| `src/modules/workflow/application/use-cases/workflow-scan.use-case.spec.ts` | 1 |
