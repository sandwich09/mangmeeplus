# ผลจำลอง E2E จาก spec แคมเปญ Starter 249

วันที่ 5 ตุลาคม 2026 · **SPEC SIMULATION COMPLETE — ยังมีช่องว่างก่อน implementation**

[Spec](../specs/starter-249-bonus-month-promotion-spec-th.md) · [ผลแบบจำลองพร้อม input และ trace](../evidence/starter-249-promotion-spec-e2e-2026-10-05/model-results.json) · [ผลเรียกฟังก์ชันจาก source](../evidence/starter-249-promotion-spec-e2e-2026-10-05/source-probe-results.json) · [Coverage A01–A27](../evidence/starter-249-promotion-spec-e2e-2026-10-05/acceptance-coverage.json)

## 1 ข้อสรุปและระดับของหลักฐาน

จำลองเส้นทาง Admin สร้างแคมเปญ → ลูกค้าเลือกแพ็กเกจ → จอง → รับเงิน → ให้เวลาและใบเสร็จ → ต่ออายุ/รับมือเหตุผิดปกติ **37 กรณี** แบบจำลองผ่าน assertions ทั้ง 37 กรณี โดย **7 กรณีมีสมมติฐานที่ยังไม่อนุมัติหรือยังไม่พิสูจน์กับ provider** จึงไม่ใช่ผลว่าฟีเจอร์พร้อมใช้งาน

พบ **9 จุดที่ต้องปิดใน spec/contract/policy** และเก็บ logical witnesses 6 รายการ ชุดเรียก pure function จาก source จริงยืนยันเพิ่ม 6 assertions: เมื่อมีช่วงฟรีคั่นระหว่าง paid period สองช่วง cycle reader เดิมคืน `null` หากนำโครงสร้าง invoice ที่เสนอไปใช้โดยไม่แก้ reader

ไม่มีหน้า Admin campaign หรือ payment flow ของโปรโมชั่นนี้ที่ implement แล้วในงานนี้ จึงไม่ได้เปิด browser เพื่ออ้างว่า UI ผ่าน E2E ไม่มี HTTP, PostgreSQL concurrency, Stripe, LINE, OCR, AI funding, UAT หรือ Production transaction จริง ไม่มีการแก้ application code, schema, `package.json`, configuration หรือ business policy ที่ยังรอมติ

| ชุดหลักฐาน | ผล | บอกอะไรได้ |
| --- | --- | --- |
| S01–S37 reference model | 37 MODEL_PASS, 0 MODEL_FAIL; 7 conditional | กติกาที่ใส่ในแบบจำลองทำงานสอดคล้องกับ expected trace ภายใต้สมมติฐานที่ระบุ |
| W01–W06 logical witnesses | สร้างตัวอย่างได้ 6 รายการ | แสดงผลของ key/catalog drift, นโยบายจัดลำดับ quota, acceptance boundary และ transaction ที่ไม่มี lock ร่วม; ไม่ใช่ bug ลูกค้าจริง 6 เรื่อง |
| P01–P04 exact-source probe | 6 assertions ผ่าน | พฤติกรรม calendar/cycle helper ที่ local Git revision ระบุ เมื่อรับ synthetic rows |
| Acceptance A01–A27 | MODEL_ONLY 11, SPEC_GAP 7, POLICY_PENDING 5, NOT_RUN 4 | ครอบคลุมการ review ทั้ง 27 ข้อ แต่ยังไม่มีข้อใดเป็น implementation acceptance ผ่านจริง |

## 2 ขอบเขต วิธีจำลอง และสมมติฐาน

- ตรวจ spec ก่อนเพิ่มลิงก์รายงานนี้: SHA-256 `fb859fecc07485e79903ffaa51466e17e87ce6f03ac99edcd4c1c0773031e97b` การปรับ spec ในรอบนี้มีเพียงบันทึกผลและรายการต้องทวน ไม่เปลี่ยนกติกาที่ตรวจไปแล้วให้ดูเหมือนผลผ่าน
- Source probe ใช้ local Git commit `fddfd05baf97be683796f6b7db4d2e72157197db` ตามฐาน M ของ spec ไม่ fetch remote และไม่อ้างว่าเป็น Production
- แบบจำลอง Python ใช้ standard library: campaign state/version, quote, reservation, consumed/applied, capacity, time arithmetic และตัวอย่าง replay ทั้งหมดเป็นข้อมูลจำลองในหน่วยความจำ ไม่มี production module ถูกเรียกในชุด S
- S33 ลองลำดับที่เป็นไปได้สองแบบภายใต้ atomic model step; ไม่ใช่การพิสูจน์ lock/unique constraint/deadlock ใน PostgreSQL
- ราคา fixture เดือน 24,900 สตางค์ ปี 249,000 สตางค์, ไม่มี VAT ใน fixture; paid receipts 30/360 และ bonus 30 ตามมติ ไม่ใช่การอ่าน live pricing
- วันที่หลักคือ 5 ต.ค. 2026 เวลา 10:00 ไทย; เวลาเก็บและการบวกเดือนใช้ UTC anniversary ตาม spec
- S08/S09/S31 สมมติ bonus receipts ใช้ได้ทันทีเมื่อ apply ตามข้อเสนอใน §5; user ยืนยันจำนวนแล้วแต่เวลาที่ให้ใช้และการถือข้ามรอบยังไม่ยืนยัน
- S16–S19 จำลองวันเรียกเก็บเป้าหมายโดยสมมติ recurring binding สำเร็จในกรณี recurring; ไม่จำลองเครือข่ายหรือ provider confirmation ว่าเลื่อนสำเร็จจริง
- authorization และ payment evidence ใน model เป็น boolean fixture ใช้ตรวจลำดับ state เท่านั้น ไม่รับรอง permission resolver, paid invoice verifier หรือ ABAC ของ API
- Probe transpile ฟังก์ชัน `aiCreditCycleAt` และ `appendPackageInterval` จาก Git ด้วย TypeScript ที่มีอยู่แล้ว; inject calendar helper ตัวจริงเข้า cycle module มี stub เฉพาะ dependency ของ error path ที่ไม่ได้ใช้ ไม่ mock คำตอบของ cycle function
- diagnostic scripts อยู่ชั่วคราวนอก repository; path และ SHA-256 อยู่ใน JSON ผลตรวจ เก็บใน repository เฉพาะเอกสารและ JSON evidence จึงไม่มี implementation หรือ test source ของโปรเจกต์เปลี่ยน

## 3 Walkthrough เส้นทางหลัก

### Admin สร้างและเปิดแคมเปญ

1. สร้างร่างที่ยังไม่มีวันเวลา → state DRAFT ไม่ให้ quote ซื้อโปร; กดเปิดต้องตอบ INCOMPLETE และร่างยังอยู่ (S01)
2. เมื่อเงื่อนไขครบและผ่าน publication → ก่อน start เป็น SCHEDULED; ที่ start เป็น ACTIVE; ที่ end เป็น ENDED ตามช่วง `[start,end)` (S02)
3. ถ้า sales gate เดิมปิด การ publish campaign ไม่เปิดรับเงินจริง (S03)
4. Admin สองคนเริ่มจาก revision เดียวกัน คนแรกบันทึกแล้วคนที่สองต้อง STALE; quote เก่าจาก revision ก่อนต้อง review ใหม่ (S04)
5. ผู้ไม่มีสิทธิ์ publish ไม่เปลี่ยน state (S05); ส่วน HTTP permission, reauthentication และ read-only report scope ต้องทดสอบหลัง implementation
6. พักแล้วปิดการจองใหม่ รายการที่รับจองแล้วจ่ายและ apply ต่อได้; เปิดกลับยังใช้ usage เดิม (S06) จบแล้วเปิด ID เดิมไม่ได้ แต่ accepted payment ยัง apply ได้ (S07)

ร่างที่ยังไม่ครบมี state logic ให้จำลองได้ การบันทึกลง DB/เปิดฟอร์มใหม่แล้วข้อมูลอยู่ และการแสดงปุ่มบนมือถือยังไม่มี implementation ให้พิสูจน์

### ร้านใหม่ซื้อรายเดือนและรายปี

| รายการ | รายเดือน S08 | รายปี S09 |
| --- | --- | --- |
| paidAt / เริ่มบริการ | 5 ต.ค. 2026 10:00 ไทย | 5 ต.ค. 2026 10:00 ไทย |
| ยอด fixture | 249 บาท | 2,490 บาท |
| สิ้นช่วงที่ซื้อ | 5 พ.ย. 2026 10:00 | 5 ต.ค. 2027 10:00 |
| สิ้นเดือนแถม / benefitEnd | 5 ธ.ค. 2026 10:00 | 5 พ.ย. 2027 10:00 |
| ใบเสร็จ base + bonus | 30 + 30 = 60 | 360 + 30 = 390 |
| เครดิต CHAT | ยังตัดสินผลไม่ได้จนปิด Q2 | ยังตัดสินผลไม่ได้จนปิด Q2 |

ลำดับเป็น quote → RESERVED → verified payment → CONSUMED → APPLIED โควตาเพิ่มครั้งเดียว Callback ซ้ำไม่เพิ่มซ้ำ (S29) ชำระแล้วติด hold ใช้สิทธิ์แคมเปญแล้ว แต่ยังไม่เพิ่ม quota จนผ่าน apply retry (S28)

CARD_ONCE/PROMPTPAY_ONCE ไม่มีวันตัดเงินอัตโนมัติ; CARD_AUTO/PROMPTPAY_RENEW มี next-charge target ที่ benefitEnd (S16–S19) PROMPTPAY_RENEW เป็นการออก invoice ให้จ่ายตาม mode เดิม ไม่ใช่ตัดเงินจาก PromptPay เอง

### ร้านเดิม ซื้อซ้ำ และเปลี่ยนผู้ซื้อ

- ถ้าสิทธิ์เดิมสิ้น 20 ต.ค. ซื้อโปร 5 ต.ค. → ช่วงใหม่เริ่ม 20 ต.ค., paidEnd 20 พ.ย., benefitEnd 20 ธ.ค. (S10) สิทธิ์เดิมไม่ถูกตัดเหลือเริ่มใหม่จากวันที่ซื้อ
- ถ้าสิทธิ์เดิมหมดก่อนชำระ → เริ่มจาก verified paidAt และใช้ anniversary ใหม่ (S11)
- คนแรกของบริษัทจองรายเดือนแล้ว อีกคนจองรายปีใน campaign เดิมไม่ได้ (S20); คนละบริษัทใช้ได้ (S21); TEST/LIVE แยก (S22)
- แก้ชื่อหรือ revision ไม่คืนสิทธิ์ (S23); แคมเปญใหม่ที่เปิดโดยชัดเจนเป็นคนละสิทธิ์ (S24) ข้ามบัญชีรับเงินยังมีข้อขัดแย้งตาม F02
- เข้าเดือนฟรีแล้วไม่ refill receipts อีก 30 ใบ และ webhook replay ไม่คืนจำนวนที่ใช้ไปแล้ว (S31)
- รอบต่อไปใช้เวลา 1/12 เดือนกับ quota 30/360 ตามปกติ ไม่มี bonus ใหม่ (S32)

### ชำระล่าช้า ล้มเหลว และจ่ายแล้วรอแก้ไข

- Quote ก่อนแคมเปญจบอย่างเดียวไม่จองสิทธิ์ หากมาสร้าง Checkout ที่ end ต้องปฏิเสธโปรและกลับให้ review ใหม่ (S35)
- รับจอง Checkout ก่อนจบแล้ว paid หลังจบยังรักษาสิทธิ์ โดยวันจริงคำนวณจาก paidAt (S34) ช่วงระหว่าง reservation commit กับ provider session creation ยังต้องปิด F03
- ยืนยัน terminal unpaid แล้วปลดจอง/เริ่ม attempt ใหม่ได้ (S25); timeout/UNKNOWN อย่างเดียวไม่พอให้ปลด (S26)
- Callback เก่าหลังเปลี่ยน attempt ต้องไม่ไป consume แถวของ attempt ใหม่ (S27) ส่ง unverified success จากหน้า return ไม่ได้ quota (S30)
- CONSUMED แต่ HELD ยังนับเป็นใช้ slot แม้ quota ยังไม่เพิ่ม (S36); การนับ cap ตอนลดจำนวนใน console ต้องทวน F09

### ขอบเดือนและเวลาไทย

31 ม.ค. 2026 เวลา 10:00 ไทย → paidEnd 28 ก.พ. → benefitEnd 31 มี.ค. (S12) และ 29 ก.พ. 2028 ซื้อปีแถมเดือน → benefitEnd 29 มี.ค. 2029 (S13) ผ่านการบวกเดือนครั้งเดียวจาก original anchor

S15 ทำให้เห็นผลที่ต้องแสดงให้ลูกค้าอ่านได้: **31 ม.ค. 2026 เวลา 00:30 ไทย** คือ 30 ม.ค. UTC; convention UTC ที่ spec เลือกให้ paidEnd เป็น **1 มี.ค. เวลา 00:30 ไทย** เพราะ clamp เป็น 28 ก.พ. UTC และแปลงกลับ timezone นี่เป็นผลของกติกาที่ระบุไว้ ไม่ได้รายงานเป็น bug การคำนวณ แต่ควรแสดงวันจริงใน quote และมีตัวอย่างนี้ใน acceptance หากต้องการเดือนปฏิทินไทยแทน ต้องแก้ convention อย่างชัดเจนก่อน implement

## 4 Findings ที่ต้องปิด

Priority P1 คือก่อนเปิดเส้นทางที่เกี่ยวข้อง ไม่ได้หมายความว่าพบ incident ใน Production

| ID | ระดับและประเภท | กรณีจำลองและผล | จุดที่ต้องระบุหรือแก้ใน design |
| --- | --- | --- | --- |
| F01 | P1 SPEC_GAP | เปิด campaign ที่ base 30/360 แล้ว catalog เปลี่ยน monthlyReceiptAllowance เป็น 50; bonus คง 30 จะได้ **80/630** แทนคำสัญญา **60/390** (W02/W03) | §4–§6 ต้องกำหนด catalog revision ที่ campaign ยอมรับและ policy เมื่อราคา/โควตาเปลี่ยน แนะนำ mark stale และให้ Admin re-preview ก่อนรับจองใหม่; quote ที่รับแล้วใช้ snapshot เดิม ไม่แก้ bonus ตาม live catalog โดยเงียบ |
| F02 | P1 CONTRACT_MISMATCH | unique `(stripeAccountId,livemode,campaignId,companyId)` ให้บริษัทเดิมจอง campaign เดิมซ้ำได้เมื่อเปลี่ยน `stripeAccountId` (W01) | มติคือหนึ่งครั้งต่อบริษัทต่อแคมเปญ แนะนำ uniqueness ตาม company + stable campaign + logical environment; provider account เป็น evidence binding ไม่ใช่ตัวคืนสิทธิ์ หาก campaign ID ผูกบัญชี provider จนย้ายไม่ได้ต้องเขียน invariant นี้และมี migration rule |
| F03 | P1 SPEC_GAP | t0 commit RESERVED, t1 Admin END, t2 provider สร้าง session/response หาย Spec พูดทั้ง “รับจองก่อนปิด” และ “ผูก Checkout แล้ว” จึงยังตัดสินกรณีนี้ไม่แน่นอน (W05) | §6/Q3 กำหนด acceptance cutoff เดียว แนะนำ reservation commit ที่ตรวจ campaign/version แล้ว พร้อม deadline ที่เริ่ม/กู้คืน session ได้, journal ของ I/O และเงื่อนไขพิสูจน์ไม่จ่ายก่อน release ห้ามใช้ timeout เป็นหลักฐานไม่จ่าย |
| F04 | P1 POLICY_PENDING | มี base 30 + bonus 30, ใช้ 20 แล้วซื้อแพ็กปกติอีก 30; หาก base-first จะเหลือที่ carry ต่อ 40 ใบ แต่ bonus-first จะเหลือ 60 ใบหลังโบนัสเดิมหมดตาม fixed expiry (W04) | §5/Q1 ต้องกำหนด availability, expiry, consumption order เมื่อหมดอายุเท่ากัน และ carryover ของโบนัสด้วย จำนวนรวม 60/390 อย่างเดียวไม่พอกำหนด ledger; อย่าให้ createdAt/UUID ตัดสินประโยชน์ลูกค้าแทนนโยบาย |
| F05 | P1 SOURCE_GAP + POLICY_PENDING | paid 5 ต.ค.–5 พ.ย., free 5 พ.ย.–5 ธ.ค., ซื้อ paid period ถัดไป 5 ธ.ค.–5 ม.ค. ไว้ล่วงหน้า; `aiCreditCycleAt` เดิมที่ 10 พ.ย. คืน `null` (P03) ถ้าไม่มี future purchase จะยืด cycle key 5 ต.ค. เดิมแทนเปิดรอบใหม่ (P02) | §5/Q2/G07 ต้องมี promotion segment ใน cycle projection และ funding provenance; ตรวจทั้ง free tail และ free gap ระหว่าง paid periods ไม่แก้เพียง `paidThrough` หรือเพิ่มงบให้ทุก admin gift |
| F06 | P1 RECOVERY_GAP | ชำระและ apply one-time สำเร็จแล้ว แต่ recurring bind timeout/failed; flow ที่จะ reuse เรียก bind หลัง paid apply ลูกค้ามี 2/13 เดือนจริง แต่ยังยืนยันการเก็บรอบต่อไปไม่ได้ | §6–§7 ต้องแยก paid/apply success จาก renewal setup readiness และแสดง pending/review ใน return/status/admin พร้อม command journal เดิม เก็บ active reservation/recovery reference และตรวจ subscription เดิมก่อน retry; ไม่ rollback เงินหรือ grant อัตโนมัติ |
| F07 | P1 JOURNEY_GAP + POLICY_PENDING | บริษัทใช้โปรแล้ว, cap เต็ม หรือโปรหมดระหว่างดูการ์ด ยังต้องซื้อปกติได้ และผู้ถือ event discount ต้องเลือกว่าจะใช้สิทธิ์ใด ภายใต้ Q4 ที่ยังไม่ยืนยัน | §3/§6 ระบุ promotion eligibility แยก `new_sales`; ตัวเลือก NORMAL/PROMOTION/EVENT_DISCOUNT หรือ contract ที่ให้ผลเดียวกันต้องผูก quote หากหลุดโปรให้ review ราคา/ระยะเวลาใหม่ก่อนเรียกเก็บ ไม่ขาย 1 เดือนจากหน้าที่แสดง 2 เดือนโดยเงียบ |
| F08 | P1 POLICY_PENDING | Upgrade ในช่วงฟรีหรือ partial/full refund หลังใช้ bonus ไปแล้ว ไม่มี expected result เดียวสำหรับ tier, free time, quota และสิทธิ์ใช้ campaign ซ้ำ | Q5/Q6 ต้องมี action matrix แยก paid/free, used/unused, active/future purchases, full/partial refund, dispute และ end-package ทุกกรณีอ้าง invoice ที่จ่ายจริง ไม่แปลงเดือนฟรีเป็นเครดิตเงินโดยเดา |
| F09 | P1 TRANSACTION_GAP | Admin อ่าน usage 0 และเตรียมลด cap 2→1; สองร้าน reserve ตาม cap 2 แล้ว Admin publish cap 1 จากข้อมูลเก่า → มี taken 2 เกิน cap 1 (W06) | §4/§6 ระบุ final transaction ของ publish ลด cap/pause/end ต้อง fence กับ admission ที่ campaign เดียวกันด้วย version/lock เดียวกัน ตรวจ live counts ที่ final mutation และใช้ลำดับ lock ตายตัว ExpectedVersion ของ settings อย่างเดียวไม่พิสูจน์การแข่งกับ redemption |

F01/F02/F03/F06/F07/F09 เป็นการทำให้ contract ที่ยังขาดชัดขึ้น F04/F05/F08 มีนโยบายที่รอมติอยู่แล้ว ผลนี้ไม่ได้อนุมัติข้อเสนอแทน Owner และไม่ได้แก้ข้อกำหนดเดิมให้ถือว่าปิดประเด็นเหล่านี้แล้ว

### หลักฐาน source ของ F05 และ F06

M `apps/api/src/modules/line-ai/application/ai-credit-cycles.ts:87` รับเฉพาะ paid invoice periods เมื่อไม่พบ period จะ fallback ได้เมื่ออยู่หลัง **period สุดท้าย** เท่านั้น Future paid purchase ทำให้ free gap ก่อน period สุดท้ายหลุดจาก fallback; โค้ดปัจจุบันไม่มีข้อมูล promotion segment ให้ตัดสินจาก probe นี้

| Probe | ข้อมูลที่ให้ฟังก์ชัน | actual |
| --- | --- | --- |
| P01 | อยู่ในช่วง paid ตุลาคม | cycle key เริ่ม 5 ต.ค. |
| P02 | free tail พฤศจิกายน ไม่มี paid period ในอนาคต | key เดิม 5 ต.ค., ยืด end ถึง 5 ธ.ค. |
| P03 | free gap พฤศจิกายน มี paid period ธ.ค. ที่ซื้อล่วงหน้า | `null` |
| P04 | เข้าช่วง paid ธ.ค. แล้ว | cycle key เริ่ม 5 ธ.ค. |

M `apps/api/src/modules/billing/application/billing-reconciler.service.ts:713` เรียก `bindPromptPayRenewal` หลังจบ paid application และตัว bind เริ่มที่ `:1111` นี่เป็นแหล่งของ recovery boundary ที่ F06 ต้องใช้ซ้ำและระบุผลที่ลูกค้าเห็น ไม่มีการจำลอง provider timeout จริงในงานนี้

## 5 Coverage ของ acceptance ทั้ง 27 ข้อ

MODEL_ONLY หมายถึงตรวจบางส่วนด้วย reference model; SPEC_GAP/POLICY_PENDING หมายถึงยังไม่มี oracle ที่ครบสำหรับ acceptance ข้อนั้น; NOT_RUN ต้องพึ่งระบบที่ยังไม่ได้ implement ทุกสถานะในตารางนี้ยังต้องมี application verification ภายหลัง

| Acceptance | สถานะ | หลักฐานหรือสิ่งที่ยังขาด |
| --- | --- | --- |
| A01 | MODEL_ONLY | S08/S09 เวลาและ quota จาก fixture |
| A02 | SPEC_GAP | S10/S11; source/mode และ normal purchase fallback ตาม F07 |
| A03 | SPEC_GAP | S20–S24; ข้าม provider ยังขัด F02 |
| A04 | MODEL_ONLY | S04/S23 stale revision และคงสิทธิ์ใช้แล้ว |
| A05 | MODEL_ONLY | S12–S15 calendar และต้นวันไทย; calendar helper source assertion |
| A06 | MODEL_ONLY | S08–S11/S37 วันชำระและ paidAt drift |
| A07 | POLICY_PENDING | S08/S09/S31 ใช้ข้อเสนอ immediate availability; F04 |
| A08 | SPEC_GAP | S31 ไม่เติมซ้ำ; allocation order/expiry/carryover ตาม F04 ยังไม่ครบ |
| A09 | POLICY_PENDING | Q2 และ source probe F05 |
| A10 | MODEL_ONLY | S16–S19/S25/S26/S30 ใช้ payment proof จำลอง |
| A11 | SPEC_GAP | S18/S19/S32 ให้วันเป้าหมาย; F06 bind recovery ยังไม่ชัด |
| A12 | NOT_RUN | Existing-subscription native schedule/collection proof |
| A13 | NOT_RUN | S32 มีเฉพาะวันที่รอบปกติ; ยังไม่ cancel/resume/grace/sweep จริง |
| A14 | POLICY_PENDING | Q5/F08 |
| A15 | SPEC_GAP | S02/S06/S33–S36; acceptance cutoff/cap publication race F03/F09 |
| A16 | MODEL_ONLY | S25–S29/S34 replay/held/release ใน memory เท่านั้น |
| A17 | POLICY_PENDING | Q4/F07 |
| A18 | POLICY_PENDING | Q6/F08 |
| A19 | MODEL_ONLY | S05/S30 เป็น boolean fixtures ไม่ใช่ HTTP authorization |
| A20 | SPEC_GAP | F01/F07 และยังไม่มี UI ทุกช่องทาง |
| A21 | NOT_RUN | Migration/rolling deployment/unknown-kind compatibility |
| A22 | MODEL_ONLY | S36 นับ paid-held; ยังไม่อ่าน financial/report ledger จริง |
| A23 | MODEL_ONLY | S01 draft logic; ยังไม่ทดสอบ persistence และ browser reload |
| A24 | MODEL_ONLY | S02/S03 เวลาและ gate; ยังไม่รัน API/scheduler |
| A25 | MODEL_ONLY | S06/S07 pause/end/accepted payment |
| A26 | SPEC_GAP | S04/S29 stale/replay; final cap mutation ยังต้องปิด F09 |
| A27 | NOT_RUN | Mobile/desktop/permission/error states ของหน้า campaign |

## 6 การทำซ้ำและสถานะถัดไป

คำสั่งที่รันในรอบนี้สำเร็จ:

```sh
python3 /var/folders/vc/hbfllfl96mn49byp8f0q_cpr0000gn/T/starter-promo-e2e-20261005-kjtvssyr/simulate.py /var/folders/vc/hbfllfl96mn49byp8f0q_cpr0000gn/T/starter-promo-e2e-20261005-kjtvssyr/model-results.json
node /var/folders/vc/hbfllfl96mn49byp8f0q_cpr0000gn/T/starter-promo-e2e-20261005-kjtvssyr/source-probe.cjs /var/folders/vc/hbfllfl96mn49byp8f0q_cpr0000gn/T/starter-promo-e2e-20261005-kjtvssyr/source-probe-results.json
```

Scripts เป็นไฟล์ชั่วคราว อาจถูกล้างภายหลัง หลักฐานถาวรใน `docs/evidence/` เก็บ input/expected/observed/trace, spec hash, exact source revision และ script/source hashes แทนการเพิ่มโปรแกรมจำลองเข้า application

ลำดับปิดงานสำหรับการพัฒนาครั้งต่อไป:

1. ล็อก Q2/Q4/Q5/Q6 และโบนัสใช้เมื่อใด/หักลำดับใด/หมดอายุเมื่อใด โดยใช้ F04/F05/F07/F08 เป็นตัวอย่างตัดสินใจ; ค่า start/end/cap จริงให้ Admin กรอกตอนสร้าง campaign ตามมติเดิม
2. ปรับ contract ตาม F01/F02/F03/F06/F09: catalog revision, redemption identity, reservation cutoff, renewal setup state และ final mutation lock
3. จึงจัด implementation plan และสร้าง DB/provider/UI tests ที่ fail กับช่องว่างเหล่านี้จริง ก่อนเปิดรับเงินจริง

สถานะนี้คือจบการตรวจจำลองตามคำขอ ไม่มีการเลือกนโยบายที่ค้างแทนผู้ใช้หรือเริ่ม implementation
