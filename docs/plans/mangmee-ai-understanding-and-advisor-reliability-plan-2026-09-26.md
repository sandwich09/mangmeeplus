# Plan: แก้ความเข้าใจและความน่าเชื่อถือของน้องมั่งมี

วันที่: 2026-09-26\
สถานะ: **v2.4 source implementation/default activation merge แล้ว; real-model NAT diagnostic 2026-09-27 ไม่ผ่านการรับงาน — W14/Production readiness ยังไม่ปิด**\
Spec: [Understanding and advisor reliability](../specs/mangmee-ai-understanding-and-advisor-reliability-spec-th.md)\
Memory: [Audit and planning state](../agent-memory/mangmee-starter-advisor-audit-2026-09-26.md)

แผน §3–9 เป็นขั้นตอนของแต่ละ release; §12–15 ระบุ work packages ครบชุดและ gate ของ R1/R2/R3 ใช้ร่วมกับ [acceptance catalog](../qa/mangmee-conversation-acceptance-catalog-2026-09-26-th.md) ไม่ถือว่าจบ core fixes แล้วจบขอบเขต v2 ทั้งหมด


## Evidence update — 2026-09-27: ผลโมเดลจริงยังไม่ผ่าน

รัน NAT12/60 ด้วยโมเดลจริงและ webhook/tool จริงในระบบ local สังเคราะห์ ได้ primary evidence56ข้อ อีก4ข้อหยุดหลังPDFtimeout การรันทวนหลังแก้เก็บแยก snapshot ดู [ผลพร้อมข้อความ/payload/เวลา/ข้อบกพร่อง](../research/mangmee-natural-real-model-results-2026-09-27-th.md) การมี implementation และเปิด default ไม่ใช่ functional acceptance; checkbox ในแผนออกแบบเดิมเป็นรายการงาน ไม่ใช่สถานะ deployed ล่าสุด

ต้องปิด context/current-attachment, file-read dispatch, budget/route eligibility, entity resolution, draft/control/preferences และทดสอบ actual card/actions ก่อนรับ W14 ไม่มีการ deploy หรือเปลี่ยน customer gate จากงานทดสอบนี้ Public lookup/เสียงยังพัก

## Owner update — 2026-09-27: ขั้นต่อไปของ W14

Implementation/default activation มีหลักฐานและ merge แล้วตาม [implementation index](mangmee-ai-implementation-index-2026-09-27.md) และ [default activation memory](../agent-memory/mangmee-ai-default-activation-2026-09-27.md); ประโยคสถานะเดิมของงานออกแบบไม่ใช่สถานะ deployed ปัจจุบัน Public lookup/C09 และเสียง/C13 พักตามผู้ใช้

1. ใช้บทสนทนาภาษาธรรมชาติ NAT-01–NAT-12 ใน [human review packet](../research/mangmee-ai-human-review-2026-09-27-th.md) เป็นหน้าตรวจหลัก ผู้ตรวจดูความตั้งใจและจังหวะถาม/ตอบทีละรอบได้โดยไม่รู้ tool names หรือเลขเอกสาร
2. ตรวจภาษาปกติ/พิมพ์ผิด/อ้างบริบท/คำแก้/คำถามลึกและการเปลี่ยนงาน พร้อม precondition ว่าผู้ใช้เห็นตัวเลือกหรือภาพใดจริง ตาม rubric ใน [acceptance catalog](../qa/mangmee-conversation-acceptance-catalog-2026-09-26-th.md) อย่าแก้คำถามให้ง่ายลงเพื่อให้ตรงคำที่ router จับได้
3. ก่อนใช้เป็นคะแนน: ผูกแต่ละ turn กับ source snapshot, delivered option identity, current permissions, expected facts/effects/preview revision และ failure variants โดย reuse fixture schema/replay เดิม ถ้า fixture หรือผู้ตรวจยังไม่พร้อม ให้สถานะรอ ไม่ใส่ตัวเลข/ID/ผลยืนยันสมมติ
4. เก็บ225case artifact เดิมและผลเดิมไว้ ไม่แก้ย้อนหลังเพื่อเพิ่มคะแนน แยก natural conversation revision และ technical regressions; variants ของต้นเรื่องเดียวกันต้องอยู่ family/split เดียว NAT ที่เปิดเผยให้ตรวจในแชตนี้ถือเป็น development ไม่อ้าง held-out
5. รัน provider จริงหลังตรึงเกณฑ์ แล้วรายงานคะแนนต่อ turn และทั้งบท ความถูกต้องของตัวเลข/การทำรายการ การรับคำแก้ การถามซ้ำ การปฏิเสธผิด และเวลา โดยแยก LINE จำลอง/LINE จริง ไม่รับรองคุณภาพจาก integrity test หรือครบจำนวนเคสเท่านั้น

งานรอบนี้เปลี่ยนข้อกำหนดและคำถามสำหรับตรวจโดยคน ยังไม่เปลี่ยน production behavior ไม่รันโมเดลจริง และไม่ย้ายสถานะใดเป็น human-approved

## 1. ผลลัพธ์ที่ต้องส่งมอบ

ผู้ประกอบการถามด้วยภาษาปกติแล้วมั่งมีเข้าใจ ทำงานที่มีจริงตามสิทธิ์ ตอบความรู้ธุรกิจพื้นฐานได้ รักษาบริบทเมื่อถามต่อ/แก้ใจ และบอกข้อจำกัดเฉพาะเหตุโดยไม่วนส่งเว็บ ผลแต่ละช่วงต้องเห็นได้ในบทสนทนาจริงและมี trace ยืนยัน ไม่ถือว่าการแก้ prompt หรือ tests ผ่านเป็น final acceptance

ลำดับความสำคัญ: **หยุด false block/บริบทหาย/ตัวเลขผิด → ตอบความรู้พื้นฐานและหยุด handoff วน → ผูกหลักฐานใบเสร็จ → ลดเวลาบนเส้นทางที่ถูกต้อง → LINE acceptance และ rollout** งาน oracle/eval เริ่มตั้งแต่ช่วงแรก

Owner clarification: เลือกผู้ช่วยที่ใช้ effort ตามงานและรู้จังหวะตาม spec §19.1 เป็นเป้าหมาย ไม่ optimize จำนวน calls ต่ำที่สุดเป็นตัวชี้วัดหลัก W03/W04/W06 ใช้ semantic/context/coverage seams เดิมเลือกตอบ/ถาม/อ่าน/ตรวจเพิ่ม; W11/W13 บังคับ approved envelope; W14 วัด task completion, facts, continuity, appropriate clarification และ correction responsiveness ก่อนรับ performance improvement ไม่เพิ่ม controller/agent/framework อีกชุด

## 2. ข้อจำกัดและ dependency

- Full audit baseline คือ `a2b926c6ee80f26065aecef6998415db1d1a379f` ตาม [audit](../research/mangmee-ai-code-verification-2026-09-26-th.md); หลังผู้ใช้แจ้ง update ได้ fetch/อ่าน `origin/main` ที่ `f932b57766f5dd22c0d28aedd4bc06f210e374ef` แล้ว ใช้ main นี้หรือรุ่นใหม่กว่าเป็น implementation base และ reconcile diff ก่อนเริ่ม ไม่นำ workspace HEAD `4a5817b4` ที่มี dirty WIP ไปทับ source ล่าสุด ไม่ถือ Git HEAD เป็นหลักฐาน deployed runtime
- งาน [expense-edit capability consistency](line-ai-expense-edit-capability-consistency-plan-2026-09-26.md) merge แล้วใน [PR #819](https://github.com/MangmeeDev/mangmeeplus/pull/819), implementation `be53b0bd` และ main merge `f932b577`; reuse จาก base ไม่ cherry-pick หรือสร้าง fix ซ้ำ Preserve preview/confirm ไม่มี legacy directwritefallback; liveUAT ยังต้องมีหลักฐานตาม runbook
- SEC-04 stale confirm card: source บน main มี `previewId`/atomic claim แล้วตามการอ่าน `apply/cancel` และ transport; เหลือ regression U15/U24 บน candidate ที่รวมงานสนทนาใหม่และ actualLINEacceptance ไม่ใช่ implementation dependency ที่ยังรอ merge งาน read/general เดินต่อได้โดยไม่ขยาย edit claim ก่อน gate ผ่าน
- ความรู้ R0/R2 ใช้ policy [knowledge spec](../specs/mangmee-accounting-tax-knowledge-spec-th.md); reuse capability-help ที่มี; approved knowledge retrieval เป็นงานเพิ่มตาม P23 [four-lane plan](mangmee-four-lane-gap-closure-plan-th.md) ซึ่งยังไม่พบ runtime ครบ ไม่อ้างว่ามี packregistry แล้ว และไม่เพิ่ม vectorDB โดยไม่มีผล eval รองรับ
- ไม่เปลี่ยน provider/model เป็นงานเริ่มต้น ถ้า semantic eval ยังต่ำหลังแก้ policy/context ให้เปรียบเทียบโมเดลที่ config รองรับด้วย corpus เดียวกัน วัดคุณภาพ/ราคา/เวลา แล้วทำการเลือกเป็น decision แยก
- ไม่แก้ package.json, ไม่เพิ่ม dependency หรือ schema โดยไม่มีความจำเป็น; shared contracts additive; application security/tenant/permission/source revision/mutation gates คงอยู่
- ก่อน code edits อ่าน Ponytail ตาม AGENTS (ถ้า absolute path เก่าหาย ให้ใช้ `.agents/skills/ponytail/SKILL.md` ที่มีจริง) ก่อนแตะ cloud อ่าน cloud operations runbook; ก่อน deploy/retry/promote อ่าน mandatory UAT/Production runbook ทุกครั้ง

## 3. Phase 0 — ทำ baseline และ oracle ให้ชัด

สถานะ: [ ] ยังไม่เริ่ม implementation baseline

1. บันทึก SHA ของ API/Gateway/AgentCore/config/prompt, serving flags, provider/model, registry version, feature/permission fixture และสถานะ merged expense-edit dependency ใน evidence manifest เดียว
   Manifest ต้องมีทุก currently sold/enabled family × entitlement × permission รวมบริษัทที่เปิดความสามารถนอก starter และแยก executionkind (read-tool/API capture/etc.), registry→handler/DI, channel, arguments/limits/basis, data sufficiency, effective serving flags; [capability audit](../research/mangmee-conversation-capability-dependency-audit-2026-09-26-th.md) มีจุดตั้งต้น ห้ามใช้จำนวนชื่อใน registry หรือ toolMap เดียวแทนทุก capability; family ที่ audit พบ financial defect เป็น blocked acceptance พร้อมเหตุและงานแก้ ไม่ถูกตัดออกจาก coverage เงียบ ๆ
2. อ่าน main/release diffs เฉพาะ affected paths แล้วจัด worktree/branch ที่มี baseline ถูกต้องและไม่ทับงานคนอื่น ระบุ parent fixes ที่ต้องมีอยู่แล้ว เช่น chatKeyHash/valueCandidates/month completion
3. เปลี่ยน audit reproductions เป็น regression fixtures สำหรับ U01–U05, U10, U17 พร้อม semantic oracle และ no-call assertions; source a2 ต้อง reproduce failure ก่อนใช้ยืนยัน fix
4. ทำ policy map เทียบ intake/router/composer/direct-answer gate กับ R0–R5 knowledge policy; ระบุข้อความ prompt/early return/fallback ที่ขัดกันก่อนแก้
5. สร้าง eval manifest ตาม §7 โดย reuse corpus/benchmark runner ที่เหมาะสม; แยก pure regression, model-backed test และ actual LINE journey
6. วัด baseline pipeline timings ตาม §8 บน approved test company; ไม่มี latency data ของรุ่นใหม่ให้ระบุ unavailable ห้ามแทนด้วย timings รุ่น 277

### Phase 0 เพิ่ม — แยก model limitation ออกจาก application limitation

Owner steering: ยกระดับการสนทนาให้ใกล้ผู้ช่วยอ้างอิงก่อนทำ Financial Profile/Services Needs ใช้ข้อมูลสังเคราะห์และ permission-checked fixture tools เปรียบเทียบ 2×2:

| การทดลอง | Model | Application/policy/context |
|---|---|---|
| A | รุ่นที่ใช้อยู่จริงและ pin version/config | baseline ปัจจุบัน |
| B | รุ่นเดียวกับ A | corrected/minimal test harness ที่ได้รับ context ครบและไม่ false-block; security boundaries คงเดิม |
| C | candidate model ที่เลือกทดสอบ | baseline เดิม ผ่าน adapter ที่ตรวจ compatibility แล้ว |
| D | candidate เดียวกับ C | harness เดียวกับ B |

ก่อน B ที่ยังไม่ implement ให้เขียน expected interface/fixtures และรันเฉพาะใน test harness การ bypass business-language veto ในการทดลองไม่ bypass tenant/permission/source/mutation gates และไม่ใช้ข้อมูลลูกค้าจริง การเปรียบเทียบ C/D ต้อง record API/adapter/tool support, token/reasoning budgets และ approved provider/model/region/cost policy; adapter ใช้ไม่ได้ให้รายงาน incompatibility ไม่สรุปว่า model ไม่ฉลาด

ถ้า B ดีกว่า A ชัด ให้แก้ application ก่อนซื้อ model ที่แพงขึ้น; ถ้า B ยังไม่ถึงเป้าหมายแต่ D ดีขึ้น จึงมีหลักฐานพิจารณา model migration; ถ้าทั้งคู่ยังผิดให้ตรวจข้อมูล/เครื่องมือ/oracle และ semantics ต่อ ไม่สรุปจากคะแนนรวมอย่างเดียว ไม่มีการรัน provider benchmark หรือเปลี่ยน model ในงานเขียนแผนนี้

ใช้ reference assistant/model ที่ระบุรุ่นและ config ได้ ให้ same facts/tools กับมั่งมี และ blind review ตาม spec §14.3 ไม่อ้างว่า OpenAI API model เท่ากับ ChatGPT product ภายในทุกส่วน เพิ่ม N01–N06 ใน corpus เดิมพร้อม 3–10 turn trajectories และ long/expired-context cases โดยไม่สร้าง evaluation framework ซ้ำ

จบช่วงนี้เมื่อ: รู้ exact baseline, reproductions, expected behavior, flags/dependencies และเส้นทางวัดจริง เอกสาร status “implemented” เก่าไม่ใช้แทนผลตรวจ

## 4. Phase 1 — เข้าใจโจทย์และรักษาคำถามเดิม (P0)

สถานะ: [ ] รอ Phase 0

### 1A Contract และ transport

- ทำ field map request/result ครบ API client → Gateway DTO/use-case → runtime client → AgentCore handler → orchestrator → response → API ledger/render
- ส่ง `openClarifications`, `coverage` และ fields ที่เกี่ยวข้องครบ; validate bounds/candidate membership/timestamps/provenance ทุก trust boundary
- เติม semantic metadata เฉพาะที่ existing intentPlan/inputs/open clarification เก็บไม่ได้ เช่น missing slot/correction provenance; additive/versioned ไม่สร้าง parallel conversation object
- แยก answer outcome/reason จาก route status และ delivery state; legacy `refused` map แบบ documented และ backward-compatible
- JSON/prepared paths ต้องคืน deterministic coverage จาก validated subrequests + actual tool outcomes ได้ ไม่ขึ้นกับ native critic

หลักฐาน: runtime HTTP contract tests แบบไม่เปิด socket ทดสอบ input/output จริง + mixed-version fallback; delivery failure ไม่ consume clarification

### 1B Semantic interpretation และ false-block removal

- ย้าย expense semantic veto ที่จับ category/negation จากข้อความดิบไปหลัง validated meaning; ใช้ group/filter capability ของ tool จริง
- แก้ intake/router instructions ให้ไม่บังคับ knowledge/education เป็น live tool request และไม่ปิด business brainstorming ทั้งหมดเพราะไม่มี tool ขายสินค้า
- ใช้ prepared intentPlan เป็น input หลักเมื่อผ่าน validation; ไม่เริ่ม route→select→compose ซ้ำสำหรับโจทย์ง่าย
- ไม่แทน bug ด้วย synonym/regex list ยาวขึ้น; syntax/security/exact control parsing ยัง deterministic
- การเลือก tool ต้องคง subject compatibility, current feature, member permission และ branch scope; unsupported filter ไม่ถูกละทิ้งเงียบ ๆ

หลักฐาน: U01–U05 และ negative controls ที่มีคำใกล้กันแต่ความหมายต่างกัน; ตรวจ exact tools/inputs ไม่ใช่เพียงไม่มีคำว่า “ไม่ได้”

### 1C Context และ anti-loop

- ต่อ ledger/openClarification ให้ทราบ original goal/known slots/pending target; semantic classify continuation/correction/interruption/cancel
- คำถามแทรกตอบได้โดยไม่ consume หรือ apply งานค้าง; กลับงานเดิมได้เมื่อผู้ใช้ตอบ field
- เก็บ last delivered clarification + slot identity; ถ้าจะถาม slot เดิมที่ตอบแล้วต้อง re-evaluate context แทนส่งประโยคซ้ำ
- ตรวจ AP21 history projection: ต่อ safe semantic task summary/accepted constraints และ delivered question references ให้พอสนทนา ห้ามคืน raw stored business replies ทั้งหมด และห้ามเพิ่ม retention เพื่อกลบปัญหา transport
- unresolved genuine ambiguity มี bounded choices; source/candidate/access เปลี่ยนให้ re-read ไม่ใช้ short-term history เป็น authority
- จบงานเมื่อ delivery confirmed ตาม existing reliability contract; retain/retry event เดียวเมื่อส่งไม่สำเร็จ

หลักฐาน: U04–U06/U13/U14/U21/U25, อย่างน้อย 3–5turn ต่อ scenario, duplicate event และ failed delivery ไม่สร้างคำตอบ/งานซ้ำ

จบ Phase 1 เมื่อ: known false blocks=0 บน regression corpus, state roundtrip ครบ, clarification ที่ผู้ใช้ตอบแล้วไม่ถูกถามซ้ำ, metric แสดง outcome จริง ยังไม่เรียกว่า production หายจนผ่าน Phase5

## 5. Phase 2 — ตอบธุรกิจทั่วไปและตอบด้วยข้อมูลจริง (P0/P1)

สถานะ: [ ] รอ Phase 1A; 2A/2B พัฒนาแยกกันได้

### 2A General/business answer policy

- ต่อ `PreparedAdvisorAnswer`/parser/direct-answer validator เดิมให้รองรับ stable R0/R2 general explanation ที่ไม่ใช้ private data ไม่ปลอม card/profile/source
- คง SOCIAL_CHAT/persona/help rules ตามบริบท: คำขอสอนใช้เข้าวิธีใช้ตาม capability; คำอธิบายธุรกิจยาวเกิน 3 ประโยคไม่ถูก social-only tutorial veto ผิดประเภท
- Profile/live facts ยังต้อง permission-checked source; user-provided context ติดป้ายว่าเป็นข้อมูลผู้ใช้ ไม่ยกระดับเป็น verified company facts
- ใช้ approved product help/knowledge ที่มีจริง; current tax/legal/accounting-specific facts ยังตาม pack/effective-date/reviewer กฎเดิม ไม่เปิด web search เพื่ออุดช่องว่างโดยไม่มี policy
- หากมีการคำนวณตัวอย่าง ใช้ arithmetic ที่ backend ตรวจได้จาก explicit operands และหน่วย; reuse existing helper หากมี หรือ pure bounded calculator เล็กที่สุด ไม่มี arbitrary-code tool
- เพิ่ม safe outcome เมื่อ uncertainty เฉพาะส่วน: ตอบหลักการที่รู้แล้วบอกส่วนที่ต้องตรวจ ไม่ whole-turn refusal

### 2B Numeric grounding และคำแนะนำเฉพาะร้าน

- ขยาย deterministic renderers/typed tool facts แทน global number allowlist: metric/value/unit/currency/period/basis/source/asOf ต้องสัมพันธ์กัน
- คำถามนำ 999 และ count2 ไม่มีสิทธิ์เป็น total1000; guard failure ให้ render known facts ไม่ silent accept หรือ compose วน
- Advice prose แยก observation/hypothesis/options ห้าม causal claim จาก correlation หรือ missing data; ไม่มีข้อมูลจริงให้ general guidance ได้แต่ไม่อ้างว่าวิเคราะห์ร้านแล้ว
- งวด/สถานะ/เงินสด/กำไร/รายรับ/ค่าใช้จ่ายต้องตรงความหมาย; mixed currencies หรือ AP/AR family ที่ยังมี financial defects ยังไม่เปิดเพิ่ม

### 2C Handoff ที่ตรงงาน

- ลบ expenses-link catch-all ของ `unsupported_yet` ใช้ permitted destination จาก capability/help route mapping เดิม
- คำตอบหลายข้อต้องตอบส่วนที่ทำได้ก่อน; ลิงก์ดูหลักฐานเป็น optional ไม่ substitute คำตอบ
- แยก feature disabled, permission denied, unsupported action, no/insufficient data, temporary error, stale source และ missing context
- เมื่อผู้ใช้ขอทำต่อในแชตไม่ส่งลิงก์เดิมซ้ำอัตโนมัติ; staff handoff ต้องมี queue จริงก่อนอ้างว่าจะติดต่อ

จบ Phase 2 เมื่อ: U07–U16/U21–U23/U25 ผ่าน; zero unnecessary web handoff บน fixed regression; general lane ERP calls=0; no money/source fabrication; current-source absence ให้ useful bounded answer

## 6. Phase 3 — อ่านใบเสร็จด้วยหลักฐานของแต่ละช่อง (P0)

สถานะ: [ ] เริ่มได้ขนานกับ Phase 2 หลัง Phase 0 และ field contract ตกลงแล้ว

- ปิด confirmed gap ใน `parseCaptureObservationsJson`: amount ต้องตรง canonical token ใน evidence ของ field นั้นและ document/page ถูกต้อง; span ที่มีหลายยอดต้องมี role/row binding หรือ ambiguous ไม่แค่ substring พบเลข
- ใช้ semantic roles เดิมแยก total/tender/change/charge/discount/tax; deterministic reconciliation ตรวจสมการไม่ invent amount
- เก็บ date candidates พร้อม role ก่อนเลือก canonical date; missing/unreadable ยังใช้ review flow เดิม พร้อมแยก observed/derived/user-confirmed
- เพิ่ม end-to-end fixture ผ่าน parser→fact assembly→OCR apply→draft rendering ด้วยภาพสังเคราะห์/ตัวอย่างที่ได้รับอนุญาตและ human ground truth ไม่ใช้ OCR text-only test แทน visual correctness
- ตรวจ retry/duplicate/humanoverride/source revision กับ correction ที่รวมใน main แล้ว; reread เฉพาะเมื่อ evidence ไม่พอภายในงบเดิม
- Image bounding boxes/crop UI เป็น follow-up ของ phase นี้ได้หาก provider/path ยังไม่มี; phase แรกต้องไม่อ้าง pixel evidence จากเพียง textspan และห้ามอ้างว่า highlight พร้อมแล้ว

จบ Phase 3 เมื่อ: U17–U20 ผ่านทั้ง adversarial parser inputs และภาพจริง, wrong amount/span ไม่ผ่าน, unreadable materialfields เป็น unknown/review, human correction ไม่ถูก overwrite

## 7. Eval corpus และ release gates

ทำชุดตั้งต้นอย่างน้อย **150 scenarios** (scenario อาจมีหลาย turn) แบ่งอย่างน้อย 100 development +50 held-out scenario families โดย stratify ห้ากลุ่มด้านล่างอย่างน้อยกลุ่มละ 10 held-out families; แยก family ก่อนทำ paraphrase และ freeze held-out ก่อนจูน prompt ใช้ 75+Thai phrasing variants เพิ่มใน split เดิมโดยไม่แทน scenario ที่เป็น negative controls เพิ่มจำนวนเพื่อครอบคลุมทุก enabled lane/family รวม preferences/publicsearch/general image-PDF เมื่อ release นั้นเปิด; ไม่รวมเสียง และ group/room no-profile controls

| กลุ่ม | จำนวนขั้นต่ำ | สิ่งที่ตรวจ |
|---|---:|---|
| Single-turn live business/typo/negation | 35 | semantic intent, scope, tool/filter/period, answer facts |
| Multi-turn clarification/correction/interruption | 30 | slotcontinuity, repeated ask, stale reference, outcome/delivery |
| Stable general/business/help | 25 | useful direct answer, no unwanted ERP/handoff, persona/actual help |
| Mixed/current/denied/error | 30 | completeness, actualreason, sourcefreshness, noleak/mutation |
| Receipt/document | 30 | field role/evidence, ambiguity, imagegroundtruth, review/humanoverride |

Harness records expected assertions + actual plan/tool inputs/results/outcome + deliveries/model calls/latencies/token cost + sourceSHA/provider/prompt/configVersions ถ้าแก้ model/prompt/contract ต้องระบุ run ใหม่ ใช้ 3runs ต่อ model-backed scenario บน configuration เดียวกัน; แยกค่าเฉลี่ย/ช่วงและ worst observed ไม่เลือกเฉพาะ run ดีที่สุด

| Gate | เกณฑ์ก่อน canary |
|---|---|
| Confirmed regressions | U01–U25 ผ่าน 100%ทุก run ที่เกี่ยวข้อง; knownfalseblocks/numericwrongbinding/transportloss=0 |
| Security/final mutation | cross-tenant/branch leak, unauthorized tool, unconfirmed write, prompt-injection authority gain=0 ในชุดทดสอบ; พบ 1 กรณีหยุด rollout |
| Semantic intent+arguments | ≥95%บน held-out และรายกลุ่มที่มี≥10cases; ambiguous intent ถาม criticalslot ที่ถูกต้องถือว่าผ่าน |
| Supported task completion | ≥95%ของ eligible scenarios ที่ environment ทำงาน; ห้ามตัดคำถามที่ routing ผิดออกจาก denominator |
| False refusal + unnecessary handoff | ≤2%ของ eligible corpus แต่ละอย่าง; knownregressions ต้อง 0; แยก denial ที่ถูกต้อง |
| Clarification/loop | filledslotreask=0 บน fixedset; taskloop≤2%held-out; independentquestion ไม่ consume งานค้าง |
| Answer facts | numeric/source/basis/period/currency ผิด=0 ในชุด financialregressions; general explanation factual/usefulness review ผ่าน≥95% |
| Receipt | high-confidence wrongcriticalfield=0 บน goldenset; report fieldaccuracy และ reviewrate แยก ห้ามใช้ review ทุกภาพเพื่อทำ accuracy สวย |
| Delivery | duplicate customer-visible final answer=0 ใน retry/idempotencyfixtures; success ไม่บันทึกก่อน send ยืนยัน |
| Performance/cost | Phase4 thresholds; แยก latency ของคำตอบที่ถูกจากทุก eligible attempt; fast refusal ไม่เป็น success และ errors/timeouts ยังอยู่ใน completion/deadline/cost denominators |

คะแนนเหล่านี้เป็นเกณฑ์ส่งมอบที่เสนอ ไม่ใช่ตัวเลขคุณภาพปัจจุบัน และ 0 ข้อผิดพลาดในชุดทดสอบไม่ใช่รับประกันว่า live ผิดไม่ได้ LLM grader ใช้ประกอบความลื่นไหล/semanticparaphrase เท่านั้น assertions เรื่องสิทธิ์ เงิน และ state ใช้ deterministic oracle + humanreview

คง minimum gates ของ advisor/latency parent ที่เข้มกว่า: enabled-mode macro-F1 ≥0.95, ต่อภาษา precision/recall ≥0.90, critical mixed/action/safety recall=1.00, high-risk factual/citation correctness=1.00 และไม่มี authority breach; citation precision≥0.98/required coverage≥0.95 เมื่อ lane ใช้แหล่งอ้างอิง General explanation ที่ประกาศว่าไม่มี citation ไม่รวมใน citation denominator แต่ห้ามปลอม source ถ้า canary wrong-tool เพิ่ม>0.5pp, grounding ลด>1pp, duplicates เพิ่ม>0.5pp หรือ re-ask/fallback เพิ่ม>10% relative จาก matched baseline ต้องหยุดขยาย/rollback ตาม parent แม้ยังผ่าน aggregate target ใหม่

Thresholds ของ canary ข้างต้นไม่ใช่ allowance ให้คุณภาพถอยเพื่อแลกเวลา: speed acceptance ต้องผ่าน spec §20.1 เทียบ candidate ที่เพิ่มความฉลาดแล้วก่อน/หลัง optimization และหากพบ regression ที่ยืนยันว่าเกิดจาก optimization ให้หยุดขยายเส้นทางนั้นแม้ยังไม่ถึง threshold ของ parent

Human review: ผู้ใช้ธุรกิจตรวจว่า“ตอบงานที่ถามจริง/ทำต่อได้/ไม่ถามวน” และผู้รู้โดเมนตรวจ financial basis/receipt ground truth คะแนนภาษาไพเราะไม่ชดเชย facts ผิด

ประเมินจังหวะเป็น expected action ใน scenario เดิมด้วย: ควรตอบเมื่อมีบริบทครบ, ควรถามเมื่อ critical slot ขาด, ควรใช้ tool เมื่อเป็นยอดจริง, ควรตรวจเมื่อหลักฐานขัด, ควรเปลี่ยนตาม correction และควรหยุดเมื่อจบงาน ความสั้น/ความสุภาพหรือจำนวน model calls อย่างเดียวไม่เป็น oracle; คำตอบที่ถูกบางส่วนแต่ทิ้งงานยากไม่ผ่าน completeness นำ variants ใน acceptance catalog มาครอบคลุมทั้งคำถามสั้นแต่ยากและคำถามยาวแต่ง่าย

เพิ่มเติม N01–N06 ต้องผ่าน semantic/state assertions บน fixed regressions และเกณฑ์ blind comparison ตาม spec §14.3 ใช้ตัวอย่างคำตอบ reference เป็น comparator ไม่ใช่ oracle; เก็บคู่ผลที่ไม่ผ่านไว้ปรับงานรอบถัดไปผ่าน reviewed fixtures ไม่ auto-train จากบทสนทนาลูกค้า

## 8. Phase 4 — ทำให้เร็วโดยไม่เสียความถูกต้อง

สถานะ: [ ] เก็บ timing/round-count baseline ตั้งแต่ Phase0 และทำควบคู่กับ correctness; เปิด fast path/cohort หลัง quality gates ของ lane นั้นผ่าน

ใช้ precedence ตาม spec §2/§20/§20.1 สำหรับ reliability v2: parent quality margins ไม่ใช่ allowance ก่อนรับงาน, full orchestration ไม่บังคับเปิด native และ mixed 4 rounds รวม intake ต้องผ่าน feasibility ก่อนแทน budget เดิม W11/W13 ต้องทดสอบทั้งงานใกล้เพดานและ hard enforcement; หากปรับงบให้ version/freeze/re-evaluate ก่อน rollout ไม่เพิ่มงบเฉพาะ turn เพื่ออ้างว่ารักษาความฉลาด

1. ส่ง simple reads เข้า preparedlane เดิมและ formatter ตาม allowlist ที่ทดสอบแล้ว อย่าเปิดทุก compiledfamily พร้อมกัน; แก้ falseblock ต้องไม่เพิ่ม 3calls ให้ทุกคำถาม
2. Stable general ใช้ intake หนึ่ง call เท่าที่ทำได้; multi-intent อ่าน tools อิสระพร้อมกันภายใน budget ส่วนอ่านที่อาศัยผลก่อนหน้าทำตามลำดับ
3. เก็บ model/tool/repair round budgets และ whole-turndeadline รวม invalidtoolattempt; native ยังปิดใน rollout นี้ ถ้าจะเปิดต้องมี acceptance แยกหลังแก้ budgetdefect
4. Profile latency แยก queue/buffer/intake/route/runtime/tool/compose/validation/metering/persistence/LINEdelivery; ตรวจ budgetsettlement บน criticalpath ก่อนลดเวลา แต่ห้าม fire-and-forget จนเสีย billing/audittruth
5. ใช้ existingprogress/loading และ durableoutcome ไม่ส่ง“กำลังทำ”เป็น finalanswer

### วิธีวัด

- Server end-to-end: เวลารับ verified inbound → LINE send acceptance; แยกเวลา client-visible จาก manual/deviceUAT เพราะ send acceptance ยังไม่พิสูจน์ว่า render บนมือถือแล้ว
- Report first meaningful answer และ final answer delivery แยก loading/ack; imagecapture แยก draftready กับ jobcomplete
- แสดง successful-grounded latency distribution แยกจาก eligible-attempt completion และ within-deadline success rate; ตัวหารสองอัตราหลังรวม timeout/error/false refusal ทั้งหมด พร้อมรายงานค่าใช้จ่าย failed attempts จึงไม่ซ่อนความล้มเหลวด้วยการคัดเฉพาะคำตอบที่เร็ว
- เริ่มรายงานด้วยอย่างน้อย 100 eligible attempts ต่อ lane หลัก/ต่อ candidate และแสดงจำนวน successful-grounded แยก; จำนวน 100 ไม่รับรอง tail แม่นยำ ต้องมี interval/samplewindow/coldwarm/errorcounts ตาม§13.3 เพิ่ม samples เมื่อ interval ยังคร่อม gate ไม่ตัด timeout/error ออกจาก availability/cost denominator
- เปรียบเทียบ baseline/candidate ด้วย fixtures,provider,region,load และ permissions เดียวกัน; mockelapsedtime ไม่ใช่ benchmark
- เก็บ comparison สองชุดแยกกัน: รุ่นเดิม→รุ่นเพิ่มความฉลาดใช้วัด capability improvement; รุ่นเพิ่มความฉลาดก่อน→หลังปรับความเร็วใช้พิสูจน์ quality preservation ตาม spec §20.1 Pin ทั้งสอง manifests และเปลี่ยนเฉพาะ optimization ที่กำลังวัด ตรวจรายกลุ่มงานรวม multi-turn/receipt/mixed/fallback และกรณีใกล้เพดาน rounds/reads/deadline; partial/timeout ที่เพิ่มขึ้นไม่เป็น success แม้ข้อความตอบถูกบางส่วน ผลยังไม่ชัดให้เพิ่ม samples/review ก่อนรับงาน
- รับรองได้เฉพาะ source/flags ที่ใช้วัด; tracing ไม่ log ข้อความการเงินหรือรูปจริงเพิ่มโดยอัตโนมัติ

### เกณฑ์เวลาและค่าใช้จ่าย

- Eligible simple read: target final-delivery p95≤8s ตาม parentlatencyspec; p50≤3s เป็นเป้าหมายผลิตภัณฑ์ที่ต้องวัด Phase0 ก่อน commitSLO
- Stable general: p95≤5s เป็นเป้าหมายที่เสนอ; หาก baseline แสดงทำไม่ได้ใน provider ปัจจุบันต้องบันทึก tradeoff/target ก่อน canary ไม่ปรับตัวเลขหลังดูผลเพื่ออ้างว่าผ่าน
- Protected existingjourneys: latency/cost ไม่แย่เกิน 10%จาก matchedbaseline; groundtruth correctness ต้องไม่ถอยเพื่อแลกเวลา
- ความสามารถใหม่ใน spec ได้รับการปกป้องด้วยเช่นกัน: semantic/context/coverage/usefulness ต้องไม่ถอยจาก intelligence candidate ก่อน optimization; absolute quality thresholds เพียงอย่างเดียวไม่พอ ถ้า budget ทำให้โจทย์ที่เคยทำครบตอบไม่ได้ ให้แก้ feasibility ก่อนปล่อยและบันทึก budget/target revision ก่อน evaluation ใหม่ ไม่ลด quality gate
- Complex/receipt: ใช้ initialtargets และ harddeadlines ตาม spec§20; Phase0 วัด feasibility แยก cohort และ freeze ค่าก่อน candidateevaluation การเปลี่ยน target ต้องบันทึก decision ก่อนดูผล ไม่ใช้ jobtimeout แทน latencySLO
- Eligible simple read expectedruntimeModelCalls=0 หลัง intake; stablegeneral expectedERPCalls=0; reporttotalmodelcalls รวม intake/fallback/repair ด้วย

จบ Phase4 เมื่อ: มี evidence ทั้ง correctness และ latency ของ candidate เดียวกัน ค่า threshold ที่ยังไม่ตกลงหรือ sample ไม่พอไม่ถือว่า gate ผ่าน

## 9. Phase 5 — Integration, UAT และ rollout

สถานะ: [ ] รอทุก phase ที่อยู่ใน release scope ผ่าน

1. ทดสอบ API↔Gateway↔AgentCore contract กับทั้ง prepared/JSON paths ที่เปิดจริง และ featureflagoff/mixedversion; native ไม่เปิดโดยปริยาย
2. จริงบน LINE ทดสอบ 6journeys: typo→breakdown→filter correction; periodclarify→shortanswer→comparison; generalbusiness→companyread; webhandoff→continueinchat; receipt→why→correctionpreview→confirm; denied/timeout→recovery พร้อม no-duplicate delivery
3. ใช้ทั้ง Owner และ limited member, ทุกแพ็กเกจ/ฟีเจอร์ที่เปิดจริงตาม coverage manifest, branch scoping, feature off, quota/provider failure และไม่มีข้อมูล รวม group/room ที่ general advisor ห้าม prefetch profile และ COMPANY_INSIGHT ต้องเป็น 1:1 เพื่อพิสูจน์ว่า admin happy path ไม่กลบช่องว่าง
4. ทดสอบ frontend/LINEcards loading,error,review/permissionstates, deep links และ previewconfirm; verifydestination ใช้งานได้จริงตาม member ไม่ดูเฉพาะ URLformat
5. เปิดทีละ lane: internal fixturecohort → opt-in pilot → smallproductioncohort → ขยายเมื่อผ่าน gates ตาม runbook ไม่ต้องเปิด knowledge/company/native ทุกอย่างพร้อมกัน
6. ใช้ flag เดิมเมื่อแยก lane ได้จริง; หาก LINE_AI_ADVISOR_MODE ยังทำหน้าที่ capability ไม่ครบ ให้เพิ่มเฉพาะ scopedkill-switch ที่ต้องใช้และ documentapi/gatewayparity ห้ามคิดว่า enum มี knowledge เท่ากับ feature พร้อม
7. ก่อนทุก deploy/promote/retry ทำ [mandatory deployment protocol](../runbooks/uat-production-v2-deployment.md) บันทึก exact UAT/READY/ProductionrunIDs, source/runtimeidentity และ signedresult; customerOPEN + actualLINEjourney ต้องผ่านจึงกล่าวว่า livecomplete

### Rollback และ stopping rules

- Immediate rollback ของ lane ที่กระทบเมื่อพบ data leak/unauthorized mutation/wrongfinancialbinding/duplicateapply; disableexpansion ก่อนและ preservependingstate/evidence
- Canary false-refusal/handoff/loop เกิน gate หรือ latency/cost เกิน matchedbaseline10% ให้หยุดขยาย วิเคราะห์จาก typedoutcomes ไม่เปลี่ยน refusal เป็น answered เพื่อให้ counter ดี
- Knowledge/generalflagoff กลับ boundedtruthfulfallback; ไม่คืน genericout-of-scope สำหรับ knownbusiness งานที่ยังมี tool และไม่กลับ legacydirectwrite
- Rollback ต้องผ่าน runbook เหมือน deployment; บันทึก artifact/flagset ที่คืนและติดตาม turns ระหว่างเปลี่ยน version ไม่มี duplicate dispatch เพื่อหา error ใหม่
- อย่าอ้างว่า“เจ้าหน้าที่จะติดต่อ”หากไม่มี queue; incident/resume ใช้ระบบเดิม

## 10. File map และ focused checks

Paths ด้านล่างเป็น existingextensionpoints ไม่ใช่รายการบังคับต้องแก้ทุกไฟล์ ให้แตะเฉพาะ slice ที่ทำและตรวจ existingpatterns ก่อนเพิ่มไฟล์

| งาน | ไฟล์/ส่วนหลัก |
|---|---|
| Semantic/response contracts | `packages/contracts/src/line-ai.ts`, `line-ai-prepared-plan.ts`, `line-ai-advisor-answer.ts` |
| Interpretation/dispatch | `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts`, `orchestrator.agent.ts`, `application/use-cases/line-ai-turn.use-case.ts` |
| Runtime transport | `apps/ai-gateway/src/agentcore/runtime.ts`, `infrastructure/runtime/{runtime.port,agentcore-runtime.client}.ts`, `presentation/http/line-ai-internal.controller.ts`, API `ai-gateway.client.ts` |
| Continuity/delivery | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`, `line-intake-dispatch.use-case.ts`, ledger/read-evidence และ intake-state เดิม |
| Advisor/help/handoff | `line-advisor-direct-answer.logic.ts`, `response-composer.agent.ts`, capability-help/P23 registry และ route helpers เดิม |
| Fact rendering | `prepared-simple-read-formatter.ts`, `business-read-result-semantics.ts`, source tool contracts ใน API |
| Receipt | `expense-capture-read.logic.ts`, `packages/contracts/src/expense-capture.ts`, API `expense-capture-facts.logic.ts`, `receipt-ocr-apply.service.ts` |
| Rollout/evidence | `packages/config/src/index.ts`, existingbenchmark/corpus/evidence tooling; ห้ามแก้ package.json เพียงเพิ่ม script |

คำสั่ง existingfocusedchecks จาก repo root ด้านล่างเป็นตัวอย่างที่จะใช้ระหว่าง implementation **ยังไม่ได้รันในงานเขียนเอกสารนี้** เพิ่ม testcaseU01–U25 ลง suite ที่รับผิดชอบก่อนใช้ผลเดิมรับรอง fix

Reuse `scripts/line-ai-latency-autonomy.corpus.spec.ts` สำหรับ corpus integrity และตรวจวิธีใช้ `scripts/run-line-ai-operator-language-replay.ts` ก่อนเพิ่ม semantic replay ใหม่ แยก mocked replay, configured-provider evaluation และ actual LINE evidence อย่างชัดเจน ห้ามรัน provider/live scenarios โดยไม่กำหนด test company, budget และ permitted environment

```sh
pnpm --filter @watchdog-bms/contracts exec tsx --test src/line-ai-prepared-plan.spec.ts src/line-ai-advisor-answer.spec.ts
pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/agentcore/runtime.spec.ts src/modules/line-ai/infrastructure/runtime/agentcore-runtime.client.spec.ts
pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/modules/line-ai/agents/line-intake-router.agent.spec.ts src/modules/line-ai/agents/prepared-simple-read-security.spec.ts src/modules/line-ai/agents/prepared-simple-read-formatter.spec.ts
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/domain/logic/line-advisor-direct-answer.logic.spec.ts src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts
pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/modules/line-ai/presentation/http/expense-capture-routes.spec.ts src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/expenses/application/services/receipt-ocr-apply.service.spec.ts
pnpm --filter @watchdog-bms/ai-gateway typecheck
pnpm --filter @watchdog-bms/api typecheck
git diff --check
```

ก่อนใช้ตรวจ testcommand/package/toolavailability จริง รวมถึง focusedcomposer/orchestrator/receiptfacts/securitytests ที่ slice แตะ ส่วน model-backedreplay และ LINEUAT ต้องมี approvedtestenvironment ไม่แทนด้วย unit tests ประวัติ WIP typecheck/client failures ถูกแทนด้วยผล local ที่ PR819 รายงานแล้ว ให้ revalidate affected suites บน baseline ของงานนี้ ไม่ใช้ผลเก่าอ้างว่าผ่านทั้ง repo

## 11. Definition of done และสิ่งที่เลื่อนได้

- [ ] Source/config/prompt/runtime และ entitlementbaseline ระบุครบ; WIPintegrated โดยไม่ทับงาน
- [ ] Spec U01–U25 และ semantic/security/factualgates ผ่านตาม release scope
- [ ] Typedoutcome และ deliverytruth ตรงสิ่งที่ผู้ใช้เห็นทุก lane ที่เปิด
- [ ] Provider-backedheld-out และ actualLINEjourney ผ่าน มี source-linked evidence
- [ ] Latency/costthresholds ถูก freeze และผ่านบน candidate เดียวกัน
- [ ] Rollback/flags/mixedversion/pendingstate ทดสอบแล้ว
- [ ] UAT/READY/ProductionrunIDs และ signed/customerOPENacceptance ครบก่อนอ้าง livecomplete
- [ ] Docs/plan/memory อัปเดต status ตามหลักฐาน ไม่ใช้ marketingreadiness แทนผลทดสอบ

R1 ใช้ capability เดิมพร้อมงานซ่อมและ context/validation ที่จำเป็น; public search/general attachment Q&A/knowledge packs/preferences เป็น capability ใหม่ของ R2/R3 ที่ต้อง build ก่อนกล่าวอ้าง ส่วน voice C13/W10 พักตามผู้ใช้และไม่เป็น gate ของทุก release Model migration/vector retrieval เป็นทางเลือกเมื่อ benchmark ชี้ว่าจำเป็น; image highlight UI ไม่ใช่เงื่อนไขของ text evidence binding ส่วน full financial profile/bank partnership ยังพักตามคำสั่งผู้ใช้ ห้ามเลื่อน false-block/clarification transport/numeric binding แล้วรับรอง R1 และห้ามรับรอง edit journey ก่อนรวม/พิสูจน์ SEC-04 fix

การประเมินเวลาทำงานให้ทำหลัง Phase0 เห็น integrationdelta และ providerbaseline แผนนี้กำหนดลำดับ/entry-exitcriteria แทนกำหนดวันส่งที่ยังไม่มีหลักฐานรองรับ

## 12. Work packages ครบชุดและลำดับพึ่งพา

ทุก W ที่ active เป็นหน่วยส่งมอบที่มี diff/contract/tests ของตน ไม่ใช่คำสั่งให้สร้าง agent หรือ service ใหม่ เริ่มจาก baseline ที่รวม source ล่าสุดกับ WIP ที่จำเป็นอย่างชัดเจน ทุกสถานะด้านล่าง **planned** จนมีหลักฐาน implementation จริง ยกเว้น W10 ที่ผู้ใช้พักไว้

| W | ผลที่ต้องส่งมอบ | Dependencies | จุดแก้/หลักฐานรับงาน |
|---|---|---|---|
| W00 | Frozen baseline + executable capability/data manifest + benchmark A | ไม่มี | ต่อ registry/access helpers เดิม: API handler/DI → transport/tool → allowed inputs → runtime flags → channel/role/features → data basis; [audit](../research/mangmee-conversation-capability-dependency-audit-2026-09-26-th.md); spec§15.1; reproduce U01/U02/U10/U17 |
| W01 | Request/result contract และ outcome ครบทุก hop | W00 | `line-ai.ts`, runtime port/client/handler, API client/dispatcher; openClarifications/coverage/version skewtests; query/schema parity CI01/CI02/CI06/CI13 |
| W02 | Safe conversation projection + scope/CAS/expiry | W00,W01 | `AiConversation` additive schema, API persist/load, delivery refs; migration/full messagingChannelId owner + PendingMedia/lifecycle CI07/CI08; N01/N05/E02–E06 |
| W03 | Semantic routing/continuation/correction/anti-loop | W01,W02 | intake/router/orchestrator, ledger/intake state; U01–U06/U25/N04; no financial-openState side effect จาก generalquestion |
| W04 | General/business/format/depth/persona/help basics | W01,W03 | advisor parser/direct gate/composer/help; U07/U08/U22/U23/N01–N03 |
| W05 | Typed facts/calculation/claim binding | W00,W01 | source tools/resultsemantics/formatters/composer; CI01–CI06 query/date/branch/aggregate/Decimal/report oracle รวม web/export consumers |
| W06 | Bounded execution/recovery/coverage + existing API→LINE gaps ที่อยู่ใน manifest | W01,W03,W05; C เพิ่ม W02/W11 และ W13 delivery foundation | A ซ่อม planner/loop/coverage; B typed arguments/adapter สำหรับ backend ที่มีแต่ LINE ยังขาด; C ใบเบิก DRAFT create/update ใหม่ (R2) ตาม §19/spec§19.6 ใช้ domain เดิมพร้อม idempotency/revision/write gates; E05–E14/E23; ไม่สร้าง backend หรือเปิด native ซ้ำ |
| W07 | A: ซ่อม receipt เดิม (R1); B: general image/PDF Q&A ใหม่ (R2) | A: W01,W02,W05; B เพิ่ม W11/model-reader admission | A parser/fact assembly/OCR apply/pendingmedia + async current-access CI08/CI09/CI12/CI14; U17–U20/E12; B separate admission/dedupe/reader/question-only execution/page-grounding/zero-write CI11/E13; B ไม่ block A |
| W08 | Approved product/help pack retrieval | W00,W04 | P23 manifest/contracts/loader/retrieval/renderer; role+releasefilter/Recall@5/sourceexpiry/E14 |
| W09 | Public current-source lookup + citations | W01,W04,W06,W11 | approved connector/registry/publicquery/sourcepolicy/rendering; E15–E17, no private egress, currentclaim binding |
| W10 | DEFERRED — voice/audio/STT ตามผู้ใช้ | ไม่มี; ไม่เป็น dependency ของงาน active | ไม่ implement/activate; E18/E19 พัก ไม่รวม release acceptance |
| W11 | Model capability/workload/credit budgets + adapters | W00 | provider port/adapters/factory/tenantpolicy/config/ai-budget-bounds/pricing; exact-envelope compatibility/round-to-step/input allocator/lineage/hold tests CI13/CI14/E01/E20; R2 external search units CI15 |
| W12 | Explicit preferences list/update/delete/expiry | W02,W04 | owner-bound conversation preference fields/API/UX/cache; E21/E22; session≠durable, privacy notice |
| W13 | Deadline/abort/revision race/delivery/performance | Foundation: W01,W02,W11; integration เพิ่ม W06/W07 ของ release | buffer/usecase/runtime/provider/bodyread/delivery owner; E07/E23, actualLINEtiming/cancel-while-running/delivery-state matrix/async reauth/final APPLIED revision/settlement CI09/CI10/CI12/CI14; foundation ทำก่อน writer ใหม่ ส่วน integrated acceptance ทำหลัง writer |
| W14 | Corpus/fixtures/traces/feedback/blind comparison | W00; เก็บผลจาก W01–W13 ยกเว้น W10 | existing replay/corpus + §13schema; no held-out leakage/E24; trace ครอบคลุม model+renderer+delivery |
| W15 | Candidate integration/LINEUAT/canary/rollback | W ของ release นั้นผ่าน | package×permission×channel×lane manifest; exactrunIDs, signed+customerOPENacceptance; no checkbox-onlyhandoff |

Critical path R1: W00 → W01/W11 → W02/W05 → W03/W04/W06A-B/W07A → W13 → W15 โดย W14 ทำควบคู่ตั้งแต่ต้น R2 เพิ่ม W06C/W07B/W08/W09 และทำ W15 ซ้ำ R3 เพิ่ม W12 และ full17-capability W15; W10 พัก ไม่จำเป็นต้องรอ R2/R3 เพื่อแก้ falseblock ของ R1 และไม่ข้าม dependencies เพื่อให้เวลาเร็วขึ้นบนกระดาษ W06C เป็นใบเบิก draft writer เพิ่ม ไม่รวม submit/approve/pay

## 13. Data/contract migration, test fixture และหลักฐาน

### 13.1 Migration และ compatibility ที่ต้องทำจริง

W02 ขยาย `AiConversation` ตาม spec§16.2 ไม่ยัด summary ลง financial `LineIntakeState` หรือ telemetry JSON: legacy rows คงอยู่แต่ v2 ไม่อ่านเป็น boundcontext, transport channel=line แยกจาก channelKind=USER/GROUP/ROOM และ verified messagingChannelId, newrows ผูก verifiedowner และใช้ IDnamespace ใหม่ไม่ reuse `line-${companyId}-${userId}`, all-or-none binding, loader joinexactv2conversationId, CAS บน fullowner+version, indexes/uniqueness และ cleanup เฉพาะ taskprojection ตาม expiry ต้องทดสอบ upgrade/rollback/oldwriter/แถว legacy ไม่มี chathash ไม่ลบ pendingfinancialauthority เพราะ projection หมดอายุ

W12 เพิ่ม preferenceJson/preferenceVersion/preferenceExpiresAt บน v2 AiConversation ตาม core contract§9 ออก migration แยก W02; taskexpiry15 นาทีแยก preferenceexpiry90 วัน, deletioninvalidatecache ไม่ทำ drop-column ใน rollback ทันที Mixed-version API/Gateway/worker ต้องไม่ writeprojection ใหม่ด้วย schema เก่า ความสามารถที่ไม่ negotiated ให้ fall back ตาม truthfuloutcome ห้ามเติม defaults ที่ทำให้ cancel/clarification หลุด

W02/W07A ต้อง map PendingMedia owner+attachment+intake+job และ lifecycle hooks opt-out/unlink/employee DISABLED ตาม spec§16.3 ด้วย; conversation migrationอย่างเดียวไม่พอ Legacy unbound pendingไม่auto-adopt; stale writerห้ามupsertstateที่ลบแล้ว Capture jobs/financial proofไม่ถูกล้างด้วย conversationTTL

ทุก field ใหม่มี receiverparse และ bounds: identity/serverderived fields ห้ามรับจาก model, task/sourceversion ต้อง match ตอน execute/save/send, publiclookupsourceURL มาจาก tool, image/PDF page coverage ไม่หายระหว่าง buffer/transport bounds receiver ปัจจุบันเทียบ exact equality จึงต้องทดสอบ oldAPI/newGatewayและกลับกัน ไม่ถือ additivefieldsแก้ version skewแล้ว W11ตรึง round→step→hold mapping/compatible artifact switch ก่อน repair; legacyintakeคง1callจนรองรับ และ per-call inputbudgetต้องรวม ThaiUTF8/context/catalog ไม่เรียก provider แล้วค่อยพบ budgetsettle ไม่ได้

### 13.2 รูปแบบ scenario ที่ runner ต้องรับ

ใช้ format ต่อยอด runner เดิม; logical fields ด้านล่างเป็น required information ไม่บังคับสร้าง framework ใหม่:

```json
{
  "id": "U04-th-short-month",
  "familyId": "period-clarification",
  "split": "held_out",
  "capabilities": ["C02", "C04", "C06"],
  "fixture": {
    "clock": "2026-09-26T03:00:00Z",
    "timezone": "Asia/Bangkok",
    "company": "synthetic-A",
    "actor": "owner-A",
    "channelKind": "line",
    "messagingChannelId": "synthetic-oa-A",
    "membership": "synthetic-member-A",
    "chat": "chat-A",
    "permissions": ["expense.read"],
    "enabledFeatures": ["expenses"],
    "sourceSnapshot": "fixture-version-1"
  },
  "turns": [
    {"user": "ช่วยสรุปค่าใช้จ่ายหน่อย", "expect": {"outcome": "needs_input", "missingSlot": "period"}},
    {"user": "สิงหา", "expect": {"period": "2026-08", "sameTask": true, "forbidRepeatedSlotQuestion": "period"}}
  ],
  "oracle": {
    "requiredFacts": [{"metric": "expenseTotal", "value": "1000.00", "currency": "THB", "basis": "exclude_rejected_voided"}],
    "forbiddenEffects": ["cross_scope_read", "final_mutation", "duplicate_delivery"],
    "requiredDelivery": "ACCEPTED"
  }
}
```

ตัวอย่างนี้ต้อง seed originaltask ว่าช่วงเวลายังไม่มีและปี 2026 ชัดจาก fixture/context; ถ้า implementation ใช้ defaultperiod ที่ declared แล้วให้ใช้ scenario variant ที่สร้าง explicitmissingperiod ไม่เปลี่ยน oracle เพื่อยอมรับพฤติกรรมที่ผิด เปรียบเทียบ actualtoolcanonicalinputs กับ fixtureexpectedinputs เพิ่มเมื่อเลือก toolfamily จริง; ภาพ/PDF ต้องมี asset hash และ humanlabels ไม่มี customerdata

Run evidence ขั้นต่ำ: scenario/family/seed/repeat, source+schema+prompt+registry+model+priceversions, scope/flagset, normalizedgoal/slotdiff, toolattempts+results, typedanswer/deliveryoutcomes, validationfailures, model/provider/token/cost totals, stage times/deadlines, source hashes และ redactedfinalanswer เก็บ rawprovideroutput เฉพาะ synthetictestenvironment ที่อนุญาต

### 13.3 Oracle และ failure taxonomy

Oracle แยก semantic intent, exact tool/input/effect, correct facts, helpfulness, instructionfollowing, citations, continuity, delivery และ performance ไม่ให้คะแนนรวมกลบ security/financecriticalfailures Errorfamily อย่างน้อย: SEMANTIC_MISREAD, CONTEXT_LOST, WRONG_SCOPE, WRONG_TOOL, WRONG_FACT_BINDING, UNSUPPORTED_FALSE_REFUSAL, REPEATED_CLARIFICATION, COVERAGE_DROP, STALE_SOURCE, FABRICATED_CITATION, UNAUTHORIZED_EFFECT, DELIVERY_DUPLICATE, LATE_RESULT, BUDGET_BREACH, PROVIDER_FAILURE

150scenarios คือขั้นต่ำ ไม่ใช่ 150unitassertions; split ตาม family ก่อนทำ paraphrase ทุกคำแปรรูปของต้นเรื่องเดียวกันอยู่ split เดียว เพื่อไม่ให้ held-out มีโจทย์ที่เพิ่งสอน prompt อย่างน้อย 50held-outscenariofamilies จากทุก lane ที่เปิด; ถ้า sample ตาม family ไม่พอให้เพิ่ม corpus ไม่ย้าย paraphrase เพื่อให้ครบตัวเลข

รัน 3repeats ราย scenario แล้วรายงาน per-run และ worst/failure rate; repeats ของ scenario เดียวกันไม่ถือเป็น independentfamilies Confidenceinterval ของ win/tie/completion ใช้ unit เป็น scenario/family (เช่น cluster bootstrap) และรายงาน numerator/denominator จริง สำหรับ p95 ใช้ attempts100 ขึ้นไปเป็นขั้นต่ำในการเริ่มรายงาน แต่จำนวน 100 อย่างเดียวไม่รับรอง tail: แสดง interval/samplewindow/coldwarm/errorcounts และเพิ่ม samples เมื่อ interval ยังข้าม gate

Blindcomparisonfreeze model/config/scoring ก่อนดูผล สลับลำดับคำตอบไม่ให้ grader เห็นชื่อ model ใช้ humanadjudication สำหรับ disagreement และ exactoracle สำหรับเงิน/สิทธิ์ Pair ที่ทั้งคู่ผิดไม่เป็น passingtie หาก 95%confidenceinterval ของสัดส่วน candidate ที่ใช้งานได้และไม่ด้อยกว่า reference ยังคร่อม target90% ให้รายงาน inconclusive และเพิ่ม held-outfamilies ไม่อ้างว่าใกล้เคียงแล้วจาก pointestimate

## 14. Release controls และงบปฏิบัติการ

ใช้ flag เดิมเมื่อแยก capability ได้ถูกต้อง เพิ่มเฉพาะ control ที่ทำ rollback ต้องมีจริง: v2 contextprojection, stableadvisor, publiclookup, generalattachmentQ&A, explicitpreferences แต่ละตัวมี server-derivedcapabilitybit/version/API+Gatewayparity และ negative-offtests ห้ามทำ flag ทุก prompt ย่อยหรือเปิด native loop โดยถือว่าเป็น smart-mode

| Release | ต้องมี | ข้อจำกัดคำกล่าวอ้าง |
|---|---|---|
| R1 | C02/03/04/06/07/10/11/14/15 + C12 receipt + C01/16/17/18 gates, existinghelp ตามสิทธิ์ | เข้าใจและตอบงานหลัก; ไม่อ้างค้นล่าสุด/เสียง/จำข้าม session ถ้ายังปิด |
| R2 | R1 + approvedhelp C08 + publiclookup C09 + C12 general image/PDF Q&A | อ้าง current facts ได้เฉพาะ source ที่ค้นจริง; ไม่อ้างทุก domain/taxrule ผ่าน review |
| R3/full v2 | R2 + C05, fullcross-capabilityacceptance และ regression ทุก R1/R2 | จบขอบเขต 17 capabilities (C13 พัก) เมื่อ actualLINE/provider/quality/perfgates ผ่าน ไม่ใช่เมื่อ merge เฉย ๆ |

Spec§20 กำหนด initiallane budgets/SLO; Phase0 วัด feasibility และ price envelope ก่อนเปิด Changebudget/target ต้องมี decision/evidence ก่อน candidateevaluation ไม่ปรับ threshold หลังเห็นคะแนนและไม่ใช้ canary เพื่อหาว่า unsafe หรือไม่ Security/source-honesty/wrongamount/unconfirmedwrite0tolerance ใน releasefixtures; production พบเหตุ critical หนึ่งครั้งให้ disableaffectedlane และทำ incident ตาม runbook

Canary ใช้ scopedtest/internalcohort ก่อน pilot; sample ต้องครอบคลุม cold/warm/permissions/branches/featureoff ครบ aggregategate และไม่มี criticalviolation ก่อนขยาย Failure จาก provider ก็อยู่ availability/costdenominator แม้แยกออกจาก modelsemanticaccuracy ตั้ง dailybudget ผ่าน existingcompanyusagepolicy และ stop เมื่อ admission ปฏิเสธ ไม่วน request เพื่อข้าม quota

Rollback เก็บ pendingtask/previewauthority/durablepayload/usageholds ไว้,ปิด newlane หรือคืน lastknownartifact ตาม runbook และ reconcilelateattempts ไม่ย้อน schema แบบ drop ทันที ปิด contextprojection ต้องไม่เปิดคืน cross-chatlegacyhistory แบบ raw ส่ง clarification ที่ตรง missingcontext แทน ขั้นตอน LINEacceptance ยังใช้ signedresult+customerOPEN และ exactrunIDs ตาม parentprotocol

## 15. Final handoff ที่ต้องส่งเมื่อ implementation จบ

1. C01–C18 matrix ระบุ existing/repair/new/deferred และ implemented/tested/enabled/blocked แยกกัน พร้อม source/configversion และ reason ทุก blockedcell; featurefamily×package×permission×channelmatrix แนบมาด้วย
2. W00–W15 รายการ diff/contract/migration/tests และ dependency ที่รวมแล้ว; SEC-04previewIdfix ที่ merge ใน main ใช้ evidencecandidate จริง ไม่ copy ผล local ของงานก่อน
3. U/N/E acceptance ทั้งหมดตาม release scope + at least150scenarios/50held-outfamilies + model/harnesscomparison + screenshot/traceLINEjourneys ของ candidate เดียวกัน
4. Per-laneattempt counts, accuracy/completion/loop/refusal/handoff/criticalfailures, time p50/p95/interval, totalcost และ failurecost, source/consent/retention/configmanifest
5. Rollbackexercise, pendingworkrecovery, providerabort/settlement/bodytimeout, preferencedelete/expiry, public-egress และ source-injectionnegativecontrols
6. Exact UAT/READY/Productionruns และ customeracceptance เมื่อมี deployment; ถ้ายัง localonly ให้ระบุชัดและห้ามเรียก livecomplete

งานออกแบบครบเมื่อเอกสารหลัก+catalog+mapping ผ่าน review และไม่มี corecapability ที่ปล่อยให้ผู้ implement เดา authority/storage/recovery เอง งานพัฒนาจะครบเมื่อหลักฐานทั้งหกข้อข้างบนผ่าน ผู้ใช้ไม่ต้องขอเพิ่มทีละทักษะที่อยู่ในขอบเขต active อีกครั้ง; C13/W10 ยังพักจนผู้ใช้เปลี่ยนขอบเขต

## 16. Backlog ฝั่งระบบที่ต้องรองรับ AI

Owner follow-up: หลังปรับ AI แล้ว ระบบต้องมีอะไรเพื่อให้ตอบได้จริง ใช้ผล [capability audit](../research/mangmee-conversation-capability-dependency-audit-2026-09-26-th.md) ที่ main `f932b577` เป็นฐาน ตารางนี้แตกงาน support ภายใน W เดิม ไม่เพิ่มชุดโครงการ/agent/service ซ้ำ และไม่ถือว่า implementation เสร็จจากการเขียนตาราง

**P0** = จำเป็นต่อความถูกต้อง/การใช้ capability เดิมใน R1; **P1** = ทำให้ชุดคำถามหลักครบและเจาะต่อได้ใน R1; **P2** = capability ใหม่ของ R2/R3 ไม่ขวางการซ่อม R1 เรื่องเสียงและ FinancialProfile/ServicesNeeds ยังพัก

| งานระบบ | ของเดิมและสิ่งที่ต้องเติม | คำถาม/พฤติกรรมที่ปลดล็อก | Dependency / การรับงาน |
|---|---|---|---|
| P0 รายการ operation ที่ทำได้จริงต่อผู้ใช้ | มี registry/permission/feature/flag helpers; เพิ่ม handler/DI/channel/argument parity และ trusted capability snapshot สำหรับ planner/help | “ทำอะไรได้บ้าง” ตรงกับสิ่งที่ทำได้; ไม่เสนอ banktool ที่ยังไม่ wired หรือเสียง | W00/W01; E14 ready/unwired/web-only/flag-skew/denied controls; capture ใช้ API intake แยก read-toolMap |
| P0 ส่งบริบทและผลครบทุก service | มี clarification/coverage ในบาง contract; ต่อ API→Gateway→AgentCore→API ให้ครบ | “สิงหา” เติมเดือนเดิม ไม่เริ่มถามใหม่; ขอ 2 เรื่องแล้วรู้ว่าสำเร็จกี่เรื่อง | W01; U04/U11/E10 mixed-version roundtrip ไม่ silently default state |
| P0 สถานะงานและ reference ที่จำได้ถูกคน/ถูกแชต | มี ledger/pendingstate/source refs; เพิ่ม safe task projection/CAS/expiry และ delivered question/option refs | “ใบที่สอง”, “เมื่อกี้”, “พักเรื่องบิลก่อน” แล้วกลับมาได้ | W02/W03; U06/N01/E02–E07; general question ไม่ consumefinancialauthority |
| P0 ผล API มี metric/basis/currency/evidence ชัด | มี summary/formatters/sourceRefs; เพิ่มข้อมูลกำกับและแก้ financialsemantics ของ enabledfamilies | “ยอดนี้คือจ่ายแล้วหรือแค่บันทึก” ตอบตรง; 2 รายการไม่กลายเป็น 2 บาท | W05; U10/U12/E11; exactdecimaloracle, expenseDate≠paidAt, mixedcurrencies ไม่บวกตรง |
| P0 บอกข้อมูลขาด/ครบ/เก่า/อ่านไม่ได้อย่างชัดเจน | มี status/asOf/stale/truncated บาง path; เติม aggregate/rows/groups completeness และ missing prerequisite ตาม source ที่ตรวจได้ | “ทั้งหมดเท่าไร” ไม่ตอบจากแค่ 5 รายการ; “ร้านกำไรไหม” ไม่เดาจากค่าใช้จ่ายอย่างเดียว | W05/W06; E10/E11/E14; >15groups/>5rows/partialfetch/emptyvsfailure ไม่มี unverifiedcoverageclaim |
| P0 ผลผิดพลาดและงานช้ามีทางจบที่ถูกต้อง | มี timeouts/budget/queue/delivery; ต่อ whole-turn deadline/cancel/supersede/bodytimeout/typedrecovery | ผู้ใช้เปลี่ยนโจทย์แล้วไม่ส่งคำตอบเก่าตามมา; tool หนึ่งล่มยังตอบส่วนที่สำเร็จ | W11/W13; N06/E07/E09/E23; abortusage ยัง settle, retry ไม่ duplicate |
| P1 Query inputs ครบตามคำถามหลัก | reuseexistingexpenseAPIfilters; ต่อ typedtoolarguments/sanitizer/adapter ตาม supportedquerymanifest ไม่แก้ด้วย synonymlist | “เฉพาะหมวดอาหารของสาขานี้ที่จ่ายแล้ว เดือนก่อน” | W00/W01/W05/W06; U01–U03/E14; exactrequested→appliedpredicate assertion; ไม่ dropfilter; เงินที่จ่ายในงวดต้องใช้ paymentdatepath ที่ถูก |
| P1 ค้น/เลือก/เจาะรายการและเทียบงวด | reuseexistinglist/detail/explain/breakdown/candidates; แก้ repeattoolrestriction เมื่อ input ต่าง; resolve ชื่อเป็น authorizedID เมื่อมี lookup ไม่เดา ID | “เดือนก่อนล่ะ”, “เพิ่มตรงหมวดไหน”, “ขอดูบิลที่เกี่ยวข้อง”, “หมายถึงสาขา A” | W02/W05/W06; U05/U21/N03/E06/E11; repeat fingerprint รวม canonicalinput; samebasis/currency, divisionbyzero/partialcontrols |
| P1 ต่อ backend ที่มีแต่ LINE ยังไม่ถึง | เพิ่มเฉพาะ adapter/contract ที่ manifest กำหนดต้องรองรับ เช่น bankreportingtools; ไม่สร้าง bankfeed หรือ forecast | “กระทบยอดล่าสุดเมื่อไร” ตอบจาก report จริงพร้อมวันที่; ไม่อ้างยอดธนาคารสด | W00/W05/W06; SOURCE_MODULE_NOT_READY ก่อน wire, source-as-of/basis/rightschecks หลัง wire; family ยังไม่ผ่านห้าม advertise ว่าพร้อม |
| P0/P1 หลักฐานเอกสารและแก้รายการต่อเนื่อง | reuseOCR/readjobs/humanoverride/previewId/confirm ที่ merged; เพิ่ม field-local evidence และ reference continuity | “ยอดนี้มาจากไหน”, “แก้หมายเหตุในบิลเดิม” พร้อมร่างก่อนยืนยัน | W07A/W02/W05; U15/U17–U20/U24/E12; no stale/duplicatewrite ไม่สร้าง confirmflow ใหม่ |
| P0 ตรวจครบจาก API จนถึงคำตอบที่ส่ง | มี test/corpus/tracing; เพิ่ม query/basis/completeness/state oracles และ LINEjourneys บน candidate เดียวกัน | ความสามารถที่ติ๊กพร้อมต้องผ่านคำถามจริง ไม่ใช่แค่มีชื่อ tool | W14 ทำคู่ทุก slice→W15; stage timing+cost+scope+source/configversion; sanitizeddiagnostics |

### 16.1 ชุดคำถามแรกที่ใช้ล็อก supported query scope

1. **ภาพรวม → แยกหมวด → เจาะรายการ:** “ค่าใช้จ่ายเดือนนี้เท่าไร” → “เฉพาะสาขานี้” → “แยกหมวด” → “ดูรายการในหมวดอาหารที่จ่ายแล้ว” ใช้ expenseAPI/tools เดิมและ arguments ที่ต่อเพิ่ม ห้ามสลับงวด/branch/status ระหว่างขั้น
2. **เปรียบเทียบ → อธิบายส่วนต่าง:** “เทียบเดือนก่อน” → “หมวดไหนเพิ่มมากสุด” ใช้แหล่งเดียวกัน/ครบตาม scope และ code คำนวณผลต่าง; แยกการบอกว่าตัวเลขหมวดใดเพิ่มออกจากการเดาว่าพฤติกรรมธุรกิจอะไรเป็นสาเหตุ
3. **งานวันนี้ → รายการที่เกี่ยวข้อง → การแก้ที่รองรับ:** reuse `expense.get_daily_closing`/detail/explain และ confirmededit ให้ดูรายการใกล้ครบกำหนด/รอตรวจ/หลักฐานขาดที่เครื่องมือคืนจริง ไม่สร้าง schedule/notificationservice ใหม่และไม่อนุมัติหรือจ่ายเงินแทน
4. **ความรู้แทรก → กลับงานเดิม:** pending bill → “กำไรกับเงินสดต่างกันยังไง” → “กลับใบเมื่อกี้” ต้องมี generalanswerpolicy และ taskrefs ไม่ต้องเพิ่ม financialprofile หรือ websearch

W00 ตรึง canonicalargs/resultbasis/permissionvariants ของชุดนี้ก่อน W06 เพื่อให้ backend และ AI ทีมเดียวกันเข้าใจคำว่า“ทำได้”ตรงกัน การเลือกตัวกรองใหม่ต้องตรวจ APIimplementation จริงและเพิ่ม schema/validation/adapters/tests พร้อมกัน หากไม่มีต้นทางข้อมูลให้ markgap และบอกข้อจำกัดตรงคำถาม ไม่ลด acceptance เงียบ ๆ

### 16.2 Capability เพิ่มภายหลัง แยกจาก support พื้นฐาน

| Capability ใหม่ | ระบบที่ต้องเพิ่ม | ก่อนเปิดต้องมี |
|---|---|---|
| Approved product/knowledge retrieval | W08 approvedmanifest/content/retrieval/citations; help พื้นฐานเดิมใช้ต่อ | source ตรง release/สิทธิ์ ไม่ ingestdocs ทั้งหมด |
| Public/current lookup | W09 approvedconnector+source/egress/freshness/citation+usage | ค้นจริงและรองรับ claim; ไม่มี privateegress/ปลอม citation |
| General image/PDF Q&A | W07B question-onlyroute+reader/pagegrounding | ไม่สร้าง expense เมื่อขออธิบาย; provider รองรับ attachment จริง |
| Durable reply preferences | W12 opt-in scopedstorage/list/change/delete/expiry | owner-boundcontext พร้อม; ไม่ใช้เป็น businessfacts/permission |

ลำดับรวม: **W00 → W01/W11 contracts+budget → W02 owner/lifecycle + W05 source correctness → W03/W04/W06/W07A → W13 integration → W15 acceptance** โดย W14 และการออกแบบ/ซ่อม admission+asyncaccess+cancel guards ของ W13 เริ่มตั้งแต่ต้น ก่อนเปิด route/context ใหม่ ไม่เลื่อน security gatesไปท้ายงาน การเปิด R1 ไม่รอ capability ใหม่สี่รายการข้างบน และไม่มีงานเสียงในเส้นทางนี้


## 17. Consistency/impact remediation จาก main f932b577

[รายงานหลักฐาน CI01–CI16](../research/mangmee-ai-consistency-impact-audit-2026-09-26-th.md) เป็นรายการรับงานร่วมของ Wเดิม ไม่ใช่ implementation ที่เสร็จแล้ว สิ่งที่เพิ่มในรอบนี้คือ source correctness/contract parity/owner lifecycle/async delivery/budget และการตัดเงื่อนไขแผนที่ขัดกัน

| Finding | งานแก้/เพิ่ม | Dependency ที่ห้ามตก | Gate เดิมที่ขยาย |
|---|---|---|---|
| CI01–CI03 | periodไม่ถูกdrop; civil-date/partialpolicy; explicit branch/central semantics | registry→parser→delegation/inputdigest→API/source→prepared/JSON/native→formatter/link | W01/W05/W06; E11/E14/N03 |
| CI04–CI05 | snapshot-consistent aggregate + exact sourceDecimal | expense repository/queryplan, ledger/P&L, web/export consumers, bounded rows/groups | W05/W14; E10/E11 |
| CI06 | requested metric/dataset ไม่ถูกเลือกแทนด้วย permission | reportregistry/adapter + routing + rolevariants | W00/W01/W05/W06; E11/E14 |
| CI07–CI08 | OAinstance owner, lifecycle invalidation, PendingMedia binding + replace/supplement policy | schema/APIauth/unlink/employee hooks + intake/attachment/jobs; oldwriter/rollback | W02/W07A/W12/W13; E02/E05/E12/E13/E21/E22 |
| CI09–CI10 | fail-unavailable async access; general global gates/private-prefetch0 | notifier/outbox/snapshotbranch+revision; intakecontext+public/private deliveryproof | W01/W03/W04/W07A/W13; E02/E05/E14/E17/E23 |
| CI11 | question-only admission/readerก่อนcapture-onlyfastpaths | MIME/dedupe/permission/AIusage/reader; no-upload user; expensewrites0 | W07B R2; E13/E14/E17 |
| CI12 | delivery cancel matrix + preserve committed/APPLIED finalrevision | ledger firstdispatch/replay/currentaccess, PR819postcommit vendor outcome, cache/context | W02/W07A/W13; U15/U24/E07/E23 |
| CI13 | round-to-step heldbudget + Thaiinputallocation + versioncompatibility | contracts/pricing/reservation/providerfactory/API/Gateway/runtime artifact | W01/W02/W11; E03/E20 |
| CI14 | แยก195sclienttimeoutจากresumablejob40calls/15min/5attempts | admission/checkpoints/lease/recovery/terminalnotifier; spentbudgetacrossresume | W07/W11/W13; E12/E20/E23 |
| CI15 | publicconnector non-token usageถ้ามีค่าบริการ | pricedunits/hold/settle/priceversion; adaptermanifest | W09/W11 R2; E17/E20 |
| CI16 | J2 R1/R2 releasevariants + source-backed testoracles | sourcefamily×lane×role×channel×delivery และ exactcandidate | W00/W14/W15; J2/E11/E13/E14 |

### 17.1 Implementation slices และเกณฑ์หยุด

1. **Baseline + contracts:** W00 pin serving manifest/source และ freeze requested/effectivequery fixtures จาก sourceจริง รวม CI01–CI06; W01/W11ตกลง envelope compatibility และ per-call input policyก่อนเพิ่ม rounds/context ทุก familyที่ advertiseต้องมี pathจริง
2. **Source + ownership foundation:** W05ซ่อม date/branch/Decimal/aggregationก่อนอ้าง correctfacts; W02/W07A owner/lifecycle/pendingmedia และ W13 current-access/cancel guardทำควบคู่ ก่อนเปิดmemory/general/group/newmedia lane กติกาเงินและสิทธิ์ไม่ลดเพื่อให้ข้อความลื่นขึ้น
3. **Conversation + integration:** W03/W04/W06 semantic/general/compare ใช้ฐานที่ถูก W07A receiptfieldbinding/override/replacement ใช้proofเดิม; W13 deadline/delivery/asyncrecoveryตามstate matrix ไม่เขียนconfirmซ้ำ
4. **R1 acceptance:** run existing U/N/Eที่เกี่ยวข้องรวมCIvariants, J1+J2-R1, zero critical violations และ measured quality/latency/costบนcandidateเดียว W15ตามrunbookเมื่อมีงานreleaseที่ได้รับอนุญาต ไม่ถือ pureprobesในauditนี้เป็นreleasegatepassed
5. **R2/R3:** W07B/W08/W09 และ W12ตามลำดับเดิม เพิ่ม J2-R2/J3/externalsearchaccounting/privacy gatesเฉพาะlane ไม่เอาcapใหม่มาขวางR1และไม่ทำvoice

### 17.2 ลด/คง/ไม่ทำซ้ำ

- ลบ blanket195s whole-document deadline และ assumptionว่า16KiBstorageส่งเข้าmodelได้ทั้งหมด; แยกjoblease/runtimebudget/chatSLOให้ตรงsource
- ไม่ promiseถอนข้อความหลังUNKNOWN/ACCEPTED; ไม่ให้generalfallbackผ่านglobalAIgates; ไม่ให้taskTTLลบfinancialproof
- คงPR819ที่mergedและทดสอบ postcommit/autosave/cache/replayร่วมกัน; ไม่สร้างconfirmflowหรือbackendanalyticsใหม่
- ไม่มีpackage/dependency/framework/agentเพิ่มเพื่อแก้contractเหล่านี้ Native loop/modelmigrationยังต้องมีevidenceของตน ไม่เป็นdefaultfix
- สถานะการแก้CIทั้งหมดคือ **planned/source-audited** ยกเว้นข้อผิดในเอกสารCI14/CI16และข้อกำหนดอื่นที่แก้ในspec/planแล้ว; ไม่มีappcodefixในรอบนี้


## 18. งานความเร็วที่ต้องทำพร้อมกับความฉลาด

**Long-text dependency:** [source audit/probes2026-09-27](../research/mangmee-long-text-truncation-audit-2026-09-27-th.md) และ spec§19.4เป็นงานในWเดิม: W01ต่อstopReason/overflow/partial contract; W02รักษาcritical constraintsแทนpreview240; W04/W06เลิกบีบคำตอบทุกงานด้วยshort-onlypromptและตรวจcoverageก่อนรับtruncatedoutput; W11จัดoutput/inputbudgetตามworkloadพร้อมhold/receivercompatibility; W13ต่อcanonical answer→lossless text/Flex→bounded batchesเข้าทั้งgateway/intake/receiptและตรวจadaptercallers; W14เพิ่มvariantsของE03/E20/E23/N02/N03/N05 ต้องแยกroot causeก่อนเพิ่มtokensหรือเปลี่ยนmodel ถือsilent content lossเป็นquality failure ไม่ใช่performance gain

**Reconciliation หลังตรวจ live:** [รายงาน Production/UAT2026-09-26](../research/mangmee-ai-live-timing-readback-2026-09-26-th.md) ยืนยันแผน/structuredevents/AiTurntimingและhostedbaseline09-03มีอยู่แล้ว §18เป็นbacklogต่อระบบเดิม ไม่อนุมัติสร้างtimingใหม่แทนของเดิม W00/W14เริ่มที่inventory+coverage+join/report; เพิ่มfieldเฉพาะที่พิสูจน์ว่าขาด เช่นactual lane/fallbackreason, per-callcorrelationและfailedattemptcoverage แยกlogreadaccess/collectorหลังKamalออกจากAIcodefix

Owner follow-up: ความเร็วเป็น acceptance ของประสบการณ์เดียวกัน ไม่ใช่งานเก็บท้ายโครงการ รักษา correctness/access/credit/delivery gates และใช้ W00/W05/W06/W11/W13/W14 เดิม ไม่เพิ่ม service หรือ agent

### 18.1 หลักฐานจาก source f932b577 และสิ่งที่ยังไม่รู้

| ช่วงเวลา | สิ่งที่เห็นจริงใน source | งานที่ลด latency / หลักฐานรับงาน |
|---|---|---|
| Buffer/debounce | [config](../../packages/config/src/index.ts) :237–238 default2000ms/max8000ms; [logic](../../apps/api/src/modules/line-ai/domain/logic/line-message-buffer.logic.ts) :262–289 มีcohorts1000/1500/2000ms | ใช้ experimentเดิมเพื่อเทียบ1s/1.5sกับ2s ไม่ปิดbufferทั้งหมด Testหลายbubble/ข้อความ+รูป/ลำดับ/duplicateและclarificationrate; 2→1sลดเฉพาะcomponentนี้1s ไม่ใช่รับรองทั้งturnเร็วขึ้น50% |
| Model round trips | [orchestrator](../../apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts) :1076 routeซ้ำ, :1733เลือกtool, :1360compose; prepared :1488–1497ใช้validatedplan+1tool+formatterโดยไม่มีruntime modelเพิ่ม | W01/W03/W06ใช้semantic intakeผลเดิมให้ครบ; simple readรวมintakeเป้า1modelcall ไม่route/select/composeซ้ำ; logpreparedserved/fallbackreasonและrepaircalls ไม่ลดguardเพื่อเพิ่มhit-rate |
| Prepared family coverage | [formatter](../../apps/ai-gateway/src/modules/line-ai/agents/prepared-simple-read-formatter.ts) :638–667มี10compiledfamilies แต่ต้องตัดกับeffectiveallowlist | liveAgentCore26ก.ย.prod12/UAT33ยืนยันpreparedtrue4families แต่ยังไม่พิสูจน์servedhit-rateหรือAPIconfigทั้งหมด; W00วัดactualeligible denominatorและblockedreason ขยายทีละfamilyหลังsource/formatter/evalผ่าน ไม่เปิดทั้งหมดจากcompiledcount |
| Source reads | [expense tool](../../apps/api/src/modules/line-ai/application/use-cases/erp-tools.use-case.ts) :217,322–329อ่านได้ถึง10pages×100rowsตามลำดับก่อนรวมยอด | W05ใช้permission-scoped aggregate+bounded detailภายใต้consistent snapshot ลดpayloadและroundtrips; ต้องดูqueryplan/timingจริง ไม่รับรองว่าqueryใหม่เร็วกว่าโดยยังไม่วัด |
| Independent questions | [dispatch](../../apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts) :1690–1703/1733รอทีละขั้น | W06รันเฉพาะsafe independent readsพร้อมกัน≤2ภายใต้budget/ABAC/snapshot semantics; dependentreads/financialactionsไม่ขนานเพื่อทำตัวเลขสวย |
| Hung/tail requests | [AgentCoreclient](../../apps/ai-gateway/src/modules/line-ai/infrastructure/runtime/agentcore-runtime.client.ts) :208,239,253credentialก่อนHTTPtimerและclearTimerก่อนbodyread | W13wholeturn/step/bodydeadline+cancel+settlementครบ; header-success/body-stallและqueueหลังงานค้างต้องจบตามbudget การแก้timeoutลดtailไม่ใช่ทำให้ทุกnormalcallเร็วขึ้น |
| Runtime experiments | [config](../../packages/config/src/index.ts) :528–534providerreuse/sessionaffinity/smallrouterflagsถูกระบุRESERVED/INERT | ห้ามขายการเปิดflagว่าเป็นperformancefix เก็บcredential/connect/cold-warm/modelTTFT/settlementtimingก่อน ถ้าต้องwireจริงต้องมีscope/tenant/model/usage isolationtests ไม่แชร์mutable requestcontext |

Measured model-call evidence เดิมบน a2: representative salesfallback=3runtime modelcalls+1ERP เทียบprepared=0runtime modelcalls+1ERP โดยยังไม่รวมintake เป็นโครงสร้างเส้นทางที่ต้องลด ไม่ใช่secondsbenchmarkบนmain ปัจจุบัน ดู [auditเดิม](../research/mangmee-ai-code-verification-2026-09-26-th.md)

Historical runtime p95=7637ms จาก95duration samples/หลายreleaseไม่ได้รวมLINE end-to-endและยังมีข้อมูลขาด ห้ามนำไปอ้างว่ารุ่นf932ตอบ95%ภายใน8s ต่อมาอ่านliveAgentCoreflagsและDBtimingแล้วตามreportข้างต้น แต่ยังไม่มีcurrentfullLINElatencybenchmark

### 18.2 Target และการไม่ทำให้ผลวัดดูเร็วเกินจริง

ใช้ spec§20: single complete text general p95≤5s, simple read≤8s; mixed/explain≤15s, publicresearch≤20s และclear single-imageถึงdraftready≤30s ทั้งหมดเป็นเป้าที่ต้องพิสูจน์ ไม่ใช่ผลสำเร็จแล้ว

- วัด first verified inbound→LINE accepted แยกbuffer/queue/intake/model/ERP/compose/validation/usage/persistence/send และcold/warm/load/permissioncohorts; ไม่เริ่มนับเมื่อโมเดลเริ่มหรือหยุดนับที่responseheaders
- Single-message กับmulti-bubble burstต้องรายงานแยก พร้อมraw end-to-endรวมทั้งหมดและlast-input→answerเป็นdiagnostic ไม่เปลี่ยนtimeoriginเพื่อรับรองเร็วขึ้น Buffermax8sมีผลต่อtarget/deadlineโดยตรง ดูcorrectionในspec§20
- Prepared fast pathต้องตรวจทั้งhit-rateบนeligibleturnsและfallbackreason; fallbackเร็วแต่ตอบไม่ครบ/false-refusalไม่ใช่fastsuccess ทุกrepair/retry/failedattemptยังนับเวลาและต้นทุน
- Loadingเมื่อdurableacceptแล้วช่วยให้รู้ว่ารับงาน แต่ไม่ใช่first meaningful answer; preserveexistingbatchdelivery ไม่pushข้อความprogressซ้ำเรื่อย ๆ
- Cacheเฉพาะimmutableprompt/approvedpacks หรือauthorizedsourceที่มีrevision/TTL/invalidation; ลดirrelevantcontextก่อนส่ง ไม่ตัดnegation/acceptedconstraints/permissionเพื่อให้tokenน้อย

### 18.3 ลำดับทำและเกณฑ์ออกจากงาน

1. W00/W14reuseexistingapi_trace/stage/summary/usage/AiTurn ตรวจfieldcoverageและjoinก่อนเพิ่มเฉพาะช่องที่ขาด แล้วfreeze baseline/candidate manifestพร้อมmatched corpusก่อนปรับ; ไม่รอเสร็จทุกfeatureค่อยเก็บเวลา
2. W01/W03/W06ทำsemantic→validatedplan→execute/answerให้สั้น; W05แก้sourcequery/aggregationไปพร้อมความถูกต้อง; W11รักษาinput/round/holdbudget
3. W13ทดลองdebounceเดิมและแก้bodytimeout/queue/tail/cancel พร้อมfault tests; เปิดทีละlaneเมื่อqualityผ่าน ไม่เปิดnativeหรือเพิ่มmodelreviewsทุกturn
4. W15วัดprovider-backedและLINEบนcandidateเดียวกันตาม§8/13.3 จำนวนsample/interval/timeoutdenominatorครบ จึงรายงานลดกี่วินาที/กี่เปอร์เซ็นต์ได้ Model/infrachangeเป็นขั้นหลังเมื่อtraceชี้ว่ามีคอขวด ไม่เดาจากชื่อmodelหรือflag

สถานะ: source-reviewed/planned + read-onlyliveAgentCore/DBreadback; ไม่มีappcode/flag/model/deploy changes และไม่มีfullLINElatencybenchmarkใหม่

## 19. Dependency repair และเอกสารธุรกิจจากรอบตรวจ 2026-09-27

ฐาน [DI01–DI14](../research/mangmee-ai-dependency-impact-audit-2026-09-27-th.md) ที่ main f932 รวม source probes และ reverse callers. “ticket” ตาม owner หมายถึงรายจ่าย/ใบทดแทน/ใบเบิก ไม่ใช่ support case หรือ issue tracker; ไม่มี external ticket creation หรือ financial document creation ในงาน audit นี้

| Slice / W เดิม | ต้องแก้/เพิ่มร่วมกัน | Evidence ก่อนรับงาน |
|---|---|---|
| R1 input/evidence — W01/W03/W05/W13 | DI01–DI03/DI12: original vs normalized view, complete-turn admission, sender+receiver grounding, bounded candidates พร้อม completeness และ explicit field overflow | 3,900+5,000 burst; suffixหลัง1,000; 21st amount; raw case/newlines; vendor201/doc61/note501 ต้องไม่เปลี่ยนเงียบ; live/intake/runtime/ERP parity |
| R1 provider/budget — W01/W11/W14 | DI05/DI06/DI11: completion metadata, tool argument validity, visible blocks, actual prompt admission, workload bounds, pinned tariff settlement | Fused actual prompt ผ่าน approved bounds; incomplete toolไม่dispatch; paid usageไม่หาย; receipt page salvageคง; bank/CRM/draft regressions; API/Gateway/runtime version skew และ holdระหว่างเปลี่ยนราคา |
| R1 render/confirm — W07A/W13 | DI07/DI08: canonical full answer, structured fallback, Unicode split, action-slot reservation, bounded altText และ final wrapped validation | Live + ledger + orphan + saved receipt + notifier; 1,300/5,001 chars, five texts+confirm, 500-char confirm altText, source/negationท้ายและemoji; เปลี่ยน tests ที่เดิมยอมรับการตัดเป็น coverage assertions |
| R1 committed result/recovery — W02/W06A/W13 | DI04/DI09/DI10: queued context parity, typed source proof, outcome compatibility, notifier disposition, business vs delivery completion | Crashก่อนanswer/หลังcommit, UNKNOWNsend, revokedscope/sourcechanged, partialdelivery; documentcount/amount/number/applyเท่าเดิมเมื่อretry ไม่ rerun mutation เพื่อส่งผล |
| R1 ใบทดแทน/รายจ่าย — W03/W06A/W07A | DI13 + DI03/08/12: semantic field proposals เข้าถึง workflow, overflowตรงช่อง, expense edit→refresh substitute revision→resume | ตอบpurposeพร้อมถามแทรก; correctionไม่มีlabel; amountchange→ทำใบทดแทนต่อ; existing/prepared/signed states; staleconfirm/duplicateISSUE; correct source ID/evidence/policy |
| R1 ใบเบิก parity — W00/W03/W05/W07A | DI14: text/image/file supported routeเหมือนกันตามcapจริง, readqueueใช้domainassignment, handoffบอกยังไม่สร้าง | ImageREIMBURSEMENTไม่เสียOCRก่อนลงท้ายunsupported; fileไม่เข้ารายจ่ายโดยไม่ตรวจเจตนา; frozenassigneeเห็นเฉพาะงานที่ยังมีสิทธิ์; flags off/shadow/clarify/handoffตรง |
| R2 ใบเบิก draft writer — W06C ร่วม W01/W02/W05/W11/W13 | Grounded claim lines/attachments, business action idempotency, expected revisionจากpreview, domainwritequiesce/entitlement/scope, typed resultและowner-boundstate | Create/updateจริงผ่านsamebackend; responseหายก่อนรู้ID recoverไม่ซ้ำ; webeditหลังpreviewปฏิเสธ; lineupdateล้างsignatureตามpolicy; sourceexpense version; draftsaveไม่submit/approve/pay |
| Multi-batch gate — W01/W02/W13 ก่อนเพิ่มoutput | DI09: versioned durable batch plan/accepted checkpoints/recipient+source proof/logical-itemmapping/costlimit/oldreader | Batch1accepted+batch2UNKNOWN/restart/revoke; exact payload/key ไม่ regenerate; all-required delivery coverage; confirmไม่ถูกเบียด; business commit consumptionไม่ย้อนกลับ |

### 19.1 ข้อแก้แผนเดิมที่มีผลต่อ implementation

1. “ใช้ delivery เดิมส่งหลายชุด” ยังทำตรง ๆ ไม่ได้: เดิมหนึ่ง outcome/หนึ่ง array ต่อ event ต้องออกแบบ migration/checkpoints/replay ก่อน >5 objects ระหว่างนั้น reuse lossless path สำหรับงานที่อยู่ในหนึ่ง request พร้อม action slots ไม่ถือว่าส่งหลายชุดสำเร็จแล้ว
2. เพิ่ม tokens ต้องตามหลัง provider completeness + rendered prompt feasibility + caller-specific bounds + pricing + rendering/recovery ไม่ปรับ ceilingทั่วระบบก่อนเพื่อกลบอาการ
3. `read/answer completion` กับ `financial commit consumption` คนละสถานะ คง atomic clarification consumption ของ capture/write ที่มีอยู่ ไม่เลื่อนจน LINEส่งครบแล้วเปิดช่องสร้างซ้ำ
4. ใบทดแทนรับยอดเป็น context ไม่ได้แก้ expense และ LINE prepareไม่ใช่finalissue; ใบเบิกมีbackendไม่เท่ากับLINEwriter การแก้ capability manifest ต้องตรงรายละเอียดนี้ทุก prompt/help/router/action
5. ซ่อม code บน main ที่รวมงานค้างที่เกี่ยวข้องแล้วเท่านั้น รอบนี้ working tree มี WIP หลาย module; ต้องเทียบ diff ก่อนลงมือ ไม่ใช้ผล probe จาก pinned source อ้างว่า local WIP หรือ deploymentเดียวกันผ่าน
6. W13 แยก delivery/deadline foundation ที่ W06C ใช้ ออกจาก integration/performance acceptance หลัง W06C เพื่อไม่สร้าง dependency วนว่า writer รอ delivery แต่ delivery รอ writer ทั้งก้อน; reuse work package เดิม ไม่มี service ใหม่

### 19.2 ชุดตรวจที่ต้องเพิ่มใน harness เดิม

- Unit/contract: actual provider-admission prompt, invalid/incomplete args, per-consumer salvage, original/span/candidate parity, field limits, card+adapter validation และ Unicode
- Integration: API→Gateway→runtime→domain รวม text/image/file; PostgreSQL/Redis transaction/CAS, create idempotency, ledger reclaim, preview→webedit→confirm, outbox dispositions, accounting/source linkage และ write quiesce
- Browser/LINE: J2/J4 บน candidateเดียวกัน ดู record ID/state/จำนวนรายการคู่กับข้อความ/ปุ่มจริง; longanswer+confirmและlostreplyต้องไม่สร้างร่างใหม่; no unauthorized/finalwrite
- Performance: วัด original-request→complete accepted delivery และ accepted-document→committed result แยกกัน; reason ของ incomplete/blocked/dropอยู่ denominator เปรียบก่อน/หลังoptimizationด้วยqualityที่เพิ่มแล้วตาม§18/spec§20.1

สถานะทุก slice: **planned / ยังไม่แก้ application**. แยก defect ที่ probeยืนยัน, source-supported gap, gated new capability และ rollout risk ใน report; ไม่ติ๊กเป็น fixed จากการอัปเดต spec/plan


## 20. Implementation-ready breakdown v2.4

เริ่มลงมือจาก [implementation index](mangmee-ai-implementation-index-2026-09-27.md) ซึ่งแตก W เดิมเป็นลำดับ S0–S6 พร้อม code seams, migrations/flags, dependency DAG, CI/DI closure map และ G1–G9 verification. ไม่เพิ่มโครงการ/agent/service ใหม่; ห้ามถือ W06C/W07B/W08/W09/W12 จบเพราะแก้ R1 core แล้ว

ใช้ concrete contracts ที่ spec§22 ลิงก์: core capability, input/provider/budget, delivery และ business documents. รายละเอียดที่เคยต้องตัดสินก่อนเริ่ม ได้แก่ canonical batching/replay storage, whole-input/evidence limits, invocation holds/pinned tariff และ reimbursement DRAFT transaction ถูกกำหนดแล้ว พร้อม fixtures และ old/new rollout. ลงมือแต่ละ slice ได้ตาม dependencies โดยไม่รอ vendor/privacy activation ของ R2/R3 ที่ยังปิดอยู่

[Machine-readable implementation map](../evidence/mangmee-ai-readiness-2026-09-26/implementation-readiness-map-2026-09-27.json) ระบุทุก active C/W, 30 known CI/DI findings, owner slice, contract และ acceptance IDs. เป็น evidence ว่า planning coverage ครบ ไม่ใช่ผลทดสอบว่าแก้แล้ว ไม่มีการนับจำนวนข้อความ/ข้อย่อยแทน 150 scenarios หรือรับรองไม่มี unknown bugs

ก่อนส่ง PR ต้องเก็บ source baseline + accepted WIP integration hash; existing merged PR819 confirm/vendor side effects ให้ reuse ไม่ทำใหม่ Test paths ที่ appendix ระบุ NEW ต้องสร้างใน implementation; commands ที่ต้องใช้ isolated DB/provider/channel ต้องบันทึก run หรือ exact blocked prerequisite ไม่รายงาน skipped เป็น passed. การ deploy ยังใช้ mandatory runbook และไม่อยู่ในคำขอจัดเอกสารนี้
