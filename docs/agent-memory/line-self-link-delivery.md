# Agent Memory: line-self-link-delivery

Status: rebased onto main (464 commits) — slice B REDUCED to unified sidebar row (spec §8); merging
Owner: thawatchai (order 2026-09-01: spec+plan → Opus implements → Fable reviews bug/gap/impact → merge develop + main)
Scope: two slices on one branch `feat/line-self-link` (branched from `plan` @ wc-fix commit)

- Slice A (done): admin "Issue LINE QR" button in Partner Detail members table.
  `PartnerMemberLineLinkTokenUseCase` + route `POST /system/partners/:id/members/:uid/line-link-token`
  (perm `system.partner_member.manage`, 72h TTL, CRITICAL audit) + web button/panel reusing `QrLinkCard`.
  23/23 focused tests pass; api+web typechecks pass.
- Slice B (spec'd): self-service link from sidebar user menu. See specs/line-self-link-spec.md +
  plans/line-self-link-plan.md.

Decisions:
- Placement = sidebar user-menu popup (Owner corrected: account-security page absent from starter package).
- Mobile → LIFF deep link; desktop → QR modal. Self-mint TTL 15m; admin chat-handoff TTL stays 72h.
- Permission rule: every role with account.password.change gets identity.link (employees included).
- Owner directive 2026-09-01 (mid-implementation, spec+plan amended): linked-state sidebar row is
  DISABLED — no re-link, no unlink, no manage modal, no unlinkLine() client fn, and
  `account.identity.unlink` is NOT widened. Protects the LINE OA free push quota.
- package.json test-script edit is the sanctioned exception (spec-suite-coverage guard forces wiring).
- Rate limit (spec §6.6 SHOULD / plan step 6): skipped. `AuthRateLimitService` has no generic per-user
  entry point — a fit would need a new method plus two new config env vars plus deploy.sh wiring, not the
  one-line fit the spec conditions it on. Abuse value is low: authenticated, self-scoped, and each mint
  revokes the previous PENDING token.

Open questions: none blocking.
Artifacts: spec, plan, this memory; slice A diff on branch; /tmp/mangmee-line-sidebar-mockup.html (approved).
Verification: slice A — `npx tsx --test` 23 pass; tsc api+web clean.
Slice B (2026-09-01) — `apps/api` tsc clean; `apps/web` tsc clean; full api unit suite 5148 tests /
5074 pass / 0 fail / 74 skipped; full web suite 1050 tests / 1050 pass / 0 fail.
Fable review fixes (2026-09-01), both re-verified (focused 139/139 api + 6/6 web, then full suites
re-run green, api exit 0 / web 1050 pass):
1. audit row now sets the companyId COLUMN (was metadata-only → invisible to the company-scoped
   audit page, against the convention every other LINE-link audit row follows).
2. lineLinkMenuRow(null) now returns disabled:true — "unknown" must not read as "not linked";
   during the ~300ms fetch window an already-linked user could otherwise start the re-link the
   owner quota directive forbids.
Accepted as-is: no rate limit on mint (no one-line fit; authed + self-scoped + revoke-prior);
common/app-shell now imports @/features/auth/auth.api (first common→features import in the repo —
no cycle, no lint rule; watch for spread); desktop modal poll runs until modal close (bounded).
Next: Fable adversarial review (bugs/gaps/blast radius, incl.
permission-widening impact on showAccountSecurity and role-template parity specs) → full suite →
PR → develop (admin-merge ok) → PR develop-side or direct to main (needs human approval — Owner clicks).

Rebase 2026-09-01 (onto origin/main @63f5d877): P12/UAT work had already shipped LINE web login,
line/link/oauth, an always-clickable sidebar link row, AND the identity.link+unlink grant widening.
Resolution: dropped our mint endpoint/use-case/QR modal as duplicate surface; kept the
account-security lineLinked extension + lineLinkMenuRow gate and wired them onto main's OAuth row
(disabled until state lands / once linked). Skipped two stale plan-branch commits superseded on
main (owner-summary fix ≈ PR #288; identical wc-fix in connect-production.sh). Registry conflicts
taken from main (link+unlink everywhere; unlink grant is live-but-unused surface — noted, not
reverted). Slice A survived rebase; controller/module/spec/api-client conflicts hand-merged.
