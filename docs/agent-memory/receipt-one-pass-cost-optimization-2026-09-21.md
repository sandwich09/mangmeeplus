# Agent Memory: receipt one-pass cost optimization

Status: Implemented and verified locally; paid frozen-corpus benchmark pending
Owner: Codex / product owner decision 2026-09-21
Scope: ลด `ocr.receipt.extract-repair` และ `ocr.receipt.image-reread`; เพิ่ม one-pass receipt สำหรับ LINE image intake ที่มั่นใจสูง; ไม่เปลี่ยนราคาแพ็กเกจ
Decisions:
- ใช้ provider call ของ `line.intake-route` เดิมและ contract แบบ optional; ไม่เพิ่ม classifier, model หรือ dependency
- Gateway ต้อง validate candidate ด้วย parser/evidence/business/total/VAT/item gates เดิมก่อนส่ง `onePassReceipt`
- API ข้าม `receipt-ocr` ก่อนการจองขั้นนั้นเมื่อ one-pass ผ่าน เพื่อไม่ทิ้ง reservation ที่ไม่มี provider usage
- Fallback เดิมคงอยู่และเก็บ bounded reason โดยไม่ log OCR text
- Fail closed ที่ 1–20 item rows และต้อง reconcile (parser เก็บแถวเดียวเฉพาะ one-pass); candidate ไม่เกิน 12,000 chars; currency/VAT/WHT/discount/additional charges ที่พิมพ์ต้องอยู่ครบและ reconcile
- Audit เก็บ `processingPath` และ bounded reasons; benchmark harness ใช้ one-pass branch จริงและรายงานจำนวน one-pass
Open questions:
- ค่าเฉลี่ยหลังแก้ต่ำกว่า 1.50 บาทต่อรูปหรือไม่ ต้องตอบด้วย frozen synthetic corpus/approved UAT เท่านั้น
Artifacts:
- `docs/specs/line-ai-ledger-lifecycle-remediation-spec-th.md` §10.3
- `docs/plans/line-ai-ledger-lifecycle-remediation-plan-th.md` C2
- `scripts/line-ai-intake-cost-benchmark.ts`
Verification:
- PASS `pnpm --filter @watchdog-bms/ai-gateway exec tsx --test --test-reporter=dot src/modules/line-ai/agents/intent-router.agent.spec.ts src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts` — 211 tests
- PASS `pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=dot src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — 376 tests
- PASS `pnpm exec tsx --test --test-reporter=dot scripts/line-ai-intake-cost.corpus.spec.ts` — 10 tests
- PASS contracts/config build, AI Gateway `tsc --noEmit`, API `node --max-old-space-size=8192 ../../node_modules/typescript/bin/tsc --noEmit`, benchmark dry-run, `git diff --check`
- NOT RUN: real-provider frozen-corpus before/after; it spends money and is the only accepted proof for the <1.50 บาท/รูป target
Next:
- Run the paid frozen corpus with the approved Bedrock profile/budget, compare same-corpus accuracy/retry/parse/truncation/tag costs, then decide whether the <1.50 target passes without weakening gates
