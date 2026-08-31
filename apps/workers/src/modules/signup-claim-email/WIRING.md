# signup-claim-email worker — registration

Two timers. Neither does any work itself: each POSTs to an API-side internal endpoint, because the
mailer adapter and its SES client live in the Nest container. This is the `expense-auto-post`
pattern, via the shared `startScanWorker` helper.

## Register in `apps/workers/src/main.ts`

Inside `if (config.QUEUE_ENABLED)`, alongside the other `workers.push(...)` calls. Anything not
pushed onto that array is abandoned on SIGTERM instead of closed gracefully.

```ts
import { startSignupClaimEmailWorker, startSignupClaimReminderWorker }
  from './modules/signup-claim-email/signup-claim-email-worker.js';

workers.push(startSignupClaimEmailWorker(config.REDIS_URL));
workerLog('info', { event: 'signup_claim_email_worker_started' });
workers.push(startSignupClaimReminderWorker(config.REDIS_URL));
workerLog('info', { event: 'signup_claim_reminder_worker_started' });
```

## Register the spec

`apps/workers/package.json` `"test"` is an explicit file list, not a glob. Append:

```
src/modules/signup-claim-email/signup-claim-email-worker.spec.ts
```

## What each timer does

| Export | Queue / jobId | Interval | Endpoint | API service |
|---|---|---|---|---|
| `startSignupClaimEmailWorker` | `signup-claim-email` | 30s | `POST /v1/internal/signup-claim-email/drain` | `SignupClaimEmailService.drain()` |
| `startSignupClaimReminderWorker` | `signup-claim-reminder` | 15 min | `POST /v1/internal/signup-claim-email/reminder-sweep` | `SignupClaimEmailService.sweepReminders()` **and** `sweepExpiredApprovals()` |

The drain endpoint now covers all three signup outbox types — the claim email, the opt-in rejection
notice and the new-application announcement to the platform admins — through one claim/settle loop.
The reminder timer likewise runs both claim-clock sweeps: the 24h reminder and the 30-day park
(spec §4D ① and ④). Neither needed a new queue: `startScanWorker` ignores the response body, so both
endpoints simply return more fields than before.

Separate queues and jobIds are required: BullMQ's scheduler upserts by jobId, so sharing one would
silently leave a single timer running. The spec asserts this.

Both endpoints are `@Public()` and gated by `assertWorkerToken` on the `x-worker-token` header, so
they need `INTERNAL_API_URL` and the worker token already used by the sibling scan workers.

## Cadence rationale

- **30s drain** — this is the only email an approved applicant receives; a minute of latency on a
  "your account is ready" mail is noticeable.
- **15 min sweep** — the reminder window it guards is 24h wide (fires once the claim email is 48h
  old, 24h before the 72h link dies), so the cadence only has to be finer than the window.
  Exactly-once is guaranteed twice over: a CAS on `claimReminderSentAt` and a fixed outbox
  `eventKey` of `email:claim:<id>:reminder`.
