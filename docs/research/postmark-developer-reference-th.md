# Postmark — Developer reference สำหรับ Mangmee

ตรวจ official docs **2026-09-11**; Owner เลือก **Postmark** แล้ว. ใช้กับ [spec](../specs/mangmee-transactional-email-provider-spec-th.md) / [implementation + test plan](../plans/mangmee-transactional-email-provider-plan-th.md). เป็น document research ไม่ใช่ provider/API/E2E pass; ไม่ได้เปิดบัญชี ส่งเมล ซื้อบริการ หรือแตะ cloud. [Sender research เดิม](sender-developer-and-tax-invoice-reference-th.md) เก็บไว้เป็นประวัติ ไม่ใช่ implementation contract.

## 1. API ที่ใช้และที่ไม่ต้องใช้ในรุ่นแรก

| งาน | Official contract / การใช้ในมั่งมี |
|---|---|
| ส่งทีละฉบับ | `POST https://api.postmarkapp.com/email`, header `X-Postmark-Server-Token`; ส่ง JSON และรับ JSON. ใช้ existing app templates ผ่าน From/To/Subject/TextBody/HtmlBody, ระบุ MessageStream; success ตรวจ ErrorCode=0 และ MessageID. ไม่ต้องย้าย templates เข้า dashboard หรือเพิ่ม SDK เพื่อเริ่มต้น. [Email API](https://postmarkapp.com/developer/api/email-api) |
| ส่งเพื่อ validation | `POSTMARK_API_TEST` เป็น test token ที่ provider ระบุสำหรับตรวจ request โดยไม่ส่ง inbox; ไม่ถือว่าได้พิสูจน์ account/domain/webhook. [Sending guide](https://postmarkapp.com/developer/user-guide/send-email-with-api) |
| เฝ้าผลส่ง | Delivery, Bounce, SpamComplaint มี webhook; เปิดเฉพาะ transactional stream ที่ app ใช้. ไม่ใช้ Open/Click เป็น proof หรือเพิ่ม campaign/subscriber จากการ signup. [Delivery](https://postmarkapp.com/developer/webhooks/delivery-webhook), [Bounce](https://postmarkapp.com/developer/webhooks/bounce-webhook), [Complaint](https://postmarkapp.com/developer/webhooks/spam-complaint-webhook) |
| ตั้ง webhook | `/webhooks` รองรับ HttpAuth/HttpHeaders, MessageStream, Triggers และ IncludeContent. มั่งมีเลือก HTTPS + HttpAuth, ไม่ใส่ credentials ใน URL; Bounce/SpamComplaint IncludeContent=false. การตั้ง/verify เป็น provisioning ของ ops ไม่ใช่ API ที่ browser เรียก. [Webhooks API](https://postmarkapp.com/developer/api/webhooks-api) |
| ตามผลหลัง timeout | `GET /messages/outbound` ใช้ count/offset, messagestream และ `metadata_sendAttemptId`; ค้นได้ครั้งละหนึ่ง metadata field. ถ้ามี ID ใช้ `/messages/outbound/{messageid}/details`. Response มี Sandboxed; details อาจมี body จึงต้อง scrub และไม่ fetch raw dump เพื่อเก็บ proof. ผลค้นว่างไม่ได้รับรองว่าไม่เคยส่ง. [Messages API](https://postmarkapp.com/developer/api/messages-api) |
| Suppression | ตรวจสถานะตาม server/stream; ไม่ reactivate จากปุ่ม resend อัตโนมัติ. ใช้ API เพื่อ reconcile เมื่อจำเป็น ไม่เพิ่ม recipient ลง marketing list. [Suppressions API](https://postmarkapp.com/developer/api/suppressions-api), [Bounce API](https://postmarkapp.com/developer/api/bounce-api) |

Runtime ใช้ **server token** เฉพาะ environment; ไม่ต้องให้ account token ที่มีสิทธิ์สร้าง server แก่ตัวแอป. Batch/template-management/broadcast/inbound เป็นนอก scope รุ่น auth transport แรก. หากเพิ่ม batch ภายหลังต้องตรวจ ErrorCode รายรายการแม้ HTTP 200.

## 2. ข้อเท็จจริงที่มีผลต่อ failure design

- **ไม่มี outbound idempotency key** ตาม [Postmark support](https://postmarkapp.com/support/article/what-is-an-idempotency-key). ต้องกัน duplicate business mutation ในแอปและยอมรับว่าผล timeout บางกรณีอาจส่งเมลซ้ำได้; custom Message-ID/Metadata ไม่ใช่ provider dedupe guarantee.
- อ่าน HTTP status และ numeric ErrorCode แยกกัน: 10/auth, 300/402/403/validation, 406/inactive recipient, 412/413/account approval, 1235/1236/stream config เป็นตัวอย่างสำคัญ. HTTP 413 payload ใหญ่กับ **ErrorCode 413** account ไม่พร้อมเป็นคนละกรณี. 429 และ 5xx ต้องแยก retry/unknown จาก permanent failure. [API overview/errors](https://postmarkapp.com/developer/api/overview)
- **Postmark ไม่ sign webhook**; official docs แนะนำ HTTP Basic Auth ผ่าน HTTPS และ IP allowlisting. ตัวอย่าง dedupe ใน overview ใช้ MessageID อย่างเดียวซึ่งไม่พอสำหรับหลายประเภท/ผู้รับ; มั่งมีต้องใช้ event-specific key ตาม spec. [Webhook security](https://postmarkapp.com/developer/webhooks/webhooks-overview)
- Delivery หมายถึง mail server ปลายทางรับแล้ว ไม่รับรอง inbox placement; event เป็นราย recipient. มี MessageID/ServerID/MessageStream/Recipient/DeliveredAt และ metadata; อย่านำ callback หลายผู้รับมารวมด้วย MessageID อย่างเดียว. [Delivery semantics](https://postmarkapp.com/developer/webhooks/delivery-webhook)
- Bounce มี ID, MessageID, Email, Type/TypeCode, Inactive/CanActivate และเวลา; Complaint ใช้ RecordType=SpamComplaint. Hard bounce/inactive/complaint ต้องระงับส่งตาม policy; อย่าเหมาว่า soft failure ทุกอันต้อง POST mail ฉบับใหม่ทันที. [Bounce payload](https://postmarkapp.com/developer/webhooks/bounce-webhook), [Complaint payload](https://postmarkapp.com/developer/webhooks/spam-complaint-webhook)

Webhook retry ตาม overview ที่อ่าน: 5xx/408/429/network failure retry; 4xx อื่นเป็น permanent/drop. มี backoff จำกัดครั้ง, verification ต่อ event type และอาจ pause เมื่อ fail ต่อเนื่อง. บางตัวอย่างในหน้า event กล่าวกว้างว่า non-2xx retry; จึงคืน **200 หลัง persist** และ **503 เมื่อ persistence ใช้ไม่ได้**, ไม่พึ่ง 4xx ให้ retry. ยืนยัน behavior จริงใน EM12 ก่อน rollout. [Retry/verification](https://postmarkapp.com/developer/webhooks/webhooks-overview)

## 3. Attachment, domain และข้อมูลอ่อนไหว

Postmark รับ attachment เป็น `Name`, `Content` (Base64), `ContentType`; มี Cc/Bcc จริงใน send schema. จึงส่งไฟล์จาก private storage ผ่าน backend ได้โดยไม่เปิด public URL. [Email attachment schema](https://postmarkapp.com/developer/api/email-api)

รวม message หลัง encoding ได้ไม่เกิน **10 MB**; Base64 เพิ่มขนาดไฟล์. มั่งมีกำหนดเพดานภายในต่ำกว่านี้และคำนวณขนาดจริง; ข้อจำกัด 50 MB เป็น batch ไม่ใช้แทน single-message cap. Provider activity/raw source อาจมีสำเนา bytes จึงไม่กล่าวว่าเอกสารอยู่เฉพาะ storage ของมั่งมี. [Size limits](https://postmarkapp.com/support/article/1056-what-are-the-attachment-and-email-size-limits)

ตั้ง verified domain/sender, DKIM และ custom Return-Path เพื่อ SPF alignment; DMARC ผ่านได้ด้วย aligned SPF หรือ DKIM. ไม่แก้ DNS โดยคัดลอก SPF record ของ provider อื่น. [SPF](https://postmarkapp.com/support/article/how-do-i-set-up-spf-for-postmark), [Return-Path](https://www.postmarkapp.com/support/article/910-how-do-i-add-a-custom-return-path)

Message content/activity เก็บที่ Postmark ตาม retention ของบัญชี (default ที่ docs ระบุ 45 วัน); app ห้าม log raw token แต่ provider ที่ส่งย่อมเห็นเนื้อหา. จำกัดคนเข้าถึง server/activity และระบุ retention/ค่าใช้จ่ายใน M4. ไม่ใช้ Postmark เป็นคลัง fiscal document ระยะยาว. [Retention](https://postmarkapp.com/support/article/how-does-the-retention-add-on-work)

## 4. ทดสอบโดยไม่ส่งถึงลูกค้าจริง

| ระดับ | พิสูจน์อะไรได้ / ข้อจำกัด |
|---|---|
| L0 local fake HTTP + real API/PG/browser | จำลอง response loss/retry/callback order และตรวจ business state; ไม่เรียก Postmark และไม่ใช่ provider acceptance |
| L1 POSTMARK_API_TEST | validation request กับ API จริง; ไม่ใช่ inbox หรือ full webhook proof และไม่ใช้ token นี้เป็น production config |
| L2 Sandbox Server | provider ประมวลผลและแสดง Delivered/ส่ง webhook ได้ แต่ส่งไป black hole. **นับ quota**, server type เปลี่ยนภายหลังไม่ได้; สร้างเป็น Sandbox อย่าง explicit เพราะ API default อาจเป็น Live. [Sandbox server](https://postmarkapp.com/developer/user-guide/sandbox-mode/server-sandbox-mode) |
| L2b fake bounce | `hardbounce@bounce-testing.postmarkapp.com` / `softbounce@bounce-testing.postmarkapp.com` ทดสอบ bounce ได้; hard bounce จะถูก suppress ใน stream, ต้องใช้ fixture/reset ที่ควบคุม. นับ sending volume; **ไม่รองรับ SpamComplaint** ใน generator นี้. ทดสอบ complaint ด้วย authenticated synthetic fixture แยก ไม่กด report spam เมลจริงเพื่อทำ test. [Fake bounces](https://postmarkapp.com/developer/user-guide/sandbox-mode/generate-fake-bounces) |
| L3 controlled live inbox | account/domain จริง + ผู้รับทดสอบที่อนุญาต, inbox/header/link/PDF inspection. แยกจาก L1/L2; ไม่ส่งให้ลูกค้าจริงเพื่อพิสูจน์ระบบ |

ทั้งหมดข้างต้นยัง **NOT RUN** ในรอบ research นี้. ห้ามรวม Sandboxed Delivered กับ live delivery ใน metric/status/evidence.

## 5. Receipt และ customer tax document

Postmark ยืนยัน PDF Receipt หลังรับชำระ พร้อมช่อง receipt memo สำหรับบริษัท/Tax ID และ billing recipients. Bill To/memo/address เป็นคนละ field และแก้มีผลในอนาคต; ตั้งให้ถูกก่อนซื้อ. นี่คือหลักฐานตรงเกณฑ์ **SUP-RECEIPT** ที่ Owner เลือก ไม่ใช่ตัวอย่าง template ให้แอปส่งเอง. [Postmark receipt guide](https://postmarkapp.com/support/article/how-do-i-customize-a-receipt-generate-pdf-receipts-add-additional-email-addresses-for-receipts)

Owner ชี้แจงล่าสุด: Receipt ของ Postmark ใช้ลงบัญชี **ค่าอีเมลของบริษัทมั่งมี**; เอกสารให้ลูกค้าที่จ่ายค่ามั่งมีใช้ **Stripe Invoice/Receipt** ตาม §6. ไม่สร้าง PDF/เลขเอกสารซ้ำและไม่ส่ง payment receipt คู่กันด้วย Postmark. Receipt ไม่ได้ยืนยัน Thai VAT tax invoice; B06 ยังมีเรื่องการคิดภาษี/ข้อมูลผู้ขายผู้ซื้อที่ต้องตกลง. Custom Thai tax/e-Tax implementation เป็นขอบเขตแยกหากต้องการภายหลัง ไม่ใช่ prerequisite ของ Postmark adapter. [กรมสรรพากร](https://www.rd.go.th/fileadmin/user_upload/eTax/manual_time_stamp_230167.pdf)

## 6. Stripe เป็นผู้จัดการ Invoice/Receipt ให้ลูกค้า

Stripe subscription สร้าง invoice อัตโนมัติ; successful payments/refunds มี receipt และเปิดส่งอีเมลอัตโนมัติได้ใน Customer emails. Test receipt ใช้ manual send ที่ provider รองรับ ไม่สมมติว่าการทดสอบจะส่งอีเมลเหมือน live. One-time Checkout ต้องพิจารณา invoice_creation แยกจาก subscription. [Stripe receipt docs](https://docs.stripe.com/receipts)

แอปใช้ `invoice_pdf` / `hosted_invoice_url` ของ invoice และ `receipt_url` ของ Charge ที่สัมพันธ์กับ payment/invoice ผ่าน API version ที่ pin; ค่าอาจเป็น null และ receipt link มีวงจรหมดอายุ/recovery. ตรวจ company permission ก่อนคืน provider link; ไม่เอา recipient email เป็น ownership. การเปิด link ที่แชร์ออกไปจะอยู่ภายใต้ Stripe ไม่ใช่ app session. [Invoice object](https://docs.stripe.com/api/invoices/object), [Charge object](https://docs.stripe.com/api/charges/object)

เปิด successful-payment/refund emails และ invoice notifications ตาม collection method ที่เลือก; ไม่เปลี่ยน charge_automatically เป็น send_invoice เพื่อส่งสำเนา. ถ้าต้องมีผู้รับ billing หลายคน docs ระบุการตั้งผ่าน Dashboard; อย่า invent API field สำหรับ CC. [Stripe customer emails](https://docs.stripe.com/invoicing/send-email)

## 7. ตัวอย่าง fixture ของมั่งมี — local synthetic เท่านั้น

ไม่มี credential/raw proof; ID/อีเมลเป็นข้อมูลสมมติ. ไม่ใช้ตัวอย่างนี้ส่งจริงโดยตรง. Tests ต้องแทนค่า From/ServerID/stream ด้วย fixture config และใช้ HTTP transport ที่ inject ใน L0.

```json
{
  "From": "Mangmee <system@example.com>",
  "To": "owner@example.com",
  "Subject": "Mangmee account verification",
  "TextBody": "Synthetic test content without a real credential.",
  "HtmlBody": "<p>Synthetic test content without a real credential.</p>",
  "MessageStream": "outbound",
  "TrackOpens": false,
  "TrackLinks": "None",
  "Tag": "account-claim",
  "Metadata": {"sendAttemptId": "11111111-1111-4111-8111-111111111111"}
}
```

```json
{
  "To": "owner@example.com",
  "SubmittedAt": "2026-09-11T08:00:00Z",
  "MessageID": "22222222-2222-4222-8222-222222222222",
  "ErrorCode": 0,
  "Message": "OK"
}
```

```json
{
  "RecordType": "Delivery",
  "ServerID": 424242,
  "MessageStream": "outbound",
  "MessageID": "22222222-2222-4222-8222-222222222222",
  "Recipient": "owner@example.com",
  "DeliveredAt": "2026-09-11T08:00:01Z",
  "Metadata": {"sendAttemptId": "11111111-1111-4111-8111-111111111111"}
}
```

ตัวอย่าง callback ไม่มี auth ใน body; harness ต้องใส่ Authorization จาก test-only Basic Auth config. Parsing JSON ผ่านได้ไม่ใช่การผ่าน Postmark schema/API/webhook acceptance.
