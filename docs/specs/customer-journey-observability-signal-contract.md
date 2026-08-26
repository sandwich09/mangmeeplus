# Customer Journey Observability Signal Contract (P9)

Status: **P9-0 CONTRACT + P9-1A DASHBOARD + P9-1B BOUNDARIES + P9-2 LOCAL FAILURE MATRIX IMPLEMENTED**
Scope: Four product lanes only; subscription/payment is excluded.  
Last reviewed: 2026-08-26

## Goal

Provide one testable source of truth for customer-journey denominator, numerator, terminal outcomes,
latency clock, owner, severity, and runbook routing. A dashboard or alarm is not evidence unless its
source is marked `LIVE` in the executable catalog.

Executable source: `apps/api/src/common/observability/customer-journey-signal.catalog.ts`.

## Truth states

- `LIVE`: denominator, terminal outcome, correlation, and latency can be derived from current code/state.
- `PARTIAL`: useful evidence exists, but the catalog names the missing boundary. It must not be reported as end-to-end coverage.
- `PLANNED`: stable names and outcome semantics are reserved for P9-1; no current coverage is claimed.

No conversion/SLO target is allowed before the first representative baseline cohort. `target` therefore
stays `null` in every P9-0 row. Missing, duplicate, or orphan terminal observations are correctness failures,
not merely a poor rate.

## Required stages

The executable catalog covers:

1. official signup receive, owner claim, and tenant provision;
2. SES claim-email delivery;
3. LINE login and LINE account link;
4. receipt intake and OCR;
5. LINE AI accepted-to-terminal answer;
6. outbox worker drain;
7. sales-document issue and expense confirmation through downstream outbox publication.

The accounting rows intentionally distinguish the request-to-financial-commit journey from downstream
outbox publication. P9-1b pairs issue/confirmation requests through the application boundary; the existing
outbox-worker row proves downstream publication separately, without retrying a legal document or expense.

## Cardinality and correlation

- One accepted correlation must end in exactly one terminal classification.
- A repeated delivery/provider notification must reconcile into one domain terminal outcome before metric emission.
- Retry/replay reuses the durable correlation; it must not inflate the denominator.
- Synthetic drills use synthetic correlation IDs. Tenant IDs and personal/business identifiers are never metric dimensions.

## Privacy

Only these metric dimensions are permitted:

`environment`, `service`, `journey`, `stage`, `outcome`, `failureClass`.

Forbidden dimensions include company ID, email, tax ID, LINE/provider user ID, prompt, document ID, and
document payload. Correlation IDs may exist in access-controlled structured logs/evidence but must not be
promoted into metric dimensions.

## Verification

- Catalog contract and source-evidence tests live in `apps/api/src/common/logger/security-event.spec.ts`,
  which is already part of the API test command.
- Runtime alarm regression remains `bash infra/monitoring/runtime-alarms.spec.sh`.
- Response procedure is `docs/runbooks/customer-journey-signal-triage.md`.

## P9-1a dashboard

`infra/monitoring/runtime-alarms.sh install <environment>` creates or exactly replaces the global
CloudWatch dashboard `watchdog-bms-<environment>-customer-journeys`. `verify` reads the dashboard
back and rejects any drift from the source-controlled body.

The dashboard shows:

- proven `LINE AI` accepted and terminal metrics from `WatchDog/LineAI`;
- existing login-denied, upload-rejection, AI/OCR-failure, API-5xx, and AI-queue context metrics;
- the four-lane coverage matrix, where durable outbox evidence remains a runbook query rather than
  an invented CloudWatch metric;
- explicit `UNKNOWN`, `PARTIAL`, and `PLANNED` guidance with no target line.

The dashboard is account-global, while every metric widget explicitly selects `ap-southeast-1`.
Its IAM statement is limited to `arn:aws:cloudwatch::<ACCOUNT_ID>:dashboard/watchdog-bms-*-customer-journeys`.
This follows the AWS contracts for [PutDashboard](https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_PutDashboard.html),
[dashboard body structure](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Dashboard-Body-Structure.html),
and the [CloudWatch dashboard resource ARN](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudwatch.html).

## P9-1b boundary

`observeCustomerJourney` now writes one accepted and one terminal audit row around LINE login/link,
receipt OCR, receipt-upload completion, sales-document issue, and expense confirmation. It reuses the
request correlation, emits bounded outcome/failure classes and duration, and rethrows the original error.
The wrapper does not change a financial mutation or retry it.

Receipt intake remains `PARTIAL` only for an upload intent abandoned before the completion endpoint is
called; current code has no expiry reconciler that can truthfully classify that terminal. The `PLANNED`
official-signup, owner-claim, tenant-provision, and claim-email rows cannot become live before P10-P12
implement those business flows. No second telemetry stack or pre-baseline target is introduced.

## P9-2 failure matrix

`CUSTOMER_JOURNEY_FAILURE_MATRIX` is the executable local contract for `detect → alert → diagnose →
recover/no-duplicate`. Each `LIVE` row must have an observable detector, installed alarm contract,
exact runbook section, recovery behavior, duplicate-safety invariant, and source evidence token.

The matrix must remain honest about rollout state:

- SES hard bounce/provider outage and provisioning partial failure are `PLANNED` until P10/P11 exist.
- Outbox and database/audit failure are `PARTIAL` because bounded retry, fencing, DEAD detection, and
  alarms exist, but there is no approved DEAD-row reconciler/replay path.
- A local automated test is implementation evidence, not proof of alarm delivery. At least one
  synthetic failure per severity must still complete in UAT with redacted evidence and human alert
  acknowledgement before the drill/activation gate closes.
