# Agent Memory: UAT existing email OTP login

Status: UAT DEPLOYED; PERMANENT TRANSPORT/TIMING REMEDIATION IN PROGRESS
Owner: Codex
Scope: Urgent existing-account public email OTP loop; API transaction, focused web recovery copy, spec/plan/tests, UAT release, and the owner-requested permanent SSM/sub-10-minute release remediation.
Decisions: Owner directed that a registered account email proven by a valid OTP must be able to log in. Treat the browser-bound public OTP as explicit opt-in only when it resolves to one exact User.email and current active/non-privileged/security guards pass. Atomically set missing email verification/login activation and issue the session; do not attach or merge contact emails.
Open questions: None. The UAT observation also showed that the 14:14–14:15 OTP address belonged to The lobby clube, not The sun coffee; the hotfix never remaps an email between accounts.
Artifacts: `docs/specs/unified-easy-signup-spec-th.md`, `docs/plans/unified-easy-signup-plan-th.md`, API email-access service/PG spec, web email-access recovery copy.
Verification: The application change passed focused PostgreSQL 16/16, API/Web typechecks, repository CI, and merged through PR #689 (`develop`) and #690 (`main`). UAT operation `20260921T104804Z-b234bbdb` deployed exact main `4fb173afbc93d81d1cddfa240de18d49d08f2a46` in 379.348 seconds; migrations, all three exact source/config/image readbacks, deep readiness, public OPEN smoke, retirement, and KMS ECDSA verification passed. The two temporary `171.99.161.133/32` SSH rules were revoked by exact rule ID and absence read back.
Next: Merge the reviewed SSM/timing controller, apply a no-replacement UAT CloudFormation change set, enroll `sshTransport: ssm`, and prove read-only preflight without public TCP/22. Human QA will test the exact stored account email separately as requested.
