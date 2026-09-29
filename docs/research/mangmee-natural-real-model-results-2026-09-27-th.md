# ผลทดสอบบทสนทนาธรรมชาติและ LINE payload — 2026-09-27

สถานะ: **ไม่ผ่านการรับงานด้านการสนทนา / ยังไม่พร้อมรับรองใช้งานจริง** — รันโมเดลจริงและตรวจ output แล้ว; การแก้บัคเฉพาะจุดไม่ใช่การปิด W14

## ขอบเขตและหลักฐาน

- ผู้ใช้ตรวจคำถามและอนุญาตให้ทดสอบต่อ รวมทางเลือกตรวจข้อความ การ์ด และลิงก์ที่ส่งออกจาก webhook หากต่อ LINE จริงไม่ได้
- NAT 12 บทสนทนา / 60 ข้อความ ภาษาไทยธรรมชาติ คำผิด คำถามไม่ครบ และการถามต่อ ใช้คำถามเดิมจาก [ชุดตรวจ](mangmee-ai-human-review-2026-09-27-th.md)
- Source ที่ทดสอบเต็มชุด: `f9444099ee4ce88cb95d99ef192b1c6bf2fac543`; build API/Gateway จริง ใช้ PostgreSQL, Redis, S3-compatible storage แยกสำหรับข้อมูลสังเคราะห์ ผ่าน webhook/controller และเครื่องมือที่ตรวจสิทธิ์จริง
- โมเดลจริง: Bedrock `global.anthropic.claude-sonnet-4-6`, region `ap-southeast-1`, local HTTP Gateway / `strands-local`; ใช้ profile ที่ได้รับอนุมัติไว้แล้ว ไม่เปลี่ยนโมเดลระหว่างชุด ไม่ได้ส่งข้อมูลลูกค้าจริง
- เปลี่ยนเฉพาะปลายทางส่ง LINE เป็น HTTP sink และให้ endpoint รับไฟล์ LINE ส่ง bytes ของไฟล์ทดสอบที่ตรึง hash ไม่จำลองคำตอบโมเดลหรือผลเครื่องมือ ERP
- ตรวจรูปร่าง payload กับตัวตรวจของระบบ และเทียบลิงก์กับ route ในโค้ด ไม่ใช่หลักฐานว่า LINE รับ/render จริง หรือผู้ใช้เปิดลิงก์ผ่าน login/LIFF สำเร็จ
- Public lookup และเสียงปิด; ยังไม่ทดสอบ Financial Profile/Services Needs ไม่มี deploy หรือเปลี่ยน customer gate ของ UAT/Production

NAT มีหัวข้อ capability 14 IDs ไม่ใช่การรับครบ 16 capabilities ที่อยู่ใน rollout และไม่ใช่ผลแทน corpus เดิม 225 เคส ข้อมูลเวลาเป็น diagnostic local พร้อมผู้ให้บริการจริงหนึ่งรอบ ไม่ใช่ p95 ของลูกค้า Production

## สิ่งที่พบและแก้ก่อนรันเต็มชุด

| ประเภท | หลักฐานและสาเหตุ | สิ่งที่แก้ |
|---|---|---|
| โค้ดจริง: อ้างตำแหน่งข้อความผิด | raw provider เข้าใจคำถาม “เดือนนี้ค่าไช้จ่ายไปเท่าไหร่แล้ว” แต่ส่ง `endUtf16=34` ทั้งที่ข้อความยาว 32; strict parser จึงปฏิเสธ | ส่ง whole-part reference ที่ระบบคำนวณให้คัดลอก; ไม่ผ่อน parser ไม่แก้ output ให้ผ่านเอง |
| โค้ดจริง: ใช้ prepared read ไม่ได้ใน v2 | semantic branch ข้าม prepared path แล้วต้องใช้ control+answer เพิ่ม ทั้งที่ grant เหลือหนึ่ง slot หลัง intake | ใช้ guarded prepared read/formatter เดิมเฉพาะขอบเขตที่พิสูจน์ได้; คง budget และการตรวจตัวกรอง |
| โค้ดจริง: คำตอบบางส่วนส่งไม่ออก | producer สร้าง `PARTIAL` โดยไม่มี `limitation`; validator โยน `PLAN_INCOMPLETE_COVERAGE` หลังอ่านข้อมูลแล้ว | เพิ่ม limitation ที่จำเป็นจากคำถามค้าง/หน้าที่อ่านไม่สำเร็จ; คงตัวตรวจและ pending IDs |
| โค้ดจริง: general failure ไม่ปิด event | ส่งข้อความว่าเครดิตตรวจไม่ได้ทั้งที่ intake เริ่มไปแล้ว และไม่บันทึก terminal status | เปลี่ยนเป็นข้อความล้มเหลวตรงเหตุการณ์และปิด event; ไม่เพิ่ม deadline |
| ตัวทดสอบ: ข้อมูล/config ไม่ครบ | category ขาด accountHintKey, launch gates หายหลัง reset, actor-delegation key ไม่ได้กำหนด | ใช้ seed/bootstrap จริง และ key สังเคราะห์เฉพาะ local; ไม่นับความล้มเหลวนี้เป็นข้อบกพร่อง Production |
| ตัวทดสอบ: สลับ turn ก่อนส่งเสร็จ | `response_ready` เกิดก่อน dispatch; sink เปลี่ยนเจ้าของ reply token แล้วปฏิเสธคำตอบก่อนหน้า | รอ actual webhook handler จบ และเก็บ exception ที่เกิดจริง |
| ไฟล์ทดสอบเดิมไม่ตรงฉลาก | PNG เดิมไม่มีข้อความ; PDF เดิมมีหนึ่งหน้าแต่ฉลากระบุสอง | สร้าง [NAT assets แยก](mangmee-ai-natural-assets-2026-09-27/README.md) ที่ตรวจภาพและจำนวนหน้าจริง; ไม่แก้ hash ของ corpus225 เดิม |

ก่อน full run มี diagnostic ที่ส่งยอดรายจ่ายถูกจริง 27,230.50 บาท / 9 รายการ พร้อมช่วง 1–27 กันยายน ใช้ประมาณ 8.7 วินาที ผลนี้เป็นหนึ่งตัวอย่าง ไม่ใช้แทนผล full run และไม่แปลว่าการถามต่อผ่านแล้ว

## ผลเต็มชุด

Full run เริ่ม `2026-09-27T04:03:43.800Z` จบ `04:18:40.696Z` ที่ source `f9444099` วางไว้ 60 ข้อ ได้หลักฐานจริง **56 ข้อ** อีก 4 ข้อ NAT06 ไม่ได้รันต่อเพราะข้อแรกติด timeout หลังสร้างรายจ่ายและอัปโหลดไม่สำเร็จ รายงานการซ่อม/รันทวนอยู่คนละ snapshot ห้ามนำมารวมเป็นผลผ่านชุดเดียว

- HTTP sink รับ **58 payloads / 83 messages ทั้งหมดเป็น text**; รูปร่างผ่านตัวตรวจของ repository ทั้ง58 ไม่ใช่การรับรอง LINE API จริง
- **ไม่มี Flex card, action หรือ postback ถูกส่งออกจริง** จึงยังไม่มีหลักฐานว่าปุ่มยืนยัน/แก้/ยกเลิกในบทสนทนา NAT ใช้ได้ ต้องแยกจากผล unit tests ของปุ่ม
- พบ URL ในข้อความ **12 จุด / 4 URLs ไม่ซ้ำ** ตรง origin บริษัทและ route ใน source (`crm-reports`, `notifications`, `expenses`, `settings/branches`) ไม่พบ route ต่างบริษัทหรือภายนอก ไม่ได้เปิดผ่าน login/LIFF และไม่มี web server ทดสอบหน้านี้
- เวลาถึงข้อความแรก 1.029–27.049 วินาที; ถึงข้อความสุดท้ายของแต่ละข้อ 6.838–27.049 วินาที ข้อแรกที่เร็วเป็น acknowledgement ได้ ค่าพวกนี้รวมคำตอบล้มเหลว ไม่ใช่ successful-answer latency หรือ Production p95
- ข้อถามรายจ่ายที่ตอบตัวเลขถูกจริงใช้ **8.522 วินาที**: 27,230.50 บาท / 9 รายการ แต่ไม่บอกว่ารวมร่าง900 จึงยังไม่ครบ rubric; คำถามเงินเข้าได้ **374,300 บาท / 3 รายการ ใน8.270วินาที** โดยระบุฐานเงินรับ ไม่ใช่ยอดขายตามใบแจ้งหนี้118,900
- trace บันทึก model-call accounting117; raw provider output116; usage rows111 `PROVIDER_REPORTED` +4 `CONSERVATIVE_ESTIMATE` มี timeout/usageไม่ครบ จึงไม่สรุปต้นทุนทั้งชุดเป็นยอดที่ชำระจริง
- ไม่มีบทสนทนา5ข้อใดผ่านครบเส้นทางที่ตั้งใจ คะแนน exact-tool/`factsCorrect=true` ของ expected facts ว่างถูกตัดออกจาก evidence ที่เผยแพร่ ไม่ใช้เป็นคะแนนความแม่นยำ

เปิด [ข้อความและ payload จริงแบบอ่านทีละข้อ](mangmee-natural-model-evidence-2026-09-27/primary-wire.html), [raw evidence ที่เก็บส่วนจำเป็น](mangmee-natural-model-evidence-2026-09-27/primary.json), [manifest](mangmee-natural-model-evidence-2026-09-27/primary-manifest.json) และการตรวจ semantic แยก [NAT01–04](mangmee-natural-model-evidence-2026-09-27/review-01-04.json), [NAT05–08](mangmee-natural-model-evidence-2026-09-27/review-05-08.json), [NAT09–12](mangmee-natural-model-evidence-2026-09-27/review-09-12.json) ทุกผลเป็น AI-assisted review ยังไม่ใช่ human acceptance

| บทสนทนา | สิ่งที่เกิดขึ้นจริง | ผลต่อผู้ใช้ |
|---|---|---|
| NAT01 รายจ่าย → เทียบเดือน/หมวด/เหตุผล | ข้อแรกตัวเลขถูก; ถามต่อไม่อ่านข้อมูลหรือ schema/timeout | ยังวิเคราะห์ต่อจากเรื่องเดิมไม่ได้ |
| NAT02 เงินเข้า → กำไร/เงินสด | ข้อแรกได้ฐานเงินรับถูก; ถามต่อไม่ครบ | ไม่ผ่านการแยกและเชื่อมเงินเข้า/กำไร/เงินสดทั้งบท |
| NAT03 สาขา/ชื่อคล้าย | ชื่อ “ร้านราม” ถูกส่งเป็น vendorId แทนการถามสาขาให้ชัด | ตัวกรองผิดชนิดและบริบทไม่ต่อ |
| NAT04 ใบเบิกจากใบก่อนหน้า | fixture ไม่มีใบเสร็จสองใบก่อนหน้า; ระบบยังตอบ generic/schema; cancel ไม่ปิด task ที่ค้าง | happy path ถูก block ด้วย fixture และยังมีบัคสถานะ/การตอบเมื่อข้อมูลขาด |
| NAT05 อ่านรูป → VAT/ชื่อ/วันที่ → ร่าง | ข้อมูลไฟล์ส่งถึง intake โดยไม่มี image bytes; ไม่มี document reader และไม่มี preview | ต้องแก้ input plumbing ก่อนตัดสินความสามารถอ่านรูปของโมเดล |
| NAT06 อ่าน PDF → เปลี่ยนไฟล์/หน้าสอง | อ่านอย่างเดียวแต่เข้า legacy capture สร้าง ExpenseRecord ก่อนอัปโหลด; harness ไม่อนุญาต local S3 PUT จึง timeout | มี defect การเขียนจริงแยกจากบัคตัวทดสอบ; ต้องปิดก่อนรับงาน |
| NAT07 ตัวเลขกำกวม/คำแก้ | timeout, คำแก้1200ไป flow แก้รายการเก่า, ต่อมาผิด schema | ไม่ได้ preview ที่อ้างอิงคำแก้ล่าสุด |
| NAT08 ร้านสมชาย/เลือกบิล | ใช้ชื่อเป็น ID, ละ vendor filter, `vendorName` ที่ไม่รองรับถูกแปลงเป็น `recent` | เคยเห็นบิลจาก tool แต่กลับตอบไม่พบทั้งระบบ; ตัวเลือกไม่ถึงผู้ใช้ |
| NAT09 ถามแทรกแล้วกลับงาน | VAT จบด้วย `AI_GENERAL_ADMISSION_UNAVAILABLE`; กลับสรุปถูกส่งไปแก้รายการ | สูญเสียเป้าหมายเดิมและส่งเว็บผิดจังหวะ |
| NAT10 ข้อมูลไม่ครบ/สาขาที่ดูได้ | ไม่มี tool read, ตอบ retry; ไม่รั่วข้อมูลสาขาต้องห้ามที่ทดสอบ | ไม่ได้อธิบาย “ไม่พบ” ต่างจาก “ยังไม่จ่าย” และทำส่วนที่มีสิทธิ์ไม่ได้ |
| NAT11 จำวิธีตอบ/ขอลืม | preferenceJson=null/version0 ตลอด; ถามยอดเพิ่มกลับไปหาเอกสารล่าสุด | ความจำที่เปิด flag แล้วยังไม่ทำงานจากภาษาผู้ใช้ |
| NAT12 ร่างสามร้อย→350→ยกเลิก→สถานะ | BadRequestException, schema failure, general admission failure และ timeout | ยังสร้าง/แก้/ยกเลิก/ตรวจสถานะร่างต่อกันไม่ได้ |

## การแก้และรันทวนหลัง full run

เก็บแต่ละ snapshot แยก ไม่เปลี่ยนคำถามหรือผลเก่าให้ผ่าน:

1. `d8ec4acd`: ตัวทดสอบอนุญาตเฉพาะ configured local S3 origin ที่ผ่านตัวตรวจ local URL เพื่อให้ PUT จริงได้ ไม่เปิด external network กว้างขึ้น รัน NAT05 ยังไม่อ่านรูป เพราะ first intake ไม่มี bytes
2. `063b7f2a`: PDF ใน v2 ต้องมี typed write intent ก่อน expense capture; read/ไม่ชัด/ไม่มี caption เก็บไฟล์เป็น pending ตามจำนวนหน้าจริง ไม่สร้างรายจ่าย และ PARTIAL ไม่ส่งคำถามเดิมซ้ำ รันทวน NAT06ครบ5ข้อ ไม่พบ ExpenseRecord/Reimbursement write แต่ยังผิด: หลักฐาน QA ถูกปฏิเสธก่อนถึง provider; เมื่อเปลี่ยนไฟล์แล้วถามหน้าสอง state กลับไปไฟล์แรก จึงไม่ผ่านการอ่านหรือการรักษา current attachment มี quick-reply ยกเลิกงานQA2ปุ่ม syntaxตรงjobจริง แต่ไม่ได้กดและยังไม่มีFlex; มีคำสั่งงานภายในภาษาอังกฤษหลุดในข้อความ ดู [retest review](mangmee-natural-model-evidence-2026-09-27/review-pdf-retest.json)
3. `e9d86738`: first PNG/JPEG intake ได้ image bytes และใช้ IMAGE grant/profile + OCR admission/retry callback เดิม ทดสอบ NAT05ครบ5ข้อ พบ `hasImageContent:true` แล้ว และ **intake อ่านชื่อร้าน วันที่ ยอดก่อนVAT/VAT/รวมได้ตรงทั้ง5ช่อง** แต่จัดคำถามอ่านยอดเป็น generic `read` แทน `file`; output ไม่ส่งยอดที่อ่านได้ กลับถามว่าจะอ่านหรือบันทึก ยังไม่เรียก document reader และ follow-up ยังไม่เห็นรูปเดิม จึงไม่ผ่าน user-facing OCR journey
4. Direct-provider diagnostic ใช้รูปเดียวกันและโมเดลรุ่นเดียวกันนอก webhook อ่านชื่อร้าน วันที่ ยอดก่อนVAT1,196.63 / VAT83.87 / ยอดรวม1,280.50 ได้ถูกทั้ง5ช่อง ดู [input metadata](mangmee-natural-model-evidence-2026-09-27/direct-image-metadata.json) และ [ผลจริง](mangmee-natural-model-evidence-2026-09-27/direct-image-response.json) หลักฐานนี้แยกความสามารถของโมเดลออกจากข้อบกพร่องของแอป ไม่ใช้แทน end-to-end

ผลรันทวนสุดท้ายที่ **`a9763631`** (04:40:55.546Z–04:43:54.999Z): แก้ QA input event hash จาก32เป็น64hexตาม contract และจำกัดส่งภาพเฉพาะPNG/JPEG รัน NAT05+06ที่วางไว้10ข้อ ได้ **6ข้อ** (รูปครบ5,PDFข้อแรก) อีก4ข้อPDFหยุดหลังtimeout:

- NAT05ยังไม่ส่งยอดจากภาพ ไม่มี preview; บริบทใบเดิม/คำแก้ยังไม่ผ่าน ไม่มี ExpenseRecord/Reimbursement write
- NAT06เข้าถึง `line.document.qa` จริงแล้ว provider ใช้27.702วินาทีและตอบ `ok:true` แต่ output ไม่ผ่าน contract เป็น **`QA_RESULT_INVALID`**: ตรวจ parserจริงพบ spanอ้างข้อความผิด **7จาก13จุด** (factsหน้าแรก6จุด + evidenceหน้าสอง1จุด; เช่นชื่อเอกสารเริ่ม53แต่ระบุ57) ดู [parser audit](mangmee-natural-model-evidence-2026-09-27/qa-final-reader-parser-audit.json) จึงไม่มีคำตอบเอกสารที่ผ่านการตรวจส่งถึงผู้ใช้ fallbackถึงsinkและมีสถานะdeliveryACCEPTED แต่ eventค้าง `delivery_pending / LINE_DELIVERY_V2_PENDING` จน runnerหมด120วินาที ไม่มีการสร้างรายจ่ายจากคำขออ่าน
- **Providerตอบสำเร็จ ≠ หลักฐานผ่าน ≠ ส่งผลสำเร็จ** ไม่ผ่อน parser หรือเปลี่ยนผลให้ผ่าน และไม่ใช้ข้อความอ่านถูกบางส่วนใน raw output เป็นคำตอบที่ผู้ใช้ได้รับ

เปิด [payload รอบสุดท้าย](mangmee-natural-model-evidence-2026-09-27/qa-final-wire.html), [evidence](mangmee-natural-model-evidence-2026-09-27/qa-final-media.json) และ [raw reader output](mangmee-natural-model-evidence-2026-09-27/qa-final-reader-output.json), [final independent review](mangmee-natural-model-evidence-2026-09-27/review-final-media.json) การซ่อมที่ยืนยันแล้วคือ inputส่งถึงproviderและไม่เกิดimplicitexpensewrite ส่วน outputcontract/deliveryrecovery/currentfileยังเป็นblocker ต้องทวนทั้งบทอีกหลังแก้

Verification ของ scoped changes: API63/63, contracts8/8, GatewayQA4/4 และAPItypecheckผ่าน; ก่อนหน้านี้PDF/duplicate-question39และwebhookcompat353ผ่าน, intake/Bedrock65ผ่าน, prepared69+compat81ผ่าน และGatewaytypecheckผ่าน Harness/report/corpus/runnerรอบสุดท้าย31ผ่าน1skip (PGseed opt-in; seedจริงเคยผ่านในรอบก่อน) ไม่ใช้ผลtestsเหล่านี้แทนโมเดลจริงหรือhumanapproval

## งานแก้ที่ยังปิดไม่ได้ และ acceptance ที่ต้องผ่าน

| ลำดับ | โค้ด/ขอบเขตที่ต้องแก้ | หลักฐานรับงานที่ต้องมี |
|---|---|---|
| P0 | Document reader output ให้ตรง schema/evidence spans และ failure recovery ปิด event อย่างถูกต้อง | provider output ผ่าน contract จริง; invalid output ไม่สร้างรายการ/ไม่ค้าง delivery และผู้ใช้ retry/เปลี่ยนไฟล์ได้ |
| P0 | ยก context ที่โหลดแล้ว/ผลที่ส่งถึงผู้ใช้จริง/current attachment เข้า first intake และ semantic control/answer; ไม่ reuse intake ที่ขาด context | ถามต่อ/คำแก้/เปลี่ยนไฟล์/หน้าสองกลับมาที่ source ล่าสุด; missing/stale evidence ถามเฉพาะจุด |
| P0 | แยก semantic file-read จาก generic read ให้ผูกกับ document QA ที่มีจริง โดยไม่จับคำหรือแปลง read เป็น write | “ใบนี้รวมเท่าไร” เรียก reader ส่งยอดพร้อม source; “แค่ถาม” ไม่เขียน; “ทำร่าง” ได้ preview จากไฟล์เดียวกัน |
| P0 | จับคู่ budget class กับเส้นทางที่ทำงานครบ: simple ที่ formatter ไม่รองรับไม่ควรถูก block; general deadline10sหัก reserve3s เหลือน้อยหลัง intake6–9s | คำถามข้อมูล/ความรู้ทั่วไปได้คำตอบครบใน envelope ที่อนุมัติ วัดเวลาคำตอบสำเร็จ; ไม่เพิ่มเพดานหรือปิด validator เพื่อให้ผ่าน |
| P0 | resolve ชื่อร้าน/สาขาเป็น typed entity refs และ validate recordRefKind แทน fallback ไป latest | สมชายหลายร้านให้เลือกด้วยชื่อ/วัน/ยอดที่ส่งถึงผู้ใช้; ไม่อ้างว่าไม่พบทั้งระบบจาก lookup คนละชนิด |
| P0 | draft/edit/cancel/status/preference commands เดินผ่าน context/state ที่ถูกต้อง | คำไทยจำนวนเงิน→แก้เลข→ยกเลิก→ถามสถานะ ไม่มี duplicate/implicit confirm; preference set/read/delete จริง |
| P1 | ยอดต้องบอกฐาน draft/confirmed/paid และความครบถ้วนตามผล tool | รายจ่ายรวม≠จ่ายแล้ว; รายรับ≠กำไร;ไม่พบ≠ศูนย์/ยังไม่จ่าย |
| P1 | สร้างและส่ง LINE card/actions จาก successful preview พร้อมตรวจ postback parser และ latest revision | มี actual wire card/ปุ่มที่กดแล้วทดสอบ allow/deny/stale/cancel ได้ ไม่ใช้ envelope-pass แทน action acceptance |

ยังมี audit-only gap ของ fresh mixed write ที่อ้าง whole input ได้ในบาง branch; full run นี้ไม่ได้พิสูจน์ exploit หรือ unexpected write จากเคสนั้น ต้องใส่ regression ก่อนรับ mixed read/write scope คงสิทธิ์ tenant/source-state/preview/final-mutation boundaries ทุกข้อ ไม่ใช้การลดกติกาเพื่อหยุด error

## ขอบเขตที่ยังรับรองไม่ได้

- การส่งและหน้าตาบน LINE จริง รวมการเปิดลิงก์ผ่าน authentication/LIFF
- ใบเสร็จจากร้านจริงหลากหลายแบบ และ human-certified OCR labels; NAT assets เป็นข้อมูลสังเคราะห์ที่มี ground truth จากผู้จัดทำ
- NAT04 ไม่มีใบเสร็จร้านเครื่องเขียนสองใบที่ส่งก่อนเริ่ม จึงตรวจได้เฉพาะความซื่อสัตย์เมื่อหลักฐานขาด ไม่รับรองเส้นทางเลือกรายการและทำใบเบิกครบ
- การอนุมัติ การจ่ายเงิน และการยืนยัน mutation ไม่อยู่ในคำถามที่อนุญาต; ต้องคง preview/confirm และตรวจว่าไม่มีรายการการเงินเปลี่ยนโดยไม่มีคำสั่ง
- การเทียบโมเดลอื่น การทดสอบหลายรอบ และความเร็วภายใต้โหลดจริงยังไม่ได้ทำในชุดนี้

## รันทวนด้วยโมเดลจริง 2026-09-29 — ถามเรื่องไฟล์ (NAT05/NAT06)

เจ้าของสั่ง "แก้ให้ผ่านเลย" รอบนี้แก้ P0 แถวอ่านไฟล์ (document reader output/recovery, current attachment, semantic file-read, "ทำร่าง" จากไฟล์เดิม) ในสาขา `claude/line-ai-document-qa-fix-20260929` แล้วรัน NAT05 และ NAT06 ครบ 5 ข้อความต่อเรื่องด้วยโมเดลจริง

**วิธีรัน:** API/Gateway ที่ build จริง + PostgreSQL/Redis/MinIO แยก (`aifix-*`) + `runLineReliabilityRuntime` เดิม, LINE เป็น HTTP sink; Bedrock `global.anthropic.claude-sonnet-4-6` ผ่าน `AWS_PROFILE=watchdog-bedrock` ตาม production; **turn รันใน AgentCore runtime แยก process ด้วย env ของ `infra/ai-gateway/agentcore-deploy.sh`** (gateway เรียกผ่าน `LINE_AI_AGENT_RUNTIME=agentcore` ที่ชี้ไป runtime local) ไม่ใช่ env เต็มของ gateway; clock ของ fixture เลื่อนเป็นวันที่รัน (seed เดิม) บันทึก prompt/output ดิบของ provider ทุกครั้งก่อนแก้

**สาเหตุจริงที่พบ (baseline บน develop `3d7b4d6c`):**

| อาการ | สาเหตุ | การแก้ |
|---|---|---|
| `QA_RESULT_INVALID` ทุกครั้ง | ข้อความ fact/evidence ตรงตัวอักษรทุกจุด แต่ offset UTF-16 เลื่อน (ตัว "—" ฯลฯ) parser ทิ้งคำตอบทั้งก้อน; บางครั้ง JSON มี `"` ไม่ escape หรือ `，` เต็มความกว้าง | หา span จากข้อความเอง (normalised containment สำรอง) claim ที่หาไม่เจอถูกตัดทิ้ง ไม่ทิ้งคำตอบ; reader ใช้ `extractJson` ร่วม + ซ่อม `，`/`：` นอกสตริง; ไม่ขอ offset อีก |
| event ค้าง `delivery_pending` | foreground turn กับ `recoverDocumentQaResults` ส่งผลเดียวกันพร้อมกัน ฝั่งที่แพ้ตั้ง `delivery_pending` แล้วสถานะจริงถูกกันไม่ให้เขียนทับ | recovery รอจนพ้น foreground window ของงานนั้น; foreground รองานที่ worker อื่น claim แทนการยอมแพ้ทันที |
| "ใบนี้รวมเท่าไหร่" ได้คำถามกลับว่า "รูปนี้เป็นอะไร" | prompt router ไม่มีนิยาม kind `file` → ตอบ `read`/`general` แล้ว reader ไม่ถูกเรียก | นิยาม `file` (คำถามเรื่องไฟล์ที่แนบ/ส่งก่อนหน้า รวม ใบนี้/หน้าสอง/แทน) และ "ทำร่าง…จากใบนี้" = `write` EXPENSE_DOCUMENT_CAPTURE |
| เปลี่ยนไฟล์แล้วถาม "หน้าสอง" ได้ไฟล์แรก | อ่านล้มเหลวแล้ว pending media ถูก `EXPIRED` ไฟล์ใหม่จึงหายจากตัวเลือก | อ่านล้มเหลว/หมดเวลาเก็บไฟล์ไว้ (`RESOLVED_RECEIPT`) ยกเว้นผู้ใช้ยกเลิก; ไฟล์ปัจจุบัน = ไฟล์ล่าสุดที่ถูกถาม คำว่า "ไฟล์แรก" อ่านไฟล์นั้นคู่กับไฟล์ปัจจุบัน |
| "ทำร่างค่าอาหารจากใบนี้" ไปที่ reader อ่านอย่างเดียว | ไม่มีทางเชื่อม text write กับไฟล์ที่อ่านไปแล้ว | write ที่ไม่มียอดเงินของตัวเอง + มีไฟล์ปัจจุบัน → ร่างจากไฟล์เดิม ผ่าน durable capture read เดิมและ result push เดิม |
| คำตอบช้า/timeout 45 s ที่ 4 หน้า | reader ถอดข้อความทุกหน้า + fact/evidence ซ้ำ ~2,800–8,000 token | excerpt ≤ 8 บรรทัด/หน้า, fact ≤ 2, ตอบรอบเดียวใน questionCoverage, minified JSON, เพดาน 3,000 token |
| ข้อความหลุดเป็นภาษาอังกฤษ/รหัสไฟล์ | แสดง goal ภายในของ router และ reader เอ่ย attachmentId | ข้อที่ค้างใช้คำของผู้ใช้เอง; คำตอบแทน id ด้วย "ไฟล์ที่ N" |

**ผลรันทวน (โค้ดสุดท้าย, 2 รอบติดกัน, 20/20 ข้อความตอบถูกและส่งถึง sink):**

| ข้อความ | รอบ 1 | รอบ 2 |
|---|---|---|
| NAT05-1 ใบนี้รวมเท่าไหร่ | 1,280.50 + แหล่ง 18.0 s | ถูก 18.7 s |
| NAT05-2 VAT | 83.87 12.2 s | ถูก 10.6 s |
| NAT05-3 ชื่อร้าน/วันที่ | Green Bowl Synthetic Cafe, 2026-09-21 11.8 s | ถูก 22.4 s |
| NAT05-4 แค่ถาม อย่าเพิ่งลง | ยืนยันไม่ลงรายจ่าย ไม่มี write 15.2 s | ยืนยันไม่บันทึก ไม่มี write 9.5 s |
| NAT05-5 ทำร่างจากใบนี้ | ร่างจากไฟล์เดิม + result push ขอกรอกส่วนที่ขาด 28.8 s | ถูก 19.9 s |
| NAT06-1 ใบนี้เขียนว่าอะไร | 2 หน้า + tax ID ถูกปิดบัง 26.3 s | ถูก 32.4 s |
| NAT06-2 ส่งผิด เอาไฟล์นี้แทน | อ่านไฟล์ใหม่ 32.7 s | อ่านไฟล์ใหม่ ส่งหลัง progress (provider 41.8 s) |
| NAT06-3 หน้าสอง | หน้า 2 ไฟล์ใหม่ อ่านได้แค่หัว 17.4 s | ถูก 18.2 s |
| NAT06-4 สรุปหน้าที่อ่านออก | หน้า 1 ครบ หน้า 2 เฉพาะหัว 21.5 s | ถูก 36.9 s |
| NAT06-5 เทียบกับไฟล์แรก | ไฟล์แรกยังอยู่ + เทียบ 4 หน้า 30.8 s | ถูก 36.6 s |

ไม่มี ExpenseRecord/Reimbursement จากคำถามอ่านอย่างเดียว; มี ExpenseRecord เฉพาะ "ทำร่าง" (ร่างรอตรวจ ไม่ยืนยัน/ไม่จ่าย; ใบสังเคราะห์ถูก gate ปฏิเสธการกรอกยอดอัตโนมัติจึงได้ข้อความ "อ่านได้บางส่วน…กรอกส่วนที่ขาด"); ทุก event จบที่สถานะ terminal ไม่ค้าง `delivery_pending`

**ค่าใช้จ่ายโมเดลจริง (ราคา app 33 THB/USD):** รวม 204.6 บาท (baseline 23.9, iteration 12 รอบ, 2 รอบผ่าน 30.4) ต่อรอบ NAT05+NAT06 ประมาณ 15 บาท

**ยังเหลือ/ความเสี่ยง:** เวลาตอบขึ้นกับ provider — 1 ใน 20 คำตอบเกิน foreground window (~37 s) จึงส่ง "กำลังอ่านไฟล์…" ก่อนแล้วตามด้วยคำตอบผ่าน recovery (ไม่ค้าง); router ตัดสิน "แค่ถาม" เป็น `file` หรือ `general` สลับกันได้ (ทั้งสองไม่ write); ไฟล์ NAT เป็นข้อมูลสังเคราะห์ ยังไม่ใช่ human acceptance
