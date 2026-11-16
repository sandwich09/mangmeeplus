# 01 — ภาพรวมโครงการและความต้องการทางธุรกิจ (Project Overview & Business Requirements)

**วัตถุประสงค์ของเอกสาร:** เอกสารฉบับนี้เป็นเล่มเปิดของชุดเอกสารปิดโครงการ MangmeePlus / WatchDog-BMS ทำหน้าที่บันทึกวิสัยทัศน์ผลิตภัณฑ์ ปัญหาที่แก้ กลุ่มลูกค้าและผู้มีส่วนได้ส่วนเสีย อภิธานศัพท์ แค็ตตาล็อกแพ็กเกจที่ขายจริง (ถึงแพ็ก ENTERPRISE_1999) ตารางหลัก "ฟีเจอร์ × แพ็ก" ซึ่งเป็นตัวกำหนดขอบเขตให้เอกสารฉบับอื่นทั้งหมด บทบาทผู้ใช้ กระบวนการทางธุรกิจตั้งแต่ต้นจนจบ กฎธุรกิจที่ครอบทั้งผลิตภัณฑ์ และประวัติโครงการ ทุกข้อเท็จจริงอ้างจากโค้ดเป็นหลัก ส่วนเอกสารใน `docs/` ใช้ประกอบเจตนาและประวัติเท่านั้น จุดที่ spec กับโค้ดไม่ตรงกันระบุไว้ชัดในหัวข้อ 10

**Derived from commit:** `08850deaf` (`origin/main`, 2026-11-10) — checkout `closeout-docs-main`

**รหัสความต้องการ:** `BR-<nnn>` (Business Requirement) — เอกสารฉบับอื่นใช้ `FR-<AREA>-<nnn>` / `NFR-<nnn>` และอ้างกลับมาที่ BR ในเล่มนี้
**รหัส AREA ที่เอกสารพี่น้องใช้:** `CORE` (auth / access / onboarding / platform), `EXP` (ค่าใช้จ่าย การเบิกจ่าย เอกสารบัญชี), `TAX` (ภาษี บัญชีแยกประเภท ธนาคาร รายงาน), `CRM` (CRM การขาย สต๊อก จัดซื้อ workflow ผู้บริหาร), `LINE` (LINE และ AI), `BILL` (billing แพ็กเกจ system console sales console)

## สารบัญ

1. [ภาพรวมผลิตภัณฑ์](#1-ภาพรวมผลิตภัณฑ์)
2. [อภิธานศัพท์](#2-อภิธานศัพท์)
3. [แค็ตตาล็อกแพ็กเกจ (จากโค้ด)](#3-แค็ตตาล็อกแพ็กเกจ-จากโค้ด)
4. [ตารางหลัก ฟีเจอร์ × แพ็ก (Master feature-by-tier matrix)](#4-ตารางหลัก-ฟีเจอร์--แพ็ก-master-feature-by-tier-matrix)
5. [บทบาทและประเภทผู้ใช้](#5-บทบาทและประเภทผู้ใช้)
6. [กระบวนการทางธุรกิจระดับสูง](#6-กระบวนการทางธุรกิจระดับสูง)
7. [กฎธุรกิจ ข้อจำกัด และสมมติฐาน](#7-กฎธุรกิจ-ข้อจำกัด-และสมมติฐาน)
8. [ประวัติและไทม์ไลน์โครงการ](#8-ประวัติและไทม์ไลน์โครงการ)
9. [ทะเบียน Business Requirements (BR)](#9-ทะเบียน-business-requirements-br)
10. [สิ่งที่ตรวจไม่ได้ และจุดที่เอกสารไม่ตรงกับโค้ด](#10-สิ่งที่ตรวจไม่ได้-และจุดที่เอกสารไม่ตรงกับโค้ด)
11. [นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)](#11-นอกขอบเขตแพ็ก-1999-มีโค้ดแต่ไม่ได้ขาย)

---

## 1. ภาพรวมผลิตภัณฑ์

### 1.1 ชื่อและที่มา

| รายการ | ค่า | หลักฐาน |
|---|---|---|
| ชื่อ repository / ชื่อทางเทคนิค | WatchDog-BMS (package scope `@watchdog-bms/*`) | `README.md`, `packages/contracts` |
| ชื่อทางการค้าที่ลูกค้าเห็น | มั่งมี / MangmeePlus (อีเมลติดต่อในโค้ดใช้โดเมน `mangmeeplus.com`) | `apps/api/src/modules/system-partner-management/domain/logic/plan-term.logic.ts:29-30` |
| ประเภทผลิตภัณฑ์ | SaaS แบบ multi-tenant สำหรับ SME ไทย: เว็บแอปเป็นพื้นที่ทำงานเต็มรูปแบบ และ LINE เป็นช่องทางผู้ช่วย AI | `docs/product/vision.md`, `README.md` (ย่อหน้าสุดท้าย) |
| โครงสร้างโค้ด | monorepo: `apps/api` (NestJS + Prisma), `apps/web` (Next.js), `apps/ai-gateway`, `apps/workers`, `packages/contracts`, `packages/config`, `packages/design-tokens`, `e2e/`, `infra/`, `scripts/` | `README.md` |

### 1.2 วิสัยทัศน์ตามเอกสาร และความจริงตามโค้ด

**วิสัยทัศน์ตามเอกสาร** (`docs/product/vision.md`): "SME Business OS" ที่เว็บเป็นพื้นที่ทำงานครบทุกด้าน (สินค้า/สต๊อก การขาย เอกสารบัญชี ค่าใช้จ่าย การเบิกจ่าย ภาษีไทย CRM การอนุมัติ รายงาน) และ LINE เป็นผู้ช่วย AI สำหรับถามข้อมูล รับสรุป และรับการแจ้งเตือน โดยมีหลักการสำคัญคือ AI แยกออกจาก ERP core ผ่าน AI Gateway, AI อธิบาย/แนะนำ/ร่างได้ แต่การกระทำที่ย้อนไม่ได้ต้องให้ผู้ใช้อนุมัติ และทุกการเปลี่ยนแปลงสำคัญต้องตรวจสอบย้อนหลังได้

**ความจริงตามโค้ด ณ commit `08850deaf`:** โมดูล ERP ถูกสร้างไว้กว้างตามวิสัยทัศน์ (มีโมดูล `inventory`, `crm`, `crm-inbox`, `procurement`, `banking`, `ledger`, `tax`, `reports`, `workflow`, `accounting-documents` ใต้ `apps/api/src/modules/`) แต่ **สิ่งที่ขายจริงผ่านแพ็กเกจแคบกว่านั้นมาก** — `TIER_FEATURE_PRESETS` (`packages/contracts/src/menu-entitlements.ts:496-501`) ให้ทุกแพ็กที่มีราคาได้ชุดฟีเจอร์ "starter" ชุดเดียวกัน คือ

- หน้าแรก/การแจ้งเตือน (`dashboard_notifications`)
- ค่าใช้จ่ายและใบเสร็จ (`expenses` พร้อม submenu ทั้ง 6)
- การเบิกจ่าย (`reimbursement`)
- ผู้ช่วย AI ทาง LINE (`ai_line_assistant`)
- พนักงานและสิทธิ์ (`employee_access`) และตั้งค่าร้าน (`company_settings`) ซึ่งเป็น platform baseline

และแพ็ก ENTERPRISE_1999 เพิ่มเพียงสองฟีเจอร์ คือ ออก ภ.ง.ด.3/ภ.ง.ด.53 ในระบบ (`wht_pnd53`) และออกหนังสือรับรอง 50 ทวิในระบบ (`wht_50bis`) ผลิตภัณฑ์ที่ขายจริงจึงเป็น **"ระบบบันทึกค่าใช้จ่าย/ใบเสร็จและการเบิกจ่ายสำหรับ SME ที่ใช้ AI ทาง LINE อ่านใบเสร็จและตอบคำถาม"** ความแตกต่างระหว่างแพ็กอยู่ที่ **ความจุ** (จำนวนสาขา จำนวนผู้ใช้ จำนวนใบเสร็จที่ให้ AI อ่านต่อเดือน) ไม่ใช่ที่เมนู ยกเว้นสองฟีเจอร์ WHT ของ ENTERPRISE ฟีเจอร์ที่มีโค้ดแต่ไม่อยู่ในแพ็กใดถูกรวบรวมไว้ในหัวข้อ 11

### 1.3 ปัญหาที่แก้

จาก `docs/product/vision.md` และ `docs/product/business-model.md`: SME จำนวนมากทำงานผ่านสเปรดชีต แอปแชต ไฟล์ export จาก POS และบันทึกบัญชีที่ไม่เชื่อมกัน ทำให้ตัดสินใจช้า เอกสารค่าใช้จ่าย/การเบิกจ่ายกระจัดกระจาย พลาดกำหนดภาษี ติดตามการอนุมัติไม่ได้ และเจ้าของต้องแชร์รหัสผ่านเดียวกับพนักงานเพราะไม่มีการแยกสิทธิ์ ในขอบเขตที่ขายจริง ปัญหาที่ระบบแก้คือ

1. การเก็บใบเสร็จ/บิลให้เป็นหลักฐานทางบัญชีที่ครบถ้วน โดยถ่ายรูปส่งทาง LINE หรืออัปโหลดบนเว็บ แล้วให้ AI อ่านและสร้างรายการร่าง
2. การตัดสินว่าหลักฐานพร้อมใช้ทางภาษีหรือไม่ และการออกใบรับรองแทนใบเสร็จเมื่อหลักฐานไม่ครบ
3. การเบิกจ่ายของพนักงาน: ส่งคำขอ อนุมัติ ตรวจโดยฝ่ายการเงิน จ่ายเงิน ลงนาม
4. การส่งชุดหลักฐานให้นักบัญชี/สำนักงานบัญชี (evidence และ export)
5. การถามข้อมูลของร้านเป็นภาษาไทยธรรมดาผ่าน LINE โดยไม่ต้องเปิดเว็บ
6. (ENTERPRISE) การจัดทำ ภ.ง.ด.3/ภ.ง.ด.53 และหนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) จากรายการจ่ายในระบบ

### 1.4 กลุ่มลูกค้าเป้าหมาย

| ระดับ | กลุ่ม | ที่มา |
|---|---|---|
| หลัก | ร้านค้าปลีกขนาดเล็ก บริษัทซื้อมาขายไป ธุรกิจกระจายสินค้า ธุรกิจบริการ ผู้ขายออนไลน์ และ SME ที่เจ้าของบริหารเองและยังใช้สเปรดชีตกับแอปแชต | `docs/product/business-model.md` §Target Customers |
| รอง | นักบัญชี/สำนักงานบัญชีที่ดูแลลูกค้า SME, ที่ปรึกษาวางระบบ, ทีมเล็กที่โตเกิน POS หรือสเปรดชีต | เดียวกัน |

แบบฟอร์มสมัครเก็บประเภทธุรกิจ (`businessType`) สถานะจดทะเบียน VAT (`vatRegistered`) และช่องทางที่รู้จักระบบ (`discoverySource`: `WEBSITE`, `IG`, `TIKTOK`, `FACEBOOK`, `SALES`, `OTHER`) — `packages/contracts/src/external-signup.ts:7-57`

### 1.5 Personas

Persona ด้านค่าใช้จ่ายมาจาก `docs/product/expense-blueprint-gap-and-user-stories-th.md` §3 และจับคู่กับบทบาทในโค้ด (`apps/api/src/modules/auth/permission-registry.ts`)

| Persona | เป้าหมาย | บทบาทในระบบที่ใกล้ที่สุด |
|---|---|---|
| A — พนักงานหน้างาน (ผู้จ่ายเงิน) | ถ่ายรูปใบเสร็จส่งให้จบเร็วที่สุด ขอเบิกเงินคืน และรู้สถานะคำขอ | `STAFF` |
| B — เจ้าของกิจการ | เห็นภาพรวมรายจ่าย อนุมัติคำขอ ควบคุมสิทธิ์พนักงาน ซื้อ/เปลี่ยนแพ็กเกจ ถามข้อมูลทาง LINE | `OWNER` |
| C — นักบัญชี / สำนักงานบัญชี | ได้หลักฐานครบ ตรวจและยืนยันรายการ ส่งออกชุดเอกสาร จัดทำภาษีหัก ณ ที่จ่าย | `ACCOUNTANT`, `FINANCE` |
| ผู้จัดการ / ผู้อนุมัติ | อนุมัติคำขอเบิกและดูแลทีม | `MANAGER` |
| ผู้ดูแลบริษัท | ตั้งค่าบริษัท สาขา พนักงาน | `ADMIN`, `HR` |
| ผู้ตรวจสอบ | อ่านข้อมูลเพื่อตรวจโดยไม่แก้ไข | `AUDITOR_READONLY`, `COMPANY_VIEW` |
| ผู้ดูแลระบบของมั่งมี | เปิดร้าน ดูแลแพ็กเกจ billing นโยบาย การคืนเงิน สิทธิ์ข้อมูลส่วนบุคคล | `SYSTEM_ADMIN` |
| ทีมขายของมั่งมี | สร้างดีลราคาพิเศษ ลิงก์เดโม ตั๋วส่วนลดจากงานอีเวนต์ ติดตามร้านที่แนะนำ | `MANGMEE_SALES`, `MANGMEE_SALES_LEAD` |
| ผู้บริหารของมั่งมี | ดูรายงานผู้บริหารข้ามร้าน (การใช้งาน รายได้ ลูกค้า) | `MANGMEE_EXECUTIVE` และบทบาทเสริม 3 ตัว |

### 1.6 ผู้มีส่วนได้ส่วนเสีย

| ผู้มีส่วนได้ส่วนเสีย | ความสนใจ | ระบบรองรับอย่างไร |
|---|---|---|
| Owner ของผลิตภัณฑ์ (เจ้าของโครงการ) | ตัดสินใจทางธุรกิจทุกเรื่อง: ราคา แพ็ก การปิดช่วงทดลองฟรี การขึ้น production | มติของ Owner ถูกอ้างเป็นคอมเมนต์ในโค้ด (เช่น "Owner 2026-09-20", "Owner 2026-09-21") และในเอกสาร `docs/agent-memory/` |
| ร้านค้า (tenant) และพนักงานของร้าน | ใช้งานประจำวัน | `Company`, `CompanyMembership`, บทบาทมาตรฐานฝั่งร้าน 12 ตัว |
| สำนักงานบัญชีภายนอก | รับชุดหลักฐาน/ไฟล์ส่งออก | ฟีเจอร์ `expenses.evidence` (รายละเอียดในเอกสาร EXP) |
| กรมสรรพากร (ทางอ้อม) | รูปแบบเอกสารภาษี ภ.ง.ด.3/53, 50 ทวิ | ฟีเจอร์ `wht_pnd53`, `wht_50bis` (รายละเอียดในเอกสาร TAX) |
| ผู้ให้บริการภายนอก | Stripe (รับชำระ: บัตรและ PromptPay), LINE (Messaging API / LIFF / LINE Login), ผู้ให้บริการโมเดล AI, AWS (โครงสร้างพื้นฐาน), ผู้ให้บริการอีเมล | `packages/contracts/src/billing.ts:7` (`STRIPE_API_VERSION`), `docs/runbooks/` |
| ที่ปรึกษากฎหมาย / PDPA | เอกสารข้อตกลงและการยอมรับ สิทธิ์เจ้าของข้อมูล | โมดูล `data-rights`, `packages/contracts/src/legal-acceptance.ts`, `docs/legal-review/` |

---

## 2. อภิธานศัพท์

### 2.1 ศัพท์ธุรกิจ/บัญชี/ภาษีไทย

| คำ | ความหมายในระบบ |
|---|---|
| ร้าน / บริษัท | tenant หนึ่งราย (Prisma model `Company`) ข้อความที่ลูกค้าเห็นใช้คำว่า "ร้าน" |
| สาขา | หน่วยย่อยของบริษัท (`Branch`) จำนวนสาขาที่เปิดได้ถูกจำกัดตามแพ็ก (`branchLimit`) |
| เจ้าของกิจการ | บทบาท `OWNER` ถือทุกสิทธิ์ที่บริษัทใช้ได้ |
| ค่าใช้จ่าย | รายการรายจ่ายของกิจการ (`ExpenseStatus`: `DRAFT`, `EXTRACTING`, `NEEDS_REVIEW`, `READY_FOR_CONFIRMATION`, `CONFIRMED`, `REJECTED`, `VOIDED`) |
| ใบเสร็จ / บิล / สลิป | เอกสารหลักฐานการจ่ายเงินที่ถ่ายรูปหรืออัปโหลด โค้ดเรียกโควตาการอ่านว่า "slip" (`monthlySlipLimit`) |
| หลักฐานทางบัญชี | ชุดเอกสารประกอบรายการค่าใช้จ่ายที่ดูและส่งออกให้งานบัญชี (`expenses.evidence`) |
| ใบรับรองแทนใบเสร็จ | เอกสารภายในที่ออกแทนเมื่อไม่มีใบเสร็จหรือใบเสร็จไม่ครบ ไม่มี entitlement แยก ใช้ได้เมื่อมีฟีเจอร์ `expenses` (`packages/contracts/src/feature-entitlements.ts:112-117`) |
| การเบิกจ่าย / ใบเบิก | คำขอเบิกเงินคืนของพนักงาน (`ReimbursementRequestStatus`: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `CANCELLED`, `FINANCE_REVIEW`, `READY_FOR_PAYMENT`, `PARTIALLY_PAID`, `PAID`, `VOIDED`) |
| คู่ค้า | ทะเบียนผู้ขาย/ลูกค้าที่ใช้ร่วมกันระหว่างฝั่งซื้อและฝั่งขาย (permission `accounting.counterparty.*`) |
| ใบเตรียมจ่าย / ใบสำคัญจ่าย | เอกสารเตรียมการจ่ายเงิน เรียก "ใบเตรียมจ่าย" ก่อนจ่ายและ "ใบสำคัญจ่าย" เมื่อจ่ายแล้ว (`packages/contracts/src/disbursement-vouchers.ts:21-23`;`DisbursementVoucherStatus`: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `PAID`, `CANCELLED`) |
| VAT / ภาษีมูลค่าเพิ่ม | ภาษีมูลค่าเพิ่ม 7% ระบบเก็บสถานะจดทะเบียน VAT ของร้าน และ billing มี `taxTreatment` สามแบบ |
| WHT / ภาษีหัก ณ ที่จ่าย | ภาษีที่ผู้จ่ายหักไว้ตอนจ่าย |
| ภ.ง.ด.3 / ภ.ง.ด.53 | แบบยื่นรายการภาษีหัก ณ ที่จ่ายรายเดือน (ผู้รับเป็นบุคคลธรรมดา / นิติบุคคล) ฟีเจอร์ `wht_pnd53` |
| 50 ทวิ | หนังสือรับรองการหักภาษี ณ ที่จ่าย ฟีเจอร์ `wht_50bis` |
| CIT / ภ.ง.ด.50 | ภาษีเงินได้นิติบุคคล อยู่ในฟีเจอร์ `thai_tax` ซึ่งไม่ได้ขาย |
| เลขประจำตัวผู้เสียภาษี | เลข 13 หลักของร้านหรือคู่ค้า |
| PromptPay | การชำระด้วย QR ผ่าน Stripe (`PROMPTPAY_ONCE`, `PROMPTPAY_RENEW`) |
| สตางค์ (satang) | หน่วยเงินที่โค้ดใช้เก็บทุกจำนวนเงิน: 100 สตางค์ = 1 บาท |

### 2.2 ศัพท์ระบบ

| คำ | ความหมาย |
|---|---|
| แพ็กเกจ / tier | ระดับการสมัครใช้ `PlanTierKey`: `FREE_TRIAL_15`, `STARTER_249`, `BASIC_499`, `PRO_999`, `ENTERPRISE_1999` (`packages/contracts/src/plan-term.ts:4`) |
| plan term | ช่วงอายุการใช้งานของร้าน (`CompanyPlanTerm`: `tierKey`, `branchLimit`, `employeeLimit`, `monthlySlipLimit`, `termStartAt`, `termEndsAt`, `warningDays`, `renewCount`, `termDisabledAt`) |
| feature entitlement | สิทธิ์ใช้ฟีเจอร์ระดับบริษัท หนึ่งแถวต่อ feature key (`CompanyFeatureEntitlement`) รายการ key ทั้งหมดอยู่ใน `FEATURE_CATALOG` |
| platform baseline | feature key ที่เปิดเสมอและไม่ใช่ตัวเลือกทางการค้า: `employee_access`, `company_settings` (`PLATFORM_INVARIANT_FEATURE_KEYS`) |
| preset | ชุด feature key สำเร็จรูป: `starter` (เริ่มต้น), `standard` (มาตรฐาน), `full` (ครบวงจร) — `FEATURE_PACKAGE_PRESETS` |
| menu binding / navKey | การผูกเมนูในเว็บกับ entitlement key และ gate permission (`MENU_ENTITLEMENT_BINDINGS`) |
| permission key | สิทธิ์ระดับการกระทำ เช่น `expense.confirm` ทะเบียนกลางอยู่ที่ `apps/api/src/modules/auth/permission-registry.ts` (`PERMISSIONS`) |
| capability pack | กลุ่ม permission ที่ผูกกับ feature entitlement ใช้ประกอบบทบาท (`apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts`) |
| role | บทบาทมาตรฐานของระบบ (`SYSTEM_ROLES`) หรือบทบาทที่ร้านสร้างเอง |
| plan manager | สมาชิกที่มี permission `company.plan.manage` คือผู้ที่ซื้อ/เปลี่ยนแพ็กเกจได้ |
| billing policy | นโยบายการขายที่ System Admin เผยแพร่เป็น revision (`BillingPolicy`): ราคา/Stripe Price, ภาษี, grace, การยกเลิก, การคืนเงิน |
| offer | ข้อเสนอขาย = tier + interval (`month`/`year`) เช่น `STARTER_249:month` (`BillingOfferKey`) |
| quote / checkout / attempt | ใบเสนอราคาก่อนจ่าย → Stripe Checkout → ความพยายามชำระหนึ่งครั้ง |
| receipt allowance / grant | สิทธิ์อ่านใบเสร็จที่ได้รับตามช่วงที่ชำระ (`receiptAllowance`, `BillingReceiptGrant`) |
| add-on | สินค้าเสริมซื้อครั้งเดียว: `CHAT_CREDIT` (เครดิตแชต) และ `RECEIPT_IMAGE` (สิทธิ์อ่านรูปใบเสร็จเพิ่ม) |
| เครดิตแชต / chat credit | หน่วยวัดการใช้ AI ฝั่งแชต: 1 เครดิต = ต้นทุน AI ที่มิเตอร์บันทึก 1 บาท (`packages/contracts/src/line-ai.ts:22-23`) |
| OCR / การอ่านรูป | การให้ AI อ่านรูปเอกสาร นับโควตาต่อการอ่านหนึ่งครั้ง (`CompanyOcrUsageEvent`) |
| sales deal | ข้อเสนอราคาพิเศษที่เซลล์สร้างให้ร้านหนึ่งร้าน (`SALES_DEAL_STATUSES`) |
| sales event / ตั๋วส่วนลดจากงาน | ตั๋วที่แจกในงานอีเวนต์ ใช้เป็นส่วนลดหรือเครดิต (`SALES_EVENT_TICKET_STATES`, `SALES_EVENT_REDEEM_PATHS`) |
| promotion campaign | แคมเปญ "ซื้อแพ็กแล้วได้เดือนฟรีและใบเสร็จเพิ่ม" (`BillingPromotionCampaign`, type `BONUS_MONTHS`) |
| demo link | ลิงก์ทดลองที่เซลล์สร้าง เปิดร้านเดโมชั่วคราว (`apps/api/src/modules/sales-demo/`) |
| LINE OA / LIFF | LINE Official Account และ LINE Front-end Framework ที่ใช้เชื่อมบัญชีและเปิดหน้าเว็บจากใน LINE |
| AI Gateway | บริการแยกจาก ERP core ทำหน้าที่ประสานงาน agent และเรียก API ที่ตรวจสิทธิ์แล้ว (`apps/ai-gateway`) |
| System Admin / platform tenant | ผู้ดูแลระบบของมั่งมี และ tenant ของแพลตฟอร์มเองที่บทบาททีมขาย/ผู้บริหารสังกัด |
| launch gate | ประตูเปิด/ปิดการเข้าถึงของลูกค้าระดับแพลตฟอร์ม (โมดูล `feature-launch`, permission `system.launch_gate.*`) |
| UAT / Production | สภาพแวดล้อมทดสอบก่อนขึ้นจริง และสภาพแวดล้อมจริง |

---

## 3. แค็ตตาล็อกแพ็กเกจ (จากโค้ด)

แหล่งข้อมูล: `packages/contracts/src/plan-term.ts`, `packages/contracts/src/billing.ts`, `packages/contracts/src/menu-entitlements.ts`, `packages/contracts/src/feature-entitlements.ts`, `packages/contracts/src/line-ai.ts`, และ `apps/api/src/modules/billing/`

### 3.1 ตารางแพ็กเกจ

ราคาเป็นค่าเริ่มต้นในโค้ด (`MONTHLY` ที่ `billing.ts:46`) ราคารายปี = ราคารายเดือน × 10 (`billing.ts:75`) ขีดจำกัดมาจาก `PLAN_TIER_PRESETS` (`plan-term.ts:133-141`)

| tierKey | ชื่อไทย (`labelTh`) | ชื่อที่ร้านเห็นบนเว็บ (`shopPlanTierLabel`) | ราคารายเดือน (บาท) | ราคารายปี (บาท) | สาขา (`branchLimit`) | ผู้ใช้ (`employeeLimit`) | ใบเสร็จ/เดือน (`monthlySlipLimit`) | สิทธิ์ใบเสร็จเมื่อจ่ายรายปี |
|---|---|---|---:|---:|---:|---:|---:|---:|
| `FREE_TRIAL_15` | ทดลองใช้ฟรี | ทดลองใช้ฟรี | 0 | — | 1 | 2 | 15 | — |
| `STARTER_249` | เริ่มต้น (STARTER) | เริ่มต้น | 249 | 2,490 | 1 | 2 | 30 | 360 |
| `BASIC_499` | เติบโต (BASIC) | เติบโต | 499 | 4,990 | 2 | 5 | 50 | 600 |
| `PRO_999` | มืออาชีพ (PRO) | มืออาชีพ | 999 | 9,990 | 5 | 10 | 100 | 1,200 |
| `ENTERPRISE_1999` | ธุรกิจ (ENTERPRISE) | ธุรกิจ | 1,999 | 19,990 | 10 | 30 | 500 | 6,000 |

หมายเหตุสำคัญ

- **ราคาและความจุปรับได้ด้วย policy:** `BillingPolicy.offerTerms` แทนค่าเริ่มต้นได้ต่อ tier (`monthlyPriceSatang`, `annualPriceSatang`, `monthlyReceiptAllowance`, `branchLimit`, `employeeLimit`) สำหรับการซื้อใหม่เท่านั้น (`billing.ts:62-81`) ค่าที่ใช้จริงใน production อยู่ใน policy revision ในฐานข้อมูล ไม่ได้อยู่ในโค้ด (ดูหัวข้อ 10)
- **จำนวนผู้ใช้นับรวมเจ้าของกิจการ** (`apps/api/src/modules/line-ai/application/use-cases/erp-package-tools.use-case.ts:171` — `usersNote`)
- **รายปีได้สิทธิ์อ่านใบเสร็จทั้งปีทันที:** `receiptAllowance = monthlyReceipts × 12` และ `receiptAllowanceCadence: 'PAID_PERIOD'` (`billing.ts:77`)
- **เครดิต AI ที่มากับทุกแพ็ก:** `DEFAULT_CHAT_CREDIT_SATANG = 5_000` คือ 50 เครดิตต่อรอบ ไม่ขึ้นกับ tier (`packages/contracts/src/line-ai.ts:23`; ใช้ที่ `apps/api/src/modules/line-ai/application/company-ai-budget-policy.ts:159`) ลำดับที่มีผล: ค่าที่ System Admin ตั้ง → ค่าจากดีลเซลล์ที่ยังไม่หมดอายุ → ค่าเริ่มต้น 50
- **ENTERPRISE_1999:** เปิดขายเมื่อ Owner ตัดสินใจ 2026-09-21 หลัง WHT/50 ทวิเสร็จ (`billing.ts:8`) โค้ดแสดงสถานะ `COMING_SOON` ("เร็ว ๆ นี้") ตราบที่ policy ยังไม่ผูก Stripe Price ของ tier นี้ (`billing.ts:70-80`)
- **แพ็กที่ขายผ่าน billing:** `BILLING_PAID_TIERS = ['STARTER_249', 'BASIC_499', 'PRO_999', 'ENTERPRISE_1999']` — `FREE_TRIAL_15` ซื้อไม่ได้

### 3.2 เมนูที่แต่ละแพ็กเปิด

`TIER_FEATURE_PRESETS` (`menu-entitlements.ts:496-501`):

| tier | feature keys ที่ได้ |
|---|---|
| `STARTER_249`, `BASIC_499`, `PRO_999` | `FEATURE_PACKAGE_PRESETS.starter.featureKeys` (17 keys — ดูตารางหัวข้อ 4) |
| `ENTERPRISE_1999` | starter 17 keys + `wht_pnd53` + `wht_50bis` (รวม 19 keys) |
| `FREE_TRIAL_15` | ไม่มีใน `TIER_FEATURE_PRESETS` (type เป็น `Exclude<PlanTierKey, 'FREE_TRIAL_15'>`) แต่ร้านที่สมัครเองถูกสร้างด้วย `modulePackage: 'starter'` (`apps/api/src/modules/external-signup/application/provision-signup.use-case.ts:291`) และ onboarding เขียนแถว entitlement ครบทุก key โดยเปิดเฉพาะ key ใน preset starter (`apps/api/src/modules/system-onboarding/application/use-cases/create-company-onboarding.use-case.ts:593-604`) ผลคือร้านทดลองได้ชุด starter เท่ากับแพ็กที่มีราคา |

ป้ายเมนูที่การ์ดแพ็กเกจ (เว็บและ LINE) แสดงคำนวณจาก `packageMenuLabels()` (`menu-entitlements.ts:523-534`): เมนูนับเมื่อ binding มีสถานะ `ready` ไม่ใช่ `contextual` และ **ทุก** entitlement key ของ binding อยู่ในชุดที่ซื้อ แล้วเติม "ผู้ช่วย AI ทาง LINE" ไว้หน้าสุดและ "ออกหนังสือรับรอง 50 ทวิในระบบ" ไว้ท้ายสุดเมื่อมี key นั้น

### 3.3 กฎช่วงทดลองใช้ (trial)

| กฎ | รายละเอียด | หลักฐาน |
|---|---|---|
| tier ของการสมัครเอง | ทุกร้านที่สมัครเอง (ฟอร์มเว็บหรือ LINE) ถูกสร้างบน `FREE_TRIAL_15` ไม่ว่าฟอร์มจะส่ง `requestedOfferKey` อะไรมา ค่านั้นเก็บเป็น attribution เท่านั้น | `plan-term.ts:154` (`SIGNUP_TRIAL_TIER_KEY`), `external-signup.ts:27-37` |
| **ไม่มีช่วงทดลองฟรีสำหรับร้านใหม่แล้ว** (Owner 2026-09-20) | term ของร้านใหม่ยาว 0 วัน (`SIGNUP_TERM_DAYS = 0`, `termEndsAt = termStartAt`) ซึ่ง `planTermLockReason` อ่านเป็น `no_package` และร้านถูกตั้งเป็น `DISABLED` ทันทีที่เปิด ("ยังไม่มีแพ็กเกจ") จนกว่าจะซื้อแพ็ก | `provision-signup.use-case.ts:451-480, 505-534, 579-584`; `plan-term.ts:46-50` |
| ช่วงทดลองแบบเดิม (ก่อน 2026-09-20) | 30 วัน 15 ใบ 1 สาขา 2 ผู้ใช้ (Owner 2026-09-04) ร้านที่ยังอยู่ในช่วงทดลองเดิมไม่ถูกแตะเมื่อ provisioning ทำซ้ำ (`update: {}`) | `plan-term.ts:134-136`, `billing.ts:354` (field `trial` ที่เลิกส่งแล้ว), `provision-signup.use-case.ts:469-473` |
| System Admin มอบ trial ได้ | admin ยังเลือก `FREE_TRIAL_15` ให้ร้านได้จากหน้า partner | `plan-term.ts:134-135` (คอมเมนต์) |
| โควตาใบเสร็จช่วงทดลอง | ใช้ `monthlySlipLimit` เต็มตั้งแต่วันแรก ไม่มี warm-up และข้อความตอบกลับมีบรรทัดนับ "อ่านครั้งที่ N จาก 15 ในช่วงทดลอง" | `apps/api/src/modules/system-partner-management/domain/logic/receipt-quota.logic.ts:33-41, 100-102` |
| ยกยอดใบเสร็จจาก trial เมื่อซื้อแพ็ก | เมื่อร้านที่ยังอยู่ในช่วงทดลองซื้อแพ็กเป็นครั้งแรก สิทธิ์อ่านที่เหลือ (ไม่เกิน 15) ถูกยกไปเป็น grant ชนิด `TRIAL_CARRYOVER` หมดอายุเมื่อสิ้นช่วงที่ชำระ | `apps/api/src/modules/billing/application/billing-trial-carryover.ts` |
| สิทธิ์ฟรีหลังหมดช่วงทดลอง (free expense drafts) | ร้าน `FREE_TRIAL_15` ที่ term หมดแล้วและ **ไม่เคยมีหลักฐานการซื้อใด ๆ** ยังส่งใบเสร็จให้ AI อ่านเป็น "ร่างต้นทาง" ได้ฟรีเดือนละ 3 ใบ (`FREE_EXPENSE_MONTHLY_LIMIT = 3`, แหล่งโควตา `FREE_MONTHLY_3`, รีเซ็ตต้นเดือนตามเวลากรุงเทพ) โดยสิทธิ์ถูกบีบให้เหลือชุดอ่าน/อัปโหลด/แก้ร่างเท่านั้น ไม่มี review/confirm | `apps/api/src/modules/system-partner-management/application/free-expense-access.ts`, `apps/api/src/modules/line-ai/application/free-expense-quota.ts:8-9` |

### 3.4 กฎ plan term

| กฎ | รายละเอียด | หลักฐาน |
|---|---|---|
| สถานะ term | `PlanTermState`: `ADMIN_HOLD` (พักการใช้งาน), `NO_PACKAGE` (ยังไม่มีแพ็กเกจ), `EXPIRED` (หมดอายุ), `TRIAL` (กำลังทดลองใช้), `ACTIVE` (ใช้งานได้) ลำดับความสำคัญตามนี้ | `plan-term.ts:37-70` |
| สถานะที่คำนวณ | `PlanTermDerivedState`: `ACTIVE` / `WARNING` / `EXPIRED` — `EXPIRED` ทันทีที่ `now >= termEndsAt` | `plan-term.logic.ts:44-62` |
| ความยาว term เริ่มต้น | 30 วัน (`DEFAULT_TERM_DAYS`) นับเป็นวันละ 24 ชั่วโมงพอดี ไม่ใช่เดือนปฏิทิน | `plan-term.logic.ts:31, 39-42` |
| การเตือนก่อนหมดอายุ | แจ้งเฉพาะ OWNER ที่ 7, 3, 1 วันก่อนหมด จุดละครั้งเดียวต่อ term (`WARNING_LADDER_DAYS`) ถ้า sweep หยุดไปหลายวันจะแจ้งเฉพาะจุดที่ลึกที่สุด | `plan-term.logic.ts:17-27, 69-81` |
| เมื่อหมดอายุ | sweep ตั้งบริษัทเป็น `DISABLED` และประทับ `termDisabledAt` ส่วนธุรกิจใช้ไม่ได้จนกว่าจะเลือกแพ็กเกจ แต่ **ข้อมูลยังอยู่ครบ** | `apps/api/src/modules/system-partner-management/application/use-cases/plan-term-sweep.use-case.ts`, `plan-term.logic.ts:147-158` |
| ร้านไม่มีแถว term | ถือเป็น legacy/grandfathered — ไม่จำกัดจนกว่า admin ตั้งค่า (fail open) | `plan-term.ts:58, 104` |
| ขีดจำกัดสาขา/ผู้ใช้ | เกินแล้วปฏิเสธพร้อมข้อความไทย (`branchLimitMessageTh`, `employeeLimitMessageTh`) | `plan-term.logic.ts:186-192` |
| tier เริ่มต้นของร้านที่ admin สร้าง | `STARTER_249` (`ONBOARDING_DEFAULT_TIER`) | `plan-term.logic.ts:33` |
| ขั้นถัดไปเมื่อขอเปลี่ยนแพ็กจาก LINE | `nextPlanTierKey()` ชี้ tier ถัดไปในลำดับ `FREE_TRIAL_15 → STARTER_249 → BASIC_499 → PRO_999 → ENTERPRISE_1999` | `plan-term.ts:160-174` |
| การปรับ term โดย admin | ต้องมี `commandId`, `expectedVersion`, `reason` และเก็บประวัติ (`PartnerPlanAdjustmentHistory`: `SET` / `RENEW`) | `plan-term.ts:108-130` |

### 3.5 รูปแบบการชำระและนโยบาย billing

| หัวข้อ | ค่า | หลักฐาน |
|---|---|---|
| ผู้ให้บริการ | Stripe, API version `2026-08-26.dahlia` | `billing.ts:7` |
| โหมด | `BillingMode`: `TEST` / `LIVE` | `billing.ts:11` |
| รอบบิล | `BillingInterval`: `month` / `year` | `billing.ts:35` |
| วิธีซื้อ | `BillingPurchaseMode`: `CARD_AUTO` (บัตร ตัดอัตโนมัติ), `CARD_ONCE` (บัตร ครั้งเดียว), `PROMPTPAY_ONCE` (QR ครั้งเดียว), `PROMPTPAY_RENEW` (QR ออกบิลทุกรอบ) | `billing.ts:36` |
| ชนิดการซื้อ | `INITIAL`, `REPEAT`, `RESTART`, `UPGRADE`, `FULL_PACKAGE_UPGRADE`, `SCHEDULED_CHANGE`, `ADVANCE_DEAL` | `billing.ts:173` |
| ประตูการกระทำ (action gates) | `BILLING_ACTIONS`: `new_sales`, `card_once`, `promptpay_once`, `promptpay_renew`, `plan_changes`, `portal_payment_method`, `portal_change_plan`, `portal_cancel_subscription`, `notification_delivery`, `refunds` — `portal_change_plan` ถูกบังคับปิดเสมอ | `billing.ts:39`, `apps/api/src/modules/billing/domain/billing-policy.ts:15-18` |
| นโยบายร่าง (`BILLING_DRAFT_POLICY`) | `paidStart: 'IMMEDIATE'`, `taxTreatment: 'NOT_VAT_REGISTERED'`, `graceDays: 7`, `cancellation: 'PERIOD_END'`, `planChanges: 'UPGRADE_PRORATED_DOWNGRADE_PERIOD_END'`, `debtRecovery: 'MANUAL_REVIEW'`, `refundPolicy: 'MANUAL_REVIEW'`, `consentRevision: 'billing-v2-upfront-annual'` | `billing.ts:142-146` |
| ขอบเขตค่าที่ policy ยอมรับ | `graceDays` 0–30; ราคา ≥ 1,000 สตางค์ และยอดรวม ≤ 99,999,999 สตางค์; ความจุ 1–1,000; Stripe Price ต้องไม่ซ้ำกัน; `NOT_VAT_REGISTERED` ห้ามแนบ tax rate | `billing-policy.ts:30-78` |
| การยกเลิก | มีผลเมื่อสิ้นรอบที่จ่ายแล้ว (`PERIOD_END`) | `billing.ts:121` |
| การเปลี่ยนแพ็ก | อัปเกรดคิดตามสัดส่วนทันที, ดาวน์เกรดมีผลเมื่อสิ้นรอบ | `billing.ts:122` |
| การคืนเงิน | พิจารณาด้วยคนเสมอ (`MANUAL_REVIEW`) มีวงเงินต่อคำสั่ง (`refundLimitSatang`) ถ้าไม่ตั้ง การคืนเงินเปิดไม่ได้ | `billing.ts:124-126`, `billing-policy.ts:83-86` |
| การจำกัดร้านที่ซื้อได้ | `salesCompanyIds`: ไม่ระบุ = ทุกร้าน, `[]` = ปิดขาย, ระบุรายการ = เฉพาะร้านนั้น (สูงสุด 100) | `billing.ts:136-137` |
| ผู้ซื้อได้ | สมาชิกที่มี `company.plan.manage` | `apps/api/src/modules/access-control/domain/logic/plan-manager.logic.ts` |

### 3.6 การคิดภาษีของค่าบริการ

`BillingTaxTreatment` มีสามค่า และ `quoteTotals()` คำนวณดังนี้ (`apps/api/src/modules/billing/domain/billing-policy.ts:132-136`)

| `taxTreatment` | ภาษี | ยอดก่อนภาษี | ยอดที่ชำระ |
|---|---|---|---|
| `NOT_VAT_REGISTERED` | 0 | = ราคา | = ราคา |
| `INCLUSIVE_VAT_7` | ราคา − round(ราคา × 100 / 107) | ราคา − ภาษี | = ราคา |
| `EXCLUSIVE_VAT_7` | round(ราคา × 7 / 100) | = ราคา | ราคา + ภาษี |

ค่าเริ่มต้นในโค้ดคือ `NOT_VAT_REGISTERED` ผู้ออกเอกสาร (`issuer`: ชื่อนิติบุคคล ที่อยู่ เลขผู้เสียภาษี 13 หลัก) เป็นส่วนหนึ่งของ policy

### 3.7 Add-on

ราคาและจำนวนเป็นค่าที่ Owner ยืนยันและฝังในโค้ด (`BILLING_ADDON_OFFERS`, `billing.ts:105-112`) ทุกรายการ **อายุ 12 เดือน** (`validityMonths: 12`, `billing.ts:102`) ซื้อแบบครั้งเดียวเท่านั้น (`CARD_ONCE` / `PROMPTPAY_ONCE`, `billing.ts:203`)

| offerKey | ชนิด (`productKind`) | จำนวนที่ได้ | ราคา (บาท) |
|---|---|---:|---:|
| `CHAT_50` | `CHAT_CREDIT` | 50 เครดิต (`quantityUnits` 5,000, `unitScale` 100) | 299 |
| `CHAT_100` | `CHAT_CREDIT` | 100 เครดิต | 549 |
| `CHAT_300` | `CHAT_CREDIT` | 300 เครดิต | 1,499 |
| `RECEIPT_IMAGE_20` | `RECEIPT_IMAGE` | 20 รูป | 349 |
| `RECEIPT_IMAGE_50` | `RECEIPT_IMAGE` | 50 รูป | 799 |
| `RECEIPT_IMAGE_100` | `RECEIPT_IMAGE` | 100 รูป | 1,499 |

กฎ add-on

- ไม่มี billing gate ของตัวเอง (Owner 2026-09-29 "no switches"): ข้อเสนอขายได้เมื่อ Stripe Price ถูกผูกใน `addOnPriceIds` ของ policy ที่ ACTIVE (`billing.ts:83-88, 130-132`)
- ต้องมีแพ็กเกจก่อนจึงซื้อได้ — `purchaseState` มีค่า `PACKAGE_REQUIRED` (`billing.ts:299-300`)
- System Admin ให้/เพิกถอน add-on ฟรีได้ผ่านคำสั่งที่ต้องอนุมัติ (`ADDON_ADMIN_GRANT` / `ADDON_ADMIN_REVOKE`) lot ที่ทีมงานให้มีอายุ 12 เดือนนับจากการอนุมัติ การเพิกถอนเอาได้เฉพาะหน่วยที่ยังไม่ใช้ของ lot ทีมงาน ไม่ใช่ของที่ลูกค้าซื้อ (`billing.ts:526-549`)
- ที่มาของ lot: `ADD_ON_PAID`, `ADD_ON_ADMIN`, `SALES_EVENT` (`billing.ts:538`)

### 3.8 โปรโมชัน ดีล และตั๋วส่วนลด

| กลไก | กฎ | หลักฐาน |
|---|---|---|
| Promotion campaign (release 1) | ชนิดเดียวคือ `BONUS_MONTHS` แม่แบบเดียวที่เผยแพร่ได้คือ `BILLING_PROMOTION_STARTER_TEMPLATE`: แพ็ก `STARTER_249` ราคา 249 บาท — รายเดือน: ฟรี 1 เดือน + ใบเสร็จ 30 ใบ (ฐาน 30); รายปี: ฟรี 1 เดือน + ใบเสร็จ 30 ใบ (ฐาน 360) ใช้ได้ครั้งเดียวต่อร้านต่อแคมเปญ มีช่วงวันเริ่ม/สิ้นสุด มีเพดานจำนวน (`cap`) พัก/จบได้ | `billing.ts:624-668` |
| สิทธิประโยชน์ต่อการซื้อหนึ่งครั้ง | เลือกได้อย่างเดียว: `NORMAL` / `PROMOTION` / `EVENT_DISCOUNT` | `billing.ts:629-630` |
| โปรโมชันกับการอัปเกรด | อัปเกรดทันทีถูกปฏิเสธ (`PROMOTION_UPGRADE_DEFERRED`) จนถึง `upgradeDeferredUntil` | `billing.ts:289-290` |
| โปรโมชันกับการคืนเงิน | คืนบางส่วน = เก็บสิทธิ์ทั้งหมด; คืนเต็ม = ต้องยุติสิทธิ์ที่ยังไม่ใช้ (`BillingPromotionEntitlementAdjustmentState`) | `billing.ts:659-661` |
| Sales deal | เซลล์สร้างข้อเสนอบนฐาน tier ที่มีราคา กำหนดราคา/จำนวนเดือน (สูงสุด 36) หรือรอบต่ออายุ (สูงสุด 36) ข้อเสนอมีอายุ 3 วัน ต้องผ่านการอนุมัติ และห้ามอนุมัติดีลของตัวเอง (`SALES_DEAL_SELF_APPROVAL`) feature ที่ดีลขายได้จำกัดที่ `SALES_DEAL_ALLOWED_FEATURE_KEYS` = starter + `wht_pnd53` + `wht_50bis` | `packages/contracts/src/sales.ts:18-35, 61-63, 335`; `menu-entitlements.ts:503-508` |
| ตั๋วส่วนลดจากงาน (sales event) | ตั๋วผูกกับบัญชี LINE ของผู้ถือ ใช้ได้ทางใดทางหนึ่ง: `DISCOUNT` (ลดราคาแพ็ก) หรือ `CREDIT` (รับเครดิตแชต/สิทธิ์รูปใบเสร็จ) ร้านหนึ่งใช้ได้หนึ่งใบต่ออีเวนต์ สถานะตั๋ว `ISSUED`, `RESERVED`, `USED`, `REVOKED` | `billing.ts:268-283, 588-607`; `sales.ts:357-363` |
| การแนะนำโดยเซลล์ | ฟอร์มสมัครรับรหัสเซลล์ (รูปแบบ `^[A-Z0-9]{3,6}$`) หน้าต่างนับผล 14 วัน หน้าต่างคืนเงิน 60 วัน | `sales.ts:162-165, 241-251`; `provision-signup.use-case.ts:440-450` |
| Demo link | เซลล์/หัวหน้าทีม/System Admin สร้างลิงก์ `/d/<token>` อายุเริ่มต้น 3 วัน (`DEMO_LINK_TTL_MS`) เปิดร้านเดโมบน tier `ENTERPRISE_1999` พร้อมเครดิต AI เริ่มต้น 50 ขอบเขตที่ปรับได้: เครดิต 1–300, สิทธิ์อ่าน 1–50, อายุ 10 นาที–30 วัน | `apps/api/src/modules/sales-demo/application/sales-demo.service.ts:18, 39-76`; `packages/contracts/src/demo-chat.ts:17` |

---

## 4. ตารางหลัก ฟีเจอร์ × แพ็ก (Master feature-by-tier matrix)

ตารางนี้คือ **นิยามขอบเขตของเอกสารทั้งชุด** สร้างโดยอ่านตรงจากโค้ดสองไฟล์ ณ commit `08850deaf`

- รายการ key ทั้งหมด: `FEATURE_CATALOG` → `ALL_FEATURE_ENTITLEMENT_KEYS` (`packages/contracts/src/feature-entitlements.ts:23-600, 668-671`) รวม **62 keys** = top-level 20 keys + submenu 42 keys
- การผูกเมนู: `MENU_ENTITLEMENT_BINDINGS` (`packages/contracts/src/menu-entitlements.ts:18-423`) รวม 30 bindings
- เครื่องหมายต่อแพ็ก: `STARTER_FEATURE_KEYS` (`menu-entitlements.ts:432-450`) และ `TIER_FEATURE_PRESETS` (`menu-entitlements.ts:496-501`)

### 4.1 วิธีอ่านตาราง

| คอลัมน์ | ความหมาย |
|---|---|
| Entitlement key | key ใน `FEATURE_CATALOG` (top-level หรือ `parent.submenu`) |
| ชื่อไทย | `labelTh` ของ key นั้นใน `FEATURE_CATALOG` |
| Parent feature | key ของฟีเจอร์แม่ สำหรับ top-level แสดงกลุ่ม (`operate` / `finance` / `growth`) และ `sellable` (ขายได้) หรือ platform baseline |
| เมนู / navKey | binding ใน `MENU_ENTITLEMENT_BINDINGS` ที่มี key นี้อยู่ใน `entitlementKeys` (navKey + ป้ายไทย) และ `route` ของ submenu จาก `FEATURE_CATALOG` "—" หมายถึงไม่มี binding ที่อ้าง key นี้โดยตรง |
| Gate permissions | สำหรับ top-level: `gatePermissions` ของ binding ที่อ้าง key (รวมทุก binding ไม่ซ้ำ); สำหรับ submenu: `permissionKeys` ของ submenu ใน `FEATURE_CATALOG` |
| สถานะ | `status` ของ binding (`ready` / `planned`) "—" = ไม่มี binding ของตัวเอง (submenu ใช้เมนูของ parent หรือเป็นพฤติกรรมเบื้องหลัง) |
| FREE / STARTER / BASIC / PRO / ENT | ✓ = key อยู่ในชุดที่แพ็กนั้นได้, – = ไม่อยู่ |

คอลัมน์ `FREE` (`FREE_TRIAL_15`) มาจาก provisioning ไม่ใช่จาก `TIER_FEATURE_PRESETS` (ดูหัวข้อ 3.2): ร้านที่สมัครเองได้ preset `starter` ร้าน `FREE_TRIAL_15` ที่ term หมดแล้วและเข้าเงื่อนไข free expense drafts เหลือสิทธิ์เฉพาะชุดอ่าน/อัปโหลด/แก้ร่างค่าใช้จ่าย (หัวข้อ 3.3)

### 4.2 ตารางหลัก (62 keys)

| # | Entitlement key | ชื่อไทย | Parent feature | เมนู / navKey | Gate permissions | สถานะ | FREE | STARTER | BASIC | PRO | ENT |
|---:|---|---|---|---|---|---|:-:|:-:|:-:|:-:|:-:|
| 1 | `inventory` | สินค้า/สต๊อก | — (top-level, operate, sellable) | `inventory` คลังสินค้า | `inventory.location.read`, `inventory.movement.read`, `inventory.movement.create`, `inventory.stock_count.create`, `inventory.movement.adjust`, `inventory.report.read` | ready | – | – | – | – | – |
| 2 | `inventory.locations` | สถานที่จัดเก็บ | `inventory` | route `/inventory/locations` | `inventory.location.read`, `inventory.location.manage` | — | – | – | – | – | – |
| 3 | `inventory.movements` | ความเคลื่อนไหว | `inventory` | route `/inventory/movements` | `inventory.movement.read` | — | – | – | – | – | – |
| 4 | `inventory.stock_report` | รายงานสต็อก | `inventory` | route `/inventory/reports/stock` | `inventory.report.read` | — | – | – | – | – | – |
| 5 | `product_catalog` | สินค้าและบริการ | — (top-level, operate, sellable) | `crmsettings` สินค้าและบริการ | `inventory.product.read` | ready | – | – | – | – | – |
| 6 | `sales_documents` | เอกสารขาย | — (top-level, operate, sellable) | `salesdoc` เอกสารขายและรับชำระ<br>`sales` การขาย<br>`counterparties` คู่ค้า<br>`accounting` บัญชี | `accounting.document.read`, `accounting.document.read_related`, `accounting.quotation.read`, `accounting.invoice.read`, `accounting.billing_note.read`, `accounting.receipt.read`, `accounting.tax_invoice.read`, `accounting.credit_note.read`, `accounting.debit_note.read`, `accounting.counterparty.read`, `accounting.counterparty.manage` | salesdoc: planned<br>sales: planned<br>counterparties: ready<br>accounting: planned | – | – | – | – | – |
| 7 | `expenses` | ค่าใช้จ่าย+ใบเสร็จ | — (top-level, finance, sellable) | `expenses` ค่าใช้จ่ายและใบเสร็จ<br>`counterparties` คู่ค้า | `expense.read`, `expense.read_related`, `expense.read_own`, `expense.receipt.upload`, `expense.receipt.line_upload`, `expense.create`, `expense.confirm`, `expense.category.manage`, `expense.signature.self_manage`, `expense.signature.manage`, `expense.evidence.read`, `accounting.counterparty.read`, `accounting.counterparty.manage` | ready | ✓ | ✓ | ✓ | ✓ | ✓ |
| 8 | `expenses.list` | รายการค่าใช้จ่าย | `expenses` | route `/expenses` | `expense.read`, `expense.read_related`, `expense.read_own` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| 9 | `expenses.upload` | อัปโหลดใบเสร็จ | `expenses` | route `/expenses/upload` | `expense.receipt.upload`, `expense.receipt.line_upload`, `expense.ocr.request` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| 10 | `expenses.manual` | บันทึกด้วยมือ | `expenses` | route `/expenses/manual` | `expense.create`, `expense.update` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| 11 | `expenses.categories` | หมวดหมู่ | `expenses` | route `/expenses/categories` | `expense.category.manage` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| 12 | `expenses.evidence` | หลักฐานทางบัญชี | `expenses` | route `/expenses/evidence` | `expense.evidence.read`, `expense.export` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| 13 | `expenses.signatures` | ลายเซ็นของฉัน | `expenses` | route `/expenses/signatures` | `expense.signature.self_manage`, `expense.signature.manage` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| 14 | `reimbursement` | การเบิกจ่าย | — (top-level, finance, sellable) | `reimbursements` การเบิกจ่าย | `reimbursement.read`, `reimbursement.read_related`, `reimbursement.read_own`, `reimbursement.approve`, `reimbursement.finance_review` | ready | ✓ | ✓ | ✓ | ✓ | ✓ |
| 15 | `double_entry_ledger` | บัญชีแยกประเภท | — (top-level, finance, sellable) | `journal` สมุดรายวัน<br>`closing` ปิดงวด | `ledger.journal.read`, `ledger.period.read` | journal: ready<br>closing: planned | – | – | – | – | – |
| 16 | `expense_auto_post` | ลงบัญชีค่าใช้จ่ายอัตโนมัติ | — (top-level, finance, sellable) | — (พฤติกรรมเบื้องหลัง ไม่มี route) | — | — | – | – | – | – | – |
| 17 | `thai_tax` | ภาษีไทย | — (top-level, finance, sellable) | `tax` ภาษี | `tax.profile.read`, `tax.config.read`, `tax.period.read`, `tax.event.read`, `tax.report.read` | ready | – | – | – | – | – |
| 18 | `wht_pnd53` | ออก ภ.ง.ด.3 และ ภ.ง.ด.53 ในระบบ | — (top-level, finance, sellable) | `pnd53` ภาษีหัก ณ ที่จ่าย | `wht.pnd53.read`, `wht.pnd53.prepare` | ready | – | – | – | – | ✓ |
| 19 | `wht_50bis` | ออกหนังสือรับรอง 50 ทวิในระบบ | — (top-level, finance, sellable) | — (ไม่มี binding; ใช้จากรายการจ่าย) | ไม่มีใน binding — capability pack `pack.wht.certificate.issue`: `wht.certificate.issue` | — | – | – | – | – | ✓ |
| 20 | `procurement` | จัดซื้อ/เจ้าหนี้ | — (top-level, operate, sellable) | — | — | — | – | – | – | – | – |
| 21 | `procurement.suppliers` | ผู้จำหน่าย | `procurement` | `procurement` จัดซื้อ<br>route `/procurement?tab=suppliers` | `procurement.supplier.read`, `procurement.supplier.manage`, `procurement.supplier.bank.read`, `procurement.supplier.bank.manage` | ready | – | – | – | – | – |
| 22 | `procurement.purchase_requests` | ใบขอซื้อ (PR) | `procurement` | `procurement` จัดซื้อ<br>route `/procurement?tab=pr` | `procurement.purchase_request.read`, `procurement.purchase_request.create`, `procurement.purchase_request.approve` | ready | – | – | – | – | – |
| 23 | `procurement.purchase_orders` | ใบสั่งซื้อ (PO) | `procurement` | `procurement` จัดซื้อ<br>`poapproval` อนุมัติคำสั่งซื้อ<br>route `/procurement?tab=po` | `procurement.purchase_order.read`, `procurement.purchase_order.create`, `procurement.purchase_order.approve`, `procurement.purchase_order.issue`, `procurement.purchase_order.manage` | procurement: ready<br>poapproval: planned | – | – | – | – | – |
| 24 | `procurement.goods_receipts` | ใบรับสินค้า (GR) | `procurement` | `procurement` จัดซื้อ<br>route `/procurement?tab=gr` | `procurement.goods_receipt.read`, `procurement.goods_receipt.post`, `procurement.goods_receipt.void` | ready | – | – | – | – | – |
| 25 | `procurement.vendor_bills` | ใบวางบิล | `procurement` | `accounts-payable` เจ้าหนี้การค้า<br>route `/accounts-payable?tab=bills` | `procurement.vendor_bill.read`, `procurement.vendor_bill.create`, `procurement.vendor_bill.direct_entry`, `procurement.vendor_bill.approve`, `procurement.vendor_bill.void`, `procurement.vendor_bill.match`, `procurement.vendor_bill.match.override`, `procurement.approval_policy.read`, `procurement.approval_policy.manage` | ready | – | – | – | – | – |
| 26 | `procurement.supplier_payments` | การชำระเงิน | `procurement` | `accounts-payable` เจ้าหนี้การค้า<br>route `/accounts-payable?tab=payments` | `procurement.supplier_payment.read`, `procurement.supplier_payment.create`, `procurement.supplier_payment.release`, `procurement.supplier_payment.void` | ready | – | – | – | – | – |
| 27 | `procurement.ap_aging` | AP Aging | `procurement` | `accounts-payable` เจ้าหนี้การค้า<br>route `/accounts-payable?tab=aging` | `procurement.ap.report` | ready | – | – | – | – | – |
| 28 | `bank_reconciliation` | ธนาคารและกระทบยอด | — (top-level, finance, sellable) | `banking` บัญชีธนาคาร | `bank.account.read`, `bank.cash.read`, `bank.statement.read`, `bank.match.read`, `bank.reconciliation.read`, `bank.adjustment.read` | ready | – | – | – | – | – |
| 29 | `bank_reconciliation.accounts` | บัญชีธนาคาร | `bank_reconciliation` | route `/banking?tab=accounts` | `bank.account.read`, `bank.account.manage`, `bank.account.sensitive_read` | — | – | – | – | – | – |
| 30 | `bank_reconciliation.cash` | สถานะเงินสด | `bank_reconciliation` | route `/banking?tab=cash` | `bank.cash.read` | — | – | – | – | – | – |
| 31 | `bank_reconciliation.import` | นำเข้า statement | `bank_reconciliation` | route `/banking?tab=import` | `bank.statement.read`, `bank.statement.import`, `bank.statement.void` | — | – | – | – | – | – |
| 32 | `bank_reconciliation.matching` | จับคู่รายการ | `bank_reconciliation` | route `/banking?tab=matching` | `bank.match.read`, `bank.match.confirm`, `bank.match.override`, `bank.match.unmatch` | — | – | – | – | – | – |
| 33 | `bank_reconciliation.reconciliations` | กระทบยอด | `bank_reconciliation` | route `/banking?tab=reconciliations` | `bank.reconciliation.read`, `bank.reconciliation.create`, `bank.reconciliation.complete`, `bank.reconciliation.reopen` | — | – | – | – | – | – |
| 34 | `bank_reconciliation.adjustments` | รายการปรับปรุง | `bank_reconciliation` | route `/banking?tab=adjustments` | `bank.adjustment.read`, `bank.adjustment.create`, `bank.adjustment.approve`, `bank.adjustment.void` | — | – | – | – | – | – |
| 35 | `crm` | ลูกค้าและ CRM | — (top-level, growth, sellable) | `crm` ลูกค้า (CRM) | `crm.customer.read`, `crm.lead.read`, `crm.opportunity.read`, `crm.report.read`, `crm.follow_up.read` | ready | – | – | – | – | – |
| 36 | `crm.overview` | รายงาน CRM | `crm` | `crmreport` รายงาน CRM<br>route `/crm-reports` | `crm.report.read` | planned | – | – | – | – | – |
| 37 | `crm.leads` | ลูกค้ามุ่งหวัง | `crm` | route `/crm?tab=leads` | `crm.lead.read`, `crm.lead.create`, `crm.lead.update`, `crm.lead.assign`, `crm.lead.convert`, `crm.lead.disqualify` | — | – | – | – | – | – |
| 38 | `crm.pipeline` | ไปป์ไลน์ | `crm` | route `/crm?tab=pipeline` | `crm.opportunity.read`, `crm.opportunity.create`, `crm.opportunity.update`, `crm.opportunity.stage_move`, `crm.opportunity.close`, `crm.opportunity.reopen`, `crm.activity.read`, `crm.activity.create`, `crm.pipeline.configure`, `crm.quotation.link` | — | – | – | – | – | – |
| 39 | `crm.followups` | งานติดตาม | `crm` | route `/crm?tab=followups` | `crm.follow_up.read`, `crm.follow_up.create`, `crm.follow_up.complete` | — | – | – | – | – | – |
| 40 | `crm.customers` | ลูกค้า | `crm` | `customers` ลูกค้า<br>`discount` นโยบายส่วนลด<br>route `/customers` | `crm.customer.read`, `crm.customer.create`, `crm.customer.update`, `crm.customer.archive`, `crm.customer.assign`, `crm.customer.merge`, `crm.customer.export`, `crm.customer.erase`, `crm.contact.read`, `crm.contact.manage` | customers: ready<br>discount: planned | – | – | – | – | – |
| 41 | `crm.inbox` | กล่องข้อความ | `crm` | `inbox` กล่องข้อความ<br>route `/inbox` | `crm.inbox.read`, `crm.inbox.reply`, `crm.inbox.note`, `crm.inbox.assign`, `crm.inbox.resolve` | ready | – | – | – | – | – |
| 42 | `crm.bookings` | การจองออนไลน์ | `crm` | `booking` การจองออนไลน์<br>route `/bookings` | `crm.booking.read`, `crm.booking.create`, `crm.booking.update`, `crm.booking.cancel` | ready | – | – | – | – | – |
| 43 | `dashboard_notifications` | แดชบอร์ด/แจ้งเตือน | — (top-level, operate, sellable) | `dashboard` หน้าแรก<br>`notifications` การแจ้งเตือน | `dashboard.read`, `notification.read` | ready | ✓ | ✓ | ✓ | ✓ | ✓ |
| 44 | `dashboard_notifications.preferences` | ตั้งค่าการแจ้งเตือน | `dashboard_notifications` | route `/notifications/preferences` | `notification.preference.manage` | — | – | – | – | – | – |
| 45 | `dashboard_notifications.rules` | กฎการแจ้งเตือน | `dashboard_notifications` | route `/notifications/rules` | `notification.rule.manage` | — | – | – | – | – | – |
| 46 | `ai_line_assistant` | ผู้ช่วย AI ทาง LINE | — (top-level, operate, sellable) | `ai-suggestions` AI แนะนำ (contextual) | `ai.suggestion.read`, `ai.suggestion.read_own` | ready | ✓ | ✓ | ✓ | ✓ | ✓ |
| 47 | `line_oa` | เชื่อมต่อ LINE OA | — (top-level, operate, sellable) | `lineoa` เชื่อมต่อ LINE OA | `crm.channel.read` | ready | – | – | – | – | – |
| 48 | `reports` | รายงาน/BI | — (top-level, finance, sellable) | `reports` รายงานการเงิน | `report.catalog.read` | ready | – | – | – | – | – |
| 49 | `workflow_automation` | ระบบอัตโนมัติ | — (top-level, operate, sellable) | `workflow` เวิร์กโฟลว์ | `workflow.template.read`, `workflow.rule.read`, `workflow.task.read`, `workflow.run.read`, `workflow.dead_letter.read`, `workflow.webhook.manage` | ready | – | – | – | – | – |
| 50 | `workflow_automation.templates` | เทมเพลต | `workflow_automation` | route `/workflow?tab=templates` | `workflow.template.read` | — | – | – | – | – | – |
| 51 | `workflow_automation.rules` | กฎอัตโนมัติ | `workflow_automation` | route `/workflow?tab=rules` | `workflow.rule.read`, `workflow.rule.manage`, `workflow.rule.enable` | — | – | – | – | – | – |
| 52 | `workflow_automation.runs` | ประวัติการทำงาน | `workflow_automation` | route `/workflow?tab=runs` | `workflow.run.read`, `workflow.run.replay` | — | – | – | – | – | – |
| 53 | `workflow_automation.tasks` | งานที่มอบหมาย | `workflow_automation` | route `/workflow?tab=tasks` | `workflow.task.read`, `workflow.task.work` | — | – | – | – | – | – |
| 54 | `workflow_automation.dead_letters` | ข้อผิดพลาดค้าง | `workflow_automation` | route `/workflow?tab=dead-letters` | `workflow.dead_letter.read`, `workflow.dead_letter.replay` | — | – | – | – | – | – |
| 55 | `workflow_automation.webhooks` | Webhook | `workflow_automation` | route `/workflow?tab=webhooks` | `workflow.webhook.manage` | — | – | – | – | – | – |
| 56 | `employee_access` | พนักงานและสิทธิ์ | — (top-level, operate, platform baseline) | `roles` พนักงานและสิทธิ์ | `access.role.read`, `access.role.manage`, `access.employee.read`, `access.employee.create`, `access.employee.update`, `access.effective.read` | ready | ✓ | ✓ | ✓ | ✓ | ✓ |
| 57 | `employee_access.employees` | พนักงาน | `employee_access` | route `/settings/employees` | `access.employee.read`, `access.employee.create`, `access.employee.update`, `access.employee.disable`, `access.employee.credential.issue`, `access.employee.line_link.issue`, `access.employee.line_link.revoke` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| 58 | `employee_access.roles` | บทบาทและสิทธิ์ | `employee_access` | route `/settings/permissions` | `access.role.read`, `access.role.manage`, `access.role.operational.assign`, `access.role.financial.assign`, `access.permission.read`, `access.capability_pack.read`, `access.role_template.read`, `access.role_template.manage` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| 59 | `employee_access.overview` | ภาพรวมสิทธิ์ | `employee_access` | route `/settings/access-overview` | `access.effective.read` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| 60 | `company_settings` | ตั้งค่าร้าน | — (top-level, operate, platform baseline) | `settings` ตั้งค่าร้าน (ผูกด้วย `parentFeatureKey`; `entitlementKeys` ว่าง) | `company.settings.view`, `company.setup.manage`, `ledger.account.read`, `ledger.account.manage`, `tax.profile.read`, `tax.profile.manage`, `tax.config.read`, `tax.config.manage`, `ledger.posting-rule.read`, `ledger.posting-rule.manage` | ready | ✓ | ✓ | ✓ | ✓ | ✓ |
| 61 | `company_settings.branches` | สาขา | `company_settings` | route `/settings/branches` | `company.branch.read`, `company.branch.manage` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| 62 | `company_settings.security` | ความปลอดภัยบัญชี | `company_settings` | route `/settings/security` | `account.password.change`, `account.identity.link`, `account.identity.unlink` | — | ✓ | ✓ | ✓ | ✓ | ✓ |

**สรุปจำนวน:** STARTER / BASIC / PRO (และ FREE ตาม provisioning) = 17 keys; ENTERPRISE = 19 keys; ไม่อยู่ในแพ็กใด = 43 keys

### 4.3 ข้อสังเกตที่ต้องรู้เมื่อใช้ตาราง

1. **`dashboard_notifications` ขายเฉพาะ key แม่** submenu `dashboard_notifications.preferences` และ `dashboard_notifications.rules` ไม่อยู่ใน preset starter แถว entitlement ของสอง key นี้จึงถูกสร้างเป็น `enabled: false` ตอนเปิดร้าน (`create-company-onboarding.use-case.ts:596-604`) และ `featureKeyDeniedByEntitlement()` ตัด permission ของ submenu ที่ปิด (`notification.preference.manage`, `notification.rule.manage`) ออก (`apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:129-134`)
2. **เมนู "คู่ค้า" (`counterparties`)** binding ระบุ entitlement สอง key คือ `expenses` และ `sales_documents` การ์ดแพ็กเกจจึงไม่แสดงป้าย "คู่ค้า" ให้ชุด starter (กฎ "ทุก key ต้องอยู่" ใน `packageMenuLabels`) แต่ permission `accounting.counterparty.*` ยังคงอยู่ตราบที่ฟีเจอร์ใดฟีเจอร์หนึ่งเปิด (`PREFIX_FEATURE_RULES`, `feature-gate.logic.ts:49`) ร้านชุด starter จึงอ่านและแก้คู่ค้าได้ รายละเอียดหน้าจออยู่ในเอกสาร EXP
3. **`ai_line_assistant` ไม่มีเมนูหลักของตัวเอง** binding เดียวคือ `ai-suggestions` (AI แนะนำ) ซึ่งเป็น `navigation: 'contextual'` ตัวฟีเจอร์คือผู้ช่วยทาง LINE (เอกสาร LINE)
4. **`wht_50bis` ไม่มี binding** เป็นสิทธิ์ออก 50 ทวิจากรายการจ่าย ผูกกับ capability pack `pack.wht.certificate.issue` (permission `wht.certificate.issue`) และ `pack.company.tax_signature.manage` (`apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts:513-530`)
5. **`wht_pnd53` ขายแยกจาก `thai_tax`** คอมเมนต์ในโค้ดระบุว่า "สิทธิ์แคบนี้ต้องไม่เปิด workspace `thai_tax` ทั้งหมด" (`menu-entitlements.ts:491-492`)
6. **`expense_auto_post` ไม่อยู่ในแพ็กใด และไม่อยู่ใน preset `full`** (`menu-entitlements.ts:482`) ต้องพึ่ง `double_entry_ledger` (`FEATURE_DEPENDENCIES`)
7. **เมนู `settings` (ตั้งค่าร้าน) ไม่มี entitlement key** (`entitlementKeys: []`) แสดงตาม permission เท่านั้น
8. **การบังคับใช้:** permission ของฟีเจอร์ที่บริษัทไม่ได้เปิดถูกตัดออกตอน resolve สิทธิ์ ทำให้ API guard เมนูเว็บ และเครื่องมือ LINE AI ปฏิเสธ/ซ่อนพร้อมกันจากจุดเดียว รวมถึง OWNER (`feature-gate.logic.ts:1-9`) บริษัทที่ไม่มีแถว entitlement เลย (legacy) ถือว่าเปิดทุกอย่าง (`entitled === null`)
9. **ข้อยกเว้น retained:** เมื่อปิด `reimbursement` งานที่ค้างยังเดินต่อได้ (อ่าน อนุมัติ/ปฏิเสธ ตรวจการเงิน จ่าย/ยกเลิกการจ่าย) แต่สร้าง/ส่งคำขอใหม่ไม่ได้ และเมื่อปิด `reports` ประวัติรายงานที่เก็บไว้ยังอ่านได้ (`feature-gate.logic.ts:68-93`)
10. **System Admin ปรับ entitlement รายร้านได้** นอกเหนือจาก preset ผ่านหน้า partner (permission `system.partner_feature.manage`) ตารางนี้จึงเป็น "สิ่งที่แพ็กให้" ไม่ใช่ "สิ่งที่ร้านใดร้านหนึ่งมีอยู่จริง"

### 4.4 Menu bindings ทั้ง 30 รายการ

คอลัมน์ "ชุด starter" และ "ชุด ENTERPRISE" ใช้กฎเดียวกับ `packageMenuLabels` / `entitledRoleMenus`: binding ต้อง `ready` และทุก entitlement key ต้องอยู่ในชุด

| # | navKey | ป้ายไทย | group | parentFeatureKey | entitlementKeys | status | ชุด starter | ชุด ENTERPRISE |
|---:|---|---|---|---|---|---|:-:|:-:|
| 1 | `dashboard` | หน้าแรก | main | `dashboard_notifications` | `dashboard_notifications` | ready | ✓ | ✓ |
| 2 | `inbox` | กล่องข้อความ | operate | `crm` | `crm.inbox` | ready | – | – |
| 3 | `customers` | ลูกค้า | operate | `crm` | `crm.customers` | ready | – | – |
| 4 | `booking` | การจองออนไลน์ | operate | `crm` | `crm.bookings` | ready | – | – |
| 5 | `crmreport` | รายงาน CRM | operate | `crm` | `crm.overview` | planned | – | – |
| 6 | `crmsettings` | สินค้าและบริการ | operate | `product_catalog` | `product_catalog` | ready | – | – |
| 7 | `salesdoc` | เอกสารขายและรับชำระ | operate | `sales_documents` | `sales_documents` | planned | – | – |
| 8 | `sales` | การขาย | operate | `sales_documents` | `sales_documents` | planned | – | – |
| 9 | `inventory` | คลังสินค้า | operate | `inventory` | `inventory` | ready | – | – |
| 10 | `procurement` | จัดซื้อ | operate | `procurement` | `procurement.suppliers`, `procurement.purchase_requests`, `procurement.purchase_orders`, `procurement.goods_receipts` | ready | – | – |
| 11 | `workflow` | เวิร์กโฟลว์ | operate | `workflow_automation` | `workflow_automation` | ready | – | – |
| 12 | `ai-suggestions` | AI แนะนำ *(contextual)* | operate | `ai_line_assistant` | `ai_line_assistant` | ready | ✓ | ✓ |
| 13 | `expenses` | ค่าใช้จ่ายและใบเสร็จ | finance | `expenses` | `expenses` | ready | ✓ | ✓ |
| 14 | `counterparties` | คู่ค้า | finance | `expenses` | `expenses`, `sales_documents` | ready | – | – |
| 15 | `reimbursements` | การเบิกจ่าย | finance | `reimbursement` | `reimbursement` | ready | ✓ | ✓ |
| 16 | `journal` | สมุดรายวัน | finance | `double_entry_ledger` | `double_entry_ledger` | ready | – | – |
| 17 | `accounting` | บัญชี | finance | `sales_documents` | `sales_documents` | planned | – | – |
| 18 | `tax` | ภาษี | finance | `thai_tax` | `thai_tax` | ready | – | – |
| 19 | `pnd53` | ภาษีหัก ณ ที่จ่าย | finance | `wht_pnd53` | `wht_pnd53` | ready | – | ✓ |
| 20 | `accounts-payable` | เจ้าหนี้การค้า | finance | `procurement` | `procurement.vendor_bills`, `procurement.supplier_payments`, `procurement.ap_aging` | ready | – | – |
| 21 | `banking` | บัญชีธนาคาร | finance | `bank_reconciliation` | `bank_reconciliation` | ready | – | – |
| 22 | `reports` | รายงานการเงิน | finance | `reports` | `reports` | ready | – | – |
| 23 | `closing` | ปิดงวด | finance | `double_entry_ledger` | `double_entry_ledger` | planned | – | – |
| 24 | `crm` | ลูกค้า (CRM) | growth | `crm` | `crm` | ready | – | – |
| 25 | `roles` | พนักงานและสิทธิ์ | admin | `employee_access` | `employee_access` | ready | ✓ | ✓ |
| 26 | `settings` | ตั้งค่าร้าน | admin | `company_settings` | — | ready | ✓ (ไม่มี entitlement key; ขึ้นกับ permission) | ✓ (ไม่มี entitlement key; ขึ้นกับ permission) |
| 27 | `notifications` | การแจ้งเตือน | admin | `dashboard_notifications` | `dashboard_notifications` | ready | ✓ | ✓ |
| 28 | `lineoa` | เชื่อมต่อ LINE OA | admin | `line_oa` | `line_oa` | ready | – | – |
| 29 | `poapproval` | อนุมัติคำสั่งซื้อ | admin | `procurement` | `procurement.purchase_orders` | planned | – | – |
| 30 | `discount` | นโยบายส่วนลด | admin | `crm` | `crm.customers` | planned | – | – |

### 4.5 Presets ที่ไม่ใช่ของแพ็ก

`FEATURE_PACKAGE_PRESETS` มีอีกสอง preset ที่ **ไม่ถูกผูกกับ tier ใด** ใช้เป็นปุ่มลัดในหน้า partner ของ System Admin เท่านั้น

| preset | ป้ายไทย | เนื้อหา |
|---|---|---|
| `starter` | เริ่มต้น | 17 keys (คือชุดที่ทุกแพ็กได้) |
| `standard` | มาตรฐาน | starter + `crm`, `crm.inbox`, `crm.customers`, `product_catalog`, `line_oa`, `sales_documents`, `thai_tax`, `double_entry_ledger`, `reports`, `crm.overview`, `crm.leads`, `crm.pipeline`, `crm.followups`, `crm.bookings`, `inventory` |
| `full` | ครบวงจร | ทุก key ยกเว้น `expense_auto_post` |

### 4.6 การพึ่งพาระหว่างฟีเจอร์

`FEATURE_DEPENDENCIES` (`feature-entitlements.ts:622-626`) — child เปิดได้เมื่อ prerequisite เปิดอยู่เท่านั้น ตรวจทั้งสองทิศทาง

| child | ต้องมี |
|---|---|
| `expense_auto_post` | `double_entry_ledger` |
| `procurement.supplier_payments` | `procurement.vendor_bills` |
| `procurement.ap_aging` | `procurement.vendor_bills` |

ทั้งสามคู่อยู่นอกขอบเขตแพ็ก ไม่มี dependency ใดระหว่าง key ที่ขาย

### 4.7 Keys ที่ไม่อยู่ในแพ็กใด (นอกขอบเขต) — 43 keys

| ฟีเจอร์แม่ | keys |
|---|---|
| `inventory` | `inventory`, `inventory.locations`, `inventory.movements`, `inventory.stock_report` |
| `product_catalog` | `product_catalog` |
| `sales_documents` | `sales_documents` |
| `double_entry_ledger` | `double_entry_ledger` |
| `expense_auto_post` | `expense_auto_post` |
| `thai_tax` | `thai_tax` |
| `procurement` | `procurement`, `procurement.suppliers`, `procurement.purchase_requests`, `procurement.purchase_orders`, `procurement.goods_receipts`, `procurement.vendor_bills`, `procurement.supplier_payments`, `procurement.ap_aging` |
| `bank_reconciliation` | `bank_reconciliation`, `bank_reconciliation.accounts`, `bank_reconciliation.cash`, `bank_reconciliation.import`, `bank_reconciliation.matching`, `bank_reconciliation.reconciliations`, `bank_reconciliation.adjustments` |
| `crm` | `crm`, `crm.overview`, `crm.leads`, `crm.pipeline`, `crm.followups`, `crm.customers`, `crm.inbox`, `crm.bookings` |
| `dashboard_notifications` (เฉพาะ submenu) | `dashboard_notifications.preferences`, `dashboard_notifications.rules` |
| `line_oa` | `line_oa` |
| `reports` | `reports` |
| `workflow_automation` | `workflow_automation`, `workflow_automation.templates`, `workflow_automation.rules`, `workflow_automation.runs`, `workflow_automation.tasks`, `workflow_automation.dead_letters`, `workflow_automation.webhooks` |

รายการแบบหนึ่งบรรทัดต่อโมดูลอยู่ในหัวข้อ 11

---

## 5. บทบาทและประเภทผู้ใช้

แหล่งข้อมูล: `apps/api/src/modules/auth/permission-registry.ts` (`PERMISSIONS` 375 รายการ, `ROLE_GRANTS`, `SYSTEM_ROLES` 19 บทบาท), `packages/contracts/src/employee-access.ts` (`THAI_SYSTEM_ROLE_NAMES` และกฎการมอบบทบาท), `packages/contracts/src/sales.ts`, `packages/contracts/src/executive-business.ts`

### 5.1 สองระนาบของผู้ใช้

| ระนาบ | คำอธิบาย | permission prefix |
|---|---|---|
| ร้าน (tenant) | พนักงานของบริษัทลูกค้า สังกัดผ่าน `CompanyMembership` | ทุก key ที่ไม่ขึ้นต้นด้วย `system.` หรือ `sales.` (`COMPANY_PERMISSION_KEYS`) |
| แพลตฟอร์ม (มั่งมี) | เจ้าหน้าที่ของมั่งมี: ผู้ดูแลระบบ ทีมขาย ผู้บริหาร สังกัด platform tenant | `system.*` และ `sales.*` — ร้านใดก็ถือไม่ได้ แม้แต่ OWNER (`permission-registry.ts:478-490`) |

### 5.2 บทบาทฝั่งร้าน (12 บทบาทมาตรฐาน)

| role key | ชื่อไทย | ใช้สำหรับ (จาก `SYSTEM_ROLES.description`) | ข้อสังเกต |
|---|---|---|---|
| `OWNER` | เจ้าของกิจการ | มีทุกสิทธิ์ที่บริษัทนี้ใช้ได้ | `ROLE_GRANTS.OWNER = COMPANY_PERMISSION_KEYS`; ร้านแก้บทบาทนี้ไม่ได้ |
| `ADMIN` | ผู้ดูแลบริษัท | ตั้งค่าบริษัท สาขา พนักงาน และงานประจำวันของร้าน | |
| `MANAGER` | ผู้จัดการ | ดูแลทีมและอนุมัติงาน เช่น ใบขอซื้อและการเบิกจ่าย | |
| `HR` | ฝ่ายบุคคล | เพิ่ม แก้ไข และปิดบัญชีพนักงาน และกำหนดบทบาทให้พนักงานได้บางบทบาท | มอบได้เฉพาะ `HR_ASSIGNABLE_ROLE_KEYS`: `MANAGER`, `SALES`, `INVENTORY`, `MARKETING`, `STAFF` |
| `SALES` | ฝ่ายขาย | ดูแลลูกค้าและทำใบเสนอราคา | งานหลักอยู่ในฟีเจอร์ที่ไม่ได้ขาย |
| `INVENTORY` | ฝ่ายคลังสินค้า | รับ-จ่ายสินค้า นับและปรับสต๊อก และบันทึกรับของ | งานหลักอยู่ในฟีเจอร์ที่ไม่ได้ขาย |
| `FINANCE` | ฝ่ายการเงิน | ออกเอกสารขาย รับเงิน จ่ายเงิน กระทบยอดธนาคาร และเตรียมภาษี | การมอบต้องมี `access.role.financial.assign` (`FINANCIAL_ROLE_KEYS`) ถือ `wht.*` |
| `ACCOUNTANT` | ฝ่ายบัญชี | ลงบัญชี ปิดงวด ทำภาษี และกระทบยอดธนาคาร | เช่นเดียวกับ `FINANCE` |
| `MARKETING` | ฝ่ายการตลาด | ดูข้อมูลลูกค้าและรายงาน | งานหลักอยู่ในฟีเจอร์ที่ไม่ได้ขาย |
| `STAFF` | พนักงาน | บันทึกค่าใช้จ่ายและขอเบิกของตัวเอง | `STAFF_ROLE_GRANTS` (`permission-registry.ts:528-542`) |
| `AUDITOR_READONLY` | ผู้ตรวจสอบ (ดูอย่างเดียว) | ดูข้อมูลของบริษัทเพื่อตรวจสอบโดยไม่แก้ไข | |
| `COMPANY_VIEW` | ผู้ดูภาพรวมบริษัท | ดูภาพรวมของบริษัทโดยไม่แก้ไขข้อมูล | ร้านแก้บทบาทนี้ไม่ได้ (`NON_EDITABLE_ROLE_KEYS`); คอมเมนต์ในโค้ดจัดเป็นบทบาทของผู้ปฏิบัติการแพลตฟอร์ม ไม่ใช่บทบาทพนักงาน (`employee-access.ts:207-211`) แต่สิทธิ์ที่ถือเป็นสิทธิ์อ่านข้อมูลของบริษัท |
| (บทบาทที่ร้านสร้างเอง) | — | ร้านประกอบบทบาทจาก capability pack ได้ | ห้ามใช้ key ของบทบาทแพลตฟอร์ม |

กฎระดับธุรกิจของบทบาทฝั่งร้าน

- **ขอบเขตสาขา:** `BranchScopeMode` = `ALL_BRANCHES` / `SELECTED_BRANCHES` / `DEFAULT_BRANCH_ONLY` บทบาทกำกับดูแลทั้งกิจการ (`OWNER`, `SYSTEM_ADMIN`, `COMPANY_VIEW`, `ADMIN`, `HR`, `AUDITOR_READONLY`, `FINANCE`, `ACCOUNTANT`) ต้องเป็น `ALL_BRANCHES` เสมอ (`ALL_BRANCH_ROLE_KEYS`, `employee-access.ts:236-239`)
- **สถานะพนักงาน:** `DRAFT`, `INVITED`, `ACTIVE`, `SUSPENDED`, `DISABLED` (`employee-access.ts:5`)
- **สิทธิ์เบิกจ่ายของตัวเองคงอยู่เสมอ:** `REIMBURSEMENT_SELF_SERVICE_PERMISSIONS` ถูกเก็บไว้แม้ฟีเจอร์เบิกจ่ายปิด แต่ประตู entitlement ตอน runtime ยังกันคำขอใหม่ (`permission-registry.ts:520-526`)
- **ผู้จัดการแพ็กเกจ:** ผู้ที่ถือ `company.plan.manage` ผู้ที่ไม่มีสิทธิ์จะได้ข้อความให้แจ้งเจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจแทนปุ่มซื้อ (`plan-manager.logic.ts:8-11`)

### 5.3 บทบาทฝั่งแพลตฟอร์ม (7 บทบาท)

| role key | ชื่อไทย | สิทธิ์หลัก | หลักฐาน |
|---|---|---|---|
| `SYSTEM_ADMIN` | ผู้ดูแลระบบ | เปิดร้าน (`system.company_onboarding.*`), ดูแลร้าน/วงจรชีวิต/entitlement/โมเดล AI/สมาชิก (`system.partner_*`), billing ทั้ง 15 สิทธิ์ (`system.billing.*`), launch gate, การส่งอีเมล, การผูก LINE, หมวดเงินได้ WHT, สิทธิ์ข้อมูลส่วนบุคคล (`system.data_rights.manage`), ธีมหน้าแรก, รวมทุกสิทธิ์ `sales.*` | `permission-registry.ts:546-585`; `billing.ts:41-44` |
| `MANGMEE_SALES_LEAD` | หัวหน้าทีมขายมั่งมี | `sales.console.read`, `sales.company.search`, `sales.deal.create`, `sales.deal.approve`, `sales.team.manage`, `sales.report.read`, `sales.event.manage`, `sales.demo_link.create` | `permission-registry.ts:606-610` |
| `MANGMEE_SALES` | เซลล์มั่งมี | `sales.console.read`, `sales.company.search`, `sales.deal.create`, `sales.demo_link.create` | `permission-registry.ts:611-614` |
| `MANGMEE_EXECUTIVE` | ผู้บริหารมั่งมี | `system.executive.read` | `permission-registry.ts:586-588` |
| `MANGMEE_EXECUTIVE_EXPORT` | สิทธิ์ส่งออกรายงานสำหรับผู้บริหาร | `system.executive.export` | `:589-591` |
| `MANGMEE_EXECUTIVE_CONTACT` | สิทธิ์ดูข้อมูลติดต่อสำหรับผู้บริหาร | `system.executive.contact.read` | `:592-594` |
| `MANGMEE_EXECUTIVE_COMPANY_NOTE` | (ชื่อจาก `COMPANY_TEAM_NOTE_WORDS.roleName`) | สิทธิ์จัดการบันทึกของทีมต่อร้าน (`COMPANY_TEAM_NOTE_MANAGE_PERMISSION`) | `:595-597` |

กฎระดับธุรกิจของบทบาทแพลตฟอร์ม

- บทบาททีมขายและผู้บริหารเป็น **platform-only**: ร้านลูกค้าแสดง อ่าน คัดลอก มอบ หรือส่งการอนุมัติไปหาบทบาทเหล่านี้ไม่ได้ และบทบาทที่ร้านสร้างเองใช้ key เดียวกันไม่ได้ (`PLATFORM_ONLY_ROLE_KEYS`, `permission-registry.ts:6-13`)
- บทบาททีมขายไม่มี permission ทางธุรกิจของร้านเลย มีเฉพาะ `account.*` ที่จำเป็นต่อการเข้าสู่ระบบ (`permission-registry.ts:598-605`)
- ข้อมูลส่วนบุคคลของเซลล์ (`sales.agent_profile.manage`) ถือได้เฉพาะ `SYSTEM_ADMIN` (`permission-registry.ts:551-553`)
- บัญชีผู้บริหารมีสถานะ `PENDING_ACTIVATION`, `ACTIVE`, `SUSPENDED`, `REVOKED` (`executive-business.ts:10`)

### 5.4 ผู้ใช้ทาง LINE และผู้ใช้เดโม

| ประเภท | คำอธิบาย |
|---|---|
| ผู้ใช้ LINE ที่ผูกบัญชีแล้ว | บัญชี LINE ผูกกับผู้ใช้ในระบบ (`ExternalIdentity`, provider `LINE`) ใช้สิทธิ์ชุดเดียวกับบนเว็บ การเพิ่มเพื่อน LINE OA อย่างเดียวไม่ใช่การอนุญาต |
| ผู้ใช้ LINE ที่ยังไม่ผูก | ได้รับคำแนะนำการผูกบัญชี/สมัครเท่านั้น |
| ผู้ใช้เดโม | เข้าผ่าน demo link ได้ร้านเดโมชั่วคราวที่จัดประเภทรายงานเป็น `DEMO` (`sales-demo.service.ts:76`) |

---

## 6. กระบวนการทางธุรกิจระดับสูง

แต่ละขั้นระบุ AREA ของเอกสารที่ลงรายละเอียด ขั้นตอนเป็นระดับธุรกิจ สถานะที่อ้างเป็นค่าจริงใน `apps/api/prisma/schema.prisma`

### 6.1 BP-01 สมัคร → เปิดร้าน → ซื้อแพ็กเกจ

1. ผู้สนใจกรอกฟอร์มสมัครสาธารณะบนเว็บ หรือเริ่มจาก LINE: ชื่อร้าน ชื่อเจ้าของ อีเมล เบอร์โทร ประเภทธุรกิจ สถานะ VAT เลขผู้เสียภาษี การยอมรับข้อตกลง (`consentVersion`) ช่องทางที่รู้จัก และรหัสเซลล์ถ้ามี (`PublicCompanySignupBody`) — **CORE**
2. คำขอเดินตาม `CompanySignupState`: `RECEIVED` → `VALIDATED` → (`PENDING_REVIEW` เมื่อต้องให้ System Admin ตรวจ) → `EMAIL_PENDING` → `EMAIL_VERIFIED` → `PROVISIONING` → `READY` → `LINE_LINK_PENDING` → `COMPLETED` สถานะล้มเหลว: `EMAIL_FAILED`, `PROVISIONING_FAILED`, `SUSPENDED`, `EXPIRED`, `REJECTED` — **CORE**
3. Provisioning สร้างบริษัท เจ้าของ ผังบัญชีเริ่มต้น หมวดค่าใช้จ่ายเริ่มต้น และแถว entitlement ครบทุก key ตาม preset `starter` — **CORE**
4. ระบบเขียน plan term `FREE_TRIAL_15` ยาว 0 วัน แล้วล็อกร้านเป็น `DISABLED` ด้วยเหตุผล `no_package` ทันที — **BILL**
5. เจ้าของเข้าสู่ระบบ เห็นสถานะ "ยังไม่มีแพ็กเกจ" และเปิดหน้าแพ็กเกจ (`/companies/:companyId/billing`) ได้แม้ร้านถูกล็อก — **BILL**
6. เลือกแพ็กและรอบบิล → ระบบออก quote (ราคา ภาษี ผลต่อเมนู/ความจุ สิทธิประโยชน์ที่เลือกได้) → ยอมรับเงื่อนไข (`consentRevision`) → Stripe Checkout ด้วยบัตรหรือ PromptPay — **BILL**
7. เมื่อ Stripe ยืนยันการชำระ ระบบ apply: ตั้ง tier และความจุ ต่ออายุ term เปิดเมนูตาม `TIER_FEATURE_PRESETS` ให้สิทธิ์อ่านใบเสร็จของช่วงที่ชำระ และเปิดร้านกลับเป็น `ACTIVE` — **BILL**
8. เอกสารการเรียกเก็บ (ใบแจ้งหนี้/ใบเสร็จของ Stripe) ถูกส่งถึงผู้รับเอกสารของร้าน — **BILL**

ทางเลือก: System Admin เปิดร้านให้โดยตรง (onboarding ฝั่ง admin, tier เริ่มต้น `STARTER_249`) — **CORE / BILL**; เซลล์สร้างดีลให้ร้านชำระในราคาพิเศษ (BP-07) — **BILL**

### 6.2 BP-02 ตั้งค่าร้านและทีม

1. เจ้าของกรอกข้อมูลนิติบุคคล ที่อยู่ สถานะ VAT — **CORE**
2. เพิ่มสาขาได้ไม่เกิน `branchLimit` ของแพ็ก — **CORE**
3. เพิ่มพนักงานได้ไม่เกิน `employeeLimit` (นับรวมเจ้าของ) กำหนดบทบาทและขอบเขตสาขา ออกรหัสผ่านชั่วคราว — **CORE**
4. พนักงานเข้าสู่ระบบครั้งแรก เปลี่ยนรหัสผ่าน ยอมรับข้อตกลง และผูกบัญชี LINE — **CORE / LINE**
5. เจ้าของตั้งหมวดค่าใช้จ่าย (`/expenses/categories`) และลายเซ็น (`/expenses/signatures`); นโยบายการเบิกจ่ายและใบรับรองแทนใบเสร็จอยู่ในเอกสาร EXP — **EXP**

### 6.3 BP-03 เก็บค่าใช้จ่ายจนถึงงานบัญชี

1. ผู้จ่ายเงินส่งรูปใบเสร็จทาง LINE หรืออัปโหลดบนเว็บ (`/expenses/upload`) หรือกรอกเอง (`/expenses/manual`) — **LINE / EXP**
2. ระบบตรวจสิทธิ์และโควตาอ่านรูป (สิทธิ์อ่านของแพ็ก → add-on รูปใบเสร็จ → สิทธิ์ฟรี 3 ใบ/เดือนในกรณีที่เข้าเงื่อนไข) — **BILL / LINE**
3. AI อ่านเอกสารและสร้างรายการร่าง สถานะ `EXTRACTING` → `NEEDS_REVIEW` — **EXP / LINE**
4. ผู้ใช้ตรวจ แก้ไข เลือกหมวด ผูกคู่ค้า จนถึง `READY_FOR_CONFIRMATION` — **EXP**
5. ผู้มีสิทธิ์ `expense.confirm` ยืนยันรายการ → `CONFIRMED` (หรือ `REJECTED` / `VOIDED`) — **EXP**
6. กรณีไม่มีใบเสร็จหรือใบเสร็จไม่ครบ ออกใบรับรองแทนใบเสร็จและลงนาม — **EXP**
7. (ENTERPRISE) กรณีมีภาษีหัก ณ ที่จ่าย ออกหนังสือรับรอง 50 ทวิจากรายการจ่าย — **TAX**
8. นักบัญชีเปิดหลักฐานทางบัญชี (`/expenses/evidence`) และส่งออกชุดเอกสาร — **EXP**
9. (ENTERPRISE) สิ้นเดือนจัดทำและดาวน์โหลดแบบ ภ.ง.ด.3 / ภ.ง.ด.53 พร้อมใบแนบ — **TAX**

### 6.4 BP-04 การเบิกจ่าย

1. พนักงานสร้างคำขอเบิก (`DRAFT`) แนบหลักฐาน แล้วส่ง (`PENDING_APPROVAL`) — **EXP**
2. ผู้อนุมัติ (ตามบทบาทที่นโยบายกำหนด) อนุมัติ (`APPROVED`) หรือปฏิเสธ (`REJECTED`) ผู้ขอยกเลิกเองได้ (`CANCELLED`) — **EXP**
3. ฝ่ายการเงินตรวจ (`FINANCE_REVIEW`) แล้วพร้อมจ่าย (`READY_FOR_PAYMENT`) — **EXP**
4. บันทึกการจ่าย (`PARTIALLY_PAID` / `PAID`) พร้อมบัญชีรับเงินและสลิป หรือยกเลิกรายการ (`VOIDED`) — **EXP**
5. ลงนามเอกสารและแจ้งเตือนผู้เกี่ยวข้อง (ลำดับและเงื่อนไขที่แน่นอนอยู่ในเอกสาร EXP) — **EXP / LINE**

### 6.5 BP-05 การใช้งานทาง LINE

1. ผู้ใช้เพิ่มเพื่อน LINE OA และผูกบัญชี — **LINE / CORE**
2. ส่งข้อความ รูป หรือไฟล์ → webhook ของ API รับเข้า ตรวจสถานะร้าน (แพ็กเกจ/การพักใช้) และ entitlement `ai_line_assistant` — **LINE**
3. AI Gateway จัดเส้นทางและเรียกเครื่องมือที่ตรวจสิทธิ์แล้วเท่านั้น ไม่เข้าฐานข้อมูลโดยตรง — **LINE**
4. ตอบเป็นข้อความหรือการ์ด พร้อมลิงก์กลับไปหน้าเว็บเมื่อจำเป็น การกระทำที่เปลี่ยนข้อมูลต้องผ่านขั้นยืนยันของผู้ใช้ — **LINE**
5. ต้นทุน AI ฝั่งแชตถูกตัดจากเครดิตแชต (ค่าเริ่มต้น 50 เครดิต/รอบ + add-on) การอ่านรูปนับแยกในโควตาใบเสร็จ — **LINE / BILL**
6. เมื่อโควตา/เครดิตหมด ผู้ที่ซื้อได้เห็นทางซื้อเพิ่ม ผู้อื่นได้ข้อความให้แจ้งผู้มีสิทธิ์จัดการแพ็กเกจ — **LINE / BILL**

### 6.6 BP-06 ต่ออายุ เปลี่ยนแพ็ก ยกเลิก และหมดอายุ

1. โหมดต่ออายุอัตโนมัติ: `CARD_AUTO` ตัดบัตรทุกรอบ, `PROMPTPAY_RENEW` ออกบิล QR ทุกรอบ; โหมดครั้งเดียว (`CARD_ONCE`, `PROMPTPAY_ONCE`) ต้องซื้อซ้ำเอง — **BILL**
2. ก่อนหมดอายุ 7 / 3 / 1 วัน ระบบแจ้งเจ้าของ — **BILL**
3. ชำระไม่สำเร็จ: มีช่วงผ่อนผันตาม `graceDays` ของ policy หนี้ค้างพิจารณาด้วยคน (`debtRecovery: 'MANUAL_REVIEW'`) — **BILL**
4. อัปเกรด: คิดตามสัดส่วนและมีผลทันที; ดาวน์เกรด: มีผลสิ้นรอบ โดยผู้ซื้อต้องเลือกสาขา/สมาชิกที่จะคงไว้เมื่อความจุลดลง (`BillingCapacitySelection`) — **BILL**
5. ยกเลิกการต่ออายุ: แพ็กใช้ได้ถึงสิ้นรอบที่ชำระ (`cancelAtPeriodEnd`) — **BILL**
6. หมดอายุ: sweep ตั้งร้านเป็น `DISABLED` ส่วนธุรกิจใช้ไม่ได้ ข้อมูลอยู่ครบ ซื้อแพ็กใหม่เพื่อกลับมาใช้ (`RESTART`) — **BILL**
7. คืนเงิน: System Admin สร้างคำสั่งคืนเงิน ผ่านการอนุมัติ ภายในวงเงินของ policy เลือกยุติแพ็กทันทีได้ (`endPackage`) — **BILL**

### 6.7 BP-07 การขายโดยทีมขายของมั่งมี

1. เซลล์ค้นหาร้าน สร้างดีล (`DRAFT`) → ส่งอนุมัติ (`PENDING_APPROVAL`) → หัวหน้าทีมอนุมัติ (`APPROVED`) — **BILL**
2. ร้านเห็นข้อเสนอบนหน้าแพ็กเกจภายใน 3 วัน แล้วชำระ (`PAID`) → ระบบ apply (`APPLIED`); หมดเวลา = `EXPIRED`; อื่น ๆ = `REJECTED` / `CANCELLED` — **BILL**
3. เซลล์สร้าง demo link ให้ผู้สนใจทดลองร้านเดโม 3 วัน — **BILL / LINE**
4. หัวหน้าทีมตั้งชุดตั๋วส่วนลดจากงาน แจกตั๋ว ร้านใช้เป็นส่วนลดหรือเครดิต — **BILL**
5. ร้านที่สมัครด้วยรหัสเซลล์ถูกบันทึกผู้แนะนำ และนับผลในรายงานทีมขาย — **BILL**

### 6.8 BP-08 การดูแลระบบและการรายงานผู้บริหาร

1. System Admin ดูแลร้าน (สถานะ `ACTIVE` / `SUSPENDED` / `DISABLED` / `ARCHIVED`), entitlement รายร้าน, โมเดลและงบ AI, การผูก LINE — **BILL / CORE**
2. เผยแพร่ billing policy และแคมเปญโปรโมชันผ่านขั้น preview → submit → approve — **BILL**
3. กระทบยอดกับ Stripe (scan เหตุการณ์/ใบแจ้งหนี้ settlement) และจัดการ issue — **BILL**
4. จัดการคำขอสิทธิ์เจ้าของข้อมูลส่วนบุคคลและการปิดบัญชีร้าน — **CORE**
5. ผู้บริหารมั่งมีดูรายงานข้ามร้าน: ภาพรวม ร้าน การใช้งาน รายได้ ลูกค้า เปรียบเทียบ (`EXECUTIVE_EXPORT_REPORT_KEYS`) — **CRM** (ตาม AREA ที่กำหนดให้ executive)

---

## 7. กฎธุรกิจ ข้อจำกัด และสมมติฐาน

### 7.1 กฎธุรกิจที่ครอบทั้งผลิตภัณฑ์

| # | กฎ | หลักฐาน |
|---|---|---|
| R1 | เว็บเป็นพื้นที่ทำงานเต็มรูปแบบและเป็นแหล่งความจริง LINE เป็นช่องทางผู้ช่วย AI สรุป แจ้งเตือน ผูกบัญชี และลิงก์กลับเว็บ | `README.md`, `docs/product/vision.md` |
| R2 | AI Gateway แยกจาก ERP core และต้องเรียก API/เครื่องมือที่ตรวจสิทธิ์แล้ว ห้ามเข้า repository ของฐานข้อมูลโดยตรง | `AGENTS.md` §Implementation Rules, `apps/ai-gateway/` |
| R3 | ปฏิเสธเป็นค่าเริ่มต้น: ทุก route ต้องผ่าน permission; permission ของฟีเจอร์ที่ไม่ได้เปิดถูกตัดตอน resolve สิทธิ์ | `feature-gate.logic.ts` |
| R4 | ข้อมูลแยกตามบริษัท (multi-tenant) และตามขอบเขตสาขาของสมาชิก | `CompanyMembership`, `BranchScopeMode` |
| R5 | แพ็กเกจกำหนดความจุสามอย่าง: สาขา ผู้ใช้ ใบเสร็จที่อ่านได้ และชุดเมนู | หัวข้อ 3 |
| R6 | ร้านที่ไม่มีแพ็กเกจหรือแพ็กหมดอายุใช้ส่วนธุรกิจไม่ได้ แต่ข้อมูลไม่ถูกลบ และหน้าซื้อแพ็ก/กู้คืนการชำระยังเข้าได้ | `plan-term.logic.ts:147-158`, `billing.ts:335-340` (`isBillingCustomerRecoveryPath`) |
| R7 | ไม่มีช่วงทดลองฟรีสำหรับร้านใหม่ตั้งแต่ 2026-09-20 | หัวข้อ 3.3 |
| R8 | การอ่านรูปด้วย AI นับทุกครั้งที่ AI อ่าน (ใบเสร็จ 1 ใบ = 1 ครั้ง) ข้อความแจ้งใช้ตัวเลขจาก term จริง ไม่ฝังในประโยค | `receipt-quota.logic.ts:43-52` |
| R9 | เครดิตแชตคือเพดานหยุดการใช้ ไม่ใช่เงินที่จ่ายให้ผู้ให้บริการ ยอดที่ไม่ได้ใช้ไม่ทบรอบถัดไปและไม่คืนเป็นเงิน การอ่านรูปเอกสาร/OCR นับแยกจากเครดิตแชต | `docs/specs/ai-chat-credit-default-80-spec-th.md` §เป้าหมายและความหมาย (เจตนา; การบังคับใช้ในโค้ดอยู่ในเอกสาร LINE), `line-ai.ts:22` |
| R10 | จำนวนเงินทุกค่าเก็บเป็นสตางค์จำนวนเต็ม สกุลเงิน THB เท่านั้น | `billing.ts:51` (`currency: 'THB'`) |
| R11 | เขตเวลาทางธุรกิจคือ Asia/Bangkok: รอบเดือนของโควตา วันที่ที่ลูกค้าเห็น และปีพุทธศักราชในข้อความ | `billing-policy.ts:138-142` (`billingMonth`), `plan-term.logic.ts:131-139` |
| R12 | คำสั่งด้านการเงินของ admin (นโยบาย คืนเงิน ให้สิทธิ์ ปรับแพ็ก) เป็น operation ที่มี preview, เหตุผล, version/hash กันชนกัน และโหมดอนุมัติ `SINGLE_ADMIN` หรือ `SECOND_REVIEWER` | `billing.ts:359-371` |
| R13 | การซื้อหนึ่งครั้งใช้สิทธิประโยชน์ได้อย่างเดียว (ปกติ / โปรโมชัน / ส่วนลดจากงาน) | `billing.ts:629-630` |
| R14 | เมนูที่การซื้อเปิด ต้องตรงกับที่การ์ดแพ็กเกจโฆษณา โดยใช้แหล่งเดียวคือ `TIER_FEATURE_PRESETS` | `menu-entitlements.ts:486-495` |
| R15 | ผู้ที่ไม่มีสิทธิ์ซื้อไม่ถูกชี้ไปที่การซื้อ แต่ถูกบอกว่าใครทำได้ | `receipt-quota.logic.ts:12-14`, `plan-manager.logic.ts:9-11` |
| R16 | ถ้อยคำที่ลูกค้าเห็นใช้ชื่อแพ็กภาษาไทย ไม่ใช่รหัส tier (`lineCustomerWording`, `customerPackageName`) และ "ต่ออายุ" ไม่ใช้เป็นปุ่มเรียกร้องให้ลูกค้าทำ | `billing.ts:779-796`, `plan-term.logic.ts:141-142` |
| R17 | บทบาทของเจ้าหน้าที่มั่งมีแยกขาดจากบทบาทของร้าน และไม่มีสิทธิ์ทางธุรกิจในร้านลูกค้า | หัวข้อ 5.3 |
| R18 | ทุกการเปลี่ยนแปลงสำคัญมี audit log (`AuditLog`) รวมถึงความล้มเหลวของขั้นตอน provisioning | `provision-signup.use-case.ts:546-575` |
| R19 | ต้องยอมรับเอกสารข้อตกลงฉบับปัจจุบันก่อนใช้งาน และการซื้อเก็บ revision ของ consent | `legal-acceptance.ts`, `billing.ts:310` |
| R20 | ไม่มี feature switch ที่ผูกกับ environment สำหรับ add-on: ขายได้เมื่อผูก Stripe Price เท่านั้น | `billing.ts:86-87` |

### 7.2 ข้อจำกัด

| ข้อจำกัด | รายละเอียด |
|---|---|
| ภาษาและตลาด | ส่วนติดต่อผู้ใช้เป็นภาษาไทยเป็นหลัก กฎภาษีเป็นของประเทศไทย สกุลเงินบาท |
| ผู้ให้บริการชำระเงิน | Stripe รายเดียว วิธีชำระ: บัตร และ PromptPay |
| ช่องทางแชต | LINE ช่องทางเดียว |
| โครงสร้างพื้นฐาน | AWS ภูมิภาค `ap-southeast-1` (`docs/runbooks/cloud-environment-operations.md`) — ถูกลบทั้งหมดเมื่อปิดโครงการ |
| การคืนเงิน/หนี้ | พิจารณาด้วยคนเสมอ ไม่มีการคืนเงินอัตโนมัติ |
| การเปลี่ยนแพ็กผ่าน Stripe Customer Portal | ไม่รองรับ (`portal_change_plan` ปิดถาวร) |
| ขีดจำกัดเชิงตัวเลขอื่น | ดีล: สูงสุด 36 เดือน/36 รอบ, ข้อเสนอ 3 วัน; ร้านที่จำกัดการขายใน policy สูงสุด 100 ร้าน; grace 0–30 วัน |

### 7.3 สมมติฐาน

1. ราคา ภาษี grace วงเงินคืนเงิน และ Stripe Price ที่ใช้จริงอยู่ใน `BillingPolicyRevision` ในฐานข้อมูล production ซึ่งถูกลบพร้อมโครงสร้างพื้นฐาน เอกสารนี้จึงบันทึก **ค่าเริ่มต้นในโค้ด** และขอบเขตที่ policy ยอมรับ
2. ทุกแพ็กที่มีราคาเปิดเมนูชุดเดียวกัน ดังนั้นเอกสารพี่น้องระบุ "แพ็กที่ได้ใช้" ของฟีเจอร์ชุด starter เป็นทุกแพ็ก และของ WHT เป็น ENTERPRISE_1999 เท่านั้น
3. ร้านรายใดรายหนึ่งอาจมี entitlement ต่างจาก preset เพราะ System Admin ปรับรายร้านได้ หรือเพราะดีลเซลล์กำหนดชุดของตัวเอง (จำกัดที่ starter + WHT สองตัว)
4. ร้าน legacy ที่ไม่มีแถว plan term หรือไม่มีแถว entitlement ถือว่าไม่จำกัด (fail open) ตามที่โค้ดกำหนด
5. เอกสารใน `docs/product/` เป็นร่างช่วงต้นโครงการ (สถานะ "Draft") และกว้างกว่าสิ่งที่ขายจริง ใช้เพื่อเจตนาเท่านั้น

---

## 8. ประวัติและไทม์ไลน์โครงการ

แหล่งข้อมูล: `git log` ของ checkout นี้ (5,176 commits; commit แรก `668a2d082` 2026-08-07 ถึง `08850deaf` 2026-11-10), `docs/runbooks/cloud-environment-operations.md`, `docs/agent-memory/`, และคอมเมนต์ที่อ้างมติ Owner ในโค้ด เวลาเป็นเวลากรุงเทพเว้นแต่ระบุ

จำนวน commit ต่อเดือน: 2026-08 = 1,173; 2026-09 = 2,252; 2026-10 = 1,640; 2026-11 = 111

| วันที่ | เหตุการณ์ | หลักฐาน |
|---|---|---|
| ก่อน 2026-08-07 | งานช่วงต้นอยู่ใน repository เดิม มีเอกสารลงวันที่ 2026-07-06 (ความต้องการใหม่) และ 2026-07-17 (การประเมินความปลอดภัย) | `docs/agent-memory/new-requirements-2026-07-06-line-login-ai-close.md`, `docs/security-assessment-*-2026-07-17.md` |
| 2026-08-07 | นำเข้าโค้ดสู่ repository ปัจจุบัน ("initial import of WatchDog-BMS") | commit `668a2d082` |
| 2026-08-08 | Owner เลือกเส้นทางขึ้น production ครั้งแรกแบบทีละ service (path B) | `docs/agent-memory/production-first-launch-path-b-decision.md` |
| 2026-08-10 | เริ่ม bootstrap production ครั้งแรกในโหมด maintenance; ชุดเอกสารกฎหมาย PDPA | `docs/agent-memory/production-deploy-2026-08-10.md` |
| 2026-08-17 | Production `PROMOTED_LIVE` และเปิดให้ลูกค้า (`OPEN`) พร้อม LINE AI | `docs/agent-memory/production-deploy-2026-08-17.md` |
| 2026-08-30 | แค็ตตาล็อกแพ็กเกจ (Billing §8) และบันไดเตือนหมดอายุ 7/3/1 วัน; LINE Login | `plan-term.ts:132`, `plan-term.logic.ts:17`, commit 2026-08-30 "production parity + LINE login release ledgers" |
| 2026-09-04 / 09-05 | ช่วงทดลอง LINE-first (15 ใบ 30 วัน); ทุกการสมัครเองได้ `FREE_TRIAL_15` | `plan-term.ts:134, 148-154` |
| 2026-09-18 | ย้าย production ไปรันด้วย Kamal | `cloud-environment-operations.md` §"Current Production Kamal — 2026-09-18" |
| 2026-09-20 | ปิดช่วงทดลองฟรีสำหรับร้านใหม่; เตรียมค่า Stripe โหมด live ของ production | `provision-signup.use-case.ts:579-584`, `docs/agent-memory/production-stripe-live-2026-09-20.md` |
| 2026-09-21 | เปิดขาย ENTERPRISE_1999; กำหนด `TIER_FEATURE_PRESETS` | `billing.ts:8`, `menu-entitlements.ts:486-489` |
| 2026-09-23 | release UAT/Production ด้วย Kamal; ตัดสินใจเครดิตแชตเริ่มต้น 80 | `docs/agent-memory/uat-prod-kamal-release-2026-09-23.md`, commit `16696c10c` |
| 2026-09-29 → 09-30 | release หลายรอบ: ซื้อโดยไม่ต้องตั้งค่าก่อน (purchase-without-setup) และการแก้ LINE AI; มติ "no switches" ของ add-on ลงวันที่ 2026-09-29 ในโค้ด (`billing.ts:86`) | `cloud-environment-operations.md` §"Release 2026-09-29" |
| 2026-10-05 / 10-06 | release production สองรอบ (การ์ด LINE System OA และผู้ช่วยรอบ 2a–2k) | `cloud-environment-operations.md` §"Release 2026-10-05", §"Release 2026-10-06" |
| 2026-10-07 → 10-09 | โครงสร้างพื้นฐานถูกปิดเหลือศูนย์ แล้วกู้คืน production จาก offline backup และเปิดอีกครั้งตามคำสั่ง Owner | `cloud-environment-operations.md` §"Production disaster restoration … 2026-10-09", `docs/agent-memory/production-offline-restore-2026-10-09.md` |
| 2026-10-10 / 10-12 | release การคืนเงิน PromptPay; ย้าย Official OA | `cloud-environment-operations.md` §"Release 2026-10-10", §"Release 2026-10-12" |
| 2026-10-20 → 10-22 | release ช่วง 2026-10-20 ถึง 10-22 (runbook อ้างถึงในหัวข้อ release 2026-10-12); งาน redirect/SEO ของเว็บสาธารณะและ security readback ของ production วันที่ 2026-10-21 | `cloud-environment-operations.md` §"Production security readback — 2026-10-21", §"Public website redirect preparation — 2026-10-21" |
| 2026-10-28 | release กิจกรรม Halloween | `docs/agent-memory/halloween-release-2026-10-28.md` |
| 2026-10-29 / 10-30 | release ประวัติกิจกรรมค่าใช้จ่ายแบบกระชับ | `cloud-environment-operations.md` §"2026-10-30" |
| 2026-11-08 | เครดิตแชตเริ่มต้นเปลี่ยนจาก 80 เป็น 50 | `docs/specs/ai-chat-credit-default-80-spec-th.md` (บรรทัดมติ 2026-11-08), `line-ai.ts:23` |
| 2026-11-09 | release LINE recent-record focus (รอบ 29) และทุกอย่างตั้งแต่ 2026-10-30 | `cloud-environment-operations.md` §"2026-11-09 23:54" |
| 2026-11-10 | release production ครั้งสุดท้าย: main `531619870` (ลิงก์ LIFF ของ demo chat) 07:36 น.; commit เอกสารสุดท้าย `08850deaf` | `cloud-environment-operations.md` §"2026-11-10 07:36" |
| 2026-11-16 | **ปิดโครงการ** — ลบโครงสร้างพื้นฐาน cloud ทั้งหมด | `docs/software-documentation/_BRIEF.md` (ไม่มีหลักฐานใน commit เพราะเกิดหลัง commit สุดท้าย) |

วิวัฒนาการของวิธีส่งมอบ (สรุปจาก runbook): ช่วงแรกใช้ GitHub Actions + ECS พร้อมพิธี promotion ที่มีลายเซ็น → ตั้งแต่ 2026-09-18 ใช้ Kamal จากเครื่องผู้ควบคุมโดย release ผ่าน UAT ก่อนแล้ว promote image เดิมไป production → ช่วงท้าย push ตรงเข้า `develop`/`main` และตรวจด้วยชุดทดสอบในเครื่อง รายละเอียดอยู่ในเอกสารด้านปฏิบัติการของชุดนี้

---

## 9. ทะเบียน Business Requirements (BR)

| ID | ชื่อ | สาระ | AREA ที่ลงรายละเอียด | หัวข้ออ้างอิง |
|---|---|---|---|---|
| BR-001 | เว็บเป็นพื้นที่ทำงานหลัก LINE เป็นผู้ช่วย | แยกบทบาทของสองช่องทางตามหลักการผลิตภัณฑ์ | CORE, LINE | 1.2, 7.1 R1 |
| BR-002 | Multi-tenant และขอบเขตสาขา | ข้อมูลแยกตามบริษัทและสาขา | CORE | 5.2, 7.1 R4 |
| BR-003 | สมัครใช้งานด้วยตนเอง | ฟอร์มเว็บและ LINE พร้อมการยืนยันอีเมลและคิวตรวจของ admin | CORE | 6.1 |
| BR-004 | ร้านใหม่ต้องซื้อแพ็กก่อนใช้ | ไม่มีทดลองฟรี ร้านใหม่ล็อกด้วย `no_package` | BILL | 3.3 |
| BR-005 | แค็ตตาล็อก 5 tier | `FREE_TRIAL_15`, `STARTER_249`, `BASIC_499`, `PRO_999`, `ENTERPRISE_1999` พร้อมราคาและความจุ | BILL | 3.1 |
| BR-006 | ราคารายเดือนและรายปี | รายปี = 10 เท่าของรายเดือน และได้สิทธิ์ใบเสร็จทั้งปีทันที | BILL | 3.1 |
| BR-007 | ขีดจำกัดสาขา | บังคับ `branchLimit` ตามแพ็ก | CORE, BILL | 3.4 |
| BR-008 | ขีดจำกัดผู้ใช้ | บังคับ `employeeLimit` ตามแพ็ก นับรวมเจ้าของ | CORE, BILL | 3.4 |
| BR-009 | โควตาอ่านใบเสร็จ | บังคับสิทธิ์อ่านรูปตามแพ็กและช่วงที่ชำระ | BILL, LINE, EXP | 3.1, 7.1 R8 |
| BR-010 | สิทธิ์ฟรี 3 ใบ/เดือนหลังทดลอง | ร้านทดลองที่ไม่เคยซื้อยังส่งร่างได้เดือนละ 3 ใบ | BILL, EXP | 3.3 |
| BR-011 | ยกยอดใบเสร็จจากช่วงทดลอง | สิทธิ์ที่เหลือยกไปเมื่อซื้อแพ็กแรก | BILL | 3.3 |
| BR-012 | วงจร plan term | สถานะ การเตือน 7/3/1 วัน การล็อกเมื่อหมดอายุ ข้อมูลไม่หาย | BILL | 3.4 |
| BR-013 | ชุดฟีเจอร์ตามแพ็ก | ทุกแพ็กได้ชุด starter; ENTERPRISE เพิ่ม `wht_pnd53`, `wht_50bis` | ทุก AREA | 3.2, 4 |
| BR-014 | การบังคับ entitlement จุดเดียว | ตัด permission ของฟีเจอร์ที่ไม่ได้เปิด มีผลกับ API เมนู และ LINE AI | CORE | 4.3 ข้อ 8 |
| BR-015 | Platform baseline | `employee_access` และ `company_settings` เปิดเสมอ | CORE | 2.2, 4 |
| BR-016 | ชำระเงินผ่าน Stripe | บัตรและ PromptPay แบบครั้งเดียวและต่ออายุ | BILL | 3.5 |
| BR-017 | การคิดภาษีค่าบริการ | สามรูปแบบ `taxTreatment` | BILL | 3.6 |
| BR-018 | เปลี่ยนแพ็ก | อัปเกรดตามสัดส่วนทันที ดาวน์เกรดสิ้นรอบ พร้อมการเลือกความจุที่คงไว้ | BILL | 3.5, 6.6 |
| BR-019 | ยกเลิกและช่วงผ่อนผัน | ยกเลิกมีผลสิ้นรอบ มี grace ตาม policy | BILL | 3.5, 6.6 |
| BR-020 | การคืนเงิน | พิจารณาด้วยคน มีวงเงินและการอนุมัติ | BILL | 3.5, 6.6 |
| BR-021 | Add-on เครดิตแชต | `CHAT_50` / `CHAT_100` / `CHAT_300` อายุ 12 เดือน | BILL, LINE | 3.7 |
| BR-022 | Add-on รูปใบเสร็จ | `RECEIPT_IMAGE_20` / `_50` / `_100` อายุ 12 เดือน | BILL, EXP | 3.7 |
| BR-023 | เครดิตแชตที่มากับแพ็ก | ค่าเริ่มต้น 50 เครดิตต่อรอบ ทุก tier | LINE, BILL | 3.1 |
| BR-024 | แคมเปญโปรโมชัน | เดือนฟรี + ใบเสร็จเพิ่มสำหรับ STARTER ครั้งเดียวต่อร้านต่อแคมเปญ | BILL | 3.8 |
| BR-025 | ดีลทีมขาย | ราคาพิเศษรายร้าน มีการอนุมัติและวันหมดอายุข้อเสนอ | BILL | 3.8, 6.7 |
| BR-026 | ตั๋วส่วนลดจากงาน | ใช้เป็นส่วนลดหรือเครดิต หนึ่งใบต่ออีเวนต์ต่อร้าน | BILL | 3.8 |
| BR-027 | การแนะนำโดยเซลล์ | รหัสเซลล์ตอนสมัครและการนับผล | BILL | 3.8 |
| BR-028 | ลิงก์เดโม | ร้านเดโมชั่วคราวสำหรับผู้สนใจ | BILL, LINE | 3.8 |
| BR-029 | บทบาทมาตรฐานฝั่งร้าน | 12 บทบาท พร้อมกฎการมอบและขอบเขตสาขา | CORE | 5.2 |
| BR-030 | บทบาทที่ร้านสร้างเอง | ประกอบจาก capability pack | CORE | 5.2 |
| BR-031 | ผู้จัดการแพ็กเกจ | ซื้อ/เปลี่ยนแพ็กได้เฉพาะผู้ถือ `company.plan.manage` | BILL, CORE | 5.2 |
| BR-032 | บทบาทแพลตฟอร์มแยกขาด | System Admin ทีมขาย ผู้บริหาร ไม่ปนกับบทบาทร้าน | CORE, BILL | 5.3 |
| BR-033 | บันทึกค่าใช้จ่ายและใบเสร็จ | อัปโหลด/ส่งทาง LINE/กรอกเอง ตรวจ ยืนยัน | EXP | 6.3 |
| BR-034 | AI อ่านใบเสร็จ | สร้างรายการร่างจากรูปเอกสาร | EXP, LINE | 6.3 |
| BR-035 | หลักฐานทางบัญชีและการส่งออก | ชุดหลักฐานสำหรับนักบัญชี | EXP | 6.3 |
| BR-036 | ใบรับรองแทนใบเสร็จและลายเซ็น | ออกเมื่อหลักฐานไม่ครบ พร้อมการลงนาม | EXP | 6.3 |
| BR-037 | การเบิกจ่าย | คำขอ อนุมัติ ตรวจการเงิน จ่าย ลงนาม | EXP | 6.4 |
| BR-038 | คู่ค้า | ทะเบียนผู้ขายที่ใช้กับค่าใช้จ่าย | EXP | 4.3 ข้อ 2 |
| BR-039 | ภ.ง.ด.3 / ภ.ง.ด.53 ในระบบ | เฉพาะ ENTERPRISE_1999 | TAX | 6.3 |
| BR-040 | หนังสือรับรอง 50 ทวิในระบบ | เฉพาะ ENTERPRISE_1999 | TAX | 6.3 |
| BR-041 | ผู้ช่วย AI ทาง LINE | ถามข้อมูล รับสรุป ส่งเอกสาร ภายใต้สิทธิ์ของผู้ใช้ | LINE | 6.5 |
| BR-042 | AI ผ่าน Gateway และเครื่องมือที่ตรวจสิทธิ์ | ไม่เข้าฐานข้อมูลโดยตรง การเปลี่ยนข้อมูลต้องยืนยัน | LINE | 7.1 R2 |
| BR-043 | หน้าแรกและการแจ้งเตือน | ภาพรวมและการแจ้งเตือนในเว็บ/LINE | CORE | 4 |
| BR-044 | การจัดการพนักงานและความปลอดภัยบัญชี | พนักงาน บทบาท ภาพรวมสิทธิ์ รหัสผ่าน การผูกบัญชี | CORE | 4, 6.2 |
| BR-045 | System console | ดูแลร้าน วงจรชีวิต entitlement รายร้าน โมเดล AI | BILL, CORE | 6.8 |
| BR-046 | Billing control plane | นโยบาย กระทบยอด issue การอนุมัติ | BILL | 6.8, 7.1 R12 |
| BR-047 | รายงานผู้บริหารของมั่งมี | รายงานข้ามร้านสำหรับผู้บริหาร | CRM | 6.8 |
| BR-048 | ข้อตกลงและสิทธิ์ข้อมูลส่วนบุคคล | การยอมรับข้อตกลง และคำขอสิทธิ์เจ้าของข้อมูล | CORE | 7.1 R19 |
| BR-049 | Audit trail | บันทึกการเปลี่ยนแปลงสำคัญทั้งหมด | CORE | 7.1 R18 |
| BR-050 | ถ้อยคำภาษาไทยที่ลูกค้าเข้าใจ | ชื่อแพ็กภาษาไทย ข้อความบอกทางออก ไม่ชี้การซื้อให้ผู้ไม่มีสิทธิ์ | ทุก AREA | 7.1 R15, R16 |
| BR-051 | เงินเป็นสตางค์ สกุล THB เวลา Asia/Bangkok | มาตรฐานข้อมูลการเงินและเวลา | ทุก AREA | 7.1 R10, R11 |
| BR-052 | Launch gate ระดับแพลตฟอร์ม | เปิด/ปิดการเข้าถึงของลูกค้าทั้งระบบ | CORE | 2.2 |

---

## 10. สิ่งที่ตรวจไม่ได้ และจุดที่เอกสารไม่ตรงกับโค้ด

### 10.1 ตรวจไม่ได้จาก checkout นี้

| เรื่อง | เหตุผล |
|---|---|
| ราคา ภาษี grace วงเงินคืนเงิน และ Stripe Price ที่ใช้จริงใน production | อยู่ใน policy revision ในฐานข้อมูล ไม่อยู่ในโค้ด โค้ดมีเพียงค่าเริ่มต้นและ `BILLING_DRAFT_POLICY` |
| แคมเปญโปรโมชันที่เคยเผยแพร่จริง (ช่วงวัน เพดาน จำนวนผู้ใช้สิทธิ์) | เป็นข้อมูลใน policy revision โค้ดมีเพียงแม่แบบ `BILLING_PROMOTION_STARTER_TEMPLATE` |
| จำนวนร้าน ยอดขาย และ entitlement จริงของร้านแต่ละราย | เป็นข้อมูล production |
| วันปิดโครงการ 2026-11-16 และการลบโครงสร้างพื้นฐาน | เกิดหลัง commit สุดท้าย อ้างจาก `_BRIEF.md` เท่านั้น |
| เหตุผลของการปิดโครงสร้างพื้นฐานช่วง 2026-10-07 | runbook บันทึกสถานะ "zero-resource inventory" และการกู้คืน แต่เอกสารนี้ไม่ได้ไล่อ่านสาเหตุ |
| พฤติกรรมเมนูด้านข้างของเว็บต่อ binding `counterparties` ในร้านชุด starter | ตรวจระดับ permission แล้ว (สิทธิ์คงอยู่) แต่ไม่ได้ไล่ logic การแสดงเมนูใน `apps/web` ทั้งหมด — ให้เอกสาร EXP ยืนยัน |

### 10.2 มีใน spec/เอกสาร แต่โค้ดไม่ตรงหรือไม่ได้ขาย

| เอกสาร | สิ่งที่เอกสารบอก | ความจริงในโค้ด |
|---|---|---|
| `docs/product/vision.md` §MVP Outcome | SME จัดการสินค้า/สต๊อก การขาย ใบเสนอราคา ใบแจ้งหนี้ CRM ภาษี ผ่านระบบ | มีโค้ดของโมดูลเหล่านี้ แต่ไม่มี feature key ใดของโมดูลเหล่านี้อยู่ใน `TIER_FEATURE_PRESETS` — ไม่ได้ขาย |
| `docs/product/business-model.md` §Possible Pricing Models | สามระดับ Starter / Growth / Pro ที่ต่างกันด้วยโมดูล (สต๊อก CRM เอกสารบัญชี ภาษี AI ขั้นสูง หลายสาขา marketplace) | มีใน spec แต่ไม่พบในโค้ด: แพ็กจริงมี 4 tier ที่มีราคา ต่างกันด้วยความจุ ไม่ใช่โมดูล |
| `docs/product/business-use-cases.md` BUC-19 ถึง BUC-23 | Marketplace import, Payroll/HR, Fixed assets, Manufacturing/MRP, AI marketing | ไม่มี feature key ใน `FEATURE_CATALOG` สำหรับรายการเหล่านี้ (agent `marketing` มีสถานะ `planned` ใน `LINE_AI_AGENT_REGISTRY`) |
| `docs/specs/ai-chat-credit-default-80-spec-th.md` (ชื่อไฟล์และเนื้อหาหลัก) | เครดิตแชตเริ่มต้น 80 เครดิต | โค้ดเป็น 50 (`DEFAULT_CHAT_CREDIT_SATANG = 5_000`) ตามมติ 2026-11-08 ที่บันทึกไว้หัวไฟล์ spec เดียวกัน คอมเมนต์ที่ `billing.ts:349` ยังเขียนว่า "80-credit CHAT allowance" ซึ่งล้าสมัย |
| `packages/contracts/src/billing.ts:354` (type `BillingCatalog.trial`) | ช่วงทดลอง 30 วัน 15 ใบ 7 เมนู | field ยังอยู่ใน type เพื่อความเข้ากันได้ แต่ไม่ถูกส่งแล้ว (คอมเมนต์ R1) ร้านใหม่ไม่ได้ทดลองฟรี |
| คอมเมนต์ `feature-entitlements.ts:15-17` | "18 จาก 20 top-level keys ขายได้" | หมายถึง `sellable: true` (เป็นตัวเลือกทางการค้าได้) ไม่ใช่ "ถูกขายในแพ็ก": ในแพ็กจริงมี top-level ที่ขายเพียง 6 keys (`dashboard_notifications`, `expenses`, `reimbursement`, `ai_line_assistant`, `wht_pnd53`, `wht_50bis`) บวก baseline 2 keys |
| `README.md` บรรทัดแรก | "watching your stock, sales, KPI, accounts & team" | สะท้อนวิสัยทัศน์ ไม่ใช่ขอบเขตที่ขาย |

---

## 11. นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)

โมดูล/เมนูต่อไปนี้มีโค้ดใน checkout แต่ไม่มี entitlement key อยู่ในแพ็กใดถึง ENTERPRISE_1999 เอกสารชุดนี้ไม่ลงรายละเอียด

| รายการ | feature key / navKey | สถานะเมนู | หมายเหตุหนึ่งบรรทัด |
|---|---|---|---|
| สินค้า/สต๊อก | `inventory` + 3 submenu / `inventory` | ready | คลังสินค้า ความเคลื่อนไหว รายงานสต๊อก — โมดูล `apps/api/src/modules/inventory` |
| สินค้าและบริการ | `product_catalog` / `crmsettings` | ready | แค็ตตาล็อกสินค้า/บริการสำหรับงานขาย |
| เอกสารขาย | `sales_documents` / `salesdoc`, `sales`, `accounting` | planned ทั้งสามเมนู | ใบเสนอราคา ใบแจ้งหนี้ ใบเสร็จ การรับชำระ — โมดูล `accounting-documents` |
| บัญชีแยกประเภท | `double_entry_ledger` / `journal` (ready), `closing` (planned) | ready / planned | ผังบัญชี สมุดรายวัน งบการเงิน ปิดงวด — โมดูล `ledger` |
| ลงบัญชีค่าใช้จ่ายอัตโนมัติ | `expense_auto_post` | ไม่มีเมนู | พฤติกรรมเบื้องหลัง ต้องเปิด `double_entry_ledger` ไม่อยู่แม้ใน preset `full` |
| ภาษีไทย (workspace เต็ม) | `thai_tax` / `tax` | ready | VAT, WHT, CIT — โมดูล `tax`; ส่วนที่ขายคือ `wht_pnd53` และ `wht_50bis` เท่านั้น |
| จัดซื้อ/เจ้าหนี้ | `procurement` + 7 submenu / `procurement`, `accounts-payable` (ready), `poapproval` (planned) | ready / planned | ผู้จำหน่าย PR PO GR ใบวางบิล การชำระ AP aging — โมดูล `procurement` |
| ธนาคารและกระทบยอด | `bank_reconciliation` + 6 submenu / `banking` | ready | บัญชีธนาคาร statement การจับคู่ กระทบยอด — โมดูล `banking` |
| ลูกค้าและ CRM | `crm` + 7 submenu / `crm`, `customers`, `inbox`, `booking` (ready), `crmreport`, `discount` (planned) | ready / planned | ลีด ไปป์ไลน์ งานติดตาม ลูกค้า กล่องข้อความ การจอง — โมดูล `crm`, `crm-inbox` |
| ตั้งค่าและกฎการแจ้งเตือน | `dashboard_notifications.preferences`, `dashboard_notifications.rules` | ไม่มี binding ของตัวเอง | submenu สองตัวนี้ไม่อยู่ใน preset starter แม้ key แม่จะขาย |
| เชื่อมต่อ LINE OA ของร้าน | `line_oa` / `lineoa` | ready | ร้านเชื่อม LINE OA ของตัวเอง — คนละเรื่องกับ LINE OA ของมั่งมีที่ผู้ช่วย AI ใช้ |
| รายงาน/BI | `reports` / `reports` | ready | รายงานข้ามโมดูลและการส่งออก — โมดูล `reports` |
| ระบบอัตโนมัติ | `workflow_automation` + 6 submenu / `workflow` | ready | เทมเพลต กฎ งาน ประวัติ dead letter webhook — โมดูล `workflow` |
| Preset `standard` และ `full` | — | — | ปุ่มลัดของ System Admin ไม่ผูกกับ tier ใด |
| AI agent ที่ไม่มีข้อมูลรองรับในแพ็ก | agent `inventory`, `sales`, `crm`, `cfo` (บางเครื่องมือ), `tax` (บางเครื่องมือ), `marketing` (`planned`) | — | เครื่องมือที่อ่านโมดูลนอกขอบเขตถูกกันด้วย entitlement เดียวกัน (รายละเอียดในเอกสาร LINE) |
| Use case ที่ไม่มีโค้ด/ไม่มี feature key | BUC-19 ถึง BUC-23 | — | Marketplace, Payroll/HR, Fixed assets, Manufacturing/MRP, AI marketing — มีใน spec แต่ไม่พบในโค้ดเป็นฟีเจอร์ที่ขาย |
