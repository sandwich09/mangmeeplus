# Production Readiness Audit — ฉบับรวม (2026-08-09)

รวมจากสองรอบการตรวจที่วิเคราะห์ระบบเดียวกันคนละแนวทาง:
- **รอบ 1 (module audit)** — ตรวจรายโมดูลแบบ deep-read 8 สายขนาน → เดิม `production-readiness-audit-2026-08-09.md`
- **รอบ 2 (use-case journey)** — ออกแบบสถานการณ์ผู้ใช้จริง 8 แบบแล้วเดินทีละขั้นข้ามโมดูล → เดิม `production-readiness-usecase-audit-2026-08-09.md`

ข้อที่ความหมายตรงกันถูกรวมเป็นข้อเดียว (อ้าง `[R1]`/`[R2]` เพื่อสืบกลับ). ข้อที่สองรอบ **เห็นต่าง** ใส่ไว้เป็น
`> **REMARK (สองรอบเห็นต่าง):**` ตรงจุดนั้น. `✓` = ผู้ตรวจไล่โค้ด/รันพิสูจน์เองแล้ว.

ขอบเขต: dashboard, รายรับรายจ่าย, ใบทดแทนใบเสร็จ, พนักงาน, ตั้งค่า, สิทธิ์, รายการเบิกจ่าย, การเปิดปิดฟีเจอร์, LINE, AI, noti — functional + non-functional.

---

## Reviewer remarks — Codex (2026-08-09)

สถานะการรีวิว: **REVIEWED WITH MATERIAL QUALIFICATIONS** — ฉบับรวมเก็บ finding จากสองรอบได้ค่อนข้างครบและใช้เป็น
risk register ได้ดี แต่ **ยังไม่ควรใช้ severity/P0 ตามเอกสารนี้เป็น release gate โดยไม่ปรับสถานะ** เพราะมีทั้งข้อมูลเก่า,
product decision ที่ยอมรับไว้แล้ว, capability gap ที่ยังไม่ได้ผูกกับ launch scope และข้อสรุปที่แรงกว่าหลักฐาน.

| ประเด็น | ความเห็นผู้รีวิว | Remark / ผลต่อคำตัดสิน |
|---|---|---|
| Verdict รวม | **เห็นด้วยแบบมีเงื่อนไข** | โมดูลบัญชี/ภาษีและ UI สมุดรายวันไม่อยู่ใน current launch scope จึงไม่ใช้ “ไม่มี accounting UI” เป็น NO-GO. อย่างไรก็ตาม current launch ยังต้องเก็บ hidden ledger จากใบเสร็จ/รายจ่ายและการเบิกจ่ายให้ครบ; CR-2/CR-6/H-7/H-28 จึงยังเป็น blocker เท่าที่กระทบท่อเบื้องหลังนี้ |
| จำนวน Critical | **เห็นต่าง** | ในเอกสารมีหัวข้อ CR-1 ถึง CR-13 รวม **13 ข้อ** ไม่ใช่ “~15”; หลัง reclassify CR-1/CR-10/CR-11 จำนวน confirmed Critical จะยิ่งน้อยลง ต้องนับใหม่จากสถานะล่าสุด |
| CR-1 Redis/prod boot | **✅ RESOLVED 2026-08-09** | live recheck พบ api-web, AI และ workers เป็น `ACTIVE`, มี active configuration และ task `RUNNING` อย่างละ 1; `GET /v1/auth/me` ผ่าน global request path และคืน 401 แทน Redis failure 503. ข้อความ “capacity 0/บูตไม่ได้” เป็นสถานะก่อน production relaunch. การอ่าน ElastiCache security/DR โดยตรงยังถูก IAM ปฏิเสธ จึงแยกเป็น `EVIDENCE_NEEDED` และไม่ใช้เปิด CR-1 กลับ |
| H-1 DOB password | **เห็นด้วยว่าเสี่ยง แต่เห็นต่างว่าเป็น defect** | `docs/agent-memory/password-reset-line-flow.md:26` บันทึก owner decision 2026-07-25 ให้ DDMMYYYY ไม่หมดอายุจน login ด้วย password ครั้งแรกและบังคับเปลี่ยน ซึ่งตรงกับ implementation. ให้จัดเป็น **ACCEPTED RESIDUAL RISK / ต้อง re-accept ก่อน prod**; ห้ามเปลี่ยน policy ตาม remediation เดิมโดยไม่มี product decision ใหม่ |
| CR-2/6/7 | **เห็นด้วยเป็น blocker ของ full accounting GA** | static trace รองรับว่า posting-rule writer, revenue/reimbursement posting และ branch numbering มีช่องขาดจริง. สำหรับ current launch ให้บังคับเฉพาะ source ที่ต้องเข้า hidden ledger; journey งบ/ปิดงวด/เอกสารรายรับย้ายไป gate ของโมดูลบัญชีในอนาคต |
| CR-3 accounting UI | **🟡 SCOPE CLARIFIED — UI ไม่ต้องมี, hidden ledger ยัง OPEN** | owner decision 2026-08-09: ยังไม่เปิดฟีเจอร์บัญชี จึงซ่อน UI create/post/reverse/report/period-close ได้ แต่ใบเสร็จ/รายจ่ายและการเบิกจ่ายต้องสร้างรายการบัญชีภายในแบบไม่แสดง. ใบทดแทนเป็น evidence ของ `ExpenseRecord` เดิมและต้องไม่สร้างยอดซ้ำ |
| CR-4/5/8/9/12/13 | **เห็นด้วยว่าเป็น capability/compliance gap; severity ขึ้นกับ scope** | หลายข้อคือฟีเจอร์ยังไม่ถูกสร้าง ไม่ใช่ regression/runtime failure. ต้องผูกแต่ละข้อกับ approved product scope, legal acceptance criteria และตัวอย่างเอกสาร/งบที่ตรวจโดยผู้รับผิดชอบบัญชีหรือภาษี ก่อนใช้คำว่า “ทุกใบ/ตลอดไป/ผิดกฎหมาย” เป็น confirmed Critical |
| CR-10 PDF scanner | **RESOLVED 2026-08-10 — override ถูกยกแล้ว** | corpus ของ PDF ที่ well-formed จริง (pdf-lib, image XObject `/FlateDecode` ต่อหน้า) ยืนยันคำว่า “ใบเสร็จจริงเป็นส่วนใหญ่” ที่ระดับ multi-page: 13% ที่ 0.5 MB → 78% ที่ 10 MB. ตัวเลข random-byte เดิมสูงไปเล็กน้อยแต่อันดับความรุนแรงตรงกัน. แก้แล้ว → 0/400 |
| CR-11 ปี พ.ศ. | **เห็นด้วยว่าเป็น bug; เห็นต่างระดับความรุนแรง** | API รับปี 2569 เป็น Gregorian ได้จริง แต่โดยตัวมันเหมาะกับ High data-integrity/input-validation มากกว่า Critical; ยกระดับเป็น Critical เมื่อพิสูจน์ว่า flow statutory/posting รับข้อมูลนี้จนแก้คืนไม่ได้หรือกระทบรายงานที่ยื่นจริง |
| H-17/H-18 self-approval | **เห็นต่างกับข้อสรุปว่า owner ถูกล็อกถาวร** | reimbursement spec กำหนด default ให้ block self-approval และระบบมี `allowSelfApproval` policy + settings UI แล้ว; journey เดิมก็เคยยืนยันว่าเปิด policy แล้ว approve ได้. ความต่างจาก procurement role exemption เป็น **policy inconsistency/UX-onboarding gap** ไม่ใช่หลักฐานว่าต้องพอร์ต exemption มาโดยอัตโนมัติ |
| H-23 ValidationPipe | **เห็นด้วยเฉพาะ finding ที่ reproduce ได้** | การไม่มี class DTO 164/277 จุดเป็น exposure inventory ไม่ได้พิสูจน์ว่า 164 จุดไม่มี validation เพราะบาง path validate ใน use case/domain. คง High ให้ endpoint ที่มี type-confusion/invalid data reproduction; ที่เหลือต้อง audit เป็นราย contract ก่อนนับเป็น systemic vulnerability |
| H-29 CI | **เห็นด้วยเฉพาะ E2E gap** | การไม่มี Playwright ใน CI เป็น regression risk จริง; แต่ docs-only commit ที่ skip code tests แล้วเขียวเป็น path-filter ปกติ ไม่ใช่ defect หาก deploy gate ยืนยัน tested artifact/SHA. ควรแยกเป็นสอง finding |
| ความครบของการ consolidate | **พบตกหล่นอย่างน้อย 1 High** | finding รอบ 1 เรื่อง daily owner summary ได้ “0 วิดเจ็ต” แม้มี rule ไม่ได้ถูกเก็บเป็นสาเหตุอิสระในฉบับรวม; ดู remark ใต้ H-12. ข้อ Low เรื่อง branch/partner edit ไม่มี optimistic concurrency ก็ตกหล่น แต่ไม่เปลี่ยน verdict |

หลักฐานที่ผู้รีวิวรัน/อ่านเพิ่มจากสองรายงาน: workspace typecheck ผ่าน, full unit/integration test ผ่าน, focused E2E ใน scope
48/48 ผ่าน, smoke 35/36 (fail ที่ booking fixture นอก scope), dependency audit ไม่พบ High/Critical (Moderate 6, Low 1), และ
live production services/RDS อยู่สถานะทำงาน. อย่างไรก็ดี `next build` ค้างที่ “Creating an optimized production build…” ซ้ำ 2 รอบ,
workers ยัง version-skew จาก api-web/AI, ยังไม่ได้รัน authenticated LINE→AI→ERP→reply จริง, load test หรือ restore drill. ดังนั้น
**build reproducibility, release-version consistency, LINE/AI live journey, capacity และ recovery ยังเป็น evidence gap ที่ฉบับรวมควรเพิ่ม**.

ก่อนใช้เอกสารเป็น sign-off ให้เติมทุก finding ด้วยสถานะหนึ่งใน `CONFIRMED`, `CONDITIONAL_ON_SCOPE`, `EVIDENCE_NEEDED`,
`ACCEPTED_RISK`, `RESOLVED` พร้อม owner, reproduction/acceptance test และหลักฐาน retest. Remark ด้านล่างที่ระบุ
**REVIEWER OVERRIDE** ให้ถือว่าสำคัญกว่าการจัดลำดับเดิมจนกว่าจะมีหลักฐานใหม่.

---

## 0. คำตัดสิน (verdict)

ระบบมี **ฐานสถาปัตยกรรมที่ดีมาก** — deny-by-default guard, per-request permission resolution, tenant scoping
มีวินัย, money = Decimal เกือบทั้งหมด, LINE/AI boundary แน่นหนาระดับ production, control plane ของ
feature-launch/entitlement เข้มงวดจริง.

แต่ **ยังไม่ควรเปิดใช้งานจริง**. ชั้นบันทึกเอกสาร/สิทธิ์/เวิร์กโฟลว์/LINE ใช้งานได้ แต่ **ชั้นบัญชี (accounting
output layer) ใช้งานไม่ได้เชิงโครงสร้าง** — ชิ้นส่วนถูกออกแบบไว้ครบแต่ไม่เคยถูกต่อเข้าด้วยกัน ลูกค้าจริงบันทึก
เอกสารได้ แต่ไม่มีอะไรไหลไปถึงบัญชีแยกประเภท งบทดลอง งบกำไรขาดทุน งบดุล และการปิดงวด. สำหรับผลิตภัณฑ์บัญชี
นี่คือสิ่งที่ลูกค้าจ่ายเงินซื้อ.

> **REMARK (สองรอบเห็นต่าง — สำคัญที่สุด):**
> รอบ 1 สรุปว่า "ฐานดี มี blocker ~1 Critical + ~13 High ที่ปิดได้ก่อน launch" — โดยมองปัญหาการลงบัญชีเป็น
> Medium กระจาย (partial payment ลงบัญชีไม่ได้, timezone ฯลฯ). รอบ 2 เดิน journey จริงแล้วพบว่าอาการ
> เหล่านั้นมี **ต้นเหตุร่วม** (ไม่มีทางสร้าง PostingRule + ไม่มี UI ลงรายการ) ที่ทำให้ทั้งชั้นบัญชีตาย จึง
> **ยกระดับคำตัดสินจาก "มี blocker" เป็น "core deliverable ยังไม่พร้อม"**. บทเรียน: การตรวจรายโมดูลไม่เห็น
> ความพังที่อยู่ตรงรอยต่อ end-to-end — ต้องเดิน use case จริงถึงเจอ.

**สรุประดับความรุนแรงที่ผู้ตรวจเดิมจัดหลังรวม:** 13 Critical ที่มีหมายเลข CR-1..CR-13, 31 High ที่มีหมายเลข
H-1..H-31, Medium/Low อีกมาก.
CR-1 ปิดแล้ว เหลือ Critical ที่ยังไม่ทำเครื่องหมาย resolved 12 ข้อ; จำนวน confirmed Critical หลัง reviewer disposition
ต้องนับใหม่ตามตาราง Reviewer remarks.

---

## 1. CRITICAL

### ✅ CR-1 [RESOLVED 2026-08-09] Production Redis/boot blocker ปิดแล้ว

- **สภาพเดิม [R1]:** `docs/runbooks/cloud-environment-operations.md:107-121` บันทึกช่วงที่ production capacity เป็น 0
  และ secret `redis-url` ยังชี้ Redis cluster ที่ถูกลบ จึงประเมินว่า service จะขึ้นไม่ได้หรือ request ที่ใช้ Redis จะ fail-closed 503.
- **สถานะปัจจุบัน:** production ถูก bootstrap/relaunch แล้ว. AWS live readback วันที่ 2026-08-09 ยืนยันว่า api-web,
  AI และ workers มี service status `ACTIVE`, active configuration อย่างละ 1 และ task `RUNNING` อย่างละ 1.
- **Runtime evidence:** `GET https://mangmeeplus.com/v1/auth/me` คืน 401 ตาม auth guard ไม่ใช่ 503 จาก global
  Redis-backed rate limiter. RDS `watchdog-bms-prod-db` เป็น `available`, encrypted, Multi-AZ, deletion protection เปิด
  และ backup retention 35 วัน.
- **Active image digests:** api-web `sha256:9c655e1a06ba…`, AI `sha256:8a159d8e1f30…`, workers
  `sha256:e9495744a970…` (active configuration อย่างละรายการ).
- **Disposition:** ข้อกล่าวหา “production บูตไม่ขึ้นเพราะ Redis secret เก่า” **แก้แล้วและปิด CR-1**. ข้อความ capacity 0
  ใน runbook เป็น historical state ก่อน relaunch ไม่ใช่สถานะ production ปัจจุบัน.
- **Residual evidence gap (ไม่ reopen CR-1):** IAM ของผู้ตรวจไม่มีสิทธิ์ `DescribeReplicationGroups` จึงยังยืนยัน
  ElastiCache encryption/failover/auth/snapshot baseline โดยตรงไม่ได้; ให้ติดตามเป็น security/DR evidence แยกจาก boot blocker.

### CR-2 ✓ [R2] ไม่มีโค้ดสร้าง PostingRule ได้ แต่ onboarding ทำให้มันเป็นข้อบังคับ → ทุกการลงบัญชีตาย
ลูกโซ่ยืนยันครบ:
1. onboarding ประทับ `chartOfAccountsTemplateKey` ทุกบริษัท — `chart-template-bootstrap.service.ts:131`
2. `requiresReviewedPostingRules()` คืน true ทันทีที่มีค่าใด ๆ — `posting-engine.logic.ts:65`
3. **ไม่มี writer ของตาราง `PostingRule` เลย** — grep `apps/api/src`+`prisma/`+`scripts/` เจอแค่ DDL
   (`migrations/20260625000001_.../migration.sql:93`); permission `ledger.posting-rule.manage` มีใน registry
   (`permission-registry.ts:205`) แต่ไม่มี route ไหนใช้
4. `journal.use-case.ts:527` โยน `posting_rule_missing` + mark เอกสารเป็น `posting_error`; fallback
   `buildDefaultPostingLines` (บรรทัด 552) ไม่มีวันถูกเรียกถึง
- dev seed ก็ประทับเหมือนกัน (`seed.ts:2960`) + spec `template-company-posting.use-case.spec.ts:128`
  assert ว่าต้อง true → **พังทั้ง dev และ prod และถูกเทสยืนยันว่า "ถูกต้อง"**
- Impact: เจ้าของกดปุ่ม "สร้าง JV" ได้ *"ยังไม่ได้กำหนดกฎการลงบัญชี..."* ชี้ไปหน้าจอที่ไม่มีจริง; เอกสารกลายเป็น
  `posting_error` ถาวร เกิดกับทุก source: expense, invoice, vendor bill, supplier payment.

#### CR-2 × launch scope — เกี่ยวกับ 11 ฟีเจอร์ที่จะเปิดใช้แค่ไหน ✓ [R3 ตรวจเพิ่ม 2026-08-09]

ตัวแปรที่ชี้ขาดคือ **ค่า default ของ entitlement ตอน onboarding** (`system-partner-management/domain/feature-registry.ts`):

- `double_entry_ledger` **เปิดตั้งแต่วันแรกและยังเปิดอยู่** (owner decision 2026-08-04 "a Thai SME buys the
  tax/accounting journey") — ตั้งใจไม่ปิด เพื่อให้ posting ฝั่ง server ทำงานต่อ; UI ถูกซ่อนแทน ดู
  [สถานะการแก้](#สถานะการแก้-2026-08-09) ท้ายหัวข้อนี้
- `expense_auto_post` **ปิดไว้โดยตั้งใจ** (ให้ค้างเป็น `pending` แล้วค่อย backfill ตอนเปิด)

ในสภาพ **ก่อน**ซ่อน UI: CR-2 **ไม่ยิงเองอัตโนมัติตอน launch** (worker drain ข้ามบริษัทที่ `expense_auto_post` ปิด —
`expense-auto-post.use-case.ts:24-28,126-128`) แต่ **ปุ่มที่ยิงมันอยู่ในมือผู้ใช้แล้ว** เพราะ `double_entry_ledger` เปิดอยู่
→ feature-gate ไม่ strip permission `journal.entry.*` → ปุ่มและเมนูบัญชีโผล่ครบ

| # | ฟีเจอร์ที่จะเปิด | เกี่ยว CR-2 | หลักฐาน |
|---|---|---|---|
| 1 | dashboard | **ไม่** | snapshot มี provider แค่ 2 ตัว (`application/providers/` = expense-summary + inventory-health); `expense-summary.provider.ts:33-45` aggregate `expenseRecord` ล้วน ไม่แตะ journal/account balance |
| 2 | รายรับรายจ่าย | **ใช่ — โดยตรง เห็นหน้าจอ** | ปุ่ม "ลงบัญชี"/"ลองอีกครั้ง" `ExpensesWorkspacePanels.tsx:782-786` → `postExpense:518-529` → `generateSourceJournal` → 400 `posting_rule_missing`; ปุ่ม backfill `:644`; badge แดง `posting_error` `:768` |
| 3 | ใบทดแทนใบเสร็จ | **ใช่ — สืบทอดมา** | `expenses/application/use-cases/substitute-receipt.use-case.ts` อยู่ในโมดูล expenses ปลายทางเป็น `ExpenseRecord` เดียวกัน → เข้าเส้น posting เดียวกัน |
| 4 | พนักงาน | **ไม่** | employee-access ไม่มี dependency ฝั่ง ledger |
| 5 | ตั้งค่า | **ใช่ — และเป็นกับดัก** | ดูหัวข้อถัดไป |
| 6 | สิทธิ์ | **ไม่ (แต่มี permission ผี)** | `permission-registry.ts:205` มี `ledger.posting-rule.manage` แต่ไม่มี route ไหนเขียนตาราง `PostingRule` — สิทธิ์ที่ให้ไปแล้วไม่ได้อะไร |
| 7 | รายการเบิกจ่าย | **ไม่ใช่วันนี้ / ใช่ทันทีที่ต่อสาย** | engine รองรับ `case 'reimbursement.payment'` (`posting-engine.logic.ts:188`) แต่ไม่มีใครเรียก generate — `reimbursement-finance.use-case.ts:360` append outbox `reimbursement.payment_recorded` เฉย ๆ |
| 8 | การเปิดปิดฟีเจอร์ | **ใช่ — และเป็นคันโยกคุมความเสียหาย** | ดูหัวข้อถัดไป |
| 9 | LINE | **ไม่** | `erp-business-tools.use-case.ts:3` ประกาศ read-only; `line-ai-ledger.service.ts` คือ AI turn ledger บน Redis คนละเรื่องกับบัญชี |
| 10 | AI | **ไม่** | ai-draft/ai-suggestion ออกเป็น draft/suggestion ไม่มีขาลงบัญชี |
| 11 | noti | **ไม่** | `notification-sweeps.use-cases.ts` อ่าน `notificationRule`/dashboard; ไม่มี event `posting_error` ในระบบแจ้งเตือน |

**ข้อ 5 "ตั้งค่า" เป็นกับดัก ไม่ใช่แค่ "หน้าจอไม่มี":** ข้อความ error บอกผู้ใช้ว่า *"กรุณาตั้งค่ากฎการลงบัญชีก่อน"*
(`expenses.model.ts:459`) → ผู้ใช้ไปหน้า ตั้งค่า → ผังบัญชี/ภาษี ซึ่ง**มีจริงและใช้ permission ชื่อเดียวกัน**
(`AccountingTaxSetupPage.tsx:129` `canMapAccounts = ledger.posting-rule.manage && tax.config.manage`) แต่ปุ่มในหน้านั้นเขียน
`upsertTaxAccountRule`/`upsertTaxReportMapping` (`:329,334`) **ไม่ใช่ตาราง `PostingRule`** → ผู้ใช้ทำครบทุกช่องในหน้านั้น
แล้วกดลงบัญชีใหม่ ก็ยัง `posting_rule_missing` เหมือนเดิม. ซ้ำร้าย ปุ่ม `applyChartTemplate` (`:289`) ในหน้าเดียวกัน
คือสิ่งที่ประทับ `chartOfAccountsTemplateKey` = **ตัวขึ้นลำกับดัก** (`posting-engine.logic.ts:65`)

> **REMARK (แก้ไขคำอธิบายเดิมของรอบ 2):** รอบ 2 เขียนว่า *"ชี้ไปหน้าจอที่ไม่มีจริง"* — แม่นกว่าคือ **หน้าจอมีจริง
> แต่แก้ไม่ได้**. อาการแย่กว่าที่รายงานไว้เดิม เพราะผู้ใช้จะเชื่อว่าตัวเองตั้งค่าครบแล้วและโทษว่าระบบพัง แทนที่จะรู้ว่าฟีเจอร์ยังไม่มี.

**ข้อ 8 "การเปิดปิดฟีเจอร์" ปัจจุบันผูก UI กับ backend แน่นเกินไป:** `double_entry_ledger` ไม่อยู่ใน
`PLATFORM_INVARIANT_FEATURE_KEYS` (`feature-entitlements.ts:587` = `employee_access`, `company_settings` เท่านั้น)
จึงปิดแล้ว strip `ledger.*`/`journal.entry.*` และซ่อนปุ่ม/เมนูได้ (`web-core-workspace.constants.ts:162-167,266`)
แต่การปิด flag เดียวกันหยุด backend ledger ที่ owner ต้องการเก็บไว้ด้วย จึงใช้เป็นคำตอบของ current launch ไม่ได้.

> **OWNER DECISION 2026-08-09 (แทนตัวเลือกเดิม):** ไม่เปิด accounting UI แต่ให้ ledger core ทำงานเบื้องหลัง.
> ต้องแยก presentation visibility ออกจาก backend entitlement/posting: ซ่อนปุ่ม "ลงบัญชี", เมนู "สมุดรายวัน" และ
> "รอบบัญชี" แต่คง source posting สำหรับ expense/reimbursement. `expense_auto_post` ที่ default OFF ต้องเปิดหรือแทนด้วย
> guaranteed background path. ดังนั้นแนวทางเดิม “ปิด `double_entry_ledger` แล้ว 11 ฟีเจอร์ทำงานครบ” ถูกยกเลิก.

> **REMARK (ผูก CR-2 กับฟีเจอร์):**
> - **รายการเบิกจ่าย — current launch P0** → `reimbursement.payment` และ expense projection ต้องมี PostingRule/fallback
>   ที่ใช้งานได้ และต้องแก้ H-28 (`linkedExpenseId`) พร้อมกัน มิฉะนั้นได้ทั้งลงบัญชีไม่ได้และลงซ้ำ
> - **dashboard** → วันที่เพิ่ม widget การเงินที่อ่านจาก GL/งบกำไรขาดทุน (แทน aggregate `expenseRecord`) จะเห็นค่าว่างทันทีถ้า CR-2 ยังอยู่
> - **noti** → วันที่เพิ่ม rule แจ้งเตือน "ลงบัญชีไม่สำเร็จ" ระบบจะยิงแจ้งเตือนทุกใบทุกวัน ถ้า CR-2 ยังไม่แก้ ต้องแก้ CR-2 ก่อนเปิด rule นี้
> - **AI / LINE** → วันที่เปิด tool ฝั่งเขียน (สร้าง/ยืนยันค่าใช้จ่ายผ่านแชท) ปลายทางคือ `ExpenseRecord` เดียวกัน จะสืบทอดปัญหาข้อ 2 ทันที
> - **สิทธิ์** → เก็บ `ledger.posting-rule.manage` ไว้ได้ แต่ต้องไม่แจกใน role template ใดจนกว่าจะมี writer จริง ไม่งั้นเป็นสิทธิ์ลวง

##### สถานะการแก้ 2026-08-09

**ทำแล้ว: ซ่อนเฉพาะ UI ตรงตาม OWNER DECISION — ไม่แตะ entitlement จึงไม่ต้อง migration**

เคยลองทาง "ปิด `double_entry_ledger` ใน `DEFAULT_ENABLED_FEATURE_KEYS`" แล้ว **revert ทิ้ง** เพราะการปิด flag นี้
strip permission `journal.entry.*` ด้วย = หยุด backend posting ที่ owner ต้องการเก็บไว้ และยังแก้ได้เฉพาะบริษัทที่
onboard ใหม่ (บริษัทเดิมมี row `true` เขียนไว้ explicit ต้อง migration แยก) ทางที่ใช้จริงคือแยก presentation ออกจาก entitlement:

| สิ่งที่แก้ | ไฟล์ | ผล |
|---|---|---|
| เพิ่ม `ACCOUNTING_UI_HIDDEN` + `ACCOUNTING_UI_HIDDEN_MODULE_KEYS` = `{journal, closing}` | `web-core-workspace.constants.ts` | สวิตช์เดียวคุมทั้งหมด ปิดกลับด้วยการตั้งเป็น `false` |
| `filterModulesByPermissions` ตัด module ที่ซ่อน | `web-core-workspace.logic.ts` | เมนู "สมุดรายวัน" + "รอบบัญชี" หายจาก sidebar |
| `canAccessWorkspacePath` เช็ค hidden **ก่อน** route rule | `web-core-workspace.logic.ts` | พิมพ์ URL `/journal`, `/period-closing` ตรง ๆ ก็ไม่เข้า |
| `canReadLedger`/`canPostLedger` = false | `expenses.model.ts` | ปุ่ม "ลงบัญชี", ปุ่ม backfill, ลิงก์ "ดู JV" ในหน้ารายจ่ายหายหมด |

- **ไม่แตะ** entitlement, permission, route, controller, API → posting ฝั่ง server ทำงานได้เหมือนเดิมทุกประการ
  และ**ไม่ต้องมี migration** สำหรับบริษัทที่ onboard ไปแล้ว
- จุดที่ต้องระวังและทดสอบไว้แล้ว: `/journal` มี entry ใน `ROUTE_PERMISSION_RULES` ด้วย ถ้าเช็ค hidden หลัง route rule
  หน้าจะยังเปิดได้จาก URL; ส่วน `/period-closing` ไม่มี rule เลยจะตกไปที่ default "ไม่ match = อนุญาต" — ทั้งคู่ปิดแล้ว
- verify: web-core-workspace + expenses spec ผ่านทั้งหมด (เพิ่มเทสใหม่ 3 ตัว: ซ่อนแม้มี permission ครบ, บล็อก URL,
  ปุ่มในหน้ารายจ่ายหาย); `src/features/**` fail 10 เท่าเดิมก่อนแก้ (pre-existing ทั้งหมดใน system-data-rights/legal
  จาก commit compliance); `tsc --noEmit` 78 error เท่าเดิมก่อนแก้ ไม่มีในไฟล์ที่แตะ

> **REMARK (สำคัญ — ซ่อนแล้วแต่ยัง "ยังไม่ลงบัญชี" อยู่ดี):** เป้าหมายที่ระบุคือ *"ยังลงบัญชีแยกหมวดหมู่ รหัสบัญชี ภาษีได้
> แต่ user ไม่เห็น"* — **ตอนนี้ยังไม่เป็นแบบนั้น** และการซ่อน UI ทำให้อาการมองไม่เห็นด้วย เหลืออีก 2 ด่าน:
> 1. **ไม่มีใครสั่ง post** — ปุ่มแมนวลเพิ่งถูกซ่อน และ `expense_auto_post` default OFF → drain worker ข้ามทุกบริษัท
>    (`expense-auto-post.use-case.ts:126-128`) ต้องเปิด default นี้หรือทำ guaranteed background path
> 2. **ต่อให้สั่ง post ก็ล้มทุกใบ** — CR-2 ยังอยู่ ทุก `generate` โยน `posting_rule_missing` และเอกสารกลายเป็น
>    `posting_error` ที่ตอนนี้**ไม่มีใครเห็นแล้ว** เพราะ badge อยู่ในหน้าที่ยังเห็นได้ แต่ปุ่ม "ลองอีกครั้ง" ถูกซ่อน
>
> ลำดับที่ถูกคือ **แก้ CR-2 ก่อน แล้วค่อยเปิด background posting** ถ้าเปิด auto-post ก่อนแก้ CR-2 จะได้ `posting_error`
> ทุกใบแบบเงียบ ๆ ซึ่งแย่กว่าสถานะเดิมที่ผู้ใช้อย่างน้อยยังเห็น error

### 🟡 CR-3 [SCOPE CLARIFIED 2026-08-09] ไม่เปิด UI บัญชี แต่ต้องเก็บ hidden ledger

- **Owner decision:** ฟีเจอร์บัญชี, หน้าสมุดรายวัน, การปรับปรุงบัญชี, รายงานบัญชี และการปิดงวด **ยังไม่เปิดให้ผู้ใช้ในรอบนี้**.
  ดังนั้นการไม่มี web UI `createJournal`/`postJournal`/`reverseJournal` ไม่ใช่ launch defect และ deadlock ของหน้า period-close
  อยู่นอก current user journey.
- **สิ่งที่ยังเป็น launch requirement:** เมื่อรายการจากใบเสร็จ/รายจ่ายหรือใบเบิกผ่าน state ที่กำหนด ระบบต้องสร้างและเก็บ
  journal/ledger ภายในให้สำเร็จโดยอัตโนมัติ แม้ผู้ใช้ยังไม่เห็นเมนูหรือรายงานบัญชี.

| Source ที่เปิดใช้ | พฤติกรรม hidden ledger ที่ต้องได้ | ห้ามเกิด |
|---|---|---|
| ใบเสร็จ/รายจ่าย (`ExpenseRecord`) | เมื่อ confirm และผ่าน evidence gate ให้สร้าง accrual journal `expense.record` หนึ่งครั้ง พร้อม source reference และ posting status ที่ตรงจริง | ค้าง `pending` เพราะไม่มี UI ให้กด post, หรือ retry แล้ว journal ซ้ำ |
| ใบเบิก (`ReimbursementRequest`) | expense projection ต้องเข้า accrual ของรายจ่าย; เมื่อบันทึกจ่ายให้สร้าง settlement `reimbursement.payment` เพื่อล้างเจ้าหนี้พนักงาน | สร้าง expense ซ้ำจาก line ที่มี `linkedExpenseId`, จ่ายแล้วไม่มี settlement หรือยอดถูกนับสองรอบ |
| ใบทดแทนใบเสร็จ | เก็บเป็น versioned evidence/approval ของ `ExpenseRecord` เดิม และใช้ปลด evidence gate ก่อน post | สร้าง monetary journal แยกอีกใบจากรายจ่ายเดิม เพราะจะ double count |

**ผลต่อ architecture/feature toggle:** ห้ามแก้ด้วยการปิด `double_entry_ledger` ทั้งก้อนตามข้อเสนอเดิม เพราะจะหยุด backend
ledger ด้วย. ต้องแยก “ledger core/posting เปิด” ออกจาก “accounting UI visibility ปิด”; และเพราะไม่มีผู้ใช้มากด manual post,
ต้องเปิด `expense_auto_post` หรือมี guaranteed background posting path ที่ให้ผลเทียบเท่า. ค่า onboarding ปัจจุบัน
`double_entry_ledger=ON` แต่ `expense_auto_post=OFF` จึง **ยังไม่ตรง owner decision นี้**.

**Disposition:** ส่วน “ไม่มี UI” = `ACCEPTED_SCOPE`; ส่วน hidden posting = `OPEN / P0 FOR CURRENT LAUNCH` และเชื่อมกับ:

- CR-2 — PostingRule/fallback ต้องทำให้ source ที่เปิดใช้ post ได้จริง;
- CR-6 — ต้องต่อ reimbursement expense/payment posting แบบ background;
- H-7 — create→post→commit→markSource ต้อง atomic/recoverable ห้าม DRAFT ถูกนับว่า posted;
- H-28 — ต้อง reuse `linkedExpenseId` และกัน duplicate ก่อนเปิดท่อ reimbursement posting.

**Acceptance ก่อนปิด CR-3:** ซ่อนเมนู/route/action บัญชีจาก launch roles แล้วรัน journey จริงอย่างน้อย
`receipt→confirm→expense.record POSTED`, `claim→expense accrual→payment settlement`, และ
`substitute receipt→same expense journal only`; retry/crash ต้องไม่เพิ่ม journal ซ้ำ และ posting failure ต้องมี operational alert/audit
ที่ทีมแก้ได้แม้ไม่มี accounting UI.

### CR-4 ✓ [R2] งบดุลไม่มีวันบาลานซ์
- `report.use-case.ts:149` ส่ง `[period.id]` เดียวเข้า `getAccountBalances` (filter `periodId: { in }`,
  `prisma-ledger.repository.ts:291`); `:158` ทิ้ง REVENUE/COST/EXPENSE ไม่โอนกำไรเข้าทุน; GL hardcode
  `openingBalance: '0.0000'` (`:45`)
- Impact: งบดุลแสดงเฉพาะความเคลื่อนไหวเดือนนั้น ไม่มียอดยกมา → สินทรัพย์ ≠ หนี้สิน+ทุน เท่ากับกำไรของเดือน ทุกเดือน ตลอดไป

### CR-5 ✓ [R2] ไม่มีปีบัญชี ไม่มีปิดปี ไม่มีกำไรสะสม
- grep `fiscalYear|retainedEarnings|กำไรสะสม` ทั้ง schema + web = ศูนย์; ผังบัญชีมี `3200-00 กำไรสะสม`
  (`th-sme-chart-of-accounts-v1.ts:105`) แต่ไม่มีโค้ดเขียนลงไป; period key เป็น `YYYY-MM` เท่านั้น
- Impact: วันที่ 1 ม.ค. ไม่มีอะไรเกิดขึ้น บัญชีรายได้/ค่าใช้จ่ายไม่ถูกปิด ส่วนของเจ้าของไม่ถูกแสดง

### CR-6 [R2] รายรับ + การเบิกจ่าย ไม่เคยเข้าบัญชีแยกประเภท (ไม่มี worker / ไม่มีปุ่ม)
- **รายรับ:** ไม่มี worker สำหรับ accounting document, ไม่มี web caller ส่ง `sourceType:'accounting.document'`;
  เอกสารที่ออกแล้วตราเป็น `postingStatus:'pending'` (`accounting-status.logic.ts:196`) ค้างตลอด
- **การเบิกจ่าย:** ✓ grep `reimbursement` ใน `apps/workers/src` = ว่างเปล่า; auto-post drain filter
  `'expense.record'` เท่านั้น (`expense-auto-post.use-case.ts:76,145`); settlement บังคับ accrual ก่อน (`repo:1752`)
- **รายจ่ายจากใบเบิก:** `prepareClaimProjections` ไม่เคยตั้ง `taxEvidenceStatus` → default `NEEDS_REVIEW`
  (`schema.prisma:1910`) → auto-post query ตัดออก (`expense-auto-post.use-case.ts:60`)
- Impact: close check `reimbursement_postings_complete` (`period.use-case.ts:311`) ทำให้การเบิกจ่ายครั้งแรกของบริษัททำให้ปิดงวดไม่ได้ตลอดไป

### CR-7 ✅ RESOLVED 2026-08-10 — สาขาที่สองออกเอกสารไม่ได้เลยตลอดกาล เลขที่ชนกันทั้งบริษัท
- ~~`branchScopeKey = input.branchId ?? 'GLOBAL'` → counter แยกต่อสาขา แต่ template ทั้ง 22 ตัวไม่มี
  `{BRANCH}` ขณะที่บังคับ `@@unique([companyId, documentType, documentNumber])` ทั้งบริษัท~~
- สาขา A ออก `TAX-202608-00001`; สาขา B เริ่มที่ 1 เหมือนกัน → P2002 → **rollback พา `nextNumber`
  ที่เพิ่งบวกไปด้วย** → ลองใหม่ได้เลขเดิม ชนเหมือนเดิม ทุกครั้ง ตลอดไป แก้ได้ทางเดียวคือแตะ DB

**ไม่ต้องมีสองสาขาก็เจอ** — มี caller เดียวที่ส่ง `branchId` เข้า `reserveNumber` คือทางออกเอกสารบัญชี
(`document.use-case.ts:349`) และ web ส่ง `branchId: branch?.branchId || undefined`
(`AccountingPages.tsx:299`) แค่เลือกสาขาใน picker บริษัทก็ย้ายออกจาก counter `GLOBAL` ที่ใช้อยู่เดิม

**กฎที่ใช้แก้** — counter จะแยกต่อสาขาได้ก็ต่อเมื่อ**ตัวเลขบอกได้ว่ามาจากสาขาไหน**
`templateNumbersAreBranchDistinct()` ตัดสินจาก `{BRANCH}` ใน template · default ไม่มีสักตัว →
ซีรีส์เดียวทั้งบริษัท ชนไม่ได้ · บริษัทที่ใส่ `{BRANCH}` เองยังได้ซีรีส์แยกต่อสาขาจริง ๆ และตอนนี้ใช้ได้จริง
เพิ่ม guard ฝั่ง config ด้วย: `UpsertDocumentSequenceUseCase` ปฏิเสธ sequence ที่ผูกสาขาแต่ template
ไม่มี `{BRANCH}` — ไม่ปล่อยให้ตั้งค่าที่กลายเป็น company-wide เงียบ ๆ ตอน reserve

**ความปลอดภัยกับข้อมูลจริง** — บริษัทที่เอกสารใบแรกออกตอนเลือกสาขาไว้ ตอนนี้เดินเลขอยู่ใต้
counter ของสาขานั้น ถ้าย้ายมา company-wide แล้วเริ่มที่ 1 จะออกเลขซ้ำของตัวเอง = wedge แบบเดียวกับ
บั๊กเดิม จึงให้ counter ใหม่สืบค่าจาก scope เดิมใน period เดียวกัน — ปลอดภัยเพราะ**ใน period หนึ่งมีได้
scope เดียวที่เคยออกเลขสำเร็จ** (ของ scope ที่สอง insert แรกล้มและ rollback ไปแล้ว) ค่าสูงสุดจึงไม่กำกวม
และ template ที่ลูกค้าแก้เองก็ถูกสืบมาด้วย ไม่ย้อนกลับเป็น default เงียบ ๆ

Verify: `document-sequence-branch-collision.spec.ts` 6 tests · data-model-core sequence specs 26 ผ่าน
0 fail · api ทั้งชุด 4647 tests fail 3 ในโมดูลที่ไม่ได้แตะ (XLSX export, worker token, migration ที่ต้องมี
PostgreSQL จริง) · `tsc` 14 error เท่าเดิม

mutation: คืน scope key เดิม → **fail 4** · ปิด opt-in `{BRANCH}` → fail 2

> **บันทึกไว้:** เทสจับบั๊กใน fix ของตัวเอง — ตอนแรกสืบ counter ข้าม scope ทุกกรณี ทำให้สาขาที่มีซีรีส์
> ของตัวเองโดยชอบ (template มี `{BRANCH}`) เริ่มที่เลขของอีกสาขาแทนที่จะเริ่ม 1 · และเทสข้อแรกเวอร์ชัน
> แรกอ่อนเกินไป: เรียกแค่ 2 ครั้ง counter ที่สองที่สืบค่ามายังให้เลขไม่ซ้ำในครั้งแรก ต้อง interleave
> 3 ครั้งขึ้นไปการชนถึงโผล่

### CR-8 ✓ [R2] ใบกำกับภาษีที่ออกจากระบบไม่มีผู้ซื้อ (ไม่ถูกต้องตาม ม.86/4)
- หน้าจอสร้างเอกสารเดียวที่มี (`AccountingPages.tsx:263-270`) ส่ง 6 ฟิลด์ **ไม่มี `counterpartyId`** และไม่มีช่องเลือกลูกค้า;
  ตอน issue snapshot เฉพาะเมื่อมี counterparty และเก็บแค่ `{id,displayName,taxId,legalName}` — ไม่มีที่อยู่/รหัสสาขาผู้ซื้อ
- Impact: ใบกำกับภาษีทุกใบไม่มีผู้ซื้อ → `MISSING_TAX_ID` review issue ทุกใบ (`sync-tax-events.use-case.ts:192`); ไม่เป็นใบกำกับภาษีที่ถูกต้อง

### CR-9 [R2] ไม่มี PDF/พิมพ์ สำหรับเอกสารบัญชีเลยสักประเภท
- มี PDF renderer สำหรับใบทดแทนใบเสร็จ/50 ทวิ/ใบเบิกเงิน แต่ **ไม่มีใน `modules/accounting-documents`**; ไม่มีปุ่มพิมพ์/ดาวน์โหลด
- Impact: สิ่งที่ลูกค้าต้องได้รับ (ใบกำกับภาษี ต้นฉบับ/สำเนา) ผลิตไม่ได้ และเพราะ CR-8 ข้อมูลบังคับไม่ถูกเก็บด้วยซ้ำ → เพิ่ม PDF ต้องแก้ data model ก่อน

### CR-10 ✅ RESOLVED 2026-08-10 — ตัวสแกน PDF กักใบเสร็จจริงเป็นส่วนใหญ่ — ถาวรและเงียบ
- ~~`attachment.logic.ts:83` รัน regex `/\/(javascript|js|openaction|launch|richmedia|embeddedfile|xfa)\b/i`
  บน **byte stream ทั้งก้อน** รวมข้อมูลภาพบีบอัด (entropy สูง) + `.toLowerCase()` เพิ่มโอกาสชน~~
- ล้มเหลวถาวร: `rejectUpload` → `markQuarantined` + audit HIGH + security event HIGH, ไม่มี reaper, ยังนับกิน quota
- Impact เดิม: SME สแกนใบแจ้งหนี้หลายหน้า ได้ *"ระบบขัดข้อง..."* ลองใหม่ = ไบต์เดิม = ล้มเหมือนเดิมทุกครั้ง; alert HIGH จากใบเสร็จลูกค้ากลบ detection จริง

**หลักฐานที่ reviewer ขอ — มีแล้ว.** สร้าง corpus ด้วย `pdf-lib` (dependency เดิมของ repo) เป็น PDF
ที่ well-formed จริง หน้าละ 1 image XObject `/FlateDecode` — คือรูปร่างเดียวกับใบเสร็จที่สแกนมา
(ผลบีบอัดของภาพถ่ายบีบต่อแทบไม่ได้ สถิติจึงแยกจาก random ไม่ออก ซึ่งเป็นคุณสมบัติที่มีผลตรงนี้):

| ขนาด | ถูกกักผิด (ก่อนแก้) | หลังแก้ |
| --- | --- | --- |
| 1 หน้า ~0.5 MB | 13% | **0%** |
| 2 หน้า ~2 MB | 25% | **0%** |
| 4 หน้า ~4 MB | 53% | **0%** |
| 6 หน้า ~6 MB | 55% | **0%** |
| 10 หน้า ~10 MB | **78%** | **0%** |

(ก่อนแก้ 40 trial/ขนาด, หลังแก้ 80 trial/ขนาด → 0/400) ยืนยันคำว่า “ใบเสร็จจริงเป็นส่วนใหญ่” ที่ระดับ
multi-page scan และ **ลบ REVIEWER OVERRIDE `EVIDENCE_NEEDED` ได้แล้ว** — R2 ประเมินถูก, ตัวเลข
random-byte เดิมสูงไปเล็กน้อยเพราะไม่มีโครงสร้าง PDF จริงเจือ แต่อันดับความรุนแรงตรงกัน

**แก้แล้ว** — ตัด payload ระหว่าง `stream`…`endstream` ออกก่อน แล้วค่อย match เฉพาะโครงสร้าง object
ที่ reader อ่านเพื่อตัดสิน *พฤติกรรม*; ข้างใน stream เป็น *ข้อมูล* ไม่ใช่พฤติกรรม. detection ไม่ลดลงจริง:
active content ทำงานได้จาก dictionary เท่านั้น และของที่ซ่อนใน stream ที่บีบอัดแล้ว regex เดิมก็อ่านไม่ออกอยู่ดี.
anchor ด้วย `>>` เพื่อไม่ให้คำว่า `stream` ลอย ๆ ใช้บังการสแกนได้

Verification: `attachment.logic.spec.ts` 20 tests (ใหม่ 3) — **พิสูจน์ด้วย mutation 2 รอบ**: ปิดการตัด stream
→ fail 1, ถอด `>>` anchor → fail 1. detection ยังจับครบบน PDF จริงขนาด 4 MB: `/JavaScript` `/JS`
`/OpenAction` `/Launch` `/RichMedia` `/EmbeddedFile` `/XFA` + EICAR + blinding attempt.
Caller ทั้งหมด (banking statement-import, LINE webhook, CRM inbound/retry) 216/216 pass.
สแกน 25 MB ใช้ 15 ms. Typecheck ไม่มี error ใน `data-model-core`

> **ยังไม่ได้แก้ (คนละ root cause):** quarantine ยัง**ถาวร** — ไม่มี reaper, ยังกิน quota และ FP ใด ๆ
> ที่เหลือยังยิง audit/security event `HIGH`. ตอนนี้ FP เหลือ ~0 ความเร่งด่วนจึงลดลงมาก แต่ยังควรมี
> เส้นทางกู้คืน attachment ที่ถูกกักผิด

### CR-11 ✓ [R2] ไม่มีขอบเขตปีที่ไหนเลย — ปี พ.ศ. ถูกเก็บเป็น ค.ศ.
- `CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/` (`civil-date.ts:21`), `isCivilDate` ตรวจแค่ parse ได้; ผมรันพิสูจน์
  `2569-03-15 → true`, `9999-12-31 → true`; grep ขอบเขตปีทั้ง repo = ศูนย์
- Impact: รายจ่ายปี 2569 ลอยบนสุดของทุกรายการที่เรียงวันที่ ไม่อยู่ในงวดบัญชีใด ไม่โผล่ใน filter เดือนปกติ; เรียกได้ด้วย HTTP call เดียว
- แก้: ใส่ขอบเขตปีใน `isCivilDate` — บรรทัดเดียวปิดตระกูล พ.ศ. ได้เกือบหมด

### CR-12 [R2] แก้ข้อมูลหลังยื่นภาษีถูกทิ้งเงียบใน 4 จาก 6 เส้นทาง sync
- เส้น component บันทึก issue `SOURCE_CHANGED_AFTER_TAX_PERIOD_LOCK` (`sync-tax-events.use-case.ts:112`) แต่อีก
  4 เส้น (`:170,212,264,320`) แค่ `skippedLocked++; continue;` → จบที่ log บรรทัดเดียว
- Impact: หลังยื่น ภ.พ.30 มิ.ย. แล้วแก้เอกสารเดือน มิ.ย. บัญชีเปลี่ยนแต่แบบที่ยื่นไม่เปลี่ยน และไม่มีบันทึกว่าต่างกัน (GL≠RD เงียบถาวร)

### CR-13 [R2] `AMENDED` ไม่มีใครเขียน — งวดที่ยื่นแล้วแช่แข็งถาวร
- เขียน `TaxPeriod.status` มีแค่ `EXPORTED`/`FILED`/`PAID` — ไม่มี `AMENDED`/`CLOSED` แต่ guard อ่าน `['FILED','PAID','CLOSED']`
  แล้วบอกให้ *"use an amendment workflow"* ที่ไม่เคยถูกสร้าง
- Impact: ยื่น ภ.พ.30 แล้วเจอรายจ่ายซ้ำ → void ไม่ได้, เปิดงวดใหม่ไม่ได้, ไม่มีเส้นทางแก้ในผลิตภัณฑ์

---

## 2. HIGH — ความปลอดภัย

### H-1 ✓ [R1] รหัสผ่านเริ่มต้นพนักงานใหม่ = วันเกิด (DDMMYYYY) และไม่มีวันหมดอายุ
- `employee-access.logic.ts:84` คืน `DDMMYYYY`; `create-employee.use-case.ts:119,147-148,279-280` เขียน credential
  `mustChangePassword:true` แต่ `expiresAt:null`; `password-login.use-case.ts:43` ปฏิเสธเฉพาะเมื่อ `expiresAt && <=now`;
  `auth.guard.ts:19,107` ยกเว้น `/v1/auth/` จากบล็อก must-change-password
- Impact: ใครรู้/เดาวันเกิด ล็อกอินได้ แล้วเรียก `POST /auth/password/change` ยึดบัญชี; ต่างจาก admin-reset (สุ่ม 9 ไบต์ + 72 ชม.)
- แก้: initial credential ให้หมดอายุ + เลิกใช้วันเกิด

> **REMARK (REVIEWER OVERRIDE):** implementation นี้ตรง owner decision ที่ปิดแล้วเมื่อ 2026-07-25
> (`docs/agent-memory/password-reset-line-flow.md:26`). จัดเป็น `ACCEPTED_RISK` ที่ควรให้ owner re-accept ก่อน prod;
> remediation “เลิกใช้วันเกิด/เพิ่ม expiry” ต้องเปิด product decision ใหม่ ไม่ใช่แก้เป็น bug โดยตรง.

### H-2 ✅ RESOLVED 2026-08-10 — Reimbursement branch scope (ABAC) ไม่ถูก enforce
- ~~`RecordReimbursementPayment` + `VoidReimbursementPayment` ไม่มี `isBranchInScope`;
  `ListFinanceQueue` คืนทุกสาขา; `POST /reimbursements` รับ `branchId` ใด ๆ ไม่ assert scope~~
- Impact เดิม: ผู้ใช้ที่จำกัดสาขาจ่าย/กลับรายการ/ปลูก claim ข้ามสาขาได้

**ทำไมถึงมองไม่เห็น** — คิว (`listRequests`) กรองด้วย `branchScopeWhere` ที่ repository ผู้ใช้ที่จำกัดสาขา
จึงไม่เคยเห็น claim สาขาอื่นในลิสต์ และโมดูลดู "enforce แล้ว" จากภายนอก แต่ทุก write รับ id
และ id ไม่ต้องใช้ลิสต์ในการเดา

**ตรวจทั้งโมดูล พบ 7 จุด (audit ระบุไว้ 3)** — เพิ่ม `assertReimbursementBranchInScope`:

| use case | ทำอะไรได้ข้ามสาขา |
|---|---|
| `RecordReimbursementPayment` | จ่ายเงิน (วางไว้ก่อน idempotent-replay ไม่ให้ probe ว่ามี payment) |
| `VoidReimbursementPayment` | กลับรายการ + reverse journal ที่ post แล้ว (audit CRITICAL) |
| `ExportReimbursementEvidence` | export claim ทั้งใบ |
| `ListUnpostedReimbursementPayments` | เห็น payment id ทุกสาขาไว้ post |
| `UpdateReimbursementDraft` | แก้ยอดใน draft (ผ่าน `finance_review`) |
| `SubmitReimbursement` | ยัด claim เข้าสาย approval สาขาอื่น |
| `CreateReimbursementDraft` | ปลูก claim ในสาขาที่ตัวเองมองไม่เห็น |

`ListFinanceQueue` แก้โดยอีก session (เพิ่ม `scopes` ให้ `listRequests`) — ข้อกล่าวหาใน audit ถูกต้อง

**ครึ่งที่เงียบกว่าของ create** — ไม่มี caller ไหนส่ง `branchId` เลย (web/LINE/AI) claim ทุกใบที่มีอยู่
ตอนนี้จึงเป็น company-central (`branchId = null`) ซึ่ง `branchScopeWhere` โชว์ให้ทุกสาขา
เพิ่ม `resolveCreateBranchId` ตามแบบ `CreateExpenseDraftUseCase` — claim ใหม่ของคนที่จำกัดสาขาถูก tag
สาขาตัวเอง คนที่ไม่จำกัดยังได้ company-central เหมือนเดิม **ข้อมูลเก่ายังเป็น null ทั้งหมด**

**ยกเว้นโดยตั้งใจ (บันทึกไว้ใน spec)** — policy อ่าน/เขียนเป็นระดับบริษัท (`findPolicy(companyId, null)`)
ไม่มีสาขา · 3 ขั้นลงลายมือชื่อ gate ด้วยการเป็น requester/approver ของ claim ใบนั้นจริง ๆ ซึ่งแคบกว่า
branch อยู่แล้ว และการเพิ่ม branch เข้าไปอาจบล็อก approver ที่ policy มอบหมายมาข้ามสาขาโดยชอบ

Verify: `reimbursement-branch-scope.use-case.spec.ts` 19 tests (7 write × refuse/control + create 3 +
worklist + coverage guard) · reimbursements ทั้งโมดูล 252 ผ่าน 0 fail · `tsc` 14 error เท่าเดิม
mutation: ถอด assert ของ payment → fail 2 (เทสตรง + coverage guard), ถอด `resolveCreateBranchId` → fail 1

**ยังไม่ commit** — อีก session กำลังแก้โมดูลเดียวกัน (related-access) ไฟล์ปนกัน 8 ไฟล์

### H-3 ✅ RESOLVED 2026-08-10 — Cloudflare ทำให้ per-IP rate limit / login throttle ยุบเป็นไม่กี่ key
- ~~`trusted-client-ip.ts:28-30` ใช้ XFF hop สุดท้าย; prod path = browser→CF Worker→ALB→proxy → hop สุดท้าย = IP ของ CF
  ไม่ใช่ผู้ใช้~~; `api-ip` 120/60s + `PASSWORD_LOGIN_MAX_PER_IP` 20/15min
- Impact เดิม: ทราฟฟิกไทยจาก CF colo เดียวกันแชร์ bucket → lockout ทั้งฐาน; ผู้โจมตีหมุน colo เจือจาง throttle

**แก้แล้ว** — `trustedClientIp` เดิน XFF จากขวาไปซ้าย ข้าม hop ที่เป็น private tier ของเราเองหรือเป็น
Cloudflare (inline CF ranges) แล้วหยุดที่ hop แรกที่ไม่ใช่ทั้งสองอย่าง = ที่อยู่สุดท้ายที่ proxy *สังเกตเห็น*
ไม่ใช่ที่ client *อ้าง*. เลือกทางนี้แทน `CF-Connecting-IP` เพราะ ECS Express origin
(`wa-...ecs.ap-southeast-1.on.aws`) เปิดสาธารณะ — ยิงตรงข้าม CF ได้ แล้วปลอม `CF-Connecting-IP` เพื่อ
เลือก rate-limit key เองได้ทุก request ซึ่งแย่กว่าบั๊กเดิม. การเดิน hop ปลอดภัยทั้งสองเส้นทาง:
เส้น CF หยุดที่ IP ที่ CF แทรกเอง, เส้นตรงหยุดที่ IP ที่ ECS gateway แทรกเอง

การแก้ที่ `trusted-client-ip.ts` ครอบทุก caller ในครั้งเดียว: `api-rate-limit.guard.ts`,
login/password-reset/email-verify throttle (`auth.controller.ts`), PDPA audit IP
(`crm-customer-pdpa.controller.ts`), LINE register (`customer-line-register.controller.ts`)

Verification: `apps/api/src/common/security/trusted-client-ip.spec.ts` 8 tests (เดิม 4 + ใหม่ 4) —
พิสูจน์ด้วย mutation แล้ว คืน logic เป็น last-hop → fail 3 ข้อ. `npx tsx --test src/common/security/*.spec.ts
src/common/logger/security-event-emitters.spec.ts` → 56/56 pass. Typecheck ไม่มี error ใน `common/security`
(14 error ที่เหลือเป็นของงานอื่นที่ค้างใน working tree)

> **หมายเหตุ `TRUST_PROXY`:** ไม่ได้ wire — `docs/specs/platform-environment-config-spec.md` แก้ให้ตรง
> ความจริงแทน. การตัดสินใจว่าเชื่อ XFF ไหมมาจาก TCP peer เป็น private tier อยู่แล้ว
> การเพิ่ม env switch มีแต่จะสร้างทางตั้งค่าผิด

### H-4 ✅ RESOLVED 2026-08-10 — ใบทดแทนใบเสร็จ: payer ที่ไม่มี `expense.review` เปิดหน้าเซ็นไม่ได้
- ~~wizard โหลดด้วย `Promise.all([getExpense, listSubstituteReceiptHistory])` (`SubstituteReceiptWizardPage.tsx:663-666`),
  `catch` เดียวทำทั้งหน้าพัง; history endpoint บังคับ `expense.review`;
  payer เป็นสมาชิกคนใดก็ได้ แต่ SALES/STAFF/INVENTORY ไม่มี `expense.review`~~
- Impact เดิม: คนที่จ่ายเงินจริงได้หน้า 403 แทนขั้นรับรอง; flow ใช้ได้เฉพาะเมื่อ payer บังเอิญมี `expense.review`
  — ซึ่งเป็นกรณีเดียวที่ two-person rule ไม่ได้มีไว้ใช้

**สถานะ 2026-08-10** — ต้นเหตุถูกปิดโดย related-view ABAC และ follow-up ที่ทำความหมาย
`expense.read_own` ให้ตรงกันทั้ง detail, hub และ history: payer ของ evidence version ปัจจุบันหรือที่ถูก
supersede เปิดเส้นทางเอกสารของตนได้ โดยไม่ให้สมาชิกที่ไม่เกี่ยวข้องเห็นข้อมูล.

คุณสมบัติที่ทำให้ payer เข้าหน้าเซ็นได้ ตอนนี้พิงข้อเท็จจริง 3 อย่างใน 3 ไฟล์ที่ไม่มีใครพูดออกมา:
1. endpoint รับ `expense.read_related` (`expense.controller.ts` history/certify/preview/signature)
2. ทุก company role ได้ `expense.read_related` (`permission-registry.ts` + core pack + universal backfill)
3. repository predicate นับ payer เป็น related (`expenseRelatedToUserWhere` → `substituteReceiptEvidences.payerUserId`)

**ปิด gap ที่เหลือ 2026-08-10** — `ListSubstituteReceiptHistoryUseCase` อ่าน `read_own` ว่า "เป็นคนสร้าง"
ขณะที่ `GetExpenseUseCase` และ hub list อ่านว่า "สร้างหรือจ่าย" — permission เดียว 3 พี่น้อง ตรงกัน 2
ผลคือ hub แสดงรายการให้ payer ที่มีแต่ `read_own` แล้วกดเข้าไปเจอ 403 (รูปแบบเดียวกับ H-18)
ไม่กระทบตราบใดที่ `read_related` เป็น universal แต่พังทันทีที่ entitlement `expenses` ถูกปิดหรือ role ใด
พลาด backfill แก้ให้อ่านตรงกันทั้งสามแล้ว และนับ payer ของ version ที่ถูก supersede ด้วย
ให้ตรงกับ `expenseRelatedToUserWhere`

เพิ่ม regression spec ที่พูดคุณสมบัตินี้ออกมาตรง ๆ:
`apps/api/src/modules/expenses/application/use-cases/substitute-receipt-payer-access.use-case.spec.ts` (7 tests)
พิสูจน์ด้วย mutation ทั้ง 3 จุด — คืน decorator เป็น review-only → fail 2, ถอด `expense.read_related`
ออกจาก STAFF → fail 1, คืน `read_own` เป็นเฉพาะผู้สร้าง → fail 2

Verify: expenses + permission-registry 464 tests ผ่าน 0 fail · `tsc` 14 error เท่าเดิม (pre-existing ทั้งหมด)

Commit: `0e9421a fix(expenses): let the payer open the certificate they must sign`

### H-5 ✓ [R2] disable พนักงานลบประวัติ AI ทั้งหมดถาวร + push รหัสผ่านเข้า LINE คนที่ถูกปิดได้
- disable = `aiConversation.deleteMany` + cascade turns/tool invocations (`set-employee-status.use-case.ts:53-55`);
  audit เก็บแค่ count; ปุ่มเดียวไม่มี modal ยืนยัน, `reason` ไม่เคยถูกส่ง
- regenerate temp password ไม่มี status guard → push เข้า LINE ของพนักงานที่ถูก disable เป็น plaintext
  (`regenerate-employee-credential.use-case.ts:91-107`); `ExternalIdentity` ไม่เคยถูก unlink ตอน disable
- Impact: ทำลายหลักฐานตอนที่ต้องการที่สุด (เลิกจ้างมีข้อพิพาท); ex-employee ได้ credential จริงเข้าช่องทางที่บริษัทคุมไม่ได้

> **ข่าวดีที่ยืนยันชัด [R2]:** พนักงานที่ถูก disable **สั่งงานผ่าน LINE ไม่ได้** — ทั้ง text turn และ media upload
> gate ด้วย ACTIVE membership และ fail-closed สองชั้น (resolveCompanyForLineUser + resolveAccess).

---

## 3. HIGH — ความถูกต้องบัญชี

### H-6 ✓ [R1] VAT/ยอดฝั่ง "รายรับ" ใช้ float ปัดเศษผิดสตางค์ ไม่ตรง engine ฝั่งรายจ่าย
- `accounting-totals.logic.ts:35-46` — `parseFloat` + `Math.round(v*100)/100`; ทดสอบ 14.50@7% → float **1.01**
  แต่ Decimal ROUND_HALF_UP (`expense-totals.logic.ts:19`) → **1.02**; ทุกค่า x.xx5; `calculatePaymentStatus` เทียบ float ไม่มี epsilon
- Impact: VAT บนใบกำกับภาษีต่างจากค่าถูกต้อง 1 สตางค์ สอง engine ไม่มีวัน reconcile — compliance issue

### H-7 ✓ [R1] Journal generate ไม่มี transaction → crash กลางคันทิ้ง DRAFT ที่ถูกนับว่า "posted"
- `journal.use-case.ts:611-615` create-DRAFT→post→commit→markSource เป็น 4 await แยก; `findGeneratedJournal`
  filter `entryType:'GENERATED'` ไม่มี status filter (`prisma-ledger.repository.ts:208-211`); retry เห็น existing → mark posted → success
- Impact: journal ค้าง DRAFT, ยอดหายจาก TB/P&L เงียบ ๆ ขณะ UI บอก "ผ่านรายการแล้ว" (ดู REMARK ที่ CR-3 — เป็นเหตุของ deadlock ปิดงวด)
- แก้: ห่อใน `$transaction` เดียว หรือให้ `findGeneratedJournal` กรอง `status:'POSTED'`

### H-8 ✓ [R1] Payment allocation race + ไม่มี idempotency (ฝั่งรายรับ)
- `prisma-accounting.repository.ts:448-507` `createPayment` ใช้ `$transaction` ธรรมดา (READ COMMITTED; ต่างจาก
  `voidPaymentTrueReversal:660` Serializable), อ่าน document ไม่ล็อกแถว, `newPaid=parseFloat+toFixed`; ไม่มี idempotency key
- Impact: สองการรับชำระพร้อมกัน over-settle; กด submit ซ้ำ = 2 payment
- แก้: `SELECT…FOR UPDATE`/Serializable + idempotency fence

### H-9 [R2] ใบลดหนี้ลด VAT ผิดงวด และหายเงียบถ้างวดเดิมยื่นแล้ว
- component ใบลดหนี้ clone จากต้นฉบับไม่ re-resolve (`document.use-case.ts:586-591`); `recognitionDate` = วันที่ใบต้นฉบับ;
  sync ใช้ค่านั้นหางวด (`sync-tax-events.use-case.ts:96`); งวด FILED → บันทึก issue แล้ว `continue` (ทิ้ง)
- Impact: กฎหมายไทยให้ลด VAT ในเดือนที่ออก ที่นี่ย้อนเดือนเดิม และในกรณีปกติ (ออกหลังยื่นแล้ว) การลดหายไปจากทุกงวด → จ่ายภาษีขายเกิน

### H-10 [R2] ใบกำกับภาษีรับชำระเงินไม่ได้ + ใบลดหนี้ไม่ลดยอดลูกหนี้
- `accounting-money-validation.logic.ts:92` อนุญาตชำระเฉพาะ `INVOICE|BILLING_NOTE|DEBIT_NOTE` แต่ `createDocument`
  ตั้ง `outstandingAmount`+`UNPAID` ทุกประเภท → ใบกำกับภาษีค้าง UNPAID ตลอดไป; ต้นฉบับไม่ถูกแตะตอนออกใบลดหนี้
  (`prisma-accounting.repository.ts:391-398`) → AR สูงเกินจริง; `CREDITED`/`DEBITED` ไม่มีใครเขียน
- Impact: flow มาตรฐานไทย (ออกใบกำกับภาษี แล้วเก็บเงิน) ทำไม่ได้

### H-11 ✅ RESOLVED 2026-08-10 — รายจ่าย ฿0 ยืนยันและลงบัญชีได้
- ~~`expense-status.logic.ts` ปฏิเสธเฉพาะ `total < 0`; OCR cross-check บอดเมื่อ AI อ่านยอดไม่ออก;
  web เป็น warning เท่านั้น ไม่อยู่ใน gate~~

**บล็อกที่ server (ตัวชี้ขาด)** — `validateConfirm` ปฏิเสธ `total === 0` พร้อมข้อความบอกว่าต้องทำอะไร
ไม่ใช่แค่ว่าผิด

- เหตุผลที่ต้องบล็อกตรงนี้: ยอด 0 มาจากใบเสร็จที่ AI อ่านไม่ออก ยอดค้างที่ 0 แล้ว **OCR cross-check
  ไม่มีอะไรให้เทียบจึงเงียบ** และ `CONFIRMED` เดินต่อได้แค่ `VOIDED` เท่านั้น — ไม่มีจังหวะให้ใครสังเกตทีหลัง
- **ปิด gate ฝั่ง web ด้วย** — `isZeroAmount` เดิมมีอยู่แล้วแต่ใช้แค่โชว์ warning ไม่ได้อยู่ใน
  `canConfirmExpense` ปุ่มจึงกดได้อยู่ ตอนนี้ปุ่มปิดและ tooltip บอกเหตุผล ผู้ตรวจรู้ก่อนกดไม่ต้องรอ 400
- verify: เทสใหม่ 3 (0 ถูกบล็อกพร้อมข้อความ / `0`,`0.00`,`-0.0000` ก็ถูกบล็อก / **0.01 ยังยืนยันได้** —
  กฎคือ "ต้องไม่ใช่ศูนย์" ไม่ใช่ตั้งยอดขั้นต่ำ) expenses spec ทั้ง api และ web ผ่านครบ

---

## 4. HIGH — ฟีเจอร์ตายเงียบ / เข้าถึงไม่ได้

### H-12 ✓ [R1] บริษัทที่ onboard จริงไม่มี NotificationRule → alert สต็อกต่ำ + สรุปรายวันตายสนิท
- `PrismaNotificationRuleRepository` มีแค่ `list/findById/findByTriggerKey/update` ไม่มี `create`; `notificationRule.upsert`
  มีที่เดียวคือ `seed.ts:3093`; onboarding ไม่สร้าง; API เป็น GET/PUT; `StockLowScan` return early (`stock-low-scan.use-case.ts:23-25`)
- Impact: บริษัท production ทุกรายไม่มี rule → alert เรือธง 2 ตัวตายถาวร แก้เองไม่ได้

> **REMARK (CONSOLIDATION GAP):** ฉบับรวมตก finding อิสระจากรอบ 1: ต่อให้สร้าง/enable `daily_owner_summary`
> rule แล้ว worker context มีแค่ `dashboard.read`/`dashboard.snapshot.generate` แต่ `visibleWidgets` ต้องมี permission
> ของ provider (`expense.read`, `inventory.report.read`/`inventory.movement.read`) จึงได้ summary “0 วิดเจ็ต” เสมอ
> (`notification-sweeps.use-cases.ts:23-34`, `generate-snapshot.use-case.ts:94-98`, `notification.use-cases.ts:280`).
> การแก้ H-12 ด้วยการ seed rule อย่างเดียวจึงยังไม่ทำให้ daily summary ใช้งานได้.

### H-13 [R1] Stock-low alert ไม่เคย resolve/ส่งซ้ำ — push ครั้งเดียวต่อสินค้าตลอดกาล
- `shouldResolveAlert` (`notification.logic.ts:46`) dead code; re-trigger แค่อัปเดต `lastSeenAt` ไม่มี delivery ใหม่ (`notification.use-cases.ts:218-247`)

### H-14 🟡 CONTAINED 2026-08-10 — ซ่อนหน้าจอไว้ก่อน (owner decision) ไม่ใช่แก้ให้ใช้ได้
- `system-line.controller.ts` บังคับคีย์ที่ไม่มีใน registry → 403 ทุกคนแม้ SYSTEM_ADMIN
- `sync-permissions.ts:63` revoke grant ของ system role ที่ registry ไม่ประกาศ → แก้ด้วยมือไม่รอด deploy ถัดไป
- **ชั้นที่สาม ซึ่งสำคัญสุด:** webhook อ่าน secret จาก `config.lineMessagingChannelSecret` (AWS/env)
  **ไม่เคยอ่านแถวที่หน้าจอนี้เขียน** → ต่อให้เปิดสิทธิ์ได้ กดบันทึกสำเร็จ ก็ไม่มีอะไรเปลี่ยน

**owner decision 2026-08-10: ยังไม่พร้อมทำให้ใช้งานได้ ให้อ่าน secret จาก AWS/env ต่อไป และซ่อนหน้าจอไว้**

- ซ่อน 2 ทางเข้า: แท็บ `LINE` ใน `SystemHeader` และลิงก์ใน `PartnerDetailPage`
- **ไม่ลบ route/component/endpoint** — เก็บไว้ให้งานตอนกลับมาทำเป็น diff ไม่ใช่เขียนใหม่
- คอมเมนต์อธิบายครบทั้งสามชั้น + เงื่อนไขเปิดคืน วางไว้ทั้งฝั่ง web (`SharedLineSettingsPage`) และ
  ฝั่ง api (`system-line.controller.ts`) เพราะคนอ่านสองฝั่งคนละคนกัน
- **จงใจไม่เติม permission เข้า registry** — แก้ชั้นเดียวจะได้หน้าจอที่กดสำเร็จแล้วไม่หมุนอะไรเลย
  ซึ่งอันตรายกว่า 403 ที่บอกตรง ๆ ว่าเข้าไม่ได้

**เงื่อนไขเปิดคืน (ต้องทำคู่กัน):** ประกาศ+grant `system.shared_line_credential.manage` **และ**
ให้ webhook อ่าน credential จาก DB ก่อนแล้ว fallback AWS/env พร้อม invalidate cache ตอนเขียน

### H-15 ✅ RESOLVED 2026-08-10 — ปิดฟีเจอร์ `dashboard_notifications` = ทั้งบริษัทเป็นหน้าขาว
- ~~ปิด → permission `dashboard.*` ถูกถอด → redirect ไป dashboard ที่เข้าไม่ได้ → `return null`~~
- ~~Impact: คลิกเดียวจาก partner console ทำทุกหน้าในบริษัทเป็นหน้าขาว~~

**แก้ที่ layout ไม่ใช่ที่ feature key** — เพราะสาเหตุจริงคือ **redirect ไปยังปลายทางที่เดาไว้ตายตัว**
ไม่ใช่เฉพาะ dashboard: ปิดฟีเจอร์ชุดไหนก็ตามที่ทำให้ `/dashboard` เข้าไม่ได้ จะเจออาการเดียวกันหมด

- ปลายทางเปลี่ยนเป็น **module แรกที่ session นั้นเปิดได้จริง** คำนวณจาก `filteredModules` + `canAccessWorkspacePath`
  ตัวเดียวกับที่ guard ใช้ — จึงรองรับทุกชุดฟีเจอร์ที่ปิด ไม่ใช่แค่เคสนี้
- **ไม่มีวันคืนหน้าขาวถาวรอีก**: `return null` เหลือไว้เฉพาะช่วงที่ redirect กำลังทำงาน ถ้าไม่มีที่ไปเลย
  จะ render `BrandedState` บอกว่าไม่มีหน้าที่เปิดได้และให้ติดต่อผู้ดูแล — คนที่ล็อกอินอยู่แล้วเห็นหน้าว่าง
  แยกไม่ออกว่าสิทธิ์เปลี่ยนหรือระบบล่ม
- verify: เทสใหม่ 2 (ปิด dashboard แล้วยังมีปลายทางอื่นเหลือ **และยืนยันว่า `/dashboard` คือตัวที่เข้าไม่ได้จริง** /
  ไม่มี permission เลยแล้วไม่เหลือปลายทางจริง ๆ) web spec ผ่านครบ; `tsc` web 0

> **REMARK (ไม่ได้เพิ่มใน `PLATFORM_INVARIANT_FEATURE_KEYS`):** การห้ามปิด `dashboard_notifications`
> จะแก้อาการเฉพาะเคสนี้และตัดสินใจเรื่องการขายแทนเจ้าของ — ถ้าภายหลังตัดสินว่า dashboard ต้องมีเสมอ
> ค่อยเพิ่มได้ โดยไม่ต้องย้อนการแก้นี้

### H-16 ✅ RESOLVED 2026-08-10 — "ไปยังบริษัทที่ใช้งานได้" วนกลับบริษัทเดิม
- ~~`/login` เลือก membership เก่าสุด แล้ว `watchdog_home` พากลับที่เดิม → วนไม่จบ ออกได้ทางเดียวคือ sign out~~

**ต้นเหตุ:** ปุ่มลิงก์ไป `/login` เฉย ๆ → `resolveLoginLanding` เอา `watchdog_home` มาก่อนเสมอ
(`explicit ?? home ?? session.companyId`) และ cookie นั้นชี้กลับบริษัทที่เพิ่งเปิดไม่ได้ → redirect วน

**แก้:** ปุ่มลิงก์ `\/login?home=reset` และ login route **ข้าม** cookie เมื่อเห็น flag นี้ →
ตกไปใช้ `session.companyId` ซึ่งเซิร์ฟเวอร์เลือกจาก membership ที่ยังใช้ได้

- **ข้ามไม่ลบ** — cookie เป็น read-only ระหว่าง render ใน Next 15 และการ landing สำเร็จครั้งถัดไปเขียนทับเองอยู่แล้ว
  การพยายามลบจะต้องเพิ่ม route handler โดยไม่ได้อะไรเพิ่ม
- ถ้าปลายทางยังเป็นบริษัทเดิมจริง ๆ แปลว่าผู้ใช้เป็นสมาชิกแค่บริษัทนั้น — ปุ่ม "ออกจากระบบ" คือทางออกที่ตรงไปตรงมา
  ไม่ใช่การวนซ้ำ
- verify: เทสใหม่ 1 (ข้าม home แล้วตกไป session company / ไม่ข้ามยังใช้ home เหมือนเดิม) web spec ผ่านครบ; `tsc` web 0

---

## 5. HIGH — ลูกค้าตัวเล็กที่สุด (เจ้าของคนเดียว / 2 คน) ใช้ไม่ได้

### H-17 ✅ RESOLVED 2026-08-10 — self-approval สำหรับบริษัทเล็ก (owner decision)

**ตัดสิน 2026-08-10:** `OWNER`/`ADMIN`/`MANAGER` อนุมัติคำขอตัวเองได้เลย ไม่ต้องรอเปิด policy —
ชุด role เดียวกับที่ procurement ใช้อยู่แล้ว **แลกกับการต้องมีประวัติว่าใครกด**

- **import `SELF_APPROVAL_EXEMPT_ROLES` จาก procurement ไม่ได้เขียนรายการซ้ำ** — นโยบายเดียวกันสองสำเนา
  คือวิธีที่มันจะไม่ตรงกันในอนาคต
- `isSelfApproval` รับ `approverRoles` เพิ่ม default `[]` — caller ที่ยังไม่ opt-in คงพฤติกรรม maker-checker เดิม
- ปิดครบ 5 จุด: gate ของ approve/reject, ตัวกรองคิว, และ guard ชั้น repository อีก 2 จุด
- **ประวัติเขียนใน transaction เดียวกับการอนุมัติ** ผ่าน `audit.log(entry, tx)` ที่มีอยู่แล้ว →
  trail จะไม่มีโดยไม่มีการอนุมัติ และการอนุมัติจะไม่มีโดยไม่มี trail
  metadata `selfApproval: { approvedOwnRequest, via: 'company_policy' | 'role_exemption', actorRoles }`
  — `via` แยกว่า "บริษัทเปิด policy เอง" กับ "role ยกเว้นให้" ซึ่งเป็นคำถามที่ support ต้องตอบเวลาลูกค้าโต้แย้ง
  และ `actorRoles` เก็บเฉพาะ role ที่ให้สิทธิ์จริง ไม่ใช่ทุก role ที่คนนั้นถือ

> **REMARK (เทสเดิม 3 ตัวเปลี่ยนความหมาย):** `blocks self-approval`, `blocks self-rejection` และเทสคิวของ
> H-18 ใช้ role `MANAGER`/`OWNER` ซึ่ง**ตอนนี้ได้รับยกเว้น** จึงชี้ไปที่ role นอกข้อยกเว้นแทน — กฎ maker-checker
> สำหรับคนอื่นยังเหมือนเดิมทุกประการ และเพิ่มเทสว่าใบของ role ที่ได้รับยกเว้น**ยังอยู่ในคิว** เพราะกดได้จริง
> (คิวกับ gate ใช้ predicate เดียวกันจึงขยับพร้อมกัน)

- verify: เทสใหม่ 6 (owner/admin/manager อนุมัติของตัวเองได้ · role นอกข้อยกเว้นยังถูกปฏิเสธ ·
  audit บันทึกคนกด+`via`+role ที่ให้สิทธิ์ · อนุมัติใบคนอื่นไม่ติด selfApproval) reimbursement +
  procurement spec ผ่านครบ; `tsc` 14 pre-existing

### H-18 ✅ RESOLVED 2026-08-10 — ทั้งปุ่มและ noti ไม่ชวนให้กดสิ่งที่จะ 403 แล้ว
- ~~approval queue ไม่ filter self-approval → ปุ่มอนุมัติแสดงเสมอ~~
- template `reimbursement_pending_approval` push หา `['MANAGER','OWNER']` พร้อม deep link — **ยังเหมือนเดิม**

**แก้แล้ว: คิวไม่เสนอปุ่มที่จะถูกปฏิเสธ**

`ListApprovalQueueUseCase` กรอง `isSelfApproval(...)` ด้วย **predicate เดียวกันและ policy company-level
ตัวเดียวกัน**กับที่ approve gate ใช้ — สิ่งที่ถูกเสนอกับสิ่งที่ทำได้จึงเถียงกันไม่ได้ และเมื่อเปิด
`allowSelfApproval` ฟังก์ชันคืน false เอง คิวก็ไม่กรองอะไรเลย ไม่ต้องมีเงื่อนไขซ้อน

verify: เทสใหม่ 3 (ซ่อนใบของตัวเองเมื่อ policy บล็อก / ใบคนอื่นยังอยู่ / เปิด policy แล้วเห็นใบตัวเอง)

**ครึ่งที่สองแก้แล้ว 2026-08-10 — noti ไม่ส่งหาผู้ยื่นแล้ว** ครบทั้งสามข้อที่ค้างไว้:
1. payload ของ `reimbursement.request_submitted` เติม `requesterUserId` — แต่ใส่**เฉพาะตอน policy บล็อก
   self-approval** บริษัทที่เปิด toggle จึงยังแจ้งผู้ยื่นตามปกติ กฎเดียวเขียนที่เดียว ตรงจุดที่รู้ policy
2. template ใส่ `excludeRecipientPayloadKeys: ['requesterUserId']` (กลไกมีอยู่แล้ว เป็นการแก้ config)
3. เคสไม่เหลือผู้รับ → เพิ่ม `skipWhenAllRecipientsExcluded` เป็น **opt-in ต่อ template**

> **REMARK (เทสเดิมจับได้ว่าผมคิดผิด):** ตอนแรกผมทำให้ "ตัดหมดแล้วไม่เหลือใคร = skip" เป็นกฎรวม
> เทสเดิม *"fails retryable when exclusions leave no eligible second approver"* พังทันที — เพราะ
> **dual-approval vendor bill ต้องการให้ fail** การไม่เหลือใครที่นั่นแปลว่าบริษัทไม่มีผู้อนุมัติคนที่สองจริง ๆ
> ซึ่งต้องโผล่ให้เห็น ไม่ใช่เงียบ จึงเปลี่ยนเป็น opt-in เฉพาะ template ที่การไม่เหลือใครเป็นเรื่องปกติ

- verify: เทสใหม่ 4 (ตัดผู้ยื่นแต่ยังแจ้งคนอื่น / เจ้าของคนเดียวได้ `SUCCEEDED` + `skipped` ไม่ใช่ fail /
  ไม่มีใคร resolve เลยยังเป็น `FAILED_RETRYABLE` / ไม่มี requester ใน payload ก็ยังแจ้งผู้ยื่น)
  workflow + reimbursement spec ผ่านครบ

**ข้อความแก้แล้วด้วย:** `ไม่สามารถอนุมัติคำขอของตนเองได้ตามการตั้งค่าปัจจุบัน — เปิดได้ที่ ตั้งค่าเบิกจ่าย ›
"อนุญาตให้อนุมัติคำขอตนเอง"` — อ้างชื่อ toggle **ตรงตามที่หน้าตั้งค่าเขียนไว้เป๊ะ ๆ** เพราะข้อความที่เรียบเรียงใหม่
คือข้อความที่ผู้อ่านเอาไปค้นในหน้าตั้งค่าไม่เจอ; มีเทส pin ทั้งคำว่า "การตั้งค่า" และชื่อ toggle

### H-19 ✅ RESOLVED 2026-08-10 — role ที่สร้างจาก preset ชื่อไทยได้ key = `ROLE`
- ~~`roleKeyFromName` strip อักขระที่ไม่ใช่ ASCII → `ผู้จัดการ/การเงิน/บัญชี → ROLE`; ทุกใบเบิกตรึง
  `approverRoleSnapshot:'MANAGER'`; `matchesApproverRole('MANAGER',['ROLE'])` = false~~
- ~~Impact: เพิ่มพนักงาน+ให้ preset "ผู้จัดการ" → พนักงานเห็นหน้าอนุมัติแต่คิวว่างตลอดกาล~~

**แก้แล้ว — ยืม key มาตรฐานจาก preset แทนการเดาคำทับศัพท์**

`roleTemplateKey` อยู่ใน `CreateRoleInput` อยู่แล้ว และ segment สุดท้ายคือ identity ของ role พอดี:
`tpl.x.manager → MANAGER`, `tpl.x.finance → FINANCE`, `tpl.retail.cashier → CASHIER` — **ตรงกับ
`approverRoleSnapshot` ที่ระบบ pin ไว้** จึงเป็นการ lookup ไม่ใช่การเดา transliteration

ลำดับ: ชื่อ (ถ้าได้ slug) → preset → `ROLE`

- ชื่อยังชนะ preset เสมอ — ตั้ง "Shift Lead" จาก preset manager ได้ `SHIFT_LEAD` ไม่ใช่ `MANAGER`
- ชื่อไทยที่พิมพ์เองโดยไม่เลือก preset ยังได้ `ROLE` (ไม่มีอะไรให้ยืม) — role แบบนั้นไม่ match step
  ที่ route ด้วย role และ **OWNER fallback ใน `matchesApproverRole` คือสิ่งที่ทำให้บริษัทนั้นยังทำงานได้**
  ตรงกับที่ owner ระบุ: ใครมีสิทธิ์และได้รับมอบหมายก็ทำได้ และ OWNER ทำแทนได้ทุก role
- verify: เทสใหม่ 6 (Latin เหมือนเดิม, ไทย+preset ได้ key จริง, key ที่ได้ match MANAGER routing ได้,
  ชื่อชนะ preset, ใช้เฉพาะ segment สุดท้าย, fallback เมื่อไม่มี preset)

**ยังไม่ได้ทำ:** role ที่ถูกสร้างไปแล้วด้วย key `ROLE` ยังเป็น `ROLE` — การแก้นี้กันของใหม่ ไม่ได้ซ่อมของเก่า
บริษัทที่ติดอยู่แล้วต้องสร้าง role ใหม่ หรือใช้ OWNER อนุมัติไปก่อน

### H-20 ✅ RESOLVED 2026-08-10 — approver ที่ถูก disable ทำให้ใบเบิกหายจากทุกคิว
- ~~`isEligibleApprover` ข้าม OWNER fallback เมื่อมี `approverUserId` และ queue ใช้ predicate เดียวกัน; ไม่มี route reassign~~
- ~~Impact: ใบเบิกค้าง PENDING_APPROVAL ตลอด ไม่มีใครเห็น/กดได้ ออกได้แค่ยกเลิก (เผาเลขที่)~~

**แก้แล้ว — การมอบหมายผูกเฉพาะตอนที่คนนั้นยังทำงานได้**

`approverUserId` ถูกตั้งเฉพาะเมื่อ `policy.approverMode === 'CUSTOM_USER'` (`reimbursement-request.use-case.ts:304`)
แต่ตอนสร้าง step **บันทึก `approverRoleSnapshot` ไว้ด้วยเสมอ** — fallback จึงไม่ใช่การเดา แต่คือ routing ที่บริษัท
จะได้ถ้าไม่ระบุชื่อคนตั้งแต่แรก กว้างเท่ากับผู้ถือ role นั้น + OWNER **ไม่ใช่ทุกคน**

ปิด 3 ทางเข้าที่ต้องแก้พร้อมกัน ไม่งั้นแก้ที่เดียวจะได้ "เห็นในคิวแต่กดไม่ได้":

| ทางเข้า | ที่ไหน |
|---|---|
| คิวอนุมัติ | `ListApprovalQueueUseCase` — query ครั้งเดียวต่อหน้า ไม่ใช่ต่อแถว |
| approve | `canResumeApprovedDecision` |
| reject | `isEligibleApprover` ตรง ๆ |
| approve/reject ชั้น repository | `assertApproverEligibility` — อ่านผ่าน `tx` เดียวกับ update ที่มันคุ้ม เพื่อไม่ให้คนที่ถูก disable กลางทรานแซกชันยังนับว่าเป็นผู้รับมอบหมาย |

- "ยังทำงานได้" วัดที่ **membership ไม่ใช่ user**: คนที่ยัง ACTIVE แต่ถูกถอดออกจากบริษัทนี้แล้ว ต้องอนุมัติของบริษัทนี้ไม่ได้
- พารามิเตอร์ใหม่ default เป็น `true` ทุกจุด — caller ที่ยังไม่ opt-in คงพฤติกรรม exact-match เดิม การขยายสิทธิ์
  ไม่ควรเป็นสิ่งที่ค่า default ตัดสินให้
- verify: เทสใหม่ 3 (OWNER ตัดสินได้เมื่อผู้รับมอบหมายหายไป / คนที่ไม่ตรง role ยังถูกปฏิเสธ / ยัง exact-match
  ตราบใดที่ผู้รับมอบหมายยัง active) + spec reimbursement เดิมผ่านครบ; `tsc` 14 pre-existing

**ยังไม่ได้ทำ:** route reassign ที่ audit ระบุว่าไม่มี — ยังไม่มี ทางนี้แค่ทำให้ใบไม่ค้างถาวร ไม่ได้ให้ย้ายผู้อนุมัติ

---

## 6. HIGH — validation / concurrency / เอกสารข้ามงวด

### H-21 ✓ [R2] เอกสารย้อนเข้างวดที่ปิดแล้วได้ (guard ครอบเฉพาะเอกสารภาษี)
- `prisma-accounting.repository.ts:318` เช็คงวดเฉพาะ `TAX_INVOICE|CREDIT_NOTE|DEBIT_NOTE`; INVOICE/RECEIPT/BILLING_NOTE
  + vendor bill approval + create payment + expense payment + goods receipt ไม่เช็ค
- Impact: เอกสารสร้างสำเร็จ ตรา `pending` แล้ว generate ปฏิเสธ `period_closed`, `countPostingBlockers` นับไว้ในงวดที่ปิดแล้ว → เงินเข้าธนาคารโดยไม่มีรายการบัญชี

### H-22 [R2] ไม่มี UI เปิดงวดที่ปิดไปแล้ว — `unclose` เป็น endpoint กำพร้า

### H-23 ✓ [R1/R2] Request body จำนวนมากไม่ผ่าน ValidationPipe (type/interface → metatype = Object)
- **[R2] เป็นระบบ:** 164 จาก 277 `@Body()` ไม่ typed เป็น class; `expense.controller.ts` 28 body / DTO 0; schema ไม่มี `VarChar` เลย
- **[R1] เจอเฉพาะจุด:** reimbursement approve/reject/finance-review/void/cancel body ไม่ validate → type-confusion 500 (`reason:{}`→`reason.trim()`)

> **REMARK (สองรอบ ความละเอียดต่างกัน):** รอบ 1 พบอาการเฉพาะโมดูล reimbursement (จัดเป็น Medium). รอบ 2 วัดขอบเขต
> จริงทั้งระบบ 164/277 (ยกเป็น High) และชี้ว่าเป็น **ต้นเหตุร่วม** ของ CR-11 (ปี พ.ศ.), H-24 (tax ID), และ ฿0 confirm.
> ใช้ภาพรอบ 2 (High, systemic); ตัวอย่าง reimbursement ของรอบ 1 เป็น instance หนึ่ง.

**🟡 บางส่วนแก้แล้ว 2026-08-09 — หยุดเลือด + ปิดรูที่อันตรายกว่ารายการที่เหลือ**

วัดใหม่ด้วยสแกนเนอร์: `@Body()` ทั้งหมด **295** ตัว มี DTO class **127** เหลือไม่ผ่าน validation **167**
(99 = import type/interface, 68 = inline object literal) — ตัวเลข 164/277 ของรอบ 2 ยังใกล้เคียงของจริง

**ทำไมไม่เขียน DTO ทั้ง 167 รวดเดียว:** `forbidNonWhitelisted` เปิดอยู่ ถ้า DTO ระบุ field ผิดแม้ตัวเดียว
request ที่ถูกต้องจะกลายเป็น 400 ใน production โดยไม่มีอะไรฟ้องตอนเขียน — แปลงผิดอันตรายกว่าปล่อยไว้

**สิ่งที่ทำแทน:**
1. `common/pipes/body-validation-coverage.spec.ts` — สแกนทุก controller เปลี่ยน backlog จาก
   "คุณสมบัติที่มองไม่เห็น" เป็น **รายการที่นับได้และรีวิวได้** เพิ่ม endpoint ที่ 168 ไม่ได้ถ้าไม่จงใจแก้ตัวเลข
   และมีเทสแยกที่บังคับให้ลดตัวเลขลงใน commit เดียวกับที่แปลง เพื่อไม่ให้ความคืบหน้าถูกกลืนเป็นไฟเขียวเฉย ๆ
2. **ปิดรูที่แย่กว่ารายการทั้ง 167** — เทสจับได้ทันทีว่ามี `type` ที่ **ตั้งชื่อลงท้าย `Dto`** แล้วใช้เป็น
   `@Body()` จริง 3 ตัว: สองตัวใน `counterparty.controller.ts` และ `InternalToolCallDto` ใน
   `internal-tools.controller.ts` — อันตรายกว่าเพราะ**ดูเหมือนผ่านการตรวจแล้ว** ทั้งที่ pipe ข้ามไป
   (ตัวหลังคือ endpoint ที่ AI gateway เรียกเข้ามาสั่ง ERP tool) แปลงเป็น class ครบทั้งสามแล้ว
3. `AuditLogDto` เป็น type ของ **response** ไม่ใช่ body — ปรับเทสให้ดูเฉพาะตัวที่ผูกกับ `@Body()` จริง
   ไม่งั้นจะกลายเป็นเทสที่คนชินกับการเมิน

**หลักที่ใช้ตอนแปลง:** required เฉพาะ field ที่โค้ด dereference จริง ๆ ที่เหลือ optional หมด — บน endpoint ที่ใช้งานอยู่
การเลื่อน field เป็น required คือการเปลี่ยนสัญญา ผู้เรียกที่เคยไม่ส่งจะกลายเป็น 400 ทันทีที่ deploy

**รอบสอง — แปลง expenses แล้ว 12 ตัว (28 → 16), backlog 167 → 155**

`expense.dtos.ts` ใหม่ ครอบคลุมเฉพาะ **inline object literal** ซึ่งเป็นกลุ่มที่ปลอดภัยที่สุดเพราะรายชื่อ field
เขียนอยู่ตรงนั้นแล้ว ไม่ต้องเดา: upload intent (2 แบบ), upload completion (2 แบบ), reason required (reject/void/
reject signature), reason optional (dismiss/confirm duplicate), record payment, set derived asset

- **`reason` คือตัวที่คมที่สุด** — handler เรียก `reason.trim()` ตรง ๆ ส่ง `{"reason":{}}` = 500
  แบบเดียวกับที่รอบ 1 เจอใน reimbursement ตอนนี้เป็น 400 แล้ว
- `paidAmount` ใช้ `POSITIVE_ACCOUNTING_MONEY_PATTERN` **ตัวเดียวกับ**เอกสารบัญชี — สองขอบเขตเถียงกันเรื่อง
  `1e5`/`-0.001` ไม่ได้อีก
- `expenseDate`/`paidAt` ใช้ `CIVIL_DATE_PATTERN` ที่ **export ออกมาจาก contracts** (เดิม private) แทนการคัดลอก
  pattern — ขอบเขตที่คัดลอกนิยามคือขอบเขตที่ drift ได้
- `byteSize` เดิมรับสตริงอะไรก็ได้เข้าไปคำนวณ pre-signed upload ตอนนี้ต้องเป็นจำนวนเต็มไม่ติดลบ

**รอบสาม — แปลง transaction-tax แล้ว 5 ตัว (16 → 11), backlog 155 → 150**

`transaction-tax.dtos.ts` ครอบคลุม inline literal ทั้ง 5: สร้าง profile จาก template, verify trade evidence,
generate reconciliation, review reconciliation, resolve preview

- **`generateReconciliation` ส่ง body ทั้งก้อนเข้า use case** — key แปลกปลอมเดินเข้าไปถึงข้างในได้ ตอนนี้ตันที่ขอบ
- **`periodKey`** เดิมส่งอะไรก็ได้ แล้ว repository เทสรูปแบบ `YYYY-MM` เองและ**เปลี่ยนเป็น null เงียบ ๆ ถ้าไม่ตรง**
  → ได้ reconciliation ของ "ไม่มีงวด" แทนที่จะ error ตอนนี้ 400 ตั้งแต่ขอบ
- `input` ของ resolve preview ปล่อยเป็น object แบบมีขอบเขต (resolver เป็นเจ้าของ field) แต่กันสตริง/อาเรย์
  ที่เคยเดินไปถึง resolver ได้
- บันทึกไว้ในเทสว่า `status: null` เท่ากับไม่ส่ง เพราะ `@IsOptional()` ข้าม null ด้วย และ handler ใช้ `??` —
  จดไว้ ไม่ไปบีบให้เข้ม เพราะสองแบบมีความหมายเดียวกันอยู่แล้ว

**ยังเหลือ 150 รายการ** หนักสุด expenses 16, transaction-tax 11, crm-customer 9, tax 9 —
ที่เหลือในสองโมดูลนี้เป็น type ที่ import จาก contract ต้องอ่าน field จาก contract ก่อนถึงจะประกาศได้
เดาแล้วผิดคือ 400 บน request ที่ถูกต้อง

> **REMARK (REVIEWER):** ตัวเลข metatype เป็น inventory ของจุดเสี่ยง ไม่ใช่ผลทดสอบว่า 164 endpoint รับข้อมูลเสียทั้งหมด.
> ให้ High เฉพาะ case ที่ reproduce แล้ว และแตก 164 จุดเป็น validated-in-domain / missing-validation / not-applicable
> ก่อนสรุปว่าเป็น systemic vulnerability.

### H-24 ✓ [R2] เลขประจำตัวผู้เสียภาษีผู้ขายไม่ถูก validate ฝั่ง server
- `expense-status.logic.ts:203` เช็คแค่ไม่ว่าง; `^\d{13}$` อยู่แค่ในเบราว์เซอร์ (`expense-review-validation.ts:98`); `THAI_TAX_ID_PATTERN` มีใน contracts แต่ไม่เคยใช้กับ vendor
- Impact: ตัวอักษรปน/5 หลัก ผ่านเข้ารายงานภาษีซื้อ/ภ.พ.30; เข้าถึงได้ทั้ง API, LINE, OCR hallucination

### H-25 ✓ [R2] กดปุ่มตัดสต็อกซ้ำ = ตัดสองครั้ง
- `idempotencyKey: \`${ctx.requestId}:${key}\`` (`create-movement.use-case.ts:148`) แต่ `ctx.requestId` เป็น UUID ใหม่ทุก request
  (`request-id.middleware.ts:8`) → key ต่างทุกครั้ง; guard เดียวคือเช็คไม่ติดลบ (รูปแบบเดียวใน transfer/stock-count)
- Impact: คืน 201 ทั้งสองครั้ง สต็อกลดสองเท่า ไม่มี error
- แก้: idempotency key จาก client ไม่ใช่ `ctx.requestId`

### H-26 [R2] Purchase order ไม่มี concurrency control เลย
- `purchaseOrder.update({ where: { id } })` ไม่มี status/version/companyId (`prisma-procurement.repository.ts:392`); ต่างจาก vendor-bill ที่ทำถูก
- Impact: สองคนอนุมัติพร้อมกันได้ 200 ทั้งคู่ ผู้อนุมัติคนหลังทับคนแรกใน audit

### H-27 [R2] นำเข้า statement ธนาคารไม่ตรวจวันที่เลย ทั้งที่เป็น input ที่เป็น พ.ศ. เสมอ
- `banking.logic.ts:103-107` ตรวจแค่ไม่ว่าง; column alias มี `'วันที่'` (พ.ศ. บน statement ไทย); การแปลง พ.ศ.→ค.ศ. มีแค่ในข้อความ prompt (`line-ai-internal.controller.ts:440`) ไม่มีอะไรตรวจว่าโมเดลทำตาม

### H-28 [R2] ใบเสร็จใบเดียวลงบัญชีสองครั้ง (latent — จะระเบิดทันทีที่แก้ CR-6)
- `linkedExpenseId` มีครบฝั่ง API แต่ web ไม่เคยส่ง (`ReimbursementCreatePage.tsx:65-73`); projection สร้าง
  ExpenseRecord ใหม่ทุกบรรทัดเสมอ (`materialize-claim-expenses.service.ts:14`); double-claim guard ดูแค่ `reimbursementLine`;
  projection ลบตัวตนผู้ขาย → สัญญาณ duplicate +30/+25/+20 ใช้ไม่ได้ เหลือแค่ checksum/pHash ของรูป
- Impact: ตรงกัน → จ่ายแต่ไม่ลงบัญชี + settlement ค้าง; ไม่ตรง → ใบเสร็จเดียวเป็นค่าใช้จ่ายสองครั้ง

> **⚠️ ลำดับการแก้:** อย่าแก้ CR-6 (ต่อ worker/ปุ่มลงบัญชี) โดยไม่แก้ H-28 (`linkedExpenseId`) พร้อมกัน — บั๊กลงบัญชีซ้ำยัง
> latent เพราะไม่มีขาไหน post ได้ **มันจะระเบิดทันทีที่ทำให้ posting ทำงาน**

---

## 7. HIGH — platform / process

### H-29 [R1] e2e 35 spec ไม่เคยรันใน CI + commit docs-only จบ success ทั้งที่ข้าม test
- `find e2e` = 35; ไม่มี match ใน `ci.yml`/`deploy-uat.yml`; runbook `cloud-environment-operations.md:52-54`; `next.config.mjs:15-16` build ด้วย `ignoreBuildErrors`

> **REMARK (REVIEWER):** แยกเป็นสองข้อ: “ไม่มี E2E gate” เป็น High process risk ที่เห็นด้วย; “docs-only skip code test”
> เป็นพฤติกรรมปกติของ path filter เว้นแต่พิสูจน์ว่า deploy นำ artifact/SHA ที่ไม่เคยผ่าน code gates ไปใช้.

### H-30 ✅ RESOLVED 2026-08-09 — Workers ไม่มี graceful shutdown + ไม่มี DLQ (config หลายตัวตาย)
- ~~`main.ts` จับแค่ `unhandledRejection`/`uncaughtException` ไม่มี SIGTERM; `WORKER_SHUTDOWN_TIMEOUT_MS`/`DLQ_ENABLED`/`QUEUE_RETRY_*` ตาย; default `attempts:1`; `removeOnFail:{count:100}`~~
- ~~Impact: ทุก deploy ฆ่า job กลางคัน; LINE send/campaign อาจยิงซ้ำตอน redelivery~~

**แก้แล้วครบทั้ง 3 ส่วน:**

| ส่วน | ทำอะไร |
|---|---|
| graceful shutdown | `main.ts` รับ SIGTERM/SIGINT → ปิด health server ก่อน (ให้ LB ถอน task) → `worker.close()` ทุกตัวแบบ `allSettled` (ตัวเดียวค้างไม่ฉุดตัวอื่น) → บังคับออกเมื่อครบ `WORKER_SHUTDOWN_TIMEOUT_MS` |
| retry config | `configureQueues()` เอา `QUEUE_RETRY_ATTEMPTS`/`QUEUE_RETRY_BACKOFF_MS`/`DLQ_ENABLED` มาใช้จริง เรียก **ก่อน** สร้าง queue ตัวแรก เพราะ queue อ่าน policy ตอนถูกสร้าง |
| DLQ | `attachDeadLetterQueue()` ย้าย job ที่ retry หมดโควตาไป `<queue>-dlq` พร้อม payload + เหตุผล ทุก worker ต่อครบ |

**จุดที่ต้องระวังและจัดการไว้แล้ว:**
- BullMQ ยิง event `failed` **ทุกครั้งที่ retry** ไม่ใช่ครั้งสุดท้าย → `isFinalAttempt()` กันไม่ให้ job เดียวลง DLQ ซ้ำ 3 ใบ
- timer บังคับออก **ไม่ `unref()`** โดยตั้งใจ ถ้า unref Node จะออกเองด้วยโค้ด 0 แล้วรายงานว่าปิดสำเร็จทั้งที่ทิ้ง job กลางคัน
- SIGTERM ซ้ำครั้งที่สองถูกกันด้วย `shuttingDown` — `close()` ของ BullMQ ไม่ re-entrant
- ค่า default ก่อน `configureQueues()` ตั้งเป็น **พฤติกรรมเดิม** (`attempts:1`, DLQ ปิด) ไม่ใช่ค่าที่ตั้งใจ เพื่อไม่ให้ worker ที่ลืมเรียกได้ retry ที่ไม่มีใครเลือก
- ต้นทุน: DLQ เปิดใช้ connection Redis เพิ่ม 1 ต่อ queue (7 เส้น) และปิดตาม worker ผ่าน event `closed`

**verify:** เทสใหม่ 9 ตัว — policy ก่อน/หลัง configure, backoff หายเมื่อ `attempts:1`, retention ไม่ถูกกลืนหาย,
DLQ ลงเฉพาะครั้งสุดท้าย, `attempts` ไม่ตั้ง = ครั้งแรกคือครั้งสุดท้าย + spec สแกน `main.ts` กันคนเพิ่ม worker
ใหม่แล้วลืมลงทะเบียน shutdown (ลำดับ configure ก่อน worker, health ปิดก่อน drain, SIGTERM+SIGINT, กันปิดซ้ำ).
`apps/workers` ผ่านทั้งหมด ยกเว้น `object-version-cleanup` ที่ล้มเพราะ `@aws-sdk/client-s3` ประกาศไว้ใน
package.json แต่ยังไม่ถูกติดตั้งในเครื่องนี้ (pre-existing ไม่เกี่ยวกับการแก้นี้)

### H-31 ⚠️ CORRECTED 2026-08-09 — ขาดเฉพาะ `taxId` ส่วน VAT registration มี UI ครบอยู่แล้ว

> **REMARK (ข้อนี้รอบ 2 รายงานผิดครึ่งหนึ่ง — ผู้ใช้ทักท้วงแล้วตรวจซ้ำ):** ข้อความเดิมเขียนว่า
> *"ไม่มี UI บันทึกเลขผู้เสียภาษีบริษัทเอง **+ คำตอบ VAT registration**"* — ส่วน VAT **ผิด**
>
> - ตอน onboard: `SystemOnboardingNewPage.tsx:435` มี dropdown `REGISTERED`/`NOT_REGISTERED` +
>   ช่องวันที่มีผล และส่ง `vatRegistration` เข้า API จริง
> - แก้ทีหลัง: `PartnerDetailPage.tsx:162` เรียก `setPartnerVatRegistration` พร้อม `expectedVersion`
>   กัน lost update
> - ออกแบบละเอียดกว่าที่รายงานด้วย: ถ้า admin ยังไม่รู้ จะไม่ส่ง field เลย เพราะ "ไม่รู้" กับ
>   "ไม่จดทะเบียน" ไม่ใช่เรื่องเดียวกัน
>
> **สาเหตุที่พลาด:** รอบ 2 เดิน use case จากมุมผู้ใช้ในบริษัท ไม่ได้เข้าหน้า **system admin**
> ซึ่งเป็นคนละ persona จึงเหมารวมทั้งข้อว่า "ไม่มี UI" ทั้งที่ต้องแยกเป็นสองเรื่อง
> บทเรียน: finding ที่พูดถึงสองสิ่งในประโยคเดียวต้องตรวจแยกทีละสิ่ง

**ส่วนที่ยังขาดจริง — `taxId` ของบริษัทเอง:**
- `PartnerDetailPage.tsx:1593` แสดง Tax ID แบบ **read-only** เท่านั้น
- `taxId` ที่เจอในหน้าอื่นเป็นของ **คู่ค้า** ไม่ใช่ของบริษัทเอง (`CounterpartyListPage`, supplier, payee snapshot)
- `company-identity.controller.ts` มีอยู่ แต่ไม่มีหน้าไหนเรียก และ onboarding API ไม่รับ field `taxId`
- Impact: `sellerIdentityComplete` ไม่มีวันเป็นจริง; 50 ทวิ payer block เป็น null เสมอ
  (เหตุผลแคบลงจาก "ขาดสองอย่าง" เหลือ "ขาด `taxId` อย่างเดียว")

**✅ แก้แล้ว 2026-08-09 — เพิ่มช่อง Tax ID ในหน้า onboard + API**
- web: `SystemOnboardingNewPage.tsx` เพิ่มช่องข้าง VAT รับรูปแบบมีขีด (`0-1234-56789-01-2`) แล้วตัดเหลือตัวเลข
  ว่างได้ (optional เหมือน VAT) และบล็อกการ submit ถ้ากรอกไม่ครบ 13 หลัก แทนที่จะปล่อยให้ API 422 ทีหลัง
- API: `CreateOnboardingDto.taxId` + command `taxId` ใช้ `normalizeTaxId` **ตัวเดียวกับ**
  `CompanyIdentityUseCase.patch` → เลขที่ผ่านที่นี่จะไม่มีวันเป็นเลขที่หน้า identity ปฏิเสธ
- **จุดสำคัญ:** ไม่ได้เขียนลง column เฉย ๆ แต่เขียนเป็น **INITIAL_CAPTURE version 1** พร้อมแถว
  `CompanyLegalIdentityRevision` และ mirror ลง `CompanyTaxProfile` ครบตาม invariant ที่ `patch()` รักษาไว้
  ถ้าเขียนดิบ ๆ `legalIdentityVersion` จะค้างที่ 0 โดยไม่มี revision → optimistic concurrency และ
  ประวัติของหน้า identity จะอ้างถึงค่าที่ไม่มีใครเขียน
- verify: เทสใหม่ 4 (เก็บเป็น versioned capture, รับรูปแบบมีขีด, ไม่กรอกแล้วไม่แตะอะไรเลย,
  ไม่ครบ 13 หลักต้อง 422) · system-onboarding + web spec ผ่านหมด · `tsc` api 14 pre-existing / web 0

---

## 8. MEDIUM

**พนักงาน/สิทธิ์/auth**
- [x] **M8-01 RESOLVED 2026-08-09:** เปลี่ยนรหัส (`change-password`/regenerate) เคยไม่ revoke session เดิม
  - self-change revoke session อื่นทั้งหมดและคงเฉพาะ session ปัจจุบัน; regenerate โดยผู้ดูแล revoke ทุก session ใน transaction เดียวกับการเปลี่ยน credential
  - แก้ gap ที่พบเพิ่มระหว่าง remediation: password login ที่ตรวจรหัสเก่าผ่านพร้อมกับการเปลี่ยนรหัสเคยสร้าง session ใหม่หลัง revoke ได้ ตอนออก watchdog token จึง lock แถว `UserCredential`, ตรวจ `updatedAt` snapshot ซ้ำ และสร้าง `AuthSession` ใน transaction เดียวกัน
  - ผล race ชัดเจนสองทาง: credential เปลี่ยนก่อน → stale login ได้ 401; session สร้างก่อน → transaction เปลี่ยนรหัสรอ lock แล้ว revoke session นั้น
  - `ConfirmPasswordResetUseCase` ส่ง credential version เข้า issuance fence ด้วย แม้ route ปัจจุบันไม่เปิด เพื่อไม่เหลือช่องโหว่เดิมเมื่อเปิดใช้งานภายหลัง
  - Verification: focused auth/employee-access tests 50/50 ผ่าน; API typecheck ยังติด baseline 14 จุดที่ `substitute-receipt.use-case.spec.ts` และ `report.use-cases.spec.ts` ซึ่งไม่เกี่ยวกับ diff นี้
- [x] **M8-02 RESOLVED 2026-08-09:** audit log เคยใช้ `GET /audit/logs` โดยไม่มี tenant ใน route และพึ่ง optional `x-company-id` จึงเลือก membership บริษัทเก่าสุดเมื่อ caller ไม่ส่ง header
  - เปลี่ยน contract เป็น `GET /companies/:companyId/audit/logs`; AuthGuard ใช้ route tenant เมื่อไม่มี header และ controller บังคับ `assertRouteCompany` ก่อน query
  - repository ยังคง filter `AuditLog.companyId` และ role/category ABAC เดิม; mismatch ระหว่าง header/context กับ route ได้ 403 โดยไม่ query
  - ตัด legacy route ที่กำกวมแทนการคง fallback ที่เสี่ยง; อัปเดต product spec, plan และ RPT-08 E2E caller แล้ว
  - Verification: audit service/repository/controller tests 26/26 ผ่าน และ Playwright compile/list RPT 8 cases ผ่าน
- [x] **M8-03 RESOLVED 2026-08-09:** `x-company-id` เคยมี precedence เหนือ route `:companyId` และ controller จำนวนมากไม่ได้เรียก `assertRouteCompany` จึงทำ URL บริษัท B ด้วย context บริษัท A ได้
  - แก้ invariant ที่ AuthGuard จุดเดียว: ถ้ามีทั้ง header และ route ต้องเท่ากัน; mismatch ของ session ที่ยืนยันแล้วได้ 403 ก่อน resolve request context/use case
  - ไม่ลด security error ordering: token หาย/ปลอม/ถูก revoke ยังได้ 401 ก่อนตรวจ tenant mismatch จึงไม่เปิดข้อมูล route behavior แก่ unauthenticated caller
  - header-only และ route-only selection ยังทำงานตาม contract เดิม; `assertRouteCompany` ใน controller ที่มีอยู่ยังเป็น defense-in-depth
  - Verification: AuthGuard + deny-by-default tests 25/25 ผ่าน รวม matching fallback, authenticated mismatch และ unauthenticated mismatch
- [x] **M8-04 RESOLVED 2026-08-09:** permission/entitlement เคยแช่แข็งตาม RSC session ตอนเปิด workspace และ `WorkspaceScope` ใช้เฉพาะ branch scope จาก `/auth/me` โดยทิ้ง permission ใหม่
  - ทำ access-context fingerprint แบบ set-order independent ครอบคลุม role, permission (รวม permission ที่ entitlement strip) และ branch scope; refresh RSC เฉพาะเมื่อ fingerprint เปลี่ยน
  - revalidate ทุก 60 วินาทีเฉพาะ tab ที่ visible, เมื่อ focus/กลับมา visible และใช้ผล `/auth/me` ที่ BranchFilter โหลดอยู่แล้ว จึงไม่ refresh หรือยิงซ้ำโดยไม่มีเหตุ
  - gap ที่พบเพิ่มและแก้พร้อมกัน: ถ้าถูกถอดสิทธิ์ก่อนรอบ poll การตอบ 403 `insufficient_permissions`/`feature_not_enabled` จะส่ง signal ให้ workspace revalidate ทันที แต่ไม่ retry mutation ที่ถูกปฏิเสธ
  - request revalidation เป็น single-flight; network error คง shell ที่ใช้งานได้ ส่วน membership/company ถูกถอน (403 จาก `/auth/me`) ให้ server layout แสดง `CompanyAccessUnavailable`
  - Verification: focused web tests 26/26 ผ่าน; contracts build และ web `tsc --noEmit` ผ่าน

**รายรับรายจ่าย/ledger/date**
- [x] **M8-05 RESOLVED 2026-08-09:** Period key/entry date เคยคำนวณปนกัน 3 แบบ (UTC/server-local/Bangkok) ทำให้ settlement เวลา 01:00 ICT วันที่ 1 ถูกเก็บใน `JournalEntry.entryDate @db.Date` และงวดของเดือนก่อน
  - กำหนด boundary เดียว: instant (`paidAt`/`paymentDate`) แปลงเป็น Bangkok civil date ก่อนหา period; civil document date คงวันที่เอกสาร; ค่า `@db.Date` เขียนเป็น UTC midnight ของ civil date ไม่ใช้ `new Date(timestamp)` ตรง ๆ
  - ครอบคลุม manual/generated journal, accounting document/payment, expense, reimbursement, procurement และการตรวจ lock period ให้ source date, period key, journal entry และ tax/outbox metadata ตรงกัน
  - gap ที่พบเพิ่มและแก้พร้อมกัน: period `2026-13` เคยถูก `Date` roll เป็นปีถัดไปโดยเงียบ จึง validate `YYYY-(01..12)` ก่อนสร้างงวด; running number ของ accounting/procurement/inventory และ tax form period เคยยังใช้ server-local จึงอาจได้เลข/งวดภาษีคนละเดือนกับ journal และปรับให้ใช้ Bangkok boundary เดียวกัน
  - Verification: focused regression 124/124 ผ่าน รวม UTC `2026-08-31T19:00Z` → Bangkok `2026-09-01`/period `2026-09`, half-year tax boundary และ period malformed; API typecheck เหลือ baseline เดิม 14 จุดใน substitute-receipt/report specs โดยไม่มี error จาก diff นี้
- [x] **M8-06 RESOLVED 2026-08-09:** วันที่บนเว็บเคย render ตาม timezone ของเบราว์เซอร์ เพราะ formatter กลางไม่กำหนด `timeZone` ทำให้ผู้ใช้ฝั่งตะวันตกของ UTC เห็นวัน/เดือนเร็วกว่าฝั่ง API ที่ใช้ Asia/Bangkok
  - ตรึง date, time และ month formatter กลางเป็น `Asia/Bangkok`; call site 40+ จุดที่ใช้ helper จึงตรงกันโดยไม่แก้ซ้ำรายหน้า
  - gap ที่พบเพิ่มและแก้พร้อมกัน: apply time ของผังบัญชีและวันหมดอายุรหัสผ่านชั่วคราว bypass helper ด้วย `toLocaleString`; เวลาอัปเดต dashboard ภาษาอังกฤษใช้ `toLocaleTimeString` โดยไม่มี timezone — ปรับเข้ากฎเดียวกันทั้งหมด
  - custom data-rights formatter 2 จุดมี `Asia/Bangkok` อยู่แล้วจึงคงไว้; ไม่แตะ calendar/input arithmetic ซึ่งเป็นการเลือก civil date ไม่ใช่การ render timestamp ของ finding นี้
  - Verification: boundary `2026-08-31T19:00Z` แสดง `1 ก.ย. 2569 02:00 น.` และเดือน ก.ย.; focused tests 6/6 ผ่าน, web `tsc --noEmit` ผ่าน และ search ไม่เหลือ user-facing `Intl`/`toLocale*` formatter ที่ขาด timezone
- [x] **M8-07 RESOLVED 2026-08-09:** `DeleteExpenseUseCase` เคยหา expense ด้วย company อย่างเดียวและไม่ตรวจ `ctx.scopes.branchIds` ทำให้ผู้มี permission ลบ draft นอกสาขาที่รับผิดชอบได้
  - ตรวจ `isBranchInScope` ทันทีหลัง tenant-scoped lookup และก่อน permission/state/linked-data side effect; expense สาขากลาง (`branchId=null`) ยังเปิดให้ผู้ใช้จำกัดสาขาตาม policy กลาง
  - บันทึก DENIED audit `BRANCH_OUT_OF_SCOPE` ใน transaction; ผู้เรียกได้ 403 และไม่เข้าถึงสถานะ, retention, attachment หรือ linked-data ของรายการนอก scope
  - gap ที่พบเพิ่มและแก้พร้อมกัน: เดิมเช็ก deletable state ก่อน permission จึง leak สถานะให้ non-owner และ final delete ใช้ `id` อย่างเดียว จึงมี TOCTOU ที่รายการอาจถูก confirm/ย้ายสาขาหลัง preflight แล้วถูกลบ — จัด authorization ก่อน state และเปลี่ยน final mutation เป็น `deleteMany` CAS ด้วย `updatedAt` + company + branch-scope
  - เมื่อ CAS แพ้ การ unlink/soft-delete attachment, duplicate re-verdict และ SUCCESS audit ทั้งหมด rollback; UI แสดงข้อความให้ reload แทน error กำกวม
  - Verification: API delete tests 33/33, web expense tests 47/47 และ web `tsc --noEmit` ผ่าน; API typecheck เหลือ baseline เดิม 14 จุดหลังแก้ type ของ test fixture
- [x] **M8-08 RESOLVED 2026-08-09:** Draft update เคยไม่มี optimistic concurrency ทำให้ reviewer สองคนบันทึกทับกันเงียบ แม้ confirm path มี CAS อยู่แล้ว
  - PATCH draft/review, classification override และ OCR-total acknowledgement บังคับ `expectedUpdatedAt`; web ส่ง version จาก detail ที่ผู้ใช้กำลังดู และ conflict ได้ 409 `EXPENSE_UPDATE_CONFLICT` พร้อมข้อความไทยให้โหลดใหม่และตรวจอีกครั้ง โดยไม่ retry mutation อัตโนมัติ
  - repository ทำ conditional update ด้วย tenant + id + `updatedAt` ภายใต้ advisory lock เดิม; stale version ไม่เปลี่ยน header หรือเรียก dependent write ส่วน internal LINE correction ส่ง version ของ record ที่โหลดมาเช่นกัน
  - gap ที่พบเพิ่มและแก้พร้อมกัน: replacement lines เคย `upsert` ใน transaction แยกก่อน header update ดังนั้น header validation/CAS failure อาจทิ้ง line ใหม่ไว้บางส่วน — ย้าย line upsert เข้า callback ของ header transaction หลัง CAS ชนะ ทำให้ rollback พร้อมกันทั้งก้อน
  - `expectedUpdatedAt` ที่หาย/ไม่ใช่ timestamp ถูกปฏิเสธเป็น 400 ด้วย stable code แทนการบันทึกแบบ last-write-wins; route type และ web API type บังคับ field นี้ด้วย
  - Verification: focused expense API tests 72/72 และ web error tests 18/18 ผ่าน; contracts build และ web typecheck ผ่าน; API typecheck เหลือ baseline เดิม 14 จุดใน substitute-receipt/report specs โดยไม่มี error จาก M8-08
- [x] **M8-09 RESOLVED / RECLASSIFIED 2026-08-09:** เอกสารรายรับ draft เคยไม่มี PATCH/UI แก้ไข แต่ส่วน “ลบ/void ไม่ได้” ของ finding เดิมไม่ตรง implementation และ policy
  - เพิ่ม `PATCH /companies/:companyId/accounting/documents/:documentId` และหน้าแก้ Draft สำหรับวันที่, VAT, หมายเหตุ และหลายบรรทัด; แก้ได้เฉพาะ `DRAFT`, runtime DTO จำกัดรูปแบบ/ขนาด และ use case ตรวจ money/tax/source/branch/permission ซ้ำ
  - บังคับ `expectedUpdatedAt`; header + replacement lines + Tax Code snapshot ทำใน transaction เดียวหลัง status/version CAS และใช้ lifecycle advisory lock ร่วมกับ issue/void เพื่อไม่ให้ save ทับหรือแข่งออก/ยกเลิกเอกสารแบบผลลัพธ์กำกวม
  - ไม่เพิ่ม DELETE route: spec ห้าม hard-delete accounting evidence จาก user flow โดยตั้งใจ; `POST .../void` และปุ่ม Void มีอยู่เดิม รองรับ DRAFT อยู่แล้วและเก็บ reason/audit/outbox จึงเป็น correction path ที่ถูกต้อง
  - gap ที่พบเพิ่มและแก้พร้อมกัน: Sales มี type-specific `accounting.quotation.*` แต่ controller/use case/web เคยบังคับ generic `accounting.document.*` ทำให้ role ตาม spec เข้า list/create/edit/issue quotation ไม่ได้ — ปรับ route/use case/navigation/access matrix ให้รับ generic หรือ type-specific และจำกัด list เหลือเฉพาะ document type ที่อ่านได้
  - Owner decision เรื่องผู้เกี่ยวข้องถูกทำเป็น view-only ABAC: สมาชิกทุก role ได้ `accounting.document.read_related` แต่ key นี้ยังถูก strip เมื่อ `sales_documents` ปิด; source เดิน creator/update/approve/issue/void/payment allocation และ source/conversion links แบบ cycle-safe จนจบ graph โดยกรอง tenant/branch ทุก hop ส่วน update/issue/void ยังต้องมี action permission และ state ที่ถูกต้องเหมือนเดิม
  - gap ที่พบเพิ่มและแก้พร้อมกัน: relation เดิมที่ออกแบบระหว่างแก้เดินไม่ถึงเอกสารอื่นซึ่งอยู่ใน payment allocation เดียวกันและหยุดที่ 10 ชั้น — แก้ให้เดินผ่าน payment siblings จน closure จริง, เพิ่ม index ของ source/conversion link และให้ LINE/AI ใช้ any-of read gate ก่อนเรียก source use case เดียวกัน จึงไม่กว้างกว่าหน้าเว็บ/API
  - gap ที่พบเพิ่มจากการเล่นแก้ Draft: payload replacement ของ UI เกือบทิ้ง `productId`/SKU/unit/category ที่ไม่ได้แสดงในฟอร์ม และปุ่ม submit/convert/correction บางปุ่มดูแค่ state หรือ generic permission — ปรับให้ carry field เดิมครบและซ่อน/แสดงแต่ละ mutation ด้วย permission ของ action+document type เป้าหมาย
  - UI เก็บ draft ที่ผู้ใช้แก้ไว้เมื่อได้ conflict และแสดงข้อความไทยให้โหลดใหม่; issued/voided/closed ยังไม่มี edit control และ server ปฏิเสธแม้เรียก API ตรง
  - Verification: focused API/accounting/auth/access/AI 179/179, LINE/AI API 202/202, AI Gateway 93/93, focused web 86/86 และ web suite ทั้งหมด 863/863 ผ่าน; Prisma schema validate, contracts build, AI Gateway/web typecheck ผ่าน; API typecheck ไม่มี error จาก M8-09 และเหลือ baseline เดิม 14 จุดใน substitute-receipt/report specs
- [x] **M8-09B RESOLVED 2026-08-10:** Quotation conversion เคยสร้าง target draft แล้วค่อยปิด source คนละ transaction และไม่มี CAS/lifecycle lock; request สองอันพร้อมกันจึงสร้าง invoice/billing note ซ้ำได้ และ failure หลัง create ทิ้ง target ไว้แต่ source ยัง ISSUED
  - ย้าย source `ISSUED → CLOSED` และ target create เข้า serializable transaction เดียว ภายใต้ lifecycle advisory lock เดียวกับ save/issue/void และ CAS ด้วย `updatedAt` ของ source ที่โหลดมา; target create ล้มเหลวจะ rollback source claim
  - retry target type เดิมหลังสำเร็จคืน target เดิมและไม่เขียน audit/outbox ซ้ำ; สภาพ legacy ที่มี target เดิมแต่ source ยัง ISSUED จะปิด source ให้ครบครั้งเดียว ส่วน target ต่างชนิดหรือมากกว่าหนึ่งใบ fail 409 `accounting_document_already_converted`
  - web แปล conflict เป็นคำแนะนำภาษาไทยให้โหลดใหม่และเปิดเอกสารที่สร้างไว้ แทนการแสดงข้อความ operator ภาษาอังกฤษ
  - Verification: focused conversion repository/use-case tests 13/13, expanded accounting/auth/access/AI regression 184/184, web error copy 20/20 และ web typecheck ผ่าน; API typecheck ไม่มี error จาก M8-09B (ยังมี baseline substitute-receipt/report และ error จาก concurrent reimbursement edit นอก commit นี้)
- [x] **M8-10 RESOLVED 2026-08-10:** Partial payment ของ expense เคยลงบัญชีไม่ได้, `paidAmount` ถูกแทนที่แทนการสะสม และบันทึกจ่ายทับสถานะ accrual เป็น `pending`
  - เพิ่ม `ExpensePayment` แบบ append-only: แต่ละการจ่ายมี amount/date/method/actor/status, posting status/error และ JV ของตนเอง; header เก็บเฉพาะยอดสะสม/คงเหลือเพื่ออ่านเร็ว
  - บันทึกจ่ายใช้ Decimal + serializable lifecycle lock + `updatedAt` CAS; overpay/malformed/stale/claim-born rollback ทั้ง payment row และ aggregate พร้อม stable error
  - canonical ledger ใช้ `payment.id` เป็น `expense.payment` source จึงลงบัญชี partial แต่ละครั้งได้อิสระหลัง accrual posted; manual UI ส่ง source id ที่ถูกต้อง และ Auto-post scan payment ที่เกิดหลัง activation โดยรอ accrual ก่อน
  - หน้า detail แสดงประวัติการจ่ายและสถานะลงบัญชีราย payment; close blocker นับ accrual กับ payment แยก ไม่ค้างเพราะ header เดียว
  - gap ที่พบเพิ่มและแก้พร้อมกัน: อนุมัติใบทดแทนเคยทำ header เป็น PAID โดยไม่สร้าง payment fact; ตอนนี้ append เฉพาะยอดคงเหลือและไม่สร้างซ้ำเมื่อจ่ายครบแล้ว
  - gap ที่พบเพิ่มและแก้พร้อมกัน: bank matching เคยรวม partial payment เป็น candidate เดียวจาก header ทำให้ allocation ของแต่ละการจ่ายสูญหาย; ตอนนี้ใช้ payment event/source id/amount/date แยกต่อรายการและคง identity ของ legacy match
  - void กลับรายการทุก partial-payment JV และ terminalize payment ทุกแถวใน transaction เดียว; ถ้า leg ไม่เคยลงบัญชีใช้ `not_required` แทน `pending` ค้าง
  - migration backfill รายการจ่ายเก่าโดยใช้ `payment.id=expense.id` เพื่อให้ JournalEntry เดิมยังชี้ source ถูก และแยก error ของ accrual/payment จากหลักฐาน journal ก่อนคืนสถานะ header
  - Verification: focused API/ledger/banking 57/57 และ web error copy 21/21 ผ่าน; broader expense/ledger และ web expense/common-api ผ่าน, contracts build + web typecheck ผ่าน, API typecheckไม่มี error จากข้อนี้และเหลือ baseline เดิม 14 จุด; Prisma validate/generate ผ่าน และ migration ทั้ง 126 รายการ apply สำเร็จบน PostgreSQL เปล่า
- [x] **OWNER POLICY FOLLOW-UP — EXPENSE/ใบทดแทน 2026-08-10:** ผู้ที่ถูก persist เป็น creator/updater/reviewer/confirmer/rejector/voider, payment actor, ผู้เตรียม/ผู้จ่าย/ผู้อนุมัติ/ผู้ออกใบทดแทน หรือ actor ของใบเบิกต้นทาง ดู expense chain ได้ภายใต้ tenant/branch scope
  - เพิ่ม `expense.read_related` เป็น universal view-only ABAC แต่ strip เมื่อ `expenses.list` ปิด; standard/custom roles ได้ parity และ LINE/AI ใช้ source predicate เดียวกับ web/API
  - mutation ไม่ได้สิทธิ์เพิ่ม: update/review/confirm/payment/reject/void/OCR/signature ยังต้อง exact action permission + actor + state; แก้ OCR decorator ที่เดิมใช้ read permission ให้ประกาศ action keys จริง
  - gap ที่พบและแก้ระหว่าง use-case play: system role ไม่ mirror core pack, submenu ปิดแล้วยังเหลือ relation key, category controller/use-case ใช้ gate ไม่ตรงกัน, central document หายจาก substitute list, OR ของ branch/relation/month เคยเสี่ยงเขียนทับกัน และชื่อ index ยาวเกิน PostgreSQL limit
  - Verification: focused API 138/138, AI Gateway 81/81 และ focused web ผ่าน; contracts build + web/AI typecheck ผ่าน, API ไม่มี error จากข้อนี้ (baseline เดิม 14 + 1 จาก untracked concurrent spec); Prisma validate/generate และ migration ทั้ง 127 รายการบน PostgreSQL เปล่าผ่าน
  - Commit: `6cfea99 fix(expenses): allow related actors to view records`
- [R1] Expense payment endpoint ไม่ validate enum/date + เทียบ bound float → 500 แทน 400; ไม่มี idempotency
- [x] **[R1] List รายจ่าย `pageSize` ไม่ clamp — ✅ RESOLVED 2026-08-10.** normalize pagination ที่
  `ListExpensesUseCase` ซึ่งเป็น shared boundary ของ web/API, LINE และ report: `page` ขั้นต่ำ 1,
  `pageSize` ค่าเริ่มต้น 20 และอยู่ในช่วง 1–200 ดังนั้น `?pageSize=500000` ถูกลดเหลือ 200 ขณะที่ web
  ซึ่งส่ง 200 อยู่แล้วยังได้พฤติกรรมเดิม
  - Verification: focused expense use-case suite ผ่าน 29/29 รวม regression ที่ยืนยัน `page=0 → 1`
    และ `pageSize=500000 → 200`; `git diff --check` ผ่าน
  - Commit: `8dad0a6 fix(expenses): clamp list pagination`
- [x] **[R1] Journal line ผ่าน `parseFloat` ก่อนลง Decimal — ✅ RESOLVED 2026-08-10.** ส่ง string เข้า
  Decimal(18,4) ตรง ๆ แบบเดียวกับ money/rate field อื่นทุกตัวใน `create` เดียวกัน (`taxBaseAmount`,
  `taxRateSnapshot` ฯลฯ ส่ง string อยู่แล้ว) แล้วลบ helper `n()` ที่ตายทิ้ง
  - **ไม่ latent เท่าที่คิด:** DTO รับ `^\d{1,14}(?:\.\d{1,4})?$` = 18 หลักนัยสำคัญ = ขนาดคอลัมน์พอดี
    แต่ float64 เก็บได้ ~15-16 → `12345678901234.5678` เคยลงเป็น `...4.568` **ด้วย input ที่ API รับอยู่แล้ว**
    ที่ยังไม่เคยพังจริงเพราะยังไม่มีใครลงรายการหลักหมื่นล้านขึ้นไป ไม่ใช่เพราะโค้ดกัน
  - ทางเข้าอื่นปลอดภัย: reversal ส่ง string เดิมจาก DB ต่อ, source posting แก้แค่ `accountId`,
    `JournalEntry` ไม่มีคอลัมน์ยอดรวม (สรุปยอดคำนวณสด) — จุดที่ float ลง Decimal จึงมีแค่ 2 บรรทัดนี้
  - Verification: `prisma-ledger.repository.spec.ts` (ใหม่ 2 tests) — mutation: คืน `parseFloat`
    → fail 2 พร้อมโชว์ drift จริง `12345678901234.5678 → 12345678901234.568`. ledger suite 178/178,
    typecheck ไม่มี error ใน `ledger`
  - Commit: `fix(ledger): post journal amounts at full precision`
- [x] **[R1] พบใหม่ 2026-08-10 — `validateJournalBalance` ตัดสินดุลผิดทั้งสองทาง — ✅ RESOLVED 2026-08-10**
  (`journal-balance.logic.ts`) ใช้ `parseFloat` + `Math.abs(dr-cr) < 0.0001` ซึ่ง tolerance = 1 ulp ของ
  Decimal(18,4) พอดี แต่ error ของการบวก float ที่ระดับ 1e13 ใหญ่กว่า tolerance เอง จึงพังสองทาง:
  - **false reject 1086/4000 (27%)** ของรายการที่ดุลเป๊ะและถูกต้องตาม DTO/คอลัมน์ พร้อม error ที่โชว์
    ยอดผิดทั้งสองข้าง: `159420246493.1018 + 10599731556750.1360 + 9698641791708.7330`
    `= 20457793594951.9708` แต่ฟ้อง `...9688 ≠ ...9727`
  - **false accept** — ที่ระดับเดียวกัน float แยก `...50.1360` กับ `...50.1361` ไม่ออก รายการที่เพี้ยน
    1 หลักสุดท้ายจริงจึงผ่านประตูเข้า GL ได้ (อันนี้อันตรายกว่า)
  - แก้: เปลี่ยนเป็น `decimal.js` ทั้งฟังก์ชัน (helper `decimal()` ทรงเดียวกับ `posting-engine.logic.ts`
    ในโฟลเดอร์เดียวกัน) **คงกติกา tolerance 0.0001 ไว้เท่าเดิม ไม่เปลี่ยน policy** — ทุก posting path
    ปล่อย 4dp อยู่แล้ว tolerance จึงแปลว่า "ต่างเป็นศูนย์" อยู่ดี. `deriveBalance` และ
    `buildReversalLines` ใช้ helper เดียวกัน แล้วลบ `n()` ทิ้ง
  - Verification: `journal-balance.logic.spec.ts` 15 tests (ใหม่ 3) — mutation: บวกผ่าน float อีกครั้ง
    → fail 2 (จับได้ทั้ง false reject และ false accept). brute force 4000 รอบ → false reject 0,
    false accept 0. ledger suite 181/181, typecheck ไม่มี error ใน `ledger`
- [R2] ใบเบิก approve แข่งกับ requester cancel — `beginApprovalDecisionAtomic` ไม่อ่าน `cancellationPendingAt` (ต่างจากทุก payment path) → claim approved มิด-cancel, projection ถูก void แล้ว

**ใบทดแทนใบเสร็จ [R1]**
- [x] เลขที่เอกสาร `SRC-<cuid>-V<n>` เสมอ + "เลขที่รายการ" พิมพ์ "-" — ✅ RESOLVED 2026-08-10:
  จองและ commit เลข `SRC-{YYYY}{MM}-{SEQ}` ผ่าน sequence กลางใน transaction เดียวกับ evidence,
  ใช้เดือนตามเวลาไทย และ retry idempotent ไม่กินเลขเพิ่ม; แบบพิมพ์ใช้ "เลขอ้างอิงรายการ" โดย fallback
  ไปเลขใบรับรองที่ค้นหาได้แทน `-`/internal cuid. Verify 30/30; commit `9933b52`.
- [x] Timestamp การเซ็น render UTC → เซ็นช่วง 00:00–06:59 พิมพ์วันที่ พ.ศ. ผิด 1 วัน — ✅ RESOLVED
  2026-08-10: renderer ใช้ Thai date formatter กลางที่ pin `Asia/Bangkok` สำหรับวันที่รายจ่าย/จ่าย/เซ็น
  ทั้งหมด; regression ครอบ payer และ approver หลัง 17:00 UTC. Commit `49269e1`.
- [x] Void expense ที่ confirm แล้วทิ้งใบรับรอง ISSUED ค้าง downloadable ไม่มีเครื่องหมายยกเลิก —
  ✅ RESOLVED 2026-08-10: true-reversal transaction เปลี่ยน issued evidence เป็น cancelled/superseded
  ด้วย machine reason `EXPENSE_VOIDED` และ void running number พร้อม expense; immutable SVG ต้นฉบับไม่ถูกแก้
  แต่ PDF ที่ derive ทุกหน้าประทับ `VOID`. เอกสาร version เก่าที่ถูกแทนยังดาวน์โหลดเพื่อ audit ได้โดยประทับ
  `SUPERSEDED` แทน (ปิด gap ใหม่ที่ UI มีปุ่มแต่ API เดิมตอบ 409). Expenses 450/450, web typecheck ผ่าน;
  commit `db8261a`.
- [x] Hub ซ่อนเอกสาร expense สาขา-กลาง (`branchId = null`) จากผู้ใช้ที่จำกัดสาขา — ✅ ALREADY
  RESOLVED ใน `6cfea99`: hub ใช้ `branchScopeWhere()` ตัวเดียวกับ expense list ซึ่งสร้าง
  `OR [branchId in assigned branches, branchId null]`; regression ยืนยันว่า branch/relation/month OR แยกกันใต้
  `AND` จึงไม่ทำให้ relation กว้างขึ้น. ยืนยันซ้ำใน expenses regression 450/450; ไม่มี code diff เพิ่ม.

**ตั้งค่า/feature toggle [R1]**
- ปิดฟีเจอร์/partner ไม่หยุด campaign/outbox/LINE ที่คิวไว้ (staged design ที่ยังไม่ flip)
- Duplicate active tax-branch-code เลี่ยงได้ผ่าน partial update (`update-branch.use-case.ts:51-63`)
- บริษัทเก่าที่ไม่มี entitlement row fail-open ทุกฟีเจอร์ (`entitlement.helper.ts:37-44`)
- ไม่มี CI ตรวจว่า `@RequirePermissions` ทุกคีย์มีจริง (ต้นเหตุ H-14)
- Business-policy ไม่มี audit, ไม่มี assertRouteCompany, role ปฏิบัติการเปลี่ยน discount ceiling ได้

**dashboard/noti/reports [R1] — 🟡 ปิด 4 ข้อ correctness แล้ว 2026-08-10 (ขอบเขต A: ไม่แตะ schema)**
- ~~`report_ready` เป็น FUTURE trigger → LINE suppress เสมอ, opt-in ไม่ได้, title/body อังกฤษ~~ ✅
- ~~Snapshot cache เสิร์ฟ period ก่อนหลัง rollover (23:50 "today" ถึง 00:05 แสดงยอดเมื่อวาน)~~ ✅
- ~~Cursor pagination `id<cursor` แต่ order by `createdAt` → ข้าม/ซ้ำข้ามหน้า~~ ✅ (3 query)
- ~~unread-count ดึงทุก row + join ทุก 60 วิ~~ ✅ เปลี่ยนเป็น `groupBy` ฝั่ง DB
- Tab "7 วันล่าสุด" snapshot ใช้ Mon-Sun แต่ CRM brief ใช้ trailing 7 วัน → tab เดียวแสดงสองช่วง (ยังไม่แก้)
- `dedupKey` ไม่มี `@@unique` → cron+on-demand สร้าง 2 OPEN event → LINE push ซ้ำ (**ต้อง migration**)

> **แก้ข้อ `dedupKey` ให้ตรง:** ใส่ `@@unique([companyId, dedupKey])` เฉย ๆ **จะพัง** เพราะ dedupKey
> ซ้ำได้โดยชอบ — `notification.use-cases.ts:218` สร้าง event ใหม่เมื่อของเดิม `status !== 'open'`
> (resolved แล้วเปิดใหม่) ต้องเป็น **partial unique index `WHERE status = 'open'`** + จัดการ P2002
> ซึ่งต้องมี migration และทดสอบจริงต้องมี PostgreSQL (ยังไม่มีในเครื่องนี้ — migration spec ก็ fail อยู่)

**เจอเพิ่มระหว่างแก้: trigger ที่ส่งไม่ได้อีก 11 ตัว** — preference gate default = `IMPLEMENTED_TRIGGER_KEYS`
ดังนั้น key ที่โมดูลยิงออกมาแต่ไม่อยู่ในลิสต์นั้นจะถูก drop ทุกครั้ง ไม่ใช่แค่ `report_ready`:
`workflow.daily_owner_summary` · `low_stock_alert` · `stockout_risk` · `vendor_bill_pending` ·
`vendor_bill_second_approval` · `tax_due_soon` · `bank_reconciliation_aging` · `overdue_invoice` ·
`crm_follow_up_due` · `crm_opportunity_stuck` · `sales_below_target` (ทั้งหมดจาก
`workflow-template-catalog.ts` ผ่าน `workflow-action-runner` → `notify.execute` เส้นเดียวกัน)

**ไม่เปิดให้เอง** เพราะย้าย key เข้า IMPLEMENTED = เปิด LINE push ชนิดใหม่ให้ทุกบริษัทโดย default
เป็น product decision ว่ามือถือเจ้าของร้านจะสั่นเรื่องอะไร ไม่ใช่การแก้บั๊ก — บันทึกเป็นลิสต์ใน spec
พร้อมเหตุผล ให้ลบทีละตัวตอนที่ตัดสินใจเปิด

Verify: `dashboard-notification-correctness.spec.ts` 8 tests · dashboard-notifications + reports +
workflow 280 ผ่าน 0 fail · api ทั้งชุด 4710 tests · `tsc` ไม่มี error ในไฟล์ที่แตะ
mutation ทั้ง 3 จุดพร้อมกัน → fail 4 (period check, cursor, report_ready + guard)
- Notification center ไม่มี pagination; dismissed เข้าถึงไม่ได้ ไม่มี undo
- Delivery log + retry มี API ไม่มี UI → LINE ที่ส่งล้มมองไม่เห็น
- DashboardSnapshot โตไม่จำกัด; unread-count ดึงทุก row + join ทุก 60 วิ; stockMovement.groupBy ทั้งประวัติบน request path
- Report OFFSET page-loop สแกนทั้ง dataset (O(N²)); ตัด 100 แถวไม่มี pager แต่ header โชว์ total
- [R2] AR Aging ไม่มี bucket, ไม่สนใจ `asOfDate`, เห็นแค่ `INVOICE`; Sales Summary นับแค่ `INVOICE` → ผู้ขายที่จด VAT เห็นยอดขาย ฿0

**LINE/AI [R1]**
- [x] **✅ RESOLVED 2026-08-10 — ปิดครบทั้ง 3 จุด พร้อม gap รอบข้าง**
  - Budget: เพิ่ม distributed Redis admission lease ต่อบริษัท/เดือนกรุงเทพ ล็อกตั้งแต่ live spend check
    จนบันทึก usage เสร็จ; request ที่ชนกันได้ `AI_BUDGET_BUSY` + retry window และ production fail-closed
    เมื่อ store หาย จึงเหลือ overshoot สูงสุดหนึ่ง action แทน N×cost
  - Bedrock: เปลี่ยน `Promise.race` เป็น SDK `abortSignal`; timeout ที่ไม่มี usage คิด token แบบ
    conservative 200k input + requested max output แทน 0 และ real usage ที่มีแล้วไม่ถูกทิ้งเมื่อ parser ล้ม
  - LINE media: อ่าน `Response.body` เป็น stream พร้อม running hard cap และ cancel ทันทีที่เกิน
    `uploadMaxBytes`; `Content-Length` เหลือเป็น early reject ไม่ใช่ security boundary
  - Impact/gap ที่ตรวจ: ครอบครบ 5 cost seams (LINE/OCR/intake, receipt, bank statement, CRM, AI draft),
    lease release ตรวจ owner token + crash TTL, pin เดือนเดียวกันตั้งแต่ lock/check ถึง ledger กันเคสข้ามเที่ยงคืน,
    draft contention อยู่ retry lane และไม่เรียก model
  - Verification: focused API + DI guard 131/131, AI Gateway 25/25, AI Gateway typecheck ผ่าน;
    API typecheck ไม่มี error จากข้อนี้และเหลือ baseline เดิม 14 จุดใน `substitute-receipt`/`reports`;
    boot smoke ถูกบล็อกก่อนถึง AI wiring โดย `PrismaExpenseRepository` index 1 จากไฟล์ dirty งานอื่น

**reimbursement [R1]**
- [x] **OWNER POLICY FOLLOW-UP — RELATED VIEW 2026-08-10:** เพิ่ม `reimbursement.read_related` แบบ
  universal + entitlement-gated ให้ requester/creator/updater/submitter, approver/decider, finance/cancellation/payment/void
  actor, claim signer, signed-copy linker และ actor ของ expense ที่ link/generate จากใบเบิก ดูเอกสารได้เฉพาะ tenant/branch
  ที่ตนรับผิดชอบ; linked-expense hop ตรวจ branch ซ้ำ ไม่ใช้ company อย่างเดียว
  - list/detail/ใบพิมพ์/LINE-AI ใช้ predicate เดียวกัน; แท็บเปลี่ยนชื่อเป็น "รายการที่เกี่ยวข้อง" และแสดงผู้ขอ
  - relation ไม่ให้ mutation: หน้าเว็บและ backend ยังตรวจ requester/assignee, action permission และ state แยกทุกครั้ง
  - gap ที่พบเพิ่มและแก้: finance queue กับ AI summary เคยไม่กรอง branch; การขยาย list เดิมจะทำให้ปุ่ม submit/cancel
    ของ draft คนอื่นโผล่; OR ของ branch/relation เสี่ยงชนกัน — ปิดครบและเพิ่ม actor indexes
  - gap เพิ่ม: role-template regression guard เคยตีความ `.read_related` เป็น write แล้วเรียกร้อง broad `.read` ทุก preset;
    แก้ classifier โดยไม่ผ่อน paired-read rule ของ mutation จริง
  - Verification: API 231/231, web 126/126, AI Gateway 87/87, contracts 12/12; web/AI typecheck,
    Prisma validate/generate ผ่าน; API เหลือ baseline 14 errors; migration ทั้ง 128 รายการ apply บน DB เปล่าสำเร็จ
  - Commit: `b5257cb fix(reimbursements): allow related actors to view claims`; concurrent branch-scope/expense changes
    ถูกแยกออกจาก staged snapshot และยังอยู่ใน working tree ตามเดิม
- Payment currency ไม่เทียบ currency ของ claim → จ่าย USD ปิด claim THB ได้
- Manager-path approval ที่ค้าง (projection ล้ม) หายจากทุกคิว, reconciler รันมือเท่านั้น
- ไม่มี return-for-edit/resubmit; REJECTED terminal, NEEDS_INFO ทางตัน
- List query ไม่มี take + paginate ในหน่วยความจำ

**procurement / AP — OWNER POLICY FOLLOW-UP [R1]**
- [x] เพิ่ม related-view แยก 5 key ตาม sub-feature: PR, PO, รับสินค้า, ใบวางบิล และการจ่ายผู้ขาย เพื่อให้ปิด
  submenu ใดแล้ว permission ของเอกสารชนิดนั้นถูก strip จริง ไม่รั่วผ่าน procurement child อื่น
- actor graph เดิน PR → PO → GR → Vendor Bill → allocation/payment ได้สองทิศจนครบ closure; ใช้ header actor,
  approval/successful audit history, matcher/override และ payment actor โดยกรอง company/branch ทุก hop และ **ไม่ถือว่า
  supplier เดียวกันคือ related**
- supplier master/bank, AP aging/statement, WHT, posting source และ mutation ทุกชนิดยังใช้ exact permission + actor/role
  + state; web เปิดเฉพาะ tab เอกสารที่เกี่ยวข้อง ส่วน LINE/AI ขยายเฉพาะ PO detail ไม่ขยาย summary/supplier search
- **gap ใหม่ที่พบและแก้พร้อมกัน:** list/detail และ mutation preload เดิมหลายจุดไม่ใช้ `ctx.scopes.branchIds` ทำให้ role
  จำกัดสาขาข้ามไปเห็น/แก้สาขาอื่นได้; ปิดครบทั้ง 5 family และกัน scoped create สร้าง company-central record เพื่อ bypass
- **gap integrity ใหม่:** สร้าง goods receipt เดิมไม่ตรวจ PO status/supplier/branch/line ownership จึงอ้าง line ของ PO อื่นได้;
  ตอนนี้ reject ก่อน persist
- **gap integrity ใหม่:** PO เดิมสามารถอ้าง PR ที่ยังไม่ approve/ถูก convert แล้ว/คนละ branch หรืออ้าง line ของ PR อื่น
  และสร้าง PO กับเปลี่ยน PR เป็น `CONVERTED` ไม่ atomic จึงแข่งกันสร้าง PO ซ้ำได้; ตอนนี้ตรวจ lineage ครบและ claim
  `APPROVED -> CONVERTED` ใน serializable transaction เดียวกับการสร้าง PO
- Verification: procurement specs 212/212, permission/feature/access/ERP-AI 125/125, LINE menu 16/16,
  web 100/100 และ AI Gateway 76/76 ผ่าน; contracts build, web/AI typecheck, Prisma validate/generate ผ่าน
  และ migration ทั้ง 129 รายการ apply บน DB เปล่าสำเร็จ (ตรวจ `_prisma_migrations` ครบ 129 ก่อนลบ DB ชั่วคราว)
  API typecheck ไม่มี error จากก้อนนี้และเหลือ baseline เดิม 14 จุดนอก scope
- Commit: `e718df7 fix(procurement): secure related document access`; consolidated file นี้ไม่ stage ตามข้อตกลง

**platform [R1]**
- ✓ DB pool/statement-timeout config ตาย: `new PrismaPg({connectionString})` เท่านั้น → pool default 10/task, ไม่มี statement timeout
- api-web supervisor exit ทันทีเมื่อ child ตัวใดตาย → ตัด SIGTERM drain ของ LINE buffer
- AI gateway ไม่มี shutdown hook/request-id middleware, `RATE_LIMIT_ENABLED` ตาย
- Health check ตรวจแทบไม่มีอะไร (readiness เช็คแค่ DB, workers health hardcode 200) → instance Redis ตายยังผ่าน ECS health
- Web ไม่มี CSP; ไม่มี interactive `$transaction` ในโค้ดฟีเจอร์เลย; audit หลัง commit หายได้แบบ log-only

> **REMARK (REVIEWER):** ข้อ “ไม่มี interactive `$transaction` ในโค้ดฟีเจอร์เลย” **ไม่จริงตาม source ปัจจุบัน** — พบใช้ใน
> onboarding, reports, CRM, feature-launch และ notifications หลายจุด. ควรเปลี่ยนเป็น finding ที่แคบและพิสูจน์ได้ เช่น
> “journal generate create→post→commit→markSource ไม่อยู่ใน transaction เดียว” ตาม H-7.

**i18n / error UX [R2] — 🟡 ปิดครึ่งแรกแล้ว 2026-08-10 (ขอบเขต launch)**
- ~~error code ไม่มีข้อความไทย → ผู้ใช้เห็น snake_case ดิบ; upload error ยุบเป็น "ระบบขัดข้อง" ก่อนถึงตัวแปล;
  429/503 ไม่มี fallback ไทย~~
- ตัวเลขจริงตอนวัดใหม่คือ **383 code มีไทย 56** (audit เขียน 165/190 เพราะนับเฉพาะบางโมดูล)

**ทำแล้ว** — เลือกขอบเขตเป็น 11 ฟีเจอร์ที่จะเปิด ไม่ใช่ทั้ง 383 เพราะ**คำแปลผิดแย่กว่าไม่แปล**
(ส่งผู้ใช้ไปแก้ผิดที่) แปลจากการอ่าน guard จริงทีละตัว ไม่ได้เดาจากชื่อ code:

- **+87 code** ในโมดูล expenses · reimbursements · employee-access · auth · data-model-core ·
  system-partner-management → **launch modules ครบ 100%** (รวมทั้งระบบ 56 → 143)
- **upload**: เดิม `uploadErrorMessage` ทิ้งคำตอบจาก server ทุกกรณีก่อนถึงตัวแปล ไฟล์ที่ถูกปฏิเสธถาวร
  (PDF มี active content, malware scan) กับ blip ชั่วคราวจึงอ่านเหมือนกัน และข้อความชวนให้กดซ้ำ
  ด้วยไบต์เดิม — อาการเดียวกับ CR-10 ตอนนี้ส่งเข้า `translateApiError` ก่อน (ทั้ง code และ message
  เพราะ `withGenericUploadError` ห่อ error ใหม่ทำให้ code หาย) + แปลข้อความ upload 20 แบบ
- **status fallback**: เพิ่ม 413/429/502/503/504 เดิมตกเป็น `API error 429` ดิบ

**ยังไม่ทำ — หน้าจอเอกสารบัญชี 32 สตริง** (`AccountingPages.tsx` มี `t()` แค่ 4 ที่ ปุ่มยังเป็น
Issue/Approve/Reject/Void) จงใจเลื่อน: CR-8/CR-9 ระบุว่าหน้านี้ยังออกใบกำกับภาษีที่ถูกต้องไม่ได้อยู่แล้ว
(ไม่มีผู้ซื้อ ไม่มี PDF) แปลตอนนี้เสี่ยงเสียเปล่าถ้าหน้าจอถูกรื้อ · อีก 240 code นอก launch ยังตกไปเป็น
ข้อความเดิมของ server ซึ่งอังกฤษแต่ยังอ่านรู้เรื่องกว่า snake_case

Verify: `api-error-coverage.spec.ts` 9 tests — guard อ่าน code จาก API source เองไม่ได้ hardcode
รายการ (เพิ่ม code ใหม่ใน launch module โดยไม่ใส่ไทย = เทสแดง) + เช็คว่าข้อความ**บอกว่าต้องทำอะไร**
และไม่มี snake_case หลุดออกมา · web ทั้งชุด 884 tests ผ่าน 0 fail · `tsc` clean
mutation: ลบคำแปล 1 ตัว → fail 2

**onboarding bootstrap [R2]** — ตรวจกับโค้ดใหม่ 2026-08-10 แล้วคัดตาม launch scope จริง

**ขอบเขตที่จะเปิดจริง (เจ้าของยืนยัน 2026-08-10):** เบิก + บิลใบเสร็จ + ใบทดแทนใบเสร็จ. **บัญชี "เปิดครึ่ง"**
— ซ่อน UI จากผู้ใช้ แต่ ledger core และการบันทึกสถานะ posting ทำงานปกติ (ตรงกับ CR-3 owner decision และกับ
comment ใน `expense-account-binding.use-case.ts:15`). นี่คือเกณฑ์ที่ใช้คัดข้อล่างทั้งหมด

- [x] **expense category ตั้งต้น — ✅ RESOLVED 2026-08-10.** (เอกสารเดิมเขียน "11 หมวด" — ไม่มีลิสต์นี้ใน spec
  ที่ไหน เป็นการประมาณของผู้ตรวจ; ที่มีจริงคือ 6 หมวดใน `seed.ts:978`)
  - **หนักกว่าที่ finding เขียนไว้มาก** เพราะพังพร้อมกัน 3 ทางในของที่จะเปิด:
    1. **ใบทดแทนใบเสร็จออกไม่ได้เลย** — `substitute-receipt.use-case.ts:155` throw ตรง ๆ
       `'A reviewed expense category or account hint is required.'` และหมวดถูกพิมพ์ลงบนตัวเอกสารด้วย (`:192`)
    2. **AI/OCR จัดหมวดไม่ได้** — เลือกได้เฉพาะหมวดที่ตั้งค่าไว้ สร้างเองไม่ได้
       (`expense-receipt-upload-spec.md:27`) แคตตาล็อกว่าง = ไม่มีที่ให้ลง ทั้งที่ `ai_line_assistant` เปิด
    3. **หนี้เงียบสะสม** — ทุกใบที่ยืนยัน stamp `postingStatus: 'pending'` (`prisma-expense.repository.ts:320`)
       รอ backfill ที่จะ fail ทั้งกองด้วย `expense_account_unmapped:no_category` (`expense-backfill.use-case.ts:247`)
       เพราะ UI ซ่อน จึงไม่มีใครเห็นระหว่างทาง และระเบิดพร้อมกันทั้งประวัติวันที่เปิดบัญชี
  - แก้: seed 12 หมวดตอน onboarding **ตัดตามพฤติกรรมภาษี ไม่ใช่ประเภทค่าใช้จ่าย** (ผังบัญชีมีบัญชีค่าใช้จ่าย ~75 ตัว
    ลอกมาหมดคือโยนปัญหาจัดหมวดกลับให้ผู้ใช้) — ค่ารับรองแยกจากค่าอาหาร (ภาษีซื้อต้องห้าม vs ขอคืนได้),
    ค่าขนส่งแยกจากค่าเดินทาง (ยกเว้น VAT vs ขอคืนได้)
  - **owner decision 2026-08-10:** ผูก `ledgerAccountCode` ให้เลย แต่ยังตั้งเป็นรอรีวิว → เพิ่มคอลัมน์
    `ledgerAccountReviewedByUserId` stamp `system:expense-category-bootstrap` ใช้ seam เดียวกับ
    `TAX_CONFIG_BOOTSTRAP_ACTOR_USER_ID`. posting ทำงานตั้งแต่ใบแรก, route ผูกบัญชีรายงานเป็น
    `awaitingHumanReview`, คนตั้งบัญชีจริงเมื่อไหร่ sentinel ถูกแทนด้วย user id.
    ผลข้างเคียง: `ledgerAccountCode: null` ใช้เป็นสัญญาณ "ยังไม่รีวิว" ไม่ได้อีก — comment ใน schema แก้แล้ว
  - **แก้ข้อผิดพลาดของการวิเคราะห์รอบแรก:** tax code `V1`/`VX`/`N1`/`U1` เป็นของ **SAP reference template**
    ที่ติด warning `"Reference template only"` ไม่ใช่ profile ที่ onboarding ติดตั้ง. profile จริง
    (`WATCHDOG_TH_DOMESTIC_EXPENSE_V1` = "WatchDog ภาษีซื้อในประเทศ") มี **2 code เท่านั้น**: `V7` ขอคืนได้ 7%,
    `ND` ขอคืนไม่ได้ 7%. เทสที่เทียบ catalog กับ profile จริงจับได้ก่อน commit — ไม่งั้นจะ ship code ที่ไม่มี
    ในบริษัทไหนเลย. remap: `ND`→ค่ารับรอง, `V7`→7 หมวดที่ขอคืนได้, **ไม่ใส่เลย**→ยกเว้น VAT
    (ค่าเช่า/ค่าขนส่ง/ค่าธรรมเนียมธนาคาร) และเบ็ดเตล็ด เพราะ `ND` จะกลายเป็นการอ้างว่ามีการเรียก VAT ทั้งที่ไม่มี
  - Verification: `expense-category-bootstrap.service.spec.ts` 6 tests — 2 ตัวเทียบ catalog กับ `TH_SME_COA_V1`
    และ tax profile จริง ทำให้บัญชี/tax code ที่ผิดพังตอน build ไม่ใช่ตอนลูกค้า onboard. onboarding + expenses +
    ledger 668/668, typecheck baseline เดิม, Prisma validate ผ่าน. **migration ยังไม่ได้ apply** — เครื่องที่ทำงาน
    ไม่มี PostgreSQL ให้ต่อ ตรวจได้แค่ชนิดคอลัมน์ตรง convention ของ migration เดิม **ต้องรันบน DB จริงก่อนขึ้น**
  - Commit: `a29d46c feat(onboarding): seed the expense categories a Thai company needs on day one`
- [ ] **EmployeeAccessProfile ของเจ้าของ — ยังไม่แก้ ไม่บล็อก launch.** `list-employees.use-case.ts:11` อ่านจาก
  `employeeAccessProfile.findMany` อย่างเดียว เจ้าของไม่มีแถวจึงไม่ปรากฏในรายชื่อ. **ไม่กระทบเบิก** — ยืนยันแล้วว่า
  โมดูล reimbursement ไม่อ้าง `EmployeeAccessProfile` เลยสักที่ อนุมัติวิ่งผ่าน membership/role. เหลือผลแค่
  เจ้าของจัดการตัวเอง (status/credential/LINE link) จากหน้าพนักงานไม่ได้ — ประชดที่ comment ใน `feature-registry.ts`
  เขียนเองว่าเปิด `employee_access` ไว้ "เพื่อให้บริษัทใหม่เพิ่มพนักงานคนแรกได้"
- [ ] **`approverMode` ไม่มีผลนอก `CUSTOM_USER` — ยังไม่แก้ ไม่บล็อก launch.** reader เดียวคือ
  `reimbursement-request.use-case.ts:333`; `MANAGER_ROLE` (ค่า default) → `undefined` → ใบเบิกไม่ถูก assign
  ผู้อนุมัติอัตโนมัติ. ตัวที่ยังคุมจริงคือ `approvalRequiredFromAmount` + `allowSelfApproval` จึงเป็นเรื่อง
  **routing ไม่ใช่รูรั่วสิทธิ์**
- [x] **`WhtIncomeCategory` — ปิดเป็น OUT_OF_SCOPE 2026-08-10 (ไม่ต้องแก้โค้ด).** สองเหตุผลอิสระ:
  1. **กรอบเดิมผิด** — เป็น master data ระดับระบบ (`@@unique([code])` ไม่มี `companyId`) onboarding ต่อบริษัท
     ไม่ควรสร้างอยู่แล้ว. ที่จริงคือ "ไม่มี endpoint สร้าง" (`wht-income-category.use-case.ts:32` มีแต่ `update`,
     แถวมาจาก `seed.ts:3215` ที่เดียว) → เป็นเรื่อง **ตรวจว่า production seed ไปหรือยัง** ไม่ใช่บั๊กโค้ด
  2. **ไม่กระทบ launch scope** — โมดูล expenses ใช้ `whtRate`/`whtAmount` เป็น**ตัวเลขบนบรรทัด** ไม่แตะตาราง
     `WhtIncomeCategory` เลย. consumer จริงอยู่ที่ `tax` (ออก 50 ทวิ) และ `procurement` ซึ่ง**ไม่เปิด**
- [x] **PO approval threshold — เอกสารเดิมผิด ปิด 2026-08-10.** procurement `dualApprovalThresholdAmount`
  **ถูกอ่านจริง** ที่ `vendor-bill.use-case.ts:449,474-480` ทำงานอยู่ (และ procurement ไม่เปิดรอบนี้อยู่แล้ว)
- [ ] **discount policy ไม่มีใครอ่าน — จริง ไม่กระทบ launch.** `DiscountPolicy` มีแค่ validate/เก็บ/คืนค่า
  ไม่มี consumer; `PoApprovalPolicy` ใน business-policy ก็ไม่มี consumer เหมือนกัน. ทั้งคู่เป็นของ
  `sales_documents`/`procurement` ที่ไม่เปิด
- [ ] **พบใหม่ — `ReimbursementPolicy` มีคอลัมน์ threshold ซ้ำสองตัว.** `approvalRequiredFromAmount` คือตัวที่
  ประตูอ่านและ web เขียน (ทำงานถูก) ส่วน `approvalThresholdAmount` เขียนได้/คืนค่าได้แต่**ไม่มีใครอ่าน** — เป็น
  คอลัมน์ตายที่ล่อให้ integration ตัวถัดไปเขียนผิดช่อง ไม่กระทบวันนี้เพราะ web เขียนตัวที่ถูก

> **REMARK (สองรอบเห็นต่างเรื่องขอบเขต bootstrap):** รอบ 1 ระบุ NotificationRule เป็นสิ่งที่ onboarding ไม่สร้าง (H-12).
> รอบ 2 ตรวจ Day-0 ครบแล้วยืนยันว่า onboarding **สร้าง** chart of accounts, tax profile, entitlement, workflow template
> ให้จริง (รูรั่วแคบกว่าที่กังวล) แต่ **ไม่สร้าง** อีกหลายอย่างข้างต้น. ทั้งสองรอบไม่ขัดกัน — รอบ 2 แค่ระบุขอบเขตให้ครบ.
> **รอบ 3 (2026-08-10)** เพิ่ม expense category ตอน onboarding ทำให้ข้อที่หนักที่สุดปิด ที่เหลือคัดแล้วว่าไม่บล็อก launch

> **ต้องยืนยันก่อนเปิด — ไม่ใช่เรื่องโค้ด:** `DEFAULT_ENABLED_FEATURE_KEYS` (`feature-registry.ts:27`) เปิด
> `thai_tax` `double_entry_ledger` `workflow_automation` ให้ทุกบริษัทที่ onboard ใหม่ พร้อม comment อ้าง
> *"owner decision 2026-08-04: a Thai SME buys the tax/accounting journey"*. ถ้าเจตนาคือซ่อน UI แต่ให้ core
> ทำงาน (ตามที่ยืนยัน 2026-08-10) ค่านี้ถูกอยู่แล้ว — แต่ควรยืนยันว่า **เมนูบัญชี/ภาษีไม่โผล่ให้ผู้ใช้เห็นจริง**
> เพราะ entitlement ที่เปิดคือสิ่งที่ตัดสินเมนู

---

## 9. LOW / หมายเหตุ

- [R1] นโยบายรหัสผ่านใหม่วัดแค่ความยาว ≥8 → ตั้ง `11111111` ได้ (ลดทอน mitigation ของ H-1)
- [R1] Disable พนักงานไม่ revoke session (บรรเทาโดย ACTIVE-membership check ต่อ request) — re-enable ใน 7 วันชุบ token เก่า
- [R1] Login แยก "รหัสถูกแต่ไม่มีบริษัท" (403) จากรหัสผิด (401) — oracle เล็กน้อย
- [R1] ✓ Thai baht text ตก "เอ็ด" ข้ามหลักล้าน (`1000001 → "หนึ่งล้านหนึ่งบาทถ้วน"`) — spec ล็อกค่าผิด
- [R1] ใบทดแทน: catch-all ห่อ error เป็น 409 ทิ้ง code, web พึ่ง match ข้อความอังกฤษ; PDF gen บน request path
- [R1] PII (payeeName/address/taxId) ใน query string ของ voucher PDF → เข้า access log
- [R1] Dead code: `confirmExpenseCas`, reimbursement legacy repo methods, `shouldResolveAlert`
- [R1] Web hardcode AI model list vs server env; onboarding "module package" ตาย; platform-foundation status = mock; AI-budget cache invalidation single-process
- [R2] Thai/emoji filename ดาวน์โหลดเป็น mojibake (ไม่มี RFC 5987 `filename*`); local storage ไม่ส่ง Content-Disposition
- [R2] LINE replay dedup เสียบน text path ถ้า LINE ไม่ส่ง `webhookEventId` (media path ปลอดภัย); bank statement rows ไม่ได้ OCR cross-check เท่าใบเสร็จ

---

## 10. สิ่งที่ทำได้ดี (ยืนยันแล้ว)

- **AuthZ [R1]:** deny-by-default guard, ไม่มี unguarded mutation, ไม่มี self-escalation, IDOR/last-owner ป้องกันแน่น, refresh reuse revoke ทั้ง family, permission resolve จาก DB ทุก request (revoke มีผลทันที)
- **Multi-company isolation [R2] ✓:** เปิด 2 tab คนละบริษัทไม่ปนกัน — company id เดินใน URL ของแต่ละ request, ไม่มี state ร่วม/cookie บริษัท, สลับบริษัทเป็น full page load
- **LINE/AI boundary [R1/R2]:** signature verify timing-safe ก่อน parse, prompt-injection containment, one-time HMAC delegation token, permission re-resolution ฝั่ง API, gateway ไม่มี DB, AI output เป็น draft เสมอ; พนักงานที่ถูก disable สั่งงานผ่าน LINE ไม่ได้ (fail-closed 2 ชั้น)
- **ไม่พบ fail-open security control เลย [R2]:** rate limit / AI budget / delegation replay fail-closed ทั้งหมด
- **feature-launch/entitlement control plane [R1]:** commandId idempotency, CAS, advisory-lock order เดียว, fail-closed absent-row, deploy bootstrap override human CLOSE ไม่ได้, HIGH/CRITICAL audit ครบ
- **money & schema [R1]:** Decimal เกือบทั้งหมด (Float แค่ 2 = AI confidence), 296 companyId index + 120 unique, void = true reversal Serializable + period lock, upload MIME+magic-byte+quota+tenant-prefixed S3, Dockerfile digest-pin, `validateProductionConfig` เข้มจริง
- **reimbursement double-approve [R2] ✓:** advisory lock + updatedAt CAS + snapshot hash + diff dialog — จัดการ concurrent approve ได้ถูกต้องที่สุดใน repo

> **REMARK:** รอบ 1 เคยจัด "reimbursement core: self-approval บล็อก" ไว้ที่นี่ด้วย — ย้ายออกแล้ว (ดู H-17): กลไก
> concurrency ถูกต้อง แต่การบล็อก self-approval โดยไม่มีข้อยกเว้นบริษัทเล็กเป็น gap ไม่ใช่จุดแข็ง.

> **REMARK (REVIEWER):** ตัดคำว่า “ไม่พบ fail-open security control เลย” หรือจำกัดเฉพาะสาม control ที่ตรวจจริง เพราะ
> เอกสารเดียวกันระบุ entitlement zero-row fail-open ที่หมวด Medium. Absolute positive statement นี้ขัดกับ finding ภายในเอกสาร.

---

## 11. ลำดับการแก้ที่แนะนำ

> **REMARK (ลำดับรอบ 2 แทนรอบ 1):** รอบ 1 จัด P0 ไว้ที่ redis/DOB-password/branch-scope/LINE-credential. รอบ 2
> เพิ่มคลัสเตอร์การลงบัญชี (CR-2..CR-11) ที่ใหญ่กว่ามากขึ้นมาก่อน เพราะเป็น core deliverable. ลำดับด้านล่างคือฉบับรวม.

> **REMARK (REVIEWER OVERRIDE):** อย่าใช้ P0 ด้านล่างตามลำดับเดิมจนกว่าจะ reconcile สถานะ: เอา CR-1 ออกจาก blocker,
> เปลี่ยน H-1 เป็น accepted risk, ลด CR-10 เป็น evidence-needed และอย่าพอร์ต H-17 role exemption โดยไม่มี product decision.
> เพิ่ม build hang, worker version skew และ live LINE→AI journey เป็น release evidence ที่ต้องปิด.

**P0 — ต้องมีก่อนมีลูกค้าจริงใช้บัญชี**
0. **Launch scope ตัดสินแล้ว 2026-08-09:** ไม่เปิด accounting UI แต่ต้องเก็บ hidden ledger. ห้ามปิด
   `double_entry_ledger` ทั้งก้อน; ให้แยก UI visibility ออกจาก ledger core และเปิด `expense_auto_post`/background posting
   สำหรับ source ที่อยู่ใน scope.
   **✅ ส่วน UI ทำแล้ว** — ซ่อนเมนู "สมุดรายวัน"/"รอบบัญชี" และปุ่ม "ลงบัญชี" โดยไม่แตะ entitlement
   (ดู [สถานะการแก้ 2026-08-09](#สถานะการแก้-2026-08-09)) **ยังเหลือ:** เปิด `expense_auto_post`/background path
   ซึ่ง**ต้องทำหลังข้อ 1** ไม่งั้นได้ `posting_error` ทุกใบแบบไม่มีใครเห็น
1. CR-2 สร้างเส้นทางสร้าง/อนุมัติ PostingRule — ปลดล็อกทุกอย่างในคลัสเตอร์บัญชี
   > **แก้ข้อเสนอเดิม (ตรวจโค้ดลึก 2026-08-09):** ทางเลือก *"หรือปล่อย fallback ทำงานเมื่อไม่มีกฎ"* ที่เคยเขียนไว้ตรงนี้
   > **ผิดและถูกถอนออก** — `DEFAULT_ACCOUNT_CODES` ตรงกับผัง TH_SME_COA_V1 แค่ 2 ใน 10 รหัส: `1210-00` ในผังคือ
   > **ลูกหนี้เงินให้กู้ยืม** ไม่ใช่ลูกหนี้การค้า และ `5310-01` คือ **เงินเดือน** → ปล่อย fallback = ค่าใช้จ่ายทุกใบกลายเป็น
   > เงินเดือน และลูกหนี้การค้าไปกองในบัญชีเงินให้กู้ยืม. guard `requiresReviewedPostingRules` **ถูกต้องและต้องคงไว้**
   > รายละเอียดเทียบรหัสครบ 10 ตัวอยู่ใน `docs/agent-memory/cr-2-posting-rule-writer.md`
2. CR-3 **ไม่ทำ accounting UI รอบนี้**; ทำ hidden auto-post สำหรับ expense/reimbursement, ซ่อน UI และพิสูจน์
   idempotent/atomic journey — คู่กับ H-7 และ H-28
3. CR-4 งบดุลสะสมยอดยกมา + โอนกำไรเข้าทุน
4. CR-7 ใส่ `{BRANCH}` ใน template หรือทำ sequence เป็น company-wide
5. ~~CR-10 จำกัด regex สแกน PDF~~ — ✅ **RESOLVED 2026-08-10** (ตัด stream payload ก่อน match)
6. CR-11 ใส่ขอบเขตปีใน `isCivilDate` (ปิดตระกูล พ.ศ. เกือบหมดด้วยบรรทัดเดียว)
7. ~~CR-1 สร้าง encrypted Redis + secret ARN ใหม่ + สคริปต์ bootstrap prod~~ — ✅ **RESOLVED 2026-08-09**
8. H-1 initial credential หมดอายุ + เลิกใช้วันเกิด · H-2 branch scope บน reimbursement · H-14 permission `shared_line_credential.manage`

**P1 — ก่อนเปิดฟีเจอร์ที่เกี่ยวข้อง**
9. CR-8/CR-9 เก็บผู้ซื้อ+ผู้ขายครบตาม ม.86/4 แล้วทำ PDF ใบกำกับภาษี
10. CR-6 ต่อ worker/ปุ่มลงบัญชีรายรับ+เบิกจ่าย — **ต้องแก้ H-28 (`linkedExpenseId`) พร้อมกัน** ไม่งั้นลงบัญชีซ้ำระเบิด
11. H-6 VAT ฝั่งรายรับเป็น Decimal ROUND_HALF_UP · H-8 row-lock/idempotency บน payment
12. H-4 สิทธิ์หน้าเซ็นใบทดแทน · H-17/H-19 พอร์ต `SELF_APPROVAL_EXEMPT_ROLES` + แก้ `roleKeyFromName` รองรับชื่อไทย
13. CR-12/CR-13 ทำเส้นทาง amendment ให้มีจริง หรืออย่างน้อยบันทึก issue ทุกเส้นทาง sync
14. H-12/H-13 seed NotificationRule + stock alert re-deliver · H-15 dashboard_notifications เข้า PLATFORM_INVARIANT หรือทำ fallback route
15. H-25 idempotency ของ inventory จาก client key · ~~H-3 CF client-IP~~ — ✅ **RESOLVED 2026-08-10**

**P2 — ตามหลังได้ แต่ควรมีก่อนโหลดจริง**
16. H-21 เติม period guard ที่เหลือ · H-23 164 body ที่ไม่ validate · H-24 tax ID server validation · H-26 PO concurrency
17. error message ไทย (165 code) · i18n หน้าเอกสารบัญชี · timezone ฝั่งเว็บ
18. H-29/H-30 e2e เข้า CI, workers SIGTERM + DLQ, DB pool/statement timeout
19. Medium ด้าน date/period timezone, optimistic concurrency, unbounded query/pagination
20. โหลดเทสต์ที่ UAT (ยังไม่เคยมีเลย) ก่อนเปิด user

**หมายเหตุกระบวนการ (จาก launch memory):** "deploy เขียว ≠ ระบบใช้งานได้" — เส้นทาง AI เคยตายทั้งเดือนโดยเครื่องมือทุกตัว
รายงาน success. ทุกฟีเจอร์เรือธงควรมี smoke test ที่เรียกจริงแล้วล้มทำให้ deploy ล้มด้วย ไม่ใช่แค่ health เขียว.

---

## 12. วิธีตรวจของสองรอบ

| รอบ | แนวทาง | จุดแข็ง | เจออะไรที่อีกรอบไม่เจอ |
|---|---|---|---|
| 1 (module audit) | deep-read รายโมดูล 8 สาย | ครบทุกโมดูล, จับ security/config ละเอียด | DOB password, branch scope, VAT float, dead config, LINE credential |
| 2 (use-case journey) | เดิน 8 use case จริง end-to-end | จับความพังตรงรอยต่อระหว่างโมดูล | คลัสเตอร์บัญชีทั้งหมด (CR-2..CR-13), เอกสารภาษี, ปี พ.ศ., PDF scanner, บริษัทเล็ก dead-end |

use case ที่รอบ 2 ใช้: Day-0 บริษัทใหม่ · LINE→เบิกจ่าย · ปิดงวด+ยื่นภาษี · เจ้าของคนเดียว · พนักงานลาออกมีงานค้าง ·
ขายของ-ออกใบกำกับภาษี · หลายบริษัท+toggle · วันที่ทุกอย่างพัง.
