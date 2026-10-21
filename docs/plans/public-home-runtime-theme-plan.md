# Homepage runtime theme control

Status: COMPLETE locally — implemented and verified on 2026-10-22; no push, merge or deploy.

## Product and architecture

Extend [the event theme spec](../specs/public-home-event-themes-spec.md) with a platform-admin selection at `/system/home-theme`. One setting chooses `default` (off) or an installed event (`halloween`, plum). There is no separate enabled flag, scheduler, asset upload or deletion API. Adding/removing event code and assets requires deployment; ordinary selection requires only saving the setting.

- Shared contracts own the installed-event allowlist and setting shape.
- One `PublicHomeThemeSetting` row (`homepage`) persists event, revision and update attribution. Missing row means default/version 0. Reads do not create rows.
- Dedicated `system.home_theme.manage` permission belongs only to `SYSTEM_ADMIN`, through the existing permission registry/sync. The system route and API check it; company roles cannot manage global appearance. No tenant data changes.
- GET/PUT `/v1/system/home-theme` uses existing authentication/CSRF/permission machinery. PUT validates an installed ID and expected version. Transaction lock, compare, update and before/after audit prevent lost updates; 409 requires reloading settings. Same-value save is a no-op.
- Public GET `/v1/public/home-theme` returns only the effective event, with `Cache-Control: no-store`. It follows the existing platform-access gate. The homepage server reads it with `cache: no-store` and a 1.5-second timeout. Failure/invalid/removed event falls back to normal. No in-process theme cache, client polling or user-specific storage.
- Only `/` consumes the setting. Existing tabs update on reload; full new page requests see saved state immediately. Existing CSS, content and metadata stay intact. Development-only preview explicitly overrides the setting; production ignores all preview/event/palette query overrides.
- UI: current saved choice, native radio options, save progress/result, retry, permission denial and version-conflict reload. Use existing Thai UI components. No irreversible-delete control or extra save-confirmation modal.

## Implementation and evidence

- [x] Discover singleton persistence, audit, permission registry, authenticated browser client and Next server fetch behavior; read Thai UX and Ponytail.
- [x] Add shared contract, schema/migration, permission and focused API module.
- [x] Add permission-gated admin route/navigation and homepage runtime read.
- [x] Verify real PostgreSQL persistence, HTTP auth/validation/conflict/audit and cross-instance reads; meaningful fallback and production-query checks.
- [x] Exercise admin save → public homepage → off at 390/1280, loading/error/denial/conflict, normal baseline and non-home isolation. Inspect screenshots.
- [x] Record exact checks and remaining release steps in memory. Leave local review running without publishing.

## Release/removal boundary

Initial release requires the code, additive migration and standard permission sync. Subsequent selections need no rebuild or deploy. To remove a theme, switch to normal first, then remove it from the installed catalog/rendering/assets in a later release. Unsupported stored IDs resolve to normal even during rollback/version skew. Follow the mandatory runbook for any eventual UAT/Production operation; this task performs none.

Verification: contracts/config/API builds, Prisma migration on a fresh isolated PostgreSQL database, API/web TypeScript, 24 homepage tests and 56 permission/DI checks pass. Full Nest HTTP checks verify authorization, invalid input, concurrent writes, no-op, audit rollback and removed-theme fallback. Real browser checks pass at 390/1280 with 360/768/1536 overflow checks, two-tab conflict, loading/retry/denial, CSRF, baseline equality and non-home isolation. Evidence and exact commands are in task memory. Final result message is inside the shared action bar to prevent clipping; final in-app browser screenshots confirm the save and live homepage.
