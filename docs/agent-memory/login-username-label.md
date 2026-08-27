# Agent Memory: Login username label

Status: copy change and local verification complete, 2026-08-27; develop integration pending.
Owner: delegated copy-only implementation agent.
Scope: Login identifier label and blank-field message in Thai/English; test and integrate into develop.
Decisions:

- Branch `codex/login-username-label`, isolated worktree `mangmeeplus-login-username-label`, base `11bc689365cb2b80fd658007bedbc3dbda7f8ce6`.
- Read AGENTS and ponytail FULL; the legacy skill path is missing, so use the repository skill.
- Username is the primary visible instruction: label `ชื่อผู้ใช้` / `Username`; required message `กรุณากรอกชื่อผู้ใช้` / `Enter your username.`.
- This supersedes only the visible username-or-email copy in the historical auth UI migration plan. Existing username/email authentication capability and API payload remain unchanged. Do not alter login validation, backend, recovery, registration, permissions or security.
- Reuse the two dictionary keys already used by LoginPage. Reuse existing i18n/API tests; no component abstraction or dependency/package.json change.

Open questions: none.
Artifacts: dictionary copy and focused regressions in existing `workspace-i18n.spec.ts` and `auth.api.spec.ts`.
Verification:

- Runtime diff is only four dictionary values; LoginPage, auth implementation, recovery and registration unchanged. Search found no other email-login hint in this login journey.
- Independent offline dependencies: `corepack pnpm install --offline --ignore-scripts --frozen-lockfile`. Contracts/config compiled only in this worktree; no dependency symlinks or shared generated artifacts.
- `rg --files apps/web/src/common/i18n apps/web/src/features/auth apps/web/src/common/auth | rg '\.spec\.tsx?$' | xargs ./node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test --test-reporter=spec`: 105/105 passed, no skips. New regressions cover both translated strings and unchanged username/email login payloads.
- `./node_modules/.bin/tsc -p packages/contracts/tsconfig.json`, `./node_modules/.bin/tsc -p packages/config/tsconfig.json`, `./node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json`: passed.
- Browser skill: actual Next `/login?recovered=1` on localhost4340, isolated API base localhost4341 (no API running): Thai label/blank error and English label/whitespace error verified. Required-field focus, aria-invalid/description, `name="username"`, and `autocomplete="username"` unchanged. No login request submitted, real credentials used, database accessed, or browser console error. Test tab closed and Next server stopped; generated next-env change removed.
- `git diff --check`: passed. No package.json/lockfile/generated-file diff.

Next: commit, merge latest develop preserving concurrent auth-copy changes, repeat auth/i18n/typecheck, then non-force push feature/develop and verify remote containment. No live account, cloud, DB or deployment operation is authorized or claimed.
