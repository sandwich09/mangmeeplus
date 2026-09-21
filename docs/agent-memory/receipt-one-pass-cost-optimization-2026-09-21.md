# Agent Memory: receipt one-pass cost optimization

Status: Implemented, merged initial slice, and paid benchmarked; follow-up safety fixes ready, final full 2-pass rerun still open
Owner: Codex / product owner decision 2026-09-21
Scope: ลด `ocr.receipt.extract-repair` และ `ocr.receipt.image-reread`; เพิ่ม one-pass receipt สำหรับ LINE image intake ที่มั่นใจสูง; ไม่เปลี่ยนราคาแพ็กเกจ
Decisions:
- ใช้ provider call ของ `line.intake-route` เดิมและ contract แบบ optional; ไม่เพิ่ม classifier, model หรือ dependency
- Gateway ต้อง validate candidate ด้วย parser/evidence/business/total/VAT/item gates เดิมก่อนส่ง `onePassReceipt`
- API ข้าม `receipt-ocr` ก่อนการจองขั้นนั้นเมื่อ one-pass ผ่าน เพื่อไม่ทิ้ง reservation ที่ไม่มี provider usage
- Fallback เดิมคงอยู่และเก็บ bounded reason โดยไม่ log OCR text
- Fail closed ที่ 1–20 item rows และต้อง reconcile (parser เก็บแถวเดียวเฉพาะ one-pass); candidate ไม่เกิน 12,000 chars; currency/VAT/WHT/discount/additional charges ที่พิมพ์ต้องอยู่ครบและ reconcile
- Paid benchmark จำกัด final one-pass ไว้ที่ `RECEIPT`/`HANDWRITTEN_CASH_BILL`; tax invoice ทุกชนิดใช้ specialist OCR เพราะพบ vendor OCR typo ใน candidate
- exact-span recovery ยอมเฉพาะ printed settlement/total, unique description+amount row และ unique unambiguous receipt date; ทิ้ง unprinted computed unit price และบังคับ vendor อยู่ issuer side
- Audit เก็บ `processingPath` และ bounded reasons; benchmark harness ใช้ one-pass branch จริงและรายงานจำนวน one-pass
Open questions:
- exact final SHA ต้องรัน full corpus 9 รูป × 2 อีกครั้งเมื่อมีงบเพิ่ม; warm full-corpus ผ่านเป้าแล้วแต่ targeted final checks ไม่แทน cold+warm acceptance
Artifacts:
- `docs/specs/line-ai-ledger-lifecycle-remediation-spec-th.md` §10.3
- `docs/plans/line-ai-ledger-lifecycle-remediation-plan-th.md` C2
- `scripts/line-ai-intake-cost-benchmark.ts`
- `docs/research/receipt-one-pass-cost-benchmark-2026-09-21.md`
Verification:
- PASS `pnpm --filter @watchdog-bms/ai-gateway exec tsx --test --test-reporter=dot src/modules/line-ai/agents/intent-router.agent.spec.ts src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts` — 211 tests
- PASS `pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=dot src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — 376 tests
- PASS `pnpm exec tsx --test --test-reporter=dot scripts/line-ai-intake-cost.corpus.spec.ts` — 10 tests
- PASS contracts/config build, AI Gateway `tsc --noEmit`, API `node --max-old-space-size=8192 ../../node_modules/typescript/bin/tsc --noEmit`, benchmark dry-run, `git diff --check`
- PAID: initial before `2986fba6…` vs after `88600c63…`, 9 images × 2, same corpus/model/FX — after ไม่ผ่าน (`฿1.56/successful`, one-pass 0)
- PAID: follow-up warm `b01636f2…`, 9 images — `฿1.27/successful`, 2 one-pass, calls 26; totals/date/VAT ไม่ถดถอย, vendor 4/5 vs baseline aggregate 7/10
- PAID: final safety `5e7947dc…`, handwritten 2/2 one-pass, 1 call, `฿0.63/฿0.64`; tax invoice ถูกส่งกลับ specialist OCR; cumulative spend `฿85.49`
- PASS final focused suites: AI Gateway 186 tests, API receipt path 345 tests, frozen-corpus integrity 9 tests, AI Gateway typecheck และ `git diff --check`
Next:
- Integrate follow-up safety commits into develop/main per owner authorization
- With a new paid budget, run exact final 9-image corpus × 2 and close C2 only if `< ฿1.50/successful`, accuracy/retry/parse/truncation remain non-regressed
- No UAT/Production deploy occurred in this benchmark turn; deploy only through the mandatory release protocol when explicitly requested
