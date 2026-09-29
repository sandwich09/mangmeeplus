# Agent Memory: LINE AI assumed-year note

Status: Implemented on `claude/line-ai-assumed-year-note-20260929`; PR to develop open, not merged, not deployed.
Owner: Claude (coordinator-delegated), 2026-09-29.
Scope: Say when a bare month/quarter/range fell back to last year (`year_assumed_latest_past`). Spec: `docs/specs/line-ai-period-resolution-spec-th.md` §4.4. Resolver rule unchanged.
Decisions:
- Note only when the flag is set AND the resolved year is before the as-of year; upcoming line only for a month or quarter whose occurrence this year starts after the as-of day. Owner wording: `(ไม่ได้ระบุปี จึงดูตุลาคมที่ผ่านมาล่าสุด)` / `ตุลาคมปีนี้ยังไม่ถึงค่ะ`.
- "Today" is the tool as-of in Bangkok, never the process clock (formatter stays deterministic).
- Carried as `PreparedFormatContext.periodNote` from the selected candidate: prepared lane, `deterministicExpenseSummaryReply`, semantic-turn `deterministicReadFallback`; composed answers get the same period line appended after grounding, unless the model already said it. No prompt change.
- Ranges get the assumption note (generic wording) but no upcoming line.
Open questions: none blocking. Not covered: classic-path composer facts, multi-month classic reply (`expenseMonthReply`), two-period comparison text.
Artifacts: `prepared-simple-read-formatter.ts`, `orchestrator.agent.ts`, `semantic-turn-v2.ts` + their specs.
Verification: gateway typecheck; `pnpm --filter @watchdog-bms/ai-gateway test` 1503/1503; whole-chain acceptance pass; W00 manifest spec 4/4 (no hashed file changed); real-model smoke Sonnet 4.6 through the AgentCore runtime env, 3/3 consecutive correct + 2 negatives, about 3.4 THB.
Next: review and merge the develop PR; ride the next runbook release; confirm on LINE after deploy.
