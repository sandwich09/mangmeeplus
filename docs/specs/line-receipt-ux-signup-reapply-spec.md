# LINE receipt summaries and rejected-signup reapplication

Status: APPROVED FOR IMPLEMENTATION — owner 2026-09-08 Bangkok.

Supersedes the automatic receipt-questioning UX in `line-ai-expense-draft-conversation-spec.md` and `receipt-reliability-and-draft-continuity-spec.md`. Their durable capture, provenance, permissions, concurrency and financial-finalization boundaries remain mandatory. Related: `line-signup-recovery-and-resolution-spec-th.md` and the existing support request specifications.

## Owner decisions

1. Sending a receipt saves a draft and gives a concise branded result. **Do not invite the sender to fill missing facts in chat, ask unsolicited questions, or start an active collection conversation.** The neutral web action is the ordinary path to inspect/edit the saved record.
2. A user may initiate a correction or supply missing facts in ordinary language. Then the assistant can continue that requested work. If questions are necessary, group all missing facts needed for that requested work together; never drip-feed questions or require internal codes. Unrelated chat must not become an answer to a question the assistant never asked.
3. A previously rejected application does not permanently ban the applicant. They may submit a new application, which must enter manual review. Preserve the old decision and evidence for administrators; do not reopen or auto-approve the old application.
4. Fix both journeys and surrounding bugs; pause UAT during implementation, restore it only when the candidate is ready, then deploy UAT. **Production remains on HOLD.** Mail provider activation and paid subscriptions remain out of scope.

## Evidence and causes

Baseline: previous live/UAT source `604ac785479ced5b9858d0b46d89f8d11cf2b9f6`; faulty UAT candidate `42ddc2dce45f094acceab885e299e8d3caeed3ac`, deployed by UAT run `34144694046`.

### Receipt regression

Removed 2026-10-05: the card reply is always on; there is no switch.

- Actual UAT API readback: `LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED=true`; `LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED=true`; `LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED` absent. The latter defaults false in `packages/config/src/index.ts:305` and has no deploy/workflow wiring.
- `process-line-webhook.use-case.ts:5586` calls `startFromReceipt` and replaces the old `formatPaypersReply` result. `deliverCompletedReplies` at line 2506 emits plain text while the presentation flag is false. The shared Flex theme itself did not change between the two sources.
- `formatLineExpenseDraftReply` directly exposes `expenseId`, `accountHintKey`, item references and question IDs (`line-expense-draft-conversation.logic.ts:657,676,693`). Much of that formatter dates to commit `3cb52ce44` (2026-08-19); enabling the dormant path exposed it now. This is deterministic application output, not model hallucination.
- The old summary includes document total, duplicate and currency warnings, stored charges and date evidence. The active conversation formatter lacks those document facts and instead repeats every item plus accounting suggestions. The sample's 300.00 total is absent while item amounts before discount/tax appear. This proves a display gap, not that the stored financial total is wrong.
- `expense-source-draft.logic.ts:37` reads flat `chargeReconciliationStatus`, while LINE and web writers persist `chargeReconciliation.status`. The fixture with quantity `0.63`, amount `243.75`, derived unit price `386.9048` reproduces unnecessary `I01-REVIEW` and `I01-CATEGORY`: exact multiplication fails and the reconciliation bypass is missed. The correctly shaped fixture binds the original line and leaves only the missing purpose. The actual tenant expense could not be read through the system-admin browser because it lacks membership; no access bypass was attempted.
- Simply enabling the Flex flag is insufficient. A short dedicated expense card renders only four fact rows and discards visible collection questions; a long terminal still emits the entire text. The local 738-character fixture loses all questions from the visible card while only 400 characters survive in altText. This matters for user-initiated collection too.
- Existing domain suites pass 20/20, yet some assertions explicitly require question IDs in customer text. They verify old output requirements, not the owner's UX. Web source-draft UI already hides question IDs; LINE must follow the same user-facing boundary.

### Signup regression and support gap

- `GET /public/line-signups/me` selects the latest request, including terminal states, and separately returns eligible companies (`get-line-signup-status.use-case.ts:46`).
- `renderSignupStatus` hides all actions, then REJECTED/SUSPENDED/EXPIRED only shows support and returns (`liff-page.security.ts:589,736`). It does not show existing companies or the add-shop action there. The previous source showed the form whenever no open application existed.
- Read-only UAT admin queue contains a rejected LINE request named `ร้านใหม่`, display name `sandwich ;)`, dated 2026-09-06 15:45 Bangkok. This matches the screenshot's display name and supports the stale-request diagnosis; no token-bound request ID was collected from the user's device.
- Executing the actual renderer in a local isolated DOM with REJECTED plus an eligible existing company reproduces: form hidden, add-shop hidden, zero existing-company actions, support visible. With no request, the same company and add-shop actions appear.
- Backend open-request states exclude REJECTED, so a genuinely new request is possible. However, `decideAndRun` gates AUTO_FREE using repeat ownership and email conflict only; it has no explicit prior-rejection check. The contact-email conflict query even excludes ordinary rejected requests with no company and no failure code. A blanket rule that reapplications after rejection always require manual review is therefore not enforced yet.
- The support button calls only `liff.sendMessages`, checks method presence instead of actual availability, and catches all errors as the same network guidance (`liff-page.security.ts:907`). It does not directly persist a support case. LINE documents that this method needs the right LIFF launch context and `chat_message.write`; method existence is insufficient. Exact device failure code/scope is unproven because the current page discards it. Source: https://developers.line.biz/en/reference/liff/#send-messages.

## Receipt product and architecture contract

1. Initial photo, successful retry/redelivery and saved-image recovery use the same customer summary semantics: truthful saved state, grounded seller/date/document total, and a neutral **เปิดดูรายการ** action for the same scoped draft. Omit unknown optional facts rather than fabricate values. If the amount cannot be read, say so as a status without starting questions.
2. Keep duplicate, non-THB, material date and charge-reconciliation warnings when applicable, expressed briefly in ordinary Thai. Distinguish a printed total from a stored/reconciled total when they differ. Do not silently sum incomplete item rows into a document total.
3. No raw database ID, account mapping key, enum, question ID or long URL in visible card text or notification text. A plain-text-only fallback may retain the trusted web URL needed to open the record. Original merchant/item names remain legitimate source content. Thai category names may be shown when useful; ledger/tax suggestion details belong in the appropriate web/admin review screen.
4. Reuse the central LINE theme and delivery boundary. Essential receipt presentation must not rely on another easily missed deployment flag. Lossless delivery and terminal-outcome replay remain intact. Plain-text fallback must preserve the concise customer meaning and important warnings.
5. Saving source facts and opening an interactive conversation are separate actions. Receipt capture must not leave an active workflow that solicits answers, emits unsolicited resume capsules on unrelated messages, or consumes bare numbers as answers.
6. On an explicit user request, resolve the current scoped draft, reuse ordinary-source-fact editing and current revision checks, acknowledge only accepted changes, and ask only necessary unresolved questions for that requested work. Present all such questions together in human language. Multiple drafts need human-readable disambiguation, not raw IDs.
7. “บันทึกไว้ก่อน” saves/retains the draft without confirmation, payment, posting or repeated persuasion. Silence or moving to another topic preserves the draft without reminders. Web edits remain authoritative and stale LINE edits cannot overwrite them.
8. Fix reconciliation-reader shape centrally for LINE/web siblings. Bind by source identity and proven financial reconciliation, preserve tax/discount/charge rows, and never weaken the guard into an arbitrary rounding tolerance that could match a different item.

## Reapplication and support contract

1. Separate terminal request history from the ability to start a new request. A rejected applicant sees that the **previous** application was rejected, a clear **สมัครใหม่** action and existing eligible shops where applicable. Do not turn an existing active/pending/provisioning request into a duplicate.
2. New submission uses a fresh idempotency key only on deliberate reapplication/add-shop intent; network retry retains its original key. Recheck legal release and current identity/permissions through existing APIs. Old evidence and state remain unchanged.
3. Backend checks prior rejected applications for the same verified LINE identity/channel and forces PENDING_REVIEW, including when the applicant changes email. The UI cannot bypass it. Recheck the relevant decision under the existing transactional approval boundary. Administrators see the prior rejection and reason/history; the customer sees natural language that review is pending.
4. Account/identity suspension is distinct from a rejected request; preserve actual account restrictions. Do not label an ordinary rejection as a permanent identity ban. Do not reset trial entitlement just because a new form was submitted.
5. The support action must have a working path without relying on `liff.sendMessages` availability. Reuse the existing durable `LineSupportRequest`/admin queue and notification system with a narrow token-verified public ingress where needed. Resolve request/company association on the server; never accept a raw LINE identity or arbitrary company from the client as authority.
6. Deduplicate retries against a live case, bound abuse, preserve meaningful context, acknowledge only committed requests, and keep admin notification retryable. Customer success must not depend on the mail provider. Give an actionable offline alternative when the API really cannot accept the case; log safe error classification for support, not credentials.

## Acceptance across viewpoints

| View | Required acceptance |
| --- | --- |
| Entrepreneur / customer | One receipt → short saved result, visible document amount and neutral web action. No questionnaire. Existing rejected applicant can submit again and understands that a person will review. |
| UX / older users | Readable Thai, consistent theme, large clear actions, no internal codes, no command memorization, no repeated prompt after save-for-later, mobile screenshots reviewed. |
| BA | Receipt capture is not accounting completion. No extra trial grant; rejected history forces manual review; duplicate requests and old decisions remain intact. |
| SA | Shared state/presentation contracts, same draft identity, optimistic concurrency, tenant/member checks, durable notification and bounded public support ingress. |
| AI engineering | User initiates editing; source-grounded candidates only; unrelated text and bare numbers cannot mutate a passive draft; known facts and safety warnings survive rendering. |
| Operations / support | Admin can find history and work the actual persisted case; customer acknowledgement matches persistence; safe error evidence; exact UAT rollout and no Production promotion. |

## Release gates

- Focused logic/orchestration/rendering tests, real PostgreSQL regression for nontrivial persistence/race changes, API/web/contracts typechecks and relevant whole-chain checks.
- Verify receipt/LINE and LIFF mobile journeys with actual production-generated response shapes, including forced send failure, rejected history plus existing shop, new email on reapplication, and provider message API unavailable.
- Before UAT: required PR-head CI, merge ancestry in develop/main, no active release flow, canonical runbook, restore stable 1/2 UAT capacity and read-only preflight. One new UAT run with signed Passport, exact digests and actual UI/config readback. Do not reuse the faulty candidate's acceptance as proof of the fix.
- Production remains held until an explicit later owner instruction resumes it.

Rollout: enable existing `LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED` and `LINE_AI_FLEX_TEXT_FALLBACK_ENABLED` through the shared deploy configuration and both workflow environments, alongside draft conversation/replay. These are existing capabilities, not new feature flags. UAT only is deployed in this task. Shared cards use the existing dark brand green with white headings and 16px body text for readability.


## Amendment 2026-10-28 — free expense drafts

เปิดร้านสำเร็จแจ้งสถานะโดยไม่บังคับซื้อหรือเชิญรับสิทธิ์; eligible free ส่งเอกสารได้ทันที แจ้งครบเมื่อ third usable result และรักษา saved/result/delivery truth รายละเอียดที่มีผลเฉพาะ cohort นี้อยู่ใน [free expense drafts spec](free-expense-drafts-spec-th.md); หลักฐาน local และข้อจำกัด live อยู่ใน [task memory](../agent-memory/free-expense-drafts.md).
