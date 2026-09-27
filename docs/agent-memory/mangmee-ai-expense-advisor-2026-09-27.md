# Agent Memory: Mangmee AI expense advisor (takeover of the stopped Codex filter-context work)

Status: PLANNING — research fan-out running; spec + plan next; no code changed yet.
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
Artifacts: (to come) spec, plan, eval corpus, evidence.
Verification: (to come)
Next: collect research → write spec + plan → fix defects 1–8 → build eval corpus + runner → baseline → iterate → merge.
