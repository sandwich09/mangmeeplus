# Sender.net — เอกสาร developer และเอกสารภาษีสองฝั่ง

> **ARCHIVED PROVIDER RESEARCH 2026-09-11:** OwnerเลือกPostmarkแล้วและยืนยันให้Stripeออก/ส่งInvoice/Receiptฝั่งลูกค้า. ใช้ [Postmark reference](postmark-developer-reference-th.md) และ [specปัจจุบัน](../specs/mangmee-transactional-email-provider-spec-th.md); การเปรียบเทียบ/ข้อเสนอSenderด้านล่างเป็นประวัติ ไม่ใช่สถานะเลือกproviderปัจจุบัน.

ตรวจ official docs วันที่ **2026-09-11**. เป็นผลอ่านเอกสาร ไม่ใช่ผลทดสอบบัญชี Sender ของมั่งมี และยังไม่ได้ติดต่อผู้ให้บริการ. ใช้กับ [spec](../specs/mangmee-transactional-email-provider-spec-th.md) และ [plan](../plans/mangmee-transactional-email-provider-plan-th.md). **อัปเดตล่าสุด:** Owner ต้องการ Receipt แบบ Stripe; §4 เปรียบเทียบ provider ตามเงื่อนไขนี้และทำให้ Sender ยังเป็น candidate ที่รอพิสูจน์.

## 1. API และข้อจำกัดที่เกี่ยวกับงานนี้

| เรื่อง | สิ่งที่เอกสารระบุ / ผลต่อการออกแบบ |
|---|---|
| ส่ง transactional โดยไม่สร้าง campaign | `POST https://api.sender.net/v2/message/send`, Bearer token; `from` มี email/name, `to` มี email, `subject`, text/html. เลิกใช้ `recipient_email` ที่ deprecated. ตัวอย่างตอบ `success`, `message`, `emailId`; app ต้องตรวจ response และเก็บ provider ID โดยไม่ตีความว่าเข้า inbox แล้ว. [Send API](https://api.sender.net/transactional-campaigns/send-transactional/) |
| ความผิดพลาด | API อธิบาย 400/401/404/422/429/5xx. เก็บประเภท error ที่ scrub แล้ว ไม่ส่ง provider body ทั้งก้อนให้ browser. [Errors](https://api.sender.net/errors/) |
| Rate limit | มี `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`; 429 ใช้ `Retry-After` และ backoff. เพดานจริงต้องตรวจบัญชี ไม่ hardcode ตัวเลขจาก marketing. [Rate limits](https://www.sender.net/help/transactional-emails/transactional-email-rate-limits/) |
| Domain / ช่องทาง | มี REST API และ SMTP; ต้องเตรียม sending domain และตรวจ SPF/DKIM/DMARC. [Setup](https://www.sender.net/help/transactional-emails/setting-up-transactional-emails/), [Getting started](https://www.sender.net/help/transactional-emails/getting-started/) |
| Webhook | Help ระบุ signing secret และ `bounces/new`; topic list ที่อ่านไม่ยืนยัน delivered/complaint event แบบราย message ครบทุกชนิด. ยังไม่มีรายละเอียด signature header/algorithm/replay window ที่พอ implement จากหน้านี้. [Webhook setup](https://www.sender.net/help/transactional-emails/transactional-webhook-setup/) |
| Plan ที่ใช้กับ webhook | API สร้าง account webhook ระบุ **paid plan required**. ห้ามสรุปว่า free transactional sending หมายถึงมีทุก operational feature ฟรี. [Create webhook](https://api.sender.net/account-webhooks/create-webhook/) |
| Payload correlation | ตัวอย่าง account webhook เป็น subscriber payload; ไม่ใช่หลักฐานว่า bounce payload มี `emailId` ตรงกับ send response. ต้องมีตัวอย่างจริงที่ปิดข้อมูลส่วนบุคคลก่อนทำ message-level mapping. [Payload example](https://api.sender.net/account-webhooks/webhook-payload-example/) |
| Attachment | REST ใช้ filename → URL ที่ provider เข้าถึงได้. คู่มือ attachment ระบุ HTTPS และ 25 MB ต่อไฟล์ แต่ feature overview ระบุ 10 MB; ต้องยืนยัน limit ก่อนเปิดใช้. ไม่ทำเอกสารภาษีเป็น public ถาวรเพื่อตามตัวอย่าง API. [Attachment guide](https://www.sender.net/help/transactional-emails/attachments-and-size-limits/), [Feature overview](https://www.sender.net/help/transactional-emails/transactional-email-feature/) |

ยังไม่ยืนยัน send idempotency key, guarantee การไม่ส่งซ้ำ, lookup หลัง timeout, signature format, transaction-specific delivery/complaint correlation และ quota ของบัญชีที่จะใช้. สิ่งเหล่านี้เป็น contract spike ใน M0; ไม่ยืม header/event shape จาก Stripe หรือ SES มาใช้กับ Sender.

## 2. Sender ออกเอกสารค่าบริการให้มั่งมี

**ยืนยันได้:** มี invoice PDF ใน Billing → Invoices และกรอกชื่อบริษัท ที่อยู่ Company code/Tax ID และ VAT code ลงข้อมูล billing ได้. **ยังยืนยันไม่ได้:** เอกสารนั้นเป็นใบกำกับภาษีไทยเต็มรูปสำหรับค่าบริการที่มั่งมีซื้อ หรือใช้เป็นหลักฐานภาษีซื้อไทยได้. การใส่เลขภาษีผู้ซื้อไม่ได้ยืนยันสถานะภาษีของผู้ออก. [Sender — Taxes and VAT](https://www.sender.net/help/account-settings-and-billing/taxes-and-vat/)

เอกสาร Sender ขัดกันเรื่องแก้ invoice ย้อนหลัง: Taxes and VAT บอกแก้ข้อมูลมีผลในอนาคตและให้ติดต่อ support เพื่อแก้ใบเก่า; Download your invoice บอกแก้ข้อมูลแล้วดาวน์โหลดใบเดิมได้ข้อมูลใหม่. ตั้งข้อมูลบริษัทให้ถูก **ก่อนชำระ** และขอตัวอย่าง/วิธีแก้จากผู้ให้บริการก่อนพึ่งความสามารถนี้. [Download your invoice](https://www.sender.net/help/account-settings-and-billing/download-your-invoice/)

คำถามที่เตรียมไว้สำหรับผู้ให้บริการ/ฝ่ายบัญชี — **ยังไม่ได้ส่ง**:

1. Invoice ออกโดยนิติบุคคลใด ประเทศใด และมีเลขจดทะเบียน/เลข VAT อะไร? ขอ sample สำหรับบริษัทไทยที่มี Tax ID 13 หลัก พร้อมที่อยู่และสาขา.
2. ออก **Thai full VAT tax invoice** ได้หรือมีเพียง invoice ค่าบริการของผู้ให้บริการ? ภาษีที่เรียกเก็บเป็นของประเทศใด? ขอหลักฐานรูปแบบจริง ไม่ใช้คำว่า “VAT invoice” อย่างเดียวสรุป.
3. เอกสารออกเมื่อซื้อ/ต่ออายุ/เติมเครดิตอย่างไร; มีเลขเอกสาร วันออก สกุลเงิน รายการ และเอกสาร refund/correction แบบไหน? แก้ข้อมูลย้อนหลังได้ด้วยวิธีใด?
4. แพ็กเกจที่จะซื้อรองรับ transactional API, webhook ที่ต้องใช้, quota, log retention และต้นทุนเกิน quota อย่างไร? ขอ signature/payload/timeout-idempotency contract ที่ M0 ยังขาดด้วย.

ฝ่ายบัญชียืนยันวิธีบันทึกค่าใช้จ่ายและภาษีตามเอกสารจริง; งานนี้ไม่ตัดสินสิทธิภาษีซื้อหรือภาษีจากการซื้อบริการต่างประเทศแทนฝ่ายบัญชี.

## 3. มั่งมีออกเอกสารให้ลูกค้าและใช้ Sender ส่ง

ขอบเขตคือ **ค่าบริการแพ็กเกจมั่งมีตาม P26** ไม่ใช่การเพิ่มระบบออกเอกสารขายแทนทุก tenant. แยก commercial invoice, receipt, Thai tax invoice และ e-Tax artifact เป็นคนละชนิด; Sender เป็นช่องทางส่ง ไม่ได้ทำให้เอกสารมีสถานะภาษีโดยตัวมันเอง.

ประมวลรัษฎากร ม.86/4 กำหนดรายการของใบกำกับภาษี และ ม.86/13 จำกัดสิทธิผู้ออก. จึงต้องยืนยันนิติบุคคล/สถานะ VAT ของมั่งมีและให้บัญชีกำหนด tax point, รูปแบบ และการแก้ไขเอกสารก่อนเปิดใช้. ไม่สันนิษฐานว่ามั่งมีจด VAT แล้ว. [กรมสรรพากร — มาตรา 85–86](https://www.rd.go.th/5208.html)

**อีเมลแนบ PDF ทั่วไปไม่เท่ากับ e-Tax ที่สมบูรณ์อัตโนมัติ.** ตัวอย่างวิธี Time Stamp ของกรมสรรพากรต้องได้รับอนุมัติ, ใช้ PDF/A-3 ไม่เกิน 3 MB, หนึ่งเอกสารต่ออีเมล, ส่งจากอีเมลที่ลงทะเบียนถึงผู้ซื้อและ CC ระบบ, ใช้หัวเรื่องตามรูปแบบ และเก็บไฟล์/อีเมลผลที่ประทับเวลาตามข้อกำหนด. นี่เป็นวิธีหนึ่ง ไม่ใช่การเลือกวิธีให้มั่งมีแล้ว. [คู่มือ Time Stamp — กรมสรรพากร](https://www.rd.go.th/fileadmin/user_upload/eTax/manual_time_stamp_230167.pdf)

ข้อสรุปทางเทคนิคของงานนี้: REST schema ที่อ่านมี `to` และ custom headers แต่ไม่รับรอง envelope CC สำหรับ Time Stamp; ใส่ header ชื่อ CC ไม่ใช่หลักฐานว่าส่งสำเนาถึงระบบได้จริง. ถ้าเลือกวิธีนี้ ต้องพิสูจน์ transport, attachment, inbound result และ validation ครบก่อน claim รองรับ e-Tax. ลิงก์ดาวน์โหลดเอกสารในแอปเหมาะกับสำเนา/การเข้าถึงซ้ำ แต่ไม่ใช้แทนขั้นส่งมอบต้นฉบับตามวิธีภาษีที่เลือก.

## 4. Receipt เป็นเกณฑ์เลือก provider ล่าสุด

Owner ระบุว่าอยากได้ **Receipt เหมือน Stripe**; invoice ที่เห็น Paid อย่างเดียวไม่ตอบ requirement นี้. ตรวจเอกสารการเก็บค่าบริการของ vendor เอง ไม่ใช้ตัวอย่าง receipt template ที่ vendor ให้ developer ส่งให้ลูกค้าของแอปมาเป็นหลักฐาน.

| Provider | หลักฐานเอกสารหลังชำระ | ผลต่อการเลือก |
|---|---|---|
| Sender.net | มี Invoice PDF และสถานะ Paid ใน Billing; docs ที่อ่านยังไม่ยืนยัน Receipt แยก. [Taxes and VAT](https://www.sender.net/help/account-settings-and-billing/taxes-and-vat/) | **OPEN** — ยังไม่ผ่าน SUP-RECEIPT จากหลักฐานที่มี; ไม่สรุปว่าไม่มี |
| Postmark | Help ยืนยัน PDF Receipt แนบใน invoice email เมื่อรับชำระ และดาวน์โหลด/พิมพ์ PDF ย้อนหลังได้; memo ใส่ company/address/Tax ID, เพิ่ม billing contacts ได้. Bill To ใช้ชื่อ account owner ส่วน address มาจาก billing address ของบัตร; การแก้ใช้กับเอกสารในอนาคต. [Receipt settings](https://postmarkapp.com/support/article/how-do-i-customize-a-receipt-generate-pdf-receipts-add-additional-email-addresses-for-receipts) | **แนะนำจากเกณฑ์ Receipt**; public documentation confirmed, actual account/sample/technical acceptance NOT RUN |
| Twilio SendGrid | Help ระบุ receipt portion ที่ด้านล่าง invoice หลังชำระ พร้อม Payment Summary. [Invoice receipts](https://help.twilio.com/articles/47567429613083) | มี receipt ตาม docs แต่เป็นส่วนหนึ่งของ invoice; ถ้าอยากได้ PDF Receipt ชัดเจน Postmark มีหลักฐานตรงกว่า |

Postmark ใช้ส่ง transactional email ผ่าน server API ได้; [official sending guide](https://postmarkapp.com/developer/user-guide/send-email-with-api) ระบุ send response `MessageID`, มี `POSTMARK_API_TEST` สำหรับตรวจคำขอโดยไม่ส่งถึงผู้รับ. จึงเป็น candidate ที่มีทางทดสอบ transport ได้ แต่ยังไม่พิสูจน์ delivery/bounce/complaint/retry หรือ app E2E และไม่ได้ทดสอบ API จริงในรอบนี้. หากเลือก Postmark ต้องเก็บ provider-specific contract เพิ่มก่อน implement; ชุด Sender headers/signature/env ใช้แทนกันไม่ได้.

ข้อเสนอการตัดสินใจ: เลือก vendor จาก Receipt + technical/account/cost fit; ไม่ต้องฝืน Sender หากปิดช่องว่างเอกสารไม่ได้. ยังไม่ได้เปลี่ยนเป็น Postmark ใน runtime หรือซื้อบริการ. Receipt ของ vendor เป็นคนละเกณฑ์กับ Thai VAT tax invoice; ประเด็นหลังยังต้องตรวจตาม §2–3 ไม่เปลี่ยนจากการมีคำว่า Receipt.
