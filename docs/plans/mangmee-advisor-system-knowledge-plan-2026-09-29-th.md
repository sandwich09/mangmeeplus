# แผน: น้องมั่งมีที่ปรึกษา — ตอบเรื่องร้านและระบบ

สเปก: [mangmee-advisor-system-knowledge-2026-09-29-th.md](../specs/mangmee-advisor-system-knowledge-2026-09-29-th.md) · เอกสารคู่: [ข้อเสนอขยายหมวดค่าใช้จ่าย](../specs/mangmee-expense-category-expansion-2026-09-29-th.md)
วันที่: 2026-09-29 · สถานะ: **DRAFT — ยังไม่เริ่ม implement รอ Owner ตัดสินสเปก §10** · อัปเดต 2026-09-29: รวมมติ Owner ว่าโมดูลยอดขายและสต็อกยังพัฒนาไม่เสร็จ (§1.1)
ฐานโค้ดที่ตรวจ: `origin/develop` `9e38e8e9`
บันทึกงาน: สร้าง `docs/agent-memory/mangmee-advisor-system-knowledge-2026-09-29.md` เมื่อเริ่ม slice แรก (ตาม AGENTS.md)

## 0. กติการ่วมทุก slice

- **ขอบเขตระหว่างแอป:** AI Gateway เรียกเครื่องมือของ API ที่ตรวจสิทธิ์แล้วเท่านั้น ห้ามอ่านฐานข้อมูลหรือ repository เอง (AGENTS.md)
- **ขนาดงาน:** ponytail full — diff สั้นที่สุด ใช้ pattern เดิม ไม่เพิ่ม dependency และห้ามแก้ `package.json`
- **ไม่มีสวิตช์:** ไม่เพิ่ม flag หรือ env ไม่เพิ่ม family ใน `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES` และไม่ปิดฟีเจอร์ด้วย config (สเปก §2.8)
- **วิธีทำงาน (คำสั่ง Owner 2026-09-19):**
  - ผู้คุมเขียน brief ตรวจ diff ทุกชิ้น รัน eval กับโมเดลจริง push เปิด PR และสื่อสารกับ Owner
  - ผู้ทำเป็น subagent หนึ่งงานต่อหนึ่ง worktree ห้ามสอง agent แก้ไฟล์เดียวกันพร้อมกัน
- **ไฟล์ใหญ่ที่หลายงานแตะ:** ตรวจก่อนทุกครั้งว่าไม่มีงานอื่นกำลังแก้
  - `process-line-webhook.use-case.ts`, `semantic-turn-v2.ts`, `intent-router.agent.ts`, `line-ai-scope-policy.logic.ts`, `ai-tools.ts`
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
- **W00:** slice ที่แตะ registry, controller, module, config หรือ webhook ต้อง regenerate manifest (§2 ข้อ 9) และ commit ไฟล์ JSON ใน PR เดียวกัน
- **ทดสอบกับโมเดลจริงก่อน merge:** ตามสเปก §9 เก็บหลักฐานไว้ใน `docs/research/mangmee-advisor-eval-<slice>-2026-..-th.md` พร้อม evidence JSON แบบโปรแกรมรายจ่าย
- **Merge:**
  - PR เข้า develop ทีละ slice
  - รวม slice เป็น release แล้วเปิด PR เข้า main จาก branch ที่แตกจาก main
  - deploy แยกจาก merge (§6)

## 1. ลำดับ slice

เรียงตามคุณค่าต่อ Owner เทียบกับแรงที่ใช้และสิ่งที่ต้องรอ:

| ลำดับ | Slice | ปิดคำถาม (สเปก §4) | คุณค่า | ขนาด | ต้องรอ | Release |
|---|---|---|---|---|---|---|
| 1 | **S0** นโยบายความรู้ทั่วไป | G1–G8 | สูง (กระทบทุกคำตอบ) | เล็ก 0.5–1 วัน | D1 | R1 |
| 2 | **S2a** แพ็กเกจและโควตาใบเสร็จ | #1, P1–P4, P8 | สูงมาก | กลาง 2–3 วัน | — | R1 |
| 3 | **S1** ใบรับรองที่ต้องเซ็น + งานค้างของฉัน | #7, Q1–Q2, S1–S3 | สูง | กลาง 2–3 วัน | D1 (ไฟล์ scope policy) | R1 |
| 4 | **S3** ใบเบิกค้างที่ใคร | #5, R1–R4 | สูง | เล็กถึงกลาง 1.5–2 วัน | — | R1 |
| 5 | **S2b** เครดิต AI คงเหลือ | #2, P5 | สูงมาก | เล็กถึงกลาง 1–2 วัน หลัง D2 | D2, D3 | R2 (ออกพร้อม add-on) |
| 6 | **S5** คู่ค้า | #6, V1–V5 | กลาง | เล็ก 1 วัน | — | R3 |
| 7 | **S6** สมาชิกและข้อมูลที่ขาด | #4, M1–M4 | กลาง | เล็กถึงกลาง 1.5–2 วัน | สเปก §10 ข้อ 5–7 | R3 |
| 8 | **S4a** รายจ่ายผิดปกติ | #3, E1–E5 | สูง | ใหญ่ 4–6 วัน | สเปก §10 ข้อ 8 | R4 |
| 9 | **S4b** ภาษีซื้อพร้อมขอคืน | T1–T2 | กลางถึงสูง | กลาง 2–3 วัน | สเปก §11 ข้อ 10 | R4 |
| 10 | **S7** คู่มือระบบเรื่องใหม่ | H3–H5, P7 | กลาง | กลาง 2–3 วัน + เวลา Owner อ่าน | สเปก §10 ข้อ 12; H4 รอ add-on เปิดขาย | R3/R4 |

เหตุผลของลำดับ:

- **S2a มาก่อน:** ตอบตัวอย่าง Owner สองข้อ (#1 และส่วนแพ็กเกจของ #2) มีผลเชิงธุรกิจ และไม่ต้องรอใคร
- **คิวลายเซ็นกับคิวอนุมัติ (S1, S3):** เป็นงานที่ใช้ทุกวัน
- **เครดิต (S2b):** ต้องรอตัวคำนวณยอดตัวเดียวกับแผน add-on
- **เครื่องมือรายชื่อ (S5, S6):** เล็กและตามมาได้เร็ว
- **รายจ่ายผิดปกติ (S4a):** ใหญ่ที่สุดและต้องให้ Owner อนุมัติเกณฑ์ก่อน จึงไว้ท้าย
- **ข้อเสนอขยายหมวดค่าใช้จ่าย:** เอกสารคู่ ทำให้ S4a และการแยกยอดคมขึ้น ถ้าทำก่อน S4a ต้องใช้กติกา "หมวดที่เพิ่งสร้าง" ใน §3 S4a

### 1.1 อนาคต — หลังโมดูลยอดขายและสต็อกเปิดใช้ (ไม่มี slice ในแผนนี้)

Owner 2026-09-29: "ยอดขาย สต็อก เรายัง dev ไม่เสร็จเลย ไม่อยู่ในแพ็กเกจถูกแล้ว"

- **คำถามข้อมูลร้านเรื่องยอดขาย ลูกหนี้ ใบแจ้งหนี้ สต็อก และกำไร** (สเปก §4.12 F1–F4) ไม่อยู่ใน slice ใด และไม่มีประมาณการเวลาในแผนนี้
- **วันนี้:**
  - ตอบด้วยข้อความคงที่เดิมของ `scopePolicyOverride` ซึ่ง **คงไว้ตามเดิม** หรือด้วยการปฏิเสธแบบ feature_disabled เดิมเมื่อข้อความไม่มีคำสำคัญ
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
4. **DI:**
   - `apps/api/src/modules/line-ai/line-ai.module.ts` (`erpTools`)
   - `apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.ts` (constructor + `toolMap.set`)
5. **หลักฐานการอ่าน:** `isLineEvidenceRead` ครอบคลุมทุก read category อยู่แล้ว แต่ผลต้องอ่านซ้ำได้ค่าเดิม (สเปก §5.0)
6. **Gateway:**
   - `ROUTER_ENABLED_TOOLS` (`apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts`)
   - `ALLOWED_TOOLS` (`apps/ai-gateway/src/modules/line-ai/agents/accounting-summary.agent.ts`)
   - แถว coverage หนึ่งแถวต่อเครื่องมือ (`line-ai-feature-coverage.ts` ซึ่ง spec บังคับให้ทุก registry tool อยู่ครั้งเดียว)
   - ข้อความกลุ่มความสามารถ TH/EN (`CAPABILITY_COPY` ใน `response-composer.agent.ts`) ถ้าเพิ่มกลุ่ม
7. **กติกา router และ compose:**
   - `CONTROL_PROMPT` และ `ANSWER_PROMPT` (`semantic-turn-v2.ts`) รวมถึง prompt ระบบของ router (`intent-router.agent.ts`)
   - รวมการแก้ prompt ต่อ release เพราะทุกการแก้ทำให้แคชของ router และ compose ต้องเขียนใหม่
8. **ชื่อที่ใช้กรอง** (`search`) ต้อง ground กับข้อความผู้ใช้ด้วย `nameFilterGroundedInText` (`read-tool-input.ts`)
9. **W00:** `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts` แล้ว commit `docs/research/mangmee-ai-capability-manifest-2026-09-27.json`
10. **Spec + ลงทะเบียนใน catalog**
11. **Typecheck** สาม package
12. **Whole-chain acceptance**
13. **Eval กับโมเดลจริง** ต้องผ่านสองรอบติดกัน (สเปก §9)
14. **บันทึกงานและเปิด PR เข้า develop**

**Answer family ของเครื่องมือใหม่ทุกตัว:** ทางปกติ (compose + grounding) ไม่เพิ่ม `tool::shape` ใน deterministic families (สเปก §2.8)

## 3. รายละเอียดแต่ละ slice

### S0 — นโยบายความรู้ทั่วไป (เริ่มหลัง D1)

- **ปิด:** ชั้น ก ง ฉ ในสเปก §2.1 ไม่มีเครื่องมือใหม่
- **ขั้นแรกคือวัด:** รันชุด G (สเปก §9.2) บนโค้ดที่ merge งานคืนนี้แล้ว และแก้เฉพาะข้อที่ไม่ผ่าน
  - หมายเหตุท้ายคำตอบที่เป็นคำแนะนำ (ชั้น ก): เพิ่มกติกาใน `ANSWER_PROMPT` หรือ `MANGMEE_PERSONA_PROMPT` (`mangmee-persona.ts`) ใช้หนึ่งประโยคต่อคำตอบ ไม่ใส่กับคำถามนิยาม
  - ชวนกลับจากเรื่องนอกธุรกิจ (ชั้น ง): ตัวอย่างต้องมาจากความสามารถที่ผู้ถามใช้ได้ ข้อมูลนี้อยู่ใน `approvedHelp` แล้ว (`buildCapabilityHelp`)
  - ข้อมูลปัจจุบัน (ชั้น ฉ): ห้ามแต่งแหล่งอ้างอิง
  - ห้ามชวนซื้อหรืออัปเกรดเรื่องยอดขาย สต็อก และโมดูลที่ยังไม่เปิดใช้ (สเปก §6.2): ถ้าชุด G-04, G-05 หรือ G-09 พบคำชวน ให้เพิ่มกติกาใน `ANSWER_PROMPT`
- **ห้ามแตะ `line-ai-scope-policy.logic.ts` ใน S0** เพราะงานคืนนี้เป็นเจ้าของไฟล์นั้น และข้อความคงที่ `unsoldModuleReplyText` ต้องคงไว้ตามเดิม (Owner 2026-09-29)
- **Specs:** `mangmee-persona.spec.ts` (ถ้าแก้ copy), `semantic-turn-v2-grounding.spec.ts` (หมายเหตุต้องไม่พาตัวเลขใหม่เข้ามา)
- **W00:** รัน manifest spec เพื่อยืนยันว่าไม่มีไฟล์ที่ถูก hash เปลี่ยน
- **Eval:** ชุด G อย่างน้อย 20 ข้อ × 2 รอบ ประมาณ 50–100 บาท
- **ต้นทุนต่อข้อความ:** 0.4–0.7 บาท (ไม่อ่านข้อมูล)
- **ขนาด:** 0.5–1 วัน

### S2a — แพ็กเกจและโควตาใบเสร็จ

- **ปิด:** #1, P1–P4, P8
- **API:**
  - ใหม่ `apps/api/src/modules/line-ai/domain/logic/package-usage-pace.logic.ts` เป็น pure function สูตร `package-pace-v1` (สเปก §5.1) ใช้ civil-date helper เดิม
  - ใหม่ `apps/api/src/modules/line-ai/application/use-cases/erp-package-tools.use-case.ts` → `BillingGetPackageUsageTool`
    - แพ็กเกจ: `CompanyPlanTerm` (`tierKey`, `termEndsAt`) + `effectivePlanCapacity` ชื่อใช้ `PLAN_TIER_PRESETS[tier].labelTh`
    - รูปแบบต่ออายุ: `BillingService.account()` (อ่าน DB อย่างเดียว; `BillingModule` ถูก import อยู่แล้ว)
    - จำนวนสาขาและสมาชิกที่ใช้อยู่: ใช้ count ชุดเดียวกับหน้าความจุของแพ็กเกจ (`billing-capacity.ts` — ต้องตรวจสอบชื่อฟังก์ชัน)
    - ใบเสร็จ: `receiptQuotaSnapshot` (`company-ocr-governance.ts`)
    - ไม่มี `company.plan.manage` → `forbidden` พร้อม `errorCode: 'PACKAGE_MANAGER_REQUIRED'`
    - ห้ามเรียก `BillingService.status()`
  - DI: `line-ai.module.ts` + `internal-tools.controller.ts`
- **ToolMeta:**

```ts
{
  name: 'billing.get_package_usage',
  description: "Read THIS company's current package for a caller who manages it: the package name, the date it runs until, branch and member capacity used, and receipt reads used/limit/remaining in the current allowance with an API-computed straight-line projection to its end (and, once available, remaining AI credit). Never prices. Use for 'is my package enough', 'how many receipts are left', 'can I add a branch', 'how much AI credit is left'. Public package prices and package contents are not this tool.",
  businessSubjects: ['company', 'expense'],
  questionKinds: ['summary'],
  category: 'read_summary',
  requiredPermissions: ['company.plan.manage'],
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
  - `PACKAGE_MANAGER_REQUIRED`: แปลงเป็นข้อความคงที่ P8 แบบเดียวกับ `REIMBURSEMENT_APPROVAL_NOT_PERMITTED`
    - `business-read-result-semantics.ts`: ค่าคงที่และข้อความ
    - `semantic-turn-v2.ts`: forced outcome
    - `prepared-simple-read-formatter.ts`: ถ้าทางลัดเจอ
  - `CONTROL_PROMPT`: "For THIS company's package, receipt quota, capacity or AI credit, call billing.get_package_usage; when the question also refers to expense volume, add expense.list_recent for the same current period. Public package prices or contents are never this tool."
  - `ANSWER_PROMPT`: ห้ามราคา และคาดการณ์ต้องใช้ค่า `pace` ของเครื่องมือพร้อมคำว่า "คาดการณ์"
- **W00:** regenerate
- **Specs:**
  - `package-usage-pace.logic.spec.ts`: เกณฑ์ 7 วัน, ไม่จำกัด, shortfall 0, การปัดขึ้น, ความยาวเดือน, รอบแบบ `PAID_GRANTS`
  - `erp-package-tools.use-case.spec.ts`
    - forbidden เมื่อไม่มีสิทธิ์
    - ไม่มี field ราคา
    - อ่านสองครั้งได้ `lineReadResultHash` เท่ากัน
    - แปลง `LEGACY_MONTH` กับ `PAID_GRANTS` ถูก
  - PG `apps/api/src/modules/line-ai/application/package-usage.pg.spec.ts`: ใช้แถวจริงของโควตา รวมยอดแถมและ lot แบบ `PAID_GRANTS` และนับสาขากับสมาชิก → `reliability-postgres-v2`
- **Eval:** ชุด P อย่างน้อย 20 ข้อ × 2 ประมาณ 150–250 บาท
- **ต้นทุนต่อข้อความ:** 0.9–1.3 บาท (อ่าน 1–2 ครั้ง)
- **ขนาด:** 2–3 วัน

### S1 — ใบรับรองที่ต้องเซ็น + งานค้างของฉัน

- **ปิด:** #7, Q1–Q2, S1–S3
- **API domain:**
  - `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts`: เพิ่ม `ListMySubstituteReceiptSignaturesUseCase` อ่านอย่างเดียว ไฟล์เดียวกัน จึงใช้ `isEligibleSubstituteReceiptApprover` และ `selfApprovalPermitted` ได้โดยไม่ต้อง export
    - ฝั่งผู้จ่ายเงิน: `PREPARED` + `payerUserId = ฉัน` + สาขาที่เห็น
    - ฝั่งผู้อนุมัติ: `PAYER_CERTIFIED` + สาขาที่ฉันเป็นผู้อนุมัติได้ (`listEligibleSubstituteReceiptApprovers` ต่อสาขา + นโยบาย `getSubstituteReceiptPolicy`)
    - ตัดใบของตัวเองเมื่อ `selfApprovalPermitted` ไม่ผ่าน และฉบับแก้ไขต้องเป็นผู้อนุมัติเดิม
    - นับด้วย DB ไม่โหลดทั้งหมด
  - `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`: เพิ่ม method แคบ `listSubstituteReceiptsAwaitingSignature` ที่ select เฉพาะ field ในสเปก §5.2 (ไม่มี `payeeTaxId`, `payeeAddress`)
  - `apps/api/src/modules/expenses/expenses.module.ts`: export use case ใหม่
  - ไม่แก้ `assertWeb` ของ certify, approve และการอัปโหลดลายเซ็น
- **API adapter:** ใหม่ `apps/api/src/modules/line-ai/application/use-cases/erp-substitute-receipt-tools.use-case.ts` → `ExpenseListSubstituteReceiptsToSignTool` แปลงสถานะเป็นคำไทย (`stepLabel`) ไม่ส่ง enum
- **ToolMeta:**

```ts
{
  name: 'expense.list_substitute_receipts_to_sign',
  description: "List substitute receipts (ใบรับรองแทนใบเสร็จรับเงิน) waiting for THIS user's own signature: as the named actual payer who must certify, or as an eligible approver who must approve. Returns counts per step and up to 10 items each (document number, payee name, amount, date). Signing and approving happen only on the web. Never another person's queue and never a company-wide list.",
  businessSubjects: ['expense'],
  questionKinds: ['summary', 'list'],
  category: 'read_summary',
  // Any active member may be named the payer (listActiveMemberIdentities) and the web certify step
  // checks only that; the approver half checks expense.confirm and eligibility inside the tool.
  requiredPermissions: ['ai.tool.invoke'],
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
  - "งานค้างของฉัน": คำอธิบายของ `expense.get_daily_closing` ใน registry ห้ามเรียกเครื่องมืออื่นร่วมกับคำถาม "วันนี้ต้องทำอะไร"
    - ต้องแก้คำอธิบายนั้นให้เรียกคิวลายเซ็นร่วมได้เมื่อเครื่องมือถูกเสนอ และเพิ่มกติกาเดียวกันใน `CONTROL_PROMPT`
    - การแก้นี้กระทบพฤติกรรมที่จูนไว้ในโปรแกรมรายจ่าย จึงต้องรันชุดกันถดถอย (สเปก §9.1)
  - `scopePolicyOverride` ข้อ 2 (หลัง D1 merge และประสานกับเจ้าของไฟล์) เพิ่มกฎงานบนเว็บของใบรับรอง
    - คำนาม: `ใบรับรอง`, `ใบแทนใบเสร็จ`, `ใบรับรองแทนใบเสร็จ`
    - คำกริยา: `เซ็น`, `ลงนาม`, `ลงชื่อ`, `ลงลายมือชื่อ`, `รับรอง`, `อนุมัติ`
    - เพิ่มวลีสถานะที่ต้องตัดก่อนจับคำกริยา: `รอเซ็น`, `เซ็นแล้ว`, `รอลงนาม`, `ลงนามแล้ว`, `รอรับรอง` เพื่อให้ "มีใบรับรองรอเซ็นกี่ใบ" เป็นคำถาม ไม่ใช่คำสั่ง
    - ลิงก์ไปหน้ารายการใบรับรองบนเว็บ
- **W00:** regenerate
- **Specs:**
  - unit ของ use case (เพิ่มเคสในไฟล์ spec เดิมของ substitute receipt หรือไฟล์ใหม่ `substitute-receipt-signature-queue.use-case.spec.ts`)
  - PG `apps/api/src/modules/expenses/substitute-receipt-signature-queue.pg.spec.ts`: `OWNER_SELF` vs `DESIGNATED_APPROVERS`, ผู้จ่ายเป็นตัวเอง, ฉบับแก้ไข, สาขา, ฉบับกระดาษ
  - adapter spec (ไม่มีเลขผู้เสียภาษีและที่อยู่ใน JSON, `accessScope: 'own'`, hash คงที่)
  - `line-ai-scope-policy.logic.spec.ts`
- **Eval:** ชุด S อย่างน้อย 20 ข้อ × 2 ประมาณ 150–250 บาท
- **ต้นทุนต่อข้อความ:** 0.9–1.3 บาท โดยคำถาม Q1 อ่าน 2–3 ครั้งอาจถึงประมาณ 1.5 บาท
- **ขนาด:** 2–3 วัน

### S3 — ใบเบิกค้างที่ใคร

- **ปิด:** #5, R1–R4
- **API domain:** `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-summary.use-case.ts` เพิ่ม `GetReimbursementApprovalBacklogUseCase`
  - ขอบเขตเหมือน `GetReimbursementAiSummaryUseCase`
  - สถานะที่นับ: `PENDING_APPROVAL`, `FINANCE_REVIEW`, `READY_FOR_PAYMENT`, `PARTIALLY_PAID` และ `APPROVED` ที่ยังเป็นสถานะชั่วคราว
  - ขั้นอนุมัติที่ค้าง: `repo.findPendingApprovalSteps`; ชื่อ: `repo.getUserDisplayNames`; โต๊ะ: `currentDesk` (`reimbursement.logic.ts`)
  - จำนวนวันรอคิดตามวันไทย และบันทึก audit `reimbursement.ai_tool.read` แบบเดียวกับ AI summary
  - export จาก `reimbursements.module.ts`
- **API adapter:** `apps/api/src/modules/line-ai/application/use-cases/erp-reimbursement-tools.use-case.ts` เพิ่ม `ReimbursementGetApprovalBacklogTool`
- **ToolMeta:**

```ts
{
  name: 'reimbursement.get_approval_backlog',
  description: 'Summarize reimbursement claims that are still waiting, grouped by who or what they wait on right now: named approvers (or the approver role pool when nobody is resolvable), finance review, or payment. Returns count, totals by currency, the oldest submission date and the longest wait in days per group, plus a per-person count that marks claims someone else could also approve. Scoped to the claims the caller may read. Use for "ใบเบิกค้างอยู่ที่ใคร", "ใครยังไม่อนุมัติ". The caller\'s OWN approval queue is reimbursement.list_pending_approvals.',
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
  - `CONTROL_PROMPT`: "ค้างที่ใคร/กองที่ใคร/ใครยังไม่อนุมัติ" → `reimbursement.get_approval_backlog`; "รอฉันอนุมัติ" → `reimbursement.list_pending_approvals`
- **W00:** regenerate
- **Specs:**
  - unit: การจัดกลุ่มโต๊ะ, pool ตามบทบาท, `sharedCount`, ขอบเขตของฉันและที่เกี่ยวข้อง, สาขา, วันไทย, hash คงที่
  - PG `apps/api/src/modules/reimbursements/reimbursement-approval-backlog.pg.spec.ts`
  - adapter เพิ่มเคสใน `erp-reimbursement-tools.use-case.spec.ts`
- **Eval:** ชุด R อย่างน้อย 20 ข้อ × 2 ประมาณ 100–200 บาท
- **ต้นทุนต่อข้อความ:** 0.9–1.1 บาท
- **ขนาด:** 1.5–2 วัน

### S2b — เครดิต AI คงเหลือ

- **ปิด:** #2, P5
- **ต้องรอ:** D2 (ตัวคำนวณ `quotaSummary` ของ PR E9 แผน add-on) และ D3
- **API:** เพิ่มส่วน `aiCredit` ใน `BillingGetPackageUsageTool` จากตัวคำนวณตัวเดียวกับ `BillingStatus.addOns.quotaSummary`
  - ถ้า E9 ยังไม่เริ่ม ให้ทำตัวคำนวณแบบอ่าน DB อย่างเดียวในโมดูล billing ร่วมกับเจ้าของแผน add-on แล้วให้ E9 ใช้ตัวเดียวกัน ห้ามคำนวณยอดเป็นชุดที่สอง
  - ร้านที่ยังไม่ย้ายระบบเครดิต (`aiCreditCutoverAt` ว่าง) ใช้ความหมายตาม add-on §11 และ §17 ซึ่งตัวคำนวณเป็นผู้ตัดสิน
- **Contracts:** แก้ description ของ `billing.get_package_usage` ให้พูดถึงเครดิต AI
- **W00:** regenerate
- **Specs:**
  - PG ของตัวคำนวณ (ต่อจาก `ai-credit-funding.pg.spec.ts` หรือไฟล์ใหม่ `ai-credit-quota-summary.pg.spec.ts`)
  - adapter: ไม่มียอดกันไว้, หน่วย `unitScale` 100, กรณีไม่จำกัด
- **Eval:** ชุด C อย่างน้อย 20 ข้อ × 2 ประมาณ 100–200 บาท
- **ขนาด:** 1–2 วัน (เพิ่มอีกประมาณ 2 วันถ้าต้องทำตัวคำนวณเอง)

### S5 — คู่ค้า

- **ปิด:** #6, V1–V5
- **API:**
  - เพิ่ม `ListCounterpartiesUseCase` ใน exports ของ `apps/api/src/modules/accounting-documents/accounting-documents.module.ts`
  - adapter `AccountingSearchCounterpartiesTool` ใน `erp-business-tools.use-case.ts` (ไฟล์ที่มีเครื่องมือ accounting อยู่แล้ว) แปลงค่าเป็นจริง/เท็จ
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
  - ground `search` ใน `read-tool-input.ts`
  - `CONTROL_PROMPT`: "คู่ค้ามีใคร" → `accounting.search_counterparties`; "จ่ายใครเยอะสุด" → `expense.get_breakdown`
- **W00:** regenerate
- **Specs:**
  - adapter: ไม่มีค่าเลขผู้เสียภาษี เบอร์ อีเมล หรือที่อยู่ใน JSON; ส่งตัวกรองผ่าน; limit
  - `read-tool-input.spec.ts`: ชื่อต้อง ground
- **Eval:** ชุด V อย่างน้อย 20 ข้อ × 2 ประมาณ 80–150 บาท
- **ต้นทุนต่อข้อความ:** 0.9–1.1 บาท
- **ขนาด:** 1 วัน

### S6 — สมาชิกและข้อมูลที่ขาด

- **ปิด:** #4, M1–M4 โดยต้องได้คำตอบสเปก §10 ข้อ 5–7 ก่อน
- **API:** adapter `CompanyListMembersTool` ใน `erp-business-tools.use-case.ts`
  - อ่าน `companyMembership` พร้อมบทบาท สถานะ ชื่อ และค่าที่ใช้คำนวณ `hasPhone`, `hasEmail`, `lineLinked`
  - `lineLinked` นับเฉพาะ `ExternalIdentity` ที่ provider เป็น `LINE` และสถานะ `ACTIVE`
  - ค่าจริงถูกอ่านเพื่อคำนวณใน API เท่านั้น และไม่ถูกส่งออก
- **ถ้า Owner ตอบข้อ 6 ว่า "เปลี่ยน":**
  - แก้ `CompanyEmployeeDetailTool` ให้ไม่คืน `phoneNumber` และ `email`
  - แก้ description ใน registry และแก้ spec เดิมที่ล็อก field เหล่านี้ไว้
  - regenerate W00
- **ToolMeta:**

```ts
{
  name: 'company.list_members',
  description: "List this company's members by display name with their roles and status, and whether a phone number, an email and a LINE link are on file — never the phone number, email or any identity value. Optional missing (phone|email|line) lists only members missing that item. Use for 'ใครยังไม่มีเบอร์', 'ใครยังไม่เชื่อม LINE', 'ใครเป็นผู้จัดการ'.",
  businessSubjects: ['employee'],
  questionKinds: ['list', 'search'],
  category: 'read_detail',
  requiredPermissions: ['access.employee.read'],
  // Ungated like the other employee tools: access.employee.* is owned by employee_access.employees,
  // so entitlement stripping already removes the permission when the feature is off.
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
  - กลุ่มความสามารถใหม่ `{ id: 'team', featureKeys: [], sourceModules: ['employee-access'] }` กับข้อความ `{ line: '• พนักงานและข้อมูลที่ยังขาด', example: 'ใครยังไม่เชื่อม LINE' }`
  - `ANSWER_PROMPT`: ห้ามอ่านข้อมูลติดต่อ และถ้าถูกขอให้ตอบข้อความในสเปก §7
- **W00:** regenerate
- **Specs:**
  - adapter: สตริงเบอร์และอีเมลที่ seed ไว้ต้องไม่อยู่ใน JSON
  - PG `apps/api/src/modules/line-ai/application/company-members.pg.spec.ts`: เจ้าของที่ไม่มีโปรไฟล์, เบอร์ในบัญชีเทียบกับในโปรไฟล์, LINE `ACTIVE` เทียบกับ `UNLINKED`, ตัด `DEV`, สถานะ `INVITED` และ `DISABLED`
- **Eval:** ชุด M อย่างน้อย 20 ข้อ × 2 ประมาณ 100–200 บาท
- **ต้นทุนต่อข้อความ:** 0.9–1.1 บาท
- **ขนาด:** 1.5–2 วัน

### S4a — รายจ่ายผิดปกติ

- **ปิด:** #3, E1–E5 โดยต้องได้คำตอบสเปก §10 ข้อ 8 ก่อน
- **API:**
  - แยก predicate ร่วมออกจาก `erp-expense-daily-closing.use-case.ts` (`accessClauses`, `activeWhere`, `evidenceWhere`, `duplicateWhere`) ไปไว้ในไฟล์ใหม่ `apps/api/src/modules/line-ai/application/use-cases/expense-read-scope.ts` ใช้ร่วมสองเครื่องมือ พฤติกรรมของ daily closing ต้องเหมือนเดิม (spec เดิมต้องผ่าน)
  - pure logic ใหม่ `apps/api/src/modules/line-ai/domain/logic/expense-anomaly.logic.ts`: มัธยฐาน อัตราส่วน เกณฑ์ Decimal แยกสกุลเงิน และ `formulaVersion: 'expense-anomaly-v1'`
  - adapter ใหม่ `apps/api/src/modules/line-ai/application/use-cases/erp-expense-anomaly.use-case.ts` → `ExpenseFindAnomaliesTool`
    - aggregate ใน repeatable-read transaction เดียว (core contract §5)
    - คิดมัธยฐานเฉพาะร้านค้าที่มีรายการในช่วง และจำกัดจำนวนร้านค้าต่อครั้ง
    - timeout ตาม core contract
  - **หมวดที่เพิ่งสร้าง:** ข้าม "หมวดพุ่ง" ของหมวดที่ถูกสร้างภายในช่วงที่ใช้เทียบ ถ้าทำ[ข้อเสนอขยายหมวด](../specs/mangmee-expense-category-expansion-2026-09-29-th.md) ก่อน เพราะหมวดใหม่ทำให้การเทียบข้ามวันเปลี่ยนหมวดไม่ใช่ของชนิดเดียวกัน
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
  - ลงทะเบียนใน `UserGuidePage.tsx` และ `user-guide.content.spec.ts`
- **Gateway:**
  - การ์ดใน `approved-product-help.ts` (เพิ่ม `sources` + hash) และแก้ `approved-knowledge.spec.ts`
  - pack ต้องไม่เกิน 64 การ์ดตาม core contract §7
- **เงื่อนไขก่อนเปิด:**
  - Owner อ่านข้อความก่อน (สเปก §10 ข้อ 12)
  - H4 รอ add-on เปิดขาย
  - การ์ดใช้ได้เมื่อ runtime มี `LINE_AI_APPROVED_KNOWLEDGE_ENABLED` เป็นจริง ค่าเริ่มต้นเป็น true แต่ต้องอ่าน env จริงตาม D4
- **Eval:** ชุด H อย่างน้อย 20 ข้อ × 2 ประมาณ 100–200 บาท
- **ขนาด:** 2–3 วัน + เวลาที่ Owner อ่าน

## 4. Dependencies และความเสี่ยง

| รหัส | เรื่อง | ผลกระทบ | วิธีคุม |
|---|---|---|---|
| D1 | งานคืนนี้ของ agent อื่น: คำสำคัญของโมดูลที่ไม่ได้ซื้อใน `scopePolicyOverride`, `approvedHelp` ถูกใช้เป็นขอบเขตหัวข้อ, การปฏิเสธคำถามภาษีทั่วไป | S0 และ S1 แตะไฟล์หรือพฤติกรรมเดียวกัน | เริ่ม S0/S1 หลังงานนั้น merge; S1 แก้ `line-ai-scope-policy.logic.ts` หลังคุยกับเจ้าของงาน |
| D2 | ตัวคำนวณยอดเครดิต (`quotaSummary`) ของแผน add-on PR E9 | S2b ต้องใช้ตัวเดียวกัน | รอ E9 หรือทำร่วมกับเจ้าของแผน add-on ห้ามมีสองชุด |
| D3 | กติกา release ร่วมของ add-on กับส่วนลดจากงาน | "ยอดเพิ่มเติม" มีความหมายเมื่อ add-on เปิดขาย | S2b ออก release เดียวกับ add-on (R2) |
| D4 | env ของ AgentCore ถูกคัดลอกค้างตอน release (`infra/kamal/release.py` `agentcore()` คัดลอก env ที่ deploy อยู่และทับเฉพาะ key ตัวตน) | ถ้า env เก่ามีค่าที่ปิดความสามารถ เครื่องมือใหม่อาจใช้ไม่ได้บน UAT แม้ในเครื่องผ่าน (เหตุการณ์ UAT 2026-09-29) | ไม่เพิ่ม env; eval รันด้วย env ของ `agentcore-deploy.sh`; ก่อนให้ Owner ทดสอบ ให้อ่าน env จริงของ AgentCore บน UAT และลองถามคำถามของ slice หนึ่งข้อ |
| R1 | ข้อมูลส่วนบุคคล | เบอร์ อีเมล หรือเลขผู้เสียภาษีหลุดใน LINE | เครื่องมือไม่ส่งค่าออก (สเปก §2.5); scorer ตรวจสตริงที่ seed; `sensitiveAudit`; ไม่ทำงานในกลุ่ม |
| R2 | ร้านคนเดียว (Owner ทำทุกบทบาท) | คิวทุกคิวเป็นของ Owner และกติกาอนุมัติตัวเองต่างกันตามเอกสาร | บริษัท C ใน eval; ใช้ `selfApprovalPermitted` และ `isSelfApproval` เดิม; ห้ามตอบว่า "รอคนอื่น" ถ้าไม่มีคนอื่น |
| R3 | สาขา | ผู้จัดการที่เห็นบางสาขาได้ตัวเลขข้ามสาขา | ใช้ `branchScopeWhere` เดิม; PG spec สาขา A, B และส่วนกลางทุกเครื่องมือที่แตะรายจ่ายหรือใบเบิก |
| R4 | การตัดตามแพ็กเกจ | เครื่องมือถูกซ่อนหรือเปิดผิดร้าน | `featureKeys` ของคู่ค้าเป็น `expenses` หรือ `sales_documents`; เครื่องมือที่ตั้งใจไม่ผูกฟีเจอร์ (billing, reimbursements, employee-access) มีคอมเมนต์เหตุผล; `lineIntakeOfferedToolNames` เป็นผู้กรอง |
| R5 | ความเร็ว | ทางปกติ p95 วันนี้ 16.5 วินาทีเกินเป้า 15 วินาทีอยู่แล้ว คำถามที่อ่านสองสามครั้งอาจช้ากว่า | วัดในทุก eval; ไม่เพิ่ม deterministic family ผ่าน env; ถ้าจำเป็นให้เปิดงานแยกเพื่อย้ายรายการ family เข้าโค้ด ไม่ทำในโปรแกรมนี้ |
| R6 | ต้นทุน | คำถามละประมาณ 1 เครดิต AI ของร้าน และรายการเครื่องมือใน prompt ของ router โตขึ้น | description สั้น; วัด token ของ router ก่อนและหลังทุก slice; รวมการแก้ prompt ต่อ release |
| R7 | การอ่านซ้ำตอนส่ง | ข้อมูลที่เปลี่ยนเร็ว (อ่านใบเสร็จใหม่ระหว่างตอบ) ทำให้ `verifyDelivery` ไม่ผ่าน | ใช้วันแทนชั่วโมง; ตรวจว่าผู้ใช้เห็นอะไรเมื่อไม่ผ่าน (สเปก §11 ข้อ 9) |
| R8 | ตรวจตัวเลข | ตัวเลขที่ API ไม่ได้ให้ถูกปฏิเสธและคำตอบกลายเป็นข้อความล้มเหลว | ทุกผลคำนวณอยู่ใน `data`/`facts` (สเปก §5.0) |
| R9 | W00 hash | CI ล้มเพราะ manifest ไม่ตรง | regenerate ทุก slice; ห้ามแก้เอกสารที่ถูก hash โดยไม่ regenerate |
| R10 | ข้อค้นพบผิดพลาด (S4a) | เจ้าของร้านเสียความเชื่อใจ | ใช้คำว่า "ควรตรวจ", มีเกณฑ์ขั้นต่ำ, Owner อนุมัติเกณฑ์ และปรับหลังลองใช้ |
| R11 | ตัวเลขใน LINE | ขัดกฎ "ราคาไม่ส่งทาง LINE" | ไม่มีราคาในผลเครื่องมือเลย; ตัวเลขอื่นตามสเปก §10 ข้อ 1 |
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
- **ข้อมูลติดต่อ:** ไม่อ่านค่าข้อมูลติดต่อออกมา และไม่ส่งออกรายชื่อ
- **งานของคนอื่น:** ไม่แก้งานคืนนี้ของ agent อื่น (D1)
- **เส้นทางตายตัวเดิม:** ไม่เปลี่ยนคำตอบนโยบายสาธารณะ คำตอบส่วนลดจากงาน และการ์ดแพ็กเกจหมดอายุ
- **ยอดขายและสต็อก:** ยังพัฒนาไม่เสร็จ (Owner 2026-09-29)
  - คำถามข้อมูลร้านเรื่องนี้อยู่ในหมวดอนาคต (§1.1, สเปก §4.12) ไม่มี slice
  - ไม่เสนอคำชวนซื้อหรืออัปเกรด และไม่แก้ข้อความคงที่ "แพ็กเกจที่ใช้อยู่ยังไม่มีเรื่อง…" ที่ใช้อยู่
- **โมดูลที่ยืนยันไม่ได้ว่าเสร็จและเปิดใช้:** ไม่ออกแบบคำตอบที่พึ่งจัดซื้อ ภาษีเต็มรูป บัญชีแยกประเภท รายงาน ลูกค้าสัมพันธ์ ธนาคาร และงานอัตโนมัติ — ต้องตรวจสอบ
- **เอกสารที่ W00 hash:** ไม่แก้ใน PR นี้

## 6. ลำดับการปล่อยใช้งาน

| Release | Slice | หมายเหตุ |
|---|---|---|
| R1 | S0, S2a, S1, S3 | ชุดแรกที่ Owner เห็นผลชัด (แพ็กเกจ ลายเซ็น ใบเบิกค้าง ความรู้ทั่วไป) |
| R2 | S2b | ออกพร้อม release ร่วมของ add-on และส่วนลดจากงาน (D3) |
| R3 | S5, S6 (+ การ์ด S7 ของพนักงานและคู่ค้า) | หลัง Owner ตอบสเปก §10 ข้อ 5–7 และ 12 |
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
| `docs/specs/chat-credit-and-receipt-addons-spec-th.md` §7.2 | ผลของสเปก §10 ข้อ 1 (ตัวเลขใน LINE) และตัวคำนวณร่วมของ E9 | S2b |
| `docs/specs/mangmee-ai-core-capability-contract-2026-09-27.md`, `docs/plans/mangmee-ai-implementation-index-2026-09-27.md` | รายการ operation ใหม่ (ไฟล์ถูก W00 hash ต้อง regenerate ใน PR เดียวกัน) | ทุก slice ที่เพิ่มเครื่องมือ |
| `docs/research/mangmee-ai-capability-manifest-2026-09-27.md` | จำนวน operation ที่ลงทะเบียน | ทุก slice ที่เพิ่มเครื่องมือ |

## 8. เวลาและค่าใช้จ่ายรวมโดยประมาณ

| Slice | วันทำงาน (คนเดียว) | ค่าทดสอบโมเดลจริง |
|---|---|---|
| S0 | 0.5–1 | 50–100 บาท |
| S2a | 2–3 | 150–250 บาท |
| S1 | 2–3 | 150–250 บาท |
| S3 | 1.5–2 | 100–200 บาท |
| S2b | 1–2 (+2 ถ้าทำตัวคำนวณเอง) | 100–200 บาท |
| S5 | 1 | 80–150 บาท |
| S6 | 1.5–2 | 100–200 บาท |
| S4a | 4–6 | 200–350 บาท |
| S4b | 2–3 | 150–250 บาท |
| S7 | 2–3 + เวลา Owner | 100–200 บาท |
| ชุดกันถดถอยต่อ release | — | ประมาณ 50–70 บาทต่อครั้ง × 4 |
| **รวม** | **ประมาณ 18–28 วันทำงาน** (ถ้าทำขนานสองถึงสามสาย ใช้เวลาจริงประมาณ 2–3 สัปดาห์ ไม่รวมเวลารอ D2 และคำตอบของ Owner) | **ประมาณ 1,300–2,300 บาท** |

- **ค่าทดสอบ** มาจากขนาดชุด × 2 รอบ × ประมาณ 1 บาทต่อข้อความ บวกรอบแก้ 2–3 รอบ
- **อ้างอิง:** รอบ NAT05 + NAT06 (10 ข้อความ) ใช้ประมาณ 15 บาทต่อรอบ และรอบเต็มของโปรแกรมรายจ่าย (ประมาณ 260 ข้อ) ใช้ 100–250 บาท
- **ต้นทุนต่อคำถามของลูกค้า** ประมาณ 1 บาท (≈ 1 เครดิต AI) ตามสเปก §8
