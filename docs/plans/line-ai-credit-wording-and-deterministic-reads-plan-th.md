# แผนงาน: LINE AI wave 2 — "เครดิต AI", ข้อความอ่านเอกสาร และคำตอบ deterministic

- Spec: [line-ai-credit-wording-and-deterministic-reads-spec-th.md](../specs/line-ai-credit-wording-and-deterministic-reads-spec-th.md)
- Task memory: `docs/agent-memory/line-ai-credit-wording-wave2-2026-09-18.md`
- วิธีทำงาน: Opus 5 implement, Fable 5.1 คุม/ตรวจ bug-gap-impact, merge `develop` + `main` หลัง CI เขียว (เหมือน wave 1)
- Base: develop ≥ `e4702e23` (มี flag activation ON แล้ว, PR #622/#623)

## 1. ลำดับและขอบเขต

### H1. คำว่า "เครดิต AI" + ข้อความปฏิเสธการอ่านเอกสาร + billing hold warnings — spec §3, §4, §5

- [ ] ทำ mapping ครบทุกจุดที่ผู้ใช้/แอดมินอ่าน (LINE reply, Flex card, drain notice + integrity check, web dictionary, banking/CRM/expenses notices, partner console + adjustment history, timeline, ops alert, billing pages, browser smoke scripts) ตาม spec §3; ไม่แตะ code/enum/telemetry/ชื่อ field
- [ ] เส้นทางรูป: `aiBudgetReasonTh` + governance notice รวมเหตุฝั่งเงิน/จำนวนใบเป็น "เครดิตสำหรับการอ่านเอกสารไม่พอ"; unavailable/busy/disabled คงแยก; tail สถานะไฟล์เดิม; code/scope/class/count-refund เดิม (พิสูจน์ด้วย whole-chain + combined regression ที่แก้เฉพาะ expected text)
- [ ] เส้นทางแชต: การ์ด TOTAL/CHAT/insufficient และ drain notice ตาม §5.1
- [ ] Billing: `AI_CREDIT_HOLDS_PENDING` (additive) + `aiReservedSatang`/`aiUnresolvedHolds` (additive) + label; บริษัทไม่มี hold ผลเดิม; ไม่มีเงินไปหน้า owner
- [ ] Web: Thai error map/dictionary coverage spec ผ่าน; ไม่มี "งบ AI"/"โควตา AI" เหลือ (guard test แบบ grep ใน spec ที่ลงทะเบียนแล้ว)
- [ ] Browser evidence 1440/390: หน้าแอดมิน AI และโควตา, billing ใบเสร็จ/แพ็กเกจ (มี hold และไม่มี hold) → `docs/qa/evidence/line-ai-credit-wording-2026-09-18/`
- [ ] Docs: spec W-01…W-04, W-08 tick ตามหลักฐาน; task memory

### H2. Deterministic business reads (R5) — spec §6

- [x] หาเหตุที่ `text-read-daily-closing` พลาดเลนทั้งที่ family มี — เหตุคือแผนของ router เอง (ข้อความใน corpus ถามสองข้อ: checklist ปิดร้าน + ยังค้างจ่ายอะไร) ⇒ `not_simple` หรือ `no_simple_answer_shape`; pin ทุก variant ไว้ใน `prepared-simple-read.logic.spec.ts` พร้อม test ว่า read เดี่ยวยัง eligible และ F3 ยังตอบได้ → ไม่แก้ ไม่ลด security
- [x] เพิ่ม family: `tax.get_vat_summary::single_metric`, `inventory.list_low_stock::list`, `procurement.get_ap_outstanding::single_metric|list`, `crm.get_customer_summary::single_metric|list` — formatter + unit tests (F4–F7) + eligibility tests + security spec เดิมผ่านโดยไม่แก้ + `COMPILED_PREPARED_FAMILY_KEYS` (10 keys) + allowlist default ใน `deploy.sh` (ค่าเดียวกันทั้งสอง env) + pins re-sync
- [x] Grounded breakdown: tests ใน `response-composer.agent.spec.ts` (ผลต่าง/เปอร์เซ็นต์/ผลรวมย่อย/ค่าเฉลี่ย ถูกปฏิเสธ; คำตอบที่ไม่เพิ่มตัวเลขใหม่ผ่าน); ปิดช่องโหว่ "เลขไทย" ที่ทั้ง numeric guard และ polish guard มองไม่เห็น พร้อม test ทั้งสองทาง
- [x] แก้ comment ล้าสมัยใน `deploy.sh` ให้ตรงความจริง (parity default ON ทั้งสอง env ตั้งแต่ 2026-08-30); `production-serving-mode.spec.sh` pin ครบทั้ง 10 family
- [x] Corpus replay ก่อน/หลัง (owner อนุญาต 2026-09-18, Bedrock จริงผ่าน profile `watchdog-bedrock`, corpus `cf9bce44…`, `--max-thb 60`, ใช้จริง THB 16.52): hit 8 → 16/22, routing/success เท่าเดิม, THB/successful −20.4%, calls/turn −41% → research doc §14 "R5 after-run"
- [x] Docs: spec W-05, W-06, W-07 tick ตามหลักฐาน; task memory

### H3. รอ owner (ไม่ทำใน wave นี้)

- concept เครดิต (หน่วย/เติม/ตรวจ/ค่า default ต่อแพ็กเกจ) — owner decision 3
- หน้าจัดการเงินที่กันไว้ค้าง (`UNRESOLVED`/breach) — รอ owner ยืนยันข้อเสนอ 3 ชั้น (auto-recover จาก gateway log → admin console → alert)
- ตั้งเครดิตจริงให้บริษัท (§7: แชต 80 / อ่านเอกสาร 60 / รวม 140 บาท สำหรับร้านทดลอง) — การกระทำของแอดมินหลัง deploy

## 2. Verification matrix

| ช่วง | หลักฐานที่ต้องผ่าน |
| --- | --- |
| H1 | focused specs ของทุกไฟล์ที่แก้ + FULL api suite + FULL web suite + contracts + whole-chain runner + harness + typechecks + smoke script ที่แก้ (รันจริงถ้ารันได้ในเครื่อง) + browser evidence + `git diff --check`; guard: grep "งบ AI\|โควตา AI" ใน apps/packages/scripts = 0 (ยกเว้น allowlist ที่ระบุเหตุผล) |
| H2 | gateway FULL suite + security spec + whole-chain (gateway-behavior) + deploy.sh spec + pins + corpus replay (เมื่ออนุญาต) |
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

เสร็จเมื่อ W-01…W-06, W-08 มีหลักฐานและ merge แล้ว; W-07 เมื่อ corpus replay ได้รับอนุญาตและรัน; W-09 หลัง deploy UAT ตาม runbook ทุกช่วงบันทึก commands/counts/SHA/ข้อจำกัดใน task memory
