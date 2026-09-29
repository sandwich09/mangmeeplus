# Spec: ส่วนลดจากงานขาย — QR ในงาน: ลดบิลแรกให้ร้านใหม่ และเครดิตให้ร้านเดิม

ปรับล่าสุด 2026-09-29 · **DRAFT v3 — เพิ่มมติ Owner 2026-09-29 (SD-O4–SD-O8): ผู้ซื้อเลือกใช้หรือไม่ใช้ต่อการซื้อ, ส่วนลดราคาครั้งเดียวต่อร้าน, เครดิตสำหรับร้านเดิม, QR เดียวต่อชุด, ร้านที่มีดีลรับเครดิตได้; งานนี้ออก release เดียวกับ add-on เครดิต AI และอ่านรูป. Owner รับค่าเริ่มต้นของคำถามที่เหลือใน §12 ทั้งหมด 2026-09-29 (SD-O9)**

- ฐานโค้ด: ทุก `file:line` ในเอกสารนี้ตรวจกับ develop `105b0dc6` (2026-09-29 หลัง #860 และ #862). รอบก่อนตรวจบน `8a91bc1c`; #860 เลื่อนบรรทัดใน `billing.service.ts`, `billing.controller.ts`, `billing-admin.service.ts`, `exchange-liff-session.use-case.ts`, `schema.prisma`, `billing-http-smoke.ts` และ `BillingPage.tsx` — ปรับตัวเลขแล้ว; ไฟล์อื่นที่อ้างไม่เปลี่ยน. ก่อนลงมือแต่ละ PR ยังต้องตรวจ anchor ซ้ำบน develop ล่าสุด
- เอกสารคู่กัน: [Plan](../plans/sales-event-discounts-plan-th.md) · [Audit และผลตรวจซ้ำบน develop](../research/sales-event-discounts-e2e-impact-audit-2026-09-29-th.md). Memory ของงานนี้ยังไม่มีใน repo
- เกี่ยวข้อง: [Add-on เครดิต AI และอ่านรูป](chat-credit-and-receipt-addons-spec-th.md) (ออก release เดียวกัน; เจ้าของ layout หน้า billing, ฐาน billing ร่วม และกลไกเพิ่มยอดที่เส้นทางเครดิตใช้: §5.2, §6.1, §8.2–§8.3, §16, §17) · [Sales deals](mangmee-sales-deals-and-locked-signup-spec-th.md) (§4 "ไม่มี coupon บน subscription" ใช้ต่อ) · [ซื้อแพ็กเกจได้ทันทีหลังสมัคร](mangmee-purchase-without-setup-spec-th.md) (R-A1, R-A6, R-B1, R-C1, R-C3, D-PF-5, D-PF-10/R-C11)
- รหัสของเอกสารชุดนี้ขึ้นต้น `SD-`: SD-O มติ Owner, SD-T มติเทคนิค, SD-Q คำถามถึง Owner, SD-E เกณฑ์รับงาน, SD-A ผลตรวจ — กันชนกับรหัส A/E/O/T/Q ของสเปก add-on. ชื่อ PR ของแผน (SD-A…SD-F) คนละชุดกับรหัสเกณฑ์รับงาน (SD-E01…)

## 0. สรุป

QR เดียวต่อ "ชุดส่วนลด" ออก "ส่วนลดจากงาน" หนึ่งรายการให้คนที่สแกนผ่าน LINE และผูกกับตัวตน LINE ของคนนั้น. ตอนใช้ สถานะของร้านเป็นตัวเลือกเส้นทาง (SD-O7):

- **ร้านที่ซื้อแพ็กเกจเริ่มใหม่** (ยังไม่มีแพ็กเกจ, ทดลอง, แพ็กที่ทีมงานตั้งให้ หรือหมดอายุแล้วซื้อใหม่): ลด **บิลแรก** ของการซื้อนั้น. ผู้ซื้อเลือก "ใช้" (เลือกไว้ให้แล้ว) หรือ "ไม่ใช้ครั้งนี้" (SD-O4). รอบต่ออายุชำระราคาเต็ม (SD-O1). หนึ่งร้านได้ส่วนลดราคาครั้งเดียวตลอดอายุร้าน (SD-O5)
- **ร้านเดิมที่มีแพ็กเกจที่จ่ายแล้วใช้งานอยู่**: รับ **เครดิต AI และ/หรือจำนวนอ่านรูปใบเสร็จ** เข้าร้าน ผ่านกลไกเพิ่มยอดของสเปก add-on โดยไม่แตะราคา การต่ออายุ Stripe หรือใบแจ้งหนี้ (SD-O6). ร้านที่มีดีลก็รับได้ (SD-O8)

หนึ่งรายการใช้ได้ทางเดียวและครั้งเดียว. ไม่มี coupon. ไม่มีแท็บใหม่. ส่วนลดราคาไม่ซ้อนกับดีลและไม่ใช้กับการซื้อ add-on. ใช้สิทธิ์สำเร็จเมื่อยืนยันรับเงินจริง (ส่วนลดราคา) หรือเมื่อเพิ่มยอดสำเร็จ (เครดิต). งานนี้ออก release เดียวกับ add-on และเปิด gate พร้อมกัน (§11)

## 1. มติ

### 1.1 มติ Owner (2026-09-29)

| ID | มติ | ผลต่อแบบ | finding ที่ปิด |
|---|---|---|---|
| SD-O1 | ลด **บิลแรกเท่านั้น**; รอบต่ออายุไม่ลดเลย; ไม่มี Stripe coupon บน subscription; กติกา sales-deals §4 "ไม่มี coupon บน subscription" คงเดิม | กลไกต่อโหมด §5.2; CARD_AUTO = จ่ายงวดแรกครั้งเดียวแล้วผูก subscription ราคาเต็มที่เริ่มเก็บเมื่อสิ้นงวดแรก §5.3; guard ของการต่ออายุและ grace ไม่แตะ §5.4 | SED-01, SED-02 (ไม่เกิดแล้ว), SED-07 |
| SD-O2 | ไม่ซ้อนกับดีลขาย: ร้านที่มีดีลที่อนุมัติแล้วหรือกำลังใช้ ได้ราคาดีลอย่างเดียว; โค้ด attribution ของดีล (`billing-package-request.ts`) ไม่เปลี่ยน. ใช้กับส่วนลดราคาเท่านั้น (SD-O8) | เงื่อนไขตรวจและข้อความ "มีดีลพิเศษอยู่แล้ว" §4.2 | SED-04 (ไม่เกิดแล้ว) |
| SD-O3 | กลุ่ม "สมัครใหม่ผ่านงาน" = ผู้ถือส่วนลด — Owner: "ตั๋วก็จะออกแค่คนที่ได้ qr คนที่มาจากช่องทางปกติ จะไม่ได้". QR 5 นาทีมีหน้าที่ **ออก** ส่วนลดเท่านั้น; ส่วนลดผูกกับคนที่สแกน (ตัวตน LINE); ใช้ได้หลังสมัครและเปิดร้าน จนกว่าจะหมดอายุ | ไม่ต้องจัดกลุ่มการสมัคร; วันหมดอายุ §4.4; วิธีใช้ §3.4; สิ่งที่พนักงานในร้านเห็น §3.5 | SED-08, SED-34 |
| SD-O4 | ผู้ซื้อเลือกได้ต่อการซื้อ (กลับค่าเริ่มต้นเดิมของ SD-Q6) — Owner: "เรามีให้เลือกอยู่นะ ว่าจะใช้หรือไม่ใช้ แต่ถ้าใช้ จะใช้กับบิลที่จะซื้อเสมอ". เมื่อผู้ถือมีส่วนลดที่ใช้ได้และการซื้อเข้า §4.1 หน้าแพ็กเกจแสดงตัวเลือก "ใช้ส่วนลด…" หรือ "ไม่ใช้ครั้งนี้" โดยเลือก "ใช้" ไว้ให้แล้ว. ใช้ = ลดบิลที่กำลังซื้อเท่านั้น ไม่เลื่อนไปบิลอื่นหรือรอบต่ออายุ. ไม่ใช้ = quote ราคาเต็ม และส่วนลดยังใช้ได้กับร้านอื่นหรือการซื้อครั้งถัดไปที่เข้าเงื่อนไขจนหมดอายุ | ตัวเลือกเป็นค่าของ quote ครั้งนั้นเท่านั้น (§4.3, §7.2) ไม่ใช่ selection แบบ DRAFT v1 (§1.3) | SED-40 |
| SD-O5 | หนึ่งร้านได้ส่วนลดราคาครั้งเดียวตลอดอายุร้าน (เดิม SD-Q4) — ตกลงในหลักการ; โปรโมชันสำหรับร้านเดิมตัดสินที่ SD-O6 | partial unique §6.1 | — |
| SD-O6 | โปรโมชันสำหรับร้านเดิมเมื่อมีงานใหม่ (เดิม SD-Q7) เลือกทาง (b) — Owner: "2 เลยเพราะ ดีล กับ อีเว้น แล้ว เครดิต ต้องขึ้นพร้อมกัน". ร้านที่มีแพ็กเกจที่จ่ายแล้วใช้งานอยู่ได้เครดิต AI และ/หรือจำนวนอ่านรูปใบเสร็จแทนส่วนลดราคา ผ่านกลไกเพิ่มยอดของสเปก add-on (แหล่งยอดใหม่ `SALES_EVENT`); ไม่เปลี่ยนราคา การต่ออายุ Stripe object หรือหลักฐานใบแจ้งหนี้. งานนี้กับ add-on ออกใน release เดียวกัน. ทาง (a) ใช้ดีลรายร้าน และ (c) ลดบิลต่ออายุ (ขัดกฎ no-coupon และ SD-O1 สำหรับบัตร และทำให้บัตรกับ QR ได้กติกาไม่เท่ากัน) ไม่ใช้ | §4.1, §5.6, §6, §11 | — |
| SD-O7 | QR เดียวต่อชุดใช้ได้ทั้งร้านใหม่และร้านเดิม: ชุดเก็บทั้งจำนวนเงินลดบิลแรกและเครดิตที่ให้; สถานะร้านตอนใช้เป็นตัวเลือกเส้นทาง. ทางเลือก QR แยกต่อกลุ่มไม่ใช้ เพราะยุ่งยากที่บูธ | §3.1, §4.1 | — |
| SD-O8 | ร้านที่มีดีลขายที่ยังมีผลรับเครดิตจากงานได้ เพราะไม่เปลี่ยนราคา; กติกาไม่ซ้อนของ SD-O2 ใช้กับส่วนลดราคาเท่านั้น | §4.2 | — |
| SD-O9 | Owner: “ตามค่าเริ่มต้น” — SD-Q1, SD-Q2, SD-Q3, SD-Q5, SD-Q8 และ SD-Q9 ใช้ค่าเริ่มต้นที่เสนอใน §12 | §4.1.1, §4.1.2, §4.3, §4.4, §6.1, §10, §11 | — |
| SD-O10 | **ไม่มี switch (2026-09-29)** — Owner: “อย่าทำ switch อีก เปิดไว้เลยเสมอ”; controller ตัดสินใช้กับงานนี้: ไม่มี gate `event_discounts` ไม่มี flag และไม่มี env. ส่วนลดหรือเครดิตเกิดได้เฉพาะเมื่อหัวหน้าทีมหรือแอดมินสร้างชุด ตัวชุดจึงเป็นตัวควบคุม — หยุดแจกด้วย "พักแจก", หยุดใช้ด้วย "ระงับการใช้", ตัดรายการด้วย "เพิกถอน" (§6.2, §6.3). แทนทุกที่ในสเปกและแผนนี้ที่พูดถึง `event_discounts` หรือ `SALES_EVENT_DISABLED`: §7.2 (ไม่เพิ่ม key ใน `BILLING_ACTIONS`), §7.3 (ไม่มีรหัส `SALES_EVENT_DISABLED`), §11 (ไม่มี gate ของงานนี้ให้เปิดร่วมหรือปิด; rollback ที่ยังมีรายการค้างใช้ "ระงับการใช้" ของชุดแทนการปิด gate), SD-E16 และ SD-E31 (ส่วนที่เป็น gate ของงานนี้), แผน §1, §3.7, §3.10, U17 | §6.2, §7.2, §7.3, §11 | — |
| SD-O11 | **QR ใช้ได้จนชุดปิดรับ (Owner 2026-09-29)** — Owner: “หน้าจอเซลล์และ QR อยากให้ใช้ได้ไม่หมดอายุ ให้หมดอายุตามตั๋วที่ตั้งได้ไหม เพราะบางทีอาจจะปริ้นใส่กระดาษหรือเอาขึ้นจอให้ลูกค้าสแกน”. QR ของเซลล์ไม่มีอายุ 5 นาทีอีกแล้ว: ใช้ได้ตราบที่ชุด OPEN อยู่ในช่วง `[เปิดรับ, ปิดรับ)` **ตามค่าปัจจุบันของชุดตอนสแกน** และเซลล์คนนั้นยังเป็นผู้แจกที่ active (บัญชี ACTIVE) — หัวหน้าขยายช่วงรับ QR ที่พิมพ์ไว้ก็ใช้ต่อได้; "พักแจก", "ระงับการใช้" หรือเอาเซลล์ออกจากชุดหยุด QR ทุกใบของคนนั้นทันที. `SalesEventQrToken.expiresAt` เก็บเวลาปิดรับตอนออก QR (ประวัติ) ไม่ใช้ตัดสิน. token ที่ไม่พบตอบ `SALES_EVENT_QR_INVALID` ("QR นี้ใช้ไม่ได้") ไม่ใช่ "หมดอายุ". หน้าเซลล์แสดง "QR นี้ใช้ได้ถึง {ปิดรับ}" และปุ่ม "บันทึกรูป QR". **ความเสี่ยงที่รับไว้**: รูป QR ที่ถูกแชร์ต่อ (ถ่ายรูป, ส่งต่อในแชต) ให้ใครก็รับส่วนลดได้จนแจกครบจำนวน — ตัวลดความเสี่ยงคือ จำนวนแจกสูงสุดของชุด, หนึ่งรายการต่อบัญชี LINE ต่อชุด, พักแจก/ระงับการใช้ และเอาเซลล์ออกจากชุด. แทน §3.2 (อายุ `min(ตอนนี้ + 5 นาที, ปิดรับ)`), SD-O3 ("QR 5 นาที"), SD-E02 และรหัส `SALES_EVENT_QR_EXPIRED` ใน §7.3 | §3.2, §7.3, SD-E02 | — |

### 1.2 มติเทคนิคของ Controller (2026-09-29)

| ID | มติ | อยู่ที่ |
|---|---|---|
| SD-T1 | ร้านที่ล็อกหรือยังไม่มีแพ็กเกจต้องเรียก route ของส่วนลดได้: เพิ่ม route ใน allowlist `isBillingRecoveryRoute` (`apps/api/src/modules/auth/presentation/auth.guard.ts:98-104`) และ sync pins ใน PR เดียวกัน (`auth.guard.ts` ถูก pin ที่ `infra/security/validate-production-maintenance-release.sh:25,106`) | §7.4, plan SD-C |
| SD-T2 | ลำดับงาน: (1) งานแก้ purchase flow ที่กำลังทำ → (2) ฐาน billing ร่วม (foundation, PR A ของแผน add-on): attempt และ invoice รู้ชนิดสินค้า (`productKind`) และมีช่องจอง active attempt แยกสำหรับ checkout ที่ไม่ใช่แพ็กเกจ (add-on T-02, T-07) → (3) ฟีเจอร์ add-on; ส่วนลดจากงานทำหลัง foundation. เส้นทางเครดิต (SD-O6) ต่อจาก PR B และ PR C ของแผน add-on ซึ่งสร้างกลไกเพิ่มยอด | plan §1 |
| SD-T3 | การซื้อ add-on ไม่ลดเด็ดขาด (สเปก add-on O-03 ตรงกัน); เครดิตจากงานเป็นยอดแถม ไม่ใช่ส่วนลดของการซื้อ add-on | §4.1 |
| SD-T4 | หน้า billing ไม่เพิ่มแท็บ; ส่วนลดราคาเป็นบรรทัดราคาบนการ์ดแพ็กเกจที่ใช้ได้และในขั้นตรวจยอด/ยืนยัน เช่น "ส่วนลดจากงาน {ชื่องาน} −{จำนวน} บาท (บิลแรก)"; การรับส่วนลดทำผ่าน QR และ LINE; รายการแท็บของหน้าเป็นของสเปก add-on §7.1 (T-08). ตัวเลือกใช้/ไม่ใช้ และกล่องรับเครดิตของร้านเดิมอยู่ในแท็บ "แพ็กเกจ" | §8 |
| SD-T5 | สุขอนามัยการ implement: migration เรียงหลังตัวล่าสุดบน develop ตอนลงมือ additive เท่านั้น ไม่มี Prisma enum; ลงทะเบียนเทสต์ผ่าน whole-chain catalog, `ci.yml` หรือ `extended-tests.yml` ไม่ใช่ `package.json`; regenerate W00 manifest เมื่อไฟล์ที่ถูก hash เปลี่ยน; `ci.yml` และ `extended-tests.yml` บน main ต้องตรงกับ develop byte ต่อ byte; ยึดแบบ `docs/plans/purchase-without-setup/xx-cross-cutting.md` | plan §3 |
| SD-T6 | ภาษาไทยเรียบ ไม่มีรหัสระบบในข้อความลูกค้า; ใช้คำ "ยังไม่มีแพ็กเกจ", "หมดอายุ", "เลือกแพ็กเกจ", "เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจ", "ทีมงาน", "อีเมลรับเอกสาร"; เงินของ AI เรียก "เครดิต AI" เท่านั้น; ยอดรูปเรียก "จำนวนอ่านรูปใบเสร็จ" ตามสเปก add-on | §8 |

### 1.3 ส่วนของ DRAFT ก่อนหน้าที่ยกเลิก

ส่วนต่อไปนี้ของ DRAFT v1 (นำเข้าใน a3cc6f39) และ v2 ไม่ใช้แล้ว และห้ามใช้เป็นเกณฑ์รับงาน:
- สะสมหลายรายการแล้วกด "เลือก"/"ใช้ส่วนลด" แบบ toggle, selection ที่เก็บต่อ account, `selectionVersion`, คำสั่ง select/clear และรหัส `SELECTION_*` → ระบบเสนอรายการที่ดีที่สุด และผู้ซื้อเลือกใช้หรือไม่ใช้ในการซื้อครั้งนั้น (SD-O4). ตัวเลือกนี้เป็นค่าใน quote ครั้งเดียว ไม่ถูกเก็บข้าม quote และไม่มีคำสั่งแยก
- DRAFT v2 "ไม่มีปุ่มไม่ใช้ส่วนลด ใช้อัตโนมัติกับร้านแรกที่ซื้อ" → มีตัวเลือก (SD-O4)
- section "ส่วนลด" ก่อนแพ็กเกจ, แท็บ "ส่วนลดที่มี N / ประวัติส่วนลด", กล่องเลื่อน 3 แถว และ dropdown ของลูกค้า → บรรทัดราคา ตัวเลือกสองข้อ และกล่องรับเครดิต (§8)
- target แบบ NEXT_RENEWAL/PURCHASE_INTENT/FIRST_PURCHASE, สถานะ QUEUED/ARMED, detach proof, ลดบิลต่ออายุ, coupon หรือ invoice discount และข้อยกเว้นกฎ no-coupon → ไม่มี (SD-O1)
- ตัวเลือกกลุ่มลูกค้า "ทั้งหมด / สมัครใหม่ผ่านงาน / บริษัทเดิม" → ผู้ถือคือคนที่สแกน (SD-O3); ร้านใหม่หรือร้านเดิมตัดสินจากสถานะร้านตอนใช้ (SD-O7)
- "ไม่มีวันหมดอายุหลังรับ" → มีวันหมดอายุ (§4.4)
- ส่วนลดราคาสำหรับดีล และการให้เครดิตยอดขายตามเซลล์ผู้แจกแทน attribution เดิม → ไม่ซ้อนดีล (SD-O2); ยอดขายของเซลล์คงตามเดิม (§10, SD-Q3)
- เดโมและหลักฐาน 53 walkthroughs/63 assertions (`docs/evidence/sales-ticket-demo-2026-09-28/` ไม่มีใน repo) → เป็นประวัติ ใช้รับรองแบบนี้ไม่ได้

## 2. คำศัพท์และขอบเขต

| คำ | ความหมาย |
|---|---|
| งาน | ชื่องาน (ข้อความ) ใช้จัดกลุ่มรายงาน ไม่มี record ของตัวเอง |
| ชุดส่วนลด | ค่าที่หัวหน้าตั้ง: ชื่องาน, ชื่อชุด, จำนวนเงินลดบิลแรก, เครดิต AI และจำนวนอ่านรูปใบเสร็จที่ให้ร้านเดิม, จำนวนแจกสูงสุด, ช่วงเปิดรับ, แพ็กเกจ/รอบที่ลดได้, เซลล์ผู้แจก (model `SalesEventBatch`) |
| ส่วนลดจากงาน | สิทธิ์หนึ่งรายการที่ออกให้คนสแกน QR (model `SalesEventTicket`); ใช้ได้ทางเดียว: ลดบิลแรก หรือรับเครดิต. บน UI ทุกบทบาทเรียก "ส่วนลด" หรือ "ส่วนลดจากงาน" ไม่ใช้คำว่า "ตั๋ว"; ชื่อ technical ใช้ ticket ได้ |
| ผู้ถือ | ตัวตน LINE ที่สแกน (provider LINE + channel id + LINE user id แบบเดียวกับ `ExternalIdentity`, `apps/api/prisma/schema.prisma:833-847`); ใช้ได้เมื่อบัญชีมั่งมีที่ผูก LINE นี้เป็นผู้มีสิทธิ์จัดการแพ็กเกจของร้าน |
| ร้านใหม่ (เส้นทางส่วนลดราคา) | ร้านที่การซื้อครั้งนี้เริ่มแพ็กเกจใหม่ (§4.1) |
| ร้านเดิม (เส้นทางเครดิต) | ร้านที่มีแพ็กเกจที่จ่ายแล้วใช้งานอยู่ (§4.1) |
| บิลแรก | บิลเดียวของการซื้อแบบจ่ายครั้งเดียว หรือบิลงวดแรกของการซื้อแบบต่ออายุ ในการซื้อที่เริ่มแพ็กเกจใหม่ |
| เครดิตจากงาน | เครดิต AI และ/หรือจำนวนอ่านรูปใบเสร็จตามที่ชุดกำหนด ที่เข้าร้านเดิมเป็น lot ของกลไกเพิ่มยอดใน add-on (แหล่งยอด `SALES_EVENT`) |

ในขอบเขต: ตั้งชุด, มอบหมายเซลล์, QR, รับผ่าน LINE (LIFF), ลดบิลแรกใน 4 โหมดชำระเงินพร้อมตัวเลือกใช้/ไม่ใช้, เครดิตสำหรับร้านเดิม, ถือเงิน/กู้รายการ/คืนเงิน, รายงานทีมขาย, การค้นหาของแอดมิน

นอกขอบเขต: ลดรอบต่ออายุ; ลดการซื้อ add-on/ส่วนต่างอัปเกรด/หนี้/ดีล; coupon หรือ promotion code สาธารณะ; customer balance ที่เป็นเงิน; การแจ้งเตือน LINE/อีเมลเรื่องส่วนลด (SD-Q5); การ์ดโปรโมชั่น LINE (`apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts:313`) และข้อความนโยบายสาธารณะ (`line-public-policy.logic.ts:8`) ที่ยังแสดงราคาปกติ; เว็บการตลาด; AI tool (AI Gateway ไม่เขียนเงิน ส่วนลด หรือยอด)

## 3. Journey

### 3.1 หัวหน้าตั้งชุดส่วนลด

หน้าใหม่ `/sales/events` ในคอนโซลทีมขาย ฟอร์มหนึ่งฟอร์มต่อหนึ่งชุด:
- ชื่องาน และชื่อชุด: ข้อความ 1–120 ตัวหลัง trim
- ส่วนลดบิลแรก (บาท): จำนวนเต็มบาท ≥ 0 เก็บเป็นสตางค์ (×100); 0 = ชุดนี้ไม่ลดราคา. จำนวนเต็มบาททำให้ VAT แบบแยกไม่มีเศษ .5 สตางค์ (SED-39)
- เครดิตสำหรับร้านเดิม: "เครดิต AI" จำนวนเต็ม ≥ 0 (เก็บเป็นหน่วยย่อย ×100 ตาม `unitScale` ของสเปก add-on) และ "จำนวนอ่านรูปใบเสร็จ" จำนวนเต็ม ≥ 0 (รูป); 0 ทั้งคู่ = ชุดนี้ไม่ให้เครดิต
- ต้องมีอย่างน้อยหนึ่งค่ามากกว่า 0 ในสามค่า
- จำนวนแจกสูงสุด ≥ 1: นับตลอดอายุชุด ไม่คืนเมื่อเพิกถอน คืนเงิน หรือไม่ใช้
- เปิดรับ / ปิดรับ: วันเวลาไทย กรอกด้วย `datetime-local` แล้วแปลง `${value}+07:00` แบบเดียวกับ `apps/web/src/features/billing-admin/BillingReceiptAdjustmentsPage.tsx:47,80`; server เก็บ UTC เป็นช่วง `[เปิดรับ, ปิดรับ)`; หน้าจอแสดง "ปิดรับ {วันที่ เวลา}"; ไม่ใช้ `ThemedDate` เพราะรองรับแค่ `'date' | 'month'` (`apps/web/src/common/components/field/ThemedDate.tsx:31`)
- แพ็กเกจที่ลดได้: checkbox ของ tier ที่ขาย และของรอบรายเดือน/รายปี (ใช้กับส่วนลดราคาเท่านั้น); ค่าเริ่มต้นเลือกทั้งหมด
- เซลล์ผู้แจก: รายการ checkbox ในฟีเจอร์ พร้อมช่องค้นหาชื่อที่ถาม server และแบ่งหน้า; หัวหน้าเห็นเฉพาะทีมตัวเองตามกติกาเดิมของ `apps/api/src/modules/sales-console/application/sales-agents.service.ts:78-86`, SYSTEM_ADMIN เห็นทุกคน; ต้องเลือกอย่างน้อยหนึ่งคน (SED-18)
- ปุ่ม "ยืนยันและเปิดแจกส่วนลด": สร้างแล้วเปิดทันที ไม่มีร่างใน server. แก้ไขใช้ "บันทึกการเปลี่ยนแปลง" (revision ใหม่ มีผลกับส่วนลดที่ออกหลังจากนั้น)

Server ปฏิเสธการเผยแพร่ถ้าส่วนลดบิลแรก (เมื่อ > 0) ทำให้ยอดของแพ็กเกจหรือรอบใดใน scope ต่ำกว่าขั้นต่ำ (§4.5) และบอกชื่อแพ็กเกจที่ติด

### 3.2 เซลล์เปิด QR

เซลล์ที่ยังได้รับมอบหมายในชุดที่เปิดรับ กด "แสดง QR" → server ออก token ใหม่ (สุ่ม 32 byte เก็บเฉพาะ hash) ~~อายุ `min(ตอนนี้ + 5 นาที, ปิดรับ)`~~ ใช้ได้จนชุดปิดรับตามค่าปัจจุบันของชุด (SD-O11) และคืนภาพ QR ที่ render ใน server ด้วย `qrSvgDataUrl` (`apps/api/src/modules/employee-access/domain/logic/employee-access.logic.ts:176-186`) ของลิงก์ `https://liff.line.me/{LINE_LIFF_ID}/event-discount?t=<token>` — แบบเดียวกับลิงก์ผูก LINE ของพนักงาน `buildLineLinkPackage` (`:154-173`). ~~หมดเวลาแล้วกดสร้างใหม่~~ บันทึกรูปไว้พิมพ์หรือเปิดบนจอได้ (SD-O11). QR หนึ่งอันสแกนได้หลายคนจนชุดปิดรับหรือแจกครบ และใช้ได้ทั้งร้านใหม่และร้านเดิม (SD-O7). QR ไม่ได้พิสูจน์ว่าผู้สแกนอยู่ที่งาน

### 3.3 ลูกค้าสแกนรับผ่าน LINE

1. LINE เปิด LIFF app เดิม; `https://liff.line.me/<id>/event-discount` จะไปที่ path ย่อยของ endpoint ที่ลงทะเบียนไว้ `…/v1/auth/line/link-page/event-discount` แบบเดียวกับหน้าสมัคร `line/link-page/signup` (`apps/api/src/modules/auth/presentation/auth.controller.ts:520-526`). หน้าเป็น HTML ที่ API render ด้วย `liffPageHtml` + `LIFF_PAGE_CSP` + `LIFF_PAGE_SCRIPT` (`apps/api/src/common/security/liff-page.security.ts:7,89,131`) โดยเพิ่ม mode `event-discount`
2. หน้าเรียก `liff.getIDToken()` แล้วส่ง `POST /v1/public/event-discounts/claim` {idToken, qrToken, requestKey}. Server ตรวจ ID token ด้วย `LineIdTokenService` (AuthModule export ไว้แล้ว, `auth.module.ts:176-178`) และจำกัดความถี่ต่อ LINE user
3. ผ่าน → ออกส่วนลดหนึ่งรายการผูกกับตัวตน LINE นั้น (ยังไม่ผูกร้าน). สแกนชุดเดิมซ้ำได้รายการเดิม
4. หน้าแสดง "รับส่วนลดแล้ว", ชื่องาน, สิ่งที่ได้ (แสดงเฉพาะค่าที่มากกว่า 0): "ร้านใหม่: ลด {X} บาทจากบิลแรกเมื่อซื้อแพ็กเกจ" และ "ร้านที่มีแพ็กเกจอยู่แล้ว: รับเครดิต AI {n} เครดิต และจำนวนอ่านรูปใบเสร็จ {m} รูป", "ใช้ได้ถึง {วันที่ เวลา}" และขั้นต่อไป:
   - มีบัญชีมั่งมีที่ผูก LINE นี้แล้ว → ปุ่ม "เปิดมั่งมี" ใช้ `POST /v1/auth/line/liff/session` เดิม (`auth.controller.ts:675`; `exchange-liff-session.use-case.ts:59`) เพื่อ handoff เข้าเว็บ; ร้านที่ล็อก ("ยังไม่มีแพ็กเกจ"/"หมดอายุ") พาผู้มีสิทธิ์จัดการแพ็กเกจลงหน้าแพ็กเกจเลย (purchase-without-setup R-C3, `exchange-liff-session.use-case.ts:144-149`); ร้านอื่นลงหน้าแรกของร้าน แล้วเปิดเมนู "แพ็กเกจและการชำระเงิน" เอง
   - ยังไม่มี → ปุ่ม "เปิดร้านใหม่" ไป LIFF signup เดิม (ไม่แก้ฟอร์มสมัคร) และบรรทัดรอง "ถ้ามีบัญชีมั่งมีอยู่แล้ว ให้เข้าสู่ระบบด้วย LINE นี้ก่อน"

การรับส่วนลดไม่ส่งข้อความแชต LINE ใด ๆ (หน้า LIFF เป็นหน้าเว็บของเรา); token ไม่เข้า log ของ API เพราะ request log บันทึกแค่ path ไม่รวม query (`apps/api/src/common/middleware/request-logger.middleware.ts:20-27,50`) และ API เก็บแค่ hash

### 3.4 สิ่งที่ผู้มีสิทธิ์จัดการแพ็กเกจต้องทำเพื่อใช้ส่วนลด

เงื่อนไขร่วมของทั้งสองทาง:
1. เป็นคนที่สแกนรับเอง
2. เข้าเว็บด้วยบัญชีที่ผูก LINE เดียวกัน
3. เป็นสมาชิก ACTIVE ที่มีสิทธิ์ `company.plan.manage` ของร้าน — predicate เดิมของการซื้อ (`assertOwner`, `apps/api/src/modules/billing/application/billing.service.ts:120-138` → `canManagePlan`)

แล้วเปิด "แพ็กเกจและการชำระเงิน" ของร้าน (แท็บ "แพ็กเกจ"):

**(ก) ร้านใหม่ — ลดบิลแรก (SD-O4)**
- เหนือรายการแพ็กเกจมีกล่อง "ส่วนลดจากงาน {ชื่องาน}" พร้อมตัวเลือกสองข้อ: "ใช้ส่วนลด −{จำนวน} บาทกับการซื้อครั้งนี้" (เลือกไว้แล้ว) และ "ไม่ใช้ครั้งนี้"
- เมื่อเลือก "ใช้" การ์ดแพ็กเกจที่ลดได้มีบรรทัด "ส่วนลดจากงาน {ชื่องาน} −{จำนวน} บาท (บิลแรก)"; เมื่อเลือก "ไม่ใช้ครั้งนี้" ไม่มีบรรทัดนี้
- เลือกแพ็กเกจและวิธีชำระ → ขั้นตรวจยอดแสดงผลตามตัวเลือก: ใช้ = ราคาแพ็กเกจ, ส่วนลด, ภาษี (ถ้ามี), "ชำระวันนี้" และสำหรับแบบต่ออายุ "รอบถัดไปชำระราคาเต็ม {ราคา}"; ไม่ใช้ = ราคาเต็มพร้อมบรรทัด "ไม่ใช้ส่วนลดจากงานครั้งนี้". มีลิงก์เปลี่ยนตัวเลือกซึ่งขอ quote ใหม่และให้ยืนยันเงื่อนไขใหม่
- ยืนยันเงื่อนไข → ชำระที่ Stripe → ใช้สิทธิ์สำเร็จเมื่อระบบยืนยันรับเงินจริง

**(ข) ร้านเดิม — รับเครดิต (SD-O6)**
- ใต้การ์ดแพ็กเกจปัจจุบัน (`apps/web/src/features/billing/BillingPage.tsx:399`) มีกล่อง "ส่วนลดจากงาน {ชื่องาน}: รับเครดิต AI {n} เครดิต และจำนวนอ่านรูปใบเสร็จ {m} รูป เข้าร้านนี้" พร้อมปุ่ม "รับเครดิตเข้าร้านนี้"
- กดแล้ว server เพิ่มยอดทันที (ไม่มีการชำระเงิน); หน้าแสดง "ได้รับเครดิตแล้ว" และทางไปดูยอดในแท็บเครดิต AI และอ่านรูปของสเปก add-on
- ผู้ถือที่ดูแลหลายร้านเลือกร้านเองโดยกดปุ่มในหน้าของร้านที่ต้องการ

ร้านที่ "ยังไม่มีแพ็กเกจ" หรือ "หมดอายุ" เข้าหน้านี้ได้ใน locked shell เดิม (`apps/web/src/features/plan-term/plan-term.logic.ts:40-44`); route อ่านส่วนลดต้องเข้า allowlist ของ API (§7.4). ผู้มีสิทธิ์จัดการแพ็กเกจคนอื่นของร้านเดียวกันไม่เห็นส่วนลดของคุณ เพราะส่วนลดเป็นของผู้ถือ

### 3.5 สิ่งที่พนักงานในร้าน (ไม่มีสิทธิ์จัดการแพ็กเกจ) เห็น

- หน้าแพ็กเกจเปิดไม่ได้อยู่แล้ว: เมนูซ่อนลิงก์ (`apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:343-350,376-381`) และ API ตอบ 403 → ใช้ส่วนลดหรือรับเครดิตเข้าร้านไม่ได้
- หน้า LIFF หลังสแกนเป็นที่เดียวที่เห็นส่วนลด และบอกว่า: "ส่วนลดนี้เป็นของบัญชี LINE นี้ ใช้ได้เมื่อคุณเป็นเจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจของร้าน ถ้าจะใช้กับร้านที่คุณทำงานอยู่ ให้เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจสแกนรับเอง"
- ส่วนลดโอนให้คนอื่นไม่ได้. ถ้าพนักงานคนนั้นเปิดร้านของตัวเองภายหลัง ใช้กับร้านนั้นได้ตามกติกาปกติ

### 3.6 หลังใช้

- ส่วนลดราคา — หน้า return (`/companies/:id/billing/return`, อ่าน `GET …/billing/attempts/:id`, `billing.service.ts:1000-1015`): ระหว่างรอผล "ส่วนลดจะถูกใช้เมื่อยืนยันการชำระ"; เมื่อ apply แล้ว "ใช้ส่วนลดจากงานแล้ว"
- ส่วนลดราคา — ประวัติ: แถวของบิลนั้นแสดง "ส่วนลดจากงาน −{จำนวน} บาท"; ยอดของแถวเป็นยอดรับจริง (ประวัติอ่าน `BillingInvoice.totalSatang`, `billing.service.ts:1042-1057`)
- ส่วนลดราคา — เอกสาร Stripe แสดงราคาสุทธิหลังลดเป็นราคาต่อหน่วย ไม่มีบรรทัดส่วนลด ไม่มีชื่องานหรือชื่อชุด (SED-25); คืนเงินหรือข้อพิพาท: คืนไม่เกินยอดที่รับจริง; ส่วนลดคงสถานะใช้แล้ว ไม่คืนสิทธิ์และไม่คืนจำนวนแจก
- เครดิต — ยอดเข้า "ยอดเพิ่มเติม" ของร้าน (สเปก add-on §17.1); ประวัติการใช้ยอดแสดง "ได้รับเครดิต AI เพิ่ม" / "ได้รับจำนวนอ่านรูปใบเสร็จเพิ่ม" พร้อมชื่องาน; ใช้ได้ 12 เดือนนับจากวันที่รับ (add-on D8). ไม่มีใบแจ้งหนี้หรือใบเสร็จ เพราะไม่มีการชำระเงิน

## 4. กติกาสิทธิ์

### 4.1 เส้นทางตามสถานะร้าน (SD-O7)

ตัดสินจาก `purchaseSource` ของร้านตอนใช้ (`apps/api/src/modules/billing/application/billing-purchase-source.ts:8-26`):

| สถานะร้าน | เส้นทาง |
|---|---|
| NO_TERM, TRIAL, ADMIN_MANUAL, PAID_EXPIRED_CURRENT_MODE (`packageMenuPurchaseSource`, `:39-40`) | ส่วนลดบิลแรก เมื่อซื้อแพ็กเกจ (§4.1.1) |
| PAID_CURRENT_MODE (มีแพ็กเกจที่จ่ายแล้วและยังไม่ถึง `paidThrough`, `:22`) | เครดิตจากงาน (§4.1.2) |
| PAID_OTHER_MODE, SOURCE_INCONSISTENT | ไม่มีเส้นทาง จนทีมงานตรวจข้อมูลการชำระเงินตามเดิม |

#### 4.1.1 ส่วนลดบิลแรก — การซื้อที่ลดได้

ใช้ได้เฉพาะ quote แพ็กเกจจาก catalog ที่ตรง `quote.purchase.kind` (`billing.service.ts:494`):

| `purchase.kind` | ลดได้ | เหตุผล |
|---|---|---|
| INITIAL (ยังไม่มีแพ็กเกจ, ทดลองจบ, แพ็กที่ทีมงานตั้งให้) | ได้ | บิลแรกของร้าน |
| RESTART (แพ็กที่จ่ายแล้วหมดอายุ ซื้อใหม่) | ได้ — ค่าเริ่มต้น SD-Q2 | บิลแรกของแพ็กเกจใหม่ ไม่ใช่การต่ออายุ |
| REPEAT, SCHEDULED_CHANGE (ซื้อต่อหรือเปลี่ยนรอบถัดไปขณะแพ็กยังใช้งาน) | ไม่ได้ — ค่าเริ่มต้น SD-Q2 | เทียบเท่าการต่ออายุ; ร้านสถานะนี้อยู่ในเส้นทางเครดิต |
| UPGRADE, FULL_PACKAGE_UPGRADE | ไม่ได้ | ร้านมีแพ็กที่ใช้งานอยู่; ส่วนต่างไม่ลด |
| ADVANCE_DEAL และ quote ที่มี `dealId` | ไม่ได้ | ดีล (SD-O2) |
| รอบต่ออายุทุกชนิด (CARD_AUTO, PROMPTPAY_RENEW) | ไม่ได้ | SD-O1 |
| การซื้อ ADD_ON | ไม่ได้ | SD-T3; validator ของ add-on ปฏิเสธส่วนลดทุกชนิด (สเปก add-on O-03) |

ชุดที่ตั้งส่วนลดบิลแรกเป็น 0 ไม่มีเส้นทางนี้

#### 4.1.2 เครดิตจากงาน — ร้านเดิม

ครบทุกข้อ:
- ร้าน ACTIVE (ไม่ถูกพักโดยผู้ดูแล) และ `purchaseSource = PAID_CURRENT_MODE`; ร้านในช่วง grace หลัง `paidThrough` ยังไม่เข้า จนชำระรอบใหม่สำเร็จ (สอดคล้องค่าเริ่มต้น Q1 ของสเปก add-on)
- ชุดตั้งเครดิต AI หรือจำนวนอ่านรูปใบเสร็จมากกว่า 0
- สินค้าทุกชนิดในรางวัลพร้อมรับ lot สำหรับร้านนี้ตามสเปก add-on (§8.4 "สินค้านั้นพร้อมใช้จริงใน cohort", §16 ข้อ 9): เครดิต AI = ร้านย้ายไปรอบเครดิตใหม่แล้ว (`aiCreditCutoverAt`), จำนวนอ่านรูป = consumer เห็น lot ของร้าน. รับทั้งชุดหรือไม่รับเลย ไม่ให้ครึ่งเดียว; ร้านที่ยังไม่พร้อม: SD-Q9
- ร้านนี้ยังไม่เคยใช้ส่วนลดจากชุดเดียวกัน (ค่าเริ่มต้น SD-Q8)
- ร้านที่มีดีลรับได้ (SD-O8)
- ไม่ใช่การซื้อ add-on จึงไม่ขัด O-03 และไม่ต้องเปิด gate การขาย add-on; แต่ release และ gate เปิดพร้อมกัน (§11)

### 4.2 ไม่ซ้อนกับดีล (เฉพาะส่วนลดราคา)

ไม่ใช้ส่วนลดราคาเมื่อข้อใดข้อหนึ่งจริง — ตรวจตอน quote และซ้ำใน transaction จองของ Checkout:
1. quote มี `dealId` (ดีลคิดราคาจาก snapshot ของตัวเอง, `billing.service.ts:298-299`)
2. ร้านมี `PackageChangeRequest` kind `SALES_DEAL` ที่ `status = 'APPROVED'` และ `offerExpiresAt > now` (predicate เดียวกับการ์ดดีลบนหน้าแพ็กเกจ, `billing.service.ts:886-887`) หรือ `status = 'PAID'` (ดีลจ่ายล่วงหน้ารอเริ่ม)
3. ดีลที่กำลังใช้งาน (แพ็กปัจจุบันมาจากดีลและยังไม่หมด) อยู่ในเส้นทางเครดิตอยู่แล้ว (`PAID_CURRENT_MODE`) และ **รับเครดิตได้** (SD-O8)

ดีล DRAFT/PENDING_APPROVAL (ลูกค้ายังไม่เห็น) ไม่กัน. ถ้าดีลถูกอนุมัติหลัง quote ที่เลือก "ใช้" → Checkout ตอบ `BILLING_QUOTE_STALE` และ quote ใหม่ไม่มีส่วนลด; ถ้าอนุมัติหลังจองแล้ว บิลที่จ่ายได้ส่วนลดตามที่ลูกค้ายืนยันไว้ และดีลที่ยังไม่จ่ายถูกปิดโดย `supersedeUnpaidDeal` เดิม (`billing-package-request.ts:177`)

ข้อความเมื่อผู้ถือมีส่วนลดราคาแต่ร้านมีดีล (แสดงเหนือรายการแพ็กเกจปกติ ไม่แสดงบนการ์ดดีล):
> ร้านนี้มีดีลพิเศษอยู่แล้ว จึงใช้ส่วนลดจากงานกับราคาดีลไม่ได้
> ส่วนลดยังเป็นของคุณจนถึง {วันที่}

และถ้าชุดนั้นมีเครดิตสำหรับร้านเดิม เพิ่มบรรทัด "หลังร้านมีแพ็กเกจแล้ว รับเป็นเครดิตเข้าร้านได้". `billing-package-request.ts` (`applyDealRequest :66-110`, `recordReferralAttribution :139-152`, `mirrorAttributionRefund :159-167`) ไม่เปลี่ยน

### 4.3 ตัวเลือกใช้/ไม่ใช้ และจำนวนครั้ง

ตัวเลือก (SD-O4):
- รายการที่เสนอ: รายการที่ใช้กับการซื้อนี้ได้และลดมากที่สุด เท่ากันเลือกที่หมดอายุก่อน แล้วตาม id. ถูกใช้ก็ต่อเมื่อผู้ซื้อเลือก "ใช้"
- ตัวเลือกเป็นค่าของ quote ครั้งนั้น (`eventDiscountChoice`, §7.2) และ snapshot ของ quote บันทึกว่าใช้รายการไหน หรือไม่ใช้รายการไหน. ไม่มี selection ที่เก็บข้าม quote; เปลี่ยนใจ = ขอ quote ใหม่และยืนยันเงื่อนไขใหม่
- ค่าเริ่มต้นบนหน้าเว็บคือ "ใช้". ถ้า request มีข้อเสนอแต่ไม่ส่งตัวเลือกมา server ถือว่า "ใช้" — ตรงกับค่าเริ่มต้นของ Owner และกันหน้าเว็บที่เปิดค้างจากก่อน release เสียส่วนลดบิลแรกไปเงียบ ๆ
- ไม่ใช้ครั้งนี้: quote ราคาเต็ม; ส่วนลดยัง ISSUED ใช้กับร้านอื่น หรือการซื้อครั้งถัดไปที่เข้าเงื่อนไข หรือรับเป็นเครดิตเมื่อร้านเป็นร้านเดิม จนหมดอายุ; การไม่ใช้ไม่นับเป็น "ร้านใช้ส่วนลดราคาแล้ว" (SD-O5)
- Checkout ตรวจซ้ำตามตัวเลือกใน snapshot:
  - ใช้ → ตรวจรายการเดิมแล้วจอง; ไม่ผ่าน (หมดอายุ, ถูกเพิกถอน, ถูกจองที่ร้านอื่น, ร้านเคยใช้แล้ว, ดีล, gate ปิด, ชุดถูกระงับ) = stale
  - ไม่ใช้ → **ไม่ stale** เพราะเหตุของส่วนลด แม้จะมีรายการใหม่เกิดขึ้นภายหลัง
  - quote ที่ออกตอนยังไม่มีข้อเสนอ แต่ตอน Checkout ผู้ถือมีรายการที่ใช้กับการซื้อนี้ได้แล้ว → stale ("มีส่วนลดจากงานที่ใช้ได้ กรุณาเลือกแล้วตรวจยอดอีกครั้ง") เพื่อให้ผู้ซื้อเห็นตัวเลือก

จำนวนครั้ง:
- หนึ่งรายการใช้ได้ทางเดียวครั้งเดียว — ส่วนลดราคา หรือ เครดิต (state ของรายการ §6.3)
- ส่วนลดราคาต่อร้าน: ครั้งเดียวตลอดอายุร้าน (SD-O5) — partial unique ใน migration (แบบที่มีแล้วใน `20260705010000_item15a_idempotency_and_channel_uniqueness`, `20260916090000_email_passwordless_access`)
- ต่อร้านต่อชุด: ร้านหนึ่งใช้ส่วนลดจากชุดเดียวกันได้ครั้งเดียว ไม่ว่าทางไหน (ค่าเริ่มต้น SD-Q8) — ร้านเดิมจึงรับเครดิตได้อีกเมื่อมีชุดใหม่
- ต่อบิล: หนึ่งรายการ (`attemptId` และ `invoiceId` unique บน ticket)
- ต่อคนต่อชุด: หนึ่งรายการ (unique (batch, ตัวตน LINE)); คนหนึ่งถือหลายรายการจากหลายชุดได้
- ผู้ถือดูแลหลายร้าน: เลือกเองต่อร้าน — เลือก "ใช้" ในการซื้อของร้านที่ต้องการ หรือกด "รับเครดิตเข้าร้านนี้" ในหน้าของร้านที่ต้องการ. ถ้าเปิด Checkout สองร้านพร้อมกันโดยเลือก "ใช้" รายการเดียวกัน ร้านที่จองก่อนได้ อีกร้านได้ `BILLING_QUOTE_STALE` แล้วเลือกใหม่ (ไม่ใช้ หรือรายการอื่นถ้ามี)

### 4.4 วันหมดอายุ

`expiresAt = ปิดรับของชุด (ตาม revision ตอนออก) + 30 วัน` — **Owner รับค่าเริ่มต้น 2026-09-29 (SD-Q1, SD-O9)**. ตรึงบนรายการตอนออก ไม่เลื่อนเมื่อแก้ชุด และใช้กับทั้งสองทาง. ส่วนลดราคาตัดสินตอนจองใน Checkout แบบเดียวกับหน้าต่างของดีล S46 (`billing.service.ts:552-555`): จองก่อนหมดอายุแล้วจ่ายเสร็จหลังหมดอายุ ยังใช้ได้. เครดิตตัดสินตอนกดรับ. "หมดอายุ" อ่านจากเวลา (`state = ISSUED` และ `expiresAt <= now`) ไม่ต้องมี sweep. เครดิตที่รับแล้วเป็น lot ที่มีอายุของตัวเอง 12 เดือนนับจากวันที่รับ (add-on D8) ไม่ผูกกับวันหมดอายุของส่วนลด. แสดงบน LIFF และหน้าแพ็กเกจ: "ใช้ได้ถึง {วันที่ เวลา}"; หมดแล้ว: "ส่วนลดจากงานหมดอายุแล้ว"

### 4.5 ขอบเขตชุดและยอดขั้นต่ำ

- ส่วนลดราคา: `scope = { tiers: PaidTier[], intervals: ['month' และ/หรือ 'year'] }` ตรึงบนรายการตอนออก; purchase kind และโหมดชำระไม่เป็น scope (ตายตัวตาม §4.1.1 และ gate). เครดิตไม่มี scope ของแพ็กเกจ
- ขั้นต่ำหลังลด: `unitAmountSatang ≥ 1000` (฿10) — ค่าเดียวกับขั้นต่ำราคาใน `offerTerms` (`apps/api/src/modules/billing/domain/billing-policy.ts:46`) เป็นค่าคงที่ในโค้ด ไม่เก็บใน `policyJson` (parser เข้มงวด `:29-30`, SED-09). ขั้นต่ำการเรียกเก็บ THB ของ Stripe ยังไม่พิสูจน์ (§14)
- ตรวจตอนเผยแพร่ (ทุก tier/รอบใน scope ด้วยราคาปัจจุบัน) และตอน quote (ราคาอาจเปลี่ยน); ไม่ผ่าน = การ์ดนั้นไม่มีบรรทัดส่วนลด และรายการยังอยู่
- ผลต่อการ์ดคำนวณด้วย helper เดียวกับ quote จึงไม่ขัดกัน (SED-14)
- เครดิต: ค่าในชุดเป็นจำนวนเต็ม ไม่มีเพดานเฉพาะงานนี้; ใช้กติกา readiness และเพดานความปลอดภัยของสเปก add-on (§5.3) เหมือนยอดที่ทีมงานเพิ่มให้

### 4.6 สิทธิ์ของลูกค้า

ทั้งสองทางใช้ predicate เดียวกับการซื้อ (`assertOwner` → `canManagePlan`); ไม่ hard-code OWNER; ไม่มี permission ใหม่ฝั่งร้าน. ร้านที่ถูกพักโดยผู้ดูแล (`BILLING_COMPANY_HELD`) ใช้ไม่ได้ทั้งสองทาง

## 5. ราคาและกลไกชำระเงิน

§5.1–§5.5 ใช้กับเส้นทางส่วนลดราคาเมื่อผู้ซื้อเลือก "ใช้". เลือก "ไม่ใช้ครั้งนี้" = quote และ Checkout ราคาเต็มตามเดิมทุกอย่าง. §5.6 คือเส้นทางเครดิต

### 5.1 สูตร

`D` = ส่วนลดของรายการ (สตางค์, เต็มบาท), `P` = `offer.priceSatang` (ฐานเดียวกับ `quoteTotals`, `billing-policy.ts:125-129`)
- NOT_VAT_REGISTERED และ EXCLUSIVE_VAT_7: `unitAmountSatang = P − D`
- INCLUSIVE_VAT_7: `S = quoteTotals(P).subtotalSatang − D`; `unitAmountSatang = S + round(0.07 × S)`
- ยอดบิลแรก = `quoteTotals(unitAmountSatang, taxTreatment)`
- ยอดในบรรทัด "−{จำนวน}" = `P − unitAmountSatang` (ฐานเดียวกับราคาที่การ์ดแสดง)

ตัวอย่าง 499 บาท ลด 100 บาท:

| ภาษี | unit_amount | ก่อนภาษี | ภาษี | ชำระวันนี้ | บรรทัดส่วนลด |
|---|---:|---:|---:|---:|---:|
| NOT_VAT_REGISTERED (production วันนี้) | 399.00 | 399.00 | 0.00 | 399.00 | −100.00 |
| EXCLUSIVE_VAT_7 (การ์ดแสดงราคายังไม่รวม VAT) | 399.00 | 399.00 | 27.93 | 426.93 | −100.00 |
| INCLUSIVE_VAT_7 (การ์ดแสดงราคารวม VAT) | 392.01 | 366.36 | 25.65 | 392.01 | −106.99 |

INCLUSIVE: `quoteTotals(39201)` ได้ subtotal 36636 และ tax 2565 ตรงกับสูตร; รายงาน R2 §8 ข้อ 3 พิสูจน์ว่า round(T×7/107) = round(0.07S) ทุก S เมื่อ T = S + round(0.07S) — ต้องพิสูจน์กับ Stripe จริงก่อนจด VAT (§14). EXCLUSIVE: ส่วนลดเต็มบาทกับราคาเต็มบาททำให้ไม่มีเศษ .5 สตางค์. ห้ามลดเกินราคาหรือต่ำกว่าขั้นต่ำ ห้ามลดบางส่วน ไม่ใช้ customer balance บรรทัดติดลบ หรือ promotion code. ข้อความลูกค้าไม่ใช้คำ "ก่อน VAT"

สิทธิ์แพ็กไม่ขึ้นกับเงิน: ใบเสร็จ วัน ผู้ใช้ สาขา และเครดิต AI ของแพ็กเกจมาจาก offer (`billing-reconciler.service.ts:607-632`) จึงเท่ากับราคาเต็ม

### 5.2 กลไกต่อโหมด (ไม่มี coupon)

ทุกโหมดที่มีส่วนลดใช้ Checkout `mode: 'payment'` ที่คิด `price_data.unit_amount` จาก server:

| โหมด | วันนี้ | เมื่อเลือกใช้ส่วนลด |
|---|---|---|
| CARD_ONCE | one-time `price_data` (`billing.service.ts:732-744`) | `unit_amount = eventDiscount.applied.unitAmountSatang` แทน `snapshot.upgrade?.amountSatang ?? snapshot.quote.offer.priceSatang` ที่ `:740` |
| PROMPTPAY_ONCE | เหมือน CARD_ONCE (`payment_method_types: ['promptpay']`) | เหมือน CARD_ONCE |
| PROMPTPAY_RENEW | งวดแรก one-time `price_data` → apply ทันที → `bindPromptPayRenewal` (`billing-reconciler.service.ts:695`, `:1088-1144`) ผูก subscription `send_invoice` ราคา catalog แบบ trial ถึงสิ้นงวดแรก | ลดเฉพาะ `unit_amount` งวดแรก; subscription และบิล QR รอบถัดไปราคาเต็มเหมือนเดิม |
| CARD_AUTO | Checkout `mode: 'subscription'` ด้วย Price id (`billing.service.ts:745-751`) | งวดแรกเป็นการจ่ายครั้งเดียวพร้อมเก็บบัตร แล้วผูก subscription ราคาเต็มที่เริ่มเก็บเมื่อสิ้นงวดแรก (§5.3) |

หลักฐานการชำระ: `paidPackageCheckoutEvidence` เปลี่ยนเฉพาะยอดที่คาดหวัง (`apps/api/src/modules/billing/domain/paid-checkout-invoice.ts:22-23`) ให้ใช้ total, tax และ unit amount จาก `snapshot.eventDiscount` เมื่อ `choice = 'USE'`. การตรวจว่า "ไม่มีส่วนลดใด ๆ" คงเดิมทุกข้อ (`:30` amount_discount, `:35` total_discount_amounts, `:41` item amount_discount, `:49` line discount_amounts) — coupon หรือส่วนลดที่ไม่คาดยังถือเป็นหลักฐานไม่ตรง. `paid-invoice.ts` (หลักฐานของ subscription) ไม่แตะ. ยอดที่คาดหวังอยู่ใน snapshot ของ attempt ซึ่ง immutable ทุกเส้นทางตรวจซ้ำจึงได้ผลเดียวกัน: reconcile ปกติ (`billing-reconciler.service.ts:515`), นำเข้าใบที่ค้นพบ (`importDiscoveredInvoice`, `:378`, ทาง one-time `:419-423`) และ retry ของแอดมิน (`reconcileOriginalInvoice`, `:441`, ทาง one-time `:453-457`) — ไม่ต้องมี resolver แยก (SED-05)

### 5.3 CARD_AUTO: จ่ายงวดแรกครั้งเดียว แล้วผูกการต่ออายุราคาเต็ม

แพตเทิร์น advance deal ใช้ได้ในเชิงกลไก แต่เรียกฟังก์ชันเดิมตรง ๆ ไม่ได้:
- **ส่วนที่ใช้ได้**: advance deal พิสูจน์ในโค้ดแล้วว่า Checkout `mode: 'payment'` + `payment_intent_data.setup_future_usage: 'off_session'` เก็บบัตรไว้ตัดรอบต่อไป (`billing.service.ts:735-736`; `billing-advance-deal.pg.spec.ts:138,140`) แล้วผูก subscription `charge_automatically` + `default_payment_method` + `trial_end` = สิ้นงวดที่จ่ายแล้ว + `trial_settings.end_behavior.missing_payment_method: 'cancel'` (`billing-reconciler.service.ts:797,823-832`), ตรวจ binding รวม `simpleCollection` (`:834-851`) และห้ามมีบิลไม่เป็นศูนย์ก่อนสิ้นงวด (`:853-860`); replay ไม่สร้าง subscription ซ้ำ (`billing-advance-deal.pg.spec.ts:217`) และหลักฐานที่ถูกถือไว้หยุด trial ก่อนเก็บเงิน (`:221`)
- **ส่วนที่ใช้ตรงไม่ได้**: `reconcileAdvanceDeal` (`billing-reconciler.service.ts:699-787`) ต้องมี `snapshot.advanceDeal`, แถวดีล และแพ็กจ่ายครั้งเดียวที่ยังใช้งาน (`renewalMode` เป็น CARD_ONCE/PROMPTPAY_ONCE, invoice เดิม APPLIED) และเปิดสิทธิ์ตอนแพ็กเดิมหมด (`activateAdvanceDeal`, `:930`); ส่วนลดจากงานเป็นบิลแรกที่เริ่มสิทธิ์ทันที
- **เส้นทางที่ใกล้ที่สุด** คือ PROMPTPAY_RENEW งวดแรก: `reconcileOneTime` apply ทันที คง `activeAttemptId` จนผูกเสร็จ (`:658`) แล้ว `bindPromptPayRenewal` สร้าง subscription trial ถึง `paidThrough` ที่ราคา catalog และเขียน `BillingSubscriptionContract` ที่ `effectiveAt = paidThrough` (`:1137`)

สิ่งที่ต้องทำ (ไฟล์และเทสต์อยู่ใน plan SD-C):
1. quote CARD_AUTO ที่เลือกใช้ส่วนลดทำให้ `paymentCheckoutSnapshot` เป็นจริง (`billing.service.ts:66-67`) → Checkout แบบ payment, `payment_method_types: ['card']`, `setup_future_usage: 'off_session'` (ขยายเงื่อนไข `:735-736` จาก `advanceDeal` เป็น `advanceDeal` หรือ `eventDiscount.choice = 'USE'`)
2. reconciler ส่ง attempt นี้เข้า `reconcileOneTime` (`:240`; ตรวจโหมด `:478-479`; นำเข้า `:419`; retry `:453`) แล้ว apply งวดแรกทันทีด้วยเส้นทางเดิม (term, ใบเสร็จ, เมนู, trial carryover, ผู้รับเอกสาร, referral) ตั้ง `renewalMode = 'CARD_AUTO'` และคง `activeAttemptId` จนผูกเสร็จ (ขยาย `:658` จาก PROMPTPAY_RENEW)
3. ผูกต่ออายุ: ขยาย `bindPromptPayRenewal` (`:1088-1144`) ให้รับโหมดบัตร โดยยกส่วนตรวจบัตรจาก `bindAdvanceDeal` (`:793-800` บัตรถูกเก็บและเป็นของ customer, `:823-832` พารามิเตอร์ของบัตร, `:834-851` ตรวจ binding) → subscription `trialing` ถึง `paidThrough` ราคา = Price ของ catalog (`snapshot.priceId`) ไม่มี discount; จุดเรียก `:695` ขยายเป็น PROMPTPAY_RENEW หรือ CARD_AUTO ที่ใช้ส่วนลด
4. บิล $0 `subscription_create` ของ trial ข้ามแบบเดียวกับ PROMPTPAY_RENEW/advance deal (เพิ่มเงื่อนไข `eventDiscount` ที่ใช้ที่ `:311-319`)
5. ระหว่างงวดแรก (subscription `trialing`) ลูกค้า "หยุดต่ออายุ" ได้: ขยาย predicate trial ของ advance deal ที่ `billing-collection.ts:83,203` และ `billing.service.ts:817-820`
6. `billingPurchaseSource` ต้องไม่ตอบ `SOURCE_INCONSISTENT` ระหว่างรอผูก: ขยายข้อยกเว้นช่วงผูกของ PROMPTPAY_RENEW (`billing-purchase-source.ts:14-17`) ให้ครอบ CARD_AUTO

ผลรอบต่อไป: Stripe ออกบิล `subscription_cycle` ราคาเต็มเมื่อ trial จบ → ตรวจด้วย `paidInvoiceEvidence` กับ contract snapshot ที่ `quote.totalSatang` เป็นราคาเต็ม (§5.4) → เหมือน CARD_AUTO ปกติทุกอย่าง

ข้อจำกัดเดียวกับ advance deal: ระหว่างงวดแรก REPEAT/อัปเกรด (ต้อง `sub.status = 'active'`, `billing-repeat.ts:99`), วันฟรีของแอดมิน (ต้องมีบิล subscription ที่จ่ายเงินจริงและ `active`, `billing-free-days.ts:34-45`) และ `plan_changes` (ต้อง `subscriptionState = 'active'`) ยังไม่เปิด — เปิดเองหลังจ่ายรอบแรกราคาเต็ม. ยุติแพ็กต้องหยุดต่ออายุก่อน (`BILLING_END_PACKAGE_AUTO_RENEW`, `billing-end-package.ts:32-33`) ซึ่งข้อ 5 ทำให้ทำได้ระหว่างงวดแรก

ผูกไม่สำเร็จ: ลูกค้าคงสิทธิ์งวดที่จ่ายแล้ว; reconciler ลองใหม่และใช้ issue เดิมของการ reconcile ที่ล้ม; ห้ามเปิด Checkout ซ้อนระหว่างนั้น (`activeAttemptId` ยังถืออยู่)

### 5.4 สิ่งที่ไม่เปลี่ยน เพราะไม่มีการลดรอบต่ออายุ

`snapshot.quote.subtotalSatang/taxSatang/totalSatang` เป็นราคาเต็มเสมอ และส่วนลดอยู่แยกใน `snapshot.eventDiscount` — contract ที่รอบต่ออายุใช้ตรวจ (`BillingSubscriptionContract.snapshotJson`) จึงเป็นราคาเต็มโดยไม่ต้องแก้อะไร. ต่อไปนี้ **ไม่แตะ**:
- guard ที่ปฏิเสธหรือล้าง discount บน subscription: `simpleCollection` และ schedule ที่เขียน `discounts: ''` (`billing-schedule.ts:14-20,57-67`); collection ของลูกค้า (`billing-collection.ts:26-32,118-122,206-210,221` — ต่างจากข้อ 5.3-5 ที่แก้เฉพาะ predicate ของ trial ไม่เกี่ยวกับ discount); REPEAT (`billing-repeat.ts:100,120-131,334,337,345-348`); คืนราคาดีล (`billing-price-return.ts:59-68,101-105`); วันฟรี (`billing-free-days.ts:43-48,75-89`)
- หลักฐานของการต่ออายุ `paid-invoice.ts:26,28,36-38` และ grace `enforceGrace` (`billing-reconciler.service.ts:1169-1260`: ยอดต้องเท่ากับ contract `:1196`, ไม่มีบรรทัดส่วนลด `:1203`)
- proration และ preview ของอัปเกรด (`billing-upgrade.ts:73,86-100`) และรายการ event ของ Stripe (`BILLING_STRIPE_EVENTS`, `billing-reconciler.service.ts:40-43`) — ไม่ต้องเพิ่ม `invoice.created`
- `billing-refund-source.ts` (ใบไม่มีบรรทัดส่วนลด จึงผ่านกติกาเดิม `:89`, `:98`)

### 5.5 เอกสาร ประวัติ และการคืนเงินของส่วนลดราคา

ดู §3.6. ประวัติและหน้าแอดมินระบุว่าใบไหนได้ส่วนลดจาก `SalesEventTicket.invoiceId` เท่านั้น — ห้ามอ่านจาก `contractSnapshot.eventDiscount` ของ invoice เพราะบิลต่ออายุของ CARD_AUTO/PROMPTPAY_RENEW เก็บ contract snapshot เดียวกันกับบิลแรก (`applyInvoice`, `billing-reconciler.service.ts:1279-1287`). คืนเงินในแอปใช้ยอดจริง (`billing-refund-source.ts:52`). REFERRAL attribution (ถ้ามี) บันทึกยอดจริง `invoice.totalSatang` (`billing-package-request.ts:144-151`) และหักคืนตามยอดจริง (`:159-167`)

### 5.6 เส้นทางเครดิต: เพิ่มยอดผ่านกลไกของ add-on โดยไม่แตะ billing

- ใช้คำสั่งเพิ่มยอดร่วมของสเปก add-on (§16 ข้อ 1) ไม่สร้าง ledger ที่สอง: ต่อสินค้าที่ชุดให้ เรียก `applyAddOnGrant(tx, { companyId, billingAccountId, productKind, sourceKind: 'SALES_EVENT', sourceKey: 'sales-event:<ticketId>:<productKind>', sourceHash, units, at, expiresAt })` โดย `at` = เวลาที่รับ และ `expiresAt = appendPackageInterval(at, 'year')` (add-on §5.2)
- Lot ที่ได้ (`AiCreditGrant` ของเครดิต AI และ `BillingReceiptGrant` ของรูป, add-on §8.2) อยู่กลุ่ม "ทีมงาน" ของลำดับตัด (ยอดแถม: แพ็กเกจ → ทีมงาน → ซื้อ, FEFO ในกลุ่ม; add-on D8, §6.1); ลูกค้าเห็นใน "ยอดเพิ่มเติม" (add-on §17.1); ประวัติ "ได้รับเครดิต AI เพิ่ม" / "ได้รับจำนวนอ่านรูปใบเสร็จเพิ่ม" พร้อมชื่องาน; audit เหมือนยอดที่ทีมงานให้
- ธุรกรรมเดียว: lock ตามลำดับร่วมของ add-on §8.3 (L1 `partner-ocr-config:{companyId}` → L4 แถว `Company`) → แถว ticket (`ISSUED` → `USED`, `redeemedAs = 'CREDIT'`) → lot ทุกชนิดในรางวัล → audit; `requestKey` เดิมได้ผลเดิม; `sourceKey` unique ต่อ ticket และสินค้า จึงกดซ้ำหรือคำตอบหายไม่เพิ่มยอดซ้ำ
- ไม่มี quote, Checkout, `BillingAttempt`, Stripe call, ใบแจ้งหนี้, `paidSatang`, commission หรือการคืนเป็นเงิน; ไม่เขียน `CompanyPlanTerm` (add-on §6); ไม่แตะ `activeAttemptId` หรือช่องจองของ add-on
- ถอนยอดที่ให้ผิดใช้ REVOKE ของ lot ตาม add-on §16 ข้อ 8 (ทีมงาน); ส่วนลดคงสถานะใช้แล้ว. ต้นทุน AI ที่ใช้จากเครดิตนี้บันทึกใน `AiUsageEvent` ตามปกติ

## 6. State, data และ concurrency

### 6.1 ตาราง (additive, state เป็น String, ไม่มี Prisma enum)

| Model | ฟิลด์หลัก | constraint |
|---|---|---|
| `SalesEventBatch` | id, eventName, batchName, discountSatang (≥ 0), rewardChatCreditUnits (≥ 0, หน่วยย่อย ×100), rewardReceiptImageUnits (≥ 0), issueCap, issuedCount, claimStartsAt, claimEndsAt, scopeJson, state (OPEN/PAUSED/SUSPENDED), revision, version, createdByUserId, createdAt, updatedAt | index (state, claimEndsAt); ค่าหนึ่งในสามต้อง > 0 |
| `SalesEventBatchAgent` | batchId, salesUserId, active, addedByUserId, addedAt, removedAt | PK (batchId, salesUserId); index (salesUserId, active) |
| `SalesEventQrToken` | id, tokenHash, batchId, salesUserId, batchRevision, expiresAt, createdAt | tokenHash unique; index (batchId, expiresAt) |
| `SalesEventTicket` | id, serial, batchId, batchRevision, salesUserId, holderProvider ('LINE'), holderChannelId, holderProviderUserId, discountSatang, rewardChatCreditUnits, rewardReceiptImageUnits, scopeJson, expiresAt (ทั้งหมดตรึงตอนออก), state (ISSUED/RESERVED/USED/REVOKED), redeemedAs (DISCOUNT/CREDIT, ว่างจนเริ่มใช้), companyId?, attemptId?, invoiceId?, appliedDiscountSatang?, claimRequestKey, redeemRequestKey?, reservedAt?, usedAt?, revokedAt?, revokedByUserId?, revokeReason?, version, createdAt, updatedAt | serial unique (8 ตัว อักษร/ตัวเลขที่ไม่สับสน); unique (batchId, holderChannelId, holderProviderUserId); attemptId unique; invoiceId unique; index (holderChannelId, holderProviderUserId, state); index (companyId, state); partial unique ด้วย SQL ดิบใน migration: **(companyId) WHERE state IN ('RESERVED','USED') AND redeemedAs = 'DISCOUNT'** (SD-O5) และ **(batchId, companyId) WHERE state IN ('RESERVED','USED')** (ค่าเริ่มต้น SD-Q8) |

ตัวตน LINE เก็บแบบ `ExternalIdentity` เพื่อจับคู่เท่านั้น ไม่ส่งออก API ใด. `BillingInvoice`, `BillingAttempt`, `BillingAccount` ไม่เพิ่มคอลัมน์ — ส่วนลดราคาอยู่ใน `quoteSnapshot.eventDiscount` ของ attempt (immutable) และความเชื่อมโยงอยู่บน ticket. เครดิตไม่มีตารางใหม่ของตัวเอง: lot อยู่ใน `AiCreditGrant` และ `BillingReceiptGrant` ของ add-on ด้วยแหล่งยอด `SALES_EVENT`

### 6.2 State ของชุด

| state | รับส่วนลด/ออก QR | ใช้ส่วนลดราคาหรือรับเครดิต | เปลี่ยนไปเป็น | ผู้สั่ง |
|---|---|---|---|---|
| OPEN | ได้ ในช่วง `[เปิดรับ, ปิดรับ)` | ได้ | PAUSED ("พักแจก"), SUSPENDED ("ระงับการใช้") | `sales.event.manage` |
| PAUSED | ไม่ได้ | ได้ | OPEN ("เปิดแจกต่อ"), SUSPENDED | `sales.event.manage` |
| SUSPENDED | ไม่ได้ | ไม่ได้ (รายการที่จองแล้วเดินต่อ; รายการที่ใช้แล้วคงเดิม) | PAUSED ("ยกเลิกการระงับ") | `sales.event.manage` + เหตุผลบังคับ |

"ปิดรับแล้ว" เป็นผลของเวลา ไม่ใช่ state. แก้ชุด = `revision + 1` พร้อม version fence (`SALES_EVENT_BATCH_STALE`); จำนวนแจกสูงสุดเพิ่มได้ ลดไม่ต่ำกว่า `issuedCount`; ขยายช่วงรับได้; รายการที่ออกแล้วตรึงจำนวนเงิน เครดิต scope วันหมดอายุ และเซลล์. ถอดเซลล์ = QR ของคนนั้นใช้ไม่ได้ทันที; รายการที่ออกแล้วยังนับให้คนเดิม. ทุกคำสั่งเขียน audit (actor, ค่าเดิม/ใหม่, เหตุผล)

### 6.3 State ของส่วนลด

| state | ความหมาย | เข้าเมื่อ |
|---|---|---|
| ISSUED | ออกแล้ว ผูกตัวตน LINE ยังไม่ผูกร้าน | claim สำเร็จ; ปล่อยการจอง; ผู้ซื้อเลือก "ไม่ใช้ครั้งนี้" ไม่เปลี่ยน state |
| RESERVED | ส่วนลดราคาเท่านั้น: ผูกร้านและ attempt ของ Checkout ที่ยอมรับแล้ว (`redeemedAs = 'DISCOUNT'`) | transaction จองของ Checkout (`billing.service.ts:532-620`) หลังสร้าง attempt และตั้ง `activeAttemptId` (`:614-618`) เมื่อ snapshot เลือก "ใช้" |
| USED | ใช้แล้ว ถาวร; `redeemedAs` บอกทาง | ส่วนลดราคา: ใน `reconcileOneTime` หลัง upsert invoice และบันทึกการเงิน (`billing-reconciler.service.ts:547-556`) **ก่อน** ทางออก `row.appliedAt` (`:557`) และทางออก HELD (`:592-599`) — ถือเงินไว้ตรวจก็ถือว่าใช้สิทธิ์แล้ว. เครดิต: ในธุรกรรมรับเครดิต (§5.6) จาก ISSUED โดยตรง ไม่ผ่าน RESERVED |
| REVOKED | หัวหน้าเพิกถอนพร้อมเหตุผล (เฉพาะ ISSUED) | คำสั่งเพิกถอน |
| (หมดอายุ) | ISSUED และ `expiresAt <= now` — อ่านจากเวลา | — |

ปล่อยการจอง (RESERVED → ISSUED ล้าง `companyId`, `attemptId`, `appliedDiscountSatang`, `redeemedAs`) ใน transaction เดียวกับที่ attempt จบโดยไม่มีเงิน:
- Checkout ล้มก่อนเรียกผู้ให้บริการ หรือถูกปฏิเสธ: `billing.service.ts:763-770`
- session หมดอายุโดยไม่มี invoice: `billing-reconciler.service.ts:494-504` — ปุ่มยกเลิกของลูกค้า (`billing-checkout-expiry.service.ts:56-85`) และการยุติของแอดมิน (`:148-180`) วิ่งเข้าจุดนี้หลัง expire session

attempt ที่เป็น UNKNOWN (`billing.service.ts:772-774`) คงการจองไว้จนรายการเดิมจบ. ใช้สิทธิ์ราคาแล้วพบว่ารายการไม่ได้ RESERVED ให้ attempt นี้ → เปิด issue `EVENT_DISCOUNT_REVIEW` (`BillingIssue.kind` เป็น String, `schema.prisma:9988`) แต่ไม่ขวาง apply เพราะลูกค้าจ่ายตามยอดที่ยืนยันแล้ว. คืนเงิน ข้อพิพาท หรือ REVOKE ของ lot เครดิต ไม่เปลี่ยน state ของส่วนลด

### 6.4 Lock, idempotency และการแข่ง

- Claim: lock แถว batch `FOR UPDATE` → หา replay ตาม (batch, ตัวตน) → ตรวจ cap → insert ticket + `issuedCount + 1` + audit ใน transaction เดียว; `requestKey` เดิมได้ผลเดิม; ไม่แตะ Company
- จองส่วนลดราคา: `lockPlanTermCompany` (`billing.service.ts:533`) → account → `UPDATE … WHERE id = ? AND state = 'ISSUED' AND version = ?` (0 แถว = stale). สองคนจองให้ร้านเดียวกันพร้อมกันถูก serialize ด้วย lock ร้านและ partial unique; คนเดียวจองสองร้านชนกันที่แถว ticket
- รับเครดิต: L1 → L4 → ticket → lot ตามลำดับร่วม add-on §8.3 (เหมือน apply ของ add-on); การรับเครดิตกับการจองส่วนลดราคาของรายการเดียวกันชนกันที่แถว ticket (`state = 'ISSUED'`) จึงสำเร็จได้ทางเดียว
- ใช้สิทธิ์และปล่อย: อยู่ใน transaction เดิมของ reconciler/checkout ต่อจาก lock ร้านและ lease (`assertLease`, `billing-reconciler.service.ts:1162-1167`); ลำดับ Company → BillingAccount → ticket; claim ไม่ถือ lock ร้าน จึงไม่ย้อนลำดับ; advisory lock ของ apply (`:537`) มาก่อนเสมอ
- งานกับผู้ให้บริการอยู่นอก transaction ตามเดิม; ส่วนลดไม่มี provider object ของตัวเอง

## 7. Contracts และ API

### 7.1 Routes

| Route | ผู้เรียกและ guard | ทำอะไร |
|---|---|---|
| `POST /v1/sales/events/batches` | `sales.event.manage` + platform tenant (`assertPlatformTenant`, `sales-context.ts:37`) | สร้างและเปิดชุด |
| `GET /v1/sales/events/batches?cursor=` | `sales.console.read` | หัวหน้า: ชุดของตัวเองและทีม; SYSTEM_ADMIN: ทั้งหมด; เซลล์: ชุดที่ได้รับมอบหมาย |
| `GET /v1/sales/events/batches/:batchId` | `sales.console.read` + scope เดียวกัน | รายละเอียดและตัวเลขสรุป |
| `PATCH /v1/sales/events/batches/:batchId` | `sales.event.manage` | แก้ไข (expectedVersion) |
| `POST /v1/sales/events/batches/:batchId/state` | `sales.event.manage` | {action: PAUSE/RESUME/SUSPEND/LIFT, expectedVersion, reason} |
| `GET /v1/sales/events/agents?q=&cursor=` | `sales.event.manage` | ค้นหาเซลล์สำหรับมอบหมาย (หัวหน้า: ทีมตัวเอง; admin: ทั้งหมด; take 50) |
| `POST /v1/sales/events/batches/:batchId/qr` | `sales.console.read` + เป็นผู้แจกที่ active | ออก QR {qrImageUrl, expiresAt} |
| `GET /v1/sales/events/batches/:batchId/tickets?cursor=` | `sales.console.read` | เซลล์: รายการที่ตัวเองแจก; หัวหน้า/admin: ทั้งชุด; ไม่มีตัวตน LINE หรือเอกสารการเงิน |
| `POST /v1/sales/events/tickets/:ticketId/revoke` | `sales.event.manage` | {reason, expectedVersion}; เฉพาะ ISSUED |
| `GET /v1/sales/events/report?from=&to=&salesUserId=` | `sales.report.read` + กติกา `visibleAgents` (`sales-reports.service.ts:75`) | §10 |
| `GET /v1/auth/line/link-page/event-discount` | public (หน้า LIFF) | HTML |
| `POST /v1/public/event-discounts/claim` | public; LINE ID token ใน body | รับส่วนลด |
| `GET /v1/companies/:companyId/billing/event-discount` | ลูกค้า (`assertOwner`) — **เพิ่มใน allowlist** | เส้นทางของร้าน ข้อเสนอส่วนลดราคาต่อการ์ด หรือข้อเสนอเครดิต (§7.2) |
| `POST /v1/companies/:companyId/billing/event-discount/credit` | ลูกค้า (`assertOwner`); ไม่ต้องอยู่ใน allowlist เพราะใช้ได้เฉพาะร้านที่มีแพ็กเกจใช้งาน ซึ่งไม่ถูกล็อก | รับเครดิตเข้าร้าน {ticketSerial, requestKey} |
| `POST …/billing/quote`, `POST …/billing/checkout` (เดิม) | เดิม (อยู่ใน allowlist แล้ว, `auth.guard.ts:103`) | quote รับ `eventDiscountChoice`; response เพิ่มฟิลด์ |
| `GET /v1/system/billing/lookup?reference=` (เดิม, `billing.controller.ts:215-218`) | `system.billing.read` | รับเลขส่วนลด (serial) ด้วย |

### 7.2 Field dictionary

Quote request (`BillingQuoteDto`, `apps/api/src/modules/billing/presentation/billing.dto.ts:90-100`; whitelist `billing.controller.ts:593`; signature `billing.service.ts:292`) เพิ่ม `eventDiscountChoice?: 'USE' | 'DECLINE'`. เว็บส่งค่านี้เฉพาะเมื่อ view บอกว่ามีข้อเสนอส่วนลดราคา — request ของร้านส่วนใหญ่จึงไม่มี field ใหม่ และ binary เก่าที่ใช้ `forbidNonWhitelisted` จะไม่ได้รับ field ที่ไม่รู้จักจากกรณีทั่วไป. ไม่ส่งแต่มีข้อเสนอ = `USE` (§4.3). ไม่ใช้ชื่อ `purchaseIntent` (เป็นของ add-on และ FULL_PACKAGE, SED-10)

`BillingQuote` (`packages/contracts/src/billing.ts:121-148`) เพิ่มฟิลด์ optional:

```ts
eventDiscount?: {
  choice: 'USE' | 'DECLINE';
  ticketSerial: string; eventName: string; expiresAt: string;
  discountSatang: number;       // ค่าของรายการ (D)
  shownDiscountSatang: number;  // P − unitAmountSatang ใช้ทั้งตอนแสดงตัวเลือกและบรรทัดส่วนลด
  applied?: {                   // มีเฉพาะ choice = 'USE'
    unitAmountSatang: number; subtotalSatang: number; taxSatang: number;
    totalSatang: number;        // ชำระวันนี้
  };
};
```

- `quote.totalSatang` ยังเป็นราคาเต็ม (= ยอดรอบต่อไป). "ชำระวันนี้" = `quote.eventDiscount?.applied?.totalSatang ?? quote.totalSatang`. บรรทัด "ต่ออายุรายปีครั้งถัดไป" (`BillingPage.tsx:640`) ที่พิมพ์ `quote.totalSatang` จึงถูกต้องโดยไม่ต้องแก้ (SED-21)
- `choice = 'DECLINE'` ยังมีข้อมูลข้อเสนอ เพื่อให้ขั้นตรวจยอดแสดงลิงก์เปลี่ยนกลับเป็น "ใช้" ได้
- `BillingSnapshot` (`billing.service.ts:58`) เพิ่ม `eventDiscount?` เป็นอย่างใดอย่างหนึ่ง: `{ choice: 'USE', ticketId, ticketVersion, batchId, salesUserId, …ค่าข้างบน }` หรือ `{ choice: 'DECLINE', offeredTicketId }`; ไม่มีฟิลด์ = ตอน quote ไม่มีข้อเสนอ
- `BillingEventDiscountView` (route GET ใหม่):

```ts
{
  path: 'DISCOUNT' | 'CREDIT' | null;   // จากสถานะร้าน (§4.1)
  discount: null | {
    ticket: { serial: string; eventName: string; discountSatang: number; expiresAt: string;
              state: 'AVAILABLE' | 'IN_PAYMENT' | 'USED' | 'EXPIRED' | 'REVOKED' } | null;
    reason: null | 'DEAL_ACTIVE' | 'COMPANY_ALREADY_USED' | 'EXPIRED' | 'SUSPENDED' | 'CLOSED';
    offers: { offerKey: string; interval: 'month' | 'year'; eligible: boolean;
              shownDiscountSatang: number | null; reason: null | 'OUT_OF_SCOPE' | 'BELOW_MINIMUM' }[];
  };
  credit: null | {
    offers: { ticketSerial: string; eventName: string; chatCreditUnits: number;
              receiptImageUnits: number; expiresAt: string }[];
    reason: null | 'NOT_READY' | 'RENEWAL_PAYMENT_PENDING' | 'SUSPENDED' | 'CLOSED';
    availableFrom: string | null;       // วันที่ร้านพร้อมรับ lot ถ้ารู้ (SD-Q9)
  };
}
```

- รับเครดิต: body {ticketSerial, requestKey (16–120)} → {ticketSerial, eventName, grants: { productKind: 'CHAT_CREDIT' | 'RECEIPT_IMAGE', units: number, expiresAt: string }[], replay: boolean}; หน่วยตาม `unitScale` ของ add-on (เครดิต AI ×100, รูป ×1)
- `BillingAttemptView` (`billing.service.ts:1000-1015`) เพิ่ม `eventDiscount?: { shownDiscountSatang: number; state: 'IN_PAYMENT' | 'USED' }`; รายการประวัติ (`:1042-1057`) เพิ่ม `eventDiscountSatang?` จาก ticket ที่ `invoiceId` ตรงกับแถว
- Claim: body {idToken, qrToken (base64url 43 ตัว), requestKey (16–120)} → {ticket: {serial, eventName, discountSatang, chatCreditUnits, receiptImageUnits, expiresAt}, replay: boolean, next: 'OPEN_PACKAGE' | 'SIGN_UP'}
- ทุก body ใหม่เป็น class DTO (global pipe `forbidNonWhitelisted`, `apps/api/src/common/pipes/validation-pipe.options.ts:7-9`; `body-validation-coverage.spec.ts`)
- ค่าคงที่ใน contracts: `SALES_EVENT_BATCH_STATES`, `SALES_EVENT_TICKET_STATES`, `SALES_EVENT_REDEEM_PATHS` (ชื่อไม่ชน Prisma enum ตาม `packages/contracts/src/prisma-enum-parity.spec.ts`); `SALES_PERMISSION_KEYS` เพิ่ม `'sales.event.manage'` (`packages/contracts/src/sales.ts:9-10`); ~~`BILLING_ACTIONS` เพิ่ม `'event_discounts'`~~ ไม่มี gate (SD-O10); แหล่งยอด `SALES_EVENT` เพิ่มในชนิดของ add-on (§5.6)

### 7.3 รหัสข้อผิดพลาด (มี prefix; web map เป็นข้อความไทย)

| รหัส | เมื่อ | ข้อความ |
|---|---|---|
| `SALES_EVENT_QR_INVALID` (เดิม ~~`SALES_EVENT_QR_EXPIRED`~~, SD-O11) | ไม่พบ token (QR ไม่มีอายุของตัวเองแล้ว) | QR นี้ใช้ไม่ได้ ขอ QR ของงานนี้จากทีมขายอีกครั้ง |
| `SALES_EVENT_CLAIM_CLOSED` | ชุดไม่ OPEN หรืออยู่นอกช่วงรับ | งานนี้ปิดรับส่วนลดแล้ว |
| `SALES_EVENT_ISSUE_FULL` | แจกครบจำนวน | ส่วนลดของงานนี้ถูกแจกครบแล้ว |
| `SALES_EVENT_AGENT_INACTIVE` | ผู้แจกถูกถอดหรือปิดบัญชี | QR นี้ใช้ไม่ได้แล้ว ขอให้ผู้แจกสร้าง QR ใหม่ |
| `SALES_EVENT_SELF_CLAIM` | ตัวตน LINE เป็นของสมาชิก platform tenant (ค่าเริ่มต้น SD-Q3) | บัญชีทีมขายรับส่วนลดนี้ไม่ได้ |
| ~~`SALES_EVENT_DISABLED`~~ | ยกเลิก — ไม่มี gate (SD-O10) | — |
| `SALES_EVENT_BATCH_STALE` | version ไม่ตรง | ข้อมูลชุดส่วนลดเปลี่ยนไปแล้ว กรุณาโหลดใหม่ |
| `SALES_EVENT_DISCOUNT_TOO_HIGH` | เผยแพร่แล้วยอดต่ำกว่าขั้นต่ำ | ส่วนลดสูงเกินราคาของ {แพ็กเกจ} |
| `SALES_EVENT_REWARD_REQUIRED` | ทั้งส่วนลดและเครดิตเป็น 0 | ใส่ส่วนลดหรือเครดิตอย่างน้อยหนึ่งอย่าง |
| `SALES_EVENT_TICKET_NOT_REVOCABLE` | ไม่ใช่ ISSUED | ส่วนลดนี้กำลังชำระหรือใช้แล้ว เพิกถอนไม่ได้ |
| `SALES_EVENT_TICKET_UNAVAILABLE` | รับเครดิตด้วยรายการที่หมดอายุ ถูกเพิกถอน ใช้แล้ว หรือชุดถูกระงับ | ส่วนลดนี้ใช้ไม่ได้แล้ว |
| `SALES_EVENT_CREDIT_NOT_ELIGIBLE` | ร้านไม่ใช่ร้านเดิมที่มีแพ็กเกจใช้งาน หรือยังรับ lot ไม่ได้ | ร้านนี้ยังรับเครดิตจากงานไม่ได้ (ข้อความตาม `credit.reason`) |
| `SALES_EVENT_BATCH_ALREADY_USED` | ร้านนี้ใช้ส่วนลดจากชุดนี้แล้ว | ร้านนี้ใช้ส่วนลดจากงานนี้แล้ว |
| `SALES_EVENT_BATCH_INVALID` (SD-A) | ฟอร์มชุดไม่ผ่าน (ชื่อ, เต็มบาท/เต็มเครดิต, จำนวนแจกต่ำกว่าที่แจกแล้ว, ช่วงเวลา, แพ็กเกจ, เซลล์, เหตุผลของการระงับ/ยกเลิกการระงับ) | ข้อมูลชุดส่วนลดไม่ครบหรือไม่ถูกต้อง กรุณาตรวจแต่ละช่องแล้วบันทึกอีกครั้ง |
| `SALES_EVENT_NOT_FOUND` (SD-A) | ไม่พบชุดหรือรายการ หรือผู้เรียกไม่มีสิทธิ์เห็น/จัดการ | ไม่พบชุดส่วนลดหรือรายการส่วนลดนี้แล้ว |
| `BILLING_QUOTE_STALE` (เดิม) | ส่วนลด ดีล หรือ gate เปลี่ยนระหว่าง quote กับ Checkout; หรือมีข้อเสนอเกิดขึ้นหลัง quote ที่ไม่มีข้อเสนอ | ส่วนลดหรือราคาเปลี่ยน กรุณาตรวจยอดอีกครั้ง |

quote ไม่ error เพราะส่วนลด: ใช้ไม่ได้ก็คิดราคาเต็มและบอกเหตุผลผ่าน view. รหัสใหม่เพิ่มใน `apps/web/src/common/api/api-error-message.ts` และ `api-error-coverage.spec.ts`; ข้อความของหน้า LIFF อยู่ในหน้า LIFF เอง

### 7.4 Allowlist ของ auth guard และ pins

ร้านที่ล็อกเรียก route ที่ไม่อยู่ใน `isBillingRecoveryRoute` ไม่ได้ (`company_term_expired`, `auth.guard.ts:295-306`; เว็บเด้งไป `/renew`, `apps/web/src/common/api/authed-fetch.ts:107`). เพิ่ม `/event-discount` ในกลุ่ม GET ของ regex (`auth.guard.ts:102`) เท่านั้น:
- quote และ checkout อยู่ใน allowlist แล้ว (`:103`)
- `POST …/event-discount/credit` ไม่ต้องเพิ่ม เพราะร้านที่ใช้ได้มีแพ็กเกจใช้งานอยู่ จึงไม่โดน term hold
- claim เป็น public จึงไม่ผ่าน term hold (`:169-171`)
- route ของทีมขายอยู่ใน platform tenant

`auth.guard.ts` ถูก pin → ต้อง sync pins ใน PR เดียวกัน พร้อมเคส allow/deny ใน `auth.guard.spec.ts`. สเปก add-on ก็แก้ allowlist นี้: PR ที่ merge ทีหลัง rebase แล้ว sync pins ใหม่. เว็บไม่ต้องแก้ locked shell (`isBillingCustomerRecoveryPath`, `packages/contracts/src/billing.ts:224`)

## 8. UI และข้อความ

| ที่ | สิ่งที่แสดง |
|---|---|
| แท็บ "แพ็กเกจ" เหนือรายการแพ็กเกจ (ร้านใหม่ที่มีข้อเสนอ) | กล่อง "ส่วนลดจากงาน {ชื่องาน}" + ตัวเลือก: "ใช้ส่วนลด −{จำนวน} บาทกับการซื้อครั้งนี้" (เลือกไว้แล้ว) / "ไม่ใช้ครั้งนี้"; บรรทัดช่วย "ใช้กับบิลที่ซื้อตอนนี้เท่านั้น รอบต่ออายุชำระราคาเต็ม · ถ้าไม่ใช้ ส่วนลดยังอยู่ถึง {วันที่}". เป็น radio สองตัวเลือกที่เข้าถึงด้วยคีย์บอร์ดได้ ไม่ใช่ปุ่ม toggle |
| การ์ดแพ็กเกจที่ลดได้ (`BillingPage.tsx:575-603`) | เมื่อเลือก "ใช้": ใต้ราคา "ส่วนลดจากงาน {ชื่องาน} −{จำนวน} บาท (บิลแรก)"; เลือก "ไม่ใช้" หรือการ์ดที่ลดไม่ได้: ไม่มีบรรทัด |
| เหนือรายการแพ็กเกจ เมื่อมีส่วนลดแต่ใช้กับร้านนี้ไม่ได้ | ดีล: ข้อความ §4.2 · ร้านเคยใช้แล้ว: "ร้านนี้ใช้ส่วนลดราคาจากงานไปแล้ว (ใช้ได้ร้านละครั้ง)" · หมดอายุ: "ส่วนลดจากงานหมดอายุแล้ว" · ระงับหรือยังไม่เปิด: "ส่วนลดจากงานใช้ไม่ได้ในตอนนี้ ติดต่อทีมงานได้" |
| ขั้นตรวจยอดและยืนยัน (`BillingPage.tsx:635-643`) | ใช้: "ราคาแพ็กเกจ {P}" · "ส่วนลดจากงาน {ชื่องาน} (บิลแรก) −{จำนวน}" · ภาษีตามเดิม · "ชำระวันนี้ {ยอด}" · แบบต่ออายุ: "รอบถัดไปชำระราคาเต็ม {quote.totalSatang}" · ลิงก์ "ไม่ใช้ส่วนลดครั้งนี้". ไม่ใช้: ราคาเต็ม + "ไม่ใช้ส่วนลดจากงานครั้งนี้" + ลิงก์ "ใช้ส่วนลด". ลิงก์ทั้งสองขอ quote ใหม่และล้างการยืนยันเงื่อนไข |
| ใต้การ์ดแพ็กเกจปัจจุบัน (ร้านเดิม, `BillingPage.tsx:399`) | กล่อง "ส่วนลดจากงาน {ชื่องาน}: รับเครดิต AI {n} เครดิต และจำนวนอ่านรูปใบเสร็จ {m} รูป เข้าร้านนี้" (แสดงเฉพาะค่าที่มากกว่า 0) + "ใช้ได้ถึง {วันที่}" + ปุ่ม "รับเครดิตเข้าร้านนี้"; หลังสำเร็จ "ได้รับเครดิตแล้ว ดูยอดได้ที่แท็บเครดิต AI และอ่านรูป"; ยังรับไม่ได้: "ร้านนี้รับเครดิตจากงานได้ตั้งแต่ {วันที่}" หรือ "ชำระค่าแพ็กเกจรอบใหม่ก่อน จึงรับเครดิตจากงานได้" ตามเหตุ |
| หน้า return | "ส่วนลดจะถูกใช้เมื่อยืนยันการชำระ" → "ใช้ส่วนลดจากงานแล้ว" |
| ประวัติการชำระเงิน | "ส่วนลดจากงาน −{จำนวน} บาท" ใต้แถวบิลนั้น |
| ประวัติการใช้ยอด (แท็บของ add-on) | "ได้รับเครดิต AI เพิ่ม" / "ได้รับจำนวนอ่านรูปใบเสร็จเพิ่ม" พร้อม "จากงาน {ชื่องาน}" |
| หน้า LIFF | §3.3 และ §3.5 |
| คอนโซลทีมขาย `/sales/events` | ฟอร์ม §3.1 (รวมช่องเครดิต); รายการชุด (สถานะ, ปิดรับ, แจกแล้ว/ใช้เป็นส่วนลด/ใช้เป็นเครดิต/คงเหลือ); หน้าชุด (ปุ่ม "แสดง QR" สำหรับผู้แจก; "พักแจก"/"เปิดแจกต่อ"/"ระงับการใช้"/"ยกเลิกการระงับ"; รายการส่วนลดพร้อม "เพิกถอน") |

ไม่มีแท็บหรือ section ใหม่ (SD-T4); รายการแท็บเป็นของสเปก add-on §7.1. ข้อความลูกค้าไม่มีรหัสระบบ ไม่มีคำว่า "ตั๋ว" หรือ "ก่อน VAT". ออกแบบที่ 390 px ก่อน; ชื่องานยาวตัดบรรทัดได้โดยไม่ล้นการ์ด. ข้อความอยู่ใน dictionary ของฟีเจอร์ (ไทย/อังกฤษ)

### 8.1 LINE: ถามส่วนลด (เพิ่ม 2026-09-29, Owner UAT)

ที่มา: Owner ถาม "ฉันมีส่วนลดไหม" ใน LINE หลังการ์ดร่างใบเสร็จ แล้วได้คำถามกลับ และ "ก็ส่วนลดค่ามั่งมีไง" ถูกอ่านเป็นส่วนลดในบิล; บนเว็บ ร้านที่มีแพ็กเกจอยู่แล้วไม่เห็นส่วนลดที่สแกนมาเลย

- **เส้นทาง**: lane แบบ deterministic ใน webhook ของ API (ข้างการ์ด "บริการของเรา"/"ถ่ายใบเสร็จ") หลังรู้ตัวผู้ใช้ ร้าน และสิทธิ์ ก่อน router, draft และ model ทุกตัว จึงตอบได้แม้อยู่หลังการ์ดร่างใบเสร็จ ไม่แก้ intent router และไม่มี flag
- **คำที่ตอบ** (ทั้งข้อความ): ส่วนลด, ฉันมีส่วนลดไหม, ส่วนลดค่ามั่งมี, ส่วนลดแพ็กเกจ, โค้ดส่วนลด, คูปอง, ตั๋วส่วนลด, ส่วนลดจากงาน และรูปคำถามใกล้เคียง. "ส่วนลด" เปล่าๆ หลังร่างใบเสร็จ = ส่วนลดจากงาน. ข้อความที่มี บิล/ใบเสร็จ/ใบกำกับ/รายการนี้/ยอดนี้ ("ส่วนลดในบิลนี้", "ใบเสร็จมีส่วนลด") และ "มีส่วนลด" ที่ไม่ใช่คำถาม อยู่กับ flow ใบเสร็จเหมือนเดิม
- **ข้อมูล**: `BillingService.lineEventDiscount` = SD-B `eventDiscount` (เจ้าของ/ผู้จัดการแพ็กเกจเท่านั้น, ตั๋วของ LINE ที่ ACTIVE ของผู้ถาม) + `eventDiscountBlock` เมื่อร้านกำลังเริ่มแพ็กเกจ. คนที่เลือกแพ็กเกจไม่ได้: "ส่วนลดจากงานใช้ตอนซื้อแพ็กเกจของร้าน เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจสอบถามในแชทนี้ได้เลยค่ะ"
- **คำตอบ** (โค้ดคำนวณจำนวนบาทจากสตางค์และวันที่ไทย พ.ศ. เอง ไม่มีรหัสระบบ ยกเว้นรหัสส่วนลดที่ไม่แสดงใน LINE):
  - มีส่วนลดที่ใช้ได้ และร้านเริ่มแพ็กเกจได้ตอนนี้: "• ส่วนลดจากงาน {ชื่องาน} · ลดบิลแรก {X} บาท · ใช้ได้ถึง {วันที่}" + "ใช้ได้ตอนซื้อแพ็กเกจแบบจ่ายครั้งเดียวด้วยบัตรหรือ PromptPay ระบบจะลดให้ในบิลแรกของร้านค่ะ" + ปุ่ม "เลือกแพ็กเกจ" (ลิงก์ one-tap เดียวกับการ์ดโปรโมชั่น)
  - มีส่วนลดแต่ร้านมีแพ็กเกจอยู่แล้ว: "ร้านนี้มีแพ็กเกจอยู่แล้ว จึงใช้ส่วนลดบิลแรกกับร้านนี้ไม่ได้ค่ะ" + "ส่วนลดบิลแรกใช้กับร้านที่เริ่มแพ็กเกจใหม่ เช่น เปิดร้านใหม่ค่ะ" + "สิทธิ์สำหรับร้านที่มีแพ็กเกจอยู่แล้วจะเปิดให้ใช้เร็วๆ นี้ค่ะ" (SD-F ยังไม่สร้าง ห้ามบอกวัน); ร้านเคยใช้แล้ว/มีดีล ใช้ข้อความ §4.2 และ §8 แทน ไม่มีปุ่ม
  - ใช้แล้ว/หมดอายุ/อยู่ระหว่างชำระ/ระงับ/ยกเลิก: บอกทีละใบ + วิธีรับใหม่
  - ไม่มีเลย: "ตอนนี้ยังไม่มีส่วนลดจากงานค่ะ" + "รับส่วนลดได้โดยสแกน QR จากพนักงานขายของมั่งมีในงานอีเวนต์ค่ะ"
- **ร้านที่ถูกล็อก** (ไม่มีแพ็กเกจ/หมดอายุ) ยังได้การ์ดแพ็กเกจเดิม (J1/R14) ซึ่งพาไปหน้าแพ็กเกจที่มีกล่องส่วนลดอยู่แล้ว
- **เว็บ**: หน้าแพ็กเกจเรียก SD-B และเมื่อผู้ถือมีส่วนลดที่ใช้ได้แต่ร้านไม่ได้กำลังเริ่มแพ็กเกจ แสดงหนึ่งบรรทัดเหนือสถานะแพ็กเกจ: "คุณมีส่วนลดจากงาน {ชื่องาน} ลดบิลแรก {X} บาท (ใช้ได้ถึง {วันที่}) ใช้ได้กับร้านที่เริ่มแพ็กเกจใหม่" (ไม่มีปุ่ม)

## 9. สิทธิ์ทีมขาย

| การกระทำ | SYSTEM_ADMIN | MANGMEE_SALES_LEAD | MANGMEE_SALES | key |
|---|---|---|---|---|
| สร้าง แก้ พัก ระงับชุด และเพิกถอนส่วนลด | ทุกชุด | ชุดของตัวเอง; มอบหมายได้เฉพาะทีมตัวเอง | ไม่ได้ | `sales.event.manage` (ใหม่) |
| ดูชุดและรายการส่วนลด | ทั้งหมด | ชุดของตัวเองและทีม | ชุดที่ได้รับมอบหมาย เฉพาะรายการที่ตัวเองแจก | `sales.console.read` |
| แสดง QR | เฉพาะผู้ที่ได้รับมอบหมายในชุด | เฉพาะผู้ที่ได้รับมอบหมายในชุด | เฉพาะผู้ที่ได้รับมอบหมายในชุด | `sales.console.read` + assignment ที่ active |
| รายงาน | ทั้งหมด | ทุกทีม ตาม `visibleAgents` | ไม่ได้ | `sales.report.read` |

เพิ่ม key ใน contracts (`sales.ts:9-10`), registry (`apps/api/src/modules/auth/permission-registry.ts:108-115`) และ grant ของหัวหน้า (`:565`); SYSTEM_ADMIN ได้เองจาก `...SALES_PERMISSION_KEYS` (`:555`); ปรับ `permission-registry.spec.ts:268-288`. ฐานข้อมูลได้ key ใหม่จาก `prisma/sync-permissions.ts` ใน release task (`infra/prod-ecs-express/run-release-task.sh:684`). ร้านค้าไม่ได้สิทธิ์ใหม่ (ทั้งสองเส้นทางใช้ `company.plan.manage` เดิม). คิวทีมขายไม่เปิดลิงก์ Checkout เอกสารการเงิน หรือตัวตน LINE

## 10. รายงานและ settlement

รายงานต่อ งาน → ชุด → เซลล์: แจกแล้ว, ใช้เป็นส่วนลดราคา, กำลังชำระ, ใช้เป็นเครดิต, หมดอายุ, เพิกถอน, คงค้างที่ยังใช้ได้ (จำนวน และมูลค่าส่วนลด/เครดิตสูงสุดที่ยังใช้ได้ = ภาระที่ยังเปิด), มูลค่าส่วนลดที่ให้ (Σ `appliedDiscountSatang` ของ USED ทางส่วนลด), ยอดรับจริงของบิลที่ใช้ (Σ `BillingInvoice.paidSatang`), คืนแล้ว (Σ `refundedSatang`), สุทธิ, เครดิต AI และจำนวนอ่านรูปใบเสร็จที่ให้ (Σ units ของ lot `SALES_EVENT`). นับบิลละครั้ง (`invoiceId` unique). ไม่รวมในยอดขายของเซลล์ (`SalesAttribution`, `sales-reports.service.ts:51-66`) — ยอดขายยังนับตามดีลและรหัสแนะนำ (ค่าเริ่มต้น SD-Q3); เครดิตไม่มีรายรับจึงไม่มียอดขาย. ไม่แสดงตัวตน LINE หรือเลขเอกสาร; แสดงชื่อร้านเมื่อใช้แล้ว (ทีมขายค้นชื่อร้านได้อยู่แล้ว). Settlement ไม่เปลี่ยน: จับคู่จาก balance transaction จริง (`billing-settlement-source.ts`); ส่วนลดสะท้อนเป็นยอดรับที่ต่ำลง ไม่มีรายการส่วนลดแยกใน Stripe; เครดิตไม่มีรายการทางการเงิน

## 11. Rollout, gate และ rollback

- **ออกพร้อม add-on (SD-O6)**: งานนี้กับ add-on เครดิต AI และอ่านรูปอยู่ใน candidate เดียว ผ่าน UAT → READY → production รอบเดียวกัน (~~และเปิด gate พร้อมกัน~~ — ไม่มี gate ทั้งงานนี้ SD-O10 และ add-on O-04). เส้นทางเครดิตต้องมี PR B และ PR C ของแผน add-on (กลไกเพิ่มยอด) อยู่ใน candidate
- ~~gate เดียวของงานนี้ `event_discounts` ใน `BILLING_ACTIONS`~~ (ยกเลิกโดย SD-O10; ข้อความเดิมในข้อนี้และข้อถัดไปเป็นประวัติ) (เก็บใน `gatesJson`; binary เก่าไม่รู้จัก key จึงข้ามไป — `effectiveBillingGates`, `billing-policy.ts:15-17`); ตั้งผ่าน SET_ACTION_GATE แบบ reviewed เดิม; ไม่มี env ใหม่ ไม่มี key ใหม่ใน `policyJson`
- ปิด gate: claim และออก QR ถูกปฏิเสธ; quote ไม่ใส่ข้อเสนอ; Checkout ของ quote ที่เลือก "ใช้" ได้ stale; ปุ่มรับเครดิตปิด. ไม่หยุด: การจองที่ยอมรับแล้ว, การใช้สิทธิ์ราคา, การปล่อยการจอง, การผูกต่ออายุ, lot เครดิตที่รับแล้ว, คืนเงิน, ประวัติ และรายงาน (reconciler ไม่อ่าน gate นี้)
- ร้านเดิมที่ยังไม่ย้ายไปรอบเครดิตใหม่ (add-on §11) ยังรับเครดิตไม่ได้ (SD-Q9): ก่อนจัดงานแรกหลังเปิด ให้ readback จำนวนร้านที่จ่ายเงินแล้วแต่ยังไม่ย้าย
- VAT: ใช้สูตร §5.1 ทุกแบบภาษี; แบบที่มี VAT ต้องผ่าน native proof ก่อนบริษัทจด VAT ซึ่งเป็นข้อกำหนดเดิมของ billing (SED-35) — ใส่เคสมีส่วนลดหนึ่งเคสต่อแบบ
- Rollback: migration additive (binary เก่าไม่อ่านตารางใหม่). ก่อน rollback ต้องอ่านแล้วได้ศูนย์ทั้งสองข้อ: รายการ RESERVED และบัญชี CARD_AUTO ที่ `activeAttemptId` ชี้ attempt ที่มี `eventDiscount.choice = 'USE'` (รอผูก). ไม่เป็นศูนย์ → ปิด gate รอจนหมด หรือ forward-fix. เพราะออกพร้อม add-on จึงอยู่ใต้กติกาถอยกลับของ add-on ด้วย: ห้าม rollback ไป binary ที่ไม่รู้จัก lot หรืออ่าน policy ใหม่ไม่ได้ (add-on §11.4) — lot `SALES_EVENT` ที่ให้แล้วคงอยู่. หลัง rollback subscription งวดแรกที่ `trialing` ของส่วนลดจะกด "หยุดต่ออายุ" ไม่ได้จน deploy ใหม่ (binary เก่าไม่มี predicate ข้อ 5.3-5) — บันทึกใน runbook
- ปล่อยพร้อมกัน: ทุก PR ของงานนี้อยู่ใน release ร่วมกับ add-on; ถ้าจำเป็นต้อง merge ก่อน ให้ gate ปิดไว้จนถึงขั้นเปิดร่วม

## 12. คำถามถึง Owner (ตอบครบ 2026-09-29)

Owner ตอบ 2026-09-29 “ตามค่าเริ่มต้น” (SD-O9): ทุกข้อที่เคยค้างใช้ค่าเริ่มต้นที่เสนอ

| ID | คำถาม | สถานะ / มติ |
|---|---|---|
| SD-Q1 | วันหมดอายุ = ปิดรับ + 30 วัน? | **ตัดสินแล้ว 2026-09-29 → SD-O9 (รับค่าเริ่มต้น)**: ใช่; ค่าคงที่ 30 วัน ไม่ให้ตั้งต่อชุด; ใช้กับทั้งสองทาง |
| SD-Q2 | ร้านที่เคยจ่ายแล้วหมดอายุแล้วซื้อใหม่ (RESTART) นับเป็นบิลแรกไหม; ซื้อต่อก่อนหมด (REPEAT หรือเปลี่ยนแพ็กรอบถัดไป) นับเป็นการต่ออายุไหม | **ตัดสินแล้ว 2026-09-29 → SD-O9 (รับค่าเริ่มต้น)**: RESTART ลดได้; REPEAT และ SCHEDULED_CHANGE ลดไม่ได้ (ร้านสถานะนั้นรับเป็นเครดิต) |
| SD-Q3 | ใครได้เครดิตยอดขาย เมื่อร้านสมัครด้วยรหัสของเซลล์ A แต่ใช้ส่วนลดจากเซลล์ B; เซลล์รับส่วนลดของตัวเองได้ไหม | **ตัดสินแล้ว 2026-09-29 → SD-O9 (รับค่าเริ่มต้น)**: ยอดขายยังตาม SalesAttribution เดิม (ดีล/รหัสแนะนำ); รายงานงานเป็นตัวเลขแยก ไม่รวมในยอดเซลล์; บัญชีใน platform tenant รับส่วนลดไม่ได้ |
| SD-Q4 | "หนึ่งรายการต่อร้าน" คือตลอดอายุร้านไหม | **ตกลงในหลักการ 2026-09-29 → SD-O5** (ส่วนลดราคาครั้งเดียวตลอดอายุร้าน) |
| SD-Q5 | ต้องแจ้งเตือนผู้ถือทาง LINE เช่น ใกล้หมดอายุหรือถูกเพิกถอนไหม | **ตัดสินแล้ว 2026-09-29 → SD-O9 (รับค่าเริ่มต้น)**: ไม่ทำใน V1; ถ้าทำภายหลัง ข้อความแชตห้ามมีตัวเลขหรือวันที่ (กติกาเดิม `sales-deal.logic.ts:198-204`) |
| SD-Q6 | ต้องมีปุ่ม "ไม่ใช้ส่วนลดครั้งนี้" ไหม | **ตัดสินแล้ว 2026-09-29 → SD-O4** (มีตัวเลือก; เลือก "ใช้" ไว้ให้แล้ว) |
| SD-Q7 | โปรโมชันสำหรับร้านเดิมเมื่อมีงานใหม่ | **ตัดสินแล้ว 2026-09-29 → SD-O6** (ทาง b: เครดิตผ่านกลไกของ add-on และออกพร้อมกัน) |
| SD-Q8 | ร้านเดิมรับเครดิตจากงานได้ครั้งเดียวต่อชุดไหม และนับรวมกับส่วนลดราคาจากชุดเดียวกันไหม | **ตัดสินแล้ว 2026-09-29 → SD-O9 (รับค่าเริ่มต้น)**: ร้านหนึ่งใช้ส่วนลดจากชุดเดียวกันได้ครั้งเดียวไม่ว่าทางไหน; ร้านเดิมรับเครดิตได้อีกเมื่อมีชุดใหม่ |
| SD-Q9 | ร้านเดิมที่ยังไม่ย้ายไปรอบเครดิตใหม่ของ add-on (ช่วงแรกหลังเปิด) จะรับเครดิตอย่างไร | **ตัดสินแล้ว 2026-09-29 → SD-O9 (รับค่าเริ่มต้น)**: รับได้หลังร้านย้ายเท่านั้น (กติกาเดียวกับยอดที่ทีมงานเพิ่มให้, add-on §16 ข้อ 9); หน้าแพ็กเกจบอกวันที่รับได้; จัดงานแรกหลังรอบย้ายของร้านที่จ่ายเงินแล้วเสร็จ (อย่างช้าหนึ่งรอบเดือนหลังเปิด) |

## 13. เกณฑ์รับงาน

| ID | กรณีและผลที่ต้องได้ |
|---|---|
| SD-E01 | หัวหน้าสร้างชุด: ตรวจฟิลด์, จำนวนเต็มบาท, ค่าเครดิตเป็นจำนวนเต็ม, อย่างน้อยหนึ่งค่ามากกว่า 0, ช่วง `[เปิด, ปิด)` แบบเวลาไทย, ขั้นต่ำต่อทุก tier/รอบใน scope; หัวหน้ามอบหมายได้เฉพาะทีมตัวเอง; audit ครบ |
| SD-E02 | QR: เฉพาะผู้แจกที่ active; ~~อายุ `min(5 นาที, ปิดรับ)`~~ ใช้ได้จนชุดปิดรับ ตัดสินจากชุดตอนสแกน — QR เก่าใช้ได้หลังผ่าน 5 นาที, ขยายช่วงรับแล้ว QR เดิมใช้ต่อได้ (SD-O11); ชุด PAUSED/SUSPENDED หรือนอกช่วงถูกปฏิเสธ; ถอดเซลล์แล้ว QR เดิมใช้ไม่ได้ |
| SD-E03 | Claim: LINE token ที่ตรวจแล้ว; ผูกตัวตน LINE; สแกนซ้ำได้รายการเดิม; cap=1 สองคนสแกนพร้อมกันได้หนึ่งรายการ; บัญชี platform tenant ถูกปฏิเสธ; token ไม่อยู่ใน log; หน้า LIFF แสดงเฉพาะสิ่งที่ชุดให้ |
| SD-E04 | รับก่อนมีบัญชี → สมัครผ่าน LIFF → ร้าน "ยังไม่มีแพ็กเกจ" เห็นตัวเลือกและบรรทัดส่วนลด (route อยู่ใน allowlist) → ใช้ → CARD_ONCE รายเดือนลดแล้ว → จ่าย → apply → ร้านปลดล็อกในที่ → ส่วนลด USED (`redeemedAs = DISCOUNT`) |
| SD-E05 | สี่โหมดเมื่อเลือกใช้: CARD_ONCE และ PROMPTPAY_ONCE ลด `unit_amount`; PROMPTPAY_RENEW บิล QR แรกลด บิลถัดไปราคาเต็ม; CARD_AUTO จ่ายงวดแรกครั้งเดียว + subscription `trialing` ราคาเต็มถึงสิ้นงวด → รอบสองราคาเต็ม apply เป็น RENEWAL; "หยุดต่ออายุ" ระหว่างงวดแรกได้ |
| SD-E06 | RESTART ลดได้; REPEAT, SCHEDULED_CHANGE, UPGRADE, FULL_PACKAGE_UPGRADE, ADVANCE_DEAL และการซื้อ ADD_ON ลดไม่ได้ (ไม่มีตัวเลือก ไม่ลด ไม่จอง) |
| SD-E07 | ดีลกับส่วนลดราคา: ดีล APPROVED ที่ยังไม่หมดอายุหรือ PAID → ไม่มีตัวเลือกและแสดงข้อความ §4.2; quote ดีลไม่ลด; ดีลอนุมัติระหว่าง quote ที่เลือกใช้กับ Checkout → stale |
| SD-E08 | หนึ่งร้าน: หลัง RESERVED/USED ทางส่วนลด รายการของผู้ถือคนอื่นหรือชุดอื่นไม่ถูกเสนอให้ลดร้านนี้อีก; สองคนจองให้ร้านเดียวกันพร้อมกันได้หนึ่ง; คนเดียวเลือกใช้สองร้านพร้อมกัน ร้านที่สอง stale แล้วเลือกใหม่ได้ |
| SD-E09 | หมดอายุ: รายการหมดอายุไม่ถูกเสนอในทั้งสองทาง; จองก่อนหมดอายุแล้วจ่ายหลังหมดอายุ → USED; lot เครดิตที่รับแล้วมีอายุ 12 เดือนของตัวเอง; หน้าจอแสดง "ใช้ได้ถึง" |
| SD-E10 | Checkout: ล้มหรือถูกปฏิเสธ → ปล่อย; session หมดอายุ, ลูกค้ากดยกเลิก, แอดมินยุติ → ปล่อย; UNKNOWN → คงการจองจนรายการเดิมจบ |
| SD-E11 | ถือเงินไว้ตรวจ: USED เกิดก่อนทางออก HELD; RETRY_APPLY และ IMPORT_INVOICE ตรวจด้วย snapshot ของ attempt ได้ผลเดิม; รายการไม่ตรง → issue `EVENT_DISCOUNT_REVIEW` โดยไม่ขวาง apply |
| SD-E12 | คืนเงินบางส่วนและทั้งหมด/ข้อพิพาทของบิลที่ลด: คืนไม่เกินยอดจริง; ส่วนลดคง USED; REFERRAL (ถ้ามี) บันทึกยอดจริงและหักคืนจนสุทธิเป็นศูนย์; รายงานงานหักคืน; CARD_AUTO งวดแรก: หยุดต่ออายุแล้วยุติแพ็กได้ |
| SD-E13 | รอบต่ออายุไม่เปลี่ยน: ตรวจด้วย contract snapshot ราคาเต็ม; จ่ายรอบแรกหลัง trial ไม่ผ่าน → grace เริ่มตามเดิม; เทสต์เดิมของ collection, schedule, repeat, price-return, free-days, grace และ paid-invoice ผ่านโดยไม่แก้ |
| SD-E14 | ราคา: ตัวอย่าง 499/100 ทั้งสามแบบภาษี; เต็มบาทเท่านั้น; ขั้นต่ำ ฿10; ผลต่อการ์ดตรงกับ quote และ Checkout |
| SD-E15 | สิทธิ์: พนักงานในร้านไม่เห็นหน้าแพ็กเกจ ใช้หรือรับเครดิตไม่ได้ และหน้า LIFF บอกวิธีที่ถูก; ผู้มีสิทธิ์จัดการแพ็กเกจคนอื่นไม่เห็นส่วนลดของผู้ถือ; ตาราง §9 ทดสอบผ่าน HTTP; ร้านอื่นมองไม่เห็นหรือใช้ไม่ได้ |
| SD-E16 | Gate ปิด: claim ถูกปฏิเสธ; quote ไม่มีข้อเสนอ; quote ที่เลือกใช้ได้ stale ที่ Checkout; ปุ่มรับเครดิตปิด; การจอง การใช้สิทธิ์ reconcile lot ที่ให้แล้ว คืนเงิน และประวัติเดินต่อ |
| SD-E17 | UI: กล่องตัวเลือก, บรรทัดการ์ดตามตัวเลือก, ขั้นตรวจยอดทั้งสองแบบ, "รอบถัดไปชำระราคาเต็ม", กล่องรับเครดิต, หน้า return, ประวัติ ที่ 390 px; ไม่มีแท็บใหม่; ไม่มีคำว่า "ตั๋ว" |
| SD-E18 | รายงาน: ตัวเลขทุกคอลัมน์ §10 ถูกต้อง แยกส่วนลดกับเครดิต; ไม่มีตัวตน LINE; กติกา `visibleAgents` |
| SD-E19 | Rollback: migration additive; ตรวจเงื่อนไข §11 ได้จากคำสั่งอ่าน; lot `SALES_EVENT` คงอยู่ตามกติกาของ add-on |
| SD-E20 | แอดมิน: ค้นด้วยเลขส่วนลดเจอร้าน ทาง และบิลหรือ lot; หน้าร้านในระบบแอดมินแสดงรายการส่วนลด |
| SD-E21 | ค่าเริ่มต้น: หน้าแพ็กเกจของร้านใหม่ที่มีข้อเสนอเปิดมาโดยเลือก "ใช้" ไว้; quote ที่ไม่ส่ง `eventDiscountChoice` ได้ส่วนลด |
| SD-E22 | ไม่ใช้ครั้งนี้: quote และ Checkout ราคาเต็ม; ส่วนลดยัง ISSUED; Checkout ไม่ stale แม้มีรายการใหม่เกิดหลัง quote; เปลี่ยนเป็น "ใช้" ในขั้นตรวจยอดได้ quote ใหม่ที่ลดแล้ว |
| SD-E23 | ไม่ใช้กับร้าน A แล้วใช้กับร้าน B: ร้าน A จ่ายราคาเต็ม; ผู้ถือเลือกใช้ในการซื้อครั้งแรกของร้าน B ได้ส่วนลด; ร้าน A ไม่ถูกนับว่าใช้ส่วนลดราคาแล้ว |
| SD-E24 | ข้อเสนอเกิดหลัง quote: quote ออกตอนผู้ถือยังไม่มีส่วนลด → รับส่วนลด → Checkout ได้ stale → quote ใหม่แสดงตัวเลือก |
| SD-E25 | ร้านเดิมรับเครดิต: ร้านที่มีแพ็กเกจที่จ่ายแล้วใช้งาน (บัตรต่ออายุอัตโนมัติ, QR, จ่ายครั้งเดียว) กด "รับเครดิตเข้าร้านนี้" → lot `SALES_EVENT` ของเครดิต AI และ/หรือรูปตามชุด อายุ 12 เดือน อยู่ใน "ยอดเพิ่มเติม" ใช้ตามลำดับ แพ็กเกจ → ทีมงาน → ซื้อ; ไม่มี quote, attempt, Stripe call, ใบแจ้งหนี้ หรือการเปลี่ยน term; กดซ้ำหรือคำตอบหายไม่เพิ่มยอดซ้ำ; ส่วนลด USED (`redeemedAs = CREDIT`) |
| SD-E26 | ครั้งเดียวต่อร้านต่อชุด (ค่าเริ่มต้น SD-Q8): รายการที่สองจากชุดเดียวกันถูกปฏิเสธที่ร้านเดิม (`SALES_EVENT_BATCH_ALREADY_USED`); รายการจากชุดใหม่รับได้ |
| SD-E27 | ผู้ถือดูแลหลายร้าน: เห็นกล่องรับเครดิตในทุกร้านเดิมที่ตนเป็นผู้มีสิทธิ์จัดการแพ็กเกจ; รับที่ร้านที่เลือก; ร้านอื่นไม่เห็นรายการนั้นอีก; การรับเครดิตกับการจองส่วนลดราคาของรายการเดียวกันพร้อมกันสำเร็จได้ทางเดียว |
| SD-E28 | ร้านใหม่ในงานแรก แล้วเป็นร้านเดิมในงานถัดไป: งาน 1 ใช้ส่วนลดบิลแรก; งาน 2 (ชุดใหม่) รับเครดิตได้; ส่วนลดราคาจากงาน 2 ไม่ถูกเสนอให้ร้านนี้อีก (SD-O5) |
| SD-E29 | ร้านที่มีดีลที่กำลังใช้ รับเครดิตจากงานได้ (SD-O8); ราคาดีลและ attribution ของดีลไม่เปลี่ยน |
| SD-E30 | ร้านเดิมที่ยังไม่ย้ายไปรอบเครดิตใหม่หรือยังไม่พร้อมรับ lot: ไม่มีปุ่มรับ แสดงวันที่รับได้ถ้ารู้ ส่วนลดยัง ISSUED (ค่าเริ่มต้น SD-Q9); ร้านในช่วง grace เห็นข้อความให้ชำระรอบใหม่ก่อน |
| SD-E31 | Release ร่วม: candidate เดียวมีทั้งงานนี้และ add-on PR A–G; เปิด `event_discounts`, `addon_chat_credit`, `addon_receipt_image` ในขั้นเดียว; ปิดทีละ gate ได้โดยไม่กระทบยอดที่ให้แล้ว |

## 14. พฤติกรรมของ Stripe ที่ต้องพิสูจน์จริง

API version `2026-08-26.dahlia` (`packages/contracts/src/billing.ts:7`). เอกสาร provider ไม่แทนการพิสูจน์ในบัญชีจริง; แต่ละข้อต้องมีการตรวจบน UAT (test mode). เส้นทางเครดิตไม่มีการเรียก Stripe:

| พฤติกรรมที่แบบนี้พึ่ง | การตรวจบน UAT |
|---|---|
| Checkout `mode: 'payment'` + `price_data.unit_amount` ที่ไม่ใช่ราคาในรายการ ออก session, invoice และบรรทัดที่ยอดและภาษีตรง `quoteTotals(unitAmount)` ทุกสตางค์ | ซื้อ CARD_ONCE และ PROMPTPAY_ONCE ที่เลือกใช้ส่วนลด แล้ว reconcile ผ่าน `paidPackageCheckoutEvidence` |
| ขั้นต่ำการเรียกเก็บ THB ของ Stripe ไม่เกิน ฿10 | quote ที่ยอดหลังลดเท่ากับ ฿10 ชำระสำเร็จ |
| `setup_future_usage: 'off_session'` บน one-time Checkout เก็บบัตรไว้กับ customer และ subscription ที่มี `trial_end` ซึ่งสร้างภายหลังตัดบัตรนั้นได้เมื่อ trial จบ (ใช้ใน advance deal แล้ว แต่ยังไม่มีหลักฐาน UAT ของเส้นทางบิลแรก) | CARD_AUTO ที่เลือกใช้ส่วนลด + Stripe test clock เลื่อนถึงสิ้นงวด → บิลรอบสองราคาเต็มจ่ายสำเร็จและ apply เป็น RENEWAL |
| subscription ที่มี trial ออกบิล $0 `subscription_create` ตอนสร้าง และบิลเมื่อ trial จบเป็น `subscription_cycle` | ดูใน test clock เดียวกัน |
| บัตรถูกปฏิเสธเมื่อจบงวดแรก → subscription `past_due` → grace เริ่มตามเดิม | test card ที่ปฏิเสธหลัง trial |
| "หยุดต่ออายุ" บน subscription ที่ `trialing` ทำงานและไม่ออกบิล | กดจากหน้าแพ็กเกจระหว่างงวดแรก |
| ภาษีแบบรวม/แยก VAT บนยอดที่ลดแล้วตรงกับสูตร (ไม่มี tie เมื่อเต็มบาท) | ก่อนจด VAT เท่านั้น: ช่วงทดสอบ policy บน UAT หรือบัญชีทดสอบแยก |
| ใบเสร็จและใบแจ้งหนี้แสดงราคาสุทธิ ไม่มีบรรทัดส่วนลด | เปิดเอกสารจริงจาก UAT |

ลิงก์เอกสาร Stripe เรื่อง coupon และ invoice transitions ใน DRAFT v1 ไม่เกี่ยวแล้ว เพราะไม่ใช้ coupon
