# Agent Memory: remove-notification-settings-actions

Status: Implementation and focused verification complete; preparing integration with latest develop, 2026-08-27.
Owner: /root/remove_notification_settings_actions
Scope: Remove only the `ตั้งค่า` and `กฎ` header links from the notification center on mobile and desktop, for every role, including users with both management permissions.

Decisions:

- Isolated worktree `mangmeeplus-remove-notification-settings-actions`, branch `codex/remove-notification-settings-actions`, based on fetched `origin/develop` at `554ef68ed99ef6929e292af78dad0f3bfb9a0504`.
- Follow `AGENTS.md` and ponytail full: delete the two controls and their single-caller visibility helper; do not introduce a feature flag or replacement settings UI.
- Keep `อ่านทั้งหมด`, unread/all filters, loading/empty/forbidden states, row read/dismiss/source navigation, bell badge, and notification/approval delivery unchanged.
- Existing preferences/rules routes and APIs remain permission-checked. Do not delete stored preferences or rules, change channels/quiet hours, revoke permissions, or remove unrelated company settings.
- Existing dashboard-notification spec remains authoritative for core center/read/delivery/security behavior. This memory records the narrow user decision to stop exposing the two unused header entry points.
- Update the existing NOTIF-01 smoke expectation (which still requires Settings to be visible) and add a rendering regression covering read-only and management-granted sessions plus the existing read permission boundary.
- No dependency, package manifest, schema, live data, cloud, deploy, or main changes.

Open questions: None.

Artifacts:

- `apps/web/src/features/dashboard-notifications/NotificationPages.tsx`
- `apps/web/src/features/dashboard-notifications/dashboard-notifications.logic.ts` and its existing tests
- `apps/web/src/features/dashboard-notifications/NotificationPages.spec.ts`
- `e2e/notifications.spec.ts`

Verification:

- Red/green: the new `NotificationPages.spec.ts` initially failed because a session with both management grants rendered the two links. After removal both rendering tests pass, including rejection when only management grants (without `notification.read`) are present.
- `./apps/api/node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test --test-reporter=spec apps/web/src/features/dashboard-notifications/*.spec.ts apps/web/src/features/web-core-workspace/*.spec.ts` — 118 passed, 0 failed/skipped.
- `pnpm --dir packages/contracts build` — passed; output only in this worktree. No Prisma generation or shared dependency-output writes.
- `pnpm --dir apps/web typecheck` — passed (`next typegen && tsc --noEmit`), including after temporary fixture removal.
- `pnpm exec playwright test e2e/notifications.spec.ts --project=critical --list` — the updated NOTIF-01 smoke test is registered. Full seeded API/DB E2E was not run; this task used an isolated browser fixture instead.
- Browser skill: actual notification center and bell rendered against local synthetic fetch responses at `127.0.0.1:3228`, desktop 1280×900 and mobile 390×844. Verified no Settings/Rules links for management-granted and read-only sessions; read-all, unread/all filters, bell badge, single-read, read-all success toast, dismiss, empty state, read-permission forbidden state, and source navigation to the synthetic destination. No console warnings/errors were observed.
- Browser fixtures blocked non-fixture API requests. Temporary fixture pages removed, owned dev servers stopped and tabs closed, viewport override reset. No live UAT/account/notification/LINE/DB actions.
- `git diff --check` — passed; no helper callers remain. All new web specs match the existing `src/**/*.spec.ts` test glob; no package manifest or test-script edit.

Next: Commit only scoped files, merge current develop (VAT agent delivered `234d14255de67275d087aae85b63f1216f142210`) and rerun relevant checks, then normal non-force push the feature branch and tested HEAD to develop.
