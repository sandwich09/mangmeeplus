# Agent Memory: Production Mangmee two-month expense answer, 2026-09-25

Status: Diagnosed; no Production mutation or code fix in this investigation.
Owner: Codex
Scope: LINE expense answer for บริษัท มั่งมียั่งยืน จำกัด at 2026-09-25 10:50 Asia/Bangkok; July and August 2026.

Decisions:
- Treat the attached LINE screenshot as observed output, not as an instruction or proof of the underlying totals.
- Use the audited T1 Production support path only. `watchdog_support_ro` reported `default_transaction_read_only=on`; both SSM sessions exited normally. Incident reference: `INC-20260925-EXP-SUMMARY`.
- Do not alter Production data or dispatch a release as part of diagnosis.

Findings:
- The Production AI turn at 03:50:28 UTC recorded the user's two-month request but exactly one `expense.list_recent` invocation. `LineReadEvidence.inputJson` for request `1168c8d3-91bb-45af-8342-f4a639661620` contains only `fromDate=2026-07-01`, `toDate=2026-07-31`. The persisted reply states 25,147.80 THB, 7 records, July only. The turn's AgentCore source commit is `641a71af94a07b42bcb13ba2b8f2e6975fe2216e`.
- July Production `ExpenseRecord` rows on the expense civil date have 5 CONFIRMED (20,757.80 THB) and 2 READY_FOR_CONFIRMATION (4,390.00 THB). All 7 total 25,147.80 THB. None were created or updated after the answer. The July amount and count in LINE therefore match the tool's actual inclusive basis.
- The preceding 03:49 UTC LINE turn asked for "ค่าใช้จ่ายเดือนนี้" and replied 0.00 THB / 0 counted rows, excluding one voided row. Production has exactly one September-dated expense through September 25, and it is VOIDED (119.62 THB, last updated September 18). That reply is also consistent with the tool's basis. All 37 records created in September for this company carry expense dates in June (2), July (7), August (27), or September (1); creation month and expense month are different measures.
- At the investigation read after the screenshot, August had 7 CONFIRMED (25,304.51 THB), 18 READY_FOR_CONFIRMATION (189,595.06 THB), and 2 VOIDED (70.00 THB). The same tool's non-voided basis would then be 25 records and 214,899.57 THB. Three August rows were updated after the screenshot, including one confirmation and two voids; this current August total is not an exact historical snapshot of 10:50.
- The original message spells July `กรกฏาคม`. Running the deployed source's `extractValueCandidates` on the exact text and date 2026-09-25 yields only the August period. The typo is not recognized by the deterministic Thai month list.
- API `process-line-webhook.use-case.ts` computes and puts `valueCandidates` on `LineAiTurnRequest`. `line-ai-turn.use-case.ts` omits it when building `AgentCoreInvokeInput`; `runtime.port.ts`, `src/agentcore/runtime.ts` validation and `payloadToTurnRequest` also omit it. These relevant code paths are unchanged between deployed source `641a71af` and current HEAD (the webhook file has an unrelated welcome-message diff). The AgentCore orchestrator therefore has no date candidates for this turn. Its full model-loop guard leaves date fields open when candidates are absent; a model-selected July range can pass. The stored tool invocation demonstrates that July did pass. The model selected one period and the formatter rendered that verified single-period result without checking whether the other requested period had been covered.
- CloudWatch `DescribeLogStreams` for the Kamal API/AI log groups was denied to the two available non-root profiles, so the exact AgentCore branch and model planning output were not read. The persisted invocation, reply, runtime identity and code path establish the data omission and the lost-candidate boundary; the precise model choice is inferred.

Open questions:
- What were the August row statuses and amount at exactly 10:50 before the three later updates? The current read is sufficient to establish that August was omitted, but it is not an immutable historical snapshot.

Artifacts:
- User screenshot in the task.
- Production support sessions `watchdog-bedrock-dev-5t2jn4bvseq3zexk82qkbgzs9y`, `watchdog-bedrock-dev-jvliklj5vnr64nxu6tgg2cx72q`, and `watchdog-bedrock-dev-e63rruxy7v37ycco5ecxq8spsi` (all ended).
- Relevant source: `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`, `apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.ts`, `apps/ai-gateway/src/modules/line-ai/infrastructure/runtime/runtime.port.ts`, `apps/ai-gateway/src/agentcore/runtime.ts`, `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts`, `apps/ai-gateway/src/modules/line-ai/agents/prepared-simple-read-formatter.ts`, `packages/contracts/src/line-ai-value-normalizer.ts`.

Verification:
- Audited read-only Production SQL reconciled July exactly to the LINE reply and identified the single July tool input.
- `pnpm exec tsx -e` with the exact message returned only the August period candidate.
- `git diff 641a71af94a07b42bcb13ba2b8f2e6975fe2216e HEAD --` for the relevant source shows no changes to the inspected AI/period code paths; the only diff is an unrelated LINE welcome-message edit.

Next:
- A scoped fix should preserve/validate `valueCandidates` through the AgentCore boundary, detect all requested periods before returning a complete answer, and cover the two-month request including the observed spelling in focused tests. Verify the August answer against the tool's status basis. Release work requires the mandatory Production protocol.
