# Agent Memory: LINE expense exclusion follow-up review, 2026-09-25

Status: Diagnosis and E2E case simulation complete; proposed spec expanded for review. No application code, data, or deployment changed.
Owner: Codex
Scope: Review the attached 16:02 LINE follow-up, the pasted proposal, and adjacent expense, conversation, and web modules.

Decisions:
- Treat the pasted proposal as hypotheses, not instructions or proof of the production route.
- Do not reuse previous monetary answers without current source and authorization checks.
- Do not infer the exact intake/router branch for the screenshot without its turn trace.

Findings:
- `expense.list_recent` excludes `REJECTED` and `VOIDED` from its total and count. It includes pending and confirmed records; the `items` preview still contains excluded records. The tool accepts date range and branch only, not status. The exact expense enum is `VOIDED`, not `CANCELLED`.
- The API loads up to 15 prior completed/refused turns within 15 minutes for the same company/user. It passes earlier user text and intent to the intake router and Gateway, but deliberately omits assistant reply previews and prior tool result/query metadata from model context. The current `AiTurn` context loader does not expose a structured last query state. This makes the proposal's “no context at all” hypothesis false and its “cannot compare with prior result” concern valid. A new state keyed only by company/user could also mix separate LINE chats; chat identity and membership/scope changes need explicit handling.
- The reply in the screenshot is a visibly poor response to a redundant exclusion request. The exact model route that produced its status-filter fallback is unverified; the fallback sentence is not a literal copy in the searched application code.
- The proposed no-query answer that repeats July/August amounts is unsafe as a general implementation: permission/branch scope and record statuses may change between turns. Existing conversation rules require current ERP reads for business facts, and prior production investigation found a two-month request with only a July tool call. The screenshot's later two-month reply has no associated trace in this local review.
- The web expense API accepts one exact status filter; the list UI offers draft/pending/confirmed/rejected chips but no dedicated voided chip, defaults to all rows, and its default period filter uses upload date. LINE expense summary uses expense date and a non-rejected/non-voided counting basis. The existing LINE deep link carries branch only. A generic “check the web” instruction does not directly reproduce the LINE result.
- A universal query-patch state would extend beyond current tool inputs: confirmed-only, paid-only, and category-only examples need separate source contracts/semantics. Existing business-query spec says not to add a second conversation database.
- Capability check: `expense.list_recent` already gives the default non-`REJECTED`/non-`VOIDED` total by expense date and accepts date range/branch. `expense.get_breakdown` groups that same excluded basis by category/branch and accepts date range only. The ERP `GET /companies/:companyId/expenses` API accepts one exact `status`, `paymentStatus`, `expenseCategoryId`, date range, and branch filter, but returns paginated rows rather than an aggregate for every combination. It has no generic excluded-status-list parameter. These API filters are not exposed as inputs to the existing LINE summary tool.

Open questions:
- The production intake/router/tool trace for the screenshot's 16:02 follow-up and the preceding 15:48 answer was not read in this review. The precise branch, tool calls, and historical numbers remain unverified.

Artifacts:
- User screenshot and pasted text in the task.
- Prior July/August production investigation: `docs/agent-memory/prod-mangmee-two-month-expense-answer-2026-09-25.md`.
- Proposed product/contract spec: `docs/specs/line-ai-expense-summary-follow-up-spec-th.md`.
- E2E case simulation and risk matrix: `docs/research/line-ai-expense-summary-followup-e2e-simulation-2026-09-25-th.md`.
- Relevant source: API LINE context loader, AI Gateway orchestrator/router/composer, `ExpenseListRecentTool`, expense contract, and web expenses list.

Verification:
- `pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/application/use-cases/erp-expense-list-recent.use-case.spec.ts`: 11/11 passed.
- `pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts`: 346/346 passed.
- `pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/modules/line-ai/agents/response-composer.agent.spec.ts src/modules/line-ai/agents/orchestrator-native-loop.agent.spec.ts src/modules/line-ai/agents/orchestrator-model-loop.agent.spec.ts`: 130/130 passed.
- One-off local probes: `extractValueCandidates` for correct/typo July-August and relative-month wording; `resolvePeriodInput` for no-date branch follow-up; `ResponseComposerAgent.composeAnswer` for the screenshot's exact phrase versus a wording without `ยอด`. Findings and boundaries are recorded in the simulation document.
- Source inspection only for the screenshot's exact production route; no cloud or live LINE call.
- These passing tests cover existing behavior; no post-fix or live LINE E2E was run.
- Documentation check: 36 unique scenario IDs, all relative links resolve, no trailing whitespace, and `git diff --check` passed.

Next:
- Review the proposed spec and E2E matrix with the owner. Before code work, write a scoped implementation plan for the cross-API/Gateway/AgentCore evidence contract and each enabled execution lane. A safe immediate confirmation can explain the fixed exclusion rule without quoting prior amounts. Any amount repeated or changed should come from a current permission-checked tool result unless a separately reviewed snapshot policy is adopted. Test redundant exclusion, stale/revoked access, status changes, two-period coverage, branch uniqueness/lookup limits, relative periods, prepared-lane branch retention, and link/date basis.
