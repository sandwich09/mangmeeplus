# Customer Journey Observability Signal Contract (P9-0)

Status: **IMPLEMENTED CONTRACT — instrumentation remains phased**  
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

The accounting rows intentionally distinguish financial commit from downstream publication. Existing
outbox state proves the latter. A failed request before commit needs separate P9-1 instrumentation and is
not inferred from absence.

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

## P9-1 boundary

P9-1 may add missing emitters/adapters and dashboards using existing structured logs, audit, outbox, and
CloudWatch metric filters. It must not add a second telemetry stack, assign targets without a baseline, or
change a financial mutation merely to make telemetry convenient.
