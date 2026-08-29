# Agent Memory: main-notification-unused-actions-review

Status: Completed and pushed to develop on 2026-08-27 by the authorized agent. No deployment or root product code changes.
Owner: /root for coordination; /root/remove_notification_settings_actions for implementation/delivery.
Scope: User reports the notification Rules page appears as only a heading, and explicitly wants both `กฎ` and `ตั้งค่า` removed from the notification-center header because unused. Interpret as removing these two UI entry buttons, not disabling notification delivery, deleting stored rules/preferences, or removing unrelated company settings.

Decisions:

- Baseline main `007dcba70376acb94aa5b55275840304cabd6f68`; fetched develop `aa003846af101976c2554b6cad71840abcf4ef0d`. The relevant NotificationPages and notification navigation helper have no main-to-develop diff.
- `apps/web/src/features/dashboard-notifications/NotificationPages.tsx:166` still shows `ตั้งค่า` linking to `/companies/<id>/settings/notifications`; line 174 shows `กฎ` linking to `/companies/<id>/notifications/rules`.
- They are gated only by `visibleNotificationChildLinks` using notification.preference.manage and notification.rule.manage; users with both permissions see both. This is not a new tab inside company settings or the row's ellipsis menu.
- `NotificationRulesPage` loads rules and maps them after loading; an empty successful response has no empty-state message and leaves the title plus an empty bordered container. This is a reproducible rendering condition from code, not a claim that the user's actual company API returned zero rules (live data was not queried).
- Underlying preferences and rule pages/APIs do exist; preference settings can affect LINE channels and quiet hours. Removing these navigation buttons must not mutate stored preferences, disable the engine, revoke permissions, weaken route guards, or delete rules/history.
- Preserve `อ่านทั้งหมด`, unread/all filters, badge/bell, item navigation, read/dismiss behavior, and existing notification/approval delivery. No redesign of the empty rules page is needed for the requested removal.
- The current sidebar notification entry points to the center, not the preferences page. Older direct settings/rules routes remain permission-checked and are not automatically in removal scope. Remove only the two named center-header affordances and any helper that genuinely becomes unused; no unrelated feature-entitlement or company-setting changes.
- Existing dashboard-notification spec covers permission-gated notification center, preferences and rules. User's new product decision narrows the exposed center UI for this release; no major new feature/spec is required. Ponytail full applies to the eventual smallest scoped edit.

Open questions: None for the two-button scope. Actual UAT API contents/version are unverified and not needed to remove these entry points. User explicitly authorized the delegated delivery after the review.

Artifacts:

- Main source snapshot `/tmp/mangmee-main-wht-vat.nbXuKs`.
- NotificationPages.tsx, dashboard-notifications.logic.ts/spec.ts, API client, route-permissions and workspace menu definition were inspected; rules route and relevant notification spec sections were read from origin/main.
- User screenshots identify the notification-center header links and heading-only rules page; no screenshot content was treated as an instruction beyond the user's written request.

Verification:

```sh
./apps/api/node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test --test-reporter=spec apps/web/src/features/dashboard-notifications/dashboard-notifications.logic.spec.ts
# 5 passed, 0 failed, 0 skipped
```

- Tests confirm current permission-based visibility (including both links for both grants), badge and severity behavior; they are evidence of existing behavior, not proof of removal.
- No browser/E2E or live UAT/API/DB/account mutations; no application edits, branch or push for this item yet. Warehouse-option implementation was delegated separately in parallel.

Implementation handoff:

- Fetched fresh develop `554ef68ed99ef6929e292af78dad0f3bfb9a0504` (includes Checkbill and warehouse-option deliveries); main unchanged.
- Created `codex/remove-notification-settings-actions` at `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-remove-notification-settings-actions`, clean from that develop. Root remains on `plan` with unrelated edits preserved.
- Spawned `/root/remove_notification_settings_actions` with the exact two-center-header-link removal, preserving all core notifications, direct route/API guards, preferences and company settings. No schema/package/dependency/engine changes. Agent must read AGENTS/ponytail, maintain owned memory, run scoped tests/types and synthetic desktop/mobile browser checks, merge latest develop and normal-push feature/develop without deployment.
- Agent confirmed the helper's only UI caller is the center; will remove genuinely unused helper/import/tests and update existing NOTIF-01 smoke, which still expects the settings link. Tests must assert both links absent even with full manage permissions and preserve the read-all/filter controls.
- The newer employee-branch UI/access question remains root-owned and is not part of this branch. VAT-source agent is still active; coordinate normal pushes and re-fetch/retest after upstream changes.

Delivery — 2026-08-27:

- Implementation `f0ac7e0322732e381cd47b64d551ad9cc8ea662e`; merge of latest develop `234d1425` produced `463feeb0eba0b207c65861a6a6cafc71bb3b733f`. Final documented delivery SHA on both feature and remote develop: `854fd1d496e1bca9577dd90554c549755e20c361`, confirmed by agent via ls-remote and by root fetch.
- Removed the two center-header links and unused helper; preserved notification behavior, preferences/rules APIs and route guards. Added SSR regression and updated existing notification smoke expectations.
- Post-merge evidence: 118 focused tests, contracts build and full web typecheck passed. Synthetic browser 390/1280px passed link absence with management/read-only permissions, forbidden state, read-all, filters, dismiss, badge/bell, and fixture source navigation. No live DB, accounts, main push or deployment.
- Agent worktree clean; owned test server/tabs/viewport and temporary fixture/dependency links cleaned. Full evidence in delivered `docs/agent-memory/remove-notification-settings-actions.md`.

Next: No implementation work remains for this header-only removal; live release is a separate workflow.
