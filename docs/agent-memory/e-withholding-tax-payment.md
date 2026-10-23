# Agent Memory: e-withholding-tax-payment (จ่ายผ่าน e-WHT ธนาคารนำส่ง อัตรา 1%)

Status: READY (docs-first) — reviewed 4 rounds + focused blocker checks 2026-10-24, no HIGH open; see Must close before coding (owner Q1–Q4 first). BL1/BL2 closed by the focused blocker review, BL3 closed by its focused re-check after W-T6/A38 were split into same-form supplementary (W-T6a, A38) vs. other-form original return that may be late (W-T6b, A38b). Remaining before coding (spec §18): MC1 owner answers Q1–Q4 (Q2 gates plan 1.3, Q4 gates 4.4), MC2 RD notice under มาตรา 3 ปัณรส, MC3 cheque via e-WHT. No code changed.
Owner: Expenses + Tax lane (backlog ข้อ 7 ใน `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md`)
Scope: ช่องทาง "ธนาคารนำส่ง (e-WHT)" บนรายจ่าย (ทุกแพ็ก), อัตราเสนอ 1% ตามกฎกระทรวง 389/402 (เฉพาะประเภทที่ลดได้ ในช่วง และโหมด RATE), ตัด e-WHT ออกจาก ภ.ง.ด.3/53 + ไฟล์แบบ + 50 ทวิ, ไฟล์รายการ e-WHT แยก (endpoint อ่านอย่างเดียว), ห้ามเงินสด/บัตรทุกทางจ่าย, คอลัมน์ไฟล์ส่งออก (ท้ายสุด), คำเตือน `WHT_RATE_MISMATCH`, LINE/เครื่องมือ AI/การ์ดคำตอบ/คู่มือ. ไม่รวม: supplier payment (ไม่ได้ขาย), claims (รับรายจ่ายที่หักภาษีไม่ได้), เชื่อมธนาคาร, ใบสำคัญจ่าย PDF, ลงบัญชีการนำส่ง, เปิดเครื่องมือ LINE ให้แพ็กอื่น

Decisions:
1. ช่องทางอยู่ที่ `ExpenseRecord.whtRemittance` (enum `WhtRemittance { PAYER_FILES, E_WHT }`, nullable, ไม่ backfill; `null` = ร้านยื่นเอง) และต้องผ่าน create data / update whitelist (`prisma-expense.repository.ts:1885-1889`) / `mapExpense` (:244) / model
2. e-WHT ⇒ `TaxEvent.status = EXCLUDED` + `sourceEventType = 'expense.wht.e_wht'`; `EXCLUDED` ไม่เคยอยู่ในแบบ จึงข้ามเฉพาะเมื่อมีแถวแบบ FILED ครอบการจ่ายจริง ไม่ใช้ล็อกเดือนแบบเก่า และไม่พลิกสถานะงวด; repo lookup/retire รวม `EXCLUDED`; void จาก CONFIRMED supersede `EXCLUDED` ทันที (`:3476`)
3. ยืนยันรายจ่าย e-WHT ไม่สร้าง `WhtCertificateHandoff` (`:3522`, `:3704`); ข้อความแจ้งเตือนเปิดแก้ (`expense-draft.use-case.ts:2049`) เปลี่ยนเป็นเงื่อนไข N-1
4. บังคับข้อเดียว "e-WHT ห้าม CASH/CARD" ด้วยฟังก์ชันเดียว ที่: `recordPaymentInTransaction`, พรีวิวบันทึกจ่าย, พรีวิวจ่ายใบเตรียมจ่าย (วิธีจ่ายจริง = payment ?? plannedMethod), plannedMethod ของร่างใบ, ใบรับรองแทนใบเสร็จ (`assertSubstitutePaymentDetails`), และตอนตั้ง/ยืนยันช่องทางเมื่อมีรายการจ่ายเงินสด/บัตรอยู่แล้ว; ไม่บังคับอัตรา
5. กติกาอัตรา: ค่าคงที่ใน `packages/contracts/src/tax.ts` — REDUCED = SERVICE_3/5, RENT_*, PROFESSIONAL_*, ADVERTISING_*, PRIZE/PRIZE_JUR; NOT_REDUCED = TRANSPORT, INTEREST*, DIVIDEND*; UNKNOWN = OTHER_*; ช่วง 2023-01-01..2027-12-31 (MR389 + MR402)
6. ข้อเท็จจริงภาษีที่แก้แล้ว: ค่าบริการโรงแรม/ภัตตาคาร/เบี้ยประกันชีวิตไม่ใช่ค่าบริการที่หัก 3% ตั้งแต่ต้น (ท.ป.4/2528 ข้อ 12/1 — rd.go.th/3479.html) ไม่ใช่ "ใช้อัตราปกติ"; ค่าเช่าเรือขนส่งสินค้าระหว่างประเทศ 1% ปกติไม่ต้องผ่าน e-WHT (กฎกระทรวง 144 ข้อ 2(7)(ค) — rd.go.th/2494.html) ⇒ 1% ไม่ได้แปลว่า e-WHT
7. `WHT_RATE_MISMATCH` WARNING หนึ่งรายการต่อ (รายจ่าย, งวด) คำนวณรวมหลังลูป; ข้อความเงื่อนไขสองทาง; resolve เมื่อเปลี่ยนเป็น e-WHT / เอาการหักออก / เปิดแก้ / ยกเลิก; การ resolve ของ source จำกัดเฉพาะงวด WHT (แก้บั๊กเดิม B5 ที่ `sync-tax-events.use-case.ts:72`)
8. ไฟล์รายการ e-WHT = `GET tax/withholding/months/:periodKey/e-wht-export` อ่านอย่างเดียว ไม่ผ่าน validation ของแบบ ไม่ replay ไม่สร้าง package; ไฟล์แบบไม่เปลี่ยน
9. ตั้งช่องทางบนเว็บ; LINE ใช้ "โอนเงิน" เป็นค่าตั้งต้น ไม่ถาม; ปฏิเสธเงินสดพร้อม `StoredAction` ที่ผูก revision/digest + ยอด/วันที่เดิม ให้ปุ่ม [โอนเงิน] ลองใหม่ได้
10. เครื่องคิดเลข/สรุปรายเดือนใน LINE ยังแพ็ก 1,999 (registry ไม่แก้); การ์ด `wht.e-wht` เปิดทุกแพ็ก อ้าง tax-guide เป็น source ตรง (ไม่ใช้ helper ที่ตรึง getting-started)
11. ประโยคทั้งหมดอยู่ใน `E_WHT_WORDS` (สเปก §10.1) พร้อมตาราง surface × case (§10.2)
12. ยืนยันจากหน้ากรมสรรพากรเอง (ปชส. 5/2564 หน้า 1, 3, 5) ว่า e-WHT แทนการยื่นแบบและไม่ต้องออก/แนบ 50 ทวิ; ตัวประกาศอธิบดีฯ ตามมาตรา 3 ปัณรส ยังหาไม่เจอ (MC2)
13. บรรทัด e-WHT ในสรุปรายเดือน LINE เฉพาะผู้มี `wht.pnd53.read` (ผู้มีแค่ `wht.certificate.read` อาจถูกจำกัดที่รายจ่ายของตน — `wht-handoff-read-scope.ts:10-18`)
14. ยอด e-WHT ไม่แปลงสกุลเงิน แยกตามสกุลเงินทุกที่ (`WithholdingMonthPaymentDto.currency`, ไฟล์ e-WHT, L-11)
15. ตรวจข้อมูลต้นทาง (`MISSING_TAX_ID`/FX) ตัดสินรวมต่อ (รายจ่าย, งวด) หลังลูป — แก้บั๊กเดิม B6
16. ช่องทางต้องไปถึง `DisbursementPayableExpense` (ตัวตรวจพรีวิว/plannedMethod และตัวเลือกในร่างใบ) และ `AccountantIndexSource` (ไฟล์ส่งออกจริง)
17. การเปิดแก้รายจ่าย e-WHT ถูกบล็อกเฉพาะเมื่อมีแถวแบบที่ยื่นจริงครอบ ไม่ใช่ล็อกเดือนแบบเก่า
18. L-12 (สรุปรายเดือน) บอกว่าเป็นรายการใบ 50 ทวิที่นับรายการยังไม่จ่ายด้วย — แก้บั๊กเดิม B7 ด้วยการเปลี่ยนป้าย ไม่เปลี่ยนวิธีนับ; รอบ 3 ทำให้ครบ: อังกฤษ (L-12en), ท้ายข้อความ (L-13/L-13en), ชื่อฟิลด์ผลลัพธ์ + `countBasis`, คำอธิบายใน registry (สิทธิ์/featureKeys เดิม)
19. issue ต้นทาง BLOCKING ต้องไม่หายจากกระดาษ: ทางผู้ทำบัญชีจัดทำ (B8, `withholding-filing-validation.ts:68-70`) และต้นทางที่ไม่มี event ในงวด (B11, `generate-tax-filing-package.use-case.ts:88`, `generate-wht-report.use-case.ts:159`) — ผูกกับกระดาษของสาขาของรายจ่าย และซ่อนรายละเอียดเมื่อสาขาอยู่นอกขอบเขตผู้เรียก (แก้ตามรอบ 4 F2 — BL2 ปิดโดย focused review 2026-10-24); `WHT_PAYEE_KIND_UNKNOWN` ไม่ถูกตัดใน export และบล็อกทั้ง ภ.ง.ด.3/53 (รอบ 4 F3 — BL3 ปิดโดย focused re-check 2026-10-24: ใช้ที่ markFiled ด้วย, แยกแบบเพิ่มเติม/แบบปกติอีกแบบ); ทางผู้ทำบัญชีจัดทำเก็บ WARNING ด้วย (รอบ 4 F8); ตัวบล็อกที่ไม่ส่งผลแล้วถูก resolve (รอบ 4 F4)
20. supersede แบบอื่นทำต่อบรรทัด/การจ่าย (`sourceLineKey`) ไม่ใช่ทั้งรายจ่าย (B9)
21. W-T3 แสดงเมื่อ: ไม่มี ACTIVE + มี EXCLUDED + ไม่มี issue ต้นทาง BLOCKING ในขอบเขต; ข้อความ "รายการที่จ่ายแล้ว…"
22. รายละเอียดใบเตรียมจ่ายส่ง `whtRemittance` + `eWhtReducedRateApplied` ต่อบรรทัด (การ์ดจ่ายเว็บและ LINE ใช้ตัดสิน W-P2/L-9)
23. ข้อความก่อนจ่ายเป็นอนาคต (W-D1u, W-V1u, L-2); ป้าย "หักภาษีทั้งเอกสาร" ในการ์ดใบเตรียมจ่าย LINE (B10); W-P2 รวมช่องวันจ่ายของใบรับรองแทนใบเสร็จเงินบริษัท
24. ย้อนกลับด้วยชุด R (รุ่นก่อน + คอลัมน์ + ตัวป้องกันฝั่งเขียนทุกจุดที่อ่าน `whtRemittance` + ตัด `E_WHT` ใน `findConfirmedWithWhtByCompany` — แก้ตามรอบ 4 F1, BL1 ปิดโดย focused review 2026-10-24) ที่ build/ซ้อมบน UAT ไว้แล้ว — ห้ามย้อน API ด้วยรุ่นเก่าตรง ๆ เพราะเปิดหน้าเดือนใดก็ sync ทั้งบริษัท

Open questions (เจ้าของ — คำแนะนำในวงเล็บ):
- Q1 เปิดทุกแพ็ก 249–1,999 ไหม (ใช่)
- Q2 ให้ออก 50 ทวิให้การจ่าย e-WHT ได้ไหม (ไม่ให้)
- Q3 ค่าตั้งต้นของรายจ่ายใหม่ (ร้านยื่นแบบเองทุกครั้ง)
- Q4 อนุมัติ L-7 การ์ดใหม่ `wht.e-wht`, L-8 แก้ `wht.calculation`, H-1/H-2 คู่มือภาษี (อนุมัติ) — บล็อกเฉพาะแผน 4.4

Artifacts:
- `docs/specs/e-withholding-tax-payment-spec.md`
- `docs/plans/e-withholding-tax-payment-plan.md`
- review: `codex-review/review-ewht.md` (Codex, verdict เดิม "unsafe to build")
- แหล่งที่อ่าน: mr402.docx (ลงนาม 1 ต.ค. 2569; ราชกิจจาฯ เล่ม ๑๔๓ ตอนที่ ๖๓ ก, ๙ ต.ค. ๒๕๖๙ — fact-check lane 2026-10-23), mr389.pdf (RG 10 มี.ค. 2566), news14_2569.pdf, news5_2564.pdf, rd.go.th/3479.html (ท.ป.4/2528 ข้อ 12/1, ปรับปรุง 25 มิ.ย. 2569), rd.go.th/2494.html (กฎกระทรวง 144 ข้อ 2, coordinator ยืนยัน), PEAK manual
- บั๊กที่พบ (สเปก §13): B1 สูง ยื่นซ้ำ; B2 กลาง 50 ทวิค้าง/ข้อความ/ปุ่ม; B3 ต่ำ คู่มือ "15 หมวด DRAFT"; B4 ต่ำ `WHT_RATE_MISMATCH` dead code อังกฤษ; B5 กลาง (review F2) ลูป WHT resolve ตัวบล็อก FX ของ ภ.พ.30; B6 สูง (review รอบ 2 F3) รายจ่ายเก่าหลายบรรทัด: บรรทัด "ผู้ทำบัญชีจัดทำ" resolve `MISSING_TAX_ID` ของบรรทัด "ระบบกรอก" ⇒ แบบขาดแถวโดยไม่มีตัวบล็อก (ขึ้นกับลำดับบรรทัด); B7 กลาง (review รอบ 2 F8) สรุปรายเดือน LINE นับ handoff เป็น "การจ่าย" รวมใบแจ้งหนี้ที่ยังไม่จ่าย; B8 สูง (รอบ 3 F1) ทางผู้ทำบัญชีจัดทำทิ้ง issue ต้นทาง; B9 สูงเมื่อเปิดหมวด ภ.ง.ด.2 (รอบ 3 F2) supersede แบบอื่นทั้งรายจ่าย; B10 กลาง (รอบ 3 F7) การ์ดใบเตรียมจ่าย LINE แสดงยอดหักทั้งเอกสารข้างยอดจ่ายครั้งนี้; B11 สูง (พบเองระหว่างแก้รอบ 3 — อ่านโค้ด ยังไม่ได้รัน) issue ต้นทางของรายการที่ไม่มี event ถูกตัดจากกระดาษเมื่อเดือนนั้นมีกระดาษแล้ว
- review รอบ 3: `codex-review/review-ewht3.md` (34/37 resolved, P11/P28/P33 partly, F1–F9 ใหม่ — HIGH 3)
- review รอบ 2: `codex-review/review-ewht2.md` (23/25 resolved, P15/P21 partly, F1–F12 ใหม่)

Review 2026-10-23 (F1–F25 → แก้ที่ไหน):
- F1 ห้ามเงินสด/บัตรใน substitute receipt + ตอนเปลี่ยน/ยืนยันช่องทาง → สเปก §5.4, §7.3, §9, W-R2/W-R3; แผน 1.5
- F2 resolve issue จำกัดงวด WHT + บั๊กเดิม → สเปก §7.4, §13 B5; แผน 2.1, 2.2
- F3 persistence ครบชั้น → สเปก §6; แผน 1.3
- F4 ตัด `whtRemittance` จาก preview payload → สเปก §7.1, A19; แผน 3.1
- F5 resolve WARNING เมื่อเปลี่ยน/เอาออก/ยกเลิก → สเปก §7.4, §9; แผน 2.1, 2.2
- F6 WARNING รวมต่อ (รายจ่าย, งวด) → สเปก §7.4, §14; แผน 2.2
- F7 EXCLUDED กับล็อกเดือนแบบเก่า → สเปก §5.4, §7.4; แผน 2.1, 2.2
- F8 void จาก CONFIRMED supersede EXCLUDED ทันที → สเปก §7.4; แผน 2.1
- F9 ไฟล์ e-WHT เป็น endpoint แยก ไม่เพิ่มชีตในไฟล์แบบ → สเปก §7.2, A5/A6/A6b; แผน 2.4, 3.4
- F10 A9 ใช้จ่ายบางส่วน + A9b จ่ายครบถูกบล็อก → สเปก §5.4, §15; แผน 1.6
- F11 เตือนวันจ่ายนอกช่วงในใบเตรียมจ่ายและ LINE ทั้งสองการ์ด → สเปก §5.2, W-P2/L-9, A11b; แผน 3.2, 3.3, 4.1 — รอบ 3 ประเมิน PARTLY (P11): ใบเตรียมจ่ายยังไม่มีประเภท/อัตราต่อบรรทัด → แก้ในรอบ 3 F5
- F12 โรงแรม/ภัตตาคาร/เบี้ยประกันชีวิตไม่ใช่ค่าบริการหัก 3% → สเปก §5.1, §5.2, W-F5, L-5, L-7
- F13 ค่าเช่าเรือระหว่างประเทศ 1% ปกติ; W-F10/W-T4 เป็นเงื่อนไข → สเปก §5.1, §5.2, §10.1, §10.2
- F14 ซ่อน `whtFilingRouteHint` เมื่อ e-WHT → สเปก §10.1, §10.2, A12; แผน 3.1
- F15 H-1 ระบุเงื่อนไข autofill (ประเภท/วันที่/RATE) → สเปก §10.1, A12b — **แก้คำอ้างเดิม**: รอบ 1 L-8 ยังขาดเงื่อนไขวันที่ (review รอบ 2 P15) แก้แล้วในรอบ 2
- F16 W-T3 ต่อแบบ/สาขา ไม่อ้างทั้งเดือน → สเปก §7.5, §10.1, §10.2; แผน 2.3
- F17 ข้อความแจ้งเตือนเปิดแก้ N-1 + เทสต์ ออกใบ→เปิดแก้→e-WHT → สเปก §7.5, A16; แผน 1.6
- F18 สรุปรายเดือน LINE แยกยอด e-WHT (L-11) + แคบประโยคเดิม (L-12) → สเปก §7.1, §10.1; แผน 4.3
- F19 เครื่องคิดเลขยังแพ็ก 1,999 แยกจากการ์ดความรู้ทุกแพ็ก → สเปก §3, §4, §8, A15b, G6; แผน 4.3
- F20 "ค่าโฆษณา" ได้ปุ่มเลือกประเภทก่อน → สเปก §10.2, A15; แผน 4.3
- F21 พรีวิวใบเตรียมจ่าย + plannedMethod → สเปก §7.3; แผน 1.4
- F22 สถานะลองใหม่ผูกรายการ + L-10 → สเปก §10.5; แผน 4.2
- F23 ตรวจเบราว์เซอร์จริงที่ 390 และ 1,280 (+1,556) → สเปก §14, A18; แผน 3.5
- F24 การ์ด `wht.e-wht` อ้าง tax-guide ตรง → สเปก §11, §14; แผน 4.4
- F25 คอลัมน์ใหม่ท้ายสุดทั้งสองชุด → สเปก §7.1, A14; แผน 1.6

Round 2 (2026-10-24) — `review-ewht2.md` (P = ข้อรอบ 1 ที่ยังไม่ครบ, F = ข้อใหม่):
- P15 (PARTLY) L-8 เพิ่มเงื่อนไข "วันที่เอกสารอยู่ในช่วงที่กฎหมายลดอัตรา" + แก้คำอ้างใน memory → สเปก §10.1 L-8; memory Review F15
- P21 (PARTLY) / F4 (MEDIUM) ช่องทางผ่าน `readDisbursementExpenseSources` select → `payableExpenses` → `DisbursementPayableExpense` → สเปก §7.1, A26, §14; แผน 1.4, 3.3
- F1 (HIGH) บรรทัด e-WHT ในสรุปรายเดือน LINE เฉพาะ `wht.pnd53.read` → สเปก §7.1, §8, L-11, A20; แผน 4.3
- F2 (HIGH) คงสกุลเงิน แยกยอดต่อสกุลเงิน (DTO, ไฟล์, LINE) → สเปก §5.4, §7.1, §7.2, L-11, A21, G13; แผน 2.2, 2.3, 2.4, 4.3
- F3 (HIGH) ตรวจต้นทางรวมต่อ (รายจ่าย, งวด) + บันทึกเป็นบั๊กเดิม B6 → สเปก §7.4, §13 B6, A22, §14; แผน 2.2 — รอบ 3 ประเมิน PARTLY (P28): sync เก็บตัวบล็อกแล้วแต่ export ทางผู้ทำบัญชีจัดทำยังทิ้ง → แก้ในรอบ 3 F1 (B8, B11)
- F5 (MEDIUM) `AccountantIndexSource` + ผู้เรียก `expense-evidence.use-case.ts:165-207` → สเปก §7.1, §11, §14; แผน 1.6
- F6 (MEDIUM) `getMonth` คง `bank_remitted_only` (:171) และรวมสาขาที่มีแต่ e-WHT (:143) → สเปก §11, A23, §14; แผน 2.3
- F7 (MEDIUM) ตัวตรวจเปิดแก้ใช้แถวแบบที่ยื่นจริงสำหรับ e-WHT (`expense-void-blocker.ts:137`, :196-208) → สเปก §5.4, §7.4, A24; แผน 2.1
- F8 (MEDIUM) L-12 เปลี่ยนป้ายเป็นรายการใบ 50 ทวิ + บันทึกเป็นบั๊กเดิม B7 → สเปก §7.1, §10.1 L-12, §13 B7; แผน 4.3 — รอบ 3 ประเมิน PARTLY (P33): อังกฤษ/ท้ายข้อความ/ชื่อฟิลด์/คำอธิบายเครื่องมือยังเรียกว่าการจ่าย → แก้ในรอบ 3 F6
- F9 (MEDIUM) `PaymentDateConfirmation` W-PD1/W-PD2 + W-P2 → สเปก §10.1, §10.2, A25, §14; แผน 3.2
- F10 (LOW) guard อยู่ที่ `substitute-funding.logic.ts:19` → สเปก §7.3, §11; แผน 1.5
- F11 (LOW) `agent-tools.registry.spec.ts:351-362` v6 68 → 69 + reviewers → สเปก §11, §14; แผน 4.4
- F12 (LOW) Q4 บล็อกแผน §4.4 (ไม่ใช่ 4.3) → สเปก §16, §17
- ข้อที่ปิดด้วยการอ่านโค้ดไม่ได้ → สเปก §18 MC1–MC3, MC5 (คำตอบเจ้าของ, ประกาศอธิบดีฯ, เช็คผ่าน e-WHT, re-review; MC4 วันราชกิจจาฯ ปิดแล้ว 2026-10-24)

Round 3 (2026-10-24) — `review-ewht3.md` (34/37 resolved; P = ข้อเดิมที่ยังไม่ครบ, F = ข้อใหม่):
- P11 (PARTLY) / F5 (MEDIUM) รายละเอียดใบเตรียมจ่ายส่ง `whtRemittance` + `eWhtReducedRateApplied` (`detailInclude` :35-39, mapper `disbursement-voucher.use-case.ts:276-285`) → สเปก §7.1, §10.1 W-P2, §10.2, §14; แผน 2.5, 3.3, 4.1
- P28 (PARTLY) / F1 (HIGH) เก็บ issue ต้นทาง BLOCKING ในทางผู้ทำบัญชีจัดทำ (B8) + ต้นทางที่ไม่มี event (B11, พบเพิ่มเอง) → สเปก §7.4, §11, §13 B8/B11, A27, §14; แผน 2.3
- P33 (PARTLY) / F6 (MEDIUM) ทำ B7 ให้ครบ: L-12en, L-13, L-13en, ชื่อฟิลด์ + `countBasis`, คำอธิบาย registry (`ai-tools.ts:1351`) → สเปก §7.1, §10.1, §11, §13 B7; แผน 4.3
- F2 (HIGH) supersede แบบอื่นต่อ `sourceLineKey` + บั๊กเดิม B9 → สเปก §7.4, §13 B9, A28, §14; แผน 2.2
- F3 (HIGH) ขั้นตอนย้อนกลับที่ทำได้จริง: ชุด R (รุ่นก่อน + คอลัมน์ + ตัด `E_WHT` ในตัวอ่าน sync) build/ซ้อมไว้ + ขั้นแก้หลังย้อนผิด → สเปก §16, A32; แผน Phase 5
- F4 (MEDIUM) W-T3 ต้องไม่มี issue ต้นทาง BLOCKING ในขอบเขต + ข้อความ "รายการที่จ่ายแล้ว…" → สเปก §7.5, §10.1, §10.2, A30; แผน 2.3
- F7 (MEDIUM) ป้าย "หักภาษีทั้งเอกสาร" ในการ์ดใบเตรียมจ่าย LINE + บั๊กเดิม B10 → สเปก §10.1 L-4, §10.2, §13 B10, A29; แผน 4.1
- F8 (MEDIUM) W-P2 ที่ช่องวันจ่ายของใบรับรองแทนใบเสร็จเงินบริษัท → สเปก §10.1 W-P2, §10.2, A31, §14; แผน 3.2
- F9 (MEDIUM) ข้อความก่อนจ่ายเป็นอนาคต W-D1u, W-V1u, L-2 → สเปก §10.1, §10.2, A2/A4/A13; แผน 3.2, 3.3, 4.1
- HIGH รอบ 3 (F1, F2, F3) ยังไม่มีผู้ตรวจยืนยันการแก้ — รอ review รอบ 4; ถ้ายังเปิดอยู่จะเป็น blocker ใน §18

Round 4 (2026-10-24) — `review-ewht4.md` (last review; 43/46 resolved; P = earlier item still partial, F = new):
- P40 (PARTLY) / F1 (HIGH, BL1) rollback build R must keep every write guard that reads `whtRemittance` (all §7.3 points incl. `recordPaymentInTransaction` `prisma-expense.repository.ts:670-679`, no handoff at confirm, reconfirm cash/card check) + sync filter; otherwise an unpaid e-WHT expense takes CASH and R's reader drops it from the return → spec §16, A32, §18 BL1; plan Phase 0 gate, Phase 5, decision 17
- F2 (HIGH, BL2) orphan blockers (B11 fix) bound to the paper of the expense's branch; outside the caller's scope shown as W-T5 without names/ids; payer-mode unanswered keeps `WHT_PAYER_MODE_REQUIRED` → spec §7.4 "รอบ 4" (ข), §10.1 W-T5, A34, §18 BL2; plan 2.3
- F3 (HIGH, BL3) existing bug B12: `validateWithholdingFiling` (:14) drops `WHT_PAYEE_KIND_UNKNOWN`, so a paid legacy unknown-kind expense is omitted while another PND53 row allows export → keep it, block both PND3/53 of that branch; month card counts it → spec §7.4 (ค), §13 B12, A33, §18 BL3; plan 2.3
- F4 (MEDIUM) stale blockers resolved after the loop when (expense, period) no longer contributes (void, payment cancel, withholding removed, never-event sources); void/reopen resolve immediately → spec §7.4 (ง), A35, §14; plan 2.2
- F5 (MEDIUM) existing bug B13 overlapping document/payment handoffs inflate the LINE month summary (15,000/150 instead of 10,000/100) → remaining = document − certified siblings → spec §7.1, §13 B13, §14; plan 4.3
- F6 (MEDIUM) scope policy `documentExplanationReply` matched "e-WHT คืออะไร" as generic withholding ("payer remits") and overwrote the card → e-WHT branch first, answer L-14 (= L-7) → spec §10.1 L-14, §11, §14, A36; plan 4.4
- P11/P42 (PARTLY) / F7 (MEDIUM) voucher warning metadata needs all lines with `whtAmount`/`whtRate`/`taxableAmount` (drop `take: 1` for this data) because legacy rows use line rates first → spec §7.1, §14; plan 2.5
- F8 (MEDIUM) accountant-prepared validation keeps source WARNINGs too (W-T4) → spec §7.4 (ก), §14; plan 2.3, decision 20
- F9 (LOW) Q2 gate aligned: plan 1.3 waits for Q2 (matches spec §18 MC1); 4.4 waits for Q4 → plan Phase 0
- Revised earlier decisions: rollback (was "R = previous + sync filter only") and orphan blockers (was "block every paper of the form") are superseded by decisions 17–18 in the plan

Focused blocker review (2026-10-24) — `codex-review/review-ewht-blockers.md`:
- BL1 CLOSED — R keeps payment/confirmation guards; A32 covers cash refusal and reconfirm without handoff
- BL2 CLOSED — branch attribution + full redaction (incl. sourceId and validation-regenerated fields)
- BL3 STILL OPEN — mark-filed bypass: `tax.controller.ts:333-336` filters `WHT_PAYEE_KIND_UNKNOWN` and counts only sources with events; FILED replay skips validation → fix extended: shared `withholdingPaperBlockers` at validation/getMonth/markFiled; regression EXPORTED → unknown-payee blocker → mark-filed rejected (spec A37, tax.controller.spec.ts); already-FILED papers: no rewrite, W-T6 flag + supplementary paper after fixing the source (A38), pre-deploy read-only query listing FILED papers with bound blockers → spec §7.4 (ค), §10.1 W-T6, §13 B12, §14, §15 A37/A38, §18 BL3; plan 2.3, Phase 0 gate, Phase 5, decision 19

BL3 focused re-check (2026-10-24) — `codex-review/review-ewht-bl3.md`:
- shared `withholdingPaperBlockers` at validation/getMonth/markFiled closes the mark-filed bypass
- last correction applied: when only PND53 was FILED and an unknown payee becomes INDIVIDUAL, the payment moves to PND3 (`sync-tax-events-wht-form.use-case.spec.ts:91`), which opens as an ORIGINAL return (`withholding-filing-state.ts:67-72`) and is blocked by the existing overdue fault if late (`withholding-filing-validation.ts:56`, message `tax-period.logic.ts:145` tells the accountant to check surcharge and file with RD) → spec W-T6 reworded ("ต้องยื่นแบบเพิ่มเติมหรือยื่นอีกแบบหนึ่ง"), W-T6a/W-T6b, A38/A38b, §7.4 (ค); plan 2.3 test + decision 19
- BL3 CLOSED; no blocker left

Verification:
- เอกสารเท่านั้น ไม่ได้รันเทสต์/บิลด์ (worktree ไม่มี node_modules) — not run
- ตรวจแล้ว: worktree HEAD b27180990 tree = 6c54ba208 tree (`7593ad1f`); file:line ใหม่จาก review เปิดอ่านจริง (เช่น `prisma-expense.repository.ts:802`, :1885-1889, :3085-3098, :3476, :3507, :3632, :4997; `sync-tax-events.use-case.ts:72`, :234; `filed-withholding-payment.ts:20-24`; `prisma-tax.repository.ts:226-233`; `useExpenseReviewTotals.ts:24-30`; `validation-pipe.options.ts:7`; `disbursement-voucher.use-case.ts:149-153`; `line-expense-action.service.ts:981-997`; `expense-draft.use-case.ts:2049`; `product-help-draft-cards.ts:3-12`); spec files ที่แผนใช้อยู่ในรายการรันแล้ว (เพิ่ม `tax.controller.spec.ts`, `substitute-receipt.use-case.spec.ts`, `prisma-expense.repository.substitute-payment.spec.ts`; `record-expense-payment.use-case.spec.ts` มี assertion ข้อความเปิดแก้ที่ :259-264)

- รอบ 2: อ่านจริงเพิ่ม `wht-handoff-read-scope.ts:10-18`, `expense-source.adapter.ts:104-131`, `sync-tax-events.use-case.ts:70-73,300-308`, `prisma-expense.repository.ts:1295-1304`, `disbursement-voucher-read.use-case.ts:83-92`, `expense-export.logic.ts:25`, `generate-wht-report.use-case.ts:143,171`, `expense-void-blocker.ts:137,196-208`, `erp-advisor-document-tools.use-case.ts:62-121`, `PaymentDateConfirmation.tsx:18,26`, `substitute-funding.logic.ts:19`, `agent-tools.registry.spec.ts:351-362`; `generate-tax-filing-package.use-case.spec.ts` ครอบ `GenerateWhtReportUseCase` และอยู่ในรายการรัน; `agent-tools.registry.spec.ts` อยู่ในสคริปต์ `test` ของ ai-gateway; มี `apps/web/src/features/expenses/PaymentDateConfirmation.spec.ts`

Next:
- ส่ง Q1–Q4 ให้เจ้าของก่อน (ภาษาไทยง่าย ไม่มี path/รหัส); ปิด MC2/MC3 ด้วย research lane; แล้วเริ่มแผน 1.1 → 1.2 (codex lane รอบละ ~5 ข้อ) — ไม่มี blocker จาก review เหลือ
- ส่ง Q1–Q4 ให้เจ้าของ (ภาษาไทยง่าย ไม่มี path/รหัส)
- หลังผ่าน re-review: เริ่มแผน 1.1 → 1.2 ใน worktree แยก (codex lane, รอบละ ~5 ข้อ)
