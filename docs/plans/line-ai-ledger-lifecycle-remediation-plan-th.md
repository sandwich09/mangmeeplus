# Plan: LINE AI — NOGROUP, budget errors, intake cost และเพดานแชต/OCR

สถานะ: ขยาย spec/plan ครบตาม owner แล้ว; implementation, runtime tests และ deployment ยังไม่เริ่ม
วันที่: 2026-09-17
Spec: [ข้อกำหนดรวม A–E](../specs/line-ai-ledger-lifecycle-remediation-spec-th.md)
Memory: [Incident และสถานะงานรวม](../agent-memory/uat-line-chat-nogroup-2026-09-17.md), [ต้นทุนและ receipt flow](../agent-memory/line-intake-cost-and-budget-receipt-behavior-2026-09-17.md)
Review: [impact/bug-gap รอบ 2 — 12 findings](../research/line-ai-remediation-impact-review-2026-09-17-th.md)

Owner เลือกแยกเพดาน CHAT/OCR ภายในเพดานรวม แต่ละส่วนยืมกันไม่ได้ ไม่ใช่กันงบ OCR ที่สามารถใช้ shared remainder ได้ ตัวเลข caps และการเปิดให้บริษัทจริงเป็น admin action ภายหลัง; งานนี้เตรียมเอกสารเท่านั้น

## 1. Product และหลักฐานที่มีแล้ว

- [x] ยืนยัน UAT webhook → NOGROUP → marker_unavailable ก่อน AI และความต่าง source กับ Production
- [x] พบ Production menu/promotion 20:28 KST และ text budget refusals 20:29: ใช้ 80.62 บาทจาก total override 80 บาท
- [x] T1 read-only usage ตรงภาพ: 92 calls/80.62 บาท; intake 48 calls/55.67 บาท; 0 formula mismatches ใน intake
- [x] Trace deployed source: intake รวมภาพ/ถอดข้อความ; receipt OCR reuse transcription; web upload/manual แยกจาก AI admission
- [x] ระบุ defect ที่ budget code หายระหว่าง image intake/OCR และ misleading temporary-error reply
- [x] Owner ขอรวม A ledger, B error/fallback, C cost, D dashboard, E split budget ใน spec เดิม และตอบเลือก split caps แล้ว
- [x] กำหนด trusted bucket classification, migration/history, reservations, admin permissions/CAS/audit และ acceptance ใน spec
- [x] รีวิว local source `61c7cc37ea8f42ddb2c240fbed52a493976df3df` รอบ 2; ขยายข้อกำหนดตาม R-01–12 และเปลี่ยน SPLIT เป็น per-provider-step reservation หลังพบ whole-chain feasibility gap
- [ ] ตัวตน screenshot actor ยังไม่ยืนยัน; log ช่วงที่อ่านได้สิ้นสุด 21:30:29 KST ไม่อ้างว่าตรวจครบถึง 22:00 หรือนำเรื่องนี้มาปะปนกับผล acceptance ของ fix

## 2. ลำดับ implementation และขอบเขต

ก่อน code edits ให้อ่าน Ponytail full ตาม AGENTS; ถ้า absolute path เก่าหายให้ใช้ `.agents/skills/ponytail/SKILL.md` ที่มีอยู่จริง คงแพตเทิร์นเดิมและไม่แก้ `package.json` เพื่อเพิ่ม scripts/metadata งานแบ่งเป็น commits/ช่วงส่งมอบที่ตรวจได้ภายในแผนเดียว ไม่สร้าง legacy role-agent passes

### A. Ledger lifecycle — spec §4–7

- [ ] เพิ่ม fake regression absent stream/missing group ให้สะท้อน Redis NOGROUP และแดงบนต้นเหตุ
- [ ] เพิ่ม exact-key `exists` ใน interface เดิม; เฉพาะ XPENDING NOGROUP + EXISTS=0 เท่านั้นที่คืน empty
- [ ] Existing stream, failed EXISTS, other Redis errors และ marker lookup failure ยัง unavailable
- [ ] คง append/TTL/ack/claim/durable marker/tenant/chat semantics ไม่สร้าง/reset group ใน read path
- [ ] เพิ่ม structured reason ที่ไม่มี raw LINE/chat key และ dispatcher coverage direct text + delivery
- [ ] เพิ่ม bounded pending pagination/incomplete read outcome สำหรับ >50 entries และหลายผู้ถาม; isolate missing-group key ใน reclaim โดยไม่ปิด healthy key ทั้ง batch

ไฟล์หลัก: `line-ai-ledger.service.ts`, service specs และ `process-line-webhook.use-case.spec.ts` ใน `apps/api/src/modules/line-ai/application/` ไม่มี schema change ในช่วง A

### B. Budget reason, receipt fallback และ terminal — spec §9

- [ ] ขยาย contract/result เดิมให้ known budget error และ optional scope ผ่าน API client/intake/OCR/dispatcher/web โดยไม่เสียเหตุ
- [ ] Short-circuit AI fallbacks เมื่อ budget denied; persist pending file ตามสิทธิ์ได้โดยไม่สร้าง expense หรือเรียก AI
- [ ] ใช้ deterministic Thai replies แยก exceeded/insufficient/busy/unavailable/OCR quota; ยืนยัน retained เฉพาะเมื่อ persistence สำเร็จ
- [ ] Web OCR error ไม่ล้างไฟล์หรือ manual fields; ไม่ auto retry งบเต็ม/ไม่สัญญา background retry
- [ ] Budget terminal class และ support intentional outcome ชัด; delivery pending/failure และ unknown failure ยังอยู่ใน metrics
- [ ] ตรวจ consumer ของ terminal union/metrics ก่อนเพิ่ม class และยืนยัน full receipt permission/plan/count behavior
- [ ] ส่ง reason/scope ลง durable web extraction/LINE/job result; recovery ของ attempt เดิมไม่เขียนเหตุใหม่จาก budget ปัจจุบัน
- [ ] แก้ drain/statement/CRM/draft permanent budget refusal ไม่ให้ generic retry จนเปลี่ยนเหตุเป็น delivery cap/poison failure; busy/unavailable ยัง hold ตามเดิม

ไฟล์หลัก: `packages/contracts/src/line-ai.ts`, `apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts`, `process-line-webhook.use-case.ts`, `domain/logic/line-ai-terminal-outcome.logic.ts`, receipt OCR client/use case และ web expense extraction states ที่ใช้อยู่

### D1. Usage metadata และ baseline ก่อนเปลี่ยน prompt — spec §10.1, §11

- [ ] เพิ่ม additive server-derived request kind/budget bucket, pricing/component snapshot และ execution identity โดยไม่ rewrite history
- [ ] ส่ง usageBasis ตลอด provider/interceptor/API/ledger; เพิ่ม MODEL_CALL/COST_ADJUSTMENT และ reconcile signed deltas โดย callCount ไม่เพิ่มจาก correction
- [ ] ระบุ unknown/partial metadata อย่างชัดเจน; no inferred backfill จาก tag/request peers
- [x] ทำ baseline corpus text/image, cold/warm cache และต้นทุนรวมทุก calls/retries ต่อ successful task — [baseline 2026-09-17](../research/line-ai-intake-cost-benchmark-2026-09-17.md): 82 attempted tasks / 212 calls / THB 70.47 บน Sonnet 4.6 จริง; cold/warm วัดรายคอลตาม §4.4 (run นี้ warm 96% จึงต้องถ่วงน้ำหนักด้วยตัวเลข cold รายคอล ไม่ใช่ค่าเฉลี่ยของ run)
- [ ] ต่อ `GET ai-usage` ให้รวม totals/top tags/other tags/request kind/buckets/cache ใน snapshot เดียว พร้อม contract tests
- [ ] เพิ่ม frontend breakdown/average/coverage/Thai labels, loading/error/retry/read-only และไม่สับสน calls กับ receipt counts
- [x] Freeze baseline manifest/expected outcomes/repetitions; รายงาน attempted-task cost และ completion/refusal/parse rates ควบคู่ successful-task cost — manifest `scripts/line-ai-intake-cost.corpus.ts` hash `cf9bce44…` ตรึงด้วย `scripts/line-ai-intake-cost.corpus.spec.ts`; repetitions=2, FX=33; รายงาน THB/attempted 0.86 คู่กับ THB/successful 0.93 พร้อม refusal 0.0% / parse 1.2% / truncation 0.0%

ไฟล์หลัก: `apps/api/prisma/schema.prisma` + additive migration, `packages/contracts/src/ai-lineage.ts`, `partner-management.ts`, `company-ai-usage-meter.ts`, `get-partner-ai-usage.use-case.ts`, `PartnerDetailPage.tsx`, `system-partners.api.ts` และ logic/specs ที่เกี่ยวข้อง

### C. Intake cost — spec §10.2

- [ ] ระบุ prompt/context/catalog ซ้ำที่พิสูจน์ได้จาก baseline; ไม่รื้อ router หรือเพิ่ม classifier/model call ใหม่
- [ ] ปรับ scoped context และ cache prefix ด้วย builder เดิม โดยคง permission/provenance/clarification contracts
- [ ] ปรับ output bounds เฉพาะเมื่อ corpus ยืนยันว่าไม่ truncate/เพิ่ม retries; dense receipts และ correction ต้องคง accuracy
- [ ] รักษา valid documentText/preparedPlan reuse; ตัด duplicate calls เฉพาะที่พบจริง
- [ ] เก็บผลก่อน/หลังทั้ง user task แยก text/image และ cache state; ไม่ถือว่าผ่านจาก tag intake ลดอย่างเดียว

ไฟล์หลัก: `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts`, prompt/catalog builders, `line-intake-router.agent.spec.ts`, receipt controller/provider paths เฉพาะที่ผลวัดชี้ว่าจำเป็น ไม่เปลี่ยน per-company model policy

### E1. Split config และ financial admission — spec §12

- [ ] เพิ่ม active mode/caps/version และ pending policy พร้อม effective month ใน config; validate C/O>=0, C+O<=effective total และ preserve SHARED default โดยไม่ทับค่าปัจจุบันด้วยค่าเดือนหน้า
- [ ] ขยาย admin DTO/use case/audit history ด้วย reason + expected version + exact replay no-op; config/ceiling writers ทุกทางห้ามทำ split state ผิดโดยเงียบ
- [ ] Inventory ทุก cost-bearing seam: LINE intake/text/media, receipt web/LINE, statement, CRM และ draft; classify CHAT/OCR จาก API ก่อน AI
- [ ] กำหนด finite upper bound/execution envelope ต่อ provider step รวม images/cache/output/SDK attempts/timeout และ per-invocation rounding; ตรึง pricing/FX พร้อม minimum viable cap table
- [ ] Simple one-call API reserve และ multi-call gateway budget-step seam ใช้ API-owned authenticated reservation เดียวกัน; ไม่จอง whole chain ซ้ำ และเก็บ partial result เมื่อ step ถัดไป insufficient
- [ ] เพิ่ม durable reservation/unique settlement และ bucket aggregates บน actual usage ledger เดิม; atomic total+bucket reserve, settle, partial release
- [ ] แยก transport/attempt/invocation identities; durable execution claim ก่อน provider และ owner fencing หลัง timeout/reclaim; same request ต่างขั้นคิดครบและ late result ไม่คิดซ้ำ
- [ ] ใส่ reservation ก่อน OCR count admission; budget refusal ไม่กิน count ส่วน refund/paid grants คงตาม spec ที่ใช้อยู่จริง
- [ ] ทดสอบตาม onboarding Issue 4: refund usable-result quota ไม่คืน AI money; no-call refusal คืน hold ได้ และ delayed compensation ไม่กระทบ owner ใหม่
- [ ] ถือ lock สั้นเฉพาะ DB transactions; คง media/chat scheduling และการคุยระหว่างอ่านรูป
- [ ] ใช้ canonical config/company/plan/platform/month/bucket lock order; platform default validation และ signup/other writers ไม่ข้าม split caps หรือทำ deadlock
- [ ] จัดการ transport uncertainty/crash/meter failure แบบ conservative ไม่ TTL-release อัตโนมัติ; มี operator evidence สำหรับ unresolved reservation
- [ ] Usage หลัง controller/parser error/partial chain ส่งถึง authenticated settlement/recovery แม้ outer HTTP หาย; audit correction และ original-month balance ไม่เพิ่ม callCount
- [ ] ป้องกัน old writer/old binary ที่ไม่รู้ SPLIT, pin month และระบุ next-month activation สำหรับบริษัทมี spend อยู่แล้ว
- [ ] Effective policy revision ข้ามเดือน/cancel activated pending/SPLIT→SHARED ต้องไม่เปิด shared allowance โดยไม่ตั้งใจ; materialize predecessor ก่อน config write

**จุดพร้อมเปิด E1:** ทุก seam ที่บริษัท SPLIT เข้าถึงต้องมี upper bound + enforced envelope + idempotent settlement ครบ มิฉะนั้นยังปิด activation ของบริษัทนั้น ไม่ใช้สูตรเฉลี่ยหรือ bypass ชั่วคราว งาน A–D เดินต่อได้โดยไม่ต้องเปิด E

### D2. Split admin UI และ end-to-end — spec §11–13

- [ ] แสดง saved/pending policy, total, CHAT/OCR caps, spent/reserved/available, unknown/partial coverage และ activation month
- [ ] Form validation/CAS conflict/reload/audit; company switch ไม่แสดงยอดของบริษัทก่อนหน้า ปุ่ม save ไม่ใช้ stale values
- [ ] แสดง insufficient แยก exceeded และ reserved แยก spent; การอ่านใบเสร็จต่อหลัง CHAT เต็มต้องผ่าน total/OCR/count/plan/permission จริง
- [ ] Real HTTP DTO/controller mapping และ audit field allowlist รองรับ absent/null/zero/pending fields ไม่ให้ fields ใหม่ถูก ignore
- [ ] Partner support timeline, receipt grant/plan adjustment warnings และ signup ops อ่าน effective CHAT/OCR readiness โดยไม่สื่อว่า receipt grants เพิ่มเงิน AI
- [ ] Regression รวม NOGROUP + split denial + receipt persistence และตรวจ webhook/expense/usage/reservation/delivery พร้อมกัน

## 3. Verification matrix

| ช่วง | หลักฐานที่ต้องผ่าน |
| --- | --- |
| A | Fake regression + isolated real Redis fresh/expiry/group loss, store/marker failure, races, tenant/user separation, dedup |
| B | Text/image/web typed errors; no provider/count on refusal; retained/save-failed/permission states; terminal versus delivery truth |
| C | Before/after corpus cost per successful task, dense OCR field/routing accuracy, cold/warm cache, retries and latency |
| D | Contract + API RepeatableRead aggregates + web desktop/mobile, partial history, reconciliation, access denial/stale company/CAS |
| E | Real DB concurrent reservations/settlement, pinned month, all seams, budget races, unknown outcome, replay, migration/old writer/rollback |
| Combined | Direct text without menu, OCR alongside chat, CHAT cap/OCR available and reverse, TOTAL cap, unavailable stores, file persistence and no duplicate expense |

Review regression เพิ่ม: R-01–12 ใน spec เป็น release gates รวม missing/duplicate invocation evidence, count refund versus cost, SDK bounds, total/config races, late month work, stale Admin UI และ readiness consumers ใช้ synthetic data/isolated DB ไม่เรียก cloud/prod จาก tests

Focused starting commands (ชื่อ runner/test paths ต้องตรวจอีกครั้งขณะ implementation; ไม่ต้องเพิ่ม package script):

```sh
pnpm --filter @watchdog-bms/api exec tsx --test \
  src/modules/line-ai/application/line-ai-ledger.service.spec.ts \
  src/modules/line-ai/application/line-ai-consumption-marker.spec.ts \
  src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts \
  src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.spec.ts \
  src/modules/line-ai/application/company-ai-usage-meter.spec.ts \
  src/modules/line-ai/infrastructure/ai-gateway.client.spec.ts \
  src/modules/line-ai/domain/logic/line-ai-terminal-outcome.logic.spec.ts \
  src/modules/system-partner-management/application/use-cases/get-partner-ai-usage.use-case.spec.ts \
  src/modules/system-partner-management/application/use-cases/set-partner-ai-model.use-case.spec.ts \
  src/modules/system-partner-management/application/use-cases/set-platform-ai-budget.use-case.spec.ts \
  src/modules/crm-inbox/infrastructure/crm-ai-gateway.client.spec.ts \
  src/modules/ai-draft/application/use-cases/generate-suggestion.use-case.spec.ts
pnpm --filter @watchdog-bms/ai-gateway exec tsx --test \
  src/modules/line-ai/agents/line-intake-router.agent.spec.ts
pnpm --filter @watchdog-bms/api exec tsc --noEmit
pnpm --filter @watchdog-bms/ai-gateway exec tsc --noEmit
pnpm --filter @watchdog-bms/web exec tsc --noEmit
git diff --check
```

เพิ่ม focused tests ของใหม่ผ่าน runner ที่มีอยู่ตาม diff จริง ต้องทดสอบ reservation concurrency/settlement กับ DB จริงที่แยกจาก live และ Redis lifecycle กับ synthetic tenant/chat เท่านั้น Fake ที่คืน empty/missing delegate แทน infrastructure errors ไม่ใช่ acceptance

บันทึก commands, actual results/test counts, before/after model cost, source SHA และข้อจำกัดใน memory Checklist นี้ยังไม่ใช่ผลการรันทดสอบ

## 4. Migration, UAT และ Production

- [ ] Schema expand ก่อน writers/readers ใหม่; metadata rows เก่า nullable/unknown และไม่มี usage cost rewrite
- [ ] ทุก seam พร้อมก่อนอนุญาต SPLIT; บริษัท nonempty month ใช้ next-month activation และไม่มี auto allocation จากงบ 80 บาทในภาพ
- [ ] ก่อน cloud read/deploy/retry/recovery อ่าน cloud operations runbook และ mandatory UAT/Production protocol ฉบับปัจจุบัน
- [ ] UAT synthetic/admin-approved company: Redis lifecycle, LINE budget replies, pending image, web manual/upload, split UI/CAS และ concurrent cap/settlement รวมกัน
- [ ] จัด test funds/caps เฉพาะ environment ที่อนุญาต; ไม่แก้งบบริษัทจริงเพื่อให้ test ผ่าน
- [ ] เก็บ exact UAT/READY/Production run IDs, digests, signed results และ customer OPEN ตาม protocol เมื่อมีการอนุญาต deploy; ไม่ dispatch ซ้ำเพื่อไล่ error
- [ ] Rollback ที่ยังอ่าน SPLIT/reservations ได้; ไม่ drop schema/ledger, auto-release holds หรือ downgrade เป็น shared แบบเงียบ

## 5. Handoff และจุดเสร็จ

เอกสารเสร็จเมื่อ A–E มี product behavior, architecture/contracts, data/permission/concurrency boundaries, verification และ rollout ชัด อ้างอิงกันได้ และบันทึก owner decision แล้ว Implementation จะเสร็จได้เมื่อ AC-01–16, B/C/D/E, X และ R-01–12 ใน spec มีหลักฐานครบ; partial release A–D ไม่ใช่การปิดงานทั้งหมด

ยังไม่ทราบเปอร์เซ็นต์ประหยัดจริงจนรัน corpus, ยังไม่มีตัวเลข caps ที่ owner ตั้งให้บริษัทจริง และยังไม่ยืนยัน screenshot actor ข้อเท็จจริงเหล่านี้ไม่ทำให้ต้องเดาหรือแก้ live state เพื่อปิดเอกสาร
