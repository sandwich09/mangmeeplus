# Agent Memory: MVP1 A3–A5 + push + `/expenses` — CRM Revenue Loop + Durable Flow

Status: **SUPERSEDED IN PART 2026-07-09 — a parallel session (Opus 4.8) completed the whole Dev A lane A1–A10** ([[agent-memory/mvp-1-crm-line-bill-capture-sequence]] canonical evidence log), overlapping most of this harness: A3 = Phases 2/3/9, A4 = Phases 4/7, A5 = Phases 5/6. Owner decision 2026-07-09: **reconcile the live inbox + build the one deferred piece (send-doc-to-LINE)**. Delivered this session: Phase 1 `/expenses`+`/sales-documents` re-point (unique — parallel lane never touched it); reconciled the mounted `InboxPrototypePage` sidebar to the canonical A3 backend + payment-proof button (see Reconciliation Evidence). **Phase 8 RE-SCOPED + DONE 2026-07-09**: owner ruled end-customers must NOT view the financial document via a public link (the public-route options were rejected — same reason the parallel lane deferred it). Send-doc is now STAFF-DRIVEN — a "ส่งให้ลูกค้า" button on each quotation in the inbox sidebar (gated `crm.inbox.reply`) inserts a Thai doc summary (number + amount) into the reply composer for the staff to review and send via the existing reply path (staff-authored, audited). NO public route, NO migration, NO adapter change. An authenticated customer-facing doc view stays deferred to customer LIFF (Phase 8B / Dev B).
Owner: Dev A lane (core system) under owner harness instruction.
Scope: [[plans/mvp1-a3-a5-revenue-loop-durable-flow-plan]] — the full CRM revenue loop + durable flow the MVP1 sequence leaves open, plus the loop-B `/expenses` re-point. Two-dev lanes A3 (revenue-loop remainder), A4 (new-conversation notification + item-06 LINE push), A5 (durable inbound media + reply-send retry/DLQ → H3), and `/expenses`/`/sales-documents` wire-up. Owner scope confirmation 2026-07-09: launch = full customer CRM (appointments/booking/LIFF/daily brief all counted AS CRM — separate later harnesses) + company bill/receipt/reimbursement; this harness covers the revenue-loop + durable-flow + expense-page slice, not the greenfield modules (A7/A8/B9/B10) or ops (A2/A6/deploy).

## Verified Baseline (3-agent code map, 2026-07-09)

- `/inbox`, `/customers`, `/crm-reports`, AI panel + trust read = **DONE + committed** (A1/B5: `eacd8984`/`274c5028`/`a580f324`/`d67d24c5`), **not deployed** (owner-gated canary). The earlier "/inbox is a live mock" framing was STALE (from the 2026-07-08 reconciliation). Correction landed in [[agent-memory/mvp-1-crm-line-bill-capture-sequence]].
- `/expenses` + `/sales-documents` STILL mock (`MangmeeModulePrototypePage` generic placeholder); real `ExpensesPages.tsx`/`AccountingPages.tsx` exist — expenses mounted NOWHERE, accounting reachable at `/accounting`. This is the loop-B web regression the reconciliation originally under-counted.
- Revenue-loop engines all EXIST (deal=`CrmOpportunity`, task=`CrmFollowUp`, quotation-from-deal=`CreateCrmQuotationDraftUseCase`, `summary360` aggregate); the "from a conversation" glue is greenfield (no entity carries `conversationId` — bridge via `customerId`). Send-doc-to-LINE (G7) and payment-proof queue (G8) are TRUE greenfield.
- Durable substrate: `apps/api` has zero BullMQ producers — pattern is worker repeatable job → `X-Worker-Token` `/internal/*` endpoint → use-case (copy `apps/workers/src/common/scan-worker.ts`; template `crm-sla-worker`→`CrmInternalController`→`ScanCrmSlaBreachesUseCase`→`CreateOrUpdateNotificationEventUseCase`). Retry scaffold = `NotificationDelivery` model + `computeNextAttemptAt`.
- Confirmed gaps G1–G8 with file paths are tabled in the plan. Notable: inbound media/profile = in-process `void` (L135/L197 of `process-inbound-line-message.use-case.ts`, self-flagged no-retry); reply send inline no-DLQ, adapter never reads LINE `Retry-After`; `crm.conversation.message_received/created` have NO notification consumer (only workflow-outbox rule matching); item-06 push has 3 gaps (no sweep/producer, default channels exclude `line`, no failure backoff) + an UPPERCASE/lowercase status-case caveat to reconcile.

## Decisions

- Phase order = value-first, risk-ascending: P1 `/expenses` re-point + P2/P3 sidebar/deal/task/quotation (web/glue over ready backend — fast prod wins) → P4 new-conv notification → P5 durable media → P6 send retry/DLQ (H3) → P7 LINE push wiring → P8 send-doc (greenfield, owner decision) → P9 payment-proof (greenfield). Each phase independently reviewable + shippable (A1 per-phase-commit precedent).
- `/expenses` = **re-point real `ExpensesPages` as-is** (owner decision 2026-07-09) — functional now, Mangmee restyle deferred (the prototype was a generic placeholder, no expense-specific Mangmee design to preserve). `/sales-documents` nav re-points to the real `/accounting`; drop the mock duplicate.
- Quotation-from-conversation = **deal-first, zero new backend** (resolve-or-create opportunity → existing quotation-draft endpoint). Direct customer→quotation endpoint only if owner wants quoting without a deal.
- Send path signature (`SendCrmInboxMessageUseCase`) stays STABLE — B7 auto-reply calls it (H3). Harden by extension, not rename.
- Payment-proof marking routes to a HUMAN finance review queue only — no auto-post/confirm/pay (final-mutation ban). Reconciliation stays manual in accounting/expenses.
- Migrations are additive + announced (rule 10): P5 media/profile pending markers, P6 send `attemptCount`/`nextAttemptAt`/stable retryKey, P9 `CrmMessage` payment-proof flag. Coordinate timestamps with Dev B's pending sets (toggle/cap/`AuthorType.AI`/`turnClass`).
- New API specs (P4–P9) MUST be registered in `apps/api/package.json` `"test"` list (hand-maintained — unregistered specs silently never run: [[project_api_test_explicit_spec_list]]).

## Open questions

- **RESOLVED 2026-07-09** — Phase 8 send-doc delivery form: owner chose **(B) rich push**. LINE has no native PDF push, so B = Flex doc-summary bubble (with a "ดูเอกสาร" button) — or an image message of the rendered doc — over a scoped read-only doc-view/asset route + a new adapter push method (`pushFlexMessage`/`pushImageMessage`). Superset of the text-link option; prefer Flex-with-button first. See plan Phase 8. No open questions remain.

## Artifacts

- Plan/harness: [[plans/mvp1-a3-a5-revenue-loop-durable-flow-plan]]
- Reference harness format + done A-lane work: [[plans/mvp1-a1-web-wireup-plan]] / [[agent-memory/mvp1-a1-web-wireup]]
- Authority: [[plans/crm-line-oa-customer-os-plan]] Phase 3 (line 212–229); [[plans/mvp-1-crm-line-bill-capture-sequence]] MVP1-1; [[agent-memory/notification-line-push-wiring]] (Phase 7); [[plans/mvp-1-two-dev-parallel-plan]] A3/A4/A5 + H3.

## Verification

- Docs-only pass so far. Per-phase verify commands are in the plan; Claude runs the `api-verify-3011`/`web-verify-3002` browser rig per phase (durability phases P5/P6 require a kill-mid-flight recovery proof, not just green tests).

## Phase 1 Evidence (2026-07-09)

Status: implemented in-tree, NOT committed (owner controls per-phase commits). Scope = route re-point only (G1); no backend, no nav change.

Files changed (2 route pages, ponytail 2-line swaps):
- `apps/web/app/(workspace)/companies/[companyId]/expenses/page.tsx`: `MangmeeModulePrototypePage moduleKey="expenses"` → real `ExpensesHubPage` (`@/features/expenses/ExpensesPages`, takes only `companyId`; server enforces `expense.*`). Mirrors the `/accounting` + `/reimbursements` sibling pattern (no session props — those gate server-side, unlike inbox/customers which pass `permissions` for client gating).
- `apps/web/app/(workspace)/companies/[companyId]/sales-documents/page.tsx`: `MangmeeModulePrototypePage moduleKey="salesdoc"` → real `AccountingHubPage` (item 08, the same feature already served at `/accounting`). Nav left untouched — both the `accounting` and `salesdoc` nav slots now reach the real item-08 page; merging the redundant slot is a cosmetic follow-up, not a launch blocker, and avoids shared `web-core-workspace.constants.ts` churn.

Verification (Node v22):
- `pnpm --filter @watchdog-bms/web typecheck` exit 0 (next typegen + `tsc --noEmit` clean).
- `pnpm --filter @watchdog-bms/web test` 233 pass / 0 fail.
- `grep mangmee-prototype` on both route files → none; `git diff --check` clean.
- Live browser render (real session) deferred to the review step — best bundled with Phase 2 (which adds real sidebar logic that genuinely needs the rig). Static risk low: `ExpensesHubPage` is item-09-verified code that rendered at this exact route+layout before PR#6 bypassed it; siblings `/accounting`/`/reimbursements` use the identical pattern.
- **Expense loop confirmed 2026-07-09**: the `/expenses` re-point is BYTE-IDENTICAL to the pre-PR#6 route (`git show ef93ddb1^:…/expenses/page.tsx` == the restore), and `ExpensesHubPage` reads `?tab=`/`?signatureId=` itself (client-side) so LINE signature-ticket deep-links keep working with only the `companyId` prop — no breakage. Item 09 is COMPLETE + prod-deployed (commit `a19619e`, 2026-07-03) + REAL-LINE-verified (owner sent a real receipt photo through the prod LINE OA → intake router → Typhoon OCR → Bedrock extraction → draft → web review link; this closed the items 07/09/10B real-LINE blocker). So the restored page is proven, not new. **CORRECTION to my earlier gap notes: OCR is NOT missing** — Typhoon OCR is the live receipt provider (OpenAI/Bedrock OCR fallback removed by owner decision); "MVP1-3 acceptance polish" is nice-to-have, not a blocker. **Genuine expense remainders for launch:** (1) the SAME deploy gap as inbox — PR#6's mock is live on PROD (`ef93ddb1`); the re-point is committed (`008e12c0`) but undeployed, so prod bill-review shows the mock until canary; (2) production evidence-bytes storage adapter (S3) — item-09 Next flags it (spawned task) — without it, evidence preview/manifest download may not work on prod. Item 14 payment voucher + item 18 export stay backlog. The `/expenses`+`/sales-documents` re-point is MINE/unique (parallel lane never touched it) — must be preserved in any branch reconciliation.

## Reconciliation Evidence (2026-07-09) — live inbox → canonical A3 backend

Context: the parallel lane's A3 web (`QuickActions`) lives in `InboxPage.tsx`, which the `/inbox` route does NOT mount — the route mounts `InboxPrototypePage.tsx`. So the canonical A3 BACKEND was reachable but no UI on the mounted inbox called it; my Phase 2/3 sidebar (mounted) called raw item-15 endpoints. Reconciled to unify: mounted Mangmee sidebar + canonical conversation-scoped backend. `apps/web/src/features/crm-inbox/InboxPrototypePage.tsx` only; NO backend edits (canonical A3 backend reused as-is).

- Create handlers now call `createDealFromConversation` / `createTaskFromConversation` / `createQuotationFromConversation` (from `./crm-inbox.api`; conversation-scoped, link the conversation + drop a SYSTEM source-ref note) instead of raw `createCrm*` item-15 endpoints. `createQuotation` dropped its deal-first dance — the canonical endpoint resolves/creates the opportunity itself.
- Task due date uses the canonical Bangkok-09:00 convention (`${date}T09:00:00+07:00`).
- Payment-proof: `MessageBubble` gains a "ทำเครื่องหมายหลักฐานการชำระ" button on INBOUND IMAGE/FILE messages (gated `crm.inbox.reply`, matching `crm-conversation-actions.controller.ts`) → `flagPaymentProof`; done/error states.
- Read-back widgets (deals/tasks/finance/quotations from `summary360`) kept from Phase 2 — the "sidebar read-back" the parallel lane deferred.
- Permissions verified vs controller: deal `crm.opportunity.create`, task `crm.follow_up.create`, quote `crm.quotation.link`, flag `crm.inbox.reply`.

Verification (Node v22): `pnpm --filter contracts build` (parallel lane added booking/tier types — needed rebuild); web typecheck exit 0 (0 errors in touched file); web test 218/218; `git diff --check` clean; grep confirms no `createCrm{Opportunity,FollowUp,QuotationDraft}` refs remain. Live browser render pending the seeded rig (deferred; static-verified). NOT re-built (parallel lane, in tree): A4 (Phase 4/7), A5 (Phase 5/6), A3 backend + payment-proof (Phase 2/3/9 backend); A9 already ships a payment-proof review page at `/companies/:id/crm/payment-proofs`.

## Next

- **Phase 8 send-doc-to-LINE (option B)** is the remaining open piece — scope the customer-facing signed doc-view primitive (the parallel lane's stated blocker) mirroring the item-09 `local-storage` public-route precedent, add a `LineMessagingAdapter.pushFlexMessage`, a `DOCUMENT` outbound branch in `SendCrmInboxMessageUseCase`, and a "ส่งให้ลูกค้า" action. Coordinate on the shared `develop` tree (parallel lane active): announce before any migration, additive only, no `git add -A`.
- Seeded browser rig pass for the reconciled inbox (create deal/task/quotation → canonical endpoints; payment-proof flag → finance queue) when convenient.
