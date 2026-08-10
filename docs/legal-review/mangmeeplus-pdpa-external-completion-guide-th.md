# คู่มือปิดงานกฎหมายและ PDPA ก่อนเปิด Production — MangmeePlus v1

สถานะ: **ฉบับทำงานสำหรับผู้ประกอบการและส่งทนายตรวจ — ยังไม่ใช่ความเห็นทางกฎหมายหรือหลักฐานอนุมัติ**<br>
วันที่จัดทำ: 10 สิงหาคม 2569<br>
บริษัท: บริษัท มั่งมียั่งยืน จำกัด เลขทะเบียนนิติบุคคล 0105569135722<br>
ขอบเขตเปิดจริง: บัญชีและสิทธิ์พนักงาน, ใบเสร็จ/ค่าใช้จ่าย/การเบิก, รับรูปใบเสร็จและคำถามเรื่องบิลผ่าน LINE, OCR/AI เพื่ออ่านเอกสารและตอบแบบอ่านอย่างเดียว, และบันทึกความปลอดภัย<br>
ยังไม่เปิด: CRM ลูกค้าและการตลาด

> เป้าหมายของคู่มือนี้คือทำให้เอกสารทุกฉบับย้อนตรวจได้ว่า “ใครอนุมัติเอกสารเวอร์ชันใด จากข้อเท็จจริงและหลักฐานชุดใด” การมี template อย่างเดียวไม่ทำให้ผ่าน PDPA และห้ามเปลี่ยนสถานะเป็น VERIFIED หากยังไม่มีไฟล์จริง hash ผู้ตรวจ และวันที่ตรวจ

## สิ่งที่มีแล้ว และสิ่งที่ยังไม่ถือว่าจบ

- ผู้บริหารแจ้งว่ามีหนังสือรับรอง DBD และอีเมล `contact@mangmeeplus.com` รับและตอบกลับได้แล้ว
- ยังต้องเก็บไฟล์ DBD ฉบับจริง ผลตรวจ RefNo/ลายมือชื่อดิจิทัล หลักฐานทดสอบอีเมล ผู้รับผิดชอบหลัก/สำรอง และ SHA-256 ไว้ในที่เก็บหลักฐานของบริษัท
- DPO, RoPA, ผู้ประมวลผล/การโอนต่างประเทศ, retention/deletion และคำรับรองจากทนายยังไม่เสร็จจนกว่าจะมีหลักฐานและลายเซ็นตามขั้นตอนด้านล่าง

## แผนที่เอกสารแบบสั้น

1. **DBD + mailbox evidence** ยืนยันว่าใครเป็นบริษัทและเจ้าของข้อมูลติดต่อได้จริง
2. **RoPA** บอกว่าระบบเก็บและใช้ข้อมูลอะไร
3. **DPO assessment** ตัดสินว่ากฎหมายบังคับให้มี DPO หรือไม่
4. **Processor/cross-border register + vendor evidence** บอกว่าข้อมูลไปหาใครและประเทศใด
5. **Retention/deletion register + deletion drill** บอกว่าเก็บนานเท่าใดและลบได้จริงอย่างไร
6. **Privacy Notice + Terms + Data Deletion + Customer DPA** เป็นข้อความที่ใช้กับผู้ใช้และลูกค้า
7. **Thai Counsel Final Approval Memo** ให้ทนายรับรองเอกสารสุดท้ายด้วยเลขเวอร์ชันและ hash
8. **Immutable legal evidence bundle** รวมหลักฐานห้ากลุ่มเพื่อให้ระบบ deploy ตรวจแบบ fail-closed

## ขั้นตอนทำตามทีละข้อ

### ขั้นที่ 0 — สร้างที่เก็บหลักฐานส่วนตัวของบริษัท

ทำที่ใด: Google Drive/SharePoint ที่เป็นบัญชีบริษัทสำหรับงานระหว่างจัดเตรียม และ S3 compliance bucket สำหรับ bundle ที่ workflow production อ่าน

ให้สร้างโฟลเดอร์ดังนี้:

1. `01-company-identity`
2. `02-rights-mailbox`
3. `03-dpo-ropa`
4. `04-vendors-cross-border`
5. `05-retention-deletion`
6. `06-public-legal-documents`
7. `07-counsel-approval`
8. `08-release-bundle`

ตั้งเจ้าของเป็นบัญชีบริษัท ไม่ใช้ Gmail ส่วนตัว จำกัดสิทธิ์เฉพาะกรรมการ ผู้รับผิดชอบ privacy และทนาย ห้ามเก็บเอกสารมีลายเซ็น/เลขบัตร/สัญญาลับใน GitHub

เสร็จเมื่อ: มีเจ้าของโฟลเดอร์ ผู้ให้สิทธิ์สำรอง และรายการว่าใครเข้าถึงได้

### ขั้นที่ 1 — ปิดหลักฐานบริษัทจาก DBD

ทำที่ใด:

- [DBD e-Service](https://ebiz.dbd.go.th/eservice-web/index.xhtml)
- [ตรวจสอบ RefNo เอกสาร DBD](https://ebiz.dbd.go.th/eservice-inquiry/index.xhtml)

ทำดังนี้:

1. ดาวน์โหลดหนังสือรับรอง/หนังสือรับรองนิติบุคคลฉบับปัจจุบัน โดยใช้ฉบับอายุไม่เกิน 3 เดือนสำหรับงานที่ระบบ DPO ขอ
2. ตรวจ RefNo/QR และลายมือชื่อดิจิทัลตามช่องทาง DBD
3. บันทึก PDF ต้นฉบับ ผลตรวจ วันที่ออก วันหมดอายุ/วันทบทวน และชื่อผู้ตรวจ
4. ตรวจชื่อบริษัท เลขทะเบียน สถานะ ที่ตั้งสำนักงานใหญ่ รายชื่อกรรมการ และเงื่อนไขการลงนามให้ตรงกับเอกสาร public
5. คำนวณ SHA-256 ของไฟล์แต่ละฉบับและกรอกใน `operator-identity-contact-register.md`

เสร็จเมื่อ: ผู้ตรวจอีกคนหนึ่งยืนยันข้อมูลตรงกัน และมี reference + hash + วันที่ ไม่ใช่เพียงข้อความว่า “มีเอกสารแล้ว”

### ขั้นที่ 2 — ทำอีเมลรับคำขอสิทธิให้เป็นกระบวนการจริง

ทำที่ใด: ระบบอีเมลบริษัทและ [GPPC/GPPC Plus DSAR](https://gppc.pdpc.or.th/) หรือระบบ ticket ภายใน

ทำดังนี้:

1. กำหนดผู้รับผิดชอบหลักและสำรองของ `contact@mangmeeplus.com`
2. เปิด MFA และจำกัดสิทธิ์ผู้ดูแล
3. ทดสอบส่งจากอีเมลภายนอก รับเรื่อง ออกเลขเคส ตอบกลับ และปิดเคส
4. บันทึกวันรับ ผู้ขอ ขอบเขตคำขอ การยืนยันตัวตน ผู้ตัดสิน ผลดำเนินการ และวันตอบ
5. ตั้งเตือนแยก: คำขอเข้าถึง/สำเนา 30 วัน และคำขอลบที่เข้าเงื่อนไขไม่ชักช้าและไม่เกิน 90 วัน อย่าใช้ 30 วันกับทุกสิทธิแบบเหมารวม
6. เตรียมรองรับประกาศเรื่องสิทธิเข้าถึง/สำเนาฉบับใหม่ที่มีผล 14 กันยายน 2569

เสร็จเมื่อ: มีหลักฐาน rehearsal ตั้งแต่รับอีเมลจนถึงตอบสำเร็จ พร้อมเลขเคสและผู้รับผิดชอบสองคน

### ขั้นที่ 3 — สมัครและตั้งค่า GPPC Plus

ทำที่ใด:

- [สมัคร GPPC Plus](https://register-gppc-plus.pdpc.or.th/)
- [รายละเอียดเครื่องมือ GPPC Plus ปี 2569](https://gppc.pdpc.or.th/wsis-prizes-2026/)
- Help Desk: `support-gppc@pdpc.or.th`, 063-220-3430, 095-642-6610

เตรียม:

- หนังสือรับรอง DBD
- ข้อมูลกรรมการ/ผู้มีอำนาจ
- หนังสือหรือแบบยืนยันการสนับสนุนจากผู้บริหารตามที่หน้า register ขอ
- ชื่อผู้ดูแลระบบและอีเมลบริษัท

หลังเข้าได้แล้ว ให้ตั้ง Organization/Master Data ก่อน แล้วใช้เครื่องมือ ROPA, ROPA Template Generator, Data Flow Generator, DSAR, Privacy Notice Generator และ Legal Document Generator (DPA/DSA)

เสร็จเมื่อ: ส่งออกข้อมูลตั้งต้นและรายงาน draft ได้ และเก็บ export ลงโฟลเดอร์หลักฐานพร้อมวันที่

### ขั้นที่ 4 — กรอก RoPA จาก draft ของระบบ

ใช้ `docs/security-evidence/ropa-register-v1.md` เป็นข้อมูลตั้งต้น แล้วกรอกกิจกรรมอย่างน้อย:

1. บัญชีผู้ใช้และสิทธิ์พนักงาน
2. ใบเสร็จ ค่าใช้จ่าย และการเบิก
3. การรับข้อความ/รูปผ่าน LINE
4. OCR/AI และคำตอบเรื่องบิล
5. ความปลอดภัย audit log และ support
6. การยอมรับเอกสารกฎหมายและคำขอใช้สิทธิ

ทุกกิจกรรมต้องกรอกเจ้าของข้อมูล ฟิลด์จริง วัตถุประสงค์ ฐานกฎหมาย บทบาท controller/processor ผู้รับข้อมูล ประเทศ retention วิธีลบ และมาตรการความปลอดภัย ห้ามใช้คำว่า “ตามความเหมาะสม” แทนข้อมูลที่ค้นได้

เสร็จเมื่อ: Product/Engineering ตรวจว่า data flow ตรงระบบ, Privacy ตรวจบทบาท/ฐาน, และทนายตรวจความครบถ้วน

### ขั้นที่ 5 — ตัดสิน DPO

ใช้ `docs/security-evidence/dpo-necessity-assessment.md`

ทำดังนี้:

1. แนบ DBD ปัจจุบัน
2. ดึงจำนวน “บุคคลไม่ซ้ำ” ใน production แยกบทบาท controller และ processor; ไม่นับจำนวนบิล/ข้อความแทนจำนวนคน
3. ตรวจการติดตามอย่างสม่ำเสมอ กิจกรรมหลัก ขนาด/ระยะเวลา/พื้นที่ และข้อมูลอ่อนไหวมาตรา 26
4. ให้ทนายสรุปหนึ่งผล: `DPO REQUIRED`, `DPO NOT REQUIRED ON THE RECORDED EVIDENCE`, `VOLUNTARILY APPOINT DPO` หรือ `UNRESOLVED`
5. ให้กรรมการลงนามรับผลและวันทบทวน

ถ้าต้องมี DPO: ทำหนังสือแต่งตั้ง ตรวจ conflict of interest และขึ้นทะเบียนที่ [PDPC DPO Portal](https://dpo.pdpc.or.th/registration) โดยเตรียม DBD อายุไม่เกิน 3 เดือนและหนังสือแต่งตั้ง

ถ้าไม่ต้องมี: ไม่ต้องสร้าง “ใบรับรองไม่ต้องมี DPO” จากรัฐ ให้เก็บแบบประเมินที่ทนายและกรรมการลงนาม และแต่งตั้งผู้รับผิดชอบ privacy ภายในโดยไม่เรียกบุคคลนั้นว่า DPO

เสร็จเมื่อ: มี PDF ลงนาม hash และวันทบทวน; public Privacy Notice ใช้ถ้อยคำตรงผลจริง

### ขั้นที่ 6 — เก็บหลักฐานผู้ให้บริการทีละราย

ใช้ `docs/security-evidence/processor-cross-border-register.md` เป็นรายการกลาง สำหรับแต่ละรายให้เก็บ: ข้อตกลงหลัก/DPA, รายชื่อ subprocessor, ประเทศประมวลผล/จัดเก็บ/backup/support, retention/deletion, incident notice, security annex, account/plan และวันที่ดาวน์โหลด

#### AWS และ Amazon Bedrock

- บันทึก AWS account/organization, region และบริการที่เปิดจริง โดยไม่บันทึก secret
- ดาวน์โหลด/บันทึก [AWS Global DPA](https://docs.aws.amazon.com/whitepapers/latest/navigating-gdpr-compliance/aws-data-processing-addendum-dpa.html), [Thailand Data Privacy](https://aws.amazon.com/compliance/thailand-data-privacy/), [Bedrock data protection](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html) และ service/account settings ที่ใช้จริง
- แยกการใช้ region ปกติออกจาก global inference profile; global profile ต้องมีประเทศ/กลไกโอนและอนุมัติเฉพาะ

#### LINE

- Export channel/account configuration จาก LINE Developers/Official Account Manager โดยไม่เผย channel secret/access token
- เก็บ [LINE Thailand Privacy Policy](https://terms.line.me/line_genlctpp) และเงื่อนไขที่ใช้กับ Messaging API/OA ของบัญชีจริง
- ขอเอกสาร DPA/processor terms และข้อมูลประเทศ/retention จาก LINE หากหน้า public ไม่ตอบข้อเท็จจริงที่ต้องกรอก

#### Typhoon OCR

- เก็บ [Typhoon Privacy Notice](https://opentyphoon.ai/privacy), [Typhoon Terms](https://playground.opentyphoon.ai/tc.pdf), account/plan/model และการตั้งค่าจริง
- ติดต่อ SCB DataX/Typhoon เพื่อขอ DPA, retention/training/deletion, ประเทศ, support access และ subprocessor สำหรับ API account; หน้า privacy อย่างเดียวไม่แทน DPA

#### Cloudflare

- เก็บ [Cloudflare Customer DPA](https://www.cloudflare.com/cloudflare-customer-dpa/), enabled products, account plan, subprocessor list และ data-location settings

#### GitHub

- เก็บ [GitHub Customer Terms/DPA entry point](https://github.com/customer-terms), organization plan, Actions retention, installed apps และผู้ดูแลองค์กร

#### OpenAI หรือผู้ให้บริการอื่น

- กรอกเฉพาะเมื่อ production เรียกใช้จริง หากปิดอยู่ให้เก็บหลักฐาน config ว่าปิดและระบุ `NOT ENABLED` ไม่ต้องสร้าง DPA เทียม

เสร็จเมื่อ: ทุก vendor row มีเอกสารฉบับที่ใช้กับ account จริง ประเทศ retention/subprocessor และผู้อนุมัติ หรือถูกทำเครื่องหมาย HOLD อย่างชัดเจน

### ขั้นที่ 7 — ทำ DPA กับบริษัทลูกค้า pilot

ใช้ Legal Document Generator ใน GPPC Plus สร้าง Customer DPA แล้วให้ทนายปรับให้ตรงบทบาท:

- บริษัทลูกค้าเป็น controller สำหรับข้อมูลพนักงาน/ใบเสร็จในพื้นที่ทำงาน
- MangmeePlus เป็น processor ตามคำสั่งลูกค้าในส่วนนั้น
- ระบุคำสั่ง วัตถุประสงค์ ข้อมูล/เจ้าของข้อมูล security breach DSAR subprocessor cross-border return/deletion audit และการสิ้นสุดสัญญา
- แนบรายชื่อ subprocessor และตาราง retention/deletion ที่อนุมัติแล้ว

เสร็จเมื่อ: กรรมการ/ผู้รับมอบอำนาจของทั้งสองบริษัทลงนาม ไม่ใช่ให้ทนายลงนามแทนคู่สัญญา

### ขั้นที่ 8 — อนุมัติ retention และพิสูจน์การลบ

ใช้ `docs/security-evidence/data-retention-deletion-register-v1.md`

1. ยืนยันตัวเลขจากระบบจริง ไม่ใช้ข้อเสนอ Gemini ว่า log ทุกชนิดต้อง 1–2 ปี
2. แยก application log, traffic data ที่กฎหมายคอมพิวเตอร์ใช้บังคับ, audit record, AI record, LINE media, ใบเสร็จ/เอกสารบัญชี, backup และหลักฐาน DSAR
3. ให้ Accounting/Tax และทนายอนุมัติระยะเก็บเอกสารบัญชี/ภาษี
4. รัน deletion drill หนึ่งเคสใน UAT ครอบคลุม database, object และ object versions, queue/cache, AI/LINE/vendor propagation, backup restore/replay และข้อยกเว้น
5. ห้ามประกาศ “soft delete 30 วันแล้ว hard delete” จนกว่าจะมีระบบและหลักฐานจริง และห้ามใช้ช่วงรอเปลี่ยนใจเพื่อหน่วงคำขอลบที่ชอบด้วยกฎหมาย

เสร็จเมื่อ: มี register ลงนามและ deletion drill ที่บอกได้ว่าลบอะไรแล้ว อะไรยังอยู่ เพราะอะไร และจะหมดเมื่อใด

### ขั้นที่ 9 — ทำ legal copy ฉบับสุดท้าย

เอกสารต้องครอบคลุม scope จริงและใช้เลข version/effective date เดียวกัน:

1. Privacy Notice
2. Terms of Use
3. Data Deletion Notice/Procedure
4. Customer DPA และ Subprocessor Schedule

คำแนะนำ Gemini ที่รับได้: เพิ่ม scope พนักงาน/ใบเสร็จ/LINE/OCR/AI, แยกกรอบ 30/90 วัน, ชี้สิทธิใช้ output อย่างระมัดระวัง, และเข้มงวดอำนาจลบ workspace

คำแนะนำที่ยังไม่รับ: 30 วันสำหรับทุกสิทธิ, log 1–2 ปีแบบเหมารวม, บังคับตราประทับทุกบริษัท, 15/30 วันค้างชำระโดยยังไม่มีมติธุรกิจ/ระบบแจ้ง, ownership ของ AI output แบบเด็ดขาด, และ soft-delete buffer 30 วันที่ระบบยังพิสูจน์ไม่ได้

หาก v1 เคยถูกยอมรับใน production แล้ว ห้ามแก้ไฟล์ทับ ให้ออก v2, URL/hash ใหม่ และขอ acceptance/acknowledgement ใหม่

เสร็จเมื่อ: เอกสาร final ไม่มี placeholder, link ใช้งานได้, hash ตรงไฟล์ และระบบ clickwrap อ้างไฟล์เดียวกับที่ทนายตรวจ

### ขั้นที่ 10 — ส่งทนายและปิดลายเซ็น

ส่งทนายหนึ่งโฟลเดอร์ที่มี:

1. DBD + identity/mailbox evidence index
2. RoPA + data-flow diagram
3. DPO assessment พร้อม metric evidence
4. Processor/cross-border register พร้อม vendor contracts/DPA
5. Retention/deletion register + deletion drill
6. Privacy/Terms/Data Deletion ฉบับ final พร้อม version และ SHA-256
7. Customer DPA + subprocessor schedule
8. `Thai Counsel Final Approval Memo` ที่กรอกชื่อไฟล์/version/hash แล้ว

ทนายควรลงนาม Final Approval Memo หนึ่งฉบับที่อ้างไฟล์ exact hash ทั้งหมด แทนการเขียนอีเมลกว้าง ๆ ว่า “ใช้ได้” หากมีเงื่อนไข ให้ระบุเจ้าของงานและกำหนดเสร็จ

เสร็จเมื่อ: ไม่มีคำว่า approved ที่ไม่มีลายเซ็น หรืออ้างเอกสารคนละ version

### ขั้นที่ 11 — ลายเซ็นที่ต้องมี

| เอกสาร | คนที่ลงนาม/อนุมัติ | หมายเหตุ |
|---|---|---|
| DPO Necessity Assessment | ทนาย/ผู้ตรวจด้าน privacy + กรรมการบริษัท | หากต้องมี DPO ต้องมีหนังสือแต่งตั้งเพิ่ม |
| Processor/Cross-border Register Approval | ทนาย/Privacy + ผู้บริหารผู้รับความเสี่ยง | แนบ vendor evidence และกลไกมาตรา 28–29 |
| Retention/Deletion Register | ทนาย privacy + ที่ปรึกษาบัญชี/ภาษีตามส่วน + ผู้บริหาร | Security/Engineering รับรองข้อเท็จจริงระบบ ไม่แทนคำวินิจฉัยกฎหมาย |
| Thai Counsel Final Approval Memo | ทนายไทยผู้ตรวจ | อ้าง exact version/hash ของเอกสารทุกฉบับ |
| Management/Board Resolution สำหรับ global AI หรือความเสี่ยงพิเศษ | กรรมการ/บอร์ดตามอำนาจ | ทนายตรวจได้ แต่ผู้บริหารเป็นคนรับมติ |
| Customer DPA/Order Form | ผู้มีอำนาจของ MangmeePlus และบริษัทลูกค้า | ทนายไม่ลงนามแทนคู่สัญญา เว้นแต่มีอำนาจโดยชอบ |

Privacy Notice, Terms และ Data Deletion ไม่จำเป็นต้องให้ทนายเซ็นทุกหน้า หาก Final Approval Memo ระบุชื่อไฟล์ version SHA-256 และผลอนุมัติชัดเจน แต่การ initial ทุกหน้าหรือใช้ลายมือชื่อดิจิทัลก็ทำได้หากสำนักงานกฎหมายกำหนด

### ขั้นที่ 12 — ทำ immutable bundle และเปิด deploy

ทำตาม `docs/runbooks/legal-release-evidence-bundle.md`:

1. ใส่ reference/hash/reviewer/date ของหลักฐานจริงใน `docs/security-evidence/legal-release-evidence.json`
2. เปลี่ยน status เป็น VERIFIED เฉพาะเมื่อห้ากลุ่มครบ: operator identity, rights mailbox, DPO assessment, processor/cross-border register และ Thai counsel approval
3. สร้าง ZIP ที่มีไฟล์ตรง manifest เท่านั้น อัปโหลด S3 compliance bucket แบบ versioned/immutable
4. ตั้ง GitHub production variables ห้าตัวตาม runbook
5. รัน production preflight; ถ้า hash/version/สมาชิก ZIP ไม่ตรง workflow ต้องหยุด

เสร็จเมื่อ: preflight อ่าน bundle เวอร์ชันที่ pin ไว้และผ่านครบ โดยไม่ปิดหรือ bypass legal gate

## แหล่งทางการหลัก

- [พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 — รัฐสภา](https://odl.parliament.go.th/handle/20.500.13072/547319)
- [ประกาศ RoPA สำหรับผู้ประมวลผลข้อมูล — ราชกิจจานุเบกษา](https://ratchakitcha.soc.go.th/documents/17211325.pdf)
- [หลักเกณฑ์ DPO มาตรา 41(2) — ราชกิจจานุเบกษา](https://ratchakitcha.soc.go.th/documents/140D226S0000000001200.pdf)
- [หลักเกณฑ์การโอนข้อมูลมาตรา 28](https://ratchakitcha.soc.go.th/documents/14915.pdf) และ [มาตรา 29](https://ratchakitcha.soc.go.th/documents/14913.pdf)
- [GPPC Plus/เครื่องมือภาคเอกชน](https://gppc.pdpc.or.th/wsis-prizes-2026/)
