# Agent Memory: production global maintenance mode 2026-08-10

Status: Customer-access switch implemented and locally verified; production unchanged
Owner: Codex with MangmeeDev; protected-main reviewer and production owner approval remain human-owned
Scope: Fail-closed customer-access switch, SYSTEM_ADMIN-only onboarding access, clickwrap exemption
for platform operators, outer-proxy/AI/worker closure, and maintenance-only production promotion.
Decisions: Reuse `SYSTEM_ADMIN` and `system.launch_gate.manage`; do not add a parallel role or
permission. Keep the ordinary login shell available while closed, but issue/accept sessions only for
SYSTEM_ADMIN. Store one audited OPEN/CLOSED state; production missing/error defaults CLOSED and
maintenance_only overrides it CLOSED/cannot-open. SYSTEM_ADMIN is a platform operator and is exempt
from customer clickwrap without creating acceptance rows. Forward only login/auth/status/system
control through the outer proxy; LINE/uploads/business routes remain stopped before Nest, AI stays
blocked, and worker queues stay disabled. A valid ordinary member is detected before token issuance,
receives no new session, has browser auth cookies cleared, and sees `/maintenance`; invalid or
non-member accounts remain ordinary login failures. Existing ordinary sessions are blocked and
protected layouts redirect them to `/maintenance`. SYSTEM_ADMIN lands on the access-control page.
Live opening still requires the legal-evidence-gated
all-target source C, after which SYSTEM_ADMIN may open access in the console.
After singleton closure, wait 900 seconds and retain a timestamped proof that previously issued
direct-storage URLs reached their byte-pinned maximum lifetime.
Maintenance may defer only launch-specific evidence; it does not exempt residual processing. Keep
the controller/contact, inline security-log notice, purposes/retention, rights handling, incident
and security controls, and protection for already-stored data in force while the product is closed.
Open questions: Production Redis/security preflight and the independent owner approval must pass in
the real promotion ceremony. Maintenance does not mean zero PDPA processing for infrastructure logs
or any data already stored.
Artifacts: `docs/specs/production-global-maintenance-mode-spec.md`,
`docs/plans/production-global-maintenance-mode-plan.md`, Prisma migration and singleton access
service/controller, auth/session/legal gates, login and maintenance UI, SYSTEM_ADMIN control page,
and production proxy/verifier/immutable-byte contracts.
Verification: Customer-access auth/legal/platform suites 91/91 passed; web session/cookie suites
24/24 passed; API and Web typechecks passed; Prisma validate and Nest provider boot smoke passed;
the optimized Next production build passed and a localhost request proved that initial `/login`
HTML contains the closed marker and public maintenance notice without disclosing the operator path.
Proxy suite 4/4 passed, including canonical-mode mismatch rejection,
exact company/contact, discarded-content warning,
inline residual-processing privacy copy, and absence of scripts/forms; AI maintenance middleware 2/2
and full AI regression 523/523 passed; shared config 118/118 passed; serving-mode, read-only
maintenance-preflight, release-intent, direct-storage URL drain, workflow contract,
external-probe fake, immutable-maintenance-byte validator, production image security, release safety,
quiesce, YAML parse, AI typecheck, and `git diff --check` passed. Browser checks passed at
1280×900 and 390×844 with no script, form, iframe, external stylesheet/image, or horizontal
overflow. Full GitHub CI/UAT/production proof remains pending.
Next: Review the final scoped diff, then commit and push through protected main before UAT and the
maintenance-only production proof. Do not stage the unrelated production-deploy memory update.
