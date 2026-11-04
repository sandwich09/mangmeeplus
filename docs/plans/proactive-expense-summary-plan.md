# Proactive Expense Summary Plan

Status: DRAFT — documents only; sold ceiling and traceability revised 2026-10-26; owner Q1–Q7 answered 2026-11-04; engineering proof remains; C1 closed by controller 2026-11-04; Q6 remains removed (ceiling); Re-anchored to develop e7c422802 on 2026-11-04; controller accepted 2026-11-04 (R19 paid-only eligibility checked against free-expense-access.ts and BILLING_PAID_TIERS)
Owner: Expenses / Notifications lane
Spec: `docs/specs/proactive-expense-summary-spec.md`
Memory: `docs/agent-memory/proactive-expense-summary.md`
Related: `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md` (ข้อ 14), `docs/guidelines/thai-ux-standard.md` §7
Baseline: develop `36e2dc624ff03a447a33eec721d9ef6b76296bad`, tree `88a1cbcc45afac7c05b9c2f3190b0da1f839abb3`, opened 2026-11-04; traced code unchanged from e7c422802; historical review dates retained
Scope: paid shops only under R19; free source-drafts shops receive no weekly summary, summary settings/home invitation or tax reminder; existing free routes remain unchanged.
หลักการ: ponytail full — ใช้ระบบแจ้งเตือน/การส่ง LINE/provider และหน้าที่ขายอยู่, ไม่มี dependency ใหม่, ไม่มี feature switch, 0 AI call

## Re-anchor dispositions — 2026-11-04

| Current finding / opened evidence | Plan action |
|---|---|
| `049aa51de`: never-paid source-draft access exists; expense.read survives intersection (`apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts:65–74,130–131`; `apps/api/src/modules/system-partner-management/application/free-expense-access.ts:58–83`) | Correct uniform expiry blocking; add R19 eligibility only, no free quota/source/route implementation. |
| `9036b8552`: welcome/package advisor exists (`apps/api/src/modules/external-signup/application/line-signup-notify.service.ts:402–428,453–457`) | Preserve it; no new welcome/campaign/advisor work. Home invitation 2.7 is removed by the new owner decision; no replacement home/advisor work. |
| `1fbba874e`/`884ba5307`: activity history exists (`apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts:292–304,1207–1212`; `apps/web/src/features/expenses/ExpenseHistoryModal.tsx:77–96`) | Summary reads never save an expense/create activity; no history API/UI implementation. |
| `3f6db1729`: accepted-confirmation suppression exists (`apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:3717–3731`); `48295b57c`: picker command text survives delivery (`apps/api/src/modules/line-ai/domain/logic/line-language.logic.ts:7–14`) | Preserve both; summary is URI push and touches neither webhook/buffer nor sanitizer. Picker preservation is in the text transformer. |
| G14: daily sweep/creator lacks explicit free-cohort exclusion (`notification-sweeps.use-cases.ts:115–121`; `notification.use-cases.ts:303–325`) | Out of scope for a separate daily free filter; keep already-approved R10 retirement, with no new daily implementation/test. |

B1–B9 and the writer/lock/anchor gaps retain current evidence; these merged features do not fix them. R16–R18, AC11/AC13/AC30, M9 and Q6 stay removed tombstones.

## R19 additions within existing steps

These paid/free clauses take precedence over older permission-only wording below. R19 adds no permission, route allowance, table or generic commercial-access service; round-5 day/recipient fields are independently required by R20/R21. Reuse current `isFreeExpenseDraftCompany` through the resolver and existing `BILLING_PAID_TIERS` (`packages/contracts/src/billing.ts:9`); a missing/free/unknown/inactive/expired access result is not paid eligibility.

| Existing steps / dependency | Exact implementation target and boundary | First tests / verification |
|---|---|---|
| 2.2/2.4 after 2.1/2.2 contracts | `expense-weekly-summary.logic.ts`: one local `weeklySummaryPaidEligible` over current access + active company/unexpired enabled paid term. `expense-weekly-summary-subscription.use-case.ts` get/stop and settings get/update checks before subscription/data reads. AuthGuard must keep free weekly routes closed; own expired-paid GET/DELETE recovery returns only metadata/cleanup, no facts/PUT. | `src/modules/dashboard-notifications/application/use-cases/notification-preference.use-case.spec.ts` — `R19 only paid access reaches summary metadata or settings`; `src/modules/auth/auth.guard.spec.ts` — `R19 free weekly routes stay outside recovery`; API, TYPE_API, PG as already listed |
| 2.6/5.3 after personal/settings APIs | Pass existing free flag plus 5.1 derived weeklySummaryAccess into CompanyProfilePage, SettingsMenu and new form; free mounts/requests none. Home invitation removed for all packs; no dashboard wrapper/flag additions for it. Expired paid gets personal cleanup only, not settings. | CompanyProfilePage.qa.spec.ts — `R19 free account hides weekly summary without an API request`; DashboardPages.rendered.spec.ts — `R19 free home never invites weekly opt-in`; settings-menu.logic.spec.ts — `R21 paid setup manager sees summary beside planned e-WHT`; WEB/TYPE_WEB/BROWSER all three widths |
| 3.2/3.4 after 3.1/3.3 and subscription dependencies | `ExpenseSummaryProvider.collectWeeklyDigest` re-reads company/paid term before expense/claim/WHT reads, using the same local predicate and current resolver facts where present; no new input authority/DB port. Sweep checks before provider and again under its existing creation locks; free/stale/unknown cases skip without an event/delivery. Global purge remains independent. | `src/modules/dashboard-notifications/application/providers/expense-summary.provider.spec.ts` — `R19 free access never reaches weekly expense or WHT queries`; `src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts` — `R19 commercial eligibility is rechecked for sweep bell and delivery`; API, TYPE_API, PG |
| 3.5 after 2.4/3.3 and M1/M8 | `ProcessQueuedDeliveryUseCase` rechecks paid term/free access with its tx-bound resolver under advisory → Company → membership locks before rendering/push. `ListNotificationsUseCase`/`GetUnreadCountUseCase` deny weekly reads/counts before returning stored amounts or tax rows; no cached permission-only admission. | `src/modules/dashboard-notifications/application/use-cases/process-due-deliveries.use-case.spec.ts` — `R19 nonpaid queued summaries are suppressed before push`; same registered PG test above; API, TYPE_API, PG interleavings |
| 3.8 after 2.6/3.2–3.7 | Keep paid effective-selection/read/URI/opt-out; free account and permitted expense entry plus guarded home deep link have no weekly request/card/invitation/tax row; ordinary source results, quota, welcome/advisor and history remain. No AI/export/tax-write or LINE webhook change. | `e2e/journeys/shop-menus-everyday.journey.spec.ts` — `R19 paid summary and free source-only journeys at three widths`; BROWSER 390/1280/~1556 with images/button measurements |

Run each named API first test with `pnpm --filter @watchdog-bms/api exec node --import tsx --test <relative file above>`, then `bash scripts/local-proof/tsc.sh api`; web uses `bash scripts/local-proof/tsc.sh web` and WEB notation below. No schema command is needed for R19; existing additive subscription migration still uses SCHEMA. Test free+expense.read, paid positive control, trial-only/unknown/expired, and term/access changes after collection before read/send; no new tests for unsold modules or already-built quota/delivery/history features.

## ลำดับและการพึ่งพา

Owner Q1–Q7 answered 2026-11-04 (spec §17). Owner default/personal off replace opt-in; ordinary notification preferences/rules remain closed. Keep every old step id; 2.7 becomes a tombstone. New settings/day work has its own round **after core digest**, before release:

```
1.1–1.3 removed (ceiling)
Core A: 2.1–2.5 (five items): explicit choices, contracts, daily retirement, personal stop, merge
Core B: 3.1–3.4 (four): core digest/provider/events/sweep — 2.6 moved after 5.1 (controller 2026-11-04: its R19 free check needs the 5.1 `weeklySummaryAccess` session bridge)
Core C: 3.5–3.8 (four): live gates, daily worker, sold filter, local digest proof
Round 5: 5.1, then 2.6 + 5.2–5.5: day/cursor schema and session bridge, account card, settings API, settings UI, period rule, combined proof
Release: 4.1/4.3/4.4 after 5.5; 4.2 is separate approved-help-pack follow-up
```

Core is an implementation dependency, **not an independently releasable customer slice**: no rollout of owner defaults without settings/own-stop/OA-budget proof. C1 closed by controller 2026-11-04 (§5.1/§17 of spec): continuing periods have no seven-day maximum; first/missing/older-than-31/OFF→ON starts fresh for seven days. Quiet updates cursor; ineligible leaves it intact. Steps 5.4/5.5 and release have no C1 blocker; implementation/security/browser/OA prerequisites remain. No owner question or further confirmation is needed. M4 home B9 stays a separate out-of-scope decision.

ต้องปิดก่อนเฟส (spec §16.1): M3 resolved (explicit API currency); M9 removed (ceiling); M6/M7 resolved by trace; implement their narrow route before 2.4 is complete; M5 ก่อน 3.2; M1, M2, M8 ก่อน 3.5

หลักฐาน UI ทุกขั้นที่แตะหน้าจอ (ตาม `docs/guidelines/thai-ux-standard.md:110-117`): เปิด browser จริงที่ **390 และ 1280** (+ ~1,556 ที่เจ้าของใช้) ด้วยข้อมูลไทย ดูภาพ, **วัด** ความสูง/กว้างปุ่มในกลุ่ม, กด journey หลักรวมทางผิดหนึ่งครั้ง, บันทึกสิ่งที่ไม่ได้ดู

---

## Phase 1 — removed 2026-10-26 (ceiling)

### 1.1 removed 2026-10-26 (ceiling) — ledger menu
No `expenses.by_category` menu, conversion or web tests.

### 1.2 removed 2026-10-26 (ceiling) — ledger page/currency/export
No ledger UI/API/contracts/export changes or tests. B2/B8 remain documented, out of scope. Summary THB filtering is independently required in 3.2 (R2).

### 1.3 removed 2026-10-26 (ceiling) — ledger journey
No ledger browser acceptance. Account personal stop and sold card destinations still require browser checks at 390, 1280 and about 1556 px under 2.6 / 3.8.

---

## Phase 2 — Explicit choices, personal stop and daily retirement

### 2.1 Schema + migration + seed

- `schema.prisma`: `ExpenseWeeklySummarySubscription` (membershipId unique, required explicit enabled Boolean true/false, updatedAt, cascade); missing row is active eligible OWNER on and everyone else off + back-relation บน `Company`, `CompanyMembership`
- migration `2026102X000000_expense_weekly_summary_subscription`: CREATE TABLE/FK/index + data steps รายวัน (rule → DISABLED, event OPEN → RESOLVED, delivery QUEUED/FAILED → SUPPRESSED `TRIGGER_RETIRED`) — idempotent
- `seed.ts`: remove daily rule at :2795–2806; fixture multiple eligible no-row owners, explicit owner off and explicit nonowner on. No owner-choice backfill or inserts for default enrollment in production; default is computed with active OWNER roles.
- verify: `pnpm --filter @watchdog-bms/api exec prisma validate --schema prisma/schema.prisma`; additive `prisma migrate deploy` กับ isolated local Postgres (:15432); `pnpm --filter @watchdog-bms/api exec prisma generate --schema prisma/schema.prisma`; รัน migration สองครั้งไม่ error

### 2.2 Contracts

- `packages/contracts/src/dashboard.ts`: DTO/Row/Audience/Card ตาม spec §7; eligible = R19 current paid eligibility AND expense.read for a recipient; management DTO uses R19 paid-commercial gate + company.setup.manage. Include explicitChoice/effective subscribed and live management hint/canReadBell (existing notification.read, no new grant); weekday/cursor DTO extensions in 5.1
- verify: `pnpm --filter @watchdog-bms/contracts build`

### 2.3 เลิกสรุปรายวันจริง (F10)

- `notification.model.ts`: ลบ `daily_owner_summary` จาก `IMPLEMENTED_TRIGGER_KEYS` (`:136`); เพิ่ม `RETIRED_TRIGGER_KEYS`
- `notification.use-cases.ts`: `CreateDailyOwnerSummaryUseCase.execute` คืน `{ skipped: true, reason: 'retired' }` ทันที (ไม่ generate snapshot); `ListRulesUseCase` กรอง retired; `UpdateRuleUseCase` ปฏิเสธ retired (400 ข้อความไทย `กฎนี้เลิกใช้แล้ว`)
- tests: `internal.controller.spec.ts` (route `:128-139` ไม่สร้าง event), `notification-preference.use-case.spec.ts` (list/update), `process-due-deliveries.use-case.spec.ts` (delivery รายวันที่ค้างไม่ส่ง)
- verify: `bash scripts/local-proof/tsc.sh api` (สคริปต์มี heap flag — อ่าน exit code จริง) + focused specs (เขียน path เต็มทีละไฟล์)

### 2.4 Personal API: status / durable off — R1/R7/R11/R12/R19

- New `application/use-cases/expense-weekly-summary-subscription.use-case.ts`: `get/stop` for ctx membership; effectiveOn = explicit enabled or live active OWNER default, then R7/R19. GET never returns roster or expense facts. Both exact GET/DELETE use session+tenant+own membership, with no notification.read/expense.read business permission guard, so removal of either cannot block personal stop; free/nonpaid still denied except expired-paid cleanup. Existing LINE identity/channel lookup at `notification.use-cases.ts:366–399` supplies truthful account wording.
- New `presentation/http/expense-weekly-summary.controller.ts` GET/DELETE `/me`; register in dashboard-notifications.module.ts. **No personal enrollment PUT.** DELETE locks membership FOR UPDATE, upserts false and resolves only its OPEN weekly events, with actual-change audit. No-row owner off is durable; no delete-to-default bug.
- Preserve exact own GET/DELETE recovery in `auth/presentation/auth.guard.ts`: expiry exemption/recovery pattern :69–73,108–111,246,295–309; session+tenant+own existing membership path avoids resolver's all-selected-branches-disabled rejection. Free summary routes remain closed. No new financial/read/write permissions.
- Tests first: registered `src/modules/dashboard-notifications/application/use-cases/notification-preference.use-case.spec.ts` — `R12 personal off persists owner false`, `R11 missing LINE never promises an unavailable bell`, `R19 only paid access reaches summary metadata or settings`; `src/modules/auth/auth.guard.spec.ts` — `R12 opt-out survives expiry suspension and disabled selected branches`, `R19 free weekly routes stay outside recovery`; PG in dashboard-notification-correctness.spec.ts.
- Depends 2.1/2.2 and M6/M7 narrow guard. Verify API/TYPE_API/PG commands below. Own stop locks only membership/choice then weekly events; do not acquire Company later and invert delivery's order.

### 2.5 Merge choices and queued recipients — R8

- `auth/application/use-cases/account-merge.use-case.ts:160–163,206–219`: retain current membership-first locking/order. Move choice follows membership; queued weekly recipient.userId follows survivor. Duplicate membership: merge explicit choices by newest updatedAt, false wins exact timestamp tie, missing row loses to any explicit choice; never OR defaults. Resolve duplicate pending weekly ranges; survivor scope governs, not equal role keys alone (`auth/domain/logic/account-merge.logic.ts:14–19,49–63`). Audit merged choice.
- Existing merge must not request Company/advisory after membership or call executeInTransaction (lock inversion with settings/send). Round 5.1 adds cursor handling: same audience keeps max checkedThrough; move/reidentify one compatible pending weekly event without changing its immutable dedupKey; cursor prevents recreation. Different audience suppresses source pending cards and keeps survivor cursor; effective OFF resolves pending survivor cards. 5.4 proves range/audience seam; no general merge-policy change or other-notice migration.
- First tests: `src/modules/auth/application/use-cases/account-merge.use-case.spec.ts` — `R8 newest explicit choice survives duplicate merge`; `src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts` — `R8 merge races sweep without orphan event` (missing-row owner included).
- Depends 2.1, verify API/TYPE_API/PG. Last changed explicit choice is preserved; a scope change has no invented historical all-branch coverage guarantee.

### 2.6 Account status and personal stop — R12/R14/R19

- Existing `dashboard-notifications.api.ts`: GET/DELETE client methods (no enrollment PUT). New WeeklySummaryCard.tsx is a status/stop card, using pure wording in company-profile.logic.ts and spec §10.3.
- Pass free session flag from account/profile server callers; no mount/request for free. Current paid effective-on owner or selected reader gets stop; effective off gets status, not invitation. Existing expired-paid own cleanup only. Integrate account hash in CompanyProfilePage.tsx and company-profile.logic.ts:68–75, async cold/hashchange after data resolves; no VAT behaviour change.
- First tests: CompanyProfilePage.qa.spec.ts — `R12 owner default status and personal stop`, `R19 free account hides weekly summary without an API request`; company-profile.logic.spec.ts hash regression. No-row owner is on, explicit owner off stays off; loading/error never becomes off.
- Depends 2.4; verify WEB/TYPE_WEB and 390/1280/~1556 screenshots/button measurements, repeated stop/retry. Settings exit completed in 5.3.

### 2.7 removed 2026-11-04 (owner decision) — home invitation

No home opt-in line, localStorage dismissal, DashboardPages invitation or new session wrapper for it. Keep id so old references resolve; `DashboardPages.rendered.spec.ts` proves absence. Replacement settings card is 5.3, not a hidden change under this id.

---

## Phase 3 — คำนวณสรุป + sweep + ด่านส่ง + การ์ด LINE

### 3.1 Pure logic

- ใหม่ `domain/logic/expense-weekly-summary.logic.ts`: core fixed-Monday seven-day `weekWindow`, `nextCheckDate` (extended to selected-day/cursor in 5.4), ค่าคงที่ (spec §5.2–5.6 รวม `WEEKLY_SUMMARY_RETENTION_MONTHS=13`, `RD_EFILING_8_DAY_EXTENSION_LAST_STATUTORY_DUE='2027-01-31'`), `scopeKey(scopes)`, `buildWeeklySummaryCard(facts)` (null = เงียบ; ทุกถ้อยคำมาจากที่นี่ที่เดียว), `taxReminderRows`, `buildExpenseWeeklySummaryLineMessage`, `weeklySummaryBellText`
- `reimbursements/domain/logic/reimbursement.logic.ts`: pure `claimPayableSince(request, lastVoidAt)` ย้ายจาก `workflow-scan-candidates.use-case.ts:216-220`; scan เรียกฟังก์ชันนี้แทน (พฤติกรรมเดิม)
- `tax/domain/logic/` (ไฟล์ logic ของ tax ที่มีอยู่): pure `withholdingFormType(payeeKind, juristicKind, categoryFilingRoute)` ย้ายจาก `sync-tax-events.use-case.ts:60-77` (ส่วนตัดสินแบบ ไม่รวมการเขียน review issue) และให้ `withholdingForm` เรียกใช้ — พฤติกรรมเดิม
- tests: `notification.logic.spec.ts` — **fixture spec §10.1 → การ์ดตรงทุกแถว** และกรณีตามตาราง §10.5 ทุกแถว (รวม `เท่ากัน` ผ่าน, "2 เท่า" ไม่ผ่าน, สกุลเงินอื่น, PND2/ไม่รู้ประเภท/ยื่นแล้วบางแบบ); `workflow-scan.use-case.spec.ts` และ `sync-tax-events-wht-form.use-case.spec.ts` ผ่านเหมือนเดิม
- verify: focused specs

### 3.2 Provider queries

- `expense-summary.provider.ts`: `collectWeeklyDigest({ companyId, scopes, canPayClaims, companyWide, weekStart, weekEnd, asOf })`; query ยอดและนับใบใช้ `branchScopeWhere(scopes)` (`branch.logic.ts:80-83`) **ยกเว้น** query ประวัติ "เคยมีมาก่อน" ของ A2 ซึ่งต้องทั้งร้านไม่กรองสาขา (spec §5.2); ยอดเงินทุกตัวกรอง `upper(currency)='THB'` + นับใบสกุลอื่น (spec §5.1)
  - seven-day trailing totals anchored to actual periodStart + first confirmed expense; equal-length previous window. Phase 5.4 adapts periods; never use calendar-week bins after day changes
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
- tests: PG — two recipients ไม่ปิดกัน; new range supersedes only that membership; สอง sweep พร้อมกันผ่าน `executeInTransaction` → 1 event 2 deliveries; ผู้เรียกเดิมที่ใช้ `supersedeEarlier` (หาด้วย grep `supersedeEarlier: true`) ผ่าน spec เดิม
- verify: focused + PG

### 3.4 Sweep + internal route + purge

- `notification-sweeps.use-cases.ts`: `CreateWeeklyExpenseSummariesSweepUseCase` ตาม spec §7 ข้อ 1–5 (enumerate ACTIVE memberships (including default owners with no choice row); per-recipient transaction locks advisory → Company → membership FOR UPDATE and re-reads roles/choice/user/status before provider/event creation แล้วจึง `createEvent.executeInTransaction({...}, tx)` — กัน race กับการรวมบัญชี spec §6); **purge แยกจาก loop และทำเสมอ**: ลบ event สรุปอายุ > 13 เดือนของทุกบริษัท (ไม่ขึ้นกับผู้สมัครหรือสถานะบริษัท) ทีละ batch ≤ 1,000 จนหมด แม้ loop มี failure
- test purge (PG): บริษัทที่ยังมีผู้สมัคร / ไม่มีผู้สมัครแล้ว / ถูกระงับ → ลบทั้งสาม
- `feature-launch/domain/shadow-surface.catalog.ts`: surface ตาม pattern daily (`:110,146,152`) ถ้า catalog test บังคับ
- `internal.controller.ts`: `POST weekly-expense-summary-sweep` (pattern `:55-60`)
- `dashboard-notifications.module.ts`: import `AccessControlModule` (export `access-control.module.ts:35`); ไม่ import `DataModelCoreModule` (ไม่มี VAT-fact read); ใช้ `PrismaReimbursementRepository` แบบที่ workflow ทำ (`workflow-scan-candidates.use-case.ts:2`) — repo ไม่มี `forwardRef` ที่ใดเลย ถ้าเกิด cycle ให้หยุดและบันทึก
- tests: `internal.controller.spec.ts`; PG (สมาชิกถูกปิดไม่สร้าง; purge)
- verify: `bash scripts/local-proof/tsc.sh api` + `pnpm --filter @watchdog-bms/api test:boot` + focused + PG

### 3.5 ด่านส่ง + การมองเห็นในกระดิ่ง (F1)

- ต้องปิดก่อน: spec §16.1 M1 (ผู้เขียนสิทธิ์ทุกตัวล็อก `Company`/advisory ตามลำดับ) และ M2 (อ่านสิทธิ์ใน tx ได้)
- `ProcessQueuedDeliveryUseCase`: construct a transaction-bound instance of existing `PrismaPermissionResolverRepository` with `{ client: tx } as PrismaService` and wrap in existing `PermissionResolverService`, following `CreateOrUpdateNotificationEventUseCase.executeInTransaction` (`notification.use-cases.ts:206–211`); all membership/entitlement/branch reads then use tx. No domain-port or resolver signature change (M2).
- `ProcessQueuedDeliveryUseCase.pushClaimedNonCustomerLineNotification` (`:485-582`): สำหรับ triggerKey สรุป ทำตาม spec §8 ข้อ 2 a–e **ครบทุกขั้น ไม่มีทางลัด**: advisory shared (`:498`) → `Company FOR SHARE` (ใหม่ ก่อน `:506`) → membership `FOR UPDATE` (`:506-513`) → read explicit choice/effective active-owner default + live permissions in tx → ไม่ตรง `SUPPRESSED` `SUMMARY_AUDIENCE_CHANGED` / ตรง `buildExpenseWeeklySummaryLineMessage(card, companyId, {canManageSummary,todayCivilDate})` แล้วยิงใน tx เดิม
- `ListNotificationsUseCase` + `GetUnreadCountUseCase` (`:34-53`) และ repository `list`/`countUnread` (`prisma-notification.repository.ts:130,241`): ตัวกรองก่อนแบ่งหน้า (ไม่มี `expense.read` → ตัด trigger สรุป; มี → JSON path `payloadJson.card.audience.scopeKey = ปัจจุบัน` และสิทธิ์ไม่กว้างกว่าปัจจุบัน)
- `notification.model.ts`: key ใหม่ใน IMPLEMENTED / ALWAYS_DELIVERED / FEATURE_KEYS
- tests: `process-due-deliveries.use-case.spec.ts` (4 กรณีเปลี่ยนสิทธิ์ + unsubscribe + ปกติ; ลำดับคำสั่งล็อกถูกเรียกครบ); PG กระดิ่ง/unread; **PG interleaving** ใน `dashboard-notification-correctness.spec.ts` ตาม spec §14 (i)–(iv) ด้วยสอง connection และ stub push ที่รอ latch
- verify: focused + PG

### 3.6 Worker

- `notification-jobs.ts`: kind + `WEEKLY_EXPENSE_SUMMARY_CRON = { pattern: '0 8 * * *', tz: 'Asia/Bangkok' } as const`
- `notification-worker.ts`: repeatable `notifications-weekly-expense-summary-sweep` attempts 5 exponential 60s + case
- test: `notification-jobs.spec.ts` — `R5 daily eight cron and chosen-weekday dispatch`; core only Monday is eligible, round 5.4 reads saved weekday
- verify: `pnpm --filter @watchdog-bms/workers typecheck` + `pnpm --filter @watchdog-bms/workers test`

### 3.7 list `view=duplicates`

- `ExpensesPages.tsx:2704–2705,2793` + web api client → `duplicateStatus=POSSIBLE_DUPLICATE` (API รับอยู่ `expense.controller.ts:196,215`)
- test: `expense-list-navigation.logic.spec.ts`; browser 390/1280

### 3.8 ตรวจของจริงบนเครื่อง

- local stack + LINE fake harness (memory "Local LINE fake harness"): default owner with no row and selected reader (unrestricted/branch-limited), fixture spec §10.1 ตั้งเวลา `now` = 2 พ.ย. 2569 08:00 → เรียก internal sweep สองครั้งพร้อมกัน → drain → Flex ที่ fake รับ = spec §10.1, ไม่มีแถวใน AI usage ledger; ถอด `expense.read` คนหนึ่งก่อน drain → ไม่ส่ง
- เปิด URL ทุกปุ่มที่ 390, 1280 และประมาณ 1556; only sold home, pending expenses and account anchor

---

## Round 5 — Shop day and recipients after the core digest (five items)

### 5.1 Additive day/cursor schema and contracts — R8/R19/R20/R21

- Depends 2.1/2.2/2.5 and core 3.8. Exact targets: `apps/api/prisma/schema.prisma` Company.expenseWeeklySummaryWeekday Int default 1 with 1–7 CHECK; CompanyMembership.weeklySummaryCheckedThrough nullable DATE; additive migration/backrelations only. Explicit-choice table from 2.1 remains explicit-only; no owner rows/backfill. Existing event has no periodKey column (`schema.prisma:1543–1570`); quiet runs create no event, so one cursor field is needed instead of parsing dedupKey or keeping hidden events.
- Current WebSession lacks paid tier and PlanTermNotice lacks tier (`apps/web/src/common/models/web-session.model.ts:2–31`; `apps/web/src/features/plan-term/plan-term.api.ts:13–24`). Extend existing `AuthController.me` in auth/presentation/auth.controller.ts:1056–1111 and WebSession with optional display-only weeklySummaryAccess PAID/PAID_RECOVERY/NONE derived from current Company/term using the same pure R19 predicate. No new constructor/provider/endpoint, stored feature flag or permission. Reuse existing display metadata pattern; missing hides summary settings. PAID_RECOVERY only preserves own expired-paid stop, never settings/facts. Keep M7 exact own-cleanup cold navigation for branch-rejected ordinary company sessions; missing display metadata hides settings but does not erase the separately authenticated own-cleanup route. Verified free/NONE sessions never mount/request summary UI; manually crafted cleanup URLs still receive only server denial before free metadata. SettingsPage caller at apps/web/app/(workspace)/companies/[companyId]/settings/page.tsx:13–23 passes it to SettingsMenu; no extra summary API request for free/nonpaid UI. First test in existing registered `src/modules/auth/presentation/auth.controller.spec.ts` — `R19 session summary access distinguishes paid recovery trial and free`; no permission change or business-data query in auth/me.
- Extend existing NotificationSummaryDto in `packages/contracts/src/notifications.ts:47–60` with optional weekly-only footer label/path array; toSummary at notification.use-cases.ts:863–879 derives it from current read permissions, never persisted authority. No generic notification action framework.
- `packages/contracts/src/dashboard.ts`: settings DTO with weekday and eligible name/scope/effective/explicit choices; partial PATCH changed fields only, no financial values. Extend existing Card range payload and personal nextCheckDate. New DTO validation in existing dashboard-notifications.dtos.ts; no new permission/type framework.
- `account-merge.use-case.ts`: carry cursor on move, duplicate scope/period seam as spec §6; keep existing membership-first lock order and newest explicit choice, false tie-break. Apply the closed C1 rule to the resulting survivor cursor: no seven-day cap on continuing ranges; first/missing/older-than-31/OFF→ON fresh starts use seven days. Ineligible checks do not clear/advance it.
- Tests first: existing notification.logic.spec.ts `R20 day changes never overlap or truncate uncovered dates`; PG `R20 cursor event and quiet checks commit once`; account-merge.use-case.spec.ts `R8 newest explicit choice survives duplicate merge`. SCHEMA/API/TYPE_API; additive migration on isolated local DB, then prisma generate. No destructive reset.

### 5.2 Paid settings API and concurrent choices — R1/R7/R19/R21

- Depends 5.1 + 2.4 + M1/M2. In planned expense-weekly-summary-subscription.use-case.ts add getSettings/updateSettings (reuse service/module, no generic settings service), controller GET/PATCH `/expense-weekly-summary/settings`. Existing company.setup.manage guard from expense.controller.ts:796,808; R19 paid gate before summary settings/roster/facts, ordinary auth/term gates, no recovery. A manager without expense.read can manage others but not qualify as a recipient.
- Candidate list enumerates ACTIVE memberships, resolves each existing reader/branch predicate using tx-bound resolver and returns eligible names/scope/choices only. No expense amounts/LINE ids/emails; reject foreign/duplicate/stale/nonreader ids and invalid weekday/type before writes. Resolver/infrastructure failure fails the whole operation with retry, never a fabricated empty/partial candidate list.
- Save lock order entitlement advisory → Company FOR UPDATE via lockPlanTermCompany → affected memberships sorted FOR UPDATE → choices → weekly events. Re-read actor and candidates, write only submitted fields, upsert explicit enabled true/false, resolve queued weekly events for OFF; clear checkedThrough only on effective OFF→ON, never an unchanged ON save. Same-field last committed writer wins, unrelated switches preserved; return canonical state and audit actual before/after. Self DELETE participates through member lock, never deletes explicit off. No event create/push on setting save.
- Tests first: notification-preference.use-case.spec.ts `R21 settings require paid management and current reader candidates`; auth.guard.spec.ts `R19 free summary settings deny before roster read`; PG `R21 concurrent managers and personal stop serialize touched choices`, `R7 revoked reader cannot receive manager-selected card`; process-due-deliveries.use-case.spec.ts `R21 selected reader revocation and owner off suppress push`. API/TYPE_API/PG; exercise two connections and revoke-before-save/send.

### 5.3 Sold settings card/form and contextual exits — R11/R12/R14/R19/R21

- Depends 5.2/2.6. Existing `settings-menu.logic.ts` adds one ordinary summary card next to **planned** e-WHT; current `SettingsMenu.tsx:88–94` renders cards as links, so opens new `apps/web/app/(workspace)/companies/[companyId]/settings/weekly-summary/page.tsx` and small `apps/web/src/features/dashboard-notifications/WeeklySummarySettingsPage.tsx`, not a form inside a Link. Route permission company.setup.manage in existing route-permissions.ts. Existing session has no paid tier (web-session.model.ts:2–31), so pass existing free/locked plus 5.1 new derived weeklySummaryAccess; no mount/request for free/nonpaid. No dependency on e-WHT implementation or permission/preferences changes.
- Existing dashboard-notifications.api.ts settings GET/PATCH; native weekday select, current eligible-member switches, one primary save in FormActionBar and back link; plain Thai one-line hints/field errors/loading/retry, preserved edits. More than six members uses existing search/list controls. No accounting jargon or technical ids. Manager hint at end of LINE/bell `เปลี่ยนวันหรือคนรับได้ที่ตั้งค่าร้าน`; others personal stop only; current management right checked at render, stored payload not authority. Existing NotificationBell.tsx:106–115 clips body and uses a whole-row Link; NotificationPages.tsx:202–218 uses overlay/pointer-events-none. Extend dashboard-notifications.model.ts optional footer type; normalizeNotification already spreads raw fields (dashboard-notifications.api.ts:146–153), so add no mapper branch. Render sibling interactive footer links outside clipped body/row Link (relative z-index in centre). All other notices keep existing rendering/links. No nested anchors.
- Tests: settings-menu.logic.spec.ts `R21 paid setup manager sees summary beside planned e-WHT`; CompanyProfilePage.qa.spec.ts `R12 owner default status and personal stop`; DashboardPages.rendered.spec.ts `R21 settings state and home invitation absent` (render new form from this existing spec). NotificationPages.spec.ts — `R11 weekly footer remains visible and independently reachable`; WEB/TYPE_WEB/BROWSER at 390/1280/~1556, one primary/equal button dimensions, all spec §10.5 cases. 2.7 remains removed.

### 5.4 Daily dispatch, contiguous range and live rechecks — R2–R9/R11/R19/R20

- Depends 5.1/5.2/3.1–3.6; **C1 closed by controller 2026-11-04**, no decision blocker. Extend the planned `weekWindow`/`nextCheckDate` in `expense-weekly-summary.logic.ts`, using existing addCivilDays: end yesterday; missing cursor (including first/cleared OFF→ON) or `cursor < addCivilDays(today,-31)` starts today−7; otherwise start cursor+1 with no seven-day maximum. Exactly 31 days keeps the full range, 32 starts fresh; earlier dates are not carried across fresh starts. Cursor already yesterday skips. Keep `periodKey=start+'..'+end` and actual printed dates. A1 off and เทียบช่วงก่อน for every non-seven period; equal-length comparison and A2 use actual periodStart.
- `notification-sweeps.use-cases.ts`: worker daily08 cron, qualify shop chosen weekday under lock then live effective recipients including owners without choice rows. Cursor/event/recipient/delivery commit atomically; successful quiet check advances cursor without event, ineligible check neither advances nor clears cursor, failure rolls back. Quiet→active therefore starts cursor+1 while cursor age ≤31 days; a pause producing an older-than-31 cursor starts fresh for seven days. R6 idempotent any-status event, existing event date/range immutable on retry; delayed attempts use actual today and current chosen-day gate; old queued card not rebuilt after settings change. Global 13-month purge runs every day even with no eligible shop.
- `expense-summary.provider.ts`: actual supplied date bounds, R19 before facts, R7 scope, previous-month tax period from **run date** (not start); no VAT queries/off-day separate tax notification. `notification.use-cases.ts`: live choice/reader/paid check at send and bell, pass current canManageSummary/todayCivilDate to the pure LINE builder, filtering tax rows by stored dueDate metadata instead of parsing Thai text or adding a source query; omit expired tax instruction from delayed LINE rendering; missing LINE keeps existing WEB event and LINE skip; bell visibility still needs notification.read (notification.controller.ts:31–32,46–47), so account copy uses canReadBell and never promises a readable bell without it. Management hint reflects current permission.
- First tests: pure `R20 day changes never overlap or truncate uncovered dates`, `R20 equal-length comparison and tax month use the run date`, `R5 daily eight filters selected weekday`; PG `R20 cursor event and quiet checks commit once`, `R6 concurrent chosen-day retries freeze one range`, `R1 multiple no-row owners and unlinked owner bell`; delivery `R11 live manager hint and expired tax row rendering`. API/TYPE_API/PG plus workers notification-jobs.spec.ts `R5 daily eight cron and chosen-weekday dispatch` and workers typecheck/test. No API test file added.
- Required cases inside that existing registered `src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts` test: cursor 1 Nov + 12 Nov check gives a single 2–11 Nov ten-day card; cursor 32 days old gives seven days; exactly 31 days keeps cursor+1..yesterday; quiet→active starts cursor+1; OFF→ON gives seven days. Include first/missing cursor, already-covered retry and ineligible preserving cursor; verify non-seven comparison label/A1 off. Command: `pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts`, then `bash scripts/local-proof/tsc.sh api`; PG/worker/browser checks remain as listed. No new test file or schema field for C1 closure.

### 5.5 Combined three-width proof and release cost — R14/R19/R20/R21

- Depends 5.3/5.4; C1 already closed by controller 2026-11-04. Existing `e2e/journeys/shop-menus-everyday.journey.spec.ts` adds `R21 summary settings and personal stop at three widths`; existing e2e/notifications.spec.ts bell check. Paid owner/manager/member, free, expired, missing expense.read and branch-limited cases; save/reload/stop, two managers, stale roster/retry, unlinked bell-only, no home invitation, no unsold routes. Inspect images and measure buttons at 390/1280/~1556; state what was not observed.
- Local fake LINE proof: daily job→API→one chosen-day frozen range; earlier/later day changes keep continuing coverage contiguous/disjoint; first/missing/older-than-31/OFF→ON fresh starts intentionally omit earlier dates; quiet→active uses cursor+1; revoke before drain suppresses. Zero AI ledger calls, no live source mutations. Test registrations checked before adding tests.
- Controller computes §5.5 cost formula (paid shops × owners × up to five + picked people, transition/retry/other notices extra), checks actual OA package and proposes figure before release. No live data here. Verify BROWSER/API/PG/TYPE_API/TYPE_WEB/workers focused checks, then existing required integration gates. Record exact omissions; run the accepted C1 ten-day/31-day/32-day/quiet/OFF→ON cases as ordinary required regressions, with no pending owner/controller decision. Each actual weekday change adds at most one extra card per effective recipient; retain that bounded day-change allowance in the existing cost formula.

---

## Phase 4 — Guides and release (runs after round 5)

### 4.1 คู่มือเว็บ
- `apps/web/src/features/user-guide/getting-started-guide.content.ts` กลุ่ม `notifications` "รับสรุปรายจ่ายทาง LINE" — ไฟล์อยู่ใน W00 hash (`line-ai-capability-manifest.ts:160`) → `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1` + `node scripts/run-line-ai-whole-chain-acceptance.mjs`

### 4.2 คำตอบวิธีใช้ของน้องมั่งมี (follow-up)
- ร่างใน `apps/ai-gateway/src/modules/line-ai/agents/product-help-draft-cards.ts` เข้ารอบอนุมัติ pack ปกติ

### 4.3 Before deployment — R4/R14, controller Q5 task
- Controller inspects actual shared OA package and proposes capacity/cost: paid shops × eligible default-on owners × up to 5 + selected nonowners × up to 5 for stable weekdays, plus at most one extra card per effective recipient per actual weekday change, conservative retries and other OA notices. No live count/price in this docs round. Q5 is answered; this is a release evidence gate, not owner approval pending.
- runbook: เตือนอัปเดต `RD_EFILING_8_DAY_EXTENSION_LAST_STATUTORY_DUE` ก่อน ม.ค. 2570
- deploy ตาม `docs/runbooks/uat-production-v2-deployment.md`

### 4.4 ปิดเอกสาร
- memory: ผลตรวจจริงทุกขั้น + ภาพ/ค่าที่วัด 390/1280/1556 + สิ่งที่ไม่ได้รัน
- follow-up แยก: B3, B5, B7, G3, G7

## การตัดสินใจที่ล็อกแล้ว

1. R1 owner defaults on, eligible nonowners selected in shop settings, own off always available. Explicit true/false per membership; no-row role default, no backfill, last committed choice wins; not NotificationPreference. One-notice owner exception only.
2. 0 AI call; ปุ่ม LINE เป็น URI ล้วน ไม่แตะ webhook
3. ฐาน = CONFIRMED ตามวันที่รายจ่าย หมวดระดับบรรทัด ขอบเขต `branchScopeWhere` (รวมส่วนกลาง) ไม่อ้างว่ายอดตรงหน้าแรก; เงินเป็นบาทล้วน (B8/B9 แยกงาน); ประวัติ A2 ทั้งร้าน
4. R19 paid eligibility before selection/read/send; free expense.read alone never qualifies. ตรวจสิทธิ์สามจุด: ตอนสร้าง ตอนส่ง (ใต้ล็อก advisory → Company → membership ไม่มีทางลัด) ตอนแสดงในกระดิ่ง; ยกเลิกได้แม้แพ็กหมดอายุ
4a. ภาษี: อ่านด้วย adapter ของ ภ.ง.ด. + จัดแบบ + ความครอบคลุมรายรายการ ไม่ใช้สถานะงวด
5. สร้าง event ผ่าน `executeInTransaction` + `onlyIfAbsent`; supersede ตาม source ของ membership ไม่ใช่ลิงก์
6. ไม่มี %, อันดับ, เท่า; วันภาษีใช้ "ภายใน" + วันฐาน; ไม่รับประกันวันส่ง
7. เลิก `daily_owner_summary` ทุกทาง (inert + retired key + migration) แต่คง cron
8. Preferences/rules pages stay closed; new paid shop setting uses company.setup.manage. Remove home invitation; personal account stop and live manager hint remain. R20 day/range C1 is closed by controller 2026-11-04: no seven-day maximum for continuing coverage, seven-day fresh starts at first/missing/older-than-31/OFF→ON, quiet updates/ineligible preserves cursor.

## Traceability

R-ids, proposed test names, evidence and acceptance rows resolve in the companion spec's Traceability table. Phase 1 and AC11/AC13/AC30 remain tombstones; no ledger or VAT work is smuggled into another step. The reminder is PND3/PND53 information only for lower packs, with no form button. APIs and LINE have no new permission key or environment feature switch.

Implementation rounds: 2.1–2.5; 2.6 + 3.1–3.4; 3.5–3.8; then separate 5.1–5.5 day/settings round; release 4.1/4.3/4.4 after 5.5. 2.7 removed; 4.2 is separate help-pack approval. Dependencies below take precedence; no code is changed in this documents round.

Commands: **API** = `pnpm --filter @watchdog-bms/api exec node --import tsx --test <listed file relative to apps/api>`; **TYPE_API/TYPE_WEB** = `bash scripts/local-proof/tsc.sh api` / `bash scripts/local-proof/tsc.sh web`; **WEB** = `pnpm --filter @watchdog-bms/web exec tsx --test <listed file relative to apps/web>`; **SCHEMA** = `pnpm --filter @watchdog-bms/api exec prisma validate --schema prisma/schema.prisma` then `pnpm --filter @watchdog-bms/api exec prisma generate --schema prisma/schema.prisma`. Migrations additive only, deployed to the isolated local proof DB. **PG** runs the listed registered spec with `NOTIFICATION_TEST_DATABASE_URL` set to that isolated DB; inspect that the real-PG blocks did not skip. **BROWSER** = `pnpm exec playwright test --project=journeys-mobile e2e/journeys/shop-menus-everyday.journey.spec.ts` with the new digest journey explicitly iterating 390, 1280 and approximately 1556; run the existing notification test separately for bell behavior. Do not assume a project name proves all widths.

| Step | Requirement | Dependency | Exact focused test file(s), names in spec trace | Verification |
|---|---|---|---|---|
| 1.1/1.2/1.3 | R16/R18 removed | None | None | No code or tests; removed 2026-10-26 (ceiling) |
| 2.1 | R1/R9/R10 | None | apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts | SCHEMA; API; additive migration on isolated DB twice |
| 2.2 | R1/R11/R12/R19 | 2.1 contract shape | apps/api/src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts | contracts build; TYPE_API; TYPE_WEB |
| 2.3 | R10 | 2.1 | apps/api/src/modules/dashboard-notifications/presentation/http/internal.controller.spec.ts; apps/api/src/modules/dashboard-notifications/application/use-cases/notification-preference.use-case.spec.ts | API; TYPE_API |
| 2.4 | R1/R7/R11/R12/R19 | 2.1/2.2; guard design M6/M7 | apps/api/src/modules/dashboard-notifications/application/use-cases/notification-preference.use-case.spec.ts; apps/api/src/modules/auth/auth.guard.spec.ts; apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts | API; TYPE_API; PG |
| 2.5 | R8 | 2.1 | apps/api/src/modules/auth/application/use-cases/account-merge.use-case.spec.ts; apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts | API; TYPE_API; PG |
| 2.6 | R12/R14/R19 | 2.4 | apps/web/src/features/company-profile/company-profile.logic.spec.ts; apps/web/src/features/company-profile/CompanyProfilePage.qa.spec.ts | WEB; TYPE_WEB; browser 390/1280/~1556 |
| 2.7 removed | R12/R14 | Owner decision 2026-11-04 | DashboardPages.rendered.spec.ts proves no home invitation | No invitation implementation; replacement 5.3 |
| 3.1 | R2–R5/R11/R15 | 2.2 | apps/api/src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts; apps/api/src/modules/workflow/application/use-cases/workflow-scan.use-case.spec.ts; apps/api/src/modules/tax/application/use-cases/sync-tax-events-wht-form.use-case.spec.ts | API; TYPE_API |
| 3.2 | R2/R3/R4/R5/R19 | 3.1; adapter volume proof M5 | apps/api/src/modules/dashboard-notifications/application/providers/expense-summary.provider.spec.ts; apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts | API; TYPE_API; PG; no VAT/ledger tests |
| 3.3 | R6 | 2.2 | apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts | API; TYPE_API; PG |
| 3.4 | R5/R6/R8/R9/R19 | 2.4/2.5/3.2/3.3; Q7=13 months answered | apps/api/src/modules/dashboard-notifications/presentation/http/internal.controller.spec.ts; apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts | API; TYPE_API; PG; existing test:boot |
| 3.5 | R7/R19 | 2.4/3.3; M1/M8 writers audited and fixed | apps/api/src/modules/dashboard-notifications/application/use-cases/process-due-deliveries.use-case.spec.ts; apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts | API; TYPE_API; PG interleaving without skipped blocks |
| 3.6 | R5 | 3.4/3.5 | apps/workers/src/modules/notifications/notification-jobs.spec.ts | workers typecheck/test; local job→API proof |
| 3.7 | R13 | Existing expense filter API | apps/web/src/features/expenses/expense-list-navigation.logic.spec.ts | WEB; TYPE_WEB; browser 390/1280/~1556 |
| 3.8 | R2/R5/R7/R11/R12/R14/R15/R19 | 2.6/3.2–3.7 | e2e/journeys/shop-menus-everyday.journey.spec.ts; e2e/notifications.spec.ts | BROWSER at 390/1280/~1556; inspect images and grouped-button dimensions |
| 4.1 | R11/R14 | 5.5 | apps/web/src/features/user-guide/user-guide.content.spec.ts | WEB; existing W00/whole-chain; no new unregistered API assertion |
| 4.2 (follow-up) | R11/R14 | Separate help-pack approval | Existing help-pack approval tests only | No new module/tool or unsolicited publication |
| 4.3 | R4/R14 | 5.5 + controller OA capacity figure; legal source reconfirmed | e2e/journeys/shop-menus-everyday.journey.spec.ts | Mandatory deployment runbook; exact UAT/READY/Production ids; signed result and customer OPEN |
| 4.4 | R14/R15 | After implementation evidence | Docs evidence only | Record focused/API/PG/browser results and omissions |
| 5.1 | R8/R19/R20/R21 | Core 3.8, 2.1/2.2/2.5 | notification.logic.spec.ts; dashboard-notification-correctness.spec.ts; account-merge.use-case.spec.ts; auth/presentation/auth.controller.spec.ts (full paths registered below) | SCHEMA; API; TYPE_API; additive local migration |
| 5.2 | R1/R7/R19/R21 | 5.1/2.4; M1/M2 | notification-preference.use-case.spec.ts; auth.guard.spec.ts; dashboard-notification-correctness.spec.ts; process-due-deliveries.use-case.spec.ts | API; TYPE_API; PG concurrent managers |
| 5.3 | R11/R12/R14/R19/R21 | 5.2/2.6 | apps/web/src/features/web-core-workspace/settings-menu.logic.spec.ts; CompanyProfilePage.qa.spec.ts; DashboardPages.rendered.spec.ts; NotificationPages.spec.ts | WEB; TYPE_WEB; BROWSER three widths |
| 5.4 | R2–R9/R11/R19/R20 | 5.1/5.2/3.1–3.6; C1 closed 2026-11-04 | notification.logic.spec.ts; expense-summary.provider.spec.ts; dashboard-notification-correctness.spec.ts; process-due-deliveries.use-case.spec.ts; apps/workers/src/modules/notifications/notification-jobs.spec.ts | API; TYPE_API; PG; workers typecheck/test |
| 5.5 | R14/R19/R20/R21 | 5.3/5.4; C1 closed 2026-11-04 | e2e/journeys/shop-menus-everyday.journey.spec.ts; e2e/notifications.spec.ts | BROWSER three widths; controller OA figure before release |

Registration rechecked with `grep -c "<file>" apps/api/package.json` on 2026-11-04; no package edits, new API spec files or runtime execution.

| API test file (relative to apps/api) | grep count |
|---|---|
| `src/modules/auth/application/use-cases/account-merge.use-case.spec.ts` | 1 |
| `src/modules/auth/auth.guard.spec.ts` | 1 |
| `src/modules/auth/presentation/auth.controller.spec.ts` | 1 |
| `src/modules/employee-access/domain/logic/feature-gate.logic.spec.ts` | 1 |
| `src/modules/dashboard-notifications/application/providers/expense-summary.provider.spec.ts` | 1 |
| `src/modules/dashboard-notifications/application/use-cases/notification-preference.use-case.spec.ts` | 1 |
| `src/modules/dashboard-notifications/application/use-cases/process-due-deliveries.use-case.spec.ts` | 1 |
| `src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts` | 1 |
| `src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts` | 1 |
| `src/modules/dashboard-notifications/presentation/http/internal.controller.spec.ts` | 1 |
| `src/modules/tax/application/use-cases/sync-tax-events-wht-form.use-case.spec.ts` | 1 |
| `src/modules/workflow/application/use-cases/workflow-scan.use-case.spec.ts` | 1 |
