# Plan: น้องมั่งมีคุมงาน draft ได้ (v1) — ลำดับงาน, สาขา, หลักฐาน

Spec: `docs/specs/line-ai-draft-control-spec-th.md` · สถานะ: READY-TO-BUILD (2026-09-05) · Deploy: **UAT ครั้งเดียว** เมื่อทุก slice + stale-identity fix + LIFF UX batch merge main แล้ว (คำสั่ง Owner ข้อ 5)

## 1. ลำดับและการขนาน

```
A = S-0 + S-2   (honesty + dates + charge tax rules; ไม่มี schema)   ─┐
B = S-1         (chargeKind schema + OCR + web + DTO + copiers)         ─┤→ C = S-3 (explain) → D = S-4 (draft edit)
```

- A ∥ B ทำพร้อมกันได้ (ไฟล์ทับกันเฉพาะ `receipt-ocr-apply.service.ts` — A แก้กติกา VAT/WHT ของบรรทัดค่าใช้จ่ายเพิ่ม, B เพิ่ม chargeKind; B rebase ทับ A ก่อน PR)
- C ต้องมี B (explain ต้องเห็น `charges`); D ต้องมี B + C (resolver ร่วม, preview ใช้ reconcile ที่รู้จัก chargeKind)
- ทุกสาขาแตกจาก `origin/develop` ล่าสุด; PR → develop ทีละสาขา (ไม่ต้องรอ main); main PR รวมทีเดียวก่อน deploy

## 2. งานต่อ slice (ผู้ทำ = Opus; ผู้ตรวจ = reviewer อิสระ + mutation; Fable คุม)

### A: `codex/line-ai-truth-and-dates`
1. `process-line-webhook.use-case.ts:4391` — เลิก default เงียบ ๆ: เมื่อ OCR ไม่ให้วันที่ที่ใช้ได้ → placeholder + ธง `dateUnverified` + NEEDS_REVIEW + copy การ์ด (§5.2); หา "กลไก NEEDS_REVIEW" ที่ apply service ใช้อยู่แล้วและใช้ตัวเดียวกัน
2. `line-ai-value-normalizer.ts:430-465` — option `documentContext: 'receipt'`; ตาราง test §11; OCR raw string ต้องผ่าน normalizer เมื่อ ISO parse ไม่ผ่าน (ตรวจว่า OCR extractor ส่ง raw มาไหม — ถ้าไม่ ให้ส่ง)
3. `line-correction.use-case.ts:112-116` — `note` append; คำตอบตามจริง (before/after ต่อฟิลด์); เมื่อข้อความมีเรื่องเงินที่ lane ทำไม่ได้ → บอกตรง ๆ + ลิงก์เว็บ (ก่อน S-4 ขึ้น)
4. refusal `unsupported_yet`: contracts (`ADVISOR_REFUSAL_CODES`), gateway intent-router allowlist (`intent-router.agent.ts:60,214`), `line-ai-turn.use-case.ts:296` copy, orchestrator (`orchestrator.agent.ts:360-364`) ใช้ `req.intakeIntent` เลือก code, API `line-ai-terminal-outcome.logic.ts:70,88` + `line-ai-formatter.logic.ts:24` + classifier; test E4 replay จาก log จริง
5. `receipt-ocr-apply.service.ts:351-375` — บรรทัดค่าใช้จ่ายเพิ่มไม่มีหลักฐาน VAT → null + NEEDS_REVIEW; WHT ไม่กระจาย; เอกลักษณ์ยอด; การ์ดสรุป (`receiptItemLines`/builder) แยกกลุ่ม "ค่าใช้จ่ายเพิ่ม"
6. docs: ADR 0011 (โหมด receipt), capture-correction spec (honesty), advisor spec (refusal code)

### B: `codex/expense-charge-kind`
1. Prisma: `enum ExpenseLineChargeKind` (7 ค่า) + `ExpenseLine.chargeKind ExpenseLineChargeKind?`; migration additive; `prisma validate`
2. contracts: `ExpenseLineChargeKind`, DTO/detail `charges[]`; API mappers, `updateExpenseDraft` รับ chargeKind; reconcile/validation รู้เอกลักษณ์ §5.1
3. OCR apply ตั้ง chargeKind + คำอธิบายไทย; ตัวคัดลอกบรรทัด (substitute receipt continuation, reimbursement→expense) พก chargeKind
4. web `ExpenseReviewPage` + `expense-review-validation.ts` + QA spec: กลุ่ม "ค่าใช้จ่ายเพิ่ม", แถวสรุปค่าบริการ, ปุ่มเพิ่ม/ลบในโหมดแก้ไข, มือถือ 390px
5. read tools `expense.get_detail`/`list` คืน `charges`; CSV export ถ้ามีคอลัมน์บรรทัด → เพิ่ม chargeKind
6. impact report ตาม spec §9 ทีละแถว

### C: `codex/line-ai-explain-record`
1. API internal tool `expense.explain_record` + resolver ร่วมกับ correction lane (ย้าย recency/provenance ออกเป็น helper เดียว)
2. gateway registry + agent + router hints; orchestrator ไม่ตก `unsupported_yet` เมื่อ tool นี้ตอบได้
3. renderer deterministic (template ไทย) + test ตัวเลขห้ามแต่ง; local drive J2 ด้วยข้อความจริงของ Owner

### D: `codex/line-ai-draft-edit`
1. contracts `LineDraftUpdatePreview/Postback`, category `draft_update`, registry 5 tools
2. API: preview (dry-run reconcile) / apply (transaction + `updatedAt` guard + audit) endpoints ใน internal tools controller; Redis preview key; flag `LINE_AI_DRAFT_EDIT_ENABLED`
3. LINE: การ์ด preview + postback ยืนยัน/ยกเลิก ใน webhook use-case (ตามแบบ postback เดิม `:1630`); correction lane ย้ายมาใช้ tools; ลบ `amountOnlyLine`
4. security eval ≥ 6 กรณี (§11); local drive J3 ทั้ง 4 ข้อ; UAT flag wiring ใน `deploy.sh`
5. docs: capture-correction spec (tools), runbook LINE flags, UAT script J1–J4

## 3. Definition of done ต่อ slice

- ผู้ทำส่ง: head SHA, delta, gate counts (api fixed-list, typecheck, prisma validate, pins `--check`, web test/build เมื่อแตะ web), mutation table, impact report §9
- reviewer อิสระ: READY พร้อมหลักฐาน (รัน gate เอง, mutation ซ้ำ, กรณี security)
- Fable: ตรวจ gap/bug รอบ ๆ อีกชั้น แล้ว PR → develop (admin-merge หลัง CI เขียว)

## 4. ก่อน deploy (ครั้งเดียว)

1. ทุกสาขา merge develop; PR develop → main หนึ่งครั้ง
2. waiver openssl 2026-08 หมดอายุ 2026-09-10 — ต่ออายุตามที่ Owner สั่ง ("ได้") ก่อน dispatch ถ้าเลยวันนั้น (ทั้ง policy jq และ contract rows)
3. UAT flags: `LINE_AI_DRAFT_EDIT_ENABLED=true` ใน `deploy.sh` jq block ของ UAT
4. ตามโปรโตคอล `docs/runbooks/uat-production-v2-deployment.md` + สคริปต์ `uat-verify.sh` 25 ข้อ + เพิ่มข้อตรวจ J1–J4 ผ่าน LINE จริงโดย Owner
