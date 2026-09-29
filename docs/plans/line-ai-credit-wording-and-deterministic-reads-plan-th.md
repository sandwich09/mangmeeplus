# แผนงาน: LINE AI wave 2 — "เครดิต AI", ข้อความอ่านเอกสาร และคำตอบ deterministic

> Follow-up 2026-09-29: คำและ field ของ add-on ใช้ [สเปก add-on §17](../specs/chat-credit-and-receipt-addons-spec-th.md) ซึ่งยึด W-01 (“เครดิต AI” เป็นชื่อเดียวที่ลูกค้าเห็น; คอนโซลใช้ “เพดานเครดิต AI ต่อเดือน” กับเพดานรายเดือน) และงานอยู่ใน [แผน add-on PR F และ §9](chat-credit-and-receipt-addons-plan-th.md): projection ของลูกค้าที่ปลอดภัย, สาเหตุเชิงพาณิชย์กับเพดานของระบบ และความเข้ากันได้ของ template ข้อความ LINE ที่ค้างในคิว. หลักฐาน H1 เดิมเป็นของพฤติกรรมเดิม ไม่ใช้รับรอง D10 หรือ AO-E28–AO-E42; คำเตือน/การกู้ hold ของ operator และขอบเขต deterministic คงเดิม

- Spec: [line-ai-credit-wording-and-deterministic-reads-spec-th.md](../specs/line-ai-credit-wording-and-deterministic-reads-spec-th.md)
- Task memory: `docs/agent-memory/line-ai-credit-wording-wave2-2026-09-18.md`
- วิธีทำงาน: Opus 5 implement, Fable 5.1 คุม/ตรวจ bug-gap-impact, merge `develop` + `main` หลัง CI เขียว (เหมือน wave 1)
- Base: develop ≥ `e4702e23` (มี flag activation ON แล้ว, PR #622/#623)

## 1. ลำดับและขอบเขต

### H1. คำว่า "เครดิต AI" + ข้อความปฏิเสธการอ่านเอกสาร + billing hold warnings — spec §3, §4, §5

สถานะ: **ทำแล้ว** บนสาขา `codex/line-ai-wave2-h1-credit-wording-20260918` (ยัง local, ยังไม่ merge/deploy); หลักฐานใน spec §9.1 และ task memory

- [x] ทำ mapping ครบทุกจุดที่ผู้ใช้/แอดมินอ่าน (LINE reply, Flex card, drain notice + integrity check, web dictionary, banking/CRM/expenses notices, partner console + adjustment history, timeline, ops alert, billing pages, browser smoke scripts, sidebar "เครดิตการใช้ AI") ตาม spec §3; ไม่แตะ code/enum/telemetry/ชื่อ field
- [x] เส้นทางรูป: `aiBudgetReasonTh` + governance notice รวมเหตุฝั่งเงิน/จำนวนใบเป็น "เครดิตสำหรับการอ่านเอกสารไม่พอ"; unavailable/busy/disabled คงแยก; tail สถานะไฟล์เดิม; code/scope/class/count-refund เดิม (พิสูจน์ด้วย whole-chain + combined regression ที่แก้เฉพาะ expected text)
- [x] เส้นทางแชต: การ์ด TOTAL/CHAT/insufficient และ drain notice ตาม §5.1
- [x] Billing: `AI_CREDIT_HOLDS_PENDING` (additive) + `aiReservedSatang`/`aiUnresolvedHolds` (additive, ใส่เมื่อ > 0) + label; บริษัทไม่มี hold ผลเดิม; ไม่มีเงินไปหน้า owner (ทุก consumer ของ union เป็น System Admin only)
- [x] Web: Thai error map/dictionary coverage spec ผ่าน; ไม่มี "งบ AI"/"โควตา AI" เหลือ (guard test แบบ grep ใน `api-error-coverage.spec.ts` ที่ลงทะเบียนแล้ว)
- [x] Browser evidence 1440/390: หน้าแอดมิน AI และโควตา, billing ใบเสร็จ/แพ็กเกจ (มี hold และไม่มี hold) → `docs/qa/evidence/line-ai-credit-wording-2026-09-18/`
- [x] Docs: spec W-01…W-04, W-08 tick ตามหลักฐาน (+ §9.1); task memory
- [ ] ค้าง: `admin-ai-adjustments-smoke.ts` แก้ selector แล้วแต่รันในเครื่องไม่ได้ (billing-http-smoke harness) → รอ CI; W-09 UAT รอ deploy

### H2. Deterministic business reads (R5) — spec §6

- [x] หาเหตุที่ `text-read-daily-closing` พลาดเลนทั้งที่ family มี — เหตุคือแผนของ router เอง (ข้อความใน corpus ถามสองข้อ: checklist ปิดร้าน + ยังค้างจ่ายอะไร) ⇒ `not_simple` หรือ `no_simple_answer_shape`; pin ทุก variant ไว้ใน `prepared-simple-read.logic.spec.ts` พร้อม test ว่า read เดี่ยวยัง eligible และ F3 ยังตอบได้ → ไม่แก้ ไม่ลด security
- [x] เพิ่ม family: `tax.get_vat_summary::single_metric`, `inventory.list_low_stock::list`, `procurement.get_ap_outstanding::single_metric|list`, `crm.get_customer_summary::single_metric|list` — formatter + unit tests (F4–F7) + eligibility tests + security spec เดิมผ่านโดยไม่แก้ + `COMPILED_PREPARED_FAMILY_KEYS` (10 keys) + allowlist default ใน `deploy.sh` (ค่าเดียวกันทั้งสอง env) + pins re-sync
- [x] Grounded breakdown: tests ใน `response-composer.agent.spec.ts` (ผลต่าง/เปอร์เซ็นต์/ผลรวมย่อย/ค่าเฉลี่ย ถูกปฏิเสธ; คำตอบที่ไม่เพิ่มตัวเลขใหม่ผ่าน); ปิดช่องโหว่ "เลขไทย" ที่ทั้ง numeric guard และ polish guard มองไม่เห็น พร้อม test ทั้งสองทาง
- [x] แก้ comment ล้าสมัยใน `deploy.sh` ให้ตรงความจริง (parity default ON ทั้งสอง env ตั้งแต่ 2026-08-30); `production-serving-mode.spec.sh` pin ครบทั้ง 10 family
- [x] Corpus replay ก่อน/หลัง (owner อนุญาต 2026-09-18, Bedrock จริงผ่าน profile `watchdog-bedrock`, corpus `cf9bce44…`, `--max-thb 60`, ใช้จริง THB 16.52): hit 8 → 16/22, routing/success เท่าเดิม, THB/successful −20.4%, calls/turn −41% → research doc §14 "R5 after-run"
- [x] Docs: spec W-05, W-06, W-07 tick ตามหลักฐาน; task memory

### H3. เคลียร์เครดิตที่กันไว้ค้าง — [spec แยก](../specs/line-ai-credit-hold-reconciliation-spec-th.md) (owner อนุมัติ 2026-09-18)

เริ่มหลัง H1 merge (ใช้คำว่า "เครดิต AI" และแตะไฟล์หน้าแอดมินชุดเดียวกัน) — **IMPLEMENTED + verified ในเครื่อง 2026-09-18**, ยังไม่ deploy

- [x] ชั้น 1 gateway: durable settle retry นอกเส้นทางคำขอ + graceful drain บน SIGTERM (J-01, J-02) — SHARED byte-identical: `ai-budget-durability.ts` (คิว + in-flight gauge ระดับโปรเซส), `ai-budget-shutdown.service.ts`, `main.ts` `enableShutdownHooks()`; ไม่มี envelope ⇒ ไม่แตะทั้งคิวและ gauge
- [x] ชั้น 2 API: `GET …/ai-credit-holds` (sweep แล้วอ่าน), actions release / charge_at_bound / acknowledge_breach พร้อม reason + audit + history; migration additive `20260918100000_ai_credit_hold_reconciliation` (`breachAcknowledgedAt/By` + ขยาย `usageBasis` CHECK), `AiUsageBasis` + `OPERATOR_CHARGED_AT_BOUND`, Thai error texts; pg spec `company-ai-credit-holds.pg.spec.ts` (J-03, J-04, J-07)
- [x] ชั้น 2 web: section "เครดิตที่กันไว้ค้าง" ในหน้า AI และโควตา + ประวัติ; [browser evidence](../qa/evidence/line-ai-credit-holds-2026-09-18/README.md) 12 subject × 1440/390 (J-05)
- [x] ชั้น 3: sweep `ai_credit_holds_unresolved` + config `AI_CREDIT_HOLD_ALERT_AFTER_HOURS` (default 24) บน reminder-sweep ตัวเดิม (J-06)
- [x] Docs: spec J-01…J-07 tick แล้ว; J-08 ยังเปิดรอ UAT; [ADR 0013 §14](../adr/0013-ai-budget-split-reservations.md#14-implementation-notes-h3); task memory
- [ ] ค้าง: ยังไม่มี platform role แบบ read-only จริง (shell gate เป็น role-based) — owner decision, บันทึกไว้ใน evidence README และ ADR §14

### H4. การตีความช่วงเวลา — [spec แยก](../specs/line-ai-period-resolution-spec-th.md) (owner decision 2026-09-18: default เดือนปัจจุบัน; ระบุช่วงเมื่อไหร่ต้องตามนั้น)

- [x] ตัวแปลช่วงเวลาใน `packages/contracts` (`periods` บน `LineAiValueCandidates`, ตาราง test ≥ 40 กรณี) (P-01)
- [x] Gateway: prompt เลือกจาก `periods` เท่านั้น; allowed dates/sanitizer รวม candidate; `periodKey`/`newUntil` whitelisted แบบมีหลักฐาน; เลน deterministic รับช่วงสัมพัทธ์ (P-02, P-03)
- [x] API tools: `tax.get_vat_summary` รับ `periodKey`; `crm.get_customer_summary` รับ `newUntil`; default เดือนปัจจุบันยืนยันทุก tool (P-04)
- [x] คำตอบระบุช่วง (คำ + วันที่) + telemetry `periodSource` (P-05)
- [x] Corpus ชุดช่วงเวลา (v2, 9 งาน) + Bedrock replay ในวงเงินที่เหลือ (P-06); P-07 หลัง UAT
- [x] Docs: spec P-01…P-06 tick ตามหลักฐาน; task memory

### H5. รอ owner (ไม่ทำใน wave นี้)

- concept เครดิต (หน่วย/เติม/ตรวจ/ค่า default ต่อแพ็กเกจ) — owner decision 3
- ตั้งเครดิตจริงให้บริษัท (spec §7: แชต 80 / อ่านเอกสาร 60 / รวม 140 บาท สำหรับร้านทดลอง) — การกระทำของแอดมินหลัง deploy

## 2. Verification matrix

| ช่วง | หลักฐานที่ต้องผ่าน |
| --- | --- |
| H1 | focused specs ของทุกไฟล์ที่แก้ + FULL api suite + FULL web suite + contracts + whole-chain runner + harness + typechecks + smoke script ที่แก้ (รันจริงถ้ารันได้ในเครื่อง) + browser evidence + `git diff --check`; guard: grep "งบ AI\|โควตา AI" ใน apps/packages/scripts = 0 (ยกเว้น allowlist ที่ระบุเหตุผล) |
| H2 | gateway FULL suite + security spec + whole-chain (gateway-behavior) + deploy.sh spec + pins + corpus replay (owner อนุญาตงบ ≈ THB 60–100 แล้ว 2026-09-18) |
| H3 | gateway FULL suite (retry/drain specs) + api FULL suite + pg spec ใหม่ใน ci.yml step P27/OCR + web FULL suite + whole-chain + harness + browser evidence |
| H4 | contracts FULL suite (resolver table) + gateway FULL suite + api FULL suite + whole-chain + harness + corpus replay (วงเงินที่เหลือจาก R5) |
| ทั้งสอง | merge develop ก่อน PR; CI เขียวทุก run ของ head; admin-merge develop + main |

Focused starting commands (ตรวจ path จริงตอน implement; ไม่เพิ่ม package script):

```sh
pnpm --filter @watchdog-bms/api exec tsx --test \
  src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts \
  src/modules/line-ai/application/use-cases/line-ai-combined-regression.spec.ts \
  src/modules/line-ai/domain/logic/line-business-card.logic.spec.ts \
  src/modules/line-ai/domain/logic/line-ai-formatter.logic.spec.ts \
  src/modules/billing/application/billing-financial.spec.ts \
  src/modules/system-partner-management/presentation/http/partner-support-tools.spec.ts
pnpm --filter @watchdog-bms/ai-gateway exec tsx --test \
  src/modules/line-ai/agents/prepared-simple-read-formatter.spec.ts \
  src/modules/line-ai/agents/prepared-simple-read-security.spec.ts \
  src/modules/line-ai/domain/logic/prepared-simple-read.logic.spec.ts \
  src/modules/line-ai/agents/response-composer.agent.spec.ts
node scripts/run-line-ai-whole-chain-acceptance.mjs
pnpm test:harness
bash infra/prod-ecs-express/production-serving-mode.spec.sh
node infra/security/sync-production-maintenance-release-pins.mjs --check
git diff --check
```

## 3. Handoff

**สถานะ 2026-09-18:** G0/H1/H2/H3 merge เข้า `develop` และ `main` ครบแล้ว (PR #622–#631 ยกเว้น #625/#629) W-01…W-08 และ J-01…J-07 มีหลักฐานแล้ว เหลือ W-09/J-08 ที่ต้อง UAT **ยังไม่ได้ deploy** รายละเอียดใน [Wave 2 delivery summary](../agent-memory/line-ai-credit-wording-wave2-2026-09-18.md#wave-2-delivery-summary-and-handoff--2026-09-18)

เสร็จเมื่อ W-01…W-08 และ J-01…J-07 มีหลักฐานและ merge แล้ว; W-09 หลัง deploy UAT ตาม runbook ทุกช่วงบันทึก commands/counts/SHA/ข้อจำกัดใน task memory
