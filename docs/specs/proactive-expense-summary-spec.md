# Proactive Expense Summary Spec — สรุปรายจ่ายทาง LINE ทุกสัปดาห์ + เรื่องที่ควรดู

Status: DRAFT — documents only; sold ceiling and traceability revised 2026-10-26; owner Q1–Q7 answered 2026-11-04; engineering proof remains; C1 closed by controller 2026-11-04; Q6 remains removed (ceiling); Re-anchored to develop e7c422802 on 2026-11-04; controller accepted 2026-11-04 (R19 paid-only eligibility checked against free-expense-access.ts and BILLING_PAID_TIERS)
Owner: Expenses / Notifications lane
Related: `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md` (ข้อ 14), `docs/plans/proactive-expense-summary-plan.md`, `docs/agent-memory/proactive-expense-summary.md`, `docs/agent-memory/sold-features-fixes-2026-10-04.md` (owner decision เรื่องตั้งค่าการแจ้งเตือน), `docs/guidelines/thai-ux-standard.md`
Baseline: develop `36e2dc624ff03a447a33eec721d9ef6b76296bad`, tree `88a1cbcc45afac7c05b9c2f3190b0da1f839abb3`, opened 2026-11-04; code unchanged from e7c422802 in the traced modules; original review/research dates remain historical

---

## 1. ปัญหา (พฤติกรรมปัจจุบัน)

ร้านต้อง "เปิดมาดูเอง" ถึงจะรู้ว่าเงินไปไหน ระบบไม่เคยบอกก่อน

**สิ่งที่มีอยู่แล้ว (ใช้ต่อได้)**

- หน้าแรกเว็บ: ยอดรายจ่ายที่ยืนยันแล้วตามช่วง, ใบเสร็จรอตรวจ (ทุกช่วงเวลา), ค้างจ่าย (ทุกช่วงเวลา) — `apps/api/src/modules/dashboard-notifications/application/providers/expense-summary.provider.ts:65-118`; แท็บ วันนี้/สัปดาห์/เดือน/กำหนดเอง — `apps/web/src/features/dashboard-notifications/DashboardPages.tsx:30-35`, `:111-117`; กราฟรายเดือน — `DashboardPages.tsx:322` → `ExpenseMonthsCard.tsx:29-119`
- หน้า `/income-expense-ledger` มีกราฟ "ยอดตามหมวด" ฝั่งรายจ่าย (`apps/web/src/features/accounting-documents/IncomeExpenseLedgerPage.tsx:509-530`) เปิดได้ด้วย `expense.read` (`apps/web/src/features/web-core-workspace/route-permissions.ts:75`, API `income-expense-ledger.controller.ts:9,32-37`) **แต่ไม่มีลิงก์ใดในเว็บชี้ไปหน้านี้** — grep `income-expense-ledger` ใน `apps/web/src` + `apps/web/app` พบแค่ route file, route rule, api client และตัวหน้าเอง; เมนูย่อยของ "ค่าใช้จ่ายและใบเสร็จ" สร้างที่ `web-core-workspace.logic.ts:326-395` ไม่มีรายการนี้
- ขอบเขตสาขาของหน้านั้นใช้ `branchScopeWhere` = สาขาที่มีสิทธิ์ **รวมรายการส่วนกลาง (`branchId=null`)** (`data-model-core/domain/logic/branch.logic.ts:80-83`, ใช้ที่ `income-expense-ledger.use-case.ts:109`) ส่วน provider หน้าแรกเมื่อส่ง `branchIds` ใช้ exact match ไม่รวมส่วนกลาง (`expense-summary.provider.ts:51-53`) — สองหน้านี้นับต่างกันสำหรับผู้ใช้ที่จำกัดสาขา
- LINE: `expense.get_breakdown` แยกตามหมวด สาขา ผู้ขาย (`apps/api/src/modules/line-ai/application/use-cases/erp-business-tools.use-case.ts:349-470`) — ต้องพิมพ์ถามเอง และนับทุกสถานะยกเว้นปฏิเสธ/ยกเลิก (`:446` `statusBasis: 'exclude_rejected_voided'`) ไม่ใช่ฐาน "ยืนยันแล้ว"
- ระบบเตือนผู้จ่ายเมื่อใบเบิกรอจ่ายเกินกำหนด (`workflow-template-catalog.ts:278-300`, auto-enable) — **แต่ทำงานเฉพาะร้านที่ตั้ง `slaHours`** (`workflow-scan-candidates.use-case.ts:194-203`) และค่าตั้งต้นไม่มี `slaHours` (`reimbursements/domain/reimbursement.constants.ts:48-61`); นิยาม "รอจ่ายตั้งแต่เมื่อไร" อยู่ที่ `workflow-scan-candidates.use-case.ts:216-220` (ล่าสุดของ financeReviewedAt/approvedAt ไม่มีก็ submittedAt; ถ้ามีการยกเลิกการจ่ายที่ใหม่กว่า ใช้วันยกเลิก)
- ระบบจับใบเสร็จที่อาจซ้ำอยู่แล้ว: `DuplicateStatus.POSSIBLE_DUPLICATE` (`apps/api/prisma/schema.prisma:2383-2389`), list API กรอง `duplicateStatus` ได้ (`expense.controller.ts:196,215`, `prisma-expense.repository.ts:1283`) แต่หน้า list เว็บไม่มี view นี้ (`ExpensesPages.tsx:2704-2705` รับแค่ `pending|unpaid|addressMissing|confirmed`)

**งานสรุปเจ้าของร้าน 07:00 ที่มีอยู่ ใช้ไม่ได้จริง**

- cron 07:00 Asia/Bangkok (`apps/workers/src/modules/notifications/notification-jobs.ts:59`, ตั้งงานที่ `notification-worker.ts:63-74`) → sweep อ่านเฉพาะ `NotificationRule` ที่ `triggerKey='daily_owner_summary'` และ ENABLED (`notification-sweeps.use-cases.ts:114-121`)
- **แต่มีทางสร้างโดยไม่ดู rule**: internal route `POST /internal/companies/:companyId/notifications/daily-owner-summary` เรียก use case ตรง (`internal.controller.ts:128-139`) และ `daily_owner_summary` ยังอยู่ใน `IMPLEMENTED_TRIGGER_KEYS` (`notification.model.ts:136`) จึงเปิด rule กลับได้ (`notification.use-cases.ts:146-148`)
- rule ถูกสร้าง **โดย `seed.ts` เท่านั้น** (`apps/api/prisma/seed.ts:2795-2806`); grep `notificationRule.create|upsert|createMany` ทั้ง `apps/api/src` ไม่พบ และไม่มี migration ใดสร้าง (ยังยืนยันไม่ได้ว่า DB Production เคยรัน seed หรือไม่ — ไม่ได้แตะ cloud)
- ส่งให้ **ทุก OWNER และ ADMIN ตามบทบาท** (`notification.use-cases.ts:305-312`) — ขัดกฎเจ้าของ "แจ้งเฉพาะคนที่เกี่ยวข้อง"
- ข้อความคือ `แดชบอร์ดอัปเดตแล้ว ${snapshot.widgets.length} วิดเจ็ต` (`notification.use-cases.ts:322`) — ดู §13 B1

**ช่องทาง สิทธิ์ และกลไกแจ้งเตือนที่เกี่ยว**

- การแจ้งเตือนพนักงานส่งผ่าน OA ระบบของมั่งมีตัวเดียว (`notification.use-cases.ts:382-391`) ซึ่งตั้งแต่ 2026-10-12 คือ `@695ultfm` (premium `@mangmeeplus`) — `docs/runbooks/cloud-environment-operations.md:829-839`
- ร้านแพ็กที่ขาย (preset `starter`, `packages/contracts/src/menu-entitlements.ts:432-450,496-501`) ได้ `dashboard_notifications` แต่ **ไม่ได้** `dashboard_notifications.preferences` / `.rules` (`feature-entitlements.ts:434-449`; onboarding เขียน `enabled:false` — `create-company-onboarding.use-case.ts:584-592`; gate ตัด permission — `feature-gate.logic.ts:126-131`) ตาม owner decision 2026-10-04 (`docs/agent-memory/sold-features-fixes-2026-10-04.md:180-182`)
- ตอนส่ง LINE ระบบตรวจแค่ membership ACTIVE + entitlement + สถานะ event (`notification.use-cases.ts:349-351,506-530`) — **ไม่ตรวจสิทธิ์อ่านข้อมูลหรือขอบเขตสาขาของผู้รับอีก**
- `resolveEarlier` (ที่ `supersedeEarlier` ใช้) จับ "เรื่องเดียวกัน" ด้วย `deepLinkHref` ก่อน ถ้ามี (`infrastructure/prisma-notification.repository.ts:188-201`) — ถ้าทุกคนได้ลิงก์เดียวกัน event ของคนหนึ่งจะปิด event ของอีกคน
- `CreateOrUpdateNotificationEventUseCase.execute` หา event ด้วย `findByDedupKey` แล้วค่อยสร้าง (`notification.use-cases.ts:248-258`) และ `dedupKey` มีแค่ index ไม่ unique (`schema.prisma:1570`) — เรียกซ้อนกันสร้างซ้ำได้; มี `executeInTransaction` ที่ล็อก advisory ต่อ dedupKey อยู่แล้ว (`notification.use-cases.ts:203-212`)
- ไม่มีงานลบ notification อัตโนมัติ (grep `notificationEvent.deleteMany` พบแค่สคริปต์ smoke) — ข้อมูลอยู่จนบริษัทถูกลบ (cascade)
- การรวมบัญชี (account merge) ย้าย `CompanyMembership.userId` ไปบัญชีที่เหลือ (`auth/application/use-cases/account-merge.use-case.ts:205-219`) — ตารางที่เก็บ `userId` ตรง ๆ จะค้างกับบัญชีที่ถูกปิด รวมทั้ง `NotificationRecipient.userId` (`schema.prisma:1577`): notice ที่ยังรอส่งของ membership ที่ย้ายจะถูกระงับ เพราะผู้รับเดิมไม่มี membership แล้ว (`notification.use-cases.ts:506-514`)
- ผู้แก้สิทธิ์/บทบาท/สาขา/สถานะสมาชิกล็อกแถว `Company` แบบ `FOR UPDATE` ก่อน (`update-role.use-case.ts:71` → `lockPlanTermCompany`, `system-partner-management/application/lock-plan-term-company.ts:4-6`; ผู้เรียกตัวอื่นเช่น `update-employee`, `set-employee-status`, `create-role`) แล้วจึงลบ/เขียน `rolePermission` (`update-role.use-case.ts:137-138`); ผู้แก้ entitlement ล็อก advisory exclusive (`set-partner-features.use-case.ts:253`) ส่วนการส่ง LINE ถือ advisory shared (`notification.use-cases.ts:498`) และล็อกแค่แถว membership (`:506-513`) — วันนี้ไม่มีอะไรกันการถอดสิทธิ์ที่ commit ระหว่างอ่านสิทธิ์กับยิง LINE
- สกุลเงิน: `ExpenseRecord.currency` ค่าตั้งต้น THB (`expense-draft.use-case.ts:169`), ไม่มีคอลัมน์อัตราแลกเปลี่ยน; หน้าแรก (`expense-summary.provider.ts:27-34,65-81`) และ ledger (`income-expense-ledger.use-case.ts:151-165`) รวมยอดข้ามสกุลเงิน (§13 B8, B9); ระบบรู้จักรายจ่ายที่ไม่ใช่บาท (`SubstituteReceiptWizardPage.tsx:214` "ค่าใช้จ่ายนี้ไม่ใช่เงินบาท")
- **Changed by `049aa51de`:** never-paid expired shops are no longer uniformly blocked. `isFreeExpenseDraftCompany` can grant source-drafts-only access (`apps/api/src/modules/system-partner-management/application/free-expense-access.ts:10–54`); resolver permits that cohort despite term-disabled state (`apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts:65–74`) and intersects permissions (:130–131), retaining `expense.read` when originally granted (`free-expense-access.ts:58–68`). The HTTP allowlist remains expense/source/history routes, not dashboard/summary routes (:72–83); `auth.guard.ts:325–326` denies other non-recovery routes. Expired previously-paid shops keep ordinary expiry/recovery rules. Neither free access nor `expense.read` qualifies a shop for this summary (R19).
- หัก ณ ที่จ่ายไม่ได้แปลว่า ภ.ง.ด.3/53 เสมอ: ระบบจัดแบบจากประเภทผู้รับ (ไม่รู้ = ไม่จัด + review issue) และหมวดเงินได้ (`SEPARATE_PND2` → ภ.ง.ด.2) — `tax/application/use-cases/sync-tax-events.use-case.ts:60-77`; "ยื่นแล้ว" ดูทีละรายการจ่ายเทียบบรรทัดในแบบที่ยื่น (`tax/application/services/withholding-filing-state.ts:60-76`) ไม่ใช่สถานะงวด (`TaxPeriod` unique ต่อแบบ+งวด `schema.prisma:5673`)
- `ACCOUNTING_UI_HIDDEN` ปิดเฉพาะโมดูล `journal`/`closing` (`web-core-workspace.constants.ts:14-17`, `web-core-workspace.logic.ts:203`); `/income-expense-ledger` ไม่มีโมดูล ใช้ route rule (`route-permissions.ts:75`) จึงไม่ถูกซ่อน

## 2. เป้าหมาย

Owner decision, 2026-11-04 (verbatim): **"ควรเปลี่ยนวันได้และคนที่ได้รับแจ้งเตือนให้ set ตามสิทธิ์ได้และเจ้าของกิจการเป็น default เสมอ"**. This replaces opt-in-only Q1: every eligible active business-owner membership defaults on; other eligible readers are picked in ตั้งค่าร้าน; a person's own explicit off remains available and the last committed explicit choice wins. This is an explicit exception to “notify only the person concerned” for `expense.weekly_summary` alone; it grants no financial access and changes no other notice, including the retired daily summary.

1. R1: owner by default, others picked in shop settings by permission, personal opt-out always available; all subject to R19 and R7. Multiple owners can qualify; ADMIN is not an owner default.
2. R2–R4/R11: one plain-Thai card with expense facts, four fixed signals and expense-derived withholding information; no unsold page or tax mutation.
3. R5/R20: shop chooses weekday (default Monday); check at 08:00 Asia/Bangkok daily, collect/send only for that shop's chosen day, zero AI. C1 closed by controller 2026-11-04: continuing coverage has no seven-day maximum; a truthful longer or shorter period follows the cursor. Fresh starts use the last seven days (§5.1); no universal five-card monthly cap is promised.
4. R7/R19: only current paid shops and current permitted recipient branches may be read or sent; free/nonpaid shops have no settings, summary, invitation or tax reminder.
5. **removed 2026-10-26 (ceiling)** — no category-ledger menu, ledger/export changes or tests.
6. R10: retire all existing daily-summary producers; R9: bell summaries retained 13 months; quiet checks create no event (owner Q3/Q4/Q7: "as recommended").

## 3. Non-goals

**R15 ceiling:** all paid tiers use `starter`; only Enterprise adds `wht_pnd53` and `wht_50bis` (`packages/contracts/src/menu-entitlements.ts:432–450,497–500`). No ledger, accounting-documents menu/export, VAT/ภ.พ.30, reports, reconciliation, procurement, CRM, inventory, sales or shop OA work. Reusing an existing tax/branch helper does not open its unsold module. No new permission keys, dependency or environment feature switches.

**R19 — paid eligibility before selection, read and send:** require current active commercial access, an unexpired/enabled `CompanyPlanTerm` whose tier is in existing `BILLING_PAID_TIERS` (`packages/contracts/src/billing.ts:9`), and existing reader/branch rights for financial summaries. Settings use that same paid-commercial gate plus company.setup.manage; a manager need not qualify as a recipient. A current `freeExpenseDrafts` result is a denial; `isFreeExpenseDraftCompany` (`apps/api/src/modules/system-partner-management/application/free-expense-access.ts:10`) and the existing resolver supply that fact. Absence of the free flag, a role, an old paid receipt or a surviving `expense.read` key alone is not proof of a current paid package. Do not infer paid eligibility from an entitlement flag or widen the free route allowlist (:58–83). Free source-drafts shops get **no weekly summary, no opt-in card/home invitation and no tax reminder**, including cached/queued/stale-subscription cases. Missing/unavailable commercial facts fail closed with the existing retry/expense-list exit; never render guessed zero totals.

Path applicability: R1–R8/R11–R15/R20–R21 describe paid summary behaviour after R19 passes; their denial paths keep free shops excluded. R9 global retention and R10 daily retirement apply across cohorts without granting summary access; R12 retains own expired-paid opt-out recovery. R16–R18 remain removed tombstones. R19 covers both paths: paid shops retain existing permission/branch/effective-recipient conditions; free shops are excluded before weekly facts are read or rendered. Source-draft/history, welcome/package-advisor and delivery safety mechanisms stay intact on both paths. No OCR quota, free model access, financial/tax mutation, export, permission key or feature switch is added.

- ไม่ทำพยากรณ์ ไม่ทำเตือนทันทีรายรายการ (Q3 answered: only the weekly card)
- ไม่ให้ร้านปรับเกณฑ์เอง รุ่นแรกใช้ค่าคงที่
- ไม่เปิดหน้าตั้งค่าการแจ้งเตือน/กฎให้แพ็กที่ขาย (คง owner decision 2026-10-04)
- ไม่แก้ quiet hours ของระบบกลาง (§13 B3 แยกงาน)
- ไม่ส่งผ่าน OA ของร้าน (`line_oa`) และไม่ใช้ AI Gateway; ไม่เพิ่ม LINE AI tool; ไม่แก้คำตอบวิธีใช้ที่อนุมัติแล้วในรอบนี้
- ไม่ทำนโยบายเก็บ/ลบ notification ทั้งระบบ — สเปกนี้ลบเฉพาะสรุปรายสัปดาห์ของตัวเอง (§5.6)

## 4. ผู้ใช้และ journey

Keep the owner vocabulary decision: LINE says `แดชบอร์ด`, web says `หน้าแรก` (`docs/plans/sold-ux-owner-decisions-2026-10-13-plan.md:120`); new tax labels stay plain Thai.

| ผู้ใช้ | เว็บ | LINE / กระดิ่ง |
|---|---|---|
| Paid active OWNER + R7 reader, no explicit choice | On by default in existing and new shops; account offers personal stop | Chosen weekday 08:00 if nonquiet; own branches only |
| Paid manager with company.setup.manage | ตั้งค่าร้าน → สรุปรายจ่ายประจำสัปดาห์ → day + eligible-member switches → บันทึกสรุป | Managing alone never enrolls the manager |
| Paid non-owner reader | Off by default; manager may select; account always offers own stop when on | Only if effective on and live rights pass |
| Branch-limited reader | Same selection; list shows that reader's scope, no expense amounts | Own branches + central, no tax row |
| No expense.read, inactive membership or unusable selected branches | Not a candidate, cannot be picked; a former recipient can still stop personally | No summary facts/push |
| Owner with no linked LINE, or LINE channel off | No setup detour; account uses the capability-specific wording in §10.3 | Nonquiet WEB event remains; readable in bell under existing notification.read; LINE SKIPPED(NO_LINE_DELIVERY_TARGET) or existing preference suppression |
| Expired paid | No shop summary setting; own narrow metadata/stop recovery only | No facts/new summary/push |
| Free/nonpaid | No card or home invitation, no settings API access, no summary query | Nothing; source-only free routes unchanged |
| Account merge | Choices move by membership; duplicate choices resolved by last change (§6) | Surviving eligible account, one recipient per covered range |

There is no home-page invitation. The default-owner exception does not bypass expense.read, branch scope, paid eligibility or an explicit off.

## 5. กติกา / ข้อยกเว้น

### 5.1 ช่วงเวลา ฐานตัวเลข และขอบเขต

R19 runs before these queries. For a free shop there is no weekly amount/count/category/withholding query, card, bell item or summary link; its three monthly source-document reads remain governed by `free-expense-quota.ts:9,21–29` and `free-expense-attachment.ts:13–26`, with no AI call by this feature.

- R5/R20: worker cron `{ pattern: '0 8 * * *', tz: 'Asia/Bangkok' }`; shop weekday uses ISO 1–7 (Monday=1 default). Read today's Bangkok civil date from the server, not client input; only matching current paid shops enter collection. Each retry uses the server's actual current Bangkok date and latest setting under lock; an off-day retry creates no new event. Existing event dates/facts are immutable: retry must not relabel an already-created card. Membership cursor/range dedup prevents the daily job and a delayed retry creating two cards for the same covered range; no new persisted worker-run record is needed.
- `weekStart`/`weekEnd` remain DTO names for compatibility, but mean the actual inclusive printed period, not necessarily Monday–Sunday. Use existing `addCivilDays` (`packages/contracts/src/civil-date.ts:126–128`), not a new date dependency. End is yesterday. For a recipient who stays on and eligible with a cursor no older than 31 civil days, start is cursor+1 with **no seven-day maximum**: a day change can produce one longer or shorter card, with no gap or overlap in continuing coverage. A day edit while ON never resets the cursor. Always print actual dates, e.g. `28 ต.ค. – 3 พ.ย.`; snapshot pending/overdue values remain asOf, not attributed to that expense period.
- **R20 fresh-start rule — C1 closed by controller 2026-11-04:** the first evaluated period/card with no cursor, explicit OFF→ON, a missing cursor, or a cursor **older than 31 days** uses `[today−7, today−1]`; dates before that fresh start are not carried. Evaluate age against today's Bangkok civil date: fresh iff `cursor < addCivilDays(today, -31)` (strictly older); exactly 31 days uses cursor+1 through yesterday, 32 days uses seven days. If cursor is already yesterday, skip the already-covered run. An ineligible check neither advances nor clears cursor; the next eligible check covers a pause while cursor age is ≤31 days, otherwise starts fresh. For example, cursor 1 Nov and eligible check 12 Nov produce **one 2–11 Nov ten-day card**. Successful quiet checks count as covered cursor intervals, so quiet→active uses cursor+1 instead of resetting to seven days. Current `NotificationEvent` stores payload/dedupKey but no period column (`apps/api/prisma/schema.prisma:1543–1570`); `buildDedupKey` joins the supplied period key (`notification.logic.ts:14–30`). Keep the accepted membership cursor; no extra schema, period-history query or dependency is required for this decision.
- R2/A1 comparison: compare equal-length immediately preceding windows, not a short transition card against a full calendar week; label `เทียบช่วงก่อน` on non-seven-day periods, with the actual preceding range in payload. Disable A1 for non-seven-day periods instead of rescaling its fixed 4–8-week threshold; seven-day baseline groups use trailing seven-day windows anchored at periodStart, not SQL calendar-week bins. A2 uses actual periodStart for “new”. R4 tax month/deadlines derive from the run date, never periodStart; see §5.3.
- "เดือนภาษี" ของการ์ด = เดือนปฏิทินก่อนเดือนของวันตรวจที่ตรึงไว้ (การ์ด 2 พ.ย. → ต.ค.)
- ฐาน: `ExpenseRecord.status='CONFIRMED'`, ตาม `expenseDate` (civil), ยอด `grandTotalAmount`; หมวดใช้ `ExpenseLine.expenseCategoryId` ผลรวม `lineTotalAmount` แบบเดียวกับ `income-expense-ledger.use-case.ts:161-165`
- **ขอบเขตสาขา: `branchScopeWhere(access.scopes)`** (`branch.logic.ts:80-83`) — ผู้ใช้ไม่จำกัดสาขา = ทั้งร้าน; ผู้ใช้จำกัดสาขา = สาขาของตน + รายการส่วนกลาง ตาม helper สิทธิ์เดิม (ตัวอย่าง: สาขา 100 + ส่วนกลาง 200 → การ์ดบอก 300) — ต่างจากหน้าแรกเมื่อเลือกสาขาเดียว (exact match) ซึ่งเป็นการเลือกมุมมอง ไม่ใช่ขอบเขตสิทธิ์; ระบุใน sub ของการ์ด (§10.5)
- "ใบเสร็จรอตรวจ" ใช้สถานะ `EXPENSE_PENDING_STATUSES` และเงื่อนไขเดียวกับ `expense-summary.provider.ts:75-77`; "ค้างจ่าย" ตาม `:78-81` — ทั้งสองค่า ณ เวลาสร้างการ์ด ภายใต้ขอบเขตข้างบน
- การ์ดเป็นสรุปตามสัปดาห์และขอบเขตที่ระบุ; ปุ่มหน้าแรก/รายการไม่อ้างว่ายอดตรงกัน เพราะช่วงเวลาและมุมมองต่างกัน และหน้าแรกยังมี B9
- เงิน 2 ตำแหน่งพร้อมคั่นหลักพัน + "บาท" ตาม `DashboardPages.tsx:91`
- **สกุลเงิน: ทุกยอดเงินนับเฉพาะ `upper(currency) = 'THB'`** — รวม, เทียบสัปดาห์, หมวด, ค้างจ่าย, A1, A2 (เกณฑ์เป็นบาท) — เพราะไม่มีอัตราแลกเปลี่ยนให้แปลง; ถ้ามีรายการไม่ใช่บาทที่จะเข้ากลุ่มของแถวเงินใด ๆ ให้เพิ่มแถว `สกุลเงินอื่น (ไม่รวมด้านบน)` → `{N} ใบ` (นับใบ ไม่บวกเงิน); แถวนับใบ (รอตรวจ, อาจซ้ำ, ใบเบิก) ไม่กรองสกุล; B8 (ledger) และ B9 (หน้าแรก) ถูกบันทึกเป็นงานแยก; รอบนี้ไม่แก้ยอดหรือ export ของหน้าเหล่านั้น

### 5.2 กติกา "เรื่องที่ควรดู" (ค่าคงที่ใน `expense-weekly-summary.logic.ts`)

| สัญญาณ | เงื่อนไขขึ้นแถว | ข้อมูลที่ใช้ |
|---|---|---|
| A1 ยอดสูงกว่าปกติ | ประวัติ N สัปดาห์ก่อน `weekStart` โดย N = จำนวนสัปดาห์หลังรายจ่ายยืนยันแรกของร้าน จำกัด 4 ≤ N ≤ 8 (N < 4 ไม่ประเมิน); `mean` = ผลรวม N สัปดาห์ ÷ N (สัปดาห์ที่เป็น 0 นับด้วย); ขึ้นเมื่อ `ยอดสัปดาห์นี้ − mean ≥ 3,000.00` **และ** `ยอดสัปดาห์นี้ ≥ 2 × mean`; ค่าที่แสดง = `ยอดสัปดาห์นี้ − mean` ปัด 2 ตำแหน่ง | `$queryRaw` trailing seven-day buckets anchored at periodStart; no A1 on transition lengths other than seven |
| A2 ผู้ขายใหม่ยอดสูง | ตัวตนผู้ขาย = เซตกุญแจ {`cp:<vendorCounterpartyId>` ถ้ามี, `tax:<เลข 13 หลักที่ตัดอักขระอื่นออก>` จาก `vendorTaxIdSnapshot` หรือ `AccountingCounterparty.taxId` ของ counterparty ที่ผูก}; รายการที่ไม่มีกุญแจเลย **ไม่นับ**; รวมยอดยืนยันในสัปดาห์ต่อผู้ขาย (รวมกลุ่มเมื่อกุญแจซ้อนกัน) ≥ 3,000.00 (ยอดในสัปดาห์คิด **ในขอบเขตของผู้รับ** `branchScopeWhere`) และ **ไม่มี** รายจ่ายยืนยันใดของร้าน (ทั้งร้าน ทุกสาขา — query ประวัตินี้ **ไม่ใช้** `branchScopeWhere`) ก่อน `weekStart` ที่มีกุญแจตัวใดตัวหนึ่งตรงกัน; ร้านต้องมีประวัติ ≥ 4 สัปดาห์ — ครอบคลุมทั้งกรณีของเก่ามีแค่เลขภาษีแล้วของใหม่ถูกผูก counterparty (`expense-draft.use-case.ts:1067`) และกลับกัน | `NOT EXISTS` ด้วยกุญแจทั้งสองแบบ |
| A3 อาจซ้ำ | `duplicateStatus='POSSIBLE_DUPLICATE'` และ `status NOT IN ('REJECTED','VOIDED')` ในขอบเขต (ณ เวลาสร้าง) > 0 | ตัวจับซ้ำเดิม |
| A4 ใบเบิกรอจ่ายนาน | เฉพาะผู้รับที่มี `reimbursement.payment.record`; `status IN ('READY_FOR_PAYMENT','PARTIALLY_PAID')`, `cancellationPendingAt IS NULL`, `claimPaymentDuplicateBlock(r, policy) !== 'CONFIRMED'` (`reimbursement.logic.ts:812`), และ `payableSince < now − 7 วัน` (เข้มงวด: ครบ 7 วันพอดียังไม่ "เกิน") โดย `payableSince` คำนวณด้วย **ฟังก์ชันเดียวกับ scan** (ย้ายตรรกะ `workflow-scan-candidates.use-case.ts:216-220` เป็น pure `claimPayableSince(request, lastVoidAt)` ใน `reimbursement.logic.ts`; void ล่าสุดจากคำสั่งแบบ `prisma-workflow.repository.ts:211-220`) — ใบที่เพิ่งถูกยกเลิกการจ่ายวันนี้จะไม่ขึ้นทันที; ขอบเขต `branchScopeWhere` | ไม่พึ่ง `slaHours` |

แสดงหมวดสูงสุด 3 แถว และผู้ขายใหม่สูงสุด 2 แถว (ที่เหลือ: `ผู้ขายใหม่อีก` → `N ราย`) เรียงตามยอดจากมากไปน้อย **ไม่มีเลขลำดับ ไม่มีคำว่า "อันดับ"**

### 5.3 วันยื่นภาษี

R4 covers **PND3/PND53 expense withholding only**, which every sold pack records. Lower packs have no ภ.ง.ด. page: this is information only, with no form button; the same card still offers the sold home/expense/account exits. UI uses the plain labels in §10.5; exact form names here identify the internal form and legal output. **VAT/ภ.พ.30 reminder removed 2026-10-26 (ceiling)**, including VAT-fact reads, helper, tests and Q6.

| แบบ | ขึ้นแถวเมื่อ (เดือนภาษี M) | ตามกฎหมาย | ทางอินเทอร์เน็ต |
|---|---|---|---|
| ภ.ง.ด.3 และ ภ.ง.ด.53 (แถวแยกต่อแบบ) | อ่านรายการจ่ายด้วย adapter เดียวกับหน้า ภ.ง.ด. — `ExpenseSourceAdapter.findConfirmedWithWhtByCompany` (`tax/infrastructure/adapters/expense-source.adapter.ts:70-135`: รายจ่าย `CONFIRMED` `whtAmount > 0`, exclude explicitly bank-remitted `whtRemittance=E_WHT` when the e-WHT source contract lands (§5.3 of `e-withholding-tax-payment-spec.md`; legacy absent/null stays ordinary), เฉพาะรายการจ่าย `paidAtConfirmed` `:111` (`schema.prisma:2910`), วันจ่ายเป็นวันของงวด `:119`, ประเภทผู้รับเติมจากคู่ค้า `:84-89`) กรองวันจ่ายในเดือน M → จัดแบบด้วย pure `withholdingFormType(kind, category)` ที่ย้ายออกจาก `sync-tax-events.use-case.ts:60-77` (ไม่รู้ประเภทผู้รับ = ไม่นับ; `SEPARATE_PND2` = ภ.ง.ด.2 ไม่ขึ้นแถว) → แปลงแถวเป็นรูปที่ helper รับ (`sourceType: 'expense.record'`, `sourceId: row.id`, `sourceLineKey: row.sourceLineKey` — `source-reader.port.ts:74`, `withholding-filing-state.ts:73`) → ตัดรายการที่อยู่ในแบบที่ยื่นแล้วด้วย `withholdingPaperPayments(mapped, WhtFiling FILED + lines ของแบบนั้น งวด M)` → **ถ้าความครอบคลุมไม่แน่นอน ไม่ขึ้นแถวของแบบนั้น** (ไม่อ้างทั้ง "ยื่นแล้ว" และ "ยังไม่ยื่น"): มี FILED paper ที่ `rowsCertain = false` (แบบเก่าที่ไม่มีบรรทัดแช่แข็ง — ตรงกับเงื่อนไขที่หน้า ภ.ง.ด. แสดง `rowsUncertainNotice` `generate-wht-report.use-case.ts:197`) หรือมีบรรทัดที่ไม่มี payment key ซึ่งครอบคลุมทั้งเอกสาร (`withholding-filing-state.ts:63` `!key`) สำหรับเอกสารที่มีรายการจ่ายในเดือน M (`withholding-filing-state.ts:73-76`) → ขึ้นแถวของแบบที่ยังเหลือ ≥ 1 รายการ | ภายในวันที่ 7 ของเดือนถัดไป | +8 วัน (วันที่ 15) |

- แหล่งเดิมสำหรับวัน ภ.ง.ด.: ปฏิทินกรมสรรพากร https://www.rd.go.th/62348.html และคำแนะนำ https://www.rd.go.th/39808.html; ข้อความวัน 7/15 และขอบประกาศเป็นข้อมูลวิจัยเดิม ต้องยืนยันต้นฉบับก่อน implementation (ไม่ใช่คำถามเจ้าของ; ไม่เปิด network ในรอบนี้)
- **ข้อจำกัดของผลิตภัณฑ์**: แถวภาษีแสดงเฉพาะผู้รับที่ไม่จำกัดสาขา เพราะระบบไม่รู้ว่าใครรับผิดชอบยื่นของสถานประกอบการใด — ไม่ได้อ้างว่าการยื่นเป็นระดับบริษัท
- คำในการ์ดใช้ "ภายใน" + วันฐาน 7/15 ไม่เลื่อนตามวันหยุด; ยืนยันแหล่งกำหนดวันก่อนปล่อย
- ค่าคงที่ `RD_EFILING_8_DAY_EXTENSION_LAST_STATUTORY_DUE = '2027-01-31'`: วันครบกำหนดตามกฎหมายเลยวันนี้ → แสดงวันตามกฎหมายอย่างเดียว จนกว่าจะอัปเดตค่าคงที่
- แถวขึ้นเฉพาะการ์ดที่สร้างสำหรับวันตรวจ **ไม่เกิน** วันยื่นทางเน็ตของงวด; วันตรวจเปลี่ยนตามวันร้าน ไม่ย้ายเดือนภาษีตามช่วงรายจ่าย. Recheck the current civil date at LINE retry: if the stored deadline has passed, omit the tax row from the LINE rendering (stored bell retains its asOf/range); do not send an expired instruction. After the due date no new tax row. Bell wording includes the historical asOf date, so an old 13-month card does not present an expired deadline as a current instruction. No standalone tax reminder on off-days or quiet runs.
- ไม่ใช้สถานะ `TaxPeriod` ตัดสินว่ายื่นแล้ว: แบบหนึ่งยื่นแล้วไม่ได้แปลว่าอีกแบบยื่นแล้ว และรายการจ่ายที่มาทีหลังอาจไม่อยู่ในแบบที่ยื่น — ใช้ความครอบคลุมรายรายการข้างบนเท่านั้น

### 5.4 สัปดาห์เงียบ

R5: evaluate the selected run once per recipient. ไม่สร้าง event เลยเมื่อ: ยอดยืนยัน (บาท) สัปดาห์นั้น = 0 **และ** ไม่มีรายจ่ายยืนยันสกุลอื่นในสัปดาห์นั้น **และ** รอตรวจ = 0 **และ** ไม่มีแถว A1–A4 **และ** ไม่มีแถวภาษี — ค้างจ่ายเก่าอย่างเดียวไม่ทำให้ส่ง; สัปดาห์ที่มีแต่รายจ่าย USD ยืนยันแล้ว **ไม่เงียบ** → การ์ดมี `รายจ่ายยืนยันแล้ว` `0.00 บาท` + `สกุลเงินอื่น (ไม่รวมด้านบน)` `{N} ใบ`

Quiet coverage is not an event: store `CompanyMembership.weeklySummaryCheckedThrough` on each successful quiet evaluation in the same transaction as eligibility/period decisions. No event, delivery or hidden bell row is created (Q4). Quiet→active starts at cursor+1 through yesterday while cursor age is ≤31 days; the missing/older-than-31/OFF→ON fresh-start exceptions in §5.1 use seven days. Failed reads/transactions and ineligible checks neither advance nor clear cursor; a repeated successful run is skipped. Quiet intervals were checked even though they do not appear in a card, and earlier dates are not carried across an explicit fresh start.

### 5.5 ต้นทุน

- AI: zero calls and zero customer AI charge. Default-on owners increase OA spend immediately; paid-only is not opt-in-only.
- No live shop count, OA package or price is asserted. For a stable weekday month: `weekly LINE attempts ≤ 5 × Σ_paid_shops(eligible default-on owners not explicitly off + eligible explicitly-on nonowners)`; estimate `paid shops × average eligible owners × up to 5 + selected nonowners × up to 5`, then add other OA notices. A person in two shops counts twice; owners without LINE still get bell but make no LINE call.
- Day changes can create extra selected-day checks within a calendar month; **5 is the stable-weekday estimate, not a universal bound**. Each actual saved weekday change adds **at most one extra card per effective recipient**; the day-change allowance is at most `weekday changes × effective LINE-linked recipients`, plus conservative retries and other OA notices. Keep the accepted base formula; no rate limit or day-change restriction is added.
- Q5 answered as a controller task: before release inspect the actual LINE OA package and shared traffic, propose the capacity/cost figure and record evidence. This is a release prerequisite, not another owner question. For example, Monday→Tuesday for 3 Nov and then back to Monday before 9 Nov are two changes; five Mondays plus 3 Nov can produce six cards, so the base formula needs the bounded day-change allowance. Pricing/deadline research remains unverified historical context; no network/live data in this round.
- Delivery uses the existing shared OA and channel-scoped identity (`notification.use-cases.ts:382–399`), not a shop OA. Formula includes all relevant notices using that OA; no new quota monitor or billing feature.

### 5.6 การเก็บข้อมูลของสรุป

- ไม่มีงานลบ notification ของระบบให้พึ่ง (§1) → daily 08:00 summary sweep มีขั้น purge **แยกจาก loop subscriber และทำเสมอ**: ลบ `NotificationEvent` ที่ `triggerKey='expense.weekly_summary'` และ `createdAt < now − 13 เดือน` **ของทุกบริษัท ไม่ว่าบริษัทนั้นยังมีผู้สมัคร หรือยัง ACTIVE หรือไม่** (ทีละ batch ≤ 1,000 แถวจนหมด) — recipient/delivery ลบตาม cascade (`schema.prisma:1587,1610`); ทำแม้ loop ส่งมี failure — 13 เดือนพอเทียบปีต่อปี; เปลี่ยนได้ด้วยค่าคงที่ `WEEKLY_SUMMARY_RETENTION_MONTHS`
- เก็บชื่อผู้ขายเฉพาะแถว A2 (≤ 2 ชื่อ) ไม่เก็บเลขผู้เสียภาษีในการ์ด

## 6. Data model (additive)

R1/R21 stores **only explicit choices** using the already-planned table; do not use global NotificationPreference or backfill every owner. Its first saved trigger list is frozen (`notification.use-cases.ts:366–372`).

```prisma
model ExpenseWeeklySummarySubscription {
  id           String            @id @default(cuid())
  companyId    String
  membershipId String            @unique
  enabled      Boolean           // explicit on OR off; no row is the role default
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt
  company      Company           @relation(fields: [companyId], references: [id], onDelete: Cascade)
  membership   CompanyMembership @relation(fields: [membershipId], references: [id], onDelete: Cascade)
  @@index([companyId])
}
// Additive fields, not a new configuration service:
// Company.expenseWeeklySummaryWeekday Int @default(1) + CHECK (1 <= value <= 7)
// CompanyMembership.weeklySummaryCheckedThrough DateTime? @db.Date
```

- R1: effectiveOn = explicit.enabled when a row exists, otherwise active role key `OWNER`; then require ACTIVE membership, live R7 reader predicate and R19. Current resolver ignores disabled roles (`prisma-permission-resolver.repository.ts:81–94`); identify owner by key, never Thai display name. Schema membership/role links have no one-owner-per-company constraint (`schema.prisma:998,1038–1044`); several owners may default on. Employee provisioning itself cannot assign OWNER (`employee-access.logic.ts:10–11`); this feature creates no new owner/grant path.
- Existing and new eligible owners with no row default on without an owner data backfill. Explicit false for an owner remains false across scans/restarts/role changes. DELETE personal stop **upserts false**, never deletes the row (deleting would reenable an owner). A manager can later set true; last committed explicit change wins, visible in both account and settings.
- R20: events have **no periodKey column** (`schema.prisma:1543–1570`); it is only part of dedupKey (`notification.logic.ts:14–30`). Do not parse colon-joined keys (source ids can contain punctuation), and do not use OPEN-only history. Existing payloadJson can store `{card, periodStart, periodEnd}` for real cards. It cannot represent quiet checks because Q4 creates no event; retention also deletes history after 13 months. Therefore the smallest durable extra fact is nullable `weeklySummaryCheckedThrough` on existing membership, independent of explicit-choice rows. No row/cursor backfill. Explicit OFF→ON clears that membership cursor under the same membership lock for a fresh first period; saving ON while already effectively ON never resets it. Endpoints may read it for scheduling, never expose another member's finance facts.
- Sweep advances cursor only with committed event+recipient/delivery creation or successful quiet evaluation; retries observe the cursor and same dedup key. Default owner has no choice row, so enumerate ACTIVE memberships and resolve current roles/rights, not subscriptions. Use membership FOR UPDATE for cursor/choice reads even if no preference row exists. First/re-enabled/missing/older-than-31 fresh starts and the continuing cursor+1 rule are fixed in §5.1 (controller C1 closed); ineligible checks leave cursor intact, and a day change never resets it.
- R8 `move`: choice/cursor follow unchanged membership id (`account-merge.use-case.ts:215–219`); move only queued weekly NotificationRecipient.userId to the surviving user. `close_duplicate` (:206–213): after both membership rows are locked, choose the newer explicit choice by updatedAt; a single explicit off beats a missing default. Equal timestamps use false as the privacy-preserving tie-break; audit source, previous and resulting choice. Do not OR two choices. Retain the surviving membership's scopes; do not assume equal role keys mean equal branch scopes (`account-merge.logic.ts:14–19,49–63`). Scope-change rules R7 suppress incompatible stored cards. For equal current audience keys (scopeKey, canPayClaims, companyWide), keep max(source checkedThrough, survivor checkedThrough), treating null as absent. Keep at most one pending event per actual range; if the survivor has that range already in any status, resolve the closed member's pending copy. Otherwise move that weekly recipient to the survivor and remap sourceId/card.audience.membershipId to survivor id, retaining frozen dates/facts and the original dedupKey; the advanced cursor prevents a sweep recreating that range under a new key. Do not rewrite a SENT push. If audiences differ, resolve source's pending weekly cards, retain only survivor cursor/card audience and do not replay the closed member's broader scope. Resulting effective OFF resolves all remaining pending weekly events for the survivor. No financial permission is widened. Apply closed C1 age/fresh-start rules to the resulting survivor cursor; do not claim a historical no-gap guarantee across different audiences.
- Merge already locks membership rows first (`account-merge.use-case.ts:160–163`). Summary merge additions must not acquire Company/advisory locks afterwards: that would reverse the delivery order. Settings/sweep use advisory entitlement → Company → membership rows in sorted id order → explicit choice → event dedup. Merge stays membership-first, touches only weekly preference/cursor/recipient rows after those locks, and never locks Company or invokes event creation. PG tests must prove no wait cycle and no orphan event even for an owner with no preference row.
- Schema in core 2.1 adds the explicit-choice table/backrelations; round 5.1 adds Company weekday and membership cursor, all additive and local-proof migrations only. Retire daily rules/events/deliveries using existing idempotent data steps; no owner subscription inserts in seed/production. Seed fixtures cover missing-owner row, explicit owner off and picked nonowner. Summary event payload extension uses existing payloadJson; no NotificationEvent column added.

## 7. Contracts / API

Personal recovery is a business-permission/term/branch exception only: preserve current authenticated account/session, revoked-session, tenant, legal and platform checks. It never grants access to a disabled account or another member's data. Settings use all ordinary guards; free access is not extended.

`packages/contracts/src/dashboard.ts`:

```ts
export type ExpenseWeeklySummarySubscriptionDto = {
  eligible: boolean;        // current paid eligibility (R19) AND expense.read; never permission alone
  subscribed: boolean;      // effective choice after role default; explicit false is durable
  explicitChoice: boolean | null;
  canManageSummary: boolean; // company.setup.manage, for contextual settings exit
  lineLinked: boolean;      // ExternalIdentity LINE ACTIVE บน channel ระบบ
  canReadBell: boolean;      // current existing notification.read; never grants it
  lineChannelOn: boolean;   // ไม่ได้ปิด LINE ใน NotificationPreference (ไม่มีแถว = เปิด)
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  nextCheckDate: string;    // next regular selected-day check, not a retry/push promise
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
  watch: ExpenseWeeklySummaryRow[]; tax: Array<ExpenseWeeklySummaryRow & { dueDate: string }>;
  buttons: Array<{ label: string; path: string }>;
  managementHint?: string; // only current company.setup.manage; no stored authority
};
```

| Method | Path | Guard | ผล |
|---|---|---|---|
| GET | `/v1/companies/:companyId/expense-weekly-summary/me` | Exact authenticated session + route/header tenant + own existing membership; metadata only, no notification.read/expense.read required; free/nonpaid denied except expired-paid cleanup | DTO ของผู้เรียกเอง (ร้านหมดอายุ: `eligible=false`) |
| PUT | `/v1/companies/:companyId/expense-weekly-summary/me` | removed from personal enrollment surface 2026-11-04 | A nonowner cannot self-enroll; manager selection is the settings PATCH below. No retained PUT bypass. |
| DELETE | `/v1/companies/:companyId/expense-weekly-summary/me` | Exact session + tenant + own membership, no notification.read/expense.read business guard; must pass even when those rights are removed and (ก) แพ็กหมดอายุแต่ยังไม่ถูกระงับ — ยกเว้นจากด่านวันหมดอายุแยก `auth.guard.ts:295-309` (`isTermExpiryExempt` `:108-111`); (ข) ถูกระงับเพราะหมดอายุ — ต่อเข้า `allowTermRecovery` (`:246`) ด้วย `isExpenseWeeklySummaryRecoveryRoute` (เฉพาะ GET/DELETE path นี้ — pattern `isAccountEmailRecoveryRoute` `:69-73`); (ค) สาขาที่เลือกถูกปิดหมด — resolver ปฏิเสธก่อน (`prisma-permission-resolver.repository.ts:111-112`) จึงต้องใช้บริบทแคบที่ไม่ผ่าน resolver: use case ตรวจแค่ session user + `CompanyMembership(companyId, userId)` มีอยู่ (§16.1 M7) — ทางออกกดได้เสมอ | ล็อกแถว membership `FOR UPDATE` ก่อน (ลำดับเดียวกับด่านส่ง §8) แล้ว upsert explicit `enabled=false` + resolve event สรุปที่ยัง OPEN ของ membership นี้ (push ที่ค้างจะถูกระงับด้วยเช็คสถานะ event ตอนส่ง `notification.use-cases.ts:514`) + audit `expense_weekly_summary.unsubscribe`; already false = 200 with no duplicate audit |
| GET | `/v1/companies/:companyId/expense-weekly-summary/settings` | company.setup.manage + R19, ordinary gates (no expiry recovery) | Current weekday and only R7-eligible active membership names/scope labels/effective switches/explicit choice; no expense amounts, email or LINE ids. Manager need not personally have expense.read. |
| PATCH | same settings path | company.setup.manage + R19, rechecked transactionally | Strict partial body `{ weekday?: 1..7, choices?: [{membershipId, enabled}] }`; only changed switches, no full stale roster replacement. Reject duplicate/foreign/inactive/non-reader ids atomically; roster rights rechecked before write. Upsert explicit choices, update day only if sent, audit before/after; return canonical saved state. |
| POST | `/v1/internal/notifications/weekly-expense-summary-sweep` | worker token (`internal.controller.ts:28-60`) | `{ processed, created, existing, quiet, skippedNoAccess, purged, failures }`; failures > 0 → non-2xx |

**R21 settings save:** fail R19/management before summary settings, recipient list or facts reads (authentication/commercial lookup is still necessary). Reuse guard `@RequirePermissions('company.setup.manage')` from `apps/api/src/modules/expenses/presentation/http/expense.controller.ts:796,808`; no new key. In the transaction, advisory shared entitlement → Company FOR UPDATE (`lock-plan-term-company.ts:4–5`) → affected memberships sorted FOR UPDATE → choice rows. Resolve manager and candidates using the existing tx-bound resolver, then update only submitted fields. Two managers serialize; on the same field, last committed save wins; disjoint switch edits do not erase one another. Personal stop locks its membership before upsert(false), so it orders with either manager and send. An id rejected after role revocation returns one sentence `รายชื่อผู้รับเปลี่ยนแล้ว โหลดรายชื่ออีกครั้ง` and [โหลดรายชื่อ] without discarding other draft edits. Resolver/infrastructure failure aborts the operation with retry, not a partial or empty candidate list; expected missing rights excludes that candidate. Audit only actual changes. No setting change rewrites a frozen existing card, sends immediately or reopens a resolved event.

**Sweep** `CreateWeeklyExpenseSummariesSweepUseCase` (`notification-sweeps.use-cases.ts`):

1. Daily 08:00, qualify current paid companies first; read current chosen weekday against today on every attempt. Skip off-day shops; global retention runs regardless. Only then enumerate ACTIVE memberships; no no-row owner is missed.
2. Per membership under existing advisory → Company → membership locks, re-read R19, weekday, live active roles, expense.read/branch predicate and explicit choice. effective off/ineligible → no provider facts. Owner default never substitutes for a reader right.
3. Compute the actual inclusive range under §5.1: fresh start = last seven days for first/missing cursor, explicit OFF→ON, or cursor strictly older than 31 days; otherwise cursor+1 through yesterday, without a seven-day maximum. Provider receives those exact bounds. Quiet result advances successful-check cursor but creates no event/delivery. Ineligible checks leave cursor unchanged, not cleared; failed reads/transactions do not advance it. Exactly 31 days remains continuing coverage, 32 days starts fresh. Frozen event dates remain immutable on retries.
4. Nonquiet: create event/recipient/deliveries and advance cursor in the same transaction through `createEvent.executeInTransaction({onlyIfAbsent:true,...},tx)`. Use `triggerKey='expense.weekly_summary'`, `sourceId=membershipId`, `periodKey=periodStart+'..'+periodEnd`, stored `{card, periodStart, periodEnd}`, `supersedeBy='source'`; the existing dedup builder includes company/trigger/source/member and this range. One event per member+range in any event status, including owner default with no choice row. A retry uses the same frozen range and cannot duplicate after day edits; no second same-run event when the cursor is already at yesterday. Card dates and dedup period must agree. A delayed retry re-evaluates today’s chosen-day gate before making any new range; it never reuses an old job date as authority.
5. Always purge summary events older than 13 months for all companies, independent of recipients/day/company status; failures remain retryable/non-2xx. Retry must not relabel another day's event or skip uncommitted dates.

**Supersession**: `resolveEarlier` รับ option ใหม่ `matchBy: 'record' | 'source'` (ค่าเดิม `record` = พฤติกรรมเดิมทุก byte); `source` จับ `sourceModule + sourceType + sourceId` (= membership เดียวกัน) **และ** `createdAt < event.createdAt` แม้ event มี `deepLinkHref` — ไม่ใช้ลิงก์หน้าแรกร่วม (`prisma-notification.repository.ts:194`) ที่ทำให้ event ของคน B ปิด event ของคน A

**Delivery**: `ProcessQueuedDeliveryUseCase` เดิม + ด่านสำหรับ `expense.weekly_summary` ใน transaction ส่ง ตามลำดับล็อกใน §8 ข้อ 2; ผ่านแล้วใช้ `buildExpenseWeeklySummaryLineMessage(card, companyId, { canManageSummary, todayCivilDate })` แทน `buildLineMessage` (`:544-551`)

**Model keys** (`notification.model.ts`): เพิ่ม `'expense.weekly_summary'` ใน `IMPLEMENTED_TRIGGER_KEYS`, `ALWAYS_DELIVERED_TRIGGER_KEYS` (owner-default/manager-selected explicit exception — frozen trigger lists must not cut it, but existing LINE-channel off still applies), `NOTIFICATION_TRIGGER_FEATURE_KEYS['expense.weekly_summary'] = ['expenses']`; **ลบ** `'daily_owner_summary'` ออกจาก `IMPLEMENTED_TRIGGER_KEYS` และเพิ่ม `RETIRED_TRIGGER_KEYS = ['daily_owner_summary']` (ใช้กรองใน `ListRulesUseCase` และปฏิเสธใน `UpdateRuleUseCase`)

**เลิกสรุปรายวันจริง**: `CreateDailyOwnerSummaryUseCase.execute` คืน `{ skipped: true, reason: 'retired' }` โดยไม่ generate snapshot และไม่สร้าง event — ทั้ง sweep (`notification-sweeps.use-cases.ts:106-129`) และ internal route (`internal.controller.ts:128-139`) จึงไม่มีผล; cron/BullMQ repeatable คงไว้ (ลบ case ออกจะเกิด log `unknown_job_kind` ทุกวันเพราะ repeatable ค้างใน Redis)

## 8. สิทธิ์ ABAC และขอบเขต tenant

- Effective recipient/read summary facts ได้เฉพาะร้านที่ผ่าน R19 และมี `expense.read`; ยกเลิกของตนตาม narrow recovery path เดิมได้แม้ paid term หมดอายุ. Free shops remain outside the summary-route allowlist; the recovery exception must not open summary facts or enrollment to them.
- ตรวจสิทธิ์ **สามจุด**:
  1. ตอนสร้างการ์ด (sweep) — R19 ก่อน data query; `resolveAccess` รวม entitlement filter (`feature-gate.logic.ts:120-123`)
  2. **ตอนส่ง LINE** — ใน transaction เดียวกับการยิง LINE ตามลำดับล็อกนี้ (ห้ามลัด ห้ามเหลือแค่ตรวจ subscription):
     a. advisory entitlement แบบ shared (มีอยู่ `notification.use-cases.ts:498`)
     b. `SELECT id FROM "Company" WHERE id = $1 FOR SHARE` — ชนกับ `FOR UPDATE` ที่ผู้แก้สิทธิ์/บทบาท/สาขา/สถานะสมาชิกถือผ่าน `lockPlanTermCompany` → การถอดสิทธิ์ที่กำลังทำต้อง commit ก่อนเราอ่าน หรือรอจนเรายิง LINE และ commit แล้ว
     c. แถว membership `FOR UPDATE` (มีอยู่ `:506-513`) — DELETE personal off locksแถวเดียวกัน จึงเรียงลำดับกับการส่ง
     d. Recheck R19 with the transaction-bound resolver and current paid term before using the stored card; then อ่าน explicit choice/effective owner default และสิทธิ์ปัจจุบัน (role permissions, entitlement filter, branch scope) **หลัง** b–c — Resolver ไม่มี tx parameter (`permission-resolver.service.ts:12–13`, repository constructor `:11`); reuse the transaction-bound constructor pattern at `notification.use-cases.ts:206–211`: instantiate the existing `PrismaPermissionResolverRepository` with `{ client: tx } as PrismaService`, wrap it in existing `PermissionResolverService`, then call `resolveAccess`; every permission/entitlement/branch query uses that tx, with no port/signature change; เทียบ `expense.read`, `scopeKey`, `canPayClaims`, `companyWide` กับ `audience`
     e. ไม่ผ่าน → `SUPPRESSED` `SUMMARY_AUDIENCE_CHANGED` (ไม่ retry); ผ่าน → ยิง LINE แล้ว commit
     ผล: การถอดสิทธิ์/ยกเลิกที่ commit ก่อน b/c ถูกเห็นเสมอ; ที่เริ่มหลังจากนั้นต้องรอจนส่งเสร็จ (= ส่งก่อนถอด) — ไม่มีช่องที่อ่านสิทธิ์เก่าแล้วยิงหลังการถอด commit; ผู้แก้สิทธิ์ที่ยัง **ไม่** ล็อก `Company` (ต้องไล่ให้ครบ §16.1) ต้องเพิ่ม `lockPlanTermCompany` ก่อนปล่อย; ลำดับ advisory → Company → membership ต้องตรงกับผู้แก้ entitlement (advisory ก่อน — `set-partner-features.use-case.ts:253`) เพื่อไม่ให้ deadlock
  3. **ตอนแสดงในกระดิ่ง**: R19 must pass before weekly list/unread reads, filtering or counts; free shops see neither the stored card nor its amount/tax rows.  `ListNotificationsUseCase` และ `GetUnreadCountUseCase` กรองก่อนแบ่งหน้า (ตามหลัก `prisma-notification.repository.ts:21-25`) — ผู้ดูที่ไม่มี `expense.read` ไม่เห็น `expense.weekly_summary` เลย; มีแล้วเห็นเฉพาะ event ที่ `payloadJson.card.audience.scopeKey` เท่ากับขอบเขตปัจจุบัน และ `canPayClaims`/`companyWide` ไม่กว้างกว่าสิทธิ์ปัจจุบัน (Prisma JSON path filter)
- ตัวเลขทุกตัว `where companyId` + `branchScopeWhere(scopes)`; A2 "ใหม่" ตรวจประวัติทั้งร้าน (บอกแค่ว่าใหม่หรือไม่ ไม่เปิดเผยรายการสาขาอื่น)
- Personal endpoint never accepts userId/membershipId. Settings accepts only validated membership ids from this shop’s current eligible roster; route/header tenant must match. No AI Gateway or financial mutation.

## 9. State transitions

```
(no explicit row) + live OWNER + R7/R19 => effective ON; no row + nonowner => OFF
manager PATCH true/false => explicit row; self DELETE => explicit false (never delete)
last committed write to that member wins; an OFF resolves queued/open weekly events
weekday PATCH => change future eligible checks; does not rewrite frozen cards/cursor
selected day 08:00: ineligible => cursor unchanged; eligible ON => fresh seven days OR cursor+1..yesterday (no seven-day cap)
  -> quiet(cursor only) OR card+cursor atomically; failures leave cursor unchanged
WEB => SENT; LINE => SENT | SKIPPED(NO_LINE_DELIVERY_TARGET) | existing suppression/retry
merge => choice by newest explicit write; cursor/audience seam protected under membership locks
all companies, daily sweep => purge weekly events older than 13 months
```

C1 closed by controller 2026-11-04: continuing periods have no seven-day maximum; first/missing/older-than-31 cursor or explicit OFF→ON starts fresh for seven days, without carrying earlier dates. Successful quiet coverage advances cursor; ineligible checks neither clear nor advance it. Daily summary retirement remains inert+retired key+idempotent migration; no other notice adopts owner-default selection.

## 10. UI และถ้อยคำ

### 10.1 LINE card (Flex bubble `mega`, OA ระบบ)

ตัวอย่างสร้างจาก fixture ที่ผ่านทุกกติกา (ใช้เป็น fixture ใน test ด้วย):

- การ์ดส่ง **จันทร์ 2 พ.ย. 2569** สรุปสัปดาห์ 26 ต.ค. – 1 พ.ย. 2569 เดือนภาษี = ต.ค.
- ยอดยืนยันสัปดาห์นี้ 12,450.00; สัปดาห์ก่อน (19–25 ต.ค.) 11,250.00; 8 สัปดาห์ก่อนหน้ารวม 40,000.00 (11,250 + 7 สัปดาห์รวม 28,750) → mean 5,000.00 → 12,450 ≥ 10,000 และส่วนต่าง 7,450 ≥ 3,000 → A1 ขึ้น
- หมวด: วัตถุดิบ 5,200 + ค่าเช่า 4,000 + น้ำมัน 1,850 = 11,050 (อื่น ๆ 1,400)
- ผู้ขายใหม่ "ร้านสมใจ" 4,500.00 (มีเลขภาษี ไม่เคยพบในร้าน; ร้านมีประวัติ 8 สัปดาห์)
- Fixture recipient is a manager-picked nonowner without company.setup.manage; ผู้รับไม่จำกัดสาขา มีสิทธิ์จ่ายใบเบิก; มีจ่ายที่หัก ณ ที่จ่ายให้นิติบุคคล ยืนยันวันจ่ายแล้วใน ต.ค. และยังไม่อยู่ในแบบที่ยื่น (→ ภ.ง.ด.53 เท่านั้น); ทุกรายการเป็น THB; ไม่อ่าน VAT fact

```
[header สีเขียว]  สรุปรายจ่ายประจำสัปดาห์ค่ะ
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
ภาษีที่หักจากบริษัท เดือน ต.ค.   ส่งออนไลน์ภายใน 15 พ.ย.
[footer] [ดูแดชบอร์ด] [ดูใบเสร็จรอตรวจ] [หยุดรับสรุปนี้]
```

- แต่ละแถว = box `baseline` ป้ายซ้าย (`flex 3`, `wrap: true`) ค่าขวา (`flex 2`, `align: end`) — **ค่าเดียวสั้น ๆ ต่อแถว**; หัวข้อย่อยที่ไม่มีแถวไม่แสดง
- ปุ่ม `type: uri` ทั้งหมด `height: sm` เรียงแนวตั้งเต็มกว้าง → **ขนาดเท่ากัน**; "ดูใบเสร็จรอตรวจ" เฉพาะรอตรวจ > 0
- ปลายทาง: `/companies/:id/dashboard`, `/companies/:id/expenses?view=pending`, `/companies/:id/account#weekly-summary` ผ่าน `webLink()` + `withLineExternalBrowserLinks` (`notification.use-cases.ts:785-786,849`)
- `altText`: `[มั่งมีพลัส] สรุปรายจ่าย 26 ต.ค.–1 พ.ย. 12,450.00 บาท` ผ่าน `lineMessagePreview` (≤ 400 ตัวอักษร)
- ไม่มีรายการลำดับตัวเลข ไม่มีปุ่ม postback (ไม่เข้า webhook ไม่เข้า AI).
- End every card with one context-specific line: current company.setup.manage → `เปลี่ยนวันหรือคนรับได้ที่ตั้งค่าร้าน` linking to `/companies/:id/settings/weekly-summary`; everyone else gets only the existing `หยุดรับสรุปนี้` exit. Manager hint is advisory copy, not authorization: recheck at rendering/push, omit if management was revoked. Never open notifications/preferences/rules. The opt-out button stays for managers too. The pure LINE builder gets current management capability and current civil date as explicit render inputs; stored hint or Thai tax text is never parsed for authority/deadlines. Tax rows carry a dueDate civil metadata value, so delayed retry can filter only expired tax rows without new source queries or rewriting the frozen card.

### 10.2 กระดิ่งเว็บ

- title: `สรุปรายจ่าย 26 ต.ค. – 1 พ.ย.`; body: แถวเดียวกับการ์ด `ป้าย: ค่า` คั่นบรรทัด; เปิดแล้วไป `/companies/:id/dashboard` (`notificationSourceHref` คืน `deepLinkHref` ตรง ๆ — `notification.logic.ts:172-177`); การมองเห็นตาม §8 ข้อ 3. At the end append `เปลี่ยนวันหรือคนรับได้ที่ตั้งค่าร้าน` + settings link only for current managers; everyone else gets `หยุดรับสรุปนี้` + account anchor only. Bell list must resolve the live capability before adding the hint, not trust stored managementHint

Current-code integration: `NotificationBell.tsx:106–115` clamps body to two lines and wraps the row in one Link; appending a footer to body would hide it and nesting a new link would be invalid. `NotificationPages.tsx:202–218` uses an overlay link plus pointer-events-none content, so the exit needs a sibling interactive area there too. Smallest change: extend existing `packages/contracts/src/notifications.ts:47–60` NotificationSummaryDto with optional **weekly-only** `weeklySummaryFooter: Array<{label,path}>`; derive it in `ListNotificationsUseCase`/`toSummary` from current ctx (existing mapper `notification.use-cases.ts:863–879`), never persist management authority. Add the optional field to existing dashboard-notifications.model.ts; normalizeNotification already spreads raw properties (`apps/web/src/features/dashboard-notifications/dashboard-notifications.api.ts:146–153`), so no new mapper branch is needed. For this trigger alone render the short management line when allowed and universal opt-out as sibling links outside the clipped body/row link, using relative z-index/pointer events in the centre. Leave all other notices' row, clipping, read/dismiss and routes unchanged. No generic notification action system. Test the real DOM/tab order/no nested anchors and footer visibility for both open and resolved history; permission revocation removes the management line at next read.

### 10.3 "บัญชีของฉัน" (`CompanyProfilePage` accountOnly, `CompanyProfilePage.tsx:523`) — การ์ด `id="weekly-summary"`

- Personal status/opt-out only; no self-enrollment invitation or เริ่มรับสรุป action. If effective on, one quiet action `หยุดรับสรุป`; saves explicit false and shows `หยุดรับสรุปแล้ว`. Effective off: `ไม่ได้รับสรุปนี้`; managers may use a secondary `ตั้งค่าร้าน` link, others retain `กลับไปรายการค่าใช้จ่าย`. The manager screen reflects the last committed personal stop and may later turn it on explicitly; no hidden permanent-priority rule.
- Free/nonpaid never mount/request; own expired-paid previously effective-on or explicit-choice recovery may show only stored personal status/stop, no financial facts or recipient roster. Implement the planned exact GET/DELETE session+membership recovery and async hash support (cold/hashchange) through `COMPANY_PROFILE_SECTION_IDS` (`company-profile.logic.ts:68–75`).
- 390: status above full-width 44px action; 1280/~1556: status left, compact 40px action right; match adjacent account buttons. One sentence per status, no duplicate primary action. Loading is not “off”; read failure has `อ่านสถานะไม่ได้` + `ลองอีกครั้ง`; stop failure retains current choice and uses `หยุดรับไม่สำเร็จ` + `ลองอีกครั้ง`.

| เงื่อนไข (paid/recovery only) | One-line status | Exit |
|---|---|---|
| Effective on, linked, channel on, current paid | `รับอยู่ · วัน{วันในสัปดาห์} 08:00 น.` | หยุดรับสรุป |
| Effective on, LINE unlinked/channel off + current notification.read | `ดูสรุปที่มีได้ที่กระดิ่ง` | หยุดรับสรุป |
| Effective on, LINE unavailable and no notification.read | `ยังรับสรุปทาง LINE ไม่ได้` | หยุดรับสรุป |
| Former recipient ineligible/expired or selected branches disabled | `บัญชีนี้รับสรุปไม่ได้ในขณะนี้` | หยุดรับสรุป (narrow cleanup only) |
| Explicit off / eligible nonowner not selected | `ไม่ได้รับสรุปนี้` | manager: ตั้งค่าร้าน; member: กลับไปรายการค่าใช้จ่าย |

No status promises that a card will be sent: Q4 quiet run creates none. Subscription DTO includes effective choice and nullable explicit choice so missing-row owner ON cannot render as off.

### 10.3a ตั้งค่าร้าน — R21 card and form

Commercial visibility bridge (R19, both paths): current WebSession has freeExpenseDrafts but no paid tier/term (`apps/web/src/common/models/web-session.model.ts:2–31`); plan-term notice also omits tier (`apps/web/src/features/plan-term/plan-term.api.ts:13–24`). Neither “not free” nor “unlocked” proves paid, so do not claim existing session paid facts. Smallest addition: optional display-only `weeklySummaryAccess: 'PAID' | 'PAID_RECOVERY' | 'NONE'` on existing auth/me + WebSession, computed in `AuthController.me` from current Company/term using the same pure R19 predicate (existing display metadata pattern `apps/api/src/modules/auth/presentation/auth.controller.ts:1092–1111`). PAID requires current active paid access; PAID_RECOVERY means only the already-planned own expired-paid cleanup; NONE covers free/trial/no-term/unknown. Missing value hides the new surfaces. No stored switch, no RequestContext permission or authority, no new endpoint/service/constructor dependency. Server settings page (`apps/web/app/(workspace)/companies/[companyId]/settings/page.tsx:13–23`) passes PAID visibility to SettingsMenu/form; account allows PAID or PAID_RECOVERY under R12. Keep the M7 exact own-cleanup recovery path for a company-session branch rejection: lack of an ordinary session result must not suppress that authenticated metadata/stop route or open settings. Verified NONE/free sessions do not mount/request summary UI; a manually supplied cleanup URL still gets a server-only narrow eligibility verdict before any summary metadata, with no free UI invitation. Prove disabled-branch cold navigation in the existing R12 tests rather than treating absent display metadata as proof of a free shop. Ordinary settings API must independently recheck current R19 + setup.manage; stale client metadata cannot authorize it. Auth/me may read current commercial facts but never summary settings/roster/expense/WHT to derive this value.

- Add one ordinary card `สรุปรายจ่ายประจำสัปดาห์` in existing `SETTINGS_MENU_ITEMS` (`settings-menu.logic.ts:21`) next to the **planned** e-WHT card (§5.5 of its spec); e-WHT is not in the current array, so do not claim the neighbour already exists or make this depend on its implementation. Reuse SettingsMenu's ordinary card grid (`SettingsMenu.tsx:88–94`), not an embedded form inside a navigation link. It opens a small dedicated form `/companies/:id/settings/weekly-summary` with route rule anyOf company.setup.manage, same key as existing setup guard (`expense.controller.ts:796,808`; `route-permissions.ts:17`). No notification-settings entitlement/route changes.
- Card one-line hint: `เลือกวันและคนรับสรุปรายจ่าย`. Title at destination: `สรุปรายจ่ายประจำสัปดาห์`; native select `วันส่งสรุป` (จันทร์–อาทิตย์, Monday default), one-line hint `ตรวจเวลา 08:00 น. และส่งเมื่อมีเรื่องให้สรุป`. Below, `คนรับสรุป` lists only current R7-qualified members by name and own-scope label; each has one `รับสรุป` on/off switch with that member's accessible name. Owner no-row defaults on; don't show a duplicate owner-wide switch or non-reader disabled placeholder.
- 390: one column, day select then stacked member rows; switch stays next to name, scope below. 1280/~1556: day field short, member name/scope/switch columns fill content width; no horizontal scroll, ellipsis on Thai names or extra confirmation dialog. More than six candidates adds `ค้นหาชื่อ` and a scrollable member list using existing inputs; no dependency. One primary `บันทึกสรุป` at the shared form action bar after fields, with `กลับไปตั้งค่าร้าน` secondary; equal group heights/widths, 44px phone/40px wide, primary first when stacked. Card itself is a link, not a second primary save.
- Fetch/load error: no empty roster/default-off flash; `อ่านการตั้งค่าไม่ได้` + `ลองอีกครั้ง`/back. Save pending disables double submission but keeps all values; success `บันทึกสรุปแล้ว`; failure `บันทึกไม่สำเร็จ` + `ลองอีกครั้ง`, retain edits. Candidate revoked during editing: `รายชื่อผู้รับเปลี่ยนแล้ว โหลดรายชื่ออีกครั้ง` + `โหลดรายชื่อ`, preserving still-valid edits. Denied/expired: no form/data request after session gate, show existing package/expense-list way out; free card and form are absent. No technical role/permission id in Thai copy.
- Manager without expense.read may configure eligible others but is not a recipient/candidate. Nonmanager readers get their account opt-out only. No new employee-role assignment or e-WHT/VAT setting is implemented.

### 10.4 removed 2026-10-26 (ceiling) — ledger menu/page

No new `รายจ่ายตามหมวด` menu or changes/tests in the accounting-documents ledger. Card destinations are only `/companies/:id/dashboard`, `/companies/:id/expenses?view=pending` (when pending > 0), and the existing sold account page `/companies/:id/account#weekly-summary` for opt-out; R21 adds the manager-only sold shop-settings link, not a fourth financial destination. No withholding-page button is added; lower packs have no sold ภ.ง.ด. page. `view=duplicates` on the existing expense list remains a sold-only helper (plan 3.7), without a fourth card button.

### 10.5 ตารางพื้นผิว × กรณี

| ประโยค/ป้าย | พื้นผิว | กรณี | แสดงอะไร | ทำไมจริง |
|---|---|---|---|---|
| Free source-drafts cohort | Settings/account/home/bell/LINE | Even with expense.read or stale summary data | No summary/card/invitation/tax row or data query | R19; source-only routes remain unchanged |
| `สรุปรายจ่ายประจำสัปดาห์ค่ะ` | LINE | ทุกการ์ด | เสมอ | ส่งเมื่อมีสรุปจริงเท่านั้น |
| `{periodStart}–{periodEnd} · ทุกสาขา` | LINE, กระดิ่ง | ไม่จำกัดสาขา | `ทุกสาขา` | ไม่กรองสาขา |
| — | — | จำกัด 1–2 สาขา | `{ชื่อสาขา} · รวมส่วนกลาง` | นับสาขา + `branchId=null` จริง |
| — | — | จำกัด ≥ 3 สาขา | `{N} สาขา · รวมส่วนกลาง` | — |
| `รายจ่ายยืนยันแล้ว` | LINE, กระดิ่ง | ยอด > 0 / = 0 แต่ไม่เงียบ | จำนวนเงิน / `0.00 บาท` | ฐาน CONFIRMED, THB |
| `สกุลเงินอื่น (ไม่รวมด้านบน)` | LINE, กระดิ่ง | มีรายการไม่ใช่บาทในกลุ่มแถวเงิน / ไม่มี | `{N} ใบ` / ไม่แสดง | ยอดทุกแถวเป็นบาทล้วน ไม่แปลงสกุล |
| `เทียบสัปดาห์ก่อน` (7 days) / `เทียบช่วงก่อน` (transition) | LINE, กระดิ่ง | มากกว่า/น้อยกว่า/เท่ากัน; ก่อนหน้า = 0 | `มากกว่า X บาท` / `น้อยกว่า X บาท` / `เท่ากัน` | เป็นบาท ไม่มี % |
| ชื่อหมวด | LINE, กระดิ่ง | มีหมวด / บรรทัดไม่มีหมวด | ≤ 3 แถว / `ยังไม่จัดหมวด` | ไม่มีเลขลำดับ |
| `งานค้าง ณ {วันส่ง}` | LINE | รอตรวจ > 0 หรือ ค้างจ่าย > 0 | หัวข้อ + แถว | ระบุวันที่ จริงแม้อ่านวันหลัง |
| `สูงกว่าค่าเฉลี่ย {N} สัปดาห์` | LINE, กระดิ่ง | A1 ผ่าน | ส่วนต่างเป็นบาท; N จริง 4–8 | ไม่อ้าง 8 ถ้ามีไม่ถึง |
| `ผู้ขายใหม่ · {ชื่อ}` | LINE, กระดิ่ง | A2 ผ่าน (ทุกทิศของการผูก counterparty) | ≤ 2 แถว + `ผู้ขายใหม่อีก` `{N} ราย` | ใหม่ต่อร้านตามกุญแจทั้งสองแบบ |
| `อาจซ้ำ` | LINE, กระดิ่ง | A3 > 0 | `{N} ใบ` | ตัวจับซ้ำของระบบ |
| `ใบเบิกรอจ่ายเกิน 7 วัน` | LINE, กระดิ่ง | ผู้รับจ่ายได้ + มี / จ่ายไม่ได้ | `{N} ใบ` / ไม่แสดง | นิยามเดียวกับ scan; แจ้งเฉพาะคนเกี่ยวข้อง |
| `ภาษีที่หักจากบุคคล เดือน {M}` / `ภาษีที่หักจากบริษัท เดือน {M}` (แถวละแบบ) | LINE, กระดิ่ง | มีรายการจ่ายของแบบนั้นที่ยืนยันวันจ่ายใน M และยังไม่อยู่ในแบบที่ยื่นแล้ว, ไม่เกินวันยื่นเน็ต, due ≤ 2027-01-31 / due หลังนั้น | `ส่งออนไลน์ภายใน 15 {M+1}` / `ส่งภายใน 7 {M+1}` | จัดแบบด้วยกติกาเดียวกับหน้า ภ.ง.ด.; ยื่นถึงวันนั้นตรงเวลาเสมอ |
| — | — | ไม่มีหัก, วันจ่ายยังไม่ยืนยัน, ไม่รู้ประเภทผู้รับ, จัดเป็น ภ.ง.ด.2, ทุกรายการอยู่ในแบบที่ยื่นแล้ว, จำกัดสาขา, เลยวันยื่น | ไม่แสดง | ไม่อ้างสิ่งที่ไม่รู้ |
| `ดูแดชบอร์ด` | ปุ่ม LINE | ทุกการ์ด | `/companies/:id/dashboard` | ชื่อปุ่มบอกหน้า ไม่อ้างว่ายอดเท่ากับการ์ด |
| `หยุดรับสรุปนี้` | ปุ่ม LINE | ทุกการ์ด | การ์ดในบัญชีของฉัน | DELETE กดได้เสมอ |
| ข้อความบัญชีของฉัน + toast | เว็บ | §10.3 | Status + stop, no start invitation | Effective default/explicit choice, no promised push |
| Paid owner + R7, no row | Settings/account/card/bell | Old/new shop | Owner switch on; selected day; personal stop | Live active OWNER key, no backfill |
| Paid manager with setup.manage, no expense.read | Settings form | Can manage but cannot receive | Day + eligible others; own name absent from recipients | Management and reader predicates differ |
| Paid member reader, no setup.manage | Account/card/bell | Picked or off | Own status/stop; no settings hint/card | No roster read or management link |
| Expired paid | Settings/account | Direct deep link + recovery | No shop setting; narrow personal stop only + package/expense exit | R19 unchanged, no settings recovery |
| Free/nonpaid | All summary surfaces | Even expense.read survives | No setting, summary request/card/reminder | R19 before roster/facts query |
| Member without expense.read | Roster/pick/send | Manager submits stale id or right revoked | Not listed; save rejected; queued push suppressed | Live R7 at candidate/save/send |
| Branch-limited member | Roster/card/bell | Selected branches active | Scope label; own branches + central only, no tax row | Same existing branchScopeWhere |
| `เปลี่ยนวันหรือคนรับได้ที่ตั้งค่าร้าน` | End of LINE/bell | Current manager | One short link line | Live setup.manage, paid shop |
| `หยุดรับสรุปนี้` | End of LINE/bell | Everyone, including manager | Account anchor/stop | Explicit false is durable |
| No LINE identity | Account/bell | Eligible owner on, nonquiet | Bell only when existing notification.read permits it; otherwise stored WEB event without a reachable bell; no LINE promise | Existing WEB send then LINE target skip and ordinary bell guard |

## 11. Impact analysis

| พื้นที่ | ผลกระทบ |
|---|---|
| `dashboard-notifications` (API) | provider method ใหม่, sweep, controller ใหม่, internal route, model keys + retired keys, Flex builder, `payloadJson` + `onlyIfAbsent` ใน create-event, `matchBy` ใน `resolveEarlier`, ด่านส่ง, ตัวกรองกระดิ่ง/unread, daily use case inert |
| `expenses` | read-only (provider "Prisma directly, read-only" `expense-summary.provider.ts:7-10`) |
| `reimbursements` | ย้าย payable-since เป็น pure `claimPayableSince` (scan ใช้ต่อ พฤติกรรมเดิม); read-only สำหรับ A4 |
| `workflow` | `workflow-scan-candidates.use-case.ts:216-220` เรียก `claimPayableSince` แทนโค้ดในที่ |
| `data-model-core` | Reuse `branchScopeWhere` only; no VAT-fact read/helper/change |
| `access-control` | ใช้ `PermissionResolverService` (export `access-control.module.ts:35`) ทั้ง sweep และด่านส่ง |
| `auth` (account merge) | `close_duplicate` selects newest explicit choice in the existing transaction; กรณี move ไม่ต้องแก้ (ผูก membership); ย้าย `NotificationRecipient.userId` ของสรุปที่รอส่ง (§6) |
| `auth` (guard) | route กู้คืน `isExpenseWeeklySummaryRecoveryRoute` สำหรับ GET/DELETE path นี้เท่านั้น (`auth.guard.ts:58-73,246`) |
| `tax` | ลงทะเบียน `ExpenseSourceAdapter` (constructor รับแค่ `PrismaService` `expense-source.adapter.ts:12-13`) เป็น provider ใน dashboard-notifications โดยไม่ import TaxModule; ย้าย pure `withholdingFormType` ออกจาก `sync-tax-events.use-case.ts:60-77` (พฤติกรรมเดิม); ใช้ `withholdingPaperPayments` เดิม |
| `accounting-documents` | Out of scope: no ledger menu/page/summary/contract/export/test changes (Goal 5 removed) |
| สิทธิ์ (employee-access ฯลฯ) | ผู้เขียนสิทธิ์ที่ยังไม่ล็อก `Company` ต้องเพิ่ม `lockPlanTermCompany` (ผลจาก §16.1 M1) |
| `apps/workers` | job kind + cron + case ใหม่ |
| หน้าเว็บ | Account stop, new sold shop-settings card/form beside planned e-WHT, existing expense list; remove home invitation; bell filtering/hint is live; no ledger UI |
| LINE path | push อย่างเดียว; **ไม่แตะ webhook / `process-line-webhook.use-case.ts`** |
| AI tool / help card | ไม่มี tool ใหม่; คำตอบวิธีใช้เป็น follow-up ผ่านการอนุมัติ pack (`approved-product-help.ts` อยู่ใน W00 hash) |
| Export | None in this feature; ledger CSV/XLSX work removed 2026-10-26 (ceiling), AC30 retained as a tombstone |
| Notification | trigger ใหม่; retire `daily_owner_summary` ทุกทาง |
| Billing / entitlement | R19 gates only active paid catalog tiers, excludes free/trial-only access; ทุกแพ็กที่ขาย 249/499/999/1999 (`expenses` + `dashboard_notifications` อยู่ใน starter); ไม่มี feature switch |
| Migration | Explicit-choice table + Company weekday + membership checked-through cursor, additive/idempotent; daily retirement unchanged; no owner backfill |
| W00 manifest | ไม่เปลี่ยนตราบไม่แตะไฟล์ใน `SOURCE_REFERENCES` (`line-ai-capability-manifest.ts:223-248`); คู่มือ (Phase 4) ต้อง regen + whole-chain |
| Whole-chain catalog | ไม่เพิ่ม scenario |
| Browser journeys | `e2e/journeys/shop-menus-everyday.journey.spec.ts` ที่ 390 + 1280 (+ 1556 สำหรับเจ้าของ) |
| Seed | Missing-owner-row/default-on and explicit-off fixtures (no owner enrollment rows); ลบ `daily_owner_summary` จาก `DEFAULT_RULES` (`seed.ts:2795-2806`) |

## 12. Gaps

- G1 แพ็กที่ขายตั้ง quiet hours หรือปิด LINE ไม่ได้ (owner decision 2026-10-04) → "หยุดรับสรุป" เป็นทางเดียวที่หยุดข้อความนี้ — จึงมีปุ่มในทุกการ์ด
- G2 ใบเบิกค้างจ่ายไม่มีการเตือนสำหรับร้านที่ไม่ได้ตั้ง `slaHours` — การ์ดนี้ปิดช่องเฉพาะผู้รับที่ผ่านสิทธิ์และ effective on
- G3 LINE `expense.get_breakdown` ใช้ฐาน "ทุกสถานะยกเว้นปฏิเสธ/ยกเลิก" ต่างจากการ์ด — ไม่แก้รอบนี้
- G4 ไม่มีจอแก้เกณฑ์สัญญาณ
- G5 แพ็กเกจ OA `@695ultfm` และปริมาณข้อความต่อเดือนไม่อยู่ใน git
- G6 ไม่มีการเฝ้าโควตา LINE (`GET /v2/bot/message/quota/consumption` — https://developers.line.biz/en/reference/messaging-api/) — งาน ops แยก
- G7 notification อื่นทุกชนิดไม่มีการลบตามอายุ — สเปกนี้ลบเฉพาะของตัวเอง; นโยบายทั้งระบบเป็นงานแยก
- G8 ผู้ขายที่ไม่มีทั้ง counterparty และเลขภาษี (บิลเงินสดร้านทั่วไป) ไม่เคยถูกจับเป็น "ผู้ขายใหม่"
- G9 notice ชนิดอื่น (ไม่ใช่สรุป) ไม่ย้ายผู้รับตอนรวมบัญชี (`NotificationRecipient.userId` `schema.prisma:1577`) — สเปกนี้ย้ายเฉพาะสรุป; ที่เหลือเป็นงานแยก
- G10 หน้าแรกยังรวมยอดข้ามสกุล (B9) — การ์ดเป็นบาทล้วน จึงอาจไม่เท่ากับหน้าแรกสำหรับร้านที่มีบิลต่างสกุลจนกว่า B9 จะแก้
- G11 — in scope integration gap: permission resolver is bound to `PrismaService` (`apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts:12`) and service has no tx parameter (`permission-resolver.service.ts:12–13`); without a tx-bound resolver instance (M2), a claimed same-transaction permission check would be false. No new public API permission is introduced.
- G13 — future cross-feature integration gap, not a current-code defect: the existing WHT source reader (`expense-source.adapter.ts:70–78,111–131`) returns every confirmed withholding expense. After e-WHT adds `whtRemittance` (e-WHT plan 2.1), R4 must skip explicit `E_WHT` before deciding a payer reminder; otherwise an excluded bank-remitted payment has no FILED payer row and would be wrongly reminded. Add a registered summary test, no bank integration or e-WHT design change.
- G12 — in scope integration gap: the account hash allowlist contains only `shop`, `vat-status`, `account` (`apps/web/src/features/company-profile/company-profile.logic.ts:68`); `#weekly-summary` currently resolves to null and the account effect only scrolls VAT (`CompanyProfilePage.tsx:178–179`). Implement the async anchor in 2.6; no VAT behavior change.

| Gap | Current evidence | Scope / disposition |
|---|---|---|
| G14 — daily producer has no explicit free-cohort exclusion | `apps/api/src/modules/dashboard-notifications/application/use-cases/notification-sweeps.use-cases.ts:115–121` selects enabled rules/active companies; `apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts:303–325` reads a snapshot and chooses OWNER/ADMIN recipients without the free predicate | **Out of scope for a separate daily eligibility fix.** Static gap only; no claim that a free shop received a push. Keep the already-approved R10 retirement of all daily producers; add no free filter, new recipient policy or daily implementation here. |
| G15 — paid-only design gap corrected by R19 | `free-expense-access.ts:61,67–68` keeps granted expense.read while `:72–83` limits routes; the earlier summary design admitted permission alone | In scope: qualify subscription, provider/sweep, bell/send and settings/account surfaces with current paid access; no change to the free predicate or allowance. |

Round-5 gaps (new findings; no current weekly implementation is claimed):
- G16, in scope integration gap: NotificationEvent has no periodKey column (`schema.prisma:1543–1570`); quiet checks have no event by Q4 and purge removes old history. Add one membership cursor, not parsing dedupKey or hidden quiet events (R20).
- G17, in scope merge seam: merge view carries roleKeys but no branch scopes (`apps/api/src/modules/auth/domain/logic/account-merge.logic.ts:14–19,49–63`). Equal roles do not prove equal summary audiences; retain survivor scope and suppress incompatible cards. Do not redesign general account merge here.
- G18, in scope former-design error: deleting a choice row would restore an owner's default on; use explicit false for personal stop (R1/R12/R21). Existing summary table does not yet exist, so this is a design gap, not observed unwanted delivery.
- G19 — **closed by controller C1, 2026-11-04**, a former-design inconsistency rather than a current-code defect: the seven-day cap was the controller's proposal, not an owner rule. Continuing periods now use cursor+1 through yesterday with no seven-day maximum; first/missing/older-than-31/OFF→ON fresh starts use seven days and do not carry older dates. No owner question or implementation blocker remains for C1.
- G20, in scope footer integration gap: bell body is clamped and wholly linked (`apps/web/src/features/dashboard-notifications/NotificationBell.tsx:106–115`); centre content disables pointer events (`NotificationPages.tsx:202–218`). Adding text alone would hide the mandatory exit. Add weekly-only footer DTO/rendering, not global notification redesign. No observed existing weekly-footer failure is claimed.
- G21, capability/wording integration: expense.read alone does not authorize bell reads; existing `notification.controller.ts:31–32,46–47` and `notification.use-cases.ts:38,49` require notification.read. Keep R7 reader choice unchanged, expose canReadBell for honest unlinked/channel-off wording, and do not widen bell access. Personal stop uses its own narrow metadata route without either business-read key.
- G22, in scope paid-visibility gap: WebSession (`web-session.model.ts:2–31`) has no paid-tier fact and plan-term notice (`plan-term.api.ts:13–24`) only has time-derived state. An active trial would otherwise look unlocked/nonfree. Add the derived auth/me display metadata above; no claim that it already exists and no client authority added.

## 13. Bugs ที่พบในโค้ดปัจจุบัน

| # | ที่ | เกิดอะไร | ความรุนแรง |
|---|---|---|---|
| B1 | `notification.use-cases.ts:304,322` + `notification-sweeps.use-cases.ts:23-26` + `generate-snapshot.use-case.ts:128-131` | สรุป 07:00 สร้าง snapshot ด้วย worker context ที่มีแค่ `dashboard.read`,`dashboard.snapshot.generate`; `visibleWidgets` กรองตาม `readPermissions` (`expense.read`) → ร้านแพ็กที่ขายได้ `แดชบอร์ดอัปเดตแล้ว 0 วิดเจ็ต` ทาง LINE ถึงทุก OWNER/ADMIN ทุกเช้า — เกิดกับร้านที่มี rule (seed) หรือเมื่อ worker เรียก internal route `:128-139` ตรง | ต่ำ / ข้อความเท็จ |
| B2 | `IncomeExpenseLedgerPage.tsx:100-102` | ผู้ที่ไม่มีสิทธิ์ฝั่งใดฝั่งหนึ่งเห็น `เปิดฝั่งนี้เร็ว ๆ นี้` — ไม่จริงสำหรับแพ็กที่ขายและพนักงานที่ขาดสิทธิ์ | Out of scope (unsold ledger); no menu added |
| B3 | `notification.use-cases.ts:369-379` | LINE ในช่วงเงียบถูก `SUPPRESSED` ถาวร ไม่เลื่อน — ขัดเจตนา "can wait until morning" (`workflow-template-catalog.ts:298-299`) และต่างจาก billing ที่เลื่อน 30 นาที (`billing-notifications.service.ts:498`) | กลาง (เฉพาะร้านที่ตั้ง quiet hours ได้) |
| B4 | `notification.use-cases.ts:305-312` + `notification.model.ts:32-33` | สรุปรายวันส่งทุก OWNER+ADMIN ตามบทบาท | ต่ำ (แก้ด้วย §7 retire) |
| B5 | `notification.use-cases.ts:857` + `notification.model.ts:341` | 429 ถูกจัดเป็น `RATE_LIMIT` แล้ว retry; โควตารายเดือนหมดก็ตอบ 429 → FAILED ทุกข้อความที่เหลือของเดือนโดยไม่มี alert เฉพาะ | กลาง (§17 Q5) |
| B6 | `prisma-notification.repository.ts:188-201` | `resolveEarlier` จับเรื่องเดียวกันด้วย `deepLinkHref` อย่างเดียวเมื่อมี — notice สองคนที่เปิดหน้าเดียวกันแต่เป็นคนละเรื่องจะปิดกันเอง (ผู้ใช้ปัจจุบันเป็น notice ใบเบิกที่ลิงก์ = ใบเบิก จึงยังถูก; จะผิดทันทีที่ trigger ใดใช้ลิงก์ร่วม) | ต่ำวันนี้ / กันด้วย `matchBy` |
| B7 | `notification.use-cases.ts:248-258` + `schema.prisma:1570` | `execute` ตรง (ไม่ผ่าน `executeInTransaction`) ไม่ idempotent เมื่อเรียกซ้อน — producer ที่เรียกตรงอาจสร้าง event/delivery ซ้ำเมื่อ sweep ซ้อน (ตรวจรายตัวว่ามี producer ใดเรียกซ้อนได้จริง — ยังไม่ได้ไล่ทุกตัว) | ต่ำ–กลาง / unverified per producer |
| B8 | `income-expense-ledger.use-case.ts:151-165` | ยอด "รายจ่ายที่บันทึก" / "จ่ายแล้ว" / หมวด รวม `grandTotalAmount` / `amount` / `lineTotalAmount` ทุกสกุลเงินโดยไม่แปลง — รายจ่าย USD 100 + THB 100 ยืนยันในเดือนเดียวกันแสดง ฿200.00 | Out of scope (unsold ledger); plan 1.2 removed 2026-10-26 (ceiling) |
| B9 | `expense-summary.provider.ts:27-34,65-81` | หน้าแรก (ยอดช่วง, กราฟรายเดือน, ค้างจ่าย) รวมข้ามสกุลแบบเดียวกัน | กลาง — §16.1 (แตะแบบ HOME-01) |

## 14. Test plan

Not run in this documents-only round; implementation and runtime/browser proof are outside this authorization.

Round-5 tests first (all API paths below are existing registered specs, not new test files):
- `src/modules/auth/presentation/auth.controller.spec.ts` — `R19 session summary access distinguishes paid recovery trial and free`: call me with per-tenant paid active/expired, active trial, free, no term and no-field old API fixtures; PAID only for current commercial gate, cleanup only PAID_RECOVERY; permissions unchanged, no summary/facts query, no cross-tenant display state. This extends existing me display-metadata tests (`auth.controller.spec.ts:374–424`), without a constructor dependency.
- `src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts` — `R20 day changes never overlap or truncate uncovered dates`: cursor 1 Nov → 12 Nov check gives one 2–11 Nov ten-day card; a cursor 32 days old gives the last seven days; exactly 31 days old keeps the entire cursor+1..yesterday range; quiet→active uses cursor+1; OFF→ON gives seven days; first/missing cursor gives seven days; ineligible checks preserve cursor and a short pause is carried; already-covered yesterday skips. Include earlier/later changes, month/year/Bangkok boundaries and same-run retry. `R5 daily eight filters selected weekday`; `R20 equal-length comparison and tax month use the run date` (non-seven labels เทียบช่วงก่อน, A1 off); `R1 default owner choice respects explicit false`.
- `src/modules/dashboard-notifications/application/use-cases/notification-preference.use-case.spec.ts` — `R21 settings require paid management and current reader candidates`: manager without read may manage but not receive; stale missing-read/foreign/disabled/scope-less candidate rejected, auth before settings/roster reads; invalid weekday/type and duplicate ids rejected. `R12 personal off persists owner false`; `R11 missing LINE never promises an unavailable bell` includes expense.read but no notification.read, and proves narrow stop still works.
- `src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts` — `R21 concurrent managers and personal stop serialize touched choices`; `R1 multiple no-row owners and unlinked owner bell`; `R20 cursor event and quiet checks commit once`; `R6 concurrent chosen-day retries freeze one range`; `R7 revoked reader cannot receive manager-selected card`. Two PG connections prove same-field last commit, disjoint-field preservation, revoked manager/candidate, day-save versus sweep, default-owner/no-choice-row merge, no lock inversion and rollback leaves cursor/event unchanged.
- `src/modules/dashboard-notifications/application/use-cases/process-due-deliveries.use-case.spec.ts` — `R21 selected reader revocation and owner off suppress push`; `R11 live manager hint and expired tax row rendering`. Keep existing channel-off, missing LINE target and WEB delivery behaviour. Web `apps/web/src/features/dashboard-notifications/NotificationPages.spec.ts` — `R11 weekly footer remains visible and independently reachable`: manager/member, resolved/open and permission refresh, sibling links without nested anchors.
- `src/modules/auth/auth.guard.spec.ts` — `R19 free summary settings deny before roster read`; preserve own expired-paid GET/DELETE recovery and deny settings/PUT.
- `src/modules/auth/application/use-cases/account-merge.use-case.spec.ts` — `R8 newest explicit choice survives duplicate merge`; include off versus missing owner default, timestamp tie false and differing branch audiences.
- Web existing files: `apps/web/src/features/web-core-workspace/settings-menu.logic.spec.ts` — `R21 paid setup manager sees summary beside planned e-WHT`; `apps/web/src/features/company-profile/CompanyProfilePage.qa.spec.ts` — `R12 owner default status and personal stop`; `apps/web/src/features/dashboard-notifications/DashboardPages.rendered.spec.ts` — `R21 settings state and home invitation absent`. Destination rendered-form assertions may be added in that existing rendered spec, no API file creation.
- Existing `e2e/journeys/shop-menus-everyday.journey.spec.ts` — `R21 summary settings and personal stop at three widths`: all §10.5 cases at 390/1280/~1556, save/reload, role revocation/stale response/retry, manager hint, free request absence and bell-only unlinked owner. `apps/workers/src/modules/notifications/notification-jobs.spec.ts` — `R5 daily eight cron and chosen-weekday dispatch`.

R19 tests first in existing registered files (test titles updated to selection/settings; commercial boundary unchanged):
- `apps/api/src/modules/dashboard-notifications/application/use-cases/notification-preference.use-case.spec.ts` — `R19 only paid access reaches summary metadata or settings`: free + granted expense.read is denied before subscription/read; paid + expense.read and effective selection succeeds; trial-only/unknown/expired cannot enroll or manage; expired paid can still use own opt-out recovery. No free route-allowlist expansion.
- `apps/api/src/modules/auth/auth.guard.spec.ts` — `R19 free weekly routes stay outside recovery`: GET/PUT/DELETE weekly paths do not widen the free allowlist; own expired-paid metadata/opt-out recovery remains narrow and never permits facts or enrollment.
- `apps/api/src/modules/dashboard-notifications/application/providers/expense-summary.provider.spec.ts` — `R19 free access never reaches weekly expense or WHT queries`: spy on expense/claim/WHT reads; free gives zero queries and no card; matching paid fixture retains totals and reminder rules.
- `apps/api/src/modules/dashboard-notifications/application/use-cases/process-due-deliveries.use-case.spec.ts` — `R19 nonpaid queued summaries are suppressed before push`: free/nonpaid current facts plus seeded stale subscription/card give zero LINE call; normal paid recipient still sends once; retry/access refresh never reopens eligibility by a cached role.
- `apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts` — `R19 commercial eligibility is rechecked for sweep bell and delivery`: free fixtures with expense.read never create/read/count/push a summary; include current term expiry/change between collection and delivery under the existing Company/membership locks, unknown commercial read and positive paid control.
- Web: `apps/web/src/features/company-profile/CompanyProfilePage.qa.spec.ts` — `R19 free account hides weekly summary without an API request`; home absence regression `apps/web/src/features/dashboard-notifications/DashboardPages.rendered.spec.ts` — `R19 free home never invites weekly opt-in`. Browser journey `e2e/journeys/shop-menus-everyday.journey.spec.ts` — `R19 paid summary and free source-only journeys at three widths`, at 390/1280/~1556; free permitted account/expense entry or guarded home deep link shows no summary invitation/tax data. Existing welcome/advisor and history remain intact; no new tests for unsold modules.


**API (ไฟล์ที่อยู่ใน `apps/api/package.json` "test" แล้วเท่านั้น)**

- `src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts`: import จาก `expense-weekly-summary.logic.ts` — period/nextCheckDate across month/year and selected weekday; quiet rule; **fixture §10.1 ให้ผลการ์ดตรงทุกแถว**; A1 (N=3 ไม่ประเมิน, N=5 แสดง "5 สัปดาห์", mean 6,250 กับ 12,450 ไม่ขึ้น, ส่วนต่าง < 3,000 ไม่ขึ้น); เทียบสัปดาห์ 4 กรณี; scope label 0/1/2/3 สาขา + "รวมส่วนกลาง"; วันภาษี (ก่อน/ตรง/หลังวันยื่น, due 2027-01-31 vs 2027-02-07); Flex: ปุ่ม uri + height เท่ากัน ไม่มี postback altText ≤ 400; ไม่มี `%`, `อันดับ` และไม่มีการเปรียบเทียบแบบคูณ (regex `/[0-9๐-๙.,]+\s*เท่า|เท่าตัว/`) — คำ `เท่ากัน` ต้องผ่าน; สกุลเงิน: USD 100 + THB 100 → ยอด 100.00 และแถว `สกุลเงินอื่น` `1 ใบ`; `withholdingFormType` (INDIVIDUAL → PND3, INDIVIDUAL + `SEPARATE_PND2` → PND2 ไม่มีแถว, JURISTIC → PND53, ไม่รู้ → ไม่มีแถว); ความครอบคลุมการยื่น: PND53 ยื่นแล้วไม่ซ่อน PND3 ที่ยังค้าง, รายการจ่ายที่มาหลังยื่นยังขึ้นแถว
- `src/modules/dashboard-notifications/application/providers/expense-summary.provider.spec.ts`: ทุก query มี `companyId`; query ยอดและนับใบมี `branchScopeWhere` **ยกเว้น** query ประวัติ "เคยมีมาก่อน" ของ A2 ที่ต้องไม่มี branch filter; flags ปิดแล้วไม่ query; WHT query มี `paidAtConfirmed: true`
- `src/modules/dashboard-notifications/application/use-cases/process-due-deliveries.use-case.spec.ts`: Flex การ์ด; preference แช่แข็งยังได้ LINE; ปิด LINE ไม่ได้; ด่าน §8 ข้อ 2 — explicit off/ถอด `expense.read`/สาขาแคบลง/ถอดสิทธิ์จ่าย ระหว่างสร้างกับส่ง → `SUMMARY_AUDIENCE_CHANGED`; event RESOLVED → ไม่ส่ง; daily ที่ค้าง → ไม่ส่ง
- `src/modules/dashboard-notifications/presentation/http/internal.controller.spec.ts`: route ใหม่ต้องมี worker token, failures>0 → non-2xx; route daily คืน retired ไม่สร้าง event
- `src/modules/dashboard-notifications/application/use-cases/notification-preference.use-case.spec.ts`: effective-choice/personal stop (owner default requires R7; DELETE upserts false without expense.read; resolve event OPEN; audit); `UpdateRuleUseCase` ปฏิเสธ `daily_owner_summary`; `ListRulesUseCase` ไม่คืน
- `src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts` (real PostgreSQL, `NOTIFICATION_TEST_DATABASE_URL` แบบบล็อก `:730`, `:929`):
  - unique `membershipId` explicit choices true/false; cascade เมื่อลบ membership/company
  - **สอง sweep พร้อมกัน** (Promise.all) สัปดาห์เดียวกัน → 1 event, 2 deliveries
  - **สอง recipients** บริษัทเดียวกันสัปดาห์เดียวกัน → 2 event OPEN ทั้งคู่ แล้ว drain → ทั้งสองคนได้ LINE (ไม่ปิดกันเอง); สัปดาห์ใหม่ปิดเฉพาะของคนเดิม
  - ตัวเลข = fixture (CONFIRMED เท่านั้น; ผู้ใช้จำกัดสาขา: สาขา 100 + ส่วนกลาง 200 = 300 ตาม `branchScopeWhere`)
  - A2 สองทิศ: เก่าเลขภาษีอย่างเดียว → ใหม่ผูก counterparty เลขเดียวกัน = ไม่ใหม่; เก่าผูก counterparty → ใหม่เลขภาษีอย่างเดียว = ไม่ใหม่; ผู้ขายเคยมีในสาขาอื่น = ไม่ใหม่
  - A4: ใบเบิกอนุมัติ 20 วันก่อน ถูกยกเลิกการจ่ายวันนี้ → ไม่ขึ้น; ใบที่ duplicate block CONFIRMED → ไม่ขึ้น
  - WHT: จ่ายใน ต.ค. `paidAtConfirmed=false` → ไม่มีแถว
  - กระดิ่ง: ผู้ถูกถอด `expense.read` → list/unread ไม่นับสรุป; สาขาแคบลง → ไม่เห็นสรุปเก่าขอบเขตกว้าง
  - account merge close_duplicate keeps newest explicit choice; false beats missing owner default
  - purge: event อายุ 14 เดือนถูกลบพร้อม recipient/delivery; 12 เดือนอยู่; **บริษัทที่ไม่มีผู้สมัครเหลือ** และ **บริษัทที่ถูกระงับ/หมดอายุ** ก็ถูก purge
  - **interleaving สิทธิ์ × ส่ง** (สอง connection, stub `pushLineMessage` ที่รอ latch): (i) role update ถอด `expense.read` ถือ `Company FOR UPDATE` อยู่ → delivery รอที่ `FOR SHARE` แล้ว `SUMMARY_AUDIENCE_CHANGED`; (ii) delivery ถือ `FOR SHARE` และค้างใน push → role update รอจน delivery commit (ส่งก่อนถอด); (iii) DELETE ยกเลิกระหว่าง delivery → เรียงบนแถว membership, ไม่มีกรณียิงหลัง explicit off commit; (iv) entitlement `expenses` OFF พร้อมกัน → ไม่ deadlock (ลำดับ advisory → Company → membership)
  - รวมบัญชี: event สรุปที่รอส่งของ membership ที่ย้าย → ผู้รับย้ายไปบัญชีที่เหลือและส่งถึง
  - migration: rule DISABLED, event รายวัน RESOLVED, delivery ค้าง SUPPRESSED
- `src/modules/workflow/application/use-cases/workflow-scan.use-case.spec.ts` (อยู่ใน list แล้ว; ครอบ `paymentSlaBreach`) ต้องผ่านเหมือนเดิมหลังย้าย `claimPayableSince`
- `src/modules/employee-access/domain/logic/feature-gate.logic.spec.ts`: regression (ไม่มี permission ใหม่)
- `src/modules/auth/auth.guard.spec.ts` (อยู่ใน list แล้ว): ร้านแพ็กหมดอายุ — GET/DELETE `expense-weekly-summary/me` ผ่าน route กู้คืน, PUT ถูกปฏิเสธ `company_term_expired`, path อื่นไม่ได้สิทธิ์กู้คืนตาม
- `src/modules/tax/application/use-cases/sync-tax-events-wht-form.use-case.spec.ts` (อยู่ใน list แล้ว): ผลจัดแบบเดิมไม่เปลี่ยนหลังย้ายเป็น `withholdingFormType`

**Workers**: `apps/workers/src/modules/notifications/notification-jobs.spec.ts` — `R5 daily eight cron and chosen-weekday dispatch` replaces the Monday-eight test

**Web (`tsx --test "src/**/*.spec.ts"`)**: `company-profile.logic.spec.ts` + `CompanyProfilePage.qa.spec.ts` (5 สถานะ, ไม่มีคำรับประกันวันส่ง); `expense-list-navigation.logic.spec.ts`

**Browser** (ตาม `docs/guidelines/thai-ux-standard.md:110-117`): หน้าที่แก้ทุกหน้า (บัญชีของฉัน, ตั้งค่าร้านและแบบตั้งค่าสรุป; home absence regression only) เปิดใน browser จริงที่ **390 และ 1280** (+ ~1,556 ที่เจ้าของใช้ตรวจ) ด้วยข้อมูลไทย ดูภาพจริง, **วัดความสูง/กว้างปุ่มในกลุ่ม**, กด journey หลักหนึ่งรอบรวมทางผิดหนึ่งครั้ง (กดบันทึกซ้ำเร็ว ๆ / stale recipient / เปิดหน้าโดยไม่มีสิทธิ์); `e2e/journeys/shop-menus-everyday.journey.spec.ts`; `e2e/notifications.spec.ts` เห็นสรุปในกระดิ่งหลังเรียก internal sweep บน proof stack; บันทึกสิ่งที่ไม่ได้ดูตรง ๆ

## 15. Acceptance criteria

| # | Scenario | ผลที่ต้องได้ |
|---|---|---|
| AC1 | Paid owner with active OWNER + expense.read and no explicit row (old/new shop) | Effective on with no owner choice insert; first chosen-day nonquiet run creates one scoped bell/card; explicit owner off stays off |
| AC2 | จันทร์ 2 พ.ย. 2569 08:00 ด้วย fixture §10.1 | LINE 1 การ์ดตรง §10.1 ทุกแถว; ไม่มี AI call; กระดิ่งมี title `สรุปรายจ่าย 26 ต.ค. – 1 พ.ย.` |
| AC3 | Quiet chosen-day check followed by an active check | No event/delivery for quiet; successful quiet cursor advances atomically, next active period starts cursor+1 while age ≤31 days; fresh-start exceptions use seven days. Ineligible checks neither advance nor clear; transaction failure leaves cursor unchanged. |
| AC4 | Concurrent sweeps / same-run retry / weekday changed after event creation | One event per member+actual range, no replay or period relabel; frozen dates equal dedup range |
| AC5 | สอง recipients บริษัทเดียวกัน | ทั้งสองได้การ์ดของตน; ไม่มีใครถูกระงับเพราะอีกคน |
| AC6 | ผู้รับจำกัดสาขา A | ตัวเลข = สาขา A + ส่วนกลาง (ไม่อ้างว่ายอดตรงหน้าแรก); sub `สาขา A · รวมส่วนกลาง`; ไม่มีแถวภาษี |
| AC7 | หลังสร้างการ์ดแต่ก่อนส่ง: ยกเลิก / ถอด `expense.read` / สาขาแคบลง | LINE ไม่ส่ง (`SUMMARY_AUDIENCE_CHANGED` หรือ event RESOLVED); กระดิ่งไม่แสดงเมื่อสิทธิ์ไม่ตรง |
| AC8 | Manager selects member with only expense.read_own or inactive/unusable branch scope | Not listed; PATCH rejects stale/foreign ids before writing or facts; member has no management API permission |
| AC9 | ผู้ขายใหม่ 4,500.00 ร้านมีประวัติ 6 สัปดาห์ / 3 สัปดาห์ / ผู้ขายเดิมแต่เพิ่งผูก counterparty | ขึ้น / ไม่ขึ้น / ไม่ขึ้น |
| AC10 | Ordinary payer-filed withholding only (explicit E_WHT excluded); จ่ายหัก ณ ที่จ่ายยืนยันวันจ่ายใน ต.ค. 2569: การ์ด 2 พ.ย. และ 9 พ.ย. / 16 พ.ย. / วันจ่ายยังไม่ยืนยัน | `ส่งออนไลน์ภายใน 15 พ.ย.` / ไม่มี / ไม่มี |
| AC11 | removed 2026-10-26 (ceiling) | VAT/ภ.พ.30 row, fact read and tests removed |
| AC12 | ใบเบิกอนุมัติ 20 วันก่อน การจ่ายถูกยกเลิกวันนี้ | ไม่ขึ้นแถว A4 |
| AC13 | removed 2026-10-26 (ceiling) | New ledger menu, page mode, web/browser tests removed; account-card browser evidence remains AC1/AC24 |
| AC14 | ไม่มีข้อความใดมี `%`, `อันดับ`, หรือการเปรียบเทียบแบบคูณ ("2 เท่า", "เท่าตัว") | assert ใน test; `เท่ากัน` ผ่าน |
| AC15 | หลัง migration + deploy | rule รายวัน DISABLED และไม่แสดงในรายการกฎ; PATCH เปิด → 400; internal route รายวันไม่สร้าง event; delivery รายวันค้าง SUPPRESSED |
| AC16 | ปุ่มบน LINE ทุกปุ่ม | `uri`, ความสูงเท่ากัน, เปิดหน้าถูก |
| AC17 | Account merge move/close_duplicate with conflicting explicit choices | Choice follows membership on move; newest explicit choice on duplicate, false wins exact timestamp tie; one surviving recipient; owner off never becomes missing default |
| AC18 | event สรุปอายุ > 13 เดือน (บริษัทยังมีผู้สมัคร / ไม่มีผู้สมัครแล้ว / ถูกระงับ) | ถูกลบใน sweep ถัดไปทุกกรณี |
| AC19 | role update ถอด `expense.read` ขณะ delivery กำลังทำ | ไม่มีกรณีที่ LINE ถูกยิงหลังการถอด commit (ตาม interleaving test i–iii) |
| AC20 | Expired paid recipient opens own account | No shop summary settings or start action; personal status/stop still works via narrow metadata recovery |
| AC21 | รวมบัญชีวันจันทร์หลังสร้างการ์ดแต่ก่อนส่ง | บัญชีที่เหลือได้การ์ดสัปดาห์นั้น 1 ใบ |
| AC22 | จ่ายหัก ณ ที่จ่ายให้บุคคลธรรมดาหมวด `SEPARATE_PND2` / ผู้รับไม่รู้ประเภท / ภ.ง.ด.53 ยื่นแล้วแต่ ภ.ง.ด.3 ค้าง | ไม่มีแถว / ไม่มีแถว / มีเฉพาะแถวภาษีที่หักจากบุคคล (PND3) |
| AC23 | USD 100 and THB 100 in the summary week | Card shows `100.00 บาท` + other-currency count `1 ใบ`; no ledger-page fix is required or claimed |
| AC24 | กดปุ่ม "หยุดรับสรุปนี้" จาก LINE (cold) และเปลี่ยน hash ขณะหน้าเปิด | หน้าเลื่อนไปการ์ด `#weekly-summary` หลังโหลดเสร็จทั้งสองแบบ |
| AC25 | สัปดาห์มีแต่รายจ่าย USD ยืนยันแล้ว | ไม่เงียบ: `0.00 บาท` + `สกุลเงินอื่น (ไม่รวมด้านบน)` `{N} ใบ` |
| AC26 | ใบเบิกรอจ่ายมาครบ 7 วันพอดี / 7 วัน 1 นาที | ไม่ขึ้น / ขึ้น |
| AC27 | ภ.ง.ด.53 งวดนั้นมีแบบยื่นแล้ว `rowsCertain=false` หรือบรรทัดไม่มี payment key ของเอกสารในเดือนนั้น | ไม่มีแถว ภ.ง.ด.53 (ไม่อ้างทั้งยื่นแล้วและยังไม่ยื่น) |
| AC28 | ยกเลิกรับสรุป: แพ็กหมดอายุก่อนระงับ / หลังระงับ / สาขาที่เลือกถูกปิดหมด | DELETE สำเร็จทั้งสามกรณี |
| AC29 | Merge races sweep for missing-row owner or selected nonowner | Membership locks prevent orphan event; one surviving recipient/range, no lock inversion; incompatible scopes suppressed, no historical coverage claim across changed audiences |
| AC30 | removed 2026-10-26 (ceiling) | Ledger CSV/XLSX currency work and tests removed |
| AC31 | Existing sold expense list is opened with `view=duplicates` | Sends existing API `duplicateStatus=POSSIBLE_DUPLICATE`, preserves tenant/branch scope and empty/loading/error recovery; no extra card button or unsold page |

| AC32 | Free/nonpaid even with expense.read calls account/home/settings GET/PATCH directly | No summary UI/card/tax reminder; deny settings before summary settings/roster/facts reads; ordinary commercial/session lookup allowed, free routes unchanged |
| AC33 | Current paid selected/default owner then term expires/nonpaid before collection/send | Works only while R19 + R7 + effective on pass; deny queries/queued push after expiry; narrow expired-paid own stop remains |

| AC34 | Change day / fresh start / pause at the 31-day boundary | Cursor 1 Nov and 12 Nov run → one 2–11 Nov ten-day card, no seven-day cap. Exactly 31-day-old cursor → whole cursor+1..yesterday range; 32 days → last seven days. First/missing cursor and OFF→ON → seven days with no earlier carry. Quiet→active continues cursor+1; ineligible leaves cursor unchanged. Continuing ranges stay contiguous/disjoint and every card prints its actual dates. |
| AC35 | Monday default, selected Wednesday, off-day daily sweep, exact Bangkok 08:00 | Daily cron; only Wednesday shop evaluated; no host-timezone drift; purge still runs for all companies. |
| AC36 | Two active OWNER memberships, one ADMIN, no explicit rows | Both eligible owners default on; ADMIN off. Explicit owner false suppresses creation/send, missing choice never restores it. Unlinked owner with notification.read gets nonquiet bell only; a custom role missing that key gets no new bell access. |
| AC37 | Manager sets reader on then right/branch/management revoked before save or send | Save rechecks management and candidate R7 atomically; queued recipient rights revocation suppresses push; no leaked roster/facts or stale management hint. |
| AC38 | Two managers edit same/different fields concurrently; personal stop races save/send | Company+membership lock order; latest committed touched-field value wins, unrelated values preserved; explicit stop is false, not delete; audit only real changes. |
| AC39 | Settings card/form + account + card/bell exits at 390/1280/~1556 | Paid owner/manager/member, expired, free, nonreader and branch-limited cases match §10.5; one primary save, equal buttons, retained inputs/retry, no home invitation or preference/rules unlock. |

## 16. Risks / rollout

- R14/Q5 OA capacity: stable estimate = paid shops × eligible default-on owners × up to 5 + selected nonowners × up to 5, plus other notices; each actual weekday change adds at most one extra card per effective recipient, with conservative retry allowance. Controller verifies actual OA package and proposes figure before release; default-on is a rollout cost change, not opt-in growth.
- No feature switch: deployment enables eligible owner defaults immediately. Release must include settings/personal stop/day coverage proof and OA capacity gate, not ship core alone to customers.
- ด่านส่งถือ `Company FOR SHARE` ตลอดการยิง LINE (push timeout 30 วินาที `notification.use-cases.ts:850`, tx timeout 35 วินาที `:581`) — ผู้แก้สิทธิ์ของร้านนั้นอาจรอได้ถึงเวลาส่งหนึ่งข้อความ; **ห้าม** ลดการตรวจเหลือแค่ subscription หรือย้ายการอ่านสิทธิ์ออกนอกล็อก; ถ้ารอนานเกินรับได้ ให้กลับมาแก้สเปก ไม่ใช่ลัด
- Daily 08:00 chosen-day shops: sweep ต่อคน (~10 query + 1 transaction) และ delivery sweep ≤ 200 ต่อรอบทุก 30 วินาที (`notification.model.ts:335`, `notification-jobs.ts:56`)
- `daily_owner_summary`: inert + migration + retired key; ไม่ลบโค้ด cron (repeatable ค้างใน Redis)
- ชื่อผู้ขายใน payload อาจเป็นบุคคลธรรมดา — อยู่ใน tenant เดียวกับรายจ่ายต้นทาง, เห็นเฉพาะผู้มีสิทธิ์ (§8), ลบหลัง 13 เดือน (§5.6)
- วันภาษี: อัปเดต `RD_EFILING_8_DAY_EXTENSION_LAST_STATUTORY_DUE` เมื่อมีประกาศต่อ (ปฏิทิน ops ม.ค. 2570)

### 16.1 Engineering prerequisites

Resolved code questions are recorded below; only runtime measurement and the full writer audit remain engineering proofs. They are not owner questions or new permission requests.

| # | เรื่อง | ระดับ | เจ้าของ / ขั้นต่อไป | ก่อนเฟส |
|---|---|---|---|---|
| M1 | ไล่ผู้เขียนสิทธิ์ทุกตัว (role, role permission, membership role, branch scope, membership status, entitlement, billing apply, plan-term sweep) ว่าล็อก `Company FOR UPDATE` หรือ advisory entitlement ก่อนเขียน และลำดับล็อกไม่สวนกับ advisory → Company → membership | MEDIUM | implementer: grep `rolePermission\.|membershipRole\.|membershipBranchScope\.|companyFeatureEntitlement\.` ทุก writer + ตาราง lock order ใน memory; ตัวที่ไม่ล็อกให้เพิ่ม `lockPlanTermCompany` เป็นขั้นแยก | 3.5 |
| M2 | Transaction-bound permissions | Resolved by code trace | `PermissionResolverService.resolveAccess` (`permission-resolver.service.ts:12–13`) has no tx parameter; reuse the existing transaction-bound constructor pattern (`notification.use-cases.ts:206–211`) for the resolver under delivery locks; do not add a database parameter to the domain port | 3.5 |
| M3 | Currency-write reachability | Resolved by code trace | Explicit currency input defaults to THB at `expense-draft.use-case.ts:169`; mixed-currency risk is real at the API contract; summary must filter THB, no ledger work | 3.2 |
| M4 | แก้หน้าแรก (B9) ให้เป็นบาทล้วน + บรรทัดสกุลอื่น — แตะแบบ HOME-01 | MEDIUM | **เจ้าของ** ตัดสินคำ/ตำแหน่ง; ข้อเสนอ: ใต้ตัวเลขแรก บรรทัดเดียว `ไม่รวมรายจ่ายสกุลอื่น {N} ใบ` | ไม่ block เฟสนี้ (G10) |
| M5 | `ExpenseSourceAdapter` อ่านรายจ่ายหัก ณ ที่จ่ายทั้งหมดของร้านทุกครั้ง (`expense-source.adapter.ts:70-80` ไม่จำกัดช่วง) — ต้นทุนต่อ subscriber ต่อสัปดาห์ | LOW | implementer: วัดบน proof stack ร้านข้อมูลใหญ่; ถ้าช้า ให้ cache ผลต่อบริษัทต่อรอบ sweep (ไม่ใช่แก้ adapter) | 3.2 |
| M6 | Term-recovery permissions | Resolved by code trace | For expired previously-paid shops, resolver returns ordinary filtered permissions even in recovery (`prisma-permission-resolver.repository.ts:126–135`); recovery does not bypass branch rejection `:111–112`. GET/DELETE use the narrow membership-only path already required in §7, not these permissions | 2.4 |
| M7 | Narrow session + membership path | Resolved by code trace; implementation still required | `auth.guard.ts:246–247` always calls `resolveContext` after exact recovery detection; existing profile recovery changes allowed company status, not the branch guard. Add an exact GET/DELETE subscription-route path that authenticates the session and route/header tenant, loads only that user’s membership and own subscription, and grants no business-read/write permissions; settings remain under ordinary paid/management gates; personal enrollment PUT is removed | 2.4 |
| M8 | race ปิดบทบาท: `DisableRoleUseCase` นับ assignment ก่อน transaction และไม่ล็อก `Company` (`disable-role.use-case.ts:24-33`) ขณะที่ `update-employee` ผูกบทบาทใน tx ของตัวเอง (`update-employee.use-case.ts:288`) → ปิดบทบาทที่เพิ่งถูกผูกได้ = การถอดสิทธิ์ที่ไม่ผ่านล็อก `Company` (ด่านส่ง §8 ไม่ถูกเรียงลำดับด้วย) | MEDIUM | implementer: ให้ทั้งสอง writer ล็อก `Company` แล้วตรวจสถานะบทบาท/จำนวน assignment ใหม่ใต้ล็อก + test สองลำดับสลับกัน; เป็นส่วนหนึ่งของ M1 | 3.5 |
| M9 | removed 2026-10-26 (ceiling) | — | Ledger export audit/changes removed with AC30 | — |

## 17. Owner answers — 2026-11-04

Q1–Q7 are answered/closed as below; earlier recommendations are no longer open. No general notification permission/entitlement decision is reopened.

| # | Answer / owner's words | Result |
|---|---|---|
| Q1 | Replaced: "ควรเปลี่ยนวันได้และคนที่ได้รับแจ้งเตือนให้ set ตามสิทธิ์ได้และเจ้าของกิจการเป็น default เสมอ" | Chosen weekday, eligible owners default on; others selected by setup manager; explicit personal off always available; exception for this weekly notice alone. |
| Q2 | Superseded by Q1 owner default and settings recipients | Home opt-in line removed; contextual manager settings hint and universal personal stop replace it. No invented separate owner quotation. |
| Q3 | "as recommended" (owner answer conveyed 2026-11-04) | Problems only inside this card, no immediate standalone notice. |
| Q4 | "as recommended" | Quiet week sends nothing and creates no bell event. |
| Q5 | Controller checks LINE OA package before release and proposes a figure | Release task using §5.5 formula, no owner question and no live numbers in this document. |
| Q6 | removed 2026-10-26 (ceiling), remains closed | VAT reminder not sold, no work restored. |
| Q7 | "as recommended" | Bell summary retention exactly 13 months. |

**C1 — closed by controller 2026-11-04; not an owner question.** The seven-day maximum was the controller's own proposal; the owner requires a chosen day and a truthful printed period. Rule: eligible ON recipient with a cursor no older than 31 days gets cursor+1 through yesterday, with no seven-day maximum (2–11 Nov is one ten-day card). First/missing cursor, explicit OFF→ON or cursor older than 31 days starts at today−7 through yesterday; earlier dates are not carried. Ineligible checks neither advance nor clear cursor; successful quiet checks do advance, so quiet→active continues cursor+1. Non-seven periods keep เทียบช่วงก่อน and A1 off. Each weekday change adds at most one extra card per effective recipient. Plan 5.4/5.5 have no C1 blocker; remaining implementation/permission/browser/OA release checks still apply. No owner answer or further confirmation is required.

## 2026-10-26 change boundaries and first checks

| Requirements | Concrete failing scenario today / former-design defect | Smallest target and shared-data impact | What could break / first test |
|---|---|---|---|
| R1/R5/R10 | A seeded shop with an enabled daily rule gets `แดชบอร์ดอัปเดตแล้ว 0 วิดเจ็ต` to OWNER/ADMIN; calling the internal daily route bypasses rule disabling | Retire `CreateDailyOwnerSummaryUseCase.execute` and the trigger in `notification.model.ts`, migrate only daily rule/event/delivery state; effective selection by membership through existing notification patterns; workers get daily 08:00 selected-day job | Retiring only the cron leaves the direct route; first add `R10 daily route is inert and retired rule cannot reopen` and membership authorization before writing feature code |
| R2/R3/R4 | THB 100 + USD 100 currently aggregate as 200 in `collectMetrics`; a voided claim can be mis-aged if weekly code ignores `lastVoid`; checking period state alone can hide a late withholding payment | New `collectWeeklyDigest` in the existing expense provider filters money to THB, reuses line/category/branch patterns, existing claim due source and payment coverage helper; API reads only; **no** ledger/home-total/export rewrite, tax mutation or AI call | Misstated money/filing status and cross-branch disclosure; first add R2/R3/R4 tests in the existing pure/provider/PG files, including PND2/unknown/uncertain cases and lower-pack no-button row |
| R6/R7 | Two people share the home URL → old `resolveEarlier` can close the other event; a role revocation committed before push is not checked by current membership-only delivery | Reuse `executeInTransaction`, add `onlyIfAbsent`/source supersession and the new audience predicate; `ProcessQueuedDeliveryUseCase` locks advisory → Company → membership and resolves permissions with that tx; list/unread filter before pagination | Duplicate pushes, hidden-branch leak, deadlock or stale authorization; test two concurrent sweeps and two-connection revoke/unsubscribe/entitlement interleavings before implementation |
| R8/R9/R12 | Merge moves membership but queued recipient still points at old user; `#weekly-summary` is rejected by the current hash allowlist; cancelled/expired accounts can be denied before opt-out | Extend only summary subscription/recipient handling in existing account-merge transaction, add exact GET/DELETE recovery context and async account-card anchor, global summary-only purge | Lost or duplicate summary, unreachable opt-out, overbroad auth bypass; first write R8/R9/R12 tests including outsider tenant and disabled membership/branch cases; keep settings under ordinary paid/management gates; personal enrollment PUT removed |
| R11/R15–R18 | Former Goal 5 opened unsold `/income-expense-ledger`; former VAT row read unsold workspace facts; ledger currency/export work followed that link | Delete those planned changes and their tests; use sold dashboard/pending-expense URLs and account anchor only; no accounting-documents/VAT data write or new feature key | Home totals still have B9, so never promise equality; verify the card's destinations and labels, not unsold page behavior; preserve removed ids |

Impact remains as §11: new summary data is read by subscription API, delivery, bell, account page and worker; LINE sends URI cards only; AI Gateway, exports and financial/tax mutation paths gain no new access. Browser evidence is required at 390, 1280 and approximately 1556 px for every changed sold screen/dialog. No runtime proof is claimed by this document revision.

## Round-5 change boundaries — owner decision 2026-11-04

| Requirements | Concrete former-design/current integration failure | Smallest files/functions; shared impact | Risk and first test |
|---|---|---|---|
| R1/R12/R21 | Eligible owner has no subscription row → former opt-in design sends nothing; deleting an owner's row after stop would restore ON | Planned get/stop/settings use cases + explicit enabled Boolean in existing planned table, effectiveOwnerChoice in expense-weekly-summary.logic.ts; account/settings/sweep/send read same choice; no owner backfill | Unwanted owner reenrollment; `R1 default owner choice respects explicit false` and `R12 personal off persists owner false` first |
| R5/R6/R20 | Former seven-day cap would omit 2–4 Nov from a 12 Nov run after cursor 1 Nov; deriving only from events misses quiet coverage | Accepted Company weekday + membership cursor; planned weekWindow/nextCheckDate uses controller C1: cursor+1..yesterday with no seven-day cap, or seven-day fresh start for first/missing/older-than-31/OFF→ON. collectWeeklyDigest reads exact bounds; quiet advances cursor, ineligible does not clear/advance; no tax/export writes | Omitted/doubled expenses, wrong 31/32 boundary, unfair comparison or stale due instruction; first `R20 day changes never overlap or truncate uncovered dates` covers all five controller cases plus ineligible preservation; C1 is closed |
| R7/R8/R21 | Manager selects reader A while another removes A's read right; two managers save whole stale roster; close_duplicate OR would erase owner's newer personal off | Settings actor/candidates tx-resolved under existing Company/membership locks; partial touched fields only; merge chooses latest explicit value and retained scope, no Company lock after merge member lock | Data leak, lost opt-out, deadlock; registered permission/race/merge tests in §14 before mutation code |
| R11/R14/R21 | New footer appended after financial rows is cut by bell's two-line clamp; settings e-WHT neighbour does not exist yet | Existing SettingsMenu array + small dedicated form, live weekly-only NotificationSummaryDto footer, NotificationBell/Pages sibling links; account/LINE/bell read same current capabilities | Dead link/invisible exit or unauthorized settings hint; `R11 weekly footer remains visible and independently reachable`, existing journey at all three widths |

Web/API/workers/notification queue/account merge are affected; LINE remains shared-OA URI push. AI Gateway, source drafts/free quota, exports, withholding writes, unsold VAT/ledger, existing welcome/advisor/activity history and all other notice defaults are unchanged. No new current-code weekly bug is claimed: weekly feature is still planned. Existing B1–B9/G14 remain as scoped above; new G16–G22 are integration/design gaps with cited boundaries.

## Re-anchor 2026-11-04 — R19 change boundary

Failing former-design input: an active never-paid source-drafts shop has an OWNER role whose original grant includes expense.read. Permission intersection retains that key; the old eligibility formula could offer subscription or read summary facts despite the source-only route policy. This is a design gap; weekly summary is not implemented today, so no existing weekly delivery is claimed.

Smallest fix: one local `weeklySummaryPaidEligible({ companyStatus, term, freeExpenseDrafts }, now)` commercial-only predicate in the already-planned `expense-weekly-summary.logic.ts` (expense.read/branch is checked separately for recipients), reusing `BILLING_PAID_TIERS` and current resolver/term facts; no commercial-access service or stored flag. Apply it in personal `get/stop` and settings read/update; `collectWeeklyDigest` reads current company/term facts itself before expense/claim/WHT reads, without a caller-supplied eligibility authority; apply it in sweep before creation, and existing weekly branches of queued delivery/list/unread. Resolve current access and read the term under the existing Company/membership locks at send; cached client/free/permission flags are not authority. Use the same predicate for paid UI DTOs. `freeExpenseDrafts` is already in the request contract (`packages/contracts/src/index.ts:27`) and resolver (:130–131 in `prisma-permission-resolver.repository.ts`).

Web targets: pass the existing session flag from `apps/web/app/(workspace)/companies/[companyId]/account/page.tsx:7–9` and `apps/web/app/(workspace)/companies/[companyId]/settings/profile/page.tsx:16–21` into `CompanyProfilePage` (existing props at `apps/web/src/features/company-profile/CompanyProfilePage.tsx:72`); avoid mounting `WeeklySummaryCard` or calling its endpoint for free shops. Home invitation is removed for every cohort. Pass existing free flag plus newly derived weeklySummaryAccess display metadata to SettingsMenu and the new summary-settings route; free never mounts/calls that form. No replacement invitation or free route.

Impact: web/API/worker/notification readers only; LINE remains URI push, with no webhook/AI Gateway, export, tax-write or source-draft mutation. Free quota, attachment provenance, welcome/package advice and activity history retain their current paths. Risks: permission-only admission, querying draft facts as confirmed-spend summaries, stale paid status at push, lost expired-paid opt-out or a free UI flash. R19 tests above precede feature code. G14's existing daily-cohort gap is separately recorded and receives no new fix in this round.

## Traceability

R1–R15 and R19–R21 name the retained requirements, including all rules/contracts/state transitions/impact and UI clauses in §§5–11. R16–R18 are stable tombstones, not work to implement. Existing Goal/AC/Q/M ids are never renumbered. Exact names below are proposed tests; API paths are checked in the plan. A source-helper reference to the ledger is evidence of the calculation shape only and does not authorize edits to that unsold module.

| Requirement | Opened evidence (quote ≤15 words) | Plan step | Test file + proposed test name | Acceptance | First source document |
|---|---|---|---|---|---|
| R1 — owner default, permitted picks, personal off | `apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts:81` — `const activeRoles = membership.roles.filter`; `apps/api/prisma/schema.prisma:1044` — `@@id([membershipId, roleId])` | 2.1, 2.2, 2.4, 5.2 | `apps/api/src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts` — `R1 default owner choice respects explicit false`; `apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts` — `R1 multiple no-row owners and unlinked owner bell` | AC1/AC8/AC36 | Owner decision 2026-11-04 quoted in §2; this spec §13 B4 |
| R2 — actual date/scope/THB/category facts | `apps/api/src/modules/dashboard-notifications/application/providers/expense-summary.provider.ts:67` — `status: 'CONFIRMED', expenseDate: civilDayRangeToUtc(fromDate, toDate)`; `apps/api/src/modules/data-model-core/domain/logic/branch.logic.ts:82` — `{ branchId: null }` | 3.1, 3.2, 5.4 | `apps/api/src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts` — `R2 digest separates THB and other-currency counts`; `R20 equal-length comparison and tax month use the run date`; `apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts` — `R2 scoped branches include central expenses` | AC2/AC6/AC23/AC25/AC34 | This spec §5.1/§13 B8/B9; owner day decision 2026-11-04 |
| R3 — four fixed signals in the card only | `apps/api/src/modules/workflow/application/use-cases/workflow-scan-candidates.use-case.ts:219` — `const payableSince = lastVoid`; `apps/api/src/modules/workflow/application/use-cases/workflow-scan-candidates.use-case.ts:203` — `paymentDuplicateBlock !== 'CONFIRMED'` | 3.1, 3.2, 5.4 | `apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts` — `R3 vendor identity and strictly over seven days obey scope`; `apps/api/src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts` — `R20 equal-length comparison and tax month use the run date` | AC9/AC12/AC26/AC34 | This spec §5.2; Q3 owner answer 2026-11-04 |
| R4 — PND3/53 information from run date | `apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts:111` — `.filter(payment => payment.paidAtConfirmed)`; `apps/api/src/modules/tax/application/services/withholding-filing-state.ts:75` — `return events.filter` | 3.1, 3.2, 5.4 | `apps/api/src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts` — `R4 known unfiled PND3 or PND53 payment gives information without form button`; `R4 bank-remitted expense needs no payer reminder`; `R20 equal-length comparison and tax month use the run date`; `apps/api/src/modules/dashboard-notifications/application/use-cases/process-due-deliveries.use-case.spec.ts` — `R11 live manager hint and expired tax row rendering` | AC10/AC22/AC27/AC35 | This spec §5.3; owner ceiling 2026-10-26 and weekday decision 2026-11-04 |
| R5 — daily eight, chosen weekday, quiet, zero AI | `apps/workers/src/modules/notifications/notification-jobs.ts:59` — `pattern: '0 7 * * *', tz: 'Asia/Bangkok'` | 3.1, 3.4, 3.6, 5.4 | `apps/api/src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts` — `R5 daily eight filters selected weekday`; `apps/workers/src/modules/notifications/notification-jobs.spec.ts` — `R5 daily eight cron and chosen-weekday dispatch` | AC2/AC3/AC25/AC35 | This spec §5.1/§5.4; owner Q1/Q4 2026-11-04 |
| R6 — one event per member and actual range | `apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts:205` — `pg_advisory_xact_lock`; `apps/api/src/modules/dashboard-notifications/domain/logic/notification.logic.ts:28` — `params.periodKey ?? '_'` | 3.3, 3.4, 5.4 | `apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts` — `R6 concurrent chosen-day retries freeze one range` | AC4/AC5/AC34 | This spec §13 B6/B7 and §5.1; owner weekday decision 2026-11-04 |
| R7 — live permission/branch checks | `apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts:506` — `const activeMemberships = await tx.$queryRaw`; `apps/api/src/modules/access-control/application/permission-resolver.service.ts:12` — `async resolveAccess` | 3.5 | `apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts` — `R7 committed revocation precedes push under Company lock`; `apps/api/src/modules/dashboard-notifications/application/use-cases/process-due-deliveries.use-case.spec.ts` — `R7 changed audience suppresses queued digest` | AC7/AC19 | `docs/specs/proactive-expense-summary-spec.md` §8; review R2-F1 |
| R8 — merge explicit choices, cursor and recipient safely | `apps/api/src/modules/auth/application/use-cases/account-merge.use-case.ts:162` — `ORDER BY id FOR UPDATE`; `apps/api/src/modules/auth/application/use-cases/account-merge.use-case.ts:219` — `data: { userId: row.existingUserId }` | 2.5, 3.4, 5.1, 5.4 | `apps/api/src/modules/auth/application/use-cases/account-merge.use-case.spec.ts` — `R8 newest explicit choice survives duplicate merge`; `apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts` — `R8 merge races sweep without orphan event` | AC17/AC21/AC29/AC38 | This spec §6/G17; reviews F11/R2-F6/R3-P27; owner explicit choices 2026-11-04 |
| R9 — retention independent of subscriptions | `apps/api/prisma/schema.prisma:1587` — `onDelete: Cascade` | 2.1, 3.4, 5.4 | `apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts` — `R9 purge covers empty inactive and subscribed companies` | AC18 | `docs/specs/proactive-expense-summary-spec.md` §5.6; review R2-F5 |
| R10 — retire every daily producer | `apps/api/src/modules/dashboard-notifications/presentation/http/internal.controller.ts:138` — `this.dailyOwnerSummary.execute`; `apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts:316` — `triggerKey: 'daily_owner_summary'` | 2.1, 2.3 | `apps/api/src/modules/dashboard-notifications/presentation/http/internal.controller.spec.ts` — `R10 daily route is inert and retired rule cannot reopen` | AC15 | `docs/specs/proactive-expense-summary-spec.md` §13 B1/B4 |
| R11 — truthful card, live settings hint and exits | `apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts:353` — `if (delivery.channel === 'WEB')`; `apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts:397` — `errorCode: 'NO_LINE_DELIVERY_TARGET'`; `apps/web/src/features/dashboard-notifications/NotificationBell.tsx:107` — `line-clamp-2` | 2.4, 3.1, 3.8, 5.3, 5.4 | `apps/api/src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts` — `R11 card has only sold URI destinations and truthful plain Thai`; `apps/api/src/modules/dashboard-notifications/application/use-cases/process-due-deliveries.use-case.spec.ts` — `R11 live manager hint and expired tax row rendering`; `apps/api/src/modules/dashboard-notifications/application/use-cases/notification-preference.use-case.spec.ts` — `R11 missing LINE never promises an unavailable bell`; `apps/web/src/features/dashboard-notifications/NotificationPages.spec.ts` — `R11 weekly footer remains visible and independently reachable` | AC14/AC16/AC36/AC37/AC39 | This spec §10; owner settings/opt-out decision 2026-11-04 |
| R12 — personal stop stores off, no home enrollment | `apps/web/src/features/company-profile/company-profile.logic.ts:68` — `['shop', 'vat-status', 'account']`; `apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts:112` — `throw new ForbiddenException('No active branch scope assigned.')` | 2.4, 2.6; 2.7 removed; 5.3 | `apps/api/src/modules/dashboard-notifications/application/use-cases/notification-preference.use-case.spec.ts` — `R12 personal off persists owner false`; `apps/api/src/modules/auth/auth.guard.spec.ts` — `R12 opt-out survives expiry suspension and disabled selected branches`; `apps/web/src/features/company-profile/CompanyProfilePage.qa.spec.ts` — `R12 owner default status and personal stop` | AC1/AC20/AC24/AC28/AC38/AC39 | This spec §7/§10.3/G18; owner Q1/Q2 replacement 2026-11-04 |
| R13 — existing sold duplicate-list filter | `apps/web/src/features/expenses/ExpensesPages.tsx:2704` — `requestedView === 'pending'` | 3.7 | `apps/web/src/features/expenses/expense-list-navigation.logic.spec.ts` — `R13 duplicate view uses existing expense filter` | AC31 | `docs/specs/proactive-expense-summary-spec.md` §1 duplicate list gap |
| R14 — settings proof, default-owner budget and release | `apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts:544` — `pushLineMessage`; `e2e/journeys/shop-menus-everyday.journey.spec.ts:9` — `width: 1556` | 3.8, 5.5, 4.1–4.4 | `e2e/journeys/shop-menus-everyday.journey.spec.ts` — `R21 summary settings and personal stop at three widths` | AC1/AC2/AC16/AC24/AC39 | This spec §14/§16; owner Q5 controller task 2026-11-04 |
| R15 — sold feature ceiling | `packages/contracts/src/menu-entitlements.ts:500` — `'wht_pnd53', 'wht_50bis'`; `apps/web/src/features/web-core-workspace/route-permissions.ts:75` — `path: '/income-expense-ledger'` | All retained steps; 1.1–1.3 removed | `apps/api/src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts` — `R15 lower pack reminder has no unsold page button` | AC16/AC22 | `docs/specs/proactive-expense-summary-spec.md` Goal 5; owner ceiling 2026-10-26 |
| R16 — removed 2026-10-26 (ceiling): Goal 5 ledger menu | `apps/web/src/features/web-core-workspace/route-permissions.ts:75` — `'expense.read'` | 1.1–1.3 removed | None; ledger web/browser tests removed | AC13 removed | `docs/specs/proactive-expense-summary-spec.md` Goal 5 / old §10.4 |
| R17 — removed 2026-10-26 (ceiling): VAT reminder | `packages/contracts/src/menu-entitlements.ts:432` — `const STARTER_FEATURE_KEYS` | 3.1/3.2 VAT clauses removed | None; VAT-fact/helper tests removed | AC11 removed; Q6 removed | `docs/specs/proactive-expense-summary-spec.md` old §5.3 |
| R18 — removed 2026-10-26 (ceiling): ledger export | `apps/api/src/modules/accounting-documents/application/use-cases/income-expense-ledger.use-case.ts:154` — `status: 'CONFIRMED', expenseDate: civilRange` | 1.2 removed | None; ledger CSV/XLSX tests removed | AC30 removed | `docs/specs/proactive-expense-summary-spec.md` old §11 Export / review R3-F5 |
| R19 — paid eligibility, free exclusion | `apps/api/src/modules/system-partner-management/application/free-expense-access.ts:61` — `'expense.read'`; `apps/api/src/modules/system-partner-management/application/free-expense-access.ts:72` — `export function isFreeExpenseDraftRoute`; `packages/contracts/src/billing.ts:9` — `export const BILLING_PAID_TIERS` | 2.4, 2.6, 3.2, 3.4, 3.5, 3.8, 5.1/5.2/5.3/5.5 | `apps/api/src/modules/dashboard-notifications/application/use-cases/notification-preference.use-case.spec.ts` — `R19 only paid access reaches summary metadata or settings`; `apps/api/src/modules/auth/presentation/auth.controller.spec.ts` — `R19 session summary access distinguishes paid recovery trial and free`; `apps/api/src/modules/auth/auth.guard.spec.ts` — `R19 free weekly routes stay outside recovery`; `apps/api/src/modules/dashboard-notifications/application/providers/expense-summary.provider.spec.ts` — `R19 free access never reaches weekly expense or WHT queries`; `apps/api/src/modules/dashboard-notifications/application/use-cases/process-due-deliveries.use-case.spec.ts` — `R19 nonpaid queued summaries are suppressed before push`; `apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts` — `R19 commercial eligibility is rechecked for sweep bell and delivery`; `apps/web/src/features/company-profile/CompanyProfilePage.qa.spec.ts` — `R19 free account hides weekly summary without an API request`; `apps/web/src/features/dashboard-notifications/DashboardPages.rendered.spec.ts` — `R19 free home never invites weekly opt-in` | AC32/AC33/AC39 | `docs/specs/free-expense-drafts-spec-th.md` D02/D04; `docs/agent-memory/line-ai-workflow-first.md` weekly-summary handoff |
| R20 — continuing period without seven-day cap, fresh starts and quiet coverage | `apps/api/prisma/schema.prisma:1554` — `payloadJson    Json`; `apps/api/prisma/schema.prisma:1557` — `dedupKey       String`; `packages/contracts/src/civil-date.ts:126` — `export function addCivilDays` | 5.1, 5.4, 5.5 (C1 closed 2026-11-04) | `apps/api/src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts` — `R20 day changes never overlap or truncate uncovered dates`; `R20 equal-length comparison and tax month use the run date`; `apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts` — `R20 cursor event and quiet checks commit once` | AC3/AC4/AC34/AC35 | Controller decision C1 2026-11-04 (not owner question); this spec §5.1/G16/G19; tests include ten-day, 31/32-day, quiet→active and OFF→ON cases |
| R21 — paid management, eligible choices and concurrent saves | `apps/api/src/modules/expenses/presentation/http/expense.controller.ts:808` — `@RequirePermissions('company.setup.manage')`; `apps/api/src/modules/system-partner-management/application/lock-plan-term-company.ts:5` — `FOR UPDATE`; `apps/web/src/features/web-core-workspace/SettingsMenu.tsx:89` — `grid gap-3 sm:grid-cols-2 xl:grid-cols-3` | 5.2, 5.3, 5.5 | `apps/api/src/modules/dashboard-notifications/application/use-cases/notification-preference.use-case.spec.ts` — `R21 settings require paid management and current reader candidates`; `apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts` — `R21 concurrent managers and personal stop serialize touched choices`; `apps/api/src/modules/auth/auth.guard.spec.ts` — `R19 free summary settings deny before roster read`; `e2e/journeys/shop-menus-everyday.journey.spec.ts` — `R21 summary settings and personal stop at three widths` | AC32/AC36/AC37/AC38/AC39 | Owner recipient decision 2026-11-04; this spec §10.3a; e-WHT spec §5.5 guard reuse |
