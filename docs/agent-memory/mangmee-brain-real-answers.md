# Agent Memory: mangmee-brain-real-answers

Status: batch 3 (codex/brain-real-answers-p10-social) เสร็จ: advisor plan Phase 1 social scaffolding zero-behavior (contracts advisor-answer parser + flags LINE_AI_ADVISOR_MODE=off/DIRECT_ANSWER=false, off พิสูจน์ byte-identical กับ HEAD, contracts 196/gateway 756/api 5077 เขียว) + พบและลงทะเบียน orphan spec เพิ่ม: contracts line-ai-prepared-plan.spec.ts (39 เทสต์ parser security ไม่เคยรัน); gaps ใหม่: media dispatcher hard-code 2 intents (process-line-webhook:3331), LineIntakeRouteRequest ไม่มี chat-type (group/room gate ของ Slice C ต้องทำที่ API layer), enum flag ต้องเขียนแบบ positive membership กัน fail-open; batch 2 = PR #234 merged; batch 2 (branch codex/brain-real-answers-p6-9) เสร็จ: G1 ปิด (บั๊กจริง clamp 100 ใบ + pagination tiebreaker), infra flags ครบสามชั้น (deploy.sh + agentcore literal-false + gate spec 10 เคส PASS), families F1/F2/F3 compile dormant (gateway 744/744), F3 นิยามใหม่ตาม Owner 2026-08-26 = ค่าใช้จ่ายวันนี้ผ่าน expense.get_daily_closing (ไม่ต้อง tool ใหม่/ลงนาม), catalog คำถาม-คำตอบ + พิมพ์เขียว golden 30 ใบสร้างแล้ว (docs/specs/mangmee-brain-user-questions-catalog.md); B1 ติด traffic: UAT และ production ไม่มี LINE webhook เลยใน 24 ชม. (ตรวจ log จริงทั้งคู่ format ถูก) — ต้องใช้งานจริงบน UAT 2-3 วัน; batch 1 merge แล้วเป็น PR #233 — Phase 0 (B0) ตรวจบางส่วน (เหลือส่งข้อความทดสอบ OA UAT 1 ข้อความ), Phase 1.1 harness เสร็จ, Phase 1.4 (data path + UX + telemetry) เสร็จ+ทดสอบ local ผ่าน, security suite (v2 Phase 6) เสร็จเขียว; commits: 28461660 docs v1, a6ff1805 docs v2 sync, d66a4a18 harness+security, b7e16c00 feature; branch `codex/brain-real-answers-p0-2` ยังไม่ push/PR

Owner: thawatchai (Product owner) / Developer 1 คน; coding รอบนี้ทำโดย Claude (Opus 5 subagents ภายใต้ Fable session) ตามคำสั่ง Owner 2026-08-25

Scope:

- ทำตาม `docs/plans/mangmee-brain-real-answers-plan.md` (v2 renumber: Phase 0=B0, 1=S1/6A, 2=B1 baseline, 6=security suite) ถึงขอบเขตที่ Owner สั่ง "จบ phase 2 พอก่อน" — ตีความรวม Phase 0+1 (ตรงทั้งสอง numbering) + security suite ที่เริ่มไว้ตาม v1 numbering (งาน test ล้วน ไม่มีผล runtime จึงเก็บได้)
- หมายเหตุ numbering: plan v1 (Phase 2 = security) ถูก session อื่นปรับเป็น v2 (Phase 2 = B1 hosted baseline, security = Phase 6) ระหว่างที่ coding เริ่มแล้ว; B1 baseline (วัด 2–3 วัน) ยังไม่เริ่ม — ต้องมี LINE traffic ก่อน

Decisions:

- Owner ยืนยันคำถาม top-3 (2026-08-25): เงินเข้า–ออกวันนี้ / สรุปรายการเดือนนี้ / สรุปค่าใช้จ่าย
- Security corpus ย้ายเข้า `packages/contracts/src/line-ai-security-eval.ts` (data-only, zero imports); root corpus re-export; ทิศทาง dependency scripts → contracts เท่านั้น
- `apps/ai-gateway/package.json` `scripts.test` แก้แบบ insert-only 2 แถว (security spec ใหม่ + formatter spec ที่ orphan) — ข้อยกเว้น AGENTS.md ที่ระบุใน spec S2-R2b

Artifacts (บน branch `codex/brain-real-answers-p0-2`):

- `scripts/expense-category.golden.ts` + `.spec.ts` — harness หมวดรายจ่าย: fixture type ผูก `ReceiptOcrRequest['activeCategories']`, 5 starter fixtures (synthetic, `ownerConfirmed:false`), scorer pure function (accuracy/auto-fill/omit/confusion), `baselineReady` ต้อง ownerConfirmed ≥30, รายงานประทับ NOT-A-BASELINE จนกว่าจะครบ
- `packages/contracts/src/line-ai-security-eval.ts` + export ใน index; `scripts/line-ai-latency-autonomy.corpus.ts` เหลือ re-export (−38 บรรทัด)
- `apps/ai-gateway/src/modules/line-ai/agents/prepared-simple-read-security.spec.ts` — 35 tests: 19 เคส zero-ERP-call (ระบุ fallback reason รายเคส: 13 reparse_failed / 4 eligibility / 2 delegation_missing), 4 เคส source-honesty (1 call + composer/critic/router counters = 0; terminal ไม่มีตัวเลขเลย), Thai/English serving, 5 sanitizer exact-equality, 4 forged/missing intakeIntent, default-off (พิสูจน์ counters เป็นเครื่องมือที่มีชีวิต), env narrowing; guard test ผูกกับขนาด corpus — เพิ่มเคสใหม่แล้วไม่ map = fail ดัง ๆ

Verification (2026-08-25, ใน worktree; ต้อง `pnpm -C packages/contracts build` และ build `packages/config` ก่อน ไม่งั้น agentcore typecheck รายงาน phantom errors):

- contracts build OK; `line-ai-prepared-plan.spec.ts` 39/39; contracts test 137/137
- `scripts/line-ai-latency-autonomy.corpus.spec.ts` 6/6 — ไฟล์ spec ไม่ถูกแตะ, assert 256 ids (164+92) คงเดิม
- gateway `pnpm test` 690/690 (จาก 647 → +35 security +8 formatter); `tsc --noEmit` main + agentcore = 0 errors; `build` + `build:agentcore` ผ่าน (จุดที่เคยทำ UAT image พัง)
- ไม่มีไฟล์ใต้ `apps/` import จาก root `scripts/` (grep พิสูจน์)
- harness: `pnpm exec tsx --test scripts/expense-category.golden.spec.ts` 4/4
- **Phase 0 (B0):** UAT ทำงานอยู่ (log ล่าสุด 2026-08-25 ~23:26), build ใหม่กว่า merge telemetry (deploy 2026-08-23) แต่ `line.ai.api_trace/stage/turn_summary` = 0 events ใน 7 วัน เพราะ **ไม่มี LINE webhook traffic เลย** (`/v1/line/webhook` 0 events) — ยืนยัน telemetry ให้จบต้องส่งข้อความจริง 1 ข้อความที่ OA `uat-mangmeeplus` แล้ว filter ซ้ำ; AWS อ่านตาม runbook cloud-environment-operations §4

Gaps batch 2 (บันทึก 2026-08-26): F2 ผูกกับ G1 self-check (ถ้า byType เปลี่ยน basis จะ unverified ถาวร — tool ต้อง expose basis), F2 ไม่มี overall money total (tool ไม่คืน — formatter ไม่บวกเอง), daily-closing evidence/pendingReview เป็น company-wide ไม่ scope วัน (ถ้าอยากได้ของวันนี้ต้องแก้ tool), branchId ยังผ่าน prepared lane ไม่ได้ (FORBIDDEN_INPUT_KEY) — branch questions = fallback เสมอ, unbounded sibling walks (AccountingGetReceivableSummaryTool, CrmDailyBrief listAllIssuedDocuments) ไม่มี cap + แชร์บั๊ก tiebreaker เดิม (แก้ที่ repo แล้วหายทั้งคู่), byType.totalAmount เป็น float ขณะ sibling ใช้ Decimal string (formatter รองรับแล้ว)

Gaps ที่ agent รายงาน (ยังไม่แก้ — นอก scope ที่อนุมัติ):

1. (ปิดบางส่วน 2026-08-26) orphan gateway specs: ลงทะเบียนแล้ว 5/6 (prepared-simple-read.logic 10/10, tool-availability 5/5, session-affinity 6/6, production-maintenance.middleware 2/2, crm-broadcast.agent 2/2) → suite 715/715; **`app.boot.spec.ts` ยัง fail บนเครื่อง dev**: Nest ExceptionsZone exit(1) เงียบเพราะ config validation — เครื่องที่ตั้ง `AWS_SDK_LOAD_CONFIG=1` (string) ชน `envBoolean` ใน packages/config/src/index.ts:402 ที่ไม่ coerce "1"; ใน CI env สะอาดน่าจะผ่าน แต่ลงทะเบียนแล้วจะ fail กับ dev ที่ใช้ AWS profile — ต้องเลือกวิธีแก้กับ Owner: (a) envBoolean coerce "1"/"0" หรือ (b) spec ล้าง AWS_* env ก่อน boot (pattern เดียวกับ api test:boot ที่ CI รันแยกด้วย env คุม)
2. (ยืนยันแล้ว 2026-08-26) `test:line-ai-business-coverage` **ไม่ถูกเรียกที่ไหนเลยใน .github/** (grep exit 1) ขณะที่ CI รัน `pnpm test` recursive → specs 4 ตัว (agent-tools.parity, business-read-result-semantics, line-ai-business-query-regression, line-ai-feature-coverage) เป็น CI-orphan จริง — ตัดสินใจกับ Owner: เพิ่มเข้า scripts.test หรือเพิ่ม step ใน CI
3. `packages/contracts` `scripts.test` ไม่รวม `line-ai-prepared-plan.spec.ts` (orphan class เดียวกัน)
4. root `scripts/*.spec.ts` ไม่อยู่ใน runner ใด (`pnpm -r test` ไม่ลงมาที่ scripts/) — corpus 256-id assert + golden harness รันเมื่อมีคนพิมพ์คำสั่งเท่านั้น
5. fresh worktree ต้อง build contracts+config ก่อน typecheck/corpus ไม่งั้น false failures
6. design tension: `sales.get_sales_summary` ประกาศ `branchId` ใน optionalInputFields แต่ parser FORBIDDEN_INPUT_KEY ปัดทุก key /branch/ → branch-scoped read ผ่าน prepared lane ไม่ได้ (fallback เสมอ) — บันทึกก่อน compile F1–F3
7. (ปิดแล้ว) memory ไฟล์นี้ถูกสร้างตามที่ plan กำหนด

Local verification (2026-08-26, web dev + API dist จาก branch, seeded DB :15432, 390px):

- Flow ถูก: dev login → dashboard → รายการค่าใช้จ่าย (สรุป ฿113,447.6/191 รายการ) → review 3 ขั้น; ขั้น 1 บล็อกเมื่อไม่กรอกชื่อผู้ขาย (validation ตรงจุด)
- Feature ใหม่ถูก: seed suggestion 0.62 (ต่ำกว่า 0.85) → หมวด "ยังไม่ระบุ" ไม่ถูกเดา + ปุ่ม "🤖 หมวดที่ AI แนะนำ: ค่าอาหารและเครื่องดื่ม · แตะเพื่อใช้หมวดนี้" แสดงใต้ select; แตะแล้วหมวดถูกเลือกทันที ปุ่มหายไป ปุ่มบันทึก active; ข้อมูลขั้น 1 (ชื่อผู้ขาย) ไม่หาย
- เร็ว: page load 717ms (dev mode)
- ป้า 40+: ปุ่ม/ช่อง 44px, input/label 16px, ภาษาไทยไม่มีศัพท์เทคนิค; observation: ตัวอักษรในปุ่ม 14px ตาม pattern เดิมของ card (ไม่ใช่ regression ใหม่)
- ทดสอบผ่าน seed ตรง DB (`aiVerificationSummaryJson.categorySuggestion`) เพราะ E2E ไม่มีทาง public เขียนค่านี้ (ตามเหตุผลที่บันทึกใน Phase 1.4 report)
- บั๊ก NFKC สระอำ: **แก้แล้ว 2026-08-26** — normalized() NFKC→NFC หนึ่งคำ (domain/logic/line-expense-draft-conversation.logic.ts:88) พร้อม comment กติกา; ผลกระทบจริงกว้างกว่าที่คิด: segment "I0x-CATEGORY: ตามที่แนะนำ" ถูกปฏิเสธเงียบ, คำสั่ง "ทำต่อ/ทำรายการต่อ" ไม่เคยทำงาน, ทางเลือก "รับชำระ" ใน non-expense guard ตาย; regression แบบ red-green 3 เทสต์ (fail 2 ก่อนแก้ → ผ่านหมดหลังแก้); audit ำ/ฺ ทั้งไฟล์ครบ (จุด raw-input 216/531/539 ไม่โดน); expenses 818/818, line-ai 725/725

Next:

1. Owner ตรวจงานบน local (เซิร์ฟเวอร์ยังรันอยู่: web http://127.0.0.1:3000, api :3001) แล้วสั่ง push/PR เข้า develop
2. แก้บั๊ก NFKC (task chip) + ลงทะเบียน orphan specs (task chip)
3. ส่งข้อความทดสอบ 1 ข้อความที่ OA UAT (ต้องคนมี OA) แล้วเช็ก telemetry ซ้ำเพื่อปิด B0
4. งานถัดไปตามแผน v2: Phase 2 (B1 hosted baseline หลังมี traffic) — ไม่เริ่มจนกว่า Owner สั่ง (คำสั่งปัจจุบัน: จบ phase 2 พอก่อน ซึ่งคือจุดนี้)
5. พิจารณา gaps 1–6 เป็น follow-up แยก (เสนอเป็นงานเล็กหลัง PR แรก)
