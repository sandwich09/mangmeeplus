# Mangmee Brain Answer Architecture Assessment

สถานะ: **Assessment สำหรับตัดสินใจ (2026-08-25)**

โจทย์จาก Owner: สมองมั่งมีไม่ใช่เดโม — ต้อง **ตอบฉลาด ตอบคำถาม หาข้อมูลบริษัทได้ เร็วและถูก** และให้รีวิว architecture ใหม่

## 1. คำตอบหลักของการรีวิว

**ไม่ต้องออกแบบสถาปัตยกรรมใหม่จากศูนย์** สถาปัตยกรรมที่ตอบโจทย์ "ฉลาด เร็ว ถูกต้อง และประหยัด" ถูกออกแบบครบแล้วในสอง spec และโค้ดส่วนความเร็วถูก merge เข้า `main` แล้วแบบ default-off:

- [Latency and autonomy lanes spec](line-ai-latency-and-autonomy-lanes-spec.md) — สถาปัตยกรรม "เร็ว": debounce candidate 1,000 ms, loading-on-accept, fused prepared plan (1 model call), deterministic simple-read lane (0–1 call + compiled formatter), client reuse/session affinity (reserved)
- [Advisor conversation spec](line-ai-mangmee-advisor-conversation-spec.md) — สถาปัตยกรรม "ฉลาด": one brain multi-mode, call budget 0–1 generative call ต่อ journey, context layering (persona / knowledge cards / company advisory profile / live tools / deterministic analytics), SLO ต่อ journey, cost gate

สิ่งที่ขาดไม่ใช่ design แต่คือ **การเปิดใช้ตามหลักฐาน (activation)**: วัด baseline จริง → เปิดทีละชั้น → ขยาย coverage ให้ครอบคำถามที่ผู้ใช้ถามจริง งานนี้เรียกในเอกสารนี้ว่า **Brain-Real Track (B0–B7)**

## 2. เป้าหมายแปลเป็นเกณฑ์ที่วัดได้

| คำของ Owner | เกณฑ์ (จาก spec ที่มีอยู่) |
|---|---|
| ฉลาด/ตอบคำถามได้ | โหมดครบตาม advisor spec §6: social, business knowledge, company insight, live query, action handoff; คำถามนอกขอบเขตปฏิเสธสุภาพ ไม่เดา |
| หาข้อมูลบริษัทได้ | live query ผ่าน permission-checked tools เท่านั้น; ตัวเลขทุกตัวมี source + `asOf`; wrong-tenant disclosure = 0 |
| เร็ว | ack ≤1s p95; exact deterministic ≤2s; social p95 ≤3.5s; knowledge ≤5s; company insight ≤6s; simple read p50 3s (ตัวเลขเป็น hypothesis จนมี hosted baseline — spec ระบุเองว่าห้ามถือเป็น commitment ก่อนวัด) |
| ถูก (ถูกต้อง) | model proposes, code verifies; **ห้าม model คำนวณ/แต่งตัวเลขเอง** (non-goal ใน spec); compiled formatter ตอบจากผล tool ตรง ๆ; sanitizer แบบ exact-equality — input เปลี่ยนแม้นิดเดียว = fallback ก่อนยิง tool |
| ถูก (ประหยัด) | call budget 0–1 generative call/turn, เฉลี่ย ≤1.1; activation ต้องลด cost ต่อ eligible turn ≥30% ต่อ lane; prompt prefix แบบ cache-stable |

## 3. สถานะโค้ดจริงวันนี้ (ตรวจ 2026-08-25)

| ชิ้น | สถานะ | หลักฐาน |
|---|---|---|
| Latency lanes Phase 0–6 (instrumentation, loading-on-accept, debounce cohort, fused plan, deterministic lane, formatter) | **merged เข้า `main` แล้ว** ผ่าน `codex/line-ai-latency-autonomy-rebase`; ทุก flag default-off พร้อมหลักฐานว่า off = พฤติกรรมเดิม (prompt byte-for-byte, 2,500 ms path เดิม) | `git branch --merged main`; [latency memory](../agent-memory/line-ai-latency-and-autonomy-lanes.md) |
| Exact-greeting deterministic lane (0 model call) | **เปิดบน UAT แล้ว, production ปิด (deploy.sh บล็อกไว้)** | `infra/prod-ecs-express/deploy.sh` — `LINE_AI_EXACT_GREETING_ENABLED` UAT default true, production hard-error |
| Flag เร่งความเร็วตัวอื่น (loading-on-accept, debounce experiment, fused shadow, prepared simple-read, families, Phase 6) | โค้ดพร้อม แต่**ยังไม่ wire เข้า deploy.sh** → ปิดทุก environment | grep deploy.sh พบเฉพาะ exact-greeting; ตาม pattern PR #226 การเปิด = แก้ deploy.sh + re-pin + UAT run |
| Compiled family | มี **1 family**: `sales.get_sales_summary::single_metric`; operator allowlist ว่าง = lane ยัง dormant | latency memory Phase 5 |
| ชุดทดสอบความปลอดภัย 23 เคสของ prepared lane | **ไม่มี test ที่รันจริง** — ไฟล์ spec ถูกลบ 2026-08-21 เพราะ import ข้าม boundary ทำ ai-gateway image build พัง (UAT run 32436479992) | latency memory "Phase 4 SECURITY EXECUTION — REMOVED" |
| Hosted baseline p50/p95 ต่อ stage | **ยังไม่เคยวัด** — telemetry (`line.ai.api_trace`/`stage`/`turn_summary`) อยู่ในโค้ดแล้ว ต้องยืนยันว่า UAT build ปัจจุบันมีและอ่านผลจริง | latency memory residuals |
| Provider quality ของ prepared plan | ยังไม่มี — shadow flag มีไว้เก็บหลักฐานนี้ แต่ยังไม่เคยเปิด | latency memory residuals |
| Advisor conversation (knowledge cards, company profile, social) | spec v2 + plan พร้อม (Slice A ก่อน) ยังไม่ implement | [advisor plan](../plans/line-ai-mangmee-advisor-conversation-plan.md), [advisor memory](../agent-memory/line-ai-mangmee-advisor-conversation.md) |
| AI delivery durability (`AI-01`: terminal replay, DB-backed intake state, Flex fallback) | blocker เดิมยังเปิด — gate ก่อน customer GO | แผน 2.5 วัน §4.2 |

เส้นทางที่ผู้ใช้เจอวันนี้: **debounce 2,500 ms + full model loop (router → tools → composer/critic) กับทุกคำถาม** — ช้าโดยโครงสร้าง ไม่ใช่เพราะ model อย่างเดียว

## 4. ช่องว่างจริง 6 ข้อ (เรียงตามผลต่อ "เร็ว+ถูก")

1. **ไม่มี hosted baseline** — ทุก activation gate ใน spec ต้องเทียบกับ baseline ที่วัดจริง จึงยังเดินต่อไม่ได้ทั้งสาย
2. **Flag เร่งความเร็วยังไม่ wire เข้า deploy** — ของที่เขียนเสร็จแล้วไม่มีผลกับผู้ใช้แม้แต่ตัวเดียว (ยกเว้น exact greeting บน UAT)
3. **ชุดทดสอบความปลอดภัย 23 เคสไม่มีตัวรันจริง** — ห้ามเปิด prepared lane จนกว่าจะ re-establish ในตำแหน่งที่ถูก (ใน `apps/ai-gateway` test suite ไม่ import ข้าม boundary)
4. **Family เดียวไม่ครอบคำถามผู้ใช้** — คำถามหลักบนหน้าแรกของแผน (เงินเข้า–ออกวันนี้, หมวดค่าใช้จ่ายไหนเพิ่ม) ยังไม่มี compiled family
5. **Debounce 2,500 ms กินงบเวลา** — cohort experiment 1,000/1,500/2,500 ms ออกแบบเสร็จแต่ยังไม่รัน
6. **AI-01 delivery blockers** — ต่อให้ตอบเร็ว ถ้าข้อความค้าง/ซ้ำ ก็เสียความเชื่อมั่น; ยังเป็น gate ก่อน GO เช่นเดิม

## 5. Brain-Real Track — ลำดับ activation ตามหลักฐาน

| ขั้น | งาน | หลักฐานปิดขั้น | ผลที่ผู้ใช้รู้สึก |
|---|---|---|---|
| **B0** (เริ่มในรอบ 2.5 วัน) | ยืนยัน UAT build ปัจจุบันมี telemetry จริง (`api_trace`/`stage`/`turn_summary` ไหลใน hosted log); บันทึกรายการคำถาม top-N ที่ Owner ยืนยันแล้ว (§6.1) ลง manifest | log จริงจาก UAT + รายการคำถามใน manifest | ยังไม่เปลี่ยน (flags off) |
| **B1** | อ่าน hosted baseline p50/p95 ต่อ stage + split-utterance จาก traffic UAT/beta อย่างน้อย 2–3 วัน | baseline report ผูก SHA/environment | ยังไม่เปลี่ยน — แต่ทุก gate ถัดไปมีตัวเทียบแล้ว |
| **B2** | wire + เปิด `LINE_AI_LOADING_ANIMATION_ENABLED` (master) + `LINE_AI_LOADING_ON_ACCEPT_ENABLED` บน UAT | loading แสดงตั้งแต่รับข้อความ ไม่รอ debounce; ordering test ผ่านแล้วในโค้ด | **เห็น "รับเรื่องแล้ว" ทันที ≤1s** |
| **B3** | เปิด debounce cohort experiment (1,000 primary / 1,500 conservative / 2,500 control ตามที่ตัดสินแล้ว) | cohort ผ่าน fragment/re-ask/cost gates ตาม spec | **คำตอบเริ่มเร็วขึ้น ~1.5s ต่อ turn เมื่อเลือก 1,000 ms** |
| **B4** | เปิด `LINE_AI_FUSED_PLAN_SHADOW_ENABLED` — วัดว่า provider จริงเสนอ prepared plan ถูกแค่ไหน (ไม่มีผลต่อคำตอบ) | shadow precision/recall report | ยังไม่เปลี่ยน |
| **B5** | re-establish security suite 23 เคสให้รันจริงใน CI ก่อน แล้วเปิด `LINE_AI_PREPARED_SIMPLE_READ_ENABLED` + family แรกผ่าน blind pairwise eval (latency memory Phase 5 gate) บน UAT | 23/23 execute ใน gateway suite; eval ≥ เกณฑ์; p50/p95 lane จริง | **คำถามยอดขายแบบง่ายตอบเร็วขึ้นชัดเจน (1 model call หรือ 0)** |
| **B6** | ขยาย compiled family ตามคำถาม top-N ที่ Owner ยืนยัน (§6.1): เงินเข้า–ออกวันนี้, สรุปรายการเดือนนี้, สรุปค่าใช้จ่าย (แต่ละ family: ตรวจ/ขยาย read tool → formatter → blind eval → allowlist) | ต่อ family: eval + hosted latency + ความถูกต้องจาก golden set | **คำถามหลักของหน้าแรกตอบเร็วและตัวเลขตรง** |
| **B7** | Advisor Slice A ตาม advisor plan: social/persona/short-term context เท่านั้น; Slice B/C knowledge/company ยังอยู่ P23 | naturalness/persona/safety/mixed-intent/cost gates ตามแผน advisor เดิม | **คุยเรื่องทั่วไปได้เป็นธรรมชาติ** โดยไม่ปนข้อมูลบริษัท |

ตลอดทาง (ไม่ข้าม): `AI-01` delivery blockers ปิดก่อน customer GO; cost ต่อ eligible turn ลด ≥30% ต่อ lane; generative calls เฉลี่ย ≤1.1; quality/guard ไม่ถอยเพื่อแลกตัวเลข latency; ทุก flag เปิดผ่าน deploy.sh + UAT run ตาม pattern PR #226; การอ่านสถานะ cloud ทำตาม `docs/runbooks/cloud-environment-operations.md`

## 6. ตัดสินแล้ว vs ต้องตัดสิน

ตัดสินแล้ว (จาก spec/memory เดิม — ไม่รื้อ):

- 1,000 ms เป็น primary debounce candidate, 1,500 conservative, 2,500 control
- ใช้ model เดิม (Sonnet 4.6) ก่อน; ลดจำนวน serial calls ก่อนคิด model tiering; small-router เป็น seam ที่จองไว้
- One brain multi-mode; ไม่เพิ่ม agent จนกว่า eval พิสูจน์ว่าจำเป็น; model proposes/code verifies
- Advisor ทำ Slice A ก่อน; ไม่มี shadow mode ของ advisor
- (2026-08-25) Owner ยืนยันรายการคำถาม top-N สำหรับ B6 แล้ว — ดู §6.1; ตัด "ยอดค้างรับ" ออกจากชุดแรก

### 6.1 รายการคำถามที่ Owner ยืนยัน (2026-08-25)

| คำถาม | Read tool ที่มีอยู่วันนี้ | หมายเหตุการออกแบบ family (B6) |
|---|---|---|
| ค่าใช้จ่ายวันนี้ (Owner ปรับนิยาม 2026-08-26 — ฝั่งจ่ายก่อน) | `expense.get_daily_closing` (มีอยู่แล้ว) | ไม่ต้องสร้าง tool/ลงนาม; บรรทัด source บังคับ "รายการที่บันทึกในระบบ ไม่ใช่ยอดธนาคาร"; family "เงินเข้า" กลับมาหลังฝั่งรายรับเปิด (P26) พร้อมนิยามลงนาม |
| สรุปรายการเดือนนี้ | `accounting.get_summary` | ปิด G1 ที่ `byType` รวมเพียง 200 เอกสารแรกก่อน; ตีความขอบเขต "รายการ" กับ Owner ตอนทำ golden fixtures |
| สรุปค่าใช้จ่าย | `expense.list_recent` | tool เดิมคืน totals + bounded records ตามเดือน/ช่วงวันที่; เลือก answer shape จาก response จริงและเสริมกับ 6A โดยตรง |

family key ที่แน่นอน (`${tool}::${answerShape}`) ชี้ขาดตอนออกแบบ B6 ต่อ family พร้อม golden set และ blind pairwise eval ตาม latency memory Phase 5 gate; `sales.get_sales_summary::single_metric` ที่ compile แล้วยังเป็น canary ตัวแรก

Architecture/product spec + delivery plan v2 สร้างแล้ว (2026-08-25): [mangmee-brain-real-answers-spec](mangmee-brain-real-answers-spec.md) + [plan](../plans/mangmee-brain-real-answers-plan.md) — ครอบ contract เร็ว/ถูก/ธรรมชาติ, UX และ delivery map B0–B7 โดย reuse architecture เดิม; ข้อค้นพบเพิ่มจากโค้ดจริง: (1) `accounting.get_summary` รวมยอดจากเอกสาร 200 ใบแรกเท่านั้น ต้องแก้ก่อนเปิด family สรุปเดือน (G1) (2) เงินเข้า–ออกต้องเพิ่ม read tool ใหม่ `accounting.get_cash_movement_summary` เพราะ prepared lane ยิงได้หนึ่ง call และไม่มี tool เดิมตอบครบ (3) นิยามเงินเข้า/ออกต้องให้นักบัญชีลงนามก่อน implement

Owner ต้องตัดสิน (คงเหลือ):

1. ยอมรับตาราง SLO เป็น "เป้าทดลอง" (ไม่ใช่คำสัญญา) จนกว่า B1 จะให้ baseline — ตรงตามที่ spec เขียนไว้เอง
2. ลำดับเวลา B5–B7 เทียบกับงาน P10–P12 (สมัครง่าย) — ทำคู่ขนานได้เพราะคนละพื้นที่โค้ด แต่ dev คนเดียวต้องเลือกคิวหลัก

## 7. ความสัมพันธ์กับแผน 2.5 วัน

- P6/6B ของแผน = **B0** (ยืนยัน telemetry + ล็อกรายการคำถาม) — ไม่ใช่เดโมอีกต่อไป
- B1–B7 เป็นงานแรกของก้อน "ใช้แล้วชอบ" ในรอบถัดไป ทำคู่ขนานกับ P10–P12 ได้
- 6A (AI แยกหมวดรายจ่าย) ไม่เปลี่ยน — เป็นงาน AI อันดับหนึ่งของรอบตามคำสั่ง Owner เดิม
- Gate C (load smoke) และ P3 (alarm/kill switch) ใช้กับ lane ใหม่ทุกตัวที่เปิด

## 8. แหล่งอ้างอิง

- [Latency and autonomy lanes spec](line-ai-latency-and-autonomy-lanes-spec.md) / [plan](../plans/line-ai-latency-and-autonomy-lanes-plan.md) / [memory](../agent-memory/line-ai-latency-and-autonomy-lanes.md)
- [Advisor conversation spec](line-ai-mangmee-advisor-conversation-spec.md) / [plan](../plans/line-ai-mangmee-advisor-conversation-plan.md) / [memory](../agent-memory/line-ai-mangmee-advisor-conversation.md)
- [แผน 2.5 วัน (v4)](../plans/mangmee-brain-2-5-day-priority-plan-th.md)
- Deploy wiring: `infra/prod-ecs-express/deploy.sh` (`LINE_AI_EXACT_GREETING_ENABLED` pattern)
- Runbooks: `docs/runbooks/uat-production-v2-deployment.md`, `docs/runbooks/cloud-environment-operations.md`
