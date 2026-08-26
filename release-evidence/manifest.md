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
| FIN-01 | **ปิดแล้ว 2026-08-26** (`1ba23bd5` expenses + `82327b23` reimbursements mirror) — settle ภายในครึ่งสตางค์ทั้งสองโมดูล, void/reset mirrors สอดคล้อง, regression 580.0042→PAID ทั้งสองฝั่ง | เหลือ gap บันทึกไว้: accounting-totals ใช้ float round2 (โมดูลบัญชี — ยังไม่เปิดลูกค้า), SETTLE_EPSILON ซ้ำ 2 ที่ (เสนอรวมเข้า contracts ภายหลัง) |
| VAT-MIX-01 | **ปิดแล้ว 2026-08-26** (`31f4269b`) — allocation in-tolerance ถึงได้จริงสำหรับ single-rate mixed, ชี้บรรทัด (attentionLineNumbers + ประโยคไทยตรงตามแผน), reviewer override "ใช้ยอดตามเอกสาร" + HIGH-risk audit, ตัวเลือกต่อบรรทัดครบ (ยกเว้น ≠ 0% ส่งออก), golden 13.11.B ครบ 5 เคส | gap บันทึก: override บันทึกเจตนาไม่ re-price (อ่านแบบ conservative), exempt/zero conflate ที่ระดับ rate ใน engine, E2E mixed receipt รอ P7 |
| P4 time-to-value | **ปิดแล้ว 2026-08-26** (`b7eb4fad`) — hero 2 CTA + ตัวอย่างคำถาม, EXP-UX-01 ส่งตรวจ→กลับรายการ+highlight, login field validation, label "วันที่ในใบเสร็จ"+hint, ซ่อน salesdoc/closing จาก nav, queue-busy หลัง 8 วิ, redirect ไม่จอขาว, WEB-04 ไม่โชว์ raw ID + retry | หมายเหตุ: `NEXT_PUBLIC_LINE_OA_URL` เป็นค่า build-time ของ Next — ต้องใส่ตอน build web image (ไม่ใช่ task env); จนกว่าจะใส่ hero แสดง "เร็ว ๆ นี้" ตาม fallback ที่ตั้งใจ; ถ้อยคำสถานะ "พร้อมยืนยัน" vs "รอตรวจสอบ" รอ Owner เลือก |
| P5 UX 40+ | **ปิดแล้ว 2026-08-26** (`b7eb4fad`) — ErrorBanner role=alert ทั้งระบบ expenses, dashboard banner/skeleton aria, delete dialog ใช้ Modal กลาง (focus trap/Escape), CTA hero ≥56px | เหลือ Gate E (ผู้ใช้จริง 40+ สามคน) — ต้องมนุษย์ |
| P3 kill switch + alarms | **ปิดแล้ว 2026-08-26** (`73411914`) — AI lane บังคับใช้ launch gate จริง (fail-closed, ข้อความไทย OPEN-9), alarm 5 ตัวใน runtime-alarms.sh (threshold เป็นค่าเริ่มต้นรอ B1) | **install บน UAT แล้ว 2026-08-26** — alarm 5 ตัว + redis (แก้ stale -v2 constant) มีอยู่จริงบน CloudWatch; `verify uat` จะเขียวเมื่อ UAT มี traffic แรก (by design); expenses gate **ปิดแล้ว** (`e56b25a1`); เหลือซ้อม drill 1 รอบเมื่อระบบขึ้น UAT |
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

## 6. Evidence log (P7 — อัปเดต 2026-08-26)

- Unit บน branch `codex/brain-25day-p2-p5`: expenses 839/839, reimbursements 298 pass/8 pre-skips, line-ai 738/738, web 1051/1051, contracts 196/196; tsc clean (api/web/contracts); bash -n + serving-mode gate spec PASS
- **Critical E2E (Gate A): 38 passed / 1 pre-existing skip (JRNL-01) / 0 failed, 49s** — รันด้วย `e2e/run-local.sh --project=critical` (project ใหม่ grep @smoke, 39 เคส) บน seeded DB; รวม **EXP-04B**: ส่งตรวจสอบ → URL หน้ารายการ + row highlight + สถานะ (ข้อพิสูจน์ EXP-UX-01 ตามแผน) และ sidebar matrix หลังถอด planned modules ผ่านทุก role
- Load smoke (Gate C): script พร้อม (`scripts/load-smoke.k6.js`) — **ยังไม่ได้รัน**: k6 ไม่ได้ติดตั้งบนเครื่อง และตามแผน hosted run บน UAT เท่านั้นที่นับเป็นหลักฐาน (local ใช้แทนไม่ได้) → งาน UAT phase
- Gate B (AI): golden/`baselineReady` รอ fixtures 30 ใบจาก Owner; families dormant รอ blind eval
- Gate D: security suite 23 เคสรันใน CI แล้ว (PR #233); SEC-01/02 residuals ตาม memory เดิม
- Gate E (ผู้ใช้จริง 40+ สามคน): **ต้องมนุษย์ — ยังไม่ได้ทำ**
- หมายเหตุเครื่องมือ: เครื่อง dev ไม่มี `psql` — e2e preflight ต้องใช้ shim docker exec (บันทึกไว้สำหรับ dev คนถัดไป)
