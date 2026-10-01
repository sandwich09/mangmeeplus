# บั๊กในระบบปัจจุบันที่พบระหว่างรีวิวสวิตช์ทางเข้าบันทึกด้วยมือ

วันที่: 2026-10-01 · ฐานที่ตรวจ: `origin/develop` `ae13970b0` (โค้ดที่อ้างในเอกสารนี้เหมือนกันบน `origin/main`)

Status: **OPEN — ยังไม่มีการแก้ เอกสารนี้เขียนให้ผู้รับงานแก้แยกได้โดยไม่ต้องอ่านงานสวิตช์**

ที่มา: [รีวิวอิสระ](manual-expense-web-entry-flag-review-2026-10-01-th.md) หัวข้อ 4 · งานสวิตช์ทางเข้า ([spec v3.0](../specs/manual-expense-web-entry-flag-spec-th.md)) **ไม่รวม** การแก้บั๊กในเอกสารนี้ และบั๊กเหล่านี้ไม่ต้องรองานสวิตช์

## สรุป

| รหัส | เรื่อง | กระทบผู้ใช้วันนี้หรือไม่ | ขนาดการแก้ |
| --- | --- | --- | --- |
| B1 | ปุ่มลบรายจ่ายฉบับร่างใช้ไม่ได้กับบทบาทที่สร้างจากเทมเพลตการเงิน | กระทบ ถ้ามีร้านใช้เทมเพลตนี้ (ยังไม่ทราบ) | guard หนึ่งบรรทัด + test |
| B3 | ดีลที่เลือกเมนูหลังกด “ล้างทั้งหมด” เก็บเฉพาะเมนูแม่ จ่ายเงินแล้วเมนูย่อยค่าใช้จ่ายถูกปิดทั้งหมด | กระทบ ถ้ามีดีลที่สร้างด้วยวิธีนี้ (ยังไม่ทราบ) | helper หนึ่งตัว + จุดเรียกหนึ่งจุด + test |
| B4 | ระบบชำระเงินฝังขนาด catalog 62 และ 60 ไว้ในโค้ด | ยังไม่กระทบ จะกระทบเมื่อมีการเพิ่ม key ใดก็ตามเข้า catalog | test ดักหนึ่งข้อ (ขั้นต่ำ) |

รหัส B2 ไม่อยู่ในรายการ เพราะบั๊ก LINE idempotency key ที่เอกสารเดิมเรียกว่า F03 ถูกแก้แล้วใน `6fddca795` (2026-09-29) ห้ามเปิดงานแก้ซ้ำ

วิธีที่ผู้รีวิวยืนยัน: รันโค้ดจริงของ repo ในหน่วยความจำ ไม่ใช้ฐานข้อมูล ไม่ใช้เบราว์เซอร์ จึง **ไม่ทราบ** ว่ามีร้านหรือดีลใน production ที่ได้รับผลแล้วหรือไม่

## B1 ปุ่มลบรายจ่ายฉบับร่างใช้ไม่ได้กับบทบาทที่สร้างจากเทมเพลตการเงิน

### อาการ

ผู้ใช้ที่มีสิทธิ์ `expense.delete` แต่ไม่มี `expense.update` เห็นปุ่มลบบนรายจ่ายฉบับร่าง กดแล้วได้ 403 “Insufficient permissions.” รายการไม่ถูกลบ

### ทางทำซ้ำ

1. ในร้านใดก็ได้ สร้างบทบาทจากเทมเพลตการเงิน (`tpl.x.finance`, `tpl.trading.finance`, `tpl.service.finance` หรือ `tpl.ecom.finance`) แล้วมอบให้พนักงานหนึ่งคน
2. พนักงานเปิดหน้ารายการค่าใช้จ่าย เลือกรายการสถานะฉบับร่างที่ลบได้ ปุ่มลบแสดง
3. กดลบ → `DELETE /v1/companies/:companyId/expenses/:expenseId` ตอบ 403

ทำซ้ำโดยไม่ใช้ฐานข้อมูล: เรียก `DenyByDefaultGuard.canActivate` ด้วย handler `ExpenseController.prototype.removeExpense` และ context ที่ `permissions` มาจาก pack ของเทมเพลตข้างต้น ผลคือ `ForbiddenException` ส่วน context ที่มีเพียง `expense.update` ผ่าน guard

### สาเหตุและไฟล์

| จุด | ตำแหน่ง | พฤติกรรม |
| --- | --- | --- |
| HTTP guard | `apps/api/src/modules/expenses/presentation/http/expense.controller.ts:252-255` | `@RequirePermissions('expense.update')` |
| Use case | `apps/api/src/modules/expenses/application/use-cases/delete-expense.use-case.ts:204-205` | ยอมรับ `expense.delete` หรือ `expense.update` ของผู้สร้างร่าง |
| ปุ่มบนเว็บ | `apps/web/src/features/expenses/expenses.model.ts:1485,1507-1514`, ใช้ที่ `ExpensesPages.tsx:2582` และ `ExpenseReviewPage.tsx:966` | แสดงเมื่อมี `expense.delete` หรือเป็นเจ้าของที่มี `expense.update` |
| ที่มาของสิทธิ์ | `apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts:286-289` | `pack.expense.finance` มี `expense.delete` ไม่มี `expense.update` |
| เทมเพลต | `apps/api/src/modules/employee-access/domain/registries/role-template.registry.ts:20-26,55,107,127,153` | `FINANCE_PACKS` ใช้ `pack.expense.view` กับ `pack.expense.finance` ไม่มี `pack.expense.self` |
| บทบาทเดิมที่ได้สิทธิ์ย้อนหลัง | `apps/api/src/modules/employee-access/domain/registries/company-role-backfill.registry.ts:84-91` | บทบาทกำหนดเองที่มี `expense.void` ได้ `expense.delete` เพิ่ม |

บทบาทในระบบ (`ROLE_GRANTS`) ไม่มีบทบาทใดถือ `expense.delete` โดยไม่มี `expense.update` จึงไม่ได้รับผล

### การแก้ที่เล็กที่สุด

เปลี่ยน guard ของ `removeExpense` เป็น `@RequireAnyPermission('expense.delete', 'expense.update')` (decorator มีอยู่แล้วใน `apps/api/src/common/security/permissions.decorator.ts`) ไม่แก้ use case เพราะ use case ตรวจเจ้าของ สถานะ retention เอกสารที่ผูกอยู่ สาขา และ audit ครบอยู่แล้ว

ห้ามเปลี่ยนเป็น delete อย่างเดียว เพราะจะตัดเส้นทางเจ้าของลบร่างของตน และห้ามแก้ที่เทมเพลตแทน เพราะบทบาทกำหนดเองที่มีอยู่แล้วจะยังติดบั๊ก

### Test ที่ต้องเพิ่ม

1. ใช้ `DenyByDefaultGuard` กับ metadata ของ controller จริง: สิทธิ์จาก `pack.expense.view` + `pack.expense.finance` ผ่าน, `expense.update` อย่างเดียวผ่าน, ไม่มีทั้งสองได้ 403
2. test เทียบคู่: ทุกเทมเพลตใน `ROLE_TEMPLATES` ที่ทำให้เว็บแสดงปุ่มลบ (`expense.delete`) ต้องผ่าน guard ของ `removeExpense`
3. `delete-expense.use-case.spec.ts` เดิมต้องยังเขียว (update-only ลบของคนอื่นไม่ได้, delete-only ลบได้ตาม scope)
4. e2e เดิม `e2e/expenses.spec.ts` (ลบร่างของตนได้ 204) ต้องยังผ่าน

### ผลข้างเคียงที่ต้องยืนยันก่อน merge

วันนี้เมื่อร้านปิด `expenses.manual` ทุกบทบาทลบร่างไม่ได้ เพราะ `expense.update` ถูกตัด หลังแก้ ผู้ถือ `expense.delete` (OWNER, ADMIN, FINANCE และบทบาทจากเทมเพลตการเงิน) จะลบร่างได้แม้ร้านปิด `expenses.manual` เพราะ `expense.delete` เป็นของ `pack.expense.finance` ไม่ใช่ของ `expenses.manual` ผู้รีวิวเห็นว่าถูกต้องตามความหมายของสิทธิ์ แต่เป็นพฤติกรรมที่เปลี่ยน ต้องให้เจ้าของงานรับทราบ

ถ้าแก้แล้ว ให้ปรับแถว `DELETE /v1/companies/:companyId/expenses/:expenseId` ใน `docs/specs/feature-entitlement-runoff-matrix.json` ที่ยังระบุ `permissionKeys: ["expense.update"]` (แก้ค่าในแถวเดิม ไม่เพิ่มแถว เพราะ `runoff-matrix.catalog.spec.ts` เทียบยอดรวมต่อ family)

### ที่ยังไม่ทราบ

- มีร้านใน production ที่สร้างบทบาทจากเทมเพลตการเงิน หรือมีบทบาทกำหนดเองที่ถือ `expense.delete` โดยไม่มี `expense.update` หรือไม่ ตรวจได้ด้วยการอ่านบทบาทของร้านเทียบสองสิทธิ์นี้ (อ่านอย่างเดียว)
- เทมเพลตการเงินตั้งใจให้ไม่มี `expense.update` หรือไม่ หมายเหตุในโค้ดระบุว่าเทมเพลต “mirror the system FINANCE role” แต่บทบาท FINANCE ในระบบมี `expense.update` เรื่องนี้เป็นคำถามแยก ไม่ต้องตอบเพื่อแก้ B1

## B3 ดีลที่เก็บเฉพาะเมนูแม่ทำให้เมนูย่อยค่าใช้จ่ายถูกปิดทั้งหมดเมื่อจ่ายเงิน

### อาการ

ฝ่ายขายสร้างดีลที่มีเมนู “ค่าใช้จ่ายและใบเสร็จ” ลูกค้าจ่ายเงินแล้ว ร้านเหลือสิทธิ์ตรวจและยืนยันรายจ่าย แต่ดูรายการ อัปโหลดใบเสร็จ บันทึกด้วยมือ หมวดหมู่ หลักฐาน และลายเซ็นไม่ได้

### ทางทำซ้ำ

1. ในหน้าสร้างดีลของฝ่ายขาย กด “ล้างทั้งหมด” แล้วกดเลือกเมนู “ค่าใช้จ่ายและใบเสร็จ” (จะเลือกเมนูอื่นเพิ่มด้วยก็ได้) บันทึกและส่งอนุมัติ
2. รายการเมนูของดีลที่ถูกเก็บมี `expenses` แต่ไม่มี key เมนูย่อย `expenses.*` เลย
3. ลูกค้าเปิดหน้าชำระเงิน: รายการ “เมนูต่อไปนี้จะหยุดใช้” แสดงเมนูย่อยค่าใช้จ่ายทั้งหกรายการ ขณะที่การ์ดดีลบอกว่าได้เมนู “ค่าใช้จ่ายและใบเสร็จ”
4. ลูกค้าจ่ายเงิน → แถวสิทธิ์ `expenses.list`, `expenses.upload`, `expenses.manual`, `expenses.categories`, `expenses.evidence`, `expenses.signatures` ถูกเขียนเป็นปิด

ทำซ้ำโดยไม่ใช้ฐานข้อมูล (ผู้รีวิวรันแล้วบนโค้ดปัจจุบัน): เรียก `billingFeaturePlan(db, companyId, ['expenses', 'dashboard_notifications'])` กับร้าน EXPLICIT 62 แถวตามชุด starter ผลคือ `expenses=true` และเมนูย่อยทั้งหกเป็น false เมื่อนำแถวผลลัพธ์ไปคำนวณสิทธิ์ จากชุด `expense.read`, `expense.create`, `expense.update`, `expense.receipt.upload`, `expense.review`, `expense.confirm` เหลือเพียง `expense.review` กับ `expense.confirm`

ดีลที่เริ่มจากค่าเริ่มต้นของฟอร์ม (ชุด starter ครบ) หรือกดปุ่ม “ชุดเริ่มต้น” ไม่ได้รับผล เพราะมี key เมนูย่อยครบ การปิดแล้วเปิดเมนูเดิมก็ไม่ได้รับผล เพราะการปิดไม่ลบ key เมนูย่อย

### สาเหตุและไฟล์

| จุด | ตำแหน่ง | พฤติกรรม |
| --- | --- | --- |
| ปุ่ม “ล้างทั้งหมด” | `apps/web/src/features/sales-console/SalesDealFormPage.tsx:117` | ตั้งรายการเมนูเป็นว่าง |
| เลือกเมนู | `apps/web/src/features/sales-console/sales-console.logic.ts:389-402` (`toggleMenuSelection`) | ใส่ parent และ `binding.entitlementKeys` เท่านั้น |
| Binding ของค่าใช้จ่าย | `packages/contracts/src/menu-entitlements.ts:168-173` | `entitlementKeys: ['expenses']` ไม่มี key เมนูย่อย |
| ถือว่าเลือกแล้ว | `sales-console.logic.ts:381-383` (`isMenuSelected`) และ `menu-entitlements.ts:523-534` (`packageMenuLabels`) | `['expenses']` นับว่ามีเมนูนี้ |
| Server เก็บตามที่ส่งมา | `apps/api/src/modules/sales-console/domain/sales-deal.logic.ts:149-151,180` | ตรวจเพียงว่า key อยู่ในรายการที่อนุญาต |
| จุดส่งเข้า billing | `apps/api/src/modules/billing/application/billing.service.ts:508` | ส่ง `deal.featureKeys` ตรง ๆ |
| Billing คำนวณเป้าหมาย | `apps/api/src/modules/billing/application/billing-feature-entitlements.ts:68-73,96` | key ใน catalog ที่ไม่อยู่ในรายการเป็น false ขยายเฉพาะจากลูกไปหาสิ่งที่ลูกต้องพึ่ง ไม่ขยายจากแม่ไปหาเมนูย่อย |

หมายเหตุในโค้ดของหน้าดีลระบุว่าตั้งใจให้ “a deal snapshot and an admin grant mean the same thing” แต่ทางผู้ดูแล (`toggleMenuCard`) ปล่อยเมนูย่อยให้ตามเมนูแม่ ส่วน billing เขียนแถวปิดให้เมนูย่อยทุกตัวที่ไม่ถูกระบุ สองทางจึงให้ผลต่างกัน

เมนูอื่นที่ผูกกับ parent อย่างเดียว: `employee_access` และ `company_settings` ไม่ได้รับผลเพราะ billing บังคับเปิดเมนูย่อยของ platform invariant เสมอ ส่วน `dashboard_notifications` มีเมนูย่อยสองรายการที่ชุด starter ก็ไม่รวมอยู่แล้ว จึงให้ผลเท่ากับการซื้อแพ็กเกจปกติ ผลที่ต่างจากความคาดหวังจึงอยู่ที่ `expenses`

### การแก้ที่เล็กที่สุด

เพิ่ม helper pure หนึ่งตัวใน `packages/contracts` สำหรับดีลเท่านั้น: ถ้ารายการของดีลมี key เมนูแม่ที่ catalog มีเมนูย่อย และ **ไม่มี key เมนูย่อยของแม่นั้นเลยแม้ตัวเดียว** ให้ถือว่าได้เมนูย่อยทั้งหมดของแม่นั้นที่อยู่ใน `SALES_DEAL_ALLOWED_FEATURE_KEYS` แล้วเรียก helper นี้ที่จุดส่งรายการของดีลเข้า `billingFeaturePlan` (`billing.service.ts:508`)

- แก้ที่จุดอ่าน จึงครอบดีลที่ถูกเก็บไปแล้วโดยไม่ต้องแก้ snapshot ซึ่งตรึงไว้
- ไม่เปลี่ยนความหมายของการซื้อแพ็กเกจปกติ เพราะ `TIER_FEATURE_PRESETS` ไม่ผ่าน helper นี้ (ถ้าขยายทุกกรณี ชุด starter จะเริ่มเปิดเมนูย่อยของ `dashboard_notifications` ซึ่งวันนี้ปิด)
- ดีลที่ระบุเมนูย่อยบางตัวเองยังหมายถึงเฉพาะตัวที่ระบุ
- ทางเลือกที่ไม่พอ: แก้เฉพาะ `toggleMenuSelection` ให้ใส่ key เมนูย่อยตอนเลือก จะช่วยเฉพาะดีลใหม่ ดีลที่เก็บไปแล้วยังติดบั๊ก

### Test ที่ต้องเพิ่ม

1. helper: `['expenses']` ได้เมนูย่อยค่าใช้จ่ายที่อนุญาตครบ, `['expenses', 'expenses.list']` ไม่ถูกขยาย, key ที่ไม่มีเมนูย่อยไม่เปลี่ยน, ผลไม่มี key นอก `SALES_DEAL_ALLOWED_FEATURE_KEYS`
2. `billing-feature-entitlements.spec.ts`: เป้าหมายของดีลที่ผ่าน helper แล้ว แถว `expenses.*` เป็น true และ `impact.removed` ไม่มีเมนูย่อยค่าใช้จ่าย
3. `sales-console.logic.spec.ts`: รายการที่ได้จาก “ล้างทั้งหมด” แล้วเลือกเมนูค่าใช้จ่าย เมื่อผ่าน helper ต้องเท่ากับชุดเมนูค่าใช้จ่ายของ starter
4. test เดิมของการซื้อแพ็กเกจปกติต้องไม่เปลี่ยนผล

### ที่ยังไม่ทราบ

- มีดีลใน production ที่ snapshot มี `expenses` โดยไม่มี `expenses.*` หรือไม่ ตรวจได้ด้วยการอ่าน `PackageChangeRequest` ที่ `kind = 'SALES_DEAL'` แล้วดูรายการเมนูใน `offerSnapshotJson` (อ่านอย่างเดียว)
- มีร้านที่จ่ายดีลแบบนี้ไปแล้วหรือไม่ สัญญาณคือร้านที่ `expenses` เปิดแต่ `expenses.*` ปิดทุกแถว และแถวเหล่านั้นถูกเขียนโดย transition ที่มี `commandId` ขึ้นต้นด้วย `billing-package:` ร้านเหล่านี้ต้องได้รับการเปิดเมนูย่อยคืนโดยผู้ดูแลหลังยืนยัน helper ไม่ซ่อมแถวที่เขียนไปแล้ว
- ผู้รีวิวไม่ได้เปิดหน้าดีลในเบราว์เซอร์ ทางทำซ้ำข้อ 1 อ่านจากโค้ดของฟอร์ม

## B4 ระบบชำระเงินฝังขนาด catalog ไว้ในโค้ด

### อาการ (ยังไม่เกิด)

ถ้ามีการเพิ่ม key ใดก็ตามเข้า `FEATURE_CATALOG` ร้านที่มีแถวสิทธิ์เก็บอยู่ (60 หรือ 62 แถว) จะขอใบเสนอราคาแบบ pin ไม่ได้ และใบแจ้งหนี้ที่จ่ายข้ามช่วง deploy ถูกพัก ด้วย `BILLING_ENTITLEMENT_REVIEW_REQUIRED`

### ทางทำซ้ำ

ผู้รีวิวรันแล้ว: เพิ่ม key สมมติหนึ่งตัวเข้า `FEATURE_CATALOG` และ `ALL_FEATURE_ENTITLEMENT_KEYS` ในหน่วยความจำ แล้วเรียก `billingFeaturePlan` กับร้าน EXPLICIT 62 แถว ได้ข้อผิดพลาด “ข้อมูลสิทธิ์เมนูเดิมยังไม่พร้อม กรุณาติดต่อทีมงานก่อนชำระเงิน”

### สาเหตุและไฟล์

| จุด | ตำแหน่ง | พฤติกรรม |
| --- | --- | --- |
| รูปชุดแถวที่ยอมรับ | `apps/api/src/modules/billing/application/billing-feature-entitlements.ts:14-16,51-59` | ต้องตรง catalog ปัจจุบันทุกแถว หรือเป็นรูป 60 แถวรุ่นก่อน WHT โดยเงื่อนไขฝังเลข `CANONICAL.length === 62` และ `PRE_20260923_CATALOG.length === 60` |
| plan ที่ pin ไว้ | เดียวกัน `:112-116` | `pinned.rows.length !== CANONICAL.length` ถูกปฏิเสธ |
| ผลเมื่อปฏิเสธ | `apps/api/src/modules/billing/application/billing-reconciler.service.ts:588-611`, `billing-plan-menus.ts:105-109,121-132` | invoice เป็น `HELD`, การย้ายเมนูเป็น `BLOCKED` |
| ไม่มีใครเติมแถว | `infra/kamal/release.py:956-957` | release รัน normalizer แบบ `--dry-run` เท่านั้น |

test เดิม “a complete 60-key EXPLICIT shop can quote and buy” (`billing-feature-entitlements.spec.ts`) จะแดงเมื่อ catalog โต แต่ข้อความที่แดงคือ “expected 60, actual 61” ซึ่งชวนให้แก้ตัวเลข ถ้าเปลี่ยน 62/60 เป็น 63/61 ร้าน 60 แถวรุ่นก่อน WHT จะถูกปฏิเสธแทน

### การแก้ที่เล็กที่สุด

ขั้นต่ำ ทำได้ทันทีโดยไม่เปลี่ยนพฤติกรรม: เพิ่ม test ดักหนึ่งข้อใน `billing-feature-entitlements.spec.ts` ที่ pin `ALL_FEATURE_ENTITLEMENT_KEYS.length` กับค่าที่โค้ดสมมติ พร้อมข้อความที่บอกชัดว่า “เพิ่ม key เข้า catalog ต้องเพิ่มรูปชุดแถวรุ่นก่อนใน billingFeaturePlan และให้ applyBillingFeaturePlan รับ plan ที่ pin ก่อน catalog โต ห้ามแก้เพียงตัวเลข”

เมื่อจะเพิ่ม key จริง (ทำพร้อมงานนั้น): เปลี่ยนเงื่อนไขเป็นรายการรูปชุดแถวในอดีตที่ระบุชัดตามชุด key ที่ถูกเพิ่มแต่ละรอบ ระบุค่าของ key ใหม่เมื่อร้านยังไม่มีแถว และให้ plan ที่ pin ก่อน deploy apply ได้

งานสวิตช์ทางเข้าตาม spec v3.0 ไม่เพิ่ม key เข้า catalog จึงไม่ชนบั๊กนี้ ถ้าเจ้าของเลือกทางเลือกของ D1 (เป็น key ใน catalog) B4 กลายเป็นงานที่ต้องทำก่อน

### Test ที่ต้องเพิ่ม

1. test ดักข้างต้น
2. เมื่อแก้เต็ม: ร้าน 62 แถวกับ catalog ที่โตหนึ่ง key quote และ apply ได้, ร้าน 60 แถวยังผ่าน, plan ที่ pin ก่อน catalog โต apply ได้โดย invoice ไม่ `HELD`

### ที่ยังไม่ทราบ

- จำนวนร้านใน production ที่มี 60 แถว, 62 แถว หรือยังไม่มีแถวเลย
- มีแผนเพิ่ม key เข้า catalog ในงานอื่นที่กำลังทำอยู่หรือไม่ ถ้ามี งานนั้นจะชน B4 ก่อน

## กติกาสำหรับผู้รับงาน

- เริ่มจาก `origin/develop` ล่าสุด และทำซ้ำอาการก่อนแก้ ถ้าทำซ้ำไม่ได้ให้บันทึกและหยุด
- แก้ทีละบั๊ก คนละ commit ไม่รวมกับงานสวิตช์ทางเข้า
- test ใหม่ฝั่ง API ต้องมีที่ที่ CI รัน: script `test` ของ `apps/api/package.json` และบางขั้นใน `.github/workflows/ci.yml` ระบุไฟล์ spec ทีละไฟล์ ให้เขียน test ลงในไฟล์ spec ที่ CI รันอยู่แล้ว หรือขออนุญาตเจ้าของก่อนเพิ่มไฟล์ในรายการ เพราะเป็นการแก้ `package.json` ที่ไม่ใช่ dependency
- ไม่แก้ข้อมูลของลูกค้าเพื่อซ่อมผล การซ่อมร้านที่ได้รับผลแล้วเป็นการตัดสินของเจ้าของ
- ก่อนอ่านหรือแตะ cloud ให้อ่าน [cloud operations](../runbooks/cloud-environment-operations.md) และก่อน deploy ให้ทำตาม [deployment protocol](../runbooks/uat-production-v2-deployment.md)
