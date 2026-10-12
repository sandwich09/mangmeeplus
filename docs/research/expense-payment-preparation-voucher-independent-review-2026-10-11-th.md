# ตรวจอิสระ: spec เตรียมจ่าย/ใบสำคัญจ่าย v1.1 เทียบโค้ดล่าสุด — 11 ตุลาคม 2569

สถานะ: **ตรวจอย่างเดียว ไม่ได้แก้ spec ไม่ได้แก้โค้ด ไม่ได้ commit**

Spec ที่ตรวจ: v1.1 ซึ่งเก็บไว้ที่ `docs/research/expense-payment-preparation-voucher-spec-v1.1-superseded-2026-10-11-th.md` (เลขหัวข้อในเอกสารนี้อ้างฉบับนั้น) และผลตรวจรอบสองของ spec เอง `docs/research/expense-payment-preparation-voucher-spec-review-2026-10-11-th.md`

ผลต่อเนื่อง: เจ้าของตัดสิน 11 ต.ค. 2569 "ตามที่แนะนำทั้ง 7 ข้อ" และ spec ถูกเขียนใหม่เป็น v2.0 ที่ `docs/specs/expense-payment-preparation-voucher-spec-th.md`

ฐานโค้ดที่ใช้ตรวจ: **`origin/main` `9b94ce059` (10 ต.ค. 2569 23:30)** อ่านจาก worktree แยก ไม่ใช่ working tree ร่วม เส้นทางไฟล์ในเอกสารนี้อ้างตาม `origin/main` ทั้งหมด

เครื่องหมาย: ✔ = ผู้ตรวจเปิดโค้ดยืนยันเอง · ○ = มาจากผู้ช่วยตรวจรายส่วน ยังไม่ได้เปิดซ้ำ

## 1. ผลสรุป

**ยังไม่ควรนำ spec นี้ไปเขียนแผน implement** เหตุผลหลักข้อเดียว: spec ตรวจเทียบกับโค้ดชุดเก่า ข้อสรุปหลายข้อจึงตรงข้ามกับระบบที่ใช้งานจริง และบางข้อถ้าทำตามจะทำให้ลูกค้าที่จ่ายเงินแล้วใช้งานไม่ได้

| ระดับ | จำนวน | ความหมาย |
|---|---|---|
| ต้องแก้ก่อนทำแผน | 9 | ทำตามแล้วของที่ใช้งานอยู่พัง หรือขัดคำตัดสินเจ้าของที่บันทึกไว้ |
| สูง | 9 | ออกแบบซ้ำของที่มีแล้ว หรือข้อมูล/field ไม่ตรงโค้ด |
| กลาง | 10 | ช่องว่างใน spec เอง และ dependency ที่ไม่ได้นับ |
| ใช้งานยาก | 8 | ผลต่อผู้ใช้บนมือถือและผู้ดูแลระบบ |

สิ่งที่ spec ทำได้ดีและควรเก็บไว้อยู่ใน §8

## 2. ต้นเหตุ: ฐานที่ใช้เขียน spec

**R1 ✔ — ฐานเก่า 3 สัปดาห์.** spec §3 ระบุฐานเป็น working tree ร่วม HEAD `4a5817b42` (25 ก.ย.) ซึ่งแตกจาก main เมื่อ 22 ก.ย. 17:47 และตามหลัง `origin/main` อยู่ 577 commits ช่วงนั้นส่วนที่ spec พึ่งพาเปลี่ยนดังนี้

| ส่วน | เปลี่ยนบน main นับจากฐานของ spec |
|---|---|
| reimbursements (API) | 51 ไฟล์ +26,166 / −1,002 |
| reimbursements (web) | 29 ไฟล์ +14,291 / −639 |
| billing | 106 ไฟล์ +13,629 / −586 |
| contracts | 61 ไฟล์ +8,971 / −281 |
| expenses (API) | 69 ไฟล์ +4,048 / −825 |
| tax | 36 ไฟล์ +2,655 / −68 |
| `schema.prisma` | +891 / −36 และ migration ใหม่ 43 ชุด |

ผล "186 tests ผ่าน" ในรอบสองก็รันบนโค้ดชุดเก่านี้ จึงไม่ยืนยันอะไรเกี่ยวกับระบบปัจจุบัน

**R2 ✔ — รอบเขียน spec แก้เอกสารอื่นบนฐานเก่าด้วย.** ไฟล์ที่ถูกแก้ค้างใน working tree และ main ก็เปลี่ยนไปแล้วเช่นกัน

| เอกสาร | แก้ค้างในเครื่อง | main เปลี่ยนตั้งแต่ฐาน |
|---|---|---|
| `wht-certificate-system-issuance-spec.md` | +49 / −39 | +37 / −1 |
| `wht-certificate-system-issuance-plan.md` | +21 / −38 | +4 |
| `mangmee-package-entitlements-spec-th.md` | +5 / −1 | +2 / −1 |
| `reimbursement-step-journey-spec-th.md` | +2 | +173 / −9 |

ที่ร้ายที่สุดคือ package spec: main มี "Owner amendment 2026-09-23" ว่า Enterprise เพิ่มเฉพาะสิทธิ์ ภ.ง.ด.53 และ 50 ทวิ **แยกจาก `thai_tax`** แต่ข้อความที่แก้ค้างในเครื่องเขียนว่า SYSTEM 50 ทวิ "ต้องผ่าน entitlement `thai_tax`" ซึ่งขัดกับ amendment นั้นโดยตรง ห้าม commit การแก้เหล่านี้ตามสภาพ

**R3 ✔ — เอกสารที่ spec ยึดเป็น prerequisite ล้าสมัย 2 ฉบับ.**

- `reimbursement-recipient-bank-account-spec-th.md`: ฉบับบน main มีหมายเหตุผู้ควบคุมงาน 5 ต.ค. ว่าเขียนจากโค้ดที่ยังไม่มีฟีเจอร์บัญชีรับเงินคืนและสลิป ฉบับที่ใช้ลงมือทำคือ `reimbursement-multi-payout-accounts-spec-th.md` ไฟล์ในเครื่องเป็นฉบับก่อนใส่หมายเหตุ
- `manual-expense-web-entry-flag-spec-th.md`: บน main เป็น v3.1 ซึ่ง **ยกเลิก** แนวทาง key `expenses.manual.web_entry` ของ v2 และสร้างเสร็จเป็นค่าตั้งหน้าจอรายร้านแล้ว

## 3. ต้องแก้ก่อนทำแผน

### B1 ✔ — สิทธิ์ออก 50 ทวิผูกผิดตัว ลูกค้า 1999 จะใช้ไม่ได้

- spec §6.1, §6.3, §6.4, §11.1, §11.2, §15.1 ใช้ `feature(thai_tax)` เป็นเงื่อนไขเห็นเมนูและออก 50 ทวิ
- โค้ด: `ENTERPRISE_1999 = starter + wht_pnd53 + wht_50bis` ไม่มี `thai_tax` (`packages/contracts/src/menu-entitlements.ts:496-501` พร้อมคอมเมนต์ว่าสิทธิ์แคบนี้ต้องไม่เปิด `thai_tax` ทั้งชุด)
- `pack.wht.certificate.issue` ผูก `wht_50bis`; มี pack legacy ผูก `thai_tax` สำหรับร้านที่ซื้อแบบเดิม (`apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts:483-494`)
- ลายเซ็น 50 ทวิผูก `wht_50bis` เช่นกัน (`:500`)
- spec ไม่มีคำว่า `wht_50bis` หรือ `wht_pnd53` เลย (grep ได้ 0)
- ผลถ้าทำตาม: ผู้ซื้อ 1999 ไม่เห็นเมนู ออกไม่ได้ และกฎ downgrade §11.2 ทำงานกับ feature ผิดตัว

### B2 ✔ — การออก 50 ทวิในระบบมีครบแล้ว แต่ spec วางแผนจะสร้าง

| spec บอก | โค้ดล่าสุด |
|---|---|
| §3 เว็บยังไม่เรียกออก SYSTEM, renderer เป็น generic summary | ปุ่ม "พิมพ์เอกสาร 50 ทวิ" อยู่บนหน้ารายละเอียดรายจ่าย (`apps/web/src/features/expenses/ExpenseReviewPage.tsx:1274`) และ AP hub; renderer เป็นแบบกรมสรรพากร ○ (`apps/api/src/modules/tax/domain/logic/wht-certificate-pdf.logic.ts`) |
| §4.3 correction/replacement อยู่นอก v1 | มีแล้ว และเจ้าของยืนยัน 23 ก.ย. ว่า **ไม่ gate** (`wht.certificate.correct` อยู่ใน pack ที่ไม่ผูก entitlement, `capability-pack.registry.ts:471-475`) |
| §5 "ไม่มีปุ่มออก SYSTEM แอบอยู่ใน card" ของ source | ปุ่มออกอยู่ในหน้า source โดยตั้งใจ และเป็นทางเดียวที่ลูกค้า Enterprise ใช้วันนี้ |
| §15(4) specialist launch readiness ยังเป็นเงื่อนไขเปิด | route ทั้งสามของ `cap.wht50bis` เป็น ORDINARY/OPEN ตามมติเจ้าของ 22 ก.ย. (`apps/api/src/modules/feature-launch/domain/launch-matrix.catalog.ts:190-225`) |
| §6.5(5) ต้องเพิ่ม gated issue pack แยก | มีแล้ว |

ทะเบียน `/expenses/wht-certificates` ที่เสนอจึงควรเป็น "รายการ + ลิงก์ไป action ที่มีอยู่" ไม่ใช่ทางออกเอกสารชุดใหม่

### B3 ✔ — ย้ายจุดรับรู้ WHT ไป "ตอนจ่าย" ชนกับของที่ใช้งาน

- วันนี้ handoff ถูกเขียนใน transaction ยืนยันรายจ่ายทุกครั้งที่ WHT > 0 โดยไม่ขึ้นกับ gate: `sourcePaymentType: 'expense.record'`, `sourcePaymentId: expense.id`, `paymentDate: expense.expenseDate` (`apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:4409-4472`)
- handoff unique ต่อ `(companyId, sourcePaymentType, sourcePaymentId, payeeId)` ○ จึงเป็น "หนึ่งรายจ่าย หนึ่ง handoff เต็มยอด"
- การออกต้องการแค่สถานะ CONFIRMED ไม่ต้องจ่ายแล้ว ○
- spec §3 เข้าใจว่า "เป้าหมายใหม่ต้องเก็บข้อเท็จจริงเสมอ" ยังไม่มี ทั้งที่ expense ทำอยู่แล้ว และ AP ก็เขียน handoff ทุกครั้งแล้วเช่นกัน (`apps/api/src/modules/procurement/infrastructure/prisma-procurement.repository.ts:1425-1432`)
- spec §9.2/§10.1 "ทุก positive-WHT settlement ต้องมี durable handoff" จะได้ handoff ซ้ำกับของเดิม (ต่อ settlement + ต่อ expense) สำหรับยอดเดียวกัน
- สิ่งที่ผูกกับ identity เดิม: หน้ารายจ่ายค้น handoff ด้วย expenseId, ตัวกัน reopen, การ retire tax events, period lock จาก `expenseDate`, และเดือนของหนังสือรับรองที่ออกไปแล้ว
- spec §10.3 ยอมรับว่าต้องมี mapping ก่อน แต่ไม่ได้ระบุว่า v1 จะทำหรือไม่ทำ ต้องตัดสินให้ชัด: **คงการรับรู้ตอนยืนยันใน v1** (แนะนำ) หรือทำโครงการย้ายแยกพร้อมนักบัญชี
- หมายเหตุข้อเท็จจริงที่ spec ชี้ถูก: วันที่จ่ายบนหนังสือรับรองวันนี้คือวันที่รายจ่าย ไม่ใช่วันจ่ายจริง เป็นเรื่องที่ควรให้นักบัญชีตัดสินแยกจากงานนี้

### B4 ✔ — เพิ่ม key ใน catalog แล้วร้านเดิมชำระเงินไม่ได้

- `billingFeaturePlan` ผ่านได้เมื่อแถวสิทธิ์ของร้านตรง CANONICAL ทั้งชุด หรือเข้า shim ที่ hardcode `CANONICAL.length === 62` กับชุด 60 key ก่อน 23 ก.ย. เท่านั้น ไม่เข้าทั้งสองทางจะ throw `BILLING_ENTITLEMENT_REVIEW_REQUIRED` (`apps/api/src/modules/billing/application/billing-feature-entitlements.ts:14-59`)
- เพิ่ม 4 key ตาม spec → CANONICAL เป็น 66 → ร้านที่ normalize แล้วทุกร้านตกทั้งสองเงื่อนไข จนกว่าจะ materialize แถวใหม่
- spec §6.5(8) บอกให้ "quote ที่ยังไม่จ่ายให้ refresh" ซึ่งไม่ช่วย เพราะ refresh ก็ผ่านฟังก์ชันเดียวกัน ○
- target ของการชำระคำนวณจากรายการ key ที่ package ให้ (`:66-67`): key ใหม่ที่ไม่อยู่ใน `STARTER_FEATURE_KEYS` หรือใน snapshot ของดีลจะถูกเขียนเป็น **OFF** ตอน paid apply ครั้งถัดไป ดีลของฝ่ายขายตรึงรายการไว้ จึงโดนแน่นอน
- อีกด้าน evaluator ถือว่า submenu เปิดเมื่อ parent เปิดและไม่มีแถว false (`apps/api/src/modules/employee-access/application/entitlement.helper.ts:57-61`) ฟีเจอร์ใหม่จึง **เปิดทุกร้านทันทีที่ deploy** ทยอยเปิดไม่ได้
- มี test ล็อกจำนวน key = 62 และห้ามมีชื่อ `web_entry` (`apps/web/src/features/system-partners/system-partners.logic.spec.ts:578-585`)
- บทเรียนเดิม: ตอนเพิ่ม `wht_*` สองตัวเมื่อ 23 ก.ย. ต้อง hotfix shim ในวันถัดมา ○

### B5 ✔ — สวิตช์ `.web_entry` เป็นแบบที่เจ้าของไม่เอาแล้ว

- มติข้อ 3 ของ spec คือ "ใช้แนวทางเดียวกับฟีเจอร์เดิม/บันทึกด้วยมือ"
- แนวทางบันทึกด้วยมือที่สร้างจริง: ตาราง `CompanyWebEntrySetting`, command ของตัวเอง, ค่าใน session `manualExpenseWebEntry`, **ไม่ใช่ entitlement key** และ **ค่าเริ่มต้นคือไม่แสดง** (`apps/api/src/modules/system-partner-management/domain/logic/manual-expense-web-entry.logic.ts:1-22`, `apps/api/src/modules/auth/presentation/auth.controller.ts:1066`)
- เหตุผลที่ v3 ยกเลิกแบบ catalog key คือ F10: key ใน catalog ถูกปฏิบัติเป็นสิทธิ์ทุกที่ (billing บังคับรูปแถว, command ล้างสถานะ LINE และ bump setVersion)
- spec §6.2 เสนอ `expenses.payment_preparations.web_entry` เป็น catalog leaf, `permissionKeys: []`, ค่าเริ่มต้น ON ขัดทั้งสามจุด
- key สามชั้นไม่มีในระบบ: `parentFeatureKey()` คืน segment แรก และ evaluator จะเปิด leaf เมื่อ `expenses` เปิด โดยไม่ดู `expenses.payment_preparations` ตรงกลาง
- spec §6.5(1) "session ไม่มี entry flag" และ §15.1 "manual-entry ยังไม่ implement" ล้าสมัย; fingerprint มี `manualExpenseWebEntry` แล้ว และ **จงใจไม่ใส่ feature list/setVersion** เพื่อไม่ให้ทุกแท็บของร้าน refresh เมื่อสิทธิ์อื่นเปลี่ยน (`apps/web/src/features/web-core-workspace/workspace-scope.api.ts:24-38`)
- สวิตช์ capability ที่เป็นเจ้าของ permission เปลี่ยน permissions ใน `/auth/me` อยู่แล้ว fingerprint จึงเปลี่ยนเอง งาน §6.5(1–2) ส่วนใหญ่ไม่จำเป็น

### B6 ✔ — ฝั่งเบิกคืน: ขัดคำตัดสินที่ใช้งานอยู่

| spec | ระบบที่ใช้งาน |
|---|---|
| §3/§15 recipient spec ยังไม่ implement และเป็น prerequisite | บัญชีรับเงินคืน หลายบัญชีต่อคน สลิป และการยืนยันบัญชีมีครบ ○ (`MemberPayoutAccount`, `MemberSavedPayoutAccount`, `ReimbursementPayoutDestination`) |
| §7.4 reuse "execution attempt" ACTIVE/OUTCOME_UNKNOWN | ไม่มี และถูกตัดออกจากขอบเขต: "การจองงานจ่ายเพื่อกันคนสองคนโอนซ้ำนอกระบบ" (`docs/specs/reimbursement-payout-account-and-payment-slip-spec-th.md:106`), "ไม่ทำรอบนี้ เจ้าของยังไม่ได้สั่ง" (`reimbursement-multi-payout-accounts-spec-th.md:44`) |
| §7.3 ใช้ self-approval แบบ OWNER/ADMIN/MANAGER exemption | เจ้าของสั่ง 4 ต.ค. ว่าสวิตช์ self-approval ใช้กับทุก role ไม่มีข้อยกเว้นตาม role (`apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.ts:363-370`) |
| §7.3 มีขั้นอนุมัติเตรียมจ่ายแยกเสมอ | finance review ปิดเป็นค่าเริ่มต้น "so a solo owner can finish a claim in one sitting" (`reimbursement.constants.ts:58-60`); ผู้อนุมัติได้ฟอร์มจ่ายทันทีหลังอนุมัติ ○ |
| §7.1(6) ต้องมี reference และสลิป | เจ้าของสั่ง 4 ต.ค.: หลักฐานแทน reference; reference บังคับเฉพาะเช็คที่ไม่มีสลิป (`packages/contracts/src/reimbursements.ts:186-197`) |
| สิทธิ์และสวิตช์ใหม่ครอบการจ่ายใบเบิก | payout spec ตัด "ใบสำคัญจ่ายรวมหลายใบ" และ "permission key ใหม่ และสวิตช์เปิดปิดฟีเจอร์" ออกจากขอบเขตของ flow นี้ (`:101, :109`) |

ชื่อ `ExecutionAttempt` มีอยู่แล้วใน schema เป็นของ feature-launch (`schema.prisma:9788`) ห้ามใช้ชื่อนี้ซ้ำ

ใบเบิกที่จ่ายแล้วมี `paymentNo`, สลิป, snapshot บัญชีที่ยืนยัน และแบบพิมพ์ใบเบิกที่ระบุ "การจ่ายเงินคืน: จ่ายเมื่อ… วิธี… เข้าบัญชี…" อยู่แล้ว ○ ใบสำคัญจ่ายของใบเบิกจึงซ้ำเกือบทั้งหมด ช่องว่างจริงมีข้อเดียวคือแบบพิมพ์ re-render จากข้อมูลปัจจุบัน ไม่ใช่ไฟล์ตรึง

### B7 ✔ — เจ้าหนี้การค้าไม่อยู่ในแพ็กเกจที่ขาย

- spec §6.1: 1999 "มีตาม procurement"
- โค้ด: `procurement` อยู่ใน preset `full` เท่านั้น ไม่อยู่ใน tier ใด และดีลใหม่ขายไม่ได้ (`menu-entitlements.ts:480-508`) `double_entry_ledger` และ `bank_reconciliation` ก็ไม่อยู่ใน tier ที่ขาย
- งาน VendorBill family, เมนู AP, AP fingerprint, transaction seam ของ AP, supplier bank และข้อพิจารณา GL ใน §9.2 จึงไม่มีลูกค้าใช้ ขัดกับแนวทาง "ทำเฉพาะสิ่งที่อยู่ในแพ็กที่เปิดขาย" (เจ้าของ 3 ต.ค.)

### B8 ✔ — กลุ่มรายการที่ "เตรียมจ่ายได้" ผิดกลุ่ม

- เงื่อนไข §4.1 คือ CONFIRMED + มียอดค้าง
- รายจ่ายทุกใบยืนยันแล้วเป็น UNPAID เสมอ: การยืนยันไม่สร้าง payment; `expensePayment.create` มีสองจุดเท่านั้น คือบันทึกจ่ายด้วยมือ และอนุมัติใบแทนแบบ COMPANY (`prisma-expense.repository.ts:581, 2686`) ใบเสร็จเงินสดที่จ่ายแล้วจึงเข้าเงื่อนไขทั้งหมด
- ส่วนบิลที่ **ยังไม่จ่ายจริง** ระบบเก็บเป็นฉบับร่างตาม flow check-bill: "เก็บรายการนี้เป็นฉบับร่างไว้ก่อน เมื่อจ่ายแล้ว ให้กลับมาส่งรูปใบเสร็จ" (`apps/web/src/features/expenses/ExpensesPages.tsx:636-716`) จึง **ไม่เข้า** เงื่อนไข CONFIRMED
- ผล: รายการในหน้าเตรียมจ่ายคือของที่จ่ายไปแล้ว ส่วนของที่ต้องเตรียมจ่ายจริงเข้ามาไม่ได้ spec ไม่มีคำว่า check-bill เลย
- ต้องตัดสินก่อน: จะเก็บข้อเท็จจริง "จ่ายแล้วตอนซื้อ" ที่ไหน และบิลที่ยังไม่จ่ายจะยืนยันเป็นหนี้ได้อย่างไรโดยไม่ชนกติกา check-bill

### B9 ✔ — ทางเข้าที่แก้สถานะจ่ายมีมากกว่าที่ §7.5 นับ

- spec §8: "ไม่มี endpoint ยกเลิก ExpensePayment ทีละรายการ" → มีแล้ว `POST expenses/:expenseId/payments/:paymentId/cancel` (`apps/api/src/modules/expenses/presentation/http/expense.controller.ts:588-592`)
- มี `POST expenses/:expenseId/reopen` (CONFIRMED → NEEDS_REVIEW โดยเก็บ payments ไว้) ซึ่งเปลี่ยนยอดสุทธิใต้ชุดที่อนุมัติแล้วได้ (`:582-586`)
- reject ก็มีเงื่อนไขของตัวเอง
- จุดรวมกติกาคือ `readExpenseCorrectionCapabilities` ซึ่งคืน `recordPaymentBlocker`, `reopenBlockers`, `cancelBlocker` ต่อ payment และ `rejectBlocker` (`apps/api/src/modules/expenses/infrastructure/expense-void-blocker.ts:21-72`) การจองยอดต้องเข้าไปอยู่ตรงนี้ ไม่ใช่เขียน guard คู่ขนาน
- ทางใบแทน COMPANY จ่ายได้ก่อนยืนยันและไม่ emit event `expense.payment_recorded` ○ hook ใบสำคัญจ่ายจึงต้องอยู่ใน repository ไม่ใช่ฟัง event

## 4. ระดับสูง: field และข้อมูลเทียบโค้ดจริง

### 4.1 ข้อที่ spec ถูก

| ข้ออ้างใน spec | ผล | หลักฐาน |
|---|---|---|
| `ExpensePayment.amount` เทียบ `netPayableAmount` | ถูก ✔ | field จริง: `grandTotalAmount`, `netPayableAmount`, `paidAmount`, `outstandingAmount` (เก็บจริง), `paymentStatus` |
| `whtInputJson` มีแล้ว, RATE เป็นเปอร์เซ็นต์, AMOUNT เป็นบาท | ถูก ○ | `packages/contracts/src/expenses.ts`, `expense-wht-input.logic.ts` |
| `recordPaymentAtomic` เปิด transaction ของตัวเอง | ถูก ○ | ReadCommitted + `withinTx` callback |
| ใบแทน COMPANY สร้าง payment เอง, PERSONAL_ADVANCE ไม่สร้าง | ถูก ✔ | `prisma-expense.repository.ts:2683-2699` |
| จ่ายใบเบิกไม่สร้าง ExpensePayment ให้ projection | ถูก ○ | `prisma-reimbursement.repository.ts:3681-3706` |
| `payment-voucher.pdf` เดิมคือใบสำคัญรับเงิน | ถูก ○ | ไม่มีเลข ไม่เก็บไฟล์ |
| AP replay ไม่เทียบ fingerprint | ถูก ○ และกว้างกว่า: มีทางที่สามคือ return ตาม `paymentNumber`; catch เป็น catch-all; ไม่มี column fingerprint |
| handoff list `take: 200`, ตรวจแค่ company | ถูก ○ | `wht-certificate-handoff.use-case.ts:166-181` |
| `WhtCertificate` หมวด/อัตราเดียว, ไม่มี `WhtCertificateLine` | ถูก ○ | `schema.prisma:5639-5759` |
| `pdfAttachmentId` ไม่ถูกเขียน | ถูก ○ ดาวน์โหลดซ้ำ re-render ด้วยค่าลายเซ็นปัจจุบัน ไฟล์จึงต่างจากครั้งแรกได้ |
| void รายจ่ายไม่มี guard หนังสือรับรอง | **ถูก และเป็นช่องโหว่ที่มีอยู่จริง** ✔ ดู H1 |
| หลังซื้อ 249→1999 ไม่มี refetch ชัดเจน | ถูก ○ shell ที่ไม่ล็อกอาศัย focus/poll 60 วินาที |
| ไม่มีแถวสิทธิ์ = null = ถือว่ามีทุกฟีเจอร์ | ถูก ✔ รวม `wht_50bis` |

### 4.2 ข้อที่ spec ผิดหรือขาด

**H1 ✔ — void รายจ่ายที่ออก 50 ทวิแล้วทำได้ (บั๊กปัจจุบัน).** `ExpenseVoidBlocker` มีแค่ `accounting_period_locked`, `tax_period_locked`, `posting_unresolved`, `expense_not_voidable` (`packages/contracts/src/expenses.ts:1817-1823`) ส่วน `certificate_issued` เป็นตัวกันของ reopen เท่านั้น และ void จาก CONFIRMED ไม่ retire tax events/handoff (`prisma-expense.repository.ts:2963`) ร้านในแพ็กที่ขายไม่มี journal จึงไม่มี period lock มาช่วยกัน ควรแก้แยกจาก spec นี้ได้เลย

**H2 ✔ — expense ไม่มี revision.** spec §9.1 ต้องการ "source revision" แต่ `ExpenseRecord` ใช้ `updatedAt` เป็น CAS ซึ่งเปลี่ยนทุกครั้งที่มี payment ของชุดอื่น และบางจุดจงใจคงค่าไว้ ○ ต้องใช้ hash ของ field ที่มีผล (แบบอย่าง: `expenseTaxSourceChecksum`)

**H3 ✔ — `ExpensePayment` ไม่มีที่เก็บบัญชีและสลิป.** field จริง: `amount`, `currency`, `paymentMethod`, `paidAt`, `bankAccountRef` (ข้อความอิสระ ≤128 ที่เว็บไม่เคยส่ง), `idempotencyKey`, `payloadFingerprint`, `status`, posting fields ไม่มีบัญชีบริษัท ไม่มีปลายทาง ไม่มี reference แยก ไม่มีสลิป สลิปแนบได้ที่ระดับรายจ่ายเท่านั้น และ allowlist ของ attachment target ปิด ○ ต้องเพิ่ม target ใหม่ fingerprint v1 ครอบ field คงที่ การเพิ่ม field ต้องขึ้น version

**H4 ○ — สลิปเดียวหลายรายจ่ายทำให้ล็อกลาม.** funding guard ล็อกตามไฟล์แนบร่วม ถ้าผูกสลิปใบเดียวกับหลาย `expense.record` การเบิกของรายการใดรายการหนึ่งจะบล็อกทั้งหมด สลิปต้องผูกกับ settlement

**H5 ✔ — WHT header fields มีแล้วและบังคับตอนยืนยัน.** `whtCategoryCode`, `whtRate` (เปอร์เซ็นต์), `vendorEntityKindSnapshot` อยู่บน `ExpenseRecord` และ handoff อ่านจากชุดนี้ ○ ยืนยันรายจ่ายที่มี WHT ต้องมีประเภทผู้รับและหมวดเงินได้ spec §9.2 เขียนเหมือน header fields เป็นของที่ "จะเพิ่มตามแผนเก่า" ความไม่ตรงที่มีจริงคือ tax event อ่าน `taxCategory` แต่ handoff อ่าน `whtCategoryCode` ○

**H6 ○ — §10.4(3,5) บรรยาย endpoint ที่ไม่มีใครเรียก.** `POST tax/wht-certificates` (รับ payee/rate จาก DTO) ต้องใช้ `tax.certificate.issue` ซึ่งผูก `thai_tax` ไม่มี web caller และ Enterprise เรียกไม่ได้ ทางที่ใช้จริงคือ issue-from-handoff: รับแค่ handoff id อ่าน prefill ที่ตรึงไว้ และ commit certificate + เลข + สถานะ handoff ใน transaction เดียว ความเสี่ยงออกซ้ำข้ามสองทางยังมีแต่แฝงอยู่

**H7 ✔ — ร้าน 249 ไม่มีหน้าจอแนบหนังสือรับรองภายนอก.** สิทธิ์ read/link ไม่ gate แต่ UI อยู่ใน AP hub เท่านั้น ฝั่ง expenses ไม่มีโค้ดเรียก external link เลย spec สัญญา "249 แนบหนังสือรับรองภายนอกได้" (§6.1) แต่ทะเบียนที่เสนอซ่อนเมื่อไม่มี `thai_tax` ต้องระบุหน้าจอสำหรับ 249 ให้ชัด

**H8 ✔ — หน้าใหม่ใต้ `/expenses/*` ถูก gate ของ expenses บัง.** module gate ของรายจ่ายคือ permission `expense.*` 11 ตัว และมีคอมเมนต์กำกับว่า `reimbursement.read` ต้องไม่ทำให้เมนูรายจ่ายโผล่เมื่อ expenses ปิด (`apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:160-180`) route rule `/expenses` ใช้ชุดเดียวกัน (`route-permissions.ts:111-117`) ผู้ใช้ที่มีแค่สิทธิ์เบิกคืนหรือสิทธิ์เอกสารใหม่จะได้หน้า Forbidden ขัด acceptance N01 ของ spec เอง การย้าย "เบิกคืน" เข้าใต้กลุ่มรายจ่ายจึงต้องแก้ทั้ง gate, route rule และ test ที่ล็อกไว้

**H9 — รายละเอียดอื่นที่ไม่ตรง**

- ✔ "ลายเซ็นของฉัน" ไม่อยู่ในเมนูเป็นการตัดสินที่มี test ล็อก (`web-core-workspace.spec.ts:535`) spec §5 เสนอใส่กลับโดยไม่อ้างเหตุผล
- ✔ ช่อง "ทดลอง 15 ใบ" ใช้กับร้านเก่าเท่านั้น: การทดลองปิดสำหรับร้านสมัครใหม่ตั้งแต่ 20 ก.ย. (`packages/contracts/src/plan-term.ts:9-13`)
- ✔ `wht.certificate.prepare` ไม่มีใน registry; `wht.certificate.correct` มี
- ✔ การกระจาย permission ใหม่ให้ร้านเดิมมีกลไกแล้ว (`apps/api/prisma/sync-permissions.ts`, `company-role-backfill.registry.ts`) ต้นทุนของ §6.5(6) ต่ำกว่าที่ spec เขียน
- ○ ไม่มี permission ขึ้นต้น `payment.` ชนกัน แต่ชื่อ pack `pack.payment.*` เป็นของใบเสร็จขายแล้ว
- ○ ผู้เห็นเลขบัญชีเต็มของใบเบิกแคบกว่าที่ spec เขียน: ผู้เบิก ผู้อนุมัติของใบนั้น หรือผู้มีสิทธิ์จ่ายที่อ่านใบนั้นได้ ทะเบียนใบสำคัญจ่ายใต้สิทธิ์ใหม่จะขยายวงโดยไม่ตั้งใจ
- ○ ใบเบิก: outbox ของการจ่ายอยู่ใน transaction แล้ว ข้อ "บางส่วน fire-and-forget" ของ §12.1 เหลือจริงเฉพาะ audit และ commit เลข
- ○ `SupplierBankAccount` เก็บแค่ 4 หลักท้าย พิมพ์เลขปลายทางเต็มไม่ได้ (เฉพาะ AP ซึ่งไม่ได้ขาย)

## 5. Dependency ของ module ที่ spec ไม่ได้นับ

| Module / จุด | ทำไมเกี่ยว |
|---|---|
| `workflow` (template catalog การแจ้งเตือน) | spec ไม่มีการแจ้งเตือนเลย ผู้อนุมัติและผู้จ่ายจะไม่รู้ว่ามีงานรอ ต้องออกแบบตามกติกา "แจ้งเฉพาะคนที่เกี่ยว" |
| `line-ai` (ERP tools อ่าน ExpensePayment, deep links, W00 manifest) | คำตอบ "จ่ายแล้ว/ยังไม่จ่าย" ของ AI, ลิงก์จาก LINE อย่างน้อย 9 รูปแบบเข้า `/expenses/*` และ `/reimbursements/*` ○ และ manifest ที่ hash ไฟล์เว็บ |
| `accounting-documents` (สมุดรายรับรายจ่าย) | อ่าน `ExpensePayment` โดยตรง ✔ acceptance R01 ต้องรวม |
| `banking` (match source) | รู้จัก EXPENSE_PAYMENT / SUPPLIER_PAYMENT / REIMBURSEMENT_PAYMENT ○ ห้ามเพิ่ม settlement เป็น candidate |
| `data-model-core` | numbering reuse ได้; attachment target allowlist ต้องเพิ่ม; ไม่มี PDF module กลาง (SVG→PDF อยู่ใน expenses) ○ |
| `data-rights` | ข้อมูลบัญชีผู้รับเงินภายนอกเป็นข้อมูลส่วนบุคคล spec ไม่มีเรื่องเก็บรักษา ลบ หรือส่งออก |
| `billing` + `sales-console` | B4: แถวสิทธิ์, `STARTER_FEATURE_KEYS`, snapshot ของดีล |
| `system-partner-management` (หน้าผู้ดูแล) | วันนี้มีการ์ดเมนู 29 ใบ สวิตช์ย่อย 42 ตัว ○ เพิ่มอีก 4 ตัวที่ความหมายต่างกันสองแบบ |
| `feature-launch` | ชื่อ `ExecutionAttempt` ถูกใช้แล้ว |
| wording guards | `sold-features-wording.spec.ts`, plain-thai QA, `one-source-words.spec.ts` ○ ป้ายใหม่ต้องผ่าน |
| user guide / package card / LINE catalog / partner preview | ทั้งหมดสมมติ "หนึ่งการ์ดระดับบนต่อหนึ่งเมนู" ○ การย้ายเบิกคืนเข้าใต้รายจ่ายกระทบทุกจุด |

## 6. ช่องว่างในตัว spec เอง

**G1 — ปิดสวิตช์แล้วหนี้ค้างตาย.** §6.2/§11.2: ปิด feature เตรียมจ่ายแล้วชุดค้างถูกแช่แข็งพร้อมยอดจอง และ "ไม่ปล่อย reservation เพราะ feature OFF" ผลคือหนี้ที่ถูกจองบันทึกจ่ายไม่ได้ทุกทางจนกว่าจะเปิดกลับ กรณีปิดแค่ entry ก็ตันเหมือนกัน เพราะ §7.5 ให้ "เปิดชุดเดิม" แต่เข้าหน้าไม่ได้ ขัดกับสิทธิ์ retained ของใบเบิกที่รับประกันว่าใบค้างต้องจ่ายได้ ต้องมีทางปล่อยยอดจอง (เช่น ยกเลิกชุดได้แม้ปิด)

**G2 — สถานะไม่ครบ.** §7.2 ไม่มีสถานะ "กำลังจ่าย" ทั้งที่ §7.4 มี attempt; "ถอนกลับไปแก้" จาก APPROVED ไม่ระบุสถานะปลายทาง; `STALE` เป็นแค่ reason จึงไม่ชัดว่าใครถอนอนุมัติและยอดจองยังอยู่ไหม; source ถูก void/reopen ขณะถูกจอง จะบล็อกหรือ cascade ไม่ได้ตัดสิน

**G3 — key อยู่ใต้ `expenses` แต่รับใช้ใบเบิกและ AP.** ร้านที่ปิด expenses แต่เปิด reimbursement จะไม่มีเตรียมจ่าย/ใบสำคัญจ่าย ขณะที่ §6.5(7) ห้ามเพิ่ม dependency และ N01 สัญญาว่าผู้ใช้เบิกคืนอย่างเดียวต้องเห็นลูก

**G4 — ใบสำคัญจ่ายออกอัตโนมัติหรือเมื่อกด ไม่ได้ตัดสิน.** §8 มีทั้ง "worker ออก" และ "ค้างรอผู้มีสิทธิ์" เมื่อการจ่ายตรงคือปุ่มเดียว การออกอัตโนมัติจะได้เลขและ PDF ต่อใบเสร็จเงินสดทุกใบ ไม่มีคิวหรือการแจ้งเตือนสำหรับเอกสารที่ค้าง

**G5 — ชุดผูกผู้รับด้วย identity ที่ยืนยัน.** §4.1 ห้ามจับคู่จากชื่อ แต่ `vendorCounterpartyId` ของรายจ่ายจาก OCR/LINE เป็น null ได้ ใบเสร็จส่วนใหญ่จึงรวมชุดไม่ได้จนกว่าจะผูกคู่ค้าทีละใบ

**G6 — ยอดจ่ายต้องตรงที่อนุมัติทุกสตางค์.** ต่างแม้ 1 บาทต้องส่งตรวจใหม่ก่อนจ่าย ไม่มี tolerance

**G7 — attempt ที่ถูกทิ้งล็อกถาวร.** "ไม่ปล่อยเพราะหมดเวลา" ร้านคนเดียวต้อง resolve ของตัวเอง

**G8 — acceptance 61 ข้อไม่มีข้อใดครอบ** การแจ้งเตือน, journey บนจอ 390px, ลิงก์จาก LINE หลังย้ายเมนู, billing lockout ของ B4, ดีลฝ่ายขาย, check-bill, cancel payment, reopen

**G9 — ไม่มีเรื่องวันครบกำหนด.** มี `plannedPayDate` แต่ไม่มีมุมมอง "ต้องจ่ายเมื่อไร" หรือการเตือน ซึ่งเป็นเหตุผลหลักที่ร้านจะใช้การเตรียมจ่าย

**G10 — ขนาดงานเกินมติข้อ 1.** มติคือ "เชื่อมของเดิมและเพิ่มส่วนที่ขาด" แต่ spec รวม model ใหม่ 4 ตัว, permission ราว 10 ตัว, key 4 ตัว, สัญญา session ใหม่, ย้ายจุดรับรู้ WHT, certificate หลายบรรทัด, แบบพิมพ์ใหม่ 2 ชนิด และจัดเมนูใหม่ ไว้ในรุ่นเดียว

## 7. ความยากง่ายต่อผู้ใช้

| เรื่อง | วันนี้ | ตาม spec |
|---|---|---|
| U1 จ่ายรายจ่ายหนึ่งรายการ (เจ้าของคนเดียว) | เปิดรายการ → การ์ดจ่ายเติมยอด/วิธี/วันที่ให้ → กดปุ่มเดียว ○ (`ExpenseReviewPage.tsx:1686-1731`) | สร้างชุด → กรอกวัน/ผู้รับ/บัญชี → ส่งตรวจ → อนุมัติ → เริ่มจ่าย → บันทึกจ่ายพร้อม reference+สลิป → เอกสาร = 6–7 ขั้น |
| U2 จ่ายใบเบิก | อนุมัติแล้วฟอร์มจ่ายเปิดเอง: สลิป + ติ๊กยืนยันบัญชี ○ | เพิ่มขั้นเตรียม/อนุมัติชุด/เริ่มจ่ายซ้อนบนของเดิม |
| U3 เมนูรายจ่ายบนมือถือ | drawer กว้าง 289px ลูก 6 รายการ (7 ถ้าเปิดบันทึกด้วยมือ) แถวสูงราว 35px ○ | 10–11 รายการ ต้องเลื่อนใน drawer; "เบิกคืน" ซึ่งพนักงานใช้บ่อยที่สุดตกจากระดับบนไปเป็นลูก |
| U4 ทางจ่ายสองทาง | ทางเดียว | จ่ายตรงกับจ่ายผ่านชุดอยู่คู่กัน และทางตรงถูกเบี่ยงเมื่อมียอดจอง ผู้ใช้ต้องเข้าใจว่าทำไมปุ่มเดิมกดไม่ได้ |
| U5 ชื่อเอกสาร | ใบรับรองแทนใบเสร็จ, ใบสำคัญรับเงิน, หนังสือรับรองหัก ณ ที่จ่าย | เพิ่มใบเตรียมจ่ายและใบสำคัญจ่าย รวม 5 ชื่อที่คล้ายกัน ต้องมีคำอธิบายหนึ่งบรรทัดใต้ชื่อทุกที่ |
| U6 รายการรอเตรียมจ่าย | มีมุมมอง "ยังไม่จ่าย" และ KPI อยู่แล้ว ✔ (`ExpensesPages.tsx:2417`) | รายการเดียวกันโผล่อีกหน้า และเต็มไปด้วยใบเสร็จที่จ่ายแล้ว (B8) |
| U7 ผู้อนุมัติ | ได้รับแจ้งเตือนงานเบิกคืนตามกติกาที่มี ○ | ไม่มีการแจ้งเตือน ต้องเปิดเว็บมาดูเอง |
| U8 ผู้ดูแลระบบ | สวิตช์ชนิดเดียวต่อรายการ + ค่าตั้งหน้าจอ 1 ตัว | เพิ่ม 4 ตัว สองความหมาย ("ปิดฟีเจอร์" กับ "ซ่อนทางเข้า") บนหน้าที่มีสวิตช์ราว 70 ตัว |

สิ่งที่ spec ทำถูกด้านนี้: กำหนดจอ 390px, ใช้คำไทยกับ action, ไม่แสดง enum, แยกข้อความ "ไม่มีสิทธิ์" ออกจาก "บริการยังไม่เปิด"

แบบอย่างที่ reuse ได้: หน้า journey ของใบเบิก (`ReimbursementJourneyPage` + `ThemedSteps` + `buildJourneySteps`) แสดงเฉพาะขั้นของผู้ดู ข้ามขั้นตาม policy และเปิดฟอร์มจ่ายต่อทันทีหลังอนุมัติ ○

## 8. สิ่งที่ spec ถูกและควรเก็บ

- เอกสารใหม่เป็น projection ของ payment เดิม ไม่เพิ่ม ledger หรือแหล่งเงินสดใหม่
- snapshot ตรึงตอนออก ไม่ดึง master ปัจจุบันมาพิมพ์ทับ; preview ไม่กินเลข
- ชื่อชนกับ `payment-voucher.pdf` เดิม ต้องใช้ชนิด/route ใหม่
- funding guard ต้องตรวจสองทิศทาง (ชุดเตรียมจ่าย ↔ ใบเบิก/ใบแทน)
- ไม่ย้าย permission จ่ายของ source ไปอยู่ใต้ capability ใหม่
- ช่องว่างจริงที่ชี้ถูก: H1 (void), handoff list ไม่มี scope/pagination, PDF 50 ทวิไม่ตรึงไฟล์, AP replay ไม่เทียบ payload, refresh หลังอัปเกรด, expense ไม่มีที่เก็บบัญชี/สลิปต่อการจ่าย
- มติข้อ 4 (249 เก็บข้อมูล อัปเกรดแล้วออกได้จากข้อมูลเดิม) **เป็นจริงอยู่แล้วในระบบ** เพราะ handoff ถูกเขียนทุกแพ็กเกจ เหลือแค่หน้าจอสำหรับ 249 (H7)

## 9. ข้อเสนอขอบเขตรุ่นแรก และเรื่องที่ต้องให้เจ้าของตัดสิน

### 9.1 ขอบเขตที่เล็กที่สุดที่ยังตอบมติทั้งห้าข้อ

1. **ใบสำคัญจ่ายจาก payment ที่มีอยู่** — ปุ่มบนรายจ่ายที่จ่ายแล้ว ได้เลขและไฟล์ตรึง พร้อมทะเบียน; เพิ่มที่เก็บสลิปและบัญชีปลายทางต่อการจ่าย (H3)
2. **เตรียมจ่ายสำหรับรายจ่ายอย่างเดียว** — หน้า journey หน้าเดียวตามแบบใบเบิก; ยอดจองเข้า `readExpenseCorrectionCapabilities`; มีการแจ้งเตือน; ทางจ่ายตรงปุ่มเดียวยังอยู่
3. **หน้ารายการ 50 ทวิ** — รายการ handoff ตามสิทธิ์ ลิงก์ไปปุ่มออก/แก้/ใบแทนที่มีอยู่ และทางแนบฉบับภายนอกสำหรับ 249; ผูก `wht_50bis`
4. **แก้ H1** แยกเป็นงานแก้บั๊ก

ไม่อยู่ในรุ่นแรก: AP family, ใบเบิกในชุดเตรียมจ่าย, ย้ายจุดรับรู้ WHT, certificate หลายบรรทัด, key `.web_entry`, สัญญา session ใหม่, execution attempt, การย้ายเบิกคืนเข้าใต้กลุ่มรายจ่าย

### 9.2 เรื่องที่ต้องตัดสิน

| # | คำถาม | คำแนะนำ |
|---|---|---|
| D1 | สวิตช์ต่อฟีเจอร์เป็นแบบไหน: สิทธิ์ใน catalog (ปิดจริงทั้งหน้าบ้านหลังบ้าน ต้องเตรียมแถวสิทธิ์ของทุกร้านและดีลก่อน) หรือค่าตั้งหน้าจอแบบบันทึกด้วยมือ (ซ่อนทางเข้าอย่างเดียว) | เลือกแบบเดียวต่อฟีเจอร์ รวม 2 ตัว ไม่ใช่ 4; และตัดสินค่าเริ่มต้น (บันทึกด้วยมือใช้ "ไม่แสดง") |
| D2 | ใบเบิกเข้าชุดเตรียมจ่าย/ใบสำคัญจ่ายในรุ่นแรกหรือไม่ | ไม่เข้า ใบเบิกมี journey, เลขการจ่าย, สลิป และแบบพิมพ์แล้ว |
| D3 | ทำส่วนเจ้าหนี้การค้าในรุ่นแรกหรือไม่ | ไม่ทำ ไม่อยู่ในแพ็กที่ขาย |
| D4 | ใบสำคัญจ่ายออกอัตโนมัติทุกครั้งที่บันทึกจ่าย หรือออกเมื่อกด | ออกเมื่อกด; อัตโนมัติเฉพาะการจ่ายที่มาจากชุดเตรียมจ่าย |
| D5 | จุดรับรู้ WHT: คงตอนยืนยันรายจ่าย หรือย้ายไปตอนจ่าย | คงไว้ในรุ่นแรก; เรื่องวันที่จ่ายบนหนังสือรับรองให้นักบัญชีตัดสินแยก |
| D6 | รายการไหนนับว่า "ยังไม่จ่าย" และบิลที่ยังไม่จ่ายจะยืนยันเป็นหนี้ได้อย่างไร (ชนกับ check-bill) | ต้องตัดสินก่อนออกแบบหน้าเตรียมจ่าย |
| D7 | เบิกคืนย้ายเข้าใต้เมนูรายจ่ายหรือคงเป็นเมนูระดับบน | คงไว้ระดับบน |

## 10. วิธีตรวจและข้อจำกัด

- อ่านโค้ดจาก worktree แยกที่ `origin/main` `9b94ce059`; ผู้ช่วยตรวจ 6 ส่วน (expenses, AP/ledger/bank, reimbursements, WHT/tax, entitlements/billing, web shell) แล้วผู้ตรวจเปิดไฟล์ยืนยันข้อที่ทำเครื่องหมาย ✔ ด้วยตนเอง
- ข้อที่ผู้ช่วยสองส่วนตอบไม่ตรงกัน (void มี guard หนังสือรับรองหรือไม่) ตัดสินจากการอ่านโค้ดเอง: reopen มี, void ไม่มี
- ไม่ได้รัน test, ไม่ได้เปิดเบราว์เซอร์, ไม่ได้แตะ UAT/Production; ข้อ UX เป็นการอ่านโค้ดหน้าจอ ไม่ใช่การเดินจริงบนมือถือ
- `origin/main` คือโค้ดล่าสุด ไม่เท่ากับสิ่งที่ลูกค้าใช้อยู่ทุกบรรทัด: Production ล่าสุดตามบันทึกอยู่หลัง main เล็กน้อย (งาน billing รอบ 10 ต.ค. ยังไม่ deploy) ซึ่งไม่กระทบข้อค้นพบในเอกสารนี้
