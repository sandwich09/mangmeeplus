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

## Priority fix 2026-09-29: LINE expense category (before features 2 and 3)

Status: PR to develop from `claude/line-expense-category-pick-20260929` (not merged by this agent). Real model on a 12-category starter shop with the draft conversation on: text runs 12/12, 11/12 (the one miss a Bedrock timeout, no decision), 12/12 on merged develop; photos 3/3. Spend 41.27 THB.
Root cause (evidence): bound private v2 turns built the intake request with `activeCategories: []` (`tryRouteIntake` skipped the catalogue whenever a v2 budget grant existed, since reliability v2.4 on 2026-09-27). A recorded real router payload for "ทำร่างค่าส่งของวันนี้สามร้อยบาทให้หน่อย" shows `"activeCategories":[]`, and the model rightly omitted `captureHints.expenseCategoryId` ("id chosen ONLY from activeCategories"). The same empty list reached image intake, so one-pass receipts (which skip the OCR reader) never got a category either. Second gap: with the draft conversation on (UAT/Production), even a valid hint became only `suggestedCategoryId` and the draft asked the user to confirm it.
Decisions:
- Bound turns get the catalogue again (id + name). The template catch-all (`expense.miscellaneous`) is left out of every LINE AI category choice (router and receipt reader), so a vague note is left for a person to file.
- A text note's category is applied (item, line, and document when every item shares it) whenever the router names an active one, as the single-turn text path always did; a note-level category covers items that name none. First design gated on capture confidence 0.85 and failed "ซื้อปากกากับกระดาษ 150" (category right, capture 0.82 because the items were ambiguous), so the gate was dropped. Photo drafts keep the reader's 0.85 auto-fill rule.
- No switch, no new contract field. Spec notes: `line-ai-text-intake-latency-quality-spec-2026-09-27.md` §6.1 and `line-ai-expense-draft-conversation-spec.md` §13.
- The catalogue is loaded only for an actor who may create an expense draft; question-only document turns read no expense data (bridge spec invariant).
- Eval note: `scripts/line-ai-expense-advisor/production-ai-env.json` records only `LINE_AI_*` keys, so eval runs used `LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED` = false while UAT/Production run true (release records 2026-09-07/08). The category probe sets it true.

Next: feature 2 (NAT04 fixture first, then draft → edit → cancel → status), then feature 3 (NAT11), then the regression slice.
