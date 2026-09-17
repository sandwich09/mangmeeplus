# Agent Memory: LINE expense summary entry parity

Status: Local implementation and verification complete for the owner's 2026-09-17 request. Both broad expense-summary paths now share total, count, effective period and source formatting. No commit, push, deploy or live LINE acceptance.
Owner: thawatchai + Codex
Scope: Investigate the reported difference, then implement the owner's requested consistent expense-summary presentation.

Implementation decision (owner follow-up):
- Unify broad summaries using the existing prepared expense formatter; pass source/as-of metadata from the full orchestrator. No new query route, schema, dependency or package edit.
- The historical amount-only contract is superseded by the amendment in `docs/specs/line-ai-owner-summary-count-spec.md`; implementation steps are recorded in its existing plan.
- The AGENTS ponytail path is stale on this machine. Read the available equivalent `.agents/skills/ponytail/SKILL.md` and apply full mode.
- Paired live screenshots are not required for the now-explicit presentation change; they remain necessary only to establish the earlier live incident's exact cause.

Decisions:
- Inspected local source at `61c7cc37ea8f42ddb2c240fbed52a493976df3df`. Existing unrelated working-tree changes were preserved. No cloud, deployed OA configuration, customer messages, or live provider inspected.
- Both committed rich-menu manifests send a LINE message action with text `ดูค่าใช้จ่ายเดือนนี้`. `QUERY_ACTIONS` in `line-staff-menu.logic.ts` uses exactly the same message text for the `ค่าใช้จ่ายเดือนนี้` Quick Reply in both completion and query menus. These definitions do not establish what the user means by “callback”; the registered postback action map contains no expense-summary action.
- This expense text is not a deterministic `staffMenuCommand`. It follows ordinary business-question processing, including conversation/clarification context and intake planning; the buffer does not give it the menu-command exemption from text merging. These are possible sources of request differences, not established incident causes.
- Before this fix, local code had a confirmed response-format inconsistency: the prepared formatter returned total, count, period, source and as-of, whereas the full composer returned only the canonical total. Prepared execution still requires its feature flag, family allowlist and eligibility checks; no live activation or routing was verified.
- `ExpenseListRecentTool` defaults to the current Bangkok month through today unless explicit dates are supplied. It includes pending/draft and confirmed expenses, excluding REJECTED/VOIDED. For identical data, actor/company/branch scope, period and tool input, different formatting does not justify different totals.
- Do not attribute the reported incident to the formatter, AI randomness, company changes or the earlier budget/NOGROUP incidents without paired request evidence.

Open questions:
- No blocking product/implementation question remains. Which exact button/replies were involved in the original live incident remains unverified; the presentation change does not establish that incident's root cause.

Artifacts:
- `scripts/line-oa/rich-menu-v2-ver2.manifest.json`
- `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/api/src/modules/line-ai/application/line-message-buffer.service.ts`
- `apps/api/src/modules/line-ai/application/use-cases/erp-tools.use-case.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/prepared-simple-read-formatter.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts`
- `docs/specs/line-rich-menu-v2-spec.md` §6.5 and `docs/specs/line-ai-owner-summary-count-spec.md`

Verification:
- PASS (exit 0): `node --import tsx --test --test-reporter=dot apps/ai-gateway/src/modules/line-ai/agents/prepared-simple-read-formatter.spec.ts apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.spec.ts apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts scripts/line-oa/rich-menu-v2-ver2.manifest.spec.mjs`
- Tests are local fixtures and do not reproduce the user's live incident.

Implementation evidence:
- `formatExpenseSummary` reuses the existing deterministic prepared formatting in both paths; the orchestrator forwards already-grounded source/as-of metadata. No extra model or ERP call for composition.
- Both paths use the tool's effective period, including one-sided date requests. The canonical count is validated as a nonnegative safe integer; missing/invalid counts are explicit. Non-finite/invalid money and incomplete summaries are not presented as verified totals. Existing explicit count/detail/subset and mixed-tool behaviors remain.
- Updated the existing spec and plan with the owner's superseding decision; historical amount-only requirements are retained as history.
- PASS: from `apps/ai-gateway`, `node --import tsx --test --test-reporter=spec src/modules/line-ai/agents/prepared-simple-read-formatter.spec.ts src/modules/line-ai/agents/response-composer.agent.spec.ts src/modules/line-ai/agents/orchestrator.agent.spec.ts src/modules/line-ai/agents/prepared-simple-read-security.spec.ts` — **218 tests passed, 0 failed, 0 skipped**. Output: `/tmp/line-expense-summary-tests.log`.
- Integration fixture executes the same menu message through the full and prepared orchestrators and compares exact reply text, answer cards, source refs and web links. Prepared execution makes exactly one ERP call and zero provider calls; this prevents a fallback from falsely satisfying parity. Other cases cover Thai/English, zero, missing count, invalid money, incomplete aggregates, source periods, detail/count safeguards and permission/feature failures.
- PASS: `pnpm --filter @watchdog-bms/ai-gateway exec tsc --noEmit`; output `/tmp/line-expense-summary-types.log` is empty, exit 0.
- Initial test invocation from the repository root could not load orchestrator decorators because it missed the app tsconfig; reran from the gateway directory. Initial typecheck caught fixture literal/array types and amount narrowing, all corrected before the passing runs above.
- Scoped whitespace checks passed. No browser/native LINE test: this changes server-generated reply content; actual answer-card payload parity is checked in the integration fixture. No live/cloud access or provider call was used.

Next:
- Ready for the user's normal review/release workflow. Any subsequent live investigation or deployment must follow the mandatory runbooks; local tests do not constitute live acceptance.
