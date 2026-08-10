# Agent Memory: production global maintenance mode 2026-08-10

Status: Implementation and local verification complete; production unchanged pending protected-main/UAT
Owner: Codex with MangmeeDev; protected-main reviewer and production owner approval remain human-owned
Scope: Global outer-proxy maintenance gate, paused worker queues, maintenance-only production
promotion, verification, and deployment while the product remains closed.
Decisions: Gate at `infra/api-web/web-api-proxy.mjs`, before every public API/web/LINE path and raw
origin. Add the same pre-body gate to AI Gateway; keep workers healthy with queues disabled. Allow
only exact liveness/readiness. Use HTTP 200 plus an explicit maintenance header because the ECS
canary rollback alarm counts intentional non-2xx responses. Do not change package manifests. Do not
use a bridge that predates the gate. Bootstrap all three services from one exact UAT release through
the read-only maintenance-bootstrap path, then use that release as the full promotion bridge. Live
opening remains legal-evidence gated and requires a distinct all-target UAT source C with closed B
as bridge. Require canonical serving-mode/secondary-flag agreement at api-web and workers boot.
After singleton closure, wait 900 seconds and retain a timestamped proof that previously issued
direct-storage URLs reached their byte-pinned maximum lifetime.
Maintenance may defer only launch-specific evidence; it does not exempt residual processing. Keep
the controller/contact, inline security-log notice, purposes/retention, rights handling, incident
and security controls, and protection for already-stored data in force while the product is closed.
Open questions: Production Redis/security preflight and the independent owner approval must pass in
the real promotion ceremony. Maintenance does not mean zero PDPA processing for infrastructure logs
or any data already stored.
Artifacts: `docs/specs/production-global-maintenance-mode-spec.md`,
`docs/plans/production-global-maintenance-mode-plan.md`.
Verification: Proxy suite 4/4 passed, including canonical-mode mismatch rejection,
exact company/contact, discarded-content warning,
inline residual-processing privacy copy, and absence of scripts/forms; AI maintenance middleware 2/2
and full AI regression 523/523 passed; shared config 118/118 passed; serving-mode, read-only
maintenance-preflight, release-intent, direct-storage URL drain, workflow contract,
external-probe fake, immutable-maintenance-byte validator, production image security, release safety,
quiesce, YAML parse, AI typecheck, and `git diff --check` passed. Browser checks passed at
1280×900 and 390×844 with no script, form, iframe, external stylesheet/image, or horizontal
overflow. Full GitHub CI/UAT/production proof remains pending.
Next: Run the full focused/security suite, commit and merge through protected main, create two exact
UAT releases, close all three production services first, then promote all and capture
custom/raw-origin, disabled-queue, and direct-storage drain evidence.
