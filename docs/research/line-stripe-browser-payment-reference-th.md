# LINE / Stripe browser payment — developer reference

ตรวจ official documentation 2026-09-11 สำหรับ [UI spec](../specs/mangmee-line-web-billing-ui-spec-th.md). เอกสารนี้แยกสิ่งที่ provider ระบุจากข้อกำหนดของ Mangmee; ไม่ใช่หลักฐานทดสอบ SDK/account/device จริง.

| Official source | ข้อเท็จจริงที่เกี่ยว | ผลต่อแบบ Mangmee |
|---|---|---|
| [LINE LIFF API: init/openWindow/closeWindow](https://developers.line.biz/en/reference/liff/) | init ต้องอยู่ใน endpoint หรือ path ลูก; openWindow external=true เปิดภายนอกแต่ Universal/App Link behavior ต่างตาม LINE version; openWindow/closeWindow ไม่รับประกันใน external browser | วาง /billing ใต้ /link-page; ให้ user กดเปิด browser และมี fallback navigation/กลับ OA; ไม่อ้างการคืนแอปอัตโนมัติทุกเครื่อง |
| [LINE user data on server](https://developers.line.biz/en/docs/liff/using-user-profile/) | server ตรวจ ID/access token; ไม่เชื่อ decoded profile ที่ client ส่ง; access token ถูก revoke เมื่อปิด LIFF | reuse server verifier; token ไม่เป็น durable payment identity และไม่เก็บใน browser URL/attempt |
| [LIFF กับ external browser](https://developers.line.biz/en/docs/liff/differences-between-liff-browser-and-external-browser/) | LIFF ไม่รองรับ HTML download attribute ตามเอกสารปัจจุบัน | เปิด Stripe Invoice/PDF ใน browser; ไม่ตัดสินว่าดาวน์โหลดไม่ได้เพียงเพราะ download attribute ไม่ทำงาน |
| [Stripe hosted return](https://docs.stripe.com/payments/checkout/custom-success-page?payment-ui=stripe-hosted) | success_url ใส่ literal CHECKOUT_SESSION_ID placeholder แล้ว server lookup Session ได้ | return มี local attempt mapping + auth; URL/Session ID ไม่เป็นหลักฐาน paid หรือ login |
| [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted) | ต้องใช้ webhook เพราะลูกค้าอาจไม่กลับ landing page; fulfillment ต้องทน repeated/concurrent execution | webhook และ authorized status refresh ใช้ apply เดียวกัน; app จ่ายค่าสมาชิกยังต้องตรวจ invoice/period/payment ตาม P26 เพิ่ม |
| [Stripe Portal integration](https://docs.stripe.com/customer-management/integrate-customer-portal) | authenticate ก่อนสร้าง Portal session; URL ชั่วคราวและมี return URL; test/live config แยก | server map company Customer และ config, ออกลิงก์เมื่อกด, return แล้ว refresh; ไม่เก็บ Portal link ใน LINE หรือ marketing |
| [Stripe receipts](https://docs.stripe.com/receipts) / [Invoice object](https://docs.stripe.com/api/invoices/object) | ใช้ provider receipt และ finalized invoice URLs ตาม lifecycle | U09 แยก pending/available/refund; รายละเอียดอยู่ใน [Stripe document reference](stripe-developer-reference-th.md#stripe-customer-documents) |

**Engineering decisions ของ Mangmee (ไม่ใช่ข้อบังคับจาก Stripe/LINE):** ใช้ external browser เป็นทางหลักจาก LIFF เพื่อให้ app session/Checkout/3DS/return อยู่ใน browser เดียว; mint single-use handoff ณ ตอนใช้งานและ consume ที่ browser ปลายทาง; ไม่สมมติ cookie sharing. ไม่สร้าง LINE-specific Checkout backend หรือเลือก LINE Pay/PromptPay เพิ่ม. ยังต้องทดสอบ actual iOS/Android เพราะเอกสารไม่รับรอง integration ของเรา.

**ข้อจำกัดที่ต้องเปิดเผย:** auth recheck ป้องกันการออก hosted URL ใหม่ให้ old owner แต่ไม่รับรองว่าจะ revoke URL ของ Stripe ที่เคยออกแล้วทันทีได้. ปิดหน้า/กลับ LINE/ส่ง message สำเร็จไม่พิสูจน์ payment หรือ entitlement; ต้องใช้ backend. ใช้ [LB matrix](../plans/mangmee-line-web-billing-ui-plan-th.md) เป็น acceptance.
