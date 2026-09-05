# Agent Memory: P10 External Signup Core

Status: P10-0 implemented and locally verified; P10-1 public ingress blocked by Owner decisions
Owner: Growth Platform
Scope: Durable signup request/state/idempotency/audit/outbox and provision-once claim only; no public route, email provider, claim page, billing mutation, or feature activation
Decisions:
- `requestedOfferKey` is attribution only and grants no entitlement.
- Normalize email/tax ID before canonical payload hashing; the unique idempotency boundary is `externalSignupId`.
- Serialize same-key receive/transition with a PostgreSQL transaction advisory lock, then retain a version CAS as the update fence.
- Audit/outbox evidence carries request/state/version only; it excludes company name, email, tax ID, and other signup payload fields.
- Provisioning requires a one-winner attempt claim. The future adapter may call `CreateCompanyOnboardingUseCase` only for the winner and must attach the email-verified owner so no temporary password is created.
- A request left in `PROVISIONING` is an unknown outcome: reconcile the existing onboarding result before retrying; never blindly provision again.
Open questions:
- HMAC versus short-lived service JWT for official-site ingress.
- Claim TTL and resend/revoke authority.
- Existing tax-ID collision verification/attach/review policy.
- `businessCategory` input/allowlist or product default required by the existing onboarding command.
- Actual provision adapter awaits P11's verified user/credential boundary.
Artifacts:
- `apps/api/prisma/migrations/20260826200000_external_signup_core/migration.sql`
- `apps/api/src/modules/external-signup/domain/company-signup.logic.ts`
- `apps/api/src/modules/external-signup/application/company-signup-core.service.ts`
- `apps/api/src/modules/external-signup/external-signup.module.ts`
- `docs/plans/mangmee-external-signup-plan-th.md`
Verification:
- Prisma format/validate/generate passed; local migration deploy/status passed with 151 migrations up to date. A fresh temporary database applied all 151 migrations and contained the signup enum/table (`151|1|1`); it was removed afterwards.
- Focused test passed for normalization/hash/state, idempotent replay/conflict, concurrent receive/claim, retry/fencing, and PII-free evidence.
- Real PostgreSQL smoke passed: 16 receives -> 1 row; 8 provisioning claims -> 1 winner; stale attempt rejected; 8 unique audit/outbox pairs; no signup PII in evidence payloads. Synthetic rows were deleted after the probe.
- Full API test, API typecheck, and DI boot regression passed (`Nest resolved every provider`).
- `prisma migrate diff --exit-code` still reports pre-existing drift in unrelated legacy tables/index names (`DataRightsCase`, `ExpenseRecord`, `LegalDocumentActionRecord`, `RemoteReleaseMutationIntent`, `RemoteReleaseOperation`); it reports no drift for `CompanySignupRequest`/`CompanySignupState`. Kept out of this scoped diff.
- Browser QA is not applicable to P10-0 because this phase deliberately adds no controller, route, or page; the DI boot regression covers application integration.
Next:
- Commit/push/PR P10-0. Do not expose ingress until all four Owner questions are resolved.

## 2026-09-05 — P10-L relaxes "never blindly provision again" (branch `codex/line-signup-a-core`)

The invariant above still holds in substance, but its literal reading ("a `PROVISIONING` row is
never re-claimed") was itself a defect: nothing releases the fence when the process holding it
dies — an ECS task replaced mid-transaction, a transaction past its 15s cap — and there is no
sweep, so such a row stayed `PROVISIONING` forever with no operator path at all. Adversarial review
of the LINE-first slice found this and two failures with the same shape.

What changed, and why re-provisioning is no longer blind:

1. **The outcome is knowable now.** `CreateCompanyOnboardingUseCase` stamps
   `CompanySignupRequest.companyId` INSIDE its own transaction
   (`linkSignupRequestId`), so "which company did this application create" is a
   question the database can always answer. There is no window where a company exists and the
   row does not say so.
2. **Reconcile-before-retry is now code, not a rule.** `ProvisionSignupUseCase.adoptExistingCompany`
   takes over whenever `companyId` is set: it skips onboarding entirely and walks the fence forward
   over the company that already exists.
3. **Stale re-claim.** `claimProvisioning` may take the fence from a `PROVISIONING` row older than
   `STALE_PROVISIONING_MS` (90s = the 15s transaction ceiling plus tail), auditing
   `signup.provisioning.reclaimed_stale`. A fresh row still answers "in progress". The predicate
   `isStaleProvisioning` is shared with the admin queue so the fence and the queue cannot disagree
   about what abandoned means — they did, twice, and each time the recovery shipped unreachable.
4. **Overlap is safe at the DB level.** The advisory lock only covers the claim, so two runs can
   overlap. The in-transaction stamp is conditional (`updateMany where companyId: null`); the loser
   matches 0 rows and throws, rolling its whole transaction back, so it creates nothing. This
   matters most on the LINE attach path, where no `ExternalIdentity` is created and duplicate
   company names are legal — nothing else would have stopped a second Company.

So: still never provision a second company for one application; but a request stuck in
`PROVISIONING` with no live holder is now recoverable rather than terminal.
