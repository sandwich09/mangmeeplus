# Agent Memory: onboarding trial receipt fixes

Status: Applying owner-email amendment before Git delivery. Owner confirmed signup flow remains immediately usable through LINE with no password setup. Coordinator stated that email will also serve the owner account, with optional password later. Spec/plan updated before revised code. Docs-first baseline committed as 4f9cbb8a; no deployment dispatched.
Owner: Coordinator with GPT-6 Astra xhigh receipt/email lanes and GPT-5.6 Sol xhigh web lane, as requested by the same-workflow instruction.
Scope: User issues 1–5: first receipt after signup, trial 15 consistency, syntax-only signup contact email, failed receipt reads free of customer quota, prominent dashboard profile actions. Git delivery through develop/main; no live environment or customer-data mutation.

## Decisions

- Base develop `ca36d69751ad37629bb512b0d0d3585afdcf010e`; branch `codex/onboarding-trial-receipt-fixes-20260907`; dedicated sibling worktree. Original user changes are outside staging.
- Trial ten was actual warmup enforcement, not just copy. Use the trial term's monthlySlipLimit from day one, preserving explicit admin limits, Bangkok calendar-month windows and independent operational caps. Legacy normal trial rows with warmup10 receive effective15 without a migration.
- Commercial receipt allowance counts the existing indexed receipt-route event ledger; bank extraction no longer consumes this allowance through the all-route aggregate. Successful general-image work keeps its existing behavior.
- Admission is provisional until usable receipt output is persisted. Empty/malformed/provider/apply failures release the exact event once in its original month; orphan resume rotates its event generation. Successful persistence followed by failed notification stays charged. The provider AI-cost ledger remains independent; unknown transport cost is not zero.
- Required syntax-only email is unverified shop contact in CompanySignupRequest.contactEmail and Company.email. It does not set User.email/emailVerifiedAt, attach an account by contact, or require SES. Existing owners, shared contact addresses, legacy null applications and authorized later company edits remain safe.
- Unknown web responses preserve the same request ID through upload/review/reload. Recovery requires a successful summary stamped with that exact request and still-active source attachment; display uses recognized source fields, never financial placeholders. Duplicate admission stays pending; optional browser storage failures do not block OCR.
- Profile card uses large bold bordered actions, left “ไว้ก่อน”, right “กรอกข้อมูลให้ครบ”, with direct current-company shop/account form navigation and the existing seven-day company-specific snooze.
- No new feature flags or schema. The next deployment must enable `LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED=true` and `LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED=true` in both UAT and Production, as already required by the owner.

Owner clarification: Email belongs to the owner account, while the original password-free immediate LINE signup flow stays unchanged. Existing owner emails and other-account addresses are never overwritten or merged. Contact-only implementation/test evidence below is the initial baseline and must be replaced by amended identity acceptance before merge. No additional owner answer is required for the scoped implementation.

## Artifacts and acceptance evidence

- [Spec](../specs/onboarding-trial-receipt-fixes-spec.md), [plan](../plans/onboarding-trial-receipt-fixes-plan.md), and owner amendments in the existing LINE-first/external-signup specs.
- Local logs and inspected mobile/desktop screenshots: `output/onboarding-trial-receipt-fixes-20260907/` in the task worktree; excluded from Git. Fixtures are synthetic, with no live customer identities/images or outbound LINE/email.

| Issue | Permanent evidence | Result |
|---|---|---|
| 1. First receipt before settings | `onboarding-receipt-allowance.pg.spec.ts`: real AUTO_FREE submit/provision/onboarding, legal/member/LINE context/permissions, upload and OCR apply; optional tax/address/password/login-email absent; positive item plus printed zero item | 1/1 PostgreSQL pass, including clean migrated + permissions-only CI-equivalent database; first receipt persists and remaining allowance is 14/15; wrong tenant/branch/inactive member denied |
| 2. Trial 15 everywhere | Plan/config, receipt-governance/quota, signup notification/copy and LINE counter regressions | Legacy warmup10 resolves to configured trial monthly15; custom/non-trial limits and bank-route isolation covered |
| 3. Contact email | Seven focused signup/onboarding/LIFF suites plus real signup PG and served LIFF browser form | 216/216 focused, 10/10 PG, 2/2 browser at 390/1280; syntax/error focus/normalization/retained inputs and identity boundaries pass |
| 4. Failed reads do not spend allowance | Governance/clients/apply/LINE suites; receipt reliability PG; web upload/review recovery tests | Exact-event and original-month compensation, competing/replayed/orphan attempts, unsuccessful apply, successful notification failure, stale source and unknown HTTP outcome covered; final affected LINE suites 464/464 pass; meter/reliability combined PG-enabled command 71/71, zero skips |
| 5. Clear settings actions | `profile-completeness-card.spec.ts` against actual local dashboard/profile forms | 2/2 browser at 390/1280; 48px touch targets, 16px bold labels, direct form navigation, no horizontal overflow, fresh completion and snooze after reload pass |

## Verification

- Read AGENTS and repository ponytail full; legacy absolute skill path is stale, same repository skill used as prior round.
- Frozen-lockfile offline install, contracts/config build and Prisma generation passed. No package.json, lockfile or dependency edits.
- `pnpm test` passed across the workspace. After final edge-case corrections, affected LINE intake/webhook/gateway suites passed 464/464; full permanent web glob passed 1,657/1,657. No source edits remain after those lane checks.
- Final frozen-source `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck` passed across all workspaces.
- Final frozen-source `node scripts/run-line-ai-whole-chain-acceptance.mjs` passed all eight acceptance suites.
- `pnpm --filter @watchdog-bms/config test` passed 142/142; `node apps/api/scripts/check-di-metadata.mjs` passed (797 files, 870 decorated classes, 820 constructor dependencies).
- Protected deployment hashes regenerated only through `node infra/security/sync-production-maintenance-release-pins.mjs`; its `--check`, shell spec and production-serving-mode spec passed. The deploy source change is only the warmup default15; two resulting checksum pins updated, with no guard weakened.
- New first-shop PG test is registered in the existing required-PostgreSQL CI job. It passes with only migrations and synced permissions, creates its own operator fixture, and leaves no company/user/signup/expense/attachment/usage/outbox fixtures behind.
- Combined local browser run passed 4/4; actual served LIFF script/CSP and actual dashboard/profile tested. LINE external SDK/identity/submission boundaries are controlled in the browser harness; real PG tests independently prove backend persistence.
- Final `git diff --check` passed. Generated Next per-port type-reference changes are restored before staging.

## Reviewed adjacent impact and limits

- Review caught and fixed stale success summaries masquerading as a new OCR result, request-ID loss across navigation, blocked sessionStorage access, in-flight duplicate becoming terminal, and stale async responses after source/context changes.
- Review caught and fixed counters using completion month instead of admission month, successful substitute supporting/payment attachment work being incorrectly refunded, and delayed old compensation targeting a resumed admission.
- Bounded compensation retries emit `OCR_QUOTA_COMPENSATION_REQUIRED` with exact event identity if a prolonged database outage prevents release. That condition needs exact-event reconciliation; this change does not infer blanket historical refunds.
- Local evidence proves deterministic application behavior with controlled model/storage boundaries, not that an external AI provider can never fail or that live Production has changed. The previous zero-priced-item fix is included from #473/#474 and covered again.

Next: Wait for CI on the frozen branch, admin merge the develop PR, then the develop-to-main PR and verify tree parity. Record PR/run IDs in delivery evidence. At the next release, verify both required flags and actual trial15 runtime values in UAT and Production; follow the deployment runbook, signed UAT/READY/Production results and customer OPEN acceptance. This coding task does not dispatch those runs.
