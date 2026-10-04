# การ์ดตอบกลับ LINE Official OA

สถานะ: owner อนุญาตเชื่อม API และพัฒนาระบบตอบกลับ 2026-10-04; ยังไม่เปิดใช้งานจริง

## ผลลัพธ์และขอบเขต

ผู้ติดตาม MangmeePlus Official `@107ewccg` กด Social Media หรือติดต่อมั่งมีทีมใน rich menu เดิม แล้วได้รับการ์ด Flex ขนาด kilo ที่มีสามปุ่ม ช่องทางนี้ตอบข้อมูลสาธารณะและลิงก์เท่านั้น ไม่เข้า AI, OCR, บัญชีบริษัท, identity binding หรือ support inbox ของ OA ระบบ `@458wpnio`.

- Contact: ตัดข้อความอีเมล/โทรที่ซ้ำใน body; แสดงอีเมลบนปุ่มคัดลอก `contact@mangmeeplus.com`, ปุ่มโทร `tel:0982565628`, และเว็บไซต์ `https://official.mangmeeplus.com/`. ใช้พื้นครีม `#F7F4E8`, หัวข้อเขียวเข้ม `#164D35`, และปุ่มทองอ่อน/เขียวใบไม้/ฟ้าอมเขียวเพื่อเข้าคู่ rich menu. Owner รับรูปแบบกะทัดรัดแล้วและขอเพิ่มน้ำหนักสี; ไม่กลับไปใช้หัวข้อทึบ/ปุ่มเขียวทั้งสาม
- Social: สามพื้นที่กดสำหรับ Instagram, Facebook และ TikTok; คง URLs และ query parameters ที่เจ้าของให้มา มีไอคอน PNG ของแพลตฟอร์มบนพื้นชมพู/ฟ้า/มิ้นต์ที่มีน้ำหนักและพื้นครีมร่วมกับ Contact. ชื่อแอปอ่านได้โดยไม่พึ่งสี; TikTok ดำตัดกับมิ้นต์และ Facebook น้ำเงินตัดกับฟ้า
- อีเมลลงทะเบียนนักพัฒนาเป็น `admin_mangmee@mangmeeplus.com`; ไม่เปลี่ยนอีเมลติดต่อสาธารณะ. LINE Developers profile แสดง verified; owner ยอมรับ Developer registration และ Messaging API terms เอง. Provider `MangmeePlus` ID `2005600429`; channel `2011854342` ของ Official OA เปิดใช้แล้ว
- วิธีใช้งาน, Package, Greeting และ manual chat ใช้ native Manager เดิม. ปิดเฉพาะ native auto replies ของ Social/Contact หลัง webhook ใช้งานได้แล้ว เพื่อไม่ตอบซ้ำ

## Contract และขอบเขตความปลอดภัย

`POST /v1/line/official/webhook` เป็น public endpoint ซึ่งตรวจ HMAC-SHA256 ของ raw body ด้วย secret ของ Official OA ก่อนอ่าน events. ใช้ secret/token ชุดเฉพาะของช่องนี้เท่านั้น; ไม่มี fallback ไป shared system LINE credentials.

Configuration: `LINE_OFFICIAL_REPLY_ENABLED` default false, `LINE_OFFICIAL_CHANNEL_SECRET`, `LINE_OFFICIAL_CHANNEL_ACCESS_TOKEN`. เปิด flag ได้เมื่อมีทั้งสอง credential. ตรวจ bot info ว่า token เป็น `@107ewccg` ก่อน provision/เปิด webhook; ไม่พิมพ์ credential ใน logs, docs หรือ Git.

Runtime publication: owner explicitly selected “แยกเฉพาะการ์ด OA” on 2026-10-04 after reviewing that main would ship 891 other changed files and 10 migrations. Publish an independent marketing Lambda Function URL, with immutable staging/live aliases to the same reviewed artifact. This is an Official OA service release, not an ERP/Kamal release; no ERP container, database, source, customer gate or UAT host is changed. Local validation replaces GitHub CI under the owner's instruction; record that exception and do not claim GitHub CI passed.

The standalone bundle reuses the existing TypeScript keyword mapper, raw-body signature verifier, card JSON and three PNGs. No new dependency or package.json change. It handles only GET of the three exact icon paths and POST /webhook. Staging verifies HMAC and payload handling without sending replies; live replies use the dedicated token. Runtime trust is restricted to the fixed account/region, two exact Official Secrets Manager resources, and its own log group. The function has a 10-second timeout and capped concurrency. It has no ERP, database, worker, AI, VPC, IAM-write or system-OA access. Public URLs use NONE transport auth and explicit URL-only invoke permissions; POST still requires LINE HMAC.

Credentials remain outside Git and go only to Secrets Manager `watchdog-bms/production/line-official/channel-secret` and `channel-access-token`. Use an existing non-root deployment/platform session; do not use root or broaden existing ERP roles to publish this service. Deployment requires a reviewed change set, exact immutable source/bundle hashes, staging HMAC/icon/schema/provider proof, live-version equality and provider endpoint readback. Retain per-operation evidence and sign acceptance using the existing approved KMS signing authority when available. Record ERP UAT/READY/PROD workflow run IDs as NOT_DISPATCHED. Native Social/Contact transition happens only after live provider verification; owner phone acceptance is recorded separately and never fabricated.

The API route and tracked Kamal flag from PR999 are retained as future full-ERP integration, not deployed by this isolated service publication.

รับเฉพาะ message/text จาก source/user ที่มี reply token. คำ Social Media/โซเชียล/ติดตามน้องมั่งมี ส่ง Social; ติดต่อมั่งมีทีม/ติดต่อเรา/Contact Us ส่ง Contact. คำอื่น, follow, image, group และ room ตอบ HTTP 200 โดยไม่ส่งข้อความ เพื่อให้เจ้าหน้าที่และ native replies ทำงานตามเดิม. Empty signed webhook verification ตอบ 200. Signature ผิด/หายหรือ route ปิดต้องไม่ส่งข้อความ.

Reply ใช้ LINE single-use reply token โดยตรงและ timeout จำกัด ไม่มีการบันทึก LINE user หรือข้อความใน DB. ไม่ retry push ไม่สร้าง conversation. Provider/network failure ต้องปรากฏเป็น structured error ที่ไม่เปิดเผย token หรือ payload.

PNG assets ใช้ HTTPS Function URL ของบริการ OA แยกและ path `/assets/line/official-oa-{instagram,facebook,tiktok}.png`. ก่อนใช้จริงต้องเผยแพร่และตรวจ HTTP 200/image/png; URLs ใน draft ยังไม่ใช่หลักฐานว่าเผยแพร่แล้ว.

## Acceptance

- Signed known keywords ส่งเพียงหนึ่ง Flex ที่มีสาม action ถูกปลายทาง
- Signature จาก OA ระบบต้องไม่ผ่าน route Official และข้อความที่ไม่อยู่ใน scope ไม่เรียก outbound API
- Contact ไม่มีข้อมูลซ้ำใน body; ปุ่ม email แสดง address และคัดลอกได้ โทรและเว็บไซต์เปิดปลายทางเดิม
- Social กระชับ มี logo ตัดกับพื้น ไม่มีดำกลืนกัน และทั้งสามลิงก์ถูกต้อง
- Provider validation และ owner phone acceptance ผ่านก่อนปิด native replies ของสองคำนี้
- การขึ้น ERP UAT/Production ต้องตาม `docs/runbooks/uat-production-v2-deployment.md`; OA แยกใช้ staged immutable artifact/provider proof และ signed isolated-service ledger ข้างต้น. Local tests หรือ Manager API activation ไม่ถือว่าระบบ live สำเร็จ
