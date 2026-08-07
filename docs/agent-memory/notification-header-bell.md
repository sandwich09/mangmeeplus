# Agent Memory: notification-header-bell

Status: IMPLEMENTED + VERIFIED — 2026-07-26
Owner: Claude (audit + direct implementation)
Scope: apps/web only — top-right notification bell in the workspace header, wired to the existing (complete) dashboard-notifications backend.
Audit findings (system state before this change):
- Backend was fully built and untouched here: list/unread-count/mark-read/read-all/dismiss endpoints (notification.controller.ts, perm `notification.read`), 8+ real producers (daily_owner_summary, stock_low, 4 crm_* scans, report_ready, workflow SEND_NOTIFICATION), BullMQ worker sweeps (delivery 30s / snapshot 15m / stock 1h / daily 07:00 Asia/Bangkok) gated by QUEUE_ENABLED + Redis.
- The web shell had NO bell at all; `getUnreadCount` client fn and the `shell.notifications` i18n key existed but were dead code; the inbox page `/companies/:id/notifications` was orphaned (no nav entry pointed at it — sidebar `notifications` goes to settings/notifications = preferences). Plan item dashboard-notification-plan.md:589 was the unchecked "header integration".
Decisions:
- New `NotificationBell` (features/dashboard-notifications/NotificationBell.tsx): unread badge (poll 60s + window-focus refresh; spec says polling OK for MVP), popover with 8 latest items (severity chip + relative time + unread dot), item click = optimistic mark-read (+deepLinkHref navigation when present), อ่านทั้งหมดแล้ว = markAllRead, footer link "ดูการแจ้งเตือนทั้งหมด" → the previously-orphaned inbox page.
- Wiring: AppHeader/WorkspaceShell gain a generic `headerExtras?: ReactNode` slot; WorkspaceLayout passes the bell **only when session.permissions includes `notification.read`** (permission-visibility rule from expenses-permission-visibility task).
- `notificationBadgeText` (0→null, cap 99+) pure in dashboard-notifications.logic.ts.
Known issues recorded (NOT fixed):
- contracts `NotificationTriggerKey` union is stale — missing live `crm_*` keys and all `workflow.*` keys (typing only, no runtime effect).
- Fresh-seeded DB has zero NotificationEvent rows; bell shows 0 until a worker sweep or CRM/workflow event fires. Manual trigger: POST the internal sweep endpoints with X-Worker-Token, or enable QUEUE_ENABLED + Redis.
- `dashboard.widget.unread_notifications` dictionary key still has no producing widget.
Artifacts: NotificationBell.tsx; dashboard-notifications.logic.ts(+logic.spec.ts new); AppHeader.tsx + WorkspaceShell.tsx (headerExtras); WorkspaceLayout.tsx (permission-gated bell).
Verification:
- API notification suites re-run: notification.logic + internal.controller + process-due-deliveries → 35/35; workers notification-jobs → 4/4.
- Web test 355/355 (baseline 352 + 3 new badge/severity tests); typecheck + production build clean.
- Manual browser walk pending stack: badge count, popover, mark-read/all, deep links, e2e NOTIF-01..04 unaffected (list/prefs pages untouched).
Next: stack-up walk; optionally trigger `POST /internal/notifications/stock-low-sweep` (X-Worker-Token) to seed real events for the demo.
