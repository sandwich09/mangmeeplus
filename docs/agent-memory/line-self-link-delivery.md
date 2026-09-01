# Agent Memory: line-self-link-delivery

Status: slice A implemented+tested; slice B implementation delegated (Opus agent), Fable review pending
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
- Permission rule: every role with account.password.change gets identity.link+unlink (employees included).
- package.json test-script edit is the sanctioned exception (spec-suite-coverage guard forces wiring).

Open questions: none blocking.
Artifacts: spec, plan, this memory; slice A diff on branch; /tmp/mangmee-line-sidebar-mockup.html (approved).
Verification: slice A — `npx tsx --test` 23 pass; tsc api+web clean. Slice B — pending implementation.
Next: Opus implements slice B per plan → Fable adversarial review (bugs/gaps/blast radius, incl.
permission-widening impact on showAccountSecurity and role-template parity specs) → full suite →
PR → develop (admin-merge ok) → PR develop-side or direct to main (needs human approval — Owner clicks).
