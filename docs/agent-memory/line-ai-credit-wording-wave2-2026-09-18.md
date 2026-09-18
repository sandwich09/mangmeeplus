# Agent Memory: LINE AI wave 2 — เครดิต AI wording, receipt refusal copy, deterministic reads

Status: spec + plan written 2026-09-18 from owner decisions (message 2026-09-18). H2 (deterministic reads, R5) IMPLEMENTED and verified locally including the owner-authorised corpus replay — awaiting controller review, PR and CI; H1 (wording / receipt copy / billing holds) not started. Nothing deployed.
Owner: thawatchai + Fable 5.1 (controller) + Opus 5 (implementer)
Scope: [spec](../specs/line-ai-credit-wording-and-deterministic-reads-spec-th.md), [plan](../plans/line-ai-credit-wording-and-deterministic-reads-plan-th.md). Continues the A–F remediation ([handoff](line-intake-cost-and-budget-receipt-behavior-2026-09-17.md#delivery-summary-and-handoff--2026-09-18)).
Decisions:
- "เครดิต AI" (not bare "เครดิต") because the ledger/expense UI already uses เครดิต for debit/credit, credit cards and tax credit.
- Document-reading refusals on the picture lane collapse money (OCR bucket / TOTAL on that lane / insufficient) and read-count exhaustion into one customer sentence "เครดิตสำหรับการอ่านเอกสารไม่พอ"; codes, scopes, terminal classes and the R-05 count/money separation are unchanged.
- R5: deterministic families widened (tax/VAT, low stock, AP outstanding, CRM new customers + the daily-closing miss); breakdown/explain questions stay on the grounded agentic path where the composer's numeric guard forbids model-computed numbers; Production keeps the lane enabled (parity default).
- Trial numbers (spec §7): chat 80 THB, receipts 15 (count), OCR money guard 60 THB, total 140 THB — applied per company by an admin after deploy; per-package defaults belong to the coming credit concept.
Open questions:
- ~~Owner authorisation for the R5 corpus replay Bedrock spend~~ — granted 2026-09-18; run done, THB 16.52 of the THB 100 phase guard (see H2 Verification).
- Owner confirmation of the hold-reconciliation proposal (auto-recover from gateway `ai.usage` logs → admin console release/charge-at-bound → alert) before a spec is written.
- H2 residual for the owner: `tax.get_vat_summary` has no whitelisted input field, so neither the lane nor the loop can ask for a period other than the current one — `ภาษีเดือนที่แล้ว` is answered for the period the tool defaults to, labelled with that period. Whitelisting `periodKey` changes the intake catalog, so it needs its own round.
- H2 residual: letting the model give real advice needs `SAFE_REPLY_WORDS` widened (and its compound entries fixed — `ตรวจสอบ` never matches because `Intl.Segmenter` splits it). That widens what the model may say, so it is an owner decision, not a side effect of this wave.

## H2 — deterministic business reads (R5), 2026-09-18

Artifacts (worktree `/private/tmp/mangmee-line-ai-wave2-h2-20260918`, branch `codex/line-ai-wave2-h2-deterministic-reads-20260918`, off docs commit `5d158ff0`):

| file | why |
| --- | --- |
| `apps/ai-gateway/.../agents/prepared-simple-read-formatter.ts` | F4–F7 compiled formatters + `isCount`/`isMoney`; registry now 10 keys |
| `apps/ai-gateway/.../agents/prepared-simple-read-formatter.spec.ts` | F4–F7 answer/empty/locale/unverified tests against the REAL tool shapes |
| `apps/ai-gateway/.../domain/logic/prepared-simple-read.logic.spec.ts` | the daily-closing miss pinned per plan variant + eligibility for all four new families |
| `apps/ai-gateway/.../agents/orchestrator.agent.ts` | `date` joins the civil-date/backing check; `no_prepared_plan` fallback reason |
| `apps/ai-gateway/.../agents/orchestrator.agent.spec.ts` | prepared-lane telemetry tests (served / reason / no_prepared_plan / silent) |
| `apps/ai-gateway/.../agents/inventory.agent.ts` | low-stock fact carries its source ref; the tool as-of is no longer dropped |
| `apps/ai-gateway/.../agents/response-composer.agent.ts` | Thai numerals normalised before every numeric membership test (both guards) |
| `apps/ai-gateway/.../agents/response-composer.agent.spec.ts` | W-06 grounded-breakdown tests |
| `apps/api/.../use-cases/erp-tools.use-case.ts` | low-stock tool leads with its report source ref, not a product id |
| `infra/prod-ecs-express/deploy.sh` | 10-family default allowlist, both envs; stale "production refuses" comment corrected |
| `infra/prod-ecs-express/production-serving-mode.spec.sh` | pins every compiled family in the default |
| `scripts/line-ai-intake-cost-benchmark.ts` | PROD_FLAGS allowlist mirrors deploy.sh; VAT + AP stub shapes corrected to the real tool results |
| `.github/workflows/deploy-production.yml`, `infra/security/validate-production-maintenance-release.sh` | pin re-sync (the syncer's own two lines) |

Decisions:
- `text-read-daily-closing` is NOT a gate/formatter defect: the corpus message is two requests in one, so the intake plan is `complex` (`not_simple`) or carries no simple `answerShape`. One simple daily-closing read is eligible and served (test-pinned). Left alone.
- AP and CRM register both read shapes; the deterministic answer is identical either way and `answerShape` only selects a renderer.
- The low-stock family prints a count and no product: the tool's rows carry ids, quantities and location ids only — no name, sku or unit.
- The AP family prints no supplier: `supplierDisplayName` is the supplier id upstream.
- The VAT family prints the tool's period key, both VAT sides, the raw period status and a compiled not-certified line, and never renders a negative "ต้องนำส่ง".

Verification (all local, 2026-09-18, heavy ones behind `/tmp/mangmee-heavy.lock`):

| command | result |
| --- | --- |
| `pnpm --filter @watchdog-bms/ai-gateway test` | 1186/1186 pass, 0 fail (141 suites) |
| `pnpm --filter @watchdog-bms/ai-gateway lint` (tsc --noEmit) | clean |
| `pnpm --filter @watchdog-bms/api test` (apps/api touched) | exit 0, 9164 dot-tests, 0 failures |
| `node scripts/run-line-ai-whole-chain-acceptance.mjs` | PASS (all 8 suites, incl. serving-mode contract) |
| `pnpm test:harness` | 17/17 pass |
| `bash infra/prod-ecs-express/production-serving-mode.spec.sh` | PASS |
| `node infra/security/sync-production-maintenance-release-pins.mjs` then `--check` | updated → current |
| `git diff --check` | clean |
| focused: formatter + security + eligibility + composer specs | 219/219 pass (security spec unmodified) |

Corpus replay (W-07), owner-authorised, real Bedrock via `AWS_PROFILE=watchdog-bedrock`, corpus `cf9bce44…`, THB 33/USD, 2 repetitions, business-read text tasks only, `--max-thb 60`:

```sh
cd apps/ai-gateway
MODEL_PROVIDER=bedrock AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
  BEDROCK_REGION=ap-southeast-1 BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6 \
  pnpm exec tsx ../../scripts/line-ai-intake-cost-benchmark.ts --smoke \
    --max-thb 60 --thb-per-usd 33 --label r5-smoke --out <scratch>/agent-h2/r5-after
MODEL_PROVIDER=bedrock AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
  BEDROCK_REGION=ap-southeast-1 BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6 \
  pnpm exec tsx ../../scripts/line-ai-intake-cost-benchmark.ts \
    --label r5-after --repetitions 2 --thb-per-usd 33 --max-thb 60 \
    --only text-read-sales-month,text-read-expense-total,text-read-expense-breakdown,text-read-tax-vat,text-read-inventory-low,text-read-daily-closing,text-read-glossary-shorthand,text-read-ap-outstanding,text-read-crm-new-customers,text-read-explain-record,text-denied-read-no-query-permission \
    --out <scratch>/agent-h2/r5-after
```

Result (run `r5-after-2026-09-18T05-24-00-176Z`, git `21e45227`; before = `after-2026-09-17T16-13-27-267Z`): prepared-lane hit 8 → **16** of 22 records, success 22/22 and routing 22/22 unchanged (no success→fail), calls/turn 4.27 → 2.50, THB/successful 0.942 → 0.750. Spend: smoke THB 0.01 + run THB 16.51 = **THB 16.52** of THB 100 (ledger `<scratch>/agent-h2/spend-ledger.jsonl`). Still missing the lane: expense-breakdown and explain-record (no family by design) and daily-closing (router's plan). Detail + the four "found, not changed" items in [research §14](../research/line-ai-intake-cost-benchmark-2026-09-17.md).

Telemetry to read production with: `line.ai.prepared_simple_read.served` (`tool`, `answerShape`), `.honest_terminal` (`tool`, `status`), `.fallback` (`reason` — the eligibility reason, plus the new `no_prepared_plan` for a business read that arrived without a plan). All carry `requestId` only; no message text.

Next: H1 wording/receipt-copy/billing holds (separate worktree), controller review of this diff, then PR pair and the strict CI chain. H2 is NOT deployed; W-08/W-09 belong to H1 and to the post-deploy UAT pass.
