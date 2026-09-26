# Mangmee AI — Consistency, bugs, gaps และ dependency impact

วันที่: 2026-09-26 • สถานะ: source audit + pure probes; แก้เอกสารเท่านั้น

ตรวจ spec/plan v2.1 เทียบ `origin/main=f932b57766f5dd22c0d28aedd4bc06f210e374ef` หลัง fetch สำเร็จ แล้วปรับเป็น v2.2 ไม่ใช้ dirty workspace HEAD เป็น release baseline ไม่ตรวจ cloud/provider/customer data และไม่รับรอง live readiness หรือความเร็วใหม่

**ข้อสรุป:** แผนเดิมครอบคลุมความเข้าใจ แต่ยังไม่พอสำหรับ integration ที่ถูกต้อง พบ16ประเด็นด้าน semantics, source calculation, owner/lifecycle, media, access, delivery และ budget ด้านล่าง บางข้อเป็นบั๊กที่แสดงได้จาก source/pure function บางข้อเป็น race/risk ที่ยังต้อง integration test และบางข้อเป็นข้อผิดพลาดของแผนเอง ห้ามนับทุกข้อเป็น incident ที่เกิดกับลูกค้าแล้ว

ใช้ร่วมกับ [spec](../specs/mangmee-ai-understanding-and-advisor-reliability-spec-th.md), [plan](../plans/mangmee-ai-understanding-and-advisor-reliability-plan-2026-09-26.md), [acceptance](../qa/mangmee-conversation-acceptance-catalog-2026-09-26-th.md), [capability inventory](mangmee-conversation-capability-dependency-audit-2026-09-26-th.md) และ [audit เดิม](mangmee-ai-code-verification-2026-09-26-th.md) ตัวเลข line ด้านล่างอ้าง Git object f932; workspace อาจมี WIP จึงตรวจซ้ำด้วย `git show f932b577:<path>` ก่อนแก้

## สิ่งที่ต้องแก้/เพิ่มใน release ที่เกี่ยวข้อง

### CI01 — ช่วงเดือนหายระหว่าง schema กับ API • P1 • source bug + pure probe

`ledger.get_financial_summary` adapter รับ `periodKey` แต่ registry ไม่ประกาศ จึงถูก sanitizer ทิ้ง เช่น `{periodKey:2026-08}` กลายเป็น `{}` แล้ว API default เดือนปัจจุบัน AI อาจตีความถูกตั้งแต่ต้นแต่คำตอบผิดงวด

หลักฐาน: [registry](../../packages/contracts/src/ai-tools.ts) f932:378–388; [sanitizer](../../apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts) :487; [adapter](../../apps/api/src/modules/line-ai/application/use-cases/erp-tools.use-case.ts) :164–169

แก้ใน W01/W05/W06: ประกาศ/validate input ตรงกัน หรือ retire ผ่าน explicit compatible mapping; ห้ามเปลี่ยน permission/basis เงียบ ๆ ทดสอบ registry→sanitizer→delegation→adapter ทั้ง prepared/JSON/native ที่เปิด และ assert actual requested/applied period (E11/E14)

### CI02 — วันผิด/ช่วงไม่ครบมีความหมายต่างกันข้าม tools • P1 • source behavior + pure probe

Expense list ใช้ strict civil-date/full-range checker แต่ sales/breakdown ใช้ regex-only helper: `2026-02-30` ผ่าน, `toDate` อย่างเดียวเริ่ม1970 และ invalid ทั้งคู่กลับ current month ไม่มีทางให้ renderer แก้ยอดที่อ่านผิด scope แล้ว

หลักฐาน: [period helper/strict path/sales](../../apps/api/src/modules/line-ai/application/use-cases/erp-tools.use-case.ts) :219–238,414; [breakdown](../../apps/api/src/modules/line-ai/application/use-cases/erp-business-tools.use-case.ts) :309

แก้ใน W01/W05/W06: กำหนด partial/default policy ต่อ operation; shared validation แยก omitted/invalid; คืน effective period/date basis ทดสอบ leap/invalid/reversed/partial และ summary↔breakdown↔sales parity (E11/E14)

### CI03 — “เฉพาะสาขา A” รวมส่วนกลางเฉพาะบาง tool • P1 • source inconsistency

Sales เลือก A OR null-central แม้ระบุ branchA; expense list/daily closing เลือก A เท่านั้น เทียบรายรับกับรายจ่ายจึงอาจใช้คนละ population ทั้งที่แต่ละ query ผ่าน permission แล้ว

หลักฐาน: [sales](../../apps/api/src/modules/line-ai/application/use-cases/erp-tools.use-case.ts) :419–429; [expense predicate](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts) :868; [daily closing](../../apps/api/src/modules/line-ai/application/use-cases/erp-expense-daily-closing.use-case.ts) :166–169

แก้ใน W05/W06: แยก permission scope จาก requested branch; central inclusion ต้อง explicit ใน effective scope และ consistent ก่อน compare ทดสอบ A/B/null-central กับ actor จำกัด/ไม่จำกัดสาขา (E11/E14) การรักษาพฤติกรรม legacy ต้องระบุชัด ไม่เปลี่ยน reporting policy เงียบ ๆ

### CI04 — `truncated:false` ไม่พิสูจน์ยอดรวมเมื่อข้อมูลเปลี่ยนระหว่างอ่าน • P1 • source race; ยังไม่ reproduce ด้วย DB

Expense summary รวมหลาย OFFSET pages โดยไม่มี shared snapshot หากแทรก/ย้ายวันที่ระหว่างหน้า รายการอาจซ้ำ/หาย แม้จำนวนเท่าเดิมและ truncated=false จึงต้องแก้ source aggregation ก่อนเพิ่ม completeness label

หลักฐาน: [paging/reduce](../../apps/api/src/modules/line-ai/application/use-cases/erp-tools.use-case.ts) :322–356; [OFFSET repository](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts) :861; reuse [accounting aggregate](../../apps/api/src/modules/line-ai/application/use-cases/erp-business-tools.use-case.ts) :52 และ daily-closing transaction patterns

แก้ใน W05: permission-scoped DB aggregate และ bounded rows ภายใต้ consistent source snapshot; ไม่ใช้ count equality เป็น proof Test >100 rows + concurrent insert/date move และกลุ่มเกิน15/rowsเกิน5 (E10/E11) กระทบ expense summary/performance/query plan แต่ไม่ต้องเพิ่ม analytics service

### CI05 — Decimal เสีย precision ก่อนถึง AI • P1 • source bug + boundary probe

`deriveBalance` แปลง Decimal กลับ Number; P&L รวมแบบ float แล้ว toFixed(4) ตัวอย่างค่าที่ schema Decimal(18,4) รับได้ `90071992547409.9900` กลายเป็น `90071992547409.9844` จึงเสียถึงสตางค์ใน boundary นี้ ไม่ใช่หลักฐานว่าทุกรายการ SME ปกติผิด

หลักฐาน: [deriveBalance](../../apps/api/src/modules/ledger/domain/logic/journal-balance.logic.ts) :80; [P&L](../../apps/api/src/modules/ledger/application/use-cases/report.use-case.ts) :109; [schema](../../apps/api/prisma/schema.prisma) :3422

แก้ใน W05/W14: exact arithmetic จน serialize ด้วย helpers เดิม ไม่กู้ด้วย prompt/renderer/tolerance ตรวจ LINE+web reports+exports ที่ reuse source (E11) และ revalidate downstream contracts ที่เคยคาด number

### CI06 — Dataset ของ monthly report เปลี่ยนตามสิทธิ์ • P2 • source/design gap

ผู้มี ledger permission ได้ P&L ก่อน ผู้มี CRM อย่างเดียวได้ sales summary โดยไม่มี dataset selector จึงเพิ่มสิทธิ์แล้วได้คำตอบคนละชนิด ทั้งที่ถามเหมือนเดิม

หลักฐาน: [report adapter](../../apps/api/src/modules/line-ai/application/use-cases/erp-report-tools.use-case.ts) :23,42–50; [registry](../../packages/contracts/src/ai-tools.ts) :1003

แก้ใน W00/W01/W05/W06: หากเป็น default report ต้องประกาศ default/basis ชัด; explicit sales/P&L ต้องเลือก validated metric/tool ก่อนตรวจสิทธิ์ ไม่ให้ permission เลือกโจทย์แทนผู้ใช้ Test เพิ่มสิทธิ์แล้ว explicit sales ยังเป็น sales (E11/E14)

### CI07 — Owner และ lifecycle ใหม่ยังไม่ครอบคลุม OA instance/การเพิกถอน • P1 • integration gap

`AiConversation.channel` คือชนิด `line` ส่วน chat hash ไม่รวม messagingChannelId จึงต้องเพิ่ม verified OA instance ใน full owner ของ v2 หาก company/user/chat เดียวกันผ่านคนละ OA ต้องไม่แชร์ context/preferences อีกทั้ง opt-out เดิมแก้ timestamp, unlink ลบ LineCompanyContext, employee DISABLED ลบ AiConversation และ cascade AiTurn เป็นคนละ lifecycle ที่ต้อง map ให้ชัด

หลักฐาน: [schema](../../apps/api/prisma/schema.prisma) :1630,1673; [webhook](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts) :1038–1039; [delivery owner](../../apps/api/src/modules/line-ai/application/line-delivery-access.ts) :35–36; [opt-out](../../apps/api/src/modules/auth/application/use-cases/set-ai-assistant-preference.use-case.ts) :18–22; [unlink](../../apps/api/src/modules/auth/application/use-cases/unlink-line-identity.use-case.ts) :50–52; [DISABLED](../../apps/api/src/modules/employee-access/application/use-cases/set-employee-status.use-case.ts) :80–82

เพิ่ม W02/W12/W13: full owner + event disposition + stale-writer invalidation ตาม spec§16.2–16.3 ไม่เพิ่ม memory service; late worker ห้ามสร้าง state ที่ลบกลับมา Test 2OA/opt-out-enable/unlink-relink/disable-reactivate/delete while pending (E02/E05/E21/E22) ยังไม่ยืนยัน current live cross-OA leak

### CI08 — PendingMedia ยังถือรูปเดิมเมื่อรูปใหม่เข้ามา และ owner ไม่ครบ • P1 • reachable source behavior + latent isolation gap

Same1:1: A pending → B message ใหม่เข้า CLARIFY/BUSINESS_READ/UNSUPPORTED; `ensurePendingMedia` comment บอก repoint แต่คืน A ทันที ไม่เก็บ B อาจถามเกี่ยวกับ B แล้วใช้ A ต่อ One-pending policy ใช้ได้แต่ต้อง disclose preserve/replace/supplement/new-document ส่วน load company/user-only ต้องปรับก่อนขยาย context/group lanes

หลักฐาน: [webhook](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts) :4129–4180,6508,6560–6632,7662–7670,7932–7942; [PendingMedia schema](../../apps/api/prisma/schema.prisma) :8556

เพิ่ม W02/W07A: trusted owner ของ pending+attachment+intake+job และ explicit replacement choice; transport redelivery≠new image; legacy unbound pending ไม่ auto-adopt Test A→B/ด้านหลัง/อีกใบ/คำตอบสั้น/old OCR arrives/cross-chat (U18/E12/E13) **ข้อจำกัด:** sync create ปัจจุบันผ่าน1:1 guard จึงไม่ใช้ schema gap นี้อ้างว่าพิสูจน์ group leak แล้ว

### CI09 — Async result callback มี entitlement fail-open และขาด branch/source proof • P1 • source-supported security risk

Notifier catch entitlement read error→null ซึ่งถูกยอมผ่านเหมือน legacy-no-rows; permission check ไม่ตรวจ current branch scope และ finished snapshot ไม่มี branch/source revision ที่ต้องใช้ recheck เงื่อนไขเสี่ยงคือเข้า job ได้ก่อน แล้วสิทธิ์สาขาถูกถอน/lookupล่มก่อน push ขณะยังมี capture permission บางส่วน

หลักฐาน: [notifier](../../apps/api/src/modules/line-ai/application/use-cases/line-capture-result-notifier.use-case.ts) :180–221,378–403; [snapshot](../../apps/api/src/modules/expenses/application/use-cases/expense-capture-line.use-case.ts) :92–128; [entitlement helper](../../apps/api/src/modules/employee-access/application/entitlement.helper.ts) :68–74

แก้ W07A/W13: deny/unavailable แยก legacy absence; reauthorize current actor/branch/channel/source-job revision ก่อน financial push ผ่าน existing access patterns; park/retry outcome โดยไม่ทำให้ committed data หาย Test queued→revoke/throws/stale source→no private push (E02/E05/E23) **opt-out มีตรวจแล้ว** ไม่เขียนซ้ำ และยังไม่มี DB/live leak reproduction

### CI10 — General fallback/group lane ต้องผ่าน global gates และไม่ prefetch private data • P1 • design gap

Domain feature unavailable ไม่เท่ากับ AI opt-out/AI entitlement off/support/legal/launch/usage rejection การเปิด general ต้องไม่ bypass gates เหล่านี้ ใน group การห้าม company tool อย่างเดียวไม่พอเพราะ intake โหลด expense categories ก่อนแล้ว; private delivery guard ยัง1:1 จึงต้องออกแบบ public/general path แยก

หลักฐาน: [webhook](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts) :2078,2116,3360–3361; specเดิม§6,§11

เพิ่ม W01/W03/W04/W13: common admission + zero private prefetch + truthful delivery proof; ไม่คลาย private guard/CRM OA policy Test group loader→intake→send และ gate denials provider0 (E02/E14/E17) ไม่ใช่ authorization ให้เปิด group financial lane

### CI11 — General PDF/image Q&A ติด capture admission ก่อนถึง semantic router • P1 สำหรับ R2 • design/implementation dependency

ปัจจุบัน media ตรวจ receipt/signature permission และ module, checksum shortcut ตอบบิลเก่า และ file fast path เข้าจับเอกสารก่อน semantic routing แก้ router อย่างเดียวจึงยังปฏิเสธคนไม่มี upload หรือสร้าง draft เมื่อขอแค่สรุปหน้า2

หลักฐาน: [webhook](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts) :6339–6350,6436,6467–6475

เพิ่ม W07B: common gates → question/capture admission → correct reader; fileเดิมคำถามใหม่ไม่ถูก capture dedupe; question-only writes0, no upload permission workaround Test no-upload/query-only, samePDF/newquestion, corrupt file, all global gates (E13/E14/E17) งานนี้ R2 ไม่ block receipt fixes R1

### CI12 — Cancel หลัง UNKNOWN/commit ต้องไม่สัญญาว่าถอนหรือย้อนสำเร็จ • P1 • design race + PR819 regression boundary

Ledger เขียน UNKNOWN ก่อนส่ง HTTP จึง responseหาย≠ยังไม่ถึงผู้ใช้ Cancel suppress ได้แน่นอนเฉพาะก่อน dispatch; หลัง commitต้องรักษาผลจริง PR819 มี vendor/counterparty autosave หลัง expense commit และ final revision อาจเปลี่ยนอีกครั้ง จึงห้ามล้าง proof/rerun apply หรือใช้ cache revision เก่า

หลักฐาน: [ledger send](../../apps/api/src/modules/line-ai/application/line-ledger-delivery.service.ts) :54–59; [drain](../../apps/api/src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.ts) :368–375; [draft update](../../apps/api/src/modules/expenses/application/use-cases/line-draft-update.use-case.ts) :279,401–410,449–457

เพิ่ม W02/W07A/W13: PREPARING/READY/UNKNOWN/ACCEPTED/COMMITTED matrix, atomic revision before first dispatch, current access on replay, exact saved batch, preserve APPLIED/final revision Test cancel after lostresponse/commit/autosave link failure/doubletap/retry (U15/U24/E07/E23) ปุ่มยืนยัน fix MERGED แล้ว **ไม่สร้าง fix ซ้ำ**

### CI13 — Repair2/context16KiB ชน budget guard และ rollout version • P1 • pure-probe design conflict

ในเส้นทางที่ enforce budget envelope (SPLIT), intake text/image maxCalls1; receiverเทียบ bounds exact จึงเพิ่ม round2หรือเปลี่ยน table ฝั่งเดียวไม่ได้ Existing guardทำงานถูก ไม่ควรปิดเพื่อให้ AI ตอบได้ นอกจากนี้ text estimator นับ UTF-8 bytes: synthetic Thai state16383bytes + prompt4000 =20383 เกิน intake20000 ก่อนนับส่วนอื่น ไม่ใช่หลักฐานว่า promptจริงทุก turn เกิน

หลักฐาน: [bounds/parser](../../packages/contracts/src/ai-budget-bounds.ts) :78–80,185–194; [provider estimator/guard](../../apps/ai-gateway/src/common/usage/ai-budget-provider.ts) :109–174; [probe](../evidence/mangmee-ai-readiness-2026-09-26/consistency-budget-probes.json)

เพิ่ม W01/W02/W11: round→versioned step→hold/price mapping, coordinated compatible artifact switch, per-invocation input allocator; old lane คง1callจนพร้อม ไม่เพิ่ม context/maxCalls โดยไม่มี reserve Test oldAPI/newGatewayและกลับกัน, Thai/bigcatalog/repair/quota/zero unheld calls (E03/E20)

### CI14 — Spec195s whole-job ลด capability เอกสารหลายหน้าโดยไม่ตั้งใจ • P1 • corrected spec bug

195s เป็น capture client per-HTTP timeout ที่อิง legacy OCR; resumable capture มี40calls/15min accumulated run/5attempts กับ120slease/checkpoints การเอา195sเป็น totalทุกjobอาจตัด paid pages/resume และผิด budget recovery

หลักฐาน: [capture runner](../../apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts) :37–44,253–267,329–337; [client](../../apps/api/src/modules/expenses/infrastructure/expense-capture-read.client.ts) :25,193

แก้ spec§20/W07/W11/W13: แยก sync deadline, legacyOCR, resumable job, lease, clienttimeout; keep existing capture ceilings/partial-paused-resume และ spentbudget across restarts; W07B declare own admission ไม่ inheritโดยเดา Test multipage/recovery/late result/admission-to-terminal (E12/E20/E23) p95ยังเป็น target ไม่ใช่ measured

### CI15 — Public lookup ยังไม่มี accounting ของค่าบริการที่ไม่ใช่ tokens • P2 สำหรับ R2 • future integration gap

Pricing ปัจจุบันคิด input/output/cache tokens หาก connector ใหม่คิด per-search/per-open การจำกัดจำนวน tool calls ไม่ทำให้ reserve/settlement รองรับค่าบริการนั้นโดยอัตโนมัติ ไม่ใช่ incident ของ public lookup ที่เปิดอยู่ เพราะ capability นี้ยังใหม่

หลักฐาน: [model pricing](../../apps/api/src/modules/line-ai/application/ai-model-pricing.ts) :57–66,100–114

เพิ่ม W09/W11: approved priceable adapter + external units/price version/hold/settle หากมีค่าบริการนอกtokens Test paid call/outage/retry/insufficient reserve; ถ้า adapterไม่มี externalfee ให้ manifest ระบุและพิสูจน์ (E17/E20) ไม่ block R1 และไม่เลือก provider ใหม่ในงานนี้

### CI16 — Acceptance R1 เผลอพึ่ง question-only R2 และ side-effect tests ต้องกว้างกว่า model • P1 • plan gap

J2 เดิมเริ่ม “อธิบายยอดในรูปก่อน” zero-write แล้วจึง capture แต่ question-only admission/reader ยังเป็น W07B จึงใช้ sequence นี้รับรอง R1ล้วนไม่ได้ แยก R1 capture→explain/correct existingdraft กับ R2 fullquestion-only journey โดยไม่ลด assertionsของR2

Tool schema change ยังต้องผ่าน prepared eligibility/input digest/delegation และ deterministic formatter ไม่ใช่เพียง API/mock model Stubที่เขียน basisเองไม่ใช่ oracleของsourceเงินจริง

เพิ่ม W00/W14/W15 และ catalog J2 release variants; source-backed fixtures, exact candidate manifest, family×lane×permission×channel×delivery matrix CI01–CI15 mapเข้า IDsเดิม ไม่เพิ่มคะแนนด้วยการนับ assertionsเป็น scenarios

## ผลกระทบและลำดับส่งมอบ

| Slice | Modules ที่ต้องทำพร้อมกัน | Entry/exit ที่ต้องเห็น |
|---|---|---|
| A — Contract + source correctness | shared contracts/registry, gateway sanitizer/prepared/JSON/native, API toolMap/delegation, expense/ledger/CRM/reports, formatter/weblinks | W00/W01/W05/W11; queryไม่หาย, date/branch/basis/decimal/aggregateถูก ก่อนรับรอง compare |
| B — Owner + media + authorization | AiConversation/PendingMedia/intake/job, auth/unlink/employee, synchronous admission, async notifier/outbox | W02/W07A/W13 controls; fullowner, no stale writer/private push, replacementจริง, PR819proofยังอยู่ |
| C — Conversation + delivery | intake/router/general/composer, buffer/ledger, body deadlines/model holds | W03/W04/W06/W11/W13; ตอบเข้าใจ+grounded, cancel matrix, failed-delivery recovery, measured latency |
| D — New capabilities | approved retrieval/public lookup/general Q&A/preferences | R2 W07B/W08/W09 และ R3 W12; gateแยก ไม่เพิ่ม voice/bankprofile/autonomous action |

W14 fixturesเริ่มคู่ทุก slice; W15 integrationหลัง dependencies ของ release ผ่าน การตรวจsource/แก้docsนี้ไม่เท่ากับเปิดfeatureหรือผ่าน gates

## สิ่งที่คงไว้ ลด และไม่ทำซ้ำ

- คง API permission/source authority, existing ledger/intake/preview/capture jobs; Gatewayไม่เข้าฐานข้อมูลตรง
- คง PR819 exact preview/atomicclaim/currentpermission/revision และเพิ่ม integration regressionเท่านั้น
- ตัด blanket195s whole-job, full16KiB automatic prompt injection, blanketgeneral fallback, unconditional “cancelแล้วไม่มีข้อความเก่าถึงแน่” ออกจากแผน
- ไม่แก้ด้วย synonym list/เพิ่ม agentหรือframework/เปิด native loop/เปลี่ยนmodelอัตโนมัติ ไม่สร้าง bankfeed/forecast/profile เพื่อแก้ queryพื้นฐาน
- C13/W10/E18/E19เสียงยังพัก; 17 active capability areas,53 active acceptance IDsเท่าเดิม ไม่มี package.json/app implementation changes

## Verification และข้อจำกัด

- fetch mainสำเร็จ baselinef932; อ่าน source เป็น Git objects; agent auditsเป็น read-only
- รัน [budget probe runner](../evidence/mangmee-ai-readiness-2026-09-26/consistency-budget-probes.ts):5 synthetic assertionsผ่าน รวม envelope/call/skew/inputbound; sourcesสองไฟล์เท่ากับf932
- รัน [domain probe runner](../evidence/mangmee-ai-readiness-2026-09-26/consistency-domain-probes.cjs) จาก pinned Git functions; ผลใน [JSON](../evidence/mangmee-ai-readiness-2026-09-26/consistency-domain-probes.json): ledger period drop/date helper/precision boundary
- ไม่รัน DB race/branch-revoke integration, provider-backed53cases, LINEdevice, UAT/Production หรือ latency benchmark รอบนี้ จึงยังไม่รับรอง deployment/ความเร็ว/ความใกล้เคียง ChatGPT
- Regression เดิมเรื่อง substring veto, numeric field/evidence binding, openClarifications/coverage wire, general policy contradiction และ body timeoutยังเป็น gatesเดิม ไม่ถูกแทนที่ด้วย16ประเด็นนี้
