# LINE AI Mangmee Advisor and Natural Conversation Implementation Plan

## 1. สถานะ

- สถานะ: **PROPOSED v2; docs only, implementation ยังไม่เริ่ม**
- วันที่: 2026-08-21; แก้ไข 2026-08-22 ตาม owner decisions 1–5 และรีวิว (spec §1.1)
- Linked spec: `docs/specs/line-ai-mangmee-advisor-conversation-spec.md`
- Default behavior: ไม่เปลี่ยนจนกว่า `LINE_AI_ADVISOR_MODE` ถูกเปิดผ่าน rollout gate
- Dependency: latency/autonomy lanes และ UAT correctness activation blockers ที่เกี่ยวข้องกับ terminal delivery
  ต้องปิดก่อน production activation; blockers #1 (durable terminal replay) และ #3 (Flex -> text fallback) ต้องปิด
  ก่อน `knowledge` UAT (Slice B) ไม่ใช่แค่ก่อน production
- Task memory: `docs/agent-memory/line-ai-mangmee-advisor-conversation.md`

## 2. Implementation decision

ใช้ diff เล็กที่สุดบน architecture เดิม:

- ไม่เพิ่ม autonomous agent
- เพิ่ม advisor response mode และ optional `advisorAnswer` field บน `LineIntakeRoutePlan` (sibling ของ
  `clarifyQuestion`, gate ด้วย `capabilities.advisor`) ไม่ซ้อนใน `LineAiPreparedPlan`
- release แรกใช้ model เดียวที่ config (decision 2); ไม่มี fast tier/small router
- reuse intent router, response composer, provider, prompt caching, tool registry, API authority และ LINE renderer
- knowledge เป็น curated versioned cards compile ลง `@watchdog-bms/contracts` ใช้ร่วมกันทั้ง gateway (retrieve/prompt)
  และ API (validate/render); retriever port provider-neutral แต่ release แรกมีเฉพาะ lexical adapter
- LOW/MEDIUM card: model prose + validator; HIGH card: deterministic renderer (decision 1)
- company context เป็น read-only aggregate ที่ API ประกอบใน process แล้ว embed ใน `LineIntakeRouteRequest`; ไม่มี
  cache และไม่ลงทะเบียน tool ใน release แรก; อ่านด้วย permission ใหม่ `company.advisory.read` (decision 3)
- finance/trend (Phase 6) defer ออกจาก release แรกเป็น spec/plan แยก
- live business query และ action ใช้ flow/guard เดิม
- dependency ใหม่ไม่มีใน baseline; retrieval adapter เพิ่มได้เมื่อ benchmark พิสูจน์ว่าจำเป็น
- ไม่แก้ `package.json` เว้นแต่ phase ที่อนุมัติ dependency โดยตรง

## 3. Phase map

```text
Slice A  "คุยเล่นเร็ว" (3 model calls -> 1/0)
  Phase 0  Baseline + eval freeze (+ เปิด/วัด exact-greeting 0-call lane ใน UAT)
  -> Phase 1  Contracts + flag + zero-behavior scaffolding
  -> Phase 4  Natural advisor response mode (social scope)
  -> Phase 5  One-call fast lane + validators (social scope)
Slice B  "ถามภาษี/เอกสารได้พร้อมแหล่ง"
  -> Phase 2  Curated knowledge foundation (compiled registry, lexical retrieval, generic card renderer)
  -> Phase 4/5 ขยาย knowledge (LOW/MEDIUM prose + validator, HIGH deterministic render)
Slice C  "ถาม 'บริษัทเรา…' ได้"
  -> Phase 3  Bounded company advisory profile + permission `company.advisory.read`
  -> Phase 4/5 ขยาย company (1:1 เท่านั้น)
ทุก slice
  -> Phase 8  Observability + feedback + eval (สะสมต่อ slice)
  -> Phase 9  Measurement cohort, UAT, canary, activation (ต่อ slice)
Deferred ออกจาก release แรก
  Phase 6 finance/trend (spec/plan แยก), Phase 7 preferences, fast tier/small router,
  semantic/managed retrieval, source-change detection job
```

แต่ละ slice ส่งมอบสิ่งที่ผู้ใช้เห็นได้เองและ activate แยกกันผ่าน `LINE_AI_ADVISOR_MODE`; Phase 2 และ 3 ทำคู่ขนานได้
หลัง Phase 1 แต่ activation ของ `company` ต้องผ่านทั้งสองเฟส

สถานะ 2026-08-22: Slice A ไม่ต้องรอข้อมูลจาก business; Slice B สร้าง scaffolding ได้แต่การ approve card รอรายชื่อ
reviewer ภาษี/บัญชี; Slice C พักรอข้อมูลจาก business (permission/grant sync, นโยบายกลุ่ม)

## 4. Phase 0 — Baseline and eval freeze

### งาน

- [ ] freeze configured-provider traces ของ social, unsupported knowledge, company question, live query และ mixed turn
- [ ] บันทึก p50/p95 แยก `buffer`, routing, retrieval/current no-op, model, tool, compose, persist, delivery
- [ ] บันทึก model calls, input/output tokens, prompt cache, cost และ fallback rate ต่อ journey
- [ ] สร้าง corpus manifest 550+ rows ตาม spec §16 โดยไม่ผูก expected answer กับ wording เดียว
- [ ] เพิ่ม canonical UAT rows และ paraphrase/noisy/Thai typo variants
- [ ] ทำ ground-truth review set สำหรับ Thai tax/accounting อย่างน้อย 120 rows
- [ ] inventory official sources, effective windows, reviewer และ owner ของ knowledge topics รุ่นแรก
- [ ] เปิด `LINE_AI_EXACT_GREETING_ENABLED` ใน UAT cohort ตาม flag/protocol ของ latency spec แล้ววัดสัดส่วน standalone
  greeting/thanks/ack ของ social traffic และ p50/p95 ของ 0-call lane
- [ ] วัด output tokens ของ route envelope ปัจจุบันและ envelope advisor (ภาษาไทย) ด้วย token counting ของ provider
  เพื่อ derive SLO/token budget ต่อ lane แทน placeholder ใน spec §13.3
- [ ] ตรวจ existing source tools ว่า metric/trend ใดคำนวณได้จริง (inventory สำหรับ Phase 6 ที่ defer เท่านั้น)
- [ ] ยืนยัน current branch/config/source SHA ของ baseline

### Artifacts

- `scripts/line-ai-mangmee-advisor.corpus.ts` หรือ corpus เดิมที่ extend ได้โดยไม่สร้าง runner ซ้ำ
- `docs/evidence/line-ai-mangmee-advisor-baseline-<date>.md`
- source inventory และ reviewer matrix ใน spec annex หรือ evidence doc

### Verification

- corpus integrity: unique ids, bucket minimum, bounded enums, allowedTools, mutation expectation, citations
- baseline replay ใช้ provider/config เดียวกับ target environment
- sample human adjudication อย่างน้อย 10% และทุก HIGH-risk row

### Exit

- มี baseline ที่เปรียบเทียบ latency/quality/cost ได้และไม่มี bucket ว่าง
- owner ระบุ topics รุ่นแรกและ provisional reviewer owner แล้ว; named domain reviewer บล็อกการ approve/publish
  card ใน Phase 2 แต่ไม่บล็อก Phase 0/1 scaffolding

## 5. Phase 1 — Contracts, flags and no-behavior scaffolding

### งาน

- [ ] เพิ่ม outer intent `ADVISOR_CONVERSATION`, `MangmeeConversationMode`, `PreparedAdvisorAnswer` และ field
  `advisorAnswer`/`advisorContext` บน `LineIntakeRoutePlan` (sibling ของ `clarifyQuestion`) พร้อม bounded parser และ
  constants; ห้ามซ้อนใน `LineAiPreparedPlan`
- [ ] ให้ `routeIntake()` call เดิมสร้าง outer intent + `advisorAnswer` ภายใต้ `capabilities.advisor` (ปิด = byte-exact
  legacy prompt/payload); social envelope ไม่ emit `preparedPlan`
- [ ] API dispatcher branch สำหรับ `ADVISOR_CONVERSATION`: direct-answer off หรือ validator ไม่ผ่าน -> gateway turn เดิม
  ด้วย `intakeIntent='ADVISOR_CONVERSATION'`; gateway `line-ai-turn` และ AgentCore runtime validate membership แล้ว
  treat เหมือน `UNSUPPORTED`
- [ ] เพิ่ม `tonePreface` enum และจุด prepend หนึ่งบรรทัดใน composer เดิมสำหรับ `LIVE_QUERY`
- [ ] เพิ่ม precedence matrix: security/safety/command/attachment/open continuation/capture/reimbursement/
  substitute/mutation/live query/multi-intent ชนะ advisor และ mismatch discard ก่อน tool
- [ ] เพิ่ม versioned `ADVISOR_DIRECT_ANSWER_MIN_CONFIDENCE=0.80` แบบ veto-only; ห้ามทำ ineligible ให้ eligible
- [ ] เพิ่ม `LINE_AI_ADVISOR_MODE=off|social|knowledge|company` กับ `LINE_AI_ADVISOR_DIRECT_ANSWER_ENABLED=false`,
  parse fail-closed; ไม่มีค่า `shadow` (measurement cohort = mode >= social + direct-answer off)
- [ ] forward mode/config ผ่าน API -> Gateway โดยรับจาก server config เท่านั้น
- [ ] เพิ่ม response-mode decision point ใน orchestration เดิมโดยยัง fallback เดิมทุกกรณี
- [ ] เพิ่ม exact membership validators สำหรับ card ids, company fields, numbers/dates และ output length โดยขยาย
  number guard เดิมของ composer (`groundedNumbers`) ให้ครอบคลุมวันที่ ไม่เขียนใหม่
- [ ] เพิ่ม refusal/fallback reason enums; ห้าม log free-form raw message
- [ ] ทำ `off` byte-compatible regression และพิสูจน์ zero extra model/retrieval calls

### จุดหลักที่คาดว่าจะกระทบ

- `packages/contracts/src/line-ai.ts`
- `packages/config/src/index.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` (dispatcher branch + direct
  delivery ตาม pattern exact-greeting lane)
- `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts` (`capabilities.advisor` section)
- `apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.ts` และ
  `apps/ai-gateway/src/agentcore/runtime.ts` (intent membership receivers)
- focused contract/config specs

### Verification

- old/new artifact compatibility เมื่อ optional field absent
- invalid version/enum/confidence/card id/company field -> fallback
- outer intake/advisor mode mismatch, attachment/open state, group/room และ `needsTools` conflict -> discard advisor
  ก่อน tool
- eval rows เดิมที่ pin outer `UNSUPPORTED` สำหรับ casual ยังผ่านเมื่อ `capabilities.advisor=false` และมี expectation
  ใหม่เมื่อ true
- older artifact drop/reject optional advisor field สู่ fallback โดยไม่ HTTP 400
- user-supplied mode/config/company id ถูก ignore
- `off` ไม่มี latency/cost side effect

### Exit

- scaffolding merge-safe default-off และไม่มี user-visible behavior

## 6. Phase 2 — Curated Thai Business Knowledge foundation

### 6.1 Card authoring and approval

- [ ] สร้าง schema/validator ของ `ThaiBusinessKnowledgeCard`
- [ ] ทำ card compiler ที่ reject duplicate id/version, invalid date window, missing reviewer/source และ unbounded numbers
- [ ] production selector (decision 5): HIGH ที่เลย `nextReviewAt` fail-closed ทันที; LOW/MEDIUM ใช้ได้พร้อม dated
  caveat ไม่เกิน 1 รอบ SLA แล้ว fail-closed; `effectiveTo`/`revokedAt` ทันทีทุก tier; reviewer alert 14 วันก่อนกำหนด
- [ ] `allowedNumericFacts` ที่มี record ใน tax module อ้าง `sourceRecordRef` (`TaxRateConfig`/`TaxCalendarRule`) และ
  compile ค่าอัตโนมัติ; compiler reject ตัวเลขที่พิมพ์ซ้ำโดยไม่มี ref เมื่อ record มีอยู่
- [ ] enforce freshness SLA LOW<=365/MEDIUM<=180/HIGH<=90 วัน, historical effective-date selection,
  emergency revoke และ `latest` freshness gate
- [ ] สร้าง initial approved cards สำหรับ:
  - ใบเสร็จ ใบกำกับภาษี ใบกำกับภาษีอย่างย่อ เอกสารทดแทน
  - VAT registration/document requirements และ e-Tax/e-Receipt
  - WHT concepts/forms/common boundaries
  - bookkeeping/document retention
  - SME cash-flow, margin, receivable, payable และ internal-control basics
- [ ] source ทุก card จาก RD/TFAC/DBD หรือ reviewed internal policy
- [ ] เพิ่ม `KnowledgeCitationRef`, HTTPS publisher allowlist และ trusted external-link renderer
- [ ] (deferred ออกจาก release แรก) source-hash/change-check job/operator script ที่สร้าง review queue; ห้าม
  auto-approve และต้องมี outbound hostname allowlist, redirect/DNS/private-IP guard, timeout และ response-size
  limit — ก่อนหน้านั้นใช้ review calendar + `nextReviewAt` alert

### 6.2 Retrieval adapter benchmark

- [ ] สร้าง `BusinessKnowledgeRetrieverPort` แบบ provider-neutral
- [ ] compiled immutable card registry ใน `@watchdog-bms/contracts` + alias/lexical/metadata retrieval เป็น adapter
  เดียวของ release แรก; budget <= 150 ms p95 บน critical path + timeout แล้วไปต่อโดยไม่มี cards
- [ ] benchmark semantic/hybrid adapter (Bedrock KB, existing Postgres หรืออื่น) เฉพาะเมื่อ lexical Recall@5 < 0.95 บน
  Thai paraphrase set; ไม่เพิ่ม infrastructure ก่อนมีหลักฐาน
- [ ] จำกัด top-K 3–5, context bytes และ allowed card ids ต่อ turn
- [ ] low score margin = veto direct answer -> clarification เสนอ title 2 ใบ; ไม่มี rerank model call
- [ ] generic card renderer ตัวเดียวฝั่ง API presentation: LOW/MEDIUM = header (card title) + validated prose +
  conditions + source button; HIGH = deterministic body จาก reviewed fields

### จุดหลักที่คาดว่าจะกระทบ

- AI Gateway LINE knowledge port/adapter ใหม่ภายใน module เดิม (retrieval/prompt เท่านั้น)
- versioned card resource ใน `packages/contracts/src/line-ai-knowledge/` (compile-time registry ที่ API ใช้ render/validate)
- operator/source-check script
- card schema, compiler, retrieval และ prompt-injection specs

### Verification

- retrieval Recall@5 >= 0.95 ใน reviewed paraphrase set
- draft/retired/revoked/`effectiveTo` card ไม่ออก production result; HIGH overdue ไม่ออก; LOW/MEDIUM overdue ออก
  พร้อม caveat ภายในผ่อนผันเท่านั้น
- LOW/MEDIUM prose: ตัวเลข/วันที่ทุกค่าอยู่ใน `allowedNumericFacts` ของ card ที่อ้าง 100%; citation ⊆ offered cards
- overdue `nextReviewAt`, revoked card, invalid external URL/redirect/private IP fail-closed
- source injection text ไม่เปลี่ยน system behavior
- HIGH-risk answer ไม่มี card/source -> honest unavailable, ไม่ใช้ model memory
- retrieval p95/cost ผ่าน knowledge SLO budget

### Exit

- card set รุ่นแรก approved และ retrieval evidence ผ่าน โดยยังไม่มี production answer change

## 7. Phase 3 — Bounded company advisory profile

### งาน

- [ ] เพิ่ม permission `company.advisory.read` (LOW risk) ใน permission registry + role grants ของทุก role ที่ถือ
  `line.ai.query` + capability pack; ตรวจวิธี sync grant ให้บริษัทเดิม (decision 3)
- [ ] เพิ่ม source-owned use case ที่ประกอบ `CompanyAdvisoryProfile` จาก `CompanyTaxProfile` (vat/effective/accounting
  period), `Company.businessCategory`, membership scopes และ entitlements
- [ ] reuse company identity/VAT registration/business policy/entitlement sources ที่ authoritative
- [ ] exclude raw taxId, address, bank, personal contact และ unsupported inferred industry
- [ ] ส่ง `UNKNOWN` + `missingFacts` เมื่อ source ไม่ครบ
- [ ] embed profile เป็น server-derived `companyAdvisoryProfile` ใน `LineIntakeRouteRequest` (1:1 + explicit company
  hint เท่านั้น); ไม่ลงทะเบียน tool ใน release แรก
- [ ] recheck linked membership, permission, entitlement และ branch scope ที่ API
- [ ] ไม่มี cache ใน release แรก (อ่านหนึ่งครั้งต่อ turn); context ผูก `(companyId,userId,chatKey)`; no
  cross-tenant/cross-chat
- [ ] เพิ่ม sourceRefs/asOf ทุก field group
- [ ] bound arrays <=10, strings <=200 code points, sourceRefs <=10; accessible count ไม่เผย hidden scope;
  `entityType`/policy summaries ไม่อยู่ใน release แรก
- [ ] group/room: ไม่ prefetch profile และ veto `COMPANY_INSIGHT` direct answer (ไปตาม flow เดิม); ไม่แตะ `LIVE_QUERY`
  ในกลุ่ม (decision 4)

### จุดหลักที่คาดว่าจะกระทบ

- `packages/contracts/src/line-ai.ts` (`CompanyAdvisoryProfile` + `LineIntakeRouteRequest.companyAdvisoryProfile`)
- data-model-core/company tax profile application use case
- `apps/api/src/modules/auth/permission-registry.ts` + capability pack registry (permission ใหม่)
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` (embed ใน route request)
- AI Gateway intake prompt DATA section

### Verification

- permission/entitlement/branch denied, inactive membership, removed user และ cross-company tests
- current company context ไม่มี regression; advisor profile ไม่คืน taxId
- group/room ใช้ company profile เป็นศูนย์และไม่เปิดเผย company advisory fields
- VAT mirror bit โดยไม่มี effective source ไม่ถูกกล่าวว่า confirmed
- concurrent tenant isolation (ไม่มี cache)
- role ที่ถือ `line.ai.query` แต่ไม่มี `company.setup.read` (STAFF/HR/SALES/INVENTORY/MARKETING/AUDITOR) อ่าน profile
  ได้ผ่าน `company.advisory.read`; role ที่ถูกถอดสิทธิ์ได้ safe access response
- 1:1 context ไม่ carry ไป group/room
- profile `forbidden` ใช้ safe access response โดยไม่เผย field/feature; `unavailable` เท่านั้นที่ลดชั้นเป็น
  general guidance พร้อม label ว่าไม่ได้อิงบริษัท

### Exit

- profile เป็น permission-checked read-only aggregate และ security review ผ่าน

## 8. Phase 4 — Natural advisor response mode

### งาน

- [ ] ปรับ router definitions ให้รู้จัก social, general business advice, company advice, live query และ action boundaries
- [ ] เพิ่ม mixed-turn rule: business/safety ชนะ greeting/social
- [ ] existing crisis/privacy/high-risk veto ทำก่อน knowledge/profile prefetch; semantic safety ชนะทุก mode
- [ ] ขยาย persona prompt สำหรับ food, preference, feelings และ coworker-style empathy
- [ ] เพิ่ม knowledge/company answer prompt ที่ตอบ answer-first, cite source/effective date และถามไม่เกินหนึ่งคำถาม
  (LOW/MEDIUM prose จาก card text; HIGH เลือก card เท่านั้น)
- [ ] `tonePreface` สำหรับ emotion+business: composer เดิม prepend หนึ่งบรรทัด
- [ ] group/room: persona/advisor ใช้เฉพาะ `SOCIAL_CHAT`/`BUSINESS_ADVISOR`
- [ ] ใช้ recent conversation context เฉพาะ pronoun/follow-up/tone
- [ ] เพิ่ม fake-human, dependency, privacy-rumor, medical/legal/financial authority boundaries
- [ ] คง crisis response และ final mutation refusal เดิม
- [ ] ทำ deterministic exact standalone greeting/thanks ผ่าน latency flag เดิม ไม่ขยาย keyword ให้กิน mixed request

### จุดหลักที่คาดว่าจะกระทบ

- `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts`
- LINE intake/orchestrator specs
- trusted LINE text/Flex renderer เฉพาะ presentation contract

### Verification

- `สวัสดี เบิกค่าโดยสารหน่อย` ไม่เป็น greeting
- emotion + business เข้าห้องธุรกิจและตอบรับอารมณ์สั้น
- social ไม่มี tool/company context leakage
- general knowledge ไม่อ้างว่าเป็น company fact
- company answer แสดง `asOf`; source absent ห้าม claim
- crisis/privacy/final mutation protected sets ผ่าน 100%
- distress vs crisis, mixed crisis+company, medical/legal authority, dependency/exclusivity, group/cross-chat
  protected sets ผ่านและ safe response ไม่อ้าง business data

### Exit

- offline mode accuracy/persona/guard ผ่าน โดย feature ยัง default-off

## 9. Phase 5 — One-call advisor fast lane

### งาน

- [ ] search knowledge candidates หลัง trusted identity gates (budget <= 150 ms p95 + timeout); profile prefetch
  ทำคู่ขนานเฉพาะ trusted explicit company-reference hint/follow-up และเฉพาะ 1:1
- [ ] API direct delivery path ตาม pattern exact-greeting lane: validate -> render Flex/text -> `persistIntakeTurn` ->
  deliver -> event log; ไม่เรียก gateway turn
- [ ] extend structured `routeIntake()` provider call เดิมให้ classify + prepared answer ใน eligible zero-tool turn;
  ห้ามสร้าง model/router call ใหม่
- [ ] knowledge search ใช้ข้อความดิบได้โดยไม่ให้ retrieval score เป็น routing authority
- [ ] ให้ server derive direct-answer eligibility; model confidence เป็น veto-only และต้อง >=0.80
- [ ] ใช้ static cacheable prefix และวาง dynamic cards/profile/history ท้าย prompt
- [ ] จำกัด output tokens ตาม lane
- [ ] direct answer เฉพาะ `SOCIAL_CHAT`, `BUSINESS_ADVISOR`, `COMPANY_INSIGHT`
- [ ] `answerText` ใช้กับ social และ LOW/MEDIUM business/company (validated prose, header = card title); HIGH และ
  finance/trend ใช้ deterministic `responseFamilyId` renderer จาก reviewed cards/profile โดยไม่ใช้ runtime LLM critic
  (decision 1)
- [ ] response-family registry เฉพาะ HIGH/finance: allowed card topics/profile fields/output shape แบบ exact; unknown
  family, missing required field, wrong mode/risk, non-exact input subset หรือ family/card mismatch -> fallback;
  LOW/MEDIUM ใช้ generic card renderer ตัวเดียว
- [ ] discard answer draft เสมอสำหรับ live query/action/safety/invalid/multi-intent
- [ ] `COMPANY_INSIGHT` ที่ profile ไม่ถูก prefetch ต้อง veto direct answer และใช้ guarded fallback ห้ามโหลด
  profile ในทุก social turn เพื่อแต่ง one-call metric
- [ ] fallback ไป existing full intelligence path ก่อน tool call เมื่อ validator ไม่ผ่าน
- [ ] ไม่เพิ่ม speculative parallel model call ในเฟสนี้
- [ ] strict/structured output (native tool-use schema) สำหรับ envelope เป็น option ที่ benchmark เทียบ JSON text เพื่อลด
  invalid-output fallback

### Verification

- method-call counters: eligible social/knowledge/company ใช้ generative call เดียว
- direct path เรียก ERP transaction tools และ evidence capture เป็นศูนย์
- card id/company field/numeric/date grounding membership 100%
- HIGH body มาจาก deterministic renderer 100%; LOW/MEDIUM prose ผ่าน citation/grounding validator 100%; model raw
  URL/Flex เป็นศูนย์
- completed business/advice/company/trend/refusal ใช้ trusted Flex; missing/invalid presentation ใช้ generic
  trusted Flex ส่วน text ใช้เฉพาะ social/clarification หรือ logged transport-recovery policy
- invalid JSON, timeout, low confidence, stale card/profile และ provider outage fallback ปลอดภัย
- prompt cache hit/write telemetry และ token budget
- blind quality non-inferiority เทียบ full path

### Exit

- eligible turn เฉลี่ย <=1.1 generative calls และ per-lane cost รวม fallback/wasted call ลด >=30% เทียบ
  quality-equivalent reference path โดย quality และ SLO (derive จาก Phase 0) ผ่าน configured-provider replay
- UAT correctness blockers #1/#3 ปิดก่อน `knowledge` UAT

## 10. Phase 6 — Deterministic finance and trend insights (DEFERRED ออกจาก release แรก)

ย้ายไปเป็น spec/plan แยกหลัง Slice C; งานด้านล่างคงไว้เป็น design intent ก่อนหน้านั้น trend question เข้า `LIVE_QUERY`
flow เดิม และ v1 ตอบ "เท่าไร/ขึ้นหรือลง" ไม่ใช่ "เพราะอะไร"

### งาน

- [ ] map คำถาม trend กับ existing ledger/expense/sales/receivable/payable tools ที่มี source definition จริง
- [ ] เพิ่ม pure functions สำหรับ period comparison, ratio, aging, burn/runway และ completeness
- [ ] version calculation method และ guard division-by-zero, missing periods, currency mismatch, partial/stale sources
- [ ] forecast ทำเฉพาะ metric ที่มี minimum sample/seasonality rule และคืน interval/assumptions
- [ ] model เลือก explanation/advice response family ได้ แต่ deterministic renderer ต้องสร้าง metric,
  comparison, limitations และ reviewed playbook จาก `FinanceInsightEvidence`
- [ ] ถ้า existing source tool ไม่พอ ให้เพิ่ม source-owned read/report tool เฉพาะ metric ห้าม generic SQL
- [ ] high-risk recommendation แสดง scenario/options และ human review ไม่ใช้ imperative certainty

### Verification

- golden arithmetic/property tests ทุก formula และ edge case
- multi-currency ห้ามรวมโดยไม่มี authoritative conversion source
- partial/stale/incomplete data ไม่ออก confident conclusion
- numeric grounding 100% และ sourceRefs/asOf/range/methodVersion ครบ
- `เดือนหน้าจะขาดเงินไหม` ไม่มี forecast เมื่อ sample/source ไม่พอ

### Exit

- finance/trend answers มี deterministic evidence ครบและ domain reviewer ลงนาม

## 11. Phase 7 — Optional durable preferences

ไม่เป็น activation blocker ของ social/knowledge/company รุ่นแรก — decision 2026-08-22: คง short-term 15 นาที; phase นี้
ปิดตาม YAGNI จนกว่ามีหลักฐานว่าจำเป็น

### งาน

- [ ] owner decision ว่าต้องมี durable preference จริงหรือไม่
- [ ] ถ้า GO: allowlist เฉพาะ preferred name, language และ answer brevity
- [ ] explicit opt-in/confirm, view/delete และ audit
- [ ] ห้าม inferred emotion/health/relationship/sensitive preferences
- [ ] ห้าม preference เป็น business/permission truth

### Exit

- ถ้าไม่มีหลักฐานว่าจำเป็น ให้คง short-term 15 นาทีและปิด phase นี้ตาม YAGNI

## 12. Phase 8 — Observability, feedback and release eval

### งาน

- [ ] เพิ่ม stage timings, mode/fallback enums, card ids/version, grounding metrics และ cost per lane
- [ ] dashboard p50/p95 แยก cohort/model/mode/fallback
- [ ] optional Quick Reply `ตรงคำถาม` / `ไม่ตรง` พร้อม rate limiting และ privacy-safe event
- [ ] configured-provider runner ครบ 550+ rows
- [ ] deterministic graders สำหรับ schema/guard/citation/number/company grounding
- [ ] blind human review naturalness และ accountant/tax review
- [ ] rating tooling (sheet/script) สำหรับ blind pairwise >=3 raters/row เฉพาะ persona bucket + accountant review ทุก HIGH
  row + sample >=30% knowledge/company; bucket อื่นใช้ deterministic graders; ระบุผู้ให้คะแนนและเวลาในการเก็บ
- [ ] red-team prompt injection, source injection, cross-tenant, permission downgrade และ stale cache
- [ ] บันทึก evidence artifact พร้อม source SHA/config/model ids
- [ ] blind pairwise ใช้ >=3 raters/row, >=30 independent pairs ต่อ language/response-family stratum และ
  one-sided 95% confidence bounds ตาม spec
- [ ] cost/calls ต่อ lane รวม fallback และ wasted advisor call; knowledge เทียบ full-intelligence reference
  path เพราะ baseline เดิมตอบ unsupported ห้ามอ้าง saving จากคำตอบที่คุณภาพเทียบกันไม่ได้

### Verification gate

- mode macro F1 >=0.95; critical recall 1.00
- released mode precision/recall >=0.90 แยก Thai/English; `ADVISOR_CONVERSATION` direct precision >=0.98
- wrong tenant/tool/mutation = 0
- citation precision >=0.98; coverage >=0.95
- HIGH-risk citation/factual deterministic-render pass =1.00
- company/numeric grounding = 1.00
- human persona win-or-tie >=0.90
- overall quality within -1pp และ business helpfulness +5 points
- pairwise one-sided 95% lower bound >=0.50 ทุก protected stratum; critical error observed 0 และ upper bound <=1%
- protected journey latency/cost ไม่ถอยเกิน 10% และ margin เดิมของ latency/autonomy spec ยังผ่าน
- latency/cost/call budget ตาม spec

### Exit

- release packet พร้อม owner review; ยังไม่เปิด environment อัตโนมัติ

## 13. Phase 9 — Shadow, UAT and activation

### 13.1 Measurement cohort (แทน shadow เดิม)

- [ ] measurement cohort = `LINE_AI_ADVISOR_MODE=social` + `LINE_AI_ADVISOR_DIRECT_ANSWER_ENABLED=false` ใน UAT/canary:
  router emit + validate + log `advisorAnswer` แต่ reply มาจาก reference path; บันทึก overhead ของ prompt/output ที่
  เปลี่ยน; protected corpus ใช้ offline configured-provider replay; ไม่มี runtime `shadow` mode
- [ ] เก็บ route/retrieval/validator agreement อย่างน้อย 7 วันและ 500 eligible turns พร้อมรายงาน denominator
  ขั้นต่ำ bucket ละ 100 สำหรับ social, tax/HIGH-risk, company, mixed/action/safety และ group/cross-chat;
  live denominator ที่ไม่ครบคือ activation blocker; targeted internal UAT รายงานแยกและห้ามนับแทน live measurement cohort
- [ ] adjudicate disagreement ทุก critical case และ sample ปกติ
- [ ] protected configured replay มี critical negatives รวม >=300 และแต่ละ critical family >=60;
  wrong tenant/mutation = 0, critical false positive = 0 และ aggregate one-sided 95% upper bound <=1%; แต่ละ
  family ต้อง observed 0 และรายงาน interval ตาม denominator โดยห้ามอ้าง UCB<=1% จาก 60 rows
- [ ] ตรวจ cohort overhead/cost (prompt ใหญ่ขึ้น/output เพิ่ม) เทียบ control; ห้ามเพิ่ม model call

### 13.2 Knowledge canary

- [ ] เปิด `social` internal UAT ก่อน แล้วเพิ่ม `knowledge` เป็น cohort แยก
- [ ] device test native loading + final reply + retry/fallback
- [ ] canary บริษัท/ผู้ใช้กลุ่มเล็กพร้อม kill switch
- [ ] monitor 24h/7d quality, p95, provider error, fallback, feedback และ cost

### 13.3 Company canary

- [ ] เปิด `company` หลัง profile security/grounding ผ่าน
- [ ] test permission/entitlement changes ระหว่าง session รวมการถอด `company.advisory.read` (ไม่มี cache)
- [ ] monitor company claim grounding และ data freshness แยกจาก knowledge lane
- [ ] เปิด direct-answer kill switch เป็น cohort แยกหลัง semantic/renderer reference path ผ่านแล้ว

### Activation

- [ ] Product, Security และ Accounting/Tax owner ลงนาม
- [ ] runbook/config evidence ระบุ exact run ids ตาม deployment protocol ก่อน UAT/Production deploy
- [ ] widen ทีละ cohort; rollback เป็น `off` ได้ทันที

## 14. File-impact map

| Area | ผลกระทบที่คาด | ความเสี่ยงหลัก |
| --- | --- | --- |
| shared contracts | mode, `advisorAnswer`/`advisorContext`, compiled card registry, profile types | artifact compatibility, registry size |
| config | staged advisor enum + direct-answer kill switch, default-off | invalid env/fail-open |
| intent/router prompts | semantic scope กว้างขึ้น | แย่ง intent เดิม/mixed turn |
| response composer/renderers | natural social + deterministic cited business advice | hallucination/fake human |
| knowledge adapter/resources | curated facts/retrieval | stale law/source injection |
| company source module | bounded profile read | PII/tenant/permission leakage |
| permission registry | `company.advisory.read` + role grants/pack | over-grant / stale grant sync |
| analytics (deferred) | deterministic finance calculations | wrong formula/source basis |
| LINE presentation | source/asOf/feedback/loading | duplicate/failed delivery |
| telemetry/eval | mode/citation/cost/latency | raw text/PII logging |

## 15. Rollback

- ปิด `LINE_AI_ADVISOR_DIRECT_ANSWER_ENABLED` หรือถอย `LINE_AI_ADVISOR_MODE` ทีละ stage จนถึง `off`;
  behavior กลับเดิมโดยไม่ rollback database
- knowledge/profile/analytics เป็น additive read-only; ห้าม migration ที่ทำลายข้อมูลเดิม
- source card ที่ผิดใช้ emergency revoke/`RETIRED`/effective window ปิดและ invalidate cache
- model/provider regression กลับ policy เดิมหรือ full path โดยไม่ลด guard
- permission anomaly ปิด `company` เหลือ `knowledge` หรือ `off` และถอด `company.advisory.read` จาก role ที่กระทบได้ทันที
  โดยไม่ deploy
- delivery/replay anomaly ปิด direct-answer path และใช้ terminal path เดิม

## 16. Definition of done

- [ ] spec/plan/owner decisions/evidence สอดคล้องกัน
- [ ] smallest correct diff และไม่มี agent/router/permission/tool registry ซ้ำ
- [ ] default-off compatibility และ rollback พิสูจน์แล้ว
- [ ] official knowledge scope/review/freshness พร้อม
- [ ] company profile ผ่าน security/permission/tenant tests
- [ ] numeric/date grounding ของ LOW/MEDIUM prose และ HIGH render ผ่าน 100% (finance arithmetic เป็นของ Phase 6 แยก)
- [ ] 550+ eval, configured-provider replay, human/domain review ผ่าน release thresholds
- [ ] latency/cost/call targets ผ่านด้วย quality เท่าเดิมหรือดีขึ้น
- [ ] UAT device journey, loading, Flex/text fallback และ durable replay ผ่าน
- [ ] no unauthorized query/final mutation และ no cross-tenant leak
- [ ] task memory/checklist/runbook/evidence อัปเดตเมื่อเริ่ม implementation และ deploy

## 17. Deferred follow-ups

- runtime external current market/news trends with allowlisted sources
- durable preference memory
- fast model tier / small router for social (decision 2)
- finance/trend deterministic insights (Phase 6) เป็น spec/plan แยก
- นโยบายคำตอบข้อมูลบริษัทใน group/room ของ `LIVE_QUERY` เดิม — decision/flag แยก (decision 4)
- source-change detection job และ semantic/managed retrieval adapter (เมื่อ lexical Recall@5 < 0.95)
- fine-tuning/distillation for persona/routing after sufficient reviewed production data
- new autonomous agent เฉพาะเมื่อ eval แสดงงาน multi-step ที่ one-call + tools เดิมแก้ไม่ได้
- managed knowledge infrastructure เมื่อ corpus/operations โตเกิน compiled/provider-neutral adapter รุ่นแรก
