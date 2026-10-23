# บันทึกประกอบการตัดสินใจ: ฟีเจอร์ที่สร้างแล้วแต่ยังไม่ได้ขาย (23 ต.ค. 2569)

Status: DECISION MEMO — รอเจ้าของตัดสิน (ไม่มีการแก้โค้ด) · รีวิว 3 รอบ 2026-10-24 (รอบ 1 F4, F17–F19; รอบ 2 F10, F13; รอบ 3 F2, F3) ไม่มี HIGH ค้าง
Owner: Product owner (ตัดสิน) · เตรียมโดย docs lane
Related: `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md` (ข้อ 15), `docs/specs/package-sale-feature-scope-2026-09-23.md`, `docs/agent-memory/package-sale-feature-scope-2026-09-23.md`, `docs/specs/accounting-tax-readiness-assessment.md`
Baseline: main 6c54ba208 (2026-10-23)

---

## สรุปคำแนะนำ (อ่านแค่ส่วนนี้ก็พอ)

- **ยังไม่ควรเปิดขายเพิ่มสักตัวในรอบนี้** — ทุกตัวไม่เคยผ่าน UX ตามมาตรฐานที่ใช้กับแพ็กที่ขาย (`docs/plans/sold-features-ux-program-plan.md:11` "Out: … unsold modules"), ไม่มีหลักฐานใช้งานบน UAT (ตรวจล่าสุด 2026-08-03: UAT ปิด `sales_documents`, `thai_tax`, `reports`, `double_entry_ledger`, `bank_reconciliation`, `workflow_automation` ทั้ง 7 บริษัท — `docs/agent-memory/uat-print-file-open-diagnosis.md:13`; หลังสร้างสภาพแวดล้อมใหม่ 2026-10-09 ยังไม่ได้ตรวจซ้ำ), และ browser test ใน CI ไม่ครอบคลุม (`.github/workflows/extended-tests.yml:337,354` รันแค่ spec ของฟีเจอร์ที่ขาย)
- **ตัวที่ควรเตรียมเปิดก่อน (เมื่อพร้อม)**: ① เอกสารขาย + ฝั่งรายรับของสมุดรายรับ–รายจ่าย ② หน้า VAT/ภ.พ.30 — ทั้งสองเป็น "ส่วนเสริมของแพ็ก 1,999" หลังผ่านเงื่อนไขในตาราง ไม่ใช่เปิดในแพ็กล่าง
- **ไม่ควรขายในแพ็กรายจ่าย**: สต๊อก, CRM, LINE OA ของร้าน, รายการสินค้า (เป็นอีกผลิตภัณฑ์ ลูกค้าคนละกลุ่ม ความเสี่ยง PDPA ข้อมูลลูกค้าปลายทาง), จัดซื้อ/เจ้าหนี้ (ซ้อนกับเส้นทางรายจ่าย–ใบเตรียมจ่ายที่ขายอยู่), ตัวสร้างเวิร์กโฟลว์ (ระบบใช้ template ภายในอยู่แล้วโดยไม่ต้องเปิดเมนู), สมุดบัญชีคู่ + ลงบัญชีอัตโนมัติ (เครื่องมือนักบัญชี มีช่องโหว่ความถูกต้อง)
- **ปิดทางที่ร้านได้ฟีเจอร์ที่ไม่ได้ขายโดยไม่ตั้งใจ**: ผู้ดูแลระบบเปิดให้ได้ทั้งปุ่มชุด สวิตช์รายเมนู และ API (รับทุก key) และสิทธิ์นั้น **อยู่ต่อหลังร้านจ่ายเงินต่ออายุ** — ต้องบังคับที่ backend ไม่ใช่แค่ซ่อนปุ่ม (ดู §3, D4)

---

## 1. ข้อเท็จจริงที่ตรวจแล้ว

- แพ็ก 249/499/999 = preset `starter`; 1,999 = starter + `wht_pnd53` + `wht_50bis` (`packages/contracts/src/menu-entitlements.ts:432-450,496-501`)
- preset `standard` เพิ่ม CRM, สินค้า, LINE OA, เอกสารขาย, ภาษีไทย, บัญชีแยกประเภท, รายงาน, สต๊อก (`:460-478`); `full` = ทุก key ยกเว้น `expense_auto_post` (`:480-483`)
- ดีลของเซลล์ขายได้แค่ starter + 2 สิทธิ์หัก ณ ที่จ่าย (`:504-508`); ปุ่ม "ชุดมาตรฐาน/ชุดครบวงจร" ในฟอร์มดีล **แสดงแต่กดไม่ได้** (`apps/web/src/features/sales-console/SalesDealFormPage.tsx:110-115`), API ปฏิเสธ key อื่นด้วย `SALES_DEAL_STATE_CONFLICT` "รายการเมนูไม่ถูกต้อง" (`apps/api/src/modules/sales-console/domain/sales-deal.logic.ts:150-152`, `application/sales-deals.service.ts:350-351,640`)
- ผู้ดูแลระบบมีปุ่ม preset `standard`/`full` ต่อร้าน (`apps/web/src/features/system-partners/system-partners.logic.ts:41-47`, `PartnerDetailPage.tsx:1197`)
- การตัดสินของเจ้าของที่เกี่ยวข้อง:
  - 2026-09-23: ทุกแพ็กใช้ชุด starter, 1,999 เพิ่มแค่ ภ.ง.ด.53/50 ทวิ (`docs/agent-memory/package-sale-feature-scope-2026-09-23.md:6`)
  - 2026-10-03: "focus แค่ รายการตามฟีเจอร์ pack ที่เราเปิดขายเท่านั้น" (บันทึกเจ้าของ เรื่องใบสั่งซื้อ)
  - 2026-10-20: เว็บไซต์หลักห้ามโฆษณา CRM สต๊อก งานขาย บัญชีแยกประเภท ยื่นภาษีอัตโนมัติ (`docs/agent-memory/mangmee-main-website-prototype-2026-10-20.md:73`)
  - 2026-08-27: งานกระทบยอด/จับคู่รายรับ เลื่อนออกไป (`docs/plans/mangmee-four-lane-gap-closure-plan-th.md:7`)
  - **ขัดกันอยู่**: 2026-08-04 ให้ onboarding แบบผู้ดูแลเปิด `thai_tax`, `double_entry_ledger`, `workflow_automation`, `crm`, `line_oa`, `product_catalog` เป็นค่าตั้งต้น (`apps/api/src/modules/system-partner-management/domain/feature-registry.ts:21-39`) — ใช้เฉพาะ onboarding ที่ไม่ใช่ `modulePackage: 'starter'` (`create-company-onboarding.use-case.ts:584-592`; ค่าตั้งต้นของคำสั่งคือ starter)

## 2. ตารางตัดสินใจ

ความพร้อม: 🟢 ขายได้หลังทำ UX/UAT · 🟡 ต้องปิดช่องโหว่ก่อน · 🔴 มีปัญหาความถูกต้องที่ยังไม่แก้

| ฟีเจอร์ (key) | ร้านได้อะไร | ความพร้อม (สเปก / ช่องโหว่ / หลักฐาน) | พึ่งอะไร | ความเสี่ยงงานซัพพอร์ต | คำแนะนำ |
|---|---|---|---|---|---|
| ภาษีไทย (`thai_tax`) — VAT, ภ.พ.30 workpaper | หน้า ภาษี (ภาษีซื้อ–ขาย, กระทบ, หลักฐาน, หัก ณ ที่จ่าย), ตั้งค่ารหัสภาษี; LINE `tax.*` 8 tools | 🔴 สเปก ภ.พ.30 "PARTIAL READY" (`docs/specs/mangmee-tax-workpaper-pp30-spec-th.md:3`), "FORM OUTPUT BLOCKED" (`mangmee-four-lane-gap-closure-plan-th.md:241`); สาขาของภาษีขาย: event แบบ component เก็บ `branchId` ของผู้ขายแล้ว (`tax/application/use-cases/sync-tax-events.use-case.ts:157`) แต่เส้นทาง header แบบเดิมสร้าง event โดยไม่ใส่ `branchId` ของผู้ขาย (`:207-215`) และ adapter ตั้ง `branchCode: null` ให้ snapshot ของคู่ค้า (`tax/infrastructure/adapters/accounting-document-source.adapter.ts:52`) — RA-17 จึงเหลือเฉพาะเส้นทางเดิม; route ผู้เชี่ยวชาญ seed เป็น CLOSED (`feature-launch/domain/launch-matrix.catalog.ts:225-250`); ไม่มี UAT | ภาษีซื้อจากรายจ่าย (มีแล้ว), tax-code profile (เฉพาะร้านหลัง 2026-08-04 ไม่มี backfill) | สูงมาก — ตัวเลขยื่นแบบผิด = ร้านโดนเบี้ยปรับ | **ภายหลัง** เป็นส่วนเสริม 1,999 เมื่อ: แบบฟอร์ม ภ.พ.30 ผ่านผู้เชี่ยวชาญภาษี, ปิดเส้นทาง header เดิมหรือเติม branchId, UAT กับร้านจด VAT จริง 1 ร้าน (มีหลายสถานประกอบการ — ภ.พ.30 ยื่นแยกรายสถานประกอบการ เว้นแต่ได้รับอนุมัติให้ยื่นรวม ประมวลรัษฎากร ม.83 https://www.rd.go.th/5207.html — workpaper ต้องรองรับทั้งสองแบบ), ผ่าน UX |
| บัญชีแยกประเภท (`double_entry_ledger`) | สมุดรายวัน งบทดลอง กำไรขาดทุน งบดุล ผังบัญชี และปิดงวดจากในหน้าสมุดรายวัน (`apps/web/src/features/ledger/LedgerReportsPage.tsx:131` `closePeriod`); route `/period-closing` แยกเป็นหน้า placeholder — **แต่วันนี้เปิดไม่ได้แม้มี entitlement**: `ACCOUNTING_UI_HIDDEN = true` ปิดโมดูล `journal`/`closing` ทั้งเมนูและ URL ตรง (`apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:14-17`, `web-core-workspace.logic.ts:164`) | 🔴 ยอดยกมาเป็น 0 เสมอ (`ledger/application/use-cases/report.use-case.ts:45`), ส่งออก XLSX ยังไม่ทำ (`:187` `export_not_implemented`), ไม่มีปิดสิ้นปี (GAP-05 `docs/specs/finance-accounting-gaps-spec.md:233`), ไม่มีหน้าบันทึกรายวันด้วยมือ (RA-04); หลักฐาน local เท่านั้น | ผังบัญชี + posting rule ที่ review แล้ว | สูงมาก — งบการเงินผิด ต้องมีนักบัญชี | **ไม่ขายให้ร้านทั่วไป**; ทบทวนเฉพาะถ้าจะทำแพ็กสำหรับสำนักงานบัญชี |
| ลงบัญชีรายจ่ายอัตโนมัติ (`expense_auto_post`) | ไม่มีหน้า — โพสต์ journal อัตโนมัติเมื่อยืนยันรายจ่าย | 🔴 รายจ่ายที่มีหัก ณ ที่จ่ายได้ error `wht_account_unmapped` (`ledger/domain/logic/posting-engine.logic.ts:263`); event นอกชุดที่ผูกแล้วได้ `posting_rule_missing` (`journal.use-case.ts:420-431`); memory ห้ามเปิดจนกว่า slice WHT/payment เสร็จ (`docs/agent-memory/cr-2-posting-rule-writer.md:117-119`) | `double_entry_ledger` (บังคับ `feature-entitlements.ts:623`) | สูงมาก — journal หายเงียบ ๆ | **ไม่เปิด** (แม้ preset `full` ก็ตัดออกอยู่แล้ว) |
| จัดซื้อ/เจ้าหนี้ (`procurement`) | ผู้จำหน่าย, PR, PO, รับสินค้า, ใบวางบิล, จ่ายเจ้าหนี้, อายุเจ้าหนี้; LINE `procurement.*` | 🟡 สเปก "Ready for implementation handoff"; ไม่มีขั้นปล่อยจ่าย (GAP-03 `finance-accounting-gaps-spec.md:231`); เมนูอนุมัติ PO ยัง `planned`; หลักฐาน local เท่านั้น | ใบวางบิล ← จ่าย/อายุเจ้าหนี้ (`feature-entitlements.ts:624-625`); รายชื่อผู้จำหน่ายแยกจาก "คู่ค้า" ที่ขาย | สูง — สองทางบันทึกบิลผู้ขาย (รายจ่าย vs ใบวางบิล) ทำให้ลูกค้าสับสน | **ไม่ขายในแพ็กรายจ่าย**; ถ้าต้องการอะไร (เช่น หัก ณ ที่จ่ายตอนจ่าย) ให้เติมในเส้นทางรายจ่าย/ใบเตรียมจ่ายที่ขายอยู่ |
| กระทบยอดธนาคาร (`bank_reconciliation`) | บัญชีธนาคาร เงินสด นำเข้า statement CSV/Excel/PDF จับคู่ ปรับปรุง | 🔴 ฝั่งบัญชีเท่ากับยอดยกมาของ statement ไม่เคยเทียบ GL (`banking/domain/logic/banking.logic.ts:349-367`); รายการปรับปรุงค้าง `pending` (RA-05); เจ้าของเลื่อนงานนี้ 2026-08-27 | ledger + แหล่งการจ่าย | กลาง–สูง — ดูเหมือนกระทบแล้วแต่ไม่ได้เทียบจริง | **ภายหลัง** — ผูกกับ backlog ข้อ 11; **อย่านับ Your Data ของ ธปท. เป็นทางเชื่อมที่มีวันแน่นอน**: เอกสาร ธปท. ปี 2568 (https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2568/ThaiPDF/25680236.pdf) มีข้อความ "ไม่ถือว่าเป็นผู้ที่สามารถรับข้อมูล" สำหรับบางกรณี (อ้างตามรีวิว 2026-10-24 — ยังไม่ได้อ่านบริบทเต็มเอง เพราะ PDF แปลงเป็นข้อความไม่ได้ในเครื่องมือที่มี) — **ยังไม่ได้ยืนยันว่า SaaS อย่างเราเข้าเงื่อนไขผู้รับข้อมูล**; และหนังสือเวียน ธปท. ว. 2409/2569 ลงวันที่ 16 เม.ย. 2569 ผ่อนผันการแจ้ง/เปิดเผยบทบาทของผู้รับ–ส่งข้อมูลนิติบุคคล SME เพราะการพิสูจน์ตัวตนดิจิทัลของนิติบุคคลยังไม่พร้อม ธปท. จะกำหนดแนวทางและเวลาภายหลัง (https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2569/ThaiPDF/25690081.pdf — coordinator เปิดอ่านต้นฉบับ 2026-10-24) |
| รายงาน/BI (`reports`) | แคตตาล็อกรายงาน มุมมองที่บันทึก ส่งออก CSV — มีรายงานรายจ่าย 2 ตัว (`expense.summary`, `expense.accountant_evidence` — `reports/domain/report-catalog.ts:216-250`) | 🟡 สเปก "Complete 2026-07-04"; รายงานการเงินอิง ledger จึงรับช่องโหว่ข้างบน; ไฟล์ส่งออกหมดอายุ 7 วัน | ledger สำหรับรายงานการเงิน | กลาง | **ภายหลัง** — ความต้องการเดียวกันแก้ด้วยไฟล์ส่งนักบัญชี (backlog ข้อ 25) ก่อน; ถ้าจะเปิด ให้เปิดเฉพาะรายงานรายจ่ายหลังตรวจบน UAT ว่าร้าน starter ไม่เห็นรายงาน ledger ว่างเปล่า (ยังไม่ได้ตรวจ) |
| เวิร์กโฟลว์อัตโนมัติ (`workflow_automation`) | template กฎ งาน run dead-letter webhook ขาออก | 🟡 checklist ข้อ 16 ยังไม่ติ๊ก; verify บน Postgres local เท่านั้น | — | กลาง (webhook ขาออก, กฎยิงผิด) | **ไม่ขายเป็นเมนู** — template ใบเบิก/เตือนเกินกำหนด auto-enable และ scan ทำงานโดยไม่ดู entitlement อยู่แล้ว (`workflow/application/use-cases/workflow-scan.use-case.ts:38-40`) ร้านได้ประโยชน์โดยไม่ต้องเห็นตัวสร้าง |
| CRM (`crm` + กล่องข้อความ จองออนไลน์ ลีด ฯลฯ) | ลูกค้า กล่องข้อความ การจอง รายงาน CRM (ดึงข้อมูลจริงตามสาขาจาก backend — `apps/web/src/features/crm/CrmReportsPrototypePage.tsx:110`; ชื่อไฟล์ยังมีคำว่า Prototype แต่เมนู `crmreport` ยัง `planned` — `menu-entitlements.ts:67`); LINE `crm.*` 11 tools | 🟡 ข้อ 15/15A ยังไม่ติ๊ก (`docs/plans/master-implementation-checklist.md:341,352`); เหลือ e2e webhook/LIFF/OCR (`:364`); เคย deploy ยุค ECS 2026-07-12 | สินค้า/LINE OA สืบทอดจาก CRM (`feature-entitlements.ts:662-663`) | สูง — ข้อมูลลูกค้าปลายทาง (PDPA), AI ตอบลูกค้าเอง | **ไม่ขายในแพ็กรายจ่าย** — ถ้าทำเป็นผลิตภัณฑ์แยกค่อยตัดสินใหม่ทั้งชุด |
| สต๊อก (`inventory`) | สินค้า ที่เก็บ เคลื่อนไหว นับสต๊อก รายงาน QR | 🟡 memory "COMPLETE/VERIFIED" (local); นับแค่จำนวน ไม่มีต้นทุน/COGS (RA-31) | สินค้าสืบทอด (`:662`) | กลาง — มูลค่าสต๊อกไม่เข้าบัญชี | **ไม่ขายในแพ็กรายจ่าย** |
| เอกสารขาย (`sales_documents`) + ฝั่งรายรับของสมุดรายรับ–รายจ่าย | ใบเสนอราคา ใบแจ้งหนี้ ใบเสร็จ ใบกำกับ รับชำระ บันทึกรายรับ หมวดรายรับ; LINE `sales.*`/`accounting.*` | 🟡 เมนูทั้ง 3 ยัง `planned` (`menu-entitlements.ts:87,97,241`); สมุดรายรับ–รายจ่ายยังมี LED-FIN-07 เปิด + UAT/Prod เป็นประตูภายนอก (`docs/specs/mangmee-income-expense-ledger-spec-th.md:3`); ไม่มีการพิมพ์ตามแบบกฎหมาย (RA-13); e2e local ผ่าน 2026-08-27 | `thai_tax` สำหรับภาษีขาย | สูง — ใบกำกับภาษีมีผลทางกฎหมาย | **ภายหลัง — ตัวแรกที่ควรเตรียม** เป็นส่วนเสริม 1,999: ทำ UX pass, UAT กับร้านจริง, นักบัญชีตรวจรูปแบบใบกำกับ, เปิดเมนูจาก `planned` เป็น `ready` |
| รายการสินค้า (`product_catalog`) | ราคา ระยะเวลาบริการ เผยแพร่ให้ AI ลูกค้า/การจอง | 🟡 "focused-verified locally"; เหลือ deploy migration/browser smoke (`docs/agent-memory/crm-product-service-catalog.md:3,26`) | สืบทอดจาก inventory/crm | ต่ำ–กลาง | **ไม่ขายเดี่ยว** (ใช้ได้เมื่อมี CRM/เอกสารขายเท่านั้น) |
| LINE OA ของร้าน (`line_oa`) | ผูก OA ของร้านเข้ากล่องข้อความ CRM | 🟡 master plan "IMPLEMENTATION_IN_PROGRESS" (`docs/agent-memory/mangmee-line-oa-production-master-plan.md:3`) | `crm` | สูง — ตั้งค่า channel ต่อร้าน, PDPA, AI ตอบลูกค้า | **ไม่ขายในแพ็กรายจ่าย** |

(รายละเอียดหลักฐานต่อแถวรวบรวมจากการอ่าน `docs/specs/*`, `docs/agent-memory/*`, `docs/plans/master-implementation-checklist.md` และโค้ดที่อ้างไว้; บรรทัดโค้ดสำคัญ — `report.use-case.ts:45,187`, `posting-engine.logic.ts:263`, `banking.logic.ts:349-367`, `accounting-document-source.adapter.ts:52`, `SalesDealFormPage.tsx:110-115`, `billing-feature-entitlements.ts:64-75` — อ่านซ้ำยืนยันแล้ว)

## 3. ทางที่ร้านได้ฟีเจอร์ที่ไม่ได้ขาย (สิ่งที่ลูกค้าเห็นวันนี้)

1. **ผู้ดูแลเปิดฟีเจอร์ที่ไม่ได้ขายให้ร้าน** ได้สามทาง: ปุ่ม preset มาตรฐาน/ครบวงจร (`system-partners.logic.ts:41-47`), สวิตช์รายเมนูบนการ์ดแต่ละใบ (`PartnerDetailPage.tsx:1341-1346` `updateCard(card, !card.enabled)`), และ API ที่รับทุก key ใน catalog (`set-partner-features.use-case.ts:75` ใช้ `APPROVED_FEATURE_ENTITLEMENT_KEYS` = `ALL_FEATURE_ENTITLEMENT_KEYS` — `feature-registry.ts:7`) → ระบบบันทึกเป็น "สิทธิ์ที่ผู้ดูแลกำหนด" (transition ไม่ใช่ `BILLING_PACKAGE` — `billing/application/billing-feature-entitlements.ts:21-22,64-65`) → ตอนร้านจ่ายเงินต่ออายุ ค่านั้น **ถูกคงไว้** (`:74`, ข้ามตอน apply `:130-131`) — ร้านจะได้เมนูที่ไม่เคยผ่าน UX/UAT ไปตลอด และหน้าซื้อบอกแค่ "สิทธิ์พิเศษที่ผู้ดูแลกำหนดให้เฉพาะร้านนี้ยังคงอยู่" (`BillingPage.tsx:1098`) ไม่บอกว่าคืออะไร
   - ผลกลับด้าน: เมนูที่ผู้ดูแล **ปิด** ไว้ จะยังปิดแม้ร้านซื้อแพ็กที่มีเมนูนั้น (อนุมานจากตรรกะเดียวกัน — ยังไม่ได้ทดสอบ)
   - จำนวนร้านจริงที่มีสิทธิ์นอกแพ็ก: **ยังไม่ได้ตรวจ** (ต้อง query Production — ไม่ได้แตะ cloud)
2. **onboarding โดยผู้ดูแลแบบไม่ใช่ starter** เปิดชุด 2026-08-04 (`feature-registry.ts:21-39`) โดยไม่มี transition → ถูกรีเซ็ตเป็น starter ตอนจ่ายเงินครั้งแรก (อนุมาน — ร้านจะ "เสีย" เมนูทันทีหลังจ่าย)
3. **ฟอร์มดีลของเซลล์** แสดงปุ่มชุดมาตรฐาน/ครบวงจรที่กดไม่ได้ — ไม่ผิดกฎ แต่ขัด "พูดให้น้อย"

## 4. คำถามให้เจ้าของตัดสิน (มีคำแนะนำ)

| # | คำถาม | คำแนะนำ | ตัดสิน |
|---|---|---|---|
| D1 | รอบนี้เปิดขายฟีเจอร์ใดเพิ่มไหม | **ไม่เปิด** — โฟกัสแพ็กที่ขาย (ตรงคำสั่ง 2026-10-03) | ☐ |
| D2 | ตัวแรกที่จะเตรียมเปิดในอนาคต | **เอกสารขาย + ฝั่งรายรับ** เป็นส่วนเสริม 1,999 ตามด้วย **VAT/ภ.พ.30** — ทั้งคู่ต้องผ่าน UX pass + UAT ร้านจริง + นักบัญชี/ผู้เชี่ยวชาญภาษีก่อน | ☐ |
| D3 | สต๊อก, CRM, LINE OA ร้าน, รายการสินค้า, จัดซื้อ/เจ้าหนี้, ตัวสร้างเวิร์กโฟลว์, สมุดบัญชีคู่, ลงบัญชีอัตโนมัติ | **ไม่ขายในแพ็กรายจ่าย** (เก็บโค้ดไว้ ไม่ลบ) | ☐ |
| D4 | ผู้ดูแลระบบเปิดฟีเจอร์นอกแพ็กให้ร้านจริงได้ไหม | **ไม่ได้ — สิทธิ์ของร้านลูกค้าต้องมาจากแพ็กที่ซื้อ (`TIER_FEATURE_PRESETS[tier]` `menu-entitlements.ts:496-501`) หรือ snapshot ของดีลที่อนุมัติแล้วเท่านั้น**, บังคับที่ backend: `SetPartnerFeaturesUseCase` (`set-partner-features.use-case.ts:75` วันนี้รับทุก key) ปฏิเสธการ *เปิด* key ที่ไม่อยู่ในชุดของแพ็ก/ดีลปัจจุบันของบริษัท `CUSTOMER` — ไม่ใช้รายการรวม `SALES_DEAL_ALLOWED_FEATURE_KEYS` (`:504-508`) เพราะยังเปิดสิทธิ์ภาษีของแพ็ก 1,999 (`:500`) ให้ร้าน 249 ได้; การ *ปิด* สิทธิ์ที่ร้านซื้อแล้วต้องมีเหตุผลและ audit ไม่ใช่ปิดเงียบ; บริษัท `TEST`/`INTERNAL` (`Company.reportClassification` `schema.prisma:356`) ยกเว้นได้ แต่ **การเปลี่ยนประเภทเป็น `CUSTOMER`** (`update-partner-profile.use-case.ts:58`) ต้องปรับสิทธิ์ให้ตรงแพ็กใน transaction เดียวกัน หรือปฏิเสธจนกว่าจะเอาสิทธิ์นอกแพ็กออก — มิฉะนั้นสิทธิ์ที่ได้ตอนเป็น TEST อยู่ต่อผ่านการต่ออายุ (`billing-feature-entitlements.ts:74` คงค่าที่ผู้ดูแลตั้ง); การเปลี่ยนประเภทกับการแก้ entitlement ต้องใช้ล็อกเดียวกัน (advisory entitlement `set-partner-features.use-case.ts:253`) กันทำพร้อมกัน; UI ปิดปุ่ม preset และสวิตช์รายเมนูตามกติกาเดียวกัน; ตรวจรายชื่อร้านจริงที่มีสิทธิ์นอกแพ็กแล้วแจ้งร้านก่อนปรับ | ☐ |
| D5 | ค่าตั้งต้น onboarding 2026-08-04 (`thai_tax`, ledger, workflow, CRM…) | **เปลี่ยนให้ตรง 2026-09-23** (onboarding ทุกทางใช้ starter) — ปิดข้อขัดกันของสองคำตัดสิน | ☐ |
| D6 | ปุ่มชุดมาตรฐาน/ครบวงจรที่กดไม่ได้ในฟอร์มดีล | **ซ่อน** (แสดงเฉพาะชุดที่ขายได้) | ☐ |

ทุกข้อที่ตัดสินแล้วต้องบันทึกกลับใน `docs/agent-memory/package-sale-feature-scope-2026-09-23.md` และถ้าเป็น D4/D5/D6 ให้เขียนสเปกเล็กก่อนแก้โค้ด

## 5. สิ่งที่ยังไม่ได้ตรวจ (ระบุตรง ๆ)

- จำนวนร้านใน Production ที่มี entitlement นอกแพ็ก (ต้อง query DB)
- ร้าน starter ที่ถูกเปิด `reports` จะเห็นรายงาน ledger แบบว่างหรือถูกกรองออก (ต้องลองบน UAT)
- ผลกลับด้านของ admin override ตอนซื้อแพ็ก (อนุมานจากโค้ด ไม่ได้รัน)
- การ deploy CRM ยุค ECS 2026-07-12 ยังมีร้านใช้อยู่หรือไม่ หลังสร้างสภาพแวดล้อมใหม่ 2026-10-09
