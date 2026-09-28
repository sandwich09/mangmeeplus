# Agent Memory: Mangmee AI expense advisor (takeover of the stopped Codex filter-context work)

Status: DONE (tuning) — batches 1–9 merged on the branch; final evaluated commit 47f46dfb (includes the harness merge). Final tuning run 10: 97.3% (217/223). Final held-out run 3: 91.5% (65/71). Bars missed: full-path p95 16.5 s tuning / 15.2 s held-out (bar 15.0); held-out A3 82.1% (bar 90); held-out A6 1 (bar 0). Controller decided to merge with the gaps in spec §13; the owner was told 2026-09-28. Remaining: PRs, merge, stop eval services, resume purchase-without-setup.
Owner: thawatchai (solo admin). Controller: Claude (main thread) — briefs, reviews bug/gap/impact, delegates implementation to lower-model subagents; push/PR/merge/owner comms stay in the main thread.
Scope: LINE AI "น้องมั่งมี" as an expense advisor inside the customer's enabled package. Today the sold tiers are STARTER/BASIC/PRO (same preset: expenses + reimbursements) and ENTERPRISE (+ WHT PND53 / 50 bis). Sales documents and reports are not sold and stay out of scope.
Base: branch `claude/mangmee-ai-advisor-20260927` from d78114f5 (the Codex branch `codex/line-ai-filter-context-20260927`, 5 commits on develop abdf93b9, never pushed). Worktree `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-ai-advisor-20260927`.

Decisions (owner, 2026-09-27):
- "ให้คุณทำต่อ" — Claude takes over the AI work from the Codex handoff.
- "แก้เสร็จแล้วค่อย merge เข้า main+develop" — merge only after the fixes are done and results are satisfactory.
- Product-help 12 cards may go live on AI-only source review ("ได้").
- Pilot runtime (Postgres :15439, Redis :16389, Gateway :19195) stays up while used; stop it when done.
- Goal (verbatim intent): "อยากให้ ai มั่งมีเป็น ai advisor ที่ฉลาด ตอบเร็ว ตอบถูกแม่นยำ เข้าใจ context บริบทของผู้ใช้งาน เหมือน ChatGPT/Claude … ทำงานบนขอบเขตของ package ที่เปิดใช้อยู่ ตอนนี้เน้นที่รายจ่าย". Write spec + plan, implement, test with messages covering every angle a user might ask, then merge main+develop when satisfactory.

Known defects at takeover (verified 2026-09-27 review, see persistent memory `ai-filter-context-handoff-review-2026-09-27`):
1. Status phrase after "เฉพาะ" misread as a branch name (gateway `expenseBranchScopeRequested` + API mirror) → fast lane bails out.
2. API narrows the grant to 2 slots before the gateway validates the plan → any fast-lane bail-out is a dead end (PREPARED_READ_UNAVAILABLE).
3. System-side give-ups recorded as `needs_user` questions → phantom waiting tasks.
4. Compact router prompt lost the `taskRef` object shape; retry never names the defect.
5. Fast-lane formatter ignores applied filters (confirmed-only answer would claim draft 0.00).
6. Failure copy wrong for reads; real error codes hidden in logs.
7. Two new gateway specs not registered in CI.
8. d78114f5 fragilities: earlier-message periods accepted without clarification; status reset prompt-only; period anchored to reply save time; legacy prompt leak.

Open questions: none blocking.
Artifacts:
- Spec `docs/specs/mangmee-ai-expense-advisor-spec-th.md`, plan `docs/plans/mangmee-ai-expense-advisor-plan-th.md`.
- Branches: main `claude/mangmee-ai-advisor-20260927`; tools `-tools` (merged); eval harness `-eval` (seed, corpus 223-turn tuning, oracle, scorer, runners, production AI profile); compose fixes `-compose` (in progress). Run worktree `mangmeeplus-ai-advisor-evalrun` (detached; builds + runs the eval gateway on :19205, API :19291, DB `watchdog_ai_reliability_replay_expense_advisor`, Redis db 13).
- Held-out corpus (71 turns) kept OUTSIDE the repo until the final measurement.
Verification:
- Tuning runs (223 turns, Bedrock global Sonnet 4.6, production AI env; ≈1 THB/turn):
  - run 1 39.0% · run 2 55.6% · run 3 65.5% raw / 76.2% after scorer+corpus corrections · run 4 83.4% (source 221575c4).
  - Run 4 weak rows: 13 daily closing 1/6, 14 why-questions 3/9, 6 names 9/15, 18 permission 5/9.
  - Run 4 latency: fast lane p50 6.4 s / p95 8.6 s (bar 6/8); full path p50 13.3 s / p95 21.4 s (bar p95 15); none over 30 s; 2 router provider timeouts at 16 s.
- Runs 6–10 (2026-09-28):
  - Pass rates: run 6 96.9%; run 7 94.6% (planner-skip period-alias bug, fixed 1751ce80); run 8 96.9%; run 9 97.3% (before batch 9); run 10 97.3% on the final commit 47f46dfb.
  - Run 10 bars: A2 98.2%; A3 95.7%; A4 0; A5 40/40; A6 0; A8 0/0; fast lane p50 5.4 s / p95 6.8 s (157); full path p95 16.5 s / max 20.0 s (66). Cost min 0.39 / avg 0.65 / max 2.26 THB (fast 0.51, full 0.99).
  - Run 10 failures: T-011-a t2 (partial name "สมใจ"), T-012-b t2 (ordinal read as oldest), T-016-b t2 (abbreviation "ปั๊ม ปตท."), T-097-b t0, T-108-a t0 (why grouped by vendor), T-111-b t0 (no competitor amounts).
- Held-out (71 turns): run 1 aborted (Docker stop); run 2 90.1% (before batch 9); run 3 91.5% on 47f46dfb.
  - Run 3 bars: A2 95.8%; A3 82.1% (23/28); A4 0; A5 12/12; A6 1; A8 0/0; fast p50 5.6 s / p95 7.9 s (54); full p95 15.2 s (17). Cost min 0.40 / avg 0.60 / max 1.18 THB.
  - Run 3 failures: period-compare-correction t3 (stale "confirmed" filter on a self-contained list request); vendor-breakdown-ordinal t1–t3 ("5 อันดับแรก" after a vendor breakdown read as a vendor ranking, then "อันแรก" dead-ends); payment-status-chain t3 ("จ่ายไปทั้งหมด" read as PAID only); outofpackage-procurement t0 (how-to routed as a help question, no package mention).
  - Run 9 bars (superseded by run 10):
    - A2 98.7%; A3 95.7%; A4 0; A5 40/40; A6 0; A8 0 machine tokens.
    - A7 fast lane p50 5.4 s / p95 6.3 s; full path p95 15.2 s / max 19.1 s.
  - Cost per turn min 0.39 / avg 0.63 / max 2.22 THB. The max is a cold router prompt-cache write (~15k tokens).
- Incident 2026-09-28 09:09Z: every Docker container on the machine, including the eval DB/Redis, was stopped by an unknown actor mid held-out run. The controller restarted only the two eval containers and told the owner.
- Run 5 (candidate ca06479f + scorer 179c5a3b, 2026-09-28):
  - Totals: 95.1% (212/223); machine tokens 0; male particles 0.
  - A2 tool+filter 98.2%; A3 follow-ups 90.0%; A4 refusals 0; A5 scope 40/40.
  - A6: 6 dead ends.
  - A7: fast lane (one router call) p50 5.3 s / p95 6.2 s; full path p50 13.8 s / p95 22.4 s; max 29.5 s.
  - Cost 173 THB.
- Run 5 root causes:
  - (a) The batch-5 persona line "Reply in plain LINE text only" made compose answer in plain text instead of JSON: 24/77 calls, which caused retries and dead ends, including for "ขอบคุณ".
  - (b) Minified router JSON gained brace errors (6/8) and unescaped inner quotes (2/8), which caused two router attempts and then a dead end.
  - (c) The approval queue orders by createdAt only, so seeded ties flip "ใบแรก/ใบที่สอง" between the oracle and the run.
  - (d) The why-planner sometimes planned only list_recent, or only the filtered breakdown.
  - (e) A read correction "ไม่ใช่ X ต่างหาก" was routed as an expense-capture correction.
- Run 4 root causes found by the controller (2026-09-28):
  - (a) The number-grounding tokenizer read ISO dates as negative numbers, which rejected 76/89 composed answers (offline replay; 21 with a date-aware tokenizer). Most full-path answers were really the deterministic fallback.
  - (b) Raw fact lines (expense_total … | exclude_rejected_voided) were appended to customer answers.
  - (c) Compose used Markdown tables/bold, English status glosses and wrong BE years.
  - (d) Fast-lane gate: 39 breakdown proposals were rejected on answerShape, ~26 simple reads were rejected at confidence 0.78–0.82, and agent/subject mismatches rejected more.
  - (e) "ขนาดนี้" triggered the file-attempt reply; "เช็คใบเบิกที่รออนุมัติ" triggered the approval boundary.
  - (f) The daily-closing formatter omitted pending review / outstanding / submitted counts.
  - (g) Comparisons ignored groupBy vendor and duplicated per subrequest.
  - (h) Branch "2" was not resolved to "สาขา 2".
- Real-model baseline on P1+tools with production AI settings (sample corpus, 20 turns): 9/20. Fast lane correct every time (6.2–6.9 s). Failure clusters: C1 full-path answers rejected by numeric grounding (7), C2 control round unavailable after a filtered follow-up, C3 ordinal references (needs P3 memory), C4 out-of-package request → schema invalid. Full-path latency 11–24 s.
- Harness facts: the eval must mirror production's AI env (fast lane, coverage critic, tool-use loop were off by default); seeded users need legal-acceptance records; the eval API must approve the global Sonnet profile.
Next (2026-09-28):
- PR develop, then a main twin: apply `git diff origin/develop..tip` on a main-based branch. Recheck that every touched file is identical on main and develop first.
- Admin-merge both.
- Then merge the telemetry PRs #834/#835: regenerate the W00 manifest after the program lands, because both touch it.
- Stop the eval gateway :19205 and the pilot containers (postgres :15439, redis :16389).
- Resume the purchase-without-setup program per the owner directive of 2026-09-28.
- Deploy notes:
  - AgentCore families are now ten (agentcore-deploy.sh default + h15 spec).
  - No new env or flags.
- Known limits are listed in spec §13.
