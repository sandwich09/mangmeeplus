# Agent Memory: accountant exports (backlog ข้อ 25 + ข้อ 13)

Status: cleanup spec/plan DRAFT — blocked on: RC-F2 (selection intersect) review before Phase 1.4; Phase S and 1.1–1.3 can start; accounting-software export spec/plan READY (docs-first) — reviewed 3 rounds + focused blocker checks 2026-10-24, no HIGH open; Phase S can ship first (docs only, ไม่มีโค้ด, ยังไม่ commit)
Owner: Expenses lane (controller review); เขียนโดย docs lane ใน worktree `mangmee-worktrees/expense-specs-20261023` (branch `claude/expense-specs-20261023`, tree เดียวกับ main 6c54ba208)
Scope:
- ข้อ 25 ไฟล์ที่ส่งให้นักบัญชี (Excel หน้ารายการ/หน้าหลักฐาน, สารบัญใน ZIP, สมุดรายรับ–รายจ่าย, ไฟล์ ภ.ง.ด. ให้ผู้ทำบัญชี) + การตรวจเลขที่เอกสารฝั่ง LINE (B17) — `docs/specs/accountant-export-cleanup-spec.md`, `docs/plans/accountant-export-cleanup-plan.md`
- ข้อ 13 ไฟล์ที่โปรแกรมบัญชีนำเข้าได้ (สมุดรายวันซื้อ + FlowAccount) — `docs/specs/accounting-software-export-spec.md`, `docs/plans/accounting-software-export-plan.md`
- Amendment 2026-10-23 (+ รายการคำที่ล้าสมัย 2026-10-24) ท้าย `docs/specs/expense-receipt-upload-spec.md`

Decisions:
1. ชุดเต็มเดิม 56 คอลัมน์ (backlog เขียน 57)
2. ไฟล์ให้นักบัญชี = workbook 5 แผ่น: `รายการค่าใช้จ่าย` (25 คอลัมน์ที่แสดงเสมอ + `ไฟล์เอกสาร` ใน ZIP + ไม่เกิน 3 ตามโครงสร้าง), `การจ่าย` (จากแถว `ExpensePayment`), `หัก ณ ที่จ่าย` (จาก projection ต่อการจ่ายของ ภ.ง.ด. + คอลัมน์ `สถานะ`), `ไฟล์ทั้งหมด` (ZIP), `เกี่ยวกับไฟล์นี้`
3. ไม่มีลิงก์เข้าแอป; ลิงก์ได้แค่ path สัมพัทธ์ในชุด ZIP เดียวกัน; ข้อความเซลล์เป็น path เสมอ
4. ซ่อนคอลัมน์ตามโครงสร้าง (แพ็ก/สาขา/สิทธิ์คนกด) ไม่ตามข้อมูลรายเดือน; แผ่นว่างไม่ใส่; VAT คงแม้ร้านไม่จด VAT
5. CSV คีย์เครื่อง/`indexRows`/manifest คงไบต์ด้วย projection แยก (`legacyFileName` สำหรับ CSV, `fileName` ใหม่สำหรับ ZIP/workbook) — CSV จึงเก็บชื่อไฟล์รุ่นแรกที่ไม่ตรง ZIP ใหม่ (G8)
6. ตัดชื่อพนักงาน เหลือผู้ขาย/ผู้รับเงิน และ `สำรองจ่ายโดย` (PDPA ม.22/27 ฉบับประกาศใช้)
7. หัก ณ ที่จ่าย: แถวต่อการจ่าย × บรรทัด จาก `ExpenseSourceAdapter.findConfirmedWithWhtByCompany` (+ filter `expenseIds` = `page.rows` **หลังขยาย**ด้วยรายการเดือนก่อนที่จ่ายในช่วง, export จาก TaxModule); แถวที่ยื่นแล้ว: ใช้กติกาครอบเดิม `filedLineCoversPayment` (`withholding-filing-state.ts:60-65` — บรรทัดเก่าไม่มีคีย์ครอบทุกการจ่ายของเอกสาร, คีย์รวม `payment:<id>` ครอบ `:line:` ที่แยกภายหลัง) → **ตัดสินการครอบบนชุดเต็มก่อนกรองวันที่** (ชุดแหล่ง = `page.rows` หลังขยาย ∪ รายการในขอบเขตที่มีบรรทัดยื่นในเดือนของช่วง; projection ไม่กรองวันที่) แล้วกรองแต่ละแถวด้วยวันที่ของมันเอง — แถวที่ยื่นใช้ `payment[2]`, แถวสดใช้วันที่จ่าย; แถวสดที่ถูกครอบไม่แสดงเลย (นับใน `เกี่ยวกับไฟล์นี้`) (R3-F3 ปิดแล้ว); รายการจากบรรทัดที่ยื่นเข้า `extraIds` เดียวกับการจ่าย จึงถูกตัดทิ้งในคำขอแบ่งหน้าตามกติกาเดิม :372 (RC-F1 ปิดแล้ว) และถูกตัดให้เหลือเฉพาะ `request.expenseIds` เมื่อระบุ (`[]` = ไม่เพิ่มเลย) (RC-F2 รอรีวิว); ทุกแถวมี `สถานะ` (`ยื่นแล้ว` / `งวดปิดแล้ว ตรวจกับแบบที่ยื่น` / `ยังไม่ยื่น · ต้องตรวจ: <เหตุผล>` / `ยังไม่ยื่น · ข้อมูลครบตามแบบ`) — ความครบตรวจด้วย `withholdingRowFaults` ที่ยกจาก `withholding-filing-validation.ts:86-110`; ไม่ใช้คำ `พร้อมยื่น`; ไม่สัญญาว่าตรงกับ tax event ทุกแถว; แบบ ภ.ง.ด. จาก `withholdingFormFor` ที่ยกจาก sync — บุคคล → ภ.ง.ด.2 เมื่อหมวด `SEPARATE_PND2` มิฉะนั้น ภ.ง.ด.3; นิติบุคคล → ภ.ง.ด.53; ไม่รู้ → `ยังไม่ระบุ`
8. ข้อ 13: สมุดรายวันซื้อก่อน (คงยอดที่บันทึก แยกแถวตามบัญชี × การใช้ VAT × สิทธิภาษีซื้อที่มีผลต่อบรรทัด (= ประตูเอกสารปัจจุบัน `inputVatClaimStatus === 'CLAIMABLE' && taxEvidenceStatus === 'USABLE_FOR_TAX'` **และ** ข้อจำกัดบรรทัด `claimabilitySnapshot` + `taxEvidenceReviewStatus` เมื่อมี `taxComponentsJson`; ผลเข้มที่สุดชนะ; การปฏิเสธของผู้ตรวจระดับเอกสารไม่ถูก snapshot ของบรรทัดฟื้น — R3-F2 ปิดแล้ว) × ชุดหัก ณ ที่จ่าย — แต่ละแถวมีหมวด/อัตราหักเดียว); FlowAccount หลังประตู Phase 0 และไม่ใส่เอกสารที่แทนไม่ได้พร้อมเหตุผลบนหน้าจอ (รวมหลายประเภทเงินได้ในเลขอ้างอิงเดียว และเอกสารมีหักที่ส่งวิธีการชำระไม่ได้); ตัวจำแนก `flowAccountEligibility` อยู่ใน Phase 1 เพื่อวัดก่อนลงทุน Phase 2; PEAK และ Express (มีโปรแกรมเสริมนำเข้าบิลซื้อ/ขาย ตามโพสต์ ESG 3 ม.ค. 2567 — แม่แบบยังไม่ยืนยัน) รอแม่แบบจริง; ไม่ทำ CSV
9. รหัสบัญชีของสำนักงานบัญชี: ตารางใหม่ `ExpenseCategoryAccountantAccount` ต่อร้านต่อหมวด; ตั้งได้กับหมวดที่ร้านเห็น ∪ หมวดที่รายการของร้านอ้าง
10. ไม่มี feature switch, ไม่มีคีย์ entitlement ใหม่ (คำแนะนำ ข้อ 13 Q1)

Open questions (เจ้าของ; มีคำแนะนำในสเปก):
- ข้อ 25 Q1 ตัดตัวเลือก "แบบย่อ/แบบเต็ม" → แนะนำ ตัด (ไม่ block)
- ข้อ 13 Q1 ทุกแพ็กได้ไฟล์นำเข้า → แนะนำ ทุกแพ็ก
- ข้อ 13 Q2 ดาวน์โหลดแม่แบบ FlowAccount (ดูอย่างเดียว) + ทดลองนำเข้าในบริษัททดลอง + นักบัญชียืนยัน VAT ต้องห้าม → แนะนำ ได้ (block เฉพาะ Phase 2)
- ข้อ 13 Q3 PEAK/Express รอแม่แบบจากผู้ใช้จริง → แนะนำ รอ
- ข้อ 13 Q4 สถานะ "ส่งออกแล้ว" → แนะนำ ยังไม่ทำ

Artifacts:
- docs/specs/accountant-export-cleanup-spec.md
- docs/plans/accountant-export-cleanup-plan.md
- docs/specs/accounting-software-export-spec.md
- docs/plans/accounting-software-export-plan.md
- docs/specs/expense-receipt-upload-spec.md (Amendment 2026-10-23 ท้ายไฟล์ + "Known stale statements (review 2026-10-24)")
- รีวิวอิสระ: `codex-review/review-exports.md` (F1–F33), `review-exports2.md` (รอบ 2), `review-exports3.md` (รอบ 3) — ไฟล์ชั่วคราวในโฟลเดอร์เดียวกัน
- แหล่งต้นฉบับที่เปิดจริง: https://rd.go.th/3374.html , https://rd.go.th/27985.html , https://www.rd.go.th/fileadmin/images/image_law/images/vat-202-02.pdf (หน้า 1), buy.pdf เดิม, https://www.rd.go.th/fileadmin/tax_pdf/withhold/290360_attach53.pdf (หน้า 1), https://flowaccount.com/help-center/category/expense/import-expense , https://www.peakaccount.com/peak-manual/peak-others/import-documents/import-expense-record , https://intercom.help/peak/en/articles/7324017-import-expense-ne004 , https://support.microsoft.com/en-us/office/hyperlink-function-333c7ce6-c5ae-4164-9c47-7de9b76f577f , https://rd.go.th/3409.html , PDPA ม.22/27 https://www.mdes.go.th/law/detail/3541-พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล-พ-ศ--๒๕๖๒ (หน้า 9, 12); ผู้ประสานงานตรวจ 2026-10-24: FlowAccount AI Connector (ทุกแพ็กเกจ), ESG forum https://esg.co.th/phpBB3/viewtopic.php?f=1&t=18976 , SAP DTW txt/csv, AWS presigned URL
- ยังยืนยันไม่ได้: หน้า 2 แบบรายงานภาษีซื้อ (*), ใบแนบ ภ.ง.ด.3, หัวคอลัมน์แม่แบบ FlowAccount/PEAK/Express, เพดาน/แพ็ก PEAK, FlowAccount OpenAPI แพ็ก Pro Business (รอบค้นคว้า), ลิงก์ path สัมพัทธ์บน Excel Windows/Mac/LibreOffice, วิธีปัด VAT ของ FlowAccount

Verification:
- เอกสารอย่างเดียว ไม่ได้รัน build/test (worktree ไม่มี node_modules); การอ้างโค้ดมาจากการอ่านไฟล์ที่ baseline นี้; ผู้ประสานงานเปิดทุก citation ของรีวิวแล้วว่าจริง
- บั๊กที่บันทึก (อ่านโค้ด ยังไม่ได้รัน): B1–B28 ใน accountant-export-cleanup-spec §13 — **B26 ช่องโหว่ปัจจุบัน**: ขออ่านเอกสาร (`POST /expenses/:id/extraction-request`) ข้ามสาขาได้ (`expense-extraction.use-case.ts:92`, `:216`) → แผน Phase S ส่งเดี่ยวก่อนทุกเฟส; B27 รหัสสาขาที่ AI แต่งผ่านเพราะเป็นส่วนของเลขผู้เสียภาษี; B28 เลขผู้เสียภาษีผู้ขายท้ายใบหายหลังบรรทัด `ผู้ป่วย`; — ที่สำคัญ B1 ลิงก์ไปหน้าแอป, B2 `pending` ทุกแถว, B17 เลขที่เอกสารปลอมผ่าน (`FAKE`, `FAKE-180`), B18 เดือนที่มีแต่การจ่ายถูกปฏิเสธ, B19 วันที่จ่ายเก่า, B20 ไม่มีสกุลเงิน, B21 หัก ณ ที่จ่ายจ่ายสองงวดเหลือแถวเดียว, B22 handoff บุคคลเก็บ PND3 เสมอ, B23 PDF ทาง LINE สัญญาว่ากำลังอ่านทั้งที่ไม่มีงาน, B24/B25 ไฟล์ E5/E6 ไม่บอกสกุล

## Review 2026-10-24 (Codex, ultra — "unsafe to build") → สิ่งที่แก้

| F | เรื่อง | แก้ที่ |
|---|---|---|
| F1 | ภ.ง.ด.2 สำหรับหมวด `SEPARATE_PND2` | cleanup spec §5.3, §7.3; software spec R4, §7.4 (`wht_form_not_supported`); cleanup plan 1.2 `withholdingFormFor`; Decision 7 |
| F2 | หัก ณ ที่จ่ายต่อการจ่าย | cleanup spec §1.2 ข้อ 7, §5.3, แผ่น `หัก ณ ที่จ่าย` §7.2; B21; plan 1.2/1.4; AC-5 |
| F3 | สกุลเงิน | cleanup spec R6, คอลัมน์ `สกุลเงิน` ทุกแผ่น, B20, G7; software spec R7 + `foreign_currency` |
| F4 | ฐานหักต่างจากมูลค่า | cleanup spec §5.3 (ฐานจาก projection); software spec R4 + คอลัมน์ `ฐานหัก ณ ที่จ่าย`; FlowAccount exclude `wht_not_representable` |
| F5 | VAT หลายแบบในบัญชีเดียว | software spec R2 แยกตามการใช้ VAT, คอลัมน์ `การใช้ VAT`, AC-3; plan 1.3 |
| F6 | คงยอด VAT ที่กรอกตามใบ (21.01) | software spec R3, `vat_not_representable`, AC-4; Phase 0 ข้อ 3(ค) |
| F7 | หักแบบยอดเงิน/หลายอัตรา | cleanup spec §5.3 (`ยังไม่ระบุ`); software spec R4 + `wht_not_representable` + fallback = สมุดรายวันซื้อ/ไฟล์นักบัญชี |
| F8 | Express มีโปรแกรมเสริมนำเข้า | software spec §1.2–1.3, Q3; plan "PEAK / Express รอแม่แบบ"; Decision 8 |
| F9 | presigned URL ใช้ได้จนหมดอายุ | Amendment "Signed links"; cleanup spec E3/E4, Non-goals, §8 |
| F10 | คงข้อเท็จจริงหักรายบรรทัดเก่า | cleanup spec §5.3 (`split`); software spec R4 |
| F11 | CSV คงไบต์ด้วย projection แยก | cleanup spec §7.1, §7.4, AC-7, G8, §16; plan 1.4 + locked 1; Amendment; Decision 5 |
| F12 | `page`/`pageSize` ใน DTO | cleanup spec §7.5; plan 1.5 + test |
| F13 | ย้ายเทสต์ที่เรียก builder/selector | cleanup spec §11, §14; plan 1.3 (รวม `thai-date.logic.spec.ts` ที่ไม่ได้ลงทะเบียน) และ 2.3 (EXP-20/21/22/23) |
| F14 | เดือนที่มีแต่การจ่าย | cleanup spec §1.2 ข้อ 13, §10.1–10.2, B18, AC-10; plan 2.1/2.2 |
| F15 | วันที่จ่ายจากแถวการจ่าย | cleanup spec `last_paid_at` + แผ่น `การจ่าย`, B19, AC-11; software spec คอลัมน์ 24 |
| F16 | ฉบับใช้อยู่/ฉบับเดิมของใบรับรอง | cleanup spec แผ่น `ไฟล์ทั้งหมด` (`ฉบับ`/`แทนด้วย`), §7.4 |
| F17 | FlowAccount วันที่ชำระต้องมีวิธี | software spec §7.4 (ว่างทั้งคู่ + `paymentNotExported`), T12, AC-8 |
| F18 | คำอธิบายประเภทเงินได้ข้อ 6 ฯลฯ | software spec §1.2, §7.4 (`requiresDescription`), Phase 0 ข้อ 3(จ), plan 2.1 |
| F19 | รายงานรายการที่ไม่ได้ใส่ใน API/UI | software spec §7.1 `excluded`, R10, T11, AC-10 |
| F20 | หมวดที่เห็นหลัง bootstrap | software spec §1.1, §6 (scope ∪ ถูกอ้าง), §7.2, §10.2; plan 1.2 |
| F21 | status ว่าง = CONFIRMED | software spec R1, §7.2, AC-7; plan 1.4 |
| F22 | AI Connector ทุกแพ็กเกจ แยกจาก OpenAPI | software spec §1.2 แยกแถว, Q1 |
| F23 | เลขที่เอกสารปลอมผ่าน (gateway) | cleanup spec B17 + plan Phase 3.3 + AC-13; Amendment แถว §19j |
| F24 | สวิตช์บันทึกด้วยมือรายร้าน | Amendment "Known stale statements" (legacy ต้องเลิก) |
| F25 | ขอบเขต LINE ปัจจุบัน (การ์ดยืนยัน) | Amendment แถว §13 |
| F26 | ใบกำกับอย่างย่อเป็นหลักฐานใช้ได้ | Amendment แถว §19h |
| F27 | ปีสองหลักบนใบเสร็จ | Amendment แถว §19k |
| F28 | อ่าน PDF ด้วยงานคิว | Amendment แถว §19a |
| F29 | รายการซ้ำที่สงสัยไม่ block | Amendment แถว §17 |
| F30 | `WhtIncomeCategory` catalog กลาง | cleanup spec §6, §8; software spec §8; plan 1.4 |
| F31 | ความหมายช่องว่าง | cleanup spec R5, §7.3 (`ยังไม่ระบุ` สำหรับข้อมูลที่ต้องใช้แต่ไม่มี) |
| F32 | ข้ออ้าง xlsx เฉพาะเป้าหมายที่ยืนยัน | software spec §1.2 (SAP DTW txt/csv), §1.3 ข้อ 4 |
| F33 | อักขระควบคุมทั้งค่า | software spec §7.2; plan 1.2 regex + test |

### Round 2 (2026-10-24) — Codex ultra: 26/33 RESOLVED, 7 PARTLY, 18 ใหม่ (4 HIGH); ยัง "unsafe to build"

| รหัส | ระดับ | เรื่อง | แก้ที่ |
|---|---|---|---|
| F1 / P2 | HIGH | ค้น projection หัก ด้วย `page.rows` หลังขยาย (:376) ไม่ใช่ `expenseIds` (:339) — บิล ก.ย. ที่จ่าย ต.ค. ต้องอยู่ไฟล์ ต.ค. | cleanup spec §7.2 แผ่น 3, AC-5; plan 1.4 + test |
| F2 / P7 | HIGH | สมุดรายวันซื้อเสียชุดหักต่อบรรทัด (RENT 5% + SERVICE 2%) | software spec R2/R4, AC-13, §14; plan 1.3 + test |
| F3 | HIGH | FlowAccount: เลขอ้างอิงเดียวต้องประเภทเงินได้เดียว | software spec §1.2, §7.4 `wht_mixed_income_types`; plan 2.1; Phase 0 (ฌ) |
| F4 | HIGH | projection ตรึงแค่ยอด; งวดปิด/แถวยื่นแล้วถูก sync ข้าม — "ตรงทุกแถว" ไม่จริง | cleanup spec เป้าหมาย 5, §5.3 (ภาพที่ยื่น + คอลัมน์ `สถานะ`), แผ่น 3 คอลัมน์ 14, AC-5; plan 1.4; Amendment "Replaced here" |
| F5 | MED | ไม่รู้ประเภท / ไม่มีเลขผู้เสียภาษี / ต่างสกุล → sync ไม่สร้าง event | cleanup spec §5.3 สถานะ `ต้องตรวจ: …` |
| P14 | — | ปุ่มหน้าหลักฐานปิดเมื่อตารางว่าง (:904) | cleanup spec §10.2, AC-10, §14; plan 2.2 |
| P16 / F10 | MED | ใบรับรองถูกยกเลิกไม่มีใบใหม่ → ห้ามเขียน "มีฉบับใหม่แทนแล้ว" | cleanup spec แผ่น 4, AC-15; plan 1.4 |
| P17 / F6 | MED | FlowAccount: เอกสารมีหักต้องมีวิธีการชำระ | software spec §7.4 (`wht_payment_method_not_supported` ฯลฯ); plan 2.1 |
| P23 / F9 | MED | การแก้ B17 ต้องคงการประกอบเล่มที่/เลขที่ `12/345` | cleanup spec B17, AC-13; plan 3.3 + test; Amendment แถว §19j |
| P28 | — | การอ่าน PDF: polling/retry/สเปกที่กำกับ | Amendment แถว §19a (read-status route, runner attempts, appendix spec) |
| F7 | MED | handoff บุคคลธรรมดาเก็บ PND3 เสมอ (B22) | cleanup spec B22; plan 3.4; Amendment แถว §6 handoff |
| F8 | MED | PDF ทาง LINE สร้างงานอ่านไม่สำเร็จแต่ตอบ "กำลังอ่าน" (B23) | cleanup spec B23; plan 3.5 (W00 regen + whole-chain); Amendment แถว §19a |
| F11 | MED | สมุดรายรับ–รายจ่ายไม่มีสกุลเงิน (B24) | cleanup spec §1.3, B24, AC-11; plan 3.1 |
| F12 | MED | ไฟล์ ภ.ง.ด. ให้ผู้ทำบัญชีบวกข้ามสกุล (B25) | cleanup spec §1.3, B25, AC-12; plan 3.2 |
| F13 | MED | การจับเลขผู้เสียภาษีอ่านเฉพาะฝั่งผู้ออก | Amendment แถว §19j decisions 2–3 |
| F14 | MED | LINE เก็บร่างก่อนจัดประเภท | Amendment แถว §5 step 4 / §5.1 / §19b |
| F15 | MED | เหตุผลการจ่ายต้องจริง (ไม่ใช่ "แบ่งหลายงวด" ทุกกรณี); เอกสารไม่มีหักที่ยังไม่จ่ายไม่เตือน | software spec §7.4 เหตุผลแยก 5 แบบ + `paymentNotExported` เฉพาะที่จ่ายแล้ว |
| F16 | MED | Phase 1 วัด FlowAccount ไม่ได้ | software spec §16 `flowAccountEligibility`; plan 1.3/1.4/2.3 |
| F17 | LOW | CLDR 45 → 49 | Amendment แถว §19k research baseline (spot-check Buddhist formats; month tables ยังไม่อ่านซ้ำ) |
| F18 | LOW | จำนวนคอลัมน์ 24 vs 25 | cleanup spec §7.2/AC-1/Q1 = 25; plan 1.1; Decision 2 |

กติการอบ: เหลือรีวิวได้อีกครั้งเดียว (round 3); ข้อ HIGH ที่เหลือหลังรอบนั้นต้องเป็น blocker ชื่อชัดใน "Must close before coding" และสถานะเป็น "blocked on: …"

### Round 3 (2026-10-24) — Codex ultra, รอบสุดท้าย; แก้แล้วแต่ข้อ HIGH ยังไม่ได้รีวิว

| รหัส | ระดับ | เรื่อง | แก้ที่ |
|---|---|---|---|
| F1 | HIGH (ช่องโหว่ปัจจุบัน) | ขออ่านเอกสารข้ามสาขา ได้ `fields` ของสาขาอื่น (B26) | cleanup spec §0, §13 B26, AC-16, §14; plan Phase S (ส่งเดี่ยว, scoped load แบบ `GetExpenseUseCase` `expense-draft.use-case.ts:222-240`, NotFound + audit, เทสต์ใน spec ที่ลงทะเบียนแล้ว); Amendment แถว §16/§19a decision 2 |
| F2 | HIGH | สมุดรายวันซื้อรวมบรรทัด V7 กับ ND ในบัญชีเดียว ติดป้ายเคลมได้ทั้งหมด | software spec §0, R2/R5, คอลัมน์ 16 + FlowAccount ภาษีต่อแถว, AC-14; plan 1.3–1.4 (โหลด snapshot ต่อบรรทัด, key + `flowAccountEligibility`) |
| F3 / P37 | HIGH | บรรทัดที่ยื่นก่อนมีคีย์การจ่าย / คีย์รวมที่แยกภายหลัง → หา snapshot ไม่เจอ ใช้ข้อมูลสด และนับซ้ำ | cleanup spec §0, §5.3 ข้อ 1–3; plan 1.4 (`filedLineCoversPayment`) + test |
| F4 / P41 | MED | ส่งไฟล์ซ้ำไม่ใช่ทางกู้ (dedupe ตาม message id `:11057` → ร่างใหม่ `expense-upload.use-case.ts:136`) | cleanup spec B23; plan 3.5 ปุ่ม `เริ่มอ่านอีกครั้ง` ผูกร่างเดิม + test สอง message id; Amendment แถว §19a |
| F5 / P40 | MED | contract/หน้า handoff รู้แค่ PND3/PND53 แสดง `ยังไม่รู้แบบภาษี` (`tax.ts:55`, `:476`, `WhtCertificatesPage.tsx:43`) | cleanup spec B22; plan 3.4 `WhtHandoffFormType` (ไม่ขยาย type ของการออกใบ); Amendment แถว §6 |
| F6 | MED | ไม่ใช่ทุกแถวที่ sync รับคือ "พร้อมยื่น" | cleanup spec §5.3 สถานะ + `withholdingRowFaults`; plan 1.2/1.4 |
| F7 | MED | ใบแทนต่อกันหลายทอด A→B→C | cleanup spec แผ่น 4 กติกาสาย `correctionOfEvidenceId`, AC-15; plan 1.4 |
| F8 | MED | หน้าสมุดรายรับ–รายจ่ายบวกข้ามสกุล (B24) | cleanup spec B24; plan 3.1 `otherCurrencies` + บรรทัดบนหน้า |
| F9 | MED | รหัสสาขาแต่งผ่าน (B27) | cleanup spec B27; plan 3.6; Amendment แถว §19j |
| F10 | MED | เลขผู้เสียภาษีท้ายใบหาย (B28) | cleanup spec B28; plan 3.6; Amendment แถว §19j footer |
| F11 | LOW | ผู้อ่านเอกสารไม่ใช่ Typhoon อย่างเดียวแล้ว | Amendment แถว header/§19j/§20 (`createProvider` `:766`, ตัดสิน 2026-08-28 `:742-746`) |
| F12 | LOW | ลายเซ็นเปิดใช้ทันทีโดยเจ้าของลายเซ็น ไม่มีตั๋วรออนุมัติ | Amendment แถวลายเซ็น (`signature-asset.use-case.ts:205-208`) |
| F13 | LOW | กติกา W00 manifest | cleanup spec AC-14; plan 3.5 regen `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1` + whole-chain |
| P50 | LOW | research note ยังอ้าง CLDR 45 + LDML ฉบับ smoke | Amendment แถว §19k: แถวนี้มีผลจนเจ้าของไฟล์ research แก้ (CLDR 49 + TR35 ฉบับออก) |

### Focused blocker review (2026-10-24) — Codex ultra เฉพาะ R3-F1/F2/F3 (`scratchpad/codex-review/review-exports-blockers.md`)

| รหัส | ผล | ช่องที่พบ | แก้ที่ |
|---|---|---|---|
| R3-F1 | **CLOSED** | — (scoped load `prisma-expense.repository.ts:1111` ปฏิเสธข้ามสาขาก่อนอ่านไฟล์/เข้าคิว) | สถานะ §0 ทุกไฟล์; plan ลำดับ + Phase S เริ่มได้ทันที; spec B26; Amendment แถว §16/§19a |
| R3-F2 | STILL OPEN → ออกแบบใหม่ | snapshot `CLAIMABLE` ของบรรทัดฟื้น VAT ที่ผู้ตรวจปฏิเสธ (`prisma-expense.repository.ts:644`, test `…tax-snapshot.spec.ts:541`; sync `:139` ต้องการ `CLAIMABLE`) | software spec §0, R2, R5, คอลัมน์ 16, `vat_not_representable`, tests, AC-15 ใหม่; plan 1.3 `effectiveInputVatRight` + tests, 1.4 อ่าน `inputVatClaimStatus`/`taxEvidenceStatus`/`taxEvidenceReviewStatus` ปัจจุบัน |
| R3-F3 | STILL OPEN → ออกแบบใหม่ | กรองวันที่ก่อนแทนภาพที่ยื่น → แบบที่ยื่นกันยายนไม่มีคีย์ (`withholding-filing-state.ts:63`) ย้ายรายได้มาไฟล์ตุลาคม | cleanup spec §0, §5.3 ข้อ 0–1, แผ่น 3, แผ่น 5 (`รวมในแบบที่ยื่นแล้ว`), AC-5, §14; plan 1.4 ลำดับใหม่ + fixture ข้ามเดือน + fixture ไม่มีการจ่ายสดในช่วง + กันสาขาอื่น |

### Focused re-check (2026-10-24) — Codex ultra (`scratchpad/codex-review/review-exports-blockers2.md`)

| รหัส | ผล | เรื่อง | แก้ที่ |
|---|---|---|---|
| R3-F2 | **CLOSED** | — | software spec/plan → READY (docs-first) |
| R3-F3 | **CLOSED** | — | — |
| RC-F1 | HIGH → **CLOSED** (focused check ครั้งสุดท้าย, `review-exports-rcf1.md`) | การขยายชุดแหล่งด้วยบรรทัดที่ยื่น (`periodKey in monthsOf(range)`) ไม่เคารพการแบ่งหน้า (`expense-evidence.use-case.ts:372`, `prisma-expense.repository.ts:4779`) → A/B ยื่นตุลาคม `pageSize: 1` ได้ A+B ทั้งสองหน้า | ใส่ sourceId จากบรรทัดที่ยื่นเข้า `extraIds` (:369-371) ให้ :372 ตัดทิ้งพร้อมกัน; แผ่น 5 แถว `หน้า`; test A/B สองหน้า — cleanup spec §0, §5.3 ข้อ 0, แผ่น 3/5, AC-5, §14; plan 1.4 |

| RC-F2 | HIGH ใหม่ → **ออกแบบแล้ว ต้องรีวิวก่อน Phase 1.4** (ไม่มี focused check รอบต่อไป) | ตัวโหลดรายการขยาย (`expense-evidence.use-case.ts:375`) แทนที่การเลือก → เลือก `['A']` หรือ `[]` แล้วได้ B ที่ยื่นเดือนเดียวกัน (`[]` = ไม่ตรงกับอะไร `contracts/src/expenses.ts:1663`) | ตัดผู้สมัครจากบรรทัดที่ยื่นด้วย `request.expenseIds` ก่อนเข้า `extraIds` (`[]` ข้ามคิวรี); test `['A']`/`[]` ทั้ง workbook และ ZIP — cleanup spec §0, §5.3 ข้อ 0, AC-5, §14; plan 1.4 |

Must close before coding (สรุปจาก §0 ของสเปก):
- R3-F1, R3-F2, R3-F3, RC-F1 → ปิดแล้ว; Phase S ส่งเดี่ยวได้ก่อนทุกอย่าง; cleanup 1.1–1.3 เริ่มได้
- RC-F2 → รีวิวก่อน cleanup plan Phase 1.4 (และ 1.5 ที่ต่อท้าย)

Next:
1. Phase S (B26) ทำได้ทันที แยก commit เดี่ยว; รีวิว RC-F2 ก่อน Phase 1.4 (สถานการณ์ที่พัง + การออกแบบอยู่ใน §0 ของ cleanup spec)
2. ส่งสเปกให้เจ้าของ (ไทยง่าย ไม่มีรหัส) พร้อมคำถาม Q
3. cleanup plan Phase 1.1–1.3 เริ่มได้ (ไม่ต้องรอคำตอบเจ้าของ); 1.4 และ 1.5 (ต่อท้าย 1.4) รอรีวิว RC-F2
4. ถ้าเจ้าของตอบข้อ 13 Q2 = ได้ → Phase 0 FlowAccount ขนานกัน
5. หลัง cleanup Phase 1 → accounting-software-export Phase 1
