# Spec: คำตอบเรื่องการแก้ค่าใช้จ่ายผ่าน LINE ต้องตรงกับสิ่งที่ทำได้

สถานะ: Implemented and locally verified, including exact confirm/cancel card binding and post-commit vendor-link parity. ยังไม่ได้ deploy หรือทดสอบ LINE/UAT จริง
Owner decision: 2026-09-26 — **การแก้รายการค่าใช้จ่ายเดิมผ่าน LINE ทุกฟิลด์ต้อง preview ก่อน และเขียนจริงได้เมื่อผู้ใช้กด “ยืนยัน” เท่านั้น**
ขอบเขต: ค่าใช้จ่ายที่บันทึกจากแชท LINE; ไม่เปลี่ยนการสร้างร่างจากใบเสร็จหรือการแก้บนเว็บ

## 1. ปัญหาและเป้าหมาย

UAT 2026-09-26: ผู้ใช้ถามว่าค่าใช้จ่ายยืนยันแล้วหรือยัง บอตอ่านสถานะ `READY_FOR_CONFIRMATION` แล้วตอบ “พร้อมยืนยัน” พร้อมชวนว่า “ถ้าจะแก้ พิมพ์บอกได้เลยค่ะ” แต่เมื่อถามต่อว่า “แก้รายการได้ไหม” กลับตอบ `unsupported_yet` ว่าทำผ่าน LINE ไม่ได้และพาไปเว็บ คำถามหลังเป็นการถามความสามารถของรายการ ไม่ใช่คำสั่งเปลี่ยนค่าใด ๆ

เป้าหมายคือให้คำตอบสามจังหวะสอดคล้องกัน: **อ่านสถานะและสิทธิ์จริง → ตอบว่าแก้ผ่าน LINE ได้หรือไม่ → รับค่าใหม่เป็น preview และรอ postback ยืนยัน** คำถามความสามารถและการ preview ต้องไม่เปลี่ยนรายการ

เอกสารแม่: [LINE draft control](line-ai-draft-control-spec-th.md) §2, §5.4–5.5, [post-capture correction](line-ai-capture-correction-spec.md), [capability-help entitlement](line-ai-capability-help-entitlement-spec.md), และ [expense receipt upload](expense-receipt-upload-spec.md) ข้อกำหนดในเอกสารนี้ปิดช่องว่างระหว่างคำตอบ S-3 กับการแก้ S-4; เมื่อกติกาเดิมหรือ implementation record ระบุว่าแก้ header ทันที ให้ใช้ Owner decision ข้างต้นสำหรับงานถัดไป

## 2. กติกาผลิตภัณฑ์

1. `READY_FOR_CONFIRMATION` ต้องตอบว่า **“ยังไม่ยืนยัน อยู่สถานะพร้อมยืนยัน”** เมื่อถูกถามว่า “ยืนยันแล้วใช่ไหม” ส่วน `CONFIRMED` จึงตอบว่า “ยืนยันแล้ว” ห้ามใช้ชื่อสถานะอย่างเดียวแทนคำตอบใช่/ไม่ใช่
2. คำว่า “แก้ผ่าน LINE ได้” ใช้ได้เมื่อครบทุกข้อ ณ เวลาตอบ: ฟีเจอร์แก้ร่างเปิดใน API และ AI Gateway/AgentCore ที่ให้บริการจริง, ผู้ใช้มี `expense.update` ที่ยังใช้ได้ตาม entitlement, รายการอยู่ใน `DRAFT | NEEDS_REVIEW | READY_FOR_CONFIRMATION`, และเป็นรายการที่ผู้ใช้นี้บันทึกในแชทนี้ ภายในขอบเขตสาขาและหน้าต่าง recent capture เดิม 24 ชั่วโมง ใช้ candidate/permission/status guard เดิมเป็นแหล่งข้อมูล ห้ามอนุมานจาก feature flag เพียงตัวเดียว
3. คำถามสั้นที่ถามเพียงความสามารถ เช่น “แก้รายการได้ไหม”, “แก้บิลนี้ได้ไหม”, “รายการนี้แก้ผ่านไลน์ได้หรือเปล่า” ต้องเป็น **read-only answer** ไม่แก้ข้อมูลค่าใช้จ่าย ไม่สร้าง preview ไม่ consume pending preview/clarification และไม่บันทึก audit แบบ apply; อนุญาตเพียง event/outcome log ของ webhook ที่ใช้รับและตอบข้อความตามเดิม โดยข้าม shadow telemetry write ของคำถามนี้ด้วย หากมีหนึ่งรายการที่เข้าเงื่อนไขให้ตอบแบบมีเงื่อนไขว่า “ถ้าหมายถึงรายการค่าใช้จ่ายที่เพิ่งส่งในแชทนี้ แก้ได้ค่ะ ต้องการแก้ช่องไหนเป็นค่าอะไร” พร้อมตัวอย่างที่ทำได้จริง
4. ถ้ามีหลาย candidate ห้ามเลือกใบล่าสุดเป็นเป้าหมายการแก้; ถามว่าหมายถึงรายการไหนโดยใช้ label ที่ผ่านการจำกัดข้อมูลเดิม ถ้าไม่มี candidate ให้บอกว่าไม่พบรายการในแชทนี้ที่แก้ผ่าน LINE ได้ และให้ทางไปหน้าเว็บ ห้ามเปิดเผยว่ามีรายการของคนอื่น/บริษัทอื่นหรือสถานะของรายการที่อ่านไม่ได้
5. หากปิดฟีเจอร์, ไม่มี `expense.update`, รายการล็อก/พ้นเวลา/พ้นสาขา หรือข้อมูลสิทธิ์ไม่พร้อม ต้องไม่ชวนให้พิมพ์แก้ ทางเว็บต้องใช้ถ้อยคำตามสิทธิ์: ผู้มีสิทธิ์แก้ในเว็บเปิดแก้เองได้; คนที่ไม่มีสิทธิ์ให้เปิดตรวจสอบหรือส่งต่อผู้มีสิทธิ์
6. ข้อความที่มีค่าใหม่จริง เช่น “แก้ยอดเป็น 2,500”, “แก้วันที่เป็น 20 ก.ย.”, “ร้านชื่อ ABC”, “เพิ่มค่าบริการ 10%” เป็นคำขอแก้ ต้องเข้าทาง preview ของ `LineDraftUpdateUseCase` เท่านั้น ทุกฟิลด์ที่ LINE รองรับ รวมวันที่ ร้าน เลขเอกสาร และการ **เพิ่ม** หมายเหตุ ใช้ `expense.draft.set_header` ที่มีอยู่; หมายเหตุยังคง append และรักษา provenance เดิม ห้ามตกไป `CorrectLineCapturedExpenseUseCase.execute` เพื่อเขียนทันที คำถาม “แก้ยอดเป็น 2,500 ได้ไหม” เป็นคำขอแก้ที่มีค่าใหม่ ไม่ใช่คำถามความสามารถล้วน
7. การตอบว่าแก้ได้หรือ preview ไม่ให้สิทธิ์เขียน ปุ่ม “ยืนยัน” และ “ยกเลิก” ต้องพก previewId ของการ์ดนั้นและ recheck company, user, chat, `expense.update`, branch, status, `updatedAt`, TTL และ exact previewId ก่อน apply/cancel ปุ่มเก่าหรือ postback เดิมที่ไม่มี ID ต้องหมดอายุอย่างปลอดภัย ข้อความพิมพ์ “ยืนยันการแก้ไข/ยกเลิกการแก้ไข” ห้าม apply/cancel เพราะไม่มี ID ผูกกับการ์ด; ให้ส่งการ์ด preview ล่าสุดใหม่หรือแจ้งว่าปุ่มหมดอายุแทน การแก้ในเว็บระหว่างนั้นและการส่งซ้ำต้องไม่สร้างการเขียนซ้ำ
9. หลังยืนยันการแก้รายการใดก็ตาม ให้รัน `EnsureVendorCounterpartyFromExpenseUseCase` เมื่อข้อมูลร้านเข้า policy และทำเฉพาะหลัง expense transaction commit สำเร็จเท่านั้น เพื่อให้ parity กับ web; ห้ามเขียนคู่ค้าระหว่าง preview/rollback ใช้ snapshot/uploader/source จาก expense ที่ commit แล้ว การเปลี่ยนชื่อร้านต้อง detach counterparty link เดิมใน main transaction ก่อน autosave ร้านใหม่ ความล้มเหลวของ registry ต้องไม่ rollback expense และผล link CAS failure ต้องบอกว่า registry บันทึกแล้วแต่ยังเชื่อมรายการไม่ได้ ส่วน `SKIPPED` ไม่ต้องแสดงคำเตือน
8. เมื่อปิดฟีเจอร์ S-4 การแก้รายการเดิมผ่าน LINE ต้องไม่เขียนทันทีผ่าน legacy correction lane; ตอบวิธีทำบนเว็บตามสิทธิ์ การอ่านและการสร้างร่างใหม่ยังใช้กติกาของตัวเอง

## 3. การแยกชนิดข้อความและลำดับก่อนหลัง

- ใช้ตัวจับ **คำถามความสามารถเฉพาะรายการค่าใช้จ่าย** แบบทั้งข้อความและแบบแคบ หลังยืนยันตัวตน/บริษัท/สิทธิ์และโหลด recent candidate แล้ว ก่อนส่งเข้า intake/model router จับเฉพาะข้อความที่ไม่มีค่าใหม่ ไม่แนบไฟล์ และไม่มีเจตนาอนุมัติ ยกเลิก ชำระ หรือแก้รายการของคนอื่น ข้อความกำกวมที่ไม่ชี้ค่าใช้จ่ายและมีงานอื่นค้างอยู่ให้ถามว่าหมายถึงรายการใด
- คำถามนี้ไม่ใช่ `capability_help` ทั่วไป (“ทำอะไรได้บ้าง”) เพราะต้องอาศัย candidate, สถานะ และสิทธิ์ของรายการจริง และไม่ใช่ `unsupported_yet` เมื่อ S-4 ใช้งานได้ ตัวจับนี้ต้องไม่กลืนข้อความแก้จริงหรือคำตอบของ clarification ที่เปิดอยู่
- รักษาลำดับ postback, media, active draft/substitute, support pause, launch/feature gate และการตรวจ legal/identity ที่มีอยู่ ห้ามใช้ short path เพื่อข้าม gate เหล่านี้
- หน้าต่าง conversation 15 นาทีใช้สำหรับการอ้างอิงบทสนทนา; candidate แก้รายการใช้กฎ provenance 24 ชั่วโมงจาก `line-recent-capture` อย่านำสองระยะเวลามาแทนกัน

## 4. สัญญาข้ามโมดูลและผลกระทบ

| โมดูล/ทางเดิน | สภาพปัจจุบัน / gap | สัญญาที่ต้องเป็นจริงหลังแก้ |
| --- | --- | --- |
| API LINE webhook `process-line-webhook` | คำถาม “แก้รายการได้ไหม” ตกไป router; correction lane ยังเขียน header ได้ทันที | ตอบคำถามความสามารถจาก candidate ที่ตรวจสิทธิ์แล้วแบบ read-only; คำขอแก้ทุกฟิลด์เข้า preview; บันทึก terminal outcome/replay และ audit ให้ตรงว่า “ตอบ” หรือ “preview” |
| Expense candidate repository + `line-recent-capture` | กรอง company, creator, chat, branch, editable status และ 24 ชั่วโมงอยู่แล้ว; คืน label แบบจำกัดข้อมูล | ใช้ resolver นี้ร่วมกัน; 0/1/หลายรายการได้คำตอบตาม §2; ตรวจ candidate ใหม่ก่อนส่งคำตอบและก่อน apply ไม่ขยายการอ่านข้าม tenant |
| `expense.explain_record` API tool | `editableOverLine`/`amountEditableOverLine` คำนวณจาก flag อย่างเดียว; การอ่านด้วย record ID อาจไม่ผ่าน recent-capture resolver | ส่งคำชวนแก้เฉพาะเมื่อ permission + status + provenance + flag ผ่านจริง; การอ่านได้ไม่เท่ากับการแก้ได้; `CONFIRMED`/record ID เก่าห้ามถูกโฆษณาว่าแก้ผ่าน LINE ได้ |
| AI Gateway/AgentCore router, formatter, composer | formatter พิมพ์ “ถ้าจะแก้” จาก boolean; router คาด tool สำหรับ business intent จึงอาจแปลงคำถามความสามารถเป็น `unsupported_yet`; text และ Flex ใช้คำตอบเดียวกัน | คำตอบสถานะและคำชวนแก้ตามข้อเท็จจริงจาก API; ไม่มีคำตอบ `unsupported_yet` สำหรับคำถามความสามารถที่ short path รับแล้ว; runtime local/AgentCore ให้ผลเท่ากัน; source/link ของรายการเดียวกันทั้ง text/Flex/fallback |
| `LineDraftUpdateUseCase`, preview store, postback | มี preview/apply, `expense.update`, status, CAS, TTL และ audit อยู่แล้ว แต่ fixed postback ใช้ intent อย่างเดียว | confirm/cancel พก previewId ของ card; ปุ่มเก่า/ข้อความที่พิมพ์เองไม่มี ID จึงทำอะไรกับ proposal ไม่ได้; vendor registry side effect หลัง commit เท่านั้น |
| Legacy `CorrectLineCapturedExpenseUseCase` | เมื่อ flag เปิดยังแก้ date/vendor/documentNumber/note ทันที; เมื่อ flag ปิดยังแก้บางฟิลด์และยอดของ text note ทันที | ปิดทาง apply จากข้อความสำหรับการแก้รายการเดิม; ใช้ตัว parse/grounding ที่มีอยู่เพื่อเสนอ preview ได้ แต่ไม่ให้เส้นทางเก่ายืนยันผลว่า “แก้แล้ว” ก่อน postback; ทบทวน audit/idempotency เดิมไม่ให้เกิดสองทางเขียน |
| LINE delivery, source-state, web link | มี `rememberCandidateDeliverySources`, `correctionCandidatesCurrent`, access fingerprint, durable outcome และ Flex fallback | คำตอบที่อ้างรายการต้อง recheck source + สิทธิ์ก่อนส่ง; ใช้ deep link รายการเมื่อพิสูจน์ target ได้ มิฉะนั้นใช้หน้ารายการ; replay ไม่คำนวณสถานะใหม่แล้วส่งคำตอบเก่าที่ผิด |
| Web expenses + status/counterparty contract | เว็บเป็นทางแก้/ยืนยันเดิม; vendor autosave เป็น post-save side effect ที่ไม่ทำให้ expense save ล้มเมื่อ registry ล้มเหลว | LINE confirm ต้องสร้าง/เชื่อม vendor เช่นเดียวกับ web เฉพาะหลัง commit; แจ้ง `FAILED` แบบ honest; final confirmation, return, void และ ledger ยังเป็นทางเว็บ |
| Deploy/config | flag แยก API, AI Gateway และ AgentCore; signed UAT ล่าสุดยัง deferred การทดสอบ LINE จริง | ก่อน UAT ตรวจ exact serving flag/source ทั้งสาม runtime และทำ live three-turn acceptance; deploy ตาม runbook บังคับเมื่อมี implementation |

## 5. Bug/gap register

| ID | ระดับ | หลักฐานและผลกระทบ | สิ่งที่สเปกปิด |
| --- | --- | --- | --- |
| EEC-01 | P1 | UAT ตอบ “พิมพ์บอกได้” แล้ว `unsupported_yet` ต่อคำถาม “แก้ได้ไหม”; ไม่มีทางตอบความสามารถเฉพาะรายการ | §2.3–5 และ §3 |
| EEC-02 | P1 | `expense.explain_record` โฆษณาการแก้จาก flag แม้สิทธิ์/status/provenance ของการแก้ไม่ผ่าน | §2.2, §4 tool/formatter |
| EEC-03 | P1 | correction lane เขียน header ทันที ขัดกับ Owner decision ทุกฟิลด์ preview → ยืนยัน และข้อความอธิบาย S-4 เดิม | §2.6–8, §4 legacy lane |
| EEC-04 | P2 | ตอบ “พร้อมยืนยัน” โดยไม่ตอบ “ยังไม่ยืนยัน” สำหรับคำถามใช่/ไม่ใช่ | §2.1 |
| EEC-05 | P1 rollout | การบอกว่า API flag เปิดไม่พิสูจน์ Gateway/AgentCore flag; UAT release เดิม deferred live LINE | §4 deploy/config และ §6 |
| EEC-06 | P1 permission | legacy correction ยอม `expense.review` อย่างเดียว แต่ S-4 preview ต้อง `expense.update`; ผู้ใช้กลุ่มนี้จะเปลี่ยนจากแก้ทันทีเป็นดู/ส่งต่อ | §2.2, §2.5–8 และ acceptance permission |

EEC-03/EEC-06 เป็นผลกระทบที่ระบุในแผน implementation; การปิดทางเขียนตรงและการใช้ `expense.update` ผ่าน preview คือ behavior ที่ implement แล้ว

## 6. Acceptance และ verification

1. ทดสอบบทสนทนาเดียวกัน: ถาม “ยืนยันแล้วใช่ไหม” บน `READY_FOR_CONFIRMATION` → ตอบ “ยังไม่ยืนยัน”; ถาม “แก้รายการได้ไหม” → ตอบตามสิทธิ์และขอ field/value โดย **จำนวน preview/apply = 0**; ส่งค่าใหม่ → มี preview card แต่ committed write = 0; กด “ยืนยัน” → commit หนึ่งครั้งและ audit ถูกต้อง
2. ทดสอบ date/vendor/documentNumber/note ทีละฟิลด์ในทั้ง API correction route และ Gateway tool route: ไม่มี write ก่อน postback รวม flag-off; ยกเลิก/หมดเวลา/duplicate confirm ไม่เขียน
3. ทดสอบ `expense.update` ไม่มี, มีเพียง `expense.review`, entitlement ปิด, flag ปิดในแต่ละ runtime, `CONFIRMED`, record ID เก่า, >24 ชั่วโมง, คน/แชท/สาขา/บริษัทอื่น, 0/1/หลาย candidate: ไม่โฆษณาสิทธิ์เกินจริง ไม่เดา target ไม่รั่วสถานะ
4. ทดสอบคำถามที่มีค่าใหม่ (“แก้ยอดเป็น 500 ได้ไหม”) ไม่ถูกกลืนโดย capability path; ข้อความทั่วไป “ทำอะไรได้บ้าง”, การสร้างใบเสร็จ, active clarification, media, substitute และ final mutation ยังเข้าเส้นทางเดิม
5. ทดสอบการเปลี่ยน permission/status/branch/`updatedAt` ระหว่าง read → delivery → confirm, retry/durable replay และ Flex → text fallback: ข้อความกับปุ่มต้องตรง source ปัจจุบัน ไม่มี write จากคำถามหรือ preview; ปุ่มเก่าและข้อความ confirm/cancel ที่ไม่มี previewId ห้ามมีผลกับ latest preview
6. ทดสอบว่าการ preview ไม่เรียก vendor autosave; หลัง confirm ที่ commit แล้วเท่านั้นจึงเรียก; `FAILED` ไม่ rollback expense และมีคำตอบแจ้งความล้มเหลว; `SKIPPED` ไม่แสดงคำเตือน
7. รัน focused API/Gateway/AgentCore checks และแก้ type/test gaps ที่อยู่ใน dependency scope; UAT LINE จริงครบ three-turn journey และการตรวจ readback source/config ยังต้องทำตาม [deployment runbook](../runbooks/uat-production-v2-deployment.md) ก่อนอ้างว่าปัญหา UAT ปิดแล้ว

## 7. ขอบเขตที่ไม่เพิ่ม

ไม่มีตารางฐานข้อมูล, dependency, tool category, final mutation ผ่าน LINE หรือสิทธิ์ใหม่ ใช้ `expense.draft.*`, candidate loader, source-state และ postback ที่มีอยู่ แผน implementation ต้องระบุการตัด direct correction lane อย่างชัดเจนก่อนแก้โค้ด
