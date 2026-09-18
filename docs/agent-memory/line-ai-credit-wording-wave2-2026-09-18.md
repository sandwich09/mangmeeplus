# Agent Memory: LINE AI wave 2 — เครดิต AI wording, receipt refusal copy, deterministic reads

Status: spec + plan written 2026-09-18 from owner decisions (message 2026-09-18). **H1 implemented and fully verified locally** on branch `codex/line-ai-wave2-h1-credit-wording-20260918` (worktree `/private/tmp/mangmee-line-ai-wave2-h1-20260918`, base `5d158ff0`) — not pushed, no PR, nothing merged, nothing deployed. H2 (deterministic reads) not started.
Owner: thawatchai + Fable 5.1 (controller) + Opus 5 (implementer)
Scope: [spec](../specs/line-ai-credit-wording-and-deterministic-reads-spec-th.md), [plan](../plans/line-ai-credit-wording-and-deterministic-reads-plan-th.md). Continues the A–F remediation ([handoff](line-intake-cost-and-budget-receipt-behavior-2026-09-17.md#delivery-summary-and-handoff--2026-09-18)).
Decisions:
- "เครดิต AI" (not bare "เครดิต") because the ledger/expense UI already uses เครดิต for debit/credit, credit cards and tax credit.
- Document-reading refusals on the picture lane collapse money (OCR bucket / TOTAL on that lane / insufficient) and read-count exhaustion into one customer sentence "เครดิตสำหรับการอ่านเอกสารไม่พอ"; codes, scopes, terminal classes and the R-05 count/money separation are unchanged.
- R5: deterministic families widened (tax/VAT, low stock, AP outstanding, CRM new customers + the daily-closing miss); breakdown/explain questions stay on the grounded agentic path where the composer's numeric guard forbids model-computed numbers; Production keeps the lane enabled (parity default).
- Trial numbers (spec §7): chat 80 THB, receipts 15 (count), OCR money guard 60 THB, total 140 THB — applied per company by an admin after deploy; per-package defaults belong to the coming credit concept.
Open questions:
- Owner authorisation for the R5 corpus replay Bedrock spend (≈ THB 60–100) — W-07 waits for it.
- Owner confirmation of the hold-reconciliation proposal (auto-recover from gateway `ai.usage` logs → admin console release/charge-at-bound → alert) before a spec is written.
Artifacts:
- H1 diff (33 files, +~430/-~200, all local commits with explicit paths):
  - LINE: `process-line-webhook.use-case.ts` (`aiBudgetReasonTh` now also answers `OCR_MONTHLY_LIMIT_EXCEEDED`/`OCR_QUOTA_UNAVAILABLE`; new `isDocumentReadingCreditSpent` for the 💚/⏳ choice; two now-dead governance branches deleted), `line-business-card.logic.ts`, `line-ai-formatter.logic.ts`, `apps/ai-gateway/.../line-ai-turn.use-case.ts`
  - Web customer/owner: `workspace-dictionary.ts` (th + en `expenses.extract_ai_budget_*`), `banking.logic.ts`, `InboxAiPanel.tsx`, `api-error-message.ts`
  - Admin: `PartnerDetailPage.tsx`, `ai-budget.logic.ts`, `PartnerAiAdjustmentHistory.tsx`, `PlatformAiBudgetPage.tsx`, `SystemHeader.tsx` (sidebar "เครดิตการใช้ AI"), `get-partner-timeline.use-case.ts`, `signup-ops-alert.service.ts`, `admin-ai-adjustments-smoke.ts`, `partner-ai-support-smoke.ts`
  - Billing (W-04): `packages/contracts/src/billing.ts` (`AI_CREDIT_HOLDS_PENDING`, `aiReservedSatang?`, `aiUnresolvedHolds?` — all additive), `company-ai-budget-readiness.ts` (`reserved: {TOTAL,CHAT,OCR}` from the snapshot it already reads), `billing-receipt-adjustments.service.ts`, `billing-plan-adjustments.service.ts`, `BillingReceiptAdjustmentsPage.tsx`, `BillingPlanAdjustmentsPage.tsx`
  - Guard: new `it` in `apps/web/src/common/api/api-error-coverage.spec.ts` greps apps/web+api+ai-gateway/src, packages/*/src, scripts, e2e for "งบ AI"/"โควตา AI"; allowlist holds exactly one entry (that spec itself, which must spell the phrases)
- Browser evidence: `docs/qa/evidence/line-ai-credit-wording-2026-09-18/` — 7 subjects × 1440/390 px (576 KB total), README with commands, seeded states and what each image proves
- Scratch (not in the repo): `<session scratch>/agent-h1/{env.sh,seed-h1-states.ts,capture.mjs}`
Verification (H1, 2026-09-18, all local, each heavy job behind `/tmp/mangmee-heavy.lock`):
- FULL `pnpm --filter @watchdog-bms/api test` → 10,553 tests, 0 failures (dot reporter; counted dots)
- FULL `pnpm --filter @watchdog-bms/web test` → 1,771 pass / 0 fail
- FULL `pnpm --filter @watchdog-bms/ai-gateway test` → 1,151 pass / 0 fail
- `pnpm --filter @watchdog-bms/contracts test` → 253 pass / 0 fail
- Focused: web 101 pass; api 700 (698 pass, 2 skipped = the two PG-only cases); gateway 33 pass
- `node scripts/run-line-ai-whole-chain-acceptance.mjs` → 21 repository scenarios + 3 controlled-external, 8 suites, all PASS
- `pnpm test:harness` → 17 pass / 0 fail
- Typechecks: api `tsc --noEmit` OK (needs `--max-old-space-size=8192`; the plain `pnpm lint` OOMs on this machine), web `next typegen && tsc --noEmit` OK, gateway OK, contracts OK
- `git diff --check` clean; final `grep -rn "งบ AI\|โควตา AI" apps packages scripts e2e infra` = only the 4 self-referential lines in the guard spec
- NOT run: `admin-ai-adjustments-smoke.ts` / `partner-ai-support-smoke.ts` (need the combined `billing-http-smoke` harness with Stripe fixtures and a second browser context, which the throwaway evidence stack does not provide) → their new selectors are proven by the `partner-ai-credit-form` screenshots and by CI
- Throwaway evidence stack: Postgres 15484 / Redis 16384 containers, API 3084, web 3085, `BILLING_MODE=test` with no Stripe secret, no provider, no LINE, no cloud; torn down, `apps/web/next-env.d.ts` restored, generated `apps/web/{AGENTS,CLAUDE}.md` removed
Next:
1. Controller (Fable) reviews the H1 diff for bugs/gaps/impact.
2. H2 (deterministic reads, spec §6 / W-05–W-07) — not started.
3. Merge develop into the H1 branch, then PR pairs + strict CI chain; the two browser smokes get their first real run there.
4. W-09 (real LINE transcript) after a UAT deploy, per the deployment runbook.

H1 findings worth carrying:
- The retired wording also hid behind collocations `grep "งบ AI"` cannot see: the sidebar item `งบการใช้ AI` (`SystemHeader.tsx`) and `platform_ai_budget_default_below_split_allocation` (`งบเริ่มต้น…`). Naive `sed` on `งบ` is unsafe — `ของบริษัท` and `ลงบัญชี` both contain it.
- `workspace-i18n.spec.ts` asserts the five `expenses.extract_ai_budget_*` reasons each read DIFFERENTLY, so §4's one-sentence collapse was applied to the LINE picture lane only (which is what W-02 asks for); the web keys took the §3 vocabulary and kept their distinct reasons.
- `isAiBudgetPermanentRefusal` answers for the four money codes only. Routing `OCR_MONTHLY_LIMIT_EXCEEDED` onto the shared sentence needed its own predicate, or a count ceiling would have been rendered with the transient ⏳.
- `readAiBudgetReadiness`'s truth table is asserted with `deepStrictEqual`, so the additive `reserved` field required three expectation updates in `company-ai-usage-meter.spec.ts` — behaviour unchanged.
