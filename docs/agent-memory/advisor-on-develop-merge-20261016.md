# Agent Memory: advisor-on-develop-merge-20261016

Status: complete locally; all 24 conflict files are marker-free; final package checks completed, with remaining failures proven identical on develop 5e8c68266. Unstaged and uncommitted.
Owner: Codex, 2026-10-16.
Scope: combine develop 5e8c68266 (sold UX, commit 5321d6031) with claude/advisor-all-20261015; edit only, controller stages/commits.
Decisions:
- Preserve sold screens and claim order: send, approve, pay, sign; retain signed LINE confirmations and shared use-case guards.
- Combine transaction-aware reimbursement expense confirmation with read-only LINE preview and revision fencing.
- Keep web reviewer selection and payment-slip uploads alongside LINE preview/evidence linking.
- Sold receipt rules govern the shared helper: append after payment is allowed; replacement is refused.
- Keep timezone-aware expense payment dates, sold withholding filing/establishment workflow and payment-backed certificates. LINE revisions use separate arguments from web payment/reviewer IDs.
- Keep current sold guide text/hashes and advisor draft help cards. Remove the incoming extra web tax-guide section; cite its existing WHT section instead. Sold approved pack stays v4/12 cards; incoming proposed additions become DRAFT v5/16 cards.
- LINE voucher preview checks the sold actor/ownership/inactive-preparer recovery rules; it cannot offer a return of the actor's own voucher. Signed execution keeps the same guards.
- LINE certificate cards display the issuer's payment-backed proportional amounts rather than the old whole-expense prefill; unpaid/unknown-date sources refuse before any write.
- Keep the sold establishment-aware frozen withholding filing implementation; retain the advisor's shared due-day helper for LINE reads.
- Internal LINE-only revision errors are explicitly excluded from the web HTTP translation inventory, like existing internal LINE errors; no sold screen copy/layout changes.
- No stage/commit/package.json/dependency/flag/budget/final-mutation-policy changes.
Open questions: none; baseline any remaining failures on an exact parent archive.
Artifacts:
- /private/tmp/advisor-merge-original stores the conflicted input files; /private/tmp/advisor-merge-resolved-files.txt lists all 34 resolution paths including this memory. Final report: /private/tmp/advisor-on-develop-last-message.md.
- /private/tmp/advisor-merge-tests.py reads the unmodified package scripts and invokes their exact file lists with `pnpm --filter <package> exec node --import tsx --test`; only the dot reporter is changed to TAP for counts. Each exact argv is saved in /private/tmp/advisor-merge-<package>-<script>.command.json.
- /private/tmp/advisor-merge-final-source-hashes.json freezes the final merge sources; /private/tmp/advisor-merge-baseline-comparison.json compares failure names, failure types, error text and codes.
- Exact parent archive: /private/tmp/advisor-merge-develop-baseline, created with `git archive 5e8c68266`; workspace dependency links point to that archive's packages. Its contracts were built and its Prisma client was generated separately.
Verification:
- `pnpm --filter @watchdog-bms/contracts build`: exit 0; `pnpm --filter @watchdog-bms/api exec prisma generate`: exit 0.
- Final frozen-source `pnpm --filter @watchdog-bms/api typecheck`: exit 0 (/private/tmp/advisor-merge-api-typecheck-frozen.log). `pnpm --filter @watchdog-bms/ai-gateway typecheck`: exit 0 (/private/tmp/advisor-merge-gateway-typecheck-final.log).
- Full contracts package test list: 449 passed. Full config list: 154 passed. Full web list: 4,738 passed.
- Full gateway list: 2,017 passed, 0 failed, 46 cancelled. All 46 runtime cancellation names/type/error/code are identical on develop 5e8c68266; runtime-only reproductions: /private/tmp/advisor-merge-gateway-cancellations{,-baseline}.log. Full parent gateway list: 1,547 passed, 46 cancelled.
- Full API pretest list: 16 passed, 131 skipped, 0 failed. Full main list: 11,894 passed, 198 skipped, 2 failed. Both failures match the exact develop parent in name/type/error/code: localhost listen EPERM; /private/tmp/advisor-merge-api-test.log and /private/tmp/advisor-merge-api-socket-baseline.log.
- W00 regenerated with `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts`: 5 passed; the same command without the update environment also passed 5, and the full main run verifies ordinary frozen parity.
- Real-module DI and table-driven delivery-plan: `pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/application/use-cases/erp-draft-update-tools.di.spec.ts src/modules/line-ai/domain/logic/line-delivery-plan.logic.spec.ts`: 34 passed.
- Final focused LINE security + issuer: 226 passed. Upload/OCR/webhook regression group: 666 passed. Approved/draft knowledge integrity: 112 passed.
- API socket-only reproduction on merged and exact parent: `pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/infrastructure/line-reply.adapter.spec.ts`; 2 identical listen EPERM failures on both, caused by forbidden localhost listening.
- `git diff HEAD --check`: passed. All 24 originally conflicted files are marker-free; the unmerged index is intentionally retained for controller staging. No package.json differs from HEAD.
Integration evidence:
- Claim send/approve/pay/sign order and owner self-approval: reimbursement-request, reimbursement-approval and reimbursement-payment-posting registered specs; sold web claim journey/content suites retained.
- Expense confirmation retains the reimbursement transaction parameter and adds a separate internal LINE option; signed web/LINE guards, category/evidence review, replay and tenant/branch/revision refusal: line-draft-update.security.spec.ts.
- Web reviewer selection/notification/idempotency stays intact; LINE revision uses a fourth argument: expense-branch-scope and prisma-expense.repository.payment registered specs.
- Web payment slips and LINE evidence linking coexist in the payment transaction: record-expense-payment and prisma-expense.repository.payment specs; Bangkok-midnight dates remain authoritative.
- Paid expense append/replacement rules: expense-upload.use-case.spec.ts includes the sold status matrix and the LINE append-without-money-change case.
- Voucher lifecycle, actor ownership/recovery, support files, bank reveal, source revisions and signed lane: expense-related-access.use-case.spec.ts; LINE preview adds no audit/reservation/write.
- Payment-backed WHT preview/issue, unsupported income, payment shares/date, payment ID versus signed revision and transactional fences: issue-wht-certificate-from-handoff.use-case.spec.ts; card uses these preview facts in line-draft-update.security.spec.ts.
- OCR company-VAT presets and transfer-slip/vendor handling both retained; merged OCR runner fixture supplies the existing VAT fact repository.
Open doubts: no live LINE/browser/PostgreSQL execution in this offline sandbox; database tests report their skips. Sold screen sources remain identical to HEAD, so no new screen/browser acceptance is claimed.
Next: controller stages the 24 unmerged entries and remaining resolution changes, then commits. No local implementation/check work remains. Database/live acceptance needs the environment represented by the skipped tests.
