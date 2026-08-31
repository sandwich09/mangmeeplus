# External Signup (P10 Flow B) — integrator wiring

Everything below is what this round deliberately did **not** edit, plus the facts an integrator
needs to finish the release. Code in this module and in `apps/workers/src/modules/signup-claim-email/`
is complete and tested; the items here are registration, ops config and the P29 hand-off.

## 1. Already wired — no action needed

- `ExternalSignupModule` is imported by `apps/api/src/app.module.ts` (since P10-0), so the three new
  controllers register automatically. **No `app.module.ts` change is required.**
- DI verified: `pnpm --filter @watchdog-bms/api run test:boot` → `Nest resolved every provider`.

## 2. Test files to register

`apps/api/package.json` `"test"` and `apps/workers/package.json` `"test"` are hand-maintained
space-separated file lists (no glob). Append these paths — they all pass today:

**apps/api** (55 tests)

```
src/modules/external-signup/domain/account-claim.logic.spec.ts
src/modules/external-signup/domain/company-signup.logic.spec.ts
src/modules/external-signup/application/submit-company-signup.use-case.spec.ts
src/modules/external-signup/application/signup-claim.use-case.spec.ts
src/modules/external-signup/application/signup-admin-queue.use-case.spec.ts
src/modules/external-signup/application/provision-signup.use-case.spec.ts
src/modules/external-signup/application/signup-claim-email.service.spec.ts
src/modules/auth/infrastructure/account-claim-email.template.spec.ts
```

SES bounce/complaint round (36 further tests, all passing):

```
src/modules/external-signup/infrastructure/sns-signature.spec.ts
src/modules/external-signup/application/ses-event.use-case.spec.ts
src/modules/auth/infrastructure/ses-auth-mailer.adapter.spec.ts
```

**apps/workers** (4 tests)

```
src/modules/signup-claim-email/signup-claim-email-worker.spec.ts
```

Note: `submit-company-signup.use-case.spec.ts` takes ~3.5s because one case exercises the real 3s
MX timeout. Everything else is sub-second.

## 3. Workers registration

In `apps/workers/src/main.ts`, inside `if (config.QUEUE_ENABLED)`, push both workers onto the
`workers` array (anything not pushed there is abandoned on SIGTERM rather than closed):

```ts
import { startSignupClaimEmailWorker, startSignupClaimReminderWorker }
  from './modules/signup-claim-email/signup-claim-email-worker.js';

workers.push(startSignupClaimEmailWorker(config.REDIS_URL));
workerLog('info', { event: 'signup_claim_email_worker_started' });
workers.push(startSignupClaimReminderWorker(config.REDIS_URL));
workerLog('info', { event: 'signup_claim_reminder_worker_started' });
```

Both use the shared `startScanWorker` helper and POST to internal endpoints with `X-Worker-Token`:

| Timer | Interval | Endpoint |
|---|---|---|
| `signup-claim-email-drain` | 30s | `POST /v1/internal/signup-claim-email/drain` |
| `signup-claim-reminder-sweep` | 15 min | `POST /v1/internal/signup-claim-email/reminder-sweep` |

The send itself runs **API-side**, not in the worker: the mailer port, its SES client and its config
live in the Nest container. The worker is only the timer. This is the `expense-auto-post` pattern,
and it is a deliberate deviation from a literal "workers module consumes the outbox".

## 4. Environment

| Var | Where read | Required? | Effect |
|---|---|---|---|
| `EXTERNAL_SIGNUP_ENABLED` | `AppConfigService.externalSignupEnabled` | already in `packages/config` (default `false`) | Off = availability reports `{enabled:false}` and `POST /v1/public/company-signups` is 403. Status and claim routes stay **open** so an approved applicant is never stranded by a flag flip. |
| `LINE_OA_ADD_URL` | `officialLineOaAddUrl()` in `signup-claim-email.service.ts` (`process.env`) | optional | Unset = the claim email drops the add-friend line; everything else sends. Not added to `packages/config` on purpose — public URL, safe empty default. |
| `EMAIL_LOGO_URL` | `accountClaimLogoUrl()` in `account-claim-email.template.ts` (`process.env`) | optional | HTTPS only; a non-HTTPS or malformed value is ignored, never thrown. Unset = no masthead image. |
| `SES_CONFIGURATION_SET` | `sesConfigurationSet()` in `ses-auth-mailer.adapter.ts` (`process.env`) | optional | Unset = the send carries no configuration set, i.e. exactly the behaviour before this round, and **no bounce/complaint event is ever published**. Set to `mangmee-transactional` to turn the feedback loop on. |
| `SES_EVENTS_TOPIC_ARN` | `expectedSesEventsTopicArn()` in `ses-event.use-case.ts` (`process.env`) | **fail-closed** | Unset = `POST /v1/public/ses-events` refuses every message with 403, including subscription confirmations. Set to `arn:aws:sns:ap-southeast-1:311414082667:mangmee-ses-events` (UAT and production may differ). |

Per the UAT-flags rule, `EXTERNAL_SIGNUP_ENABLED`, `SES_CONFIGURATION_SET` and
`SES_EVENTS_TOPIC_ARN` reach UAT only via a `deploy.sh` jq block — that file is out of scope here
and still needs its edit plus a re-pin. **No IAM change is needed:** the `ses:SendEmail` statement
`deploy.sh` already writes lists `configuration-set/mangmee-transactional` alongside the identity.

Live email additionally needs `EMAIL_PROVIDER=ses` plus the P11 §5 SES operations (sender domain,
DKIM/SPF/DMARC on Cloudflare, region, sandbox exit). Until then `EMAIL_PROVIDER=disabled` makes the
whole flow a no-op send: the outbox event is still published, so nothing retries forever.

## 5. Files changed outside this module

| File | Change | Why it could not be avoided |
|---|---|---|
| `apps/api/src/app.module.ts` | **none** | already imports the module |
| `apps/api/src/common/config/app-config.service.ts` | `externalSignupEnabled` getter | the env existed in `packages/config`; only the API-side getter was missing |
| `apps/api/src/modules/auth/application/auth-rate-limit.service.ts` | 4 new fail-closed bucket methods, constants only; the SES round added a 5th (`assertSesEventsAllowed`) | no new env vars |
| `apps/api/src/main.ts` | one route-scoped `json()` parser for `/v1/public/ses-events` | SNS posts `text/plain`, which the global JSON parser skips; its 256 KB cap (SNS's own maximum) is that endpoint's body-size guard |
| `apps/api/src/modules/auth/domain/ports/auth-mailer.port.ts` + all three adapters | `sendAccountClaim` returns the provider message id | the SES `MessageId` is the only join key a bounce event carries back to the request row |
| `apps/api/src/modules/auth/auth.module.ts` | export `AUTH_MAILER_TOKEN` | so the consumer sends through the one selected adapter instead of building a second SES client |
| `apps/api/src/modules/auth/infrastructure/{ses,local-console}-auth-mailer.adapter.ts` | claim template now delegates to the shared module | Owner-locked copy, SES/console parity by construction |
| `apps/api/src/modules/system-onboarding/system-onboarding.module.ts` | export `CreateCompanyOnboardingUseCase` | spec §2 rule 5: one company-creation service |
| `apps/api/src/modules/system-onboarding/.../create-company-onboarding.use-case.ts` | additive `claimedOwner` + `allowDuplicateCompanyName` | see §6 |
| `apps/api/src/modules/workflow/.../workflow-outbox-drain.use-case.ts` | added 2 event types to `excludeEventTypes` | **load-bearing**: the generic drain claims everything not excluded, so without this it would swallow claim emails and "publish" them as workflow events. The applicant would never receive their only email. |
| `apps/web/src/features/auth/line-login-bff.logic.ts` | `bot_prompt=normal` | the brief pointed at `line-link-oauth.use-case.ts`, but that file only *spends* the code; the authorize URL is built here |

## 6. Onboarding use-case extension (additive, default-off)

`CreateCompanyOnboardingCommand` gained two optional fields. Existing admin callers are unchanged.

- `claimedOwner?: { email, phoneNumber?, passwordHash?, attachUserId? }` — the claim-verified owner.
  With `passwordHash`: the user is created with an **ACTIVE** credential, `mustChangePassword=false`,
  no expiry and no `tempPasswordEncrypted`, and the verified email + `emailVerifiedAt` are written
  **in the same transaction** (so a unique-email clash cannot leave a company with no owner contact).
  With `attachUserId`: the owner is resolved by id — a claim-time account may have no username at
  all — and the email is adopted only when the account has none.
- `allowDuplicateCompanyName?: boolean` — spec §4C; only the public path sets it, so the admin
  console keeps the guard that catches its own typos.

## 7. P29 plan-term hand-off

`provision-signup.use-case.ts` carries the seam, intentionally not called:

```ts
// P29 term hook: setTermFromPreset(companyId, 'PRO_999', 30)
```

It sits after the company exists and before `completeProvisioning`, because the trial clock starts
at provision, not at approval (spec §4D ⑤).

## 8. Known gaps — deliberate, and each needs a decision

1. **No `EMAIL_PENDING → EXPIRED` sweep.** Token expiry is enforced at claim time, so an unclaimed
   request sits in `EMAIL_PENDING` with a dead link. That is benign — `canResendClaim` is true there,
   so the applicant can self-serve — but nothing ever moves a request into `EXPIRED`. The state and
   its way back (`EXPIRED → EMAIL_PENDING`) are implemented and tested for whenever a sweep lands.
2. **`businessType` never becomes a real category.** Free Thai text is not machine-mappable, so
   anything without an exact enum match provisions as `OTHER` — including a clinic. The frozen
   `AdminSignupDecisionBody` has no field for an admin to choose the category, so this round has no
   place to correct it before provisioning. **A health-adjacent tenant will be categorised `OTHER`
   and the PDPA tripwire (`pdpaHealthAdjacentTenantOnboarded`) will not fire.** Correcting it in
   company settings afterwards is the only route today. This is the highest-value follow-up.
3. **Provisioning retry loses the chosen username.** It is passed through the claim request rather
   than persisted (there is no column, and the schema is frozen). A retry after
   `PROVISIONING_FAILED` falls back to the email local part.
4. ~~**Bounce/complaint → `EMAIL_FAILED` is not wired.**~~ **Closed.** `POST /v1/public/ses-events`
   consumes the SNS subscription for the `mangmee-transactional` configuration set: hard bounces and
   complaints move `EMAIL_PENDING → EMAIL_FAILED`, which is exactly the state the queue already
   flags and both resend paths already accept. Needs the two env vars in §4 and the SNS subscription
   in `docs/runbooks/ses-email-setup.md`; until then the endpoint is fail-closed and sends carry no
   configuration set, so behaviour is unchanged.
5. **No rejection-notice email template.** `enqueueRejectionNotice` publishes
   `email.signup_rejected.requested` and the event is excluded from the generic drain, but no
   consumer sends it. Rejection is silent by default, so this only matters once an admin ticks
   "notify". Until a consumer exists those events sit `PENDING`.
