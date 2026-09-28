# Agent Memory: Mangmee AI expense advisor (takeover of the stopped Codex filter-context work)

Status: TUNING — P1–P4 and fix batches 1–4 merged on this branch (tip 221575c4, 2026-09-28). Real-model tuning run 4 = 83.4% (186/223). Batch 5 in progress (grounding tokenizer, persona/format, router trim + fast-lane coverage, deterministic replies, scorer fairness). Not yet pushed; nothing merged to develop/main.
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
Next: merge batch 5 (5a grounding/persona/comparison, 5b router trim + fast-lane gate, 5c deterministic replies + API branch resolution, 5d scorer) → tuning run 5 → further batches until the A1–A8 bars hold → held-out run (71 turns, same scorer) → docs (spec/plan results, known limits, AgentCore env note, deploy notes) → push, PR develop + main twin, admin-merge → stop pilot services → resume the purchase-without-setup program (owner directive 2026-09-28).
