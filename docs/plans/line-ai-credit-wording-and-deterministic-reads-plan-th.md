# แผนงาน: LINE AI wave 2 — "เครดิต AI", ข้อความอ่านเอกสาร และคำตอบ deterministic

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

- [ ] หาเหตุที่ `text-read-daily-closing` พลาดเลนทั้งที่ family มี (eligibility reason จาก `prepared-simple-read.logic.ts`) และแก้ให้ผ่านโดยไม่ลด security
- [ ] เพิ่ม family: ภาษี/VAT, สินค้าใกล้หมด, เจ้าหนี้ค้างจ่าย, ลูกค้าใหม่ CRM (ชื่อ tool::shape จริงจาก registry) — formatter + unit tests + security spec เดิมผ่าน + `COMPILED_PREPARED_FAMILY_KEYS` + allowlist default ใน `deploy.sh` (UAT/Production เท่ากัน) + pins re-sync
- [ ] Grounded breakdown: test ใน `response-composer.agent.spec.ts` ว่าตัวเลขที่โมเดลคำนวณเอง (ผลต่าง/เปอร์เซ็นต์/ผลรวมที่ tool ไม่ให้) ถูกปฏิเสธ → fallback grounded; คำแนะนำไม่มีตัวเลขใหม่ผ่าน; ถ้าพบช่องโหว่ในการ์ด ให้ปิดพร้อม test
- [ ] แก้ comment ล้าสมัยใน `deploy.sh` ("production still refuses…") ให้ตรงความจริง; ยืนยัน `production-serving-mode.spec.sh` ครอบ family ใหม่
- [ ] Corpus replay ก่อน/หลัง (Bedrock จริง, รอ owner อนุญาตงบ; harness เดิม, corpus `cf9bce44…`, spend guard) → research doc ส่วนใหม่ "R5 after-run"; ถ้ายังไม่อนุญาต ให้บันทึกว่า W-07 รอ
- [ ] Docs: spec W-05, W-06 (unit), W-07 (corpus) tick ตามหลักฐาน; task memory

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
