# Spec: ส่วนลดจากงานขาย — รับจาก QR ในงาน ลดบิลแรกของการซื้อแพ็กเกจ

ปรับล่าสุด 2026-09-29 · **DRAFT v2 — ใช้มติ Owner และมติเทคนิค 2026-09-29 แล้ว; คำถามค้าง §12 มีค่าเริ่มต้น ต้องได้คำตอบหรือยอมรับค่าเริ่มต้นก่อนเริ่ม PR SD-C**

- ฐานโค้ดที่ตรวจ: develop `8a91bc1c` และ `origin/develop` `69fba9d3` (ต่างจาก `8a91bc1c` เฉพาะ `.github/workflows/extended-tests.yml:286`). ทุก `file:line` ในเอกสารนี้อ้างฐานนี้ และตรวจกับไฟล์จริงแล้ว
- เอกสารคู่กัน: [Plan](../plans/sales-event-discounts-plan-th.md) · [Audit และผลตรวจซ้ำบน develop](../research/sales-event-discounts-e2e-impact-audit-2026-09-29-th.md). Memory ของงานนี้ยังไม่มีใน repo (ลิงก์ `../agent-memory/sales-event-discounts-2026-09-28.md` ของ DRAFT v1 ไม่มีไฟล์)
- เกี่ยวข้อง: [Sales deals](mangmee-sales-deals-and-locked-signup-spec-th.md) (§4 "ไม่มี coupon บน subscription" ใช้ต่อ) · [ซื้อแพ็กเกจได้ทันทีหลังสมัคร](mangmee-purchase-without-setup-spec-th.md) (R-A1, R-A6, R-B1, R-C1, R-C2, D-PF-5, D-PF-10/R-C11) · [Add-on เครดิต AI และอ่านรูป](chat-credit-and-receipt-addons-spec-th.md) (เจ้าของ layout หน้า billing และฐาน billing ร่วม: มติ T-02, T-07, T-08)
- รหัสของเอกสารชุดนี้ขึ้นต้น `SD-`: SD-O มติ Owner, SD-T มติเทคนิค, SD-Q คำถามค้าง, SD-E เกณฑ์รับงาน, SD-A ผลตรวจ — กันชนกับรหัส A/E/O/T ของสเปก add-on

## 0. สรุป

หัวหน้าทีมขายตั้ง "ชุดส่วนลด" ของงาน → เซลล์ที่ได้รับมอบหมายเปิด QR อายุไม่เกิน 5 นาที → คนที่สแกนผ่าน LINE ได้ส่วนลดหนึ่งรายการ ผูกกับบัญชี LINE ของคนนั้น → เมื่อคนนั้นเป็นเจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจ และซื้อแพ็กเกจที่เริ่มแพ็กเกจใหม่ของร้าน (ซื้อครั้งแรก หรือซื้อใหม่หลังหมดอายุ) ก่อนส่วนลดหมดอายุ ระบบลด **บิลแรกเท่านั้น**; รอบต่ออายุเก็บราคาเต็ม → ใช้สิทธิ์สำเร็จเมื่อยืนยันรับเงินจริง

- ไม่มี coupon ใน Stripe ทุกโหมด: ลดด้วย `price_data.unit_amount` ที่ server คำนวณ (§5)
- ไม่มีแท็บหรือ section ใหม่บนหน้า billing: เป็นบรรทัดราคาบนการ์ดแพ็กเกจและในขั้นตรวจยอด (§8)
- ไม่ซ้อนกับดีลขาย; หนึ่งร้านใช้ได้หนึ่งรายการ; add-on ไม่ลด (§4)

## 1. มติ

### 1.1 มติ Owner (2026-09-29)

| ID | มติ | ผลต่อแบบ | finding ที่ปิด |
|---|---|---|---|
| SD-O1 | ลด **บิลแรกเท่านั้น**; รอบต่ออายุไม่ลดเลย; ไม่มี Stripe coupon บน subscription; กติกา sales-deals §4 "ไม่มี coupon บน subscription" คงเดิม | กลไกต่อโหมด §5.2; CARD_AUTO = จ่ายงวดแรกครั้งเดียวแล้วผูก subscription ราคาเต็มที่เริ่มเก็บเมื่อสิ้นงวดแรก §5.3; guard ของการต่ออายุและ grace ไม่แตะ §5.4 | SED-01, SED-02 (ไม่เกิดแล้ว), SED-07 |
| SD-O2 | ไม่ซ้อนกับดีลขาย: ร้านที่มีดีลที่อนุมัติแล้วหรือกำลังใช้ ได้ราคาดีลอย่างเดียว; โค้ด attribution ของดีล (`billing-package-request.ts`) ไม่เปลี่ยน | เงื่อนไขตรวจและข้อความ "มีดีลพิเศษอยู่แล้ว" §4.2 | SED-04 (ไม่เกิดแล้ว) |
| SD-O3 | กลุ่ม "สมัครใหม่ผ่านงาน" = ผู้ถือส่วนลด — Owner: "ตั๋วก็จะออกแค่คนที่ได้ qr คนที่มาจากช่องทางปกติ จะไม่ได้". QR 5 นาทีมีหน้าที่ **ออก** ส่วนลดเท่านั้น; ส่วนลดผูกกับคนที่สแกน (ตัวตน LINE); ใช้ได้หลังสมัครและเปิดร้าน กับบิลแรกที่เข้าเงื่อนไขของร้านนั้น จนกว่าจะหมดอายุ | ไม่ต้องจัดกลุ่มการสมัคร (ตัดตัวเลือก "กลุ่มลูกค้า"); วันหมดอายุ §4.4; หนึ่งรายการต่อร้าน §4.3; วิธีใช้ §3.4; สิ่งที่พนักงานในร้านเห็น §3.5 | SED-08, SED-34 |

### 1.2 มติเทคนิคของ Controller (2026-09-29)

| ID | มติ | อยู่ที่ |
|---|---|---|
| SD-T1 | ร้านที่ล็อกหรือยังไม่มีแพ็กเกจต้องเรียก route ของส่วนลดได้: เพิ่ม route ใน allowlist `isBillingRecoveryRoute` (`apps/api/src/modules/auth/presentation/auth.guard.ts:98-104`) และ sync pins ใน PR เดียวกัน (`auth.guard.ts` ถูก pin ที่ `infra/security/validate-production-maintenance-release.sh:25,106`) | §7.4, plan SD-C |
| SD-T2 | ลำดับงาน: (1) งานแก้ purchase flow ที่กำลังทำ → (2) ฐาน billing ร่วม (foundation): attempt และ invoice รู้ชนิดสินค้า (`productKind`) และมีช่องจอง active attempt แยกสำหรับ checkout ที่ไม่ใช่แพ็กเกจ ตามที่สเปก add-on นิยาม (T-02, T-07) → (3) ฟีเจอร์ add-on; ส่วนลดจากงานทำหลัง foundation | plan §1 |
| SD-T3 | add-on ไม่ลดเด็ดขาด (สเปก add-on O-03 ตรงกัน) | §4.1 |
| SD-T4 | หน้า billing ไม่เพิ่มแท็บ; ส่วนลดเป็นบรรทัดราคาบนการ์ดแพ็กเกจที่ใช้ได้และในขั้นตรวจยอด/ยืนยัน เช่น "ส่วนลดจากงาน {ชื่องาน} −{จำนวน} บาท (บิลแรก)"; การรับส่วนลดทำผ่าน QR และ LINE; รายการแท็บของหน้าเป็นของสเปก add-on §7.1 (T-08) | §8 |
| SD-T5 | สุขอนามัยการ implement: migration เรียงหลังตัวล่าสุดบน develop ตอนลงมือ (ตอนนี้ `20260929030000`) additive เท่านั้น ไม่มี Prisma enum; ลงทะเบียนเทสต์ผ่าน whole-chain catalog, `ci.yml` หรือ `extended-tests.yml` ไม่ใช่ `package.json`; regenerate W00 manifest เมื่อไฟล์ที่ถูก hash เปลี่ยน; `ci.yml` และ `extended-tests.yml` บน main ต้องตรงกับ develop byte ต่อ byte; ยึดแบบ `docs/plans/purchase-without-setup/xx-cross-cutting.md` | plan §3 |
| SD-T6 | ภาษาไทยเรียบ ไม่มีรหัสระบบในข้อความลูกค้า; ใช้คำ "ยังไม่มีแพ็กเกจ", "หมดอายุ", "เลือกแพ็กเกจ", "เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจ", "ทีมงาน", "อีเมลรับเอกสาร"; เงินของ AI เรียก "เครดิต AI" เท่านั้น | §8 |

### 1.3 ส่วนของ DRAFT v1 ที่ยกเลิก

ส่วนต่อไปนี้ของ DRAFT v1 (นำเข้าใน a3cc6f39) ไม่ใช้แล้ว และห้ามใช้เป็นเกณฑ์รับงาน:
- สะสมหลายรายการแล้วกด "เลือก"/"ใช้ส่วนลด" แบบ toggle, selection ต่อ account, `selectionVersion`, คำสั่ง select/clear และรหัส `SELECTION_*` → ระบบใช้ส่วนลดกับบิลแรกที่เข้าเงื่อนไขอัตโนมัติ (§4.3)
- section "ส่วนลด" ก่อนแพ็กเกจ, แท็บ "ส่วนลดที่มี N / ประวัติส่วนลด", กล่องเลื่อน 3 แถว และ dropdown ของลูกค้า → บรรทัดราคา (§8)
- target แบบ NEXT_RENEWAL/PURCHASE_INTENT/FIRST_PURCHASE, สถานะ QUEUED/ARMED, detach proof, ลดบิลต่ออายุรายเดือน/รายปี, coupon หรือ invoice discount และข้อยกเว้นกฎ no-coupon → ไม่มี (SD-O1)
- ตัวเลือกกลุ่มลูกค้า "ทั้งหมด / สมัครใหม่ผ่านงาน / บริษัทเดิม" → ผู้ถือคือคนที่สแกน (SD-O3)
- "ไม่มีวันหมดอายุหลังรับ" → มีวันหมดอายุ (§4.4)
- ส่วนลดสำหรับดีล (อนุมัติแล้ว/ล่วงหน้า/ต่ออายุอัตโนมัติ) และการให้เครดิตยอดขายตามเซลล์ผู้แจกแทน attribution เดิม → ไม่ซ้อนดีล (SD-O2); ยอดขายของเซลล์คงตามเดิม (§10, SD-Q3)
- เดโมและหลักฐาน 53 walkthroughs/63 assertions (`docs/evidence/sales-ticket-demo-2026-09-28/` ไม่มีใน repo) → เป็นประวัติ ใช้รับรองแบบนี้ไม่ได้

## 2. คำศัพท์และขอบเขต

| คำ | ความหมาย |
|---|---|
| งาน | ชื่องาน (ข้อความ) ใช้จัดกลุ่มรายงาน ไม่มี record ของตัวเอง |
| ชุดส่วนลด | ค่าที่หัวหน้าตั้ง: ชื่องาน, ชื่อชุด, จำนวนเงินลด, จำนวนแจกสูงสุด, ช่วงเปิดรับ, แพ็กเกจ/รอบที่ใช้ได้, เซลล์ผู้แจก (model `SalesEventBatch`) |
| ส่วนลดจากงาน | สิทธิ์หนึ่งรายการที่ออกให้คนสแกน QR (model `SalesEventTicket`); บน UI ทุกบทบาทเรียก "ส่วนลด" หรือ "ส่วนลดจากงาน" ไม่ใช้คำว่า "ตั๋ว"; ชื่อ technical ใช้ ticket ได้ |
| ผู้ถือ | ตัวตน LINE ที่สแกน (provider LINE + channel id + LINE user id แบบเดียวกับ `ExternalIdentity`, `apps/api/prisma/schema.prisma:833-847`); ใช้ได้เมื่อบัญชีมั่งมีที่ผูก LINE นี้เป็นผู้มีสิทธิ์จัดการแพ็กเกจของร้าน |
| บิลแรก | บิลเดียวของการซื้อแบบจ่ายครั้งเดียว หรือบิลงวดแรกของการซื้อแบบต่ออายุ ในการซื้อที่ **เริ่มแพ็กเกจใหม่** ของร้าน (§4.1) |

ในขอบเขต: ตั้งชุด, มอบหมายเซลล์, QR, รับผ่าน LINE (LIFF), ลดบิลแรกใน 4 โหมดชำระเงิน, ถือเงิน/กู้รายการ/คืนเงิน, รายงานทีมขาย, การค้นหาของแอดมิน

นอกขอบเขต: ลดรอบต่ออายุ; ลด add-on/ส่วนต่างอัปเกรด/หนี้/ดีล; coupon หรือ promotion code สาธารณะ; customer balance; การแจ้งเตือน LINE/อีเมลเรื่องส่วนลด (SD-Q5); การ์ดโปรโมชั่น LINE (`apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts:313`) และข้อความนโยบายสาธารณะ (`line-public-policy.logic.ts:8`) ที่ยังแสดงราคาปกติ; เว็บการตลาด; AI tool (AI Gateway ไม่เขียนเงินหรือส่วนลด)

## 3. Journey

### 3.1 หัวหน้าตั้งชุดส่วนลด

หน้าใหม่ `/sales/events` ในคอนโซลทีมขาย ฟอร์มหนึ่งฟอร์มต่อหนึ่งชุด:
- ชื่องาน และชื่อชุด: ข้อความ 1–120 ตัวหลัง trim
- ส่วนลด (บาท): จำนวนเต็มบาท ≥ 1 เก็บเป็นสตางค์ (×100). จำนวนเต็มบาททำให้ VAT แบบแยกไม่มีเศษ .5 สตางค์ (SED-39)
- จำนวนแจกสูงสุด ≥ 1: นับตลอดอายุชุด ไม่คืนเมื่อเพิกถอนหรือคืนเงิน
- เปิดรับ / ปิดรับ: วันเวลาไทย กรอกด้วย `datetime-local` แล้วแปลง `${value}+07:00` แบบเดียวกับ `apps/web/src/features/billing-admin/BillingReceiptAdjustmentsPage.tsx:47,80`; server เก็บ UTC เป็นช่วง `[เปิดรับ, ปิดรับ)`; หน้าจอแสดง "ปิดรับ {วันที่ เวลา}"; ไม่ใช้ `ThemedDate` เพราะรองรับแค่ `'date' | 'month'` (`apps/web/src/common/components/field/ThemedDate.tsx:31`)
- แพ็กเกจที่ใช้ได้: checkbox ของ tier ที่ขาย และของรอบรายเดือน/รายปี; ค่าเริ่มต้นเลือกทั้งหมด
- เซลล์ผู้แจก: รายการ checkbox ในฟีเจอร์ พร้อมช่องค้นหาชื่อที่ถาม server และแบ่งหน้า; หัวหน้าเห็นเฉพาะทีมตัวเองตามกติกาเดิมของ `apps/api/src/modules/sales-console/application/sales-agents.service.ts:78-86`, SYSTEM_ADMIN เห็นทุกคน; ต้องเลือกอย่างน้อยหนึ่งคน (ไม่อ้างว่ามี multi-select กลางให้ใช้ซ้ำ — SED-18)
- ปุ่ม "ยืนยันและเปิดแจกส่วนลด": สร้างแล้วเปิดทันที ไม่มีร่างใน server. แก้ไขใช้ "บันทึกการเปลี่ยนแปลง" (revision ใหม่ มีผลกับส่วนลดที่ออกหลังจากนั้น)

Server ปฏิเสธการเผยแพร่ถ้าส่วนลดทำให้ยอดของแพ็กเกจหรือรอบใดใน scope ต่ำกว่าขั้นต่ำ (§4.5) และบอกชื่อแพ็กเกจที่ติด

### 3.2 เซลล์เปิด QR

เซลล์ที่ยังได้รับมอบหมายในชุดที่เปิดรับ กด "แสดง QR" → server ออก token ใหม่ (สุ่ม 32 byte เก็บเฉพาะ hash) อายุ `min(ตอนนี้ + 5 นาที, ปิดรับ)` และคืนภาพ QR ที่ render ใน server ด้วย `qrSvgDataUrl` (`apps/api/src/modules/employee-access/domain/logic/employee-access.logic.ts:176-187`) ของลิงก์ `https://liff.line.me/{LINE_LIFF_ID}/event-discount?t=<token>` — แบบเดียวกับลิงก์ผูก LINE ของพนักงาน `buildLineLinkPackage` (`:154-173`). หมดเวลาแล้วกดสร้างใหม่. QR หนึ่งอันสแกนได้หลายคนภายในอายุของมัน. QR ไม่ได้พิสูจน์ว่าผู้สแกนอยู่ที่งาน

### 3.3 ลูกค้าสแกนรับผ่าน LINE

1. LINE เปิด LIFF app เดิม; `https://liff.line.me/<id>/event-discount` จะไปที่ path ย่อยของ endpoint ที่ลงทะเบียนไว้ `…/v1/auth/line/link-page/event-discount` แบบเดียวกับหน้าสมัคร `line/link-page/signup` (`apps/api/src/modules/auth/presentation/auth.controller.ts:520-526`). หน้าเป็น HTML ที่ API render ด้วย `liffPageHtml` + `LIFF_PAGE_CSP` + `LIFF_PAGE_SCRIPT` (`apps/api/src/common/security/liff-page.security.ts:7,89,131`) โดยเพิ่ม mode `event-discount`
2. หน้าเรียก `liff.getIDToken()` แล้วส่ง `POST /v1/public/event-discounts/claim` {idToken, qrToken, requestKey}. Server ตรวจ ID token ด้วย `LineIdTokenService` (AuthModule export ไว้แล้ว, `auth.module.ts:176-178`) และจำกัดความถี่ต่อ LINE user
3. ผ่าน → ออกส่วนลดหนึ่งรายการผูกกับตัวตน LINE นั้น (ยังไม่ผูกร้าน). สแกนชุดเดิมซ้ำได้รายการเดิม
4. หน้าแสดง "รับส่วนลดแล้ว", ชื่องาน, จำนวนเงินลด, "ใช้ได้ถึง {วันที่ เวลา}" และขั้นต่อไป:
   - มีบัญชีมั่งมีที่ผูก LINE นี้แล้ว → ปุ่ม "เปิดมั่งมี" ใช้ `POST /v1/auth/line/liff/session` เดิม (`auth.controller.ts:675`; `exchange-liff-session.use-case.ts:58-100`) เพื่อ handoff เข้าเว็บ; ร้านที่ล็อก ("ยังไม่มีแพ็กเกจ"/"หมดอายุ") พาผู้มีสิทธิ์จัดการแพ็กเกจลงหน้าแพ็กเกจเลย (purchase-without-setup R-C3, `exchange-liff-session.use-case.ts:140-145`); ร้านที่ยังทดลองใช้ลงหน้าแรกของร้าน แล้วเปิดเมนู "แพ็กเกจและการชำระเงิน" เอง
   - ยังไม่มี → ปุ่ม "เปิดร้านใหม่" ไป LIFF signup เดิม (ไม่แก้ฟอร์มสมัคร) และบรรทัดรอง "ถ้ามีบัญชีมั่งมีอยู่แล้ว ให้เข้าสู่ระบบด้วย LINE นี้ก่อนเลือกแพ็กเกจ"

การรับส่วนลดไม่ส่งข้อความแชต LINE ใด ๆ (หน้า LIFF เป็นหน้าเว็บของเรา); token ไม่เข้า log ของ API เพราะ request log บันทึกแค่ path ไม่รวม query (`apps/api/src/common/middleware/request-logger.middleware.ts:20-27,50`) และ API เก็บแค่ hash

### 3.4 สิ่งที่ผู้มีสิทธิ์จัดการแพ็กเกจต้องทำเพื่อใช้ส่วนลด

ต้องครบสามข้อ:
1. เป็นคนที่สแกนรับเอง
2. เข้าเว็บด้วยบัญชีที่ผูก LINE เดียวกัน
3. เป็นสมาชิก ACTIVE ที่มีสิทธิ์ `company.plan.manage` ของร้าน — predicate เดิมของการซื้อ (`assertOwner`, `apps/api/src/modules/billing/application/billing.service.ts:118-138` → `canManagePlan`)

แล้วเปิด "แพ็กเกจและการชำระเงิน" ของร้าน:
- การ์ดแพ็กเกจที่ใช้ได้มีบรรทัด "ส่วนลดจากงาน {ชื่องาน} −{จำนวน} บาท (บิลแรก)"
- เลือกแพ็กเกจและวิธีชำระ → ขั้นตรวจยอดแสดงราคาแพ็กเกจ, ส่วนลด, ภาษี (ถ้ามี), "ชำระวันนี้" และสำหรับแบบต่ออายุ "รอบถัดไปชำระราคาเต็ม {ราคา}"
- ยืนยันเงื่อนไข → ชำระที่ Stripe → ใช้สิทธิ์สำเร็จเมื่อระบบยืนยันรับเงินจริง

ไม่ต้องกดรับหรือเลือกส่วนลดบนเว็บ. ร้านที่ "ยังไม่มีแพ็กเกจ" หรือ "หมดอายุ" เข้าหน้านี้ได้ใน locked shell เดิม (`apps/web/src/features/plan-term/plan-term.logic.ts:40-44`); route อ่านส่วนลดใหม่ต้องเข้า allowlist ของ API (§7.4). ผู้มีสิทธิ์จัดการแพ็กเกจคนอื่นของร้านเดียวกันไม่เห็นส่วนลดของคุณ เพราะส่วนลดเป็นของผู้ถือ

### 3.5 สิ่งที่พนักงานในร้าน (ไม่มีสิทธิ์จัดการแพ็กเกจ) เห็น

- หน้าแพ็กเกจเปิดไม่ได้อยู่แล้ว: เมนูซ่อนลิงก์ (`apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:343-350,376-381`) และ API ตอบ 403 → ไม่มีข้อมูลส่วนลดในร้าน
- หน้า LIFF หลังสแกนเป็นที่เดียวที่เห็นส่วนลด และบอกว่า: "ส่วนลดนี้เป็นของบัญชี LINE นี้ ใช้ได้เมื่อคุณเป็นเจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจของร้านที่ซื้อ ถ้าจะใช้กับร้านที่คุณทำงานอยู่ ให้เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจสแกนรับเอง"
- ส่วนลดโอนให้คนอื่นไม่ได้. ถ้าพนักงานคนนั้นเปิดร้านของตัวเองภายหลัง ใช้กับร้านนั้นได้ตามกติกาปกติ

### 3.6 หลังชำระ

- หน้า return (`/companies/:id/billing/return`, อ่าน `GET …/billing/attempts/:id`, `billing.service.ts:991-1006`): ระหว่างรอผล "ส่วนลดจะถูกใช้เมื่อยืนยันการชำระ"; เมื่อ apply แล้ว "ใช้ส่วนลดจากงานแล้ว"
- ประวัติ: แถวของบิลนั้นแสดง "ส่วนลดจากงาน −{จำนวน} บาท"; ยอดของแถวเป็นยอดรับจริง (ประวัติอ่าน `BillingInvoice.totalSatang` อยู่แล้ว, `billing.service.ts:1033-1047`)
- เอกสาร Stripe (ใบแจ้งหนี้/ใบเสร็จ) แสดงราคาสุทธิหลังลดเป็นราคาต่อหน่วย ไม่มีบรรทัดส่วนลด ไม่มีชื่องานหรือชื่อชุด (SED-25)
- คืนเงินหรือข้อพิพาท: คืนไม่เกินยอดที่รับจริง; ส่วนลดคงสถานะใช้แล้ว ไม่คืนสิทธิ์และไม่คืนจำนวนแจก

## 4. กติกาสิทธิ์

### 4.1 บิลแรก — การซื้อที่ใช้ส่วนลดได้

ใช้ได้เฉพาะ quote แพ็กเกจจาก catalog ที่ "เริ่มแพ็กเกจใหม่" = `packageMenuPurchaseSource(purchaseSource)` (`apps/api/src/modules/billing/application/billing-purchase-source.ts:39-40`: NO_TERM, TRIAL, ADMIN_MANUAL, PAID_EXPIRED_CURRENT_MODE) ซึ่งตรงกับ `quote.purchase.kind` (`billing.service.ts:492`):

| `purchase.kind` | ใช้ส่วนลด | เหตุผล |
|---|---|---|
| INITIAL (ยังไม่มีแพ็กเกจ, ทดลองจบ, แพ็กที่แอดมินให้) | ได้ | บิลแรกของร้าน |
| RESTART (แพ็กที่จ่ายแล้วหมดอายุ ซื้อใหม่) | ได้ — ค่าเริ่มต้น SD-Q2 | บิลแรกของแพ็กเกจใหม่ ไม่ใช่การต่ออายุ |
| REPEAT, SCHEDULED_CHANGE (ซื้อต่อหรือเปลี่ยนรอบถัดไปขณะแพ็กยังใช้งาน) | ไม่ได้ — ค่าเริ่มต้น SD-Q2 | เทียบเท่าการต่ออายุ |
| UPGRADE, FULL_PACKAGE_UPGRADE | ไม่ได้ | ร้านมีแพ็กที่ใช้งานอยู่; ส่วนต่างไม่ลด |
| ADVANCE_DEAL และ quote ที่มี `dealId` | ไม่ได้ | ดีล (SD-O2) |
| รอบต่ออายุทุกชนิด (CARD_AUTO, PROMPTPAY_RENEW) | ไม่ได้ | SD-O1 |
| ADD_ON | ไม่ได้ | SD-T3; validator ของ add-on ปฏิเสธส่วนลดทุกชนิด (สเปก add-on O-03) |

### 4.2 ไม่ซ้อนกับดีล

ไม่ใช้ส่วนลดเมื่อข้อใดข้อหนึ่งจริง — ตรวจตอน quote และซ้ำใน transaction จองของ Checkout:
1. quote มี `dealId` (ดีลคิดราคาจาก snapshot ของตัวเอง, `billing.service.ts:296-297`)
2. ร้านมี `PackageChangeRequest` kind `SALES_DEAL` ที่ `status = 'APPROVED'` และ `offerExpiresAt > now` (predicate เดียวกับการ์ดดีลบนหน้าแพ็กเกจ, `billing.service.ts:880-881`) หรือ `status = 'PAID'` (ดีลจ่ายล่วงหน้ารอเริ่ม)
3. ดีลที่กำลังใช้งาน (แพ็กปัจจุบันมาจากดีลและยังไม่หมด) ถูกตัดโดย §4.1 อยู่แล้ว เพราะ source เป็น PAID_CURRENT_MODE

ดีล DRAFT/PENDING_APPROVAL (ลูกค้ายังไม่เห็น) ไม่กัน. ถ้าดีลถูกอนุมัติหลัง quote → Checkout ตอบ `BILLING_QUOTE_STALE` และ quote ใหม่ไม่มีส่วนลด; ถ้าอนุมัติหลังจองแล้ว บิลที่จ่ายได้ส่วนลดตามที่ลูกค้ายืนยันไว้ และดีลที่ยังไม่จ่ายถูกปิดโดย `supersedeUnpaidDeal` เดิม (`billing-package-request.ts:177`)

ข้อความเมื่อผู้ถือมีส่วนลดแต่ร้านมีดีล (แสดงเหนือรายการแพ็กเกจปกติ ไม่แสดงบนการ์ดดีล):
> ร้านนี้มีดีลพิเศษอยู่แล้ว จึงใช้ส่วนลดจากงานร่วมกันไม่ได้
> ส่วนลดยังเป็นของคุณจนถึง {วันที่}

`billing-package-request.ts` (`applyDealRequest :66-110`, `recordReferralAttribution :139-152`, `mirrorAttributionRefund :159-167`) ไม่เปลี่ยน

### 4.3 หนึ่งรายการต่อร้าน ต่อบิล และต่อคนต่อชุด

- ต่อร้าน: ร้านหนึ่งมีส่วนลดจากงานที่จองหรือใช้แล้ว (RESERVED/USED) ได้ไม่เกินหนึ่งรายการตลอดอายุร้าน (ค่าเริ่มต้น SD-Q4). บังคับด้วย partial unique index ใน migration (แบบที่มีแล้วใน `20260705010000_item15a_idempotency_and_channel_uniqueness`, `20260916090000_email_passwordless_access`)
- ต่อบิล: หนึ่งบิลใช้ได้หนึ่งรายการ (`attemptId` และ `invoiceId` unique บน ticket)
- ต่อคนต่อชุด: หนึ่งรายการ (unique (batch, ตัวตน LINE)); คนหนึ่งถือหลายรายการจากหลายชุดได้
- ผู้ถือมีหลายรายการที่ใช้กับการ์ดเดียวกันได้: server เลือกรายการที่ลดมากที่สุด เท่ากันเลือกที่หมดอายุก่อน แล้วตาม id; ไม่มีปุ่มเลือกเอง
- ผู้ถือดูแลหลายร้าน: รายการถูกใช้กับร้านแรกที่ Checkout ถูกยอมรับ; ร้านที่เปิด Checkout พร้อมกันได้ `BILLING_QUOTE_STALE` แล้ว quote ใหม่ราคาเต็ม
- ไม่มีปุ่ม "ไม่ใช้ส่วนลดครั้งนี้" (ค่าเริ่มต้น SD-Q6)
- quote ราคาเต็มที่ออกตอนผู้ถือยังไม่มีส่วนลด แต่ตอน Checkout มีรายการที่ใช้ได้แล้ว → `BILLING_QUOTE_STALE` เพื่อไม่ให้เสียสิทธิ์บิลแรกไปเงียบ ๆ

### 4.4 วันหมดอายุ

`expiresAt = ปิดรับของชุด (ตาม revision ตอนออก) + 30 วัน` — **ค่าเริ่มต้น รอ Owner ยืนยัน (SD-Q1)**. ตรึงบนรายการตอนออก ไม่เลื่อนเมื่อแก้ชุด. การใช้ตัดสินตอนจองใน Checkout แบบเดียวกับหน้าต่างของดีล S46 (`billing.service.ts:550-553`): จองก่อนหมดอายุแล้วจ่ายเสร็จหลังหมดอายุ ยังใช้ได้. "หมดอายุ" อ่านจากเวลา (`state = ISSUED` และ `expiresAt <= now`) ไม่ต้องมี sweep. แสดงบน LIFF และการ์ด: "ใช้ได้ถึง {วันที่ เวลา}"; หมดแล้ว: "ส่วนลดจากงานหมดอายุแล้ว"

### 4.5 ขอบเขตชุดและยอดขั้นต่ำ

- `scope = { tiers: PaidTier[], intervals: ['month' และ/หรือ 'year'] }` ตรึงบนรายการตอนออก; purchase kind และโหมดชำระไม่เป็น scope (ตายตัวตาม §4.1 และ gate)
- ขั้นต่ำหลังลด: `unitAmountSatang ≥ 1000` (฿10) — ค่าเดียวกับขั้นต่ำราคาใน `offerTerms` (`apps/api/src/modules/billing/domain/billing-policy.ts:46`) เป็นค่าคงที่ในโค้ด ไม่เก็บใน `policyJson` (parser เข้มงวด `:29-30`, SED-09). ขั้นต่ำการเรียกเก็บ THB ของ Stripe ยังไม่พิสูจน์ (§14)
- ตรวจตอนเผยแพร่ (ทุก tier/รอบใน scope ด้วยราคาปัจจุบัน) และตอน quote (ราคาอาจเปลี่ยน); ไม่ผ่าน = การ์ดนั้นไม่มีบรรทัดส่วนลด และรายการยังอยู่
- ตัวเลือกของการ์ดคำนวณด้วย helper เดียวกับ quote จึงไม่ขัดกัน (SED-14)

### 4.6 สิทธิ์ของลูกค้า

ใช้ predicate เดียวกับการซื้อ (`assertOwner` → `canManagePlan`); ไม่ hard-code OWNER; ไม่มี permission ใหม่ฝั่งร้าน. ร้านที่ถูกพักโดยผู้ดูแล (`BILLING_COMPANY_HELD`) ซื้อไม่ได้อยู่แล้ว

## 5. ราคาและกลไกชำระเงิน

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

สิทธิ์แพ็กไม่ขึ้นกับเงิน: ใบเสร็จ วัน ผู้ใช้ สาขา และเครดิต AI มาจาก offer (`billing-reconciler.service.ts:607-632`) จึงเท่ากับราคาเต็ม

### 5.2 กลไกต่อโหมด (ไม่มี coupon)

ทุกโหมดที่มีส่วนลดใช้ Checkout `mode: 'payment'` ที่คิด `price_data.unit_amount` จาก server:

| โหมด | วันนี้ | เมื่อมีส่วนลด |
|---|---|---|
| CARD_ONCE | one-time `price_data` (`billing.service.ts:730-742`) | `unit_amount = eventDiscount.unitAmountSatang` แทน `snapshot.upgrade?.amountSatang ?? snapshot.quote.offer.priceSatang` ที่ `:738` |
| PROMPTPAY_ONCE | เหมือน CARD_ONCE (`payment_method_types: ['promptpay']`) | เหมือน CARD_ONCE |
| PROMPTPAY_RENEW | งวดแรก one-time `price_data` → apply ทันที → `bindPromptPayRenewal` (`billing-reconciler.service.ts:695`, `:1088-1144`) ผูก subscription `send_invoice` ราคา catalog แบบ trial ถึงสิ้นงวดแรก | ลดเฉพาะ `unit_amount` งวดแรก; subscription และบิล QR รอบถัดไปราคาเต็มเหมือนเดิม |
| CARD_AUTO | Checkout `mode: 'subscription'` ด้วย Price id (`billing.service.ts:743-749`) | งวดแรกเป็นการจ่ายครั้งเดียวพร้อมเก็บบัตร แล้วผูก subscription ราคาเต็มที่เริ่มเก็บเมื่อสิ้นงวดแรก (§5.3) |

หลักฐานการชำระ: `paidPackageCheckoutEvidence` เปลี่ยนเฉพาะยอดที่คาดหวัง (`apps/api/src/modules/billing/domain/paid-checkout-invoice.ts:22-23`) ให้ใช้ total, tax และ unit amount จาก `snapshot.eventDiscount` เมื่อมี. การตรวจว่า "ไม่มีส่วนลดใด ๆ" คงเดิมทุกข้อ (`:30` amount_discount, `:35` total_discount_amounts, `:41` item amount_discount, `:49` line discount_amounts) — coupon หรือส่วนลดที่ไม่คาดยังถือเป็นหลักฐานไม่ตรง. `paid-invoice.ts` (หลักฐานของ subscription) ไม่แตะ. ยอดที่คาดหวังอยู่ใน snapshot ของ attempt ซึ่ง immutable ทุกเส้นทางตรวจซ้ำจึงได้ผลเดียวกัน: reconcile ปกติ (`billing-reconciler.service.ts:515`), นำเข้าใบที่ค้นพบ (`importDiscoveredInvoice`, `:378`, ทาง one-time `:419-423`) และ retry ของแอดมิน (`reconcileOriginalInvoice`, `:441`, ทาง one-time `:453-457`) — ไม่ต้องมี resolver แยก (SED-05)

### 5.3 CARD_AUTO: จ่ายงวดแรกครั้งเดียว แล้วผูกการต่ออายุราคาเต็ม

แพตเทิร์น advance deal ใช้ได้ในเชิงกลไก แต่เรียกฟังก์ชันเดิมตรง ๆ ไม่ได้:
- **ส่วนที่ใช้ได้**: advance deal พิสูจน์ในโค้ดแล้วว่า Checkout `mode: 'payment'` + `payment_intent_data.setup_future_usage: 'off_session'` เก็บบัตรไว้ตัดรอบต่อไป (`billing.service.ts:733-734`; `billing-advance-deal.pg.spec.ts:138,140`) แล้วผูก subscription `charge_automatically` + `default_payment_method` + `trial_end` = สิ้นงวดที่จ่ายแล้ว + `trial_settings.end_behavior.missing_payment_method: 'cancel'` (`billing-reconciler.service.ts:797,823-832`), ตรวจ binding รวม `simpleCollection` (`:834-851`) และห้ามมีบิลไม่เป็นศูนย์ก่อนสิ้นงวด (`:853-860`); replay ไม่สร้าง subscription ซ้ำ (`billing-advance-deal.pg.spec.ts:217`) และหลักฐานที่ถูกถือไว้หยุด trial ก่อนเก็บเงิน (`:221`)
- **ส่วนที่ใช้ตรงไม่ได้**: `reconcileAdvanceDeal` (`billing-reconciler.service.ts:699-787`) ต้องมี `snapshot.advanceDeal`, แถวดีล และแพ็กจ่ายครั้งเดียวที่ยังใช้งาน (`renewalMode` เป็น CARD_ONCE/PROMPTPAY_ONCE, invoice เดิม APPLIED) และเปิดสิทธิ์ตอนแพ็กเดิมหมด (`activateAdvanceDeal`, `:930`); ส่วนลดจากงานเป็นบิลแรกที่เริ่มสิทธิ์ทันที
- **เส้นทางที่ใกล้ที่สุด** คือ PROMPTPAY_RENEW งวดแรก: `reconcileOneTime` apply ทันที คง `activeAttemptId` จนผูกเสร็จ (`:658`) แล้ว `bindPromptPayRenewal` สร้าง subscription trial ถึง `paidThrough` ที่ราคา catalog และเขียน `BillingSubscriptionContract` ที่ `effectiveAt = paidThrough` (`:1137`)

สิ่งที่ต้องทำ (ไฟล์และเทสต์อยู่ใน plan SD-C):
1. quote CARD_AUTO ที่มี `eventDiscount` ทำให้ `paymentCheckoutSnapshot` เป็นจริง (`billing.service.ts:66-67`) → Checkout แบบ payment, `payment_method_types: ['card']`, `setup_future_usage: 'off_session'` (ขยายเงื่อนไข `:733-734` จาก `advanceDeal` เป็น `advanceDeal || eventDiscount`)
2. reconciler ส่ง attempt นี้เข้า `reconcileOneTime` (`:240`; ตรวจโหมด `:478-479`; นำเข้า `:419`; retry `:453`) แล้ว apply งวดแรกทันทีด้วยเส้นทางเดิม (term, ใบเสร็จ, เมนู, trial carryover, ผู้รับเอกสาร, referral) ตั้ง `renewalMode = 'CARD_AUTO'` และคง `activeAttemptId` จนผูกเสร็จ (ขยาย `:658` จาก PROMPTPAY_RENEW)
3. ผูกต่ออายุ: ขยาย `bindPromptPayRenewal` (`:1088-1144`) ให้รับโหมดบัตร โดยยกส่วนตรวจบัตรจาก `bindAdvanceDeal` (`:793-800` บัตรถูกเก็บและเป็นของ customer, `:823-832` พารามิเตอร์ของบัตร, `:834-851` ตรวจ binding) → subscription `trialing` ถึง `paidThrough` ราคา = Price ของ catalog (`snapshot.priceId`) ไม่มี discount; จุดเรียก `:695` ขยายเป็น PROMPTPAY_RENEW หรือ CARD_AUTO ที่มี `eventDiscount`
4. บิล $0 `subscription_create` ของ trial ข้ามแบบเดียวกับ PROMPTPAY_RENEW/advance deal (เพิ่ม `snapshot.eventDiscount` ที่ `:311-319`)
5. ระหว่างงวดแรก (subscription `trialing`) ลูกค้า "หยุดต่ออายุ" ได้: ขยาย predicate trial ของ advance deal ที่ `billing-collection.ts:83,203` และ `billing.service.ts:815-818`
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

### 5.5 เอกสาร ประวัติ และการคืนเงิน

ดู §3.6. ประวัติและหน้าแอดมินระบุว่าใบไหนได้ส่วนลดจาก `SalesEventTicket.invoiceId` เท่านั้น — ห้ามอ่านจาก `contractSnapshot.eventDiscount` ของ invoice เพราะบิลต่ออายุของ CARD_AUTO/PROMPTPAY_RENEW เก็บ contract snapshot เดียวกันกับบิลแรก (`applyInvoice`, `billing-reconciler.service.ts:1279-1287`). คืนเงินในแอปใช้ยอดจริง (`billing-refund-source.ts:52`). REFERRAL attribution (ถ้ามี) บันทึกยอดจริง `invoice.totalSatang` (`billing-package-request.ts:144-151`) และหักคืนตามยอดจริง (`:159-167`)

## 6. State, data และ concurrency

### 6.1 ตาราง (additive, state เป็น String, ไม่มี Prisma enum)

| Model | ฟิลด์หลัก | constraint |
|---|---|---|
| `SalesEventBatch` | id, eventName, batchName, discountSatang, issueCap, issuedCount, claimStartsAt, claimEndsAt, scopeJson, state (OPEN/PAUSED/SUSPENDED), revision, version, createdByUserId, createdAt, updatedAt | index (state, claimEndsAt) |
| `SalesEventBatchAgent` | batchId, salesUserId, active, addedByUserId, addedAt, removedAt | PK (batchId, salesUserId); index (salesUserId, active) |
| `SalesEventQrToken` | id, tokenHash, batchId, salesUserId, batchRevision, expiresAt, createdAt | tokenHash unique; index (batchId, expiresAt) |
| `SalesEventTicket` | id, serial, batchId, batchRevision, salesUserId, holderProvider ('LINE'), holderChannelId, holderProviderUserId, discountSatang, scopeJson, expiresAt, state (ISSUED/RESERVED/USED/REVOKED), companyId?, attemptId?, invoiceId?, appliedDiscountSatang?, claimRequestKey, reservedAt?, usedAt?, revokedAt?, revokedByUserId?, revokeReason?, version, createdAt, updatedAt | serial unique (8 ตัว อักษร/ตัวเลขที่ไม่สับสน); unique (batchId, holderChannelId, holderProviderUserId); attemptId unique; invoiceId unique; index (holderChannelId, holderProviderUserId, state); index (companyId, state); **partial unique (companyId) WHERE state IN ('RESERVED','USED')** ด้วย SQL ดิบใน migration |

ตัวตน LINE เก็บแบบ `ExternalIdentity` เพื่อจับคู่เท่านั้น ไม่ส่งออก API ใด. `BillingInvoice`, `BillingAttempt`, `BillingAccount` ไม่เพิ่มคอลัมน์ — ส่วนลดอยู่ใน `quoteSnapshot.eventDiscount` ของ attempt (immutable) และความเชื่อมโยงอยู่บน ticket

### 6.2 State ของชุด

| state | รับส่วนลด/ออก QR | ใช้ใน quote และการจอง | เปลี่ยนไปเป็น | ผู้สั่ง |
|---|---|---|---|---|
| OPEN | ได้ ในช่วง `[เปิดรับ, ปิดรับ)` | ได้ | PAUSED ("พักแจก"), SUSPENDED ("ระงับการใช้") | `sales.event.manage` |
| PAUSED | ไม่ได้ | ได้ | OPEN ("เปิดแจกต่อ"), SUSPENDED | `sales.event.manage` |
| SUSPENDED | ไม่ได้ | ไม่ได้ (รายการที่จองแล้วเดินต่อ; รายการที่ใช้แล้วคงเดิม) | PAUSED ("ยกเลิกการระงับ") | `sales.event.manage` + เหตุผลบังคับ |

"ปิดรับแล้ว" เป็นผลของเวลา ไม่ใช่ state. แก้ชุด = `revision + 1` พร้อม version fence (`SALES_EVENT_BATCH_STALE`); จำนวนแจกสูงสุดเพิ่มได้ ลดไม่ต่ำกว่า `issuedCount`; ขยายช่วงรับได้; รายการที่ออกแล้วตรึงจำนวนเงิน, scope, วันหมดอายุ และเซลล์. ถอดเซลล์ = QR ของคนนั้นใช้ไม่ได้ทันที; รายการที่ออกแล้วยังนับให้คนเดิม. ทุกคำสั่งเขียน audit (actor, ค่าเดิม/ใหม่, เหตุผล)

### 6.3 State ของส่วนลด

| state | ความหมาย | เข้าเมื่อ |
|---|---|---|
| ISSUED | ออกแล้ว ผูกตัวตน LINE ยังไม่ผูกร้าน | claim สำเร็จ หรือปล่อยการจอง |
| RESERVED | ผูกร้านและ attempt ของ Checkout ที่ยอมรับแล้ว | transaction จองของ Checkout (`billing.service.ts:530-618`) หลังสร้าง attempt และตั้ง `activeAttemptId` (`:612-616`) |
| USED | ยืนยันรับเงินจริงแล้ว (ถาวร) | ใน `reconcileOneTime` หลัง upsert invoice และบันทึกการเงิน (`billing-reconciler.service.ts:547-556`) **ก่อน** ทางออก `row.appliedAt` (`:557`) และทางออก HELD (`:592-599`) — ถือเงินไว้ตรวจก็ถือว่าใช้สิทธิ์แล้ว |
| REVOKED | หัวหน้าเพิกถอนพร้อมเหตุผล (เฉพาะ ISSUED) | คำสั่งเพิกถอน |
| (หมดอายุ) | ISSUED และ `expiresAt <= now` — อ่านจากเวลา | — |

ปล่อยการจอง (RESERVED → ISSUED ล้าง `companyId`, `attemptId`, `appliedDiscountSatang`) ใน transaction เดียวกับที่ attempt จบโดยไม่มีเงิน:
- Checkout ล้มก่อนเรียกผู้ให้บริการ หรือถูกปฏิเสธ: `billing.service.ts:761-768`
- session หมดอายุโดยไม่มี invoice: `billing-reconciler.service.ts:494-504` — ปุ่มยกเลิกของลูกค้า (`billing-checkout-expiry.service.ts:56-85`) และการยุติของแอดมิน (`:148-180`) วิ่งเข้าจุดนี้หลัง expire session

attempt ที่เป็น UNKNOWN (`billing.service.ts:769-771`) คงการจองไว้จนรายการเดิมจบ. ใช้สิทธิ์แล้วพบว่ารายการไม่ได้ RESERVED ให้ attempt นี้ → เปิด issue `EVENT_DISCOUNT_REVIEW` (`BillingIssue.kind` เป็น String, `schema.prisma:9985`) แต่ไม่ขวาง apply เพราะลูกค้าจ่ายตามยอดที่ยืนยันแล้ว. คืนเงินหรือข้อพิพาทไม่เปลี่ยน state

### 6.4 Lock, idempotency และการแข่ง

- Claim: lock แถว batch `FOR UPDATE` → หา replay ตาม (batch, ตัวตน) → ตรวจ cap → insert ticket + `issuedCount + 1` + audit ใน transaction เดียว; `requestKey` เดิมได้ผลเดิม; ไม่แตะ Company
- จอง: `lockPlanTermCompany` (`billing.service.ts:531`) → account → `UPDATE … WHERE id = ? AND state = 'ISSUED' AND version = ?` (0 แถว = stale). สองคนจองให้ร้านเดียวกันพร้อมกันถูก serialize ด้วย lock ร้านและ partial unique; คนเดียวจองสองร้านชนกันที่แถว ticket
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
| `GET /v1/companies/:companyId/billing/event-discount` | ลูกค้า (`assertOwner`) — **เพิ่มใน allowlist** | ส่วนลดของผู้ใช้สำหรับร้านนี้ และผลต่อการ์ด |
| `POST …/billing/quote`, `POST …/billing/checkout` (เดิม) | เดิม (อยู่ใน allowlist แล้ว, `auth.guard.ts:103`) | body ไม่เปลี่ยน; response เพิ่มฟิลด์ |
| `GET /v1/system/billing/lookup?reference=` (เดิม, `billing.controller.ts:214-217`) | `system.billing.read` | รับเลขส่วนลด (serial) ด้วย |

### 7.2 Field dictionary

`BillingQuote` (`packages/contracts/src/billing.ts:121-148`) เพิ่มฟิลด์ optional:

```ts
eventDiscount?: {
  ticketSerial: string; eventName: string;
  discountSatang: number;       // ค่าของรายการ (D)
  shownDiscountSatang: number;  // P − unitAmountSatang
  unitAmountSatang: number;
  subtotalSatang: number; taxSatang: number;
  totalSatang: number;          // ชำระวันนี้
  expiresAt: string;
};
```

- `quote.totalSatang` ยังเป็นราคาเต็ม (= ยอดรอบต่อไป). "ชำระวันนี้" = `quote.eventDiscount?.totalSatang ?? quote.totalSatang`. บรรทัด "ต่ออายุรายปีครั้งถัดไป" (`apps/web/src/features/billing/BillingPage.tsx:566`) ที่พิมพ์ `quote.totalSatang` จึงถูกต้องโดยไม่ต้องแก้ (SED-21)
- `BillingSnapshot` (`billing.service.ts:58`) เพิ่ม `eventDiscount?` = ข้างบน + `ticketId`, `ticketVersion`, `batchId`, `salesUserId`
- `BillingEventDiscountView` (route ใหม่):

```ts
{
  ticket: { serial: string; eventName: string; discountSatang: number; expiresAt: string;
            state: 'AVAILABLE' | 'IN_PAYMENT' | 'USED' | 'EXPIRED' | 'REVOKED' } | null;
  reason: null | 'DEAL_ACTIVE' | 'NOT_FIRST_BILL' | 'COMPANY_ALREADY_USED' | 'EXPIRED' | 'SUSPENDED' | 'CLOSED';
  offers: { offerKey: string; interval: 'month' | 'year'; eligible: boolean;
            shownDiscountSatang: number | null; reason: null | 'OUT_OF_SCOPE' | 'BELOW_MINIMUM' }[];
}
```

- `BillingAttemptView` (`billing.service.ts:991-1006`) เพิ่ม `eventDiscount?: { shownDiscountSatang: number; state: 'IN_PAYMENT' | 'USED' }`
- รายการประวัติ (`:1033-1047`) เพิ่ม `eventDiscountSatang?` จาก ticket ที่ `invoiceId` ตรงกับแถว
- Claim: body {idToken, qrToken (base64url 43 ตัว), requestKey (16–120)} → {ticket: {serial, eventName, discountSatang, expiresAt}, replay: boolean, next: 'OPEN_PACKAGE' | 'SIGN_UP'}
- ทุก body ใหม่เป็น class DTO (global pipe `forbidNonWhitelisted`, `apps/api/src/common/pipes/validation-pipe.options.ts:7-9`; `body-validation-coverage.spec.ts`). `BillingQuoteDto` และ whitelist ของ quote (`billing.dto.ts:90-100`, `billing.controller.ts:591-592`) ไม่เปลี่ยน — ไม่ใช้ชื่อ `purchaseIntent` (เป็นของ add-on และ FULL_PACKAGE, SED-10)
- ค่าคงที่ใน contracts: `SALES_EVENT_BATCH_STATES`, `SALES_EVENT_TICKET_STATES` (ชื่อไม่ชน Prisma enum ตาม `packages/contracts/src/prisma-enum-parity.spec.ts`); `SALES_PERMISSION_KEYS` เพิ่ม `'sales.event.manage'` (`packages/contracts/src/sales.ts:9-10`); `BILLING_ACTIONS` เพิ่ม `'event_discounts'` (`packages/contracts/src/billing.ts:39`)

### 7.3 รหัสข้อผิดพลาด (มี prefix; web map เป็นข้อความไทย)

| รหัส | เมื่อ | ข้อความ |
|---|---|---|
| `SALES_EVENT_QR_EXPIRED` | token หมดอายุหรือไม่พบ | QR นี้หมดอายุแล้ว ขอให้ผู้แจกสร้าง QR ใหม่ |
| `SALES_EVENT_CLAIM_CLOSED` | ชุดไม่ OPEN หรืออยู่นอกช่วงรับ | งานนี้ปิดรับส่วนลดแล้ว |
| `SALES_EVENT_ISSUE_FULL` | แจกครบจำนวน | ส่วนลดของงานนี้ถูกแจกครบแล้ว |
| `SALES_EVENT_AGENT_INACTIVE` | ผู้แจกถูกถอดหรือปิดบัญชี | QR นี้ใช้ไม่ได้แล้ว ขอให้ผู้แจกสร้าง QR ใหม่ |
| `SALES_EVENT_SELF_CLAIM` | ตัวตน LINE เป็นของสมาชิก platform tenant (ค่าเริ่มต้น SD-Q3) | บัญชีทีมขายรับส่วนลดนี้ไม่ได้ |
| `SALES_EVENT_DISABLED` | gate `event_discounts` ปิด | ยังไม่เปิดรับส่วนลดจากงาน |
| `SALES_EVENT_BATCH_STALE` | version ไม่ตรง | ข้อมูลชุดส่วนลดเปลี่ยนไปแล้ว กรุณาโหลดใหม่ |
| `SALES_EVENT_DISCOUNT_TOO_HIGH` | เผยแพร่แล้วยอดต่ำกว่าขั้นต่ำ | ส่วนลดสูงเกินราคาของ {แพ็กเกจ} |
| `SALES_EVENT_TICKET_NOT_REVOCABLE` | ไม่ใช่ ISSUED | ส่วนลดนี้กำลังชำระหรือใช้แล้ว เพิกถอนไม่ได้ |
| `BILLING_QUOTE_STALE` (เดิม) | ส่วนลด ดีล หรือ gate เปลี่ยนระหว่าง quote กับ Checkout | ส่วนลดหรือราคาเปลี่ยน กรุณาตรวจยอดอีกครั้ง |

quote ไม่ error เพราะส่วนลด: ใช้ไม่ได้ก็คิดราคาเต็มและบอกเหตุผลผ่าน view. รหัสใหม่เพิ่มใน `apps/web/src/common/api/api-error-message.ts` และ `api-error-coverage.spec.ts`; ข้อความของหน้า LIFF อยู่ในหน้า LIFF เอง

### 7.4 Allowlist ของ auth guard และ pins

ร้านที่ล็อกเรียก route ที่ไม่อยู่ใน `isBillingRecoveryRoute` ไม่ได้ (`company_term_expired`, `auth.guard.ts:295-306`; เว็บเด้งไป `/renew`, `apps/web/src/common/api/authed-fetch.ts:107`). เพิ่ม `/event-discount` ในกลุ่ม GET ของ regex (`auth.guard.ts:102`) เท่านั้น:
- quote และ checkout อยู่ใน allowlist แล้ว (`:103`)
- claim เป็น public จึงไม่ผ่าน term hold (`:169-171`)
- route ของทีมขายอยู่ใน platform tenant

`auth.guard.ts` ถูก pin → ต้อง sync pins ใน PR เดียวกัน พร้อมเคส allow/deny ใน `auth.guard.spec.ts`. สเปก add-on ก็แก้ allowlist นี้: PR ที่ merge ทีหลัง rebase แล้ว sync pins ใหม่. เว็บไม่ต้องแก้ locked shell (`isBillingCustomerRecoveryPath`, `packages/contracts/src/billing.ts:224`)

## 8. UI และข้อความ

| ที่ | สิ่งที่แสดง |
|---|---|
| การ์ดแพ็กเกจที่ใช้ได้ (`BillingPage.tsx:502-531`) | ใต้ราคา: "ส่วนลดจากงาน {ชื่องาน} −{จำนวน} บาท (บิลแรก)"; การ์ดที่ใช้ไม่ได้ไม่มีบรรทัด |
| เหนือรายการแพ็กเกจ เมื่อมีส่วนลดแต่ใช้กับร้านนี้ไม่ได้ | ดีล: ข้อความ §4.2 · ไม่ใช่บิลแรก: "ส่วนลดจากงานใช้ได้กับบิลแรกเมื่อเลือกแพ็กเกจใหม่ ไม่ใช้กับการต่ออายุ" · ร้านเคยใช้แล้ว: "ร้านนี้ใช้ส่วนลดจากงานไปแล้ว (ใช้ได้ร้านละครั้ง)" · หมดอายุ: "ส่วนลดจากงานหมดอายุแล้ว" · ระงับหรือยังไม่เปิด: "ส่วนลดจากงานใช้ไม่ได้ในตอนนี้ ติดต่อทีมงานได้" |
| ขั้นตรวจยอดและยืนยัน (`BillingPage.tsx:561-569`) | "ราคาแพ็กเกจ {P}" · "ส่วนลดจากงาน {ชื่องาน} (บิลแรก) −{จำนวน}" · ภาษีตามเดิม · "ชำระวันนี้ {ยอด}" · แบบต่ออายุ: "รอบถัดไปชำระราคาเต็ม {quote.totalSatang}" |
| หน้า return | "ส่วนลดจะถูกใช้เมื่อยืนยันการชำระ" → "ใช้ส่วนลดจากงานแล้ว" |
| ประวัติ | "ส่วนลดจากงาน −{จำนวน} บาท" ใต้แถวบิลนั้น |
| หน้า LIFF | §3.3 และ §3.5 |
| คอนโซลทีมขาย `/sales/events` | ฟอร์ม §3.1; รายการชุด (สถานะ, ปิดรับ, แจกแล้ว/ใช้แล้ว/คงเหลือ); หน้าชุด (ปุ่ม "แสดง QR" สำหรับผู้แจก; "พักแจก"/"เปิดแจกต่อ"/"ระงับการใช้"/"ยกเลิกการระงับ"; รายการส่วนลดพร้อม "เพิกถอน") |

ไม่มีแท็บหรือ section ใหม่ (SD-T4); รายการแท็บเป็นของสเปก add-on §7.1. ข้อความลูกค้าไม่มีรหัสระบบ ไม่มีคำว่า "ตั๋ว" หรือ "ก่อน VAT". ออกแบบที่ 390 px ก่อน; ชื่องานยาวตัดบรรทัดได้โดยไม่ล้นการ์ด. ข้อความอยู่ใน dictionary ของฟีเจอร์ (ไทย/อังกฤษ)

## 9. สิทธิ์ทีมขาย

| การกระทำ | SYSTEM_ADMIN | MANGMEE_SALES_LEAD | MANGMEE_SALES | key |
|---|---|---|---|---|
| สร้าง แก้ พัก ระงับชุด และเพิกถอนส่วนลด | ทุกชุด | ชุดของตัวเอง; มอบหมายได้เฉพาะทีมตัวเอง | ไม่ได้ | `sales.event.manage` (ใหม่) |
| ดูชุดและรายการส่วนลด | ทั้งหมด | ชุดของตัวเองและทีม | ชุดที่ได้รับมอบหมาย เฉพาะรายการที่ตัวเองแจก | `sales.console.read` |
| แสดง QR | เฉพาะผู้ที่ได้รับมอบหมายในชุด | เฉพาะผู้ที่ได้รับมอบหมายในชุด | เฉพาะผู้ที่ได้รับมอบหมายในชุด | `sales.console.read` + assignment ที่ active |
| รายงาน | ทั้งหมด | ทุกทีม ตาม `visibleAgents` | ไม่ได้ | `sales.report.read` |

เพิ่ม key ใน contracts (`sales.ts:9-10`), registry (`apps/api/src/modules/auth/permission-registry.ts:108-115`) และ grant ของหัวหน้า (`:565`); SYSTEM_ADMIN ได้เองจาก `...SALES_PERMISSION_KEYS` (`:555`); ปรับ `permission-registry.spec.ts:268-288`. ฐานข้อมูลได้ key ใหม่จาก `prisma/sync-permissions.ts` ใน release task (`infra/prod-ecs-express/run-release-task.sh:684`). ร้านค้าไม่ได้สิทธิ์ใหม่. คิวทีมขายไม่เปิดลิงก์ Checkout เอกสารการเงิน หรือตัวตน LINE

## 10. รายงานและ settlement

รายงานต่อ งาน → ชุด → เซลล์: แจกแล้ว, ใช้แล้ว, กำลังชำระ, หมดอายุ, เพิกถอน, คงค้างที่ยังใช้ได้ (จำนวนและมูลค่า = ภาระที่ยังเปิด), มูลค่าส่วนลดที่ให้ (Σ `appliedDiscountSatang` ของ USED), ยอดรับจริงของบิลที่ใช้ (Σ `BillingInvoice.paidSatang`), คืนแล้ว (Σ `refundedSatang`) และสุทธิ. นับบิลละครั้ง (`invoiceId` unique). ไม่รวมในยอดขายของเซลล์ (`SalesAttribution`, `sales-reports.service.ts:51-66`) — ยอดขายยังนับตามดีลและรหัสแนะนำ (ค่าเริ่มต้น SD-Q3). ไม่แสดงตัวตน LINE หรือเลขเอกสาร; แสดงชื่อร้านเมื่อใช้แล้ว (ทีมขายค้นชื่อร้านได้อยู่แล้ว). Settlement ไม่เปลี่ยน: จับคู่จาก balance transaction จริง (`billing-settlement-source.ts`); ส่วนลดสะท้อนเป็นยอดรับที่ต่ำลง ไม่มีรายการส่วนลดแยกใน Stripe

## 11. Rollout, gate และ rollback

- gate เดียว `event_discounts` ใน `BILLING_ACTIONS` (เก็บใน `gatesJson`; binary เก่าไม่รู้จัก key จึงข้ามไป — `effectiveBillingGates`, `billing-policy.ts:15-17`); ตั้งผ่าน SET_ACTION_GATE แบบ reviewed เดิม; ไม่มี env ใหม่ ไม่มี key ใหม่ใน `policyJson`
- ปิด gate: claim และออก QR ถูกปฏิเสธ; quote ไม่ใส่ส่วนลด; Checkout ของ quote ที่มีส่วนลดได้ stale. ไม่หยุด: การจองที่ยอมรับแล้ว, การใช้สิทธิ์, การปล่อยการจอง, การผูกต่ออายุ, คืนเงิน, ประวัติ และรายงาน (reconciler ไม่อ่าน gate นี้)
- VAT: ใช้สูตร §5.1 ทุกแบบภาษี; แบบที่มี VAT ต้องผ่าน native proof ก่อนบริษัทจด VAT ซึ่งเป็นข้อกำหนดเดิมของ billing (SED-35) — ใส่เคสมีส่วนลดหนึ่งเคสต่อแบบ
- Rollback: migration additive (binary เก่าไม่อ่านตารางใหม่). ก่อน rollback ต้องอ่านแล้วได้ศูนย์ทั้งสองข้อ: รายการ RESERVED และบัญชี CARD_AUTO ที่ `activeAttemptId` ชี้ attempt ที่มี `eventDiscount` (รอผูก). ไม่เป็นศูนย์ → ปิด gate รอจนหมด หรือ forward-fix. หลัง rollback subscription งวดแรกที่ `trialing` ของส่วนลดจะกด "หยุดต่ออายุ" ไม่ได้จน deploy ใหม่ (binary เก่าไม่มี predicate ข้อ 5.3-5) — บันทึกใน runbook
- ปล่อยพร้อมกัน: SD-C กับ SD-D ต้องอยู่ release เดียวกัน (ขั้นยืนยันต้องแสดงยอดจริง); SD-A และ SD-B ปล่อยก่อนได้โดย gate ปิด

## 12. คำถามค้างถึง Owner

ใช้ค่าเริ่มต้นถ้าไม่มีคำตอบก่อนเริ่ม SD-C:

| ID | คำถาม | ค่าเริ่มต้นที่เสนอ |
|---|---|---|
| SD-Q1 | วันหมดอายุ = ปิดรับ + 30 วัน? | ใช่; ค่าคงที่ 30 วัน ไม่ให้ตั้งต่อชุด |
| SD-Q2 | ร้านที่เคยจ่ายแล้วหมดอายุแล้วซื้อใหม่ (RESTART) นับเป็นบิลแรกไหม; ซื้อต่อก่อนหมด (REPEAT หรือเปลี่ยนแพ็กรอบถัดไป) นับเป็นการต่ออายุไหม | RESTART ใช้ได้; REPEAT และ SCHEDULED_CHANGE ใช้ไม่ได้ |
| SD-Q3 | ใครได้เครดิตยอดขาย เมื่อร้านสมัครด้วยรหัสของเซลล์ A แต่ใช้ส่วนลดจากเซลล์ B; เซลล์รับส่วนลดของตัวเองได้ไหม | ยอดขายยังตาม SalesAttribution เดิม (ดีล/รหัสแนะนำ); รายงานงานเป็นตัวเลขแยก ไม่รวมในยอดเซลล์; บัญชีใน platform tenant รับส่วนลดไม่ได้ |
| SD-Q4 | "หนึ่งรายการต่อร้าน" คือตลอดอายุร้านไหม | ใช่ ร้านที่เคยใช้แล้วใช้อีกไม่ได้ แม้หมดอายุแล้วซื้อใหม่ |
| SD-Q5 | ต้องแจ้งเตือนผู้ถือทาง LINE เช่น ใกล้หมดอายุหรือถูกเพิกถอนไหม | ไม่ทำใน V1; ถ้าทำภายหลัง ข้อความแชตห้ามมีตัวเลขหรือวันที่ (กติกาเดิม `sales-deal.logic.ts:198-204`) |
| SD-Q6 | ต้องมีปุ่ม "ไม่ใช้ส่วนลดครั้งนี้" เพื่อเก็บไว้ใช้กับร้านอื่นไหม | ไม่มี; ใช้กับร้านแรกที่ซื้ออัตโนมัติ |

## 13. เกณฑ์รับงาน

| ID | กรณีและผลที่ต้องได้ |
|---|---|
| SD-E01 | หัวหน้าสร้างชุด: ตรวจฟิลด์, จำนวนเต็มบาท, ช่วง `[เปิด, ปิด)` แบบเวลาไทย, ขั้นต่ำต่อทุก tier/รอบใน scope; หัวหน้ามอบหมายได้เฉพาะทีมตัวเอง; audit ครบ |
| SD-E02 | QR: เฉพาะผู้แจกที่ active; อายุ `min(5 นาที, ปิดรับ)`; ชุด PAUSED/SUSPENDED หรือนอกช่วงถูกปฏิเสธ; ถอดเซลล์แล้ว QR เดิมใช้ไม่ได้ |
| SD-E03 | Claim: LINE token ที่ตรวจแล้ว; ผูกตัวตน LINE; สแกนซ้ำได้รายการเดิม; cap=1 สองคนสแกนพร้อมกันได้หนึ่งรายการ; บัญชี platform tenant ถูกปฏิเสธ; token ไม่อยู่ใน log |
| SD-E04 | รับก่อนมีบัญชี → สมัครผ่าน LIFF → ร้าน "ยังไม่มีแพ็กเกจ" เห็นบรรทัดส่วนลด (route อยู่ใน allowlist) → CARD_ONCE รายเดือนลดแล้ว → จ่าย → apply → ร้านปลดล็อกในที่ → ส่วนลด USED |
| SD-E05 | สี่โหมด: CARD_ONCE และ PROMPTPAY_ONCE ลด `unit_amount`; PROMPTPAY_RENEW บิล QR แรกลด บิลถัดไปราคาเต็ม; CARD_AUTO จ่ายงวดแรกครั้งเดียว + subscription `trialing` ราคาเต็มถึงสิ้นงวด → รอบสองราคาเต็ม apply เป็น RENEWAL; "หยุดต่ออายุ" ระหว่างงวดแรกได้ |
| SD-E06 | RESTART ใช้ได้; REPEAT, SCHEDULED_CHANGE, UPGRADE, FULL_PACKAGE_UPGRADE, ADVANCE_DEAL และ ADD_ON ใช้ไม่ได้ (ไม่มีบรรทัด ไม่ลด ไม่จอง) |
| SD-E07 | ดีล: ดีล APPROVED ที่ยังไม่หมดอายุหรือ PAID → ไม่มีบรรทัดและแสดงข้อความ §4.2; quote ดีลไม่ลด; ดีลอนุมัติระหว่าง quote กับ Checkout → stale |
| SD-E08 | หนึ่งรายการต่อร้าน: หลัง RESERVED/USED รายการของผู้ถือคนอื่นหรือชุดอื่นไม่ถูกใช้กับร้านนี้; สองคนจองให้ร้านเดียวกันพร้อมกันได้หนึ่ง; คนเดียวสองร้านพร้อมกัน ร้านที่สองได้ stale |
| SD-E09 | หมดอายุ: รายการหมดอายุไม่ถูกใช้; จองก่อนหมดอายุแล้วจ่ายหลังหมดอายุ → USED; หน้าจอแสดง "ใช้ได้ถึง" |
| SD-E10 | Checkout: ล้มหรือถูกปฏิเสธ → ปล่อย; session หมดอายุ, ลูกค้ากดยกเลิก, แอดมินยุติ → ปล่อย; UNKNOWN → คงการจองจนรายการเดิมจบ |
| SD-E11 | ถือเงินไว้ตรวจ: USED เกิดก่อนทางออก HELD; RETRY_APPLY และ IMPORT_INVOICE ตรวจด้วย snapshot ของ attempt ได้ผลเดิม; รายการไม่ตรง → issue `EVENT_DISCOUNT_REVIEW` โดยไม่ขวาง apply |
| SD-E12 | คืนเงินบางส่วนและทั้งหมด/ข้อพิพาท: คืนไม่เกินยอดจริง; ส่วนลดคง USED; REFERRAL (ถ้ามี) บันทึกยอดจริงและหักคืนจนสุทธิเป็นศูนย์; รายงานงานหักคืน; CARD_AUTO งวดแรก: หยุดต่ออายุแล้วยุติแพ็กได้ |
| SD-E13 | รอบต่ออายุไม่เปลี่ยน: ตรวจด้วย contract snapshot ราคาเต็ม; จ่ายรอบแรกหลัง trial ไม่ผ่าน → grace เริ่มตามเดิม; เทสต์เดิมของ collection, schedule, repeat, price-return, free-days, grace และ paid-invoice ผ่านโดยไม่แก้ |
| SD-E14 | ราคา: ตัวอย่าง 499/100 ทั้งสามแบบภาษี; เต็มบาทเท่านั้น; ขั้นต่ำ ฿10; ผลต่อการ์ดตรงกับ quote และ Checkout |
| SD-E15 | สิทธิ์: พนักงานในร้านไม่เห็นหน้าแพ็กเกจและหน้า LIFF บอกวิธีที่ถูก; ผู้มีสิทธิ์จัดการแพ็กเกจคนอื่นไม่เห็นส่วนลดของผู้ถือ; ตาราง §9 ทดสอบผ่าน HTTP; ร้านอื่นมองไม่เห็นหรือใช้ไม่ได้ |
| SD-E16 | Gate ปิด: claim ถูกปฏิเสธ; quote ไม่ลด; quote ที่มีส่วนลดได้ stale ที่ Checkout; การจอง การใช้สิทธิ์ reconcile คืนเงิน และประวัติเดินต่อ |
| SD-E17 | UI: บรรทัดการ์ด, ขั้นตรวจยอด, "รอบถัดไปชำระราคาเต็ม", หน้า return, ประวัติ ที่ 390 px; ไม่มีแท็บใหม่; ไม่มีคำว่า "ตั๋ว" |
| SD-E18 | รายงาน: ตัวเลขทุกคอลัมน์ §10 ถูกต้อง; ไม่มีตัวตน LINE; กติกา `visibleAgents` |
| SD-E19 | Rollback: migration additive; ตรวจเงื่อนไข §11 ได้จากคำสั่งอ่าน |
| SD-E20 | แอดมิน: ค้นด้วยเลขส่วนลดเจอร้านและบิล; หน้าร้านในระบบแอดมินแสดงรายการส่วนลด |

## 14. พฤติกรรมของ Stripe ที่ต้องพิสูจน์จริง

API version `2026-08-26.dahlia` (`packages/contracts/src/billing.ts:7`). เอกสาร provider ไม่แทนการพิสูจน์ในบัญชีจริง; แต่ละข้อต้องมีการตรวจบน UAT (test mode):

| พฤติกรรมที่แบบนี้พึ่ง | การตรวจบน UAT |
|---|---|
| Checkout `mode: 'payment'` + `price_data.unit_amount` ที่ไม่ใช่ราคาในรายการ ออก session, invoice และบรรทัดที่ยอดและภาษีตรง `quoteTotals(unitAmount)` ทุกสตางค์ | ซื้อ CARD_ONCE และ PROMPTPAY_ONCE ที่มีส่วนลด แล้ว reconcile ผ่าน `paidPackageCheckoutEvidence` |
| ขั้นต่ำการเรียกเก็บ THB ของ Stripe ไม่เกิน ฿10 | quote ที่ยอดหลังลดเท่ากับ ฿10 ชำระสำเร็จ |
| `setup_future_usage: 'off_session'` บน one-time Checkout เก็บบัตรไว้กับ customer และ subscription ที่มี `trial_end` ซึ่งสร้างภายหลังตัดบัตรนั้นได้เมื่อ trial จบ (ใช้ใน advance deal แล้ว แต่ยังไม่มีหลักฐาน UAT ของเส้นทางบิลแรก) | CARD_AUTO ที่มีส่วนลด + Stripe test clock เลื่อนถึงสิ้นงวด → บิลรอบสองราคาเต็มจ่ายสำเร็จและ apply เป็น RENEWAL |
| subscription ที่มี trial ออกบิล $0 `subscription_create` ตอนสร้าง และบิลเมื่อ trial จบเป็น `subscription_cycle` | ดูใน test clock เดียวกัน |
| บัตรถูกปฏิเสธเมื่อจบงวดแรก → subscription `past_due` → grace เริ่มตามเดิม | test card ที่ปฏิเสธหลัง trial |
| "หยุดต่ออายุ" บน subscription ที่ `trialing` ทำงานและไม่ออกบิล | กดจากหน้าแพ็กเกจระหว่างงวดแรก |
| ภาษีแบบรวม/แยก VAT บนยอดที่ลดแล้วตรงกับสูตร (ไม่มี tie เมื่อเต็มบาท) | ก่อนจด VAT เท่านั้น: ช่วงทดสอบ policy บน UAT หรือบัญชีทดสอบแยก |
| ใบเสร็จและใบแจ้งหนี้แสดงราคาสุทธิ ไม่มีบรรทัดส่วนลด | เปิดเอกสารจริงจาก UAT |

ลิงก์เอกสาร Stripe เรื่อง coupon และ invoice transitions ใน DRAFT v1 ไม่เกี่ยวแล้ว เพราะไม่ใช้ coupon
