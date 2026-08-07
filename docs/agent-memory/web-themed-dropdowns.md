# Agent Memory: web-themed-dropdowns

Status: Implemented and code-verified; browser path blocked by stale local DB schema.
Owner: Codex
Scope: Standardize every dropdown in `apps/web` on the shared themed select menu.
Decisions: Reuse and extend `ThemedSelect`; retain the existing `value`/`onChange` call shape; support uncontrolled `defaultValue`, form `name`, disabled submission, reset, and ARIA state; do not add a dependency.
Open questions: Browser verification needs the local database migrated so `AuditLog.actorType` exists.
Artifacts: `apps/web/src/common/components/field/ThemedSelect.tsx`, `apps/web/src/common/components/field/ThemedSelect.spec.ts`, `apps/web/src/common/components/field/Field.tsx`, CRM booking/customer pages, inventory pages.
Verification: Focused `ThemedSelect` render test passed; full web suite passed (271/271); `pnpm --filter @watchdog-bms/web typecheck` passed; `git diff --check` passed. Source audit found zero rendered native `<select>` tags and 55 `ThemedSelect` usages. Browser reached the booking route but the API stopped during dev-login because the local database lacks `AuditLog.actorType`.
Next: Re-run the booking page browser smoke after the local DB migrations are current.
