# แผนหลังบ้านและการเชื่อมระบบผู้บริหารมั่งมี

ส่วนเพิ่ม 4 ต.ค. 2569: แผน R1–R4 ท้ายเอกสารเป็นงานช่วงเดือนตาม [สเปกหลังบ้าน §23](../specs/mangmee-executive-business-backend-spec-th.md#23-รายงานตามช่วงเดือน--มติ-2026-10-04) แทนข้อจำกัดเดือนเดียวของแผนเดิม ยังไม่ implement/รันทดสอบช่วงเดือน; [running note](../agent-memory/executive-period-range-spec-2026-10-04.md) บันทึกขอบเขตเอกสารและข้อเปิด

คำที่แสดงบนหน้าจอล่าสุด: [ใช้คำที่คนทั่วไปเข้าใจ](../specs/mangmee-executive-plain-language-spec-th.md) — เมนู “รายรับ”, แท็บ “ลูกค้าที่สร้างรายรับสูง”; identifiers/สูตรเดิมคงไว้

มติล่าสุด 2026-10-01: พักและซ่อนฟีเจอร์ลบข้อมูล; G ทั้ง 35 ข้อยังไม่ปิดใน application — 22 OPEN และ 13 DEFERRED ตาม audit. ผล 188 scenarios/58 tests ด้านล่างเป็น baseline ก่อนพัก ไม่ใช่ acceptance ของ scope ปัจจุบันทั้งหมด

วันที่ปรับล่าสุด: 2026-10-02
สถานะ: **จบรอบออกแบบ จำลอง และแก้ตามผลตรวจทานอิสระ 2026-10-01 — E1 ฝั่ง API มี diff แล้วตาม BE §17.4; ข้อตัดสินใจ Q10–Q36 ตัดสินแล้ว 2 ต.ค. 2569 (เจ้าของ: ตามที่แนะนำ) การตัดสินใจปิดครบ; เจ้าของสั่งเริ่ม implement แล้ว 2 ต.ค. 2569 (“ทำตามลำดับเลย”) — งานทำเป็นขั้นบนกิ่ง `claude/executive-program-20261002` ยังไม่ merge และยังไม่ขึ้นระบบ**
Spec: [Backend](../specs/mangmee-executive-business-backend-spec-th.md)
Audit: [Bug gap impact](../research/mangmee-executive-business-be-gap-impact-2026-10-01-th.md)
ผลตรวจทานอิสระ: [หลังบ้าน RB-01 ถึง RB-42](../research/mangmee-executive-spec-review-backend-2026-10-01-th.md) · [หน้าจอ RU-01 ถึง RU-30](../research/mangmee-executive-spec-review-ui-2026-10-01-th.md)
บั๊กของระบบปัจจุบัน: [แก้แยกจากงานนี้](../research/mangmee-executive-current-code-bugs-2026-10-01-th.md)
QA: [E2E simulation](../qa/mangmee-executive-business-e2e-simulation-2026-10-01-th.md)
UI: [Screen and theme](../specs/mangmee-executive-business-ui-spec-th.md)
Memory: [Task state](../agent-memory/executive-business-demo.md)

## แก้ไขหลังตรวจทานอิสระ 2026-10-01 — อะไรเปลี่ยนและทำไม

| ส่วน | สิ่งที่เปลี่ยน | เหตุผล | ข้อค้นพบ |
|---|---|---|---|
| §2 ลำดับขั้น | แตก S0 เป็น S0a/S0b; ทำ S1 คู่กับ S5 ก่อน S2 | S1 ต้องการคำตอบเรื่องบัญชีเท่านั้น และถ้าสร้างบัญชีทีหลังสุด จะทดสอบ “ผู้บริหารอ่านอย่างเดียว” ด้วยบัญชีจริงไม่ได้ระหว่างทาง | RB-29 |
| §2.1 | รายการ migration งานข้อมูลครั้งเดียว และงานย้อนหลังของ S2 รายตัว พร้อมเจ้าของและเงื่อนไข | ขั้น S2 เดิมไม่มีรายการ จึงเสี่ยงได้ตารางซ้ำซ้อนหรือข้ามงานย้อนหลัง | RB-29, RB-02, RB-04, RB-08 |
| §3 ข้อห้าม | เพิ่มหัวข้อข้อห้ามหกข้อ | แผนเดิมไม่กล่าวถึงกติกาประจำของเจ้าของและข้อบังคับของตัวกั้น | RB-29, RB-02, RB-11, RB-01 |
| §4 วิธีทดสอบ | ระบุ test กับ Postgres จริง และกติกาลงทะเบียนไฟล์ test ให้ CI รัน | mock จับขอบเดือนเวลาไทย คืนเงินข้ามเดือน และ join ที่ทำให้ยอดคูณไม่ได้; ไฟล์ test ที่ไม่ลงทะเบียน CI ไม่รัน | RB-29, RB-41 |
| §5 เงื่อนไขก่อนเปิดใช้จริง | เพิ่มเงื่อนไขด้านข้อมูลส่วนบุคคลและงานข้อมูลที่ต้องเสร็จก่อน | ประกาศความเป็นส่วนตัวปัจจุบันอาจยังไม่ครอบคลุมการใช้แบบนี้ | RB-10, RB-04 |
| §1 และส่วนเพิ่มท้ายเอกสาร | ช่วงรหัส API เป็น API01–API15; คำว่า snapshot แทนด้วยชุดข้อมูลของ BE §12.3 | ช่วงรหัสเดิมตก API13 และสัญญาเปลี่ยนแล้ว | RB-18, RB-32, RB-08 |
| §2, §2.1, §5, §6 (รอบปิด 2026-10-02) | บั๊ก RB-40, RB-36, RB-34, RB-38 merge แล้ว จึงเปลี่ยนจากเงื่อนไขที่รอเป็นข้อเท็จจริง และเพิ่มงานที่การแก้ยังเหลือเข้า S1; เพิ่มตัวกรองของงานติดป้ายบริษัท | สถานะของสายแก้บั๊กเปลี่ยน และสเปกหน้าจอ §13.1 ขอตัวกรอง “ยังไม่ได้จัดประเภท” | RB-34, RB-40, RU-08 |

## 1. ผลรอบออกแบบ

- [x] เก็บมติ B1–B8 และ paid-not-started กลุ่มเดียว
- [x] ตรวจ FE demo/source, API/controller/service, contracts, Prisma, permissions และ existing tests
- [x] แยก current implementation, proposed contract, demo limitation และ open product policy
- [x] นิยาม requirements R01–R21, proposed API01–API10 และ API13–API15, reuse API11 data-rights (พัก), API12 พัก
- [x] นิยาม population/time/filter/ชุดข้อมูล/coverage, รายการเงิน, แหล่งข้อมูลการใช้งาน, attribution และบัญชี
- [x] ตรวจ 35 findings พร้อม source และผลกระทบ 19 module groups
- [x] จำลอง 12 journeys และ 188 scenario cases รวม negative/boundary/replay/race/recovery
- [x] รัน existing browser demo check ผ่าน และ existing focused BE tests 58 ผ่าน
- [x] ตรวจทานอิสระ 2026-10-01 และแก้สเปก BE ตามข้อค้นพบ 42 ข้อฝั่งหลังบ้าน กับข้อฝั่งหน้าจอที่แตะสัญญา
- [x] ได้คำตอบของเจ้าของ Q10–Q34 (แตกจาก Q01–Q05/Q09) — ตัดสินแล้ว 2 ต.ค. 2569 (เจ้าของ: ตามที่แนะนำ); Q35 และ Q36 ตัดสินแล้วเช่นกันและเป็นงานแยกจากรายงาน (Q35 ให้แก้ทันที Q36 ให้ implement); Q06–Q08 DEFERRED
- [ ] เขียน implementation หลังผู้ใช้เริ่มงานรอบถัดไปเท่านั้น
- [ ] รัน FE→HTTP→DB integration, concurrency, failure injection และ release acceptance

## 2. ลำดับ implementation ที่เสนอ

รหัสขั้น S0–S8 คงเดิม ลำดับการทำเปลี่ยนเป็นจากบนลงล่างของตารางนี้

| ลำดับ | Stage | งานขั้นต่ำ | ขึ้นกับ | Acceptance / stop condition |
|---|---|---|---|---|
| 1 | S0a Decisions — บัญชี | ได้คำตอบ Q10–Q15 (หัวข้อแม่ Q01) — ครบแล้ว: ตัดสินแล้ว 2 ต.ค. 2569 (เจ้าของ: ตามที่แนะนำ) | Owner | มีคำตอบเป็นมติ ไม่ใช้ fixture แทน policy |
| 2 | S1 Platform access | permission สี่ตัวและ role ระบบสามตัวใน `permission-registry.ts` พร้อมแถว role ในฐานข้อมูลทุกสภาพแวดล้อม; เพิ่ม role ทั้งสามใน `PLATFORM_ONLY_ROLE_KEYS` และ `PLATFORM_ROLE_KEYS`; ปิดเส้นทางที่รับรหัส role ตาม BE §17.1 ข้อ 5; เพิ่ม prefix `executive.` ใน `PLATFORM_AUDIT_ACTION_PREFIXES`; `assertPlatformTenant` ทุก endpoint; ตัวกั้นหน้าเว็บ หน้าแรก และเมนู | S0a (การแก้ RB-34 และ RB-40 merge แล้ว — D04) | SEC ผ่าน; ร้านลูกค้าไม่เห็นและไม่มอบ role ผู้บริหารได้; tenant/billing/sales สิทธิ์ไม่ขยาย |
| 2 | S5 Account commands (ทำคู่กับ S1) | API07–API10, API14, API15 ตามแบบแผนบัญชีเซลล์; สถานะและการระงับตาม BE §17.3; audit | S0a, S1 | USR/PX05–06 ผ่าน; ระงับแล้ว login ใหม่ไม่ได้; สร้างบัญชีทดสอบ “ผู้บริหารอ่านอย่างเดียว” ได้จริงตั้งแต่ขั้นนี้ |
| 3 | S0b Decisions — ข้อมูล | ได้คำตอบ Q16–Q34 (หัวข้อแม่ Q02–Q05, Q09 และข้อมูลส่วนบุคคล) — ครบแล้ว: ตัดสินแล้ว 2 ต.ค. 2569 (เจ้าของ: ตามที่แนะนำ) | Owner/domain owners | มีคำตอบเป็นมติ; ไม่มีคำตอบที่ต่างจากข้อเสนอ จึงไม่มีจุดที่ต้องแก้ในสเปกก่อนเริ่ม S2 |
| 4 | S2 Source readiness | รายการใน §2.1: ป้ายประเภทบริษัท กลุ่มธุรกิจ รายการเงินจากตัวอ่านยอดเดิม ตารางสรุปและงานสร้าง | S0b; เจ้าของโมดูล billing | source reconciliation/coverage report; unknown ไม่กลายเป็น 0; ยอดรายเดือนกระทบกับผู้ให้บริการได้ |
| 5 | S3 Read API | API01–API06 และ API13 อ่านจากตารางสรุป; `page`/`pageSize`; รหัสเหตุผล; audit การอ่านและการส่งออก | S1, S2 | REP/PAY/USE/SRC/PX01–04/12 ผ่านด้วย DB fixtures; จำนวนแถวของรายชื่อตรงกับทุกการ์ด |
| 6 | S4 FE integration | ต่อ EX-01–04 ด้วย shared components; แก้ hidden filters/negative chart/partial counts | S3 | browser network และ theme states จริง; ไม่มี fixture ใน production |
| — | S6 Case integration — DEFERRED | existing flow ครบ, safe visibility, intake mapping, hold readiness | Q06/Q07 | DR01–28 ผ่าน; policy ไม่ครบปิด execute; ไม่ข้าม guards |
| — | S7 P31 executor — DEFERRED | inventory, all-data hold, writer fence, legal retention, execution/evidence/restore | Q06–08, S6 | DR29–32/OPS08–16/PX07–11 ผ่าน; ห้ามเปิดจากเวลาอย่างเดียว |
| 7 | S8 Acceptance | reconciliation/latency/lag/rollbacks/regressions และเงื่อนไขใน §5 | stage ที่จะ release | หลักฐานตาม QA§7; อ่าน deployment runbook ก่อน live operations |

Current scope คือ S0a, S1, S5, S0b, S2, S3, S4 และ S8 เฉพาะรายงาน/บัญชี; S6/S7 พักและไม่เป็น acceptance gate รอบนี้
EX-05/06 และ case summaries/actions ไม่ถูกสร้างเลย (ไม่มี route เมนู หรือ permission) รวม saved route เดิม; API06 ไม่มี case data
เจ้าของสั่งเริ่มเขียนโค้ดของ S1, S5, S2, S3, S4 และ S8 เมื่อ 2 ต.ค. 2569; S6/S7 ยังพัก

**สถานะ E3a (2026-10-03):** S3 ส่วน API01–API06 มี diff แล้วตาม BE §16.6 บนกิ่ง `claude/executive-read-api-20261003` (รวมเข้ากิ่งงานผู้บริหารแล้ว ยังไม่เข้า develop; รอบสองเพิ่มสามช่องที่หน้ารายงาน E4b ขอ ท้าย BE §16.6); เคสตรวจรับ REP/PAY/USE/SRC/PX01–04/12 ฝั่งหลังบ้านพิสูจน์ด้วยฐานข้อมูลจริงใน `executive-report-read.pg.spec.ts` เท่าที่ไม่ใช่เรื่องหน้าจอ; API13 (ส่งออก) มี diff ใน lane E5 แล้ว รอ controller ตรวจ PostgreSQL/เบราว์เซอร์และรับงาน ตาม memory `executive-excel-export-2026-10-03.md` หน้าเว็บอยู่ในงาน E4a/E4b รายละเอียดใน memory `executive-read-api-2026-10-03.md`

**สถานะ E1 (2026-10-02):** S1 ฝั่ง API และ S5 มี diff แล้วตาม BE §17.4; ไม่แก้เว็บ ไม่เปลี่ยน schema ไม่แตะไฟล์ maintenance ที่ตรึงไว้ การตรวจใน lane ใช้ spec เดิมที่ลงทะเบียนอยู่ ไม่มี `package.json` เปลี่ยน รายละเอียด red/green อยู่ใน memory หัวข้อ Implementation, stage E1
ผู้ควบคุมตัดสิน lifecycle แล้ว 2026-10-02 ตามนิยาม UI §9.2 (ไม่ใช่ข้อตัดสินใจใหม่ของเจ้าของ): รับเฉพาะ membership ACTIVE/SUSPENDED/DISABLED; DRAFT/INVITED ไม่อยู่ในรายการและรายละเอียด/คำสั่งคืน ACCOUNT_NOT_FOUND; ตรวจ user ที่ไม่ ACTIVE, membership DISABLED หรือ credential หาย/DISABLED เป็น REVOKED ก่อน SUSPENDED; credential TEMPORARY หรือ ACTIVE ที่หมดอายุเป็น PENDING_ACTIVATION พร้อม temporaryPasswordExpiresAt; ที่เหลือเป็น ACTIVE เมื่อ credential ยังใช้ได้
API10/API14/API15 ปฏิเสธ REVOKED ด้วย ACCOUNT_REVOKED โดยไม่เขียนข้อมูล/session/audit; API10 เปลี่ยนได้เฉพาะ ACTIVE ↔ SUSPENDED และปลายทางเดิมเป็น no-op; API14 ยังออกใหม่ขณะ SUSPENDED ได้ และ API15 ใช้ได้กับสถานะที่ไม่ REVOKED ตาม BE §17.3
ข้อเปิดที่เหลือของ E1: ยืนยัน PostgreSQL จริงโดยผู้ควบคุม ส่วนหน้าเว็บของ S1 และข้อความไทย ACCOUNT_REVOKED คงเป็นงานขั้นถัดไป

### 2.1 รายการของ S2 — migration งานข้อมูลครั้งเดียว และงานย้อนหลัง

ทุกรายการอ้างกติกาใน [สเปก BE](../specs/mangmee-executive-business-backend-spec-th.md) ชื่อ model และคอลัมน์เป็นข้อเสนอ ตัดสินตอนเริ่มทำ
รหัส Q ในคอลัมน์สุดท้ายคือข้อตัดสินใจที่รายการนั้นใช้ ทุกข้อตัดสินแล้ว 2 ต.ค. 2569 (เจ้าของ: ตามที่แนะนำ) เงื่อนไขอื่นในคอลัมน์เดียวกันยังต้องทำ คำอนุมัติของเจ้าของสำหรับการอ่านยอดย้อนหลังจากผู้ให้บริการบนระบบจริง (ข้อ 6) ได้รับแล้ว 2 ต.ค. 2569

| # | รายการ | ชนิด | เจ้าของ | เงื่อนไขและหลักฐานที่ต้องมี |
|---|---|---|---|---|
| 1 | `Company.reportClassification`, `reportClassifiedAt`, `reportClassifiedByUserId` (BE §12.2) | migration | company/partner management | Q16; แก้ผ่าน `PATCH /v1/system/partners/:partnerCompanyId` เดิมพร้อม audit; ช่องเลือกในหน้ารายละเอียดบริษัทของผู้ดูแล และตัวกรอง `reportClassification` ในรายชื่อบริษัทของผู้ดูแล (BE §9.6, §16.1) |
| 2 | ตั้งค่าเริ่มต้น: ร้านที่เกิดจากการสมัครได้ `CUSTOMER`, บริษัทแพลตฟอร์มได้ `INTERNAL` แล้วผู้ดูแลระบบเลือกที่เหลือทีละบริษัท | งานข้อมูลครั้งเดียว | ผู้ดูแลระบบ | รายงานก่อน/หลัง: จำนวนต่อประเภท และจำนวนที่ยังไม่จัดประเภทเป็น 0 ก่อนเปิดรายงาน |
| 3 | `Company.reportIndustryGroup` และตารางจับคู่ `businessTypeCode` → กลุ่มธุรกิจ version 1 (BE §15) | migration + เนื้อหาตาราง | company/partner management | Q26; เนื้อหาตารางผ่านการตรวจของเจ้าของก่อนใช้; ช่องเลือกและตัวกรอง `reportIndustryGroup` ในหน้าเดิมของผู้ดูแล (BE §16.1) |
| 4 | ฟังก์ชันอ่านรายการเงินของโมดูล billing: นับหนึ่งครั้งต่อรหัสรายการของผู้ให้บริการ พร้อม `purchaseKind` (BE §14.1) | โค้ดในโมดูล billing (ตาราง projection ถ้าเจ้าของโมดูลเลือก) | เจ้าของโมดูล billing | เจ้าของโมดูลยืนยันตาราง `purchaseKind` ทุกแถว; ไม่แก้ `paid-invoice.ts` และ `billing-schedule.ts` |
| 5 | การสร้างงานอ่านยอดจากผู้ให้บริการของวันก่อนหน้าทุกวัน | โค้ดในโมดูล billing + worker เดิม | เจ้าของโมดูล billing | Q21; ต่อจากตารางเวลาที่มีอยู่ ไม่สร้างตัวอ่านตัวที่สอง |
| 6 | อ่านยอดย้อนหลังครั้งเดียวตั้งแต่วันแรกที่เปิดรับชำระออนไลน์ ทีละช่วงไม่เกิน 31 วัน | **งานแตะผู้ให้บริการบนระบบจริง** | เจ้าของ + เจ้าของโมดูล billing | Q21; **เจ้าของอนุมัติแล้ว 2 ต.ค. 2569** (“การอ่านยอดเงินย้อนหลังจากผู้ให้บริการรับชำระบนระบบจริง อนุญาต”) — ทำได้หลังโค้ดนี้ขึ้นระบบจริงเท่านั้น แจ้งเจ้าของก่อนเปิด session บนระบบจริงทุกครั้ง ทำตาม runbook และบันทึกรหัสของงานอ่านทุกช่วง; ก่อนงานนี้เสร็จ เงินรายเดือนเป็น “ยอดยังไม่ครบ” |
| 7 | `ExecutiveCompanyMonth`, `ExecutiveCompanyProfile`, `ExecutiveReportBuild` (BE §12.3) | migration | executive-business | ไม่มีข้อมูลส่วนบุคคล; สร้างซ้ำได้ทั้งตาราง |
| 8 | endpoint ภายใน `POST /v1/internal/executive/rebuild` และงานตามเวลาใน `apps/workers` | โค้ด | executive-business | Q30; เรียกซ้ำได้โดยผลไม่เปลี่ยน; worker token |
| 9 | การสร้างครั้งแรก: ทุกเดือนตั้งแต่เดือนแรกที่มีข้อมูล และบันทึกวันเริ่มสร้างครั้งแรก | งานข้อมูลครั้งเดียว (สร้างซ้ำได้) | executive-business | วันนี้เป็นขอบของเหตุผล `HISTORY_BEFORE_FIRST_BUILD`; ตัวนับของเดือนก่อนวันนี้เป็น “อย่างน้อย” |
| 10 | ยืนยันวันจริงที่ migration `20260917190000`, `20260930150000` และตารางของแต่ละแหล่งถูกใช้ในระบบจริง | ตรวจจากประวัติการ deploy | ผู้ทำ S2 | ใช้เป็นขอบของ “ก่อนเริ่มเก็บข้อมูล” และ `earliestAvailableMonth` ต่อแหล่ง; ถ้าต้องอ่านระบบจริงให้ทำตาม runbook |
| 11 | ยืนยันกับเจ้าของโมดูลรายจ่ายว่าการยกเลิกรายจ่ายไม่ล้าง `confirmedAt` (BE §13.3) | ตรวจด้วย test | ผู้ทำ S2 | test ที่รันจริง ไม่ใช่การอ่านโค้ด |

สถานะขั้น S2 (2026-10-03, ยังไม่ merge และยังไม่ขึ้นระบบใด): ข้อ 1, 3 (เนื้อหา mapping เป็นข้อเสนอรอเจ้าของ), 4, 5, 7, 8 สร้างและทดสอบบนฐานข้อมูลจริงแล้ว;
ข้อ 2 สร้างเป็นงานข้อมูลครั้งเดียวที่ release รันเอง เหลือผู้ดูแลจัดประเภทบริษัทที่เหลือ; ข้อ 6 เขียนขั้นตอนไว้แล้ว ทำได้หลังโค้ดขึ้นระบบจริง;
ข้อ 9 คือรอบสร้างเต็มรอบแรกที่ระบบทำเองหลังขึ้นระบบ; ข้อ 10 ยังไม่ได้อ่านประวัติการ deploy (สิ่งที่ต้องอ่านอยู่ใน `docs/agent-memory/executive-source-readiness-2026-10-02.md`) และชุดข้อมูลไม่ใช้วันของ migration เป็นขอบ;
ข้อ 11 ยืนยันแล้วด้วย test ที่รันจริง: การยกเลิกรายจ่ายไม่ล้าง `confirmedAt`

รายการของ S1 ที่เป็นการเปลี่ยนข้อมูล: permission สี่ตัวและ role ระบบสามตัวใน `permission-registry.ts` และการ sync ให้มีแถว role ในฐานข้อมูลทุกสภาพแวดล้อม
เพราะการสร้างบัญชีค้น role ด้วย `scopeKey = 'system'` แล้วล้มถ้าไม่พบ (แบบเดียวกับ `sales-agents.service.ts`)

## 3. Product และ architecture evidence

- Product goal/journeys/source of truth อยู่ใน spec R01–R21/B1–B8
- Actor/target scope, financial/activity grain, states และ final mutation boundaries อยู่ BE§11–17; งานลบข้อมูลที่พักอยู่ BE§18–19
- Migration candidates เป็นข้อเสนอ ต้อง reuse existing primitives ก่อนเพิ่ม table/dependency
- Inventory ของ direct Company relation ไม่ใช่คำสั่งเพิ่ม CASCADE; ตรวจ indirect FK และ retention basis ด้วย
- Auth/data-rights/billing safeguards ต้องมี regression ไม่ถอด guard เพื่อให้ demo flow ผ่าน
- ไม่มี dependency ใหม่ในรอบออกแบบ
- ก่อน code edits อ่าน ponytail full จาก repo และ apps/web/AGENTS.md หากแก้ web

### ข้อห้าม

1. **ไม่แก้ `paid-invoice.ts` และ `billing-schedule.ts` ไม่ว่ากรณีใด** และไม่เพิ่ม `paidAt` ใน `PaidInvoiceEvidence` (BE §14.1)
2. **ไม่มีสวิตช์เปิด/ปิดฟีเจอร์ด้วยค่า environment** การเข้าถึงคุมด้วย role เท่านั้น และส่วนลบข้อมูลที่พักคือไม่สร้างในโค้ดเลย (BE §20.3)
3. **ไม่ตั้งชื่อ route parameter ของเส้นทางฝั่งแพลตฟอร์ม (ใต้ `system/` และ `sales/`) ว่า `companyId`** และหน้าเว็บไม่ส่ง `X-Company-Id` ของลูกค้า (BE §16.1)
4. **ระบบมีผู้ดูแลระบบคนเดียว** ไม่ออกแบบขั้นตอนที่ต้องมีผู้อนุมัติคนที่สอง และไม่สร้างบัญชีผู้ดูแลที่สองให้คนเดิม
5. **ไม่สร้างตัวอ่านผู้ให้บริการชำระเงินตัวที่สอง** และไม่เรียกผู้ให้บริการตอนเปิดหน้ารายงาน
6. **ไม่แก้ `package.json` เว้นแต่เป็นเรื่อง dependency** — การเพิ่มไฟล์ test ลงรายการของ script `test` เป็นข้อยกเว้นเดียวที่งานนี้ต้องใช้ และต้องขออนุญาตเจ้าของก่อนตาม §4

## 4. Verification

### 4.1 ที่ดำเนินการแล้ว

| ระดับ | ผล | สิ่งที่ไม่พิสูจน์ |
|---|---|---|
| Source/contract audit | E01–E18, พบ G01–G35 | deployed service หรือข้อมูลจริง |
| Local demo browser | PASS: controls/data/local forms/roles/hold presentation/responsive | real auth/HTTP/DB/retention execution |
| Existing focused BE | 58 PASS/0 FAIL/0 SKIP; คำสั่งใน audit§6 | executive endpoints และ hold guard ที่ยังไม่มี |
| Spec simulation | 188 unique cases +12 walkthroughs | runtime ของ 188 cases |
| ตรวจทานอิสระ 2026-10-01 | เทียบทุกข้ออ้างกับโค้ดที่ `ae13970b0`; รันชุด 58 tests ซ้ำ (ผ่าน); จำลอง `AuthGuard` กับตัวคำนวณสิทธิ์ตัวจริง และ `roleGrantViolation` ในหน่วยความจำ | ไม่แตะฐานข้อมูล คลาวด์ ผู้ให้บริการชำระเงิน หรือระบบจริง; สัดส่วนข้อมูลจริงทุกตัวยังไม่ทราบ |
| Documentation | links/IDs/whitespace/fences/traceability/fixture arithmetic ก่อน handoff | legal review/performance/actual integration |

ไม่รัน full app build/typecheck/E2E ทั้งหมด เพราะไม่มี application code เปลี่ยนและยังไม่มี feature backend ให้เชื่อม

### 4.2 วิธีทดสอบเมื่อเริ่มทำ

| เรื่อง | ชนิด test | เหตุผล |
|---|---|---|
| ตารางตัดสิน `paidEver`, กลุ่มการใช้งาน, กลุ่มลูกค้าที่จ่ายสูง (ยอดเท่ากันที่ขอบ กลุ่มเล็ก อันดับ), การปัดเศษ | logic spec ไม่ใช้ฐานข้อมูล | เป็นสูตรล้วน |
| ขอบเดือนและวันเวลาไทยใน SQL: 23:59:59.999 กับ 00:00:00.000 ของวันสิ้นเดือน และ 06:59/07:00 UTC | **Postgres จริง** | คอลัมน์เวลาไม่มีโซนเวลา mock จับไม่ได้ (RB-41) |
| คืนเงินข้ามเดือน และรายการเดียวกันที่ถูกอ่านซ้ำจากสองงานที่ช่วงซ้อนกัน | **Postgres จริง** | ต้องนับหนึ่งครั้งต่อรหัสรายการ |
| join ไม่ทำให้ยอดคูณ (บริษัทที่มีหลายใบ หลายคำขอสมัคร หลายสมาชิก) | **Postgres จริง** | เป็นความผิดพลาดของ query ที่ mock ไม่เห็น |
| งานสร้างตารางสรุป: เรียกซ้ำผลไม่เปลี่ยน, ล้มกลางทางคงชุดเดิม, ตัวนับไม่ลดลงเมื่อแถวต้นทางถูกลบ, เดือนที่จบแล้วได้ `revision` ใหม่เมื่อตัวเลขเปลี่ยน | **Postgres จริง** | BE §12.3 |
| จำนวนแถวของรายชื่อด้วย `drilldownFilters` เท่ากับค่าบนทุกการ์ด | **Postgres จริง** | RB-19 |
| ทุก endpoint ผู้บริหาร: ผู้ถือ permission ในบริบทบริษัทลูกค้าได้ 403; ผู้เรียกที่ไม่มี membership ในบริษัทเป้าหมายเรียก API05/API06 ได้ 200; ไม่มีเส้นทางใต้ `system/` หรือ `sales/` ที่มี parameter ชื่อ `companyId` | guard spec และการตรวจรวมทุก controller | RB-01, RB-34 |
| ระงับบัญชีแล้ว login ใหม่ไม่ได้; ผู้ไม่มีสิทธิ์ดูข้อมูลติดต่อไม่ได้ค่าใน payload; ผู้ไม่มีสิทธิ์ส่งออกได้ 403 | use-case spec + Postgres จริงสำหรับ login | RB-25, RU-19, RU-20 |
| ชุด key ของทุก DTO ตรงกับรายการที่อนุญาต | logic spec | RB-22 |
| API ประวัติของร้านไม่คืนแถว `executive.*` | repository spec | RB-09 |
| ไฟล์ส่งออก: ข้อความที่ขึ้นต้นด้วย `=`, `+`, `-`, `@`, แท็บ, ขึ้นบรรทัดใหม่ และมี `*`, `?`, `~`, `>`; ค่าที่เปิดด้วยตัวอ่านที่ไม่คำนวณสูตรตรงกับ API; แม่แบบไม่มีข้อมูลจริง; เพดาน | logic spec กับไฟล์ที่สร้างจริง | RU-18, RB-27, RU-17 |

**กติกาให้ CI รัน test ใหม่ (RB-29):** CI ไม่ได้รันทุกไฟล์ spec โดยอัตโนมัติ มีสามทางที่ไฟล์ spec ฝั่ง API ถูกรัน

1. script `test` ของ `apps/api/package.json` เป็นรายการไฟล์ spec ระบุชื่อทีละไฟล์
2. `scripts/line-ai-whole-chain-acceptance.catalog.mjs` รันไฟล์ตามรายการของตัวเอง (spec ของคอนโซลทีมขายอยู่ที่นี่ ไม่อยู่ในข้อ 1)
3. `.github/workflows/ci.yml` เรียกไฟล์ `*.pg.spec.ts` (Postgres จริง) ทีละไฟล์

ไฟล์ spec ใหม่ที่ไม่อยู่ในทางใดทางหนึ่งจะไม่ถูกรันใน CI แม้ผ่านในเครื่อง ให้ทำตามลำดับนี้:
เขียน test ลงในไฟล์ spec ที่ CI รันอยู่แล้วเมื่อทำได้ ถ้าต้องมีไฟล์ใหม่ ให้ระบุรายชื่อไฟล์ทั้งหมดของขั้นนั้นแล้วขออนุญาตเจ้าของครั้งเดียวก่อนแก้ `package.json`
และตรวจหลัง push ว่า CI รันไฟล์ใหม่จริง (ดูจำนวน test ใน log ไม่ใช่ดูว่าเขียว)
การตรวจครั้งต่อไปต้องเพิ่ม focused tests จาก catalog ตาม stage ที่ implement จริง

## 5. เงื่อนไขก่อนเปิดให้ผู้บริหารใช้จริง

1. เจ้าของตอบ Q10–Q34 แล้ว และสเปกถูกแก้ตามคำตอบที่ต่างจากข้อเสนอ — ครบแล้ว: ตัดสินแล้ว 2 ต.ค. 2569 (เจ้าของ: ตามที่แนะนำ) ทุกข้อ ไม่มีคำตอบที่ต่างจากข้อเสนอ
2. การแก้ RB-34 และ RB-40 merge แล้ว (PR #950 เข้า develop `6dd3c8c7`, PR #951 เข้า main `4803be00`): role ทีมขายมอบโดยร้านไม่ได้ และไม่มีเส้นทางใต้ `system/` ที่ใช้ parameter `companyId`
   สิ่งที่ยังต้องทำในขั้น S1 ก่อนเพิ่ม role ผู้บริหาร: เพิ่ม role ทั้งสามในรายการ platform-only และปิดเส้นทางที่รับรหัส role (BE §17.1 ข้อ 1 และข้อ 5)
3. ผู้ดูแลระบบจัดประเภทบริษัทเดิมครบ (§2.1 ข้อ 2) และการอ่านยอดย้อนหลังเสร็จ (§2.1 ข้อ 6) พร้อมรายงาน coverage
4. ยอดรายเดือนของรายงานกระทบกับผู้ให้บริการได้ รวมบรรทัด “เงินที่ยังไม่ผูกบริษัท” และยอดของบริษัทที่ตัดออก
5. ประกาศความเป็นส่วนตัวและบันทึกกิจกรรมการประมวลผลที่ปรับแล้ว และวิธีปฏิบัติกับไฟล์ที่ส่งออก ผ่านการตรวจของที่ปรึกษากฎหมาย (BE §20.3; ข้อสังเกตในสเปกไม่ใช่ความเห็นทางกฎหมาย)
   **เจ้าของตัดสิน 2 ต.ค. 2569: “อนุญาต ให้ทำและขึ้น prod ได้ก่อน”** — ข้อนี้จึงไม่เป็นเงื่อนไขของการสร้าง การขึ้นระบบจริง หรือการให้ role แก่บัญชีจริงอีกต่อไป เอกสารทั้งสามยังต้องจัดทำและส่งให้ที่ปรึกษากฎหมายตรวจตามหลัง
6. ไม่มีการให้ role ผู้บริหารแก่บัญชีจริงก่อนข้อ 1–4 ครบ (ไม่มีสวิตช์ การยังไม่ให้ role คือการยังไม่เปิด; ข้อ 5 เจ้าของให้ตามหลังได้)
7. deployment ทำตาม runbook UAT/Production และได้รับคำอนุญาตของเจ้าของก่อนขึ้น production

## 6. Next state

ข้อตัดสินใจ Q10–Q36 ตัดสินแล้ว 2 ต.ค. 2569 (เจ้าของ: ตามที่แนะนำ) ขั้น S0a และ S0b จึงครบ และขั้น S1 กับ S5 ไม่ติดเงื่อนไขการตัดสินใจแล้ว เจ้าของสั่งเริ่ม implement เมื่อ 2 ต.ค. 2569
Q35 (ทางตันของผู้ดูแลคนเดียวในคำขอลบข้อมูล) ให้แก้ทันทีเป็นงานแยก และ Q36 (ยอดเครดิตเซลล์สี่จุด) ให้ implement ในโมดูลทีมขาย ทั้งสองข้อเป็นงานแยกจากรายงาน อยู่ในไฟล์บั๊ก Q35 แก้แล้วในโค้ด 2026-10-02 เป็น single-admin mode ของเคส (ยังไม่ขึ้นระบบ) ส่วน Q36 แก้ในโค้ดแล้ว 2 ต.ค. 2569 ยังไม่ merge
บั๊ก RB-40, RB-36, RB-34, RB-38 แก้และ merge แล้ว (2026-10-02) ส่วนที่ยังเหลือของแต่ละข้ออยู่ในไฟล์บั๊ก
รายละเอียด deletion Q06–08 พักทั้งหมดตามมติล่าสุด; เปิดกลับมาคุยเมื่อ Owner ขอ
ไม่มีบัญชีจริง คำเชิญ cloud/provider operation การ deploy หรือการลบข้อมูลในรอบเอกสารนี้

## ส่วนเพิ่มกราฟและอันดับ 2026-10-01

- [x] [Extension spec](../specs/mangmee-executive-usage-pareto-spec-th.md): receipt adoption แยก billing receipts, population/coverage, cohort drilldown/sort/paging และ Top spender/Pareto
- [x] Owner ยืนยัน Top spender เป็นเงินจ่ายให้มั่งมีหักคืนเงิน; demo72บริษัทแทนฐานเดิม12บริษัท
- [x] Local math และ browser checks PASS รวม graph→list→detail→Back, all-page cohort reconciliation, responsive และ hidden deletion
- [x] กติกาข้อมูลของส่วนนี้เขียนใน BE §13.4–§13.6 และ parameter ใน BE §12.4 แล้ว (หลักฐานว่าเคยเพิ่มใบเสร็จ สิทธิ์ใช้ฟีเจอร์ ยอดเท่ากันที่ขอบกลุ่ม กลุ่มเล็ก อันดับ)
- [x] ได้คำตอบ Q17, Q20, Q24, Q25 — ตัดสินแล้ว 2 ต.ค. 2569 (เจ้าของ: ตามที่แนะนำ); เมื่อ integration ให้ reuse API02/03/04/05 ตามตาราง BE §16.1
- [ ] ตรวจ real HTTP/DB/ชุดข้อมูล/concurrency/permission และ source completeness เมื่อเริ่ม implementation

ไม่มี application implementation ในรอบนี้; Q10–Q36 ตัดสินแล้ว 2 ต.ค. 2569 (เจ้าของ: ตามที่แนะนำ), Q06–Q08 ยังคง deferred

## ปรับโครงหน้าผู้บริหาร 2026-10-01

- [x] [Navigation/comparison spec](../specs/mangmee-executive-navigation-comparison-spec-th.md): summary→analysis→companylist→detail, one-level submenu, focused tabs, compact filters และA/B
- [x] Localdemo แยกusage/revenue/customers/compare; overviewสั้น; mobilemenuใช้themedselector; deletionยังซ่อน
- [x] Localbrowserตรวจroutes/Back/A-B/groupdenominator/theme และsaved-state migration
- [x] สัญญาของสี่หน้านี้อยู่ใน BE §16.1 (API04 รับ `section` สี่ค่า และตัวเลือกของการเปรียบเทียบ)
- [ ] เมื่อ implement เพิ่ม route/section ตาม BE §16.1 พร้อม coverage/permission; ไม่ส่งทุก analysis dataset ทุกครั้งโดยไม่จำเป็น
- [ ] Q37 เปิด equal-period comparison แล้วตาม §23.4; implement/ตรวจจริงใน R1–R4 ไม่ใช้ข้อมูลตัวอย่างเดือนเดียวสร้าง delta

## Export Excel — scope extension 2026-10-01

ตาม [Excel spec](../specs/mangmee-executive-excel-export-spec-th.md): local header action → scoped manifest/fixed Dashboard + source/sheet preview → simulated preparing/ready/error/expired; คง context เมื่อกลับและซ่อนจาก accounts
สัญญาฝั่งหลังบ้านของ API13 อยู่ใน BE §16.4: คำขอเดียวคืนไฟล์ตรง สิทธิ์อ่านกับสิทธิ์ส่งออกรายคน ตัวเลขจากชุดข้อมูลเดียวกับหน้าจอ (`buildId`) และ typed multi-sheet XLSX โดยต่อยอด shared writer เดิม
ก่อน implement: Q13 (สิทธิ์ส่งออกรายคน), Q14 และ Q33 (ข้อมูลติดต่อ) ตัดสินแล้ว 2 ต.ค. 2569 (เจ้าของ: ตามที่แนะนำ); ยังต้องยืนยันเพดานด้วย capacity test; ตรวจ shared writer backward compatibility, source definitions และ all-page membership
ตรวจ local EXL01–09 และ existing navigation suite; EXL10–12 ต้องตรวจ backend/workbookจริงภายหลัง. ไม่เพิ่ม dependencies/app code/cloud mutations รอบออกแบบ

### Owner template amendment — Excel Dashboard v4

Ownerระบุ `outputs/company-infographic-20261001/company-receipts-dashboard-v4.xlsx` เป็นแม่แบบตาม [Excel spec §8](../specs/mangmee-executive-excel-export-spec-th.md#8-แม่แบบและหลักฐานตรวจอ่าน-2026-10-01)
มตินี้แทนsummary-only/optional-company/values-only: ค่าเริ่มต้นเป็นDashboardเขียว–ทอง + nativecharts/สูตร + รายบริษัทที่เป็นsource, 2ชีตหลัก; ตารางคำนวณใต้Dashboardและmetadataในsource
ต้องแยกsource28ก.ย.ของแม่แบบจากfictional30ก.ย.ของเดโม; ไม่ยกสูตรblank=0หรือreceiptทุกสถานะมาเปลี่ยนBE Q03โดยปริยาย
API13 ไม่รับ templateKey หรือ includeCompanies ตาม BE §16.4; server เลือกรุ่นแม่แบบเอง E5 ต่อ shared writer เป็นหลายชีตพร้อม chart/formula/cache แล้ว รอ controller ตรวจการเปิดไฟล์จริงตาม XG03
EXL13–14เพิ่มintegrationacceptance; baseline188/47deferredไม่เปลี่ยนและไม่มีgapimplementationปิดจากการอ่านแม่แบบ. ไม่แก้ไฟล์อ้างอิงและไม่สร้างXLSXใหม่รอบนี้
แม่แบบที่เก็บใน repository ต้องสร้างใหม่จากข้อมูลสมมติ ไฟล์ของเจ้าของมีข้อมูลจริงและห้ามนำมาตัดแถวแล้วเก็บ เพราะชื่อบริษัทจริงยังค้างในแคชของกราฟและตารางข้อความร่วมของไฟล์ (RB-27, BE §16.4)


## 7. แผนช่วงเดือนและหน้ารายงานสำหรับผู้บริหาร — 2026-10-04

ขอบเขต: Q37, BE §23, UI §14 และคำชุด P; สรุปรายเดือนเดิมเท่านั้น ไม่มีรายวัน migration/schema/dependency/feature switch หรือการแก้ paid-invoice.ts/billing-schedule.ts งานนี้ส่งมอบสเปก/แผน ไม่อนุญาตให้นับ checkbox implementation หรือการตรวจรับผ่านจากการอ่านเอกสาร

| ขั้น / สถานะ | งานที่ต้องทำ | การตรวจและเงื่อนไขจบ |
|---|---|---|
| R1 API + build / มี diff รอตรวจ PostgreSQL | ปรับ contracts `executive-business.ts`/คำจาก `executive-report-words.ts`, context/DTO/query/API02–06, read logic/service และ export query; คู่เดือน/coverage/revision/previous/monthlySeries; reuse monthly rows และ build atomic/version checks เดิม ไม่สร้าง aggregate ช่วงใน DB | RP01–RP10, RP16–RP18 ด้านล่าง; เดือนเดียวเท่ารุ่นเดิมยกเว้นคำ/contract ที่ตั้งใจเปลี่ยน; union/ยอดกลุ่ม/list summary/drilldown ตรง; PG จริงพิสูจน์ build/current labels/refund/row gaps; contracts build แล้วจึงเชื่อมเว็บ |
| R2 เว็บแถบ + layout/charts / ยังไม่เริ่ม | component ร่วมเดียวใน reports folder, draft month picker เดิมสองช่อง, chips/clear/summary, from/to/origin URL/Back/rollover, KPI compare และกราฟตาม UI §14.3; loading/permission/partial states; ใช้ shell/tokens/fonts/fields เดิม | RP11–RP14; focused web specs + browser 390 px/desktop/zoom/keyboard ของ controller; ไม่มี hidden filter/คำอังกฤษ/id/code token; ภาพ/ข้อแก้จาก lane gap analysis merge ใน UI §14.5 ก่อนรับ layout |
| R3 Export / มี diff รอตรวจ PostgreSQL/ความจุ | ใช้คู่เดือน/effective state ล่าสุดเดียวกับแถบ เพิ่มรายเดือน/ช่วงก่อนในส่วนคำนวณของสองชีตเดิม; range words/metadata/chart cache; buildId/permissions/contact และ row cap เดิมและมติ Q41 ก่อนปรับฐานนับส่วนรายเดือน | RP15–RP18; อ่านไฟล์จริงตรง API ไม่ต้องคำนวณสูตรใหม่เพื่อให้ตัวเลขถูก; counts ไม่ซ้ำ null ไม่กลายเป็นศูนย์; ต้นทางทุกเดือน/all pages/สองฝั่งตรงหน้าจอ |
| R4 Acceptance / ยังไม่เริ่ม | กระทบยอดเดือนและรวมช่วง ตรวจ UI→HTTP→PG→XLSX/Back/permission/ข้อมูลบางส่วน คงผลตรวจ gap analysis; capacity กับ ALL และช่วงก่อนยาวเท่ากัน | RP19–RP20 และ regression ที่ขั้นนั้นแตะ; controller บันทึก command/exit/counts/ภาพ/ไฟล์จริง ไม่มีคำอ้างว่า deployed แล้ว; live operation หากมีภายหลังใช้ runbook เดิม |

R1/R2/R3 ทำส่วนที่กำหนดแล้วได้โดยไม่รอ churn หรือ distinct users ข้ามเดือน Q38 ตัดสินย่อเฉพาะขอบต้นและ ALL ตาม builtMonths; Q39 พัก churn ทั้งชุด; Q40 ใช้จำนวนผู้ใช้แยกเดือน; Q41 คง 10,000 บริษัทและ byte/time เดิม ไม่ใส่ตัวเลขเดา ส่วนอื่นไม่ขยาย scope เพื่อแก้ข้อมูลที่ไม่มีประวัติ

### 7.1 กรณีตรวจรับและ test ที่ต้องแดงบนรุ่นเดือนเดียว

ทุกรายการต่อไปนี้เป็น **ข้อกำหนดของ test ใน implementation ถัดไป ไม่ใช่ผล test ที่รันแล้ว** เขียนลง spec ที่ CI รันอยู่ก่อนแก้ production และบันทึกชื่อ test/คำสั่ง/exit/failure เก่า + green ใหม่ทีละกรณี ถ้าจำเป็นให้คืนบรรทัด production เก่าด้วยมือเพื่อพิสูจน์ red แล้วคืน fix ห้ามใช้ความคาดหวังในตารางแทนหลักฐานรัน

| รหัส | ข้อมูล/การกระทำ | ผลที่ test ต้องยืนยัน |
|---|---|---|
| RP01 | from/to ขาด ผิดเดือน ขอบกลับ อนาคต ช่วงวัน หรือ month/preset แทน pair | 400; valid คู่ข้ามปี/เดือนเดียวรับได้ ไม่ normalize ขอบผิดให้ผ่าน |
| RP02 | เวลาไทยที่เที่ยงคืน 1 ม.ค./1 เม.ย.; preset ไตรมาส/ปี/12 เดือน | คู่เดือนจาก API01 ถูก; ปี/ไตรมาสไม่รวมเดือนอนาคต; builtMonths จริงไม่เติม gap; ไม่มี local timezone เปลี่ยนช่วง |
| RP03 | default เดือนปัจจุบันยังไม่ built; ALL ไม่มีเดือน/มีเดือนก่อนหน้า; ขอบ unbuilt | context ตอบได้ default เดือนที่แล้วในวัน 1–7 เวลาไทย นอกนั้นเดือนนี้; รายงาน 503/P09 หรือ P38 ถูก; ALL เริ่ม built แรกและจบ built ล่าสุด ไม่ขึ้นกับ segment; preset ย่อได้เฉพาะขอบต้นก่อน built แรก คืนคู่จริง; ขอบปลาย unbuilt disabled และช่องกลางยัง visible ตาม Q38 |
| RP04 | fixture หลายเดือนใน §7.2 | sum เงิน/ตัวนับ และ distinct companies ตรงตัวเลขเฉลย; source ต่างเดือน/หลายใบไม่ทำ join คูณ |
| RP05 | A รับแล้วคืนมากในเดือนกลาง แต่รวมช่วงสุทธิเป็นบวก | positiveNet/cohort คิดหลัง sum ช่วง ไม่ OR positiveNet รายเดือน และไม่ sum max(netMonth,0); การเปลี่ยนเดือนทำอันดับและสมาชิก cohort เปลี่ยนตามผลรวม |
| RP06 | active ในเดือนแรก ไม่ active เดือนท้าย; paidEver/fullyRefunded เปลี่ยนระหว่างช่วง | ACTIVE ในช่วงตาม union, paid/refund cutoff เป็นเดือนท้าย ไม่ใช่ current profile หรือ OR ธงอดีต; unknown/คืนเต็มตาม decision table เดิม |
| RP07 | ขอบ built แต่เดือนกลางหาย/แถวบริษัทหาย/ก่อนสมัคร/source ก่อนเก็บ | partial/unavailable/NOT_YET_REGISTERED แยก; active/paid/ใบเสร็จเป็นอย่างน้อยตามหลักฐาน; net/cost/signed correction ไม่ใช้ lower bound; affectedMonths ครบเฉพาะ metric ที่ขาด; detail ก่อนบริษัทสมัครคง profile + null/NOT_YET_REGISTERED ไม่เป็น 404/0 |
| RP08 | เดือนเดียวผู้ใช้ 2 คน; สองเดือนเป็นคนเดิม 2 คน; invoice เดียวรับข้ามเดือน | เดือนเดียวค่าเดิม หลายเดือนผู้ใช้รวม null/P22 และ disputed count เฉพาะแยกเดือน; ไม่บวกเป็นผู้ใช้ 4 คนหรือสองใบไม่ซ้ำ |
| RP09 | ก.ค.–ก.ย. เทียบ เม.ย.–มิ.ย.; ม.ค. ข้ามปี; ALL; ฐานก่อน 0/ติดลบ/หาย/ขาดหนึ่งเดือน | คู่ก่อน L เดือนถูก; delta/percent สูตรตรง; แสดงเหตุผลต่างกันสำหรับไม่มีฐาน/ฐานบางส่วน/ฐาน 0/ฐานเงินติดลบ; ไม่ทำให้ช่วงหลักล้ม |
| RP10 | เดือนปัจจุบัน source ครบ/ช้า เทียบเดือนเต็มก่อน; metric CURRENT | ครบถึง cutoff แสดง actual delta พร้อม P29 ไม่มี extrapolation/elapsed day query; source ขาดงด delta; CURRENT ไม่มี temporal delta |
| RP11 | ช่องเดือน draft/ใช้คู่/ลิงก์เก่า month และ from=compare/ลิงก์ผิด/เดือนขึ้นใหม่ | draft ไม่ส่ง request; applied URL from/to + origin ถูก; reload คงคู่เดิม ไม่ resolve preset ใหม่; API/read/export ไม่มี origin ชน from |
| RP12 | เปลี่ยนหน้า/แท็บ/เมนู/เลขหน้า; card→list→detail→Back; จุดเดือน→list→Back | คู่เดิมและ context กลับครบ; summary/จำนวนทั้งผลกรองตรง KPI; จุดกราฟเจาะเฉพาะเดือนนั้นแล้วคืนช่วงยาว |
| RP13 | segment/status/search/pick ซ้อนกัน; clear chip/clear filters/ดูบริษัททั้งหมด/ALL | clear เฉพาะที่มีผล คงช่วง; ดูบริษัททั้งหมดล้างเงื่อนไขบริษัทแต่ไม่เลือกทุกเดือน; ALL เปลี่ยนเวลาแต่ไม่ล้าง segment; compare/detail ไม่ใช้ hidden segment |
| RP14 | โหลดคู่ใหม่แต่ response เก่ามาช้า/buildChanged; empty/source partial/error/403; layout 390 px | ไม่ปนชุดหรือช่วง; ไม่มีศูนย์ปลอม; ทุก chip/เดือน/เหตุผลอ่านได้ไม่มี page overflow; chart gap/negative/one-point/table/focus ถูก; theme เดิม |
| RP15 | ส่งออกทุกหน้า/ทุก subview/สองฝั่ง/บริษัท; directory หลายหน้าและ draft ยังไม่ใช้ | body คู่/effective filters/sort ตรงแถบและคำตอบ; ทุกแถวรวมถูก ชื่อช่วง/คำในไฟล์ตรงเว็บ; draft/โหลดใหม่ยังสร้างไม่ได้ |
| RP16 | สร้างซ้ำ hourly/full ล้มกลางทาง เดือนเก่าถูกปรับ/ป้าย CUSTOMER→TEST | build atomic ตัวนับไม่ลด revision ต่อเดือนถูก; read range ใช้ profile ปัจจุบันกับ monthly rows version เดียว ไม่บังคับ old row.buildId เท่าหัวใหม่; classification เปลี่ยนไม่ทิ้งเงินกระทบยอด |
| RP17 | workbook monthly sources/gap/partial/current/previous/ชื่อบริษัทอันตราย/ข้อมูลติดต่อไม่มีสิทธิ์ | cache/formula/กราฟตรง API, null ไม่เป็น 0, CURRENT แยกเวลา, ไม่มี code/id/full bank account, formula injection/privacy/permission regressions เดิมไม่เสีย |
| RP18 | build เก่าระหว่างอ่าน/export/ถูกถอนสิทธิ์; จำนวนแถวหลายเดือนแตะเพดาน | read reload ครั้งเดียว export 409; ไม่ส่งไฟล์เมื่อหมดสิทธิ์; row cap ตามมติ Q41 และ 422 ก่อน binary ไม่ตัดเดือน/บริษัท |
| RP19 | scope ที่ built/source ครบ | sum ทุกเดือน=ยอดช่วง; sum ทุกกลุ่ม=parent; active/paid distinct/list summary/all-page equality; การเฉลี่ยและ percent ใช้ total ไม่ average averages; churn ไม่มี field/filter/KPI จน Q39 |
| RP20 | ALL × จำนวนบริษัท/จำนวนเดือนจริงและ fixture capacity เดิม §20.2 | ตรวจเวลาหน้ารายงาน/ไฟล์และ peak memory พร้อมขอบเขตที่วัด; ไม่อ้างว่า capacity ผ่านจาก fixture 3 เดือน; ช่วงยาวไม่มี overflow สตางค์/ตัวนับและไม่ตัด trend เหลือ 6 เดือน |

### 7.2 fixture เฉลยขั้นต่ำ (ข้อมูลสมมติ ไม่ใช่ข้อมูลระบบจริง)

A สมัคร มิ.ย., B สมัคร ส.ค., C สมัคร ก.ย.; ทุกบริษัทเป็น CUSTOMER ไม่มีตัวกรอง ช่วง ก.ค.–ก.ย. 2569 เงินหน่วยสตางค์ และ source ครบ:

| บริษัท/เดือน | รับ | คืน | ใบเสร็จ | ใช้งาน |
|---|---:|---:|---:|---|
| A / ก.ค. | 10,000 | 0 | 2 | ใช่ |
| A / ส.ค. | 10,000 | 15,000 | 1 | ใช่ |
| A / ก.ย. | 0 | 0 | 0 | ใช่ |
| B / ส.ค. | 5,000 | 0 | 3 | ใช่ |
| B / ก.ย. | 20,000 | 3,000 | 2 | ไม่ |
| C / ก.ย. | 0 | 0 | 0 | ไม่ |

เฉลย: รับ 45,000 คืน 18,000 สุทธิ 27,000; สุทธิ A=5,000/B=22,000/C=0; ลูกค้าสิ้นช่วง=3 ลูกค้าใหม่=2 ใช้งานไม่ซ้ำ=2 ชำระไม่ซ้ำ=2 ใบเสร็จ=8; ผลบวกจำนวนบริษัทใช้งานรายเดือน=4 ไม่ใช่จำนวนช่วง ส่วนจำนวนชำระรายเดือน=1+2+1=4 ก็ไม่ใช่จำนวนช่วง; max(net ของ A หลังรวม)=5,000 ไม่ใช่ 10,000 จากการบวกเฉพาะเดือนบวก ฐานสุทธิบวกรวม=27,000 หากช่วงก่อนมีสุทธิ 20,000 → delta +7,000 (+35.0%) สัดส่วน/เฉลี่ยคำนวณจากจำนวนเต็มก่อนปัด

เพิ่ม case เดือน ส.ค. หาย →มีข้อมูลบางส่วน ไม่ใช้ศูนย์แทน; case ต้นทุนมี correction ติดลบ →ไม่เรียกยอดที่รู้ว่าอย่างน้อย; ผู้ใช้ A ก.ค./ส.ค. เป็นสองคนเดิม →ห้ามอ้างจำนวนรวม 4; cohort fixture ต้องมีจำนวนบริษัทมากพอผ่าน TOO_FEW_COMPANIES และมี tie ตามเกณฑ์เดิมก่อนทดสอบ 20%/80%

### 7.3 คำสั่งและข้อจำกัดในการรัน

- API เพิ่มกรณีใน `apps/api/src/modules/executive-business/executive-report-read.pg.spec.ts` และ `executive-report-build.pg.spec.ts` ที่ CI เรียกอยู่แล้ว ไม่สร้าง API spec ใหม่ ไม่แก้ package.json แม้แผนเก่า §4 เคยเสนอให้ขอข้อยกเว้น; web เพิ่มใน spec เดิม/ไฟล์ glob ได้; contract invariants ตรวจผ่าน read/build และ web specs เหล่านี้
- Focused API: `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/executive-business/executive-report-read.pg.spec.ts` และคำสั่งเดียวกันกับ `executive-report-build.pg.spec.ts` ต้อง PostgreSQL จริงของ controller; skipped เมื่อไม่มี DB ไม่ถือเป็น green ของพฤติกรรม
- Focused web: `pnpm --filter @watchdog-bms/web exec node --import tsx --test src/features/executive-reports/executive-reports.logic.spec.ts`; คำสั่งเดียวกันกับ `ExecutiveReportContent.spec.ts`, `ExecutiveReports.wiring.spec.ts` และ `executive-export.logic.spec.ts` ตามขั้นที่เปลี่ยน ไม่ใช้ tsx CLI ที่เปิด socket
- เมื่อเปลี่ยน contracts src รัน `pnpm --filter @watchdog-bms/contracts build` ก่อน API/web checks; typecheck และ whole suite ใช้ lock wrapper ที่ lane brief ระบุเท่านั้น; ไม่แก้ package.json หรือทำ migration ในงานช่วงนี้
- เมื่อเปลี่ยนคำ runtime ให้ค้นทุก API/ai-gateway/web/e2e spec ด้วยคำเก่าจากชุด P แล้วรัน focused files ที่พบ stale expectation; controller รัน script ที่ใช้ CLI/browser/real DB ภายนอก sandbox บันทึก red และ green ของแต่ละ test ที่เปลี่ยน
- รอบเอกสารนี้ตรวจลิงก์/รหัส P/สูตร fixture/ความขัดแย้งและ `git diff --check` เท่านั้น Runtime/typecheck/PG/browser/capacity เป็น not checked เพราะไม่มี code เปลี่ยนและ sandbox lane ไม่รองรับ ไม่ dispatch cloud/release หรือกดสร้างรายงานจริง

### 7.4 ความเสี่ยงและข้อเปิด

- เดือนกลางไม่มี header หรือ historical source ขาด: คืน coverage แยก metric/เดือน อย่าทำ range error ทั้งหน้า; ALL ยิ่งยาวยิ่งต้องเปิดเผยข้อขาด
- มิติปัจจุบันและแถวเดือนเก่าสร้างคนละรอบ: ใช้ classification/segment จาก profile ปัจจุบัน version เดียว และ monthly financial/counters เดิมตาม §23; ไม่แสดงว่าเป็นประเภทธุรกิจ ณ วันเกิดเงิน
- distinct users/ใบมีข้อโต้แย้งและ CURRENT snapshots: ไม่บวกซ้ำ ไม่เปลี่ยนหน่วยเอง; ใช้รายเดือนหรือแยกส่วนปัจจุบันตามสเปก
- ปัจจุบันไม่ครบเดือนเทียบช่วงก่อนเต็ม: บอก P29/cutoff เสมอ ไม่ extrapolate; กรณี source ไม่ครบห้าม delta
- ALL × ช่วงก่อน × workbook source ขยายแถว/หน่วยความจำ: reuse query เฉพาะ section, วัด capacity และคงขีดจำกัดไฟล์ ห้ามสร้าง cache/table/paging policy ใหม่โดยไม่มีหลักฐาน
- เปลี่ยน API จาก month เป็นคู่เดือน: controller ต้องประสานการปล่อย API/web/contracts และตรวจ fresh bundle/old deep links ตาม RP11 ไม่อ้างว่า migration URL ทำให้ API caller รุ่นเก่ายังรองรับ
- `from` เดิมเป็นหน้าต้นทาง: migration URL ไป origin ต้องมี RP11/12 ทั้ง deep link/history/export ไม่แก้เพียง page แรก
- Q32/Q38–Q41 ตัดสิน 2026-10-04 ตามทะเบียน BE §23.5; ผล gap analysis ยังรอ lane แยกและไม่ถือว่าปิดจากการออกแบบนี้

หลักฐาน backend R1/R3 และคำสั่ง red/green อยู่ใน [running note backend](../agent-memory/executive-period-range-backend-2026-10-04.md). R2/RP11–RP14 เป็น lane เว็บถัดไป; RP20 ความจุ ALL จริงเป็น R4/controller. ไม่มี build/schema/migration/package.json เปลี่ยน; registered build specs เดิมยังต้องรันกับฐานข้อมูลจริง.
