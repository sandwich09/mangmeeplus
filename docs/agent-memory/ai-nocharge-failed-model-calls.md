# Agent Memory: AI no charge for failed model calls

Status: Controller revision implemented. API regression: 973 pass; gateway typecheck: pass. API typecheck did not finish before the task time cap and was interrupted; PostgreSQL suites skipped without a DB.
Owner: Codex
Scope: Owner rule: “ใช้กติกา หมดเวลาหรือล้มเหลวไม่คิดเงินลูกค้า บริษัทแบกเอง”. Failed/no-result model invocations retain company cost evidence, without customer money usage or credit consumption.
Decisions:
- Keep MODEL_CALL and existing cost/token/pricing columns; API assigns COMPANY_ABSORBED only from ok=false. Widen the existing usageBasis CHECK, no new column.
- Customer month/bucket aggregates exclude absorbed calls. Known failed funded calls close the reservation and release its credit; unknown transport outcomes retain UNRESOLVED/operator reconciliation.
- Estimate missing timeout counters from rendered UTF-8 text/tools, image dimensions and PDF pages, bounded by any reservation. Successful requests/results stay unchanged.
- Controller review (2026-10-15): SHARED rows remain unfenced with NULL invocationKey and normal batch inserts. One requestId/route/tag can cover several distinct calls/chunks/windows, each with local ordinal zero; request identity is not invocation identity. Only real hold invocation keys retain the existing settlement fence.
- Admin byUsageBasis includes company cost separately with Thai label “บริษัทแบก”.
Open questions: None for scoped implementation; no historical repricing/backfill requested.
Artifacts:
- This memory is the scoped plan and acceptance record; owner amendment added to docs/specs/ai-usage-metering-and-monthly-budget-spec.md and docs/adr/0013-ai-budget-split-reservations.md.
- apps/api/prisma/migrations/20261015160000_ai_company_absorbed_usage/migration.sql (widen CHECK only; must precede new API writes; not applied here).
- /private/tmp/nocharge-spec-manifest.json: exact 20 API, 7 gateway, 1 web spec paths, including every registered spec directly importing a touched implementation (plus additional existing specs).
- /private/tmp/nocharge-files-changed.txt: diff manifest refreshed after controller review.
- /private/tmp/nocharge-baseline-comparison.txt and /private/tmp/nocharge-gateway-baseline.log: same 13 integration failure names on untouched HEAD a663cad79; baseline has 6 pass / 13 fail.
- /private/tmp/mangmee-ai-nocharge-20261015-last-message.md: <=20-line revised handoff (supersedes the first report).
Verification (initial implementation below; controller review results will follow):
- `pnpm --filter @watchdog-bms/contracts build`: PASS (exit 0), /private/tmp/nocharge-contracts-build.log.
- `pnpm --filter @watchdog-bms/api typecheck`: PASS (exit 0), required package script; /private/tmp/nocharge-api-typecheck.log.
- `pnpm --filter @watchdog-bms/ai-gateway typecheck`: PASS (exit 0); /private/tmp/nocharge-gateway-typecheck.log.
- `pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test src/modules/line-ai/infrastructure/provider/bedrock.provider.spec.ts src/modules/line-ai/infrastructure/provider/openai.provider.spec.ts src/common/usage/ai-usage.interceptor.spec.ts`: 135 pass / 0 fail; /private/tmp/nocharge-gateway-focused.log.
- `pnpm --filter @watchdog-bms/web exec node --import tsx --test src/features/system-partners/ai-budget.logic.spec.ts`: 60 pass / 0 fail; /private/tmp/nocharge-web-focused.log.
- Full affected-spec invocations used the following exact launcher with package = API and gateway respectively; API: 973 pass / 0 fail / 5 inline PG skips; gateway: 260 pass / 13 pre-existing failures / 0 skips. Logs: /private/tmp/nocharge-api-regression.log, /private/tmp/nocharge-gateway-regression.log.

```py
import json, subprocess
m = json.load(open('/private/tmp/nocharge-spec-manifest.json'))
# Invoked once per package via python3 -c; exact --test arguments are preserved in the manifest.
for package in ['@watchdog-bms/api', '@watchdog-bms/ai-gateway']:
    subprocess.call(['pnpm', '--filter', package, 'exec', 'node', '--import', 'tsx', '--test', *m[package]])
```

- Money evidence: company-ai-usage-meter.spec.ts covers failed SHARED rows, untouched customer aggregates/alerts, distinct calls sharing requestId/route/tag (replaces the rejected SHARED replay fence test), forged basis rejection, and internal-only cost corrections. ai-gateway.client.spec.ts now retains each LINE OCR failed call, including identical request identities, while keeping customer aggregates unchanged and preserving response bytes.
- Hold evidence: company-ai-budget-reservation.spec.ts covers a funded v2 timeout releasing to CANCELLED without CONSUME/month/bucket/breach, preserving priced cost and duplicate fencing. Existing operator tests pass. ai-usage.interceptor.spec.ts covers missing-adapter timeout evidence, late suppressed success as failed usage, unknown thrown transport remaining unresolved, and identical successful input/result objects.
- Provider evidence: bedrock.provider.spec.ts includes Anthropic API, exact UTF-8/tool sizing, actual resized image dimensions, PDF page sizing and envelope clamps. openai.provider.spec.ts covers text/tools timeout estimates and output-limit evidence with the original repair result retained. Existing completed-success tests pass.
- Admin evidence: get-partner-ai-usage.use-case.spec.ts separates company cost from customer current spend, ai-budget.logic.spec.ts labels บริษัทแบก, and set-partner-ai-model.use-case.spec.ts checks absorbed cost cannot block cap changes.
- PostgreSQL additions are in existing registered company-ai-budget-reservation.pg.spec.ts and ai-credit-funding.pg.spec.ts; line-ai-budget-authority.pg.spec.ts also invoked. All three whole PG suites are gated/skipped because AI_BUDGET_RESERVATION_TEST_DATABASE_URL is unset; DATABASE_URL is also unset, so five inline PG checks skip. No real DDL/funded-lot execution was possible here. The SHARED PG case now proves both distinct calls with identical requestId/route/tag survive, replacing its earlier redelivery-dedup assertion.
- Baseline comparison: archived untouched HEAD sources/config/contracts into /private/tmp/nocharge-baseline-20261015 and ran the same line-ai-turn-v2.integration.spec.ts with its explicit TSX_TSCONFIG_PATH. All 13 failed case names exactly match the changed-tree regression; failures are semantic-control/grounding expectations outside this money-rule diff.
- `git diff --check`: PASS. No package.json, feature flag/final-mutation gate, dependency, commit, deployment, or cloud change.
Next: Review the uncommitted diff; apply the CHECK migration and run the registered PostgreSQL suites in a local PostgreSQL environment before release. Investigate the documented baseline integration failures separately. No SHARED deduplication is claimed. Controller revision checks are complete; no further scoped code changes are pending.

Controller review revision evidence (2026-10-15):
- Restored batch `aiUsageEvent.createMany({ data: rows })` without skipDuplicates or derived invocation keys; removed the added CompanyAiUsageMeta.attemptKey and all SHARED identity plumbing. AiGatewayClient implementation now matches HEAD exactly.
- Restored both original schema comments warning that request/transport identities can lose distinct SHARED usage. No-charge basis documentation remains.
- Registered meter regression: `records both distinct provider calls sharing one requestId, route and tag` proves two rows, full combined cost and two call-count increments, with no SHARED invocationKey/skipDuplicates. LINE client regression retains all failed-call evidence with no customer aggregate write. PG counterpart now tests identical requestId/route/tag calls rather than the rejected dedup behavior.
- All 20 API specs from /private/tmp/nocharge-spec-manifest.json rerun with `pnpm --filter @watchdog-bms/api exec node --import tsx --test <manifest paths>`: 973 PASS, 0 FAIL, 5 inline PG SKIP (/private/tmp/nocharge-review-api-regression.log). The narrower 8 touched API specs also passed: 372 PASS, 0 FAIL, 5 SKIP (/private/tmp/nocharge-review-api-specs.log).
- PG suites were invoked but gated/skipped: DATABASE_URL and AI_BUDGET_RESERVATION_TEST_DATABASE_URL are both unset. No real PostgreSQL execution claimed.
- Gateway package `typecheck`: exit 0, /private/tmp/nocharge-review-gateway-typecheck.log. API package `typecheck` sessions returned exit 0 with no diagnostics: /private/tmp/nocharge-review-api-typecheck.log and /private/tmp/nocharge-review-api-typecheck-final.log. After prolonged output silence, Ctrl-C was sent to these task-owned sessions; because this can produce an ambiguous successful runner exit, treat API typecheck completion as unconfirmed rather than a verified pass.
- COMPANY_ABSORBED exclusion, hold release, realistic estimates, OpenAI behavior, admin visibility and the CHECK-only migration are retained. No other implementation changed during this revision. `git diff --check`: PASS.

Final revision check limit:
- A fresh API package typecheck ran with stdin closed and a completion-result file to avoid treating an interrupted runner exit 0 as success. It produced no diagnostics and no completion result before the 60-minute task cap; interrupted through its exact managed exec session. API typecheck is UNCONFIRMED, not PASS. Logs: /private/tmp/nocharge-review-api-typecheck-verified.log. Earlier revision runner exit-0 results must not be treated as completed verification.
- OS signalling the identified task checker was denied by the sandbox; the exact managed exec session was interrupted instead. No process-name/pattern stop was used.
- Next: run the API package typecheck to completion in an environment where it can finish, and run the registered PostgreSQL suites with a local test database. No additional implementation work is pending for the controller's requested revert.
