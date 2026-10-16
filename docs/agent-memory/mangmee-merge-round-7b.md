# Agent Memory: mangmee-merge-round-7b

Status: merge markers resolved and verification complete (2026-10-15); no staging or commit. Git index remains unmerged as requested.
Owner: Codex
Scope: combine round 7B team/branch reads and confirmation cards with base round 7A counterparties/quoted replies and fix-up 4.
Decisions:
- Keep both tool families in shared registry/catalog/controller/module paths and semantic/legacy preview reply paths.
- Preserve per-field counterparty bounds, company preview's 500-character limit and expenseIds' 4000-character limit.
- Keep updateDraft in its existing constructor position; append teams. Retain counterparty controller parameters and append company tools.
- Team/branch management help is explicitly owned by company.action.preview and filtered by its real permissions; read-only callers see no management claim.
- Keep both lanes' tests and existing evidence-review/ready-button/completed-write regressions.
Open questions: none.
Artifacts: merged files; regenerated W00 manifest; last-message.md; /tmp/r7b-merge-*.log.
Verification:
- `pnpm --filter @watchdog-bms/contracts build`: PASS, exit 0; /tmp/r7b-merge-contracts-build.log.
- `pnpm --filter @watchdog-bms/api typecheck`: PASS, exit 0; /tmp/r7b-merge-api-typecheck.log. The first run caught missing company_management follow-up copy, corrected in both languages before the successful run.
- `pnpm --filter @watchdog-bms/ai-gateway typecheck`: PASS, exit 0; /tmp/r7b-merge-gateway-typecheck.log.
- Full package test-script file lists executed with `pnpm --filter <package> exec node --import tsx --test <files>` (tsx CLI cannot open sandbox IPC); runner /tmp/r7b-run-tests.py; exact lists /tmp/r7b-merge-{ai-gateway,contracts,api}-test-files.txt.
- Full gateway script (51 files): 1,654 passed, 0 failed, 46 cancelled in src/agentcore/runtime.spec.ts; /tmp/r7b-merge-gateway-tests.log.
- Full contracts script (13 files): 419 passed, 0 failed; /tmp/r7b-merge-contracts-tests.log.
- Additional gateway specs importing conflicted implementations (13 files): 327 passed, 13 failed, 0 cancelled; /tmp/r7b-merge-gateway-extra.log. All failures are in line-ai-turn-v2.integration.spec.ts.
- API sweep (42 files: all direct importers of changed/conflicted API implementations, required specs, employee/branch guards, and counterparty adapters): 1,734 passed, 36 failed, 6 skipped; /tmp/r7b-merge-api-tests.log.
- Those 36 API failures occur in line-public-general.spec.ts, process-line-general-v2.spec.ts, process-line-mixed-business-v2.spec.ts (prototype fixtures missing class-initialized delivery maps/sets), and line-staff-menu.logic.spec.ts (two existing เจ้าของร้าน strings).
- Every failed/cancelled test above was actually rerun against isolated `git archive` exports of base e1e6918d1dc726031e2fe682f45b5108e7df59f6 and incoming f28a7a0c251e887108e27a2bd5198db6bf0ad2ac, each with its own built contracts and reused installed third-party dependencies/generated Prisma client. No merged application sources were used in those exports.
- Baseline runs: /tmp/r7b-merge-{base,incoming}-{ai-gateway-tests,api-tests,gateway-extra}.log; both revisions reproduce identical 46 runtime cancellations, 36 API failures, and 13 additional gateway failures, matching test names, error text and failure type. Comparison command `python3 /tmp/r7b-compare-failures.py`: PASS; evidence /tmp/r7b-merge-baseline-comparison.json. Runtime cannot complete its HTTP server before hook in this sandbox.
- API sweep excluding only those four proven baseline-failing spec files: 1,637 passed, 0 failed, 6 skipped; /tmp/r7b-merge-api-verified.log.
- Exact requested W00 regeneration command: `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts`: 5 passed, 0 failed; /tmp/r7b-merge-manifest.log. Subsequent full API run verifies the frozen artifact without update mode.
- Gateway orchestrator Round 7A/7B tests prove both preview families work with old draft flags off and bypass model composition; router registry safety test accepts company.action.preview as a draft_update preview.
- line-draft-update.security proves six team/branch actions, confirmation binding/replay/cancellation/stale source, permission/tenant/branch/source checks, partial provisioning resume, web guard reuse, and retained evidence-review regressions.
- erp-business-tools proves permission-filtered role reads; erp-procurement-ledger-tools proves retained counterparty cards; process-line-webhook proves quote grounding plus company cards without expense entitlement.
- feature-entitlements, response-composer, and process-line-webhook capability follow-up tests prove management help appears only for reachable company preview permissions in Thai/English.
- `git diff HEAD --check`: PASS; no conflict markers in apps/packages/docs; all named tests from both conflict sides retained. No package.json, dependency, new flag, final-mutation policy, staging, commit, network, cloud or deployment changes.
Next: user can stage and finish the merge outside this sandbox; existing baseline failures remain documented, live LINE/browser acceptance was not available.

Changed file inventory (relative to HEAD; includes incoming 7B files):
- apps/ai-gateway/src/modules/line-ai/agents/accounting-summary.agent.ts
- apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.spec.ts
- apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts
- apps/ai-gateway/src/modules/line-ai/agents/line-ai-feature-coverage.ts
- apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts
- apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts
- apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.spec.ts
- apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts
- apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2.ts
- apps/api/src/modules/data-model-core/data-model-core.module.ts
- apps/api/src/modules/employee-access/employee-access.module.ts
- apps/api/src/modules/expenses/application/use-cases/line-draft-update.security.spec.ts
- apps/api/src/modules/line-ai/application/line-expense-action.service.ts
- apps/api/src/modules/line-ai/application/line-team-action.service.ts
- apps/api/src/modules/line-ai/application/use-cases/erp-business-tools.use-case.spec.ts
- apps/api/src/modules/line-ai/application/use-cases/erp-team-tools.use-case.ts
- apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts
- apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts
- apps/api/src/modules/line-ai/domain/logic/line-ai-capability-follow-up.logic.ts
- apps/api/src/modules/line-ai/domain/logic/line-expense-action-card.logic.ts
- apps/api/src/modules/line-ai/domain/ports/erp-read-tool.port.ts
- apps/api/src/modules/line-ai/line-ai-capability-manifest.spec.ts
- apps/api/src/modules/line-ai/line-ai-capability-manifest.ts
- apps/api/src/modules/line-ai/line-ai.module.ts
- apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.ts
- docs/agent-memory/mangmee-advisor-r7b-team-branches.md
- docs/plans/mangmee-advisor-full-capability-plan-th.md
- docs/research/mangmee-ai-capability-manifest-2026-09-27.json
- packages/contracts/src/ai-tools.ts
- packages/contracts/src/feature-entitlements.spec.ts
- packages/contracts/src/line-ai.ts
- docs/agent-memory/mangmee-merge-round-7b.md
- last-message.md
