# Agent Memory: onboarding trial receipt fixes

Status: Implementation, owner-email amendment and all local integration acceptance complete. Frozen candidate ready for PR CI/admin delivery. Docs-first commits 4f9cbb8a and 324172b2; no deployment dispatched.
Owner: Coordinator with GPT-6 Astra xhigh receipt/email lanes and GPT-5.6 Sol xhigh web lane, as requested by the same-workflow instruction.
Scope: User issues 1–5: first receipt after signup, trial 15 consistency, syntax-only signup contact email, failed receipt reads free of customer quota, prominent dashboard profile actions. Git delivery through develop/main; no live environment or customer-data mutation.

## Decisions

- Base develop `ca36d69751ad37629bb512b0d0d3585afdcf010e`; branch `codex/onboarding-trial-receipt-fixes-20260907`; dedicated sibling worktree. Original user changes are outside staging.
- Trial ten was actual warmup enforcement, not just copy. Use the trial term's monthlySlipLimit from day one, preserving explicit admin limits, Bangkok calendar-month windows and independent operational caps. Legacy normal trial rows with warmup10 receive effective15 without a migration.
- Commercial receipt allowance counts the existing indexed receipt-route event ledger; bank extraction no longer consumes this allowance through the all-route aggregate. Successful general-image work keeps its existing behavior.
- Admission is provisional until usable receipt output is persisted. Empty/malformed/provider/apply failures release the exact event once in its original month; orphan resume rotates its event generation. Successful persistence followed by failed notification stays charged. The provider AI-cost ledger remains independent; unknown transport cost is not zero.
- Required syntax-only owner email remains contact in CompanySignupRequest.contactEmail and Company.email and becomes an available unverified User.email for a LINE-proven owner whose account email is empty. emailVerifiedAt stays null. Existing account email is preserved; an address already used by another account/email-shaped username keeps the shop on LINE access without blocking signup or attaching/merging. A transaction savepoint handles a concurrent unique-index winner without leaving the whole shop transaction aborted. Legacy null applications and later authorized edits remain safe.
- Signup still creates no password/username requirement and no mail delivery. Account settings can correct an unverified email without SES; verified-email status and current-password proof are checked at commit, pending verification is revoked, and other sessions revoked. Optional later password accepts the stored account email without an extra username. LINE-delivered password recovery accepts that identifier after a credential exists, refuses ambiguous accounts and uses only the exact linked LINE destination. Mailbox reset/verified account merge proofs remain unchanged.
- Unknown web responses preserve the same request ID through upload/review/reload. Recovery requires a successful summary stamped with that exact request and still-active source attachment; display uses recognized source fields, never financial placeholders. Duplicate admission stays pending; optional browser storage failures do not block OCR.
- Profile card uses large bold bordered actions, left “ไว้ก่อน”, right “กรอกข้อมูลให้ครบ”, with direct current-company shop/account form navigation and the existing seven-day company-specific snooze.
- No new feature flags or schema. The next deployment must enable `LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED=true` and `LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED=true` in both UAT and Production, as already required by the owner.

Owner clarification resolved: “กรอกแล้วใช้งานได้เลย ยังไม่ต้องตั้ง password”. Email also serves the owner account; opening/using the shop via LINE requires neither a password nor delivered verification. Earlier contact-only interpretation is superseded. No open product question.

## Artifacts and acceptance evidence

- [Spec](../specs/onboarding-trial-receipt-fixes-spec.md), [plan](../plans/onboarding-trial-receipt-fixes-plan.md), and owner amendments in the existing LINE-first/external-signup specs.
- Local logs and inspected mobile/desktop screenshots: `output/onboarding-trial-receipt-fixes-20260907/` in the task worktree; excluded from Git. Fixtures are synthetic, with no live customer identities/images or outbound LINE/email.

| Issue | Permanent evidence | Result |
|---|---|---|
| 1. First receipt before settings | `onboarding-receipt-allowance.pg.spec.ts`: real AUTO_FREE submit/provision/onboarding, legal/member/LINE context/permissions, upload and OCR apply; optional tax/address/password/login-email absent; positive item plus printed zero item | 1/1 PostgreSQL pass, including clean migrated + permissions-only CI-equivalent database; first receipt persists and remaining allowance is 14/15; wrong tenant/branch/inactive member denied |
| 2. Trial 15 everywhere | Plan/config, receipt-governance/quota, signup notification/copy and LINE counter regressions | Legacy warmup10 resolves to configured trial monthly15; custom/non-trial limits and bank-route isolation covered |
| 3. Owner email with immediate LINE access | Signup/onboarding/LIFF/profile/controller suites; real signup/auth PG; served LIFF and account-profile browser | Amended focused API 209/209; recovery/auth siblings 72/72; browser covers required/invalid/normalized email, no signup password field, optional later password without username, correction with/without current password and truthful collision handling. Clean required PostgreSQL: signup14/14, auth concurrency1/1 and first receipt1/1, zero skips. |
| 4. Failed reads do not spend allowance | Governance/clients/apply/LINE suites; receipt reliability PG; web upload/review recovery tests | Exact-event and original-month compensation, competing/replayed/orphan attempts, unsuccessful apply, successful notification failure, stale source and unknown HTTP outcome covered; final affected LINE suites 464/464 pass; meter/reliability combined PG-enabled command 71/71, zero skips |
| 5. Clear settings actions | `profile-completeness-card.spec.ts` against actual local dashboard/profile forms | 2/2 browser at 390/1280; 48px touch targets, 16px bold labels, direct form navigation, no horizontal overflow, fresh completion and snooze after reload pass |

## Verification

- Read AGENTS and repository ponytail full; legacy absolute skill path is stale, same repository skill used as prior round.
- Frozen-lockfile offline install, contracts/config build and Prisma generation passed. No package.json, lockfile or dependency edits.
- Final amended-source `pnpm test` passed across the workspace (`workspace-tests-owner-email-final.log`). Affected LINE intake/webhook/gateway suites passed 464/464, full permanent web glob 1,662/1,662 and final auth/recovery siblings72/72. No remaining source edits after final checks.
- Final amended-source `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck` passed across all workspaces (`workspace-typecheck-owner-email-final.log`).
- Final amended-source `node scripts/run-line-ai-whole-chain-acceptance.mjs` passed all eight acceptance suites (`line-whole-chain-owner-email.log`).
- `pnpm --filter @watchdog-bms/config test` passed 142/142; `node apps/api/scripts/check-di-metadata.mjs` passed (797 files, 870 decorated classes, 820 constructor dependencies).
- Protected deployment hashes regenerated only through `node infra/security/sync-production-maintenance-release-pins.mjs`; its `--check`, shell spec and production-serving-mode spec passed. The deploy source change is only the warmup default15; two resulting checksum pins updated, with no guard weakened.
- New first-shop and account-profile-email PG tests are registered in the existing required-PostgreSQL CI job. On clean migrated + permissions-only PostgreSQL15459: signup14/14, account email1/1, first receipt1/1; zero skips. Forced simultaneous signup uses two independent Prisma clients, both read the address free and exactly one real unique-index loser rolls back to its savepoint while both shops complete. Auth proof interleaves actual first-password, correction, delayed verification request and verification commit. Final fixture Company/User/SignupRequest/OnboardingRun counts are zero.
- Amended combined local browser run passed 5/5: actual served LIFF script/CSP at390/1280, dashboard/profile CTA at390/1280, and mobile owner-account email correction/optional password. New account-security/write responses are controlled in this browser case; real PG independently proves backend state/concurrency. Actual signup has no password field or verification wait; screenshots inspected.
- Final `git diff --check` passed. Generated Next per-port type-reference changes are restored before staging.

## Reviewed adjacent impact and limits

- Owner-email review caught and fixed a stale verification request recreating a token after correction, first-password/verification races, unique email conflict aborting the onboarding transaction, and email-shaped legacy username ambiguity. The correction uses current state under locks; ambiguous recovery produces the same generic refusal with no token/delivery.
- Review caught and fixed stale success summaries masquerading as a new OCR result, request-ID loss across navigation, blocked sessionStorage access, in-flight duplicate becoming terminal, and stale async responses after source/context changes.
- Review caught and fixed counters using completion month instead of admission month, successful substitute supporting/payment attachment work being incorrectly refunded, and delayed old compensation targeting a resumed admission.
- Bounded compensation retries emit `OCR_QUOTA_COMPENSATION_REQUIRED` with exact event identity if a prolonged database outage prevents release. That condition needs exact-event reconciliation; this change does not infer blanket historical refunds.
- Local evidence proves deterministic application behavior with controlled model/storage boundaries, not that an external AI provider can never fail or that live Production has changed. The previous zero-priced-item fix is included from #473/#474 and covered again.

Next: Wait for CI on the frozen branch, admin merge the develop PR, then the develop-to-main PR and verify tree parity. Record PR/run IDs in delivery evidence. At the next release, verify both required flags and actual trial15 runtime values in UAT and Production; follow the deployment runbook, signed UAT/READY/Production results and customer OPEN acceptance. This coding task does not dispatch those runs.

### Reproduce the amended PostgreSQL acceptance

From `apps/api`, use a disposable migrated `watchdog_bms` database with synced permissions in `$TASK_TEST_DATABASE_URL`:

```sh
ACCOUNT_PROFILE_TEST_DATABASE_URL="$TASK_TEST_DATABASE_URL" ACCOUNT_PROFILE_REQUIRE_POSTGRES=true pnpm exec tsx --test src/modules/auth/account-profile-email.pg.spec.ts
LINE_SIGNUP_TEST_DATABASE_URL="$TASK_TEST_DATABASE_URL" pnpm exec tsx --test src/modules/external-signup/line-signup-stale-identity.pg.spec.ts
ONBOARDING_RECEIPT_TEST_DATABASE_URL="$TASK_TEST_DATABASE_URL" ONBOARDING_RECEIPT_REQUIRE_POSTGRES=true pnpm exec tsx --test src/modules/line-ai/onboarding-receipt-allowance.pg.spec.ts
```

Initial amended full-suite failures were stale test fixtures (old64-character recovery limit and missing fake SQL/email writes); focused209/209 and the final complete suite pass after their correction. The new browser case initially used an ambiguous text locator; it now explicitly verifies account email and login-hint occurrences and passes5/5. These were fixed before PR dispatch.
