# Release Manifest — Controlled Beta Candidate (P1 ของแผน 2.5 วัน v4)

สถานะ: **DRAFT — อัปเดตต่อเนื่องระหว่างทำ P2–P8**; ตัวเลข/ผล gate ล่าสุดดู commit history ของไฟล์นี้

## 1. Release candidate

| รายการ | ค่า |
|---|---|
| Base branch | `develop` |
| RC เริ่มรอบ P2–P5 | `773651a6` (merge PR #235, 2026-08-26) — SHA สุดท้ายจะ pin เมื่อจบ P7 |
| Environment เป้าหมาย | UAT ก่อนเสมอ → Controlled Beta allowlist |
| งานก่อนหน้าในรอบนี้ | PR #233 (category UX + security suite + NFKC fix), #234 (G1 + 3 families + flag wiring), #235 (advisor Phase 1 scaffolding) — merged เข้า develop แล้วทั้งหมด |

## 2. Feature flags ณ จุดเริ่ม (ทุกตัวต้อง default ปลอดภัย)

| Flag | UAT | Production | หมายเหตุ |
|---|---|---|---|
| `LINE_AI_EXACT_GREETING_ENABLED` | **on** | off (hard-block ใน deploy.sh) | lane เดียวที่เปิดอยู่ |
| `LINE_AI_LOADING_ON_ACCEPT_ENABLED` | off (settable) | hard-block | B2 |
| `LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED` (+SECRET ผ่าน Secrets Manager) | off | hard-block | B3; ops ต้องสร้าง secret ก่อนเปิด |
| `LINE_AI_FUSED_PLAN_SHADOW_ENABLED` | off | hard-block + literal-false ใน AgentCore | B4 |
| `LINE_AI_PREPARED_SIMPLE_READ_ENABLED` | off | hard-block + literal-false ใน AgentCore | B5 |
| `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES` | ว่าง | hard-block + literal-empty ใน AgentCore | families compiled 4 ตัว, dormant |
| `LINE_AI_ADVISOR_MODE` / `LINE_AI_ADVISOR_DIRECT_ANSWER_ENABLED` | off / false | off / false | scaffolding เท่านั้น, off = byte-identical |
| `LINE_AI_REIMBURSEMENT_SEMANTIC_MODE` | off | off | AI-01 ยังเปิดอยู่ → คงปิด |
| quota/subscription enforcement | ไม่มีกลไก — ยังไม่ enforce | เช่นกัน | P26 |

## 3. คำถาม top-3 ที่ Owner ยืนยัน (2026-08-25/26)

1. ค่าใช้จ่ายวันนี้ (F3 นิยามใหม่ — ฝั่งจ่ายก่อน) → family `expense.get_daily_closing::single_metric`
2. สรุปรายการเดือนนี้ → `accounting.get_summary::list`
3. สรุปค่าใช้จ่าย → `expense.list_recent::single_metric`
(ยอดขาย = canary เดิม `sales.get_sales_summary::single_metric`)

## 4. Bug board — สถานะ STOP-SHIP ณ เริ่ม P2 (discovery 2026-08-26 บน `773651a6`)

| ID | สถานะ | หลักฐาน/สิ่งที่เหลือ |
|---|---|---|
| FIN-01 | **กำลังแก้ในรอบนี้** — policy+helper+regression มีแล้ว แต่เป็น dead code; path จริง (`prisma-expense.repository.ts:332-333`) ยัง strict eq(0) | wiring helpers + ผ่อน overshoot guard ด้วย SETTLE_EPSILON |
| VAT-MIX-01 | **กำลังแก้ในรอบนี้** — confirm ยัง hard-block 3 outcome; ไม่มี override "ใช้ยอดตามเอกสาร"; label 0% export ≠ ยกเว้น; ไม่ชี้บรรทัด; allocation in-tolerance ถูกบล็อกเมื่อ >1 rate | guided flow ตามแผน 13.11.B + golden #2/#3 |
| AI-01 | **OPEN — flags คง off ตามที่แผนอนุญาต** — 8 required_gap ใน corpus (durable replay, DB intake state, Flex fallback ฯลฯ) | งาน implementation แยกรอบ; `LINE_AI_REIMBURSEMENT_SEMANTIC_MODE=off` |
| DOC-01 | โค้ดครบ (PR #228) — เหลือ whole-chain UAT proof | งาน UAT phase |
| FIN-02 | โค้ดครบ — เหลือ migration clone preflight + concurrent/mutation E2E บน exact candidate | งาน UAT phase |
| SEC-01/SEC-02 | ตามหลักฐานเดิมใน memory (UAT partial / live closure ค้าง) — Controlled Beta วงแคบเท่านั้น | ก่อนวงกว้างต้องปิดตามแผน |
| G1 (accounting summary truncation) | **ปิดแล้ว** (PR #234) | — |
| NFKC สระอำ | **ปิดแล้ว** (PR #233) | — |

## 5. Owner fields (ต้องเติมก่อนประกาศ GO)

- Allowlist ผู้ใช้ Controlled Beta: **TBD (Owner)**
- On-call / rollback owner (ชื่อคน): **TBD (Owner)** — กลไก kill switch พิสูจน์ใน P3
- ผู้อนุมัติ copy การตลาด: **TBD (Owner)**; ข้อห้ามคำโฆษณาตามแผน §1 ("ตอบได้ทุกเรื่อง", "พร้อม Production", ตัวเลขที่ยังไม่ได้วัด — ห้ามใช้)

## 6. Evidence log (เติมระหว่าง P7)

- unit/typecheck ณ จุดเริ่ม: gateway 756/756, contracts 196/196, config 132/132, api 5077 pass/0 fail (บันทึกจาก batch 3 บน `773651a6`)
- critical e2e / load smoke / Gate E: **รอ P7**
