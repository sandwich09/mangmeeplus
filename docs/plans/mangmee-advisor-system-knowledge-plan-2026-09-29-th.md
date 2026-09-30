# แผน: น้องมั่งมีที่ปรึกษา — ตอบเรื่องร้านและระบบ

สเปก: [mangmee-advisor-system-knowledge-2026-09-29-th.md](../specs/mangmee-advisor-system-knowledge-2026-09-29-th.md) · เอกสารคู่: [ข้อเสนอขยายหมวดค่าใช้จ่าย](../specs/mangmee-expense-category-expansion-2026-09-29-th.md)
วันที่: 2026-09-29 · สถานะ: **R1 เริ่ม implement 2026-09-30** · อัปเดต 2026-09-29: รวมมติ Owner ว่าโมดูลยอดขายและสต็อกยังพัฒนาไม่เสร็จ (§1.1) · อัปเดต 2026-09-30: ตรวจกับโค้ดหลังงาน #903–#928 และรวมมติ Owner 2026-09-30 (สเปก §10 ข้อ 1–4, 9–11) · อัปเดต 2026-09-30 รอบสอง: Q1 คงทางลัดเดิม (S1), ยืนยันกองกลาง (S3), เพิ่ม S8 งานตายตัวใน R1 (ปุ่มตามสิทธิ์ซื้อ ลิงก์หน้ารายชื่อพนักงาน การ์ดคำถามนโยบาย) และ S2b ออกพร้อมการเปิดขายเครดิต add-on · อัปเดต 2026-09-30 รอบสาม: มติ Owner สเปก §10 ข้อ 5–7 (ข้อมูลติดต่อพนักงาน ขอบเขตสาขา S5/S6) และข้อ 11 (ทำทีละชุด งบ R1 ไม่เกิน 800 บาท)
ฐานโค้ดที่ตรวจ: `origin/develop` `05f7f675`
บันทึกงาน: `docs/agent-memory/mangmee-advisor-system-knowledge-2026-09-29.md` (สร้าง 2026-09-30 ตอนเริ่ม R1 ตาม AGENTS.md)

## 0. กติการ่วมทุก slice

- **ขอบเขตระหว่างแอป:** AI Gateway เรียกเครื่องมือของ API ที่ตรวจสิทธิ์แล้วเท่านั้น ห้ามอ่านฐานข้อมูลหรือ repository เอง (AGENTS.md)
- **ขนาดงาน:** ponytail full — diff สั้นที่สุด ใช้ pattern เดิม ไม่เพิ่ม dependency และห้ามแก้ `package.json`
- **ไม่มีสวิตช์:** ไม่เพิ่ม flag หรือ env ไม่เพิ่ม family ใน `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES` และไม่ปิดฟีเจอร์ด้วย config (สเปก §2.8)
- **วิธีทำงาน (คำสั่ง Owner 2026-09-19):**
  - ผู้คุมเขียน brief ตรวจ diff ทุกชิ้น รัน eval กับโมเดลจริง push เปิด PR และสื่อสารกับ Owner
  - ผู้ทำเป็น subagent หนึ่งงานต่อหนึ่ง worktree ห้ามสอง agent แก้ไฟล์เดียวกันพร้อมกัน
- **ไฟล์ใหญ่ที่หลายงานแตะ:** ตรวจก่อนทุกครั้งว่าไม่มีงานอื่นกำลังแก้
  - `process-line-webhook.use-case.ts`, `semantic-turn-v2.ts`, `intent-router.agent.ts`, `line-ai-scope-policy.logic.ts`, `ai-tools.ts`, `mangmee-persona.ts`
- **การตรวจในเครื่อง (คำสั่ง Owner 2026-09-21):**
  - typecheck ของ package ที่แตะ (`pnpm --filter @watchdog-bms/contracts typecheck`, `pnpm --filter @watchdog-bms/api typecheck` ซึ่งตั้ง heap ไว้แล้ว, `pnpm --filter @watchdog-bms/ai-gateway typecheck`)
  - boot และ unit spec ที่แตะ
  - PG spec และชุดใหญ่ให้ CI รันตอน merge
  - งานหนักต้องถือ lock `/tmp/mangmee-heavy.lock` แบบ mkdir แล้วปล่อยในคำสั่งเดียวกัน
  - หลัง merge develop เข้า worktree ให้รัน `prisma generate`
- **ก่อน push งาน LINE-AI:** รัน `node scripts/run-line-ai-whole-chain-acceptance.mjs`
- **ลงทะเบียน spec ใหม่** ใน `scripts/line-ai-whole-chain-acceptance.catalog.mjs` ไม่ใช่ `package.json`
  - `reliability-api-v2` สำหรับ API
  - `reliability-gateway-v2` สำหรับ gateway
  - `reliability-postgres-v2` สำหรับ PG
- **W00:** slice ที่แตะไฟล์ที่ manifest เก็บ hash ต้อง regenerate manifest (§2 ข้อ 9) และ commit ไฟล์ JSON ใน PR เดียวกัน
  - รายการไฟล์อยู่ใน `SOURCE_REFERENCES` (`apps/api/src/modules/line-ai/line-ai-capability-manifest.ts:218-246`) เช่น registry, controller, module, config, webhook, `packages/contracts/src/line-ai.ts`, `line-read-evidence.service.ts`, `line-reimbursement-draft.service.ts`, `line-preference-command.logic.ts` และ `ReimbursementDraftActionPage.tsx`
  - ทุก slice ที่เพิ่มเครื่องมือแตะ registry จึงต้อง regenerate เสมอ
- **ทดสอบกับโมเดลจริงก่อน merge:** ตามสเปก §9 เก็บหลักฐานไว้ใน `docs/research/mangmee-advisor-eval-<slice>-2026-..-th.md` พร้อม evidence JSON แบบโปรแกรมรายจ่าย
  - มติ Owner 2026-09-30 (สเปก §10 ข้อ 11): "รันทดสอบก่อนดีกว่า ทำเป็นชุดๆ" — ทำและทดสอบทีละชุดตาม release เริ่ม R1 วันนี้ งบทดสอบกับโมเดลจริงของ R1 ไม่เกิน 800 บาท สำหรับ S0, S2a, S1 และ S3 (S8 ไม่ใช้) ติดตามยอดจริงหลังแต่ละ slice (§8)
- **Merge:**
  - PR เข้า develop ทีละ slice
  - รวม slice เป็น release แล้วเปิด PR เข้า main จาก branch ที่แตกจาก main
  - deploy แยกจาก merge (§6)

## 1. ลำดับ slice

เรียงตามคุณค่าต่อ Owner เทียบกับแรงที่ใช้และสิ่งที่ต้องรอ:

| ลำดับ | Slice | ปิดคำถาม (สเปก §4) | คุณค่า | ขนาด | ต้องรอ | Release |
|---|---|---|---|---|---|---|
| 1 | **S0** นโยบายความรู้ทั่วไป (วัดแล้วแก้เฉพาะข้อที่ไม่ผ่าน) | G1–G8 | สูง (กระทบทุกคำตอบ) | เล็ก 0.5 วัน | — (D1 เสร็จแล้ว) | R1 |
| 2 | **S2a** แพ็กเกจและโควตาใบเสร็จ | #1, P1–P4, P8, P9 | สูงมาก | กลาง 2.5–3.5 วัน | — | R1 |
| 3 | **S1** ใบรับรองที่ต้องเซ็น + งานค้างของฉัน | #7, Q2, S1–S3 (Q1 คงทางลัดเดิม) | สูง | กลาง 2.5–3.5 วัน | — (D1 เสร็จแล้ว) | R1 |
| 4 | **S3** ใบเบิกค้างที่ใคร | #5, R1–R4 | สูง | กลาง 2–2.5 วัน | — | R1 |
| — | **S8** ปุ่มและลิงก์ในการ์ด LINE (งานตายตัว ทำคู่ขนานได้) | กติกาปุ่มซื้อ (ค), ลิงก์หน้ารายชื่อพนักงาน (จ), การ์ดคำถามนโยบาย (ฉ) | กลาง | เล็ก 1–1.5 วัน | — | R1 |
| 5 | **S2b** เครดิต AI คงเหลือ | #2, P5 | สูงมาก | เล็กถึงกลาง 1–2 วัน หลัง D2 | D2, D3 (Owner ให้ออกพร้อมการเปิดขายเครดิต add-on §4) | R2 (ออกพร้อม add-on) |
| 6 | **S5** คู่ค้า | #6, V1–V5 | กลาง | เล็ก 1–1.5 วัน | สเปก §11 ข้อ 19 (ถาม Owner ก่อน R3) และข้อ 21 | R3 |
| 7 | **S6** สมาชิกและข้อมูลที่ขาด | #4, M1–M4 | กลาง | เล็กถึงกลาง 1.5–2 วัน | สเปก §11 ข้อ 20 (มติ §10 ข้อ 5–7 ได้แล้ว 2026-09-30) | R3 |
| 8 | **S4a** รายจ่ายผิดปกติ | #3, E1–E5 | สูง | ใหญ่ 4–6 วัน | สเปก §10 ข้อ 8 | R4 |
| 9 | **S4b** ภาษีซื้อพร้อมขอคืน | T1–T2 | กลางถึงสูง | กลาง 2–3 วัน | สเปก §11 ข้อ 10 | R4 |
| 10 | **S7** คู่มือระบบเรื่องใหม่ | H3–H5, P7 | กลาง | กลาง 2–3 วัน + เวลา Owner อ่าน | สเปก §10 ข้อ 12; H4 รอ add-on เปิดขาย | R3/R4 |

เหตุผลของลำดับ:

- **S0 เล็กลง:** #910 และ #916 ใส่กติกาความรู้ทั่วไปส่วนใหญ่แล้ว S0 เหลือการวัดชุด G และแก้เฉพาะข้อที่ไม่ผ่าน
- **S2a มาก่อน:** ตอบตัวอย่าง Owner สองข้อ (#1 และส่วนแพ็กเกจของ #2) มีผลเชิงธุรกิจ และไม่ต้องรอใคร
- **คิวลายเซ็นกับคิวอนุมัติ (S1, S3):** เป็นงานที่ใช้ทุกวัน
- **S8 อยู่ใน R1:** Owner สั่ง "รอรวมกับรอบแรกของแผน" เป็นงานตายตัวที่ไม่ผ่านโมเดล จึงใช้ unit spec พอ ไม่ใช้งบทดสอบกับโมเดลจริง
- **เครดิต (S2b):** ต้องรอตัวคำนวณยอดตัวเดียวกับแผน add-on และ ledger เครดิตยังไม่ทำงานกับร้านใด (§4 D2)
- **เครื่องมือรายชื่อ (S5, S6):** เล็กและตามมาได้เร็ว
- **รายจ่ายผิดปกติ (S4a):** ใหญ่ที่สุดและต้องให้ Owner อนุมัติเกณฑ์ก่อน จึงไว้ท้าย
- **ข้อเสนอขยายหมวดค่าใช้จ่าย:** เอกสารคู่ ทำให้ S4a และการแยกยอดคมขึ้น ถ้าทำก่อน S4a ต้องใช้กติกา "หมวดที่เพิ่งสร้าง" ใน §3 S4a

### 1.1 อนาคต — หลังโมดูลยอดขายและสต็อกเปิดใช้ (ไม่มี slice ในแผนนี้)

Owner 2026-09-29: "ยอดขาย สต็อก เรายัง dev ไม่เสร็จเลย ไม่อยู่ในแพ็กเกจถูกแล้ว"

- **คำถามข้อมูลร้านเรื่องยอดขาย ลูกหนี้ ใบแจ้งหนี้ สต็อก และกำไร** (สเปก §4.12 F1–F4) ไม่อยู่ใน slice ใด และไม่มีประมาณการเวลาในแผนนี้
- **วันนี้:**
  - ตอบด้วยข้อความคงที่เดิมของ `scopePolicyOverride` ซึ่ง **คงไว้ตามเดิม** หรือด้วยการปฏิเสธแบบ feature_disabled เดิมเมื่อข้อความไม่มีคำสำคัญ
  - หลัง #910 router ยังจัดคำถามตัวเลขของร้านในโมดูลนี้เป็น kind `read` (`intent-router.agent.ts:484`) และ `ANSWER_PROMPT` อาจตอบบรรทัด "แพ็กเกจยังไม่มีข้อมูลนี้ของร้าน" แทน ซึ่งไม่ชวนซื้อ
  - ไม่เรียกเครื่องมือ และไม่มีคำชวนซื้อหรืออัปเกรด
  - S0 ตรวจเรื่องนี้ด้วยชุด G-04, G-05 และ G-09
- **เมื่อโมดูลเปิดใช้:** เปิดงานแยก
  - ตรวจความพร้อมของเครื่องมือที่ลงทะเบียนไว้แล้ว (`sales.get_sales_summary`, `accounting.*`, `inventory.*`) กับโมดูลที่เปิดจริง
  - เขียนชุดทดสอบของตัวเอง
  - ทบทวนการลงบัญชีวัตถุดิบในข้อเสนอขยายหมวด (B1)
- **โมดูลอื่นที่ยืนยันไม่ได้ว่าเสร็จและเปิดใช้** (`thai_tax`, `double_entry_ledger`, `reports`, `crm`, `procurement`, `bank_reconciliation`, `workflow_automation`, `wht_pnd53`/`wht_50bis`) ถือเป็น **ต้องตรวจสอบ** (สเปก §2.2, §11 ข้อ 15) ไม่มี slice ใดพึ่งโมดูลเหล่านี้

## 2. เช็กลิสต์การเพิ่มเครื่องมืออ่านหนึ่งตัว (ใช้ทุก slice)

1. **Contracts:** เพิ่ม entry ใน `LINE_TOOL_REGISTRY` (`packages/contracts/src/ai-tools.ts`) ตาม §3 ถ้ามีกลุ่มความสามารถใหม่ให้เพิ่มใน `LINE_CAPABILITY_GROUPS`
2. **API domain:** เพิ่ม use case อ่านอย่างเดียวในโมดูลเจ้าของข้อมูล แล้ว export จาก `*.module.ts` ของโมดูลนั้น
3. **API adapter:** เพิ่ม class ที่ implement `ErpReadToolPort` ใน `apps/api/src/modules/line-ai/application/use-cases/erp-*-tools.use-case.ts` โดยตรวจสิทธิ์ซ้ำ และคืน `sourceRefs` พร้อม `webPath`, `accessScope` และ `facts`
   - `sourceRefs` ตัวแรกคือลิงก์ที่ลูกค้าเห็น (สเปก §2.7) และเครื่องมือที่รับช่วงเวลาต้องคืน `queryApplied.period` (สเปก §5.0)
   - ถ้าต้องใช้บทบาทของผู้ถาม (เช่น การอนุมัติของตัวเอง) ห้ามใช้ `toCtx` ใน `erp-tools.use-case.ts:34-46` ซึ่งตั้ง `roles: []` และ `authProvider: 'watchdog'` ให้ส่ง `ctx.roles` ที่ controller ใส่มา (`internal-tools.controller.ts:456`)
4. **DI:**
   - `apps/api/src/modules/line-ai/line-ai.module.ts` (`erpTools`, `:151`)
   - `apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.ts` (constructor + `toolMap.set`)
5. **หลักฐานการอ่านและความจำ:** `isLineEvidenceRead` (`line-read-evidence.service.ts:310`) ครอบคลุมทุก read category อยู่แล้ว แต่ผลต้องอ่านซ้ำได้ค่าเดิม (สเปก §5.0)
   - เครื่องมือที่คืนรายการซึ่งผู้ใช้อาจอ้างถึงต่อ ต้องเพิ่มใน `READ_MEMORY_TOOLS` และ `READ_MEMORY_ANSWER_SHAPE` (`line-read-evidence.service.ts:58-72`) ไม่อย่างนั้น `shownItems` ไม่ถูกเก็บ (สเปก §6.5)
6. **Gateway:**
   - `ROUTER_ENABLED_TOOLS` (`apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts:110`)
   - `ALLOWED_TOOLS` (`apps/ai-gateway/src/modules/line-ai/agents/accounting-summary.agent.ts:13`) และป้ายภาษาไทยใน `TOOL_FACT_LABELS` (`:74`) เพราะเมื่อไม่มีป้าย ทางสำรองใช้ชื่อเครื่องมือเป็นป้าย (`:275`, `:293`, `:467-471`) ซึ่งเป็นรหัสเครื่อง
   - แถว coverage หนึ่งแถวต่อเครื่องมือ (`line-ai-feature-coverage.ts` ซึ่ง spec บังคับให้ทุก registry tool อยู่ครั้งเดียว)
   - ข้อความกลุ่มความสามารถ TH/EN (`CAPABILITY_COPY` ใน `response-composer.agent.ts:122`) ถ้าเพิ่มกลุ่ม
   - ชื่อหน้าภาษาไทยใน `APP_PAGE_TH` (`mangmee-persona.ts:85`) สำหรับหน้าเว็บของเครื่องมือที่ไม่ใช่ `expenses` หรือ `reimbursements` ไม่อย่างนั้น path ในข้อความจะกลายเป็น "หน้าเว็บของบริษัท" (สเปก §2.7)
7. **กติกา router และ compose:**
   - `CONTROL_PROMPT` และ `ANSWER_PROMPT` (`semantic-turn-v2.ts:82`, `:94`) รวมถึง prompt ระบบของ router (`intent-router.agent.ts`)
   - ถ้าคำถามทับกับทางลัด simple read เดิม (`intent-router.agent.ts:485`) ต้องแก้กติกาตรงนั้นด้วย เพราะทางลัดไม่ผ่าน `CONTROL_PROMPT`
   - รวมการแก้ prompt ต่อ release เพราะทุกการแก้ทำให้แคชของ router และ compose ต้องเขียนใหม่
8. **ชื่อที่ใช้กรอง** (`search`) ต้อง ground กับข้อความผู้ใช้ด้วย `nameFilterGroundedInText` (`read-tool-input.ts:58`)
9. **W00:** `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts` แล้ว commit `docs/research/mangmee-ai-capability-manifest-2026-09-27.json`
10. **Spec + ลงทะเบียนใน catalog**
11. **Typecheck** สาม package
12. **Whole-chain acceptance**
13. **Eval กับโมเดลจริง** ต้องผ่านสองรอบติดกัน (สเปก §9)
14. **บันทึกงานและเปิด PR เข้า develop**

**Answer family ของเครื่องมือใหม่ทุกตัว:** ทางปกติ (compose + grounding) ไม่เพิ่ม `tool::shape` ใน deterministic families (สเปก §2.8)

## 3. รายละเอียดแต่ละ slice

### S0 — นโยบายความรู้ทั่วไป: วัดชุด G บนโค้ดปัจจุบัน แล้วแก้เฉพาะข้อที่ไม่ผ่าน

- **ปิด:** ชั้น ก ง ฉ ในสเปก §2.1 ไม่มีเครื่องมือใหม่
- **สิ่งที่ #910 และ #916 ทำไว้แล้ว (D1 เสร็จ):**
  - `scopePolicyOverride` ไม่บล็อก kind `help` และ `general` (`line-ai-scope-policy.logic.ts:225`) คำถามความรู้เรื่องยอดขาย กำไร เงินเดือน หรือ VAT จึงถึงโมเดล
  - `ANSWER_PROMPT` (`semantic-turn-v2.ts:94`) ตอบความรู้ธุรกิจทั่วไปเสมอไม่ว่าแพ็กเกจหรือสิทธิ์ ยาวหนึ่งประโยคกับไม่เกิน 3 bullet และคำแนะนำปิดท้ายด้วยหนึ่งบรรทัดให้ยืนยันกับนักบัญชี กรมสรรพากร หรือสำนักงานประกันสังคม
  - คำถามนอกธุรกิจตอบไม่เกิน 2 บรรทัด แล้วหนึ่งบรรทัดชวนกลับเรื่องร้าน และ `approvedHelp` ไม่จำกัดหัวข้อที่อธิบายได้
  - `reasonCode` ที่ผิดรูปถูกตัดทิ้งแทนการทิ้งคำตอบที่ถูก (`semantic-turn-v2.ts:976`)
  - router จัดคำถามตัวเลขของร้านในโมดูลที่ไม่ได้ซื้อเป็น `read` จึงยังได้ข้อความคงที่เดิม (`intent-router.agent.ts:484`)
  - #916: ผู้อ่านเอกสารใช้ persona เดียวกัน และ "ข้อมูล ณ" ใช้วันตามเวลาไทย
- **ขั้นแรกคือวัด:** รันชุด G (สเปก §9.2) บนโค้ดปัจจุบัน และแก้เฉพาะข้อที่ไม่ผ่าน ข้อที่น่าจะต้องดู:
  - หมายเหตุด้านแรงงาน (G-03): prompt ระบุแค่สำนักงานประกันสังคม ยังไม่ระบุกรมสวัสดิการและคุ้มครองแรงงาน
  - ชวนกลับจากเรื่องนอกธุรกิจ (G-06): ตัวอย่างใน prompt เป็นประโยคกลาง ("ถ้ามีเรื่องร้านหรือรายจ่ายให้ช่วย") ยังไม่ผูกกับความสามารถของผู้ถาม ถ้าไม่ผ่านให้ใช้ `approvedHelp` (`buildCapabilityHelp`)
  - ข้อมูลปัจจุบัน (G-07): ห้ามแต่งแหล่งอ้างอิง
  - ห้ามชวนซื้อหรืออัปเกรดเรื่องยอดขาย สต็อก และโมดูลที่ยังไม่เปิดใช้ (สเปก §6.2): ถ้าชุด G-04, G-05 หรือ G-09 พบคำชวน ให้เพิ่มกติกาใน `ANSWER_PROMPT`
- **ไม่ต้องแตะ `line-ai-scope-policy.logic.ts` ใน S0** (#910 แก้ส่วนที่ต้องแก้แล้ว) และข้อความคงที่ `unsoldModuleReplyText` ต้องคงไว้ตามเดิม (Owner 2026-09-29)
- **Specs:** `mangmee-persona.spec.ts` (ถ้าแก้ copy), `semantic-turn-v2-grounding.spec.ts` (หมายเหตุต้องไม่พาตัวเลขใหม่เข้ามา)
- **W00:** รัน manifest spec เพื่อยืนยันว่าไม่มีไฟล์ที่ถูก hash เปลี่ยน
- **Eval:** ชุด G อย่างน้อย 20 ข้อ × 2 รอบ ประมาณ 50–100 บาท
- **ต้นทุนต่อข้อความ:** 0.4–0.7 บาท (ไม่อ่านข้อมูล)
- **ขนาด:** 0.5 วัน ส่วนใหญ่เป็นการรัน eval (เดิม 0.5–1 วัน ก่อน #910)

### S2a — แพ็กเกจและโควตาใบเสร็จ

- **ปิด:** #1, P1–P4, P8, P9
- **มติ Owner 2026-09-30 ที่ใช้ (สเปก §10):**
  - ข้อ 1: บอกจำนวนใบเสร็จคงเหลือและวันที่ใช้ได้ถึงได้ ไม่บอกราคา
  - ข้อ 2: เฉพาะผู้มีสิทธิ์ `company.plan.manage` ใช้การตรวจสิทธิ์เดิม คนอื่นได้ข้อความ P8
  - ข้อ 3: หักเครดิตตามปกติ ไม่ทำทางตอบฟรี
  - ข้อ 4 และ 4 ข: คาดการณ์ว่าพอหรือขาดกี่ใบจากอัตราการใช้รอบนี้ ห้ามเอ่ยชื่อหรือแนะนำแพ็กเกจอื่น ห้ามชวนอัปเกรด
- **Endpoint ที่มีอยู่วันนี้ (ตรวจ 2026-09-30):**
  - ลูกค้า: `GET companies/:cid/billing` (`billing.controller.ts:579`) และ `…/capacity` (`:629`) ผ่าน guard `account.session.read` บวก `assertOwner` ใน service
    - `…/capacity` ล็อกแถวบริษัท `FOR UPDATE` และหน้าแพ็กเกจไม่แสดงจำนวนสาขาและสมาชิกที่ใช้อยู่
  - `GET plan-term/notice` (`plan-term.controller.ts:23`) สมาชิกทุกคนเรียกได้ คืนสถานะ วันหมดอายุ และ `canManagePlan` ไม่มีโควตา
  - แอดมิน: `GET system/billing/companies/:id` (`billing.controller.ts:482`) คืน usage และ `partner.controller.ts:595` คืนการใช้ AI
  - ไม่มี endpoint ลูกค้าที่คืนยอดเครดิต AI และไม่มีเครื่องมือ LINE ที่อ่าน billing
  - เครื่องมือใหม่จึงเรียก service ที่อ่าน DB อย่างเดียวโดยตรง ไม่เรียก endpoint เหล่านี้
- **API:**
  - ใหม่ `apps/api/src/modules/line-ai/domain/logic/package-usage-pace.logic.ts` เป็น pure function สูตร `package-pace-v1` (สเปก §5.1) ใช้ civil-date helper เดิม
  - ใหม่ `apps/api/src/modules/line-ai/application/use-cases/erp-package-tools.use-case.ts` → `BillingGetPackageUsageTool`
    - แพ็กเกจ: `CompanyPlanTerm` (`tierKey`, `termEndsAt`) ชื่อใช้ `billingPlanLabel(term.tierKey)` (`packages/contracts/src/billing-labels.ts:43`) เพดานใช้ `effectivePlanCapacity` (`apps/api/src/modules/system-partner-management/domain/logic/plan-capacity.ts:22`) ไม่ใช้ค่า preset
    - รูปแบบต่ออายุ: `BillingService.account()` (อ่าน DB อย่างเดียว, `billing.service.ts:172-177`; `BillingModule` ถูก import อยู่แล้วที่ `line-ai.module.ts:243`) แล้วแปลงแบบเดียวกับหน้าเว็บ (`billing.service.ts:876`, `:1000`)
    - จำนวนสาขาและสมาชิกที่ใช้อยู่: `billing-capacity.ts` ไม่มีฟังก์ชันนับให้ใช้ การนับจริงอยู่ใน `plan-term-limit.ts:38`, `:52-54` และมีสำเนาอีกหลายที่
      - แยกเป็น helper เดียวแล้วให้ที่เดิมเรียก helper นั้นในงานเดียวกัน (เพิ่มประมาณครึ่งวัน)
      - ห้ามเรียก `BillingService.capacity()` เพราะล็อกแถวบริษัทและเรียก `assertOwner`
    - ใบเสร็จ: `BillingService.usage(companyId)` (`billing.service.ts:213-219`) ซึ่งอ่าน DB อย่างเดียว ไม่ตรวจเจ้าของ และเป็นตัวเลขเดียวกับหน้าแพ็กเกจ
      - รอบของ `PAID_GRANTS` ต้องอ่าน `BillingReceiptGrant.serviceStart/serviceEnd` (`schema.prisma:10040-10041`) ของ lot ที่กำลังใช้ ซึ่งวันนี้ยังไม่ถูก select
    - ตรวจ `company.plan.manage` ในเครื่องมือ ไม่มี → `forbidden` พร้อม `errorCode: 'PACKAGE_MANAGER_REQUIRED'` (สิทธิ์เดียวกับ `canManagePlan` สเปก §5.1)
    - ห้ามเรียก `BillingService.status()`
  - DI: `line-ai.module.ts` + `internal-tools.controller.ts`
- **ToolMeta:**

```ts
{
  name: 'billing.get_package_usage',
  description: "Read THIS company's current package: the package name, the date it runs until, branch and member capacity used, and receipt reads used/limit/remaining in the current allowance with an API-computed straight-line projection to its end (and, once available, remaining AI credit). Only a caller who manages the package gets figures; anyone else gets a typed refusal. Never prices and never another package. Use for 'is my package enough', 'how many receipts are left', 'can I add a branch', 'how much AI credit is left'. Public package prices and package contents are not this tool.",
  businessSubjects: ['company', 'expense'],
  questionKinds: ['summary'],
  category: 'read_summary',
  // Offered to every assistant user so a non-manager reaches the typed PACKAGE_MANAGER_REQUIRED refusal
  // (owner decision 2026-09-30 §10 item 2); the tool itself checks company.plan.manage, the same
  // permission canManagePlan/assertOwner use. Same pattern as public.lookup.
  requiredPermissions: ['ai.tool.invoke'],
  // `billing` is deliberately absent from TOOL_MODULE_FEATURE_KEYS: every company that reaches the
  // assistant has a working package (locked companies are answered before any AI turn).
  sourceModule: 'billing',
  supportedAgents: ['accounting', 'general'],
  sensitiveAudit: true,
  requiresErpPermissionCheck: true,
},
```

- **Gateway:**
  - `ROUTER_ENABLED_TOOLS`, `ALLOWED_TOOLS`
  - แถว coverage `{ id: 'package_usage', feature: 'Package, receipt quota and AI credit status', status: 'covered', questionKinds: ['summary'], tools: tools('billing.get_package_usage'), requiredPermissions: ['company.plan.manage'], sourceModule: 'billing' }`
  - `LINE_CAPABILITY_GROUPS` เพิ่ม `{ id: 'package', featureKeys: [], sourceModules: ['billing'] }` และข้อความ TH `{ line: '• แพ็กเกจและใบเสร็จคงเหลือ', example: 'แพ็กเกจนี้พอไหม' }` (EN คู่กัน)
    - เมื่อเครื่องมือถูกเสนอให้ทุกคน `usableCapabilityGroupIds` (`ai-tools.ts`) จะแสดงกลุ่มนี้กับทุกคนด้วย ต้องจำกัดให้แสดงเฉพาะผู้มี `company.plan.manage`
  - `PACKAGE_MANAGER_REQUIRED`: แปลงเป็นข้อความคงที่ P8 แบบเดียวกับ `REIMBURSEMENT_APPROVAL_NOT_PERMITTED` (`business-read-result-semantics.ts:152`, forced outcome ที่ `semantic-turn-v2.ts:866`, `:1054-1058`)
    - `business-read-result-semantics.ts`: ค่าคงที่และข้อความ
    - `semantic-turn-v2.ts`: forced outcome
    - `prepared-simple-read-formatter.ts`: ถ้าทางลัดเจอ (`:1174`)
  - ชื่อหน้า `billing` ใน `APP_PAGE_TH` ("หน้าแพ็กเกจบนเว็บ") และ `sourceRefs[0].webPath` ชี้ `/companies/{id}/billing`
  - `CONTROL_PROMPT`: "For THIS company's package, receipt quota, capacity or AI credit, call billing.get_package_usage; when the question also refers to expense volume, add expense.list_recent for the same current period. Public package prices or contents are never this tool."
  - `ANSWER_PROMPT`: ห้ามราคา ห้ามเอ่ยชื่อหรือแนะนำแพ็กเกจอื่นและห้ามชวนอัปเกรด (มติข้อ 4) คาดการณ์ต้องใช้ค่า `pace` ของเครื่องมือพร้อมคำว่า "คาดการณ์" และบอกได้แค่ว่าน่าจะพอหรือขาดประมาณกี่ใบ
  - คำถามเรื่องอัปเกรดหรือเปลี่ยนแพ็กเกจ (P9) ใช้กติกางานบนเว็บเดิม และเรียก `billing.get_package_usage` ด้วยเพื่อให้ API ตัดสินสิทธิ์ซื้อ: ผู้มีสิทธิ์ได้ลิงก์หน้าแพ็กเกจจาก `sourceRefs` คนอื่นได้ข้อความ P8 ไม่มีลิงก์หรือปุ่ม (กติกาปุ่มซื้อ สเปก §2.2)
- **W00:** regenerate
- **Specs:**
  - `package-usage-pace.logic.spec.ts`: เกณฑ์ 7 วัน, ไม่จำกัด, shortfall 0, การปัดขึ้น, ความยาวเดือน, รอบแบบ `PAID_GRANTS`, หลาย lot ซ้อนกัน → `null`
  - `erp-package-tools.use-case.spec.ts`
    - forbidden พร้อม `PACKAGE_MANAGER_REQUIRED` เมื่อไม่มีสิทธิ์ และไม่มีตัวเลขใดในผล
    - ไม่มี field ราคาและชื่อแพ็กเกจอื่น
    - อ่านสองครั้งได้ `lineReadResultHash` เท่ากัน
    - แปลง `LEGACY_MONTH` กับ `PAID_GRANTS` ถูก และชื่อแพ็กเกจมาจาก `term.tierKey` แม้มีของขวัญชั่วคราว
  - spec ของ helper นับสาขาและสมาชิก และ spec เดิมของที่ที่เปลี่ยนไปเรียก helper ต้องผ่านเหมือนเดิม
  - PG `apps/api/src/modules/line-ai/application/package-usage.pg.spec.ts`: ใช้แถวจริงของโควตา รวมยอดแถมและ lot แบบ `PAID_GRANTS` และนับสาขากับสมาชิก → `reliability-postgres-v2`
- **Eval:** ชุด P อย่างน้อย 20 ข้อ × 2 ประมาณ 150–250 บาท
- **ต้นทุนต่อข้อความ:** 0.9–1.3 บาท (อ่าน 1–2 ครั้ง)
- **ขนาด:** 2.5–3.5 วัน (เดิม 2–3 วัน เพิ่มจาก helper นับสาขาและสมาชิก รอบของ `PAID_GRANTS` และทางให้ข้อความ P8 เกิดได้)

### S1 — ใบรับรองที่ต้องเซ็น + งานค้างของฉัน

- **ปิด:** #7, Q2, S1–S3 (Q1 คงทางลัดเดิมตามมติ Owner 2026-09-30)
- **API domain:**
  - `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts`: เพิ่ม `ListMySubstituteReceiptSignaturesUseCase` อ่านอย่างเดียว ไฟล์เดียวกัน จึงใช้ `selfApprovalPermitted` (`:53`) และ `isEligibleSubstituteReceiptApprover` (`:370`) ได้โดยไม่ต้อง export
    - ฝั่งผู้จ่ายเงิน: `PREPARED` + `payerUserId = ฉัน` + สาขาที่เห็น (มี index `[companyId, payerUserId, status]`)
    - ฝั่งผู้อนุมัติ: `PAYER_CERTIFIED` และฉบับกระดาษที่ส่งเข้าระบบแล้วรอรับ (`PREPARED` + `PAPER` + มี `paperSubmissionJson`) + สาขาที่ฉันเป็นผู้อนุมัติได้ (`listEligibleSubstituteReceiptApprovers` ต่อสาขา `prisma-expense.repository.ts:1631` + นโยบายระดับบริษัท `getSubstituteReceiptPolicy` `:1619`)
    - ตัดใบของตัวเองเมื่อ `selfApprovalPermitted` ไม่ผ่าน (ต้องได้บทบาทจริงของผู้ถาม)
    - ใบแก้ไขของใบที่ออกแล้ว (`correctionOfEvidenceId`) ต้องเป็นผู้อนุมัติเดิม (`:1162-1164`) ต้องอ่าน `approverUserId` ของใบเดิมด้วย ส่วนฉบับแก้ไขทั่วไปไม่มีกติกานี้
    - นับด้วย DB ไม่โหลดทั้งหมด
    - หน้าเว็บมีคิวแบบหลวมกว่าที่คำนวณฝั่ง client จากหน้าแรก 200 แถว (`substitute-receipt-hub.model.ts:28-31`) ไม่ดูผู้อนุมัติที่กำหนด สาขา และกติกาใบแก้ไข ตัวเลขของเครื่องมืออาจต่างจากหน้าเว็บ ให้บันทึกไว้ในผล eval
  - `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`: วันนี้มีแค่ `listCompanySubstituteReceipts` (`:1303`) เพิ่ม method แคบ `listSubstituteReceiptsAwaitingSignature` ที่ select เฉพาะ field ในสเปก §5.2 (ไม่มี `payeeTaxId`, `payeeAddress`)
  - `apps/api/src/modules/expenses/expenses.module.ts`: export use case ใหม่ (วันนี้ export แค่ `PrismaExpenseRepository` และ `LineSubstituteReceiptContinuationUseCase`, `:208`, `:229`)
  - ไม่แก้ `assertWeb` ของ certify, approve และการอัปโหลดลายเซ็น
- **API adapter:** ใหม่ `apps/api/src/modules/line-ai/application/use-cases/erp-substitute-receipt-tools.use-case.ts` → `ExpenseListSubstituteReceiptsToSignTool` แปลงสถานะเป็นคำไทย (`stepLabel`) ไม่ส่ง enum
  - สร้าง `RequestContext` ด้วย `ctx.roles` จริง ห้ามใช้ `toCtx` เดิมที่ตั้ง `roles: []` (`erp-tools.use-case.ts:34-46`) ไม่อย่างนั้นร้านคนเดียวจะไม่เห็นใบที่ตัวเองอนุมัติได้เลย
  - `sourceRefs[0].webPath` ชี้ `/companies/{id}/expenses/substitute-receipts`
- **ToolMeta:**

```ts
{
  name: 'expense.list_substitute_receipts_to_sign',
  description: "List substitute receipts (ใบรับรองแทนใบเสร็จรับเงิน) waiting for THIS user's own signature: as the named actual payer who must certify, or as an eligible approver who must approve. Returns counts per step and up to 10 items each (document number, payee name, amount, date). Signing and approving happen only on the web. Never another person's queue and never a company-wide list.",
  businessSubjects: ['expense'],
  questionKinds: ['summary', 'list'],
  category: 'read_summary',
  // Payer half: the same permissions as the web certify route (expense.controller.ts
  // @RequireAnyPermission('expense.read_related', 'expense.read_own')), so it never lists a receipt the
  // caller cannot open on the web. Approver half: expense.confirm plus eligibility, checked inside the tool.
  requiredPermissions: [],
  anyOfPermissions: ['expense.read_related', 'expense.read_own', 'expense.confirm'],
  sourceModule: 'expenses',
  supportedAgents: ['accounting', 'general'],
  sensitiveAudit: true,
  requiresErpPermissionCheck: true,
  optionalInputFields: ['role', 'limit'],
  inputEnumValues: { role: ['payer', 'approver'] },
},
```

- **Gateway:**
  - `ROUTER_ENABLED_TOOLS`, `ALLOWED_TOOLS` และแถว coverage `substitute_receipt_queue`
  - **Q1 กับ Q2 (มติ Owner 2026-09-30 ตามทางที่แนะนำ):** "วันนี้มีอะไรต้องทำ", "สรุปวันนี้" และ "closing วันนี้" (Q1) คงทางลัดเครื่องมือเดียวเดิม คิวลายเซ็นและคิวอนุมัติเข้าร่วมเฉพาะ "มีอะไรค้างที่ฉันต้องทำ" หรือ "งานค้างของฉัน" (Q2)
    - ทางลัดเดิม: คำอธิบายของ `expense.get_daily_closing` ใน registry (`ai-tools.ts:611`) กติกาทางลัดของ router (`intent-router.agent.ts:485`) และ family `expense.get_daily_closing::single_metric` (`packages/config/src/index.ts:556`) คงไว้สำหรับ Q1 ต้นทุนของ Q1 จึงคงเดิมประมาณ 0.51 บาท
    - ต้องเพิ่มกติกาใน registry, router และ `CONTROL_PROMPT` ให้ Q2 เรียก daily closing ร่วมกับคิวอนุมัติ (ถ้ามีสิทธิ์) และคิวลายเซ็น โดยไม่ดึง Q1 ออกจากทางลัด
    - การแก้นี้กระทบพฤติกรรมที่จูนไว้ในโปรแกรมรายจ่าย จึงต้องรันชุดกันถดถอย (สเปก §9.1) และชุด S-06 กับ S-10
  - `scopePolicyOverride` ข้อ 2 เพิ่มกฎงานบนเว็บของใบรับรอง (#910 merge แล้ว ตรวจก่อนแก้ว่าไม่มีงานอื่นกำลังแก้ไฟล์นี้)
    - คำนาม: `ใบรับรอง`, `ใบแทนใบเสร็จ`, `ใบรับรองแทนใบเสร็จ`
    - คำกริยา: `เซ็น`, `ลงนาม`, `ลงชื่อ`, `ลงลายมือชื่อ`, `รับรอง`, `อนุมัติ`
    - เพิ่มวลีสถานะที่ต้องตัดก่อนจับคำกริยา: `รอเซ็น`, `เซ็นแล้ว`, `รอลงนาม`, `ลงนามแล้ว`, `รอรับรอง` เพื่อให้ "มีใบรับรองรอเซ็นกี่ใบ" เป็นคำถาม ไม่ใช่คำสั่ง
    - ลิงก์ไปหน้ารายการใบรับรองบนเว็บ: ข้อความเดิมของข้อ 2 บอกชื่อหน้าเป็นคำโดยไม่มีลิงก์ที่กดได้ (`line-ai-scope-policy.logic.ts:154-169`) ถ้าต้องการลิงก์ที่กดได้ตามสเปก §2.6 ต้องแนบเพิ่มใน S1
  - ชื่อหน้าใน `APP_PAGE_TH` (`mangmee-persona.ts:85-87`): regex จับได้แค่ส่วนแรกหลังรหัสบริษัท path ของหน้าใบรับรอง (`/expenses/substitute-receipts`) จึงกลายเป็น "หน้าค่าใช้จ่ายบนเว็บ" ต้องขยายให้จับ `expenses/substitute-receipts` เป็น "หน้าใบรับรองแทนใบเสร็จบนเว็บ"
- **ความสัมพันธ์กับงานใบรับรองบน LINE (#926):**
  - `substituteAwaitsCaptionlessPhoto` (`line-substitute-receipt-continuation.use-case.ts:803`) มีผลเฉพาะรูปที่ไม่มีข้อความ ภายใน 30 นาทีหลังคำขอที่ชัดเจนในแชตนั้น และไม่แตะข้อความตัวอักษร S1 จึงไม่ชนกับ #926 โดยตรง
  - เครื่องมืออ่านอย่างเดียว ห้ามแตะสถานะงานต่อเนื่อง (`sourceChannelMetadataJson.lineSubstituteReceiptContinuation`) และคำตอบห้ามบอกให้ส่งรูปใบที่เซ็นแล้วมาทาง LINE
  - แชตส่วนตัวที่ bind แล้ว (ค่าเริ่มต้น) ใช้โหมด `primary` (`process-line-webhook.use-case.ts:5915`): ข้อความเข้างานใบรับรองเฉพาะเมื่อ router ตอบ `SUBSTITUTE_RECEIPT_CONTINUATION`
    - ถ้า router ส่งคำถาม "มีใบรับรองแทนใบเสร็จรอฉันเซ็นกี่ใบ" ไปผิดทาง จะถือเป็นคำสั่งเริ่มงานทันที (`line-substitute-receipt-continuation.use-case.ts:1664-1665`) กติกา router ต้องจัดคำถามนี้เป็นคำถามอ่านข้อมูล (ชุด S-08)
  - แชตส่วนตัวที่ยังไม่ bind ใช้เส้นทางเดิม (`LINE_AI_SUBSTITUTE_SEMANTIC_ROUTING_MODE` ค่าเริ่มต้น `off`) ข้อความที่มี "ใบรับรองแทน" หรือ "ใบแทน" ถูกงานใบรับรองรับไปก่อน (`line-substitute-receipt-continuation.use-case.ts:144-146`, `process-line-webhook.use-case.ts:6385`) ความเสี่ยงต่ำเพราะแชตส่วนตัว bind เป็นค่าเริ่มต้น
- **W00:** regenerate
- **Specs:**
  - unit ของ use case (เพิ่มเคสในไฟล์ spec เดิมของ substitute receipt หรือไฟล์ใหม่ `substitute-receipt-signature-queue.use-case.spec.ts`)
  - PG `apps/api/src/modules/expenses/substitute-receipt-signature-queue.pg.spec.ts`: `OWNER_SELF` vs `DESIGNATED_APPROVERS`, ผู้จ่ายเป็นตัวเอง, ใบแก้ไขของใบที่ออกแล้ว, สาขา, ฉบับกระดาษที่รอรับ, ใบที่สร้างจาก LINE
  - adapter spec (ไม่มีเลขผู้เสียภาษีและที่อยู่ใน JSON, `accessScope: 'own'`, hash คงที่, ส่งบทบาทจริงเข้า use case)
  - `line-ai-scope-policy.logic.spec.ts`
  - `mangmee-persona.spec.ts` (ชื่อหน้าใบรับรอง)
  - spec เดิมของ `line-substitute-receipt-continuation.use-case.spec.ts` ต้องผ่านเหมือนเดิม (ไม่แตะสถานะงานต่อเนื่อง)
- **Eval:** ชุด S อย่างน้อย 20 ข้อ × 2 ประมาณ 150–250 บาท
- **ต้นทุนต่อข้อความ:** 0.9–1.3 บาท โดยคำถาม Q2 อ่าน 2–3 ครั้งอาจถึงประมาณ 1.5 บาท ส่วน Q1 คงทางลัดเดิม
- **ขนาด:** 2.5–3.5 วัน (เดิม 2–3 วัน เพิ่มจากคิวฉบับกระดาษ กติกาใบแก้ไข บทบาทใน context ชื่อหน้า และกติกาแยก Q1 กับ Q2 ใน router)

### S3 — ใบเบิกค้างที่ใคร

- **ปิด:** #5, R1–R4
- **มติ Owner 2026-09-30 ที่ใช้ (สเปก §10):**
  - ข้อ 9 "แยกเป็นกองกลาง": ใบที่อนุมัติได้หลายคนอยู่ในกองกลาง ไม่นับให้ผู้อนุมัติคนใด
  - ข้อ 10: ผู้ที่เห็นใบเบิกทั้งร้านบนเว็บเห็นทั้งร้าน พนักงานทั่วไปเห็นเฉพาะใบของตัวเอง (ตรงกับขอบเขตสิทธิ์เดิม)
- **ความสัมพันธ์กับงานใบเบิกที่ merge แล้ว:**
  - #918 ไม่ได้เพิ่มเครื่องมืออ่านหรือ operation ใหม่ เครื่องมือ `reimbursement.draft.*` เป็นงานร่างที่มีก่อน (2026-09-27) และผูกกับเจ้าของแชต S3 จึงไม่ใช้ร่วม
  - router มีกติกาใบเบิกเดิมที่ต้องไม่ชนกัน: `CLAIM_CONTINUATION_RULE` (`intent-router.agent.ts:456`) ส่ง "บิลของฉันเบิกได้ไหม" ไป `reimbursement.get_summary` และ "ขอดูใบเบิกที่ค้าง" เป็นคำถามอ่านข้อมูล (`:231`)
  - ทางลัด simple read (`intent-router.agent.ts:485`) ส่ง "ใบเบิกของฉันถึงไหนแล้ว" ไป `reimbursement.get_summary` ผ่าน formatter ของทางลัด (`prepared-simple-read-formatter.ts:1201`) โดยไม่ผ่าน `CONTROL_PROMPT` ถ้า R2 ต้องใช้เครื่องมือใหม่ ต้องแก้กติกาตรงนั้นด้วย
  - ใช้ร่วมได้: `formatClaimMoney` (`line-reimbursement-draft-card.logic.ts:20`), `findBranchName` (`prisma-reimbursement.repository.ts:257`, ทีละ id), คำเรียกโต๊ะของเว็บ (`reimbursements.model.ts:93-98`) และคำสถานะ `CLAIM_STATE_TEXT` (#920–#922)
- **API domain:** `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-summary.use-case.ts` เพิ่ม `GetReimbursementApprovalBacklogUseCase`
  - ขอบเขตเหมือน `GetReimbursementAiSummaryUseCase` (`:13`, ขอบเขตที่ `:17-23`)
    - เงื่อนไข `read_related` ไม่ดูรายชื่อผู้อนุมัติที่ถูกตรึง บทบาทที่ร้านสร้างเองซึ่งมีแค่ `read_related` จึงไม่เห็นใบที่รอตัวเองผ่านบทบาท บันทึกเป็นข้อจำกัด ไม่แก้ใน S3
  - สถานะที่นับ: `PENDING_APPROVAL`, `FINANCE_REVIEW`, `READY_FOR_PAYMENT`, `PARTIALLY_PAID` และ `APPROVED` ที่ยังเป็นสถานะชั่วคราว ส่ง `statuses` ให้ `listRequests` ไม่โหลดทุกใบแบบ AI summary
  - ขั้นอนุมัติที่ค้าง: `repo.findPendingApprovalSteps` (`prisma-reimbursement.repository.ts:2388`); ผู้อนุมัติที่ถูกตรึง: `assignedApproverUserIdsJson`; โต๊ะ: `currentDesk` (`reimbursement.logic.ts:378`) ซึ่ง `toRequestSummary` (`reimbursement.mapper.ts:60`) และ `ListReimbursementsUseCase` ใช้แบบ batch อยู่แล้ว
  - กรองผู้อนุมัติด้วย `findActiveApproverUserIds` ต่อสาขา (`:228`) แบบเดียวกับคิวอนุมัติ ก่อนเรียก `repo.getUserDisplayNames` (`:207` ไม่กรองคนที่ออกไปแล้ว)
  - จัดกลุ่มตามสเปก §5.3: ผู้อนุมัติคนเดียว, กองกลาง, ไม่มีผู้อนุมัติที่ใช้งานได้, รอระบบปรับสถานะ, การเงิน, รอจ่าย
    - ร้านที่ใช้การส่งต่อตามบทบาทแบบค่าเริ่มต้นและบทบาทนั้นมีผู้ถือหลายคน ระบบตรึงทุกคนในบทบาท (`reimbursement-request.use-case.ts:572`) ใบแบบนั้นทุกใบจึงอยู่ในกองกลาง Owner ทราบผลนี้แล้วและยืนยัน "คงกองกลาง" (สเปก §10 ข้อ 9)
  - ยอดแยกตามสกุลเงิน (อย่าลอก `reimbursement-summary.use-case.ts:45-47` ที่รวมข้ามสกุลเงิน)
  - จำนวนวันรอคิดตามวันไทย (`submittedAt` สำหรับขั้นอนุมัติ, `approvedAt` สำหรับการเงินและรอจ่าย) และบันทึก audit `reimbursement.ai_tool.read` แบบเดียวกับ AI summary (`:51-54`)
  - export จาก `reimbursements.module.ts` (`:83`)
- **API adapter:** `apps/api/src/modules/line-ai/application/use-cases/erp-reimbursement-tools.use-case.ts` เพิ่ม `ReimbursementGetApprovalBacklogTool` (ไฟล์นี้มี `list_pending_approvals` ส่วน `get_summary` และ `get_detail` อยู่ใน `erp-core-detail-tools.use-case.ts:398`, `:412`)
  - เพิ่มใน `READ_MEMORY_TOOLS` (`line-read-evidence.service.ts:58`) เพื่อให้ถามต่อ "คนแรก" ได้
- **ToolMeta:**

```ts
{
  name: 'reimbursement.get_approval_backlog',
  description: 'Summarize reimbursement claims that are still waiting, grouped by who or what they wait on right now: one named approver, a shared pile of claims that several people can approve (never counted toward any one person), no active approver, finance review, or payment. Returns count, totals by currency, the oldest submission date and the longest wait in days per group. Scoped to the claims the caller may read. Use for "ใบเบิกค้างอยู่ที่ใคร", "ใครยังไม่อนุมัติ". The caller\'s OWN approval queue is reimbursement.list_pending_approvals.',
  businessSubjects: ['reimbursement', 'employee'],
  questionKinds: ['summary', 'breakdown'],
  category: 'read_summary',
  requiredPermissions: [],
  anyOfPermissions: ['reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own'],
  sourceModule: 'reimbursements',
  supportedAgents: ['accounting', 'general'],
  sensitiveAudit: true,
  requiresErpPermissionCheck: true,
},
```

- **Gateway:**
  - `ROUTER_ENABLED_TOOLS`, `ALLOWED_TOOLS` และแถว coverage `reimbursement_backlog`
  - `CONTROL_PROMPT`: "ค้างที่ใคร/กองที่ใคร/ใครยังไม่อนุมัติ" → `reimbursement.get_approval_backlog`; "รอฉันอนุมัติ" → `reimbursement.list_pending_approvals` และแก้กติกาทางลัด simple read ที่ `intent-router.agent.ts:485` ให้ตรงกัน
  - `ANSWER_PROMPT`: กองกลางต้องบอกเป็นกลุ่มแยก ห้ามรวมเข้าจำนวนของคนใด และใช้คำเรียกโต๊ะแบบหน้าเว็บ
- **W00:** regenerate
- **Specs:**
  - unit: การจัดกลุ่ม (คนเดียว กองกลาง ไม่มีผู้อนุมัติที่ใช้งานได้ รอระบบปรับสถานะ การเงิน รอจ่าย), คนที่ออกไปแล้วไม่ถูกเอ่ยชื่อ, หลายสกุลเงิน, ขอบเขตของฉันและที่เกี่ยวข้อง, สาขา, วันไทย, hash คงที่
  - PG `apps/api/src/modules/reimbursements/reimbursement-approval-backlog.pg.spec.ts` ลงทะเบียนใน `reliability-postgres-v2` (ไม่แก้ `package.json`)
  - adapter เพิ่มเคสใน `erp-reimbursement-tools.use-case.spec.ts`
- **Eval:** ชุด R อย่างน้อย 20 ข้อ × 2 ประมาณ 100–200 บาท
- **ต้นทุนต่อข้อความ:** 0.9–1.1 บาท
- **ขนาด:** 2–2.5 วัน (เดิม 1.5–2 วัน เพิ่มจากการกรองผู้อนุมัติที่ใช้งานอยู่ต่อสาขา กองกลาง กลุ่มรอระบบปรับสถานะ และกติกาทางลัดของ router)

### S8 — ปุ่มและลิงก์ในการ์ด LINE (งานตายตัวใน R1)

- **ที่มา:** มติ Owner 2026-09-30 ให้ข้อ ค และ จ "รอรวมกับรอบแรกของแผน" ไม่ใช่งานแยก และการ์ดคำถามนโยบาย (ข้อ ฉ) แตะไฟล์เดียวกับข้อ ค จึงรวมไว้ที่นี่ (สเปก §2.2, §6.2, §11 ข้อ 17–18)
- **ไม่มีเครื่องมือใหม่และไม่ผ่านโมเดล:** ใช้ unit spec พอ ไม่ใช้งบทดสอบกับโมเดลจริง ทำคู่ขนานกับ slice อื่นใน R1 ได้
- **ข้อ ค — ปุ่มตามสิทธิ์ซื้อ:**
  - `apps/api/src/modules/line-ai/domain/logic/line-business-card.logic.ts`: `buildAiBudgetExceededMessage` (`:498`, กรณีเครดิตรวมหมด ปุ่มที่ `:523-528`) และ `buildReceiptQuotaExceededMessage` (`:637`, ปุ่มที่ `:646-647`) รับค่าว่าผู้รับมีสิทธิ์ซื้อหรือไม่
    - มีสิทธิ์: ปุ่มนำไปซื้อตามเดิม (ไปหน้าแพ็กเกจจนกว่าจะเปิดขายเครดิต add-on แล้วเป็น "ซื้อเครดิตเพิ่ม" ดู S2b)
    - ไม่มีสิทธิ์: ไม่มีปุ่มดูแพ็กเกจ ขอเปลี่ยนแพ็กเกจ หรือซื้อ และข้อความเป็นประโยคสั้นให้แจ้งเจ้าของร้านหรือผู้จัดการแพ็กเกจ (ใช้แนวเดียวกับ `PACKAGE_REQUIRED_MEMBER_REPLY` ใน `process-line-webhook.use-case.ts`)
  - `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`: ผู้เรียกที่ `:7417`, `:7458`, `:11225` ส่งสิทธิ์ของผู้รับ (`company.plan.manage` จากสิทธิ์ของเทิร์น ซึ่งตรงกับ `canManagePlan`)
    - แบบอย่างที่มีอยู่แล้ว: การ์ดโปรโมชั่นเลือกปุ่มซื้อด้วย `canManagePlan` (`process-line-webhook.use-case.ts:2583-2588`) และคำตอบส่วนลดจากงานให้ข้อความสำหรับคนที่ไม่มีสิทธิ์ (`EVENT_DISCOUNT_MEMBER_REPLY`)
  - `apps/api/src/modules/system-partner-management/domain/logic/receipt-quota.logic.ts`: ข้อความโควตา (`:52`, `:70-74`) ที่ชวนดูแพ็กเกจที่ใหญ่ขึ้นหรือพิมพ์ "ขอเปลี่ยนแพ็กเกจ" ต้องมีแบบสำหรับคนที่ไม่มีสิทธิ์ซื้อ
- **ข้อ จ — ลิงก์หน้ารายชื่อพนักงาน:**
  - `apps/api/src/modules/line-ai/application/use-cases/erp-business-tools.use-case.ts`: `webPath` ของ `company.get_employee_summary` (`:247`) และ `company.get_employee_detail` (`:278`) เปลี่ยนจาก `/settings/employees` (ฟอร์มเพิ่มพนักงาน `AddEmployeePrototypePage`) เป็น `/settings/access-overview`
  - หน้านั้นชื่อ "รายชื่อพนักงาน" (`apps/web/src/common/i18n/workspace-dictionary.ts:81`) และใช้สิทธิ์ `access.employee.read` (`route-permissions.ts:25`) ตรงกับสิทธิ์ของทั้งสองเครื่องมือ
- **ข้อ ฉ — การ์ดคำถามนโยบายสาธารณะ:**
  - `line-business-card.logic.ts`: `buildPublicPolicyCardMessage` (`:157`) เปลี่ยนปุ่ม "ดูแพ็กเกจ" (ลิงก์หน้าแพ็กเกจสาธารณะ) เป็นปุ่ม "ติดต่อเจ้าหน้าที่" (`STAFF_CONTACT_COMMAND`) และไม่ให้ปุ่มซ้ำกับ quick reply ที่มีอยู่แล้ว
  - `apps/api/src/modules/line-ai/domain/logic/line-public-policy.logic.ts`: เอาบรรทัด "ดูรายละเอียดแพ็กเกจ: …" ออกจาก `answer()` (`:78-79`) เพื่อให้ `canonicalText` และ `altText` ไม่มีลิงก์แพ็กเกจ แล้วปิดท้ายคำตอบด้วยประโยคสั้นแนะนำให้ติดต่อเจ้าหน้าที่
    - คำตอบติดตามเรื่องลิงก์ผิด (`:108-109`) ที่บอกให้ "กดปุ่มดูแพ็กเกจด้านล่าง" ต้องแก้ให้ตรงกับปุ่มใหม่
  - ตรวจสิ่งที่ปุ่ม "ติดต่อเจ้าหน้าที่" ทำกับคนที่ยังไม่มีร้าน (สเปก §11 ข้อ 18) ก่อนเปิด PR
- **Specs:**
  - `line-business-card.logic.spec.ts`: ปุ่มของการ์ดทั้งสามแบบตามสิทธิ์ และไม่มีลิงก์แพ็กเกจในการ์ดคำถามนโยบาย
  - `line-staff-menu.logic.spec.ts` (คำตอบนโยบายสาธารณะ) และ `process-line-webhook.use-case.spec.ts` (เส้นทางการ์ดคำถามนโยบาย)
  - การ์ดโปรโมชั่นไม่อยู่ในขอบเขต spec ที่ตรวจลิงก์เว็บไซต์ของการ์ดนั้น (`line-first-signup-webhook.spec.ts:1579`) ต้องผ่านเหมือนเดิม
  - `erp-business-tools.use-case.spec.ts`: `webPath` ของเครื่องมือพนักงานทั้งสอง
  - spec ที่แตะต้องอยู่ในชุดที่ CI รันอยู่แล้ว ไม่แก้ `package.json`
- **W00:** `process-line-webhook.use-case.ts` อยู่ในรายการที่ manifest เก็บ hash จึงต้อง regenerate และรัน manifest spec ส่วนไฟล์อื่นของ S8 ไม่อยู่ในรายการ
- **ก่อน push:** รัน whole-chain acceptance (§0)
- **ขนาด:** 1–1.5 วัน

### S2b — เครดิต AI คงเหลือ

- **ปิด:** #2, P5
- **ต้องรอ:** D2 (ตัวคำนวณ `quotaSummary` ของงาน E9 แผน add-on) และ D3 — **ยังติดอยู่** (ตรวจ 2026-09-30)
  - ledger เครดิตยังไม่ทำงานกับร้านใด: `aiCreditCutoverAt` ถูกเขียนเฉพาะใน spec ทดสอบสองไฟล์ ส่วนตัวตั้งค่าเป็นเครื่องมือของ PR G แผน add-on ซึ่งยังไม่มี
  - ทุกร้านวันนี้ใช้เพดานรายเดือน `chatCapSatang` เทียบยอดใช้เดือนนี้บวกยอดกันไว้ (`company-ai-budget-reservation.ts:183-240`) ตัวเลข "เหลือเท่าไหร่" แบบนี้มีเฉพาะหน้าแอดมิน (`partner.controller.ts:595`)
  - `readAiCreditBalance` (`ai-credit-ledger.ts:253-280`) คำนวณยอดจากแพ็กเกจ ยอดเพิ่มเติม และรวมได้ แต่ใช้ได้เฉพาะร้านที่ย้ายระบบแล้ว วันนี้จึงตอบ "ยังไม่ย้าย" ทุกร้าน
  - `BillingStatus.addOns.quotaSummary` ยังเป็นแค่ type (`packages/contracts/src/billing.ts:259-261`) และงาน E9 ยังไม่เริ่ม (`chat-credit-and-receipt-addons-plan-th.md:129`)
- **มติ Owner 2026-09-30 (ยอดเครดิตก่อนเปิดขาย add-on):** ตามทางที่แนะนำ — ตัวอย่าง #2 "เราเหลือเครดิตอยู่เท่าไหร่" ยังไม่ต้องตอบได้ก่อน add-on เปิดขาย S2b รอ E9 และออกพร้อมการเปิดขายเครดิต add-on (R2) ไม่ดึงงาน E9 มาทำก่อนกำหนด
- **ปุ่มสำหรับผู้มีสิทธิ์ซื้อ (มติ Owner 2026-09-30 กติกาปุ่มซื้อ สเปก §2.2):** ปุ่มนำไปหน้าแพ็กเกจจนกว่าจะเปิดขายเครดิต add-on แล้วจึงเปลี่ยนเป็น "ซื้อเครดิตเพิ่ม" การเปลี่ยนปุ่มนี้ทำพร้อม S2b คนที่ไม่มีสิทธิ์ซื้อไม่เห็นปุ่มเลย (S8)
- **API:** เพิ่มส่วน `aiCredit` ใน `BillingGetPackageUsageTool` จากตัวคำนวณตัวเดียวกับ `BillingStatus.addOns.quotaSummary`
  - ห้ามทำตัวคำนวณเองในโปรแกรมนี้ ให้ทั้งหน้าเว็บและเครื่องมือนี้ใช้ตัวคำนวณของงาน E9 ตัวเดียวกัน ห้ามคำนวณยอดเป็นชุดที่สอง
  - ร้านที่ยังไม่ย้ายระบบเครดิต (`aiCreditCutoverAt` ว่าง) ใช้ความหมายตาม add-on §11 และ §17 ซึ่งตัวคำนวณเป็นผู้ตัดสิน
  - หักเครดิตตามปกติ (มติ Owner 2026-09-30 สเปก §10 ข้อ 3) และบอกยอดคงเหลือกับวันเติมรอบถัดไปได้ (ข้อ 1)
- **Contracts:** แก้ description ของ `billing.get_package_usage` ให้พูดถึงเครดิต AI
- **W00:** regenerate
- **Specs:**
  - PG ของตัวคำนวณ (ต่อจาก `ai-credit-funding.pg.spec.ts` หรือไฟล์ใหม่ `ai-credit-quota-summary.pg.spec.ts`)
  - adapter: ไม่มียอดกันไว้, หน่วย `unitScale` 100, กรณีไม่จำกัด
- **Eval:** ชุด C อย่างน้อย 20 ข้อ × 2 ประมาณ 100–200 บาท
- **ขนาด:** 1–2 วัน หลัง E9

### S5 — คู่ค้า

- **ปิด:** #6, V1–V5
- **ก่อนเริ่ม (มติ Owner 2026-09-30 สเปก §10 ข้อ 6–7):**
  - ถาม Owner ก่อน R3 ว่าเบอร์และเลขผู้เสียภาษีของคู่ค้าใช้กติกาเดียวกับข้อมูลติดต่อพนักงานหรือไม่ (สเปก §11 ข้อ 19) จนกว่าจะได้คำตอบ เครื่องมือไม่ส่งค่าเหล่านี้ออกตามเดิม
  - ขอบเขต: เห็นเท่าหน้าเว็บแต่เฉพาะคู่ค้าของสาขาที่ผู้ถามรับผิดชอบ ต้องนิยาม "คู่ค้าของสาขา" ก่อน เพราะทะเบียนคู่ค้าเป็นระดับบริษัท (สเปก §11 ข้อ 21) ผู้ที่เห็นทุกสาขาเห็นทั้งทะเบียน
- **API:**
  - เพิ่ม `ListCounterpartiesUseCase` ใน exports ของ `apps/api/src/modules/accounting-documents/accounting-documents.module.ts` (`:100-115` วันนี้ยังไม่มี)
  - adapter `AccountingSearchCounterpartiesTool` ใน `erp-business-tools.use-case.ts` (ไฟล์ที่มี `accounting.get_summary` และ `accounting.list_recent_documents` อยู่แล้ว) แปลงค่าเป็นจริง/เท็จ
    - จำกัด `pageSize` เอง เพราะ route ของเว็บไม่จำกัด (`counterparty.controller.ts:95-112`)
    - คู่ค้าที่เก็บถาวร: รายการบนเว็บรวม `ARCHIVED` โดยไม่มีป้าย ค่าแนะนำคือนับเฉพาะ `ACTIVE` และบอกจำนวนที่เก็บถาวรแยก (ตัดสินตอนเริ่ม S5)
    - `sourceRefs[0].webPath` ชี้ `/companies/{id}/counterparties` และเพิ่มชื่อหน้า `counterparties` ใน `APP_PAGE_TH`
- **ToolMeta:**

```ts
{
  name: 'accounting.search_counterparties',
  description: "Search this company's registered trading partners (คู่ค้า: vendors and customers) and return display names with how many purchase and sale documents each has, and whether a tax ID and an address are on file — never the tax ID, phone, email or address themselves. Optional search (a name the user typed), usage (bought|sold) and addressMissing. For how much was paid to each vendor use expense.get_breakdown.",
  businessSubjects: ['supplier', 'customer', 'expense'],
  questionKinds: ['search', 'list'],
  category: 'read_detail',
  requiredPermissions: ['accounting.counterparty.read'],
  sourceModule: 'accounting-documents',
  // Menu 'counterparties' is parented to expenses and entitled by either feature; the module default
  // (sales_documents only) would hide it from every Starter shop.
  featureKeys: ['expenses', 'sales_documents'],
  supportedAgents: ['accounting', 'general'],
  sensitiveAudit: true,
  requiresErpPermissionCheck: true,
  optionalInputFields: ['search', 'usage', 'addressMissing', 'limit'],
  inputEnumValues: { usage: ['bought', 'sold'] },
  inputLengthLimits: { search: { min: 1, max: 80 } },
},
```

- **Gateway:**
  - `ROUTER_ENABLED_TOOLS`, `ALLOWED_TOOLS` และแถว coverage `counterparties`
  - `featureKeys: ['expenses', 'sales_documents']` จำเป็น เพราะค่าเริ่มต้นของ `accounting-documents` คือ `sales_documents` อย่างเดียว (`ai-tools.ts:176`) ร้านที่มีแค่รายจ่ายจะถูกปฏิเสธ
  - ground `search` ใน `read-tool-input.ts`
  - เพิ่มใน `READ_MEMORY_TOOLS` เพื่อให้ถามต่อ "ร้านที่สอง" ได้
  - `CONTROL_PROMPT`: "คู่ค้ามีใคร" → `accounting.search_counterparties`; "จ่ายใครเยอะสุด" → `expense.get_breakdown`
- **W00:** regenerate
- **Specs:**
  - adapter: ไม่มีค่าเลขผู้เสียภาษี เบอร์ อีเมล หรือที่อยู่ใน JSON (จนกว่าจะได้คำตอบสเปก §11 ข้อ 19); ส่งตัวกรองผ่าน; limit; ผู้จัดการสาขาเห็นเฉพาะคู่ค้าของสาขาตามนิยามข้อ 21
  - `read-tool-input.spec.ts`: ชื่อต้อง ground
- **Eval:** ชุด V อย่างน้อย 20 ข้อ × 2 ประมาณ 80–150 บาท
- **ต้นทุนต่อข้อความ:** 0.9–1.1 บาท
- **ขนาด:** 1–1.5 วัน (เดิม 1 วัน เพิ่มจากขอบเขตคู่ค้าตามสาขา มติ §10 ข้อ 7)

### S6 — สมาชิกและข้อมูลที่ขาด

- **ปิด:** #4, M1–M4 (มติ Owner สเปก §10 ข้อ 5–7 ได้แล้ว 2026-09-30) โดยต้องปิดข้อตรวจสเปก §11 ข้อ 20 ก่อนเริ่ม
- **มติ Owner 2026-09-30 ที่ใช้:**
  - ข้อ 5: นับทุกคนที่อยู่ในร้าน (`ACTIVE`, `INVITED` รวมเจ้าของ) และบอกได้ว่ามีเบอร์กี่คน ไม่มีกี่คน ใครมีเบอร์ เบอร์อะไร และใครไม่มี "มีเบอร์" คือมีในบัญชีหรือในโปรไฟล์
  - ข้อ 6: บอกชื่อ เบอร์ และอีเมลของพนักงานได้ เฉพาะผู้มี `access.employee.read` ในแชตส่วนตัว (แชตกลุ่มไม่ถึงเครื่องมืออยู่แล้ว) ไม่บอกเลขบัตร ที่อยู่ วันเกิด
  - ข้อ 7: เห็นเท่าหน้าเว็บ แต่เฉพาะสมาชิกของสาขาที่ผู้ถามรับผิดชอบ นิยามตามสเปก §11 ข้อ 20
- **API:** adapter `CompanyListMembersTool` ใน `erp-business-tools.use-case.ts`
  - อ่าน `companyMembership` พร้อมบทบาท สถานะ ชื่อ เบอร์ อีเมล และค่าที่ใช้คำนวณ `lineLinked` (นับแบบสมาชิกเหมือน `company.get_employee_summary` `:224-261` ซึ่งรวมเจ้าของร้าน) แล้วกรองตามสาขาของผู้ถาม
  - เบอร์: ของโปรไฟล์ก่อน แล้วจึงของบัญชี เบอร์ในโปรไฟล์เป็นค่าบังคับ (`schema.prisma:7674`) คนที่ไม่มีเบอร์จึงเป็นสมาชิกที่ไม่มีโปรไฟล์และไม่มี `User.phoneNumber`
  - อีเมล: อีเมลติดต่อในโปรไฟล์ก่อน แล้วจึงอีเมลเข้าระบบ แบบเดียวกับหน้าเว็บ (`employee-access.mapper.ts:74`)
  - `lineLinked` นับเฉพาะ `ExternalIdentity` ที่ provider เป็น `LINE` และสถานะ `ACTIVE` (หน้าเว็บนับ `DEV` ด้วย `employee-access.mapper.ts:93`)
  - ส่งเบอร์และอีเมลออกได้ตามมติข้อ 5–6 แต่ห้ามส่งเลขบัตร ที่อยู่ และวันเกิด
  - `sourceRefs[0].webPath` ชี้หน้ารายชื่อ `/companies/{id}/settings/access-overview` ไม่ใช่ `/settings/employees` ซึ่งเป็นฟอร์มเพิ่มพนักงาน
    - ลิงก์ของเครื่องมือพนักงานเดิม (`erp-business-tools.use-case.ts:247`, `:278`) แก้ใน S8 ข้อ จ ซึ่งออกใน R1 ก่อน S6
    - regex ของ `APP_PAGE_TH` จับได้แค่ `settings` ต้องขยายให้ `settings/access-overview` เป็น "หน้ารายชื่อพนักงานบนเว็บ"
- **`company.get_employee_detail` คงเดิม** (มติ Owner 2026-09-30 ข้อ 6 "ตอบได้ เป็นชื่อ เบอร์โทร อีเมล"): ไม่ต้องแก้ `CompanyEmployeeDetailTool` หรือ spec เดิมที่ล็อก field ไว้ (`erp-business-tools.use-case.spec.ts:327-336`)
- **ToolMeta:**

```ts
{
  name: 'company.list_members',
  description: "List this company's members within the branches the caller is responsible for, by display name with their roles, status, phone number and email when on file (employee profile or account), and whether a LINE link is on file. Never an ID-card number, address or birthday. Optional missing (phone|email|line) lists only members missing that item. Use for 'ใครยังไม่มีเบอร์', 'ใครมีเบอร์บ้าง', 'ใครยังไม่เชื่อม LINE', 'ใครเป็นผู้จัดการ'.",
  businessSubjects: ['employee'],
  questionKinds: ['list', 'search'],
  category: 'read_detail',
  requiredPermissions: ['access.employee.read'],
  // Ungated like the other employee tools: access.employee.* is owned by employee_access.employees,
  // so entitlement stripping already removes the permission when the feature is off (and
  // employee_access is a platform-invariant feature that cannot be switched off).
  sourceModule: 'employee-access',
  supportedAgents: ['general'],
  sensitiveAudit: true,
  requiresErpPermissionCheck: true,
  optionalInputFields: ['missing', 'limit'],
  inputEnumValues: { missing: ['phone', 'email', 'line'] },
},
```

- **Gateway:**
  - `ROUTER_ENABLED_TOOLS`, `ALLOWED_TOOLS` และแถว coverage `members` (แยกจากแถว `employees` เดิม)
  - เพิ่มใน `READ_MEMORY_TOOLS` เพื่อให้ M-04 ("คนที่สองในรายการเมื่อกี้") อ้างถึงได้
  - กลุ่มความสามารถใหม่ `{ id: 'team', featureKeys: [], sourceModules: ['employee-access'] }` กับข้อความ `{ line: '• พนักงานและข้อมูลที่ยังขาด', example: 'ใครยังไม่เชื่อม LINE' }`
  - `ANSWER_PROMPT`: บอกชื่อ เบอร์ และอีเมลของพนักงานได้ตามมติข้อ 5–6 ห้ามบอกเลขบัตร ที่อยู่ วันเกิด และข้อมูลติดต่อของคู่ค้า ถ้าถูกขอให้ตอบข้อความในสเปก §7
- **W00:** regenerate
- **Specs:**
  - adapter: เบอร์และอีเมลที่ seed ไว้อยู่ใน JSON เฉพาะของสมาชิกที่เห็นได้ ไม่มีเลขบัตร ที่อยู่ วันเกิด และสมาชิกนอกสาขาที่รับผิดชอบไม่อยู่ในผล
  - PG `apps/api/src/modules/line-ai/application/company-members.pg.spec.ts`: เจ้าของที่ไม่มีโปรไฟล์, เบอร์ในบัญชีเทียบกับในโปรไฟล์, LINE `ACTIVE` เทียบกับ `UNLINKED` และ `DISABLED`, ตัด `DEV`, สถานะ `INVITED`, `DRAFT`, `SUSPENDED` และ `DISABLED`, ผู้จัดการสาขา 1 เทียบกับผู้ที่เห็นทุกสาขา
- **Eval:** ชุด M อย่างน้อย 20 ข้อ × 2 ประมาณ 100–200 บาท
- **ต้นทุนต่อข้อความ:** 0.9–1.1 บาท
- **ขนาด:** 1.5–2 วัน

### S4a — รายจ่ายผิดปกติ

- **ปิด:** #3, E1–E5 โดยต้องได้คำตอบสเปก §10 ข้อ 8 ก่อน
- **API:**
  - แยก predicate ร่วมออกจาก `erp-expense-daily-closing.use-case.ts` (`accessClauses` `:189`, `activeWhere` `:198`, `evidenceWhere` `:210`, `duplicateWhere` `:216`) ไปไว้ในไฟล์ใหม่ `apps/api/src/modules/line-ai/application/use-cases/expense-read-scope.ts` ใช้ร่วมสองเครื่องมือ พฤติกรรมของ daily closing ต้องเหมือนเดิม (spec เดิมต้องผ่าน)
  - pure logic ใหม่ `apps/api/src/modules/line-ai/domain/logic/expense-anomaly.logic.ts`: มัธยฐาน อัตราส่วน เกณฑ์ Decimal แยกสกุลเงิน และ `formulaVersion: 'expense-anomaly-v1'`
  - adapter ใหม่ `apps/api/src/modules/line-ai/application/use-cases/erp-expense-anomaly.use-case.ts` → `ExpenseFindAnomaliesTool`
    - aggregate ใน repeatable-read transaction เดียว (core contract §5)
    - คิดมัธยฐานเฉพาะร้านค้าที่มีรายการในช่วง และจำกัดจำนวนร้านค้าต่อครั้ง
    - timeout ตาม core contract
  - **หมวดที่เพิ่งสร้าง:** ข้าม "หมวดพุ่ง" ของหมวดที่ถูกสร้างภายในช่วงที่ใช้เทียบ ถ้าทำ[ข้อเสนอขยายหมวด](../specs/mangmee-expense-category-expansion-2026-09-29-th.md) ก่อน (Owner พักงานหมวดไว้ 2026-09-30) เพราะหมวดใหม่ทำให้การเทียบข้ามวันเปลี่ยนหมวดไม่ใช่ของชนิดเดียวกัน
  - **ข้อมูลหมวดจริงหลัง #911 และ #914 (สเปก §5.6):**
    - จัดกลุ่มด้วย id ของหมวด และไม่นับกลุ่ม "ไม่มีหมวด" เป็นหมวดพุ่ง
    - รายการจาก LINE ก่อน 2026-09-29 ไม่มีหมวด และ AI ใส่หมวดเฉพาะเมื่อมั่นใจตั้งแต่ 0.85 โดยไม่เลือกเบ็ดเตล็ด ช่วงเทียบที่คร่อมวันนั้นต้องบอกข้อจำกัด
    - บันทึกข้อความที่มีหลายหมวดไม่มีหมวดที่หัวรายการ ซึ่ง `expense.get_breakdown` ก็ใช้หมวดที่หัวรายการเท่านั้น
  - คืน `queryApplied.period` เพื่อให้หมายเหตุปีที่สันนิษฐานของ #912 ทำงาน และเพิ่มใน `READ_MEMORY_TOOLS`
- **ToolMeta:**

```ts
{
  name: 'expense.find_anomalies',
  description: "Check one period's expenses for things worth a second look and return each finding with its reason: records the system already flagged as possible duplicates, records missing a receipt or with tax evidence under review, amounts far above that vendor's usual amount, vendors paid for the first time, and categories that rose sharply against the three previous periods. Findings are signals to review, not proof of error. Optional kind narrows to one finding type.",
  businessSubjects: ['expense'],
  questionKinds: ['summary', 'list', 'explain'],
  category: 'read_summary',
  requiredPermissions: [],
  anyOfPermissions: ['expense.read', 'expense.review', 'expense.read_related', 'expense.read_own'],
  sourceModule: 'expenses',
  supportedAgents: ['accounting', 'general'],
  sensitiveAudit: true,
  requiresErpPermissionCheck: true,
  optionalInputFields: ['periodKey', 'fromDate', 'toDate', 'branchId', 'kind', 'limit'],
  inputEnumValues: { kind: ['duplicate', 'missing_evidence', 'unusual_amount', 'new_vendor', 'category_spike'] },
},
```

- **Gateway:**
  - `ROUTER_ENABLED_TOOLS`, `ALLOWED_TOOLS` และแถว coverage `expense_anomalies`
  - `CONTROL_PROMPT`: คำว่า "แปลก ผิดปกติ ซ้ำ ไม่มีใบเสร็จ พุ่ง ร้านใหม่" → `expense.find_anomalies`; "ทำไมจ่ายเยอะ" ยังใช้ `expense.get_breakdown`
  - `ANSWER_PROMPT`: ข้อค้นพบเป็นสัญญาณให้ตรวจ ไม่ใช่ข้อกล่าวหา และอ้างตัวเลขเหตุผลจากเครื่องมือเท่านั้น
- **W00:** regenerate
- **Specs:**
  - `expense-anomaly.logic.spec.ts`
  - PG `apps/api/src/modules/line-ai/application/use-cases/erp-expense-anomaly.pg.spec.ts`
    - สาขา A, B และส่วนกลาง
    - ขอบเขต own และ related
    - ธงซ้ำ
    - ร้านค้าใหม่ตามขอบเขต
    - หมวดพุ่งเมื่อมีสามช่วงก่อนหน้า
    - หลายสกุลเงิน
    - ความแม่นยำ Decimal `9007199254740993.01`
    - หมวดที่เพิ่งสร้าง
    - รายการไม่มีหมวด และบันทึกหลายหมวด
  - spec ของ daily closing ต้องไม่เปลี่ยน
- **Eval:** ชุด A อย่างน้อย 25 ข้อ × 2 ประมาณ 200–350 บาท
- **ต้นทุนต่อข้อความ:** 1.0–1.4 บาท (ผลใหญ่กว่าเครื่องมืออื่น)
- **ขนาด:** 4–6 วัน
- **ความสัมพันธ์:** ปิดส่วนหนึ่งของ G8 ใน starter gap audit

### S4b — ภาษีซื้อพร้อมขอคืน

- **ปิด:** T1–T2 โดยต้องตรวจความหมายสถานะก่อน (สเปก §11 ข้อ 10)
- **API:** adapter ใหม่ `apps/api/src/modules/line-ai/application/use-cases/erp-expense-vat-readiness.use-case.ts` → `ExpenseGetVatReadinessTool`
  - groupBy `inputVatClaimStatus` และ `taxEvidenceStatus` ในขอบเขตเดียวกับ S4a
  - blockers เชื่อมคู่ค้าเพื่อคำนวณ `hasTaxId`/`hasAddress` โดยไม่ส่งค่าออก
  - ร้านที่ไม่ได้จด VAT: อ่านนโยบายการบันทึกแบบเดียวกับ `GET expenses/capture-policy` (`expense.controller.ts:147`) แล้วไม่ตอบเรื่อง VAT ที่ขอคืนได้
  - ตัดสินว่าจะนับร่างหรือไม่ เพราะบันทึกข้อความจาก LINE เริ่มที่ `NEEDS_REVIEW` (`expense-document.use-case.ts:219`) ส่วนหน้า "หลักฐานทางบัญชี" แสดงเฉพาะที่ยืนยันแล้วหรือยกเลิก (สเปก §5.7)
  - คืน `queryApplied.period` (หมายเหตุปีของ #912)
- **ToolMeta:**

```ts
{
  name: 'expense.get_vat_readiness',
  description: "Summarize input-VAT readiness of this company's expense records for a period: VAT found on documents split into claimable, still under review and not claimable, with counts, plus up to 10 records blocking a claim and why (no evidence file, tax evidence under review, not usable as tax evidence, vendor tax ID or address missing). Reads records only; it is not the tax module's VAT return summary (tax.get_vat_summary).",
  businessSubjects: ['expense', 'tax'],
  questionKinds: ['summary', 'breakdown', 'list'],
  category: 'read_summary',
  requiredPermissions: [],
  anyOfPermissions: ['expense.read', 'expense.review', 'expense.read_related', 'expense.read_own'],
  sourceModule: 'expenses',
  supportedAgents: ['accounting', 'general'],
  sensitiveAudit: true,
  requiresErpPermissionCheck: true,
  optionalInputFields: ['periodKey', 'fromDate', 'toDate', 'branchId'],
},
```

- **Gateway:**
  - `ROUTER_ENABLED_TOOLS`, `ALLOWED_TOOLS` และแถว coverage `expense_vat_readiness`
  - กติกาแยกจาก `tax.get_vat_summary` ซึ่งเป็นของร้านที่มี `thai_tax` ซึ่งไม่อยู่ในแพ็กเกจที่ขายและยืนยันไม่ได้ว่าเปิดใช้ (ต้องตรวจสอบ) คำตอบของ S4b จึงห้ามพึ่งเครื่องมือ `tax.*`
- **W00:** regenerate
- **Specs:** adapter spec + PG spec (สถานะทั้งสาม, blockers, ไม่มีค่าเลขผู้เสียภาษี)
- **Eval:** ชุด T อย่างน้อย 20 ข้อ × 2 ประมาณ 150–250 บาท
- **ขนาด:** 2–3 วัน

### S7 — คู่มือระบบเรื่องใหม่

- **ปิด:** H3–H5, P7
- **Web:**
  - เนื้อหาคู่มือใหม่ใน `apps/web/src/features/user-guide/`: `billing-guide.content.ts`, `team-guide.content.ts`, `counterparty-guide.content.ts`
  - หน้า route ใหม่ต่อคู่มือใต้ `apps/web/app/(workspace)/companies/[companyId]/user-guide/<เรื่อง>/page.tsx` แบบหน้า `substitute-receipts` เดิม (`UserGuidePage.tsx` เป็นตัวแสดงผลกลาง ไม่ต้องลงทะเบียน)
  - เพิ่มเคสใน `user-guide.content.spec.ts`
- **Gateway:**
  - การ์ดใน `approved-product-help.ts` (เพิ่ม `sources` + hash) และแก้ `approved-knowledge.spec.ts`
    - `card()` ผูกฟีเจอร์ตามชื่อคู่มือ (`approved-product-help.ts:11-24`) ต้องเพิ่มการผูกของคู่มือใหม่ และคู่มือแพ็กเกจต้องจำกัดผู้อ่านด้วยสิทธิ์จัดการแพ็กเกจ (มติ สเปก §10 ข้อ 2)
  - pack ต้องไม่เกิน 64 การ์ดตาม core contract §7 (pack ปัจจุบันยังห่างจากเพดานมาก)
- **เงื่อนไขก่อนเปิด:**
  - Owner อ่านข้อความก่อน (สเปก §10 ข้อ 12 ยังไม่ตัดสิน จะถามก่อน R3/R4)
  - H4 รอ add-on เปิดขาย
  - การ์ดใช้ได้เมื่อ `LINE_AI_APPROVED_KNOWLEDGE_ENABLED` เป็นจริง ค่านี้เป็น env ฝั่ง API (`packages/config/src/index.ts:36`, ค่าเริ่มต้น true, อ่านที่ `process-line-webhook.use-case.ts:3944`) ไม่ใช่ env ของ AgentCore ต้องอ่าน env ที่ deploy ของ API
- **Eval:** ชุด H อย่างน้อย 20 ข้อ × 2 ประมาณ 100–200 บาท
- **ขนาด:** 2–3 วัน + เวลาที่ Owner อ่าน

## 4. Dependencies และความเสี่ยง

| รหัส | เรื่อง | ผลกระทบ | วิธีคุม |
|---|---|---|---|
| D1 | **เสร็จแล้ว (ตรวจ 2026-09-30)** งานความรู้ทั่วไป: คำสำคัญของโมดูลที่ไม่ได้ซื้อใน `scopePolicyOverride`, `approvedHelp` ถูกใช้เป็นขอบเขตหัวข้อ, การปฏิเสธคำถามภาษีทั่วไป | S0 และ S1 ไม่ต้องรอแล้ว | #910: ยกเว้น kind `general` (`line-ai-scope-policy.logic.ts:225`), `ANSWER_PROMPT` ตอบความรู้ธุรกิจเสมอและ `approvedHelp` ไม่จำกัดหัวข้อ (`semantic-turn-v2.ts:94`), ตัด `reasonCode` ผิดรูป (`:976`), router คงคำถามตัวเลขของร้านเป็น `read` (`intent-router.agent.ts:484`); #916: persona ในผู้อ่านเอกสาร, "แค่ถาม" ยังเป็นคำถามไฟล์, "ข้อมูล ณ" ตามวันไทย, ชื่อเดือนไทยแบบพูด; S1 แก้ `line-ai-scope-policy.logic.ts` ได้เลยหลังตรวจว่าไม่มีงานอื่นแก้อยู่ |
| D2 | ตัวคำนวณยอดเครดิต (`quotaSummary`) ของงาน E9 แผน add-on | S2b ต้องใช้ตัวเดียวกัน — **ยังติด**: E9 ยังไม่เริ่ม `quotaSummary` ยังเป็นแค่ type และ ledger ยังไม่ทำงานกับร้านใด (ไม่มีโค้ดตั้ง `aiCreditCutoverAt` นอกจาก spec ทดสอบ) | รอ E9 ห้ามมีสองชุด; มติ Owner 2026-09-30: ไม่ดึงงาน E9 มาทำก่อนกำหนด S2b ออกพร้อมการเปิดขายเครดิต add-on และเมื่อเปิดขาย ปุ่มของผู้มีสิทธิ์ซื้อเปลี่ยนจากหน้าแพ็กเกจเป็น "ซื้อเครดิตเพิ่ม" (S2b) |
| D3 | กติกา release ร่วมของ add-on กับส่วนลดจากงาน | "ยอดเพิ่มเติม" มีความหมายเมื่อ add-on เปิดขาย ซึ่งยังไม่เปิด (`chat-credit-and-receipt-addons-plan-th.md:36-37`) | S2b ออก release เดียวกับ add-on (R2) |
| D4 | env ของ AgentCore ถูกคัดลอกค้างตอน release (`infra/kamal/release.py` `agentcore()` คัดลอก env ที่ deploy อยู่และทับเฉพาะ key ตัวตน) | ถ้า env เก่ามีค่าที่ปิดความสามารถ เครื่องมือใหม่อาจใช้ไม่ได้บน UAT แม้ในเครื่องผ่าน (เหตุการณ์ UAT 2026-09-29) | ไม่เพิ่ม env; eval รันด้วย env ของ `agentcore-deploy.sh`; ก่อนให้ Owner ทดสอบ ให้อ่าน env จริงของ AgentCore บน UAT และลองถามคำถามของ slice หนึ่งข้อ |
| R1 | ข้อมูลส่วนบุคคล | เบอร์หรืออีเมลของพนักงานไปถึงคนที่ไม่มีสิทธิ์หรือแชตกลุ่ม หรือเลขบัตร ที่อยู่ วันเกิด เลขผู้เสียภาษีหรือเบอร์ของคู่ค้าหลุดใน LINE | ชื่อ เบอร์ และอีเมลของพนักงานส่งออกได้เฉพาะผู้มี `access.employee.read` ในแชตส่วนตัว (มติ Owner 2026-09-30 สเปก §10 ข้อ 5–6); ข้อมูลอื่นเครื่องมือไม่ส่งค่าออก (สเปก §2.5); scorer ตรวจสตริงที่ seed; `sensitiveAudit`; ไม่ทำงานในกลุ่ม |
| R2 | ร้านคนเดียว (Owner ทำทุกบทบาท) | คิวทุกคิวเป็นของ Owner และกติกาอนุมัติตัวเองต่างกันตามเอกสาร | บริษัท C ใน eval; ใช้ `selfApprovalPermitted` (`substitute-receipt.use-case.ts:53`) และ `isSelfApproval` (`reimbursement.logic.ts:329`) เดิม; ส่งบทบาทจริงเข้าเครื่องมือ (`toCtx` เดิมตั้ง `roles: []`); ห้ามตอบว่า "รอคนอื่น" ถ้าไม่มีคนอื่น |
| R3 | สาขา | ผู้จัดการที่เห็นบางสาขาได้ตัวเลขข้ามสาขา | ใช้ `branchScopeWhere` เดิม; PG spec สาขา A, B และส่วนกลางทุกเครื่องมือที่แตะรายจ่ายหรือใบเบิก |
| R4 | การตัดตามแพ็กเกจ | เครื่องมือถูกซ่อนหรือเปิดผิดร้าน | `featureKeys` ของคู่ค้าเป็น `expenses` หรือ `sales_documents`; เครื่องมือที่ตั้งใจไม่ผูกฟีเจอร์ (billing, reimbursements, employee-access) มีคอมเมนต์เหตุผล; `lineIntakeOfferedToolNames` เป็นผู้กรอง |
| R5 | ความเร็ว | ทางปกติ p95 วันนี้ 16.5 วินาทีเกินเป้า 15 วินาทีอยู่แล้ว คำถามที่อ่านสองสามครั้งอาจช้ากว่า | วัดในทุก eval; ไม่เพิ่ม deterministic family ผ่าน env; ถ้าจำเป็นให้เปิดงานแยกเพื่อย้ายรายการ family เข้าโค้ด ไม่ทำในโปรแกรมนี้ |
| R6 | ต้นทุน | คำถามละประมาณ 1 เครดิต AI ของร้าน และรายการเครื่องมือใน prompt ของ router โตขึ้น | description สั้น; วัด token ของ router ก่อนและหลังทุก slice; รวมการแก้ prompt ต่อ release |
| R7 | การอ่านซ้ำตอนส่ง | ข้อมูลที่เปลี่ยนเร็ว (อ่านใบเสร็จใหม่ระหว่างตอบ มีคนเซ็นใบรับรอง) ทำให้ `verifyDelivery` ไม่ผ่าน และลูกค้าได้ข้อความ "ข้อมูลต้นทางเปลี่ยนหรือยังตรวจสอบไม่ได้ … ถามใหม่" แทนคำตอบ (`process-line-webhook.use-case.ts:5173-5193`, สเปก §11 ข้อ 9) | ใช้วันแทนชั่วโมง; ไม่ใส่ค่าที่ขยับบ่อยเกินจำเป็นใน `data`; นับจำนวนครั้งที่ไม่ผ่านใน eval ของ S2a และ S1 |
| R8 | ตรวจตัวเลข | ตัวเลขที่ API ไม่ได้ให้ถูกปฏิเสธและคำตอบกลายเป็นข้อความล้มเหลว | ทุกผลคำนวณอยู่ใน `data`/`facts` (สเปก §5.0) |
| R9 | W00 hash | CI ล้มเพราะ manifest ไม่ตรง | regenerate ทุก slice; ห้ามแก้เอกสารที่ถูก hash โดยไม่ regenerate |
| R10 | ข้อค้นพบผิดพลาด (S4a) | เจ้าของร้านเสียความเชื่อใจ | ใช้คำว่า "ควรตรวจ", มีเกณฑ์ขั้นต่ำ, Owner อนุมัติเกณฑ์ และปรับหลังลองใช้ |
| R11 | ตัวเลขใน LINE | ขัดกฎ "ราคาไม่ส่งทาง LINE" หรือมติ "ไม่พูดเรื่องแพ็กเกจเลย" | ไม่มีราคาและชื่อแพ็กเกจอื่นในผลเครื่องมือเลย; จำนวนและวันที่บอกได้ตามมติสเปก §10 ข้อ 1; `must_not_claim` ชื่อแพ็กเกจอื่นและคำชวนอัปเกรดในชุด P (มติข้อ 4) |
| R12 | หมวดใหม่จากข้อเสนอขยายหมวด | การเทียบหมวดข้ามวันเปลี่ยนหมวดคลาดเคลื่อน | กติกาหมวดที่เพิ่งสร้างใน S4a; คำตอบบอกว่าเทียบไม่ได้ตรงตัว |
| R13 | โมดูลที่ยังไม่เสร็จหรือยืนยันไม่ได้ว่าเปิดใช้ | น้องมั่งมีชวนซื้อ อัปเกรด หรือพึ่งเครื่องมือของโมดูลที่ยังไม่พร้อม เช่น ยอดขาย สต็อก ภาษีเต็มรูป | ตารางความพร้อมของโมดูล (สเปก §2.2); ข้อความคงที่เดิมไม่แก้; กฎห้ามชวนซื้อ (สเปก §6.2); ชุด G-04, G-05, G-09 ใน eval ของทุก release; ไม่มี slice พึ่งโมดูลที่ติด ต้องตรวจสอบ |

## 5. สิ่งที่ไม่ทำในโปรแกรมนี้

- **งานขั้นสุดท้ายผ่าน LINE:** ไม่อนุมัติ จ่าย ยืนยัน ยกเลิก เซ็น รับรอง ซื้อ หรือเปลี่ยนสิทธิ์ (ทำได้แค่ส่งลิงก์)
- **การค้นข้อมูลสาธารณะ:** ยังไม่เปิด public lookup (C09)
- **สวิตช์และทางลัด:** ไม่เพิ่ม flag หรือ env และไม่เพิ่มทางลัด deterministic ใหม่
- **โมเดล:** ไม่เปลี่ยนโมเดลหรือผู้ให้บริการ
- **มุมมองทั้งร้าน:** ไม่ทำรายการใบรับรองของทั้งร้าน (S5 ในสเปก §4.3) และไม่ทำคิวสแกนฉบับกระดาษของฝ่ายการเงิน
- **สิทธิ์ของบทบาท:** ไม่ทำเครื่องมืออ่านสิทธิ์ของบทบาท ("ใครอนุมัติได้บ้าง" ต้องใช้ `access.role.read`)
- **ENTERPRISE:** ไม่ทำเครื่องมืออ่านภาษีหัก ณ ที่จ่ายหรือ 50 ทวิ (ยืนยันไม่ได้ว่าเปิดใช้ — ต้องตรวจสอบ)
- **ข้อความเชิงรุก:** ไม่ส่งข้อความสรุปหรือแจ้งเตือนรายการแปลกเอง (starter gap audit G3 เป็นงานแยก)
- **ข้อมูลติดต่อ:** บอกชื่อ เบอร์ และอีเมลของพนักงานได้เฉพาะผู้มี `access.employee.read` ในแชตส่วนตัว (มติ Owner 2026-09-30 สเปก §10 ข้อ 5–6) นอกนั้นไม่อ่านค่าข้อมูลติดต่อออกมา
  - ไม่อ่านเลขบัตรประชาชน ที่อยู่ และวันเกิดของใคร
  - เลขผู้เสียภาษีและเบอร์ของคู่ค้ายังไม่อ่านออกมา จนกว่าจะได้คำตอบสเปก §11 ข้อ 19 (ถามก่อน R3)
  - ไม่ส่งออกรายชื่อเป็นไฟล์
- **งานของคนอื่น:** งาน D1 merge แล้ว (#910, #916) โปรแกรมนี้ไม่ย้อนแก้พฤติกรรมที่งานนั้นตั้งไว้ นอกจากข้อที่ชุด G วัดแล้วไม่ผ่าน (S0)
- **แพ็กเกจอื่น:** ไม่แนะนำหรือเอ่ยชื่อแพ็กเกจอื่น และไม่ชวนอัปเกรด แม้ใบเสร็จจะไม่พอ (มติ Owner 2026-09-30 สเปก §10 ข้อ 4)
- **ทางตอบฟรี:** ไม่ทำทางตอบตายตัวที่ไม่หักเครดิตสำหรับคำถามแพ็กเกจหรือเครดิต (มติ Owner 2026-09-30 สเปก §10 ข้อ 3)
- **เส้นทางตายตัวเดิม:** ไม่เปลี่ยนเนื้อหาคำตอบนโยบายสาธารณะ คำตอบส่วนลดจากงาน และการ์ดแพ็กเกจหมดอายุ
  - ยกเว้นงาน S8 ตามมติ Owner 2026-09-30: ปุ่มตามสิทธิ์ซื้อในการ์ดเครดิตหมดและการ์ดโควตาใบเสร็จ และปุ่มกับประโยคติดต่อเจ้าหน้าที่แทนลิงก์แพ็กเกจในการ์ดคำถามนโยบาย (สเปก §2.2, §11 ข้อ 17)
- **ยอดขายและสต็อก:** ยังพัฒนาไม่เสร็จ (Owner 2026-09-29)
  - คำถามข้อมูลร้านเรื่องนี้อยู่ในหมวดอนาคต (§1.1, สเปก §4.12) ไม่มี slice
  - ไม่เสนอคำชวนซื้อหรืออัปเกรด และไม่แก้ข้อความคงที่ "แพ็กเกจที่ใช้อยู่ยังไม่มีเรื่อง…" ที่ใช้อยู่
- **โมดูลที่ยืนยันไม่ได้ว่าเสร็จและเปิดใช้:** ไม่ออกแบบคำตอบที่พึ่งจัดซื้อ ภาษีเต็มรูป บัญชีแยกประเภท รายงาน ลูกค้าสัมพันธ์ ธนาคาร และงานอัตโนมัติ — ต้องตรวจสอบ
- **เอกสารที่ W00 hash:** ไม่แก้ใน PR นี้

## 6. ลำดับการปล่อยใช้งาน

R1 เริ่ม implement 2026-09-30: Owner อ่านแผนแล้วให้ "รันทดสอบก่อนดีกว่า ทำเป็นชุดๆ" คือทำและทดสอบทีละชุดตาม release ด้านล่าง งบทดสอบกับโมเดลจริงของ R1 ไม่เกิน 800 บาท (มติ Owner 2026-09-30 สเปก §10 ข้อ 11) สเปก §10 ข้อ 8 และ 12 ยังไม่ตัดสิน จะถามก่อน R3/R4

| Release | Slice | หมายเหตุ |
|---|---|---|
| R1 | S0, S2a, S1, S3, S8 | ชุดแรกที่ Owner เห็นผลชัด (แพ็กเกจ ลายเซ็น ใบเบิกค้าง ความรู้ทั่วไป) พร้อมงานตายตัวของปุ่มและลิงก์ในการ์ด (S8) |
| R2 | S2b | ออกพร้อม release ร่วมของ add-on และส่วนลดจากงาน (D3) |
| R3 | S5, S6 (+ การ์ด S7 ของพนักงานและคู่ค้า) | สเปก §10 ข้อ 5–7 ตอบแล้ว 2026-09-30 ก่อนเริ่มต้องถาม §10 ข้อ 12 และ §11 ข้อ 19 และปิดข้อตรวจ §11 ข้อ 20–21 |
| R4 | S4a, S4b (+ การ์ด S7 ที่เหลือ) | หลัง Owner อนุมัติเกณฑ์ข้อ 8 |

ขั้นตอนต่อ release:

1. **Merge ทีละ slice** เข้า develop (CI รันครั้งเดียวตอน merge ตามคำสั่ง Owner 2026-09-21)
2. **รันชุด eval ซ้ำบน candidate:** รันทุกชุดของ slice ใน release หนึ่งรอบบน commit ที่จะขึ้น UAT รวมชุดกันถดถอยของโปรแกรมรายจ่าย (สเปก §9.1)
3. **เปิด PR เข้า main** จาก branch ที่แตกจาก main (ยกงานชุดเดียวกัน)
4. **UAT ตาม runbook:**
   - อ่าน `docs/runbooks/cloud-environment-operations.md` และ `docs/runbooks/uat-production-v2-deployment.md` ก่อน
   - ใช้เส้นทางที่ใช้อยู่ ณ วันนั้น: Kamal (`infra/kamal/deploy-uat`) หรือ workflow
   - ตรวจว่าไม่มี run อื่นค้าง ทำ dispatch ครั้งเดียว จด ID ทันที และรอจนจบ
5. **อ่าน env จริงของ AgentCore บน UAT (D4)** แล้วถามคำถามตัวอย่างของแต่ละ slice บน UAT หนึ่งข้อก่อนส่งให้ Owner
6. **Owner ทดสอบบน LINE ของ UAT** ด้วยชุดคำถามภาษาไทยธรรมดาของ release นั้น (ประมาณ 10 ข้อ จากตัวอย่าง Owner และสเปก §9.2)
7. **ถาม Owner ก่อนขึ้น Production ทุกครั้ง** ด้วยภาษาไทยธรรมดา แล้วรอคำตอบ "ไป" ที่ชัดเจน (ใบรับรองของ UAT ใช้ได้ 24 ชั่วโมง)
8. **Production ตาม runbook** (READY แล้ว Production หรือ `infra/kamal/promote-prod`)
   - ตรวจรับภายในประมาณ 5 นาทีหลังเว็บพร้อม
   - เปิด customer gate เป็น `OPEN` แล้วตรวจรับหลัง logout
   - จด run หรือ operation ID ทั้งหมดใน ledger ของ runbook
9. **อัปเดตบันทึกงาน สเปก และแผน** ด้วยผลจริง

## 7. เอกสารที่ต้องแก้ตามตอนลงมือ (ไม่แก้ใน PR นี้)

| เอกสาร | สิ่งที่ต้องแก้ | เมื่อไร |
|---|---|---|
| `docs/specs/mangmee-accounting-tax-knowledge-spec-th.md` §5 | หมายเหตุมติ Owner 2026-09-29 เรื่องคำอธิบายทั่วไปของ R3/R4 | S0 |
| `docs/specs/mangmee-ai-expense-advisor-spec-th.md` §0 | ชี้มาที่สเปกนี้สำหรับโดเมนนอกรายจ่าย | S0 |
| `docs/specs/line-ai-capability-help-entitlement-spec.md` | กลุ่มความสามารถ `package` และ `team` | S2a, S6 |
| `docs/specs/chat-credit-and-receipt-addons-spec-th.md` §7.2 | มติ Owner 2026-09-30 สเปก §10 ข้อ 1 (บอกจำนวนและวันที่ใน LINE ได้ ไม่บอกราคา) และตัวคำนวณร่วมของ E9 | S2b |
| `docs/specs/mangmee-ai-core-capability-contract-2026-09-27.md`, `docs/plans/mangmee-ai-implementation-index-2026-09-27.md` | รายการ operation ใหม่ (ไฟล์ถูก W00 hash ต้อง regenerate ใน PR เดียวกัน) | ทุก slice ที่เพิ่มเครื่องมือ |
| `docs/research/mangmee-ai-capability-manifest-2026-09-27.md` | จำนวน operation ที่ลงทะเบียน | ทุก slice ที่เพิ่มเครื่องมือ |

## 8. เวลาและค่าใช้จ่ายรวมโดยประมาณ

| Slice | วันทำงาน (คนเดียว) | ค่าทดสอบโมเดลจริง |
|---|---|---|
| S0 | 0.5 | 50–100 บาท |
| S2a | 2.5–3.5 | 150–250 บาท |
| S1 | 2.5–3.5 | 150–250 บาท |
| S3 | 2–2.5 | 100–200 บาท |
| S8 | 1–1.5 | ไม่มี (unit spec) |
| S2b | 1–2 หลัง E9 | 100–200 บาท |
| S5 | 1–1.5 | 80–150 บาท |
| S6 | 1.5–2 | 100–200 บาท |
| S4a | 4–6 | 200–350 บาท |
| S4b | 2–3 | 150–250 บาท |
| S7 | 2–3 + เวลา Owner | 100–200 บาท |
| ชุดกันถดถอยต่อ release | — | ประมาณ 50–70 บาทต่อครั้ง × 4 |
| **รวม** | **ประมาณ 20–29 วันทำงาน** (ถ้าทำขนานสองถึงสามสาย ใช้เวลาจริงประมาณ 2–3 สัปดาห์ ไม่รวมเวลารอ D2 และคำตอบของ Owner) | **ประมาณ 1,300–2,300 บาท** (อนุมัติแล้วเฉพาะ R1 ไม่เกิน 800 บาท) |

- **งบ R1 (มติ Owner 2026-09-30 สเปก §10 ข้อ 11):** ไม่เกิน 800 บาท สำหรับ S0, S2a, S1 และ S3 ส่วน S8 ไม่ใช้
  - ประมาณการของสี่ slice รวม 450–800 บาท และชุดกันถดถอยของ R1 อีกประมาณ 50–70 บาท ถ้าทุก slice ใช้ถึงขอบบนจะเกินเพดาน
  - ให้ติดตามยอดจริงหลังแต่ละ slice และแจ้งผู้คุมก่อนถึงเพดาน
  - release ถัดไปทำต่อทีละชุดตามแผน
- **ที่เปลี่ยนจากฉบับ 2026-09-29:** S0 ลดลงเพราะ #910 ทำส่วนใหญ่แล้ว ส่วน S2a, S1 และ S3 เพิ่มขึ้นจากสิ่งที่พบในโค้ดหลัง #903–#928 (ดูรายละเอียดในแต่ละ slice) เพิ่ม S8 ตามมติ Owner 2026-09-30 ซึ่งไม่ใช้งบทดสอบกับโมเดลจริง และ S5 เพิ่มจากขอบเขตคู่ค้าตามสาขา (มติ §10 ข้อ 7)
- **ค่าทดสอบ** มาจากขนาดชุด × 2 รอบ × ประมาณ 1 บาทต่อข้อความ บวกรอบแก้ 2–3 รอบ
- **อ้างอิง:** รอบ NAT05 + NAT06 (10 ข้อความ) ใช้ประมาณ 15 บาทต่อรอบ และรอบเต็มของโปรแกรมรายจ่าย (ประมาณ 260 ข้อ) ใช้ 100–250 บาท
- **ต้นทุนต่อคำถามของลูกค้า** ประมาณ 1 บาท (≈ 1 เครดิต AI) ตามสเปก §8
