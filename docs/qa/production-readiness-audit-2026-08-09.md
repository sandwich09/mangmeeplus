# Production Readiness Audit — ทั้งโปรเจค, 2026-08-09

ผู้ตรวจ: Claude (8 สาย deep-read ขนาน + verify finding ระดับ Critical/High ด้วยตนเองทุกข้อ). Branch `develop`.
ขอบเขตตามที่เจ้าของสั่ง: dashboard, รายรับรายจ่าย, ใบทดแทนใบเสร็จ, พนักงาน, ตั้งค่า, สิทธิ์, รายการเบิกจ่าย, การเปิดปิดฟีเจอร์, LINE, AI, noti — ทั้ง functional และ non-functional.

`✓` = ผู้ตรวจไล่โค้ดยืนยันเองแล้ว (ไม่ใช่แค่รายงานจาก sub-agent).

---

## 0. คำตัดสิน (verdict)

ระบบมี **ฐานสถาปัตยกรรมที่ดีมาก** — deny-by-default guard, per-request permission resolution, tenant scoping มีวินัย, money = Decimal เกือบทั้งหมด, LINE/AI boundary (signature verify, prompt-injection containment, one-time delegation token, permission re-resolution ฝั่ง API) แน่นหนาระดับ production, control plane ของ feature-launch/entitlement เข้มงวดจริง.

แต่ **ยังไม่ควรเปิดใช้งานจริงกับผู้ใช้** จนกว่าจะปิด blocker ด้านล่าง มีทั้ง:
- **1 Critical** (ระบบบูตไม่ขึ้นวันนี้)
- **~13 High** — มีทั้งช่องความปลอดภัย (รหัสผ่านเริ่มต้น = วันเกิด, branch-scope หลุดบนการจ่ายเงิน), ฟีเจอร์ตายเงียบ (alert สต็อก/สรุปรายวัน, console LINE credential, การเซ็นใบทดแทน), และความถูกต้องบัญชี (VAT ปัดเศษผิด, race การจ่ายเงิน, journal DRAFT ถูกนับว่า posted)
- Medium/Low อีกจำนวนมาก (รายละเอียดในหมวด 4–5)

จุดที่อันตรายที่สุดสำหรับ "ผลิตภัณฑ์บัญชี": **สอง engine คำนวณ VAT ให้ผลต่างกัน 1 สตางค์** และ **journal ที่ค้าง DRAFT ถูกรายงานว่าลงบัญชีแล้ว** — ทั้งคู่ทำให้ตัวเลขบนงบไม่ตรงโดยที่ UI บอกว่าสำเร็จ.

---

## 1. Critical (บล็อกการขึ้น prod)

### C1. Production บูตไม่ขึ้นวันนี้ — secret `redis-url` ชี้ Redis cluster ที่ถูกลบไปแล้ว
- หลักฐาน: `docs/runbooks/cloud-environment-operations.md:109-121` — secret `watchdog-bms/production/redis-url` ชี้ endpoint ของ Redis ที่ลบไปแล้ว, ไม่มีสคริปต์ bootstrap ของ prod ใน repo, capacity ยัง 0 (ไม่เคย deploy สำเร็จจริง). M-17 กำหนดว่า prod Redis ต้องเป็น encrypted replication group ไม่งั้น `infra/security/verify-production-security-baseline.sh` fail-closed.
- Impact: task ขึ้นมาแล้วต่อ Redis ไม่ติด → auth/AI bucket fail-closed เป็น 503. ต้องสร้าง encrypted Redis replication group ใหม่ (at-rest+transit, auth token, ≥2 nodes, snapshot 35 วัน), อัปเดต secret ARN, แล้ว redeploy (ARN ฝังใน task def ผ่าน `valueFrom` — แค่คืน capacity ไม่พอ) + เขียนสคริปต์ bootstrap prod ที่ยังไม่มี.

---

## 2. High — ความปลอดภัย

### H1. ✓ รหัสผ่านเริ่มต้นของพนักงานใหม่ = วันเกิด (DDMMYYYY) และ **ไม่มีวันหมดอายุ**
- หลักฐาน: `employee-access.logic.ts:84` `employeePasswordFromDateOfBirth` คืน `DDMMYYYY`; `create-employee.use-case.ts:119,147-148,279-280` เขียน credential ด้วย `mustChangePassword:true` แต่ `expiresAt:null`; `password-login.use-case.ts:43` ปฏิเสธเฉพาะเมื่อ `expiresAt && expiresAt<=now` → null ไม่มีวันหมด; `auth.guard.ts:19,107` ยกเว้น `/v1/auth/` จากการบล็อก must-change-password.
- Impact: พนักงานใหม่ที่ membership ACTIVE แล้วแต่ยังไม่ล็อกอินครั้งแรก ใครที่รู้/เดาวันเกิด (เพื่อนร่วมงาน, HR, บัตรประชาชน, โซเชียล) ล็อกอินได้ แล้วเรียก `POST /auth/password/change` (ทุก role มีสิทธิ์) ยึดบัญชี. ต่างจาก path admin-reset (`regenerate-employee-credential.use-case.ts:45-47`) ที่ใช้สุ่ม 9 ไบต์ + หมดอายุ 72 ชม. — credential เริ่มต้นอ่อนกว่ามาก. **แก้:** ให้ initial credential หมดอายุ (เช่น 72 ชม. เหมือน regenerate) และ/หรือใช้ค่าสุ่มส่งผ่าน LINE link แทนวันเกิด.

### H2. ✓ Reimbursement — branch scope (ABAC) ไม่ถูก enforce บนการจ่ายเงิน/void และ finance queue
- หลักฐาน: `reimbursement-finance.use-case.ts` — `isBranchInScope` ปรากฏแค่บรรทัด 86 (finance-review) เท่านั้น; `RecordReimbursementPaymentUseCase` (288-375) และ `VoidReimbursementPaymentUseCase` (449-505) **ไม่มี** branch check เลย; `ListFinanceQueueUseCase` (55-67) คืน claim ทุกสาขา ขณะที่ approval queue filter สาขา (`reimbursement-approval.use-case.ts:73`). ทุก path อื่นที่แตะเงิน (approve/reject/cancel/finance-review) มี check ครบ.
- Impact: ผู้ใช้ที่ถูกจำกัดสาขาแต่มี `reimbursement.payment.record`/`payment.void` จ่ายหรือกลับรายการ claim ของสาขาอื่นได้ — ทะลุขอบเขตที่ทั้งโมดูลบังคับไว้ทุกที่บนการตัดสินใจเรื่องเงิน.

### H3. ✓ Cloudflare ทำให้ per-IP rate limit / login throttle ยุบรวมเป็นไม่กี่ key
- หลักฐาน: `trusted-client-ip.ts:28-30` ใช้ XFF **hop สุดท้าย**; เส้นทาง prod คือ browser → CF Worker (`infra/cloudflare/mangmee-host-proxy.worker.js`) → ALB → proxy(127.0.0.1) ดังนั้น hop สุดท้ายที่ API เห็นคือ IP ขาออกของ Cloudflare ไม่ใช่ผู้ใช้. `api-ip` bucket 120/60s + `PASSWORD_LOGIN_MAX_PER_IP` 20/15min (`packages/config/src/index.ts:180-181,228`). `TRUST_PROXY` มีใน schema แต่ไม่ถูกอ้างที่ไหนเลย.
- Impact: ทราฟฟิกไทยที่ออกจาก CF colo เดียวกันแชร์ bucket เดียว → lockout ผู้ใช้ทั้งฐานได้ ขณะที่ผู้โจมตีหมุน colo เจือจาง throttle. ถูกต้องสำหรับ direct-to-ALB แต่ผิดพอดีบนโดเมนที่ประกาศใช้จริง. **แก้:** ข้าม trusted hop เพิ่มอีกชั้นสำหรับ CF (หรือใช้ `CF-Connecting-IP`).

### H4. ✓ ใบทดแทนใบเสร็จ — payer ที่ไม่มี `expense.review` เปิดหน้าเซ็นไม่ได้ (ทำลาย two-person rule)
- หลักฐาน: notification deep-link ชี้ wizard (`substitute-receipt.use-case.ts:243`); wizard โหลดด้วย `Promise.all([getExpense, listSubstituteReceiptHistory])` (`SubstituteReceiptWizardPage.tsx:663-666`) และ `catch` เดียวทำทั้งหน้าพัง; แต่ history endpoint บังคับ `@RequirePermissions('expense.review')` (`expense.controller.ts:256`) + use-case โยน 403 ซ้ำ (`substitute-receipt.use-case.ts:735`). Payer เป็นสมาชิก active คนใดก็ได้ แต่ role SALES/STAFF/INVENTORY (`permission-registry.ts:645`) ไม่มี `expense.review`.
- Impact: คนที่จ่ายเงินจริง (ผู้ที่การรับรองต้องมาจากเขาตามกฎหมาย) ได้หน้า 403 แทนขั้นรับรอง — flow ใช้ได้เฉพาะเมื่อ payer บังเอิญมี `expense.review`. กระทบ commit ล่าสุด "make the two-person rule real" โดยตรง. **แก้:** ลดสิทธิ์ที่ history endpoint ต้องใช้ หรือให้ wizard โหลด history แยก error จาก getExpense และให้ payer เข้าถึงเฉพาะ evidence ที่ตนเป็น payer.

---

## 3. High — ฟีเจอร์ตายเงียบ / ความถูกต้องบัญชี

### H5. ✓ VAT/ยอดรวมฝั่ง "รายรับ" ใช้ float ปัดเศษผิดสตางค์ ไม่ตรงกับ engine ฝั่งรายจ่ายและตัวเอกสาร
- หลักฐาน: `accounting-totals.logic.ts:35-46` — `toDecimal` ใช้ `parseFloat`, `round2 = Math.round(v*100)/100`, `vatAmount = round2(taxable*vatRate/100)`. ทดสอบจริง: taxable ฿14.50 @7% → float **1.01** แต่ Decimal ROUND_HALF_UP (engine รายจ่าย `expense-totals.logic.ts:19`) → **1.02**; เกิดกับทุกค่า x.xx5 (30.50→2.13/2.14, 64.50, 67.50…). `calculatePaymentStatus` ก็เทียบ float ไม่มี epsilon.
- Impact: VAT บนใบกำกับภาษี/ใบเสร็จต่างจากค่าปัดครึ่งขึ้นและจาก engine รายจ่าย 1 สตางค์ — สอง engine ไม่มีวัน reconcile กัน เป็นปัญหา compliance ของผลิตภัณฑ์ภาษีไทย. **แก้:** เปลี่ยนฝั่งรายรับเป็น decimal.js + ROUND_HALF_UP ให้ตรง engine รายจ่าย.

### H6. Journal generation ที่ crash กลางคันทิ้ง DRAFT ที่ถูกนับว่า "posted"
- หลักฐาน: `journal.use-case.ts:611-615` — create-DRAFT → post → commit → markSource เป็น 4 await แยก ไม่มี transaction; `prisma-ledger.repository.ts:208-211` `findGeneratedJournal` filter `entryType:'GENERATED'` **ไม่มี status filter**; `journal.use-case.ts:502-506` ตอน retry ถ้าเจอ existing → mark source เป็น posted แล้ว return success. แต่ GL รายงานเฉพาะ POSTED.
- Impact: ถ้า process ตายระหว่าง create กับ post → journal ค้าง DRAFT ตลอด, ทุก retry บอก expense/document ว่า posted, แต่ยอดหายจาก TB/P&L เงียบ ๆ ขณะ UI บอก "ผ่านรายการแล้ว". `@@unique` กัน journal ซ้ำได้แต่ไม่กัน DRAFT ค้าง. **แก้:** ห่อ create→post→commit→markSource ใน `$transaction` เดียว หรือให้ `findGeneratedJournal` กรอง `status:'POSTED'`.

### H7. Payment allocation race + ไม่มี idempotency (ฝั่งรายรับ)
- หลักฐาน: `prisma-accounting.repository.ts:448-507` — `createPayment` ใช้ `$transaction` ธรรมดา (READ COMMITTED; ต่างจาก `voidPaymentTrueReversal:660` ที่ Serializable), อ่าน document ด้วย `findFirst` ไม่ล็อกแถว, คำนวณ `newPaid = parseFloat + toFixed`; comment เองก็ยอมรับ hazard. ไม่มี idempotency key บน `POST /accounting/payments` (`payment.use-case.ts:26-69`).
- Impact: สองการรับชำระพร้อมกันอ่าน outstanding เดียวกัน → over-settle / allocation ไม่ตรง aggregate; กด submit ซ้ำ = 2 payment. **แก้:** `SELECT…FOR UPDATE`/Serializable + idempotency fence.

### H8. ✓ บริษัทที่ onboard ในการใช้งานจริงไม่มี NotificationRule → alert สต็อกต่ำ + สรุปรายวันตายสนิท
- หลักฐาน: `PrismaNotificationRuleRepository` มีแค่ `list/findById/findByTriggerKey/update` **ไม่มี `create`**; `notificationRule.upsert` มีที่เดียวคือ `prisma/seed.ts:3093`; onboarding (`create-company-onboarding.use-case.ts`) ไม่สร้าง rule; API เป็น GET/PUT เท่านั้น. `StockLowScanUseCase` return early ถ้าไม่มี rule (`stock-low-scan.use-case.ts:23-25`); daily sweep วนเฉพาะบริษัทที่มี rule ENABLED (`notification-sweeps.use-cases.ts:115-117`).
- Impact: บริษัท production ทุกรายไม่มี rule → alert เรือธงสองตัวตายถาวร และแอดมินแก้เองไม่ได้ (หน้า rules ว่างเปล่า, ไม่มีปุ่มสร้าง). **แก้:** seed rules ตอน onboarding + เพิ่ม create endpoint/UI.

### H9. Stock-low alert ไม่เคย resolve และไม่เคยส่งซ้ำ — push ได้ครั้งเดียวต่อสินค้าตลอดกาล
- หลักฐาน: `shouldResolveAlert` (`notification.logic.ts:46`) เป็น dead code — ไม่มีที่ไหน set `status:'resolved'`; re-trigger บน event OPEN เดิมแค่อัปเดต `lastSeenAt` และสร้าง delivery เฉพาะ recipient ที่ยังไม่มี (`notification.use-cases.ts:218-247`) → ไม่มี delivery ใหม่เข้าคิว.
- Impact: สินค้าเติมสต็อกแล้วต่ำอีกในภายหลัง — ไม่มี highlight ใหม่ ไม่มี LINE push; alert เดิมค้างจนกด dismiss เอง. Alert สต็อกเป็น one-shot ต่อสินค้า.

### H10. e2e 35 spec ไม่เคยรันใน CI + commit docs-only จบเป็น success ทั้งที่ข้าม test
- หลักฐาน: `find e2e -name "*.spec.ts"` = 35; ไม่มี match `playwright/e2e` ใน `.github/workflows/ci.yml`, `deploy-uat.yml`; runbook `cloud-environment-operations.md:52-54` ระบุ commit ที่แตะแต่ docs จะ skip ทุก job รวม Typecheck+Test แล้วจบ success และ deploy-uat ยอมรับ run แบบนั้น. `next.config.mjs:15-16` build ด้วย `ignoreBuildErrors`/`ignoreDuringBuilds` (ชดเชยด้วย CI typecheck แยก).
- Impact: ตาข่าย regression ระดับ browser เป็น manual ล้วน; deploy ที่เขียวได้ทั้งที่ไม่มี test รันเลย. **แก้:** ผูก e2e เข้า CI (อย่างน้อย gate ก่อน deploy) + ตรวจ job list ไม่ใช่ conclusion.

### H11. Workers ไม่มี graceful shutdown + ไม่มี DLQ (config หลายตัวตาย)
- หลักฐาน: ✓ `apps/workers/src/main.ts` จับแค่ `unhandledRejection`/`uncaughtException` ไม่มี SIGTERM; ค่าที่ `start*Worker()` คืนถูกทิ้ง; `WORKER_SHUTDOWN_TIMEOUT_MS` (`packages/config/src/index.ts:389`) ไม่ถูกใช้. ไม่มี DLQ (`grep DLQ` ว่าง); `DLQ_ENABLED`/`QUEUE_RETRY_*`/`QUEUE_CONCURRENCY` เป็น config ตาย; งานส่วนใหญ่ default `attempts:1`; `removeOnFail:{count:100}` (`queue.ts:13`).
- Impact: ทุก deploy ฆ่า job กลางคัน; LINE send/campaign ที่ side-effect ไปแล้วแต่ยังไม่ ack อาจยิงซ้ำตอน redelivery; job one-shot ที่ล้มหายหลัง 100 fail ถัดไปโดยไม่มีที่ replay; คนตั้ง env knob ไม่เห็นผลอะไรเปลี่ยน.

---

## 4. Medium (จัดกลุ่มตามฟีเจอร์)

**พนักงาน/สิทธิ์/auth**
- เปลี่ยนรหัส (change-password / admin regenerate) **ไม่ revoke session เดิม** — มีแค่ revoke-other-sessions ที่เรียก `revokeActiveSessions`; `ConfirmPasswordResetUseCase` revoke ได้แต่ **ไม่ผูกกับ route ไหนเลย** (dead). session ผู้โจมตีอยู่รอดได้ถึง 7 วัน (`change-password.use-case.ts:32-42`).

**รายรับรายจ่าย/ledger**
- Period key/entry date คำนวณ 3 แบบ (UTC / server-local / Bangkok) — confirm number ใช้ UTC slice(0,7), invoice issue server-local, มีแค่ Void/Reverse ใช้ `civilPeriodKey`; settlement `entryDate=new Date(paidAt)` ลง `@db.Date` ตัดเป็นวัน UTC → จ่าย 01:00 ICT วันที่ 1 ลงเดือนก่อน. (`posting-engine.logic.ts:332`, `expense-draft.use-case.ts:530`, `document.use-case.ts:181`, `journal.use-case.ts:402-413`)
- DeleteExpense ข้าม branch ABAC (`delete-expense.use-case.ts:157-231` ไม่มี `isBranchInScope` ต่างจาก Get/Update/Reject/Void/Confirm) → ลบ draft ของสาขาอื่นได้.
- Draft update ไม่มี optimistic-concurrency (`updateMany` ไม่มี expectedUpdatedAt) → reviewer สองคน save ทับกันเงียบ ๆ (confirm มี CAS, review save ไม่มี).
- เอกสารรายรับ (draft) แก้/ลบ/void ไม่ได้เลย (ไม่มี PATCH/DELETE route; DRAFT void ไม่ได้) → พิมพ์ผิดแล้วค้าง ต้อง issue (กินเลขที่) แล้ว void.
- Partial payment ของ expense ลงบัญชีไม่ได้ และการบันทึกจ่ายทับ `postingStatus` เป็น pending ถาวร (`nextExpensePostingSource` คืน null สำหรับ non-PAID); `paidAmount` แทนที่ยอดสะสม ไม่มีประวัติการจ่าย.
- Expense payment endpoint ไม่ validate enum/date (plain TS type, pipe ไม่ตรวจ) + เทียบ bound เป็น float → 500 แทน 400; ไม่มี idempotency/CAS.
- List รายจ่าย pageSize ไม่ clamp ฝั่ง server (`?pageSize=500000` ได้ทั้งหมด; web ส่ง 200).
- Journal line ผ่าน `parseFloat` ก่อนลง Decimal (รวม void reversal) — `parseFloat("1,234.50")===1` แฝงอยู่ (วันนี้ input มาจาก `Decimal.toString()` จึง latent).

**ใบทดแทนใบเสร็จ**
- เลขที่เอกสารเป็น `SRC-<cuid ภายใน>-V<n>` เสมอ และ "เลขที่รายการ" พิมพ์เป็น "-" เสมอ (prepare อนุญาตเฉพาะก่อน confirm → `expenseNumber` ยังไม่ถูกออก → fallback `expense.id`) — ไม่มี running number ต่อบริษัท (`prisma-expense.repository.ts:915`, `substitute-receipt.logic.ts:221,226`).
- Timestamp การเซ็น (certifiedAt/approvedAt) render เป็นวัน UTC ไม่ใช่วันไทย → เซ็นช่วง 00:00–06:59 พิมพ์วันที่ พ.ศ. ผิดไป 1 วันข้างลายเซ็น (`substitute-receipt.logic.ts:332`).
- Void expense ที่ confirm แล้ว ทิ้งใบรับรอง ISSUED ค้าง downloadable โดยไม่มีเครื่องหมายยกเลิก (`voidExpenseTrueReversal` ไม่แตะ substitute evidence).
- Hub ซ่อนเอกสารของ expense สาขา-กลาง (branchId null) จากผู้ใช้ที่จำกัดสาขา (`prisma-expense.repository.ts:461` ไม่รวม null ต่างจาก `branchScopeWhere`).

**ตั้งค่า/feature toggle**
- ปิดฟีเจอร์/partner **ไม่หยุดงาน async ที่คิวไว้** (campaign/outbox/LINE drain ไม่เช็ค entitlement+status; `ExecutionAttemptService` สร้างแล้วแต่ยังไม่บนเส้น hot) → campaign ที่ตั้งเวลายัง push LINE หลังปิดฟีเจอร์ (staged design ที่ยังไม่ flip).
- Duplicate active tax-branch-code เลี่ยงได้ผ่าน partial update (assign code ซ้ำให้สาขา DISABLED แล้ว PATCH `{status:ACTIVE}` โดยไม่ส่ง code → ข้าม check) → สองสาขา ACTIVE รหัส 5 หลักเดียวกัน (พิมพ์บนใบกำกับภาษี) (`update-branch.use-case.ts:51-63`).
- บริษัทเก่าที่ไม่มี entitlement row เลย fail-**open** ได้ทุกฟีเจอร์ (`entitlement.helper.ts:37-44`) — ขึ้นกับว่า F2 normalization รันครบทุก tenant แล้วหรือยัง.
- ไม่มี test/CI ตรวจว่า `@RequirePermissions` ทุกคีย์มีจริงใน registry (ต้นเหตุที่ H12 หลุดออกมา).
- Business-policy settings ไม่มี audit trail, ไม่มี assertRouteCompany, และ role ปฏิบัติการ (เช่น sales) เปลี่ยน discount ceiling ได้ (`business-policy.controller.ts:18-51`).

**dashboard/noti/reports**
- H12 ✓ `system.shared_line_credential.manage` **ไม่มีใน permission-registry** → `system-line.controller.ts:22` บังคับคีย์ที่ไม่มีอยู่ → 403 ทุกคนแม้ SYSTEM_ADMIN; หน้า /system/line-settings save ไม่ได้ (และ sync-permissions revoke การ grant มือ). ซ้ำร้าย runtime อ่าน credential จาก env ไม่ใช่ DB (LINE audit) → console หมุน credential ตาย 2 ชั้น.
- Daily owner summary รายงาน "0 วิดเจ็ต" เสมอ ✓ (worker ctx มีแค่ dashboard.read/snapshot.generate; visibleWidgets กรองด้วย provider readPermissions ที่ worker ไม่มี → widgets=[]) (`notification.use-cases.ts:280`).
- `report_ready` emit แล้วแต่จัดเป็น FUTURE trigger → LINE ถูก suppress เสมอ, opt-in ไม่ได้; title/body อังกฤษล้วน (`notification.model.ts:114-141`).
- Tab "7 วันล่าสุด": snapshot ใช้สัปดาห์ Mon-Sun แต่การ์ด CRM brief ใช้ trailing 7 วัน → tab เดียวกันแสดงสองช่วง (`notification.logic.ts:198`, `crm-daily-brief.logic.ts:21`).
- Snapshot cache เสิร์ฟ period ก่อนหลัง rollover (เช็คแค่อายุ+module ไม่เช็ค periodStart/End) → 23:50 "today" เสิร์ฟถึง 00:05 แสดงยอดเมื่อวาน.
- `dedupKey` ไม่มี `@@unique` (มีแค่ index) → cron+on-demand แข่งกันสร้าง 2 OPEN event → LINE push ซ้ำ.
- Cursor pagination filter `id<cursor` แต่ order by `createdAt` (คีย์ไม่ตรง) ใน event/user/delivery list → ข้าม/ซ้ำข้ามหน้า.
- Notification center ไม่มี pagination (ดึง 50 ทิ้ง nextCursor); item ที่ dismiss แล้วเข้าถึงไม่ได้ ไม่มี undo.
- Delivery log + retry มี API แต่ไม่มี UI ใช้ → LINE ที่ส่งล้มมองไม่เห็นสำหรับแอดมิน.
- DashboardSnapshot โตไม่จำกัด (~96 row/บริษัท/วัน ไม่มี prune); unread-count ดึงทุก unread row + join event ทุก 60 วิ (ควร groupBy/count); stockMovement.groupBy ทั้งประวัติบน request path.
- Report interactive query เดิน OFFSET page-loop สแกนทั้ง dataset (O(N²)); ผลลัพธ์ตัดที่ 100 แถวไม่มี pager แต่ header โชว์ total.

**LINE/AI**
- Admin หมุน shared LINE credential เป็น write-only ✓ (runtime อ่าน env; ดู H12).
- Monthly AI budget เป็น check-then-act → request พร้อมกัน overshoot ≈ N×cost (bounded ด้วย rate-limit window, ยอมรับใน design).
- Model call ที่ timeout = Bedrock spend จริงที่ meter บันทึกเป็น 0 token (`bedrock.provider.ts:140-176`) → budget นับต่ำเกินตอนเปลืองที่สุด; Converse ที่ยกเลิกยังวิ่ง/คิดเงินต่อ.
- LINE media download buffer ทั้งก้อนในหน่วยความจำ เช็ค size จาก header อย่างเดียว (`process-line-webhook.use-case.ts:2125-2147`) → memory DoS บน image/chunked.

**reimbursement**
- Payment currency ไม่เทียบกับ currency ของ claim → จ่าย USD ปิด claim THB ได้ (`reimbursement.logic.ts:316-332`).
- Body ของ approve/reject/finance-review/void/cancel ไม่ validate (interface ไม่ใช่ class → ValidationPipe ข้าม) → string ยาวไม่จำกัด, type-confusion 500 (`reason:{}` → `reason.trim()`).
- Manager-path approval ที่ค้าง (projection ล้ม) หายจากทุกคิว, reconciler รันมือเท่านั้น (ไม่มี cron/worker).
- ไม่มี return-for-edit/resubmit; REJECTED terminal, NEEDS_INFO ทางตัน (matrix โฆษณา transition ที่ไม่มี endpoint).
- List query ไม่มี take + paginate ในหน่วยความจำ (`rows.slice`, `total=rows.length`).

**platform (non-functional)**
- ✓ DB pool/statement-timeout config ตาย: `new PrismaPg({connectionString})` เท่านั้น; `DATABASE_POOL_MAX`/`DATABASE_STATEMENT_TIMEOUT_MS` ไม่มี runtime reader → pool default max 10/task, ไม่มี statement timeout ระดับแอป.
- api-web supervisor exit ทันทีเมื่อ child ตัวใดตาย (ไม่ wait หลัง kill) → ตัด SIGTERM drain ของ LINE buffer ที่ API สัญญาไว้ (`start-api-web-runtime.sh:70-86`).
- AI gateway ไม่มี shutdown hook, ไม่มี request-id middleware, `RATE_LIMIT_ENABLED` ตาย.
- Health check ตรวจแทบไม่มีอะไร: liveness สาธารณะ static, readiness เช็คแค่ DB (ไม่เช็ค Redis/S3/ClamAV), workers health hardcode 200 → instance ที่ Redis ตายยังผ่าน ECS health.
- Web ไม่มี CSP (มี HSTS/nosniff/frame-deny) (`next.config.mjs:27-38`).
- ไม่มี interactive `$transaction` ในโค้ดฟีเจอร์เลย — multi-step flow (reserve เลข→create→mark) ไม่ atomic; crash กลางคันรั่วเลขเอกสาร.
- audit หลัง commit หายได้แบบ log-only (documented, alarm-keyed) — ต้องยืนยันว่า CloudWatch metric filter/alarm บน `$.riskLevel` มีจริงในบัญชีปลายทาง.

---

## 5. Low / หมายเหตุ (คัดที่ควรรู้)

- นโยบายรหัสผ่านใหม่วัดแค่ความยาว ≥8 ไม่มี complexity/breach/repeat check → ผู้ใช้ที่ถูกบังคับเปลี่ยนจากวันเกิดตั้ง `11111111` ได้ (ลดทอน mitigation ของ H1).
- Disable พนักงานไม่ revoke session (บรรเทาโดย ACTIVE-membership check ต่อ request, ไม่มี cache) — re-enable ภายใน 7 วันชุบ token เก่า.
- Login แยก "รหัสถูกแต่ไม่มีบริษัท" (403) จากรหัสผิด (401) — oracle เล็กน้อย (forgot-password ปลอดภัยแล้ว).
- Thai baht text ตก "เอ็ด" ข้ามหลักล้าน ✓ (รันจริง: `1000001 → "หนึ่งล้านหนึ่งบาทถ้วน"` ควรเป็น "...ล้านเอ็ดบาทถ้วน") — spec ล็อกค่าผิดไว้ (`substitute-receipt.logic.spec.ts:9`).
- ใบทดแทน: catch-all ห่อทุก error เป็น 409 ทิ้ง structured code, web พึ่งการ match ข้อความอังกฤษ verbatim; blank-render guard (0.002 dark-pixel) จับได้แค่ว่างสนิท ไม่จับ glyph หายบางส่วน (จริง ๆ กันที่ build time แล้ว); PDF gen บน request path (sharp decode + luminance loop sync).
- PII (payeeName/address/taxId) อยู่ใน query string ของ voucher PDF (`expense.controller.ts:221-241`) → เข้า access log/proxy.
- Dead code: `confirmExpenseCas` (ไม่มี caller), reimbursement legacy repo methods, `shouldResolveAlert`.
- Web hardcode รายชื่อ AI model vs server env (drift); onboarding "module package" ตาย; platform-foundation status = mock; branch/partner edit ไม่มี optimistic concurrency; AI-budget cache invalidation single-process (60s cross-instance).

---

## 6. สิ่งที่ทำได้ดี (ยืนยันแล้ว ไม่มี finding)

- **AuthZ**: deny-by-default guard, ไม่มี unguarded mutation, ไม่มี self-escalation, IDOR/last-owner ป้องกันแน่น, refresh reuse revoke ทั้ง family, permission resolve จาก DB ทุก request (revoke มีผลทันที).
- **LINE/AI boundary**: signature verify timing-safe ก่อน parse, prompt-injection containment (demote เป็น data, allowlist, OCR cross-check), one-time HMAC delegation token, permission re-resolution ฝั่ง API, gateway ไม่มี DB, AI output เป็น draft เสมอ.
- **feature-launch/entitlement control plane**: commandId idempotency, generation/setVersion CAS, advisory-lock order เดียว, fail-closed absent-row, deploy bootstrap override human CLOSE ไม่ได้, HIGH/CRITICAL audit ครบ.
- **money & schema**: Decimal เกือบทั้งหมด (Float แค่ 2 = AI confidence), 296 companyId index + 120 unique, void = true reversal Serializable + period lock, upload MIME+magic-byte+active-content+quota+tenant-prefixed S3, migration ผ่าน pre-deploy release task เดียว, Dockerfile digest-pin/USER node/NODE_ENV=production, `validateProductionConfig` เข้มจริง.
- **reimbursement core**: self-approval บล็อก, snapshot-hash+CAS+advisory lock, serializable payment tx, idempotency, tenant scoping/IDOR ครบ, audit in-tx.

---

## 7. ลำดับที่แนะนำก่อนเปิดผู้ใช้จริง

**P0 (ต้องปิดก่อน deploy):**
1. C1 — สร้าง encrypted Redis + secret ARN ใหม่ + สคริปต์ bootstrap prod
2. H1 — initial credential หมดอายุ + เลิกใช้วันเกิดเป็นรหัส
3. H2 — เพิ่ม branch scope บน reimbursement payment/void + finance queue
4. H12 — เพิ่ม `system.shared_line_credential.manage` เข้า registry (+ ตัดสินใจว่า runtime อ่าน DB หรือ env)

**P1 (ปิดก่อนเปิดฟีเจอร์ที่เกี่ยวข้อง):**
5. H5 — VAT ฝั่งรายรับเป็น Decimal ROUND_HALF_UP (compliance)
6. H6/H7 — ห่อ journal gen ใน transaction + row-lock/idempotency บน payment
7. H4 — แก้สิทธิ์หน้าเซ็นใบทดแทน (two-person rule ใช้ได้จริง)
8. H8/H9 — seed NotificationRule ตอน onboarding + แก้ stock alert re-deliver
9. H3 — CF client-IP สำหรับ rate limit

**P2 (ตามหลังได้ แต่ควรมีก่อนโหลดจริง):**
10. H10/H11 — e2e เข้า CI, workers SIGTERM + DLQ, DB pool/statement timeout
11. Medium ด้าน timezone (date/period), optimistic concurrency, unbounded query/pagination
12. โหลดเทสต์ที่ UAT (ยังไม่เคยมีเลย) ก่อนเปิด user

**หมายเหตุกระบวนการ (จาก launch memory):** "deploy เขียว ≠ ระบบใช้งานได้" — เส้นทาง AI เคยตายทั้งเดือนโดยเครื่องมือทุกตัวรายงาน success. ทุกฟีเจอร์เรือธงควรมี smoke test ที่ "เรียกจริงแล้วล้มทำให้ deploy ล้มด้วย" ไม่ใช่แค่ health เขียว.
