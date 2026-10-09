# ผลจำลอง E2E ซ้ำหลังปิด gap แคมเปญ Starter 249

วันที่ 9 ตุลาคม 2026 — **ปิด F01–F09 ใน spec แล้ว** ตามมติผู้ใช้ พร้อม expected behavior และ acceptance สำหรับทุกจุด ผล offline reference model **82/82 ผ่าน**, negative controls จับข้อผิดพลาดที่ใส่กลับ **9/9 จุด** และ exact-source probe **6 assertions ผ่าน** ผลนี้ไม่ใช่ browser/API/DB/provider E2E ของโปรโมชั่นที่ implement แล้ว

[Spec ปัจจุบัน](../specs/starter-249-bonus-month-promotion-spec-th.md) และ [ผลก่อนแก้วันที่ 5 ตุลาคม](starter-249-promotion-spec-e2e-simulation-2026-10-05-th.md) มีความหมายต่างกัน: รายงานเดิมเก็บช่องว่างที่พบตอนนั้น ส่วนฉบับนี้ตรวจข้อกำหนดที่แก้แล้ว ยังไม่แก้ application, schema, package.json, configuration จริง หรือ deploy

## 1 กติกาที่ใช้เป็น oracle

- Starter เดือนจ่าย 249 บาทได้ 2 เดือน/60 ใบ; ปีตาม policy default 2,490 บาทได้ 13 เดือน/390 ใบ ราคาตาม quote/tax policy จริง ไม่อนุมัติการเปลี่ยนภาษี
- ร้านใหม่/เดิมหนึ่งครั้งต่อบริษัทต่อแคมเปญ แก้ revision/เปลี่ยนผู้ซื้อ/ย้ายบัญชี Stripe ไม่คืนสิทธิ์ TEST/LIVE แยก namespace
- ผู้ใช้ยืนยันวันที่ 9 ตุลาคม: bonus receipts ใช้ทันที หมดวันเดิม ไม่ carry; FEFO และโบนัสก่อน base เมื่อ expiry เท่ากัน กติกาใน spec ใช้กับกลุ่ม package และคงกลุ่ม/เงื่อนไข add-on เดิม
- ผู้ใช้ยืนยันเดือนฟรีมีเครดิต CHAT ตามรอบ Starter ปกติ ไม่มีเครดิตล่วงหน้าทั้ง 2/13 รอบ และไม่เปลี่ยน admin free days ให้แจกเครดิต
- หนึ่งสิทธิ์ต่อรายการ ไม่ซ้อน event discount/Sales deal; upgrade ที่ทับสิทธิ์โปรเลื่อนไปหลัง committed entitlement end
- คืนเงินจริงบางส่วนคงสิทธิ์; คืนเต็มรวมยอดสะสมยกเลิกส่วนที่ยังไม่ใช้จาก source นั้น ไม่ลบใช้แล้ว/ไม่แตะ invoice อื่น/ไม่คืน campaign usage; dispute ใช้ hold/review เดิม
- การรับสิทธิ์เกิดที่ RESERVED commit; quote 10 นาที, first dispatch ภายใน 10 นาทีจาก reserve, provider Checkout 30 นาทีจาก dispatch; UNKNOWN ไม่ปลด slot จาก timeout

## 2 หลักฐานที่รัน

| การตรวจ | ผล | ขอบเขต |
| --- | --- | --- |
| S01–S37 | 37 MODEL_PASS | จำลอง regression journeys เดิมใหม่ด้วย model รุ่นแก้ |
| R01–R45 | 45 MODEL_PASS | เพิ่มกรณีปิด gap, refund race, scope/cap และ anniversary |
| Negative controls F01–F09 | 9 CAUGHT | ทำสำเนา model ชั่วคราวให้กลับมาผิด แล้ว suite ต้องตรวจพบ |
| Cap ลด 2→1 แข่งสองร้าน | ครบ 6 serialized orders ภายใน R35 | เป็นการไล่ลำดับ atomic steps ไม่ใช่ DB race/deadlock test |
| Source M pure functions | 6 PASS_REPRODUCTION | calendar 2 assertions และ AI cycle 4 fixtures; source ไม่ถูกแก้ |
| Application/browser/payment tests | NOT RUN | ไม่มี promotion implementation ในขอบเขตงานนี้ |

[Model results](../evidence/starter-249-promotion-spec-e2e-2026-10-09/model-results.json) เก็บ input, expected, observed และ trace เฉพาะกรณีที่มี trace; [negative controls](../evidence/starter-249-promotion-spec-e2e-2026-10-09/negative-controls.json), [source probe](../evidence/starter-249-promotion-spec-e2e-2026-10-09/source-probe-results.json), [coverage](../evidence/starter-249-promotion-spec-e2e-2026-10-09/acceptance-coverage.json) และ [โปรแกรมสำหรับทำซ้ำ](../evidence/starter-249-promotion-spec-e2e-2026-10-09/replay.md) เก็บเป็นเอกสารหลักฐาน ไม่เพิ่ม test/application code

## 3 ผลปิด gap ทีละจุด

CLOSED_IN_SPEC หมายถึงข้อกำหนดและผลที่คาดหวังครบสำหรับรุ่นแรก ทุกแถวยังต้องมี implementation/native verification ภายหลัง

| Gap | ข้อกำหนดที่ใช้แทน | กรณีจำลอง | Acceptance | สถานะ |
| --- | --- | --- | --- | --- |
| F01 | Catalog signature, stale และ template validation | R01–R02 | A28 | CLOSED_IN_SPEC |
| F02 | Unique ต่อ logical environment/campaign/company | R03, R44 | A29 | CLOSED_IN_SPEC |
| F03 | รับสิทธิ์ตอน reserve พร้อม deadline/journal/fence | R04–R06, S25–S27, S34–S35 | A30 | CLOSED_IN_SPEC |
| F04 | โบนัสใช้ทันที, fixed expiry, FEFO และ bonus-first เมื่อหมดพร้อมกัน | R07–R11, R32, R42 | A31 | CLOSED_IN_SPEC |
| F05 | AI promotion segment ครอบ free tail และ free gap | R12–R16, R39–R40 | A32 | CLOSED_IN_SPEC |
| F06 | Payment/apply แยก renewal readiness และ cancellation intent | R17–R18 | A33 | CLOSED_IN_SPEC |
| F07 | เลือกสิทธิ์ชัดและกลับซื้อปกติได้ผ่าน quote ใหม่ | R19–R20 | A34 | CLOSED_IN_SPEC |
| F08 | Deferred upgrade และ source-specific refund/dispute matrix | R21–R34, R41, R45 | A35 | CLOSED_IN_SPEC |
| F09 | Shared final fence, cap recheck และ serialized admission | R35–R38, R44 | A36 | CLOSED_IN_SPEC |

Negative controls ใส่กลับเพียงหนึ่งข้อผิดพลาดต่อสำเนา: ไม่ตรวจ catalog, key ผูก provider, ถอนสิทธิ์เมื่อปิด campaign หลัง reserve, หัก base ก่อนโบนัส, AI อ่านเฉพาะ paid periods, แสดง renewal READY ก่อน proof, ปิด NORMAL เมื่อใช้โปร, full refund ไม่ถอนสิทธิ์ และ cap publish ไม่อ่าน usage ใหม่ ทั้ง 9 สำเนาถูกตัวตรวจจับ ไม่ใช่การพบ regression ใหม่ใน source ระบบ

## 4 Walkthrough และกรณีขอบ

Admin บันทึกร่าง → preview ราคา/โควตา → publish โดย sales gate ยังแยก → ผู้ซื้อเลือกสิทธิ์และ quote → commit reservation → Checkout → verified paid → consumed → apply base/bonus/service segment → ติดตาม renewal readiness แยก หากพัก/จบหลัง reservation ยัง honor accepted snapshot ภายใน deadline/recovery ที่กำหนด

| ชำระ 5 ต.ค. 2026 เวลา 10:00 ไทย | รายเดือน | รายปี |
| --- | --- | --- |
| วันสิ้นช่วงจ่าย | 5 พ.ย. 2026 | 5 ต.ค. 2027 |
| วันสิ้นโบนัส/เป้าหมายรอบถัดไป | 5 ธ.ค. 2026 | 5 พ.ย. 2027 |
| ใบเสร็จหลัง apply | 30 + 30 = 60 | 360 + 30 = 390 |
| CHAT | paid cycle แล้ว bonus cycle เมื่อถึงขอบ | paid cycles 12 รอบ แล้ว bonus cycle ไม่แจกก่อนเวลา |

- ร้านเดิมที่สิ้นสิทธิ์ 20 ต.ค. ซื้อ 5 ต.ค. เริ่มช่วงใหม่ 20 ต.ค.; ร้านที่หมดแล้วเริ่ม verified paidAt ไม่ฟื้น quota ที่หมดอายุ
- วันที่ 31 ม.ค. +2 เดือนลง 31 มี.ค.; ซื้อเพิ่มหลัง Feb clamp ใช้ original anchor 31 จึงได้ paidEnd 31 มี.ค. และ benefitEnd 30 เม.ย. (R43) เวลาไทยต้นวันยังใช้ UTC convention เดิมและต้องแสดงวันจริง
- ใช้ 20 จาก base30/bonus30 ที่ expiry เท่ากันหัก bonus เหลือ base30/bonus10; ซื้อปกติเพิ่ม30แล้วถึง expiry เดิมเหลือ base60 โบนัส10ไม่ยกยอด (R07–R09)
- ซื้อแพ็กเกจรอบถัดไปไว้ล่วงหน้า เดือนฟรีที่อยู่ตรงกลางยังได้ cycle เริ่ม paidEnd และไม่คืน null; revoke source A ไม่ทำให้ source B หาย (R13/R16/R34)
- จ่ายและ apply แล้ว bind timeout คงสิทธิ์ 60 ใบ แสดง REVIEW และยังไม่มี verified nextChargeAt; readback ถูกต้องจึง READY; cancel intent ต้องชนะ retry worker (R17/R18)
- Full refund หลังใช้20 เหลือประวัติ consumed20 แต่ remainder ใช้ต่อไม่ได้; partial10,000สตางค์คงสิทธิ์; partialสะสม24,900เปลี่ยนเป็น full; คืนเต็มก่อน paid webhook ต้อง consume campaign และไม่ให้ callback เติมใหม่ (R25–R30/R45)

### เพดานที่แข่งกับการจอง

A/B คือสองบริษัทจอง P คือ publish cap=1 จากเดิม2 ต้องใช้ shared final fence และอ่าน usage ใหม่ ผลจริงของ model:

| ลำดับ | ผลแต่ละขั้น | cap สุดท้าย | taken สุดท้าย |
| --- | --- | ---: | ---: |
| ABP | RESERVED → RESERVED → CAP_BELOW_TAKEN | 2 | 2 |
| APB | RESERVED → PUBLISHED → CAP_FULL | 1 | 1 |
| BAP | RESERVED → RESERVED → CAP_BELOW_TAKEN | 2 | 2 |
| BPA | RESERVED → PUBLISHED → CAP_FULL | 1 | 1 |
| PAB | PUBLISHED → RESERVED → CAP_FULL | 1 | 1 |
| PBA | PUBLISHED → RESERVED → CAP_FULL | 1 | 1 |

ไม่มีลำดับที่ accepted usage เกิน final cap ใน model ส่วน DB ต้องพิสูจน์ว่าทุก caller ยึดลำดับ lock จริง ไม่ใช้ผลนี้แทน PostgreSQL concurrency test

## 5 Source เดิมยังต้องพัฒนา

Probe อ่าน exact Git snapshot M `fddfd05baf97be683796f6b7db4d2e72157197db` ของ `billing-package.ts` และ `ai-credit-cycles.ts` แบบ read-only ไม่ fetch remote และไม่อ้างว่าเป็น deployed/latest source วันนี้

ผล AI เดิมยังเหมือนรอบก่อน: paid cycle ปกติอ่านได้; free tail ใช้ cycle key เก่า; free gap ที่มี future paid invoice คืน `null`; เข้ารอบ paid ใหม่อ่านได้ Model รุ่นใหม่กำหนด promotion segment เพื่อแก้พฤติกรรมนั้น **source probe ไม่ได้ผ่านเพราะแก้ source** แต่ผ่านเพราะ reproduce actual เดิมตาม expected ได้ครบ

ข้อกำหนด refund ใหม่ยังต้องต่อยอด source validation ที่เทียบ invoice.periodEnd กับ account.paidThrough และการ revoke แบบเดิม ให้เข้าใจ bonus/source-specific projection; current full-refund/end-package implementation ไม่ถือว่าผ่าน matrix ใหม่

## 6 Coverage และข้อจำกัด

ทุก A01–A36 มี oracle ใน spec แล้ว แต่สถานะด้านล่างเป็น coverage ของ simulation เท่านั้น MODEL_PARTIAL ไม่ใช่ acceptance ผ่านทั้งข้อ และ NOT_EXECUTED ไม่ใช่ช่องว่างธุรกิจที่ยังตัดสินใจไม่ได้

| Acceptance | Simulation | กรณี | งานตรวจจริงที่ยังต้องทำ |
| --- | --- | --- | --- |
| A01 | MODEL_PARTIAL | S08, S09 | ยังไม่เรียก catalog/API ของ tier อื่นหรือคำนวณ VAT จริง |
| A02 | MODEL_PARTIAL | S10, S11 | ยังไม่ทดสอบ legacy trial, debt/source/capacity และ active-subscription จริง |
| A03 | MODEL_PARTIAL | S20, S21, S22, S23, S24 | key ใน memory; ยังไม่แข่ง DB ผ่านสอง user/Web/LINE จริง |
| A04 | MODEL_PARTIAL | S04, S23 | ยังไม่ผ่าน HTTP preview/quote persistence |
| A05 | MODEL_PARTIAL | S12, S13, S14, S15, R43 | UTC model และ helper probe; ยังไม่ตรวจ dates ที่ render ทุกจอ |
| A06 | MODEL_PARTIAL | S08, S09, S10, S11, S37 | fixture paidAt; ไม่มี native delayed settlement |
| A07 | MODEL_PARTIAL | S08, S09, S31, R42 | fixture grant/consumption; ยังไม่มี OCR admission worker |
| A08 | MODEL_PARTIAL | S31, R11 | fixture allocation; migration unknown-kind ยังไม่รัน |
| A09 | MODEL_PARTIAL | R12, R13, R15, R39 | segment/key model; ยังไม่ fund AI ledger หรือใช้ budget override จริง |
| A10 | MODEL_PARTIAL | S16, S17, S18, S19, S25, S26, S30 | synthetic paid/unpaid proof; ไม่มี Checkout จริง |
| A11 | MODEL_PARTIAL | S16, S17, S18, S19 | target date/readiness model; ไม่มี subscription readback จริง |
| A12 | NOT_EXECUTED | — | ต้องทดสอบ existing renewal collection hold/schedule กับ provider |
| A13 | MODEL_PARTIAL | S32 | ทดสอบ normal period/date บางส่วน; grace/sweep/resume จริงยังไม่รัน |
| A14 | MODEL_PARTIAL | R21, R22, R23, R24 | deferred-date model; scheduled change/capacity/native quote ยังไม่รัน |
| A15 | MODEL_PARTIAL | S02, S33, S34, S35, R35 | serialize memory steps; ไม่ใช่ PostgreSQL race test |
| A16 | MODEL_PARTIAL | S25, S26, S27, S28, S29, S34, R38 | attempt generation/idempotency model; worker restart/import/outbox จริงยังไม่รัน |
| A17 | MODEL_PARTIAL | R19 | choice counters; ticket/deal DB และ historical snapshot จริงยังไม่รัน |
| A18 | MODEL_PARTIAL | R25, R26, R27, R28, R41 | refund/dispute logical subset; provider credit note/settlement/holds จริงยังไม่รัน |
| A19 | MODEL_PARTIAL | S05, S30 | boolean permission; HTTP ABAC/reauth/revoke ระหว่างคำสั่งยังไม่รัน |
| A20 | NOT_EXECUTED | — | ยังไม่มี UI/LINE/catalog consumer implementation ให้ทดสอบ |
| A21 | NOT_EXECUTED | — | ยังไม่มี schema/mixed-binary/rollback migration ให้ทดสอบ |
| A22 | MODEL_PARTIAL | S36 | model นับ held/consumed เท่านั้น ไม่ได้ reconcile financial/report/attribution |
| A23 | MODEL_PARTIAL | S01 | draft boolean ไม่มี durable save/reload/browser |
| A24 | MODEL_PARTIAL | S02, S03 | clock/gate model ไม่มี scheduler/API |
| A25 | MODEL_PARTIAL | S06, S07, R37 | pause/end ordering; persistent resume/terminal enforcement ยังไม่รัน |
| A26 | MODEL_PARTIAL | S04, S29, R35 | version/cap model; multi-admin DB/idempotent create ยังไม่รัน |
| A27 | NOT_EXECUTED | — | ยังไม่มี Admin campaign UI ให้ตรวจ mobile/desktop/permission |
| A28 | MODEL_PARTIAL | R01, R02 | signature/template model; cache invalidation และ policy publish จริงยังไม่รัน |
| A29 | MODEL_PARTIAL | R03, R44 | scope/key model; migration/deduplication จริงยังไม่รัน |
| A30 | MODEL_PARTIAL | R04, R05, R06 | journal/deadline model; recovery lease/23-hour/native payload constraints ยังไม่รัน |
| A31 | MODEL_PARTIAL | R07, R08, R09, R10, R11, R32, R42 | package FEFO/bonus tie/expiry/OCR fixture; inter-worker allocation จริงยังไม่รัน |
| A32 | MODEL_PARTIAL | R12, R13, R14, R15, R16, R39, R40 | segment/cycle/annual/revocation model; lazy fund/provenance migration จริงยังไม่รัน |
| A33 | MODEL_PARTIAL | R17, R18 | synthetic readback/cancel intent; subscription uniqueness จริงยังไม่รัน |
| A34 | MODEL_PARTIAL | R19, R20 | choice/normal path model; UI explicit reconfirm และ atomic ticket reservation จริงยังไม่รัน |
| A35 | MODEL_PARTIAL | R16, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30, R31, R32, R33, R34, R41, R45 | refund/upgrade matrix มี expected result แล้ว; model ตรวจแกนหลัก แต่ยังไม่มี financial/access projection จริงครบทุก caller |
| A36 | MODEL_PARTIAL | R35, R36, R37, R38, R44 | 6 cap serializations และ pause/release; ไม่ได้พิสูจน์ lock order/deadlock ใน DB |

Model ใช้ permission/payment/provider proof เป็น fixture, mutations เป็น atomic Python steps และ balances เป็นข้อมูลใน memory จึงไม่พิสูจน์ HTTP ABAC, database isolation, lock deadlock, actual money, Stripe API constraints, persistent drafts, cache/CDN, visual states, LINE/OCR/AI funding หรือ rolling deploy Tests เดิม 14 ข้อในรายงานรอบก่อนเป็นหลักฐานเก่า ไม่ได้ rerun หรือเอามาบวกรวมผลรอบนี้

## 7 ทำซ้ำและสถานะถัดไป

ใช้คำสั่ง extract-and-run ใน [replay.md](../evidence/starter-249-promotion-spec-e2e-2026-10-09/replay.md) รัน model, negative controls และ source probe โดยสร้างไฟล์ใน temporary directory เท่านั้น เวอร์ชัน input ที่ตรวจรอบนี้:

- Spec SHA256: `ee094b6b94f6074ab47f042bf61c9c0e7b4260e70f1cbedb56e321b8158f4372`
- Model SHA256: `cdfee1a090b83acc4be40829ee1da7ce2004c558897ed565ce8aaa328a1f9e9c`

ขั้นถัดไปเมื่อผู้ใช้สั่งพัฒนา: pin ฐาน source ปัจจุบัน, จัด implementation plan ตาม dependency ใน spec, เขียน native DB/provider/UI tests ของเส้นทางที่เปิด แล้วจึงตรวจ readiness ตาม runbook งานรอบนี้สิ้นสุดที่ spec และ simulation ไม่อนุมัติแก้โค้ดหรือเปิดแคมเปญจริง
