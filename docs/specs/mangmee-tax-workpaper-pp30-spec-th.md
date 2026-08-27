# Tax Workpaper ภ.พ.30 + Accountant Review — Spec P21

สถานะ: **PARTIAL READY** — source-to-workpaper core เริ่มได้ แต่ form mapping/export activation ต้องรอแบบทางการ current-version + named tax expert + fixture จริง; แผนส่งมอบอยู่ใน [Four-lane Gap Closure Plan](../plans/mangmee-four-lane-gap-closure-plan-th.md#p21--tax-workpaper--accountant-review)

ที่มา: [แผนหลัก P21](../plans/mangmee-brain-2-5-day-priority-plan-th.md) 3 ข้อ — (1) approval queue + entry preview + reasoned override + reversal + closed-period handling (2) เชื่อมรายงานภาษีขาย/ภ.พ.30, WHT receivable/50ทวิ, AR aging/unapplied credit, reconciliation evidence (3) แยก "ระบบเตรียมข้อมูล" ออกจาก "ระบบยื่นแบบ" — ห้ามแสดงว่ายื่น/กรมสรรพากรรับแล้วถ้าไม่มีหลักฐานจริง — บวกรายการองค์ประกอบ PP30 package ตาม [OS spec §12.3](mangmee-accounting-operating-system-spec-th.md): output register, input register, selected input lines, carry-forward, adjustments, summary boxes, branch/scope snapshot, report/PDF/export artifact, reviewer sign-off, submission/payment evidence, amendment chain

เป้าหมาย: ปิดงวดภาษีหนึ่งงวดให้ถึงระดับ "นักบัญชีตรวจแล้วกล้าเซ็น" —

1. งวด ภ.พ.30 ออกเป็น workpaper package ครบองค์ประกอบ §12.3 และทุกบรรทัด trace กลับต้นทางได้ (F-TAX-1)
2. ภ.ง.ด.3/53 มีใบแนบตามช่องแบบ ไม่ใช่แค่กลุ่มผู้ถูกหัก (F-TAX-2)
3. นักบัญชีมีคิวตรวจ-อนุมัติ-override พร้อมเหตุผล และงวดที่ปิดแล้วแก้ไม่ได้นอกเส้นทาง AMENDED (F-TAX-3)
4. ทุกหน้าจอพูดความจริง: ระบบ**เตรียมข้อมูล** ไม่ได้**ยื่นแบบ** (F-TAX-4)

หลักฐานโค้ดอ้างอิง `develop` (สำรวจ 2026-08-26)

เอกสารแม่: [OS spec](mangmee-accounting-operating-system-spec-th.md) (§12.3 องค์ประกอบ package, §12.6 capability separation), [tax knowledge spec](mangmee-accounting-tax-knowledge-spec-th.md), [ledger spec](mangmee-income-expense-ledger-spec-th.md) (§F-LED-7 กติกา UI), `tax-2026-verified-rules.md`, `tax-thailand-2026-spec.md` §1

## 1. Current truth (สำรวจ 2026-08-26)

### 1.1 ของที่มีจริงแล้ว (นำมาใช้ต่อ ไม่สร้างซ้ำ)

| ส่วน | หลักฐาน | ใช้กับ P21 อย่างไร |
|---|---|---|
| โครงงวดภาษีครบวงจร: `TaxPeriod` unique `[companyId, formType, periodKey]`; `TaxPeriodStatus` = OPEN NEEDS_REVIEW READY_FOR_REVIEW REVIEWED EXPORTED FILED PAID CLOSED AMENDED; `TaxFormType` = PP30 PP36 PND3 PND53 PND50 PND51 CUSTOMS_SUPPORT | `schema.prisma:3715-3743`, enum `:3102-3112`, `:3086` | REVIEWED = จุด sign-off ผู้ตรวจ, AMENDED = ปลายทาง amendment chain (F-TAX-1) |
| `TaxEvent` เป็น register-grade อยู่แล้ว: `taxableBase`/`taxAmount` Decimal(18,4), `taxInvoiceNumber`, `payeeSnapshotJson`, `eventDate`, currency+exchangeRate snapshots, `claimabilitySnapshot`, `taxEvidenceReviewStatus`, `reportContributionsJson` (contribution ต่อช่องแบบ), `accountAssignmentsJson`, deep link `sourceType/sourceId/sourceLineId`; จัดกลุ่มต่อ period+form ผ่าน `taxPeriodId/periodKey/eventType`; `TaxEventType` = VAT_OUTPUT VAT_INPUT VAT_EXEMPT VAT_REVIEW CUSTOMS_ASSESSED WHT_PND3 WHT_PND53 | `schema.prisma:3745-3818` (indexes `:3812-3816`), `:3114` | บรรทัด register ขาออก/ขาเข้าของ F-TAX-1 ดึงจากนี่ตรง ๆ ไม่ต้องมี model ใหม่ |
| ช่อง ภ.พ.30 ทั้ง 9 คำนวณแล้ว: `aggregatePp30Boxes` (box_1_total_sales, box_2_zero_rated_sales, box_3_exempt_sales, box_5_output_tax, box_6_eligible_purchases, box_7_input_tax; box4=1-2-3, box8=max(5-7,0), box9=max(7-5,0), Decimal rounding policy) + DTO + route | `transaction-tax.logic.ts:361-382`; `Pp30BoxesDto` `packages/contracts/src/transaction-tax.ts:377-387`; GET `.../reports/pp30-boxes` `transaction-tax.controller.ts:290-294` | ส่วน summary boxes ของ workpaper ใช้ตัวนี้ ห้ามคำนวณซ้ำ |
| Reconciliation run Source→TaxEvent→Journal→box (ปฏิเสธ event ที่ไม่ใช่ functional currency) + `TaxAdjustment` ชนิด CORRECTION ต่องวด PP30 (`:78`) | `transaction-tax-reconciliation.use-case.ts:278-284`; models `TaxReconciliationRun/Line` `schema.prisma:3532/:3557` | ส่วน reconciliation evidence + adjustments ของ package |
| เส้นทาง filing แบบ manual-first ครบ: GET `tax/periods` `:59`, POST `tax/sync` `:68`, GET `periods/:id/events` `:79`, POST `vat-report` `:88` / `wht-report` `:98` (perm `tax.report.recompute`), `review-issues` `:108-115`, PATCH `mark-filed` `:133` / `mark-paid` `:165` (perm `tax.filing.mark_filed/paid` — บันทึกมือเท่านั้น ไม่มีโค้ดยื่นจริงในระบบ), POST `filing-packages` `:178` (perm `tax.report.export`; PP30/PP36 ใช้ reconciliation run ล่าสุด — `generate-tax-filing-package.use-case.ts:32-36`), `wht-certificates` `:188`, `cit-calendar` `:241` | `tax.controller.ts` | F-TAX-1/2 ส่งออกผ่าน filing-packages; F-TAX-3 ขี่ review-issues |
| WHT register: `deriveWhtIncomeBase` `:40` (income base = withheld/(rate/100), null เมื่อ rate ผิด; ยอด 50ทวิ↔ใบแนบ ภ.ง.ด. ต้องตรงกัน `:29-38`), `groupWhtEvents` `:58` (กลุ่มตาม payeeName\|payeeTaxId\|incomeCategoryCode\|whtRate + รวม gross/withheld/netPaid + certificateNumbers + taxEventIds), `computeWhtTotals` `:90`, `validateCertificateTotals` `:105` | `wht-report.logic.ts` | เป็น **payee register** — ยังไม่ใช่ form-box workpaper (ช่องว่างของ F-TAX-2) |
| Snapshot/Package: `TaxReportSnapshot` (reportJson + checksum) `:3847`; `TaxFilingPackage` (exportFormat + attachmentId + FilingPackageStatus + filedManuallyAt/Note) `:3867` | `schema.prisma` | ที่เก็บ workpaper artifact + หลักฐานยื่น/จ่ายด้วยมือ |
| Export artifact 4 ฟอร์แมตใช้ซ้ำได้ทันที: `buildTaxExportArtifact` สลับ REVIEW_JSON\|CSV\|XLSX\|PDF (`buildMinimalPdf` `:41`) คืน `{fileName, mimeType, contentBase64, checksum sha256, byteLength}` | `tax-export.logic.ts:17-43` | workpaper ทุกใบส่งออกผ่านตัวนี้ ไม่เขียน exporter ใหม่ |
| Reports engine ทั่วไปรับ CSV เท่านั้น ปฏิเสธ format อื่น | `report.use-cases.ts:615-618` | จึงห้ามส่ง workpaper ผ่าน reports engine — ใช้เส้น tax filing-packages เท่านั้น |
| `tax.summary` dataset = roll-up ต่องวด (หนึ่งแถวต่อ TaxPeriod: activeEventCount/reviewIssueCount/openIssueCount/taxableBase/taxAmount) **ไม่ใช่ register**; `money()` ใช้ `Number(...)` float ต่างจากเส้น Decimal ที่อื่น | `report-catalog.ts:241-256`; `get-tax-summary.use-case.ts:23-26` | gap P21-FIN-01 |
| Period lock บังคับทุกทางเข้าแล้ว: accounting docs (`tax_period_locked` เมื่อ FILED\|PAID\|CLOSED), expenses, transaction-tax repo (PP30/PP36 + เพิ่ม AMENDED) | `prisma-accounting.repository.ts:632-638,977-981`; `prisma-expense.repository.ts:1856-2045`; transaction-tax repo `:200` | closed-period handling ของ F-TAX-3 มีรากบังคับฝั่ง backend แล้ว |
| Component→form membership: PP30 ⊃ {VAT, IMPORT_VAT, PP36_INPUT} | `tax-reconciliation.logic.ts:52` | ขอบเขตข้อมูลที่เข้า workpaper ภ.พ.30 |
| Web มีฐานแล้ว: `TaxReconciliationPage` (title "PP30 / PP36 / Customs Reconciliation" มีคำ ภ.พ.30), `getPp30Boxes`, `TaxWorkspacePage.tsx` มีอยู่ | `TaxReconciliationPage.tsx:37-95`; `transaction-tax.api.ts:131-132` | F-TAX-3 ต่อยอดจาก TaxWorkspacePage ไม่สร้างหน้าใหม่จากศูนย์ |
| กรอบความรู้ภาษี: 12 RD source URLs; MVP = เตรียม ภ.พ.30 + เตรียม ภ.ง.ด.3/53 + 50ทวิ model + CIT calendar; NOT MVP = auto-filing, legal advice, full e-Tax API; ทุก Thai-specialist operational route ต้อง CLOSED จนมีหลักฐาน; เส้นทางแก้งวดที่ยื่นแล้ว = manual-first (`RECORDED_EXTERNAL`, "ระบบไม่ได้ยื่นหรือยืนยันการรับแบบ") | `tax-2026-verified-rules.md`; `tax-thailand-2026-spec.md` §1 | กรอบบังคับของ F-TAX-4 และขอบเขต "สิ่งที่ไม่ทำ" |

### 1.2 ของที่ **ไม่มีเลย** (ยืนยัน NOT FOUND ทุกรายการ — คือช่องว่างที่ spec นี้ปิด)

1. **PP30 workpaper ในฐานะเอกสาร**: ไม่มี output/input register รายบรรทัดพร้อมเลขลำดับ, ไม่มี flag "selected input lines" บน TaxEvent, ไม่มีช่อง carry-forward (ยอดภาษีซื้อยกมา/ยกไป), ไม่มี amendment/lineage chain ระหว่างงวด — ที่มีคือ 9 summary boxes + reconciliation runs เท่านั้น
2. ไม่มี layout ช่องแบบ/ใบแนบ ภ.ง.ด.3/53 (มีแค่ payee grouping ใน `wht-report.logic.ts`) — ไม่มีเลขลำดับใบแนบ
3. ไม่มีโค้ดยื่น/ส่งแบบใด ๆ — `filedAt/filedManuallyAt` เป็น manual marks (**ถูกต้องตาม non-goal — ต้องคงไว้แบบนี้**)
4. ไม่มี approval queue / entry preview UI สำหรับนักบัญชี (P21 ข้อ 1)

### 1.3 Gap register

| ID | ปัญหา | แก้ใน |
|---|---|---|
| P21-01 | ไม่มี PP30 workpaper package ครบองค์ประกอบตาม OS spec §12.3 | F-TAX-1 |
| P21-02 | ไม่มี form-box/attachment layout ภ.ง.ด.3/53 | F-TAX-2 |
| P21-03 | ไม่มี accountant review queue / entry preview UI | F-TAX-3 |
| P21-04 | กติกา copy "เตรียมข้อมูล ≠ ยื่นแบบ" ยังไม่ถูกบังคับเป็นข้อกำหนดของทุกหน้าจอใหม่ | F-TAX-4 |
| P21-FIN-01 | `money()` ใน tax.summary ใช้ `Number(...)` float (`get-tax-summary.use-case.ts:23-26`) ต่างจากเส้น Decimal ที่อื่น | แก้เป็น Decimal เมื่อแตะไฟล์นี้ในงาน F-TAX-1 |

## 2. หลักการที่ห้ามละเมิด

1. **"ระบบเตรียมข้อมูล" ≠ "ระบบยื่นแบบ"** — ห้ามแสดงว่ายื่นแล้ว/กรมสรรพากรรับแล้วถ้าไม่มีหลักฐานจริง (แผนหลัก P21 ข้อ 3 คำต่อคำ)
2. Manual-first คงเดิม: FILED/PAID คือการบันทึกด้วยมือพร้อมหลักฐานแนบ — **ห้ามเพิ่มโค้ดยื่นอัตโนมัติ/e-Tax ใน scope นี้** (NOT MVP ตาม `tax-2026-verified-rules.md`; capability separation ตาม OS spec §12.6)
3. เงินทุกเส้นเป็น Decimal — ห้ามเพิ่มเส้น float ใหม่ และต้องปิด P21-FIN-01 เมื่อแตะไฟล์นั้น
4. Schema เปลี่ยนแบบ **additive เท่านั้น** — ห้าม rename/ลบ field เดิมของ `TaxEvent`/`TaxPeriod`
5. Snapshot ของงวดที่ FILED ต้อง immutable; แก้หลัง FILED = เดินทาง AMENDED + amendment chain เท่านั้น; period lock ที่บังคับอยู่ (`tax_period_locked`) ห้ามอ่อนลง
6. Workpaper ส่งออกผ่านเส้น tax filing-packages (perm `tax.report.export`) เท่านั้น — ห้ามผ่าน generic reports engine ซึ่งรับ CSV เท่านั้น (`report.use-cases.ts:615-618`)
7. ทุกตัวเลขใน workpaper ต้อง trace กลับได้: บรรทัด register → `TaxEvent` → `sourceType/sourceId/sourceLineId` — ห้ามผลิตตัวเลขที่ตรวจย้อนไม่ได้
8. แบบฟอร์มเป็นข้อมูล versioned: package ต้องบันทึก `formCode`, `formEffectiveFrom`, source URL, retrieved-at และ checksum ของ fixture/layout; ห้ามอ้าง layout จาก PDF เก่าเมื่อหน้าแบบทางการเปลี่ยน

## 3. ขอบเขต

### F-TAX-1 PP30 workpaper package (ครบทุกองค์ประกอบตาม OS spec §12.3)

1. **Output register + input register**: รายบรรทัดจาก `TaxEvent` ของงวด (VAT_OUTPUT/VAT_INPUT/VAT_EXEMPT + องค์ประกอบตาม membership PP30 ⊃ {VAT, IMPORT_VAT, PP36_INPUT} `tax-reconciliation.logic.ts:52`) — ภาษีซื้อแยกกลุ่ม eligible/pending/non-creditable จาก `claimabilitySnapshot`; **เลขลำดับบรรทัดกำหนดตอน export ภายใน snapshot ไม่เก็บลง DB** (การตัดสินใจแบบ additive-minimal)
2. **Selected input lines**: field additive บน `TaxEvent` — `selectedInReturn` (boolean) + `returnPeriodKey?` สำหรับกรณีใช้สิทธิภาษีซื้อคนละงวดกับ `eventDate`; รายการที่เลือกถูก freeze เป็น list ใน snapshot ตอนออก package; เงื่อนไข/เพดานทางกฎหมายของการยกใช้ข้ามงวด ยึด rule pack + ผู้เชี่ยวชาญ (ตรวจตอน implement — ห้าม hardcode จากความจำ)
3. **Carry-forward**: field additive บน `TaxPeriod` เก็บยอดภาษีซื้อยกมา (ยอดยกไปคำนวณจาก box9) — ชนิด satang int หรือ Decimal(18,4) ให้ชี้ขาดตามแบบแผนของโมดูลตอน implement
4. **Adjustments**: ใช้ `TaxAdjustment` ชนิด CORRECTION เดิม แสดงเป็น section หนึ่งของ workpaper
5. **Summary boxes**: ใช้ `aggregatePp30Boxes` เดิมทั้ง 9 ช่อง — ก่อนออก package ต้อง reconcile ว่า Σ register ตรงกับทุกช่อง
6. **Branch/scope snapshot**: บันทึกขอบเขตสาขา/กิจการที่ใช้คำนวณลงใน snapshot (แหล่งข้อมูลสาขา — ตรวจตอน implement)
7. **Artifact**: ออกผ่าน `buildTaxExportArtifact` ครบ 4 format (REVIEW_JSON/CSV/XLSX/PDF) + checksum; เก็บเป็น `TaxFilingPackage` + `TaxReportSnapshot` ของเดิม
8. **Reviewer sign-off**: ใช้ transition ไปสถานะ REVIEWED ของ `TaxPeriodStatus` เดิม + บันทึกชื่อผู้ตรวจ (named reviewer) ลง audit
9. **Submission/payment evidence**: ใช้ `mark-filed` `:133` / `mark-paid` `:165` เดิม + attachment หลักฐาน; ถ้อยคำบนจอตาม F-TAX-4
10. **Amendment chain**: เพิ่ม `amendmentOfPeriodId?` additive บน `TaxPeriod` (สถานะ AMENDED มีอยู่แล้ว) — งวดยื่นเพิ่มเติมชี้กลับงวดเดิม, snapshot เดิมห้ามแก้, package ใหม่อ้างถึง package เก่า

ลำดับการปิดงวดหนึ่งงวด (ประกอบจาก route เดิมทั้งหมด — ไม่มี endpoint ยื่นแบบใหม่):

1. `POST tax/sync` (`:68`) → เหตุการณ์ภาษีของงวดครบ
2. เคลียร์คิว review-issues (F-TAX-3) จนไม่มีรายการค้าง
3. `POST vat-report` (`:88`) recompute → reconciliation run ล่าสุดผ่าน
4. Preview workpaper บนจอ F-TAX-3: register ขาย/ซื้อ + boxes + carry-forward + adjustments
5. Sign-off → transition REVIEWED พร้อมชื่อผู้ตรวจใน audit
6. `POST filing-packages` (`:178`) → artifact + snapshot immutable (checksum)
7. ผู้ใช้ไปยื่น/ชำระนอกระบบเอง → `PATCH mark-filed` / `mark-paid` + แนบหลักฐาน (ถ้อยคำตาม F-TAX-4)

### F-TAX-2 ใบแนบ ภ.ง.ด.3/53 (form-box + attachment layout)

- ต่อยอดจาก `groupWhtEvents` `:58` (กลุ่ม payeeName|payeeTaxId|incomeCategoryCode|whtRate พร้อม certificateNumbers + taxEventIds ที่รวมไว้แล้ว) → จัด layout ช่องแบบ + ใบแนบรายผู้ถูกหัก + **เลขลำดับใบแนบกำหนดตอน export** เช่นเดียวกับ F-TAX-1
- กติกาเดิมต้องคงและกลายเป็น gate: income base = withheld/(rate/100) และคืน null เมื่อ rate ผิด (`deriveWhtIncomeBase` `:40`), ยอด 50ทวิ↔ใบแนบต้องตรงกัน (`:29-38`), `validateCertificateTotals` `:105` เป็น blocking gate ก่อนออก package
- mapping ช่องแบบทางการจริง ทำจาก fixture ไฟล์จริงของนักบัญชี (คำถาม Owner ข้อ 3)
- ส่งออกทางเดียวกับ F-TAX-1: `buildTaxExportArtifact` 4 format ผ่านเส้น filing-packages — ไม่มี exporter แยกของ WHT

### F-TAX-3 Accountant review queue (แผนหลัก P21 ข้อ 1)

- ต่อยอด review-issues routes ที่มีแล้ว (`tax.controller.ts:108-115`) + `TaxWorkspacePage.tsx`: **approval queue** (คิวรายการรอตรวจของงวด), **entry preview** (ดู TaxEvent/journal ก่อนอนุมัติ ผ่าน deep link `sourceType/sourceId/sourceLineId`), **reasoned override** (บังคับกรอกเหตุผล + audit), **reversal**, **closed-period handling** (งวด FILED|PAID|CLOSED แก้ตรงไม่ได้ — UI ต้องเสนอทาง AMENDED/CORRECTION แทน ให้ตรงกับ lock ฝั่ง backend ที่บังคับอยู่แล้ว)
- กติกา UI ตาม [ledger spec §F-LED-7](mangmee-income-expense-ledger-spec-th.md) ทุกข้อ: บอกก่อนกด ไม่ให้กดแล้ว error, loading/error/permission states ครบ
- ใช้ permission เดิม (`tax.report.recompute`, `tax.filing.mark_filed/paid`, `tax.report.export`); จะเพิ่ม perm ใหม่สำหรับ approve/override หรือไม่ — ตรวจตอน implement

### F-TAX-4 กติกา copy "เตรียมข้อมูล ≠ ยื่นแบบ" (บังคับทุกหน้าจอ/เอกสารที่ scope นี้สร้าง)

- สถานะ FILED/PAID ต้องแสดงเป็น "บันทึกว่ายื่น/ชำระแล้ว**ด้วยมือ** พร้อมหลักฐานแนบ" ตาม pattern `RECORDED_EXTERNAL` ("ระบบไม่ได้ยื่นหรือยืนยันการรับแบบ")
- **ห้าม**ใช้ถ้อยคำ "ยื่นแล้ว/กรมสรรพากรรับแล้ว" โดยไม่มีหลักฐานช่องทางจริงแนบ; ห้าม claim ความสามารถ e-Tax (OS spec §12.6 capability separation)
- ใช้กับทุก surface ที่กล่าวถึงสถานะงวด: หน้า workpaper/queue, ไฟล์ PDF/export ของ package, และข้อความแจ้งเตือนใด ๆ

## 4. สิ่งที่ไม่ทำในรอบแรก

- ยื่นแบบอัตโนมัติ / เชื่อม e-Tax หรือ e-Filing ทุกชนิด และคำแนะนำทางกฎหมาย (NOT MVP ตาม `tax-2026-verified-rules.md`)
- Workpaper ภ.ง.ด.50/51 (CIT) — คงไว้แค่ `cit-calendar` `:241` ตามขอบเขต MVP
- เครื่องมือแก้ย้อนหลังงวดที่ FILED นอกเส้นทาง AMENDED/CORRECTION
- เก็บเลขลำดับบรรทัด register/ใบแนบลง DB (กำหนดตอน export เท่านั้น)
- แตะ generic reports engine หรือเพิ่ม dataset ใหม่ใน report-catalog สำหรับ workpaper
- เปลี่ยนพฤติกรรม PP36/CUSTOMS นอกเหนือจากส่วนที่ไหลเข้า ภ.พ.30 ตาม membership เดิม (`tax-reconciliation.logic.ts:52`)

## 5. Gates + tests (ยกจาก "หลักฐาน" ของ OS implementation plan ช่วง P10)

1. **Fixtures เทียบแบบทางการ + named tax expert sign-off** — golden cases ต่อฟอร์ม ลงนามโดยนักบัญชี/ผู้เชี่ยวชาญที่ระบุชื่อ (ตาม [OS implementation plan P10](../plans/mangmee-accounting-os-implementation-plan-th.md))
2. **Source-to-form**: Σ บรรทัด register = ทุกช่องของ `aggregatePp30Boxes` (ผูกกับ reconciliation run ล่าสุดตาม `generate-tax-filing-package.use-case.ts:32-36`)
3. **Form-to-ledger reconcile** ผ่านเส้น `transaction-tax-reconciliation` เดิม — ยังต้องปฏิเสธ event นอก functional currency (`:278-284`)
4. **Filed snapshot immutable**: แก้ TaxEvent หลัง FILED ต้องโดน `tax_period_locked` ทุกทางเข้า; checksum ของ snapshot เดิมไม่เปลี่ยน; export ซ้ำจาก snapshot เดิมให้ checksum เดิม
5. **Amendment lineage**: งวด AMENDED ชี้กลับงวดเดิมผ่าน `amendmentOfPeriodId`, ไม่มีการเขียนทับ package เก่า
6. **Carry-forward ต่อเนื่อง**: ยอดยกไปของงวด n = ยอดยกมาของงวด n+1 (self-check ต่อ chain)
7. **WHT gate**: `validateCertificateTotals` + กติกา 50ทวิ↔ใบแนบตรงกัน (`wht-report.logic.ts:29-38`) เป็น blocking gate ของ package ภ.ง.ด.
8. **P21-FIN-01 ต้องปิดก่อนเปิดใช้**: เส้นเงินใน tax.summary เป็น Decimal ทั้งหมด

## 6. ตรวจตอน implement (สิ่งที่หลักฐานปัจจุบันยังไม่ชี้ขาด)

1. ชื่อ/ชนิด field additive สุดท้าย: `selectedInReturn`/`returnPeriodKey` บน TaxEvent; ช่อง carry-forward บน TaxPeriod (satang int vs Decimal(18,4))
2. เงื่อนไข/เพดานกฎหมายของการใช้สิทธิภาษีซื้อข้ามงวด — ยืนยันกับ rule pack + ผู้เชี่ยวชาญที่ลงนาม
3. แหล่งข้อมูล branch/scope snapshot (โครงสาขาของบริษัทในระบบตอนนี้มีแค่ไหน)
4. mapping ช่องแบบ ภ.พ.30/ภ.ง.ด.3/53 ทางการ ↔ fixture ไฟล์จริงจากนักบัญชี (รอคำตอบ Owner ข้อ 3); source of truth เริ่มที่ [หน้ารวมแบบแสดงรายการภาษีของกรมสรรพากร](https://www.rd.go.th/7049.html) ซึ่งระบุปรับปรุงล่าสุด 28-02-2026 และมีทั้ง ภ.พ.30/ใบแนบ ภ.พ.30 — ตอน implement ต้องดาวน์โหลดจากลิงก์ปัจจุบันและเก็บ checksum ห้าม pin URL เอกสารเก่าโดยไม่ตรวจ effective date
5. ต้องมี permission ใหม่สำหรับ approve/reasoned override ใน F-TAX-3 หรือ perm ชุดเดิมพอ
6. กลไก freeze "selected input lines" (flag บน TaxEvent + list ใน snapshot) ต้องรองรับ re-export ซ้ำโดยผลลัพธ์ deterministic
7. รูปแบบเลขลำดับบรรทัด/ใบแนบให้ตรงกับแบบแนบทางการ (ต่อฟอร์ม ต่อหน้า หรือต่อทั้งงวด)

## 7. หน้าจอ (กติกา F-LED-7 ทุกข้อ)

- S1 หน้า workpaper ต่องวด — tab: register ขาย / register ซื้อ (eligible/pending/non-creditable) / boxes + carry-forward / adjustments / หลักฐานยื่น-ชำระ — ต่อยอด `TaxWorkspacePage.tsx` ไม่สร้างหน้าใหม่จากศูนย์
- S2 คิวตรวจของนักบัญชี: รายการรอตรวจ + entry preview + reasoned override + reversal (F-TAX-3)
- S3 จอใบแนบ ภ.ง.ด.3/53 + สถานะ gate "50ทวิ↔ใบแนบตรงกัน" ก่อนออก package (F-TAX-2)
- S4 ถ้อยคำสถานะงวดทุกจอเป็นไปตาม F-TAX-4 — รายละเอียด wireframe เขียนในแผนส่งมอบตอนเข้าคิว

## 8. คำถามที่ Owner ต้องตอบ

1. **นักบัญชี/ผู้เชี่ยวชาญภาษีที่จะลงนาม golden cases + rule packs คือใคร** (ทวงคำถามเดิมจากแผนหลัก §11 ข้อ 3 — เป็นเงื่อนไขของ gate ข้อ 1)
2. **ลำดับ P21 ในคิว**: คงไว้หลัง P15-P17 ตามแผน หรือดึงขึ้นเมื่อบริษัทนำร่องต้องยื่นแบบจริง
3. **ขอตัวอย่าง workpaper ที่นักบัญชีใช้ยื่นจริงปัจจุบัน 1 ชุด** เป็น fixture ตั้งต้น — รูปแบบไฟล์จริงสำคัญกว่ารูปแบบที่เราคิดเอง
