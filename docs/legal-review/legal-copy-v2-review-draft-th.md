# MangmeePlus Legal Copy v2 — Thai Counsel Review Draft

Status: **REVIEW DRAFT — v2 candidate artifacts generated, not approved or published; immutable v1 artifacts remain unchanged**<br>
Prepared: 2026-08-10<br>
Purpose: Exact proposed additions/replacements for Privacy Notice, Terms of Use and Data Deletion Notice based on the declared real production scope and the Gemini review.

If v1 has been accepted in production, never overwrite its files. The integrated Web source now renders candidate v2 Terms and Privacy artifacts. Counsel must review the exact candidate bytes and hashes below after every blocker is closed. Any later copy or effective-date change requires regenerating the unpublished candidate and its hashes before approval; after publication, use a new version rather than overwriting v2.

- Terms v2 candidate: `/legal/releases/v2/terms-th.html` — SHA-256 `09fe321666d7fd554544a7cf3c9a7e1c192e71a5ff47fb1c98bbc1c165d63281`
- Privacy v2 candidate: `/legal/releases/v2/privacy-th.html` — SHA-256 `5edcb642f8e9ca8e736804d0a732979228822f8183fa602afb4de5e372a67efd`
- Acceptance contract source — SHA-256 `6a4f4c3db12a452afee62f3560a10bc9bbe594d6d9053a9bcdd044f496bb66f8`
- Data Deletion remains a public procedure page, not a third clickwrap document. Counsel must review its current source together with the two artifacts.
- The candidate effective date is 10 August 2026. If actual publication starts later, update the date and regenerate every affected hash before counsel signs; do not backdate the release.

## Facts used for this draft

- Operator: บริษัท มั่งมียั่งยืน จำกัด, registration 0105569135722.
- Real initial scope: employee access; expense/receipt/reimbursement; LINE receipt images and read-only questions about company bills, receipt counts and reimbursement totals; OCR/AI assistance; security/audit/legal evidence.
- CRM customer/marketing functions are not enabled for this release.
- Generic account/workspace hard deletion, physical deletion of all S3 object versions and verified post-backup-restore deletion replay are not yet proven complete.
- DPO assessment and provider/cross-border evidence are still unresolved.

## 1. Privacy Notice — proposed v2 text

### 1.1 Replace the feature-neutral v1 scope with the real launch scope

> ประกาศนี้ครอบคลุมบริการที่เปิดใช้จริงในรุ่นนี้ ได้แก่ การจัดการบัญชีและสิทธิ์พนักงาน การบันทึกและตรวจสอบใบเสร็จ ค่าใช้จ่าย และการเบิก การรับรูปใบเสร็จและคำถามเกี่ยวกับข้อมูลบิลผ่าน LINE การใช้ OCR หรือ AI เพื่อช่วยอ่านเอกสารและตอบคำถามแบบอ่านอย่างเดียวตามสิทธิ์ของผู้ใช้ ตลอดจนการรักษาความปลอดภัย การสนับสนุน และหลักฐานการปฏิบัติตามกฎหมาย ฟังก์ชัน CRM สำหรับจัดการลูกค้าหรือการตลาดไม่อยู่ในขอบเขตนี้ เว้นแต่กิจการได้รับการเปิดใช้และได้รับเอกสารฉบับใหม่ที่ครอบคลุมแล้ว

### 1.2 Add concrete data categories

> สำหรับบริการที่เปิดใช้ในรุ่นนี้ ข้อมูลอาจรวมถึง (1) ข้อมูลพนักงานและการเข้าถึง เช่น ชื่อ อีเมล เบอร์โทร วันเกิด ที่อยู่ ข้อมูลอ้างอิงบัตรประชาชนหรือหนังสือเดินทาง บทบาท สิทธิ์ สาขา สถานะบัญชี และการเชื่อมโยงบัญชี LINE (2) ข้อมูลใบเสร็จ ค่าใช้จ่าย และการเบิก เช่น รูปภาพหรือ PDF ชื่อและข้อมูลภาษีของผู้ขาย เลขที่และวันที่เอกสาร รายการ ยอดเงิน ภาษีมูลค่าเพิ่ม ภาษีหัก ณ ที่จ่าย ช่องทางชำระเงิน บัญชีอ้างอิง หมายเหตุ สถานะการตรวจสอบ/อนุมัติ/จ่าย และผู้ที่เกี่ยวข้อง และ (3) ข้อมูลการใช้ LINE และระบบช่วยอ่านเอกสาร เช่น ตัวระบุ LINE ข้อความ คำบรรยายภาพ ไฟล์ เหตุการณ์รับส่งข้อความ คำถามเกี่ยวกับบิล ผลการสกัดข้อมูล ผลลัพธ์ที่ระบบตอบ และบันทึกตรวจสอบเท่าที่จำเป็น

> ข้อมูลของนิติบุคคลอาจไม่เป็นข้อมูลส่วนบุคคลโดยตัวมันเอง แต่ชื่อ เบอร์โทร ที่อยู่ ลายมือชื่อ เลขประจำตัวผู้เสียภาษี หรือข้อมูลบัญชีที่เกี่ยวข้องกับบุคคลธรรมดา กิจการเจ้าของคนเดียว หรือบุคคลที่อยู่ในเอกสารยังอาจเป็นข้อมูลส่วนบุคคลและได้รับความคุ้มครองตามกฎหมาย

Do not say that tax/address information is automatically public or outside PDPA.

### 1.3 Add LINE, OCR and AI processing

> เมื่อกิจการเปิดใช้การรับใบเสร็จหรือผู้ช่วยผ่าน LINE ข้อความ รูปภาพ เอกสาร และบริบทที่จำเป็นอาจถูกประมวลผลผ่านแพลตฟอร์ม LINE และผู้ให้บริการ OCR หรือ AI เพื่อจำแนกเอกสาร สกัดข้อมูลใบเสร็จ ขอข้อมูลที่ขาด และตอบคำถามที่ผู้ใช้มีสิทธิ์เข้าถึงเกี่ยวกับข้อมูลของกิจการ เช่น จำนวนใบเสร็จหรือยอดเบิก เราจำกัดบริบทและเครื่องมือตามบริษัท บทบาท และสิทธิ์ของผู้ใช้เท่าที่ระบบรองรับ ผลลัพธ์ดังกล่าวเป็นเครื่องมือช่วยตรวจสอบและไม่ใช่การอนุมัติ การบันทึกบัญชี การจ่ายเงิน การยื่นภาษี หรือคำวินิจฉัยทางกฎหมายโดยอัตโนมัติ ผู้มีสิทธิ์ต้องตรวจเอกสารต้นทางก่อนดำเนินการที่มีผล

Provider names, countries, subprocessor and transfer mechanism must be inserted only after the processor/cross-border register is approved. A category-level public recipient statement may be used if counsel confirms it is sufficiently transparent and the detailed list is linked and maintained.

### 1.4 Replace the generic rights timeline

> เราจะบันทึกคำขอตั้งแต่วันที่ได้รับและดำเนินการโดยไม่ชักช้า คำขอเข้าถึงหรือรับสำเนาที่เข้าเงื่อนไขจะดำเนินการไม่เกิน 30 วันนับแต่วันที่ได้รับคำขอ ส่วนคำขอลบ ทำลาย หรือทำให้ไม่สามารถระบุตัวบุคคลที่เข้าเงื่อนไขจะดำเนินการโดยไม่ชักช้าและไม่เกิน 90 วัน เว้นแต่กฎหมายกำหนดหรืออนุญาตไว้เป็นอย่างอื่น หากต้องใช้ข้อมูลเพิ่มเติมเพื่อยืนยันตัวตน อำนาจ หรือขอบเขต เราจะแจ้งโดยเร็วและจะไม่ใช้กระบวนการดังกล่าวเพื่อเลื่อนคำขอโดยไม่มีเหตุสมควร สิทธิประเภทอื่นจะดำเนินการภายในกรอบและเงื่อนไขของกฎหมายที่ใช้บังคับ

Operations must also implement the new 2026 access/copy subordinate rule before it takes effect on 14 September 2026.

### 1.5 DPO wording — choose only after the signed assessment

If DPO is required/voluntarily appointed:

> บริษัทได้แต่งตั้งเจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล (DPO) ติดต่อได้ที่ [DPO CHANNEL] ผู้ใช้ยังสามารถส่งคำขอทั่วไปได้ที่ contact@mangmeeplus.com

If the signed result is NOT REQUIRED:

> บริษัทได้ประเมินหน้าที่แต่งตั้ง DPO ตามมาตรา 41 จากหลักฐาน ณ วันที่ [DATE] และยังไม่อยู่ในกรณีที่กฎหมายกำหนดให้แต่งตั้ง DPO บริษัทได้กำหนดผู้รับผิดชอบงานความเป็นส่วนตัวและช่องทาง contact@mangmeeplus.com และจะประเมินใหม่เมื่อขนาด ประเภทข้อมูล หรือบริการเปลี่ยนแปลง

Until one outcome is signed, do not publish either claim and do not call the mailbox a DPO.

### 1.6 Retention wording — truthful while exact provider facts remain open

> เรากำหนดระยะเก็บแยกตามประเภทข้อมูล วัตถุประสงค์ สถานะสัญญา คำสั่งของกิจการ หน้าที่ทางบัญชี/ภาษี ความปลอดภัย และสิทธิเรียกร้อง ข้อความ LINE และบันทึก OCR หรือ AI เก็บตามเกณฑ์ที่ใช้บังคับกับข้อมูลแต่ละประเภท ส่วนข้อมูลที่ยืนยันและบันทึกเป็นใบเสร็จติดตามอายุของเอกสารธุรกิจ ไม่ใช้รอบเดียวกับประวัติ AI ทั้งหมด เมื่อคำขอลบเข้าเงื่อนไขและไม่มีเหตุให้เก็บต่อ สำเนาสำรองต้องอยู่ในกรอบดำเนินการโดยไม่ชักช้าและไม่เกิน 90 วัน ระหว่างนั้นต้องจำกัดการใช้และป้องกันการกู้คืนกลับมาใช้ตามปกติ

Exact log/provider periods remain in the internal draft schedule until Operations verifies the live facts and management/counsel approve them. Do not publish the CloudWatch example or a blanket one- or two-year log period in this release.

## 2. Terms of Use — proposed v2 text

### 2.1 Add the actual service boundary to clause 2

> บริการที่เปิดใช้ในรุ่นนี้ประกอบด้วยการจัดการบัญชีและสิทธิ์พนักงาน การบันทึกและตรวจสอบใบเสร็จ ค่าใช้จ่าย และการเบิก การรับรูปใบเสร็จจากพนักงานผ่าน LINE และการตอบคำถามแบบอ่านอย่างเดียวเกี่ยวกับบิล ใบเสร็จ และยอดเบิกตามสิทธิ์ของผู้ใช้ โดยอาจใช้ OCR หรือ AI ช่วยประมวลผล ฟังก์ชัน CRM สำหรับจัดการลูกค้าหรือการสื่อสารการตลาดไม่เป็นส่วนหนึ่งของขอบเขตนี้ เว้นแต่กิจการได้รับการเปิดใช้และได้รับเอกสารฉบับที่ครอบคลุมฟังก์ชันนั้นแล้ว

### 2.2 Add AI/OCR output and IP clarification to clause 4

> ในความสัมพันธ์ระหว่างคู่สัญญาและเท่าที่กฎหมายอนุญาต กิจการมีสิทธิใช้รายงาน ผลการสกัด และผลลัพธ์อัตโนมัติที่สร้างจากข้อมูลของกิจการเพื่อการดำเนินงานของกิจการ บริษัทไม่อ้างความเป็นเจ้าของในข้อมูลของกิจการเพียงเพราะข้อมูลนั้นผ่านการประมวลผล ทั้งนี้ สิทธิในซอฟต์แวร์ แบบจำลอง แม่แบบ วิธีการ และองค์ประกอบของบริการยังเป็นของบริษัทหรือผู้อนุญาต ผลลัพธ์อัตโนมัติอาจไม่เฉพาะตัว อาจคลาดเคลื่อน และอาจได้รับผลจากข้อมูลหรือสิทธิของบุคคลภายนอก ผู้ใช้ต้องตรวจเทียบกับเอกสารต้นทางก่อนอนุมัติ บันทึกบัญชี เบิกจ่าย จ่ายเงิน หรือดำเนินการด้านภาษี

Do not state that every AI output is exclusively owned or copyrightable by the customer.

### 2.3 Payment grace period — pending management choice, not inserted by default

If management chooses 15/30 and Operations can send notice and enforce the states, counsel may review:

> เว้นแต่ใบเสนอราคา คำสั่งซื้อ หรือสัญญาเฉพาะกำหนดต่างออกไป หากค้างชำระเกิน 15 วันหลังวันครบกำหนดและได้รับการแจ้งแล้ว บริษัทอาจระงับการเข้าถึง และหากค้างเกิน 30 วันอาจยกเลิกบริการ การระงับหรือยกเลิกไม่ทำให้ข้อมูลถูกลบโดยอัตโนมัติ และไม่ตัดหน้าที่เก็บหรือสิทธิขอลบตามกฎหมาย

Until the owner approves this commercial policy and the system/process supports notice and suspension, retain the current order-form-based wording and do not invent the numbers.

## 3. Data Deletion Notice — proposed v2 text

### 3.1 Add an exact whole-workspace authority rule

> คำขอลบพื้นที่ทำงานทั้งกิจการเป็นคำสั่งเลิกใช้บริการและจัดการข้อมูลระดับองค์กร ซึ่งต้องทำเป็นหนังสือและลงนามโดยกรรมการตามชื่อและเงื่อนไขการลงนามในหนังสือรับรองนิติบุคคลฉบับปัจจุบัน หรือผู้รับมอบอำนาจโดยชอบ ให้ประทับตราบริษัทเฉพาะเมื่อเงื่อนไขการลงนามหรือสัญญาที่ใช้บังคับกำหนด เราอาจขอหนังสือรับรอง หนังสือมอบอำนาจ หรือหลักฐานอื่นเท่าที่จำเป็น บัญชีผู้ดูแลระบบเพียงอย่างเดียวไม่ถือเป็นหลักฐานเพียงพอสำหรับการลบทั้งกิจการ การตรวจอำนาจระดับองค์กรนี้ไม่ใช้กีดกันคำขอสิทธิส่วนบุคคลที่มีขอบเขตแคบกว่า

### 3.2 Replace the proposed fixed 30-day recovery buffer with a truthful verification step

> ก่อนเริ่มการทำลายข้อมูล เราอาจระงับการเข้าถึงหรือพักการประมวลผลเฉพาะส่วนชั่วคราวเพื่อยืนยันตัวตนหรืออำนาจ ตรวจผลกระทบและข้อยกเว้น และจัดส่งข้อมูลที่ได้รับอนุญาต การพักดังกล่าวไม่ถือว่าลบเสร็จและจะไม่ใช้เพื่อเลื่อนคำขอที่ชอบด้วยกฎหมายโดยไม่มีเหตุสมควร เมื่อเริ่มการลบหรือทำลายแล้ว ข้อมูลบางส่วนอาจไม่สามารถกู้คืนได้

Do not publish a universal 30-day soft-delete/recovery promise until an approved technical design and deletion drill prove it. A recovery buffer for ordinary contract termination must remain separate from a valid PDPA erasure request.

### 3.3 Add the legal timelines

> เราจะบันทึกวันรับและดำเนินการโดยไม่ชักช้า สำหรับคำขอลบ ทำลาย หรือทำให้ไม่สามารถระบุตัวบุคคลที่เข้าเงื่อนไข เราจะดำเนินการให้แล้วเสร็จไม่เกิน 90 วันนับแต่วันที่ได้รับคำขอ เว้นแต่มีข้อยกเว้นหรือเหตุที่กฎหมายอนุญาตให้เก็บต่อ การขอข้อมูลยืนยันเพิ่มเติมจะทำเท่าที่จำเป็นและไม่ใช้เพื่อเลื่อนคำขอโดยไม่มีเหตุสมควร หากคำขอมีสิทธิเข้าถึงหรือรับสำเนารวมอยู่ด้วย เราจะจัดการส่วนนั้นภายในกรอบ 30 วันที่ใช้บังคับ

### 3.4 Define when deletion is actually complete

> การรับคำขอ การปิดบัญชี หรือการเปลี่ยนสถานะรายการในฐานข้อมูลไม่ถือว่าการลบเสร็จสมบูรณ์ เราจะแจ้งว่าเสร็จแล้วต่อเมื่อได้ตรวจสอบขอบเขตระบบหลัก ไฟล์และรุ่นของไฟล์ ผู้ประมวลผล/ผู้รับข้อมูล และสำเนาสำรองตามหลักฐานที่มี หากไม่มีเหตุให้เก็บต่อ ทุกส่วนยังอยู่ภายใต้กรอบไม่เกิน 90 วันเดียวกัน และข้อจำกัดของระบบหรือผู้ให้บริการไม่ขยายเวลาโดยอัตโนมัติ หากกฎหมายอนุญาตหรือกำหนดให้เก็บบางส่วนต่อ เราจะแจ้งประเภท เหตุผล ข้อจำกัดการใช้ และระยะหรือเหตุสิ้นสุดให้ชัดเจน

This wording must not be published as a statement of completed capability until Operations has an approved manual execution procedure and the release blocker for object versions/backup replay is closed. Until then, use it as an operational acceptance criterion and state that requests are handled case-by-case.

## 4. Gemini review disposition

| Gemini point | Decision | Reason/action |
|---|---|---|
| Four typography/OCR errors | Already fixed in current source/v1 artifact | Review appears to reference an older PDF/export; verify the new DOCX render |
| Publish DPO contact/status | Conditional | Use only after signed section 41 assessment/appointment |
| All rights in 30 days | Rejected as written | 30 days applies to access/copy; eligible erasure has a separate no-delay/90-day rule |
| Exact log period of one or two years | Rejected as written | Computer traffic data default is at least 90 days; up to two years is by official order; other logs require their own purpose/risk schedule |
| 15/30-day payment grace | Pending business decision | Not a PDPA requirement; needs order-form policy, notice and operational support |
| Customer owns every AI output | Narrowed | Give customer use rights and disclaim Mangmee ownership of customer data; preserve model/software rights and non-uniqueness/third-party limits |
| Authorized director and stamp for workspace deletion | Accepted with correction | Follow current DBD signing condition or valid power of attorney; stamp only when required/used; do not burden individual requests |
| Fixed 30-day soft delete before hard delete | Rejected for current publication | System cannot prove generic hard delete/object versions/backup replay; must not delay valid erasure |

## 5. Decisions counsel/management must close before integration

1. DPO outcome and exact public wording.
2. Provider list, legal roles, countries, subprocessors and sections 28–29 mechanism.
3. Final retention table by category, including traffic logs, accounting/tax evidence, LINE/Typhoon/AWS copies and backups.
4. Whether to adopt 15/30-day payment grace and how notice/suspension is operated.
5. Whether public copy names exact providers or links a maintained subprocessor schedule.
6. Closure evidence for physical object-version deletion and backup replay, or narrower truthful deletion wording approved for the manual procedure.
7. Exact v2 effective date, URLs and served-byte SHA-256 values.
