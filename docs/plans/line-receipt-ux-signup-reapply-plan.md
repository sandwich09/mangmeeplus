# LINE receipt UX and signup reapplication implementation plan

Status: IN PROGRESS — 2026-09-08 Bangkok.

Spec: `docs/specs/line-receipt-ux-signup-reapply-spec.md`.
Branch: `codex/line-receipt-ux-signup-reapply-20260908`, based on updated origin/develop `1c905ff0`.

1. Preserve the prior release ledger and Production HOLD. Finish already-running automatic READY and verify cleanup. Pause only UAT capacity using the runbook's exact full-field round trip; preserve image/env/secrets and record stable zero readback.
2. Trace receipt capture, saved-result recovery, explicit text edits, terminal rendering and webhook replay. Make initial receipt replies concise/themed/passive; retain money/warnings and the neutral web action. Sanitize the shared customer formatter, including fallbacks and multiple-draft labels. Fix the reconciliation shape in the shared source-draft helper.
3. Make rejected historical applications expose deliberate reapplication and eligible existing shops while preserving real account suspension and open-request fences. Enforce prior rejection → manual review server-side, including changed emails and approval/retry races; expose history to the admin queue.
4. Replace the LIFF-only support dependency with a bounded token-verified route into existing durable support handling. Reuse deduplication, audit and notification patterns; avoid a new dependency or a parallel support system.
5. Add regressions from the actual screenshots and owner decisions. Validate initial receipt has no questions/codes, explicit edits still work, unknown amount stays unknown, warnings remain, reconciled fractional lines bind, and web revisions/tax/duplicate boundaries hold. Validate rejected resubmission with new email is manual; pending retries do not duplicate; support succeeds without `sendMessages` and safely handles failures.
6. Inspect the final mobile customer output and admin recovery journey. Run relevant focused checks, PostgreSQL integration and typechecks/whole-chain CI. Record results, impact and limitations in memory. Do not change package.json or add unrelated refactors.
7. Commit/push and merge reviewed fixes into develop/main under existing owner admin-merge authorization. Select exact reviewed PR head with actual required CI. Re-read canonical deploy protocol; restore UAT to stable 1/2, pass preflight, dispatch one UAT run and follow to signed result/runtime/customer acceptance. Record the automatically triggered READY and safe cleanup. No Production workflow dispatch.

Acceptance evidence must cover product, architecture, implementation and integration directly. No legacy role-gate ceremony.
