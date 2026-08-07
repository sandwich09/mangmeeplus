# Agent Memory: มั่งมี auth & permissions UI migration

Status: Phase 1 DONE (2026-07-05) — verified: api tsc+858/858 tests, web tsc+158/158 tests+production build
Owner: Claude session for supapron.wiroon
Scope: Login/logout/permission screens restyle to มั่งมี green design + security hardening + th/en errors + global trim + responsive + API field alignment. Plan: `docs/plans/mangmee-auth-permissions-ui-plan.md`; Thai summary: `~/Documents/WatchDog/Doc/mangmee-auth-ui-migration-summary-th.md`.
Decisions:
- Login = identifier(username|email)+password+remember only; LINE button removed per design team agreement; OTP deferred (no SMS provider).
- Permission screens keep real RBAC model (Employee Access v2), restyled; prototype menu×action matrix NOT adopted.
- Trim ALL string inputs incl. passwords, both web and API (global TrimStringsPipe) — explicit product request.
- Bilingual errors implemented web-side via dictionary (API stays English; error codes = Phase 2).
Open questions:
- Employee email/branch-scope/profile fields = Phase 2 (needs contracts + schema migration).
Artifacts:
- Plan + Thai summary (above). Phase 1 code: apps/web (globals.css, layout fonts, Button/Field/IconButton/CoverLoader, LoginPage, secondary auth pages, EmployeeAccessPages, dictionary, trim helper, login BFF remember) + apps/api (TrimStringsPipe, login rate limit, email-or-username + dummy-hash login, employee/role boundary DTOs).
Verification: apps/api `pnpm typecheck` clean + `pnpm test` 858 pass (incl. new trim-strings.pipe.spec, auth-rate-limit.service.spec, email-identifier login spec). apps/web `pnpm typecheck` clean + `pnpm test` 158 pass + `pnpm build` production build OK. Visual verification done via Playwright + system Chrome against `next dev`: /login at 1440px + 375px + EN locale, and workspace sidebar (dev sign-in against local docker API on :3001) at 1440px + 375px off-canvas — screenshots confirmed hero, brand, active-menu inset bar, sidebar footer (role + logout), Thai group labels. Sidebar update: coin logo tile, left inset bar on active item, Flow A group labels (บริหารร้านค้า / การเงิน & บัญชี / ตั้งค่าระบบ), footer with role label + logout, missing module.procurement/module.accounts_payable dictionary keys fixed. Sidebar footer shows ROLE (session /auth/me has no display name — add displayName to /auth/me in Phase 2 if name wanted).
Next (Phase 2 backlog in plan §6): employee email/profile fields + branch-scope endpoint + LINE QR web login + OTP (needs SMS provider) + PO approval tiers + API error codes + Redis rate limiting.
