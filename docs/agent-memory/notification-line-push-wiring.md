# Agent Memory: LINE Push Delivery Wiring (item 06 -> staff/owner LINE)

Status: Implemented and code-verified. The queued staff-notification rail, worker sweep, and shared-OA LINE push are active; do not rebuild them.
Owner: Product owner (committed 2026-07-09).
Scope: Employee notifications sent through the WatchDog shared OA. Customer-facing sends remain on the company-OA `crm-inbox` path.

## Implemented Path

1. `CreateOrUpdateNotificationEventUseCase` creates the event, active-member recipients, and queued `web` and `line` `NotificationDelivery` rows.
2. The workers `delivery.sweep` repeatable job runs every 30 seconds and calls the internal delivery-sweep endpoint.
3. `ProcessDueNotificationDeliveriesUseCase` selects due queued/failed rows and isolates each delivery failure.
4. `ProcessQueuedDeliveryUseCase` is the delivery owner. Its LINE branch applies per-user channel/trigger preferences, Asia/Bangkok quiet hours, active membership/event checks, shared-channel LINE identity resolution, idempotent provider pushes, retry/backoff up to five attempts, and critical-failure audit handling.

## Producer Rules

- Producers inject `CreateOrUpdateNotificationEventUseCase`; they do not call `pushSystemLineMessage` or LINE APIs directly.
- Every producer trigger key must be present in `IMPLEMENTED_TRIGGER_KEYS`, or the default trigger preference gate suppresses it.
- Use `severity: 'action'` for ordinary staff action reminders. `critical` bypasses quiet hours and creates HIGH-risk audit rows on delivery failure.
- Notification enqueue/resolution failures must not roll back an already-completed business operation; catch, warn, and continue at the producer boundary.
- Plain title/body plus `deepLinkHref` is the supported staff-notification payload. A Flex-card rail would be a separate feature.

## Operational Notes

- Default channels are `web` and `line`; an unlinked user finishes as `NO_LINE_DELIVERY_TARGET`, and explicit preferences can opt out.
- Retryable failures receive exponential backoff capped at one hour. Suppressed/skipped outcomes are terminal.
- `delivery.process` remains available for targeted retry, while the repeatable sweep is the normal dispatcher.
- `ProcessQueuedDeliveryUseCase` uses `AppConfigService` for the shared LINE channel token and channel ID.

Next: for each new staff-notification producer, register its trigger key, import `DashboardNotificationsModule` into the producer module, and add focused recipient/failure-isolation tests.
