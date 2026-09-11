# Draft: migrate เลข EXP และ E2E ย้อนกลับของรายจ่าย–ใบแทน–ใบเบิก

Latest: [implementation plan](expense-running-number-implementation-2026-09-11-th.md), [local verification and release limits](../qa/evidence/expense-running-number-implementation-2026-09-11/README.md).

Historical follow-up 2026-09-11: มี [ผลพิสูจน์บน local clone](../research/expense-running-number-proof-2026-09-11-th.md) และ [spec รอพัฒนา](../specs/expense-running-number-flowaccount-spec-th.md) แล้ว ข้อความ “ยังไม่ได้รัน” ด้านล่างเป็นสถานะตอนร่างเอกสารนี้ ไม่ใช่สถานะล่าสุดทุกกรณี
วันที่: 2026-09-11
Status: HISTORICAL DESIGN. Implementation authorized and locally verified; current plan/evidence supersede waiting-state statements below.
Parent audit: `docs/research/expense-running-number-flowaccount-impact-audit-2026-09-11-th.md`

## ขอบเขตที่ผู้ใช้เพิ่ม

ต้องคิดทั้งข้อมูลเดิมที่จะ migrate และการย้อนดู/ย้อนแก้ไขของรายจ่าย ใบแทนใบเสร็จ และใบเบิกที่ผูกกันอยู่ ไม่ใช่ทดสอบเฉพาะสร้างเอกสารใหม่จนจ่ายสำเร็จ

ยังไม่เขียน migration SQL ของ feature นี้ ไม่ backfill ข้อมูลผู้ใช้ ไม่เปลี่ยน business state และไม่ deploy

## ความสัมพันธ์ที่ต้องรักษา

```text
รายจ่ายต้นทาง (expense ID, EXP อาจยังไม่มี)
  ├─ ใบแทน SRC: evidence ID + version + snapshot + ลายเซ็น/ไฟล์
  └─ บรรทัดใบเบิก RB: linkedExpenseId + sourceExpenseSnapshot
       └─ รายจ่ายจากการเบิก: sourceReimbursementRequestId + sourceReimbursementLineId
            └─ การลงบัญชีและสถานะจ่ายที่สะท้อนจาก ReimbursementPayment
```

หนึ่งใบเบิกมีหลายบรรทัดและอาจมีต้นทางต่างเดือนกัน เลข RB เป็นของใบเบิก, SRC เป็นของใบแทน, EXP เป็นของรายจ่ายแต่ละ identity ห้ามทำให้เป็นเลขชุดเดียวหรือใช้ prefix เพื่ออนุมานความสัมพันธ์

สำหรับ source-backed claim ใน baseline ปัจจุบัน `linkedExpenseId` อ้างต้นทางที่เลือก ส่วนรายจ่ายจากการเบิกมี identity แยกด้วย source request/line tuple สำหรับข้อมูล legacy บางชุด `linkedExpenseId` เคยใช้ผูก projection โดยตรง จึงต้องจำแนกตาม provenance/schema ก่อนตีความ

เลขมนุษย์อ่านได้ไม่ใช่ primary key และ `lineNo` ไม่ใช่ durable line ID การจัดเรียง/แก้บรรทัดต้องไม่ทำให้ source tuple ของรายจ่ายที่เกิดไปแล้วชี้อีกบรรทัดหนึ่ง

## ข้อเท็จจริงจาก code/doc ที่ตรวจเพิ่ม

ตรวจ baseline commit `a3bfed76309a207d242b9aa27bc6b11b4f9077e4` ใน `/tmp/mangmee-substitute-editable-navigation-20260910` ซึ่งรวม source-consistency feature แล้ว root checkout เก่ากว่าในส่วนนี้ จึงไม่ใช้ root เพียงชุดเดียวตัดสิน flow ปัจจุบัน

| ข้อเท็จจริง | ความหมายต่อเลข EXP ใหม่ |
| --- | --- |
| `MaterializeClaimExpensesService` สร้าง employee-payable projection แยกจาก source; repository unique ตาม company/source line | ออก EXP ให้ identity ที่ถูกต้อง ไม่ reuse EXP ต้นทาง และไม่สร้าง projection ซ้ำเพียงเพราะยังไม่มีเลข |
| Source snapshot v1 เก็บ expense ID/revision, วัน, ยอด, tax facts, เลขบิลร้านค้า และ SRC ID/เลข/version/checksums แต่ยังไม่ได้เก็บ internal EXP | เติม EXP ลง live record อย่างเดียวต่างจากเพิ่ม EXP ลง retained snapshot; อย่างหลังเปลี่ยน hash/strict source comparison ต้องออกแบบ version compatibility |
| Submit/approval/payout ตรวจ source facts กับค่าที่ตรึงไว้; `expenseUpdatedAt` เป็น draft-selection token แต่หลัง submit ไม่นำ timestamp เดี่ยว ๆ มาถือว่าข้อเท็จจริงเปลี่ยน | migration ไม่ควรทำให้คิวอนุมัติทั้งชุด stale เพราะเพิ่ม display reference; draft ที่เปิดค้างต้องมี refresh โดยรักษาข้อมูลผู้ใช้ |
| Submitted claim ล็อก source ผ่าน funding guard รวมไฟล์ที่อ้างต้นทางเดียวกัน | ใช้ปุ่ม Back เปิดไปดูไม่ได้แปลว่า source แก้ไขได้; numbering/backfill ห้าม bypass guard |
| Rejected reimbursement เปิดเป็น DRAFT ได้โดยคง requestNo และ reset approval/signature state; finance NEEDS_INFO มี flow คืนแก้ | ทดสอบด้วย RB เดิมและการรับรองใหม่ ไม่สร้างเลขใหม่เพราะ resubmit และไม่ถือว่า APPROVED/PAID ทุกใบกลับร่างได้ |
| Cancel ใช้ cancellation intent ก่อน terminalize projections แล้วจึง complete; posted projection ต้อง reversal ตามเงื่อนไขเดิม | ล้มกลางทางต้องกลับมาทำต่อได้ ไม่แสดง cancelled สำเร็จทั้งที่ projection ยัง active และไม่คืน EXP ระหว่าง retry |
| Reimbursement payout สะท้อน PAID ไปยัง CONFIRMED projections โดยไม่สร้าง ExpensePayment อีกแถว; void payout ย้อนสถานะสะท้อนนี้ | migration/E2E ห้ามสร้าง payment ซ้ำทั้งฝั่งใบเบิกและรายจ่าย และต้องแยกเงินที่พนักงานจ่ายร้านจากเงินบริษัทคืนพนักงาน |
| ใบแทน digital สำหรับเบิกต้อง ISSUED/PERSONAL_ADVANCE และ payerUserId ตรง requester; ผู้ลงชื่อบน paper ที่ยังไม่ผูกบัญชีเป็น scope ที่ยังไม่ตกลง | ห้าม migrate โดยเดาว่าผู้อัปโหลด/ชื่อที่เหมือนกันคือผู้รับเงินคืน และไม่เปิด eligibility เพิ่มด้วย feature เลข |

## Migration cohorts: ห้าม backfill ทุก DRAFT แบบเหมารวม

| กลุ่มข้อมูลเดิม | พฤติกรรมที่เสนอ | สิ่งที่ห้ามเปลี่ยน |
| --- | --- | --- |
| A: มี EXP แล้ว ทุกสถานะ | คงเลข ตรวจ owner/ทะเบียนเลขให้ตรง ถ้าไม่ตรงให้รายงานเพื่อซ่อมตามหลักฐาน | EXP, วันที่ออกเลขเดิม, ID, SRC/RB, สถานะธุรกิจ |
| B: raw upload/OCR/วันที่เอกสารยังไม่รับรอง ไม่มี EXP | เก็บรับเข้าและเปิดทำต่อได้ รอจุดบันทึกร่างที่ตกลงไว้ | ห้ามใช้วันที่ placeholder ออกเลขย้อนหลังอัตโนมัติ |
| C: ร่างตรวจวันที่แล้ว ไม่มีเลขและไม่มี frozen/issued/active claim dependencies | แนะนำรับเลขเมื่อบันทึกครั้งต่อไปภายใต้ writer ใหม่ หากจะ bulk assign ต้องมีขอบเขตและการอนุมัติชัดเจน | ยอด/ภาษี/ไฟล์/วันเอกสาร/branch/ผู้สร้าง |
| D: ไม่มี EXP แต่มีใบแทนพิมพ์หรือเซ็นแล้ว, คิวใบเบิก, source snapshot, export ที่ต้องเก็บอ้างอิง | แยกเป็น dependency-sensitive cohort; ไม่เติมเลขแล้ว rewrite เอกสารอัตโนมัติ กำหนดการแสดงเลขใหม่ข้างประวัติเดิม หรือคง legacy จนถึง flow แก้ไขที่อนุญาต | ไฟล์เก่า bytes/checksum, SRC version, ลายเซ็น, approval hash, ผู้จ่าย/ผู้รับเงินจริง |
| E: CONFIRMED/PAID/POSTED/VOIDED เก่าที่ไม่มี EXP | คงสถานะอ่านได้และแสดง legacy reference; historical numbering ต้องแผนแยก | ห้ามย้อนเป็นร่างหรือเรียก confirm เพื่อให้ได้เลข |
| F: รายจ่ายจากใบเบิกสร้างแล้วแต่ orchestration ค้าง/ยังไม่มีเลข | resolve จาก company+request ID+line ID เดิม; resume ที่ขั้นค้างด้วย idempotency ของเดิมและกฎ cutover | ไม่สร้าง projection ใหม่ ไม่ overwrite `linkedExpenseId` ของ source-backed line |
| G: เลข RESERVED/CANCELLED/VOIDED/owner ถูกลบ หรือเลขขาด | เก็บ allocation history; reconciler จำแนก reserved ที่ค้างจากงานจริงกับเลขสิ้นสุดโดยอ้างหลักฐาน | ไม่ลด counter ไม่เอาเลขกลับมาใช้และไม่ลบ ledger ของเลข |
| H: source link ขาด/หลายแถวตรงกัน/ข้ามบริษัท/line parent ผิด | dry-run ต้องรายงานแถวและเหตุผล; หยุด cohort ที่ผิดให้ผู้ดูแลซ่อมอย่างมีหลักฐาน | ไม่จับคู่จากยอด วันที่ ชื่อ เลข EXP/SRC/RB หรือเลือกแถวแรก |

สถานะ DRAFT อย่างเดียวไม่ยืนยันว่า “ยังไม่เคยมีคนเซ็นหรือใช้เอกสารนี้” โดยเฉพาะรายจ่ายต้นทางที่มี SRC และใบเบิกอยู่แล้ว

## แผน cutover และ rollback ที่ต้องพิสูจน์

1. **Inventory บนข้อมูลสำเนาที่อนุญาต** — จำแนก A–H ต่อ company/branch/month พร้อมจำนวน row, source/projection tuples, ประวัติเลข, counter, outstanding/payment totals, journal totals และ checksum ของเอกสารที่เก็บอยู่ สำรวจ migrations ที่ใช้จริงก่อน ห้ามสมมติว่า environment ตรงกับ root checkout
2. **Dry-run** — สร้างรายการการเปลี่ยนที่คาดไว้แบบไม่เขียน: ID, เลขเดิม, ที่มาของเดือน, เหตุผลที่จะ assign/skip/block, dependencies; เปรียบเทียบกับทะเบียนเลขที่เคยใช้ทั้งหมด ไม่ใช้ `MAX` ของเลขที่ยัง active แล้วเริ่มใหม่
3. **รองรับข้อมูลทั้งเก่าและใหม่ก่อนเปิดออกเลขร่าง** — reader รับ null EXP/เก่า/ใหม่ได้; confirm writer และ workers ต้องรักษาเลขที่มีแล้ว; ตรวจ old browser session และ queued jobs ด้วย อาจไม่ต้องเพิ่ม column สำหรับ EXP เพราะมี nullable column อยู่แล้ว ให้เปลี่ยน schema เท่าที่ spec ใหม่ต้องใช้จริง
4. **ทำ schema/data changes ที่จำเป็นแบบเพิ่มก่อน** — ไม่ลบ field/FK หรือเปลี่ยน stable ID; ไม่แก้ migration เก่าที่ apply แล้ว; run ผ่าน migration history ปกติ งาน data backfill แยกต้อง resume/replay ได้และไม่ออกเลขเพิ่มเมื่อรันซ้ำ
5. **เปิด writer ใหม่เมื่อทุกเส้นทางเข้ากันได้** — ทั้ง manual/upload/LINE/projection ใช้ policy เดียวกัน ตรวจ batch/counter race ต่อเดือนและ company; เปลี่ยน cutover ไม่เปลี่ยนเดือนของเลขเดิม
6. **Post-check** — ตรวจ invariants ด้านล่างและ E2E บนชุดข้อมูลที่ migrate แล้ว; เฉพาะการอ่านหน้า detail ผ่านยังไม่พอ อนุมัติ/จ่าย/กลับรายการและ background jobs ต้องผ่านจริงด้วย
7. **Rollback rehearsal** — ปิดการออกเลขร่างใหม่ได้แต่รักษาเลขที่ออกสำเร็จไปแล้ว และกลับไปใช้ writer รุ่นที่ผ่าน compatibility แล้วเท่านั้น โค้ดเก่าที่ confirm แล้วออกเลขใหม่เสมอเป็น rollback target ที่ใช้ไม่ได้หลัง cutover
8. **Fail ระหว่าง migrate** — retry จาก checkpoint เดิม ต้องไม่เพิ่มเลข/เปลี่ยน snapshotซ้ำ; ไม่ restore DB ทับ transaction ธุรกิจที่เกิดหลัง cutover การกู้คืนจริงต้องวาง reconciliation ตามช่วงข้อมูล ไม่ใช้ลด counter เป็นทางถอย

ก่อนมีการเปลี่ยน cloud/release จริงให้ใช้ runbook ที่ repository บังคับในเวลานั้น แผนนี้ไม่ได้อ่านสถานะ deployed หรือเปลี่ยน release/customer gates ใด ๆ

### Invariants ก่อน–หลัง migration

- EXP/SRC/RB ที่มีอยู่ต้องเท่าเดิม; primary IDs, tenant/branch, source links และ owner ของเลขไม่เปลี่ยนโดยไม่มี remediation ที่อนุมัติ
- source line หนึ่งมี projection ได้ไม่เกินหนึ่งตามกฎเดิม; source-backed line ยังชี้ต้นทางเดิม ไม่ชี้ projection แทน
- retained snapshot/approval hash/signature/ไฟล์ต้นฉบับ checksum เดิมไม่เปลี่ยนเพราะ numbering migration; เก็บ version compatibility หากมี reference field ใหม่
- ยอดรายจ่าย/ยอดใบเบิก/paid/outstanding/จำนวน payment/journal/tax facts เท่าเดิม การเพิ่มเลขไม่ทำให้เกิด outbox ธุรกิจประเภท confirm/pay/void/sign
- รายจ่ายที่เป็นหลักฐานของการสำรองจ่ายกับ projection แยกกัน ไม่มีการย้ายการรับรู้บัญชีหรือทำต้นทางเป็น PAID เพียงเพราะบริษัทคืนเงินพนักงาน
- counter ไม่ถอยและไม่ชน retained allocation; replay migration/backfill ไม่เพิ่มเลขหรือตัดเลขซ้ำ
- เอกสารเก่ายังเปิด ค้น และใช้ลิงก์เดิมได้; cancelled/voided/superseded ยังคงสถานะและข้อจำกัดเดิม

## E2E ย้อนกลับหลัง migrate

ต้องทดสอบข้อมูลเก่า A–H, ข้อมูลสร้างใหม่ และใบเบิกที่รวม source เก่า+ใหม่ในใบเดียว ทั้ง mobile และ desktop ใช้ backend/DB/file storage จริงสำหรับ acceptance ของความสัมพันธ์

| กรณี | ขั้นตอน | Assertions ปลายทาง |
| --- | --- | --- |
| L01 ย้อนดูอย่างเดียว | SRC step3→2→1→2→3, เปิด EXP→RB→source แล้ว Back | ID/เลข/ข้อมูล/ไฟล์/ลายเซ็นและ approval state ไม่เปลี่ยน ไม่มี save/number allocation เพราะแค่ navigation |
| L02 แก้ก่อนเซ็น | ร่างที่มี SRC PREPARED ย้อน step1 แก้วัน/ยอด บันทึก แล้วกลับ step3 | ใช้ EXP เดิม; SRC ตาม correction policy เดิม; preview ล่าสุด; แบบเก่าที่ invalidated เซ็น/อัปโหลดต่อไม่ได้; no-op save ไม่ reset โดยไม่จำเป็น |
| L03 ใบเบิกยังร่างและ source เปลี่ยน | เลือก SRC/EXP ไว้ใน RB draft → แก้ source ได้ตามสถานะ → กลับ RB | แสดง source stale; refresh แบบชัดเจน รักษาข้อความผู้ใช้ที่แก้ได้ อัปเดตเฉพาะ facts ต้นทาง คง RB ID/เลข ไม่อนุมัติข้อมูลเก่า |
| L04 ใบเบิกส่งแล้ว source ถูกล็อก | submit RB → เปิดย้อน source/SRC ลองแก้/ลบ/เปลี่ยนเลข/ทำฉบับใหม่ | server ปฏิเสธตาม guard และมีทางไปใบเบิกที่ล็อกอยู่; ไม่มี side effect จาก request ที่ถูกปฏิเสธ |
| L05 ปฏิเสธ/ขอข้อมูลเพิ่ม | reject หรือ finance NEEDS_INFO → คืนร่างตาม flow ที่รองรับ → refresh source → ตรวจ/ลงชื่อ/submit ใหม่ | RB เดิม, EXP เดิมที่มีอยู่, approval hash ใหม่ตาม facts ที่เปลี่ยน; signatures/ack เดิมไม่ใช้อนุมัติชุดใหม่; ไม่สร้าง projection ซ้ำ |
| L06 ดึงต้นทางออก/เปลี่ยนต้นทาง | RB draft unlink source เดิม → เลือกใหม่/ยกเลิกการแก้/โหลดใหม่ | ล้าง source-owned facts/files พร้อมกัน; ไม่ลบ source expense/SRC จริง; cancel edit คืนค่าที่บันทึกเดิม; ไม่มี dangling links |
| L07 สร้าง projection หลายบรรทัด | RB มี source ส.ค.+ก.ย. → อนุมัติ/finance → response หาย → retry | projection ต่อ line เดิมอย่างละหนึ่ง EXP; เดือน EXP แต่ละ projectionอิงวันของบรรทัดตาม policy ใหม่ ไม่ใช้วันที่ header ของ RB เหมารวม |
| L08 ยกเลิกหลังมี projection แต่ยังไม่จ่าย | เริ่ม cancel → ล้มหลังจัดการบาง projection → retry | คง cancellation pending จนทุก projection จัดการครบ; posted ใช้ reversal ตาม policy/period lock; EXP/SRC/RB ไม่ถูกนำกลับมารันใหม่ |
| L09 จ่ายแล้วกลับรายการ | จ่ายคืน RB → retry → void payout พร้อมเหตุผล → retry void | ReimbursementPayment ไม่ซ้ำ; ไม่มี ExpensePayment ซ้ำ; projected paid/outstanding กลับถูก; original source ไม่ถูกสร้างการจ่ายอีกครั้ง; journal reversal ถูกคู่และครั้งเดียว |
| L10 ยกเลิก/แก้ SRC ที่ผูกใบเบิก | RB pending/paid เทียบกับ RB rejected/cancelled และ source-only | source lock ทำงานตาม claim state; ใบแทน cancelled เป็น view-only; ห้ามเปิดแก้เพียงเพราะมี EXP ใหม่; เก็บ version/artifact history |
| L11 โพสต์แล้ว/งวดปิด | ลองย้อนแก้วัน เปลี่ยนยอด ยกเลิกจ่าย/เอกสารในงวดล็อก | ปฏิเสธหรือใช้ correction/reversal ที่อนุญาตจริง ไม่ปลอมเป็น draft; ไม่เปลี่ยนเลข/สถานะเมื่อทำไม่สำเร็จ |
| L12 คิวเก่าหลัง migrate | โหลด RB ที่ส่ง/ลงชื่อก่อน migrate แล้ว approve/pay หลัง migrate | hash v1 ยังคงตรวจได้ ถ้า facts ไม่เปลี่ยนต้องไม่ stale เพียงเพราะเพิ่มเลข; snapshot version ใหม่ไม่ bypass source change ที่แท้จริง |
| L13 browser/worker เก่าค้าง | เปิดฟอร์มก่อน cutover → migrate → save/retry ผ่าน writer ที่รองรับ | ยังคง facts/typed data หรือแจ้ง refresh ได้ชัดเจน; ไม่ overwrite EXP/ออกเลขซ้ำ; worker เก่ารันไม่ได้ถ้าไม่ผ่าน compatibility |
| L14 rollback/replay | cutover→สร้างเลขใหม่→rollback compatible runtime→confirm/reopen/pay→เปิดใหม่/replay backfill | เลขเดิมทั้งหมด, counter ไม่ถอย, business events ไม่ซ้ำ และ live relations ไม่หาย |
| L15 เอกสารกระดาษ/ผู้รับเงิน | SRC paper เดิมที่มี/ไม่มี payerUserId และ finance จัดทำให้พนักงาน | ไม่เดาผู้รับเงินจากชื่อ/คนอัปโหลด; unsupported beneficiary แสดงเหตุผล; flow digital/member เดิมไม่เสีย |
| L16 การค้นและการเข้าถึง | เปิดจาก EXP/SRC/RB และ export เก่า ผู้ใช้ creator/requester/accountant/viewer คนละคน | แสดงลิงก์และเลขที่ตรงคู่เท่าที่มีสิทธิ์; กลับมาช่วง/รายการเดิม; expenses OFF + reimbursement ON ยังทำ standalone flow ที่รองรับได้ |

การย้อนดูไม่ใช่การย้อน business state ส่วนการย้อนแก้ต้องผ่าน state/permission/source lock เดิมทุกครั้ง UI ควรบอกว่า “ดูได้” หรือ “แก้ได้” และถ้าติดใบเบิกให้ระบุเลข RB กับการดำเนินการที่ทำได้ตามสิทธิ์ ไม่ส่งผู้ใช้สูงวัยไปค้นหาต้นเหตุเอง

## ขอบเขตการเก็บประวัติที่ต้องตรวจเพิ่มก่อน acceptance

SRC มีประวัติ revision และ retained artifacts แยกชัด ส่วน reopen ใบเบิกปัจจุบันล้าง signature rows และ active signed-copy links เพื่อไม่ใช้ลายเซ็นเก่าอ้างข้อมูลใหม่ ต้องพิสูจน์ด้วย fixture ว่าหลักฐานการอนุมัติ/ปฏิเสธและไฟล์ที่ต้องเก็บตามนโยบายยังตามย้อนหลังได้ ไม่สรุปว่าการล้าง active links เท่ากับการลบ bytes และไม่สัญญาว่าทุกลายเซ็นเก่ามี history UI ถ้ายังไม่ได้ตรวจจริง หากต้องเก็บ version ประวัติเพิ่มให้กำหนดเป็น scope ก่อน implement

## หลักฐานที่รันรอบนี้ และสิ่งที่ยังไม่ได้รัน

รัน baseline tests ใน worktree ข้างต้น:

```sh
node --import tsx --test \
  apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.spec.ts \
  apps/api/src/modules/reimbursements/application/services/materialize-claim-expenses.service.spec.ts \
  apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.spec.ts \
  apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.payment-mirror.spec.ts \
  apps/api/src/modules/reimbursements/application/use-cases/void-reimbursement-payment-reversal.use-case.spec.ts
```

ผล **146 passed, 0 failed, 0 skipped**; log `/tmp/expense-number-linked-audit-tests.log` เป็น pure/use-case/repository-mock baseline ไม่ใช่ migration บน DB จริง และไม่ใช่ browser E2E ใหม่

อ่าน migration เดิม `20260804170000_reimbursement_cc2_projection_source` พบ exact source-line backfill และ ambiguity preflight เป็นรูปแบบที่ควรใช้ต่อ; source snapshot migration `20260910180000_reimbursement_source_snapshot` เป็น nullable column โดยไม่สร้าง provenance ย้อนหลัง

มีชุด real-PostgreSQL compatibility/race ใน repo และหลักฐานจากงาน source-consistency ก่อนหน้า แต่ไม่ได้รัน DB/migration ใหม่ในรอบนี้ และไม่ใช้ผลเก่าอ้างว่า L01–L16 หรือ EXP policy ใหม่นี้ผ่านแล้ว Full general-ledger integration ของงานใบเบิกก่อนหน้าก็มีบันทึกว่า deferred ต้องรวมไว้ใน acceptance รอบ feature ใหม่นี้

### Code/doc anchors (baseline worktree)

- `docs/specs/reimbursement-source-consistency-spec.md`
- `docs/specs/reimbursement-cc2-projection-spec.md`
- `docs/agent-memory/reimbursement-source-consistency-2026-09-10.md`
- `apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts`
- `apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts`
- `apps/api/src/modules/reimbursements/application/services/materialize-claim-expenses.service.ts`
- `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.ts`
- `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-finance.use-case.ts`
- `apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.ts`
- `apps/api/src/modules/expenses/infrastructure/substitute-funding.guard.ts`
- `apps/api/src/scripts/production-a5-reimbursement-compatibility.pg.spec.ts`

Next: รวมข้อกำหนดนี้ใน spec/plan เลข EXP ฉบับที่จะตกลงจริงก่อน code โดยตัดสิน cohort D/E, snapshot compatibility, manual renumber scope และ rollback writer ที่ยอมรับได้
