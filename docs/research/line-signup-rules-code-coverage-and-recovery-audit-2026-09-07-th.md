# LINE signup: กฎที่เสนอมีโค้ดและทางออกครบหรือยัง

วันที่ตรวจ: 2026-09-07
สถานะ: ตรวจโค้ดและจำลองความขัดข้องแล้ว ยังไม่แก้ application code
ฐานโค้ด: local develop `d03c1761932d19abc019afaaf10a8f75674ff0b4` หลัง PR475; source ที่ทดสอบ/ส่งเข้า develop และ main คือ `05d456b16e9d2968d5275a129f8dba3f2850b800`

ตรวจเทียบกับ [กฎธุรกิจ R01–R14](line-signup-business-rules-and-support-value-2026-09-07-th.md) โดยแยกพฤติกรรมปัจจุบันจากข้อเสนอ ไม่ได้ตรวจ AWS/LINE live และไม่ใช่การรับรองว่า prod มีโค้ดหรือ config ชุดนี้แล้ว

## ผลที่ตอบ Owner ได้

ยังรับรองว่าเดินจบครบทุกกฎไม่ได้ มีโค้ดฐานเรื่องสมัคร/อนุมัติ/บัญชี/สาขา/คิว support อยู่จริง แต่กฎใหม่เรื่องกลับร้านเดิม แยกสิทธิ์ทดลอง และคลี่คลายอีเมลซ้ำยังไม่ครบ อีกทั้งพบช่องว่างสถานะและ recovery ของเส้นทาง LINE ปัจจุบันด้วย

สิ่งที่ต้องนับว่า “รองรับแล้ว” ต้องมีทั้งการตัดสินใจที่ถูกต้อง การบันทึกผล หน้าจอที่บอกสถานะจริง ทางทำต่อของลูกค้า/เจ้าหน้าที่ และหลักฐานทดสอบเมื่อระบบสะดุด มีเพียง endpoint หรือข้อความ “ติดต่อเจ้าหน้าที่” ยังไม่พอ

## 1. ช่องว่างที่ยืนยันจากโค้ดและการทดลอง

### G01 — คำขอ LINE ค้างก่อนเข้าคิว เมื่อขั้นตอนหลังบันทึกคำขอล้มเหลว

ลำดับปัจจุบันใน `apps/api/src/modules/external-signup/application/submit-line-signup.use-case.ts:105`:

1. บันทึกคำขอและ evidence ผ่าน `receiveNormalized()` ซึ่ง commit transaction ของตัวเองแล้ว
2. บันทึกตัวนับ rate limit
3. เปลี่ยนเป็น `VALIDATED`
4. ค้นอีเมลซ้ำ บันทึก audit ตัดสิน auto/manual และจึงเข้าขั้น provision หรือ `PENDING_REVIEW`

ทดลองใช้ submit/core จริงผ่าน integration harness เดิม แล้ว inject failure สองตำแหน่ง:

| ตำแหน่งที่ล้ม | ผลที่ยังอยู่ใน store | ผลต่อทางทำต่อ |
| --- | --- | --- |
| ตัวนับหลังสร้างคำขอ | `RECEIVED` | ไม่แจ้งแอดมิน ไม่ provision ไม่อยู่ในตัวกรองทุกแท็บคิว; APPROVE ตอบ `invalid_signup_decision:RECEIVED` |
| ค้นอีเมลหลัง validate | `VALIDATED` | ไม่แจ้งแอดมิน ไม่ provision ไม่อยู่ในตัวกรองทุกแท็บคิว; APPROVE ตอบ `invalid_signup_decision:VALIDATED` |

ทั้งสองสถานะอยู่ใน partial unique index ที่กันคำขอเปิดค้างของ LINE เดียวกัน (`apps/api/prisma/migrations/20260904120000_line_first_signup/migration.sql:37`) จึงมีเงื่อนไขที่จะกันการสมัครใหม่ ขณะที่หน้า LIFF แสดงเป็นรอตรวจสอบ ไม่มีการ resume intake ใน submit LINE แบบเดียวกับเว็บ

หลักฐานคิว: `signup-admin-queue.use-case.ts:34`, `:58`, `:354`, `:668`; เครื่องมือทดลองเรียก `list()` เพื่อจับ predicate ของทุกแท็บ และเรียก `decide(APPROVE)` จริง ไม่ได้เขียนรายการสถานะจำลองแทน use case

มี retention ลบ `RECEIVED` ที่ไม่มี company หลัง 7 วัน (`signup-claim-email.service.ts:45`, `:300`) แต่การลบตามอายุไม่ได้ทำให้คำขอสำเร็จหรือช่วยลูกค้าทันเวลา ไม่พบ sweep สำหรับ `VALIDATED` ในเส้นทางที่ตรวจ การเปลี่ยนสถานะด้วยงานซ่อมเฉพาะกิจยังไม่ใช่ทาง support ผ่านหน้าปกติ

**แนวทาง:** ใช้รูปแบบ resume คำขอเดิมของ Flow B ที่ `submit-company-signup.use-case.ts:38` เป็นฐาน ปรับให้ตรงการยืนยัน LINE/consent/repeat-trial ของ LINE; ป้องกัน race และไม่สร้าง external signup ID ใหม่เมื่อกำลังกู้ผลเดิม ให้ intake ที่ค้างมองเห็นและทำต่อได้ด้วย action ที่มีสิทธิ์/audit ตรวจอีกครั้งก่อน provision ไม่เปิดให้ APPROVE ข้าม validation ตรง ๆ

ระดับหลักฐาน: การ inject failure ใน in-memory harness ไม่ใช่เหตุขัดข้องจริงใน Redis/PostgreSQL หรือ prod; การคงสถานะ/การปฏิเสธของ admin ถูก reproduce แล้ว ส่วน DB fence ยืนยันจาก migration และ domain source

### G02 — หน้า LIFF ไม่แสดงผลตามสถานะที่ backend ส่งจริง

รัน `LIFF_PAGE_SCRIPT` จริงใน `node:vm` โดยใช้ fake DOM/fetch ของ test เดิม จำลองได้ 4 กรณี:

| คำตอบ API | สิ่งที่หน้าปัจจุบันแสดง | ผลกับลูกค้า |
| --- | --- | --- |
| POST202 `COMPLETED` | หน้ารับคำขอและ “ทีมงานกำลังตรวจสอบ” | เปิดร้านแล้วแต่ลูกค้าเข้าใจว่ายังใช้ไม่ได้ |
| เปิดหน้าใหม่ GET `COMPLETED` | ฟอร์มสมัครใหม่ | ไม่มีทางกลับร้านเดิมจากสถานะนี้ในหน้าสมัคร อาจส่งคำขอเพิ่มร้านโดยไม่ได้ตั้งใจ |
| เปิดหน้า GET `PROVISIONING_FAILED` | “ทีมงานกำลังตรวจสอบ” แบบเดียวกับ manual review | ไม่บอกว่าเปิดร้านติดปัญหาหรือใครกำลังแก้ |
| POST409 pending แล้ว GET พบ `COMPLETED` | หน้ารอตรวจสอบ | การอ่านผลเดิมสำเร็จแล้ว แต่ UI ยังให้ลูกค้ารอ |

หลักฐาน: `apps/api/src/common/security/liff-page.security.ts:165`, `:542`, `:553`, `:608`, `:619` ไม่มีการแยก accepted.state ในข้อความสำเร็จ; backend AUTO_FREE ส่ง `COMPLETED` ได้จริงที่ `submit-line-signup.use-case.ts:169–189`

การเปิดฟอร์มใหม่รองรับการขอร้านเพิ่มใน flow เดิม ประเด็นของกฎใหม่คือยังไม่แยกเจตนากลับมาดูผล/เข้าร้านเดิมออกจากเปิดร้านเพิ่ม จึงจัดเป็นช่องว่างของ intent/recovery ไม่ใช่ข้อพิสูจน์ว่าทุกการเปิดหน้านี้ผิด การเปิดฟอร์มใหม่ไม่ได้พิสูจน์ว่าเกิดร้าน/trial ซ้ำอัตโนมัติ: repeat-owner และอีเมลซ้ำยังส่ง manual review แต่คำขอใหม่ที่ไม่ตรงเจตนาลูกค้ายังสร้างภาระและความสับสนได้

มีข้อความแจ้งพร้อมใช้ทาง LINE แยกต่างหากอยู่แล้ว ผลทดลองนี้ตรวจเฉพาะ LIFF; ความสำเร็จของข้อความอีกช่องทางไม่ได้ทำให้สถานะในหน้าสมัครถูกต้อง

**แนวทาง:** ให้สถานะจาก server เป็นตัวเลือกหน้าและปุ่มหลัง submit/reopen/retry ทุกจุด โดยใช้ตัวแสดงผลร่วมกันใน script เดิม: สำเร็จ → เข้าร้าน; รอเจ้าหน้าที่ → เลขคำขอ/ขั้นต่อไป; กำลังทำ → อ่านสถานะเดิม; ทำไม่สำเร็จ → แจ้งว่าเก็บอะไรแล้ว/ใครทำต่อได้; ไม่ตัดสินว่าล้มเหลวเพียงเพราะ response หาย เสนอ “เปิดร้านเพิ่ม” เป็นเจตนาที่ลูกค้าเลือกชัดเจน

### G03 — อนุมัติคำขออีเมลซ้ำยังหมายถึงเปิดร้านใหม่

`apps/web/src/features/system-signup-requests/SignupQueuePage.tsx:262` ส่ง `action: APPROVE` และ backend ส่งต่อ provisioning; `provision-signup.use-case.ts:221` สร้าง company พร้อม `SIGNUP_TRIAL_TIER` และ `TRIAL_DAYS`

ยังไม่มีผลการตัดสินใจ “กลับร้านเดิม / กู้บัญชีเดิม / เพิ่มร้านแต่ไม่เพิ่ม trial / รอหลักฐานทั้งหมด” ตาม brainstorm การมี hint ให้ตรวจอีเมลเก่ายังไม่ได้บังคับว่าต้องจบการตรวจด้วยทางใดก่อนอนุมัติ

หลักฐาน PostgreSQL จากรอบส่ง PR เดิม 24/24 รวมเคส manual approve พิสูจน์ว่าบัญชีคู่แข่งไม่ถูกยึดและ retry ไม่สร้างบริษัทซ้ำใน request เดิม แต่ผลนั้นคือร้านใหม่ ไม่ใช่ recovery ร้านเก่า

**แนวทาง:** เพิ่มผลการตัดสินใจเฉพาะที่จำเป็นบนคิวเดิมพร้อม preview ผลต่อบัญชี/ร้าน/สิทธิ์ทดลอง บังคับ proof/permission ของแต่ละ action ใน backend แยกการอนุญาตเข้าร้านเดิมออกจากการให้ trial เพิ่ม

### G04 — ช่องตอบ support สำหรับผู้ยังไม่มีบริษัทไม่ครบ

มี `LineSupportRequest` เก็บคนยังไม่ผูกบริษัทได้จริง มี inbox แสดงข้อความแรก/ล่าสุดและมีปุ่ม “ตอบแล้ว” แต่:

- `support-requests.logic.ts:122`: ถ้ามีบริษัท พาเข้ากล่องข้อความของบริษัท; ถ้ามีแต่ signupRequestId พาเข้าคิวสมัครทั่วไป; ถ้าไม่มีทั้งคู่ คืน null
- เส้นทางส่งข้อความ `send-partner-line-message.use-case.ts:37` ต้องมี companyId ที่มีอยู่ และ support request ต้องตรง companyId นั้น
- `support-request-admin.use-case.ts:124` กด “ตอบแล้ว” เปลี่ยนสถานะและ audit ได้ โดยไม่ได้ยืนยันว่าลูกค้าเข้าใช้งานหรือปัญหาได้รับการแก้แล้ว

จึงมีทางมนุษย์ช่วยจากข้อมูลติดต่อ/โทรศัพท์ แต่ยังไม่มีเส้นทางตอบรายคนจาก inbox เดิมครบทุกประเภทผู้สมัคร ห้ามเรียกว่ามี end-to-end support สำหรับ no-company แล้ว

**แนวทาง:** ตอบผ่าน requestId ที่ผูก LINE ผู้ขอไว้ฝั่ง server และตรวจสิทธิ์ operator โดยไม่ต้องสร้างร้านเพื่อให้ส่งข้อความได้ รักษาขอบเขตข้อมูลส่วนบุคคล/tenant และไม่ให้หน้าเว็บส่ง raw LINE ID ตามใจ เพิ่มผลการแก้ปัญหาแยกจาก “ตอบแล้ว”; หากส่งไม่สำเร็จต้องเห็นและ retry ได้

คิว support ปัจจุบันยัง `take: 200`, เรียงข้อความล่าสุดก่อน และไม่มี cursor/ผู้รับผิดชอบเคส (`support-request-admin.use-case.ts:51`; schema `LineSupportRequest`) จึงยังรับรองเป้าหมายเวลารับเรื่องที่เสนอไม่ได้ หากเกินหน้าที่แสดงมีโอกาสงานเก่าถูกกลบ ต้องมี pagination/การหยิบงานและการส่งต่อที่ตรวจได้ก่อนรับรอง SLA

### G05 — บางกฎใหม่ยังต่างจากโค้ดที่ merge แล้วโดยตรง

`submit-line-signup.use-case.ts:206` นับ User.email, username แบบอีเมล, Company.email และคำขอเก่าทุกสถานะ โดยไม่ยกเว้นอีเมลบัญชีตนเอง และยกเว้นเพียง request ปัจจุบัน

- R07 “อีเมลของบัญชีตนเองไม่ทำให้รอ manual โดยลำพัง” ยังไม่ได้ทำ
- R10 “ซ้ำแค่คำขอเก่าที่จบโดยไม่มีร้าน ไม่ควร hold ตลอดไป” ยังไม่ได้ทำ
- R08/R09 มีการกันยึดบัญชี แต่ยังไม่มีชุดแก้เมล/พิสูจน์บัญชี/shared contact ที่นำลูกค้าและเจ้าหน้าที่ไปถึงผลลัพธ์ชัดเจนทุกกรณี

**แนวทาง:** ทำ decision table ก่อนเขียนเงื่อนไขใหม่ แยกข้อมูลติดต่อออกจาก proof บัญชีและสิทธิ์ร้าน; ใช้ policy ที่ยืนยันแล้วระบุเหตุผล review และทางแก้ทั้งหมดในครั้งเดียว ไม่เปิดเผยว่าบัญชีอื่นของใครมีอยู่ให้ผู้ที่ยังไม่ได้พิสูจน์สิทธิ์

## 2. เทียบกฎทั้ง 14 ข้อ

“บางส่วน” หมายถึงมีโค้ดฐานที่ใช้ต่อได้ แต่ยังรับรองการเดินจบตามกฎใหม่ไม่ได้; “มีทางเดิม” ไม่ได้หมายถึงทดสอบ browser/production ใหม่ครบทุกเส้นทางในรอบนี้

| กฎ | ความพร้อมจากโค้ด | สิ่งที่ยังขาด / ขอบเขตหลักฐาน |
| --- | --- | --- |
| R01 คำขอเดิม/ผลตอบหาย | บางส่วน | Provision เดิมมี fence/retry; LINE intake และ completed UI ยังมี G01/G02 การ submit LINE สร้าง external ID ใหม่ต่อครั้ง |
| R02 บัญชีหรือ identity ถูกระงับ | มี guard; recovery บางส่วน | `resolveLineIdentity()` ปฏิเสธ DISABLED identity และ user ไม่ ACTIVE พร้อมข้อความติดต่อเจ้าหน้าที่; proof/อำนาจของขั้นตอนกู้ทั้งหมดต้องกำหนดก่อนทำ |
| R03 กลับร้านเดิมตามสิทธิ์ | มีทางเดิม; การเชื่อมกับ signup ยังไม่ครบ | `exchange-liff-session.use-case.ts` ตรวจ identity และ membership จริง มี picker/เข้า dashboard; G02 ยังไม่พาหน้าสมัครที่สำเร็จกลับทางนี้ |
| R04 เพิ่มสาขาในร้านเดิม | มีทางเดิม | `create-branch.use-case.ts` ตรวจ permission/plan limit และสร้างภายใต้ company เดิม; `BranchSettingsPage.tsx` มี form/error; Thai mapping ของ branch code ซ้ำมีอยู่ ไม่ให้ trial ใหม่จาก action นี้ |
| R05 เพิ่มร้าน แยก trial | บางส่วน | Attach proven LINE user ได้ แต่ provision ใช้ trial preset และ admin ยังไม่มีการตัดสินสิทธิ์ทดลองแยก (G03) |
| R06 รายใหม่ auto15 ไม่รอรหัส/เมล | Backend มี; หน้าจอยังไม่ครบ | AUTO_FREE มี guard/cap/operator; prior acceptance ครอบคลุม owner email/first receipt; G01/G02 ยังขัดกับการเดินจบโดยไม่งง |
| R07 อีเมลตนเอง | ยังต่างจากข้อเสนอ | Duplicate query นับตนเอง; ต้องคง repeat-trial เป็นเหตุแยก ไม่ยกเว้นทุกอย่างเพียงเพราะ email เดียวกัน |
| R08 อีเมลคนอื่น | มีการกัน takeover; การคลี่คลายยังไม่ครบ | ปัจจุบันรอ manual และ approve สร้างร้านใหม่ได้; ยังไม่มี flow แก้เมล/พิสูจน์บัญชีเดิมครบตามข้อเสนอ |
| R09 shared contact | มี data foundation; workflow ยังไม่ครบ | Company contact ซ้ำและ separate user เกิดได้; ยังไม่มีผลการ review/การแจ้งชัดว่าอีเมลล็อกอินใช้ไม่ได้/ทางเชิญที่เชื่อมจากเคสนี้ครบ |
| R10 ประวัติคำขอเก่า | ยังต่างจากข้อเสนอ | นับทุกสถานะเป็น email-used; ต้องแยกกรณีไม่มีร้านจากรายการที่ provision แล้ว และจาก security block |
| R11 ชนคำขอจาก LINE อื่น | Guard มี; resolution บางส่วน | หลักฐาน PG เดิมกันทั้งคู่ auto ผ่าน commit barrier; ยังขาด action คลี่คลาย/แก้ข้อมูลและข้อความขั้นต่อไป |
| R12 ร้านหมด trial | มีทางเดิม; recovery integration บางส่วน | `package-change-request.use-case.ts` ให้ OWNER ของ ACTIVE/DISABLED ขอแพ็กเกจ มี idempotent OPEN request; ไม่ reset จาก action นี้ แต่ recovery คนเปลี่ยน LINE ต้องแยกจาก new-shop approve |
| R13 หายไป/กลับมาทำต่อ | บางส่วน | คำขอเก็บจริง และเปิดดู pending ได้; support เก็บข้อความแรก/ล่าสุด แต่ G01/G02 และหน้า resume/edit/proof-expiry ยังไม่ครบ ห้ามรับรองว่า draft ที่ยังไม่ส่งคงอยู่ข้ามการปิดหน้า |
| R14 ร้านซ้ำมีรายการจริง | ไม่มี automatic financial merge ในทางที่ตรวจ; การแก้เคสยังไม่ครบ | Account merge มีขอบเขตย้าย membership/identity ต้องผ่าน proof; ไม่ใช่รวมบริษัทหรือบิล ไม่มี business-record reconciliation workflow ในข้อเสนอนี้แล้ว |

Account merge ใช้ต่อได้เฉพาะบริบทที่พิสูจน์บัญชีและ LINE ผ่าน authenticated web OAuth: `line-link-oauth.use-case.ts:49`, `account-merge.use-case.ts` และ `SignupWelcomePage.tsx:94` มี preview/commit/ข้อผิดพลาดภาษาไทยจริง เส้นทาง LIFF/QR ที่ conflict ไม่ได้ออก merge ticket แบบนี้ จึงไม่ควรอ้างว่าผู้สมัครอีเมลซ้ำทุกคนกดเข้าทางเดิมนี้ได้ทันที

## 3. เงื่อนไขยอมรับก่อนเรียกว่า “ไม่ตัน”

1. ทุกกฎมีผลตัดสินใจจาก server ที่ตรวจได้ พร้อมบัญชี/บริษัท/คำขอและผู้มีสิทธิ์ทำต่อ ไม่คาดเดาจากอีเมล
2. ทุกหน้าแจ้งสถานะจริงว่าอะไรบันทึกแล้ว อะไรยังไม่เสร็จ ต้องการข้อมูลใดบ้างรวมในครั้งเดียว และมีปุ่มถัดไปที่ทำได้จริงตามสิทธิ์
3. ถ้า backend commit แต่ response หาย เปิดใหม่/กดซ้ำต้องพบผลเดิม ไม่มีคำขอหรือ trial ใหม่โดยไม่ได้เลือกเปิดร้านเพิ่ม
4. จำลองสะดุดทุกจุดที่คั่นระหว่าง durable write กับขั้นถัดไป โดยเฉพาะ RECEIVED/VALIDATED/PROVISIONING/READY และส่ง LINE ไม่สำเร็จ; คำขอต้องถึงการกู้ต่อหรือคิวที่มองเห็น ไม่มีรอแบบไร้ผู้รับผิดชอบ
5. Admin ลงมือกับเคสเดิมได้ครบทั้งมีและไม่มีบริษัท เห็นผลก่อนกด มี audit; ตอบแล้ว/ส่งถึงแล้ว/ลูกค้าใช้งานได้แล้วเป็นหลักฐานคนละอย่าง
6. ทดสอบสิทธิ์/tenant/สองคนทำพร้อมกัน/ข้อมูลเปลี่ยนระหว่าง preview กับ commit; การช่วยกู้ไม่ให้ข้าม account suspension หรือแจก trial เพิ่มเอง
7. Browser acceptance บนจอมือถือครอบคลุม autoสำเร็จ, manual, failure, email conflict, กลับมาหลังปิด, เน็ตขาดหลังส่ง, เจ้าหน้าที่ตอบ no-company, และการเข้าใช้งานหลังจบเคส ใช้ภาษาและปุ่มเดียวกับที่ลูกค้าเห็นจริง

ลำดับที่คุ้มค่า: ปิด G01/G02 ก่อน → เติม action และการตอบเคส G03/G04 → ใช้ decision table เปลี่ยนกฎ G05 → จึงเพิ่ม automation ตามข้อมูลการใช้งาน ไม่จำเป็นต้องสร้างระบบ ticket ใหม่หรือให้ AI เป็นผู้ตัดสินสิทธิ์ การยืนยัน proof กู้ OWNER/สิทธิ์ trial เพิ่ม/ข้อยกเว้นประวัติยังต้องมี spec ชัดก่อน implementation

## 4. Verification และข้อจำกัด

หลักฐานรอบนี้อยู่ที่ `output/line-signup-rules-audit-20260907/`:

- `liff-state-probe.ts` / `.json`: รัน actual LIFF script ด้วย node:vm และ fake DOM/API states; reproduced 4/4 ไม่ใช่ browser/LINE live
- `intake-failure-probe.ts` / `.json`: reuse actual integration harness, inject faults หลัง receive และ validate; actual queue list/approve; reproduced 2/2 ไม่ได้ใช้ live DB และไม่ได้พิสูจน์ความถี่ของปัญหาใน prod
- `existing-focused-tests.log`: tests เดิมของ LIFF/signup auto/core queue/support admin **142 passed, 0 failed, 0 skipped** แสดงว่า coverage เดิมยังไม่ครอบคลุม counterexamples ใหม่นี้
- การลองรัน intake probe ครั้งแรกขาด `count()` ใน fake queue client จึงล้มที่ harness; เพิ่ม stub ใน output probe แล้วรันผ่าน ไม่มี app code ถูกแก้เพื่อให้ผลผ่าน

คำสั่ง:

```sh
pnpm --filter @watchdog-bms/api exec tsx ../../output/line-signup-rules-audit-20260907/liff-state-probe.ts
pnpm --filter @watchdog-bms/api exec tsx ../../output/line-signup-rules-audit-20260907/intake-failure-probe.ts
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/auth/line-liff-signup.spec.ts src/modules/external-signup/application/line-signup-auto-free.integration.spec.ts src/modules/external-signup/application/signup-admin-queue.use-case.spec.ts src/modules/external-signup/application/support-request-admin.use-case.spec.ts
```

ไม่มีการแก้โค้ดแอป/ข้อมูลลูกค้า ไม่มี commit/push/merge/deploy ในการตรวจครั้งนี้ ผลตรวจนี้เพิ่มรายการที่ต้องปิด ไม่ได้ย้อนอ้างว่า CI/PG เดิมพิสูจน์กฎใหม่แล้ว หรือว่าพบเหตุการณ์เหล่านี้ใน production จริง
