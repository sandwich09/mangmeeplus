# Agent Memory: advisor R1 slice S1 — substitute receipts I must sign, and my pending work

Status: implemented, verified, and passed the real-model eval on `claude/advisor-r1-s1-signatures-20260930` (worktree `/private/tmp/mangmee-advisor-s1-20260930`). The owner gave the go on 2026-09-30 ~18:20 ("เริ่มทดสอบบนเครื่องได้เลย"). Runs 6 and 7 passed 23/23 on 0f18c001. Seven runs cost 179.39 THB against a 250 THB cap. Not pushed; the controller integrates.
Owner: Thawatchai (controller merges; this lane does not push).
Scope: plan S1 — read tool `expense.list_substitute_receipts_to_sign` (spec §5.2); Q2 "มีอะไรค้างที่ฉันต้องทำ" reads the caller's own queues; Q1 "วันนี้มีอะไรต้องทำ" stays on the daily-closing fast lane (spec §4.2, owner 2026-09-30).
Decisions:
- Gates mirror the web:
  - Payer half: the certify route's permissions (`expense.read_related` or `expense.read_own`).
  - Approver half: `expense.confirm` + policy mode and designation + eligible approver (an ACTIVE role with confirm) + branch scope + self-approval by the caller's REAL roles + the original approver for a correction. The correction rule covers payer-certified rows only; paper acceptance has no such rule.
  - A submitted paper copy waiting to be accepted counts on the approver side. An unsent paper form counts nowhere.
- One-person shops: the new adapter builds its own RequestContext with `ctx.roles` (the shared `toCtx` sends `roles: []`). OWNER_SELF + OWNER/ADMIN/MANAGER therefore keeps self-paid receipts and same-person paper copies.
- Counted in the database (`count` + bounded `findMany`). The approver step also returns `byStep` (รอคุณอนุมัติ / ฉบับกระดาษรอคุณตรวจรับ), so a reply that groups items by step states grounded counts. No payee tax id or address, signature or file is selected.
- Q1 vs Q2:
  - The router rule and the daily-closing registry text name the Thai Q1 wording and keep it to the closing alone.
  - Only a message that says the work is left pending (ค้าง) is Q2. The compact decision never fast-lanes Q2 (`my_pending_work_question`).
  - semantic-turn-v2 adds each offered queue (`MY_PENDING_WORK_TOOLS`) once per request.
  - A non-approver's planned approval read becomes their own claims summary.
  - The daily closing accepts today's date when the message names no day (its own default).
  - The deterministic family list is unchanged.
- Q2 answers: at most three short lines per subrequest, each at its own index, never a field name. The composed-text sanitiser drops a parenthesized camelCase field gloss.
- Follow-ups: the queue is in read memory (`READ_MEMORY_TOOLS`) as a bare entry with no status basis, filter or item ids, so "ใบที่ยอดสูงกว่า…" re-reads the same queue.
- #926 interplay: a queue question that says "ใบรับรองแทน…" is never an explicit substitute start (`isSubstituteQueueQuestion` guards `explicitStart`). The router is told a queue question is a read and a sign/approve request is web-only work.
- Signing or approving over LINE:
  - Scope rule 2 covers substitute receipts: noun + sign/approve verb; a bare sign verb when no claim or expense is named; a verb-first imperative for these rules only.
  - The reply gives the reason and links `/expenses/substitute-receipts` on the sole-item path.
- Page names: `expenses/substitute-receipts` → "หน้าใบรับรองแทนใบเสร็จบนเว็บ", `expenses/signatures` → "หน้าลายเซ็นของฉันบนเว็บ".
Open questions:
- Spec §4.2 says Q2 shows one clickable link. The card path appends every distinct source link as a button, so Q2 can show up to three (daily closing, substitute receipts, claims). Left for the owner/controller to decide.
- Q2's substitute-receipt part sometimes still lists the documents despite the short-answer rule. Every figure is still grounded.
- The web hub's own counts are computed client-side from the first 200 rows and ignore designation, branch and the correction rule, so the chat count can differ from the hub strip (plan S1 note).
- Not S1: two gateway specs fail on the first day of every month:
  - `orchestrator.agent.spec.ts` "shows a complete broad expense summary…"
  - `line-ai-turn.use-case.spec.ts` "deterministic path keeps the safe current-month expense summary…"
  - Cause: the month-to-date range prints a single day, but the specs expect a range.
  - Effect: whole-chain `gateway-behavior` fails on those days.
Artifacts:
- Eval report: `docs/research/mangmee-advisor-eval-s1-2026-09-30-th.md`, with per-case evidence in `.json`.
- Harness: the controller scratchpad (`advs1-*`: cases, run, score, launch, eval driver, spend, evidence).
- Corpus: 23 cases / 25 turns over worlds A-STAFF, A-OWNER, B-OWNER, B-MANAGER, B-ACCOUNTANT, B-AUDITOR, C-OWNER.
Verification:
- Typecheck: API clean; gateway tsc build clean; contracts built.
- Specs:
  - Focused API specs 103/0. The PG spec on real Postgres 7/0, including `byStep`.
  - Gateway `pnpm test` 1510/1512. The two failures are the day-1 specs above; the same code passed 1512/1512 on 2026-09-30.
  - Focused gateway specs 108/0.
- Whole-chain acceptance on 0f18c001:
  - Every suite up to `gateway-behavior` passed.
  - `gateway-behavior` failed only on the two day-1 specs.
  - The four infra suites after it pass when run directly.
  - An earlier `reliability-gateway-v2` "fetch failed" did not recur.
- W00 manifest regenerated. The reliability corpus artifact is unchanged.
- Real-model eval (strict re-score, THB):

  | Run | Commit | Passed | THB |
  |---|---|---|---|
  | run1 | d7bb58b1 | 19/22 | 31.14 |
  | run2 | 90bc876c | 20/23 | 31.51 |
  | run3 | 8a936f55 | 23/23 | 24.40 |
  | run4 | c4a2d6ab | 22/23 | 25.00 |
  | run5 | 9e5e11a7 | 22/23 | 23.80 |
  | run6 | 0f18c001 | 23/23 | 22.06 |
  | run7 | 0f18c001 | 23/23 | 21.48 |

Next: controller review and integration; owner decision on Q2's link count.
