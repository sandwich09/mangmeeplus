# Postmark environment activation and rollback

Historical provisioning status 2026-09-15: source implementation has focused verification; dedicated Postmark Live servers created at approximately 14:38 UTC after explicit user confirmation. **No Postmark runtime activated**; last runtime observation was UAT SES, Production disabled. This runbook complements the mandatory [cloud operations](cloud-environment-operations.md) and [deployment protocol](uat-production-v2-deployment.md); it is not permission to deploy or send email.

## Current UAT activation — 2026-09-16

UAT now runs Postmark20950027 under main ee2f5542, signed Kamal hotfix20260916T080218Z-b9eb3d90.
Dedicated UAT secret references/values and exact recipient allowlist were provisioned through
existing non-root profiles. Original webhook25832029 at `/v1/public/postmark-events` verifies
Delivery/Bounce/SpamComplaint (all200). Real application OTP email reached Gmail SMTP and its
authenticated callback persisted matching deliveredAt with PUBLISHED outbox evidence.

The receiver acknowledges only authenticated reserved native verification samples without any
business mutation. Real event server/stream/attempt fencing remains unchanged. Postmark's actual
pre-provisioning API required query `?verify=false`; a body-only Verify:false did not disable
verification. Do not create a duplicate endpoint or repeat a failed verification without evidence.

Native existing-account OTP confirmation returned LEGACY_LOGIN_REQUIRED because explicit
passwordless opt-in is off; this is not a successful login/new signup proof. Production20950034
was not activated/deployed in this task. Earlier statements below about unprovisioned UAT settings
are historical; canonical `infra/postmark/config.json` and the signed current release are authoritative.
[Exact native proof, failures and remaining activation](../evidence/uat-main-readiness-2026-09-16.md).

## Canonical configuration

`infra/postmark/config.json` is the shared mail deployment source for ECS and real Kamal environments. It holds non-secret values plus Secrets Manager ARNs, never token/password values or tester addresses. Do not edit only a running container or the old ECS UAT baseline: the next Kamal release reapplies this tracked source.

| Value | UAT | Production |
|---|---|---|
| `provider` after native acceptance | postmark | postmark |
| `POSTMARK_FROM_ADDRESS` | developer@mangmeeplus.com | contact@mangmeeplus.com |
| `POSTMARK_FROM_NAME` | Mangmee Plus (UAT) | Mangmee Plus |
| `POSTMARK_MESSAGE_STREAM` | outbound (active Transactional) | outbound (active Transactional) |
| Server name | Mangmee Plus UAT | Mangmee Plus Production |
| `POSTMARK_SERVER_ID` | `20950027` | `20950034` |
| Native DeliveryType | Live | Live |
| `WEB_BASE_URL` | https://uat.mangmeeplus.com | https://mangmeeplus.com |

Both servers were created with Live selected; successful server detail pages confirmed their distinct IDs and active default `outbound` Transactional streams. [UAT server](https://account.postmarkapp.com/servers/20950027/streams) / [Production server](https://account.postmarkapp.com/servers/20950034/streams). Existing My First Server `20896570` is unchanged and not assigned to either environment. Creation is not token-binding, webhook or delivery proof. Credentials have not been copied into deployment secrets; add the observed IDs to canonical config together with complete actual secret references, since partial retained configuration is rejected. From addresses already match the table in `infra/postmark/config.json` and were reconfirmed by the user.

Add these entries to each environment's `secrets` object using the actual complete ARN returned when an authorized operator provisions each secret:

- `POSTMARK_SERVER_TOKEN`
- `POSTMARK_WEBHOOK_USERNAME`
- `POSTMARK_WEBHOOK_PASSWORD` (at least 24 characters)
- UAT only: `POSTMARK_UAT_ALLOWED_RECIPIENTS`, a comma-separated list of exact tester email addresses. Empty means no UAT sends; no wildcard/domain allowance and no implicit replacement of the intended recipient.

Allowed secret namespace: `arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/<uat|production>/postmark/<secret-name-and-suffix>`. Use independent references and credentials, backend-only server tokens. Application credentials must not be account-admin tokens. Domain verification does not create a mailbox/alias for incoming replies; confirm developer@mangmeeplus.com reply handling separately.

The checked-in defaults have no fabricated server IDs, credentials or tester recipients and remain UAT SES/Production disabled. `provider=postmark` is rejected until complete references exist. ECS accepts an explicit `EMAIL_PROVIDER=disabled` outbound rollback while preserving canonical callback settings. Normal activation should change the committed canonical provider after native acceptance, so future releases retain the intended choice.

ECS injects the references through container `secrets`, retaining the environment-scoped execution-role boundary. Kamal resolves AWSCURRENT privately, records versions in the existing release inventory, and checks those versions again before mutation. A version change stops the release; follow the deployment protocol rather than retrying blindly. Confirm the deployment role can read only the required environment's secrets; missing access is a provisioning dependency, not permission to broaden it automatically.

## Application behavior

Native manual delivery evidence on 2026-09-15: [UAT and Production tests](../evidence/postmark-native-delivery-2026-09-15.md) reached Gmail SMTP with the intended From addresses. These template-editor tests did not exercise the application behavior below. The provider test UI defaults to an account signature; select From explicitly and verify it before clicking Send test. Keyboard Return can submit with the previous value.

Every non-local Postmark send checks the authoritative deployment environment, expected From and frontend origin, configured stream, one recipient and no Cc/Bcc. UAT checks exact normalized recipient membership and adds `[UAT]` to the subject. The shared transport then GETs `/server` and the configured stream and requires expected ID, Live mode, active Transactional stream before POST `/email`.

The native checks add up to two read requests per send, each with the existing 10-second timeout. They do not run at application boot or block unrelated login/read paths. Native read failure is a sanitized configuration error before POST; it is not evidence of an uncertain outbound send. Existing error/recovery flows remain responsible for the failed business intent. Local fake/validation tests retain their original contract; they do not certify provider readiness.

## Activation proof

1. Log into the actual Postmark account and read server inventory, DeliveryType, stream, verified domain/sender, quota and provider account state. Record exact IDs and observation time without tokens. Account approval or a successful DNS check alone is not deployment/inbox acceptance.
2. Provision dedicated UAT and Production servers/credentials within the authorized scope. Do not infer sandbox/live from names or from Stripe mode. The production server ID must differ from UAT. Sandbox automation belongs in an isolated test harness; it does not deliver real OTP/reset messages to inboxes.
3. Populate canonical config and secret references, confirm actual UAT allowlist, and use read-only native configuration checks before enabling outbound. Validate token→server identity and stream type/activity. `/server` responses contain ApiTokens: never store or print the full response.
4. Configure separate webhook URLs and Basic Auth per server/stream for Delivery, Bounce and SpamComplaint; disable message-body inclusion. The app route is `/v1/public/postmark-events`; the Next rewrite implies `<origin>/api/v1/public/postmark-events`, but verify the actual ingress, TLS and Authorization forwarding before registering that URL.
5. Verify callback authentication/mismatched server/stream rejection, durable success, duplicate and late callbacks, persistence failure and suppression using the approved provider test procedure. No callback may grant identity verification or paid rights. Do not report spam against actual transactional messages to generate a test complaint.
6. With authorized tester recipients, prove UAT inbox delivery and original verify/reset links return to UAT. After the separate OTP/self-link feature is implemented, prove email linking, replacement verification and payment return through that feature. This transport change does not implement account OTP.
7. Apply the normal signed UAT/READY/Production protocol. Inspect the resulting running provider, server/stream, sender, frontend origin, secret reference/version metadata and callback evidence. Successful unit tests or Sandbox Delivered are not a live release acceptance result.

## Disable, rotation and migration

- Outbound stop: set canonical `provider=disabled`, retain current server ID/stream and webhook secret references. Keep callback ingestion and outbox processing alive for already-sent messages. Disabling mail must not revoke paid access or remove existing document/recovery paths.
- Do not revert blindly to a schema/image predating durable Postmark attempts or replay an unknown attempt through SES. Existing provider-specific reconciliation decides the original attempt's outcome.
- Token rotation on the same server: provision under the established authorization, deploy fresh secret version and verify identity/readiness. Do not revoke the old token until old tasks no longer need to send/reconcile; document the bounded overlap and verify revocation.
- Webhook password rotation: the current app accepts one credential pair. Use an explicitly scheduled outbound pause, drain/reconcile pending delivery facts and coordinate provider/app credential cutover. Account for provider retry/drop behavior and recheck after cutover. Zero-downtime rotation is not claimed; if required, implement and prove bounded previous-credential support first.
- Server/stream migration: pause new sends, reconcile original outstanding attempts and establish the retained callback strategy before replacing IDs. The current receiver accepts only the configured server/stream. Do not overwrite IDs while old callbacks still require processing, or copy UAT delivery/suppression state into Production.

## Offline verification

`python3 infra/postmark/config_test.py` exercises real ECS JSON rendering without AWS, wrong environment/secret/server/missing settings, rollback retention and private secret version resolution. `python3 infra/kamal/release_test.py` covers the actual canonical override and secret freshness boundary with fake cloud reads. These checks do not provision anything.

Application focused tests and current evidence/status: [implementation memory](../agent-memory/signup-optional-email-impact-2026-09-15.md).


## Account OTP implementation and readiness (2026-09-16)

The account OTP policy is always active in the candidate code. `infra/postmark/config.json` selects the environment sender/server/secret references; no feature switch is part of activation. Provisioning and native preflight are release prerequisites, not proof already obtained. Local mocks do not demonstrate UAT or Production delivery. Read the cloud operations and mandatory UAT/Production v2 release runbooks before any live action.

- UAT: `developer@mangmeeplus.com`, native server 20950027, outbound transactional stream, environment-scoped recipient allowlist.
- Production: `contact@mangmeeplus.com`, native server 20950034, outbound transactional stream.
- Each environment needs its own random 32-byte `EMAIL_OTP_HMAC_KEY` represented as 64 hexadecimal characters and the canonical `EMAIL_OTP_HMAC_KEY_VERSION`. Never copy either token or HMAC secret between environments. Secret values must not appear in terminal output, evidence, git, screenshots, or command arguments.
- Normal Kamal/ECS deployment resolves the canonical secret references and performs native `/server` and `/message-streams` readiness before mutation. Missing/wrong/disabled provider or key fails preflight. Existing verified users and normal ERP use do not depend on a successful mail call during a runtime provider outage.

### Coordinated OTP key rotation

Use the mandatory release protocol with the exact candidate/run IDs. Drain old OTP admissions and workers before replacing the key; never run mixed key versions against one database. Generate/store the new environment key privately, update the nonsecret canonical version, and revoke pending challenges for the old version in the maintenance transaction below. Do not run this SQL as a normal startup hook. Take the old version as a parameter, never the secret value. Record counts only.

```sql
BEGIN;
-- All OTP and financial admissions are drained by the release controller first.
WITH revoked AS (
  UPDATE "EmailVerificationToken" SET status = 'REVOKED'
  WHERE "proofKind" = 'OTP' AND status = 'PENDING' AND "keyVersion" = :'old_key_version'
  RETURNING "userId"
)
UPDATE "User" SET "emailRevision" = "emailRevision" + 1
WHERE id IN (SELECT "userId" FROM revoked);
COMMIT;
```

Run native preflight and prove a fresh OTP request/confirmation with the new candidate before customer OPEN. Old codes must fail; verified emails, sessions, paid invoices and entitlements remain unchanged. If rotation fails, keep new admissions closed and use the release recovery protocol; do not restore old pending codes or bypass verified-email checks. This rotation rehearsal is still NOT RUN in live UAT/Production.

### Unknown company recipient result

`UPDATE_BILLING_EMAIL` may have reached Stripe even when its response is lost. The same operation is reconciled with its original idempotency key; after 23 hours it never posts again automatically. A mismatch/unknown opens a durable `EMAIL_RECIPIENT_REVIEW` issue in the existing support queue, keyed by the operation ID displayed to the owner. Cancellation of renewal, reading ERP and reconciliation of already paid invoices remain available. New financial authorizations for this company wait for evidence.

Support must inspect the bound environment/account/customer, original consent and provider request evidence through the existing reviewed support process. A matching authoritative customer email readback completes the original operation, resolves the issue and releases the reservation. Never mark completed merely because an email was sent, a timeout elapsed, or support closed a ticket. Never clear the reservation by SQL or repeat a POST with a new idempotency key to guess the result. If the provider cannot establish the result, the issue remains open for provider escalation; this is an explicit exceptional review path, not a guaranteed automatic recovery. A separate newly authorized change must recheck current owner/email proof.
