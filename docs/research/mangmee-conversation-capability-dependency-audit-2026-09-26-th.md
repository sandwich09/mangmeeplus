# Capability audit: อะไรมีแล้ว อะไรต้องซ่อม และอะไรต้องเพิ่มก่อน AI ทำได้

วันที่: 2026-09-26\
สถานะ: **อ่าน source main แล้ว; ไม่ใช่การรับรอง runtime/ทุกแพ็กเกจเปิดใช้จริง**\
Source: `origin/main@f932b57766f5dd22c0d28aedd4bc06f210e374ef` หลัง `git fetch origin main` สำเร็จ\
เอกสารที่ปรับ: [Spec v2.1](../specs/mangmee-ai-understanding-and-advisor-reliability-spec-th.md), [Plan v2.1](../plans/mangmee-ai-understanding-and-advisor-reliability-plan-2026-09-26.md), [Acceptance catalog](../qa/mangmee-conversation-acceptance-catalog-2026-09-26-th.md)

## 1. คำแก้ของผู้ใช้และข้อสรุป

ผู้ใช้พักเสียง เพราะยังไม่มีฟีเจอร์รับเสียง C13/W10/E18/E19 จึงออกจาก active scope และทุก release gate เก็บ ID ไว้เพื่อไม่ทำ traceability เดิมเสีย การมี voice spec ไม่ใช่ implemented capability และการพักเสียงไม่ขวางงานข้อความ/ใบเสร็จ

รายการ 18 ข้อก่อนหน้าเป็น target behaviors ซึ่งปนงานซ่อม AI กับ capability ใหม่ ต้องแยกให้ชัด: โมเดลเข้าใจโจทย์ได้ แต่ทำงานเฉพาะระบบไม่ได้หากไม่มีข้อมูล/API/tool/channel ที่รองรับ ในทางกลับกัน การช่วยคิดหรืออธิบายหลักการทั่วไปไม่ต้องรอ ERP tool ใหม่

งานหนึ่งจะตอบ/ทำได้ต้องตรวจตามประเภทงาน: รับ input ได้ → เข้าใจโจทย์ → มี execution path และ arguments ที่ตรงความหมาย → runtime/สิทธิ์/feature เปิด → ข้อมูลเพียงพอและเชื่อถือได้ → ส่งผลสำเร็จ การมีชื่อใน registry หรือ provider รับ PDF ได้พิสูจน์เพียงบางชั้น ไม่ใช่ทั้งเส้นทาง

คำว่า “มีแล้ว” ด้านล่างหมายถึงพบ code path ใน source ที่ pin ไม่ได้แปลว่าเปิดให้ทุกบริษัทหรือผ่าน live UAT แล้ว ไม่มีการอ่าน cloud/production configuration ใหม่ในรอบนี้

## 2. ความสามารถทางธุรกิจและช่องทางที่พิสูจน์จากโค้ด

| งานที่ผู้ใช้ถาม | สิ่งที่มีจริงใน source | ยังติดอะไร / งานที่ต้องทำ |
|---|---|---|
| สรุปค่าใช้จ่าย/แยกหมวด/ดูรายการ/อธิบายบิล | expense tools และ API adapters มีแล้ว รวม `expense.get_breakdown` | ซ่อม routing/negation/context/grounding ไม่สร้าง API สรุปหมวดซ้ำ; list_recent ใช้ expenseDate/สถานะยอดของเอกสาร ไม่ใช่ cash paid ในเดือนนั้น และ aggregate ยังไม่แยก currency; breakdown คืน 15 กลุ่มแรก ต้องแสดง completeness; grouping ไม่เท่ากับ arbitrary filters |
| ขอเฉพาะหมวด/สถานะการจ่าย/สถานะที่ tool ยังไม่รับ | web list มี filters มากกว่า LINE tool arguments; `list_recent` รับ date range/branch, breakdown รับ date range | ถ้าต้องการเปิดคำถามแบบนั้น ต้องเพิ่ม arguments/sanitizer/adapter/tests ในเส้นทาง LINE ตาม API ที่มี; prompt อย่างเดียวไม่พอ ห้ามทิ้ง filter เงียบ ๆ |
| วันนี้ต้องจัดการอะไร | มี `expense.get_daily_closing` พร้อม incurred/paid/due/overdue/review/evidence/duplicate facts แยก currency | ใช้ของเดิมและแสดง basis/limitations ไม่อ้าง fullcashflow หรือรู้รายการที่ไม่เคยเข้าระบบ |
| ถามยอดขาย | มี sales summary และ API path | underlying summary ใช้ accounting payments ฝั่ง RECEIVED และ paidAt/สกุลเงิน จึงต้องสื่อว่าเป็นยอดรับที่บันทึก ไม่เหมารวม invoice revenue/กำไร |
| ถามกำไร | มี `ledger.get_report_summary` และ `ledger.get_financial_summary` เรียก P&L/report จาก posted ledger | ใช้ได้เมื่อมี entitlement/สิทธิ์และ ledger data ที่เหมาะสม; expense-only ไม่พอวิเคราะห์กำไรจริง ต้องตอบข้อมูลที่ขาด ไม่สร้างตัวเลข |
| ถามยอดบัญชีธนาคารผ่าน LINE | มีชื่อ `bank.get_account_balances`/`bank.get_reconciliation_status` ใน registry และมี report backend บางส่วน | ยังไม่มีสอง tool adapters ใน API toolMap/DI ที่ตรวจ; ตอบ SOURCE_MODULE_NOT_READY จึงต้องเชื่อม backend→LINE tool ก่อน ไม่ใช่เพิ่ม prompt หรืออ้างไม่มีระบบธนาคารเลย |
| สต็อก/CRM/นัดหมาย/จัดซื้อ/ภาษี/แจ้งเตือน | มีหลาย API tool families; ไม่ใช่ทุกชื่อใน registry ที่ executable | ตรวจทีละ tool/arguments/DI ไม่ใช้ชื่อแพ็กเกจหรือ capability group เป็นหลักฐานว่าทำได้ทั้งหมด; known financial semantics gaps ยังเป็น gate ของ family นั้น |
| รับรูป/ไฟล์/PDF เพื่ออ่านหลักฐานและร่างค่าใช้จ่าย | webhook, attachment intake, pending media/read jobs, receipt extraction และ PDF capture reader มีแล้ว | ซ่อม field-local evidence, totals/date roles, continuity/retry; PDF reader path ผูกกับ provider ที่รองรับจริง |
| ถามภาพสินค้า/สกรีนช็อต หรือสรุปหน้า 2 ของ PDF ทั่วไป | มี ingestion/vision เป็นฐาน แต่ path ที่ตรวจยัง expense/capture-oriented | ต้องเพิ่ม question-only execution/output/page grounding โดยไม่สร้าง expense; ส่ง caption ไป text route ไม่เท่ากับตอบจาก pixels/pages แล้ว |
| แก้บิลและกดยืนยัน | PR819 รวม main แล้ว มี previewId/claim/revision/permission checks | reuse flow นี้; U15/U24 และ actual LINE acceptance บน candidate ยังต้องพิสูจน์ ไม่ทำ fix ซ้ำ |
| ช่วยคิด อธิบาย แปล ร่างข้อความ | general/casual composer มีแล้วและอนุญาต business concepts | router/direct-answer policies ขัดกัน ต้องแก้และทดสอบร่วมกัน; ไม่จำเป็นต้องเพิ่ม business module สำหรับคำถามทั่วไป |
| สอนใช้มั่งมี | capability help + numbered walkthrough มีแล้ว | ปรับตามคำถาม/สิทธิ์และตรวจ executable capability; full approved knowledge packs/retrieval ยังไม่พบ end-to-end path |
| ค้นอินเทอร์เน็ต/ข้อเท็จจริงล่าสุด | ไม่พบ public-search tool/adapter path ใน runtime ที่ตรวจ | capability ใหม่: approved connector, source/date/citation/egress/budget; ERP search ไม่ใช่ web search |
| จำความชอบข้ามครั้ง | มี opt-out preference ของ AI แต่ไม่ใช่ความจำภาษา/ความละเอียด | เพิ่ม scoped opt-in fields/list/update/delete/expiry; ไม่ใช้ opt-out use case เป็นหลักฐานว่ามี conversational memory แล้ว |
| รับเสียง | ไม่มี employee audio/STT path ที่พบ | พักตามผู้ใช้ ไม่สร้างและไม่เป็น dependency |

## 3. Mapping กลับไปยัง 18 IDs เดิม

ประเภท: **ซ่อม** = มีเส้นทางหลักแล้ว; **ต่อให้ครบ** = มีฐานบางชั้นแต่ต้องเพิ่ม wiring/state/contract; **ใหม่** = ยังไม่มีความสามารถนั้นครบ; **พัก** = ไม่อยู่ในงานปัจจุบัน รายการหนึ่งมีหลายประเภทได้ แต่ต้องแยก sub-capability ใน acceptance

| ID | สถานะตามโค้ด | สิ่งที่ทำเพิ่มและ dependency |
|---|---|---|
| C01 โมเดล | มี providers/factory/model policy | ต่อ model capability/budget manifest และ benchmark; ไม่บังคับเปลี่ยน model ก่อนแก้ระบบ; W11 |
| C02 เข้าใจภาษา | มี semantic intake/prepared plans; ยังมี veto จากข้อความดิบ | ซ่อม interpretation/validation/route บน tools ที่มี; W01→W03; filter ที่ tool ไม่รับแยกเป็น integration |
| C03 ทำตามคำขอ | มี persona/prompts | ซ่อม policy consistency/style/constraints; อ้างคำตอบก่อนหน้าต้องพึ่ง C04; W04 |
| C04 บริบท | มี ledger/intake state/context แต่ wire/owner/history projection ไม่ครบ | ต่อ transport และ owner-bound safe task projection/CAS/expiry; ไม่คืน raw private replies; W01→W02→W03 |
| C05 ความชอบถาวร | ยังไม่มี conversational preference path | ใหม่; W02→W12; R3 ไม่ block R1 |
| C06 รับคำแก้/หยุดวน | มี correction, pending tasks, tool outcomes | ซ่อม continuation/recovery/anti-loop; W03/W06; no retry bypass permissions |
| C07 ความรู้ทั่วไป | มี general composer แต่ routing/direct gate ขัดกัน | ซ่อมของเดิม; W04 ไม่ต้องรอ web search/ERP เพิ่ม |
| C08 Product help | help/walkthrough มี; approved pack retrieval ยังไม่ครบ | R1 ใช้ help เดิมอย่างตรง capability; R2 เพิ่ม approved retrieval/source pipeline W08 |
| C09 ค้นข้อมูลล่าสุด | ยังไม่พบ public lookup runtime | ใหม่; W09 พึ่ง source policy/connector/budget/citations; R2 |
| C10 หลายขั้น/หลายคำขอ | มี orchestrator/tool registry/prepared lane | ซ่อม transport/coverage/loop/recovery บน tool ที่ wired จริง รวม tool เดียวหลายงวด (JSON loop ปัจจุบันยอม repeat เฉพาะ expense.list_recent); W01/W06 ไม่เปิด native โดยอัตโนมัติ |
| C11 ตัวเลข | มี backend totals/calculators/formatters | ซ่อม metric/unit/basis binding; hypothetical arithmetic ต้องมี bounded deterministic path; เพิ่มเฉพาะส่วนที่ไม่มี ไม่ให้ LLM สร้าง ERP facts; W05 |
| C12 ภาพ/PDF | receipt/document capture มี; general attachment Q&A ยังไม่ครบ | W07A ซ่อมเดิม R1; W07B ต่อ question-onlyR2 อาศัย reader/provider/sourcegrounding; แยก gates |
| C13 เสียง | ไม่มี audio/STT execution path ที่พบ | พัก W10; ไม่มี active dependency |
| C14 ตรวจคำตอบ | มี validators/source refs/read evidence | ซ่อม local fact binding/coverage/citation validation ตาม lane ไม่สร้าง critic ทุก turn; W05/W06/W07 |
| C15 ส่ง/ยกเลิก | มี durable delivery และ cancel preview; ไม่มี end-to-end active-turn cancel ที่ครบ | reuse delivery; ต่อ cancel signal/revision/deadline/late-result guard; cancel draft ≠ cancel model ที่กำลังรัน; W13 |
| C16 ความเร็ว/ต้นทุน | มี prepared reads/timeouts/metering | ต่อ whole-turn budget/abort/body deadline และวัดจริง; W11/W13 ไม่อ้าง SLO จาก unit tests |
| C17 วัดและเรียนจากข้อผิดพลาด | มี unit/regression/corpus infrastructure | ขยาย scenario/held-out/blind review/feedback-to-reviewed-fixture; W14 ไม่ auto-train จากลูกค้า |
| C18 สิทธิ์/ยืนยัน | API permission/tenant/branch และ preview guards มี | reuse และทดสอบทุก path ใหม่; แก้ newcontext/retrieval isolation ไม่สร้าง permissionframework ใหม่ |

## 4. ต้องให้ AI รู้ capability ที่ทำได้จริงใน turn นั้น

ใช้ registry, `lineToolRegistryFor`, `hasToolPermissions`, `hasToolFeature`, channel rules และ serving-flag/probe เดิมเป็นฐาน ไม่ตั้ง registry อีกชุด สิ่งที่ต้องเติมคือการพิสูจน์ wiring/argument support และส่งภาพรวมที่สอดคล้องกันเข้า intake/planner/help/renderer

1. Build/parity checks แยก execution kind ก่อนเทียบ tool registry กับ API controller toolMap/DI หรือ API intake handler สำหรับ capture รวม provider capability ที่งานต้องใช้; registered-but-unwired จริงเป็น not_implemented ไม่ใช่ allowed plan tool การมี capture ผ่าน intake แต่ไม่อยู่ read-toolMap ไม่ใช่ missingcapability
2. Runtime snapshot จาก trusted server ระบุ operation, supported inputs/basis/limits, channel, effective flags, feature/permission/scope และ source/artifact version; ไม่รับค่าที่ model แต่ง ไม่ probe ทุก tool เพิ่มทุก turn โดยไร้เหตุ
3. เลือกเฉพาะ operation ที่ทำได้ตาม snapshot; API ยังตรวจสิทธิ์และ source อีกครั้งตอนทำงาน Snapshot ไม่ใช่ authorization token และ availability อาจเปลี่ยนระหว่าง turn
4. Actual data sufficiency ตรวจจากผล permission-checked read; ไม่ prefetch private facts เพียงเพื่อตอบว่า “ทำอะไรได้บ้าง” Missing data ไม่เท่ากับ missing tool
5. แยกเหตุให้ผู้ใช้เข้าใจ: ยังไม่มีเครื่องมือ / ทำได้ในเว็บแต่ยังไม่ผ่าน LINE / feature ปิด / ไม่มีสิทธิ์ / ข้อมูลไม่พอ / ระบบขัดข้อง / ต้องยืนยัน ไม่ตอบรวมว่า “อยู่นอกขอบเขต” และไม่วนลิงก์เดิม

เช่น “สรุปแยกหมวด” ต้องทำบน `expense.get_breakdown` ที่มีอยู่; “เฉพาะหมวด X ที่จ่ายแล้ว” ต้องตรวจ argument support ก่อนรับปาก; “กำไรคืออะไร” ตอบหลักการได้โดยไม่อ่าน ERP; “กำไรร้านฉันเท่าไร” ต้องมี P&L/data ที่ใช้ได้; “ส่งเสียงมาได้ไหม” ต้องบอกว่ายังไม่รองรับ ไม่เสนอให้ส่งเพราะแผนอนาคตมี STT

## 5. ลำดับงานที่ขึ้นกับ capability จริง

- **เริ่มก่อน:** W00 inventory/parity/argument matrix + W01 clarification/coverage wire จาก main ที่รวมปุ่มแล้ว
- **R1:** ซ่อมเข้าใจภาษา/context/general answer/tool planning/numeric grounding/receipt เดิม/delivery ใช้ existing capability; เพิ่มเฉพาะ state/validation/cancel contracts ที่จำเป็นต่อพฤติกรรมนี้
- **API→LINE gaps:** ถ้าขอบเขตคำถาม R1 ต้องใช้ filter/tool ที่ยังไม่ wired ให้เพิ่ม adapter/arguments และ tests ก่อนเปิดคำถามนั้น; ถ้าไม่อยู่ supportedset ต้องตอบข้อจำกัดตรงงาน ไม่มีข้ออ้างว่าปรับ prompt แล้วรองรับทันที
- **R2:** approvedknowledge retrieval, publiclookup, general image/PDF Q&A เป็นงาน capability ใหม่ มี gates ของตน; ไม่ขวางการแก้ falseblocks ใน R1
- **R3:** opt-in conversationalpreferences หลัง owner-boundcontext พร้อม
- **พัก:** voice/audio/STT และ FinancialProfile/FinancialServicesNeeds ไม่อยู่ criticalpath

## 6. Source evidence ที่อ่าน

เลขบรรทัดต่อไปนี้อ้าง Git object `f932b577`; working tree อาจมีบรรทัดต่างกัน อ่าน symbol พร้อม SHA เป็นหลัก

| Evidence | Source และสิ่งที่พิสูจน์ |
|---|---|
| E-CAP-01 | [registry/helpers](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/packages/contracts/src/ai-tools.ts#L20): flag-dependent draft tools; `usableCapabilityGroupIds` 210–217 ใช้ any permitted+entitled tool เป็น group ไม่พิสูจน์ว่า group ทั้งก้อน wired |
| E-CAP-02 | [API toolMap](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.ts#L229): banktools ที่ register924/936 ไม่มีใน toolMap229–294/DI list; not-ready fallback489–491 ขณะที่ accounting summary ที่ comment บอก stub ถูก wired259–260 แล้ว จึงเชื่อ code มากกว่า comment |
| E-CAP-03 | [expense arguments](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/packages/contracts/src/ai-tools.ts#L401): list_recent date/branch; breakdowndate ที่ 920; เปรียบเทียบ webexpensefilters กับ toolarguments ก่อนขยาย semanticclaim |
| E-CAP-04 | [ERP adapters](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/apps/api/src/modules/line-ai/application/use-cases/erp-tools.use-case.ts#L158): ledger/P&Lpath; sales420–464 ใช้ RECEIVEDpayment/paidAt ไม่ใช่ invoiceprofit |
| E-CAP-05 | [general composer/help](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts#L63): generalconceptprompt และ help231–276 เทียบ [router](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts#L65) และ [directgate](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/apps/api/src/modules/line-ai/domain/logic/line-advisor-direct-answer.logic.ts#L60) ที่ขัดกัน |
| E-CAP-06 | [webhook media](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/apps/api/src/modules/auth/presentation/line-webhook.controller.ts#L106): text/image/file ไม่ใช่ audio; process-line-webhook attachment6490–6500/clarify6602–6635/illustration4200–4207; [nonreceipt reply](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/apps/api/src/modules/line-ai/domain/logic/line-non-receipt-reply.logic.ts#L129) ยัง expense-specific |
| E-CAP-07 | [capture PDF reader](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts#L780): Bedrockdocument reader ใน captureendpoint ไม่ใช่ genericPDFQ&A |
| E-CAP-08 | [AI preference](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/apps/api/src/modules/auth/application/use-cases/set-ai-assistant-preference.use-case.ts#L18): aiAssistantOptOutAt เท่านั้น; `AiConversation` ไม่มี language/detailpreferencefields |
| E-CAP-09 | [context loader](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts#L6116): genericquerycompany/user แต่ไม่ chat; rawassistantreplies ถูกตัดตาม AP21; deliveredExpenseSummary rechecks มีแล้ว ต้องต่อ safeprojection ไม่คืน raw ทั้งหมด |
| E-CAP-10 | [runtime contract](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/apps/ai-gateway/src/modules/line-ai/infrastructure/runtime/runtime.port.ts#L4): clarification/coveragewiregap ตาม audit เดิม; [edit capability](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.ts#L127) ตรวจ effectiveflag ก่อนเสนอ edit |

การตรวจใช้ `git show`, `git grep`, `git diff` และอ่าน path ที่เกี่ยวข้องใน `apps/packages` ไม่รันทดสอบแอป/provider และไม่แตะ cloud Negative findings ใช้ถ้อยคำ “ไม่พบเส้นทางที่ครบใน source ที่ตรวจ” ไม่อ้างว่าไม่มี implementation ที่อื่นทุกแห่ง รายละเอียด reproduction ของ bug ที่มีอยู่แล้วอยู่ใน [code verification](mangmee-ai-code-verification-2026-09-26-th.md)
