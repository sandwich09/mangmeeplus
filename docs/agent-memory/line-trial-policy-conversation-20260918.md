# Agent Memory: LINE trial and policy conversation

Status: implemented; preparing PR integration; normal develop + main integration, no deployment requested.
Owner: Codex, 2026-09-18
Scope: public policy answers, contextual follow-ups, wrong-link acknowledgement, novice help phrases.

Decisions:
- User approved this set for the normal release cycle after reporting trial follow-ups routed to expense help. Keep billing behavior unchanged.
- Reuse standard Flex cards, canonical text fallback and the public official-site package link. Never offer an expense link for a package question.
- Public answers distinguish unpaid trial from an already purchased subscription; no account-specific expiry, payment, deletion or refund claims.
- Sources: `docs/specs/mangmee-package-entitlements-spec-th.md`, `docs/specs/mangmee-billing-pack-amendment-2026-09-12.md` (latest owner amendment), `docs/specs/mangmee-company-plan-term-spec-th.md`, `docs/specs/mangmee-company-data-lifecycle-deletion-spec-th.md`, and `docs/runbooks/line-first-signup-support-playbook.md`.
- Remember only a closed public-policy topic in existing durable outcome metadata, never private assistant answers. Reuse the 15-minute context window; require the immediately previous event to have a delivered outcome for the same sender/chat/channel. Intervening events invalidate it. Existing durability flag remains authoritative; without an accepted outcome, do not infer context.
- Human-support pause, quoted/mixed business requests, mutations, tenant permissions and account gates keep their existing routes. No schema, dependencies, prompts, payment gates or package.json changes.

Acceptance:
- Trial -> “ต้องสมัครต่อไหม” -> “แบบหมดอายุฟรีแล้วบังคับสมัครต่อไหม” -> “ถามว่าบังคับไหม”: clear optional purchase, no automatic trial charge, cards throughout, zero model calls.
- “เข้าแล้วมาหน้าค่าใช้จ่าย” after a policy answer acknowledges the wrong destination and supplies the package route; never congratulates or claims navigation succeeded.
- General trial limits/card requirement, expiry/data, paid renewal, early purchase, quota counting, plan changes, cancellation/refunds and payment-failure policies use documented public rules; individual facts go to staff.
- No context across users/chats/channels, expired/undelivered outcomes, unknown metadata or intervening business turns. Persistence survives use-case instance replacement.
- Novice help uses existing capability flow and its permissions.

Open questions: none blocking; no new commercial policy is being decided.
Artifacts: isolated branch `codex/line-trial-policy-conversation-20260918` from develop 70d1359d.
Verification:
- Focused existing staff-menu/card/webhook suites: 433/433 passing, including the reported sequence, promotion entry, restart, isolation, expiry, interruption, support pause and Flex rejection.
- API typecheck passed (Node 22, 8 GB heap); contracts/config built and Prisma generated in the isolated checkout.
- Official public URL inspected: site provides package information. FAQ cards and text fallback always use `https://official.mangmeeplus.com/`, never a tenant expense URL.
- No browser/Prod session changes or deployment performed. Context uses the existing durable-outcome flag (normal UAT/Prod workflow default true); disabling it deliberately disables contextual inference.
- Exact-head CI: pending.
Next: implement and verify, PR/merge develop, integrate same set into main; leave deployment to normal cycle.
