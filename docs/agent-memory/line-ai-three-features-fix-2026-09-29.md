# Agent Memory: LINE AI three features real-model fix (2026-09-29)

Status: Feature 1 (document Q&A) done and in review; features 2 (reimbursement drafts) and 3 (remembered answer preferences) follow in their own PRs.
Owner: Claude (subagent), for the Owner decision "แก้ให้ผ่านเลย".
Scope: NAT05/NAT06 (document Q&A), NAT04 + draft/edit/cancel/status (reimbursement drafts), NAT11 (preferences) from `docs/research/mangmee-natural-real-model-results-2026-09-27-th.md`. One PR per feature to develop; nothing merged by this agent.

Decisions:
- Document Q&A claims are located by their own verbatim text; unlocatable claims are dropped, never the answer (Owner: do not repeat the strict-evidence design). No offsets are requested from the reader.
- Recovery delivers a QA answer only after the admitting turn's foreground window; the foreground waits for a read another tick claimed.
- A failed or expired read keeps its file (`RESOLVED_RECEIPT`); only a cancel expires it.
- The file a chat is about is the newest file asked about; an order word ("ไฟล์แรก") reads that file beside it.
- "ทำร่าง…จากใบนี้" is a router `write` (EXPENSE_DOCUMENT_CAPTURE); with no amount of its own and a current file, it drafts from that file through the durable capture read and the existing result push.
- No new switch or env var; the reader output is capped (3000 tokens, ≤ 8 excerpt lines, ≤ 2 facts per page).

Open questions: none blocking. Latency depends on the provider: 1 of 20 answers in the final passes missed the ~37 s foreground window and arrived through recovery.

Artifacts:
- PR 1 (develop): branch `claude/line-ai-document-qa-fix-20260929`.
- Spec note: `docs/specs/mangmee-ai-core-capability-contract-2026-09-27.md` §6 (2026-09-29 NAT05/NAT06 note).
- Results: `docs/research/mangmee-natural-real-model-results-2026-09-27-th.md` §รันทวน 2026-09-29.
- Eval harness (not committed): a local AgentCore runtime process started with the `agentcore-deploy.sh` env, the gateway pointed at it via `LINE_AI_AGENT_RUNTIME=agentcore`, and a provider trace of every raw prompt/output. Throwaway containers `aifix-pg` (:15660), `aifix-redis` (:16660), `aifix-minio` (:19660).

Verification (feature 1):
- Real model, final code: NAT05 + NAT06, 2 consecutive runs, 20/20 turns correct, no stuck event, no write from read-only questions. Spend 204.6 THB for the feature (baselines, 12 iteration runs, 2 passing runs).
- Specs: contracts `line-document-qa.spec.ts` 7/7; gateway `document-qa.integration.spec.ts` 6/6, `extract-json.spec.ts` 11/11, router specs pass; API `process-line-document-qa.bridge.spec.ts` 33/33; W00 manifest regenerated and verified.
- API/web typecheck and gateway typecheck pass. Whole-chain acceptance: see the PR body.

Next: feature 2 (NAT04 fixture first, then draft → edit → cancel → status), then feature 3 (NAT11), then the regression slice.
