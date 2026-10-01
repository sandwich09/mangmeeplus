# ผู้บริหารมั่งมี — สเปกหลังบ้านและสัญญาการเชื่อมหน้าจอ

คำที่แสดงบนหน้าจอล่าสุด: [ใช้คำที่คนทั่วไปเข้าใจ](mangmee-executive-plain-language-spec-th.md) — เมนู “รายรับ”, แท็บ “ลูกค้าที่สร้างรายรับสูง”; identifiers/สูตรเดิมคงไว้

ส่งออกล่าสุด: [Export Excel](mangmee-executive-excel-export-spec-th.md) — Excel Dashboard เขียว–ทองตามไฟล์v4, native charts/สูตร/ข้อมูลต้นทางสองชีต; ขอบเขตตามหน้าที่ดูและทุกหน้าของผลกรอง; ยังเป็นสเปก/เดโม

โครงหน้าล่าสุด: [เมนูย่อยและการเปรียบเทียบ](mangmee-executive-navigation-comparison-spec-th.md) แยกหน้าสรุป/วิเคราะห์เพื่อไม่ต้องเลื่อนทุกหัวข้อรวมกัน; เป็นข้อเสนอ UX และเดโม

อัปเดตกราฟล่าสุด: [การใช้ใบเสร็จ อันดับ และ 80/20](mangmee-executive-usage-pareto-spec-th.md) — เดโม72บริษัท พร้อมกราฟคลิกเจาะข้อมูล; deletion ยังคงซ่อน

## มติล่าสุด 2026-10-01 — พักและซ่อนฟีเจอร์ลบข้อมูล

Owner ขอให้ข้ามเรื่องลบข้อมูลและซ่อนฟีเจอร์นี้ไว้ ขอบเขตปัจจุบันเหลือ **EX-01–04 รายงาน/บริษัท และ EX-07/08 บัญชีผู้บริหาร**
EX-05/06, case summaries ใน EX-04/API06, API11 integration, API12, R12–R14, BE§18–19 และ Q06–Q08 เป็น **DEFERRED**
เก็บรายละเอียดเดิมเพื่อคุยภายหลัง ไม่ใช่เกณฑ์เปิดรายงาน/บัญชีรอบนี้ และไม่ถือว่าแก้บั๊กแล้ว
เดโมต้องไม่แสดงเมนู/ปุ่ม/รายการ/ลิงก์/สิทธิ์การลบ; เส้นทางคำขอที่บันทึกไว้เดิมกลับหน้าภาพรวม
API06 รุ่นแรกคืนเฉพาะประวัติบริษัทที่ได้รับอนุญาต ไม่อ่านหรือคืนข้อมูลคำร้อง
การซ่อนในงานนี้ไม่เปลี่ยนโมดูล operator `/system/data-rights` ที่มีอยู่ และไม่เปิดใช้ API ใหม่
Q01–Q05/Q09 ยังต้องสรุปสำหรับรายงาน/บัญชี; ไม่มีการอนุมัติให้เริ่ม application implementation จากมตินี้

สถานะ: **DETAILED DESIGN DRAFT — ตรวจ source และจำลอง E2E แล้ว; ยังไม่อนุมัติ policy ที่เปิดไว้ และยังไม่ implement**
วันที่ปรับล่าสุด: 2026-10-01
Owner: Product owner / Codex
หน้าจอ: [UI spec](mangmee-executive-business-ui-spec-th.md)
แผน: [Delivery plan](../plans/mangmee-executive-business-ui-plan-th.md)
Memory: [Executive business](../agent-memory/executive-business-demo.md)

เอกสารนี้เป็นสัญญาเป้าหมายสำหรับ BA, SA, BE, FE และ QA โดยรักษามติ Owner B1–B7 และเก็บ B8 เป็นประวัติที่พักไว้ตามมติล่าสุด
ส่วน 1–9 บันทึกมติและ presentation contract; ส่วน 10 เป็นต้นไปลงรายละเอียด API, ข้อมูล,
สูตร, สิทธิ์, concurrency และข้อกำหนด integration **ชื่อ endpoint/model/permission ใหม่เป็นข้อเสนอ ยังไม่มีในระบบ**
รอบนี้แก้เฉพาะเอกสาร ไม่เขียน application code, migration หรือทดสอบ mutation กับระบบจริง

- [Bug gap และผลกระทบข้ามโมดูล](../research/mangmee-executive-business-be-gap-impact-2026-10-01-th.md)
- [จำลอง E2E และเกณฑ์ตรวจรายเคส](../qa/mangmee-executive-business-e2e-simulation-2026-10-01-th.md)
- [แผน BE และ integration](../plans/mangmee-executive-business-backend-plan-th.md)

คำว่า **ยืนยันแล้ว** หมายถึงมติผู้ใช้; **ข้อเสนอ** หมายถึงแนวทางออกแบบที่ยังเปลี่ยนได้;
**รอมติ Qxx** หมายถึงห้าม implement ส่วนที่ขึ้นกับคำตอบโดยเดา การจำลองยืนยันความครบของเงื่อนไขได้
แต่ไม่ใช่หลักฐานว่า endpoint ใหม่ทำงานแล้ว หรือระบบลบข้อมูลพร้อมใช้งาน

## 1. มติ Owner รอบแรก

| ข้อ | มติ | ผลต่อระบบ |
|---|---|---|
| B1 | ผู้ใช้คือ Owner และผู้บริหาร รวมปัจจุบัน 4 คน; ต้องมีหน้าสร้าง user ใน admin console | เพิ่มการจัดการบัญชีผู้บริหาร; 4 เป็นจำนวนปัจจุบัน ไม่ใช่เพดานบัญชี และไม่ใช่ให้ทั้ง 4 คนเป็น SYSTEM_ADMIN |
| B2 | นับบริษัทจริงทุกสถานะ แยกกรองได้; ไม่รวมทดสอบ/ภายใน; หนึ่งพื้นที่บริษัทนับเป็นหนึ่งบริษัท | ต้องกำหนดแหล่งยืนยัน test/internal และแยก tenant identity จากเจ้าของที่มีหลายบริษัท |
| B3 | ใช้ฟีเจอร์จริงจึงนับใช้งาน; login แยก; ต้องรู้ว่าจ่ายแล้วแต่ยังไม่ใช้ หรือใช้มากน้อย | แยกสถานะชำระ/สิทธิ์บริการ/การใช้งาน; ต้องมีข้อมูลกิจกรรมและช่วงเวลาที่อธิบายได้ |
| B4 | รุ่นแรกดูเงินรับจริงจากแพ็กเกจ ต่ออายุ และส่วนเสริม หักคืนเงิน; ค่าธรรมเนียม/ต้นทุนแยก | รายรับผู้บริหารไม่เท่ากับยอดที่ให้เครดิตเซลล์ และไม่ใช่รายได้เฉลี่ยตามระยะสัญญา |
| B5 | แสดงทั้งเซลล์ผู้แนะนำและเซลล์ที่ได้ยอดเปิดบริษัท; รักษากติกายอดเปิดครั้งแรกเดิม | ห้ามใช้สองตัวตนแทนกัน; ยอดต่ออายุอยู่ในรายรับมั่งมี ไม่เพิ่มเครดิตยอดขายเดิมให้เซลล์ |
| B6 | Owner ยืนยัน “ถ้ามีเซลล์ก็เซลล์ ช่องทางก็ช่องทาง” | คง flow เดิม: มาจากเซลล์ให้ระบุเซลล์; มาจากช่องทางอื่นให้เก็บช่องทางนั้น ไม่เพิ่มรหัสเซลล์คู่กับทุกช่องทาง |
| B7 | ใช้กลุ่มธุรกิจอ่านง่าย แล้วเปิดดูประเภทกิจการละเอียดได้ | mapping จากข้อมูลกิจการเดิมต้องตรวจสอบได้; ไม่ใช้ privacy businessCategory เป็น industry ทางการค้า |
| B8 (DEFERRED) | สร้างคำขอ → อนุมัติ → คงข้อมูลทั้งหมด 14 วันก่อนลบจริง; หลังลบเหลือเฉพาะข้อมูลที่เก็บได้ตามกฎหมาย | เปลี่ยน cooldown เดิม 1 วัน; วางโครงหน้าก่อนได้ รายละเอียด retention/execution คุยเพิ่มภายหลัง |

## 2. บัญชีผู้บริหารและสิทธิ์

- เพิ่มรายการและหน้าสร้างบัญชีผู้บริหารใน admin console ตาม EX-07/08 ของ UI spec
- ใช้ identity/authentication primitives ที่มีอยู่; ไม่ทำฐาน user/password แยกสำหรับรายงาน
- แยกสิทธิ์อ่านรายงานออกจากสร้างบัญชี เปลี่ยนสิทธิ์ แก้บริษัท อนุมัติคำร้อง และดำเนินการลบ
- การเพิ่มผู้บริหารคนหนึ่งไม่สร้าง tenant membership ให้บริษัทลูกค้าทุกแห่ง
- รายชื่อ/อีเมลจริงของทั้ง 4 คนยังไม่ทราบ ไม่สร้างบัญชีจริงหรือส่งคำเชิญจากการสนทนานี้
- `/system/users` ปัจจุบัน redirect ไป `/system/partners`; ยังไม่มีหน้าจัดการบัญชีผู้บริหารตามขอบเขตใหม่นี้
- ต้องตัดสินก่อน implementation: ใครสร้าง/ระงับบัญชีได้, วิธีตั้ง credential/เชิญ, สิทธิ์รายบุคคล,
  account recovery, และผลของการถอนสิทธิ์ต่อ session เดิม
- จำนวนผู้บริหาร 4 คนไม่ตอบว่าใครเป็นผู้อนุมัติ/ผู้ลงมือลบ และไม่ยกเลิก single-admin policy เดิมโดยอัตโนมัติ

## 3. บริษัทและความหมายของ “จ่ายแล้วแต่ยังไม่ใช้”

ต้องมีสามมิติที่ไม่ใช้แทนกัน:

1. การรับเงิน: เคยจ่าย / จ่ายในช่วงรายงาน / ยอดคืนเงิน
2. สิทธิ์บริการ: ใช้ได้อยู่ / รอเปิดสิทธิ์ / หมดอายุ / ถูกระงับ ตาม state ของเจ้าของข้อมูลเดิม
3. กิจกรรม: เคยใช้จริงหรือยัง / ใช้ในช่วงรายงานหรือไม่ / ปริมาณและความถี่

หน้าจอต้องแยกอย่างน้อย:

| กลุ่ม | ความหมายที่ต้องสื่อ | สิ่งที่ยังต้องตกลง |
|---|---|---|
| จ่ายแล้ว ยังไม่เริ่มใช้ | ชำระแล้วและข้อมูลเพียงพอยืนยันว่ายังไม่เคยใช้ฟีเจอร์จริง; ใช้กลุ่มเดียวตามมติล่าสุด | การนับหลังชำระ/การใช้ช่วงทดลอง และ refund/reversal ทำให้พ้นกลุ่มอย่างไร |
| เคยใช้แล้ว แต่ไม่ใช้ในช่วงนี้ | มีประวัติใช้งานมาก่อน แต่ช่วงรายงานไม่มีกิจกรรมที่นับได้ | event taxonomy และช่วงเวลาที่นับ |
| จ่ายแล้ว ใช้งานอยู่ | มีการใช้งานจริงในช่วงที่เลือก | ปริมาณนับตาม event ที่ไม่ซ้ำ และเกณฑ์สำเร็จของแต่ละฟีเจอร์ |

มติล่าสุด: รวม “จ่ายแล้ว รอเปิดบริการ” กับ “จ่ายแล้ว ยังไม่เริ่มใช้” เป็นชื่อหลังเพียงกลุ่มเดียว
ไม่เพิ่มกลุ่มรอเปิดบริการในรายงานธุรกิจ; ถ้ามีปัญหาสิทธิ์บริการจริงให้บอกเหตุผลในรายละเอียดบริการ
ส่วนข้อมูลกิจกรรมไม่พอเป็น **หมายเหตุคุณภาพข้อมูล** “ยังประเมินการใช้งานไม่ได้”
ไม่ใช่ตัวเลือกสถานะธุรกิจ และห้ามนำไปรวมยอดกลุ่มยังไม่เริ่มใช้โดยเดา

ให้เห็นความมากน้อยผ่าน **จำนวนจริงก่อน**: วันใช้งาน, ผู้ใช้ที่ใช้งาน, เอกสาร,
การใช้ AI และการใช้ฟีเจอร์อื่นที่วัดได้ พร้อมช่วงเวลาและ login ล่าสุดแยกต่างหาก
ยังไม่อนุมัติคะแนนสุขภาพ เกณฑ์น้อย/กลาง/มาก หรือเปอร์เซ็นต์ใช้โควตาที่รวมหน่วยคนละชนิด

## 4. แหล่งข้อมูลเดิมที่ตรวจพบ

| เรื่อง | สิ่งที่มีอยู่ | ขอบเขตที่ต้องรักษา |
|---|---|---|
| ช่องทางที่รู้จัก | `SignupDiscoverySource`, `discoverySourceOther` ใน signup contract/request | ช่อง “อื่น ๆ” เป็นข้อความอธิบาย ไม่ยืนยันตัวตนเซลล์ |
| เซลล์ผู้แนะนำ | `Company.referralSalesUserId`, `referredAt`, `referralSource` | ต้นทางการแนะนำ แยกจากผู้ได้เครดิต |
| ยอดเปิดบริษัท | `SalesAttribution`, `SalesReportsService` | หนึ่งแถวต่อบริษัทตามกติกายอดเปิดครั้งแรก; ไม่ใช้แทน ledger รายรับทั้งหมด |
| ข้อมูลกิจการ | `Company.businessTypeCode`, `businessTypeOther`, legal identity | ประเภท TSIC/กิจการแยกจาก privacy category และรูปแบบนิติบุคคล |
| การใช้งาน | monthly AI/OCR usage และ event sources เดิม | ต้อง audit coverage/success/deduplication ก่อนนิยาม active customer |
| คำร้อง | `DataRightsCase` และ flow เดิม | การมีเคสยังไม่ยืนยันว่าตัวลบครบระบบพร้อมใช้งาน |

อ้างอิงโค้ด: `packages/contracts/src/external-signup.ts`, `packages/contracts/src/sales.ts`,
`apps/api/prisma/schema.prisma`, `apps/api/src/modules/sales-console/application/sales-reports.service.ts`

## 5. ประเด็น B6 — “อื่น ๆ” และรหัสเซลล์

### Current truth

- มี Website, IG, TikTok, Facebook, เซลล์ของมั่งมี, อื่น ๆ และไม่ระบุอยู่แล้ว
- เลือก “อื่น ๆ” จะแสดงช่องระบุข้อความ เช่น เพื่อนแนะนำ/งานอีเวนต์
- หน้าเว็บแสดงและส่ง `referralSalesCode` เฉพาะเมื่อเลือก `SALES`
- `normalizeSignupSalesCode()` คืน null หาก source ไม่ใช่ `SALES`; ดังนั้นไม่ใช่ข้อจำกัดแค่หน้าจอ

### มติ Owner — คงการเก็บที่มาตาม flow เดิม

- มาจากเซลล์: เลือก “เซลล์ของมั่งมี” และแสดงเซลล์ผู้แนะนำตามตัวตนที่ระบบยืนยัน
- มาจากช่องทาง: เก็บ Website / IG / TikTok / Facebook / อื่น ๆ ตามเดิม
  ช่อง “อื่น ๆ” ยังมีข้อความระบุรายละเอียด ไม่ตีความข้อความนั้นเป็นตัวตนเซลล์
- ไม่เพิ่มช่องรหัสเซลล์ให้เลือกควบคู่กับช่องทางอื่น และยกเลิกข้อเสนอ Facebook + เซลล์ใน signup
- รายงานยังวิเคราะห์ตามช่องทางและเจาะรายเซลล์ได้ โดยไม่เดาหรือแก้ attribution ของข้อมูลเก่า
- แยกผู้ได้เครดิตยอดเปิดบริษัทตาม B5 ต่อไป; เครดิตยอดขายไม่ใช่หลักฐานให้เปลี่ยนช่องทางที่ลูกค้าระบุ
- ตัวอย่างในเดโมเดิมที่แสดง Facebook คู่กับเซลล์ไม่ใช่เกณฑ์ตรวจรับ production

หลักฐาน: `apps/web/src/features/external-signup/SignupPage.tsx`,
`apps/api/src/modules/external-signup/domain/line-signup.logic.ts`,
`apps/api/src/modules/external-signup/application/submit-company-signup.use-case.ts`

## 6. มติ B8 — โครงคำขอลบและช่วงคงข้อมูล 14 วัน (DEFERRED)

มติใหม่นี้แทนข้อรอ 1 วัน/ทางลัดลบทันทีของ P31 สำหรับ flow ที่กำลังออกแบบ
ระหว่างช่วงรอ 14 วัน **คงข้อมูลทั้งหมด** ไม่ทยอย purge/anonymize บางหมวดก่อนครบกำหนด
หลังดำเนินการจริงให้เหลือเฉพาะข้อมูลที่มีฐานเก็บรักษาตามกฎหมายที่ผ่านการพิจารณา
การระบุว่าหมวดใดเก็บได้ ระยะเวลาใด และใครเข้าถึงได้ยังไม่ใช่ข้อสรุปทางกฎหมายในเอกสารนี้

โครงหน้าสำหรับคุยต่อ:

```text
รายการคำร้อง
  → รายละเอียดและขอบเขต
  → ตรวจสอบ / ขอข้อมูลเพิ่ม / พิจารณาอนุมัติ
  → ช่วงคงข้อมูลทั้งหมด 14 วัน
  → ครบกำหนด รอตรวจความพร้อมดำเนินการ
  → ดำเนินการลบข้อมูลที่อนุญาต + ตรวจหลักฐาน
  → ผลลัพธ์: ลบส่วนใด / เก็บส่วนใด / เหตุผล / ข้อยกเว้นที่ยังค้าง
```

ชื่อเหล่านี้เป็น presentation stages ยังไม่ใช่ enum/API state ใหม่
การรับคำร้อง อนุมัติ ครบกำหนด และลบสำเร็จเป็นคนละเหตุการณ์
ไม่เพิ่มปุ่มลบทันทีหรือออกแบบให้ข้ามระยะรอจากข้อยกเว้นเก่า

รายละเอียดที่ Owner ขอไว้คุยภายหลัง:

- จุดเริ่มนับ 14 วัน เวลาตัดยอด timezone และการเปลี่ยนอนุมัติ/เปลี่ยนขอบเขต
- ใครสร้าง/อนุมัติ/ดำเนินการ/ตรวจผลได้ และทำคนเดียวได้ในเงื่อนไขใด
- ระหว่างคงข้อมูล ลูกค้ายังเข้าใช้/เขียน/ส่งออกได้หรือไม่; billing/session/LINE/worker ต้องเปลี่ยนเมื่อไร
- ยกเลิกคำร้องหรือถอนอนุมัติได้ถึงขั้นไหน และคืนสถานะบริการอย่างไร
- ครบกำหนดแล้วต้องกดดำเนินการหรือมีงานอัตโนมัติ; ไม่เปิด automatic purge จากมตินี้โดยปริยาย
- รายการที่เก็บได้ตามกฎหมาย แยกฐาน/วันครบกำหนด/สิทธิ์อ่าน; รวม backup, processor, audit และ billing evidence
- Failure/partial deletion/retry/source drift/restore และการแจ้งผลที่ตรงหลักฐานจริง

อนุญาตเตรียมโครงหน้า/disabled actions/fixture states เพื่อคุย UX
ไม่เชื่อม executor หรือบอกผู้ใช้ว่าพร้อมลบจริงจนกว่าสัญญาและเงื่อนไขด้านบนจะครบ

## 7. งาน SA ที่ตรวจต่อได้เอง

- Audit แหล่งรายรับ/refund/fee และการใช้หน่วยสตางค์/สกุลเงินให้ตรง billing เดิม
- หา event ที่พิสูจน์การใช้จริง แยก login, failed/retried/duplicate activity
- ประเมินวิธี query/aggregate/pagination และ source freshness โดยไม่สแกนทุก tenant จาก client
- ออกแบบ platform read permission ที่ไม่ทำให้เข้าถึงเอกสารลูกค้าโดยอัตโนมัติ
- วาง contract สำหรับ snapshot/unknown/error/permission และ history ที่ย้อนไปตรวจได้
- ตรวจ account lifecycle และการออก credential ที่ reuse ได้ ก่อนเสนอ flow สร้างผู้บริหาร

## 8. ผลตรวจและแก้ความสอดคล้อง 2026-09-30

**เดโมและสเปกปรับตามมติแล้ว; integration ระบบจริงยังไม่เริ่ม:** หลัง Owner สั่งแก้
เดโม v2 ใช้ shared components/tokens/fonts ของ repo และครบโครง EX-01–08
กำหนด presentation contract §9 ให้ข้อมูล/สถานะ/สิทธิ์ที่หน้าจอต้องรับชัดเจน
นิยาม event, identity lifecycle และรายละเอียดการลบที่ Owner ขอคุยภายหลังยังไม่ถูกเดาแทน

| เรื่อง | เดโม v2 ↔ สเปก | งานเชื่อมระบบจริงที่ยังเหลือ |
|---|---|---|
| ที่มาเซลล์หรือช่องทาง B6 | ตัวเลือกมาจาก signup contract จริง; SALES ระบุเซลล์ ส่วนช่องทางอื่นไม่มีเซลล์คู่กัน | หา report source และ unknown/legacy mapping โดยไม่เปลี่ยน signup เดิม |
| ผู้แนะนำกับผู้ได้เครดิต B5 | แยกช่องใน detail และตารางเครดิตยอดเปิด; ตัวอย่างมีคนละเซลล์ให้ตรวจ | เชื่อม `SalesAttribution` แยกจาก billing receipts |
| Paid usage B3 | แสดงทุกกลุ่มและ drilldown; unknown เป็น `—`, login แยกจากการใช้จริง | ปิด event/ช่วงเวลา/coverage ก่อนคำนวณกลุ่มจากข้อมูลจริง |
| บัญชีผู้บริหาร B1 | มีรายการ ค้นหา กรอง สร้าง รายละเอียด ระงับจำลอง และ validation; มุมผู้อ่านไม่เห็น action จัดการ | ผูก identity/session/permission; `/system/users` เดิมยังไม่ใช่หน้าสร้างบัญชีนี้ |
| คงข้อมูลทั้งหมด 14 วัน B8 | มีรับคำขอ อนุมัติจำลอง ช่วงรอ ครบกำหนด และโครงผลลัพธ์; ปุ่มลบปิดเสมอในเดโม | ปิด anchor/สิทธิ์/retention inventory/executor; `startExecution()` เดิมยังไม่มี guard ช่วงรอนี้ |
| ธีม dropdown/input | bundle `SelectField`/`ThemedSelect`/`TextField`/`TextareaField`/`ThemedDate`/`Button` และ tokens/fonts จริง ไม่มี native select ใหม่ | ตรวจซ้ำใน system shell จริงหลังเชื่อม ไม่ถือเดโมเป็น application integration evidence |
| บริษัท/รายรับ/กลุ่มธุรกิจ B2/B4/B7 | ยอดรวม/กลุ่มมาจากชุดข้อมูลเดียว; มีแนวโน้มและประเภทกิจการละเอียด | ปิด test/internal source, cutoff/refund และ industry mapping |

หลักฐาน source: `apps/web/app/system/layout.tsx`, `apps/web/app/system/users/page.tsx`,
`packages/contracts/src/external-signup.ts`, `packages/contracts/src/data-rights.ts`,
`apps/api/src/modules/external-signup/domain/line-signup.logic.ts`,
`apps/api/src/modules/data-rights/data-rights.service.ts` (`approve` / `startExecution`)
และไฟล์เดโมตาม task memory

หลักฐานตรวจเดโม v2 อยู่ใน task memory และ delivery plan; ไม่มี API/network mutation ในเดโม
ก่อนเปิดระบบจริงต้องผูก contract §9 กับ backend และพิสูจน์ journey/สิทธิ์/เวลาโดยใช้ข้อมูลจริงในสภาพแวดล้อมทดสอบ
ไม่ใช้ผลทดสอบเดโมแทนหลักฐาน integration หรือบอกว่าตัวลบจริงพร้อมแล้ว

## 9. สัญญาข้อมูลระหว่างหน้าจอกับหลังบ้านสำหรับ implementation

ส่วนนี้เป็นเป้าหมายของ read model/command responses ไม่ใช่การเพิ่ม endpoint, permission key
หรือแก้ `DataRightsCaseStatus` ในรอบเดโม ชื่อสถานะแสดงผลต้อง map จากเจ้าของข้อมูลเดิมอย่างชัดเจน

### 9.1 บริบทและผลรายงานร่วม

| ข้อมูล | ข้อกำหนด |
|---|---|
| `period` / `asOf` / `timeZone` | เดือนที่ขอ เวลาที่ข้อมูลครอบคลุม และ timezone ต้องส่งกลับ; UI ไม่ติด label เดือนใหม่กับผลเก่า |
| `appliedFilters` | industry, discovery source, referring seller, entity, company/service status, usage group, query; ระบุให้ชัดว่าส่วนใดมีผลเฉพาะรายการ |
| `population` | จำนวนบริษัทจริงในขอบเขต; ไม่รวม test/internal; ไม่ใช้จำนวนแถวของหน้า pagination เป็นยอดรวม |
| `coverage` | complete/partial/unavailable และเหตุผลตามแต่ละ metric; null/unknown ไม่แทนด้วยศูนย์ |
| `metrics` / `groups` / `receiptTrend` | ผลรวมจากประชากรและแหล่งข้อมูลเดียวกัน; ยอดกลุ่มต้องรวมได้เท่ายอดรวมเมื่อหน่วยเหมือนกัน |
| จำนวนเงิน | integer สตางค์และ currency THB; receipts, refunds, net receipts และ fees แยกกัน; UI จัดรูปแบบอย่างเดียว |
| `items` / pagination | company ID เป็น key; ส่งยอดรวมและ paging metadata; รักษา filter เมื่อกลับจาก detail |

นิยาม tax/refund recognition/cutoff และ receipt source ยังต้องปิดก่อน query จริง
เดโมให้ข้อมูลเฉพาะเดือนกันยายน 2026; เดือนอื่นแสดง unavailable ไม่แต่งกิจกรรม/ยอดเป็นศูนย์
กราฟแนวโน้มเป็น fixture แยกที่ระบุว่าเป็นข้อมูลตัวอย่าง ไม่ใช้เป็นสูตรคำนวณ production

### 9.2 Company detail / paid usage / attribution

- Profile: `id`, name, legal entity, commercial industry, detailed business activity, province, joined date
  และ service/plan แยกกัน; ห้ามใช้ privacy category แทน commercial industry
- Attribution: `discoverySource` และ `discoverySourceOther` ตาม signup contract;
  `referringSalesId` ใช้สำหรับที่มา SALES, `creditedSalesId`/credited amount/date ใช้สำหรับยอดเปิดครั้งแรก
  จากกฎ B5; ข้อมูลเก่าที่ไม่ครบต้องคง unknown และไม่ rewrite จากการแสดงรายงาน
- Payment: ever paid, paid in period, receipt/refund/net amounts และ current entitlement เป็นคนละมิติ
- Usage: กลุ่มแสดงผล `NOT_STARTED`, `INACTIVE`, `ACTIVE`, `NOT_PAID`
  พร้อม counts (`activeDays`, `activeUsers`, `documents`, `aiRequests`), first/last meaningful activity,
  last login และ coverage; ชื่อกลุ่มเป็น read-model presentation ไม่ใช่เปลี่ยน company lifecycle enum
- ไม่ส่ง `AWAITING_SERVICE` เป็นกลุ่มรายงานใหม่; ใช้ `NOT_STARTED` เมื่อมีหลักฐานว่ายังไม่เริ่มใช้
  ถ้าประเมินไม่ได้ให้ `usageGroup: null` และ coverage/reason แยกต่างหาก
  หน้าจอแสดงหมายเหตุและ `—` ไม่เพิ่ม UNKNOWN เป็นตัวเลือกใน dropdown หรือการ์ดกลุ่มลูกค้า
  จำนวนที่ยังประเมินไม่ได้ต้องแสดงแยกจากยอดกลุ่ม เพื่อให้กระทบยอดประชากรได้
- Backend เป็นเจ้าของการจัดกลุ่ม/เวลาตัดยอด/deduplication; frontend ไม่เดาจาก login หรือ receipts เดือนเดียว
  ระหว่างยังไม่มี event contract ให้แสดง unknown ห้ามเปิดรายงานจริงด้วยสูตร fixture

### 9.3 บัญชีและสิทธิ์การแสดง action

- Account list/detail รับ user identity, name, email, status, assigned report access และ last login
  ไม่มี password/token ใน report payload; สร้างบัญชี reuse identity เดิมและคืน canonical user identity
- คำสั่ง create/status change คืนผลจริงหรือ field errors (ชื่อ/อีเมลผิด, อีเมลซ้ำ, สิทธิ์ไม่พอ)
  UI คงค่าเมื่อผิดพลาด ป้องกันส่งซ้ำ และแสดง success หลังคำสั่งสำเร็จเท่านั้น
- แยก capabilities อ่านรายงาน/จัดการบัญชี/รับคำร้อง/อนุมัติ/ดำเนินการลบ;
  UI ใช้ capabilities แสดง action แต่ API ต้องตรวจ permission และ target scope ใหม่ทุกครั้ง
- ไม่กำหนดว่าผู้บริหาร 4 คนมี capability จัดการโดยปริยาย; การระบุผู้ดูแลบัญชีและวิธีเปิดใช้งานยังรอตกลง
  เดโมเลือกมุม “ผู้ดูแลระบบ/ผู้บริหารอ่านรายงาน” เพื่อทดสอบ presentation เท่านั้น

### 9.4 คำขอลบและเวลา (DEFERRED)

- รับ case identity/company identity/requester reference/scope/status และ approval timestamps จากเคสเดิม
- แสดงช่วงคงข้อมูลจาก `holdStartsAt` / `holdEndsAt` / `asOf` ที่ backend ยืนยัน;
  ห้าม client เริ่มนาฬิกาเองจากการเปิดหน้า/กดอนุมัติ หรือใช้ client clock อนุญาตลบ
- เมื่อยังไม่ยืนยัน anchor ให้คืน hold dates เป็น null พร้อมเหตุผล “รอกำหนดช่วงคงข้อมูล”
  และไม่ให้ execute; วันเริ่ม/ครบที่มีใน fixture เป็นตัวอย่าง ไม่ใช่มติ anchor ใหม่
- การครบ 14 วันเป็นเพียง time gate; permission, source state, retention decisions และหลักฐานยังต้องผ่าน
  ถ้าส่งข้อมูลไม่ครบหรือ policy ยังไม่พร้อม action ดำเนินการต้องปิด พร้อมเหตุผลที่ผู้ใช้เข้าใจได้
- ผลหลังทำงานแยก deleted/retained/failed scopes, retention basis/end/restriction, execution evidence และ verified outcome
  ห้ามเปลี่ยนเป็นสำเร็จจากเวลาหรือ receipt ของคำสั่งเพียงอย่างเดียว
- การบังคับคงข้อมูลทุกหมวด 14 วันต้องทำที่ backend/workers/storage ตาม P31 ไม่ใช่แค่ disable ปุ่ม
  รายละเอียดนี้ยังอยู่ในงานหลังบ้านที่ Owner ขอไว้คุยต่อ

### 9.5 กรณีที่ต้องตรงกันก่อนรับ integration

ต้องตรวจอย่างน้อย: source SALES vs OTHER/FACEBOOK, referrer ≠ credited seller,
paid+never-used vs inactive vs unknown, refund และรายการต่ออายุ, company ก่อนสมัคร,
อีเมลซ้ำ/ถอนสิทธิ์, read-only user เรียก mutation, ก่อน/ตรง/หลังครบ hold period,
ไม่มี hold dates, source เปลี่ยนหลังอนุมัติ และผลลบไม่ครบ
ใช้ backend fixtures ที่ครอบคลุมกรณีเหล่านี้กับหน้าเดียวกัน ไม่เปลี่ยนค่าที่หน้าจอเพื่อให้ผลตรง

## 10. ขอบเขตสัญญาและความต้องการที่ต้องตรวจรับ

| รหัส | ความต้องการ | หน้าจอ | หลักฐานตรวจรับ |
|---|---|---|---|
| R01 | ผู้บริหารดูข้อมูลเชิงวิเคราะห์ข้ามบริษัทด้วย platform authority | EX-01–04 | tenant owner และ custom role ที่ชื่อเหมือนกันเข้าไม่ได้ |
| R02 | นับบริษัทจริงหนึ่ง workspace ต่อหนึ่งรายการ ทุก lifecycle ที่กรองได้ | EX-01–03 | ไม่มี duplicate จากหลาย signup/สมาชิก/ใบรับเงิน; test/internal แยก |
| R03 | มีบริบทเดือน เวลา ความสดและขอบเขตข้อมูลที่ตรวจย้อนกลับได้ | EX-01–04 | KPI, breakdown, drilldown ใช้ snapshot/filters เดียวกัน |
| R04 | แยกเคยจ่าย รับเงินในเดือน บริการปัจจุบัน และกิจกรรม | EX-01/02/04 | refund/renewal/trial ไม่เปลี่ยนความหมายข้ามมิติ |
| R05 | จ่ายแล้วไม่เคยใช้มีเพียง NOT_STARTED กลุ่มเดียว | EX-01/02/04 | ไม่สร้าง AWAITING_SERVICE/UNKNOWN เป็นกลุ่มธุรกิจ |
| R06 | ข้อมูลไม่ครบไม่แทนศูนย์; วัดปริมาณ วัน คน เอกสาร AI แยก | EX-01–04 | แสดง coverage; null ไม่ถูกจัดเป็นลูกค้าไม่ใช้ |
| R07 | เงินรับจริง แพ็กเกจ ต่ออายุ ส่วนเสริม หักคืนเงินจริง | EX-01–04 | ใช้หน่วยสตางค์; ค่าธรรมเนียม/ต้นทุนแยก |
| R08 | ช่องทางหรือเซลล์ตาม flow เดิม; ผู้แนะนำกับผู้ได้เครดิตแยก | EX-02–04 | ไม่แก้ signup และไม่แก้ attribution จากการอ่าน |
| R09 | กลุ่มธุรกิจอ่านง่าย แยก entity และ privacy category | EX-01–04 | mapping มี version และ UNKNOWN ไม่หายจากยอดรวม |
| R10 | ค้นหา กรอง เรียง หน้า ถอยกลับ และ detail สอดคล้องกัน | EX-02/04 | snapshot เดียว; filter ใหม่ไม่รับ response เก่า |
| R11 | สร้าง/จัดการสิทธิ์ผู้บริหารด้วย identity เดิม | EX-07/08 | ไม่สร้าง tenant membership ลูกค้าหรือให้ SYSTEM_ADMIN อัตโนมัติ |
| R12 (DEFERRED) | รับคำขอและดำเนิน workflow เดิมครบ prerequisites | EX-05/06 | ไม่อนุมัติจาก RECEIVED โดยข้าม identity/authority/retention |
| R13 (DEFERRED) | เก็บข้อมูลทั้งหมดในขอบเขต 14 วันก่อนลบจริง | EX-05/06 | server time + guard ทุกช่องทาง; policy ไม่ครบต้องปิด execution |
| R14 (DEFERRED) | ลบจริงมีผลแยกลบ/เก็บ/ค้างและหลักฐานตรวจได้ | EX-06 | ไม่สรุปสำเร็จจากเวลา HTTP 200 หรือข้อความ operator |
| R15 | ถอนสิทธิ์/ส่งซ้ำ/แข่งกัน/เครือข่ายขาด ไม่ขยายสิทธิ์หรือทำซ้ำ | ทุกหน้า | deny by default, transaction, idempotency, revalidation |
| R16 | ชุดสี field/dropdown และสถานะผิดพลาดใช้ component เดิม | ทุกหน้า | ทดสอบใน system shell จริงทุก control state |

ไม่รวมแก้รายรับบัญชีลูกค้า, อ่านบทสนทนา/รูปใบเสร็จ, สร้างเครดิตเซลล์, คืนเงิน,
แก้แพ็กเกจ, ส่งออกเอกสารธุรกรรมลูกค้าโดยละเอียด หรือเปิด automatic purge จากหน้ารายงาน
การส่งออก summary/company projection ที่อนุญาตเป็นขอบเขตใหม่ตาม [Excel spec](mangmee-executive-excel-export-spec-th.md), API13 และ proposed export capability; ไม่รวม source documents
ทางลัดไป module เดิมต้องตรวจสิทธิ์ module นั้นแยก รายงานอ่านได้ไม่เท่ากับเปิดเอกสารต้นทางได้

## 11. สถาปัตยกรรมและผู้เป็นเจ้าของข้อมูล

### 11.1 ทางเดินคำขอ

```text
Shared FE fields + system shell
  → authenticated API/BFF เดิม
  → AuthGuard: identity + session + platform context
  → DenyByDefaultGuard + executive platform-scope assertion
  → executive read service (allowlisted projections)
  → company / signup / billing facts / sales attribution / activity sources
  → consistent aggregation + coverage + response

Account command → identity + platform membership/role → audit/outbox เดิม
Data-rights command → DataRightsService เดิม → policy/hold/evidence gates
Future erasure execution → P31 orchestrator → scoped executors → verified evidence
```

ข้อเสนอ: เพิ่ม module `executive-business` ใน ERP API ตามรูปแบบ module เดิม
และ contracts ใน packages/contracts; ชื่อไฟล์จริงให้ตัดสินเมื่อเริ่ม implementation
ไม่ให้ FE ไล่เรียก detail ทุกบริษัทแล้วบวกเอง ไม่ใช้ AI Gateway query database ของ ERP
ไม่ย้าย logic billing/refund/sales/permissions มาสำเนาใน executive module

### 11.2 Owner และ grain ของข้อมูล

| Domain owner | Grain ที่รายงานอ่าน | ข้อห้าม/ช่องว่าง |
|---|---|---|
| Company/partner management | companyId, lifecycle, createdAt, plan/profile ปัจจุบัน | status ACTIVE ไม่พิสูจน์จ่ายหรือใช้; แก้บริษัทผ่าน module เดิม |
| External signup | original company-linked signup หนึ่งรายการต่อบริษัท | `source` คือ rail ไม่ใช่ discovery; signup หลายแถวห้ามคูณยอด |
| Identity/access control | user + platform membership + active system role | target companyId ไม่ใช่ actor company context |
| Billing | verified receipt/refund movement ต่อ provider-native identity | invoice cumulative fields ยังไม่ใช่ cash movement ledger รายเดือน |
| Sales | SalesAttribution หนึ่งรายการต่อบริษัท | preserve flags/refund window/renewal exclusion; ไม่ใช้แทน receipts |
| Activity producers | successful logical business action หนึ่งครั้ง | model calls, OCR quota admissions และ login เป็นคนละ grain |
| AI metering | provider-call cost + signed corrections | ความครบต้นทุนไม่เท่ากับความครบกิจกรรมผู้ใช้ |
| Data rights | case + append-only decisions/evidence/actions | ไม่สร้างเคสชุดใหม่ข้างเคียง; hold/executor ยังขาด |

เริ่มจาก bounded set-based queries และ aggregate ในฐานข้อมูล ไม่สร้าง warehouse/event bus ใหม่
ใช้ snapshot persistence เฉพาะเมื่อจำเป็นต่อการคงชุดเดียวข้าม request ตาม §12.3
index/query plan ที่เสนอใน §20 ต้องวัดกับข้อมูลทดสอบก่อนเลือกจริง

## 12. เวลา ประชากร ตัวกรอง และ snapshot

### 12.1 ขอบเขตเวลา

ข้อเสนอ V1: เดือนแบบ Gregorian `YYYY-MM`, timezone รายงาน `Asia/Bangkok`
แม้ UI แสดง พ.ศ. ต้องส่ง ค.ศ. ไม่ใช้ timezone ของเครื่องผู้ใช้หรือแต่ละบริษัทแทน
`startInclusive` = วันแรก 00:00 ไทย; `endExclusive` = วันแรกเดือนถัดไป 00:00 ไทย
`effectiveEndExclusive = min(endExclusive, snapshotAsOf)` สำหรับเดือนปัจจุบัน
ตัวอย่าง ก.ย. 2026: `[2026-08-31T17:00:00Z, 2026-09-30T17:00:00Z)`
event ตรงขอบขวาอยู่เดือนถัดไป; ไม่มี `23:59:59.999` ที่ทำ precision ตกหล่น

แยก `snapshotAsOf` เวลาอ่าน, `dataThrough` watermark ต่อ source,
`profileAsOf` เวลาข้อมูลบริษัท และ `period` ช่วงที่ต้องการ ห้ามใช้เวลาอ่านใหม่ปิดบัง source lag
ไม่รองรับเดือนอนาคต; เดือนก่อนเริ่มเก็บข้อมูลคืน unavailable พร้อม earliestAvailableMonth
เดือนก่อนบริษัทสมัครคืน `NOT_YET_REGISTERED` ไม่ใช่ใช้งานศูนย์

### 12.2 ประชากรและ dimension

ข้อเสนอ Q02: บริษัทที่สร้างก่อน `effectiveEndExclusive`, มี classification CUSTOMER,
ทุก lifecycle ตาม filter, ตัด platform tenant และ TEST/INTERNAL ที่ยืนยันออก
ห้ามใช้ชื่อมีคำว่า test, email domain, ไม่มีเงินจ่าย หรือมี admin member เป็นตัวตัดบริษัทจริง
classification ที่ไม่ทราบแสดง `unclassifiedCompanyCount` และทำ population coverage เป็น partial
ยังห้ามโฆษณาว่า “บริษัทจริงทั้งหมด” จน backfill classification ผ่านการตรวจ

Q05: V1 เสนอจัดกลุ่มด้วย profile **ปัจจุบัน ณ snapshot** และแสดง label ชัด
ประวัติรายรับของกลุ่มจึงตอบ “บริษัทในกลุ่มปัจจุบัน เคยรับเงินเท่าไร” ไม่ใช่ industry ณ วันเกิดเงิน
ต้องใช้ mapping version เดียวตลอด snapshot; ถ้าต้องการ historical segments จริงต้องเพิ่ม dated dimension history
การลบจริงกระทบประชากรย้อนหลังและกลุ่ม retained financial facts ดู Q08/§19 ห้าม silently inner join ทิ้งเงิน

### 12.3 ความสอดคล้องข้าม request

ข้อเสนอ: response รายงานมี `snapshotId`, `snapshotAsOf`, `definitionVersion`, `filtersHash`,
`dimensionVersion`, `sourceWatermarks`; KPI และ breakdown ในหนึ่งหน้าสร้างจากชุดเดียวใน consistent DB read
drilldown/page ต่อไปส่ง snapshotId เดิม BE ตรวจ actor scope + normalized filters ทุกครั้ง
อย่าเพียงแนบ timestamp กับ queries สดแล้วอ้างว่าเป็น snapshot

ทางเลือก implementation ขั้นต่ำ: เก็บเฉพาะ projection ที่อนุญาตใน snapshot อายุสั้นฝั่ง server
เพื่อให้ list/count/detail metrics ตรงกัน; ไม่เก็บ raw PII/เอกสาร/ข้อความ AI
อายุใช้งานเสนอ 15 นาที (Q09); หมดอายุคืน `409 EXECUTIVE_SNAPSHOT_EXPIRED` แล้ว FE ให้โหลดชุดใหม่
snapshot ไม่เป็น bearer permission: revoke role แล้วอ่าน snapshot เก่าไม่ได้
หลัง erasure/permission withdrawal ต้อง invalidate snapshot/caches ตามบริษัท/actor ที่เกี่ยวข้องทันที
ช่วงเริ่มต้นที่ยังไม่มี snapshot ห้ามทำ pagination เหมือน snapshot เสถียรโดยไม่แจ้งข้อจำกัด

### 12.4 Query contract

| Parameter | Validation/ความหมาย | Scope |
|---|---|---|
| month | required YYYY-MM จริง; ไม่อนาคต | รายงานทุกหน้า |
| industry | ALL, UNKNOWN หรือ mapping code ที่รู้จัก | EX-01–03 shared |
| discovery | ALL, UNKNOWN หรือ WEBSITE/IG/TIKTOK/FACEBOOK/SALES/OTHER ตาม enum จริง | shared; ใช้ค่าจาก contract เดิม ห้าม hardcode label เป็นค่า |
| referringSales | ALL, NONE, UNKNOWN หรือ userId ของ seller | shared; ไม่ใช่ creditedSales |
| entity | ALL, UNKNOWN หรือ code ที่ตกลง | EX-02 เท่านั้น |
| companyStatus | ALL หรือ ACTIVE/SUSPENDED/DISABLED/ARCHIVED | EX-02 เท่านั้น |
| serviceStatus | ALL หรือ ACTIVE/EXPIRED/HELD จาก billing accessState เดิม | EX-02; ไม่ใช้ข้อความไทยเป็นค่าถาวร; source ที่อ่านไม่ได้มี coverage แยก |
| usageGroup | ALL หรือ NOT_STARTED/INACTIVE/ACTIVE/NOT_PAID | EX-02; ไม่รับ UNKNOWN/AWAITING_SERVICE ใหม่ |
| q | trim; ≤120 characters; name/registeredName/companyId/province | EX-02; parameterized search; ไม่ค้น contact/เลขภาษีโดยปริยาย |
| sort | allowlist `joinedAt`, `companyName`, `netReceipts`, `lastActivityAt`; asc/desc | EX-02; tie-break companyId; nulls last ทั้งสองทิศ |
| cursor/pageSize | opaque cursor; default25, max100; ไม่รับ offset พร้อม cursor | list; bind snapshot/filters/sort/actor scope |
| snapshotId | server-issued opaque identifier | อ่านผลชุดเดิม; client เปลี่ยน asOf ไม่ได้ |

ชื่อ enum discovery ในตารางเป็นข้อความสัญญา: ต้อง import `SIGNUP_DISCOVERY_SOURCE_OPTIONS` จริง
ตรวจตัวสะกดกับ source ใน implementation; ส่ง unknown value ที่ไม่อยู่ใน contract →400 ไม่ขยายเป็น ALL
ไม่มีข้อมูลที่ตรง combination ที่ valid →200 empty ไม่ใช่ 400
globalFilters และ directoryFilters แยก response เพื่อไม่ให้ตัวกรองที่ซ่อนอยู่ยังตัด KPI โดยผู้ใช้ไม่ทราบ
drilldown เปลี่ยน facet ที่กด รักษา shared filters; reset list-only filters ที่ไม่เกี่ยวพร้อมแสดง chips
กด entity breakdown ไป EX-02 ต้องเห็น entity chip และยอดประชากรหลังกรอง

serviceStatus เป็น current access projection จาก `billingState()` พร้อม company lifecycle/plan end แยก
HELD ต้องแสดงเหตุผลจาก company status; ACTIVE ที่เป็น legacy ไม่มี term ไม่พิสูจน์ว่า paid
EXPIRED ของ service ไม่เท่ากับ INACTIVE ของ usage; ARCHIVED ยังแยกใน companyStatus
ห้าม map คำว่าเก็บถาวรจาก fixture เป็น billing enum ใหม่ หรือเพิ่มกลุ่ม “จ่ายแล้วรอเปิดบริการ”
เมื่อ source ไม่มีให้ service value=null พร้อม coverage; filter เฉพาะสถานะไม่นับ null เป็นสถานะนั้น

trend ใช้ 6 เดือนสิ้นสุดที่เดือนที่เลือกตามเดโม; แต่ละจุดคำนวณ cash ของเดือนนั้นจริง
ใช้ dimension version เดียวกับหน้าปัจจุบันและตัดบริษัทที่ยังไม่เกิดในจุดนั้น
เดือนที่ไม่มี coverage เป็น null/gap ไม่ลากเส้นเป็น zero; point ปัจจุบันใช้ cutoff เดียวกับ KPI
การเลือกดูช่วงยาวกว่านี้อยู่นอก V1 จนมี contract เพิ่ม

## 13. สูตรรายงานและการจัดกลุ่ม

### 13.1 นิยามค่าและ null

| Metric | สูตรเป้าหมาย | หน่วย/coverage |
|---|---|---|
| companies | count distinct companyId ใน eligible population | บริษัท; classification coverage |
| activeCompanies | count distinct companyId ที่มี qualifying action ≥1 ในช่วง | รวม trial ที่ใช้จริงด้วย; positive evidence พอพิสูจน์ active แต่ completeness จำนวนยังอาจ partial |
| companiesWithReceipts | count distinct companyId ที่มี positive verified receipt ในช่วง | refund เต็มจำนวนภายหลังไม่ลบประวัติว่าเคยรับในเดือนนั้น |
| receiptsSatang | ผลรวมเงินจริงรับสำเร็จตาม effective payment time | ไม่ใช่ invoice issued/checkout created/apply success time |
| refundsSatang | ผลรวม refund สำเร็จตาม effective refund time ในช่วง | positive amount; pending/failed ไม่นับ |
| netReceiptsSatang | receiptsSatang − refundsSatang | อาจติดลบได้; ไม่ clamp0; ไม่หัก fee/cost |
| feesSatang | fees ที่มีหลักฐานตรงชุดรายการและช่วงนิยาม | null ถ้าไม่ครบ; ไม่ใช้เปอร์เซ็นต์ fixture |
| aiCostSatang | model cost ledger + corrections ตาม metering period | บาทต้นทุนที่วัดได้ ไม่ใช่ต้นทุนทั้งหมด/กำไร |
| activeDays | distinct Bangkok calendar dates ของ qualifying actions | ≤วันใน effective period; แยก per company |
| activeUsers | distinct canonical human actor IDs ใน qualifying actions | ไม่เท่าจำนวน membership; system actors ไม่นับ |
| documents | distinct canonical document ที่เกิด qualifying document action | ไม่บวก ExpenseRecord และ derived AccountingDocument ซ้ำ |
| aiRequests | distinct successful logical user request ตาม taxonomy | ไม่ใช่ callCount/tokens/quota admissions |
| first/lastActivityAt | min/max qualifying occurredAt ก่อน effectiveEnd | lifetime; known first observed ไม่เท่ากับ first ever เมื่อ coverage ขาด |
| lastLoginAt | login event ที่ยืนยัน user/context ตาม Q03 | ไม่ใช้ session refresh/updateAt เป็น login |

ทุก metric ใช้ `{value, coverage, reasonCodes, dataThrough}`; `value:null` = ยังสรุปไม่ได้
partial ที่มีจำนวนยืนยันได้ให้แยก `knownValue`; จำนวนที่เพิ่มได้อย่างเดียวใช้ label “อย่างน้อย …”
ส่วน net cash/cost ที่มี refund หรือ signed correction ห้ามเรียก knownValue ว่า lower bound
ให้บอก “ยอดเฉพาะรายการที่ยืนยันแล้ว” พร้อม coverage และไม่ใช้เป็น exact total
zero ใช้ได้เมื่อ source ครบและไม่มีรายการจริง; no permission ไม่แปลเป็น zero
group sums เท่ากับ parent เมื่อ grain/time/filters เดียวกัน; unknown dimension ต้องมีแถว
distinct users/days รวมข้ามบริษัท **บวกตรง ๆ ไม่ได้**; ต้อง distinct ใหม่หรือเปลี่ยนชื่อหน่วยเป็น company-user/company-day
เปอร์เซ็นต์ denominator0 →null/—; ปัดเพื่อแสดงเท่านั้น ไม่ปัดเงินก่อนรวม

### 13.2 Paid usage decision table

ข้อเสนอ Q03: `paidEver` คือมีหลักฐานเคยรับเงินจริงบวกก่อน cutoff แม้คืนเต็มภายหลัง;
trial usage ก่อนจ่ายยังนับว่า “เคยเริ่มใช้” เพราะผู้ใช้เริ่มใช้ผลิตภัณฑ์แล้ว
ต้องอนุมัติ Q03 ก่อนนำกฎนี้ไปใช้จริง ไม่ได้อนุมานจาก fixture MM012

| paidEver | หลักฐานการใช้ในช่วง | หลักฐานการใช้ก่อนช่วง/ตลอดชีวิต | usageGroup |
|---|---|---|---|
| false ที่ยืนยันจาก payment coverage ครบ | ใด ๆ | ใด ๆ | NOT_PAID; activity metrics ยังแสดงได้ เช่น trial active |
| true | มี qualifying event | ใด ๆ | ACTIVE; metrics ที่ไม่ครบยังแจ้ง coverage |
| true | ไม่มี + coverage ช่วงครบ | เคยมี positive event | INACTIVE |
| true | ไม่มี + coverage ตั้งแต่สมัครครบ | ไม่เคยมี | NOT_STARTED |
| true | ไม่มีแต่ coverage ขาด | ไม่พอสรุป | null + ACTIVITY_HISTORY_INCOMPLETE |
| unknown | ใด ๆ | ใด ๆ | null + PAYMENT_HISTORY_INCOMPLETE |

ห้ามตรวจ `paidSatang ในเดือน >0` เพื่อจัดทุกกลุ่ม: คนจ่ายรายปีเมื่อหลายเดือนก่อนยังอยู่ใน paid population
ห้ามใช้ login ล่าสุดหรือ term ACTIVE แทน usage
สมการ: paidEverTrue = ACTIVE + INACTIVE + NOT_STARTED + paidUsageUnassessable
population = paidEverTrue + confirmedNeverPaid + paymentUnknown
KPI activeCompanies อาจมากกว่า paid ACTIVE เพราะรวม trial; ต้องมี tooltip บอกความหมาย

ในเดโม 12 บริษัทมีหนึ่งบริษัท usage unknown ดังนั้น KPI 6 คือ **ยืนยันแล้วอย่างน้อย 6 บริษัท**
ไม่ใช่หลักฐานว่าบริษัทที่ active มีทั้งหมด 6; รายงานจริงต้องคืน value:null/knownValue:6/coverage:partial
และให้ FE แสดงความหมายนี้ แม้ตัวเลขบนเดโมปัจจุบันยังเป็น 6 ตาม fixture

### 13.3 Activity event contract ที่เสนอ

ยังไม่มี universal activity source ที่พิสูจน์ครบทุกฟีเจอร์ จึงต้องทำ coverage registry ต่อ feature/วันที่เริ่มเก็บ
เริ่มจาก source ที่มีหลักฐานและระบุฟีเจอร์ที่ครอบคลุม ไม่อ้าง “ทั้งระบบ” จาก AI อย่างเดียว

| Feature | Qualifying action ที่เสนอ Q03 | ตัวที่ไม่นับ / การ deduplicate |
|---|---|---|
| รายรับ/บัญชี | document issued/posted สำเร็จโดยผู้ใช้ | draft autosave, void-only cleanup, derived posting ไม่นับเป็นเอกสารใหม่ซ้ำ |
| รายจ่าย | expense confirmed สำเร็จโดยผู้ใช้ | OCR uploaded/pending/error ไม่เท่ากับ confirmed; retry เดิมหนึ่งครั้ง |
| AI assistant | logical turn สำเร็จและผลตอบกลับที่มีประโยชน์ตาม taxonomy ที่อนุมัติ | model call, internal routing, refusal, retry, queued/unknown delivery ไม่นับสำเร็จโดยเดา |
| OCR | extraction outcome สำเร็จและยอมรับเป็นกิจกรรมตาม Q03 | quota admission เกิดก่อน provider จึงใช้เป็น success ไม่ได้ |
| inventory/procurement/CRM | committed business action ที่ module owner เลือก | cron/reconcile/imported seed/ทีม support ทำแทน ต้องแยก actor และ purpose |
| Login/report reads | แสดง login แยก; customer report-view อาจเป็น qualifying read ถ้ามติ Q03 รวม | executive เปิดรายงานนี้ห้ามทำให้ลูกค้าถูกนับ active |

ขั้นต่ำของ fact: `companyId`, `feature`, `action`, `logicalActionKey`, `canonicalObjectKey?`,
`actorKind`, `actorUserId?`, `occurredAt`, `observedAt`, `outcome`, `sourceReference`, `taxonomyVersion`
unique(companyId, feature, logicalActionKey); key เป็น command/domain identity ไม่ใช่ HTTP requestId ใหม่ทุก retry
producer ส่งหลัง domain commit ผ่าน outbox เดิมเมื่อมี ห้าม report read สร้าง events
consumer at-least-once ต้อง idempotent; late event กลับเดือน occurredAt และเพิ่ม snapshot revision
error→success ของ logical action เดียวเพิ่ม qualifying count เพียงครั้งเดียว
ไม่เก็บชื่อคู่ค้า ข้อความสนทนา รูป เอกสาร หรือ credential ใน analytics fact
unknown history ไม่ backfill ด้วยการตีความปัจจุบันว่าไม่เคยใช้

## 14. Billing cash facts และยอดเครดิตเซลล์

### 14.1 ข้อจำกัด source ปัจจุบัน

`BillingInvoice` มี paid/refunded สะสม, service period, createdAt/updatedAt/financialObservedAt
แต่ไม่มี payment/refund effective timestamp ที่ครบทุก payment path ในแถวเดียว
`paid-invoice.ts` ส่ง paidAt บางกรณี; จึงห้ามใช้ periodStart หรือเวลาที่ reconciler เจอเป็นวันที่รับเงินจริง
refund หลายครั้งข้ามเดือนต้องมี identity/time ของแต่ละครั้ง ไม่ใช่กระจาย cumulative refundedSatang ลงเดือนใบแจ้งหนี้

ข้อเสนอให้ **billing เป็นเจ้าของ** projection เงินเคลื่อนไหวที่ตรวจสอบได้:
`nativeMovementId`, `providerAccountId`, `livemode`, `companyId`, `invoiceId?`,
`kind=RECEIPT|REFUND`, `effectiveAt`, `observedAt`, `amountSatang`, `currency`,
`productKind=PACKAGE|RENEWAL|ADDON|UNKNOWN`, `evidenceRef`, `verificationStatus`
unique(providerAccountId, livemode, kind, nativeMovementId)
เป็น reporting fact ไม่ใช่สร้าง money ledger แข่งกับ billing/refund executor
มี offline/manual เงินที่ไม่มี source ยืนยัน →coverage gap ตาม Q04 ไม่ใช้ราคาแพ็กเกจแทนเงิน

### 14.2 กฎเงิน

- ใช้ THB integer satang; query SUM ให้กว้างพอและเช็ค safe integer ก่อนส่ง JSON
- V1 เสนอ gross cash including tax เพราะคำว่าเงินรับจริง; แสดง tax ถ้า source ครบ
  ไม่เรียก accounting revenue; วิธี tax/refund allocation ต้องปิด Q04
- receipt verified แล้วแต่ apply entitlement ล้ม →เงินยังนับ; service state แสดงปัญหาแยก
- quote, unpaid invoice, free/admin grant, discount/free days, receipt quota grant ไม่ใช่เงินรับ
- receipt และ refund ที่สำเร็จ event เดียวกันซ้ำ webhook/reconcile ต้องไม่ซ้ำ
- credit note กับ native refund ที่อ้างเงินก้อนเดียวห้ามหักสองครั้ง; credit balance ไม่เท่า cash refund
- dispute แสดง review marker; ไม่หักเองจนมีชนิด movement ที่นิยามรองรับ
- multi-account/live-test เก็บ scope key ครบ; ห้ามรวม TEST เข้ารายงาน LIVE
- late webhook แก้เดือน effective time โดยมี revisedAt/reason ไม่แก้ยอด snapshot เดิมเงียบ ๆ
- ห้ามเรียก Stripe ทุกบริษัทระหว่างเปิดหน้า: ใช้ local verified facts + lag; reconciliation อยู่ owner เดิม

ตัวอย่าง Q04 ที่ใช้จำลอง: รับ 149,000 สตางค์วันที่ 31 ส.ค.23:59 ไทย, คืน 49,900 วันที่ 1 ก.ย.00:00 ไทย
→ส.ค. receipts149000/net149000; ก.ย. receipts0/refunds49900/net−49900
ยอดติดลบต้องวาดกราฟใต้ baseline และแสดงได้ใน FE (เดโมกราฟปัจจุบันยังไม่รองรับกรณีนี้)

### 14.3 Sales credit

originalReferrer ใช้ Company.referralSalesUserId + original signup; creditedSeller ใช้ SalesAttribution.salesUserId
report ชุดผู้แนะนำใช้รายรับบริษัททั้งหมดในช่วง; ชุดเครดิตใช้กติกาเดิมเท่านั้น
ยอดเครดิตในเดโมเป็น **สะสมถึง cutoff** ต้องใช้ label/timeBasis แยกจาก cash รายเดือน
ถ้าจะเพิ่มเครดิตเฉพาะเดือนต้องมี separate metric ห้ามเปลี่ยนความหมายสะสมเงียบ ๆ
reuse `countableAmountSatang` / `aggregateReport` ใน domain เดิม ไม่จำลองกฎธง/คืนเงินซ้ำ
ไม่ส่ง payroll/nationalId/bankAccount ของ SalesAgentProfile
เซลล์ถูกระงับ/ลบ profile ไม่ทำให้ attribution กลายเป็น NONE; แสดง unavailable identity พร้อมรหัสเท่าที่เก็บได้
รายงานเดิมจำกัด 5000rows: ห้ามเรียกเป็น platform aggregation แล้วอ้างว่าครบเมื่อชน cap

## 15. Discovery, industry และข้อมูลบริษัท

original signup = company-linked signup ที่เก่าที่สุดตาม createdAt,id ตาม pattern GetPartnerDetailUseCase
resolvedExistingCompanyId คือคำขอกลับร้านเดิม ไม่ใช่ acquisition ใหม่
ไม่มี original signup →discovery UNKNOWN ไม่อนุมาน WEBSITE จาก source rail

referrer เป็น tagged value `KNOWN(id,label,code?)`, `NONE`, `UNKNOWN`, `UNRESOLVED(id)`
non-SALES ที่มีหลักฐาน canonical no-referrer จึงเป็น NONE;
SALES แต่ id หายเป็น UNKNOWN/UNRESOLVED ไม่ใช่ไม่มีเซลล์
historical non-SALES+referrer จาก admin repair ต้องแสดง discrepancy/provenance ตามจริง
ไม่ลบ id หรือเปลี่ยน discovery เพื่อให้ตรง fixture; B6 คุมการรับข้อมูลใหม่ ไม่อนุญาต rewrite ประวัติ

ข้อเสนอ industry mapping: versioned table จาก businessTypeCode →หนึ่ง primary commercial group
OTHER/free text ไม่มี deterministic approved map ให้ UNKNOWN/OTHER พร้อมข้อความเดิม
ไม่ใช้ AI เดาประเภทธุรกิจบน GET; ถ้าจะแก้ mapping เป็นงานแยกมี review/backfill/recompute
entity type ยังไม่พบ canonical Company field ที่รองรับชุดในเดโม; ห้ามเดาจากชื่อ บริษัท/บจก. หรือ taxId
เสนอ optional normalized entity metadata ใน domain company identity หลังปิด Q05; ของเก่า UNKNOWN
province ใช้ address master/code ถ้ามี; string ไม่ถูกต้องเป็น UNKNOWN ไม่ drop company
branches/members ใช้จำนวนปัจจุบันที่นิยามชัด ไม่ใช้ activeUsers แทนจำนวนสมาชิก
current service team ยังไม่มี source ที่ยืนยันในงานนี้ →null พร้อม reason ไม่ใช้ referring seller แทน
ผู้ติดต่อและ taxId ไม่รวม default report DTO; เพิ่มได้เมื่อสิทธิ์/วัตถุประสงค์ใน Q01 ระบุแล้ว

## 16. API เป้าหมายและ payload

### 16.1 Endpoint inventory

ทุก endpoint ใหม่ด้านล่างเป็น **PROPOSED**; prefix API จริงคือ `/v1`
ใช้ validation/authenticated fetch/error presentation ที่มีอยู่ และ `Cache-Control: no-store` บน authenticated responses

| Ref | Method/path | Request | Response/owner |
|---|---|---|---|
| API01 | GET /v1/system/executive/context | ไม่มี target tenant | capabilities, allowed filters, definitionVersion, report availability |
| API02 | GET /v1/system/executive/overview | shared filters + month | report envelope, KPI, paid cohorts, trend, follow-up rows |
| API03 | GET /v1/system/executive/companies | shared + directory filters + snapshot/paging | report envelope, items, total, nextCursor |
| API04 | GET /v1/system/executive/analysis | shared filters + month + snapshot? | cash/source/referrer/credit/industry/entity groups, denominators |
| API05 | GET /v1/system/executive/companies/:companyId | month + snapshot? | allowlisted profile, payment, usage, attribution, current service |
| API06 | GET /v1/system/executive/companies/:companyId/history | cursor,pageSize | safe lifecycle timeline เท่านั้น; case summaries DEFERRED |
| API07 | GET /v1/system/executive-users | q,status,cursor,pageSize | platform executive enrollments, not all tenant users |
| API08 | POST /v1/system/executive-users | commandId, name, email, accessProfile | canonical userId + enrollment/provisioning status; Q01 |
| API09 | GET /v1/system/executive-users/:userId | ไม่มี | permitted account fields/capabilities/version |
| API10 | POST /v1/system/executive-users/:userId/status | commandId, expectedVersion, status, reason | enrollment status + authoritative version + replayed |
| API11 | /v1/system/data-rights/cases และ actions เดิม | ดู §18 | EXISTING; executive integration DEFERRED; ไม่แก้ API เดิมในรอบนี้ |
| API12 | GET /v1/system/executive/data-rights/cases และ /:caseId | list: companyId?,status?,cursor,pageSize; detail: caseId | DEFERRED: proposed safe case summary; ไม่เรียก/ไม่เปิดในรุ่นปัจจุบัน |

รายละเอียด API12 ต่อไปนี้เป็นข้อเสนอเดิมที่ **DEFERRED ทั้งส่วน** ตามมติล่าสุด; เมื่อกลับมาคุยใหม่จึงพิจารณา read projection
ของ DataRightsCase เดิมสำหรับ executive reader ไม่ใช่ฐานเคสใหม่หรือสิทธิ์จัดการเคส
allowlist: caseId/companyId/companyDisplayName/caseType/status/presentationStage,
receivedAt/approvedAt/holdStartsAt/holdEndsAt/completedAt และ safe readiness reason
ไม่รวม requester contact/hash, free-text reason, evidence references, notes, documents หรือ actor PII
ผู้มีสิทธิ์จัดการเปิดรายละเอียดเต็มผ่าน API11 เดิม; reader เปิด EX-06 เป็น summary view
การเพิ่มข้อมูลละเอียดหรือ command capability ยังรอมติ Q06; ห้ามให้ manage permission เพื่อแก้ปัญหาอ่านไม่ได้
cases เป็น operational current state พร้อม serverNow แยกจาก snapshot ของรายงานรายเดือน

การแก้ชื่อ/อีเมล/เพิ่มสิทธิ์อื่น/ส่ง invite ใหม่ไม่มี action ในเดโมที่ครบ
หากรวม V1 ต้องปิด Q01 และเพิ่ม endpoint contract ก่อน; ไม่เปิด generic PATCH user รับ roles ใด ๆ
ไม่สร้าง endpoint delete-company จาก executive module

### 16.2 Shared response envelope

ตารางนี้ระบุ field/type/ข้อกำหนด ไม่ใช่ TypeScript implementation

| Field | Type | Required semantics |
|---|---|---|
| requestId | opaque string | correlation ไม่ใช่ auth/session token |
| snapshot | object | id, asOf, expiresAt, definitionVersion, filtersHash, dimensionVersion |
| period | object | month,timeZone,startInclusive,endExclusive,effectiveEndExclusive,isPartialMonth |
| appliedFilters | object | normalized global/directory filters; same response labels |
| population | object | eligibleCount, excludedTestInternalCount, unclassifiedCount, coverage |
| coverage | map | metric/source→complete/partial/unavailable + reasonCodes/dataThrough |
| metrics | map | typed integer/null; moneySatang with currency; knownValue เมื่อ partial |
| groups | named arrays | key,label,counts,money,coverage,timeBasis,drilldownFilters |
| items | array | exact allowlist ตาม screen; ไม่ใช้ Prisma model spread |
| pagination | object | total,pageSize,nextCursor; total distinct full filter set |
| capabilities | object | action→allowed/disabledReason; API ยังตรวจซ้ำ |

company row: id/displayName/registeredName? + industry/entity/province + joinedAt,
companyStatus/currentService + discovery/referrer/credit summary + payment/usage + money metrics
detail เพิ่ม meaningful first/last/login, receipt/refund/fee/cost, plan end, profileAsOf
ห้ามส่ง raw signup payload, hashes ที่ใช้ยืนยันตัวตน, secrets, invoice file URL, LINE id หรือ AI previews

ตัวอย่างส่วนหนึ่งของ response เป้าหมาย (ไม่ใช่ endpoint ที่รันแล้ว):

```json
{
  "metrics": {
    "companies": { "value": 12, "coverage": "complete", "reasonCodes": [] },
    "activeCompanies": {
      "value": null,
      "knownValue": 6,
      "coverage": "partial",
      "reasonCodes": ["ACTIVITY_HISTORY_INCOMPLETE"]
    },
    "companiesWithReceipts": { "value": 9, "coverage": "complete", "reasonCodes": [] },
    "netReceiptsSatang": { "value": 1095600, "currency": "THB", "coverage": "complete", "reasonCodes": [] }
  },
  "paidUsage": {
    "basis": "EVER_PAID_BEFORE_CUTOFF",
    "notStartedCount": 2,
    "inactiveCount": 3,
    "activeCount": 5,
    "unassessableCount": 1
  }
}
```

response เต็มต้องมี envelope/period/snapshot/dataThrough ตามตารางข้างต้นด้วย
paidUsage.basis ของตัวอย่างเป็นข้อเสนอ Q03; ถ้ามติเปลี่ยนต้องเพิ่ม definitionVersion และปรับ oracle
API08 `accessProfile` V1 เสนอ allowlist `EXECUTIVE_READER` เท่านั้น;
การแต่งตั้ง manager ไม่ทำผ่าน form นี้จน Q01 อนุมัติวิธีแยก
API10 `status` เสนอ `ACTIVE|SUSPENDED` ของ executive enrollment ไม่ใช่ global User.status
status ACTIVE ใช้ได้เมื่อ activation prerequisites ผ่านแล้ว; pending credential ไม่ข้ามด้วย status command

### 16.3 Errors และ command semantics

| HTTP | Contract code ตัวอย่างที่เสนอ | FE behavior |
|---|---|---|
| 400 | EXECUTIVE_QUERY_INVALID / INVALID_INPUT | inline field errors; คงค่าที่กรอก; ไม่ retry อัตโนมัติ |
| 401 | session expired/revoked ตาม auth เดิม | refresh ตาม helper เดิม; ไม่ loop; return URL เดิม |
| 403 | EXECUTIVE_ACCESS_DENIED / CAPABILITY_DENIED | clear protected data/action; ไม่ใช้ cached success |
| 404 | COMPANY_NOT_FOUND / ACCOUNT_NOT_FOUND / CASE_NOT_FOUND | message ไม่เปิดเผยข้อมูลที่ไม่มีสิทธิ์ |
| 409 | EXECUTIVE_SNAPSHOT_EXPIRED / SOURCE_CHANGED / VERSION_CONFLICT / COMMAND_CONFLICT / ACCOUNT_ALREADY_ENROLLED | โหลด canonical state; ไม่สร้าง command ใหม่เพื่อ bypass |
| 422 | POLICY_NOT_READY / IDENTITY_REQUIRED / RETENTION_INCOMPLETE / HOLD_NOT_ELAPSED | แสดงเงื่อนไขที่ยังขาด; ไม่มี mutation |
| 429 | RATE_LIMITED | Retry-After, หยุดปุ่มชั่วคราวตามเวลา |
| 503 | SOURCE_UNAVAILABLE / platform_access_closed เดิม | แยก unavailable/maintenance จากข้อมูลว่าง; retry bounded |

รหัสของ data-rights ที่มีแล้วคง lowercase เดิม ห้าม breaking rename เป็นตารางตัวอย่าง
response error `{code,message,requestId,fieldErrors?,retryable?,retryAfterSeconds?}`
ไม่ส่ง stack/provider credentials/SQL/internal permission details ให้ client

ทุก command ใหม่มี stable commandId, payload fingerprint, actor scope และ expectedVersion เมื่อแก้ข้อมูลเดิม
same key+same payload+same actor →canonical result เดิม; key เดิมคนละ payload/actor/target →409
lock key แบบ scoped deterministic + transaction: mutation, audit, outbox ต้องสำเร็จร่วมกัน
timeout หลัง commit →ค้นผล/ส่ง key เดิม ไม่กดด้วย key ใหม่แล้วทำซ้ำ
GET retry ได้แบบ bounded; command ห้าม auto retry ด้วย key ใหม่
email/invite เมื่อ Q01 ตกลงต้องใช้ durable outbox เดิม; mail ล้มไม่ rollback identity ที่สำเร็จแล้วแบบเงียบ

## 17. Identity สิทธิ์ และบัญชีผู้บริหาร

### 17.1 ข้อเสนอ permission matrix รอมติ Q01

| Capability | Executive reader | Executive account manager | Existing data-rights operator |
|---|---|---|---|
| executive report read | มี | เฉพาะเมื่อได้รับเพิ่ม | ไม่มีโดยอนุมานจากคำว่า operator |
| executive XLSX export (ข้อเสนอใหม่) | ต้อง read + export grant ตาม Q01 | ไม่ได้โดยอัตโนมัติ | ไม่ได้โดยอนุมาน |
| account list/create/status | ไม่มี | มีเฉพาะ executive enrollment | ไม่มีโดยอนุมาน |
| customer business documents | ไม่มี | ไม่มี | ตาม permission เดิมแยก |
| case safe summary (DEFERRED) | ซ่อน/ไม่เปิด API12 | ซ่อน/ไม่เปิด API12 | ตามสิทธิ์เดิมนอกงานนี้ |
| case intake/approve/execute/verify | ไม่มี | ไม่มี | current SYSTEM_ADMIN + system.data_rights.manage และ segregation เดิม |
| billing mutate/refund/credits | ไม่มี | ไม่มี | ตาม billing permissions/scopes เดิมเท่านั้น |

เสนอ permission names `system.executive.read`, `system.executive_user.manage` และ role
`MANGMEE_EXECUTIVE` เป็น platform-only; ยังไม่เพิ่มจริงใน registry
เมื่อเพิ่มจริง ให้ใส่ key ลงใน `PLATFORM_ONLY_ROLE_KEYS` (`apps/api/src/modules/auth/permission-registry.ts`) ที่เดียว:
ร้านค้าจะไม่เห็น ไม่อ่าน ไม่คัดลอก และไม่มอบบทบาทนี้ได้ โดยไม่ต้องแก้จุดอื่น
(กติกา R9 ใน [company-role-override-spec](company-role-override-spec.md))
manager role ไม่สามารถ grant SYSTEM_ADMIN, arbitrary permission หรือให้สิทธิ์ที่ตนจัดการไม่ได้
reuse User/CompanyMembership/Role/MembershipRole ใน platform tenant เดิม;
ต้องตรวจ active system-owned role (`isSystem`, `scopeKey=system`, `companyId=null`) จากฐานจริง
tenant custom role แม้ชื่อ/permission string คล้ายกันไม่กลายเป็น platform authority

### 17.2 Integration ที่ห้ามข้าม

SystemLayout, SystemHeader, session landing/home cookie, middleware, legal acceptance capacity,
platform-closed gate, permission registry/sync และ tenant workspace shell ต้องเพิ่มเส้นทาง reader อย่างจำกัด
กรณี user มีทั้ง tenant membership เก่ากับ platform membership ใหม่ ต้องเลือก platform context อย่าง explicit
อย่าอาศัย oldest membership; อย่าเปลี่ยน actor context เป็น company ที่เปิดในรายละเอียดรายงาน
คนที่ถอน executive access แต่ยังเป็นพนักงานลูกค้าควรยังใช้บทบาทเดิมได้ตาม Q01
รายงานต้องไม่ทำให้ platform user ได้เข้า workspace ภายในมั่งมีหรือใช้ paid seat ลูกค้า
customer launch gate CLOSED ยังไม่ตัดสินว่า executive อ่านได้หรือไม่ (Q01); current code exempt เฉพาะ SYSTEM_ADMIN
ไม่แก้ policy นี้ด้วยการให้ role SYSTEM_ADMIN เพื่อให้หน้าเปิดได้

### 17.3 Account lifecycle ที่เสนอ

แยก global User.status ออกจาก executive access status; การระงับเฉพาะสิทธิ์ผู้บริหารต้องไม่ปิดทุกบทบาทของ user เดียวกัน
ชื่อ/อีเมล: trim, validate ด้วย auth helper เดิม, bounds ชัด (เสนอชื่อ 1–120/email≤320)
email case normalization ใช้ owner identity policy; DB unique เดิมไม่ยืนยัน race-safe case-insensitive uniqueness
มีตัวตนเดิม →ต้อง resolve/review ว่าจะเชื่อม enrollment ให้ userId ไหนตาม Q01 ไม่สร้าง duplicate และไม่ takeover account
existing disabled user ไม่ reactivate ด้วยการเพิ่ม executive access

lifecycle เสนอ pending activation→active→suspended/revoked เฉพาะ enrollment;
UI `active:boolean` ในเดโมไม่พอพิสูจน์ credential/login readiness
activate/invite credential flow ยังรอมติ Q01; ห้ามแสดง “เข้าใช้ได้แล้ว” เพียงเพราะมี User row
last login เป็น user login evidence ไม่ใช้ last executive report read; ถ้าต้องการแยกให้เพิ่ม label ต่างกัน

status command recheck permission+target version; protected/self/last-manager rules ตาม Q01
ข้อเสนอห้ามปิดผู้จัดการคนสุดท้ายด้วยหน้าเว็บ; lock ขอบเขต manager roster กันสองคนปิดพร้อมกัน
withdraw access ทำให้ request ถัดไปถูกปฏิเสธ และ invalidate report snapshots;
นโยบาย revoke ทุก session vs เฉพาะ platform ต้องปิด Q01 เพราะ AuthSession เดิมผูก global user
audit actor,target,from,to,reason,commandId,requestId ไม่บันทึก password/token
ปุ่มยกเลิกฟอร์มไม่สร้างบัญชี; UI success หลัง result สำเร็จ ไม่ optimistic grant

## 18. Data rights contract และช่องว่างจากฟอร์มจำลอง — DEFERRED ทั้งส่วน

### 18.1 Intake mapping

| Demo field | Existing BE | Target requirement |
|---|---|---|
| บริษัท | companyId | immutable valid company; picker ไม่ใช้รายชื่อจากหน้า pagination รายงานเท่านั้น |
| อีเมลหรืออ้างอิงผู้ร้อง | requesterContact (hash) / evidence reference คนละชนิด | แยก contact กับ opaque reference; hash อ่านกลับเป็นข้อความเดิมไม่ได้ |
| เหตุผลและขอบเขต | ไม่มี reason/scope ใน CreateCaseDto | เพิ่ม sanitized intake note/reference contract หรือส่งต่อฟอร์มเดิม; ห้ามทิ้งข้อความเงียบ ๆ |
| ไม่มีในเดโม | commandId, requestKey, caseType, requestSource, dueAt | FE ต้องเก็บ/ส่งครบ; dueAt ไม่ใช่ holdEndsAt และห้ามเดา SLA กฎหมาย |
| จำลองอนุมัติ | approve รับ commandId หลัง RETENTION_REVIEW | เปิด workflow เดิมครบ ไม่ต่อปุ่มนี้ตรง API แล้วข้ามขั้น |

ข้อเสนอ request type เริ่ม COMPANY_WORKSPACE_OFFBOARDING ตามหน้ารายบริษัท;
USER_ACCOUNT_ERASURE และ MEMBERSHIP_EXIT ยังอยู่ module เดิม แยก scope ตาม contract
company offboarding ห้ามส่ง targetUserId/membershipId; user erasure ห้ามส่ง companyId;
membership exit ต้องทั้งสาม id และเชื่อมถึงกันจริง

### 18.2 Transition matrix และเวลา

| Current→target | Command/guards | Effect/ข้อจำกัด |
|---|---|---|
| none→RECEIVED | create; target/request key/overlap/received<due valid | บันทึกเคส+audit ไม่ suspend/delete/bill โดยปริยาย |
| RECEIVED→IDENTITY_VERIFIED | verify-identity + permitted evidence | ผู้มีอำนาจจริงต้องตรวจแยกสำหรับ tenant scope |
| IDENTITY_VERIFIED→RETENTION_REVIEW | begin-retention-review + identity/authority | current guard เป็น source of truth |
| RETENTION_REVIEW→APPROVED | ครบ 12category + disposition allowed + retention valid + actor segregation | record approval; hold fields/anchor ตาม Q07 เท่านั้น |
| APPROVED→APPROVED waiting | server derives presentation stage | ห้ามใช้ dueAt หรือ approvedAt แทน anchor โดยเดา; no deletion |
| APPROVED→EXECUTING | hold policy ครบ, now≥end, source/inventory/actor/evidence-ready checks | current startExecution ยังไม่มี hold; transition ไม่ใช่ตัวลบ |
| EXECUTING→VERIFICATION | execution evidence ครบ + different verifier ตามกฎเดิม | partial failure ยังไม่ถึงขั้นนี้ |
| VERIFICATION→COMPLETED[_WITH_EXCEPTION] | independent verification + all required evidence + retention outcome match | retained/restricted ใช้ WITH_EXCEPTION ตาม enum เดิม ไม่ใช่ failure label |
| eligible→REJECTED/CANCELLED/BLOCKED | close matrix เดิม + reason | BLOCKED terminal command state แต่เป็น unresolved work; remediation เป็น linkedcase |

ตารางไม่อนุมัติ single-admin ใหม่: P31 มีมติ single-admin เดิม แต่ source ปัจจุบันยังบังคับคนละ actor
การมีผู้บริหาร 4 คนไม่แก้ความขัดแย้งนี้ ต้องเลือก effective actor policy Q06 ก่อน implementation

### 18.3 Hold model ที่เสนอรอมติ Q07

ต้องมี durable policyVersion/anchorEventRef/holdStartsAt/holdEndsAt/approvedScopeHash/approvalVersion
สร้างใน transaction กับมติที่เริ่มนับตาม Q07, server เป็นเจ้าของเวลา
ยังไม่ตัดสิน elapsed336hours vs14calendar-days และจุดเริ่ม/รีเซ็ตจากการแก้ scope
ค่าใดหาย/กลับด้าน/น้อยกว่า period ที่อนุมัติ →POLICY_NOT_READY ไม่ execute
remainingSeconds=max(0,end−serverNow), remainingDays=ceil(seconds/86400) เป็น display เท่านั้น
ที่ end−1ms ต้องปิด, ที่ end เท่ากันผ่านเฉพาะ time gate, หลัง end ยังตรวจทุก guard

แยก preflight evidence (identity/authority/approved scope/inventory/retention/readiness)
ออกจาก execution evidence (DB/object/queue/processor/backup/independent verification)
อย่างหลังเกิดหลังลงมือ; ไม่ตั้ง guard วนกันว่าต้องมี proof ลบสำเร็จก่อนเริ่มงาน

readiness response: `canExecute`, `blockers[]`, `serverNow`, `hold`, `scopeRevision`, `inventoryRef`,
`retentionReviewVersion`, `executionStatus`; blocker ต้องมี code/message ไม่ใส่ raw sensitive evidence
ไม่ใช้ client countdown enable ปุ่มเอง; re-read readiness ตอนกด และ recheck under lock ใน BE
hold ไม่เป็น legal retention deadline; dueAt, holdEndsAt, retentionUntil เป็นนาฬิกาคนละหน้าที่

## 19. ผลข้ามโมดูลของการเก็บและลบข้อมูล — DEFERRED ทั้งส่วน

ระหว่าง hold ต้องคงข้อมูลทั้งหมดใน scope; การห้ามเข้าถึง/เขียน/ต่ออายุยังรอมติ Q07
สิ่งที่ต้องออกแบบก่อนเปิด execution แม้ไม่เริ่มเขียนรอบนี้:

1. Inventory: enumerate company/user/membership scope, indirect FK, unlinked tables,
   S3 current/noncurrent versions, outbox/queues/caches, provider copies, exports, backups และ analytics snapshots
2. Prevent source drift: policy ระหว่าง hold; ก่อน execute ต้องหยุด newwrites และ inflightwriters ด้วย guard/fence ที่ทุก producer ตรวจ
   scope เปลี่ยนหลังอนุมัติ→invalidate readiness/review ไม่ขยายงานลบเงียบ ๆ
3. Billing: cancel/retain/refund เป็นคนละคำสั่ง; deleting Company ไม่ cancel subscription;
   webhook/reconcile หลัง offboard ห้ามสร้าง term/membership กลับ; preserved cash evidence ต้องมี lawfulbasis ตาม Q08
4. Global identity: ลบร้าน A ไม่ลบ User/LINE ของร้าน B; user-erasure ไม่ทำลายเอกสารที่ tenant อื่นมีหน้าที่เก็บ
5. Storage: ทำ manifest ก่อนลบ locator; delete exact versions หลังครบ hold ตาม retention decision;
   lifecycle/TTL/cleanup jobs ต้องไม่ลบข้อมูลใน scope ก่อนครบ 14 วันถ้าข้อมูลนั้นอยู่ในกฎ all-data
6. Executor: durable per-scope job/checkpoint/idempotency; stale lease ห้าม continue;
   retry เฉพาะส่วนไม่สำเร็จ; cancel หลังเริ่มทำลายไม่แสร้ง rollback ได้
7. Evidence: `run://` + sha256 รูปแบบถูกไม่พิสูจน์ว่าลบจริง; resolve machine-produced evidence,
   count before/deleted/retained/failed และ verify อิสระ; externalunknown→BLOCKED ไม่ COMPLETED
8. Reports: invalidate per-company caches/snapshots/materializations; ไม่เก็บ profilePII ไว้เพียงเพราะเป็น analytics;
   retained financial fact ที่ไม่เหลือ Company ต้องไม่หายจาก platform total และไม่ link กลับ profile ที่ลบแล้ว
9. Backup/restore: manifest และ restoreguard ต้อง reapply erasure/restrictions ก่อนเปิด access;
   expiry ที่ตั้งใน config ไม่ใช่หลักฐานว่าทุกสำเนาหายแล้ว
10. Completion: แยก completed operations, legal retention, unresolved failures;
    แจ้งผลตามหลักฐานจริงผ่านช่องทางที่อนุมัติเท่านั้น

จำนวน models/FK จากการสำรวจอยู่ audit E16 ไม่ใช่สิทธิ์ให้เพิ่ม CASCADE ทุกตาราง
retention/legal basis/ระยะเวลา/processor obligations ต้อง review แยก(Q08); ไม่รับรองข้อกฎหมายจากเอกสารเก่าในรอบนี้

## 20. Data model change, performance และการปฏิบัติการ

### 20.1 Minimal change candidates ยังไม่ใช่ migration

| Candidate | ทำไมต้องมี | ทางเลือก reuse/เงื่อนไข |
|---|---|---|
| Company classification + provenance | CUSTOMER/TEST/INTERNAL/UNKNOWN เพื่อ R02 | หา metadata เดิมที่น่าเชื่อถือก่อน; ไม่เพิ่ม flag โดยไม่มี owner |
| Commercial industry mapping/version และ entity metadata | R09 ไม่มี canonical ครบ | reuse businessTypeCode/address; field ใหม่ต้อง Q05 |
| Verified billing movement projection | cash time/refund per event | billing owns; backfill จากหลักฐานที่ยืนยันได้เท่านั้น |
| Activity facts/coverage checkpoints | lifetime/period/dedup/actor proof | reuse existing domain events/outbox ก่อนเพิ่ม producer |
| Executive platform role/enrollment metadata | separate identity/access/activation | reuse existing membership; table ใหม่เฉพาะ provisioning/version จำเป็น |
| DataRights hold/scope/readiness/checkpoints (DEFERRED) | all-data 14 day/executor | extend existingcase; ไม่สร้าง parallelcase DB |
| Short-lived report projection | count/list/drilldown一致 | retention/invalidation ตาม§12; no new cache dependency by default |

### 20.2 Query และ limits

- Query company eligibility ก่อน aggregate; pre-aggregate แต่ละ one-to-many ก่อน join ไม่ join invoices×events×signup แล้ว sum
- usegroupedDBqueries/batchlookups; ไม่เรียก GetPartnerDetail หนึ่งครั้งต่อบริษัททั้งระบบ
- cursor stable tie-break; count ต้องทั้ง scope; ไม่มี silent5000rowcap
- index candidates: classification/status/createdAt/id, discovery company original order,
  movement(scope,currency,effectiveAt,companyId), activity(companyId,occurredAt,feature), logical keyunique
  วิเคราะห์ด้วย EXPLAIN ใน testDB ก่อนเพิ่ม index; currenttenant-firstindexes อาจไม่พอ platformtimequeries
- เสนอ loadtargetQ09: 10,000 บริษัท/1,000,000activityfacts/12 เดือน, overview p95≤2s,
  directory p95≤1s,10concurrentreaders; เป็น target ยังไม่ได้ benchmark
- source timeout→partial/unavailable เฉพาะ section เมื่อแยกได้; auth/tenantfailure ต้อง fail ทั้ง request
- ห้ามทำ aggregate ยาวใน transaction ที่ lock billing mutation; snapshotconsistentread ต้อง bounded

### 20.3 Audit, observability, rollout

audit account/case commands atomically; report access log เป็น metadata ขั้นต่ำ ไม่เก็บ returned companydataset
metrics: snapshot build duration/source lag/unknown population/unknown usage/row truncation rejected/
receipt reconciliation delta/permission denial/command replay/conflict/hold denial/executor pending verification
ไม่ logquery ข้อความที่อาจมี PII หรือ requestercontact ลง dashboardlog โดยตรง

เสนอ readmodule featureflag แยก account และ deletion; rollbackread ไม่ย้อนลบ financialfacts/audit
ก่อน release ต้อง policy decisions ครบตาม stage, backfillreport พร้อม coverage, source→API→FEreconciliation,
securitynegative tests, actualbrowserE2E และ regression โมดูลข้างเคียงผ่าน
deployment ต้องตาม runbookUAT/Production เดิม; รอบนี้ไม่มี deployment หรือ cloudinspection

## 21. Decision register และเงื่อนไขเปิดแต่ละส่วน

| ID | สิ่งที่ต้องตัดสิน | ข้อเสนอเพื่อคุย | Gate |
|---|---|---|---|
| Q01 | ใครจัดการบัญชี/สิทธิ์, เปิด credential, linkexistinguser, revoke/session, PII, maintenanceaccess | readerdefault; manager เฉพาะที่แต่งตั้ง; reuseidentity; suspendexecutiveaccess แยก globaluser | auth/accounts; casevisibility DEFERRED |
| Q02 | ใครรับรอง customer/test/internal และ historicaldeletedpopulation | explicit classification/provenance; unknown แสดงแยก | exactcompanyKPI |
| Q03 | qualifying feature events, trialusage, paidEver หลัง refund, human/system/support, logincontext | logical successful action; trial counts as started; everpaid ไม่ลบจาก refund | paidusage/engagement |
| Q04 | cashVAT/refunddate, manualmoney, dispute/creditnote, provider account scope | verified gross cash ตาม effective event time; fee/cost แยก | financialreports |
| Q05 | industry mapping owner, entitysource, current vs historical dimensions | versioned primary group; currentprofilesnapshot มี label; unknown ไม่เดา | segmentation |
| Q06 (DEFERRED) | ใครอ่านข้อมูลคำร้องละเอียด/create/approve/execute/verify; single-admin policy ใช้งานจริงแบบใด | summary ทุกบริษัทให้ reader ตามมติเดิม; ข้อมูลละเอียด/commands ไม่ inherit manage | data rights integration |
| Q07 (DEFERRED) | holdanchor,336hours/calendar,edit/reset,cancel,read/write/billingduringhold,manual/auto | ระบุทุก transition ก่อน execute; no early purge; missing policy fail closed | hold/executor |
| Q08 (DEFERRED) | lawful retention inventory, financial/analytics/backup/processor retention, deleted history display | legalreview พร้อม basis/end/access และ restorecontrols | purge/retainedhistory |
| Q09 | snapshotTTL, freshnessSLA, acceptedscale/latency |15min snapshot; lag ต่อ source;targets§20| operational acceptance |

Q01–Q09 เป็นรายการ decision ครบสำหรับการวางแผน ไม่ใช่คำตอบที่ผู้ใช้ยืนยันแล้ว
ไม่ต้องหยุดการเขียนสเปกส่วนอื่นระหว่างรอ; แต่การเขียนโค้ดที่ข้าม policyboundary ต้องหยุดที่ gate นั้น

## 22. สถานะความพร้อม ณ 2026-10-01

- Design: มี requirement→screen→API→source→QAtraceability และ bug/impactregister ตามเอกสารแนบ
- Demonstration: ซ่อน deletion ตามมติล่าสุดแล้ว; browserchecks ผ่านทั้ง report/account/theme และ HIDE-01–04; fixture/interactiongaps อื่นยังเปิดตาม audit
- ExistingBE: focusedtests58 ผ่าน; เป็น guard/domain เดิม ไม่พิสูจน์ hold14 วันหรือ executiveAPI ใหม่
- Newintegration: ยังไม่มี endpoint/role/facts ครบ จึงจำลอง request/response บนเอกสาร ไม่ยิง mutation จริง
- Release: ยังไม่พร้อมเปิดใช้จริง; ต้องปิด decision gates และทำ implementation/verification ตามแผน

## ส่วนเพิ่มกราฟการใช้งานและ 80/20 (2026-10-01)

ดู [spec extension](mangmee-executive-usage-pareto-spec-th.md) สำหรับกราฟแยกสี/คลิกเจาะข้อมูล/อันดับ/Top spender และ fixtureใหม่72บริษัทหลังตัดทดสอบ. ตัวเลข12บริษัทในเอกสารนี้เป็น historical baseline; ไม่ใช่เดโมรุ่นล่าสุด. ผล spec simulation เดิมยังไม่ใช่ integration PASS. Deletion ยังคงซ่อน


Contact export amendment 2026-10-01: Q-EXL-CONTACT RESOLVED — Owner เลือก User.email/phoneNumber ล่าสุดของบัญชีเจ้าของ. ตาม [Excel spec §9](mangmee-executive-excel-export-spec-th.md#9-มติข้อมูลติดต่อ--2026-10-01), projection ตรวจสิทธิ์แล้ว join companyId → active CompanyMembership → canonical active OWNER role → User; distinct userId หนึ่งคนจึงคืน contactUserId/email/phone จากคนเดียวกัน. หลายคน/ไม่มี/source error คืน null พร้อม contactStatus แยก; current User status แสดงตามจริงไม่เลือกตัวแทน. contactSource=OWNER_ACCOUNT, contactCoverage แยก field, sourceAsOf เป็นเวลาสร้าง report snapshot; ใช้ร่วม FE/detail/Excel ไม่ join สดตอน export. ห้าม Company/signup/Gmail/Sheet fallback หรือ name/first-member matching; หนึ่งบริษัทหนึ่งแถว. ไม่มีการแก้ระบบบัญชี/สมัครหรืออ่านฐานข้อมูลสดในรอบนี้; application export ยัง NOT_IMPLEMENTED
