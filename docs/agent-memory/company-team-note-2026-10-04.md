# Agent Memory: company-team-note-2026-10-04

Status: Ready for controller review; implementation and sandbox checks complete. Uncommitted worktree diff; PostgreSQL/browser acceptance pending controller.
Owner: Mangmee owner decision 2026-10-04; controller owns integration and live verification.
Scope: Shared company note storage/service/contracts, executive right and grant API, System Admin note API/card. Executive report reader/export and executive web screens belong to the other lane.
Decisions:
- Owner: “มีช่องหมายเหตุในระบบเลย มีทั้งฝั่ง console และ ceo ให้ consistency กัน”. One live plain-text note per company, trimmed, max 1,000 characters; empty clears, with last editor/time.
- Separate CompanyTeamNote table, keyed by companyId; Company FK ON DELETE CASCADE cannot block company deletion. No actor FK; deleted actors do not block cleanup.
- Platform tenant boundary on every service call. Read with admin dashboard or executive read permission; write by SYSTEM_ADMIN or executive read plus explicit company-note manage permission, regardless of company lifecycle.
- Version starts at zero without a row; company-row lock orders first writes and company deletion, strict expectedVersion on writes, increment only for actual content change. Empty clear retains the row and last-change metadata.
- Atomic AuditService.log in the same transaction, system.company_team_note.update; lengths/versions only, never note content. Existing audit sanitizer bounds metadata strings at 512; free text can contain private details.
- Persistence failures return a fixed 503 without raw Prisma error/cause, because global error logs may otherwise embed submitted note or bank details.
- Executive role labels use THAI_SYSTEM_ROLE_NAMES in the API registry and web dictionary, including all existing executive roles; adding the new grant exposed a bare-key fallback on admin user lookup. No executive screen was edited.
- New optional canManageCompanyNote: omitted on create = false; omitted on access update = preserve the existing grant for older callers. Explicit false revokes.
- Small plan: document decision; add failing service/permission/route/card checks in registered suites; implement shared service and cascade migration; wire admin card; run focused green checks and mandated locked checks.
Open questions: None in the authorized scope. Real PostgreSQL/browser checks are controller-owned and unavailable here.
Artifacts:
- Migration: `apps/api/prisma/migrations/20261004130000_company_team_note/migration.sql`.
- Shared provider: `CompanyTeamNoteModule` exports `CompanyTeamNoteService` (standalone module to avoid pulling all admin/billing imports into executive).
- Service API: `get(ctx: RequestContext, companyId: string): Promise<CompanyTeamNoteDto>`; `put(ctx: RequestContext, companyId: string, body: PutCompanyTeamNoteBody): Promise<CompanyTeamNoteDto>`.
- `PutCompanyTeamNoteBody = { text: string; expectedVersion: number }`; DTO `{ companyId, text, version, updatedAt: string|null, updatedBy: { userId, displayName }|null, canManage }`.
- Console routes GET/PUT `/v1/system/partners/:partnerCompanyId/team-note`; read permission `system.partner_dashboard.read`; write permission `system.partner_company.update` plus SYSTEM_ADMIN; both additionally pass the shared platform boundary.
- Console overview card and shared words: `PartnerTeamNote.tsx`, `packages/contracts/src/company-team-note.ts`; error translator reuses the same words.
- Registered PG coverage is added to `report-labels.pg.spec.ts` (uses REPORT_LABELS_TEST_DATABASE_URL): concurrent first writers, strict CAS/clear/no-op/platform audit, audit-FK rollback, company cascade, real shop identity/audit isolation.
- Executive web/read/export files were not edited. Next lane imports CompanyTeamNoteModule and uses the service with request context; note rights can be granted through the existing create/access DTOs.
Verification:
- No network, Docker, server or browser used. No forbidden git command or package.json edit.
- Contracts build: exit 0 (repeated after contract changes). Prisma generate and validate: exit 0; generated output is ignored, not part of diff.
- API note rules in update-partner-profile.use-case.spec.ts: initial red exit 1, 13 pass / 7 fail (missing service); final green exit 0, 22 pass / 0 fail. Additional fixed-error privacy red run: 0 pass / 2 fail before sanitizing persistence errors; shop read/audit test red: 0 pass / 1 fail with new service temporarily removed (HEAD had none), then restored.
- Permission registry initial red exit 1 (new role, admin permission matrix and catalog counts absent); green exit 0, 51 pass / 0 fail. Initial temporary grant fixture moved to the registered canonical account suite to avoid owning two fixtures.
- partner.controller.spec.ts: red exit 1, 48 pass / 3 fail (missing routes/DTO field); green exit 0, 51 pass / 0 fail.
- partner-member-console.use-cases.spec.ts: stale three-role fixtures initially 16 pass / 47 fail. Refresh to canonical registries; changed/new account tests run against HEAD executive-users.service.ts: red exit 1, 0 pass / 3 fail (missing note flag/grant), restored fixed service; final green exit 0, 64 pass / 0 fail. One intervening failure was the fixture's baseline account permissions, resolved by keeping that fixture's original executive-only permission surface.
- Web company-team-note.spec.ts: initial red exit 1, 0 pass / 5 fail (missing card/API); added shared translator test red exit 1, 0 pass / 1 fail before map; final green exit 0, 7 pass / 0 fail. Added executive-role-label test red exit 1, 0 pass / 1 fail (raw MANGMEE_EXECUTIVE); green with the shared role-name map.
- Web api-error-coverage.spec.ts: before map exit 1, 15 pass / 1 fail; after map exit 0, 16 pass / 0 fail.
- Contracts employee-access.spec.ts: added word/registry test red exit 1, 0 pass / 1 fail with HEAD executive-business.ts temporarily restored; green exit 0, 8 pass / 0 fail.
- Auth guard: exit 0, 50 pass / 0 fail. Audit repository: exit 0, 5 pass / 0 fail. W00 manifest: exit 0, 4 pass / 0 fail; no drift, no regeneration.
- report-labels.pg.spec.ts: exit 0 with entire PG suite skipped (REPORT_LABELS_TEST_DATABASE_URL absent); tests 0/pass 0/fail 0. Actual PG red/green, migration execution and race/deletion checks NOT CHECKED here; controller must run.
- API typecheck through heavy.sh: first/repeat exit 0. Web typecheck through heavy.sh: exit 0. Both repeated after final role-name/Button changes: final API exit 0 and final web exit 0.
- Whole web suite through heavy.sh, with every S3_* variable removed: first exit 1, 2,969 pass / 1 fail; diagnostic repeat exit 1, 2,970 pass / 1 fail (extra role-label test added while the repeat awaited the lock). Failure was action-loading coverage: the note reload/save native buttons lacked aria-busy. Fixed with the existing Button; focused action-loading.spec.ts exit 0, 11 pass / 0 fail. Final whole suite exit 0: 2,971 tests passed, 0 failed, 0 skipped (573 suites).
- Grep of all API/ai-gateway/web/e2e spec files for the former bare executive role labels found auth.guard, permission-registry, employee-access.logic, role-management.use-case, partner.controller, update-partner-profile, and web session-gate.logic specs; focused runs recorded below (no ai-gateway/e2e match).
- Employee-access logic: initial exit 1, 20 pass / 1 fail (stale five-role platform-only pin). Updated the pin; red with the former platform-only list restored for one run: exit 1, 0 pass / 1 fail. Restored current registry; green exit 0, 21 pass / 0 fail. The pin test also iterates every canonical platform-only role and verifies refusal at shop boundaries.
- Remaining old-label matches: role-management.use-case.spec.ts exit 0, 45 pass / 0 fail; web session-gate.logic.spec.ts exit 0, 37 pass / 0 fail. All matched runnable specs have now been run.
- Existing labels/screens were not renamed: new note words are additions; existing executive role key fallbacks now use their existing API Thai names. Searched affected expectations; whole web suite checks cross-feature fallout.
- Maintenance pins check: exit 0, exactFiles=48, status=current; no pinned file changed.
- git diff --check: initial exit 2 (extra EOF blank line in registry spec), fixed; latest exit 0.
Next: Controller reviews/commits the diff, runs the registered report-labels PostgreSQL suite and full API/PG/browser gates, applies the migration and permission sync through the normal release protocol. Other lane imports the shared note module/service and wires executive readers/screens/accounts. No product question remains in this lane.
