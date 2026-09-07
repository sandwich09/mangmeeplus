# Agent Memory: line-ai-hosted-baseline-2026-09-03

Historical baseline measured on 2026-09-03; this is not a current SLO or a fresh runtime/configuration readback.
Status: หลักฐาน B1 (hosted baseline ต่อ stage) ชุดแรก อ่านจาก CloudWatch จริง 2026-09-03 (หน้าต่าง 7 วัน 2026-08-27 → 2026-09-03) ยังไม่ผูก SHA รายเทิร์น; ใช้เป็นตัวเทียบสำหรับ gate ถัดไปได้ทันที
Owner: thawatchai.phuchana
Scope: วัด "ช้าตรงไหน" ของ AI มั่งมี (Employee LINE OA) บน production และ UAT หลังเปิด lane ตาม parity 2026-08-30 — ไม่มีการเปลี่ยนโค้ด/flag/deploy ใน session นี้

## วิธีวัด (ทำซ้ำได้)

- `aws logs filter-log-events` (profile `watchdog-bedrock-dev`; `logs:StartQuery` ถูก Deny จึงใช้ filter + คำนวณ percentile เอง) บน `/ecs/watchdog-bms-{prod,uat}-api-web` สำหรับ `line.ai.stage`, `line.ai.api_trace`, `line.ai.turn_summary`, `line.ai.advisor_direct_served` และ `/ecs/watchdog-bms-{prod,uat}-ai-gateway` สำหรับ `ai.turn.complete`, `ai.usage`
- End-to-end ต่อเทิร์น = `bufferWaitMs + queueWaitMs` (api_trace) + ผลรวม `line.ai.stage` ของ `webhookEventId` เดียวกัน (ไม่รวมเวลาที่ LINE ส่ง webhook มาถึง)
- AgentCore runtime ไม่เขียน log group (agentcore-deploy.sh บอกไว้) → มองไม่เห็นว่า prepared lane served/fallback เพราะอะไร

## Production (7 วัน, n=158 เทิร์น: command 67 / text 34 / media 57)

| ชิ้น | n | p50 | p95 |
|---|---:|---:|---:|
| bufferWait (debounce) — text/media | 91 | 1,002 ms | 1,003 ms |
| bufferWait — command (เมนู/ปุ่ม) | 67 | 0 | 0 |
| queueWait — media (ภาพหลายใบติดกัน) | 57 | 0 | 65,144 ms (max 104,598) |
| intake_route (API-observed) | 19 | 4,827 ms | 8,542 ms |
| gateway_turn (API-observed) | 11 | 5,669 ms | 5,907 ms |
| ↳ AgentCore invoke overhead (`agentcoreHttpMs − runtimeTotalMs`) | 11 | 1,341 ms | 1,883 ms |
| ↳ orchestrationMs ใน runtime | 11 | 4,010 ms | 4,534 ms |
| line_delivery | 157 | 208 ms | 389 ms |
| **End-to-end คำถามธุรกิจ (ถึง gateway_turn)** | 11 | **11,690 ms** | 13,392 ms |
| End-to-end intake-only (advisor direct / refusal) | 6 | 6,664 ms | 9,766 ms |
| End-to-end command | 67 | ~1,170 ms | — |

- ทุกเทิร์นธุรกิจ = Sonnet 4.6, `modelCallCount` 2, `toolCallCount` 1, `preparedPlanVersion` 1 ทุกเทิร์น — แต่ **prepared lane ไม่เคย serve** (ถ้า serve จะเป็น 0 model call ใน gateway) ทั้ง 9 เทิร์นเป็นคำถาม "รายการ/ยอดค่าใช้จ่ายเดือนนี้"
- `ai.usage` gateway (ไม่รวม call ใน AgentCore): `line.intake-route` แบบ text n=18 p50 4,939 ms / output เฉลี่ย 275 tokens / cache hit 6/18 / ≈17.9 ms ต่อ output token — เวลาถูกกำหนดโดยความยาว JSON ที่ router ต้องพิมพ์ ไม่ใช่ขนาด prompt (cache hit vs miss p50 5,456 vs 4,798 ms ไม่ต่างกัน)
- `line.intake-route` แบบมีรูป n=48 p50 25,771 ms / output เฉลี่ย 1,947 tokens (documentText) + `ocr.receipt.image-read` p50 12,607 ms (ok 33/47) + `ocr.receipt.extract` p50 7,521 ms (n=110 ≈ 2 ครั้งต่อรูป) + `image-reread` p50 14,496 ms (n=29)
- refusal `unsupported_module` 2/11 เทิร์นธุรกิจใน prod, 4/11 ใน UAT

## UAT (7 วัน, n=55)

- intake_route p50 5,692 / p95 10,223 ms; gateway_turn p50 5,291 / p95 8,338 ms; end-to-end ธุรกิจ p50 12,544 ms; advisor direct served 17 เทิร์น → end-to-end intake-only p50 7,317 ms (คุยเล่น 1 model call แต่ยัง ~7 วินาที)

## ข้อสรุปที่ใช้ตัดสินใจ

1. คำถามธุรกิจวันนี้ ≈ 1.0 (debounce) + 4.8 (intake router) + 5.7 (AgentCore turn: 1.3 overhead + 2 calls) + 0.2 (ส่ง) ≈ 11.7 วินาที p50
2. Lever ตามลำดับผล: (ก) ลด output tokens ของ intake router / ย้าย router ไป model เร็วกว่า (ข) ทำให้ prepared lane serve จริง (วันนี้ 0/9) และให้มี log ที่มองเห็น (ค) ตัด AgentCore overhead 1.3 s หรือรวม intake+turn เป็น call เดียว (ง) media burst: lease ต่อบริษัท 1 ทำให้รูปใบที่ 4 รอ >100 s
3. ยังไม่มี sample ของ casual/joke/knowledge บน prod พอทำ SLO; UAT มี 17 เทิร์น

Next: ใช้ตารางนี้เป็น baseline ของ gate B2–B6 ใน `mangmee-brain-real-answers-plan.md`; ผูก SHA เมื่อวัดซ้ำหลัง deploy ถัดไป

## เพิ่มเติม 2026-09-03 (read-back AgentCore runtime จริง)

- **ทำไม prepared lane serve 0/9 บน production: เพราะ runtime ที่รันเทิร์นปิดอยู่** `aws bedrock-agentcore-control get-agent-runtime` (ap-southeast-1) → `watchdog_orchestrator_production_candidate-FWHp0D4V34` (GIT_SHA 71263dd0, 2026-09-01) มี `LINE_AI_PREPARED_SIMPLE_READ_ENABLED=false`, `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES=""`, `LINE_AI_FUSED_PLAN_SHADOW_ENABLED=false` ขณะที่ `watchdog_orchestrator_uat_candidate-NwJNiqG5Jd` มี prepared=true + 4 families สาเหตุ: `infra/ai-gateway/agentcore-deploy.sh:180-188` บังคับ production เป็น false "unconditionally until the lane passes its activation gates" ส่วน parity 2026-08-30 (`31aeb642`) แก้เฉพาะ ECS task ใน deploy.sh → ชั้น ECS เปิด แต่ชั้นที่ execute จริงปิด
- UAT: lane เปิดจริงแต่ 11 เทิร์นธุรกิจยังใช้ 2–3 model calls ทุกเทิร์น → fallback ด้วยเหตุผลที่ยังมองไม่เห็น (คาดว่า shape `list` ของ expense.list_recent ไม่ได้ compile) ต้องทำ reason ให้ observable หรือ reproduce ด้วย orchestrator-smoke
- AgentCore ไม่มี log group ใน ap-southeast-1 (describe-log-groups prefix `/aws/bedrock-agentcore` ว่าง); เอกสาร AWS: ต้องตั้ง Log delivery APPLICATION_LOGS ที่ runtime และเปิด CloudWatch Transaction Search สำหรับ spans
- โมเดลที่บัญชีนี้ใช้ได้แล้ว (inference profile ACTIVE): global.anthropic.claude-haiku-4-5-20251001-v1:0, claude-sonnet-5, claude-opus-5, claude-fable-5-1; smoke call จริงจากเครื่อง dev: Sonnet 4.6 1,068 ms / Haiku 4.5 825 ms (prompt 37 tokens, ไม่ใช่ benchmark)
- อ้างอิงภายนอก: Bedrock pricing Haiku 4.5 $1/$5, Sonnet 4.6 $3/$15 ต่อ MTok (global = base, regional +10%); Artificial Analysis Sonnet 4.6 non-reasoning 44 tok/s TTFT 1.68 s vs Haiku 4.5 86 tok/s TTFT 0.75 s; Bedrock structured outputs GA 2026-02-04 ผ่าน Converse `outputConfig.textFormat` + `strict:true`, cross-region ได้, grammar compile ครั้งแรกอาจกินหลายนาที cache 24 ชม.
